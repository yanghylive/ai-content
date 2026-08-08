import {
  DurablePublishCommandCoordinator,
  DurablePublishIdempotencyConflictError,
} from './durable-publish-command.coordinator';
import type {
  CreateDurablePublishClaimInput,
  DurablePublishRecord,
  PublishOwnerScope,
  PublishRecordStore,
} from './publish-record.store';

describe('DurablePublishCommandCoordinator', () => {
  const scope: PublishOwnerScope = {
    tenantId: 'tenant-a',
    userId: 'user-a',
  };
  const input = {
    title: '发布任务',
    platformType: 3,
    accountFile: 'account-1',
    fileList: ['/tmp/video.mp4'],
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
    idempotencyKey: 'publish-1',
    requestHash: 'hash-1',
    confirmationId: 'confirmation-1',
    authSessionId: 'session-1',
  } satisfies CreateDurablePublishClaimInput;

  function record(requestHash = input.requestHash): DurablePublishRecord {
    const now = new Date('2026-08-01T00:00:00.000Z');
    return {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: scope.tenantId,
      userId: scope.userId,
      status: 'waiting',
      message: 'queued',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      confirmationId: input.confirmationId,
      authSessionId: input.authSessionId,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      envelope: {
        source: 'durable_publish_record',
        version: 1,
        title: input.title,
        platformType: input.platformType,
        accountFile: input.accountFile,
        fileList: input.fileList,
        tags: input.tags,
        dryRun: input.dryRun,
        payloads: input.payloads,
        result: input.result,
        engineTaskIds: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  it('returns a newly created durable claim', async () => {
    const created = record();
    const store = {
      createClaim: jest.fn().mockResolvedValue(created),
      findClaimByIdempotencyKey: jest.fn(),
    };
    const coordinator = new DurablePublishCommandCoordinator(
      store as unknown as PublishRecordStore,
      {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({}),
        ),
      } as never,
      {} as never,
    );

    await expect(coordinator.claimOrLoad(scope, input)).resolves.toEqual({
      kind: 'created',
      record: created,
    });
    expect(store.findClaimByIdempotencyKey).not.toHaveBeenCalled();
  });

  it('loads the database winner after a P2002 race', async () => {
    const existing = record();
    const store = {
      createClaim: jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: {
          target: 'runtime_executions_tenant_user_task_idempotency_key',
        },
      }),
      findClaimByIdempotencyKey: jest.fn().mockResolvedValue(existing),
    };
    const coordinator = new DurablePublishCommandCoordinator(
      store as unknown as PublishRecordStore,
      {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({}),
        ),
      } as never,
      {} as never,
    );

    await expect(coordinator.claimOrLoad(scope, input)).resolves.toEqual({
      kind: 'existing',
      record: existing,
    });
    expect(store.findClaimByIdempotencyKey).toHaveBeenCalledWith(
      scope,
      input.idempotencyKey,
    );
  });

  it('rejects reuse of an idempotency key with a different request hash', async () => {
    const store = {
      createClaim: jest.fn().mockRejectedValue({
        code: 'P2002',
        meta: {
          target: 'runtime_executions_tenant_user_task_idempotency_key',
        },
      }),
      findClaimByIdempotencyKey: jest
        .fn()
        .mockResolvedValue(record('different-hash')),
    };
    const coordinator = new DurablePublishCommandCoordinator(
      store as unknown as PublishRecordStore,
      {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({}),
        ),
      } as never,
      {} as never,
    );

    await expect(coordinator.claimOrLoad(scope, input)).rejects.toBeInstanceOf(
      DurablePublishIdempotencyConflictError,
    );
  });

  it('does not treat a public task id collision as an idempotency winner', async () => {
    const publicIdConflict = {
      code: 'P2002',
      meta: {
        target: 'runtime_executions_durable_publish_related_id_key',
      },
    };
    const store = {
      createClaim: jest.fn().mockRejectedValue(publicIdConflict),
      findClaimByIdempotencyKey: jest.fn(),
    };
    const coordinator = new DurablePublishCommandCoordinator(
      store as unknown as PublishRecordStore,
      {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({}),
        ),
      } as never,
      {} as never,
    );

    await expect(coordinator.claimOrLoad(scope, input)).rejects.toBe(
      publicIdConflict,
    );
    expect(store.findClaimByIdempotencyKey).not.toHaveBeenCalled();
  });

  it('does not create a second task when the P2002 winner is temporarily unreadable', async () => {
    const conflict = {
      code: 'P2002',
      meta: {
        target: 'runtime_executions_tenant_user_task_idempotency_key',
      },
    };
    const store = {
      createClaim: jest.fn().mockRejectedValue(conflict),
      findClaimByIdempotencyKey: jest.fn().mockResolvedValue(null),
    };
    const coordinator = new DurablePublishCommandCoordinator(
      store as unknown as PublishRecordStore,
      {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({}),
        ),
      } as never,
      {} as never,
    );

    await expect(coordinator.claimOrLoad(scope, input)).rejects.toBe(conflict);
    expect(store.createClaim).toHaveBeenCalledTimes(1);
  });
});
