import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  SavingsAdapter,
  OfferSnapshot,
  TranslinkInput,
  CpsPromoLink,
  OrderSyncResult,
} from '../savings.types';

/**
 * 好单库适配器（P0b 主力：补美团/饿了么 + 万能解析兜底，需求清单 V1.1 §5.2）。
 *
 * 供应商策略（2026-08-09 修订）：大淘客（电商 5 平台）+ 好单库（美团/饿了么 + clipboard 万能解析）
 * 双供应商拼接，按 platformCode 路由（参考开源「苏分宝」mixParse 架构）。
 *
 * 接入说明（好单库开放平台 v3）：
 * - 需在后台 CpsVendor 配置 code=haodanku 的 appId/appSecret（https://www.haodanku.com/openapi/api_apply 创建应用）
 * - 好单库 APP 需授权联盟账号 + PID（返利归因命脉；未授权返回 1018/1019/1020 错误码）
 * - 未配置 Key 时调用返回明确错误码 VENDOR_CREDENTIAL_MISSING（不静默失败）
 *
 * API 规范（语雀官方文档确认，2026-08-09）：
 * - 地址：https://v3.api.haodanku.com/rest（POST + application/json）
 * - 公共参数：method / app_id / sign / date（yyyy-MM-dd HH:mm:ss）
 * - 签名：除 sign 外所有参数按 key 升序 → key+value 直接拼接（无 & 无 =）→ 末尾拼 app_secret
 *   → MD5 加密转大写（strtoupper(md5(...))）
 * - 已确认 method：analyze.taoword（淘口令/链接解析）、powerful.code（万能口令生成）
 * - ⚠️ 其余 method 名按 v3 命名习惯预置，Key 到位后按官方文档校准（搜索/详情/订单）
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
  private readonly baseUrl = 'https://v3.api.haodanku.com/rest';

  /** 好单库 v3 method（命名习惯：域.接口；TODO: Key 到位后校准未确认项） */
  private readonly methods = {
    /** 淘口令/链接解析（已确认） */
    parseTaoword: 'analyze.taoword',
    /** 万能口令生成/转链（已确认） */
    powerfulCode: 'powerful.code',
    /** 商品搜索（预置，待校准） */
    search: 'tbk.search',
    /** 商品详情（预置，待校准） */
    detail: 'tbk.detail',
    /** 订单查询（预置，待校准；错误码 2000=拉取订单失败） */
    orders: 'tbk.order',
  };

  /** 从环境变量读好单库凭证（生产由部署配置注入） */
  private getCredentials(): { appId: string; appSecret: string } {
    const appId = process.env.HAODANKU_APP_ID || '';
    const appSecret = process.env.HAODANKU_APP_SECRET || '';
    return { appId, appSecret };
  }

  private assertReady() {
    const { appId, appSecret } = this.getCredentials();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException({
        code: 'VENDOR_CREDENTIAL_MISSING',
        message:
          '好单库凭证未配置（HAODANKU_APP_ID / HAODANKU_APP_SECRET），请在后台配置后重试',
      });
    }
  }

  /** 请求封装：好单库 v3 签名 + POST JSON */
  private async call<T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertReady();
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
      const res = await fetch(this.baseUrl, {
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
      if (json.code !== 200) {
        // 1018/1019/1020 = 未授权联盟账号（需好单库 APP 授权），单独提示
        const code = json.code;
        if (code === 1018 || code === 1019 || code === 1020) {
          throw new ServiceUnavailableException({
            code: 'VENDOR_AUTH_MISSING',
            message: `好单库未授权对应联盟账号（错误码 ${code}），请用好单库 APP 添加联盟账号+PID`,
          });
        }
        throw new ServiceUnavailableException({
          code: 'VENDOR_API_ERROR',
          message: `好单库接口错误：${json.msg || json.code}（${method}）`,
        });
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async parse(raw: string): Promise<OfferSnapshot> {
    // 好单库淘口令/链接解析（已确认 method）
    const data = await this.call<Record<string, unknown>>(
      this.methods.parseTaoword,
      { taoword: raw },
    );
    return this.toSnapshot(data);
  }

  async search(keyword: string, _platform?: string): Promise<OfferSnapshot[]> {
    // TODO: method 名待 Key 到位后按好单库 v3 文档校准（当前预置 tbk.search）
    const data = await this.call<{ list?: Array<Record<string, unknown>> }>(
      this.methods.search,
      { keyword, page_size: 20 },
    );
    return (data.list || []).map((item) => this.toSnapshot(item));
  }

  async offers(itemId: string, _platform: string): Promise<OfferSnapshot> {
    // TODO: method 名待校准（预置 tbk.detail）
    const data = await this.call<Record<string, unknown>>(this.methods.detail, {
      item_id: itemId,
    });
    return this.toSnapshot(data);
  }

  async translink(input: TranslinkInput): Promise<CpsPromoLink> {
    // 好单库万能口令生成（已确认）：生成淘口令 + 短链，传我们自己 PID 归因
    const pid = process.env.HAODANKU_PID || '';
    const pubName = process.env.HAODANKU_PUB_NAME || '';
    const data = await this.call<{
      powerful_code?: string;
      powerful_url?: string;
    }>(this.methods.powerfulCode, {
      activity_url: input.originalUrl || '',
      pid: pid || undefined,
      pub_name: pubName ? encodeURIComponent(pubName) : undefined,
    });
    const promoUrl = data.powerful_url || data.powerful_code || '';
    if (!promoUrl) {
      throw new ServiceUnavailableException({
        code: 'TRANSLINK_FAILED',
        message: '好单库转链失败：未返回推广链接',
      });
    }
    return {
      vendorCode: this.vendorCode,
      platformCode: input.platformCode,
      itemId: input.itemId,
      originalUrl: input.originalUrl,
      promoUrl,
      idempotencyKey: input.idempotencyKey,
      attribution: input.attribution,
    };
  }

  async orders(_syncPoint?: string): Promise<OrderSyncResult> {
    // TODO: method 名待校准（预置 tbk.order）；好单库订单查询支持按时间段拉取
    const data = await this.call<{
      list?: Array<Record<string, unknown>>;
    }>(this.methods.orders, {
      start_time: _syncPoint || '',
      page_size: 100,
    });
    const orders = (data.list || []).map((item) => ({
      orderNo: safeStr(item.trade_id) || safeStr(item.order_id),
      platformCode: 'taobao',
      itemId: item.item_id ? safeStr(item.item_id) : null,
      payAmount: safeNum(item.pay_price),
      estCommission: safeNum(item.commission),
      status: this.mapOrderStatus(safeStr(item.status)),
      rawStatus: safeStr(item.status),
      paidAt: item.create_time ? safeStr(item.create_time) : null,
    }));
    return { orders, nextSyncPoint: null };
  }

  /** 外部订单状态 → 内部状态映射（V1.1 §7.1；好单库状态值待 Key 后校准） */
  private mapOrderStatus(raw: string): string {
    // TODO: 好单库订单状态枚举待校准（暂按淘系惯例）
    const map: Record<string, string> = {
      PAID: 'PAID',
      SETTLED: 'SETTLED',
      CONFIRMED: 'CONFIRMED',
      INVALID: 'INVALID',
      REFUNDED: 'INVALID',
    };
    return map[raw] || 'SYNCED';
  }

  /** 好单库商品字段 → 统一 OfferSnapshot（字段名待 Key 后校准） */
  private toSnapshot(item: Record<string, unknown>): OfferSnapshot {
    const price = Number(item.actual_price ?? item.price ?? 0);
    const couponAmount = Number(item.coupon_price ?? item.coupon ?? 0);
    const commissionRate = Number(item.commission_rate ?? 0);
    const payPrice = Number(item.pay_price ?? price);
    const estCommission = Number(
      ((payPrice * commissionRate) / 100).toFixed(2),
    );
    return {
      vendorCode: this.vendorCode,
      platformCode: safeStr(item.platform, 'taobao'),
      itemId: safeStr(item.item_id) || safeStr(item.id),
      title: safeStr(item.title) || safeStr(item.item_title) || '未知商品',
      shopName: item.shop_name ? safeStr(item.shop_name) : null,
      price,
      couponAmount,
      payPrice,
      commissionRate,
      estCommission,
      freight: Number(item.freight || 0),
      imageUrl: item.pic_url ? safeStr(item.pic_url) : null,
      rawJson: item,
    };
  }
}
