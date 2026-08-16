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
