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
  return new EntitlementsService(
    {} as any,
    {
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
        periodEnd: new Date('2099-08-01T00:00:00.000Z'),
        metadata: { provider: 'kaypal' },
        updatedAt: new Date('2026-07-12T00:00:00.000Z'),
      }),
    } as any,
  );
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

  // P1（P5 门禁 2026-08-22）：本地套餐旁路必须绑定运行环境，
  // 生产配置误继承时不得绕过授权检查
  describe('local plan bypass environment binding', () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it('bypass 开关 + 开发环境 → 放行（本地调试）', async () => {
      process.env.NODE_ENV = 'development';
      const guard = makeGuard(['FLAGSHIP'], true);
      await expect(
        guard.canActivate(makeContext(makeUser({ kaypalPlan: 'FREE' }))),
      ).resolves.toBe(true);
    });

    it('bypass 开关 + 生产环境 → 不放行（走真实授权检查）', async () => {
      process.env.NODE_ENV = 'production';
      const guard = makeGuard(['STANDARD'], true);
      // FREE 无商用授权 → 即使开了旁路也必须被拦
      await expect(
        guard.canActivate(
          makeContext(
            makeUser({
              kaypalUserId: null,
              kaypalPlan: 'FREE',
              commercialExecutionAllowed: false,
              planMode: 'trial',
            }),
          ),
        ),
      ).rejects.toThrow('缺少有效商用授权');
    });

    it('bypass 开关 + 空 NODE_ENV → 视为生产，不放行', async () => {
      delete process.env.NODE_ENV;
      const guard = makeGuard(['STANDARD'], true);
      await expect(
        guard.canActivate(
          makeContext(
            makeUser({
              kaypalUserId: null,
              kaypalPlan: 'FREE',
              commercialExecutionAllowed: false,
              planMode: 'trial',
            }),
          ),
        ),
      ).rejects.toThrow('缺少有效商用授权');
    });
  });
});
