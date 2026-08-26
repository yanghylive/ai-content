"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Play,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import {
  getSolutionRun,
  type SolutionRunRecord,
  type SolutionRunTaskRecord,
} from "@/lib/api/solutions";
import { toPublicError } from "@/lib/public-error";
import { SkeletonList } from "@/components/skeleton";

const TASK_STATUS: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "accent" | "muted"; icon: typeof CircleDashed }
> = {
  completed: { label: "已完成", tone: "success", icon: CheckCircle2 },
  done: { label: "已完成", tone: "success", icon: CheckCircle2 },
  running: { label: "进行中", tone: "accent", icon: Loader2 },
  queued: { label: "排队中", tone: "muted", icon: CircleDashed },
  pending: { label: "排队中", tone: "muted", icon: CircleDashed },
  waiting: { label: "待确认", tone: "warning", icon: CircleDashed },
  failed: { label: "失败", tone: "danger", icon: XCircle },
  blocked: { label: "未执行", tone: "danger", icon: XCircle },
};

function taskDisplay(task: SolutionRunTaskRecord) {
  return (
    TASK_STATUS[task.status?.toLowerCase()] || {
      label: task.status || "未知",
      tone: "muted" as const,
      icon: CircleDashed,
    }
  );
}

export function SolutionRunDetail({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<SolutionRunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getSolutionRun(runId);
      setRun(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载运行详情失败"));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
    // 进行中的运行每 5 秒自动刷新
    const timer = setInterval(() => {
      setRun((prev) => {
        if (prev && (prev.status === "running" || prev.status === "queued")) {
          void getSolutionRun(runId).then(setRun).catch(() => undefined);
        }
        return prev;
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchRun, runId]);

  if (loading) {
    return (
      <div className="kaypal-v3-panel p-12 text-center">
        <SkeletonList rows={5} />
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">正在加载...</p>
      </div>
    );
  }

  if (!run) {
    return (
      <V2Section>
        <V2EmptyState
          icon={XCircle}
          title="没找到这个运行记录"
          action={
            <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/solutions")}>
              返回解决方案
            </V2GhostButton>
          }
        />
      </V2Section>
    );
  }

  const tasks = run.tasks || [];
  const doneCount = tasks.filter((t) =>
    ["completed", "done"].includes(t.status?.toLowerCase()),
  ).length;
  const running = run.status === "running" || run.status === "queued";
  const runStatusTone =
    run.status === "completed" || run.status === "done"
      ? "success"
      : running
        ? "accent"
        : run.status === "failed" || run.status === "blocked"
          ? "danger"
          : "muted";

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/solutions")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {run.packageName}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              进度 {run.progress ?? Math.round((doneCount / Math.max(tasks.length, 1)) * 100)}%
              · {doneCount}/{tasks.length} 步完成
            </p>
          </div>
          <V2StatusChip tone={runStatusTone}>
            {running ? "进行中" : run.status === "completed" || run.status === "done" ? "已完成" : run.status}
          </V2StatusChip>
        </div>

        {/* 进度条 */}
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-paper-soft)]">
          <div
            className="h-full rounded-full bg-[var(--kaypal-v3-accent)] transition-all"
            style={{
              width: `${run.progress ?? Math.round((doneCount / Math.max(tasks.length, 1)) * 100)}%`,
            }}
          />
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 执行步骤 */}
      <V2Section title="执行步骤" padding={false}>
        {tasks.length === 0 ? (
          <V2EmptyState icon={CircleDashed} title="还没有执行步骤" />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {tasks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((task) => {
                const display = taskDisplay(task);
                const Icon = display.icon;
                return (
                  <div key={task.id} className="flex items-center justify-between p-5">
                    <div className="flex items-center gap-4">
                      <Icon
                        className={`h-6 w-6 ${
                          display.tone === "success"
                            ? "text-[var(--kaypal-v3-success)]"
                            : display.tone === "danger"
                              ? "text-[var(--kaypal-v3-danger)]"
                              : display.tone === "accent"
                                ? "animate-spin text-[var(--kaypal-v3-accent)]"
                                : "text-[var(--kaypal-v3-muted)]"
                        }`}
                      />
                      <div>
                        <p className="font-medium text-[var(--kaypal-v3-ink)]">
                          {task.order}. {task.name}
                        </p>
                        {task.targetObject && (
                          <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                            {task.targetObject}
                          </p>
                        )}
                        {task.errorMessage && (
                          <p className="mt-0.5 text-sm text-[var(--kaypal-v3-danger)]">
                            {task.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    <V2StatusChip tone={display.tone}>{display.label}</V2StatusChip>
                  </div>
                );
              })}
          </div>
        )}
      </V2Section>

      {/* 费用 */}
      <V2Section title="费用">
        <p className="text-sm text-[var(--kaypal-v3-soft-ink)]">
          预估 {run.estimatedCostPoints} 积分 · 上限 {run.maxCostPoints} 积分 · 实际{" "}
          {run.actualCostPoints} 积分
        </p>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/solutions")}>
          返回
        </V2GhostButton>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} onClick={() => void fetchRun()}>
            刷新
          </V2GhostButton>
          {/* 再跑一次：带同样配置回到配置页（可改参数） */}
          <V2PrimaryButton
            icon={Play}
            onClick={() =>
              router.push(`/solutions/configure?package=${encodeURIComponent(run.packageCode || run.packageName)}`)
            }
          >
            再跑一次
          </V2PrimaryButton>
        </div>
      </section>
    </div>
  );
}
