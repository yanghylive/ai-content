import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getKaypalPlanRank,
  isKaypalPlanAtLeast,
  normalizeKaypalPlan,
} from '../auth/plan-order';
import type {
  EffectiveEntitlement,
  EffectiveEntitlementSource,
} from './entitlements.types';
import { TenantsService } from '../tenants/tenants.service';
import type {
  StoredTenantEntitlement,
  TenantContext,
} from '../tenants/tenants.types';

@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private readonly tenants?: TenantsService,
  ) {}

  getEffectiveEntitlement(
    user?: AuthenticatedUser | null,
  ): EffectiveEntitlement {
    if (!user) {
      return this.anonymousEntitlement();
    }

    const plan = normalizeKaypalPlan(user.kaypalPlan);
    const planExpired = user.kaypalPlanExpired === true;
    const cloudSubscriptionActive =
      Boolean(user.kaypalUserId) && plan !== 'FREE' && !planExpired;
    const localCommercialAllowed =
      user.commercialExecutionAllowed === true &&
      user.planMode === 'commercial';
    // Cached cloud plan metadata identifies product access, but is not itself a
    // server-verifiable grant for real external actions. Commercial execution
    // requires an explicit local grant or a persisted active tenant entitlement.
    const commercialExecutionAllowed = localCommercialAllowed;
    const effectivePlanMode = commercialExecutionAllowed
      ? 'commercial'
      : user.planMode || 'trial';
    const source = this.resolveSource({
      cloudSubscriptionActive,
      localCommercialAllowed,
    });
    const warnings = [
      'tenant-model-not-yet-persisted',
      ...(source === 'local-commercial-override'
        ? ['commercial-access-uses-local-override']
        : []),
    ];
    const blockers = [
      ...(!commercialExecutionAllowed
        ? ['missing-commercial-entitlement']
        : []),
      ...(planExpired ? ['kaypal-plan-expired'] : []),
    ];

    return {
      userId: user.id,
      source,
      plan,
      planExpired,
      kaypalUserId: user.kaypalUserId ?? null,
      cloudSubscriptionActive,
      localCommercialAllowed,
      commercialExecutionAllowed,
      planMode: effectivePlanMode,
      role: user.role || 'operator',
      tenant: {
        tenantId: `user:${user.id}`,
        source: 'synthetic-user',
        role: user.role || 'operator',
        permissions: user.kaypalPermissionNames ?? [],
        warnings: ['tenant-model-not-yet-persisted'],
      },
      features: this.resolveFeatures(plan, commercialExecutionAllowed),
      blockers,
      warnings,
      evidence: {
        kaypalPlan: plan,
        kaypalUserId: user.kaypalUserId ?? null,
        kaypalPlanExpired: planExpired,
        planMode: effectivePlanMode,
        localPlanMode: user.planMode,
        commercialExecutionAllowed: user.commercialExecutionAllowed,
        source,
      },
    };
  }

  async getEffectiveEntitlementForUser(
    user?: AuthenticatedUser | null,
  ): Promise<EffectiveEntitlement> {
    const entitlement = this.getEffectiveEntitlement(user);
    if (!user || !this.tenants) {
      return entitlement;
    }

    const tenant = await this.tenants.ensureDefaultTenantForUser({
      user,
      entitlement: {
        source:
          entitlement.source === 'kaypal-subscription'
            ? 'trial'
            : entitlement.source,
        plan: entitlement.plan,
        status: entitlement.planExpired ? 'expired' : 'active',
        features:
          entitlement.source === 'kaypal-subscription'
            ? this.resolveFeatures(entitlement.plan, false)
            : entitlement.features,
        commercialExecutionAllowed:
          entitlement.source === 'kaypal-subscription'
            ? false
            : entitlement.commercialExecutionAllowed,
        metadata: {
          sessionEntitlementSource: entitlement.source,
          kaypalUserId: entitlement.kaypalUserId,
          planMode: entitlement.planMode,
          localPlanMode: user.planMode,
          localCommercialAllowed: entitlement.localCommercialAllowed,
          cloudSubscriptionActive: entitlement.cloudSubscriptionActive,
        },
      },
    });
    const storedBillingEntitlement =
      await this.tenants.findCommercialEntitlementForTenant(tenant.tenantId);

    return this.mergeTenantBillingEntitlement(
      {
        ...entitlement,
        tenant,
        warnings: entitlement.warnings.filter(
          (warning) => warning !== 'tenant-model-not-yet-persisted',
        ),
        evidence: {
          ...entitlement.evidence,
          tenantId: tenant.tenantId,
          tenantSource: tenant.source,
        },
      },
      tenant,
      storedBillingEntitlement,
    );
  }

  meetsAnyPlan(
    user: AuthenticatedUser | undefined | null,
    requiredPlans: string[],
  ) {
    const entitlement = this.getEffectiveEntitlement(user);
    return this.evaluatePlanRequirement(entitlement, requiredPlans);
  }

  /**
   * 商用账本：在执行关键动作前，快照「当时的授权状态」（报告 16.2 entitlementSnapshot）。
   * 用于事后追责「这次执行用的是哪个套餐/限额」。
   * 快照失败不阻断主流程（记账是旁路），仅记录告警。
   */
  async captureSnapshot(
    user: unknown,
    context: string,
    refId?: string,
  ): Promise<void> {
    const entitlement = this.getEffectiveEntitlement(
      (user ?? null) as AuthenticatedUser | null,
    );
    try {
      await this.prisma.entitlementSnapshot.create({
        data: {
          tenantId: entitlement.tenant?.tenantId ?? null,
          userId: entitlement.userId ?? null,
          plan: entitlement.plan,
          planMode: entitlement.planMode ?? null,
          source: entitlement.source,
          features: entitlement.features as unknown as Prisma.InputJsonValue,
          blockers: entitlement.blockers as unknown as Prisma.InputJsonValue,
          context,
          refId: refId ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `entitlement snapshot 写入失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async meetsAnyPlanForUser(
    user: AuthenticatedUser | undefined | null,
    requiredPlans: string[],
  ) {
    const entitlement = await this.getEffectiveEntitlementForUser(user);
    return this.evaluatePlanRequirement(entitlement, requiredPlans);
  }

  private evaluatePlanRequirement(
    entitlement: EffectiveEntitlement,
    requiredPlans: string[],
  ) {
    if (entitlement.planExpired) {
      return { ok: false, entitlement, reason: 'expired' as const };
    }
    if (!entitlement.commercialExecutionAllowed) {
      return {
        ok: false,
        entitlement,
        reason: 'missing-commercial-entitlement' as const,
      };
    }
    const ok = requiredPlans.some((plan) =>
      isKaypalPlanAtLeast(entitlement.plan, plan),
    );
    return {
      ok,
      entitlement,
      reason: ok ? ('matched' as const) : ('insufficient-plan' as const),
    };
  }

  private anonymousEntitlement(): EffectiveEntitlement {
    return {
      userId: 'anonymous',
      source: 'anonymous',
      plan: 'FREE',
      planExpired: false,
      kaypalUserId: null,
      cloudSubscriptionActive: false,
      localCommercialAllowed: false,
      commercialExecutionAllowed: false,
      planMode: 'trial',
      role: 'anonymous',
      tenant: {
        tenantId: 'anonymous',
        source: 'anonymous',
        role: 'anonymous',
        permissions: [],
        warnings: ['not-authenticated'],
      },
      features: [],
      blockers: ['not-authenticated'],
      warnings: [],
      evidence: { source: 'anonymous' },
    };
  }

  private resolveSource(input: {
    cloudSubscriptionActive: boolean;
    localCommercialAllowed: boolean;
  }): EffectiveEntitlementSource {
    if (input.cloudSubscriptionActive) return 'kaypal-subscription';
    if (input.localCommercialAllowed) return 'local-commercial-override';
    return 'trial';
  }

  private resolveFeatures(plan: string, commercialExecutionAllowed: boolean) {
    const features = ['auth', 'app-market'];
    if (getKaypalPlanRank(plan) >= getKaypalPlanRank('STANDARD')) {
      features.push('crm', 'growth', 'local-engine');
    }
    if (commercialExecutionAllowed) {
      features.push('commercial-execution');
    }
    return features;
  }

  private mergeTenantBillingEntitlement(
    entitlement: EffectiveEntitlement,
    tenant: TenantContext,
    stored: StoredTenantEntitlement | null,
  ): EffectiveEntitlement {
    if (!stored) return entitlement;

    const status = stored.status.trim().toLowerCase();
    const periodExpired = Boolean(
      stored.periodEnd && stored.periodEnd <= new Date(),
    );
    const billingActive =
      stored.commercialExecutionAllowed &&
      ['active', 'trialing', 'paid'].includes(status) &&
      !periodExpired;
    const billingPlan = normalizeKaypalPlan(stored.plan);

    if (!billingActive) {
      const localCommercialAllowed = entitlement.localCommercialAllowed;
      const fallbackPlan = localCommercialAllowed
        ? getKaypalPlanRank(billingPlan) > getKaypalPlanRank(entitlement.plan)
          ? billingPlan
          : entitlement.plan
        : 'FREE';
      const billingExpired = periodExpired || status === 'expired';
      return {
        ...entitlement,
        source: localCommercialAllowed ? 'local-commercial-override' : 'trial',
        plan: fallbackPlan,
        planExpired: billingExpired,
        cloudSubscriptionActive: false,
        commercialExecutionAllowed: localCommercialAllowed,
        planMode: localCommercialAllowed ? 'commercial' : 'trial',
        features: this.resolveFeatures(fallbackPlan, localCommercialAllowed),
        blockers: Array.from(
          new Set([
            ...entitlement.blockers.filter(
              (blocker) => blocker !== 'kaypal-plan-expired',
            ),
            ...(!localCommercialAllowed
              ? ['missing-commercial-entitlement']
              : []),
            ...(billingExpired ? ['kaypal-plan-expired'] : []),
          ]),
        ),
        warnings: Array.from(
          new Set([
            ...entitlement.warnings,
            'tenant-billing-entitlement-inactive',
          ]),
        ),
        evidence: {
          ...entitlement.evidence,
          kaypalPlan: fallbackPlan,
          source: localCommercialAllowed
            ? 'local-commercial-override'
            : 'trial',
          planMode: localCommercialAllowed ? 'commercial' : 'trial',
          commercialExecutionAllowed: localCommercialAllowed,
          tenantBillingEntitlement: {
            id: stored.id,
            source: stored.source,
            plan: billingPlan,
            status: stored.status,
            commercialExecutionAllowed: stored.commercialExecutionAllowed,
            externalSubscriptionId: stored.externalSubscriptionId,
            periodEnd: stored.periodEnd?.toISOString() ?? null,
            active: billingActive,
          },
        },
      };
    }

    const features = Array.from(
      new Set([...this.resolveFeatures(billingPlan, true), ...stored.features]),
    );

    return {
      ...entitlement,
      source: 'kaypal-subscription',
      plan: billingPlan,
      planExpired: false,
      cloudSubscriptionActive: true,
      commercialExecutionAllowed: true,
      planMode: 'commercial',
      tenant,
      features,
      blockers: entitlement.blockers.filter(
        (blocker) =>
          blocker !== 'missing-commercial-entitlement' &&
          blocker !== 'kaypal-plan-expired',
      ),
      warnings: Array.from(
        new Set([
          ...entitlement.warnings,
          'entitlement-loaded-from-tenant-billing',
        ]),
      ),
      evidence: {
        ...entitlement.evidence,
        kaypalPlan: billingPlan,
        source: 'kaypal-subscription',
        planMode: 'commercial',
        commercialExecutionAllowed: true,
        tenantId: tenant.tenantId,
        tenantSource: tenant.source,
        tenantBillingEntitlement: {
          id: stored.id,
          source: stored.source,
          plan: billingPlan,
          status: stored.status,
          commercialExecutionAllowed: stored.commercialExecutionAllowed,
          externalSubscriptionId: stored.externalSubscriptionId,
          periodStart: stored.periodStart?.toISOString() ?? null,
          periodEnd: stored.periodEnd?.toISOString() ?? null,
          metadata: stored.metadata,
          active: true,
        },
      },
    };
  }
}
