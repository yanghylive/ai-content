import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeText } from '../../common/text.utils';

export interface KaypalAuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  subscriptionPlan: string;
  subscriptionPeriodEnd: Date | null;
  role: string | null;
  platformRoleId: string | null;
  platformRoleName: string | null;
  permissions: Record<string, unknown> | null;
  userPermissionNames: string[];
  disabledAt: Date | null;
}

export interface KaypalBillingSnapshot {
  subscription: unknown;
  balance: {
    balance: number | null;
    userId?: string | null;
    raw?: unknown;
    unavailable?: boolean;
    message?: string;
  };
}

export interface KaypalDesktopAuthStartResult {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface KaypalDesktopAuthPendingResult {
  status: 'pending';
  interval?: number;
}

export interface KaypalDesktopAuthAuthorizedResult {
  status: 'authorized';
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  device?: {
    id?: string;
    device_id?: string;
    name?: string;
    platform?: string;
  };
  user?: {
    id?: string;
  };
}

// 云端计费订阅响应结构（字段兼容多版本）
interface KaypalBillingSubscription {
  plan?: { legacyId?: string; code?: string } | string;
  subscriptionPlan?: string;
  periodEnd?: string | number | null;
  currentPeriodEnd?: string | number | null;
  subscriptionPeriodEnd?: string | number | null;
  // data 兜底分支可能嵌套 subscription（与自身同构）
  subscription?: KaypalBillingSubscription;
}
export interface KaypalBillingSubscriptionPayload {
  subscription?: KaypalBillingSubscription;
  data?: KaypalBillingSubscription;
}

export interface KaypalDesktopTokenRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'Bearer';
  user_id?: string;
  device_id?: string;
}

export type KaypalDesktopAuthPollResult =
  | KaypalDesktopAuthPendingResult
  | KaypalDesktopAuthAuthorizedResult
  | { status: 'denied' };

export interface KaypalKnowledgeSearchHit {
  assetId: string;
  title: string;
  sourceType: string | null;
  sourceUrl: string | null;
  snippet: string;
  relevanceScore: number;
  rankingReason: string;
  indexedAt: string | null;
  chunkId: string | null;
  chunkIndex: number | null;
}

export interface KaypalKnowledgeSearchResult {
  query: string;
  tenantId: string;
  userId?: string;
  total: number;
  matches: KaypalKnowledgeSearchHit[];
  diagnostics?: {
    vectorHitCount?: number;
    localCandidateCount?: number;
    sourceTypes?: string[];
  };
}

export interface KaypalKnowledgeUploadResult {
  items: unknown[];
  total: number;
}

// 生产默认：测试环境通过 KAYPAL_AUTH_BASE_URL env 显式切 test
const DEFAULT_KAYPAL_AUTH_BASE_URL = 'https://kaypal.cn';
const DEFAULT_KAYPAL_AUTH_TIMEOUT_MS = 8000;

@Injectable()
export class KaypalAuthClient {
  constructor(private readonly config: ConfigService) {}

  isEnabled() {
    const enabled = this.config.get<string>('KAYPAL_AUTH_ENABLED');
    const baseUrl = this.getBaseUrl();
    return enabled === 'true' || enabled === '1' || Boolean(baseUrl);
  }

  async login(
    identifier: string,
    password: string,
  ): Promise<KaypalAuthenticatedUser> {
    const baseUrl = this.getBaseUrl();
    if (baseUrl) {
      return this.loginWithHttp(baseUrl, identifier, password);
    }

    throw new ServiceUnavailableException('Kaypal 服务地址未配置');
  }

  /** kaypal 微信授权 URL 端点（浏览器直接访问：kaypal 设 state cookie + 302 微信） */
  getWechatUrlEndpoint(): string {
    return `${this.requireBaseUrl()}/api/auth/wechat/url`;
  }

  /** kaypal 账号系统 base URL（用于跳转注册/忘记密码等账号自助页面） */
  getAuthBaseUrl(): string {
    return this.requireBaseUrl();
  }

