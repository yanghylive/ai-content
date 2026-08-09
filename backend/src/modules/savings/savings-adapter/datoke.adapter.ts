import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  SavingsAdapter,
  OfferSnapshot,
  TranslinkInput,
  CpsPromoLink,
  OrderSyncResult,
} from '../savings.types';

/**
 * 大淘客适配器（P0 默认供应商，需求清单 V1.1 §5.2）。
 *
 * 接入说明：
 * - 需在后台 CpsVendor 配置 code=datoke 的 appKey/appSecret（大淘客开发者平台申请）
 * - 支持传我们自己的 PID（佣金结算到我们联盟账户，后期替换官方直连无痛）
 * - 未配置 Key 时调用返回明确错误码 VENDOR_CREDENTIAL_MISSING（不静默失败）
 *
 * 大淘客 API 文档：https://www.dataoke.com/kfpt/api-d.html
 * 签名：MD5(按 key 排序的参数拼接 + appSecret)，POST JSON
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
export class DatokeAdapter implements SavingsAdapter {
  readonly vendorCode = 'datoke';
  private readonly baseUrl = 'https://openapi.dataoke.com/api';

  /** 从环境变量读大淘客凭证（生产由部署配置注入） */
  private getCredentials(): { appKey: string; appSecret: string } {
    const appKey = process.env.DATOKE_APP_KEY || '';
    const appSecret = process.env.DATOKE_APP_SECRET || '';
    return { appKey, appSecret };
  }

  private assertReady() {
    const { appKey, appSecret } = this.getCredentials();
    if (!appKey || !appSecret) {
      throw new ServiceUnavailableException({
        code: 'VENDOR_CREDENTIAL_MISSING',
        message:
          '大淘客凭证未配置（DATOKE_APP_KEY / DATOKE_APP_SECRET），请在后台配置后重试',
      });
    }
  }

  /** 请求封装：签名 + POST JSON */
  private async call<T>(
    endpoint: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.assertReady();
    const { appKey, appSecret } = this.getCredentials();
    const body = {
      appKey,
      version: 'v1.3.2',
      ...params,
    };
    // 签名：参数按 key 排序拼接 + secret，MD5（大淘客 v1.3 规范）
    const sorted = Object.keys(body)
      .sort()
      .map((k) => `${k}${String(body[k])}`)
      .join('');
    const crypto = await import('node:crypto');
    const sign = crypto
      .createHash('md5')
      .update(sorted + appSecret)
      .digest('hex');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
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
      if (json.code !== 0 && json.code !== 200) {
        throw new ServiceUnavailableException({
          code: 'VENDOR_API_ERROR',
          message: `大淘客接口错误：${json.msg || json.code}`,
        });
      }
      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async parse(raw: string): Promise<OfferSnapshot> {
    // 大淘客万能解析：商品链接/淘口令 → 商品信息
    const data = await this.call<Record<string, unknown>>(
      '/goods/parse-goods',
      {
        content: raw,
      },
    );
    return this.toSnapshot(data);
  }

  async search(keyword: string, _platform?: string): Promise<OfferSnapshot[]> {
    // 大淘客超级搜索（默认淘宝；platform 过滤由业务层处理）
    const data = await this.call<{ list?: Array<Record<string, unknown>> }>(
      '/goods/get-goods-list',
      { keyWords: keyword, pageSize: 20 },
    );
    return (data.list || []).map((item) => this.toSnapshot(item));
  }

  async offers(itemId: string, _platform: string): Promise<OfferSnapshot> {
    // 商品详情 + 优惠券
    const data = await this.call<Record<string, unknown>>(
      '/goods/get-goods-details',
      {
        goodsId: itemId,
      },
    );
    return this.toSnapshot(data);
  }

  async translink(input: TranslinkInput): Promise<CpsPromoLink> {
    // 大淘客转链（传我们自己的 PID，佣金结算到我们账户）
    const pid = process.env.DATOKE_PID || '';
    const data = await this.call<{
      goodsId?: string;
      couponUrl?: string;
      tpwd?: string;
    }>('/tb-service/get-privilege-link', {
      goodsId: input.itemId,
      pid: pid || undefined,
      channelId: input.attribution?.relationId || undefined,
    });
    const promoUrl = data.couponUrl || data.tpwd || '';
    if (!promoUrl) {
      throw new ServiceUnavailableException({
        code: 'TRANSLINK_FAILED',
        message: '大淘客转链失败：未返回推广链接',
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
    // 大淘客订单查询（分页游标）
    const data = await this.call<{
      list?: Array<Record<string, unknown>>;
      pageId?: string;
    }>('/tb-service/get-order-details', {
      pageSize: 100,
      queryType: 3,
      positionIndex: _syncPoint || '',
    });
    const orders = (data.list || []).map((item) => ({
      orderNo: safeStr(item.tradeId) || safeStr(item.orderId),
      platformCode: 'taobao',
      itemId: item.goodsId ? safeStr(item.goodsId) : null,
      payAmount: safeNum(item.payPrice),
      estCommission: safeNum(item.estimateAmount),
      status: this.mapOrderStatus(safeStr(item.orderStatus)),
      rawStatus: safeStr(item.orderStatus),
      paidAt: item.orderCreateTime ? safeStr(item.orderCreateTime) : null,
    }));
    return { orders, nextSyncPoint: data.pageId || null };
  }

  /** 外部订单状态 → 内部状态映射（V1.1 §7.1） */
  private mapOrderStatus(raw: string): string {
    // 淘宝联盟订单状态：12-付款，3-结算，13-失效，14-成功
    const map: Record<string, string> = {
      '12': 'PAID',
      '13': 'INVALID',
      '14': 'CONFIRMED',
      '3': 'SETTLED',
    };
    return map[raw] || 'SYNCED';
  }

  /** 大淘客商品字段 → 统一 OfferSnapshot */
  private toSnapshot(item: Record<string, unknown>): OfferSnapshot {
    const price = Number(item.actualPrice ?? item.originalPrice ?? 0);
    const couponAmount = Number(item.couponPrice ?? item.couponAmount ?? 0);
    const commissionRate = Number(item.commissionRate ?? 0);
    const payPrice = Number(item.actualPrice ?? price);
    const estCommission = Number(
      ((payPrice * commissionRate) / 100).toFixed(2),
    );
    return {
      vendorCode: this.vendorCode,
      platformCode: safeStr(item.platform, 'taobao'),
      itemId: safeStr(item.goodsId) || safeStr(item.id),
      title: safeStr(item.title) || safeStr(item.goodsName) || '未知商品',
      shopName: item.shopName ? safeStr(item.shopName) : null,
      price,
      couponAmount,
      payPrice,
      commissionRate,
      estCommission,
      freight: Number(item.freight || 0),
      imageUrl: item.mainPic ? safeStr(item.mainPic) : null,
      rawJson: item,
    };
  }
}
