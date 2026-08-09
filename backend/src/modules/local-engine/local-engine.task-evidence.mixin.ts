// local-engine 任务证据/诊断簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 TaskEvidenceHost 接口：
// markQueuedBatchTargets（batch-targets 簇）、persistTask（本 service）、
// resolveGroupBroadcastPlanStatus/resolveStatusLabel/resolveTypeLabel（plan/agent 簇）。

import type {
  InteractionBatchTarget,
  InteractionGroupBroadcastPlanStatus,
  LocalEngineEvidence,
  InteractionTask,
  InteractionTaskEvent,
  InteractionTaskResultKind,
  InteractionTaskResultSummary,
  InteractionTaskStatus,
  InteractionTaskStep,
  InteractionTaskStepStatus,
  InteractionTaskType,
} from './local-engine.types';
import {
  buildBatchSummary,
  createId,
  defaultNextActionForStatus,
  previewEvidenceValue,
  shouldPreserveCompletedBusinessResult,
  shouldPreserveEvidenceIntegrityBlocker,
  taskNeedsBrowserEvidence,
  taskNeedsDesktopEvidence,
} from './local-engine.utils';

/** 任务证据索引条目（buildTaskEvidenceIndex 的 stageLogs/failureReasons 等元素） */
export type TaskEvidenceIndexItem = {
  id: string;
  eventId: string;
  type: string;
  label: string;
  level: string;
  stageKey?: string;
  createdAt: string;
  artifactUrl?: string;
  valuePreview?: string;
};

/** 任务证据索引（buildTaskEvidenceIndex 返回） */
export type TaskEvidenceIndex = {
  counts: Record<string, number>;
  stageLogs: TaskEvidenceIndexItem[];
  failureReasons: TaskEvidenceIndexItem[];
  riskAudits: TaskEvidenceIndexItem[];
  confirmations: Array<{
    operator: string;
    targetConfirmed: boolean;
    contentConfirmed: boolean;
    currentWindowConfirmed: boolean;
    contactConfirmed: boolean;
    draftBeforeFillConfirmed: boolean;
    confirmedChecklistKeys: string[];
    confirmedAt: string;
  }>;
  browser: TaskEvidenceIndexItem[];
  desktop: TaskEvidenceIndexItem[];
  text: TaskEvidenceIndexItem[];
};

/** 任务证据完整性（buildTaskEvidenceIntegrity 返回） */
export type TaskEvidenceIntegrity = {
  status: 'OK' | 'FAILED';
  missing: string[];
  required: string[];
  checkedAt: string;
};

/** 任务证据回放（buildTaskEvidenceReplay 返回） */
export type TaskEvidenceReplayItem = {
  key: string;
  label: string;
  status: string;
  message: string;
  evidenceCount: number;
  updatedAt?: string;
};

/** 任务证据条目（collectTaskEvidence 返回） */
export type TaskEvidenceItem = {
  id: string;
  eventId: string;
  level: InteractionTaskEvent['level'];
  message: string;
  createdAt: string;
  evidence: LocalEngineEvidence & { id?: string; createdAt?: string };
};

