"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  ClipboardList,
  Inbox,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Wallet,
} from "@/components/iconpark";
import { getApiBase } from "@/lib/api/client";
import { BrandIcon, type BrandIconName } from "@/components/shell/brand-icons";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { useCountUp } from "@/lib/hooks/use-count-up";
import {
  growthApi,
  type GrowthAcquisitionRun,
  type GrowthHomeBlocker,
  type GrowthHomeTrends,
  type GrowthHomeTrendSeries,
  type GrowthHomeFunnel,
  type GrowthHomeResponse,
  type GrowthOverview,
} from "@/lib/api/growth";
/* trend 类型从 GrowthReports.trend 提取（sparkline + 昨日差值用） */
import { toPublicError } from "@/lib/public-error";
import { runFailureHint, runFailureLabel } from "@/lib/growth-failure";
import { toast } from "@/lib/toast";

/**
 * 今日增长首页 · 版式规范（2026-09-03 体检定稿，改动前先读这里）
 *
 * 页面区块动线（2026-09-03 操作前置定稿，勿乱序）：
 *   页头(标题+统计) → 需要关注(风险) → 增长功能(操作区) →
 *   趋势图(自页头区移下让位) → AI 简报 → 转化漏斗 →
 *   AI 价值账单 → 最近运行(日志收尾)
 *
 * 间距（全为 4 的倍数，与 .kx-view 的 gap-6 体系同节奏）：
 * - 区块之间（含统计卡区与各面板、页头之间）：24 —— .kx-view flex gap-6
 * - 区块「标题行 → 内容」首间距：16 —— 统一用 mt-4 / mb-4，勿用 mt-3
 * - 横向大网格（统计卡 / 价值账单格 / 增长功能入口）间距：16 —— grid gap-4，勿用 gap-3
 * - 大面板与内容横幅卡内边距：24 —— kaypal-v3-panel p-6（含 AI 简报 / AI 价值账单 / 增长功能）
 * - 警报区（需要关注/风险，左侧 3px 色条）：16 —— p-4（警示块刻意紧凑）
 * - 统计卡内边距：20 —— p-5（卡内标签→数字 8 = mt-2）
 * 统计卡(页头读数) vs 增长功能卡(操作入口) 分层(2026-09-03)：
 *   统计卡 = paper-soft 浅底 + 无边框 + 无 hover —— 只读数、不可点；
 *   增长功能卡 = paper 白底 + accent 描边 + 渐变图标 + hover 上浮 —— 可点入口。
 *   勿给统计卡加回 border/纯白底，避免与下方 7 张功能卡同视觉、误导用户点击。
 * - 功能入口主卡内边距：20 —— p-5（44px 色块大图标 + 标题 15 + 描述 14；hover 图标块反色）
 * - 账单指标格内边距：12 —— p-3（末级小格保持紧凑）
 *
 * 字号谱（computed 实测校验，勿私自改）：
 * - 徽章/角标：10（kx-tag、「紧急/待办」标签）
 * - 元信息/辅助：12（页头副行、图例按钮、漏斗阶段名、最近运行时间/统计列）
 * - 正文/卡标签/按钮文字：14
 * - 页标题 H1：28 —— kx-greet
 * - 区块标题 H2：15 —— 数据区块标题一律在卡片内（text-base，实际 15px 由
 *   .kx-view h2 全局决定）；仅「增长功能」区块标题外置 28px（内联 SECTION_TITLE_TEXT）
 * - 关键数字：32 —— 用内联 fontSize: "var(--kaypal-v3-font-display, 32px)"；
 *   不要写 text-[var(--kaypal-v3-font-display,32px)] 类——arbitrary 值带
 *   fallback 逗号时 Tailwind 3 提取失败、类不会被生成（曾致数字缩回 16px）
 */
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

/**
 * 新失败「系统举手」：首批数据静默播种去重集合，后续轮询只弹新增失败，
 * 同一次失败跨会话不重复打扰（自 /growth 迁移，节拍并入 30s 自动刷新）。
 */
function announceNewFailedRuns(
  runs: GrowthAcquisitionRun[],
  seenRef: { seeded: boolean; ids: Set<string> } | null,
): void {
  if (!seenRef) return;
  const failed = (runs ?? []).filter((run) => run.status === "failed");
  if (!seenRef.seeded) {
    for (const run of failed) seenRef.ids.add(run.id);
    seenRef.seeded = true;
  } else {
    for (const run of failed) {
      if (seenRef.ids.has(run.id)) continue;
      seenRef.ids.add(run.id);
      toast.error(`获客任务失败：${runFailureHint(run) ?? "原因待查明"}`, {
        duration: 8000,
      });
    }
  }
  try {
    sessionStorage.setItem(
      "growth-failure-toast-announced",
      JSON.stringify([...seenRef.ids]),
    );
  } catch {
    /* sessionStorage 满/隐私模式 → 去重退化为内存级，可接受 */
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

/** 昨日差值：比较序列最后两天（今日 vs 昨日），与卡片数值同口径 */
function seriesDelta(
  series: number[] | null,
): { delta: number; direction: "up" | "down" | "flat" } | null {
  if (!series || series.length < 2) return null;
  const current = series[series.length - 1] ?? 0;
  const yesterday = series[series.length - 2] ?? 0;
  const delta = current - yesterday;
  if (delta === 0) return { delta: 0, direction: "flat" };
  return { delta, direction: delta > 0 ? "up" : "down" };
}

/** 从后端趋势序列提取数值数组（不足 2 天或无数据 → null，不画 sparkline） */
function seriesValues(
  series: GrowthHomeTrendSeries[] | undefined | null,
): number[] | null {
  if (!series || series.length < 2) return null;
  return series.map((s) => s.value);
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

/** 今日日期锚点：如「9月3日 · 周四」 */
function formatTodayAnchor(): string {
  const now = new Date();
  const monthDay = now.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
  const weekday = now.toLocaleDateString("zh-CN", { weekday: "short" });
  return `${monthDay} · ${weekday}`;
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

/** 运行开始时间：今天仅显示时分，非今天带「M/d HH:mm」，避免跨天时间歧义 */
function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const hm = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return hm;
  const md = date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
  return `${md} ${hm}`;
}

/** 统计卡片骨架（首屏加载）——与统计卡同为无边框 paper-soft 读数牌样式 */
function StatCardSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper-soft)] p-5"
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
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-4 text-sm font-semibold text-white transition hover:brightness-105"
      >
        <RefreshCw className="h-4 w-4" />
        重试
      </button>
    </div>
  );
}

