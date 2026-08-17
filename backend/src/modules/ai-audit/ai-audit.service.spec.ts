import { AiAuditService, QuotaStatus } from './ai-audit.service';

describe('AiAuditService token usage tracking', () => {
  let prisma: any;
  let service: AiAuditService;

  beforeEach(() => {
    prisma = {
      aiUsageQuota: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => create),
      },
      aiToolCallLog: {
        create: jest.fn(async () => ({})),
      },
      aiChatLog: {
        create: jest.fn(async () => ({})),
      },
    };
    service = new AiAuditService(prisma);
  });

  it('getQuota 返回 token 维度默认值', async () => {
    const quota: QuotaStatus = await service.getQuota('user-1');
    expect(quota.tokenCount).toBe(0);
    expect(quota.tokenLimit).toBe(2_000_000);
    expect(quota.tokenRemaining).toBe(2_000_000);
  });

  it('canUseTokens 预检：额度内 ok，超额度拒绝', async () => {
    prisma.aiUsageQuota.findUnique.mockResolvedValue({
      userId: 'user-1',
      date: new Date(),
      chatCount: 0,
      toolCount: 0,
      chatLimit: 50,
      toolLimit: 100,
      tokenCount: 1_900_000,
      tokenLimit: 2_000_000,
    });
    const ok = await service.canUseTokens('user-1', 50_000);
    expect(ok.ok).toBe(true);
    const blocked = await service.canUseTokens('user-1', 200_000);
    expect(blocked.ok).toBe(false);
  });

  it('recordTokenUsage 累加 tokenCount 并写明细', async () => {
    await service.recordTokenUsage({
      userId: 'user-1',
      tokens: 12_345,
      tool: 'rpa-wechat-broadcast',
      scene: 'group-broadcast',
      refId: 'task-1',
    });
    const upsertCall = prisma.aiUsageQuota.upsert.mock.calls[0][0];
    expect(upsertCall.create.tokenCount).toBe(12_345);
    expect(upsertCall.update.tokenCount.increment).toBe(12_345);
    const logCall = prisma.aiToolCallLog.create.mock.calls[0][0].data;
    expect(logCall.tool).toBe('rpa-wechat-broadcast');
    expect(logCall.tokensUsed).toBe(12_345);
    expect(logCall.argsJson).toContain('group-broadcast');
  });

  it('recordTokenUsage 负数/零 tokens 不累加但写明细', async () => {
    await service.recordTokenUsage({ userId: 'user-1', tokens: 0 });
    expect(prisma.aiUsageQuota.upsert).not.toHaveBeenCalled();
    expect(prisma.aiToolCallLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('AiAuditService · economySummary（token 经济看板）', () => {
  it('汇总 token + costPoints + 场景分布 + 每日趋势', async () => {
    const prisma = {
      aiToolCallLog: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { tokensUsed: 5000, costPoints: 100000 },
          _count: 3,
        }),
        groupBy: jest.fn().mockResolvedValue([
          { tool: 'text_generation', _sum: { tokensUsed: 4000, costPoints: 80000 } },
          { tool: 'vision', _sum: { tokensUsed: 1000, costPoints: 20000 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          { createdAt: new Date('2026-08-15T10:00:00Z'), tokensUsed: 2000, costPoints: 40000 },
          { createdAt: new Date('2026-08-16T10:00:00Z'), tokensUsed: 3000, costPoints: 60000 },
        ]),
      },
      tenantMember: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }]) },
    };
    const svc = new AiAuditService(prisma as never);
    const r = await svc.economySummary({ days: 7 });
    expect(r.totalTokens).toBe(5000);
    expect(r.totalCostPoints).toBe(100000); // token×20
    expect(r.topScenes).toHaveLength(2);
    expect(r.daily).toHaveLength(2);
    expect(r.daily[1].costPoints).toBe(60000);
  });
});
