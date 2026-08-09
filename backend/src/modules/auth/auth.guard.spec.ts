import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { hashSessionToken } from './auth.utils';
import { EntitlementsService } from '../entitlements/entitlements.service';

describe('AuthGuard', () => {
  const createExecutionContext = (request: Record<string, unknown>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  it('reuses a concurrently refreshed Kaypal desktop token instead of clearing the session', async () => {
    const sessionToken = 'session-token';
    const sessionId = 'session-1';
    const userId = 'user-1';
    const oldMetadata = {
      kaypalDesktopAccessToken: 'old-access-token',
      kaypalDesktopRefreshToken: 'old-refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      kaypalDesktopDeviceId: 'device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalMetadataSyncedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    const refreshedMetadata = {
      ...oldMetadata,
      kaypalDesktopAccessToken: 'new-access-token',
      kaypalDesktopRefreshToken: 'new-refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + 60 * 60_000,
      ).toISOString(),
      kaypalMetadataSyncedAt: new Date().toISOString(),
    };

    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: oldMetadata,
          user: {
            id: userId,
            username: 'kaypal_user',
            email: 'kaypal@example.com',
            name: 'Kaypal User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-1',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn().mockResolvedValue({
          metadata: refreshedMetadata,
        }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest
        .fn()
        .mockRejectedValue(new Error('rotated')),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/local-engine/health',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      authUser: {
        kaypalDesktopAccessToken: 'new-access-token',
        kaypalDesktopRefreshToken: 'new-refresh-token',
        kaypalPlan: 'ADVANCED',
      },
    });
    expect(kaypalClient.getUserFromDesktopToken).not.toHaveBeenCalled();
    expect(prisma.userSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.not.objectContaining({
            kaypalDesktopAccessToken: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('uses cached Kaypal entitlement metadata for local requests even when the cloud sync timestamp is stale', async () => {
    const sessionToken = 'session-token';
    const sessionId = 'session-1';
    const userId = 'user-1';
    const cachedMetadata = {
      kaypalDesktopAccessToken: 'access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + 60 * 60_000,
      ).toISOString(),
      kaypalDesktopDeviceId: 'device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalMetadataSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };

    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: cachedMetadata,
          user: {
            id: userId,
            username: 'kaypal_user',
            email: 'kaypal@example.com',
            name: 'Kaypal User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-1',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest.fn(),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/local-engine/runtime/start',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      authUser: {
        kaypalDesktopAccessToken: 'access-token',
        kaypalDesktopRefreshToken: 'refresh-token',
        kaypalPlan: 'ADVANCED',
      },
    });
    expect(kaypalClient.refreshDesktopAuthToken).not.toHaveBeenCalled();
    expect(kaypalClient.getUserFromDesktopToken).not.toHaveBeenCalled();
  });

  it('falls back to cached Kaypal metadata when token refresh is slow', async () => {
    jest.useFakeTimers();
    const sessionToken = 'session-token';
    const sessionId = 'session-1';
    const userId = 'user-1';
    const cachedMetadata = {
      kaypalDesktopAccessToken: 'expired-access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      kaypalDesktopDeviceId: 'device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
      kaypalMetadataSyncedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: sessionId,
          userId,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: cachedMetadata,
          user: {
            id: userId,
            username: 'kaypal_user',
            email: 'kaypal@example.com',
            name: 'Kaypal User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-1',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest.fn(() => new Promise(() => undefined)),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/local-engine/tasks',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    const activation = guard.canActivate(createExecutionContext(request));
    await jest.advanceTimersByTimeAsync(2500);

    await expect(activation).resolves.toBe(true);
    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
    });
    expect(kaypalClient.refreshDesktopAuthToken).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('falls back to cached Kaypal metadata when token refresh fails fast', async () => {
    const sessionToken = 'session-token';
    const cachedMetadata = {
      kaypalDesktopAccessToken: 'expired-access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      kaypalDesktopDeviceId: 'device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: cachedMetadata,
          user: {
            id: 'user-1',
            username: 'kaypal_user',
            email: 'kaypal@example.com',
            name: 'Kaypal User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-1',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest
        .fn()
        .mockRejectedValue(new Error('expired')),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/topics',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
      authUser: {
        kaypalDesktopAccessToken: 'expired-access-token',
      },
    });
    expect(prisma.userSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.not.objectContaining({
            kaypalSubscriptionPlan: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('uses cached Kaypal entitlement metadata when legacy token fields are expired', async () => {
    const sessionToken = 'session-token';
    const cachedMetadata = {
      kaypalAccessToken: 'expired-access-token',
      kaypalRefreshToken: 'refresh-token',
      kaypalTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: cachedMetadata,
          user: {
            id: 'user-1',
            username: 'kaypal_user',
            email: 'kaypal@example.com',
            name: 'Kaypal User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-1',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest
        .fn()
        .mockRejectedValue(new Error('expired')),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/topics',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
      authUser: {
        kaypalDesktopAccessToken: 'expired-access-token',
      },
    });
    expect(prisma.userSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.not.objectContaining({
            kaypalSubscriptionPlan: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('allows local-only sessions without a Kaypal desktop token', async () => {
    const sessionToken = 'session-token';
    const localMetadata = {
      localOnly: true,
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata: localMetadata,
          user: {
            id: 'user-1',
            username: 'local_user',
            email: 'local@example.com',
            name: 'Local User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'local-user-1',
            role: 'admin',
            commercialExecutionAllowed: true,
            planMode: 'commercial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest.fn(),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/topics',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      kaypalPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
      authUser: {
        kaypalLocalOnly: true,
      },
    });
    expect(kaypalClient.refreshDesktopAuthToken).not.toHaveBeenCalled();
  });

  it('uses Kaypal user id from cloud metadata when the local user is not linked', async () => {
    const sessionToken = 'session-token';
    const metadata = {
      kaypalDesktopAccessToken: 'access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + 60 * 60_000,
      ).toISOString(),
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalCreditBalanceUserId: 'kaypal-user-from-metadata',
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata,
          user: {
            id: 'admin-user',
            username: 'admin',
            email: 'admin@example.com',
            name: 'Admin',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: null,
            role: 'admin',
            commercialExecutionAllowed: true,
            planMode: 'commercial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest.fn(),
      getUserFromDesktopToken: jest.fn(),
    };
    const request = {
      path: '/api/growth/acquisition/configs',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      authUser: {
        kaypalUserId: 'kaypal-user-from-metadata',
        kaypalDesktopAccessToken: 'access-token',
      },
    });
  });

  it('does not grant commercial execution from cached Kaypal subscription metadata alone', async () => {
    const sessionToken = 'session-token';
    const userId = 'user-advanced';
    const metadata = {
      kaypalDesktopAccessToken: 'access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + 60 * 60_000,
      ).toISOString(),
      kaypalDesktopDeviceId: 'device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalSubscriptionPeriodEnd: new Date(
        Date.now() + 30 * 24 * 60 * 60_000,
      ).toISOString(),
      kaypalMetadataSyncedAt: new Date().toISOString(),
    };
    const prisma = {
      userSession: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'session-1',
          tokenHash: hashSessionToken(sessionToken),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
          metadata,
          user: {
            id: userId,
            username: 'advanced_user',
            email: 'advanced@example.com',
            name: 'Advanced User',
            status: 'active',
            lastLoginAt: new Date(),
            kaypalUserId: 'kaypal-user-advanced',
            role: 'operator',
            commercialExecutionAllowed: false,
            planMode: 'trial',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    };
    const kaypalClient = {
      refreshDesktopAuthToken: jest.fn(),
      getUserFromDesktopToken: jest.fn(),
    };
    const tenants = {
      ensureDefaultTenantForUser: jest.fn().mockResolvedValue({
        tenantId: 'tenant-advanced',
        source: 'persisted-default',
        role: 'member',
        permissions: [],
        warnings: [],
      }),
      findCommercialEntitlementForTenant: jest.fn().mockResolvedValue(null),
    };
    const request = {
      path: '/api/auth/me',
      headers: {
        cookie: `${AUTH_COOKIE_NAME}=${sessionToken}`,
      },
    };
    const guard = new AuthGuard(
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as any,
      prisma as any,
      kaypalClient as any,
      undefined,
      new EntitlementsService(tenants as any),
    );

    await expect(
      guard.canActivate(createExecutionContext(request)),
    ).resolves.toBe(true);

    expect(request).toMatchObject({
      authUser: {
        kaypalPlan: 'ADVANCED',
        commercialExecutionAllowed: false,
        planMode: 'trial',
      },
    });
    expect(tenants.ensureDefaultTenantForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        entitlement: expect.objectContaining({
          commercialExecutionAllowed: false,
          plan: 'ADVANCED',
          source: 'trial',
        }),
      }),
    );
  });
});
