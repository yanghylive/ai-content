"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";

/**
 * Rail 品牌图标（2026-09 v5 · 方案 A · 金渐变点亮 / 增强细节 / 去背景块）
 *
 * 结论（经预览对照选定）：
 * - 图形为"增加细节层次"增强版：趋势连线、领口 V、双层文字行、已读勾、
 *   进度条、屏幕内容行、伴星中心点等第二层细节；
 * - 无任何背景色块（激活/未激活都不画容器）；
 * - 激活态：主体填品牌金渐变 #f0b45c → #c9811f（与桌面「磨砂紫金」
 *   rail 金语言同族），内部细节反白；
 * - 未激活态：主体 currentColor 灰，细节半透明灰叠层次；
 * - 选中状态由左侧金色指示条 + 金色文字承担，图标点亮为金。
 */

export type RailIconName =
  | "growth"
  | "customer"
  | "content"
  | "interaction"
  | "execution"
  | "device"
  | "assistant"
  | "mine";

type Soft = { el: ReactElement; o: number };

type Glyph = {
  /** 主体图形：激活 = 金渐变 / 未激活 = currentColor */
  main: ReactElement[];
  /** 内部细节：激活反白 / 未激活半透明灰 */
  cut: ReactElement[];
  /** 次要元素：叠加在主体后，带固定透明度 */
  soft?: Soft[];
};

const GLYPHS: Record<RailIconName, Glyph> = {
  /* 今日增长：三根渐次抬升的柱 + 上升趋势线 + 端点 */
  growth: {
    main: [
      <rect key="b1" x="5.9" y="13.4" width="2.4" height="4.6" rx="1.2" />,
      <rect key="b2" x="9.7" y="10.2" width="2.4" height="7.8" rx="1.2" />,
      <rect key="b3" x="13.5" y="7" width="2.4" height="11" rx="1.2" />,
    ],
    cut: [
      <path
        key="trend"
        d="M6.7 12.2 10.5 9.4 14.3 6.8"
        strokeWidth="1.1"
      />,
      <circle key="dot" cx="17" cy="6.1" r="1.1" />,
    ],
  },

  /* 客户管理：主客 + 右后方第二人 + 领口 V */
  customer: {
    main: [
      <path key="body" d="M5.4 19.6a6.2 6.2 0 0 1 12.4 0Z" />,
      <circle key="head" cx="11.6" cy="9.4" r="3" />,
    ],
    soft: [
      { o: 0.5, el: <circle key="second" cx="16.2" cy="7.9" r="1.8" /> },
    ],
    cut: [
      <path
        key="collar"
        d="M9.6 14.6 11.3 17.2 13 14.6"
        strokeWidth="1.2"
      />,
    ],
  },

  /* 内容运营：文档 + 文字行 + 探出笔尖 */
  content: {
    main: [
      <rect key="doc" x="6.8" y="5.2" width="10.4" height="13.6" rx="2" />,
    ],
    cut: [
      <rect key="l1" x="9.1" y="8.4" width="5.4" height="1.3" rx="0.65" />,
      <rect key="l2" x="9.1" y="11.1" width="3.8" height="1.3" rx="0.65" />,
      <path key="pen" d="M12.4 17.4 16.6 13.2" strokeWidth="1.6" />,
    ],
  },

  /* 互动中心：气泡 + 三点 + 已读勾 */
  interaction: {
    main: [
      <path
        key="bubble"
        d="M19.6 11.9a7.6 7.6 0 0 1-7.6 7.6 8 8 0 0 1-3.4-.74L4.8 19.8l1.1-3.7a7.6 7.6 0 1 1 13.7-4.2Z"
      />,
    ],
    cut: [
      <circle key="d1" cx="9.3" cy="12.1" r="1.05" />,
      <circle key="d2" cx="12" cy="12.1" r="1.05" />,
      <circle key="d3" cx="14.7" cy="12.1" r="1.05" />,
      <path key="read" d="M10.2 16.6c.6.8 1.3.9 1.9 1.5" strokeWidth="1.1" />,
    ],
  },

  /* 执行中心：任务卡 + 进度条 + 完成勾 */
  execution: {
    main: [
      <path
        key="card"
        d="M6.5 4.8h11a1.7 1.7 0 0 1 1.7 1.7v11a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7v-11a1.7 1.7 0 0 1 1.7-1.7Z"
      />,
    ],
    cut: [
      <rect key="bar" x="7.8" y="8.6" width="6.4" height="1.1" rx="0.55" />,
      <path key="check" d="m9.6 14.2 2.1 2 3.4-3.7" strokeWidth="1.6" />,
    ],
  },

  /* 设备任务：平板 + 摄像头 + 屏幕内容行 */
  device: {
    main: [
      <path
        key="pad"
        d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
      />,
    ],
    cut: [
      <circle key="cam" cx="12" cy="7.3" r="0.8" />,
      <rect key="r1" x="8.6" y="10.2" width="6.8" height="1.15" rx="0.57" />,
      <rect key="r2" x="8.6" y="12.6" width="5.2" height="1.15" rx="0.57" />,
      <rect key="r3" x="8.6" y="15" width="3.6" height="1.15" rx="0.57" />,
    ],
  },

  /* 助手：四角星 + 右上伴星 + 中心点 */
  assistant: {
    main: [
      <path
        key="star"
        d="M12 5.4l1.9 4.7 4.7 1.9-4.7 1.9-1.9 4.7-1.9-4.7-4.7-1.9 4.7-1.9Z"
      />,
    ],
    soft: [
      {
        o: 0.6,
        el: (
          <path
            key="spark"
            d="m17.6 3.6.55 1.5 1.5.55-1.5.55-.55 1.5-.55-1.5-1.5-.55 1.5-.55Z"
          />
        ),
      },
    ],
    cut: [<circle key="core" cx="12" cy="12" r="1" />],
  },

  /* 我的：人像 + 领口 V */
  mine: {
    main: [
      <path key="body" d="M5.6 19.6a6.4 6.4 0 0 1 12.8 0Z" />,
      <circle key="head" cx="12" cy="9.6" r="3.2" />,
    ],
    cut: [
      <path key="collar" d="M9.7 15.4 11.4 18 13.1 15.4" strokeWidth="1.2" />,
    ],
  },
};

