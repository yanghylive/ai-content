"use client";

import { SkeletonList, SkeletonRow } from "@/components/skeleton";
import { PlatformBadge } from "@/components/platform-badge";
import { BrandLogo } from "@/components/brand-logo";
import { statusGroup } from "@/lib/publish-status";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCcw, Send, Trash2 } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import {
  autoUploadApi,
  buildRiskConfirmation,
  type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { toActionableError } from "@/lib/public-error";

type FilterKey = "all" | "pending" | "done" | "failed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "pending", label: "进行中" },
  { key: "done", label: "成功" },
  { key: "failed", label: "失败" },
];

// 单页任务条数（后端 listPage pageSize 上限 100，取 80 留余量）
const PAGE_SIZE = 80;

/* 平台主题色（P1-10：平台图标统一占位——平台名首字符 + 主题色圆角容器） */
const PLATFORM_THEME_COLORS: Record<string, string> = {
  douyin: "#fe2c55",
  xiaohongshu: "#ff2442",
  shipinhao: "#007fff",
  bilibili: "#00a1d6",
};

function platformThemeColor(platform?: string | null): string {
  const p = (platform || "").toLowerCase();
  if (p.includes("douyin") || p.includes("抖音")) return PLATFORM_THEME_COLORS.douyin;
  if (p.includes("xiaohongshu") || p.includes("小红书") || p.includes("xhs") || p.includes("红书"))
    return PLATFORM_THEME_COLORS.xiaohongshu;
  if (p.includes("shipinhao") || p.includes("视频号") || p.includes("微信") || p.includes("weixin"))
    return PLATFORM_THEME_COLORS.shipinhao;
  if (p.includes("bilibili") || p.includes("b站") || p.includes("bili"))
    return PLATFORM_THEME_COLORS.bilibili;
  return "var(--kaypal-v3-muted)";
}

