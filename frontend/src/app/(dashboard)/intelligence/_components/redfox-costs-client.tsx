"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Gauge,
  Loader2,
  Plug,
  RefreshCw,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import {
  redfoxApi,
  type RedfoxCallLog,
  type RedfoxConnectionView,
  type RedfoxCostSummary,
} from "@/lib/api/redfox";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceText } from "./display-text";
import { publicAbilityLabel } from "./redfox-public-labels";
import { toPublicError } from "@/lib/public-error";

type StatusFilter = "all" | RedfoxCallLog["status"];
type Tone = "success" | "warning" | "danger" | "neutral";

type CostsState = {
  connection: RedfoxConnectionView | null;
  summary: RedfoxCostSummary | null;
  logs: RedfoxCallLog[];
  error: string;
};

const statusLabels: Record<RedfoxCallLog["status"], string> = {
  blocked: "需处理",
  failed: "失败",
  success: "成功",
};

const statusFilters: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "success", label: "成功" },
  { key: "failed", label: "失败" },
  { key: "blocked", label: "需处理" },
];

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

function successRate(summary: RedfoxCostSummary | null) {
  if (!summary?.totalCalls) return 100;
  return Math.round((summary.successCalls / summary.totalCalls) * 100);
}

function toneClass(tone: Tone) {
  if (tone === "success") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]";
  }
  if (tone === "warning") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]";
  }
  if (tone === "danger") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]";
}

function statusTone(status: RedfoxCallLog["status"]) {
  if (status === "success") return toneClass("success");
  if (status === "blocked") return toneClass("warning");
  return toneClass("danger");
}

function operationLabel(log: Pick<RedfoxCallLog, "operation" | "skillCode">) {
  const text = `${log.operation} ${log.skillCode || ""}`.toLowerCase();
  if (text.includes("skills.sync") || text.includes("skill-catalog")) {
    return "刷新功能模板";
  }
  if (text.includes("interfaces.sync") || text.includes("platforms.sync")) {
    return "刷新数据范围";
  }
  if (text.includes("connection.test")) return "检查管理员连接";
  if (text.includes("monitor")) return "自动监控";
  if (text.includes("search")) return "一键找线索";
  return "数据查找";
}

