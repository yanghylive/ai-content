"use client";

import { BrandLogo } from "@/components/brand-logo";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  redfoxApi,
  type ViralAnalyzeResult,
} from "@/lib/api/redfox";
import { intelligenceApi } from "@/lib/api/intelligence";
import { shareText, copyText } from "@/lib/mobile-bridge";
import { V2BackButton } from "@/components/v2/v2-back-button";

function detectPlatform(url: string): "douyin" | "xhs" | "youtube" | "auto" {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return "xhs";
  if (/douyin\.com|iesdouyin\.com/i.test(url)) return "douyin";
  return "auto";
}

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
  const [transcript, setTranscript] = useState<string>("");
  const [transcriptBusy, setTranscriptBusy] = useState(false);

  /** 视频提文案（抖音/小红书/YouTube → 文字稿） */
  const extractTranscript = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || transcriptBusy) return;
    const platform = detectPlatform(trimmed);
    if (platform === "auto") {
      setShareMsg("暂无法识别平台，请粘贴抖音/小红书/YouTube 视频链接");
      window.setTimeout(() => setShareMsg(""), 3200);
      return;
    }
    setTranscriptBusy(true);
    setShareMsg("");
    try {
      const r = await redfoxApi.platformTranscript({ platform, url: trimmed });
      if (r.sync && r.data) {
        const text =
          (r.data as Record<string, unknown>)?.transcript ??
          (r.data as Record<string, unknown>)?.text ??
          (r.data as Record<string, unknown>)?.content ??
          "";
        setTranscript(String(text).trim() || "未提取到文案");
      } else if (r.submitted && r.taskId) {
        setTranscript("文案提取任务已提交，请稍后刷新查看（任务 ID: " + r.taskId.slice(0, 12) + "…）");
      } else if (r.result && r.data) {
        const text =
          (r.data as Record<string, unknown>)?.transcript ??
          (r.data as Record<string, unknown>)?.text ??
          (r.data as Record<string, unknown>)?.content ??
          "";
        setTranscript(String(text).trim() || "任务处理中，请稍后重试");
      } else {
        setTranscript("提取任务已提交，请稍后重试");
      }
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : "文案提取失败");
      window.setTimeout(() => setShareMsg(""), 3200);
    } finally {
      setTranscriptBusy(false);
    }
  }, [url, transcriptBusy]);

  const analyze = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("请粘贴爆款作品链接（抖音/小红书等）");
      return;
    }
    // 抖音 APP 分享口令里嵌了短链接（如「8.43 Fho:/ … https://v.douyin.com/xxx/ …」），
    // 从整段文本里提取第一个 http(s) URL，而不是要求整段以 http 开头
    const urlMatch = trimmed.match(/https?:\/\/[^\s，,。；;]+/i);
    const targetUrl = urlMatch ? urlMatch[0] : "";
    if (!targetUrl) {
      setError("没识别到链接，请粘贴包含网址的抖音分享文本或网页地址");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await redfoxApi.viralAnalyze({ url: targetUrl });
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
      <V2BackButton />
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
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
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "var(--kaypal-v3-ink)" }}>爆款作品链接</div>
          <input
            type="text"
            placeholder="粘贴作品链接或抖音/小红书分享口令，如：https://www.douyin.com/video/xxx"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="v3-link-input"
          />
          {/* 格式提示（同视频去水印页：纯净链接 或 整段分享口令） */}
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--kaypal-v3-paper-soft)",
              border: "1px solid var(--kaypal-v3-border)",
              fontSize: 12,
              color: "var(--kaypal-v3-muted)",
              lineHeight: 1.7,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--kaypal-v3-soft-ink)", marginBottom: 4 }}>
              📋 支持两种粘贴格式
            </div>
            <div>① 纯净作品链接，例如：</div>
            <div className="v3-format-example">https://www.douyin.com/video/7649615187284833210</div>
            <div style={{ marginTop: 6 }}>② 抖音 / 小红书分享口令（整段复制粘贴即可，自动提取链接）：</div>
            <div className="v3-format-example">
              4.38 Oxs:/ 复制打开抖音，看看这条作品～ https://v.douyin.com/pjE9uqFMK68/ 复制此链接，打开Dou音搜索，直接观看视频！
            </div>
          </div>
          <button
            type="button"
            className="v3-primary-btn"
            style={{ marginTop: 12, width: "100%" }}
            disabled={loading}
            onClick={() => void analyze()}
          >
            {loading ? "拆解中…" : "开始拆解"}
          </button>
          <button
            type="button"
            onClick={() => void extractTranscript()}
            disabled={transcriptBusy || !url.trim()}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "10px",
              borderRadius: 10,
              border: "1px solid var(--kaypal-v3-border)",
              background: "var(--kaypal-v3-paper-soft)",
              fontSize: 13,
              color: "var(--kaypal-v3-soft-ink)",
              opacity: transcriptBusy || !url.trim() ? 0.6 : 1,
              cursor: "pointer",
            }}
          >
            {transcriptBusy ? "提取中…" : "📝 视频提文案"}
          </button>
          {transcript ? (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 10,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(148,163,184,.25)",
                fontSize: 12.5,
                lineHeight: 1.7,
                color: "#dbe7f5",
                maxHeight: 200,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {transcript}
            </div>
          ) : null}
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
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>标题套路</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.titleTrick}</div>
                </div>
              ) : null}
              {analysis.coverAdvice ? (
                <div>
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>封面建议</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.coverAdvice}</div>
                </div>
              ) : null}
              {analysis.contentStructure ? (
                <div>
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>内容结构</div>
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
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>话题策略</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.hashtagStrategy}</div>
                </div>
              ) : null}
              {analysis.interactionHook ? (
                <div>
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>互动钩子</div>
                  <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 3 }}>{analysis.interactionHook}</div>
                </div>
              ) : null}
              {analysis.replicableStrategy ? (
                <div>
                  <div style={{ fontSize: 11, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>可复制策略</div>
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
                className="v3-primary-btn"
                style={{ flex: 1 }}
                onClick={() => void forward()}
              >
                一键转发
              </button>
              {work?.title ? (
                <button
                  type="button"
                  className="v3-primary-btn"
                  style={{ flex: 1 }}
                  onClick={toTopic}
                >
                  用这个选题去创作 →
                </button>
              ) : null}
            </div>
            {shareMsg ? (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--kaypal-v3-success)", textAlign: "center" }}>
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
                color: "var(--kaypal-v3-amber)",
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
