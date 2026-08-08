"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadAccountHealth,
} from "@/lib/api/auto-upload";

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  wechat: "微信",
  kuaishou: "快手",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  toutiao: "头条",
  "wechat-official": "公众号",
};

const PLATFORM_COLORS: Record<string, string> = {
  douyin: "#111827",
  xiaohongshu: "#ef4444",
  "wechat-channel": "#059669",
  wechat: "#059669",
  kuaishou: "#d97706",
  bilibili: "#3b82f6",
  weibo: "#dc2626",
  zhihu: "#2563eb",
  toutiao: "#1d4ed8",
  "wechat-official": "#059669",
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  logged_in: { label: "已登录", color: "#059669" },
  needs_login: { label: "需登录", color: "#d98a2d" },
  error: { label: "需处理", color: "#dc2626" },
  unknown: { label: "未知", color: "#94a3b8" },
};

/**
 * 把后端技术错误码翻译成用户能看懂的提示。
 * 后端在浏览器 Runtime 未就绪时会把所有账号打成 `browser_session_blocked`，
 * 直接展示会暴露内部术语、引发"全废了"的误判。
 */
const SESSION_REASON_TEXT: Record<string, string> = {
  browser_session_blocked: "浏览器登录态失效，请在电脑端完成扫码登录后重试",
  browser_session_needs_login: "登录已过期，需要重新扫码",
  browser_session_ready: "已就绪",
  browser_session_unknown: "状态未知，请点击「重新校验」",
};

function translateSessionReason(reason?: string | null): string {
  if (!reason) return "账号状态异常，请重新校验";
  if (SESSION_REASON_TEXT[reason]) return SESSION_REASON_TEXT[reason];
  if (reason.startsWith("browser_session_")) {
    return "浏览器登录态异常，请在电脑端重新扫码登录";
  }
  return reason;
}

function platformName(account: AutoUploadAccount): string {
  return (
    PLATFORM_NAMES[account.platformKey ?? account.platform] ??
    account.platform ??
    `平台 ${account.type}`
  );
}

/**
 * 账号名展示：名字为空/null/单字占位时，用「平台 + 序号」兜底，
 * 避免列表里出现空名或占位字符。
 */
function displayAccountName(account: AutoUploadAccount, index: number): string {
  const name = (account.profileName || account.userName || "").trim();
  if (name.length >= 2) return name;
  return `${platformName(account)}账号 #${index + 1}`;
}

