"use client";

/**
 * 设置中心首页（2026-09-01 WorkBuddy 化改造 P0，桌面端 /settings）
 *
 * 左栏已列全部入口，右栏展示分组索引卡（快捷到达），避免与左栏重复的冗长聚合表单。
 * 移动端继续走 settings-detail（mx-* 列表），见 settings/page.tsx 分支。
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { ShellIcon } from "@/components/shell/icons";
import { useShellUser } from "@/components/shell/app-shell";
import { MINE_NAV_ENTRIES } from "@/lib/nav-registry";

const GROUP_ORDER = ["账号与设置", "设置", "系统与服务"] as const;

export function SettingsHome() {
  const router = useRouter();
  const user = useShellUser();

  return (
    <div className="flex flex-col gap-6">
      <div className="kx-page-head">
        <div>
          <button
            type="button"
            onClick={() => router.push("/mine")}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-accent-ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> 返回我的
          </button>
          <h1 className="kx-greet mt-1 text-[var(--kaypal-v3-ink)]">设置中心</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            账号、通知、AI 服务、数据与合规，全部从这里进入
          </p>
        </div>
      </div>

      {/* 账号摘要卡 */}
      {user ? (
        <div className="kaypal-v3-panel flex items-center gap-4 p-5">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
            style={{ background: "var(--kaypal-v3-gradient-avatar)" }}
          >
            {user.displayName.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
              {user.displayName}
            </p>
            <p className="text-sm text-[var(--kaypal-v3-muted)]">
              {user.planLabel} · {user.creditLabel} 积分
            </p>
          </div>
          <Link
            href="/mine"
            className="inline-flex items-center gap-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] px-3 py-1.5 text-xs font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:text-[var(--kaypal-v3-accent-ink)]"
          >
            个人主页
          </Link>
        </div>
      ) : null}

      {/* 分组索引 */}
      {GROUP_ORDER.map((group) => {
        const items = MINE_NAV_ENTRIES.filter(
          (e) => e.group === group && !e.adminOnly,
        ).sort((a, b) => (a.desktopOrder ?? 99) - (b.desktopOrder ?? 99));
        if (items.length === 0) return null;
        return (
          <section key={group} className="kaypal-v3-panel p-5">
            <h2 className="mb-3 text-base font-semibold text-[var(--kaypal-v3-ink)]">
              {group}
            </h2>
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="group flex items-center gap-3 py-3 transition"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                  >
                    <ShellIcon name={item.icon} size={18} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--kaypal-v3-ink)]">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-[var(--kaypal-v3-muted)]">
                      {item.desc}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]" />
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
