import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 证据链（P1，PRD §6.6）：任务执行留证——截图/节点树/结果，
 * 供审计回溯（每次外发可查前后证据）。
 */
@Injectable()
export class ExecutorEvidenceService {
  private readonly logger = new Logger(ExecutorEvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 上传执行证据（P1-18 审计链：SHA-256 摘要 + 前后关联 + 元数据） */
  async addEvidence(
    userId: string,
    taskId: string,
    input: {
      type: string;
      stepIndex?: number;
      content: Record<string, unknown>;
      deviceId?: string;
      modelVersion?: string;
      policyVersion?: string;
      approvalId?: string;
      collectedAt?: string;
    },
  ): Promise<{
    id: string;
    taskId: string;
    type: string;
    contentHash: string;
    prevEvidenceId: string | null;
  }> {
    const task = await this.prisma.executorTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) throw new BadRequestException('任务不存在');
    const type = input.type || 'screenshot';
    const content = input.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new BadRequestException('证据内容不能为空');
    }
    // 截图证据：校验 dataURL 格式（避免脏数据）
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
    // P1-18：内容 SHA-256 摘要（稳定序列化，防篡改/去重）
    const canonical = JSON.stringify(content);
    const contentHash = createHash('sha256').update(canonical).digest('hex');
    // 链式关联：取该任务上一条证据作为 prevEvidenceId
    const prev = await this.prisma.executorEvidence.findFirst({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
    });
    const collectedAt = input.collectedAt
      ? new Date(input.collectedAt)
      : new Date();
    const row = await this.prisma.executorEvidence.create({
      data: {
        userId,
        taskId,
        stepIndex: input.stepIndex ?? -1,
        type,
        content: content as never,
        contentHash,
        prevEvidenceId: prev?.id ?? null,
        deviceId: input.deviceId ?? null,
        modelVersion: input.modelVersion ?? null,
        policyVersion: input.policyVersion ?? null,
        approvalId: input.approvalId ?? null,
        collectedAt,
      },
    });
    this.logger.log(
      `任务证据已保存：${row.id}（${type}，hash ${contentHash.slice(0, 8)}，prev ${prev?.id?.slice(-6) ?? '-'}）`,
    );
    return {
      id: row.id,
      taskId,
      type,
      contentHash,
      prevEvidenceId: prev?.id ?? null,
    };
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
      contentHash: r.contentHash,
      prevEvidenceId: r.prevEvidenceId,
      deviceId: r.deviceId,
      modelVersion: r.modelVersion,
      policyVersion: r.policyVersion,
      approvalId: r.approvalId,
      collectedAt: r.collectedAt,
      createdAt: r.createdAt,
    }));
  }
}
