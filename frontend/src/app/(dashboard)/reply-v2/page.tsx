"use client";

import React, { useCallback, useState } from "react";
import { replyApi, type ReplySuggestionItem } from "@/lib/api/reply";

const TONE_LABEL: Record<string, string> = {
  friendly: "亲切",
  formal: "正式",
  professional: "专业",
};

const TONE_COLOR: Record<string, string> = {
  friendly: "#059669",
  formal: "#6366f1",
  professional: "#d98a2d",
};

export default function ReplyV2Page() {
  const [comment, setComment] = useState("");
  const [productName, setProductName] = useState("");
  const [tone, setTone] = useState<"formal" | "friendly" | "professional" | "">("");
  const [suggestions, setSuggestions] = useState<ReplySuggestionItem[]>([]);
  const [source, setSource] = useState<"ai" | "local" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  const generate = useCallback(async () => {
    if (!comment.trim()) {
      setError("请先粘贴或输入评论内容");
      return;
    }
    setLoading(true);
    setError("");
    setSuggestions([]);
    setSource("");
    try {
      const result = await replyApi.suggest({
        comment: comment.trim(),
        tone: tone || undefined,
        productName: productName.trim() || undefined,
      });
      if (result.message && result.suggestions.length === 0) {
        setError(result.message);
        return;
      }
      setSuggestions(result.suggestions ?? []);
      setSource(result.source ?? "");
      if (result.source === "local") {
        setError(
          result.fallbackMessage || "AI 暂不可用，已展示本地规则建议",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [comment, tone, productName]);

  const copy = useCallback((content: string) => {
    void navigator.clipboard?.writeText(content).then(() => {
      setCopied(content);
      window.setTimeout(() => setCopied(""), 1800);
    });
  }, []);

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">AI 回复建议</h1>
            <p className="mx-page-sub">评论/私信怎么回？AI 给你 3 版</p>
          </div>
        </div>
      </header>

      {/* 输入区 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>评论内容</div>
          <textarea
            placeholder="粘贴用户的评论或私信，例如：这个工具多少钱？有用吗？"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, color: "#dbe7f5", padding: "10px 12px", fontSize: 13, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6 }}
          />
          <input
            type="text"
            placeholder="你的产品/服务名（可选），如：JIUZHANG AI"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            style={{ width: "100%", marginTop: 10, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, color: "#dbe7f5", padding: "10px 12px", fontSize: 13, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {(
              [
                { key: "", label: "全语气" },
                { key: "friendly", label: "亲切" },
                { key: "formal", label: "正式" },
                { key: "professional", label: "专业" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTone(item.key)}
                style={{
                  fontSize: 12, padding: "6px 12px", borderRadius: 999,
                  background: tone === item.key ? "rgba(244,187,103,.16)" : "transparent",
                  border: tone === item.key ? "1px solid rgba(244,187,103,.6)" : "1px solid rgba(255,255,255,.18)",
                  color: tone === item.key ? "#f4bb67" : "#dbe7f5",
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ marginTop: 14, width: "100%" }}
            disabled={loading}
            onClick={() => void generate()}
          >
            {loading ? "AI 生成中…" : "生成回复建议"}
          </button>
          {error ? (
            <div style={{ marginTop: 10, fontSize: 12, color: error.startsWith("请先") ? "#dbe7f5" : "#fbbf24", lineHeight: 1.6 }}>
              {error}
            </div>
          ) : null}
        </div>
      </section>

      {/* 建议列表 */}
      {suggestions.length > 0 ? (
        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              回复建议
              {source === "ai" ? (
                <span className="mx-badge mx-badge-gold" style={{ marginLeft: 8, fontSize: 10 }}>AI 生成</span>
              ) : (
                <span className="mx-badge" style={{ marginLeft: 8, fontSize: 10 }}>规则建议</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {suggestions.map((item, index) => {
              const color = TONE_COLOR[item.tone] ?? "#94a3b8";
              return (
                <div key={`${item.tone}-${index}`} className="mx-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span className="platform-dot" style={{ background: color, width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color, fontWeight: 600 }}>{TONE_LABEL[item.tone] ?? item.tone}</span>
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#e2edf9" }}>{item.content}</div>
                  <button
                    type="button"
                    className="mx-btn-gold"
                    style={{ marginTop: 10, fontSize: 12, padding: "7px 14px" }}
                    onClick={() => copy(item.content)}
                  >
                    {copied === item.content ? "已复制 ✓" : "复制回复"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
