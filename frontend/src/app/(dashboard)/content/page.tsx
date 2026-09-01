"use client";

import { Rss } from "lucide-react";
import { SkeletonRow } from "@/components/skeleton";

import React from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { ScenePage } from "@/components/shell/scene-page";
import { ShellIcon } from "@/components/shell/icons";
import { materialsApi } from "@/lib/api/materials";
import { ContentSources } from "@/components/shell/content-sources";
import { articlesApi, type Article } from "@/lib/api/articles";
import { useIsMobile } from "@/lib/hooks/use-media-query";

export default function ContentScene() {
  const router = useRouter();
  const [materialCount, setMaterialCount] = React.useState(0);
  const [recentDrafts, setRecentDrafts] = React.useState<Article[]>([]);
  const [draftTotal, setDraftTotal] = React.useState<number | null>(null);
  const [draftsLoading, setDraftsLoading] = React.useState(true);
  const isMobile = useIsMobile();

  React.useEffect(() => {
    let active = true;
    materialsApi
      .collectStatus()
      .then((status) => {
        if (!active) return;
        const counts = (status as { counts?: Record<string, number> })?.counts;
        setMaterialCount(counts?.total ?? counts?.new ?? 0);
      })
      .catch(() => undefined);

    articlesApi
      .list({ page: 1, limit: 3 })
      .then((result) => {
        if (!active) return;
        const items = Array.isArray(result?.items) ? result.items : [];
        // 记录草稿总数，供「全部草稿」入口展示「共 N 篇」
        setDraftTotal(
          result && typeof result.total === "number" ? result.total : null,
        );
        // 优先展示草稿，其次最近创建的
        const sorted = [...items].sort((a, b) => {
          const ta = a.updatedAt || a.createdAt || "";
          const tb = b.updatedAt || b.createdAt || "";
          return String(tb).localeCompare(String(ta));
        });
        setRecentDrafts(sorted.slice(0, 3));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDraftsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (isMobile) {
    return (
      <MobileContentView
        router={router}
        materialCount={materialCount}
        recentDrafts={recentDrafts}
        draftTotal={draftTotal}
        draftsLoading={draftsLoading}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ScenePage
      title="内容"
      sub="从选题到发布，一条流水线"
      hint={
        materialCount > 0
          ? {
              icon: "database",
              text: `素材库现有 ${materialCount} 条素材，可以直接拿去生成内容`,
              actionLabel: "去生成",
              href: "/content/articles",
            }
          : undefined
      }
      cards={[
        {
          icon: "clipboard",
          tint: "kx-t-violet",
          title: "选题",
          desc: "AI 推荐选题，也可自己定",
          href: "/topics",
          group: "灵感洞察",
        },
        {
          icon: "trending",
          tint: "kx-t-amber",
          title: "爆款拆解",
          desc: "作品链接 → 数据 + AI 拆解套路",
          href: "/viral-analysis",
          group: "灵感洞察",
        },
        {
          icon: "fileText",
          tint: "kx-t-blue",
          title: "内容生成",
          desc: "图文、小红书笔记、视频脚本",
          href: "/content/articles",
          group: "内容创作",
        },
        {
          icon: "layers",
          tint: "kx-t-slate",
          title: "模板与风格",
          desc: "品牌风格、内容模板",
          href: "/templates",
          group: "内容创作",
        },
        {
          icon: "sparkles",
          tint: "kx-t-violet",
          title: "AI 生图",
          desc: "文字描述生成图片，直接入素材库",
          href: "/content/ai-image-gen",
          group: "内容创作",
        },
        {
          icon: "video",
          tint: "kx-t-violet",
          title: "AI 生视频",
          desc: "文字描述生成短视频，直接入素材库",
          href: "/content/ai-video-gen",
          group: "视频与发布",
        },
        {
          icon: "database",
          tint: "kx-t-slate",
          title: "素材库",
          desc: "自动采集的内容素材，可直接用",
          href: "/materials",
          badge: materialCount > 0 ? `${materialCount} 条` : undefined,
          group: "素材管理",
        },
        {
          icon: "download",
          tint: "kx-t-blue",
          title: "去水印",
          desc: "抖音/快手/小红书等 9 平台免水印下载",
          href: "/materials?open=download",
          group: "素材管理",
        },
        {
          icon: "database",
          tint: "kx-t-blue",
          title: "全网采集",
          desc: "关键词搜作品、查详情、看账号列表",
          href: "/content/collection-center",
          group: "素材管理",
        },
        {
          icon: "download",
          tint: "kx-t-slate",
          title: "文章反抓",
          desc: "输入链接，一键提取文章内容",
          href: "/distribution/scrape",
          group: "素材管理",
        },
        {
          icon: "video",
          tint: "kx-t-green",
          title: "视频成片",
          desc: "选题 → 脚本 → 成片，多流水线一键成片",
          href: "/video-studio",
          group: "视频与发布",
        },
        {
          icon: "video",
          tint: "kx-t-violet",
          title: "视频生产",
          desc: "12 条流水线，选题到成片全流程",
          href: "/video-workshop",
          group: "视频与发布",
        },
        {
          icon: "video",
          tint: "kx-t-amber",
          title: "商品视频",
          desc: "带货文案 + 一键成片",
          href: "/video/product-cut",
          group: "视频与发布",
        },
        {
          icon: "megaphone",
          tint: "kx-t-green",
          title: "发布",
          desc: "一键发到各平台，发前自动合规检查",
          href: "/distribution/publish-video",
          group: "视频与发布",
        },
        {
          icon: "history",
          tint: "kx-t-violet",
          title: "视频发布计划",
          desc: "查看定时发布的视频任务",
          href: "/video/release-plans",
          group: "视频与发布",
        },
      ]}
      />
      <div className="kaypal-v3-panel p-5">
        <h2 className="mb-1 text-base font-semibold text-[var(--kaypal-v3-ink)]">内容来源</h2>
        <p className="mb-4 text-sm text-[var(--kaypal-v3-muted)]">
          素材采集从这些地方抓内容，管理后可到素材库「开始采集」
        </p>
        <ContentSources />
      </div>
    </div>
  );
}

/* ================= 移动端视图（<768px，明德 VP 风格） ================= */

interface MobileContentViewProps {
  router: ReturnType<typeof useRouter>;
  materialCount: number;
  recentDrafts: Article[];
  draftTotal: number | null;
  draftsLoading: boolean;
}

/** 内容创作工具（2026-08-11 从「我的」页归位：内容类入口统一放内容 Tab） */
const CONTENT_TOOL_ENTRIES: Array<{
  label: string;
  desc: string;
  icon: React.ComponentProps<typeof ShellIcon>["name"];
  tint: string;
  href: string;
}> = [
  { label: "小红书笔记", desc: "选题自动生成的笔记草稿", icon: "fileText", tint: "#e9405b", href: "/content/xiaohongshu" },
  { label: "AI 生视频", desc: "文字描述生成短视频", icon: "sparkles", tint: "var(--kaypal-v3-purple)", href: "/content/ai-video-gen" },
  { label: "图生视频", desc: "上传图片 + 提示词生成视频", icon: "sparkles", tint: "var(--kaypal-v3-purple)", href: "/video-generation" },
  { label: "商品视频", desc: "带货文案 + 一键成片", icon: "video", tint: "var(--kaypal-v3-amber)", href: "/video/product-cut" },
  { label: "门店管理", desc: "门店 POI 与探访统计", icon: "target", tint: "var(--kaypal-v3-success)", href: "/poi" },
  { label: "发布文章", desc: "图文内容发布", icon: "megaphone", tint: "var(--kaypal-v3-purple)", href: "/distribution/publish-article" },
  { label: "视频生产", desc: "12 条流水线，选题到成片全流程", icon: "video", tint: "var(--kaypal-v3-violet)", href: "/video-workshop" },
  { label: "视频发布计划", desc: "查看定时发布的视频任务", icon: "history", tint: "var(--kaypal-v3-purple)", href: "/video/release-plans" },
  { label: "知识库", desc: "品牌知识与素材沉淀", icon: "database", tint: "var(--kaypal-v3-amber)", href: "/knowledge-base" },
  { label: "视频特效", desc: "换脸与模板化视频效果", icon: "video", tint: "var(--kaypal-v3-purple)", href: "/content/face-swap" },
  { label: "文案对比", desc: "原文与改写对照", icon: "clipboard", tint: "var(--kaypal-v3-muted)", href: "/copy-compare" },
  { label: "产物", desc: "生成结果存档", icon: "archive", tint: "#8d6e63", href: "/tasks/evidence" },
];

function MobileContentView({
  router,
  materialCount,
  recentDrafts,
  draftTotal,
  draftsLoading,
}: MobileContentViewProps) {
  const quickEntries: Array<{
    label: string;
    sub: string;
    icon: React.ComponentProps<typeof ShellIcon>["name"];
    tint: string;
    href: string;
  }> = [
    {
      label: "选题",
      sub: "AI 推荐",
      icon: "bulb",
      tint: "var(--kaypal-v3-accent)",
      href: "/topics",
    },
    {
      label: "AI 创作",
      sub: "生成内容",
      icon: "pen",
      tint: "var(--kaypal-v3-amber)",
      href: "/content/articles",
    },
    {
      label: "素材库",
      sub: "云端素材",
      icon: "archive",
      tint: "var(--kaypal-v3-success)",
      href: "/materials",
    },
    {
      label: "文章反抓",
      sub: "链接提取",
      icon: "download",
      tint: "var(--kaypal-v3-purple)",
      href: "/distribution/scrape",
    },
    {
      label: "模板风格",
      sub: "品牌调性",
      icon: "layers",
      tint: "var(--kaypal-v3-cobalt)",
      href: "/templates",
    },
    {
      label: "视频成片",
      sub: "AI 一键成片",
      icon: "video",
      tint: "var(--kaypal-v3-success)",
      href: "/video-studio",
    },
    {
      label: "全部草稿",
      sub: "",
      icon: "fileText",
      tint: "var(--kaypal-v3-amber)",
      href: "/content/articles",
    },
  ];

  // P2-14：全部草稿入口副标题展示真实草稿总数；拿不到总数时降级为「全部草稿」
  const draftsSub =
    draftTotal != null && draftTotal > 0 ? `共 ${draftTotal} 篇` : "全部草稿";
  const effectiveEntries = quickEntries.map((entry) =>
    entry.label === "全部草稿" ? { ...entry, sub: draftsSub } : entry,
  );

  const draftLabel = (article: Article) => {
    const typeName =
      article.contentType === "xiaohongshu" ? "小红书笔记" : "图文";
    const status =
      article.status === "draft"
        ? "草稿"
        : article.status === "generated"
          ? "已生成"
          : "草稿";
    return `${typeName} · ${status}`;
  };

  return (
    <div>
      {/* 页面头 */}
      <header className="mx-header">
        <div className="mx-header-row">
          <div>
            <div className="mx-brand-eyebrow">
              <BrandLogo />
              JIUZHANG AI
            </div>
            <h1 className="mx-page-title">内容</h1>
            <p className="mx-page-sub">选题 · 创作 · 素材 · 反抓</p>
          </div>
          <button
            type="button"
            className="mx-btn-gold"
            style={{ fontSize: 12, padding: "8px 14px" }}
            onClick={() => router.push("/content/articles")}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="13"
              height="13"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            新建
          </button>
        </div>
      </header>

      {/* 快捷入口 6 宫格 */}
      <section className="mx-px" style={{ marginTop: 14 }}>
        <div className="mx-svc-grid">
          {effectiveEntries.map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="mx-svc-item mx-control"
              onClick={() => router.push(entry.href)}
            >
              <span
                className="mx-svc-ic"
                style={{
                  background: "var(--kaypal-v3-field-bg, rgba(233,240,250,.75))",
                  color: entry.tint,
                }}
              >
                <ShellIcon name={entry.icon} size={19} />
              </span>
              <span className="mx-svc-name">{entry.label}</span>
              <span className="mx-svc-sub">{entry.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 内容创作工具（从「我的」页归位：内容类入口统一放内容 Tab） */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 14 4-4" />
                  <path d="M3.34 19a10 10 0 1 1 17.32 0" />
                </svg>
              </span>
              内容创作工具
            </div>
            <p className="mx-section-eyebrow">图文、视频、知识库与效果工具</p>
          </div>
        </div>
        <div className="mx-card mx-list-card">
          {CONTENT_TOOL_ENTRIES.map((entry) => (
            <button
              key={entry.href}
              type="button"
              className="mx-row"
              style={{ width: "100%", textAlign: "left", background: "none", border: "none" }}
              onClick={() => router.push(entry.href)}
            >
              <span
                className="mx-row-ic"
                style={{ background: `color-mix(in srgb, ${entry.tint} 10%, transparent)`, color: entry.tint }}
              >
                <ShellIcon name={entry.icon} size={18} />
              </span>
              <div className="mx-row-main">
                <div className="mx-row-title">{entry.label}</div>
                <div className="mx-row-desc">{entry.desc}</div>
              </div>
              <div className="mx-row-right">
                <svg className="mx-chev" viewBox="0 0 24 24" fill="none" stroke="#b9c5d4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="m9 18 6-6-6-6" /></svg>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 最近草稿 */}
      <section className="mx-px mx-mt-lg">
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z" />
                  <path d="M14 3v4a2 2 0 0 0 2 2h4" />
                </svg>
              </span>
              最近草稿
            </div>
            <p className="mx-section-eyebrow">自动保存，随时继续</p>
          </div>
          <button
            type="button"
            className="mx-section-action"
            onClick={() => router.push("/content/articles")}
          >
            全部
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <div className="mx-card mx-list-card">
          {draftsLoading ? (
            <div>
              <SkeletonRow width="72%" />
              <SkeletonRow width="60%" />
              <SkeletonRow width="80%" />
            </div>
          ) : recentDrafts.length === 0 ? (
            <div className="mx-empty">
              <div style={{ fontSize: 34, lineHeight: 1, marginBottom: 10 }}>
                📝
              </div>
              <p>还没有草稿，去新建一篇？</p>
              <button
                type="button"
                className="mx-btn-gold"
                style={{ marginTop: 12 }}
                onClick={() => router.push("/content/articles")}
              >
                新建一篇
              </button>
            </div>
          ) : (
            recentDrafts.map((article) => (
              <button
                key={article.id}
                type="button"
                className="mx-row"
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                }}
                onClick={() => router.push(`/content/workspace?article=${article.id}`)}
              >
                <span
                  className="mx-row-ic"
                  style={{ background: "rgba(37,99,235,.1)", color: "var(--kaypal-v3-cobalt)" }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z" />
                    <path d="M14 3v4a2 2 0 0 0 2 2h4" />
                  </svg>
                </span>
                <div className="mx-row-main">
                  <div className="mx-row-title">
                    {article.title || "未命名内容"}
                  </div>
                  <div className="mx-row-desc">{draftLabel(article)}</div>
                </div>
                <div className="mx-row-right">
                  <svg
                    className="mx-chev"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#b9c5d4"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    width="15"
                    height="15"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* 素材概况 */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="3" rx="5" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              </span>
              素材库
            </div>
            <p className="mx-section-eyebrow">云端素材，随取随用</p>
          </div>
          <button
            type="button"
            className="mx-section-action"
            onClick={() => router.push("/materials")}
          >
            素材库
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          className="mx-hero"
          style={{
            width: "100%",
            textAlign: "left",
            padding: 18,
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
          onClick={() => router.push("/materials")}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 46,
              height: 46,
              borderRadius: 15,
              background: "rgba(255,255,255,.12)",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--kaypal-v3-amber)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="22"
              height="22"
            >
              <rect width="18" height="18" x="3" y="3" rx="5" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              className="mx-gold-text"
              style={{ display: "block", fontSize: 20, fontWeight: 800 }}
            >
              {materialCount}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11,
                color: "rgba(219,234,254,.72)",
                marginTop: 2,
              }}
            >
              素材已入库 · 可直接用于生成
            </span>
          </span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--kaypal-v3-amber)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="16"
            height="16"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </section>

      {/* 内容来源（2026-09-01 从设置迁移：素材采集上下文） */}
      <section className="mx-px mx-mt-lg" style={{ paddingBottom: 28 }}>
        <div className="mx-section-head">
          <div>
            <div className="mx-section-title">
              <span className="mx-sec-icon"><Rss /></span>
              内容来源
            </div>
            <p className="mx-section-eyebrow">素材采集从这些地方抓内容</p>
          </div>
        </div>
        <div className="mx-card" style={{ padding: 16 }}>
          <ContentSources />
        </div>
      </section>
    </div>
  );
}
