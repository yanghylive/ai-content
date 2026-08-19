import type { GrowthPlatform } from '../growth/growth.types';

/**
 * 统一 RPA 获客契约（复核#1，对齐 3010-AI获客完整开发文档 §7）。
 *
 * 铁律（§7.4）：
 * - 不支持的动作显式 unsupported + 结构化 reasonCode，不用「手工模式」伪装完成；
 * - 页面未找到 ≠ 空结果，必须 partial/blocked/reconcile_required；
 * - RPA 只在用户明确授权的浏览器/桌面会话中运行，记录账号/窗口/步骤/证据；
 * - 不使用 Cookie 注入、验证码绕过、隐身浏览器或私有接口。
 */

/** RPA 结构化失败原因码（§7.4） */
export type RpaReasonCode =
  | 'ok'
  | 'unsupported'
  | 'no_web_search_entry'
  | 'no_browser_session'
  | 'not_logged_in'
  | 'captcha_required'
  | 'risk_control'
  | 'quota_exceeded'
  | 'parse_failed'
  | 'network_error'
  | 'page_not_found'
  | 'partial'
  | 'reconcile_required'
  // P0-2 复核：关键词搜索页未渲染（不允许降级推荐流冒充关键词结果）
  | 'search_not_rendered';

/** 统一 RPA 动作（发现 + 触达） */
export type RpaAction =
  | 'discover-keyword'
  | 'discover-account-works'
  | 'discover-recommended'
  | 'read-comments'
  | 'reply-comment'
  | 'send-direct-message';

/** 单个动作的能力声明（含不支持原因，不伪装） */
export interface RpaActionCapability {
  action: RpaAction;
  supported: boolean;
  /** 不支持时的结构化原因（§7.4：不用手工模式伪装） */
  unavailableReason?: string;
  unavailableReasonCode?: RpaReasonCode;
}

/** 平台 RPA 能力总览 */
export interface RpaCapability {
  platform: GrowthPlatform;
  displayName: string;
  /** 运行时是否就绪（浏览器会话可用） */
  runtimeReady: boolean;
  actions: RpaActionCapability[];
  driverVersion: string;
  /** 账号级探测（P1-1：登录态/风控/验证码，替代只显示"会话就绪"） */
  accountProbe?: RpaAccountProbe;
}

/** 账号级 preflight 结果（P1-1） */
export interface RpaAccountProbe {
  accountId: string;
  browserReady: boolean;
  loggedIn: boolean;
  pageInteractive: boolean;
  captchaRequired: boolean;
  riskControl: boolean;
  /** P1-5 复核：账号级活动执行中（running/paused/needs-human 有并发锁） */
  busy?: boolean;
  /** P1-5 复核：配额/风控冷却中（发现配额耗尽等） */
  cooldown?: boolean;
  checkedAt: string;
  reasonCode: string | null;
}

/** RPA 会话上下文（§7.1 RpaSessionContext 子集） */
export interface RpaSessionContext {
  tenantId?: string;
  userId: string;
  accountId: string;
  runId: string;
  resumeStep?: string;
  timeWindow?: { from: string; to: string };
  budget?: { maxItems: number; maxActions: number; maxMinutes: number };
}

/** RPA 会话句柄 */
export interface RpaSession {
  /** 底层浏览器引擎会话 key（{platform}-{accountId}），与真实浏览器会话一对一绑定（审计/精确关闭） */
  engineSessionKey?: string;
  sessionId: string;
  platform: GrowthPlatform;
  accountId: string;
  /** 浏览器页面是否可用（persistent-cdp-browser 模式下由引擎托管） */
  pageAvailable: boolean;
}

/** RPA 步骤执行结果（§7.2 回传字段） */
export interface RpaStepResult {
  stepName: string;
  /** P1-13 复核：完整生命周期契约（running 由执行器写入，driver 终态返回 success/failed/skipped） */
  status: 'running' | 'success' | 'failed' | 'skipped';
  reasonCode: RpaReasonCode;
  /** 发现到的外部内容/事件标识 */
  externalEventId?: string;
  externalUserId?: string;
  externalContentId?: string;
  authorName?: string;
  text?: string;
  sourceUrl?: string;
  occurredAt?: string;
  /** 证据 */
  evidenceUrl?: string;
  screenshotPath?: string;
  rawHash?: string;
  /** 页面/内容指纹（sha256） */
  pageFingerprint?: string;
  attempt: number;
  durationMs: number;
  driverVersion: string;
  message?: string;
  // —— P1-13 复核：执行/步骤/证据绑定与生命周期（审计对账用，driver 尽力回填）——
  /** 执行记录 id（controller finalize 时绑定） */
  executionId?: string;
  /** 步骤记录 id（独立步骤表真实外键） */
  stepId?: string;
  /** 步骤序号（同执行内递增） */
  sequenceNo?: number;
  /** 本步骤产生的证据记录 id（rpa_evidence.sha256 前缀） */
  evidenceIds?: string[];
  startedAt?: string;
  endedAt?: string;
  /** 发现类步骤的候选列表（每项对应一个外部内容） */
  items?: Array<{
    // P1-13 复核：真实外部标识改为可选——运行时缺失时由 driver 侧
    // mapDiscoveryItems 剔除 + parse_failed（禁 UUID 伪造），类型不再反向迫使造值。
    externalContentId?: string;
    url?: string;
    contentType?: string;
    title?: string;
    text?: string;
    authorName?: string;
    // P1-4：评论用户身份/事件字段贯穿（RPA → Lead → CRM 不丢）
    externalUserId?: string;
    profileUrl?: string;
    externalEventId?: string;
    occurredAt?: string;
    recommendedFallback?: boolean;
    rawHash?: string;
  }>;
}
