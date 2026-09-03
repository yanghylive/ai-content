"use client";

import { RotateCcw, SlidersHorizontal } from "@/components/iconpark";
import type { TaxonomyResult } from "@/lib/api/case-showcase";
import type { ActiveFilters } from "./case-filters";
import { hasActiveFilters } from "./case-filters";
import { FilterSections } from "./filter-sections";

/**
 * 桌面侧栏筛选面板。
 */
export function FilterPanel({
  taxonomies,
  filters,
  onChange,
  onClear,
}: {
  taxonomies: TaxonomyResult | null;
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  onClear: () => void;
}) {
  return (
    <aside className="kaypal-v3-panel hidden h-fit w-64 shrink-0 flex-col gap-4 p-5 lg:flex">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
          <SlidersHorizontal className="h-4 w-4 text-[var(--kaypal-v3-muted)]" aria-hidden />
          筛选
        </span>
        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--kaypal-v3-accent)] transition hover:text-[var(--kaypal-v3-accent-ink)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            清空
          </button>
        )}
      </div>
      <FilterSections
        taxonomies={taxonomies}
        filters={filters}
        onChange={onChange}
      />
    </aside>
  );
}
