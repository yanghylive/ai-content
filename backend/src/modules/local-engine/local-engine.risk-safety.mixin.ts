/**
 * risk/safety（风险审批）方法簇 mixin。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { ConfigService } from '@nestjs/config';
import { isDesktopInteractionTask } from './local-engine.utils';

import type {
  AgentExecutionScope,
  AgentRiskLevel,
  AgentSession,
  InteractionApprovalInput,
  InteractionApprovalRecord,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskType,
  InteractionReplyRuleConfig,
  LocalEngineMisfireProtection,
  LocalEnginePermissionStatus,
  LocalEngineRiskPolicy,
  LocalEngineSafetyBoundary,
  LocalEngineSafetyCheck,
} from './local-engine.types';

/** risk/safety 簇的 host 接口 */
export interface RiskSafetyHost {
  configService: ConfigService;
  replyRule: InteractionReplyRuleConfig;
  createApprovalRecord(
    task: InteractionTask,
    input: InteractionApprovalInput,
  ): InteractionApprovalRecord;
  isLiveExecutorTask(type: InteractionTaskType): boolean;
  requiresRealAccount(type: InteractionTaskType): boolean;
  agentSessionNeedsDesktopEvidence(session: AgentSession): boolean;
  resolveTaskSendMode(
    type: InteractionTaskType,
    requested?: InteractionSendMode,
  ): InteractionSendMode;
  resolveInteractionRisk(
    type: InteractionTaskType,
    sendMode: InteractionSendMode,
    sourceText: string,
    replyText: string,
  ): AgentRiskLevel;
  resolveCustomerReplyReviewReason(
    sourceText?: string | null,
  ): string | undefined;
  hasDestructiveIntent(content: string): boolean;
  createSafetyBoundary(input: {
    riskLevel: AgentRiskLevel;
    requestedSendMode?: InteractionSendMode;
    sendMode: InteractionSendMode;
    hasDestructiveIntent: boolean;
    commercialExecutionRequested?: boolean;
    callerCommercialAllowed?: boolean;
  }): LocalEngineSafetyBoundary;
  createMisfireProtection(
    type: InteractionTaskType,
    riskLevel: AgentRiskLevel,
  ): LocalEngineMisfireProtection;
  createInteractionRiskChecklist(input: {
    type: InteractionTaskType;
    riskLevel: AgentRiskLevel;
    sendMode: InteractionSendMode;
    safetyBoundary: LocalEngineSafetyBoundary;
    misfireProtection: LocalEngineMisfireProtection;
    riskPolicy?: LocalEngineRiskPolicy;
  }): LocalEngineSafetyCheck[];
  createRiskPolicy(input: {
    riskLevel: AgentRiskLevel;
    scope: AgentExecutionScope;
    targetName: string;
    instruction?: string;
    hasRemoteTakeover: boolean;
    commercialExecutionRequested?: boolean;
  }): LocalEngineRiskPolicy;
  riskActionMatchesTarget(action: string, targetName: string): boolean;
  normalizePolicyList(value: string | undefined, fallback: string[]): string[];
  recordRemoteAudit(
    session: AgentSession,
    action: 'requested' | 'approved' | 'started' | 'stopped' | 'rejected',
    operator: string,
    reason: string,
    createdAt,
  ): void;
  resolvePermissionStatusLabel(status: LocalEnginePermissionStatus): string;
  createAgentConfirmationChecks(
    session: AgentSession,
    riskLevel: Exclude<AgentRiskLevel, 'low'>,
  ): LocalEngineSafetyCheck[];
  allowLocalPlanBypass(): boolean;
  resolveAgentScopeLabel(scope: AgentExecutionScope): string;
}

