import { LeadRepository } from './lead.repository';

describe('LeadRepository.fromGrowthLead（收敛映射）', () => {
  it('把 GrowthLead 字段映射到 LeadUpsertInput', () => {
    const input = LeadRepository.fromGrowthLead({
      userId: 'user-1',
      tenantId: 'tenant-1',
      platform: 'douyin',
      sourceType: 'comment',
      sourceTaskId: 'task-1',
      sourceRunId: 'run-1',
      crmCustomerId: 'customer-1',
      nickname: '李女士',
      profileUrl: 'https://profile/1',
      externalUserId: 'ext-1',
      sourceText: '会员怎么收费',
      sourceUrl: 'https://douyin/item/1',
      videoTitle: '会员权益科普',
      videoUrl: 'https://douyin/video/1',
      commentTime: '2026-08-16T12:00:00Z',
      matchedKeywords: ['会员'],
      score: 80,
      scoreReasons: ['询价'],
      ownerUserId: 'owner-1',
      nextFollowUpAt: '2026-08-17T00:00:00Z',
      latestReply: '您好，会员分月卡年卡',
    });

    expect(input).toMatchObject({
      userId: 'user-1',
      platform: 'douyin',
      sourceType: 'comment',
      sourceTaskId: 'task-1',
      // 关键映射：GrowthLead.crmCustomerId → Lead.customerId
      customerId: 'customer-1',
      externalUserId: 'ext-1',
      score: 80,
      ownerUserId: 'owner-1',
      nextFollowUpAt: '2026-08-17T00:00:00Z',
    });
    // GrowthLead 特有字段折叠进 signals 不丢
    expect(input.signals).toEqual([
      {
        source: 'growth_lead',
        videoTitle: '会员权益科普',
        videoUrl: 'https://douyin/video/1',
        commentTime: '2026-08-16T12:00:00Z',
      },
    ]);
  });

  it('无 video/comment 时不产生 signals 噪音', () => {
    const input = LeadRepository.fromGrowthLead({
      userId: 'user-1',
      platform: 'xhs',
      sourceType: 'dm',
      sourceText: '在吗',
    });
    expect(input.signals).toEqual([]);
    expect(input.customerId).toBeNull();
  });
});

describe('LeadRepository.markConverted（S0-2 跨租户安全锁）', () => {
  const scope = { userId: 'user-1', tenantId: 'tenant-1' };

  function makeRepo(overrides: {
    crmCustomerFindFirst?: jest.Mock;
    leadUpdateMany?: jest.Mock;
    leadFindUnique?: jest.Mock;
  } = {}) {
    const prisma = {
      crmCustomer: {
        findFirst: overrides.crmCustomerFindFirst ?? jest.fn(),
      },
      lead: {
        updateMany: overrides.leadUpdateMany ?? jest.fn(),
        findUnique: overrides.leadFindUnique ?? jest.fn(),
      },
    };
    const events = { emit: jest.fn() };
    const repo = new LeadRepository(prisma as never, events as never);
    return { repo, prisma, events };
  }

  it('成功转客户：customer 归属校验通过 + updateMany 带 scope', async () => {
    const { repo, prisma, events } = makeRepo({
      crmCustomerFindFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }),
      leadUpdateMany: jest.fn().mockResolvedValue({ count: 1 }),
      leadFindUnique: jest
        .fn()
        .mockResolvedValue({ id: 'lead-1', customerId: 'customer-1', userId: 'user-1' }),
    });

    await repo.markConverted('lead-1', 'customer-1', scope);

    expect(prisma.crmCustomer.findFirst).toHaveBeenCalledWith({
      where: { id: 'customer-1', ownerId: 'user-1' },
      select: { id: true },
    });
    expect(prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', userId: 'user-1', tenantId: 'tenant-1' },
      data: { status: 'converted', customerId: 'customer-1' },
    });
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lead.converted' }),
    );
  });

  it('关联非本人客户抛 403', async () => {
    const { repo } = makeRepo({
      crmCustomerFindFirst: jest.fn().mockResolvedValue(null),
    });

    await expect(
      repo.markConverted('lead-1', 'others-customer', scope),
    ).rejects.toThrow('不能关联非本人客户');
  });

  it('跨用户 lead 转客户抛 404（updateMany count=0）', async () => {
    const { repo } = makeRepo({
      crmCustomerFindFirst: jest.fn().mockResolvedValue({ id: 'customer-1' }),
      leadUpdateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    await expect(
      repo.markConverted('others-lead', 'customer-1', scope),
    ).rejects.toThrow('线索不存在或无权操作');
  });
});
