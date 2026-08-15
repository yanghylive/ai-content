"use client";

import { SkeletonRow } from "@/components/skeleton";
import { BrandLogo } from "@/components/brand-logo";
import {
  MOBILE_STATUS_BADGE,
  MOBILE_STATUS_DOT,
  MOBILE_STATUS_LABEL,
  type PublishStatus,
} from "@/lib/publish-status";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Video,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { autoUploadApi, type AutoUploadCalendarDay } from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { useConfirm } from "@/hooks/use-confirm";
import { LocalBridgeStatus } from "./local-bridge-status";

type PublishItem = {
  id: string;
  title: string;
  type: "article" | "video";
  status: PublishStatus;
  platforms: string[];
  scheduledAt?: string;
  progress?: string;
  failReason?: string;
  /** 后端 updated_at（ISO 8601），用于判断「执行中」任务是否超时卡住 */
  updatedAt?: string;
};

const STATUS_CONFIG: Record<
  PublishStatus,
  { label: string; icon: LucideIcon; color: string }
> = {
  draft: { label: "草稿", icon: FileText, color: "var(--kaypal-v3-muted)" },
  pending: { label: "计划中", icon: Clock, color: "var(--kaypal-v3-amber)" },
  queued: { label: "排队中", icon: Loader2, color: "var(--kaypal-v3-accent)" },
  running: { label: "执行中", icon: Zap, color: "var(--kaypal-v3-accent)" },
  cancelled: { label: "已取消", icon: Ban, color: "var(--kaypal-v3-muted)" },
  done: { label: "已完成", icon: CheckCircle2, color: "var(--kaypal-v3-success)" },
  failed: { label: "失败", icon: XCircle, color: "var(--kaypal-v3-danger)" },
};

// 后端租约时长（durable-publish.worker.ts LEASE_DURATION_MS=120s）：
// 「执行中」任务超过该时长未更新，视为可能卡住（后端 reclaimStaleTasks 会回收重跑）。
const RUNNING_STALE_THRESHOLD_MS = 120_000;

