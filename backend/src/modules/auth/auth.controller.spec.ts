import { AuthController } from './auth.controller';
import type { AuthenticatedUser } from './auth.types';

describe('AuthController', () => {
  const controller = new AuthController({} as never, {} as never);

  const user: AuthenticatedUser = {
    id: 'user-1',
    username: 'kaypal-user',
    email: 'user@example.test',
    name: 'Kaypal 用户',
    status: 'active',
    lastLoginAt: null,
    kaypalUserId: 'kaypal-user-1',
    kaypalDesktopAccessToken: 'access-secret',
    kaypalDesktopRefreshToken: 'refresh-secret',
    role: 'operator',
    commercialExecutionAllowed: false,
    planMode: 'trial',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  it.each([undefined, {}, { username: 'demo' }])(
    'returns a 400 error for an incomplete login body: %p',
    async (body) => {
      const authService = { login: jest.fn() };
      const scopedController = new AuthController(
        authService as never,
        {} as never,
      );

      await expect(
        scopedController.login(body as never, {} as never),
      ).rejects.toMatchObject({ status: 400 });
      expect(authService.login).not.toHaveBeenCalled();
    },
  );

  it('returns session state without exposing desktop tokens from /auth/me', () => {
    const response = controller.getMe({ authUser: user } as never);

    expect(response).toMatchObject({
      id: 'user-1',
      kaypalUserId: 'kaypal-user-1',
      hasKaypalDesktopSession: true,
    });
    expect(response).not.toHaveProperty('kaypalDesktopAccessToken');
    expect(response).not.toHaveProperty('kaypalDesktopRefreshToken');
  });

  it('reports no desktop session when no desktop token exists', () => {
    const response = controller.getMe({
      authUser: {
        ...user,
        kaypalDesktopAccessToken: null,
        kaypalDesktopRefreshToken: null,
      },
    } as never);

    expect(response?.hasKaypalDesktopSession).toBe(false);
  });

  it('lists active tenant memberships for the workspace selector', async () => {
    const prisma = {
      system: {
      tenantMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: 'tenant-1',
            role: 'admin',
            tenant: { name: '品牌工作区', slug: 'brand' },
          },
        ]),
      },
      },
    };
    const scopedController = new AuthController({} as never, prisma as never);

    await expect(
      scopedController.listCurrentUserTenants({ authUser: user } as never),
    ).resolves.toEqual([
      {
        tenantId: 'tenant-1',
        name: '品牌工作区',
        slug: 'brand',
        role: 'admin',
      },
    ]);
  });

  it('lists users only from the administered tenant', async () => {
    const prisma = {
      system: {
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      },
    };
    const scopedController = new AuthController({} as never, prisma as never);

    await scopedController.listUsers({
      authUser: { ...user, role: 'admin' },
      headers: { 'x-tenant-id': 'tenant-1' },
    } as never);

    expect(prisma.system.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantMemberships: {
            some: { tenantId: 'tenant-1', status: 'active' },
          },
        },
      }),
    );
  });

  it('rejects administration of a user outside the current tenant', async () => {
    const prisma = {
      system: {
      tenantMember: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ tenantId: 'tenant-1' })
          .mockResolvedValueOnce(null),
      },
      },
    };
    const scopedController = new AuthController({} as never, prisma as never);

    await expect(
      scopedController.updateUserRole('user-other', { role: 'manager' }, {
        authUser: { ...user, role: 'admin' },
        headers: { 'x-tenant-id': 'tenant-1' },
      } as never),
    ).rejects.toThrow('只能管理当前组织内的用户');
  });

  it('wechat callback: redirects to frontend with session cookie on success', async () => {
    const authService = {
      handleWechatCallback: jest.fn().mockResolvedValue({
        sessionToken: 'session-token-1',
        expiresAt: new Date('2026-08-20T00:00:00.000Z'),
        user: { id: 'user-1' },
      }),
    };
    const scopedController = new AuthController(authService as never, {} as never);
    const response = {
      cookie: jest.fn(),
      redirect: jest.fn(),
    };

    await scopedController.wechatCallback(
      { headers: { host: 'localhost:3011' }, protocol: 'http' } as never,
      { kaypalToken: 'kda_test-token' } as never,
      response as never,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'ai_content_session',
      'session-token-1',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'http://localhost:3011/',
    );
  });

  it('wechat callback: converts service exception to friendly redirect instead of 500', async () => {
    const authService = {
      handleWechatCallback: jest
        .fn()
        .mockRejectedValue(new Error('数据库连接失败')),
    };
    const scopedController = new AuthController(authService as never, {} as never);
    const response = {
      cookie: jest.fn(),
      redirect: jest.fn(),
    };

    await scopedController.wechatCallback(
      { headers: { host: 'localhost:3011' }, protocol: 'http' } as never,
      { kaypalToken: 'kda_test-token' } as never,
      response as never,
    );

    expect(response.redirect).toHaveBeenCalled();
    const [status, url] = response.redirect.mock.calls[0];
    expect(status).toBe(302);
    expect(String(url)).toContain('/login?error=');
    expect(String(url)).toContain(encodeURIComponent('数据库连接失败'));
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('wechat callback: redirects with error for missing token', async () => {
    const authService = {
      handleWechatCallback: jest.fn().mockResolvedValue({
        sessionToken: null,
        error: '微信登录回调缺少凭证，请重新扫码',
      }),
    };
    const scopedController = new AuthController(authService as never, {} as never);
    const response = {
      cookie: jest.fn(),
      redirect: jest.fn(),
    };

    await scopedController.wechatCallback({ headers: { host: 'localhost:3011' }, protocol: 'http' } as never, {} as never, response as never);

    expect(response.redirect).toHaveBeenCalledWith(
      302,
      expect.stringContaining('/login?error='),
    );
    expect(response.cookie).not.toHaveBeenCalled();
  });
});

