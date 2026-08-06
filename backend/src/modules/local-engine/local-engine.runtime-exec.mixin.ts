// local-engine runtime 执行簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 RuntimeExecHost 接口：
// runtimeOrchestrator/browserControl 字段 + task-evidence/batch-targets/execution/desktop-status 簇方法。

import type { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type { ExecutorContext } from '../runtime/executor.interface';
import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from '../runtime/orchestrator/interaction-task-runtime.mapper';
import type {
  InteractionExecutorDraftResult,
  InteractionTask,
  InteractionTaskBillingIdentity,
  InteractionTaskDiagnosticExportResult,
  InteractionTaskEvent,
  InteractionTaskStatus,
  InteractionTaskStepStatus,
  InteractionTaskType,
} from './local-engine.types';
import type {
  TaskEvidenceIndex,
  TaskEvidenceIntegrity,
  TaskEvidenceReplayItem,
} from './local-engine.task-evidence.mixin';
import {
  buildAutoSendReadbackMessage,
  buildBatchSummary,
  buildTaskFailureAnalysis,
  isDesktopInteractionTask,
  isPlaceholderInteractionText,
} from './local-engine.utils';

/** runtime 执行簇的 host 接口：簇方法访问的 service 成员 */
export interface RuntimeExecHost {
  runtimeOrchestrator: RuntimeOrchestrator;
  browserControl?: BrowserControlService;
  getTask(id: string): Promise<InteractionTask>;
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
  blockTaskForExecutionContract(
    task: InteractionTask,
    contract: {
      ok: false;
      failureReason?: string;
      stageKey?: string;
      nextAction?: string;
    },
  ): Promise<boolean>;
  ensureTaskEvidenceForExport(
    task: InteractionTask,
    stageKey: string,
  ): Promise<void>;
  buildTaskEvidenceIndex(task: InteractionTask): TaskEvidenceIndex;
  buildTaskEvidenceIntegrity(
    task: InteractionTask,
    evidenceIndex?: TaskEvidenceIndex,
  ): TaskEvidenceIntegrity;
  buildTaskEvidenceReplay(task: InteractionTask): TaskEvidenceReplayItem[];
  collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds?: string[],
  ): string[];
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): InteractionTaskEvent;
  updateTask(
    task: InteractionTask,
    status: InteractionTaskStatus,
    eventMessage: string,
    patch?: Partial<InteractionTask>,
  ): void;
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ): void;
  persistTask(task: InteractionTask): Promise<void>;
  getReadiness(): Promise<unknown>;
  getRuntimeStatus(): Promise<unknown>;
  normalizeInteractionTaskBillingIdentity(
    value: unknown,
  ): InteractionTaskBillingIdentity | undefined;
  completeQueuedBatchTargets(
    task: InteractionTask,
    metadata?: Record<string, unknown>,
  ): number;
  markBatchTargetsByNames(
    task: InteractionTask,
    targetNames: string[],
    status: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): number;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: string,
    reason?: string,
    metadata?: Record<string, unknown>,
  ): number;
  withTaskBillingContext(
    task: InteractionTask,
    ctx: ExecutorContext,
    scope: string,
  ): ExecutorContext;
  autoSendReplyViaRuntime(
    task: InteractionTask,
  ): Promise<InteractionExecutorDraftResult>;
  applyInteractionDraftResult(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
  ): void;
  applyRuntimeBatchTargetResults(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
    evidenceEventIds: string[],
  ): boolean;
  toRuntimeInteractionTaskType(
    type: InteractionTaskType,
  ): 'comment-reply' | 'direct-message-reply' | undefined;
}

