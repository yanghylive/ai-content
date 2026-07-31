"use client";

import React from "react";
import { CircleDollarSign, RefreshCcw } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { kaypalApi, type KaypalSubscription } from "@/lib/api/auth";
import {
  redfoxApi,
  type RedfoxCostSummary,
  type RedfoxCallLog,
} from "@/lib/api/redfox";

function formatPlanLabel(plan?: string | null) {
  const normalized = String(plan || "").trim();
  const labels: Record<string, string> = {
    FREE: "免费版",
    PRO: "专业版",
    ADVANCED: "高级版",
    ENTERPRISE: "企业版",
  };
  return labels[normalized.toUpperCase()] || normalized || "未同步";
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未同步";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function relTime(value?: string | null) {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

const STATUS_TONE: Record<string, "success" | "danger" | "warning"> = {
  success: "success",
  failed: "danger",
  blocked: "warning",
};
const STATUS_LABEL: Record<string, string> = {
  success: "成功",
  failed: "失败",
  blocked: "被拦截",
};

export function CostsCenter() {
  const [loading, setLoading] = React.useState(true);
  const [subscription, setSubscription] = React.useState<KaypalSubscription | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceUnavailable, setBalanceUnavailable] = React.useState(false);
  const [summary, setSummary] = React.useState<RedfoxCostSummary | null>(null);
  const [logs, setLogs] = React.useState<RedfoxCallLog[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sub, billing, cost, logPage] = await Promise.all([
      kaypalApi.subscription().catch(() => null),
      kaypalApi.billing().catch(() => null),
      redfoxApi.getCostSummary().catch(() => null),
      redfoxApi.listCallLogs({ limit: 8 }).catch(() => null),
    ]);
    setSubscription(sub);
    const bal = billing?.balance;
    setBalance(typeof bal?.balance === "number" ? bal.balance : null);
    setBalanceUnavailable(Boolean(bal?.unavailable) || !bal);
    setSummary(cost);
    const items = (logPage as { items?: RedfoxCallLog[] } | null)?.items;
    setLogs(Array.isArray(items) ? items : []);
    if (!sub && !billing && !cost) {
      setError("套餐和用量数据暂时拉不到，请稍后刷新重试");
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const today = summary?.todayUsage;
  const todayPercent =
    today && today.dailyUserLimit > 0
      ? Math.min(100, Math.round((today.userCalls / today.dailyUserLimit) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">用量与费用</h1>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            套餐、积分余额和数据服务用量
          </p>
        </div>
        <V2GhostButton icon={RefreshCcw} loading={loading} onClick={() => void load()}>
          刷新
        </V2GhostButton>
      </section>

      {error ? (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      ) : null}

      {/* 总览 4 卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="kaypal-v3-panel p-5">
          <p className="text-xs text-[var(--kaypal-v3-muted)]">当前套餐</p>
          <div className="mt-2 flex items-center gap-2">
            <p className="text-xl font-bold text-[var(--kaypal-v3-ink)]">
              {subscription ? formatPlanLabel(subscription.plan) : "未同步"}
            </p>
            {subscription ? (
              <V2StatusChip tone={subscription.status === "active" ? "success" : "warning"}>
                {subscription.status === "active" ? "生效中" : "已过期"}
              </V2StatusChip>
            ) : null}
          </div>
          {subscription?.renewsAt ? (
            <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              {new Date(subscription.renewsAt).toLocaleDateString("zh-CN")} 续期
            </p>
          ) : null}
        </div>
        <div className="kaypal-v3-panel p-5">
          <p className="text-xs text-[var(--kaypal-v3-muted)]">积分余额</p>
          <p className="mt-2 text-xl font-bold text-[var(--kaypal-v3-success)]">
            {balanceUnavailable ? "需登录" : formatNumber(balance)}
          </p>
        </div>
        <div className="kaypal-v3-panel p-5">
          <p className="text-xs text-[var(--kaypal-v3-muted)]">本月调用</p>
          <p className="mt-2 text-xl font-bold text-[var(--kaypal-v3-ink)]">
            {summary ? `${formatNumber(summary.totalCalls)} 次` : "-"}
          </p>
          {summary ? (
            <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
              成功 {summary.successCalls} · 失败 {summary.failedCalls} · 拦截 {summary.blockedCalls}
            </p>
          ) : null}
        </div>
        <div className="kaypal-v3-panel p-5">
          <p className="text-xs text-[var(--kaypal-v3-muted)]">本月消耗积分</p>
          <p className="mt-2 text-xl font-bold text-[var(--kaypal-v3-amber)]">
            {summary ? formatNumber(summary.totalCostPoints) : "-"}
          </p>
        </div>
      </div>

      {/* 今日用量（服务端未配置上限时不显示） */}
      {today && (today.userCalls > 0 || today.dailyUserLimit > 0) ? (
        <V2Section title="今日用量" description="每天 0 点重置">
          <div className="p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--kaypal-v3-soft-ink)]">
                已用 {today.userCalls} 次 / 上限 {today.dailyUserLimit} 次
              </span>
              <span className="font-semibold text-[var(--kaypal-v3-ink)]">{todayPercent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-paper-muted)]">
              <div
                className="h-full rounded-full bg-[var(--kaypal-v3-accent)] transition-all"
                style={{ width: `${todayPercent}%` }}
              />
            </div>
          </div>
        </V2Section>
      ) : null}

      {/* 技能消耗 TOP */}
      {summary && summary.bySkill.length > 0 ? (
        <V2Section title="积分花在哪儿了" description="按消耗积分排序">
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {summary.bySkill.slice(0, 6).map((skill) => (
              <div key={skill.skillCode} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">{skill.skillCode}</p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                    {skill.calls} 次调用{skill.failures > 0 ? ` · ${skill.failures} 次失败` : ""}
                  </p>
                </div>
                <span className="text-sm font-bold text-[var(--kaypal-v3-amber)]">
                  {formatNumber(skill.costPoints)} 积分
                </span>
              </div>
            ))}
          </div>
        </V2Section>
      ) : null}

      {/* 最近调用 */}
      <V2Section title="最近调用记录" description="数据服务的每一次调用都留痕">
        {logs.length === 0 ? (
          <p className="p-5 text-sm text-[var(--kaypal-v3-muted)]">
            {loading ? "加载中..." : "还没有调用记录"}
          </p>
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {logs.map((log) => (
              <div key={log.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3">
                  <V2StatusChip tone={STATUS_TONE[log.status] || "warning"}>
                    {STATUS_LABEL[log.status] || log.status}
                  </V2StatusChip>
                  <div>
                    <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {log.operation || log.endpoint}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      {log.method} {log.endpoint} · {log.latencyMs}ms
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                    {log.costPoints > 0 ? `${formatNumber(log.costPoints)} 积分` : "免费"}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                    {relTime(log.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </V2Section>

      <section className="flex items-center gap-2 text-xs text-[var(--kaypal-v3-muted)]">
        <CircleDollarSign className="h-3.5 w-3.5" />
        套餐和积分来自你的 JIUZHANG AI 账号，用量来自本机数据服务的真实调用日志
      </section>
    </div>
  );
}
