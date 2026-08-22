import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 证据链（P1，PRD §6.6）：任务执行留证——截图/节点树/结果，
 * 供审计回溯（每次外发可查前后证据）。
 */
@Injectable()
export class ExecutorEvidenceService {
  private readonly logger = new Logger(ExecutorEvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 上传执行证据 */
  async addEvidence(
    userId: string,
    taskId: string,
    input: {
      type: string;
      stepIndex?: number;
      content: Record<string, unknown>;
    },
  ): Promise<{ id: string; taskId: string; type: string }> {
    const task = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new BadRequestException('任务不存在');
    const type = input.type || 'screenshot';
    const content = input.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new BadRequestException('证据内容不能为空');
    }
    // 截图证据：校验 dataURL 格式（可选，避免脏数据）
    if (type === 'screenshot') {
      const raw = content.dataUrl;
      const dataUrl = typeof raw === 'string' ? raw : '';
      if (!dataUrl.startsWith('data:image/')) {
        throw new BadRequestException(
          '截图证据需为 data:image/ 前缀的 dataURL',
        );
      }
      if (dataUrl.length > 2 * 1024 * 1024) {
        throw new BadRequestException('截图证据过大（>2MB）');
      }
    }
    const row = await this.prisma.executorEvidence.create({
      data: {
        userId,
        taskId,
        stepIndex: input.stepIndex ?? -1,
        type,
        content: content as never,
      },
    });
    this.logger.log(
      `任务证据已保存：${row.id}（${type}，任务 ${taskId.slice(-6)}）`,
    );
    return { id: row.id, taskId, type };
  }

  /** 查询任务证据（按时间正序） */
  async listEvidence(
    userId: string,
    taskId: string,
  ): Promise<
    Array<{
      id: string;
      stepIndex: number;
      type: string;
      content: unknown;
      createdAt: Date;
    }>
  > {
    const task = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new BadRequestException('任务不存在');
    const rows = await this.prisma.executorEvidence.findMany({
      where: { userId, taskId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      stepIndex: r.stepIndex,
      type: r.type,
      content: r.content,
      createdAt: r.createdAt,
    }));
  }
}
