"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle, ShieldCheck, RefreshCcw } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { localEngineApi, type LocalEngineReadiness } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export function EnginePermissions() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [readiness, setReadiness] = useState<LocalEngineReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReadiness = useCallback(async () => {
    try {
      setLoading(true);
      const data = await localEngineApi.readiness();
      setReadiness(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载安全检查失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRecheck = async () => {
    setChecking(true);
    await fetchReadiness();
    setChecking(false);
  };

  useEffect(() => {
    void fetchReadiness();
  }, [fetchReadiness]);

  const blockers = readiness?.blockers || [];
  const warnings = readiness?.warnings || [];
  const allClear = blockers.length === 0;

  /* 移动端原生视图（mx-* 明德 VP 风格）——local-engine-v2/permissions */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <button type="button" onClick={() => router.push("/local-engine")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, marginBottom: 6 }}>
              <ArrowLeft width={14} height={14} /> 返回设备状态
            </button>
            <div className="mx-page-title">安全检查</div>
            <div className="mx-page-sub">权限和安全的完整检查结果</div>
          </div>

          {/* 状态 + 重新检查 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span className={`mx-badge ${allClear ? "mx-badge-green" : "mx-badge-red"}`} style={{ fontSize: 10.5 }}>
              {loading ? "检查中…" : allClear ? "全部通过" : `${blockers.length} 项未通过`}
            </span>
            <button type="button" className="mx-btn-gold" style={{ flexShrink: 0, padding: "8px 14px", fontSize: 11.5 }} disabled={checking} onClick={() => void handleRecheck()}>
              {checking ? "检查中…" : "重新检查"}
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 未通过项 */}
          {blockers.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 14 }}>未通过项（需要处理）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {blockers.map((item, i) => (
                  <div key={i} className="mx-card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <XCircle width={16} height={16} style={{ color: "#dc2626", flexShrink: 0, marginTop: 1 }} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--mx-ink)" }}>{item.capability}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 3, lineHeight: 1.5 }}>{item.message}</span>
                      {item.nextAction && (
                        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "#d98a2d", marginTop: 5 }}>怎么办：{item.nextAction}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 警告 */}
          {warnings.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 14 }}>警告（建议处理）</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {warnings.map((item, i) => {
                  const w = item as { capability?: string; message?: string };
                  return (
                    <div key={i} className="mx-card" style={{ padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <ShieldCheck width={16} height={16} style={{ color: "#b45309", flexShrink: 0, marginTop: 1 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--mx-ink)" }}>{w.capability || `警告 ${i + 1}`}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 3, lineHeight: 1.5 }}>{w.message || String(item)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* 全部通过 */}
          {!loading && allClear && (
            <div className="mx-card" style={{ marginTop: 12, padding: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderColor: "rgba(5,150,105,.4)" }}>
              <CheckCircle2 width={18} height={18} style={{ color: "#059669" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>安全检查全部通过</span>
            </div>
          )}

          <button type="button" onClick={() => router.push("/local-engine")} style={{ marginTop: 16, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
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
            onClick={() => router.push("/local-engine")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              安全检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              权限和安全的完整检查结果
            </p>
          </div>
          <V2StatusChip tone={allClear ? "success" : "danger"}>
            {loading ? "检查中" : allClear ? "全部通过" : `${blockers.length} 项未通过`}
          </V2StatusChip>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {blockers.length > 0 && (
        <V2Section title="未通过项（需要处理）" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {blockers.map((item, i) => (
              <div key={i} className="flex items-start gap-4 p-5">
                <XCircle className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-danger)]" />
                <div className="flex-1">
                  <p className="font-medium text-[var(--kaypal-v3-ink)]">
                    {item.capability}
                  </p>
                  <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                    {item.message}
                  </p>
                  {item.nextAction && (
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-accent-ink)]">
                      怎么办：{item.nextAction}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {warnings.length > 0 && (
        <V2Section title="警告（建议处理）" padding={false}>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {warnings.map((item, i) => {
              const w = item as { capability?: string; message?: string };
              return (
                <div key={i} className="flex items-start gap-4 p-5">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--kaypal-v3-amber)]" />
                  <div className="flex-1">
                    <p className="font-medium text-[var(--kaypal-v3-ink)]">
                      {w.capability || `警告 ${i + 1}`}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                      {w.message || String(item)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      {!loading && allClear && (
        <div className="flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-6">
          <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
          <span className="font-medium text-[var(--kaypal-v3-success)]">
            安全检查全部通过
          </span>
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
        <V2PrimaryButton icon={RefreshCcw} loading={checking} onClick={() => void handleRecheck()}>
          {checking ? "正在检查..." : "重新检查"}
        </V2PrimaryButton>
      </section>
    </div>
  );
}
