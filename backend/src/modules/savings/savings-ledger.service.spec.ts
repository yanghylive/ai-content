import { SavingsLedgerService } from './savings-ledger.service';

/**
 * 资金链路自动化测试（M5-3，需求清单 V1.1 §13；2026-08-09 适配 writeLedger 原子化）：
 * - writeLedger 幂等：同 idempotencyKey 重复调用不重复写流水/扣减（事务内幂等检查）
 * - settleRebate 双流水：settle-out（pending 减）+ settle-in（available 加）
 * - 余额不足拒绝扣减（原子 decrement 后余额为负 → 抛错）
 */

describe('SavingsLedgerService（资金链路）', () => {
  // 账户余额状态（模拟原子 decrement 语义）
  let balance = { available: 10, pending: 5, frozen: 0 };

  const txMock = {
    rebateAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      // 原子 decrement：返回更新后的余额对象
      update: jest.fn(async (args: { data: Record<string, { decrement: number }> }) => {
        for (const [k, v] of Object.entries(args.data)) {
          const op = v as { decrement: number };
          balance[k as 'available'] += -op.decrement;
        }
        return { ...balance };
      }),
    },
    rebateLedger: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const createLedgerMock = jest.fn().mockResolvedValue({ id: 'ledger1' });

  const prismaMock = {
    rebateAccount: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    rebateLedger: {
      findUnique: jest.fn(),
      create: createLedgerMock,
    },
    $transaction: jest.fn(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    ),
    systemLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const service = new SavingsLedgerService(prismaMock as never);

  beforeEach(() => {
    jest.clearAllMocks();
    balance = { available: 10, pending: 5, frozen: 0 };
    // 事务内账户存在
    txMock.rebateAccount.findUnique.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      ...balance,
      totalEarned: 0,
    });
    txMock.rebateAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      ...balance,
      totalEarned: 0,
    });
    // 事务内幂等检查默认无已有流水
    txMock.rebateLedger.findUnique.mockResolvedValue(null);
    txMock.rebateLedger.create.mockImplementation(
      async (args: { data: { idempotencyKey: string; changeAmount: number; afterAmount: number } }) =>
        ({ id: 'ledger1', ...args.data }),
    );
    prismaMock.rebateLedger.findUnique.mockResolvedValue(null);
    prismaMock.rebateAccount.findUnique.mockResolvedValue(null);
    prismaMock.rebateAccount.create.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      ...balance,
      totalEarned: 0,
    });
    prismaMock.rebateAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      ...balance,
      totalEarned: 0,
    });
    createLedgerMock.mockResolvedValue({ id: 'ledger1' });
  });

  it('幂等：同 idempotencyKey 重复调用（事务内命中）直接返回已有流水，不重复写', async () => {
    const existing = { id: 'l1', idempotencyKey: 'settle:o1', bizType: 'REBATE_SETTLE' };
    // 事务内幂等检查命中
    txMock.rebateLedger.findUnique.mockResolvedValue(existing);

    const result = await service.writeLedger({
      tenantId: 't1',
      userId: 'u1',
      bizType: 'REBATE_SETTLE',
      bizNo: 'o1',
      changeAmount: 5,
      target: 'available',
      idempotencyKey: 'settle:o1',
      operator: 'system',
    });

    expect(result).toBe(existing);
    expect(txMock.rebateLedger.create).not.toHaveBeenCalled();
    expect(txMock.rebateAccount.update).not.toHaveBeenCalled();
  });

  it('settleRebate 产生双流水：pending 减（settle-out）+ available 加（settle-in）', async () => {
    await service.settleRebate({
      tenantId: 't1',
      userId: 'u1',
      orderId: 'o1',
      orderNo: 'tb123',
      amount: 5,
    });

    // 两次 writeLedger → 两次事务内 create
    expect(txMock.rebateLedger.create).toHaveBeenCalledTimes(2);
    // 每次事务：原子更新账户（pending 减 5 / available 加 5）
    expect(txMock.rebateAccount.update).toHaveBeenCalledTimes(2);
    // 审计写 SystemLog
    expect(prismaMock.systemLog.create).toHaveBeenCalled();
    expect(prismaMock.systemLog.create.mock.calls[0][0].data.level).toBe(
      'success',
    );
    // 余额语义正确：pending 5-5=0，available 10+5=15
    expect(balance.pending).toBe(0);
    expect(balance.available).toBe(15);
  });

  it('余额不足拒绝扣减（原子 decrement 后余额为负 → 抛错，事务回滚）', async () => {
    // available = 10，扣 15 → 原子后 available = -5 → 抛余额不足
    await expect(
      service.writeLedger({
        tenantId: 't1',
        userId: 'u1',
        bizType: 'WITHDRAW_FREEZE',
        bizNo: 'w1',
        changeAmount: -15,
        target: 'available',
        idempotencyKey: 'w1',
        operator: 'user',
      }),
    ).rejects.toThrow(/余额不足/);
    // 流水不落（事务内 create 在抛错前未执行）
    expect(txMock.rebateLedger.create).not.toHaveBeenCalled();
  });
});