function colorize(
  nodes: ReactElement[] | undefined,
  props: Record<string, unknown>,
): ReactElement[] | null {
  if (!nodes) return null;
  return Children.map(nodes, (child) =>
    isValidElement(child) ? cloneElement(child, props) : child,
  );
}

export function RailIcon({
  name,
  size = 22,
  active = false,
}: {
  name: RailIconName;
  size?: number;
  active?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `rail-grad-${uid}`;
  const grad = `url(#${gradId})`;
  const g = GLYPHS[name];

  /* 主体：激活 = 金渐变；未激活 = currentColor 灰 */
  const solid = active ? grad : "currentColor";
  /* 内部细节：激活反白；未激活半透明灰叠层次 */
  const detail = active ? "#ffffff" : "currentColor";
  const detailOpacity = active ? 1 : 0.32;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="3"
          y1="3"
          x2="21"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f0b45c" />
          <stop offset="100%" stopColor="#c9811f" />
        </linearGradient>
      </defs>

      {colorize(g.main, { fill: solid })}
      {g.soft
        ? g.soft.map((s) =>
            cloneElement(s.el as ReactElement<{ fill?: string; opacity?: number }>, {
              fill: solid,
              opacity: active ? s.o : 0.32,
            }),
          )
        : null}
      {colorize(g.cut, { fill: detail, stroke: detail, opacity: detailOpacity })}
    </svg>
  );
}

/**
 * Rail 底部主题切换图标（金渐变描边，与方案 A 金点亮同族）。
 * dark=true（当前暗色）显示太阳（点击去亮色），否则显示月亮。
 */
export function ThemeToggleIcon({
  dark,
  size = 20,
}: {
  dark: boolean;
  size?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `rail-theme-grad-${uid}`;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={`url(#${gradId})`}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="3"
          y1="3"
          x2="21"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#f0b45c" />
          <stop offset="100%" stopColor="#c9811f" />
        </linearGradient>
      </defs>
      {dark ? (
        <g>
          <circle cx="12" cy="12" r="3.9" />
          <path d="M12 3.4v1.9M12 18.7v1.9M4.93 4.93l1.34 1.34M17.73 17.73l1.34 1.34M3.4 12h1.9M18.7 12h1.9M4.93 19.07l1.34-1.34M17.73 6.27l1.34-1.34" />
        </g>
      ) : (
        <path d="M20.6 12.9A8.6 8.6 0 1 1 11.1 3.4a6.8 6.8 0 0 0 9.5 9.5Z" />
      )}
    </svg>
  );
}
