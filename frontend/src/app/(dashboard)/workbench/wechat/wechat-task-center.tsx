"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  MessageSquareText,
  UserRoundPlus,
  Users,
  Settings,
  History,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  localEngineApi,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

type TaskStats = {
  pending: number;
  inProgress: number;
  completedToday: number;
  totalContacts: number;
};

type QuickAction = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  badge?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type RecentTask = {
  id: string;
  title: string;
  type: string;
  status: "completed" | "failed" | "in-progress";
  completedAt: string;
};

function isToday(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function formatTime(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (isToday(dateStr)) {
    return `今天 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  return d.toLocaleDateString("zh-CN");
}

export function WechatTaskCenter() {
  const [stats, setStats] = useState<TaskStats>({
    pending: 0,
    inProgress: 0,
    completedToday: 0,
    totalContacts: 0,
  });
  const [assistantConnected, setAssistantConnected] = useState<boolean | null>(
    null,
  );
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [contactsResult, tasksResult, sessionResult] =
        await Promise.allSettled([
          localEngineApi.wechatContacts(),
          localEngineApi.tasks(50),
          localEngineApi.wechatSessionStatus(),
        ]);

      const totalContacts =
        contactsResult.status === "fulfilled"
          ? contactsResult.value.count || contactsResult.value.items?.length || 0
          : 0;

      const tasks: InteractionTask[] =
        tasksResult.status === "fulfilled" ? tasksResult.value : [];

      const pending = tasks.filter(
        (t) => t.status === "waiting_for_send_confirmation",
      ).length;
      const inProgress = tasks.filter(
        (t) => t.status === "running" || t.status === "queued",
      ).length;
      const completedToday = tasks.filter(
        (t) => t.status === "completed" && isToday(t.updatedAt || t.createdAt),
      ).length;

      setStats({ pending, inProgress, completedToday, totalContacts });

      if (sessionResult.status === "fulfilled") {
        setAssistantConnected(Boolean(sessionResult.value.desktop?.available));
      }

      // 最近任务：按更新时间倒序取 5 条
      const sorted = [...tasks].sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
      setRecentTasks(
        sorted.slice(0, 5).map((t) => ({
          id: t.id,
          title: t.targetName || t.typeLabel,
          type: t.typeLabel,
          status:
            t.status === "completed"
              ? "completed"
              : t.status === "failed" || t.status === "blocked"
                ? "failed"
                : "in-progress",
          completedAt:
            t.status === "completed"
              ? formatTime(t.updatedAt || t.createdAt)
              : t.statusLabel,
        })),
      );
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载微信任务中心失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const quickActions: QuickAction[] = useMemo(
    () => [
      {
        key: "contact-add",
        title: "添加好友",
        description: "批量添加新的好友",
        icon: UserRoundPlus,
        href: "/workbench/wechat-v2/contact-add",
      },
      {
        key: "friend-accept",
        title: "通过好友",
        description:
          stats.pending > 0 ? `${stats.pending} 个待处理任务` : "处理好友申请",
        icon: CheckCircle2,
        href: "/workbench/wechat-v2/friend-accept",
        badge: stats.pending > 0 ? String(stats.pending) : undefined,
      },
    ],
    [stats],
  );

  const advancedModules = [
    {
      key: "contacts",
      title: "联系人管理",
      icon: Users,
      href: "/workbench/wechat-v2/contacts",
    },
    {
      key: "chat-history",
      title: "会话历史",
      icon: History,
      href: "/workbench/wechat-v2/chat-history",
    },
    {
      key: "legacy",
      title: "高级工作台",
      icon: Settings,
      href: "/workbench/wechat?module=contacts",
    },
  ];

  const today = new Date().toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  const inProgressTasks = recentTasks.filter(
    (task) => task.status === "in-progress",
  );
  const completedTasks = recentTasks.filter(
    (task) => task.status === "completed",
  );

  return (
    <div className="kaypal-v2-wechat flex flex-col gap-6">
      {/* 欢迎区域 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              微信
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              👋 早上好，今天是 {today}
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-1.5 ${
              assistantConnected
                ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                assistantConnected
                  ? "bg-[var(--kaypal-v3-success)]"
                  : "bg-[var(--kaypal-v3-muted)]"
              }`}
            />
            <span
              className={`text-sm font-medium ${
                assistantConnected
                  ? "text-[var(--kaypal-v3-success)]"
                  : "text-[var(--kaypal-v3-muted)]"
              }`}
            >
              {assistantConnected === null
                ? "检查中..."
                : assistantConnected
                  ? "助手已连接"
                  : "助手未连接"}
            </span>
          </div>
        </div>
      </section>

      {/* 统计卡片 */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--kaypal-v3-muted)]">待办任务</p>
              <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-ink)]">
                {loading ? "-" : stats.pending}
              </p>
            </div>
            <div className="kaypal-v3-icon-tile">
              <Clock className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--kaypal-v3-muted)]">进行中</p>
              <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-ink)]">
                {loading ? "-" : stats.inProgress}
              </p>
            </div>
            <div className="kaypal-v3-icon-tile">
              <MessageSquareText className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--kaypal-v3-muted)]">今日完成</p>
              <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-ink)]">
                {loading ? "-" : stats.completedToday}
              </p>
            </div>
            <div className="kaypal-v3-icon-tile">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </div>
        </div>

        <div className="kaypal-v3-panel p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--kaypal-v3-muted)]">联系人</p>
              <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-ink)]">
                {loading ? "-" : stats.totalContacts.toLocaleString()}
              </p>
            </div>
            <div className="kaypal-v3-icon-tile">
              <Users className="h-5 w-5" />
            </div>
          </div>
        </div>
      </section>

      {/* 快捷操作 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚡ 快捷操作
          </h2>
          <span className="text-sm text-[var(--kaypal-v3-muted)]">
            一键开始常用任务
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.key}
                href={action.disabled ? "#" : action.href}
                className={`kaypal-v3-panel group relative p-6 transition ${
                  action.disabled
                    ? "cursor-not-allowed opacity-60"
                    : "hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
                }`}
                onClick={(e) => {
                  if (action.disabled) {
                    e.preventDefault();
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="kaypal-v3-icon-tile">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                          {action.title}
                        </h3>
                        <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                          {action.disabled && action.disabledReason
                            ? action.disabledReason
                            : action.description}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {action.badge && (
                      <span className="rounded-full bg-[var(--kaypal-v3-danger)] px-2 py-0.5 text-xs font-semibold text-white">
                        {action.badge}
                      </span>
                    )}
                    <ArrowRight className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 进行中的任务 */}
      {inProgressTasks.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              📋 进行中的任务
            </h2>
            <Link
              href="/workbench/wechat?module=mass-send"
              className="text-sm font-medium text-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              查看全部 →
            </Link>
          </div>

          <div className="space-y-3">
            {inProgressTasks.map((task) => (
              <div key={task.id} className="kaypal-v3-panel p-5">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                      {task.title}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {task.type} · {task.completedAt}
                    </p>
                  </div>
                  <Link
                    href="/workbench/wechat?module=mass-send"
                    className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
                  >
                    详情
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 最近任务 */}
      {completedTasks.length > 0 && (
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              🕐 最近完成
            </h2>
          </div>

          <div className="kaypal-v3-panel divide-y divide-[var(--kaypal-v3-border)]">
            {completedTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
                  <div>
                    <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {task.title}
                    </p>
                    <p className="text-xs text-[var(--kaypal-v3-muted)]">
                      {task.type} · {task.completedAt}
                    </p>
                  </div>
                </div>
                <span className="text-xs text-[var(--kaypal-v3-muted)]">已完成</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 高级功能 */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚙️ 高级功能
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {advancedModules.map((module) => {
            const Icon = module.icon;
            return (
              <Link
                key={module.key}
                href={module.href}
                className="kaypal-v3-surface group flex items-center gap-3 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
              >
                <Icon className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                  {module.title}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
