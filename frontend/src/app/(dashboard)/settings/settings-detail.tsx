"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Database,
  Download,
  KeyRound,
  Lock,
  MonitorCog,
  Save,
  Shield,
  User,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2PrimaryButton,
  V2GhostButton,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { SettingsIntegrations } from "./settings-integrations";
import { DesktopSettings } from "./desktop-settings";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useWebPush } from "@/lib/hooks/use-web-push";

export function SettingsDetail() {
  const router = useRouter();
  const [saving] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const saved = Number(window.localStorage.getItem("jiuzhang.fontScale") || "1");
      return saved >= 1 && saved <= 1.5 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState({ name: "", email: "" });
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [notifications, setNotifications] = useState({
    taskDone: true,
    taskFailed: true,
    newLead: true,
    dailyReport: false,
  });

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  };

  const NOT_READY = "保存接口还没开放（后端开发中），已列入需求清单";
  const handleSaveProfile = () => {
    flash(NOT_READY);
  };

  const handleChangePassword = async () => {
    if (!passwords.current || passwords.next.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    flash(NOT_READY);
  };

  const handleSaveNotifications = () => {
    flash(NOT_READY);
  };

  const notifItems = [
    { key: "taskDone" as const, label: "任务完成时通知我" },
    { key: "taskFailed" as const, label: "任务失败时通知我" },
    { key: "newLead" as const, label: "有新客户线索时通知我" },
    { key: "dailyReport" as const, label: "每天发我一份数据日报" },
  ];

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  const webPush = useWebPush();
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#16335d", flexShrink: 0 }} onClick={() => router.push("/")}>
              <ArrowLeft width={18} height={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="mx-page-title" style={{ fontSize: 22 }}>设置</h1>
              <p className="mx-page-sub">账号、通知、数据，都在这一个页面管好</p>
            </div>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          {message && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(16,185,129,.1)", fontSize: 12, color: "#047857" }}>{message}</div>
          )}
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "#dc2626" }}>{error}</div>
          )}

          {/* 个人资料 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><User /></span>
              个人资料
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 6 }}>昵称</p>
              <input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} placeholder="你的名字" style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid rgba(148,163,184,.35)", outline: "none", background: "rgba(255,255,255,.7)", color: "#203454" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 6 }}>登录邮箱</p>
              <input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} placeholder="you@example.com" style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid rgba(148,163,184,.35)", outline: "none", background: "rgba(255,255,255,.7)", color: "#203454" }} />
            </div>
            <button type="button" className="mx-btn-gold" style={{ width: "100%", fontSize: 12, padding: "10px 0" }} onClick={handleSaveProfile}>保存</button>
          </div>

          {/* 修改密码 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Lock /></span>
              修改密码
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 6 }}>当前密码</p>
              <input type="password" value={passwords.current} onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid rgba(148,163,184,.35)", outline: "none", background: "rgba(255,255,255,.7)", color: "#203454" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 6 }}>新密码 <span style={{ fontWeight: 400 }}>（至少 8 位）</span></p>
              <input type="password" value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid rgba(148,163,184,.35)", outline: "none", background: "rgba(255,255,255,.7)", color: "#203454" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#8a95a5", marginBottom: 6 }}>再输一遍新密码</p>
              <input type="password" value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid rgba(148,163,184,.35)", outline: "none", background: "rgba(255,255,255,.7)", color: "#203454" }} />
            </div>
            <button type="button" className="mx-btn-gold" style={{ width: "100%", fontSize: 12, padding: "10px 0" }} onClick={handleChangePassword}>修改密码</button>
          </div>

          {/* 显示设置（PRD 16.3 字体放大，无障碍） */}
      <V2Section
        title="显示设置"
        description="调整文字大小（本机保存，仅当前设备生效）"
      >
        <div className="flex gap-2">
          {(
            [
              { key: "1", label: "标准", scale: 1 },
              { key: "1.1", label: "大", scale: 1.1 },
              { key: "1.25", label: "特大", scale: 1.25 },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setFontScale(option.scale);
                try {
                  localStorage.setItem("jiuzhang.fontScale", option.key);
                } catch {
                  /* 隐私模式下忽略 */
                }
                if (typeof document !== "undefined") {
                  document.documentElement.style.zoom = String(option.scale);
                }
              }}
              className={`flex-1 rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2 text-sm font-medium transition ${
                fontScale === option.scale
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                  : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </V2Section>

      {/* 通知设置 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Bell /></span>
              通知设置
            </div>
            {/* Web Push 推送开关（PRD 16.x：移动端 PWA 推送） */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0", borderBottom: "1px solid rgba(142,165,190,.14)" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, color: "#334155" }}>推送通知</p>
                <p style={{ fontSize: 11, color: "#8a95a5", marginTop: 2 }}>
                  {webPush.support === "unsupported" || webPush.support === "insecure"
                    ? "当前浏览器不支持推送（需 HTTPS 环境）"
                    : webPush.support === "denied"
                      ? "通知权限被拒绝，请在浏览器设置中开启"
                      : "任务完成/失败、新客户线索及时提醒"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={webPush.enabled}
                disabled={webPush.busy || webPush.support === "unsupported" || webPush.support === "insecure"}
                onClick={() => {
                  if (webPush.enabled) void webPush.disable();
                  else void webPush.enable();
                }}
                style={{ display: "flex", width: 44, height: 24, borderRadius: 999, padding: 2, alignItems: "center", justifyContent: webPush.enabled ? "flex-end" : "flex-start", background: webPush.enabled ? "linear-gradient(90deg,#e39a3e,#f6c478)" : "rgba(148,163,184,.35)", transition: "all .2s", border: "none", cursor: webPush.busy ? "wait" : "pointer", flexShrink: 0, opacity: webPush.busy ? 0.6 : 1 }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
              </button>
            </div>
            {notifItems.map((item) => (
              <button key={item.key} type="button" role="switch" aria-checked={notifications[item.key]} onClick={() => setNotifications((p) => ({ ...p, [item.key]: !p[item.key] }))} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(142,165,190,.14)" }}>
                <span style={{ fontSize: 13, color: "#334155" }}>{item.label}</span>
                <span style={{ display: "flex", width: 44, height: 24, borderRadius: 999, padding: 2, alignItems: "center", justifyContent: notifications[item.key] ? "flex-end" : "flex-start", background: notifications[item.key] ? "linear-gradient(90deg,#e39a3e,#f6c478)" : "rgba(148,163,184,.35)", transition: "all .2s" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }} />
                </span>
              </button>
            ))}
            <button type="button" className="mx-btn-gold" style={{ width: "100%", fontSize: 12, padding: "10px 0", marginTop: 10 }} onClick={handleSaveNotifications}>保存</button>
          </div>

          {/* 数据管理 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Database /></span>
              数据管理
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#203454" }}>导出全部数据</p>
                <p style={{ fontSize: 11, color: "#8a95a5", marginTop: 2 }}>客户、内容、任务记录打包下载</p>
              </div>
              <button type="button" className="mx-btn-gold" style={{ fontSize: 11, padding: "8px 12px", background: "rgba(255,255,255,.55)", color: "#334155", border: "1px solid rgba(148,163,184,.4)", boxShadow: "none", backgroundImage: "none" }} onClick={() => flash(NOT_READY)}>导出</button>
            </div>
          </div>

          {/* 集成设置 */}
          <SettingsIntegrations />

          {/* 桌面设置（本机应用专属） */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><MonitorCog /></span>
              桌面设置
            </div>
            <DesktopSettings />
          </div>

          {/* 合规中心（2026-08-09：用户协议/隐私/AI 说明/投诉/备案公示） */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Shield /></span>
              合规中心
            </div>
            <button
              type="button"
              className="mx-control"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(142,165,190,.14)" }}
              onClick={() => router.push("/settings/legal")}
            >
              <span style={{ fontSize: 13, color: "#334155" }}>用户协议 · 隐私政策 · AI 说明 · 投诉举报</span>
              <span style={{ fontSize: 13, color: "rgba(148,163,184,.7)" }}>›</span>
            </button>
          </div>

          <button type="button" className="mx-btn-gold" style={{ width: "100%", fontSize: 12, padding: "10px 0", marginTop: 4 }} onClick={() => router.push("/")}>返回首页</button>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="返回"
            title="返回"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              设置
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              账号、通知、数据，都在这一个页面管好
            </p>
          </div>
        </div>
      </section>

      {message && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{message}</p>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 个人资料 */}
      <V2Section
        title="个人资料"
        description="你的昵称和登录邮箱"
        action={
          <V2PrimaryButton
            icon={Save}
            loading={saving === "profile"}
            onClick={handleSaveProfile}
          >
            保存
          </V2PrimaryButton>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <V2Field label="昵称">
            <V2Input
              placeholder="你的名字"
              value={profile.name}
              onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            />
          </V2Field>
          <V2Field label="登录邮箱">
            <V2Input
              type="email"
              placeholder="you@example.com"
              value={profile.email}
              onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 修改密码 */}
      <V2Section
        title="修改密码"
        description="定期修改密码更安全"
        action={
          <V2PrimaryButton
            icon={KeyRound}
            loading={saving === "password"}
            onClick={handleChangePassword}
          >
            修改密码
          </V2PrimaryButton>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <V2Field label="当前密码" required>
            <V2Input
              type="password"
              value={passwords.current}
              onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
            />
          </V2Field>
          <V2Field label="新密码" required hint="至少 8 位">
            <V2Input
              type="password"
              value={passwords.next}
              onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
            />
          </V2Field>
          <V2Field label="再输一遍新密码" required>
            <V2Input
              type="password"
              value={passwords.confirm}
              onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
            />
          </V2Field>
        </div>
      </V2Section>

      {/* 显示设置（PRD 16.3 字体放大，无障碍） */}
      <V2Section
        title="显示设置"
        description="调整文字大小（本机保存，仅当前设备生效）"
      >
        <div className="flex gap-2">
          {(
            [
              { key: "1", label: "标准", scale: 1 },
              { key: "1.1", label: "大", scale: 1.1 },
              { key: "1.25", label: "特大", scale: 1.25 },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setFontScale(option.scale);
                try {
                  localStorage.setItem("jiuzhang.fontScale", option.key);
                } catch {
                  /* 隐私模式下忽略 */
                }
                if (typeof document !== "undefined") {
                  document.documentElement.style.zoom = String(option.scale);
                }
              }}
              className={`flex-1 rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-2 text-sm font-medium transition ${
                fontScale === option.scale
                  ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                  : "border-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </V2Section>

      {/* 通知设置 */}
      <V2Section
        title="通知设置"
        description="什么时候提醒你"
        action={
          <V2PrimaryButton
            icon={Bell}
            loading={saving === "notifications"}
            onClick={handleSaveNotifications}
          >
            保存
          </V2PrimaryButton>
        }
      >
        <div className="space-y-4">
          {notifItems.map((item) => (
            <label key={item.key} className="flex items-center justify-between">
              <span className="text-sm text-[var(--kaypal-v3-soft-ink)]">
                {item.label}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={notifications[item.key]}
                className={`flex h-6 w-11 items-center rounded-full p-0.5 transition ${
                  notifications[item.key]
                    ? "justify-end bg-[var(--kaypal-v3-accent)]"
                    : "justify-start bg-[var(--kaypal-v3-border-strong)]"
                }`}
                onClick={() =>
                  setNotifications((p) => ({ ...p, [item.key]: !p[item.key] }))
                }
              >
                <div className="h-5 w-5 rounded-full bg-white shadow" />
              </button>
            </label>
          ))}
        </div>
      </V2Section>

      {/* 数据管理 */}
      <V2Section title="数据管理" description="导出和备份你的数据">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
            <div>
              <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                导出全部数据
              </p>
              <p className="text-xs text-[var(--kaypal-v3-muted)]">
                客户、内容、任务记录打包下载
              </p>
            </div>
          </div>
          <V2GhostButton icon={Download} onClick={() => flash(NOT_READY)}>
            导出
          </V2GhostButton>
        </div>
      </V2Section>

      {/* 桌面设置（本机应用专属） */}
      <V2Section title="桌面设置" description="微信应用位置、自动恢复连接等本机选项">
        <DesktopSettings />
      </V2Section>

      {/* 集成设置：AI 服务 / 内容来源 / 文件存储 */}
      <SettingsIntegrations />

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/")}>
          返回首页
        </V2GhostButton>
        <V2StatusChip tone="muted">设置实时生效</V2StatusChip>
      </section>
    </div>
  );
}
