"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pause,
  Play,
  RefreshCcw,
  Send,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
} from "@/components/iconpark";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2DangerButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type InteractionTask,
  type InteractionGroupBroadcastPlanStatus,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

type FilterKey = "all" | "active" | "paused" | "done" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "paused", label: "已暂停" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失败/未执行" },
];

function planStatusOf(
  task: InteractionTask,
): InteractionGroupBroadcastPlanStatus | "blocked" {
  if (task.planStatus) return task.planStatus;
  if (task.status === "blocked") return "blocked";
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failed";
  if (task.status === "paused") return "paused";
  if (task.status === "running" || task.status === "queued") return "sending";
  if (task.status === "waiting_for_send_confirmation") return "paused";
  return "draft";
}

const STATUS_DISPLAY: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "accent" | "muted"; icon: typeof Clock }
> = {
  draft: { label: "草稿", tone: "muted", icon: Clock },
  scheduled: { label: "已定时", tone: "accent", icon: Clock },
  sending: { label: "发送中", tone: "accent", icon: Loader2 },
  paused: { label: "待确认", tone: "warning", icon: Pause },
  blocked: { label: "未执行", tone: "danger", icon: AlertTriangle },
  completed: { label: "已完成", tone: "success", icon: CheckCircle2 },
  failed: { label: "失败", tone: "danger", icon: XCircle },
  removed: { label: "已移除", tone: "muted", icon: Trash2 },
};

function matchFilter(task: InteractionTask, filter: FilterKey): boolean {
  const s = planStatusOf(task);
  if (filter === "all") return s !== "removed";
  if (filter === "active") return s === "sending" || s === "scheduled" || s === "draft";
  if (filter === "paused") return s === "paused";
  if (filter === "done") return s === "completed";
  if (filter === "failed") return s === "failed" || s === "blocked";
  return true;
}

