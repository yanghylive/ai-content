"use client";

import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle, SkeletonRow } from "@/components/skeleton";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  SkipForward,
  AlertTriangle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type InteractionTask,
  type InteractionTaskStatus,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const STATUS_DISPLAY: Record<
  InteractionTaskStatus,
  { label: string; tone: "success" | "warning" | "danger" | "accent" | "muted"; icon: typeof Clock }
> = {
  queued: { label: "排队中", tone: "muted", icon: Clock },
  running: { label: "执行中", tone: "accent", icon: Loader2 },
  paused: { label: "已暂停", tone: "warning", icon: Pause },
  blocked: { label: "未执行", tone: "danger", icon: AlertTriangle },
  waiting_for_send_confirmation: { label: "待确认", tone: "warning", icon: Clock },
  completed: { label: "已完成", tone: "success", icon: CheckCircle2 },
  failed: { label: "失败", tone: "danger", icon: XCircle },
  skipped: { label: "已跳过", tone: "muted", icon: Clock },
  no_target: { label: "无目标", tone: "muted", icon: Clock },
};

type FilterKey = "all" | "todo" | "running" | "done" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "todo", label: "待确认" },
  { key: "running", label: "进行中" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失败/未执行" },
];

function matchFilter(task: InteractionTask, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "todo") return task.status === "waiting_for_send_confirmation";
  if (filter === "running")
    return task.status === "running" || task.status === "queued";
  if (filter === "done") return task.status === "completed";
  if (filter === "failed")
    return task.status === "failed" || task.status === "blocked";
  return true;
}

