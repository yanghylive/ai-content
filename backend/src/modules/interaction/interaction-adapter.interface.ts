import type { Page } from 'playwright';

/**
 * 统一互动适配器契约（一期）。
 *
 * 背景：评论/私信获客的互动侧有两套不统一接口 ——
 *  - PlatformInteractionExecutor（抖音/视频号）：dispatch(taskType/action) 抽象
 *  - XiaohongshuInteractionExecutor（小红书）：readComments/replyComment 专用方法
 * 上层 comment-acquisition 被迫写 `platform === 'xiaohongshu' ? ... : ...` 平台分支。
 *
 * 本契约对齐发布侧 PlatformAdapter 的架构哲学：
 *  1. 能力声明（capability）—— 上层按能力查询，不感知平台差异
 *  2. 边界隔离 —— adapter 只碰 Playwright Page，不接触 HTTP/账号/凭证/落库
 *  3. 统一返回语义 —— readback 回读才算「真实发送」，对齐一期设计稿
 *
 * 一期仅定义契约 + 注册表，现有执行器的适配（实现本接口）为渐进迁移。
 */

/** 互动任务类型（对齐现状：评论回复 / 私信回复） */
export type InteractionTaskType = 'comment-reply' | 'direct-message-reply';

/** 互动能力声明（对齐 PlatformCapability） */
export interface InteractionCapability {
  platform: string;
  displayName: string;
  supportedTasks: InteractionTaskType[];
  supportsReadback: boolean;
  adapterVersion: string;
}

/** 读评论/私信的入参 */
export interface InteractionReadInput {
  platform: string;
  taskType: InteractionTaskType;
  accountId: number | string;
  limit?: number;
}

/** 读到的互动条目（统一形状） */
export interface InteractionItem {
  text: string;
  authorName?: string;
  authorId?: string;
  /** 平台定位序号（如小红书评论序号），回复定位用 */
  ref?: string;
  /** 来源视频信息（抖音/视频号评论区获客） */
  videoTitle?: string;
  videoUrl?: string;
  commentTime?: string;
}

/** 读结果 */
export interface InteractionReadResult {
  items: InteractionItem[];
  readAt: string;
  /** 来源视频标题（抖音/视频号评论区获客有；小红书通知页无） */
  title?: string;
  /** 来源视频/页面 URL（回读证据用） */
  url?: string;
}

/** 发送/回复入参 */
export interface InteractionSendInput {
  platform: string;
  taskType: InteractionTaskType;
  accountId: number | string;
  targetText: string;
  sourceText?: string;
  videoTitle?: string;
  videoUrl?: string;
  commentTime?: string;
  /** 平台定位序号（小红书 commentRef 等） */
  commentRef?: string;
  replyText: string;
}

/** 发送结果（统一 status 枚举） */
export interface InteractionSendResult {
  status:
    | 'sent'
    | 'draft_filled'
    | 'failed'
    | 'account_not_logged_in'
    | 'target_missing';
  message: string;
  /** readback 回读文本：真实发送后从页面读回，非空才算「真实送达」 */
  readbackText?: string;
  /** 发送截图证据 URL（回读/截图存证，P0-6 证据链） */
  evidenceUrl?: string;
}

/**
 * 互动适配器接口（对齐 PlatformAdapter）。
 *
 * read / send 为可选方法，能力由 capability.supportedTasks 声明；
 * 某平台未实现的任务（如不支持 readback）在 capability 里如实声明，
 * 上层编排据此降级，而不是运行时抛错。
 */
export interface InteractionAdapter {
  readonly capability: InteractionCapability;
  read?(
    input: InteractionReadInput,
    page?: Page,
  ): Promise<InteractionReadResult>;
  send?(
    input: InteractionSendInput,
    page?: Page,
  ): Promise<InteractionSendResult>;
}
