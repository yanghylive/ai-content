/**
 * Runtime ExecutorRouter 接口定义
 *
 * 详见 docs/adr/001-executor-router-capability-interface.md
 *
 * Capability-based 设计：执行器自我声明能力，Router 按 capability + 优先级选择，
 * 而不是按 task.type 硬编码分发。这是 A+ 留的最重要的接口口子。
 *
 * 本期阶段：P1 骨架，所有 canHandle 返回 false，由 P2 实施时填实。
 */

import type { BackendRiskContext } from '../auth/risk-control';

// =========================================================================
// 任务定义
// =========================================================================

/**
 * 任务类型枚举
 *
 * 暂与 local-engine 现有 InteractionTaskType 平行；P2 末迁移时考虑合并。
 */
export type ExecutorTaskType =
  | 'douyin-comment-reply'
  | 'douyin-direct-message-reply'
  | 'douyin-link-exposure'
  | 'douyin-search-account-exposure'
  | 'douyin-hot-video-exposure'
  | 'douyin-targeted-exposure'
  | 'douyin-retention-exposure'
  | 'wechat-channel-comment-reply'
  | 'wechat-channel-direct-message-reply'
  | 'wechat-reply-draft'
  | 'wechat-friend-accept'
  | 'wechat-group-broadcast'
  | 'wechat-contact-add'
  | 'wechat-moments-publish'
  | 'wechat-moments-marketing'
  | 'customer-follow-up'
  | 'video-template-clip'
  | 'video-face-swap'
  | 'platform-publish-image-text'
  | 'platform-publish-video';

/**
 * 任务平台分类
 *
 * 用于路由的强制护栏：wechat-desktop 任务必须命中 agent-s 执行器。
 */
export type ExecutorTaskPlatform =
  | 'douyin'
  | 'wechat-channel'
  | 'xiaohongshu'
  | 'kuaishou'
  | 'bilibili'
  | 'weibo'
  | 'zhihu'
  | 'toutiao'
  | 'wechat-desktop'
  | 'mixed';

/**
 * 发送模式
 *
 * AGENTS.md 护栏：默认 auto-send；仅在不确定目标、风险内容、权限缺失或用户显式选择时审批。
 */
export type ExecutorSendMode = 'auto-send' | 'draft-only';

export interface ExecutorTask {
  /** 关联的现有 InteractionTask.id 或 AgentSession.id */
  relatedId: string;

  /** 关联类型，用于多态查询 */
  relatedType: 'interaction-task' | 'agent-session';

  /** 任务类型 */
  type: ExecutorTaskType;

  /** 平台分类，决定路由护栏 */
  platform: ExecutorTaskPlatform;

  /** 账号 ID（浏览器侧任务必填；桌面任务可为空） */
  accountId?: string;

  /** 平台特定 payload，由各 executor 解析 */
  payload: Record<string, unknown>;
}

// =========================================================================
// 执行上下文
// =========================================================================

export interface ExecutorContext {
  /** 风控上下文（复用 auth/risk-control） */
  riskContext: BackendRiskContext;

  /** 默认 auto-send */
  sendMode: ExecutorSendMode;

  /**
   * 扣积分上下文。
   *
   * covered=true 表示调用方已经在更高层做过批量冻结/结算，Runtime 只执行动作，
   * 不能再次扣费。这个字段只由服务端内部构造，不能透传客户端输入。
   */
  billing?: {
    covered?: boolean;
    scope?: string;
    identity?: {
      sessionId?: string;
      localUserId?: string;
      kaypalUserId?: string | null;
      kaypalDesktopAccessToken?: string | null;
      kaypalDesktopRefreshToken?: string | null;
      kaypalDesktopTokenExpiresAt?: string | null;
      kaypalDesktopDeviceId?: string | null;
      kaypalPlan?: string;
      kaypalRole?: string | null;
      kaypalPlatformRole?: string | null;
      commercialExecutionAllowed?: boolean;
      planMode?: string;
      capturedAt?: string;
    };
  };

  /** 审批决策（仅 draft-only 后续转 auto-send 时填） */
  approvalDecision?: {
    approvedBy: string;
    approvedAt: string;
    approvalReason?: string;
  };
}

// =========================================================================
// 执行结果
// =========================================================================

/**
 * 失败原因码（与技术方案六节契约一致）
 */
export type ExecutorReasonCode =
  | 'success'
  | 'runtime_unavailable'
  | 'agent_s_unavailable'
  | 'account_not_logged_in'
  | 'captcha_required'
  | 'permission_missing'
  | 'review_required'
  | 'target_not_found'
  | 'send_failed'
  | 'readback_failed'
  | 'not_integrated'
  | 'platform_changed'
  | 'already_completed'; // §10.1 幂等键：目标已触达成功，不重复发送

