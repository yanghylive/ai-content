"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  V2Section,
  V2StatusChip,
  V2Textarea,
  V2Select,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import { contentWorkspaceApi } from "@/lib/api/content-workspace";
import type { ContentWorkspaceComplianceCheckResult } from "@/lib/content-workspace-types";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";

const RISK_DISPLAY: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "muted"; icon: typeof CheckCircle2 }
> = {
  low: { label: "低风险 · 可以发布", tone: "success", icon: CheckCircle2 },
  medium: { label: "中风险 · 建议修改", tone: "warning", icon: AlertTriangle },
  high: { label: "高风险 · 不要发布", tone: "danger", icon: XCircle },
  unknown: { label: "无法判断", tone: "muted", icon: AlertTriangle },
};

const PLATFORM_OPTIONS = [
  { value: "gongzhonghao", label: "公众号" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "bilibili", label: "B站" },
];

export function ComplianceCheckFlow() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [content, setContent] = useState("");
  const [platform, setPlatform] = useState("gongzhonghao");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ContentWorkspaceComplianceCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canCheck = content.trim().length >= 20;

  const handleCheck = async () => {
    if (!canCheck) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const data = await contentWorkspaceApi.checkCompliance({
        content,
        platform: platform as never,
        targetType: "article",
        // 空字符串：后端 dto.targetId 为 falsy 时跳过版本标记副作用
        targetId: "",
        scenario: "pre_publish",
      });
      setResult(data);
    } catch (err: unknown) {
      setError(toPublicError(err, "检查失败，请稍后重试"));
    } finally {
      setChecking(false);
    }
  };

  const riskDisplay = result
    ? RISK_DISPLAY[result.riskLevel] || RISK_DISPLAY.unknown
    : null;
  const RiskIcon = riskDisplay?.icon || ShieldCheck;

  /* 移动端原生视图（mx-* 明德 VP 风格）——compliance-check-v2 */
  if (isMobile) {
    const resultColor =
      riskDisplay?.tone === "success" ? "#059669"
        : riskDisplay?.tone === "warning" ? "#b45309"
          : riskDisplay?.tone === "danger" ? "#dc2626"
            : "var(--mx-muted)";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-header-row" style={{ alignItems: "center" }}>
              <button type="button" onClick={() => router.push("/distribution/compliance")} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--mx-muted)", background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                <ArrowLeft width={14} height={14} /> 返回合规中心
              </button>
              <div style={{ textAlign: "center", flex: 1 }}>
                <div className="mx-page-title" style={{ fontSize: 18 }}>合规检查</div>
                <div className="mx-page-sub" style={{ marginTop: 1 }}>粘贴内容，一键检查，别等被平台处罚了才后悔</div>
              </div>
              <span style={{ flexShrink: 0, width: 44 }} />
            </div>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12.5, color: "#dc2626" }}>{error}</p>
            </div>
          )}

          {/* 输入区 */}
          <div className="mx-card" style={{ marginTop: 12, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 12.5, color: "var(--mx-muted)", flexShrink: 0 }}>发布到</span>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}>
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <textarea
              rows={8}
              placeholder="把你要发布的文章/文案完整粘贴到这里（至少 20 字）…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              style={{ width: "100%", marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5, resize: "vertical", lineHeight: 1.6 }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "var(--mx-muted)" }}>
                {content.length} 字{content.trim().length < 20 ? "（至少 20 字才能检查）" : ""}
              </span>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ padding: "9px 18px", display: "inline-flex", alignItems: "center", gap: 6 }}
                disabled={!canCheck || checking}
                onClick={() => void handleCheck()}
              >
                <ShieldCheck width={15} height={15} />
                {checking ? "正在检查…" : "开始检查"}
              </button>
            </div>
          </div>

          {/* 结果 */}
          {result && riskDisplay && (
            <>
              <div className="mx-card" style={{ marginTop: 12, padding: 14, borderColor: resultColor }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <RiskIcon width={26} height={26} style={{ color: resultColor, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: resultColor }}>{riskDisplay.label}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--mx-muted)", marginTop: 3, lineHeight: 1.5 }}>{result.summary}</span>
                  </span>
                </div>
              </div>

              {result.findings && result.findings.length > 0 && (
                <>
                  <div className="mx-section-head" style={{ marginTop: 16 }}>发现 {result.findings.length} 个问题</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {result.findings.map((finding) => (
                      <div key={finding.id} className="mx-card" style={{ padding: 13 }}>
                        <span className={`mx-badge ${finding.riskLevel === "high" ? "mx-badge-red" : finding.riskLevel === "medium" ? "mx-badge-gold" : "mx-badge-blue"}`} style={{ fontSize: 10 }}>
                          {finding.category}
                        </span>
                        <p style={{ fontSize: 12.5, color: "var(--mx-ink)", background: "rgba(220,80,80,.08)", padding: "8px 10px", borderRadius: 8, marginTop: 8, lineHeight: 1.55 }}>
                          「{finding.matchedText}」
                        </p>
                        <p style={{ fontSize: 11.5, color: "var(--mx-muted)", marginTop: 7, lineHeight: 1.55 }}>{finding.reason}</p>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "#d98a2d", marginTop: 6, lineHeight: 1.5 }}>建议：{finding.suggestion}</p>
                        {finding.replacement && (
                          <p style={{ fontSize: 12, color: "var(--mx-ink)", background: "rgba(5,150,105,.08)", padding: "8px 10px", borderRadius: 8, marginTop: 7, lineHeight: 1.5 }}>
                            可改成：「{finding.replacement}」
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          <button type="button" onClick={() => router.push("/distribution/compliance")} style={{ marginTop: 18, padding: "9px 18px", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ArrowLeft width={14} height={14} /> 返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="kaypal-v3-panel p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="rounded-[var(--kaypal-v3-radius-sm)] p-2 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
            onClick={() => router.push("/distribution/compliance")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
              合规检查
            </h1>
            <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
              粘贴内容，一键检查，别等被平台处罚了才后悔
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
          <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{error}</p>
        </div>
      )}

      {/* 输入区 */}
      <V2Section title="要检查的内容">
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--kaypal-v3-muted)]">发布到</span>
            <div className="w-40">
              <V2Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {PLATFORM_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </V2Select>
            </div>
          </div>
          <V2Textarea
            rows={10}
            placeholder="把你要发布的文章/文案完整粘贴到这里（至少 20 字）..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--kaypal-v3-muted)]">
              {content.length} 字{content.trim().length < 20 ? "（至少 20 字才能检查）" : ""}
            </span>
            <V2PrimaryButton
              icon={ShieldCheck}
              loading={checking}
              disabled={!canCheck}
              onClick={handleCheck}
            >
              {checking ? "正在检查..." : "开始检查"}
            </V2PrimaryButton>
          </div>
        </div>
      </V2Section>

      {/* 结果区 */}
      {result && riskDisplay && (
        <>
          <section
            className="rounded-[var(--kaypal-v3-radius)] border p-6"
            style={{
              borderColor:
                riskDisplay.tone === "success"
                  ? "var(--kaypal-v3-success)"
                  : riskDisplay.tone === "warning"
                    ? "var(--kaypal-v3-amber)"
                    : "var(--kaypal-v3-danger)",
              background:
                riskDisplay.tone === "success"
                  ? "var(--kaypal-v3-success-soft)"
                  : riskDisplay.tone === "warning"
                    ? "var(--kaypal-v3-amber-soft)"
                    : "var(--kaypal-v3-danger-soft)",
            }}
          >
            <div className="flex items-center gap-3">
              <RiskIcon
                className="h-8 w-8"
                style={{
                  color:
                    riskDisplay.tone === "success"
                      ? "var(--kaypal-v3-success)"
                      : riskDisplay.tone === "warning"
                        ? "var(--kaypal-v3-amber)"
                        : "var(--kaypal-v3-danger)",
                }}
              />
              <div>
                <h2 className="text-xl font-bold text-[var(--kaypal-v3-ink)]">
                  {riskDisplay.label}
                </h2>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  {result.summary}
                </p>
              </div>
            </div>
          </section>

          {result.findings && result.findings.length > 0 && (
            <V2Section title={`发现 ${result.findings.length} 个问题`} padding={false}>
              <div className="divide-y divide-[var(--kaypal-v3-border)]">
                {result.findings.map((finding) => (
                  <div key={finding.id} className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <V2StatusChip
                            tone={
                              finding.riskLevel === "high"
                                ? "danger"
                                : finding.riskLevel === "medium"
                                  ? "warning"
                                  : "muted"
                            }
                          >
                            {finding.category}
                          </V2StatusChip>
                        </div>
                        <p className="mt-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-danger-soft)] p-2.5 text-sm text-[var(--kaypal-v3-ink)]">
                          「{finding.matchedText}」
                        </p>
                        <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                          {finding.reason}
                        </p>
                        <p className="mt-1.5 text-sm font-medium text-[var(--kaypal-v3-accent-ink)]">
                          建议：{finding.suggestion}
                        </p>
                        {finding.replacement && (
                          <p className="mt-1 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-success-soft)] p-2.5 text-sm text-[var(--kaypal-v3-ink)]">
                            可改成：「{finding.replacement}」
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </V2Section>
          )}
        </>
      )}

      <section className="flex items-center justify-between">
        <V2GhostButton icon={ArrowLeft} onClick={() => router.push("/distribution/compliance")}>
          返回
        </V2GhostButton>
      </section>
    </div>
  );
}
