// 统一动作契约（开发文档 §9.3 + 逐页计划 3.5，统一开发计划 §九）
// 所有线索外部动作走统一契约：AI 只产生 LeadActionInput，服务端再逐项验证后执行。
import { BadRequestException } from '@nestjs/common';

export type LeadActionType =
  | 'create_task' // 建跟进任务（内部动作，low）
  | 'draft_reply' // 草拟回复（low，需人工确认后发送）
  | 'request_review' // 请求人工复核（low）
  | 'convert_crm' // 转 CRM 客户/商机（medium/high）
  | 'send_reply' // 发送回复（high：首次私信/批量评论）
  | 'batch_outreach'; // 批量触达（high）

export const LEAD_ACTION_TYPES: LeadActionType[] = [
  'create_task',
  'draft_reply',
  'request_review',
  'convert_crm',
  'send_reply',
  'batch_outreach',
];

export type LeadActionInput = {
  tenantId: string;
  userId: string;
  leadId: string;
  action: LeadActionType;
  reason: string;
  evidenceIds: string[];
  idempotencyKey: string;
  /** 动作正文/参数（draft_reply/send_reply 需要） */
  payload?: {
    text?: string;
    platform?: string;
    targetIds?: string[]; // batch_outreach 目标
    opportunityStage?: string; // convert_crm 商机阶段
    taskTitle?: string;
    dueAt?: string;
  };
};

export type LeadActionOutput = {
  status:
    | 'created'
    | 'awaiting_approval'
    | 'blocked'
    | 'failed'
    | 'reconcile_required';
  actionId: string;
  taskId?: string;
  auditId: string;
  nextAction?: string;
  reason?: string;
};

/** 动作风险等级（T3.3 approval-gate 复用） */
export function actionRiskLevel(
  action: LeadActionType,
): 'low' | 'medium' | 'high' {
  switch (action) {
    case 'create_task':
    case 'draft_reply':
    case 'request_review':
      return 'low';
    case 'convert_crm':
      return 'medium';
    case 'send_reply':
    case 'batch_outreach':
      return 'high';
  }
}

/** 校验 LeadActionInput 基本合法性（服务端第一道闸，AI 输入不直接执行） */
export function validateActionInput(input: LeadActionInput): void {
  if (!input.tenantId || !input.leadId) {
    throw new BadRequestException('缺少 tenantId/leadId');
  }
  if (!LEAD_ACTION_TYPES.includes(input.action)) {
    throw new BadRequestException(`未知动作类型：${input.action}`);
  }
  if (!input.idempotencyKey?.trim()) {
    throw new BadRequestException('缺少幂等键 idempotencyKey');
  }
  if (input.reason?.trim().length < 4) {
    throw new BadRequestException('reason 过短（至少 4 字），AI 必须给出理由');
  }
  // 需要文本的动作必须有 payload.text
  if (
    (input.action === 'draft_reply' || input.action === 'send_reply') &&
    !input.payload?.text?.trim()
  ) {
    throw new BadRequestException(`${input.action} 需要 payload.text`);
  }
  // 批量触达必须有目标
  if (input.action === 'batch_outreach' && !input.payload?.targetIds?.length) {
    throw new BadRequestException('batch_outreach 需要 payload.targetIds');
  }
}
