import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  SavingsAdapter,
  OfferSnapshot,
  TranslinkInput,
  CpsPromoLink,
  OrderSyncResult,
} from '../savings.types';

/**
 * 好单库适配器（P0b 主力：美团/饿了么本地生活 + 万能解析兜底，需求清单 V1.1 §5.2）。
 *
 * 供应商策略（2026-08-09 修订）：大淘客（电商 5 平台）+ 好单库（美团/饿了么 + clipboard 万能解析）
 * 双供应商拼接，按 platformCode 路由（参考开源「苏分宝」mixParse 架构）。
 *
 * API 规范（官方文档 haodanku-openapi-docs.zip，2026-08-09 校准）：
 * - 两套鉴权：① 普通接口 = apikey（GET / POST form-data），商品搜索/详情/列表/转链/订单拉取
 *             ② 增值接口 = app_id + sign（POST JSON https://v3.api.haodanku.com/rest），口令解析/粘贴板/短链
 * - 签名（增值）：除 sign 外参数按 key 升序 → key+value 直接拼接 → 末尾拼 app_secret → MD5 转大写
 * - 成功判断：code === 1 或 200（其余失败）
 * - 分页：min_id(页码) + back(每页≤100)；订单时间：start_date/end_date Unix 秒 + date_type
 * - 平台路由（v3.api.haodanku.com/）：
 *   搜索 supersearch(淘宝) / unify_jdgoods_search / unify_pdd_goods_search / unify_vip_item_query / dy_itemlist_simplify
 *   详情 item_detail(淘宝)
 *   转链 ratesurl(淘宝 pid+tb_name) / meituan_ratesurl(美团活动,无需权限) / mt_goods_detail(美团单品解析转链一体)
 *   订单 mt_order_list(美团) / unify_jd_order_list / unify_pdd_order_list / dy_order_list / vip_union_order_list
 * - ⚠️ 淘宝普通订单拉取接口路径文档未公开（增值类，需权限后确认）→ orders 先支持美团，淘宝走大淘客
 */

