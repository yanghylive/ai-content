import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { normalizeStatus } from './executor-state-machine';

/** 获客语义动作（PRD §6.4/P0-1：搜索→读结果→识别→开主页→草稿→私信→存线索） */
export const ACQUISITION_ACTION_TYPES = [
  'search',
  'read_results',
  'identify_lead',
  'open_profile',
  'generate_draft',
  'send_dm',
  'save_lead',
] as const;
export type AcquisitionActionType = (typeof ACQUISITION_ACTION_TYPES)[number];

/** 获客平台白名单（PRD §6.3 按平台/能力调度） */
const ACQUISITION_PLATFORMS = [
  'xiaohongshu',
  'douyin',
  'kuaishou',
  'shipinhao',
];
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface TaskView {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: Date;
}

export interface TaskStatusResult {
  id: string;
  status: string;
  result?: Record<string, unknown>;
}

/**
 * 任务下发中心（C 组/P5，主文档 4.3 C3 task-dispatch）
 * 创建发布任务 → agent 领取（claimNext）→ 执行 → 状态回传。
 * 状态机：queued → claimed → running → done/failed/cancelled
 */
@Injectable()
export class TaskDispatchService {
  private readonly logger = new Logger(TaskDispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 创建发布任务（schedule_publish 到点触发时调用；payload 契约校验防脏数据下发手机） */
  async createTask(
    userId: string,
    input: {
      type?: string;
      payload: Record<string, unknown>;
      deviceId?: string;
    },
  ): Promise<TaskView> {
    const payload = input.payload ?? {};
    if (
      !payload ||
      typeof payload !== 'object' ||
      Object.keys(payload).length === 0
    ) {
      throw new BadRequestException(
        '任务 payload 不能为空（需包含平台/内容/账号）',
      );
    }
    this.validatePayload(payload, input.type || 'publish');
    // P1 Lease：账号级外发租约——同账号已有活跃租约（未过期）时拒绝创建（防并发外发）
    const leaseAccountId = this.extractAccountId(
      payload,
      input.type || 'publish',
    );
    if (leaseAccountId) {
      const now = new Date();
      // P0-1 恢复保护期：active 租约或冻结期内（心跳超时）都阻塞，防重复外发
      const blocking = await this.prisma.executorLease.findFirst({
        where: {
          userId,
          accountId: leaseAccountId,
          OR: [
            { status: 'active', expiresAt: { gt: now } },
            { frozenUntil: { gt: now } },
          ],
        },
      });
      if (blocking) {
        throw new BadRequestException(
          blocking.status === 'active'
            ? `账号 ${leaseAccountId} 已有任务执行中（租约 ${blocking.taskId}，设备 ${blocking.deviceId}），请等待完成或释放后重试`
            : `账号 ${leaseAccountId} 处于恢复保护期（设备 ${blocking.deviceId} 心跳超时），请稍后重试或人工确认`,
        );
      }
    }
    const row = await this.prisma.executorTask.create({
      data: {
        userId,
        type: input.type || 'publish',
        payload: payload as never,
        status: 'queued',
        deviceId: input.deviceId ?? null,
      },
    });
    this.logger.log(`执行任务已创建：${row.id}（${row.type}）`);
    return this.toView(row);
  }

  /** 获客任务 payload 契约（P0-1 阶段 A：语义动作白名单 + 字段校验） */
  private validateAcquisitionPayload(payload: Record<string, unknown>): void {
    const platform = safeText(payload.platform || '');
    if (!ACQUISITION_PLATFORMS.includes(platform)) {
      throw new BadRequestException(
        `获客平台不支持（${platform || '空'}），应为 ${ACQUISITION_PLATFORMS.join('/')}`,
      );
    }
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (actions.length === 0) {
      throw new BadRequestException(
        '获客任务 actions 不能为空（需至少一个语义动作）',
      );
    }
    for (const item of actions) {
      const act = (item ?? {}) as Record<string, unknown>;
      const t = safeText(act.type || '');
      if (!(ACQUISITION_ACTION_TYPES as readonly string[]).includes(t)) {
        throw new BadRequestException(
          `不支持的获客动作（${t || '空'}），应为 ${ACQUISITION_ACTION_TYPES.join('/')}`,
        );
      }
      if (t === 'search' && !safeText(act.keyword || '')) {
        throw new BadRequestException('search 动作缺少 keyword');
      }
      if (t === 'send_dm' && !safeText(act.content || '')) {
        throw new BadRequestException('send_dm 动作缺少 content（私信内容）');
      }
    }
    // 必须含 search 作为起点（获客闭环从搜索开始）
    if (
      !actions.some((a) => (a as Record<string, unknown>)?.type === 'search')
    ) {
      throw new BadRequestException('获客任务必须以 search 动作开始');
    }
  }

  /**
   * 发布任务 payload 契约（P5 C2 设计评估 §三）：
   * platform 白名单 / content 或 media 至少一个 / media 1-9 个 https URL / 总大小 < 10KB
   */
  private validatePayload(
    payload: Record<string, unknown>,
    type: string,
  ): void {
    if (type === 'acquisition') {
      this.validateAcquisitionPayload(payload);
      return;
    }
    if (type !== 'publish') return; // 自定义任务不校验
    if (JSON.stringify(payload).length > 10 * 1024) {
      throw new BadRequestException('任务 payload 过大（>10KB）');
    }
    const platform = safeText(payload.platform || '');
    const allowed = ['douyin', 'xiaohongshu', 'kuaishou', 'shipinhao'];
    if (!allowed.includes(platform)) {
      throw new BadRequestException(
        `不支持的平台（${platform || '空'}），应为 ${allowed.join('/')}`,
      );
    }
    const content = safeText(payload.content || '').trim();
    const media = Array.isArray(payload.media) ? payload.media : [];
    if (!content && media.length === 0) {
      throw new BadRequestException('content 与 media 至少需要一个');
    }
    if (media.length > 9) {
      throw new BadRequestException('media 最多 9 个素材');
    }
    for (const item of media) {
      const url = safeText((item as { url?: unknown })?.url || '');
      if (!/^https:\/\//.test(url)) {
        throw new BadRequestException(
          `素材 URL 必须为 https（${url.slice(0, 60)}）`,
        );
      }
    }
  }

  /** agent 领取待办任务（原子化 + 事务：任务 claim 与租约建 在同一事务，PRD P1-17） */
  async claimNext(userId: string, deviceId: string): Promise<TaskView | null> {
    // 取候选队列（最多 20 个），逐个跳过冻结期账号，避免冻结任务卡死队列头
    const candidates = await this.prisma.executorTask.findMany({
      where: {
        userId,
        status: 'queued',
        OR: [{ deviceId: null }, { deviceId }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    if (candidates.length === 0) return null;
    const now = new Date();
    let candidate: (typeof candidates)[number] | null = null;
    for (const c of candidates) {
      // P0-1 恢复保护期：候选任务账号处于冻结期（心跳超时）时跳过，取下一个
      const candAccountId = this.extractAccountId(
        (c.payload as Record<string, unknown>) ?? {},
        c.type,
      );
      if (candAccountId) {
        const frozen = await this.prisma.executorLease.findFirst({
          where: {
            userId,
            accountId: candAccountId,
            frozenUntil: { gt: now },
          },
        });
        if (frozen) {
          this.logger.log(
            `候选任务 ${c.id} 账号 ${candAccountId} 处于恢复保护期，跳过`,
          );
          continue;
        }
      }
      candidate = c;
      break;
    }
    if (!candidate) return null;
    const row = await this.prisma.$transaction(async (tx) => {
      // 原子领取：仅当仍为 queued 时才更新（防止多设备并发重复领取同一任务）
      const claimed = await tx.executorTask.updateMany({
        where: { id: candidate.id, status: 'queued' },
        data: {
          status: 'leasing', // PRD 状态机：queued → leasing（领取租约态）
          deviceId,
          attempts: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (claimed.count === 0) return null;
      const claimedRow = await tx.executorTask.findUnique({
        where: { id: candidate.id },
      });
      if (!claimedRow) return null;
      // P1 Lease：领取后为账号建租约（默认 10 分钟，agent 心跳续租；终态回传释放）
      const leaseAccountId = this.extractAccountId(
        (claimedRow.payload as Record<string, unknown>) ?? {},
        claimedRow.type,
      );
      if (leaseAccountId) {
        await this.acquireLeaseTx(
          tx,
          userId,
          leaseAccountId,
          deviceId,
          claimedRow.id,
        );
      }
      return claimedRow;
    });
    if (!row) {
      // 已被其他设备抢走，递归取下一个
      return this.claimNext(userId, deviceId);
    }
    this.logger.log(`任务被领取：${row.id} ← 设备 ${deviceId}`);
    return this.toView(row);
  }

  /** 建/续租约（事务内；同账号同任务幂等） */
  private async acquireLeaseTx(
    tx: Prisma.TransactionClient,
    userId: string,
    accountId: string,
    deviceId: string,
    taskId: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟
    const existing = await tx.executorLease.findFirst({ where: { taskId } });
    if (existing) {
      await tx.executorLease.update({
        where: { id: existing.id },
        data: { status: 'active', expiresAt, deviceId, updatedAt: new Date() },
      });
      return;
    }
    await tx.executorLease.create({
      data: {
        userId,
        accountId,
        deviceId,
        taskId,
        status: 'active',
        expiresAt,
      },
    });
  }

  /** 活跃租约列表（设备中心展示：账号/设备/任务/过期时间） */
  async listActiveLeases(userId: string): Promise<
    Array<{
      id: string;
      accountId: string;
      deviceId: string;
      taskId: string;
      expiresAt: Date;
      createdAt: Date;
    }>
  > {
    const rows = await this.prisma.executorLease.findMany({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      deviceId: r.deviceId,
      taskId: r.taskId,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  /** 释放任务租约（终态回传时调用；executor-status 也调用） */
  async releaseLease(taskId: string): Promise<void> {
    await this.prisma.executorLease.updateMany({
      where: { taskId, status: 'active' },
      data: { status: 'released', updatedAt: new Date() },
    });
  }

  /** 提取账号标识（publish 任务 payload.accountId；custom 无） */
  private extractAccountId(
    payload: Record<string, unknown>,
    _type: string,
  ): string {
    // P1-16：custom（MAI-UI）任务也受账号租约保护——payload.accountId 存在即锁
    const v = payload['accountId'];
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  }

  /** 我的任务列表 */
  async listTasks(userId: string, limit = 20): Promise<TaskView[]> {
    const rows = await this.prisma.executorTask.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((r) => this.toView(r));
  }

  /** 取消排队中的任务 */
  async cancelTask(userId: string, taskId: string): Promise<{ ok: boolean }> {
    const row = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!row) throw new BadRequestException('任务不存在');
    // 只能取消未开始执行的任务（queued/leasing）或结果不确定待人工处理的任务（unknown）；
    // 执行中/终态不可取消
    const nStatus = normalizeStatus(row.status);
    if (
      nStatus !== 'queued' &&
      nStatus !== 'leasing' &&
      nStatus !== 'unknown'
    ) {
      throw new BadRequestException(`任务状态为 ${nStatus}，无法取消`);
    }
    await this.prisma.executorTask.update({
      where: { id: taskId },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
    // 修复：leasing/unknown 任务已建账号租约，取消必须同步释放，
    // 否则账号被锁到租约过期（10 分钟），同账号新任务被 400 拦截
    if (nStatus === 'leasing' || nStatus === 'unknown') {
      await this.releaseLease(taskId);
    }
    this.logger.log(`任务已取消：${taskId}`);
    return { ok: true };
  }

  private toView(row: {
    id: string;
    type: string;
    payload: unknown;
    status: string;
    createdAt: Date;
  }): TaskView {
    return {
      id: row.id,
      type: row.type,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