export function createApprovalRecord(
  this: RiskSafetyHost,
  task: InteractionTask,
  input: InteractionApprovalInput,
): InteractionApprovalRecord {
  const strictConfirmationRequired = this.isLiveExecutorTask(task.type);
  const confirmedChecklistKeys = (task.riskChecklist || [])
    .filter((check) => !check.required || check.status === 'ready')
    .map((check) => check.key);

  return {
    operator: input.operator?.trim() || '当前登录用户',
    note: input.note?.trim() || undefined,
    currentWindowConfirmed:
      task.type === 'wechat-reply-draft' ||
      task.type === 'wechat-group-broadcast' ||
      task.type === 'wechat-contact-add' ||
      task.type === 'wechat-moments-publish' ||
      task.type === 'wechat-moments-marketing'
        ? input.currentWindowConfirmed === true
        : input.currentWindowConfirmed !== false,
    contactConfirmed:
      task.type === 'wechat-reply-draft'
        ? input.contactConfirmed === true
        : input.contactConfirmed,
    draftBeforeFillConfirmed:
      task.type === 'wechat-reply-draft'
        ? input.draftBeforeFillConfirmed === true
        : input.draftBeforeFillConfirmed,
    targetContact: input.targetContact?.trim() || undefined,
    targetConfirmed: strictConfirmationRequired
      ? input.targetConfirmed === true
      : input.targetConfirmed !== false,
    contentConfirmed: strictConfirmationRequired
      ? input.contentConfirmed === true
      : input.contentConfirmed !== false,
    checklistConfirmed: strictConfirmationRequired
      ? input.checklistConfirmed === true
      : input.checklistConfirmed,
    commercialPermissionConfirmed: strictConfirmationRequired
      ? input.commercialPermissionConfirmed === true
      : input.commercialPermissionConfirmed,
    misfireProtectionConfirmed: strictConfirmationRequired
      ? input.misfireProtectionConfirmed === true
      : input.misfireProtectionConfirmed,
    doubleConfirmationConfirmed: task.requiresDoubleConfirmation
      ? input.doubleConfirmationConfirmed === true
      : input.doubleConfirmationConfirmed,
    confirmedChecklistKeys,
    confirmedAt: new Date().toISOString(),
  };
}

export function isLiveExecutorTask(
  this: RiskSafetyHost,
  type: InteractionTaskType,
) {
  return [
    'douyin-comment-reply',
    'douyin-direct-message-reply',
    'wechat-channel-comment-reply',
    'wechat-channel-direct-message-reply',
    'wechat-reply-draft',
    'wechat-friend-accept',
    'wechat-group-broadcast',
    'wechat-contact-add',
    'wechat-moments-publish',
    'wechat-moments-marketing',
  ].includes(type);
}

export function requiresRealAccount(
  this: RiskSafetyHost,
  type: InteractionTaskType,
) {
  return [
    'douyin-comment-reply',
    'douyin-direct-message-reply',
    'wechat-channel-comment-reply',
    'wechat-channel-direct-message-reply',
  ].includes(type);
}

export function agentSessionNeedsDesktopEvidence(
  this: RiskSafetyHost,
  session: AgentSession,
) {
  return ['desktop', 'mixed', 'remote'].includes(session.executionScope);
}

export function resolveTaskSendMode(
  this: RiskSafetyHost,
  type: InteractionTaskType,
  requested?: InteractionSendMode,
): InteractionSendMode {
  const sendMode = requested || this.replyRule.defaultSendMode;
  return sendMode;
}

export function resolveInteractionRisk(
  this: RiskSafetyHost,
  type: InteractionTaskType,
  sendMode: InteractionSendMode,
  sourceText: string,
  replyText: string,
): AgentRiskLevel {
  const content = `${sourceText}\n${replyText}`;
  if (sendMode === 'auto-send' || this.hasDestructiveIntent(content)) {
    return 'high';
  }
  if (isDesktopInteractionTask(type) || sendMode === 'approval-send') {
    return 'medium';
  }
  return 'low';
}

export function resolveCustomerReplyReviewReason(
  this: RiskSafetyHost,
  sourceText?: string | null,
) {
  const content = sourceText || '';
  if (
    /退款|退货|售后|坏了|破损|发错|没收到|少发|漏发|质量|订单|物流|快递|发票|赔付|赔偿/.test(
      content,
    )
  ) {
    return '售后/退款';
  }
  if (
    /投诉|差评|不满意|垃圾|骗子|曝光|举报|拉黑|太差|生气|坑人|维权/.test(
      content,
    )
  ) {
    return '投诉/差评';
  }
  if (/转账|私下转账|支付|扣费|定金|保证金|返现|垫付/.test(content)) {
    return '付款/转账';
  }
  if (
    /治疗|疗效|治好|诊断|法律|合同纠纷|贷款|保险|投资|签证|政务/.test(content)
  ) {
    return '高风险合规问题';
  }
  return null;
}

