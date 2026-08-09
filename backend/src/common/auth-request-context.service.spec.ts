import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthRequestContextService } from './auth-request-context.service';

describe('AuthRequestContextService', () => {
  const createPrisma = (tenantIds: string[]) => ({
    tenantMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(tenantIds.map((tenantId) => ({ tenantId }))),
    },
  });

  it('uses an explicitly requested tenant only after active membership lookup', async () => {
    const service = new AuthRequestContextService();
    const prisma = createPrisma(['tenant-a', 'tenant-b']);

    const tenantId = await service.run(
      {
        requestedTenantId: 'tenant-b',
        user: { id: 'user-1' },
      },
      () => service.resolveTenantId(prisma),
    );

    expect(tenantId).toBe('tenant-b');
    expect(prisma.tenantMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          status: 'active',
          tenant: { status: 'active' },
        },
      }),
    );
  });

  it('rejects an explicit tenant without active membership', async () => {
    const service = new AuthRequestContextService();
    const prisma = createPrisma(['tenant-a']);

    await expect(
      service.run(
        {
          requestedTenantId: 'tenant-attacker',
          user: { id: 'user-1' },
        },
        () => service.resolveTenantId(prisma),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an actionable 409 when a multi-tenant user omits selection', async () => {
    const service = new AuthRequestContextService();
    const prisma = createPrisma(['tenant-a', 'tenant-b']);

    const error = await service
      .run({ user: { id: 'user-1' } }, () => service.resolveTenantId(prisma))
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error).toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'TENANT_SELECTION_REQUIRED',
        publicDetails: expect.objectContaining({
          header: 'x-tenant-id',
          availableTenantIds: ['tenant-a', 'tenant-b'],
        }),
      }),
    });
  });
});
