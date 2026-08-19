import { GrowthLeadBridgeService } from './growth-lead-bridge.service';
import type { GrowthLead } from './growth.types';

function makeLead(overrides: Partial<GrowthLead> = {}): GrowthLead {
  return {
    id: 'lead-1',
    userId: 'u-1',
    platform: 'douyin',
    sourceType: 'auto-acquisition',
    nickname: '张三',
    externalUserId: 'douyin-user-1',
    sourceText: '你们这个怎么收费？',
    sourceUrl: 'https://www.douyin.com/video/1',
    matchedKeywords: [],
    score: 80,
    scoreReasons: [],
    status: 'new',
    evidenceUrls: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceArticleId: 'article-1',
    sourcePublishRecordId: 'publish-1',
    contentId: 'content-1',
    ...overrides,
  };
}

function makeBridge() {
  const prisma = {
    interactionEvent: {
      upsert: jest.fn().mockResolvedValue({ id: 'event-1' }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({
        id: 'event-1',
        channel: 'comment',
        body: '怎么收费',
        evidenceUrl: null,
        occurredAt: new Date(),
        identityId: 'identity-1',
      }),
    },
    platformIdentity: {
      upsert: jest.fn().mockResolvedValue({ id: 'identity-1' }),
      findUnique: jest.fn().mockResolvedValue({
        verified: true,
        profileUrl: 'https://x',
        nickname: '张三',
        identityConfidence: 100,
      }),
    },
    lead: {
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    },
    leadScoreSnapshot: {
      findFirst: jest.fn().mockResolvedValue({ confidence: 50, reasons: [] }),
    },
  };
  const leadScoreService = {
    generateSignals: jest.fn().mockResolvedValue(undefined),
    scoreAndPersist: jest.fn().mockResolvedValue({
      snapshotId: 'snap-1',
      totalScore: 70,
      components: { risk: 0, identity: 100 },
    }),
  };
  const suppressionService = {
    isSuppressed: jest.fn().mockResolvedValue({ suppressed: false }),
  };
  const qualificationService = {
    route: jest.fn().mockReturnValue(null),
  };
  const attributionEventStore = {
    saveLink: jest.fn().mockResolvedValue(undefined),
    saveInteractionChain: jest.fn().mockResolvedValue(undefined),
    saveLeadResultChain: jest.fn().mockResolvedValue(undefined),
  };
  const bridge = new GrowthLeadBridgeService(
    prisma as never,
    leadScoreService as never,
    suppressionService as never,
    qualificationService as never,
    attributionEventStore as never,
  );
  return {
    bridge,
    prisma,
    leadScoreService,
    suppressionService,
    qualificationService,
    attributionEventStore,
  };
}

describe('GrowthLeadBridgeService（事实来源桥接 + 评分/抑制/资格接入）', () => {
  it('bridgeAndEnrich：InteractionEvent 写入内容/发布归因字段', async () => {
    const { bridge, prisma } = makeBridge();
    const result = await bridge.bridgeAndEnrich(makeLead(), {
      tenantId: 't1',
      userId: 'u-1',
      accountId: 'account-1',
    });

    expect(result.eventId).toBe('event-1');
    expect(result.sourceInteractionEventId).toBe('event-1');
    expect(prisma.interactionEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceArticleId: 'article-1',
          publishRecordId: 'publish-1',
          contentId: 'content-1',
        }),
      }),
    );
  });

  it('bridgeAndEnrich：无归因字段 → 写入 null（不误标无上游内容的互动为内容归因）', async () => {
    const { bridge, prisma } = makeBridge();
    await bridge.bridgeAndEnrich(
      makeLead({ sourceArticleId: null, sourcePublishRecordId: null, contentId: null }),
      { tenantId: 't1', userId: 'u-1', accountId: 'account-1' },
    );

    expect(prisma.interactionEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          sourceArticleId: null,
          publishRecordId: null,
          contentId: null,
        }),
      }),
    );
  });

  it('bridgeAndEnrich：InteractionEvent 失败不阻断（逐段 catch，eventId=null）', async () => {
    const { bridge, prisma } = makeBridge();
    prisma.interactionEvent.upsert.mockRejectedValue(new Error('db down'));

    const result = await bridge.bridgeAndEnrich(makeLead(), {
      tenantId: 't1',
      userId: 'u-1',
    });

    expect(result.eventId).toBeNull();
    expect(result.sourceInteractionEventId).toBeNull();
    // P0-5 复核：失败必须记录分段明细，调用方据此标 enrichmentStatus=failed（禁假闭环）
    expect(result.failedSegments).toContain('interaction_event');
  });

  it('bridgeAndEnrich：评分失败不阻断（eventId 正常，scoreSnapshotId=null）', async () => {
    const { bridge, leadScoreService } = makeBridge();
    leadScoreService.scoreAndPersist.mockRejectedValue(new Error('score fail'));

    const result = await bridge.bridgeAndEnrich(makeLead(), {
      tenantId: 't1',
      userId: 'u-1',
      accountId: 'account-1',
    });

    expect(result.eventId).toBe('event-1');
    expect(result.scoreSnapshotId).toBeNull();
    // P0-5 复核：评分失败记入 failedSegments
    expect(result.failedSegments).toContain('scoring');
  });

  it('bridgeAndEnrich：完整成功 → 归因链（interaction→lead）落库', async () => {
    const { bridge, attributionEventStore } = makeBridge();
    await bridge.bridgeAndEnrich(makeLead(), {
      tenantId: 't1',
      userId: 'u-1',
      accountId: 'account-1',
    });

    expect(attributionEventStore.saveLink).toHaveBeenCalledWith(
      expect.objectContaining({
        fromType: 'interaction',
        fromId: 'event-1',
        toType: 'lead',
        toId: 'lead-1',
        label: 'created_from',
      }),
    );
  });

  it('bridgeAndEnrich：完整成功 → 互动→发布/内容 归因链落库（saveInteractionChain）', async () => {
    const { bridge, attributionEventStore } = makeBridge();
    await bridge.bridgeAndEnrich(makeLead(), {
      tenantId: 't1',
      userId: 'u-1',
      accountId: 'account-1',
    });

    expect(attributionEventStore.saveInteractionChain).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionEventId: 'event-1',
        publishRecordId: 'publish-1',
        contentId: 'content-1',
      }),
    );
  });
});

