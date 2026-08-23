import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Run/Step 持久化（P1-12，PRD §6.6/§M1）：一次执行会话 + 单步记录，
 * 断点恢复基础——执行器每步上报，App 被杀后可从 checkpoint 恢复。
 */
@Injectable()
export class ExecutorRunService {
  private readonly logger = new Logger(ExecutorRunService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 开始一次执行（领取任务后执行前）；同任务已有活跃 run 则续用（幂等） */
  async startRun(
    userId: string,
    taskId: string,
    deviceId: string,
    accountId?: string,
  ): Promise<{ id: string; taskId: string; status: string }> {
    const task = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new BadRequestException('任务不存在');
    // 归属校验：任务已被其他设备 claim 时，当前设备无权开启 Run（防并发污染）
    if (task.deviceId && task.deviceId !== deviceId) {
      throw new BadRequestException(
        `任务由设备 ${task.deviceId} 执行，当前设备 ${deviceId} 无权开启执行会话`,
      );
    }
    const existing = await this.prisma.executorRun.findFirst({
      where: { taskId, status: { in: ['running', 'awaiting_approval'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, taskId, status: existing.status };
    }
    const run = await this.prisma.executorRun.create({
      data: { userId, taskId, deviceId, accountId: accountId ?? null },
    });
    this.logger.log(
      `执行会话开始：${run.id}（任务 ${taskId.slice(-6)}，设备 ${deviceId.slice(-6)}）`,
    );
    return { id: run.id, taskId, status: run.status };
  }

  /** 上报单步进度 + 更新断点 checkpoint */
  async stepRun(
    userId: string,
    runId: string,
    deviceId: string,
    input: {
      stepIndex: number;
      type: string;
      status?: string;
      detail?: Record<string, unknown>;
      checkpoint?: string;
    },
  ): Promise<{ id: string; runId: string; stepIndex: number }> {
    const run = await this.prisma.executorRun.findFirst({
      where: { id: runId, userId },
    });
    if (!run) throw new BadRequestException('执行会话不存在');
    // 归属校验：仅建立该 Run 的设备可上报 step（防同用户多设备串扰）
    if (run.deviceId && run.deviceId !== deviceId) {
      throw new BadRequestException(
        `执行会话由设备 ${run.deviceId} 执行，当前设备 ${deviceId} 无权上报步骤`,
      );
    }
    const status = input.status || 'done';
    const step = await this.prisma.executorStep.create({
      data: {
        runId,
        taskId: run.taskId,
        stepIndex: input.stepIndex,
        type: input.type,
        status,
        detail: (input.detail as never) ?? null,
      },
    });
    // 更新 checkpoint（断点：当前步 + 总步数由调用方传）
    await this.prisma.executorRun.update({
      where: { id: runId },
      data: {
        checkpoint: input.checkpoint ?? `${input.stepIndex}:${input.type}`,
      },
    });
    return { id: step.id, runId, stepIndex: input.stepIndex };
  }

  /** 终态收尾（completed/failed/unknown） */
  async finishRun(
    userId: string,
    runId: string,
    deviceId: string,
    status: 'completed' | 'failed' | 'unknown',
    checkpoint?: string,
  ): Promise<{ id: string; status: string }> {
    const run = await this.prisma.executorRun.findFirst({
      where: { id: runId, userId },
    });
    if (!run) throw new BadRequestException('执行会话不存在');
    // 归属校验：仅建立该 Run 的设备可收尾
    if (run.deviceId && run.deviceId !== deviceId) {
      throw new BadRequestException(
        `执行会话由设备 ${run.deviceId} 执行，当前设备 ${deviceId} 无权收尾`,
      );
    }
    // 状态机：终态不可覆盖（防网络重试把 completed 覆盖成 failed，污染追溯）
    if (['completed', 'failed', 'unknown'].includes(run.status)) {
      throw new BadRequestException(
        `执行会话已处于终态 ${run.status}，不可重复收尾`,
      );
    }
    const updated = await this.prisma.executorRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        ...(checkpoint ? { checkpoint } : {}),
      },
    });
    return { id: updated.id, status: updated.status };
  }

  /** 更新执行会话状态（P1-11：ask_user 时 awaiting_approval，恢复时 running） */
  async setStatus(
    userId: string,
    runId: string,
    deviceId: string,
    status: 'running' | 'awaiting_approval',
  ): Promise<{ id: string; status: string }> {
    if (status !== 'running' && status !== 'awaiting_approval') {
      throw new BadRequestException(`非法状态：${String(status)}`);
    }
    const run = await this.prisma.executorRun.findFirst({
      where: { id: runId, userId },
    });
    if (!run) throw new BadRequestException('执行会话不存在');
    // 归属校验：仅建立该 Run 的设备可更新状态
    if (run.deviceId && run.deviceId !== deviceId) {
      throw new BadRequestException(
        `执行会话由设备 ${run.deviceId} 执行，当前设备 ${deviceId} 无权更新状态`,
      );
    }
    // 状态机：终态不可恢复为 running/awaiting_approval
    if (['completed', 'failed', 'unknown'].includes(run.status)) {
      throw new BadRequestException(
        `执行会话已处于终态 ${run.status}，不可更新为 ${status}`,
      );
    }
    const updated = await this.prisma.executorRun.update({
      where: { id: runId },
      data: { status },
    });
    return { id: updated.id, status: updated.status };
  }

  /** 查询执行会话（断点恢复：设备重启后按 taskId 找最近 run + checkpoint） */
  async getRun(
    userId: string,
    taskId: string,
  ): Promise<{
    id: string;
    taskId: string;
    deviceId: string;
    status: string;
    checkpoint: string | null;
    steps: Array<{
      stepIndex: number;
      type: string;
      status: string;
      createdAt: Date;
    }>;
  } | null> {
    const run = await this.prisma.executorRun.findFirst({
      where: { taskId, userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;
    const steps = await this.prisma.executorStep.findMany({
      where: { runId: run.id },
      orderBy: { stepIndex: 'asc' },
    });
    return {
      id: run.id,
      taskId: run.taskId,
      deviceId: run.deviceId,
      status: run.status,
      checkpoint: run.checkpoint,
      steps: steps.map((s) => ({
        stepIndex: s.stepIndex,
        type: s.type,
        status: s.status,
        createdAt: s.createdAt,
      })),
    };
  }
}
