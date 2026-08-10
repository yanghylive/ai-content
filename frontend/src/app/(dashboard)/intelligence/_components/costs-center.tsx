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
import { usageTokenApi, type TokenQuota } from "@/lib/api/usage-token";
import { useIsMobile } from "@/lib/hooks/use-media-query";

function formatPlanLabel(plan?: string | null) {
  const normalized = String(plan || "").trim();
  const labels: Record<string, string> = {
    FREE: "免费版",
    PRO: "专业版",
    ADVANCED: "高级版",
    ENTERPRISE: "企业版",
    FLAGSHIP: "旗舰版",
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

/** 数据服务名 → 面向客户的友好名称（不暴露内部服务代号） */
function formatSkillName(code?: string | null) {
  const key = String(code || "").trim().toLowerCase();
  if (!key || key === "unknown") return "未知数据源";
  if (key.includes("douyin")) return "抖音数据";
  if (key.includes("xiaohongshu")) return "小红书数据";
  if (key.includes("bilibili")) return "哔哩哔哩数据";
  if (key.includes("catalog")) return "数据目录";
  return "数据服务";
}

/** 调用操作码 → 面向客户的友好名称（不暴露内部操作码） */
function formatOperation(operation?: string | null) {
  const key = String(operation || "").trim();
  if (!key) return "数据调用";
  const known: Record<string, string> = {
    "intelligence.search.manual": "情报搜索",
    "intelligence.search.auto": "情报自动搜索",
    "xhs.user.search": "小红书用户检索",
    "xhs.article.search": "小红书文章检索",
    "douyin.user.search": "抖音用户检索",
    "douyin.article.search": "抖音内容检索",
    "bilibili.user.search": "哔哩哔哩用户检索",
    "bilibili.article.search": "哔哩哔哩内容检索",
  };
  return known[key] || "数据调用";
}

export function CostsCenter() {
  const [loading, setLoading] = React.useState(true);
  const [subscription, setSubscription] = React.useState<KaypalSubscription | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceUnavailable, setBalanceUnavailable] = React.useState(false);
  const [summary, setSummary] = React.useState<RedfoxCostSummary | null>(null);
  const [logs, setLogs] = React.useState<RedfoxCallLog[]>([]);
  const [tokenQuota, setTokenQuota] = React.useState<TokenQuota | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const [sub, billing, cost, logPage, tokens] = await Promise.all([
      kaypalApi.subscription().catch(() => null),
      kaypalApi.billing().catch(() => null),
      redfoxApi.getCostSummary().catch(() => null),
      redfoxApi.listCallLogs({ limit: 8 }).catch(() => null),
      usageTokenApi.quota().catch(() => null),
    ]);
    setSubscription(sub);
    const bal = billing?.balance;
    setBalance(typeof bal?.balance === "number" ? bal.balance : null);
    setBalanceUnavailable(Boolean(bal?.unavailable) || !bal);
    setSummary(cost);
    const items = (logPage as { items?: RedfoxCallLog[] } | null)?.items;
    setLogs(Array.isArray(items) ? items : []);
    setTokenQuota(tokens);
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

  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">用量与费用</h1>
              <p className="mx-page-sub">套餐、积分余额和数据服务用量</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 14px" }}
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCcw size={13} style={{ marginRight: 4 }} />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</p>
          ) : null}

          {/* 总览 4 卡 */}
          <div className="mx-stat-grid">
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num" style={{ fontSize: 15 }}>
                {subscription ? formatPlanLabel(subscription.plan) : "未同步"}
              </div>
              <div className="mx-stat-label">当前套餐</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num mx-gold-text" style={{ fontSize: 15 }}>
                {balanceUnavailable ? "需登录" : formatNumber(balance)}
              </div>
              <div className="mx-stat-label">积分余额</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num" style={{ fontSize: 15 }}>
                {summary ? formatNumber(summary.totalCalls) : "-"}
              </div>
              <div className="mx-stat-label">本月调用</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num" style={{ fontSize: 15 }}>
                {summary ? formatNumber(summary.totalCostPoints) : "-"}
              </div>
              <div className="mx-stat-label">本月消耗积分</div>
            </div>
          </div>

          {/* 今日用量 + Token 用量进度 */}
          {today && (today.userCalls > 0 || today.dailyUserLimit > 0) ? (
            <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--mx-ink)" }}>
                <span>今日用量 · 已用 {today.userCalls}/{today.dailyUserLimit} 次</span>
                <span style={{ fontWeight: 700 }}>{todayPercent}%</span>
              </div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 99, background: "rgba(142,165,190,.2)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, width: `${todayPercent}%`, background: "linear-gradient(90deg,#3b82f6,#22d3ee)" }} />
              </div>
            </div>
          ) : null}
          {tokenQuota && tokenQuota.tokenLimit > 0 ? (
            <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--mx-ink)" }}>
                <span>今日 Token · {formatNumber(tokenQuota.tokenCount)}/{formatNumber(tokenQuota.tokenLimit)}</span>
                <span style={{ fontWeight: 700 }}>
                  {tokenQuota.tokenRemaining > 0
                    ? `${Math.min(100, Math.round((tokenQuota.tokenCount / tokenQuota.tokenLimit) * 100))}%`
                    : "已用尽"}
                </span>
              </div>
              <div style={{ marginTop: 8, height: 8, borderRadius: 99, background: "rgba(142,165,190,.2)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(100, Math.round((tokenQuota.tokenCount / tokenQuota.tokenLimit) * 100))}%`, background: "linear-gradient(90deg,#f59e0b,#f97316)" }} />
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 16, fontSize: 11, color: "var(--mx-muted)" }}>
                <span>对话 {formatNumber(tokenQuota.chatCount)}/{formatNumber(tokenQuota.chatLimit)}</span>
                <span>工具 {formatNumber(tokenQuota.toolCount)}/{formatNumber(tokenQuota.toolLimit)}</span>
              </div>
            </div>
          ) : null}

          {/* 积分花在哪儿 */}
          {summary && summary.bySkill.length > 0 ? (
            <section className="mx-mt-lg">
              <div className="mx-section-head">
                <div className="mx-section-title">积分花在哪儿了</div>
              </div>
              <div className="mx-card mx-list-card">
                {summary.bySkill.slice(0, 6).map((skill) => (
                  <div key={skill.skillCode} className="mx-row">
                    <div className="mx-row-main">
                      <div className="mx-row-title">{formatSkillName(skill.skillCode)}</div>
                      <div className="mx-row-desc">
                        {skill.calls} 次调用{skill.failures > 0 ? ` · ${skill.failures} 次失败` : ""}
                      </div>
                    </div>
                    <div className="mx-row-right">
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#d98a2d" }}>{formatNumber(skill.costPoints)} 积分</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* 最近调用 */}
          <section className="mx-mt-lg">
            <div className="mx-section-head">
              <div className="mx-section-title">最近调用记录</div>
            </div>
            {logs.length === 0 ? (
              <div className="mx-card mx-empty">
                <p>{loading ? "加载中..." : "还没有调用记录"}</p>
              </div>
            ) : (
              <div className="mx-card mx-list-card">
                {logs.map((log) => (
                  <div key={log.id} className="mx-row">
                    <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb", borderRadius: 999 }}>
                      <CircleDollarSign size={18} strokeWidth={1.8} />
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{formatOperation(log.operation)}</div>
                      <div className="mx-row-desc">{log.method} · {log.latencyMs}ms · {relTime(log.createdAt)}</div>
                    </div>
                    <div className="mx-row-right">
                      <span className={`mx-badge ${log.status === "success" ? "mx-badge-green" : log.status === "failed" ? "mx-badge-red" : "mx-badge-gold"}`}>
                        {STATUS_LABEL[log.status] || log.status}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--mx-ink)" }}>
                        {log.costPoints > 0 ? formatNumber(log.costPoints) : "免费"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p style={{ marginTop: 14, fontSize: 11, color: "var(--mx-muted)", lineHeight: 1.6 }}>
            套餐和积分来自你的 JIUZHANG AI 账号，用量来自本机数据服务的真实调用日志
          </p>
        </div>
      </div>
    );
  }

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

      {/* Token 用量（P1 前端接入：/usage/token） */}
      {tokenQuota && tokenQuota.tokenLimit > 0 ? (
        <V2Section title="Token 用量" description="今日 AI 模型 Token 消耗（每天 0 点重置）">
          <div className="p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--kaypal-v3-soft-ink)]">
                已用 {formatNumber(tokenQuota.tokenCount)} / 上限 {formatNumber(tokenQuota.tokenLimit)}
              </span>
              <span className="font-semibold text-[var(--kaypal-v3-ink)]">
                {tokenQuota.tokenRemaining > 0
                  ? `${Math.min(100, Math.round((tokenQuota.tokenCount / tokenQuota.tokenLimit) * 100))}%`
                  : "已用尽"}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-paper-muted)]">
              <div
                className="h-full rounded-full bg-[var(--kaypal-v3-accent)] transition-all"
                style={{
                  width: `${Math.min(100, Math.round((tokenQuota.tokenCount / tokenQuota.tokenLimit) * 100))}%`,
                }}
              />
            </div>
            <div className="mt-3 flex gap-6 text-xs text-[var(--kaypal-v3-muted)]">
              <span>对话 {formatNumber(tokenQuota.chatCount)}/{formatNumber(tokenQuota.chatLimit)}</span>
              <span>工具 {formatNumber(tokenQuota.toolCount)}/{formatNumber(tokenQuota.toolLimit)}</span>
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
                  <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">{formatSkillName(skill.skillCode)}</p>
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
                      {formatOperation(log.operation)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      {log.method} · {log.latencyMs}ms
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