export function EngineTaskRecords() {
  const router = useRouter();
  const [tasks, setTasks] = useState<InteractionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.tasks(100);
      setTasks(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载任务记录失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const handleAction = async (
    task: InteractionTask,
    action: "pause" | "continue" | "retry" | "skip",
  ) => {
    setActingId(task.id);
    setError(null);
    try {
      if (action === "pause") {
        await localEngineApi.pauseTask(task.id);
      } else if (action === "continue") {
        await localEngineApi.continueTask(task.id);
      } else if (action === "retry") {
        await localEngineApi.retryTask(task.id, {});
      } else if (action === "skip") {
        await localEngineApi.skipTask(task.id);
      }
      await fetchTasks();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  const filtered = useMemo(
    () => tasks.filter((task) => matchFilter(task, filter)),
    [tasks, filter],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: tasks.length,
      todo: 0,
      running: 0,
      done: 0,
      failed: 0,
    };
    tasks.forEach((task) => {
      if (task.status === "waiting_for_send_confirmation") result.todo += 1;
      if (task.status === "running" || task.status === "queued") result.running += 1;
      if (task.status === "completed") result.done += 1;
      if (task.status === "failed" || task.status === "blocked") result.failed += 1;
    });
    return result;
  }, [tasks]);

  const isMobile = useIsMobile();
  if (isMobile) {
    const statusBadge = (status: InteractionTaskStatus) =>
      status === "completed" ? "mx-badge mx-badge-green"
        : status === "failed" || status === "blocked" ? "mx-badge mx-badge-red"
          : status === "waiting_for_send_confirmation" || status === "paused" ? "mx-badge mx-badge-gold"
            : "mx-badge mx-badge-blue";
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">互动记录</h1>
              <p className="mx-page-sub">所有自动执行任务的记录和状态</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px" }}
              disabled={loading}
              onClick={() => void fetchTasks()}
            >
              <RefreshCcw size={13} style={{ marginRight: 4 }} />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 10 }}>{error}</p>
          ) : null}

          {/* 状态筛选（横向滚动） */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 12 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{
                  flexShrink: 0,
                  fontSize: 12,
                  padding: "7px 14px",
                  borderRadius: 999,
                  border: filter === key ? "1.5px solid #2563eb" : "1px solid rgba(142,165,190,.3)",
                  background: filter === key ? "rgba(37,99,235,.12)" : "rgba(255,255,255,.06)",
                  color: filter === key ? "var(--kaypal-v3-cobalt)" : "var(--mx-ink)",
                }}
              >
                {label}
                {counts[key] > 0 ? ` ${counts[key]}` : ""}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>{filter === "all" ? "还没有任务记录" : "这个状态下没有任务"}</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>系统执行任务后，记录会显示在这里</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((task) => {
                const display = STATUS_DISPLAY[task.status] || STATUS_DISPLAY.queued;
                return (
                  <div key={task.id} className="mx-card" style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="mx-row-title" style={{ flex: 1, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {task.targetName || task.typeLabel}
                      </span>
                      <span className={statusBadge(task.status)}>{display.label}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: "var(--mx-muted)" }}>
                      {task.typeLabel}
                      {task.accountName ? ` · ${task.accountName}` : ""}
                      {task.updatedAt ? ` · ${new Date(task.updatedAt).toLocaleString("zh-CN")}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                      {(task.status === "running" || task.status === "queued") && (
                        <button type="button" style={{ flex: 1, fontSize: 11.5, padding: "9px 10px", borderRadius: 10, background: "rgba(245,158,11,.1)", color: "var(--kaypal-v3-amber)", border: "1px solid rgba(245,158,11,.3)" }} disabled={actingId === task.id} onClick={() => void handleAction(task, "pause")}>
                          {actingId === task.id ? "处理中…" : "暂停"}
                        </button>
                      )}
                      {task.status === "paused" && (
                        <button type="button" style={{ flex: 1, fontSize: 11.5, padding: "9px 10px", borderRadius: 10, background: "rgba(37,99,235,.12)", color: "var(--kaypal-v3-cobalt)", border: "none" }} disabled={actingId === task.id} onClick={() => void handleAction(task, "continue")}>
                          {actingId === task.id ? "处理中…" : "继续"}
                        </button>
                      )}
                      {(task.status === "failed" || task.status === "blocked") && (
                        <button type="button" style={{ flex: 1, fontSize: 11.5, padding: "9px 10px", borderRadius: 10, background: "rgba(37,99,235,.12)", color: "var(--kaypal-v3-cobalt)", border: "none" }} disabled={actingId === task.id} onClick={() => void handleAction(task, "retry")}>
                          {actingId === task.id ? "处理中…" : "重试"}
                        </button>
                      )}
                      {["queued", "running", "paused", "waiting_for_send_confirmation"].includes(task.status) && (
                        <button type="button" style={{ flex: 1, fontSize: 11.5, padding: "9px 10px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)" }} disabled={actingId === task.id} onClick={() => void handleAction(task, "skip")}>
                          {actingId === task.id ? "处理中…" : "跳过"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/local-engine")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              互动记录
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              所有自动执行任务的记录和状态
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
            <SkeletonList rows={5} />
            <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={Clock}
            title={filter === "all" ? "还没有任务记录" : "这个状态下没有任务"}
            description="系统执行任务后，记录会显示在这里"
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((task) => {
              const display = STATUS_DISPLAY[task.status] || STATUS_DISPLAY.queued;
              const DisplayIcon = display.icon;
              return (
                <div key={task.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <DisplayIcon
                      className={`h-5 w-5 ${
                        task.status === "completed"
                          ? "text-[var(--kaypal-v3-success)]"
                          : task.status === "failed" || task.status === "blocked"
                            ? "text-[var(--kaypal-v3-danger)]"
                            : "text-[var(--kaypal-v3-muted)]"
                      } ${task.status === "running" ? "animate-spin" : ""}`}
                    />
                    <div>
                      <p className="font-medium text-[var(--kaypal-v3-ink)]">
                        {task.targetName || task.typeLabel}
                      </p>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {task.typeLabel}
                        {task.accountName ? ` · ${task.accountName}` : ""}
                        {task.updatedAt
                          ? ` · ${new Date(task.updatedAt).toLocaleString("zh-CN")}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 按状态给下一步操作 */}
                    {(task.status === "running" || task.status === "queued") && (
                      <V2GhostButton
                        icon={Pause}
                        loading={actingId === task.id}
                        onClick={() => void handleAction(task, "pause")}
                      >
                        暂停
                      </V2GhostButton>
                    )}
                    {task.status === "paused" && (
                      <V2GhostButton
                        icon={Play}
                        loading={actingId === task.id}
                        onClick={() => void handleAction(task, "continue")}
                      >
                        继续
                      </V2GhostButton>
                    )}
                    {(task.status === "failed" || task.status === "blocked") && (
                      <V2GhostButton
                        icon={RefreshCcw}
                        loading={actingId === task.id}
                        onClick={() => void handleAction(task, "retry")}
                      >
                        重试
                      </V2GhostButton>
                    )}
                    {["queued", "running", "paused", "waiting_for_send_confirmation"].includes(task.status) && (
                      <V2GhostButton
                        icon={SkipForward}
                        loading={actingId === task.id}
                        onClick={() => void handleAction(task, "skip")}
                      >
                        跳过
                      </V2GhostButton>
                    )}
                    <V2StatusChip tone={display.tone}>{display.label}</V2StatusChip>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>
    </div>
  );
}
