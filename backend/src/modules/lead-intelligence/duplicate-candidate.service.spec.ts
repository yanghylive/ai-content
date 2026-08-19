import { DuplicateCandidateService, normalizeProfileUrl } from './duplicate-candidate.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    platformIdentity: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'target-1', ...data })),
      delete: jest.fn().mockResolvedValue({ id: 'source-1' }),
    },
    interactionEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    sourceContent: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    identityMergeAudit: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation(async (ops: unknown[]) => {
      // Prisma 传的是 promise 数组（PrismaPromise[]），直接当数组 resolve 即可
      await Promise.all(ops as Array<Promise<unknown>>);
      return [];
    }),
    ...overrides,
  } as never;
}

const base = { tenantId: 't1', platform: 'douyin', accountId: 'acc1' };

describe('normalizeProfileUrl', () => {
  it('去协议/去尾部斜杠/小写', () => {
    expect(normalizeProfileUrl('HTTPS://Example.com/User/')).toBe('example.com/user');
  });
});

describe('DuplicateCandidateService', () => {
  it('externalUserId 命中 → match（100）', async () => {
    const prisma = makePrisma({
      platformIdentity: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pid-1' }),
      },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.resolve({ ...base, externalUserId: 'ext-1' });
    expect(r).toMatchObject({ kind: 'match', matchedIdentityId: 'pid-1', confidence: 100 });
  });

  it('externalEventId 关联身份 → match（100）', async () => {
    const prisma = makePrisma({
      interactionEvent: { findFirst: jest.fn().mockResolvedValue({ identityId: 'pid-2' }) },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.resolve({ ...base, externalEventId: 'ev-1' });
    expect(r).toMatchObject({ kind: 'match', matchedIdentityId: 'pid-2' });
  });

  it('规范化 profileUrl 命中 → high_confidence（80）', async () => {
    const prisma = makePrisma({
      platformIdentity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pid-3', profileUrl: 'https://example.com/user' }]),
      },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.resolve({ ...base, profileUrl: 'HTTPS://EXAMPLE.com/User/' });
    expect(r).toMatchObject({ kind: 'high_confidence', matchedIdentityId: 'pid-3', confidence: 80 });
  });

  it('昵称相同 → candidate（40，不自动合并）', async () => {
    const prisma = makePrisma({
      platformIdentity: {
        findMany: jest.fn().mockResolvedValue([{ id: 'pid-4', nickname: '张三' }]),
      },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.resolve({ ...base, nickname: '张三' });
    expect(r.kind).toBe('candidate');
    if (r.kind === 'candidate') {
      expect(r.candidates[0]).toMatchObject({ identityId: 'pid-4', confidence: 40 });
    }
  });

  it('无任何特征 → none', async () => {
    const svc = new DuplicateCandidateService(makePrisma());
    const r = await svc.resolve({ ...base });
    expect(r.kind).toBe('none');
  });

  it('merge：迁移事件/内容 + 合并字段 + 删除 source（可撤销审计 id）', async () => {
    const prisma = makePrisma({
      platformIdentity: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'target-1', tenantId: 't1', userId: 'u1', nickname: 'A', profileUrl: null, avatarHash: null, verified: false, identityConfidence: 50, firstSeenAt: new Date('2026-01-01'), lastSeenAt: new Date('2026-01-02') })
          .mockResolvedValueOnce({ id: 'source-1', tenantId: 't1', userId: 'u1', nickname: 'B', profileUrl: 'https://x', avatarHash: 'h', verified: true, identityConfidence: 90, firstSeenAt: new Date('2025-12-01'), lastSeenAt: new Date('2026-02-01') }),
        update: jest.fn().mockResolvedValue({ id: 'target-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'source-1' }),
      },
      interactionEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'ev-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      sourceContent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sc-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      identityMergeAudit: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.merge({ tenantId: 't1', targetId: 'target-1', sourceId: 'source-1' });
    expect(r.merged).toBe(true);
    // 审计 id 来自 IdentityMergeAudit 记录（可撤销）
    expect(r.auditId).toBe('audit-1');
    // 冲突字段默认保留 target 缺失补 source
    expect(prisma.platformIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nickname: 'A', profileUrl: 'https://x' }),
      }),
    );
    // 事件/内容已迁移
    expect(prisma.interactionEvent.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.sourceContent.updateMany).toHaveBeenCalledTimes(1);
    // source 已删除
    expect(prisma.platformIdentity.delete).toHaveBeenCalledWith({ where: { id: 'source-1' } });
    // 审计快照已落库（含 source 完整字段 + 迁移清单）
    expect(prisma.identityMergeAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: 'source-1',
          targetId: 'target-1',
          migratedEventIds: ['ev-1'],
          migratedContentIds: ['sc-1'],
        }),
      }),
    );
  });

  it('revert：从审计快照恢复 source 身份并迁回事件/内容', async () => {
    const prisma = makePrisma({
      identityMergeAudit: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'audit-1',
          tenantId: 't1',
          userId: 'u1',
          targetId: 'target-1',
          sourceId: 'source-1',
          sourceSnapshot: {
            platform: 'douyin',
            accountId: 'acc1',
            externalUserId: 'ext-1',
            normalizedHandle: null,
            nickname: 'B',
            profileUrl: 'https://x',
            avatarHash: 'h',
            verified: true,
            identityConfidence: 90,
            firstSeenAt: '2025-12-01T00:00:00.000Z',
            lastSeenAt: '2026-02-01T00:00:00.000Z',
          },
          migratedEventIds: ['ev-1'],
          migratedContentIds: ['sc-1'],
          reverted: false,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      platformIdentity: {
        create: jest.fn().mockResolvedValue({ id: 'source-1' }),
      },
    });
    const svc = new DuplicateCandidateService(prisma);
    const r = await svc.revert({ tenantId: 't1', auditId: 'audit-1' });
    expect(r.reverted).toBe(true);
    expect(r.sourceId).toBe('source-1');
    expect(prisma.platformIdentity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'source-1', externalUserId: 'ext-1' }),
      }),
    );
    expect(prisma.interactionEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['ev-1'] } }),
      }),
    );
  });

  it('merge：禁止合并到自身', async () => {
    const svc = new DuplicateCandidateService(makePrisma());
    await expect(svc.merge({ tenantId: 't1', targetId: 'x', sourceId: 'x' })).rejects.toThrow('不能合并到自身');
  });
});
