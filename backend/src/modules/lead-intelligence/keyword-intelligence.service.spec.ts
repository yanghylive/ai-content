import { KeywordIntelligenceService } from './keyword-intelligence.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as never;
}

function makeService(prisma: never) {
  return new KeywordIntelligenceService(prisma);
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
