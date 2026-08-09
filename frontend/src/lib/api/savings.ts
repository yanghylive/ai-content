import { api } from "./client";

/** 商品视图（含预计返利与净成本） */
export interface OfferView {
  vendorCode: string;
  platformCode: string;
  itemId: string;
  title: string;
  shopName?: string | null;
  price: number;
  couponAmount: number;
  payPrice: number;
  commissionRate: number;
  estCommission: number;
  estRebate: number;
  estNetCost: number;
  freight: number;
  imageUrl?: string | null;
}

/** 返利余额 */
export interface RebateBalance {
  estimated: number;
  pending: number;
  available: number;
  frozen: number;
  totalEarned: number;
}

/** AI 额度余额 */
export interface CreditBalance {
  balance: number;
  totalGranted: number;
  totalConsumed: number;
}

/** 监控 */
export interface PriceWatch {
  id: string;
  title: string;
  itemId: string;
  platformCode: string;
  targetPayPrice: number | null;
  minRebate: number | null;
  status: string;
  lastNotifiedAt: string | null;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderNo: string;
  platformCode: string;
  itemId: string | null;
  payAmount: number;
  estCommission: number;
  userRebate: number;
  status: string;
  paidAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export const savingsApi = {
  /** 解析链接/口令 */
  parse(raw: string) {
    return api.post<OfferView>("/savings/parse", { raw });
  },
  /** 关键词搜索比价 */
  search(keyword: string, platform?: string) {
    const q = new URLSearchParams({ keyword });
    if (platform) q.set("platform", platform);
    return api.get<OfferView[]>(`/savings/search?${q.toString()}`);
  },
  /** 商品详情 */
  offers(itemId: string, platform = "taobao") {
    return api.get<OfferView>(`/savings/offers/${itemId}?platform=${platform}`);
  },
  /** 创建监控 */
  createWatch(input: {
    itemId: string;
    platformCode: string;
    title: string;
    targetPayPrice?: number;
    minRebate?: number;
  }) {
    return api.post<PriceWatch>("/savings/watch", input);
  },
  /** 监控列表 */
  listWatches() {
    return api.get<PriceWatch[]>("/savings/watches");
  },
  /** 停用监控 */
  disableWatch(id: string) {
    return api.post(`/savings/watches/${id}/disable`);
  },
  /** 返利余额 */
  rebateBalance() {
    return api.get<RebateBalance>("/savings/rebate");
  },
  /** AI 额度余额 */
  creditBalance() {
    return api.get<CreditBalance>("/savings/credit");
  },
  /** 订单列表 */
  listOrders(status?: string, page = 1) {
    const q = new URLSearchParams({ page: String(page) });
    if (status) q.set("status", status);
    return api.get<{ items: OrderItem[]; total: number; page: number }>(
      `/savings/orders?${q.toString()}`,
    );
  },
  /** 兑换 AI 额度 */
  exchange(amount: number, idempotencyKey: string) {
    return api.post<{
      exchangeId: string;
      rebateAmount: number;
      creditAmount: number;
      status: string;
    }>("/savings/exchange", { amount, idempotencyKey });
  },
  /** 提现 */
  withdraw(input: {
    amount: number;
    channel: string;
    accountMask: string;
    idempotencyKey: string;
  }) {
    return api.post<{ withdrawalId: string; status: string; amount: number }>(
      "/savings/withdraw",
      input,
    );
  },
  /** 提现记录 */
  listWithdrawals(page = 1) {
    return api.get<{ items: unknown[]; total: number }>(
      `/savings/withdrawals?page=${page}`,
    );
  },
  /** 创建采购清单 */
  createProcurement(input: {
    name: string;
    address?: string;
    owner?: string;
    items: Array<{
      name: string;
      spec?: string;
      quantity?: number;
      stock?: number;
      minStock?: number;
      targetPrice?: number;
    }>;
  }) {
    return api.post("/savings/procurement", input);
  },
  /** 补货建议 */
  restockSuggestion(listId: string) {
    return api.get<{ name: string; suggestions: unknown[]; total: number }>(
      `/savings/procurement/${listId}/restock`,
    );
  },
  /** 美团本地生活活动列表（好单库） */
  meituanActivities() {
    return api.get<OfferView[]>("/savings/meituan-activities");
  },
  /** 生成推广链接（美团活动/商品转链） */
  translink(input: {
    itemId?: string;
    originalUrl?: string;
    platformCode: string;
    activityId?: string;
  }) {
    return api.post<{ promoUrl: string; platformCode: string }>(
      "/savings/translink",
      input,
    );
  },
};
