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

describe('LeadRepository.dedupeKeyOf（去重键）', () => {
  it('有 externalUserId 时以 UID 为准（最强身份）', () => {
    const a = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      externalUserId: 'uid-123',
      nickname: '张三',
      sourceText: '多少钱',
    });
    const b = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      externalUserId: 'uid-123',
      nickname: '不同昵称',
      sourceText: '完全不同',
    });
    expect(a).toBe(b); // 同 UID 必同键
  });

  it('无 UID 时，前 40 字相同但后文不同的评论不再错并（P1-3 修复）', () => {
    const prefix = '这是一段很长的评论'.repeat(5); // 前 40 字完全相同
    const a = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      nickname: '用户A',
      sourceText: prefix + '结尾A',
    });
    const b = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      nickname: '用户A',
      sourceText: prefix + '结尾B完全不同',
    });
    expect(a).not.toBe(b); // 完整文本 sha256 不同 → 不合并
  });

  it('无 UID 且文本完全相同 → 同键（仍能正确去重）', () => {
    const a = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      nickname: '用户A',
      sourceText: '怎么买？',
    });
    const b = LeadRepository.dedupeKeyOf({
      platform: 'douyin',
      nickname: '用户A',
      sourceText: '怎么买？',
    });
    expect(a).toBe(b);
  });
});

describe('LeadRepository.findRepliedBySource（复核 P1-3 去重正确性）', () => {
  function makeRepo() {
    const prismaMock = {
      lead: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const repo = new LeadRepository(prismaMock as never);
    return { repo, prismaMock };
  }

  const baseArgs = {
    userId: 'u1',
    tenantId: 'tenant-1',
    platform: 'douyin',
    sourceAccountId: '24',
  };

  it('where 含 sourceType——评论不会复用私信同文草稿', async () => {
    const { repo, prismaMock } = makeRepo();
    await repo.findRepliedBySource(
      baseArgs.userId,
      baseArgs.tenantId,
      baseArgs.platform,
      baseArgs.sourceAccountId,
      'comment',
      'https://douyin/video/1',
      '在吗',
    );
    const where = prismaMock.lead.findFirst.mock.calls[0][0].where;
    expect(where.sourceType).toBe('comment');
  });

  it('where 含 sourceUrl——跨视频同文不会复用', async () => {
    const { repo, prismaMock } = makeRepo();
    await repo.findRepliedBySource(
      baseArgs.userId,
      baseArgs.tenantId,
      baseArgs.platform,
      baseArgs.sourceAccountId,
      'comment',
      'https://douyin/video/1',
      '太喜欢了',
    );
    const where = prismaMock.lead.findFirst.mock.calls[0][0].where;
    expect(where.sourceUrl).toBe('https://douyin/video/1');
  });

  it('where 含 status in approved/replied——失败旧草稿不复用', async () => {
    const { repo, prismaMock } = makeRepo();
    await repo.findRepliedBySource(
      baseArgs.userId,
      baseArgs.tenantId,
      baseArgs.platform,
      baseArgs.sourceAccountId,
      'comment',
      'https://douyin/video/1',
      '感谢分享',
    );
    const where = prismaMock.lead.findFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['approved', 'replied'] });
  });
});
