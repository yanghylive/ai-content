import { OutboxRelayService } from './outbox-relay.service';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    domainEventOutbox: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'e1' }),
    },
    leadEventOutbox: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 'l1' }),
    },
    ...overrides,
  } as never;
}

describe('OutboxRelayService（P1-8 outbox worker）', () => {
  it('消费 domain 事件：emit + markConsumed', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', type: 'lead.created', aggregateType: 'lead', aggregateId: 'lead-1', tenantId: 't1', userId: 'u1', payload: { leadId: 'lead-1' }, attempt: 0 },
        ]),
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

  it('消费失败 → markFailed（attempt 递增，超 5 次 dead）', async () => {
    const prisma = makePrisma({
      domainEventOutbox: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'e1', type: 'lead.created', aggregateType: 'lead', aggregateId: 'lead-1', tenantId: 't1', userId: 'u1', payload: {}, attempt: 4 },
        ]),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          if (data.status === 'consumed') throw new Error('boom');
          return { id: where.id, ...data };
        }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    // 无订阅者，但 emit 不会抛错；手动让 consume update 抛错
    await svc.relayPending();
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'dead', attempt: 5 }) }),
    );
  });

  it('消费 lead 事件：emit + markConsumed', async () => {
    const prisma = makePrisma({
      leadEventOutbox: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'l1', eventType: 'lead.converted', payload: { leadId: 'lead-1', customerId: 'c1' } },
        ]),
        update: jest.fn().mockResolvedValue({ id: 'l1' }),
      },
    });
    const svc = new OutboxRelayService(prisma as never);
    const received: unknown[] = [];
    svc.onDomainEvent((e) => received.push(e));
    await svc.relayPending();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'lead.converted' });
  });
});
