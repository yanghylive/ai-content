"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  Monitor,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";

type SystemStatus = {
  healthy: number;
  warning: number;
  critical: number;
};

type TodoItem = {
  id: string;
  title: string;
  count: number;
  icon: LucideIcon;
  href: string;
  severity: "critical" | "warning";
};

type QuickAction = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
};

export function EngineHealthCenter() {
  const [status, setStatus] = useState<SystemStatus>({
    healthy: 0,
    warning: 0,
    critical: 0,
  });
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [assistantConnected, setAssistantConnected] = useState<boolean | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [healthResult, readinessResult, browserResult, tasksResult] =
        await Promise.allSettled([
          localEngineApi.health(),
          localEngineApi.readiness(),
          localEngineApi.browserStatus(),
          localEngineApi.tasks(50),
        ]);

      const health = healthResult.status === "fulfilled" ? healthResult.value : null;
      const readiness =
        readinessResult.status === "fulfilled" ? readinessResult.value : null;
      const browser =
        browserResult.status === "fulfilled" ? browserResult.value : null;
      const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];

      const online = Boolean(health?.online);
      setAssistantConnected(online);

      const criticalCount =
        (health?.requiredBlocked ?? 0) + (readiness?.summary.blockers ?? 0);
      const warningCount = readiness?.summary.warnings ?? 0;
      const readyAccounts = readiness?.summary.readyAccounts ?? 0;

      setStatus({
        healthy: readyAccounts + (online ? 1 : 0),
        warning: warningCount,
        critical: criticalCount,
      });

      // 今日待办聚合（真实数据）
      const nextTodos: TodoItem[] = [];
      const pendingTasks = tasks.filter(
        (t) => t.status === "waiting_for_send_confirmation",
      ).length;
      if (pendingTasks > 0) {
        nextTodos.push({
          id: "tasks",
          title: "条客户互动待确认",
          count: pendingTasks,
          icon: MessageSquareText,
          href: "/local-engine-v2/tasks",
          severity: "warning",
        });
      }
      const expiredAccounts =
        browser?.expiredAccounts ?? readiness?.summary.expiredAccounts ?? 0;
      if (expiredAccounts > 0) {
        nextTodos.push({
          id: "accounts",
          title: "个账号登录失效",
          count: expiredAccounts,
          icon: Users,
          href: "/local-engine-v2/browser",
          severity: "critical",
        });
      }
      if (criticalCount > 0) {
        nextTodos.push({
          id: "permissions",
          title: "项必须处理的问题",
          count: criticalCount,
          icon: ShieldCheck,
          href: "/local-engine-v2/run",
          severity: "critical",
        });
      }
      setTodos(nextTodos);
    } catch (error: unknown) {
      console.error(toPublicError(error, "加载引擎状态失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const quickActions: QuickAction[] = [
    {
      key: "reply",
      title: "回复客户",
      description: "处理待回复的客户消息",
      icon: MessageSquareText,
      href: "/local-engine-v2/workbench",
    },
    {
      key: "check-accounts",
      title: "检查账号",
      description: "查看平台账号登录状态",
      icon: Users,
      href: "/local-engine-v2/browser",
    },
    {
      key: "records",
      title: "查看记录",
      description: "浏览互动任务和结果",
      icon: Monitor,
      href: "/local-engine-v2/tasks",
    },
  ];

  const advancedModules = [
    { key: "desktop", title: "微信桌面检查", href: "/local-engine-v2/desktop" },
    { key: "files", title: "文件与凭证", href: "/local-engine-v2/files" },
    { key: "permissions", title: "安全检查", href: "/local-engine?tab=permissions" },
    { key: "remote", title: "远程接管", href: "/local-engine-v2/remote" },
    { key: "evidence", title: "结果留存", href: "/local-engine-v2/evidence" },
    { key: "logs", title: "高级信息", href: "/local-engine-v2/logs" },
  ];

  const allHealthy = status.critical === 0 && status.warning === 0;

  const handleCheckAll = async () => {
    setChecking(true);
    await fetchData();
    setChecking(false);
  };

  const problemCount = status.critical + status.warning;

  return (
    <div className="kaypal-v2-engine flex flex-col gap-6">
      {/* 系统状态总览 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              本地引擎
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              👋 今日系统状态一览
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-1.5 ${
              assistantConnected
                ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                : "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                assistantConnected
                  ? "bg-[var(--kaypal-v3-success)]"
                  : "bg-[var(--kaypal-v3-danger)]"
              }`}
            />
            <span
              className={`text-sm font-medium ${
                assistantConnected
                  ? "text-[var(--kaypal-v3-success)]"
                  : "text-[var(--kaypal-v3-danger)]"
              }`}
            >
              {assistantConnected === null
                ? "检查中..."
                : assistantConnected
                  ? "引擎在线"
                  : "引擎离线"}
            </span>
          </div>
        </div>

        {/* 三态状态卡片 */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-5 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-[var(--kaypal-v3-success)]" />
            <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-success)]">
              {loading ? "-" : status.healthy}
            </p>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">正常</p>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-5 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-[var(--kaypal-v3-amber)]" />
            <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-amber)]">
              {loading ? "-" : status.warning}
            </p>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">待处理</p>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-5 text-center">
            <XCircle className="mx-auto h-6 w-6 text-[var(--kaypal-v3-danger)]" />
            <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-danger)]">
              {loading ? "-" : status.critical}
            </p>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">需处理</p>
          </div>
        </div>

        {/* 单一主行动 */}
        <div className="mt-6">
          {allHealthy && !loading ? (
            <div className="flex items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
              <CheckCircle2 className="h-5 w-5 text-[var(--kaypal-v3-success)]" />
              <span className="font-medium text-[var(--kaypal-v3-success)]">
                系统运行正常，无需处理
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-accent)] px-6 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              disabled={checking || loading}
              onClick={handleCheckAll}
            >
              {checking ? (
                <>
                  <RefreshCcw className="h-5 w-5 animate-spin" />
                  正在检查...
                </>
              ) : (
                <>
                  <Wrench className="h-5 w-5" />
                  {problemCount > 0
                    ? `检查 ${problemCount} 个问题`
                    : "重新检查"}
                </>
              )}
            </button>
          )}
        </div>
      </section>

      {/* 今日待办 */}
      {todos.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              📋 今日待办
            </h2>
          </div>

          <div className="space-y-3">
            {todos.map((todo) => {
              const Icon = todo.icon;
              return (
                <Link
                  key={todo.id}
                  href={todo.href}
                  className="kaypal-v3-panel group flex items-center justify-between p-5 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] ${
                        todo.severity === "critical"
                          ? "bg-[var(--kaypal-v3-danger-soft)]"
                          : "bg-[var(--kaypal-v3-amber-soft)]"
                      }`}
                    >
                      <Icon
                        className={`h-5 w-5 ${
                          todo.severity === "critical"
                            ? "text-[var(--kaypal-v3-danger)]"
                            : "text-[var(--kaypal-v3-amber)]"
                        }`}
                      />
                    </div>
                    <p className="text-base text-[var(--kaypal-v3-ink)]">
                      <span className="font-bold">{todo.count}</span>{" "}
                      {todo.title}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--kaypal-v3-accent)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                    去处理
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 快速操作 */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚡ 快速操作
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.key}
                href={action.href}
                className="kaypal-v3-panel group p-5 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <div className="kaypal-v3-icon-tile">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                      {action.title}
                    </h3>
                    <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                      {action.description}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 高级功能 */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚙️ 系统检查与高级功能
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {advancedModules.map((module) => (
            <Link
              key={module.key}
              href={module.href}
              className="kaypal-v3-surface group flex items-center gap-3 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
            >
              <Settings className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                {module.title}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
