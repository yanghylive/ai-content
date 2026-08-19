import { RpaExecutionStore } from './rpa-execution-store.service';

function createStore() {
  // 事务客户端 mock：createWithLock / finalize / appendStep 都走 $transaction
  const tx = {
    rpaExecution: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
      update: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rpaExecutionStep: {
      create: jest.fn().mockResolvedValue({ id: 'step-1' }),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'step-1', sequenceNo: 1 }),
    },
    rpaEvidence: {
      upsert: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    },
  };
  const prisma = {
    rpaExecution: {
      create: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
      update: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({
        id: 'rpa-1',
        userId: 'u1',
        version: 1,
      }),
    },
    // P0 审计强一致：独立步骤/证据表（现在全部在事务内写入）
    rpaExecutionStep: {
      create: jest.fn().mockResolvedValue({ id: 'step-1' }),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'step-1', sequenceNo: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    rpaEvidence: {
      upsert: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    },
    // P1 事务化：所有写入走同一个 tx mock
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };
  const store = new RpaExecutionStore(prisma as any);
  return { store, prisma, tx };
}

const OWNER = { userId: 'u1', tenantId: 't1' };

describe('RpaExecutionStore 租户隔离（复核 IDOR 修复）', () => {
  it('finalize 带 owner scope 查询（防跨用户更新）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'read-comments', status: 'success' }],
      evidence: [
        {
          type: 'rpa-items',
          externalContentIds: ['c1'],
          sourceUrls: ['https://example.com/v/1'],
        },
      ],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    expect(tx.rpaExecution.update).toHaveBeenCalledWith({
      where: { id: 'rpa-1', userId: 'u1', tenantId: 't1' },
      data: expect.objectContaining({ status: 'success' }),
    });
  });

  it('list 按 userId + tenantId 过滤', async () => {
    const { store, prisma } = createStore();
    await store.list(OWNER, 20);
    expect(prisma.rpaExecution.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 't1' },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  });

  it('findOne 用 findFirst + owner scope（防读他人记录）', async () => {
    const { store, prisma } = createStore();
    await store.findOne('rpa-1', OWNER);
    expect(prisma.rpaExecution.findFirst).toHaveBeenCalledWith({
      where: { id: 'rpa-1', userId: 'u1', tenantId: 't1' },
    });
  });

  it('无 tenantId 时只按 userId 过滤（legacy 兼容）', async () => {
    const { store, prisma } = createStore();
    await store.list({ userId: 'u1', tenantId: null }, 20);
    expect(prisma.rpaExecution.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  });
});

describe('RpaExecutionStore 证据门禁（P0-1）', () => {
  it('appendStep 非 internal：客户端提交 success 被强制降为 running，evidenceUrl 不写入', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
    });
    await store.appendStep('rpa-1', OWNER, {
      stepName: 'discover-keyword',
      status: 'success',
      evidenceUrl: 'https://fake-evidence.example/x.png',
      pageFingerprint: 'fake-fp',
    });
    const call = tx.rpaExecution.updateMany.mock.calls.at(-1);
    const data = call[0].data;
    expect(data.steps[0].status).toBe('running');
    expect(data.steps[0].evidenceUrl).toBeUndefined();
    expect(data.steps[0].pageFingerprint).toBeUndefined();
  });

  it('appendStep internal：允许 success + evidenceUrl（服务端执行器写入）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
    });
    await store.appendStep(
      'rpa-1',
      OWNER,
      {
        stepName: 'read-comments',
        status: 'success',
        evidenceUrl: 'https://evidence.example/shot.png',
      },
      { internal: true },
    );
    const data = tx.rpaExecution.updateMany.mock.calls.at(-1)[0].data;
    expect(data.steps[0].status).toBe('success');
    expect(data.steps[0].evidenceUrl).toBe('https://evidence.example/shot.png');
  });

  it('finalize success 但只有 open-session 步骤 → reconcile_required/evidence_insufficient', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'open-session', status: 'success' }],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success' });
    const data = tx.rpaExecution.update.mock.calls.at(-1)[0].data;
    expect(data.status).toBe('reconcile_required');
    expect(data.reasonCode).toBe('evidence_insufficient');
  });

  it('finalize success 且有业务步骤成功（read-comments）→ 保持 success', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'read-comments', status: 'success' }],
      evidence: [
        {
          type: 'rpa-items',
          externalContentIds: ['c1'],
          sourceUrls: ['https://example.com/v/1'],
        },
      ],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    const data = tx.rpaExecution.update.mock.calls.at(-1)[0].data;
    expect(data.status).toBe('success');
    expect(data.reasonCode).toBe('ok');
  });

  it('finalize failed 不受业务步骤校验影响（失败如实记录）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
    });
    await store.finalize('rpa-1', OWNER, {
      status: 'failed',
      reasonCode: 'parse_failed',
    });
    const data = tx.rpaExecution.update.mock.calls.at(-1)[0].data;
    expect(data.status).toBe('failed');
    expect(data.reasonCode).toBe('parse_failed');
  });
});

