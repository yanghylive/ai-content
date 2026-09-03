"use client";

import { Check } from "@/components/iconpark";
import type { TaxonomyResult } from "@/lib/api/case-showcase";
import type { ActiveFilters } from "./case-filters";

/**
 * 筛选分组内容（平台/行业/能力/来源/体验），供桌面侧栏与移动抽屉共用。
 */

export const PROVENANCE_OPTIONS = [
  { value: "delivery", label: "九章交付" },
  { value: "open_source", label: "开源演示" },
  { value: "prototype", label: "概念原型" },
  { value: "template", label: "可定制模板" },
] as const;

interface CheckboxItem {
  label: string;
  checked: boolean;
  onChange: () => void;
}

function CheckboxRow({ label, checked, onChange }: CheckboxItem) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--kaypal-v3-radius-xs)] px-2 py-1.5 text-sm text-[var(--kaypal-v3-soft-ink)] transition hover:bg-[var(--kaypal-v3-paper-soft)]">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
          checked
            ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent)] text-white"
            : "border-[var(--kaypal-v3-border-strong)] bg-[var(--kaypal-v3-paper)]"
        }`}
        aria-hidden
      >
        {checked && <Check className="h-3 w-3" />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={onChange}
      />
      {label}
    </label>
  );
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="kaypal-v3-label mb-2 uppercase tracking-wide">{title}</p>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function FilterSections({
  taxonomies,
  filters,
  onChange,
}: {
  taxonomies: TaxonomyResult | null;
  filters: ActiveFilters;
  onChange: (next: ActiveFilters) => void;
}) {
  const update = (patch: Partial<ActiveFilters>) =>
    onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-col gap-5">
      <FilterGroup title="平台">
        {(taxonomies?.platform ?? []).map((tax) => (
          <CheckboxRow
            key={tax.slug}
            label={tax.name}
            checked={filters.platforms.includes(tax.slug)}
            onChange={() =>
              update({ platforms: toggleInList(filters.platforms, tax.slug) })
            }
          />
        ))}
        {(taxonomies?.platform ?? []).length === 0 && (
          <p className="px-2 text-xs text-[var(--kaypal-v3-muted)]">
            暂无平台分类
          </p>
        )}
      </FilterGroup>

      <FilterGroup title="行业">
        {(taxonomies?.industry ?? []).map((tax) => (
          <CheckboxRow
            key={tax.slug}
            label={tax.name}
            checked={filters.industries.includes(tax.slug)}
            onChange={() =>
              update({ industries: toggleInList(filters.industries, tax.slug) })
            }
          />
        ))}
        {(taxonomies?.industry ?? []).length === 0 && (
          <p className="px-2 text-xs text-[var(--kaypal-v3-muted)]">
            暂无行业分类
          </p>
        )}
      </FilterGroup>

      <FilterGroup title="能力">
        {(taxonomies?.capability ?? []).map((tax) => (
          <CheckboxRow
            key={tax.slug}
            label={tax.name}
            checked={filters.capabilities.includes(tax.slug)}
            onChange={() =>
              update({
                capabilities: toggleInList(filters.capabilities, tax.slug),
              })
            }
          />
        ))}
        {(taxonomies?.capability ?? []).length === 0 && (
          <p className="px-2 text-xs text-[var(--kaypal-v3-muted)]">
            暂无能力分类
          </p>
        )}
      </FilterGroup>

      <FilterGroup title="来源">
        {PROVENANCE_OPTIONS.map((opt) => (
          <CheckboxRow
            key={opt.value}
            label={opt.label}
            checked={filters.provenances.includes(opt.value)}
            onChange={() =>
              update({
                provenances: toggleInList(filters.provenances, opt.value),
              })
            }
          />
        ))}
      </FilterGroup>

      <FilterGroup title="体验">
        <CheckboxRow
          label="仅看可体验案例"
          checked={filters.experience === true}
          onChange={() =>
            update({ experience: filters.experience === true ? null : true })
          }
        />
      </FilterGroup>
    </div>
  );
}
