"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { getApiBase } from "@/lib/api/client";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { useCountUp } from "@/lib/hooks/use-count-up";
import {
  growthApi,
  type GrowthAcquisitionRun,
  type GrowthHomeBlocker,
  type GrowthHomeFunnel,
  type GrowthHomeNextAction,
  type GrowthHomeResponse,
} from "@/lib/api/growth";
/* trend 类型从 GrowthReports.trend 提取（sparkline + 昨日差值用） */
import { toPublicError } from "@/lib/public-error";

/** 首页聚合接口轮询间隔：与 app-shell useBadges 的 30s 节奏对齐 */
const HOME_POLL_INTERVAL_MS = 30_000;
/** 今日增长首页曝光埋点事件名（PRD 10.3） */
const GROWTH_HOME_VIEWED_EVENT = "growth_home_viewed" as const;
/** 事件上报端点（与 lib/analytics/case-events.ts 的 /api/v1/events 对齐） */
const EVENTS_PATH = "/v1/events";

/** 七段漏斗定义（与 GrowthHomeFunnel 字段一一对应） */
const HOME_FUNNEL_STAGES: Array<{
  key: keyof GrowthHomeFunnel;
  label: string;
}> = [
  { key: "candidates", label: "候选人" },
  { key: "selected", label: "已筛选" },
  { key: "contacted", label: "已触达" },
  { key: "leads", label: "线索" },
  { key: "customers", label: "客户" },
  { key: "opportunities", label: "商机" },
  { key: "won", label: "赢单" },
];

/** 运行状态 → 标签/色调（复用 kx-t-* 既有色调，失败/跳过/部分独立展示，不伪装成功） */
const RUN_STATUS_META: Record<
  GrowthAcquisitionRun["status"],
  { label: string; className: string }
> = {
  queued: { label: "排队中", className: "kx-t-slate" },
  running: { label: "执行中", className: "kx-t-blue" },
  success: { label: "成功", className: "kx-t-green" },
  partial: { label: "部分成功", className: "kx-t-amber" },
  failed: { label: "失败", className: "kx-t-rose" },
  skipped: { label: "已跳过", className: "kx-t-slate" },
};

/**
 * 今日增长首页曝光埋点。
 *
 * 对齐现有轻量埋点封装（lib/analytics/case-events.ts 的 /api/v1/events fire-and-forget 模式）：
 * 不引第三方库、失败静默、绝不阻塞页面。
 *
 * TODO(后端事件白名单)：growth_home_viewed 需加入后端 events 白名单
 * （backend case-events.service.ts CASE_EVENT_NAMES）后才会被服务端记录；
 * 当前事件名不在白名单时服务端返回 400，前端 fire-and-forget 静默忽略，对页面无影响。
 */