export async function exportTaskDiagnostics(
  this: RuntimeExecHost,
  id: string,
): Promise<InteractionTaskDiagnosticExportResult> {
  const task = await this.getTask(id);
  const exportedAt = new Date().toISOString();
  await this.ensureTaskEvidenceForExport(task, 'diagnostics-export');
  const evidenceIndex = this.buildTaskEvidenceIndex(task);
  const evidenceIntegrity = this.buildTaskEvidenceIntegrity(
    task,
    evidenceIndex,
  );
  const exportStatus = evidenceIntegrity.status;
  const runtime = await this.getRuntimeStatus().catch((error) => ({
    error: error instanceof Error ? error.message : '运行状态读取失败',
  }));
  const readiness = await this.getReadiness().catch((error) => ({
    error: error instanceof Error ? error.message : '权限检查读取失败',
  }));
  const payload = {
    exportedAt,
    exportStatus,
    integrity: evidenceIntegrity,
    task: {
      id: task.id,
      type: task.type,
      typeLabel: task.typeLabel,
      status: task.status,
      statusLabel: task.statusLabel,
      accountId: task.accountId,
      accountName: task.accountName,
      platformType: task.platformType,
      platformName: task.platformName,
      targetName: task.targetName,
      sourceText: task.sourceText,
      replyText: task.replyText,
      sendMode: task.sendMode,
      requestedSendMode: task.requestedSendMode,
      riskLevel: task.riskLevel,
      requiresDoubleConfirmation: task.requiresDoubleConfirmation,
      safetyBoundary: task.safetyBoundary,
      misfireProtection: task.misfireProtection,
      riskPolicy: task.riskPolicy,
      riskChecklist: task.riskChecklist,
      executionMode: task.executionMode,
      runtimeState: task.runtimeState,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      failureReason: task.failureReason,
      failureContext: task.failureContext,
      blockers: task.blockers,
      nextAction: task.nextAction,
      pausedFromStatus: task.pausedFromStatus,
      pausedAt: task.pausedAt,
      diagnostics: task.diagnostics,
      steps: task.steps || [],
      batchSummary: task.batchSummary,
      batchTargets: task.batchTargets || [],
      approvalRecord: task.approvalRecord,
      events: task.events,
      evidence: task.events
        .filter((event) => Boolean(event.evidence))
        .map((event) => ({
          eventId: event.id,
          level: event.level,
          message: event.message,
          createdAt: event.createdAt,
          evidence: event.evidence,
        })),
      evidenceIndex,
      evidenceReplay: this.buildTaskEvidenceReplay(task),
      failureAnalysis: buildTaskFailureAnalysis(task),
    },
    runtime,
    readiness,
    supportHint:
      '试用期排查请优先查看 task.diagnostics、task.steps、task.events、task.evidenceReplay、task.failureAnalysis 和权限风控字段。',
  };

  return {
    filename: `interaction-task-${task.id}-diagnostics-${exportedAt.slice(0, 10)}.json`,
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(payload, null, 2),
    exportedAt,
    exportStatus,
  };
}

export async function preflightDesktopInteractionTask(
  this: RuntimeExecHost,
  task: InteractionTask,
) {
  const contract = await this.resolveExecutionContract(task);
  if (!contract) {
    return;
  }
  if (!contract.ok) {
    await this.blockTaskForExecutionContract(task, contract);
    await this.persistTask(task);
    return;
  }

  this.setTaskStep(task, 'environment', 'completed', '基础执行环境检查完成。');
  this.setTaskStep(
    task,
    'account-entry',
    'completed',
    '桌面微信执行不需要平台账号，已进入本机微信执行。',
  );
  this.setTaskStep(
    task,
    'target-read',
    'completed',
    `已锁定桌面微信目标：${task.targetName}`,
  );
  this.setTaskStep(
    task,
    'reply-generate',
    'completed',
    '回复/发布内容已生成并准备执行。',
  );

  if (task.sendMode === 'auto-send') {
    this.setTaskStep(
      task,
      'send-approval',
      'skipped',
      '自动发送模式跳过人工确认。',
    );
    this.setTaskStep(
      task,
      'send-result',
      'running',
      '正在调用桌面微信自动发送执行器。',
    );
    const sendResult = await this.autoSendReplyViaRuntime(task);
    if (sendResult.ok) {
      this.applyInteractionDraftResult(task, sendResult);
      task.failureReason = undefined;
      const readbackMessage = buildAutoSendReadbackMessage(sendResult);
      this.setTaskStep(task, 'send-result', 'completed', readbackMessage);
      const sendEvent = this.pushEvent(
        task,
        'success',
        `${sendResult.message}；${readbackMessage}`,
        sendResult.evidence,
      );
      const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
        sendEvent.id,
      ]);
      if (
        !this.applyRuntimeBatchTargetResults(task, sendResult, evidenceEventIds)
      ) {
        this.completeQueuedBatchTargets(task, {
          nextAction: sendResult.nextAction || '桌面微信动作已完成。',
          evidenceEventIds,
        });
      }
      this.updateTask(task, 'completed', sendResult.message, {
        nextAction: sendResult.nextAction || '桌面微信动作已完成。',
        completedAt: new Date().toISOString(),
      });
      await this.persistTask(task);
      return;
    }

    if (
      ['comment_missing', 'message_missing', 'no_target'].includes(
        sendResult.status,
      )
    ) {
      this.setTaskStep(
        task,
        'target-read',
        'completed',
        '本机微信已搜索目标，但目标不可添加或已是联系人。',
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'skipped',
        '目标不可添加，未生成或使用回复。',
      );
      this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
      const noTargetEvent = this.pushEvent(
        task,
        'warning',
        sendResult.message,
        sendResult.evidence,
      );
      this.markQueuedBatchTargets(task, 'no_target', sendResult.message, {
        nextAction:
          sendResult.nextAction ||
          '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
        evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
          noTargetEvent.id,
        ]),
      });
      this.updateTask(task, 'no_target', sendResult.message, {
        failureReason: undefined,
        nextAction:
          sendResult.nextAction ||
          '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
        completedAt: new Date().toISOString(),
      });
      await this.persistTask(task);
      return;
    }

    const sendFailureReason = sendResult.failureReason || sendResult.message;
    this.setTaskStep(task, 'send-result', 'blocked', sendFailureReason);
    const failureEvent = this.pushEvent(
      task,
      'error',
      sendFailureReason,
      sendResult.evidence,
    );
    const failureEvidenceEventIds = this.collectRecentEvidenceEventIds(task, [
      failureEvent.id,
    ]);
    if (
      !this.applyRuntimeBatchTargetResults(
        task,
        sendResult,
        failureEvidenceEventIds,
      )
    ) {
      this.markQueuedBatchTargets(task, 'failed', sendFailureReason, {
        nextAction:
          sendResult.nextAction || '请检查桌面微信目标、权限和执行脚本后重试。',
        evidenceEventIds: failureEvidenceEventIds,
      });
    }
    this.updateTask(task, 'failed', sendFailureReason, {
      failureReason: sendFailureReason,
      nextAction:
        sendResult.nextAction || '请检查桌面微信目标、权限和执行脚本后重试。',
      completedAt: new Date().toISOString(),
    });
    await this.persistTask(task);
    return;
  }

  this.setTaskStep(
    task,
    'send-approval',
    'running',
    '受控执行模式：目标、内容和当前窗口通过回读后继续写入桌面微信。',
  );
  const waitingEvent = this.pushEvent(
    task,
    'warning',
    `待继续微信动作：${task.replyText}`,
    {
      type: 'text',
      label: '待继续内容',
      value: task.replyText,
      stageKey: 'send-approval',
    },
  );
  this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
    nextAction: '请确认目标和内容后继续。',
    evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
      waitingEvent.id,
    ]),
  });
  this.updateTask(
    task,
    'waiting_for_send_confirmation',
    '已生成微信动作，等待继续执行。',
    {
      nextAction: '目标、内容和当前窗口通过回读后继续执行。',
    },
  );
  await this.persistTask(task);
}

