/**
 * browser 辅助簇 mixin（浏览器辅助任务生命周期/预检/目标读取）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { mapInteractionTaskToRuntimeInput } from '../runtime/orchestrator/interaction-task-runtime.mapper';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type { ExecutorContext } from '../runtime/executor.interface';

import {
  buildBatchSummary,
  createId,
  hasNoInteractionTarget,
  isBrowserPlatformInteractionTask,
  isDesktopInteractionTask,
  isPlaceholderInteractionText,
  normalizeStringList,
  optionalTrimmedText,
  sanitizeInteractionFailureMessage,
} from './local-engine.utils';
import type {
  AgentConfirmation,
  BatchTargetMetadata,
  CustomerServiceReplyDecision,
  CustomerServiceReplyPlatform,
  InteractionBatchTarget,
  InteractionReplyGeneratedBy,
  InteractionReplyRuleConfig,
  InteractionTask,
  InteractionTaskEvent,
  InteractionTaskStatus,
  InteractionTaskStepStatus,
  InteractionTaskType,
} from './local-engine.types';

/** browser 辅助簇的 host 接口 */
export interface BrowserAssistHost {
  agentConfirmations: Map<string, AgentConfirmation>;
  autoUploadService: AutoUploadService;
  browserInteractionQueues: Map<string, Promise<void>>;
  runtimeOrchestrator?: RuntimeOrchestrator;
  tasks: Map<string, InteractionTask>;
  runInteractionTaskLifecycle(taskId: string);
  resolveCustomerServiceLifecycleDelayMs(task: InteractionTask): number;
  runBrowserAssistedTaskWithQueue(taskId: string): Promise<void>;
  resolveBrowserInteractionQueueKey(task: InteractionTask): string;
  processBatchTargetsWithRateLimit(
    taskId: string,
    processTarget: (
      task: InteractionTask,
      target: InteractionBatchTarget,
      index: number,
    ) => Promise<void>,
  );
  preflightBrowserAssistedTask(task: InteractionTask);
  ensureBrowserInteractionTarget(task: InteractionTask): Promise<boolean>;
  markPreparedBrowserInteractionSteps(task: InteractionTask);
  shouldReadRealInteractionTarget(task: InteractionTask): boolean;
  isRuntimeAccountEntryBlocker(reasonCode?: string): boolean;
  readBrowserInteractionCandidates(task: InteractionTask): Promise<{
    items: Array<Record<string, unknown>>;
    evidence?: string;
    emptyReason?: string;
    loadBlocked?: boolean;
  }>;
  normalizeInteractionReadResult(
    items: Array<Record<string, unknown>> | undefined,
    result: {
      summary?: { emptyReason?: string | null; loadBlocked?: boolean };
      evidence?: { path?: string; value?: string } | null;
    },
  ): {
    items: Array<Record<string, unknown>>;
    evidence?: string;
    emptyReason?: string;
    loadBlocked?: boolean;
  };
  pickReadableInteractionCandidate(
    items: Array<Record<string, unknown>>,
    task?: InteractionTask,
  ): {
    text: string;
    targetName?: string;
    sourceUrl?: string;
    profileUrl?: string;
    commentTime?: string;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
  } | null;
  cleanReadableInteractionText(
    value: string,
    type?: InteractionTaskType,
  ): string;
  autoSendReplyViaRuntime(task: InteractionTask);
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
  collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds?: string[],
  ): string[];
  completeQueuedBatchTargets(
    task: InteractionTask,
    metadata?: BatchTargetMetadata,
  ): number;
  createInteractionTaskConfirmation(task: InteractionTask): AgentConfirmation;
  generateInteractionReply(input: {
    sourceText?: string;
    targetName?: string;
    accountName?: string;
    botId?: string;
    platform?: CustomerServiceReplyPlatform;
    contactLabels?: string[];
  }): Promise<{
    replyText: string;
    generatedBy: 'ai' | 'fallback';
    rule: InteractionReplyRuleConfig;
    decision: CustomerServiceReplyDecision;
  }>;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  persistAgentConfirmation(confirmation: AgentConfirmation);
  persistTask(task: InteractionTask);
  preflightBrowserTaskViaRuntime(task: InteractionTask): Promise<{
    ok: boolean;
    message?: string;
    nextAction?: string;
    blockers?: string[];
  } | null>;
  preflightDesktopInteractionTask(task: InteractionTask);
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): InteractionTaskEvent;
  resolveCustomerReplyReviewReason(
    sourceText?: string | null,
  ): string | undefined;
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
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resolveTypeLabel(type: InteractionTaskType): string;
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  );
  updateTask(
    task: InteractionTask,
    status: InteractionTaskStatus,
    eventMessage: string,
    patch?: Partial<InteractionTask>,
  );
  withTaskBillingContext(
    task: InteractionTask,
    ctx: ExecutorContext,
    scope: string,
  ): ExecutorContext;
}

