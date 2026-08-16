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
      findUnique: overrides.article ?? jest.fn(),
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

describe('FunnelReportService', () => {
  it('articleFunnel 聚合文章六步漏斗', async () => {
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

    const result = await service.articleFunnel('article-1');

    expect(result).toMatchObject({
      article: { id: 'article-1' },
      funnel: { publish: 3, interaction: 18, lead: 9, customer: 2, opportunity: 2 },
    });
    // 去重后的 customerId 用于查商机
    expect(prisma.crmOpportunity.count).toHaveBeenCalledWith({
      where: { primaryCustomerId: { in: ['customer-1', 'customer-2'] } },
    });
  });

  it('articleFunnel 文章不存在返回 null', async () => {
    const { service } = makeService({
      article: jest.fn().mockResolvedValue(null),
    });

    const result = await service.articleFunnel('missing');

    expect(result).toBeNull();
  });

  it('funnel 聚合全局六步漏斗', async () => {
    const { service, prisma } = makeService();
    prisma.article.count.mockResolvedValue(32);
    prisma.publishRecord.count.mockResolvedValue(28);
    prisma.interactionEvent.count.mockResolvedValue(20);
    prisma.lead.count.mockResolvedValue(9);
    prisma.crmCustomer.count.mockResolvedValue(5);
    prisma.crmOpportunity.count.mockResolvedValue(3);

    const result = await service.funnel(7);

    expect(result.funnel).toEqual({
      content: 32,
      publish: 28,
      interaction: 20,
      lead: 9,
      customer: 5,
      opportunity: 3,
    });
    expect(result.range).toBe('7d');
  });
});
