import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { AppInstallState, Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  CRM_APP_KEY,
  type AppInstallStatus,
  type AppPurchaseStatus,
  type MarketAppAccessPolicy,
  type MarketAppState,
} from './app-market.types';

const CRM_APP_META = {
  appKey: CRM_APP_KEY,
  name: 'CRM 客户管理',
  description: '承接自动获客线索、客户档案、跟进时间线和来源证据。',
  priceLabel: '高级版可购买',
};

@Injectable()
export class AppMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  async listApps(actor: AppMarketActor) {
    return [await this.getCrmState(actor)];
  }

  async getCrmState(actor: AppMarketActor): Promise<MarketAppState> {
    const scope = await this.resolveScope(actor);
    const state = await this.findState(scope);
    return this.toCrmState(state, scope);
  }

  async purchaseCrm(actor: AppMarketActor) {
    const scope = await this.resolveScope(actor);
    this.assertCommercialCrmEntitled(scope, 'purchase');
    await this.upsertState(scope, {
      purchaseStatus: 'purchased',
      installStatus: 'not_installed',
      purchasedAt: new Date(),
      entitlementSnapshot: this.buildEntitlementSnapshot(scope, 'purchase'),
    });
    return this.getCrmState(actor);
  }

  async installCrm(actor: AppMarketActor) {
    const scope = await this.resolveScope(actor);
    this.assertCommercialCrmEntitled(scope, 'install');
    const current = await this.findState(scope);
    if (!current || current.purchaseStatus !== 'purchased') {
      throw new BadRequestException('请先购买 CRM 客户管理应用');
    }

    await this.prisma.appInstallState.update({
      where: { id: current.id },
      data: {
        tenantId: scope.tenantId,
        actorUserId: scope.actorUserId,
        installStatus: 'installed',
        installedAt: new Date(),
        uninstalledAt: null,
        entitlementSnapshot: this.buildEntitlementSnapshot(scope, 'install'),
      },
    });
    return this.getCrmState(actor);
  }

  async uninstallCrm(actor: AppMarketActor) {
    const scope = await this.resolveScope(actor);
    const current = await this.findState(scope);
    if (!current) {
      return this.getCrmState(actor);
    }
    await this.prisma.appInstallState.update({
      where: { id: current.id },
      data: {
        tenantId: scope.tenantId,
        actorUserId: scope.actorUserId,
        installStatus: 'uninstalled',
        uninstalledAt: new Date(),
        entitlementSnapshot: this.buildEntitlementSnapshot(scope, 'uninstall'),
      },
    });
    return this.getCrmState(actor);
  }

  async assertCrmInstalled(actor: AppMarketActor) {
    const scope = await this.resolveScope(actor);
    const record = await this.findState(scope);
    const state = this.toCrmState(record, scope);
    if (!state.access.allowedActions.includes('open')) {
      throw new ForbiddenException({
        code:
          state.access.state === 'commercial_blocked'
            ? 'crm_commercial_entitlement_required'
            : 'crm_app_access_blocked',
        message: state.access.nextActionLabel,
        appKey: CRM_APP_KEY,
        action: 'access',
        access: state.access,
        purchaseStatus: state.purchaseStatus,
        installStatus: state.installStatus,
        entitlementSource: state.entitlementSource,
        entitlementPlan: state.entitlementPlan,
      });
    }
    return state;
  }

  private async resolveScope(actor: AppMarketActor): Promise<AppMarketScope> {
    if (typeof actor === 'string' || !actor) {
      return {
        userId: actor || 'local-user',
        tenantId: null,
        actorUserId: actor || 'local-user',
        entitlementSource: 'legacy-user',
        entitlementPlan: null,
        commercialEntitled: true,
        commercialEntitlementRequired: false,
        commercialBlockers: [],
        commercialWarnings: ['legacy-user-bypass'],
      };
    }

    const entitlement =
      await this.entitlements.getEffectiveEntitlementForUser(actor);
    const features = entitlement.features || [];
    const hasCrmFeature =
      features.includes('crm') ||
      entitlement.source === 'local-commercial-override';
    // A verified, active Kaypal plan grants product access to the CRM app even
    // when the separate external-action execution grant is not enabled.
    const hasCrmProductGrant =
      entitlement.cloudSubscriptionActive ||
      entitlement.commercialExecutionAllowed;
    const crmProductEntitled = hasCrmProductGrant && hasCrmFeature;
    const crmFeatureBlockers =
      hasCrmProductGrant && !hasCrmFeature ? ['crm-feature-not-entitled'] : [];
    const crmEntitlementBlockers = (entitlement.blockers || []).filter(
      (blocker) =>
        !(crmProductEntitled && blocker === 'missing-commercial-entitlement'),
    );
    const requestUser = this.authRequestContext?.get()?.user;
    const selectedTenantId =
      requestUser?.id === actor.id
        ? await this.authRequestContext!.resolveTenantId(this.prisma)
        : null;

    return {
      userId: actor.id,
      tenantId:
        selectedTenantId ||
        (entitlement.tenant.source === 'persisted-default'
          ? entitlement.tenant.tenantId
          : null),
      actorUserId: actor.id,
      entitlementSource: entitlement.source,
      entitlementPlan: entitlement.plan,
      commercialEntitled: crmProductEntitled,
      commercialEntitlementRequired: true,
      commercialBlockers: [...crmEntitlementBlockers, ...crmFeatureBlockers],
      commercialWarnings: [
        ...(entitlement.warnings || []),
        ...(entitlement.tenant.warnings || []),
      ],
    };
  }

  private async findState(
    scope: AppMarketScope,
  ): Promise<AppInstallState | null> {
    if (scope.tenantId) {
      const scoped = await this.prisma.appInstallState.findUnique({
        where: {
          tenantId_appKey: {
            tenantId: scope.tenantId,
            appKey: CRM_APP_KEY,
          },
        },
      });
      if (scoped) {
        return scoped;
      }
    }

    const legacy = await this.prisma.appInstallState.findUnique({
      where: { userId_appKey: { userId: scope.userId, appKey: CRM_APP_KEY } },
    });
    if (legacy && scope.tenantId && !legacy.tenantId) {
      return this.prisma.appInstallState
        .update({
          where: { id: legacy.id },
          data: {
            tenantId: scope.tenantId,
            actorUserId: scope.actorUserId,
            entitlementSnapshot: this.buildEntitlementSnapshot(
              scope,
              'migrate',
            ),
          },
        })
        .catch(() => legacy);
    }
    return legacy;
  }

  private async upsertState(
    scope: AppMarketScope,
    data: Pick<
      AppInstallState,
      'purchaseStatus' | 'installStatus' | 'purchasedAt'
    > & {
      entitlementSnapshot: Prisma.InputJsonValue;
    },
  ) {
    if (scope.tenantId) {
      return this.prisma.appInstallState.upsert({
        where: {
          tenantId_appKey: {
            tenantId: scope.tenantId,
            appKey: CRM_APP_KEY,
          },
        },
        create: {
          userId: scope.userId,
          tenantId: scope.tenantId,
          actorUserId: scope.actorUserId,
          appKey: CRM_APP_KEY,
          purchaseStatus: data.purchaseStatus,
          installStatus: data.installStatus,
          purchasedAt: data.purchasedAt,
          entitlementSnapshot: data.entitlementSnapshot,
        },
        update: {
          userId: scope.userId,
          actorUserId: scope.actorUserId,
          purchaseStatus: data.purchaseStatus,
          purchasedAt: data.purchasedAt,
          entitlementSnapshot: data.entitlementSnapshot,
        },
      });
    }

    return this.prisma.appInstallState.upsert({
      where: { userId_appKey: { userId: scope.userId, appKey: CRM_APP_KEY } },
      create: {
        userId: scope.userId,
        actorUserId: scope.actorUserId,
        appKey: CRM_APP_KEY,
        purchaseStatus: data.purchaseStatus,
        installStatus: data.installStatus,
        purchasedAt: data.purchasedAt,
        entitlementSnapshot: data.entitlementSnapshot,
      },
      update: {
        actorUserId: scope.actorUserId,
        purchaseStatus: data.purchaseStatus,
        purchasedAt: data.purchasedAt,
        entitlementSnapshot: data.entitlementSnapshot,
      },
    });
  }

  private buildEntitlementSnapshot(
    scope: AppMarketScope,
    action: string,
  ): Prisma.InputJsonObject {
    const installStatus: AppInstallStatus =
      action === 'install'
        ? 'installed'
        : action === 'uninstall'
          ? 'uninstalled'
          : 'not_installed';
    return {
      source: 'tenant_app_market',
      appKey: CRM_APP_KEY,
      action,
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      legacyUserId: scope.userId,
      entitlementSource: scope.entitlementSource,
      entitlementPlan: scope.entitlementPlan,
      commercialEntitled: scope.commercialEntitled,
      commercialEntitlementRequired: scope.commercialEntitlementRequired,
      commercialBlockers: scope.commercialBlockers,
      commercialWarnings: scope.commercialWarnings,
      accessPolicy: {
        ...this.buildAccessPolicy({
          purchaseStatus: 'purchased',
          installStatus,
          commercialEntitled: scope.commercialEntitled,
          commercialEntitlementRequired: scope.commercialEntitlementRequired,
          commercialBlockers: scope.commercialBlockers,
          commercialWarnings: scope.commercialWarnings,
        }),
      },
      updatedAt: new Date().toISOString(),
    };
  }

  private toCrmState(
    value: AppInstallState | null,
    scope?: AppMarketScope,
  ): MarketAppState {
    const purchaseStatus = this.normalizePurchaseStatus(value?.purchaseStatus);
    const installStatus = this.normalizeInstallStatus(value?.installStatus);
    const commercialEntitled = scope?.commercialEntitled ?? true;
    const commercialEntitlementRequired =
      scope?.commercialEntitlementRequired ?? false;
    const access = this.buildAccessPolicy({
      purchaseStatus,
      installStatus,
      commercialEntitled,
      commercialEntitlementRequired,
      commercialBlockers: scope?.commercialBlockers ?? [],
      commercialWarnings: scope?.commercialWarnings ?? [],
    });
    return {
      ...CRM_APP_META,
      tenantId: value?.tenantId ?? scope?.tenantId ?? null,
      actorUserId: value?.actorUserId ?? scope?.actorUserId ?? null,
      scope: value?.tenantId || scope?.tenantId ? 'tenant' : 'legacy-user',
      purchaseStatus,
      installStatus,
      purchased: purchaseStatus === 'purchased',
      installed:
        purchaseStatus === 'purchased' && installStatus === 'installed',
      commercialEntitled,
      commercialEntitlementRequired,
      entitlementSource: scope?.entitlementSource ?? 'legacy-user',
      entitlementPlan: scope?.entitlementPlan ?? null,
      commercialBlockers: scope?.commercialBlockers ?? [],
      commercialWarnings: scope?.commercialWarnings ?? [],
      access,
      canPurchase: access.allowedActions.includes('purchase'),
      canInstall: access.allowedActions.includes('install'),
      purchasedAt: value?.purchasedAt?.toISOString() ?? null,
      installedAt: value?.installedAt?.toISOString() ?? null,
      uninstalledAt: value?.uninstalledAt?.toISOString() ?? null,
    };
  }

  private assertCommercialCrmEntitled(scope: AppMarketScope, action: string) {
    if (!scope.commercialEntitlementRequired || scope.commercialEntitled) {
      return;
    }

    throw new ForbiddenException({
      code: 'crm_commercial_entitlement_required',
      message: 'CRM 客户管理需要有效商用授权后才能购买、安装或访问',
      action,
      blockers: scope.commercialBlockers,
      entitlementSource: scope.entitlementSource,
      entitlementPlan: scope.entitlementPlan,
    });
  }

  private normalizePurchaseStatus(value?: string | null): AppPurchaseStatus {
    return value === 'purchased' ? 'purchased' : 'not_purchased';
  }

  private normalizeInstallStatus(value?: string | null): AppInstallStatus {
    if (value === 'installed' || value === 'uninstalled') return value;
    return 'not_installed';
  }

  private buildAccessPolicy(input: {
    purchaseStatus: AppPurchaseStatus;
    installStatus: AppInstallStatus;
    commercialEntitled: boolean;
    commercialEntitlementRequired: boolean;
    commercialBlockers: string[];
    commercialWarnings: string[];
  }): MarketAppAccessPolicy {
    if (input.commercialEntitlementRequired && !input.commercialEntitled) {
      return this.withAccessProof({
        state: 'commercial_blocked',
        primaryAction: 'contact_sales',
        allowedActions: ['contact_sales'],
        nextActionLabel: 'CRM 客户管理需要有效商用授权后才能购买、安装或访问',
        blockers: input.commercialBlockers.length
          ? input.commercialBlockers
          : ['missing-commercial-entitlement'],
        warnings: input.commercialWarnings,
        requiresCommercialEntitlement: true,
        requiresPurchase: input.purchaseStatus !== 'purchased',
        requiresInstall: input.installStatus !== 'installed',
      });
    }

    if (input.purchaseStatus !== 'purchased') {
      return this.withAccessProof({
        state: 'not_purchased',
        primaryAction: 'purchase',
        allowedActions: ['purchase'],
        nextActionLabel: '先购买 CRM 客户管理应用',
        blockers: ['crm-not-purchased'],
        warnings: input.commercialWarnings,
        requiresCommercialEntitlement: input.commercialEntitlementRequired,
        requiresPurchase: true,
        requiresInstall: true,
      });
    }

    if (input.installStatus === 'uninstalled') {
      return this.withAccessProof({
        state: 'uninstalled',
        primaryAction: 'install',
        allowedActions: ['install'],
        nextActionLabel: 'CRM 已购买但当前已卸载，可重新安装后访问',
        blockers: ['crm-uninstalled'],
        warnings: input.commercialWarnings,
        requiresCommercialEntitlement: input.commercialEntitlementRequired,
        requiresPurchase: false,
        requiresInstall: true,
      });
    }

    if (input.installStatus !== 'installed') {
      return this.withAccessProof({
        state: 'not_installed',
        primaryAction: 'install',
        allowedActions: ['install'],
        nextActionLabel: 'CRM 已购买，安装后开放客户管理入口',
        blockers: ['crm-not-installed'],
        warnings: input.commercialWarnings,
        requiresCommercialEntitlement: input.commercialEntitlementRequired,
        requiresPurchase: false,
        requiresInstall: true,
      });
    }

    return this.withAccessProof({
      state: 'installed',
      primaryAction: 'open',
      allowedActions: ['open', 'uninstall'],
      nextActionLabel: 'CRM 已购买并安装，可进入客户管理',
      blockers: [],
      warnings: input.commercialWarnings,
      requiresCommercialEntitlement: input.commercialEntitlementRequired,
      requiresPurchase: false,
      requiresInstall: false,
    });
  }

  private withAccessProof(
    input: Omit<MarketAppAccessPolicy, 'proofHash'>,
  ): MarketAppAccessPolicy {
    return {
      ...input,
      proofHash: crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            appKey: CRM_APP_KEY,
            state: input.state,
            primaryAction: input.primaryAction,
            blockers: input.blockers,
            requiresCommercialEntitlement: input.requiresCommercialEntitlement,
            requiresPurchase: input.requiresPurchase,
            requiresInstall: input.requiresInstall,
          }),
        )
        .digest('hex'),
    };
  }
}

type AppMarketActor = AuthenticatedUser | string | undefined | null;

interface AppMarketScope {
  userId: string;
  tenantId: string | null;
  actorUserId: string | null;
  entitlementSource: string;
  entitlementPlan: string | null;
  commercialEntitled: boolean;
  commercialEntitlementRequired: boolean;
  commercialBlockers: string[];
  commercialWarnings: string[];
}