export function hasDestructiveIntent(this: RiskSafetyHost, content: string) {
  return /(删除|移除|清空|撤回|拉黑|投诉|退款|转账|支付|扣费|购买|群发|发布|发送|提交)/.test(
    content,
  );
}

export function createSafetyBoundary(
  this: RiskSafetyHost,
  input: {
    riskLevel: AgentRiskLevel;
    requestedSendMode?: InteractionSendMode;
    sendMode: InteractionSendMode;
    hasDestructiveIntent: boolean;
    commercialExecutionRequested?: boolean;
    callerCommercialAllowed?: boolean;
  },
): LocalEngineSafetyBoundary {
  const planMode =
    this.allowLocalPlanBypass() || input.callerCommercialAllowed === true
      ? 'commercial'
      : 'trial';
  const commercialExecutionAllowed =
    this.allowLocalPlanBypass() || input.callerCommercialAllowed === true;
  const trialLimited = planMode === 'trial';
  const blockedAutoSend =
    input.requestedSendMode === 'auto-send' && input.sendMode !== 'auto-send';
  const autoSendAuthorized =
    input.sendMode === 'auto-send' && commercialExecutionAllowed;
  const blockedActions = [
    blockedAutoSend ? 'auto-send' : '',
    // 只有在用户没明确授权 auto-send 时，才把破坏性内容当成 blocker
    !autoSendAuthorized && input.hasDestructiveIntent
      ? 'destructive-action'
      : '',
  ].filter(Boolean);
  const permissionStatus: LocalEnginePermissionStatus = trialLimited
    ? 'trial_limited'
    : commercialExecutionAllowed
      ? blockedActions.length
        ? 'approval_required'
        : 'allowed'
      : 'blocked';

  return {
    planMode,
    trialLimited,
    commercialExecutionAllowed,
    permissionStatus,
    requestedCommercialExecution: input.commercialExecutionRequested === true,
    message: blockedAutoSend
      ? '当前能力或权限未允许自动发送，任务会降级为确认后发送。'
      : permissionStatus === 'blocked'
        ? '当前未开启正式商用可执行权限，只允许草稿、预检和人工确认态。'
        : permissionStatus === 'allowed'
          ? '正式商用可执行权限已开启，低风险动作可进入执行队列。'
          : input.riskLevel === 'high'
            ? '高风险互动动作需要通过商用权限、目标回读和现场校验。确认后发送模式会等待用户确认；自动发送模式校验通过才会发出。'
            : '当前任务按试用安全线执行；自动发送需要商用权限和真实执行能力通过。',
    allowedActions:
      input.sendMode === 'auto-send'
        ? ['draft', 'preflight', 'live-send']
        : ['draft', 'preflight', 'approval-gated-run'],
    blockedActions,
  };
}

export function createMisfireProtection(
  this: RiskSafetyHost,
  type: InteractionTaskType,
  riskLevel: AgentRiskLevel,
): LocalEngineMisfireProtection {
  const sendProtected = riskLevel !== 'low' || isDesktopInteractionTask(type);
  const deleteProtected = riskLevel === 'high';
  return {
    sendProtected,
    deleteProtected,
    targetLockRequired: true,
    contentPreviewRequired: true,
    destructiveActionBlocked: deleteProtected,
    warning: deleteProtected
      ? '检测到高风险动作，删除、群发、支付等动作不会自动执行。'
      : type === 'douyin-comment-reply' ||
          type === 'douyin-direct-message-reply'
        ? '浏览器互动自动发送必须通过目标回读、输入框回读、发送按钮识别和发送后证据校验。'
        : sendProtected
          ? '发送动作已启用人工确认和目标回读保护。'
          : '低风险草稿任务仍会记录目标和内容证据。',
  };
}