// 预览用示例数据（正式接入时替换为后端发布任务接口）
export function PublishCenter() {
  const [items, setItems] = useState<PublishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 3000);
  };

  // 失败任务重试（与 distribution-tasks 同一套：先创建重试确认，再 retry）
  const handleRetry = async (item: PublishItem) => {
    const taskId = Number(item.id);
    if (!Number.isFinite(taskId)) {
      setError("任务 ID 无效，无法重试");
      return;
    }
    setActingId(item.id);
    setError(null);
    try {
      const confirmation = await autoUploadApi.createRetryTaskConfirmation(taskId);
      await autoUploadApi.retryTask(taskId, confirmation.confirmationId);
      flash("重试已开始，结果稍后查看");
      await fetchTasks();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      setError(raw || toPublicError(err, "重试失败，请稍后重试"));
    } finally {
      setActingId(null);
    }
  };

  // 真实发布任务（替代写死的示例数据）
  const fetchTasks = useCallback(async () => {
    try {
      const result = await autoUploadApi.taskPage({ page: 1, pageSize: 60 });
      const tasks = Array.isArray(result?.items) ? result.items : [];
      setItems(
        tasks.map((task): PublishItem => {
          const s = (task.status || "").toLowerCase();
          const status: PublishStatus =
            s === "success" || s === "completed" || s === "done"
              ? "done"
              : s === "failed" || s === "error" || s === "blocked"
                ? "failed"
                : s === "cancelled" || s === "canceled"
                  ? "cancelled"
                  : s === "claimed" || s === "running" || s === "publishing"
                    ? "running"
                    : s === "queued"
                      ? "queued"
                      : s.startsWith("waiting") || s === "pending"
                        ? "pending"
                        : "draft";
          return {
            id: String(task.id),
            title: task.title || `任务 #${task.id}`,
            type: (task as { contentKind?: string }).contentKind === "video" ? "video" : "article",
            status,
            platforms: task.platform ? [task.platform] : [],
            failReason: status === "failed" ? (task.message ?? undefined) : undefined,
            updatedAt: task.updated_at,
          };
        }),
      );
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // 有排队/执行中任务时自动轮询
  useEffect(() => {
    const hasActive = items.some(
      (t) =>
        t.status === "queued" ||
        t.status === "pending" ||
        t.status === "running",
    );
    if (!hasActive) return;
    const timer = setInterval(() => void fetchTasks(), 5000);
    return () => clearInterval(timer);
  }, [items, fetchTasks]);

  // 「执行中」任务超过后端租约时长（120s）未更新 → 可能卡住，提示 + 可重试
  const isStaleRunning = (item: PublishItem): boolean => {
    if (item.status !== "running" || !item.updatedAt) return false;
    const ts = Date.parse(item.updatedAt);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > RUNNING_STALE_THRESHOLD_MS;
  };

  const stats = useMemo(
    () => ({
      pending: items.filter((i) => i.status === "pending").length,
      queued: items.filter((i) => i.status === "queued").length,
      running: items.filter((i) => i.status === "running").length,
      doneToday: items.filter((i) => i.status === "done").length,
      failed: items.filter((i) => i.status === "failed").length,
    }),
    [items],
  );

  const kanbanColumns: Array<{ status: PublishStatus; items: PublishItem[] }> =
    useMemo(
      () => [
        {
          status: "pending",
          items: items.filter((i) => i.status === "pending"),
        },
        {
          status: "queued",
          items: items.filter((i) => i.status === "queued"),
        },
        {
          status: "running",
          items: items.filter((i) => i.status === "running"),
        },
        { status: "done", items: items.filter((i) => i.status === "done") },
        {
          status: "cancelled",
          items: items.filter((i) => i.status === "cancelled"),
        },
        {
          status: "failed",
          items: items.filter((i) => i.status === "failed"),
        },
      ],
      [items],
    );

  const primaryAction = (item: PublishItem) => {
    // pending（计划中）任务由后端 worker 到点自动执行，无需手动确认
    // draft 是未知状态兜底，任务结构无 articleId，无法跳转编辑
    // failed 可重试；running 且超租约卡住也可重试（后端 reclaim 会回收，手动重试更直接）
    if (item.status === "failed") return { label: "重试", primary: true };
    if (isStaleRunning(item)) return { label: "重试", primary: true };
    return null;
  };

  /* 移动端（<768px）：明德 VP 风格移动视图，复用同一批数据 */
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <MobilePublishView items={items} stats={stats} loading={loading} />
    );
  }

  return (
    <div className="kaypal-v2-engine flex flex-col gap-6">
      {/* 顶部统计 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              发布中心
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              {loading
                ? "正在加载..."
                : `你有 ${stats.pending} 个内容计划中，到点自动发布`}
            </p>
          </div>
          {/* 单一主行动 */}
          <Link
            href="/distribution/articles"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
          >
            <Plus className="h-5 w-5" />
            新建发布
          </Link>
        </div>

        {notice && (
          <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] px-4 py-2.5 text-sm text-[var(--kaypal-v3-success-ink)]">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] px-4 py-2.5 text-sm text-[var(--kaypal-v3-danger-ink)]">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">计划中</p>
                <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-amber)]">
                  {stats.pending}
                </p>
              </div>
              <Clock className="h-6 w-6 text-[var(--kaypal-v3-amber)]" />
            </div>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">排队中</p>
                <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                  {stats.queued}
                </p>
              </div>
              <Loader2 className="h-6 w-6 text-[var(--kaypal-v3-accent-ink)]" />
            </div>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-accent-border)] bg-[var(--kaypal-v3-accent-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">执行中</p>
                <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-accent-ink)]">
                  {stats.running}
                </p>
              </div>
              <Zap className="h-6 w-6 text-[var(--kaypal-v3-accent-ink)]" />
            </div>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">今日已发</p>
                <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-success)]">
                  {stats.doneToday}
                </p>
              </div>
              <CheckCircle2 className="h-6 w-6 text-[var(--kaypal-v3-success)]" />
            </div>
          </div>
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">失败</p>
                <p className="mt-2 text-3xl font-bold text-[var(--kaypal-v3-danger)]">
                  {stats.failed}
                </p>
              </div>
              <XCircle className="h-6 w-6 text-[var(--kaypal-v3-danger)]" />
            </div>
          </div>
        </div>
      </section>

      <LocalBridgeStatus />

      {/* 失败提醒（上下文引导） */}
      {stats.failed > 0 && (
        <section className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-[var(--kaypal-v3-danger)]" />
              <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">
                有 {stats.failed} 个内容发布失败，多数是账号登录失效导致
              </p>
            </div>
            <Link
              href="/local-engine"
              className="text-sm font-medium text-[var(--kaypal-v3-danger)] underline"
            >
              去检查账号 →
            </Link>
          </div>
        </section>
      )}

      {/* 看板视图 */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            📋 发布看板
          </h2>
          <span className="text-sm text-[var(--kaypal-v3-muted)]">
            内容从计划到发布的全过程
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {kanbanColumns.map((column) => {
            const config = STATUS_CONFIG[column.status];
            const Icon = config.icon;
            return (
              <div
                key={column.status}
                className="kaypal-v3-surface flex flex-col p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-4 w-4"
                      style={{ color: config.color }}
                    />
                    <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                      {config.label}
                    </span>
                  </div>
                  <span className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-muted)]">
                    {column.items.length}
                  </span>
                </div>

                <div className="space-y-3">
                  {column.items.length === 0 ? (
                    <p className="py-4 text-center text-xs text-[var(--kaypal-v3-muted)]">
                      暂无内容
                    </p>
                  ) : (
                    column.items.map((item) => {
                      const action = primaryAction(item);
                      const TypeIcon =
                        item.type === "video" ? Video : FileText;
                      return (
                        <div
                          key={item.id}
                          className="kaypal-v3-panel p-4 transition hover:shadow-md"
                        >
                          <div className="flex items-start gap-2">
                            <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-[var(--kaypal-v3-ink)]">
                                {item.title}
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {item.platforms.map((platform) => (
                                  <span
                                    key={platform}
                                    className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-soft-ink)]"
                                  >
                                    {platform}
                                  </span>
                                ))}
                              </div>
                              {item.progress && (
                                <p className="mt-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                                  {item.progress}
                                </p>
                              )}
                              {isStaleRunning(item) && (
                                <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--kaypal-v3-amber)]">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  执行时间较长，可能卡住，可重试
                                </p>
                              )}
                              {item.failReason && (
                                <p className="mt-1.5 text-xs text-[var(--kaypal-v3-danger)]">
                                  {item.failReason}
                                </p>
                              )}
                              {action && (
                                <button
                                  type="button"
                                  disabled={actingId === item.id}
                                  onClick={() => {
                                    if (
                                      item.status === "failed" ||
                                      isStaleRunning(item)
                                    ) {
                                      void handleRetry(item);
                                    }
                                  }}
                                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {(item.status === "failed" ||
                                    isStaleRunning(item)) && (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                  {actingId === item.id
                                    ? "处理中…"
                                    : action.label}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 高级功能 */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            ⚙️ 高级功能
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { key: "materials", title: "素材库", href: "/materials" },
            { key: "accounts", title: "发布账号", href: "/platforms" },
            { key: "compliance", title: "合规检查", href: "/compliance" },
            { key: "engine", title: "发布引擎", href: "/local-engine" },
            { key: "logs", title: "发布日志", href: "/local-engine/logs" },
          ].map((module) => (
            <Link
              key={module.key}
              href={module.href}
              className="kaypal-v3-surface group flex items-center justify-between p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
            >
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                {module.title}
              </span>
              <ArrowRight className="h-4 w-4 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

/** 平台 key → 中文名（与后端 registry 一致） */
const MOBILE_PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  "wechat-official": "公众号",
  douyin: "抖音",
  kuaishou: "快手",
  bilibili: "B站",
  weibo: "微博",
  zhihu: "知乎",
  toutiao: "头条",
};
function mobilePlatformName(key: string): string {
  return MOBILE_PLATFORM_NAMES[key] || key;
}

/** 日历任务状态 → 中文标签 */
const CALENDAR_STATUS_LABEL: Record<string, string> = {
  waiting: "待执行",
  claimed: "执行中",
  queued: "排队中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const CALENDAR_STATUS_COLOR: Record<string, string> = {
  waiting: "#d98a2d",
  claimed: "#2563eb",
  queued: "#2563eb",
  completed: "#059669",
  failed: "#dc2626",
  cancelled: "#94a3b8",
};

/** 发布日历：近 7 天任务分组 + 取消/改期 */
function PublishCalendarView() {
  const { confirm, modal } = useConfirm();
  const [days, setDays] = React.useState<AutoUploadCalendarDay[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [actingId, setActingId] = React.useState<number | null>(null);
  const [rescheduleId, setRescheduleId] = React.useState<number | null>(null);
  const [rescheduleAt, setRescheduleAt] = React.useState("");

  const load = useCallback(async () => {
    try {
      // days=4 → 后端对称窗口 4*2-1=7 组（过去3天+今天+未来3天）
      const result = await autoUploadApi.calendar(4);
      setDays(Array.isArray(result) ? result : []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "日历加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doCancel = useCallback(
    async (id: number) => {
      const ok = await confirm({
        kind: "danger",
        title: "取消发布任务",
        description: "取消后不会再执行发布，你可以稍后重新发起。",
        confirmText: "取消发布",
      });
      if (!ok) {
        return;
      }
      setActingId(id);
      try {
        await autoUploadApi.cancelTask(id);
        await load();
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "取消失败");
      } finally {
        setActingId(null);
      }
    },
    [load, confirm],
  );

  const openReschedule = useCallback((id: number) => {
    setRescheduleId(id);
    setRescheduleAt("");
  }, []);

  const submitReschedule = useCallback(async () => {
    if (rescheduleId === null) return;
    if (!rescheduleAt) {
      window.alert("请选择新的计划发布时间");
      return;
    }
    setActingId(rescheduleId);
    try {
      await autoUploadApi.rescheduleTask(rescheduleId, new Date(rescheduleAt).toISOString());
      setRescheduleId(null);
      await load();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "改期失败");
    } finally {
      setActingId(null);
    }
  }, [rescheduleId, rescheduleAt, load]);

  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const fmtDate = useCallback((key: string) => {
    const [y, m, d] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    return `${Number(m)}月${Number(d)}日 ${week}`;
  }, []);

  const fmtTime = useCallback((iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, []);

  return (
    <div className="mx-px" style={{ marginTop: 14 }}>
      <div className="mx-card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>发布日历</div>
            <div style={{ fontSize: 12, color: "rgba(219,234,254,.7)", marginTop: 3 }}>
              近 7 天发布任务 · 可取消或改期
            </div>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "7px 12px", backgroundImage: "none", background: "rgba(255,255,255,.08)", color: "#dbe7f5", border: "1px solid rgba(255,255,255,.2)", boxShadow: "none" }}
            onClick={() => void load()}
          >
            刷新
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-empty" style={{ marginTop: 12 }}>
          <p>{error}</p>
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 14 }}>
        {loading ? (
          <div className="mx-card mx-list-card">
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "60%" }} /></div></div>
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "75%" }} /></div></div>
            <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "52%" }} /></div></div>
          </div>
        ) : days.every((d) => d.items.length === 0) ? (
          <div className="mx-empty">
            <p>近 7 天还没有发布任务</p>
            <Link href="/distribution/articles" className="mx-btn-gold" style={{ marginTop: 12, textDecoration: "none" }}>
              新建发布
            </Link>
          </div>
        ) : (
          days.map((day) => (
            <div key={day.date} className="mx-card" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(day.date)}</span>
                {day.date === todayKey ? (
                  <span className="mx-badge mx-badge-gold" style={{ fontSize: 10, padding: "2px 8px" }}>今天</span>
                ) : null}
                <span style={{ fontSize: 11, color: "rgba(219,234,254,.55)", marginLeft: "auto" }}>
                  {day.items.length} 个任务
                </span>
              </div>
              {day.items.length === 0 ? (
                <div style={{ padding: "14px 16px", fontSize: 12, color: "rgba(219,234,254,.45)" }}>无任务</div>
              ) : (
                day.items.map((item) => {
                  const canOperate = item.status === "waiting";
                  return (
                    <div key={item.id} className="mx-row" style={{ alignItems: "flex-start" }}>
                      <span
                        className="mx-row-ic"
                        style={{
                          background: `${CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8"}1f`,
                          color: CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8",
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="17" height="17">
                          <path d="M8 2v4M16 2v4M3 10h18" />
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                        </svg>
                      </span>
                      <div className="mx-row-main">
                        <div className="mx-row-title" style={{ fontSize: 13.5 }}>{item.title}</div>
                        <div className="mx-row-desc" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span className="platform-dot" style={{ background: CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8", width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                          <span>{mobilePlatformName(item.platform)}</span>
                          <span style={{ color: "rgba(219,234,254,.6)" }}>
                            {fmtTime(item.time)}
                            {item.isRescheduled ? " · 已改期" : ""}
                          </span>
                        </div>
                        {rescheduleId === item.id ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                            <input
                              type="datetime-local"
                              value={rescheduleAt}
                              onChange={(e) => setRescheduleAt(e.target.value)}
                              style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 8, color: "#dbe7f5", padding: "7px 10px", fontSize: 12, flex: 1, minWidth: 160 }}
                            />
                            <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "7px 12px" }} disabled={actingId === item.id} onClick={() => void submitReschedule()}>
                              确认改期
                            </button>
                            <button type="button" style={{ fontSize: 12, padding: "7px 12px", background: "transparent", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, color: "#dbe7f5" }} onClick={() => setRescheduleId(null)}>
                              取消
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <span className="mx-badge" style={{ background: `${CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8"}22`, color: CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8", border: `1px solid ${CALENDAR_STATUS_COLOR[item.status] ?? "#94a3b8"}55` }}>
                          {CALENDAR_STATUS_LABEL[item.status] ?? item.status}
                        </span>
                        {canOperate ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              style={{ fontSize: 11, padding: "4px 9px", background: "transparent", border: "1px solid rgba(234,161,75,.45)", borderRadius: 7, color: "#e8a64e" }}
                              disabled={actingId === item.id}
                              onClick={() => openReschedule(item.id)}
                            >
                              改期
                            </button>
                            <button
                              type="button"
                              style={{ fontSize: 11, padding: "4px 9px", background: "transparent", border: "1px solid rgba(220,38,38,.45)", borderRadius: 7, color: "#f87171" }}
                              disabled={actingId === item.id}
                              onClick={() => void doCancel(item.id)}
                            >
                              {actingId === item.id ? "处理中…" : "取消"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ))
        )}
      </div>
      {modal}
    </div>
  );
}

function MobilePublishView({
  items,
  stats,
  loading,
}: {
  items: PublishItem[];
  stats: { pending: number; queued: number; doneToday: number; failed: number };
  loading: boolean;
}) {
  const [filter, setFilter] = React.useState<PublishStatus | "all">("all");
  const [activeTab, setActiveTab] = React.useState<"tasks" | "calendar">("tasks");
  const visible =
    filter === "all" ? items : items.filter((i) => i.status === filter);

  const filters: Array<{ key: PublishStatus | "all"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "pending", label: "待确认" },
    { key: "queued", label: "排队中" },
    { key: "done", label: "已完成" },
    { key: "failed", label: "失败" },
  ];

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">发布</h1>
            <p className="mx-page-sub">发布准备 · 任务 · 记录</p>
          </div>
          <Link
            href="/distribution/articles"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
            新建发布
          </Link>
        </div>
      </header>

      {/* 任务 / 日历 Tab */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {([
            { key: "tasks", label: "发布任务" },
            { key: "calendar", label: "发布日历" },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="chip"
              style={{
                flex: 1,
                padding: "9px 0",
                fontSize: 13,
                ...(activeTab === tab.key
                  ? { background: "linear-gradient(135deg,#f4bb67,#d98a2d)", color: "#1b1e2b", borderColor: "transparent", fontWeight: 600 }
                  : {}),
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "calendar" ? (
        <PublishCalendarView />
      ) : (
        <>
      {/* 发布待办 hero */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-hero" style={{ padding: 20 }}>
          <div className="mx-hero-ring" style={{ width: 130, height: 130, top: -34, right: -26 }} />
          <div className="mx-hero-ring" style={{ width: 82, height: 82, top: 14, right: 22, borderColor: "rgba(240,179,90,.15)" }} />
          <div style={{ position: "relative", zIndex: 2 }}>
            <span className="mx-badge mx-badge-white" style={{ marginBottom: 10 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              发布待办
            </span>
            {loading ? (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>正在汇总发布任务…</h2>
            ) : stats.pending > 0 || stats.queued > 0 ? (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                {stats.pending > 0 ? `${stats.pending} 个结果等你确认` : `${stats.queued} 个任务排队中`}
                <br />
                <span style={{ color: "#f4bb67" }}>
                  {stats.failed > 0 ? `${stats.failed} 个失败待重试` : "一切正常"}
                </span>
              </h2>
            ) : (
              <h2 style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.3 }}>
                暂无待办发布<br />
                <span style={{ color: "#f4bb67" }}>今日已发布 {stats.doneToday} 条</span>
              </h2>
            )}
            <p className="mx-page-sub" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "rgba(219,234,254,.78)" }}>
              发布包准备好后，请到目标平台 App 完成发布 · 手机端不自动发布
            </p>
            {!loading && (stats.pending > 0 || stats.failed > 0) ? (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                {stats.pending > 0 ? (
                  <Link
                    href="/distribution/tasks"
                    className="mx-btn-gold"
                    style={{ textDecoration: "none" }}
                    onClick={(e) => { e.preventDefault(); setFilter("pending"); }}
                  >
                    去确认
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                  </Link>
                ) : null}
                {stats.failed > 0 ? (
                  <button
                    type="button"
                    className="mx-btn-gold"
                    style={{ background: "rgba(255,255,255,.08)", color: "#dbe7f5", border: "1px solid rgba(255,255,255,.2)", boxShadow: "none", backgroundImage: "none" }}
                    onClick={() => setFilter("failed")}
                  >
                    查看失败
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* 统计 + 筛选 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-stat-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{stats.pending}</div><div className="mx-stat-label">待确认</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text">{stats.queued}</div><div className="mx-stat-label">排队中</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num">{stats.doneToday}</div><div className="mx-stat-label">今日已发</div></div>
          <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: "#dc2626" }}>{stats.failed}</div><div className="mx-stat-label">失败</div></div>
        </div>
      </section>

      {/* 状态筛选 chips */}
      <section style={{ marginTop: 16 }}>
        <div className="chip-row">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`chip${filter === f.key ? " active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </section>

      {/* 任务列表 */}
      <section className="mx-px" style={{ paddingBottom: 28 }}>
        <div className="mx-card mx-list-card">
          {loading ? (
            <div>
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
              <SkeletonRow width="76%" />
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-empty">
              <p>{filter === "all" ? "还没有发布任务" : `没有「${MOBILE_STATUS_LABEL[filter as PublishStatus] ?? filter}」的任务`}</p>
              <Link href="/distribution/articles" className="mx-btn-gold" style={{ marginTop: 12, textDecoration: "none" }}>
                新建发布
              </Link>
            </div>
          ) : (
            visible.map((item) => (
              <div className="mx-row" key={item.id}>
                <span className="mx-row-ic" style={{ background: "rgba(234,161,75,.12)", color: "#c87922" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0Z" />
                  </svg>
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">{item.title}</div>
                  <div className="mx-row-desc" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="platform-dot" style={{ background: MOBILE_STATUS_DOT[item.status], boxShadow: `0 0 0 3px ${MOBILE_STATUS_DOT[item.status]}22`, width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                    {mobilePlatformName(item.platforms[0] || "未指定平台")}
                    {item.failReason ? ` · ${item.failReason}` : ""}
                  </div>
                </div>
                <div className="mx-row-right">
                  <span className={MOBILE_STATUS_BADGE[item.status]}>{MOBILE_STATUS_LABEL[item.status]}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
        </>
      )}
    </div>
  );
}
