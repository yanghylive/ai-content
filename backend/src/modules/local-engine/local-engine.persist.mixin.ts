// local-engine 持久化簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 PersistHost 接口：
// prisma/taskPersistQueues/taskStoreReady/replyRules/agentConfirmations/configService 字段，
// customer-service/agent/hydrate 簇方法。

import {
  createId,
  delay,
  isDesktopInteractionTask,
} from './local-engine.utils';

import { ForbiddenException } from '@nestjs/common';
import { Prisma, type InteractionReplyRule } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlaywrightMcpService } from './playwright-mcp.service';
import type {
  AgentConfirmation,
  AgentSession,
  AgentSessionSource,
  InteractionReplyRuleConfig,
  InteractionTask,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineTenantScope,
} from './local-engine.types';
type PrismaInteractionTaskStatus = Prisma.InteractionTaskCreateInput['status'];
type PrismaInteractionTaskType = Prisma.InteractionTaskCreateInput['taskType'];

/** 当前进程实例 ID：任务"认主"用（执行上下文绑定，防僵尸任务反复弹窗） */
export const TASK_CLAIMED_BY = `pid-${process.pid}-${Date.now()}`;

/** 启动时清理上次进程遗留的僵尸任务：RUNNING→FAILED、陈旧 QUEUED→FAILED */
export async function claimStaleTasks(this: PersistHost) {
  try {
    const { interactionTask } = this.prisma;
    if (!interactionTask?.updateMany) return 0;
    const [staleRunning, staleQueued] = await Promise.all([
      interactionTask.updateMany({
        where: { status: 'RUNNING', claimedBy: { not: TASK_CLAIMED_BY } },
        data: { status: 'FAILED', stage: 'interrupted-by-restart', updatedAt: new Date() },
      }),
      interactionTask.updateMany({
        where: {
          status: 'QUEUED',
          claimedBy: { not: TASK_CLAIMED_BY },
          createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) },
        },
        data: { status: 'FAILED', stage: 'stale-queued-on-restart', updatedAt: new Date() },
      }),
    ]);
    const total = staleRunning.count + staleQueued.count;
    if (total > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[LocalEngine] 启动清理僵尸任务: RUNNING→FAILED ${staleRunning.count} 个, 陈旧 QUEUED→FAILED ${staleQueued.count} 个`,
      );
    }
    return total;
  } catch {
    // 清理失败不阻塞启动
    return 0;
  }
}

/** 持久化簇的 host 接口：簇方法访问的 service 成员 */
export interface PersistHost {
  configService: ConfigService;
  prisma: PrismaService;
  playwrightMcp?: PlaywrightMcpService;
  taskStoreReady: Promise<void> | null;
  taskPersistQueues: Map<string, Promise<void>>;
  replyRule: InteractionReplyRuleConfig;
  replyRules: Map<string, InteractionReplyRuleConfig>;
  agentConfirmations: Map<string, AgentConfirmation>;
  getProjectLogRoot(): string;
  createDefaultReplyRule(): InteractionReplyRuleConfig;
  mergeAgentConfirmations(
    left: AgentConfirmation[],
    right: AgentConfirmation[],
  ): AgentConfirmation[];
  rememberAgentSession(session: AgentSession): AgentSession;
  resolveTenantScope(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<LocalEngineTenantScope>;
  authRequestContext?: { get(): { user?: { id?: string } } };
  tenantScopeKey(scope: LocalEngineTenantScope): string;
  taskStatusToPrisma: Record<string, string>;
  taskTypeToPrisma: Record<string, string>;
  ensureTaskStore(): Promise<void>;
  persistTask(task: InteractionTask): Promise<void>;
  persistTaskNow(task: InteractionTask): Promise<void>;
  runPrismaTransientRetry<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T>;
  isPrismaTransientConnectionError(error: unknown): boolean;
  formatPrismaRetryError(error: unknown): string;
  agentSessionSourceToPrisma(source?: AgentSessionSource): string;
  persistAgentConfirmation(confirmation: AgentConfirmation): Promise<void>;
  persistReplyRule(
    rule?: InteractionReplyRuleConfig,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<Prisma.InteractionReplyRuleGetPayload<object>>;
  toCustomerServiceReplyBot(row: InteractionReplyRule): {
    config: InteractionReplyRuleConfig;
  };
  normalizeStoredBatchTargets(task: InteractionTask): void;
  refreshTaskDiagnostics(task: InteractionTask): void;
  repairEvidenceIntegrityOnlyFailureTask(task: InteractionTask): boolean;
}

export function ensureTaskStore(this: PersistHost) {
  if (!this.taskStoreReady) {
    this.taskStoreReady = Promise.resolve();
  }

  return this.taskStoreReady;
}

export async function persistTask(this: PersistHost, task: InteractionTask) {
  const previous = this.taskPersistQueues.get(task.id) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => this.persistTaskNow(task));
  this.taskPersistQueues.set(task.id, next);
  try {
    await next;
  } finally {
    if (this.taskPersistQueues.get(task.id) === next) {
      this.taskPersistQueues.delete(task.id);
    }
  }
}

export async function persistTaskNow(this: PersistHost, task: InteractionTask) {
  await this.ensureTaskStore();
  if (!task.tenantId || !task.userId) {
    const scope = await this.resolveTenantScope().catch(() => null);
    if (scope) {
      task.tenantId = task.tenantId || scope.tenantId;
      task.userId = task.userId || scope.userId;
    }
  }
  if ((!task.tenantId || !task.userId) && task.id) {
    const existing = await this.prisma.interactionTask.findUnique({
      where: { id: task.id },
      select: { tenantId: true, userId: true },
    });
    if (existing?.tenantId && existing?.userId) {
      task.tenantId = task.tenantId || existing.tenantId;
      task.userId = task.userId || existing.userId;
    }
  }
  if (!task.tenantId || !task.userId) {
    throw new ForbiddenException('互动任务缺少租户归属，已拒绝写入。');
  }
  this.refreshTaskDiagnostics(task);
  const taskType = (this.taskTypeToPrisma[task.type] ||
    task.type) as PrismaInteractionTaskType;
  const status = (this.taskStatusToPrisma[task.status] ||
    task.status) as PrismaInteractionTaskStatus;
  const data = {
    tenantId: task.tenantId,
    userId: task.userId,
    taskType,
    status,
    accountId: task.accountId != null ? String(task.accountId) : null,
    ruleId: task.replyBotId ?? null,
    sendMode: task.sendMode || 'approval-send',
    riskLevel: task.riskLevel || 'medium',
    stage: task.diagnostics?.currentStep ?? null,
    currentTarget: task.targetName ?? null,
    draftText: task.replyText ?? null,
    processedCount: task.batchSummary
      ? task.batchSummary.total -
        task.batchSummary.queued -
        task.batchSummary.failed -
        task.batchSummary.skipped
      : 0,
    failedCount: task.batchSummary?.failed ?? 0,
    skippedCount: task.batchSummary?.skipped ?? 0,
    batchTargets: task.batchTargets ?? undefined,
    batchSummary: task.batchSummary ?? undefined,
    events: task.events ?? [],
    evidence: (task as { evidence?: unknown }).evidence ?? [],
    config: task as unknown as Prisma.InputJsonValue,
    createdBy: (task as { createdBy?: string | null }).createdBy ?? null,
    localTaskId: (task as { localTaskId?: string | null }).localTaskId ?? null,
    requiresDoubleConfirmation: task.requiresDoubleConfirmation ?? false,
    // 执行上下文绑定：记录当前进程认领（防重启后遗留 RUNNING 僵尸任务）
    claimedBy: TASK_CLAIMED_BY,
    // 互动承接 SLA（报告 16.3 第 15 项）：默认 24h 内处理，超时转人工
    slaDueAt:
      (task as { slaDueAt?: string | Date | null }).slaDueAt ??
      new Date(Date.now() + 24 * 60 * 60 * 1000),
    handoffState:
      (task as { handoffState?: string | null }).handoffState ?? 'normal',
    handoffReason:
      (task as { handoffReason?: string | null }).handoffReason ?? null,
  };
  await this.runPrismaTransientRetry('persist interaction task', () =>
    this.prisma.interactionTask.upsert({
      where: {
        id: task.id,
        tenantId: task.tenantId,
        userId: task.userId,
      },
      create: { id: task.id, ...data, createdAt: new Date(task.createdAt) },
      update: data,
    }),
  );
}

export async function runPrismaTransientRetry<T>(
  this: PersistHost,
  label: string,
  action: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt >= 2 || !this.isPrismaTransientConnectionError(error)) {
        throw error;
      }
      const waitMs = 500 * (attempt + 1);
      console.warn(
        `[local-engine] ${label} transient database error, retrying in ${waitMs}ms`,
        this.formatPrismaRetryError(error),
      );
      await delay(waitMs);
    }
  }
  throw lastError;
}

export function isPrismaTransientConnectionError(
  this: PersistHost,
  error: unknown,
): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
  const message = this.formatPrismaRetryError(error);
  return (
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P2024' ||
    message.includes("Can't reach database server") ||
    message.includes('Timed out fetching a new connection') ||
    message.includes('Connection terminated unexpectedly') ||
    message.includes('ECONNRESET') ||
    message.includes('ECONNREFUSED')
  );
}

export function formatPrismaRetryError(
  this: PersistHost,
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function persistReplyRule(
  this: PersistHost,
  rule: InteractionReplyRuleConfig = this.replyRule,
  requestedScope?: LocalEngineTenantScope,
) {
  await this.ensureTaskStore();
  const scope = requestedScope || (await this.resolveTenantScope());
  const ruleJson = rule as unknown as Prisma.InputJsonValue;
  const row = await this.prisma.interactionReplyRule.upsert({
    where: {
      tenantId_userId_botKey: {
        ...scope,
        botKey: 'default',
      },
    },
    create: {
      id: createId(),
      ...scope,
      botKey: 'default',
      configVersion: rule.configVersion,
      revision: rule.revision,
      name: rule.botName || '销售顾问机器人',
      industry: rule.industryName,
      tone: rule.tone,
      sendMode: rule.defaultSendMode,
      keywords: rule.requireApprovalKeywords,
      forbiddenWords: rule.blockedKeywords,
      highlights: rule.serviceHighlights,
      closingText: rule.closingText,
      ruleJson,
      escalationRules: ruleJson,
      enabled: true,
    },
    update: {
      name: rule.botName || '销售顾问机器人',
      industry: rule.industryName,
      tone: rule.tone,
      sendMode: rule.defaultSendMode,
      keywords: rule.requireApprovalKeywords,
      forbiddenWords: rule.blockedKeywords,
      highlights: rule.serviceHighlights,
      closingText: rule.closingText,
      ruleJson,
      escalationRules: ruleJson,
      configVersion: rule.configVersion,
      revision: rule.revision,
    },
  });
  this.replyRules.set(this.tenantScopeKey(scope), rule);
  return row;
}

export async function persistAgentSession(
  this: PersistHost,
  session: AgentSession,
) {
  await this.ensureTaskStore();
  if (!session.tenantId || !session.userId) {
    throw new ForbiddenException('Agent 会话缺少租户归属，已拒绝写入。');
  }
  const sessionJson = session as unknown as Prisma.InputJsonValue;
  const data = {
    tenantId: session.tenantId,
    userId: session.userId,
    title: session.title,
    instruction: session.instruction,
    source: this.agentSessionSourceToPrisma(session.source),
    status: session.status,
    scope: session.executionScope,
    targetApp: session.targetApp ?? null,
    riskLevel: session.riskLevel ?? null,
    events: session.events ?? [],
    confirmations: session.confirmations ?? [],
    evidence: [],
    sessionJson,
    completedAt: session.completedAt ? new Date(session.completedAt) : null,
  };
  await this.prisma.agentSession.upsert({
    where: {
      id: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
    },
    create: {
      id: session.id,
      ...data,
      createdAt: new Date(session.createdAt),
    },
    update: data,
  });
  await Promise.all(
    session.confirmations.map((confirmation) =>
      this.persistAgentConfirmation(confirmation),
    ),
  );
}

export async function persistAgentConfirmation(
  this: PersistHost,
  confirmation: AgentConfirmation,
) {
  await this.ensureTaskStore();
  if (!confirmation.tenantId || !confirmation.userId) {
    throw new ForbiddenException('Agent 确认项缺少租户归属，已拒绝写入。');
  }
  const confirmationJson = confirmation as unknown as Prisma.InputJsonValue;
  const data = {
    tenantId: confirmation.tenantId,
    userId: confirmation.userId,
    sessionId: confirmation.sessionId,
    action: confirmation.actionLabel,
    riskLevel: confirmation.riskLevel,
    status: confirmation.status,
    target: confirmation.title,
    targetLabel: confirmation.title,
    content: confirmation.description,
    replyText: null,
    operator: confirmation.operator ?? null,
    note: confirmation.note ?? null,
    confirmationJson,
    decidedAt: confirmation.decidedAt ? new Date(confirmation.decidedAt) : null,
  };
  await this.prisma.agentConfirmation.upsert({
    where: {
      id: confirmation.id,
      tenantId: confirmation.tenantId,
      userId: confirmation.userId,
    },
    create: {
      id: confirmation.id,
      ...data,
      createdAt: new Date(confirmation.createdAt),
    },
    update: data,
  });
}

export function agentSessionSourceToPrisma(
  this: PersistHost,
  source?: AgentSessionSource,
) {
  return source === 'agent-console' ? 'agent_console' : (source ?? 'web');
}

export async function loadReplyRuleFromStore(
  this: PersistHost,
  requestedScope?: LocalEngineTenantScope,
): Promise<InteractionReplyRuleConfig> {
  await this.ensureTaskStore();
  const scope = requestedScope || (await this.resolveTenantScope());
  const cacheKey = this.tenantScopeKey(scope);
  const cached = this.replyRules.get(cacheKey);
  if (cached) {
    return cached;
  }

  let row: Prisma.InteractionReplyRuleGetPayload<object> | null =
    await this.runPrismaTransientRetry<Prisma.InteractionReplyRuleGetPayload<object> | null>(
      'load scoped interaction reply rule',
      () =>
        this.prisma.interactionReplyRule.findFirst({
          where: { ...scope, botKey: 'default' },
        }),
    );
  if (!row) {
    row = await this.persistReplyRule(this.createDefaultReplyRule(), scope);
  }
  const rule = this.toCustomerServiceReplyBot(row).config;
  this.replyRules.set(cacheKey, rule);
  return rule;
}

export function resolveSummaryPlatformName(
  this: PersistHost,
  type: InteractionTaskType,
) {
  if (type.startsWith('douyin')) return '抖音';
  if (type.startsWith('wechat-channel')) return '视频号';
  if (isDesktopInteractionTask(type)) return '微信';
  return '客户跟进';
}

export function resolveSummaryDiagnosticStatus(
  this: PersistHost,
  status: InteractionTaskStatus,
): NonNullable<InteractionTask['diagnostics']>['status'] {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'blocked') return 'blocked';
  if (status === 'skipped') return 'skipped';
  if (status === 'no_target') return 'no_target';
  if (status === 'waiting_for_send_confirmation') return 'waiting';
  return 'normal';
}

export async function hydrateAgentSessionsFromStore(
  this: PersistHost,
  limit = 50,
  requestedScope?: LocalEngineTenantScope,
) {
  const scope = requestedScope || (await this.resolveTenantScope());
  const sessionRows = await this.prisma.agentSession.findMany({
    where: scope,
    orderBy: { updatedAt: 'desc' },
    take: Math.max(1, Math.min(limit, 200)),
  });
  const confirmationRows = await this.prisma.agentConfirmation.findMany({
    where: scope,
    orderBy: { createdAt: 'desc' },
  });

  sessionRows.forEach((row) => {
    const session = row.sessionJson as AgentSession | null;
    if (session?.id) {
      session.tenantId = row.tenantId;
      session.userId = row.userId;
      const dbConfirmations = confirmationRows
        .filter((c) => c.sessionId === session.id)
        .map(
          (c) =>
            ({
              ...(c.confirmationJson as Record<string, unknown>),
              tenantId: c.tenantId,
              userId: c.userId,
            }) as unknown as AgentConfirmation,
        )
        .filter(Boolean);
      session.confirmations = this.mergeAgentConfirmations(
        session.confirmations || [],
        dbConfirmations,
      );
      this.rememberAgentSession(session);
    }
  });
}

export async function hydrateAgentConfirmationsFromStore(
  this: PersistHost,
  limit = 200,
  requestedScope?: LocalEngineTenantScope,
) {
  const scope = requestedScope || (await this.resolveTenantScope());
  const rows = await this.prisma.agentConfirmation.findMany({
    where: scope,
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(limit, 500)),
  });

  rows.forEach((row) => {
    const confirmation = row.confirmationJson as AgentConfirmation | null;
    if (confirmation?.id) {
      confirmation.tenantId = row.tenantId;
      confirmation.userId = row.userId;
      this.agentConfirmations.set(confirmation.id, confirmation);
    }
  });
}

export async function loadStoredAgentSession(
  this: PersistHost,
  id: string,
  requestedScope?: LocalEngineTenantScope,
) {
  const scope = requestedScope || (await this.resolveTenantScope());
  const row = await this.prisma.agentSession.findFirst({
    where: { id, ...scope },
  });
  if (!row) {
    return null;
  }
  const session = row.sessionJson as AgentSession | null;
  if (!session) {
    return null;
  }
  session.tenantId = row.tenantId;
  session.userId = row.userId;
  const confirmationRows = await this.prisma.agentConfirmation.findMany({
    where: { sessionId: id, ...scope },
    orderBy: { createdAt: 'desc' },
  });
  const dbConfirmations = confirmationRows
    .map(
      (c) =>
        ({
          ...(c.confirmationJson as Record<string, unknown>),
          tenantId: c.tenantId,
          userId: c.userId,
        }) as unknown as AgentConfirmation,
    )
    .filter(Boolean);
  session.confirmations = this.mergeAgentConfirmations(
    session.confirmations || [],
    dbConfirmations,
  );
  return session;
}

export async function loadStoredTask(
  this: PersistHost,
  id: string,
  requestedScope?: LocalEngineTenantScope,
) {
  const scope = requestedScope || (await this.resolveTenantScope());
  const row = await this.prisma.interactionTask.findFirst({
    where: { id, ...scope },
  });

  const task = (row?.config as InteractionTask) || null;
  if (task) {
    task.tenantId = row!.tenantId;
    task.userId = row!.userId;
    this.normalizeStoredBatchTargets(task);
    this.repairEvidenceIntegrityOnlyFailureTask(task);
    this.refreshTaskDiagnostics(task);
  }
  return task;
}

export async function getPlaywrightMcpStatusWithCount(this: PersistHost) {
  if (!this.playwrightMcp) {
    return {
      online: false,
      childProcessRunning: false,
      transport: 'none' as const,
      endpoint: '',
      pid: undefined,
      toolCount: 0,
      profileKey: undefined,
      profileDir: undefined,
      visibleWindow: false,
      isolated: false,
      readyForAutomation: false,
      requiredToolsReady: false,
      requiredTools: [],
      missingRequiredTools: [],
      message: 'PlaywrightMcpService 未注入',
    };
  }
  return this.playwrightMcp.getAutomationStatus();
}

export const persistMethods = {
  ensureTaskStore,
  persistTask,
  persistTaskNow,
  claimStaleTasks,
  runPrismaTransientRetry,
  isPrismaTransientConnectionError,
  formatPrismaRetryError,
  persistReplyRule,
  persistAgentSession,
  persistAgentConfirmation,
  agentSessionSourceToPrisma,
  loadReplyRuleFromStore,
  resolveSummaryPlatformName,
  resolveSummaryDiagnosticStatus,
  hydrateAgentSessionsFromStore,
  hydrateAgentConfirmationsFromStore,
  loadStoredAgentSession,
  loadStoredTask,
  getPlaywrightMcpStatusWithCount,
};
