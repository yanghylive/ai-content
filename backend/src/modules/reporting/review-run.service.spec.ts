import { ReviewRunService } from './review-run.service';

function makeService(overrides: {
  reviewRun?: {
    create?: jest.Mock;
    findMany?: jest.Mock;
    findFirst?: jest.Mock;
  };
  contentPlan?: { create?: jest.Mock };
} = {}) {
  const prisma = {
    reviewRun: {
      create: overrides.reviewRun?.create ?? jest.fn(),
      findMany: overrides.reviewRun?.findMany ?? jest.fn().mockResolvedValue([]),
      findFirst: overrides.reviewRun?.findFirst ?? jest.fn(),
    },
    contentPlan: {
      create: overrides.contentPlan?.create ?? jest.fn(),
    },
  };
  const funnelReport = {
    articleFunnel: jest.fn().mockResolvedValue({ article: { id: 'a1' }, funnel: {} }),
    funnel: jest.fn().mockResolvedValue({ range: '7d', funnel: {} }),
  };
  const service = new ReviewRunService(prisma as never, funnelReport as never);
  return { service, prisma, funnelReport };
}

const owner = { userId: 'user-1', tenantId: 'tenant-1' };

describe('ReviewRunService', () => {
  it('generate 全局复盘复用 funnel() 并保存快照', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'run-1' });
    const { service, funnelReport } = makeService({
      reviewRun: { create },
    });

    await service.generate(
      { period: '7d', insights: [{ observation: 'o', evidence: 'e', confidence: 'c', decision: 'd' }], actions: [] },
      owner,
    );

    expect(funnelReport.funnel).toHaveBeenCalledWith(7, 'user-1', 'tenant-1');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ period: '7d', userId: 'user-1' }),
      }),
    );
  });

  it('generate 按文章复盘复用 articleFunnel()', async () => {
    const { service, funnelReport } = makeService();
    await service.generate(
      { period: '7d', generatedFrom: 'article-1', insights: [], actions: [] },
      owner,
    );
    expect(funnelReport.articleFunnel).toHaveBeenCalledWith('article-1', 'user-1', 'tenant-1');
  });

  it('findOne 不存在抛 404（带 owner scope）', async () => {
    const { service } = makeService({
      reviewRun: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.findOne('missing', owner)).rejects.toThrow(/不存在/);
  });

  it('copyActionToContentPlan 把动作回写为新内容计划', async () => {
    const run = {
      id: 'run-1',
      actions: [{ action: '建立高意向优先队列', expectedSignal: '24h 响应率提升' }],
      generatedFrom: 'global',
    };
    const create = jest.fn().mockResolvedValue({ id: 'plan-2' });
    const { service } = makeService({
      reviewRun: { findFirst: jest.fn().mockResolvedValue(run) },
      contentPlan: { create },
    });

    const result = await service.copyActionToContentPlan('run-1', 0, owner);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '建立高意向优先队列',
          successMetric: '24h 响应率提升',
        }),
      }),
    );
    expect(result).toEqual({ id: 'plan-2' });
  });

  it('copyActionToContentPlan 动作不存在抛 404', async () => {
    const { service } = makeService({
      reviewRun: {
        findFirst: jest.fn().mockResolvedValue({ id: 'run-1', actions: [] }),
      },
    });
    await expect(service.copyActionToContentPlan('run-1', 0, owner)).rejects.toThrow(
      /没有对应的动作/,
    );
  });
});