export function withTaskBillingContext(
  this: RuntimeExecHost,
  task: InteractionTask,
  ctx: ExecutorContext,
  scope: string,
): ExecutorContext {
  const identity = this.normalizeInteractionTaskBillingIdentity(
    task.billingIdentity,
  );
  return {
    ...ctx,
    billing: {
      ...ctx.billing,
      scope: ctx.billing?.scope || scope,
      identity: ctx.billing?.identity || identity,
    },
  };
}

export async function autoSendReplyViaRuntime(
  this: RuntimeExecHost,
  task: InteractionTask,
) {
  if (!this.runtimeOrchestrator) {
    // P3-D4: LocalInteractionExecutorService 已删；fallback 不可达
    throw new Error(
      'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
    );
  }

  const runtimeInput = mapInteractionTaskToRuntimeInput(task);
  const result = await this.runtimeOrchestrator.execute(
    runtimeInput.task,
    this.withTaskBillingContext(task, runtimeInput.ctx, 'local-engine-task'),
  );
  return mapRuntimeResultToInteractionDraftResult(task, result);
}

export function applyInteractionDraftResult(
  this: RuntimeExecHost,
  task: InteractionTask,
  result: InteractionExecutorDraftResult,
) {
  const sourceText = (result.sourceText || result.targetText || '').trim();
  if (sourceText && !isPlaceholderInteractionText(sourceText)) {
    task.sourceText = sourceText;
  }
  const replyText = result.replyText?.trim();
  if (replyText) {
    task.replyText = replyText;
  }
  if (result.replyGeneratedBy) {
    task.replyGeneratedBy = result.replyGeneratedBy;
  }
  if (result.runtimeMode) {
    task.runtimeMode = result.runtimeMode;
  }
  if (result.readbackText?.trim()) {
    task.metadata = {
      ...(task.metadata || {}),
      lastReadbackText: result.readbackText.trim(),
    };
  }
  if (task.batchTargets?.length) {
    const updatedAt = new Date().toISOString();
    task.batchTargets = task.batchTargets.map((target, index) =>
      index === 0
        ? {
            ...target,
            sourceText: task.sourceText,
            replyText: task.replyText,
            updatedAt,
          }
        : target,
    );
    task.batchSummary = buildBatchSummary(task.batchTargets);
  }
}

