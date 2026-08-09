import { SavingsLedgerService } from './savings-ledger.service';

/**
 * 资金链路自动化测试（M5-3，需求清单 V1.1 §13）：
 * - writeLedger 幂等：同 idempotencyKey 重复调用不重复写流水/扣减
 * - settleRebate 双流水：settle-out（pending 减）+ settle-in（available 加）
 */

describe('SavingsLedgerService（资金链路）', () => {
  // --- mock prisma ---
  const txMock = {
    rebateAccount: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'acct1',
        tenantId: 't1',
        userId: 'u1',
        available: 10,
        pending: 5,
        frozen: 0,
        totalEarned: 0,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    rebateLedger: {
      create: jest.fn().mockResolvedValue({ id: 'ledger1' }),
    },
  };

  const createLedgerMock = jest.fn().mockResolvedValue({ id: 'ledger1' });

  const prismaMock = {
    rebateAccount: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'acct1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'acct1',
        tenantId: 't1',
        userId: 'u1',
        available: 10,
        pending: 5,
        frozen: 0,
        totalEarned: 0,
      }),
    },
    rebateLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
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
    prismaMock.rebateLedger.findUnique.mockResolvedValue(null);
    prismaMock.rebateAccount.findUnique.mockResolvedValue(null);
    prismaMock.rebateAccount.create.mockResolvedValue({ id: 'acct1' });
    prismaMock.rebateAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      available: 10,
      pending: 5,
      frozen: 0,
      totalEarned: 0,
    });
    txMock.rebateAccount.findUniqueOrThrow.mockResolvedValue({
      id: 'acct1',
      tenantId: 't1',
      userId: 'u1',
      available: 10,
      pending: 5,
      frozen: 0,
      totalEarned: 0,
    });
    txMock.rebateAccount.update.mockResolvedValue({});
    createLedgerMock.mockResolvedValue({ id: 'ledger1' });
  });

  it('幂等：同 idempotencyKey 重复调用直接返回已有流水，不重复写', async () => {
    const existing = { id: 'l1', idempotencyKey: 'settle:o1', bizType: 'REBATE_SETTLE' };
    prismaMock.rebateLedger.findUnique.mockResolvedValue(existing);

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
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(createLedgerMock).not.toHaveBeenCalled();
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
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    // 每次事务：写流水 + 更新账户
    expect(txMock.rebateAccount.update).toHaveBeenCalledTimes(2);
    // 审计写 SystemLog
    expect(prismaMock.systemLog.create).toHaveBeenCalled();
    expect(prismaMock.systemLog.create.mock.calls[0][0].data.level).toBe(
      'success',
    );
  });

  it('余额不足拒绝扣减（after < 0 抛错）', async () => {
    // available = 10，扣 15 → 抛余额不足
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
  });
});
