"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadAccountHealth,
} from "@/lib/api/auto-upload";
import {
  PLATFORM_LABEL,
  openApp,
  type PlatformKey,
} from "@/lib/mobile-bridge";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { CountUpNumber } from "@/components/count-up-number";
import { Avatar } from "@/components/avatar";
import { PlatformBadge } from "@/components/platform-badge";
import styles from "./accounts-matrix.module.css";
import { toActionableError } from "@/lib/public-error";

/** 账号平台 key（douyin/wechat-channel 等）→ mobile-bridge 平台 key */
const toBridgeKey = (platform: string): PlatformKey => {
  const map: Record<string, PlatformKey> = {
    douyin: "douyin",
    xiaohongshu: "xiaohongshu",
    "wechat-channel": "shipinhao",
    wechat: "shipinhao",
    kuaishou: "kuaishou",
    bilibili: "bilibili",
    weibo: "weibo",
    zhihu: "zhihu",
    toutiao: "toutiao",
    "wechat-official": "gongzhonghao",
  };
  return map[platform] ?? "douyin";
};

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
  douyin: "var(--kaypal-v3-ink)",
  xiaohongshu: "var(--kaypal-v3-danger)",
  "wechat-channel": "var(--kaypal-v3-success)",
  wechat: "var(--kaypal-v3-success)",
  kuaishou: "var(--kaypal-v3-amber)",
  bilibili: "var(--kaypal-v3-cobalt)",
  weibo: "var(--kaypal-v3-danger)",
  zhihu: "var(--kaypal-v3-cobalt)",
  toutiao: "var(--kaypal-v3-cobalt)",
  "wechat-official": "var(--kaypal-v3-success)",
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  logged_in: { label: "已登录", color: "var(--kaypal-v3-success)" },
  needs_login: { label: "需登录", color: "var(--kaypal-v3-amber)" },
  error: { label: "需处理", color: "var(--kaypal-v3-danger)" },
  unknown: { label: "未知", color: "var(--kaypal-v3-muted)" },
};

/**
 * 把后端技术错误码翻译成用户能看懂的提示。
 * 后端在浏览器 Runtime 未就绪时会把所有账号打成 `browser_session_blocked`，
 * 直接展示会暴露内部术语、引发"全废了"的误判。
 */
const SESSION_REASON_TEXT: Record<string, string> = {
  browser_session_blocked:
    "浏览器登录态失效，请在手机打开对应平台 App 重新登录后重试",
  browser_session_needs_login: "登录已过期，需要在平台 App 中重新登录",
  browser_session_ready: "已就绪",
  browser_session_unknown: "状态未知，请点击「重新校验」",
};

function translateSessionReason(reason?: string | null): string {
  if (!reason) return "账号状态异常，请重新校验";
  if (SESSION_REASON_TEXT[reason]) return SESSION_REASON_TEXT[reason];
  if (reason.startsWith("browser_session_")) {
    return "登录态异常，请在手机对应平台 App 中重新登录";
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
  const [mobileMsg, setMobileMsg] = useState("");

  const launchAppForAccount = useCallback((platform: string) => {
    const key = toBridgeKey(platform);
    const result = openApp(key);
    setMobileMsg(`${PLATFORM_LABEL[key]}：${result.message}`);
    window.setTimeout(() => setMobileMsg(""), 3200);
  }, []);

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
      setError(toActionableError(e, "账号加载失败"));
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
    <div className={styles.page}>
      <V2BackButton />
      {/* 页面头 */}
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">多账号矩阵</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">各平台账号 · 发布时多选即可矩阵分发</p>
        </div>
        <button
          type="button"
          className="kx-btn-primary px-4 py-2 text-13"
          disabled={validating}
          onClick={() => void revalidate()}
        >
          {validating ? "校验中…" : "重新校验"}
        </button>
      </div>

      {/* 统计 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-stat-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num"><CountUpNumber value={stats.total} /></div><div className="mx-stat-label">账号总数</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text"><CountUpNumber value={stats.loggedIn} /></div><div className="mx-stat-label">已登录</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: stats.needsLogin > 0 ? "var(--kaypal-v3-danger)" : "var(--kaypal-v3-success)" }}><CountUpNumber value={stats.needsLogin} /></div><div className="mx-stat-label">需处理</div></div>
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
            <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push("/distribution/accounts")}>
              去添加账号
            </button>
          </div>
        ) : (
          grouped.map(([platform, items]) => {
            const color = PLATFORM_COLORS[platform] ?? "var(--kaypal-v3-muted)";
            return (
              <div key={platform} className="mx-card" style={{ padding: 0, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <PlatformBadge platform={platform} size={26} solid />
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
                          background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                          color: meta.color,
                          overflow: "hidden",
                          borderRadius: 12,
                        }}
                      >
                        <Avatar
                          src={account.avatarUrl}
                          name={displayAccountName(account, index)}
                          size={36}
                          alt={account.profileName || account.userName || "账号"}
                          radius={12}
                          color={meta.color}
                        />
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
                              登录已过期，需要重新登录
                              <div style={{ fontSize: 11, color: "rgba(219,234,254,.5)", marginTop: 2 }}>
                                请在手机打开{PLATFORM_NAMES[account.platformKey ?? account.platform] ?? "平台"} App 重新登录
                                <button
                                  type="button"
                                  onClick={() => launchAppForAccount(account.platformKey ?? account.platform)}
                                  style={{ marginLeft: 6, fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(244,187,103,.15)", border: "1px solid rgba(244,187,103,.5)", color: "var(--kaypal-v3-amber)" }}
                                >
                                  去登录
                                </button>
                              </div>
                            </>
                          ) : account.sessionStatus === "error" ? (
                            <>
                              {translateSessionReason(account.lastDispatchReason)}
                              <div style={{ fontSize: 11, color: "rgba(219,234,254,.5)", marginTop: 2 }}>
                                需在手机{PLATFORM_NAMES[account.platformKey ?? account.platform] ?? "平台"} App 中处理
                                <button
                                  type="button"
                                  onClick={() => launchAppForAccount(account.platformKey ?? account.platform)}
                                  style={{ marginLeft: 6, fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(244,187,103,.15)", border: "1px solid rgba(244,187,103,.5)", color: "var(--kaypal-v3-amber)" }}
                                >
                                  去处理
                                </button>
                              </div>
                            </>
                          ) : (
                            account.statusLabel || "状态未知"
                          )}
                        </div>
                      </div>
                      <div className="mx-row-right">
                        <span className="mx-badge" style={{ background: `color-mix(in srgb, ${meta.color} 13%, transparent)`, color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 33%, transparent)` }}>
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
              ⚠️ {stats.needsLogin} 个账号需处理：在手机对应平台 App 中完成登录后，回到这里点「重新校验」。
              <button
                type="button"
                onClick={() => launchAppForAccount("douyin")}
                style={{ display: "block", marginTop: 8, fontSize: 12, padding: "7px 14px", borderRadius: 999, background: "rgba(244,187,103,.15)", border: "1px solid rgba(244,187,103,.5)", color: "var(--kaypal-v3-amber)" }}
              >
                调起平台 App 登录
              </button>
            </div>
          </div>
        ) : null}
        {mobileMsg && (
          <div className="mx-card" style={{ padding: 10, marginBottom: 12, fontSize: 12, color: "#34d399" }}>
            {mobileMsg}
          </div>
        )}
        <div className="mx-card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(219,234,254,.62)" }}>
            💡 发布时在「选账号」步骤可多选同平台账号（如抖音账号 A + B），一次内容矩阵分发到多个账号。
          </div>
        </div>
      </section>
    </div>
  );
}
