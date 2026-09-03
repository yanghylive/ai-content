"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";

/**
 * Rail 品牌图标（2026-09 定制 v4 · 方案 A 图形 · 去底色块）
 *
 * 迭代结论（综合多轮反馈 + 协调性审计）：
 * - 保留方案 A 的印章图形（数据柱 / 文档+笔 / 气泡+三点 / 任务块+勾 /
 *   平板+屏内容 / 星芒 / 人像），图形细节在方案对照时已被认可；
 * - 去掉图标下层的渐变方块章（激活与未激活都不画背景方块），
 *   只保留图形本身 —— 解决"背景色块不好看"；
 * - 激活态：图形主体填品牌渐变 #9254de → #531dab（与 logo / 指示条同款），
 *   图形内部细节（文字行、点、勾）反白，观感与印章一致但无方底；
 * - 未激活态：主体 currentColor 灰，细节半透明灰叠出层次；
 * - "当前选中"由 rail 左侧指示条 + 淡紫 pill 表达，图标不再叠整块紫色。
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

type Layer = {
  /** 主体图形：激活 = 品牌渐变 / 未激活 = currentColor 灰 */
  main: ReactElement[];
  /** 次要图形：同主体填充但降透明度（如并排第二人、伴星） */
  soft?: ReactElement[];
  /** 图形内部填充型细节（如文档文字行、气泡三点）：激活反白 */
  cutFill?: ReactElement[];
  /** 图形内部描边型细节（如执行勾、笔尖）：激活反白 */
  cutStroke?: ReactElement[];
};

const GLYPHS: Record<RailIconName, Layer> = {
  /* 今日增长：三根渐次抬升的数据柱 */
  growth: {
    main: [
      <rect key="b1" x="6.3" y="12.2" width="2.6" height="5.6" rx="1.3" />,
      <rect key="b2" x="10.7" y="9" width="2.6" height="8.8" rx="1.3" />,
      <rect key="b3" x="15.1" y="6.4" width="2.6" height="11.4" rx="1.3" />,
    ],
  },

  /* 客户管理：人像 + 右后方第二人 */
  customer: {
    main: [
      <path key="body" d="M5.2 20a6.8 6.8 0 0 1 13.6 0Z" />,
      <circle key="head" cx="12" cy="8.2" r="3.15" />,
    ],
    soft: [<circle key="second" cx="16.4" cy="6.9" r="2" />],
  },

  /* 内容运营：文档 + 文字行 + 探出笔尖 */
  content: {
    main: [
      <rect key="doc" x="6.6" y="5.8" width="10.8" height="12.6" rx="1.9" />,
    ],
    cutFill: [
      <rect key="l1" x="8.9" y="8.7" width="4.8" height="1.35" rx="0.67" />,
      <rect key="l2" x="8.9" y="11.1" width="3.4" height="1.35" rx="0.67" />,
    ],
    cutStroke: [
      <path
        key="pen"
        d="M11.6 17.7 16.2 13.1"
        strokeWidth="2.1"
        strokeLinecap="round"
      />,
    ],
  },

  /* 互动中心：对话气泡 + 内部三点 */
  interaction: {
    main: [
      <g key="bubble" transform="translate(1.2 2.1) scale(0.9)">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </g>,
    ],
    cutFill: [
      <circle key="d1" cx="9.6" cy="12.4" r="0.95" />,
      <circle key="d2" cx="12" cy="12.4" r="0.95" />,
      <circle key="d3" cx="14.4" cy="12.4" r="0.95" />,
    ],
  },

  /* 执行中心：任务块 + 完成勾 */
  execution: {
    main: [
      <rect key="box" x="5.4" y="5.4" width="13.2" height="13.2" rx="4.2" />,
    ],
    cutStroke: [
      <path
        key="check"
        d="m9.6 12.3 2.5 2.5 4.6-4.8"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />,
    ],
  },

  /* 设备任务：平板 + 屏幕内容条 + 底部按钮点 */
  device: {
    main: [
      <rect key="pad" x="6.5" y="5.4" width="11" height="13.2" rx="2.7" />,
    ],
    cutFill: [
      <rect key="bar" x="9.7" y="8" width="4.6" height="1.2" rx="0.6" />,
      <circle key="dot" cx="12" cy="16.2" r="1" />,
    ],
  },

  /* 助手：四角主星 + 右上伴星 */
  assistant: {
    main: [
      <path
        key="star"
        d="M12 5.8l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8Z"
      />,
    ],
    soft: [
      <path
        key="spark"
        d="m17.9 4.4.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"
      />,
    ],
  },

  /* 我的：人像 */
  mine: {
    main: [
      <path key="body" d="M5.2 20a6.8 6.8 0 0 1 13.6 0Z" />,
      <circle key="head" cx="12" cy="8.2" r="3.15" />,
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

/**
 * Rail 底部主题切换图标（与导航图标同款品牌渐变描边）。
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
          <stop offset="0%" stopColor="#9254de" />
          <stop offset="100%" stopColor="#531dab" />
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

  /* 主体：激活 = 品牌渐变；未激活 = currentColor 灰 */
  const mainFill = active ? grad : "currentColor";
  /* 内部细节：激活反白叠在渐变上；未激活半透明灰叠层次 */
  const detailFill = active ? "#ffffff" : "currentColor";
  const detailOpacity = active ? 1 : 0.5;

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
          <stop offset="0%" stopColor="#9254de" />
          <stop offset="100%" stopColor="#531dab" />
        </linearGradient>
      </defs>

      {colorize(g.main, { fill: mainFill })}
      {g.soft
        ? colorize(g.soft, { fill: mainFill, opacity: active ? 0.8 : 0.45 })
        : null}
      {g.cutFill
        ? colorize(g.cutFill, { fill: detailFill, opacity: detailOpacity })
        : null}
      {g.cutStroke
        ? colorize(g.cutStroke, {
            fill: "none",
            stroke: detailFill,
            opacity: detailOpacity,
          })
        : null}
    </svg>
  );
}
