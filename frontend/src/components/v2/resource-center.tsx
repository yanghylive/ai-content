"use client";

import { SkeletonRow } from "@/components/skeleton";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Plus,
  Search,
  Star,
  type LucideIcon,
} from "@/components/iconpark";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { SkeletonList } from "@/components/skeleton";

export type ResourceItem = {
  id: string;
  title: string;
  description?: string;
  badges?: string[];
  isDefault?: boolean;
  enabled?: boolean;
  meta?: string;
};

type ResourceCenterProps = {
  title: string;
  subtitle: string;
  resourceName: string;
  icon: LucideIcon;
  items: ResourceItem[];
  loading?: boolean;
  onCreate?: () => void;
  onItemClick?: (item: ResourceItem) => void;
  createLabel?: string;
};

export function ResourceCenter({
  title,
  subtitle,
  resourceName,
  icon: Icon,
  items,
  loading = false,
  onCreate,
  onItemClick,
  createLabel,
}: ResourceCenterProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      [item.title, item.description || "", ...(item.badges || [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [items, searchQuery]);

  const isMobile = useIsMobile();

  /* 移动端原生视图（mx-* 明德 VP 风格） */
  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">{title}</h1>
              {subtitle ? <p className="mx-page-sub">{subtitle}</p> : null}
            </div>
            {onCreate && (
              <button
                type="button"
                className="mx-btn-gold"
                style={{ fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}
                onClick={onCreate}
              >
                <Plus size={14} style={{ marginRight: 3 }} />
                {createLabel || `新建${resourceName}`}
              </button>
            )}
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {/* 搜索 */}
          {items.length > 0 && (
            <div style={{ position: "relative", marginBottom: 14 }}>
              <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9aa5b4" }} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`搜索${resourceName}`}
                style={{
                  width: "100%",
                  padding: "10px 12px 10px 36px",
                  borderRadius: 12,
                  border: "1px solid rgba(142,165,190,.3)",
                  background: "rgba(255,255,255,.7)",
                  color: "var(--kaypal-v3-ink)",
                  fontSize: 13,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* 列表 */}
          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>还没有{resourceName}</p>
              {onCreate && (
                <button type="button" className="mx-btn-gold" style={{ marginTop: 12 }} onClick={onCreate}>
                  <Plus size={14} style={{ marginRight: 3 }} />
                  {createLabel || `新建${resourceName}`}
                </button>
              )}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>没有找到匹配 "{searchQuery}" 的{resourceName}</p>
            </div>
          ) : (
            <div className="mx-card mx-list-card">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="mx-row"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                  onClick={() => onItemClick?.(item)}
                >
                  <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)", borderRadius: 999 }}>
                    <Icon size={18} strokeWidth={1.8} />
                  </span>
                  <div className="mx-row-main">
                    <div className="mx-row-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
                      {item.isDefault && <span className="mx-badge mx-badge-gold" style={{ flexShrink: 0 }}>默认</span>}
                      {item.enabled === false && <span className="mx-badge" style={{ flexShrink: 0 }}>已停用</span>}
                    </div>
                    {(item.description || item.meta) && (
                      <div className="mx-row-desc">
                        {item.description || item.meta}
                        {item.description && item.meta ? ` · ${item.meta}` : ""}
                      </div>
                    )}
                  </div>
                  <div className="mx-row-right">
                    {item.badges?.slice(0, 2).map((badge) => (
                      <span key={badge} className="mx-badge mx-badge-blue">{badge}</span>
                    ))}
                    <ArrowRight size={15} style={{ color: "#b9c5d4" }} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="kx-view kaypal-v2-engine flex flex-col gap-6">
      {/* 顶部：标题 + 单一主行动 */}
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="kaypal-v3-icon-tile h-12 w-12">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">
                {title}
              </h1>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                {subtitle}
              </p>
            </div>
          </div>
          {onCreate && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
              onClick={onCreate}
            >
              <Plus className="h-5 w-5" />
              {createLabel || `新建${resourceName}`}
            </button>
          )}
        </div>

        {/* 搜索 */}
        {items.length > 0 && (
          <div className="relative mt-6">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" />
            <input
              className="h-11 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-11 pr-4 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
              placeholder={`搜索${resourceName}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </section>

      {/* 内容区 */}
      {loading ? (
        <section className="kaypal-v3-panel p-6">
          <SkeletonList rows={4} />
        </section>
      ) : items.length === 0 ? (
        /* 空状态引导 */
        <section className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
            <Icon className="h-8 w-8 text-[var(--kaypal-v3-accent-ink)]" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            还没有{resourceName}
          </h3>
          <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
            {subtitle}，点击下方按钮开始
          </p>
          {onCreate && (
            <button
              type="button"
              className="mt-6 inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-8 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)]"
              onClick={onCreate}
            >
              <Plus className="h-5 w-5" />
              {createLabel || `新建${resourceName}`}
            </button>
          )}
        </section>
      ) : filteredItems.length === 0 ? (
        <section className="kaypal-v3-panel p-12 text-center">
          <p className="text-sm text-[var(--kaypal-v3-muted)]">
            没有找到匹配 "{searchQuery}" 的{resourceName}
          </p>
        </section>
      ) : (
        /* 卡片网格 */
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="kaypal-v3-panel group flex flex-col p-5 text-left transition hover:border-[var(--kaypal-v3-accent)] hover:shadow-md"
              onClick={() => onItemClick?.(item)}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-[var(--kaypal-v3-ink)]">
                  {item.title}
                </h3>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.isDefault && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--kaypal-v3-accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--kaypal-v3-accent-ink)]">
                      <Star className="h-3 w-3" />
                      默认
                    </span>
                  )}
                  {item.enabled === false && (
                    <span className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-muted)]">
                      已停用
                    </span>
                  )}
                </div>
              </div>

              {item.description && (
                <p className="mt-2 line-clamp-2 flex-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {item.description}
                </p>
              )}

              {(item.badges?.length || item.meta) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {item.badges?.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full bg-[var(--kaypal-v3-paper-muted)] px-2 py-0.5 text-xs text-[var(--kaypal-v3-soft-ink)]"
                    >
                      {badge}
                    </span>
                  ))}
                  {item.meta && (
                    <span className="text-xs text-[var(--kaypal-v3-muted)]">
                      {item.meta}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-[var(--kaypal-v3-accent)] opacity-0 transition group-hover:opacity-100">
                查看详情
                <ArrowRight className="h-4 w-4" />
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
