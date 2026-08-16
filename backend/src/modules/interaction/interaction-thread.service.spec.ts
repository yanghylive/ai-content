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
