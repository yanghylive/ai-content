"use client";

import React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Briefcase,
  HeartPulse,
  Layers,
  ListChecks,
  LineChart,
  Loader2,
  PlayCircle,
  ShieldAlert,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  growthApi,
  type GrowthAccountHealth,
  type GrowthAcquisitionConfig,
  type GrowthLead,
  type GrowthOverview,
  type GrowthStrategyTemplate,
  type GrowthWorkflow,
} from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

/**
 * 增长工作台 · 移动只读版（P0-4 + G2 扩展）
 *
 * 桌面端 GrowthConsole（9446 行单体）与 growth-v2 6 子页（独立组件）在安卓上不可用
 * 或操作别扭（宽表格/批量多选/复杂表单）。本组件是移动端只读降级：
 *   - overview：总览卡 + 转化漏斗 + 视图入口
 *   - acquisition / strategies / leads / account-health / reports / workflows：
 *     各自加载数据渲染简化卡片流（只读，无批量操作/无编辑入口）
 * 桌面端保持完整能力不变。
 */

const VIEW_LINKS = [
  { view: "acquisition", label: "获客任务", icon: Target, tint: "#f59e0b" },
  { view: "strategies", label: "获客策略", icon: ListChecks, tint: "#8b5cf6" },
  { view: "leads", label: "线索池", icon: Users, tint: "#3b82f6" },
  { view: "account-health", label: "账号健康", icon: HeartPulse, tint: "#10b981" },
  { view: "reports", label: "数据报告", icon: LineChart, tint: "#ef4444" },
  { view: "workflows", label: "工作流", icon: Activity, tint: "#06b6d4" },
];

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat_channel: "视频号",
  wechat: "微信",
  bilibili: "B站",
  kuaishou: "快手",
};

const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "新线索",
  contacted: "已触达",
  replied: "已回复",
  qualified: "已筛选",
  converted: "已转化",
  invalid: "无效",
};

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

function SectionCard({
  title,
  tint,
  icon: Icon,
  children,
}: {
  title: string;
  tint: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-1.5 text-[12px] font-bold text-slate-700 dark:text-slate-200">
        <Icon className="h-4 w-4" style={{ color: tint }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400 dark:border-slate-700">
      {text}
    </div>
  );
}

function LoadingBox() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      加载中…
    </div>
  );
}

/** 只读横幅：说明手机端只读，批量/编辑请用电脑端 */
function ReadOnlyBanner() {
  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
      手机端为只读视图 · 创建 / 编辑 / 批量操作请用电脑端完成
    </div>
  );
}

