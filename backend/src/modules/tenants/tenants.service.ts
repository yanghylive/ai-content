import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  EnsureDefaultTenantInput,
  StoredTenantEntitlement,
  TenantContext,
} from './tenants.types';
import type { EffectiveEntitlementSource } from '../entitlements/entitlements.types';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultTenantForUser(
    input: EnsureDefaultTenantInput,
  ): Promise<TenantContext> {
    const user = input.user;
    const slug = this.defaultTenantSlug(user.id);
    const now = new Date();
    const permissions = user.kaypalPermissionNames ?? [];
    const role = this.tenantRoleFromUserRole(user.role);

    const tenant = await this.prisma.tenant.upsert({
      where: { slug },
      create: {
        name: this.defaultTenantName(user),
        slug,
        ownerUserId: user.id,
        metadata: {
          source: 'default-user-tenant',
          createdFromUserId: user.id,
        },
      },
      update: {
        name: this.defaultTenantName(user),
        status: 'active',
        ownerUserId: user.id,
        updatedAt: now,
      },
    });

    const member = await this.prisma.tenantMember.upsert({
      where: {
        tenantId_userId: {
          tenantId: tenant.id,
          userId: user.id,
        },
      },
      create: {
        tenantId: tenant.id,
        userId: user.id,
        role,
        status: 'active',
        permissions: permissions,
      },
      update: {
        role,
        status: 'active',
        permissions: permissions,
        updatedAt: now,
      },
    });

    await this.prisma.tenantEntitlement.upsert({
      where: {
        tenantId_source: {
          tenantId: tenant.id,
          source: input.entitlement.source,
        },
      },
      create: {
        tenantId: tenant.id,
        source: input.entitlement.source,
        plan: input.entitlement.plan,
        status: input.entitlement.status,
        features: input.entitlement.features,
        commercialExecutionAllowed:
          input.entitlement.commercialExecutionAllowed,
        metadata: input.entitlement.metadata as Prisma.InputJsonValue,
      },
      update: {
        plan: input.entitlement.plan,
        status: input.entitlement.status,
        features: input.entitlement.features,
        commercialExecutionAllowed:
          input.entitlement.commercialExecutionAllowed,
        metadata: input.entitlement.metadata as Prisma.InputJsonValue,
        updatedAt: now,
      },
    });

    return {
      tenantId: tenant.id,
      source: 'persisted-default',
      role: member.role,
      permissions,
      warnings: [],
    };
  }

  async findCommercialEntitlementForTenant(
    tenantId: string,
  ): Promise<StoredTenantEntitlement | null> {
    const record = await this.prisma.tenantEntitlement.findFirst({
      where: {
        tenantId,
        source: 'kaypal-subscription',
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    if (!record) return null;

    return {
      id: record.id,
      tenantId: record.tenantId,
      source: this.toEntitlementSource(record.source),
      plan: record.plan,
      status: record.status,
      features: this.toStringArray(record.features),
      commercialExecutionAllowed: record.commercialExecutionAllowed,
      externalSubscriptionId: record.externalSubscriptionId,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      metadata: this.toRecord(record.metadata),
      updatedAt: record.updatedAt,
    };
  }

  private defaultTenantSlug(userId: string) {
    return `user-${userId}`;
  }

  private defaultTenantName(user: {
    name?: string | null;
    username?: string | null;
  }) {
    const base = (user.name || user.username || '默认').trim();
    return `${base}的组织`;
  }

  private tenantRoleFromUserRole(role?: string | null) {
    if (role === 'admin') return 'admin';
    if (role === 'manager') return 'manager';
    return 'member';
  }

  private toStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toEntitlementSource(source: string): EffectiveEntitlementSource {
    if (
      source === 'kaypal-subscription' ||
      source === 'local-commercial-override' ||
      source === 'trial' ||
      source === 'anonymous'
    ) {
      return source;
    }
    return 'trial';
  }
}
