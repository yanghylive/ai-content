"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type AgentConfirmation,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const RISK_TONE: Record<string, "warning" | "danger"> = {
  medium: "warning",
  high: "danger",
};

export function RiskConfirmFlow() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [confirmations, setConfirmations] = useState<AgentConfirmation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchConfirmations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.confirmations("pending");
      setConfirmations(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载待确认操作失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfirmations();
  }, [fetchConfirmations]);

  const handleDecision = async (
    item: AgentConfirmation,
    decision: "approve" | "reject",
  ) => {
    setActingId(item.id);
    setError(null);
    try {
      if (decision === "approve") {
        await localEngineApi.approveConfirmation(item.id, {});
      } else {
        await localEngineApi.rejectConfirmation(item.id, {});
      }
      await fetchConfirmations();
    } catch (err: unknown) {
      setError(toPublicError(err, "操作失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——risk-confirm-v2，手机高频审批场景 */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/capabilities/risk")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回风险管控
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>待确认的高风险操作</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>
                  {loading ? "加载中…" : confirmations.length > 0 ? `${confirmations.length} 项待确认，确认后系统才会执行` : "没有待确认项"}
                </div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {loading ? (
            <div style={{ padding: "36px 0", textAlign: "center" }}>
              <div style={{ width: 26, height: 26, margin: "0 auto", borderRadius: "50%", border: "2px solid rgba(222,150,57,.9)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : confirmations.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 14, padding: 28, textAlign: "center" }}>
              <CheckCircle2 width={28} height={28} style={{ color: "#059669", margin: "0 auto" }} />
              <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)", marginTop: 10 }}>没有待确认的操作</p>
              <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 4 }}>有高风险操作需要你确认时，会出现在这里</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {confirmations.map((item) => (
                <div key={item.id} className="mx-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span
                      style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: item.riskLevel === "high" ? "rgba(220,80,80,.12)" : "rgba(222,150,57,.14)",
                        color: item.riskLevel === "high" ? "#dc2626" : "#d98a2d",
                      }}
                    >
                      {item.riskLevel === "high" ? <ShieldAlert width={18} height={18} /> : <AlertTriangle width={18} height={18} />}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--mx-ink)" }}>{item.title}</span>
                        <span className={`mx-badge ${item.riskLevel === "high" ? "mx-badge-red" : "mx-badge-gold"}`} style={{ fontSize: 10 }}>
                          {item.riskLevel === "high" ? "高风险" : "中风险"}
                        </span>
                      </span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 5, lineHeight: 1.55 }}>{item.description}</span>
                      {item.actionLabel && (
                        <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--mx-ink)", marginTop: 6 }}>将执行：{item.actionLabel}</span>
                      )}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button
                      type="button"
                      disabled={actingId === item.id}
                      onClick={() => void handleDecision(item, "reject")}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(220,80,80,.08)", color: "#dc2626", border: "1px solid rgba(220,80,80,.35)", fontSize: 12.5, fontWeight: 600 }}
                    >
                      拒绝
                    </button>
                    <button
                      type="button"
                      className="mx-btn-gold"
                      style={{ flex: 1 }}
                      disabled={actingId === item.id}
                      onClick={() => void handleDecision(item, "approve")}
                    >
                      {actingId === item.id ? "处理中…" : "确认执行"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button type="button" onClick={() => router.push("/capabilities/risk")} style={{ marginTop: 18, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft width={14} height={14} /> 返回
          </button>
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
            onClick={() => router.push("/capabilities/risk")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              待确认的高风险操作
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              这些操作有风险，你确认后系统才会执行
            </p>
          </div>
          <V2StatusChip tone={confirmations.length > 0 ? "warning" : "success"}>
            {loading ? "加载中" : confirmations.length > 0 ? `${confirmations.length} 项待确认` : "没有待确认项"}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
        </div>
      ) : confirmations.length === 0 ? (
        <V2Section>
          <V2EmptyState
            icon={CheckCircle2}
            title="没有待确认的操作"
            description="有高风险操作需要你确认时，会出现在这里"
          />
        </V2Section>
      ) : (
        <div className="space-y-4">
          {confirmations.map((item) => (
            <V2Section key={item.id} padding={false}>
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] ${
                      item.riskLevel === "high"
                        ? "bg-[var(--kaypal-v3-danger-soft)]"
                        : "bg-[var(--kaypal-v3-amber-soft)]"
                    }`}
                  >
                    {item.riskLevel === "high" ? (
                      <ShieldAlert className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-[var(--kaypal-v3-amber)]" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                        {item.title}
                      </h3>
                      <V2StatusChip tone={RISK_TONE[item.riskLevel] || "warning"}>
                        {item.riskLevel === "high" ? "高风险" : "中风险"}
                      </V2StatusChip>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {item.description}
                    </p>
                    {item.actionLabel && (
                      <p className="mt-1.5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                        将执行:{item.actionLabel}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <V2DangerButton
                    icon={XCircle}
                    loading={actingId === item.id}
                    onClick={() => void handleDecision(item, "reject")}
                  >
                    拒绝
                  </V2DangerButton>
                  <V2PrimaryButton
                    icon={CheckCircle2}
                    loading={actingId === item.id}
                    onClick={() => void handleDecision(item, "approve")}
                  >
                    确认执行
                  </V2PrimaryButton>
                </div>
              </div>
            </V2Section>
          ))}
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/capabilities/risk")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
