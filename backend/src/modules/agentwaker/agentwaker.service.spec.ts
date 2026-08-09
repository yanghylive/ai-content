import { AgentWakerService } from './agentwaker.service';

jest.mock('marked', () => ({
  marked: { parse: jest.fn((markdown: string) => `<p>${markdown}</p>`) },
}));

describe('AgentWakerService', () => {
  const service = new AgentWakerService(
    {} as never,
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('detects the vendored Xiaohongshu role package', () => {
    expect(service.listRoles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'xiaohongshu-operator',
          available: true,
        }),
        expect.objectContaining({
          id: 'wechat-official-account-operator',
          available: true,
        }),
      ]),
    );
  });

  it('reports role package health for the runtime gate', () => {
    expect(service.getRolePackageHealth()).toEqual(
      expect.objectContaining({
        ok: true,
        roles: expect.arrayContaining([
          expect.objectContaining({
            id: 'xiaohongshu-operator',
            available: true,
          }),
        ]),
      }),
    );
  });

  it('parses the structured note package contract', () => {
    const parse = (
      service as unknown as {
        parseGeneratedPackage(value: string): {
          note: { title: string; slides: unknown[] };
          publishingChecklist: {
            ready: boolean;
            risks: string[];
          };
        };
      }
    ).parseGeneratedPackage.bind(service);
    const slides = Array.from({ length: 5 }, (_, index) => ({
      role: index === 0 ? 'cover' : 'method',
      template: index === 0 ? 'cover-poster' : 'bullet-list',
      title: `卡片 ${index + 1}`,
      body: '可执行的卡片正文',
      bullets: ['要点一', '要点二'],
      highlight: '关键结论',
      imagePrompt: '',
      imageType: 'none',
    }));

    const result = parse(
      JSON.stringify({
        note: {
          title: '一篇可发布的小红书笔记',
          caption: '正文',
          hashtags: ['运营', '效率'],
          slides,
        },
        publishingChecklist: {
          ready: true,
          items: [{ label: '标题与正文一致', status: 'ready' }],
          risks: [],
        },
      }),
    );

    expect(result.note.title).toBe('一篇可发布的小红书笔记');
    expect(result.note.slides).toHaveLength(5);
    expect(result.publishingChecklist.ready).toBe(true);
    expect(result.publishingChecklist.risks).toEqual([]);
  });

  it('marks blocked checklist items as not ready', () => {
    const parse = (
      service as unknown as {
        parseGeneratedPackage(value: string): {
          publishingChecklist: { ready: boolean };
        };
      }
    ).parseGeneratedPackage.bind(service);
    const result = parse(
      JSON.stringify({
        note: {
          title: '风险样例',
          caption: '正文',
          hashtags: [],
          slides: Array.from({ length: 5 }, (_, index) => ({
            title: `卡片 ${index + 1}`,
            body: '正文',
            bullets: [],
            imageType: 'none',
          })),
        },
        publishingChecklist: {
          ready: true,
          items: [{ label: '素材授权', status: 'blocked' }],
          risks: ['素材授权待确认'],
        },
      }),
    );

    expect(result.publishingChecklist.ready).toBe(false);
  });

  it.each([
    [{ ready: true, items: [] }, '模型未返回发布检查项'],
    [
      {
        ready: true,
        items: [{ label: '未知检查状态', status: 'unexpected' }],
      },
      '未知检查状态',
    ],
  ])('fails closed for incomplete publishing checklists', (input, label) => {
    const parse = (
      service as unknown as {
        parsePublishingChecklist(value: unknown): {
          ready: boolean;
          items: Array<{ label: string; status: string }>;
        };
      }
    ).parsePublishingChecklist.bind(service);

    const result = parse(input);

    expect(result.ready).toBe(false);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label, status: 'blocked' }),
      ]),
    );
  });

  it('keeps WeChat remote preview checks pending until a platform draft exists', () => {
    const buildConfirmation = (
      service as unknown as {
        buildConfirmation(
          session: { id: string },
          articleId: string,
          checklist: { ready: boolean; items: unknown[]; risks: string[] },
          scope: { tenantId: string; userId: string },
          roleId: string,
        ): {
          requiredChecks: Array<{
            key: string;
            label: string;
            status: string;
          }>;
        };
      }
    ).buildConfirmation.bind(service);

    const confirmation = buildConfirmation(
      { id: 'run-1' },
      'article-1',
      { ready: true, items: [], risks: [] },
      { tenantId: 'tenant-1', userId: 'user-1' },
      'wechat-official-account-operator',
    );

    expect(confirmation.requiredChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'visuals-reviewed',
          status: 'warning',
          label: expect.stringContaining('保存平台草稿后核对'),
        }),
      ]),
    );
  });

  it('persists the final session and confirmation in one transaction', async () => {
    const transactionClient = {
      agentSession: { update: jest.fn().mockResolvedValue({}) },
      agentConfirmation: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(transactionClient),
      ),
    };
    const transactionalService = new AgentWakerService(
      prisma as never,
      { get: () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const persist = (
      transactionalService as unknown as {
        persistArtifactHandoff(
          session: Record<string, unknown>,
          confirmation: Record<string, unknown>,
          scope: { tenantId: string; userId: string },
        ): Promise<void>;
      }
    ).persistArtifactHandoff.bind(transactionalService);
    const now = new Date().toISOString();

    await persist(
      {
        id: 'run-1',
        status: 'waiting_for_confirmation',
        title: '任务',
        instruction: '生成内容',
        riskLevel: 'medium',
        events: [],
        confirmations: [],
        updatedAt: now,
      },
      {
        id: 'confirmation-1',
        sessionId: 'run-1',
        actionLabel: '进入草稿准备',
        status: 'pending',
        riskLevel: 'medium',
        title: '确认任务',
        description: '检查内容',
        createdAt: now,
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.agentSession.update).toHaveBeenCalledTimes(1);
    expect(transactionClient.agentConfirmation.upsert).toHaveBeenCalledTimes(1);
  });

  it('parses a WeChat article package and keeps only valid source URLs', () => {
    const parse = (
      service as unknown as {
        parseWechatGeneratedPackage(value: string): {
          article: { title: string; sourceLedger: Array<{ url: string }> };
          publishingChecklist: { ready: boolean };
        };
      }
    ).parseWechatGeneratedPackage.bind(service);

    const result = parse(
      JSON.stringify({
        article: {
          title: '一篇有证据的公众号文章',
          digest: '摘要',
          author: 'KAYPAL',
          markdown: `# 标题\n\n${'正文与证据。'.repeat(40)}`,
          sourceUrl: 'https://example.com/source',
          sourceLedger: [
            {
              title: '官方来源',
              url: 'https://example.com/docs',
              evidence: '支撑正文中的关键事实',
            },
            {
              title: '危险来源',
              url: 'javascript:alert(1)',
              evidence: '不得保留危险协议',
            },
          ],
        },
        publishingChecklist: {
          ready: true,
          items: [{ label: '事实已核对', status: 'ready' }],
          risks: [],
        },
      }),
    );

    expect(result.article.title).toBe('一篇有证据的公众号文章');
    expect(result.article.sourceLedger.map((item) => item.url)).toEqual([
      'https://example.com/docs',
    ]);
    expect(result.publishingChecklist.ready).toBe(true);
  });
});
