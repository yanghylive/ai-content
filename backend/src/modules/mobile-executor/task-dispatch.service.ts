import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { safeText } from '../../common/text.utils';
import { PrismaService } from '../../prisma/prisma.service';

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
      const active = await this.prisma.executorLease.findFirst({
        where: {
          userId,
          accountId: leaseAccountId,
          status: 'active',
          expiresAt: { gt: new Date() },
        },
      });
      if (active) {
        throw new BadRequestException(
          `账号 ${leaseAccountId} 已有任务执行中（租约 ${active.taskId}，设备 ${active.deviceId}），请等待完成或释放后重试`,
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

  /**
   * 发布任务 payload 契约（P5 C2 设计评估 §三）：
   * platform 白名单 / content 或 media 至少一个 / media 1-9 个 https URL / 总大小 < 10KB
   */
  private validatePayload(
    payload: Record<string, unknown>,
    type: string,
  ): void {
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

  /** agent 领取待办任务（原子化：updateMany 条件更新，并发安全） */
  async claimNext(userId: string, deviceId: string): Promise<TaskView | null> {
    const candidate = await this.prisma.executorTask.findFirst({
      where: {
        userId,
        status: 'queued',
        OR: [{ deviceId: null }, { deviceId }],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    // 原子领取：仅当仍为 queued 时才更新（防止多设备并发重复领取同一任务）
    const claimed = await this.prisma.executorTask.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: {
        status: 'claimed',
        deviceId,
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      // 已被其他设备抢走，递归取下一个
      return this.claimNext(userId, deviceId);
    }
    const row = await this.prisma.executorTask.findUnique({
      where: { id: candidate.id },
    });
    if (!row) return null;
    // P1 Lease：领取后为账号建租约（默认 10 分钟，agent 心跳续租；终态回传释放）
    const leaseAccountId = this.extractAccountId(
      (row.payload as Record<string, unknown>) ?? {},
      row.type,
    );
    if (leaseAccountId) {
      await this.acquireLease(userId, leaseAccountId, deviceId, row.id);
    }
    this.logger.log(`任务被领取：${row.id} ← 设备 ${deviceId}`);
    return this.toView(row);
  }

  /** 建/续租约（同账号同任务幂等） */
  private async acquireLease(
    userId: string,
    accountId: string,
    deviceId: string,
    taskId: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 分钟
    const existing = await this.prisma.executorLease.findFirst({
      where: { taskId },
    });
    if (existing) {
      await this.prisma.executorLease.update({
        where: { id: existing.id },
        data: { status: 'active', expiresAt, deviceId, updatedAt: new Date() },
      });
      return;
    }
    await this.prisma.executorLease.create({
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
    type: string,
  ): string {
    if (type !== 'publish') return '';
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
    if (row.status === 'running') {
      throw new BadRequestException('任务执行中，无法取消');
    }
    if (row.status !== 'queued' && row.status !== 'claimed') {
      throw new BadRequestException(`任务状态为 ${row.status}，无法取消`);
    }
    await this.prisma.executorTask.update({
      where: { id: taskId },
      data: { status: 'cancelled', updatedAt: new Date() },
    });
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
