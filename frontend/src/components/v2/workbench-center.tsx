"use client";

import {
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

export type WorkbenchStat = {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
};

export type WorkbenchAction = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** 不传 href 时渲染为按钮（需配 onClick） */
  href?: string;
  onClick?: () => void;
  badge?: string;
};

export type WorkbenchLink = {
  key: string;
  title: string;
  icon: LucideIcon;
  href: string;
};

const TONE_STYLES: Record<
  NonNullable<WorkbenchStat["tone"]>,
  { border: string; bg: string; text: string }
> = {
  default: {
    border: "var(--kaypal-v3-border)",
    bg: "var(--kaypal-v3-paper)",
    text: "var(--kaypal-v3-ink)",
  },
  success: {
    border: "var(--kaypal-v3-success)",
    bg: "var(--kaypal-v3-success-soft)",
    text: "var(--kaypal-v3-success)",
  },
  warning: {
    border: "var(--kaypal-v3-amber)",
    bg: "var(--kaypal-v3-amber-soft)",
    text: "var(--kaypal-v3-amber)",
  },
  danger: {
    border: "var(--kaypal-v3-danger)",
    bg: "var(--kaypal-v3-danger-soft)",
    text: "var(--kaypal-v3-danger)",
  },
  accent: {
    border: "var(--kaypal-v3-accent-border)",
    bg: "var(--kaypal-v3-accent-soft)",
    text: "var(--kaypal-v3-accent-ink)",
  },
};

export function WorkbenchCenter({
  title,
  subtitle,
  icon: Icon,
  stats = [],
  statsNote,
  primaryAction,
  quickActions = [],
  advancedLinks = [],
  error,
  notice,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  stats?: WorkbenchStat[];
  /** 统计数据来源说明，例如"示例数据，接口接入后显示真实值" */
  statsNote?: string;
  primaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
    icon?: LucideIcon;
    loading?: boolean;
  };
  quickActions?: WorkbenchAction[];
  advancedLinks?: WorkbenchLink[];
  error?: string | null;
  notice?: string | null;
}) {
  return (
    <div className="kaypal-v2-engine flex flex-col gap-6">
      {/* 顶部：标题 + 单一主行动 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="kaypal-v3-icon-tile h-12 w-12">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                {title}
              </h1>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                {subtitle}
              </p>
            </div>
          </div>
          {primaryAction &&
            (primaryAction.href ? (
              <Link
                href={primaryAction.href}
                className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
              >
                {primaryAction.label}
                <ArrowRight className="h-5 w-5" />
              </Link>
            ) : (
              <button
                type="button"
                disabled={primaryAction.loading}
                onClick={primaryAction.onClick}
                className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60"
              >
                {primaryAction.label}
              </button>
            ))}
        </div>

        {/* 统计卡片 */}
        {stats.length > 0 && (
          <div className="mt-6">
            {statsNote && (
              <p className="mb-2 text-right text-xs text-[var(--kaypal-v3-muted)]">
                {statsNote}
              </p>
            )}
            <div
              className={`grid gap-4 ${
                stats.length === 2
                  ? "grid-cols-2"
                  : stats.length === 3
                    ? "grid-cols-3"
                    : "grid-cols-2 lg:grid-cols-4"
              }`}
            >
              {stats.map((stat) => {
              const tone = TONE_STYLES[stat.tone || "default"];
              return (
                <div
                  key={stat.label}
                  className="rounded-[var(--kaypal-v3-radius)] border p-5"
                  style={{ borderColor: tone.border, background: tone.bg }}
                >
                  <p className="text-sm text-[var(--kaypal-v3-muted)]">
                    {stat.label}
                  </p>
                  <p
                    className="mt-2 text-3xl font-bold"
                    style={{ color: tone.text }}
                  >
                    {stat.value}
                  </p>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4 text-sm text-[var(--kaypal-v3-danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4 text-sm text-[var(--kaypal-v3-success)]">
          {notice}
        </p>
      )}

      {/* 快捷操作 */}
      {quickActions.length > 0 && (
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              ⚡ 快捷操作
            </h2>
          </div>

          <div
            className={`grid gap-4 ${
              quickActions.length === 2
                ? "md:grid-cols-2"
                : quickActions.length === 3
                  ? "md:grid-cols-3"
                  : "md:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              const inner = (
                <>
                  <div className="flex items-center gap-3">
                    <div className="kaypal-v3-icon-tile">
                      <ActionIcon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                          {action.title}
                        </h3>
                        {action.badge && (
                          <span className="rounded-full bg-[var(--kaypal-v3-danger)] px-2 py-0.5 text-xs font-semibold text-white">
                            {action.badge}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--kaypal-v3-muted)]">
                        {action.description}
                      </p>
                    </div>
                    <ArrowRight className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                  </div>
                </>
              );
              return action.href ? (
                <Link
                  key={action.key}
                  href={action.href}
                  className="kaypal-v3-panel group p-5 transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
                >
                  {inner}
                </Link>
              ) : (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className="kaypal-v3-panel group p-5 text-left transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
                >
                  {inner}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 高级功能 */}
      {advancedLinks.length > 0 && (
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
              ⚙️ 全部功能
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {advancedLinks.map((link) => {
              const LinkIcon = link.icon;
              return (
                <Link
                  key={link.key}
                  href={link.href}
                  className="kaypal-v3-surface group flex items-center gap-3 p-4 transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
                >
                  <LinkIcon className="h-5 w-5 text-[var(--kaypal-v3-muted)] transition group-hover:text-[var(--kaypal-v3-accent)]" />
                  <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition group-hover:text-[var(--kaypal-v3-accent-ink)]">
                    {link.title}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
