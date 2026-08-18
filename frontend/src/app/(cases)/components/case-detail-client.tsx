"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CheckCircle2,
  Cpu,
  FileText,
  Lightbulb,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  getCase,
  getTaxonomies,
  type CaseDetailResult,
  type TaxonomyResult,
} from "@/lib/api/case-showcase";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { CaseHero } from "./case-hero";
import { MediaGallery } from "./media-gallery";
import { DemoEndpointPanel } from "./demo-endpoint-panel";
import { AttributionDisclaimer } from "./attribution-disclaimer";
import { RelatedCases } from "./related-cases";
import { ErrorState } from "./case-states";
import { InquiryCta } from "./inquiry-form";

const EVIDENCE_LABELS: Record<string, string> = {
  E0: "无证据",
  E1: "有初步证据",
  E2: "有部分实证",
  E3: "有强实证",
};

const DELIVERY_MODE_LABELS: Record<string, string> = {
  h5: "H5",
  web: "Web",
  wechat_mini_program: "微信小程序",
  download: "下载",
  appointment: "预约演示",
};

const MATURITY_LABELS: Record<string, string> = {
  concept: "概念",
  prototype: "原型",
  mvp: "MVP",
  product: "产品",
  scale: "规模化",
};

function buildNameMap(taxonomies: TaxonomyResult | null) {
  const map = new Map<string, string>();
  if (taxonomies) {
    for (const tax of [
      ...taxonomies.platform,
      ...taxonomies.industry,
      ...taxonomies.capability,
    ]) {
      map.set(tax.slug, tax.name);
    }
  }
  return map;
}

function SectionHeading({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
      {icon}
      {title}
    </h2>
  );
}

