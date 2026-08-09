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
});
