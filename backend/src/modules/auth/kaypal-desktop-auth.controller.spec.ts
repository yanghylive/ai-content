import { KaypalDesktopAuthController } from './kaypal-desktop-auth.controller';
import { IS_PUBLIC_KEY } from './auth.decorator';

describe('KaypalDesktopAuthController', () => {
  const createControllerForPrivateMethods = () =>
    Object.create(
      KaypalDesktopAuthController.prototype,
    ) as KaypalDesktopAuthController & {
      prisma: any;
      kaypalClient: any;
      entitlements: any;
      restoreDesktopSession: (deviceId?: string) => Promise<any>;
      restoreExistingDesktopSession: (
        deviceId: string,
        response: unknown,
      ) => Promise<any>;
      toMetadataRecord: (value: unknown) => Record<string, unknown>;
      normalizeLocalFrontendNextPath: (value?: string | null) => string;
      isLoopbackRequest: (request: {
        ip?: string;
        socket?: { remoteAddress?: string };
        headers?: { host?: string };
      }) => boolean;
    };

  it('parses SQLite JSON string metadata when restoring a desktop session', async () => {
    const controller = createControllerForPrivateMethods();
    const metadata = {
      kaypalDesktopAccessToken: 'access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: new Date(
        Date.now() + 60 * 60 * 1000,
      ).toISOString(),
      kaypalDesktopDeviceId: 'desktop-device-1',
      kaypalSubscriptionPlan: 'ADVANCED',
    };

    controller.prisma = {
      userSession: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'session-1',
            userId: 'user-1',
            user: {
              id: 'user-1',
              username: 'kaypal-user',
              name: 'Kaypal 用户',
              email: 'user@example.test',
              kaypalUserId: 'kaypal-1',
              status: 'active',
              lastLoginAt: null,
              role: 'operator',
              commercialExecutionAllowed: false,
              planMode: 'trial',
              createdAt: new Date('2026-07-22T00:00:00.000Z'),
              updatedAt: new Date('2026-07-22T00:00:00.000Z'),
            },
            expiresAt: Date.now() + 24 * 60 * 60 * 1000,
            metadata: JSON.stringify(metadata),
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 'restored-session' }),
      },
    };
    controller.entitlements = {
      getEffectiveEntitlementForUser: jest.fn().mockResolvedValue({
        tenant: {
          tenantId: 'tenant-personal-1',
          source: 'persisted-default',
        },
      }),
    };

    const restored = await controller.restoreDesktopSession('desktop-device-1');

    expect(restored.user.id).toBe('user-1');
    expect(restored.tenantId).toBe('tenant-personal-1');
    expect(
      controller.entitlements.getEffectiveEntitlementForUser,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-1',
        kaypalUserId: 'kaypal-1',
        kaypalPlan: 'ADVANCED',
        kaypalDesktopDeviceId: 'desktop-device-1',
      }),
    );
    expect(controller.prisma.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
        metadata: expect.objectContaining({
          kaypalDesktopDeviceId: 'desktop-device-1',
          kaypalDesktopAccessToken: 'access-token',
        }),
      }),
    });
  });

  it('returns an empty metadata record for invalid JSON strings', () => {
    const controller = createControllerForPrivateMethods();

    expect(controller.toMetadataRecord('{bad json')).toEqual({});
  });

  it('only accepts local relative next paths for web session recovery', () => {
    const controller = createControllerForPrivateMethods();

    expect(controller.normalizeLocalFrontendNextPath('/dashboard?tab=1')).toBe(
      'http://localhost:3010/dashboard?tab=1',
    );
    for (const unsafeValue of [
      '//attacker.example/path',
      'https://attacker.example/path',
      'javascript:alert(1)',
      '/\\attacker.example/path',
    ]) {
      expect(controller.normalizeLocalFrontendNextPath(unsafeValue)).toBe(
        'http://localhost:3010/apps/ai-employee',
      );
    }
  });

  it('does not trust a localhost Host header from a remote peer', () => {
    const controller = createControllerForPrivateMethods();

    expect(
      controller.isLoopbackRequest({
        ip: '198.51.100.4',
        socket: { remoteAddress: '198.51.100.4' },
        headers: { host: 'localhost:3011' },
      }),
    ).toBe(false);
    expect(
      controller.isLoopbackRequest({
        socket: { remoteAddress: '::ffff:127.0.0.1' },
      }),
    ).toBe(true);
  });

  it('keeps login start/poll public while protecting browser opening', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        KaypalDesktopAuthController.prototype.start,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        KaypalDesktopAuthController.prototype.poll,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        KaypalDesktopAuthController.prototype.open,
      ),
    ).toBeUndefined();
  });

  it('waits for fresh cloud authorization when reauthorization is forced', async () => {
    const controller = createControllerForPrivateMethods();
    controller.restoreExistingDesktopSession = jest
      .fn()
      .mockResolvedValue({ status: 'authorized' });
    controller.kaypalClient = {
      pollDesktopAuth: jest.fn().mockResolvedValue({ status: 'pending' }),
    };

    const result = await controller.poll(
      {
        deviceCode: 'fresh-device-code',
        deviceId: 'desktop-device-1',
        forceReauth: true,
      },
      {} as never,
    );

    expect(controller.restoreExistingDesktopSession).not.toHaveBeenCalled();
    expect(controller.kaypalClient.pollDesktopAuth).toHaveBeenCalledWith({
      deviceCode: 'fresh-device-code',
      deviceId: 'desktop-device-1',
    });
    expect(result).toEqual({ status: 'pending' });
  });
});
