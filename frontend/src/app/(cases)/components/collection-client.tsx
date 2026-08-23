"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { getCollection, type CollectionDto } from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { CaseCard } from "./case-card";
import { EmptyState, ErrorState } from "./case-states";
import { InquiryCta } from "./inquiry-form";

/**
 * 合集公开页客户端（M5 · 复用 CaseCard 与咨询 CTA）。
 * 展示合集标题/说明 + 仍发布的案例列表；无结果时给出空状态。
 */

export function CollectionClient({ slug }: { slug: string }) {
  const [collection, setCollection] = useState<CollectionDto | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "notfound"
  >("loading");
  const openedRef = useRef(false);

  // 合集加载成功后上报一次 collection_open（防重复上报）
  useEffect(() => {
    if (collection && !openedRef.current) {
      openedRef.current = true;
      trackCaseEvent("collection_open", {
        collection_id: collection.id,
        collection_slug: collection.slug,
      });
    }
  }, [collection]);

  const load = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    getCollection(slug)
      .then((data) => {
        if (cancelled) return;
        setCollection(data);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const statusCode =
          error && typeof error === "object" && "status" in error
            ? (error as { status?: number }).status
            : undefined;
        setStatus(statusCode === 404 ? "notfound" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="kaypal-v3-panel animate-pulse p-8">
          <div className="h-6 w-40 rounded bg-[var(--kaypal-v3-paper-muted)]" />
          <div className="mt-3 h-4 w-2/3 rounded bg-[var(--kaypal-v3-paper-muted)]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="kaypal-v3-panel h-56 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "error") {
    return <ErrorState onRetry={load} />;
  }

  if (status === "notfound" || !collection) {
    return (
      <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
          合集不存在、已下线或链接已过期
        </p>
        <p className="text-sm text-[var(--kaypal-v3-muted)]">
          该合集可能已被移除或分享链接有误。
        </p>
        <Link
          href="/cases"
          className="mt-2 inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          返回案例中心
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 合集头部：标题 + 说明 */}
      <section className="kaypal-v3-panel p-6 sm:p-8">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: "var(--kaypal-v3-accent-soft)",
            color: "var(--kaypal-v3-accent-ink)",
          }}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          案例合集
        </span>
        <h1 className="mt-3 kx-greet text-[var(--kaypal-v3-ink)]">
          {collection.title}
        </h1>
        {collection.description && (
          <p className="mt-2 whitespace-pre-line text-sm leading-7 text-[var(--kaypal-v3-soft-ink)]">
            {collection.description}
          </p>
        )}
      </section>

      {/* 案例列表 */}
      {collection.cases.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            合集中的案例
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collection.cases.map((item) => (
              <CaseCard key={item.id} item={item} variant="standard" />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="暂无案例"
          description="该合集暂无可展示的案例，部分案例可能已下线。"
        />
      )}

      {/* 咨询 CTA */}
      <InquiryCta
        sourceCollectionSlug={collection.slug}
        title="对合集中的方案感兴趣？"
        description="告诉我们你的场景，九章智能帮你匹配可落地的方案。"
      />
    </div>
  );
}
