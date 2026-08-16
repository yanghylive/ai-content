const PLAN_ALIASES: Record<string, string> = {
  PERSONAL: 'FREE',
  BASIC: 'STUDY',
  STARTER: 'STUDY',
  TEAM: 'ADVANCED',
  ENTERPRISE: 'FLAGSHIP',
  BUSINESS: 'FLAGSHIP',
};

export const KAYPAL_PLAN_ORDER = [
  'FREE',
  'STUDY',
  'STANDARD',
  'PRO',
  'ADVANCED',
  'FLAGSHIP',
] as const;

export function normalizeKaypalPlan(plan: unknown) {
  const normalized = typeof plan === 'string' ? plan.trim().toUpperCase() : '';
  if (!normalized) return 'FREE';
  return PLAN_ALIASES[normalized] || normalized;
}

export function getKaypalPlanRank(plan: unknown) {
  const normalized = normalizeKaypalPlan(plan);
  const index = KAYPAL_PLAN_ORDER.indexOf(
    normalized as (typeof KAYPAL_PLAN_ORDER)[number],
  );
  return index >= 0 ? index : 0;
}

export function isKaypalPlanAtLeast(
  currentPlan: unknown,
  requiredPlan: unknown,
) {
  return getKaypalPlanRank(currentPlan) >= getKaypalPlanRank(requiredPlan);
}

/** 席位规则（报告 16.5 limit 类资源限额）。数据源：kaypal subscription-catalog.ts 的 seatRule。 */
export interface PlanSeatRule {
  mode: 'single' | 'shared' | 'per_seat' | 'custom';
  minSeats?: number;
  maxSeats?: number;
}

// kaypal SUBSCRIPTION_CATALOG 的 seatRule 映射到本地 legacy plan：
// free/pro/standard → single(maxSeats 1)；team(ADVANCED) → shared(maxSeats 10)；
// business(FLAGSHIP) → per_seat(minSeats 1)；enterprise/private → custom（不在此表）。
const PLAN_SEAT_RULES: Record<string, PlanSeatRule> = {
  FREE: { mode: 'single', maxSeats: 1 },
  STUDY: { mode: 'single', maxSeats: 1 },
  STANDARD: { mode: 'single', maxSeats: 1 },
  PRO: { mode: 'single', maxSeats: 1 },
  ADVANCED: { mode: 'shared', maxSeats: 10 },
  FLAGSHIP: { mode: 'per_seat', minSeats: 1 },
};

export function getPlanSeatRule(plan: unknown): PlanSeatRule {
  const normalized = normalizeKaypalPlan(plan);
  return PLAN_SEAT_RULES[normalized] ?? { mode: 'single', maxSeats: 1 };
}

/**
 * 由 kaypal 云端订阅信息解析本地商用授权。
 * 商用分界线与 entitlements.resolveFeatures 一致：STANDARD（含）以上且未过期。
 * 登录回调据此同步 users.commercial_execution_allowed / plan_mode，
 * 修复「付费订阅（FLAGSHIP）登录后仍报缺少有效商用授权」的缺口。
 */
export function resolveCommercialGrant(input: {
  subscriptionPlan?: unknown;
  subscriptionPeriodEnd?: Date | string | number | null;
}): { commercialExecutionAllowed: boolean; planMode: 'commercial' | 'trial' } {
  const plan = normalizeKaypalPlan(input.subscriptionPlan);
  let expired = false;
  if (input.subscriptionPeriodEnd != null) {
    const t = new Date(input.subscriptionPeriodEnd as string | number | Date).getTime();
    expired = !Number.isNaN(t) && t < Date.now();
  }
  const commercial =
    !expired && getKaypalPlanRank(plan) >= getKaypalPlanRank('STANDARD');
  return {
    commercialExecutionAllowed: commercial,
    planMode: commercial ? 'commercial' : 'trial',
  };
}
