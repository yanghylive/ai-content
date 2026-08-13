"use client";

import Link from "next/link";

/**
 * 视频成片 —— 独立盈利商用产品（studio_core）
 *
 * 不再内嵌「探测引擎 + 调用 studio_core API 生成成片」的引擎逻辑。
 * 本页只作为独立产品的介绍/入口：产品开发完成后，配置
 * NEXT_PUBLIC_STUDIO_CORE_SITE_URL 即可显示「前往使用」链接。
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
    <div
      className="kx-mobile-ambient"
      style={{ minHeight: "100dvh", paddingBottom: 90 }}
    >
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M10 9l5 3-5 3V9z" />
              </svg>
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">视频成片</h1>
            <p className="mx-page-sub">AI 一键成片 · 独立产品</p>
          </div>
        </div>
      </header>

      <section className="mx-px" style={{ marginTop: 14 }}>
        {/* 产品状态卡片 */}
        <div
          style={{
            borderRadius: 20,
            padding: 20,
            background: "rgba(255,255,255,.72)",
            border: "1px solid rgba(148,163,184,.18)",
          }}
        >
          <p
            style={{
              fontSize: 15,
              fontWeight: 700,
              margin: "0 0 6",
              color: "#1f2a44",
            }}
          >
            视频成片
          </p>
          <p style={{ fontSize: 13, color: "#6b7a93", margin: "0 0 14", lineHeight: 1.6 }}>
            这是一款独立的 AI 视频生产产品：输入一个选题，自动完成脚本撰写 →
            分镜设计 → 画面合成 → 渲染成片，覆盖多条专业流水线。
          </p>

          {siteUrl ? (
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mx-btn-gold"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                textDecoration: "none",
                fontSize: 14,
                padding: "12px",
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
                background: "rgba(245,158,11,.08)",
                border: "1px solid rgba(245,158,11,.22)",
              }}
            >
              <p style={{ fontSize: 13, margin: 0, color: "#b45309", fontWeight: 600 }}>
                产品正在开发中，敬请期待
              </p>
              <p style={{ fontSize: 12, margin: "4px 0 0", color: "#92400e", lineHeight: 1.5 }}>
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
            background: "rgba(124,58,237,.07)",
            border: "1px solid rgba(124,58,237,.22)",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: "#7c3aed" }}>
            🎬 需要短视频？先用「AI 生视频」——文字直接生成 3-15 秒短视频
          </span>
          <span style={{ fontSize: 14, color: "#7c3aed" }}>›</span>
        </Link>

        {/* 能力预览 */}
        <div style={{ marginTop: 18 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#1f2a44",
              margin: "0 0 10",
            }}
          >
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
              <div
                key={p.label}
                style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  background: "rgba(255,255,255,.6)",
                  border: "1px solid rgba(148,163,184,.15)",
                }}
              >
                <p
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    margin: 0,
                    color: "#374151",
                  }}
                >
                  {p.label}
                </p>
                <p style={{ fontSize: 11, margin: "4px 0 0", color: "#94a3b8" }}>
                  {p.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