export function createInteractionRiskChecklist(
  this: RiskSafetyHost,
  input: {
    type: InteractionTaskType;
    riskLevel: AgentRiskLevel;
    sendMode: InteractionSendMode;
    safetyBoundary: LocalEngineSafetyBoundary;
    misfireProtection: LocalEngineMisfireProtection;
    riskPolicy?: LocalEngineRiskPolicy;
  },
): LocalEngineSafetyCheck[] {
  return [
    {
      key: 'target',
      label: '确认目标账号/对象正确',
      required: true,
      category: 'target',
      status: input.sendMode === 'auto-send' ? 'ready' : 'warning',
      hint: isDesktopInteractionTask(input.type)
        ? '微信草稿、群发、加好友或朋友圈动作会作用在当前桌面微信窗口。'
        : input.sendMode === 'auto-send'
          ? '自动发送前必须由执行器读取真实对象并锁定当前会话。'
          : '请确认本地浏览器账号和目标评论/私信没有选错。',
    },
    {
      key: 'content',
      label: '确认回复内容正确',
      required: true,
      category: 'content',
      status: input.sendMode === 'auto-send' ? 'ready' : 'warning',
      hint:
        input.sendMode === 'auto-send'
          ? '系统会在发送前填入并回读回复文本，回读不一致则阻断。'
          : '发送或粘贴前需要人工核对文本。',
    },
    {
      key: 'window',
      label: '确认当前窗口没有选错',
      required: input.misfireProtection.targetLockRequired,
      category: 'window',
      status: input.misfireProtection.targetLockRequired ? 'warning' : 'ready',
    },
    {
      key: 'commercial-permission',
      label: '确认商用执行权限',
      required:
        input.safetyBoundary.permissionStatus === 'blocked' ||
        input.safetyBoundary.permissionStatus === 'trial_limited',
      category: 'commercial',
      status:
        input.safetyBoundary.permissionStatus === 'blocked' ||
        input.safetyBoundary.permissionStatus === 'trial_limited'
          ? 'warning'
          : 'ready',
      hint: input.safetyBoundary.message,
    },
    {
      key: 'send-protection',
      label: '发送保护开启',
      required: input.sendMode !== 'draft-only',
      category: 'send-protection',
      status:
        input.sendMode === 'auto-send'
          ? 'ready'
          : input.misfireProtection.sendProtected
            ? 'warning'
            : 'ready',
      hint: input.misfireProtection.warning,
      blocking: input.riskLevel === 'high' && input.sendMode !== 'auto-send',
    },
    {
      key: 'rate-limit',
      label: '确认节奏/限流保护开启',
      required: isDesktopInteractionTask(input.type),
      category: 'send-protection',
      status:
        input.type === 'wechat-reply-draft'
          ? 'warning'
          : input.type === 'wechat-group-broadcast' ||
              input.type === 'wechat-contact-add' ||
              input.type === 'wechat-moments-publish' ||
              input.type === 'wechat-moments-marketing'
            ? 'warning'
            : 'ready',
      hint:
        input.type === 'wechat-group-broadcast' ||
        input.type === 'wechat-contact-add' ||
        input.type === 'wechat-moments-publish' ||
        input.type === 'wechat-moments-marketing'
          ? '群发、加好友和朋友圈已启用对象确认、节奏/限流、人工确认、证据、停止/接管保护。'
          : input.type === 'wechat-reply-draft'
            ? '微信草稿每次只允许锁定一个当前会话并填入一条草稿，发送和继续动作必须由人工接管。'
            : '非微信桌面动作不需要群发节奏控制。',
      blocking:
        input.type === 'wechat-group-broadcast' ||
        input.type === 'wechat-contact-add' ||
        input.type === 'wechat-moments-publish' ||
        input.type === 'wechat-moments-marketing'
          ? input.sendMode === 'auto-send' &&
            input.safetyBoundary.permissionStatus !== 'allowed'
          : false,
    },
    {
      key: 'role-approval',
      label: '确认角色审批满足要求',
      required: input.riskPolicy?.requiredRole !== 'operator',
      category: 'permission',
      status:
        input.riskPolicy?.requiredRole === 'operator' ? 'ready' : 'warning',
      hint: input.riskPolicy?.message,
    },
    {
      key: 'forbidden-actions',
      label: '确认没有触发禁止动作',
      required: Boolean(input.riskPolicy?.forbiddenActions.length),
      category: input.misfireProtection.deleteProtected
        ? 'delete-protection'
        : 'permission',
      status: input.riskPolicy?.forbiddenActions.length ? 'warning' : 'ready',
      hint: input.riskPolicy?.forbiddenActions.length
        ? `禁止动作：${input.riskPolicy.forbiddenActions.join('、')}`
        : '未命中禁止动作。',
      blocking: Boolean(input.riskPolicy?.forbiddenActions.length),
    },
  ];
}

