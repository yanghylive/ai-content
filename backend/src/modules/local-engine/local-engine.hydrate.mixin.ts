/**
 * 存储/水合簇 mixin（任务持久化水合/normalize 系列）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { PrismaService } from '../../prisma/prisma.service';

import {
  buildBatchSummary,
  defaultNextActionForStatus,
  isDesktopInteractionTask,
  isEvidenceIntegrityText,
  normalizeBatchTargetStatus,
  normalizeTaskDisplayText,
  optionalNumber,
  optionalTrimmedText,
  toNonNegativeInteger,
} from './local-engine.utils';
import type {
  AgentRiskLevel,
  InteractionBatchTarget,
  InteractionGroupBroadcastPlanStatus,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskBillingIdentity,
  InteractionTaskEvent,
  InteractionTaskListFilter,
  InteractionTaskResultSummary,
  InteractionTaskStatus,
  InteractionTaskSummaryRow,
  InteractionTaskType,
  LocalEngineRiskPolicy,
  LocalEngineTenantScope,
} from './local-engine.types';

/** 存储/水合簇的 host 接口 */
export interface HydrateHost {
  prisma: PrismaService;
  tasks: Map<string, InteractionTask>;
  taskStatusFromPrisma: Record<string, string>;
  taskStatusToPrisma: Record<string, string>;
  taskTypeFromPrisma: Record<string, string>;
  taskTypeToPrisma: Record<string, string>;
  hydrateTasksFromStore(limit?: unknown): Promise<void>;
  listStoredTaskSummaries(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]>;
  mergeTaskSummaries(
    storedTasks: InteractionTask[],
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]>;
  normalizeTaskForDisplay(task: InteractionTask): InteractionTask;
  toStoredTaskSummary(row: InteractionTaskSummaryRow): InteractionTask;
  normalizeStoredTaskEvents(
    sources: unknown[],
    taskId: string,
    fallbackCreatedAt: string,
  ): InteractionTaskEvent[];
  repairHydratedTaskEvidence(
    row: InteractionTaskSummaryRow,
    task: InteractionTask,
  ): Promise<void>;
  cleanEvidenceIntegrityText(value: unknown): string | undefined;
  taskHasEvidenceIntegrityText(task: InteractionTask): boolean;
  normalizeStoredTaskEvent(
    input: unknown,
    taskId: string,
    fallbackCreatedAt: string,
    index: number,
  ): InteractionTaskEvent | null;
  isStoredEvidenceIntegrityBackfill(
    record: Record<string, unknown>,
    evidence: InteractionTaskEvent['evidence'],
    message: string,
  ): boolean;
  normalizeStoredTaskEvidence(
    input: unknown,
    fallbackCreatedAt: string,
  ): InteractionTaskEvent['evidence'] | undefined;
  normalizeStoredEventLevel(value: unknown): InteractionTaskEvent['level'];
  normalizeStoredEvidenceType(
    value: string | undefined,
  ): NonNullable<InteractionTaskEvent['evidence']>['type'] | undefined;
  ensureStoredSummaryEvidenceEvents(
    events: InteractionTaskEvent[],
    context: {
      taskId: string;
      type: InteractionTaskType;
      status: InteractionTaskStatus;
      stage: string;
      targetName: string;
      sourceText: string;
      replyText: string;
      failureReason?: string;
      nextAction: string;
      updatedAt: string;
    },
  ): InteractionTaskEvent[];
  countStoredTaskSummaryEvidence(input: {
    batchTargets?: InteractionBatchTarget[];
    diagnostics?: Partial<NonNullable<InteractionTask['diagnostics']>>;
    events?: InteractionTaskEvent[];
    resultSummary?: Partial<InteractionTaskResultSummary>;
  }): number;
  normalizeStoredTaskType(value: unknown): InteractionTaskType;
  normalizeStoredTaskStatus(value: unknown): InteractionTaskStatus;
  isKnownInteractionTaskStatus(status: string): status is InteractionTaskStatus;
  normalizeStoredRiskLevel(value: string): AgentRiskLevel;
  createStoredSummaryRiskPolicy(
    riskLevel: AgentRiskLevel,
    targetName: string,
    createdAt: string,
  ): LocalEngineRiskPolicy;
  normalizeStoredTaskSummaryTargets(
    value: unknown,
    taskStatus?: InteractionTaskStatus,
  ): InteractionBatchTarget[];
  normalizeStoredSummaryTargetStatus(
    status: InteractionBatchTarget['status'],
    taskStatus?: InteractionTaskStatus,
  ): InteractionBatchTarget['status'];
  normalizeStoredTaskSummaryValue(
    value: unknown,
  ): InteractionTask['batchSummary'];
  isInTenantScope(
    record: { tenantId?: string | null; userId?: string | null },
    scope: LocalEngineTenantScope,
  );
  isKnownInteractionTaskType(type: string): type is InteractionTaskType;
  isLiveExecutorTask(type: InteractionTaskType): boolean;
  isSendMode(value: unknown): value is InteractionSendMode;
  normalizeInteractionTaskBillingIdentity(
    value: unknown,
  ): InteractionTaskBillingIdentity | undefined;
  normalizeStoredBatchTargets(task: InteractionTask);
  refreshTaskDiagnostics(task: InteractionTask): void;
  repairEvidenceIntegrityOnlyFailureTask(task: InteractionTask): boolean;
  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  ): InteractionGroupBroadcastPlanStatus | undefined;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resolveSummaryDiagnosticStatus(
    status: InteractionTaskStatus,
  ): NonNullable<InteractionTask['diagnostics']>['status'];
  resolveSummaryPlatformName(type: InteractionTaskType): string | undefined;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  resolveTypeLabel(type: InteractionTaskType): string;
}

