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

describe('LeadRepository.upsert 新线索自动增强', () => {
  it('新线索创建后触发四维评分 + 打标签（fire-and-forget）', async () => {
    const lead = {
      id: 'lead-1',
      userId: 'u1',
      tenantId: 't1',
      platform: 'douyin',
      sourceType: 'comment',
      sourceText: '你们这个怎么收费？',
      dedupeKey: 'lead:xxx',
      createdAt: new Date(),
    };
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(lead),
      },
    };
    const leadScore = {
      scoreLeadFromText: jest.fn().mockResolvedValue({
        snapshotId: 's1',
        totalScore: 18,
        components: {},
      }),
    };
    const repo = new LeadRepository(
      prisma as never,
      leadScore as never,
    );

    const result = await repo.upsert({
      userId: 'u1',
      tenantId: 't1',
      platform: 'douyin',
      sourceType: 'comment',
      sourceText: '你们这个怎么收费？',
    });

    expect(result.created).toBe(true);
    // fire-and-forget 评分 + 打标签（sourceType=comment → channel=mention）
    await new Promise((resolve) => setImmediate(resolve));
    expect(leadScore.scoreLeadFromText).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        text: '你们这个怎么收费？',
        channel: 'mention',
      }),
    );
  });

  it('未注入 LeadScoreService 时静默跳过（不抛错）', async () => {
    const prisma = {
      lead: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'lead-1',
          userId: 'u1',
          tenantId: 't1',
          platform: 'douyin',
          sourceType: 'manual-import',
          sourceText: 'test',
          dedupeKey: 'lead:xxx',
          createdAt: new Date(),
        }),
      },
    };
    const repo = new LeadRepository(prisma as never);

    const result = await repo.upsert({
      userId: 'u1',
      tenantId: 't1',
      platform: 'douyin',
      sourceType: 'manual-import',
      sourceText: 'test',
    });

    expect(result.created).toBe(true);
  });
});
