import crypto from 'crypto';
import { TenantContext } from './types';
import { makeError } from '../contracts/error-codes';

/**
 * 真实身份校验（原型 mock 版）—— 对齐《补充包》3.1。
 *
 * 生产环境：身份只能由 Kaypal 签名 token（JWT/OAuth2 bearer）在服务端解出，
 * 绝不可信任前端传入的 JSON。本模块用 HMAC-SHA256 模拟该机制：
 *   token = base64url(payloadJson).base64url(hmac(secret, payloadJson))
 * 校验失败（缺 token / 篡改 / 过期 / secret 不匹配）一律抛 UNAUTHORIZED / AUTH_INVALID，
 * 不存在“回退默认租户”的分支。
 */
export interface KaypalTokenConfig {
  baseUrl: string;
  apiKey: string;
}

export class AuthService {
  constructor(
    private readonly secret: string,
    private readonly kaypal?: KaypalTokenConfig,
  ) {}

  /** 签发令牌（真实环境由 Kaypal 网关完成，这里给 mock 用） */
  issue(ctx: TenantContext, ttlMs = 3_600_000): string {
    const payload = { ...ctx, exp: Date.now() + ttlMs };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  /** 校验令牌并返回派生的租户上下文；失败抛异常。
   * 1) 本地 HMAC 签名（内部/测试/旧客户端，向后兼容）
   * 2) Kaypal 正式 access_token（kaypal.cn /api/auth/me 验证，派生 tenant/user）——P0-2 */
  async verify(token: string): Promise<TenantContext> {
    const dot = token.indexOf('.');
    if (dot <= 0) {
      // 非 HMAC 格式（单段）：先尝试 Kaypal 正式 access_token（P0-2）
      const kaypalCtx = await this.kaypalVerify(token);
      if (kaypalCtx) return kaypalCtx;
      throw makeError('AUTH_INVALID', { details: { reason: '令牌格式非法' } });
    }
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto
      .createHmac('sha256', this.secret)
      .update(body)
      .digest('base64url');
    // 定长时间比较，避免时序侧信道
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      // HMAC 不匹配：尝试 Kaypal 正式 token 验证（P0-2）
      const kaypalCtx = await this.kaypalVerify(token);
      if (kaypalCtx) return kaypalCtx;
      throw makeError('AUTH_INVALID', { details: { reason: '签名校验失败' } });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      throw makeError('AUTH_INVALID', { details: { reason: '载荷解析失败' } });
    }
    // P1-6：exp 必须存在且未过期——签名正确但无过期时间的令牌一律拒绝
    if (typeof payload.exp !== 'number') {
      throw makeError('AUTH_INVALID', {
        details: { reason: '令牌缺少过期时间(exp)' },
      });
    }
    if (payload.exp <= Date.now()) {
      throw makeError('SESSION_EXPIRED', { details: { reason: '令牌已过期' } });
    }
    const ctx: TenantContext = {
      tenantId: String((payload.tenantId as string) ?? ''),
      userId: String((payload.userId as string) ?? ''),
      agentId: String((payload.agentId as string) ?? ''),
    };
    if (!ctx.tenantId || !ctx.userId || !ctx.agentId) {
      throw makeError('AUTH_INVALID', {
        details: { reason: '载荷缺少租户字段' },
      });
    }
    return ctx;
  }

  /** Kaypal 正式 access_token 验证（kaypal.cn /api/auth/me）——P0-2 */
  private async kaypalVerify(
    token: string,
  ): Promise<TenantContext | undefined> {
    if (!this.kaypal) return undefined;
    try {
      const res = await fetch(`${this.kaypal.baseUrl}/api/auth/me`, {
        headers: {
          authorization: `Bearer ${token}`,
          'x-kaypal-api-key': this.kaypal.apiKey,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return undefined;
      const d = (await res.json()) as
        { user?: Record<string, unknown> } | Record<string, unknown>;
      const user = (d as { user?: Record<string, unknown> }).user ?? d;
      const rawId = (user as Record<string, unknown>).id;
      const id = typeof rawId === 'string' ? rawId : '';
      if (!id) return undefined;
      return { tenantId: id, userId: id, agentId: 'agent_default' };
    } catch {
      return undefined;
    }
  }
}

/** 从 Authorization: Bearer <token> 或裸 x-kaypal-ctx 抽取令牌并校验；缺失/非法一律拒绝。
 *  返回的 ctx.kaypalAccessToken 是原始 token（Bearer 去除前缀后的纯字符串）——上游用其透传到依赖，
 *  避免服务再用共享凭据代发请求（P3-1：请求级 token 透传）。 */
export async function requireAuth(
  auth: AuthService,
  headerValue: string | undefined,
): Promise<TenantContext> {
  if (!headerValue)
    throw makeError('UNAUTHORIZED', { details: { reason: '缺少身份令牌' } });
  let token = headerValue;
  if (headerValue.toLowerCase().startsWith('bearer ')) {
    token = headerValue.slice(7).trim();
  }
  const ctx = await auth.verify(token);
  // 透传原始 token 给依赖（注意：ctx 是引用，下游写入字段会影响 caller；为安全起见新建对象）
  return { ...ctx, kaypalAccessToken: token };
}
