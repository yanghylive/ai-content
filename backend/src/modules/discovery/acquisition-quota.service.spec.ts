import { AcquisitionQuotaService, AcquisitionQuotaExceededError } from './acquisition-quota.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: Record<string, unknown> = {
    acquisitionQuota: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'q1', discoverCount: 1 }),
    },
    ...overrides,
  };
  // $transaction 转发回调，让回调里的 tx 复用同一份 acquisitionQuota mock
  prisma.$transaction = jest.fn(
    async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => fn(prisma),
  );
  return prisma as never;
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

  it('consumeDiscover：原子递增（走 recordDiscover，事务内 upsert）', async () => {
    const prisma = makePrisma();
    const svc = new AcquisitionQuotaService(prisma as never);
    await svc.consumeDiscover('u-1');
    const quotaMock = (prisma as never as { acquisitionQuota: { upsert: jest.Mock } }).acquisitionQuota;
    expect(quotaMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ discoverCount: 1 }),
        update: expect.objectContaining({ discoverCount: { increment: 1 } }),
      }),
    );
  });

  it('recordDiscover：计数未超限 → 正常累计', async () => {
    const prisma = makePrisma();
    const svc = new AcquisitionQuotaService(prisma as never);
    await svc.recordDiscover('u-1');
    await svc.recordDiscover('u-1');
    const quotaMock = (prisma as never as { acquisitionQuota: { upsert: jest.Mock } }).acquisitionQuota;
    expect(quotaMock.upsert).toHaveBeenCalledTimes(2);
  });

  it('recordDiscover：递增后超限 → 抛 quota_exceeded（原子拒绝，回滚 +1）', async () => {
    const prisma = makePrisma({
      acquisitionQuota: {
        findUnique: jest.fn().mockResolvedValue(null),
        // 模拟递增后达到 101（超过默认 100 上限）
        upsert: jest.fn().mockResolvedValue({ id: 'q1', discoverCount: 101 }),
      },
    });
    const svc = new AcquisitionQuotaService(prisma as never);
    await expect(svc.recordDiscover('u-1')).rejects.toThrow(AcquisitionQuotaExceededError);
  });
});
