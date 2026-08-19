// 状态机字典（开发文档 §9.1-9.2，统一开发计划 §九）
// Lead 状态机 + 外部任务状态机：合法流转表，非法流转抛错。
// reconcile_required 可从任意「运行态」进入（外部成功本地失败时）。
import { BadRequestException } from '@nestjs/common';

// —— Lead 状态机（开发 §9.1）——
export const LEAD_STATUSES = [
  'discovered',
  'identity_pending',
  'identified',
  'researched',
  'scored',
  'needs_review',
  'nurture',
  'blocked',
  'approved',
  'contacted',
  'replied',
  'qualifying',
  'qualified',
  'task_created',
  'opportunity',
  'won',
  'lost',
  // 任意阶段可进（横切状态）
  'duplicate_candidate',
  'merged',
  'suppressed',
  'expired',
  'platform_unavailable',
  'reconcile_required',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_TRANSITIONS: Record<string, string[]> = {
  discovered: [
    'identity_pending',
    'duplicate_candidate',
    'suppressed',
    'expired',
  ],
  identity_pending: [
    'identified',
    'duplicate_candidate',
    'suppressed',
    'expired',
    'reconcile_required',
  ],
  identified: [
    'researched',
    'duplicate_candidate',
    'suppressed',
    'expired',
    'reconcile_required',
  ],
  researched: [
    'scored',
    'duplicate_candidate',
    'suppressed',
    'expired',
    'reconcile_required',
  ],
  scored: [
    'needs_review',
    'nurture',
    'blocked',
    'duplicate_candidate',
    'suppressed',
    'reconcile_required',
  ],
  needs_review: [
    'approved',
    'nurture',
    'blocked',
    'duplicate_candidate',
    'suppressed',
  ],
  nurture: [
    'scored',
    'needs_review',
    'suppressed',
    'expired',
    'duplicate_candidate',
  ],
  blocked: ['suppressed', 'expired', 'reconcile_required'],
  approved: [
    'contacted',
    'task_created',
    'opportunity',
    'blocked',
    'suppressed',
    'reconcile_required',
  ],
  contacted: [
    'replied',
    'qualifying',
    'task_created',
    'suppressed',
    'duplicate_candidate',
    'reconcile_required',
  ],
  replied: [
    'qualifying',
    'qualified',
    'suppressed',
    'duplicate_candidate',
    'expired',
    'reconcile_required',
  ],
  qualifying: ['qualified', 'nurture', 'suppressed', 'reconcile_required'],
  qualified: [
    'task_created',
    'opportunity',
    'won',
    'lost',
    'nurture',
    'duplicate_candidate',
    'suppressed',
    'reconcile_required',
  ],
  task_created: [
    'opportunity',
    'won',
    'lost',
    'qualified',
    'suppressed',
    'reconcile_required',
  ],
  opportunity: [
    'won',
    'lost',
    'qualified',
    'nurture',
    'reconcile_required',
    'duplicate_candidate',
    'suppressed',
  ],
  won: [],
  lost: [],
  // 横切状态：除终点态外可回主线
  duplicate_candidate: ['identified', 'merged', 'suppressed', 'expired'],
  merged: ['scored', 'nurture', 'qualified', 'opportunity', 'won', 'lost'],
  suppressed: ['expired', 'reconcile_required'],
  expired: [],
  platform_unavailable: [
    'identified',
    'researched',
    'scored',
    'reconcile_required',
  ],
  reconcile_required: [
    'scored',
    'needs_review',
    'approved',
    'contacted',
    'replied',
    'qualifying',
    'qualified',
    'task_created',
    'opportunity',
    'won',
    'lost',
    'suppressed',
    'expired',
  ],
};

/** 校验 Lead 状态流转：非法抛 BadRequestException */
export function assertLeadTransition(from: string, to: string): void {
  if (from === to) return; // 原地刷新允许
  if (!LEAD_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(`非法状态流转：${from} → ${to}`);
  }
}

/** 外部动作可进入 reconcile_required 的「运行态」集合（reconcile 时可返回） */
export const RUNNING_LEAD_STATES: string[] = [
  'identified',
  'researched',
  'scored',
  'needs_review',
  'approved',
  'contacted',
  'replied',
  'qualifying',
  'qualified',
  'task_created',
  'opportunity',
];

// —— 外部任务状态机（开发 §9.2：PublishJob.status）——
export const TASK_STATUSES = [
  'queued',
  'preflight',
  'waiting_confirmation',
  'running',
  'readback_pending',
  'succeeded',
  'failed_retryable',
  'failed_permanent',
  'blocked',
  'reconcile_required',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRANSITIONS: Record<string, string[]> = {
  queued: ['preflight', 'cancelled', 'blocked', 'reconcile_required'],
  preflight: [
    'waiting_confirmation',
    'running',
    'failed_retryable',
    'failed_permanent',
    'blocked',
    'cancelled',
    'reconcile_required',
  ],
  waiting_confirmation: [
    'running',
    'cancelled',
    'blocked',
    'reconcile_required',
  ],
  running: [
    'readback_pending',
    'failed_retryable',
    'failed_permanent',
    'blocked',
    'reconcile_required',
  ],
  readback_pending: ['succeeded', 'failed_permanent', 'reconcile_required'],
  succeeded: ['reconcile_required'],
  failed_retryable: [
    'queued',
    'running',
    'failed_permanent',
    'cancelled',
    'reconcile_required',
  ],
  failed_permanent: ['cancelled', 'reconcile_required'],
  blocked: ['cancelled', 'reconcile_required'],
  reconcile_required: [
    'queued',
    'preflight',
    'running',
    'readback_pending',
    'succeeded',
    'failed_permanent',
    'blocked',
    'cancelled',
  ],
  cancelled: [],
};

/** 校验外部任务状态流转：非法抛 BadRequestException */
export function assertTaskTransition(from: string, to: string): void {
  if (from === to) return;
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(`非法任务状态流转：${from} → ${to}`);
  }
}

/** 任意运行态 → reconcile_required（外部成功本地失败）是否允许 */
export function canEnterReconcile(status: string): boolean {
  return status !== 'cancelled' && status !== 'reconcile_required';
}
