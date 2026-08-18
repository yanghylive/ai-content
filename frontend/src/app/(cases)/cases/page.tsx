import type { Metadata } from "next";
import { Suspense } from "react";
import { CasesHomeSections } from "../components/cases-home-sections";
import { CasesListClient } from "../components/cases-list-client";
import { CaseGridSkeleton } from "../components/case-states";

export const metadata: Metadata = {
  title: "案例中心 - 九章智能",
  description:
    "浏览九章智能案例展示中心：搜索、筛选并查看四类来源（九章交付 / 开源演示 / 概念原型 / 可定制模板）的真实案例。",
  openGraph: {
    title: "案例中心 - 九章智能",
    description:
      "搜索与筛选九章智能案例展示中心的公开案例，覆盖多平台、多行业与多能力场景。",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    noarchive: false,
    nosnippet: false,
  },
};

export default function CasesListPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {/* 首页区块：品牌主视觉 + 精选案例 + 浏览入口 + 咨询 CTA */}
      <CasesHomeSections />

      {/* 列表区块 */}
      <div id="cases-list" className="mt-10 scroll-mt-20">
        <header className="mb-6">
          <h2 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
            浏览案例
          </h2>
          <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
            搜索、筛选并浏览公开案例，找到与你业务最接近的解决方案。
          </p>
        </header>
        <Suspense fallback={<CaseGridSkeleton count={6} />}>
          <CasesListClient />
        </Suspense>
      </div>
    </div>
  );
}
