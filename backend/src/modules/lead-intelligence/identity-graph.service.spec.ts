import { IdentityGraphService } from './identity-graph.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    interactionEvent: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformIdentity: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as never;
}

const pid = (over: Record<string, unknown> = {}) => ({
  id: 'pid-1',
  platform: 'douyin',
  accountId: 'acc-1',
  externalUserId: 'ext-1',
  nickname: '张三',
  profileUrl: null,
  verified: false,
  identityConfidence: 100,
  firstSeenAt: new Date(Date.now() - 1000 * 3600),
  lastSeenAt: new Date(),
  ...over,
});

describe('IdentityGraphService', () => {
  it('空数据 → 全部 0，top 空', async () => {
    const prisma = makePrisma();
    const svc = new IdentityGraphService(prisma);
    const r = await svc.retention({ tenantId: 't1', userId: 'u1' });
    expect(r.totalIdentities).toBe(0);
    expect(r.repeatRate).toBe(0);
    expect(r.topIdentities).toHaveLength(0);
  });

  it('互动≥2 的身份计入留存；有线索的身份计入转化', async () => {
    const prisma = makePrisma({
      interactionEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { identityId: 'pid-1', _count: { _all: 3 } },
          { identityId: 'pid-2', _count: { _all: 1 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          { id: 'ev-1', identityId: 'pid-1' },
          { id: 'ev-2', identityId: 'pid-1' },
        ]),
      },
      lead: {
        findMany: jest.fn().mockResolvedValue([
          { sourceInteractionEventId: 'ev-1' },
        ]),
      },
      platformIdentity: {
        findMany: jest.fn().mockResolvedValue([
          pid({ id: 'pid-1' }),
          pid({ id: 'pid-2', nickname: '李四' }),
        ]),
      },
    });
    const svc = new IdentityGraphService(prisma);
    const r = await svc.retention({ tenantId: 't1', userId: 'u1' });
    expect(r.totalIdentities).toBe(2);
    expect(r.repeatIdentities).toBe(1); // pid-1 互动 3 次
    expect(r.repeatRate).toBe(0.5);
    expect(r.identitiesWithLeads).toBe(1); // pid-1 有线索
    expect(r.topIdentities[0]).toMatchObject({ identityId: 'pid-1', interactionCount: 3, leadCount: 1 });
  });

  it('markRepeatInteractions：互动≥2 的身份计数', async () => {
    const prisma = makePrisma({
      interactionEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { identityId: 'pid-1', _count: { _all: 5 } },
          { identityId: 'pid-2', _count: { _all: 1 } },
        ]),
      },
    });
    const svc = new IdentityGraphService(prisma);
    const r = await svc.markRepeatInteractions({ tenantId: 't1', userId: 'u1' });
    expect(r.marked).toBe(1);
  });
});
