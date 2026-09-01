"use client";

/**
 * 设置中心抽屉导航（2026-09-01 WorkBuddy 化改造 P3）
 *
 * 左栏导航不再常驻挤压内容 —— 平时内容全宽，点左侧「我的」弹出抽屉导航。
 * - 抽屉通过 window 自定义事件触发（app-shell「我的」按钮 dispatch）
 * - 内容区始终全宽（flex-1），抽屉 absolute 覆盖在左侧，不占布局
 * - 点击导航项跳转后自动收起
 * - 移动端 <768px 直接透传 children
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { MINE_NAV_ENTRIES, type MineNavEntry } from "@/lib/nav-registry";

const GROUP_ORDER = ["账号与设置", "设置", "系统与服务"] as const;

/** 抽屉开关事件（app-shell「我的」按钮 → SettingsNavShell 抽屉） */
export const SETTINGS_DRAWER_EVENT = "jz:settings-drawer";

function navItemsForGroup(group: string): MineNavEntry[] {
  return MINE_NAV_ENTRIES.filter(
    (e) => e.group === group && !e.adminOnly,
  ).sort((a, b) => (a.desktopOrder ?? 99) - (b.desktopOrder ?? 99));
}

export function SettingsNavShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const isMobile = useIsMobile();
  const user = useShellUser();
  const [open, setOpen] = useState(false);

  // 监听「我的」按钮触发的抽屉开关
  useEffect(() => {
    const onToggle = () => {
      setOpen((prev) => !prev);
    };
    window.addEventListener(SETTINGS_DRAWER_EVENT, onToggle);
    return () => window.removeEventListener(SETTINGS_DRAWER_EVENT, onToggle);
  }, []);

  // 路由变化时收起
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 标记 body：套壳页内容全宽（绕过 kx-legacy-wrap 的 880px 限宽）
  useEffect(() => {
    document.body.classList.add("has-settings-drawer");
    return () => document.body.classList.remove("has-settings-drawer");
  }, []);

  if (isMobile) {
    return <>{children}</>;
  }

  const groups = GROUP_ORDER.map((name) => ({
    name,
    items: navItemsForGroup(name),
  })).filter((g) => g.items.length > 0);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/settings" && pathname.startsWith(href));

  return (
    <div className="relative min-w-0">
      {/* ── 抽屉导航（absolute 覆盖，不占布局） ── */}
      {open ? (
        <>
          <div
            className="fixed inset-0 z-[70]"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <aside
            className="kaypal-v3-panel fixed left-0 top-0 z-[71] flex h-full w-64 flex-col overflow-y-auto p-3 shadow-[0_0_40px_-8px_rgba(15,12,28,0.35)]"
            role="navigation"
            aria-label="设置导航"
          >
            {/* 账号区 */}
            <div className="mb-3 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <div className="flex items-center gap-3">
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
                <button
                  type="button"
                  aria-label="关闭导航"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] text-lg leading-none text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
              <button
                type="button"
                disabled={user?.loggingOut}
                onClick={() => {
                  if (window.confirm("退出后需要重新登录 JIUZHANG AI 账号才能使用全部功能。确定退出？")) {
                    user?.onLogout?.();
                  }
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] py-1.5 text-xs font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-danger)] hover:text-[var(--kaypal-v3-danger)] disabled:opacity-60"
              >
                <ShellIcon name="logout" size={14} strokeWidth={2} />
                {user?.loggingOut ? "正在退出..." : "退出登录"}
              </button>
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
        </>
      ) : null}

      {/* ── 内容区（始终全宽） ── */}
      <main className="settings-pane min-w-0 flex-1">{children}</main>
      <style>{`
        .settings-pane .v2-back-btn { display: none; }
        /* WorkBuddy 页面内容全宽，冲破 kx-legacy-wrap 的 880px 限宽居中 */
        body.has-settings-drawer .kx-legacy-wrap { max-width: none !important; }
      `}</style>
    </div>
  );
}