/** 任务证据/诊断簇的 host 接口：簇方法访问的 service 成员 */
export interface TaskEvidenceHost {
  persistTask(task: InteractionTask): Promise<void>;
  updateTask(
    task: InteractionTask,
    status: InteractionTaskStatus,
    eventMessage: string,
    patch?: Partial<InteractionTask>,
  ): void;
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): InteractionTaskEvent;
  createTaskSteps(
    type: InteractionTaskType,
    hasAccount: boolean,
    now: string,
  ): InteractionTaskStep[];
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ): void;
  refreshTaskDiagnostics(task: InteractionTask): void;
  buildTaskResultSummary(
    task: InteractionTask,
    evidenceCount: number,
    diagnosticSummary: string,
  ): InteractionTaskResultSummary;
  buildTaskEvidenceReplay(task: InteractionTask): TaskEvidenceReplayItem[];
  buildTaskEvidenceIndex(task: InteractionTask): TaskEvidenceIndex;
  collectTaskEvidence(task: InteractionTask): TaskEvidenceItem[];
  toTaskEvidenceIndexItems(items: TaskEvidenceItem[]): TaskEvidenceIndexItem[];
  groupTaskEvidenceByType(
    evidenceItems: InteractionTaskEvent['evidence'][],
  ): Record<string, number>;
  buildTaskEvidenceIntegrity(
    task: InteractionTask,
    evidenceIndex?: TaskEvidenceIndex,
  ): TaskEvidenceIntegrity;
  ensureTaskEvidenceForExport(
    task: InteractionTask,
    stageKey: string,
  ): Promise<void>;
  repairEvidenceIntegrityOnlyFailureTask(task: InteractionTask): boolean;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: Record<string, unknown>,
  ): void;
  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  ): InteractionGroupBroadcastPlanStatus | undefined;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resolveTypeLabel(type: InteractionTaskType): string;
}

export function updateTask(
  this: TaskEvidenceHost,
  task: InteractionTask,
  status: InteractionTaskStatus,
  eventMessage: string,
  patch?: Partial<InteractionTask>,
) {
  task.status = status;
  task.statusLabel = this.resolveStatusLabel(status);
  task.updatedAt = new Date().toISOString();
  Object.assign(task, patch);
  task.planStatus =
    patch?.planStatus ||
    this.resolveGroupBroadcastPlanStatus(
      task.type,
      status,
      undefined,
      task.planTime,
    );
  this.pushEvent(
    task,
    status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
    eventMessage,
  );
  this.refreshTaskDiagnostics(task);
}

export function pushEvent(
  this: TaskEvidenceHost,
  task: InteractionTask,
  level: InteractionTaskEvent['level'],
  message: string,
  evidence?: InteractionTaskEvent['evidence'],
) {
  const event = {
    id: createId(),
    taskId: task.id,
    level,
    message,
    evidence,
    createdAt: new Date().toISOString(),
  };
  task.events.push(event);
  task.updatedAt = new Date().toISOString();
  this.persistTask(task).catch((error) => {
    console.warn('[local-engine] persist task event failed', error);
  });
  return event;
}

export function createTaskSteps(
  this: TaskEvidenceHost,
  type: InteractionTaskType,
  hasAccount: boolean,
  now: string,
) {
  const targetLabelMap: Record<InteractionTaskType, string> = {
    'douyin-comment-reply': '读取评论',
    'douyin-direct-message-reply': '读取私信',
    'wechat-channel-comment-reply': '读取视频号评论',
    'wechat-channel-direct-message-reply': '读取视频号私信',
    'wechat-reply-draft': '读取微信会话',
    'wechat-friend-accept': '读取好友请求',
    'wechat-group-broadcast': '读取群发对象',
    'wechat-contact-add': '读取加好友对象',
    'wechat-moments-publish': '读取朋友圈素材',
    'wechat-moments-marketing': '读取朋友圈营销对象',
    'customer-follow-up': '读取客户对象',
  };
  const replyLabelMap: Record<InteractionTaskType, string> = {
    'douyin-comment-reply': '生成回复',
    'douyin-direct-message-reply': '生成回复',
    'wechat-channel-comment-reply': '生成视频号评论回复',
    'wechat-channel-direct-message-reply': '生成视频号私信回复',
    'wechat-reply-draft': '生成微信草稿',
    'wechat-friend-accept': '准备好友接受动作',
    'wechat-group-broadcast': '生成群发草稿',
    'wechat-contact-add': '生成好友验证消息',
    'wechat-moments-publish': '生成朋友圈文案',
    'wechat-moments-marketing': '生成朋友圈评论',
    'customer-follow-up': '生成跟进话术',
  };

  return [
    {
      key: 'environment',
      label: '环境检查',
      status: 'pending' as const,
      message: '等待检查本地引擎和权限。',
      updatedAt: now,
    },
    {
      key: 'account-entry',
      label: '账号入口',
      status: hasAccount ? ('pending' as const) : ('skipped' as const),
      message: hasAccount
        ? '等待打开本地账号后台。'
        : '内部记录任务不需要平台账号。',
      updatedAt: now,
    },
    {
      key: 'target-read',
      label: targetLabelMap[type],
      status: 'pending' as const,
      message: '等待定位目标对象。',
      updatedAt: now,
    },
    {
      key: 'reply-generate',
      label: replyLabelMap[type],
      status: 'pending' as const,
      message: '等待生成回复内容。',
      updatedAt: now,
    },
    {
      key: 'send-approval',
      label: '执行保护',
      status: 'pending' as const,
      message: '等待自动/受控执行策略判定。',
      updatedAt: now,
    },
    {
      key: 'send-result',
      label: '结果回写',
      status: 'pending' as const,
      message: '等待写入执行结果和证据。',
      updatedAt: now,
    },
  ];
}

