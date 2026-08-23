"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ChartNoAxesCombined,
  ClipboardList,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Wallet,
} from "lucide-react";
import { WorkbenchCenter } from "@/components/v2/workbench-center";
import { growthApi, type GrowthAcquisitionRun, type GrowthHomeBlocker, type GrowthHomeResponse, type GrowthOverview } from "@/lib/api/growth";
import { toPublicError } from "@/lib/public-error";

/** T05：把页码值显示成"暂无数据/不可用"（null ≠ 0，口径铁律） */
function displayStat(value: number | null | undefined, emptyText = "暂无数据"): string {
  if (value === null || value === undefined) return emptyText;
  if (Number.isNaN(value)) return emptyText;
  return String(value);
}

/** T05：最近运行六态标签（失败不伪装成功） */
const RUN_STATUS_TONE: Record<string, { label: string; className: string }> = {
  success: { label: "成功", className: "bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success-ink)]" },
  partial: { label: "部分成功", className: "bg-[var(--kaypal-v3-warning-soft)] text-[var(--kaypal-v3-warning-ink)]" },
  failed: { label: "失败", className: "bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger-ink)]" },
  skipped: { label: "已跳过", className: "bg-[var(--kaypal-v3-muted-soft)] text-[var(--kaypal-v3-muted)]" },
  queued: { label: "排队中", className: "bg-[var(--kaypal-v3-muted-soft)] text-[var(--kaypal-v3-muted)]" },
  running: { label: "运行中", className: "bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]" },
};