describe('AuthController · assertSeatAvailable（Bug 修复 2026-08-17）', () => {
  function makeController(overrides: Record<string, unknown> = {}) {
    const prisma = {
      system: {
      tenantEntitlement: {
        findFirst: jest.fn().mockResolvedValue({ plan: 'FREE' }),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ ownerUserId: 'owner-1' }),
      },
      tenantMember: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'm1', role: 'member', status: 'active' }),
        update: jest.fn().mockResolvedValue({ id: 'm1', role: 'member', status: 'active' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u-2', username: 'u2', email: 'u2@x.com', name: 'U2', status: 'active' }),
      },
      ...overrides,
      },
    };
    const controller = new AuthController(
      { getSetupStatus: jest.fn() } as never,
      prisma as never,
    ) as unknown as {
      assertSeatAvailable: (tenantId: string) => Promise<void>;
      prisma: typeof prisma;
    };
    return controller;
  }

  it('single 方案（FREE maxSeats=1）：排除 owner 后 0 个成员 → 可邀请', async () => {
    const c = makeController();
    await expect(c.assertSeatAvailable('t-1')).resolves.toBeUndefined();
    // 断言 count 排除 owner
    expect(c.prisma.system.tenantMember.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { not: 'owner-1' } }),
      }),
    );
  });

  it('single 方案：排除 owner 后已满 1 个 → 拒绝', async () => {
    const c = makeController({
      tenantMember: {
        count: jest.fn().mockResolvedValue(1),
      },
    });
    await expect(c.assertSeatAvailable('t-1')).rejects.toThrow('席位已达上限');
  });

  it('custom 不限额（plan 无 maxSeats）→ 直接放行', async () => {
    const c = makeController({
      tenantEntitlement: {
        findFirst: jest.fn().mockResolvedValue({ plan: 'ENTERPRISE' }),
      },
    });
    await expect(c.assertSeatAvailable('t-1')).resolves.toBeUndefined();
  });
});

describe('normalizeWechatNext（微信登录回跳白名单）', () => {
  const { normalizeWechatNext } = require('./auth.controller');
  it('直接路径原样放行', () => {
    expect(normalizeWechatNext('/agent')).toBe('/agent');
    expect(normalizeWechatNext('/workbench')).toBe('/workbench');
  });
  it('编码一次（wechat/start → callback 实际收到形态）解码后放行', () => {
    // v1.1.105 修复：callback 收到的 query.next 是 encodeURIComponent 过的
    // （%2Fagent），此前直接按编码串白名单校验失败 → fallback '/' → 登录后跳错页
    expect(normalizeWechatNext(encodeURIComponent('/agent'))).toBe('/agent');
    expect(normalizeWechatNext('%2Fworkbench')).toBe('/workbench');
  });
  it('空/undefined 回落根路径', () => {
    expect(normalizeWechatNext(undefined)).toBe('/');
    expect(normalizeWechatNext('')).toBe('/');
  });
  it('恶意路径被拦截', () => {
    expect(normalizeWechatNext('//evil.com')).toBe('/');
    expect(normalizeWechatNext(encodeURIComponent('//evil.com'))).toBe('/');
    expect(normalizeWechatNext('javascript:alert(1)')).toBe('/');
    expect(normalizeWechatNext(encodeURIComponent('javascript:alert(1)'))).toBe('/');
    expect(normalizeWechatNext('/\\evil')).toBe('/');
  });
});
