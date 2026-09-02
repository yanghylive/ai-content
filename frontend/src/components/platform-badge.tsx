"use client";

import React from "react";

/**
 * 平台标识统一源：真实 logo + 品牌色 + 中英文匹配。
 * logo 为本地白色版 SVG（frontend/public/platform-logos/*），
 * 品牌色圆底/浅底上展示，离线可用。与 distribution 登录弹窗共用一套。
 */
export const PLATFORM_META = [
  {
    key: "douyin",
    label: "抖音",
    brand: "#fe2c55",
    logo: "/platform-logos/douyin.svg",
  },
  {
    key: "xiaohongshu",
    label: "小红书",
    brand: "#ff2442",
    logo: "/platform-logos/xiaohongshu.svg",
  },
  {
    key: "shipinhao",
    label: "视频号",
    brand: "#007fff",
    logo: "/platform-logos/shipinhao.svg",
  },
  {
    key: "wechat",
    label: "微信",
    brand: "#07c160",
    logo: "/platform-logos/wechat.svg",
  },
  {
    key: "kuaishou",
    label: "快手",
    brand: "#ff4d2e",
    logo: "/platform-logos/kuaishou.svg",
  },
  {
    key: "bilibili",
    label: "B站",
    brand: "#00a1d6",
    logo: "/platform-logos/bilibili.svg",
  },
] as const;

export type PlatformMeta = (typeof PLATFORM_META)[number];

const NORMALIZE: Array<{ re: RegExp; key: PlatformMeta["key"] }> = [
  { re: /douyin|抖音|tiktok/i, key: "douyin" },
  { re: /xiaohongshu|xhs|小红书|rednote/i, key: "xiaohongshu" },
  { re: /shipinhao|channels|视频号|wechat-channel|微信视频号/i, key: "shipinhao" },
  { re: /kuaishou|快手/i, key: "kuaishou" },
  { re: /bilibili|b站|哔哩/i, key: "bilibili" },
  { re: /weixin|wechat|微信(?!视频号)/i, key: "wechat" },
];

export function resolvePlatformMeta(
  platform?: string | null,
): PlatformMeta | null {
  const raw = String(platform || "").trim().toLowerCase();
  if (!raw) return null;
  for (const rule of NORMALIZE) {
    if (rule.re.test(raw)) {
      return (
        (PLATFORM_META.find((meta) => meta.key === rule.key) as PlatformMeta) ||
        null
      );
    }
  }
  return null;
}

export function platformBrandColor(
  platform?: string | null,
  fallback = "var(--kaypal-v3-muted)",
): string {
  return resolvePlatformMeta(platform)?.brand ?? fallback;
}

export function platformLabel(platform?: string | null): string {
  const raw = platform?.trim();
  return resolvePlatformMeta(platform)?.label ?? (raw || "未指定");
}

type PlatformBadgeProps = {
  platform?: string | null;
  /** 徽章展示尺寸（决定圆标与 logo 像素） */
  size?: number;
  /** true=实心品牌色底白 logo；false=品牌色浅底(60%)白 logo */
  solid?: boolean;
  /** true=中性灰底（弱化展示） */
  muted?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * 平台 logo 圆形徽章：真实 logo（白图形）+ 品牌色底。
 * 匹配不到平台时用中性灰 + 首字符回退，保证永不破图。
 */
export function PlatformBadge({
  platform,
  size = 24,
  solid = false,
  muted = false,
  title,
  className = "",
  style,
}: PlatformBadgeProps) {
  const meta = resolvePlatformMeta(platform);
  const dim = size;
  const fallbackChar = String(platform || "?").trim().charAt(0).toUpperCase();
  if (!meta) {
    return (
      <span
        className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[var(--kaypal-v3-border)] text-[var(--kaypal-v3-muted)] ${className}`}
        style={{ width: dim, height: dim, fontSize: Math.max(10, Math.round(dim * 0.44)), borderRadius: 9999, ...style }}
        title={title || platform || undefined}
        aria-hidden={title ? undefined : true}
      >
        {fallbackChar}
      </span>
    );
  }
  const bg = muted
    ? "var(--kaypal-v3-border)"
    : solid
      ? meta.brand
      : `${meta.brand}99`;
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ width: dim, height: dim, background: bg, borderRadius: 9999, ...style }}
      title={title || meta.label}
      aria-hidden={title ? undefined : true}
    >
      <img
        alt={title ? "" : meta.label}
        src={meta.logo}
        draggable={false}
        className="object-contain"
        style={{ width: Math.round(dim * 0.66), height: Math.round(dim * 0.66) }}
      />
    </span>
  );
}

/** 带文字的徽章组合（圆 logo + 平台名） */
export function PlatformBadgeWithLabel({
  platform,
  size = 20,
  textClassName = "",
  muted,
}: {
  platform?: string | null;
  size?: number;
  textClassName?: string;
  muted?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <PlatformBadge platform={platform} size={size} muted={muted} />
      <span className={textClassName}>{platformLabel(platform)}</span>
    </span>
  );
}
