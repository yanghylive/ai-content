import { AcquisitionQuotaService, AcquisitionQuotaExceededError } from './acquisition-quota.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    acquisitionQuota: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'q1', discoverCount: 1 }),
    },
    ...overrides,
  } as never;
}

describe('AcquisitionQuotaService（报告 16.3 第 6 项采集配额）', () => {
  it('未用配额 → 可采集', async () => {
    const svc = new AcquisitionQuotaService(makePrisma() as never);
    const quota = await svc.getQuota('u-1');
    expect(quota.used).toBe(0);
    expect(quota.exceeded).toBe(false);
    await expect(svc.assertCanDiscover('u-1')).resolves.toBeUndefined();
  });

  it('配额用尽 → 抛 quota_exceeded（结构化原因码）', async () => {
    const prisma = makePrisma({
      acquisitionQuota: {
        findUnique: jest.fn().mockResolvedValue({ discoverCount: 100, discoverLimit: 100 }),
      },
    });
    const svc = new AcquisitionQuotaService(prisma as never);
    const quota = await svc.getQuota('u-1');
    expect(quota.exceeded).toBe(true);
    expect(quota.remaining).toBe(0);
    await expect(svc.assertCanDiscover('u-1')).rejects.toThrow(AcquisitionQuotaExceededError);
  });

  it('consumeDiscover：检查 + 计数（upsert 日行）', async () => {
    const prisma = makePrisma();
    const svc = new AcquisitionQuotaService(prisma as never);
    await svc.consumeDiscover('u-1');
    expect(prisma.acquisitionQuota.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ discoverCount: 1 }),
        update: expect.objectContaining({ discoverCount: { increment: 1 } }),
      }),
    );
  });

  it('recordDiscover 幂等累计', async () => {
    const prisma = makePrisma();
    const svc = new AcquisitionQuotaService(prisma as never);
    await svc.recordDiscover('u-1');
    await svc.recordDiscover('u-1');
    expect(prisma.acquisitionQuota.upsert).toHaveBeenCalledTimes(2);
  });
});
