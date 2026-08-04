"use client";

import React from "react";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { autoUploadApi } from "@/lib/api/auto-upload";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function MineScene() {
  const user = useShellUser();
  const [accountIssue, setAccountIssue] = React.useState(0);
  const isMobile = useIsMobile();

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
        planLabel={user?.planLabel || "未同步套餐"}
        creditLabel={user?.creditLabel || "0"}
        loggingOut={Boolean(user?.loggingOut)}
        onLogout={user?.onLogout}
        accountIssue={accountIssue}
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
          tint: "kx-t-blue",
          title: "平台账号",
          desc: "抖音、小红书等账号的登录状态",
          href: "/platforms",
          badge: accountIssue > 0 ? `${accountIssue} 失效` : undefined,
        },
        {
          icon: "cpu",
          tint: "kx-t-slate",
          title: "设备状态",
          desc: "设备服务、微信桌面、运行检查",
          href: "/local-engine",
        },
        {
          icon: "grid",
          tint: "kx-t-violet",
          title: "应用与安装",
          desc: "开通更多能力（CRM、语音助手等）",
          href: "/apps",
        },
        {
          icon: "settings",
          tint: "kx-t-slate",
          title: "设置",
          desc: "AI 服务、内容来源、存储、通知",
          href: "/settings",
        },
        {
          icon: "mic",
          tint: "kx-t-violet",
          title: "语音控制台",
          desc: "白龙马语音助手，用声音控制整个系统",
          href: "/admin/voice-agent",
        },
        {
          icon: "file",
          tint: "kx-t-amber",
          title: "用量与费用",
          desc: "积分用量、费用明细、结果留存",
          href: "/intelligence/costs",
        },
        {
          icon: "users",
          tint: "kx-t-cyan",
          title: "账号与团队",
          desc: "个人资料、成员权限、版本更新",
          href: "/capabilities/account",
        },
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
  { label: "平台账号", desc: "各平台登录状态", icon: "database", tint: "#059669", href: "/platforms" },
  { label: "设置", desc: "AI 服务、存储、通知", icon: "settings", tint: "#64748b", href: "/settings" },
  { label: "用量与费用", desc: "积分用量、费用明细", icon: "chart", tint: "#a9671f", href: "/intelligence/costs" },
  { label: "账号与团队", desc: "资料、成员、版本", icon: "users", tint: "#7c3aed", href: "/capabilities/account" },
];

function MobileMineView({
  displayName,
  planLabel,
  creditLabel,
  loggingOut,
  onLogout,
  accountIssue,
}: {
  displayName: string;
  planLabel: string;
  creditLabel: string;
  loggingOut: boolean;
  onLogout?: () => void;
  accountIssue: number;
}) {
  // PWA 安装入口（PRD 10.16）：仅当浏览器支持并满足安装条件时显示
  const [installPrompt, setInstallPrompt] = React.useState<{ prompt: () => Promise<void> } | null>(null);

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
  // 平台账号项带失效角标
  const platformIndex = menu.findIndex((m) => m.label === "平台账号");
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
                <span style={{ fontSize: 17, fontWeight: 700, color: "#17325b" }}>{displayName}</span>
                <span className="mx-badge mx-badge-gold">{planLabel}</span>
              </div>
              <p style={{ marginTop: 4, fontSize: 12, color: "#7f8b9c" }}>{creditLabel}</p>
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

      {/* 功能列表 */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-card mx-list-card">
          {menu.map((item) => (
            <button
              key={item.label}
              type="button"
              className="mx-row"
              style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
              onClick={() => { window.location.href = item.href; }}
            >
              <span className="mx-row-ic" style={{ background: "rgba(233,240,250,.75)", color: item.tint }}>
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
    </div>
  );
}
