import { KeywordIntelligenceService } from './keyword-intelligence.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as never;
}

function makeService(
  prisma: never,
  deps: {
    aiClient?: { generate: jest.Mock };
    defaultModels?: { getDefaults: jest.Mock };
  } = {},
) {
  return new KeywordIntelligenceService(
    prisma,
    deps.aiClient as never,
    deps.defaultModels as never,
  );
}

/** 构造 LLM 依赖：默认模型 + 可控的 generate mock */
function makeLLMDeps(rawResult: string) {
  return {
    aiClient: { generate: jest.fn().mockResolvedValue(rawResult) },
    defaultModels: {
      getDefaults: jest.fn().mockResolvedValue({
        articleCreation: '',
        imageCreation: '',
        xCollection: '',
        topicSelection: 'model-chat-1',
      }),
    },
  };
}

describe('KeywordIntelligenceService（C-a 规则版）', () => {
  it('样本不足（< minLeadCount）返回空建议，不归纳', async () => {
    const prisma = makePrisma({
      lead: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', sourceText: 'x', customerId: null, signals: [] },
        ]),
      },
    });
    const svc = makeService(prisma);
    const out = await svc.suggestKeywords({ userId: 'u1', minLeadCount: 10 });
    expect(out.analyzedLeadCount).toBe(1);
    expect(out.sourceKeywords).toEqual([]);
    expect(out.demandKeywords).toEqual([]);
    expect(out.excludeKeywords).toEqual([]);
  });

  it('正反馈线索命中行业 sourceKeywords 产出 source 建议，负反馈命中词产出 exclude 建议', async () => {
    const leads = [
      // 正反馈：命中美业 sourceKeywords「美甲」+ demandKeywords「多少钱」
      { id: 'l1', sourceText: '美甲多少钱', customerId: null, signals: [{ type: 'engagement.reply' }] },
      { id: 'l2', sourceText: '想做美甲怎么预约', customerId: null, signals: [{ type: 'engagement.reply' }] },
      { id: 'l3', sourceText: '美甲贵吗', customerId: 'cust-1', signals: [] },
      // 负反馈：命中 excludeKeywords「广告」（美业词库无「广告」，但「招聘」在 exclude 里）
      { id: 'l4', sourceText: '招聘广告别发了', customerId: null, signals: [{ type: 'risk.negative_feedback' }] },
      { id: 'l5', sourceText: '别刷了招聘', customerId: null, signals: [{ type: 'risk.negative_feedback' }] },
    ];
    const prisma = makePrisma({
      lead: { findMany: jest.fn().mockResolvedValue(leads) },
    });
    const svc = makeService(prisma);
    const out = await svc.suggestKeywords({ userId: 'u1', industry: '美业', minLeadCount: 5 });

    expect(out.positiveLeadCount).toBe(3);
    expect(out.negativeLeadCount).toBe(2);
    // 正反馈高频词「美甲」（美业 sourceKeywords）应出现在 source 建议里
    const sourceWords = out.sourceKeywords.map((s) => s.keyword);
    expect(sourceWords).toContain('美甲');
    // 负反馈命中「招聘」（美业 excludeKeywords）应出现在 exclude 建议里
    const excludeWords = out.excludeKeywords.map((s) => s.keyword);
    expect(excludeWords).toContain('招聘');
    // 证据归因
    expect(out.sourceKeywords.find((s) => s.keyword === '美甲')?.evidenceCount).toBeGreaterThan(0);
    expect(out.sourceKeywords[0].source).toBe('positive');
  });

  it('无命中词库时返回空建议（不产垃圾词）', async () => {
    const leads = Array.from({ length: 12 }, (_, i) => ({
      id: `l${i}`,
      sourceText: '随便说点什么完全无关的内容啊', // 不命中任何词库词
      customerId: null,
      signals: [{ type: 'engagement.reply' }],
    }));
    const prisma = makePrisma({
      lead: { findMany: jest.fn().mockResolvedValue(leads) },
    });
    const svc = makeService(prisma);
    const out = await svc.suggestKeywords({ userId: 'u1', industry: '美业', minLeadCount: 10 });
    expect(out.sourceKeywords).toEqual([]);
    expect(out.demandKeywords).toEqual([]);
  });
});