export default function AccountsMatrixV2Page() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AutoUploadAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [health, setHealth] = useState<AutoUploadAccountHealth | null>(null);

  const load = useCallback(async (validate = false) => {
    setLoading(true);
    try {
      // 列表消费 DB 状态（不触发 validate 副作用路径——移动端/无浏览器环境
      // validate 会把账号误判为 expired）
      const result = await autoUploadApi.accounts({
        validate: false,
        force: false,
      });
      setAccounts(Array.isArray(result) ? result : []);
      // 汇总消费 health（真实登录态检测：readyAccounts/expiredAccounts）
      if (validate) {
        const h = await autoUploadApi
          .accountHealth({ validate: false })
          .catch(() => null);
        if (h) setHealth(h);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "账号加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, AutoUploadAccount[]>();
    for (const account of accounts) {
      const key = platformName(account);
      const list = map.get(key) ?? [];
      list.push(account);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [accounts]);

  const stats = useMemo(() => {
    // 汇总以 health（真实检测）为准；列表总数兜底
    return {
      total: health?.totalAccounts ?? accounts.length,
      loggedIn: health?.readyAccounts ?? accounts.filter(
        (a) => a.sessionStatus === "logged_in",
      ).length,
      needsLogin: health?.expiredAccounts ?? accounts.filter(
        (a) =>
          a.sessionStatus === "needs_login" || a.sessionStatus === "error",
      ).length,
      platforms: grouped.length,
    };
  }, [accounts, grouped, health]);

  const revalidate = useCallback(async () => {
    setValidating(true);
    try {
      // 只刷新 health 真实检测 + 列表（不再触发 validate 副作用）
      await load(true);
    } finally {
      setValidating(false);
    }
  }, [load]);

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">多账号矩阵</h1>
            <p className="mx-page-sub">各平台账号 · 发布时多选即可矩阵分发</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none" }}
            disabled={validating}
            onClick={() => void revalidate()}
          >
            {validating ? "校验中…" : "重新校验"}
          </button>
        </div>
      </header>

      {/* 统计 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{stats.total}</div><div className="mx-stat-label">账号总数</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text">{stats.loggedIn}</div><div className="mx-stat-label">已登录</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: stats.needsLogin > 0 ? "#dc2626" : "#059669" }}>{stats.needsLogin}</div><div className="mx-stat-label">需处理</div></div>
        </div>
      </section>

      {error ? (
        <section className="mx-px" style={{ marginTop: 14 }}>
          <div className="mx-card" style={{ padding: 14, border: "1px solid rgba(220,38,38,.4)" }}>
            <div style={{ fontSize: 13, color: "#f87171" }}>{error}</div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ marginTop: 10, fontSize: 12, padding: "7px 14px" }}
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        </section>
      ) : null}

      {/* 按平台分组 */}
      <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
        {loading ? (
          <div className="mx-card mx-list-card">
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "55%" }} /></div></div>
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /></div></div>
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "48%" }} /></div></div>
          </div>
        ) : grouped.length === 0 ? (
          <div className="mx-empty">
            <p>还没有接入任何平台账号</p>
            <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/platforms")}>
              去添加账号
            </button>
          </div>
        ) : (
          grouped.map(([platform, items]) => {
            const color = PLATFORM_COLORS[platform] ?? "#64748b";
            return (
              <div key={platform} className="mx-card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <span className="platform-dot" style={{ background: color, width: 8, height: 8, borderRadius: 999, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{platform}</span>
                  <span style={{ fontSize: 11, color: "rgba(219,234,254,.55)", marginLeft: "auto" }}>
                    {items.length} 个账号
                  </span>
                </div>
                {items.map((account, index) => {
                  const meta = STATUS_META[account.sessionStatus ?? "unknown"] ?? STATUS_META.unknown;
                  return (
                    <div className="mx-row" key={account.id} style={{ alignItems: "center" }}>
                      <span
                        className="mx-row-ic"
                        style={{
                          background: `${meta.color}1f`,
                          color: meta.color,
                          overflow: "hidden",
                          borderRadius: 12,
                        }}
                      >
                        {account.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 静态导出无法用 next/image 优化
                          <img
                            src={account.avatarUrl}
                            alt={account.profileName || account.userName || "账号"}
                            style={{ width: 36, height: 36, objectFit: "cover" }}
                          />
                        ) : (
                          displayAccountName(account, index).slice(0, 1)
                        )}
                      </span>
                      <div className="mx-row-main">
                        <div className="mx-row-title" style={{ fontSize: 13.5 }}>
                          {displayAccountName(account, index)}
                        </div>
                        <div className="mx-row-desc">
                          {account.sessionStatus === "logged_in" ? (
                            <>
                              {account.lastDispatchAt
                                ? `最近发布 ${account.lastDispatchAt.slice(0, 10)}`
                                : "已登录，可发布"}
                              {account.lastDispatchOk === false ? " · 上次失败" : ""}
                            </>
                          ) : account.sessionStatus === "needs_login" ? (
                            <>
                              登录已过期，需要重新扫码
                              <div style={{ fontSize: 11, color: "rgba(219,234,254,.5)", marginTop: 2 }}>
                                请在电脑端打开 JIUZHANG AI 重新扫码
                              </div>
                            </>
                          ) : account.sessionStatus === "error" ? (
                            <>
                              {translateSessionReason(account.lastDispatchReason)}
                              <div style={{ fontSize: 11, color: "rgba(219,234,254,.5)", marginTop: 2 }}>
                                需电脑端处理，请在电脑端打开 JIUZHANG AI
                              </div>
                            </>
                          ) : (
                            account.statusLabel || "状态未知"
                          )}
                        </div>
                      </div>
                      <div className="mx-row-right">
                        <span className="mx-badge" style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}>
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </section>

      {/* 底部说明 */}
      <section className="mx-px" style={{ paddingBottom: 28 }}>
        {stats.needsLogin > 0 ? (
          <div className="mx-card" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(251,191,36,.85)" }}>
              ⚠️ {stats.needsLogin} 个账号需处理：重新扫码依赖电脑端浏览器引擎，请在电脑端打开 JIUZHANG AI 完成扫码登录后，回到这里点「重新校验」。
            </div>
          </div>
        ) : null}
        <div className="mx-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(219,234,254,.62)" }}>
            💡 发布时在「选账号」步骤可多选同平台账号（如抖音账号 A + B），一次内容矩阵分发到多个账号。
          </div>
        </div>
      </section>
    </div>
  );
}
