// 发布对账（开发文档 §9.2 尾 + §16，统一开发计划 §九，Sprint 3 T3.5）
// 外部发送成功但本地写库失败 → reconcile_required，按 external ID 查回最终状态，不自动重发。
// 超过 15 分钟未解决 → 告警标记（needsManual）。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const RECONCILE_TIMEOUT_MS = 15 * 60_000; // 15 分钟未解决告警

export interface ReconcileResult {
  scanned: number;
  resolved: number;
  stillPending: number;
  needsManual: number;
}

@Injectable()
export class PublishReconcileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 单个任务按 externalPostId 查回（外部成功本地失败时）。
   * 规则：外部已确认（externalPostId/externalUrl 存在）→ succeeded；
   *       本地 receipt readback_state=verified → succeeded；
   *       其余 → still_pending / needs_manual。
   */
  async reconcileJob(input: {
    tenantId: string;
    jobId: string;
    /** 可选：平台侧查回结果（适配器注入；null 表示查不到） */
    externalState?: { found: boolean; externalPostId?: string; externalUrl?: string } | null;
  }): Promise<{ status: 'succeeded' | 'failed_permanent' | 'still_pending' | 'needs_manual' }> {
    const job = await this.prisma.publishJob.findUnique({
      where: { id: input.jobId },
      include: { receipts: true },
    });
    if (!job || job.tenantId !== input.tenantId) {
      return { status: 'needs_manual' };
    }

    // 外部查回结果优先（平台侧最终状态）
    if (input.externalState) {
      if (input.externalState.found) {
        // 外部成功：写 receipt，job 转 succeeded（不重发，只对账）
        const receipt = job.receipts[0];
        if (receipt) {
          await this.prisma.publishReceipt.update({
            where: { id: receipt.id },
            data: {
              externalPostId: input.externalState.externalPostId ?? receipt.externalPostId,
              externalUrl: input.externalState.externalUrl ?? receipt.externalUrl,
              readbackState: 'verified',
              readbackAt: new Date(),
            },
          });
        }
        await this.prisma.publishJob.update({
          where: { id: job.id },
          data: { status: 'succeeded' },
        });
        return { status: 'succeeded' };
      }
      return { status: 'still_pending' };
    }

    // 无外部查询：按本地 receipt 判断
    const receipt = job.receipts[0];
    if (receipt?.readbackState === 'verified' && (receipt.externalPostId || receipt.externalUrl)) {
      await this.prisma.publishJob.update({
        where: { id: job.id },
        data: { status: 'succeeded' },
      });
      return { status: 'succeeded' };
    }

    // 超时未解决 → needs_manual（告警）
    const stale = Date.now() - job.updatedAt.getTime() > RECONCILE_TIMEOUT_MS;
    return stale ? { status: 'needs_manual' } : { status: 'still_pending' };
  }

  /**
   * 扫描 readback_pending / reconcile_required 的任务，批量对账。
   * adapter 由上层注入（本服务不直接调平台，避免循环依赖）。
   */
  async reconcile(input: {
    tenantId: string;
    maxAge?: number;
    externalLookup?: (job: { id: string; idempotencyKey: string; variantId: string | null }) => Promise<{
      found: boolean;
      externalPostId?: string;
      externalUrl?: string;
    } | null>;
  }): Promise<ReconcileResult> {
    const since = input.maxAge ? new Date(Date.now() - input.maxAge) : undefined;
    const jobs = await this.prisma.publishJob.findMany({
      where: {
        tenantId: input.tenantId,
        status: { in: ['readback_pending', 'reconcile_required'] },
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      include: { receipts: true },
      take: 100,
    });

    let resolved = 0;
    let stillPending = 0;
    let needsManual = 0;

    for (const job of jobs) {
      let externalState: { found: boolean; externalPostId?: string; externalUrl?: string } | null | undefined;
      if (input.externalLookup) {
        externalState = await input.externalLookup({
          id: job.id,
          idempotencyKey: job.idempotencyKey,
          variantId: job.variantId,
        });
      }
      const r = await this.reconcileJob({
        tenantId: input.tenantId,
        jobId: job.id,
        ...(externalState ? { externalState } : {}),
      });
      if (r.status === 'succeeded' || r.status === 'failed_permanent') resolved += 1;
      else if (r.status === 'needs_manual') needsManual += 1;
      else stillPending += 1;
    }

    return { scanned: jobs.length, resolved, stillPending, needsManual };
  }
}
