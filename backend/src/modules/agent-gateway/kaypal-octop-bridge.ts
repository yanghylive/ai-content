import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 取第一个非空字符串；对 unknown 做 typeof 守卫避免 no-base-to-string */
function firstNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export interface KaypalLoginResult {
  kaypalUserId?: string;
  phone?: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: Record<string, unknown>;
}

/**
 * Kaypal.cn → Octop 登录桥。
 * 目标：Octop 的访问控制以 kaypal.cn 用户体系为准。
 * 流程：
 *   1) kaypal 登录（/api/desktop-auth/password，应用凭据 x-kaypal-api-key）验证用户
 *   2) 桥用 Octop 管理凭据（env OCTOP_SETUP_PASSWORD / OCTOP_ACCESS_TOKEN）
 *      换 Octop access token，代理 Octop API 调用
 * 凭据只从 env/ConfigService 读取，不落盘不进仓库。
 * 说明：Octop 0.9.26 SSO 是标准 OIDC（kaypal.cn 无 OIDC discovery），
 * 故采用「后端代理」而非 SSO 直连；谁能用 Octop 由 kaypal.cn 用户体系决定。
 */
@Injectable()
export class KaypalOctopBridge {
  constructor(private readonly config: ConfigService) {}

  private kaypalBase(): string {
    return (
      this.config.get<string>('KAYPAL_AUTH_BASE_URL')?.trim() ||
      'https://kaypal.cn'
    );
  }

  private kaypalApiKey(): string {
    return (
      this.config.get<string>('KAYPAL_BILLING_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
      ''
    );
  }

  private octopBase(): string {
    return process.env.OCTOP_BASE_URL?.trim() || 'http://127.0.0.1:8088';
  }

  /** 1) Kaypal.cn 用户登录（实测端点：POST /api/desktop-auth/password） */
  async loginKaypal(
    phone: string,
    password: string,
  ): Promise<KaypalLoginResult> {
    const apiKey = this.kaypalApiKey();
    if (!apiKey) throw new Error('KAYPAL_API_KEY 未配置');
    const res = await fetch(`${this.kaypalBase()}/api/desktop-auth/password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-kaypal-api-key': apiKey,
        accept: 'application/json',
      },
      body: JSON.stringify({
        phone,
        password,
        device_id: 'octop-bridge',
        device_name: 'octop-bridge',
        platform: 'desktop',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Kaypal 登录失败 HTTP ${res.status}`);
    }
    const d = (await res.json()) as Record<string, unknown>;
    const accessToken = firstNonEmptyString(d.access_token, d.accessToken);
    if (!accessToken) throw new Error('Kaypal 登录失败：未返回 access_token');
    return {
      kaypalUserId: (d.user as Record<string, unknown> | undefined)?.id
        ? String((d.user as Record<string, unknown>).id)
        : undefined,
      phone,
      accessToken,
      refreshToken: (d.refresh_token as string) ?? undefined,
      expiresIn: (d.expires_in as number) ?? undefined,
      user: (d.user as Record<string, unknown>) ?? undefined,
    };
  }

  /** 2) 桥持 Octop 凭据换 Octop access token（用户凭据或 access token 直用） */
  async loginOctop(): Promise<{ token: string; expiresAt: string }> {
    const direct = process.env.OCTOP_ACCESS_TOKEN?.trim();
    if (direct)
      return {
        token: direct,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      };
    const username = process.env.OCTOP_USERNAME?.trim();
    const password =
      process.env.OCTOP_PASSWORD?.trim() ??
      process.env.OCTOP_SETUP_PASSWORD?.trim();
    if (!username || !password) {
      throw new Error(
        'OCTOP_USERNAME/OCTOP_PASSWORD（或 OCTOP_ACCESS_TOKEN）未配置',
      );
    }
    const res = await fetch(`${this.octopBase()}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Octop 登录失败 HTTP ${res.status}`);
    const d = (await res.json()) as Record<string, unknown>;
    const token =
      firstNonEmptyString(d.access_token, d.accessToken, d.token) ?? '';
    if (!token) throw new Error('Octop 登录失败：未返回 token');
    return {
      token,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
  }

  /** 端到端：Kaypal 用户登录通过 → 返回可代理 Octop 的 token */
  async authenticate(
    phone: string,
    password: string,
  ): Promise<{
    kaypal: KaypalLoginResult;
    octop: { token: string; expiresAt: string };
  }> {
    const kaypal = await this.loginKaypal(phone, password);
    const octop = await this.loginOctop();
    return { kaypal, octop };
  }
}
