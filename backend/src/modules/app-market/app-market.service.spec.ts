import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppMarketService } from './app-market.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthRequestContextService } from '../../common/auth-request-context.service';

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
    role: 'admin',
    commercialExecutionAllowed: true,
    planMode: 'commercial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    appInstallState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeEntitlementsMock(
  tenantId = 'tenant-1',
  overrides: Record<string, unknown> = {},
) {
  return {
    getEffectiveEntitlementForUser: jest.fn().mockResolvedValue({
      userId: 'user-1',
      source: 'kaypal-subscription',
      plan: 'ADVANCED',
      planExpired: false,
      kaypalUserId: 'kaypal-1',
      cloudSubscriptionActive: true,
      localCommercialAllowed: false,
      commercialExecutionAllowed: true,
      planMode: 'commercial',
      role: 'admin',
      tenant: {
        tenantId,
        source: 'persisted-default',
        role: 'admin',
        permissions: [],
        warnings: [],
      },
      features: [
        'auth',
        'app-market',
        'crm',
        'growth',
        'local-engine',
        'commercial-execution',
      ],
      blockers: [],
      warnings: [],
      evidence: {},
      ...overrides,
    }),
  } as unknown as jest.Mocked<EntitlementsService>;
}

describe('AppMarketService', () => {
  it('writes CRM purchase state against tenant scope when an authenticated user is provided', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    prisma.appInstallState.upsert.mockResolvedValue({ id: 'state-1' } as any);
    prisma.appInstallState.findUnique.mockResolvedValueOnce({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'not_installed',
      purchasedAt: new Date('2026-06-25T00:00:00.000Z'),
      installedAt: null,
      uninstalledAt: null,
    } as any);
    const service = new AppMarketService(prisma, entitlements);

    const state = await service.purchaseCrm(makeUser());

    expect(prisma.appInstallState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_appKey: {
            tenantId: 'tenant-1',
            appKey: 'crm',
          },
        },
      }),
    );
    expect(state.scope).toBe('tenant');
    expect(state.tenantId).toBe('tenant-1');
    expect(state.purchased).toBe(true);
    expect(state.commercialEntitled).toBe(true);
    expect(state.access).toEqual(
      expect.objectContaining({
        state: 'not_installed',
        primaryAction: 'install',
        allowedActions: ['install'],
        requiresPurchase: false,
        requiresInstall: true,
        proofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('blocks CRM purchase when the authenticated user lacks commercial entitlement', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock('tenant-1', {
      source: 'trial',
      plan: 'FREE',
      kaypalUserId: null,
      cloudSubscriptionActive: false,
      localCommercialAllowed: false,
      commercialExecutionAllowed: false,
      planMode: 'trial',
      features: ['auth', 'app-market'],
      blockers: ['missing-commercial-entitlement'],
    });
    const service = new AppMarketService(prisma, entitlements);

    await expect(service.purchaseCrm(makeUser())).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.appInstallState.upsert).not.toHaveBeenCalled();
  });

  it('allows a local commercial override to purchase CRM for desktop pilots', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock('tenant-1', {
      source: 'local-commercial-override',
      plan: 'FREE',
      kaypalUserId: null,
      cloudSubscriptionActive: false,
      localCommercialAllowed: true,
      commercialExecutionAllowed: true,
      features: ['auth', 'app-market', 'commercial-execution'],
      warnings: ['commercial-access-uses-local-override'],
    });
    prisma.appInstallState.upsert.mockResolvedValue({ id: 'state-1' } as any);
    prisma.appInstallState.findUnique.mockResolvedValueOnce({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'not_installed',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    } as any);
    const service = new AppMarketService(prisma, entitlements);

    const state = await service.purchaseCrm(makeUser());

    expect(state.commercialEntitled).toBe(true);
    expect(state.entitlementSource).toBe('local-commercial-override');
    expect(prisma.appInstallState.upsert).toHaveBeenCalled();
  });

  it('lazily backfills tenant scope onto an existing legacy user record', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    const legacyState = {
      id: 'legacy-1',
      userId: 'user-1',
      tenantId: null,
      actorUserId: null,
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    };
    prisma.appInstallState.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacyState as any);
    prisma.appInstallState.update.mockResolvedValue({
      ...legacyState,
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
    } as any);
    const service = new AppMarketService(prisma, entitlements);

    const state = await service.getCrmState(makeUser());

    expect(prisma.appInstallState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'legacy-1' },
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          actorUserId: 'user-1',
        }),
      }),
    );
    expect(state.scope).toBe('tenant');
    expect(state.installed).toBe(true);
  });

  it('keeps legacy user-id calls working for background CRM capture paths', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'legacy-1',
      userId: 'user-1',
      tenantId: null,
      actorUserId: null,
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    } as any);
    const service = new AppMarketService(prisma, entitlements);

    const state = await service.assertCrmInstalled('user-1');

    expect(state.scope).toBe('legacy-user');
    expect(state.installed).toBe(true);
    expect(state.commercialEntitled).toBe(true);
    expect(entitlements.getEffectiveEntitlementForUser).not.toHaveBeenCalled();
  });

  it('blocks installing CRM before purchase', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(prisma, makeEntitlementsMock());
    prisma.appInstallState.findUnique.mockResolvedValue(null);

    await expect(service.installCrm(makeUser())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('returns an open access policy after purchase and install are complete', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(prisma, makeEntitlementsMock());
    prisma.appInstallState.findUnique
      .mockResolvedValueOnce({
        id: 'state-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        appKey: 'crm',
        purchaseStatus: 'purchased',
        installStatus: 'not_installed',
        purchasedAt: null,
        installedAt: null,
        uninstalledAt: null,
      } as any)
      .mockResolvedValueOnce({
        id: 'state-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        appKey: 'crm',
        purchaseStatus: 'purchased',
        installStatus: 'installed',
        purchasedAt: null,
        installedAt: new Date('2026-06-25T00:00:00.000Z'),
        uninstalledAt: null,
      } as any);
    prisma.appInstallState.update.mockResolvedValue({ id: 'state-1' } as any);

    const state = await service.installCrm(makeUser());

    expect(prisma.appInstallState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'state-1' },
        data: expect.objectContaining({
          installStatus: 'installed',
          entitlementSnapshot: expect.objectContaining({
            accessPolicy: expect.objectContaining({
              state: 'installed',
              primaryAction: 'open',
            }),
          }),
        }),
      }),
    );
    expect(state.installed).toBe(true);
    expect(state.access).toEqual(
      expect.objectContaining({
        state: 'installed',
        primaryAction: 'open',
        allowedActions: ['open', 'uninstall'],
        blockers: [],
      }),
    );
  });

  it('allows an installed CRM app for an active cloud plan without granting external execution', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-1', {
        source: 'kaypal-subscription',
        plan: 'ADVANCED',
        planExpired: false,
        cloudSubscriptionActive: true,
        localCommercialAllowed: false,
        commercialExecutionAllowed: false,
        planMode: 'trial',
        features: ['auth', 'app-market', 'crm'],
        blockers: ['missing-commercial-entitlement'],
      }),
    );
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: new Date('2026-07-21T00:00:00.000Z'),
      uninstalledAt: null,
    } as any);

    const state = await service.assertCrmInstalled(
      makeUser({
        commercialExecutionAllowed: false,
        planMode: 'trial',
      }),
    );

    expect(prisma.appInstallState.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_appKey: { tenantId: 'tenant-1', appKey: 'crm' },
      },
    });
    expect(state.commercialEntitled).toBe(true);
    expect(state.commercialBlockers).not.toContain(
      'missing-commercial-entitlement',
    );
    expect(state.access).toEqual(
      expect.objectContaining({
        state: 'installed',
        allowedActions: ['open', 'uninstall'],
      }),
    );
  });

  it('checks CRM installation in the explicitly selected active tenant', async () => {
    const context = new AuthRequestContextService();
    const prisma = makePrismaMock() as any;
    prisma.tenantMember = {
      findMany: jest.fn().mockResolvedValue([{ tenantId: 'tenant-team' }]),
    };
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-team',
      userId: 'user-1',
      tenantId: 'tenant-team',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: new Date('2026-07-22T00:00:00.000Z'),
      uninstalledAt: null,
    });
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-personal'),
      context,
    );

    const state = await context.run(
      {
        requestedTenantId: 'tenant-team',
        user: { id: 'user-1' },
      },
      () => service.assertCrmInstalled(makeUser()),
    );

    expect(state.tenantId).toBe('tenant-team');
    expect(prisma.appInstallState.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_appKey: { tenantId: 'tenant-team', appKey: 'crm' },
      },
    });
  });

  it('blocks CRM access when not installed', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-1', {
        cloudSubscriptionActive: true,
        commercialExecutionAllowed: false,
        features: ['auth', 'app-market', 'crm'],
        blockers: ['missing-commercial-entitlement'],
      }),
    );
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'not_installed',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    } as any);

    await expect(service.assertCrmInstalled(makeUser())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_app_access_blocked',
        access: expect.objectContaining({
          state: 'not_installed',
          primaryAction: 'install',
        }),
      }),
    });
  });

  it('keeps an explicitly uninstalled CRM app blocked for an active cloud plan', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-1', {
        cloudSubscriptionActive: true,
        commercialExecutionAllowed: false,
        features: ['auth', 'app-market', 'crm'],
        blockers: ['missing-commercial-entitlement'],
      }),
    );
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'uninstalled',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: new Date('2026-07-21T00:00:00.000Z'),
    } as any);

    await expect(service.assertCrmInstalled(makeUser())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_app_access_blocked',
        access: expect.objectContaining({
          state: 'uninstalled',
          primaryAction: 'install',
          allowedActions: ['install'],
        }),
      }),
    });
  });

  it('blocks CRM access when the app is installed but commercial entitlement is gone', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-1', {
        source: 'trial',
        plan: 'FREE',
        kaypalUserId: null,
        cloudSubscriptionActive: false,
        localCommercialAllowed: false,
        commercialExecutionAllowed: false,
        planMode: 'trial',
        features: ['auth', 'app-market'],
        blockers: ['missing-commercial-entitlement'],
      }),
    );
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    } as any);

    await expect(service.assertCrmInstalled(makeUser())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_commercial_entitlement_required',
        access: expect.objectContaining({
          state: 'commercial_blocked',
          primaryAction: 'contact_sales',
        }),
      }),
    });
  });

  it('blocks an installed CRM app when the cached cloud plan is expired', async () => {
    const prisma = makePrismaMock();
    const service = new AppMarketService(
      prisma,
      makeEntitlementsMock('tenant-1', {
        source: 'trial',
        plan: 'ADVANCED',
        planExpired: true,
        cloudSubscriptionActive: false,
        localCommercialAllowed: false,
        commercialExecutionAllowed: false,
        planMode: 'trial',
        features: ['auth', 'app-market', 'crm'],
        blockers: ['missing-commercial-entitlement', 'kaypal-plan-expired'],
      }),
    );
    prisma.appInstallState.findUnique.mockResolvedValue({
      id: 'state-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      appKey: 'crm',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchasedAt: null,
      installedAt: new Date('2026-07-21T00:00:00.000Z'),
      uninstalledAt: null,
    } as any);

    await expect(service.assertCrmInstalled(makeUser())).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'crm_commercial_entitlement_required',
        access: expect.objectContaining({
          state: 'commercial_blocked',
          blockers: expect.arrayContaining(['kaypal-plan-expired']),
        }),
      }),
    });
  });

  it('listApps 返回应用目录（至少含 CRM 条目）', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    prisma.appInstallState.findUnique.mockResolvedValue(null);
    const service = new AppMarketService(prisma, entitlements);

    const apps = await service.listApps(makeUser());

    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThanOrEqual(1);
    const crm = apps.find((app) => app.appKey === 'crm');
    expect(crm).toBeDefined();
    expect(crm?.name).toBe('CRM 客户管理');
  });

  it('getAppState 按 appKey 返回单个应用状态（目录驱动）', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    prisma.appInstallState.findUnique.mockResolvedValue(null);
    const service = new AppMarketService(prisma, entitlements);

    const state = await service.getAppState(makeUser(), 'crm');

    expect(state.appKey).toBe('crm');
    expect(state.name).toBe('CRM 客户管理');
    expect(state.access.state).toBe('not_purchased');
  });

  it('getAppState 未知应用抛 400', async () => {
    const prisma = makePrismaMock();
    const entitlements = makeEntitlementsMock();
    const service = new AppMarketService(prisma, entitlements);

    await expect(
      service.getAppState(makeUser(), 'nonexistent'),
    ).rejects.toThrow(BadRequestException);
  });
});
