/**
 * task 操作簇 mixin（创建/审批/跳过/暂停/恢复/失败/重试/群发计划）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AgentSService } from '../agent-s/agent-s.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { RiskPolicyService, type RiskApprovalActor } from '../auth/risk-policy.service';
import {
  assertBackendRiskGate,
  type BackendRiskContext,
} from '../auth/risk-control';

import {
  buildBatchSummary,
  createId,
  isDesktopInteractionTask,
  isWechatNoTargetMessage,
  optionalNumber,
  optionalTrimmedText,
} from './local-engine.utils';

import { toWechatDesktopCommandError } from './local-engine.wechat-command.utils';
import type { ApprovedWechatTaskResult } from './local-engine.wechat-command.utils';
import type {
  CreateInteractionTaskInput,
  InteractionApprovalInput,
  InteractionBatchTarget,
  InteractionBatchTargetListResult,
  InteractionExecutorDraftResult,
  AgentExecutionScope,
  AgentRiskLevel,
  BatchTargetMetadata,
  CustomerServiceReplyBot,
  InteractionApprovalRecord,
  InteractionGroupBroadcastPlanStatus,
  InteractionReplyRuleConfig,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskBillingIdentity,
  InteractionTaskEvent,
  InteractionTaskStep,
  InteractionTaskStepStatus,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineDesktopCommercialPreflight,
  LocalEngineDesktopScreenshotEvidence,
  LocalEngineExecutorCapability,
  LocalEngineMisfireProtection,
  LocalEnginePermissionStatus,
  LocalEngineRiskPolicy,
  LocalEngineSafetyBoundary,
  LocalEngineSafetyCheck,
  LocalEngineTenantScope,
  ResendGroupBroadcastPlanInput,
  RetryInteractionTaskInput,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** 微信恢复审批的风险动作标识 */
const WECHAT_RESUME_RISK_ACTION = 'interaction-resume';

