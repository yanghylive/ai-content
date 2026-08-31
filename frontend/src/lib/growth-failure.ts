import type { GrowthAcquisitionRun } from "@/lib/api/growth";

/**
 * 获客 run 失败原因 → 人话标签（2026-09-01 大王决策：失败必须让用户看懂）。
 * code 全集对齐 backend growth.types.ts:65-80 的 GrowthExecutionFailureReason，
 * 新增 code 时两侧同步；未收录 code 兜底展示原码（不吞）。
 */
export const RUN_FAILURE_META: Record<string, { label: string }> = {
  engine_unavailable: { label: "采集引擎不可用" },
  account_not_logged_in: { label: "账号未登录" },
  account_risk_control: { label: "账号风控" },
  captcha_required: { label: "平台人机验证" },
  target_not_found: { label: "没有可采内容" },
  editor_missing: { label: "编辑器缺失" },
  send_button_missing: { label: "发送按钮未找到" },
  send_failed: { label: "触达发送失败" },
  readback_failed: { label: "发送结果回读失败" },
  daily_limit_reached: { label: "当日已达上限" },
  throttled: { label: "防风控节流" },
  duplicate_target: { label: "重复目标已跳过" },
  content_policy_blocked: { label: "内容合规拦截" },
  platform_structure_changed: { label: "平台页面结构变化" },
  unknown: { label: "原因待查明" },
};

/** 失败原因人话标签；无原因返回 null（渲染层跳过）。未收录 code 原样展示，不吞。 */
export function runFailureLabel(reason?: string | null): string | null {
  if (!reason) return null;
  return RUN_FAILURE_META[reason]?.label ?? reason;
}

/** 一句话失败摘要：「人话原因：message 首行截断」，供 toast / 行内提示。 */
export function runFailureHint(run: Pick<GrowthAcquisitionRun, "failureReason" | "message" | "status">): string | null {
  if (run.status !== "failed" && run.status !== "skipped") return null;
  const label = runFailureLabel(run.failureReason);
  const firstLine = (run.message || "").split("\n")[0]?.trim() || "";
  const brief = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
  if (label && brief && !brief.includes(label)) return `${label}：${brief}`;
  return label ?? (brief || null);
}
