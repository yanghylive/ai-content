"use client";

/**
 * AI 网页代操作（对标炼刀 midscene，P1 前端接入 2026-08-10）
 * 自然语言指令 → 动作序列（goto/type/click/screenshot/extract/wait）→ 本机浏览器真实执行 + 每步截图证据
 * 依赖本机 local-engine 引擎（DISPATCH_MOCK 关闭时真实执行），云端/移动端不可用。
 */
import React, { useState } from "react";
import { Button, Input, Textarea, addToast } from "@heroui/react";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  runBrowserAiAction,
  type AiBrowserRunResult,
  type AiBrowserStepResult,
} from "@/lib/api/local-engine";
import { toPublicError } from "@/lib/public-error";
import { V2BackButton } from "@/components/v2/v2-back-button";

const ACTION_LABEL: Record<string, string> = {
  goto: "打开页面",
  type: "输入文字",
  click: "点击",
  screenshot: "截图",
  extract: "提取内容",
  wait: "等待",
};

export default function AiActionPage() {
  const isMobile = useIsMobile();
  const [instruction, setInstruction] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiBrowserRunResult | null>(null);
  const [err, setErr] = useState("");

  const handleRun = async () => {
    if (!instruction.trim()) {
      addToast({ title: "请描述要执行的操作", color: "danger" });
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const data = await runBrowserAiAction({
        instruction: instruction.trim(),
        url: url.trim() || undefined,
      });
      setResult(data);
      if (data.ok) addToast({ title: "✅ 浏览器执行完成" });
    } catch (e) {
      setErr(toPublicError(e, "执行失败（本机引擎不可用？）"));
    } finally {
      setBusy(false);
    }
  };

  const stepView = (s: AiBrowserStepResult) => (
    <div
      key={s.step}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(120,148,179,.1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10.5,
            fontWeight: 700,
            color: "#fff",
            background: s.ok ? "#059669" : "#dc2626",
            flexShrink: 0,
          }}
        >
          {s.ok ? "✓" : "✕"}
        </span>
        <b>步骤 {s.step}</b>
        {s.action ? <span style={{ opacity: 0.75 }}>· {ACTION_LABEL[s.action] || s.action}</span> : null}
      </div>
      {s.description ? <div style={{ fontSize: 12, opacity: 0.85 }}>{s.description}</div> : null}
      {s.data ? (
        <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", opacity: 0.8, maxHeight: 140, overflow: "auto" }}>
          {typeof s.data === "string" ? s.data : JSON.stringify(s.data, null, 2)}
        </pre>
      ) : null}
      {s.screenshot ? (
        // 截图证据为动态 base64/dataURL，不适合 next/image 优化
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.screenshot} alt={`步骤${s.step}截图`} style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(142,165,190,.25)" }} />
      ) : null}
    </div>
  );

  const form = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 560 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        操作指令 *
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="如：打开 baidu.com，搜索 AI 内容创作，点第一条结果，截图"
          rows={3}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600 }}>
        起始网址（可选）
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="如：https://example.com" />
      </label>
      <Button color="primary" isLoading={busy} onPress={handleRun} style={{ alignSelf: "flex-start" }}>
        执行操作
      </Button>
      {err ? <p style={{ fontSize: 12.5, color: "#dc2626" }}>⚠️ {err}</p> : null}
    </div>
  );

  const resultView = result ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 560 }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>🧭 执行结果（{result.results?.length || 0} 步）</div>
      {result.actions?.length ? (
        <div style={{ fontSize: 11.5, opacity: 0.7 }}>
          动作序列：{result.actions.map((a) => a.action).join(" → ")}
        </div>
      ) : null}
      {result.results?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{result.results.map(stepView)}</div>
      ) : (
        <div style={{ fontSize: 12.5, opacity: 0.8 }}>（无步骤结果）</div>
      )}
    </div>
  ) : null;

  if (isMobile) {
    return (
      <div className="kx-mobile-ambient">
        <V2BackButton />
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">AI 网页代操作</h1>
              <p className="mx-page-sub">自然语言指令驱动浏览器执行</p>
            </div>
          </div>
        </header>
        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 16 }}>
            {form}
          </div>
          {resultView ? <div className="mx-card" style={{ padding: 14, marginTop: 12 }}>{resultView}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-6">
      <header>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>AI 网页代操作</h2>
        <p style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>用自然语言让浏览器自动执行：打开页面、输入、点击、提取、截图（依赖本机引擎，每步留证据）</p>
      </header>
      {form}
      {resultView}
    </div>
  );
}
