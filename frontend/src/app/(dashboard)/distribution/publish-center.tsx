"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plus,
  Send,
  Video,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { autoUploadApi } from "@/lib/api/auto-upload";
import { LocalBridgeStatus } from "./local-bridge-status";

type PublishStatus = "draft" | "pending" | "queued" | "done" | "failed";

type PublishItem = {
  id: string;
  title: string;
  type: "article" | "video";
  status: PublishStatus;
  platforms: string[];
  scheduledAt?: string;
  progress?: string;
  failReason?: string;
};

const STATUS_CONFIG: Record<
  PublishStatus,
  { label: string; icon: LucideIcon; color: string }
> = {
  draft: { label: "草稿", icon: FileText, color: "var(--kaypal-v3-muted)" },
  pending: { label: "待确认", icon: Clock, color: "var(--kaypal-v3-amber)" },
  queued: { label: "排队中", icon: Loader2, color: "var(--kaypal-v3-accent)" },
  done: { label: "已完成", icon: CheckCircle2, color: "var(--kaypal-v3-success)" },
  failed: { label: "失败", icon: XCircle, color: "var(--kaypal-v3-danger)" },
};

// 预览用示例数据（正式接入时替换为后端发布任务接口）
export function PublishCenter() {
  const [items, setItems] = useState<PublishItem[]>([]);
  const [loading, setLoading] = useState(true);

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
                : s.startsWith("waiting") || s === "pending"
                  ? "pending"
                  : s === "queued" || s === "running" || s === "publishing" || s === "claimed"
                    ? "queued"
                    : "draft";
          return {
            id: String(task.id),
            title: task.title || `任务 #${task.id}`,
            type: (task as { contentKind?: string }).contentKind === "video" ? "video" : "article",
            status,
            platforms: task.platform ? [task.platform] : [],
            failReason: status === "failed" ? (task.message ?? undefined) : undefined,
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
    const hasActive = items.some((t) => t.status === "queued" || t.status === "pending");
    if (!hasActive) return;
    const timer = setInterval(() => void fetchTasks(), 5000);
    return () => clearInterval(timer);
  }, [items, fetchTasks]);

  const stats = useMemo(
    () => ({
      pending: items.filter((i) => i.status === "pending").length,
      queued: items.filter((i) => i.status === "queued").length,
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
        { status: "done", items: items.filter((i) => i.status === "done") },
        {
          status: "failed",
          items: items.filter((i) => i.status === "failed"),
        },
      ],
      [items],
    );

  const primaryAction = (item: PublishItem) => {
    if (item.status === "pending") return { label: "确认发布", primary: true };
    if (item.status === "failed") return { label: "重试", primary: true };
    if (item.status === "draft") return { label: "继续编辑", primary: true };
    return null;
  };

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
              {loading ? "正在加载..." : `你有 ${stats.pending} 个内容待确认发布`}
            </p>
          </div>
          {/* 单一主行动 */}
          <Link
            href="/distribution-v2/articles"
            className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
          >
            <Plus className="h-5 w-5" />
            新建发布
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--kaypal-v3-muted)]">待确认</p>
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
              href="/local-engine-v2"
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
            内容从待确认到完成的全过程
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
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
                              {item.failReason && (
                                <p className="mt-1.5 text-xs text-[var(--kaypal-v3-danger)]">
                                  {item.failReason}
                                </p>
                              )}
                              {action && (
                                <button
                                  type="button"
                                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
                                >
                                  {item.status === "pending" && (
                                    <Send className="h-3.5 w-3.5" />
                                  )}
                                  {action.label}
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
            { key: "materials", title: "素材库", href: "/materials-v2" },
            { key: "accounts", title: "发布账号", href: "/platforms-v2" },
            { key: "compliance", title: "合规检查", href: "/compliance-v2" },
            { key: "engine", title: "发布引擎", href: "/local-engine-v2" },
            { key: "logs", title: "发布日志", href: "/local-engine-v2/logs" },
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
