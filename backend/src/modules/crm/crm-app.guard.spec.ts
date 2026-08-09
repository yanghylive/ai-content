import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AppMarketService } from '../app-market/app-market.service';
import { CrmAppGuard } from './crm-app.guard';

function makeContext(authUser?: { id?: string }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ authUser }),
    }),
  } as unknown as ExecutionContext;
}

function makeAppMarketMock() {
  return {
    assertCrmInstalled: jest.fn(),
  } as unknown as jest.Mocked<AppMarketService>;
}

describe('CrmAppGuard', () => {
  it('blocks CRM access before login instead of falling back to local-user', async () => {
    const appMarket = makeAppMarketMock();
    const guard = new CrmAppGuard(appMarket);

    await expect(guard.canActivate(makeContext())).rejects.toThrow(
      UnauthorizedException,
    );
    expect(appMarket.assertCrmInstalled).not.toHaveBeenCalled();
  });

  it('blocks CRM access when the app is not installed', async () => {
    const appMarket = makeAppMarketMock();
    appMarket.assertCrmInstalled.mockRejectedValue(
      new ForbiddenException('CRM 客户管理应用未安装'),
    );
    const guard = new CrmAppGuard(appMarket);

    await expect(
      guard.canActivate(makeContext({ id: 'user-1' })),
    ).rejects.toThrow(ForbiddenException);
    expect(appMarket.assertCrmInstalled).toHaveBeenCalledWith({
      id: 'user-1',
    });
  });

  it('allows CRM access after the app is installed', async () => {
    const appMarket = makeAppMarketMock();
    appMarket.assertCrmInstalled.mockResolvedValue({
      appKey: 'crm',
      tenantId: 'tenant-1',
      actorUserId: 'user-1',
      scope: 'tenant',
      name: 'CRM 客户管理',
      description: '',
      priceLabel: '',
      purchaseStatus: 'purchased',
      installStatus: 'installed',
      purchased: true,
      installed: true,
      commercialEntitled: true,
      commercialEntitlementRequired: true,
      entitlementSource: 'kaypal-subscription',
      entitlementPlan: 'ADVANCED',
      commercialBlockers: [],
      commercialWarnings: [],
      access: {
        state: 'installed',
        primaryAction: 'open',
        allowedActions: ['open', 'uninstall'],
        nextActionLabel: 'CRM 已购买并安装，可进入客户管理',
        blockers: [],
        warnings: [],
        requiresCommercialEntitlement: true,
        requiresPurchase: false,
        requiresInstall: false,
        proofHash:
          '8c07174de8a9ec3d615dbe6ba9a4208957d3f8d7d25e5d4e986d3f7f2f7b4b1d',
      },
      canPurchase: false,
      canInstall: false,
      purchasedAt: null,
      installedAt: null,
      uninstalledAt: null,
    });
    const guard = new CrmAppGuard(appMarket);

    await expect(
      guard.canActivate(makeContext({ id: 'user-1' })),
    ).resolves.toBe(true);
  });
});
