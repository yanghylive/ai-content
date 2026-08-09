import { createHmac } from 'node:crypto';
import { BillingService } from './billing.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantsService } from '../tenants/tenants.service';
import type { BillingWebhookPayload } from './billing.types';

function sign(payload: BillingWebhookPayload, secret = 'test-secret') {
  return createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function makeUser() {
  return {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    passwordHash: 'hash',
    name: 'Tester',
    status: 'active',
    lastLoginAt: null,
    kaypalUserId: 'kaypal-1',
    role: 'admin',
    commercialExecutionAllowed: false,
    planMode: 'trial',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

function makePrismaMock(overrides: Partial<Record<string, any>> = {}) {
  return {
    billingWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt-row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'evt-row-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    billingSubscription: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'sub-row-1' }),
      update: jest.fn().mockResolvedValue({ id: 'sub-row-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    billingInvoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'invoice-row-1' }),
      count: jest.fn().mockResolvedValue(0),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
    },
    tenantEntitlement: {
      upsert: jest.fn().mockResolvedValue({ id: 'ent-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(makeUser()),
      findFirst: jest.fn().mockResolvedValue(makeUser()),
    },
    ...overrides,
  } as unknown as jest.Mocked<PrismaService>;
}

function makeTenantsMock() {
  return {
    ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      source: 'persisted-default',
      role: 'admin',
      permissions: [],
      warnings: [],
    }),
  } as unknown as jest.Mocked<TenantsService>;
}

describe('BillingService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KAYPAL_BILLING_WEBHOOK_SECRET: 'test-secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes a signed subscription webhook into subscription and tenant entitlement snapshots', async () => {
    const prisma = makePrismaMock();
    const tenants = makeTenantsMock();
    const service = new BillingService(prisma, tenants);
    const payload: BillingWebhookPayload = {
      eventId: 'evt-1',
      eventType: 'customer.subscription.updated',
      userId: 'user-1',
      kaypalUserId: 'kaypal-1',
      subscription: {
        id: 'sub-1',
        customerId: 'cus-1',
        plan: 'advanced',
        status: 'active',
        currentPeriodEnd: '2099-08-01T00:00:00.000Z',
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': `sha256=${sign(payload)}`,
    });

    expect(result).toMatchObject({
      provider: 'kaypal',
      eventId: 'evt-1',
      processed: true,
      tenantId: 'tenant-1',
      plan: 'ADVANCED',
      commercialExecutionAllowed: true,
    });
    expect(tenants.ensureDefaultTenantForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlement: expect.objectContaining({
          source: 'kaypal-subscription',
          plan: 'ADVANCED',
          commercialExecutionAllowed: true,
        }),
      }),
    );
    expect(prisma.billingSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalSubscriptionId: {
            provider: 'kaypal',
            externalSubscriptionId: 'sub-1',
          },
        },
      }),
    );
    expect(prisma.tenantEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_source: {
            tenantId: 'tenant-1',
            source: 'kaypal-subscription',
          },
        },
        create: expect.objectContaining({
          plan: 'ADVANCED',
          commercialExecutionAllowed: true,
        }),
      }),
    );
  });

  it('rejects webhook payloads with an invalid signature', async () => {
    const service = new BillingService(makePrismaMock(), makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-1',
      eventType: 'customer.subscription.updated',
      subscription: { id: 'sub-1', plan: 'STANDARD', status: 'active' },
    };

    await expect(
      service.processWebhook('kaypal', payload, {
        'x-kaypal-signature': 'sha256=deadbeef',
      }),
    ).rejects.toThrow('签名校验失败');
  });

  it('skips an already processed event without rewriting subscription state', async () => {
    const prisma = makePrismaMock({
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-row-1',
          provider: 'kaypal',
          eventId: 'evt-1',
          eventType: 'customer.subscription.updated',
          status: 'processed',
          tenantId: 'tenant-1',
          externalSubscriptionId: 'sub-1',
        }),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
      },
    });
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-1',
      eventType: 'customer.subscription.updated',
      subscription: { id: 'sub-1', plan: 'STANDARD', status: 'active' },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result.duplicate).toBe(true);
    expect(prisma.billingSubscription.upsert).not.toHaveBeenCalled();
    expect(prisma.tenantEntitlement.upsert).not.toHaveBeenCalled();
  });

  it('does not grant commercial execution for an expired subscription period', async () => {
    const prisma = makePrismaMock();
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-expired-1',
      eventType: 'customer.subscription.updated',
      userId: 'user-1',
      subscription: {
        id: 'sub-expired-1',
        plan: 'ADVANCED',
        status: 'active',
        currentPeriodEnd: '2020-01-01T00:00:00.000Z',
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result.commercialExecutionAllowed).toBe(false);
    expect(prisma.tenantEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'expired',
          commercialExecutionAllowed: false,
        }),
      }),
    );
  });

  it('revokes commercial execution when a subscription is canceled', async () => {
    const prisma = makePrismaMock();
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-cancel-1',
      eventType: 'customer.subscription.deleted',
      userId: 'user-1',
      subscription: {
        id: 'sub-cancel-1',
        customerId: 'cus-1',
        plan: 'ADVANCED',
        status: 'canceled',
        currentPeriodEnd: '2099-08-01T00:00:00.000Z',
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result.commercialExecutionAllowed).toBe(false);
    expect(prisma.tenantEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'canceled',
          commercialExecutionAllowed: false,
        }),
      }),
    );
  });

  it('keeps the current subscription when an older webhook arrives later', async () => {
    const prisma = makePrismaMock({
      billingSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          provider: 'kaypal',
          externalSubscriptionId: 'sub-ordered-1',
          plan: 'ADVANCED',
          status: 'canceled',
          metadata: {
            billingEventOccurredAt: '2026-07-11T12:00:00.000Z',
          },
        }),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    });
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-older-active',
      eventType: 'customer.subscription.updated',
      created: '2026-07-10T12:00:00.000Z',
      subscription: {
        id: 'sub-ordered-1',
        plan: 'ADVANCED',
        status: 'active',
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result).toMatchObject({
      processed: false,
      status: 'ignored_out_of_order',
      tenantId: 'tenant-1',
    });
    expect(prisma.billingSubscription.upsert).not.toHaveBeenCalled();
    expect(prisma.tenantEntitlement.upsert).not.toHaveBeenCalled();
    expect(prisma.billingWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ignored_out_of_order' }),
      }),
    );
  });

  it('audits a paid invoice and keeps an existing commercial subscription active', async () => {
    const prisma = makePrismaMock({
      billingSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          provider: 'kaypal',
          externalSubscriptionId: 'sub-paid-1',
          plan: 'ADVANCED',
          status: 'active',
          currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2099-08-01T00:00:00.000Z'),
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sub-row-1' }),
        count: jest.fn().mockResolvedValue(1),
      },
    });
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-invoice-paid-1',
      eventType: 'invoice.paid',
      invoice: {
        id: 'inv-paid-1',
        customerId: 'cus-1',
        subscriptionId: 'sub-paid-1',
        status: 'paid',
        amountDue: 19900,
        amountPaid: 19900,
        currency: 'cny',
        metadata: { currentPeriodEnd: '2026-09-01T00:00:00.000Z' },
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result).toMatchObject({
      status: 'paid',
      plan: 'ADVANCED',
      commercialExecutionAllowed: true,
    });
    expect(prisma.billingInvoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          externalInvoiceId: 'inv-paid-1',
          status: 'paid',
          amountPaid: 19900,
          currency: 'CNY',
        }),
      }),
    );
    expect(prisma.billingSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
        }),
      }),
    );
    expect(prisma.tenantEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: 'active',
          commercialExecutionAllowed: true,
        }),
      }),
    );
  });

  it('audits a failed invoice and downgrades an existing commercial subscription to past_due', async () => {
    const prisma = makePrismaMock({
      billingSubscription: {
        findUnique: jest.fn().mockResolvedValue({
          tenantId: 'tenant-1',
          provider: 'kaypal',
          externalSubscriptionId: 'sub-failed-1',
          plan: 'ADVANCED',
          status: 'active',
          currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
          currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'sub-row-1' }),
        count: jest.fn().mockResolvedValue(0),
      },
      tenantEntitlement: {
        upsert: jest.fn().mockResolvedValue({ id: 'ent-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const service = new BillingService(prisma, makeTenantsMock());
    const payload: BillingWebhookPayload = {
      eventId: 'evt-invoice-failed-1',
      eventType: 'invoice.payment_failed',
      invoice: {
        id: 'inv-failed-1',
        customerId: 'cus-1',
        subscriptionId: 'sub-failed-1',
        amountDue: 19900,
        amountPaid: 0,
        currency: 'CNY',
      },
    };

    const result = await service.processWebhook('kaypal', payload, {
      'x-kaypal-signature': sign(payload),
    });

    expect(result).toMatchObject({
      status: 'failed',
      plan: 'ADVANCED',
      commercialExecutionAllowed: false,
    });
    expect(prisma.billingSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'past_due',
        }),
      }),
    );
    expect(prisma.tenantEntitlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'past_due',
          commercialExecutionAllowed: false,
        }),
      }),
    );
  });

  it('requires a webhook secret before accepting callbacks', async () => {
    delete process.env.KAYPAL_BILLING_WEBHOOK_SECRET;
    const service = new BillingService(makePrismaMock(), makeTenantsMock());

    await expect(
      service.processWebhook(
        'kaypal',
        {
          eventId: 'evt-1',
          eventType: 'customer.subscription.updated',
          subscription: { id: 'sub-1', plan: 'STANDARD', status: 'active' },
        },
        { 'x-kaypal-signature': 'sha256=anything' },
      ),
    ).rejects.toThrow('webhook secret 未配置');
  });

  it('keeps billing status available when optional audit tables are missing locally', async () => {
    const prisma = makePrismaMock({
      tenantEntitlement: {
        upsert: jest.fn().mockResolvedValue({ id: 'ent-1' }),
        findFirst: jest.fn().mockResolvedValue({
          source: 'kaypal-subscription',
          plan: 'ADVANCED',
          status: 'active',
          commercialExecutionAllowed: true,
          externalSubscriptionId: null,
          periodEnd: null,
        }),
      },
      billingSubscription: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest
          .fn()
          .mockRejectedValue(new Error('no such table: billing_subscriptions')),
        upsert: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      billingInvoice: {
        findFirst: jest
          .fn()
          .mockRejectedValue(new Error('no such table: billing_invoices')),
        upsert: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    const user = { ...makeUser(), kaypalPlan: 'ADVANCED' };
    const service = new BillingService(prisma, makeTenantsMock());

    const status = await service.getStatusForUser(user);

    expect(status.entitlement).toMatchObject({
      plan: 'ADVANCED',
      status: 'active',
      commercialExecutionAllowed: true,
    });
    expect(status.latestSubscription).toBeNull();
    expect(status.latestInvoice).toBeNull();
  });
});
