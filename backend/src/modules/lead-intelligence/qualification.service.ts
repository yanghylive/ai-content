// 资格路由（开发文档 §8.2 第 6 步 + PRD，统一开发计划 §八）
// 按阈值把线索路由到 blocked / nurture / review / qualified / action_ready。
// 关键：low score ≠ uncertain——证据少/身份弱进补充研究或人工，不能当低价值丢弃。
import { Injectable } from '@nestjs/common';

export type QualificationOutcome =
  | 'blocked' // suppression/账号风险/违法敏感
  | 'nurture' // 低意向或低置信度
  | 'review' // 高分但需人工
  | 'qualified' // 通过资格门
  | 'action_ready'; // 通过审批+预算门

export interface QualificationInput {
  tenantId: string;
  leadId: string;
  snapshot: {
    totalScore: number;
    riskScore: number;
    identityConfidence: number;
    confidence: number;
    reasons: string[];
  };
  /** 命中抑制名单（任何 kind）→ blocked */
  suppressed?: boolean;
  /** 高风险标记（账号风险/违法敏感） */
  highRisk?: boolean;
  /** 审批已通过 */
  approved?: boolean;
  /** 预算门（剩余预算 > 0 才允许 action_ready） */
  budget?: { remaining: number };
}

export interface QualificationResult {
  outcome: QualificationOutcome;
  reason: string;
}

// —— 阈值（初版，规则版本变更时在 LEAD_QUALIFICATION_RULES 递增）——
export const QUALIFICATION_RULES = {
  version: '1.0.0',
  /** totalScore ≥ 该值视为高分（可 review） */
  highScoreThreshold: 60,
  /** totalScore ≥ 该值视为通过资格门 */
  qualifyThreshold: 40,
  /** identityConfidence < 该值 → 身份弱，最多 nurture（即使总分高也要人工确认） */
  minIdentityConfidence: 5,
  /** riskScore ≥ 该值 → nurture（不进 qualified，除非人工放行） */
  maxRiskForQualify: 10,
};

@Injectable()
export class QualificationService {
  /** 路由线索（suppression 优先于一切） */
  route(input: QualificationInput): QualificationResult {
    const { snapshot } = input;

    // 1. suppression / 高风险 / 违法敏感 → blocked（无条件优先）
    if (input.suppressed || input.highRisk) {
      return {
        outcome: 'blocked',
        reason: input.suppressed ? '命中抑制名单（退订/投诉/封禁），禁止外发' : '命中账号风险/违法敏感标记，禁止外发',
      };
    }

    // 2. riskScore 大扣分 → nurture（有风险但不到禁止，需人工判断）
    if (snapshot.riskScore >= QUALIFICATION_RULES.maxRiskForQualify) {
      return {
        outcome: 'nurture',
        reason: `风险扣分 ${snapshot.riskScore} 分，需人工复核后放行`,
      };
    }

    // 3. identity 弱 → 即使总分高也只到 nurture（uncertain 不丢弃，进补充研究/人工）
    if (snapshot.identityConfidence < QUALIFICATION_RULES.minIdentityConfidence) {
      return {
        outcome: 'nurture',
        reason: `身份置信度 ${snapshot.identityConfidence} 过低（<${QUALIFICATION_RULES.minIdentityConfidence}），线索不完整，进补充研究或人工确认`,
      };
    }

    // 4. 高分且需人工 → review
    if (snapshot.totalScore >= QUALIFICATION_RULES.highScoreThreshold) {
      return {
        outcome: 'review',
        reason: `总分 ${snapshot.totalScore} 达高分阈值，进人工复核`,
      };
    }

    // 5. 通过资格门 → qualified
    if (snapshot.totalScore >= QUALIFICATION_RULES.qualifyThreshold) {
      // 5b. 且通过审批 + 预算门 → action_ready
      if (input.approved && (input.budget?.remaining ?? 1) > 0) {
        return {
          outcome: 'action_ready',
          reason: `总分 ${snapshot.totalScore} 通过资格门且审批通过、预算充足，可执行下一步动作`,
        };
      }
      return {
        outcome: 'qualified',
        reason: input.approved === false
          ? `总分 ${snapshot.totalScore} 通过资格门，待审批`
          : (input.budget && input.budget.remaining <= 0)
            ? `总分 ${snapshot.totalScore} 通过资格门，预算不足`
            : `总分 ${snapshot.totalScore} 通过资格门`,
      };
    }

    // 6. 低分 → nurture（不等于丢弃；uncertain 已在第 3 步拦截）
    return {
      outcome: 'nurture',
      reason: `总分 ${snapshot.totalScore} 未达资格阈值，继续培育`,
    };
  }
}