export async function hydrateTasksFromStore(this: HydrateHost, limit = 50) {
  const scope = await this.resolveTenantScope();
  const rows = await this.prisma.interactionTask.findMany({
    where: scope,
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
  });

  rows.forEach((row) => {
    const task = row.config as InteractionTask | null;
    if (task?.id) {
      task.tenantId = row.tenantId;
      task.userId = row.userId;
      this.normalizeStoredBatchTargets(task);
      this.repairEvidenceIntegrityOnlyFailureTask(task);
      void this.repairHydratedTaskEvidence(
        row as InteractionTaskSummaryRow,
        task,
      );
      this.refreshTaskDiagnostics(task);
      this.tasks.set(task.id, task);
    }
  });
}

export async function listStoredTaskSummaries(
  this: HydrateHost,
  limit = 50,
  filter: InteractionTaskListFilter = {},
  types?: InteractionTaskType[],
): Promise<InteractionTask[]> {
  const scope = await this.resolveTenantScope();
  const where: Record<string, unknown> = { ...scope };
  const prismaTypes = (types?.length ? types : filter.type ? [filter.type] : [])
    .map((type) => this.taskTypeToPrisma[type] || type)
    .filter(Boolean);
  if (prismaTypes.length === 1) {
    where.taskType = prismaTypes[0];
  } else if (prismaTypes.length > 1) {
    where.taskType = { in: prismaTypes };
  }
  if (filter.status) {
    where.status = this.taskStatusToPrisma[filter.status] || filter.status;
  } else if (filter.recordsOnly) {
    where.status = {
      in: ['COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED', 'NO_TARGET'],
    };
  }

  const rows = await this.prisma.interactionTask.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
    select: {
      id: true,
      tenantId: true,
      userId: true,
      taskType: true,
      accountId: true,
      sendMode: true,
      status: true,
      riskLevel: true,
      stage: true,
      currentTarget: true,
      draftText: true,
      processedCount: true,
      failedCount: true,
      skippedCount: true,
      batchTargets: true,
      batchSummary: true,
      config: true,
      createdBy: true,
      localTaskId: true,
      requiresDoubleConfirmation: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => this.toStoredTaskSummary(row));
}

export async function mergeTaskSummaries(
  this: HydrateHost,
  storedTasks: InteractionTask[],
  filter: InteractionTaskListFilter = {},
  types?: InteractionTaskType[],
) {
  const scope = await this.resolveTenantScope();
  const allowedTypes = types?.length ? new Set(types) : undefined;
  const merged = new Map<string, InteractionTask>();
  for (const task of storedTasks) {
    merged.set(task.id, task);
  }
  for (const task of this.tasks.values()) {
    if (!this.isInTenantScope(task, scope)) continue;
    if (filter.type && task.type !== filter.type) continue;
    if (allowedTypes && !allowedTypes.has(task.type)) continue;
    if (filter.status && task.status !== filter.status) continue;
    if (
      filter.recordsOnly &&
      !['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
        task.status,
      )
    ) {
      continue;
    }
    merged.set(task.id, task);
  }
  return [...merged.values()];
}

