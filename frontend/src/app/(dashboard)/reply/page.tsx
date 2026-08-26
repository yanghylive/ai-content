"use client";

import React, { useCallback, useState } from "react";
import { replyApi, type ReplySuggestionItem } from "@/lib/api/reply";
import { shareText } from "@/lib/mobile-bridge";
import { V2BackButton } from "@/components/v2/v2-back-button";

const TONE_LABEL: Record<string, string> = {
  friendly: "亲切",
  formal: "正式",
  professional: "专业",
};

const TONE_COLOR: Record<string, string> = {
  friendly: "var(--kaypal-v3-success)",
  formal: "var(--kaypal-v3-purple)",
  professional: "var(--kaypal-v3-amber)",
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
  const [shareMsg, setShareMsg] = useState("");

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

  const forward = useCallback((content: string) => {
    void shareText(content).then((result) => {
      setShareMsg(result.message);
      window.setTimeout(() => setShareMsg(""), 3200);
    });
  }, []);

  return (
    <div>
      <V2BackButton />
      {/* 页面头 */}
      <div className="kx-page-head">
        <div>
          <h1 className="kx-greet text-[var(--kaypal-v3-ink)]">AI 回复建议</h1>
          <p className="kx-greet-sub mt-1 text-[var(--kaypal-v3-muted)]">评论/私信怎么回？AI 给你 3 版</p>
        </div>
      </div>

      {/* 输入区 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>评论内容</div>
          <textarea
            placeholder="粘贴用户的评论或私信，例如：这个工具多少钱？有用吗？"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            style={{ width: "100%", background: "var(--kaypal-v3-field-bg)", border: "1px solid var(--kaypal-v3-border)", borderRadius: 10, color: "var(--kaypal-v3-soft-ink)", padding: "10px 12px", fontSize: 13, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6 }}
          />
          <input
            type="text"
            placeholder="你的产品/服务名（可选），如：JIUZHANG AI"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            style={{ width: "100%", marginTop: 10, background: "var(--kaypal-v3-field-bg)", border: "1px solid var(--kaypal-v3-border)", borderRadius: 10, color: "var(--kaypal-v3-soft-ink)", padding: "10px 12px", fontSize: 13, boxSizing: "border-box" }}
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
                  background: tone === item.key ? "var(--kaypal-v3-accent-soft)" : "transparent",
                  border: tone === item.key ? "1px solid var(--kaypal-v3-accent)" : "1px solid var(--kaypal-v3-border)",
                  color: tone === item.key ? "var(--kaypal-v3-amber)" : "var(--kaypal-v3-soft-ink)",
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
            <div style={{ marginTop: 10, fontSize: 12, color: error.startsWith("请先") ? "var(--kaypal-v3-soft-ink)" : "var(--kaypal-v3-amber)", lineHeight: 1.6 }}>
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
            {shareMsg && (
              <span style={{ fontSize: 11, color: "var(--kaypal-v3-success)" }}>{shareMsg}</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {suggestions.map((item, index) => {
              const color = TONE_COLOR[item.tone] ?? "var(--kaypal-v3-muted)";
              return (
                <div key={`${item.tone}-${index}`} className="mx-card" style={{ padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span className="platform-dot" style={{ background: color, width: 7, height: 7, borderRadius: 999, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color, fontWeight: 600 }}>{TONE_LABEL[item.tone] ?? item.tone}</span>
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--kaypal-v3-soft-ink)" }}>{item.content}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      className="mx-btn-gold"
                      style={{ flex: 1, fontSize: 12, padding: "7px 10px" }}
                      onClick={() => copy(item.content)}
                    >
                      {copied === item.content ? "已复制 ✓" : "复制"}
                    </button>
                    <button
                      type="button"
                      style={{
                        flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 999,
                        background: "var(--kaypal-v3-accent-soft)", border: "1px solid var(--kaypal-v3-accent)", color: "var(--kaypal-v3-amber)",
                      }}
                      onClick={() => forward(item.content)}
                    >
                      一键转发
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
