import { InteractionInboxService } from './interaction-inbox.service';

function makeAuthContext() {
  return {
    get: jest.fn().mockReturnValue({ user: { id: 'u-1' } }),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
}

function makePrisma(overrides: {
  events?: unknown[];
  tasks?: unknown[];
  leads?: unknown[];
  articles?: unknown[];
} = {}) {
  return {
    interactionEvent: {
      findMany: jest.fn().mockResolvedValue(overrides.events ?? []),
    },
    interactionTask: {
      findMany: jest.fn().mockResolvedValue(overrides.tasks ?? []),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue(overrides.leads ?? []),
    },
    article: {
      findMany: jest.fn().mockResolvedValue(overrides.articles ?? []),
    },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const auth = makeAuthContext();
  const service = new InteractionInboxService(prisma as never, auth as never);
  return { service, prisma, auth };
}

const EVENT = (partial: Record<string, unknown>) => ({
  id: partial.id ?? 'e1',
  platform: 'douyin',
  channel: 'dm',
  accountId: 'acc-1',
  externalThreadId: 'thread-1',
  authorExternalId: 'author-1',
  sourceArticleId: 'article-1',
  publishRecordId: null,
  sourceUrl: null,
  body: '你好，请问怎么收费？',
  occurredAt: new Date('2026-08-16T12:00:00Z'),
  ...partial,
});

describe('InteractionInboxService', () => {
  it('聚合事件线程 + 合并任务状态/SLA/线索/内容标题', async () => {
    const task = {
      id: 't1',
      status: 'WAITING_FOR_SEND_CONFIRMATION',
      riskLevel: 'high',
      claimedBy: 'u-1',
      slaDueAt: new Date('2026-08-16T13:00:00Z'),
      handoffState: 'normal',
      handoffReason: null,
      draftText: '已为您登记，稍后回复',
      sourceArticleId: 'article-1',
      publishRecordId: null,
      sourceUrl: null,
      sessionId: null,
      updatedAt: new Date('2026-08-16T12:00:00Z'),
    };
    const lead = {
      id: 'lead-1',
      status: 'qualified',
      nickname: '张三',
      customerId: 'cust-1',
      sourceInteractionEventId: null,
      sourceArticleId: 'article-1',
      sourcePublishRecordId: null,
      sourceUrl: null,
      externalUserId: 'author-1',
    };
    const { service, prisma } = makeService(
      makePrisma({
        events: [EVENT({})],
        tasks: [task],
        leads: [lead],
        articles: [{ id: 'article-1', title: '我的爆款内容' }],
      }),
    );

    const result = await service.listInbox({ view: 'all' });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item).toMatchObject({
      threadKey: 'thread-1',
      platform: 'douyin',
      status: 'WAITING_FOR_SEND_CONFIRMATION',
      priority: 'high',
      assigneeId: 'u-1',
      sourceArticleTitle: '我的爆款内容',
      draftText: '已为您登记，稍后回复',
      leadId: 'lead-1',
      leadStatus: 'qualified',
      customerId: 'cust-1',
      authorName: '张三',
    });
    expect(item.unreadCount).toBe(0); // 任务 updatedAt >= 事件时间，无未读
  });

  it('查询都带 tenant+user scope', async () => {
    const { service, prisma } = makeService(makePrisma({ events: [EVENT({})] }));
    await service.listInbox({});

    expect(prisma.interactionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', userId: 'u-1' },
      }),
    );
    expect(prisma.interactionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-1', userId: 'u-1' },
      }),
    );
  });

  it('无任务时全部事件计为未读，status=new', async () => {
    const { service } = makeService(
      makePrisma({ events: [EVENT({}), EVENT({ id: 'e2' })] }),
    );
    const result = await service.listInbox({});

    expect(result.items[0].unreadCount).toBe(2);
    expect(result.items[0].status).toBe('new');
  });

  it('SLA 已过且非终态 → slaOverdue=true', async () => {
    const task = {
      id: 't1',
      status: 'QUEUED',
      riskLevel: 'medium',
      claimedBy: null,
      slaDueAt: new Date('2020-01-01T00:00:00Z'),
      handoffState: 'normal',
      handoffReason: null,
      draftText: null,
      sourceArticleId: 'article-1',
      publishRecordId: null,
      sourceUrl: null,
      sessionId: null,
      updatedAt: new Date('2020-01-01T00:00:00Z'),
    };
    const { service } = makeService(
      makePrisma({ events: [EVENT({})], tasks: [task] }),
    );
    const result = await service.listInbox({ view: 'overdue' });

    expect(result.items[0].slaOverdue).toBe(true);
    expect(result.views.overdue).toBe(1);
  });

  it('转人工 → priority=high + needs_human 视图命中 + allowedActions 含 handoff-resolve', async () => {
    const task = {
      id: 't1',
      status: 'BLOCKED',
      riskLevel: 'low',
      claimedBy: null,
      slaDueAt: null,
      handoffState: 'needs_human',
      handoffReason: '需要人工确认价格',
      draftText: null,
      sourceArticleId: 'article-1',
      publishRecordId: null,
      sourceUrl: null,
      sessionId: null,
      updatedAt: new Date('2026-08-16T11:00:00Z'),
    };
    const { service } = makeService(
      makePrisma({ events: [EVENT({})], tasks: [task] }),
    );
    const result = await service.listInbox({ view: 'needs_human' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].priority).toBe('high');
    expect(result.items[0].handoffReason).toBe('需要人工确认价格');
    expect(result.items[0].allowedActions).toContain('handoff-resolve');
  });

  it('视图计数正确（unassigned/replied/pending 区分）', async () => {
    const tasks = [
      {
        id: 't1',
        status: 'COMPLETED',
        riskLevel: 'medium',
        claimedBy: 'u-1',
        slaDueAt: null,
        handoffState: 'normal',
        handoffReason: null,
        draftText: null,
        sourceArticleId: 'article-1',
        publishRecordId: null,
        sourceUrl: null,
        sessionId: null,
        updatedAt: new Date('2026-08-16T12:00:00Z'),
      },
      {
        id: 't2',
        status: 'QUEUED',
        riskLevel: 'medium',
        claimedBy: null,
        slaDueAt: null,
        handoffState: 'normal',
        handoffReason: null,
        draftText: null,
        sourceArticleId: 'article-2',
        publishRecordId: null,
        sourceUrl: null,
        sessionId: null,
        updatedAt: new Date('2026-08-16T12:00:00Z'),
      },
    ];
    const events = [
      EVENT({}),
      EVENT({
        id: 'e2',
        externalThreadId: 'thread-2',
        sourceArticleId: 'article-2',
      }),
    ];
    const { service } = makeService(makePrisma({ events, tasks }));
    const result = await service.listInbox({ view: 'all' });

    expect(result.views.all).toBe(2);
    expect(result.views.replied).toBe(1);
    expect(result.views.unassigned).toBe(1);
    expect(result.views.pending).toBe(1);
  });

  it('getThreadDetail 返回历史事件按时间升序', async () => {
    const events = [
      EVENT({ occurredAt: new Date('2026-08-16T12:02:00Z'), body: '第二条' }),
      EVENT({ id: 'e0', occurredAt: new Date('2026-08-16T12:00:00Z'), body: '第一条' }),
    ];
    const { service } = makeService(makePrisma({ events }));
    const detail = await service.getThreadDetail('thread-1');

    expect(detail.thread.threadKey).toBe('thread-1');
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0].body).toBe('第一条');
    expect(detail.history[1].body).toBe('第二条');
  });
});