export function runInteractionTaskLifecycle(
  this: BrowserAssistHost,
  taskId: string,
) {
  const scheduledTask = this.tasks.get(taskId);
  const startDelayMs = scheduledTask
    ? this.resolveCustomerServiceLifecycleDelayMs(scheduledTask)
    : 0;
  setTimeout(() => {
    void (async () => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'queued') return;
      this.setTaskStep(
        task,
        'environment',
        'running',
        '正在检查 发布服务、平台账号和本地文件访问。',
      );
      this.pushEvent(task, 'info', '阶段日志：环境检查开始。', {
        type: 'stage_log',
        label: '环境检查日志',
        value: 'checking local engine, platform account and file access',
        stageKey: 'environment',
      });
      this.updateTask(
        task,
        'running',
        '本地引擎已领取任务，开始检查执行环境。',
        {
          nextAction: '检查平台登录态和目标对象。',
        },
      );
      this.pushEvent(
        task,
        'info',
        '浏览器控制、桌面控制和文件访问状态开始检查。',
      );
      if (task.executionMode === 'browser-assisted') {
        await this.persistTask(task);
        await this.runBrowserAssistedTaskWithQueue(task.id).catch(
          async (error) => {
            const message =
              error instanceof Error ? error.message : '真实执行预检失败';
            this.setTaskStep(task, 'send-result', 'blocked', message);
            this.updateTask(task, 'failed', message, {
              failureReason: message,
              nextAction: '请检查本地引擎、账号登录态和执行器日志后重试。',
              completedAt: new Date().toISOString(),
            });
            await this.persistTask(task);
          },
        );
      } else {
        this.setTaskStep(
          task,
          'account-entry',
          'skipped',
          '内部记录任务不需要打开平台账号后台。',
        );
      }
    })();
  }, 400 + startDelayMs);

  setTimeout(() => {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    if (task.executionMode === 'browser-assisted') {
      return;
    }
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    this.setTaskStep(
      task,
      'target-read',
      'running',
      '正在读取或定位目标对象。',
    );
    this.pushEvent(task, 'info', `已锁定目标对象：${task.targetName}`, {
      type: 'page_snapshot',
      label: '目标对象',
      value: task.targetName,
      stageKey: 'target-read',
    });
    this.pushEvent(task, 'info', `已读取原文：${task.sourceText}`, {
      type:
        task.type === 'wechat-reply-draft'
          ? 'desktop_screenshot'
          : 'page_snapshot',
      label: task.type === 'wechat-reply-draft' ? '桌面会话快照' : '页面快照',
      value: task.sourceText,
      stageKey: 'target-read',
    });
    if (task.batchTargets?.length) {
      this.pushEvent(
        task,
        'info',
        `批量读取完成：${task.batchTargets.length} 个对象。`,
      );
    }
    this.setTaskStep(
      task,
      'target-read',
      'completed',
      `已读取目标内容：${task.targetName}`,
    );
  }, 900 + startDelayMs);

  setTimeout(() => {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    if (task.executionMode === 'browser-assisted') return;

    if (task.type === 'customer-follow-up') {
      this.setTaskStep(task, 'reply-generate', 'completed', '跟进话术已生成。');
      this.pushEvent(task, 'info', '阶段日志：跟进话术已生成。', {
        type: 'stage_log',
        label: '生成日志',
        value: task.replyText,
        stageKey: 'reply-generate',
      });

      this.setTaskStep(
        task,
        'send-approval',
        'completed',
        task.followUpMethod === 'wechat' || task.followUpMethod === 'message'
          ? '客户跟进话术已生成，等待继续在微信/消息中处理。'
          : '客户跟进任务等待人工完成。',
      );
      this.pushEvent(
        task,
        'info',
        `客户跟进方式：${task.followUpMethod || '未指定'}，等待继续完成。`,
      );
      this.pushEvent(task, 'warning', `待继续跟进：${task.replyText}`, {
        type: 'text',
        label: '跟进话术',
        value: task.replyText,
        stageKey: 'send-approval',
      });
      this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
        nextAction: '请在人工完成跟进后手动标记任务完成。',
      });
      this.updateTask(
        task,
        'waiting_for_send_confirmation',
        '客户跟进任务等待继续完成。',
        {
          nextAction: '完成电话或线下跟进后，标记任务完成。',
        },
      );
      this.persistTask(task);
      return;
    }

    this.setTaskStep(task, 'reply-generate', 'running', '正在生成回复草稿。');
    this.setTaskStep(task, 'reply-generate', 'completed', '回复草稿已生成。');
    this.pushEvent(task, 'info', '阶段日志：回复草稿已生成。', {
      type: 'stage_log',
      label: '生成日志',
      value: task.replyText,
      stageKey: 'reply-generate',
    });

    if (hasNoInteractionTarget(task)) {
      this.setTaskStep(task, 'target-read', 'skipped', '没有可处理对象。');
      this.setTaskStep(
        task,
        'send-approval',
        'skipped',
        '无对象，不进入执行保护。',
      );
      this.setTaskStep(task, 'send-result', 'skipped', '任务以无对象结束。');
      const noTargetEvent = this.pushEvent(
        task,
        'warning',
        '无对象：本次没有可处理评论、私信、微信会话、群或客户。',
        {
          type: 'stage_log',
          label: '无对象',
          value: `${task.type} / ${task.targetName}`,
          stageKey: 'no-target',
        },
      );
      this.markQueuedBatchTargets(task, 'no_target', '无可处理对象', {
        nextAction:
          '无需处理；如对象来自外部列表，请补充客户、群或朋友圈素材后重新创建任务。',
        evidenceEventIds: [noTargetEvent.id],
      });
      this.updateTask(
        task,
        'no_target',
        '没有可处理对象，任务未执行发送或发布。',
        {
          failureReason: undefined,
          nextAction:
            '无需处理；如对象来自外部列表，请补充客户、群或朋友圈素材后重新创建任务。',
          completedAt: new Date().toISOString(),
        },
      );
      return;
    }

    if (task.sendMode === 'draft-only') {
      this.setTaskStep(
        task,
        'send-approval',
        'skipped',
        '仅生成内容，不进入受控执行。',
      );
      this.setTaskStep(task, 'send-result', 'completed', '草稿任务完成。');
      const completedEvent = this.pushEvent(
        task,
        'success',
        task.batchTargets && task.batchTargets.length > 1
          ? `批量草稿内容已生成 ${task.batchTargets.length} 条。`
          : `草稿内容：${task.replyText}`,
        {
          type: 'diagnostic_bundle',
          label: '草稿诊断摘要',
          value: `draft-only completed / targets=${task.batchTargets?.length || 1}`,
          stageKey: 'send-result',
        },
      );
      const completedCount = this.completeQueuedBatchTargets(task, {
        nextAction: '请在目标平台确认草稿。',
        evidenceEventIds: [completedEvent.id],
      });
      this.updateTask(
        task,
        'completed',
        completedCount > 1
          ? `批量草稿已生成 ${completedCount} 条，等待人工复制或发送。`
          : '草稿已生成，等待人工复制或发送。',
        {
          nextAction: '请在目标平台确认草稿。',
          completedAt: new Date().toISOString(),
        },
      );
      return;
    }

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
        'blocked',
        '自动发送缺少真实执行器。',
      );
      const blockedEvent = this.pushEvent(
        task,
        'error',
        task.batchTargets && task.batchTargets.length > 1
          ? `批量自动发送缺少真实执行器，已阻断 ${task.batchTargets.length} 条。`
          : `自动发送缺少真实执行器，已阻断：${task.replyText}`,
        {
          type: 'diagnostic_bundle',
          label: '自动发送诊断摘要',
          value: `auto-send blocked / targets=${task.batchTargets?.length || 1}`,
          stageKey: 'send-result',
        },
      );
      const failedCount = this.markQueuedBatchTargets(
        task,
        'failed',
        '自动发送缺少真实执行器',
        {
          nextAction:
            '请接入真实发送按钮点击、回读和失败识别能力，或切到受控发送。',
          evidenceEventIds: [blockedEvent.id],
        },
      );
      this.updateTask(
        task,
        'failed',
        failedCount > 1
          ? `批量自动发送缺少真实执行器，已阻断 ${failedCount} 条。`
          : '自动发送缺少真实执行器，任务已阻断。',
        {
          failureReason: '自动发送缺少真实执行器',
          nextAction:
            '请接入真实发送按钮点击、回读和失败识别能力，或切到确认后发送。',
          completedAt: new Date().toISOString(),
        },
      );
      return;
    }

    this.setTaskStep(
      task,
      'send-approval',
      'running',
      '已生成回复，等待继续执行。',
    );
    const waitingEvent = this.pushEvent(
      task,
      'warning',
      `待继续回复：${task.replyText}`,
      {
        type: 'text',
        label: '回复内容',
        value: task.replyText,
        stageKey: 'send-approval',
      },
    );
    this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
      nextAction: '条件通过后继续执行，或跳过/停止任务。',
      evidenceEventIds: [waitingEvent.id],
    });
    this.updateTask(
      task,
      'waiting_for_send_confirmation',
      '已生成回复，等待继续执行。',
      {
        nextAction: '条件通过后继续执行，或跳过/停止任务。',
      },
    );
  }, 1500 + startDelayMs);
}

