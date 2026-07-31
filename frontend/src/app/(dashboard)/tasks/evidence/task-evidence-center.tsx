"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, RefreshCcw } from "lucide-react";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { autoUploadApi, type AutoUploadPublishTask } from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";

interface EvidenceRow {
  id: string;
  kind: "互动" | "发布";
  title: string;
  status: string;
  time?: string;
  detail?: string;
}

/** 任务证据——互动和发布任务的真实执行留痕（不再写死） */
export function TaskEvidenceCenter() {
  const router = useRouter();
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, pubTasks] = await Promise.all([
        localEngineApi.tasks(30).catch(() => []),
        autoUploadApi.tasks(30).catch(() => []),
      ]);

      const evidence: EvidenceRow[] = [];
      (Array.isArray(tasks) ? tasks : []).forEach((t) => {
        evidence.push({
          id: t.id,
          kind: "互动",
          title: `${t.targetName || "客户"} · ${t.typeLabel || t.type || "互动"}`,
          status: t.status || "unknown",
          time: t.updatedAt || t.createdAt,
          detail: t.failureReason || t.replyText?.slice(0, 40),
        });
      });
      (Array.isArray(pubTasks) ? pubTasks : []).forEach((t) => {
        evidence.push({
          id: String(t.id),
          kind: "发布",
          title: t.title || `发布任务 #${t.id}`,
          status: t.status || "unknown",
          time: t.created_at,
          detail: t.message || undefined,
        });
      });

      evidence.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
      setRows(evidence.slice(0, 30));
    } catch (err: unknown) {
      setError(toPublicError(err, "任务证据读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusTone = (s: string) => {
    if (s === "completed") return "success" as const;
    if (s === "failed" || s === "blocked") return "danger" as const;
    if (s === "waiting_for_send_confirmation" || s === "queued" || s === "running") return "warning" as const;
    return "muted" as const;
  };
  const statusLabel = (s: string) =>
    ({
      completed: "已完成",
      failed: "失败",
      blocked: "已拦截",
      queued: "排队中",
      running: "执行中",
      waiting_for_send_confirmation: "待确认",
    } as Record<string, string>)[s] || s;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <FileSearch className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">任务证据</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              每次执行都留痕，出问题能回溯 · 最近 {rows.length} 条
            </p>
          </div>
        </div>
        <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <V2EmptyState
          icon={FileSearch}
          title="还没有执行记录"
          description="互动和发布任务跑起来后，每次执行都会在这里留痕"
          action={
            <V2GhostButton onClick={() => router.push("/today")}>回到今天</V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`执行留痕（${rows.length}）`}>
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div
                key={`${row.kind}-${row.id}`}
                className="kaypal-v3-surface flex items-center gap-4 p-4"
              >
                <V2StatusChip tone={row.kind === "发布" ? "accent" : "muted"}>
                  {row.kind}
                </V2StatusChip>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">
                    {row.title}
                  </p>
                  {row.detail ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-muted)]">
                      {row.detail}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--kaypal-v3-muted)]">
                  {row.time ? new Date(row.time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                </span>
                <V2StatusChip tone={statusTone(row.status)}>
                  {statusLabel(row.status)}
                </V2StatusChip>
              </div>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
