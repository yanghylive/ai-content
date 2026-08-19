import { StatsService } from './stats.service';

function createService(overrides?: { autoUploadHealth?: unknown }) {
  const prisma = {
    lead: {
      count: jest.fn().mockResolvedValue(8),
      findMany: jest.fn().mockResolvedValue([]),
    },
    material: { count: jest.fn().mockResolvedValue(3) },
    interactionTask: { count: jest.fn().mockResolvedValue(2) },
    publishRecord: { count: jest.fn().mockResolvedValue(1) },
    article: { count: jest.fn().mockResolvedValue(5) },
    crmOpportunity: { count: jest.fn().mockResolvedValue(0) },
    growthAcquisitionRun: {
      findMany: jest.fn().mockResolvedValue([
        { candidateCount: 10, selectedCount: 8, contactedCount: 6 },
      ]),
    },
    growthAcquisitionConfig: { count: jest.fn().mockResolvedValue(2) },
    agentConfirmation: { count: jest.fn().mockResolvedValue(1) },
  };
  const autoUpload = overrides?.autoUploadHealth
    ? {
        getAccountHealth: jest.fn().mockResolvedValue(overrides.autoUploadHealth),
      }
    : undefined;
  const service = new StatsService(prisma as any, undefined, autoUpload as any);
  return { service, prisma };
}

describe('StatsService 指标规范（方案 10.2）', () => {
  it('today 域每个指标都补全 10.2 元数据（公式/归因窗口/样本量/置信度）', async () => {
    const { service } = createService();
    const snapshot = await service.getSnapshot('today');
    expect(snapshot.metrics.length).toBeGreaterThan(0);
    for (const metric of snapshot.metrics) {
      expect(metric.formula).toBeTruthy();
      expect(metric.attributionWindow).toBeTruthy();
      expect(metric).toHaveProperty('platformGap');
      expect(typeof metric.sampleSize).toBe('number');
      expect(['none', 'low', 'medium', 'high']).toContain(metric.confidence);
      expect(metric.lastSyncedAt).toBeTruthy();
    }
  });

  it('today.leads 的公式/归因窗口精确匹配', async () => {
    const { service } = createService();
    const snapshot = await service.getSnapshot('today');
    const leads = snapshot.metrics.find((m) => m.key === 'today.leads')!;
    expect(leads.formula).toContain('COUNT(leads)');
    expect(leads.attributionWindow).toContain('当日更新');
    expect(leads.value).toBe(8);
    expect(leads.sampleSize).toBe(8);
  });

  it('growth 域漏斗补全元数据', async () => {
    const { service } = createService();
    const snapshot = await service.getSnapshot('growth');
    const candidates = snapshot.metrics.find(
      (m) => m.key === 'growth.funnel.candidates',
    )!;
    expect(candidates.formula).toContain('SUM(growth_acquisition_runs');
    expect(candidates.value).toBe(10);
    expect(candidates.sampleSize).toBe(10);
  });

  it('account-health 域平台缺失说明保留（本地引擎可见账号）', async () => {
    const { service } = createService({
      autoUploadHealth: {
        totalAccounts: 2,
        readyAccounts: 2,
        expiredAccounts: 0,
        issues: [],
        waitingTasks: [],
      },
    });
    const snapshot = await service.getSnapshot('account-health');
    const total = snapshot.metrics.find(
      (m) => m.key === 'account_health.total',
    )!;
    expect(total.value).toBe(2);
    expect(total.platformGap).toContain('本地发布引擎');
    expect(total.formula).toBeTruthy();
  });

  it('approval 域补全元数据', async () => {
    const { service } = createService();
    const snapshot = await service.getSnapshot('approval');
    expect(snapshot.metrics).toHaveLength(2);
    for (const metric of snapshot.metrics) {
      expect(metric.formula).toBeTruthy();
      expect(metric.attributionWindow).toBe('当前时点快照');
    }
  });

  it('未知域返回空 metrics（不报错）', async () => {
    const { service } = createService();
    const snapshot = await service.getSnapshot('unknown-domain');
    expect(snapshot.metrics).toEqual([]);
  });
});
