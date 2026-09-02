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
  /** 规格解析：数量与单件价（M5-4） */
  specQty?: number;
  unitPrice?: number;
}

export interface VendorOffersResponse {
  items: OfferView[];
  unavailable: {
    code: "VENDOR_CREDENTIAL_MISSING";
    message: string;
  } | null;
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
  /** 同款跨平台比价（SKU 归并，含全网最低价差） */
  skuCompare(keyword: string) {
    return api.get<
      Array<{
        masterTitle: string;
        offers: Array<{
          platformCode: string;
          shopName?: string | null;
          payPrice: number;
          unitPrice?: number;
          estRebate: number;
          estNetCost: number;
          commissionRate: number;
        }>;
        cheapest: {
          platformCode: string;
          estNetCost: number;
          payPrice: number;
        };
        priceGap: number;
        total: number;
      }>
    >(`/savings/sku-compare?keyword=${encodeURIComponent(keyword)}`);
  },
  /** 创建/更新价格监控（幂等，P3） */
  upsertWatch(input: {
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
  /** 返利直付预检（生图/生视频费用 + 返利余额） */
  payCheck(feature = "image_generation") {
    return api.get<{
      feature: string;
      price: number;
      rebateBalance: number;
      canCover: boolean;
      priceLabel: string;
    }>(`/savings/pay-check?feature=${feature}`);
  },
  /** 返利直付（1:1 现金抵扣，幂等） */
  payRebate(input: {
    amount: number;
    bizNo: string;
    feature: string;
    idempotencyKey: string;
  }) {
    return api.post<{ receiptId: string; amount: number; already?: boolean }>(
      "/savings/pay-rebate",
      input,
    );
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
    return api.get<{
      name: string;
      suggestions: unknown[];
      substitutes: unknown[];
      total: number;
    }>(`/savings/procurement/${listId}/restock`);
  },
  /** 门店列表（P0b-5 多门店） */
  listStores() {
    return api.get<
      Array<{
        id: string;
        name: string;
        address?: string | null;
        owner?: string | null;
      }>
    >("/savings/stores");
  },
  /** 创建门店 */
  createStore(input: { name: string; address?: string }) {
    return api.post<{ id: string; name: string }>("/savings/stores", input);
  },
  /** 停用门店 */
  disableStore(id: string) {
    return api.post(`/savings/stores/${id}/disable`);
  },
  /** 价格历史轨迹（30/90 天曲线 + 均价/最低） */
  priceHistory(itemId: string, days = 30) {
    return api.get<{
      itemId: string;
      days: number;
      points: Array<{ date: string; payPrice: number; estCommission: number }>;
      avg30: number | null;
      min30: number | null;
      current: number | null;
      belowAvgPct: number | null;
    }>(
      `/savings/price-history?itemId=${encodeURIComponent(itemId)}&days=${days}`,
    );
  },
  /** 运营位选品（type=2 9.9包邮 / 3 30元封顶） */
  featured(type = 2) {
    return api.get<VendorOffersResponse>(`/savings/featured?type=${type}`);
  },
  /** 分类商品列表（首页导航 + 默认商品流，P3-2） */
  category(key = "hot", limit = 10) {
    return api.get<{
      key: string;
      label: string;
      items: OfferView[];
      error?: "VENDOR_CREDENTIAL_MISSING" | "VENDOR_API_ERROR";
    }>(`/savings/category?key=${key}&limit=${limit}`);
  },
  /** 美团本地生活活动列表（好单库） */
  meituanActivities() {
    return api.get<VendorOffersResponse>("/savings/meituan-activities");
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
  /** ===== 聚推客联盟 · 生活服务场景 ===== */
  /** 生活服务场景分组列表（外卖/出行/餐饮/到店/娱乐/充值，本地精选配置） */
  lifeServices() {
    return api.get<{
      configured: boolean;
      scenes: Array<{
        key: string;
        label: string;
        items: Array<{
          actId: number;
          scene: string;
          name: string;
          desc: string;
          badge?: string;
          icon?: string;
        }>;
      }>;
      total: number;
      updatedAt: string;
    }>("/savings/life-services");
  },
  /** 生活服务活动转链（h5/小程序） */
  lifeServiceLink(actId: number, sid?: string) {
    const q = new URLSearchParams();
    if (sid) q.set("sid", sid);
    return api.get<{
      actId: number;
      actName?: string;
      h5?: string;
      longH5?: string;
      weApp: { appId?: string; pagePath?: string; miniCode?: string } | null;
      error?: "VENDOR_CREDENTIAL_MISSING" | "VENDOR_API_ERROR";
    }>(
      `/savings/life-services/${actId}/link${q.toString() ? `?${q.toString()}` : ""}`,
    );
  },
  /** ===== P2 增长能力 ===== */
  /** 收藏商品 */
  addFavorite(input: {
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
    return api.post("/savings/favorites", input);
  },
  /** 取消收藏 */
  removeFavorite(itemId: string, platformCode: string) {
    return api.delete(`/savings/favorites/${itemId}?platform=${platformCode}`);
  },
  /** 收藏列表 */
  listFavorites() {
    return api.get<
      Array<{
        id: string;
        itemId: string;
        platformCode: string;
        vendorCode: string;
        title: string;
        imageUrl?: string | null;
        payPrice: number;
        couponAmount: number;
        estRebate: number;
        estNetCost: number;
        commissionRate: number | null;
        createdAt: string;
      }>
    >("/savings/favorites");
  },
  /** 每日签到 */
  checkin() {
    return api.post<{
      already: boolean;
      id: string;
      checkinDate: string;
      rewardAmount: number;
      streakDay: number;
    }>("/savings/checkin");
  },
  /** 签到状态 */
  checkinStatus() {
    return api.get<{
      todayChecked: boolean;
      streakDay: number;
      monthDays: number;
      todayReward: number | null;
    }>("/savings/checkin/status");
  },
  /** 邀请码与专属链接 */
  invite() {
    return api.get<{
      inviteCode: string;
      inviteUrl: string;
      shareText: string;
    }>("/savings/invite");
  },
  /** ===== 管理端（admin）===== */
  /** 全量订单 */
  adminOrders(status?: string, page = 1) {
    const q = new URLSearchParams({ page: String(page) });
    if (status) q.set("status", status);
    return api.get<{ items: OrderItem[]; total: number; page: number }>(
      `/admin/savings/orders?${q.toString()}`,
    );
  },
  /** 全量提现 */
  adminWithdrawals(status?: string, page = 1) {
    const q = new URLSearchParams({ page: String(page) });
    if (status) q.set("status", status);
    return api.get<{ items: unknown[]; total: number; page: number }>(
      `/admin/savings/withdrawals?${q.toString()}`,
    );
  },
  /** 提现审核通过 */
  adminApproveWithdrawal(id: string) {
    return api.post(`/admin/savings/withdrawals/${id}/approve`);
  },
  /** 提现驳回 */
  adminRejectWithdrawal(id: string, reason?: string) {
    return api.post(`/admin/savings/withdrawals/${id}/reject`, { reason });
  },
  /** 兑换列表 */
  adminExchanges(page = 1) {
    return api.get<{ items: unknown[]; total: number; page: number }>(
      `/admin/savings/exchanges?page=${page}`,
    );
  },
  /** 对账汇总 */
  adminReconcile() {
    return api.get<Record<string, unknown>>("/admin/savings/reconcile");
  },
  /** 供应商状态 */
  adminVendors() {
    return api.get<
      Array<{
        code: string;
        configured: Record<string, boolean>;
        ready: boolean;
      }>
    >("/admin/savings/vendors");
  },
};