export function resolveCustomerServiceLifecycleDelayMs(
  this: BrowserAssistHost,
  task: InteractionTask,
) {
  const value = optionalTrimmedText(task.metadata?.customerServiceNotBefore);
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.min(24 * 60 * 60 * 1000, Math.max(0, timestamp - Date.now()));
}

export async function runBrowserAssistedTaskWithQueue(
  this: BrowserAssistHost,
  taskId: string,
): Promise<void> {
  const task = this.tasks.get(taskId);
  if (!task || task.executionMode !== 'browser-assisted') return;

  const queueKey = this.resolveBrowserInteractionQueueKey(task);
  const previous = this.browserInteractionQueues.get(queueKey);

  if (previous) {
    task.status = 'running';
    task.statusLabel = this.resolveStatusLabel('running');
    this.setTaskStep(
      task,
      'account-entry',
      'running',
      '等待同平台账号前一个浏览器任务完成。',
    );
    task.nextAction = '同一平台账号的浏览器任务会串行执行，稍后自动继续。';
    task.updatedAt = new Date().toISOString();
    this.pushEvent(task, 'info', `同平台账号浏览器任务已排队：${queueKey}`, {
      type: 'stage_log',
      label: '浏览器任务串行队列',
      value: queueKey,
      stageKey: 'account-entry',
    });
    await this.persistTask(task);
  }

  const queued = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const currentTask = this.tasks.get(taskId);
      if (
        !currentTask ||
        !['queued', 'running'].includes(currentTask.status) ||
        currentTask.executionMode !== 'browser-assisted'
      ) {
        return;
      }

      if (currentTask.status === 'queued') {
        this.updateTask(
          currentTask,
          'running',
          '本地引擎已领取任务，开始检查执行环境。',
          {
            nextAction: '检查平台登录态和目标对象。',
          },
        );
      }

      if (isDesktopInteractionTask(currentTask.type)) {
        await this.preflightDesktopInteractionTask(currentTask);
      } else {
        await this.preflightBrowserAssistedTask(currentTask);
      }
    });

  this.browserInteractionQueues.set(queueKey, queued);
  queued
    .finally(() => {
      if (this.browserInteractionQueues.get(queueKey) === queued) {
        this.browserInteractionQueues.delete(queueKey);
      }
    })
    .catch(() => undefined);

  return queued;
}

export function resolveBrowserInteractionQueueKey(
  this: BrowserAssistHost,
  task: InteractionTask,
): string {
  const platform = task.type.startsWith('douyin')
    ? 'douyin'
    : task.type.startsWith('wechat-channel')
      ? 'wechat-channel'
      : task.type.startsWith('wechat')
        ? 'wechat-desktop'
        : task.platformName || 'browser';
  return `${platform}:${task.accountId || task.accountName || 'default'}`;
}

export function processBatchTargetsWithRateLimit(
  this: BrowserAssistHost,
  taskId: string,
  processTarget: (
    task: InteractionTask,
    target: InteractionBatchTarget,
    index: number,
  ) => Promise<void>,
) {
  const task = this.tasks.get(taskId);
  if (!task || !task.batchTargets?.length) return;

  const rateLimit = task.rateLimitPerMinute || 3;
  const delayMs = Math.floor(60000 / rateLimit);
  const targets = task.batchTargets;

  const processNext = (index: number) => {
    if (index >= targets.length) return;
    const currentTask = this.tasks.get(taskId);
    if (!currentTask || currentTask.status === 'paused') return;

    processTarget(currentTask, targets[index], index)
      .then(() => {
        if (index + 1 < targets.length) {
          setTimeout(() => processNext(index + 1), delayMs);
        }
      })
      .catch(() => {
        if (index + 1 < targets.length) {
          setTimeout(() => processNext(index + 1), delayMs);
        }
      });
  };

  processNext(0);
}

