import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';

/**
 * 价格/返利监控调度（需求清单 V1.1 §8）：
 * 定时扫描 active 监控 → 查当前价/返利 → 达标触发通知（防重复：lastNotifiedAt）。
 * 规则引擎执行高频监控，AI 只用于异常解释——不消耗模型额度。
 * 供应商未配置 Key 时跳过。
 */
@Injectable()
export class PriceWatchSchedulerService {
  private readonly logger = new Logger(PriceWatchSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterRegistry: SavingsAdapterRegistry,
    private readonly push: PushNotificationsService,
  ) {}

  /** 每 30 分钟扫描一次（P0 量小；监控任务多了可缩小间隔） */
  @Cron('0 */30 * * * *')
  async watchTick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkAll();
    } finally {
      this.running = false;
    }
  }

  /** 扫描全部 active 监控并触发达标通知 */
  async checkAll(): Promise<{
    checked: number;
    notified: number;
    skipped: boolean;
  }> {
    const adapter = this.adapterRegistry.resolve('haodanku');
    const watches = await this.prisma.priceWatch.findMany({
      where: { status: 'active' },
      take: 200,
    });
    let notified = 0;

    for (const watch of watches) {
      try {
        const offer = await adapter.offers(watch.itemId, watch.platformCode);
        const payPrice = Number(offer.payPrice);
        const estRebate = Number((offer.estCommission * 0.7).toFixed(2));

        // M7-3：记录价格历史（每天一条，unique(itemId+platformCode+snapshotAt)）
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        await this.prisma.priceHistory.upsert({
          where: {
            itemId_platformCode_snapshotAt: {
              itemId: watch.itemId,
              platformCode: watch.platformCode,
              snapshotAt: dayStart,
            },
          },
          create: {
            tenantId: watch.tenantId,
            userId: watch.userId,
            watchId: watch.id,
            itemId: watch.itemId,
            platformCode: watch.platformCode,
            title: watch.title,
            price: offer.price,
            couponAmount: offer.couponAmount,
            payPrice: offer.payPrice,
            commissionRate: offer.commissionRate,
            estCommission: offer.estCommission,
            snapshotAt: dayStart,
          },
          update: {
            price: offer.price,
            couponAmount: offer.couponAmount,
            payPrice: offer.payPrice,
            commissionRate: offer.commissionRate,
            estCommission: offer.estCommission,
          },
        });

        const hitTarget =
          (watch.targetPayPrice !== null &&
            payPrice <= Number(watch.targetPayPrice)) ||
          (watch.minRebate !== null && estRebate >= Number(watch.minRebate));

        if (hitTarget) {
          const done = await this.notify(
            {
              id: watch.id,
              tenantId: watch.tenantId,
              userId: watch.userId,
              title: watch.title,
              targetPayPrice: watch.targetPayPrice
                ? Number(watch.targetPayPrice)
                : null,
              minRebate: watch.minRebate ? Number(watch.minRebate) : null,
              lastNotifiedAt: watch.lastNotifiedAt,
            },
            offer,
          );
          if (done) notified++;
        }
      } catch (err) {
        const code = (err as { response?: { code?: string } })?.response?.code;
        if (code === 'VENDOR_CREDENTIAL_MISSING') {
          return { checked: 0, notified: 0, skipped: true };
        }
        this.logger.debug(
          `监控 ${watch.id} 查询失败：${(err as Error).message}`,
        );
      }
    }
    return { checked: watches.length, notified, skipped: false };
  }

  /** 发送达标通知 + 更新 lastNotifiedAt（防重复提醒） */
  private async notify(
    watch: {
      id: string;
      tenantId: string;
      userId: string;
      title: string;
      targetPayPrice: number | null;
      minRebate: number | null;
      lastNotifiedAt: Date | null;
    },
    offer: { payPrice: number; estCommission: number },
  ): Promise<boolean> {
    // 防重复：同监控 6 小时内只提醒一次
    if (
      watch.lastNotifiedAt &&
      Date.now() - watch.lastNotifiedAt.getTime() < 6 * 3600 * 1000
    ) {
      return false;
    }
    const estRebate = Number((offer.estCommission * 0.7).toFixed(2));
    const parts: string[] = [];
    if (watch.targetPayPrice !== null) {
      parts.push(`支付价 ¥${offer.payPrice} ≤ 目标 ¥${watch.targetPayPrice}`);
    }
    if (watch.minRebate !== null) {
      parts.push(`预计返利 ¥${estRebate} ≥ 目标 ¥${watch.minRebate}`);
    }
    await this.push.sendToUser(watch.userId, {
      title: `💰 ${watch.title} 降价提醒`,
      body: parts.join('；'),
      url: '/savings',
      tag: `watch:${watch.id}`,
    });
    await this.prisma.priceWatch.update({
      where: { id: watch.id },
      data: { lastNotifiedAt: new Date() },
    });
    return true;
  }
}