export function normalizeTaskForDisplay(
  this: HydrateHost,
  task: InteractionTask,
): InteractionTask {
  const {
    billingIdentity: _billingIdentity,
    tenantId: _tenantId,
    userId: _userId,
    ...publicTask
  } = task as InteractionTask & { billingIdentity?: unknown };
  const needsEvidenceIntegrityRepair = this.taskHasEvidenceIntegrityText(task);
  const displayNextAction =
    this.cleanEvidenceIntegrityText(task.nextAction) ||
    defaultNextActionForStatus(task.status);
  const displayFailureReason =
    this.cleanEvidenceIntegrityText(task.failureReason) ||
    this.cleanEvidenceIntegrityText(task.diagnostics?.failureReason) ||
    this.cleanEvidenceIntegrityText(
      task.batchTargets?.find((target) => target.failureReason)?.failureReason,
    ) ||
    (needsEvidenceIntegrityRepair &&
    (task.status === 'failed' || task.status === 'blocked')
      ? `${this.resolveTypeLabel(task.type)}停在${task.diagnostics?.currentStep || task.steps?.find((step) => step.status === 'blocked')?.label || '执行阶段'}。`
      : undefined);
  const displayEvents = needsEvidenceIntegrityRepair
    ? this.ensureStoredSummaryEvidenceEvents(
        this.normalizeStoredTaskEvents([task.events], task.id, task.updatedAt),
        {
          taskId: task.id,
          type: task.type,
          status: task.status,
          stage:
            task.diagnostics?.currentStep ||
            task.steps?.find((step) => step.status === 'blocked')?.key ||
            'summary',
          targetName: task.targetName,
          sourceText: task.sourceText,
          replyText: task.replyText,
          failureReason: displayFailureReason,
          nextAction: displayNextAction,
          updatedAt: task.updatedAt,
        },
      )
    : task.events;
  return {
    ...publicTask,
    statusLabel: normalizeTaskDisplayText(
      task.statusLabel || this.resolveStatusLabel(task.status),
    ),
    failureReason: displayFailureReason
      ? normalizeTaskDisplayText(displayFailureReason)
      : undefined,
    nextAction: displayNextAction
      ? normalizeTaskDisplayText(displayNextAction)
      : undefined,
    failureContext: task.failureContext
      ? {
          ...task.failureContext,
          stage: task.failureContext.stage
            ? normalizeTaskDisplayText(task.failureContext.stage)
            : undefined,
          reason: normalizeTaskDisplayText(task.failureContext.reason),
          nextAction: task.failureContext.nextAction
            ? normalizeTaskDisplayText(task.failureContext.nextAction)
            : undefined,
        }
      : undefined,
    blockers: task.blockers?.map((blocker) => ({
      ...blocker,
      stage: normalizeTaskDisplayText(blocker.stage || '执行阶段'),
      reason: normalizeTaskDisplayText(blocker.reason),
      nextAction: blocker.nextAction
        ? normalizeTaskDisplayText(blocker.nextAction)
        : defaultNextActionForStatus(task.status),
    })),
    batchTargets: task.batchTargets?.map((target) => ({
      ...target,
      failureReason: target.failureReason
        ? normalizeTaskDisplayText(target.failureReason)
        : undefined,
      nextAction: target.nextAction
        ? normalizeTaskDisplayText(target.nextAction)
        : undefined,
    })),
    diagnostics: task.diagnostics
      ? {
          ...task.diagnostics,
          summary: normalizeTaskDisplayText(task.diagnostics.summary),
          currentStep: task.diagnostics.currentStep
            ? normalizeTaskDisplayText(task.diagnostics.currentStep)
            : undefined,
          currentStepMessage: task.diagnostics.currentStepMessage
            ? normalizeTaskDisplayText(task.diagnostics.currentStepMessage)
            : undefined,
          failureReason: displayFailureReason
            ? normalizeTaskDisplayText(displayFailureReason)
            : undefined,
          nextAction: displayNextAction
            ? normalizeTaskDisplayText(displayNextAction)
            : undefined,
          evidenceCount: needsEvidenceIntegrityRepair
            ? displayEvents.filter((event) => Boolean(event.evidence)).length
            : task.diagnostics.evidenceCount,
        }
      : undefined,
    resultSummary: task.resultSummary
      ? {
          ...task.resultSummary,
          headline: normalizeTaskDisplayText(task.resultSummary.headline),
          detail: normalizeTaskDisplayText(
            this.cleanEvidenceIntegrityText(task.resultSummary.detail) ||
              displayFailureReason ||
              task.resultSummary.detail,
          ),
          nextAction: normalizeTaskDisplayText(
            this.cleanEvidenceIntegrityText(task.resultSummary.nextAction) ||
              displayNextAction,
          ),
          evidenceCount: needsEvidenceIntegrityRepair
            ? displayEvents.filter((event) => Boolean(event.evidence)).length
            : task.resultSummary.evidenceCount,
        }
      : undefined,
    steps: task.steps?.map((step) => ({
      ...step,
      key: normalizeTaskDisplayText(step.key),
      label: normalizeTaskDisplayText(step.label),
      message: normalizeTaskDisplayText(step.message),
    })),
    events: displayEvents.map((event) => ({
      ...event,
      message: normalizeTaskDisplayText(event.message),
      evidence: event.evidence
        ? {
            ...event.evidence,
            label: event.evidence.label
              ? normalizeTaskDisplayText(event.evidence.label)
              : event.evidence.label,
            value:
              typeof event.evidence.value === 'string'
                ? normalizeTaskDisplayText(event.evidence.value)
                : event.evidence.value,
          }
        : undefined,
    })),
  };
}

