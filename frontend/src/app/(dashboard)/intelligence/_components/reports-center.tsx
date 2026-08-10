"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Plus, RefreshCcw } from "lucide-react";
import { intelligenceApi, type IntelligenceReport } from "@/lib/api/intelligence";
import { toPublicError } from "@/lib/public-error";
import {
  V2EmptyState,
  V2GhostButton,
  V2PrimaryButton,
  V2Section,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { useIsMobile } from "@/lib/hooks/use-media-query";

/** 情报报告——真实报告列表（不再有写死的示例数字） */
export function ReportsCenter() {
  const router = useRouter();
  const [reports, setReports] = useState<IntelligenceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await intelligenceApi.listReports({ limit: 50 } as never);
      const data = result as { items?: IntelligenceReport[] } | IntelligenceReport[] | null;
      const items = Array.isArray(data) ? data : data?.items || [];
      setReports(items);
    } catch (err: unknown) {
      setError(toPublicError(err, "报告读取失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusTone = (status?: string) => {
    if (status === "completed" || status === "published") return "success" as const;
    if (status === "generating" || status === "draft") return "warning" as const;
    return "muted" as const;
  };
  const statusLabel = (status?: string) =>
    ({ completed: "已完成", published: "已发布", generating: "生成中", draft: "草稿" } as Record<string, string>)[status || ""] || status || "未知";

  const isMobile = useIsMobile();
  if (isMobile) {
    const mobileStatusBadge = (status?: string) =>
      status === "completed" || status === "published" ? "mx-badge mx-badge-green"
        : status === "generating" || status === "draft" ? "mx-badge mx-badge-gold"
          : "mx-badge";
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">情报报告</h1>
              <p className="mx-page-sub">AI 生成的分析报告 · 共 {reports.length} 份</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap" }}
              onClick={() => router.push("/intelligence/reports?action=new")}
            >
              <Plus size={13} style={{ marginRight: 3 }} />
              生成新报告
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
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : reports.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>还没有报告</p>
              <p style={{ fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>点「生成新报告」选个主题，AI 自动汇总监控和收件箱写一份</p>
              <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/intelligence/reports?action=new")}>
                <Plus size={13} style={{ marginRight: 3 }} />生成新报告
              </button>
            </div>
          ) : (
            <div className="mx-card mx-list-card">
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => router.push(`/intelligence/reports?id=${report.id}`)}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb", borderRadius: 999 }}>
                    <FileText size={18} strokeWidth={1.8} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{report.title || "未命名报告"}</div>
                    <div className="mx-row-desc">
                      {report.kind || "分析报告"}
                      {report.createdAt ? ` · ${new Date(report.createdAt).toLocaleDateString("zh-CN")}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    <span className={mobileStatusBadge(report.status)}>{statusLabel(report.status)}</span>
                    <ArrowLeft size={15} className="rotate-180" style={{ color: "#b9c5d4" }} />
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
      {/* 头部 */}
      <section className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="kaypal-v3-icon-tile h-12 w-12">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">情报报告</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              AI 生成的分析报告，可直接给老板看 · 共 {reports.length} 份
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <V2GhostButton icon={RefreshCcw} onClick={() => void load()}>刷新</V2GhostButton>
          <V2PrimaryButton icon={Plus} onClick={() => router.push("/intelligence/reports?action=new")}>
            生成新报告
          </V2PrimaryButton>
        </div>
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
      ) : reports.length === 0 ? (
        <V2EmptyState
          icon={FileText}
          title="还没有报告"
          description="点「生成新报告」选个主题，AI 会自动汇总监控和收件箱里的情报写一份"
          action={
            <V2PrimaryButton icon={Plus} onClick={() => router.push("/intelligence/reports?action=new")}>
              生成新报告
            </V2PrimaryButton>
          }
        />
      ) : (
        <V2Section title={`全部报告（${reports.length}）`}>
          <div className="flex flex-col gap-3">
            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                className="kaypal-v3-panel flex items-center justify-between p-5 text-left transition hover:border-[var(--kaypal-v3-accent)]"
                onClick={() => router.push(`/intelligence/reports?id=${report.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-[var(--kaypal-v3-ink)]">
                      {report.title || "未命名报告"}
                    </h3>
                    <V2StatusChip tone={statusTone(report.status)}>
                      {statusLabel(report.status)}
                    </V2StatusChip>
                  </div>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {report.kind || "分析报告"}
                    {report.createdAt ? ` · ${new Date(report.createdAt).toLocaleDateString("zh-CN")}` : ""}
                  </p>
                </div>
                <ArrowLeft className="h-4 w-4 rotate-180 text-[var(--kaypal-v3-muted)]" />
              </button>
            ))}
          </div>
        </V2Section>
      )}
    </div>
  );
}
