import { SavingsExchangeService } from './savings-exchange.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const exchanges: Array<Record<string, unknown>> = [];
  const prismaDef = {
    rebateExchange: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        return exchanges.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: `ex-${exchanges.length + 1}`, ...data, status: 'CREATED' };
        exchanges.push(row);
        return row;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const row = exchanges.find((e) => e.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    rebateLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
    },
    rebateAccount: {
      upsert: jest.fn().mockResolvedValue({ id: 'acc-1', available: 100 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'acc-1', available: 100 }),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'acc-1', ...data })),
    },
    aiCreditAccount: {
      upsert: jest.fn().mockResolvedValue({ id: 'credit-1', balance: 100, totalGranted: 100 }),
    },
    systemLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(prismaDef as never);
    }),
    ...overrides,
  };
  return prismaDef as never;
}

function makeAuth() {
  return {
    get: jest.fn().mockReturnValue({ user: { id: 'u-1' } }),
    resolveTenantId: jest.fn().mockResolvedValue('t-1'),
  };
}

function makeLedger() {
  return {
    writeLedger: jest.fn().mockResolvedValue({ id: 'ledger-1' }),
  };
}

describe('SavingsExchangeService · 大王定价（订阅价锚定）', () => {
  it('汇率 = 订阅赠送积分 / 订阅价（默认 1000/29.9 ≈ 33.44 积分/元）', async () => {
    const prisma = makePrisma();
    const svc = new SavingsExchangeService(prisma as never, makeAuth() as never, makeLedger() as never);
    const r = await svc.exchange({ amount: 10, idempotencyKey: 'k-1' });
    // 10 元 × 33.44 ≈ 334 积分
    expect(r.rate).toBeGreaterThan(33);
    expect(r.creditAmount).toBeGreaterThan(330);
    expect(r.creditAmount).toBeLessThan(340);
    expect(r.status).toBe('SUCCESS');
  });

  it('幂等：同 idempotencyKey 重复兑换返回原结果，不重复扣减', async () => {
    const prisma = makePrisma();
    const svc = new SavingsExchangeService(prisma as never, makeAuth() as never, makeLedger() as never);
    const r1 = await svc.exchange({ amount: 5, idempotencyKey: 'same-key' });
    const r2 = await svc.exchange({ amount: 5, idempotencyKey: 'same-key' });
    expect(r2.exchangeId).toBe(r1.exchangeId);
  });

  it('金额低于下限拒绝', async () => {
    const prisma = makePrisma();
    const svc = new SavingsExchangeService(prisma as never, makeAuth() as never, makeLedger() as never);
    await expect(
      svc.exchange({ amount: 0.5, idempotencyKey: 'k-low' }),
    ).rejects.toThrow('兑换金额不能低于');
  });
});
