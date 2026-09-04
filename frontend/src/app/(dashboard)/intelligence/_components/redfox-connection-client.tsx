"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Blocks,
  CheckCircle2,
  CircleDollarSign,
  Database,
  KeyRound,
  Loader2,
  Plug,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from "@/components/iconpark";
import {
  redfoxApi,
  type RedfoxCallLog,
  type RedfoxConnectionStatus,
  type RedfoxConnectionView,
  type RedfoxCostSummary,
  type RedfoxInterface,
  type RedfoxSkill,
} from "@/lib/api/redfox";
import { publicIntelligenceText } from "./display-text";
import { publicAbilityLabel } from "./redfox-public-labels";
import { toPublicError } from "@/lib/public-error";

type LoadState = {
  connection: RedfoxConnectionView | null;
  cost: RedfoxCostSummary | null;
  logs: RedfoxCallLog[];
  interfaces: RedfoxInterface[];
  interfacesTotal: number;
  skills: RedfoxSkill[];
  skillsTotal: number;
  error: string;
};

type DiagnosticTone = "success" | "warning" | "danger" | "neutral";

const statusLabels: Record<RedfoxConnectionStatus, string> = {
  connected: "已连接",
  disabled: "已停用",
  failed: "连接失败",
  missing_key: "未配置",
  untested: "待检查",
};

const sourceLabels: Record<RedfoxConnectionView["apiKeySource"], string> = {
  env: "系统配置",
  missing: "未配置",
  saved: "后台保存",
};

const logStatusLabels: Record<RedfoxCallLog["status"], string> = {
  blocked: "需处理",
  failed: "失败",
  success: "成功",
};

const quickEntryItems: Array<{
  title: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  emphasis?: boolean;
}> = [
  {
    title: "回到方案中心",
    detail: "选业务场景、填目标、看运行结果。",
    href: "/solutions",
    icon: ArrowLeft,
    emphasis: true,
  },
  {
    title: "直接找线索",
    detail: "输入关键词，查内容、账号和评论样本。",
    href: "/intelligence/search",
    icon: Search,
  },
  {
    title: "设置自动监控",
    detail: "让系统按关键词或账号持续发现变化。",
    href: "/intelligence/monitors",
    icon: BellRing,
  },
  {
    title: "看功能模板",
    detail: "确认系统当前接了哪些外部能力。",
    href: "/intelligence/skills",
    icon: Blocks,
  },
];

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusTone(status?: RedfoxConnectionStatus) {
  if (status === "connected") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (status === "failed" || status === "missing_key") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (status === "untested") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-muted)]";
}

function diagnosticTone(tone: DiagnosticTone) {
  if (tone === "success") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]";
  }
  if (tone === "warning") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]";
  }
  if (tone === "danger") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]";
}

function logTone(status: RedfoxCallLog["status"]) {
  if (status === "success") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]";
  }
  if (status === "blocked") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]";
  }
  return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]";
}

function operationLabel(log: Pick<RedfoxCallLog, "operation" | "skillCode">) {
  const text = `${log.operation} ${log.skillCode || ""}`.toLowerCase();
  if (text.includes("skills.sync") || text.includes("skill-catalog")) {
    return "刷新功能模板";
  }
  if (text.includes("interfaces.sync") || text.includes("platforms.sync")) {
    return "刷新数据范围";
  }
  if (text.includes("connection.test")) return "检查数据源";
  if (text.includes("monitor")) return "自动监控";
  if (text.includes("search")) return "一键找线索";
  return "数据查找";
}

