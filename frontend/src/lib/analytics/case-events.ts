import { getApiBase } from "@/lib/api/client";

/**
 * 案例展示中心 · 分析事件埋点（单一真源，M7）。
 *
 * 对应 PRD §14.1 的 12 个核心事件。事件名集中定义（CASE_EVENT_NAMES），
 * 组件只调用 trackCaseEvent，禁止各自拼接事件名字符串。
 *
 * 约束（PRD §14.4 隐私友好 + Codex §13）：
 *   - fire-and-forget：上报失败静默，绝不阻塞页面主流程；
 *   - 不携带联系方式 / 需求正文 / 客户名称等敏感字段（sanitizeEventProps 兜底剥离）；
 *   - 不引第三方埋点库，用轻量 fetch POST 到 /api/v1/events。
 */

/** 12 个允许上报的事件名白名单（与后端 case-events.service.ts 同步） */
export const CASE_EVENT_NAMES = [
  "case_impression",
  "case_open",
  "search_submit",
  "filter_change",
  "media_view",
  "demo_open",
  "qr_view",
  "shortlink_open",
  "collection_open",
  "inquiry_start",
  "inquiry_submit",
  "case_feedback",
] as const;

export type CaseEventName = (typeof CASE_EVENT_NAMES)[number];

export type CaseEventProps = Record<
  string,
  string | number | boolean | null | undefined
>;

const EVENT_NAME_SET = new Set<string>(CASE_EVENT_NAMES);

/** 事件上报端点（相对全局 /api 前缀） */
const EVENTS_PATH = "/v1/events";

/** 单个事件 props 键数量上限 */
const MAX_PROPS = 20;
/** 字符串值最大长度（截断，防超长字符串滥用） */
const MAX_STRING_LENGTH = 200;
/** 键名最大长度 */
const MAX_KEY_LENGTH = 64;

/**
 * 禁止写入分析事件的敏感键黑名单（防御性兜底，即使调用方误传也在此剥离）。
 * 覆盖联系方式、需求正文、客户/公司名称等（PRD §14.4、架构 §13）。
 */
const SENSITIVE_KEY_PATTERN =
  /contact|phone|mobile|telephone|email|wechat|weixin|message|requirement|content|password|token|secret|credential|idcard|identity|address|company|organization|position|name/i;

export function isKnownEventName(name: unknown): name is CaseEventName {
  return typeof name === "string" && EVENT_NAME_SET.has(name);
}

/**
 * 清洗事件 props：仅保留扁平基础类型值，剥离敏感键、截断超长字符串、
 * 丢弃嵌套对象/数组，绝不把敏感信息写入分析事件。
 * 入参为 unknown（防御性清洗，与后端 sanitizeEventProps 对齐）。
 */
export function sanitizeEventProps(
  props: unknown,
): Record<string, string | number | boolean> {
  if (!props || typeof props !== "object") return {};
  const source = props as Record<string, unknown>;
  const result: Record<string, string | number | boolean> = {};

  for (const key of Object.keys(source)) {
    if (Object.keys(result).length >= MAX_PROPS) break;
    if (!key || key.length > MAX_KEY_LENGTH) continue;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;

    const value = source[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") {
      result[key] = value;
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) result[key] = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) result[key] = trimmed.slice(0, MAX_STRING_LENGTH);
    }
    // 嵌套对象 / 数组 / 其他类型一律丢弃
  }

  return result;
}

/** fire-and-forget 发送事件，失败静默，不阻塞主流程 */
function postEvent(payload: unknown): void {
  if (typeof window === "undefined") return;
  try {
    fetch(`${getApiBase()}${EVENTS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // 上报失败静默吞掉
    });
  } catch {
    // 同步异常（如 keepalive 体积超限、序列化失败）不外抛
  }
}

/**
 * 统一事件上报入口。事件名不在白名单时静默忽略；props 先经敏感字段清洗。
 */
export function trackCaseEvent(
  name: CaseEventName | string,
  props?: CaseEventProps,
): void {
  if (!isKnownEventName(name)) return;
  postEvent({ name, props: sanitizeEventProps(props) });
}
