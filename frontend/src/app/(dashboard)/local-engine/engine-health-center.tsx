"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  Monitor,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { localEngineApi } from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

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

const STATUS_REQUEST_TIMEOUT_MS = 12_000;
const STATUS_REQUEST_OPTIONS = { timeoutMs: STATUS_REQUEST_TIMEOUT_MS };

export function EngineHealthCenter() {
  const isMobile = useIsMobile();
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
  const [checkFailed, setCheckFailed] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [healthResult, readinessResult, browserResult, tasksResult] =
        await Promise.allSettled([
          localEngineApi.health(STATUS_REQUEST_OPTIONS),
          localEngineApi.readiness(STATUS_REQUEST_OPTIONS),
          localEngineApi.browserStatus(STATUS_REQUEST_OPTIONS),
          localEngineApi.tasks(50, STATUS_REQUEST_OPTIONS),
        ]);

      const partialFailure = [
        healthResult,
        readinessResult,
        browserResult,
        tasksResult,
      ].some((result) => result.status === "rejected");
      setCheckFailed(partialFailure);

      const health = healthResult.status === "fulfilled" ? healthResult.value : null;
      const readiness =
        readinessResult.status === "fulfilled" ? readinessResult.value : null;
      const browser =
        browserResult.status === "fulfilled" ? browserResult.value : null;
      const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];

      const online = health ? Boolean(health.online) : null;
      setAssistantConnected(online);

      const criticalCount =
        (health?.requiredBlocked ?? 0) + (readiness?.summary.blockers ?? 0);
      const warningCount = readiness?.summary.warnings ?? 0;
      const readyAccounts = readiness?.summary.readyAccounts ?? 0;

      setStatus({
        healthy: readyAccounts + (online === true ? 1 : 0),
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
      setCheckFailed(true);
      setAssistantConnected(null);
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
      key: "ai-action",
      title: "AI 网页代操作",
      description: "自然语言指令驱动浏览器执行",
      icon: Sparkles,
      href: "/local-engine/ai-action",
    },
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

  const allHealthy =
    !checkFailed &&
    assistantConnected === true &&
    status.critical === 0 &&
    status.warning === 0;

  const handleCheckAll = async () => {
    setChecking(true);
    try {
      await fetchData();
    } finally {
      setChecking(false);
    }
  };

  const problemCount = status.critical + status.warning;

  /* 移动端原生视图（mx-* 明德 VP 风格）——一改转 7 页 */
  if (isMobile) {
    const connColor =
      assistantConnected === null
        ? "#b45309"
        : assistantConnected
          ? "#059669"
          : "#dc2626";
    const connText =
      assistantConnected === null
        ? loading
          ? "检查中…"
          : "状态未确认"
        : assistantConnected
          ? "引擎在线"
          : "引擎离线";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">设备状态</div>
            <div className="mx-page-sub">今日系统状态一览</div>
          </div>

          {/* 引擎状态条 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--mx-ink)" }}>本机引擎</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: connColor }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: connColor }} />
              {connText}
            </span>
          </div>

          {/* 三态统计 */}
          <div className="mx-stat-grid" style={{ marginTop: 10 }}>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>{loading ? "-" : status.healthy}</div>
              <div style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 2 }}>正常</div>
            </div>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#b45309" }}>{loading ? "-" : status.warning}</div>
              <div style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 2 }}>待处理</div>
            </div>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626" }}>{loading ? "-" : status.critical}</div>
              <div style={{ fontSize: 11, color: "var(--mx-muted)", marginTop: 2 }}>需处理</div>
            </div>
          </div>

          {/* 主行动 */}
          {checkFailed && !loading ? (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(222,150,57,.4)" }}>
              <p style={{ fontSize: 12, color: "#b45309", lineHeight: 1.5 }}>部分状态检查超时或失败，当前结果可能不完整，请重新检查。</p>
            </div>
          ) : null}
          {allHealthy && !loading ? (
            <div className="mx-card" style={{ marginTop: 10, padding: 13, textAlign: "center", borderColor: "rgba(5,150,105,.4)" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>系统运行正常，无需处理</span>
            </div>
          ) : (
            <button
              type="button"
              className="mx-btn-gold"
              style={{ marginTop: 12, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              disabled={checking || loading}
              onClick={() => void handleCheckAll()}
            >
              {checking ? "正在检查…" : problemCount > 0 ? `检查 ${problemCount} 个问题` : "重新检查"}
            </button>
          )}

          {/* 今日待办 */}
          {todos.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 18 }}>今日待办</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {todos.map((todo) => {
                  const TodoIcon = todo.icon;
                  return (
                    <Link key={todo.id} href={todo.href} className="mx-card" style={{ padding: 13, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ width: 32, height: 32, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: todo.severity === "critical" ? "rgba(220,80,80,.12)" : "rgba(222,150,57,.14)", color: todo.severity === "critical" ? "#dc2626" : "#d98a2d", flexShrink: 0 }}>
                          <TodoIcon width={16} height={16} />
                        </span>
                        <span style={{ fontSize: 12.5, color: "var(--mx-ink)" }}>
                          <b>{todo.count}</b> {todo.title}
                        </span>
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#d98a2d", flexShrink: 0 }}>去处理 ›</span>
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {/* 快速操作 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>快速操作</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Link key={action.key} href={action.href} className="mx-card" style={{ padding: 13, display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "rgba(246,196,120,.14)", color: "#d98a2d", flexShrink: 0 }}>
                    <ActionIcon width={17} height={17} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--mx-ink)" }}>{action.title}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 1 }}>{action.description}</span>
                  </span>
                  <span style={{ color: "var(--mx-muted)", fontSize: 14, flexShrink: 0 }}>›</span>
                </Link>
              );
            })}
          </div>

          {/* 高级模块 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>系统检查与高级功能</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {advancedModules.map((module) => (
              <Link key={module.key} href={module.href} className="mx-card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <Settings width={15} height={15} style={{ color: "var(--mx-muted)", flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mx-ink)" }}>{module.title}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="kaypal-v2-engine flex flex-col gap-6">
      {/* 系统状态总览 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              设备状态
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              👋 今日系统状态一览
            </p>
          </div>
          <div
            className={`flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border px-3 py-1.5 ${
              assistantConnected === null
                ? "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]"
                : assistantConnected
                  ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                  : "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]"
            }`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                assistantConnected === null
                  ? "bg-[var(--kaypal-v3-amber)]"
                  : assistantConnected
                    ? "bg-[var(--kaypal-v3-success)]"
                    : "bg-[var(--kaypal-v3-danger)]"
              }`}
            />
            <span
              className={`text-sm font-medium ${
                assistantConnected === null
                  ? "text-[var(--kaypal-v3-amber)]"
                  : assistantConnected
                    ? "text-[var(--kaypal-v3-success)]"
                    : "text-[var(--kaypal-v3-danger)]"
              }`}
            >
              {assistantConnected === null
                ? loading
                  ? "检查中..."
                  : "状态未确认"
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
          {checkFailed && !loading ? (
            <div className="mb-3 flex items-center gap-2 rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3 text-sm font-medium text-[var(--kaypal-v3-amber)]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              部分状态检查超时或失败，当前结果可能不完整，请重新检查。
            </div>
          ) : null}
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
