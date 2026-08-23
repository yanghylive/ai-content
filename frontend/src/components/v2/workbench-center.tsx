"use client";

import {
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { V2BackButton } from "@/components/v2/v2-back-button";

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
  /* icon prop 保留兼容既有调用方（页头统一无卡后不再渲染 icon tile） */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  icon: _icon,
  stats = [],
  statsNote,
  primaryAction,
  quickActions = [],
  advancedLinks = [],
  error,
  notice,
  backHref,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  stats?: WorkbenchStat[];
  /** 统计数据来源说明，例如"示例数据，接口接入后显示真实值" */
  statsNote?: string;
  /** 传了 backHref 就在页面顶部显示「返回上一级」按钮（功能子页用），顶级中心页不传 */
  backHref?: string;
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
  const isMobile = useIsMobile();
  const router = useRouter();

  /* 移动端原生视图（mx-* 明德 VP 风格）：标题 + 统计 + 快捷入口 + 全部功能 */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        {backHref ? (
          <div className="mx-px" style={{ marginTop: 8 }}>
            <V2BackButton to={backHref} />
          </div>
        ) : null}
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">{title}</h1>
              {subtitle ? <p className="mx-page-sub">{subtitle}</p> : null}
            </div>
            {primaryAction &&
              (primaryAction.href ? (
                <Link
                  href={primaryAction.href}
                  className="mx-btn-gold"
                  style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  {primaryAction.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}
                  disabled={primaryAction.loading}
                  onClick={primaryAction.onClick}
                >
                  {primaryAction.label}
                </button>
              ))}
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {/* 统计 */}
          {stats.length > 0 && (
            <div
              className="mx-stat-grid"
              style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, 1fr)` }}
            >
              {stats.slice(0, 4).map((stat) => (
                <div key={stat.label} className="mx-stat-item mx-control">
                  <div className="mx-stat-num" style={{ fontSize: stats.length > 2 ? 19 : 22 }}>
                    {stat.value}
                  </div>
                  <div className="mx-stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          )}
          {statsNote ? (
            <p style={{ marginTop: 6, fontSize: 10.5, color: "var(--mx-muted)", textAlign: "right" }}>{statsNote}</p>
          ) : null}
          {error ? <p style={{ marginTop: 10, fontSize: 12, color: "var(--kaypal-v3-danger)" }}>{error}</p> : null}
          {notice ? <p style={{ marginTop: 10, fontSize: 12, color: "var(--kaypal-v3-success)" }}>{notice}</p> : null}

          {/* 快捷操作 */}
          {quickActions.length > 0 && (
            <section className="mx-mt-lg">
              <div className="mx-section-head">
                <div className="mx-section-title">快捷操作</div>
              </div>
              <div
                className="mx-svc-grid"
                style={{ gridTemplateColumns: `repeat(${Math.min(quickActions.length, 4)}, 1fr)` }}
              >
                {quickActions.slice(0, 4).map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    className="mx-svc-item mx-control"
                    onClick={() => {
                      if (action.href) router.push(action.href);
                      else action.onClick?.();
                    }}
                  >
                    <span className="mx-svc-ic" style={{ margin: "0 auto" }}>
                      <action.icon size={19} strokeWidth={1.8} />
                    </span>
                    <span className="mx-svc-name">{action.title}</span>
                    {action.description ? <span className="mx-svc-sub">{action.description}</span> : null}
                  </button>
                ))}
              </div>
              {quickActions.length > 4 && (
                <div className="mx-svc-grid mx-mt-lg" style={{ gridTemplateColumns: `repeat(${Math.min(quickActions.length - 4, 4)}, 1fr)` }}>
                  {quickActions.slice(4).map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      className="mx-svc-item mx-control"
                      onClick={() => {
                        if (action.href) router.push(action.href);
                        else action.onClick?.();
                      }}
                    >
                      <span className="mx-svc-ic" style={{ margin: "0 auto" }}>
                        <action.icon size={19} strokeWidth={1.8} />
                      </span>
                      <span className="mx-svc-name">{action.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 全部功能 */}
          {advancedLinks.length > 0 && (
            <section className="mx-mt-lg">
              <div className="mx-section-head">
                <div className="mx-section-title">全部功能</div>
              </div>
              <div className="mx-card mx-list-card">
                {advancedLinks.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className="mx-row"
                    style={{ textDecoration: "none" }}
                  >
                    <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}>
                      <link.icon size={18} strokeWidth={1.8} />
                    </span>
                    <div className="mx-row-main">
                      <div className="mx-row-title">{link.title}</div>
                    </div>
                    <ArrowRight size={15} style={{ color: "#b9c5d4" }} />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kx-view kaypal-v2-engine flex flex-col gap-6">
      {backHref ? <V2BackButton to={backHref} /> : null}
      {/* 顶部：统一页头（无卡大字——2026-08-23 全站页头规范：标题独立、
          h1 kx-greet 26/800 + 副标题，磨砂卡留给内容区；主 CTA 右置金渐变） */}
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
            {title}
          </h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">
            {subtitle}
          </p>
        </div>
        {primaryAction &&
          (primaryAction.href ? (
            <Link
              href={primaryAction.href}
              className="kx-btn-primary inline-flex items-center gap-2 px-6 py-3 text-base font-semibold"
            >
              {primaryAction.label}
              <ArrowRight className="h-5 w-5" />
            </Link>
          ) : (
            <button
              type="button"
              disabled={primaryAction.loading}
              onClick={primaryAction.onClick}
              className="kx-btn-primary inline-flex items-center gap-2 px-6 py-3 text-base font-semibold disabled:opacity-60"
            >
              {primaryAction.label}
            </button>
          ))}
      </div>

      {/* 统计卡片（独立区块，磨砂玻璃卡） */}
      {stats.length > 0 && (
        <div>
          {statsNote && (
            <p className="mb-2 text-right text-xs text-[var(--kaypal-v3-muted)]">
              {statsNote}
            </p>
          )}
          <div
            className={`grid gap-[var(--space-card)] ${
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
                  className="kaypal-v3-panel p-5"
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
