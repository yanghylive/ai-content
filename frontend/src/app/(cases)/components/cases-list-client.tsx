"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  ChevronDown,
  Loader2,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  getTaxonomies,
  listCases,
  type CaseSort,
  type CaseSummaryDto,
  type TaxonomyResult,
} from "@/lib/api/case-showcase";
import {
  filtersFromSearchParams,
  filtersToApiParams,
  filtersToSearchParams,
  hasActiveFilters,
  type ActiveFilters,
} from "./case-filters";
import { trackCaseEvent } from "@/lib/analytics/case-events";
import { CaseCard } from "./case-card";
import { FilterPanel } from "./filter-panel";
import { FilterDrawer } from "./filter-drawer";
import {
  CaseGridSkeleton,
  EmptyState,
  ErrorState,
  NoResults,
} from "./case-states";

const SORT_OPTIONS: Array<{ value: CaseSort; label: string }> = [
  { value: "recommended", label: "推荐" },
  { value: "updated", label: "最近更新" },
  { value: "popular", label: "最热门" },
];

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/** 计算当前激活的筛选维度数（用于 search_submit 的 filter_count 属性） */
function countActiveFilterDimensions(filters: ActiveFilters): number {
  return (
    (filters.platforms.length > 0 ? 1 : 0) +
    (filters.industries.length > 0 ? 1 : 0) +
    (filters.capabilities.length > 0 ? 1 : 0) +
    (filters.provenances.length > 0 ? 1 : 0) +
    (filters.experience !== null ? 1 : 0)
  );
}

/** 对比前后筛选状态，返回变化的维度与值（用于 filter_change） */
function detectFilterChanges(
  prev: ActiveFilters,
  next: ActiveFilters,
): Array<{ dimension: string; value: string }> {
  const changes: Array<{ dimension: string; value: string }> = [];
  const dims: Array<[keyof ActiveFilters, string]> = [
    ["platforms", "platform"],
    ["industries", "industry"],
    ["capabilities", "capability"],
    ["provenances", "provenance"],
  ];
  for (const [key, label] of dims) {
    const before = prev[key] as string[];
    const after = next[key] as string[];
    if (!sameStringArray(before, after)) {
      changes.push({ dimension: label, value: after.join(",") });
    }
  }
  if (prev.experience !== next.experience) {
    changes.push({
      dimension: "experience",
      value:
        next.experience === null ? "all" : next.experience ? "true" : "false",
    });
  }
  return changes;
}

export function CasesListClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams],
  );

  const [taxonomies, setTaxonomies] = useState<TaxonomyResult | null>(null);
  const [items, setItems] = useState<CaseSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.q);

  // 同步 URL 中 q 到搜索输入框（前进/后退恢复）
  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  // 分类只拉一次
  useEffect(() => {
    let cancelled = false;
    getTaxonomies()
      .then((data) => {
        if (!cancelled) setTaxonomies(data);
      })
      .catch(() => {
        // 分类拉取失败不阻断列表
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 列表随 URL 变化重置加载
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    listCases(filtersToApiParams(filters))
      .then((res) => {
        if (cancelled) return;
        setItems(res.data);
        setNextCursor(res.nextCursor);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const applyFilters = useCallback(
    (next: ActiveFilters) => {
      const params = filtersToSearchParams(next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const clearFilters = useCallback(() => {
    setSearchDraft("");
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const submitSearch = useCallback(
    (value: string) => {
      const keyword = value.trim();
      if (keyword) {
        trackCaseEvent("search_submit", {
          keyword,
          filter_count: countActiveFilterDimensions(filters),
        });
      }
      applyFilters({ ...filters, q: value });
    },
    [applyFilters, filters],
  );

  const handleFilterChange = useCallback(
    (next: ActiveFilters) => {
      for (const change of detectFilterChanges(filters, next)) {
        trackCaseEvent("filter_change", {
          dimension: change.dimension,
          value: change.value,
        });
      }
      applyFilters(next);
    },
    [filters, applyFilters],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await listCases({
        ...filtersToApiParams(filters),
        cursor: nextCursor,
      });
      setItems((prev) => [...prev, ...res.data]);
      setNextCursor(res.nextCursor);
    } catch {
      // 加载更多失败保持现状，可再次点击
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, filters]);

  const activeCount = hasActiveFilters(filters) ? 1 : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* 搜索 + 排序工具栏 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch(searchDraft);
          }}
          role="search"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]" aria-hidden />
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="搜索案例：标题 / 业务问题 / 方案"
            className="h-11 w-full rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] pl-10 pr-3 text-sm text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
          />
        </form>

        <div className="flex items-center gap-2">
          {/* 移动端筛选按钮 */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            筛选
            {activeCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent)] px-1 text-[10px] font-bold text-white">
                1
              </span>
            )}
          </button>

          {/* 排序下拉 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              onBlur={() => setTimeout(() => setSortOpen(false), 150)}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
            >
              <ArrowUpDown className="h-4 w-4" aria-hidden />
              {SORT_OPTIONS.find((o) => o.value === filters.sort)?.label ?? "推荐"}
              <ChevronDown className="h-4 w-4" aria-hidden />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-12 z-20 w-40 overflow-hidden rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] shadow-[var(--kaypal-v3-elevated-shadow)]">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSortOpen(false);
                      applyFilters({ ...filters, sort: opt.value });
                    }}
                    className={`block w-full px-4 py-2.5 text-left text-sm transition hover:bg-[var(--kaypal-v3-paper-soft)] ${
                      filters.sort === opt.value
                        ? "font-semibold text-[var(--kaypal-v3-accent-ink)]"
                        : "text-[var(--kaypal-v3-soft-ink)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 内容区：桌面侧栏 + 卡片网格 */}
      <div className="flex items-start gap-6">
        <FilterPanel
          taxonomies={taxonomies}
          filters={filters}
          onChange={handleFilterChange}
          onClear={clearFilters}
        />

        <div className="min-w-0 flex-1">
          {status === "loading" && <CaseGridSkeleton count={6} />}

          {status === "error" && (
            <ErrorState
              onRetry={() => {
                setStatus("loading");
                listCases(filtersToApiParams(filters))
                  .then((res) => {
                    setItems(res.data);
                    setNextCursor(res.nextCursor);
                    setStatus("ready");
                  })
                  .catch(() => setStatus("error"));
              }}
            />
          )}

          {status === "ready" && items.length === 0 && hasActiveFilters(filters) && (
            <NoResults onClear={clearFilters} />
          )}

          {status === "ready" && items.length === 0 && !hasActiveFilters(filters) && (
            <EmptyState />
          )}

          {status === "ready" && items.length > 0 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <CaseCard key={item.id} item={item} variant="standard" />
                ))}
              </div>

              {nextCursor && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="inline-flex h-11 items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-6 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] disabled:opacity-60"
                  >
                    {loadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    )}
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}

          {status === "ready" && items.length > 0 && !nextCursor && (
            <p className="mt-6 text-center text-xs text-[var(--kaypal-v3-muted)]">
              已展示全部案例
            </p>
          )}
        </div>
      </div>

      <FilterDrawer
        open={drawerOpen}
        taxonomies={taxonomies}
        filters={filters}
        onChange={handleFilterChange}
        onClear={clearFilters}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
