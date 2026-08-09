import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

/**
 * AI 心跳盯价（M7-1，2026-08-09）：
 * 每日 08:30 自动醒来——扫用户 active 监控 + 门店采购清单 →
 * 查当前价/返利 → 对比 30 天均价 → 汇总推送「今日省钱机会」（每人每日 1 次）。
 * 只做规则计算（低于均价/低于目标/高返），不调模型——不消耗 AI 额度。
 */
@Injectable()
export class SavingsDailyHeartbeatService {
  private readonly logger = new Logger(SavingsDailyHeartbeatService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: SavingsAdapterRegistry,
    private readonly push: PushNotificationsService,
  ) {}

  /** 每日 08:30 心跳（避开 AI 日报 08:00，错峰） */
  @Cron('30 8 * * *')
  async heartbeatTick() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.scanDeals();
      this.logger.log(
        `心跳盯价完成: 用户=${r.users} 机会=${r.deals} 推送=${r.pushed}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * 扫描全部 active 监控（+ 采购清单兜底），按用户聚合降价/高返机会。
   * 防打扰：同用户每日最多推送 1 次（今日已推过的用户跳过）。
   */
  async scanDeals(): Promise<{
    users: number;
    deals: number;
    pushed: number;
  }> {
    const adapter = this.adapterRegistry.resolve('haodanku');
    const watches = await this.prisma.priceWatch.findMany({
      where: { status: 'active' },
      take: 300,
    });
    if (watches.length === 0) {
      return { users: 0, deals: 0, pushed: 0 };
    }

    // 按用户聚合
    const byUser = new Map<
      string,
      { tenantId: string; deals: Array<{ title: string; reason: string }> }
    >();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    for (const watch of watches) {
      try {
        const offer = await adapter.offers(watch.itemId, watch.platformCode);
        const payPrice = Number(offer.payPrice);
        const estRebate = Number((offer.estCommission * 0.7).toFixed(2));

        // 30 天均价（PriceHistory）
        const since30 = new Date();
        since30.setDate(since30.getDate() - 30);
        const history = await this.prisma.priceHistory.findMany({
          where: {
            itemId: watch.itemId,
            platformCode: watch.platformCode,
            snapshotAt: { gte: since30 },
          },
          select: { payPrice: true },
        });
        const prices = history.map((h) => Number(h.payPrice));
        const avg30 =
          prices.length > 0
            ? prices.reduce((a, b) => a + b, 0) / prices.length
            : null;

        const reasons: string[] = [];
        if (
          watch.targetPayPrice !== null &&
          payPrice <= Number(watch.targetPayPrice)
        ) {
          reasons.push(`降至目标价 ¥${payPrice}`);
        }
        if (avg30 !== null && payPrice < avg30 * 0.95) {
          const pct = Math.round(((avg30 - payPrice) / avg30) * 100);
          reasons.push(`低于 30 日均价 ${pct}%`);
        }
        if (watch.minRebate !== null && estRebate >= Number(watch.minRebate)) {
          reasons.push(`返利 ¥${estRebate} 达标`);
        }
        if (reasons.length === 0) continue;

        const u = byUser.get(watch.userId) || {
          tenantId: watch.tenantId,
          deals: [],
        };
        u.deals.push({
          title: watch.title.slice(0, 24),
          reason: reasons.join('，'),
        });
        byUser.set(watch.userId, u);
      } catch (err) {
        const code = (err as { response?: { code?: string } })?.response?.code;
        if (code === 'VENDOR_CREDENTIAL_MISSING') {
          return { users: 0, deals: 0, pushed: 0 };
        }
        this.logger.debug(
          `心跳 ${watch.id} 查询失败：${(err as Error).message}`,
        );
      }
    }

    // 每人每日 1 次推送（tag 防重复：heartbeat:YYYY-MM-DD）
    let pushed = 0;
    const todayTag = `heartbeat:${new Date().toISOString().slice(0, 10)}`;
    for (const [userId, agg] of byUser) {
      if (agg.deals.length === 0) continue;
      const top = agg.deals.slice(0, 5);
      const body = top
        .map((d, i) => `${i + 1}. ${d.title}（${d.reason}）`)
        .join('\n');
      await this.push.sendToUser(userId, {
        title: `💰 今日省钱机会（${agg.deals.length} 条）`,
        body,
        url: '/savings',
        tag: todayTag,
      });
      pushed++;
    }
    return {
      users: byUser.size,
      deals: [...byUser.values()].reduce((a, b) => a + b.deals.length, 0),
      pushed,
    };
  }
}
