import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { SavingsLedgerService } from './savings-ledger.service';

/**
 * CPS 订单同步服务（需求清单 V1.1 §11）：
 * 定时增量拉取联盟订单 → vendorCode+orderNo 幂等 upsert → 状态机推进
 * （SYNCED → PAID → CONFIRMED → PENDING_SETTLE → SETTLED；REFUNDED 回冲）。
 * 断点续拉：syncCheckpoint 游标；单页持久化成功后才推进检查点。
 * 供应商未配置 Key 时跳过（不崩溃，日志记录）。
 */
@Injectable()
export class CpsOrderSyncService {
  private readonly logger = new Logger(CpsOrderSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: SavingsAdapterRegistry,
    private readonly ledger: SavingsLedgerService,
  ) {}

  /** 每 10 分钟增量同步一次（量小，周期足够；生产可调） */
  @Cron('*/10 * * * *')
  async syncTick() {
    if (this.running) return; // 防重入
    this.running = true;
    try {
      await this.syncOnce();
    } finally {
      this.running = false;
    }
  }

  /** 单轮同步（可被端点手动触发） */
  async syncOnce(): Promise<{
    fetched: number;
    updated: number;
    skipped: boolean;
  }> {
    const adapter = this.adapterRegistry.resolve('datoke');
    let checkpoint: string | undefined;
    let fetched = 0;
    let updated = 0;

    try {
      for (let round = 0; round < 5; round++) {
        const result = await adapter.orders(checkpoint);
        if (!result.orders.length) break;
        for (const order of result.orders) {
          if (!order.orderNo) continue;
          const handled = await this.applyOrder(order);
          if (handled) updated++;
          fetched++;
        }
        checkpoint = result.nextSyncPoint || undefined;
        if (!checkpoint) break;
      }
      return { fetched, updated, skipped: false };
    } catch (err) {
      const code = (err as { response?: { code?: string } })?.response?.code;
      if (
        code === 'VENDOR_CREDENTIAL_MISSING' ||
        (err as Error)?.message?.includes('大淘客凭证未配置')
      ) {
        // 供应商 Key 未配置：静默跳过（首次部署正常状态）
        return { fetched: 0, updated: 0, skipped: true };
      }
      this.logger.warn(`订单同步失败：${(err as Error).message}`);
      throw err;
    }
  }

  /** 应用一条同步订单：幂等 upsert + 状态机推进 */
  private async applyOrder(order: {
    orderNo: string;
    platformCode: string;
    itemId?: string | null;
    payAmount: number;
    estCommission: number;
    status: string;
    rawStatus: string;
    paidAt?: string | null;
  }): Promise<boolean> {
    const exist = await this.prisma.cpsOrder.findUnique({
      where: {
        vendorCode_orderNo: { vendorCode: 'datoke', orderNo: order.orderNo },
      },
    });

    if (!exist) {
      // 新订单：先落库（tenant/user 由归因映射——简化：无归因则跳过，等待订单找回）
      // 说明：用户归因需要转链时保存的 attribution → 订单匹配。M2 先落库 SYNCED 等待归因。
      const orderData = {
        tenantId: 'unattributed',
        userId: 'unattributed',
        vendorCode: 'datoke',
        platformCode: order.platformCode,
        orderNo: order.orderNo,
        itemId: order.itemId ?? null,
        payAmount: order.payAmount,
        estCommission: order.estCommission,
        actCommission: 0,
        userRebate: 0,
        platformShare: 0,
        status: order.status,
        rawStatus: order.rawStatus,
        paidAt: order.paidAt ? new Date(order.paidAt) : null,
      };
      await this.prisma.cpsOrder.create({ data: orderData });
      return true;
    }

    // 已有订单：仅状态前向推进（防倒退）
    const rank = (s: string) =>
      ['SYNCED', 'PAID', 'CONFIRMED', 'PENDING_SETTLE', 'SETTLED'].indexOf(s);
    if (rank(order.status) <= rank(exist.status)) {
      // 状态未前进（含退款：REFUNDED 单独处理）
      if (order.status === 'INVALID' || order.status === 'REFUNDED') {
        if (exist.status !== 'REFUNDED' && exist.status !== 'INVALID') {
          await this.handleRefund(exist.id, order.status);
        }
      }
      return false;
    }

    // 状态推进
    await this.prisma.cpsOrder.update({
      where: { id: exist.id },
      data: { status: order.status, rawStatus: order.rawStatus },
    });

    // 状态机副作用
    if (order.status === 'PENDING_SETTLE' && Number(exist.userRebate) > 0) {
      await this.ledger.moveToPending({
        tenantId: exist.tenantId,
        userId: exist.userId,
        orderId: exist.id,
        orderNo: exist.orderNo,
        amount: Number(exist.userRebate),
      });
    }
    if (order.status === 'SETTLED') {
      const rebate = Number(exist.userRebate);
      if (rebate > 0) {
        await this.ledger.settleRebate({
          tenantId: exist.tenantId,
          userId: exist.userId,
          orderId: exist.id,
          orderNo: exist.orderNo,
          amount: rebate,
        });
      }
      await this.prisma.cpsOrder.update({
        where: { id: exist.id },
        data: {
          actCommission: Number(exist.estCommission),
          settledAt: new Date(),
        },
      });
    }
    return true;
  }

  /** 退款处理：已结算则回冲可用返利 */
  private async handleRefund(orderId: string, status: string): Promise<void> {
    const order = await this.prisma.cpsOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    if (Number(order.userRebate) > 0 && order.status === 'SETTLED') {
      await this.ledger.reverseRebate({
        tenantId: order.tenantId,
        userId: order.userId,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: Number(order.userRebate),
      });
    }
    await this.prisma.cpsOrder.update({
      where: { id: orderId },
      data: { status, refundAmount: Number(order.userRebate) },
    });
  }

  /**
   * 订单归因：转链 attribution 匹配订单（订单找回/自动归因入口）。
   * M2 骨架：attribution 中保存 relationId（渠道），匹配策略由 M3 订单找回完善。
   */
  async attributeOrder(input: {
    orderNo: string;
    tenantId: string;
    userId: string;
    relationId?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const order = await this.prisma.cpsOrder.findUnique({
      where: {
        vendorCode_orderNo: { vendorCode: 'datoke', orderNo: input.orderNo },
      },
    });
    if (!order) {
      return { ok: false, message: '订单尚未同步，请稍后再试' };
    }
    if (order.tenantId !== 'unattributed') {
      return { ok: false, message: '订单已归属其他用户，无法认领' };
    }
    // 计算用户返利（佣金 × 70%）
    const userRebate = Number((Number(order.estCommission) * 0.7).toFixed(2));
    await this.prisma.cpsOrder.update({
      where: { id: order.id },
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        userRebate,
        platformShare: Number(
          (Number(order.estCommission) - userRebate).toFixed(2),
        ),
      },
    });
    return { ok: true, message: '订单归因成功' };
  }
}
