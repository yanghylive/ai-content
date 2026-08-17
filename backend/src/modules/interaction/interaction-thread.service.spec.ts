import { InteractionThreadService } from './interaction-thread.service';

function makeAuthContext() {
  return {
    get: jest.fn().mockReturnValue({ user: { id: 'u-1' } }),
    resolveTenantId: jest.fn().mockResolvedValue('tenant-1'),
  };
}

function makeService(overrides: {
  findMany?: jest.Mock;
} = {}) {
  const prisma = {
    interactionTask: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
    },
    interactionEvent: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new InteractionThreadService(
    prisma as never,
    makeAuthContext() as never,
  );
  return { service, prisma };
}

describe('InteractionThreadService', () => {
  it('listByView=unassigned 查未认领且非终态（带 scope）', async () => {
    const { service, prisma } = makeService();
    await service.listByView('unassigned');

    expect(prisma.interactionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          claimedBy: null,
          status: { notIn: ['COMPLETED', 'SKIPPED', 'NO_TARGET'] },
          tenantId: 'tenant-1',
          userId: 'u-1',
        },
      }),
    );
  });

  it('listByView=overdue 查 SLA 已过且非终态（带 scope）', async () => {
    const { service, prisma } = makeService();
    await service.listByView('overdue');

    expect(prisma.interactionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slaDueAt: { lt: expect.any(Date) },
          status: { notIn: ['COMPLETED', 'SKIPPED', 'NO_TARGET'] },
          tenantId: 'tenant-1',
          userId: 'u-1',
        }),
      }),
    );
  });

  it('listByView=replied 查已完成（带 scope）', async () => {
    const { service, prisma } = makeService();
    await service.listByView('replied');

    expect(prisma.interactionTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'COMPLETED', tenantId: 'tenant-1', userId: 'u-1' },
      }),
    );
  });

  it('listEventThreads 按 externalThreadId 聚合', async () => {
    const events = [
      {
        platform: 'douyin',
        channel: 'dm',
        externalThreadId: 'thread-1',
        authorExternalId: 'author-1',
        sourceArticleId: 'article-1',
        publishRecordId: null,
        body: '第二条',
        sourceUrl: null,
        occurredAt: new Date('2026-08-16T12:02:00Z'),
      },
      {
        platform: 'douyin',
        channel: 'dm',
        externalThreadId: 'thread-1',
        authorExternalId: 'author-1',
        sourceArticleId: 'article-1',
        publishRecordId: null,
        body: '第一条',
        sourceUrl: null,
        occurredAt: new Date('2026-08-16T12:00:00Z'),
      },
    ];
    const prisma = {
      interactionTask: { findMany: jest.fn().mockResolvedValue([]) },
      interactionEvent: { findMany: jest.fn().mockResolvedValue(events) },
    };
    const svc = new InteractionThreadService(
      prisma as never,
      makeAuthContext() as never,
    );

    const threads = await svc.listEventThreads({});

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      key: 'thread-1',
      eventCount: 2,
      latestBody: '第二条',
    });
    // scope 必须注入事件查询
    expect(prisma.interactionEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'u-1',
        }),
      }),
    );
  });

  it('listEventThreads 无 externalThreadId 按 作者+来源 聚合', async () => {
    const events = [
      {
        platform: 'xhs',
        channel: 'comment',
        externalThreadId: null,
        authorExternalId: 'author-1',
        sourceArticleId: 'article-1',
        publishRecordId: null,
        body: '有优惠吗',
        sourceUrl: 'https://xhs/item/1',
        occurredAt: new Date('2026-08-16T11:00:00Z'),
      },
      {
        platform: 'xhs',
        channel: 'comment',
        externalThreadId: null,
        authorExternalId: 'author-2',
        sourceArticleId: 'article-1',
        publishRecordId: null,
        body: '路过',
        sourceUrl: 'https://xhs/item/1',
        occurredAt: new Date('2026-08-16T11:05:00Z'),
      },
    ];
    const prisma = {
      interactionTask: { findMany: jest.fn().mockResolvedValue([]) },
      interactionEvent: { findMany: jest.fn().mockResolvedValue(events) },
    };
    const svc = new InteractionThreadService(
      prisma as never,
      makeAuthContext() as never,
    );

    const threads = await svc.listEventThreads({});

    expect(threads).toHaveLength(2);
  });
});

