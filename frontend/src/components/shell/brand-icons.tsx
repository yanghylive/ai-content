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
  | "database"
  /* 内容页功能卡(2026-09 全系统统一扩展) */
  | "topic" // 选题:灯泡
  | "viral" // 爆款拆解:放大镜+趋势
  | "generate" // 内容生成:文档+星
  | "template" // 模板风格:叠纸
  | "imagegen" // AI 生图:相框+星
  | "videogen" // AI 生视频:屏幕+播放+星
  | "clean" // 去水印:水滴+勾
  | "scrape" // 全网采集:地球+下载
  | "extract" // 文章反抓:文档+链接
  | "camera" // 视频成片:摄像机
  | "filmroll" // 视频生产:胶片
  | "product" // 商品视频:购物袋+播放
  | "publish" // 发布:纸飞机
  | "calendar" // 发布计划:日历
  /* 消息渠道(2026-09 全系统统一扩展) */
  | "inbox"
  | "botHead"
  | "douyin"
  | "channelVideo"
  | "wechat"
  | "wecom"
  | "replyPen"
  | "historyClock"
  | "groupSend"
  /* 设置/服务(2026-09 全系统统一扩展) */
  | "desktop"
  | "chip"
  | "archive"
  | "rocket"
  | "shield"
  | "sun" // 显示/外观:太阳
  | "phone" // 手机端能力:手机
  | "customer" // 客户管理:三人
  | "eye" // 情报监控:眼睛
  /* CRM / 客户操作(2026-09 全系统统一扩展) */
  | "userPlus" // 新增客户:人像+加号
  | "importTray" // 批量导入:入箱箭头
  | "followUp" // 待跟进:旗帜
  | "link" // 数据连接:链环
  | "mapPin" // 门店管理:定位针
  | "compare" // 文案对比:左右对照
  | "wand" // 视频特效:魔棒
  | "home" // 首页:房子
  | "phoneOk" // 平台账号:手机+对勾
  | "avatarGrid" // 多账号矩阵:头像矩阵
  | "member" // 账号与团队:成员
  | "textAa"; // 显示设置:文字Aa

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

  /* 选题:灯泡 + 灯座 */
  topic: {
    main: [
      <circle key="bulb" cx="12" cy="9.4" r="4.6" />,
      <rect key="seat" x="9.6" y="16.2" width="4.8" height="1.7" rx="0.85" />,
    ],
    cutLine: [
      <path key="fil" d="M10.6 15.2h2.8" strokeWidth={1.15} />,
    ],
  },

  /* 爆款拆解:放大镜 + 内部上升趋势 */
  viral: {
    main: [
      <circle key="glass" cx="9.7" cy="9.7" r="5.2" />,
      <path key="handle" d="M14.6 14.6 20 20" strokeWidth={3.2} />,
    ],
    cutLine: [
      <path key="up" d="m7.2 11.4 1.8-2.1 1.6 1.3 2-2.4" strokeWidth={1.2} />,
    ],
  },

  /* 内容生成:文档 + 右上星 */
  generate: {
    main: [
      <rect key="doc" x="5.6" y="5.4" width="10.8" height="13.2" rx="2" />,
    ],
    cutFill: [
      <rect key="l1" x="8" y="8.6" width="5.6" height="1.2" rx="0.6" />,
      <rect key="l2" x="8" y="11.2" width="4" height="1.2" rx="0.6" />,
      <path key="star" d="m18.4 2.6 1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1Z" />,
    ],
  },

  /* 模板与风格:叠纸(前实后透) */
  template: {
    main: [
      <rect key="front" x="8.2" y="4.2" width="11.4" height="12.8" rx="1.9" />,
    ],
    soft: [
      { o: 0.4, el: <rect key="mid" x="5.4" y="7" width="11.2" height="12.6" rx="1.9" /> },
      { o: 0.28, el: <rect key="back" x="2.8" y="9.6" width="10.9" height="12.4" rx="1.9" /> },
    ],
    cutLine: [
      <path key="f1" d="M11.2 8.4h5.2" strokeWidth={1.1} />,
      <path key="f2" d="M11.2 11h4" strokeWidth={1.1} />,
    ],
  },

  /* AI 生图:相框 + 山 + 右上星 */
  imagegen: {
    main: [
      <rect key="f" x="4.8" y="4.6" width="13.2" height="14.6" rx="2.2" />,
    ],
    cutFill: [
      <circle key="sun" cx="15.4" cy="8" r="1" />,
      <path key="star" d="m18.9 2.4 1 2.7 2.7 1-2.7 1-1 2.7-1-2.7-2.7-1 2.7-1Z" />,
    ],
    cutLine: [
      <path key="mtn" d="M6.6 15.8l2.9-3.1 1.9 1.8 2.8-3 2.1 2.2" strokeWidth={1.2} />,
    ],
  },

  /* AI 生视频:圆角屏 + 白三角 + 星 */
  videogen: {
    main: [
      <rect key="scr" x="5.2" y="5.6" width="13.6" height="11.6" rx="2" />,
    ],
    cutFill: [
      <path key="play" d="m10.4 8.9 4.6 2.7-4.6 2.7Z" />,
      <path key="star" d="m18.8 2.2.95 2.6 2.6.95-2.6.95-.95 2.6-.95-2.6-2.6-.95 2.6-.95Z" />,
    ],
  },

  /* 去水印:水滴 + 勾 */
  clean: {
    main: [
      <path key="drop" d="M12 4.4c0 .1 5.6 5.9 5.6 9.9a5.6 5.6 0 1 1-11.2 0C6.4 10.3 12 4.5 12 4.4Z" />,
    ],
    cutLine: [
      <path key="ck" d="m9.3 14.5 1.9 1.9 3.6-4" strokeWidth={1.5} />,
    ],
  },

  /* 全网采集:地球 + 下载箭头 */
  scrape: {
    main: [
      <circle key="globe" cx="12" cy="10.4" r="6.1" />,
    ],
    cutLine: [
      <path key="lat" d="M6 10.4h12M8.4 10.4c0 3.8 1.6 6 3.6 6s3.6-2.2 3.6-6-1.6-6-3.6-6-3.6 2.2-3.6 6Z" strokeWidth={1.1} />,
    ],
    cutFill: [
      <path key="down" d="M12 17.6v3.2m0 0 1.9-1.9M12 20.8l-1.9-1.9" strokeWidth={1.4} />,
    ],
  },

  /* 文章反抓:文档 + 链接环 */
  extract: {
    main: [
      <rect key="doc" x="5.6" y="5.4" width="10.8" height="13.2" rx="2" />,
    ],
    cutFill: [
      <rect key="l1" x="8" y="8.6" width="5.6" height="1.2" rx="0.6" />,
      <rect key="l2" x="8" y="11.2" width="4" height="1.2" rx="0.6" />,
    ],
    cutLine: [
      <circle key="ring" cx="17.9" cy="12" r="2.4" strokeWidth={1.5} />,
    ],
  },

  /* 视频成片:摄像机 */
  camera: {
    main: [
      <rect key="body" x="4.6" y="8.8" width="11.4" height="7" rx="2.1" />,
      <path key="top" d="M8.4 8.8V7.4a1.7 1.7 0 0 1 1.7-1.7h3.2a1.7 1.7 0 0 1 1.7 1.7v1.4" />,
      <path key="side" d="M16 11.2l3.8-2.2v6l-3.8-2.2Z" />,
    ],
    cutFill: [<circle key="lens" cx="9.2" cy="12.3" r="1.9" />],
  },

  /* 视频生产:胶片 */
  filmroll: {
    main: [
      <rect key="strip" x="6.6" y="4.4" width="10.8" height="15.2" rx="1.7" />,
    ],
    cutFill: [
      <rect key="s1" x="8.7" y="5.8" width="1.6" height="2" rx="0.5" />,
      <rect key="s2" x="13.7" y="5.8" width="1.6" height="2" rx="0.5" />,
      <rect key="s3" x="8.7" y="9.2" width="1.6" height="2" rx="0.5" />,
      <rect key="s4" x="13.7" y="9.2" width="1.6" height="2" rx="0.5" />,
      <rect key="s5" x="8.7" y="12.6" width="1.6" height="2" rx="0.5" />,
      <rect key="s6" x="13.7" y="12.6" width="1.6" height="2" rx="0.5" />,
      <rect key="s7" x="8.7" y="16" width="1.6" height="2" rx="0.5" />,
      <rect key="s8" x="13.7" y="16" width="1.6" height="2" rx="0.5" />,
    ],
    cutLine: [
      <path key="f1" d="M10.9 8.6 14.3 12l-3.4 3.4Z" strokeWidth={0} />,
      <path key="f2" d="m11.3 9.3 2.6 2.7-2.6 2.7Z" strokeWidth={1.1} />,
    ],
  },

  /* 商品视频:购物袋 + 播放 */
  product: {
    main: [
      <rect key="bag" x="5" y="7.4" width="14" height="11.4" rx="2" />,
      <path key="hand" d="M9.3 7.4V6a2.7 2.7 0 0 1 5.4 0v1.4" />,
    ],
    cutFill: [
      <path key="play" d="m10.6 11.6 3.7 2.1-3.7 2.1Z" />,
    ],
  },

  /* 发布:纸飞机 */
  publish: {
    main: [
      <path key="jet" d="M4.2 12 20 4.4 14.6 19.8l-3.6-6Z" />,
    ],
    cutLine: [
      <path key="fold" d="M11 13.8 20 4.4" strokeWidth={1.1} />,
    ],
  },

  /* 发布计划:日历 + 勾 */
  calendar: {
    main: [
      <rect key="cal" x="5.2" y="4.6" width="13.6" height="14.6" rx="2.2" />,
      <path key="ears" d="M8.6 4.6V2.8m6.8 1.8V2.8" strokeWidth={0} />,
    ],
    cutLine: [
      <path key="hang" d="M8.4 3.6h7.2" strokeWidth={1.4} />,
      <path key="ck" d="m8.6 12.2 2.5 2.5 4.6-4.8" strokeWidth={1.4} />,
    ],
  },

  /* 统一收件箱:方形收件盘 + 底部开口 */
  inbox: {
    main: [
      <rect key="tray" x="4.6" y="5" width="14.8" height="10.2" rx="2" />,
      <path key="legs" d="M7.2 19.4 9.2 15.2h5.6l2 4.2Z" />,
    ],
    cutLine: [
      <path key="lip" d="M4.6 11.6h14.8" strokeWidth={1.1} />,
    ],
  },

  /* 客服机器人:圆头 + 天线 + 双眼 */
  botHead: {
    main: [
      <circle key="head" cx="11" cy="12.4" r="5.4" />,
      <path key="ant" d="M11 6.9V4.8m-2.3.3 2.3 2.2 2.3-2.2" />,
    ],
    cutFill: [
      <circle key="e1" cx="8.9" cy="12.5" r="1" />,
      <circle key="e2" cx="13.1" cy="12.5" r="1" />,
    ],
  },

  /* 抖音:音符 */
  douyin: {
    main: [
      <circle key="n1" cx="8.4" cy="17.4" r="2.2" />,
      <path key="stem" d="M10.6 17.4V6.4l6.8-1.9v4l-6.8 1.9" />,
    ],
  },

  /* 视频号:圆角屏 + 播放 */
  channelVideo: {
    main: [
      <rect key="scr" x="4.8" y="5.8" width="14.4" height="12.4" rx="2.2" />,
    ],
    cutFill: [<path key="play" d="m10.5 9.9 4.3 2.5-4.3 2.5Z" />],
  },

  /* 微信:前气泡 + 后小泡 */
  wechat: {
    main: [
      <circle key="b1" cx="9" cy="12.4" r="4.8" />,
      <path key="t1" d="M5.2 16.2l-1.3 3 3.4-1.1" />,
    ],
    soft: [
      { o: 0.45, el: <circle key="b2" cx="16" cy="9.6" r="3.3" /> },
    ],
    cutFill: [
      <circle key="d1" cx="7.8" cy="11.9" r="0.8" />,
      <circle key="d2" cx="10.2" cy="11.9" r="0.8" />,
    ],
  },

  /* 企微:公文包 */
  wecom: {
    main: [
      <rect key="bag" x="5.4" y="9.6" width="13.2" height="9" rx="2.1" />,
      <path key="handle" d="M9.6 9.6V8.2a2.4 2.4 0 0 1 4.8 0v1.4" />,
    ],
    cutLine: [<path key="line" d="M8.8 13.4h6.4" strokeWidth={1.1} />],
  },

  /* AI 回复:回复泡 + 笔 */
  replyPen: {
    main: [
      <path key="bub" d="M19.2 11.8a7 7 0 0 1-7 7 7.6 7.6 0 0 1-2.8-.5l-4.8 1.5 1.2-4.1a7 7 0 1 1 13.4-3.9Z" />,
    ],
    cutLine: [
      <path key="pen" d="m8.9 14.3 4.8-4.8 1.7 1.7-4.8 4.8-2.3.6Z" strokeWidth={1.2} />,
    ],
  },

  /* 互动记录:时钟 */
  historyClock: {
    main: [<circle key="face" cx="12" cy="12" r="6.8" />],
    cutLine: [
      <path key="h" d="M12 7.9V12l2.9 1.7" strokeWidth={1.5} />,
    ],
  },

  /* 群发计划:队列 + 箭头 */
  groupSend: {
    main: [
      <circle key="u1" cx="7.2" cy="8.2" r="2.2" />,
      <circle key="u2" cx="15" cy="8.2" r="2.2" />,
      <path key="s1" d="M4.2 18.8a3 3 0 0 1 6 0" />,
    ],
    soft: [
      { o: 0.5, el: <path key="s2" d="M12.6 18.8a3.9 3.9 0 0 1 6.4-2.5" /> },
    ],
    cutLine: [<path key="arr" d="M18.4 13.2l1.6 1.6-1.6 1.6M14.6 14.8h5.2" strokeWidth={1.3} />],
  },

  /* 桌面/本机:显示器 */
  desktop: {
    main: [
      <rect key="mon" x="4.6" y="5" width="14.8" height="10.6" rx="1.8" />,
      <path key="stand" d="M9.4 15.6v1.9h5.2v-1.9M8.8 19.4h6.4" />,
    ],
    cutFill: [<circle key="dot" cx="16.6" cy="7.6" r="1" />],
  },

  /* 引擎/本机服务:芯片 */
  chip: {
    main: [<rect key="die" x="7.6" y="7.6" width="8.8" height="8.8" rx="1.7" />],
    cutLine: [
      <path key="pin" d="M10.8 7.6V4.2m2.4 3.4V4.2m-3 10.4v3.4m2.4-3.4v3.4M7.6 10.8H4.2m3.4 2.4H4.2m12.2-2.4h3.4m-3.4 2.4h3.4" strokeWidth={1.2} />,
    ],
    cutFill: [<rect key="core" x="10.2" y="10.2" width="3.6" height="3.6" rx="0.8" />],
  },

  /* AI 工件:归档箱 */
  archive: {
    main: [
      <rect key="box" x="4.4" y="9.8" width="15.2" height="9" rx="1.8" />,
      <path key="lid" d="M4.4" />,
    ],
    cutFill: [
      <rect key="knob" x="10.9" y="7" width="2.2" height="1.4" rx="0.7" />,
      <rect key="s1" x="7.6" y="12.9" width="2.8" height="1.2" rx="0.6" />,
    ],
  },

  /* 商业就绪:火箭 */
  rocket: {
    main: [
      <path key="body" d="M12 3.2c2.3 2.6 3.5 5.2 3.4 8l1.5 3.6H7.1l1.5-3.6C8.5 8.4 9.7 5.8 12 3.2Z" />,
    ],
    cutFill: [
      <circle key="win" cx="12" cy="8.4" r="1.5" />,
    ],
    cutLine: [
      <path key="f1" d="M6.6 17.4c-1 1.9-.8 3.1.4 4.1M17.4 17.4c1 1.9.8 3.1-.4 4.1" strokeWidth={1.3} />,
    ],
  },

  /* 合规:盾(实心) */
  shield: {
    main: [
      <path key="sh" d="M12 4.4 18.6 6.7v4.7c0 4.6-2.8 7-6.6 8.2-3.8-1.2-6.6-3.6-6.6-8.2V6.7Z" />,
    ],
  },

  /* 显示/外观:太阳(短线光芒) */
  sun: {
    main: [<circle key="c" cx="12" cy="12" r="3.5" />],
    cutLine: [
      <path key="rays" d="M12 5v1.7M12 17.3V19M5 12h1.7M17.3 12H19M7.2 7.2l1.2 1.2M15.6 15.6l1.2 1.2M16.8 7.2l-1.2 1.2M8.4 15.6l-1.2 1.2" strokeWidth={1.4} />,
    ],
  },

  /* 手机端能力:手机 + 屏点 */
  phone: {
    main: [
      <rect key="p" x="7.2" y="3.6" width="9.6" height="16.8" rx="2.4" />,
    ],
    cutFill: [
      <circle key="dot" cx="12" cy="17.6" r="1" />,
      <rect key="sp" x="9.6" y="5.4" width="4.8" height="0.9" rx="0.45" />,
    ],
  },

  /* 客户管理:三人剪影 */
  customer: {
    main: [
      <circle key="h1" cx="7.5" cy="9.2" r="2.2" />,
      <path key="s1" d="M3.4 18.6a4.1 4.1 0 0 1 8.2 0" />,
      <circle key="h2" cx="16.4" cy="8" r="1.7" />,
    ],
    soft: [
      { o: 0.45, el: <path key="s2" d="M12.4 18.6a4 4 0 0 1 7.2-2.1" /> },
    ],
  },

  /* 情报监控:眼睛 */
  eye: {
    main: [
      <path key="lid" d="M3 12c2.4-4.3 5.3-6.4 9-6.4s6.6 2.1 9 6.4c-2.4 4.3-5.3 6.4-9 6.4S5.4 16.3 3 12Z" />,
    ],
    cutFill: [<circle key="iris" cx="12" cy="12" r="2.4" />],
  },

  /* 新增客户:人像 + 右下加号 */
  userPlus: {
    main: [
      <path key="body" d="M4.8 19.2a6.2 6.2 0 0 1 11.8-1.4" />,
      <circle key="head" cx="10.8" cy="9" r="2.9" />,
    ],
    cutFill: [<path key="plus" d="M17.4 13.6v6m-3-3h6" strokeWidth={1.7} />],
  },

  /* 批量导入:入箱 + 向下箭头 */
  importTray: {
    main: [
      <rect key="tray" x="4.2" y="5.2" width="15.6" height="9.8" rx="2" />,
      <path key="legs" d="M7.2 19.2 8.9 15h6.2l1.7 4.2Z" />,
    ],
    cutLine: [
      <path key="arr" d="M12 9.4V3.4m0 0-2.6 2.6M12 3.4l2.6 2.6" strokeWidth={1.5} />,
      <path key="lip" d="M4.2 11h15.6" strokeWidth={1.1} />,
    ],
  },

  /* 待跟进:旗帜 */
  followUp: {
    main: [
      <path key="pole" d="M6.4 20.8V4.2" strokeWidth={1.7} />,
      <path key="flag" d="M6.4 5.2c2.6-1.6 5.2-1.6 7.8 0v5.6c-2.6-1.6-5.2-1.6-7.8 0Z" />,
    ],
    cutLine: [<path key="fold" d="M6.4 7.2h7.8" strokeWidth={1.1} />],
  },

  /* 数据连接:链环 */
  link: {
    main: [
      <path key="l1" d="M9.6 14.4 14.4 9.6" strokeWidth={1.8} />,
      <path key="a" d="M8 12.6 5.9 14.7a3.8 3.8 0 1 0 5.4 5.4l2.1-2.1" strokeWidth={1.7} />,
      <path key="b" d="m16 11.4 2.1-2.1a3.8 3.8 0 1 0-5.4-5.4L10.6 6" strokeWidth={1.7} />,
    ],
  },

  /* 门店管理:定位针 */
  mapPin: {
    main: [
      <path key="pin" d="M12 21c3.6-3.6 6.6-6.8 6.6-10.4a6.6 6.6 0 1 0-13.2 0C5.4 14.2 8.4 17.4 12 21Z" />,
    ],
    cutFill: [<circle key="c" cx="12" cy="10.6" r="2.3" />],
  },

  /* 文案对比:左右对照行 */
  compare: {
    main: [
      <rect key="l" x="3.6" y="5.4" width="6.8" height="13.2" rx="1.8" />,
      <rect key="r" x="13.6" y="5.4" width="6.8" height="13.2" rx="1.8" />,
    ],
    cutFill: [
      <rect key="l1" x="5.4" y="8.6" width="3.2" height="1.1" rx="0.55" />,
      <rect key="l2" x="5.4" y="11.2" width="2.3" height="1.1" rx="0.55" />,
      <rect key="r1" x="15.4" y="8.6" width="3.2" height="1.1" rx="0.55" />,
      <rect key="r2" x="15.4" y="11.2" width="2.3" height="1.1" rx="0.55" />,
    ],
  },

  /* 视频特效:魔棒 + 星尘 */
  wand: {
    main: [
      <rect key="stick" x="13.6" y="4.2" width="3.4" height="9.6" rx="1.7" transform="rotate(45 15.3 9)" />,
      <path key="tip" d="M13.6 4.2c.8-.8 1.9-.5 2.3-.1" />,
    ],
    cutFill: [
      <path key="s1" d="m7.6 5.2.9 1.8 1.8.9-1.8.9-.9 1.8-.9-1.8-1.8-.9 1.8-.9Z" />,
      <path key="s2" d="m17.8 15.2.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7Z" />,
    ],
  },

  /* 首页:房子 */
  home: {
    main: [
      <path key="roof" d="m4.4 11.2 7.6-7 7.6 7" strokeWidth={0} />,
      <path key="body" d="M6.2 10.4v9.6h11.6v-9.6" />,
    ],
    cutFill: [<rect key="door" x="10.8" y="15.4" width="2.4" height="4.6" rx="0.8" />],
  },

  /* 平台账号:手机 + 屏内对勾 */
  phoneOk: {
    main: [
      <rect key="phone" x="7.2" y="3.6" width="9.6" height="16.8" rx="2.4" />,
    ],
    cutFill: [
      <rect key="sp" x="9.6" y="5.4" width="4.8" height="0.9" rx="0.45" />,
      <path key="dot" d="m10.6 13.4 1.5 1.5 2.9-3" strokeWidth={1.5} />,
    ],
  },

  /* 多账号矩阵:4 头像小圆阵列 */
  avatarGrid: {
    main: [
      <circle key="a1" cx="8" cy="8.4" r="2.3" />,
      <path key="s1" d="M4.9 15.4a3.1 3.1 0 0 1 6.2 0" />,
      <circle key="a2" cx="16.3" cy="8.4" r="2.3" />,
      <path key="s2" d="M13.2 15.4a3.1 3.1 0 0 1 6.2 0" />,
      <circle key="a3" cx="12" cy="16.6" r="1.6" />,
    ],
  },

  /* 账号与团队:多人(正面人 + 侧后两人) */
  member: {
    main: [
      <circle key="m1" cx="12" cy="10" r="2.7" />,
      <path key="m1b" d="M7.4 18.6a4.6 4.6 0 0 1 9.2 0" />,
      <circle key="m2" cx="5" cy="9.4" r="1.8" />,
      <circle key="m3" cx="19" cy="9.4" r="1.8" />,
    ],
    soft: [
      { o: 0.45, el: <path key="s2" d="M2.6 18.6a2.8 2.8 0 0 1 4.6-2.2" /> },
      { o: 0.45, el: <path key="s3" d="M21.4 18.6a2.8 2.8 0 0 0-4.6-2.2" /> },
    ],
  },

  /* 显示设置:文字 Aa(圆角文字卡 + 反白 A/a) */
  textAa: {
    main: [
      <rect key="card" x="4.6" y="5.2" width="14.8" height="13.6" rx="2.4" />,
    ],
    cutLine: [
      <path key="cap" d="m9.2 16.2 2.2-5.6h1l2.2 5.6M9.8 13.8h4.2" strokeWidth={1.4} />,
    ],
    cutFill: [
      <path key="lower" d="M15.2 13.4a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Z" />,
      <path key="tail" d="M16.5 16.6v-1.9" strokeWidth={1.1} />,
    ],
  },
};

