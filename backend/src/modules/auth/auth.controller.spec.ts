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
      tenantMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: 'tenant-1',
            role: 'admin',
            tenant: { name: '品牌工作区', slug: 'brand' },
          },
        ]),
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
      tenantMember: {
        findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const scopedController = new AuthController({} as never, prisma as never);

    await scopedController.listUsers({
      authUser: { ...user, role: 'admin' },
      headers: { 'x-tenant-id': 'tenant-1' },
    } as never);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
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
      tenantMember: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ tenantId: 'tenant-1' })
          .mockResolvedValueOnce(null),
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
