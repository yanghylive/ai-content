"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Send } from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2GhostButton,
  V2EmptyState,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { dashboardApi, type DraftArticle } from "@/lib/api/dashboard";
import { toPublicError } from "@/lib/public-error";

const FORMAT_LABELS: Record<string, string> = {
  article: "图文",
  video: "视频",
  image: "图片",
};

export function DistributionArticles() {
  const router = useRouter();
  const [articles, setArticles] = useState<DraftArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await dashboardApi.draftArticles(50);
      setArticles(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(toPublicError(err, "加载草稿失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchArticles();
  }, [fetchArticles]);

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
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              待发布文章
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              AI 已生成好内容，确认后就能发布
            </p>
          </div>
          <V2StatusChip tone={articles.length > 0 ? "warning" : "success"}>
            {loading ? "加载中" : `${articles.length} 篇待发布`}
          </V2StatusChip>
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
            icon={FileText}
            title="没有待发布的文章"
            description="系统生成新内容后会出现在这里"
          />
        ) : (
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {articles.map((article) => (
              <div key={article.id} className="flex items-center justify-between p-5">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-[var(--kaypal-v3-ink)]">
                      {article.title || "未命名"}
                    </h3>
                    <V2StatusChip tone="accent">
                      {FORMAT_LABELS[article.contentFormat] || article.contentFormat}
                    </V2StatusChip>
                  </div>
                  <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                    {article.topicTitle ? `选题：${article.topicTitle}` : ""}
                    {article.templateName ? ` · 模板：${article.templateName}` : ""}
                    {article.createdAt
                      ? ` · ${new Date(article.createdAt).toLocaleString("zh-CN")}`
                      : ""}
                  </p>
                </div>
                <V2PrimaryButton
                  icon={Send}
                  onClick={() =>
                    router.push(`/distribution-v2/publish-article?articleId=${article.id}`)
                  }
                >
                  去发布
                </V2PrimaryButton>
              </div>
            ))}
          </div>
        )}
      </V2Section>

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/distribution")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
