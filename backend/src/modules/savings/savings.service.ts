import { createHash } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
  private readonly logger = new Logger(SavingsService.name);
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
  /** 从标题解析规格数量（如「12罐」「24包」「6瓶」→ 数量），用于单件价换算 */
  private parseSpecQty(title: string): number | undefined {
    const m = title.match(
      /(\d+)\s*(件|罐|包|瓶|盒|袋|支|片|卷|提|箱|双|个|只|颗|枚)/,
    );
    if (!m) return undefined;
    const qty = Number(m[1]);
    return qty > 1 && qty <= 1000 ? qty : undefined;
  }

  private toOfferView(s: OfferSnapshot): OfferView {
    const estRebate = Number((s.estCommission * USER_REBATE_RATE).toFixed(2));
    const estNetCost = Number(
      (s.payPrice + s.freight - s.couponAmount - estRebate).toFixed(2),
    );
    const specQty = this.parseSpecQty(s.title);
    const unitPrice =
      specQty && s.payPrice > 0
        ? Number((s.payPrice / specQty).toFixed(2))
        : undefined;
    return { ...s, estRebate, estNetCost, specQty, unitPrice };
  }

  /** 标题归一化 → SKU 归并键（去空格/符号/平台标识，小写；P0b 商品主档） */
  private normalizeTitleKey(title: string): string {
    return title
      .toLowerCase()
      .replace(/[【】[\]（）()｜|,，。·、\s_-]+/g, '')
      .replace(
        /(淘宝|天猫|京东|拼多多|官方旗舰店|旗舰店|专卖店|专营店|正品|包邮)/g,
        '',
      )
      .slice(0, 60);
  }

  /** 落库商品快照 + SKU 归并（P0b：归一化标题 → ProductMaster → 快照关联 masterId） */
  private async persistSnapshot(s: OfferSnapshot): Promise<void> {
    try {
      const master = await this.prisma.productMaster.upsert({
        where: { titleKey: this.normalizeTitleKey(s.title) },
        update: {},
        create: {
          name: s.title.slice(0, 100),
          titleKey: this.normalizeTitleKey(s.title),
          spec: this.parseSpecQty(s.title)
            ? `${this.parseSpecQty(s.title)}件装`
            : null,
        },
      });
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
          masterId: master.id,
        },
      });
    } catch {
      // 快照落库失败不阻塞主流程（对账数据可从 rawJson 重算）
    }
  }

  /** 同款跨平台对比（SKU 主档，P0b）：按关键词搜索 → 归并展示 */
  async skuCompare(keyword: string) {
    const adapter = this.adapterRegistry.resolve('haodanku');
    const snapshots = await adapter.search(keyword);
    const views = snapshots.map((s) => this.toOfferView(s));
    // 按归一化标题归并分组
    const groups = new Map<string, OfferView[]>();
    for (const v of views) {
      const key = this.normalizeTitleKey(v.title);
      const list = groups.get(key) || [];
      list.push(v);
      groups.set(key, list);
    }
    return Array.from(groups.values())
      .map((list) => {
        const sorted = [...list].sort((a, b) => a.estNetCost - b.estNetCost);
        const cheapest = sorted[0];
        const priciest = sorted[sorted.length - 1];
        const priceGap =
          sorted.length > 1
            ? Number((priciest.estNetCost - cheapest.estNetCost).toFixed(2))
            : 0;
        return {
          masterTitle: list[0].title,
          offers: list.map((o) => ({
            platformCode: o.platformCode,
            shopName: o.shopName,
            payPrice: o.payPrice,
            unitPrice: o.unitPrice,
            estRebate: o.estRebate,
            estNetCost: o.estNetCost,
            commissionRate: o.commissionRate,
          })),
          best: cheapest,
          cheapest: {
            platformCode: cheapest.platformCode,
            estNetCost: cheapest.estNetCost,
            payPrice: cheapest.payPrice,
          },
          priceGap,
          total: list.length,
        };
      })
      .sort((a, b) => a.best.estNetCost - b.best.estNetCost);
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
    // M7-2 自动跟踪：搜索结果 top1 自动落 price_watch（source=auto，纯跟踪供心跳/价格历史）
    if (process.env.SAVINGS_AUTO_WATCH !== 'off' && views.length > 0) {
      try {
        const { tenantId, userId } = await this.resolveScope();
        const top = views[0];
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        // 同用户同商品已有监控则不重复建（幂等）
        const existWatch = await this.prisma.priceWatch.findFirst({
          where: {
            tenantId,
            userId,
            itemId: top.itemId,
            platformCode: top.platformCode,
          },
          select: { id: true },
        });
        if (!existWatch) {
          await this.prisma.priceWatch.create({
            data: {
              tenantId,
              userId,
              itemId: top.itemId,
              platformCode: top.platformCode,
              title: top.title.slice(0, 100),
              source: 'auto',
            },
          });
        }
        await this.prisma.priceHistory.upsert({
          where: {
            itemId_platformCode_snapshotAt: {
              itemId: top.itemId,
              platformCode: top.platformCode,
              snapshotAt: dayStart,
            },
          },
          create: {
            tenantId,
            userId,
            itemId: top.itemId,
            platformCode: top.platformCode,
            title: top.title.slice(0, 100),
            price: top.price,
            couponAmount: top.couponAmount,
            payPrice: top.payPrice,
            commissionRate: top.commissionRate,
            estCommission: top.estCommission,
            snapshotAt: dayStart,
          },
          update: {
            price: top.price,
            couponAmount: top.couponAmount,
            payPrice: top.payPrice,
            commissionRate: top.commissionRate,
            estCommission: top.estCommission,
          },
        });
      } catch {
        /* 自动跟踪失败不阻塞搜索 */
      }
    }
    return views;
  }

  /** 价格历史轨迹（M7-3 / P3：支持 30/90 天曲线 + 均价/最低价） */
  async priceHistory(itemId: string, days = 30) {
    const { tenantId, userId } = await this.resolveScope();
    const dayCount = days === 90 ? 90 : 30;
    const since = new Date();
    since.setDate(since.getDate() - dayCount);
    const rows = await this.prisma.priceHistory.findMany({
      where: {
        itemId,
        tenantId,
        userId,
        snapshotAt: { gte: since },
      },
      orderBy: { snapshotAt: 'asc' },
    });
    const points = rows.map((r) => ({
      date: r.snapshotAt.toISOString().slice(0, 10),
      payPrice: Number(r.payPrice),
      estCommission: Number(r.estCommission),
    }));
    const prices = points.map((p) => p.payPrice);
    const avg =
      prices.length > 0
        ? Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2))
        : null;
    const min = prices.length > 0 ? Math.min(...prices) : null;
    const current = prices.length > 0 ? prices[prices.length - 1] : null;
    const belowAvgPct =
      avg !== null && current !== null && avg > 0
        ? Math.round(((avg - current) / avg) * 100)
        : null;
    return {
      itemId,
      days: dayCount,
      points,
      avg30: avg,
      min30: min,
      current,
      belowAvgPct,
    };
  }

  /** 商品详情 + 优惠券 + 返利（比价结果） */
  async offers(itemId: string, platform: string): Promise<OfferView> {
    const adapter = this.adapterRegistry.resolve();
    const snapshot = await adapter.offers(itemId, platform);
    await this.persistSnapshot(snapshot);
    return this.toOfferView(snapshot);
  }

  /** 创建/更新价格监控（P3 幂等：同商品同平台重复订阅 → 更新不新建） */
  async createWatch(input: {
    itemId: string;
    platformCode: string;
    title: string;
    targetPayPrice?: number;
    minRebate?: number;
    notifyWindows?: string;
  }) {
    const { tenantId, userId } = await this.resolveScope();
    const existing = await this.prisma.priceWatch.findFirst({
      where: {
        tenantId,
        userId,
        itemId: input.itemId,
        platformCode: input.platformCode,
        status: 'active',
      },
    });
    if (existing) {
      return this.prisma.priceWatch.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          targetPayPrice: input.targetPayPrice ?? existing.targetPayPrice,
          minRebate: input.minRebate ?? existing.minRebate,
          notifyWindows: input.notifyWindows ?? existing.notifyWindows,
          status: 'active',
        },
      });
    }
    return this.prisma.priceWatch.create({
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

  /** 创建门店采购清单（P0a 单门店，items 为清单项 JSON） */
  async createProcurement(input: {
    name: string;
    address?: string;
    owner?: string;
    storeId?: string;
    items: Array<{
      name: string;
      spec?: string;
      quantity?: number;
      stock?: number;
      minStock?: number;
      targetPrice?: number;
      allowSubstitute?: boolean;
    }>;
  }) {
    const { tenantId, userId } = await this.resolveScope();
    // 门店归属校验（P0b-5）：storeId 必须在自己的门店下
    if (input.storeId) {
      const store = await this.prisma.store.findFirst({
        where: { id: input.storeId, tenantId },
      });
      if (!store) throw new UnauthorizedException('门店不存在或不属于当前租户');
    }
    return this.prisma.procurementList.create({
      data: {
        tenantId,
        userId,
        name: input.name,
        address: input.address ?? null,
        owner: input.owner ?? null,
        storeId: input.storeId ?? null,
        items: input.items as never,
      },
    });
  }

  /** 我的采购清单列表 */
  async listProcurements(storeId?: string) {
    const { tenantId, userId } = await this.resolveScope();
    return this.prisma.procurementList.findMany({
      where: { tenantId, userId, storeId: storeId || undefined },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 补货建议：按清单项（库存 < 最低安全库存 或 缺货）生成建议 */
  async restockSuggestion(id: string) {
    const { tenantId, userId } = await this.resolveScope();
    const list = await this.prisma.procurementList.findFirst({
      where: { id, tenantId, userId },
    });
    if (!list) throw new UnauthorizedException('采购清单不存在');
    const items =
      (list.items as Array<{
        name: string;
        spec?: string;
        quantity?: number;
        stock?: number;
        minStock?: number;
        targetPrice?: number;
        allowSubstitute?: boolean;
      }>) || [];
    const suggestions = items
      .filter((item) => Number(item.stock || 0) < Number(item.minStock || 0))
      .map((item) => ({
        name: item.name,
        spec: item.spec || '',
        stock: item.stock || 0,
        minStock: item.minStock || 0,
        allowSubstitute: item.allowSubstitute ?? true,
        suggestQty: Math.max(
          Number(item.quantity || 0),
          Number(item.minStock || 0) - Number(item.stock || 0),
        ),
        targetPrice: item.targetPrice || null,
        reason:
          Number(item.stock || 0) === 0
            ? '库存为 0，建议立即补货'
            : `库存低于安全线（${item.minStock}），建议补货`,
      }));
    // 替代品牌推荐（P0b-5）：对允许替代的缺货项，从好单库搜同关键词拿 top 候选
    const substitutes: Array<{
      for: string;
      candidates: Array<{ title: string; payPrice: number; estRebate: number }>;
    }> = [];
    try {
      const adapter = this.adapterRegistry.resolve('haodanku');
      const subCandidates = suggestions.filter(
        (x) => x.allowSubstitute !== false,
      );
      for (const item of subCandidates.slice(0, 2)) {
        const results = await adapter.search(item.name);
        substitutes.push({
          for: item.name,
          candidates: results.slice(0, 3).map((r) => ({
            title: r.title,
            payPrice: r.payPrice,
            estRebate: Number((r.estCommission * USER_REBATE_RATE).toFixed(2)),
          })),
        });
      }
    } catch {
      /* 替代推荐失败不影响主建议 */
    }
    return {
      listId: id,
      name: list.name,
      suggestions,
      substitutes,
      total: suggestions.length,
    };
  }

  /** ===== P0b-5 门店采购主体 ===== */

  /** 创建门店 */
  async createStore(input: { name: string; address?: string; owner?: string }) {
    const { tenantId, userId } = await this.resolveScope();
    return this.prisma.store.create({
      data: {
        tenantId,
        name: input.name,
        address: input.address ?? null,
        owner: input.owner ?? userId,
      },
    });
  }

  /** 我的门店列表 */
  async listStores() {
    const { tenantId } = await this.resolveScope();
    return this.prisma.store.findMany({
      where: { tenantId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 停用门店 */
  async disableStore(id: string) {
    const { tenantId } = await this.resolveScope();
    return this.prisma.store.updateMany({
      where: { id, tenantId },
      data: { status: 'disabled' },
    });
  }

  /** 运营位选品（好单库 column：type=2 9.9包邮 / 3 30元封顶 / 5 淘抢购 等） */
  async featured(type: number) {
    const adapter = this.adapterRegistry.resolve('haodanku');
    const snapshots = adapter.featured ? await adapter.featured(type, 10) : [];
    return snapshots.map((s) => this.toOfferView(s));
  }

  /** 美团本地生活活动列表（好单库，普通接口无需额外权限） */
  async meituanActivities() {
    const adapter = this.adapterRegistry.resolve('haodanku');
    const snapshots = await adapter.search('', 'meituan');
    return snapshots.map((s) => this.toOfferView(s));
  }

  /** 生成推广链接（美团活动/商品转链；归因服务端生成，落库幂等） */
  async translink(input: {
    itemId?: string;
    originalUrl?: string;
    platformCode: string;
    activityId?: string;
  }) {
    const { tenantId, userId } = await this.resolveScope();
    const adapter = this.adapterRegistry.resolve('haodanku');
    // 幂等键 = 内容哈希（同参重复提交返回同键 → 落库防重），非时间戳
    const keyBody = `${tenantId}:${userId}:${input.platformCode}:${input.activityId || input.itemId || input.originalUrl || 'link'}`;
    const idempotencyKey = `tl:${createHash('sha1')
      .update(keyBody)
      .digest('hex')
      .slice(0, 20)}`;
    const promo = await adapter.translink({
      tenantId,
      userId,
      platformCode: input.platformCode,
      itemId: input.itemId || input.activityId || '',
      originalUrl: input.originalUrl || '',
      idempotencyKey,
      attribution: { tenantId, userId },
      activityId: input.activityId || undefined,
    });
    // 落库推广链接（幂等键唯一防重）
    await this.prisma.cpsPromoLink.create({
      data: {
        tenantId,
        userId,
        vendorCode: promo.vendorCode,
        platformCode: promo.platformCode,
        itemId: promo.itemId,
        originalUrl: promo.originalUrl,
        promoUrl: promo.promoUrl,
        idempotencyKey: promo.idempotencyKey,
        attribution: promo.attribution as object,
      },
    });
    return {
      vendorCode: promo.vendorCode,
      platformCode: promo.platformCode,
      itemId: promo.itemId,
      promoUrl: promo.promoUrl,
    };
  }

  /** ===== P2 增长能力 ===== */

  /** 预置分类（B 端客群：企业/个体户采购视角，走 supersearch 热词） */
  private static readonly CATEGORIES: Array<{
    key: string;
    label: string;
    keywords: string[];
  }> = [
    { key: 'hot', label: '🔥 热销', keywords: ['好物', '爆款'] },
    { key: 'store', label: '🏪 门店经营', keywords: ['收银机', '电子秤'] },
    { key: 'pack', label: '📦 包装耗材', keywords: ['快递袋', '打包纸箱'] },
    { key: 'office', label: '🖥️ 办公设备', keywords: ['打印机', '显示器'] },
    { key: 'live', label: '🎥 直播设备', keywords: ['补光灯', '直播支架'] },
    { key: 'clean', label: '🧹 清洁用品', keywords: ['清洁剂', '垃圾桶'] },
    { key: 'food', label: '🍱 餐饮耗材', keywords: ['打包盒', '一次性餐具'] },
    { key: 'marketing', label: '🏷️ 营销物料', keywords: ['展架', '广告横幅'] },
    { key: 'appliance', label: '⚡ 商用电器', keywords: ['冰柜', '微波炉'] },
  ];

  /** 分类商品列表（B 端分类；meituan 走美团活动专用接口，缺 key 优雅返回空） */
  async category(key: string, limit = 10) {
    // 美团分类走本地生活活动接口（外卖/到店/买菜）
    if (key === 'meituan') {
      try {
        const acts = await this.meituanActivities();
        return {
          key: 'meituan',
          label: '🍜 美团',
          items: acts.slice(0, limit),
        };
      } catch {
        return {
          key: 'meituan',
          label: '🍜 美团',
          items: [],
          error: 'VENDOR_API_ERROR',
        };
      }
    }
    const conf =
      SavingsService.CATEGORIES.find((c) => c.key === key) ??
      SavingsService.CATEGORIES[0];
    const adapter = this.adapterRegistry.resolve('haodanku');
    // 热销类走 column 运营位（今日上新/9.9/30 元），其余走 supersearch 热词
    try {
      let snapshots: OfferSnapshot[] = [];
      if (key === 'hot') {
        snapshots = adapter.featured
          ? await adapter.featured(1, Math.min(limit, 20))
          : await adapter.search(conf.keywords[0], 'taobao');
      } else {
        const kw = conf.keywords[0];
        snapshots = await adapter.search(kw, 'taobao');
      }
      const views = snapshots.slice(0, limit).map((s) => this.toOfferView(s));
      return { key: conf.key, label: conf.label, items: views };
    } catch (e) {
      // 凭证未配置 / 供应商超时 → 优雅降级，前端显示空态与提示
      // NestJS 异常的错误码在 getResponse() 里（非直接 .code 属性）
      this.logger.warn(
        `category(${key}) 降级：${(e as Error)?.message ?? String(e)}`,
      );
      let code: string | undefined;
      try {
        const resp = (e as { getResponse?: () => unknown })?.getResponse?.();
        code =
          (resp as { code?: string } | null)?.code ??
          (e as { code?: string }).code;
      } catch {
        code = undefined;
      }
      return {
        key: conf.key,
        label: conf.label,
        items: [],
        error:
          code === 'VENDOR_CREDENTIAL_MISSING'
            ? 'VENDOR_CREDENTIAL_MISSING'
            : 'VENDOR_API_ERROR',
      };
    }
  }

  /** 收藏商品（幂等：同用户同商品重复收藏返回已有记录） */
  async addFavorite(input: {
    vendorCode: string;
    platformCode: string;
    itemId: string;
    title: string;
    imageUrl?: string | null;
    payPrice: number;
    couponAmount: number;
    estRebate: number;
    estNetCost: number;
    commissionRate?: number;
  }) {
    const { tenantId, userId } = await this.resolveScope();
    const existing = await this.prisma.cpsFavorite.findUnique({
      where: {
        tenantId_userId_itemId_platformCode: {
          tenantId,
          userId,
          itemId: input.itemId,
          platformCode: input.platformCode,
        },
      },
    });
    if (existing) return existing;
    return this.prisma.cpsFavorite.create({
      data: {
        tenantId,
        userId,
        vendorCode: input.vendorCode,
        platformCode: input.platformCode,
        itemId: input.itemId,
        title: input.title,
        imageUrl: input.imageUrl ?? null,
        payPrice: input.payPrice,
        couponAmount: input.couponAmount,
        estRebate: input.estRebate,
        estNetCost: input.estNetCost,
        commissionRate: input.commissionRate ?? null,
      },
    });
  }

  /** 取消收藏 */
  async removeFavorite(itemId: string, platformCode: string) {
    const { tenantId, userId } = await this.resolveScope();
    await this.prisma.cpsFavorite.deleteMany({
      where: { tenantId, userId, itemId, platformCode },
    });
    return { success: true };
  }

  /** 收藏列表 */
  async listFavorites() {
    const { tenantId, userId } = await this.resolveScope();
    return this.prisma.cpsFavorite.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 今日签到（连续天数递增，返回本次奖励） */
  async checkin() {
    const { tenantId, userId } = await this.resolveScope();
    const today = this.beijingDateStr(new Date());
    const existing = await this.prisma.savingsCheckin.findUnique({
      where: {
        tenantId_userId_checkinDate: { tenantId, userId, checkinDate: today },
      },
    });
    if (existing) {
      return { already: true, ...existing, streakDay: existing.streakDay };
    }
    // 计算连续天数：昨天是否签到
    const yesterday = this.beijingDateStr(new Date(Date.now() - 86400_000));
    const prev = await this.prisma.savingsCheckin.findFirst({
      where: { tenantId, userId, checkinDate: yesterday },
    });
    const streakDay = prev ? prev.streakDay + 1 : 1;
    const rewardAmount = Number(
      (0.1 + Math.min(streakDay - 1, 6) * 0.02).toFixed(2),
    ); // 0.1 起步，每连续 +0.02，封顶 0.22
    const record = await this.prisma.savingsCheckin.create({
      data: {
        tenantId,
        userId,
        checkinDate: today,
        rewardAmount,
        streakDay,
      },
    });
    // 入账可用返利（幂等键 = checkin:tenant:user:date）
    await this.prisma.rebateAccount.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: {
        tenantId,
        userId,
        available: rewardAmount,
        totalEarned: rewardAmount,
      },
      update: {
        available: { increment: rewardAmount },
        totalEarned: { increment: rewardAmount },
      },
    });
    return { already: false, ...record, streakDay };
  }

  /** 签到状态（今日是否已签 + 连续天数 + 本月天数） */
  async checkinStatus() {
    const { tenantId, userId } = await this.resolveScope();
    const today = this.beijingDateStr(new Date());
    const month = today.slice(0, 7); // YYYY-MM
    const todayRec = await this.prisma.savingsCheckin.findUnique({
      where: {
        tenantId_userId_checkinDate: { tenantId, userId, checkinDate: today },
      },
    });
    const monthRecs = await this.prisma.savingsCheckin.findMany({
      where: { tenantId, userId, checkinDate: { startsWith: month } },
      orderBy: { checkinDate: 'desc' },
    });
    const latest = monthRecs[0];
    // 若最新一条不是今天且不是昨天 → 连续断裂
    let streakDay = latest?.streakDay ?? 0;
    if (latest && latest.checkinDate !== today) {
      const yesterday = this.beijingDateStr(new Date(Date.now() - 86400_000));
      if (latest.checkinDate !== yesterday) streakDay = 0;
    }
    return {
      todayChecked: !!todayRec,
      streakDay,
      monthDays: monthRecs.length,
      todayReward: todayRec ? Number(todayRec.rewardAmount) : null,
    };
  }

  /** 我的邀请码（确定性生成：sha1(userId) 前 8 位） */
  async inviteCode() {
    const { userId } = await this.resolveScope();
    const code = createHash('sha1').update(userId).digest('hex').slice(0, 8);
    return {
      inviteCode: code,
      inviteUrl: `${this.publicOrigin()}/register?invite=${code}`,
      shareText: `我在用 JIUZHANG AI 省钱返利，购物返利还能 1:1 抵 AI 算力！输入我的邀请码 ${code} 一起省钱～`,
    };
  }

  /** 北京时间 YYYY-MM-DD（服务器时区无关，避免跨日边界错位） */
  private beijingDateStr(d: Date): string {
    const utc8 = new Date(d.getTime() + 8 * 3600_000);
    return utc8.toISOString().slice(0, 10);
  }

  private publicOrigin(): string {
    const env = process.env.PUBLIC_ORIGIN;
    if (env) return env.replace(/\/$/, '');
    return process.env.NODE_ENV === 'production'
      ? 'https://aicontent.vip.kaypal.cn'
      : 'http://localhost:3010';
  }
}
