"use client";

import React, { useMemo, useState } from "react";
import { api } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { toActionableError } from "@/lib/public-error";

type RewriteVariant = {
  label: string;
  title: string;
  content: string;
  highlight: string;
};

type RewriteResult = {
  workflowId: string;
  platform: string;
  originalContent: string;
  rewrittenContent: string;
  variants: RewriteVariant[];
  changes: string[];
  suggestions: string[];
};

type CompareRow = {
  source: string;
  original: string;
  variants: RewriteVariant[];
  error?: string;
};

const PLATFORMS = [
  { value: "all", label: "全平台" },
  { value: "xiaohongshu", label: "小红书" },
  { value: "douyin", label: "抖音" },
  { value: "wechat", label: "公众号" },
  { value: "bilibili", label: "B站" },
] as const;

/**
 * F9 多平台文案批量对比
 * 多条文案 × 平台变体对比表：输入多行文案 → 逐条 rewrite → 并排对比
 * 复用 /content-optimization/rewrite（后端零改动）
 */
export default function CopyComparePage() {
  const [texts, setTexts] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CompareRow[]>([]);

  const parsedTexts = useMemo(
    () =>
      texts
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
    [texts],
  );

  const compare = async () => {
    if (parsedTexts.length === 0) {
      setError("先输入至少一条文案（每行一条）");
      return;
    }
    if (parsedTexts.length > 10) {
      setError("单次最多对比 10 条，分批进行");
      return;
    }
    setRunning(true);
    setError(null);
    setRows([]);
    try {
      const results = await Promise.all(
        parsedTexts.map(async (source) => {
          try {
            const r = await api.post<RewriteResult>("/content-optimization/rewrite", {
              content: source,
              platform,
              tone: "",
              goals: [],
              keepFacts: true,
            });
            return { source, original: source, variants: r.variants };
          } catch (e) {
            return {
              source,
              original: source,
              variants: [] as RewriteVariant[],
              error: toActionableError(e, "改写失败"),
            };
          }
        }),
      );
      setRows(results);
    } catch (e) {
      setError(toPublicError(e, "批量对比失败，请稍后重试"));
    } finally {
      setRunning(false);
    }
  };

  const variantLabels = rows[0]?.variants.map((v) => v.label) ?? [];

  return (
    <div className="kx-mobile-ambient" style={{ minHeight: "100dvh", paddingBottom: 90 }}>
      <V2BackButton />
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">多平台文案批量对比</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">同一条内容，各平台适配版本并排看（发布前检查）</p>
        </div>
      </div>

      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="kx-card" style={{ borderRadius: 20, padding: 16, background: "var(--kaypal-v3-panel-bg)", border: "1px solid var(--kaypal-v3-border)" }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10", color: "var(--kaypal-v3-ink)" }}>
            输入文案（每行一条，最多 10 条）
          </p>
          <textarea
            value={texts}
            onChange={(e) => setTexts(e.target.value)}
            placeholder={"例如：\n这款护眼台灯真的绝了，无频闪护眼，孩子写作业必备\n办公室午休神器，折叠躺椅收纳方便"}
            rows={5}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid var(--kaypal-v3-field-border)",
              background: "var(--kaypal-v3-field-bg)",
              fontSize: 14,
              color: "var(--kaypal-v3-ink)",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
          <p style={{ fontSize: 12, color: "var(--kaypal-v3-muted)", margin: "12px 0 6" }}>适配方向</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {PLATFORMS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPlatform(p.value)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: platform === p.value ? "1px solid rgba(16,185,129,.5)" : "1px solid var(--kaypal-v3-field-border)",
                  background: platform === p.value ? "rgba(16,185,129,.08)" : "var(--kaypal-v3-field-bg)",
                  color: platform === p.value ? "var(--kaypal-v3-success)" : "var(--kaypal-v3-soft-ink)",
                  fontSize: 13,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          {error && <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", margin: "10px 0 0" }}>{error}</p>}
          <button
            type="button"
            className="mx-btn-gold"
            disabled={running}
            onClick={() => void compare()}
            style={{ width: "100%", marginTop: 12, fontSize: 14, padding: "12px", opacity: running ? 0.6 : 1 }}
          >
            {running ? `对比中…（${rows.length}/${parsedTexts.length}）` : `开始批量对比（${parsedTexts.length} 条）`}
          </button>
        </div>

        {rows.length > 0 && (
          <div className="kx-card" style={{ borderRadius: 20, padding: 16, marginTop: 12, background: "var(--kaypal-v3-panel-bg)", border: "1px solid var(--kaypal-v3-border)" }}>
            <p style={{ fontSize: 13, fontWeight: 700, margin: "0 0 12", color: "var(--kaypal-v3-ink)" }}>
              对比结果（{rows.length} 条 × {variantLabels.length + 1} 版本）
            </p>
            {rows.map((row, ri) => (
              <div key={ri} style={{ marginBottom: 16, padding: 12, borderRadius: 14, border: "1px solid var(--kaypal-v3-border)", background: "var(--kaypal-v3-field-bg)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-muted)", margin: "0 0 8" }}>
                  原文 #{ri + 1}
                  {row.error && <span style={{ color: "var(--kaypal-v3-danger)", marginLeft: 8 }}>❌ {row.error}</span>}
                </p>
                <p style={{ fontSize: 13, color: "var(--kaypal-v3-ink)", margin: "0 0 10", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {row.original}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {row.variants.map((v, vi) => (
                    <div key={vi} style={{ padding: "10px 12px", borderRadius: 12, background: "var(--kaypal-v3-accent-soft)" }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--kaypal-v3-success)", margin: "0 0 4" }}>
                        {v.label} <span style={{ fontWeight: 400, color: "var(--kaypal-v3-muted)" }}>· {v.title}</span>
                      </p>
                      <p style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {v.content}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", margin: "6px 0 0" }}>{v.highlight}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11, color: "var(--kaypal-v3-muted)", margin: "8px 0 0" }}>
              对比结果用于发布前检查：各平台语气/结构差异一目了然，改完可直接复制到对应平台
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
