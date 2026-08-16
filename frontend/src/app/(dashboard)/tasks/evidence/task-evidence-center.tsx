"use client";

import { SkeletonRow } from "@/components/skeleton";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, RefreshCcw } from "lucide-react";
import { localEngineApi } from "@/lib/api/local-engine";
import { autoUploadApi } from "@/lib/api/auto-upload";
import { dashboardApi } from "@/lib/api/dashboard";
import { aiEmployeeApi } from "@/lib/api/ai-employee";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { V2BackButton } from "@/components/v2/v2-back-button";

interface EvidenceRow {
  id: string;
  kind: "互动" | "发布" | "风险" | "会话" | "工作流";
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
      const [tasks, pubTasks, riskEvidence, agentSessions, workflowResult] =
        await Promise.all([
          localEngineApi.tasks(30).catch(() => []),
          autoUploadApi.tasks(30).catch(() => []),
          dashboardApi.riskAuditEvidence(80).catch(() => []),
          localEngineApi.agentSessions({ limit: 80 }).catch(() => []),
          aiEmployeeApi
            .workflows(80)
            .catch(() => ({ definitions: [], runs: [] })),
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
      // 风险确认记录（人工确认/任务执行/系统记录形成的高影响动作留痕）
      (Array.isArray(riskEvidence) ? riskEvidence : []).forEach((r) => {
        evidence.push({
          id: r.id,
          kind: "风险",
          title: r.actionLabel || r.targetLabel || "风险动作",
          status: r.riskLevel === "high" ? "high" : "allowed",
          detail: r.summary,
        });
      });
      // Agent 会话（AI 工作台执行留痕）
      (Array.isArray(agentSessions) ? agentSessions : []).forEach((s) => {
        evidence.push({
          id: s.id,
          kind: "会话",
          title: s.title || s.instruction?.slice(0, 30) || "Agent 会话",
          status: s.status || "unknown",
          time: s.updatedAt || s.createdAt,
          detail: s.failureReason || s.nextAction,
        });
      });
      // AI 员工工作流
      const workflowRuns = workflowResult?.runs ?? [];
      (Array.isArray(workflowRuns) ? workflowRuns : []).forEach((w) => {
        evidence.push({
          id: w.id,
          kind: "工作流",
          title: w.title || `工作流 #${w.id}`,
          status: w.status || "unknown",
          detail: w.aggregate
            ? `已完成 ${w.aggregate.completedSteps}/${w.aggregate.totalSteps} 步`
            : undefined,
        });
      });

      evidence.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
      setRows(evidence.slice(0, 60));
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
    if (s === "completed" || s === "success" || s === "allowed") return "success" as const;
    if (s === "failed" || s === "blocked" || s === "high") return "danger" as const;
    if (s === "waiting_for_send_confirmation" || s === "queued" || s === "running" || s === "pending" || s === "medium") return "warning" as const;
    return "muted" as const;
  };
  const statusLabel = (s: string) =>
    ({
      completed: "已完成",
      success: "成功",
      allowed: "已放行",
      failed: "失败",
      blocked: "已拦截",
      high: "高风险",
      medium: "中风险",
      queued: "排队中",
      running: "执行中",
      pending: "待处理",
      waiting_for_send_confirmation: "待确认",
    } as Record<string, string>)[s] || s;

  const kindTone = (k: EvidenceRow["kind"]) => {
    if (k === "发布") return "accent" as const;
    if (k === "风险") return "danger" as const;
    if (k === "工作流") return "warning" as const;
    if (k === "会话") return "success" as const;
    return "muted" as const;
  };
  const kindColor = (k: EvidenceRow["kind"]) => {
    if (k === "发布") return { bg: "rgba(37,99,235,.1)", fg: "#2563eb" };
    if (k === "风险") return { bg: "rgba(220,80,80,.1)", fg: "#dc2626" };
    if (k === "工作流") return { bg: "rgba(222,150,57,.12)", fg: "#d98a2d" };
    if (k === "会话") return { bg: "rgba(16,185,129,.12)", fg: "#059669" };
    return { bg: "rgba(120,148,179,.14)", fg: "#64748b" };
  };

  const isMobile = useIsMobile();
  if (isMobile) {
    const mobileStatusBadge = (s: string) =>
      s === "completed" || s === "success" || s === "allowed" ? "mx-badge mx-badge-green"
        : s === "failed" || s === "blocked" || s === "high" ? "mx-badge mx-badge-red"
          : s === "waiting_for_send_confirmation" || s === "queued" || s === "running" || s === "pending" || s === "medium" ? "mx-badge mx-badge-gold"
            : "mx-badge";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">任务证据</h1>
              <p className="mx-page-sub">每次执行都留痕，出问题能回溯</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px" }}
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCcw size={13} style={{ marginRight: 4 }} />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{error}</p>
          ) : null}

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : rows.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>还没有执行记录</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>互动和发布任务跑起来后，每次执行都会在这里留痕</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/today")}>回到今天</button>
            </div>
          ) : (
            <>
              <div className="mx-section-head">
                <div className="mx-section-title">执行留痕</div>
                <span className="mx-section-eyebrow">最近 {rows.length} 条</span>
              </div>
              <div className="mx-card mx-list-card">
                {rows.map((row) => (
                  <div key={`${row.kind}-${row.id}`} className="mx-row">
                    <span className="mx-row-ic" style={{ background: kindColor(row.kind).bg, color: kindColor(row.kind).fg, borderRadius: 999 }}>
                      <FileSearch size={18} strokeWidth={1.8} />
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{row.title}</div>
                      <div className="mx-row-desc">
                        {row.kind}{row.detail ? ` · ${row.detail}` : ""}
                        {row.time ? ` · ${new Date(row.time).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
                      </div>
                    </div>
                    <div className="mx-row-right">
                      <span className={mobileStatusBadge(row.status)}>{statusLabel(row.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <V2BackButton />
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
                <V2StatusChip tone={kindTone(row.kind)}>
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
