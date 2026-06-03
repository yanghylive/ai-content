import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_COOKIE_NAME } from '../auth/auth.constants';
import { hashSessionToken, parseCookieHeader } from '../auth/auth.utils';

type KaypalProviderStatus = {
  id?: string;
  name?: string;
  configured?: boolean;
  defaultModel?: string;
  type?: string;
};

type KaypalStatusPayload = {
  providers?: KaypalProviderStatus[];
  defaultProvider?: string;
  fallbackOnly?: boolean;
};

type KaypalChatModelsPayload = {
  models?: string[];
  defaultModel?: string | null;
};

export type KaypalModelSyncStatus = {
  configured: boolean;
  source: 'kaypal' | 'local' | 'missing';
  message: string;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  localPlatformId?: string | null;
  localModelId?: string | null;
  nextAction?: string;
};

export type KaypalModelSyncResult = KaypalModelSyncStatus & {
  synced: boolean;
  providerCount: number;
};

type KaypalAuthContext = {
  headers: Record<string, string>;
  source: 'session' | 'api-key';
};

const KAYPAL_PLATFORM_NAME = 'Kaypal 模型台';
const TEXT_DEFAULT_PURPOSES = ['article_creation', 'topic_selection'] as const;

@Injectable()
export class KaypalModelSyncService {
  private readonly logger = new Logger(KaypalModelSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(request?: Request): Promise<KaypalModelSyncStatus> {
    const local = await this.getLocalKaypalDefault();
    if (local.configured) {
      return local;
    }

    const auth = await this.resolveKaypalAuth(request);
    if (!auth) {
      return {
        configured: false,
        source: 'missing',
        message: '本地未配置 Kaypal 默认模型，也没有可复用的 Kaypal 登录态/API Key。',
        nextAction:
          '先在 3010 页面完成 Kaypal 授权登录，或配置 KAYPAL_AI_PROXY_API_KEY/KAYPAL_API_KEY 后执行同步。',
      };
    }

    const status = await this.fetchKaypalStatus(auth);
    if (status.fallbackOnly) {
      throw new ServiceUnavailableException(
        'Kaypal 模型台鉴权不可用，不能把环境变量兜底模型同步为 3010 默认模型。',
      );
    }

    const provider = this.pickDefaultProvider(status);
    if (!provider?.defaultModel) {
      return {
        configured: false,
        source: 'missing',
        message: 'Kaypal 模型台未返回可用默认文本模型。',
        defaultProvider: status.defaultProvider || null,
        nextAction: '先在 Kaypal 模型台启用一个带默认模型的 provider，再回到 3010 同步。',
      };
    }

    return {
      configured: false,
      source: 'kaypal',
      message: `Kaypal 模型台可用：${provider.name || provider.id} / ${provider.defaultModel}，尚未同步到 3010。`,
      defaultProvider: provider.id || status.defaultProvider || null,
      defaultModel: provider.defaultModel,
      nextAction: '执行 /ai-models/kaypal/sync，把 Kaypal 默认模型落到 3010 本地默认模型配置。',
    };
  }

  async sync(request?: Request): Promise<KaypalModelSyncResult> {
    const auth = await this.resolveKaypalAuth(request);
    if (!auth) {
      throw new BadRequestException(
        '没有可用 Kaypal 登录态/API Key，无法同步 Kaypal 模型台。',
      );
    }

    const status = await this.fetchKaypalStatus(auth);
    const provider = this.pickDefaultProvider(status);
    if (!provider?.id || !provider.defaultModel) {
      throw new ServiceUnavailableException(
        'Kaypal 模型台没有返回可同步的默认 provider/model。',
      );
    }

    const proxyApiKey = this.resolveProxyApiKey(auth);
    if (!proxyApiKey) {
      throw new BadRequestException(
        'Kaypal 模型台有默认模型，但 3010 没有可用于后端调用的 Kaypal API Key。请配置 KAYPAL_AI_PROXY_API_KEY 或 KAYPAL_API_KEY。',
      );
    }

    const baseUrl = this.getKaypalAiProxyBaseUrl();
    const platform = await this.prisma.aIPlatform.upsert({
      where: { name: KAYPAL_PLATFORM_NAME },
      create: {
        name: KAYPAL_PLATFORM_NAME,
        baseUrl,
        apiKey: proxyApiKey,
        enabled: true,
        config: {
          source: 'kaypal',
          authSource: auth.source,
          kaypalProviderId: provider.id,
          kaypalProviderName: provider.name || provider.id,
          kaypalProviderType: provider.type || null,
          defaultHeaders: {
            'x-kaypal-api-key': proxyApiKey,
          },
          syncedAt: new Date().toISOString(),
        },
      },
      update: {
        baseUrl,
        apiKey: proxyApiKey,
        enabled: true,
        config: {
          source: 'kaypal',
          authSource: auth.source,
          kaypalProviderId: provider.id,
          kaypalProviderName: provider.name || provider.id,
          kaypalProviderType: provider.type || null,
          defaultHeaders: {
            'x-kaypal-api-key': proxyApiKey,
          },
          syncedAt: new Date().toISOString(),
        },
      },
    });

    const model = await this.prisma.aIModel.upsert({
      where: {
        platformId_modelId: {
          platformId: platform.id,
          modelId: provider.defaultModel,
        },
      },
      create: {
        name: `${provider.name || provider.id} / ${provider.defaultModel}`,
        modelId: provider.defaultModel,
        platformId: platform.id,
        enabled: provider.configured !== false,
        config: {
          source: 'kaypal',
          kaypalProviderId: provider.id,
          syncedAt: new Date().toISOString(),
        },
      },
      update: {
        name: `${provider.name || provider.id} / ${provider.defaultModel}`,
        enabled: provider.configured !== false,
        config: {
          source: 'kaypal',
          kaypalProviderId: provider.id,
          syncedAt: new Date().toISOString(),
        },
      },
    });

    for (const purpose of TEXT_DEFAULT_PURPOSES) {
      await this.prisma.defaultModelConfig.upsert({
        where: { purpose },
        create: { purpose, modelId: model.id },
        update: { modelId: model.id },
      });
    }

    return {
      synced: true,
      configured: true,
      source: 'kaypal',
      message: `已同步 Kaypal 默认模型：${provider.name || provider.id} / ${provider.defaultModel}。`,
      defaultProvider: provider.id,
      defaultModel: provider.defaultModel,
      localPlatformId: platform.id,
      localModelId: model.id,
      providerCount: status.providers?.length || 0,
    };
  }

  private async getLocalKaypalDefault(): Promise<KaypalModelSyncStatus> {
    const rows = await this.prisma.defaultModelConfig.findMany({
      where: { purpose: { in: [...TEXT_DEFAULT_PURPOSES] } },
    });
    const modelIds = [...new Set(rows.map((row) => row.modelId).filter(Boolean))];
    if (!modelIds.length) {
      return {
        configured: false,
        source: 'missing',
        message: '3010 本地还没有默认文本模型。',
      };
    }

    const models = await this.prisma.aIModel.findMany({
      where: { id: { in: modelIds } },
      include: { platform: true },
    });
    const kaypalModel = models.find(
      (model) =>
        model.enabled &&
        model.platform?.enabled &&
        model.platform.name === KAYPAL_PLATFORM_NAME &&
        Boolean(model.platform.baseUrl?.trim()) &&
        Boolean(model.platform.apiKey?.trim()),
    );

    if (!kaypalModel) {
      return {
        configured: false,
        source: 'local',
        message: '3010 本地默认模型存在，但不是可用的 Kaypal 模型台同步模型。',
      };
    }

    return {
      configured: true,
      source: 'kaypal',
      message: `3010 已使用 Kaypal 模型台默认模型：${kaypalModel.name}。`,
      defaultModel: kaypalModel.modelId,
      localPlatformId: kaypalModel.platformId,
      localModelId: kaypalModel.id,
    };
  }

  private async resolveKaypalAuth(request?: Request): Promise<KaypalAuthContext | null> {
    const sessionToken = this.getSessionToken(request);
    if (sessionToken) {
      const session = await this.prisma.userSession.findFirst({
        where: {
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: { gt: new Date() },
        },
      });
      const metadata = session?.metadata as Record<string, unknown> | null;
      const desktopToken =
        typeof metadata?.kaypalDesktopAccessToken === 'string'
          ? metadata.kaypalDesktopAccessToken.trim()
          : '';
      const desktopTokenExpiresAt = metadata?.kaypalDesktopTokenExpiresAt
        ? new Date(String(metadata.kaypalDesktopTokenExpiresAt))
        : null;
      if (
        desktopToken &&
        (!desktopTokenExpiresAt ||
          Number.isNaN(desktopTokenExpiresAt.getTime()) ||
          desktopTokenExpiresAt > new Date())
      ) {
        return {
          source: 'session',
          headers: {
            Authorization: `Bearer ${desktopToken}`,
          },
        };
      }
    }

    const apiKey =
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim();
    if (apiKey) {
      return {
        source: 'api-key',
        headers: {
          'x-kaypal-api-key': apiKey,
        },
      };
    }

    return null;
  }

  private getSessionToken(request?: Request) {
    const cookieHeader = request?.headers.cookie;
    return parseCookieHeader(cookieHeader)[AUTH_COOKIE_NAME] || '';
  }

  private async fetchKaypalStatus(auth: KaypalAuthContext): Promise<KaypalStatusPayload> {
    const adminStatus = await this.fetchKaypalAdminStatus(auth).catch((error) => {
      this.logger.warn(
        `Kaypal admin model status unavailable, falling back to chat models: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    });
    if (adminStatus) {
      return adminStatus;
    }

    const chatModels = await this.fetchKaypalChatModels(auth).catch((error) => {
      this.logger.warn(
        `Kaypal chat model list unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      throw error;
    });

    const defaultModel =
      chatModels?.defaultModel ||
      chatModels?.models?.find((model) => Boolean(model?.trim())) ||
      '';
    if (!defaultModel) {
      throw new ServiceUnavailableException(
        'Kaypal 未返回可用模型；admin 状态接口不可用，普通模型列表也为空。',
      );
    }

    return {
      defaultProvider: 'kaypal',
      providers: [
        {
          id: 'kaypal',
          name: 'Kaypal 默认模型',
          configured: true,
          defaultModel,
          type: 'kaypal-proxy',
        },
      ],
    };
  }

  private async fetchKaypalAdminStatus(
    auth: KaypalAuthContext,
  ): Promise<KaypalStatusPayload> {
    const baseUrl = this.getKaypalBaseUrl();
    const response = await fetch(new URL('/api/admin/ai-service/status', baseUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...auth.headers,
      },
      signal: AbortSignal.timeout(
        Number(this.config.get<string>('KAYPAL_MODEL_SYNC_TIMEOUT_MS') || 10000),
      ),
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const errorPayload =
        payload && typeof payload === 'object'
          ? (payload as { error?: unknown })
          : null;
      const detail =
        typeof errorPayload?.error === 'string' && errorPayload.error
          ? errorPayload.error
          : `HTTP ${response.status}`;
      throw new ServiceUnavailableException(
        `Kaypal 模型台状态读取失败：${detail}`,
      );
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as KaypalStatusPayload).providers)
    ) {
      throw new ServiceUnavailableException('Kaypal 模型台状态返回结构不完整。');
    }
    return payload as KaypalStatusPayload;
  }