export function setTaskStep(
  this: TaskEvidenceHost,
  task: InteractionTask,
  key: string,
  status: InteractionTaskStepStatus,
  message: string,
) {
  task.steps = task.steps?.length
    ? task.steps
    : this.createTaskSteps(task.type, Boolean(task.accountId), task.createdAt);
  const step = task.steps.find((item) => item.key === key);
  if (!step) return;

  step.status = status;
  step.message = message;
  step.updatedAt = new Date().toISOString();
  task.updatedAt = step.updatedAt;
  this.persistTask(task).catch((error) => {
    console.warn('[local-engine] persist task step failed', error);
  });
}

export function refreshTaskDiagnostics(
  this: TaskEvidenceHost,
  task: InteractionTask,
) {
  const currentStep =
    task.steps?.find((step) => step.status === 'blocked') ||
    task.steps?.find((step) => step.status === 'running') ||
    task.steps?.find((step) => step.status === 'pending') ||
    task.steps?.at(-1);
  const lastEvent = task.events.at(-1);
  const evidenceCount = task.events.filter((event) =>
    Boolean(event.evidence),
  ).length;
  const diagnosticStatus =
    task.status === 'failed' || task.status === 'blocked'
      ? 'blocked'
      : task.status === 'waiting_for_send_confirmation'
        ? 'waiting'
        : task.status === 'completed'
          ? 'completed'
          : task.status === 'skipped'
            ? 'skipped'
            : task.status === 'no_target'
              ? 'no_target'
              : currentStep?.status === 'blocked'
                ? 'blocked'
                : 'normal';
  const stepText = currentStep
    ? `${currentStep.label}：${currentStep.message}`
    : '等待任务开始。';
  const summary =
    diagnosticStatus === 'blocked'
      ? `卡在${stepText}`
      : diagnosticStatus === 'waiting'
        ? `等待继续执行：${task.nextAction || currentStep?.message || '条件通过后继续执行。'}`
        : diagnosticStatus === 'completed'
          ? '任务已完成，结果和证据已回写。'
          : diagnosticStatus === 'no_target'
            ? '无对象，未执行发送或发布。'
            : diagnosticStatus === 'skipped'
              ? '任务已跳过。'
              : stepText;
  const resolvedNextAction =
    task.nextAction || defaultNextActionForStatus(task.status);

  if (task.failureReason) {
    task.failureContext = {
      account: task.accountName || undefined,
      target: task.targetName || undefined,
      stage: currentStep?.label,
      reason: task.failureReason,
      nextAction: resolvedNextAction,
    };
    if (!task.blockers?.length) {
      task.blockers = [
        {
          account: task.accountName || undefined,
          target: task.targetName || undefined,
          stage: currentStep?.label || currentStep?.key || '执行阶段',
          reason: task.failureReason,
          nextAction: resolvedNextAction,
          capability: 'local-engine-diagnostics',
        },
      ];
    }
  } else if (
    task.blockers?.every(
      (blocker) => blocker.capability === 'local-engine-diagnostics',
    )
  ) {
    task.failureContext = undefined;
    task.blockers = undefined;
  }

  const resultSummary = this.buildTaskResultSummary(
    task,
    evidenceCount,
    summary,
  );
  task.diagnostics = {
    status: diagnosticStatus,
    summary,
    account: task.accountName || '未指定账号',
    platform: task.platformName || this.resolveTypeLabel(task.type),
    currentStep: currentStep?.label,
    currentStepStatus: currentStep?.status,
    currentStepMessage: currentStep?.message,
    failureReason: task.failureReason,
    nextAction: task.nextAction,
    runtimeMode: task.runtimeMode,
    evidenceCount,
    lastEventAt: lastEvent?.createdAt,
  };
  task.resultSummary = resultSummary;
}