  /**
   * 获取 kaypal 微信扫码登录的授权 URL + kaypal 设置的 state cookie。
   * 流程：ai-content start 服务端调本方法 → 拿到微信 URL + kaypal
   * 的 wechat_login_state/return cookie → 把 cookie 透传给浏览器
   * → 302 微信扫码 → 回调 kaypal 时 state 校验通过。
   */
  async getWechatLoginUrlWithCookies(returnUrl: string): Promise<{
    url: string;
    cookies: { name: string; value: string }[];
  }> {
    const baseUrl = this.requireBaseUrl();
    const url = new URL('/api/auth/wechat/url', baseUrl);
    url.searchParams.set('returnUrl', returnUrl);
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url, {
        headers: { Accept: 'application/json' },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，微信登录暂不可用，请稍后重试',
      );
    }
    const payload = (await response.json().catch(() => null)) as
      string | { url?: string } | { error?: string } | null;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        (payload as { error?: string })?.error ||
          `微信登录服务异常（${response.status}）`,
      );
    }
    let wechatUrl = '';
    if (typeof payload === 'string' && /^https?:/i.test(payload)) {
      wechatUrl = payload;
    } else {
      const candidate = (payload as { url?: string })?.url;
      if (candidate && /^https?:/i.test(candidate)) {
        wechatUrl = candidate;
      }
    }
    if (!wechatUrl) {
      throw new ServiceUnavailableException('微信登录服务返回异常，请稍后重试');
    }
    // 解析 kaypal 的 Set-Cookie（wechat_login_state / wechat_login_return）
    const cookies: { name: string; value: string }[] = [];
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      for (const part of setCookieHeader.split(',')) {
        const [pair] = part.trim().split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) {
          const name = pair.slice(0, eq).trim();
          const value = pair.slice(eq + 1).trim();
          if (name === 'wechat_login_state' || name === 'wechat_login_return') {
            cookies.push({ name, value });
          }
        }
      }
    }
    return { url: wechatUrl, cookies };
  }

  /**
   * 获取 kaypal 微信扫码登录的授权 URL（kaypal 认证服务原生支持微信登录）。
   * 流程：前端点「微信登录」→ 本方法拿授权 URL → 302 跳转微信扫码
   * → 扫码确认后 kaypal 回调 returnUrl → 完成登录。
   */
  async getWechatLoginUrl(returnUrl: string): Promise<string> {
    const { url } = await this.getWechatLoginUrlWithCookies(returnUrl);
    return url;
  }

  async startDesktopAuth(input: {
    deviceId: string;
    deviceName: string;
    platform: string;
    callbackUrl?: string;
  }): Promise<KaypalDesktopAuthStartResult> {
    const baseUrl = this.requireBaseUrl();
    const response = await this.fetchKaypal('/api/desktop-auth/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client: 'ai-content-workbench',
        device_id: input.deviceId,
        device_name: input.deviceName,
        platform: input.platform,
        callback_url: input.callbackUrl,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      KaypalDesktopAuthStartResult | { error?: string } | null;

    if (!response.ok) {
      throw new ServiceUnavailableException(
        (payload as { error?: string } | null)?.error ||
          `Kaypal 授权服务暂时不可用：${baseUrl}`,
      );
    }

    if (
      !payload ||
      !('device_code' in payload) ||
      !payload.device_code ||
      !payload.user_code ||
      !payload.verification_url
    ) {
      throw new ServiceUnavailableException('Kaypal 授权返回数据不完整');
    }

    const result = payload;
    return {
      ...result,
      verification_url: this.normalizeDesktopVerificationUrl(
        result.verification_url,
      ),
    };
  }

  /**
   * 账号密码登录兑换 desktop token（对标扫码授权 start/poll）。
   * 返回 kda_/kdr_ token，供本地会话走云端真实等级与计费。
   */
  async loginWithPassword(input: {
    identifier: string;
    password: string;
    deviceId: string;
  }): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    device?: { device_id?: string };
  }> {
    const identifier = input.identifier.trim();
    const isEmail = identifier.includes('@');
    const serverApiKey = this.getServerBillingApiKey();
    const response = await this.fetchKaypal('/api/desktop-auth/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(serverApiKey ? { 'x-kaypal-api-key': serverApiKey } : {}),
      },
      body: JSON.stringify({
        ...(isEmail ? { email: identifier } : { phone: identifier }),
        password: input.password,
        device_id: input.deviceId,
        device_name: 'ai-content-workbench',
        platform: 'desktop',
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      device?: { device_id?: string };
      error?: string;
    } | null;
    if (response.status === 401) {
      throw new UnauthorizedException('账号或密码错误');
    }
    if (!payload?.access_token || !payload?.refresh_token) {
      throw new ServiceUnavailableException(
        payload?.error || 'Kaypal 桌面令牌服务不可用',
      );
    }
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_in: payload.expires_in,
      device: payload.device,
    };
  }

  async pollDesktopAuth(input: {
    deviceCode: string;
    deviceId: string;
    codeVerifier?: string;
  }): Promise<KaypalDesktopAuthPollResult> {
    const response = await this.fetchKaypal('/api/desktop-auth/poll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        device_code: input.deviceCode,
        device_id: input.deviceId,
        code_verifier: input.codeVerifier || '',
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      KaypalDesktopAuthPollResult | { error?: string } | null;

    if (response.status === 202 && payload && 'status' in payload) {
      return payload;
    }

    if (response.status === 403) {
      return { status: 'denied' };
    }

    if (!response.ok) {
      throw new UnauthorizedException(
        (payload as { error?: string } | null)?.error || 'Kaypal 授权失败',
      );
    }

    if (!payload || !('status' in payload)) {
      throw new ServiceUnavailableException('Kaypal 授权返回数据不完整');
    }

    return payload;
  }

  async getUserFromDesktopToken(
    accessToken: string,
  ): Promise<KaypalAuthenticatedUser> {
    const [profileResponse, subscriptionResponse] = await Promise.all([
      this.fetchKaypal('/api/auth/me', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }),
      this.fetchKaypal('/api/subscriptions/current', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      }).catch(() => null),
    ]);

    const profilePayload = (await profileResponse.json().catch(() => null)) as {
      user?: {
        id?: string;
        email?: string;
        name?: string | null;
        phone?: string | null;
        subscriptionPlan?: string | null;
        subscriptionPeriodEnd?: string | Date | null;
        role?: string | null;
        permissions?: Record<string, unknown> | string[] | null;
      } | null;
      error?: string;
    } | null;

    if (!profileResponse.ok || !profilePayload?.user?.id) {
      throw new UnauthorizedException(
        profilePayload?.error || 'Kaypal 授权登录已失效，请重新登录',
      );
    }

    const subscriptionPayload = subscriptionResponse
      ? ((await subscriptionResponse
          .json()
          .catch(() => null)) as KaypalBillingSubscriptionPayload | null)
      : null;
    const subscription =
      subscriptionPayload?.subscription ||
      subscriptionPayload?.data?.subscription ||
      subscriptionPayload?.data ||
      null;
    const plan =
      (typeof subscription?.plan === 'object'
        ? subscription.plan.legacyId
        : undefined) ||
      (typeof subscription?.plan === 'object'
        ? subscription.plan.code
        : undefined) ||
      (typeof subscription?.plan === 'string'
        ? subscription.plan
        : undefined) ||
      subscription?.subscriptionPlan ||
      profilePayload.user.subscriptionPlan;
    const periodEnd =
      subscription?.periodEnd ||
      subscription?.currentPeriodEnd ||
      subscription?.subscriptionPeriodEnd ||
      profilePayload.user.subscriptionPeriodEnd;
    const permissions = this.normalizePermissions(
      profilePayload.user.permissions,
    );

    return {
      id: profilePayload.user.id,
      email:
        profilePayload.user.email || `${profilePayload.user.id}@kaypal.local`,
      name: profilePayload.user.name ?? profilePayload.user.email ?? null,
      phone: profilePayload.user.phone ?? null,
      subscriptionPlan: this.normalizePlan(plan),
      subscriptionPeriodEnd: this.normalizeDate(periodEnd),
      role: profilePayload.user.role ?? null,
      platformRoleId: null,
      platformRoleName: null,
      permissions,
      userPermissionNames: this.extractPermissionNames(permissions),
      disabledAt: null,
    };
  }

  private async loginWithHttp(
    baseUrl: string,
    identifier: string,
    password: string,
  ): Promise<KaypalAuthenticatedUser> {
    const normalizedIdentifier = identifier.trim();
    const body = normalizedIdentifier.includes('@')
      ? { email: normalizedIdentifier.toLowerCase(), password }
      : { phone: normalizedIdentifier, password };

    let response: Response;
    try {
      const serverApiKey = this.getServerBillingApiKey();
      response = await this.fetchWithTimeout(
        // 2026-08-22 修复：kaypal.cn 桌面认证端点是 /api/desktop-auth/password
        //（旧 /api/auth/login 已下线返回 401），且必须带 x-kaypal-api-key 应用凭据
        new URL('/api/desktop-auth/password', baseUrl),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(serverApiKey ? { 'x-kaypal-api-key': serverApiKey } : {}),
          },
          body: JSON.stringify({
            ...body,
            device_id: 'ai-content-bind',
            device_name: 'ai-content-workbench',
            platform: 'desktop',
          }),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，请确认账号系统已启动或线上地址可访问',
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      user?: Partial<KaypalAuthenticatedUser> & {
        subscriptionPeriodEnd?: string | Date | null;
        permissions?: Record<string, unknown> | string[] | null;
      };
      error?: string;
      message?: string;
    } | null;

    if (response.status === 401 || response.status === 400) {
      throw new UnauthorizedException('账号或密码错误');
    }

    if (response.status === 403) {
      throw new UnauthorizedException(
        payload?.error || payload?.message || 'Kaypal 账号不可用',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        payload?.error || payload?.message || 'Kaypal 账号服务暂时不可用',
      );
    }

    const user = payload?.user;
    if (!user?.id || !user.email) {
      throw new ServiceUnavailableException('Kaypal 登录返回数据不完整');
    }

    const permissions = this.normalizePermissions(user.permissions);

    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      phone: user.phone ?? null,
      subscriptionPlan: this.normalizePlan(user.subscriptionPlan),
      subscriptionPeriodEnd: this.normalizeDate(user.subscriptionPeriodEnd),
      role: user.role ?? null,
      platformRoleId: null,
      platformRoleName: user.platformRoleName ?? null,
      permissions,
      userPermissionNames: this.extractPermissionNames(permissions),
      disabledAt: null,
    };
  }

  private normalizePlan(plan: unknown) {
    return typeof plan === 'string' && plan.trim() ? plan.trim() : 'FREE';
  }

  private normalizeDate(value: unknown) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(safeText(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private toNumberOrNull(value: unknown) {
    if (value == null) return null;
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
      const parsed = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizePermissions(value: unknown): Record<string, unknown> | null {
    if (!value) return null;
    if (Array.isArray(value)) {
      return { permissions: value.filter((item) => typeof item === 'string') };
    }
    if (typeof value === 'object') {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private extractPermissionNames(value: Record<string, unknown> | null) {
    if (!value) return [];
    const direct = value.permissions;
    if (Array.isArray(direct)) {
      return direct.filter((item): item is string => typeof item === 'string');
    }
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([permission]) => permission);
  }

  private getBaseUrl() {
    return (
      this.config
        .get<string>('KAYPAL_AUTH_BASE_URL')
        ?.trim()
        .replace(/\/+$/, '') || DEFAULT_KAYPAL_AUTH_BASE_URL
    );
  }

  private requireBaseUrl() {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new ServiceUnavailableException('Kaypal 账号系统未配置');
    }
    return baseUrl;
  }

  normalizeDesktopVerificationUrl(verificationUrl: string) {
    const baseUrl = this.requireBaseUrl();
    try {
      const sourceUrl = new URL(verificationUrl, baseUrl);
      return new URL(
        `${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`,
        baseUrl,
      ).toString();
    } catch {
      return verificationUrl;
    }
  }

  isDesktopVerificationUrl(verificationUrl: string) {
    const baseUrl = this.requireBaseUrl();
    try {
      const parsed = new URL(verificationUrl);
      const expectedBase = new URL(baseUrl);
      return (
        parsed.origin === expectedBase.origin &&
        parsed.pathname === '/api/desktop-auth/authorize' &&
        Boolean(parsed.searchParams.get('device_code')) &&
        Boolean(parsed.searchParams.get('user_code'))
      );
    } catch {
      return false;
    }
  }

  private async fetchKaypal(path: string, init?: RequestInit) {
    const baseUrl = this.requireBaseUrl();
    try {
      return await this.fetchWithTimeout(new URL(path, baseUrl), init);
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，请确认线上地址可访问',
      );
    }
  }

  async refreshDesktopAuthToken(input: {
    refreshToken: string;
    deviceId: string;
  }): Promise<KaypalDesktopTokenRefreshResult> {
    const response = await this.fetchKaypal('/api/desktop-auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        device_id: input.deviceId,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      KaypalDesktopTokenRefreshResult | { error?: string } | null;

    if (!response.ok || !payload || !('access_token' in payload)) {
      throw new UnauthorizedException(
        (payload as { error?: string } | null)?.error ||
          'Kaypal 授权已过期，请重新登录',
      );
    }

    return payload;
  }

  async getCloudProfile(accessToken: string): Promise<unknown> {
    const payload = await this.fetchCloudJson<unknown>('/api/auth/me', {
      headers: this.authHeaders(accessToken),
    });
    const record = this.asRecord(payload);
    const user = this.asRecord(record?.user) || record;
    return {
      userId: this.toString(user?.id),
      username: this.toString(user?.email) || this.toString(user?.id),
      email: this.toString(user?.email),
      displayName:
        this.toString(user?.name) ||
        this.toString(user?.email) ||
        this.toString(user?.id),
      avatarUrl: this.toString(user?.avatar) || null,
      createdAt: this.toString(user?.createdAt),
      updatedAt: this.toString(user?.updatedAt),
      subscriptionPlan: this.toString(user?.subscriptionPlan),
      role: this.toString(user?.role),
      permissions: Array.isArray(user?.permissions) ? user.permissions : null,
      raw: payload,
    };
  }

  getCloudDevices(_accessToken: string): unknown {
    return [];
  }

  async getCloudSubscription(accessToken: string): Promise<unknown> {
    const payload = await this.fetchCloudJson<unknown>(
      '/api/subscriptions/current',
      {
        headers: this.authHeaders(accessToken),
      },
    );
    return this.normalizeCloudSubscription(payload);
  }

  async getCloudBilling(
    accessToken: string,
    options?: { userId?: string | null },
  ): Promise<KaypalBillingSnapshot> {
    const subscription = await this.getCloudSubscription(accessToken).catch(
      (error) => ({
        unavailable: true,
        message:
          error instanceof Error ? error.message : 'Kaypal 订阅服务不可用',
      }),
    );
    const balance = await this.getCloudBillingBalance(
      accessToken,
      options?.userId,
    );

    return {
      subscription,
      balance: this.normalizeBillingBalance(balance),
    };
  }

  /**
   * 云端扣积分（统一接 kaypal.cn 的 billing，不本地自建计量）。
   * 用服务端 key（x-kaypal-api-key）+ user_id 指定目标用户，managed 模式
   * 由 kaypal 按 service_type/resource_type 自动定价（如 platform_action 按
   * articlePublishes/videoPublishes 折算），幂等键走 metadata.idempotencyKey。
   * 失败返回 ok:false（旁路，不阻断主流程）。
   */
  async deductCloudBilling(input: {
    userId: string;
    serviceType: string;
    resourceType: string;
    amount?: number;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    amount?: number;
    balanceAfter?: number;
    idempotentReplay?: boolean;
  }> {
    const serverApiKey = this.getServerBillingApiKey();
    if (!serverApiKey) {
      return { ok: false };
    }
    try {
      const payload = await this.fetchCloudJson<Record<string, unknown>>(
        '/api/billing/deduct',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'x-kaypal-api-key': serverApiKey,
          },
          body: JSON.stringify({
            user_id: input.userId,
            ...(input.amount != null ? { amount: input.amount } : {}),
            service_type: input.serviceType,
            resource_type: input.resourceType,
            metadata: {
              source: 'ai-content-workbench',
              billingMode: 'cloud',
              ...(input.idempotencyKey
                ? { idempotencyKey: input.idempotencyKey }
                : {}),
              ...(input.metadata || {}),
            },
          }),
        },
      );
      const data = this.asRecord(payload?.data) || payload || {};
      return {
        ok: true,
        amount: this.toNumberOrNull(data?.amount) ?? undefined,
        balanceAfter: this.toNumberOrNull(data?.balanceAfter) ?? undefined,
        idempotentReplay: data?.idempotentReplay === true,
      };
    } catch {
      return { ok: false };
    }
  }

  /**
   * 成本预估（报告 16.3 第 11 项）：生成前调 kaypal /api/billing/quote，
   * managed 模式由 kaypal 按 resource_type + metadata 自动定价，返回
   * 预估积分（amount）+ 预估人民币（estimatedCostCny），供前端「生成前
   * 展示成本」——价格透明是「怎么计量」商业问的前提。
   */
  async quoteCloudBilling(input: {
    userId: string;
    serviceType: string;
    resourceType: string;
    amount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    quote?: {
      managed: boolean;
      amount: number;
      estimatedCostCny: number;
      category: string;
      pricingBasis: string;
      inputs: Record<string, unknown>;
    };
  }> {
    const serverApiKey = this.getServerBillingApiKey();
    if (!serverApiKey) {
      return { ok: false };
    }
    try {
      const payload = await this.fetchCloudJson<Record<string, unknown>>(
        '/api/billing/quote',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'x-kaypal-api-key': serverApiKey,
          },
          body: JSON.stringify({
            user_id: input.userId,
            ...(input.amount != null ? { amount: input.amount } : {}),
            service_type: input.serviceType,
            resource_type: input.resourceType,
            metadata: {
              source: 'ai-content-workbench',
              ...(input.metadata || {}),
            },
          }),
        },
      );
      const data = this.asRecord(payload?.data) || payload || {};
      const quote = this.asRecord(data?.quote);
      return {
        ok: true,
        quote: {
          managed: quote?.managed === true,
          amount: this.toNumberOrNull(quote?.amount) ?? 0,
          estimatedCostCny: this.toNumberOrNull(quote?.estimatedCostCny) ?? 0,
          category: typeof quote?.category === 'string' ? quote.category : '',
          pricingBasis:
            typeof quote?.pricingBasis === 'string' ? quote.pricingBasis : '',
          inputs: this.asRecord(quote?.inputs) || {},
        },
      };
    } catch {
      return { ok: false };
    }
  }

  async searchCloudKnowledge(
    accessToken: string,
    input: {
      query: string;
      limit?: number;
      sourceTypes?: string[];
    },
  ): Promise<KaypalKnowledgeSearchResult> {
    const payload = await this.fetchCloudJson<unknown>(
      '/api/ai-content/knowledge/search',
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: input.query,
          limit: input.limit,
          sourceTypes: input.sourceTypes,
        }),
      },
    );
    const record = this.asRecord(payload);
    const data = this.asRecord(record?.data) || record;
    const matches = Array.isArray(data?.matches) ? data.matches : [];
    return {
      query: this.toString(data?.query) || input.query,
      tenantId: this.toString(data?.tenantId),
      userId: this.toString(data?.userId) || undefined,
      total: typeof data?.total === 'number' ? data.total : matches.length,
      matches: matches
        .map((item) => this.normalizeKnowledgeHit(item))
        .filter((item): item is KaypalKnowledgeSearchHit => item !== null),
      diagnostics: this.asRecord(
        data?.diagnostics,
      ) as KaypalKnowledgeSearchResult['diagnostics'],
    };
  }

  async uploadCloudKnowledge(
    accessToken: string,
    input: {
      files: Array<{
        buffer: Buffer;
        filename: string;
        contentType?: string;
      }>;
    },
  ): Promise<KaypalKnowledgeUploadResult> {
    const formData = new FormData();
    for (const file of input.files) {
      const blobPart = file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength,
      ) as ArrayBuffer;
      formData.append(
        'files',
        new Blob([blobPart], {
          type: file.contentType || 'application/octet-stream',
        }),
        file.filename,
      );
    }
    const payload = await this.fetchCloudJson<unknown>(
      '/api/knowledge/uploads',
      {
        method: 'POST',
        headers: this.authHeaders(accessToken),
        body: formData,
      },
    );
    const record = this.asRecord(payload);
    const data = this.asRecord(record?.data) || record;
    return {
      items: Array.isArray(data?.items) ? data.items : [],
      total:
        typeof data?.total === 'number'
          ? data.total
          : Array.isArray(data?.items)
            ? data.items.length
            : 0,
    };
  }

  private async getCloudBillingBalance(
    accessToken: string,
    userId?: string | null,
  ): Promise<unknown> {
    const serverApiKey = this.getServerBillingApiKey();
    const paths = ['/api/billing/balance', '/api/credits/balance'];
    let lastMessage = 'Kaypal 积分服务不可用';

    if (serverApiKey) {
      for (const path of paths) {
        try {
          const serverPath = userId
            ? `${path}?user_id=${encodeURIComponent(userId)}`
            : path;
          const payload = await this.fetchCloudJson<unknown>(serverPath, {
            headers: {
              Accept: 'application/json',
              'x-kaypal-api-key': serverApiKey,
              ...(userId ? { 'x-kaypal-user-id': userId } : {}),
            },
          });
          if (this.hasUsableBillingBalance(payload, userId)) {
            return payload;
          }
        } catch (httpError) {
          lastMessage =
            httpError instanceof Error
              ? httpError.message
              : 'Kaypal 积分服务不可用';
        }
      }
    }

    for (const path of paths) {
      try {
        const payload = await this.fetchCloudJson<unknown>(path, {
          headers: this.authHeaders(accessToken),
        });
        if (this.hasUsableBillingBalance(payload, userId)) {
          return payload;
        }
      } catch (httpError) {
        lastMessage =
          httpError instanceof Error
            ? httpError.message
            : 'Kaypal 积分服务不可用';
      }
    }

    const unavailableMessage =
      serverApiKey && /401|403|unauthorized|forbidden/i.test(lastMessage)
        ? 'Kaypal 云端 billing 服务端授权未放行，请确认 kaypal.cn 已部署 billing 服务端 key 配置。'
        : lastMessage;
    return {
      unavailable: true,
      message: unavailableMessage,
    };
  }

  private getServerBillingApiKey() {
    return (
      this.config.get<string>('KAYPAL_BILLING_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
      ''
    );
  }

  private hasUsableBillingBalance(
    value: unknown,
    expectedUserId?: string | null,
  ) {
    const record = this.asRecord(value);
    if (!record) return false;
    const data = this.asRecord(record?.data) || record;
    const user = this.asRecord(data?.user) || this.asRecord(record?.user);
    const balanceValue =
      this.extractBillingBalanceValue(data) ??
      this.extractBillingBalanceValue(user) ??
      this.extractBillingBalanceValue(record);
    if (this.toNumberOrNull(balanceValue) === null) return false;

    const returnedUserId =
      this.toString(data?.userId) ||
      this.toString(data?.user_id) ||
      this.toString(user?.id);
    return (
      !expectedUserId || !returnedUserId || returnedUserId === expectedUserId
    );
  }

  private extractBillingBalanceValue(value: unknown) {
    const record = this.asRecord(value);
    if (!record) return null;
    const nestedBalance = this.asRecord(record.balance);
    return (
      (typeof record.balance === 'number' || typeof record.balance === 'string'
        ? record.balance
        : nestedBalance?.balance) ??
      record.creditBalance ??
      record.credit_balance ??
      record.credits ??
      record.points ??
      record.availableCredits ??
      record.available_credits ??
      null
    );
  }

  private normalizeCloudSubscription(value: unknown): unknown {
    const record = this.asRecord(value);
    const subscription =
      this.asRecord(record?.subscription) ||
      this.asRecord(this.asRecord(record?.data)?.subscription) ||
      this.asRecord(record?.data) ||
      record;
    const planRecord = this.asRecord(subscription?.plan);
    const plan =
      this.toString(planRecord?.legacyId) ||
      this.toString(planRecord?.code) ||
      this.toString(planRecord?.id) ||
      this.toString(subscription?.plan) ||
      this.toString(subscription?.subscriptionPlan) ||
      'FREE';
    const status =
      this.toString(subscription?.status) ||
      (subscription?.isActive === false ? 'expired' : 'active');
    const periodEnd =
      this.toString(subscription?.periodEnd) ||
      this.toString(subscription?.currentPeriodEnd) ||
      this.toString(subscription?.endDate) ||
      this.toString(subscription?.nextBillingDate) ||
      this.toString(subscription?.subscriptionPeriodEnd);
    return {
      plan,
      status,
      renewsAt: periodEnd || null,
      periodEnd: periodEnd || null,
      expired: status === 'expired' || subscription?.isActive === false,
      features: Array.isArray(subscription?.features)
        ? subscription.features
        : [],
      raw: value,
    };
  }

  private normalizeBillingBalance(
    value: unknown,
  ): KaypalBillingSnapshot['balance'] {
    const record = this.asRecord(value);
    if (record?.unavailable) {
      return {
        balance: null,
        unavailable: true,
        message: this.toString(record.message) || 'Kaypal 积分接口不可用',
      };
    }
    const data = this.asRecord(record?.data) || record;
    const user = this.asRecord(data?.user) || this.asRecord(record?.user);
    const balanceValue =
      this.extractBillingBalanceValue(data) ??
      this.extractBillingBalanceValue(user) ??
      this.extractBillingBalanceValue(record);
    return {
      balance: this.toNumberOrNull(balanceValue),
      userId:
        this.toString(data?.userId) ||
        this.toString(data?.user_id) ||
        this.toString(user?.id),
      raw: value,
      ...(this.toNumberOrNull(balanceValue) === null
        ? {
            unavailable: true,
            message: 'Kaypal 云端未返回真实积分余额',
          }
        : {}),
    };
  }

  private normalizeKnowledgeHit(
    value: unknown,
  ): KaypalKnowledgeSearchHit | null {
    const record = this.asRecord(value);
    const assetId = this.toString(record?.assetId);
    const snippet = this.toString(record?.snippet);
    if (!assetId || !snippet) return null;
    return {
      assetId,
      title: this.toString(record?.title) || 'Kaypal 知识',
      sourceType: this.toString(record?.sourceType) || null,
      sourceUrl: this.toString(record?.sourceUrl) || null,
      snippet,
      relevanceScore:
        typeof record?.relevanceScore === 'number' ? record.relevanceScore : 0,
      rankingReason: this.toString(record?.rankingReason) || 'match',
      indexedAt: this.toString(record?.indexedAt) || null,
      chunkId: this.toString(record?.chunkId) || null,
      chunkIndex:
        typeof record?.chunkIndex === 'number' ? record.chunkIndex : null,
    };
  }

  private async fetchFirstCloudJson<T>(paths: string[]): Promise<T> {
    let lastError: unknown = null;
    for (const path of paths) {
      try {
        return await this.fetchCloudJson<T>(path);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new ServiceUnavailableException('Kaypal 云端接口不可用');
  }

  private authHeaders(accessToken: string): HeadersInit {
    return {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async fetchCloudJson<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = this.requireBaseUrl();
    let response: Response;
    try {
      response = await this.fetchWithTimeout(new URL(path, baseUrl), {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init?.headers || {}),
        },
      });
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，请确认线上地址可访问',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        `Kaypal 云端返回 ${response.status}，授权已失效，请重新登录 Kaypal 账号`,
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Kaypal 云端返回 ${response.status}`,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new ServiceUnavailableException(
        `Kaypal 云端返回非 JSON（${contentType || 'unknown'}），接口可能未部署`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 云端返回内容无法解析为 JSON',
      );
    }
  }

  private fetchWithTimeout(input: URL, init?: RequestInit) {
    return fetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(this.getTimeoutMs()),
    });
  }

  private getTimeoutMs() {
    const configured = Number.parseInt(
      this.config.get<string>('KAYPAL_AUTH_TIMEOUT_MS') || '',
      10,
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_KAYPAL_AUTH_TIMEOUT_MS;
  }
}
