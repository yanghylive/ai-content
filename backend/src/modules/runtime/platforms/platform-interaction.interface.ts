/**
 * PlatformInteractionService · 平台互动 service 抽象接口
 *
 * 详见 docs/adr/002-copy-first-migration-strategy.md §5 P2-D2
 *
 * 每个 platform service 对应一组 (platform × taskType)：
 * - douyin × comment-reply
 * - douyin × direct-message-reply
 * - wechat-channel × comment-reply
 * - wechat-channel × direct-message-reply
 *
 * LocalRuntimeClient.execute 按 task.platform + task.type 路由到对应 service。
 */

import {
  type ExecutorContext,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../executor.interface';

export interface PlatformInteractionService {
  /** 平台标识（用于诊断日志） */
  readonly platformName: string;

  /** 任务类型（用于路由匹配） */
  readonly taskType: string;

  /** 是否处理本任务（platform + taskType 双匹配） */
  canHandle(task: ExecutorTask): boolean;

  /**
   * 执行互动任务
   * - P2-D2 阶段：preflight 由 LocalRuntimeClient.execute 在前面做完
   * - 内部负责：构造请求体 → 调引擎 POST → 映射响应为 RuntimeExecutionResult
   */
  execute(
    task: ExecutorTask,
    ctx: ExecutorContext,
  ): Promise<RuntimeExecutionResult>;
}

/**
 * 引擎互动响应通用字段。
 * 各 service 的响应会包含这些字段 + 各自的扩展字段。
 */
export interface PlatformInteractionEngineResponse {
  accountId: string;
  accountName?: string;
  platformType?: number;
  platformName?: string;
  url?: string;
  status: string;
  message?: string;
  evidence?: PlatformInteractionEvidence | null;
  draftedAt?: string;
  sentAt?: string;
  replyVisible?: boolean;
  readbackText?: string;
  nextAction?: string | null;
}

export interface PlatformInteractionEvidence {
  type: 'screenshot' | 'text' | 'page-url' | string;
  path?: string;
  label?: string;
  value?: string;
  capturedAt?: string;
}
