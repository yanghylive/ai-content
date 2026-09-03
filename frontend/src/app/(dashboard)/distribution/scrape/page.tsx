"use client";

import { BrandLogo } from "@/components/brand-logo";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { sanitizeArticleHtml } from "@/lib/sanitize-article-html";
import { toActionableError } from "@/lib/public-error";

type ScrapedArticle = {
  url: string;
  title: string;
  content: string;
  contentFormat: string;
  images: Array<{ src: string; alt: string }>;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  scrapedAt: string;
  warning?: string;
};

export default function ScrapeArticlePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<ScrapedArticle | null>(null);
  const isMobile = useIsMobile();

  const handleScrape = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setArticle(null);
    try {
      const result = await api.post<ScrapedArticle>("/auto-upload/scrape-article", { url: url.trim() });
      setArticle(result);
    } catch (err: unknown) {
      setError(toActionableError(err, "提取失败，请检查链接是否有效"));
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleUseForPublish = useCallback(() => {
    if (!article) return;
    const params = new URLSearchParams({
      title: article.title,
      body: article.content,
    });
    router.push(`/distribution/publish-article?${params.toString()}`);
  }, [article, router]);

  const handleCopyContent = useCallback(() => {
    if (!article) return;
    void navigator.clipboard.writeText(article.content);
  }, [article]);

  /* 移动端（<768px）：明德 VP 风格，复用同一套 state/logic */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <V2BackButton />
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <BrandLogo />
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">文章反抓</h1>
              <p className="mx-page-sub">输入链接，一键提取文章内容</p>
            </div>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14 }}>
          {/* 输入区 */}
          <div className="mx-hero" style={{ padding: 16 }}>
            <div className="mx-hero-ring" style={{ width: 110, height: 110, top: -30, right: -22 }} />
            <div style={{ position: "relative", zIndex: 2 }}>
              <span className="mx-badge mx-badge-white" style={{ marginBottom: 10 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="12" height="12"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
                从链接提取
              </span>
              <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--kaypal-v3-soft-ink)", marginBottom: 12 }}>
                支持公众号文章、新闻页等，提取标题、正文和图片，可直接用作发布素材
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="url"
                  placeholder="https://mp.weixin.qq.com/s/xxxxx"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScrape()}
                  style={{
                    flex: 1, minWidth: 0, padding: "11px 14px", borderRadius: 12, fontSize: 13,
                    border: "1px solid var(--kaypal-v3-accent)", background: "var(--kaypal-v3-field-bg)",
                    color: "var(--kaypal-v3-ink)", outline: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={handleScrape}
                  disabled={loading || !url.trim()}
                  className="mx-btn-gold"
                  style={{ fontSize: 12, padding: "0 16px", flexShrink: 0, opacity: loading || !url.trim() ? 0.5 : 1 }}
                >
                  {loading ? "提取中…" : "提取"}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 14, padding: 14, border: "1px solid var(--kaypal-v3-danger)" }}>
              <p style={{ fontSize: 12.5, color: "var(--kaypal-v3-danger)" }}>{error}</p>
            </div>
          )}

          {article && (
            <div className="mx-card" style={{ marginTop: 14, padding: 16 }}>
              <div className="mx-row-main">
                <div className="mx-row-title" style={{ fontSize: 15, fontWeight: 700, whiteSpace: "normal" }}>{article.title}</div>
                <p style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>
                  {article.siteName ? `来源：${article.siteName} · ` : ""}
                  {article.author ? `作者：${article.author} · ` : ""}
                  {article.publishedAt ? `发布：${article.publishedAt}` : ""}
                </p>
              </div>

              {article.warning && (
                <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: "rgba(245,158,11,.1)", fontSize: 11, color: "var(--kaypal-v3-amber)" }}>
                  {article.warning}
                </div>
              )}

              <div
                className="mx-prose"
                style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.7, color: "var(--kaypal-v3-soft-ink)", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content.slice(0, 500)) + "..." }}
              />

              {article.images.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {article.images.slice(0, 8).map((img, i) => (
                    <div key={i} style={{ position: "relative" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.src}
                        alt={img.alt}
                        style={{ width: 72, height: 56, objectFit: "cover", borderRadius: 10, border: "1px solid var(--kaypal-v3-border)" }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  ))}
                  {article.images.length > 8 && (
                    <span style={{ fontSize: 10, color: "var(--kaypal-v3-muted)", display: "flex", alignItems: "center" }}>
                      +{article.images.length - 8} 张
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "9px 14px", flex: 1 }} onClick={handleUseForPublish}>
                  用作发布素材
                </button>
                <button type="button" className="mx-btn-gold" style={{ fontSize: 12, padding: "9px 14px", background: "var(--kaypal-v3-field-bg)", color: "var(--kaypal-v3-soft-ink)", border: "1px solid var(--kaypal-v3-border)", boxShadow: "none", backgroundImage: "none", flex: 1 }} onClick={handleCopyContent}>
                  复制正文
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="kx-greet">文章反抓</h1>
        <p className="text-sm text-muted-foreground mt-1">
          输入文章链接，自动提取标题、正文和图片，可直接用作发布素材
        </p>
      </div>

      <div className="flex gap-3">
        <input
          type="url"
          placeholder="https://mp.weixin.qq.com/s/xxxxx"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScrape()}
          className="flex-1 px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--kaypal-v3-accent)]"
        />
        <button
          onClick={handleScrape}
          disabled={loading || !url.trim()}
          className="px-6 py-2 bg-[image:var(--kaypal-v3-gradient-primary)] text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:brightness-105"
        >
          {loading ? "提取中..." : "提取内容"}
        </button>
      </div>

      {error && (
        <div className="p-4 border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] rounded-lg text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </div>
      )}

      {article && (
        <div className="border rounded-lg p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{article.title}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {article.siteName && `来源：${article.siteName} · `}
              {article.author && `作者：${article.author} · `}
              {article.publishedAt && `发布：${article.publishedAt}`}
            </p>
          </div>

          {article.warning && (
            <div className="p-3 border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] rounded text-xs text-[var(--kaypal-v3-amber)]">
              {article.warning}
            </div>
          )}

          <div
            className="text-sm text-muted-foreground line-clamp-4 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(article.content.slice(0, 500)) + "..." }}
          />

          {article.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {article.images.slice(0, 8).map((img, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.src}
                    alt={img.alt}
                    className="w-20 h-16 object-cover rounded border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              ))}
              {article.images.length > 8 && (
                <span className="text-xs text-muted-foreground flex items-center">
                  +{article.images.length - 8} 张
                </span>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleUseForPublish}
              className="px-4 py-2 bg-[image:var(--kaypal-v3-gradient-primary)] text-white rounded-lg text-sm font-medium hover:brightness-105"
            >
              用作发布素材
            </button>
            <button
              onClick={handleCopyContent}
              className="px-4 py-2 border border-[var(--kaypal-v3-border)] rounded-lg text-sm font-medium text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
            >
              复制正文
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
