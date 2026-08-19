"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp, MessageSquareText } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { growthApi, type GrowthReports } from "@/lib/api/growth";
import { statsApi, type StatsSnapshot } from "@/lib/api/stats";
import { toPublicError } from "@/lib/public-error";

export function GrowthReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<GrowthReports | null>(null);
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      // 漏斗统一走后端 StatsSnapshot（growth 域累计口径），其余（六阶段/文案/趋势）仍走 reports
      const [data, snap] = await Promise.all([
        growthApi.reports(),
        statsApi.snapshot("growth").catch(() => null),
      ]);
      setReports(data);
      setStats(snap);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载复盘数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  // stats 加载失败返回 null，展示层显示 N/A（方案 10.2/12.2：服务失败 ≠ 0）
  const metric = (key: string): number | null => {
    const found = stats?.metrics?.find((m) => m.key === key);
    return typeof found?.value === "number" ? found.value : null;
  };
  const funnel = {
    candidates: metric("growth.funnel.candidates"),
    selected: metric("growth.funnel.selected"),
    contacted: metric("growth.funnel.contacted"),
    crmCaptured: metric("growth.funnel.crm_captured"),
    converted: metric("growth.funnel.converted"),
  };
  const sixStage = reports?.sixStage;
  const copywriting = reports?.copywriting || [];
  const trend = reports?.trend || [];

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/growth")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">增长复盘</h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              看看哪些打法有效、哪些话术转化高
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 漏斗 */}
      {funnel && (
        <V2Section title="整体漏斗">
          <div className="flex items-center gap-2">
            {[
              { label: "候选人", value: funnel.candidates },
              { label: "已筛选", value: funnel.selected },
              { label: "已触达", value: funnel.contacted },
              { label: "进 CRM", value: funnel.crmCaptured },
              { label: "已成交", value: funnel.converted },
            ].map((stage, i) => (
              <div key={stage.label} className="flex flex-1 items-center gap-2">
                {i > 0 && <span className="text-[var(--kaypal-v3-muted)]">→</span>}
                <div className="flex-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-center" style={{ opacity: 1 - i * 0.15 }}>
                  <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                    {loading ? "-" : stage.value === null ? "N/A" : stage.value}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">{stage.label}</p>
                </div>
              </div>
            ))}
          </div>
        </V2Section>
      )}

      {/* 增长流程（内容→发布→互动→线索→客户→商机，按来源归因） */}
      {sixStage && (
        <V2Section
          title="增长流程"
          description={`内容→发布→互动→线索→客户→商机 · 归因置信度${
            sixStage.attributionConfidence === "high"
              ? "高"
              : sixStage.attributionConfidence === "medium"
                ? "中"
                : "低"
          }`}
        >
          <div className="flex items-center gap-2">
            {[
              { label: "内容", value: sixStage.content },
              { label: "发布", value: sixStage.publish },
              { label: "互动", value: sixStage.interaction },
              { label: "线索", value: sixStage.lead },
              { label: "客户", value: sixStage.customer },
              { label: "商机", value: sixStage.opportunity },
            ].map((stage, i) => (
              <div key={stage.label} className="flex flex-1 items-center gap-2">
                {i > 0 && <span className="text-[var(--kaypal-v3-muted)]">→</span>}
                <div
                  className="flex-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-center"
                  style={{ opacity: 1 - i * 0.12 }}
                >
                  <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                    {loading ? "-" : stage.value === 0 ? "N/A" : stage.value}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">{stage.label}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[var(--kaypal-v3-muted)]">
            <span>
              内容转化率{" "}
              <b className="text-[var(--kaypal-v3-ink)]">
                {Math.round((sixStage.contentConversionRate || 0) * 100)}%
              </b>
            </span>
            <span>
              归因线索 <b className="text-[var(--kaypal-v3-ink)]">{sixStage.attributedLeadCount}</b>
            </span>
            <span>
              归因客户 <b className="text-[var(--kaypal-v3-ink)]">{sixStage.attributedCustomerCount}</b>
            </span>
          </div>
        </V2Section>
      )}

      {/* 高效话术 */}
      <V2Section title="高效话术 TOP" description="用得最多、转化最好的话术">
        {loading ? (
          <div className="py-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
        ) : copywriting.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--kaypal-v3-muted)]">
            还没有话术数据，跑几天获客任务就有了
          </p>
        ) : (
          <div className="space-y-3">
            {copywriting.slice(0, 5).map((copy, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4"
              >
                <div className="flex flex-1 items-center gap-3">
                  <MessageSquareText className="h-5 w-5 shrink-0 text-[var(--kaypal-v3-muted)]" />
                  <p className="line-clamp-1 flex-1 text-sm text-[var(--kaypal-v3-soft-ink)]">
                    {copy.text}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-sm">
                  <span className="text-[var(--kaypal-v3-muted)]">
                    用 {copy.usageCount} 次
                  </span>
                  <V2StatusChip tone={copy.contactRate > 0.3 ? "success" : "muted"}>
                    触达率 {Math.round(copy.contactRate * 100)}%
                  </V2StatusChip>
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>

      {/* 趋势 */}
      {trend.length > 0 && (
        <V2Section title="近期趋势">
          <div className="flex items-end gap-1">
            {trend.slice(-14).map((day, i) => {
              const item = day as { date?: string; leadCount?: number; count?: number };
              const value = item.leadCount ?? item.count ?? 0;
              const max = Math.max(...trend.map((d) => ((d as { leadCount?: number; count?: number }).leadCount ?? (d as { count?: number }).count ?? 0)), 1);
              const height = Math.max((value / max) * 100, 4);
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs text-[var(--kaypal-v3-muted)]">{value}</span>
                  <div
                    className="w-full rounded-t bg-[var(--kaypal-v3-accent)]"
                    style={{ height: `${height}px`, minHeight: "4px" }}
                  />
                  <span className="text-[10px] text-[var(--kaypal-v3-muted)]">
                    {item.date ? new Date(item.date).getDate() + "日" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </V2Section>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/growth")}>
          返回增长控制台
        </V2GhostButton>
        <V2GhostButton icon={TrendingUp} onClick={() => void fetchReports()}>
          刷新
        </V2GhostButton>
      </section>
    </div>
  );
}