export function GrowthMobileConsole({ view }: { view: string }) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [overview, setOverview] = React.useState<GrowthOverview | null>(null);
  const [configs, setConfigs] = React.useState<GrowthAcquisitionConfig[]>([]);
  const [strategies, setStrategies] = React.useState<GrowthStrategyTemplate[]>([]);
  const [leads, setLeads] = React.useState<GrowthLead[]>([]);
  const [accounts, setAccounts] = React.useState<GrowthAccountHealth[]>([]);
  const [workflows, setWorkflows] = React.useState<GrowthWorkflow[]>([]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 按需加载当前视图数据（并行小批量，避免全量拉取）
        const tasks: Promise<unknown>[] = [];
        const setters: Array<(v: never) => void> = [];
        if (view === "overview" || view === "reports") {
          tasks.push(growthApi.overview());
          setters.push(setOverview as (v: never) => void);
        }
        if (view === "acquisition" || view === "overview") {
          tasks.push(growthApi.listConfigs());
          setters.push(setConfigs as (v: never) => void);
        }
        if (view === "strategies" || view === "overview") {
          tasks.push(growthApi.listStrategies());
          setters.push(setStrategies as (v: never) => void);
        }
        if (view === "leads" || view === "overview") {
          tasks.push(growthApi.listLeads({}));
          setters.push(setLeads as (v: never) => void);
        }
        if (view === "account-health" || view === "overview") {
          tasks.push(growthApi.listAccountHealth());
          setters.push(setAccounts as (v: never) => void);
        }
        if (view === "workflows" || view === "overview") {
          tasks.push(growthApi.listWorkflows());
          setters.push(setWorkflows as (v: never) => void);
        }
        const results = await Promise.all(tasks.map((t) => t.catch(() => null)));
        if (!alive) return;
        results.forEach((r, i) => {
          if (r !== null) setters[i](r as never);
        });
      } catch (e) {
        if (alive) setError(toPublicError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [view]);

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
        <LoadingBox />
      ) : (
        <>
          {/* ── overview：总览 + 漏斗 + 入口 ── */}
          {view === "overview" && overview && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <StatCard label="今日新增线索" value={overview.todayLeadCount} tint="#f59e0b" icon={TrendingUp} />
                <StatCard label="今日已触达" value={overview.todayContactedCount} tint="#3b82f6" icon={Briefcase} />
                <StatCard label="高意向线索" value={overview.highIntentLeadCount} tint="#10b981" icon={Users} />
                <StatCard label="账号风险" value={overview.accountRiskCount} tint="#ef4444" icon={ShieldAlert} />
              </div>
              <SectionCard title="转化漏斗" tint="#f59e0b" icon={LineChart}>
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
                        <span className="w-14 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400" style={{ width: `${Math.max(pct, 6)}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[12px] font-bold text-slate-700 dark:text-slate-200">{val}</span>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
              <SectionCard title="功能入口" tint="#8b5cf6" icon={Layers}>
                <div className="space-y-1">
                  {VIEW_LINKS.map((v) => (
                    <button
                      key={v.view}
                      type="button"
                      onClick={() => router.push(`/growth/${v.view}`)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <v.icon className="h-5 w-5 shrink-0" style={{ color: v.tint }} />
                      <span className="flex-1 text-[13px] font-medium text-slate-800 dark:text-slate-100">{v.label}</span>
                      <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                    </button>
                  ))}
                </div>
              </SectionCard>
            </>
          )}

          {/* ── acquisition：获客任务（只读列表） ── */}
          {view === "acquisition" && (
            <>
              <ReadOnlyBanner />
              <SectionCard title={`获客任务（${configs.length}）`} tint="#f59e0b" icon={Target}>
                {configs.length === 0 ? (
                  <EmptyBox text="暂无获客任务，去电脑端创建" />
                ) : (
                  <div className="space-y-2">
                    {configs.map((c) => (
                      <div key={c.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{c.taskName}</span>
                          <span className="shrink-0 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">
                            {PLATFORM_LABEL[c.platform] ?? c.platform}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          日限 {c.dailyLimit} · 单目标 {c.perTargetLimit} · {c.status === "running" || c.status === "enabled" ? "运行中" : "已暂停"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── strategies：获客策略（只读列表） ── */}
          {view === "strategies" && (
            <>
              <ReadOnlyBanner />
              <SectionCard title={`获客策略（${strategies.length}）`} tint="#8b5cf6" icon={ListChecks}>
                {strategies.length === 0 ? (
                  <EmptyBox text="暂无策略，去电脑端生成" />
                ) : (
                  <div className="space-y-2">
                    {strategies.slice(0, 20).map((s) => (
                      <div key={s.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">{s.name}</div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {s.industry} · {s.scenario}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── leads：线索池（只读，无批量） ── */}
          {view === "leads" && (
            <>
              <ReadOnlyBanner />
              <SectionCard title={`线索池（${leads.length}）`} tint="#3b82f6" icon={Users}>
                {leads.length === 0 ? (
                  <EmptyBox text="暂无线索" />
                ) : (
                  <div className="space-y-2">
                    {leads.slice(0, 20).map((l) => (
                      <div key={l.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{l.nickname}</span>
                          <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                            {LEAD_STATUS_LABEL[l.status] ?? l.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{PLATFORM_LABEL[l.platform] ?? l.platform}</span>
                          <span>评分 {l.score}</span>
                        </div>
                        {l.sourceText && (
                          <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{l.sourceText}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── account-health：账号健康（只读） ── */}
          {view === "account-health" && (
            <>
              <ReadOnlyBanner />
              <SectionCard title={`账号健康（${accounts.length}）`} tint="#10b981" icon={HeartPulse}>
                {accounts.length === 0 ? (
                  <EmptyBox text="暂无账号数据" />
                ) : (
                  <div className="space-y-2">
                    {accounts.map((a) => {
                      const riskColor =
                        a.riskStatus === "normal" ? "#10b981" : a.riskStatus === "cooldown" ? "#f59e0b" : "#ef4444";
                      return (
                        <div key={a.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{a.accountName}</span>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${riskColor}1a`, color: riskColor }}>
                              {a.riskStatus}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {PLATFORM_LABEL[a.platform] ?? a.platform} · 今日 {a.todayActionCount} 次 · 失败率 {a.failureRate}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── workflows：工作流（只读列表） ── */}
          {view === "workflows" && (
            <>
              <ReadOnlyBanner />
              <SectionCard title={`工作流（${workflows.length}）`} tint="#06b6d4" icon={Activity}>
                {workflows.length === 0 ? (
                  <EmptyBox text="暂无工作流，去电脑端创建" />
                ) : (
                  <div className="space-y-2">
                    {workflows.map((w) => (
                      <div key={w.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{w.name}</span>
                          <span className="shrink-0 rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-bold text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300">
                            {w.status}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                          {w.steps.length} 步 · {w.template}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {/* ── reports：数据报告（只读摘要） ── */}
          {view === "reports" && overview && (
            <>
              <ReadOnlyBanner />
              <SectionCard title="转化漏斗" tint="#ef4444" icon={LineChart}>
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
                        <span className="w-14 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-orange-400" style={{ width: `${Math.max(pct, 6)}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[12px] font-bold text-slate-700 dark:text-slate-200">{val}</span>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="今日新增线索" value={overview.todayLeadCount} tint="#f59e0b" icon={TrendingUp} />
                <StatCard label="活跃获客任务" value={overview.activeConfigCount} tint="#8b5cf6" icon={PlayCircle} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export type { GrowthView } from "./growth-console";
