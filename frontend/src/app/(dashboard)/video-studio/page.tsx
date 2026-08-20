"use client";

import Link from "next/link";
import { V2BackButton } from "@/components/v2/v2-back-button";
import { GrayTestOverlay } from "@/components/v2/gray-test-overlay";

/**
 * 视频成片 —— 独立盈利商用产品（studio_core）
 *
 * 不再内嵌「探测引擎 + 调用 studio_core API 生成成片」的引擎逻辑。
 * 本页只作为独立产品的介绍/入口：产品开发完成后，配置
 * NEXT_PUBLIC_STUDIO_CORE_SITE_URL 即可显示「前往使用」链接。
 * 2026-08-20 亮色 VP 化：kx-mobile-ambient/mx-* 深色 → kx-view 亮色体系。
 */

const PIPELINES: Array<{ label: string; desc: string }> = [
  { label: "动画讲解", desc: "科普 / 产品原理类讲解" },
  { label: "企业宣传片", desc: "商务正式，真实渲染" },
  { label: "纪录片", desc: "叙事纪实风格" },
  { label: "访谈", desc: "问答对话形式" },
  { label: "盘点榜单", desc: "Top N 榜单视频" },
  { label: "新闻简报", desc: "资讯快剪" },
  { label: "产品演示", desc: "功能演示讲解" },
  { label: "宣传片", desc: "品牌 / 活动宣传" },
  { label: "带货种草", desc: "商品卖点种草" },
];

export default function VideoStudioPage() {
  const siteUrl = process.env.NEXT_PUBLIC_STUDIO_CORE_SITE_URL?.trim();

  return (
    <GrayTestOverlay feature="视频工作室">
      <div className="kx-view">
        <V2BackButton to="/content" />
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="kx-greet">视频成片</h1>
            <p className="kx-greet-sub">AI 一键成片 · 独立产品</p>
          </div>
        </header>

        {/* 产品状态卡片 */}
        <div className="kaypal-v3-panel" style={{ padding: 20 }}>
          <p style={{ fontSize: 15, fontWeight: 700, margin: "0 0 6", color: "var(--kaypal-v3-ink)" }}>
            视频成片
          </p>
          <p style={{ fontSize: 13, color: "var(--kaypal-v3-soft-ink)", margin: "0 0 14", lineHeight: 1.6 }}>
            这是一款独立的 AI 视频生产产品：输入一个选题，自动完成脚本撰写 →
            分镜设计 → 画面合成 → 渲染成片，覆盖多条专业流水线。
          </p>

          {siteUrl ? (
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="kx-btn-primary"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                textDecoration: "none",
                fontSize: 14,
                padding: "12px",
                border: "none",
              }}
            >
              前往使用
              <span aria-hidden>›</span>
            </a>
          ) : (
            <div
              style={{
                borderRadius: 12,
                padding: "12px 14px",
                background: "var(--kaypal-v3-amber-soft)",
                border: "1px solid var(--kaypal-v3-amber)",
              }}
            >
              <p style={{ fontSize: 13, margin: 0, color: "var(--kaypal-v3-amber)", fontWeight: 600 }}>
                产品正在开发中，敬请期待
              </p>
              <p style={{ fontSize: 12, margin: "4px 0 0", color: "var(--kaypal-v3-amber)", lineHeight: 1.5, opacity: 0.8 }}>
                上线后将在此提供访问入口。
              </p>
            </div>
          )}
        </div>

        {/* 替代方案：AI 生视频（已可用） */}
        <Link
          href="/content/ai-video-gen"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 14,
            padding: "12px 14px",
            marginTop: 12,
            background: "var(--kaypal-v3-accent-soft)",
            border: "1px solid var(--kaypal-v3-accent-border)",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--kaypal-v3-accent-ink)" }}>
            🎬 需要短视频？先用「AI 生视频」——文字直接生成 3-15 秒短视频
          </span>
          <span style={{ fontSize: 14, color: "var(--kaypal-v3-accent-ink)" }}>›</span>
        </Link>

        {/* 能力预览 */}
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--kaypal-v3-ink)", margin: "0 0 10" }}>
            产品能力预览
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
            }}
          >
            {PIPELINES.map((p) => (
              <div key={p.label} className="kaypal-v3-panel" style={{ padding: "12px 14px" }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: "var(--kaypal-v3-ink)" }}>
                  {p.label}
                </p>
                <p style={{ fontSize: 11, margin: "4px 0 0", color: "var(--kaypal-v3-muted)" }}>
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </GrayTestOverlay>
  );
}