/** unknown → string 安全转换（避免 no-base-to-string） */
function safeStr(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

/** unknown → number 安全转换 */
function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

@Injectable()
export class HaodankuAdapter implements SavingsAdapter {
  readonly vendorCode = 'haodanku';
  private readonly baseUrl = 'https://v3.api.haodanku.com';

  /** 从环境变量读好单库凭证（生产由部署配置注入） */
  private getCredentials() {
    return {
      apikey: process.env.HAODANKU_APIKEY || '',
      appId: process.env.HAODANKU_APP_ID || '',
      appSecret: process.env.HAODANKU_APP_SECRET || '',
      pid: process.env.HAODANKU_PID || '',
      tbName: process.env.HAODANKU_TB_NAME || '',
    };
  }

  private assertReady(needVip = false) {
    const { apikey, appId, appSecret } = this.getCredentials();
    if (!apikey) {
      throw new ServiceUnavailableException({
        code: 'VENDOR_CREDENTIAL_MISSING',
        message: '好单库凭证未配置（HAODANKU_APIKEY），请在后台配置后重试',
      });
    }
    if (needVip && (!appId || !appSecret)) {
      throw new ServiceUnavailableException({
        code: 'VENDOR_CREDENTIAL_MISSING',
        message:
          '好单库增值接口凭证未配置（HAODANKU_APP_ID / HAODANKU_APP_SECRET），口令解析/万能解析需增值应用',
      });
    }
  }

  /** 统一错误包装 */
  private throwApiError(path: string, json: { code?: number; msg?: string }) {
    throw new ServiceUnavailableException({
      code: 'VENDOR_API_ERROR',
      message: `好单库接口错误：${json.msg || json.code}（${path}）`,
    });
  }

  /** 普通接口：GET + apikey（商品搜索/详情/订单） */
  private async callGet<T>(
    path: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertReady();
    const { apikey } = this.getCredentials();
    const query = new URLSearchParams({
      apikey,
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, safeStr(v)]),
      ),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}/${path}?${query.toString()}`, {
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: T;
      };
      if (json.code !== 1 && json.code !== 200) {
        this.throwApiError(path, json);
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 普通接口：POST form-data + apikey（转链） */
  private async callForm<T>(
    path: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertReady();
    const { apikey } = this.getCredentials();
    const form = new FormData();
    form.append('apikey', apikey);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') form.append(k, safeStr(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}/${path}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: T;
      };
      if (json.code !== 1 && json.code !== 200) {
        this.throwApiError(path, json);
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 增值接口：POST JSON rest + 签名（口令解析/粘贴板/短链） */
  private async callRest<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertReady(true);
    const { appId, appSecret } = this.getCredentials();
    const body: Record<string, string> = {
      method,
      app_id: appId,
      date: new Date().toISOString().slice(0, 19).replace('T', ' '),
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, safeStr(v)]),
      ),
    };
    // 签名：key 升序 → key+value 直接拼接 → 末尾拼 app_secret → MD5 大写
    const sorted = Object.keys(body)
      .sort()
      .map((k) => `${k}${body[k]}`)
      .join('');
    const crypto = await import('node:crypto');
    const sign = crypto
      .createHash('md5')
      .update(sorted + appSecret)
      .digest('hex')
      .toUpperCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}/rest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, sign }),
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        code?: number;
        msg?: string;
        data?: T;
      };
      if (json.code !== 1 && json.code !== 200) {
        this.throwApiError(method, json);
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async parse(raw: string): Promise<OfferSnapshot> {
    // ① 淘宝口令解析（增值接口）；② 失败 → 万能粘贴板识别（支持淘宝/京东/拼多多/美团/快手/抖音）
    try {
      const data = await this.callRest<Record<string, unknown>>(
        'analyze.taoword',
        { taoword: raw },
      );
      return this.toSnapshot(data, 'taobao');
    } catch (_err) {
      const data = await this.callRest<Record<string, unknown>>(
        'analyze.clipboard',
        { content: raw, is_change: 0, v: '3.0.1', platform: 0 },
      );
      const platform = this.mapPlatform(safeStr(data.platform));
      return this.toSnapshot(data, platform);
    }
  }

  async search(keyword: string, platform = 'taobao'): Promise<OfferSnapshot[]> {
    // 按平台路由（好单库各平台独立接口）；P0b 先做淘宝 + 美团活动
    if (platform === 'meituan' || platform === 'mt') {
      const data = await this.callGet<{
        list?: Array<Record<string, unknown>>;
      }>('meituan_activity_list', { back: 20 });
      return (data.list || []).map((item) => this.toSnapshot(item, 'meituan'));
    }
    // 默认淘宝超级搜索（大淘客承担淘宝主力，这里作兜底）
    const data = await this.callGet<{ list?: Array<Record<string, unknown>> }>(
      'supersearch',
      { keyword, back: 20 },
    );
    return (data.list || []).map((item) => this.toSnapshot(item, 'taobao'));
  }

  async offers(itemId: string, platform = 'taobao'): Promise<OfferSnapshot> {
    if (platform === 'meituan' || platform === 'mt') {
      const data = await this.callGet<Record<string, unknown>>(
        'mt_goods_detail',
        { itemid: itemId, link_type: 1 },
      );
      return this.toSnapshot(data, 'meituan');
    }
    const data = await this.callGet<Record<string, unknown>>('item_detail', {
      itemid: itemId,
    });
    return this.toSnapshot(data, 'taobao');
  }

  async translink(input: TranslinkInput): Promise<CpsPromoLink> {
    const { pid, tbName } = this.getCredentials();
    const platform = input.platformCode;
    let promoUrl = '';

    if (platform === 'meituan' || platform === 'mt') {
      // 美团单品解析转链一体（text 支持商品券/买菜/活动链接）
      const data = await this.callForm<Record<string, unknown>>(
        'mt_goods_detail',
        { text: input.originalUrl || '', link_type: 1 },
      );
      promoUrl = safeStr(data.referral_link) || safeStr(data.link);
    } else if (platform === 'jd') {
      const data = await this.callForm<Record<string, unknown>>(
        'unify_jditems_link',
        { material_id: input.originalUrl || input.itemId },
      );
      promoUrl = safeStr(data.clickURL) || safeStr(data.shortURL);
    } else if (platform === 'pdd') {
      const data = await this.callForm<Record<string, unknown>>(
        'unify_pdditems_link',
        { itemid: input.itemId },
      );
      promoUrl =
        safeStr(data.mobile_short_url) ||
        safeStr(data.short_url) ||
        safeStr(data.url);
    } else {
      // 默认淘宝商品转链（需已授权淘宝账号昵称 tb_name + PID）
      if (!pid || !tbName) {
        throw new ServiceUnavailableException({
          code: 'VENDOR_CREDENTIAL_MISSING',
          message:
            '好单库淘宝转链需 HAODANKU_PID + HAODANKU_TB_NAME（好单库 APP 已授权淘宝账号昵称）',
        });
      }
      const data = await this.callForm<Record<string, unknown>>('ratesurl', {
        itemid: input.itemId,
        pid,
        tb_name: tbName,
        get_taoword: 1,
        title: input.originalUrl || input.itemId,
      });
      promoUrl = safeStr(data.taoword) || safeStr(data.coupon_click_url);
    }

    if (!promoUrl) {
      throw new ServiceUnavailableException({
        code: 'TRANSLINK_FAILED',
        message: '好单库转链失败：未返回推广链接',
      });
    }
    return {
      vendorCode: this.vendorCode,
      platformCode: platform,
      itemId: input.itemId,
      originalUrl: input.originalUrl,
      promoUrl,
      idempotencyKey: input.idempotencyKey,
      attribution: input.attribution,
    };
  }

  async orders(_syncPoint?: string): Promise<OrderSyncResult> {
    // 双供应商分工：好单库负责美团订单（mt_order_list）；淘宝订单由大淘客适配器承担
    const now = Math.floor(Date.now() / 1000);
    const start = _syncPoint ? Number(_syncPoint) : now - 7 * 86400;
    const data = await this.callGet<{
      list?: Array<Record<string, unknown>>;
      min_id?: string;
    }>('mt_order_list', {
      min_id: 1,
      back: 100,
      start_date: start,
      end_date: now,
      date_type: 4, // 更新时间（增量拉取）
    });
    const orders = (data.list || []).map((item) => ({
      orderNo: safeStr(item.trade_id) || safeStr(item.trade_parent_id),
      platformCode: 'meituan',
      itemId: null,
      payAmount: safeNum(item.pay_price),
      estCommission: safeNum(item.predict_money),
      status: this.mapOrderStatus(
        safeStr(item.order_status),
        safeStr(item.settled_status),
      ),
      rawStatus: `order:${safeStr(item.order_status)}/settle:${safeStr(item.settled_status)}`,
      paidAt: item.paid_time ? safeStr(item.paid_time) : null,
    }));
    return { orders, nextSyncPoint: String(now) };
  }

  /** 外部订单状态 → 内部状态映射（V1.1 §7.1） */
  private mapOrderStatus(orderStatus: string, settledStatus: string): string {
    // order_status：1付款 2已收货/结算 3退款/失效 4已完成；settled_status：0待结算 1已结算 2不予结算
    if (orderStatus === '3') return 'INVALID';
    if (orderStatus === '4' || settledStatus === '1') return 'SETTLED';
    if (orderStatus === '2') return 'CONFIRMED';
    if (orderStatus === '1') return 'PAID';
    return 'SYNCED';
  }

  /** 粘贴板返回的 platform 枚举 → 内部平台码（analyze.clipboard：1淘宝 2京东 3拼多多 4美团 5快手 6闪购 7抖音） */
  private mapPlatform(p: string): string {
    const map: Record<string, string> = {
      '1': 'taobao',
      '2': 'jd',
      '3': 'pdd',
      '4': 'meituan',
      '5': 'kuaishou',
      '6': 'shan-gou',
      '7': 'douyin',
    };
    return map[p] || 'taobao';
  }

  /** 好单库商品字段 → 统一 OfferSnapshot（淘宝/美团 字段名官方文档确认） */
  private toSnapshot(
    item: Record<string, unknown>,
    platform: string,
  ): OfferSnapshot {
    if (platform === 'meituan') {
      // 美团：活动/单品字段
      const originalPrice = Number(item.originalPrice ?? item.sellPrice ?? 0);
      const sellPrice = Number(item.sellPrice ?? originalPrice);
      const commissionRate = Number(item.commissionPercent ?? 0);
      const estCommission =
        Number(item.commission ?? 0) ||
        Number(((sellPrice * commissionRate) / 100).toFixed(2));
      return {
        vendorCode: this.vendorCode,
        platformCode: 'meituan',
        itemId:
          safeStr(item.activityId) ||
          safeStr(item.searchId) ||
          safeStr(item.id),
        title: safeStr(item.name) || safeStr(item.activityName) || '未知商品',
        shopName: safeStr(item.brandName) || null,
        price: originalPrice,
        couponAmount: 0,
        payPrice: sellPrice,
        commissionRate,
        estCommission,
        freight: 0,
        imageUrl: safeStr(item.headUrl) || safeStr(item.activityImage) || null,
        rawJson: item,
      };
    }
    // 淘宝/其他：itemid/itemtitle/itemprice/itemendprice/tkrates/tkmoney/couponmoney
    const price = Number(item.itemprice ?? item.original_price ?? 0);
    const payPrice = Number(item.itemendprice ?? item.item_price ?? price);
    const commissionRate = Number(item.tkrates ?? item.commission_rate ?? 0);
    const estCommission =
      Number(item.tkmoney ?? 0) ||
      Number(((payPrice * commissionRate) / 100).toFixed(2));
    return {
      vendorCode: this.vendorCode,
      platformCode: platform,
      itemId:
        safeStr(item.itemid) ||
        safeStr(item.item_id) ||
        safeStr(item.goods_sign),
      title: safeStr(item.itemtitle) || safeStr(item.item_title) || '未知商品',
      shopName:
        item.shopname || item.shop_name
          ? safeStr(item.shopname || item.shop_name)
          : null,
      price,
      couponAmount: Number(item.couponmoney ?? item.coupon_money ?? 0),
      payPrice,
      commissionRate,
      estCommission,
      freight: 0,
      imageUrl: safeStr(item.itempic) || safeStr(item.item_pic) || null,
      rawJson: item,
    };
  }
}
