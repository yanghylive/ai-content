"use client";

import React from "react";
import { redfoxApi } from "@/lib/api/redfox";
import { generateImage as dashGenerateImage } from "@/lib/api/dashscope";
import { toPublicError } from "@/lib/public-error";

type Tier = "standard" | "pro";

const SIZES = ["1024x1024", "768x1024", "1024x768"];

export default function AiImageGenPage() {
  const [tier, setTier] = React.useState<Tier>("standard");
  const [prompt, setPrompt] = React.useState("");
  const [size, setSize] = React.useState(SIZES[0]);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /** 标准档：百炼 qwen-image 同步生图（→ 素材库）；百炼不可用时回退 RedFox image2-GPT */
  const runStandard = async () => {
    try {
      const result = await dashGenerateImage({ prompt: prompt.trim(), size: size.replace("x", "*") });
      setStatus(`✅ 已生成：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB），已存入素材库`);
      return;
    } catch (e) {
      // 百炼失败 → 回退 RedFox
      const result = await redfoxApi.generateImage({ prompt: prompt.trim(), size });
      setStatus(`✅ 已生成：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB），已存入素材库`);
    }
  };

  /** Pro 档：Seedream 5.0 Pro 异步生图；不可用时自动降级百炼（保证可用） */
  const runPro = async () => {
    try {
      const submit = await redfoxApi.platformSeedreamPro({ prompt: prompt.trim() });
      const taskId = submit.taskId;
      if (!taskId) {
        setStatus("✅ 已生成，已存入素材库");
        return;
      }
      setStatus("⏳ Pro 生图中（约 30-90 秒，页面可先做别的）…");
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const q = await redfoxApi.platformSeedreamPro({ taskId });
        if (q.result || q.data) {
          setStatus("✅ 生成完成，已存入素材库");
          return;
        }
        if (q.submitted === false && !q.taskId) {
          throw new Error("Pro 生图失败，请稍后重试");
        }
      }
      throw new Error("Pro 生图超时，稍后到素材库查看是否已入库");
    } catch (redfoxErr) {
      // RedFox 不可用 → 降级百炼（高质量提示）
      const result = await dashGenerateImage({ prompt: prompt.trim(), size: "1024*1024" });
      setStatus(`✅ Pro 已降级为百炼高质量出图：${result.filename}（${(result.sizeBytes / 1048576).toFixed(1)}MB），已存入素材库`);
    }
  };

  const handleGen = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (tier === "standard") await runStandard();
      else await runPro();
      setPrompt("");
    } catch (e) {
      setError(toPublicError(e, "生图失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "8px 0 40px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.3px" }}>AI 生图</h1>
      <p style={{ color: "var(--kx-muted)", fontSize: 14, margin: "6px 0 20px" }}>
        描述画面即可生成图片，自动存入素材库
      </p>

      {/* 档位切换 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        {(
          [
            { key: "standard", name: "标准 · image2-GPT", desc: "快 · 日常配图" },
            { key: "pro", name: "Pro · Seedream 5.0", desc: "精 · 高质量出图" },
          ] as Array<{ key: Tier; name: string; desc: string }>
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTier(t.key)}
            style={{
              flex: 1,
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 16,
              cursor: "pointer",
              fontFamily: "inherit",
              border:
                tier === t.key
                  ? "1.5px solid var(--kx-accent)"
                  : "1px solid var(--kx-border)",
              background:
                tier === t.key ? "var(--kx-accent-soft)" : "var(--kx-card)",
              color: "var(--kx-ink)",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: "var(--kx-muted)", marginTop: 2 }}>
              {t.desc}
            </div>
          </button>
        ))}
      </div>

      {/* Prompt 输入 */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你要生成的画面，例如：清晨雾霭中的茶园，一位穿汉服的女孩在采茶，电影感光线"
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

      {/* 标准档尺寸 */}
      {tier === "standard" ? (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--kx-muted)" }}>尺寸</span>
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              style={{
                padding: "6px 12px",
                borderRadius: 10,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                border:
                  size === s
                    ? "1.5px solid var(--kx-accent)"
                    : "1px solid var(--kx-border)",
                background: size === s ? "var(--kx-accent-soft)" : "var(--kx-card)",
                color: "var(--kx-ink)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {/* 生成按钮 */}
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
        {busy ? "生成中…" : `生成图片（${tier === "standard" ? "标准" : "Pro"}）`}
      </button>

      {/* 状态/错误 */}
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
        提示：生成结果自动存入素材库，可直接用于内容创作与发布；如提示未开通数据能力，请联系系统管理员。
      </p>
    </div>
  );
}
