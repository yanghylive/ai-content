import { OutboxRelayService } from './outbox-relay.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    domainEventOutbox: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'e1' }),
    },
    ...overrides,
  } as never;
}

const ROW = {
  id: 'e1', type: 'lead.created', aggregateType: 'lead', aggregateId: 'lead-1',
  tenantId: 't1', userId: 'u1', payload: { leadId: 'lead-1' }, attempt: 0,
};

describe('OutboxRelayService（P1-8 outbox worker）', () => {
  it('有消费者 + 成功：emit 后 markConsumed', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([ROW]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    const received: unknown[] = [];
    svc.onDomainEvent((e) => received.push(e));
    await svc.relayPending();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'lead.created' });
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'consumed' }) }),
    );
  });

  it('无消费者：不 markConsumed（事件保留 published，不静默丢失）', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([ROW]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    // 不注册任何消费者
    await svc.relayPending();
    // 事件保留 published：update 不被调用（既不 consumed 也不 failed）
    expect(prisma.domainEventOutbox.update).not.toHaveBeenCalled();
  });

  it('有消费者但消费失败：markFailed（attempt 递增，超 5 次 dead）', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([{ ...ROW, attempt: 4 }]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    // 消费者抛错 → emitAndAwait reject → 走 markFailed 重试
    svc.onDomainEvent(() => { throw new Error('consumer boom'); });
    await svc.relayPending();
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dead', attempt: 5 }) }),
    );
  });

  it('有消费者 + async 消费者成功：等待完成才 markConsumed', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([ROW]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    let done = false;
    svc.onDomainEvent(async () => { await Promise.resolve(); done = true; });
    await svc.relayPending();
    expect(done).toBe(true);
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'consumed' }) }),
    );
  });

  it('声明 types 的消费者只处理匹配 type：非匹配 type 不 markConsumed', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([ROW]), // ROW.type = 'lead.created'
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    const received: unknown[] = [];
    // 消费者只关注 lead.action.executed，不关注 lead.created
    svc.onDomainEvent((e) => received.push(e), ['lead.action.executed']);
    await svc.relayPending();
    // lead.created 无对应消费者 → 不 emit、不 markConsumed
    expect(received).toHaveLength(0);
    expect(prisma.domainEventOutbox.update).not.toHaveBeenCalled();
  });

  it('声明 types 的消费者匹配 type 时正常消费', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...ROW, type: 'lead.action.executed' }]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    const received: unknown[] = [];
    svc.onDomainEvent((e) => received.push(e), ['lead.action.executed']);
    await svc.relayPending();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'lead.action.executed' });
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'consumed' }),
      }),
    );
  });

  it('async 消费者 reject → markFailed 重试（不假消费）', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([{ ...ROW, attempt: 0 }]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    // async 消费者 reject：修复前 void handler 会吞掉 reject 导致假消费，修复后应 markFailed
    svc.onDomainEvent(async () => {
      throw new Error('async consumer boom');
    });
    await svc.relayPending();
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'published', attempt: 1 }),
      }),
    );
  });

  it('async 消费者完成前不 markConsumed（等待 Promise 落定）', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([ROW]),
        update: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    let resolved = false;
    svc.onDomainEvent(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve();
          }, 20);
        }),
    );
    await svc.relayPending();
    expect(resolved).toBe(true); // relay 等到了 Promise 完成
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'consumed' }) }),
    );
  });

  describe('compensateMissingConvertEvents（CRM 转换后 outbox 缺失补偿）', () => {
    const CONVERTED_LEAD = {
      id: 'lead-conv-1',
      userId: 'u1',
      tenantId: 't1',
      customerId: 'customer-1',
    };

    it('converted 且缺 outbox 事件 → 补写', async () => {
      const create = jest.fn().mockResolvedValue({ id: 'out-1' });
      const prisma = makePrisma({
        lead: { findMany: jest.fn().mockResolvedValue([CONVERTED_LEAD]) },
        domainEventOutbox: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      });
      const svc = new OutboxRelayService(prisma as never);
      await svc.compensateMissingConvertEvents();
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'lead.action.executed',
            idempotencyKey: 'convert-crm:lead-conv-1',
            payload: expect.objectContaining({
              actionType: 'convert_crm',
              customerId: 'customer-1',
            }),
          }),
        }),
      );
    });

    it('converted 但已有 outbox 事件 → 不补写（幂等）', async () => {
      const create = jest.fn();
      const prisma = makePrisma({
        lead: { findMany: jest.fn().mockResolvedValue([CONVERTED_LEAD]) },
        domainEventOutbox: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
          create,
        },
      });
      const svc = new OutboxRelayService(prisma as never);
      await svc.compensateMissingConvertEvents();
      expect(create).not.toHaveBeenCalled();
    });

    it('判据按 aggregateId+type 查（不按 idempotencyKey）：自定义 key 转客户不误补', async () => {
      const findFirst = jest.fn().mockResolvedValue({ id: 'existing' });
      const create = jest.fn();
      const prisma = makePrisma({
        lead: { findMany: jest.fn().mockResolvedValue([CONVERTED_LEAD]) },
        domainEventOutbox: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst,
          create,
        },
      });
      const svc = new OutboxRelayService(prisma as never);
      await svc.compensateMissingConvertEvents();
      // 判据不含 idempotencyKey（controller 可能传自定义 key，按固定 key 查会误补）
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            aggregateType: 'lead',
            aggregateId: 'lead-conv-1',
            type: 'lead.action.executed',
          }),
        }),
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('converted 但 customerId 为空 → 跳过（不补写残缺事件）', async () => {
      const create = jest.fn();
      const prisma = makePrisma({
        lead: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ ...CONVERTED_LEAD, customerId: null }]),
        },
        domainEventOutbox: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn().mockResolvedValue(null),
          create,
        },
      });
      const svc = new OutboxRelayService(prisma as never);
      await svc.compensateMissingConvertEvents();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
