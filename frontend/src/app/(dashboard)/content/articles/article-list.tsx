"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  MessageCircle,
  PenLine,
  Sparkles,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { articlesApi, type Article } from "@/lib/api/articles";
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
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await articlesApi.list({ contentType, limit: 60 });
      const list = Array.isArray(data)
        ? data
        : (data as { items?: Article[] }).items || [];
      setArticles(list);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载内容失败"));
    } finally {
      setLoading(false);
    }
  }, [contentType]);

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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" /></svg>
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
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "#dc2626" }}>{error}</div>
          )}
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
                <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "76%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
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
                  <button
                    key={article.id}
                    type="button"
                    className="mx-row"
                    style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
                    onClick={() => openArticle(article)}
                  >
                    <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb" }}>
                      {isXhs ? <MessageCircle size={18} /> : <PenLine size={18} />}
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{displayTitle}</div>
                      <div className="mx-row-desc">
                        {article.createdAt ? new Date(article.createdAt).toLocaleString("zh-CN") : ""}
                      </div>
                    </div>
                    <div className="mx-row-right">
                      <span className={badgeClass}>{status.label}</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
                    </div>
                  </button>
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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
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
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
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
                    </div>
                  </div>
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
                </div>
              );
            })}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push(backHref)}>
          {backLabel}
        </V2GhostButton>
      </section>
    </div>
  );
}
