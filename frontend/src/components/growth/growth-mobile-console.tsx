"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Briefcase,
  HeartPulse,
  ListChecks,
  LineChart,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  growthApi,
  type GrowthOverview,
} from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

/**
 * 增长工作台 · 移动只读版（P0-4）
 *
 * 桌面端 GrowthConsole（9446 行单体：宽表格 + 批量操作 + 嵌套弹层）在安卓上不可用。
 * 本组件是移动端只读降级：数据总览 + 视图跳转 + 简化卡片流，不提供批量操作。
 * 桌面端保持完整能力不变（GrowthConsole 未动）。
 */

const VIEW_LINKS = [
  { view: "acquisition", label: "获客任务", icon: Target, tint: "#f59e0b" },
  { view: "strategies", label: "获客策略", icon: ListChecks, tint: "#8b5cf6" },
  { view: "leads", label: "线索池", icon: Users, tint: "#3b82f6" },
  { view: "account-health", label: "账号健康", icon: HeartPulse, tint: "#10b981" },
  { view: "reports", label: "数据报告", icon: LineChart, tint: "#ef4444" },
  { view: "workflows", label: "工作流", icon: Activity, tint: "#06b6d4" },
];

function StatCard({
  label,
  value,
  tint,
  icon: Icon,
}: {
  label: string;
  value: number;
  tint: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" style={{ color: tint }} />
        {label}
      </div>
      <div className="text-[22px] font-extrabold leading-none text-slate-900 dark:text-slate-100">
        {value}
      </div>
    </div>
  );
}

export function GrowthMobileConsole({ view }: { view: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [overview, setOverview] = React.useState<GrowthOverview | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await growthApi.overview();
        if (alive) setOverview(data);
      } catch (e) {
        if (alive) setError(toPublicError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const current = VIEW_LINKS.find((v) => v.view === view);

  return (
    <div className="mx-4 pb-28 pt-4">
      {/* 头部 */}
      <header className="mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-500">
          增长获客
        </div>
        <h1 className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">
          {current?.label ?? "增长总览"}
        </h1>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          手机端只读 · 批量操作请用电脑端完成
        </p>
      </header>

      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-xs text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[76px] animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800"
            />
          ))}
        </div>
      ) : overview ? (
        <>
          {/* 今日核心指标 */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            <StatCard
              label="今日新增线索"
              value={overview.todayLeadCount}
              tint="#f59e0b"
              icon={TrendingUp}
            />
            <StatCard
              label="今日已触达"
              value={overview.todayContactedCount}
              tint="#3b82f6"
              icon={Briefcase}
            />
            <StatCard
              label="高意向线索"
              value={overview.highIntentLeadCount}
              tint="#10b981"
              icon={Users}
            />
            <StatCard
              label="账号风险"
              value={overview.accountRiskCount}
              tint="#ef4444"
              icon={ShieldAlert}
            />
          </div>

          {/* 转化漏斗 */}
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center gap-1.5 text-[12px] font-bold text-slate-700 dark:text-slate-200">
              <LineChart className="h-4 w-4 text-orange-500" />
              转化漏斗
            </div>
            <div className="space-y-2">
              {(
                [
                  ["候选", overview.funnel.candidates],
                  ["已筛选", overview.funnel.selected],
                  ["已触达", overview.funnel.contacted],
                  ["已进 CRM", overview.funnel.crmCaptured],
                  ["已转化", overview.funnel.converted],
                ] as const
              ).map(([label, val], i, arr) => {
                const max = Math.max(arr[0][1], 1);
                const pct = Math.round((val / max) * 100);
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                      {label}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400"
                        style={{ width: `${Math.max(pct, 6)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12px] font-bold text-slate-700 dark:text-slate-200">
                      {val}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 视图入口 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-2 text-[12px] font-bold text-slate-700 dark:text-slate-200">
              功能入口
            </div>
            <div className="space-y-1">
              {VIEW_LINKS.map((v) => (
                <button
                  key={v.view}
                  type="button"
                  onClick={() => router.push(`/growth-v2/${v.view}`)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                    v.view === view
                      ? "bg-orange-50 dark:bg-orange-500/10"
                      : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  }`}
                >
                  <v.icon
                    className="h-5 w-5 shrink-0"
                    style={{ color: v.tint }}
                  />
                  <span className="flex-1 text-[13px] font-medium text-slate-800 dark:text-slate-100">
                    {v.label}
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 py-10 text-center text-xs text-slate-400 dark:border-slate-700">
          暂无数据
        </div>
      )}
    </div>
  );
}

// 供页面壳引用的只读说明（re-export 保持 API 稳定）
export const GrowthMobileNote = () => (
  <div className="sr-only">移动端增长工作台为只读模式</div>
);

// 兼容 GrowthConsoleEntry 的视图类型透传
export type { GrowthView } from "./growth-console";
