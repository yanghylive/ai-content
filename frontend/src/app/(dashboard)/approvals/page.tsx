"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Check, X, AlertTriangle } from "@/components/iconpark";
import { approvalApi, type ApprovalRecord } from "@/lib/api/approval";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { SkeletonList } from "@/components/skeleton";

const RISK_LABEL: Record<string, { label: string; cls: string }> = {
  high: { label: "高风险", cls: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300" },
  medium: { label: "中风险", cls: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300" },
  low: { label: "低风险", cls: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" },
};

const ACTION_LABEL: Record<string, string> = {
  create_task: "建跟进任务",
  draft_reply: "草拟回复",
  request_review: "请求复核",
  convert_crm: "转 CRM",
  send_reply: "发送回复",
  batch_outreach: "批量触达",
};

function fmtTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** 审批中心（Sprint 5）：高风险动作人工审批列表 + 操作 */
export default function ApprovalCenterPage() {
  const [items, setItems] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await approvalApi.listPending(50);
      setItems(list);
    } catch {
      setMsg("审批列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAct = useCallback(
    async (rec: ApprovalRecord, action: "approve" | "reject" | "request_changes") => {
      setActingId(rec.id);
      try {
        const reason =
          action === "reject"
            ? "人工驳回"
            : action === "request_changes"
              ? "要求修改后重新提交"
              : "人工批准";
        await approvalApi.act(rec.id, { action, reason });
        setMsg(
          action === "approve"
            ? `已批准 ${ACTION_LABEL[rec.actionType] ?? rec.actionType}`
            : `已${action === "reject" ? "驳回" : "要求修改"} ${ACTION_LABEL[rec.actionType] ?? rec.actionType}`,
        );
        await load();
      } catch {
        setMsg("操作失败，请刷新后重试");
      } finally {
        setActingId(null);
      }
    },
    [load],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <V2BackButton label="返回" />
      <section className="kaypal-v3-panel mb-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--kaypal-v3-accent)]" />
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">审批中心</h1>
        </div>
        <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
          高风险动作（首次私信/批量触达/批量评论/商机阶段变化）需人工审批后才能执行
        </p>
      </section>

      {msg && (
        <p className="mb-3 rounded-lg bg-[var(--kaypal-v3-surface-2)] px-3 py-2 text-xs text-[var(--kaypal-v3-ink)]">
          {msg}
        </p>
      )}

      {loading ? (
        <div className="py-16 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--kaypal-v3-border)] p-10 text-center text-sm text-[var(--kaypal-v3-muted)]">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          没有待审批的动作
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((rec) => {
            const risk = RISK_LABEL[rec.riskLevel] ?? RISK_LABEL.medium;
            return (
              <div key={rec.id} className="kaypal-v3-panel p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--kaypal-v3-ink)]">
                      {ACTION_LABEL[rec.actionType] ?? rec.actionType}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${risk.cls}`}>
                      {risk.label}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--kaypal-v3-muted)]">
                    {fmtTime(rec.createdAt)} · {rec.affectedLeadIds?.length ?? 1} 个目标
                  </span>
                </div>
                <p className="mt-2 break-all text-xs text-[var(--kaypal-v3-muted)]">
                  actionId：{rec.actionId} · inputHash：{rec.inputHash}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={actingId === rec.id}
                    onClick={() => void handleAct(rec, "approve")}
                    className="flex items-center gap-1 rounded-lg bg-[image:var(--kaypal-v3-gradient-primary)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                  >
                    <Check className="h-3.5 w-3.5" /> 批准
                  </button>
                  <button
                    type="button"
                    disabled={actingId === rec.id}
                    onClick={() => void handleAct(rec, "reject")}
                    className="flex items-center gap-1 rounded-lg bg-[var(--kaypal-v3-danger-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--kaypal-v3-danger)] transition hover:bg-[var(--kaypal-v3-danger)] hover:text-white disabled:opacity-40"
                  >
                    <X className="h-3.5 w-3.5" /> 驳回
                  </button>
                  <button
                    type="button"
                    disabled={actingId === rec.id}
                    onClick={() => void handleAct(rec, "request_changes")}
                    className="flex items-center gap-1 rounded-lg bg-[var(--kaypal-v3-amber-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--kaypal-v3-amber)] transition hover:bg-[var(--kaypal-v3-amber)] hover:text-white disabled:opacity-40"
                  >
                    要求修改
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
