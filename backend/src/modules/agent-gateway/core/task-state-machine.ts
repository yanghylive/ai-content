import { AppError, TaskStatus } from './types';
import { makeError } from '../contracts/error-codes';
import { TERMINAL_STATUSES } from './types';

export type TaskAction =
  | 'plan'
  | 'request_confirmation'
  | 'run'
  | 'approve'
  | 'pause'
  | 'resume'
  | 'partial_success'
  | 'succeed'
  | 'fail_retryable'
  | 'fail_terminal'
  | 'cancel';

/**
 * 任务状态机 —— 对齐《整合 PRD》7.1 与《补充包》4.1。
 * draft → planned → awaiting_confirmation → running → partially_succeeded → succeeded
 * 异常：paused / failed_retryable / failed_terminal / cancelled
 * 终态(succeeded/failed_terminal/cancelled)不可再执行写工具。
 */
const TRANSITIONS: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  draft: { plan: 'planned', cancel: 'cancelled' },
  planned: { request_confirmation: 'awaiting_confirmation', run: 'running', pause: 'paused', cancel: 'cancelled' },
  awaiting_confirmation: { approve: 'running', cancel: 'cancelled' },
  running: {
    request_confirmation: 'awaiting_confirmation',
    pause: 'paused',
    partial_success: 'partially_succeeded',
    succeed: 'succeeded',
    fail_retryable: 'failed_retryable',
    fail_terminal: 'failed_terminal',
    cancel: 'cancelled',
  },
  partially_succeeded: { resume: 'running', cancel: 'cancelled' },
  // paused 允许 request_confirmation（余额不足/人工暂停后重新提交高风险工具 = 恢复路径）
  paused: { resume: 'running', request_confirmation: 'awaiting_confirmation', cancel: 'cancelled' },
  failed_retryable: { resume: 'running', cancel: 'cancelled' },
  succeeded: {},
  failed_terminal: {},
  cancelled: {},
};

/** 纯函数：计算下一状态，非法迁移抛出对应 AppError（便于直接进统一错误协议） */
export function transition(current: TaskStatus, action: TaskAction): TaskStatus {
  if (TERMINAL_STATUSES.has(current)) {
    throw makeError('TASK_TERMINAL', { details: { current, action } });
  }
  const next = TRANSITIONS[current][action];
  if (!next) {
    if (action === 'pause' || action === 'resume') {
      throw makeError('NOT_PAUSABLE', { details: { current, action } });
    }
    throw makeError('INVALID_PLAN', {
      details: { current, action, reason: '非法状态迁移' },
    });
  }
  return next;
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
