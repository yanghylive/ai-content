"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Database,
  Download,
  KeyRound,
  Save,
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
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useWebPush } from "@/lib/hooks/use-web-push";

export function SettingsDetail() {
  const router = useRouter();
  const [saving] = useState<string | null>(null);
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
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
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></svg></span>
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
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
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

          {/* 通知设置 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg></span>
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
              <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" /></svg></span>
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
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            微信应用路径、自动恢复连接、AI 专家状态、问题资料发送
          </p>
          <V2GhostButton onClick={() => router.push("/settings?legacy=1&tab=desktop")}>
            去桌面设置 →
          </V2GhostButton>
        </div>
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