export function toStoredTaskSummary(
  this: HydrateHost,
  row: InteractionTaskSummaryRow,
): InteractionTask {
  const storedConfig =
    row.config && typeof row.config === 'object' && !Array.isArray(row.config)
      ? (row.config as unknown as Partial<InteractionTask>)
      : undefined;
  const type = this.normalizeStoredTaskType(row.taskType);
  const status = this.normalizeStoredTaskStatus(row.status);
  const batchTargets = this.normalizeStoredTaskSummaryTargets(
    storedConfig?.batchTargets || row.batchTargets,
    status,
  );
  const primaryTarget = batchTargets[0];
  const batchSummary =
    this.normalizeStoredTaskSummaryValue(row.batchSummary) ||
    (batchTargets.length
      ? buildBatchSummary(batchTargets)
      : {
          total:
            row.processedCount + row.failedCount + row.skippedCount > 0
              ? row.processedCount + row.failedCount + row.skippedCount
              : 0,
          queued: 0,
          running: 0,
          waitingConfirmation: 0,
          completed: Math.max(
            0,
            row.processedCount - row.failedCount - row.skippedCount,
          ),
          failed: row.failedCount,
          skipped: row.skippedCount,
          noTarget: status === 'no_target' ? 1 : 0,
        });
  const createdAt = row.createdAt.toISOString();
  const updatedAt = row.updatedAt.toISOString();
  const targetName =
    primaryTarget?.targetName || row.currentTarget || '未记录对象';
  const sourceText = primaryTarget?.sourceText || row.currentTarget || '';
  const replyText = primaryTarget?.replyText || row.draftText || '';
  const riskLevel = this.normalizeStoredRiskLevel(row.riskLevel);
  const nextAction =
    this.cleanEvidenceIntegrityText(storedConfig?.nextAction) ||
    primaryTarget?.nextAction ||
    defaultNextActionForStatus(status);
  const failureReason =
    this.cleanEvidenceIntegrityText(storedConfig?.failureReason) ||
    this.cleanEvidenceIntegrityText(primaryTarget?.failureReason) ||
    this.cleanEvidenceIntegrityText(storedConfig?.diagnostics?.failureReason) ||
    (status === 'failed' || status === 'blocked'
      ? `${this.resolveTypeLabel(type)}停在${row.stage || '执行阶段'}。`
      : undefined);
  const storedEvidenceColumns = row as {
    events?: unknown;
    evidence?: unknown;
  };
  const events = this.ensureStoredSummaryEvidenceEvents(
    this.normalizeStoredTaskEvents(
      [
        storedConfig?.events,
        storedEvidenceColumns.events,
        storedEvidenceColumns.evidence,
      ],
      row.id,
      updatedAt,
    ),
    {
      taskId: row.id,
      type,
      status,
      stage: row.stage || 'summary',
      targetName,
      sourceText,
      replyText,
      failureReason,
      nextAction,
      updatedAt,
    },
  );
  const evidenceCount = this.countStoredTaskSummaryEvidence({
    batchTargets,
    diagnostics: storedConfig?.diagnostics,
    events,
    resultSummary: storedConfig?.resultSummary,
  });
  const riskPolicy =
    storedConfig?.riskPolicy ||
    this.createStoredSummaryRiskPolicy(riskLevel, targetName, updatedAt);
  const task: InteractionTask = {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    type,
    typeLabel: this.resolveTypeLabel(type),
    status,
    statusLabel: this.resolveStatusLabel(status),
    planName: optionalTrimmedText(storedConfig?.planName),
    planTime: optionalTrimmedText(storedConfig?.planTime),
    planStatus: this.resolveGroupBroadcastPlanStatus(
      type,
      status,
      storedConfig?.planStatus,
      storedConfig?.planTime,
    ),
    dailyLimit: optionalNumber(storedConfig?.dailyLimit),
    associatedWeChat: optionalTrimmedText(storedConfig?.associatedWeChat),
    currentWechatId: optionalTrimmedText(storedConfig?.currentWechatId),
    plannedWechatId: optionalTrimmedText(storedConfig?.plannedWechatId),
    generateOnDemand:
      typeof storedConfig?.generateOnDemand === 'boolean'
        ? storedConfig.generateOnDemand
        : undefined,
    accountId: row.accountId || undefined,
    accountName: row.createdBy || row.accountId || '未指定账号',
    platformName: this.resolveSummaryPlatformName(type),
    targetName,
    sourceText,
    replyText,
    sendMode: this.isSendMode(row.sendMode) ? row.sendMode : 'approval-send',
    riskLevel,
    requiresDoubleConfirmation: row.requiresDoubleConfirmation,
    executionMode: isDesktopInteractionTask(type)
      ? 'browser-assisted'
      : 'internal-record',
    runtimeState: this.isLiveExecutorTask(type)
      ? 'preflight_only'
      : 'record_ready',
    createdAt,
    updatedAt,
    failureReason,
    nextAction,
    batchTargets,
    batchSummary,
    billingIdentity: this.normalizeInteractionTaskBillingIdentity(
      storedConfig?.billingIdentity,
    ),
    riskPolicy,
    diagnostics: {
      status: this.resolveSummaryDiagnosticStatus(status),
      summary: `${this.resolveTypeLabel(type)}${row.stage ? ` / ${row.stage}` : ''}`,
      account: row.accountId || row.createdBy || '未指定账号',
      platform: this.resolveSummaryPlatformName(type) || '',
      currentStep: row.stage || undefined,
      currentStepStatus:
        status === 'failed' || status === 'blocked'
          ? 'blocked'
          : status === 'completed'
            ? 'completed'
            : status === 'running'
              ? 'running'
              : 'pending',
      failureReason,
      nextAction,
      evidenceCount,
      lastEventAt: updatedAt,
    },
    resultSummary: storedConfig?.resultSummary
      ? {
          ...storedConfig.resultSummary,
          evidenceCount: Math.max(
            toNonNegativeInteger(storedConfig.resultSummary.evidenceCount),
            evidenceCount,
          ),
        }
      : evidenceCount > 0
        ? {
            kind:
              status === 'completed'
                ? 'success'
                : status === 'no_target'
                  ? 'no_target'
                  : status === 'skipped'
                    ? 'skipped'
                    : status === 'failed' || status === 'blocked'
                      ? 'failure'
                      : status === 'waiting_for_send_confirmation'
                        ? 'waiting'
                        : 'running',
            headline: this.resolveStatusLabel(status),
            detail: `${this.resolveTypeLabel(type)}${row.stage ? ` / ${row.stage}` : ''}`,
            nextAction,
            evidenceCount,
            recordsHref: `/interaction/records?taskId=${row.id}`,
            evidenceHref: `/local-engine?tab=evidence&taskId=${row.id}`,
            diagnosticsHref: `/local-engine?tab=evidence&taskId=${row.id}&diagnostics=1`,
            counts: {
              total: batchSummary.total || batchTargets.length || 1,
              completed: batchSummary.completed || 0,
              failed: batchSummary.failed || 0,
              skipped: batchSummary.skipped || 0,
              noTarget: batchSummary.noTarget || 0,
            },
          }
        : undefined,
    steps: row.stage
      ? [
          {
            key: row.stage,
            label: row.stage,
            status:
              status === 'failed' || status === 'blocked'
                ? 'blocked'
                : status === 'completed'
                  ? 'completed'
                  : status === 'running'
                    ? 'running'
                    : 'pending',
            message: `${this.resolveStatusLabel(status)} / ${targetName}`,
            updatedAt,
          },
        ]
      : [],
    events,
  };

  this.repairEvidenceIntegrityOnlyFailureTask(task);
  return task;
}