/** task 操作簇的 host 接口 */
export interface TaskOperationHost {
  agentS?: AgentSService;
  authRequestContext?: AuthRequestContextService;
  riskPolicyService?: RiskPolicyService;
  tasks: Map<string, InteractionTask>;
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
  };
  createTask(input: CreateInteractionTaskInput): Promise<InteractionTask>;
  resolveFutureWechatPlanTime(
    task: InteractionTask,
    now?: unknown,
  ): string | undefined;
  approveTask(
    id: string,
    input?: InteractionApprovalInput,
    riskContext?: BackendRiskContext,
  ): Promise<InteractionTask>;
  skipTask(id: string): Promise<InteractionTask>;
  pauseTask(id: string): Promise<InteractionTask>;
  continueTask(id: string): Promise<InteractionTask>;
  getGroupBroadcastPlanDetails(
    id: string,
  ): Promise<InteractionBatchTargetListResult>;
  resendGroupBroadcastPlan(
    id: string,
    input?: ResendGroupBroadcastPlanInput,
  ): Promise<InteractionTask>;
  removeGroupBroadcastPlan(id: string): Promise<InteractionTask>;
  assertGroupBroadcastTask(task: InteractionTask);
  buildResendGroupBroadcastTargets(
    task: InteractionTask,
    input: ResendGroupBroadcastPlanInput,
  ): CreateInteractionTaskInput['batchTargets'];
  getContinuableBatchTargets(task: InteractionTask): InteractionBatchTarget[];
  buildContinueTaskInput(
    task: InteractionTask,
    targets: InteractionBatchTarget[],
  ): CreateInteractionTaskInput;
  resumeTask(
    id: string,
    input?: InteractionApprovalInput,
    riskContext?: BackendRiskContext,
  ): Promise<InteractionTask>;
  createTaskResumeConfirmation(id: string);
  requireRiskPolicyService(): RiskPolicyService;
  riskApprovalActor(task: InteractionTask): RiskApprovalActor;
  buildWechatResumeApprovalTarget(task: InteractionTask): string;
  failTask(id: string, reason?: unknown): Promise<InteractionTask>;
  retryTask(
    id: string,
    input?: RetryInteractionTaskInput,
  ): Promise<InteractionTask>;
  applyInteractionDraftResult(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
  ): void;
  buildCurrentInteractionTaskBillingIdentity():
    | InteractionTaskBillingIdentity
    | undefined;
  captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence>;
  collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds?: string[],
  ): string[];
  createTaskSteps(
    type: InteractionTaskType,
    hasAccount: boolean,
    now: string,
  ): InteractionTaskStep[];
  currentActorCommercialAllowed(): boolean;
  getDesktopCommercialPreflight(): Promise<LocalEngineDesktopCommercialPreflight>;
  loadReplyRuleFromStore(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionReplyRuleConfig>;
  normalizeBatchTargets(
    input: CreateInteractionTaskInput,
    now: string,
  ): InteractionBatchTarget[];
  normalizeGroupBroadcastPlanMetadata(
    input: Partial<CreateInteractionTaskInput>,
    now?: unknown,
  ): Record<string, unknown>;
  normalizeMomentsPlanMetadata(
    input: CreateInteractionTaskInput,
  ): Record<string, unknown> | undefined;
  persistTask(task: InteractionTask): Promise<void>;
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): InteractionTaskEvent;
  rememberDesktopEvidence(
    evidence?: LocalEngineDesktopScreenshotEvidence,
  ): void;
  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  ): InteractionGroupBroadcastPlanStatus | undefined;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  runInteractionTaskLifecycle(taskId: string): void;
  sendApprovedBrowserReplyViaRuntime(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult>;
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ): Promise<void>;
  updateTask(
    task: InteractionTask,
    status: InteractionTaskStatus,
    eventMessage: string,
    patch?: Partial<InteractionTask>,
  ): void;
  ensureTaskStore(): Promise<void>;
  assertCreateExecutionPreflight(input: CreateInteractionTaskInput): Promise<
    | {
        accountName: string;
        platformType: number;
        platformName: string;
        capability: LocalEngineExecutorCapability;
      }
    | undefined
  >;
  blockTaskForExecutionContract(
    task: InteractionTask,
    contract: {
      ok: false;
      stageKey?: string;
      failureReason?: string;
      nextAction?: string;
      [key: string]: unknown;
      stepMessages?: {
        accountEntry: string;
        targetRead: string;
        replyGenerate: string;
        sendApproval: string;
        sendResult: string;
      };
    },
  );
  buildExecutionContract(
    task: Pick<InteractionTask, 'type' | 'accountId' | 'accountName'> & {
      typeLabel?: string;
      platformType?: number;
      platformName?: string;
      sendMode?: InteractionSendMode;
    },
    options: {
      capability?: LocalEngineExecutorCapability;
      capabilityError?: string;
      requireReadyCapability: boolean;
      allowMissingAccountException: boolean;
    },
  ):
    | { ok: true }
    | {
        ok: false;
        failureReason?: string;
        stageKey?: string;
        nextAction?: string;
        status?: string;
        stepMessages?: unknown;
      };
  buildReplyFromRule(
    sourceText: string,
    context?: { targetName?: string; accountName?: string },
    replyRule?: InteractionReplyRuleConfig,
  ): string;
  createApprovalRecord(
    task: InteractionTask,
    input: InteractionApprovalInput,
  ): InteractionApprovalRecord;
  createInteractionRiskChecklist(input: {
    type: InteractionTaskType;
    riskLevel: AgentRiskLevel;
    sendMode: InteractionSendMode;
    safetyBoundary: LocalEngineSafetyBoundary;
    misfireProtection: LocalEngineMisfireProtection;
    riskPolicy?: LocalEngineRiskPolicy;
  }): LocalEngineSafetyCheck[];
  createMisfireProtection(
    type: InteractionTaskType,
    riskLevel: AgentRiskLevel,
  ): LocalEngineMisfireProtection;
  createRiskPolicy(input: {
    riskLevel: AgentRiskLevel;
    scope: AgentExecutionScope;
    targetName: string;
    instruction?: string;
    hasRemoteTakeover: boolean;
    commercialExecutionRequested?: boolean;
  }): LocalEngineRiskPolicy;
  createSafetyBoundary(input: {
    riskLevel: AgentRiskLevel;
    requestedSendMode?: InteractionSendMode;
    sendMode: InteractionSendMode;
    hasDestructiveIntent: boolean;
    commercialExecutionRequested?: boolean;
    callerCommercialAllowed?: boolean;
  }): LocalEngineSafetyBoundary;
  getReplyBot(id: string): Promise<CustomerServiceReplyBot>;
  getTask(id: string): Promise<InteractionTask>;
  getTaskForDisplay(id: string): Promise<InteractionTask>;
  hasDestructiveIntent(content: string): boolean;
  isLiveExecutorTask(type: InteractionTaskType): boolean;
  markBatchTargetsByNames(
    task: InteractionTask,
    targetNames: string[],
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markBatchTargetsForApprovalOutcome(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markPausableBatchTargets(
    task: InteractionTask,
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markUnfinishedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  requiresRealAccount(type: InteractionTaskType): boolean;
  resolveExecutionContract(task: InteractionTask): Promise<
    | { ok: true }
    | {
        ok: false;
        failureReason?: string;
        stageKey?: string;
        nextAction?: string;
      }
    | undefined
  >;
  resolveInteractionRisk(
    type: InteractionTaskType,
    sendMode: InteractionSendMode,
    sourceText: string,
    replyText: string,
  ): AgentRiskLevel;
  resolvePermissionStatusLabel(status: LocalEnginePermissionStatus): string;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resolveTaskSendMode(
    type: InteractionTaskType,
    requested?: InteractionSendMode,
  ): InteractionSendMode;
  resolveTypeLabel(type: InteractionTaskType): string;
  sendApprovedWechatTask(
    task: InteractionTask,
  ): Promise<ApprovedWechatTaskResult>;
}

export async function createTask(
  this: TaskOperationHost,
  input: CreateInteractionTaskInput,
): Promise<InteractionTask> {
  const tenantScope = await this.resolveTenantScope();
  const callerCommercialAllowed = this.currentActorCommercialAllowed();
  const needsRealAccount = this.requiresRealAccount(input.type);
  const saveOnly = input.planStatus === 'draft';
  const isLiveTask = this.isLiveExecutorTask(input.type);
  const needsLiveExecution = isLiveTask && !saveOnly;
  if (needsRealAccount && !input.accountId) {
    throw new BadRequestException(
      `${this.resolveTypeLabel(input.type)}需要选择已登录的本地账号。请先到发布中心-平台账号完成登录，再回来创建任务。`,
    );
  }
  let createPreflight: Awaited<
    ReturnType<TaskOperationHost['assertCreateExecutionPreflight']>
  >;
  let createPreflightFailure:
    | {
        ok: false;
        stageKey: string;
        failureReason: string;
        nextAction: string;
      }
    | undefined;

  if (!saveOnly && (needsRealAccount || isDesktopInteractionTask(input.type))) {
    try {
      createPreflight = await this.assertCreateExecutionPreflight(input);
    } catch (error) {
      createPreflightFailure = {
        ok: false,
        stageKey: 'executor-capability',
        failureReason:
          error instanceof Error ? error.message : '真实执行预检失败',
        nextAction: '请修复账号登录态、本地 发布服务或服务能力后创建重试任务。',
      };
    }
  }
  await this.ensureTaskStore();
  const defaultReplyRule = await this.loadReplyRuleFromStore(tenantScope);
  const now = new Date().toISOString();
  const metadata = this.normalizeGroupBroadcastPlanMetadata(input, now);
  const fallbackSource = input.sourceText?.trim() || '等待本机读取真实对象。';
  const taskReplyBot = input.replyBotId
    ? await this.getReplyBot(input.replyBotId)
    : undefined;
  const taskRule = taskReplyBot?.config || defaultReplyRule;
  const fallbackReply =
    input.replyText?.trim() ||
    this.buildReplyFromRule(fallbackSource, {}, taskRule);
  const batchTargets = this.normalizeBatchTargets(input, now);
  const momentsPlanMetadata = this.normalizeMomentsPlanMetadata(input);
  const primaryTarget = batchTargets[0];
  const requestedSendMode = input.sendMode;
  const sendMode = this.resolveTaskSendMode(input.type, requestedSendMode);
  const initialContract =
    createPreflightFailure ||
    this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId,
        accountName: input.accountName?.trim() || '未指定账号',
        platformType: input.platformType,
        platformName: input.platformName,
        sendMode,
      },
      {
        capability: createPreflight?.capability,
        requireReadyCapability: needsLiveExecution,
        allowMissingAccountException: false,
      },
    );
  const riskLevel = this.resolveInteractionRisk(
    input.type,
    sendMode,
    fallbackSource,
    fallbackReply,
  );
  const safetyBoundary = this.createSafetyBoundary({
    riskLevel,
    requestedSendMode,
    sendMode,
    hasDestructiveIntent: this.hasDestructiveIntent(
      `${fallbackSource}\n${fallbackReply}`,
    ),
    commercialExecutionRequested: input.commercialExecutionRequested === true,
    callerCommercialAllowed,
  });
  const misfireProtection = this.createMisfireProtection(input.type, riskLevel);
  const riskPolicy = this.createRiskPolicy({
    riskLevel,
    scope: isDesktopInteractionTask(input.type)
      ? 'desktop'
      : input.type === 'customer-follow-up'
        ? 'mixed'
        : 'browser',
    targetName:
      primaryTarget?.targetName || input.targetName?.trim() || '测试对象',
    hasRemoteTakeover: false,
  });
  const riskChecklist = this.createInteractionRiskChecklist({
    type: input.type,
    riskLevel,
    sendMode,
    safetyBoundary,
    misfireProtection,
    riskPolicy,
  });
  const task: InteractionTask = {
    id: createId(),
    ...tenantScope,
    type: input.type,
    typeLabel: this.resolveTypeLabel(input.type),
    status: initialContract.ok ? 'queued' : 'blocked',
    statusLabel: this.resolveStatusLabel(
      initialContract.ok ? 'queued' : 'blocked',
    ),
    planName: optionalTrimmedText(metadata.planName),
    planTime: optionalTrimmedText(metadata.planTime),
    planStatus: this.resolveGroupBroadcastPlanStatus(
      input.type,
      initialContract.ok ? 'queued' : 'blocked',
      metadata.planStatus,
      metadata.planTime,
    ),
    dailyLimit: optionalNumber(metadata.dailyLimit),
    associatedWeChat: optionalTrimmedText(metadata.associatedWeChat),
    currentWechatId: optionalTrimmedText(metadata.currentWechatId),
    plannedWechatId: optionalTrimmedText(metadata.plannedWechatId),
    generateOnDemand:
      typeof metadata.generateOnDemand === 'boolean'
        ? metadata.generateOnDemand
        : undefined,
    accountId: input.accountId,
    replyBotId: input.replyBotId,
    accountName:
      createPreflight?.accountName || input.accountName?.trim() || '未指定账号',
    platformType: createPreflight?.platformType ?? input.platformType,
    platformName: createPreflight?.platformName || input.platformName,
    targetName:
      primaryTarget?.targetName || input.targetName?.trim() || '测试对象',
    sourceText: primaryTarget?.sourceText || fallbackSource,
    replyText: primaryTarget?.replyText || fallbackReply,
    sourceUrl: primaryTarget?.sourceUrl || optionalTrimmedText(input.sourceUrl),
    profileUrl:
      primaryTarget?.profileUrl || optionalTrimmedText(input.profileUrl),
    commentTime:
      primaryTarget?.commentTime || optionalTrimmedText(input.commentTime),
    videoTitle:
      primaryTarget?.videoTitle || optionalTrimmedText(input.videoTitle),
    videoUrl: primaryTarget?.videoUrl || optionalTrimmedText(input.videoUrl),
    engagementScore:
      primaryTarget?.engagementScore ?? optionalNumber(input.engagementScore),
    replyGeneratedBy:
      input.replyGeneratedBy ||
      (input.replyText?.trim() ? 'fallback' : undefined),
    replyRule: taskRule,
    sendMode,
    requestedSendMode,
    riskLevel,
    requiresDoubleConfirmation: sendMode === 'approval-send',
    safetyBoundary,
    misfireProtection,
    riskPolicy,
    riskChecklist,
    executionMode: isLiveTask ? 'browser-assisted' : 'internal-record',
    metadata:
      Object.keys(metadata).length || momentsPlanMetadata
        ? { ...metadata, ...(momentsPlanMetadata || {}) }
        : undefined,
    billingIdentity: isLiveTask
      ? this.buildCurrentInteractionTaskBillingIdentity()
      : undefined,
    followUpMethod:
      input.type === 'customer-follow-up' ? input.followUpMethod : undefined,
    rateLimitPerMinute: 3,
    runtimeState: saveOnly
      ? 'record_ready'
      : initialContract.ok
        ? needsLiveExecution
          ? 'preflight_only'
          : 'record_ready'
        : 'executor_missing',
    createdAt: now,
    updatedAt: now,
    failureReason: initialContract.ok
      ? undefined
      : initialContract.failureReason,
    nextAction: saveOnly
      ? '草稿已保存，可以继续编辑或开始执行。'
      : initialContract.ok
        ? isDesktopInteractionTask(input.type)
          ? '等待本机微信执行器操作'
          : '等待本地引擎领取任务'
        : initialContract.nextAction,
    batchTargets,
    batchSummary: initialContract.ok
      ? buildBatchSummary(batchTargets)
      : buildBatchSummary(
          batchTargets.map((target) => ({
            ...target,
            status: 'failed',
            failureReason: initialContract.failureReason,
            nextAction: initialContract.nextAction,
            updatedAt: now,
          })),
        ),
    steps: this.createTaskSteps(input.type, Boolean(input.accountId), now),
    events: [],
  };

  if (!initialContract.ok) {
    task.batchTargets = task.batchTargets?.map((target) => ({
      ...target,
      status: 'failed',
      failureReason: initialContract.failureReason,
      nextAction: initialContract.nextAction,
      updatedAt: now,
    }));
    task.batchSummary = buildBatchSummary(task.batchTargets);
    void this.setTaskStep(
      task,
      'account-entry',
      'blocked',
      '真实执行预检未通过。',
    );
    void this.setTaskStep(
      task,
      'target-read',
      'blocked',
      '未通过账号或服务检查，不能读取真实对象。',
    );
    void this.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      '未读取真实对象，不能生成商用草稿。',
    );
    void this.setTaskStep(
      task,
      'send-approval',
      'blocked',
      '真实执行合同缺失，不能进入受控执行。',
    );
    void this.setTaskStep(
      task,
      'send-result',
      'blocked',
      initialContract.failureReason || '',
    );
  }

  if (initialContract.ok) {
    this.pushEvent(task, 'info', '互动任务已创建，等待本地引擎执行。');
  } else {
    this.pushEvent(
      task,
      'warning',
      '互动任务已创建，但真实执行合同尚未满足，生命周期会停在阻断态。',
    );
    this.pushEvent(
      task,
      'warning',
      initialContract.failureReason || '真实执行合同缺失',
      {
        type: 'failure_reason',
        label: '执行合同缺失',
        value: initialContract.failureReason || '真实执行合同缺失',
        stageKey: initialContract.stageKey,
      },
    );
  }
  this.pushEvent(
    task,
    'info',
    task.executionMode === 'browser-assisted'
      ? task.sendMode === 'auto-send'
        ? '当前会尝试打开本地账号后台；自动发送模式会在真实对象、输入框、发送按钮和回复回读通过后直接发送。'
        : '当前会尝试打开本地账号后台；确认后发送模式会在真实发送前等待用户确认。'
      : '当前仅创建内部跟进记录，不触发平台动作。',
  );
  this.pushEvent(task, 'info', `已套用客服规则：${taskRule.industryName}。`);
  this.pushEvent(task, 'info', '阶段日志已开启：任务创建', {
    type: 'stage_log',
    label: '阶段日志',
    value: `create-task / risk=${riskLevel} / sendMode=${sendMode}`,
    stageKey: 'create-task',
  });
  if (requestedSendMode === 'auto-send' && sendMode !== 'auto-send') {
    this.pushEvent(
      task,
      'warning',
      isDesktopInteractionTask(input.type)
        ? '微信桌面动作暂不允许自动发送，已降级为确认后发送。'
        : safetyBoundary.message,
    );
  }
  this.pushEvent(
    task,
    safetyBoundary.permissionStatus === 'allowed' ? 'info' : 'warning',
    `商用执行权限：${this.resolvePermissionStatusLabel(safetyBoundary.permissionStatus)}`,
    {
      type: 'text',
      label: '试用/商用边界',
      value: safetyBoundary.message,
    },
  );
  if (isDesktopInteractionTask(input.type)) {
    this.pushEvent(
      task,
      task.sendMode === 'auto-send' ? 'info' : 'warning',
      task.sendMode === 'auto-send'
        ? '微信桌面任务使用自动发送模式：必须通过桌面 preflight、目标锁定、窗口确认和草稿回读，缺一项就阻断。'
        : '微信桌面任务使用确认后发送模式：只填入草稿，执行前必须确认当前桌面微信窗口。',
    );
  }
  if (batchTargets.length > 1) {
    this.pushEvent(task, 'info', `批量对象已导入 ${batchTargets.length} 条。`);
  }
  const scheduledAt = this.resolveFutureWechatPlanTime(task, now);
  if (saveOnly) {
    task.planStatus = 'draft';
    task.runtimeState = 'record_ready';
    task.nextAction = '草稿已保存，可以继续编辑或开始执行。';
    this.pushEvent(task, 'info', '计划草稿已保存，当前没有发送。', {
      type: 'stage_log',
      label: '草稿',
      value: task.id,
      stageKey: 'draft-saved',
    });
  } else if (scheduledAt) {
    task.planStatus = 'scheduled';
    task.runtimeState = 'record_ready';
    task.nextAction = `将在 ${new Date(scheduledAt).toLocaleString('zh-CN', {
      hour12: false,
    })} 由本机助手开始执行。`;
    this.pushEvent(task, 'info', '计划已保存，等待设定时间。', {
      type: 'stage_log',
      label: '等待执行',
      value: scheduledAt,
      stageKey: 'scheduled-wait',
    });
  }
  this.tasks.set(task.id, task);
  await this.persistTask(task);
  if (initialContract.ok && !saveOnly && !scheduledAt) {
    this.runInteractionTaskLifecycle(task.id);
  }

  return task;
}

