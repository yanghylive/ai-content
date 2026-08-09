import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { SavingsAdapterRegistry } from './savings-adapter/adapter.registry';
import { CpsOrderSyncService } from './cps-order-sync.service';
import type {
  OfferSnapshot,
  OfferView,
  RebateBalanceView,
} from './savings.types';

/** 用户返利比例（V1.1 §9 毛利模型默认 70%，可后台配置） */
const USER_REBATE_RATE = 0.7;

/**
 * 智能省钱返利核心服务（需求清单 V1.1）：
 * 商品解析/搜索/比价（预计净成本）、价格监控、返利余额视图。
 * 供应商不可知——全部走 SavingsAdapterRegistry。
 */
@Injectable()
export class SavingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly adapterRegistry: SavingsAdapterRegistry,
    private readonly orderSync: CpsOrderSyncService,
  ) {}

  /** 解析当前请求的用户 + 租户（复用全局租户上下文） */
  private async resolveScope() {
    const context = this.authRequestContext.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后使用省钱返利');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /** 商品快照 → 视图（补预计返利 + 预计净成本） */
  private toOfferView(s: OfferSnapshot): OfferView {
    const estRebate = Number((s.estCommission * USER_REBATE_RATE).toFixed(2));
    const estNetCost = Number(
      (s.payPrice + s.freight - s.couponAmount - estRebate).toFixed(2),
    );
    return { ...s, estRebate, estNetCost };
  }

  /** 落库商品快照（对账与历史参考用） */
  private async persistSnapshot(s: OfferSnapshot): Promise<void> {
    try {
      await this.prisma.offerSnapshot.create({
        data: {
          vendorCode: s.vendorCode,
          platformCode: s.platformCode,
          itemId: s.itemId,
          title: s.title,
          shopName: s.shopName,
          price: s.price,
          couponAmount: s.couponAmount,
          payPrice: s.payPrice,
          commissionRate: s.commissionRate,
          estCommission: s.estCommission,
          freight: s.freight,
          imageUrl: s.imageUrl,
          rawJson: s.rawJson as never,
        },
      });
    } catch {
      // 快照落库失败不阻塞主流程（对账数据可从 rawJson 重算）
    }
  }

  /** 解析链接/口令/分享文本 → 商品卡 */
  async parse(raw: string): Promise<OfferView> {
    const adapter = this.adapterRegistry.resolve();
    const snapshot = await adapter.parse(raw);
    await this.persistSnapshot(snapshot);
    return this.toOfferView(snapshot);
  }

  /** 关键词搜索（多平台） */
  async search(keyword: string, platform?: string): Promise<OfferView[]> {
    const adapter = this.adapterRegistry.resolve();
    const snapshots = await adapter.search(keyword, platform);
    const views = snapshots.map((s) => this.toOfferView(s));
    // 落库前 10 条快照供历史参考
    for (const s of snapshots.slice(0, 10)) {
      await this.persistSnapshot(s);
    }
    return views;
  }

  /** 商品详情 + 优惠券 + 返利（比价结果） */
  async offers(itemId: string, platform: string): Promise<OfferView> {
    const adapter = this.adapterRegistry.resolve();
    const snapshot = await adapter.offers(itemId, platform);
    await this.persistSnapshot(snapshot);
    return this.toOfferView(snapshot);
  }

  /** 创建价格/返利监控 */
  async createWatch(input: {
    itemId: string;
    platformCode: string;
    title: string;
    targetPayPrice?: number;
    minRebate?: number;
    notifyWindows?: string;
  }) {
    const { tenantId, userId } = await this.resolveScope();
    const watch = await this.prisma.priceWatch.create({
      data: {
        tenantId,
        userId,
        itemId: input.itemId,
        platformCode: input.platformCode,
        title: input.title,
        targetPayPrice: input.targetPayPrice ?? null,
        minRebate: input.minRebate ?? null,
        notifyWindows: input.notifyWindows ?? null,
        status: 'active',
      },
    });
    return watch;
  }

  /** 监控列表（当前用户） */
  async listWatches() {
    const { tenantId, userId } = await this.resolveScope();
    return this.prisma.priceWatch.findMany({
      where: { tenantId, userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 停用监控（需二次确认的前端交互） */
  async disableWatch(id: string) {
    const { tenantId, userId } = await this.resolveScope();
    return this.prisma.priceWatch.updateMany({
      where: { id, tenantId, userId },
      data: { status: 'disabled' },
    });
  }

  /** 返利余额视图（预计/待结算/可用/冻结/累计） */
  async rebateBalance(): Promise<RebateBalanceView> {
    const { tenantId, userId } = await this.resolveScope();
    // 账户不存在则返回零余额（首次访问自动建账户由结算时创建）
    const account = await this.prisma.rebateAccount.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    // 预计 = 待结算订单的预估佣金 × 返利比例
    const pendingOrders = await this.prisma.cpsOrder.aggregate({
      where: {
        tenantId,
        userId,
        status: { in: ['PAID', 'CONFIRMED', 'PENDING_SETTLE'] },
      },
      _sum: { estCommission: true },
    });
    const estimated = Number(
      (
        Number(pendingOrders._sum.estCommission || 0) * USER_REBATE_RATE
      ).toFixed(2),
    );
    return {
      estimated,
      pending: Number(account?.pending || 0),
      available: Number(account?.available || 0),
      frozen: Number(account?.frozen || 0),
      totalEarned: Number(account?.totalEarned || 0),
    };
  }

  /** 我的订单列表（分页） */
  async listOrders(status?: string, page = 1) {
    const { tenantId, userId } = await this.resolveScope();
    const where = {
      tenantId,
      userId,
      ...(status ? { status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.cpsOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: (page - 1) * 20,
        select: {
          id: true,
          orderNo: true,
          platformCode: true,
          itemId: true,
          payAmount: true,
          estCommission: true,
          userRebate: true,
          status: true,
          paidAt: true,
          settledAt: true,
          createdAt: true,
        },
      }),
      this.prisma.cpsOrder.count({ where }),
    ]);
    return { items, total, page, pageSize: 20 };
  }

  /** 订单找回/归因（走 CpsOrderSyncService） */
  claimOrder(orderNo: string, relationId?: string) {
    return this.resolveScope().then(({ tenantId, userId }) =>
      this.orderSync.attributeOrder({ orderNo, tenantId, userId, relationId }),
    );
  }
}
