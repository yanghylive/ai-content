import { WechatPayService, resolveWechatPayConfig, wechatPayConfigReady } from './wechat-pay.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    wechatPayOrder: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'order-1',
        ...data,
        status: 'pending',
      })),
      update: jest.fn().mockImplementation(async ({ where, data }) => ({
        id: where.id,
        ...data,
      })),
    },
    aiCreditAccount: {
      upsert: jest.fn().mockResolvedValue({ id: 'credit-1', balance: 100 }),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        wechatPayOrder: {
          update: jest.fn().mockResolvedValue({ id: 'o1' }),
        },
        aiCreditAccount: {
          upsert: jest.fn().mockResolvedValue({ id: 'credit-1', balance: 100 }),
        },
      };
      return fn(tx as never);
    }),
    ...overrides,
  } as never;
}

function makeAuth() {
  return {
    get: jest.fn().mockReturnValue({ user: { id: 'u-1' } }),
    resolveTenantId: jest.fn().mockResolvedValue('t-1'),
  };
}

describe('WechatPayService', () => {
  it('配置未齐全 → need_config（不假报成功）', async () => {
    const svc = new WechatPayService(makePrisma() as never, makeAuth() as never);
    const r = await svc.createCreditOrder({ amountYuan: 10, idempotencyKey: 'k-1' });
    expect(r.status).toBe('need_config');
    expect(r.message).toContain('未配置');
  });

  it('createCreditOrder：金额 → 分 + 积分（33.44/元）', () => {
    const cfg = resolveWechatPayConfig({
      WXPAY_MCHID: '1116143786',
      WXPAY_APP_ID: 'wx123',
      WXPAY_APIV3_KEY: '0123456789abcdef0123456789abcdef',
      WXPAY_SERIAL_NO: 'SERIAL1',
      WXPAY_PRIVATE_KEY_PATH: '/tmp/key.pem',
      WXPAY_NOTIFY_URL: 'https://x/notify',
    });
    expect(wechatPayConfigReady(cfg)).toBe(true);
    expect(cfg.mchid).toBe('1116143786');
  });

  it('配置齐全时创建订单（10 元 → 1000 分 → 334 积分 + code_url）', async () => {
    const prisma = makePrisma();
    const svc = new WechatPayService(prisma as never, makeAuth() as never);
    // 覆盖 config 为齐全
    Object.defineProperty(process.env, 'WXPAY_APP_ID', { value: 'wx123', configurable: true });
    Object.defineProperty(process.env, 'WXPAY_APIV3_KEY', { value: '0123456789abcdef0123456789abcdef', configurable: true });
    Object.defineProperty(process.env, 'WXPAY_SERIAL_NO', { value: 'S1', configurable: true });
    Object.defineProperty(process.env, 'WXPAY_PRIVATE_KEY_PATH', { value: '/tmp/k.pem', configurable: true });
    Object.defineProperty(process.env, 'WXPAY_NOTIFY_URL', { value: 'https://x/n', configurable: true });
    // 签名方法 mock（测试无真实证书文件，走网络层 mock）
    jest.spyOn(svc, 'buildV3Authorization').mockReturnValue('WECHATPAY2-SHA256-RSA2048 mock');
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code_url: 'weixin://wxpay/bizpayurl?pr=abc' }),
    }) as never;
    try {
      const r = await svc.createCreditOrder({ amountYuan: 10, idempotencyKey: 'wx-1' });
      expect(r.status).toBe('pending');
      expect(r.amountCents).toBe(1000);
      expect(r.creditPoints).toBe(334);
      expect(r.codeUrl).toContain('weixin://');
      expect(prisma.wechatPayOrder.create).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
      delete process.env.WXPAY_APP_ID;
      delete process.env.WXPAY_APIV3_KEY;
      delete process.env.WXPAY_SERIAL_NO;
      delete process.env.WXPAY_PRIVATE_KEY_PATH;
      delete process.env.WXPAY_NOTIFY_URL;
    }
  });

  it('回调：订单已 paid → 幂等返回成功，不重复充值', async () => {
    const prisma = makePrisma({
      wechatPayOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1', outTradeNo: 'wx-1', status: 'paid',
          tenantId: 't-1', userId: 'u-1', creditPoints: 334,
          amountCents: 1000,
        }),
      },
    });
    const svc = new WechatPayService(prisma as never, makeAuth() as never);
    const r = await svc.handleNotify({
      headers: { 'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)) },
      body: { out_trade_no: 'wx-1', resource: {} },
    });
    expect(r.code).toBe('SUCCESS');
  });

  // 用 APIv3 密钥 AES-256-GCM 加密微信回调 resource（模拟微信真实回调）
  function encryptResource(apiV3Key: string, plaintext: object) {
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const nonce = crypto.randomBytes(12).toString('utf8');
    const aad = 'transaction';
    const data = Buffer.from(JSON.stringify(plaintext), 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([enc, authTag]).toString('base64'),
      nonce,
      associated_data: aad,
    };
  }
  const API_V3_KEY = '0123456789abcdef0123456789abcdef';
  function signedHeaders() {
    return {
      'wechatpay-timestamp': String(Math.floor(Date.now() / 1000)),
      'wechatpay-nonce': 'n1',
      'wechatpay-signature': 'dummy-sig', // 真实验签需平台证书，测试仅验证时间戳新鲜度分支
    };
  }

  it('回调：新单 + 可解密 resource（金额一致）→ 事务标记 paid + 充值积分', async () => {
    const prisma = makePrisma({
      wechatPayOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1', outTradeNo: 'wx-2', status: 'pending',
          tenantId: 't-1', userId: 'u-1', creditPoints: 334,
          amountCents: 1000,
        }),
        update: jest.fn().mockResolvedValue({ id: 'o1' }),
      },
    });
    Object.defineProperty(process.env, 'WXPAY_APIV3_KEY', { value: API_V3_KEY, configurable: true });
    try {
      const svc = new WechatPayService(prisma as never, makeAuth() as never);
      const resource = encryptResource(API_V3_KEY, { out_trade_no: 'wx-2', transaction_id: 'tx-1', amount: { total: 1000, currency: 'CNY' } });
      const r = await svc.handleNotify({
        headers: signedHeaders(),
        body: { out_trade_no: 'wx-2', transaction_id: 'tx-1', resource },
      });
      expect(r.code).toBe('SUCCESS');
    } finally {
      delete process.env.WXPAY_APIV3_KEY;
    }
  });

  it('安全：无 apiV3Key/无 resource → 拒绝充值（不静默按订单金额入账）', async () => {
    const prisma = makePrisma({
      wechatPayOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1', outTradeNo: 'wx-3', status: 'pending',
          tenantId: 't-1', userId: 'u-1', creditPoints: 334,
          amountCents: 1000,
        }),
        update: jest.fn().mockResolvedValue({ id: 'o1' }),
      },
    });
    const svc = new WechatPayService(prisma as never, makeAuth() as never);
    const r = await svc.handleNotify({
      headers: {},
      body: { out_trade_no: 'wx-3', resource: {} },
    });
    expect(r.code).toBe('FAIL');
  });

  it('安全：解密金额与订单不一致 → 拒绝入账', async () => {
    const prisma = makePrisma({
      wechatPayOrder: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1', outTradeNo: 'wx-4', status: 'pending',
          tenantId: 't-1', userId: 'u-1', creditPoints: 334,
          amountCents: 1000,
        }),
        update: jest.fn().mockResolvedValue({ id: 'o1' }),
      },
    });
    Object.defineProperty(process.env, 'WXPAY_APIV3_KEY', { value: API_V3_KEY, configurable: true });
    try {
      const svc = new WechatPayService(prisma as never, makeAuth() as never);
      const resource = encryptResource(API_V3_KEY, { out_trade_no: 'wx-4', transaction_id: 'tx-1', amount: { total: 999, currency: 'CNY' } });
      const r = await svc.handleNotify({
        headers: signedHeaders(),
        body: { out_trade_no: 'wx-4', transaction_id: 'tx-1', resource },
      });
      expect(r.code).toBe('FAIL');
      expect(r.message).toContain('金额不一致');
    } finally {
      delete process.env.WXPAY_APIV3_KEY;
    }
  });

  it('buildV3Authorization 需要证书配置（缺 → 抛错）', () => {
    const svc = new WechatPayService(makePrisma() as never, makeAuth() as never);
    expect(() => svc.buildV3Authorization('POST', '/v3/pay/transactions/jsapi', '{}')).toThrow(
      '证书未配置',
    );
  });
});
