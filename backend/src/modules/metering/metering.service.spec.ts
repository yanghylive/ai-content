import { MeteringService } from './metering.service';

describe('MeteringService', () => {
  const makeService = (overrides?: Record<string, jest.Mock>) => {
    const prisma = {
      usageEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        update: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        ...overrides,
      },
    };
    return {
      service: new MeteringService(prisma as never),
      prisma,
    };
  };

  it('reserve 创建 reserved 事件', async () => {
    const { service, prisma } = makeService();
    await service.reserve({
      userId: 'user-1',
      meter: 'token',
      amount: 1000,
      context: 'ai-chat',
      refId: 'task-1',
    });
    expect(prisma.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        meter: 'token',
        amount: 1000,
        state: 'reserved',
        context: 'ai-chat',
        refId: 'task-1',
      }),
    });
  });

  it('reserve 幂等：同 idempotencyKey 只占一次', async () => {
    const { service, prisma } = makeService({
      findUnique: jest.fn().mockResolvedValue({ id: 'evt-existing' }),
    });
    const result = await service.reserve({
      userId: 'user-1',
      meter: 'token',
      amount: 1000,
      idempotencyKey: 'key-1',
    });
    expect(result.id).toBe('evt-existing');
    expect(prisma.usageEvent.create).not.toHaveBeenCalled();
  });

  it('confirm 把 reserved 转 confirmed', async () => {
    const { service, prisma } = makeService();
    await service.confirm('evt-1');
    expect(prisma.usageEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { state: 'confirmed' },
    });
  });

  it('reverse 把 reserved 转 reversed（冲正，不计用量）', async () => {
    const { service, prisma } = makeService();
    await service.reverse('evt-1');
    expect(prisma.usageEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { state: 'reversed' },
    });
  });

  it('confirmedUsage 只统计 confirmed 的 amount', async () => {
    const { service, prisma } = makeService({
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 2500 } }),
    });
    const total = await service.confirmedUsage('user-1', 'token');
    expect(total).toBe(2500);
    expect(prisma.usageEvent.aggregate).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-1',
        meter: 'token',
        state: 'confirmed',
      }),
      _sum: { amount: true },
    });
  });
});