export async function preflightBrowserAssistedTask(
  this: BrowserAssistHost,
  task: InteractionTask,
) {
  const contract = await this.resolveExecutionContract(task);
  if (!contract) {
    return;
  }
  if (!contract.ok) {
    this.blockTaskForExecutionContract(task, contract);
    await this.persistTask(task);
    return;
  }

  const runtimePreflight = await this.preflightBrowserTaskViaRuntime(task);
  if (runtimePreflight && !runtimePreflight.ok) {
    this.blockTaskForExecutionContract(task, {
      ok: false,
      stageKey: 'account-entry',
      failureReason: runtimePreflight.message || '',
      nextAction:
        runtimePreflight.nextAction ||
        '请检查本地 Runtime 引擎、浏览器会话和账号登录状态后重试。',
      stepMessages: {
        accountEntry: runtimePreflight.message || '',
        targetRead: 'Runtime 前置预检未通过，不能读取目标对象。',
        replyGenerate: '未读取真实对象，不能生成回复。',
        sendApproval: '真实能力缺失，不能进入受控执行。',
        sendResult: '任务已在 Runtime 前置预检阶段阻断。',
      },
    });
    this.pushEvent(task, 'error', runtimePreflight.message || '', {
      type: 'failure_reason',
      label: 'Runtime 前置预检',
      value:
        (runtimePreflight.blockers ?? []).join('；') ||
        runtimePreflight.message ||
        '',
      stageKey: 'account-entry',
    });
    await this.persistTask(task);
    return;
  }

  const targetReady = await this.ensureBrowserInteractionTarget(task);
  if (!targetReady) {
    await this.persistTask(task);
    return;
  }
  this.markPreparedBrowserInteractionSteps(task);

  if (task.sendMode === 'approval-send') {
    const evidenceEventIds = this.collectRecentEvidenceEventIds(task);
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    this.setTaskStep(
      task,
      'account-entry',
      'completed',
      '平台账号后台已打开并通过登录态检查。',
    );
    this.setTaskStep(
      task,
      'send-approval',
      'running',
      '已读取真实对象并生成回复，等待继续执行。',
    );
    this.setTaskStep(
      task,
      'send-result',
      'pending',
      '条件通过后调用真实发送执行器。',
    );
    this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
      nextAction: '目标和回复内容通过回读后继续执行。',
      evidenceEventIds,
    });
    this.updateTask(
      task,
      'waiting_for_send_confirmation',
      `已识别真实${this.resolveTypeLabel(task.type)}对象，等待继续执行。`,
      {
        nextAction: `当前对象：${task.sourceText}；回复：${task.replyText}`,
      },
    );
    await this.persistTask(task);
    return;
  }

  // P3-D4 + 2026-06-04: 删旧 preflightTask 后, 现在直接调 RuntimeOrchestrator.execute()
  // 让 Runtime 路径 (playwright + platform services) 真实跑任务
  if (!this.runtimeOrchestrator) {
    this.setTaskStep(
      task,
      'send-result',
      'blocked',
      'RuntimeOrchestrator 未注入',
    );
    this.updateTask(task, 'failed', 'RuntimeOrchestrator 未注入', {
      failureReason: 'RuntimeOrchestrator 未注入',
      nextAction: '检查 LocalEngineModule 与 RuntimeModule 装配',
      completedAt: new Date().toISOString(),
    });
    await this.persistTask(task);
    return;
  }
  const runtimeInput = mapInteractionTaskToRuntimeInput(task);
  const result = await this.runtimeOrchestrator.execute(
    runtimeInput.task,
    this.withTaskBillingContext(task, runtimeInput.ctx, 'local-engine-task'),
  );
  const primaryRuntimeBlocker =
    !result.ok && result.blockers?.length
      ? optionalTrimmedText(result.blockers[0])
      : undefined;
  const runtimeMessageBase =
    result.userMessage ||
    result.technicalMessage ||
    (result.ok ? '执行完成' : '执行失败');
  const runtimeMessage =
    primaryRuntimeBlocker && !runtimeMessageBase.includes(primaryRuntimeBlocker)
      ? `${runtimeMessageBase} ${primaryRuntimeBlocker}`
      : runtimeMessageBase;
  const runtimeNextAction =
    result.technicalMessage ||
    primaryRuntimeBlocker ||
    (result.ok ? '已完成' : '请检查 dispatch 日志');
  const accountEntryBlocked =
    !result.ok && this.isRuntimeAccountEntryBlocker(result.reasonCode);
  if (result.runtime?.executor === 'browser-cdp') {
    task.runtimeMode = 'persistent-cdp-browser';
  }
  this.setTaskStep(task, 'environment', 'completed', '基础执行环境检查完成。');
  this.setTaskStep(
    task,
    'account-entry',
    accountEntryBlocked ? 'blocked' : 'completed',
    accountEntryBlocked
      ? runtimeMessage
      : '平台账号后台已打开并通过登录态检查。',
  );
  this.setTaskStep(
    task,
    'send-approval',
    result.ok
      ? task.sendMode === 'auto-send'
        ? 'skipped'
        : 'completed'
      : task.sendMode === 'auto-send'
        ? 'skipped'
        : 'blocked',
    result.ok
      ? task.sendMode === 'auto-send'
        ? '自动发送模式直接执行。'
        : '发送策略已通过。'
      : task.sendMode === 'auto-send'
        ? '自动发送模式直接执行。'
        : '执行失败，不能进入受控执行。',
  );
  this.setTaskStep(
    task,
    'send-result',
    result.ok ? 'completed' : 'blocked',
    runtimeMessage,
  );
  const runtimeEvidenceEventIds = result.evidence?.length
    ? result.evidence.map((evidence) => {
        const isDesktopScreenshotEvidence =
          evidence.type === 'screenshot' && isDesktopInteractionTask(task.type);
        return this.pushEvent(
          task,
          result.ok ? 'success' : 'error',
          evidence.label,
          {
            type: isDesktopScreenshotEvidence
              ? 'desktop_screenshot'
              : evidence.type === 'screenshot'
                ? 'screenshot'
                : evidence.type === 'readback'
                  ? 'text'
                  : 'text',
            label: evidence.label,
            value: evidence.value || evidence.path || evidence.label,
            artifactUrl: evidence.path,
            stageKey:
              evidence.type === 'readback' || isDesktopScreenshotEvidence
                ? 'send-result'
                : 'target-read',
          },
        ).id;
      })
    : [];
  const evidenceEventIds = this.collectRecentEvidenceEventIds(
    task,
    runtimeEvidenceEventIds,
  );
  if (result.ok) {
    if (result.readback?.actualText) {
      task.metadata = {
        ...(task.metadata || {}),
        lastReadbackText: result.readback.actualText,
      };
    }
    this.completeQueuedBatchTargets(task, {
      nextAction: runtimeNextAction,
      evidenceEventIds,
    });
  } else if (result.reasonCode === 'target_not_found') {
    this.setTaskStep(
      task,
      'target-read',
      'completed',
      '真实平台已读取，但目标对象不存在或已处理。',
    );
    this.setTaskStep(
      task,
      'reply-generate',
      'skipped',
      '目标不存在，未生成或使用回复。',
    );
    this.setTaskStep(
      task,
      'send-approval',
      'skipped',
      '目标不存在，不进入发送。',
    );
    this.setTaskStep(task, 'send-result', 'skipped', runtimeMessage);
    this.markQueuedBatchTargets(task, 'no_target', runtimeMessage, {
      nextAction:
        result.technicalMessage ||
        '目标已不存在或已处理；等平台出现新对象后重试。',
      evidenceEventIds,
    });
  } else {
    this.markQueuedBatchTargets(task, 'failed', runtimeMessage, {
      nextAction: runtimeNextAction,
      evidenceEventIds,
    });
  }
  const finalStatus = result.ok
    ? 'completed'
    : result.reasonCode === 'target_not_found'
      ? 'no_target'
      : 'failed';
  this.updateTask(task, finalStatus, runtimeMessage, {
    failureReason:
      result.ok || finalStatus === 'no_target' ? undefined : runtimeMessage,
    nextAction:
      finalStatus === 'no_target'
        ? result.technicalMessage ||
          '目标已不存在或已处理；等平台出现新对象后重试。'
        : runtimeNextAction,
    completedAt: new Date().toISOString(),
  });
  await this.persistTask(task);
  return;
  // DELETED:     const result = {
  // DELETED:       state: 'ready' as const,
  // DELETED:       blockers: [],
  // DELETED:     };
  // DELETED:     task.runtimeState = result.state;
  // DELETED:     if (result.failureReason) {
  // DELETED:       task.failureReason = result.failureReason;
  // DELETED:     }
  // DELETED:     if (result.nextAction) {
  // DELETED:       task.nextAction = result.nextAction;
  // DELETED:     }
  // DELETED:     if (result.targetText) {
  // DELETED:       task.sourceText = result.targetText;
  // DELETED:     }
  // DELETED:     if (result.replyText) {
  // DELETED:       task.replyText = result.replyText;
  // DELETED:     }
  // DELETED:     if (result.replyGeneratedBy) {
  // DELETED:       task.replyGeneratedBy = result.replyGeneratedBy;
  // DELETED:     }
  // DELETED:     const noTargetBySteps =
  // DELETED:       task.steps?.some(
  // DELETED:         (step) => step.key === 'target-read' && step.status === 'skipped',
  // DELETED:       ) &&
  // DELETED:       task.steps?.some(
  // DELETED:         (step) => step.key === 'reply-generate' && step.status === 'skipped',
  // DELETED:       ) &&
  // DELETED:       task.steps?.some(
  // DELETED:         (step) => step.key === 'send-approval' && step.status === 'skipped',
  // DELETED:       ) &&
  // DELETED:       task.events.some((event) =>
  // DELETED:         /无可处理|没有可处理|未读取到可处理/.test(event.message),
  // DELETED:       );
  // DELETED:     if (result.terminalStatus === 'no_target' || noTargetBySteps) {
  // DELETED:       const evidenceEventIds = this.collectRecentEvidenceEventIds(task);
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'environment',
  // DELETED:         'completed',
  // DELETED:         '基础执行环境检查完成。',
  // DELETED:       );
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'send-result',
  // DELETED:         'skipped',
  // DELETED:         '无可处理对象，未执行发送。',
  // DELETED:       );
  // DELETED:       this.markQueuedBatchTargets(
  // DELETED:         task,
  // DELETED:         'no_target',
  // DELETED:         result.nextAction || '无可处理对象',
  // DELETED:         {
  // DELETED:           nextAction:
  // DELETED:             result.nextAction || '没有可处理对象；补充对象后重新创建任务。',
  // DELETED:           evidenceEventIds,
  // DELETED:         },
  // DELETED:       );
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'no_target',
  // DELETED:         '真实读取完成：本次没有可处理对象，未执行发送。',
  // DELETED:         {
  // DELETED:           failureReason: undefined,
  // DELETED:           nextAction:
  // DELETED:             result.nextAction || '没有可处理对象；补充对象后重新创建任务。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     if (result.terminalStatus === 'skipped') {
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'environment',
  // DELETED:         'completed',
  // DELETED:         '基础执行环境检查完成。',
  // DELETED:       );
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'send-result',
  // DELETED:         'skipped',
  // DELETED:         '任务已跳过，未执行发送。',
  // DELETED:       );
  // DELETED:       this.markQueuedBatchTargets(
  // DELETED:         task,
  // DELETED:         'skipped',
  // DELETED:         result.nextAction || '任务已跳过',
  // DELETED:         {
  // DELETED:           nextAction:
  // DELETED:             result.nextAction || '任务已跳过；如需继续，请创建重试任务。',
  // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'skipped',
  // DELETED:         '真实读取完成：任务已跳过，未执行发送。',
  // DELETED:         {
  // DELETED:           failureReason: undefined,
  // DELETED:           nextAction:
  // DELETED:             result.nextAction || '任务已跳过；如需继续，请创建重试任务。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     if (result.terminalStatus === 'failed') {
  // DELETED:       this.markQueuedBatchTargets(
  // DELETED:         task,
  // DELETED:         'failed',
  // DELETED:         result.failureReason || '真实读取失败',
  // DELETED:         {
  // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
  // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'failed',
  // DELETED:         result.failureReason || '真实读取失败，未执行发送。',
  // DELETED:         {
  // DELETED:           failureReason: result.failureReason,
  // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     if (result.state === 'executor_missing') {
  // DELETED:       this.markQueuedBatchTargets(
  // DELETED:         task,
  // DELETED:         'failed',
  // DELETED:         result.failureReason || '真实执行预检失败',
  // DELETED:         {
  // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
  // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'failed',
  // DELETED:         result.failureReason || '真实执行预检失败，未执行发送。',
  // DELETED:         {
  // DELETED:           failureReason: result.failureReason,
  // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         },
  // DELETED:       );
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     const liveReviewReason = this.resolveCustomerReplyReviewReason(
  // DELETED:       task.sourceText,
  // DELETED:     );
  // DELETED:     if (task.sendMode === 'approval-send' && liveReviewReason) {
  // DELETED:       task.riskLevel = 'high';
  // DELETED:       task.requiresDoubleConfirmation = true;
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'send-approval',
  // DELETED:         'running',
  // DELETED:       );
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'send-result',
  // DELETED:         'pending',
  // DELETED:         '确认后才会调用真实发送执行器。',
  // DELETED:       );
  // DELETED:       const reviewEvent = this.pushEvent(
  // DELETED:         task,
  // DELETED:         'warning',
  // DELETED:         `客户内容涉及${liveReviewReason}，请确认回复内容后再发送。`,
  // DELETED:         {
  // DELETED:           type: 'text',
  // DELETED:           label: '内容风控',
  // DELETED:           value: `source=${task.sourceText} / reply=${task.replyText}`,
  // DELETED:         },
  // DELETED:       );
  // DELETED:       this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
  // DELETED:         nextAction: `请确认${liveReviewReason}回复是否能发送。`,
  // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
  // DELETED:           reviewEvent.id,
  // DELETED:         ]),
  // DELETED:       });
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'waiting_for_send_confirmation',
  // DELETED:         {
  // DELETED:           nextAction: `客户内容涉及${liveReviewReason}；请确认回复内容后再发送。`,
  // DELETED:         },
  // DELETED:       );
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     if (task.sendMode === 'auto-send') {
  // DELETED:       this.setTaskStep(
  // DELETED:         task,
  // DELETED:         'send-result',
  // DELETED:         'running',
  // DELETED:         '正在调用真实自动发送执行器。',
  // DELETED:       );
  // DELETED:       this.updateTask(
  // DELETED:         task,
  // DELETED:         'running',
  // DELETED:         `已识别真实${this.resolveTypeLabel(task.type)}对象，正在自动发送。`,
  // DELETED:         {
  // DELETED:           nextAction: `当前对象：${task.sourceText}；回复：${task.replyText}`,
  // DELETED:         },
  // DELETED:       );
  // DELETED:       const sendResult = await this.autoSendReplyViaRuntime(task);
  // DELETED:       if (sendResult.ok) {
  // DELETED:         task.failureReason = undefined;
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'environment',
  // DELETED:           'completed',
  // DELETED:           '基础执行环境检查完成。',
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'account-entry',
  // DELETED:           'completed',
  // DELETED:           '真实账号入口已通过，自动发送执行完成。',
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'target-read',
  // DELETED:           'completed',
  // DELETED:           `已锁定真实对象：${task.sourceText}`,
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'reply-generate',
  // DELETED:           'completed',
  // DELETED:           '回复内容已生成并用于真实发送。',
  // DELETED:         );
  // DELETED:         const readbackMessage = buildAutoSendReadbackMessage(sendResult);
  // DELETED:         this.setTaskStep(task, 'send-result', 'completed', readbackMessage);
  // DELETED:         const sendEvent = this.pushEvent(
  // DELETED:           task,
  // DELETED:           'success',
  // DELETED:           `${sendResult.message}；${readbackMessage}`,
  // DELETED:           sendResult.evidence,
  // DELETED:         );
  // DELETED:         this.completeQueuedBatchTargets(task, {
  // DELETED:           nextAction:
  // DELETED:             sendResult.nextAction || '自动发送已完成，可在执行记录查看证据。',
  // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
  // DELETED:             sendEvent.id,
  // DELETED:           ]),
  // DELETED:         });
  // DELETED:         this.updateTask(task, 'completed', sendResult.message, {
  // DELETED:           nextAction:
  // DELETED:             sendResult.nextAction || '自动发送已完成，可在执行记录查看证据。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         });
  // DELETED:         await this.persistTask(task);
  // DELETED:         return;
  // DELETED:       }
  // DELETED:
  // DELETED:       if (
  // DELETED:         sendResult.status === 'message_missing' ||
  // DELETED:         sendResult.status === 'comment_missing' ||
  // DELETED:         sendResult.status === 'no_target'
  // DELETED:       ) {
  // DELETED:         task.failureReason = undefined;
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'environment',
  // DELETED:           'completed',
  // DELETED:           '基础执行环境检查完成。',
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'account-entry',
  // DELETED:           'completed',
  // DELETED:           '真实账号入口已通过。',
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'target-read',
  // DELETED:           'completed',
  // DELETED:           `已锁定真实对象：${task.sourceText}`,
  // DELETED:         );
  // DELETED:         this.setTaskStep(
  // DELETED:           task,
  // DELETED:           'reply-generate',
  // DELETED:           'completed',
  // DELETED:           '回复内容已生成，但目标已不存在或无需发送。',
  // DELETED:         );
  // DELETED:         this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
  // DELETED:         const noTargetEvent = this.pushEvent(
  // DELETED:           task,
  // DELETED:           'warning',
  // DELETED:           sendResult.message,
  // DELETED:           sendResult.evidence,
  // DELETED:         );
  // DELETED:         this.markQueuedBatchTargets(task, 'no_target', sendResult.message, {
  // DELETED:           nextAction:
  // DELETED:             sendResult.nextAction || '目标已不存在或已处理，无需继续发送。',
  // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
  // DELETED:             noTargetEvent.id,
  // DELETED:           ]),
  // DELETED:         });
  // DELETED:         this.updateTask(task, 'no_target', sendResult.message, {
  // DELETED:           failureReason: undefined,
  // DELETED:           nextAction:
  // DELETED:             sendResult.nextAction || '目标已不存在或已处理，无需继续发送。',
  // DELETED:           completedAt: new Date().toISOString(),
  // DELETED:         });
  // DELETED:         await this.persistTask(task);
  // DELETED:         return;
  // DELETED:       }
  // DELETED:
  // DELETED:       this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
  // DELETED:       const failureEvent = this.pushEvent(
  // DELETED:         task,
  // DELETED:         'error',
  // DELETED:         sendResult.message,
  // DELETED:         sendResult.evidence,
  // DELETED:       );
  // DELETED:       this.markQueuedBatchTargets(task, 'failed', sendResult.message, {
  // DELETED:         nextAction: sendResult.nextAction || '请检查真实自动发送能力后重试。',
  // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
  // DELETED:           failureEvent.id,
  // DELETED:         ]),
  // DELETED:       });
  // DELETED:       this.updateTask(task, 'failed', sendResult.message, {
  // DELETED:         failureReason: sendResult.message,
  // DELETED:         nextAction: sendResult.nextAction || '请检查真实自动发送能力后重试。',
  // DELETED:         completedAt: new Date().toISOString(),
  // DELETED:       });
  // DELETED:       await this.persistTask(task);
  // DELETED:       return;
  // DELETED:     }
  // DELETED:     if (result.readyForApproval) {
  // DELETED:       task.status = 'waiting_for_send_confirmation';
  // DELETED:       task.statusLabel = this.resolveStatusLabel(
  // DELETED:         'waiting_for_send_confirmation',
  // DELETED:       );
  // DELETED:       this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
  // DELETED:         nextAction: result.nextAction || '请确认目标和回复内容后继续。',
  // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task),
  // DELETED:       });
  // DELETED:       const confirmation = this.createInteractionTaskConfirmation(task);
  // DELETED:       this.agentConfirmations.set(confirmation.id, confirmation);
  // DELETED:     await this.persistAgentConfirmation(confirmation);
  // DELETED:     }
  // DELETED:     await this.persistTask(task);
}

export async function ensureBrowserInteractionTarget(
  this: BrowserAssistHost,
  task: InteractionTask,
): Promise<boolean> {
  if (!isBrowserPlatformInteractionTask(task.type)) {
    return true;
  }
  const hadPlaceholderInput =
    isPlaceholderInteractionText(task.sourceText) ||
    isPlaceholderInteractionText(task.targetName) ||
    !task.sourceText?.trim();
  if (!this.shouldReadRealInteractionTarget(task)) {
    return true;
  }

  this.setTaskStep(
    task,
    'target-read',
    'running',
    '正在读取平台上的真实评论/私信。',
  );
  this.pushEvent(task, 'info', '阶段日志：开始读取真实互动对象。', {
    type: 'stage_log',
    label: '读取真实对象',
    value: `${task.platformName || task.type} / account=${task.accountId || ''}`,
    stageKey: 'target-read',
  });

  try {
    const readResult = await this.readBrowserInteractionCandidates(task);
    const selected = this.pickReadableInteractionCandidate(
      readResult.items,
      task,
    );
    const evidenceEventIds: string[] = [];
    const candidatePreview = readResult.items.slice(0, 5).map((item) => ({
      text: String(
        optionalTrimmedText(item.text) ||
          optionalTrimmedText(item['content']) ||
          optionalTrimmedText(item['message']) ||
          '',
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120),
      source: String(optionalTrimmedText(item.source) || '').slice(0, 60),
      targetName: String(
        optionalTrimmedText(item['author']) ||
          optionalTrimmedText(item['nickname']) ||
          optionalTrimmedText(item['sender']) ||
          optionalTrimmedText(item['contactName']) ||
          '',
      )
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80),
    }));
    const candidateSummary = this.pushEvent(
      task,
      'info',
      `真实读取候选：${readResult.items.length} 条。`,
      {
        type: 'text',
        label: '真实读取候选摘要',
        value: JSON.stringify({
          count: readResult.items.length,
          preview: candidatePreview,
          emptyReason: readResult.emptyReason || null,
          loadBlocked: Boolean(readResult.loadBlocked),
        }),
        stageKey: 'target-read',
      },
    );
    evidenceEventIds.push(candidateSummary.id);
    if (readResult.evidence) {
      const event = this.pushEvent(task, 'info', '已保存真实读取页面截图。', {
        type: 'page_snapshot',
        label: '真实读取截图',
        value: readResult.evidence,
        stageKey: 'target-read',
      });
      evidenceEventIds.push(event.id);
    }

    if (!selected) {
      this.setTaskStep(
        task,
        'environment',
        'completed',
        '基础执行环境检查完成。',
      );
      this.setTaskStep(
        task,
        'account-entry',
        'completed',
        '平台账号后台已打开并通过登录态检查。',
      );
      this.setTaskStep(
        task,
        'target-read',
        'blocked',
        readResult.emptyReason || '当前没有可回复对象。',
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'skipped',
        '没有真实对象，不能生成回复。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'skipped',
        '没有真实对象，不进入发送。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'skipped',
        '没有可处理对象，未发送。',
      );
      if (readResult.loadBlocked) {
        this.updateTask(
          task,
          'blocked',
          readResult.emptyReason || '平台页面仍在加载，未进入可读取状态。',
          {
            nextAction:
              '等待平台页面加载完成后重试；如果持续加载，刷新后台或重新登录账号。',
            completedAt: new Date().toISOString(),
          },
        );
        return false;
      }
      this.markQueuedBatchTargets(
        task,
        'no_target',
        readResult.emptyReason || '当前没有可回复对象',
        {
          nextAction: '等平台出现新评论/私信后重试。',
          evidenceEventIds,
        },
      );
      this.updateTask(
        task,
        'no_target',
        readResult.emptyReason || '当前没有可回复对象。',
        {
          nextAction: '等平台出现新评论/私信后重试。',
          completedAt: new Date().toISOString(),
        },
      );
      return false;
    }

    const now = new Date().toISOString();
    const selectedText = this.cleanReadableInteractionText(
      selected.text,
      task.type,
    );
    const existingReply =
      !hadPlaceholderInput &&
      task.replyText?.trim() &&
      !isPlaceholderInteractionText(task.replyText)
        ? task.replyText.trim()
        : '';
    let replyGeneratedBy: InteractionReplyGeneratedBy =
      existingReply && task.replyGeneratedBy === 'ai' ? 'ai' : 'fallback';
    let replyText = existingReply;
    if (!replyText) {
      const generatedReply = await this.generateInteractionReply({
        sourceText: selectedText,
        targetName: selected.targetName || selectedText.slice(0, 32),
        accountName: task.accountName,
      });
      replyText = generatedReply.replyText;
      replyGeneratedBy = generatedReply.generatedBy;
    }
    task.targetName =
      selected.targetName || selectedText.slice(0, 32) || task.targetName;
    task.sourceText = selectedText;
    task.replyText = replyText;
    task.replyGeneratedBy = replyGeneratedBy;
    task.sourceUrl = selected.sourceUrl || task.sourceUrl;
    task.profileUrl = selected.profileUrl || task.profileUrl;
    task.commentTime = selected.commentTime || task.commentTime;
    task.videoTitle = selected.videoTitle || task.videoTitle;
    task.videoUrl = selected.videoUrl || task.videoUrl;
    task.engagementScore =
      typeof selected.engagementScore === 'number'
        ? selected.engagementScore
        : task.engagementScore;
    task.updatedAt = now;
    task.batchTargets = [
      {
        id: task.batchTargets?.[0]?.id || `bt_1_${createId()}`,
        targetName: task.targetName,
        sourceText: task.sourceText,
        replyText: task.replyText,
        sourceUrl: task.sourceUrl,
        profileUrl: task.profileUrl,
        commentTime: task.commentTime,
        videoTitle: task.videoTitle,
        videoUrl: task.videoUrl,
        engagementScore: task.engagementScore,
        status: 'queued',
        updatedAt: now,
        evidenceEventIds,
      },
    ];
    task.batchSummary = buildBatchSummary(task.batchTargets);
    this.setTaskStep(
      task,
      'target-read',
      'completed',
      `已读取真实对象：${task.sourceText.slice(0, 80)}`,
    );
    this.setTaskStep(
      task,
      'reply-generate',
      'completed',
      '已按真实内容生成回复。',
    );
    this.pushEvent(task, 'success', `已读取真实对象：${task.sourceText}`, {
      type: 'page_snapshot',
      label: '真实对象',
      value: task.sourceText,
      stageKey: 'target-read',
    });
    this.pushEvent(task, 'success', `已生成回复：${task.replyText}`, {
      type: 'text',
      label: replyGeneratedBy === 'ai' ? 'AI 回复内容' : '规则兜底回复内容',
      value: task.replyText,
      stageKey: 'reply-generate',
    });
    await this.persistTask(task);
    return true;
  } catch (error) {
    const message = sanitizeInteractionFailureMessage(
      error instanceof Error ? error.message : String(error),
    );
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    this.setTaskStep(
      task,
      'account-entry',
      'blocked',
      '平台账号后台未通过登录态检查。',
    );
    this.setTaskStep(task, 'target-read', 'blocked', message);
    this.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      '真实读取失败，不能生成回复。',
    );
    this.setTaskStep(
      task,
      'send-approval',
      'blocked',
      '真实读取失败，不能进入发送。',
    );
    this.setTaskStep(task, 'send-result', 'blocked', '真实读取失败，未发送。');
    this.pushEvent(task, 'error', message, {
      type: 'failure_reason',
      label: '真实读取失败',
      value: message,
      stageKey: 'target-read',
    });
    this.markQueuedBatchTargets(task, 'failed', message, {
      nextAction: '请确认平台账号已登录、页面能打开，然后重试。',
      evidenceEventIds: this.collectRecentEvidenceEventIds(task),
    });
    this.updateTask(task, 'failed', message, {
      failureReason: message,
      nextAction: '请确认平台账号已登录、页面能打开，然后重试。',
      completedAt: new Date().toISOString(),
    });
    return false;
  }
}

