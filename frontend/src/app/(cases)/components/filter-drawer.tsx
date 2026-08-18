"use client";

import { useEffect } from "react";
import { RotateCcw, X } from "lucide-react";
import type { TaxonomyResult } from "@/lib/api/case-showcase";
import type { ActiveFilters } from "./case-filters";
import { hasActiveFilters } from "./case-filters";
import { FilterSections } from "./filter-sections";

/**
 * 移动端筛选抽屉（底部上滑）。
 */
export function FilterDrawer({
  open,
  taxonomies,
  filters,
  onChange,
  onClear,
  onClose,
}: {
  open: boolean;
  taxonomies: TaxonomyResult | null;
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="关闭筛选"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-[var(--kaypal-v3-radius)] bg-[var(--kaypal-v3-paper)] p-5 pb-8 shadow-[var(--kaypal-v3-elevated-shadow)]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
            筛选
          </span>
          <div className="flex items-center gap-3">
            {hasActiveFilters(filters) && (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1 text-sm font-medium text-[var(--kaypal-v3-accent)]"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                清空
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)]"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        <FilterSections
          taxonomies={taxonomies}
          filters={filters}
          onChange={onChange}
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
        >
          查看结果
        </button>
      </div>
    </div>
  );
}
