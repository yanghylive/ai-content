import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  assertBackendRiskGate,
  type BackendRiskContext,
} from '../auth/risk-control';
import { PrismaService } from '../../prisma/prisma.service';

import {
  agentSessionNeedsBrowserEvidence,
  buildAgentTitle,
  collectAgentSessionEvidence,
  createId,
  getProjectRoot,
  groupEvidenceByType,
  previewEvidenceValue,
  resolveAgentRisk,
  resolveAgentScope,
  resolveAgentTargetApp,
} from './local-engine.utils';
import type {
  AgentConfirmation,
  AgentConfirmationDecisionInput,
  AgentConfirmationListItem,
  AgentConfirmationStatus,
  AgentEvidence,
  AgentExecutionScope,
  AgentRiskLevel,
  AgentSession,
  AgentSessionEvent,
  AgentSessionEvidenceExportResult,
  AgentSessionEvidenceListResult,
  AgentSessionListFilter,
  AgentSessionStatus,
  ArchiveAgentSessionInput,
  ContinueAgentSessionInput,
  CreateAgentSessionInput,
  InteractionApprovalInput,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskStatus,
  InteractionTaskStepStatus,
  InteractionTaskType,
  LocalEngineMisfireProtection,
  LocalEnginePermissionStatus,
  LocalEngineRiskPolicy,
  LocalEngineSafetyBoundary,
  LocalEngineTenantScope,
} from './local-engine.types';

