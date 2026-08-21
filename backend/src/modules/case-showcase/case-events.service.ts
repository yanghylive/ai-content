import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InquiryRateLimiter } from './inquiry-rate-limiter';

/**
 * 案例展示中心 · 分析事件服务（M7-01）。
 *
 * 事件名白名单是唯一真源（与前端 lib/analytics/case-events.ts 同步），
 * 未知事件名一律 400 拒绝；props 只接受扁平基础类型值，剥离敏感键、
 * 截断超长字符串、丢弃嵌套对象，绝不落联系方式/需求正文/客户名称。
 *
 * M7 先打通链路：无独立事件表，Logger.log 记录 + 控制器返回 204；
 * 看板聚合（M7-02）或后续 reporting 再接。
 */

/** 事件名白名单（PRD §14.1 案例事件 + P0-P2 growth 事件；与前端同步） */
export const CASE_EVENT_NAMES = [
  'case_impression',
  'case_open',
  'search_submit',
  'filter_change',
  'media_view',
  'demo_open',
  'qr_view',
  'shortlink_open',
  'collection_open',
  'inquiry_start',
  'inquiry_submit',
  'case_feedback',
  // —— 3010 AI 客户增长（P0-P2 埋点，PRD §10.3）——
  'growth_home_viewed',
  'acquisition_task_created',
  'acquisition_preflight_completed',
  'acquisition_run_started',
  'acquisition_run_finished',
  'lead_opened',
  'lead_contacted',
  'lead_synced_to_crm',
  'opportunity_created',
  'opportunity_stage_changed',
  'opportunity_won',
  'execution_blocked',
  'execution_taken_over',
] as const;

export type CaseEventName = (typeof CASE_EVENT_NAMES)[number];

const EVENT_NAME_SET = new Set<string>(CASE_EVENT_NAMES);

/** 事件上报限流：每 IP 每分钟最多 120 个事件（防滥用，复用 M5 思路） */
export const EVENT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const EVENT_RATE_LIMIT_MAX = 120;

/** 单个事件 props 键数量上限 */
const MAX_PROPS = 20;
/** 字符串值最大长度（截断，防超长字符串滥用） */
const MAX_STRING_LENGTH = 200;
/** 键名最大长度 */
const MAX_KEY_LENGTH = 64;

/**
 * 禁止写入分析事件的敏感键黑名单（防御性兜底，即使前端漏传也在此剥离）。
 * 覆盖联系方式、需求正文、客户/公司名称等（PRD §14.4、架构 §13）。
 */
const SENSITIVE_KEY_PATTERN =
  /contact|phone|mobile|telephone|email|wechat|weixin|message|requirement|content|password|token|secret|credential|idcard|identity|address|company|organization|position|name/i;

export function isKnownEventName(name: unknown): name is CaseEventName {
  return typeof name === 'string' && EVENT_NAME_SET.has(name);
}

export interface SanitizedEventProps {
  [key: string]: string | number | boolean;
}

/**
 * 清洗事件 props：仅保留扁平基础类型值，剥离敏感键、截断超长字符串、
 * 丢弃嵌套对象/数组，绝不把敏感信息写入分析事件。
 */
export function sanitizeEventProps(raw: unknown): SanitizedEventProps {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const result: SanitizedEventProps = {};

  for (const key of Object.keys(source)) {
    if (Object.keys(result).length >= MAX_PROPS) break;
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;

    const value = source[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      result[key] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) result[key] = value;
    } else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) result[key] = trimmed.slice(0, MAX_STRING_LENGTH);
    }
    // 嵌套对象 / 数组 / 其他类型一律丢弃
  }

  return result;
}

@Injectable()
export class CaseEventsService {
  private readonly logger = new Logger(CaseEventsService.name);
  private readonly rateLimiter = new InquiryRateLimiter(
    EVENT_RATE_LIMIT_WINDOW_MS,
    EVENT_RATE_LIMIT_MAX,
  );

  /**
   * 校验事件名白名单 → 按 IP 限流 → 清洗 props → 日志记录。
   * 未知事件名抛 400，触发限流抛 429；正常路径返回 void（控制器回 204）。
   */
  record(raw: { name?: unknown; props?: unknown }, ip?: string): void {
    if (!isKnownEventName(raw?.name)) {
      throw new BadRequestException(
        `未知事件名：${typeof raw?.name === 'string' ? raw.name : ''}`,
      );
    }

    const key = `ip:${ip && ip.trim() ? ip.trim() : 'unknown'}`;
    if (!this.rateLimiter.allow(key)) {
      throw new HttpException(
        '事件上报过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.log(
      JSON.stringify({
        name: raw.name,
        props: sanitizeEventProps(raw?.props),
        receivedAt: new Date().toISOString(),
      }),
    );
  }
}
