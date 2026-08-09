"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  redfoxApi,
  type ViralAnalyzeResult,
} from "@/lib/api/redfox";
import { intelligenceApi } from "@/lib/api/intelligence";
import { shareText, copyText } from "@/lib/mobile-bridge";

function formatNumber(value: number | undefined): string {
  const num = Number(value ?? 0);
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

/** 拼一条可分享的爆款拆解摘要 */
function buildShareText(result: ViralAnalyzeResult): string {
  const a = result.analysis;
  const w = result.work;
  const lines: string[] = [];
  if (w?.title) lines.push(`《${w.title}》`);
  if (w?.author) lines.push(`作者：${w.author}`);
  if (w) {
    lines.push(
      `互动：赞 ${formatNumber(w.likes)} / 评论 ${formatNumber(w.comments)} / 收藏 ${formatNumber(w.collects)} / 播放 ${formatNumber(w.plays)}`,
    );
  }
  if (a?.titleTrick) lines.push(`标题套路：${a.titleTrick}`);
  if (a?.contentStructure) {
    lines.push(
      `内容结构：${Array.isArray(a.contentStructure) ? a.contentStructure.join("；") : a.contentStructure}`,
    );
  }
  if (a?.replicableStrategy) {
    lines.push(
      `可复制策略：${Array.isArray(a.replicableStrategy) ? a.replicableStrategy.join("；") : a.replicableStrategy}`,
    );
  }
  lines.push("", `🔗 ${result.url ?? ""}`, "", "— 来自 JIUZHANG AI 爆款拆解");
  return lines.join("\n");
}

export default function ViralAnalysisV2Page() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ViralAnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState("");

  const analyze = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("请粘贴爆款作品链接（抖音/小红书等）");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("链接格式不对，请以 http:// 或 https:// 开头");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await redfoxApi.viralAnalyze({ url: trimmed });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "拆解失败，请检查链接是否有效");
    } finally {
      setLoading(false);
    }
  }, [url]);

  const toTopic = useCallback(() => {
    if (!result?.work?.title) return;
    router.push(`/content?topic=${encodeURIComponent(result.work.title)}`);
  }, [result, router]);

  /** 评论确认：把 AI 拆解结论落为报告（复用报告体系，可查可分享可追溯） */
  const confirmAsReport = useCallback(async () => {
    if (!result?.analysis || saving) return;
    setSaving(true);
    setSaved(null);
    try {
      const a = result.analysis;
      const title = result.work?.title
        ? `爆款拆解：${result.work.title.slice(0, 30)}${result.work.title.length > 30 ? "…" : ""}`
        : `爆款拆解（${new Date().toLocaleDateString("zh-CN")}）`;
      const lines: string[] = [
        `# ${title}`,
        ``,
        `> 来源：${result.url ?? ""}｜拆解时间 ${new Date().toLocaleString("zh-CN")}`,
        ``,
        `## 作品数据`,
        `- ${result.work?.title ?? "未知作品"}`,
        `- 互动：赞 ${formatNumber(result.work?.likes)} / 评论 ${formatNumber(result.work?.comments)} / 分享 ${formatNumber(result.work?.shares)}`,
        ``,
        `## AI 拆解`,
      ];
      if (a.titleTrick) lines.push(`- **标题套路**：${a.titleTrick}`);
      if (a.coverAdvice) lines.push(`- **封面建议**：${a.coverAdvice}`);
      if (a.contentStructure) {
        lines.push(
          `- **内容结构**：${Array.isArray(a.contentStructure) ? a.contentStructure.join("；") : a.contentStructure}`,
        );
      }
      if (a.hashtagStrategy) lines.push(`- **话题策略**：${a.hashtagStrategy}`);
      if (a.interactionHook) lines.push(`- **互动钩子**：${a.interactionHook}`);
      if (a.replicableStrategy) {
        lines.push(
          `- **可复制策略**：${Array.isArray(a.replicableStrategy) ? a.replicableStrategy.join("；") : a.replicableStrategy}`,
        );
      }
      if (a.riskNote) lines.push(`- **风险提示**：${a.riskNote}`);
      lines.push(``, `---`, `*拆解结论已人工确认，用于复刻创作参考。*`);
      const report = await intelligenceApi.createReport({
        kind: "viral",
        title,
        rangeKey: "custom",
        markdown: lines.join("\n"),
      });
      setSaved(report?.id ?? "ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存报告失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }, [result, saving]);

  /** 一键转发：把作品链接 + AI 拆解摘要发给系统分享面板（手机端可直达微信/抖音） */
  const forward = useCallback(async () => {
    if (!result) return;
    const text = buildShareText(result);
    const r = await shareText(text);
    if (r.ok && r.mode !== "clipboard") {
      setShareMsg(r.message);
    } else if (r.ok && r.mode === "clipboard") {
      await copyText(text);
      setShareMsg("已复制到剪贴板，请粘贴转发");
    } else {
      setShareMsg(r.message);
    }
    window.setTimeout(() => setShareMsg(""), 3200);
  }, [result]);

  const work = result?.work;
  const analysis = result?.analysis;

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
            <h1 className="mx-page-title">爆款拆解</h1>
            <p className="mx-page-sub">为什么这条爆了？AI 拆给你看</p>
          </div>
        </div>
      </header>

      {/* 输入区 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>爆款作品链接</div>
          <input
            type="text"
            placeholder="粘贴抖音/小红书作品链接…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ width: "100%", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, color: "#dbe7f5", padding: "10px 12px", fontSize: 13, boxSizing: "border-box" }}
          />
          <button
            type="button"
            className="mx-btn-gold"
            style={{ marginTop: 12, width: "100%" }}
            disabled={loading}
            onClick={() => void analyze()}
          >
            {loading ? "拆解中…" : "开始拆解"}
          </button>
          {error ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "#fbbf24", lineHeight: 1.6 }}>{error}</div>
          ) : null}
          <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.6, color: "rgba(219,234,254,.55)" }}>
            支持抖音 / 小红书等平台作品链接，AI 解析作品数据 + 拆解标题套路与可复制策略
          </div>
        </div>
      </section>

      {/* 作品数据卡 */}
      {work ? (
        <section className="mx-px" style={{ marginTop: 14 }}>
          <div className="mx-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="mx-badge mx-badge-gold" style={{ fontSize: 10 }}>作品数据</span>
              {work.platform ? (
                <span style={{ fontSize: 11, color: "rgba(219,234,254,.6)" }}>{work.platform}</span>
              ) : null}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.6 }}>{work.title || "（无标题）"}</div>
            {work.author ? (
              <div style={{ fontSize: 12, color: "rgba(219,234,254,.7)", marginTop: 6 }}>作者：{work.author}</div>
            ) : null}
            {work.workType || work.publishTime ? (
              <div style={{ fontSize: 11, color: "rgba(219,234,254,.5)", marginTop: 3 }}>
                {[work.workType, work.publishTime?.slice(0, 10)].filter(Boolean).join(" · ")}
              </div>
            ) : null}
            <div className="mx-stat-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 12 }}>
              <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ fontSize: 15 }}>{formatNumber(work.likes)}</div><div className="mx-stat-label">点赞</div></div>
              <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ fontSize: 15 }}>{formatNumber(work.comments)}</div><div className="mx-stat-label">评论</div></div>
              <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ fontSize: 15 }}>{formatNumber(work.collects)}</div><div className="mx-stat-label">收藏</div></div>
              <div className="mx-stat-item mx-control"><div className="mx-stat-num" style={{ fontSize: 15 }}>{formatNumber(work.plays)}</div><div className="mx-stat-label">播放</div></div>
            </div>
          </div>
        </section>
      ) : null}

      {/* AI 拆解卡 */}
      {analysis ? (
        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span className="mx-badge mx-badge-gold" style={{ fontSize: 10 }}>AI 拆解</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {analysis.titleTrick ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>标题套路</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.titleTrick}</div>
                </div>
              ) : null}
              {analysis.coverAdvice ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>封面建议</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.coverAdvice}</div>
                </div>
              ) : null}
              {analysis.contentStructure ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>内容结构</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>
                    {Array.isArray(analysis.contentStructure)
                      ? analysis.contentStructure.map((item, index) => (
                          <div key={index} style={{ marginTop: 2 }}>· {String(item)}</div>
                        ))
                      : String(analysis.contentStructure)}
                  </div>
                </div>
              ) : null}
              {analysis.hashtagStrategy ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>话题策略</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.hashtagStrategy}</div>
                </div>
              ) : null}
              {analysis.interactionHook ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>互动钩子</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.interactionHook}</div>
                </div>
              ) : null}
              {analysis.replicableStrategy ? (
                <div>
                  <div style={{ fontSize: 11, color: "#f4bb67", fontWeight: 600 }}>可复制策略</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>
                    {Array.isArray(analysis.replicableStrategy)
                      ? analysis.replicableStrategy.map((item, index) => (
                          <div key={index} style={{ marginTop: 2 }}>· {String(item)}</div>
                        ))
                      : String(analysis.replicableStrategy)}
                  </div>
                </div>
              ) : null}
              {analysis.riskNote ? (
                <div style={{ fontSize: 12, color: "rgba(219,234,254,.6)", lineHeight: 1.6, marginTop: 2 }}>
                  ⚠️ {analysis.riskNote}
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ flex: 1 }}
                onClick={() => void forward()}
              >
                一键转发
              </button>
              {work?.title ? (
                <button
                  type="button"
                  className="mx-btn-gold"
                  style={{ flex: 1 }}
                  onClick={toTopic}
                >
                  用这个选题去创作 →
                </button>
              ) : null}
            </div>
            {shareMsg ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "#4ade80", textAlign: "center" }}>
                {shareMsg}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void confirmAsReport()}
              disabled={saving}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px",
                borderRadius: 12,
                border: "1px solid rgba(244,187,103,.35)",
                background: "rgba(244,187,103,.06)",
                fontSize: 13,
                color: "#f4bb67",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "保存中…" : saved ? "✅ 已确认采纳，可在报告中心查看" : "确认采纳为报告"}
            </button>
            {saved ? (
              <button
                type="button"
                onClick={() => router.push("/intelligence/reports")}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "10px",
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,.35)",
                  background: "transparent",
                  fontSize: 13,
                  color: "rgba(219,234,254,.7)",
                }}
              >
                去报告中心查看 →
              </button>
            ) : null}
          </div>
        </section>
      ) : result && !analysis ? (
        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          <div className="mx-card" style={{ padding: 14 }}>
            <div style={{ fontSize: 12, color: "rgba(219,234,254,.62)", lineHeight: 1.7 }}>
              作品数据已获取，但 AI 拆解暂不可用（模型未配置或服务波动），可稍后重试。
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
