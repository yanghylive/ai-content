export type EffectiveEntitlementSource =
  'kaypal-subscription' | 'local-commercial-override' | 'trial' | 'anonymous';

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
  /** limit 类资源限额（报告 16.5）：席位规则，从 kaypal seatRule 映射 */
  limits: {
    seatMode: 'single' | 'shared' | 'per_seat' | 'custom';
    minSeats?: number;
    maxSeats?: number;
  } | null;
  blockers: string[];
  warnings: string[];
  evidence: Record<string, unknown>;
}