describe('InteractionThreadService · T5.8 threadDetail', () => {
  it('线程详情：parentEventId 排序（父在前子在后）+ 回复串组装', async () => {
    const events = [
      {
        id: 'ev-1', platform: 'douyin', channel: 'comment',
        externalThreadId: 'thread-1', authorExternalId: 'author-1',
        identityId: 'pid-1', body: '主评论', occurredAt: new Date('2026-08-16T10:00:00Z'),
        sourceUrl: 'https://dy/v/1', evidenceUrl: 'https://dy/v/1#ev-1',
        externalEventId: 'ext-1', parentEventId: null, userId: 'u-1', tenantId: 'tenant-1',
      },
      {
        id: 'ev-2', platform: 'douyin', channel: 'comment',
        externalThreadId: 'thread-1', authorExternalId: 'author-2',
        identityId: null, body: '回复1', occurredAt: new Date('2026-08-16T10:01:00Z'),
        sourceUrl: 'https://dy/v/1', evidenceUrl: 'https://dy/v/1#ev-2',
        externalEventId: 'ext-2', parentEventId: 'ev-1', userId: 'u-1', tenantId: 'tenant-1',
      },
      {
        id: 'ev-3', platform: 'douyin', channel: 'comment',
        externalThreadId: 'thread-1', authorExternalId: 'author-1',
        identityId: 'pid-1', body: '追回复', occurredAt: new Date('2026-08-16T10:02:00Z'),
        sourceUrl: 'https://dy/v/1', evidenceUrl: 'https://dy/v/1#ev-3',
        externalEventId: 'ext-3', parentEventId: 'ev-1', userId: 'u-1', tenantId: 'tenant-1',
      },
      {
        id: 'ev-9', platform: 'douyin', channel: 'comment',
        externalThreadId: 'thread-9', authorExternalId: 'author-9',
        identityId: null, body: '别的线程', occurredAt: new Date('2026-08-16T10:03:00Z'),
        sourceUrl: 'https://dy/v/9', evidenceUrl: null,
        externalEventId: 'ext-9', parentEventId: null, userId: 'u-1', tenantId: 'tenant-1',
      },
    ];
    const prisma = {
      interactionTask: { findMany: jest.fn().mockResolvedValue([]) },
      interactionEvent: { findMany: jest.fn().mockResolvedValue(events) },
    };
    const svc = new InteractionThreadService(prisma as never, makeAuthContext() as never);

    const detail = await svc.threadDetail({ key: 'thread-1' });

    expect(detail.total).toBe(3);
    expect(detail.events[0].id).toBe('ev-1'); // 父在前
    // ev-2 / ev-3 都是 ev-1 的子（按时间）
    expect(detail.events.map((e) => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3']);
    expect(detail.events[0].identityId).toBe('pid-1');
    expect(detail.events[1].parentEventId).toBe('ev-1');
  });

  it('线程详情：无 externalThreadId 时按 渠道+URL+作者 键归组', async () => {
    const events = [
      {
        id: 'ev-1', platform: 'xhs', channel: 'comment',
        externalThreadId: null, authorExternalId: 'author-1',
        identityId: null, body: '第一条', occurredAt: new Date('2026-08-16T10:00:00Z'),
        sourceUrl: 'https://xhs/item/1', evidenceUrl: null,
        externalEventId: 'ext-1', parentEventId: null, userId: 'u-1', tenantId: 'tenant-1',
      },
      {
        id: 'ev-2', platform: 'xhs', channel: 'comment',
        externalThreadId: null, authorExternalId: 'author-1',
        identityId: null, body: '第二条', occurredAt: new Date('2026-08-16T10:01:00Z'),
        sourceUrl: 'https://xhs/item/1', evidenceUrl: null,
        externalEventId: 'ext-2', parentEventId: 'ev-1', userId: 'u-1', tenantId: 'tenant-1',
      },
    ];
    const prisma = {
      interactionTask: { findMany: jest.fn().mockResolvedValue([]) },
      interactionEvent: { findMany: jest.fn().mockResolvedValue(events) },
    };
    const svc = new InteractionThreadService(prisma as never, makeAuthContext() as never);

    const key = 'comment:https://xhs/item/1:author-1';
    const detail = await svc.threadDetail({ key });
    expect(detail.total).toBe(2);
    expect(detail.events[0].id).toBe('ev-1');
  });
});