export function normalizeStoredTaskEvents(
  this: HydrateHost,
  sources: unknown[],
  taskId: string,
  fallbackCreatedAt: string,
): InteractionTaskEvent[] {
  const events: InteractionTaskEvent[] = [];
  let index = 0;
  for (const source of sources) {
    if (!Array.isArray(source)) {
      continue;
    }
    for (const item of source) {
      const event = this.normalizeStoredTaskEvent(
        item,
        taskId,
        fallbackCreatedAt,
        index,
      );
      index += 1;
      if (event) {
        events.push(event);
      }
    }
  }

  const unique = new Map<string, InteractionTaskEvent>();
  events.forEach((event) => {
    if (!unique.has(event.id)) {
      unique.set(event.id, event);
    }
  });
  return [...unique.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function repairHydratedTaskEvidence(
  this: HydrateHost,
  row: InteractionTaskSummaryRow,
  task: InteractionTask,
) {
  const updatedAt = row.updatedAt.toISOString();
  const primaryTarget = task.batchTargets?.[0];
  const nextAction =
    this.cleanEvidenceIntegrityText(task.nextAction) ||
    this.cleanEvidenceIntegrityText(primaryTarget?.nextAction) ||
    defaultNextActionForStatus(task.status);
  const failureReason =
    this.cleanEvidenceIntegrityText(task.failureReason) ||
    this.cleanEvidenceIntegrityText(task.diagnostics?.failureReason) ||
    this.cleanEvidenceIntegrityText(primaryTarget?.failureReason) ||
    (task.status === 'failed' || task.status === 'blocked'
      ? `${this.resolveTypeLabel(task.type)}停在${row.stage || task.diagnostics?.currentStep || '执行阶段'}。`
      : undefined);
  const stage =
    row.stage ||
    task.diagnostics?.currentStep ||
    task.steps?.find((step) => step.status === 'blocked')?.key ||
    'summary';

  task.nextAction = nextAction;
  if (failureReason) {
    task.failureReason = failureReason;
  } else if (isEvidenceIntegrityText(task.failureReason)) {
    task.failureReason = undefined;
  }
  const storedEvidenceColumns = row as {
    events?: unknown;
    evidence?: unknown;
  };
  task.events = this.ensureStoredSummaryEvidenceEvents(
    this.normalizeStoredTaskEvents(
      [
        task.events,
        storedEvidenceColumns.events,
        storedEvidenceColumns.evidence,
      ],
      task.id,
      updatedAt,
    ),
    {
      taskId: task.id,
      type: task.type,
      status: task.status,
      stage,
      targetName: task.targetName,
      sourceText: task.sourceText,
      replyText: task.replyText,
      failureReason,
      nextAction,
      updatedAt,
    },
  );
  task.riskPolicy =
    task.riskPolicy ||
    this.createStoredSummaryRiskPolicy(
      task.riskLevel || this.normalizeStoredRiskLevel(row.riskLevel),
      task.targetName,
      updatedAt,
    );
}

export function cleanEvidenceIntegrityText(this: HydrateHost, value: unknown) {
  const text = optionalTrimmedText(value);
  return text && !isEvidenceIntegrityText(text) ? text : undefined;
}

export function taskHasEvidenceIntegrityText(
  this: HydrateHost,
  task: InteractionTask,
) {
  return [
    task.failureReason,
    task.nextAction,
    task.diagnostics?.failureReason,
    task.diagnostics?.summary,
    task.resultSummary?.detail,
    task.resultSummary?.nextAction,
    ...(task.batchTargets || []).flatMap((target) => [
      target.failureReason,
      target.nextAction,
    ]),
    ...(task.events || []).flatMap((event) => [
      event.message,
      event.evidence?.label,
      event.evidence?.value,
    ]),
  ].some((value) => isEvidenceIntegrityText(value));
}

export function normalizeStoredTaskEvent(
  this: HydrateHost,
  input: unknown,
  taskId: string,
  fallbackCreatedAt: string,
  index: number,
): InteractionTaskEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const evidence =
    this.normalizeStoredTaskEvidence(record.evidence, fallbackCreatedAt) ||
    this.normalizeStoredTaskEvidence(record, fallbackCreatedAt);
  const createdAt =
    optionalTrimmedText(record.createdAt) ||
    evidence?.createdAt ||
    fallbackCreatedAt;
  const message =
    optionalTrimmedText(record.message) ||
    evidence?.label ||
    evidence?.value?.toString() ||
    '历史任务证据';
  if (this.isStoredEvidenceIntegrityBackfill(record, evidence, message)) {
    return null;
  }
  const level = this.normalizeStoredEventLevel(record.level);
  return {
    id: optionalTrimmedText(record.id) || `${taskId}-stored-event-${index + 1}`,
    taskId: optionalTrimmedText(record.taskId) || taskId,
    level,
    message,
    createdAt,
    evidence,
  };
}

export function isStoredEvidenceIntegrityBackfill(
  this: HydrateHost,
  record: Record<string, unknown>,
  evidence: InteractionTaskEvent['evidence'],
  message: string,
) {
  const text = [message, evidence?.label, evidence?.value, record.message]
    .filter(Boolean)
    .join('\n');
  const stageKey = evidence?.stageKey || optionalTrimmedText(record.stageKey);
  return (
    stageKey === 'records-export' &&
    /证据链不完整|阶段日志缺失|证据导出/.test(text)
  );
}

export function normalizeStoredTaskEvidence(
  this: HydrateHost,
  input: unknown,
  fallbackCreatedAt: string,
): InteractionTaskEvent['evidence'] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const rawType = optionalTrimmedText(record.type);
  const type = this.normalizeStoredEvidenceType(rawType);
  if (!type) {
    return undefined;
  }
  return {
    id: optionalTrimmedText(record.id),
    type,
    label:
      optionalTrimmedText(record.label) ||
      optionalTrimmedText(record.message) ||
      '历史任务证据',
    value:
      typeof record.value === 'string'
        ? record.value
        : record.value == null
          ? ''
          : JSON.stringify(record.value),
    artifactUrl:
      optionalTrimmedText(record.artifactUrl) ||
      optionalTrimmedText(record.path),
    stageKey: optionalTrimmedText(record.stageKey),
    createdAt: optionalTrimmedText(record.createdAt) || fallbackCreatedAt,
  };
}