/** 主视觉媒体（PRD §9.5 第 2 步）：封面或首个媒体大图，失败回退品牌占位 */
function CaseVisual({ detail }: { detail: CaseDetailResult }) {
  const [failed, setFailed] = useState(false);
  const cover = detail.coverMedia;
  const firstMedia = detail.media?.[0];
  const url =
    cover?.url ??
    cover?.thumbnailUrl ??
    firstMedia?.fileUrl ??
    firstMedia?.externalUrl ??
    firstMedia?.thumbnailUrl ??
    null;
  const alt = cover?.altText ?? firstMedia?.altText ?? detail.title;

  if (!url || failed) {
    return (
      <div
        className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius)]"
        style={{
          background: "var(--kaypal-v3-accent-soft)",
          color: "var(--kaypal-v3-accent-ink)",
        }}
        role="img"
        aria-label={`${detail.title} 主视觉占位`}
      >
        <Briefcase className="h-10 w-10" aria-hidden />
        <span className="text-sm font-semibold text-[var(--kaypal-v3-muted)]">
          {detail.title}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="aspect-[16/9] w-full rounded-[var(--kaypal-v3-radius)] object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function CaseDetailClient({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<CaseDetailResult | null>(null);
  const [taxonomies, setTaxonomies] = useState<TaxonomyResult | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "notfound"
  >("loading");
  const openedRef = useRef(false);

  // 详情加载成功后上报一次 case_open（防重复上报）
  useEffect(() => {
    if (detail && !openedRef.current) {
      openedRef.current = true;
      trackCaseEvent("case_open", {
        case_id: detail.id,
        case_slug: detail.slug,
      });
    }
  }, [detail]);

  const load = useCallback(() => {
    let cancelled = false;
    setStatus("loading");
    getCase(slug)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
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

  useEffect(() => {
    let cancelled = false;
    getTaxonomies()
      .then((data) => {
        if (!cancelled) setTaxonomies(data);
      })
      .catch(() => {
        // 分类失败不影响详情主体
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const nameMap = buildNameMap(taxonomies);

  if (status === "loading") {
    return (
      <div className="space-y-4">
        <div className="kaypal-v3-panel animate-pulse p-8">
          <div className="h-5 w-28 rounded bg-[var(--kaypal-v3-paper-muted)]" />
          <div className="mt-4 h-8 w-3/4 rounded bg-[var(--kaypal-v3-paper-muted)]" />
          <div className="mt-3 h-4 w-1/2 rounded bg-[var(--kaypal-v3-paper-muted)]" />
        </div>
        <div className="kaypal-v3-panel h-40 animate-pulse" />
      </div>
    );
  }

  if (status === "error") {
    return <ErrorState onRetry={load} />;
  }

  if (status === "notfound" || !detail) {
    return (
      <div className="kaypal-v3-panel flex flex-col items-center justify-center gap-3 p-12 text-center">
        <p className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
          案例不存在或尚未发布
        </p>
        <p className="text-sm text-[var(--kaypal-v3-muted)]">
          该案例可能已下线或链接有误。
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

  const platformLabel =
    nameMap.get(detail.primaryPlatform ?? "") ??
    detail.primaryPlatform ??
    detail.platforms?.[0] ??
    "未标注";
  const industryLabel =
    nameMap.get(detail.primaryIndustry ?? "") ??
    detail.primaryIndustry ??
    detail.industries?.[0] ??
    "未标注";

  const deliveryLabels = (detail.deliveryModes ?? [])
    .map((mode) => DELIVERY_MODE_LABELS[mode] ?? mode)
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {/* 1. Hero：来源标识 / 标题 / 平台 / 行业 / 更新时间 */}
      <CaseHero
        detail={detail}
        platformLabel={platformLabel}
        industryLabel={industryLabel}
      />

      {/* 2. 主视觉媒体 */}
      <CaseVisual detail={detail} />

      {/* 3. 业务问题 */}
      {detail.businessProblem && (
        <section className="kaypal-v3-panel p-6 sm:p-8">
          <SectionHeading
            icon={<FileText className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />}
            title="业务问题"
          />
          <p className="whitespace-pre-line text-sm leading-7 text-[var(--kaypal-v3-soft-ink)]">
            {detail.businessProblem}
          </p>
        </section>
      )}

      {/* 4. 解决方案 */}
      {detail.solutionSummary && (
        <section className="kaypal-v3-panel p-6 sm:p-8">
          <SectionHeading
            icon={<Lightbulb className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />}
            title="解决方案"
          />
          <p className="whitespace-pre-line text-sm leading-7 text-[var(--kaypal-v3-soft-ink)]">
            {detail.solutionSummary}
          </p>
        </section>
      )}

      {/* 5. 核心功能 */}
      {detail.keyFeatures.length > 0 && (
        <section className="kaypal-v3-panel p-6 sm:p-8">
          <SectionHeading
            icon={<Sparkles className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />}
            title="核心功能"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            {detail.keyFeatures.map((feature, index) => (
              <div
                key={index}
                className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]" aria-hidden />
                  {feature.title}
                </p>
                {feature.description && (
                  <p className="mt-1.5 text-sm leading-6 text-[var(--kaypal-v3-muted)]">
                    {feature.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. 结果与证据 */}
      {(detail.resultsSummary || detail.evidenceLevel) && (
        <section className="kaypal-v3-panel p-6 sm:p-8">
          <SectionHeading
            icon={<ShieldCheck className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />}
            title="结果与证据"
          />
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--kaypal-v3-muted)]">
              证据等级
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{
                background: "var(--kaypal-v3-accent-soft)",
                color: "var(--kaypal-v3-accent-ink)",
              }}
            >
              {detail.evidenceLevel} · {EVIDENCE_LABELS[detail.evidenceLevel] ?? "证据"}
            </span>
          </div>
          {detail.resultsSummary && (
            <p className="whitespace-pre-line text-sm leading-7 text-[var(--kaypal-v3-soft-ink)]">
              {detail.resultsSummary}
            </p>
          )}
        </section>
      )}

      {/* 7. 媒体画廊 */}
      {detail.media.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            媒体画廊
          </h2>
          <MediaGallery media={detail.media} caseId={detail.id} />
        </section>
      )}

      {/* 8. 体验入口 */}
      <DemoEndpointPanel endpoints={detail.demoEndpoints} caseId={detail.id} />

      {/* 9. 技术与交付 */}
      {(detail.techSummary || deliveryLabels.length > 0 || detail.maturity) && (
        <section className="kaypal-v3-panel p-6 sm:p-8">
          <SectionHeading
            icon={<Cpu className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />}
            title="技术与交付"
          />
          {detail.techSummary && (
            <p className="whitespace-pre-line text-sm leading-7 text-[var(--kaypal-v3-soft-ink)]">
              {detail.techSummary}
            </p>
          )}
          {(deliveryLabels.length > 0 || detail.maturity) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {deliveryLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2.5 py-1 text-xs font-semibold text-[var(--kaypal-v3-soft-ink)]"
                >
                  {label}
                </span>
              ))}
              {detail.maturity && MATURITY_LABELS[detail.maturity] && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{
                    background: "var(--kaypal-v3-success-soft)",
                    color: "var(--kaypal-v3-success)",
                  }}
                >
                  成熟度 · {MATURITY_LABELS[detail.maturity]}
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {/* 10. 来源声明 / 免责 / 授权 / 证据等级说明 */}
      <AttributionDisclaimer detail={detail} />

      {/* 11. 相关案例 */}
      <RelatedCases cases={detail.relatedCases} />

      {/* 12. 咨询 CTA（M5 接入咨询表单） */}
      <InquiryCta
        sourceCaseSlug={detail.slug}
        title="有同类业务需求？"
        description="告诉我们你的场景，九章智能帮你评估可落地的方案。"
      />
    </div>
  );
}
