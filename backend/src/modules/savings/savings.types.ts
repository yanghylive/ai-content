/**
 * 智能省钱返利（savings）类型定义（需求清单 V1.1 §5）
 */

/** 供应商统一适配层接口——业务层只依赖此接口，不感知供应商 */
export interface SavingsAdapter {
  readonly vendorCode: string; // datoke / veapi / alimama / jdunion / duoduo
  /** 解析链接/口令/分享文本 → 商品快照 */
  parse(raw: string): Promise<OfferSnapshot>;
  /** 关键词搜索商品 */
  search(keyword: string, platform?: string): Promise<OfferSnapshot[]>;
  /** 商品详情 + 优惠券 + 佣金 */
  offers(itemId: string, platform: string): Promise<OfferSnapshot>;
  /** 生成用户专属推广链接（服务端归因，幂等由调用方保证） */
  translink(input: TranslinkInput): Promise<CpsPromoLink>;
  /** 订单增量同步（分页游标推进） */
  orders(syncPoint?: string): Promise<OrderSyncResult>;
  /** 结算确认（对账用） */
  settle?(platform: string, date: string): Promise<SettleSummary>;
}

/** 商品快照（与 Prisma OfferSnapshot 对齐） */
export interface OfferSnapshot {
  vendorCode: string;
  platformCode: string; // taobao/jd/pdd
  itemId: string;
  title: string;
  shopName?: string | null;
  price: number; // 页面售价
  couponAmount: number; // 优惠券面额
  payPrice: number; // 券后支付价
  commissionRate: number; // 佣金率 %
  estCommission: number; // 预估佣金
  freight: number; // 运费
  imageUrl?: string | null;
  rawJson: Record<string, unknown>; // 外部原始状态摘要
}

/** 转链输入 */
export interface TranslinkInput {
  tenantId: string;
  userId: string;
  platformCode: string;
  itemId: string;
  originalUrl: string;
  idempotencyKey: string;
  attribution: Record<string, unknown>; // 归因参数（服务端生成）
  /** 美团活动转链（meituan_ratesurl activity_id；与 itemId/originalUrl 二选一） */
  activityId?: string;
}

/** 推广链接 */
export interface CpsPromoLink {
  vendorCode: string;
  platformCode: string;
  itemId: string;
  originalUrl: string;
  promoUrl: string;
  idempotencyKey: string;
  attribution: Record<string, unknown>;
}

/** 订单同步结果 */
export interface OrderSyncResult {
  orders: SyncOrder[];
  nextSyncPoint?: string | null;
}

/** 同步订单（与 Prisma CpsOrder 对齐） */
export interface SyncOrder {
  orderNo: string;
  platformCode: string;
  itemId?: string | null;
  payAmount: number;
  estCommission: number;
  status: string; // 外部状态 → 内部映射由 service 完成
  rawStatus: string;
  paidAt?: string | null;
}

/** 结算汇总（对账） */
export interface SettleSummary {
  platform: string;
  date: string;
  orderCount: number;
  totalCommission: number;
  totalRebate: number;
  raw: Record<string, unknown>;
}

/** 返利余额视图 */
export interface RebateBalanceView {
  estimated: number; // 预计（仅展示）
  pending: number; // 待结算
  available: number; // 可用
  frozen: number; // 冻结
  totalEarned: number; // 累计获得
}

/** 商品搜索结果（带预计净成本） */
export interface OfferView extends OfferSnapshot {
  estNetCost: number; // 预计净成本 = 支付价 + 运费 - 优惠券 - 预计返利
  estRebate: number; // 用户预计返利（佣金 × 用户返利比例）
  /** 规格解析：数量（件/罐/包…） */
  specQty?: number;
  /** 规格解析：单件价 = 支付价 ÷ 数量（规格归一化，M5-4） */
  unitPrice?: number;
}