function trackGrowthHomeViewed(range: string, blockerCount: number): void {
  if (typeof window === "undefined") return;
  try {
    void fetch(`${getApiBase()}${EVENTS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: GROWTH_HOME_VIEWED_EVENT,
        props: { range, blockerCount },
      }),
      keepalive: true,
    }).catch(() => {
      /* 埋点失败静默 */
    });
  } catch {
    /* 同步异常（序列化/超长等）不外抛 */
  }
}

/** 纯 SVG sparkline：不引第三方库，传入 number[] 渲染折线 */
function Sparkline({
  data,
  width = 64,
  height = 20,
  color = "var(--kaypal-v3-accent)",
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polygon points={areaPoints} fill={color} opacity={0.08} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 昨日差值：从 trend 数据提取昨日值，算 delta */
function computeDelta(
  todayValue: number | null,
  trend: Array<{ date: string; leads: number }> | null,
): { delta: number; direction: "up" | "down" | "flat" } | null {
  if (todayValue === null || !trend || trend.length < 2) return null;
  const yesterday = trend[trend.length - 2]?.leads ?? 0;
  const delta = todayValue - yesterday;
  if (delta === 0) return { delta: 0, direction: "flat" };
  return { delta, direction: delta > 0 ? "up" : "down" };
}

/** 数值展示：null/undefined → 空态文案（绝不显示 0）；0 → 真实 0 */
function displayStat(
  value: number | null | undefined,
  emptyText: string,
  formatter?: (value: number) => string,
): string {
  if (value === null || value === undefined) return emptyText;
  return formatter ? formatter(value) : value.toLocaleString("zh-CN");
}

/** 商机金额格式化：单位元，千分位 + 两位小数 */
function formatYuan(value: number): string {
  return `¥${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 数据时间展示：generatedAt ISO → 「08-20 14:30:00」 */
function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}


/** 统计数字 count-up 包装 */
function CountUpStat({ value, isEmpty }: { value: string; isEmpty: boolean }) {
  const num = isEmpty ? 0 : (parseInt(value, 10) || 0);
  const animated = useCountUp(num, { duration: 600, startDelay: 100 });
  if (isEmpty) return <>{value}</>;
  return <>{animated}</>;
}

/** 运行错误文案人性化：清洗 Playwright/技术栈原始错误，保留语义 */
function runMessageDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = commercialDisplayText(raw);
  if (/page\.screenshot.*Timeout\s*(\d+)\s*ms/i.test(text)) {
    return "页面截图超时，可能页面未完全加载或被平台拦截。";
  }
  if (/navigation.*Timeout\s*(\d+)\s*ms/i.test(text)) {
    return "页面加载超时，可能目标页面不可达或被拦截。";
  }
  if (/Timeout\s*(\d+)\s*ms/i.test(text)) {
    return "操作超时，可能页面未响应或网络不稳定。";
  }
  if (/waiting.*selector.*timed\s*out/i.test(text) || /element.*not.*found/i.test(text)) {
    return "页面结构可能发生变化，未找到目标元素。";
  }
  if (/net::ERR_|ECONNREFUSED|ENOTFOUND|fetch.*failed/i.test(text)) {
    return "网络连接异常，无法访问目标页面。";
  }
  return text;
}

/** 运行开始时间：仅显示时分 */
function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 统计卡片骨架（首屏加载） */
function StatCardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-5"
        >
          <div className="h-3 w-16 animate-pulse rounded bg-[var(--kaypal-v3-accent-soft)]" />
          <div className="mt-3 h-7 w-20 animate-pulse rounded bg-[var(--kaypal-v3-accent-soft)]" />
        </div>
      ))}
    </div>
  );
}

/** 整页错误态 + 重试（不白屏） */
function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-6 text-center">
      <AlertTriangle className="mx-auto h-6 w-6 text-[var(--kaypal-v3-danger)]" />
      <p className="mt-2 text-sm text-[var(--kaypal-v3-danger)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
      >
        <RefreshCw className="h-4 w-4" />
        重试
      </button>
    </div>
  );
}