describe('RpaExecutionStore 乐观锁（P1-5）', () => {
  it('appendStep 并发冲突（version 不匹配）→ 自动重读重试成功', async () => {
    const { store, prisma, tx } = createStore();
    // 第一次读 version=1，updateMany 冲突(count 0)；重读 version=2，成功
    prisma.rpaExecution.findFirst
      .mockResolvedValueOnce({ id: 'rpa-1', userId: 'u1', steps: [], version: 1 })
      .mockResolvedValueOnce({
        id: 'rpa-1',
        userId: 'u1',
        steps: [{ stepName: 'discover-keyword', status: 'success' }],
        version: 2,
      });
    tx.rpaExecution.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    await store.appendStep('rpa-1', OWNER, {
      stepName: 'read-comments',
      status: 'success',
    });
    // 第二次 updateMany 携带 version=2
    expect(tx.rpaExecution.updateMany.mock.calls[1][0].where.version).toBe(2);
    expect(tx.rpaExecution.updateMany.mock.calls[1][0].data.version).toBe(3);
  });

  it('appendStep 连续冲突超 3 次 → 抛错（不静默丢步骤）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
      version: 1,
    });
    tx.rpaExecution.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      store.appendStep('rpa-1', OWNER, {
        stepName: 'read-comments',
        status: 'success',
      }),
    ).rejects.toThrow('并发冲突');
  });
});

describe('RpaExecutionStore 写入事务化（复核 P1）', () => {
  it('appendStep：CAS 更新与步骤表写入在同一 $transaction 内', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
      version: 1,
    });
    await store.appendStep(
      'rpa-1',
      OWNER,
      {
        stepName: 'reply-comment',
        status: 'success',
      },
      { internal: true },
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.rpaExecution.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.rpaExecutionStep.create).toHaveBeenCalledTimes(1);
    expect(tx.rpaExecutionStep.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        executionId: 'rpa-1',
        stepName: 'reply-comment',
        status: 'success',
        sequenceNo: 1,
      }),
    );
  });

  it('appendStep：步骤表写入失败 → 事务抛错（主记录 CAS 一起回滚，不残留缺口）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [],
      version: 1,
    });
    tx.rpaExecutionStep.create.mockRejectedValue(new Error('step table write failed'));
    await expect(
      store.appendStep('rpa-1', OWNER, {
        stepName: 'reply-comment',
        status: 'success',
      }),
    ).rejects.toThrow('step table write failed');
  });

  it('finalize：主记录终态与证据表写入在同一 $transaction 内', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [
        {
          type: 'rpa-items',
          externalContentIds: ['c1'],
          sourceUrls: ['https://example.com/v/1'],
        },
      ],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.rpaExecution.update).toHaveBeenCalledTimes(1);
    expect(tx.rpaEvidence.upsert).toHaveBeenCalledTimes(1);
    expect(tx.rpaEvidence.upsert.mock.calls[0][0].create).toEqual(
      expect.objectContaining({
        executionId: 'rpa-1',
        userId: 'u1',
        tenantId: 't1',
        // P1 复核：stepId 绑定最新步骤记录的真实 id（真实外键，不再存 sequenceNo）
        stepId: 'step-1',
      }),
    );
  });

  it('finalize：证据表写入失败 → 事务抛错（终态一起回滚，不残留无证据的成功态）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [
        {
          type: 'rpa-items',
          externalContentIds: ['c1'],
          sourceUrls: ['https://example.com/v/1'],
        },
      ],
    });
    tx.rpaEvidence.upsert.mockRejectedValue(new Error('evidence table write failed'));
    await expect(
      store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' }),
    ).rejects.toThrow('evidence table write failed');
  });

  it('finalize：证据带 legacy 数字 stepId（旧 sequenceNo）→ 解析为同执行下该步骤的真实 id（P1 外键化）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [],
    });
    // legacy：ev.stepId='2'（旧 sequenceNo 语义）→ 反查 sequenceNo=2 的步骤记录真实 id
    // 调用顺序：finalize 先查默认 stepId（最新步骤），再 resolveEvidenceStepId 反查；
    // 默认步骤与反查步骤故意不同，证明写入值来自 resolve 反查而非回退默认。
    tx.rpaExecutionStep.findFirst
      .mockResolvedValueOnce({ id: 'step-latest', sequenceNo: 3 }) // 默认 stepId：最新步骤
      .mockResolvedValueOnce({ id: 'step-real-2', sequenceNo: 2 }); // resolve：按 sequenceNo=2 反查
    await store.finalize('rpa-1', OWNER, {
      status: 'success',
      reasonCode: 'ok',
      evidence: [
        {
          type: 'rpa-step',
          label: '步骤证据',
          url: 'https://evidence.example/x.png',
          stepId: '2',
        },
      ],
    });
    expect(tx.rpaEvidence.upsert.mock.calls[0][0].create.stepId).toBe(
      'step-real-2',
    );
  });

  it('finalize：证据带悬空 stepId（不属于本执行）→ 回退最新步骤真实 id，不写悬空外键（P1 外键化）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [],
    });
    // 调用顺序：finalize 先查默认 stepId（最新步骤 step-1），再 resolve 按 id 查悬空值 → null
    tx.rpaExecutionStep.findFirst
      .mockResolvedValueOnce({ id: 'step-1', sequenceNo: 1 }) // 默认 stepId
      .mockResolvedValueOnce(null); // resolve：按 id 查无（悬空）
    await store.finalize('rpa-1', OWNER, {
      status: 'success',
      reasonCode: 'ok',
      evidence: [
        {
          type: 'rpa-step',
          label: '步骤证据',
          url: 'https://evidence.example/x.png',
          stepId: 'step-from-other-execution',
        },
      ],
    });
    expect(tx.rpaEvidence.upsert.mock.calls[0][0].create.stepId).toBe('step-1');
  });
});

