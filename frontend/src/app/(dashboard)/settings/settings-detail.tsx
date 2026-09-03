"use client";

import { V2BackButton } from "@/components/v2/v2-back-button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Cpu,
  Database,
  Lock,
  MonitorCog,
  Shield,
  User,
} from "@/components/iconpark";
import {
  V2Section,
  V2GhostButton,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { FileStorageSettings } from "./settings-integrations";
import { DesktopSettings } from "./desktop-settings";
import {
  AccountSettingsSection,
  AppearanceSettingsSection,
  NotificationsSettingsSection,
  DataSettingsSection,
} from "./settings-sections";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useWebPush } from "@/lib/hooks/use-web-push";

export function SettingsDetail() {
  const router = useRouter();
  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const saved = Number(window.localStorage.getItem("jiuzhang.fontScale") || "1");
      return saved >= 1 && saved <= 1.5 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const message: string | null = null;
  const error: string | null = null;

  // 账号/密码/事件通知为未就绪或由 Kaypal 账号中心管理；只读展示不提供可提交表单
  const notifications = {
    taskDone: true,
    taskFailed: true,
    newLead: true,
    dailyReport: false,
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
            <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--kaypal-v3-ink)", flexShrink: 0 }} onClick={() => router.push("/")}>
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
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(16,185,129,.1)", fontSize: 12, color: "var(--kaypal-v3-success)" }}>{message}</div>
          )}
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</div>
          )}

          {/* 个人资料（账号信息由 Kaypal 账号中心统一管理） */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><User /></span>
              个人资料
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--kaypal-v3-muted)", marginBottom: 6 }}>昵称</p>
              <input readOnly placeholder="由 Kaypal 账号中心管理" style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid var(--kaypal-v3-field-border)", outline: "none", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-muted)", opacity: 0.8 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--kaypal-v3-muted)", marginBottom: 6 }}>登录邮箱</p>
              <input type="email" readOnly placeholder="由 Kaypal 账号中心管理" style={{ width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 13, border: "1px solid var(--kaypal-v3-field-border)", outline: "none", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-muted)", opacity: 0.8 }} />
            </div>
            <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", lineHeight: 1.6, marginBottom: 10 }}>
              昵称、头像、邮箱与密码统一在 Kaypal 账号中心维护，这里不支持修改。
            </p>
            <a
              href="https://kaypal.cn"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-btn-gold"
              style={{ width: "100%", fontSize: 12, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
            >
              前往 Kaypal 管理
            </a>
          </div>

          {/* 修改密码（登录密码在 Kaypal 账号中心维护） */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Lock /></span>
              修改密码
            </div>
            <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-soft-ink)", lineHeight: 1.7, marginBottom: 10 }}>
              登录密码与安全设置统一在 Kaypal 账号中心维护，如需修改请前往：
            </p>
            <a
              href="https://kaypal.cn"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-btn-gold"
              style={{ width: "100%", fontSize: 12, padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
            >
              前往 Kaypal 修改密码
            </a>
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
                <p style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)" }}>推送通知</p>
                <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>
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
                style={{ display: "flex", width: 44, height: 24, borderRadius: 999, padding: 2, alignItems: "center", justifyContent: webPush.enabled ? "flex-end" : "flex-start", background: webPush.enabled ? "linear-gradient(90deg, var(--kaypal-v3-accent), var(--kaypal-v3-amber))" : "rgba(148,163,184,.35)", transition: "all .2s", border: "none", cursor: webPush.busy ? "wait" : "pointer", flexShrink: 0, opacity: webPush.busy ? 0.6 : 1 }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--kaypal-v3-paper)", boxShadow: "var(--kaypal-v3-card-shadow)" }} />
              </button>
            </div>
            {notifItems.map((item) => (
              <div key={item.key} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid rgba(142,165,190,.14)", opacity: 0.6 }}>
                <span style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)" }}>
                  {item.label}
                  <span style={{ marginLeft: 6, fontSize: 10, color: "var(--kaypal-v3-muted)", border: "1px solid var(--kaypal-v3-border)", borderRadius: 999, padding: "1px 6px" }}>即将上线</span>
                </span>
                <span style={{ display: "flex", width: 44, height: 24, borderRadius: 999, padding: 2, alignItems: "center", justifyContent: notifications[item.key] ? "flex-end" : "flex-start", background: "rgba(148,163,184,.35)", transition: "all .2s" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--kaypal-v3-paper)", boxShadow: "var(--kaypal-v3-card-shadow)" }} />
                </span>
              </div>
            ))}
            <button type="button" className="mx-btn-gold" disabled style={{ width: "100%", fontSize: 12, padding: "10px 0", marginTop: 10, opacity: 0.5 }}>保存</button>
          </div>

          {/* 数据管理 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Database /></span>
              数据管理
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>导出全部数据</p>
                <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>客户、内容、任务记录打包下载</p>
                <p style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", marginTop: 4 }}>导出功能暂未开放</p>
              </div>
              <button type="button" className="mx-btn-gold" disabled style={{ opacity: 0.5 }}>导出</button>
            </div>
          </div>

          {/* 文件存储 */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Database /></span>
              文件存储
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>生成的图片、视频存在哪里</p>
                <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>本地存储或对象存储（七牛云 / 阿里 OSS）</p>
              </div>
              <button type="button" className="mx-btn-gold" onClick={() => router.push("/settings/integrations")}>去配置</button>
            </div>
          </div>

          {/* AI 服务（2026-09-03 恢复入口：默认模型/账号同步/连接检查） */}
          <div className="mx-card" style={{ padding: 16, marginBottom: 14 }}>
            <div className="mx-section-title" style={{ marginBottom: 12 }}>
              <span className="mx-sec-icon"><Cpu /></span>
              AI 服务
            </div>
            <button
              type="button"
              className="mx-control"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(142,165,190,.14)" }}
              onClick={() => router.push("/settings/ai-service")}
            >
              <span style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)" }}>默认模型 · 从账号同步 · 连接检查</span>
              <span style={{ fontSize: 13, color: "rgba(148,163,184,.7)" }}>›</span>
            </button>
          </div>

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
              <span style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)" }}>用户协议 · 隐私政策 · AI 说明 · 投诉举报</span>
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
      <div className="kx-page-head">
        <div>
          <V2BackButton />
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
            设置
          </h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            账号、通知、数据，都在这一个页面管好
          </p>
        </div>
      </div>

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

      {/* 2026-09-01 设置拆分：四大区块提取为独立组件（子路由 /settings/* 同源复用） */}
      <AccountSettingsSection />
      <AppearanceSettingsSection />
      <NotificationsSettingsSection />
      <DataSettingsSection />

      {/* 合规中心（用户协议/隐私/AI 说明/投诉/备案公示，独立入口 /settings/legal） */}
      <V2Section title="合规中心" description="用户协议、隐私政策、AI 说明、投诉举报">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-5 w-5 text-[var(--kaypal-v3-muted)]" />
            <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
              用户协议 · 隐私政策 · AI 说明 · 投诉举报
            </p>
          </div>
          <V2GhostButton icon={ChevronRight} onClick={() => router.push("/settings/legal")}>
            查看
          </V2GhostButton>
        </div>
      </V2Section>


      {/* 桌面设置（本机应用专属） */}
      <V2Section title="桌面设置" description="微信应用位置、自动恢复连接等本机选项">
        <DesktopSettings />
      </V2Section>

      {/* 文件存储 */}
      <FileStorageSettings />

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/")}>
          返回首页
        </V2GhostButton>
        <V2StatusChip tone="muted">设置实时生效</V2StatusChip>
      </section>
    </div>
  );
}
