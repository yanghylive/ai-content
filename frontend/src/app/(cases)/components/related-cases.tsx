import type { CaseSummaryDto } from "@/lib/api/case-showcase";
import { CaseCard } from "./case-card";

/**
 * 相关案例（PRD §9.5 第 11 步 + M3-06）。
 * 复用 M2 的 CaseCard Compact 变体，数据来自详情 API 的 relatedCases。
 */
export function RelatedCases({ cases }: { cases: CaseSummaryDto[] }) {
  if (cases.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
        相关案例
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cases.map((item) => (
          <CaseCard key={item.id} item={item} variant="compact" />
        ))}
      </div>
    </section>
  );
}
