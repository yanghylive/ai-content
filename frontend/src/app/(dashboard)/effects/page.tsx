"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getEffects, type EffectReport } from "@/lib/api/reporting";
import { shareText, copyText } from "@/lib/mobile-bridge";

/** S3 效果报告（2026-08-09 商用能力补齐 R3）：AI 生成/发布/曝光/互动看板 + 周报分享 */

export default function EffectsPage() {
  const [report, setReport] = useState<EffectReport | null>(null);
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async (r: "7d" | "30d") => {
    setLoading(true);
    try {
      const data = await getEffects(r);
      setReport(data);
    } catch {
      setMsg("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(range);
  }, [range, refresh]);

  const handleShare = useCallback(async () => {
    if (!report) return;
    const payload = report.weeklySummary.sharePayload;
    try {
      await shareText(payload);
      setMsg("已唤起系统分享");
    } catch {
      // 降级：复制
      try {
        await copyText(report.weeklySummary.text);
        setMsg("已复制到剪贴板");
      } catch {
        setMsg("当前环境不支持分享");
      }
    }
    window.setTimeout(() => setMsg(""), 3000);
  }, [report]);

  const metrics: Array<{
    label: string;
    value: string;
    sub: string;
    accent: boolean;
  }> = report
    ? [
        {
          label: "AI 生成",
          value: String(report.aiGenerated.count),
          sub: "AI 帮你创作的内容",
          accent: true,
        },
        {
          label: "已发布",
          value: String(report.published.count),
          sub: "成功发布的内容",
          accent: false,
        },
        {
          label: "曝光",
          value: report.exposure.available ? String(report.exposure.count) : "—",
          sub: report.exposure.available ? "各平台曝光量" : "暂不可用",
          accent: false,
        },
        {
          label: "互动",
          value: report.interactions.available ? String(report.interactions.count) : "—",
          sub: report.interactions.available ? "赞评藏合计" : "暂不可用",
          accent: false,
        },
      ]
    : [];

  return (
    <div>
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">AI 效果报告</h1>
            <p className="mx-page-sub">看看 AI 帮你干了多少活</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
        {/* 范围切换 + 周报分享 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            {(["7d", "30d"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 12,
                  border: range === r ? "1px solid #f6c478" : "1px solid rgba(142,165,190,.3)",
                  background: range === r ? "rgba(246,196,120,.12)" : "transparent",
                  color: range === r ? "#f6c478" : "rgba(215,230,248,.7)",
                  cursor: "pointer",
                }}
              >
                {r === "7d" ? "近 7 天" : "近 30 天"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void handleShare()}
            disabled={!report}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 12,
              background: "rgba(246,196,120,.15)",
              border: "1px solid rgba(246,196,120,.4)",
              color: "#f6c478",
              cursor: report ? "pointer" : "not-allowed",
              opacity: report ? 1 : 0.5,
            }}
          >
            📤 分享周报
          </button>
        </div>

        {msg ? (
          <div style={{ marginBottom: 10, fontSize: 12, color: "#4ade80", textAlign: "center" }}>{msg}</div>
        ) : null}

        {loading ? (
          <div className="mx-card" style={{ padding: 24, textAlign: "center", fontSize: 13, color: "rgba(148,163,184,.7)" }}>
            加载中…
          </div>
        ) : report ? (
          <>
            {/* 指标卡 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {metrics.map((m) => (
                <div
                  key={m.label}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: m.accent ? "rgba(246,196,120,.1)" : "rgba(255,255,255,.04)",
                    border: m.accent ? "1px solid rgba(246,196,120,.3)" : "1px solid rgba(142,165,190,.2)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "rgba(215,230,248,.6)", marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 800, color: m.accent ? "#f6c478" : "#e8f1fc" }}>{m.value}</div>
                  <div style={{ fontSize: 11, color: "rgba(148,163,184,.6)", marginTop: 4 }}>{m.sub}</div>
                </div>
              ))}
            </div>

            {/* 周报摘要 */}
            <div
              style={{
                marginTop: 14,
                padding: 16,
                borderRadius: 14,
                background: "rgba(255,255,255,.05)",
                border: "1px solid rgba(142,165,190,.2)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📅 本周摘要</div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "#dbe7f5" }}>{report.weeklySummary.text}</div>
            </div>

            {/* 说明 */}
            <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.7, color: "rgba(148,163,184,.55)" }}>
              💡 曝光/互动数据来自发布平台回读，若平台暂未回传会显示「暂不可用」——AI 生成与发布数据始终准确。
              <br />
              「AI 生成」= 语音助手/创作工具帮你产出的内容条数。
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
