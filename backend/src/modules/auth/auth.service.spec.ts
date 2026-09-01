import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './auth.utils';

describe('AuthService', () => {
  const createService = () => {
    const prisma = {
      system: {
        user: {
          count: jest.fn(),
          findFirst: jest.fn(),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        userSession: {
          create: jest.fn(),
          deleteMany: jest.fn(),
          findFirst: jest.fn(),
        },
      },
      switchDatabase: jest.fn().mockResolvedValue(undefined),
      ensureAccountDatabase: jest.fn().mockResolvedValue('/tmp/accounts/u.sqlite'),
    };

    const service = new AuthService(prisma as any);

    return { service, prisma };
  };

  it('首次初始化时会创建后台账号', async () => {
    const { service, prisma } = createService();
    prisma.system.user.count.mockResolvedValue(0);
    prisma.system.user.create.mockImplementation(async ({ data }) => ({
      id: 'user-1',
      username: data.username,
      email: data.email,
      name: data.name,
      status: 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-03-17T00:00:00.000Z'),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
    }));

    const result = await service.bootstrapUser({
      username: 'Admin',
      password: 'admin123',
    });

    expect(prisma.system.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: 'admin',
        email: 'admin@local',
        name: '管理员',
        passwordHash: expect.any(String),
      }),
    });
    expect(result.username).toBe('admin');
  });

  it('setup status 不会自动创建默认管理员', async () => {
    const { service, prisma } = createService();
    prisma.system.user.count.mockResolvedValue(0);

    const result = await service.getSetupStatus();

    expect(prisma.system.user.create).not.toHaveBeenCalled();
    // 2026-09-01（审计 #17）：未登录接口不再返回 totalUsers（信息收敛）
    expect(result).toEqual({
      hasUsers: false,
    });
  });

  it('系统已有账号时不允许重复初始化', async () => {
    const { service, prisma } = createService();
    prisma.system.user.count.mockResolvedValue(1);

    await expect(
      service.bootstrapUser({
        username: 'admin',
        password: 'admin123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('密码正确时会创建登录会话', async () => {
    const { service, prisma } = createService();
    const passwordHash = await hashPassword('admin123');
    const createdAt = new Date('2026-03-17T00:00:00.000Z');
    const updatedAt = new Date('2026-03-17T00:00:00.000Z');

    prisma.system.user.findFirst.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      email: 'admin@local',
      name: '管理员',
      status: 'active',
      passwordHash,
      lastLoginAt: null,
      createdAt,
      updatedAt,
      kaypalUserId: null,
    });
    prisma.system.userSession.create.mockResolvedValue({
      id: 'session-1',
    });
    prisma.system.userSession.findFirst.mockResolvedValue(null);
    prisma.system.user.update.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      email: 'admin@local',
      name: '管理员',
      status: 'active',
      lastLoginAt: createdAt,
      createdAt,
      updatedAt,
      kaypalUserId: null,
    });

    const result = await service.login({
      username: 'admin',
      password: 'admin123',
    });

    expect(prisma.system.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(result.user.username).toBe('admin');
    expect(result.sessionToken).toEqual(expect.any(String));
  });

  it('本地登录会继承同用户最近一次 Kaypal 授权 metadata', async () => {
    const { service, prisma } = createService();
    const passwordHash = await hashPassword('admin123');
    const createdAt = new Date('2026-03-17T00:00:00.000Z');
    const updatedAt = new Date('2026-03-17T00:00:00.000Z');
    const metadata = {
      kaypalDesktopAccessToken: 'access-token',
      kaypalDesktopRefreshToken: 'refresh-token',
      kaypalDesktopTokenExpiresAt: '2026-03-18T00:00:00.000Z',
      kaypalDesktopDeviceId: 'desktop-1',
      kaypalSubscriptionPlan: 'ADVANCED',
      kaypalRole: 'SUPER_ADMIN',
      ignoredUndefined: undefined,
    };

    prisma.system.user.findFirst.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      email: 'admin@local',
      name: '管理员',
      status: 'active',
      passwordHash,
      lastLoginAt: null,
      createdAt,
      updatedAt,
      kaypalUserId: 'kaypal-user-1',
    });
    prisma.system.userSession.findFirst.mockResolvedValue({
      metadata,
    });
    prisma.system.userSession.create.mockResolvedValue({
      id: 'session-1',
    });
    prisma.system.user.update.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      email: 'admin@local',
      name: '管理员',
      status: 'active',
      lastLoginAt: createdAt,
      createdAt,
      updatedAt,
      kaypalUserId: 'kaypal-user-1',
    });

    await service.login({
      username: 'admin',
      password: 'admin123',
    });

    expect(prisma.system.userSession.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: { metadata: true },
    });
    expect(prisma.system.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        metadata: expect.objectContaining({
          kaypalDesktopAccessToken: 'access-token',
          kaypalDesktopRefreshToken: 'refresh-token',
          kaypalSubscriptionPlan: 'ADVANCED',
        }),
      }),
    });
    expect(
      prisma.system.userSession.create.mock.calls[0][0].data.metadata.ignoredUndefined,
    ).toBeUndefined();
  });

  it('密码错误时会拒绝登录', async () => {
    const { service, prisma } = createService();
    prisma.system.user.findFirst.mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      email: 'admin@local',
      name: '管理员',
      status: 'active',
      passwordHash: await hashPassword('admin123'),
      lastLoginAt: null,
      createdAt: new Date('2026-03-17T00:00:00.000Z'),
      updatedAt: new Date('2026-03-17T00:00:00.000Z'),
      kaypalUserId: null,
    });
    prisma.system.userSession.findFirst.mockResolvedValue(null);

    await expect(
      service.login({
        username: 'admin',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('wechatAppLogin 统一账号收编（2026-08-19）', () => {
    const withWechatEnv = () => {
      process.env.WECHAT_APP_APPID = 'wx-test-appid';
      process.env.WECHAT_APP_SECRET = 'wx-test-secret';
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ openid: 'openid-1' }),
      }) as unknown as typeof fetch;
      return () => {
        global.fetch = originalFetch;
        delete process.env.WECHAT_APP_APPID;
        delete process.env.WECHAT_APP_SECRET;
      };
    };

    it('openid 无存量假号 → 不再新建，返回引导九章账号', async () => {
      const restore = withWechatEnv();
      try {
        const { service, prisma } = createService();
        prisma.system.user.findUnique.mockResolvedValue(null);
        await expect(
          service.wechatAppLogin('valid-code'),
        ).rejects.toThrow('已并入九章统一账号');
        // 不再创建 wechat- 假号
        expect(prisma.system.user.create).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('openid 命中存量假号 → 兼容登录（不新建）', async () => {
      const restore = withWechatEnv();
      try {
        const { service, prisma } = createService();
        prisma.system.user.findUnique.mockResolvedValue({
          id: 'legacy-wechat-user',
          status: 'active',
        });
        prisma.system.userSession.create.mockResolvedValue({ id: 'session-1' });
        prisma.system.user.update.mockResolvedValue({
          id: 'legacy-wechat-user',
          status: 'active',
        });
        const result = await service.wechatAppLogin('valid-code');
        expect(result.user).toBeDefined();
        expect(prisma.system.user.create).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });
  });

});