export function createRiskPolicy(
  this: RiskSafetyHost,
  input: {
    riskLevel: AgentRiskLevel;
    scope: AgentExecutionScope;
    targetName: string;
    instruction?: string;
    hasRemoteTakeover: boolean;
    commercialExecutionRequested?: boolean;
  },
): LocalEngineRiskPolicy {
  const planMode = this.allowLocalPlanBypass() ? 'commercial' : 'trial';
  const whitelistTargets = this.normalizePolicyList(
    this.configService.get<string>('LOCAL_ENGINE_TARGET_WHITELIST'),
    ['测试对象', '微信客户', '抖音用户', '线上服务'],
  );
  const forbiddenActions = this.normalizePolicyList(
    this.configService.get<string>('LOCAL_ENGINE_FORBIDDEN_ACTIONS'),
    ['delete', 'payment', 'transfer', 'mass-send', 'clear-data'],
  );
  const forbiddenActionHits =
    input.riskLevel === 'high'
      ? forbiddenActions.filter((action) =>
          this.riskActionMatchesTarget(action, input.instruction || ''),
        )
      : [];
  const requiredRole =
    input.riskLevel === 'high' || input.scope === 'remote'
      ? 'manager'
      : 'operator';
  const remoteTakeoverAuditRequired =
    input.scope === 'remote' || input.hasRemoteTakeover;
  const targetWhitelisted = whitelistTargets.some(
    (target) =>
      input.targetName.includes(target) || target.includes(input.targetName),
  );

  return {
    planMode,
    requiredRole,
    approverRoles:
      requiredRole === 'operator' ? ['manager', 'admin'] : ['manager', 'admin'],
    targetName: input.targetName,
    targetWhitelisted,
    whitelistTargets,
    forbiddenActions: input.riskLevel === 'high' ? forbiddenActions : [],
    forbiddenActionHits,
    remoteTakeoverAuditRequired,
    auditRequiredReason: remoteTakeoverAuditRequired
      ? `执行范围=${input.scope}，目标=${input.targetName}`
      : undefined,
    remoteAudit: remoteTakeoverAuditRequired
      ? [
          {
            action: 'requested',
            operator: 'system',
            reason: `远程/接管范围需要审计，目标：${input.targetName}`,
            createdAt: new Date().toISOString(),
          },
        ]
      : [],
    message: [
      `要求角色：${requiredRole === 'operator' ? '操作员' : '经理/管理员审批'}`,
      targetWhitelisted
        ? '目标命中白名单'
        : '目标未命中白名单，继续前需人工确认',
      forbiddenActionHits.length
        ? `命中禁止动作：${forbiddenActionHits.join('、')}`
        : '未命中禁止动作',
      remoteTakeoverAuditRequired ? '远程接管审计已开启' : '无需远程接管审计',
    ].join('；'),
  };
}

export function riskActionMatchesTarget(
  this: RiskSafetyHost,
  action: string,
  targetName: string,
) {
  const normalized = targetName.toLowerCase();
  const patterns: Record<string, RegExp> = {
    delete: /(delete|删除|移除|清空)/i,
    payment: /(payment|pay|支付|扣费|购买)/i,
    transfer: /(transfer|转账)/i,
    'mass-send': /(mass|群发|批量发送)/i,
    'clear-data': /(clear|清空|清除数据)/i,
  };
  return (
    patterns[action]?.test(normalized) ||
    normalized.includes(action.toLowerCase())
  );
}

export function normalizePolicyList(
  this: RiskSafetyHost,
  value: string | undefined,
  fallback: string[],
) {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items?.length ? items : fallback;
}

export function recordRemoteAudit(
  this: RiskSafetyHost,
  session: AgentSession,
  action: 'requested' | 'approved' | 'started' | 'stopped' | 'rejected',
  operator: string,
  reason: string,
  createdAt = new Date().toISOString(),
) {
  if (!session.riskPolicy?.remoteTakeoverAuditRequired) {
    return;
  }

  session.riskPolicy.remoteAudit.push({
    action,
    operator,
    reason,
    createdAt,
  });
}