export function RedfoxCostsClient() {
  const [state, setState] = useState<CostsState>({
    connection: null,
    summary: null,
    logs: [],
    error: "",
  });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [connection, summary, logs] = await Promise.all([
        redfoxApi.getConnection(),
        redfoxApi.getCostSummary(),
        redfoxApi.listCallLogs({
          page: 1,
          limit: 80,
          status: status === "all" ? undefined : status,
        }),
      ]);
      setState({
        connection,
        summary,
        logs: logs.items,
        error: "",
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        error: publicIntelligenceText(
          toPublicError(error, "用量记录暂时无法读取，请重新加载。"),
        ),
      }));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = state.summary;
  const queryText = query.trim().toLowerCase();
  const filteredLogs = useMemo(() => {
    return state.logs.filter((log) => {
      if (!queryText) return true;
      return [
        log.operation,
        publicAbilityLabel(log.skillCode),
        log.endpoint,
        log.errorMessage || "",
        log.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    });
  }, [queryText, state.logs]);

  const riskLogs = useMemo(
    () =>
      state.logs
        .filter((log) => log.status !== "success")
        .sort((left, right) => {
          if (left.status !== right.status) {
            return left.status === "failed" ? -1 : 1;
          }
          return right.costPoints - left.costPoints;
        })
        .slice(0, 5),
    [state.logs],
  );

  const topSkills = useMemo(() => {
    return [...(summary?.bySkill || [])]
      .sort((left, right) => right.costPoints - left.costPoints)
      .slice(0, 6);
  }, [summary]);
  const maxSkillCost = Math.max(
    1,
    ...topSkills.map((skill) => skill.costPoints),
  );

  const userCalls = summary?.todayUsage.userCalls ?? 0;
  const tenantCalls = summary?.todayUsage.tenantCalls ?? 0;
  const rate = successRate(summary);

  const metrics = useMemo<
    Array<{
      label: string;
      value: string;
      detail: string;
      icon: LucideIcon;
      tone: Tone;
    }>
  >(
    () => [
      {
        label: "总使用",
        value: String(summary?.totalCalls ?? 0),
        detail: `成功 ${summary?.successCalls ?? 0}，失败 ${summary?.failedCalls ?? 0}`,
        icon: Activity,
        tone: "neutral",
      },
      {
        label: "成功率",
        value: `${rate}%`,
        detail:
          rate >= 95 ? "稳定" : rate >= 80 ? "需要巡检失败项" : "需要立即处理",
        icon: CheckCircle2,
        tone: rate >= 95 ? "success" : rate >= 80 ? "warning" : "danger",
      },
      {
        label: "需处理/失败",
        value: String(
          (summary?.failedCalls ?? 0) + (summary?.blockedCalls ?? 0),
        ),
        detail: `失败 ${summary?.failedCalls ?? 0}，需处理 ${summary?.blockedCalls ?? 0}`,
        icon: AlertTriangle,
        tone:
          (summary?.failedCalls ?? 0) + (summary?.blockedCalls ?? 0) > 0
            ? "warning"
            : "success",
      },
      {
        label: "点数用量",
        value: String(summary?.totalCostPoints ?? 0),
        detail: "真实采集成功后直接扣积分",
        icon: CircleDollarSign,
        tone: (summary?.totalCostPoints ?? 0) > 0 ? "neutral" : "success",
      },
    ],
    [rate, summary],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <CircleDollarSign
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">用量记录</p>
                <h1 className="mt-1 text-2xl font-bold leading-8 text-[var(--kaypal-v3-ink)]">
                  看今天扣了多少、哪里失败、每次采集是否成功
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  用户只看用量和结果。系统会把每次查找、失败、需处理项和点数消耗记录下来，方便复盘。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Link
                className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/redfox"
              >
                <Plug
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                管理员连接
              </Link>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => void load()}
                type="button"
              >
                {loading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <RefreshCw
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                刷新
              </button>
            </div>
          </div>

        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <article
            className={[
              "kaypal-v3-panel min-h-[96px] p-3",
              toneClass(tone),
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
            <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
              {detail}
            </p>
          </article>
        ))}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(420px,0.95fr)_minmax(0,1.05fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">积分扣减</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              真实采集直接扣积分
            </h2>
          </div>
          <div className="grid gap-4 p-4">
            {[
              {
                label: "我的今日采集",
                value: userCalls,
                unit: "次",
                detail: "当前账号触发的真实数据采集次数",
              },
              {
                label: "团队今日采集",
                value: tenantCalls,
                unit: "次",
                detail: "团队范围内的真实数据采集次数",
              },
              {
                label: "累计扣减",
                value: summary?.totalCostPoints ?? 0,
                unit: "点",
                detail: "外部数据成功返回后进入积分结算",
              },
            ].map((item) => (
              <div
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4"
                key={item.label}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {item.label}
                    </p>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {item.detail}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                    {item.value} {item.unit}
                  </span>
                </div>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <Link
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/intelligence/search"
              >
                <div className="flex items-center gap-2">
                  <Activity
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                  <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    发起采集
                  </span>
                </div>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  查找内容、账号或评论，成功后直接扣积分。
                </p>
              </Link>
              <Link
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                href="/intelligence/skills"
              >
                <div className="flex items-center gap-2">
                  <Gauge
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                  <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    查看功能用量
                  </span>
                </div>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  按业务功能查看每次使用和扣减分布。
                </p>
              </Link>
            </div>
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="kaypal-v3-label">历史失败复盘</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  失败与需处理记录
                </h2>
              </div>
              <span className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 py-1 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
                {riskLogs.length} 条
              </span>
            </div>
          </div>
          <div className="grid gap-2 p-4">
            {riskLogs.length ? (
              riskLogs.map((log) => (
                <div
                  className={[
                    "rounded-[8px] border p-3",
                    statusTone(log.status),
                  ].join(" ")}
                  key={log.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                          {statusLabels[log.status]}
                        </span>
                        <span className="text-11 text-[var(--kaypal-v3-muted)]">
                          {formatTime(log.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {operationLabel(log)}
                      </p>
                      <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                        {publicIntelligenceText(
                          log.errorMessage || operationLabel(log),
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 text-13 font-bold text-[var(--kaypal-v3-soft-ink)]">
                      {log.costPoints} 点
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <FunctionalEmptyState
                description="当前记录范围内没有失败或需处理项，继续观察点数水位和成功率即可。"
                examples={["失败项", "需处理项", "点数水位", "成功率"]}
                icon={CheckCircle2}
                surface="plain"
                title="当前没有历史失败或需处理项"
              />
            )}
          </div>
        </article>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
              <div>
                <p className="kaypal-v3-label">使用明细</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  每一次查找和跟踪都会记录
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {statusFilters.map((item) => {
                  const active = status === item.key;
                  return (
                    <button
                      aria-pressed={active}
                      className={[
                        "h-8 rounded-[8px] border px-3 text-12 font-semibold transition",
                        active
                          ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                      ].join(" ")}
                      key={item.key}
                      onClick={() => setStatus(item.key)}
                      type="button"
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3">
              <input
                className="h-10 w-full rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-13 text-[var(--kaypal-v3-ink)]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索操作、状态或错误信息"
                value={query}
              />
            </div>
          </div>

          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filteredLogs.length ? (
              filteredLogs.map((log) => (
                <div
                  className="grid gap-3 p-4 md:grid-cols-[150px_minmax(0,1fr)_120px_90px_100px] md:items-center"
                  key={log.id}
                >
                  <div>
                    <p className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                      {formatTime(log.createdAt)}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-11 text-[var(--kaypal-v3-muted)]">
                      <Clock3 aria-hidden="true" className="h-3 w-3" />
                      {log.latencyMs}ms
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
                      statusTone(log.status),
                    ].join(" ")}
                  >
                    {statusLabels[log.status]}
                  </span>
                  <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
                    {log.costPoints} 点
                  </p>
                  <p className="font-mono text-11 text-[var(--kaypal-v3-muted)]">
                    {log.responseStatus || "--"}
                  </p>
                </div>
              ))
            ) : (
              <div className="p-4">
                <FunctionalEmptyState
                  description="当前状态筛选或搜索关键词下没有使用记录。可以调整筛选，或先运行搜索、热点、监控等情报任务。"
                  examples={["状态筛选", "关键词", "搜索任务", "监控任务"]}
                  icon={Activity}
                  surface="plain"
                  title="没有匹配的使用记录"
                />
              </div>
            )}
          </div>
          {state.error ? (
            <div className="border-t border-[var(--kaypal-v3-border)] p-4">
              <FailureActionPanel
                actions={[
                  { label: "重新读取", onPress: () => void load() },
                  { href: "/intelligence/redfox", label: "数据来源" },
                ]}
                impact="无法查看用量记录、失败项和点数消耗，影响成本复盘。"
                nextAction="先重新读取；仍失败时检查情报数据来源和授权状态。"
                reason={state.error}
                title="用量记录需要处理"
              />
            </div>
          ) : null}
        </article>

        <aside className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">功能用量</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              积分消耗排行
            </h2>
          </div>
          <div className="grid gap-2 p-4">
            {topSkills.length ? (
              topSkills.map((skill) => {
                const failures = skill.failures;
                const costShare = Math.max(
                  8,
                  percent(skill.costPoints, maxSkillCost),
                );
                return (
                  <Link
                    className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                    href="/intelligence/skills"
                    key={skill.skillCode}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-12 font-bold text-[var(--kaypal-v3-ink)]">
                          {publicAbilityLabel(skill.skillCode)}
                        </p>
                        <p className="mt-1 text-11 text-[var(--kaypal-v3-muted)]">
                          使用 {skill.calls} 次 · 失败 {skill.failures}
                        </p>
                      </div>
                      <span className="shrink-0 text-13 font-bold text-[var(--kaypal-v3-accent-ink)]">
                        {skill.costPoints} 点
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
                      <div
                        className={[
                          "h-full rounded-full",
                          failures
                            ? "bg-[var(--kaypal-v3-amber)]"
                            : "bg-[var(--kaypal-v3-accent)]",
                        ].join(" ")}
                        style={{ width: `${costShare}%` }}
                      />
                    </div>
                  </Link>
                );
              })
            ) : (
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/search", label: "一键找线索" },
                  { href: "/intelligence/monitors", label: "自动跟踪" },
                ]}
                description="开始查找或运行跟踪后，这里会显示各功能调用次数、失败次数和点数分布。"
                examples={["调用次数", "失败次数", "点数分布", "功能排行"]}
                icon={CircleDollarSign}
                surface="plain"
                title="当前没有功能用量排行"
              />
            )}
          </div>
          <div className="border-t border-[var(--kaypal-v3-border)] p-4">
            <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <div className="flex items-start gap-2">
                <ShieldAlert
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-accent)]"
                  strokeWidth={1.8}
                />
                <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  用量治理不直接删除功能；先按产出效果停用或降频，再观察下一轮积分消耗。
                </p>
              </div>
              <Link
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/redfox"
              >
                打开管理员连接
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