export function buildTaskResultSummary(
  this: TaskEvidenceHost,
  task: InteractionTask,
  evidenceCount: number,
  diagnosticSummary: string,
): InteractionTaskResultSummary {
  const counts = {
    total: task.batchSummary?.total || task.batchTargets?.length || 1,
    completed:
      task.batchSummary?.completed || (task.status === 'completed' ? 1 : 0),
    failed:
      task.batchSummary?.failed ||
      (['failed', 'blocked'].includes(task.status) ? 1 : 0),
    skipped: task.batchSummary?.skipped || (task.status === 'skipped' ? 1 : 0),
    noTarget:
      task.batchSummary?.noTarget || (task.status === 'no_target' ? 1 : 0),
  };
  const kind: InteractionTaskResultKind =
    task.status === 'completed'
      ? 'success'
      : task.status === 'failed' || task.status === 'blocked'
        ? 'failure'
        : task.status === 'skipped'
          ? 'skipped'
          : task.status === 'no_target'
            ? 'no_target'
            : task.status === 'waiting_for_send_confirmation'
              ? 'waiting'
              : 'running';
  const headlineMap = {
    success:
      counts.total > 1 ? `成功 ${counts.completed}/${counts.total}` : '成功',
    failure:
      counts.failed > 0 ? `失败 ${counts.failed}/${counts.total}` : '失败',
    skipped:
      counts.skipped > 0 ? `跳过 ${counts.skipped}/${counts.total}` : '已跳过',
    no_target:
      counts.total > 1 ? `无对象 ${counts.noTarget}/${counts.total}` : '无对象',
    waiting: '等待继续执行',
    running: '执行中',
  } satisfies Record<string, string>;

  return {
    kind,
    headline: headlineMap[kind],
    detail:
      task.failureReason || task.diagnostics?.summary || diagnosticSummary,
    nextAction: task.nextAction || defaultNextActionForStatus(task.status),
    evidenceCount,
    recordsHref: `/interaction/records?taskId=${task.id}`,
    evidenceHref: `/local-engine?tab=evidence&taskId=${task.id}`,
    diagnosticsHref: `/local-engine?tab=evidence&taskId=${task.id}&diagnostics=1`,
    counts,
  };
}

export function buildTaskEvidenceReplay(
  this: TaskEvidenceHost,
  task: InteractionTask,
) {
  return (task.steps || []).map((step, index) => ({
    seq: index + 1,
    stageKey: step.key,
    label: step.label,
    status: step.status,
    message: step.message,
    updatedAt: step.updatedAt,
    evidence: task.events
      .filter(
        (event) =>
          event.evidence?.stageKey === step.key ||
          event.message.includes(step.label),
      )
      .map((event) => ({
        eventId: event.id,
        level: event.level,
        message: event.message,
        createdAt: event.createdAt,
        evidence: event.evidence,
      })),
  }));
}