describe('createWithLock 数据库级并发锁（复核 P1）', () => {
  function makeStoreWithTx(createImpl: jest.Mock) {
    const tx = {
      rpaExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createImpl,
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    return new RpaExecutionStore(prisma as any);
  }

  it('并发创建撞部分唯一索引（P2002）→ 抛 account_busy', async () => {
    const createImpl = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const store = makeStoreWithTx(createImpl);
    await expect(
      store.createWithLock({
        userId: 'u1',
        platform: 'kuaishou',
        accountId: 'ks-1',
        userMessage: 'test',
      } as never),
    ).rejects.toThrow('account_busy');
  });

  it('并发创建撞 SQLite 约束 → 抛 account_busy', async () => {
    const createImpl = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('constraint'), { code: 'SQLITE_CONSTRAINT' }));
    const store = makeStoreWithTx(createImpl);
    await expect(
      store.createWithLock({
        userId: 'u1',
        platform: 'kuaishou',
        accountId: 'ks-1',
        userMessage: 'test',
      } as never),
    ).rejects.toThrow('account_busy');
  });

  it('非约束类错误原样抛出（不误判 account_busy）', async () => {
    const createImpl = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('disk full'), { code: 'P9999' }));
    const store = makeStoreWithTx(createImpl);
    await expect(
      store.createWithLock({
        userId: 'u1',
        platform: 'kuaishou',
        accountId: 'ks-1',
        userMessage: 'test',
      } as never),
    ).rejects.toThrow('disk full');
  });
});

