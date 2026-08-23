import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 执行状态回传（C 组/P5，主文档 4.3 C3 executor-status）
 * agent 执行任务后回传结果（发布链接/失败原因），更新任务状态机。
 */
@Injectable()
export class ExecutorStatusService {
  private readonly logger = new Logger(ExecutorStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 回传任务状态（running/done/failed/unknown） */
  async report(
    userId: string,
    taskId: string,
    input: {
      status: 'running' | 'done' | 'failed' | 'unknown';
      result?: Record<string, unknown>;
      error?: string;
      deviceId?: string;
    },
  ): Promise<{ id: string; status: string }> {
    const row = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!row) throw new BadRequestException('任务不存在');
    // P0-5 归属校验：任务已被某设备 claim 时，仅该设备可回传状态
    if (row.deviceId && input.deviceId && row.deviceId !== input.deviceId) {
      throw new BadRequestException(
        `任务由设备 ${row.deviceId} 执行，当前设备 ${input.deviceId} 无权回传状态`,
      );
    }

    const data: Record<string, unknown> = {
      status: input.status,
      updatedAt: new Date(),
    };
    if (input.status === 'done') {
      data.executedAt = new Date();
      data.result = input.result ?? {};
    }
    if (input.status === 'failed' || input.status === 'unknown') {
      // P0-7：unknown 表达「发送结果不确定」，禁止自动重试，不释放租约（人工回读后定论）
      data.result = {
        error: input.error ?? '执行失败',
        unknown: input.status === 'unknown',
      };
    }
    const updated = await this.prisma.executorTask.update({
      where: { id: taskId },
      data: data as never,
    });
    // P1 Lease：终态（done/failed）释放账号租约；unknown 保留租约待人工确认
    if (input.status === 'done' || input.status === 'failed') {
      await this.prisma.executorLease.updateMany({
        where: { taskId, status: 'active' },
        data: { status: 'released', updatedAt: new Date() },
      });
    }
    this.logger.log(
      `任务状态回传：${taskId} → ${input.status}${input.error ? `（${input.error.slice(0, 80)}）` : ''}`,
    );
    return { id: updated.id, status: updated.status };
  }
}