/**
 * 证据类型
 *
 * trajectory 和 action-log 是 Agent-S 路径必含其一。
 */
export type ExecutorEvidenceType =
  | 'screenshot'
  | 'text'
  | 'page-url'
  | 'network'
  | 'readback'
  | 'agent-s-trajectory'
  | 'agent-s-action-log';

export interface ExecutorEvidence {
  type: ExecutorEvidenceType;
  label: string;
  value?: string;
  path?: string;
  createdAt: string;
  /** 结构化补充（事件计数、原始 payload 摘要等），便于审计/前端 UI 读取 */
  raw?: Record<string, unknown>;
}

export interface RuntimeExecutionResult {
  ok: boolean;

  status: 'success' | 'failed' | 'blocked' | 'skipped';

  reasonCode: ExecutorReasonCode;

  /** 给用户看的中文说明 */
  userMessage: string;

  /** 给开发者看的英文细节 */
  technicalMessage?: string;

  /** 执行器返回的具体阻断原因，失败时用于保留真实平台/桌面错误。 */
  blockers?: string[];

  /** §10.2 可重试语义：瞬时错误（runtime 断连/限流）可安全重试 */
  retryable?: boolean;

  /** §10.2 链路追踪：与请求/执行 traceId 对齐 */
  traceId?: string;

  runtime: {
    /** 执行器标识 */
    mode: 'local-runtime' | 'agent-s';

    /** 执行路径分类 */
    executor:
      | 'browser-cdp'
      | 'desktop-agent-s'
      | 'platform-publish'
      | 'video-template-clip'
      | 'video-face-swap';

    version?: string;
    engineUrl?: string;
    profileDir?: string;
    cdpPort?: number;

    /** Agent-S 路径专用 */
    agentSSessionId?: string;
  };

  /** 证据列表。Agent-S 路径必含 trajectory 或 action-log 之一 */
  evidence: ExecutorEvidence[];

  /** 回读对比（如有） */
  readback?: {
    expectedText?: string;
    actualText?: string;
    matched: boolean;
  };

  /** 真实执行器读取到的客户原文。桌面微信/浏览器互动验收会用它区分占位文案。 */
  sourceText?: string;

  /** 与 sourceText 等价的目标文本字段，保留给旧 mapper 和审计导出。 */
  targetText?: string;

  /** 实际填入或发送的回复。 */
  replyText?: string;

  /** 回复来源；商用客户互动必须是 ai，规则兜底不能算通过。 */
  replyGeneratedBy?: 'ai' | 'fallback';

  /** 执行器结构化业务结果，例如批量目标的成功/失败明细。 */
  result?: Record<string, unknown>;

  /** 云端积分冻结/结算结果。 */
  billing?: {
    status: 'charged' | 'skipped' | 'failed';
    amount: number;
    reservationId?: string;
    transactionId?: string;
    balanceAfter?: number;
    policyVersion?: string;
    idempotencyKey?: string;
    message?: string;
  };
}

// =========================================================================
// 执行器能力声明
// =========================================================================

export interface ExecutorCapability {
  /** 能否处理 */
  ok: boolean;

  /** 优先级 0-100，高优先；ok=false 时此值无意义 */
  priority: number;

  /** ok=false 时的原因（供 Router 审计） */
  reason?: string;
}

// =========================================================================
// 执行器接口
// =========================================================================

export interface TaskExecutor {
  /** 执行器唯一标识 */
  readonly id:
    | 'local-runtime'
    | 'platform-publish'
    | 'video-template-clip'
    | 'video-face-swap'
    | 'agent-s';

  /** 判断能否处理任务 + 优先级。同步方法，不允许 IO */
  canHandle(task: ExecutorTask): ExecutorCapability;

  /** 执行入口 */
  execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult>;

  /** 健康检查 */
  isHealthy(): Promise<{ ok: boolean; details?: string }>;
}

// =========================================================================
// 工具：构造拒绝结果
// =========================================================================

export function rejectResult(
  reasonCode: ExecutorReasonCode,
  userMessage: string,
  technicalMessage?: string,
): RuntimeExecutionResult {
  return {
    ok: false,
    status: 'failed',
    reasonCode,
    userMessage,
    technicalMessage,
    retryable: reasonCode === 'runtime_unavailable', // §10.2 瞬时错误可重试
    traceId: undefined,
    runtime: {
      mode: 'local-runtime',
      executor: 'browser-cdp',
    },
    evidence: [],
  };
}
