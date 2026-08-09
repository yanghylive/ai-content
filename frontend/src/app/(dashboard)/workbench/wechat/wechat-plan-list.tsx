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
} from "lucide-react";
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

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/workbench/wechat")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              群发计划
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              管理你的群发任务：暂停、继续、重试、删除
            </p>
          </div>
          <V2PrimaryButton
            icon={Send}
            onClick={() => router.push("/workbench/wechat-v2/mass-send")}
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
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
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
                onClick={() => router.push("/workbench/wechat-v2/mass-send")}
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