export function markPreparedBrowserInteractionSteps(
  this: BrowserAssistHost,
  task: InteractionTask,
) {
  this.setTaskStep(
    task,
    'target-read',
    'completed',
    `已锁定目标对象：${(task.sourceText || task.targetName || '当前对象').slice(0, 80)}`,
  );
  this.setTaskStep(
    task,
    'reply-generate',
    'completed',
    '回复内容已生成并准备执行。',
  );
}

export function shouldReadRealInteractionTarget(
  this: BrowserAssistHost,
  task: InteractionTask,
): boolean {
  return (
    isPlaceholderInteractionText(task.sourceText) ||
    isPlaceholderInteractionText(task.targetName) ||
    !task.sourceText?.trim()
  );
}

export function isRuntimeAccountEntryBlocker(
  this: BrowserAssistHost,
  reasonCode?: string,
): boolean {
  return (
    reasonCode === 'account_not_logged_in' ||
    reasonCode === 'captcha_required' ||
    reasonCode === 'runtime_unavailable' ||
    reasonCode === 'platform_changed' ||
    reasonCode === 'permission_missing'
  );
}

export async function readBrowserInteractionCandidates(
  this: BrowserAssistHost,
  task: InteractionTask,
): Promise<{
  items: Array<Record<string, unknown>>;
  evidence?: string;
  emptyReason?: string;
  loadBlocked?: boolean;
}> {
  const accountId = Number(task.accountId);
  if (!Number.isFinite(accountId)) {
    throw new Error('缺少可用的平台账号 ID，不能读取真实互动对象。');
  }
  const limit = 10;
  if (task.type === 'douyin-comment-reply') {
    const result = await this.autoUploadService.readDouyinComments({
      accountId,
      limit,
      parsingRules: task.replyRule,
    });
    return this.normalizeInteractionReadResult(result.comments, result);
  }
  if (task.type === 'douyin-direct-message-reply') {
    const result = await this.autoUploadService.readDouyinMessages({
      accountId,
      limit,
    });
    return this.normalizeInteractionReadResult(result.messages, result);
  }
  if (task.type === 'wechat-channel-comment-reply') {
    const result = await this.autoUploadService.readWechatChannelComments({
      accountId,
      limit,
    });
    return this.normalizeInteractionReadResult(result.comments, result);
  }
  const result = await this.autoUploadService.readWechatChannelMessages({
    accountId,
    limit,
  });
  return this.normalizeInteractionReadResult(result.messages, result);
}

