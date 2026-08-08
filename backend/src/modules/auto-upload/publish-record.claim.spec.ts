import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PublishRecordStore } from './publish-record.store';

describe('PublishRecordStore durable worker claim', () => {
  it('claims a queued task with a conditional database update', async () => {
    const row = {
      id: 'runtime-1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      relatedId: '42',
      relatedType: 'publish-command',
      executor: 'local-runtime',
      platform: 'publishing',
      taskType: 'auto-upload-publish-record-v1',
      accountId: null,
      ok: false,
      status: 'claimed',
      reasonCode: 'claimed',
      userMessage: '发布任务已由本机执行器接收。',
      technicalMessage: null,
      runtimeJson: {
        source: 'durable_publish_record',
        version: 1,
        title: '任务',
        platformType: 3,
        accountFile: 'account-1',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      evidenceJson: [],
      readbackJson: null,
      agentSSessionId: null,
      engineUrl: null,
      idempotencyKey: 'publish-1',
      requestHash: 'hash-1',
      confirmationId: 'confirmation-1',
      authSessionId: 'session-1',
      claimToken: 'claim-1',
      claimedAt: new Date('2026-08-01T00:01:00.000Z'),
      leaseExpiresAt: new Date('2026-08-01T00:02:00.000Z'),
      attemptCount: 1,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:01:00.000Z'),
    };
    const prisma = {
      runtimeExecution: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: row.id })
          .mockResolvedValueOnce(row),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );
    const now = new Date('2026-08-01T00:01:00.000Z');
    const lease = new Date('2026-08-01T00:02:00.000Z');

    await expect(
      store.claimNextQueued(now, lease, 'claim-1'),
    ).resolves.toMatchObject({
      databaseId: row.id,
      publicId: 42,
      claimToken: 'claim-1',
      attemptCount: 1,
    });
    expect(prisma.runtimeExecution.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: row.id,
        status: 'queued',
        claimToken: null,
        leaseExpiresAt: null,
      }),
      data: expect.objectContaining({
        status: 'claimed',
        claimToken: 'claim-1',
        attemptCount: { increment: 1 },
      }),
    });
  });

  it('reallocates the public task id after a concurrent id collision', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const prisma = {
      runtimeExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockRejectedValueOnce({
            code: 'P2002',
            meta: {
              target: 'runtime_executions_durable_publish_related_id_key',
            },
          })
          .mockImplementationOnce(
            ({ data }: { data: Record<string, unknown> }) => ({
              id: 'runtime-2',
              ...data,
              createdAt,
              updatedAt: createdAt,
            }),
          ),
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );

    await expect(
      store.createClaim(
        { tenantId: 'tenant-a', userId: 'user-a' },
        {
          title: '任务',
          platformType: 3,
          accountFile: 'account-1',
          fileList: [],
          tags: [],
          dryRun: false,
          payloads: [],
          result: {
            platforms: [],
            summary: {
              total: 0,
              success: 0,
              failed: 0,
              accountExpired: 0,
              materialError: 0,
              loginRequired: 0,
              pendingManual: 0,
              blocked: 0,
              notIntegrated: 0,
            },
          },
          idempotencyKey: 'publish-2',
          requestHash: 'hash-2',
          confirmationId: 'confirmation-2',
          authSessionId: 'session-2',
          preferredPublicId: 42,
          recordedAt: createdAt.toISOString(),
        },
      ),
    ).resolves.toMatchObject({ publicId: 43, idempotencyKey: 'publish-2' });
    expect(prisma.runtimeExecution.create).toHaveBeenCalledTimes(2);
    expect(prisma.runtimeExecution.create.mock.calls[0][0].data.relatedId).toBe(
      '42',
    );
    expect(prisma.runtimeExecution.create.mock.calls[1][0].data.relatedId).toBe(
      '43',
    );
  });

  it('returns null when another worker wins the conditional update', async () => {
    const prisma = {
      runtimeExecution: {
        findFirst: jest.fn().mockResolvedValue({ id: 'runtime-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );

    await expect(
      store.claimNextQueued(new Date(), new Date(), 'claim-loser'),
    ).resolves.toBeNull();
    expect(prisma.runtimeExecution.findFirst).toHaveBeenCalledTimes(1);
  });

  it('completes a claimed task with a conditional CAS update', async () => {
    const prisma = {
      runtimeExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );

    await expect(
      store.completeClaimedTask(
        'runtime-1',
        'claim-1',
        'completed',
        'success',
        'done',
      ),
    ).resolves.toBe(true);
    expect(prisma.runtimeExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'runtime-1', claimToken: 'claim-1', status: 'claimed' },
      data: expect.objectContaining({
        status: 'completed',
        claimToken: null,
      }),
    });
  });

  it('renews a lease with a conditional CAS update', async () => {
    const prisma = {
      runtimeExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );
    const newLease = new Date('2026-08-01T00:05:00.000Z');

    await expect(
      store.renewLease('runtime-1', 'claim-1', newLease),
    ).resolves.toBe(true);
    expect(prisma.runtimeExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'runtime-1', claimToken: 'claim-1', status: 'claimed' },
      data: { leaseExpiresAt: newLease },
    });
  });

  it('reclaims stale claimed tasks back to queued', async () => {
    const prisma = {
      runtimeExecution: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 0 }) // dead lettered (attemptCount >= max)
          .mockResolvedValueOnce({ count: 3 }), // reclaimed
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );
    const now = new Date('2026-08-01T00:10:00.000Z');

    await expect(store.reclaimStaleClaims(now, 3)).resolves.toEqual({
      reclaimed: 3,
      deadLettered: 0,
    });
    // Second call is the reclaim (attemptCount < max)
    expect(prisma.runtimeExecution.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        taskType: 'auto-upload-publish-record-v1',
        status: 'claimed',
        leaseExpiresAt: { lt: now },
        attemptCount: { lt: 3 },
      },
      data: expect.objectContaining({
        status: 'queued',
        reasonCode: 'lease_expired',
        claimToken: null,
      }),
    });
  });

  it('dead-letters tasks exceeding max attempts', async () => {
    const prisma = {
      runtimeExecution: {
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 }) // dead lettered
          .mockResolvedValueOnce({ count: 0 }), // reclaimed
      },
    };
    const store = new PublishRecordStore(
      prisma as never,
      new AuthRequestContextService(),
    );
    const now = new Date('2026-08-01T00:10:00.000Z');

    const result = await store.reclaimStaleClaims(now, 3);
    expect(result.deadLettered).toBe(1);
    expect(result.reclaimed).toBe(0);
    // First call is the dead letter (attemptCount >= max)
    expect(prisma.runtimeExecution.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        taskType: 'auto-upload-publish-record-v1',
        status: 'claimed',
        leaseExpiresAt: { lt: now },
        attemptCount: { gte: 3 },
      },
      data: expect.objectContaining({
        status: 'failed',
        reasonCode: 'max_attempts_exceeded',
        claimToken: null,
      }),
    });
  });
});

