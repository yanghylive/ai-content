import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PrismaService } from '../../prisma/prisma.service';

import {
  buildRecordsSummary,
  optionalTrimmedText,
  toCsv,
} from './local-engine.utils';
import type {
  AgentSession,
  AgentSessionListFilter,
  AgentSessionStatus,
  AutomationTaskView,
  AutomationTaskViewStatus,
  CreateInteractionTaskInput,
  InteractionBusinessRouteKey,
  InteractionEvidenceCleanupResult,
  InteractionRecordsExportResult,
  InteractionRecordsResult,
  InteractionTask,
  InteractionTaskEvent,
  InteractionTaskListFilter,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineTenantScope,
} from './local-engine.types';

export interface TaskQueryHost {
  listTasks(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
  ): Promise<InteractionTask[]>;
  listAutomationTasks(
    limit?: unknown,
    filter?: { status?: string },
  ): Promise<AutomationTaskView[]>;
  getAutomationTask(id: string): Promise<AutomationTaskView>;
  toAutomationTaskView(
    item: InteractionTask | AgentSession,
  ): AutomationTaskView;
  mapInteractionTaskToAutomationStatus(
    status: InteractionTaskStatus,
  ): AutomationTaskViewStatus;
  mapAgentSessionToAutomationStatus(
    status: AgentSessionStatus,
  ): AutomationTaskViewStatus;
  automationStatusLabel(status: AutomationTaskViewStatus): string;
  readMetadataText(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  ): string | undefined;
  listTasksByTypes(
    limit: unknown,
    types: InteractionTaskType[],
    filter?: Omit<InteractionTaskListFilter, 'type'>,
  ): Promise<InteractionTask[]>;
  listRecords(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
  ): Promise<InteractionRecordsResult>;
  exportRecords(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
  ): Promise<InteractionRecordsExportResult>;
  previewEvidenceCleanup(
    retentionDays?: unknown,
  ): Promise<InteractionEvidenceCleanupResult>;
  cleanupEvidence(
    retentionDays?: unknown,
    options?: {
      riskConfirmation?: BackendRiskConfirmationInput;
      riskContext?: BackendRiskContext;
    },
  ): Promise<
    InteractionEvidenceCleanupResult & { riskAudit: BackendRiskAuditEvent }
  >;
  listBusinessTasks(
    key: InteractionBusinessRouteKey,
    limit?: unknown,
    options?: { recordsOnly?: boolean; status?: InteractionTaskStatus },
  ): Promise<InteractionTask[]>;
  listBusinessRecords(
    key: InteractionBusinessRouteKey,
    limit?: unknown,
    options?: { status?: InteractionTaskStatus },
  ): Promise<InteractionRecordsResult>;
  createBusinessTask(
    key: InteractionBusinessRouteKey,
    input: Omit<CreateInteractionTaskInput, 'type'> &
      Partial<Pick<CreateInteractionTaskInput, 'type'>>,
  ): Promise<InteractionTask>;
  getTask(id: string): Promise<InteractionTask>;
  getTaskForDisplay(id: string): Promise<InteractionTask>;
  linkAgentSessionToTask(
    id: string,
    sessionId: string,
  ): Promise<InteractionTask>;
  autoUploadService: AutoUploadService;
  getAgentSession(id: string): Promise<AgentSession>;
  listAgentSessions(
    limit?: unknown,
    filter?: AgentSessionListFilter,
  ): Promise<AgentSession[]>;
  prisma: PrismaService;
  resolveBusinessTaskType(
    key: InteractionBusinessRouteKey,
    input?: Partial<CreateInteractionTaskInput>,
  ): InteractionTaskType;
  resolveBusinessTaskTypes(
    key: InteractionBusinessRouteKey,
  ): InteractionTaskType[];
  resolveStatusLabel(status: InteractionTaskStatus): string;
  tasks: Map<string, InteractionTask>;
  buildTaskEvidenceIntegrity(
    task: InteractionTask,
    evidenceIndex?: unknown,
  ): {
    valid: boolean;
    status: 'FAILED' | 'OK';
    warnings: string[];
    integrityIssues: unknown[];
  };
  createTask(input: CreateInteractionTaskInput): Promise<InteractionTask>;
  isInTenantScope(
    record: { tenantId?: string | null; userId?: string | null },
    scope: LocalEngineTenantScope,
  ): boolean;
  listStoredTaskSummaries(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]>;
  loadStoredTask(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionTask | null>;
  mergeTaskSummaries(
    storedTasks: InteractionTask[],
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]>;
  normalizeTaskForDisplay(task: InteractionTask): InteractionTask;
  persistTask(task: InteractionTask): Promise<void>;
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): void;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  toRecordExportRows(task: InteractionTask): string[];
  ensureTaskStore(): Promise<void>;
}

