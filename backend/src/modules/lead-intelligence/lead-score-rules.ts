// 线索评分规则（PRD SCORE-001~003 + 开发文档 §8，统一开发计划 §八）
// 核心：关键词分数 ≠ 客户价值，拆 fit/intent/identity/engagement/recency/risk 六维。
// 每个信号带「分值 + 有效期」，过期不计入即时 intent（时间衰减）。

/** 信号维度（对应 LeadScoreSnapshot.components 的 key） */
export type ScoreDimension =
  'intent' | 'fit' | 'identity' | 'engagement' | 'recency' | 'risk';

/** 各维度满分上限（开发文档 §8.1 公式） */
export const DIMENSION_MAX: Record<ScoreDimension, number> = {
  intent: 35,
  fit: 25,
  identity: 15,
  engagement: 10,
  recency: 10,
  risk: 30, // 扣分维度，上限即最多扣 30
};

/** 总分 clamp 区间 */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** 规则版本号（存进 snapshot.ruleVersion，评分逻辑变更时递增） */
export const RULE_VERSION = '1.0.0';

/**
 * 信号规则表：type → { score, decayHours, dimension }
 * - decayHours = null 表示永久画像（fit/identity/risk），不参与时间衰减
 * - decayHours = 数值表示该信号从 observedAt 起 N 小时后过期
 */
export interface SignalRule {
  score: number;
  decayHours: number | null;
  dimension: ScoreDimension;
}

export const SIGNAL_RULES: Record<string, SignalRule> = {
  // —— intent（购买意向，0-35，有时效）——
  'intent.explicit_request': { score: 15, decayHours: 72, dimension: 'intent' },
  'intent.price': { score: 10, decayHours: 168, dimension: 'intent' },
  'intent.question': { score: 8, decayHours: 168, dimension: 'intent' },
  'intent.timeline': { score: 5, decayHours: 168, dimension: 'intent' },
  // —— fit（匹配度，0-25，永久画像，只作 fit 不作即时 intent）——
  'fit.industry': { score: 8, decayHours: null, dimension: 'fit' },
  'fit.role': { score: 10, decayHours: null, dimension: 'fit' },
  'fit.region': { score: 7, decayHours: null, dimension: 'fit' },
  'fit.company_event': { score: 5, decayHours: 720, dimension: 'fit' },
  // —— identity（身份质量，0-15）——
  'account.verified': { score: 15, decayHours: null, dimension: 'identity' },
  'identity.profile_url': { score: 8, decayHours: null, dimension: 'identity' },
  'identity.nickname_match': {
    score: 3,
    decayHours: null,
    dimension: 'identity',
  },
  // —— engagement（互动深度，0-10）——
  'engagement.repeat': { score: 7, decayHours: 336, dimension: 'engagement' },
  'engagement.reply': { score: 3, decayHours: 168, dimension: 'engagement' },
  // —— recency（时效，0-10）——
  'recency.last_7d': { score: 10, decayHours: 168, dimension: 'recency' },
  // —— risk（风险扣分，0-30）——
  'risk.spam': { score: 15, decayHours: null, dimension: 'risk' },
  'risk.duplicate': { score: 10, decayHours: null, dimension: 'risk' },
  'risk.opt_out': { score: 30, decayHours: null, dimension: 'risk' },
};

/**
 * 判断信号是否过期（时间衰减）。
 * - 规则表里没有该 type → 不衰减（返回 false）
 * - decayHours = null → 永久，不过期
 * - 否则按 observedAt + decayHours 计算，晚于 now 视为过期
 */
export function isExpired(
  type: string,
  observedAt: Date,
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const rule = SIGNAL_RULES[type];
  if (!rule || rule.decayHours === null) return false;
  const effectiveExpiry =
    expiresAt ?? new Date(observedAt.getTime() + rule.decayHours * 3600_000);
  return effectiveExpiry.getTime() < now.getTime();
}

/** clamp 到 [min, max]（0 分与「无数据 null」区分由调用方保证） */
export function clamp(value: number, max: number, min = 0): number {
  return Math.max(min, Math.min(max, value));
}

/** 按维度聚合信号分值（应用衰减 + clamp 到维度上限） */
export function aggregateByDimension(
  signals: Array<{
    type: string;
    value: number;
    observedAt: Date;
    expiresAt?: Date | null;
  }>,
  now: Date = new Date(),
): Record<ScoreDimension, number> {
  const totals: Record<ScoreDimension, number> = {
    intent: 0,
    fit: 0,
    identity: 0,
    engagement: 0,
    recency: 0,
    risk: 0,
  };

  for (const s of signals) {
    const rule = SIGNAL_RULES[s.type];
    if (!rule) continue;
    // 时间衰减：过期的信号不计入即时 intent/engagement/recency
    if (isExpired(s.type, s.observedAt, s.expiresAt, now)) continue;
    totals[rule.dimension] += s.value;
  }

  // 每个维度 clamp 到上限
  for (const dim of Object.keys(totals) as ScoreDimension[]) {
    totals[dim] = clamp(totals[dim], DIMENSION_MAX[dim]);
  }
  return totals;
}

/**
 * 计算总分（开发文档 §8.1 公式）：
 * total = intent + fit + identity + engagement + recency - risk
 * clamp 到 [0, 100]。
 */
export function computeTotal(
  components: Record<ScoreDimension, number>,
): number {
  const raw =
    components.intent +
    components.fit +
    components.identity +
    components.engagement +
    components.recency -
    components.risk;
  return clamp(raw, SCORE_MAX, SCORE_MIN);
}
