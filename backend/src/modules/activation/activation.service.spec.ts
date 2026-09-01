import { ActivationService } from './activation.service';

describe('ActivationService', () => {
  it('recordFirstValue 首次记录成功，重复记录幂等跳过', async () => {
    const prisma = {
      activationEvent: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'evt-1' })
          .mockRejectedValueOnce(new Error('unique constraint')),
      },
      system: {
            user: {
              findUnique: jest.fn(),
            },
      },
    };
    const service = new ActivationService(prisma as any);

    const first = await service.recordFirstValue({
      userId: 'user-1',
      eventType: 'first_lead',
      refId: 'lead-1',
    });
    const second = await service.recordFirstValue({
      userId: 'user-1',
      eventType: 'first_lead',
      refId: 'lead-2',
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(prisma.activationEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.activationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          eventType: 'first_lead',
          refId: 'lead-1',
        }),
      }),
    );
  });

  it('getActivation 返回激活状态 + 注册到首价值耗时（分钟）', async () => {
    const prisma = {
      activationEvent: {
        findMany: jest.fn().mockResolvedValue([
          { eventType: 'first_lead', createdAt: new Date('2026-08-16T13:10:00Z') },
        ]),
        create: jest.fn(),
      },
      system: {
            user: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ createdAt: new Date('2026-08-16T13:00:00Z') }),
            },
      },
    };
    const service = new ActivationService(prisma as any);

    const result = await service.getActivation('user-1');

    expect(result.activated).toBe(true);
    expect(result.timeToFirstValueMinutes).toBe(10);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventType).toBe('first_lead');
  });

  it('getActivation 无事件时 activated=false，耗时 null', async () => {
    const prisma = {
      activationEvent: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      system: {
            user: { findUnique: jest.fn().mockResolvedValue({ createdAt: new Date() }) },
      },
    };
    const service = new ActivationService(prisma as any);

    const result = await service.getActivation('user-1');

    expect(result.activated).toBe(false);
    expect(result.timeToFirstValueMinutes).toBeNull();
  });
});
