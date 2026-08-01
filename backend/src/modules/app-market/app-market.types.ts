export const CRM_APP_KEY = 'crm';

export type AppPurchaseStatus = 'not_purchased' | 'purchased';
export type AppInstallStatus = 'not_installed' | 'installed' | 'uninstalled';
export type MarketAppAccessState =
  | 'commercial_blocked'
  | 'not_purchased'
  | 'not_installed'
  | 'uninstalled'
  | 'installed';
export type MarketAppAction =
  | 'purchase'
  | 'install'
  | 'open'
  | 'uninstall'
  | 'contact_sales';

export interface MarketAppAccessPolicy {
  state: MarketAppAccessState;
  primaryAction: MarketAppAction;
  allowedActions: MarketAppAction[];
  nextActionLabel: string;
  blockers: string[];
  warnings: string[];
  requiresCommercialEntitlement: boolean;
  requiresPurchase: boolean;
  requiresInstall: boolean;
  proofHash: string;
}

export interface MarketAppState {
  appKey: string;
  tenantId: string | null;
  actorUserId: string | null;
  scope: 'tenant' | 'legacy-user';
  name: string;
  description: string;
  priceLabel: string;
  purchaseStatus: AppPurchaseStatus;
  installStatus: AppInstallStatus;
  purchased: boolean;
  installed: boolean;
  commercialEntitled: boolean;
  commercialEntitlementRequired: boolean;
  entitlementSource: string;
  entitlementPlan: string | null;
  commercialBlockers: string[];
  commercialWarnings: string[];
  access: MarketAppAccessPolicy;
  canPurchase: boolean;
  canInstall: boolean;
  purchasedAt: string | null;
  installedAt: string | null;
  uninstalledAt: string | null;
}