export async function listTasks(
  this: TaskQueryHost,
  limit = 50,
  filter: InteractionTaskListFilter = {},
): Promise<InteractionTask[]> {
  await this.ensureTaskStore();
  const storedTasks = await this.listStoredTaskSummaries(limit, filter);
  const mergedTasks = await this.mergeTaskSummaries(storedTasks, filter);

  return mergedTasks
    .filter((task) => !filter.type || task.type === filter.type)
    .filter((task) => !filter.status || task.status === filter.status)
    .filter(
      (task) =>
        !filter.recordsOnly ||
        ['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
          task.status,
        ),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((task) => this.normalizeTaskForDisplay(task));
}

export async function listAutomationTasks(
  this: TaskQueryHost,
  limit = 80,
  filter: { status?: string } = {},
): Promise<AutomationTaskView[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const [tasks, sessions] = await Promise.all([
    this.listTasks(Math.max(safeLimit, 100)),
    this.listAgentSessions(Math.max(safeLimit, 100)),
  ]);
  const items = [
    ...tasks.map((task) => this.toAutomationTaskView(task)),
    ...sessions.map((session) => this.toAutomationTaskView(session)),
  ]
    .filter((item) => !filter.status || item.status === filter.status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return items.slice(0, safeLimit);
}

export async function getAutomationTask(
  this: TaskQueryHost,
  id: string,
): Promise<AutomationTaskView> {
  const safeId = String(id || '').trim();
  if (!safeId) {
    throw new BadRequestException('缺少任务记录 ID');
  }

  if (safeId.startsWith('agent-session:')) {
    return this.toAutomationTaskView(
      await this.getAgentSession(safeId.slice('agent-session:'.length)),
    );
  }
  if (safeId.startsWith('interaction-task:')) {
    return this.toAutomationTaskView(
      await this.getTask(safeId.slice('interaction-task:'.length)),
    );
  }

  try {
    return this.toAutomationTaskView(await this.getTask(safeId));
  } catch (taskError) {
    try {
      return this.toAutomationTaskView(await this.getAgentSession(safeId));
    } catch {
      throw taskError;
    }
  }
}

export function toAutomationTaskView(
  this: TaskQueryHost,
  item: InteractionTask | AgentSession,
): AutomationTaskView {
  if ('type' in item) {
    const status = this.mapInteractionTaskToAutomationStatus(item.status);
    const metadata = item.metadata || {};
    const runtimeExecutionId = this.readMetadataText(metadata, [
      'runtimeExecutionId',
      'runtime_execution_id',
    ]);
    return {
      id: `interaction-task:${item.id}`,
      source: 'interaction-task',
      taskType: item.type,
      title: item.planName || item.typeLabel || '互动任务',
      status,
      statusLabel: this.automationStatusLabel(status),
      executionMode:
        item.executionMode === 'browser-assisted' ? 'real' : 'configuration',
      riskLevel: item.riskLevel || 'medium',
      currentStep: item.diagnostics?.currentStep,
      nextAction: item.nextAction || item.diagnostics?.nextAction,
      failureReason: item.failureReason || item.diagnostics?.failureReason,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      evidenceCount:
        (Array.isArray((item as { evidence?: unknown }).evidence)
          ? ((item as { evidence?: unknown }).evidence as unknown[]).length
          : 0) ||
        item.diagnostics?.evidenceCount ||
        0,
      confirmationRequired:
        Boolean(item.requiresDoubleConfirmation) ||
        item.status === 'waiting_for_send_confirmation',
      taskId: item.id,
      agentSessionId: this.readMetadataText(metadata, [
        'agentSessionId',
        'agent_session_id',
        'sessionId',
      ]),
      runtimeExecutionId,
      metadata,
    };
  }

  const status = this.mapAgentSessionToAutomationStatus(item.status);
  const executionMode = this.readMetadataText(item.metadata, [
    'executionMode',
    'execution_mode',
  ]);
  return {
    id: `agent-session:${item.id}`,
    source: 'agent-session',
    taskType:
      this.readMetadataText(item.metadata, ['coreTaskType', 'taskType']) ||
      item.source,
    title: item.title || '自动化任务',
    status,
    statusLabel: this.automationStatusLabel(status),
    executionMode:
      executionMode === 'simulated'
        ? 'simulated'
        : status === 'failed'
          ? 'blocked'
          : 'real',
    riskLevel: item.riskLevel,
    currentStep: item.events.at(-1)?.title,
    nextAction: item.nextAction,
    failureReason: item.events.findLast((event) => event.level === 'error')
      ?.message,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    evidenceCount: item.events.filter((event) => Boolean(event.evidence))
      .length,
    confirmationRequired:
      Boolean(item.requiresDoubleConfirmation) ||
      item.status === 'waiting_for_confirmation',
    agentSessionId: item.id,
    metadata: item.metadata,
  };
}

export function mapInteractionTaskToAutomationStatus(
  this: TaskQueryHost,
  status: InteractionTaskStatus,
): AutomationTaskViewStatus {
  if (status === 'completed') return 'success';
  if (status === 'waiting_for_send_confirmation') return 'waiting_confirmation';
  if (status === 'blocked') return 'failed';
  if (status === 'no_target' || status === 'skipped') return 'cancelled';
  return status;
}

export function mapAgentSessionToAutomationStatus(
  this: TaskQueryHost,
  status: AgentSessionStatus,
): AutomationTaskViewStatus {
  if (status === 'completed') return 'success';
  if (status === 'waiting_for_confirmation') return 'waiting_confirmation';
  if (status === 'cancelled') return 'cancelled';
  return status;
}

export function automationStatusLabel(
  this: TaskQueryHost,
  status: AutomationTaskViewStatus,
) {
  const labels: Record<AutomationTaskViewStatus, string> = {
    draft: '草稿',
    queued: '排队中',
    running: '运行中',
    waiting_confirmation: '待确认',
    paused: '已暂停',
    partial_failed: '部分失败',
    failed: '失败',
    success: '已完成',
    cancelled: '已取消',
  };
  return labels[status];
}

export function readMetadataText(
  this: TaskQueryHost,
  metadata: Record<string, unknown> | undefined,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export async function listTasksByTypes(
  this: TaskQueryHost,
  limit = 50,
  types: InteractionTaskType[],
  filter: Omit<InteractionTaskListFilter, 'type'> = {},
): Promise<InteractionTask[]> {
  await this.ensureTaskStore();
  const storedTasks = await this.listStoredTaskSummaries(limit, filter, types);
  const allowedTypes = new Set(types);
  const mergedTasks = await this.mergeTaskSummaries(storedTasks, filter, types);

  return mergedTasks
    .filter((task) => allowedTypes.has(task.type))
    .filter((task) => !filter.status || task.status === filter.status)
    .filter(
      (task) =>
        !filter.recordsOnly ||
        ['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
          task.status,
        ),
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit)
    .map((task) => this.normalizeTaskForDisplay(task));
}

export async function listRecords(
  this: TaskQueryHost,
  limit = 50,
  filter: InteractionTaskListFilter = {},
): Promise<InteractionRecordsResult> {
  await this.ensureTaskStore();
  const storedTasks = await this.listStoredTaskSummaries(Math.max(limit, 200), {
    ...filter,
    recordsOnly: true,
    status: undefined,
  });

  const mergedTasks = await this.mergeTaskSummaries(storedTasks, {
    ...filter,
    recordsOnly: true,
    status: undefined,
  });
  const baseRecords = mergedTasks
    .filter((task) =>
      ['completed', 'failed', 'skipped', 'no_target'].includes(task.status),
    )
    .filter((task) => !filter.type || task.type === filter.type);
  const filteredRecords = baseRecords
    .filter((task) => !filter.status || task.status === filter.status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);

  return {
    items: filteredRecords.map((task) => this.normalizeTaskForDisplay(task)),
    summary: buildRecordsSummary(baseRecords),
  };
}

export async function exportRecords(
  this: TaskQueryHost,
  limit = 200,
  filter: InteractionTaskListFilter = {},
): Promise<InteractionRecordsExportResult> {
  await this.ensureTaskStore();
  const storedTasks = await this.listStoredTaskSummaries(Math.max(limit, 200), {
    ...filter,
    recordsOnly: true,
    status: undefined,
  });
  const mergedTasks = await this.mergeTaskSummaries(storedTasks, {
    ...filter,
    recordsOnly: true,
    status: undefined,
  });
  const baseRecords = mergedTasks
    .filter((task) =>
      ['completed', 'failed', 'skipped', 'no_target'].includes(task.status),
    )
    .filter((task) => !filter.type || task.type === filter.type);
  const filteredRecords = baseRecords
    .filter((task) => !filter.status || task.status === filter.status)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.min(Math.max(limit, 1), 1000));
  const exportedAt = new Date().toISOString();
  const summary = buildRecordsSummary(baseRecords);
  const rows = filteredRecords.flatMap((task) => this.toRecordExportRows(task));
  const headers = [
    '任务ID',
    '状态',
    '类型',
    '平台',
    '账号',
    '批量序号',
    '目标对象',
    '对象状态',
    '失败原因',
    '诊断摘要',
    '下一步',
    '风险等级',
    '风险审计',
    '确认记录',
    '阶段日志',
    '浏览器证据索引',
    '桌面证据索引',
    '文本证据索引',
    '失败证据索引',
    '结果摘要',
    '原始内容',
    '回复内容',
    '证据数',
    '对象证据事件',
    '导出完整性',
    '创建时间',
    '更新时间',
    '完成时间',
  ];

  return {
    filename: `interaction-records-${exportedAt.slice(0, 10)}.csv`,
    mimeType: 'text/csv;charset=utf-8',
    content: toCsv([headers, ...rows] as string[][]),
    exportedAt,
    exportStatus: filteredRecords.some(
      (task) => this.buildTaskEvidenceIntegrity(task).status === 'FAILED',
    )
      ? 'FAILED'
      : 'OK',
    summary,
  };
}

export function previewEvidenceCleanup(
  this: TaskQueryHost,
  retentionDays = 7,
): Promise<InteractionEvidenceCleanupResult> {
  return this.autoUploadService.previewInteractionEvidenceCleanup(
    retentionDays,
  );
}

export async function cleanupEvidence(
  this: TaskQueryHost,
  retentionDays = 7,
  options: {
    riskConfirmation?: BackendRiskConfirmationInput;
    riskContext?: BackendRiskContext;
  } = {},
): Promise<
  InteractionEvidenceCleanupResult & { riskAudit: BackendRiskAuditEvent }
> {
  const riskAudit = assertBackendRiskGate({
    action: 'local-file-delete',
    target: `interaction-evidence:retentionDays=${retentionDays}`,
    riskLevel: 'high',
    requiresConfirmation: true,
    confirmation: options.riskConfirmation,
    context: options.riskContext,
    reason: '清理互动证据会删除本地截图/日志文件。',
  });
  const result = await this.autoUploadService.cleanupInteractionEvidence(
    retentionDays,
    {
      confirmation: options.riskConfirmation,
      context: options.riskContext,
    },
  );

  return { ...result, riskAudit };
}

export function listBusinessTasks(
  this: TaskQueryHost,
  key: InteractionBusinessRouteKey,
  limit = 50,
  options: { recordsOnly?: boolean; status?: InteractionTaskStatus } = {},
): Promise<InteractionTask[]> {
  return this.listTasksByTypes(limit, this.resolveBusinessTaskTypes(key), {
    status: options.status,
    recordsOnly: options.recordsOnly,
  });
}

export async function listBusinessRecords(
  this: TaskQueryHost,
  key: InteractionBusinessRouteKey,
  limit = 50,
  options: { status?: InteractionTaskStatus } = {},
): Promise<InteractionRecordsResult> {
  const records = await this.listTasksByTypes(
    limit,
    this.resolveBusinessTaskTypes(key),
    {
      status: options.status,
      recordsOnly: true,
    },
  );
  return {
    items: records,
    summary: buildRecordsSummary(records),
  };
}

export function createBusinessTask(
  this: TaskQueryHost,
  key: InteractionBusinessRouteKey,
  input: Omit<CreateInteractionTaskInput, 'type'> &
    Partial<Pick<CreateInteractionTaskInput, 'type'>>,
): Promise<InteractionTask> {
  return this.createTask({
    ...input,
    type: this.resolveBusinessTaskType(key, input),
  });
}

export async function getTask(
  this: TaskQueryHost,
  id: string,
): Promise<InteractionTask> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  const cached = this.tasks.get(id);
  if (!cached || !this.isInTenantScope(cached, scope)) {
    const task = await this.loadStoredTask(id, scope);
    if (task) {
      this.tasks.set(task.id, task);
    }
  }
  const task = this.tasks.get(id);
  if (!task || !this.isInTenantScope(task, scope)) {
    throw new NotFoundException('互动任务不存在');
  }

  return task;
}

export async function getTaskForDisplay(
  this: TaskQueryHost,
  id: string,
): Promise<InteractionTask> {
  return this.normalizeTaskForDisplay(await this.getTask(id));
}

export async function linkAgentSessionToTask(
  this: TaskQueryHost,
  id: string,
  sessionId: string,
): Promise<InteractionTask> {
  const safeSessionId = optionalTrimmedText(sessionId);
  if (!safeSessionId) {
    throw new BadRequestException('本机助手没有返回会话 ID。');
  }
  const task = await this.getTask(id);
  task.metadata = {
    ...(task.metadata || {}),
    agentSessionId: safeSessionId,
    agent_session_id: safeSessionId,
  };
  task.status = 'running';
  task.statusLabel = this.resolveStatusLabel('running');
  task.runtimeState = 'running';
  if (task.planStatus && task.planStatus !== 'removed') {
    task.planStatus = 'sending';
  }
  task.updatedAt = new Date().toISOString();
  task.nextAction = '本机助手正在执行，收到逐对象结果后更新状态。';
  this.pushEvent(task, 'info', '业务任务已关联本机助手会话。', {
    type: 'stage_log',
    label: '本机执行',
    value: safeSessionId,
    stageKey: 'agent-s-immediate-running',
  });
  await this.persistTask(task);
  await this.prisma.interactionTask.update({
    where: { id: task.id },
    data: {
      sessionId: safeSessionId,
      status: 'RUNNING',
      stage: 'agent-s-immediate-running',
    },
  });
  return this.normalizeTaskForDisplay(task);
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const taskQueryMethods = {
  listTasks,
  listAutomationTasks,
  getAutomationTask,
  toAutomationTaskView,
  mapInteractionTaskToAutomationStatus,
  mapAgentSessionToAutomationStatus,
  automationStatusLabel,
  readMetadataText,
  listTasksByTypes,
  listRecords,
  exportRecords,
  previewEvidenceCleanup,
  cleanupEvidence,
  listBusinessTasks,
  listBusinessRecords,
  createBusinessTask,
  getTask,
  getTaskForDisplay,
  linkAgentSessionToTask,
};
