import {
  validateActionInput,
  actionRiskLevel,
  LEAD_ACTION_TYPES,
} from './action-contract';
import { classifyReply, isHumanReply, triggersSuppression, REPLY_CATEGORIES } from '../lead-intelligence/reply-classifier';

describe('ActionContract', () => {
  const validInput = {
    tenantId: 't1',
    userId: 'u1',
    leadId: 'l1',
    action: 'draft_reply' as const,
    reason: '用户询问价格，草拟回复',
    evidenceIds: ['ev-1'],
    idempotencyKey: 'k-1',
    payload: { text: '您好，价格是 999 元' },
  };

  it('合法输入通过', () => {
    expect(() => validateActionInput(validInput)).not.toThrow();
  });

  it('缺 idempotencyKey → 抛错（幂等是硬要求）', () => {
    expect(() => validateActionInput({ ...validInput, idempotencyKey: '' })).toThrow('幂等键');
  });

  it('AI 输入不直接执行：reason 过短抛错', () => {
    expect(() => validateActionInput({ ...validInput, reason: '嗯' })).toThrow('reason 过短');
  });

  it('send_reply 必须带 payload.text', () => {
    expect(() =>
      validateActionInput({ ...validInput, action: 'send_reply', payload: undefined }),
    ).toThrow('payload.text');
  });

  it('batch_outreach 必须带 targetIds', () => {
    expect(() =>
      validateActionInput({ ...validInput, action: 'batch_outreach' }),
    ).toThrow('targetIds');
  });

  it('未知动作类型抛错', () => {
    expect(() =>
      validateActionInput({ ...validInput, action: 'unknown_action' as never }),
    ).toThrow('未知动作类型');
  });

  it('风险等级：create_task/draft_reply=low，convert_crm=medium，send_reply/batch_outreach=high', () => {
    expect(actionRiskLevel('create_task')).toBe('low');
    expect(actionRiskLevel('draft_reply')).toBe('low');
    expect(actionRiskLevel('request_review')).toBe('low');
    expect(actionRiskLevel('convert_crm')).toBe('medium');
    expect(actionRiskLevel('send_reply')).toBe('high');
    expect(actionRiskLevel('batch_outreach')).toBe('high');
  });

  it('LEAD_ACTION_TYPES 完整', () => {
    expect(LEAD_ACTION_TYPES).toContain('batch_outreach');
    expect(LEAD_ACTION_TYPES).toHaveLength(6);
  });
});

describe('ReplyClassifier', () => {
  it('unsubscribe → 触发 suppression', () => {
    const r = classifyReply('请退订，别再发了');
    expect(r.category).toBe('unsubscribe');
    expect(triggersSuppression(r.category)).toBe(true);
  });

  it('spam 机器回复不算人工回复', () => {
    const r = classifyReply('恭喜您中奖了！点击链接领取');
    expect(r.category).toBe('spam');
    expect(isHumanReply(r.category)).toBe(false);
  });

  it('negative → 不触发 suppression', () => {
    const r = classifyReply('不感兴趣，别联系了');
    expect(r.category).toBe('negative');
    expect(triggersSuppression(r.category)).toBe(false);
  });

  it('out_of_office → 保留线索', () => {
    const r = classifyReply('我在休假，下个月回来');
    expect(r.category).toBe('out_of_office');
  });

  it('question → 需跟进', () => {
    const r = classifyReply('这个多少钱？怎么买');
    expect(r.category).toBe('question');
  });

  it('positive → 正向', () => {
    const r = classifyReply('好的，感兴趣，我们聊聊');
    expect(r.category).toBe('positive');
  });

  it('模糊默认 ambiguous', () => {
    const r = classifyReply('哦');
    expect(r.category).toBe('ambiguous');
  });

  it('REPLY_CATEGORIES 7 类完整', () => {
    expect(REPLY_CATEGORIES).toHaveLength(7);
  });
});
