import { ReportQualityGateService } from './report-quality-gate.service';

function createService(overrides?: {
  events?: Array<{ externalEventId: string | null }>;
  latestEvent?: { occurredAt: Date } | null;
  failedCount?: number;
  successCount?: number;
  leads?: Array<{ sourceArticleId: string | null; sourceRunId: string | null }>;
  articleCount?: number;
  leadCount?: number;
}) {
  const prisma = {
    article: { count: jest.fn().mockResolvedValue(overrides?.articleCount ?? 5) },
    lead: {
      count: jest.fn().mockResolvedValue(overrides?.leadCount ?? 5),
      findMany: jest.fn().mockResolvedValue(overrides?.leads ?? [
        { sourceArticleId: 'a1', sourceRunId: null },
        { sourceArticleId: 'a2', sourceRunId: null },
      ]),
    },
    interactionEvent: {
      findMany: jest.fn().mockResolvedValue(overrides?.events ?? []),
      findFirst: jest.fn().mockResolvedValue(
        overrides?.latestEvent === undefined
          ? { occurredAt: new Date() }
          : overrides.latestEvent,
      ),
    },
    publishRecord: {
      count: jest.fn().mockImplementation((args: { where?: { status?: string } }) => {
        if (args?.where?.status === 'failed')
          return Promise.resolve(overrides?.failedCount ?? 1);
        if (args?.where?.status === 'success')
          return Promise.resolve(overrides?.successCount ?? 10);
        return Promise.resolve(0);
      }),
    },
  };
  const service = new ReportQualityGateService(prisma as any);
  return { service, prisma };
}

const OWNER = { userId: 'user-1', tenantId: null };

describe('ReportQualityGateService（方案 10.4 五项检查）', () => {
  it('健康数据判定为 pass，返回 5 项检查', async () => {
    const { service } = createService();
    const result = await service.runGate(OWNER);
    expect(result.verdict).toBe('pass');
    expect(result.checks).toHaveLength(5);
    expect(result.checks.map((c) => c.key)).toEqual([
      'tenant_scope',
      'duplicate_events',
      'sync_delay',
      'failed_task_miscount',
      'primary_key_linkage',
    ]);
  });

  it('发现重复 externalEventId → duplicate_events warning', async () => {
    const { service } = createService({
      events: [
        { externalEventId: 'e1' },
        { externalEventId: 'e1' },
        { externalEventId: 'e2' },
      ],
    });
    const result = await service.runGate(OWNER);
    const dup = result.checks.find((c) => c.key === 'duplicate_events');
    expect(dup?.status).toBe('warning');
    expect(result.verdict).toBe('warning');
  });

  it('最近事件超过 48h → sync_delay warning', async () => {
    const stale = new Date(Date.now() - 72 * 3600000);
    const { service } = createService({ latestEvent: { occurredAt: stale } });
    const result = await service.runGate(OWNER);
    const sync = result.checks.find((c) => c.key === 'sync_delay');
    expect(sync?.status).toBe('warning');
  });

  it('无互动事件 → sync_delay warning', async () => {
    const { service } = createService({ latestEvent: null });
    const result = await service.runGate(OWNER);
    const sync = result.checks.find((c) => c.key === 'sync_delay');
    expect(sync?.status).toBe('warning');
  });

  it('失败任务占比 >50% → failed_task_miscount warning', async () => {
    const { service } = createService({ failedCount: 8, successCount: 2 });
    const result = await service.runGate(OWNER);
    const mis = result.checks.find((c) => c.key === 'failed_task_miscount');
    expect(mis?.status).toBe('warning');
  });

  it('线索主键关联率 <50% → primary_key_linkage warning', async () => {
    const { service } = createService({
      leads: [
        { sourceArticleId: null, sourceRunId: null },
        { sourceArticleId: null, sourceRunId: null },
        { sourceArticleId: 'a1', sourceRunId: null },
      ],
    });
    const result = await service.runGate(OWNER);
    const link = result.checks.find((c) => c.key === 'primary_key_linkage');
    expect(link?.status).toBe('warning');
  });

  it('无线索 → primary_key_linkage warning', async () => {
    const { service } = createService({ leads: [] });
    const result = await service.runGate(OWNER);
    const link = result.checks.find((c) => c.key === 'primary_key_linkage');
    expect(link?.status).toBe('warning');
  });

  it('租户范围校验查询失败 → tenant_scope unavailable（fail-closed）', async () => {
    const { service, prisma } = createService();
    prisma.article.count.mockRejectedValue(new Error('db down'));
    const result = await service.runGate(OWNER);
    const scope = result.checks.find((c) => c.key === 'tenant_scope');
    expect(scope?.status).toBe('unavailable');
  });
});
