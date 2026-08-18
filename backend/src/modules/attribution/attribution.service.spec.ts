import { AttributionService } from './attribution.service';
import { AttributionEventStore } from './attribution-event.store';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    attributionLink: {
      upsert: jest.fn().mockResolvedValue({ id: 'link-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    publishRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    interactionEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    crmOpportunity: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    crmCustomer: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as never;
}

describe('AttributionEventStore', () => {
  it('saveLink 幂等：同四元组 upsert 不重复', async () => {
    const prisma = makePrisma();
    const store = new AttributionEventStore(prisma);
    await store.saveLink({
      tenantId: 't1', userId: 'u1',
      fromType: 'content', fromId: 'c1',
      toType: 'publish', toId: 'p1',
    });
    expect(prisma.attributionLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_fromType_fromId_toType_toId_model: expect.objectContaining({
            fromType: 'content', fromId: 'c1', toType: 'publish', toId: 'p1',
          }),
        }),
      }),
    );
  });

  it('saveInteractionChain：有 publishRecordId → deterministic 主键直连', async () => {
    const prisma = makePrisma();
    const store = new AttributionEventStore(prisma);
    await store.saveInteractionChain({
      tenantId: 't1', userId: 'u1',
      interactionEventId: 'ev-1',
      publishRecordId: 'pub-1',
      platformExternalPostId: 'post-9',
    });
    expect(prisma.attributionLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          fromType: 'interaction', toType: 'publish', toId: 'pub-1', model: 'deterministic',
        }),
      }),
    );
  });

  it('saveInteractionChain：仅 URL → rule_based 弱关联（不伪造精确归因）', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pub-2' }),
      },
    });
    const store = new AttributionEventStore(prisma);
    await store.saveInteractionChain({
      tenantId: 't1', userId: 'u1',
      interactionEventId: 'ev-2',
      sourceUrl: 'https://x/post/1',
    });
    const call = prisma.attributionLink.upsert.mock.calls
      .map((c: unknown[]) => c[0])
      .find((c: { create?: { model?: string } }) => c?.create?.model === 'rule_based');
    expect(call).toBeTruthy();
    expect(call.create.confidence).toBe('medium');
  });

  it('saveLeadResultChain：线索→客户→商机补链', async () => {
    const prisma = makePrisma();
    const store = new AttributionEventStore(prisma);
    await store.saveLeadResultChain({
      tenantId: 't1', userId: 'u1',
      leadId: 'l1', customerId: 'cust-1', opportunityId: 'opp-1',
    });
    expect(prisma.attributionLink.upsert).toHaveBeenCalledTimes(2);
  });
});

describe('AttributionService', () => {
  it('线索有完整主键链 → confirmed（interaction→lead→customer）', async () => {
    const prisma = makePrisma({
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', sourceInteractionEventId: 'ev-1', customerId: 'cust-1',
        }),
      },
    });
    const svc = new AttributionService(prisma);
    const r = await svc.resolveUpstream({ tenantId: 't1', userId: 'u1', type: 'lead', id: 'l1' });
    expect(r.layer).toBe('confirmed');
    expect(r.hops.length).toBeGreaterThanOrEqual(1);
  });

  it('线索无任何来源 → unknown（不伪造）', async () => {
    const prisma = makePrisma({
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', sourceInteractionEventId: null, sourcePublishRecordId: null,
          sourceArticleId: null, customerId: null,
        }),
      },
    });
    const svc = new AttributionService(prisma);
    const r = await svc.resolveUpstream({ tenantId: 't1', userId: 'u1', type: 'lead', id: 'l1' });
    expect(r.layer).toBe('unknown');
    expect(r.hops).toHaveLength(0);
  });

  it('无主键但有 AttributionLink rule_based → rule_matched', async () => {
    const prisma = makePrisma({
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', sourceInteractionEventId: null, sourcePublishRecordId: null,
          sourceArticleId: null, customerId: null,
        }),
      },
      attributionLink: {
        findMany: jest.fn().mockResolvedValue([
          { fromType: 'interaction', fromId: 'ev-9', toType: 'lead', toId: 'l1', model: 'rule_based', confidence: 'medium', label: 'influenced_by', evidence: {} },
        ]),
      },
    });
    const svc = new AttributionService(prisma);
    const r = await svc.resolveUpstream({ tenantId: 't1', userId: 'u1', type: 'lead', id: 'l1' });
    expect(r.layer).toBe('rule_matched');
    expect(r.hops).toHaveLength(1);
  });

  it('funnelFromContent：内容→发布→互动→线索→商机 全链（断链标 unknown）', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pub-1', status: 'success', readbackState: 'verified' }]),
      },
      interactionEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'ev-1' }]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([{ id: 'l1', customerId: 'cust-1' }]),
      },
      crmOpportunity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'opp-1', stage: 'won', amountCents: 500000 }]),
      },
    });
    const svc = new AttributionService(prisma);
    const r = await svc.funnelFromContent({ tenantId: 't1', userId: 'u1', contentId: 'c1' });
    expect(r.stages.map((s) => s.layer)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed']);
    expect(r.opportunities[0].stage).toBe('won');
  });

  it('funnelFromContent：互动断链 → 后续 unknown', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pub-1', status: 'success', readbackState: 'pending' }]),
      },
    });
    const svc = new AttributionService(prisma);
    const r = await svc.funnelFromContent({ tenantId: 't1', userId: 'u1', contentId: 'c1' });
    expect(r.stages[2].layer).toBe('unknown');
    expect(r.stages[3].layer).toBe('unknown');
    expect(r.opportunities).toHaveLength(0);
  });
});
