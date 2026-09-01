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

  if (isMobile) {
    return <>{children}</>;
  }

  if (only && only.length > 0 && !only.includes(pathname)) {
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
    <div className="flex items-start gap-6">
      {/* ── 左栏导航 ── */}
      <aside className="kaypal-v3-panel sticky top-6 w-60 shrink-0 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 7rem)" }}>
        {/* 账号区（WorkBuddy：头像 + 名字 + 套餐 + 退出） */}
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
      <main className="settings-pane min-w-0 flex-1">{children}</main>
      <style>{`.settings-pane .v2-back-btn { display: none; }`}</style>
    </div>
  );
}
