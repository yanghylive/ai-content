import { TenantsService } from './tenants.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

function makeUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    name: 'Tester',
    status: 'active',
    lastLoginAt: null,
    kaypalUserId: 'kaypal-1',
    kaypalPlan: 'ADVANCED',
    kaypalPlanExpired: false,
    kaypalRole: null,
    kaypalPlatformRole: null,
    kaypalPermissionNames: ['crm:read'],
    role: 'admin',
    commercialExecutionAllowed: true,
    planMode: 'commercial',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('TenantsService', () => {
  it('creates or updates default tenant, membership, and entitlement snapshot', async () => {
    const prisma = {
      system: {
            tenant: {
              upsert: jest
                .fn()
                .mockResolvedValue({ id: 'tenant-1', slug: 'user-user-1' }),
            },
            tenantMember: {
              upsert: jest.fn().mockResolvedValue({ role: 'admin' }),
            },
            tenantEntitlement: {
              upsert: jest.fn().mockResolvedValue({ id: 'ent-1' }),
            },
      },
    } as unknown as jest.Mocked<PrismaService>;
    const service = new TenantsService(prisma);

    const context = await service.ensureDefaultTenantForUser({
      user: makeUser(),
      entitlement: {
        source: 'kaypal-subscription',
        plan: 'ADVANCED',
        status: 'active',
        features: ['crm'],
        commercialExecutionAllowed: true,
        metadata: { source: 'test' },
      },
    });

    expect(context).toEqual({
      tenantId: 'tenant-1',
      source: 'persisted-default',
      role: 'admin',
      permissions: ['crm:read'],
      warnings: [],
    });
    expect(prisma.system.tenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'user-user-1' } }),
    );
    expect(prisma.system.tenantMember.upsert).toHaveBeenCalled();
    expect(prisma.system.tenantEntitlement.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_source: {
            tenantId: 'tenant-1',
            source: 'kaypal-subscription',
          },
        },
      }),
    );
  });
});
