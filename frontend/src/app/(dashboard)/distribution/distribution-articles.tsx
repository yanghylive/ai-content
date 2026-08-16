"use client";

import { SkeletonRow } from "@/components/skeleton";

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
import { useIsMobile } from "@/lib/hooks/use-media-query";

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
  const [keyword, setKeyword] = useState("");

  const fetchArticles = useCallback(async (kw?: string) => {
    try {
      setLoading(true);
      const data = await dashboardApi.draftArticles(50, kw);
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

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state */
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <button type="button" className="mx-control" aria-label="返回" style={{ width: 38, height: 38, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#16335d", flexShrink: 0 }} onClick={() => router.push("/distribution")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="mx-page-title" style={{ fontSize: 22 }}>待发布文章</h1>
              <p className="mx-page-sub">AI 已生成好内容，确认后就能发布</p>
            </div>
            <span className="mx-badge mx-badge-gold">{loading ? "加载中" : `${articles.length} 篇待发布`}</span>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: "rgba(239,68,68,.09)", fontSize: 12, color: "#dc2626" }}>{error}</div>
          )}
          <div className="mx-card mx-list-card">
            {loading ? (
              <div>
                <SkeletonRow width="70%" />
                <SkeletonRow width="58%" />
              </div>
            ) : articles.length === 0 ? (
              <div className="mx-empty">
                <p>没有待发布的文章</p>
                <p style={{ marginTop: 4 }}>系统生成新内容后会出现在这里</p>
              </div>
            ) : (
              articles.map((article) => (
                <div className="mx-row" key={article.id}>
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z" /><path d="M14 3v4a2 2 0 0 0 2 2h4" /></svg>
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title">{article.title || "未命名"}</div>
                    <div className="mx-row-desc">
                      {FORMAT_LABELS[article.contentFormat] || article.contentFormat}
                      {article.topicTitle ? ` · 选题：${article.topicTitle}` : ""}
                      {article.createdAt ? ` · ${new Date(article.createdAt).toLocaleDateString("zh-CN")}` : ""}
                    </div>
                  </div>
                  <div className="mx-row-right">
                    <button type="button" className="mx-btn-gold" style={{ fontSize: 11, padding: "7px 12px" }} onClick={() => router.push(`/distribution/publish-article?articleId=${article.id}`)}>去发布</button>
                  </div>
                </div>
              ))
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
        <div className="mt-4 flex items-center gap-2">
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void fetchArticles(keyword);
            }}
            placeholder="按标题关键词筛选"
            className="flex-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 py-2 text-sm text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)]"
          />
          <V2GhostButton onClick={() => void fetchArticles(keyword)}>
            搜索
          </V2GhostButton>
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
                    router.push(`/distribution/publish-article?articleId=${article.id}`)
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