  private async fetchKaypalChatModels(
    auth: KaypalAuthContext,
  ): Promise<KaypalChatModelsPayload> {
    const baseUrl = this.getKaypalBaseUrl();
    const response = await fetch(new URL('/api/chat/models', baseUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...auth.headers,
      },
      signal: AbortSignal.timeout(
        Number(this.config.get<string>('KAYPAL_MODEL_SYNC_TIMEOUT_MS') || 10000),
      ),
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const errorPayload =
        payload && typeof payload === 'object'
          ? (payload as { error?: unknown })
          : null;
      const detail =
        typeof errorPayload?.error === 'string' && errorPayload.error
          ? errorPayload.error
          : `HTTP ${response.status}`;
      throw new ServiceUnavailableException(
        `Kaypal 普通模型列表读取失败：${detail}`,
      );
    }

    const chatPayload =
      payload && typeof payload === 'object'
        ? (payload as KaypalChatModelsPayload)
        : null;
    if (!chatPayload || (!Array.isArray(chatPayload.models) && !chatPayload.defaultModel)) {
      throw new ServiceUnavailableException('Kaypal 普通模型列表返回结构不完整。');
    }
    return chatPayload;
  }

  private pickDefaultProvider(status: KaypalStatusPayload) {
    const providers = status.providers || [];
    return (
      providers.find(
        (provider) =>
          provider.id === status.defaultProvider &&
          provider.configured !== false &&
          Boolean(provider.defaultModel?.trim()),
      ) ||
      providers.find(
        (provider) =>
          provider.configured !== false && Boolean(provider.defaultModel?.trim()),
      )
    );
  }