describe('KeywordIntelligenceService（C-b LLM 语义归纳版）', () => {
  const leads = [
    // 正反馈：客户都在问「穿戴甲」（词库没有的新词，只有 LLM 能提炼）
    { id: 'l1', sourceText: '穿戴甲怎么买', customerId: 'cust-1', signals: [] },
    { id: 'l2', sourceText: '有穿戴甲吗', customerId: null, signals: [{ type: 'engagement.reply' }] },
    { id: 'l3', sourceText: '穿戴甲多少钱', customerId: null, signals: [{ type: 'engagement.reply' }] },
    // 负反馈
    { id: 'l4', sourceText: '又是广告别发了', customerId: null, signals: [{ type: 'risk.negative_feedback' }] },
    { id: 'l5', sourceText: '别刷了', customerId: null, signals: [{ type: 'risk.negative_feedback' }] },
  ];

  it('LLM 成功：语义归纳出新词（词库没有的「穿戴甲」）并带归因', async () => {
    const prisma = makePrisma({ lead: { findMany: jest.fn().mockResolvedValue(leads) } });
    const deps = makeLLMDeps(
      JSON.stringify({
        sourceKeywords: [{ keyword: '穿戴甲', reason: '真客户高频询问', evidenceCount: 3 }],
        demandKeywords: [{ keyword: '怎么买', reason: '购买意向', evidenceCount: 2 }],
        excludeKeywords: [{ keyword: '广告', reason: '负反馈高频', evidenceCount: 2 }],
      }),
    );
    const svc = makeService(prisma, deps);
    const out = await svc.suggestKeywordsWithLLM({ userId: 'u1', minLeadCount: 5 });

    // 调用了 LLM
    expect(deps.aiClient.generate).toHaveBeenCalledTimes(1);
    // 语义归纳出了词库没有的新词「穿戴甲」
    expect(out.sourceKeywords.map((s) => s.keyword)).toContain('穿戴甲');
    expect(out.excludeKeywords.map((s) => s.keyword)).toContain('广告');
    // 归因
    const wear = out.sourceKeywords.find((s) => s.keyword === '穿戴甲');
    expect(wear?.evidenceCount).toBe(3);
    expect(wear?.source).toBe('positive');
  });

  it('LLM 返回非法 JSON 时回落 C-a 规则版，不抛错', async () => {
    const prisma = makePrisma({ lead: { findMany: jest.fn().mockResolvedValue(leads) } });
    const deps = makeLLMDeps('这不是 JSON，是一段随便的回复');
    const svc = makeService(prisma, deps);
    const out = await svc.suggestKeywordsWithLLM({ userId: 'u1', minLeadCount: 5 });

    // 回落规则版：analyzedLeadCount 正确，不抛错
    expect(out.analyzedLeadCount).toBe(5);
    expect(Array.isArray(out.sourceKeywords)).toBe(true);
  });

  it('LLM 调用抛异常时回落 C-a 规则版', async () => {
    const prisma = makePrisma({ lead: { findMany: jest.fn().mockResolvedValue(leads) } });
    const deps = {
      aiClient: { generate: jest.fn().mockRejectedValue(new Error('网关超时')) },
      defaultModels: {
        getDefaults: jest.fn().mockResolvedValue({
          articleCreation: '',
          imageCreation: '',
          xCollection: '',
          topicSelection: 'model-chat-1',
        }),
      },
    };
    const svc = makeService(prisma, deps);
    const out = await svc.suggestKeywordsWithLLM({ userId: 'u1', minLeadCount: 5 });
    expect(out.analyzedLeadCount).toBe(5);
    expect(Array.isArray(out.sourceKeywords)).toBe(true);
  });

  it('无 AiClientService / 默认模型时直接回落 C-a，不调用 LLM', async () => {
    const prisma = makePrisma({ lead: { findMany: jest.fn().mockResolvedValue(leads) } });
    // 不传 aiClient/defaultModels（构造器里是 undefined）
    const svc = new KeywordIntelligenceService(prisma);
    const out = await svc.suggestKeywordsWithLLM({ userId: 'u1', minLeadCount: 5 });
    expect(out.analyzedLeadCount).toBe(5);
    expect(out.sourceKeywords).toEqual([]); // 词库无「穿戴甲」，规则版也提炼不出
  });
});
