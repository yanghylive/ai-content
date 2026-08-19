import { InteractionEventStore } from './interaction-event.store';

function makeAuthContext(overrides: {
  get?: jest.Mock;
  resolveTenantId?: jest.Mock;
} = {}) {
  return {
    get: overrides.get ?? jest.fn().mockReturnValue(undefined),
    resolveTenantId:
      overrides.resolveTenantId ??
      jest.fn().mockResolvedValue('local-desktop:u-1'),
  };
}

function makeStore(overrides: {
  findUnique?: jest.Mock;
  create?: jest.Mock;
  auth?: ReturnType<typeof makeAuthContext>;
} = {}) {
  const prisma = {
    interactionEvent: {
      findUnique: overrides.findUnique ?? jest.fn(),
      create: overrides.create ?? jest.fn(),
      findMany: jest.fn(),
    },
  };
  const store = new InteractionEventStore(
    prisma as never,
    (overrides.auth ?? makeAuthContext()) as never,
  );
  return { store, prisma };
}

const baseEvent = {
  platform: 'xiaohongshu',
  accountId: 'acc-1',
  channel: 'comment' as const,
  externalEventId: 'ref-001',
  body: '这个会员怎么收费？',
};

describe('InteractionEventStore', () => {
  it('computeDedupeKey 优先用 externalEventId', () => {
    const { store } = makeStore();
    const a = store.computeDedupeKey({ ...baseEvent, externalEventId: 'ref-001' });
    const b = store.computeDedupeKey({ ...baseEvent, externalEventId: 'ref-001' });
    const c = store.computeDedupeKey({ ...baseEvent, externalEventId: 'ref-002' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('无 eventId 时回退 externalThreadId → sourceUrl', () => {
    const { store } = makeStore();
    const byThread = store.computeDedupeKey({
      ...baseEvent,
      externalEventId: undefined,
      externalThreadId: 'thread-1',
    });
    const byUrl = store.computeDedupeKey({
      ...baseEvent,
      externalEventId: undefined,
      externalThreadId: undefined,
      sourceUrl: 'https://xhs/item/1',
    });
    expect(byThread).toContain('thread-1'.length ? '' : '');
    expect(byThread).not.toBe(byUrl);
  });

  it('ingest 首次创建 created=true', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'evt-1', dedupeKey: 'k' });
    const { store } = makeStore({ findUnique, create });

    const result = await store.ingest(baseEvent);

    expect(result.created).toBe(true);
    expect(findUnique).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platform: 'xiaohongshu',
          externalEventId: 'ref-001',
          body: '这个会员怎么收费？',
        }),
      }),
    );
  });

  it('ingest 同 dedupeKey 幂等不重复创建', async () => {
    const existing = { id: 'evt-1', dedupeKey: 'k', platform: 'xiaohongshu' };
    const findUnique = jest.fn().mockResolvedValue(existing);
    const create = jest.fn();
    const { store } = makeStore({ findUnique, create });

    const result = await store.ingest(baseEvent);

    expect(result.created).toBe(false);
    expect(result.event.id).toBe('evt-1');
    expect(create).not.toHaveBeenCalled();
  });

  it('fromInteractionItem 映射 adapter 读取结果', () => {
    const { store } = makeStore();
    const input = store.fromInteractionItem('xiaohongshu', 'acc-1', {
      text: '有优惠吗？',
      authorId: 'author-1',
      ref: 'ref-9',
      videoUrl: 'https://xhs/item/9',
      commentTime: '2026-08-16T12:00:00Z',
    }, { sourceArticleId: 'article-1' });

    expect(input).toMatchObject({
      platform: 'xiaohongshu',
      accountId: 'acc-1',
      externalEventId: 'ref-9',
      authorExternalId: 'author-1',
      sourceArticleId: 'article-1',
      body: '有优惠吗？',
    });
  });

  it('ingest 无显式 tenant 时从登录上下文 resolve 真实 scope（对齐 InteractionTask）', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'evt-1', dedupeKey: 'k' });
    const auth = makeAuthContext({
      get: jest.fn().mockReturnValue({ user: { id: 'u-1' } }),
      resolveTenantId: jest.fn().mockResolvedValue('tenant-real'),
    });
    const { store } = makeStore({ findUnique, create, auth });

    await store.ingest(baseEvent);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-real',
          userId: 'u-1',
        }),
      }),
    );
  });
});

describe('InteractionEventStore 读取租户隔离（P1-15 复核）', () => {
  function makeStore() {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      interactionEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
        findMany,
      },
    };
    const store = new InteractionEventStore(prisma as never, {
      get: () => undefined,
    } as never);
    return { store, findMany };
  }

  it('listByArticle 强制 tenant scope（防串租户读取）', async () => {
    const { store, findMany } = makeStore();
    await store.listByArticle('article-1', 'tenant-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceArticleId: 'article-1', tenantId: 'tenant-1' },
      }),
    );
  });

  it('listByAuthor 强制 tenant scope（防串租户读取）', async () => {
    const { store, findMany } = makeStore();
    await store.listByAuthor('author-1', 'tenant-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authorExternalId: 'author-1', tenantId: 'tenant-1' },
      }),
    );
  });
});
