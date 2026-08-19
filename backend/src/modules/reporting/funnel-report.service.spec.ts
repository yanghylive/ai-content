import { FunnelReportService } from './funnel-report.service';

function makeService(overrides: {
  article?: jest.Mock;
  publishRecord?: jest.Mock;
  interactionEvent?: jest.Mock;
  lead?: jest.Mock;
  crmOpportunity?: jest.Mock;
  crmCustomer?: jest.Mock;
} = {}) {
  const prisma = {
    article: {
      findFirst: overrides.article ?? jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    publishRecord: { count: jest.fn().mockResolvedValue(0) },
    interactionEvent: { count: jest.fn().mockResolvedValue(0) },
    lead: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    crmOpportunity: { count: jest.fn().mockResolvedValue(0) },
    crmCustomer: { count: jest.fn().mockResolvedValue(0) },
  };
  const service = new FunnelReportService(prisma as never);
  return { service, prisma };
}

const USER = 'user-1';

describe('FunnelReportService', () => {
  it('articleFunnel 聚合文章六步漏斗（带 userId scope）', async () => {
    const { service, prisma } = makeService({
      article: jest
        .fn()
        .mockResolvedValue({ id: 'article-1', title: '会员权益科普', status: 'published' }),
    });
    prisma.publishRecord.count.mockResolvedValue(3);
    prisma.interactionEvent.count.mockResolvedValue(18);
    prisma.lead.count.mockResolvedValue(9);
    prisma.lead.findMany.mockResolvedValue([
      { customerId: 'customer-1' },
      { customerId: 'customer-1' },
      { customerId: 'customer-2' },
    ]);
    prisma.crmOpportunity.count.mockResolvedValue(2);

    const result = await service.articleFunnel('article-1', USER);

    expect(result).toMatchObject({
      article: { id: 'article-1' },
      funnel: { publish: 3, interaction: 18, lead: 9, customer: 2, opportunity: 2 },
    });
    // article 查询必须带 userId scope（堵 IDOR）
    expect(prisma.article.findFirst).toHaveBeenCalledWith({
      where: { id: 'article-1', userId: USER },
      select: { id: true, title: true, status: true },
    });
    // 下游 count 也带 userId
    expect(prisma.publishRecord.count).toHaveBeenCalledWith({
      where: { articleId: 'article-1', userId: USER },
    });
    // 去重后的 customerId 用于查商机（带 ownerId scope，堵跨用户 IDOR）
    expect(prisma.crmOpportunity.count).toHaveBeenCalledWith({
      where: {
        primaryCustomerId: { in: ['customer-1', 'customer-2'] },
        ownerId: USER,
      },
    });
  });

  it('articleFunnel 他人文章返回 null（IDOR 拦截）', async () => {
    const { service } = makeService({
      article: jest.fn().mockResolvedValue(null),
    });

    const result = await service.articleFunnel('others-article', USER);

    expect(result).toBeNull();
  });

  it('funnel 聚合全局六步漏斗（带 userId scope）', async () => {
    const { service, prisma } = makeService();
    prisma.article.count.mockResolvedValue(32);
    prisma.publishRecord.count.mockResolvedValue(28);
    prisma.interactionEvent.count.mockResolvedValue(20);
    prisma.lead.count.mockResolvedValue(9);
    prisma.crmCustomer.count.mockResolvedValue(5);
    prisma.crmOpportunity.count.mockResolvedValue(3);

    const result = await service.funnel(7, USER);

    expect(result.funnel).toEqual({
      content: 32,
      publish: 28,
      interaction: 20,
      lead: 9,
      customer: 5,
      opportunity: 3,
    });
    expect(result.range).toBe('7d');
    // 全局漏斗也必须按 userId 过滤，不统计全库
    expect(prisma.article.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: USER }),
    });
    expect(prisma.crmCustomer.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ ownerId: USER }),
    });
  });
});

describe('FunnelReportService 租户隔离（P1-19 复核）', () => {
  it('articleFunnel 带 tenantId → 文章归属校验含租户维度（防跨租户裸 ID 联查）', async () => {
    const { service, prisma } = makeService({
      article: jest
        .fn()
        .mockResolvedValue({ id: 'article-1', title: 't', status: 'published' }),
    });
    await service.articleFunnel('article-1', USER, 'tenant-1');

    expect(prisma.article.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'article-1', userId: USER, tenantId: 'tenant-1' },
      }),
    );
    expect(prisma.lead.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceArticleId: 'article-1',
          userId: USER,
          tenantId: 'tenant-1',
        }),
      }),
    );
  });

  it('funnel 带 tenantId → 全部查询按租户过滤', async () => {
    const { service, prisma } = makeService();
    await service.funnel(7, USER, 'tenant-1');

    expect(prisma.article.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER, tenantId: 'tenant-1' }),
      }),
    );
    expect(prisma.crmCustomer.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: USER, tenantId: 'tenant-1' }),
      }),
    );
  });
});
