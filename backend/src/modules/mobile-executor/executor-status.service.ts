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

  /** 回传任务状态（running/done/failed） */
  async report(
    userId: string,
    taskId: string,
    input: {
      status: 'running' | 'done' | 'failed';
      result?: Record<string, unknown>;
      error?: string;
    },
  ): Promise<{ id: string; status: string }> {
    const row = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!row) throw new BadRequestException('任务不存在');

    const data: Record<string, unknown> = {
      status: input.status,
      updatedAt: new Date(),
    };
    if (input.status === 'done') {
      data.executedAt = new Date();
      data.result = (input.result ?? {}) as never;
    }
    if (input.status === 'failed') {
      data.result = { error: input.error ?? '执行失败' } as never;
    }
    const updated = await this.prisma.executorTask.update({
      where: { id: taskId },
      data: data as never,
    });
    this.logger.log(
      `任务状态回传：${taskId} → ${input.status}${input.error ? `（${input.error.slice(0, 80)}）` : ''}`,
    );
    return { id: updated.id, status: updated.status };
  }
}