export function buildTaskEvidenceIndex(
  this: TaskEvidenceHost,
  task: InteractionTask,
) {
  const evidenceItems = this.collectTaskEvidence(task);
  const isDesktopEvidenceItem = (item: TaskEvidenceItem[][number]) =>
    item.evidence.type === 'desktop_screenshot' ||
    (taskNeedsDesktopEvidence(task) &&
      item.evidence.type === 'screenshot' &&
      /微信|WeChat|Node Runtime 微信执行截图|node-runtime/i.test(
        `${item.evidence.label || ''} ${item.message || ''}`,
      ));
  return {
    counts: this.groupTaskEvidenceByType(
      evidenceItems.map((item) => item.evidence),
    ),
    stageLogs: this.toTaskEvidenceIndexItems(
      evidenceItems.filter((item) => item.evidence.type === 'stage_log'),
    ),
    failureReasons: this.toTaskEvidenceIndexItems(
      evidenceItems.filter((item) => item.evidence.type === 'failure_reason'),
    ),
    riskAudits: this.toTaskEvidenceIndexItems(
      evidenceItems.filter(
        (item) => item.evidence.type === 'diagnostic_bundle',
      ),
    ),
    confirmations: task.approvalRecord
      ? [
          {
            operator: task.approvalRecord.operator,
            targetConfirmed: task.approvalRecord.targetConfirmed,
            contentConfirmed: task.approvalRecord.contentConfirmed,
            currentWindowConfirmed: task.approvalRecord.currentWindowConfirmed,
            contactConfirmed: task.approvalRecord.contactConfirmed,
            draftBeforeFillConfirmed:
              task.approvalRecord.draftBeforeFillConfirmed,
            confirmedChecklistKeys: task.approvalRecord.confirmedChecklistKeys,
            confirmedAt: task.approvalRecord.confirmedAt,
          },
        ]
      : [],
    browser: this.toTaskEvidenceIndexItems(
      evidenceItems.filter(
        (item) =>
          !isDesktopEvidenceItem(item) &&
          ['screenshot', 'page_snapshot', 'snapshot'].includes(
            item.evidence.type,
          ),
      ),
    ),
    desktop: this.toTaskEvidenceIndexItems(
      evidenceItems.filter(isDesktopEvidenceItem),
    ),
    text: this.toTaskEvidenceIndexItems(
      evidenceItems.filter((item) =>
        ['text', 'file'].includes(item.evidence.type),
      ),
    ),
  };
}

export function collectTaskEvidence(
  this: TaskEvidenceHost,
  task: InteractionTask,
) {
  return task.events
    .filter(
      (
        event,
      ): event is InteractionTaskEvent & {
        evidence: NonNullable<InteractionTaskEvent['evidence']>;
      } => Boolean(event.evidence),
    )
    .map((event) => ({
      eventId: event.id,
      taskId: task.id,
      level: event.level,
      message: event.message,
      createdAt: event.evidence.createdAt || event.createdAt,
      evidence: {
        ...event.evidence,
        id: event.evidence.id || event.id,
        createdAt: event.evidence.createdAt || event.createdAt,
      },
    }));
}

export function toTaskEvidenceIndexItems(
  this: TaskEvidenceHost,
  items: TaskEvidenceItem[],
) {
  return items.map((item) => ({
    id: item.evidence.id,
    eventId: item.eventId,
    type: item.evidence.type,
    label: item.evidence.label,
    level: item.level,
    stageKey: item.evidence.stageKey,
    createdAt: item.createdAt,
    artifactUrl: item.evidence.artifactUrl,
    valuePreview: previewEvidenceValue(item.evidence.value),
  }));
}

export function groupTaskEvidenceByType(
  this: TaskEvidenceHost,
  evidenceItems: InteractionTaskEvent['evidence'][],
) {
  const empty: Record<
    NonNullable<InteractionTaskEvent['evidence']>['type'],
    number
  > = {
    text: 0,
    snapshot: 0,
    screenshot: 0,
    page_snapshot: 0,
    desktop_screenshot: 0,
    stage_log: 0,
    failure_reason: 0,
    diagnostic_bundle: 0,
    file: 0,
  };
  return evidenceItems.filter(Boolean).reduce((acc, item) => {
    acc[item!.type] = (acc[item!.type] || 0) + 1;
    return acc;
  }, empty);
}

