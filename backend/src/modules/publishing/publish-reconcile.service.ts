// 发布对账（开发文档 §9.2 尾 + §16，统一开发计划 §九，Sprint 3 T3.5）
// 外部发送成功但本地写库失败 → 状态停留 readback_pending，按 external 查回最终状态，不自动重发。
// 超过 15 分钟未解决 → 告警标记（readbackState=uncertain，需人工）。
// 定时对账：每 5 分钟扫描 readback_pending 的发布记录。
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

export const RECONCILE_TIMEOUT_MS = 15 * 60_000; // 15 分钟未解决告警

export interface ReconcileResult {
  scanned: number;
  resolved: number;
  stillPending: number;
  needsManual: number;
}

export interface ReconcileExternalState {
  found: boolean;
  externalUrl?: string;
}

@Injectable()
export class PublishReconcileService {
  private readonly logger = new Logger(PublishReconcileService.name);

  /** 进程内防重入标志：外部查回较慢时避免 5 分钟定时任务重叠执行 */
  private reconcileRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  /** 定时对账：每 5 分钟扫一批 readback_pending 的发布记录 */
  @Cron('0 */5 * * * *')
  async scheduledReconcile(): Promise<void> {
    if (this.reconcileRunning) return;
    this.reconcileRunning = true;
    try {
      const result = await this.reconcile({});
      if (result.scanned > 0) {
        this.logger.log(
          `发布对账：扫描 ${result.scanned}，解决 ${result.resolved}，待处理 ${result.stillPending}，需人工 ${result.needsManual}`,
        );
      }
    } catch (error) {
      this.logger.warn(`发布对账批次失败：${(error as Error).message}`);
    } finally {
      this.reconcileRunning = false;
    }
  }

  /**
   * 批量对账 readback_pending 的发布记录。
   * 规则：
   *   外部查回 found → status=success + readbackState=verified；
   *   本地 readbackState=verified 且有 publishUrl → status=success；
   *   超时未解决 → readbackState=uncertain（needs_manual，不自动重发）。
   */
  async reconcile(
    input: {
      tenantId?: string;
      externalLookup?: (record: {
        id: string;
        platform: string;
        publishUrl: string | null;
      }) => Promise<ReconcileExternalState | null>;
    } = {},
  ): Promise<ReconcileResult> {
    // 扫描所有 readback_pending（不按 updatedAt 过滤「窗口」），
    // 超时判断在循环内用 RECONCILE_TIMEOUT_MS 处理：超时 → uncertain/needs_manual。
    // 之前 maxAge 被误当作扫描窗口（updatedAt >= since），导致 15 分钟前的超时记录永远扫不到。
    const records = await this.prisma.publishRecord.findMany({
      where: {
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        status: 'readback_pending',
      },
      orderBy: { updatedAt: 'asc' },
      take: 100,
    });

    let resolved = 0;
    let stillPending = 0;
    let needsManual = 0;

    for (const record of records) {
      let external: ReconcileExternalState | null = null;
      if (input.externalLookup) {
        try {
          external = await input.externalLookup({
            id: record.id,
            platform: record.platform,
            publishUrl: record.publishUrl,
          });
        } catch (error) {
          this.logger.warn(
            `发布对账外部查回失败（${record.id}）：${(error as Error).message}`,
          );
        }
      }

      if (external?.found) {
        await this.prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: 'success',
            readbackState: 'verified',
            publishUrl: external.externalUrl ?? record.publishUrl,
          },
        });
        resolved += 1;
        continue;
      }

      if (record.readbackState === 'verified' && record.publishUrl) {
        await this.prisma.publishRecord.update({
          where: { id: record.id },
          data: { status: 'success' },
        });
        resolved += 1;
        continue;
      }

      const stale =
        Date.now() - record.updatedAt.getTime() > RECONCILE_TIMEOUT_MS;
      if (stale) {
        await this.prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            readbackState: 'uncertain',
            errorMessage:
              record.errorMessage ?? '发布对账超时，需人工确认外部发布状态',
          },
        });
        needsManual += 1;
      } else {
        stillPending += 1;
      }
    }

    return { scanned: records.length, resolved, stillPending, needsManual };
  }
}