describe('RpaExecutionStore 租户共享账号锁（P1-4 复核）', () => {
  it('同租户成员用同一账号 → createWithLock 按 tenant 维度查到活动执行 → account_busy', async () => {
    const prisma = {
      $transaction: jest.fn().mockImplementation(async (cb: any) => {
        const tx = {
          rpaExecution: {
            findFirst: jest.fn().mockResolvedValue({ id: 'other-member-active' }),
            create: jest.fn(),
          },
        };
        return cb(tx);
      }),
    };
    const store = new RpaExecutionStore(prisma as any);

    await expect(
      store.createWithLock({
        tenantId: 'tenant-1',
        userId: 'member-a', // 同租户另一个成员
        platform: 'kuaishou',
        accountId: 'ks-shared',
        userMessage: 'test',
      } as never),
    ).rejects.toThrow('account_busy');

    // 断言查询按 tenant 维度（不含 userId 条件）
    const tx = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    const findFirstImpl = (prisma.$transaction as jest.Mock).mock
      .implementation;
    // 通过直接调用事务回调验证 where 结构
    const captured: any = {};
    await prisma.$transaction.mock.calls[0][0]({
      rpaExecution: {
        findFirst: async (args: any) => {
          captured.where = args.where;
          return null;
        },
        create: jest.fn().mockResolvedValue({ id: 'rpa-1' }),
      },
    });
    expect(captured.where).toEqual({
      tenantId: 'tenant-1',
      platform: 'kuaishou',
      accountId: 'ks-shared',
      status: { in: ['running', 'paused', 'needs-human'] },
    });
    expect(captured.where.userId).toBeUndefined();
  });

  it('hasActiveExecution：有 tenantId → 按 tenant 维度（同租户成员互斥）', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      rpaExecution: { findFirst },
    };
    const store = new RpaExecutionStore(prisma as any);

    await store.hasActiveExecution(
      { userId: 'member-a', tenantId: 'tenant-1' },
      'kuaishou',
      'ks-shared',
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        platform: 'kuaishou',
        accountId: 'ks-shared',
        tenantId: 'tenant-1',
        status: { in: ['running', 'paused', 'needs-human'] },
      },
    });
  });

  it('hasActiveExecution：无 tenantId（legacy）→ 按 userId 维度', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      rpaExecution: { findFirst },
    };
    const store = new RpaExecutionStore(prisma as any);

    await store.hasActiveExecution(
      { userId: 'user-legacy' },
      'kuaishou',
      'ks-1',
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        platform: 'kuaishou',
        accountId: 'ks-1',
        userId: 'user-legacy',
        status: { in: ['running', 'paused', 'needs-human'] },
      },
    });
  });
});

describe('RpaExecutionStore 状态机合法迁移（P1-3 复核）', () => {
  it('终态 success 不可再迁移到 paused（防已成功记录被改写）', async () => {
    const prisma = {
      rpaExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rpa-1',
          userId: 'u1',
          status: 'success',
        }),
        update: jest.fn(),
      },
    };
    const store = new RpaExecutionStore(prisma as any);

    await expect(
      store.transition('rpa-1', OWNER, 'paused'),
    ).rejects.toThrow('非法状态迁移');
    expect(prisma.rpaExecution.update).not.toHaveBeenCalled();
  });

  it('终态 cancelled 不可再迁移到 needs-human', async () => {
    const prisma = {
      rpaExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rpa-1',
          userId: 'u1',
          status: 'cancelled',
        }),
        update: jest.fn(),
      },
    };
    const store = new RpaExecutionStore(prisma as any);

    await expect(
      store.transition('rpa-1', OWNER, 'needs-human'),
    ).rejects.toThrow('非法状态迁移');
    expect(prisma.rpaExecution.update).not.toHaveBeenCalled();
  });

  it('终态 failed 可转 reconcile_required（对账兜底升级）', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'rpa-1', status: 'reconcile_required' });
    const prisma = {
      rpaExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rpa-1',
          userId: 'u1',
          status: 'failed',
        }),
        update,
      },
    };
    const store = new RpaExecutionStore(prisma as any);

    await store.transition('rpa-1', OWNER, 'reconcile_required', {
      reasonCode: 'session_close_failed',
    });
    expect(update).toHaveBeenCalled();
  });

  it('reconcile_required 不可直接回 running（需人工处理后走业务终态）', async () => {
    const prisma = {
      rpaExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rpa-1',
          userId: 'u1',
          status: 'reconcile_required',
        }),
        update: jest.fn(),
      },
    };
    const store = new RpaExecutionStore(prisma as any);

    await expect(
      store.transition('rpa-1', OWNER, 'running'),
    ).rejects.toThrow('非法状态迁移');
    expect(prisma.rpaExecution.update).not.toHaveBeenCalled();
  });
});

