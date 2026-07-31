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
