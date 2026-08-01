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
          .mockImplementationOnce(({ data }: { data: Record<string, unknown> }) => ({
            id: 'runtime-2',
            ...data,
            createdAt,
            updatedAt: createdAt,
          })),
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
});
