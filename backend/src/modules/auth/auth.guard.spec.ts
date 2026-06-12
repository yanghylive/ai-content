import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AUTH_COOKIE_NAME } from './auth.constants';
import { hashSessionToken } from './auth.utils';

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
      kaypalDesktopTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
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
      refreshDesktopAuthToken: jest.fn().mockRejectedValue(new Error('rotated')),
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
      kaypalDesktopTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
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
});
