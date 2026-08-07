import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
    const platform = String(payload.platform || '');
    const allowed = ['douyin', 'xiaohongshu', 'kuaishou', 'shipinhao'];
    if (!allowed.includes(platform)) {
      throw new BadRequestException(
        `不支持的平台（${platform || '空'}），应为 ${allowed.join('/')}`,
      );
    }
    const content = String(payload.content || '').trim();
    const media = Array.isArray(payload.media) ? payload.media : [];
    if (!content && media.length === 0) {
      throw new BadRequestException('content 与 media 至少需要一个');
    }
    if (media.length > 9) {
      throw new BadRequestException('media 最多 9 个素材');
    }
    for (const item of media) {
      const url = String((item as { url?: unknown })?.url || '');
      if (!/^https:\/\//.test(url)) {
        throw new BadRequestException(`素材 URL 必须为 https（${url.slice(0, 60)}）`);
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
    this.logger.log(`任务被领取：${row.id} ← 设备 ${deviceId}`);
    return this.toView(row);
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
