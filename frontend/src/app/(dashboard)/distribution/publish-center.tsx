"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useIsMobile } from "@/lib/hooks/use-media-query";
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

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

const MOBILE_STATUS_LABEL: Record<PublishStatus, string> = {
  draft: "草稿",
  pending: "待确认",
  queued: "排队中",
  done: "已完成",
  failed: "失败",
};

const MOBILE_STATUS_BADGE: Record<PublishStatus, string> = {
  draft: "mx-badge",
  pending: "mx-badge mx-badge-gold",
  queued: "mx-badge mx-badge-blue",
  done: "mx-badge mx-badge-green",
  failed: "mx-badge mx-badge-red",
};

const MOBILE_STATUS_DOT: Record<PublishStatus, string> = {
  draft: "#94a3b8",
  pending: "#d98a2d",
  queued: "#2563eb",
  done: "#059669",
  failed: "#dc2626",
};

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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">发布</h1>
            <p className="mx-page-sub">发布准备 · 任务 · 记录</p>
          </div>
          <Link
            href="/distribution-v2/articles"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
            新建发布
          </Link>
        </div>
      </header>

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
                    href="/distribution-v2/tasks"
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
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "76%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-empty">
              <p>{filter === "all" ? "还没有发布任务" : `没有「${MOBILE_STATUS_LABEL[filter as PublishStatus] ?? filter}」的任务`}</p>
              <Link href="/distribution-v2/articles" className="mx-btn-gold" style={{ marginTop: 12, textDecoration: "none" }}>
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
    </div>
  );
}
