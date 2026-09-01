"use client";

/**
 * 设置中心双栏壳（共享版，2026-09-01 WorkBuddy 化改造 P1）
 *
 * 从 (dashboard)/settings/layout.tsx 抽取，供设置中心及被设置导航
 * 指向的业务页面（平台账号/多账号矩阵/电脑本机服务/应用与安装等）复用。
 * - 左栏数据源：nav-registry 的 MINE_NAV_ENTRIES（按 group 分组派生，禁止手写第二份）
 * - 选中态跟随 URL（usePathname），刷新/前进后退不丢失
 * - 移动端 <768px 直接透传 children（移动端保持 mx-* 列表形态）
 * - 可选 only: 限定仅在指定路径生效，其余路径透传（用于带全屏子页的目录，如 /local-engine、/apps）
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { MINE_NAV_ENTRIES, type MineNavEntry } from "@/lib/nav-registry";

const GROUP_ORDER = ["账号与设置", "设置", "系统与服务"] as const;

function navItemsForGroup(group: string): MineNavEntry[] {
  return MINE_NAV_ENTRIES.filter(
    (e) => e.group === group && !e.adminOnly,
  ).sort((a, b) => (a.desktopOrder ?? 99) - (b.desktopOrder ?? 99));
}

export function SettingsNavShell({
  children,
  only,
}: {
  children: React.ReactNode;
  /** 仅在这些路径前缀下渲染双栏壳；其他路径直接透传 children（默认全部渲染壳） */
  only?: string[];
}) {
  const pathname = usePathname() ?? "";
  const isMobile = useIsMobile();
  const user = useShellUser();
  const [query, setQuery] = useState("");

  if (isMobile) {
    return <>{children}</>;
  }

  if (only && only.length > 0 && !only.includes(pathname)) {
    return <>{children}</>;
  }

  const q = query.trim().toLowerCase();
  const groups = GROUP_ORDER.map((name) => ({
    name,
    items: navItemsForGroup(name).filter(
      (e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q),
    ),
  })).filter((g) => g.items.length > 0);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/settings" && pathname.startsWith(href));

  return (
    <div className="flex items-start gap-6">
      {/* ── 左栏导航 ── */}
      <aside className="kaypal-v3-panel sticky top-6 w-60 shrink-0 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 7rem)" }}>
        {/* 账号区 */}
        <div className="mb-3 flex items-center gap-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
            style={{ background: "var(--kaypal-v3-gradient-avatar)" }}
          >
            {(user?.displayName || "未登录").slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--kaypal-v3-ink)]">
              {user?.displayName || "未登录"}
            </p>
            <p className="truncate text-xs text-[var(--kaypal-v3-muted)]">
              {user?.planLabel || "免费版"} · {user?.creditLabel || "—"}
            </p>
          </div>
        </div>

        {/* 我的概览 */}
        <Link
          href="/mine"
          className={`mb-1 flex items-center gap-2.5 rounded-[var(--kaypal-v3-radius-sm)] px-3 py-2 text-sm transition ${
            pathname === "/mine"
              ? "bg-[var(--kaypal-v3-accent-soft)] font-medium text-[var(--kaypal-v3-accent-ink)]"
              : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
          }`}
        >
          <ShellIcon name="user" size={18} strokeWidth={1.8} />
          我的概览
          {pathname === "/mine" ? (
            <span className="ml-auto h-4 w-1 rounded-full bg-[var(--kaypal-v3-accent)]" aria-hidden="true" />
          ) : null}
        </Link>
        <Link
          href="/settings"
          className={`mb-1 flex items-center gap-2.5 rounded-[var(--kaypal-v3-radius-sm)] px-3 py-2 text-sm transition ${
            pathname === "/settings"
              ? "bg-[var(--kaypal-v3-accent-soft)] font-medium text-[var(--kaypal-v3-accent-ink)]"
              : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
          }`}
        >
          <ShellIcon name="settings" size={18} strokeWidth={1.8} />
          设置中心
          {pathname === "/settings" ? (
            <span className="ml-auto h-4 w-1 rounded-full bg-[var(--kaypal-v3-accent)]" aria-hidden="true" />
          ) : null}
        </Link>

        {/* 搜索设置 */}
        <div className="relative mb-2 mt-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索设置…"
            className="w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] py-1.5 pl-8 pr-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent-border)]"
          />
          <ShellIcon
            name="search"
            size={14}
            strokeWidth={2}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--kaypal-v3-muted)]"
          />
        </div>

        {/* 分组导航 */}
        {groups.map((group) => (
          <div key={group.name} className="mb-2">
            <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-[var(--kaypal-v3-muted)]">
              {group.name}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-[var(--kaypal-v3-radius-sm)] px-3 py-2 text-sm transition ${
                      active
                        ? "bg-[var(--kaypal-v3-accent-soft)] font-medium text-[var(--kaypal-v3-accent-ink)]"
                        : "text-[var(--kaypal-v3-soft-ink)] hover:bg-[var(--kaypal-v3-paper-soft)]"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <ShellIcon name={item.icon} size={18} strokeWidth={1.8} />
                    <span className="min-w-0 truncate">{item.title}</span>
                    {active ? (
                      <span className="ml-auto h-4 w-1 shrink-0 rounded-full bg-[var(--kaypal-v3-accent)]" aria-hidden="true" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </aside>

      {/* ── 右栏内容 ── */}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