export function resolvePermissionStatusLabel(
  this: RiskSafetyHost,
  status: LocalEnginePermissionStatus,
) {
  const labels: Record<LocalEnginePermissionStatus, string> = {
    allowed: '允许',
    approval_required: '需要人工确认',
    blocked: '已阻断',
    trial_limited: '试用限制',
  };
  return labels[status];
}

export function createAgentConfirmationChecks(
  this: RiskSafetyHost,
  session: AgentSession,
  riskLevel: Exclude<AgentRiskLevel, 'low'>,
): LocalEngineSafetyCheck[] {
  const safetyBoundary = session.safetyBoundary;
  const misfireProtection = session.misfireProtection;
  return [
    {
      key: 'scope',
      label: '确认执行范围正确',
      required: true,
      category: 'scope',
      status: 'warning',
      hint: `本次范围：${this.resolveAgentScopeLabel(session.executionScope)}。`,
    },
    {
      key: 'target',
      label: '确认目标账号/对象正确',
      required: true,
      category: 'target',
      status: 'warning',
      hint: session.targetApp
        ? `目标应用：${session.targetApp}`
        : '确认没有选错平台、账号或会话。',
    },
    {
      key: 'content',
      label: '确认即将提交或写入的内容正确',
      required: true,
      category: 'content',
      status: 'warning',
      hint: '继续前需要预览待发送、待发布或待写入内容。',
    },
    {
      key: 'window',
      label: '确认当前浏览器/桌面窗口没有选错',
      required: true,
      category: 'window',
      status: 'warning',
      hint: '桌面和浏览器自动化必须确认前台窗口与目标一致。',
    },
    {
      key: 'commercial-permission',
      label: '确认试用限制和正式商用可执行权限',
      required: safetyBoundary?.permissionStatus !== 'allowed',
      category: 'commercial',
      status:
        safetyBoundary?.permissionStatus === 'allowed' ? 'ready' : 'warning',
      hint: safetyBoundary?.message,
    },
    {
      key: 'misfire-protection',
      label: '确认误发误删保护已开启',
      required: true,
      category: misfireProtection?.deleteProtected
        ? 'delete-protection'
        : 'send-protection',
      status: riskLevel === 'high' ? 'warning' : 'ready',
      hint: misfireProtection?.warning,
      blocking: riskLevel === 'high',
    },
    {
      key: 'double-confirmation',
      label: '高风险动作继续执行保护',
      required: riskLevel === 'high',
      category: 'permission',
      status: riskLevel === 'high' ? 'warning' : 'ready',
      hint: '高风险动作需要额外确认一次，避免误发、误删或误发布。',
    },
    {
      key: 'role-approval',
      label: '确认角色审批满足要求',
      required: session.riskPolicy?.requiredRole !== 'operator',
      category: 'permission',
      status:
        session.riskPolicy?.requiredRole === 'operator' ? 'ready' : 'warning',
      hint: session.riskPolicy?.message,
    },
    {
      key: 'remote-takeover-audit',
      label: '确认远程接管审计已记录',
      required: Boolean(session.riskPolicy?.remoteTakeoverAuditRequired),
      category: 'permission',
      status: session.riskPolicy?.remoteTakeoverAuditRequired
        ? 'warning'
        : 'ready',
      hint: session.riskPolicy?.remoteTakeoverAuditRequired
        ? '远程或接管类动作会写入审计事件，确认后才继续。'
        : '当前会话不需要远程接管审计。',
    },
  ];
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const riskSafetyMethods = {
  createApprovalRecord,
  isLiveExecutorTask,
  requiresRealAccount,
  agentSessionNeedsDesktopEvidence,
  resolveTaskSendMode,
  resolveInteractionRisk,
  resolveCustomerReplyReviewReason,
  hasDestructiveIntent,
  createSafetyBoundary,
  createMisfireProtection,
  createInteractionRiskChecklist,
  createRiskPolicy,
  riskActionMatchesTarget,
  normalizePolicyList,
  recordRemoteAudit,
  resolvePermissionStatusLabel,
  createAgentConfirmationChecks,
};
