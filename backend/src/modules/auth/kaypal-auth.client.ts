import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';

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
  permissions: Record<string, any> | null;
  userPermissionNames: string[];
  disabledAt: Date | null;
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

export type KaypalDesktopAuthPollResult =
  | KaypalDesktopAuthPendingResult
  | KaypalDesktopAuthAuthorizedResult
  | { status: 'denied' };

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

    const databaseUrl = this.getDatabaseUrl();
    if (databaseUrl) {
      return this.loginWithDatabase(databaseUrl, identifier, password);
    }

    throw new ServiceUnavailableException('Kaypal 账号系统未配置');
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
      | KaypalDesktopAuthStartResult
      | { error?: string }
      | null;

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
      !payload.verification_url
    ) {
      throw new ServiceUnavailableException('Kaypal 授权返回数据不完整');
    }

    const result = payload as KaypalDesktopAuthStartResult;
    return {
      ...result,
      verification_url: this.normalizeDesktopVerificationUrl(
        result.verification_url,
      ),
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
      | KaypalDesktopAuthPollResult
      | { error?: string }
      | null;

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
        permissions?: Record<string, any> | string[] | null;
      } | null;
      error?: string;
    } | null;

    if (!profileResponse.ok || !profilePayload?.user?.id) {
      throw new UnauthorizedException(
        profilePayload?.error || 'Kaypal 授权登录已失效，请重新登录',
      );
    }

    const subscriptionPayload = subscriptionResponse
      ? await subscriptionResponse.json().catch(() => null)
      : null;
    const subscription =
      subscriptionPayload?.subscription ||
      subscriptionPayload?.data?.subscription ||
      subscriptionPayload?.data ||
      null;
    const plan =
      subscription?.plan?.legacyId ||
      subscription?.plan?.code ||
      subscription?.plan ||
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
      response = await fetch(new URL('/api/auth/login', baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，请确认账号系统已启动或线上地址可访问',
      );
    }

    const payload = (await response.json().catch(() => null)) as {
      user?: Partial<KaypalAuthenticatedUser> & {
        subscriptionPeriodEnd?: string | Date | null;
        permissions?: Record<string, any> | string[] | null;
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
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizePermissions(value: unknown): Record<string, any> | null {
    if (!value) return null;
    if (Array.isArray(value)) {
      return { permissions: value.filter((item) => typeof item === 'string') };
    }
    if (typeof value === 'object') {
      return value as Record<string, any>;
    }
    return null;
  }

  private extractPermissionNames(value: Record<string, any> | null) {
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
        .replace(/\/+$/, '') || ''
    );
  }

  private requireBaseUrl() {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new ServiceUnavailableException('Kaypal 账号系统未配置');
    }
    return baseUrl;
  }

  private normalizeDesktopVerificationUrl(verificationUrl: string) {
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

  private async fetchKaypal(path: string, init?: RequestInit) {
    const baseUrl = this.requireBaseUrl();
    try {
      return await fetch(new URL(path, baseUrl), init);
    } catch {
      throw new ServiceUnavailableException(
        'Kaypal 账号服务不可用，请确认线上地址可访问',
      );
    }
  }

  private getDatabaseUrl() {
    return this.config.get<string>('KAYPAL_DATABASE_URL')?.trim() || '';
  }

  private async loginWithDatabase(
    databaseUrl: string,
    identifier: string,
    password: string,
  ): Promise<KaypalAuthenticatedUser> {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      const normalizedIdentifier = identifier.trim();
      const isEmail = normalizedIdentifier.includes('@');
      const result = await client.query<{
        id: string;
        email: string;
        name: string | null;
        phone: string | null;
        passwordHash: string | null;
        disabledAt: Date | null;
        subscriptionPlan: string;
        subscriptionPeriodEnd: Date | null;
        role: string | null;
        platformRoleId: string | null;
        permissions: Record<string, any> | null;
      }>(
        `
          SELECT id, email, name, phone,
                 "passwordHash", "disabledAt",
                 "subscriptionPlan", "subscriptionPeriodEnd",
                 role, "platformRoleId", permissions
          FROM "User"
          WHERE ${isEmail ? 'LOWER(email) = LOWER($1)' : 'phone = $1'}
          LIMIT 1
        `,
        [normalizedIdentifier],
      );

      const user = result.rows[0];
      if (!user?.passwordHash) {
        throw new UnauthorizedException('账号或密码错误');
      }

      if (user.disabledAt) {
        throw new UnauthorizedException('Kaypal 账号已被停用');
      }

      const passwordOk = await bcrypt.compare(password, user.passwordHash);
      if (!passwordOk) {
        throw new UnauthorizedException('账号或密码错误');
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        subscriptionPlan: user.subscriptionPlan || 'FREE',
        subscriptionPeriodEnd: user.subscriptionPeriodEnd,
        role: user.role,
        platformRoleId: user.platformRoleId,
        platformRoleName: null,
        permissions: user.permissions,
        userPermissionNames: this.extractPermissionNames(user.permissions),
        disabledAt: user.disabledAt,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new ServiceUnavailableException(
        'Kaypal 账号数据库不可用，请确认主账号系统数据库已启动',
      );
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
