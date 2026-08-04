import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PlanGuard } from '../auth/plan.guard';
import { KAYPAL_PLANS_KEY } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CommercialReadinessController } from './commercial-readiness.controller';
import { COMMERCIAL_BACKUP_REQUIRED_PLANS } from './commercial-readiness.constants';

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
    kaypalPlan: 'STANDARD',
    kaypalPlanExpired: false,
    kaypalRole: null,
    kaypalPlatformRole: null,
    kaypalPermissionNames: [],
    role: 'admin',
    commercialExecutionAllowed: false,
    planMode: 'trial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makeBackupExportContext(authUser: AuthenticatedUser) {
  return {
    getHandler: () => CommercialReadinessController.prototype.exportLocalBackup,
    getClass: () => CommercialReadinessController,
    switchToHttp: () => ({
      getRequest: () => ({ authUser }),
    }),
  } as any;
}

function makeGuard(entitlements = new EntitlementsService()) {
  const config = {
    get: jest.fn(() => undefined),
  } as unknown as ConfigService;
  return new PlanGuard(new Reflector(), config, entitlements);
}

function makePersistedCloudEntitlements(plan = 'STANDARD') {
  return new EntitlementsService({
    ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
      tenantId: 'tenant-1',
      source: 'persisted-default',
      role: 'admin',
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
      periodEnd: new Date('2099-08-01T00:00:00.000Z'),
      metadata: { provider: 'kaypal' },
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    }),
  } as any);
}

describe('CommercialReadinessController entitlement gates', () => {
  it('keeps summary readable while requiring STANDARD+ for backup export', () => {
    const reflector = new Reflector();

    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.getSummaryAlias,
        CommercialReadinessController,
      ]),
    ).toBeUndefined();
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.exportLocalBackup,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.getBackupStatus,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.runBackupRestoreDryRun,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.runBackupIsolatedRestoreDryRun,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.getBackupSchedulerStatus,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
    expect(
      reflector.getAllAndOverride<string[]>(KAYPAL_PLANS_KEY, [
        CommercialReadinessController.prototype.runBackupSchedulerOnce,
        CommercialReadinessController,
      ]),
    ).toEqual([...COMMERCIAL_BACKUP_REQUIRED_PLANS]);
  });

  it('blocks backup export without an effective commercial entitlement', async () => {
    await expect(
      makeGuard().canActivate(
        makeBackupExportContext(
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

  it('allows backup export for an active STANDARD cloud subscription', async () => {
    await expect(
      makeGuard(makePersistedCloudEntitlements()).canActivate(
        makeBackupExportContext(makeUser()),
      ),
    ).resolves.toBe(true);
  });
});