export function resolveFutureWechatPlanTime(
  this: TaskOperationHost,
  task: InteractionTask,
  now = new Date().toISOString(),
) {
  if (!isDesktopInteractionTask(task.type)) return undefined;
  const value =
    optionalTrimmedText(task.planTime) ||
    optionalTrimmedText(task.metadata?.scheduledAt) ||
    optionalTrimmedText(task.metadata?.scheduleStartTime) ||
    optionalTrimmedText(task.metadata?.wechat_plan_schedule_start_time) ||
    optionalTrimmedText(task.metadata?.wechat_moments_schedule_start_time);
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.parse(now)) {
    return undefined;
  }
  return new Date(timestamp).toISOString();
}

export async function approveTask(
  this: TaskOperationHost,
  id: string,
  input: InteractionApprovalInput = {},
  riskContext?: BackendRiskContext,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  if (task.status !== 'waiting_for_send_confirmation') {
    return task;
  }

  const riskAudit = assertBackendRiskGate({
    action: 'interaction-approval',
    target: `${task.type}:${task.accountName}:${task.targetName}`,
    riskLevel: task.riskLevel || 'medium',
    requiresConfirmation: true,
    confirmation: input.riskConfirmation,
    context: riskContext,
    reason:
      task.sendMode === 'draft-only'
        ? '批准互动草稿填入动作。'
        : '批准互动发送链路继续执行，后端会调用真实执行器并做发送后回读。',
  });

  const approvalRecord = this.createApprovalRecord(task, input);
  // 人工在确认前修改过草稿 → 用修改后的文本覆盖，确保发出去的是人改过的版本
  const editedReply = optionalTrimmedText(input.replyText);
  if (editedReply && editedReply !== task.replyText) {
    const originalLength = (task.replyText || '').length;
    task.replyText = editedReply;
    this.pushEvent(
      task,
      'info',
      `人工已修改回复草稿（原 ${originalLength} 字 → 新 ${editedReply.length} 字），将按修改后版本发送。`,
    );
  }
  if (isDesktopInteractionTask(task.type)) {
    const missing = [
      approvalRecord.targetConfirmed ? '' : '目标对象',
      approvalRecord.contentConfirmed ? '' : '执行内容',
      approvalRecord.checklistConfirmed ? '' : '风险清单',
      approvalRecord.commercialPermissionConfirmed ? '' : '商用权限',
      approvalRecord.misfireProtectionConfirmed ? '' : '误操作保护',
      task.requiresDoubleConfirmation &&
      !approvalRecord.doubleConfirmationConfirmed
        ? '二次确认'
        : '',
      approvalRecord.currentWindowConfirmed ? '' : '当前微信窗口',
      approvalRecord.contactConfirmed ? '' : '目标联系人/当前会话',
      approvalRecord.draftBeforeFillConfirmed ? '' : '草稿填入前确认',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException(`请先确认：${missing.join('、')}`);
    }
    const preflight = await this.getDesktopCommercialPreflight();
    if (!preflight.allowed) {
      throw new BadRequestException(
        `微信桌面 preflight 未通过：${preflight.blockers.join('；')}`,
      );
    }
    this.wechatSessionConfirmation = {
      ...this.wechatSessionConfirmation,
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      targetContact:
        approvalRecord.targetContact ||
        this.wechatSessionConfirmation.targetContact,
      updatedAt: approvalRecord.confirmedAt,
      takeoverActive: false,
    };
    const evidence = await this.captureDesktopScreenshot(
      '微信草稿填入前截图',
    ).catch((error) => ({
      type: 'text' as const,
      label: '微信草稿填入前截图不可用',
      value: error instanceof Error ? error.message : '桌面截图失败',
      capturedAt: approvalRecord.confirmedAt,
    }));
    this.rememberDesktopEvidence(evidence);
    this.pushEvent(task, 'info', '已保存微信草稿填入前桌面证据。', {
      type: evidence.type,
      label: evidence.label,
      value: evidence.value,
    });
  }
  task.approvalRecord = approvalRecord;
  this.pushEvent(task, 'info', '人工确认记录已保存。', {
    type: 'text',
    label: '确认记录',
    value: [
      `操作人：${approvalRecord.operator}`,
      approvalRecord.targetContact
        ? `微信联系人：${approvalRecord.targetContact}`
        : '',
      `目标确认：${approvalRecord.targetConfirmed ? '是' : '否'}`,
      `内容确认：${approvalRecord.contentConfirmed ? '是' : '否'}`,
      `当前窗口确认：${approvalRecord.currentWindowConfirmed ? '是' : '否'}`,
      approvalRecord.contactConfirmed !== undefined
        ? `联系人确认：${approvalRecord.contactConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.draftBeforeFillConfirmed !== undefined
        ? `草稿填入前确认：${approvalRecord.draftBeforeFillConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.checklistConfirmed !== undefined
        ? `检查项确认：${approvalRecord.checklistConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.commercialPermissionConfirmed !== undefined
        ? `商用权限确认：${approvalRecord.commercialPermissionConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.misfireProtectionConfirmed !== undefined
        ? `误发误删保护确认：${approvalRecord.misfireProtectionConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.doubleConfirmationConfirmed !== undefined
        ? `高风险继续保护：${approvalRecord.doubleConfirmationConfirmed ? '是' : '否'}`
        : '',
      approvalRecord.note ? `备注：${approvalRecord.note}` : '',
    ]
      .filter(Boolean)
      .join('；'),
  });
  this.pushEvent(task, 'warning', '后端风控审批已记录。', {
    type: 'diagnostic_bundle',
    label: '后端风控审计',
    value: JSON.stringify(riskAudit, null, 2),
    stageKey: 'approval',
  });

  if (isDesktopInteractionTask(task.type)) {
    void this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
    void this.setTaskStep(
      task,
      'send-result',
      'running',
      '正在通过本机微信继续发送。',
    );
    const sendResult = await this.sendApprovedWechatTask(task).catch(
      (error): ApprovedWechatTaskResult => {
        const desktopError = toWechatDesktopCommandError(error);
        const message =
          error instanceof Error ? error.message : '本机微信发送失败';
        return {
          ok: false,
          status:
            desktopError?.result.status === 'blocked'
              ? 'blocked'
              : desktopError && isWechatNoTargetMessage(message)
                ? 'no_target'
                : undefined,
          message,
          nextAction: desktopError?.result.nextAction,
          screenshotPath: desktopError?.result.screenshotPath,
          results: desktopError
            ? [
                {
                  target: task.targetName,
                  ok: false,
                  message,
                  screenshotPath: desktopError.result.screenshotPath,
                  result: desktopError.result,
                },
              ]
            : undefined,
        };
      },
    );
    if (sendResult.ok) {
      if (sendResult.sourceText) {
        task.sourceText = sendResult.sourceText;
      }
      if (sendResult.replyText) {
        task.replyText = sendResult.replyText;
      }
      if (sendResult.replyGeneratedBy) {
        task.replyGeneratedBy = sendResult.replyGeneratedBy;
      }
      const evidenceValue =
        sendResult.readbackText ||
        (sendResult.results?.length
          ? JSON.stringify(sendResult.results, null, 2)
          : sendResult.screenshotPath || sendResult.message);
      const sentEvent = this.pushEvent(
        task,
        'success',
        sendResult.readbackText
          ? `${sendResult.message}；回读确认：${sendResult.readbackText}`
          : sendResult.message,
        {
          type: 'desktop_screenshot',
          label: '微信发送结果',
          value: evidenceValue,
          artifactUrl: sendResult.screenshotPath,
          stageKey: 'send-result',
        },
      );
      const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
        sentEvent.id,
      ]);
      const completedTargetCount = this.markBatchTargetsByNames(
        task,
        sendResult.completedTargets || [],
        'completed',
        sendResult.message,
        {
          nextAction: '发送完成，可在任务证据里查看结果。',
          evidenceEventIds,
        },
      );
      const failedTargetCount = (sendResult.failedTargets || []).reduce(
        (count, target) =>
          count +
          this.markBatchTargetsByNames(
            task,
            [target.targetName],
            'failed',
            target.reason || sendResult.message,
            {
              nextAction:
                target.reason || '请检查桌面微信目标、权限和执行脚本后重试。',
              evidenceEventIds,
            },
          ),
        0,
      );
      const hasExplicitPendingTargets = Array.isArray(
        sendResult.pendingTargets,
      );
      const skippedTargetCount = this.markBatchTargetsByNames(
        task,
        hasExplicitPendingTargets ? sendResult.skippedTargets || [] : [],
        'skipped',
        '已按计划规则跳过本次执行。',
        {
          nextAction: '该对象已跳过，不会在本计划内自动继续执行。',
          evidenceEventIds,
        },
      );
      const queuedTargetCount = this.markBatchTargetsByNames(
        task,
        hasExplicitPendingTargets
          ? sendResult.pendingTargets || []
          : sendResult.skippedTargets || [],
        'queued',
        '已达到本次执行上限，等待下一批继续。',
        {
          nextAction: '本次达到上限，点击继续下一批可处理剩余对象。',
          evidenceEventIds,
        },
      );
      if (
        completedTargetCount +
          failedTargetCount +
          skippedTargetCount +
          queuedTargetCount ===
        0
      ) {
        this.markBatchTargetsForApprovalOutcome(
          task,
          'completed',
          sendResult.message,
          {
            nextAction: '发送完成，可在任务证据里查看结果。',
            evidenceEventIds,
          },
        );
      }
      void this.setTaskStep(
        task,
        'send-result',
        'completed',
        sendResult.readbackText
          ? `${sendResult.message}；回读确认：${sendResult.readbackText}`
          : sendResult.message,
      );
      const hasRemainingTargets =
        queuedTargetCount > 0 || failedTargetCount > 0;
      this.updateTask(task, 'completed', sendResult.message, {
        nextAction: hasRemainingTargets
          ? `本次已完成 ${completedTargetCount} 个对象，失败 ${failedTargetCount} 个对象，跳过 ${skippedTargetCount} 个对象，还有 ${queuedTargetCount} 个对象待继续。`
          : '发送完成，可在任务证据里查看结果。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    if (sendResult.status === 'no_target') {
      void this.setTaskStep(
        task,
        'target-read',
        'completed',
        '本机微信已搜索目标，但目标不可添加或已是联系人。',
      );
      void this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
      const noTargetEvent = this.pushEvent(
        task,
        'warning',
        sendResult.message,
        {
          type: 'desktop_screenshot',
          label: '微信加好友无可添加对象',
          value: sendResult.screenshotPath || sendResult.message,
          artifactUrl: sendResult.screenshotPath,
          stageKey: 'send-result',
        },
      );
      this.markBatchTargetsForApprovalOutcome(
        task,
        'no_target',
        sendResult.message,
        {
          nextAction:
            '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            noTargetEvent.id,
          ]),
        },
      );
      this.updateTask(task, 'no_target', sendResult.message, {
        failureReason: undefined,
        nextAction:
          '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    if (sendResult.status === 'blocked') {
      const nextAction =
        sendResult.nextAction ||
        '接入对应 Windows 微信 native command 后重新执行。';
      const failureEvent = this.pushEvent(task, 'error', sendResult.message, {
        type: 'failure_reason',
        label: '微信 native command blocked',
        value: JSON.stringify(
          {
            message: sendResult.message,
            errorCode: 'not_integrated',
            nextAction,
            result: sendResult.results?.[0]?.result,
          },
          null,
          2,
        ),
        stageKey: 'send-result',
      });
      this.markBatchTargetsForApprovalOutcome(
        task,
        'failed',
        sendResult.message,
        {
          nextAction,
          evidenceEventIds: [failureEvent.id],
        },
      );
      void this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
      this.updateTask(task, 'failed', sendResult.message, {
        failureReason: sendResult.message,
        nextAction,
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    const failureEvent = this.pushEvent(task, 'error', sendResult.message, {
      type: 'failure_reason',
      label: '微信发送失败',
      value: sendResult.message,
      stageKey: 'send-result',
    });
    this.markBatchTargetsForApprovalOutcome(
      task,
      'failed',
      sendResult.message,
      {
        nextAction: '请检查微信窗口、联系人和发送权限后重试。',
        evidenceEventIds: [failureEvent.id],
      },
    );
    void this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
    this.updateTask(task, 'failed', sendResult.message, {
      failureReason: sendResult.message,
      nextAction: '请检查微信窗口、联系人和发送权限后重试。',
      completedAt: new Date().toISOString(),
    });
    return task;
  }

  if (task.executionMode === 'browser-assisted') {
    const contract = await this.resolveExecutionContract(task);
    if (!contract) {
      return task;
    }
    if (!contract.ok) {
      this.blockTaskForExecutionContract(task, contract);
      await this.persistTask(task);
      return task;
    }

    void this.setTaskStep(
      task,
      'send-approval',
      'completed',
      '人工确认通过，开始填入平台草稿。',
    );
    void this.setTaskStep(
      task,
      'send-result',
      'running',
      '正在打开本机浏览器执行真实发送。',
    );
    const sendResult = await this.sendApprovedBrowserReplyViaRuntime(task);
    if (sendResult.ok) {
      this.applyInteractionDraftResult(task, sendResult);
      if (sendResult.runtimeMode) {
        task.runtimeMode = sendResult.runtimeMode;
      }
      void this.setTaskStep(
        task,
        'send-result',
        'completed',
        '回复已通过真实执行器发送并完成回读。',
      );
      const draftEvent = this.pushEvent(
        task,
        'success',
        sendResult.message,
        sendResult.evidence,
      );
      const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
        draftEvent.id,
      ]);
      const completedTargetCount = this.markBatchTargetsByNames(
        task,
        sendResult.completedTargets || [],
        'completed',
        sendResult.message,
        {
          nextAction:
            sendResult.nextAction ||
            '已完成，可在任务证据里查看发送和回读结果。',
          evidenceEventIds,
        },
      );
      const failedTargetCount = (sendResult.failedTargets || []).reduce(
        (count, target) =>
          count +
          this.markBatchTargetsByNames(
            task,
            [target.targetName],
            'failed',
            target.reason || sendResult.message,
            {
              nextAction:
                target.reason ||
                sendResult.nextAction ||
                '请检查桌面微信目标、权限和执行脚本后重试。',
              evidenceEventIds,
            },
          ),
        0,
      );
      const queuedTargetCount = this.markBatchTargetsByNames(
        task,
        sendResult.skippedTargets || [],
        'queued',
        '等待继续执行。',
        {
          nextAction:
            sendResult.nextAction ||
            '本次达到上限，点击继续下一批可处理剩余对象。',
          evidenceEventIds,
        },
      );
      if (completedTargetCount + failedTargetCount + queuedTargetCount === 0) {
        this.markBatchTargetsForApprovalOutcome(
          task,
          'completed',
          sendResult.message,
          {
            nextAction:
              sendResult.nextAction ||
              '已完成，可在任务证据里查看发送和回读结果。',
            evidenceEventIds,
          },
        );
      }
      this.updateTask(task, 'completed', sendResult.message, {
        nextAction:
          sendResult.nextAction || '已完成，可在任务证据里查看发送和回读结果。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    if (
      ['comment_missing', 'message_missing', 'no_target'].includes(
        sendResult.status,
      )
    ) {
      void this.setTaskStep(
        task,
        'target-read',
        'completed',
        '真实平台已读取，但目标对象不存在或已处理。',
      );
      void this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
      const noTargetEvent = this.pushEvent(
        task,
        'warning',
        sendResult.message,
        sendResult.evidence,
      );
      this.markBatchTargetsForApprovalOutcome(
        task,
        'no_target',
        sendResult.message,
        {
          nextAction:
            sendResult.nextAction ||
            '目标已不存在或已处理；等平台出现新对象后重试。',
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            noTargetEvent.id,
          ]),
        },
      );
      this.updateTask(task, 'no_target', sendResult.message, {
        failureReason: undefined,
        nextAction:
          sendResult.nextAction ||
          '目标已不存在或已处理；等平台出现新对象后重试。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    void this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
    const draftFailureEvent = this.pushEvent(
      task,
      'error',
      sendResult.message,
      sendResult.evidence,
    );
    const failureReasonEvent = this.pushEvent(
      task,
      'error',
      sendResult.message,
      {
        type: 'failure_reason',
        label: '失败原因',
        value: sendResult.message,
        stageKey: 'send-result',
      },
    );
    this.markBatchTargetsForApprovalOutcome(
      task,
      'failed',
      sendResult.message,
      {
        nextAction: sendResult.nextAction,
        evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
          draftFailureEvent.id,
          failureReasonEvent.id,
        ]),
      },
    );
    this.updateTask(task, 'failed', sendResult.message, {
      failureReason: sendResult.message,
      nextAction: sendResult.nextAction,
      completedAt: new Date().toISOString(),
    });
    return task;
  }

  void this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
  void this.setTaskStep(task, 'send-result', 'completed', '发送结果已回写。');
  const resultEvent = this.pushEvent(
    task,
    'success',
    '执行保护通过，结果已回写。',
    {
      type: 'text',
      label: '发送结果',
      value: `${task.accountName} -> ${task.targetName}`,
    },
  );
  this.markBatchTargetsForApprovalOutcome(
    task,
    'completed',
    '内部记录已人工确认完成',
    {
      nextAction: '任务已完成，可在回复记录中查看证据。',
      evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
        resultEvent.id,
      ]),
    },
  );
  this.updateTask(task, 'completed', '已人工确认，内部记录已完成。', {
    nextAction: '任务已完成，可在回复记录中查看证据。',
    completedAt: new Date().toISOString(),
  });

  return task;
}

export async function skipTask(
  this: TaskOperationHost,
  id: string,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  if (
    ![
      'running',
      'waiting_for_send_confirmation',
      'queued',
      'paused',
      'blocked',
      'failed',
    ].includes(task.status)
  ) {
    return task;
  }

  const skipEvent = this.pushEvent(task, 'warning', '用户跳过本次发送。', {
    type: 'stage_log',
    label: '跳过记录',
    value: 'operator skipped the remaining interaction targets',
    stageKey: 'send-result',
  });
  this.markUnfinishedBatchTargets(task, 'skipped', '用户跳过本次发送', {
    nextAction: '任务已跳过；如需继续，请创建重试任务。',
    evidenceEventIds: [skipEvent.id],
  });
  void this.setTaskStep(task, 'send-approval', 'skipped', '用户跳过本次发送。');
  void this.setTaskStep(task, 'send-result', 'skipped', '任务已跳过。');
  this.updateTask(task, 'skipped', '用户跳过本次发送。', {
    nextAction:
      '任务已跳过，可在执行记录查看跳过原因和证据；需要继续时可创建重试任务。',
    completedAt: new Date().toISOString(),
  });

  return task;
}

export async function pauseTask(
  this: TaskOperationHost,
  id: string,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  if (
    !['queued', 'running', 'waiting_for_send_confirmation', 'blocked'].includes(
      task.status,
    )
  ) {
    return task;
  }

  const linkedAgentSessionId =
    optionalTrimmedText(task.metadata?.agentSessionId) ||
    optionalTrimmedText(task.metadata?.agent_session_id);
  if (
    isDesktopInteractionTask(task.type) &&
    linkedAgentSessionId &&
    task.status === 'running'
  ) {
    if (!this.agentS) {
      throw new BadRequestException(
        '本机助手服务不可用，无法确认微信任务已经停止。',
      );
    }
    try {
      await this.agentS.cancelSession(linkedAgentSessionId);
    } catch (error) {
      throw new BadRequestException(
        `本机助手未确认停止，任务没有标记为暂停：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const pauseEvent = this.pushEvent(task, 'warning', '用户暂停批量互动任务。', {
    type: 'stage_log',
    label: '暂停记录',
    value: `paused from ${task.status}`,
    stageKey: 'pause',
  });
  this.markPausableBatchTargets(task, '任务暂停，未继续执行该对象。', {
    nextAction:
      '明确未开始的对象可恢复；已进入执行中的对象需先核对迟到回读，不能自动重发。',
    evidenceEventIds: [pauseEvent.id],
  });
  task.pausedFromStatus =
    task.status === 'paused' ? task.pausedFromStatus : task.status;
  task.pausedAt = new Date().toISOString();
  void this.setTaskStep(
    task,
    'send-result',
    'blocked',
    '任务已暂停，后端不会继续执行。',
  );
  this.updateTask(task, 'paused', '用户暂停批量互动任务。', {
    nextAction:
      '任务已暂停；恢复只会继续明确未开始的对象，执行中断点需先核对证据。',
  });

  return task;
}

export async function continueTask(
  this: TaskOperationHost,
  id: string,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  const remainingTargets = this.getContinuableBatchTargets(task);
  if (!['paused', 'blocked', 'completed'].includes(task.status)) {
    return task;
  }
  if (task.status === 'paused' && this.isLiveExecutorTask(task.type)) {
    throw new BadRequestException(
      '暂停后的微信真实执行必须先获取服务端一次性恢复确认，不能通过继续接口绕过。',
    );
  }
  if (task.status === 'completed' && !remainingTargets.length) {
    return task;
  }

  const retryTask = remainingTargets.length
    ? await this.createTask(this.buildContinueTaskInput(task, remainingTargets))
    : await this.retryTask(task.id);
  this.pushEvent(
    task,
    'info',
    remainingTargets.length
      ? `已继续下一批：${retryTask.id}，对象 ${remainingTargets.length} 个。`
      : `已继续为新任务：${retryTask.id}`,
  );
  this.pushEvent(
    retryTask,
    'info',
    remainingTargets.length
      ? `由任务 ${task.id} 的剩余对象继续创建。`
      : `由任务 ${task.id} 继续创建。`,
  );
  await this.persistTask(task);
  await this.persistTask(retryTask);
  return retryTask;
}

export async function getGroupBroadcastPlanDetails(
  this: TaskOperationHost,
  id: string,
): Promise<InteractionBatchTargetListResult> {
  const task = await this.getTaskForDisplay(id);
  this.assertGroupBroadcastTask(task);
  return {
    taskId: task.id,
    planName: task.planName,
    planStatus: task.planStatus,
    summary: task.batchSummary,
    items: task.batchTargets || [],
  };
}

export async function resendGroupBroadcastPlan(
  this: TaskOperationHost,
  id: string,
  input: ResendGroupBroadcastPlanInput = {},
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  this.assertGroupBroadcastTask(task);
  assertBackendRiskGate({
    action: 'interaction-approval',
    target: `wechat-group-broadcast-resend:${task.accountName}:${task.planName || task.id}`,
    riskLevel: task.riskLevel || 'high',
    requiresConfirmation: true,
    confirmation: input.riskConfirmation,
    reason: '批准微信群发计划重发；重发会重新进入真实微信执行链路。',
  });
  const batchTargets = this.buildResendGroupBroadcastTargets(task, input) || [];
  if (!batchTargets.length) {
    throw new BadRequestException('没有可重发的群发对象');
  }
  const firstTarget = batchTargets[0];
  const replyText =
    optionalTrimmedText(input.replyText) ||
    firstTarget.replyText ||
    task.replyText;
  const resendInput: CreateInteractionTaskInput = {
    type: 'wechat-group-broadcast',
    accountId: task.accountId,
    accountName: task.accountName,
    platformType: task.platformType,
    platformName: task.platformName,
    targetName:
      batchTargets
        .map((target) => target.targetName)
        .filter(Boolean)
        .slice(0, 3)
        .join('、') || task.targetName,
    sourceText:
      optionalTrimmedText(input.sourceText) ||
      firstTarget.sourceText ||
      task.sourceText,
    replyText,
    planName: input.planName || task.planName,
    planTime: input.planTime || task.planTime,
    dailyLimit: input.dailyLimit ?? task.dailyLimit,
    associatedWeChat: input.associatedWeChat || task.associatedWeChat,
    generateOnDemand: input.generateOnDemand ?? task.generateOnDemand,
    metadata: this.normalizeGroupBroadcastPlanMetadata({
      type: 'wechat-group-broadcast',
      metadata: {
        ...(task.metadata || {}),
        ...(input.metadata || {}),
        resendOfPlanId: task.id,
        retryOfTaskId: task.id,
      },
      planName: input.planName || task.planName,
      planTime: input.planTime || task.planTime,
      dailyLimit: input.dailyLimit ?? task.dailyLimit,
      associatedWeChat: input.associatedWeChat || task.associatedWeChat,
      generateOnDemand: input.generateOnDemand ?? task.generateOnDemand,
    }),
    sendMode: input.immediate ? 'auto-send' : input.sendMode || task.sendMode,
    commercialExecutionRequested:
      input.immediate === true ||
      task.safetyBoundary?.requestedCommercialExecution === true ||
      task.safetyBoundary?.commercialExecutionAllowed === true,
    callerCommercialAllowed:
      task.safetyBoundary?.commercialExecutionAllowed === true,
    batchTargets,
  };
  const resendTask = await this.createTask(resendInput);
  this.pushEvent(task, 'info', `已创建群发重发任务：${resendTask.id}`);
  this.pushEvent(resendTask, 'info', `由群发计划 ${task.id} 重发创建。`);
  await this.persistTask(task);
  await this.persistTask(resendTask);
  return resendTask;
}

export async function removeGroupBroadcastPlan(
  this: TaskOperationHost,
  id: string,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  this.assertGroupBroadcastTask(task);
  const now = new Date().toISOString();
  task.batchTargets = (task.batchTargets || []).map((target) =>
    target.status === 'completed' || target.status === 'no_target'
      ? target
      : {
          ...target,
          status: 'skipped',
          nextAction: '群发计划已移除，未继续执行该对象。',
          updatedAt: now,
        },
  );
  task.batchSummary = buildBatchSummary(task.batchTargets);
  this.updateTask(task, 'skipped', '群发计划已移除。', {
    planStatus: 'removed',
    nextAction: '计划已移除，保留历史明细和证据。',
    completedAt: now,
  });
  await this.persistTask(task);
  return task;
}

export function assertGroupBroadcastTask(
  this: TaskOperationHost,
  task: InteractionTask,
) {
  if (task.type !== 'wechat-group-broadcast') {
    throw new BadRequestException('该任务不是微信群发计划');
  }
}

export function buildResendGroupBroadcastTargets(
  this: TaskOperationHost,
  task: InteractionTask,
  input: ResendGroupBroadcastPlanInput,
): CreateInteractionTaskInput['batchTargets'] {
  if (Array.isArray(input.batchTargets) && input.batchTargets.length) {
    return input.batchTargets
      .map((target) => {
        const targetName = optionalTrimmedText(target.targetName);
        const sourceText =
          optionalTrimmedText(target.sourceText) ||
          optionalTrimmedText(input.sourceText) ||
          targetName ||
          task.sourceText;
        return {
          targetName,
          sourceText,
          replyText:
            optionalTrimmedText(target.replyText) ||
            optionalTrimmedText(input.replyText) ||
            task.replyText,
          sourceUrl: target.sourceUrl,
          profileUrl: target.profileUrl,
          commentTime: target.commentTime,
          videoTitle: target.videoTitle,
          videoUrl: target.videoUrl,
          engagementScore: target.engagementScore,
        };
      })
      .filter((target) => Boolean(target.sourceText));
  }

  const targetIds = new Set((input.targetIds || []).map(String));
  const targetNames = new Set(
    (input.targetNames || []).map((target) => target.trim()).filter(Boolean),
  );
  const hasExplicitTargets = targetIds.size > 0 || targetNames.size > 0;
  const sourceTargets = task.batchTargets?.length
    ? task.batchTargets
    : [
        {
          id: task.id,
          targetName: task.targetName,
          sourceText: task.sourceText,
          replyText: task.replyText,
          status: task.status === 'failed' ? 'failed' : 'queued',
        } as InteractionBatchTarget,
      ];
  return sourceTargets
    .filter((target) => {
      if (input.onlyFailed) return target.status === 'failed';
      if (input.onlyUnsent) return target.status === 'queued';
      if (hasExplicitTargets) {
        return (
          (targetIds.has(target.id) || targetNames.has(target.targetName)) &&
          (target.status === 'failed' || target.status === 'queued')
        );
      }
      return true;
    })
    .map((target) => ({
      targetName: target.targetName,
      sourceText:
        optionalTrimmedText(input.sourceText) ||
        target.sourceText ||
        target.targetName,
      replyText:
        optionalTrimmedText(input.replyText) ||
        target.replyText ||
        task.replyText,
      sourceUrl: target.sourceUrl,
      profileUrl: target.profileUrl,
      commentTime: target.commentTime,
      videoTitle: target.videoTitle,
      videoUrl: target.videoUrl,
      engagementScore: target.engagementScore,
    }));
}

export function getContinuableBatchTargets(
  this: TaskOperationHost,
  task: InteractionTask,
) {
  if (!task.batchTargets?.length) {
    return [];
  }
  return task.batchTargets.filter((target) => target.status === 'queued');
}

export function buildContinueTaskInput(
  this: TaskOperationHost,
  task: InteractionTask,
  targets: InteractionBatchTarget[],
): CreateInteractionTaskInput {
  const firstTarget = targets[0];
  return {
    type: task.type,
    accountId: task.accountId,
    accountName: task.accountName,
    platformType: task.platformType,
    platformName: task.platformName,
    targetName:
      targets
        .map((target) => target.targetName)
        .filter(Boolean)
        .slice(0, 3)
        .join('、') || task.targetName,
    sourceText: firstTarget?.sourceText || task.sourceText,
    replyText: firstTarget?.replyText || task.replyText,
    sourceUrl: firstTarget?.sourceUrl || task.sourceUrl,
    profileUrl: firstTarget?.profileUrl || task.profileUrl,
    commentTime: firstTarget?.commentTime || task.commentTime,
    videoTitle: firstTarget?.videoTitle || task.videoTitle,
    videoUrl: firstTarget?.videoUrl || task.videoUrl,
    engagementScore: firstTarget?.engagementScore || task.engagementScore,
    planName: task.planName,
    planTime: task.planTime,
    planStatus: undefined,
    dailyLimit: task.dailyLimit,
    associatedWeChat: task.associatedWeChat,
    generateOnDemand: task.generateOnDemand,
    metadata: {
      ...(task.metadata || {}),
      continueOfTaskId: task.id,
    },
    sendMode: task.sendMode,
    commercialExecutionRequested:
      task.safetyBoundary?.requestedCommercialExecution === true,
    callerCommercialAllowed:
      task.safetyBoundary?.commercialExecutionAllowed === true,
    batchTargets: targets.map((target) => ({
      targetName: target.targetName,
      sourceText: target.sourceText,
      replyText: target.replyText,
      sourceUrl: target.sourceUrl,
      profileUrl: target.profileUrl,
      commentTime: target.commentTime,
      videoTitle: target.videoTitle,
      videoUrl: target.videoUrl,
      engagementScore: target.engagementScore,
    })),
  };
}

export async function resumeTask(
  this: TaskOperationHost,
  id: string,
  input: InteractionApprovalInput = {},
  riskContext?: BackendRiskContext,
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  if (task.status !== 'paused') {
    return task;
  }
  if (this.isLiveExecutorTask(task.type)) {
    void riskContext;
    const confirmationId = optionalTrimmedText(
      input.riskConfirmation?.confirmationId,
    );
    if (!confirmationId) {
      throw new BadRequestException(
        '恢复微信任务属于高风险操作，请先获取服务端一次性确认。',
      );
    }
    const issuedTarget = this.buildWechatResumeApprovalTarget(task);
    await this.requireRiskPolicyService().consumeHighRiskApproval(
      {
        confirmationId,
        action: WECHAT_RESUME_RISK_ACTION,
        riskLevel: 'high',
        target: issuedTarget,
      },
      this.riskApprovalActor(task),
    );
    const currentTask = await this.getTask(task.id);
    if (this.buildWechatResumeApprovalTarget(currentTask) !== issuedTarget) {
      throw new ConflictException(
        '任务或未完成对象在确认后发生变化，请重新核对并获取新的恢复确认。',
      );
    }
    const remainingTargets = this.getContinuableBatchTargets(task);
    if (!remainingTargets.length) {
      throw new BadRequestException(
        '当前没有可自动恢复的明确未开始对象；执行中断点请先核对迟到回读，再显式重试。',
      );
    }
    const resumedTask = await this.createTask(
      this.buildContinueTaskInput(task, remainingTargets),
    );
    this.pushEvent(task, 'info', `已确认恢复为新任务：${resumedTask.id}`);
    this.pushEvent(
      resumedTask,
      'info',
      `由暂停任务 ${task.id} 的未完成对象恢复创建。`,
    );
    await this.persistTask(task);
    await this.persistTask(resumedTask);
    return resumedTask;
  }

  const previousStatus = task.pausedFromStatus || 'running';
  task.pausedFromStatus = undefined;
  task.pausedAt = undefined;
  this.pushEvent(task, 'info', '任务已恢复执行。', {
    type: 'stage_log',
    label: '恢复记录',
    value: `resumed from paused to ${previousStatus}`,
    stageKey: 'resume',
  });
  void this.setTaskStep(
    task,
    'send-result',
    'running',
    '任务已恢复，继续真实执行未完成对象。',
  );
  this.updateTask(task, 'queued', '任务已从暂停恢复执行。', {
    nextAction: '本地引擎将重新领取任务并继续处理未完成对象。',
  });
  await this.persistTask(task);
  this.runInteractionTaskLifecycle(task.id);
  return task;
}

export async function createTaskResumeConfirmation(
  this: TaskOperationHost,
  id: string,
) {
  const task = await this.getTask(id);
  if (!this.isLiveExecutorTask(task.type) || task.status !== 'paused') {
    throw new BadRequestException(
      '只有已暂停的微信真实执行任务可以申请恢复确认。',
    );
  }
  if (!this.getContinuableBatchTargets(task).length) {
    throw new BadRequestException(
      '当前没有可自动恢复的明确未开始对象；请先核对执行中断点。',
    );
  }
  return this.requireRiskPolicyService().issueHighRiskApproval(
    {
      action: WECHAT_RESUME_RISK_ACTION,
      riskLevel: 'high',
      target: this.buildWechatResumeApprovalTarget(task),
      reason: `恢复微信任务 ${task.id} 的明确未开始对象`,
    },
    this.riskApprovalActor(task),
  );
}

export function requireRiskPolicyService(this: TaskOperationHost) {
  if (!this.riskPolicyService) {
    throw new InternalServerErrorException('高风险一次性确认服务未装配。');
  }
  return this.riskPolicyService;
}

export function riskApprovalActor(
  this: TaskOperationHost,
  task: InteractionTask,
) {
  const context = this.authRequestContext?.get();
  const sessionId = optionalTrimmedText(context?.sessionId);
  const userId = optionalTrimmedText(task.userId);
  const tenantId = optionalTrimmedText(task.tenantId);
  if (!sessionId || !userId || !tenantId || context?.user?.id !== userId) {
    throw new UnauthorizedException('当前登录会话不能确认该微信任务。');
  }
  return {
    tenantId,
    userId,
    sessionId,
    operator: userId,
  };
}

export function buildWechatResumeApprovalTarget(
  this: TaskOperationHost,
  task: InteractionTask,
) {
  const targets = (
    task.batchTargets?.length
      ? task.batchTargets
      : [
          {
            id: task.id,
            targetName: task.targetName,
            replyText: task.replyText,
            status: task.status,
          },
        ]
  )
    .filter((target) => target.status !== 'completed')
    .map((target) => ({
      id: target.id,
      targetName: target.targetName,
      status: target.status,
      replyHash: createHash('sha256')
        .update(target.replyText || '')
        .digest('hex'),
    }));
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        id: task.id,
        type: task.type,
        accountId: task.accountId || null,
        accountName: task.accountName,
        sendMode: task.sendMode,
        updatedAt: task.updatedAt,
        commercialExecutionAllowed:
          task.safetyBoundary?.commercialExecutionAllowed === true,
        commercialExecutionRequested:
          task.safetyBoundary?.requestedCommercialExecution === true,
        targets,
      }),
    )
    .digest('hex');
  return `wechat-resume:v1:${task.id}:${fingerprint}`;
}

export async function failTask(
  this: TaskOperationHost,
  id: string,
  reason = '用户停止任务',
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  const failureEvent = this.pushEvent(task, 'error', reason, {
    type: 'failure_reason',
    label: '失败原因',
    value: reason,
    stageKey: 'send-result',
  });
  this.markQueuedBatchTargets(task, 'failed', reason, {
    nextAction: '请检查本地能力状态后重试。',
    evidenceEventIds: [failureEvent.id],
  });
  void this.setTaskStep(task, 'send-result', 'blocked', reason);
  this.updateTask(task, 'failed', reason, {
    failureReason: reason,
    nextAction: '请检查本地能力状态后重试。',
    completedAt: new Date().toISOString(),
  });

  return task;
}

export async function retryTask(
  this: TaskOperationHost,
  id: string,
  input: RetryInteractionTaskInput = {},
): Promise<InteractionTask> {
  const task = await this.getTask(id);
  const targetIds = new Set((input.targetIds || []).map(String));
  const hasTargetFilter = targetIds.size > 0;
  const hasSelectedRetryTarget = task.batchTargets?.some(
    (target) =>
      targetIds.has(target.id) &&
      (target.status === 'failed' || target.status === 'queued'),
  );
  if (
    !['failed', 'blocked', 'skipped', 'paused'].includes(task.status) &&
    !(task.status === 'completed' && hasTargetFilter && hasSelectedRetryTarget)
  ) {
    throw new BadRequestException(
      '只有失败、阻断、暂停、已跳过，或仍有失败/未发送对象的已完成任务可以重试',
    );
  }

  const retryTargets = task.batchTargets?.length
    ? task.batchTargets.filter((target) => {
        if (input.onlyFailed) return target.status === 'failed';
        if (input.onlyUnsent) return target.status === 'queued';
        if (hasTargetFilter) {
          return (
            targetIds.has(target.id) &&
            (target.status === 'failed' || target.status === 'queued')
          );
        }
        return target.status === 'failed' || target.status === 'queued';
      })
    : undefined;
  if (task.batchTargets?.length && !retryTargets?.length) {
    throw new BadRequestException('没有失败或明确未发送的对象可重试');
  }

  const retryInput: CreateInteractionTaskInput = {
    type: task.type,
    accountId: task.accountId,
    accountName: task.accountName,
    platformType: task.platformType,
    platformName: task.platformName,
    targetName: task.targetName,
    sourceText: task.sourceText,
    replyText: task.replyText,
    sourceUrl: task.sourceUrl,
    profileUrl: task.profileUrl,
    commentTime: task.commentTime,
    videoTitle: task.videoTitle,
    videoUrl: task.videoUrl,
    engagementScore: task.engagementScore,
    planName: task.planName,
    planTime: task.planTime,
    dailyLimit: task.dailyLimit,
    associatedWeChat: task.associatedWeChat,
    generateOnDemand: task.generateOnDemand,
    metadata: {
      ...(task.metadata || {}),
      retryOfTaskId: task.id,
    },
    sendMode: task.sendMode,
    commercialExecutionRequested:
      task.safetyBoundary?.requestedCommercialExecution === true ||
      task.safetyBoundary?.commercialExecutionAllowed === true,
    callerCommercialAllowed:
      task.safetyBoundary?.commercialExecutionAllowed === true,
    batchTargets: retryTargets?.length
      ? retryTargets.map((target) => ({
          targetName: target.targetName,
          sourceText: target.sourceText,
          replyText: target.replyText,
          sourceUrl: target.sourceUrl,
          profileUrl: target.profileUrl,
          commentTime: target.commentTime,
          videoTitle: target.videoTitle,
          videoUrl: target.videoUrl,
          engagementScore: target.engagementScore,
        }))
      : undefined,
  };
  const retryTask = await this.createTask(retryInput);
  this.pushEvent(task, 'info', `已创建重试任务：${retryTask.id}`);
  this.pushEvent(retryTask, 'info', `由任务 ${task.id} 重试创建。`);
  await this.persistTask(task);
  await this.persistTask(retryTask);

  return retryTask;
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const taskOperationMethods = {
  createTask,
  resolveFutureWechatPlanTime,
  approveTask,
  skipTask,
  pauseTask,
  continueTask,
  getGroupBroadcastPlanDetails,
  resendGroupBroadcastPlan,
  removeGroupBroadcastPlan,
  assertGroupBroadcastTask,
  buildResendGroupBroadcastTargets,
  getContinuableBatchTargets,
  buildContinueTaskInput,
  resumeTask,
  createTaskResumeConfirmation,
  requireRiskPolicyService,
  riskApprovalActor,
  buildWechatResumeApprovalTarget,
  failTask,
  retryTask,
};
