export const CRM_APP_KEY = 'crm';

/** 应用目录条目（报告 16.3 第 24 项：从单一 CRM 升级为功能目录） */
export interface AppCatalogEntry {
  appKey: string;
  name: string;
  description: string;
  priceLabel: string;
  /** 该 app 需要具备的 entitlement feature key（resolveScope 里判断） */
  entitlementFeature: string;
  /** 是否有购买/安装/卸载生命周期（false 表示随套餐默认开放） */
  installable: boolean;
}

/** 应用目录：新增 app 只需在此追加一条元数据 */
export const APP_CATALOG: AppCatalogEntry[] = [
  {
    appKey: CRM_APP_KEY,
    name: 'CRM 客户管理',
    description: '承接自动获客线索、客户档案、跟进时间线和来源证据。',
    priceLabel: '高级版可购买',
    entitlementFeature: 'crm',
    // CRM 是产品内置核心功能，默认就在、随套餐默认开放，不再作为「安装项」走购买/安装生命周期
    installable: false,
  },
];

export function getCatalogEntry(appKey: string): AppCatalogEntry | undefined {
  return APP_CATALOG.find((entry) => entry.appKey === appKey);
}

export type AppPurchaseStatus = 'not_purchased' | 'purchased';
export type AppInstallStatus = 'not_installed' | 'installed' | 'uninstalled';
export type MarketAppAccessState =
  | 'commercial_blocked'
  | 'not_purchased'
  | 'not_installed'
  | 'uninstalled'
  | 'installed';
export type MarketAppAction =
  'purchase' | 'install' | 'open' | 'uninstall' | 'contact_sales';

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
