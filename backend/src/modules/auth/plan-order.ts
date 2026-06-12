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

export function isKaypalPlanAtLeast(currentPlan: unknown, requiredPlan: unknown) {
  return getKaypalPlanRank(currentPlan) >= getKaypalPlanRank(requiredPlan);
}