function platformInitial(platform?: string | null): string {
  const p = (platform || "").trim();
  if (!p) return "未";
  return /[a-z]/i.test(p[0]) ? p[0].toUpperCase() : p[0];
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "accent" | "muted"> = {
  pending: "warning",
  done: "success",
  failed: "danger",
  other: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "进行中",
  done: "成功",
  failed: "失败",
  other: "其他",
};

function matchFilter(task: AutoUploadPublishTask, filter: FilterKey): boolean {
  if (filter === "all") return true;
  return statusGroup(task.status) === filter;
}

function groupOf(task: AutoUploadPublishTask): "pending" | "done" | "failed" | "other" {
  return statusGroup(task.status);
}

export function DistributionTasks() {
  const router = useRouter();
  const [tasks, setTasks] = useState<AutoUploadPublishTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AutoUploadPublishTask | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  };

  // 失败重试（与旧版一致：先创建重试确认，再 retry）
  const handleRetry = async (task: AutoUploadPublishTask) => {
    setRetryingId(task.id);
    setError(null);
    try {
      const confirmation = await autoUploadApi.createRetryTaskConfirmation(task.id);
      await autoUploadApi.retryTask(task.id, confirmation.confirmationId);
      flash("重试已开始，结果稍后看");
      await fetchTasks();
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setError(rawMessage || toPublicError(err, "重试失败，请稍后重试"));
    } finally {
      setRetryingId(null);
    }
  };

  // 删除任务（高风险操作，带风控确认）
  const handleDelete = async (task: AutoUploadPublishTask) => {
    setDeletingId(task.id);
    setError(null);
    try {
      await autoUploadApi.deleteTask(
        task.id,
        buildRiskConfirmation("local-file-delete", "high"),
      );
      flash("任务已删除");
      setViewing(null);
      await fetchTasks();
    } catch (err: unknown) {
      const rawMessage = toActionableError(err, "");
      setError(rawMessage || toPublicError(err, "删除失败，请稍后重试"));
    } finally {
      setDeletingId(null);
    }
  };

  const fetchTasks = useCallback(async (targetPage = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await autoUploadApi.taskPage({
        page: targetPage,
        pageSize: PAGE_SIZE,
      });
      const items = Array.isArray(result?.items) ? result.items : [];
      setTasks((prev) => (append ? [...prev, ...items] : items));
      setPage(targetPage);
      setTotalPages(result?.totalPages ?? 1);
    } catch (err: unknown) {
      setError(toPublicError(err, "发布任务暂时无法读取"));
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  // 加载更多（下一页 append）
  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return;
    void fetchTasks(page + 1, true);
  }, [loadingMore, page, totalPages, fetchTasks]);

  // 轮询刷新：重拉所有已加载页（1..page），保留多页不丢（报告 4.4）
  const refreshAll = useCallback(async () => {
    try {
      const results = await Promise.all(
        Array.from({ length: page }, (_, i) =>
          autoUploadApi.taskPage({ page: i + 1, pageSize: PAGE_SIZE }),
        ),
      );
      const all = results.flatMap((r) =>
        Array.isArray(r?.items) ? r.items : [],
      );
      setTasks(all);
      setTotalPages(results[0]?.totalPages ?? totalPages);
    } catch (err: unknown) {
      setError(toPublicError(err, "发布任务暂时无法读取"));
    }
  }, [page, totalPages]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // 有进行中任务时自动轮询（patch 全部已加载页，不重置到第一页）
  useEffect(() => {
    const hasActive = tasks.some(
      (t) => {
        const s = (t.status || "").toLowerCase();
        return s === "queued" || s === "claimed" || s === "running" || s === "pending" || s === "publishing" || s === "waiting";
      },
    );
    if (!hasActive) return;
    const timer = setInterval(() => void refreshAll(), 5000);
    return () => clearInterval(timer);
  }, [tasks, refreshAll]);

  const filtered = useMemo(
    () => tasks.filter((t) => matchFilter(t, filter)),
    [tasks, filter],
  );

  const counts = useMemo(() => {
    const result: Record<FilterKey, number> = { all: 0, pending: 0, done: 0, failed: 0 };
    tasks.forEach((t) => {
      result.all += 1;
      const group = statusGroup(t.status);
      if (group === "pending" || group === "done" || group === "failed") {
        result[group] += 1;
      }
    });
    return result;
  }, [tasks]);

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  if (isMobile) {
    const badgeOf = (group: "pending" | "done" | "failed" | "other") =>
      group === "pending" ? "mx-badge mx-badge-gold"
        : group === "done" ? "mx-badge mx-badge-green"
          : group === "failed" ? "mx-badge mx-badge-red"
            : "mx-badge";
    const openTask = (task: AutoUploadPublishTask) => setViewing(task);
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <BrandLogo />
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">发布任务</h1>
              <p className="mx-page-sub">每次发布的结果记录，成功失败都能追溯</p>
            </div>
          </div>
        </header>

        {/* 统计 */}
        <section className="mx-px" style={{ marginTop: 14 }}>
          <div className="mx-stat-grid">
            <div className="mx-stat-item mx-control"><div className="mx-stat-num">{counts.all}</div><div className="mx-stat-label">全部</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num mx-gold-text">{counts.pending}</div><div className="mx-stat-label">进行中</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: "var(--kaypal-v3-success)" }}>{counts.done}</div><div className="mx-stat-label">成功</div></div>
            <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ color: "var(--kaypal-v3-danger)" }}>{counts.failed}</div><div className="mx-stat-label">失败</div></div>
          </div>
        </section>

        {/* 筛选 chips（P1-9：底部留白 60px，避免被固定底部 tab bar 切掉一半） */}
        <section style={{ marginTop: 16, paddingBottom: 60 }}>
          <div className="chip-row">
            {FILTERS.map((f) => (
              <button key={f.key} type="button" className={`chip${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {/* 任务列表 */}
        <section className="mx-px" style={{ paddingBottom: 28 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</div>
          )}
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <SkeletonRow width="70%" />
                <SkeletonRow width="58%" />
                <SkeletonRow width="76%" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="mx-empty">
                <p>{filter === "all" ? "还没有发布任务" : `没有「${FILTERS.find((f) => f.key === filter)?.label}」的任务`}</p>
              </div>
            ) : (
              filtered.map((task) => {
                const group = statusGroup(task.status);
                return (
                  <button
                    key={task.id}
                    type="button"
                    className="mx-row"
                    style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                    onClick={() => openTask(task)}
                  >
                    {/* P1-10：平台图标统一占位——平台名首字符 + 主题色背景圆角容器（图标加载失败不再显示乱码） */}
                    <PlatformBadge platform={task.platform} size={36} solid />
                    <div className="mx-row-main">
                      <div className="mx-row-title">{task.title || `任务 #${task.id}`}</div>
                      <div className="mx-row-desc">
                        {task.platform || "未指定平台"}
                        {task.message ? ` · ${task.message}` : ""}
                      </div>
                    </div>
                    <div className="mx-row-right">
                      <span className={badgeOf(group)}>{STATUS_LABEL[group]}</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {page < totalPages && (
            <button
              type="button"
              className="mx-btn"
              style={{ marginTop: 12, width: "100%", justifyContent: "center" }}
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore
                ? "加载中…"
                : `加载更多（第 ${page}/${totalPages} 页）`}
            </button>
          )}
        </section>

        {/* 详情弹窗：复用桌面 fixed inset-0 弹窗（天然全屏） */}
        {viewing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] shadow-xl">
              <div className="flex items-start justify-between border-b border-[var(--kaypal-v3-border)] p-5">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">{viewing.title || `任务 #${viewing.id}`}</h3>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {viewing.platform || "未指定平台"} · {viewing.status || "未知状态"}
                    {viewing.message ? ` · ${viewing.message}` : ""}
                  </p>
                </div>
                <button type="button" className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]" onClick={() => setViewing(null)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                <p style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--kaypal-v3-soft-ink)" }}>
                  创建时间：{viewing.created_at ? new Date(viewing.created_at).toLocaleString("zh-CN") : "未知"}
                  {viewing.message ? <><br />信息：{viewing.message}</> : null}
                </p>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-[var(--kaypal-v3-border)] p-4">
                {groupOf(viewing) === "failed" ? (
                  <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "9px 14px" }} disabled={retryingId === viewing.id} onClick={() => void handleRetry(viewing)}>
                    <RefreshCcw size={14} style={{ marginRight: 4 }} /> 重试
                  </button>
                ) : null}
                <button type="button" className="btn btn-sm" style={{ border: "1px solid rgba(239,68,68,.35)", color: "var(--kaypal-v3-danger)", borderRadius: 10, padding: "7px 12px", fontSize: 12, fontWeight: 600 }} disabled={deletingId === viewing.id} onClick={() => void handleDelete(viewing)}>
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
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
            onClick={() => router.push("/distribution")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              发布任务
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              每次发布的结果记录，成功失败都能追溯
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filter === key
                ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
            {counts[key] > 0 && (
              <span className="ml-1.5 text-xs text-[var(--kaypal-v3-muted)]">
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <V2EmptyState
            icon={Send}
            title={filter === "all" ? "还没有发布记录" : `没有${FILTERS.find((f) => f.key === filter)?.label}的任务`}
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {filtered.map((task) => {
              const group = statusGroup(task.status);
              return (
                <div key={task.id} className="flex items-center justify-between p-5">
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => setViewing(task)}
                  >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-[var(--kaypal-v3-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)]">
                        {task.title || `任务 #${task.id}`}
                      </h3>
                      <V2StatusChip tone={STATUS_TONE[group]}>
                        {STATUS_LABEL[group]}
                      </V2StatusChip>
                    </div>
                    <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                      {task.platform ? `${task.platform}` : ""}
                      {task.dry_run ? " · 试运行" : ""}
                      {task.created_at
                        ? ` · ${new Date(task.created_at).toLocaleString("zh-CN")}`
                        : ""}
                    </p>
                    {task.message && group === "failed" && (
                      <p className="mt-1 text-sm text-[var(--kaypal-v3-danger)]">
                        失败原因：{task.message}
                      </p>
                    )}
                  </div>
                  </button>
                  {group === "failed" && (
                    <div className="flex items-center gap-2">
                      <V2GhostButton
                        icon={RefreshCcw}
                        loading={retryingId === task.id}
                        onClick={() => void handleRetry(task)}
                      >
                        重试
                      </V2GhostButton>
                      <V2DangerButton
                        icon={Trash2}
                        loading={deletingId === task.id}
                        onClick={() => void handleDelete(task)}
                      >
                        删除
                      </V2DangerButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      {page < totalPages && (
        <div className="flex justify-center">
          <V2GhostButton loading={loadingMore} onClick={loadMore}>
            {loadingMore
              ? "加载中…"
              : `加载更多（第 ${page}/${totalPages} 页）`}
          </V2GhostButton>
        </div>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push("/distribution")}>
          返回
        </V2GhostButton>
      </section>

      {notice && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">{notice}</p>
        </div>
      )}

      {/* 任务详情弹窗 */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--kaypal-v3-ink)]">
                {viewing.title || `任务 #${viewing.id}`}
              </h3>
              <button
                type="button"
                className="rounded-full p-1 text-[var(--kaypal-v3-muted)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                onClick={() => setViewing(null)}
              >
                ×
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <V2StatusChip tone={STATUS_TONE[statusGroup(viewing.status)]}>
                  {STATUS_LABEL[statusGroup(viewing.status)]}
                </V2StatusChip>
                {viewing.platform && (
                  <span className="text-sm text-[var(--kaypal-v3-muted)]">{viewing.platform}</span>
                )}
              </div>
              <div className="rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-sm">
                <p><strong>任务 ID：</strong>{viewing.id}</p>
                <p className="mt-1"><strong>创建时间：</strong>{viewing.created_at ? new Date(viewing.created_at).toLocaleString("zh-CN") : "-"}</p>
                {viewing.dry_run ? <p className="mt-1"><strong>模式：</strong>试运行</p> : null}
                {viewing.message ? (
                  <p className="mt-1"><strong>结果信息：</strong>{viewing.message}</p>
                ) : null}
              </div>
              {statusGroup(viewing.status) === "failed" && (
                <div className="flex justify-end gap-2">
                  <V2GhostButton
                    icon={Trash2}
                    loading={deletingId === viewing.id}
                    onClick={() => void handleDelete(viewing)}
                  >
                    删除
                  </V2GhostButton>
                  <V2PrimaryButton
                    icon={RefreshCcw}
                    loading={retryingId === viewing.id}
                    onClick={() => {
                      void handleRetry(viewing);
                      setViewing(null);
                    }}
                  >
                    重试这个任务
                  </V2PrimaryButton>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
