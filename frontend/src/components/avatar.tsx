"use client";

import React from "react";

/**
 * 统一头像组件：三态渲染 + 加载失败兜底。
 *
 * - src 为空 → 首字母占位
 * - src 加载成功 → 图片
 * - src 加载失败(onError) → 首字母占位（failed 置真，不再重试该 src）
 *
 * 首字母占位颜色由 name 哈希取固定色板（同一个人颜色稳定），跨深浅主题可读。
 */

const AVATAR_PALETTE = [
  "#5b8def",
  "#7c5ce0",
  "#2f9e8f",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#7c3aed",
  "#059669",
  "#c2410c",
  "#4f46e5",
];

function paletteColor(name?: string): string {
  const seed = name || "";
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export interface AvatarProps {
  /** 头像 URL，可为空/null */
  src?: string | null;
  /** 用于生成首字母占位与稳定背景色 */
  name?: string;
  /** 直径（px），默认 36 */
  size?: number;
  /** 无障碍替代文本，默认取 name，禁止空字符串 */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** 圆角：默认 50% 圆形；传数字则为圆角方块半径 */
  radius?: number | "full";
  /** 自定义背景色（覆盖 name 哈希色板），如账号平台色 */
  color?: string;
  /** 无 src 或加载失败时的自定义兜底内容（图标等），默认首字母 */
  fallback?: React.ReactNode;
}

export function Avatar({
  src,
  name,
  size = 36,
  alt,
  className,
  style,
  radius = "full",
  color,
  fallback,
}: AvatarProps) {
  const [failed, setFailed] = React.useState(false);

  // src 变化时重置失败态（新头像可重新加载）
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const accessibleAlt = alt || name || "头像";
  const initial = (name || alt || "?").trim().charCodeAt(0)
    ? (name || alt || "?").trim().slice(0, 1).toUpperCase()
    : "?";
  const bg = color || paletteColor(name);
  const borderRadius =
    radius === "full" ? "50%" : `${radius}px`;

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius,
    objectFit: "cover",
    flexShrink: 0,
    ...style,
  };

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 动态头像 src + onError 兜底，无法用 next/image 静态优化
      <img
        src={src}
        alt={accessibleAlt}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={className}
        style={baseStyle}
      />
    );
  }

  // 自定义兜底（图标等）：无背景，内容为 fallback，外层容器背景透出
  if (fallback) {
    return (
      <span
        role="img"
        aria-label={accessibleAlt}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          overflow: "hidden",
          ...style,
        }}
      >
        {fallback}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={accessibleAlt}
      className={className}
      style={{
        ...baseStyle,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: "#ffffff",
        fontSize: Math.max(11, Math.round(size * 0.4)),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      {initial}
    </span>
  );
}
