import { EntitlementsService } from './entitlements.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    name: 'Tester',
    status: 'active',
    lastLoginAt: null,
    kaypalUserId: 'kaypal-1',
    kaypalPlan: 'ADVANCED',
    kaypalPlanExpired: false,
    kaypalRole: null,
    kaypalPlatformRole: null,
    kaypalPermissionNames: ['crm:read'],
    role: 'admin',
    commercialExecutionAllowed: false,
    planMode: 'trial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('EntitlementsService', () => {
  const service = new EntitlementsService();

  it('does not treat cached Kaypal plan metadata as a commercial execution grant', () => {
    const entitlement = service.getEffectiveEntitlement(makeUser());

    expect(entitlement.source).toBe('kaypal-subscription');
    expect(entitlement.plan).toBe('ADVANCED');
    expect(entitlement.cloudSubscriptionActive).toBe(true);
    expect(entitlement.commercialExecutionAllowed).toBe(false);
    expect(entitlement.planMode).toBe('trial');
    expect(entitlement.features).toContain('crm');
    expect(entitlement.features).not.toContain('commercial-execution');
    expect(entitlement.blockers).toContain('missing-commercial-entitlement');
    expect(entitlement.tenant.tenantId).toBe('user:user-1');
  });

  it('falls back to local commercial override but keeps it visible as a warning', () => {
    const entitlement = service.getEffectiveEntitlement(
      makeUser({
        kaypalUserId: null,
        kaypalPlan: 'FREE',
        commercialExecutionAllowed: true,
        planMode: 'commercial',
      }),
    );

    expect(entitlement.source).toBe('local-commercial-override');
    expect(entitlement.commercialExecutionAllowed).toBe(true);
    expect(entitlement.warnings).toContain(
      'commercial-access-uses-local-override',
    );
  });

  it('keeps expired cloud plans blocked even when the plan name is high', () => {
    const result = service.meetsAnyPlan(
      makeUser({ kaypalPlan: 'FLAGSHIP', kaypalPlanExpired: true }),
      ['STANDARD'],
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.entitlement.blockers).toContain('kaypal-plan-expired');
  });

  it('does not pass plan gates with a cached high plan but no commercial entitlement', () => {
    const result = service.meetsAnyPlan(
      makeUser({
        kaypalUserId: null,
        kaypalPlan: 'ADVANCED',
        commercialExecutionAllowed: false,
        planMode: 'trial',
      }),
      ['STANDARD'],
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-commercial-entitlement');
    expect(result.entitlement.blockers).toContain(
      'missing-commercial-entitlement',
    );
  });

  it('persists request entitlement into the default tenant when tenant service is available', async () => {
    const tenants = {
      ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        source: 'persisted-default',
        role: 'admin',
        permissions: ['crm:read'],
        warnings: [],
      }),
      findCommercialEntitlementForTenant: jest.fn().mockResolvedValue(null),
    };
    const serviceWithTenants = new EntitlementsService(tenants as any);

    const entitlement =
      await serviceWithTenants.getEffectiveEntitlementForUser(makeUser());

    expect(entitlement.tenant).toEqual({
      tenantId: 'tenant-1',
      source: 'persisted-default',
      role: 'admin',
      permissions: ['crm:read'],
      warnings: [],
    });
    expect(entitlement.warnings).not.toContain(
      'tenant-model-not-yet-persisted',
    );
    expect(tenants.ensureDefaultTenantForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        entitlement: expect.objectContaining({
          source: 'trial',
          plan: 'ADVANCED',
          commercialExecutionAllowed: false,
        }),
      }),
    );
  });

  it('uses active tenant billing entitlement when session metadata has not refreshed yet', async () => {
    const tenants = {
      ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        source: 'persisted-default',
        role: 'admin',
        permissions: ['crm:read'],
        warnings: [],
      }),
      findCommercialEntitlementForTenant: jest.fn().mockResolvedValue({
        id: 'ent-1',
        tenantId: 'tenant-1',
        source: 'kaypal-subscription',
        plan: 'STANDARD',
        status: 'active',
        features: ['crm'],
        commercialExecutionAllowed: true,
        externalSubscriptionId: 'sub-1',
        periodStart: new Date('2026-07-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-01T00:00:00.000Z'),
        metadata: { provider: 'kaypal' },
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    };
    const serviceWithTenants = new EntitlementsService(tenants as any);

    const entitlement = await serviceWithTenants.getEffectiveEntitlementForUser(
      makeUser({
        kaypalUserId: null,
        kaypalPlan: 'FREE',
        commercialExecutionAllowed: false,
        planMode: 'trial',
      }),
    );

    expect(entitlement.source).toBe('kaypal-subscription');
    expect(entitlement.plan).toBe('STANDARD');
    expect(entitlement.commercialExecutionAllowed).toBe(true);
    expect(entitlement.cloudSubscriptionActive).toBe(true);
    expect(entitlement.blockers).not.toContain(
      'missing-commercial-entitlement',
    );
    expect(entitlement.warnings).toContain(
      'entitlement-loaded-from-tenant-billing',
    );
  });

  it('revokes a cached session capability when tenant billing is canceled', async () => {
    const tenants = {
      ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        source: 'persisted-default',
        role: 'admin',
        permissions: [],
        warnings: [],
      }),
      findCommercialEntitlementForTenant: jest.fn().mockResolvedValue({
        id: 'ent-canceled',
        tenantId: 'tenant-1',
        source: 'kaypal-subscription',
        plan: 'ADVANCED',
        status: 'canceled',
        features: ['crm', 'growth', 'commercial-execution'],
        commercialExecutionAllowed: false,
        externalSubscriptionId: 'sub-canceled',
        periodStart: null,
        periodEnd: new Date('2026-08-01T00:00:00.000Z'),
        metadata: {},
        updatedAt: new Date('2026-07-11T00:00:00.000Z'),
      }),
    };
    const serviceWithTenants = new EntitlementsService(tenants as any);

    const entitlement = await serviceWithTenants.getEffectiveEntitlementForUser(
      makeUser({ kaypalPlan: 'ADVANCED', kaypalPlanExpired: false }),
    );

    expect(entitlement.plan).toBe('FREE');
    expect(entitlement.cloudSubscriptionActive).toBe(false);
    expect(entitlement.commercialExecutionAllowed).toBe(false);
    expect(entitlement.features).not.toContain('commercial-execution');
    expect(entitlement.blockers).toContain('missing-commercial-entitlement');
    expect(entitlement.warnings).toContain(
      'tenant-billing-entitlement-inactive',
    );
  });
});
