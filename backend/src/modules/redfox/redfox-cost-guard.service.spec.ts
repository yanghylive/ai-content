import { HttpException } from '@nestjs/common';
import { RedfoxCostGuardService } from './redfox-cost-guard.service';
import type { RedfoxEffectiveConnection, RedfoxScope } from './redfox.types';

const scope: RedfoxScope = {
  key: 'tenant-1:user-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
};

function makeConnection(
  overrides: Partial<RedfoxEffectiveConnection> = {},
): RedfoxEffectiveConnection {
  return {
    baseUrl: 'https://redfox.hk',
    apiKey: 'ak_test',
    apiKeySource: 'env',
    timeoutMs: 30000,
    enabled: true,
    dailyUserLimit: 0,
    dailyTenantLimit: 0,
    highCostConfirmThreshold: 0,
    status: 'connected',
    lastTestAt: null,
    lastError: null,
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe('RedfoxCostGuardService', () => {
  it('blocks when the user daily RedFox call limit is reached', async () => {
    const callLogs = {
      countTodayForUser: jest.fn(async () => 2),
      countTodayForTenant: jest.fn(async () => 2),
    };
    const guard = new RedfoxCostGuardService(callLogs as any);

    await expect(
      guard.assertWithinLimits(scope, makeConnection({ dailyUserLimit: 2 }), 1),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('allows high-cost calls without a separate confirmation phrase', async () => {
    const callLogs = {
      countTodayForUser: jest.fn(async () => 1),
      countTodayForTenant: jest.fn(async () => 1),
    };
    const guard = new RedfoxCostGuardService(callLogs as any);

    await expect(
      guard.assertWithinLimits(
        scope,
        makeConnection({ highCostConfirmThreshold: 2 }),
        2,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        highCost: true,
        highCostConfirmThreshold: 2,
      }),
    );
  });

  it('still reports high-cost metadata when callers pass legacy confirmation options', async () => {
    const callLogs = {
      countTodayForUser: jest.fn(async () => 1),
      countTodayForTenant: jest.fn(async () => 1),
    };
    const guard = new RedfoxCostGuardService(callLogs as any);

    await expect(
      guard.assertWithinLimits(
        scope,
        makeConnection({ highCostConfirmThreshold: 2 }),
        2,
        { confirmHighCost: true },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        highCost: true,
        highCostConfirmThreshold: 2,
      }),
    );
  });
});
