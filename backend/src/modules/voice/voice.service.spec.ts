import { VoiceService } from './voice.service';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'user-1',
  username: 'voice-user',
  email: 'voice@example.com',
  name: 'Voice User',
  status: 'active',
  lastLoginAt: null,
  role: 'operator',
  kaypalUserId: 'kaypal-user-1',
  kaypalPlan: 'ADVANCED',
  commercialExecutionAllowed: true,
  planMode: 'commercial',
  createdAt: new Date('2026-07-05T00:00:00.000Z'),
  updatedAt: new Date('2026-07-05T00:00:00.000Z'),
};

function makeService() {
  return new VoiceService({} as never, {} as never, {} as never, {} as never);
}

describe('VoiceService', () => {
  it('routes pending confirmation page requests to the current task center path', async () => {
    const result = await makeService().command(user, { text: '打开待确认' });

    expect(result).toMatchObject({
      intent: 'open_page',
      handledBy: 'kaypal-voice-bridge',
      action: {
        type: 'open_page',
        label: '待确认',
        href: '/tasks/confirmations',
      },
    });
  });

  it('routes risk center page requests to the commercial safety page', async () => {
    const result = await makeService().command(user, { text: '打开风控页' });

    expect(result).toMatchObject({
      intent: 'open_page',
      action: {
        type: 'open_page',
        label: '风控中心',
        href: '/admin/risk',
      },
    });
  });

  it('keeps non-KAYPAL requests in the embedded voice assistant mode', async () => {
    const result = await makeService().command(user, {
      text: '帮我总结这个本地文件',
    });

    expect(result).toMatchObject({
      intent: 'general_agent_fallback',
      handledBy: 'bailongma-general',
      data: {
        suggestedMode: 'voice-assist',
      },
    });
  });

  it('routes general BaiLongma chat through the KAYPAL account model service', async () => {
    const prisma = {
      aIModel: {
        findFirst: jest.fn(),
        // 2026-08-23 Stage 1B：默认模型按能力确定性选取（pickDefaultModel 用 findMany）
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: 'model-1',
        topicSelection: '',
        xCollection: '',
      }),
    };
    const aiClient = {
      generate: jest.fn().mockResolvedValue('你好，我是你的助手。'),
    };
    const service = new VoiceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      defaultModels as never,
      aiClient as never,
    );

    const result = await service.chat(user, {
      messages: [
        { role: 'system', content: '只回答中文' },
        { role: 'tool', content: 'ignored' },
        { role: 'user', content: '你好' },
      ],
      temperature: 0.2,
      maxTokens: 300,
    });

    expect(aiClient.generate).toHaveBeenCalledWith(
      'model-1',
      [
        { role: 'system', content: '只回答中文' },
        { role: 'user', content: '你好' },
      ],
      expect.objectContaining({
        temperature: 0.2,
        maxTokens: 300,
        knowledgeMode: 'off',
      }),
    );
    expect(result).toMatchObject({
      content: '你好，我是你的助手。',
      usageMode: 'kaypal-subscription-credits',
      account: {
        kaypalUserId: 'kaypal-user-1',
        plan: 'ADVANCED',
      },
    });
  });

  it('auto-syncs the KAYPAL account model when local defaults are empty', async () => {
    const prisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue(null),
        // 2026-08-23 Stage 1B：本地无可用模型 → 走 KAYPAL 模型同步（pickDefaultModel 返回 null）
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: '',
        topicSelection: '',
        xCollection: '',
      }),
    };
    const aiClient = {
      generate: jest.fn().mockResolvedValue('链路测试成功'),
    };
    const kaypalModelSync = {
      sync: jest.fn().mockResolvedValue({
        synced: true,
        localModelId: 'kaypal-model-1',
      }),
    };
    const service = new VoiceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      defaultModels as never,
      aiClient as never,
      kaypalModelSync as never,
    );

    await service.chat(user, {
      text: '请只回复：链路测试成功',
    });

    expect(kaypalModelSync.sync).toHaveBeenCalledTimes(1);
    expect(aiClient.generate).toHaveBeenCalledWith(
      'kaypal-model-1',
      [{ role: 'user', content: '请只回复：链路测试成功' }],
      expect.objectContaining({
        knowledgeMode: 'off',
      }),
    );
  });

  it('generates images through the KAYPAL account media service', async () => {
    const prisma = {
      aIModel: {
        findFirst: jest.fn(),
        // 2026-08-23 Stage 1B：默认模型按能力确定性选取（pickDefaultModel 用 findMany）
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const defaultModels = {
      getDefaults: jest.fn().mockResolvedValue({
        imageCreation: 'image-model-1',
      }),
    };
    const aiClient = {
      generateImage: jest
        .fn()
        .mockResolvedValueOnce('https://cdn.example.com/a.png')
        .mockResolvedValueOnce('https://cdn.example.com/b.png'),
    };
    const service = new VoiceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      defaultModels as never,
      aiClient as never,
    );

    const result = await service.generateImage(user, {
      prompt: '一张商业级产品海报',
      aspectRatio: '16:9',
      n: 2,
    });

    expect(aiClient.generateImage).toHaveBeenCalledTimes(2);
    expect(aiClient.generateImage).toHaveBeenCalledWith(
      'image-model-1',
      '一张商业级产品海报',
      expect.objectContaining({ ratio: '16:9', n: 1 }),
    );
    expect(result).toMatchObject({
      urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      usageMode: 'kaypal-subscription-credits',
      account: {
        kaypalUserId: 'kaypal-user-1',
        plan: 'ADVANCED',
      },
    });
  });

  it('meters voice recognition through the KAYPAL account credit service', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ billing: { amount: 2 } }),
    });
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    try {
      const config = {
        get: jest.fn((key: string) => {
          // Stage 1A：base url 必须是 kaypal.cn 根域或其子域，
          // 原来的 https://kaypal.test 已被 KaypalProviderResolver 拒绝（fail-closed）
          if (key === 'KAYPAL_AUTH_BASE_URL') return 'https://test.kaypal.cn';
          if (key === 'KAYPAL_VOICE_ASR_CREDIT_COST') return '2';
          return '';
        }),
      };
      const service = new VoiceService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        config as never,
      );

      const result = await service.meterAsr(
        {
          ...user,
          kaypalDesktopAccessToken: 'desktop-token-1',
        },
        {
          clientKind: 'bailongma-desktop',
          sessionId: 'asr-session-1',
          durationMs: 1500,
          lang: 'zh',
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://test.kaypal.cn/api/billing/deduct');
      expect(options.headers).toMatchObject({
        Authorization: 'Bearer desktop-token-1',
      });
      const body = JSON.parse(options.body as string);
      expect(body).toMatchObject({
        user_id: 'kaypal-user-1',
        amount: 2,
        service_type: 'ai_content_workbench',
        resource_type: 'voice_recognition',
        metadata: {
          source: 'bailongma-desktop',
          idempotencyKey: 'bailongma:asr:asr-session-1',
          clientKind: 'bailongma-desktop',
          durationMs: 1500,
          lang: 'zh',
        },
      });
      expect(result).toMatchObject({
        accepted: true,
        service: 'voice_recognition',
        usageMode: 'kaypal-subscription-credits',
        sessionId: 'asr-session-1',
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Stage 1A 回归：KAYPAL_AUTH_BASE_URL 被改成非网关域名时，
  // 绝不能带着用户 token 把计费请求打到第三方，必须在拼 URL 阶段就拒绝。
  it('refuses to bill through a non-kaypal gateway host (fail-closed)', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

    try {
      const config = {
        get: jest.fn((key: string) => {
          if (key === 'KAYPAL_AUTH_BASE_URL') return 'https://kaypal.cn.evil.com';
          if (key === 'KAYPAL_VOICE_ASR_CREDIT_COST') return '2';
          return '';
        }),
      };
      const service = new VoiceService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        config as never,
      );

      await expect(
        service.meterAsr(
          { ...user, kaypalDesktopAccessToken: 'desktop-token-1' },
          {
            clientKind: 'bailongma-desktop',
            sessionId: 'asr-session-evil',
            durationMs: 1500,
            lang: 'zh',
          },
        ),
      ).rejects.toThrow(/暂时不可用|非法/);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('does not expose raw backend errors in voice state', async () => {
    const billing = {
      getStatusForUser: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Invalid `prisma.billingSubscription.findFirst()` invocation',
          ),
        ),
    };
    const localEngine = {
      listAgentConfirmations: jest.fn().mockResolvedValue([]),
      listBusinessTasks: jest.fn().mockResolvedValue([]),
    };
    const service = new VoiceService(
      {} as never,
      billing as never,
      localEngine as never,
      {} as never,
    );

    const state = await service.getState(user);

    expect(state.kaypal.billingStatus).toBe('temporarily_unavailable');
    expect(JSON.stringify(state)).not.toContain('prisma');
    expect(JSON.stringify(state)).not.toContain('billingSubscription');
  });
});
