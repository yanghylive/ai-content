"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Factory, RefreshCcw } from "lucide-react";
import { intelligenceApi, type IntelligenceMonitorSummary } from "@/lib/api/intelligence";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "公众号",
  bilibili: "B站",
};

/** 行业情报——按平台/行业分组的真实监控概览（不再写死） */
export function IndustryCenter() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<IntelligenceMonitorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await intelligenceApi.listMonitors();
      const items = Array.isArray(result) ? result : (result as { items?: IntelligenceMonitorSummary[] })?.items || [];
      setMonitors(items.filter((m) => m.status !== "archived"));
    } catch (err: unknown) {
      setError(toPublicError(err, "行业情报读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = monitors.filter((m) => m.status === "active").length;
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">行业情报</h1>
              <p className="mx-page-sub">你关注的行业监控 · {activeCount} 个进行中</p>
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
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : monitors.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>还没有行业监控</p>
              <p style={{ fontSize: 11, marginTop: 4 }}>去监控页建一个关键词监控，行业情报会按平台聚合</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/intelligence/monitors")}>去建监控</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {monitors.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="mx-card"
                  style={{ padding: 14, textAlign: "left", border: "none", cursor: "pointer", width: "100%" }}
                  onClick={() => router.push("/intelligence/monitors")}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="mx-row-title" style={{ fontSize: 13.5, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.keyword || m.industry || "未命名监控"}
                    </span>
                    <span className={`mx-badge ${m.status === "active" ? "mx-badge-green" : ""}`}>
                      {m.status === "active" ? "监控中" : "已暂停"}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--mx-muted)" }}>
                    {PLATFORM_NAMES[m.platform || ""] || m.platform || "全网"}
                    {m.type === "keyword" ? " · 关键词" : m.type === "industry" ? " · 行业" : ""}
                    {m.lastRunAt ? ` · 上次 ${new Date(m.lastRunAt).toLocaleDateString("zh-CN")}` : " · 还没跑过"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <Factory className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">行业情报</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              你关注的行业监控 · {activeCount} 个进行中
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
      ) : monitors.length === 0 ? (
        <V2EmptyState
          icon={Factory}
          title="还没有行业监控"
          description="去监控页建一个关键词监控，行业情报会按平台聚合在这里"
          action={
            <V2GhostButton onClick={() => router.push("/intelligence/monitors")}>
              去建监控
            </V2GhostButton>
          }
        />
      ) : (
        <V2Section title={`监控中的方向（${monitors.length}）`}>
          <div className="grid gap-3 md:grid-cols-2">
            {monitors.map((m) => (
              <button
                key={m.id}
                type="button"
                className="kaypal-v3-panel p-5 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                onClick={() => router.push("/intelligence/monitors")}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--kaypal-v3-ink)]">
                    {m.keyword || m.industry || "未命名监控"}
                  </h3>
                  <V2StatusChip tone={m.status === "active" ? "success" : "muted"}>
                    {m.status === "active" ? "监控中" : "已暂停"}
                  </V2StatusChip>
                </div>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {PLATFORM_NAMES[m.platform || ""] || m.platform || "全网"}
                  {m.type === "keyword" ? " · 关键词监控" : m.type === "industry" ? " · 行业监控" : ""}
                  {m.lastRunAt ? ` · 上次 ${new Date(m.lastRunAt).toLocaleDateString("zh-CN")}` : " · 还没跑过"}
                </p>
              </button>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