export interface AgentHost {
  prisma: PrismaService;
  listAgentSessions(
    limit?: unknown,
    filter?: AgentSessionListFilter,
  ): Promise<AgentSession[]>;
  getAgentSession(id: string): Promise<AgentSession>;
  createAgentSession(input: CreateAgentSessionInput): Promise<AgentSession>;
  createPublishTrackingSession(input: {
    title: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentSession>;
  completePublishTrackingSession(
    id: string,
    input: { ok: boolean; message: string; evidenceCount?: number },
  ): Promise<AgentSession>;
  continueAgentSession(
    id: string,
    input?: ContinueAgentSessionInput,
  ): Promise<AgentSession>;
  stopAgentSession(id: string): Promise<AgentSession>;
  archiveAgentSession(
    id: string,
    input?: ArchiveAgentSessionInput,
  ): Promise<AgentSession>;
  exportAgentSessionEvidence(
    id: string,
  ): Promise<AgentSessionEvidenceExportResult>;
  listAgentSessionEvidence(id: string): Promise<AgentSessionEvidenceListResult>;
  resolveEvidenceFilePath(filePath: string | undefined): string;
  resolveBrowserEvidenceFilePath(filename: string | undefined);
  normalizeEvidenceFilePath(filePath: string): string;
  listAgentSessionConfirmations(
    id: string,
    status?: AgentConfirmationStatus,
  ): Promise<AgentConfirmationListItem[]>;
  listAgentConfirmations(
    status?: AgentConfirmationStatus,
    sessionId?: string,
  ): Promise<AgentConfirmationListItem[]>;
  matchesAgentSessionFilter(
    session: AgentSession,
    filter: AgentSessionListFilter,
  );
  withAgentConfirmationSession(
    confirmation: AgentConfirmation,
  ): AgentConfirmationListItem;
  getAgentConfirmation(id: string): Promise<{
    confirmation: AgentConfirmation;
    session: AgentSession;
  } | null>;
  rememberAgentSession(session: AgentSession): AgentSession;
  mergeAgentConfirmations(
    left: AgentConfirmation[],
    right: AgentConfirmation[],
  ): AgentConfirmation[];
  getSessionConfirmations(session: AgentSession): AgentConfirmation[];
  getSessionPendingConfirmations(session: AgentSession): AgentConfirmation[];
  syncAgentConfirmationIntoSession(
    session: AgentSession,
    confirmation: AgentConfirmation,
  );
  closePendingAgentConfirmations(
    session: AgentSession,
    status: Extract<AgentConfirmationStatus, 'rejected' | 'expired'>,
    input: { operator: string; note: string; decidedAt: string },
  );
  buildAgentReplayTimeline(session: AgentSession);
  buildAgentEvidenceSummary(
    session: AgentSession,
    evidenceItems: AgentEvidence[],
  ): {
    sessionId: string;
    generatedAt: string;
    riskLevel?: AgentRiskLevel;
    status: AgentSessionStatus;
    totalEvents: number;
    totalEvidence: number;
    byType: Record<string, number>;
    stages: unknown[];
    screenshotCount: number;
    pageSnapshotCount: number;
    desktopScreenshotCount: number;
    stageLogCount: number;
    failureReasonCount: number;
    pendingConfirmations: number;
    remoteAuditCount: number;
  };
  buildAgentFailureAnalysis(session: AgentSession): {
    hasFailure: boolean;
    failureCount: number;
    failedAt?: string;
    rejectedConfirmations: unknown[];
    failureEvents: unknown[];
    reasons: string[];
    nextAction: string;
  };
  buildAgentAuditTrail(session: AgentSession): Array<{
    type: string;
    action: string;
    operator: string;
    reason: string;
    createdAt: string;
    confirmationId?: string;
  }>;
  buildAgentEvidenceIndex(
    session: AgentSession,
    evidenceItems?: unknown,
  ): {
    counts: Record<string, number>;
    stageLogs: unknown[];
    failureReasons: unknown[];
    riskAudits: unknown[];
    confirmations: unknown[];
    browser: unknown[];
    desktop: unknown[];
    text: unknown[];
  };
  toAgentEvidenceIndexItems(items: AgentEvidence[]);
  buildAgentEvidenceIntegrity(
    session: AgentSession,
    evidenceItems?: unknown,
    evidenceIndex?: unknown,
  ): {
    valid: boolean;
    status: 'FAILED' | 'OK';
    warnings: string[];
    integrityIssues: unknown[];
    evidenceIndex: unknown;
  };
  ensureAgentSessionEvidenceForExport(session: AgentSession);
  approveAgentConfirmation(
    id: string,
    input?: AgentConfirmationDecisionInput,
    riskContext?: BackendRiskContext,
  ): Promise<AgentSession>;
  approveInteractionTaskConfirmation(
    confirmation: AgentConfirmation,
    input?: AgentConfirmationDecisionInput,
  ): Promise<AgentSession>;
  createSyntheticSessionForConfirmation(
    confirmation: AgentConfirmation,
  ): AgentSession;
  rejectAgentConfirmation(
    id: string,
    input?: AgentConfirmationDecisionInput,
  ): Promise<AgentSession>;
  rejectInteractionTaskConfirmation(
    confirmation: AgentConfirmation,
    input?: AgentConfirmationDecisionInput,
  ): Promise<AgentSession>;
  clearPendingConfirmations(): Promise<{ cleared: number }>;
  agentConfirmations: Map<string, AgentConfirmation>;
  agentSessionNeedsDesktopEvidence(session: AgentSession): boolean;
  agentSessions: Map<string, AgentSession>;
  allowLocalPlanBypass(): boolean;
  approveTask(
    id: string,
    input?: InteractionApprovalInput,
    riskContext?: BackendRiskContext,
  ): Promise<InteractionTask>;
  configService: ConfigService;
  createAgentConfirmation(
    session: AgentSession,
    input: {
      title: string;
      description: string;
      actionLabel: string;
      riskLevel: Exclude<AgentRiskLevel, 'low'>;
    },
  ): AgentConfirmation;
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
  currentActorCommercialAllowed(): boolean;
  ensureTaskStore(): Promise<void>;
  getProjectLogRoot(): string;
  hasDestructiveIntent(content: string): boolean;
  hydrateAgentConfirmationsFromStore(
    limit?: unknown,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  hydrateAgentSessionsFromStore(
    limit?: unknown,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  isInTenantScope(
    record: { tenantId?: string | null; userId?: string | null },
    scope: LocalEngineTenantScope,
  ): boolean;
  loadStoredAgentSession(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<AgentSession | null>;
  loadStoredTask(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionTask | null>;
  persistAgentConfirmation(confirmation: AgentConfirmation): Promise<void>;
  persistAgentSession(session: AgentSession): Promise<void>;
  persistTask(task: InteractionTask): Promise<void>;
  pushAgentEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ): void;
  recordRemoteAudit(
    session: AgentSession,
    action: 'requested' | 'approved' | 'started' | 'stopped' | 'rejected',
    operator: string,
    reason: string,
    createdAt?: string,
  ): void;
  resolveAgentScopeLabel(scope: AgentExecutionScope): string;
  resolveAgentSessionStatusLabel(status: AgentSessionStatus): string;
  resolveLocalRuntimePaths(): {
    root: string;
    materials: string;
    cookies: string;
    browserProfiles: string;
    evidence: string;
    screenshots: string;
    logs: string;
  };
  resolvePermissionStatusLabel(status: LocalEnginePermissionStatus): string;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  resolveTypeLabel(type: InteractionTaskType): string;
  resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ): Promise<void>;
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ): Promise<void>;
  tasks: Map<string, InteractionTask>;
  tenantScopeForRecord(record: {
    tenantId?: string | null;
    userId?: string | null;
  }): LocalEngineTenantScope;
}

export async function listAgentSessions(
  this: AgentHost,
  limit = 50,
  filter: AgentSessionListFilter = {},
): Promise<AgentSession[]> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  await this.hydrateAgentSessionsFromStore(Math.max(limit, 200), scope);
  return [...this.agentSessions.values()]
    .filter((session) => this.isInTenantScope(session, scope))
    .filter((session) => this.matchesAgentSessionFilter(session, filter))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function getAgentSession(
  this: AgentHost,
  id: string,
): Promise<AgentSession> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  const cached = this.agentSessions.get(id);
  const session =
    cached && this.isInTenantScope(cached, scope)
      ? cached
      : await this.loadStoredAgentSession(id, scope);
  if (!session || !this.isInTenantScope(session, scope)) {
    throw new NotFoundException('执行会话不存在');
  }
  return this.rememberAgentSession(session);
}

export async function createAgentSession(
  this: AgentHost,
  input: CreateAgentSessionInput,
): Promise<AgentSession> {
  const tenantScope = await this.resolveTenantScope();
  const instruction = input.instruction?.trim();
  if (!instruction) {
    throw new BadRequestException('请先输入要让本机 Agent 执行的指令');
  }

  const now = new Date().toISOString();
  const id = createId();
  const riskLevel = resolveAgentRisk(instruction);
  const executionScope = input.executionScope || resolveAgentScope(instruction);
  const commercialExecutionRequested =
    input.commercialExecutionRequested === true;
  const callerCommercialAllowed = this.currentActorCommercialAllowed();
  const commerciallyAuthorized =
    callerCommercialAllowed || this.allowLocalPlanBypass();
  const requestedSendMode =
    riskLevel === 'high' ? 'auto-send' : 'approval-send';
  const sendMode =
    commercialExecutionRequested &&
    commerciallyAuthorized &&
    riskLevel === 'high'
      ? 'auto-send'
      : riskLevel === 'high'
        ? 'approval-send'
        : 'draft-only';
  const safetyBoundary = this.createSafetyBoundary({
    riskLevel,
    requestedSendMode,
    sendMode,
    hasDestructiveIntent: this.hasDestructiveIntent(instruction),
    commercialExecutionRequested,
    callerCommercialAllowed,
  });
  const misfireProtection = this.createMisfireProtection(
    executionScope === 'desktop'
      ? 'wechat-reply-draft'
      : 'douyin-comment-reply',
    riskLevel,
  );
  const riskPolicy = this.createRiskPolicy({
    riskLevel,
    scope: executionScope,
    targetName:
      input.targetApp?.trim() ||
      resolveAgentTargetApp(instruction) ||
      '未指定目标',
    instruction,
    hasRemoteTakeover:
      executionScope === 'remote' || /接管|远程控制|远程操作/.test(instruction),
  });
  const session: AgentSession = {
    id,
    ...tenantScope,
    title: input.title?.trim() || buildAgentTitle(instruction),
    instruction,
    status:
      riskLevel === 'high' || input.dryRun
        ? 'waiting_for_confirmation'
        : 'running',
    statusLabel: this.resolveAgentSessionStatusLabel(
      riskLevel === 'high' || input.dryRun
        ? 'waiting_for_confirmation'
        : 'running',
    ),
    executionScope,
    source: input.source || 'agent-console',
    createdAt: now,
    updatedAt: now,
    targetApp: input.targetApp?.trim() || resolveAgentTargetApp(instruction),
    targetUrl: input.targetUrl?.trim(),
    riskLevel,
    requiresDoubleConfirmation: riskLevel === 'high',
    commercialExecutablePermission: safetyBoundary.permissionStatus,
    safetyBoundary,
    misfireProtection,
    riskPolicy,
    resumeAction: input.resumeAction,
    metadata:
      input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : undefined,
    confirmations: [],
    events: [],
  };

  this.pushAgentEvent(
    session,
    'info',
    '指令已接收',
    '本机 Agent 已创建执行会话，开始解析目标、工具权限和风险动作。',
  );
  this.pushAgentEvent(
    session,
    'info',
    '执行范围',
    `本次会使用${this.resolveAgentScopeLabel(executionScope)}能力，所有外部提交动作会按受控执行策略推进，条件异常时停止并留证据。`,
    { type: 'text', label: '用户指令', value: instruction },
  );
  this.pushAgentEvent(
    session,
    safetyBoundary.permissionStatus === 'allowed' ? 'info' : 'warning',
    '试用/商用边界',
    safetyBoundary.message,
    {
      type: 'text',
      label: '执行权限',
      value: `正式商用可执行权限：${this.resolvePermissionStatusLabel(safetyBoundary.permissionStatus)}`,
    },
  );
  this.pushAgentEvent(
    session,
    'info',
    '阶段日志已开启',
    'Agent 会话创建完成，后续事件会进入证据回放时间线。',
    {
      type: 'stage_log',
      label: '阶段日志',
      value: `create-agent-session / scope=${executionScope} / risk=${riskLevel}`,
      stageKey: 'create-agent-session',
    },
  );
  if (riskPolicy.remoteTakeoverAuditRequired) {
    this.pushAgentEvent(
      session,
      'warning',
      '远程接管审计',
      riskPolicy.message,
      {
        type: 'stage_log',
        label: '远程接管审计',
        value: JSON.stringify(riskPolicy.remoteAudit, null, 2),
        stageKey: 'remote-takeover-audit',
      },
    );
    this.pushAgentEvent(
      session,
      'info',
      '远程审计字段',
      '已记录远程接管申请、目标、白名单命中、禁止动作和审计原因。',
      {
        type: 'diagnostic_bundle',
        label: '远程审计摘要',
        value: JSON.stringify(
          {
            targetName: riskPolicy.targetName,
            targetWhitelisted: riskPolicy.targetWhitelisted,
            forbiddenActions: riskPolicy.forbiddenActions,
            forbiddenActionHits: riskPolicy.forbiddenActionHits,
            auditRequiredReason: riskPolicy.auditRequiredReason,
          },
          null,
          2,
        ),
        stageKey: 'remote-takeover-audit',
      },
    );
  }

  if (riskLevel === 'high' || input.dryRun) {
    const confirmation = this.createAgentConfirmation(session, {
      title: '执行前确认',
      description:
        '这条指令可能触发发布、发送、改文件、删除或外部平台提交。请确认目标、内容和当前窗口后再继续。',
      actionLabel: input.dryRun ? '开始试运行' : '继续执行高风险动作',
      riskLevel: riskLevel === 'low' ? 'medium' : riskLevel,
    });
    session.confirmations.push(confirmation);
    session.nextAction = '请到“待我确认”确认后继续执行。';
    this.agentConfirmations.set(confirmation.id, confirmation);
    this.pushAgentEvent(
      session,
      'warning',
      '等待继续执行',
      confirmation.description,
      {
        type: 'text',
        label: '确认项',
        value: confirmation.requiredChecks
          .map((check) => check.label)
          .join(' / '),
      },
    );
  } else {
    session.nextAction = '正在执行，可在执行会话里继续补充指令或停止。';
    this.pushAgentEvent(
      session,
      'success',
      '开始执行',
      '低风险的任务已进入本机执行队列。',
    );
  }

  this.agentSessions.set(id, session);
  await this.persistAgentSession(session);
  return session;
}

export async function createPublishTrackingSession(
  this: AgentHost,
  input: {
    title: string;
    metadata?: Record<string, unknown>;
  },
): Promise<AgentSession> {
  const tenantScope = await this.resolveTenantScope();
  const now = new Date().toISOString();
  const session: AgentSession = {
    id: createId(),
    ...tenantScope,
    title: input.title.trim() || '发布任务',
    instruction: `记录发布任务：${input.title.trim() || '发布任务'}`,
    status: 'running',
    statusLabel: '运行中',
    executionScope: 'browser',
    source: 'publishing',
    createdAt: now,
    updatedAt: now,
    targetApp: '发布中心',
    riskLevel: 'high',
    requiresDoubleConfirmation: false,
    metadata: input.metadata,
    confirmations: [],
    events: [],
  };
  this.pushAgentEvent(
    session,
    'info',
    '发布任务已创建',
    '发布任务已经进入执行记录，平台结果会持续写入本次会话。',
    {
      type: 'stage_log',
      label: '发布任务',
      value: session.title,
      stageKey: 'publish-created',
    },
  );
  this.agentSessions.set(session.id, session);
  await this.persistAgentSession(session);
  return session;
}

export async function completePublishTrackingSession(
  this: AgentHost,
  id: string,
  input: { ok: boolean; message: string; evidenceCount?: number },
): Promise<AgentSession> {
  const session = await this.getAgentSession(id);
  session.status = input.ok ? 'completed' : 'failed';
  session.statusLabel = input.ok ? '已完成' : '执行失败';
  session.completedAt = new Date().toISOString();
  session.updatedAt = session.completedAt;
  session.nextAction = input.ok
    ? '请在发布记录查看平台回执和结果留存。'
    : '请查看失败原因，修复账号、素材或平台状态后重试。';
  this.pushAgentEvent(
    session,
    input.ok ? 'success' : 'error',
    input.ok ? '发布执行完成' : '发布执行失败',
    input.message,
    {
      type: input.ok ? 'stage_log' : 'failure_reason',
      label: '发布结果',
      value: input.message,
      stageKey: input.ok ? 'publish-completed' : 'publish-failed',
    },
  );
  session.metadata = {
    ...(session.metadata || {}),
    evidenceCount: input.evidenceCount ?? 0,
  };
  await this.persistAgentSession(session);
  return session;
}

export async function continueAgentSession(
  this: AgentHost,
  id: string,
  input: ContinueAgentSessionInput = {},
): Promise<AgentSession> {
  const session = await this.getAgentSession(id);
  if (session.status === 'cancelled' || session.status === 'completed') {
    return session;
  }
  const pendingConfirmations = this.getSessionPendingConfirmations(session);
  if (pendingConfirmations.length) {
    session.status = 'waiting_for_confirmation';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.nextAction = `还有 ${pendingConfirmations.length} 个确认项未处理，请先确认或拒绝后再继续。`;
    this.pushAgentEvent(session, 'warning', '仍需人工确认', session.nextAction);
    await this.persistAgentSession(session);
    return session;
  }
  const now = new Date().toISOString();
  if (input.instruction?.trim()) {
    this.pushAgentEvent(session, 'info', '补充指令', input.instruction.trim());
  }
  session.status = 'running';
  session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
  session.updatedAt = now;
  session.nextAction =
    '继续执行中，遇到提交、发送、改文件等动作会再次暂停确认。';
  this.pushAgentEvent(
    session,
    'success',
    '继续执行',
    `${input.operator?.trim() || '用户'} 已要求本机 Agent 继续当前会话。`,
  );
  await this.persistAgentSession(session);
  return session;
}

export async function stopAgentSession(
  this: AgentHost,
  id: string,
): Promise<AgentSession> {
  const session = await this.getAgentSession(id);
  if (session.status === 'completed' || session.status === 'cancelled') {
    return session;
  }
  const stoppedAt = new Date().toISOString();
  this.recordRemoteAudit(
    session,
    'stopped',
    '用户',
    '用户停止了本机 Agent 执行。',
  );
  this.closePendingAgentConfirmations(session, 'rejected', {
    operator: '用户',
    note: '会话已停止，未处理确认项自动关闭。',
    decidedAt: stoppedAt,
  });
  session.status = 'cancelled';
  session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
  session.updatedAt = stoppedAt;
  session.completedAt = session.updatedAt;
  session.nextAction = '会话已停止。';
  this.pushAgentEvent(
    session,
    'warning',
    '已停止',
    '用户停止了本机 Agent 执行。',
  );
  await this.persistAgentSession(session);
  return session;
}

export async function archiveAgentSession(
  this: AgentHost,
  id: string,
  input: ArchiveAgentSessionInput = {},
): Promise<AgentSession> {
  const session = await this.getAgentSession(id);
  const archivedAt = new Date().toISOString();
  const operator = input.operator?.trim() || '用户';
  const reason = input.reason?.trim() || '用户从列表删除。';
  this.closePendingAgentConfirmations(session, 'rejected', {
    operator,
    note: reason,
    decidedAt: archivedAt,
  });
  session.status = 'cancelled';
  session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
  session.updatedAt = archivedAt;
  session.completedAt = session.completedAt || archivedAt;
  session.nextAction = '已从列表移除。';
  session.metadata = {
    ...(session.metadata || {}),
    hiddenFromAiEmployee: true,
    archivedAt,
    archiveReason: reason,
  };
  this.pushAgentEvent(session, 'warning', '已移除', reason);
  await this.persistAgentSession(session);
  return session;
}

export async function exportAgentSessionEvidence(
  this: AgentHost,
  id: string,
): Promise<AgentSessionEvidenceExportResult> {
  const session = await this.getAgentSession(id);
  await this.ensureAgentSessionEvidenceForExport(session);
  const evidenceItems = collectAgentSessionEvidence(session);
  const replayTimeline = buildAgentReplayTimeline(session);
  const evidenceSummary = this.buildAgentEvidenceSummary(
    session,
    evidenceItems,
  );
  const failureAnalysis = this.buildAgentFailureAnalysis(session);
  const auditTrail = this.buildAgentAuditTrail(session);
  const evidenceIndex = this.buildAgentEvidenceIndex(session, evidenceItems);
  const evidenceIntegrity = this.buildAgentEvidenceIntegrity(
    session,
    evidenceItems,
    evidenceIndex,
  );
  const exportStatus = evidenceIntegrity.status;
  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    exportStatus,
    summary: evidenceSummary,
    integrity: evidenceIntegrity,
    session: {
      id: session.id,
      title: session.title,
      instruction: session.instruction,
      source: session.source,
      status: session.status,
      statusLabel: session.statusLabel,
      riskLevel: session.riskLevel,
      executionScope: session.executionScope,
      requiresDoubleConfirmation: session.requiresDoubleConfirmation,
      commercialExecutablePermission: session.commercialExecutablePermission,
      safetyBoundary: session.safetyBoundary,
      misfireProtection: session.misfireProtection,
      riskPolicy: session.riskPolicy,
      targetApp: session.targetApp,
      targetUrl: session.targetUrl,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt,
      nextAction: session.nextAction,
      resumeAction: session.resumeAction
        ? session.resumeAction.kind === 'auto-upload-publish'
          ? {
              kind: session.resumeAction.kind,
              label: session.resumeAction.label,
              payloadCount: session.resumeAction.payloads.length,
            }
          : {
              kind: session.resumeAction.kind,
              label: session.resumeAction.label,
              articleId: session.resumeAction.articleId,
              targetHref: session.resumeAction.targetHref,
            }
        : undefined,
    },
    confirmations: session.confirmations,
    evidence: evidenceItems,
    evidenceIndex,
    evidenceByType: groupEvidenceByType(evidenceItems),
    failureAnalysis,
    auditTrail,
    replay: {
      timeline: replayTimeline,
      summary: {
        totalEvents: session.events.length,
        totalEvidence: evidenceItems.length,
        pendingConfirmations:
          this.getSessionPendingConfirmations(session).length,
        screenshots:
          evidenceSummary.byType.screenshot +
          evidenceSummary.byType.desktop_screenshot,
        pageSnapshots:
          evidenceSummary.byType.page_snapshot +
          evidenceSummary.byType.snapshot,
        stageLogs: evidenceSummary.byType.stage_log,
        failureReasons: evidenceSummary.byType.failure_reason,
        auditEvents: auditTrail.length,
      },
    },
    timeline: session.events,
  };

  return {
    filename: `agent-session-${session.id}-evidence.json`,
    mimeType: 'application/json',
    content: JSON.stringify(payload, null, 2),
    exportedAt,
    exportStatus,
    sessionId: session.id,
    evidenceCount: evidenceItems.length,
    timelineCount: replayTimeline.length,
  };
}

export async function listAgentSessionEvidence(
  this: AgentHost,
  id: string,
): Promise<AgentSessionEvidenceListResult> {
  const session = await this.getAgentSession(id);
  const items = collectAgentSessionEvidence(session);
  return {
    sessionId: session.id,
    evidenceCount: items.length,
    items,
  };
}

export function resolveEvidenceFilePath(
  this: AgentHost,
  filePath: string | undefined,
) {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) {
    throw new BadRequestException('证据文件路径不能为空');
  }

