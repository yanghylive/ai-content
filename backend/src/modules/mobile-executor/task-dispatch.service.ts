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

  /** 创建发布任务（schedule_publish 到点触发时调用） */
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

  /** agent 领取待办任务（未指定设备的可被任意设备领取；指定设备需匹配） */
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
    const claimed = await this.prisma.executorTask.update({
      where: { id: candidate.id },
      data: {
        status: 'claimed',
        deviceId,
        attempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    this.logger.log(`任务被领取：${claimed.id} ← 设备 ${deviceId}`);
    return this.toView(claimed);
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
