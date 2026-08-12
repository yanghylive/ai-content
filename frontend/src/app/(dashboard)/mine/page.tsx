"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { autoUploadApi } from "@/lib/api/auto-upload";
import {
  billingApi,
  entitlementStatusLabel,
  isEntitlementBlocked,
  type BillingStatus,
} from "@/lib/api/billing";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { MobileThemeToggle } from "@/components/shell/mobile-theme-toggle";
import { authApi } from "@/lib/api/auth";
import { isAdminUser } from "@/lib/admin-user";

export default function MineScene() {
  const user = useShellUser();
  const [accountIssue, setAccountIssue] = React.useState(0);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((me) => {
        if (!active) return;
        setIsAdmin(isAdminUser(me));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    autoUploadApi
      .accounts()
      .then((accounts) => {
        if (!active) return;
        setAccountIssue(
          (Array.isArray(accounts) ? accounts : []).filter(
            (a) => !(a.status === 1 || a.sessionStatus === "logged_in"),
          ).length,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (isMobile) {
    return (
      <MobileMineView
        displayName={user?.displayName || "未登录"}
        planLabel={user?.planLabel && !user.planLabel.includes("未同步") ? user.planLabel : "免费版"}
        creditLabel={user?.creditLabel && user.creditLabel !== "未同步" ? user.creditLabel : "—"}
        loggingOut={Boolean(user?.loggingOut)}
        onLogout={user?.onLogout}
        accountIssue={accountIssue}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <ScenePage
      title="我的"
      sub="账号、设备、设置、数据"
      before={
        user ? (
          <div className="kx-todo-card">
            <div className="kx-todo-ico kx-t-violet" style={{ borderRadius: "50%" }}>
              <ShellIcon name="user" size={22} />
            </div>
            <div className="kx-todo-body">
              <div className="kx-todo-title">{user.displayName}</div>
              <div className="kx-todo-desc">
                {user.planLabel} · {user.creditLabel} 积分
              </div>
            </div>
            <button
              className="kx-btn kx-btn-ghost"
              disabled={user.loggingOut}
              onClick={user.onLogout}
            >
              {user.loggingOut ? "正在退出..." : "退出登录"}
            </button>
          </div>
        ) : undefined
      }
      cards={[
        {
          icon: "phone",
          tint: "kx-t-green",
          title: "平台账号",
          desc: "抖音、小红书等账号的登录状态",
          href: "/platforms",
          badge: accountIssue > 0 ? `${accountIssue} 失效` : undefined,
          group: "账号与设置",
        },
        {
          icon: "database",
          tint: "kx-t-green",
          title: "多账号矩阵",
          desc: "各平台账号 · 多选分发",
          href: "/accounts-matrix",
          group: "账号与设置",
        },
        {
          icon: "users",
          tint: "kx-t-rose",
          title: "账号与团队",
          desc: "个人资料、成员权限、版本更新",
          href: "/capabilities/account",
          group: "账号与设置",
        },
        {
          icon: "settings",
          tint: "kx-t-slate",
          title: "设置",
          desc: "AI 服务、内容来源、存储、通知",
          href: "/settings",
          group: "账号与设置",
        },
        {
          icon: "layers",
          tint: "kx-t-blue",
          title: "记忆设置",
          desc: "长期记忆、画像与偏好",
          href: "/settings/memory",
          group: "账号与设置",
        },
        {
          icon: "file",
          tint: "kx-t-cyan",
          title: "用量与费用",
          desc: "积分用量、费用明细、结果留存",
          href: "/intelligence/costs",
          group: "账号与设置",
        },
        {
          icon: "cpu",
          tint: "kx-t-amber",
          title: "设备状态",
          desc: "设备服务、微信桌面、运行检查",
          href: "/local-engine",
          group: "系统与服务",
        },
        {
          icon: "grid",
          tint: "kx-t-blue",
          title: "应用与安装",
          desc: "开通更多能力（CRM 等）",
          href: "/apps",
          group: "系统与服务",
        },
        {
          icon: "bot",
          tint: "kx-t-violet",
          title: "Agent 对话",
          desc: "Agent 会话工作台（对话规划助手）",
          href: "/agent-conversation",
          group: "系统与服务",
        },
        {
          icon: "checkCircle",
          tint: "kx-t-green",
          title: "任务证据",
          desc: "执行证据与留痕",
          href: "/task-evidence",
          group: "系统与服务",
        },
        {
          icon: "clipboard",
          tint: "kx-t-slate",
          title: "引擎权限",
          desc: "本地引擎权限管理",
          href: "/local-engine/permissions",
          group: "系统与服务",
        },
        {
          icon: "archive",
          tint: "kx-t-slate",
          title: "AI 工件",
          desc: "AI 生成的工件产物",
          href: "/artifacts",
          group: "系统与服务",
        },
        ...(isAdmin
          ? [
              {
                icon: "settings" as const,
                tint: "kx-t-slate",
                title: "数据服务管理",
                desc: "数据源连接与配额配置",
                href: "/admin/redfox",
                group: "系统与服务",
              },
            ]
          : []),
      ]}
    />
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

const MOBILE_MINE_MENU: Array<{
  label: string;
  desc: string;
  icon: React.ComponentProps<typeof ShellIcon>["name"];
  tint: string;
  href: string;
  badge?: string;
}> = [
  { label: "客户管理", desc: "客户列表与跟进", icon: "users", tint: "#2563eb", href: "/customer" },
  { label: "多账号矩阵", desc: "各平台账号 · 多选分发", icon: "database", tint: "#059669", href: "/accounts-matrix" },
  { label: "设置", desc: "AI 服务、存储、通知", icon: "settings", tint: "#64748b", href: "/settings" },
  { label: "用量与费用", desc: "积分用量、费用明细", icon: "chart", tint: "#a9671f", href: "/intelligence/costs" },
  { label: "账号与团队", desc: "资料、成员、版本", icon: "users", tint: "#7c3aed", href: "/capabilities/account" },
  { label: "手机端能力", desc: "手机能做什么 · 边界说明", icon: "phone", tint: "#0891b2", href: "/mobile-capabilities" },
];

/** 更多功能（补齐移动端无入口的能力域，2026-08-10） */
const MOBILE_MORE_MENU: Array<{
  group: string;
  items: Array<{
    label: string;
    desc: string;
    icon: React.ComponentProps<typeof ShellIcon>["name"];
    tint: string;
    href: string;
  }>;
}> = [
  {
    group: "客户与增长",
    items: [
      { label: "企业微信 CRM", desc: "企微客户与跟进", icon: "briefcase", tint: "#0e8a5f", href: "/wecom-crm" },
      { label: "BOSS 招聘", desc: "招聘线索与跟进", icon: "target", tint: "#0b72c7", href: "/boss-recruit" },
      { label: "增长报告", desc: "获客效果汇总", icon: "chart", tint: "#2e7d32", href: "/growth/reports" },
      { label: "增长工作流", desc: "自动获客流程编排", icon: "cpu", tint: "#7c3aed", href: "/growth/workflows" },
      { label: "账号健康", desc: "账号状态与健康度", icon: "bulb", tint: "#d97706", href: "/growth/account-health" },
    ],
  },
  {
    group: "系统与情报",
    items: [
      { label: "情报监控", desc: "行业情报实时监控", icon: "target", tint: "#7c3aed", href: "/intelligence/monitors" },
      { label: "商业就绪", desc: "上线能力自检", icon: "rocket", tint: "#c2410c", href: "/commercial-readiness" },
      { label: "合规检查", desc: "内容合规校验", icon: "checkCircle", tint: "#059669", href: "/compliance-check" },
      { label: "趋势雷达", desc: "行业趋势实时雷达", icon: "target", tint: "#d97706", href: "/intelligence/trends-radar" },
      { label: "情报报告", desc: "情报分析与报告", icon: "chart", tint: "#0891b2", href: "/intelligence/report-new" },
    ],
  },
  {
    group: "更多能力",
    items: [
      { label: "Agent 对话", desc: "Agent 会话工作台", icon: "bot", tint: "#7c3aed", href: "/agent-conversation" },
      { label: "记忆设置", desc: "长期记忆、画像与偏好", icon: "layers", tint: "#2563eb", href: "/settings/memory" },
      { label: "任务证据", desc: "执行证据与留痕", icon: "checkCircle", tint: "#059669", href: "/task-evidence" },
      { label: "引擎权限", desc: "本地引擎权限管理", icon: "clipboard", tint: "#64748b", href: "/local-engine/permissions" },
      { label: "AI 工件", desc: "AI 生成的工件产物", icon: "archive", tint: "#64748b", href: "/artifacts" },
    ],
  },
];

function MobileMineView({
  displayName,
  planLabel,
  creditLabel,
  loggingOut,
  onLogout,
  accountIssue,
  isAdmin,
}: {
  displayName: string;
  planLabel: string;
  creditLabel: string;
  loggingOut: boolean;
  onLogout?: () => void;
  accountIssue: number;
  isAdmin: boolean;
}) {
  // B2 权益/额度状态（移动端展示权益 + 解冻引导）
  const [billing, setBilling] = React.useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = React.useState(true);
  // PWA 安装入口（PRD 10.16）：仅当浏览器支持并满足安装条件时显示
  const [installPrompt, setInstallPrompt] = React.useState<{ prompt: () => Promise<void> } | null>(null);

  React.useEffect(() => {
    // B2：拉取权益状态（冻结/逾期/过期时发布采集会失败，需提示）
    billingApi
      .status()
      .then((s) => setBilling(s))
      .catch(() => undefined)
      .finally(() => setBillingLoading(false));
  }, []);

  React.useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as unknown as { prompt: () => Promise<void> };
      if (typeof promptEvent?.prompt === "function") {
        setInstallPrompt(promptEvent);
      }
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const menu = [...MOBILE_MINE_MENU];
  // 管理员专属:数据服务管理(数据源运维入口,普通用户不可见)
  const moreGroups = React.useMemo(() => {
    if (!isAdmin) return MOBILE_MORE_MENU;
    return MOBILE_MORE_MENU.map((g) =>
      g.group === "更多能力"
        ? {
            ...g,
            items: [
              ...g.items,
              {
                label: "数据服务管理",
                desc: "数据源连接与配额配置",
                icon: "settings" as const,
                tint: "#64748b",
                href: "/admin/redfox",
              },
            ],
          }
        : g,
    );
  }, [isAdmin]);
  // 多账号矩阵项带失效角标
  const platformIndex = menu.findIndex((m) => m.label === "多账号矩阵");
  if (platformIndex >= 0 && accountIssue > 0) {
    menu[platformIndex] = {
      ...menu[platformIndex],
      badge: `${accountIssue} 失效`,
    };
  }

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
            <h1 className="mx-page-title">我的</h1>
            <p className="mx-page-sub">账户 · 套餐 · 设置</p>
          </div>
        </div>
      </header>

      {/* 个人资料 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 58, height: 58, borderRadius: 999, flexShrink: 0,
                background: "linear-gradient(135deg, #1e4e8c, #2f6db4)",
                color: "#fff", fontSize: 20, fontWeight: 700,
              }}
            >
              {displayName.slice(0, 1)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 17, fontWeight: 700, color: "var(--mx-ink)" }}>{displayName}</span>
                <span
                  className="mx-badge mx-badge-gold"
                  style={{ padding: "1px 7px", fontSize: 9, borderRadius: 999 }}
                >
                  {planLabel}
                </span>
                {planLabel === "免费版" ? (
                  <a
                    href="/settings"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#a9671f",
                      padding: "1px 8px",
                      borderRadius: 999,
                      border: "1px solid rgba(222,150,57,.35)",
                      background: "rgba(234,161,75,.12)",
                      textDecoration: "none",
                      flexShrink: 0,
                    }}
                  >
                    升级 Pro
                  </a>
                ) : null}
              </div>
              <p style={{ marginTop: 4, fontSize: 12, color: "var(--mx-muted)" }}>{creditLabel}</p>
            </div>
            {onLogout ? (
              <button
                type="button"
                className="mx-btn-gold"
                style={{ fontSize: 11, padding: "7px 12px", background: "rgba(239,68,68,.1)", color: "#dc2626", border: "1px solid rgba(239,68,68,.25)", boxShadow: "none", backgroundImage: "none" }}
                disabled={loggingOut}
                onClick={onLogout}
              >
                {loggingOut ? "退出中…" : "退出"}
              </button>
            ) : null}
          </div>
        </div>

        {/* B2 权益/额度状态：冻结/逾期/过期时明确提示 + 解冻引导（发布/采集会被云端拒绝） */}
        {billingLoading && !billing ? (
          <div className="mx-card" style={{ marginTop: 10, padding: 14 }}>
            <div className="mx-skeleton-row"><div className="mx-skeleton-line" style={{ width: "40%", height: 12 }} /></div>
            <div className="mx-skeleton-row"><div className="mx-skeleton-line-sm" style={{ width: "70%" }} /></div>
          </div>
        ) : null}
        {billing?.entitlement ? (
          (() => {
            const status = billing.entitlement.status;
            const blocked = isEntitlementBlocked(status);
            const periodEnd = billing.entitlement.periodEnd;
            return (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 14,
                  border: blocked
                    ? "1px solid rgba(239,68,68,.3)"
                    : "1px solid rgba(16,185,129,.2)",
                  background: blocked
                    ? "rgba(239,68,68,.06)"
                    : "rgba(16,185,129,.05)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--mx-ink)" }}>
                    权益状态
                  </span>
                  <span
                    className="mx-badge"
                    style={{
                      fontSize: 10,
                      padding: "1px 7px",
                      borderRadius: 999,
                      color: blocked ? "#dc2626" : "#059669",
                      background: blocked
                        ? "rgba(239,68,68,.12)"
                        : "rgba(16,185,129,.12)",
                    }}
                  >
                    {entitlementStatusLabel(status)}
                  </span>
                  {periodEnd ? (
                    <span style={{ fontSize: 10, color: "var(--mx-muted)", marginLeft: "auto" }}>
                      到期 {periodEnd.slice(0, 10)}
                    </span>
                  ) : null}
                </div>
                {blocked ? (
                  <p style={{ fontSize: 11, color: "#dc2626", margin: "6px 0 0", lineHeight: 1.5 }}>
                    ⚠️ 额度受限期间，发布与采集可能失败。请尽快解冻：
                    <a
                      href="/settings"
                      style={{ color: "#dc2626", fontWeight: 700, textDecoration: "underline" }}
                    >
                      去查看与续费 →
                    </a>
                  </p>
                ) : (
                  <p style={{ fontSize: 11, color: "#059669", margin: "6px 0 0" }}>
                    {billing.entitlement.plan === "FREE"
                      ? "当前免费方案：发布/采集入口可用（商用执行需升级 Pro）"
                      : "权益正常，可正常发布与采集"}
                  </p>
                )}
              </div>
            );
          })()
        ) : null}
      </section>

      {/* 套餐额度 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-hero" style={{ borderRadius: 22, padding: 16 }}>
          <div className="mx-hero-ring" style={{ width: 110, height: 110, top: -30, right: -22 }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 12, color: "rgba(219,234,254,.72)" }}>当前套餐</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{planLabel}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mx-gold-text" style={{ fontSize: 18, fontWeight: 800 }}>{creditLabel}</div>
                <div style={{ fontSize: 10, color: "rgba(219,234,254,.6)" }}>可用积分</div>
              </div>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ marginTop: 14, fontSize: 12, padding: "8px 14px", textDecoration: "none" }}
              onClick={() => { window.location.href = "/intelligence/costs"; }}
            >
              查看用量与费用
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* 安装到桌面（PWA，仅浏览器支持时显示） */}
      {installPrompt ? (
        <section className="mx-px mx-mt-lg">
          <div className="mx-hero" style={{ borderRadius: 22, padding: 16 }}>
            <div className="mx-hero-ring" style={{ width: 90, height: 90, top: -26, right: -18 }} />
            <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: 13, flexShrink: 0, background: "rgba(255,255,255,.14)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#f4bb67" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M8 21h8" /></svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>安装到桌面</p>
                <p style={{ fontSize: 11, color: "rgba(219,234,254,.72)", marginTop: 2 }}>像 App 一样使用 JIUZHANG AI</p>
              </div>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ fontSize: 12, padding: "9px 14px", flexShrink: 0 }}
                onClick={() => {
                  void installPrompt.prompt();
                  setInstallPrompt(null);
                }}
              >
                安装
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 功能列表（含外观/主题切换，共卡更紧凑） */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-card mx-list-card">
          <MobileThemeToggle />
          {menu.map((item) => (
            <button
              key={item.label}
              type="button"
              className="mx-row"
              style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
              onClick={() => { window.location.href = item.href; }}
            >
              <span
                className="mx-row-ic"
                style={{
                  background: `${item.tint}1f`,
                  color: item.tint,
                }}
              >
                <ShellIcon name={item.icon} size={18} />
              </span>
              <div className="mx-row-main">
                <div className="mx-row-title">{item.label}</div>
                <div className="mx-row-desc">{item.desc}</div>
              </div>
              <div className="mx-row-right">
                {item.badge ? <span className="mx-badge mx-badge-red">{item.badge}</span> : null}
                <svg className="mx-chev" viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 更多功能（补齐移动端无入口的能力域，2026-08-10） */}
      {moreGroups.map((g) => (
        <section key={g.group} className="mx-px mx-mt-lg" style={{ paddingBottom: g === MOBILE_MORE_MENU[MOBILE_MORE_MENU.length - 1] ? 28 : 0 }}>
          <div className="mx-section-eyebrow" style={{ marginBottom: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>
            {g.group}
          </div>
          <div className="mx-card mx-list-card">
            {g.items.map((item) => (
              <button
                key={item.href}
                type="button"
                className="mx-row"
                style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                onClick={() => { window.location.href = item.href; }}
              >
                <span className="mx-row-ic" style={{ background: `${item.tint}1f`, color: item.tint }}>
                  <ShellIcon name={item.icon} size={18} />
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">{item.label}</div>
                  <div className="mx-row-desc">{item.desc}</div>
                </div>
                <div className="mx-row-right">
                  <svg className="mx-chev" viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
