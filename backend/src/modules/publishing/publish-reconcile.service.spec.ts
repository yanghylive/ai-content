import { PublishReconcileService, RECONCILE_TIMEOUT_MS } from './publish-reconcile.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    publishJob: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'job-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    publishReceipt: {
      update: jest.fn().mockResolvedValue({ id: 'rec-1' }),
    },
    ...overrides,
  } as never;
}

const baseJob = {
  id: 'job-1',
  tenantId: 't1',
  idempotencyKey: 'idem-1',
  variantId: 'v-1',
  status: 'reconcile_required',
  updatedAt: new Date(),
  receipts: [
    { id: 'rec-1', readbackState: 'pending', externalPostId: null, externalUrl: null },
  ],
};

describe('PublishReconcileService', () => {
  it('外部查回 found → job 转 succeeded + receipt verified（不重发，只对账）', async () => {
    const prisma = makePrisma({
      publishJob: {
        findUnique: jest.fn().mockResolvedValue(baseJob),
        update: jest.fn().mockResolvedValue({ id: 'job-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({
      tenantId: 't1',
      jobId: 'job-1',
      externalState: { found: true, externalPostId: 'post-9', externalUrl: 'https://x/9' },
    });
    expect(r.status).toBe('succeeded');
    expect(prisma.publishReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ readbackState: 'verified', externalPostId: 'post-9' }),
      }),
    );
    expect(prisma.publishJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) }),
    );
  });

  it('外部查回 not found → still_pending（不自动重发）', async () => {
    const prisma = makePrisma({
      publishJob: {
        findUnique: jest.fn().mockResolvedValue(baseJob),
        update: jest.fn().mockResolvedValue({ id: 'job-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({ tenantId: 't1', jobId: 'job-1', externalState: { found: false } });
    expect(r.status).toBe('still_pending');
    expect(prisma.publishJob.update).not.toHaveBeenCalled();
  });

  it('本地 receipt verified + externalPostId → succeeded', async () => {
    const prisma = makePrisma({
      publishJob: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseJob,
          receipts: [{ id: 'rec-1', readbackState: 'verified', externalPostId: 'post-1', externalUrl: 'u' }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'job-1' }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({ tenantId: 't1', jobId: 'job-1' });
    expect(r.status).toBe('succeeded');
  });

  it('超过 15 分钟未解决 → needs_manual（告警）', async () => {
    const prisma = makePrisma({
      publishJob: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseJob,
          updatedAt: new Date(Date.now() - RECONCILE_TIMEOUT_MS - 1000),
        }),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({ tenantId: 't1', jobId: 'job-1' });
    expect(r.status).toBe('needs_manual');
  });

  it('未超时 → still_pending', async () => {
    const prisma = makePrisma({
      publishJob: { findUnique: jest.fn().mockResolvedValue(baseJob) },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({ tenantId: 't1', jobId: 'job-1' });
    expect(r.status).toBe('still_pending');
  });

  it('job 不存在或跨租户 → needs_manual', async () => {
    const prisma = makePrisma({
      publishJob: { findUnique: jest.fn().mockResolvedValue({ ...baseJob, tenantId: 'other' }) },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcileJob({ tenantId: 't1', jobId: 'job-1' });
    expect(r.status).toBe('needs_manual');
  });

  it('批量 reconcile：统计 scanned/resolved/stillPending/needsManual', async () => {
    const jobs = [
      { ...baseJob, id: 'j1', receipts: [{ id: 'r1', readbackState: 'verified', externalPostId: 'p1', externalUrl: 'u' }] },
      { ...baseJob, id: 'j2', updatedAt: new Date(Date.now() - RECONCILE_TIMEOUT_MS - 1000) },
      { ...baseJob, id: 'j3', updatedAt: new Date() },
    ];
    const prisma = makePrisma({
      publishJob: {
        findMany: jest.fn().mockResolvedValue(jobs),
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          return jobs.find((j) => j.id === where.id) ?? baseJob;
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const svc = new PublishReconcileService(prisma);
    const r = await svc.reconcile({ tenantId: 't1' });
    expect(r.scanned).toBe(3);
    expect(r.resolved).toBeGreaterThanOrEqual(1); // j1 本地 verified 解决
    expect(r.stillPending + r.needsManual).toBe(2);
  });
});