describe('PublishRecordStore durable worker idempotency & cancel', () => {
  function buildRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'runtime-1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      relatedId: '42',
      relatedType: 'publish-command',
      executor: 'local-runtime',
      platform: 'publishing',
      taskType: 'auto-upload-publish-record-v1',
      accountId: null,
      ok: false,
      status: 'claimed',
      reasonCode: 'claimed',
      userMessage: '发布任务已由本机执行器接收。',
      technicalMessage: null,
      runtimeJson: {
        source: 'durable_publish_record',
        version: 1,
        title: '任务',
        platformType: 3,
        accountFile: 'account-1',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
      evidenceJson: [],
      readbackJson: null,
      agentSSessionId: null,
      engineUrl: null,
      idempotencyKey: 'publish-1',
      requestHash: 'hash-1',
      confirmationId: null,
      authSessionId: 'session-1',
      claimToken: 'claim-1',
      claimedAt: new Date('2026-08-01T00:01:00.000Z'),
      leaseExpiresAt: new Date('2026-08-01T00:02:00.000Z'),
      attemptCount: 1,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:01:00.000Z'),
      ...overrides,
    };
  }

  function buildStore(prisma: Record<string, unknown>) {
    const authRequestContext = {
      hasContext: () => true,
      get: () => ({ user: { id: 'user-a' } }),
      resolveTenantId: jest.fn().mockResolvedValue('tenant-a'),
    };
    return new PublishRecordStore(prisma as never, authRequestContext as never);
  }

  it('allows cancelling a queued (not yet claimed) task', async () => {
    const updated = buildRow({ status: 'cancelled' });
    const prisma = {
      runtimeExecution: { update: jest.fn().mockResolvedValue(updated) },
      tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const store = buildStore(prisma);
    const record = {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: 'tenant-a',
      userId: 'user-a',
      status: 'queued',
      envelope: {
        source: 'durable_publish_record',
        version: 1 as const,
        title: '任务',
        platformType: 3,
        accountFile: 'account-1',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    await expect(store.cancelTask(record as never)).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('rejects cancelling a claimed (in-flight) task', async () => {
    const store = buildStore({ runtimeExecution: {} });
    const record = {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: 'tenant-a',
      userId: 'user-a',
      status: 'claimed',
      envelope: {},
    };
    await expect(store.cancelTask(record as never)).rejects.toThrow(
      '只有排队中的任务可以取消',
    );
  });

  it('marks an attempt as started with an idempotency key', async () => {
    const prisma = {
      runtimeExecution: { update: jest.fn().mockResolvedValue(buildRow()) },
    };
    const store = buildStore(prisma);
    const record = {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: 'tenant-a',
      userId: 'user-a',
      status: 'claimed',
      envelope: {
        source: 'durable_publish_record',
        version: 1,
        title: '任务',
        platformType: 3,
        accountFile: 'a',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    await store.markPublishAttemptStarted(record as never, 'attempt-key-1');
    const write = prisma.runtimeExecution.update.mock.calls[0][0];
    const envelope = write.data.runtimeJson as Record<string, unknown>;
    expect(envelope.attemptKey).toBe('attempt-key-1');
    expect(typeof envelope.attemptStartedAt).toBe('string');
  });

  it('marks an interrupted attempt as outcome-uncertain (no duplicate side effect)', async () => {
    const prisma = {
      runtimeExecution: { update: jest.fn().mockResolvedValue(buildRow()) },
    };
    const store = buildStore(prisma);
    const record = {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: 'tenant-a',
      userId: 'user-a',
      status: 'claimed',
      envelope: {
        source: 'durable_publish_record',
        version: 1,
        title: '任务',
        platformType: 3,
        accountFile: 'a',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    };
    await store.markOutcomeUncertain(
      record as never,
      '上次发布执行中断、结果不确定',
    );
    const write = prisma.runtimeExecution.update.mock.calls[0][0];
    expect(write.data.status).toBe('failed');
    expect(write.data.reasonCode).toBe('outcome_uncertain');
    const envelope = write.data.runtimeJson as Record<string, unknown>;
    expect(
      (envelope.outcomeUncertain as { reason?: string })?.reason,
    ).toContain('结果不确定');
  });
});
