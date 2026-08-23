import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import OSS from 'ali-oss';
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
    let content = input.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new BadRequestException('证据内容不能为空');
    }
    let contentHash: string;
    // 截图证据：校验 dataURL + 上传 OSS（DB 只存 URL）+ 二进制内容 hash
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
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const buf = Buffer.from(b64, 'base64');
      // 内容 hash 基于截图二进制（真正防篡改）
      contentHash = createHash('sha256').update(buf).digest('hex');
      // P1-19：上传 OSS，DB 存 URL；失败降级存 dataUrl（不丢证据）
      const url = await this.uploadScreenshotToOss(
        taskId,
        buf,
        input.stepIndex ?? -1,
      );
      const meta = { ...content };
      delete meta.dataUrl;
      content = url
        ? { ...meta, url, imageHash: contentHash, storage: 'oss' }
        : { ...content, storage: 'db-fallback' };
    } else {
      // 非截图：hash 基于 JSON 序列化
      contentHash = createHash('sha256')
        .update(JSON.stringify(content))
        .digest('hex');
    }
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

  /** 截图上传 OSS（P1-19：DB 只存 URL）；OSS 未配置/失败返回 null 走降级 */
  private async uploadScreenshotToOss(
    taskId: string,
    buf: Buffer,
    stepIndex: number,
  ): Promise<string | null> {
    const id = process.env.OSS_ACCESS_KEY_ID;
    const secret = process.env.OSS_ACCESS_KEY_SECRET;
    if (!id || !secret) return null;
    const bucket = process.env.OSS_BUCKET || 'kaypal';
    const region = process.env.OSS_REGION || 'oss-cn-hangzhou';
    const ymd = new Date().toISOString().slice(0, 10);
    const step = stepIndex >= 0 ? stepIndex : 'task';
    const key = `executor-evidence/${ymd}/${taskId}/${step}-${Date.now()}.jpg`;
    try {
      const client = new OSS({
        accessKeyId: id,
        accessKeySecret: secret,
        region,
        bucket,
        secure: true,
      });
      await client.put(key, buf);
      return `https://${bucket}.${region}.aliyuncs.com/${key}`;
    } catch (e) {
      this.logger.warn(
        `截图上传 OSS 失败（降级存 DB）：${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
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
