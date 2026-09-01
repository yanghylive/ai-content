"use client";

import { useConfirm } from "@/hooks/use-confirm";
import { SkeletonList, SkeletonRow } from "@/components/skeleton";

import { BrandLogo } from "@/components/brand-logo";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  MessageCircle,
  PenLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
  V2DangerButton,
} from "@/components/v2/ui-kit";
import { addToast } from "@heroui/react";
import { articlesApi, type Article } from "@/lib/api/articles";
import { dashboardApi } from "@/lib/api/dashboard";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const STATUS_LABELS: Record<string, { label: string; tone: "success" | "warning" | "accent" | "muted" | "danger" }> = {
  draft: { label: "草稿", tone: "muted" },
  pending: { label: "待确认", tone: "warning" },
  published: { label: "已发布", tone: "success" },
  approved: { label: "已确认", tone: "success" },
  failed: { label: "失败", tone: "danger" },
};

export function ArticleList({
  contentType = "article",
  title = "内容生成",
  subtitle = "AI 生成的所有内容，确认后就能发布",
  emptyTitle = "还没有内容",
  emptyActionLabel = "生成新内容",
  createHref = "/content/workspace?create=true",
  backHref = "/content/workspace",
  backLabel = "返回内容工作室",
}: {
  contentType?: "article" | "xiaohongshu";
  title?: string;
  subtitle?: string;
  emptyTitle?: string;
  emptyActionLabel?: string;
  createHref?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const { confirm, modal } = useConfirm();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attribution, setAttribution] = useState<
    Record<string, { publishCount: number; interactionCount: number }>
  >({});

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await articlesApi.list({ contentType, limit: 60 });
      const list = Array.isArray(data)
        ? data
        : (data as { items?: Article[] }).items || [];
      setArticles(list);
      // 归因链（阶段 B）：批量查每篇内容的发布数/互动数（前 20 篇）
      void Promise.all(
        list.slice(0, 20).map(async (a) => {
          try {
            const att = await dashboardApi.contentAttribution(a.id);
            return [a.id, att] as const;
          } catch {
            return [a.id, null] as const;
          }
        }),
      ).then((rows) => {
        const map: Record<string, { publishCount: number; interactionCount: number }> = {};
        for (const [id, att] of rows) {
          if (att) {
            map[id] = {
              publishCount: att.publishCount,
              interactionCount: att.interactionCount,
            };
          }
        }
        setAttribution(map);
      });
    } catch (err: unknown) {
      setError(toPublicError(err, "加载内容失败"));
    } finally {
      setLoading(false);
    }
  }, [contentType]);

  const handleDelete = useCallback(
    async (article: Article) => {
      const title = article.title || "未命名";
      const ok = await confirm({ kind: "danger", title: "删除文章", description: `确定删除「${title}」吗？删除后不可恢复。` });
      if (!ok) {
        return;
      }
      try {
        await articlesApi.remove(article.id);
        addToast({ title: "删除成功", color: "success" });
        void fetchArticles();
      } catch (err: unknown) {
        addToast({
          title: "删除失败",
          description: toPublicError(err, "内容未能删除，请稍后重试。"),
          color: "danger",
        });
      }
    },
    [fetchArticles, confirm],
  );

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

  const isXhs = contentType === "xiaohongshu";
  const TypeIcon = isXhs ? MessageCircle : FileText;

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state */
  const isMobile = useIsMobile();
  if (isMobile) {
    const openArticle = (article: Article) => {
      if (isXhs) {
        router.push(`/content/xiaohongshu?legacy=1&note=${article.id}`);
      } else {
        router.push(`/content/workspace?article=${article.id}`);
      }
    };
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <BrandLogo />
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">{title}</h1>
              <p className="mx-page-sub">{subtitle}</p>
            </div>
            <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "8px 14px" }} onClick={() => router.push(createHref)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
              新建
            </button>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
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
            ) : articles.length === 0 ? (
              <div className="mx-empty">
                <p>{emptyTitle}</p>
                <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={() => router.push(createHref)}>{emptyActionLabel}</button>
              </div>
            ) : (
              articles.map((article) => {
                const status = STATUS_LABELS[article.status] || { label: article.status || "草稿", tone: "muted" };
                const displayTitle = isXhs
                  ? article.xiaohongshuData?.title || article.title || "未命名笔记"
                  : article.title || "未命名";
                const badgeClass =
                  status.tone === "success" ? "mx-badge mx-badge-green"
                    : status.tone === "warning" ? "mx-badge mx-badge-gold"
                      : status.tone === "danger" ? "mx-badge mx-badge-red"
                        : "mx-badge";
                return (
                  <div
                    key={article.id}
                    className="mx-row"
                    style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                  >
                    <button
                      type="button"
                      onClick={() => openArticle(article)}
                      style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0 }}
                    >
                      <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}>
                        {isXhs ? <MessageCircle size={18} /> : <PenLine size={18} />}
                      </span>
                      <div className="mx-row-main" style={{ flex: 1, minWidth: 0 }}>
                        <div className="mx-row-title">{displayTitle}</div>
                        <div className="mx-row-desc">
                          {article.createdAt ? new Date(article.createdAt).toLocaleString("zh-CN") : ""}
                        </div>
                      </div>
                    </button>
                    <div className="mx-row-right" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span className={badgeClass}>{status.label}</span>
                      <button
                        type="button"
                        aria-label={`删除${displayTitle}`}
                        onClick={() => handleDelete(article)}
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "none", border: "none", color: "var(--kaypal-v3-danger)", cursor: "pointer", flexShrink: 0 }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {modal}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push(backHref)}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
              {title}
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">{subtitle}</p>
          </div>
          <V2PrimaryButton icon={Sparkles} onClick={() => router.push(createHref)}>
            {emptyActionLabel}
          </V2PrimaryButton>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      <V2Section padding={false}>
        {loading ? (
          <div className="p-12 text-center">
            <SkeletonList rows={5} />
          </div>
        ) : articles.length === 0 ? (
          <V2EmptyState
            icon={TypeIcon}
            title={emptyTitle}
            description={isXhs ? "生成第一篇小红书笔记" : "让 AI 帮你生成第一篇内容"}
            action={
              <V2PrimaryButton icon={Sparkles} onClick={() => router.push(createHref)}>
                {emptyActionLabel}
              </V2PrimaryButton>
            }
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {articles.map((article) => {
              const status = STATUS_LABELS[article.status] || {
                label: article.status || "草稿",
                tone: "muted" as const,
              };
              const displayTitle = isXhs
                ? article.xiaohongshuData?.title || article.title || "未命名笔记"
                : article.title || "未命名";
              return (
                <div key={article.id} className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-4">
                    <div className="kaypal-v3-icon-tile">
                      {isXhs ? (
                        <MessageCircle className="h-5 w-5" />
                      ) : (
                        <PenLine className="h-5 w-5" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-[var(--kaypal-v3-ink)]">
                          {displayTitle}
                        </h3>
                        <V2StatusChip tone={status.tone}>{status.label}</V2StatusChip>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {isXhs && article.xiaohongshuData?.hashtags?.length
                          ? article.xiaohongshuData.hashtags
                              .slice(0, 3)
                              .map((t) => `#${t}`)
                              .join(" ")
                          : ""}
                        {article.createdAt
                          ? ` ${new Date(article.createdAt).toLocaleString("zh-CN")}`
                          : ""}
                      </p>
                      {attribution[article.id] ? (
                        <p className="mt-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                          发布 {attribution[article.id].publishCount} 次 · 互动{" "}
                          {attribution[article.id].interactionCount} 条
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isXhs ? (
                      // 产品约束：小红书笔记只允许预览/下载，不允许编辑和分发
                      <V2GhostButton
                        icon={ArrowRight}
                        onClick={() =>
                          router.push(
                            `/content/xiaohongshu?legacy=1&note=${article.id}`,
                          )
                        }
                      >
                        预览/下载
                      </V2GhostButton>
                    ) : (
                      <V2GhostButton
                        icon={ArrowRight}
                        onClick={() =>
                          router.push(`/content/workspace?article=${article.id}`)
                        }
                      >
                        打开
                      </V2GhostButton>
                    )}
                    <V2DangerButton
                      icon={Trash2}
                      onClick={() => handleDelete(article)}
                    >
                      删除
                    </V2DangerButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} className="kx-back-to-parent" onClick={() => router.push(backHref)}>
          {backLabel}
        </V2GhostButton>
      </section>
    </div>
  );
}