export function normalizeStoredEventLevel(
  this: HydrateHost,
  value: unknown,
): InteractionTaskEvent['level'] {
  return value === 'success' ||
    value === 'warning' ||
    value === 'error' ||
    value === 'info'
    ? value
    : 'info';
}

export function normalizeStoredEvidenceType(
  this: HydrateHost,
  value: string | undefined,
): NonNullable<InteractionTaskEvent['evidence']>['type'] | undefined {
  const allowed: Array<NonNullable<InteractionTaskEvent['evidence']>['type']> =
    [
      'text',
      'snapshot',
      'screenshot',
      'page_snapshot',
      'desktop_screenshot',
      'stage_log',
      'failure_reason',
      'diagnostic_bundle',
      'file',
    ];
  return allowed.find((type) => type === value);
}

export function ensureStoredSummaryEvidenceEvents(
  this: HydrateHost,
  events: InteractionTaskEvent[],
  context: {
    taskId: string;
    type: InteractionTaskType;
    status: InteractionTaskStatus;
    stage: string;
    targetName: string;
    sourceText: string;
    replyText: string;
    failureReason?: string;
    nextAction: string;
    updatedAt: string;
  },
) {
  const result = [...events];
  const hasEvidenceType = (
    type: NonNullable<InteractionTaskEvent['evidence']>['type'],
  ) => result.some((event) => event.evidence?.type === type);
  const pushSummaryEvidence = (
    suffix: string,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence: NonNullable<InteractionTaskEvent['evidence']>,
  ) => {
    result.push({
      id: `${context.taskId}-summary-${suffix}`,
      taskId: context.taskId,
      level,
      message,
      evidence,
      createdAt: context.updatedAt,
    });
  };

  if (!hasEvidenceType('stage_log')) {
    pushSummaryEvidence('stage-log', 'info', '历史任务阶段日志已补齐。', {
      type: 'stage_log',
      label: '历史任务阶段',
      value: `${context.stage} / ${context.status}`,
      stageKey: context.stage,
      createdAt: context.updatedAt,
    });
  }
  if (
    (context.status === 'failed' || context.status === 'blocked') &&
    !hasEvidenceType('failure_reason')
  ) {
    pushSummaryEvidence(
      'failure-reason',
      'warning',
      context.failureReason || '历史失败原因已补齐。',
      {
        type: 'failure_reason',
        label: '历史失败原因',
        value: context.failureReason || '历史任务失败或被阻断。',
        stageKey: context.stage,
        createdAt: context.updatedAt,
      },
    );
  }
  if (!hasEvidenceType('text')) {
    pushSummaryEvidence('text', 'info', '历史任务文本摘要已补齐。', {
      type: 'text',
      label: '历史任务摘要',
      value: JSON.stringify(
        {
          type: this.resolveTypeLabel(context.type),
          status: context.status,
          stage: context.stage,
          targetName: context.targetName,
          sourceText: context.sourceText,
          replyText: context.replyText,
          failureReason: context.failureReason,
          nextAction: context.nextAction,
        },
        null,
        2,
      ),
      stageKey: context.stage,
      createdAt: context.updatedAt,
    });
  }
  return result.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function countStoredTaskSummaryEvidence(
  this: HydrateHost,
  input: {
    batchTargets?: InteractionBatchTarget[];
    diagnostics?: Partial<NonNullable<InteractionTask['diagnostics']>>;
    events?: InteractionTaskEvent[];
    resultSummary?: Partial<InteractionTaskResultSummary>;
  },
) {
  const eventEvidenceCount = Array.isArray(input.events)
    ? input.events.filter((event) => Boolean(event?.evidence)).length
    : 0;
  const targetEvidenceIds = new Set<string>();
  input.batchTargets?.forEach((target) => {
    target.evidenceEventIds?.forEach((id) => {
      if (id) targetEvidenceIds.add(id);
    });
  });

  return Math.max(
    eventEvidenceCount,
    targetEvidenceIds.size,
    toNonNegativeInteger(input.diagnostics?.evidenceCount),
    toNonNegativeInteger(input.resultSummary?.evidenceCount),
  );
}

export function normalizeStoredTaskType(
  this: HydrateHost,
  value: unknown,
): InteractionTaskType {
  const raw = String(optionalTrimmedText(value) || '');
  const type = this.taskTypeFromPrisma[raw] || raw;
  return this.isKnownInteractionTaskType(type) ? type : 'douyin-comment-reply';
}

export function normalizeStoredTaskStatus(
  this: HydrateHost,
  value: unknown,
): InteractionTaskStatus {
  const raw = String(optionalTrimmedText(value) || '');
  const status = this.taskStatusFromPrisma[raw] || raw;
  return this.isKnownInteractionTaskStatus(status) ? status : 'queued';
}

export function isKnownInteractionTaskStatus(
  this: HydrateHost,
  status: string,
): status is InteractionTaskStatus {
  return [
    'queued',
    'running',
    'paused',
    'blocked',
    'waiting_for_send_confirmation',
    'completed',
    'failed',
    'skipped',
    'no_target',
  ].includes(status);
}

export function normalizeStoredRiskLevel(
  this: HydrateHost,
  value: string,
): AgentRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'medium';
}

