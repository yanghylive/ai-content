"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  Plus,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";

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
        <section className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          <p className="mt-4 text-sm text-[var(--kaypal-v3-muted)]">
            正在加载...
          </p>
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