/** 顶部：标题 + 数据时间 + 刷新 + 主 CTA + 5 张统计卡（null≠0） */
function HomeHeader({
  home,
  loading,
  error,
  trend,
  onRefresh,
  onCreateTask,
}: {
  home: GrowthHomeResponse | null;
  loading: boolean;
  error: string | null;
  trend: Array<{ date: string; leads: number }> | null;
  onRefresh: () => void;
  onCreateTask: () => void;
}) {
  const stats: Array<{
    label: string;
    value: string;
    emptyText: string;
  }> = [
    {
      label: "今日新线索",
      value: displayStat(home?.stats.newLeads, "暂无数据"),
      emptyText: "暂无数据",
    },
    {
      label: "高意向线索",
      value: displayStat(home?.stats.highIntentLeads, "暂不可用"),
      emptyText: "暂不可用",
    },
    {
      label: "待触达",
      value: displayStat(home?.stats.pendingContact, "暂不可用"),
      emptyText: "暂不可用",
    },
    {
      label: "今日进 CRM",
      value: displayStat(home?.stats.crmCaptured, "暂无数据"),
      emptyText: "暂无数据",
    },
    {
      label: "商机金额",
      value: displayStat(
        home?.stats.openOpportunityAmount,
        "暂无商机金额",
        formatYuan,
      ),
      emptyText: "暂无商机金额",
    },
  ];

  return (
    <div className="kx-page-head">
      <div className="flex flex-wrap items-center justify-between gap-3 w-full">
        <div>
          <div>
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              今日增长
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {home
                ? `数据更新于 ${formatGeneratedAt(home.generatedAt)} · 30 秒自动刷新`
                : "AI 获客进展与漏斗，30 秒自动刷新"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
          <button
            type="button"
            onClick={onCreateTask}
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
          >
            新建获客任务
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 刷新失败但已有旧数据：保留旧数据，仅提示 */}
      {error && home ? (
        <p className="mt-3 text-xs text-[var(--kaypal-v3-danger)]">
          刷新失败：{error}（当前展示上次数据）
        </p>
      ) : null}

      {!home && loading ? (
        <div className="mt-6">
          <StatCardSkeleton />
        </div>
      ) : !home && error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={onRefresh} />
        </div>
      ) : home ? (
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          {stats.map((stat, index) => {
            const isEmpty = stat.value === stat.emptyText;
            return (
              <div
                key={stat.label}
                className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-5"
              >
                <p className="text-sm text-[var(--kaypal-v3-muted)]">
                  {stat.label}
                </p>
                {isEmpty ? (
                  /* 空态文案不占用数字层级：小号灰字，避免文字冒充数字 */
                  <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                    {stat.value}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <p
                        className="text-[var(--kaypal-v3-font-display,32px)] font-semibold leading-9 tracking-tight text-[var(--kaypal-v3-ink)]"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                        title={stat.value}
                      >
                        <CountUpStat value={stat.value} isEmpty={isEmpty} />
                      </p>
                      {/* sparkline：仅今日新线索卡显示（有 trend 数据时） */}
                      {index === 0 && trend && trend.length >= 2 ? (
                        <Sparkline data={trend.map((t) => t.leads)} />
                      ) : null}
                    </div>
                    {/* 昨日差值：仅今日新线索卡显示 */}
                    {index === 0 ? (() => {
                      const d = computeDelta(home?.stats.newLeads ?? null, trend);
                      if (!d) return null;
                      const color = d.direction === "up" ? "var(--kaypal-v3-success)" : d.direction === "down" ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-muted)";
                      const arrow = d.direction === "up" ? "↑" : d.direction === "down" ? "↓" : "→";
                      return (
                        <p className="mt-0.5 text-xs" style={{ color }}>
                          {arrow} {Math.abs(d.delta).toLocaleString("zh-CN")} 较昨日
                        </p>
                      );
                    })() : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 风险阻断卡（blockers 为空不渲染） */
function BlockerCards({ blockers }: { blockers: GrowthHomeBlocker[] }) {
  if (blockers.length === 0) return null;
  const blockerLinks: Record<string, { href: string; label: string }> = {
    "no-ready-auto-task": {
      href: "/growth/acquisition",
      label: "查看获客任务",
    },
    "no-online-normal-account": {
      href: "/growth/account-health",
      label: "检查账号健康",
    },
    "scheduler-daemon-not-armed": {
      href: "/schedules",
      label: "查看后台调度",
    },
  };
  return (
    <section
      className="rounded-[var(--kaypal-v3-radius)] p-4"
      style={{
        background: "var(--kaypal-v3-danger-soft)",
        borderLeft: "3px solid var(--kaypal-v3-danger)",
      }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-[var(--kaypal-v3-danger)]" />
        <h2 className="text-sm font-bold text-[var(--kaypal-v3-danger)]">
          需要处理的风险
        </h2>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {blockers.map((blocker) => (
          <div
            key={blocker.code}
            className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                {blocker.title}
              </p>
            </div>
            {blocker.detail ? (
              <p className="mt-1 text-xs leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {blocker.detail}
              </p>
            ) : null}
            {blocker.action ? (
              <p className="mt-1 text-xs leading-5 text-[var(--kaypal-v3-muted)]">
                {blocker.action}
              </p>
            ) : null}
            {blockerLinks[blocker.code] ? (
              <Link
                href={blockerLinks[blocker.code].href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] hover:underline"
              >
                {blockerLinks[blocker.code].label}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * 七段漏斗：竖向比例条形 + 阶段间转化率。
 * 全部为 0 或不可用（null）时折叠为设计过的空态，不展示一排 0。
 */
function FunnelSection({
  funnel,
  loading,
}: {
  funnel: GrowthHomeFunnel | null;
  loading: boolean;
}) {
  // 收集每段值，null 视为 0 用于宽度计算
  const stages = HOME_FUNNEL_STAGES.map((s) => {
    const raw = funnel ? funnel[s.key] : null;
    return { ...s, value: raw, numeric: raw ?? 0 };
  });
  const maxValue = Math.max(...stages.map((s) => s.numeric), 1);
  // 全零（所有段都是 0 或 null）→ 折叠为空态
  const allZero = stages.every((s) => s.numeric === 0);
  // 任意一段 null → 标记部分不可用
  const hasNull = stages.some((s) => s.value === null);

  if (loading && !funnel) {
    return (
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            转化漏斗
          </h2>
        </div>
        <div className="mt-4 space-y-3">
          {HOME_FUNNEL_STAGES.map((s) => (
            <div key={s.key} className="h-10 animate-pulse rounded bg-[var(--kaypal-v3-accent-soft)]" />
          ))}
        </div>
      </section>
    );
  }

  if (allZero) {
    return (
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            转化漏斗
          </h2>
        </div>
        <div className="mt-4 flex flex-col items-center gap-2 py-8 text-center">
          <Inbox className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            今日暂无转化数据
          </p>
          <p className="text-xs text-[var(--kaypal-v3-muted)]">
            运行获客任务后，漏斗各阶段将自动填充
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="kaypal-v3-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
          转化漏斗
        </h2>
        <span className="text-xs text-[var(--kaypal-v3-muted)]">
          候选人 → 赢单{hasNull ? " · 部分不可用" : ""}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {stages.map((stage, index) => {
          const widthPct = Math.max((stage.numeric / maxValue) * 100, 8);
          const prevValue = index > 0 ? stages[index - 1].numeric : 0;
          const convRate =
            index > 0 && prevValue > 0
              ? ((stage.numeric / prevValue) * 100).toFixed(0)
              : null;
          return (
            <div key={stage.key} className="flex items-center gap-3">
              {/* 标签列 */}
              <div className="w-16 shrink-0 text-right">
                <p className="text-xs font-medium text-[var(--kaypal-v3-soft-ink)]">
                  {stage.label}
                </p>
              </div>
              {/* 条形 */}
              <div className="relative h-9 flex-1 overflow-hidden rounded-[var(--kaypal-v3-radius-xs)] bg-[var(--kaypal-v3-paper-soft)]">
                <div
                  className="flex h-full items-center rounded-[var(--kaypal-v3-radius-xs)] bg-[var(--kaypal-v3-accent)] transition-all"
                  style={{ width: `${widthPct}%`, opacity: Math.max(1 - index * 0.1, 0.35) }}
                >
                  <span className="ml-3 text-sm font-semibold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {stage.value === null
                      ? "—"
                      : stage.numeric.toLocaleString("zh-CN")}
                  </span>
                </div>
              </div>
              {/* 转化率 */}
              <div className="w-14 shrink-0 text-left">
                {convRate ? (
                  <span className="ml-auto text-xs text-[var(--kaypal-v3-muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {convRate}%
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 最近运行（简化列表，空 → 「暂无运行记录」） */
function RecentRunsSection({
  runs,
  loading,
}: {
  runs: GrowthAcquisitionRun[] | null;
  loading: boolean;
}) {
  return (
    <section className="kaypal-v3-panel p-6">
      <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
        最近运行
      </h2>
      {loading ? (
        <div className="mt-3 space-y-2">
        <div className="kx-skeleton h-10 w-full" />
        <div className="kx-skeleton h-10 w-full" />
        <div className="kx-skeleton h-10 w-full" />
      </div>
      ) : !runs || runs.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
          <Inbox className="h-4 w-4" />
          暂无运行记录
        </div>
      ) : (
        <ul className="kx-run-list mt-3 divide-y divide-[var(--kaypal-v3-border)]">
          {runs.slice(0, 8).map((run) => {
            const meta = RUN_STATUS_META[run.status] ?? {
              label: run.status,
              className: "kx-t-slate",
            };
            const time = run.startedAt ? formatRunTime(run.startedAt) : "";
            return (
              <li
                key={run.id}
                className="flex items-center gap-x-3 py-3" style={{ minHeight: "48px" }}
              >
                <span className={`kx-tag ${meta.className}`}>{meta.label}</span>
                <span
                  className="min-w-0 flex-1 truncate text-sm text-[var(--kaypal-v3-soft-ink)]"
                  title={runMessageDisplay(run.message)}
                >
                  {runMessageDisplay(run.message)}
                </span>
                {(() => {
                  const c = run.candidateCount ?? 0;
                  const s = run.selectedCount ?? 0;
                  const t = run.contactedCount ?? 0;
                  const cr = run.crmCapturedCount ?? 0;
                  if (c === 0 && s === 0 && t === 0 && cr === 0) {
                    return <span className="ml-auto text-xs text-[var(--kaypal-v3-muted)]">暂无数据</span>;
                  }
                  return (
                    <span className="text-xs text-[var(--kaypal-v3-muted)]" style={{ fontVariantNumeric: "tabular-nums" }}>
                      候选 {c} · 筛选 {s} · 触达 {t} · CRM {cr}
                    </span>
                  );
                })()}
                {time ? (
                  <span className="text-xs text-[var(--kaypal-v3-muted)]">
                    {time}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 下一步建议（来自后端 nextActions，渲染为按钮/链接） */
function NextActionsSection({
  actions,
}: {
  actions: GrowthHomeNextAction[] | null;
}) {
  if (!actions || actions.length === 0) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
          下一步建议
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((action) => (
          <Link
            key={action.code}
            href={action.href}
            className="kaypal-v3-panel group flex items-center justify-between gap-3 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
          >
            <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
              {action.label}
            </span>
            <ArrowRight className="h-4 w-4 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * 今日增长视图（T04）：读取 GET /growth/home，展示 stats / funnel / blockers /
 * recentRuns / nextActions；主 CTA 新建获客任务 → /auto-acquisition/create；
 * 30s 轮询刷新；null≠0、失败不伪装成功。
 */
export function TodayCenter() {
  const router = useRouter();
  const [home, setHome] = useState<GrowthHomeResponse | null>(null);
  const [trend, setTrend] = useState<Array<{ date: string; leads: number }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewedRef = useRef(false);

  const loadHome = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await growthApi.getGrowthHome("today");
      setHome(data);
      setError(null);
      // 并行加载 7 日趋势（失败不阻塞首页）
      if (!silent) {
        try {
          const reports = await growthApi.reports({});
          setTrend(reports.trend?.slice(-7) ?? []);
        } catch {
          setTrend(null);
        }
      }
    } catch (loadError: unknown) {
      setError(toPublicError(loadError, "今日增长数据加载失败，请稍后重试。"));
    } finally {
      setLoading(false);
    }
  }, []);

  // 首屏加载 + 30s 轮询（对齐 app-shell useBadges 节奏）
  useEffect(() => {
    void loadHome();
    const timer = window.setInterval(() => void loadHome(true), HOME_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadHome]);

  // 曝光埋点：仅首次拿到数据时上报一次
  useEffect(() => {
    if (viewedRef.current || !home) return;
    viewedRef.current = true;
    trackGrowthHomeViewed("today", home.blockers.length);
  }, [home]);

  const handleCreateTask = useCallback(() => {
    void router.push("/auto-acquisition/create");
  }, [router]);

  return (
    <div className="kx-view flex flex-col gap-6">
      <HomeHeader
        home={home}
        loading={loading}
        error={error}
        trend={trend}
        onRefresh={() => void loadHome()}
        onCreateTask={handleCreateTask}
      />
      {home ? (
        <>
          <BlockerCards blockers={home.blockers} />
          <FunnelSection funnel={home.funnel} loading={loading && !home} />
          <RecentRunsSection runs={home.recentRuns} loading={loading && !home} />
          <NextActionsSection actions={home.nextActions} />
        </>
      ) : null}
    </div>
  );
}