export function createStoredSummaryRiskPolicy(
  this: HydrateHost,
  riskLevel: AgentRiskLevel,
  targetName: string,
  createdAt: string,
): LocalEngineRiskPolicy {
  const requiredRole = riskLevel === 'high' ? 'manager' : 'operator';
  return {
    planMode: 'commercial',
    requiredRole,
    approverRoles: ['manager', 'admin'],
    targetName,
    targetWhitelisted: false,
    whitelistTargets: [],
    forbiddenActions:
      riskLevel === 'high'
        ? ['delete', 'payment', 'transfer', 'mass-send', 'clear-data']
        : [],
    forbiddenActionHits: [],
    remoteTakeoverAuditRequired: false,
    remoteAudit: [
      {
        action: 'requested',
        operator: 'system',
        reason: `历史任务汇总恢复，风险等级=${riskLevel}，目标=${targetName}`,
        createdAt,
      },
    ],
    message:
      requiredRole === 'operator'
        ? '历史任务汇总：操作员可查看，真实执行仍以原任务证据为准。'
        : '历史任务汇总：高风险任务需要管理员/经理查看，真实执行仍以原任务证据为准。',
  };
}

export function normalizeStoredTaskSummaryTargets(
  this: HydrateHost,
  value: unknown,
  taskStatus?: InteractionTaskStatus,
): InteractionBatchTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((target): target is Record<string, unknown> =>
      Boolean(target && typeof target === 'object' && !Array.isArray(target)),
    )
    .map((target, index) => {
      const status = this.normalizeStoredSummaryTargetStatus(
        normalizeBatchTargetStatus(
          optionalTrimmedText(
            target.status,
          ) as InteractionBatchTarget['status'],
        ),
        taskStatus,
      );
      return {
        id: optionalTrimmedText(target.id) || `stored-target-${index + 1}`,
        targetName:
          optionalTrimmedText(target.targetName) ||
          optionalTrimmedText(target.name) ||
          `对象 ${index + 1}`,
        sourceText: optionalTrimmedText(target.sourceText) || '',
        replyText: optionalTrimmedText(target.replyText) || '',
        status,
        failureReason:
          status === 'skipped'
            ? undefined
            : optionalTrimmedText(target.failureReason),
        nextAction:
          status === 'skipped'
            ? '任务已跳过，未继续执行该对象。'
            : optionalTrimmedText(target.nextAction),
        evidenceEventIds: Array.isArray(target.evidenceEventIds)
          ? target.evidenceEventIds.map(String).filter(Boolean)
          : undefined,
        updatedAt: optionalTrimmedText(target.updatedAt),
      };
    });
}

