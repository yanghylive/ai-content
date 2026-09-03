"use client";

/**
 * 设置导航面板（2026-09-01 WorkBuddy 化改造 P4）
 *
 * 由 app-shell 统一管理：点 rail「我的」时在 rail 右侧滑出。
 * 定位在 rail 右侧（left: 72px），不遮挡左侧图标栏，触发按钮永远可见。
 * - 点击导航项跳转后自动收起
 * - Esc / × / 遮罩关闭
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShellIcon } from "@/components/shell/icons";
import { BrandIcon, brandForMineKey } from "@/components/shell/brand-icons";
import { useShellUser } from "@/components/shell/app-shell";
import { MINE_NAV_ENTRIES, type MineNavEntry } from "@/lib/nav-registry";

const GROUP_ORDER = ["账号与设置", "设置", "系统与服务"] as const;

function navItemsForGroup(group: string): MineNavEntry[] {
  return MINE_NAV_ENTRIES.filter(
    (e) => e.group === group && !e.adminOnly,
  ).sort((a, b) => (a.desktopOrder ?? 99) - (b.desktopOrder ?? 99));
}

export function SettingsNavPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname() ?? "";
  const user = useShellUser();

  if (!open) return null;

  const groups = GROUP_ORDER.map((name) => ({
    name,
    items: navItemsForGroup(name),
  })).filter((g) => g.items.length > 0);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/settings" && pathname.startsWith(href));

  return (
    <>
      {/* 遮罩：覆盖内容区，不遮 rail（left: 72px 起） */}
      <div
        className="fixed inset-y-0 z-[70]"
        style={{ left: 72 }}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className="kaypal-v3-panel fixed inset-y-0 z-[71] flex w-64 flex-col overflow-y-auto p-3"
        style={{ left: 72 }}
        role="navigation"
        aria-label="设置导航"
      >
        {/* 头部 */}
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-sm font-bold text-[var(--kaypal-v3-ink)]">设置导航</span>
          <button
            type="button"
            aria-label="关闭导航"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] text-lg leading-none text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={onClose}
          >
            ×
          </button>
        </div>

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
                    {(() => {
                      const b = brandForMineKey(item.key);
                      return b ? (
                        <BrandIcon name={b} size={18} />
                      ) : (
                        <ShellIcon name={item.icon} size={18} strokeWidth={1.8} />
                      );
                    })()}
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
  );
}
