import { QualificationService, QUALIFICATION_RULES } from './qualification.service';

const svc = new QualificationService();

function snap(totalScore: number, over: Partial<{ riskScore: number; identityConfidence: number; confidence: number; reasons: string[] }> = {}) {
  return {
    totalScore,
    riskScore: over.riskScore ?? 0,
    identityConfidence: over.identityConfidence ?? 15,
    confidence: over.confidence ?? 100,
    reasons: over.reasons ?? [],
  };
}

describe('QualificationService', () => {
  it('suppression 优先于一切 → blocked（即使总分最高）', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(95), suppressed: true });
    expect(r.outcome).toBe('blocked');
  });

  it('高风险标记 → blocked', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(95), highRisk: true });
    expect(r.outcome).toBe('blocked');
  });

  it('riskScore 大扣分（≥阈值）→ nurture，不进 qualified', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(70, { riskScore: 15 }) });
    expect(r.outcome).toBe('nurture');
  });

  it('identity 弱（<5）→ nurture（uncertain 不丢弃）', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(85, { identityConfidence: 0 }) });
    expect(r.outcome).toBe('nurture');
    expect(r.reason).toContain('补充研究');
  });

  it('高分 → review', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(QUALIFICATION_RULES.highScoreThreshold) });
    expect(r.outcome).toBe('review');
  });

  it('通过资格门（未审批）→ qualified', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(50) });
    expect(r.outcome).toBe('qualified');
  });

  it('通过资格门 + 审批 + 预算充足 → action_ready', () => {
    const r = svc.route({
      tenantId: 't1', leadId: 'l1', snapshot: snap(50),
      approved: true, budget: { remaining: 100 },
    });
    expect(r.outcome).toBe('action_ready');
  });

  it('通过资格门 + 审批但预算不足 → qualified（不是 action_ready）', () => {
    const r = svc.route({
      tenantId: 't1', leadId: 'l1', snapshot: snap(50),
      approved: true, budget: { remaining: 0 },
    });
    expect(r.outcome).toBe('qualified');
    expect(r.reason).toContain('预算不足');
  });

  it('低分 → nurture（培育，非丢弃）', () => {
    const r = svc.route({ tenantId: 't1', leadId: 'l1', snapshot: snap(10) });
    expect(r.outcome).toBe('nurture');
  });
});
