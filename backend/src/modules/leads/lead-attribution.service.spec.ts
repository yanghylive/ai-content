import { LeadAttributionService } from './lead-attribution.service';

function makeService(overrides: {
  lead?: jest.Mock;
  article?: jest.Mock;
  publishRecord?: jest.Mock;
  interactionEvent?: jest.Mock;
  crmCustomer?: jest.Mock;
} = {}) {
  const prisma = {
    lead: {
      findFirst: overrides.lead ?? jest.fn(),
      findMany: jest.fn(),
    },
    article: { findFirst: overrides.article ?? jest.fn() },
    publishRecord: { findFirst: overrides.publishRecord ?? jest.fn() },
    interactionEvent: { findFirst: overrides.interactionEvent ?? jest.fn() },
    crmCustomer: { findFirst: overrides.crmCustomer ?? jest.fn() },
  };
  const service = new LeadAttributionService(prisma as never);
  return { service, prisma };
}

describe('LeadAttributionService', () => {
  it('attributionFromEvent 从互动事件构造归因字段', () => {
    const result = LeadAttributionService.attributionFromEvent({
      id: 'evt-1',
      sourceArticleId: 'article-1',
      publishRecordId: 'pub-1',
      sourceUrl: 'https://xhs/item/1',
    });
    expect(result).toEqual({
      sourceArticleId: 'article-1',
      sourcePublishRecordId: 'pub-1',
      sourceInteractionEventId: 'evt-1',
      sourceUrl: 'https://xhs/item/1',
    });
  });

  it('attributionFromEvent 缺归因字段时为 null', () => {
    const result = LeadAttributionService.attributionFromEvent({ id: 'evt-2' });
    expect(result.sourceArticleId).toBeNull();
    expect(result.sourcePublishRecordId).toBeNull();
    expect(result.sourceInteractionEventId).toBe('evt-2');
  });

  it('resolveLeadAttribution 串起内容/发布/互动事件/客户完整链', async () => {
    const { service, prisma } = makeService({
      lead: jest.fn().mockResolvedValue({
        id: 'lead-1',
        sourceArticleId: 'article-1',
        sourcePublishRecordId: 'pub-1',
        sourceInteractionEventId: 'evt-1',
        customerId: 'customer-1',
      }),
      article: jest.fn().mockResolvedValue({ id: 'article-1', title: '会员权益科普' }),
      publishRecord: jest
        .fn()
        .mockResolvedValue({ id: 'pub-1', platform: 'douyin', readbackState: 'verified' }),
      interactionEvent: jest
        .fn()
        .mockResolvedValue({ id: 'evt-1', body: '会员怎么收费' }),
      crmCustomer: jest.fn().mockResolvedValue({ id: 'customer-1', displayName: '李女士' }),
    });

    const result = await service.resolveLeadAttribution('lead-1', 'user-1');

    expect(result).toMatchObject({
      lead: { id: 'lead-1' },
      article: { id: 'article-1' },
      publishRecord: { readbackState: 'verified' },
      interactionEvent: { id: 'evt-1' },
      customer: { displayName: '李女士' },
    });
    expect(prisma.article.findFirst).toHaveBeenCalled();
    expect(prisma.crmCustomer.findFirst).toHaveBeenCalled();
  });

  it('resolveLeadAttribution 线索不存在返回 null', async () => {
    const { service } = makeService({
      lead: jest.fn().mockResolvedValue(null),
    });

    const result = await service.resolveLeadAttribution('missing', 'user-1');

    expect(result).toBeNull();
  });
});

describe('LeadAttributionService · A 档 resolveEventToLead', () => {
  function makeSvc(overrides: { lead?: jest.Mock; interactionEvent?: jest.Mock } = {}) {
    const prisma = {
      lead: { findFirst: overrides.lead ?? jest.fn().mockResolvedValue(null), findMany: jest.fn() },
      article: { findFirst: jest.fn() },
      publishRecord: { findFirst: jest.fn() },
      interactionEvent: { findFirst: overrides.interactionEvent ?? jest.fn().mockResolvedValue(null) },
      crmCustomer: { findFirst: jest.fn() },
    };
    const service = new LeadAttributionService(prisma as never);
    return { service, prisma };
  }

  it('externalEventId 命中事件 → 线索（matchedBy external_event_id）', async () => {
    const { service, prisma } = makeSvc({
      interactionEvent: jest.fn().mockResolvedValue({ id: 'ev-1' }),
      lead: jest
        .fn()
        .mockResolvedValueOnce(null) // byEvent 查不到时返回 null？——直接让 byEvent 命中
        .mockResolvedValueOnce({ id: 'lead-1' }),
    });
    // 修正 mock 顺序：event 先查到，lead.findFirst 只调一次（byEvent）
    prisma.lead.findFirst = jest.fn().mockResolvedValue({ id: 'lead-1' });
    const r = await service.resolveEventToLead({
      userId: 'u1', platform: 'douyin', externalEventId: 'ext-1',
    });
    expect(r).toEqual({ leadId: 'lead-1', matchedBy: 'external_event_id' });
  });

  it('sourceUrl + commentRef 命中线索（matchedBy comment_ref）', async () => {
    const { service, prisma } = makeSvc({
      lead: jest.fn().mockResolvedValue({ id: 'lead-9' }),
    });
    const r = await service.resolveEventToLead({
      userId: 'u1', platform: 'xiaohongshu',
      sourceUrl: 'https://xhs/item/1', commentRef: '5f3a',
    });
    expect(r).toEqual({ leadId: 'lead-9', matchedBy: 'comment_ref' });
  });

  it('无任何匹配 → null', async () => {
    const { service } = makeSvc();
    const r = await service.resolveEventToLead({
      userId: 'u1', platform: 'douyin',
    });
    expect(r).toBeNull();
  });
});