export function WechatPlanList() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [plans, setPlans] = useState<InteractionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.groupBroadcastPlans(80);
      setPlans(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载计划失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const filtered = useMemo(
    () => plans.filter((task) => matchFilter(task, filter)),
    [plans, filter],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = {
      all: 0,
      active: 0,
      paused: 0,
      done: 0,
      failed: 0,
    };
    plans.forEach((task) => {
      (Object.keys(result) as FilterKey[]).forEach((key) => {
        if (matchFilter(task, key)) result[key] += 1;
      });
    });
    return result;
  }, [plans]);

  const runAction = async (
    task: InteractionTask,
    action: "pause" | "resume" | "retry" | "delete",
  ) => {
    setActingId(task.id);
    setError(null);
    try {
      if (action === "pause") {
        await localEngineApi.pauseGroupBroadcastPlan(task.id);
      } else if (action === "resume") {
        await localEngineApi.resumeGroupBroadcastPlan(task.id, {
          contentConfirmed: true,
          targetConfirmed: true,
        });
      } else if (action === "retry") {
        await localEngineApi.retryTask(task.id, {});
      } else if (action === "delete") {
        await localEngineApi.removeGroupBroadcastPlan(task.id);
        setConfirmDeleteId(null);
      }
      await fetchPlans();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——workbench/wechat/plans */
  if (isMobile) {
    const statusBadge = (tone?: string) =>
      tone === "success" ? "mx-badge-green"
        : tone === "warning" ? "mx-badge-gold"
          : tone === "danger" ? "mx-badge-red"
            : tone === "accent" ? "mx-badge-blue"
              : "mx-badge-blue";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/engagement/wechat")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--kaypal-v3-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回微信中心
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>群发计划</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>管理你的群发任务：暂停、继续、重试、删除</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          <button type="button" className="mx-btn-gold" style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={() => router.push("/engagement/wechat/mass-send")}>
            <Send width={15} height={15} /> 新建群发
          </button>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 状态筛选横滚 */}
          <div style={{ display: "flex", gap: 7, overflowX: "auto", marginTop: 13, paddingBottom: 2 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                style={{ flexShrink: 0, padding: "6px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: filter === key ? "var(--kaypal-v3-amber)" : "rgba(120,148,179,.12)", color: filter === key ? "#fff" : "var(--kaypal-v3-ink)", border: filter === key ? "1px solid var(--kaypal-v3-accent)" : "1px solid rgba(142,165,190,.3)" }}
              >
                {label}{counts[key] > 0 ? ` ${counts[key]}` : ""}
              </button>
            ))}
          </div>

          {/* 计划列表 */}
          {loading ? (
            <div style={{ padding: "36px 0", textAlign: "center" }}>
              <SkeletonList rows={5} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 26, textAlign: "center" }}>
              <Send width={26} height={26} style={{ color: "var(--kaypal-v3-muted)", margin: "0 auto" }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", marginTop: 9 }}>
                {filter === "all" ? "还没有群发计划" : `没有${FILTERS.find((f) => f.key === filter)?.label}的计划`}
              </p>
              <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4 }}>创建一个群发任务，把消息发给你的联系人</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/engagement/wechat/mass-send")}>新建群发</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
              {filtered.map((task) => {
                const status = planStatusOf(task);
                const display = STATUS_DISPLAY[status] || STATUS_DISPLAY.draft;
                const acting = actingId === task.id;
                const title =
                  task.planName ||
                  task.metadata?.wechat_plan_name?.toString() ||
                  task.targetName ||
                  "群发计划";
                const summary = task.batchSummary as
                  | { total?: number; completed?: number; failed?: number }
                  | undefined;
                return (
                  <div key={task.id} className="mx-card" style={{ padding: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                      <span className={`mx-badge ${statusBadge(display.tone)}`} style={{ fontSize: 10, flexShrink: 0 }}>{display.label}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 5, lineHeight: 1.5 }}>
                      {summary?.total ? `共 ${summary.total} 个对象` : task.targetName}
                      {summary?.completed ? ` · 已发 ${summary.completed}` : ""}
                      {summary?.failed ? ` · 失败 ${summary.failed}` : ""}
                      {task.updatedAt ? ` · ${new Date(task.updatedAt).toLocaleString("zh-CN")}` : ""}
                    </p>
                    <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
                      {(status === "sending" || status === "scheduled") && (
                        <button type="button" disabled={acting} onClick={() => void runAction(task, "pause")} style={{ flex: 1, padding: "7px 0", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600 }}>
                          {acting ? "处理中…" : "暂停"}
                        </button>
                      )}
                      {status === "paused" && (
                        <button type="button" className="mx-btn-gold" style={{ flex: 1, padding: "7px 0", fontSize: 11.5 }} disabled={acting} onClick={() => void runAction(task, "resume")}>
                          {acting ? "处理中…" : "确认并继续"}
                        </button>
                      )}
                      {(status === "failed" || status === "blocked") && (
                        <button type="button" disabled={acting} onClick={() => void runAction(task, "retry")} style={{ flex: 1, padding: "7px 0", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600 }}>
                          {acting ? "处理中…" : "重试"}
                        </button>
                      )}
                      {status !== "removed" && status !== "sending" && (
                        confirmDeleteId === task.id ? (
                          <>
                            <button type="button" className="mx-btn-gold" style={{ flex: 1, padding: "7px 0", fontSize: 11.5, background: "var(--kaypal-v3-danger)", borderColor: "var(--kaypal-v3-danger)" }} disabled={acting} onClick={() => void runAction(task, "delete")}>
                              确认删除
                            </button>
                            <button type="button" onClick={() => setConfirmDeleteId(null)} style={{ flex: "0 0 auto", padding: "7px 12px", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600 }}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteId(task.id)} style={{ flexShrink: 0, padding: "7px 10px", borderRadius: 9, background: "rgba(220,80,80,.08)", color: "var(--kaypal-v3-danger)", border: "1px solid rgba(220,80,80,.3)" }}>
                            <Trash2 width={13} height={13} />
                          </button>
                        )
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
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/engagement/wechat")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              群发计划
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              管理你的群发任务：暂停、继续、重试、删除
            </p>
          </div>
          <V2PrimaryButton
            icon={Send}
            onClick={() => router.push("/engagement/wechat/mass-send")}
          >
            新建群发
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 状态筛选 */}
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

      {/* 计划列表 */}
      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
            <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={Send}
            title={
              filter === "all" ? "还没有群发计划" : `没有${FILTERS.find((f) => f.key === filter)?.label}的计划`
            }
            description="创建一个群发任务，把消息发给你的联系人"
            action={
              <V2PrimaryButton
                icon={Send}
                onClick={() => router.push("/engagement/wechat/mass-send")}
              >
                新建群发
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((task) => {
              const status = planStatusOf(task);
              const display = STATUS_DISPLAY[status] || STATUS_DISPLAY.draft;
              const acting = actingId === task.id;
              const title =
                task.planName ||
                task.metadata?.wechat_plan_name?.toString() ||
                task.targetName ||
                "群发计划";
              const summary = task.batchSummary as
                | { total?: number; completed?: number; failed?: number }
                | undefined;

              return (
                <div key={task.id} className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                          {title}
                        </h3>
                        <V2StatusChip tone={display.tone}>
                          {display.label}
                        </V2StatusChip>
                      </div>
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                        {summary?.total ? `共 ${summary.total} 个对象` : task.targetName}
                        {summary?.completed
                          ? ` · 已发 ${summary.completed}`
                          : ""}
                        {summary?.failed ? ` · 失败 ${summary.failed}` : ""}
                        {task.updatedAt
                          ? ` · ${new Date(task.updatedAt).toLocaleString("zh-CN")}`
                          : ""}
                      </p>
                    </div>

                    {/* 操作按钮：按状态给出合理的下一步 */}
                    <div className="flex items-center gap-2">
                      {(status === "sending" || status === "scheduled") && (
                        <V2GhostButton
                          icon={Pause}
                          loading={acting}
                          onClick={() => void runAction(task, "pause")}
                        >
                          暂停
                        </V2GhostButton>
                      )}
                      {status === "paused" && (
                        <V2PrimaryButton
                          icon={Play}
                          loading={acting}
                          onClick={() => void runAction(task, "resume")}
                        >
                          确认并继续
                        </V2PrimaryButton>
                      )}
                      {(status === "failed" || status === "blocked") && (
                        <V2GhostButton
                          icon={RefreshCcw}
                          loading={acting}
                          onClick={() => void runAction(task, "retry")}
                        >
                          重试
                        </V2GhostButton>
                      )}
                      {status !== "removed" && status !== "sending" && (
                        <>
                          {confirmDeleteId === task.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-[var(--kaypal-v3-danger)]">
                                确认删除？
                              </span>
                              <V2DangerButton
                                loading={acting}
                                onClick={() => void runAction(task, "delete")}
                              >
                                确认
                              </V2DangerButton>
                              <V2GhostButton
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                取消
                              </V2GhostButton>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-danger-soft)] hover:text-[var(--kaypal-v3-danger)]"
                              onClick={() => setConfirmDeleteId(task.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
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