export function normalizeInteractionReadResult(
  this: BrowserAssistHost,
  items: Array<Record<string, unknown>> | undefined,
  result: {
    summary?: { emptyReason?: string | null; loadBlocked?: boolean };
    evidence?: { path?: string; value?: string } | null;
  },
): {
  items: Array<Record<string, unknown>>;
  evidence?: string;
  emptyReason?: string;
  loadBlocked?: boolean;
} {
  return {
    items: Array.isArray(items) ? items : [],
    evidence:
      typeof result.evidence?.path === 'string'
        ? result.evidence.path
        : typeof result.evidence?.value === 'string'
          ? result.evidence.value
          : undefined,
    emptyReason:
      typeof result.summary?.emptyReason === 'string'
        ? result.summary.emptyReason
        : undefined,
    loadBlocked: Boolean(result.summary?.loadBlocked),
  };
}

export function pickReadableInteractionCandidate(
  this: BrowserAssistHost,
  items: Array<Record<string, unknown>>,
  task?: InteractionTask,
): {
  text: string;
  targetName?: string;
  sourceUrl?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
} | null {
  const normalize = (value: unknown) =>
    String(optionalTrimmedText(value) || '')
      .replace(/\s+/g, '')
      .trim();
  const currentReplyText = normalize(task?.replyText);
  const fallbackReplies = new Set(
    normalizeStringList(
      (task?.replyRule as Record<string, unknown> | null)?.fallbackReplies,
      [],
    )
      .map((reply) => normalize(reply))
      .filter(Boolean),
  );
  const orderedItems =
    task?.type === 'douyin-direct-message-reply'
      ? [...items].sort((a, b) => {
          const score = (item: Record<string, unknown>) => {
            const source = String(
              optionalTrimmedText(item.source) || '',
            ).toLowerCase();
            const context = String(optionalTrimmedText(item.context) || '');
            const text = String(
              optionalTrimmedText(item.text) ||
                optionalTrimmedText(item['content']) ||
                optionalTrimmedText(item['message']) ||
                '',
            );
            let value = 0;
            if (source === 'dom') value += 80;
            if (source.includes('dom')) value += 50;
            if (context && context.includes(text)) value += 30;
            if (source.includes('network')) value -= 40;
            if (source.includes('window')) value -= 20;
            return value;
          };
          return score(b) - score(a);
        })
      : items;
  for (const item of orderedItems) {
    if (task?.type === 'douyin-direct-message-reply') {
      const source = String(
        optionalTrimmedText(item.source) || '',
      ).toLowerCase();
      if (
        source.includes('network') ||
        source.includes('window') ||
        source === 'text-node' ||
        source === 'contact-name'
      ) {
        continue;
      }
    }
    const text = String(
      optionalTrimmedText(item.text) ||
        optionalTrimmedText(item['content']) ||
        optionalTrimmedText(item['message']) ||
        '',
    )
      .replace(/\s+/g, ' ')
      .trim();
    const normalizedText = normalize(text);
    if (!text || isPlaceholderInteractionText(text)) {
      continue;
    }
    if (
      currentReplyText &&
      (normalizedText === currentReplyText ||
        normalizedText.includes(currentReplyText))
    ) {
      continue;
    }
    if (
      [...fallbackReplies].some(
        (reply) => normalizedText === reply || normalizedText.includes(reply),
      )
    ) {
      continue;
    }
    if (text.length > 500) {
      continue;
    }
    const targetName = String(
      optionalTrimmedText(item['author']) ||
        optionalTrimmedText(item['nickname']) ||
        optionalTrimmedText(item['sender']) ||
        optionalTrimmedText(item['contactName']) ||
        '',
    ).trim();
    const field = (...keys: string[]) => {
      for (const key of keys) {
        const value = String(optionalTrimmedText(item[key]) || '').trim();
        if (value) return value;
      }
      return undefined;
    };
    const engagementScore = Number(item['engagementScore']);
    return {
      text: this.cleanReadableInteractionText(text, task?.type),
      targetName: targetName || undefined,
      sourceUrl: field('sourceUrl', 'url', 'link'),
      profileUrl: field('profileUrl', 'authorUrl'),
      commentTime: field('commentTime', 'time', 'createdAt'),
      videoTitle: field('videoTitle', 'workTitle', 'selectedWorkTitle'),
      videoUrl: field('videoUrl', 'awemeUrl'),
      engagementScore: Number.isFinite(engagementScore)
        ? engagementScore
        : undefined,
    };
  }
  return null;
}

export function cleanReadableInteractionText(
  this: BrowserAssistHost,
  value: string,
  type?: InteractionTaskType,
): string {
  let text = String(optionalTrimmedText(value) || '')
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .trim();
  if (type === 'douyin-comment-reply') {
    text = text
      .replace(/\s+(?:回复|删除|举报|查看\d+条回复).*$/g, '')
      .replace(/\s+\d{1,4}$/g, '')
      .trim();
  }
  return text;
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const browserAssistMethods = {
  runInteractionTaskLifecycle,
  resolveCustomerServiceLifecycleDelayMs,
  runBrowserAssistedTaskWithQueue,
  resolveBrowserInteractionQueueKey,
  processBatchTargetsWithRateLimit,
  preflightBrowserAssistedTask,
  ensureBrowserInteractionTarget,
  markPreparedBrowserInteractionSteps,
  shouldReadRealInteractionTarget,
  isRuntimeAccountEntryBlocker,
  readBrowserInteractionCandidates,
  normalizeInteractionReadResult,
  pickReadableInteractionCandidate,
  cleanReadableInteractionText,
};