export function normalizeStoredSummaryTargetStatus(
  this: HydrateHost,
  status: InteractionBatchTarget['status'],
  taskStatus?: InteractionTaskStatus,
): InteractionBatchTarget['status'] {
  if (
    taskStatus === 'skipped' &&
    status !== 'completed' &&
    status !== 'no_target'
  ) {
    return 'skipped';
  }
  return status;
}

export function normalizeStoredTaskSummaryValue(
  this: HydrateHost,
  value: unknown,
): InteractionTask['batchSummary'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    total: toNonNegativeInteger(record.total),
    queued: toNonNegativeInteger(record.queued),
    running: toNonNegativeInteger(record.running),
    waitingConfirmation: toNonNegativeInteger(record.waitingConfirmation),
    completed: toNonNegativeInteger(record.completed),
    failed: toNonNegativeInteger(record.failed),
    skipped: toNonNegativeInteger(record.skipped),
    noTarget: toNonNegativeInteger(record.noTarget),
  };
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const hydrateMethods = {
  hydrateTasksFromStore,
  listStoredTaskSummaries,
  mergeTaskSummaries,
  normalizeTaskForDisplay,
  toStoredTaskSummary,
  normalizeStoredTaskEvents,
  repairHydratedTaskEvidence,
  cleanEvidenceIntegrityText,
  taskHasEvidenceIntegrityText,
  normalizeStoredTaskEvent,
  isStoredEvidenceIntegrityBackfill,
  normalizeStoredTaskEvidence,
  normalizeStoredEventLevel,
  normalizeStoredEvidenceType,
  ensureStoredSummaryEvidenceEvents,
  countStoredTaskSummaryEvidence,
  normalizeStoredTaskType,
  normalizeStoredTaskStatus,
  isKnownInteractionTaskStatus,
  normalizeStoredRiskLevel,
  createStoredSummaryRiskPolicy,
  normalizeStoredTaskSummaryTargets,
  normalizeStoredSummaryTargetStatus,
  normalizeStoredTaskSummaryValue,
};