export function applyRuntimeBatchTargetResults(
  this: RuntimeExecHost,
  task: InteractionTask,
  result: InteractionExecutorDraftResult,
  evidenceEventIds: string[],
) {
  let updated = 0;
  updated += this.markBatchTargetsByNames(
    task,
    result.completedTargets || [],
    'completed',
    undefined,
    {
      nextAction: '该对象已有真实执行结果和回读证据。',
      evidenceEventIds,
    },
  );
  for (const failed of result.failedTargets || []) {
    updated += this.markBatchTargetsByNames(
      task,
      [failed.targetName],
      'failed',
      failed.reason || result.failureReason || result.message,
      {
        nextAction: failed.reason || '核对该对象证据后再显式重试。',
        evidenceEventIds,
      },
    );
  }
  updated += this.markBatchTargetsByNames(
    task,
    result.skippedTargets || [],
    'skipped',
    '该对象按执行规则跳过。',
    {
      nextAction: '该对象已跳过，不会自动重发。',
      evidenceEventIds,
    },
  );
  updated += this.markBatchTargetsByNames(
    task,
    result.pendingTargets || [],
    'queued',
    undefined,
    {
      nextAction: '该对象尚未开始，可在后续批次继续。',
      evidenceEventIds,
    },
  );
  return updated > 0;
}

export async function sendApprovedBrowserReplyViaRuntime(
  this: RuntimeExecHost,
  task: InteractionTask,
) {
  if (!this.runtimeOrchestrator) {
    throw new Error(
      'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
    );
  }

  const runtimeTask = {
    ...task,
    sendMode: 'auto-send' as const,
  };
  const runtimeInput = mapInteractionTaskToRuntimeInput(runtimeTask);
  const result = await this.runtimeOrchestrator.execute(
    runtimeInput.task,
    this.withTaskBillingContext(
      task,
      runtimeInput.ctx,
      'local-engine-approved-task',
    ),
  );
  return mapRuntimeResultToInteractionDraftResult(runtimeTask, result);
}

export async function draftApprovedReplyViaRuntime(
  this: RuntimeExecHost,
  task: InteractionTask,
) {
  if (!this.runtimeOrchestrator) {
    // P3-D4: LocalInteractionExecutorService 已删；fallback 不可达
    throw new Error(
      'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
    );
  }

  const runtimeInput = mapInteractionTaskToRuntimeInput({
    ...task,
    sendMode: 'draft-only',
  });
  const result = await this.runtimeOrchestrator.execute(
    runtimeInput.task,
    this.withTaskBillingContext(
      task,
      runtimeInput.ctx,
      'local-engine-draft-task',
    ),
  );
  return mapRuntimeResultToInteractionDraftResult(
    { ...task, sendMode: 'draft-only' },
    result,
  );
}

export async function preflightBrowserTaskViaRuntime(
  this: RuntimeExecHost,
  task: InteractionTask,
) {
  if (!this.browserControl || isDesktopInteractionTask(task.type)) {
    return null;
  }

  const runtimeInput = mapInteractionTaskToRuntimeInput(task);
  if (runtimeInput.task.accountId == null) {
    return {
      ok: false,
      message: '浏览器互动任务必须选择有效账号。',
      blockers: ['missing accountId'],
      nextAction: '请先选择已登录的平台账号。',
    };
  }

  return this.browserControl.preflight(
    runtimeInput.task.platform,
    runtimeInput.task.accountId,
    this.toRuntimeInteractionTaskType(task.type),
  );
}

export function toRuntimeInteractionTaskType(
  this: RuntimeExecHost,
  type: InteractionTaskType,
): 'comment-reply' | 'direct-message-reply' | undefined {
  if (
    type === 'douyin-comment-reply' ||
    type === 'wechat-channel-comment-reply'
  ) {
    return 'comment-reply';
  }
  if (
    type === 'douyin-direct-message-reply' ||
    type === 'wechat-channel-direct-message-reply'
  ) {
    return 'direct-message-reply';
  }
  return undefined;
}

export const runtimeExecMethods = {
  exportTaskDiagnostics,
  preflightDesktopInteractionTask,
  withTaskBillingContext,
  autoSendReplyViaRuntime,
  applyInteractionDraftResult,
  applyRuntimeBatchTargetResults,
  sendApprovedBrowserReplyViaRuntime,
  draftApprovedReplyViaRuntime,
  preflightBrowserTaskViaRuntime,
  toRuntimeInteractionTaskType,
};