describe('RpaExecutionStore 证据 hash 采用（P1-1 复核）', () => {
  it('finalize 证据带真实 sha256 → 直接采用（不重算元数据 hash）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [
        {
          type: 'rpa-screenshot',
          sha256: 'a'.repeat(64),
          path: '/tmp/x.png',
        },
      ],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    const create = tx.rpaEvidence.upsert.mock.calls[0][0].create;
    // P1-1 复核：persistEvidence 采用 driver/controller 侧捕获物字节 hash
    expect(create.sha256).toBe('a'.repeat(64));
  });

  it('finalize 证据无 sha256 → 兜底元数据 hash（不崩）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValueOnce({
      id: 'rpa-1',
      userId: 'u1',
      steps: [{ stepName: 'reply-comment', status: 'success' }],
      evidence: [{ type: 'rpa-fingerprint', pageUrl: 'https://x.com' }],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    const create = tx.rpaEvidence.upsert.mock.calls[0][0].create;
    expect(create.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('RpaExecutionStore 步骤单一事实源（P1-2 复核）', () => {
  it('appendStep：attempt 透传真实重试次数（JSON + 独立表一致，不再固定 1）', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      version: 1,
      steps: [{ stepName: 'discover-keyword', status: 'success' }],
    });
    tx.rpaExecution.updateMany.mockResolvedValue({ count: 1 });

    await store.appendStep('rpa-1', OWNER, {
      stepName: 'read-comments',
      status: 'success',
      attempt: 3,
    });

    // 独立表 attempt 真实
    expect(tx.rpaExecutionStep.create.mock.calls[0][0].data.attempt).toBe(3);
    // JSON 侧 attempt 一致（不丢事实）
    const jsonStep = tx.rpaExecution.updateMany.mock.calls[0][0].data
      .steps;
    expect(jsonStep[1].attempt).toBe(3);
    expect(jsonStep[1].sequenceNo).toBe(2);
  });

  it('appendStep：无 attempt → 默认 1', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      version: 1,
      steps: [],
    });
    tx.rpaExecution.updateMany.mockResolvedValue({ count: 1 });

    await store.appendStep('rpa-1', OWNER, { stepName: 'open-session' });
    expect(tx.rpaExecutionStep.create.mock.calls[0][0].data.attempt).toBe(1);
  });

  it('findOneWithSteps：独立表有步骤 → 以独立表为准（真实 attempt/resultHash）', async () => {
    const { store, prisma } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      steps: [{ stepName: 'old-json', status: 'running' }],
    });
    prisma.rpaExecutionStep.findMany.mockResolvedValue([
      {
        stepName: 'discover-keyword',
        status: 'success',
        reasonCode: 'ok',
        message: null,
        attempt: 2,
        resultHash: 'abc',
        sequenceNo: 1,
        endedAt: new Date(),
      },
    ]);

    const run = await store.findOneWithSteps('rpa-1', OWNER);
    // P1-2 复核：独立表覆盖 JSON steps
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]).toMatchObject({
      stepName: 'discover-keyword',
      status: 'success',
      attempt: 2,
      resultHash: 'abc',
    });
    expect(run.steps[0].stepName).not.toBe('old-json');
  });

  it('findOneWithSteps：独立表空（legacy）→ 回退 JSON 兼容展示', async () => {
    const { store, prisma } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      steps: [{ stepName: 'legacy-step', status: 'success' }],
    });
    prisma.rpaExecutionStep.findMany.mockResolvedValue([]);

    const run = await store.findOneWithSteps('rpa-1', OWNER);
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].stepName).toBe('legacy-step');
  });

  it('appendStep：并发 CAS 冲突 → 重试后成功（步骤不丢、version 递增）', async () => {
    const { store, prisma, tx } = createStore();
    // 第一次并发冲突 count=0（version 落后），重读后第二次 count=1
    tx.rpaExecution.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });
    prisma.rpaExecution.findFirst
      .mockResolvedValueOnce({
        id: 'rpa-1', userId: 'u1', tenantId: 't1', version: 1, steps: [],
      })
      .mockResolvedValue({
        id: 'rpa-1', userId: 'u1', tenantId: 't1', version: 2, steps: [],
      });

    await store.appendStep('rpa-1', OWNER, {
      stepName: 'discover-keyword',
      status: 'success',
    });

    // 两次 CAS 尝试，最终成功且独立表写入一次
    expect(tx.rpaExecution.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.rpaExecutionStep.create).toHaveBeenCalledTimes(1);
    expect(tx.rpaExecution.updateMany.mock.calls[1][0].where.version).toBe(2);
  });
});

describe('RpaExecutionStore finalize 终态保护（全面审查 P1-2 复核）', () => {
  it('已终态（success）记录不可被再次 finalize 改写', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      status: 'success',
      steps: [],
    });
    await expect(
      store.finalize('rpa-1', OWNER, { status: 'failed' }),
    ).rejects.toThrow('非法 finalize');
    expect(tx.rpaExecution.update).not.toHaveBeenCalled();
  });

  it('非终态（running）记录可 finalize', async () => {
    const { store, prisma, tx } = createStore();
    prisma.rpaExecution.findFirst.mockResolvedValue({
      id: 'rpa-1',
      userId: 'u1',
      tenantId: 't1',
      status: 'running',
      steps: [{ stepName: 'discover-keyword', status: 'success' }],
      evidence: [{ type: 'rpa-items', externalContentIds: ['c1'], sourceUrls: ['https://x.com/v/1'] }],
    });
    await store.finalize('rpa-1', OWNER, { status: 'success', reasonCode: 'ok' });
    expect(tx.rpaExecution.update).toHaveBeenCalled();
  });
});