describe('GrowthLeadBridge InteractionEvent 去重键（P1-18 复核）', () => {
  it('同一事件（sourceInteractionEventId）→ 去重键唯一（不因内容/文本变化重复入库）', async () => {
    const { bridge, prisma } = makeBridge();
    const eventInput = (articleId: string) => ({
      id: 'lead-1',
      userId: 'u1',
      tenantId: 't1',
      platform: 'kuaishou',
      sourceType: 'auto-acquisition' as const,
      nickname: '装修用户',
      externalUserId: 'ks-user-1',
      sourceText: '这个价格怎么算？',
      sourceArticleId: articleId,
      matchedKeywords: [],
      score: 80,
      scoreReasons: [],
      status: 'new' as const,
      evidenceUrls: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const event = eventInput('v1');
    await (bridge as any).upsertInteractionEvent(event, {
      tenantId: 't1',
      userId: 'u1',
      accountId: 'ks-1',
    });
    await (bridge as any).upsertInteractionEvent(event, {
      tenantId: 't1',
      userId: 'u1',
      accountId: 'ks-1',
    });

    const upsertCalls = prisma.interactionEvent.upsert.mock.calls;
    // P1 复核：同事件两次写入用同一 dedupeKey（upsert 幂等合并，不重复入库）
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0][0].where.tenantId_dedupeKey.dedupeKey).toBe(
      upsertCalls[1][0].where.tenantId_dedupeKey.dedupeKey,
    );
  });

  it('不同事件（sourceInteractionEventId 不同）→ 去重键不同（不误合并）', async () => {
    const { bridge, prisma } = makeBridge();
    const eventInput = (eventId: string) => ({
      id: 'lead-1',
      userId: 'u1',
      tenantId: 't1',
      platform: 'kuaishou',
      sourceType: 'auto-acquisition' as const,
      nickname: '装修用户',
      externalUserId: 'ks-user-1',
      sourceText: '这个价格怎么算？',
      sourceInteractionEventId: eventId,
      matchedKeywords: [],
      score: 80,
      scoreReasons: [],
      status: 'new' as const,
      evidenceUrls: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await (bridge as any).upsertInteractionEvent(eventInput('evt-1'), {
      tenantId: 't1',
      userId: 'u1',
      accountId: 'ks-1',
    });
    await (bridge as any).upsertInteractionEvent(eventInput('evt-2'), {
      tenantId: 't1',
      userId: 'u1',
      accountId: 'ks-1',
    });

    const upsertCalls = prisma.interactionEvent.upsert.mock.calls;
    // P1-18 复核：不同事件 ID → 不同 dedupeKey（真实事件维度优先）
    expect(upsertCalls[0][0].where.tenantId_dedupeKey.dedupeKey).not.toBe(
      upsertCalls[1][0].where.tenantId_dedupeKey.dedupeKey,
    );
  });
});

describe('GrowthLeadBridge 统一 Lead upsert 落库（全面审查 P0-3 复核）', () => {
  it('bridgeAndEnrich 时统一 Lead 不存在 → upsert 创建（convert 可找到）', async () => {
    const { bridge, prisma } = makeBridge();
    const lead = {
      id: 'lead-1',
      userId: 'u1',
      tenantId: 't1',
      platform: 'kuaishou',
      sourceType: 'auto-acquisition',
      nickname: '装修用户',
      sourceText: '这个价格怎么算？',
      externalUserId: 'ks-user-1',
      matchedKeywords: [],
      score: 80,
      scoreReasons: [],
      status: 'new',
      evidenceUrls: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;

    await (bridge as any).patchUnifiedLead(lead, {
      tenantId: 't1',
      userId: 'u1',
      accountId: 'ks-1',
    }, { sourceInteractionEventId: 'evt-1' } as any);

    // P0 复核：统一 Lead 用 upsert（dedupeKey 复合键）创建——原 update-only 在
    // 桥接早于 saveStore 时静默失败 → convert 抛 NotFound，自动转 CRM 失效
    expect(prisma.lead.upsert).toHaveBeenCalled();
    const call = prisma.lead.upsert.mock.calls[0][0];
    expect(call.where.tenantId_dedupeKey.tenantId).toBe('t1');
    expect(call.create.id).toBe('lead-1');
    expect(call.create.sourceInteractionEventId).toBe('evt-1');
  });
});
