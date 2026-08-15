/**
 * 发布任务状态映射（P1-1 状态中间态 + P1-4 列表筛选的核心纯逻辑）。
 *
 * 从 publish-center.tsx / distribution-tasks.tsx 抽取，供移动端展示
 * 与列表筛选共用，并作为回归测试的锚点。
 */

/** 发布任务展示维度状态（P1-1 后端暴露 claimed/cancelled 后收敛） */
export type PublishStatus =
  | "draft"
  | "pending"
  | "queued"
  | "running"
  | "cancelled"
  | "done"
  | "failed";

export const MOBILE_STATUS_LABEL: Record<PublishStatus, string> = {
  draft: "草稿",
  pending: "计划中",
  queued: "排队中",
  running: "执行中",
  cancelled: "已取消",
  done: "已完成",
  failed: "失败",
};

export const MOBILE_STATUS_BADGE: Record<PublishStatus, string> = {
  draft: "mx-badge",
  pending: "mx-badge mx-badge-gold",
  queued: "mx-badge mx-badge-blue",
  running: "mx-badge mx-badge-blue",
  cancelled: "mx-badge",
  done: "mx-badge mx-badge-green",
  failed: "mx-badge mx-badge-red",
};

export const MOBILE_STATUS_DOT: Record<PublishStatus, string> = {
  draft: "#94a3b8",
  pending: "#d98a2d",
  queued: "#2563eb",
  running: "#2563eb",
  cancelled: "#94a3b8",
  done: "#059669",
  failed: "#dc2626",
};

/**
 * 把后端原始状态归一到 4 个展示分组。
 * - 完成类：success/completed/done/published
 * - 失败类：failed/error/blocked
 * - 进行类：queued/running/pending/publishing/waiting*
 * - 其余：other
 */
export function statusGroup(
  status?: string,
): "pending" | "done" | "failed" | "other" {
  const s = (status || "").toLowerCase();
  if (s === "success" || s === "completed" || s === "done" || s === "published")
    return "done";
  if (s === "failed" || s === "error" || s === "blocked") return "failed";
  if (
    s === "queued" ||
    s === "running" ||
    s === "pending" ||
    s === "publishing" ||
    s === "waiting" ||
    s.startsWith("waiting")
  )
    return "pending";
  return "other";
}
