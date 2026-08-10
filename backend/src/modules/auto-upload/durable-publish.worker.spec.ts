import { DurablePublishWorker } from './durable-publish.worker';

describe('DurablePublishWorker finalization', () => {
  function buildRecord() {
    return {
      databaseId: 'runtime-1',
      publicId: 42,
      tenantId: 'tenant-a',
      userId: 'user-a',
      status: 'claimed',
      message: 'claimed',
      idempotencyKey: 'publish-1',
      requestHash: 'hash-1',
      confirmationId: 'confirmation-1',
      authSessionId: 'session-1',
      claimToken: 'claim-1',
      claimedAt: new Date('2026-08-08T00:00:00.000Z'),
      leaseExpiresAt: new Date('2026-08-08T00:02:00.000Z'),
      attemptCount: 1,
      envelope: {
        source: 'durable_publish_record',
        version: 1,
        title: '测试任务',
        platformType: 3,
        accountFile: 'account-1',
        fileList: [],
        tags: [],
        dryRun: false,
        payloads: [],
        result: { platforms: [], summary: {} },
        engineTaskIds: [],
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
      },
      createdAt: new Date('2026-08-08T00:00:00.000Z'),
      updatedAt: new Date('2026-08-08T00:00:00.000Z'),
    } as never;
  }

  function buildWorker(outcome: Record<string, unknown>) {
    const record = buildRecord();
    const store = {
      reenqueueDueScheduled: jest.fn().mockResolvedValue(0),
      reclaimStaleClaims: jest
        .fn()
        .mockResolvedValue({ reclaimed: 0, deadLettered: 0 }),
      claimNextQueued: jest.fn().mockResolvedValue(record),
      completeClaimedTask: jest.fn().mockResolvedValue(true),
      renewLease: jest.fn().mockResolvedValue(true),
    };
    const autoUploadService = {
      executeClaimedDurableTask: jest.fn().mockResolvedValue(outcome),
    };
    const authRequestContext = {
      run: jest.fn(
        (
          _context: unknown,
          callback: () => Promise<Record<string, unknown>>,
        ) => callback(),
      ),
    };
    const worker = new DurablePublishWorker(
      store as never,
      autoUploadService as never,
      authRequestContext as never,
    );
    return { worker, store };
  }

  it('does not overwrite a result that the service already persisted', async () => {
    const { worker, store } = buildWorker({
      status: 'waiting',
      reasonCode: 'readback_failed',
      message: '等待平台回读确认。',
      claimReleased: true,
    });

    await (worker as any).processOneTask();

    expect(store.completeClaimedTask).not.toHaveBeenCalled();
  });

  it('finalizes an existing verified result with its explicit status', async () => {
    const { worker, store } = buildWorker({
      status: 'completed',
      reasonCode: 'success',
      message: '平台已确认。',
      claimReleased: false,
    });

    await (worker as any).processOneTask();

    expect(store.completeClaimedTask).toHaveBeenCalledWith(
      'runtime-1',
      expect.any(String),
      'completed',
      'success',
      '平台已确认。',
    );
  });

  it('can finalize an existing unverified result as waiting', async () => {
    const { worker, store } = buildWorker({
      status: 'waiting',
      reasonCode: 'readback_failed',
      message: '等待平台回读确认。',
      claimReleased: false,
    });

    await (worker as any).processOneTask();

    expect(store.completeClaimedTask).toHaveBeenCalledWith(
      'runtime-1',
      expect.any(String),
      'waiting',
      'readback_failed',
      '等待平台回读确认。',
    );
  });
});
