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
  draft: "var(--kaypal-v3-muted)",
  pending: "var(--kaypal-v3-amber)",
  queued: "var(--kaypal-v3-cobalt)",
  running: "var(--kaypal-v3-cobalt)",
  cancelled: "var(--kaypal-v3-muted)",
  done: "var(--kaypal-v3-success)",
  failed: "var(--kaypal-v3-danger)",
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

/**
 * 后端原始状态 → 发布中心展示维度状态（P1-1 状态中间态收敛的核心映射）。
 * 与 fetchTasks 里的内联映射一致，抽出来作为回归锚点。
 */
export function mapBackendStatus(status?: string): PublishStatus {
  const s = (status || "").toLowerCase();
  if (s === "success" || s === "completed" || s === "done") return "done";
  if (s === "failed" || s === "error" || s === "blocked") return "failed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "claimed" || s === "running" || s === "publishing") return "running";
  if (s === "queued") return "queued";
  if (s.startsWith("waiting") || s === "pending") return "pending";
  return "draft";
}

/** 后端租约时长（durable-publish.worker.ts LEASE_DURATION_MS=120s） */
export const RUNNING_STALE_THRESHOLD_MS = 120_000;

/**
 * 「执行中」任务超过租约时长未更新 → 判定卡住（P1-1：提示 + 可重试）。
 * now 可注入便于测试。
 */
export function isStaleRunning(
  status: PublishStatus,
  updatedAt?: string,
  now = Date.now(),
): boolean {
  if (status !== "running" || !updatedAt) return false;
  const ts = Date.parse(updatedAt);
  if (!Number.isFinite(ts)) return false;
  return now - ts > RUNNING_STALE_THRESHOLD_MS;
}
