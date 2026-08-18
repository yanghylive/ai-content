/**
 * 四类来源标识（文字 + 颜色双通道，不能纯颜色区分）。
 *
 * PRD 核心要求：首屏必须用文字标识案例来源，避免第三方演示被误判为
 * 九章交付。每种来源既有明确文字标签，也有独立配色，色弱/灰度环境下
 * 仍可通过文字辨认。
 */
import type { ProvenanceType } from "@/lib/api/case-showcase";

export interface ProvenanceBadgeProps {
  provenanceType: string;
  size?: "sm" | "md";
}

interface ProvenanceMeta {
  label: string;
  background: string;
  foreground: string;
  dot: string;
}

const PROVENANCE_META: Record<ProvenanceType, ProvenanceMeta> = {
  delivery: {
    label: "九章交付",
    background: "var(--kaypal-v3-accent-soft)",
    foreground: "var(--kaypal-v3-accent-ink)",
    dot: "var(--kaypal-v3-accent)",
  },
  open_source: {
    label: "开源演示",
    background: "var(--kaypal-v3-blue-soft)",
    foreground: "var(--kaypal-v3-cobalt)",
    dot: "var(--kaypal-v3-cobalt)",
  },
  prototype: {
    label: "概念原型",
    background: "var(--kaypal-v3-amber-soft)",
    foreground: "var(--kaypal-v3-amber)",
    dot: "var(--kaypal-v3-amber)",
  },
  template: {
    label: "可定制模板",
    background: "var(--kaypal-v3-success-soft)",
    foreground: "var(--kaypal-v3-success)",
    dot: "var(--kaypal-v3-success)",
  },
};

const FALLBACK_META: ProvenanceMeta = PROVENANCE_META.prototype;

export function ProvenanceBadge({
  provenanceType,
  size = "md",
}: ProvenanceBadgeProps) {
  const meta =
    (PROVENANCE_META as Record<string, ProvenanceMeta>)[provenanceType] ??
    FALLBACK_META;
  const fontSize = size === "sm" ? "11px" : "12px";
  const padding = size === "sm" ? "2px 8px" : "4px 10px";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full font-semibold leading-none"
      style={{
        background: meta.background,
        color: meta.foreground,
        fontSize,
        padding,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.dot,
        }}
      />
      {meta.label}
    </span>
  );
}
