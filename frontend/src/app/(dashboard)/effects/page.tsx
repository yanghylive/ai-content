"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getEffects, getFunnel, type EffectReport, type FunnelReport } from "@/lib/api/reporting";
import { shareText, copyText } from "@/lib/mobile-bridge";
import { V2BackButton } from "@/components/v2/v2-back-button";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  "wechat-channel": "视频号",
  wechat: "公众号",
  bilibili: "B站",
};

/** 归因漏斗六阶段（T4.6）：点击跳转对应队列 */
const FUNNEL_STAGES: Array<{
  key: "content" | "publish" | "interaction" | "lead" | "customer" | "opportunity";
  label: string;
  definition: string;
  href: string;
}> = [
  { key: "content", label: "内容", definition: "AI 生成/导入的内容数", href: "/content" },
  { key: "publish", label: "发布", definition: "成功发布的内容数", href: "/distribution" },
  { key: "interaction", label: "互动", definition: "评论/私信/提及事件数", href: "/engagement" },
  { key: "lead", label: "线索", definition: "从互动转化的线索数", href: "/growth/leads" },
  { key: "customer", label: "客户", definition: "转成 CRM 客户数", href: "/crm" },
  { key: "opportunity", label: "商机", definition: "进入商机管道数", href: "/crm-closer" },
];

/** S3 效果报告（2026-08-09 商用能力补齐 R3）：AI 生成/发布/曝光/互动看板 + 周报分享 */

