import { ConfigService } from '@nestjs/config';
import { AiClientService } from './ai-client.service';

describe('AiClientService knowledge context', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function createService(materials: any[] = []) {
    const prisma = {
      material: {
        findMany: jest.fn().mockResolvedValue(materials),
      },
      userSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          KAYPAL_AUTH_BASE_URL: 'https://test.kaypal.cn',
          KAYPAL_KNOWLEDGE_CONTEXT_ENABLED: 'true',
          KAYPAL_CLOUD_AI_BILLING_ENABLED: 'true',
          KAYPAL_AI_TEXT_CREDIT_COST: '1',
          KAYPAL_AI_IMAGE_CREDIT_COST: '5',
          KAYPAL_AI_BILLING_TIMEOUT_MS: '8000',
        };
        return values[key];
      }),
    } as unknown as ConfigService;
    const storage = {};
    const service = new AiClientService(prisma as any, config, storage as any);

    return { service, prisma };
  }

  it('skips knowledge lookup when mode is off', async () => {
    const { service, prisma } = createService([
      {
        title: '曹耕记品牌手册',
        content: '曹耕记品牌定位是做更好的潇湘小炒。',
        summary: '',
      },
    ]);

    const messages = [{ role: 'user' as const, content: '写一段测试' }];
    const result = await (service as any).withKaypalKnowledgeContext(messages, {
      mode: 'off',
    });

    expect(result).toBe(messages);
    expect(prisma.material.findMany).not.toHaveBeenCalled();
  });

  it('adds a no-fabrication guard when required mode has no match', async () => {
    const { service } = createService([]);
    const messages = [{ role: 'user' as const, content: '客户问加盟多少钱' }];

    const result = await (service as any).withKaypalKnowledgeContext(messages, {
      mode: 'required',
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('知识库未命中'),
      }),
    );
  });

  it('keeps local knowledge context when cloud knowledge returns 401', async () => {
    const { service } = createService([
      {
        title: '曹耕记品牌手册',
        content: '曹耕记品牌定位是做更好的潇湘小炒，寻味山野，拒绝预制。',
        summary: '',
      },
    ]);
    (service as any).resolveCurrentRequestKaypalKnowledgeToken = jest
      .fn()
      .mockResolvedValue('cloud-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as any);

    const context = await (service as any).buildKaypalKnowledgeContext(
      '曹耕记潇湘小炒',
    );

    expect(context).toContain('本机知识库参考');
    expect(context).toContain('曹耕记品牌定位');
  });

  it('lets Kaypal proxy server charge chat models and caches returned balance', async () => {
    const authContext = {
      hasContext: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        sessionId: 'session-1',
        user: {
          kaypalUserId: 'cloud-user-1',
          kaypalDesktopAccessToken: 'desktop-token',
          kaypalDesktopTokenExpiresAt: new Date(
            Date.now() + 60 * 60 * 1000,
          ).toISOString(),
        },
      }),
    };
    const { service, prisma } = createService([]);
    prisma.userSession.findUnique.mockResolvedValue({
      metadata: {
        kaypalCreditBalance: 12,
        kaypalCreditBalanceUserId: 'cloud-user-1',
      },
    });
    (service as any).authRequestContext = authContext;
    global.fetch = jest.fn();
    const model = {
      id: 'model-row-1',
      name: 'Kaypal Qwen',
      modelId: 'qwen3.6-plus',
      platformId: 'platform-1',
      platform: {
        baseUrl: 'https://test.kaypal.cn/api/ai',
        config: { source: 'kaypal' },
      },
    };

    await (service as any).chargeCloudAiCredits('text_generation', model, {
      mode: 'text',
    });
    await (service as any).syncSessionCreditBalanceFromServerBilling(model, {
      billing: {
        balanceAfter: 9.5,
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        metadata: expect.objectContaining({
          kaypalCreditBalance: 9.5,
          kaypalCreditBalanceUserId: 'cloud-user-1',
          kaypalCreditBalanceSource: 'kaypal-server-billing',
          kaypalCreditBalanceSyncedAt: expect.any(String),
        }),
      },
    });
  });

  it('uses Kaypal proxy server key and user id when desktop token is unavailable', async () => {
    const authContext = {
      hasContext: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({
        sessionId: 'session-1',
        user: {
          kaypalUserId: 'cloud-user-1',
        },
      }),
    };
    const { service } = createService([]);
    (service as any).authRequestContext = authContext;

    const headers = await (service as any).resolveDynamicHeaders({
      baseUrl: 'https://test.kaypal.cn/api/ai',
      apiKey: 'fallback-openai-key',
      config: {
        source: 'kaypal',
        defaultHeaders: {
          'x-kaypal-api-key': 'server-proxy-key',
        },
      },
    });

    expect(headers).toEqual({
      'x-kaypal-api-key': 'server-proxy-key',
      'x-kaypal-user-id': 'cloud-user-1',
    });
  });

  it('does not charge credits for non-Kaypal model platforms', async () => {
    const { service } = createService([]);
    global.fetch = jest.fn();

    await (service as any).chargeCloudAiCredits('text_generation', {
      id: 'model-row-1',
      name: 'Local model',
      modelId: 'local-model',
      platformId: 'platform-1',
      platform: {
        baseUrl: 'https://api.example.com/v1',
        config: {},
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('maps Kaypal proxy insufficient credits to a product-facing message', () => {
    const { service } = createService([]);

    const error = (service as any).toUserFacingAiError(
      new Error('402 INSUFFICIENT_CREDITS'),
      {
        baseUrl: 'https://test.kaypal.cn/api/ai',
        config: { source: 'kaypal' },
      },
    );

    expect(error.message).toContain('Kaypal 模型台积分余额不足');
    expect(error.message).not.toContain('INSUFFICIENT_CREDITS');
  });

  it('passes the signal to text generation and preserves abort errors', async () => {
    const { service, prisma } = createService([]);
    const controller = new AbortController();
    const abortError = new Error('用户已取消文章生成');
    abortError.name = 'AbortError';
    const create = jest.fn().mockImplementation((_body, requestOptions) => {
      expect(requestOptions.signal).toBe(controller.signal);
      controller.abort(abortError);
      return Promise.reject(abortError);
    });

    (prisma as any).aIModel = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'model-row-1',
        name: 'Abortable model',
        modelId: 'abortable-model',
        platformId: 'platform-1',
        platform: {
          baseUrl: 'https://api.example.com/v1',
          config: {},
        },
      }),
    };
    jest.spyOn(service, 'getClient').mockResolvedValue({
      chat: { completions: { create } },
    } as any);

    await expect(
      service.generate(
        'model-row-1',
        [{ role: 'user', content: '生成一篇文章' }],
        { knowledgeMode: 'off', signal: controller.signal },
      ),
    ).rejects.toBe(abortError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
