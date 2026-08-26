"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCcw, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api/client";
import { localEngineApi, riskPolicyApi, type RiskPolicy } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { DefaultSendModeSection } from "./default-send-mode-section";
import { SkeletonList } from "@/components/skeleton";

const ACTION_LABELS: Record<string, string> = {
  "agent-confirmation-approve": "批准智能任务执行",
  "auto-upload-publish": "自动发布内容",
  "local-file-delete": "删除本地文件",
  "material-batch-delete": "批量删除素材",
  "interaction-approval": "确认发送互动回复",
  "retry-publish": "重试发布",
  "runtime-control": "本机服务控制",
  "schedule-enable": "启用计划任务",
};

/** 未映射的动作码 → 面向客户的兜底名称（不暴露内部代号） */
function formatAction(action?: string | null) {
  const key = String(action || "").trim();
  if (!key) return "系统操作";
  return ACTION_LABELS[key] || "系统操作";
}

/** 风险管控——真实策略和待确认数（不再写死） */
export function RiskCenter() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [policies, setPolicies] = useState<RiskPolicy[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 策略编辑草稿：action → 待保存的字段改动
  const [draft, setDraft] = useState<Record<string, Partial<RiskPolicy>>>({});
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [policyData, confirmations] = await Promise.all([
        api.get<RiskPolicy[]>("/risk-policies"),
        localEngineApi.confirmations(),
      ]);
      setPolicies(Array.isArray(policyData) ? policyData : []);
      setDraft({});
      setPendingCount(
        (Array.isArray(confirmations) ? confirmations : []).filter(
          (c) => c.status === "pending",
        ).length,
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "风控数据读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 切换某个策略的开关，写入草稿 */
  const togglePolicy = (
    action: string,
    field: "requireConfirm" | "autoExecute" | "forbidden",
    value: boolean,
  ) => {
    setSaveError(null);
    setDraft((prev) => ({
      ...prev,
      [action]: { ...prev[action], [field]: value },
    }));
  };

  /** 保存某个策略的草稿改动 */
  const savePolicy = async (policy: RiskPolicy) => {
    const changes = draft[policy.action];
    if (!changes) return;
    setSavingAction(policy.action);
    setSaveError(null);
    try {
      const updated = await riskPolicyApi.update(policy.action, changes);
      setPolicies((prev) =>
        prev.map((p) => (p.action === updated.action ? updated : p)),
      );
      setDraft((prev) => {
        const next = { ...prev };
        delete next[policy.action];
        return next;
      });
    } catch (err: unknown) {
      setSaveError(toPublicError(err, "风控策略未能更新，请稍后重试。"));
    } finally {
      setSavingAction(null);
    }
  };

  /** 草稿值（未保存时优先用草稿，否则用策略当前值） */
  const getVal = (policy: RiskPolicy, field: "requireConfirm" | "autoExecute" | "forbidden") =>
    draft[policy.action]?.[field] ?? policy[field];

  const levelTone = (level?: string) => {
    if (level === "high") return "danger" as const;
    if (level === "medium") return "warning" as const;
    return "success" as const;
  };
  const levelLabel = (level?: string) =>
    ({ high: "高风险", medium: "中风险", low: "低风险" } as Record<string, string>)[level || ""] || level || "-";

  /* 移动端原生视图（mx-* 明德 VP 风格） */
  if (isMobile) {
    const levelBadge = (level?: string) =>
      level === "high" ? "mx-badge-red" : level === "medium" ? "mx-badge-gold" : "mx-badge-green";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">风险管控</div>
            <div className="mx-page-sub">高风险操作需确认后才执行 · 待确认 {pendingCount} 项</div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => void load()} style={{ flex: "0 0 auto", padding: "9px 14px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600 }}>
              刷新
            </button>
            <button type="button" className="mx-btn-gold" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }} onClick={() => router.push("/tasks/confirmations")}>
              处理待确认{pendingCount > 0 ? `（${pendingCount}）` : ""}
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 12, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <SkeletonList rows={5} />
            </div>
          ) : policies.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12, padding: 26, textAlign: "center" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>还没有风控策略</p>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", marginTop: 4 }}>系统默认策略会在首次高风险操作时自动生成</p>
            </div>
          ) : (
            <>
              <div className="mx-section-head" style={{ marginTop: 16 }}>风控策略（{policies.length}）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {policies.map((policy) => (
                  <div key={policy.action} className="mx-card" style={{ padding: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatAction(policy.action)}
                      </span>
                      <span className={`mx-badge ${levelBadge(policy.riskLevel)}`} style={{ fontSize: 10, flexShrink: 0 }}>
                        {levelLabel(policy.riskLevel)}
                      </span>
                    </div>
                    {policy.description ? (
                      <p style={{ fontSize: 11.5, color: "var(--kaypal-v3-muted)", marginTop: 4, lineHeight: 1.45 }}>{policy.description}</p>
                    ) : null}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 9 }}>
                      {(
                        [
                          ["requireConfirm", "需确认"],
                          ["autoExecute", "自动执行"],
                          ["forbidden", "禁止"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--kaypal-v3-muted)" }}>
                          <input
                            type="checkbox"
                            checked={getVal(policy, field)}
                            onChange={(e) => togglePolicy(policy.action, field, e.target.checked)}
                            style={{ width: 15, height: 15, accentColor: "var(--kaypal-v3-amber)" }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {draft[policy.action] ? (
                      <button
                        type="button"
                        className="mx-btn-gold"
                        style={{ width: "100%", marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                        disabled={savingAction === policy.action}
                        onClick={() => void savePolicy(policy)}
                      >
                        {savingAction === policy.action ? "正在保存…" : "保存"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <DefaultSendModeSection />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">风险管控</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              高风险操作需确认后才执行 · 待确认 {pendingCount} 项
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
          <V2PrimaryButton
            icon={AlertTriangle}
            onClick={() => router.push("/tasks/confirmations")}
          >
            处理待确认{pendingCount > 0 ? `（${pendingCount}）` : ""}
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}

      {saveError && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {saveError}
        </p>
      )}

      {loading ? (
        <div className="py-10 text-center">
          <SkeletonList rows={5} />
        </div>
      ) : policies.length === 0 ? (
        <V2EmptyState
          icon={ShieldAlert}
          title="还没有风控策略"
          description="系统默认策略会在首次高风险操作时自动生成"
        />
      ) : (
        <V2Section title={`风控策略（${policies.length}）`}>
          <div className="flex flex-col gap-3">
            {policies.map((policy) => {
              const changed = Boolean(draft[policy.action]);
              const v = getVal(policy, "forbidden");
              const rc = getVal(policy, "requireConfirm");
              const ae = getVal(policy, "autoExecute");
              return (
                <div
                  key={policy.action}
                  className="kaypal-v3-surface flex items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                        {formatAction(policy.action)}
                      </p>
                      <V2StatusChip tone={levelTone(policy.riskLevel)}>
                        {levelLabel(policy.riskLevel)}
                      </V2StatusChip>
                    </div>
                    {policy.description ? (
                      <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-muted)]">
                        {policy.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-4">
                    {(
                      [
                        ["requireConfirm", "需确认"],
                        ["autoExecute", "自动执行"],
                        ["forbidden", "禁止"],
                      ] as const
                    ).map(([field, label]) => (
                      <label
                        key={field}
                        className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--kaypal-v3-accent)]"
                          checked={getVal(policy, field)}
                          onChange={(e) =>
                            togglePolicy(policy.action, field, e.target.checked)
                          }
                        />
                        {label}
                      </label>
                    ))}
                    <V2StatusChip tone={v ? "danger" : rc ? "warning" : ae ? "success" : "success"}>
                      {v ? "禁止" : rc ? "需确认" : "自动执行"}
                    </V2StatusChip>
                    {changed ? (
                      <V2PrimaryButton
                        loading={savingAction === policy.action}
                        onClick={() => void savePolicy(policy)}
                      >
                        保存
                      </V2PrimaryButton>
                    ) : (
                      <V2GhostButton disabled>保存</V2GhostButton>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      <DefaultSendModeSection />
    </div>
  );
}
