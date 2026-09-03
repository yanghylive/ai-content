"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, Layers } from "@/components/iconpark";
import type { CaseSummaryDto } from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { ProvenanceBadge } from "./provenance-badge";

/**
 * CaseCard 四变体：Standard / Compact / Featured / Skeleton。
 * 图片加载失败时显示品牌占位（图标 + 底色），不裸图报错。
 */

export type CaseCardVariant = "standard" | "compact" | "featured";

function formatUpdatedAt(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function primaryIndustryLabel(item: CaseSummaryDto): string {
  return item.industries?.[0] ?? "";
}

function CoverImage({
  item,
  className,
  iconClassName = "h-8 w-8",
}: {
  item: CaseSummaryDto;
  className: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = item.coverMedia?.url ?? item.coverMedia?.thumbnailUrl ?? null;

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{
          background: "var(--kaypal-v3-accent-soft)",
          color: "var(--kaypal-v3-accent-ink)",
        }}
        aria-label={`${item.title} 封面占位`}
      >
        <Briefcase className={iconClassName} aria-hidden />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={item.coverMedia?.altText || item.title}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function StandardCard({
  item,
  cardRef,
}: {
  item: CaseSummaryDto;
  cardRef?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <Link
      ref={cardRef}
      href={`/cases/${item.slug}`}
      className="group kaypal-v3-panel flex h-full flex-col overflow-hidden transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-[var(--kaypal-v3-elevated-shadow)]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--kaypal-v3-paper-muted)]">
        <CoverImage
          item={item}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <ProvenanceBadge provenanceType={item.provenanceType} size="sm" />
          {item.experienceStatus && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-11 font-semibold leading-none"
              style={{
                background: "var(--kaypal-v3-success-soft)",
                color: "var(--kaypal-v3-success)",
              }}
            >
              可体验
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-base font-semibold text-[var(--kaypal-v3-ink)] group-hover:text-[var(--kaypal-v3-accent-ink)]">
          {item.title}
        </h3>
        {item.subtitle && (
          <p className="line-clamp-2 text-sm text-[var(--kaypal-v3-muted)]">
            {item.subtitle}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2 text-xs text-[var(--kaypal-v3-muted)]">
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {primaryIndustryLabel(item) || "未分类"}
          </span>
          <span>{formatUpdatedAt(item.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function CompactCard({
  item,
  cardRef,
}: {
  item: CaseSummaryDto;
  cardRef?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <Link
      ref={cardRef}
      href={`/cases/${item.slug}`}
      className="group kaypal-v3-panel flex items-center gap-3 p-3 transition hover:border-[var(--kaypal-v3-accent)]"
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)]">
        <CoverImage item={item} className="h-full w-full object-cover" iconClassName="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--kaypal-v3-ink)] group-hover:text-[var(--kaypal-v3-accent-ink)]">
          {item.title}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <ProvenanceBadge provenanceType={item.provenanceType} size="sm" />
          <span className="truncate text-xs text-[var(--kaypal-v3-muted)]">
            {formatUpdatedAt(item.updatedAt)}
          </span>
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" aria-hidden />
    </Link>
  );
}

function FeaturedCard({
  item,
  cardRef,
}: {
  item: CaseSummaryDto;
  cardRef?: RefObject<HTMLAnchorElement | null>;
}) {
  return (
    <Link
      ref={cardRef}
      href={`/cases/${item.slug}`}
      className="group kaypal-v3-panel flex h-full flex-col overflow-hidden transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-[var(--kaypal-v3-elevated-shadow)]"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--kaypal-v3-paper-muted)]">
        <CoverImage
          item={item}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          iconClassName="h-10 w-10"
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <ProvenanceBadge provenanceType={item.provenanceType} />
          {item.experienceStatus && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-11 font-semibold leading-none"
              style={{
                background: "var(--kaypal-v3-success-soft)",
                color: "var(--kaypal-v3-success)",
              }}
            >
              可体验
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 text-lg font-bold text-[var(--kaypal-v3-ink)] group-hover:text-[var(--kaypal-v3-accent-ink)]">
          {item.title}
        </h3>
        {item.subtitle && (
          <p className="line-clamp-3 text-sm text-[var(--kaypal-v3-soft-ink)]">
            {item.subtitle}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2 text-xs text-[var(--kaypal-v3-muted)]">
          <span>{primaryIndustryLabel(item) || "未分类"}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--kaypal-v3-accent)]">
            查看详情
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  );
}

export function CaseCard({
  item,
  variant = "standard",
}: {
  item: CaseSummaryDto;
  variant?: CaseCardVariant;
}) {
  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const reportedRef = useRef(false);

  // 卡片进入可视区上报 case_impression（IntersectionObserver，防重复上报）
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const report = () => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      trackCaseEvent("case_impression", {
        case_id: item.id,
        case_slug: item.slug,
        placement: variant,
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      // 环境不支持观察器时降级直接上报一次，避免漏报
      report();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            report();
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id, item.slug, variant]);

  if (variant === "compact") return <CompactCard item={item} cardRef={cardRef} />;
  if (variant === "featured") return <FeaturedCard item={item} cardRef={cardRef} />;
  return <StandardCard item={item} cardRef={cardRef} />;
}

export function CaseCardSkeleton({ variant = "standard" }: { variant?: "standard" | "compact" | "featured" }) {
  if (variant === "compact") {
    return (
      <div className="kaypal-v3-panel flex animate-pulse items-center gap-3 p-3">
        <div className="h-14 w-14 shrink-0 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-paper-muted)]" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-3/4 rounded bg-[var(--kaypal-v3-paper-muted)]" />
          <div className="h-3 w-1/2 rounded bg-[var(--kaypal-v3-paper-muted)]" />
        </div>
      </div>
    );
  }
  const ratio = variant === "featured" ? "aspect-[16/9]" : "aspect-[16/10]";
  return (
    <div className="kaypal-v3-panel animate-pulse overflow-hidden">
      <div className={`w-full ${ratio} bg-[var(--kaypal-v3-paper-muted)]`} />
      <div className="space-y-3 p-4">
        <div className="h-4 w-1/4 rounded bg-[var(--kaypal-v3-paper-muted)]" />
        <div className="h-4 w-full rounded bg-[var(--kaypal-v3-paper-muted)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--kaypal-v3-paper-muted)]" />
      </div>
    </div>
  );
}
