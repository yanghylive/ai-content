import { DomainEventOutboxStore } from './domain-event-outbox.store';

function makePrisma(overrides: { findUnique?: jest.Mock; create?: jest.Mock; update?: jest.Mock } = {}) {
  return {
    domainEventOutbox: {
      findUnique: overrides.findUnique ?? jest.fn().mockResolvedValue(null),
      create: overrides.create ?? jest.fn().mockImplementation(async ({ data }) => ({ id: 'oe-1', ...data })),
      update: overrides.update ?? jest.fn().mockResolvedValue({ id: 'oe-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

const evt = {
  eventId: 'evt-1',
  schemaVersion: 1,
  tenantId: 't1',
  userId: 'u1',
  aggregateType: 'lead',
  aggregateId: 'lead-1',
  type: 'lead.created',
  idempotencyKey: 'key-1',
  occurredAt: '2026-08-16T00:00:00Z',
  payload: { a: 1 },
};

describe('DomainEventOutboxStore', () => {
  it('首次发布 created=true', async () => {
    const prisma = makePrisma();
    const svc = new DomainEventOutboxStore(prisma as never);
    const r = await svc.publish(evt);
    expect(r.created).toBe(true);
  });

  it('同 idempotencyKey 幂等（created=false，不重复写）', async () => {
    const prisma = makePrisma({ findUnique: jest.fn().mockResolvedValue({ id: 'oe-1' }) });
    const svc = new DomainEventOutboxStore(prisma as never);
    const r = await svc.publish(evt);
    expect(r.created).toBe(false);
    expect(prisma.domainEventOutbox.create).not.toHaveBeenCalled();
  });

  it('markFailed 超最大次数转 dead', async () => {
    const prisma = makePrisma({
      findUnique: jest.fn().mockResolvedValue({ id: 'oe-1', attempt: 4 }),
    });
    const svc = new DomainEventOutboxStore(prisma as never);
    await svc.markFailed('oe-1', 'boom', 5);
    expect(prisma.domainEventOutbox.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'dead', attempt: 5 }),
      }),
    );
  });
});