  private getEnvFallbackStatus(): KaypalStatusPayload | null {
    const defaultModel =
      this.config.get<string>('KAYPAL_MODEL_SYNC_DEFAULT_MODEL')?.trim() ||
      this.config.get<string>('KAYPAL_DEFAULT_TEXT_MODEL')?.trim() ||
      this.config.get<string>('KAYPAL_COMPANION_PRIMARY_MODEL')?.trim() ||
      this.config.get<string>('KAYPAL_BAILIAN_LIVE_TEXT_MODEL')?.trim() ||
      this.config.get<string>('DASHSCOPE_DEFAULT_MODEL')?.trim() ||
      this.config.get<string>('ALIYUN_DEFAULT_MODEL')?.trim() ||
      '';

    if (!defaultModel) {
      return null;
    }

    return {
      defaultProvider: 'kaypal',
      providers: [
        {
          id: 'kaypal',
          name: 'Kaypal 默认模型',
          configured: true,
          defaultModel,
          type: 'kaypal-proxy',
        },
      ],
    };
  }

  private resolveProxyApiKey(auth: KaypalAuthContext) {
    if (auth.source === 'api-key') {
      return (
        this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
        this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
        ''
      );
    }
    return (
      this.config.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      this.config.get<string>('KAYPAL_API_KEY')?.trim() ||
      ''
    );
  }

  private getKaypalBaseUrl() {
    const baseUrl =
      this.config.get<string>('KAYPAL_MODEL_SYNC_BASE_URL')?.trim() ||
      this.config.get<string>('KAYPAL_AUTH_BASE_URL')?.trim();
    if (!baseUrl) {
      throw new ServiceUnavailableException('KAYPAL_AUTH_BASE_URL 未配置。');
    }
    return baseUrl.replace(/\/+$/, '');
  }

  private getKaypalAiProxyBaseUrl() {
    return (
      this.config.get<string>('KAYPAL_AI_PROXY_BASE_URL')?.trim() ||
      `${this.getKaypalBaseUrl()}/api/ai`
    ).replace(/\/+$/, '');
  }
}
