"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChartNoAxesCombined,
  ClipboardList,
  Route,
  ShieldCheck,
  Target,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { growthApi, type GrowthOverview } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

export function GrowthCenter() {
  const router = useRouter();
  const [overview, setOverview] = useState<GrowthOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      const data = await growthApi.overview();
      setOverview(data);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载增长数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const funnel = overview?.funnel;

  return (
    <div className="flex flex-col gap-6">
      <WorkbenchCenter
        title="增长控制台"
        subtitle="今天的获客进展和漏斗，一目了然"
        icon={ChartNoAxesCombined}
        stats={[
          {
            label: "今日新线索",
            value: loading ? "-" : overview?.todayLeadCount ?? 0,
            tone: "accent",
          },
          {
            label: "今日已触达",
            value: loading ? "-" : overview?.todayContactedCount ?? 0,
            tone: "success",
          },
          {
            label: "今日进 CRM",
            value: loading ? "-" : overview?.todayCrmCapturedCount ?? 0,
            tone: "success",
          },
          {
            label: "高意向线索",
            value: loading ? "-" : overview?.highIntentLeadCount ?? 0,
            tone: (overview?.highIntentLeadCount ?? 0) > 0 ? "warning" : "default",
          },
        ]}
        primaryAction={{ label: "新建获客任务", href: "/auto-acquisition/create" }}
        quickActions={[
          {
            key: "leads",
            title: "线索池",
            description: "今天抓到的潜在客户",
            icon: UsersRound,
            href: "/growth/leads",
            badge: (overview?.todayLeadCount ?? 0) > 0 ? String(overview?.todayLeadCount) : undefined,
          },
          {
            key: "acquisition",
            title: "获客任务",
            description: "自动找客户的任务",
            icon: Target,
            href: "/auto-acquisition/create",
          },
          {
            key: "strategies",
            title: "获客策略",
            description: "按行业的获客打法",
            icon: ClipboardList,
            href: "/growth/strategies",
          },
          {
            key: "workflows",
            title: "增长工作流",
            description: "多步骤自动化流程",
            icon: Route,
            href: "/growth/workflows",
          },
          {
            key: "account-health",
            title: "账号健康",
            description: "各平台账号状态",
            icon: ShieldCheck,
            href: "/growth/account-health",
            badge: (overview?.accountRiskCount ?? 0) > 0 ? String(overview?.accountRiskCount) : undefined,
          },
          {
            key: "reports",
            title: "增长复盘",
            description: "效果数据回顾",
            icon: TrendingUp,
            href: "/growth/reports",
          },
        ]}
        advancedLinks={[
          { key: "console", title: "旧版控制台", icon: ChartNoAxesCombined, href: "/growth" },
        ]}
      />

      {/* 转化漏斗 */}
      {funnel && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            转化漏斗
          </h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            {[
              { label: "候选人", value: funnel.candidates },
              { label: "已筛选", value: funnel.selected },
              { label: "已触达", value: funnel.contacted },
              { label: "进 CRM", value: funnel.crmCaptured },
              { label: "已成交", value: funnel.converted },
            ].map((stage, i) => {
              return (
                <div
                  key={stage.label}
                  className="flex w-full items-center gap-2 sm:flex-1"
                >
                  {i > 0 && (
                    <span className="text-[var(--kaypal-v3-muted)]">→</span>
                  )}
                  <div className="flex-1">
                    <div
                      className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] p-3 text-center transition-all"
                      style={{ opacity: 1 - i * 0.15 }}
                    >
                      <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                        {loading ? "-" : stage.value}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                        {stage.label}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-[var(--kaypal-v3-muted)]">
            成交率：
            {funnel.contacted > 0
              ? `${((funnel.converted / funnel.contacted) * 100).toFixed(1)}%`
              : "暂无数据"}
          </p>
        </section>
      )}

      {/* 热门策略 */}
      {overview?.hotStrategies && overview.hotStrategies.length > 0 && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            热门获客策略
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {overview.hotStrategies.slice(0, 4).map((strategy) => (
              <button
                key={strategy.id}
                type="button"
                className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4 text-left transition hover:border-[var(--kaypal-v3-border-strong)]"
                onClick={() => router.push("/growth/strategies")}
              >
                <p className="font-medium text-[var(--kaypal-v3-ink)]">
                  {strategy.name}
                </p>
                <p className="mt-1 line-clamp-2 text-sm text-[var(--kaypal-v3-muted)]">
                  {strategy.scenario || strategy.industry || ""}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
