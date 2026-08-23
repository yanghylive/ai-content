import { CalendarDays, Layers, MonitorSmartphone } from "lucide-react";
import type { CaseDetailDto } from "@/lib/api/case-showcase";
import { ProvenanceBadge } from "./provenance-badge";

/**
 * 案例详情首屏 Hero：标题 / 副标题 / 来源标识 / 平台 / 行业 / 更新时间。
 * 来源标识走文字 + 颜色双通道（ProvenanceBadge），首屏可见。
 */

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function CaseHero({
  detail,
  platformLabel,
  industryLabel,
}: {
  detail: CaseDetailDto;
  platformLabel: string;
  industryLabel: string;
}) {
  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <ProvenanceBadge provenanceType={detail.provenanceType} />
        </div>

        <h1 className="mt-4 kx-greet leading-tight text-[var(--kaypal-v3-ink)] sm:text-3xl">
          {detail.title}
        </h1>
        {detail.subtitle && (
          <p className="mt-2 text-base text-[var(--kaypal-v3-soft-ink)]">
            {detail.subtitle}
          </p>
        )}

        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-[var(--kaypal-v3-muted)]">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4" aria-hidden />
            <dt className="sr-only">平台</dt>
            <dd>{platformLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" aria-hidden />
            <dt className="sr-only">行业</dt>
            <dd>{industryLabel}</dd>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" aria-hidden />
            <dt className="sr-only">更新时间</dt>
            <dd>更新于 {formatDate(detail.updatedAt)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
