"use client";

import React from "react";
import Link from "next/link";
import { Button, Chip, Progress } from "@heroui/react";
import { ArrowRight, RefreshCw, Route } from "lucide-react";
import {
  getSolutionRun,
  type SolutionRunRecord} from "@/lib/api/solutions";
import { toPublicError } from "@/lib/public-error";
import { SkeletonCircle } from "@/components/skeleton";

function statusMeta(status: string) {
  if (["succeeded", "completed"].includes(status)) {
    return { color: "success" as const, label: "已完成" };
  }
  if (["failed", "cancelled"].includes(status)) {
    return { color: "danger" as const, label: "未完成" };
  }
  if (["running", "executing"].includes(status)) {
    return { color: "primary" as const, label: "运行中" };
  }
  if (["approval_required", "waiting_confirmation"].includes(status)) {
    return { color: "warning" as const, label: "待确认" };
  }
  return { color: "default" as const, label: "已创建" };
}

function completedTaskCount(run: SolutionRunRecord) {
  return run.tasks.filter((task) =>
    [
      "succeeded",
      "completed",
      "dry_run_ready",
      "approval_required",
    ].includes(task.status),
  ).length;
}

export function SolutionRunContextBanner({ runId }: { runId: string }) {
  const [run, setRun] = React.useState<SolutionRunRecord | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const normalizedRunId = runId.trim();
    setRun(null);
    setError("");
    if (!normalizedRunId) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    getSolutionRun(normalizedRunId)
      .then((nextRun) => {
        if (active) setRun(nextRun);
      })
      .catch((reason) => {
        if (!active) return;
        setError(
          toPublicError(
            reason,
            "链接指定的运行记录暂时无法读取，请返回任务中心重新选择。",
          ),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadKey, runId]);

  if (!runId.trim()) return null;

  if (loading) {
    return (
      <section
        aria-live="polite"
        className="mb-4 flex min-h-14 items-center gap-3 rounded-[8px] border border-divider bg-content1 px-4 py-3"
      >
        <SkeletonCircle size={16} />
        <span className="text-sm text-default-500">正在定位本次运行...</span>
      </section>
    );
  }

  if (error || !run) {
    return (
      <section
        aria-live="polite"
        className="mb-4 flex flex-col gap-3 rounded-[8px] border border-danger-200 bg-danger-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-danger-700">运行记录未定位</p>
          <p className="mt-1 break-words text-xs leading-5 text-danger-600">
            {error || "没有找到对应运行记录。"}
          </p>
        </div>
        <Button
          className="shrink-0"
          size="sm"
          startContent={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
          variant="flat"
          onPress={() => setReloadKey((value) => value + 1)}
        >
          重新读取
        </Button>
      </section>
    );
  }

  const meta = statusMeta(run.status);
  const completed = completedTaskCount(run);
  const total = run.tasks.length;

  return (
    <section
      aria-label="当前运行定位"
      className="mb-4 rounded-[8px] border border-primary-200 bg-primary-50/60 p-4"
      data-testid="solution-run-context"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Route aria-hidden="true" className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">已定位本次运行</p>
            <Chip color={meta.color} size="sm" variant="flat">
              {meta.label}
            </Chip>
            <Chip size="sm" variant="flat">
              {run.dryRun ? "预览运行" : "正式运行"}
            </Chip>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-foreground">
            {run.packageName || run.packageCode}
          </p>
          <p className="mt-1 break-all text-xs text-default-500">
            运行编号 {run.id} · 步骤 {completed}/{total} · 结果 {run.results.length}
          </p>
          <Progress
            aria-label="本次运行进度"
            className="mt-3 max-w-xl"
            color={meta.color === "danger" ? "danger" : "primary"}
            size="sm"
            value={run.progress || (total ? Math.round((completed / total) * 100) : 0)}
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            size="sm"
            startContent={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
            variant="flat"
            onPress={() => setReloadKey((value) => value + 1)}
          >
            刷新状态
          </Button>
          <Button
            as={Link}
            color="primary"
            endContent={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
            href={`/solutions?runId=${encodeURIComponent(run.id)}`}
            size="sm"
            variant="flat"
          >
            打开方案中心
          </Button>
        </div>
      </div>
    </section>
  );
}
