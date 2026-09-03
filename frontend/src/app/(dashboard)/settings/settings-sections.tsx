"use client";

/**
 * 设置区块组件（2026-09-01 设置拆分）
 *
 * 把 /settings 聚合页的四大内联区块提取为可复用组件：
 *   账号与安全 / 显示设置 / 通知设置 / 数据管理
 * 供子路由独立页面（/settings/account 等）与聚合页（/settings）共同引用，
 * 避免每个子页面复制一份逻辑。每个区块自带保存反馈提示条。
 */
import { useState } from "react";
import {
  Bell,
  Database,
  Download,
  ExternalLink,
  UserRound,
} from "@/components/iconpark";
import {
  V2Section,
  V2PrimaryButton,
  V2GhostButton,
} from "@/components/v2/ui-kit";
import { useWebPush } from "@/lib/hooks/use-web-push";

const NOT_READY = "保存接口还没开放（后端开发中），已列入需求清单";

/** 子页面统一页头（WorkBuddy 双栏：左栏即导航，不再保留返回链接） */
export function SettingsPageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="kx-page-head">
      <div>
        <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">{title}</h1>
        <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">{sub}</p>
      </div>
    </div>
  );
}

/* ═══════════ 账号与安全（由 Kaypal 账号底座统一管理） ═══════════ */

export function AccountSettingsSection() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-6">
        <div className="flex items-start gap-4">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
            aria-hidden="true"
          >
            <UserRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              账号信息由 Kaypal 账号统一管理
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--kaypal-v3-muted)]">
              昵称、头像、登录邮箱、密码与安全设置都在 Kaypal 账号中心维护，
              修改后回到这里即可看到最新信息。JIUZHANG AI 不在前端重复提供这些表单。
            </p>
          </div>
          <a
            href="https://kaypal.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] bg-[image:var(--kaypal-v3-gradient-primary)] px-4 py-2 text-sm font-medium text-white transition hover:brightness-105"
          >
            <ExternalLink className="h-4 w-4" />
            前往 Kaypal 管理
          </a>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ 显示设置（字体放大，无障碍） ═══════════ */

export function AppearanceSettingsSection() {
  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const saved = Number(window.localStorage.getItem("jiuzhang.fontScale") || "1");
      return saved >= 1 && saved <= 1.5 ? saved : 1;
    } catch {
      return 1;
    }
  });

  return (
    <V2Section>
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
  );
}

/* ═══════════ 通知设置（Web Push + 事件开关） ═══════════ */

const NOTIF_ITEMS = [
  { key: "taskDone" as const, label: "任务完成时通知我" },
  { key: "taskFailed" as const, label: "任务失败时通知我" },
  { key: "newLead" as const, label: "有新客户线索时通知我" },
  { key: "dailyReport" as const, label: "每天发我一份数据日报" },
];

export function NotificationsSettingsSection() {
  const [notifications, setNotifications] = useState({
    taskDone: true,
    taskFailed: true,
    newLead: true,
    dailyReport: false,
  });
  const [message, setMessage] = useState<string | null>(null);
  const webPush = useWebPush();

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <V2Section>
      {message && (
        <div
          className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-3"
        >
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{message}</p>
        </div>
      )}

      {/* Web Push 推送开关（PRD 16.x：PWA 推送） */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">推送通知</p>
          <p className="mt-1 text-xs text-[var(--kaypal-v3-muted)]">
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
          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
            webPush.enabled
              ? "justify-end bg-[var(--kaypal-v3-accent)]"
              : "justify-start bg-[var(--kaypal-v3-border-strong)]"
          }`}
        >
          <span className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
        </button>
      </div>

      <div className="space-y-4">
        {NOTIF_ITEMS.map((item) => (
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
              <div className="h-5 w-5 rounded-full bg-[var(--kaypal-v3-paper)] shadow" />
            </button>
          </label>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <V2PrimaryButton icon={Bell} onClick={() => flash(NOT_READY)}>
          保存
        </V2PrimaryButton>
      </div>
    </V2Section>
  );
}

/* ═══════════ 数据管理（导出） ═══════════ */

export function DataSettingsSection() {
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  };

  return (
    <V2Section>
      {message && (
        <div
          className="mb-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-3"
        >
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{message}</p>
        </div>
      )}
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
  );
}
