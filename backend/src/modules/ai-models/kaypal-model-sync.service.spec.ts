import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KaypalModelSyncService } from './kaypal-model-sync.service';

describe('KaypalModelSyncService', () => {
  const originalFetch = global.fetch;
  const now = new Date(Date.now() + 60_000);

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(overrides: Record<string, string> = {}) {
    const created: Record<string, any> = {};
    const prisma = {
      defaultModelConfig: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      aIModel: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          created.model = { id: 'local-model-1', ...create };
          return created.model;
        }),
      },
      aIPlatform: {
        upsert: jest.fn().mockImplementation(async ({ create }) => {
          created.platform = { id: 'platform-1', ...create };
          return created.platform;
        }),
      },
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          metadata: {
            kaypalDesktopAccessToken: 'desktop-token',
            kaypalDesktopTokenExpiresAt: now,
          },
        }),
      },
    };
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_API_KEY: 'kaypal-api-key',
          ...overrides,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    return {
      service: new KaypalModelSyncService(prisma as any, config),
      prisma,
      created,
    };
  }

  function request(cookie = 'ai_content_session=session-token') {
    return {
      headers: { cookie },
    } as any;
  }

  it('syncs Kaypal default model into local platform, model and text defaults', async () => {
    const { service, prisma, created } = createService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        defaultProvider: 'deepseek',
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            configured: true,
            defaultModel: 'deepseek-v4-pro',
            type: 'deepseek',
          },
        ],
      }),
    }) as any;

    const result = await service.sync(request());

    expect(result.synced).toBe(true);
    expect(result.defaultModel).toBe('deepseek-v4-pro');
    expect(prisma.aIPlatform.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'Kaypal 模型台' },
      }),
    );
    // 2026-08-27 网关 AI proxy 端点收敛为 /api/v1（老 /api/ai 已下线），spec 对齐实现
    expect(created.platform.baseUrl).toBe('https://test.kaypal.cn/api/v1');
    expect(created.platform.apiKey).toBe('kaypal-api-key');
    expect(created.platform.config.defaultHeaders['x-kaypal-api-key']).toBe(
      'kaypal-api-key',
    );
    expect(created.model.modelId).toBe('deepseek-v4-pro');
    expect(prisma.defaultModelConfig.upsert).toHaveBeenCalledWith({
      where: { purpose: 'article_creation' },
      create: { purpose: 'article_creation', modelId: 'local-model-1' },
      update: { modelId: 'local-model-1' },
    });
    expect(prisma.defaultModelConfig.upsert).toHaveBeenCalledWith({
      where: { purpose: 'topic_selection' },
      create: { purpose: 'topic_selection', modelId: 'local-model-1' },
      update: { modelId: 'local-model-1' },
    });
  });

  it('falls back to ordinary Kaypal chat models when admin model status is unavailable', async () => {
    const { service } = createService();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Forbidden' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: ['qwen-plus'],
          defaultModel: 'qwen-plus',
        }),
      }) as any;

    const result = await service.getStatus(request());

    expect(result.source).toBe('kaypal');
    expect(result.defaultModel).toBe('qwen-plus');
  });

  it('uses env fallback model when Kaypal model list requires auth', async () => {
    const { service } = createService({
      KAYPAL_MODEL_SYNC_DEFAULT_MODEL: 'qwen3.6-plus',
    });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Forbidden' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Unauthorized' }),
      }) as any;

    await expect(service.getStatus(request())).resolves.toEqual(
      expect.objectContaining({
        source: 'kaypal',
        defaultModel: 'qwen3.6-plus',
      }),
    );
  });

  it('blocks sync when Kaypal has a login session but no backend proxy API key', async () => {
    const { service } = createService({
      KAYPAL_API_KEY: '',
      KAYPAL_AI_PROXY_API_KEY: '',
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        defaultProvider: 'deepseek',
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            configured: true,
            defaultModel: 'deepseek-v4-pro',
          },
        ],
      }),
    }) as any;

    await expect(service.sync(request())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
