import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PlanGuard } from './plan.guard';
import { KAYPAL_PLANS_KEY } from './roles.decorator';
import { EntitlementsService } from '../entitlements/entitlements.service';
import type { AuthenticatedUser } from './auth.types';

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
    kaypalPermissionNames: [],
    role: 'operator',
    commercialExecutionAllowed: false,
    planMode: 'trial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makeContext(authUser: AuthenticatedUser) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ authUser }),
    }),
  } as any;
}

function makeGuard(
  requiredPlans: string[],
  bypass = false,
  entitlements = new EntitlementsService(),
) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === KAYPAL_PLANS_KEY ? requiredPlans : undefined,
    ),
  } as unknown as Reflector;
  const config = {
    get: jest.fn(() => (bypass ? 'true' : undefined)),
  } as unknown as ConfigService;
  return new PlanGuard(reflector, config, entitlements);
}

function makePersistedCloudEntitlements(plan = 'ADVANCED') {
  return new EntitlementsService({
    ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      source: 'persisted-default',
      role: 'operator',
      permissions: [],
      warnings: [],
    }),
    findCommercialEntitlementForTenant: jest.fn().mockResolvedValue({
      id: 'entitlement-1',
      tenantId: 'tenant-1',
      source: 'kaypal-subscription',
      plan,
      status: 'active',
      features: ['crm', 'growth', 'commercial-execution'],
      commercialExecutionAllowed: true,
      externalSubscriptionId: 'subscription-1',
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      metadata: { provider: 'kaypal' },
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    }),
  } as any);
}

describe('PlanGuard', () => {
  it('allows users whose persisted cloud entitlement satisfies the requirement', async () => {
    const guard = makeGuard(
      ['STANDARD'],
      false,
      makePersistedCloudEntitlements(),
    );

    await expect(guard.canActivate(makeContext(makeUser()))).resolves.toBe(
      true,
    );
  });

  it('blocks expired cloud plans even when the plan name is high', async () => {
    const guard = makeGuard(['STANDARD']);

    await expect(
      guard.canActivate(
        makeContext(
          makeUser({ kaypalPlan: 'FLAGSHIP', kaypalPlanExpired: true }),
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('blocks high plan names when the request has no effective commercial entitlement', async () => {
    const guard = makeGuard(['STANDARD']);

    await expect(
      guard.canActivate(
        makeContext(
          makeUser({
            kaypalUserId: null,
            kaypalPlan: 'ADVANCED',
            commercialExecutionAllowed: false,
            planMode: 'trial',
          }),
        ),
      ),
    ).rejects.toThrow('缺少有效商用授权');
  });

  it('does not treat local commercial override as a paid cloud plan', async () => {
    const guard = makeGuard(['STANDARD']);

    await expect(
      guard.canActivate(
        makeContext(
          makeUser({
            kaypalUserId: null,
            kaypalPlan: 'FREE',
            commercialExecutionAllowed: true,
            planMode: 'commercial',
          }),
        ),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
