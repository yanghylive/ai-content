"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCcw, ScrollText } from "lucide-react";
import {
  V2Section,
  V2GhostButton,
  V2Select,
} from "@/components/v2/ui-kit";
import {
  localEngineApi,
  type LocalEngineRuntimeServiceKey,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const SERVICES: { key: LocalEngineRuntimeServiceKey; label: string }[] = [
  { key: "backend", label: "业务服务" },
  { key: "frontend", label: "前端服务" },
  { key: "agent-s", label: "桌面助手" },
] as const;

export function EngineLogs() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [service, setService] = useState<LocalEngineRuntimeServiceKey>("agent-s");
  const [log, setLog] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(async (key: LocalEngineRuntimeServiceKey) => {
    setError(null);
    try {
      setLoading(true);
      const data = await localEngineApi.runtimeLog(key, 120);
      setLog(
        typeof data === "string"
          ? data
          : (data as { content?: string; log?: string }).content ||
              (data as { log?: string }).log ||
              JSON.stringify(data, null, 2),
      );
    } catch (err: unknown) {
      setError(toPublicError(err, "加载日志失败"));
      setLog("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLog(service);
  }, [service, fetchLog]);

  /* 移动端原生视图（mx-* 明德 VP 风格）——local-engine-v2/logs */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/local-engine")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回设备状态
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>高级信息</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>各服务的运行日志，排查问题时用</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {/* 服务选择 + 刷新 */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <select
              value={service}
              onChange={(e) => setService(e.target.value as LocalEngineRuntimeServiceKey)}
              style={{ flex: 1, padding: "9px 11px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}
            >
              {SERVICES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => void fetchLog(service)} style={{ flexShrink: 0, padding: "9px 13px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <RefreshCcw width={13} height={13} /> 刷新
            </button>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {/* 日志 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "9px 12px", borderBottom: "1px solid rgba(142,165,190,.18)", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--mx-muted)" }}>
              <ScrollText width={13} height={13} />
              {SERVICES.find((s) => s.key === service)?.label} · 最近 120 行
            </div>
            <pre style={{ maxHeight: 380, overflow: "auto", padding: 12, fontFamily: "monospace", fontSize: 10.5, lineHeight: 1.6, color: "var(--mx-ink)", margin: 0 }}>
              {loading ? "正在加载日志…" : log || "暂无日志"}
            </pre>
          </div>

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
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              高级信息
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              各服务的运行日志，排查问题时用
            </p>
          </div>
          <div className="w-40">
            <V2Select
              value={service}
              onChange={(e) =>
                setService(e.target.value as LocalEngineRuntimeServiceKey)
              }
            >
              {SERVICES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </V2Select>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section padding={false}>
        <div className="flex items-center justify-between border-b border-[var(--kaypal-v3-border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
            <ScrollText className="h-4 w-4" />
            {SERVICES.find((s) => s.key === service)?.label} · 最近 120 行
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-[var(--kaypal-v3-accent-ink)] transition hover:underline"
            onClick={() => void fetchLog(service)}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            刷新
          </button>
        </div>
        <pre className="max-h-[480px] overflow-auto p-4 font-mono text-xs leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
          {loading ? "正在加载日志..." : log || "暂无日志"}
        </pre>
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/local-engine")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