export function buildTaskEvidenceIntegrity(
  this: TaskEvidenceHost,
  task: InteractionTask,
  evidenceIndex = this.buildTaskEvidenceIndex(task),
) {
  const hasActionConclusion =
    Boolean(task.nextAction) ||
    (task.status === 'completed' &&
      (Boolean(task.completedAt) ||
        task.steps?.some(
          (step) => step.key === 'send-result' && step.status === 'completed',
        )));
  const missing = [
    this.collectTaskEvidence(task).length ? '' : '缺少证据项',
    evidenceIndex.stageLogs.length ? '' : '缺少阶段日志',
    task.failureReason ||
    task.status !== 'failed' ||
    evidenceIndex.failureReasons.length
      ? ''
      : '缺少失败原因',
    hasActionConclusion ? '' : '缺少 nextAction',
    task.riskPolicy ? '' : '缺少风险审计',
    task.sendMode === 'approval-send'
      ? evidenceIndex.confirmations.length || task.status !== 'completed'
        ? ''
        : '缺少确认记录'
      : '',
    taskNeedsBrowserEvidence(task) && !evidenceIndex.browser.length
      ? '缺少浏览器证据索引'
      : '',
    taskNeedsDesktopEvidence(task) && !evidenceIndex.desktop.length
      ? '缺少桌面证据索引'
      : '',
    evidenceIndex.text.length ? '' : '缺少文本证据索引',
  ].filter(Boolean);

  return {
    status: missing.length ? ('FAILED' as const) : ('OK' as const),
    missing,
    required: [
      '阶段日志',
      '失败原因',
      'nextAction',
      '风险审计',
      '确认记录',
      '浏览器/桌面/文本证据索引',
    ],
    checkedAt: new Date().toISOString(),
  };
}

export async function ensureTaskEvidenceForExport(
  this: TaskEvidenceHost,
  task: InteractionTask,
  stageKey: string,
) {
  const integrity = this.buildTaskEvidenceIntegrity(task);
  if (integrity.status === 'OK') {
    return;
  }

  const reason = `证据链不完整：${integrity.missing.join('、')}`;
  const terminalStatuses: InteractionTaskStatus[] = [
    'completed',
    'failed',
    'blocked',
    'skipped',
    'no_target',
  ];
  const preserveExternalBlocker =
    terminalStatuses.includes(task.status) &&
    shouldPreserveEvidenceIntegrityBlocker(task);
  const preserveCompletedBusinessResult =
    terminalStatuses.includes(task.status) &&
    shouldPreserveCompletedBusinessResult(task);
  const completedWithOnlyActionConclusionMissing =
    task.status === 'completed' &&
    integrity.missing.length === 1 &&
    integrity.missing[0] === '缺少 nextAction';
  if (
    terminalStatuses.includes(task.status) &&
    !preserveExternalBlocker &&
    !preserveCompletedBusinessResult &&
    !completedWithOnlyActionConclusionMissing
  ) {
    this.markQueuedBatchTargets(task, 'failed', reason, {
      nextAction: '导出证据链不完整，请重新执行任务并保留证据。',
    });
    task.status = 'failed';
    task.statusLabel = this.resolveStatusLabel('failed');
    task.failureReason = task.failureReason || reason;
    task.nextAction =
      '导出证据链不完整，已标记 FAILED；请重新执行任务并确认阶段日志、确认记录和平台证据已生成。';
    task.completedAt = task.completedAt || new Date().toISOString();
  }
  if (completedWithOnlyActionConclusionMissing) {
    task.nextAction = '已完成，可在任务证据里查看发送和回读结果。';
    await this.persistTask(task);
    return;
  }
  const eventLevel =
    preserveExternalBlocker || preserveCompletedBusinessResult
      ? 'warning'
      : 'error';
  const eventLabel =
    preserveExternalBlocker || preserveCompletedBusinessResult
      ? '证据导出提醒'
      : '证据导出失败';
  this.pushEvent(task, eventLevel, reason, {
    type: 'failure_reason',
    label: eventLabel,
    value: reason,
    stageKey,
  });
  if (!integrity.missing.includes('缺少阶段日志')) {
    await this.persistTask(task);
    return;
  }
  this.pushEvent(
    task,
    eventLevel,
    preserveExternalBlocker || preserveCompletedBusinessResult
      ? '阶段日志缺失，已保留原始任务状态。'
      : '阶段日志缺失，证据导出已标记 FAILED。',
    {
      type: 'stage_log',
      label: eventLabel,
      value: `${stageKey} / FAILED / ${reason}`,
      stageKey,
    },
  );
  await this.persistTask(task);
}

