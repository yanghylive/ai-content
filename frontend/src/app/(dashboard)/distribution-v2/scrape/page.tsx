"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";

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

  const handleScrape = useCallback(async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setArticle(null);
    try {
      const result = await api.post<ScrapedArticle>("/auto-upload/scrape-article", { url: url.trim() });
      setArticle(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "提取失败，请检查链接是否有效");
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
    router.push(`/distribution-v2/publish-article?${params.toString()}`);
  }, [article, router]);

  const handleCopyContent = useCallback(() => {
    if (!article) return;
    void navigator.clipboard.writeText(article.content);
  }, [article]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">文章反抓</h1>
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
          className="flex-1 px-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleScrape}
          disabled={loading || !url.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-blue-700"
        >
          {loading ? "提取中..." : "提取内容"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
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
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
              {article.warning}
            </div>
          )}

          <div
            className="text-sm text-muted-foreground line-clamp-4 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: article.content.slice(0, 500) + "..." }}
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
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              用作发布素材
            </button>
            <button
              onClick={handleCopyContent}
              className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              复制正文
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
