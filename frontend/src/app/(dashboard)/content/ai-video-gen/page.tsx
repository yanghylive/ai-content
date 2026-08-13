"use client";

import React from "react";
import { generateVideo as dashGenerateVideo } from "@/lib/api/dashscope";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";

const DURATIONS = [3, 5, 10, 15];

export default function AiVideoGenPage() {
  const [prompt, setPrompt] = React.useState("");
  const [duration, setDuration] = React.useState(5);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const handleGen = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setStatus("生成中（约 1-5 分钟，请稍候）…");
    setError(null);
    try {
      const result = await dashGenerateVideo({ prompt: prompt.trim(), duration });
      setStatus(`✅ 已生成：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB），已存入素材库`);
      setPrompt("");
    } catch (e) {
      setStatus(null);
      setError(toPublicError(e, "生视频失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 0 40px" }}>
      <V2BackButton to="/content" />
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.3px", marginTop: 4 }}>AI 生视频</h1>
      <p style={{ color: "var(--kx-muted)", fontSize: 14, margin: "6px 0 20px" }}>
        描述画面即可生成短视频（happyhorse-1.1），自动存入素材库
      </p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你要的视频画面，如：产品特写，暖光，缓慢推镜头…"
        rows={4}
        style={{
          width: "100%",
          boxSizing: "border-box",
          borderRadius: 14,
          border: "1px solid var(--kx-border)",
          background: "var(--kx-card)",
          color: "var(--kx-ink)",
          padding: "12px 14px",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
          resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--kx-muted)" }}>时长</span>
        {DURATIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDuration(d)}
            style={{
              padding: "6px 14px",
              borderRadius: 10,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              border:
                duration === d
                  ? "1.5px solid var(--kx-accent)"
                  : "1px solid var(--kx-border)",
              background: duration === d ? "var(--kx-accent-soft)" : "var(--kx-card)",
              color: "var(--kx-ink)",
            }}
          >
            {d}s
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!prompt.trim() || busy}
        onClick={handleGen}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "12px 18px",
          borderRadius: 14,
          fontSize: 15,
          fontWeight: 700,
          cursor: busy || !prompt.trim() ? "not-allowed" : "pointer",
          opacity: busy || !prompt.trim() ? 0.6 : 1,
          fontFamily: "inherit",
          border: "none",
          background: "linear-gradient(135deg, #d98f2b, #efb45b)",
          color: "#173052",
        }}
      >
        {busy ? "生成中…" : "生成视频"}
      </button>

      {status ? (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            fontSize: 13,
            background: "var(--kx-success-soft, rgba(22,163,74,.1))",
            color: "var(--kx-success, #16a34a)",
          }}
        >
          {status}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            fontSize: 13,
            background: "var(--kx-danger-soft, rgba(220,38,38,.1))",
            color: "var(--kx-danger, #dc2626)",
          }}
        >
          {error}
        </div>
      ) : null}

      <p style={{ marginTop: 18, fontSize: 12, color: "var(--kx-muted)", lineHeight: 1.7 }}>
        提示：生成结果自动存入素材库，可直接用于内容创作与发布；视频生成约需 1-5 分钟。
      </p>
    </div>
  );
}
