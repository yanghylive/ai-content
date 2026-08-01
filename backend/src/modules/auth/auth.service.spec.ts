import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { hashPassword } from './auth.utils';

describe('AuthService', () => {
  const createService = () => {
    const prisma = {
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
    };

    const service = new AuthService(prisma as any);

    return { service, prisma };
  };

  it('首次初始化时会创建后台账号', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(0);
    prisma.user.create.mockImplementation(async ({ data }) => ({
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

    expect(prisma.user.create).toHaveBeenCalledWith({
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
    prisma.user.count.mockResolvedValue(0);

    const result = await service.getSetupStatus();

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(result).toEqual({
      hasUsers: false,
      totalUsers: 0,
    });
  });

  it('系统已有账号时不允许重复初始化', async () => {
    const { service, prisma } = createService();
    prisma.user.count.mockResolvedValue(1);

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

    prisma.user.findFirst.mockResolvedValue({
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
    prisma.userSession.create.mockResolvedValue({
      id: 'session-1',
    });
    prisma.userSession.findFirst.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({
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

    expect(prisma.userSession.create).toHaveBeenCalledWith({
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

    prisma.user.findFirst.mockResolvedValue({
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
    prisma.userSession.findFirst.mockResolvedValue({
      metadata,
    });
    prisma.userSession.create.mockResolvedValue({
      id: 'session-1',
    });
    prisma.user.update.mockResolvedValue({
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

    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: { metadata: true },
    });
    expect(prisma.userSession.create).toHaveBeenCalledWith({
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
      prisma.userSession.create.mock.calls[0][0].data.metadata.ignoredUndefined,
    ).toBeUndefined();
  });

  it('密码错误时会拒绝登录', async () => {
    const { service, prisma } = createService();
    prisma.user.findFirst.mockResolvedValue({
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
    prisma.userSession.findFirst.mockResolvedValue(null);

    await expect(
      service.login({
        username: 'admin',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
