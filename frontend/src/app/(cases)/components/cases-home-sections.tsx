"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail, Sparkles } from "@/components/iconpark";
import {
  getTaxonomies,
  listCases,
  type CaseSummaryDto,
  type TaxonomyResult,
} from "@/lib/api/case-showcase";
import { CaseCard } from "./case-card";

/**
 * 案例中心首页区块（品牌主视觉 + 精选案例 + 按平台/行业浏览入口 + 咨询 CTA）。
 *
 * 说明：项目根路径 `/` 已被 (dashboard)/page.tsx 的 redirect 占用（安全边界禁止改动
 * dashboard），故首页内容挂载于 `/cases`（案例中心着陆页）顶部。
 */

export function CasesHomeSections() {
  const [featured, setFeatured] = useState<CaseSummaryDto[]>([]);
  const [taxonomies, setTaxonomies] = useState<TaxonomyResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCases({ sort: "recommended", limit: 3 })
      .then((res) => {
        if (!cancelled) setFeatured(res.data);
      })
      .catch(() => {
        // 精选拉取失败静默
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTaxonomies()
      .then((data) => {
        if (!cancelled) setTaxonomies(data);
      })
      .catch(() => {
        // 分类失败静默
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const platformEntries = (taxonomies?.platform ?? []).slice(0, 6);
  const industryEntries = (taxonomies?.industry ?? []).slice(0, 8);

  return (
    <div className="space-y-8">
      {/* 品牌主视觉 */}
      <section
        className="kaypal-v3-panel relative overflow-hidden p-8 sm:p-12"
        style={{
          background:
            "linear-gradient(135deg, var(--kaypal-v3-accent-soft), var(--kaypal-v3-paper))",
        }}
      >
        <div className="relative z-10 max-w-2xl">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: "var(--kaypal-v3-accent)",
              color: "#fff",
            }}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            九章智能案例展示中心
          </span>
          <h1 className="mt-4 text-3xl font-bold leading-tight text-[var(--kaypal-v3-ink)] sm:text-4xl">
            看真实案例，选可落地的 AI 方案
          </h1>
          <p className="mt-3 text-base leading-7 text-[var(--kaypal-v3-soft-ink)]">
            覆盖九章交付、开源演示、概念原型与可定制模板四类来源，按平台、行业与能力
            快速找到与你业务最接近的解决方案。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="#cases-list"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
            >
              浏览全部案例
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a
              href="mailto:support@jiuzhangai.com?subject=咨询九章智能案例"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper)] px-5 py-3 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)]"
            >
              <Mail className="h-4 w-4" aria-hidden />
              咨询同类项目
            </a>
          </div>
        </div>
      </section>

      {/* 精选案例 */}
      {featured.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-[var(--kaypal-v3-ink)]">
              精选案例
            </h2>
            <Link
              href="/cases"
              className="text-sm font-medium text-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              查看全部 →
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {featured.map((item) => (
              <CaseCard key={item.id} item={item} variant="standard" />
            ))}
          </div>
        </section>
      )}

      {/* 按平台浏览入口 */}
      {platformEntries.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--kaypal-v3-ink)]">
            按平台浏览
          </h2>
          <div className="flex flex-wrap gap-2">
            {platformEntries.map((tax) => (
              <Link
                key={tax.slug}
                href={`/cases?platform=${encodeURIComponent(tax.slug)}`}
                className="rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
              >
                {tax.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 按行业浏览入口 */}
      {industryEntries.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-[var(--kaypal-v3-ink)]">
            按行业浏览
          </h2>
          <div className="flex flex-wrap gap-2">
            {industryEntries.map((tax) => (
              <Link
                key={tax.slug}
                href={`/cases?industry=${encodeURIComponent(tax.slug)}`}
                className="rounded-full border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
              >
                {tax.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 咨询 CTA */}
      <section className="kaypal-v3-panel flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            找不到合适的案例？
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            告诉九章智能你的业务场景，我们帮你匹配或定制方案。
          </p>
        </div>
        <a
          href="mailto:support@jiuzhangai.com?subject=咨询九章智能案例"
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          <Mail className="h-4 w-4" aria-hidden />
          咨询同类项目
        </a>
      </section>
    </div>
  );
}
