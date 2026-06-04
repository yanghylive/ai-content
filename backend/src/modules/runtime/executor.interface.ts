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
  | 'wechat-channel-comment-reply'
  | 'wechat-channel-direct-message-reply'
  | 'wechat-reply-draft'
  | 'wechat-group-broadcast'
  | 'wechat-moments-publish'
  | 'customer-follow-up'
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
  | 'platform_changed';

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

  runtime: {
    /** 执行器标识 */
    mode: 'local-runtime' | 'agent-s' | 'auto-upload-worker';

    /** 执行路径分类 */
    executor: 'browser-cdp' | 'desktop-agent-s';

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
  readonly id: 'local-runtime' | 'agent-s';

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
    runtime: {
      mode: 'local-runtime',
      executor: 'browser-cdp',
    },
    evidence: [],
  };
}
