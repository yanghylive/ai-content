import { LeadScoreService } from './lead-score.service';
import { LeadSignalStore } from './lead-signal.store';
import { SIGNAL_RULES, aggregateByDimension, isExpired, computeTotal, DIMENSION_MAX } from './lead-score-rules';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    leadSignal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'sig-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    leadScoreSnapshot: {
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'snap-1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lead: {
      findUnique: jest.fn().mockResolvedValue({ matchedKeywords: [] }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ...overrides,
  } as never;
}

function makeService(prisma: never) {
  const store = new LeadSignalStore(prisma);
  return new LeadScoreService(prisma, store);
}

const base = { tenantId: 't1', userId: 'u1', leadId: 'lead-1' };

describe('LeadScoreRules', () => {
  it('intent.price 命中 +10（规则表）', () => {
    expect(SIGNAL_RULES['intent.price']).toEqual({ score: 10, decayHours: 168, dimension: 'intent' });
  });

  it('risk.opt_out 是最大扣分（30）', () => {
    expect(SIGNAL_RULES['risk.opt_out'].score).toBe(30);
  });

  it('时间衰减：过期信号不计入（intent 168h 外过期）', () => {
    const old = new Date(Date.now() - 200 * 3600_000); // 200h 前
    const recent = new Date(Date.now() - 10 * 3600_000); // 10h 前
    const components = aggregateByDimension([
      { type: 'intent.price', value: 10, observedAt: old },
      { type: 'intent.price', value: 10, observedAt: recent },
    ]);
    // 过期的 price 不计入，只有 recent 的 10 分（且 clamp 到 35 内）
    expect(components.intent).toBe(10);
  });

  it('fit 信号永不过期（decayHours=null）', () => {
    const old = new Date(Date.now() - 1000 * 3600_000);
    expect(isExpired('fit.industry', old, null)).toBe(false);
  });

  it('total = 各维和 - risk，clamp 0-100', () => {
    expect(computeTotal({ intent: 35, fit: 25, identity: 15, engagement: 10, recency: 10, risk: 0 })).toBe(95);
    expect(computeTotal({ intent: 0, fit: 0, identity: 0, engagement: 0, recency: 0, risk: 30 })).toBe(0);
    expect(computeTotal({ intent: 100, fit: 100, identity: 100, engagement: 100, recency: 100, risk: 0 })).toBe(100);
  });

  it('每维 clamp 到上限（不超）', () => {
    const components = aggregateByDimension([
      { type: 'intent.price', value: 10, observedAt: new Date() },
      { type: 'intent.price', value: 10, observedAt: new Date() },
      { type: 'intent.price', value: 10, observedAt: new Date() },
      { type: 'intent.price', value: 10, observedAt: new Date() },
      { type: 'intent.explicit_request', value: 15, observedAt: new Date() },
      { type: 'intent.question', value: 8, observedAt: new Date() },
    ]);
    expect(components.intent).toBe(DIMENSION_MAX.intent);
  });
});

describe('LeadScoreService', () => {
  it('generateSignals：询价文本命中 intent.price + explicit_request', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const out = await svc.generateSignals({
      ...base,
      platform: 'douyin',
      events: [{ id: 'ev-1', channel: 'comment', body: '这个多少钱？怎么收费', occurredAt: new Date() }],
    });
    const types = out.map((s) => s.type);
    expect(types).toContain('intent.price');
    expect(types).toContain('intent.question');
  });

  it('score：信号 → 四分数正确（intent.price 10 + engagement.reply 3）', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const r = await svc.score({
      ...base,
      signals: [
        { type: 'intent.price', value: 10, observedAt: new Date(), evidenceId: 'ev-1' },
        { type: 'engagement.reply', value: 3, observedAt: new Date(), evidenceId: 'ev-2' },
      ],
    });
    expect(r.intentScore).toBe(10);
    expect(r.totalScore).toBe(13);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.evidenceIds).toContain('ev-1');
  });

  it('score：身份已验证 → identity 满分 15', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const r = await svc.score({ ...base, signals: [], identity: { verified: true } });
    expect(r.identityConfidence).toBe(DIMENSION_MAX.identity);
    expect(r.reasons).toContain('身份已验证（externalUserId）');
  });

  it('score：无信号 → 0 分 + reasons「暂无证据（none found）」（0 vs null 区分）', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const r = await svc.score({ ...base, signals: [] });
    expect(r.totalScore).toBe(0); // 显式 0 分（有快照），不是 null 无数据
    expect(r.reasons.some((x) => x.includes('none found'))).toBe(true);
  });

  it('score：risk.opt_out → 直接扣 30，总分 0', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const r = await svc.score({
      ...base,
      signals: [{ type: 'risk.opt_out', value: 30, observedAt: new Date(), evidenceId: 'ev-x' }],
    });
    expect(r.riskScore).toBe(30);
    expect(r.totalScore).toBe(0);
  });

  it('saveSnapshot：不覆盖历史（create 一次 append 一条）', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const r = await svc.score({ ...base, signals: [] });
    const id1 = await svc.saveSnapshot({ ...base, snapshot: r });
    const id2 = await svc.saveSnapshot({ ...base, snapshot: r });
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(prisma.leadScoreSnapshot.create).toHaveBeenCalledTimes(2);
  });

  it('scoreAndPersist：全流程（信号 → 快照，不覆盖 lead.score）', async () => {
    const prisma = makePrisma();
    prisma.leadSignal.findMany = jest.fn().mockResolvedValue([
      { type: 'intent.price', value: 10, observedAt: new Date(), expiresAt: null, evidenceId: 'ev-1', source: 'x' },
    ]);
    const svc = makeService(prisma);
    const out = await svc.scoreAndPersist(base);
    expect(out.totalScore).toBe(10);
    expect(prisma.leadScoreSnapshot.create).toHaveBeenCalledTimes(1);
    // 四维分只存快照，不覆盖 lead.score（裸分与质量分并存）
    expect(prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('scoreLeadFromText：有文本 → 生成信号 + 快照 + 打标签，不覆盖 lead.score', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const out = await svc.scoreLeadFromText({
      tenantId: 't1',
      userId: 'u1',
      leadId: 'lead-1',
      platform: 'douyin',
      text: '你们这个怎么收费？',
    });
    expect(out.snapshotId).toBeTruthy();
    expect(prisma.leadSignal.create).toHaveBeenCalled(); // 生成了意向信号
    expect(prisma.leadScoreSnapshot.create).toHaveBeenCalledTimes(1);
    // 打标签：updateMany 写入 matchedKeywords（价格意向/疑问咨询），但不写 score
    expect(prisma.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchedKeywords: expect.arrayContaining(['价格意向', '疑问咨询']),
        }),
      }),
    );
    const scoreWrite = prisma.lead.updateMany.mock.calls.some(
      (call: Array<{ data?: Record<string, unknown> }>) =>
        call[0]?.data && 'score' in call[0].data,
    );
    expect(scoreWrite).toBe(false); // 不覆盖 lead.score
  });

  it('scoreLeadFromText：空文本 → 不生成信号但仍有快照（0 分）', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const out = await svc.scoreLeadFromText({
      tenantId: 't1',
      userId: 'u1',
      leadId: 'lead-1',
      platform: 'douyin',
      text: '',
    });
    expect(out.totalScore).toBe(0);
    expect(prisma.leadSignal.create).not.toHaveBeenCalled();
    expect(prisma.leadScoreSnapshot.create).toHaveBeenCalledTimes(1);
  });
});
