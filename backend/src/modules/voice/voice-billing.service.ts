import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface KaypalDeductInput {
  user: AuthenticatedUser;
  resourceType: string;
  amount: number;
  source: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

/**
 * KAYPAL 云端计费（kaypal.cn/api/billing/deduct）。
 * 语音 ASR / TTS 等"费 token / 费云服务"的能力统一走这里扣费，
 * 用户无需自备云厂商凭证——凭证由平台统一持有。
 */
@Injectable()
export class VoiceBillingService {
  private readonly logger = new Logger(VoiceBillingService.name);

  constructor(private readonly config: ConfigService) {}

  private readConfig(key: string) {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  private getKaypalCloudBaseUrl() {
    return (
      this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://test.kaypal.cn'
    ).replace(/\/+$/, '');
  }

  private getBillingIdentity(user: AuthenticatedUser) {
    const userId = user.kaypalUserId?.trim() || '';
    const token = user.kaypalDesktopAccessToken?.trim() || '';
    if (userId && token) {
      return {
        userId,
        authSource: 'desktop-token',
        headers: { Authorization: `Bearer ${token}` } as Record<string, string>,
      };
    }
    const serverApiKey =
      this.readConfig('KAYPAL_API_KEY') || this.readConfig('KAYPAL_AI_PROXY_API_KEY');
    if (userId && serverApiKey) {
      return {
        userId,
        authSource: 'server-api-key',
        headers: { 'x-kaypal-api-key': serverApiKey } as Record<string, string>,
      };
    }
    throw new ServiceUnavailableException(
      'KAYPAL 账号状态需要刷新，请重新登录后再使用语音服务。',
    );
  }

  /**
   * 从用户 KAYPAL 账户扣费。失败抛 ServiceUnavailableException —— 调用方
   * 应把"计费失败"当作服务不可用处理，不允许白嫖。
   */
  async deduct(input: KaypalDeductInput): Promise<void> {
    const identity = this.getBillingIdentity(input.user);
    const timeoutMs = this.readConfig('KAYPAL_VOICE_BILLING_TIMEOUT_MS') || '8000';
    try {
      const response = await fetch(
        new URL('/api/billing/deduct', this.getKaypalCloudBaseUrl()),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...identity.headers,
          },
          body: JSON.stringify({
            user_id: identity.userId,
            amount: input.amount,
            service_type: 'ai_content_workbench',
            resource_type: input.resourceType,
            metadata: {
              source: input.source,
              billingMode: 'cloud',
              billingAuthSource: identity.authSource,
              idempotencyKey: input.idempotencyKey,
              ...(input.metadata || {}),
            },
          }),
          signal: AbortSignal.timeout(Number(timeoutMs) || 8000),
        },
      );
      const payload = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok) {
        const message =
          (typeof payload?.error === 'string' ? payload.error : '') ||
          (typeof payload?.message === 'string' ? payload.message : '') ||
          `Kaypal 云端扣积分接口返回 HTTP ${response.status}`;
        throw new Error(message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `KAYPAL voice billing failed (${input.resourceType}): ${message}`,
      );
      throw new ServiceUnavailableException(
        'KAYPAL 语音服务计费暂时不可用，请刷新账号状态后再试。',
      );
    }
  }
}
