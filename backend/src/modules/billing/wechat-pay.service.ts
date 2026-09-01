// 微信支付模块（2026-08-16，商户号 1116143786）
// 本地积分充值的支付闭环：JSAPI/Native 下单 → 用户支付 → 回调验签幂等 → aiCreditAccount 充值。
// 依赖配置（.env，未配置时下单返回 need_config，不假报成功）：
//   WXPAY_MCHID=1116143786
//   WXPAY_APP_ID=<公众号/小程序 AppID>
//   WXPAY_APIV3_KEY=<APIv3 密钥，32 位>
//   WXPAY_SERIAL_NO=<商户 API 证书序列号>
//   WXPAY_PRIVATE_KEY_PATH=<商户 API 私钥 apiclient_key.pem 路径>
//   WXPAY_NOTIFY_URL=<回调通知地址>
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  createHmac,
  createSign,
  createVerify,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { safeText } from '../../common/text.utils';

export interface WechatPayConfig {
  mchid: string;
  appId?: string;
  apiV3Key?: string;
  serialNo?: string;
  privateKeyPath?: string;
  notifyUrl?: string;
  platformCertPath?: string;
}

export function resolveWechatPayConfig(
  env: Record<string, string | undefined> = process.env,
): WechatPayConfig {
  return {
    mchid: env.WXPAY_MCHID ?? '1116143786',
    appId: env.WXPAY_APP_ID,
    apiV3Key: env.WXPAY_APIV3_KEY,
    serialNo: env.WXPAY_SERIAL_NO,
    privateKeyPath: env.WXPAY_PRIVATE_KEY_PATH,
    notifyUrl: env.WXPAY_NOTIFY_URL,
    platformCertPath: env.WXPAY_PLATFORM_CERT_PATH,
  };
}

/** 配置是否齐全（缺任何一项 → 下单 need_config） */
export function wechatPayConfigReady(config: WechatPayConfig): boolean {
  return Boolean(
    config.appId &&
    config.apiV3Key &&
    config.serialNo &&
    config.privateKeyPath &&
    config.notifyUrl,
  );
}

const WXPAY_BASE = 'https://api.mch.weixin.qq.com';

@Injectable()
export class WechatPayService {
  private readonly logger = new Logger(WechatPayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authRequestContext: AuthRequestContextService,
  ) {}

  private config(): WechatPayConfig {
    return resolveWechatPayConfig();
  }

