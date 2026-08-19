import { BadRequestException, Injectable } from '@nestjs/common';
import { safeText } from '../../common/text.utils';

/**
 * 互动规则引擎安全边界（六步闭环 15.4#5，借鉴 Chatwoot automation_rule）。
 *
 * 核心：规则不是「任意 JSON 直接执行」，而是先校验条件 key / 动作 name /
 * 操作符都在白名单内。Chatwoot 的 automation_rule 会在规则更新时清理旧
 * pending executions，此处用规则版本 + 白名单保证规则不越权执行。
 *
 * 一期只允许报告 15.3 定义的小集合（条件 7 类 / 动作 7 类）。
 */

export type RuleConditionOperator =
  'equals' | 'not_equals' | 'contains' | 'gte' | 'lte' | 'in';

export interface RuleCondition {
  key: string;
  operator: RuleConditionOperator;
  value: string | number | string[];
}

export type RuleActionName =
  | 'add_tag'
  | 'assign_owner'
  | 'create_lead'
  | 'create_crm_customer'
  | 'create_follow_up_task'
  | 'draft_reply'
  | 'request_human_approval';

export interface RuleAction {
  name: RuleActionName;
  params: Record<string, unknown>;
}

export interface InteractionRule {
  id?: string;
  version: number;
  name: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

/** 条件 key 白名单（报告 15.3） */
export const CONDITION_KEYS = new Set([
  'content_contains',
  'platform',
  'account_id',
  'lead_score_gte',
  'source_article_id',
  'status',
  'has_reply',
]);

/** 动作 name 白名单（报告 15.3） */
export const ACTION_NAMES = new Set<RuleActionName>([
  'add_tag',
  'assign_owner',
  'create_lead',
  'create_crm_customer',
  'create_follow_up_task',
  'draft_reply',
  'request_human_approval',
]);

const OPERATORS = new Set<RuleConditionOperator>([
  'equals',
  'not_equals',
  'contains',
  'gte',
  'lte',
  'in',
]);

@Injectable()
export class InteractionRuleService {
  /** 校验整条规则：条件/动作/操作符都在白名单，非法抛 BadRequest */
  validateRule(rule: InteractionRule): void {
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
      throw new BadRequestException('规则必须至少包含一个条件');
    }
    if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
      throw new BadRequestException('规则必须至少包含一个动作');
    }

    for (const condition of rule.conditions) {
      if (!CONDITION_KEYS.has(condition.key)) {
        throw new BadRequestException(
          `不支持的条件字段：${condition.key}（白名单：${[...CONDITION_KEYS].join(', ')}）`,
        );
      }
      if (!OPERATORS.has(condition.operator)) {
        throw new BadRequestException(
          `不支持的条件操作符：${condition.operator}`,
        );
      }
    }

    for (const action of rule.actions) {
      if (!ACTION_NAMES.has(action.name)) {
        throw new BadRequestException(
          `不支持的动作：${action.name}（白名单：${[...ACTION_NAMES].join(', ')}）`,
        );
      }
    }
  }

  /** 判断事件是否匹配规则的全部条件（AND） */
  evaluateConditions(
    conditions: RuleCondition[],
    event: Record<string, unknown>,
  ): boolean {
    return conditions.every((condition) => {
      const actual = event[condition.key];
      switch (condition.operator) {
        case 'equals':
          return safeText(actual) === String(condition.value);
        case 'not_equals':
          return safeText(actual) !== String(condition.value);
        case 'contains':
          return safeText(actual).includes(String(condition.value));
        case 'gte':
          return Number(actual ?? 0) >= Number(condition.value);
        case 'lte':
          return Number(actual ?? 0) <= Number(condition.value);
        case 'in':
          return (
            Array.isArray(condition.value) &&
            condition.value.map(String).includes(safeText(actual))
          );
        default:
          return false;
      }
    });
  }

  /** 匹配规则：先校验白名单，再判断条件是否命中（命中返回动作，否则 null） */
  match(
    rule: InteractionRule,
    event: Record<string, unknown>,
  ): RuleAction[] | null {
    this.validateRule(rule);
    return this.evaluateConditions(rule.conditions, event)
      ? rule.actions
      : null;
  }
}
