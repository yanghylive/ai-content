import {
  ACTION_NAMES,
  CONDITION_KEYS,
  InteractionRuleService,
  type InteractionRule,
} from './interaction-rule.service';

const validRule: InteractionRule = {
  version: 1,
  name: '高意向评论自动转线索',
  conditions: [
    { key: 'content_contains', operator: 'contains', value: '怎么收费' },
    { key: 'platform', operator: 'equals', value: 'douyin' },
  ],
  actions: [{ name: 'create_lead', params: {} }],
};

describe('InteractionRuleService', () => {
  let service: InteractionRuleService;

  beforeEach(() => {
    service = new InteractionRuleService();
  });

  it('白名单覆盖报告 15.3 的 7 条件 + 7 动作', () => {
    expect(CONDITION_KEYS.size).toBe(7);
    expect(ACTION_NAMES.size).toBe(7);
  });

  it('合法规则校验通过', () => {
    expect(() => service.validateRule(validRule)).not.toThrow();
  });

  it('非法条件 key 抛错（不在白名单）', () => {
    expect(() =>
      service.validateRule({
        ...validRule,
        conditions: [{ key: 'delete_all', operator: 'equals', value: 'x' }],
      }),
    ).toThrow(/不支持的条件字段/);
  });

  it('非法动作 name 抛错（不在白名单）', () => {
    expect(() =>
      service.validateRule({
        ...validRule,
        actions: [{ name: 'drop_table' as never, params: {} }],
      }),
    ).toThrow(/不支持的动作/);
  });

  it('非法操作符抛错', () => {
    expect(() =>
      service.validateRule({
        ...validRule,
        conditions: [
          { key: 'platform', operator: 'exec' as never, value: 'x' },
        ],
      }),
    ).toThrow(/不支持的条件操作符/);
  });

  it('空条件/空动作抛错', () => {
    expect(() =>
      service.validateRule({ ...validRule, conditions: [] }),
    ).toThrow(/至少包含一个条件/);
    expect(() =>
      service.validateRule({ ...validRule, actions: [] }),
    ).toThrow(/至少包含一个动作/);
  });

  it('match 命中返回动作，未命中返回 null', () => {
    const hit = service.match(validRule, {
      content_contains: '会员怎么收费，有没有优惠',
      platform: 'douyin',
    });
    expect(hit).toHaveLength(1);
    expect(hit?.[0].name).toBe('create_lead');

    const miss = service.match(validRule, {
      content_contains: '路过看看',
      platform: 'xiaohongshu',
    });
    expect(miss).toBeNull();
  });

  it('evaluateConditions 覆盖各操作符', () => {
    const { evaluateConditions } = service;
    expect(
      evaluateConditions(
        [{ key: 'lead_score_gte', operator: 'gte', value: 80 }],
        { lead_score_gte: 90 },
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ key: 'platform', operator: 'in', value: ['douyin', 'xhs'] }],
        { platform: 'xhs' },
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        [{ key: 'has_reply', operator: 'equals', value: true }],
        { has_reply: true },
      ),
    ).toBe(true);
  });
});