export type BrandIconTone = "idle" | "gold" | "tint";
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
  const tint = tone === "tint";
  const gradId = `brand-grad-${uid}`;
  const grad = `url(#${gradId})`;

  /* 主体填充:gold = 金渐变;idle = 雾紫灰固定色;tint = 跟随容器彩色(currentColor,
     用于彩色圆形容器内;容器已设亮色 color 故不会出现近黑块) */
  const solid = gold ? grad : tint ? "currentColor" : IDLE;
  /* 细节反白 */
  const detail = "#ffffff";
  const detailOpacity = tint ? 1 : gold ? 1 : 0.92;

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
              opacity: gold ? s.o : tint ? 1 : 0.5,
            }),
          )
        : null}
      {g.cutFill
        ? colorize(g.cutFill, { fill: detail, opacity: detailOpacity })
        : null}
      {g.cutLine
        ? colorize(g.cutLine, {
            fill: "none",
            stroke: detail,
            strokeWidth: undefined, // 保留元素自带 strokeWidth
            opacity: detailOpacity,
          })
        : null}
    </svg>
  );
}

/** 「我的」设置/菜单行 -> 品牌图形(2026-09 全行统一:桌面设置面板与移动端菜单同步) */
export const MINE_BRAND: Record<string, BrandIconName> = {
  /* 账号与设置 */
  platforms: "phoneOk",
  matrix: "avatarGrid",
  team: "member",
  memory: "knowledge",
  "settings-account": "user",
  "settings-ai-service": "botHead",
  "settings-notifications": "notifications",
  "settings-appearance": "textAa",
  "settings-integrations": "database",
  "settings-desktop": "desktop",
  "settings-data": "database",
  "settings-legal": "shield",
  /* 系统与服务 */
  costs: "reports",
  "local-service": "desktop",
  evidence: "accountHealth",
  "engine-permissions": "key",
  artifacts: "archive",
  "redfox-admin": "chip",
  "commercial-readiness": "rocket",
  "case-admin": "archive",
  /* 移动端首屏/更多 */
  "customer-entry": "customer",
  "mobile-capabilities": "phone",
  "wecom-crm": "wecom",
  "boss-recruit-m": "team",
  "growth-reports": "reports",
  "growth-workflows": "workflows",
  "account-health": "accountHealth",
  "intel-monitors": "eye",
  compliance: "shield",
  "trends-radar": "eye",
  "intel-report-new": "reports",
};

export function brandForMineKey(key: string): BrandIconName | undefined {
  return MINE_BRAND[key];
}