export function RedfoxConnectionClient() {
  const [data, setData] = useState<LoadState>({
    connection: null,
    cost: null,
    logs: [],
    interfaces: [],
    interfacesTotal: 0,
    skills: [],
    skillsTotal: 0,
    error: "",
  });
  const [baseUrl, setBaseUrl] = useState("https://redfox.hk");
  const [apiKey, setApiKey] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(60000);
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState("");

  const applyConnection = useCallback((connection: RedfoxConnectionView) => {
    setBaseUrl(connection.baseUrl);
    setTimeoutMs(connection.timeoutMs);
    setEnabled(connection.enabled);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [connection, cost, logs, interfaces, skills] = await Promise.all([
        redfoxApi.getConnection(),
        redfoxApi.getCostSummary(),
        redfoxApi.listCallLogs({ page: 1, limit: 8 }),
        redfoxApi.listInterfaces({ page: 1, limit: 8, status: "online" }),
        redfoxApi.listSkills({ page: 1, limit: 8 }),
      ]);
      setData({
        connection,
        cost,
        logs: logs.items,
        interfaces: interfaces.items,
        interfacesTotal: interfaces.total,
        skills: skills.items,
        skillsTotal: skills.total,
        error: "",
      });
      applyConnection(connection);
    } catch (error) {
      setData((current) => ({
        ...current,
        error: publicIntelligenceText(
          toPublicError(error, "数据源状态暂时无法读取，请重新加载。"),
        ),
      }));
      setMessage(
        publicIntelligenceText(
          toPublicError(error, "数据源状态暂时无法读取，请重新加载。"),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [applyConnection]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setRunningAction("save");
    setMessage("");
    try {
      const next = await redfoxApi.saveConnection({
        baseUrl,
        timeoutMs,
        enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      setData((current) => ({ ...current, connection: next, error: "" }));
      applyConnection(next);
      setMessage("数据源配置已保存，建议立即执行数据源检查。");
    } catch (error) {
      setMessage(
        publicIntelligenceText(
          toPublicError(error, "数据源配置未保存，请重试。"),
        ),
      );
    } finally {
      setRunningAction("");
    }
  }

  async function test() {
    setRunningAction("test");
    setMessage("");
    try {
      const result = await redfoxApi.testConnection();
      await load();
      setMessage(`连接检查通过：${formatDateTime(result.checkedAt)}`);
    } catch (error) {
      await load();
      setMessage(
        publicIntelligenceText(
          toPublicError(error, "数据源连接检查未完成，请重试。"),
        ),
      );
    } finally {
      setRunningAction("");
    }
  }

  async function syncSkills() {
    setRunningAction("sync");
    setMessage("");
    try {
      const result = await redfoxApi.syncSkills({ page: 1, pageSize: 100 });
      await load();
      setMessage(
        `功能模板刷新完成：接收 ${result.received}，新增 ${result.created}，更新 ${result.updated}。`,
      );
    } catch (error) {
      setMessage(
        publicIntelligenceText(
          toPublicError(error, "功能模板暂时无法刷新，请重试。"),
        ),
      );
    } finally {
      setRunningAction("");
    }
  }

  async function syncInterfaces() {
    setRunningAction("sync-interfaces");
    setMessage("");
    try {
      const result = await redfoxApi.syncInterfaces();
      await load();
      setMessage(
        `数据范围刷新完成：平台 ${result.attempted}，范围 ${result.received}，新增 ${result.created}，更新 ${result.updated}，失败 ${result.failed}。`,
      );
    } catch (error) {
      setMessage(
        publicIntelligenceText(
          toPublicError(error, "数据范围暂时无法刷新，请重试。"),
        ),
      );
    } finally {
      setRunningAction("");
    }
  }

  const connection = data.connection;
  const cost = data.cost;
  const userCalls = cost?.todayUsage.userCalls ?? 0;
  const tenantCalls = cost?.todayUsage.tenantCalls ?? 0;
  const totalCostPoints = cost?.totalCostPoints ?? 0;
  const latestLog = data.logs[0];
  const latestFailure =
    latestLog && latestLog.status !== "success" ? latestLog : null;
  const historicalFailureCount = data.logs.filter(
    (log) => log.status !== "success",
  ).length;

  const metrics = useMemo<
    Array<{
      label: string;
      value: string;
      detail: string;
      icon: LucideIcon;
      tone: DiagnosticTone;
    }>
  >(
    () => [
      {
        label: "连接状态",
        value: connection
          ? statusLabels[connection.status]
          : loading
            ? "读取中"
            : "--",
        detail: publicIntelligenceText(
          connection?.lastError || data.error || "系统自动连接外部数据",
        ),
        icon: connection?.status === "connected" ? CheckCircle2 : WifiOff,
        tone:
          connection?.status === "connected"
            ? "success"
            : connection?.status === "failed" ||
                connection?.status === "missing_key"
              ? "danger"
              : "warning",
      },
      {
        label: "凭证来源",
        value: connection ? sourceLabels[connection.apiKeySource] : "--",
        detail: connection?.configured
          ? "已脱敏，前端不展示明文"
          : "未配置访问凭证",
        icon: KeyRound,
        tone: connection?.configured ? "success" : "danger",
      },
      {
        label: "今日采集",
        value: String(userCalls),
        detail: "真实采集成功后直接扣积分",
        icon: Activity,
        tone: "neutral",
      },
      {
        label: "已扣积分",
        value: `${totalCostPoints} 点`,
        detail: `团队今日采集 ${tenantCalls} 次，失败 ${cost?.failedCalls ?? 0}`,
        icon: CircleDollarSign,
        tone: totalCostPoints > 0 ? "neutral" : "success",
      },
    ],
    [
      connection,
      cost,
      data.error,
      loading,
      tenantCalls,
      totalCostPoints,
      userCalls,
    ],
  );

  const diagnostics = useMemo<
    Array<{
      title: string;
      detail: string;
      tone: DiagnosticTone;
      action: string;
    }>
  >(
    () => [
      {
        title: "数据连接开关",
        detail: enabled
          ? "已允许系统查找外部数据"
          : "已停用，所有实时查找会停止",
        tone: enabled ? "success" : "warning",
        action: enabled ? "可运行" : "先启用",
      },
      {
        title: "访问凭证",
        detail: connection?.configured
          ? `${sourceLabels[connection.apiKeySource]}：已配置`
          : "未配置访问凭证，无法刷新功能或运行监控",
        tone: connection?.configured ? "success" : "danger",
        action: connection?.configured ? "已脱敏" : "补凭证",
      },
      {
        title: "最近检查",
        detail:
          connection?.lastTestAt && connection.status === "connected"
            ? `通过于 ${formatDateTime(connection.lastTestAt)}`
            : publicIntelligenceText(
                connection?.lastError || "保存配置后需要执行连接检查",
              ),
        tone:
          connection?.status === "connected"
            ? "success"
            : connection?.status === "failed"
              ? "danger"
              : "warning",
        action: connection?.status === "connected" ? "通过" : "检查",
      },
      {
        title: "积分扣减",
        detail: "真实采集成功返回后按实际点数直接扣积分。",
        tone: "success",
        action: "直接扣分",
      },
      {
        title: "可查数据范围",
        detail: data.interfacesTotal
          ? `已刷新 ${data.interfacesTotal} 个可查范围，自动跟踪会从这里选择。`
          : "还没有可查范围，先刷新数据范围。",
        tone: data.interfacesTotal ? "success" : "warning",
        action: data.interfacesTotal ? "已同步" : "同步",
      },
      {
        title: "失败处置",
        detail: latestFailure
          ? `${logStatusLabels[latestFailure.status]}：${publicIntelligenceText(latestFailure.errorMessage || "需要检查设置")}`
          : historicalFailureCount
            ? `最新使用正常，保留 ${historicalFailureCount} 条历史失败记录用于复盘。`
            : "最近使用没有失败或需处理记录",
        tone: latestFailure ? "warning" : "success",
        action: latestFailure ? "查看用量" : "正常",
      },
    ],
    [
      connection,
      data.interfacesTotal,
      enabled,
      historicalFailureCount,
      latestFailure,
    ],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Plug
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">数据源设置</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  这页只管外部数据能不能用
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  它不是方案页，也不是结果页。要做业务，去方案中心、一键找线索或自动监控；只有管理员需要在这里保存凭证、检查数据源和刷新可用能力。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-3 text-12 font-semibold text-white transition hover:-translate-y-0.5"
                    href="/solutions"
                  >
                    <ArrowLeft
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    回到方案中心
                  </Link>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                    href="/intelligence/search"
                  >
                    <Search
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    去一键找线索
                  </Link>
                  <Link
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                    href="/intelligence/monitors"
                  >
                    <BellRing
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    去自动监控
                  </Link>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading || Boolean(runningAction)}
                onClick={() => void load()}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={["h-4 w-4", loading ? "animate-spin" : ""].join(
                    " ",
                  )}
                  strokeWidth={1.8}
                />
                刷新状态
              </button>
              <button
                className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading || Boolean(runningAction)}
                onClick={() => void test()}
                type="button"
              >
                {runningAction === "test" ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <Plug
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                检查数据源
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickEntryItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  className={[
                    "group flex min-h-[96px] items-start gap-3 rounded-[8px] border p-3 transition",
                    item.emphasis
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                  ].join(" ")}
                  href={item.href}
                  key={item.title}
                >
                  <span className="kaypal-v3-icon-tile h-8 w-8 shrink-0">
                    <Icon
                      aria-hidden="true"
                      className="h-4 w-4"
                      strokeWidth={1.8}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {item.detail}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>

        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <article
            className={[
              "kaypal-v3-panel min-h-[112px] p-3",
              label === "连接状态" ? statusTone(connection?.status) : "",
            ].join(" ")}
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
            <p className="mt-1 line-clamp-2 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
              {detail}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
              <div
                className={[
                  "h-full rounded-full",
                  tone === "danger"
                    ? "bg-[var(--kaypal-v3-danger)]"
                    : tone === "warning"
                      ? "bg-[var(--kaypal-v3-amber)]"
                      : "bg-[var(--kaypal-v3-accent)]",
                ].join(" ")}
                style={{
                  width:
                    label === "今日采集" || label === "已扣积分"
                      ? totalCostPoints > 0 || userCalls > 0
                        ? "100%"
                        : "35%"
                      : connection?.status === "connected"
                        ? "100%"
                        : connection?.configured
                          ? "55%"
                          : "18%",
                }}
              />
            </div>
          </article>
        ))}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.05fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="kaypal-v3-label">数据连接配置</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  服务地址、访问凭证和积分扣减
                </h2>
              </div>
              <span
                className={[
                  "rounded-[8px] border px-3 py-1 text-12 font-semibold",
                  statusTone(connection?.status),
                ].join(" ")}
              >
                {connection ? statusLabels[connection.status] : "读取中"}
              </span>
            </div>
          </div>

          <div className="grid gap-4 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  服务地址
                </span>
                <input
                  className="h-10 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 text-[var(--kaypal-v3-ink)]"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  value={baseUrl}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  访问凭证
                </span>
                <input
                  className="h-10 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 text-[var(--kaypal-v3-ink)]"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    connection?.configured
                      ? "已配置，输入新凭证可替换"
                      : "输入访问凭证"
                  }
                  type="password"
                  value={apiKey}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  超时毫秒
                </span>
                <input
                  className="h-10 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 text-[var(--kaypal-v3-ink)]"
                  max={120000}
                  min={1000}
                  onChange={(event) => setTimeoutMs(Number(event.target.value))}
                  type="number"
                  value={timeoutMs}
                />
              </label>
              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 md:col-span-2">
                <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                  积分扣减
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  系统不要求用户预设额度。真实采集成功后按外部数据点数直接扣积分，并保留每次扣减记录。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <label className="inline-flex items-center gap-2 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                <input
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  type="checkbox"
                />
                启用数据连接
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={Boolean(runningAction)}
                  onClick={() => void save()}
                  type="button"
                >
                  {runningAction === "save" ? (
                    <Loader2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <Save
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                  )}
                  保存配置
                </button>
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[image:var(--kaypal-v3-gradient-primary)] px-3 text-12 font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={Boolean(runningAction)}
                  onClick={() => void test()}
                  type="button"
                >
                  {runningAction === "test" ? (
                    <Loader2
                      aria-hidden="true"
                      className="h-3.5 w-3.5 animate-spin"
                      strokeWidth={1.8}
                    />
                  ) : (
                    <Plug
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                  )}
                  检查数据源
                </button>
              </div>
            </div>

            {message ? (
              <p className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                {message}
              </p>
            ) : null}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">运行检查</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              上线前检查
            </h2>
          </div>
          <div className="grid gap-2 p-4">
            {diagnostics.map((item) => (
              <div
                className={[
                  "rounded-[8px] border p-3",
                  diagnosticTone(item.tone),
                ].join(" ")}
                key={item.title}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {item.title}
                    </p>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {item.detail}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                    {item.action}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">处置动作</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(runningAction)}
                onClick={() => void syncSkills()}
                type="button"
              >
                {runningAction === "sync" ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <Database
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                )}
                刷新功能模板
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={Boolean(runningAction)}
                onClick={() => void syncInterfaces()}
                type="button"
              >
                {runningAction === "sync-interfaces" ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <Database
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                )}
                刷新数据范围
              </button>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/costs"
              >
                查看用量
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/skills"
              >
                功能模板
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>
        </article>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="kaypal-v3-label">使用巡检</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  最近使用记录
                </h2>
              </div>
              <Link
                className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/costs"
              >
                全部记录
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>

          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {data.logs.length ? (
              data.logs.map((log) => (
                <div
                  className="grid gap-3 p-4 md:grid-cols-[160px_minmax(0,1fr)_120px_90px] md:items-center"
                  key={log.id}
                >
                  <div>
                    <p className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                      {formatDateTime(log.createdAt)}
                    </p>
                    <p className="mt-1 text-11 text-[var(--kaypal-v3-muted)]">
                      耗时 {log.latencyMs}ms
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {operationLabel(log)}
                    </p>
                    <p className="mt-1 truncate font-mono text-11 text-[var(--kaypal-v3-muted)]">
                      {publicAbilityLabel(log.skillCode)}
                    </p>
                    {log.errorMessage ? (
                      <p className="mt-1 line-clamp-1 text-11 text-[var(--kaypal-v3-danger)]">
                        {publicIntelligenceText(log.errorMessage)}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={[
                      "w-fit rounded-[6px] border px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]",
                      logTone(log.status),
                    ].join(" ")}
                  >
                    {logStatusLabels[log.status]}
                  </span>
                  <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
                    {log.costPoints} 点
                  </p>
                </div>
              ))
            ) : (
              <div className="p-4">
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <Activity
                    aria-hidden="true"
                    className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                  <p className="mt-2 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    暂无使用记录
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    执行连接检查、刷新功能或运行监控后会显示记录。
                  </p>
                </div>
              </div>
            )}
          </div>
        </article>

        <aside className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">可查范围</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              数据范围 {data.interfacesTotal}
            </h2>
          </div>
          <div className="grid gap-2 border-b border-[var(--kaypal-v3-border)] p-4">
            {data.interfaces.length ? (
              data.interfaces.map((item) => (
                <div
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3"
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {item.name}
                      </p>
                      <p className="mt-1 truncate font-mono text-11 text-[var(--kaypal-v3-muted)]">
                        {item.platformName || item.platformCode} ·{" "}
                        {item.scenario || "通用"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {item.scenario || item.platformCode}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <Database
                  aria-hidden="true"
                  className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                  strokeWidth={1.8}
                />
                <p className="mt-2 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                  还没有可查数据范围
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  刷新后，自动跟踪会从账号、作品和详情范围里选择。
                </p>
              </div>
            )}
          </div>
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">可用功能</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              系统功能 {data.skillsTotal}
            </h2>
          </div>
          <div className="grid gap-2 p-4">
            {data.skills.length ? (
              data.skills.map((skill) => (
                <Link
                  className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                  href="/intelligence/skills"
                  key={skill.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {skill.name}
                      </p>
                      <p className="mt-1 truncate text-11 text-[var(--kaypal-v3-muted)]">
                        {skill.platform || "unknown"} ·{" "}
                        {skill.scenario || "未绑定"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                      {skill.enabled ? "启用" : "未启用"}
                    </span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <Database
                  aria-hidden="true"
                  className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                  strokeWidth={1.8}
                />
                <p className="mt-2 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                  还没有可用功能
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  连接检查通过后刷新系统功能。
                </p>
              </div>
            )}
          </div>
          <div className="border-t border-[var(--kaypal-v3-border)] p-4">
            <div className="flex items-start gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-accent)]"
                strokeWidth={1.8}
              />
              <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                访问凭证只由系统保存和使用；积分消耗、失败和需处理项都会进入用量记录。
              </p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