  const normalizedPath = this.normalizeEvidenceFilePath(rawPath);
  const resolvedPath = resolve(normalizedPath);
  const allowedRoots = [
    resolve(this.getProjectLogRoot()),
    resolve(this.resolveLocalRuntimePaths().evidence),
    resolve(getProjectRoot(), '.local-logs'),
    resolve(getProjectRoot(), 'backend', '.local-logs'),
    resolve(process.cwd(), '.local-logs'),
    resolve('/tmp'),
  ];
  const isAllowed = allowedRoots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`),
  );
  if (!isAllowed) {
    throw new ForbiddenException('证据文件不在允许读取的目录内');
  }

  const extension = extname(resolvedPath).toLowerCase();
  const allowedExtensions = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.gif',
    '.json',
    '.txt',
    '.log',
  ]);
  if (!allowedExtensions.has(extension)) {
    throw new ForbiddenException('证据文件类型不允许直接打开');
  }
  if (!existsSync(resolvedPath)) {
    throw new NotFoundException('证据文件不存在');
  }

  return { filePath: resolvedPath };
}

export function resolveBrowserEvidenceFilePath(
  this: AgentHost,
  filename: string | undefined,
) {
  const rawFilename = String(filename || '').trim();
  if (!/^[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(rawFilename)) {
    throw new ForbiddenException('浏览器证据文件名不合法');
  }
  const evidenceRoot =
    this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
    join(this.getProjectLogRoot(), 'browser-evidence');
  return this.resolveEvidenceFilePath(join(evidenceRoot, rawFilename));
}

export function normalizeEvidenceFilePath(this: AgentHost, filePath: string) {
  const trimmed = filePath.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'file:') {
      return decodeURIComponent(parsed.pathname);
    }
  } catch {
    // Plain local filesystem paths are expected here.
  }

  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/, '');
  if (/^\/Users\//.test(withoutOrigin) || withoutOrigin.startsWith('/tmp/')) {
    return decodeURIComponent(withoutOrigin);
  }
  return withoutOrigin;
}

export async function listAgentSessionConfirmations(
  this: AgentHost,
  id: string,
  status?: AgentConfirmationStatus,
): Promise<AgentConfirmationListItem[]> {
  const session = await this.getAgentSession(id);
  return this.getSessionConfirmations(session)
    .filter((confirmation) => !status || confirmation.status === status)
    .map((confirmation) => this.withAgentConfirmationSession(confirmation))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function listAgentConfirmations(
  this: AgentHost,
  status?: AgentConfirmationStatus,
  sessionId?: string,
): Promise<AgentConfirmationListItem[]> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  await this.hydrateAgentConfirmationsFromStore(200, scope);
  await this.hydrateAgentSessionsFromStore(200, scope);
  return [...this.agentConfirmations.values()]
    .filter((confirmation) => this.isInTenantScope(confirmation, scope))
    .filter((confirmation) => !status || confirmation.status === status)
    .filter(
      (confirmation) => !sessionId || confirmation.sessionId === sessionId,
    )
    .map((confirmation) => this.withAgentConfirmationSession(confirmation))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function matchesAgentSessionFilter(
  this: AgentHost,
  session: AgentSession,
  filter: AgentSessionListFilter,
) {
  if (filter.status && session.status !== filter.status) {
    return false;
  }
  if (filter.source && session.source !== filter.source) {
    return false;
  }
  if (
    filter.executionScope &&
    session.executionScope !== filter.executionScope
  ) {
    return false;
  }
  if (filter.riskLevel && session.riskLevel !== filter.riskLevel) {
    return false;
  }
  if (
    filter.targetApp &&
    !String(session.targetApp || '')
      .toLowerCase()
      .includes(filter.targetApp.trim().toLowerCase())
  ) {
    return false;
  }
  if (
    typeof filter.hasPendingConfirmation === 'boolean' &&
    this.getSessionPendingConfirmations(session).length > 0 !==
      filter.hasPendingConfirmation
  ) {
    return false;
  }
  if (
    typeof filter.hasEvidence === 'boolean' &&
    collectAgentSessionEvidence(session).length > 0 !== filter.hasEvidence
  ) {
    return false;
  }
  const keyword = filter.keyword?.trim().toLowerCase();
  if (!keyword) {
    return true;
  }

  return [
    session.title,
    session.instruction,
    session.targetApp,
    session.targetUrl,
    session.nextAction,
    session.statusLabel,
    session.events
      .map(
        (event) =>
          `${event.title} ${event.message} ${event.evidence?.value || ''}`,
      )
      .join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(keyword);
}

export function withAgentConfirmationSession(
  this: AgentHost,
  confirmation: AgentConfirmation,
): AgentConfirmationListItem {
  const confirmationScope = this.tenantScopeForRecord(confirmation);
  if (confirmation.sessionId?.startsWith('interaction-task:')) {
    const taskId = confirmation.sessionId.replace('interaction-task:', '');
    const task = this.tasks.get(taskId);
    if (task && this.isInTenantScope(task, confirmationScope)) {
      return {
        ...confirmation,
        session: {
          id: confirmation.sessionId,
          title: `客户互动：${this.resolveTypeLabel(task.type)}`,
          source: 'agent-console',
          status: task.status as unknown as AgentSessionStatus,
          statusLabel: task.statusLabel || task.status,
          riskLevel: 'medium',
          updatedAt: task.updatedAt || confirmation.createdAt,
          nextAction: task.nextAction,
        },
      };
    }
    return confirmation;
  }

  const session = this.agentSessions.get(confirmation.sessionId);
  if (!session || !this.isInTenantScope(session, confirmationScope)) {
    return confirmation;
  }

  return {
    ...confirmation,
    session: {
      id: session.id,
      title: session.title,
      source: session.source,
      status: session.status,
      statusLabel: session.statusLabel,
      riskLevel: session.riskLevel,
      updatedAt: session.updatedAt,
      nextAction: session.nextAction,
      resumeAction: session.resumeAction,
    },
  };
}

export async function getAgentConfirmation(
  this: AgentHost,
  id: string,
): Promise<{
  confirmation: AgentConfirmation;
  session: AgentSession;
} | null> {
  await this.ensureTaskStore();
  const scope = await this.resolveTenantScope();
  const cached = this.agentConfirmations.get(id);
  if (cached && this.isInTenantScope(cached, scope)) {
    const session = await this.getAgentSession(cached.sessionId);
    const confirmation =
      this.getSessionConfirmations(session).find((item) => item.id === id) ||
      cached;
    this.agentConfirmations.set(confirmation.id, confirmation);
    return { confirmation, session };
  }

  const confirmationRow = await this.prisma.agentConfirmation.findFirst({
    where: { id, ...scope },
  });
  const confirmation = confirmationRow?.confirmationJson as
    | AgentConfirmation
    | undefined;
  if (!confirmationRow || !confirmation?.id) {
    return null;
  }
  confirmation.tenantId = confirmationRow.tenantId;
  confirmation.userId = confirmationRow.userId;
  this.agentConfirmations.set(confirmation.id, confirmation);
  const session = await this.getAgentSession(confirmation.sessionId);
  const sessionConfirmation =
    this.getSessionConfirmations(session).find((item) => item.id === id) ||
    confirmation;
  this.syncAgentConfirmationIntoSession(session, sessionConfirmation);
  return { confirmation: sessionConfirmation, session };
}

export function rememberAgentSession(
  this: AgentHost,
  session: AgentSession,
): AgentSession {
  const scope = this.tenantScopeForRecord(session);
  session.confirmations = this.getSessionConfirmations(session).map(
    (confirmation) => ({
      ...confirmation,
      ...scope,
      sessionId: session.id,
    }),
  );
  this.agentSessions.set(session.id, session);
  session.confirmations.forEach((confirmation) => {
    this.agentConfirmations.set(confirmation.id, confirmation);
  });
  return session;
}

export function mergeAgentConfirmations(
  this: AgentHost,
  left: AgentConfirmation[],
  right: AgentConfirmation[],
): AgentConfirmation[] {
  const byId = new Map<string, AgentConfirmation>();
  [...left, ...right].forEach((confirmation) => {
    if (confirmation?.id) {
      byId.set(confirmation.id, confirmation);
    }
  });
  return [...byId.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function getSessionConfirmations(
  this: AgentHost,
  session: AgentSession,
): AgentConfirmation[] {
  const sessionScope = this.tenantScopeForRecord(session);
  const byId = new Map<string, AgentConfirmation>();
  (session.confirmations || []).forEach((confirmation) => {
    if (confirmation?.id) {
      byId.set(confirmation.id, confirmation);
    }
  });
  [...this.agentConfirmations.values()]
    .filter(
      (confirmation) =>
        confirmation.sessionId === session.id &&
        this.isInTenantScope(confirmation, sessionScope),
    )
    .forEach((confirmation) => {
      byId.set(confirmation.id, confirmation);
    });
  return [...byId.values()].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

export function getSessionPendingConfirmations(
  this: AgentHost,
  session: AgentSession,
) {
  return this.getSessionConfirmations(session).filter(
    (confirmation) => confirmation.status === 'pending',
  );
}

export function syncAgentConfirmationIntoSession(
  this: AgentHost,
  session: AgentSession,
  confirmation: AgentConfirmation,
) {
  const confirmations = this.getSessionConfirmations(session);
  const index = confirmations.findIndex((item) => item.id === confirmation.id);
  if (index >= 0) {
    confirmations[index] = confirmation;
  } else {
    confirmations.unshift(confirmation);
  }
  session.confirmations = confirmations;
  this.agentConfirmations.set(confirmation.id, confirmation);
}

export function closePendingAgentConfirmations(
  this: AgentHost,
  session: AgentSession,
  status: Extract<AgentConfirmationStatus, 'rejected' | 'expired'>,
  input: { operator: string; note: string; decidedAt: string },
) {
  this.getSessionPendingConfirmations(session).forEach((confirmation) => {
    confirmation.status = status;
    confirmation.operator = input.operator;
    confirmation.note = input.note;
    confirmation.decidedAt = input.decidedAt;
    this.syncAgentConfirmationIntoSession(session, confirmation);
  });
}

export function buildAgentReplayTimeline(session: AgentSession) {
  return session.events.map((event, index) => ({
    seq: index + 1,
    id: event.id,
    level: event.level,
    title: event.title,
    message: event.message,
    createdAt: event.createdAt,
    evidence: event.evidence
      ? {
          ...event.evidence,
          id: event.evidence.id || event.id,
          eventId: event.id,
          sessionId: session.id,
          createdAt: event.evidence.createdAt || event.createdAt,
        }
      : undefined,
  }));
}

export function buildAgentEvidenceSummary(
  this: AgentHost,
  session: AgentSession,
  evidenceItems: AgentEvidence[],
) {
  const byType = groupEvidenceByType(evidenceItems);
  const stages = [
    ...new Set(evidenceItems.map((item) => item.stageKey).filter(Boolean)),
  ];
  const failedEvents = session.events.filter(
    (event) =>
      event.level === 'error' || event.evidence?.type === 'failure_reason',
  );
  return {
    sessionId: session.id,
    generatedAt: new Date().toISOString(),
    riskLevel: session.riskLevel,
    status: session.status,
    totalEvents: session.events.length,
    totalEvidence: evidenceItems.length,
    byType,
    stages,
    screenshotCount: byType.screenshot + byType.desktop_screenshot,
    pageSnapshotCount: byType.page_snapshot + byType.snapshot,
    desktopScreenshotCount: byType.desktop_screenshot,
    stageLogCount: byType.stage_log,
    failureReasonCount: byType.failure_reason,
    pendingConfirmations: this.getSessionPendingConfirmations(session).length,
    remoteAuditCount: session.riskPolicy?.remoteAudit.length || 0,
    failureEventCount: failedEvents.length,
  };
}

export function buildAgentFailureAnalysis(
  this: AgentHost,
  session: AgentSession,
) {
  const failureEvents = session.events.filter(
    (event) =>
      event.level === 'error' || event.evidence?.type === 'failure_reason',
  );
  const rejectedConfirmations = this.getSessionConfirmations(session).filter(
    (confirmation) => confirmation.status === 'rejected',
  );
  return {
    failed:
      session.status === 'failed' ||
      failureEvents.length > 0 ||
      rejectedConfirmations.length > 0,
    status: session.status,
    nextAction: session.nextAction,
    failedAt:
      failureEvents.at(-1)?.createdAt ||
      rejectedConfirmations.at(-1)?.decidedAt,
    reasons: [
      ...failureEvents.map((event) => event.evidence?.value || event.message),
      ...rejectedConfirmations.map(
        (confirmation) => confirmation.note || `${confirmation.title} 被拒绝`,
      ),
    ].filter(Boolean),
    events: failureEvents.map((event) => ({
      id: event.id,
      title: event.title,
      message: event.message,
      createdAt: event.createdAt,
      evidence: event.evidence,
    })),
    rejectedConfirmations: rejectedConfirmations.map((confirmation) => ({
      id: confirmation.id,
      title: confirmation.title,
      operator: confirmation.operator,
      note: confirmation.note,
      decidedAt: confirmation.decidedAt,
    })),
  };
}

export function buildAgentAuditTrail(this: AgentHost, session: AgentSession) {
  const confirmationAudit = this.getSessionConfirmations(session)
    .filter((confirmation) => confirmation.status !== 'pending')
    .map((confirmation) => ({
      type: 'confirmation-decision' as const,
      action: confirmation.status,
      operator: confirmation.operator || 'system',
      reason: confirmation.note || confirmation.actionLabel,
      createdAt: confirmation.decidedAt || confirmation.createdAt,
      confirmationId: confirmation.id,
    }));
  const remoteAudit = (session.riskPolicy?.remoteAudit || []).map((audit) => ({
    type: 'remote-control' as const,
    action: audit.action,
    operator: audit.operator,
    reason: audit.reason,
    createdAt: audit.createdAt,
  }));
  return [...remoteAudit, ...confirmationAudit].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export function buildAgentEvidenceIndex(
  this: AgentHost,
  session: AgentSession,
  evidenceItems = collectAgentSessionEvidence(session),
) {
  const byType = groupEvidenceByType(evidenceItems);
  return {
    counts: byType,
    stageLogs: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) => item.type === 'stage_log'),
    ),
    failureReasons: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) => item.type === 'failure_reason'),
    ),
    riskAudits: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) => item.type === 'diagnostic_bundle'),
    ),
    confirmations: this.getSessionConfirmations(session).map(
      (confirmation) => ({
        id: confirmation.id,
        title: confirmation.title,
        status: confirmation.status,
        operator: confirmation.operator,
        createdAt: confirmation.createdAt,
        decidedAt: confirmation.decidedAt,
      }),
    ),
    browser: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) =>
        ['screenshot', 'page_snapshot', 'snapshot'].includes(item.type),
      ),
    ),
    desktop: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) => item.type === 'desktop_screenshot'),
    ),
    text: toAgentEvidenceIndexItems(
      evidenceItems.filter((item) => ['text', 'file'].includes(item.type)),
    ),
  };
}

export function toAgentEvidenceIndexItems(items: AgentEvidence[]) {
  return items.map((item) => ({
    id: item.id,
    eventId: item.eventId,
    type: item.type,
    label: item.label,
    stageKey: item.stageKey,
    createdAt: item.createdAt,
    artifactUrl: item.artifactUrl,
    valuePreview: previewEvidenceValue(item.value),
  }));
}

export function buildAgentEvidenceIntegrity(
  this: AgentHost,
  session: AgentSession,
  evidenceItems = collectAgentSessionEvidence(session),
  evidenceIndex = this.buildAgentEvidenceIndex(session, evidenceItems),
) {
  const missing = [
    evidenceItems.length ? '' : '缺少证据项',
    evidenceIndex.stageLogs.length ? '' : '缺少阶段日志',
    session.nextAction ? '' : '缺少 nextAction',
    evidenceIndex.riskAudits.length ? '' : '缺少风险审计',
    session.riskLevel !== 'high' || session.confirmations.length
      ? ''
      : '缺少确认记录',
    session.status !== 'failed' || evidenceIndex.failureReasons.length
      ? ''
      : '缺少失败原因证据',
    agentSessionNeedsBrowserEvidence(session) && !evidenceIndex.browser.length
      ? '缺少浏览器证据索引'
      : '',
    this.agentSessionNeedsDesktopEvidence(session) &&
    !evidenceIndex.desktop.length
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

export async function ensureAgentSessionEvidenceForExport(
  this: AgentHost,
  session: AgentSession,
) {
  let evidenceItems = collectAgentSessionEvidence(session);
  if (evidenceItems.length > 0) {
    return;
  }

  const failedAt = new Date().toISOString();
  session.status = 'failed';
  session.statusLabel = this.resolveAgentSessionStatusLabel('failed');
  session.updatedAt = failedAt;
  session.completedAt = failedAt;
  session.nextAction =
    '证据链为空，导出已标记 FAILED；请重新执行会话并确认阶段日志、确认记录和浏览器/桌面证据已生成。';
  this.pushAgentEvent(
    session,
    'error',
    '证据链缺失',
    'Agent 会话没有任何可导出的证据项，不能生成空证据包。',
    {
      type: 'failure_reason',
      label: '证据链缺失',
      value: 'Agent session evidence export blocked: no evidence items',
      stageKey: 'evidence-export',
    },
  );
  evidenceItems = collectAgentSessionEvidence(session);
  if (!evidenceItems.some((item) => item.type === 'stage_log')) {
    this.pushAgentEvent(
      session,
      'error',
      '阶段日志缺失',
      '证据导出失败，缺少阶段日志。',
      {
        type: 'stage_log',
        label: '证据导出失败',
        value: 'evidence-export / FAILED / missing evidence',
        stageKey: 'evidence-export',
      },
    );
  }
  await this.persistAgentSession(session);
}

export async function approveAgentConfirmation(
  this: AgentHost,
  id: string,
  input: AgentConfirmationDecisionInput = {},
  riskContext?: BackendRiskContext,
): Promise<AgentSession> {
  const scope = await this.resolveTenantScope();
  const cached = this.agentConfirmations.get(id);
  if (
    cached?.sessionId?.startsWith('interaction-task:') &&
    this.isInTenantScope(cached, scope)
  ) {
    return this.approveInteractionTaskConfirmation(cached, input);
  }

  const loaded = await this.getAgentConfirmation(id);
  if (!loaded) {
    throw new NotFoundException('确认项不存在');
  }
  const { confirmation, session } = loaded;
  if (confirmation.status !== 'pending') {
    return session;
  }

  const riskAudit = assertBackendRiskGate({
    action: 'agent-confirmation-approve',
    target: `${session.executionScope}:${session.targetApp || session.title}`,
    riskLevel: confirmation.riskLevel,
    requiresConfirmation: true,
    confirmation: input.riskConfirmation,
    context: riskContext,
    reason: confirmation.description,
  });

  const missingChecks = confirmation.requiredChecks.filter(
    (check) => check.required && input.confirmedChecks?.[check.key] !== true,
  );
  const blockedChecks = confirmation.requiredChecks.filter(
    (check) => check.required && check.status === 'blocked',
  );
  if (blockedChecks.length) {
    throw new BadRequestException(
      `当前不能批准，请先处理：${blockedChecks.map((check) => check.label).join('、')}`,
    );
  }
  if (missingChecks.length) {
    throw new BadRequestException(
      `请先确认：${missingChecks.map((check) => check.label).join('、')}`,
    );
  }

  confirmation.status = 'approved';
  confirmation.operator = input.operator?.trim() || '用户';
  confirmation.note = input.note?.trim();
  confirmation.confirmedChecks = input.confirmedChecks;
  confirmation.decidedAt = new Date().toISOString();
  this.syncAgentConfirmationIntoSession(session, confirmation);
  if (session.riskPolicy?.remoteTakeoverAuditRequired) {
    session.riskPolicy.remoteAudit.push({
      action: 'approved',
      operator: confirmation.operator,
      reason: confirmation.note || confirmation.actionLabel,
      createdAt: confirmation.decidedAt,
    });
  }
  session.updatedAt = confirmation.decidedAt;
  session.status = 'running';
  session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
  session.nextAction = '确认通过，正在继续执行原会话。';
  this.recordRemoteAudit(
    session,
    'started',
    confirmation.operator,
    '确认通过后恢复本机执行。',
  );
  this.pushAgentEvent(
    session,
    'success',
    '确认通过',
    `${confirmation.operator} 已确认：${confirmation.actionLabel}`,
    {
      type: 'stage_log',
      label: '审批日志',
      value: JSON.stringify(
        {
          operator: confirmation.operator,
          action: confirmation.actionLabel,
          checks: confirmation.confirmedChecks,
          remoteAudit: session.riskPolicy?.remoteAudit,
        },
        null,
        2,
      ),
      stageKey: 'approval',
    },
  );
  this.pushAgentEvent(
    session,
    'warning',
    '后端风控审批已记录',
    '账号、设备、动作、风险等级和确认记录已写入审计事件。',
    {
      type: 'diagnostic_bundle',
      label: '后端风控审计',
      value: JSON.stringify(riskAudit, null, 2),
      stageKey: 'approval',
    },
  );
  await this.persistAgentConfirmation(confirmation);
  await this.persistAgentSession(session);
  await this.resumeAgentSessionAfterApproval(session, confirmation);
  return session;
}

export async function approveInteractionTaskConfirmation(
  this: AgentHost,
  confirmation: AgentConfirmation,
  input: AgentConfirmationDecisionInput = {},
): Promise<AgentSession> {
  const scope = this.tenantScopeForRecord(confirmation);
  const taskId = confirmation.sessionId.replace('interaction-task:', '');
  const cachedTask = this.tasks.get(taskId);
  const task =
    cachedTask && this.isInTenantScope(cachedTask, scope)
      ? cachedTask
      : await this.loadStoredTask(taskId, scope);
  if (!task) {
    throw new NotFoundException('互动任务不存在');
  }
  if (task.status !== 'waiting_for_send_confirmation') {
    confirmation.status = 'approved';
    confirmation.decidedAt = new Date().toISOString();
    await this.persistAgentConfirmation(confirmation);
    return this.createSyntheticSessionForConfirmation(confirmation);
  }

  confirmation.status = 'approved';
  confirmation.operator = input.operator?.trim() || '用户';
  confirmation.note = input.note?.trim();
  confirmation.confirmedChecks = input.confirmedChecks;
  confirmation.decidedAt = new Date().toISOString();
  await this.persistAgentConfirmation(confirmation);

  await this.approveTask(task.id, {
    operator: confirmation.operator,
    note: confirmation.note,
    riskConfirmation: {
      confirmed: true,
      confirmedAction: 'interaction-approval',
      confirmedRiskLevel: task.riskLevel || 'medium',
      operator: confirmation.operator,
      reason: confirmation.note || confirmation.description,
      confirmedAt: confirmation.decidedAt,
    },
    targetConfirmed: true,
    contentConfirmed: true,
    currentWindowConfirmed: true,
    contactConfirmed: true,
    draftBeforeFillConfirmed: true,
    checklistConfirmed: true,
    commercialPermissionConfirmed: true,
    misfireProtectionConfirmed: true,
    doubleConfirmationConfirmed: task.requiresDoubleConfirmation
      ? true
      : undefined,
    targetContact: task.targetName,
  });

  return this.createSyntheticSessionForConfirmation(confirmation);
}

export function createSyntheticSessionForConfirmation(
  this: AgentHost,
  confirmation: AgentConfirmation,
): AgentSession {
  return {
    id: confirmation.sessionId,
    tenantId: confirmation.tenantId,
    userId: confirmation.userId,
    title: confirmation.title,
    instruction: confirmation.description,
    status: 'running',
    statusLabel: '执行中',
    executionScope: 'browser',
    source: 'agent-console',
    createdAt: confirmation.createdAt,
    updatedAt: confirmation.decidedAt || new Date().toISOString(),
    riskLevel: confirmation.riskLevel,
    confirmations: [confirmation],
    events: [],
  };
}

export async function rejectAgentConfirmation(
  this: AgentHost,
  id: string,
  input: AgentConfirmationDecisionInput = {},
): Promise<AgentSession> {
  const scope = await this.resolveTenantScope();
  const cached = this.agentConfirmations.get(id);
  if (
    cached?.sessionId?.startsWith('interaction-task:') &&
    this.isInTenantScope(cached, scope)
  ) {
    return this.rejectInteractionTaskConfirmation(cached, input);
  }

  const loaded = await this.getAgentConfirmation(id);
  if (!loaded) {
    throw new NotFoundException('确认项不存在');
  }
  const { confirmation, session } = loaded;
  if (confirmation.status !== 'pending') {
    return session;
  }
  confirmation.status = 'rejected';
  confirmation.operator = input.operator?.trim() || '用户';
  confirmation.note = input.note?.trim();
  confirmation.decidedAt = new Date().toISOString();
  this.syncAgentConfirmationIntoSession(session, confirmation);
  if (session.riskPolicy?.remoteTakeoverAuditRequired) {
    session.riskPolicy.remoteAudit.push({
      action: 'rejected',
      operator: confirmation.operator,
      reason: confirmation.note || '用户拒绝继续执行',
      createdAt: confirmation.decidedAt,
    });
  }
  session.status = 'cancelled';
  session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
  session.updatedAt = confirmation.decidedAt;
  session.completedAt = confirmation.decidedAt;
  session.nextAction = '确认被拒绝，会话已停止。';
  this.pushAgentEvent(
    session,
    'warning',
    '确认被拒绝',
    confirmation.note || '用户拒绝继续执行。',
    {
      type: 'stage_log',
      label: '审批日志',
      value: JSON.stringify(session.riskPolicy?.remoteAudit || [], null, 2),
      stageKey: 'approval',
    },
  );
  this.pushAgentEvent(
    session,
    'error',
    '执行被人工拒绝',
    confirmation.note || '用户拒绝继续执行。',
    {
      type: 'failure_reason',
      label: '拒绝原因',
      value: confirmation.note || '用户拒绝继续执行。',
      stageKey: 'approval',
    },
  );
  await this.persistAgentConfirmation(confirmation);
  await this.persistAgentSession(session);
  return session;
}

export async function rejectInteractionTaskConfirmation(
  this: AgentHost,
  confirmation: AgentConfirmation,
  input: AgentConfirmationDecisionInput = {},
): Promise<AgentSession> {
  const scope = this.tenantScopeForRecord(confirmation);
  const taskId = confirmation.sessionId.replace('interaction-task:', '');
  const cachedTask = this.tasks.get(taskId);
  const task =
    cachedTask && this.isInTenantScope(cachedTask, scope)
      ? cachedTask
      : await this.loadStoredTask(taskId, scope);

  confirmation.status = 'rejected';
  confirmation.operator = input.operator?.trim() || '用户';
  confirmation.note = input.note?.trim() || '用户拒绝发送';
  confirmation.decidedAt = new Date().toISOString();
  await this.persistAgentConfirmation(confirmation);

  if (task && task.status === 'waiting_for_send_confirmation') {
    task.status = 'skipped';
    task.statusLabel = this.resolveStatusLabel('skipped');
    task.nextAction = `用户拒绝发送：${confirmation.note}`;
    task.completedAt = confirmation.decidedAt;
    void this.setTaskStep(task, 'send-approval', 'skipped', '用户拒绝发送。');
    void this.setTaskStep(task, 'send-result', 'skipped', '用户拒绝发送，未执行。');
    await this.persistTask(task);
  }

  return this.createSyntheticSessionForConfirmation(confirmation);
}

export async function clearPendingConfirmations(
  this: AgentHost,
): Promise<{ cleared: number }> {
  const scope = await this.resolveTenantScope();
  await this.hydrateAgentConfirmationsFromStore(500, scope);
  await this.hydrateAgentSessionsFromStore(200, scope);
  const pending = [...this.agentConfirmations.values()].filter(
    (c) => this.isInTenantScope(c, scope) && c.status === 'pending',
  );
  const now = new Date().toISOString();
  for (const confirmation of pending) {
    confirmation.status = 'rejected';
    confirmation.operator = '系统清理';
    confirmation.note = '批量清理历史确认项';
    confirmation.decidedAt = now;
    await this.persistAgentConfirmation(confirmation);
    const session = this.agentSessions.get(confirmation.sessionId);
    if (session && this.isInTenantScope(session, scope)) {
      this.syncAgentConfirmationIntoSession(session, confirmation);
      if (
        session.status === 'waiting_for_confirmation' ||
        session.status === 'running'
      ) {
        session.status = 'cancelled';
        session.statusLabel = this.resolveAgentSessionStatusLabel(
          session.status,
        );
        session.updatedAt = now;
        session.completedAt = now;
        session.nextAction = '历史确认项已清理，会话已停止。';
        await this.persistAgentSession(session);
      }
    }
  }
  return { cleared: pending.length };
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const agentMethods = {
  listAgentSessions,
  getAgentSession,
  createAgentSession,
  createPublishTrackingSession,
  completePublishTrackingSession,
  continueAgentSession,
  stopAgentSession,
  archiveAgentSession,
  exportAgentSessionEvidence,
  listAgentSessionEvidence,
  resolveEvidenceFilePath,
  resolveBrowserEvidenceFilePath,
  normalizeEvidenceFilePath,
  listAgentSessionConfirmations,
  listAgentConfirmations,
  matchesAgentSessionFilter,
  withAgentConfirmationSession,
  getAgentConfirmation,
  rememberAgentSession,
  mergeAgentConfirmations,
  getSessionConfirmations,
  getSessionPendingConfirmations,
  syncAgentConfirmationIntoSession,
  closePendingAgentConfirmations,
  buildAgentReplayTimeline,
  buildAgentEvidenceSummary,
  buildAgentFailureAnalysis,
  buildAgentAuditTrail,
  buildAgentEvidenceIndex,
  toAgentEvidenceIndexItems,
  buildAgentEvidenceIntegrity,
  ensureAgentSessionEvidenceForExport,
  approveAgentConfirmation,
  approveInteractionTaskConfirmation,
  createSyntheticSessionForConfirmation,
  rejectAgentConfirmation,
  rejectInteractionTaskConfirmation,
  clearPendingConfirmations,
};