function RunStatusBadge({ status }: { status: string }) {
  const tone = RUN_STATUS_TONE[status] ?? { label: status, className: "bg-[var(--kaypal-v3-muted-soft)] text-[var(--kaypal-v3-muted)]" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.className}`}>
      {tone.label}
    </span>
  );
}

/** T05：阻断任务卡（blockers 空则不渲染） */
function BlockersSection({ blockers }: { blockers: GrowthHomeBlocker[] }) {
  if (!blockers || blockers.length === 0) return null;
  return (
    <section className="kaypal-v3-panel p-6" style={{ border: "1px solid var(--kaypal-v3-danger-border)" }}>
      <h2 className="text-base font-semibold text-[var(--kaypal-v3-danger-ink)]">需要处理</h2>
      <div className="mt-3 flex flex-col gap-2">
        {blockers.map((blocker) => (
          <div key={blocker.code} className="flex items-center justify-between gap-3 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--kaypal-v3-danger-ink)]">{blocker.title}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--kaypal-v3-danger-ink)] opacity-70">{blocker.action}</p>
            </div>
            <span className="shrink-0 rounded bg-[var(--kaypal-v3-paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--kaypal-v3-muted)]">{blocker.code}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** T05：最近运行列表（空 → 空态；六态标签） */
function RecentRunsSection({ runs }: { runs: GrowthAcquisitionRun[] }) {
  return (
    <section className="kaypal-v3-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">最近运行</h2>
        <button
          type="button"
          className="text-xs font-medium text-[var(--kaypal-v3-accent)] hover:underline"
          onClick={() => { window.location.href = "/growth/acquisition"; }}
        >
          查看全部
        </button>
      </div>
      {!runs || runs.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">暂无运行记录，创建获客任务后这里会展示执行情况。</p>
      ) : (
        <div className="mt-4 flex flex-col divide-y divide-[var(--kaypal-v3-border)]">
          {runs.slice(0, 8).map((run) => (
            <div key={run.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--kaypal-v3-ink)]">{run.message || run.platform || run.id}</p>
                <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                  {run.platform} · {run.startedAt ? new Date(run.startedAt).toLocaleString("zh-CN", { hour12: false }) : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RunStatusBadge status={run.status} />
                <span className="text-xs tabular-nums text-[var(--kaypal-v3-muted)]">
                  {run.contactedCount ?? 0}/{run.candidateCount ?? 0} 触达
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** T4-9：今日 AI 简报卡——一进门先看到 AI 在干什么 */
function AiDailyBriefCard({ overview }: { overview: GrowthOverview | null }) {
  const activeConfigs = overview?.activeConfigCount ?? 0;
  const highIntent = overview?.highIntentLeadCount ?? 0;
  const newLeads = overview?.todayLeadCount ?? 0;
  const riskAccounts = overview?.accountRiskCount ?? 0;

  const sentences: string[] = [];
  if (activeConfigs > 0) {
    sentences.push(`AI 正在监控 ${activeConfigs} 个获客任务`);
  } else {
    sentences.push("AI 尚未运行获客任务，可以先创建一个");
  }
  if (newLeads > 0) {
    sentences.push(`今日发现 ${newLeads} 条新线索`);
  }
  if (highIntent > 0) {
    sentences.push(`识别出 ${highIntent} 条高意向线索`);
    sentences.push(`${highIntent} 条建议今天优先跟进`);
  }
  if (riskAccounts > 0) {
    sentences.push(`${riskAccounts} 个账号需要处理`);
  }
  const summary =
    sentences.length > 0
      ? sentences.join("，")
      : "AI 正在持续监控各平台线索，有发现会第一时间汇总到这里。";

  return (
    <div
      className="kaypal-v3-panel p-5"
      style={{ border: "1px solid var(--kaypal-v3-border)" }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
        <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
          今日 AI 简报
        </h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
        {summary}
      </p>
      {highIntent > 0 && (
        <p className="mt-1 text-xs text-[var(--kaypal-v3-accent)]">
          高意向线索的评分与理由见下方线索池，点击可查看 AI 判断依据。
        </p>
      )}
    </div>
  );
}

/** T4-11 + T4-12：AI 价值账单——把 AI 干的活折算成时间和钱，让价值看得见 */
function AiValueBill({ overview }: { overview: GrowthOverview | null }) {
  const funnel = overview?.funnel;
  if (!funnel) return null;

  const candidates = funnel.candidates ?? 0;
  const crmCaptured = funnel.crmCaptured ?? 0;

  // 估算口径（页面注明"估算"）：人工逐条看候选约 2 分钟/条；高意向线索按 ¥50/条估；进 CRM 按 ¥200/条估
  const manualHours = Math.round((candidates * 2) / 60);
  const leadValue = Math.round((candidates * 50) / 100) * 100;
  const crmValue = crmCaptured * 200;
  const totalValue = leadValue + crmValue;

  const items: Array<{ label: string; value: string; hint?: string }> = [];
  if (candidates > 0) {
    items.push({
      label: "AI 累计扫描",
      value: `${candidates.toLocaleString()} 条候选`,
      hint: "人工逐条看约需 2 分钟/条",
    });
    items.push({
      label: "折算人工",
      value: `≈ ${manualHours} 小时`,
      hint: `=${candidates.toLocaleString()} 条 × 2 分钟 ÷ 60`,
    });
  }
  if (crmCaptured > 0) {
    items.push({
      label: "已沉淀 CRM",
      value: `${crmCaptured} 条`,
      hint: "按 ¥200/条估",
    });
  }
  if (totalValue > 0) {
    items.push({
      label: "累计价值",
      value: `≈ ¥${totalValue.toLocaleString()}`,
      hint: `${leadValue.toLocaleString()}+${crmValue.toLocaleString()}`,
    });
  }
  if (!items.length) {
    items.push({
      label: "累计价值",
      value: "数据收集中",
      hint: "任务开始执行后，这里会换算 AI 帮你省下的时间与价值",
    });
  }

  return (
    <div className="kaypal-v3-panel p-5">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
        <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
          AI 价值账单
        </h2>
        <span className="rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--kaypal-v3-accent-ink)]">
          估算
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-3"
          >
            <p className="text-xs text-[var(--kaypal-v3-muted)]">{item.label}</p>
            <p className="mt-1 text-lg font-bold text-[var(--kaypal-v3-ink)]">
              {item.value}
            </p>
            {item.hint && (
              <p className="mt-0.5 text-[10px] text-[var(--kaypal-v3-muted)]">
                {item.hint}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[var(--kaypal-v3-muted)]">
        * 估算口径：人工浏览 2 分钟/条、线索 ¥50/条、进 CRM ¥200/条，仅供参考，不代表实际成交。
      </p>
    </div>
  );
}

export function GrowthCenter() {
  const router = useRouter();
  const [overview, setOverview] = useState<GrowthOverview | null>(null);
  const [home, setHome] = useState<GrowthHomeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      setLoading(true);
      const [overviewData, homeData] = await Promise.all([
        growthApi.overview(),
        growthApi.getGrowthHome("today"),
      ]);
      setOverview(overviewData);
      setHome(homeData);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载增长数据失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const homeFunnel = useMemo(() => home?.funnel, [home]);
  const homeRuns = useMemo(() => home?.recentRuns ?? [], [home]);
  const homeBlockers = useMemo(() => home?.blockers ?? [], [home]);

  // 七段漏斗：candidates→selected→contacted→leads→customers→opportunities→won（/growth/home 口径）
  const sevenStages = useMemo(() => {
    if (!homeFunnel) return null;
    return [
      { label: "候选", value: homeFunnel.candidates },
      { label: "已筛选", value: homeFunnel.selected },
      { label: "已触达", value: homeFunnel.contacted },
      { label: "线索", value: homeFunnel.leads },
      { label: "客户", value: homeFunnel.customers },
      { label: "商机", value: homeFunnel.opportunities },
      { label: "成交", value: homeFunnel.won },
    ];
  }, [homeFunnel]);

  return (
    <div className="kx-view flex flex-col gap-6">
      <AiDailyBriefCard overview={overview} />
      <AiValueBill overview={overview} />
      <WorkbenchCenter
        title="增长控制台"
        subtitle="今天的获客进展和漏斗，一目了然"
        icon={ChartNoAxesCombined}
        stats={[
          {
            label: "今日新线索",
            value: loading ? "-" : overview?.todayLeadCount ?? 0,
            tone: "default",
          },
          {
            label: "今日已触达",
            value: loading ? "-" : overview?.todayContactedCount ?? 0,
            tone: "default",
          },
          {
            label: "今日进 CRM",
            value: loading ? "-" : overview?.todayCrmCapturedCount ?? 0,
            tone: "default",
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
          {
            key: "rpa-workbench",
            title: "RPA 工作台",
            description: "平台自动化执行与接管",
            icon: Bot,
            href: "/growth/rpa-workbench",
          },
        ]}
        advancedLinks={[
          { key: "console", title: "旧版控制台", icon: ChartNoAxesCombined, href: "/growth" },
        ]}
      />

      {/* 阻断任务（T05：/growth/home 的 blockers，空不渲染） */}
      <BlockersSection blockers={homeBlockers} />

      {/* 转化漏斗（T05：七段口径，null → 不可用） */}
      {sevenStages && (
        <section className="kaypal-v3-panel p-6">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            转化漏斗
          </h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            {sevenStages.map((stage, i) => (
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
                    style={{ opacity: 1 - i * 0.12 }}
                  >
                    <p className="text-xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                      {loading ? "-" : displayStat(stage.value, "不可用")}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      {stage.label}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--kaypal-v3-muted)]">
            成交率：
            {homeFunnel && homeFunnel.contacted && homeFunnel.contacted > 0 && homeFunnel.won !== null
              ? `${((homeFunnel.won / homeFunnel.contacted) * 100).toFixed(1)}%`
              : "暂无数据"}
          </p>
        </section>
      )}

      {/* 最近运行（T05：六态标签，失败不伪装成功） */}
      <RecentRunsSection runs={homeRuns} />

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
