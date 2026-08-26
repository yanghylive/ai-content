"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BellRing,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TimerReset,
  type LucideIcon,
} from "lucide-react";
import {
  intelligenceApi,
  type CreateIntelligenceMonitorInput,
  type IntelligenceMonitorSummary,
  type QueryIntelligenceMonitorsInput,
} from "@/lib/api/intelligence";
import { ApiError } from "@/lib/api/client";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { publicIntelligenceText } from "./display-text";
import { IntelligenceToolResultContext } from "./intelligence-tool-result-context";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

type FilterState = {
  status: string;
  type: string;
  platform: string;
  keyword: string;
};

type MonitorFormState = {
  type: string;
  platform: string;
  keyword: string;
  accountExternalId: string;
  industry: string;
  schedule: string;
  skillInstallId: string;
};

type ActionLog = {
  id: string;
  title: string;
  detail: string;
  state: "running" | "done" | "failed";
};

const statusOptions = [
  { label: "全部", value: "all" },
  { label: "运行中", value: "active" },
  { label: "已暂停", value: "paused" },
  { label: "异常", value: "error" },
  { label: "已归档", value: "archived" },
];

const typeOptions = [
  { label: "关键词", value: "keyword" },
  { label: "账号", value: "account" },
  { label: "行业", value: "industry" },
  { label: "热点", value: "trend" },
  { label: "爆款", value: "viral" },
];

const platformOptions = [
  { label: "全平台", value: "all" },
  { label: "小红书", value: "小红书" },
  { label: "抖音", value: "抖音" },
  { label: "B站", value: "B站" },
  { label: "公众号", value: "公众号" },
];

function traceableMonitorError(reason: unknown) {
  const message = toActionableError(reason, "监控配置读取失败");
  return reason instanceof ApiError && reason.requestId
    ? `${message}（请求编号：${reason.requestId}）`
    : message;
}

const schedulePresets = [
  { label: "30 分钟", value: "*/30 * * * *" },
  { label: "2 小时", value: "0 */2 * * *" },
  { label: "6 小时", value: "0 */6 * * *" },
  { label: "每天 9 点", value: "0 9 * * *" },
];

const initialForm: MonitorFormState = {
  type: "keyword",
  platform: "小红书",
  keyword: "",
  accountExternalId: "",
  industry: "",
  schedule: "0 */2 * * *",
  skillInstallId: "",
};

const statusMeta: Record<
  string,
  { label: string; className: string; icon: LucideIcon }
> = {
  active: {
    label: "运行中",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
    icon: PlayCircle,
  },
  paused: {
    label: "已暂停",
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
    icon: PauseCircle,
  },
  error: {
    label: "异常",
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
    icon: AlertTriangle,
  },
  archived: {
    label: "已归档",
    className:
      "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-muted)] text-[var(--kaypal-v3-muted)]",
    icon: Archive,
  },
};

function monitorStatus(monitor: IntelligenceMonitorSummary) {
  return (
    statusMeta[monitor.status] || {
      label: monitor.status || "未标注",
      className:
        "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)]",
      icon: BellRing,
    }
  );
}

function isCurrentMonitorError(monitor: IntelligenceMonitorSummary) {
  return (
    monitor.status !== "archived" &&
    (monitor.status === "error" || Boolean(monitor.lastError))
  );
}

function typeLabel(type: string) {
  const option = typeOptions.find((item) => item.value === type);
  return option?.label || type || "监控";
}

function scheduleLabel(schedule: string) {
  const preset = schedulePresets.find((item) => item.value === schedule);
  return preset?.label || schedule || "未设置";
}

function targetLabel(monitor: IntelligenceMonitorSummary) {
  const parts = [
    monitor.keyword,
    monitor.accountExternalId,
    monitor.industry,
    monitor.platform,
  ].filter(Boolean);
  return parts.join(" / ") || "未填写目标";
}

function skillLabel(skill: RedfoxSkill) {
  return `${publicIntelligenceText(skill.name)} · ${skill.platform || "通用"}`;
}

function formatTime(value: string | null) {
  if (!value) return "未运行";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未运行";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildQuery(filters: FilterState): QueryIntelligenceMonitorsInput {
  return {
    page: 1,
    limit: 30,
    status: filters.status === "all" ? undefined : filters.status,
    type: filters.type === "all" ? undefined : filters.type,
    platform: filters.platform === "all" ? undefined : filters.platform,
    keyword: filters.keyword.trim() || undefined,
    sortBy: "updatedAt",
    sortOrder: "desc",
  };
}

function textOrUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function buildCreateInput(
  form: MonitorFormState,
): CreateIntelligenceMonitorInput {
  return {
    type: form.type,
    schedule: form.schedule,
    platform: form.platform === "all" ? undefined : form.platform,
    keyword: textOrUndefined(form.keyword),
    accountExternalId: textOrUndefined(form.accountExternalId),
    industry: textOrUndefined(form.industry),
    skillInstallId: textOrUndefined(form.skillInstallId),
    status: "active",
    costLimitPoints: undefined,
    config: {
      source: "kaypal-intelligence-monitor-workbench",
      guardrails: ["保留来源", "高风险先审核", "不自动触达"],
    },
  };
}

export function IntelligenceMonitorsWorkbench() {
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool");
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    type: "all",
    platform: "all",
    keyword: "",
  });
  const [form, setForm] = useState<MonitorFormState>(initialForm);
  const [monitors, setMonitors] = useState<IntelligenceMonitorSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [actions, setActions] = useState<ActionLog[]>([]);
  const [skills, setSkills] = useState<RedfoxSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    intelligenceApi
      .listMonitors(buildQuery(filters))
      .then((result) => {
        if (!active) return;
        setMonitors(result.items);
        setTotal(result.total);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setMonitors([]);
        setTotal(0);
        setError(traceableMonitorError(reason));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    let active = true;
    setSkillsLoading(true);
    redfoxApi
      .listSkills({ page: 1, limit: 50 })
      .then((result) => {
        if (!active) return;
        setSkills(result.items.filter((skill) => skill.enabled));
      })
      .catch(() => {
        if (!active) return;
        setSkills([]);
      })
      .finally(() => {
        if (!active) return;
        setSkillsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!monitors.length) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !monitors.some((monitor) => monitor.id === selectedId)) {
      setSelectedId(
        monitors.find((monitor) => monitor.status !== "archived")?.id ||
          monitors[0].id,
      );
    }
  }, [monitors, selectedId]);

  const selectedMonitor = useMemo(
    () => monitors.find((monitor) => monitor.id === selectedId) || null,
    [monitors, selectedId],
  );

  const metrics = useMemo(
    () => [
      {
        label: "监控总数",
        value: String(total),
        detail: "当前筛选范围内的配置",
        icon: BellRing,
      },
      {
        label: "运行中",
        value: String(
          monitors.filter((item) => item.status === "active").length,
        ),
        detail: "会被调度器继续读取",
        icon: PlayCircle,
      },
      {
        label: "异常",
        value: String(monitors.filter(isCurrentMonitorError).length),
        detail: "只统计未归档监控的当前异常",
        icon: ShieldAlert,
      },
      {
        label: "可执行",
        value: String(monitors.filter((item) => item.status === "active").length),
        detail: "运行中的长期监控",
        icon: Gauge,
      },
    ],
    [monitors, total],
  );

  function reloadMonitors() {
    setRefreshKey((value) => value + 1);
  }

  function updateFilters(nextFilters: Partial<FilterState>) {
    setFilters((current) => ({ ...current, ...nextFilters }));
  }

  function pushAction(action: ActionLog) {
    setActions((current) => [action, ...current].slice(0, 8));
  }

  function validateCreateInput(input: CreateIntelligenceMonitorInput) {
    if (!input.keyword && !input.accountExternalId && !input.industry) {
      return "至少填写关键词、账号 ID 或行业，不能创建没有目标的监控。";
    }
    if (
      input.type === "account" &&
      !input.accountExternalId &&
      !input.keyword
    ) {
      return "账号监控需要账号 ID、主页标识或账号关键词。";
    }
    if (input.type === "industry" && !input.industry) {
      return "行业监控需要填写行业名称。";
    }
    return "";
  }

  async function createMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = buildCreateInput(form);
    const validation = validateCreateInput(input);
    if (validation) {
      setFormError(validation);
      return;
    }

    setSaving(true);
    setFormError("");
    const actionId = `create:${Date.now()}`;
    pushAction({
      id: actionId,
      title: "创建监控",
      detail: `${typeLabel(input.type)} / ${input.keyword || input.accountExternalId || input.industry}`,
      state: "running",
    });

    try {
      const monitor = await intelligenceApi.createMonitor(input);
      pushAction({
        id: `${actionId}:done`,
        title: "监控已创建",
        detail: targetLabel(monitor),
        state: "done",
      });
      setForm((current) => ({
        ...current,
        keyword: "",
        accountExternalId: "",
        industry: "",
      }));
      setSelectedId(monitor.id);
      reloadMonitors();
    } catch (reason) {
      const message = toActionableError(reason, "创建监控失败");
      setFormError(message);
      pushAction({
        id: `${actionId}:failed`,
        title: "创建失败",
        detail: message,
        state: "failed",
      });
    } finally {
      setSaving(false);
    }
  }

  async function updateMonitorStatus(
    monitor: IntelligenceMonitorSummary,
    status: "active" | "paused",
  ) {
    const actionId = `${monitor.id}:${status}:${Date.now()}`;
    pushAction({
      id: actionId,
      title: status === "active" ? "恢复监控" : "暂停监控",
      detail: targetLabel(monitor),
      state: "running",
    });

    try {
      await intelligenceApi.updateMonitor(monitor.id, {
        status,
        lastError: "",
      });
      pushAction({
        id: `${actionId}:done`,
        title: status === "active" ? "已恢复" : "已暂停",
        detail: targetLabel(monitor),
        state: "done",
      });
      reloadMonitors();
    } catch (reason) {
      pushAction({
        id: `${actionId}:failed`,
        title: "状态更新失败",
        detail: toActionableError(reason, "监控状态更新失败"),
        state: "failed",
      });
    }
  }

  async function updateMonitorSchedule(
    monitor: IntelligenceMonitorSummary,
    schedule: string,
  ) {
    const actionId = `${monitor.id}:schedule:${Date.now()}`;
    pushAction({
      id: actionId,
      title: "调整频率",
      detail: `${targetLabel(monitor)} / ${scheduleLabel(schedule)}`,
      state: "running",
    });

    try {
      await intelligenceApi.updateMonitor(monitor.id, { schedule });
      pushAction({
        id: `${actionId}:done`,
        title: "频率已更新",
        detail: scheduleLabel(schedule),
        state: "done",
      });
      reloadMonitors();
    } catch (reason) {
      pushAction({
        id: `${actionId}:failed`,
        title: "频率更新失败",
        detail: toActionableError(reason, "监控频率更新失败"),
        state: "failed",
      });
    }
  }

  async function archiveMonitor(monitor: IntelligenceMonitorSummary) {
    const actionId = `${monitor.id}:archive:${Date.now()}`;
    pushAction({
      id: actionId,
      title: "归档监控",
      detail: targetLabel(monitor),
      state: "running",
    });

    try {
      await intelligenceApi.archiveMonitor(monitor.id);
      pushAction({
        id: `${actionId}:done`,
        title: "已归档",
        detail: targetLabel(monitor),
        state: "done",
      });
      reloadMonitors();
    } catch (reason) {
      pushAction({
        id: `${actionId}:failed`,
        title: "归档失败",
        detail: toActionableError(reason, "监控归档失败"),
        state: "failed",
      });
    }
  }

  async function runMonitorNow(monitor: IntelligenceMonitorSummary) {
    const actionId = `${monitor.id}:run:${Date.now()}`;
    pushAction({
      id: actionId,
      title: "立即执行",
      detail: targetLabel(monitor),
      state: "running",
    });

    try {
      const result = await intelligenceApi.runMonitor(monitor.id);
      pushAction({
        id: `${actionId}:done`,
        title: "执行完成",
        detail: `新增 ${result.created || 0}，更新 ${result.updated || 0}，下次 ${formatTime(result.nextRunAt)}`,
        state: "done",
      });
      reloadMonitors();
    } catch (reason) {
      pushAction({
        id: `${actionId}:failed`,
        title: "执行失败",
        detail: toActionableError(reason, "监控执行失败"),
        state: "failed",
      });
      reloadMonitors();
    }
  }

  async function runDueMonitors() {
    const actionId = `run-due:${Date.now()}`;
    pushAction({
      id: actionId,
      title: "执行到期监控",
      detail: "最多执行 10 条当前到期配置",
      state: "running",
    });

    try {
      const result = await intelligenceApi.runDueMonitors({ limit: 10 });
      pushAction({
        id: `${actionId}:done`,
        title: "到期监控已执行",
        detail: `成功 ${result.succeeded}，失败 ${result.failed}`,
        state: result.failed > 0 ? "failed" : "done",
      });
      reloadMonitors();
    } catch (reason) {
      pushAction({
        id: `${actionId}:failed`,
        title: "批量执行失败",
        detail: toActionableError(reason, "到期监控执行失败"),
        state: "failed",
      });
      reloadMonitors();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <p className="kaypal-v3-label">自动监控</p>
              <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                情报监控工作台
              </h1>
              <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                把关键词、账号、行业和平台榜单配置成长期监控；成功采集后直接扣积分，每条监控都有频率、状态和错误记录，异常先停下来处理。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                onClick={reloadMonitors}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={["h-4 w-4", loading ? "animate-spin" : ""].join(
                    " ",
                  )}
                  strokeWidth={1.8}
                />
                刷新
              </button>
              <button
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] px-4 text-13 font-semibold text-[var(--kaypal-v3-accent-ink)] transition-colors hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-paper)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                onClick={runDueMonitors}
                type="button"
              >
                <PlayCircle
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                执行到期
              </button>
              <Link
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href="/intelligence/search"
              >
                <Search
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                跑一次搜索
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, detail, icon: Icon }) => (
              <div
                className="min-h-[88px] rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                key={label}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="kaypal-v3-label">{label}</p>
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                </div>
                <p className="mt-1 text-xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                  {value}
                </p>
                <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                  {detail}
                </p>
              </div>
            ))}
          </div>

        </div>
      </section>

      <IntelligenceToolResultContext
        tool={activeTool === "brand-monitoring" ? activeTool : null}
      />

      <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(360px,0.85fr)_minmax(420px,1fr)_minmax(340px,0.8fr)]">
        <section className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="kaypal-v3-label">配置列表</p>
                <h2 className="mt-1 text-base font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                  监控队列
                </h2>
              </div>
              <SlidersHorizontal
                aria-hidden="true"
                className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <select
                aria-label="按状态筛选"
                className="h-9 rounded-[8px] px-3 text-13"
                onChange={(event) =>
                  updateFilters({ status: event.target.value })
                }
                value={filters.status}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="按类型筛选"
                className="h-9 rounded-[8px] px-3 text-13"
                onChange={(event) =>
                  updateFilters({ type: event.target.value })
                }
                value={filters.type}
              >
                <option value="all">全部类型</option>
                {typeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="按平台筛选"
                className="h-9 rounded-[8px] px-3 text-13"
                onChange={(event) =>
                  updateFilters({ platform: event.target.value })
                }
                value={filters.platform}
              >
                {platformOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]"
                  strokeWidth={1.8}
                />
                <input
                  aria-label="搜索监控"
                  className="h-9 w-full rounded-[8px] pl-9 pr-3 text-13"
                  onChange={(event) =>
                    updateFilters({ keyword: event.target.value })
                  }
                  placeholder="关键词 / 账号 / 行业"
                  value={filters.keyword}
                />
              </div>
            </div>
          </div>

          <div className="max-h-[720px] overflow-y-auto p-3">
            {loading ? (
              <div className="flex min-h-[220px] items-center justify-center rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-13 text-[var(--kaypal-v3-muted)]">
                <SkeletonList rows={3} />
              </div>
            ) : error ? (
              <FailureActionPanel
                actions={[
                  { label: "重新读取", onPress: reloadMonitors },
                  { href: "/intelligence/search", label: "一键找线索" },
                ]}
                impact="长期监控列表、异常状态和立即执行入口暂时不可用。"
                nextAction="先重新读取监控；仍失败时检查情报数据源和已启用功能。"
                reason={error}
                title="监控配置需要处理"
              />
            ) : monitors.length === 0 ? (
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/search", label: "一键找线索" },
                  { href: "/intelligence/inbox", label: "情报库" },
                ]}
                description="先在右侧创建关键词、账号、行业、热点或爆款监控，再让调度器持续把结果写入待处理发现。"
                examples={["关键词", "账号", "行业", "热点", "爆款"]}
                icon={BellRing}
                surface="plain"
                title="当前没有监控配置"
              />
            ) : (
              <div className="space-y-2">
                {monitors.map((monitor) => {
                  const meta = monitorStatus(monitor);
                  const Icon = meta.icon;
                  const active = monitor.id === selectedMonitor?.id;
                  return (
                    <button
                      className={[
                        "w-full rounded-[8px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]",
                        active
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                      ].join(" ")}
                      key={monitor.id}
                      onClick={() => setSelectedId(monitor.id)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-13 font-semibold text-[var(--kaypal-v3-ink)]">
                              {typeLabel(monitor.type)}
                            </span>
                            <span
                              className={[
                                "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                                meta.className,
                              ].join(" ")}
                            >
                              <Icon
                                aria-hidden="true"
                                className="h-3 w-3"
                                strokeWidth={1.8}
                              />
                              {meta.label}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                            {targetLabel(monitor)}
                          </p>
                        </div>
                        <Clock3
                          aria-hidden="true"
                          className="mt-1 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-11 text-[var(--kaypal-v3-muted)]">
                        <span>频率：{scheduleLabel(monitor.schedule)}</span>
                        <span>下次：{formatTime(monitor.nextRunAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">运行详情</p>
            <h2 className="mt-1 text-base font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              目标、频率、积分和异常
            </h2>
          </div>

          {selectedMonitor ? (
            <div className="p-4">
              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-12 font-semibold text-[var(--kaypal-v3-muted)]">
                      {selectedMonitor.platform || "全平台"} /{" "}
                      {typeLabel(selectedMonitor.type)}
                    </p>
                    <h3 className="mt-2 text-xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                      {targetLabel(selectedMonitor)}
                    </h3>
                  </div>
                  {(() => {
                    const meta = monitorStatus(selectedMonitor);
                    const Icon = meta.icon;
                    return (
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-12 font-semibold",
                          meta.className,
                        ].join(" ")}
                      >
                        <Icon
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                          strokeWidth={1.8}
                        />
                        {meta.label}
                      </span>
                    );
                  })()}
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {[
                    {
                      label: "执行频率",
                      value: scheduleLabel(selectedMonitor.schedule),
                      icon: TimerReset,
                    },
                    {
                      label: "积分规则",
                      value: "成功后直接扣积分",
                      icon: Gauge,
                    },
                    {
                      label: "上次运行",
                      value: formatTime(selectedMonitor.lastRunAt),
                      icon: CheckCircle2,
                    },
                    {
                      label: "下次运行",
                      value: formatTime(selectedMonitor.nextRunAt),
                      icon: Clock3,
                    },
                  ].map(({ label, value, icon: Icon }) => (
                    <div
                      className="min-h-[76px] rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
                      key={label}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="kaypal-v3-label">{label}</p>
                        <Icon
                          aria-hidden="true"
                          className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                      </div>
                      <p className="mt-2 text-14 font-semibold leading-5 text-[var(--kaypal-v3-ink)]">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>

                {selectedMonitor.lastError &&
                isCurrentMonitorError(selectedMonitor) ? (
                  <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-danger)]"
                        strokeWidth={1.8}
                      />
                      <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                        {selectedMonitor.lastError}
                      </p>
                    </div>
                  </div>
                ) : selectedMonitor.lastError ? (
                  <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      归档前记录：{selectedMonitor.lastError}
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      当前没有错误记录。调度器运行失败时会写入
                      错误记录，用户侧可直接暂停、调整频率或归档。
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                <p className="kaypal-v3-label">运行控制</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedMonitor.status !== "archived" ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                      onClick={() => runMonitorNow(selectedMonitor)}
                      type="button"
                    >
                      <PlayCircle
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                      立即执行
                    </button>
                  ) : null}
                  {selectedMonitor.status === "active" ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-amber)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                      onClick={() =>
                        updateMonitorStatus(selectedMonitor, "paused")
                      }
                      type="button"
                    >
                      <PauseCircle
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                      暂停
                    </button>
                  ) : selectedMonitor.status !== "archived" ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                      onClick={() =>
                        updateMonitorStatus(selectedMonitor, "active")
                      }
                      type="button"
                    >
                      <PlayCircle
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                      恢复
                    </button>
                  ) : null}
                  {selectedMonitor.status !== "archived" ? (
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                      onClick={() => archiveMonitor(selectedMonitor)}
                      type="button"
                    >
                      <Archive
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                      归档
                    </button>
                  ) : null}
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                    href="/intelligence/inbox"
                  >
                    <Database
                      aria-hidden="true"
                      className="h-4 w-4"
                      strokeWidth={1.8}
                    />
                    看入库情报
                  </Link>
                </div>

                <div className="mt-4">
                  <p className="kaypal-v3-label">快速调整频率</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {schedulePresets.map((preset) => (
                      <button
                        className={[
                          "h-8 rounded-[8px] border px-3 text-12 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]",
                          selectedMonitor.schedule === preset.value
                            ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                            : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]",
                        ].join(" ")}
                        disabled={selectedMonitor.schedule === preset.value}
                        key={preset.value}
                        onClick={() =>
                          updateMonitorSchedule(selectedMonitor, preset.value)
                        }
                        type="button"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/search", label: "一键找线索" },
                  { href: "/intelligence/inbox", label: "情报库" },
                ]}
                description="选择一条监控后可以查看执行记录、错误原因、覆盖平台和最近产出。列表为空时先创建一个监控目标。"
                examples={["执行记录", "错误原因", "覆盖平台", "最近产出"]}
                icon={BellRing}
                surface="plain"
                title="选择一条监控查看详情"
              />
            </div>
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">新增监控</p>
              <h2 className="mt-1 text-base font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                创建可执行配置
              </h2>
            </div>
            <form className="space-y-3 p-4" onSubmit={createMonitor}>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
                <label className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  监控类型
                  <select
                    className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        type: event.target.value,
                      }))
                    }
                    value={form.type}
                  >
                    {typeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  平台
                  <select
                    className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        platform: event.target.value,
                      }))
                    }
                    value={form.platform}
                  >
                    {platformOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                使用功能
                <select
                  className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      skillInstallId: event.target.value,
                    }))
                  }
                  value={form.skillInstallId}
                >
                  <option value="">
                    {skillsLoading
                      ? "正在读取已启用功能"
                      : "不绑定功能，仅保存跟踪目标"}
                  </option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skillLabel(skill)}
                    </option>
                  ))}
                </select>
              </label>
              {!skillsLoading && skills.length === 0 ? (
                <div className="rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  还没有启用的功能。可以先保存跟踪目标，但立即执行需要去
                  <Link
                    className="mx-1 font-semibold text-[var(--kaypal-v3-accent-ink)] underline"
                    href="/capabilities/models"
                  >
                    AI 能力
                  </Link>
                  启用功能。
                </div>
              ) : null}

              <label className="block text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                关键词
                <input
                  className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      keyword: event.target.value,
                    }))
                  }
                  placeholder="例如：老板 IP / 暑期获客"
                  value={form.keyword}
                />
              </label>

              <label className="block text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                账号 ID / 主页标识
                <input
                  className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      accountExternalId: event.target.value,
                    }))
                  }
                  placeholder="账号监控时填写"
                  value={form.accountExternalId}
                />
              </label>

              <label className="block text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                行业
                <input
                  className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      industry: event.target.value,
                    }))
                  }
                  placeholder="例如：本地生活 / 教培 / 医美"
                  value={form.industry}
                />
              </label>

              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-1">
                <label className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  频率
                  <select
                    className="mt-1 h-9 w-full rounded-[8px] px-3 text-13"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        schedule: event.target.value,
                      }))
                    }
                    value={form.schedule}
                  >
                    {schedulePresets.map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {formError ? (
                <div className="rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {formError}
                </div>
              ) : null}

              <button
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={saving}
                type="submit"
              >
                {saving ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <BellRing
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                创建监控
              </button>
            </form>
          </section>

          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">动作记录</p>
              <h2 className="mt-1 text-base font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                最近操作
              </h2>
            </div>
            <div className="space-y-2 p-4">
              {actions.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  创建、暂停、恢复、调频和归档会记录在这里，方便用户确认刚才做了什么。
                </div>
              ) : (
                actions.map((action) => (
                  <div
                    className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
                    key={action.id}
                  >
                    <div className="flex items-start gap-2">
                      {action.state === "running" ? (
                        <Loader2
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                      ) : action.state === "done" ? (
                        <CheckCircle2
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
                          strokeWidth={1.8}
                        />
                      ) : (
                        <AlertTriangle
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-danger)]"
                          strokeWidth={1.8}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-13 font-semibold text-[var(--kaypal-v3-ink)]">
                          {action.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {action.detail}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
