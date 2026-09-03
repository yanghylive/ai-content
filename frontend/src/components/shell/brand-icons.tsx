"use client";

import { Children, cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";

/**
 * 层一 · 入口级品牌图形图标（实心版 · 2026-09 定稿）
 *
 * 按《品牌图形 · 定稿方案对照》落地：
 * - 常态(idle)：主体固定雾紫灰 #6b5b8e 实心，细节反白 —— 专用于
 *   白/浅色入口语境(ScenePage 功能卡 44 位、设置行 18px、移动端菜单);
 * - gold：主体金渐变 #f0b45c→#c9811f 实心、细节反白 —— 增长卡、
 *   account 快捷卡、素材库卡、激活态;
 * - 无背景容器、无黑色块(不用 currentColor 承担主填充,避免近黑)。
 *
 * 细节线宽已按小尺寸(18px)可读:主图形细部用 stroke 1.4-1.6 反白,
 * 行内细节(文字行/圆点)做反白实心小条/圆点。
 */

export type BrandIconName =
  | "materials" // 素材库:相框+山+太阳
  | "knowledge" // 知识库:开卷
  | "reports" // 数据报表:三横条+趋势
  | "channels" // 渠道/平台账号:对话泡+客泡
  | "team" // 团队:公文包
  | "workspace" // 工作区:四格
  | "settings" // 设置:三轨滑块
  | "notifications" // 通知:铃
  | "leads" // 线索:漏斗
  | "acquisition" // 获客:靶心
  | "strategies" // 策略:罗盘
  | "workflows" // 工作流:节点
  | "accountHealth" // 账号健康:盾
  | "rpa" // RPA:机器人
  | "accounts" // 账号:叠卡
  | "user" // 账号信息:人像
  | "key" // 访问凭证:钥匙孔
  | "database"; // 数据管理:桶

type Soft = { el: ReactElement; o: number };

type Glyph = {
  /** 主体实心元素(雾紫灰或金渐变填充) */
  main: ReactElement[];
  /** 后层辅助实心元素(同主填充、低透明度) */
  soft?: Soft[];
  /** 反白细节:填充小点/小条 */
  cutFill?: ReactElement[];
  /** 反白细节:反白细线 */
  cutLine?: ReactElement[];
};

const GLYPHS: Record<BrandIconName, Glyph> = {
  /* 素材库：圆角相框 + 山 + 太阳 */
  materials: {
    main: [
      <rect key="f" x="4.8" y="4.8" width="14.4" height="14.4" rx="2.4" />,
    ],
    cutFill: [<circle key="sun" cx="15.9" cy="8.1" r="1.05" />],
    cutLine: [
      <path
        key="mtn"
        d="M6.7 16.3l3.2-3.4 2.1 2 3-3.3 2.3 2.4"
        strokeWidth={1.35}
      />,
    ],
  },

  /* 知识库：开卷 + 页行 */
  knowledge: {
    main: [
      <path
        key="book"
        d="M12 5.8c-2.4-1.2-5.2-1.1-7.4-.1v12.2c2.2-1 5-1.1 7.4.1 2.4-1.2 5.2-1.1 7.4-.1V5.7c-2.2-1-5-1.1-7.4.1Z"
      />,
    ],
    cutLine: [
      <path key="spine" d="M12 6v12" strokeWidth={1} />,
      <path key="l1" d="M7.9 9.3h2.7" strokeWidth={1} />,
      <path key="l2" d="M13.4 9.3h2.7" strokeWidth={1} />,
    ],
  },

  /* 数据报表：三横条 + 上沿趋势 */
  reports: {
    main: [
      <rect key="r1" x="5" y="10.4" width="7.6" height="2.2" rx="1.1" />,
      <rect key="r2" x="5" y="14" width="12.4" height="2.2" rx="1.1" />,
      <rect key="r3" x="5" y="17.6" width="5.4" height="2.2" rx="1.1" />,
    ],
    cutLine: [
      <path key="t" d="M6.9 8.8 10.6 7.2l3 1 3.5-2" strokeWidth={1.15} />,
    ],
    cutFill: [<circle key="dot" cx="17.2" cy="6.1" r="0.95" />],
  },

  /* 渠道：主泡 + 小客泡 */
  channels: {
    main: [
      <circle key="b" cx="9.4" cy="11.2" r="4.9" />,
      <path key="tail" d="M5 16.2 3.4 18.7h6.2Z" />,
    ],
    soft: [{ el: <circle key="s" cx="16.1" cy="8.3" r="3" />, o: 0.45 }],
    cutFill: [<circle key="dot" cx="16.1" cy="8.3" r="0.9" />],
  },

  /* 团队：公文包 + 提手 */
  team: {
    main: [
      <rect key="bag" x="5.2" y="9.2" width="13.6" height="9.2" rx="2.2" />,
    ],
    cutLine: [
      <path
        key="handle"
        d="M9.4 9.2V7.7a2.6 2.6 0 0 1 5.2 0v1.5"
        strokeWidth={1.4}
      />,
    ],
  },

  /* 工作区：三实格 + 一浅格 */
  workspace: {
    main: [
      <rect key="a" x="5.6" y="5.6" width="5.4" height="5.4" rx="1.5" />,
      <rect key="b" x="13" y="5.6" width="5.4" height="5.4" rx="1.5" />,
      <rect key="c" x="5.6" y="13" width="5.4" height="5.4" rx="1.5" />,
    ],
    soft: [
      { el: <rect key="d" x="13" y="13" width="5.4" height="5.4" rx="1.5" />, o: 0.4 },
    ],
  },

  /* 设置：三轨道 + 圆钮 */
  settings: {
    main: [
      <rect key="t1" x="4.8" y="6.4" width="14.4" height="2.4" rx="1.2" />,
      <rect key="t2" x="4.8" y="10.8" width="14.4" height="2.4" rx="1.2" />,
      <rect key="t3" x="4.8" y="15.2" width="14.4" height="2.4" rx="1.2" />,
    ],
    cutFill: [
      <circle key="n1" cx="11.8" cy="7.6" r="1.55" />,
      <circle key="n2" cx="7.1" cy="12" r="1.55" />,
      <circle key="n3" cx="13.7" cy="16.4" r="1.55" />,
    ],
  },

  /* 通知：铃 */
  notifications: {
    main: [
      <path
        key="bell"
        d="M12 5.2c-2.05 0-3.4 1.6-3.4 3.7v4.6l-1.8 2.6h10.4l-1.8-2.6V8.9c0-2.1-1.35-3.7-3.4-3.7Z"
      />,
    ],
    cutFill: [<circle key="base" cx="12" cy="17.9" r="1.05" />],
  },

  /* 线索：漏斗 */
  leads: {
    main: [
      <path key="f" d="M4.8 5.6h14.4L13.9 12.2v6l-3.8 2v-8Z" />,
    ],
    cutLine: [<path key="neck" d="M9.7 11.6h4.6" strokeWidth={1.1} />],
  },

  /* 获客：靶心 */
  acquisition: {
    main: [<circle key="c" cx="12" cy="12" r="7" />],
    cutLine: [
      <path key="x" d="M12 7.4v9.2M7.4 12h9.2" strokeWidth={1.25} />,
    ],
    cutFill: [<circle key="ct" cx="12" cy="12" r="1.1" />],
  },

  /* 策略：罗盘 + 指针 */
  strategies: {
    main: [<circle key="c" cx="12" cy="12" r="6.9" />],
    cutFill: [
      <path key="n" d="m12 7.8 2.2 4.6-2.2-1.1-2.2 1.1Z" />,
    ],
  },

  /* 工作流：三点节点 + 连线 */
  workflows: {
    main: [
      <circle key="a" cx="7.4" cy="12" r="2.5" />,
      <circle key="b" cx="16.6" cy="7.6" r="2.5" />,
      <circle key="c" cx="16.6" cy="16.4" r="2.5" />,
    ],
    cutLine: [
      <path key="l1" d="M9.9 10.9l4.3-2.4" strokeWidth={1.2} />,
      <path key="l2" d="M9.9 13.1l4.3 2.4" strokeWidth={1.2} />,
    ],
  },

  /* 账号健康：盾 + 勾 */
  accountHealth: {
    main: [
      <path
        key="sh"
        d="M12 4.4 18.6 6.7v4.7c0 4.6-2.8 7-6.6 8.2-3.8-1.2-6.6-3.6-6.6-8.2V6.7Z"
      />,
    ],
    cutLine: [
      <path key="ck" d="m8.9 12.3 2.3 2.3 4-4.4" strokeWidth={1.5} />,
    ],
  },

  /* RPA：机器人 */
  rpa: {
    main: [
      <rect key="head" x="6.9" y="10" width="10.2" height="7.8" rx="2.4" />,
      <path key="ant" d="M11.5 10V7h1v3" />,
    ],
    cutFill: [
      <circle key="e1" cx="9.9" cy="13.6" r="0.95" />,
      <circle key="e2" cx="14.1" cy="13.6" r="0.95" />,
    ],
  },

  /* 账号：叠卡 */
  accounts: {
    main: [
      <rect key="back" x="4" y="5.6" width="11.2" height="11.6" rx="2" />,
      <rect key="front" x="7.4" y="8.4" width="12" height="11.6" rx="2" />,
    ],
    cutFill: [
      <rect key="r1" x="10.2" y="11.4" width="6" height="1.2" rx="0.6" />,
      <rect key="r2" x="10.2" y="13.8" width="4.4" height="1.2" rx="0.6" />,
      <circle key="dot" cx="16.4" cy="16.9" r="1.15" />,
    ],
  },

  /* 人像 */
  user: {
    main: [
      <path key="arch" d="M5.4 19.6a6.6 6.6 0 0 1 13.2 0Z" />,
      <circle key="head" cx="12" cy="9.6" r="3.4" />,
    ],
  },

  /* 钥匙孔 */
  key: {
    main: [<circle key="c" cx="12" cy="12" r="6.9" />],
    cutFill: [
      <circle key="ring" cx="12" cy="10.4" r="1.5" />,
      <rect key="slot" x="10.9" y="12.4" width="2.2" height="2.8" rx="0.9" />,
    ],
  },

  /* 数据桶 */
  database: {
    main: [
      <path
        key="cyl"
        d="M5.4 6.8c0-1.7 3-3 6.6-3s6.6 1.3 6.6 3v10.4c0 1.7-3 3-6.6 3s-6.6-1.3-6.6-3Z"
      />,
    ],
    cutFill: [
      <rect key="l1" x="8" y="10" width="8" height="1.2" rx="0.6" />,
      <rect key="l2" x="8" y="13.4" width="5.6" height="1.2" rx="0.6" />,
    ],
  },
};

export type BrandIconTone = "idle" | "gold";
const IDLE = "#6b5b8e";

function colorize(
  nodes: ReactElement[] | undefined,
  props: Record<string, unknown>,
): ReactElement[] | null {
  if (!nodes) return null;
  return Children.map(nodes, (child) =>
    isValidElement(child) ? cloneElement(child, props) : child,
  );
}

export function BrandIcon({
  name,
  size = 22,
  tone = "idle",
}: {
  name: BrandIconName;
  size?: number;
  tone?: BrandIconTone;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const g = GLYPHS[name];
  const gold = tone === "gold";
  const gradId = `brand-grad-${uid}`;
  const grad = `url(#${gradId})`;

  /* 主体填充:gold = 金渐变;idle = 雾紫灰固定色(不用 currentColor 防黑块) */
  const solid = gold ? grad : IDLE;
  /* 细节反白:随主体明暗,idle 下用带透明度白以柔和 */
  const detail = "#ffffff";

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {gold ? (
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
      ) : null}

      {colorize(g.main, { fill: solid })}
      {g.soft
        ? g.soft.map((s) =>
            cloneElement(s.el as ReactElement<{ fill?: string; opacity?: number }>, {
              fill: solid,
              opacity: gold ? s.o : 0.5,
            }),
          )
        : null}
      {g.cutFill
        ? colorize(g.cutFill, { fill: detail, opacity: gold ? 1 : 0.92 })
        : null}
      {g.cutLine
        ? colorize(g.cutLine, {
            fill: "none",
            stroke: detail,
            strokeWidth: undefined, // 保留元素自带 strokeWidth
            opacity: gold ? 1 : 0.92,
          })
        : null}
    </svg>
  );
}

/** 「我的」设置/菜单行的品牌字形映射(命中才升格,未命中保持线性) */
const MINE_BRAND: Record<string, BrandIconName> = {
  platforms: "accounts",
  matrix: "accounts",
  team: "team",
  "settings-notifications": "notifications",
};

export function brandForMineKey(key: string): BrandIconName | undefined {
  return MINE_BRAND[key];
}
