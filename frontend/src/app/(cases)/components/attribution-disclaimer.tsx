import { FileBadge, Link2, Scale, ShieldCheck } from "lucide-react";
import type {
  CaseDetailDto,
  PublicAttributionDto,
} from "@/lib/api/case-showcase";
import { ProvenanceBadge } from "./provenance-badge";

/**
 * 来源与声明模块（PRD §9.5 第 10 步 + 附录 B）：
 *   - 四类固定免责声明（文案由后端 disclaimer 字段下发，PRD 附录 B 原文）；
 *   - 许可证 / 授权归属文本（attribution，仅公开字段，不含私有附件）；
 *   - 证据等级（E0-E3）说明。
 */

/** 证据等级说明（PRD §6.3） */
const EVIDENCE_DEFINITIONS: Record<string, string> = {
  E3: "已验证：有客户确认、系统数据或正式验收材料支持，可展示明确数字并注明统计范围与时间。",
  E2: "内部测量：由九章在测试或交付过程中测量，标注“九章测试数据”及测试条件。",
  E1: "估算：基于方案模型或有限样本估算，展示时标注“估算”，不得作为确定结果。",
  E0: "无量化证据：仅能说明功能或定性反馈，不展示虚构数字，仅使用可验证事实描述。",
};

function AttributionRow({ item }: { item: PublicAttributionDto }) {
  return (
    <li className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {item.grantor && (
          <span className="text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            {item.grantor}
          </span>
        )}
        {item.licenseName && (
          <span
            className="rounded-full px-2 py-0.5 text-11 font-semibold leading-none"
            style={{
              background: "var(--kaypal-v3-blue-soft)",
              color: "var(--kaypal-v3-cobalt)",
            }}
          >
            {item.licenseName}
          </span>
        )}
      </div>
      {item.scope && (
        <p className="mt-1.5 text-xs leading-5 text-[var(--kaypal-v3-muted)]">
          {item.scope}
        </p>
      )}
      {item.sourceUrl && (
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[var(--kaypal-v3-accent-ink)] hover:underline"
        >
          <Link2 className="h-3 w-3" aria-hidden />
          查看来源
        </a>
      )}
    </li>
  );
}

export function AttributionDisclaimer({ detail }: { detail: CaseDetailDto }) {
  const attribution = detail.attribution ?? [];
  const evidenceDefinition = EVIDENCE_DEFINITIONS[detail.evidenceLevel];

  return (
    <section className="rounded-[var(--kaypal-v3-radius)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-6 sm:p-8">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
        <Scale className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />
        来源与声明
      </h2>

      {/* 来源标识 + 固定免责声明（PRD 附录 B 原文） */}
      <div className="flex items-start gap-3">
        <ProvenanceBadge provenanceType={detail.provenanceType} size="sm" />
        <p className="text-sm leading-6 text-[var(--kaypal-v3-muted)]">
          {detail.disclaimer ?? "本案例来源信息以实际授权记录为准。"}
        </p>
      </div>

      {/* 许可证 / 授权归属文本（公开字段，不含私有附件） */}
      {attribution.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <FileBadge className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />
            来源与许可
          </h3>
          <ul className="space-y-2">
            {attribution.map((item, index) => (
              <AttributionRow key={index} item={item} />
            ))}
          </ul>
        </div>
      )}

      {/* 证据等级说明 */}
      {evidenceDefinition && (
        <div className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--kaypal-v3-ink)]">
            <ShieldCheck className="h-4 w-4 text-[var(--kaypal-v3-accent-ink)]" aria-hidden />
            证据等级说明（{detail.evidenceLevel}）
          </h3>
          <p className="text-xs leading-5 text-[var(--kaypal-v3-muted)]">
            {evidenceDefinition}
          </p>
        </div>
      )}
    </section>
  );
}
