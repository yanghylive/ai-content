import type { CaseListParams, CaseSort } from "@/lib/api/case-showcase";

/**
 * 案例筛选状态与 URL query 的双向转换（单一真源）。
 * 筛选条件同步到 URL，刷新/前进后退可恢复。
 */

export interface ActiveFilters {
  q: string;
  platforms: string[];
  industries: string[];
  capabilities: string[];
  provenances: string[];
  /** null = 不限，true = 仅可体验，false = 无体验 */
  experience: boolean | null;
  sort: CaseSort;
}

export const DEFAULT_FILTERS: ActiveFilters = {
  q: "",
  platforms: [],
  industries: [],
  capabilities: [],
  provenances: [],
  experience: null,
  sort: "recommended",
};

export function parseCsv(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function toCsv(values: string[]): string | null {
  return values.length > 0 ? values.join(",") : null;
}

export function filtersToSearchParams(filters: ActiveFilters): URLSearchParams {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q) params.set("q", q);

  const platform = toCsv(filters.platforms);
  if (platform) params.set("platform", platform);

  const industry = toCsv(filters.industries);
  if (industry) params.set("industry", industry);

  const capability = toCsv(filters.capabilities);
  if (capability) params.set("capability", capability);

  const provenance = toCsv(filters.provenances);
  if (provenance) params.set("provenance", provenance);

  if (filters.experience !== null) {
    params.set("experience", filters.experience ? "true" : "false");
  }
  if (filters.sort && filters.sort !== "recommended") {
    params.set("sort", filters.sort);
  }
  return params;
}

export function filtersFromSearchParams(
  params: URLSearchParams,
): ActiveFilters {
  const experience = params.get("experience");
  return {
    q: params.get("q") ?? "",
    platforms: parseCsv(params.get("platform")),
    industries: parseCsv(params.get("industry")),
    capabilities: parseCsv(params.get("capability")),
    provenances: parseCsv(params.get("provenance")),
    experience:
      experience === "true" ? true : experience === "false" ? false : null,
    sort: (params.get("sort") as CaseSort) ?? "recommended",
  };
}

export function filtersToApiParams(filters: ActiveFilters): CaseListParams {
  return {
    q: filters.q.trim() || undefined,
    platform: toCsv(filters.platforms) ?? undefined,
    industry: toCsv(filters.industries) ?? undefined,
    capability: toCsv(filters.capabilities) ?? undefined,
    provenance: toCsv(filters.provenances) ?? undefined,
    experience:
      filters.experience === null
        ? undefined
        : filters.experience
          ? "true"
          : "false",
    sort: filters.sort,
  };
}

export function hasActiveFilters(filters: ActiveFilters): boolean {
  return (
    filters.q.trim() !== "" ||
    filters.platforms.length > 0 ||
    filters.industries.length > 0 ||
    filters.capabilities.length > 0 ||
    filters.provenances.length > 0 ||
    filters.experience !== null
  );
}
