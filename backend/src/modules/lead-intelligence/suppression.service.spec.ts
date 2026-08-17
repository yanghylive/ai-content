import { SuppressionService } from './suppression.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  return {
    suppression: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const hit = rows.find(
          (r) =>
            r.tenantId === where.tenantId_kind_normalizedValue.tenantId &&
            r.kind === where.tenantId_kind_normalizedValue.kind &&
            r.normalizedValue === where.tenantId_kind_normalizedValue.normalizedValue,
        );
        return hit ?? null;
      }),
      upsert: jest.fn().mockImplementation(async ({ create, update }) => {
        const existing = rows.find(
          (r) =>
            r.tenantId === create.tenantId &&
            r.kind === create.kind &&
            r.normalizedValue === create.normalizedValue,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `sup-${rows.length + 1}`, ...create };
        rows.push(row);
        return row;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    ...overrides,
  } as never;
}

describe('SuppressionService', () => {
  it('未命中 → not suppressed', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    const r = await svc.isSuppressed({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com' });
    expect(r.suppressed).toBe(false);
  });

  it('命中 → suppressed + reason（发送前检查）', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    await svc.add({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com', reason: 'explicit_opt_out' });
    // 发送前 + 消费前双检查（两次调用都命中）
    const r1 = await svc.isSuppressed({ tenantId: 't1', kind: 'email', normalizedValue: 'A@B.com' });
    const r2 = await svc.isSuppressed({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com' });
    expect(r1.suppressed).toBe(true);
    expect(r2.suppressed).toBe(true);
    expect(r1.reason).toContain('explicit_opt_out');
  });

  it('解除（removedAt 标记）后不再命中，但物理行保留', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    const added = await svc.add({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com', reason: 'explicit_opt_out' });
    await svc.remove({ tenantId: 't1', id: added.id });
    const r = await svc.isSuppressed({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com' });
    expect(r.suppressed).toBe(false);
  });

  it('重复 add → upsert 更新 reason，不产生重复行', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    await svc.add({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com', reason: 'explicit_opt_out' });
    await svc.add({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com', reason: 'complaint' });
    const r = await svc.isSuppressed({ tenantId: 't1', kind: 'email', normalizedValue: 'a@b.com' });
    expect(r.reason).toContain('complaint');
    expect(prisma.suppression.upsert).toHaveBeenCalledTimes(2);
  });

  it('inferred negative → 停止序列但建人工跟进（不永久 suppress）', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    const r = await svc.handleInferredNegative({ tenantId: 't1', leadId: 'l1', reason: 'negative reply' });
    expect(r).toEqual({ action: 'stop_sequence', needsHumanFollowUp: true });
    // 没有写入 Suppression 表
    expect(prisma.suppression.upsert).not.toHaveBeenCalled();
  });

  it('租户级阻断 → 写 tenant-blocked 标记 + 通知管理员', async () => {
    const prisma = makePrisma();
    const svc = new SuppressionService(prisma);
    const r = await svc.blockTenant({ tenantId: 't1', reason: 'platform_risk' });
    expect(r).toEqual({ tenantBlocked: true, notifyAdmin: true });
    expect(prisma.suppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ normalizedValue: '@tenant-blocked:t1' }),
      }),
    );
  });

  it('normalize：邮箱大小写归一化', () => {
    const svc = new SuppressionService(makePrisma());
    expect(svc.normalize('email', '  A@B.COM  ')).toBe('a@b.com');
  });
});
