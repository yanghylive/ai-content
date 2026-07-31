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
  UserRound,
} from "lucide-react";
import {
  V2Section,
  V2Field,
  V2Input,
  V2PrimaryButton,
  V2GhostButton,
  V2StatusChip,
} from "@/components/v2/ui-kit";
import { toPublicError } from "@/lib/public-error";
import { SettingsIntegrations } from "./settings-integrations";

export function SettingsDetail() {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
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
