import type { EffectiveEntitlementSource } from '../entitlements/entitlements.types';
import type { AuthenticatedUser } from '../auth/auth.types';

export interface TenantEntitlementSnapshot {
  source: EffectiveEntitlementSource;
  plan: string;
  status: string;
  features: string[];
  commercialExecutionAllowed: boolean;
  metadata?: Record<string, unknown>;
}

export interface TenantContext {
  tenantId: string;
  source: 'persisted-default';
  role: string;
  permissions: string[];
  warnings: string[];
}

export interface EnsureDefaultTenantInput {
  user: AuthenticatedUser;
  entitlement: TenantEntitlementSnapshot;
}

export interface StoredTenantEntitlement {
  id: string;
  tenantId: string;
  source: EffectiveEntitlementSource;
  plan: string;
  status: string;
  features: string[];
  commercialExecutionAllowed: boolean;
  externalSubscriptionId: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  metadata: Record<string, unknown>;
  updatedAt: Date;
}
