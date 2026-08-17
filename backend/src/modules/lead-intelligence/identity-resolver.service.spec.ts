import { IdentityResolverService } from './identity-resolver.service';

function makePrisma(overrides: { findFirst?: jest.Mock; upsert?: jest.Mock; create?: jest.Mock; update?: jest.Mock } = {}) {
  return {
    platformIdentity: {
      findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
      upsert: overrides.upsert ?? jest.fn().mockImplementation(async ({ create }) => ({ id: 'pid-1', ...create })),
      create: overrides.create ?? jest.fn().mockImplementation(async ({ data }) => ({ id: 'pid-1', ...data })),
      update: overrides.update ?? jest.fn().mockResolvedValue({ id: 'pid-1' }),
    },
  };
}

const base = {
  tenantId: 't1',
  userId: 'u1',
  platform: 'douyin',
  accountId: 'acc1',
};

describe('IdentityResolverService', () => {
  it('有 externalUserId → identified（verified，confidence 100）', async () => {
    const svc = new IdentityResolverService(makePrisma() as never);
    const r = await svc.resolve({ ...base, externalUserId: 'ext-1' });
    expect(r).toMatchObject({ kind: 'identified', confidence: 100 });
  });

  it('无 externalUserId 但有 profileUrl → high_confidence（70）', async () => {
    const svc = new IdentityResolverService(makePrisma() as never);
    const r = await svc.resolve({ ...base, profileUrl: 'https://x/1' });
    expect(r).toMatchObject({ kind: 'high_confidence', confidence: 70 });
  });

  it('只有昵称/头像 → low_confidence（30，不自动合并）', async () => {
    const svc = new IdentityResolverService(makePrisma() as never);
    const r = await svc.resolve({ ...base, nickname: '张三' });
    expect(r).toMatchObject({ kind: 'low_confidence', confidence: 30 });
  });

  it('全缺 → unrecognized（进人工）', async () => {
    const svc = new IdentityResolverService(makePrisma() as never);
    const r = await svc.resolve({ ...base });
    expect(r.kind).toBe('unrecognized');
  });
});
