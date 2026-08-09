import {
  getKaypalPlanRank,
  isKaypalPlanAtLeast,
  normalizeKaypalPlan,
} from './plan-order';

describe('Kaypal plan order', () => {
  it('normalizes plan aliases and casing from Kaypal payloads', () => {
    expect(normalizeKaypalPlan('advanced')).toBe('ADVANCED');
    expect(normalizeKaypalPlan(' Enterprise ')).toBe('FLAGSHIP');
    expect(normalizeKaypalPlan(null)).toBe('FREE');
  });

  it('treats advanced and flagship plans as pro or above', () => {
    expect(isKaypalPlanAtLeast('ADVANCED', 'PRO')).toBe(true);
    expect(isKaypalPlanAtLeast('enterprise', 'PRO')).toBe(true);
    expect(isKaypalPlanAtLeast('FREE', 'PRO')).toBe(false);
  });

  it('keeps unknown plans at free rank instead of granting access', () => {
    expect(getKaypalPlanRank('UNKNOWN_PLAN')).toBe(0);
    expect(isKaypalPlanAtLeast('UNKNOWN_PLAN', 'PRO')).toBe(false);
  });
});
