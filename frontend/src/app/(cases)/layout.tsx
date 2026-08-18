import type { Metadata } from "next";
import Link from "next/link";

/**
 * 案例中心公开布局（无 dashboard 侧栏）。
 * 完全匿名公开，独立于内部 (dashboard) 路由组。
 */

export const metadata: Metadata = {
  title: {
    default: "案例中心 - 九章智能",
    template: "%s - 九章智能",
  },
  // 覆盖根布局的 noindex/nocache/noarchive/nosnippet，公开案例页需可被搜索引擎收录
  robots: {
    index: true,
    follow: true,
    nocache: false,
    noarchive: false,
    nosnippet: false,
  },
};

export default function CasesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className="kaypal-v3-shell min-h-screen"
      style={{ background: "var(--kaypal-v3-canvas)" }}
    >
      <header className="sticky top-0 z-40 border-b border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/cases"
            className="text-base font-bold text-[var(--kaypal-v3-ink)]"
          >
            九章智能 · 案例中心
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/cases"
              className="font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:text-[var(--kaypal-v3-accent-ink)]"
            >
              浏览案例
            </Link>
          </nav>
        </div>
      </header>

      <main className="min-h-[70vh]">{children}</main>

      <footer className="mt-12 border-t border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-[var(--kaypal-v3-muted)] sm:px-6">
          <p className="font-semibold text-[var(--kaypal-v3-soft-ink)]">
            九章智能案例展示中心
          </p>
          <p>
            案例来源分为四类：九章交付、开源演示、概念原型、可定制模板。具体成果以
            客户实际数据为准，开源演示遵循其上游许可证。
          </p>
        </div>
      </footer>
    </div>
  );
}
