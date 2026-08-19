import { PublishReconcileService, RECONCILE_TIMEOUT_MS } from './publish-reconcile.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    publishRecord: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
    },
    ...overrides,
  } as never;
}

const baseRecord = {
  id: 'rec-1',
  tenantId: 't1',
  platform: 'douyin',
  status: 'readback_pending',
  readbackState: 'pending',
  publishUrl: null,
  errorMessage: null,
  updatedAt: new Date(),
};

describe('PublishReconcileService（扫 publishRecord 对账）', () => {
  it('外部查回 found → status=success + readbackState=verified（不重发，只对账）', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([baseRecord]),
        update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({
      tenantId: 't1',
      externalLookup: async () => ({ found: true, externalUrl: 'https://x/9' }),
    });
    expect(r.resolved).toBe(1);
    expect(prisma.publishRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'success', readbackState: 'verified' }),
      }),
    );
  });

  it('外部查回 not found + 未超时 → still_pending（不自动重发）', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([baseRecord]),
        update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({
      tenantId: 't1',
      externalLookup: async () => ({ found: false }),
    });
    expect(r.stillPending).toBe(1);
    expect(prisma.publishRecord.update).not.toHaveBeenCalled();
  });

  it('本地 readbackState=verified + publishUrl → success', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([
          { ...baseRecord, readbackState: 'verified', publishUrl: 'https://x/p1' },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({ tenantId: 't1' });
    expect(r.resolved).toBe(1);
    expect(prisma.publishRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'success' }) }),
    );
  });

  it('超过 15 分钟未解决 → readbackState=uncertain（needs_manual 告警）', async () => {
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue([
          { ...baseRecord, updatedAt: new Date(Date.now() - RECONCILE_TIMEOUT_MS - 1000) },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({ tenantId: 't1' });
    expect(r.needsManual).toBe(1);
    expect(prisma.publishRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ readbackState: 'uncertain' }),
      }),
    );
  });

  it('批量 reconcile：统计 scanned/resolved/stillPending/needsManual', async () => {
    const records = [
      { ...baseRecord, id: 'r1', readbackState: 'verified', publishUrl: 'https://x/p1' },
      { ...baseRecord, id: 'r2', updatedAt: new Date(Date.now() - RECONCILE_TIMEOUT_MS - 1000) },
      { ...baseRecord, id: 'r3', updatedAt: new Date() },
    ];
    const prisma = makePrisma({
      publishRecord: {
        findMany: jest.fn().mockResolvedValue(records),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({ tenantId: 't1' });
    expect(r.scanned).toBe(3);
    expect(r.resolved).toBe(1); // r1 本地 verified 解决
    expect(r.needsManual).toBe(1); // r2 超时告警
    expect(r.stillPending).toBe(1); // r3 未超时
  });
});