export default function EffectsPage() {
  const router = useRouter();
  const [report, setReport] = useState<EffectReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async (r: "7d" | "30d") => {
    setLoading(true);
    try {
      const [data, funnelData] = await Promise.allSettled([
        getEffects(r),
        getFunnel(r === "30d" ? 30 : 7),
      ]);
      if (data.status === "fulfilled") setReport(data.value);
      if (funnelData.status === "fulfilled") setFunnel(funnelData.value);
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
      <V2BackButton />
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
            <h1 className="mx-page-title">复盘</h1>
            <p className="mx-page-sub">内容 → 发布 → 互动 → 线索 → 客户，看到效果并回写下一步</p>
          </div>
          <Link
            href="/intelligence/reports"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px", textDecoration: "none", flexShrink: 0 }}
          >
            报告中心
          </Link>
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
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📅 本周复盘</div>
              <div style={{ fontSize: 13, lineHeight: 1.8, color: "#dbe7f5" }}>{report.weeklySummary.text}</div>
            </div>

            {/* Top 内容（报告 8.1：复盘回写，可重发/生成变体） */}
            {report.topContent && report.topContent.length > 0 ? (
              <div
                style={{
                  marginTop: 14,
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(142,165,190,.2)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                  🔥 表现最好的内容
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {report.topContent.map((top) => (
                    <div
                      key={top.publishRecordId}
                      style={{
                        padding: 12,
                        borderRadius: 10,
                        background: "rgba(246,196,120,.08)",
                        border: "1px solid rgba(246,196,120,.25)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#e8f1fc", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {top.title}
                        </span>
                        <span style={{ fontSize: 11, color: "rgba(215,230,248,.6)", flexShrink: 0 }}>
                          {PLATFORM_LABEL[top.platform] || top.platform}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(148,163,184,.75)", marginTop: 4 }}>
                        {top.interactions != null ? `互动 ${top.interactions}` : ""}
                        {top.exposure != null ? ` · 曝光 ${top.exposure}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => router.push(`/distribution/publish-article?articleId=${top.articleId}`)}
                          style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, background: "rgba(246,196,120,.15)", border: "1px solid rgba(246,196,120,.4)", color: "#f6c478", cursor: "pointer" }}
                        >
                          重发
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/content?articleId=${top.articleId}`)}
                          style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, background: "transparent", border: "1px solid rgba(142,165,190,.3)", color: "rgba(215,230,248,.8)", cursor: "pointer" }}
                        >
                          生成变体
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 归因漏斗（T4.6：每阶段可点击跳转对应队列） */}
            {funnel && (
              <div
                style={{
                  marginTop: 14,
                  padding: 16,
                  borderRadius: 14,
                  background: "rgba(255,255,255,.05)",
                  border: "1px solid rgba(142,165,190,.2)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                  🎯 归因漏斗（近 {range === "30d" ? "30 天" : "7 天"}）
                </div>
                <div style={{ fontSize: 11, color: "rgba(148,163,184,.6)", marginBottom: 12 }}>
                  每个数字=定义/分母/时间窗，点击阶段打开对应队列
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {FUNNEL_STAGES.map((stage) => {
                    const value = funnel.funnel[stage.key];
                    const meta = funnel.meta?.stages.find((s) => s.stage === stage.key);
                    return (
                      <button
                        key={stage.key}
                        type="button"
                        onClick={() => router.push(stage.href)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,.03)",
                          border: "1px solid rgba(142,165,190,.18)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          color: "inherit",
                          width: "100%",
                        }}
                      >
                        <span style={{ width: 64, flexShrink: 0, fontSize: 12, fontWeight: 600, color: "#f6c478" }}>
                          {stage.label}
                        </span>
                        <span style={{ width: 44, flexShrink: 0, textAlign: "right", fontSize: 16, fontWeight: 800, color: "#e8f1fc" }}>
                          {value}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 999,
                            background: "rgba(142,165,190,.12)",
                            overflow: "hidden",
                          }}
                        >
                          <span
                            style={{
                              display: "block",
                              height: "100%",
                              borderRadius: 999,
                              width: `${Math.max(3, Math.round((value / Math.max(funnel.funnel.content, 1)) * 100))}%`,
                              background: "rgba(246,196,120,.55)",
                            }}
                          />
                        </span>
                        <span style={{ width: 150, flexShrink: 0, fontSize: 10, color: "rgba(148,163,184,.65)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {meta?.definition ?? stage.definition}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {funnel.meta?.lastSyncedAt && (
                  <div style={{ marginTop: 10, fontSize: 10, color: "rgba(148,163,184,.5)" }}>
                    最后同步 {new Date(funnel.meta.lastSyncedAt).toLocaleString("zh-CN")}
                    {funnel.meta.stages.some((s) => s.naReason) ? " · 部分阶段无数据（未开启对应采集）" : ""}
                  </div>
                )}
              </div>
            )}

            {/* 说明 */}
            <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.7, color: "rgba(148,163,184,.55)" }}>
              💡 曝光/互动数据来自发布平台反馈，若平台暂未回传会显示「暂不可用」——AI 生成与发布数据始终准确。
              <br />
              「AI 生成」= 语音助手/创作工具帮你产出的内容条数。
            </div>
          </>
        ) : (
          <div
            style={{
              padding: "40px 20px",
              textAlign: "center",
              borderRadius: 16,
              border: "1px dashed rgba(142,165,190,.25)",
              background: "rgba(255,255,255,.02)",
            }}
          >
            <div style={{ fontSize: 30, marginBottom: 10 }}>📊</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#dbe7f5" }}>还没有复盘数据</div>
            <p style={{ fontSize: 12, color: "rgba(148,163,184,.65)", margin: "6px 0 16px", lineHeight: 1.6 }}>
              发布内容并产生互动后，这里会展示内容/发布/互动/线索的完整归因漏斗和周报。
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ fontSize: 12, padding: "9px 16px", textDecoration: "none" }}
                onClick={() => router.push("/content")}
              >
                去创作内容
              </button>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ fontSize: 12, padding: "9px 16px", textDecoration: "none", background: "rgba(255,255,255,.1)", backgroundImage: "none", border: "1px solid rgba(142,165,190,.3)" }}
                onClick={() => router.push("/growth/leads")}
              >
                查看线索池
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
