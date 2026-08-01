export type EffectiveEntitlementSource =
  | 'kaypal-subscription'
  | 'local-commercial-override'
  | 'trial'
  | 'anonymous';

export interface EffectiveTenantContext {
  tenantId: string;
  source: 'synthetic-user' | 'persisted-default' | 'anonymous';
  role: string;
  permissions: string[];
  warnings: string[];
}

export interface EffectiveEntitlement {
  userId: string;
  source: EffectiveEntitlementSource;
  plan: string;
  planExpired: boolean;
  kaypalUserId: string | null;
  cloudSubscriptionActive: boolean;
  localCommercialAllowed: boolean;
  commercialExecutionAllowed: boolean;
  planMode: string;
  role: string;
  tenant: EffectiveTenantContext;
  features: string[];
  blockers: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
}