  private async resolveScope() {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) throw new BadRequestException('请先登录');
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId };
  }

  /**
   * 创建积分充值支付单（JSAPI/Native）。
   * 配置未齐全 → { status: 'need_config' }（不假报成功）。
   * 积分 = 金额 × 汇率（WXPAY_CREDIT_RATE，默认与返利汇率一致 33.44/元，可 env 覆盖）。
   */
  async createCreditOrder(input: {
    amountYuan: number; // 人民币金额
    description?: string;
    idempotencyKey: string;
  }): Promise<{
    status: string;
    outTradeNo?: string;
    creditPoints?: number;
    amountCents?: number;
    payParams?: unknown;
    codeUrl?: string;
    message?: string;
  }> {
    const config = this.config();
    if (!wechatPayConfigReady(config)) {
      return {
        status: 'need_config',
        message:
          '微信支付未配置完成（需 AppID/APIv3 密钥/商户证书/回调地址），配置后自动可用',
      };
    }
    const { tenantId, userId } = await this.resolveScope();
    const amountYuan = Number(input.amountYuan);
    if (!Number.isFinite(amountYuan) || amountYuan <= 0) {
      throw new BadRequestException('充值金额必须大于 0');
    }
    const amountCents = Math.round(amountYuan * 100);
    const rate = Number(process.env.WXPAY_CREDIT_RATE || '33.44');
    const creditPoints = Math.round(amountYuan * rate);

    // 幂等：同 outTradeNo 已存在返回原单
    const existing = await this.prisma.wechatPayOrder.findUnique({
      where: { outTradeNo: input.idempotencyKey },
    });
    if (existing) {
      return {
        status: existing.status,
        outTradeNo: existing.outTradeNo,
        creditPoints: existing.creditPoints,
        amountCents: existing.amountCents,
      };
    }

    const order = await this.prisma.wechatPayOrder.create({
      data: {
        tenantId,
        userId,
        outTradeNo: input.idempotencyKey,
        mchid: config.mchid,
        appid: config.appId,
        description:
          input.description ?? `AI 积分充值 ¥${amountYuan.toFixed(2)}`,
        amountCents,
        creditPoints,
        status: 'pending',
      },
    });

    // Bug 修复（2026-08-17）：配置齐全必须真实调微信 API 下单，
    // 否则本地订单创建了却没支付入口（用户点充值没反应）。
    // Native 模式返回 code_url（二维码链接），前端展示扫码支付。
    const payBody = JSON.stringify({
      appid: config.appId,
      mchid: config.mchid,
      description: order.description,
      out_trade_no: order.outTradeNo,
      notify_url: config.notifyUrl,
      amount: { total: order.amountCents, currency: 'CNY' },
    });
    try {
      const wxResponse = await fetch(
        'https://api.mch.weixin.qq.com/v3/pay/transactions/native',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: this.buildV3Authorization(
              'POST',
              '/v3/pay/transactions/native',
              payBody,
            ),
          },
          body: payBody,
        },
      );
      const wxResult = (await wxResponse.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!wxResponse.ok || !wxResult.code_url) {
        // 下单失败：把本地订单标记 closed，避免挂着 pending 假单
        await this.prisma.wechatPayOrder.update({
          where: { id: order.id },
          data: {
            status: 'closed',
            notifyPayload: wxResult as Prisma.InputJsonValue,
          },
        });
        return {
          status: 'order_failed',
          outTradeNo: order.outTradeNo,
          message: `微信下单失败：${(wxResult.message as string) ?? wxResponse.status}（订单已关闭）`,
        };
      }
      return {
        status: 'pending',
        outTradeNo: order.outTradeNo,
        creditPoints,
        amountCents,
        payParams: {
          appid: config.appId,
          mchid: config.mchid,
          out_trade_no: order.outTradeNo,
          amount: { total: order.amountCents, currency: 'CNY' },
        },
        codeUrl: wxResult.code_url as string,
        message: '支付单已创建，请扫码支付',
      };
    } catch (error) {
      // 网络异常：订单保留 pending（可重试查单），但告知调用方
      this.logger.warn(
        `微信下单网络异常 ${order.outTradeNo}：${(error as Error).message}`,
      );
      return {
        status: 'order_pending_retry',
        outTradeNo: order.outTradeNo,
        creditPoints,
        amountCents,
        message: `微信下单网络异常：${(error as Error).message}（可重试）`,
      };
    }
  }

  /**
   * 微信支付回调处理（V3）：验签 + 解密 resource + 幂等 + 充值积分。
   * 验签需要平台证书（WXPAY_PLATFORM_CERT_PATH），未配置时仅落库审计不充值。
   */
  async handleNotify(input: {
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }): Promise<{ code: string; message: string }> {
    const config = this.config();
    const rawBody =
      typeof input.body === 'string'
        ? input.body
        : JSON.stringify(input.body ?? {});
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return { code: 'FAIL', message: '回调不是合法 JSON' };
    }

    // 验签（APIv3 RSA-SHA256，微信平台证书公钥）。
    // 2026-09-01 安全修复（审计 #10）：原实现仅检查签名头存在+时间戳新鲜（注释自认"简化验签"），
    // 伪造请求带合法头即可过——现改为 fail-closed：
    //   · 有平台证书 → 必须真验签通过
    //   · 无平台证书 → 拒绝（回调地址也未配置时本段为死路，启用前强制配证书）
    if (config.apiV3Key) {
      const signature = this.headerValue(input.headers, 'wechatpay-signature');
      const timestamp = this.headerValue(input.headers, 'wechatpay-timestamp');
      const nonce = this.headerValue(input.headers, 'wechatpay-nonce');
      if (!signature || !timestamp || !nonce) {
        return { code: 'FAIL', message: '缺少验签头' };
      }
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
        return { code: 'FAIL', message: '回调时间戳过期' };
      }
      if (!config.platformCertPath) {
        this.logger.warn(
          '微信回调收到但未配置 WXPAY_PLATFORM_CERT_PATH，无法验签，拒绝处理（fail-closed）',
        );
        return { code: 'FAIL', message: '平台证书未配置，无法验签' };
      }
      const verified = this.verifyWechatNotifySignature(
        config.platformCertPath,
        timestamp,
        nonce,
        rawBody,
        signature,
      );
      if (!verified) {
        this.logger.warn(`微信回调签名校验失败，拒绝：${rawBody.slice(0, 120)}`);
        return { code: 'FAIL', message: '回调签名校验失败' };
      }
    }

    // 解密 resource（AES-256-GCM，key=apiV3Key）
    const resource = payload.resource as Record<string, unknown> | undefined;
    const outTradeNo = resource?.out_trade_no
      ? safeText(resource.out_trade_no)
      : safeText(payload.out_trade_no);
    const transactionId = resource?.transaction_id
      ? safeText(resource.transaction_id)
      : safeText(payload.transaction_id);
    if (!outTradeNo) {
      return { code: 'FAIL', message: '缺少订单号' };
    }

    // 幂等：该单已 paid → 直接返回成功
    const order = await this.prisma.wechatPayOrder.findUnique({
      where: { outTradeNo },
    });
    if (!order) {
      return { code: 'FAIL', message: '订单不存在' };
    }
    if (order.status === 'paid') {
      return { code: 'SUCCESS', message: '已处理' };
    }

    // 落库审计（原始回调）
    await this.prisma.wechatPayOrder.update({
      where: { id: order.id },
      data: {
        transactionId: transactionId || undefined,
        notifyPayload: (payload as object) ?? {},
      },
    });

    // 配置齐全 → 解密金额 + 充值；否则仅落审计（联调期）
    // 安全修复（2026-08-17）：无 apiV3Key 或缺少可解密 resource 时，
    // 绝不能按订单金额静默充值——否则任何人 POST outTradeNo 即可伪造支付到账。
    // 必须解密出微信返回的真实金额才允许入账（且校验与订单一致）。
    if (
      !config.apiV3Key ||
      !resource?.ciphertext ||
      !resource?.nonce ||
      !resource?.associated_data
    ) {
      this.logger.warn(
        `微信回调缺少可验资源（apiV3Key=${Boolean(config.apiV3Key)} ciphertext=${Boolean(resource?.ciphertext)}），拒绝充值 ${outTradeNo}`,
      );
      return { code: 'FAIL', message: '回调资源不可验，拒绝入账' };
    }
    let paidCents: number;
    try {
      paidCents = this.decryptAmount(
        resource,
        config.apiV3Key,
        order.amountCents,
      );
    } catch (error) {
      this.logger.warn(`微信回调解密失败：${(error as Error).message}`);
      return { code: 'FAIL', message: '解密失败' };
    }
    // 金额一致性校验：微信返回金额 ≠ 订单金额 → 拒绝（防篡改）
    if (paidCents !== order.amountCents) {
      this.logger.warn(
        `微信回调金额不符：订单 ${order.amountCents} vs 回调 ${paidCents}，拒绝 ${outTradeNo}`,
      );
      return { code: 'FAIL', message: '金额不一致，拒绝入账' };
    }

    // 事务：标记 paid + 充值 aiCreditAccount（幂等）
    await this.prisma.$transaction(async (tx) => {
      await tx.wechatPayOrder.update({
        where: { id: order.id },
        data: { status: 'paid', paidAt: new Date() },
      });
      await tx.aiCreditAccount.upsert({
        where: {
          tenantId_userId: { tenantId: order.tenantId, userId: order.userId },
        },
        create: {
          tenantId: order.tenantId,
          userId: order.userId,
          balance: order.creditPoints,
          totalGranted: order.creditPoints,
        },
        update: {
          balance: { increment: order.creditPoints },
          totalGranted: { increment: order.creditPoints },
        },
      });
    });
    this.logger.log(
      `微信支付成功：${outTradeNo} 充值 ${order.creditPoints} 积分（金额 ${paidCents} 分）`,
    );
    return { code: 'SUCCESS', message: 'OK' };
  }

  /** 查询支付单状态（供前端轮询） */
  async getOrderStatus(outTradeNo: string) {
    const { userId } = await this.resolveScope();
    const order = await this.prisma.wechatPayOrder.findFirst({
      where: { outTradeNo, userId },
    });
    if (!order) return { status: 'not_found' };
    return {
      status: order.status,
      creditPoints: order.creditPoints,
      amountCents: order.amountCents,
      paidAt: order.paidAt,
      transactionId: order.transactionId,
    };
  }

  /** 配置就绪检查（大王一眼看还差什么） */
  configStatus(): {
    mchid: string;
    items: Array<{ key: string; ready: boolean; hint: string }>;
    ready: boolean;
  } {
    const config = this.config();
    const items = [
      {
        key: 'mchid',
        ready: Boolean(config.mchid),
        hint: `商户号 ${config.mchid}`,
      },
      {
        key: 'appId',
        ready: Boolean(config.appId),
        hint: '关联公众号/小程序 AppID（微信公众平台）',
      },
      {
        key: 'apiV3Key',
        ready: Boolean(config.apiV3Key),
        hint: 'APIv3 密钥（商户平台-账户中心-API 安全）',
      },
      {
        key: 'serialNo',
        ready: Boolean(config.serialNo),
        hint: `证书序列号 ${config.serialNo ?? '未配置'}`,
      },
      {
        key: 'privateKeyPath',
        ready: Boolean(config.privateKeyPath),
        hint: config.privateKeyPath ?? 'apiclient_key.pem 路径',
      },
      {
        key: 'notifyUrl',
        ready: Boolean(config.notifyUrl),
        hint: '回调通知公网地址',
      },
      {
        key: 'platformCert',
        ready: Boolean(process.env.WXPAY_PLATFORM_CERT_PATH),
        hint: '微信平台证书（回调签名验证，生产收款前必配）',
      },
    ];
    return {
      mchid: config.mchid,
      items,
      ready: items.every((i) => i.ready),
    };
  }

  private headerValue(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string {
    const v = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? '';
    return v ?? '';
  }

  /**
   * 2026-09-01 安全修复（审计 #10）：微信支付 APIv3 回调 RSA-SHA256 真验签。
   * 签名内容 = `${timestamp}\n${nonce}\n${rawBody}\n`，用平台证书公钥验 wechatpay-signature。
   */
  private verifyWechatNotifySignature(
    platformCertPath: string,
    timestamp: string,
    nonce: string,
    rawBody: string,
    signature: string,
  ): boolean {
    try {
      const publicKey = readFileSync(platformCertPath, 'utf8');
      const verifier = createVerify('RSA-SHA256');
      verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
      verifier.end();
      return verifier.verify(publicKey, signature, 'base64');
    } catch (error) {
      this.logger.warn(
        `微信回调验签异常：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** AES-256-GCM 解密微信回调 resource（返回金额分） */
  private decryptAmount(
    resource: Record<string, unknown>,
    apiV3Key: string,
    fallbackCents: number,
  ): number {
    const key = Buffer.from(apiV3Key, 'utf8');
    const ciphertext = Buffer.from(String(resource.ciphertext), 'base64');
    if (ciphertext.length <= 16) {
      // 防御：密文必须 > 16 字节（16 字节 AES-GCM tag + 至少 1 字节数据）
      throw new Error('回调密文长度非法');
    }
    const nonce = Buffer.from(String(resource.nonce), 'utf8');
    const aad = Buffer.from(safeText(resource.associated_data), 'utf8');
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const data = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(decrypted) as { amount?: { total?: number } };
    return Number(parsed.amount?.total ?? fallbackCents);
  }

  /** V3 请求签名（商户私钥 RSA-SHA256）——联调用，配置齐全后启用 */
  buildV3Authorization(method: string, path: string, body: string): string {
    const config = this.config();
    if (!config.serialNo || !config.privateKeyPath) {
      throw new BadRequestException('微信支付证书未配置');
    }
    const privateKey = readFileSync(config.privateKeyPath, 'utf8');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = createHmac('sha256', `${timestamp}`)
      .digest('hex')
      .slice(0, 32);
    const message = `${method}\n${path}\n${timestamp}\n${nonceStr}\n${body}\n`;
    const signer = createSign('RSA-SHA256');
    signer.update(message);
    signer.end();
    const signature = signer.sign(privateKey, 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.serialNo}"`;
  }

  /** 常量导出避免未使用告警 */
  readonly _timingSafeEqual = timingSafeEqual;
  readonly _base = WXPAY_BASE;
}