export function repairEvidenceIntegrityOnlyFailureTask(
  this: TaskEvidenceHost,
  task: InteractionTask,
) {
  if (task.status !== 'failed') {
    return false;
  }
  if (!shouldPreserveCompletedBusinessResult(task)) {
    return false;
  }

  const summaryFailed = Number(task.batchSummary?.failed || 0);
  const summaryNoTarget = Number(task.batchSummary?.noTarget || 0);
  const summarySkipped = Number(task.batchSummary?.skipped || 0);
  const targetHasRealFailure = Boolean(
    task.batchTargets?.some((target) =>
      ['failed', 'blocked', 'no_target'].includes(target.status),
    ),
  );
  if (
    summaryFailed > 0 ||
    summaryNoTarget > 0 ||
    summarySkipped > 0 ||
    targetHasRealFailure
  ) {
    return false;
  }

  const evidenceIntegritySignals = [
    task.failureReason,
    task.nextAction,
    task.resultSummary?.detail,
    task.resultSummary?.nextAction,
    task.diagnostics?.summary,
    task.diagnostics?.failureReason,
    ...(task.batchTargets || []).flatMap((target) => [target.failureReason]),
  ].filter(Boolean);
  const evidenceIntegrityOnly =
    evidenceIntegritySignals.length > 0 &&
    evidenceIntegritySignals.every((value) =>
      /证据链不完整|导出证据链不完整/.test(String(value)),
    );
  if (!evidenceIntegrityOnly) {
    return false;
  }

  const now = new Date().toISOString();
  task.status = 'completed';
  task.statusLabel = this.resolveStatusLabel('completed');
  task.failureReason = undefined;
  task.failureContext = undefined;
  task.blockers = undefined;
  task.nextAction =
    task.batchTargets?.find((target) => target.nextAction)?.nextAction ||
    '已完成，可在任务证据里查看发送和回读结果。';
  task.completedAt = task.completedAt || now;
  task.batchTargets = task.batchTargets?.map((target) => ({
    ...target,
    status: target.status === 'completed' ? target.status : 'completed',
    failureReason: undefined,
    nextAction:
      target.nextAction &&
      !/证据链不完整|导出证据链不完整/.test(target.nextAction)
        ? target.nextAction
        : '已完成，可在任务证据里查看发送和回读结果。',
    updatedAt: target.updatedAt || now,
  }));
  task.batchSummary = buildBatchSummary(task.batchTargets || []);
  task.steps = task.steps?.map((step) =>
    step.status === 'blocked' &&
    /证据链不完整|导出证据链不完整/.test(step.message)
      ? {
          ...step,
          status: 'completed',
          message: '已完成，可在任务证据里查看发送和回读结果。',
          updatedAt: step.updatedAt || now,
        }
      : step,
  );
  return true;
}

export const taskEvidenceMethods = {
  updateTask,
  pushEvent,
  createTaskSteps,
  setTaskStep,
  refreshTaskDiagnostics,
  buildTaskResultSummary,
  buildTaskEvidenceReplay,
  buildTaskEvidenceIndex,
  collectTaskEvidence,
  toTaskEvidenceIndexItems,
  groupTaskEvidenceByType,
  buildTaskEvidenceIntegrity,
  ensureTaskEvidenceForExport,
  repairEvidenceIntegrityOnlyFailureTask,
};