/** 摘要行：把核心指标串成一句可扫读的话（克制、不加未核实数据） */
function HomeSummary({ home }: { home: GrowthHomeResponse }) {
  const parts: string[] = [];
  const { stats, blockers, funnel } = home;
  if (stats.newLeads !== null && stats.newLeads !== undefined) {
    parts.push(`今日新增线索 ${stats.newLeads}`);
  }
  if (
    stats.pendingContact !== null &&
    stats.pendingContact !== undefined &&
    stats.pendingContact > 0
  ) {
    parts.push(`${stats.pendingContact} 条待处理`);
  }
  if (
    stats.crmCaptured !== null &&
    stats.crmCaptured !== undefined &&
    stats.crmCaptured > 0
  ) {
    parts.push(`今日沉淀 CRM ${stats.crmCaptured}`);
  }
  const won = funnel.won;
  if (won !== null && won !== undefined && won > 0) {
    parts.push(`赢单 ${won}`);
  }
  if (blockers.length > 0) {
    parts.push(`${blockers.length} 项需要关注`);
  }
  if (!parts.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-[var(--kaypal-v3-muted)]">
      {parts.map((part, i) => (
        <span key={part} className="inline-flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          <span
            className={
              part.endsWith("项需要关注")
                ? "font-semibold text-[var(--kaypal-v3-danger)]"
                : ""
            }
          >
            {part}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ==================== 近 7 日趋势主图 ==================== */

/** 主图 SVG viewBox 坐标系（svg width 100% 等比缩放，移动端不挤压） */
const TREND_VB_W = 780;
const TREND_VB_H = 264;
const TREND_PLOT = { left: 40, right: 14, top: 16, bottom: 214 };

/** 主图三条日增量序列的展示定义（与 5 卡 sparkline 同源 home.trends） */
const TREND_SERIES_DEFS: Array<{
  key: keyof GrowthHomeTrends;
  label: string;
  color: string;
}> = [
  { key: "newLeads", label: "新线索", color: "var(--kaypal-v3-accent)" },
  { key: "highIntent", label: "高意向", color: "var(--kaypal-v3-amber)" },
  { key: "crmCaptured", label: "进 CRM", color: "var(--kaypal-v3-success)" },
];

/** 'YYYY-MM-DD' → 'M/D' */
function shortDay(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(date);
  if (!match) return date;
  return `${Number(match[1])}/${Number(match[2])}`;
}

/** 'YYYY-MM-DD' → '9月3日 · 周四'（用日期分量本地构造 Date，避免时区偏移） */
function chineseDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getDay();
  return `${Number(match[2])}月${Number(match[3])}日 · ${weekdays[weekday]}`;
}

/** Y 轴整数刻度：约每 1/4 区间一个刻度，末尾含真实最大值（全 0 → 仅基线） */
function yTicks(maxValue: number): number[] {
  if (maxValue <= 0) return [0];
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue; v += step) ticks.push(v);
  const last = ticks[ticks.length - 1];
  if (last < maxValue) ticks.push(maxValue);
  return ticks;
}

/**
 * 近 7 日趋势主图（整行大卡，位于 5 张统计卡之下）：
 * 三条日增量序列同坐标系对比，纯 SVG、无第三方依赖。
 * - 悬停：竖参考线 + 暗底浮层列出当日三值明细
 * - 图例：点击显隐序列，并直接展示每序列 7 日合计
 * - 全 0：只画基线 + 平线，不伪装有波动
 */
function MainTrendChart({
  trends,
}: {
  trends: GrowthHomeTrends | null | undefined;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<
    ReadonlySet<keyof GrowthHomeTrends>
  >(() => new Set());
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (!trends) return null;
  const dates = (trends.newLeads ?? []).map((point) => point.date);
  const count = dates.length;
  if (count < 2) return null;

  const toggleSeries = (key: keyof GrowthHomeTrends) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const plotW = TREND_VB_W - TREND_PLOT.left - TREND_PLOT.right;
  const plotH = TREND_PLOT.bottom - TREND_PLOT.top;
  const stepX = plotW / (count - 1);
  const xOf = (index: number) => TREND_PLOT.left + index * stepX;
  const allValues = TREND_SERIES_DEFS.filter((def) => !hiddenKeys.has(def.key))
    .flatMap((def) => (trends[def.key] ?? []).map((point) => point.value))
    .concat(0);
  const gridMax = Math.max(...allValues);
  const yOf = (value: number) =>
    gridMax > 0
      ? TREND_PLOT.bottom - (value / gridMax) * plotH
      : TREND_PLOT.bottom;
  const ticks = yTicks(gridMax);

  const handlePointerMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * TREND_VB_W;
    const rawIndex = Math.round((viewX - TREND_PLOT.left) / stepX);
    setHoverIndex(rawIndex >= 0 && rawIndex < count ? rawIndex : null);
  };
  const leaveChart = () => setHoverIndex(null);

  const hoverLeftPct =
    hoverIndex === null ? 0 : (xOf(hoverIndex) / TREND_VB_W) * 100;
  const tooltipLeft = Math.min(Math.max(hoverLeftPct, 6), 72);

  return (
    <section className="kaypal-v3-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            近 7 日趋势
          </h2>
          <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
            每日新增量同口径对比 · 悬停查看当日明细
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {TREND_SERIES_DEFS.map((def) => {
            const hidden = hiddenKeys.has(def.key);
            const total = (trends[def.key] ?? []).reduce(
              (sum, point) => sum + point.value,
              0,
            );
            return (
              <button
                key={def.key}
                type="button"
                aria-pressed={!hidden}
                title={hidden ? `显示「${def.label}」` : `隐藏「${def.label}」`}
                onClick={() => toggleSeries(def.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  hidden
                    ? "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)] opacity-60"
                    : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: hidden
                      ? "var(--kaypal-v3-muted)"
                      : def.color,
                  }}
                />
                {def.label}
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: hidden ? undefined : def.color }}
                >
                  {total}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mt-4">
      </div>

      <div className="relative mt-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${TREND_VB_W} ${TREND_VB_H}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label="近 7 日新线索、高意向线索与进 CRM 数量趋势图"
          onMouseMove={handlePointerMove}
          onMouseLeave={leaveChart}
        >
          {/* 横向网格 + Y 轴刻度 */}
          {ticks.map((value) => {
            const y = yOf(value);
            const isBaseline = value === 0;
            return (
              <g key={value}>
                <line
                  x1={TREND_PLOT.left}
                  x2={TREND_VB_W - TREND_PLOT.right}
                  y1={y}
                  y2={y}
                  stroke="var(--kaypal-v3-border)"
                  strokeWidth={1}
                  strokeDasharray={isBaseline ? undefined : "3 4"}
                  opacity={isBaseline ? 0.9 : 0.6}
                />
                <text
                  x={TREND_PLOT.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--kaypal-v3-muted)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {value}
                </text>
              </g>
            );
          })}
          {/* X 轴日期（末列 = 今日，强调色） */}
          {dates.map((date, index) => {
            const isLast = index === count - 1;
            return (
              <text
                key={date}
                x={xOf(index)}
                y={TREND_PLOT.bottom + 18}
                textAnchor="middle"
                fontSize={10}
                fill={
                  isLast
                    ? "var(--kaypal-v3-accent)"
                    : "var(--kaypal-v3-muted)"
                }
                style={isLast ? { fontWeight: 700 } : undefined}
              >
                {shortDay(date)}
                {isLast ? " 今日" : ""}
              </text>
            );
          })}
          {/* 序列折线（hidden 序列不参与绘制；今日端点 + hover 点带白描边突出） */}
          {TREND_SERIES_DEFS.filter((def) => !hiddenKeys.has(def.key)).map(
            (def) => {
              const values = trends[def.key] ?? [];
              const points = values
                .map(
                  (point, index) =>
                    `${xOf(index).toFixed(1)},${yOf(point.value).toFixed(1)}`,
                )
                .join(" ");
              const areaPoints = `${TREND_PLOT.left},${TREND_PLOT.bottom} ${points} ${xOf(
                count - 1,
              ).toFixed(1)},${TREND_PLOT.bottom}`;
              const todayValue = values[count - 1]?.value;
              return (
                <g key={def.key}>
                  <polygon
                    points={areaPoints}
                    fill={def.color}
                    opacity={0.07}
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke={def.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {todayValue !== undefined ? (
                    <circle
                      cx={xOf(count - 1)}
                      cy={yOf(todayValue)}
                      r={3.5}
                      fill={def.color}
                      stroke="var(--kaypal-v3-paper)"
                      strokeWidth={1.5}
                    />
                  ) : null}
                  {hoverIndex !== null ? (
                    <circle
                      cx={xOf(hoverIndex)}
                      cy={yOf(values[hoverIndex]?.value ?? 0)}
                      r={3}
                      fill={def.color}
                      stroke="var(--kaypal-v3-paper)"
                      strokeWidth={1.5}
                    />
                  ) : null}
                </g>
              );
            },
          )}
          {/* hover 竖参考线 */}
          {hoverIndex !== null ? (
            <line
              x1={xOf(hoverIndex)}
              x2={xOf(hoverIndex)}
              y1={TREND_PLOT.top}
              y2={TREND_PLOT.bottom}
              stroke="var(--kaypal-v3-muted)"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.7}
            />
          ) : null}
        </svg>

        {/* hover 明细浮层 */}
        {hoverIndex !== null ? (
          <div
            className="pointer-events-none absolute top-1.5 z-10 min-w-[152px] rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] px-3 py-2 text-xs shadow-lg"
            style={{ left: `${tooltipLeft}%`, background: "var(--kaypal-v3-paper)" }}
          >
            <p className="font-semibold text-[var(--kaypal-v3-ink)]">
              {chineseDay(dates[hoverIndex])}
            </p>
            <div className="mt-1.5 space-y-1">
              {TREND_SERIES_DEFS.map((def) => {
                const hidden = hiddenKeys.has(def.key);
                const value = trends[def.key]?.[hoverIndex]?.value;
                return (
                  <div
                    key={def.key}
                    className="flex items-center justify-between gap-4"
                  >
                    <span
                      className="inline-flex items-center gap-1.5 text-[var(--kaypal-v3-soft-ink)]"
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background: hidden
                            ? "var(--kaypal-v3-muted)"
                            : def.color,
                        }}
                      />
                      {def.label}
                    </span>
                    <span className="font-semibold tabular-nums text-[var(--kaypal-v3-ink)]">
                      {hidden ? "—" : (value ?? 0).toLocaleString("zh-CN")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const HOME_POLL_SECONDS = 30;

/**
 * 区块大标题规格（2026-09-03 撤销全区块外置后仅「增长功能」区块使用）：
 * 28px / 600 / -0.3px，与顶部「今日增长」页头同级；其余数据区块标题在卡片内
 * （text-base，实际 15px 由 .kx-view h2 决定）。
 * 尺寸必须内联 style（.kx-view h2 全局 15px 会压过工具类）。
 */
const SECTION_TITLE_TEXT = {
  fontSize: 28,
  fontWeight: 600,
  lineHeight: "34px",
  letterSpacing: "-0.3px",
} as const;

/** 顶部：标题 + 数据时间 + 刷新 + 主 CTA + 5 张统计卡（null≠0） */
function HomeHeader({
  home,
  loading,
  error,
  onRefresh,
  onAutoRefresh,
  onCreateTask,
}: {
  home: GrowthHomeResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAutoRefresh: () => void;
  onCreateTask: () => void;
}) {
  // 倒计时反馈：每秒递减，到 0 触发静默刷新并重置（让用户感知自动刷新在“活”）
  const [countdown, setCountdown] = useState(HOME_POLL_SECONDS);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          onAutoRefresh();
          return HOME_POLL_SECONDS;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onAutoRefresh]);
  const handleManualRefresh = () => {
    setCountdown(HOME_POLL_SECONDS);
    onRefresh();
  };
  const stats: Array<{
    key: string;
    label: string;
    value: string;
    emptyText: string;
    /** 对应 home.trends 序列键（存量型指标无日序列则不设） */
    seriesKey?: "newLeads" | "highIntent" | "crmCaptured";
    /** 是否显示「较昨日」环比（要求序列今日值与卡片数值同口径） */
    deltaEnabled?: boolean;
  }> = [
    {
      key: "new-leads",
      label: "今日新线索",
      value: displayStat(home?.stats.newLeads, "暂无数据"),
      emptyText: "暂无数据",
      seriesKey: "newLeads",
      deltaEnabled: true,
    },
    {
      key: "high-intent",
      label: "高意向线索",
      value: displayStat(home?.stats.highIntentLeads, "暂不可用"),
      emptyText: "暂不可用",
      // 卡片为存量值，序列为日增量：只画趋势，不画环比避免误导
      seriesKey: "highIntent",
    },
    {
      key: "pending-contact",
      label: "待触达",
      value: displayStat(home?.stats.pendingContact, "暂不可用"),
      emptyText: "暂不可用",
    },
    {
      key: "crm-captured",
      label: "今日进 CRM",
      value: displayStat(home?.stats.crmCaptured, "暂无数据"),
      emptyText: "暂无数据",
      seriesKey: "crmCaptured",
      deltaEnabled: true,
    },
    {
      key: "opportunity-amount",
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
              <span className="ml-2 align-middle text-sm font-normal text-[var(--kaypal-v3-muted)]">
                {formatTodayAnchor()}
              </span>
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {home
                ? `数据更新于 ${formatGeneratedAt(home.generatedAt)} · ${countdown} 秒后自动刷新`
                : `AI 获客进展与漏斗，每 ${HOME_POLL_SECONDS} 秒自动刷新`}
            </p>
            {home ? <HomeSummary home={home} /> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {loading ? "刷新中" : "刷新"}
          </button>
          <button
            type="button"
            onClick={onCreateTask}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] bg-[image:var(--kaypal-v3-gradient-primary)] px-6 text-[15px] font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.97]"
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
        <div className="mt-6 grid w-full grid-cols-2 gap-4 lg:grid-cols-5">
          {stats.map((stat) => {
            const isEmpty = stat.value === stat.emptyText;
            // 每张卡的 7 日趋势：有序列才画 sparkline，同口径才画环比
            const seriesRaw = stat.seriesKey
              ? home?.trends?.[stat.seriesKey]
              : undefined;
            const series = seriesValues(seriesRaw);
            const delta = stat.deltaEnabled ? seriesDelta(series) : null;
            return (
              <div
                key={stat.key}
                className="rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper-soft)] p-5"
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
                        className="font-semibold leading-9 tracking-tight text-[var(--kaypal-v3-ink)]"
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "var(--kaypal-v3-font-display, 32px)",
                        }}
                        title={stat.value}
                      >
                        <CountUpStat value={stat.value} isEmpty={isEmpty} />
                      </p>
                      {/* sparkline：凡有 7 日序列的指标卡都显示 */}
                      {series ? <Sparkline data={series} /> : null}
                    </div>
                    {/* 昨日差值：仅序列与卡片数值同口径的指标显示 */}
                    {delta ? (
                      <p
                        className="mt-0.5 text-xs"
                        style={{
                          color:
                            delta.direction === "up"
                              ? "var(--kaypal-v3-success)"
                              : delta.direction === "down"
                                ? "var(--kaypal-v3-danger)"
                                : "var(--kaypal-v3-muted)",
                        }}
                      >
                        {delta.direction === "up"
                          ? "↑"
                          : delta.direction === "down"
                            ? "↓"
                            : "→"}{" "}
                        {Math.abs(delta.delta).toLocaleString("zh-CN")} 较昨日
                      </p>
                    ) : null}
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

/** 阻断分级：账号/登录/健康类 = 紧急（红）；配置/调度/开关类 = 待办（琥珀），
 *  避免第一屏整块红制造焦虑 */
const DANGER_BLOCKER_CODES = new Set([
  "no-online-normal-account",
  "account-health-risk",
  "account-risk",
  "account-cooldown",
]);

/** 风险阻断卡（blockers 为空不渲染） */
function BlockerCards({ blockers }: { blockers: GrowthHomeBlocker[] }) {
  if (blockers.length === 0) return null;
  const hasDanger = blockers.some((b) => DANGER_BLOCKER_CODES.has(b.code));
  const iconColor = hasDanger ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-amber)";
  const sectionBg = hasDanger ? "var(--kaypal-v3-danger-soft)" : "var(--kaypal-v3-amber-soft)";
  const borderColor = hasDanger ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-amber)";
  const titleColor = hasDanger ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-amber)";
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
        background: sectionBg,
        borderLeft: `3px solid ${borderColor}`,
      }}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" style={{ color: iconColor }} />
        <h2 className="text-base font-bold" style={{ color: titleColor }}>
          {hasDanger ? "需要处理的风险" : "需要关注的事项"}
        </h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {blockers.map((blocker) => (
          <div
            key={blocker.code}
            className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                {blocker.title}
                {DANGER_BLOCKER_CODES.has(blocker.code) ? (
                  <span
                    className="ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    style={{ background: "var(--kaypal-v3-danger)" }}
                  >
                    紧急
                  </span>
                ) : (
                  <span
                    className="ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                    style={{ background: "var(--kaypal-v3-amber)" }}
                  >
                    待办
                  </span>
                )}
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
 * 区块标题外置（28px，统一规格）。
 */
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
          <Link
            href="/growth/acquisition"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] hover:underline"
          >
            去查看获客任务
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
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
          const convText =
            convRate !== null && convRate !== undefined
              ? `${convRate}%`
              : "—";
          return (
            <div
              key={stage.key}
              className="flex items-center gap-3"
              title={`${stage.label}：${
                stage.value === null ? "暂不可用" : stage.numeric.toLocaleString("zh-CN")
              }${index > 0 ? ` · 较上阶段 ${convText}` : ""}`}
            >
              {/* 标签列 */}
              <div className="w-16 shrink-0 text-right">
                <p className="text-xs font-medium text-[var(--kaypal-v3-soft-ink)]">
                  {stage.label}
                </p>
              </div>
              {/* 条形：0 值/不可用不渲染填充条，只留空槽，避免「有一小段」的视觉误导 */}
              <div className="relative h-9 flex-1 overflow-hidden rounded-[var(--kaypal-v3-radius-xs)] bg-[var(--kaypal-v3-paper-soft)]">
                {stage.numeric > 0 ? (
                  <div
                    className="flex h-full items-center rounded-[var(--kaypal-v3-radius-xs)] bg-[var(--kaypal-v3-accent)] transition-all"
                    style={{ width: `${widthPct}%`, opacity: Math.max(1 - index * 0.1, 0.35) }}
                  >
                    <span
                      className="ml-3 truncate text-sm font-semibold text-white"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {stage.value === null
                        ? "—"
                        : stage.numeric.toLocaleString("zh-CN")}
                    </span>
                  </div>
                ) : (
                  <span className="flex h-full items-center px-3 text-sm text-[var(--kaypal-v3-muted)]">
                    {stage.value === null ? "—" : "0"}
                  </span>
                )}
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
      <p className="mt-3 text-xs text-[var(--kaypal-v3-muted)]">
        成交率：
        {funnel && funnel.contacted && funnel.contacted > 0 && funnel.won !== null
          ? `${((funnel.won / funnel.contacted) * 100).toFixed(1)}%`
          : "暂无数据"}
      </p>
    </section>
  );
}
/** 相邻同因失败/跳过折叠为一行（含次数），避免同一条报错刷屏 */
function collapseRuns(
  runs: GrowthAcquisitionRun[],
): Array<{ run: GrowthAcquisitionRun; count: number }> {
  const out: Array<{ run: GrowthAcquisitionRun; count: number }> = [];
  for (const run of runs) {
    const foldable = run.status === "failed" || run.status === "skipped";
    const key = `${run.status}|${runMessageDisplay(run.message)}|${run.failureReason ?? ""}`;
    if (!foldable) {
      out.push({ run, count: 1 });
      continue;
    }
    const last = out[out.length - 1];
    const lastKey =
      last && last.count > 0
        ? `${last.run.status}|${runMessageDisplay(last.run.message)}|${last.run.failureReason ?? ""}`
        : "";
    if (last && lastKey === key) {
      last.count += 1;
    } else {
      out.push({ run, count: 1 });
    }
  }
  return out;
}

/** 最近运行（简化列表，空 → 「暂无运行记录」）；标题外置 28px；整行可点跳对应任务执行记录 */
/** 最近运行（简化列表，空 → 「暂无运行记录」）；整行可点跳对应任务执行记录 */
function RecentRunsSection({
  runs,
  loading,
  onOpenRun,
}: {
  runs: GrowthAcquisitionRun[] | null;
  loading: boolean;
  onOpenRun?: (run: GrowthAcquisitionRun) => void;
}) {
  return (
    <section className="kaypal-v3-panel p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
          最近运行
        </h2>
        <span className="text-xs text-[var(--kaypal-v3-muted)]">
          点击行查看任务执行记录
        </span>
      </div>
      {loading ? (
        <div className="mt-4 space-y-2">
        <div className="kx-skeleton h-10 w-full" />
        <div className="kx-skeleton h-10 w-full" />
        <div className="kx-skeleton h-10 w-full" />
      </div>
      ) : !runs || runs.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--kaypal-v3-muted)]">
          <Inbox className="h-4 w-4" />
          暂无运行记录
        </div>
      ) : (
        <ul className="kx-run-list mt-4 divide-y divide-[var(--kaypal-v3-border)]">
          {collapseRuns(runs.slice(0, 16)).slice(0, 10).map(({ run, count }) => {
            const meta = RUN_STATUS_META[run.status] ?? {
              label: run.status,
              className: "kx-t-slate",
            };
            const time = run.startedAt ? formatRunTime(run.startedAt) : "";
            const displayMsg = runMessageDisplay(run.message);
            return (
              <li
                key={run.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenRun?.(run)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenRun?.(run);
                  }
                }}
                className="flex cursor-pointer items-center gap-x-3 rounded-[var(--kaypal-v3-radius-xs)] py-3 transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                style={{ minHeight: "48px" }}
                title={`${meta.label}：${displayMsg}${count > 1 ? `（连续 ${count} 次）` : ""} · 点击查看任务执行记录`}
              >
                <span className={`kx-tag ${meta.className}`}>{meta.label}</span>
                {count > 1 ? (
                  <span className="kx-tag kx-t-slate" title={`连续 ${count} 次相同结果`}>
                    ×{count}
                  </span>
                ) : null}
                {runFailureLabel(run.failureReason) ? (
                  <span className="kx-tag kx-t-rose">{runFailureLabel(run.failureReason)}</span>
                ) : null}
                <span
                  className="min-w-0 flex-1 truncate text-sm text-[var(--kaypal-v3-soft-ink)]"
                  title={displayMsg}
                >
                  {displayMsg}
                </span>
                {(() => {
                  const c = run.candidateCount ?? 0;
                  const s = run.selectedCount ?? 0;
                  const t = run.contactedCount ?? 0;
                  const cr = run.crmCapturedCount ?? 0;
                  if (c === 0 && s === 0 && t === 0 && cr === 0) {
                    return <span className="ml-auto hidden shrink-0 text-xs text-[var(--kaypal-v3-muted)] sm:inline">暂无数据</span>;
                  }
                  return (
                    <span
                      className="ml-auto hidden shrink-0 text-xs text-[var(--kaypal-v3-muted)] sm:inline"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      候选 {c} · 筛选 {s} · 触达 {t} · CRM {cr}
                    </span>
                  );
                })()}
                {time ? (
                  <span className="shrink-0 text-xs text-[var(--kaypal-v3-muted)]">
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

/**
 * 今日 AI 简报卡（自 /growth 控制台并入 2026-09-03）：
 * 用一句人话讲清 AI 今天在做什么，数据源 growth overview。标题外置（28px）。
 */
/**
 * 今日 AI 简报卡（自 /growth 控制台并入 2026-09-03）：
 * 用一句人话讲清 AI 今天在做什么，数据源 growth overview。
 */
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
    sentences.push(`识别出 ${highIntent} 条高意向线索，建议今天优先跟进`);
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
      className="kaypal-v3-panel p-6"
      style={{ border: "1px solid var(--kaypal-v3-border)" }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
        <div className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
          今日 AI 简报
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-[var(--kaypal-v3-soft-ink)]">
        {summary}
      </p>
      {highIntent > 0 && (
        <p className="mt-2 text-xs text-[var(--kaypal-v3-accent)]">
          高意向线索的评分与理由见下方线索池，点击可查看 AI 判断依据。
        </p>
      )}
    </div>
  );
}
/** AI 价值账单（自 /growth 控制台并入）：把 AI 干的活折算成时间与钱。标题外置（28px）。估算口径页内注明。 */
/** AI 价值账单（自 /growth 控制台并入）：把 AI 干的活折算成时间与钱。估算口径页内注明。 */
function AiValueBill({ overview }: { overview: GrowthOverview | null }) {
  const funnel = overview?.funnel;
  if (!funnel) return null;

  const candidates = funnel.candidates ?? 0;
  const crmCaptured = funnel.crmCaptured ?? 0;
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
    <div className="kaypal-v3-panel p-6">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-[var(--kaypal-v3-accent)]" />
        <div className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
          AI 价值账单
        </div>
        <span className="rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
          估算
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
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
              <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                {item.hint}
              </p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--kaypal-v3-muted)]">
        * 估算口径：人工浏览 2 分钟/条、线索 ¥50/条、进 CRM ¥200/条，仅供参考，不代表实际成交。
      </p>
    </div>
  );
}
/** 增长功能入口矩阵（替代旧「下一步建议」，/growth 控制台入口并入后统一在此） */
function GrowthHubLinks({ overview }: { overview: GrowthOverview | null }) {
  const links: Array<{
    key: string;
    title: string;
    description: string;
    icon: typeof Target;
    brand?: BrandIconName;
    href: string;
    badge?: string;
    /** 主枢纽：与今日数据直接相关，渲染为更大一号的 hero 卡 */
    featured?: boolean;
  }> = [
    {
      key: "leads",
      brand: "leads",
      title: "线索池",
      description: "今天抓到的潜在客户，评分与 AI 判断依据都在这里",
      icon: UsersRound,
      href: "/growth/leads",
      featured: true,
      badge:
        (overview?.todayLeadCount ?? 0) > 0
          ? String(overview?.todayLeadCount)
          : undefined,
    },
    {
      key: "acquisition",
      brand: "acquisition",
      title: "获客任务",
      description: "创建与查看自动找客户的任务",
      icon: Target,
      href: "/growth/acquisition",
      featured: true,
    },
    {
      key: "strategies",
      brand: "strategies",
      title: "获客策略",
      description: "按行业的获客打法",
      icon: ClipboardList,
      href: "/growth/strategies",
    },
    {
      key: "workflows",
      brand: "workflows",
      title: "增长工作流",
      description: "多步骤自动化流程",
      icon: Route,
      href: "/growth/workflows",
    },
    {
      key: "account-health",
      brand: "accountHealth",
      title: "账号健康",
      description: "各平台账号登录与风控状态",
      icon: ShieldCheck,
      href: "/growth/account-health",
      featured: true,
      badge:
        (overview?.accountRiskCount ?? 0) > 0
          ? String(overview?.accountRiskCount)
          : undefined,
    },
    {
      key: "reports",
      brand: "reports",
      title: "增长复盘",
      description: "效果数据回顾",
      icon: TrendingUp,
      href: "/growth/reports",
    },
    {
      key: "rpa-workbench",
      brand: "rpa",
      title: "RPA 工作台",
      description: "平台自动化执行与接管",
      icon: Bot,
      href: "/growth/rpa-workbench",
    },
  ];
  const featured = links.filter((item) => item.featured);
  const standard = links.filter((item) => !item.featured);

  /**
   * 操作型图标：主色渐变实底 + 白图标（区别于数据卡浅紫块），
   * 尺寸必须内联 style（h-13/w-13 不在 Tailwind3 档位，类会失效坍缩）。
   */
  const renderActionIcon = (action: (typeof links)[number], size: number) => {
    if (action.brand) {
      return (
        <div
          className="flex shrink-0 items-center justify-center"
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <BrandIcon name={action.brand} size={size >= 52 ? 38 : 30} tone="gold" />
        </div>
      );
    }
    const ActionIcon = action.icon;
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius)] text-white shadow-sm transition group-hover:scale-105 group-hover:shadow-md"
        style={{ width: size, height: size, background: "var(--kaypal-v3-gradient-primary)" }}
        aria-hidden="true"
      >
        <ActionIcon className="h-5 w-5" strokeWidth={2} />
      </div>
    );
  };

  const renderBadge = (badge?: string) =>
    badge ? (
      <span className="shrink-0 rounded-full bg-[var(--kaypal-v3-danger)] px-1.5 py-px text-[10px] font-semibold leading-4 text-white">
        {badge}
      </span>
    ) : null;

  /** 操作区副文案：与数据卡 muted 形成明度分层 */
  const subText = (action: (typeof links)[number]) => (
    <span className="block truncate text-sm text-[var(--kaypal-v3-soft-ink)]/60">
      {action.description}
    </span>
  );

  /** 统一操作入口卡：白纸底 + 细主色描边（与纯白数据卡拉开靠渐变图标与描边色），hover 主色加强 */
  const actionCardClass =
    "group flex w-full items-center gap-3 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-accent-border)]/50 bg-[var(--kaypal-v3-paper)] p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-[0_4px_16px_-4px_var(--kaypal-v3-accent-tint,transparent)]";

  const arrowIcon = (cls: string) => (
    <ArrowRight
      className={`shrink-0 text-[var(--kaypal-v3-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--kaypal-v3-accent-ink)] ${cls}`}
    />
  );

  return (
    <section>
      {/* 标题组脱离卡片容器（不在任何卡框内）；字号与顶部「今日增长」页头同级（28px）。
          内联 style 覆盖 .kx-view h2 全局 15px——工具类会被该全局规则压过。 */}
      <div className="mb-5">
        <h2
          className="text-[var(--kaypal-v3-ink)]"
          style={{ fontSize: 28, fontWeight: 600, lineHeight: "34px", letterSpacing: "-0.3px" }}
        >
          增长功能
        </h2>
        <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
          去处理线索、任务与账号，点卡片直接进入
        </p>
      </div>

      {/* 主枢纽：3 大入口（今日数据相关），整列加粗标题 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((action) => (
          <Link
            key={action.key}
            href={action.href}
            className={`${actionCardClass} p-5`}
          >
            {renderActionIcon(action, 52)}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3
                  className="truncate font-bold text-[var(--kaypal-v3-ink)]"
                  style={{ fontSize: 15, lineHeight: "22px" }}
                >
                  {action.title}
                </h3>
                {renderBadge(action.badge)}
              </div>
              {subText(action)}
            </div>
            {arrowIcon("hidden lg:block")}
          </Link>
        ))}
      </div>

      {/* 其余功能入口：4 列 */}
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {standard.map((action) => (
          <Link key={action.key} href={action.href} className={actionCardClass}>
            {renderActionIcon(action, 44)}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="truncate text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  {action.title}
                </h3>
                {renderBadge(action.badge)}
              </div>
              {subText(action)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * 今日增长视图（T04）：读取 GET /growth/home + GET /growth/overview，展示 stats /
 * funnel / blockers / recentRuns（nextActions 仍为接口契约字段，页面以增长功能
 * 操作区替代其旧渲染）；主 CTA 新建获客任务 → /auto-acquisition/create；
 * 30s 轮询刷新；null≠0、失败不伪装成功。
 */
export function TodayCenter() {
  const router = useRouter();
  const [home, setHome] = useState<GrowthHomeResponse | null>(null);
  const [overview, setOverview] = useState<GrowthOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewedRef = useRef(false);
  const failureSeenRef = useRef<{
    seeded: boolean;
    ids: Set<string>;
  } | null>(null);

  // 挂载时恢复失败去重集合（跨会话不重复提示历史失败）
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const announced = JSON.parse(
        sessionStorage.getItem("growth-failure-toast-announced") ?? "[]",
      ) as string[];
      failureSeenRef.current = { seeded: false, ids: new Set(announced) };
    } catch {
      failureSeenRef.current = { seeded: false, ids: new Set<string>() };
    }
  }, []);

  const loadHome = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        // P0 复核修复：Promise.allSettled 独立处理两个接口——overview 失败不影响
        // home 主数据提交渲染；仅两个都失败才整页报错。任一失败静默保留上次成功数据。
        const [homeResult, overviewResult] = await Promise.allSettled([
          growthApi.getGrowthHome("today"),
          growthApi.overview(),
        ]);
        const homeData =
          homeResult.status === "fulfilled" ? homeResult.value : null;
        const overviewData =
          overviewResult.status === "fulfilled" ? overviewResult.value : null;
        if (homeData) {
          setHome(homeData);
          announceNewFailedRuns(homeData.recentRuns ?? [], failureSeenRef.current);
        }
        if (overviewData) setOverview(overviewData);
        if (!homeData && !overviewData) {
          const reason =
            homeResult.status === "rejected"
              ? homeResult.reason
              : overviewResult.status === "rejected"
                ? overviewResult.reason
                : new Error("加载失败");
          setError(toPublicError(reason, "今日增长数据加载失败，请稍后重试。"));
        } else {
          setError(null);
        }
      } catch (loadError: unknown) {
        // Promise.allSettled 自身几乎不 reject，此分支兜底同步异常
        setError(toPublicError(loadError, "今日增长数据加载失败，请稍后重试。"));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 首屏加载；30s 自动刷新由 HomeHeader 内倒计时驱动（onAutoRefresh），
  // 倒计时显示在页头，用户能感知“自动刷新”是活的。
  const handleAutoRefresh = useCallback(() => {
    void loadHome(true);
  }, [loadHome]);

  useEffect(() => {
    void loadHome();
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

  // 运行行点击：跳该任务（带 run 高亮由获客任务页自行接管，这里仅定位到任务）
  const handleOpenRun = useCallback(
    (run: GrowthAcquisitionRun) => {
      void router.push(
        run.configId
          ? `/growth/acquisition?config=${encodeURIComponent(run.configId)}`
          : "/growth/acquisition",
      );
    },
    [router],
  );

  return (
    <div className="kx-view flex flex-col gap-6">
      <HomeHeader
        home={home}
        loading={loading}
        error={error}
        onRefresh={() => void loadHome()}
        onAutoRefresh={handleAutoRefresh}
        onCreateTask={handleCreateTask}
      />
      {home ? (
        <>
          {/* 操作区最大化上提（2026-09-03）：页头(标题+统计) → 风险 → 增长功能 →
              趋势图(从页头区移下让位) → AI 简报 → 漏斗 → 价值账单 → 最近运行。
              增长功能是本页核心操作，紧随统计与告警之后，第二屏内即可触达。 */}
          <BlockerCards blockers={home.blockers} />
          <GrowthHubLinks overview={overview} />
          <MainTrendChart trends={home.trends} />
          {overview ? <AiDailyBriefCard overview={overview} /> : null}
          <FunnelSection funnel={home.funnel} loading={loading && !home} />
          {overview ? <AiValueBill overview={overview} /> : null}
          <RecentRunsSection
            runs={home.recentRuns}
            loading={loading && !home}
            onOpenRun={handleOpenRun}
          />
        </>
      ) : null}
    </div>
  );
}
