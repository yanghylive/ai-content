"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCcw, Send, Trash2 } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import {
  autoUploadApi,
  buildRiskConfirmation,
  type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";

type FilterKey = "all" | "pending" | "done" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "进行中" },
  { key: "done", label: "成功" },
  { key: "failed", label: "失败" },
];

function statusGroup(status?: string): "pending" | "done" | "failed" | "other" {
  const s = (status || "").toLowerCase();
  if (s === "success" || s === "completed" || s === "done" || s === "published") return "done";
  if (s === "failed" || s === "error" || s === "blocked") return "failed";
  if (s === "queued" || s === "running" || s === "pending" || s === "publishing" || s === "waiting" || s.startsWith("waiting")) return "pending";
  return "other";
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "accent" | "muted"> = {
  pending: "warning",
  done: "success",
  failed: "danger",
  other: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "进行中",
  done: "成功",
  failed: "失败",
  other: "其他",
};

function matchFilter(task: AutoUploadPublishTask, filter: FilterKey): boolean {
  if (filter === "all") return true;
  return statusGroup(task.status) === filter;
}

export function DistributionTasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutoUploadPublishTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AutoUploadPublishTask | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  // 失败重试（与旧版一致：先创建重试确认，再 retry）
  const handleRetry = async (task: AutoUploadPublishTask) => {
    setRetryingId(task.id);
    setError(null);
    try {
      const confirmation = await autoUploadApi.createRetryTaskConfirmation(task.id);
      await autoUploadApi.retryTask(task.id, confirmation.confirmationId);
      flash("重试已开始，结果稍后看");
      await fetchTasks();
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "重试失败，请稍后重试"));
    } finally {
      setRetryingId(null);
    }
  };

  // 删除任务（高风险操作，带风控确认）
  const handleDelete = async (task: AutoUploadPublishTask) => {
    setDeletingId(task.id);
    setError(null);
    try {
      await autoUploadApi.deleteTask(
        task.id,
        buildRiskConfirmation("local-file-delete", "high"),
      );
      flash("任务已删除");
      setViewing(null);
      await fetchTasks();
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : "";
      setError(rawMessage || toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeletingId(null);
    }
  };

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const result = await autoUploadApi.taskPage({ page: 1, pageSize: 80 });
      setTasks(Array.isArray(result?.items) ? result.items : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "发布任务暂时无法读取"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const filtered = useMemo(
    () => tasks.filter((t) => matchFilter(t, filter)),
    [tasks, filter],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = { all: 0, pending: 0, done: 0, failed: 0 };
    tasks.forEach((t) => {
      result.all += 1;
      const group = statusGroup(t.status);
      if (group === "pending" || group === "done" || group === "failed") {
        result[group] += 1;
      }
    });
    return result;
  }, [tasks]);

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/distribution")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              发布任务
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              每次发布的结果记录，成功失败都能追溯
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filter === key
                ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
            {counts[key] > 0 && (
              <span className="ml-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={Send}
            title={filter === "all" ? "还没有发布记录" : `没有${FILTERS.find((f) => f.key === filter)?.label}的任务`}
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((task) => {
              const group = statusGroup(task.status);
              return (
                <div key={task.id} className="flex items-center justify-between p-5">
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => setViewing(task)}
                  >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-[var(--kaypal-v3-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)]">
                        {task.title || `任务 #${task.id}`}
                      </h3>
                      <V2StatusChip tone={STATUS_TONE[group]}>
                        {STATUS_LABEL[group]}
                      </V2StatusChip>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {task.platform ? `${task.platform}` : ""}
                      {task.dry_run ? " · 试运行" : ""}
                      {task.created_at
                        ? ` · ${new Date(task.created_at).toLocaleString("zh-CN")}`
                        : ""}
                    </p>
                    {task.message && group === "failed" && (
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-danger)]">
                        失败原因：{task.message}
                      </p>
                    )}
                  </div>
                  </button>
                  {group === "failed" && (
                    <div className="flex items-center gap-2">
                      <V2GhostButton
                        icon={RefreshCcw}
                        loading={retryingId === task.id}
                        onClick={() => void handleRetry(task)}
                      >
                        重试
                      </V2GhostButton>
                      <V2DangerButton
                        icon={Trash2}
                        loading={deletingId === task.id}
                        onClick={() => void handleDelete(task)}
                      >
                        删除
                      </V2DangerButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/distribution")}>
          返回
        </V2GhostButton>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}

      {/* 任务详情弹窗 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                {viewing.title || `任务 #${viewing.id}`}
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setViewing(null)}
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <V2StatusChip tone={STATUS_TONE[statusGroup(viewing.status)]}>
                  {STATUS_LABEL[statusGroup(viewing.status)]}
                </V2StatusChip>
                {viewing.platform && (
                  <span className="text-sm text-[var(--kaypal-v3-muted)]">{viewing.platform}</span>
                )}
              </div>
              <div className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-sm">
                <p><strong>任务 ID：</strong>{viewing.id}</p>
                <p className="mt-1"><strong>创建时间：</strong>{viewing.created_at ? new Date(viewing.created_at).toLocaleString("zh-CN") : "-"}</p>
                {viewing.dry_run ? <p className="mt-1"><strong>模式：</strong>试运行</p> : null}
                {viewing.message ? (
                  <p className="mt-1"><strong>结果信息：</strong>{viewing.message}</p>
                ) : null}
              </div>
              {statusGroup(viewing.status) === "failed" && (
                <div className="flex justify-end gap-2">
                  <V2GhostButton
                    icon={Trash2}
                    loading={deletingId === viewing.id}
                    onClick={() => void handleDelete(viewing)}
                  >
                    删除
                  </V2GhostButton>
                  <V2PrimaryButton
                    icon={RefreshCcw}
                    loading={retryingId === viewing.id}
                    onClick={() => {
                      void handleRetry(viewing);
                      setViewing(null);
                    }}
                  >
                    重试这个任务
                  </V2PrimaryButton>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
