import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants, existsSync, mkdirSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { extname, join, resolve } from 'node:path';

type WechatContactSyncAttempt = {
  result: Record<string, unknown> | null;
  diagnostics?: WechatContactsSyncDiagnostics;
};

type WechatChatHistoryCache = {
  source: WechatChatHistorySource;
  sessions: WechatChatSession[];
  messages: WechatChatMessage[];
  syncedAt?: string;
  blockers: string[];
  warnings: string[];
};

const BROWSER_INTERACTION_EXECUTOR_IDS = [
  'douyin-comment-reply',
  'douyin-direct-message-reply',
  'wechat-channel-comment-reply',
  'wechat-channel-direct-message-reply',
] as const;

const DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS = [
  'wechat-reply-draft',
  'wechat-friend-accept',
  'wechat-group-broadcast',
  'wechat-contact-add',
  'wechat-moments-publish',
  'wechat-moments-marketing',
] as const;

const ALL_INTERACTION_EXECUTOR_IDS = [
  ...BROWSER_INTERACTION_EXECUTOR_IDS,
  ...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS,
] as const;

import { createHash } from 'node:crypto';
import net from 'node:net';
import {
  Prisma,
  type InteractionReplyRule,
  type InteractionTaskStatus as PrismaInteractionTaskStatus,
  type InteractionTaskType as PrismaInteractionTaskType,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
import { McpRuntimeService } from './mcp-runtime.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { AgentSService } from '../agent-s/agent-s.service';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import {
  type AgentConfirmation,
  type AgentConfirmationDecisionInput,
  type AgentConfirmationListItem,
  type AgentConfirmationStatus,
  type AgentExecutionScope,
  type AgentEvidence,
  type AgentSessionResumeAction,
  type AgentSessionEvidenceExportResult,
  type AgentSessionEvidenceListResult,
  type AgentSessionListFilter,
  type AgentRiskLevel,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionSource,
  type AgentSessionStatus,
  type ArchiveAgentSessionInput,
  type ContinueAgentSessionInput,
  type CreateAgentSessionInput,
  type CreateCustomerServiceReplyTaskInput,
  type CreateInteractionTaskInput,
  type CustomerServiceReplyBot,
  type CustomerServiceReplyDecision,
  type CustomerServiceReplyPlatform,
  type InteractionBusinessRouteKey,
  type InteractionBatchTarget,
  type InteractionBatchTargetListResult,
  type InteractionApprovalInput,
  type InteractionApprovalRecord,
  type InteractionRecordsExportResult,
  type InteractionRecordsResult,
  type InteractionTaskDiagnosticExportResult,
  type InteractionReplyGeneratedBy,
  type InteractionEvidenceCleanupResult,
  type LocalEngineMisfireProtection,
  type LocalEngineDesktopStatus,
  type LocalEngineDesktopPermissionKey,
  type LocalEngineDesktopCommercialPreflight,
  type LocalEngineDesktopScreenshotEvidence,
  type LocalEngineWechatSessionStatus,
  type AlignWechatSessionInput,
  type LocalEnginePermissionStatus,
  type LocalEngineRiskPolicy,
  type LocalEngineSafetyBoundary,
  type LocalEngineSafetyCheck,
  type UpdateWechatSessionConfirmationInput,
  type WechatSessionControlInput,
  type SyncWechatChatHistoryInput,
  type SyncWechatChatHistoryResult,
  type WechatChatHistoryResult,
  type WechatChatHistorySource,
  type WechatChatHistoryStatus,
  type WechatChatMessage,
  type WechatChatSession,
  type WechatChatSessionsResult,
  type InteractionSendMode,
  type InteractionTaskStepStatus,
  type InteractionTaskListFilter,
  type InteractionTaskResultKind,
  type InteractionTaskResultSummary,
  type InteractionReplyRuleConfig,
  type InteractionTask,
  type AutomationTaskView,
  type AutomationTaskViewStatus,
  type InteractionTaskBillingIdentity,
  type InteractionTaskEvent,
  type InteractionExecutorDraftResult,
  type CustomerServiceKnowledgeContext,
  type LocalEngineEntitlementUser,
  type InteractionTaskStatus,
  type InteractionTaskType,
  type ResendGroupBroadcastPlanInput,
  type RetryInteractionTaskInput,
  type LocalEngineBrowserStatus,
  type LocalEngineCapability,
  type LocalEngineCapabilityStatus,
  type LocalEngineExecutorCapability,
  type LocalEngineFileAccessItem,
  type LocalEngineFileAccessStatus,
  type LocalEngineHealth,
  type LocalEngineReadiness,
  type LocalEngineExecutorsStatus,
  type LocalEngineRuntimeAction,
  type LocalEngineRuntimeActionResult,
  type LocalEngineRuntimeLog,
  type LocalEngineRuntimeServiceKey,
  type LocalEngineRuntimeService,
  type LocalEngineRuntimeStatus,
  type LocalEngineTenantScope,
  type UpdateInteractionReplyRuleInput,
  type UpsertWechatContactInput,
  type WechatContact,
  type WechatChatHistoryCacheInfo,
  type WechatContactsDiagnosticsExportResult,
  type WechatContactsExportResult,
  type WechatContactsReadinessCheck,
  type WechatContactsReadinessResult,
  type WechatContactsResult,
  type WechatContactsSyncDiagnostics,
  type WechatContactsSyncInput,
  type WechatContactsSyncMode,
} from './local-engine.types';
import {
  createDefaultReplyRule,
  customerServiceMethods,
} from './local-engine.customer-service.mixin';
import { riskSafetyMethods } from './local-engine.risk-safety.mixin';

type InteractionTaskSummaryRow = Prisma.InteractionTaskGetPayload<{
  select: {
    id: true;
    tenantId: true;
    userId: true;
    taskType: true;
    accountId: true;
    sendMode: true;
    status: true;
    riskLevel: true;
    stage: true;
    currentTarget: true;
    draftText: true;
    processedCount: true;
    failedCount: true;
    skippedCount: true;
    batchTargets: true;
    batchSummary: true;
    config: true;
    createdBy: true;
    localTaskId: true;
    requiresDoubleConfirmation: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

import {
  type AutoUploadPublishPayload,
  type AutoUploadUploadFile,
} from '../auto-upload/auto-upload.client';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from '../runtime/orchestrator/interaction-task-runtime.mapper';
import type { ExecutorContext } from '../runtime/executor.interface';
import { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { isKaypalPlanAtLeast, normalizeKaypalPlan } from '../auth/plan-order';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { type WechatNativeCommandKey } from './wechat-native-command.contract';
import { promisify } from 'node:util';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveRuntimeStateRoot,
} from '../../common/project-paths';
import {
  buildAgentTitle,
  createId,
  delay,
  getProjectRoot,
  isBrowserPlatformInteractionTask,
  isDesktopInteractionTask,
  isEvidenceIntegrityText,
  optionalNumber,
  resolveAgentTargetApp,
  agentSessionNeedsBrowserEvidence,
  buildAutoSendReadbackMessage,
  buildBatchSummary,
  buildRecordsSummary,
  buildTaskFailureAnalysis,
  collectAgentSessionEvidence,
  defaultNextActionForStatus,
  formatConfirmationIndexForCsv,
  groupEvidenceByType,
  hasNoInteractionTarget,
  isDesktopWechatExecutionReady,
  isPlaceholderInteractionText,
  normalizeBatchTargetStatus,
  normalizeTaskDisplayText,
  shouldPreserveCompletedBusinessResult,
  shouldPreserveEvidenceIntegrityBlocker,
  summarizeDesktopWechatBlocker,
  taskNeedsBrowserEvidence,
  taskNeedsDesktopEvidence,
  toCsv,
  isWechatNoTargetMessage,
  normalizeStringList,
  previewEvidenceValue,
  resolveAgentRisk,
  resolveAgentScope,
  sanitizeInteractionFailureMessage,
  toNonNegativeInteger,
  toRuntimeRecord,
  toRuntimeString,
  optionalTrimmedText,
} from './local-engine.utils';
import { batchTargetMethods } from './local-engine.batch-targets.mixin';
import { wechatNativeMethods } from './local-engine.wechat-native.mixin';
import { contactMethods } from './local-engine.contact.mixin';
import {
  getRuntimePlatform,
  normalizeMomentsPromptConfig,
  readMetadataPositiveInteger,
  resolveWechatNativeRuntimePath,
  toWechatDesktopCommandError,
} from './local-engine.wechat-command.utils';
import type {
  ApprovedWechatTaskResult,
  WechatDesktopCommandResult,
} from './local-engine.wechat-command.utils';
import { WechatDesktopCommandError } from './local-engine.wechat-command.utils';
import {} from './local-engine.wechat-command.utils';

const execFileAsync = promisify(execFile);
const LOCAL_ENGINE_STATUS_CACHE_TTL_MS = 5000;
const WECHAT_RESUME_RISK_ACTION = 'interaction-resume';

/** batch targets 方法簇的 mixin 类型声明（实现见 local-engine.batch-targets.mixin.ts） */
type BatchTargetMetadata = {
  nextAction?: string;
  evidenceEventIds?: string[];
};

// mixin 模式：interface + class 同名合并是刻意设计（方法实现挂载见 local-engine.batch-targets.mixin.ts）
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface LocalEngineService {
  completeQueuedBatchTargets(
    task: InteractionTask,
    metadata?: BatchTargetMetadata,
  ): number;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markPausableBatchTargets(
    task: InteractionTask,
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markUnfinishedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markBatchTargetsForApprovalOutcome(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  markBatchTargetsByNames(
    task: InteractionTask,
    targetNames: string[],
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata?: BatchTargetMetadata,
  ): number;
  resolveWindowsWechatNativeCommandForTask(
    type: InteractionTaskType,
  ): WechatNativeCommandKey | undefined;
  resolveWechatNativeSendMode(task: InteractionTask);
  wechatNativeTargetRefs(
    task: InteractionTask,
    metadataValue?: unknown,
    max?: number,
  );
  wechatNativeAssetRefs(paths: string[]);
  buildWechatNativeCommandInput(
    command: WechatNativeCommandKey,
    task: InteractionTask,
  ): Record<string, unknown>;
  buildWechatNativeCommandRequest(
    command: WechatNativeCommandKey,
    task: InteractionTask,
  );
  runWechatNativeRuntimeCommand(
    commandKey: WechatNativeCommandKey,
    request: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  nativeRuntimeResponseMessage(
    command: WechatNativeCommandKey,
    parsed: Record<string, unknown>,
  );
  toWechatNativeDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult;
  tryRunWindowsWechatNativeControlledTask(
    task: InteractionTask,
  ): Promise<ApprovedWechatTaskResult | null>;
  sendApprovedWechatTask(
    task: InteractionTask,
  ): Promise<ApprovedWechatTaskResult>;

  resolveWechatContactAccountId(
    result: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    fallback?: string,
  ): string | undefined;
  isWechatContactsLegacyAccountlessRuntimeCache(input: {
    source?: string;
    items?: WechatContact[];
    currentWechatId?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): boolean;
  isWechatContactCacheAccountMismatch(
    cached: {
      currentWechatId?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ): boolean;
  withWechatContactsCacheAccountGuard(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ): {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  };
  buildWechatContactsCacheFallbackResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
    mode: WechatContactsSyncMode,
  ): Promise<WechatContactsResult | null>;
  buildWechatContactsBlockedResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    reason: string,
    diagnosticsInput: WechatContactsSyncDiagnostics | null | undefined,
    source: string,
    mode: WechatContactsSyncMode,
    options?: { includeCachedItems?: boolean },
  ): Promise<WechatContactsResult>;
  normalizeWechatContactsSyncMode(value: unknown): WechatContactsSyncMode;
  upsertWechatContact(
    input: UpsertWechatContactInput,
  ): Promise<WechatContactsResult>;
  removeWechatContact(wxid: string): Promise<WechatContactsResult>;
  clearWechatContacts(): Promise<WechatContactsResult>;
  exportWechatContacts(): Promise<WechatContactsExportResult>;
  exportWechatContactSyncDiagnostics(): Promise<WechatContactsDiagnosticsExportResult>;
  getWechatChatSessions(): Promise<WechatChatSessionsResult>;
  getWechatChatHistory(
    sessionId: string,
    limit?: number,
  ): Promise<WechatChatHistoryResult>;
  syncWechatChatHistory(
    input?: SyncWechatChatHistoryInput,
  ): Promise<SyncWechatChatHistoryResult>;
  getReadiness(
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineReadiness>;
  getRuntimeStatus(): Promise<LocalEngineRuntimeStatus>;
  runRuntimeAction(
    action: LocalEngineRuntimeAction,
    options?: {
      riskConfirmation?: BackendRiskConfirmationInput;
      riskContext?: BackendRiskContext;
    },
  ): Promise<LocalEngineRuntimeActionResult>;
  getRuntimeLog(
    key: LocalEngineRuntimeServiceKey,
    lineCount?: number,
  ): Promise<LocalEngineRuntimeLog>;
  getProjectLogRoot(): string;
  getRuntimeStateRoot(): string;
  getMacWechatCommandRoot(): string;
  resolveWechatContactSyncScriptPath(): string;
  resolveWechatChatHistorySyncScriptPath(): string;
  getWechatContactsCachePath(): string;
  getWechatContactsDiagnosticsPath(): string;
  readWechatContactSyncDiagnosticsFile(): Promise<
    Record<string, unknown> | undefined
  >;
  getWechatChatHistoryCachePath(): string;
  readWechatContactsCache(): Promise<{
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }>;
  writeWechatContactsCache(input: Record<string, unknown>): Promise<void>;
  buildWechatContactsResult(input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): WechatContactsResult;
  readWechatChatHistoryCache(): Promise<WechatChatHistoryCache>;
  writeWechatChatHistoryCache(input: WechatChatHistoryCache): Promise<void>;
  buildWindowsWechatChatHistoryFromContacts(
    cached: WechatChatHistoryCache,
  ): Promise<WechatChatHistoryCache>;
  normalizeWechatChatHistoryCache(input: unknown): WechatChatHistoryCache;
  normalizeWechatChatSession(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatSession | null;
  normalizeWechatChatMessage(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatMessage | null;
  normalizeWechatChatHistorySource(
    value: unknown,
    fallback?: WechatChatHistorySource,
  ): WechatChatHistorySource;
  normalizeWechatMessageDirection(
    value: unknown,
  ): WechatChatMessage['direction'];
  normalizeWechatMessageContentType(
    value: unknown,
  ): WechatChatMessage['contentType'];
  buildWechatChatSessionsResult(
    cache: WechatChatHistoryCache,
    options: { cached: boolean },
  ): WechatChatSessionsResult;
  buildWechatChatHistoryCacheInfo(
    cache: WechatChatHistoryCache,
  ): WechatChatHistoryCacheInfo;
  resolveWechatChatHistoryStatus(
    cache: WechatChatHistoryCache,
    itemCount: number,
  ): WechatChatHistoryStatus;
  resolveWechatChatHistoryNextAction(cache: WechatChatHistoryCache): string;
  withWechatChatHistoryBlocker(
    cache: WechatChatHistoryCache,
    blocker: string,
  ): WechatChatHistoryCache;
  compareOptionalTime(left?: string, right?: string): number;
  normalizeWechatContactList(
    value: unknown,
    defaults?: Partial<WechatContact>,
  ): WechatContact[];
  extractWechatContactCandidateTexts(value: unknown): string[];
  isPollutedWechatContactCandidateBatch(
    candidates: string[],
    source?: string,
  ): boolean;
  isRejectedWechatContact(contact: WechatContact): boolean;
  normalizeWechatContact(
    value: unknown,
    defaults?: Partial<WechatContact>,
  ): WechatContact | null;
  getWechatContactDisplay(contact: WechatContact): string;
  normalizeWechatContactsSyncDiagnostics(
    value: unknown,
    defaults?: Partial<WechatContactsSyncDiagnostics>,
  ): WechatContactsSyncDiagnostics | undefined;
  isNonWechatContactSyncDiagnostics(
    diagnostics?: WechatContactsSyncDiagnostics,
  ): boolean;
  normalizeJsonRecord(value: unknown): Record<string, unknown>;
  normalizeInteractionTaskBillingIdentity(
    value: unknown,
  ): InteractionTaskBillingIdentity | undefined;
  buildWechatNativeCommandRunnerReadinessCheck(
    commandRunners: Record<string, unknown> | undefined,
    platformName: string,
  ): WechatContactsReadinessCheck;
  resolveMacWechatCommandRunners(): Record<string, unknown>;
  buildMacWechatToolReadinessCheck(): WechatContactsReadinessCheck;
  normalizeJsonRecordArray(
    value: unknown,
  ): Record<string, unknown>[] | undefined;
  mergeWechatDiagnosticStringArrays(
    ...values: Array<string[] | undefined>
  ): string[];
  mergeWechatContactsSyncDiagnostics(
    ...values: unknown[]
  ): WechatContactsSyncDiagnostics | undefined;
  isWechatContactVisionFallbackEnabled(): boolean;
  tryRunWechatContactVisionFallback(
    error: unknown,
  ): Promise<WechatContactsResult | null>;
  humanizeWechatContactSyncErrorMessage(
    error: unknown,
    runtimePlatform?: ReturnType<typeof platform>,
  ): string;
  wechatContactSyncLastFailureMessage(
    lastFailure: Record<string, unknown>,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    runtimePlatform: ReturnType<typeof platform>,
  ): string;
  stringifyWechatDiagnosticMessage(value: unknown): string;
  optionalDiagnosticText(value: unknown): string | undefined;
  cleanWechatContactSyncUserMessage(
    value: string,
    runtimePlatform?: ReturnType<typeof platform>,
  ): string;
  shouldBlockWechatContactCacheFallback(
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ): boolean;
  toWechatContactsSyncException(
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
  ): BadRequestException;
  runWechatContactSyncScript(
    scriptPath: string,
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  runWechatWindowsContactSyncScript(
    mode?: WechatContactsSyncMode,
  ): Promise<Record<string, unknown>>;
  resolveWechatEnginePath(): string;
  getWechatContactSyncResultCount(result: Record<string, unknown>): number;
  getWechatContactSyncLowConfidenceReason(
    result: Record<string, unknown>,
    mode: WechatContactsSyncMode,
  ): string;
  withWechatContactFallbackDiagnostics(
    result: Record<string, unknown>,
    fallbackDiagnostics: WechatContactsSyncDiagnostics[],
  ): Record<string, unknown>;
  tryRunWechatNativeContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    decryptionHelperPath: string,
  ): Promise<WechatContactSyncAttempt>;
  tryRunWechatEngineContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
  ): Promise<WechatContactSyncAttempt>;
  probeWechatNativeContactRuntime(
    nativeRuntimePath: string,
  ): Promise<WechatContactsSyncDiagnostics | undefined>;
  runWechatEngineContactSyncScript(
    enginePath: string,
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    runtimeName?: string,
  ): Promise<Record<string, unknown>>;
  resolveWechatDbHelperPath(): string;
  resolveWechatSqliteCliPath(): string;
  writeWechatContactSyncDiagnostics(
    payload: Record<string, unknown>,
  ): Promise<void>;
  buildWechatContactFailureRecord(
    payload: Record<string, unknown>,
    capturedAt: string,
  ): Record<string, unknown>;
  buildWechatContactDiagnosticEvidencePackage(
    payload: Record<string, unknown>,
    failureRecord: Record<string, unknown>,
    generatedAt: string,
  ): Record<string, unknown>;
  validateWechatContactDiagnosticEvidencePackage(
    failureRecord: Record<string, unknown>,
  ): { ok: boolean; errors: string[]; warnings: string[] };
  inferWechatContactFailureNextAction(
    payload: string,
    parsed: string | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    message: string,
    screenshotPath: string,
  ): string;
  summarizeWechatContactFailureRaw(
    payload: Record<string, unknown>,
    parsed: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ): string;
  formatWechatContactsDiagnosticsForError(value: unknown): string;
  getWechatWindowsContactSyncScript(): string;
  getReplyRule(): Promise<InteractionReplyRuleConfig>;
  listReplyBots(): Promise<CustomerServiceReplyBot[]>;
  getReplyBot(id: string): Promise<CustomerServiceReplyBot>;
  createReplyBot(
    input?: UpdateInteractionReplyRuleInput,
  ): Promise<CustomerServiceReplyBot>;
  updateReplyBot(
    id: string,
    input: UpdateInteractionReplyRuleInput,
  ): Promise<CustomerServiceReplyBot>;
  setReplyBotEnabled(
    id: string,
    enabled: boolean,
    expectedRevision?: number,
  ): Promise<CustomerServiceReplyBot>;
  createCustomerServiceReplyTask(
    botId: string,
    input: CreateCustomerServiceReplyTaskInput,
  ): Promise<InteractionTask>;
  updateReplyRule(
    input: UpdateInteractionReplyRuleInput,
  ): Promise<InteractionReplyRuleConfig>;
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
  createDefaultReplyRule(): InteractionReplyRuleConfig;
  toCustomerServiceReplyBot(row: InteractionReplyRule): CustomerServiceReplyBot;
  normalizeCustomerServiceRule(
    input: UpdateInteractionReplyRuleInput,
    base: InteractionReplyRuleConfig,
  ): InteractionReplyRuleConfig;
  resolveCustomerServiceKnowledge(
    rule: InteractionReplyRuleConfig,
  ): Promise<CustomerServiceKnowledgeContext>;
  evaluateCustomerServiceReplyDecision(
    rule: InteractionReplyRuleConfig,
    input: {
      sourceText: string;
      replyText?: string;
      targetName?: string;
      accountName?: string;
      platform?: CustomerServiceReplyPlatform;
      contactLabels?: string[];
      requestedSendMode?: InteractionSendMode;
      commercialExecutionAllowed: boolean;
      knowledge: CustomerServiceKnowledgeContext;
      now?: Date;
    },
  ): CustomerServiceReplyDecision;
  matchCustomerServiceTerms(values: string[] | undefined, text: string);
  parseCustomerServiceReplyDelay(value: unknown, now: Date);
  resolveCustomerServicePlatform(
    rule: InteractionReplyRuleConfig,
    requested: CustomerServiceReplyPlatform | undefined,
    accountName: string,
  ): CustomerServiceReplyPlatform;
  resolveCustomerServiceSendMode(
    rule: InteractionReplyRuleConfig,
    requested: InteractionSendMode | undefined,
    sourceText: string,
    replyText: string,
    commercialExecutionAllowed: boolean,
  ): InteractionSendMode;
  buildReplyFromRule(
    sourceText: string,
    context?: { targetName?: string; accountName?: string },
    replyRule?: InteractionReplyRuleConfig,
  );
  tryGenerateInteractionReplyWithAi(
    sourceText: string,
    context: {
      targetName?: string;
      accountName?: string;
      fallbackReply: string;
    },
    replyRule?: InteractionReplyRuleConfig,
    knowledge?: CustomerServiceKnowledgeContext,
  );
  pickConfiguredFallbackReply(
    sourceText: string,
    rule?: InteractionReplyRuleConfig,
  );
  normalizeReplyGeneratedBy(
    value: unknown,
  ): InteractionReplyGeneratedBy | undefined;

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
    createdAt?: string,
  ): void;
  resolvePermissionStatusLabel(status: LocalEnginePermissionStatus): string;
  createAgentConfirmationChecks(
    session: AgentSession,
    riskLevel: Exclude<AgentRiskLevel, 'low'>,
  ): LocalEngineSafetyCheck[];
  allowLocalPlanBypass(): boolean;
  resolveAgentScopeLabel(scope: AgentExecutionScope): string;
}

@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class LocalEngineService {
  readonly startedAt = Date.now();
  readonly tasks = new Map<string, InteractionTask>();
  readonly agentSessions = new Map<string, AgentSession>();
  readonly agentConfirmations = new Map<string, AgentConfirmation>();
  readonly replyRules = new Map<string, InteractionReplyRuleConfig>();
  readonly taskPersistQueues = new Map<string, Promise<void>>();
  readonly browserInteractionQueues = new Map<string, Promise<void>>();
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
    alignment?: LocalEngineWechatSessionStatus['alignment'];
  } = {};
  readonly desktopEvidence: LocalEngineDesktopScreenshotEvidence[] = [];
  executorsStatusCache: {
    value: LocalEngineExecutorsStatus;
    expiresAt: number;
  } | null = null;
  desktopStatusWithEvidenceCache: {
    value: LocalEngineDesktopStatus;
    expiresAt: number;
  } | null = null;
  replyRule: InteractionReplyRuleConfig = createDefaultReplyRule();
  taskStoreReady: Promise<void> | null = null;
  readonly requiredInteractionExecutorIds = [...ALL_INTERACTION_EXECUTOR_IDS];

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AutoUploadService))
    private readonly autoUploadService: AutoUploadService,
    private readonly prisma: PrismaService,
    private readonly mcpRuntime: McpRuntimeService,
    private readonly agentSidecar: AgentSidecarService,
    private readonly sandboxRuntime: SandboxRuntimeService,
    private readonly pluginRuntime: PluginRuntimeService,
    private readonly memoryRuntime: MemoryRuntimeService,
    @Optional()
    @Inject(forwardRef(() => PlaywrightMcpService))
    private readonly playwrightMcp?: PlaywrightMcpService,
    @Optional()
    @Inject(forwardRef(() => RuntimeOrchestrator))
    private readonly runtimeOrchestrator?: RuntimeOrchestrator,
    @Optional()
    @Inject(forwardRef(() => BrowserControlService))
    private readonly browserControl?: BrowserControlService,
    @Optional()
    @Inject(forwardRef(() => NodeAgentRuntimeService))
    private readonly nodeAgentRuntime?: NodeAgentRuntimeService,
    @Optional()
    private readonly kaypalClient?: KaypalAuthClient,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly kaypalModelSync?: KaypalModelSyncService,
    @Optional()
    private readonly aiClient?: AiClientService,
    @Optional()
    private readonly defaultModels?: DefaultModelsService,
    @Optional()
    private readonly agentS?: AgentSService,
    @Optional()
    private readonly riskPolicyService?: RiskPolicyService,
  ) {}

  async resolveTenantScope(): Promise<LocalEngineTenantScope> {
    const context = this.authRequestContext?.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后访问客户互动数据。');
    }

    const requestedTenantId =
      context?.requestedTenantId?.trim() || context?.tenantId?.trim() || '';
    if (requestedTenantId) {
      if (
        user?.kaypalLocalOnly === true &&
        requestedTenantId === `local-desktop:${userId}`
      ) {
        return { tenantId: requestedTenantId, userId };
      }
      const membership = await this.prisma.tenantMember.findFirst({
        where: {
          userId,
          tenantId: requestedTenantId,
          status: 'active',
          tenant: { status: 'active' },
        },
        select: { tenantId: true },
      });
      if (membership?.tenantId === requestedTenantId) {
        return { tenantId: requestedTenantId, userId };
      }
      throw new ForbiddenException('当前账号无权访问指定组织。');
    }

    try {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: { tenantId: true },
      });
      if (membership?.tenantId) {
        return { tenantId: membership.tenantId, userId };
      }
    } catch (error) {
      if (user?.kaypalLocalOnly !== true) {
        throw error;
      }
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  tenantScopeKey(scope: LocalEngineTenantScope) {
    return `${scope.tenantId}\u0000${scope.userId}`;
  }

  isInTenantScope(
    record: { tenantId?: string | null; userId?: string | null },
    scope: LocalEngineTenantScope,
  ) {
    return record.tenantId === scope.tenantId && record.userId === scope.userId;
  }

  tenantScopeForRecord(record: {
    tenantId?: string | null;
    userId?: string | null;
  }): LocalEngineTenantScope {
    if (!record.tenantId || !record.userId) {
      throw new ForbiddenException('记录缺少租户归属，已拒绝访问。');
    }
    return { tenantId: record.tenantId, userId: record.userId };
  }

  useNodeAgentRuntime(): boolean {
    const value = (
      this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || ''
    )
      .trim()
      .toLowerCase();
    return value !== '0' && value !== 'false';
  }

  buildCurrentInteractionTaskBillingIdentity():
    | InteractionTaskBillingIdentity
    | undefined {
    const context = this.authRequestContext?.get();
    const user = context?.user;
    const sessionId = context?.sessionId?.trim() || '';
    const localUserId = user?.id?.trim() || '';
    const kaypalUserId = user?.kaypalUserId?.trim() || '';
    const deviceId = user?.kaypalDesktopDeviceId?.trim() || '';

    if (!sessionId || !localUserId || !kaypalUserId) {
      return undefined;
    }

    return {
      sessionId,
      localUserId,
      kaypalUserId,
      kaypalDesktopTokenExpiresAt:
        user?.kaypalDesktopTokenExpiresAt?.trim() || undefined,
      kaypalDesktopDeviceId: deviceId || undefined,
      kaypalPlan: user?.kaypalPlan,
      kaypalRole: user?.kaypalRole,
      kaypalPlatformRole: user?.kaypalPlatformRole,
      commercialExecutionAllowed: user?.commercialExecutionAllowed,
      planMode: user?.planMode,
      capturedAt: new Date().toISOString(),
    };
  }

  allowLocalPlanBypass(): boolean {
    return (
      this.configService.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') ===
      'true'
    );
  }

  currentActorCommercialAllowed(): boolean {
    const user = this.authRequestContext?.get()?.user;
    return (
      user?.commercialExecutionAllowed === true ||
      (Boolean(user?.kaypalPlan) &&
        user?.kaypalPlanExpired !== true &&
        isKaypalPlanAtLeast(user?.kaypalPlan, 'STANDARD'))
    );
  }

  isPrismaTableMissingError(error: unknown, tableName?: string) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      code === 'P2021' ||
      /does not exist in the current database/i.test(message) ||
      /no such table/i.test(message);
    return missing && (!tableName || message.includes(tableName));
  }

  formatCreditBalance(balance: number | null): string {
    if (balance == null) return '未同步';
    return Number.isInteger(balance)
      ? String(balance)
      : balance.toLocaleString('zh-CN', {
          maximumFractionDigits: 2,
        });
  }

  buildBlockedKaypalEntitlementCapability(
    now: string,
    summary: string,
    nextAction: string,
    checks: NonNullable<LocalEngineCapability['checks']>,
  ): LocalEngineCapability {
    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'blocked',
      required: true,
      summary,
      checkedAt: now,
      nextAction,
      checks,
    };
  }

  buildKaypalEntitlementTimeoutFallback(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): LocalEngineCapability {
    const cachedCapability = user
      ? this.buildCachedKaypalEntitlementCapability(
          now,
          user,
          user.kaypalPlan || '',
          '云端权益同步超过 6 秒；本机先按已登录套餐和本地会话继续验收。',
        )
      : null;
    if (cachedCapability) {
      return cachedCapability;
    }
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      'Kaypal 账号、订阅套餐和积分余额同步超时。',
      '确认 test.kaypal.cn 可访问，或在账号与设备页重新登录后刷新。',
      [
        {
          name: 'Kaypal 测试站',
          status: 'blocked',
          message: '检查超过 6 秒，不能证明授权、订阅和积分可用。',
        },
      ],
    );
  }

  buildCachedKaypalEntitlementCapability(
    now: string,
    user: LocalEngineEntitlementUser,
    plan: string,
    warning?: string,
  ): LocalEngineCapability | null {
    const cachedPlan = normalizeKaypalPlan(plan || user.kaypalPlan);
    const cachedPlanAllowed = isKaypalPlanAtLeast(cachedPlan, 'PRO');
    const localExecutionAllowed =
      (user.planMode || 'trial') === 'commercial' ||
      user.commercialExecutionAllowed === true ||
      (Boolean(user.kaypalPlan) &&
        user.kaypalPlanExpired !== true &&
        isKaypalPlanAtLeast(user.kaypalPlan, 'STANDARD'));

    if (
      !localExecutionAllowed ||
      !cachedPlanAllowed ||
      user.kaypalPlanExpired
    ) {
      return null;
    }

    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'ready',
      required: true,
      summary: warning
        ? `Kaypal 会话权益可用：套餐 ${cachedPlan}；${warning}`
        : `Kaypal 会话权益可用：套餐 ${cachedPlan}。`,
      checkedAt: now,
      nextAction: warning
        ? '云端权益会继续在账号与设备页同步；本机商用执行按当前登录态和本地权限继续验收。'
        : '',
      checks: [
        {
          name: 'Kaypal 授权',
          status: 'ready',
          message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，本地会话保留商用执行授权。`,
        },
        {
          name: '订阅套餐',
          status: 'ready',
          message: `本地会话套餐 ${cachedPlan}；满足 PRO / ADVANCED / FLAGSHIP 要求。`,
        },
        {
          name: '本机商用执行权限',
          status: 'ready',
          message: `planMode=${user.planMode}，commercialExecutionAllowed=${user.commercialExecutionAllowed}，kaypalPlan=${user.kaypalPlan}`,
        },
        {
          name: '积分余额',
          status: warning ? 'warning' : 'ready',
          message: warning || '云端权益同步正常。',
        },
      ],
    };
  }

  async buildKaypalEntitlementCapability(
    now: string,
    explicitUser?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability> {
    const requestContext = this.authRequestContext?.get();
    const user = explicitUser || requestContext?.user;
    if (!user) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        '当前请求没有登录上下文，不能确认 Kaypal 授权、订阅套餐和积分余额。',
        '重新登录 Kaypal 账号后刷新运行检查。',
        [
          {
            name: '登录上下文',
            status: 'blocked',
            message: 'AuthGuard 未提供当前用户上下文。',
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    if (!user.kaypalUserId) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        '当前本地账号未绑定 Kaypal 测试站账号。',
        '在账号与设备页重新登录 Kaypal 账号。',
        [
          {
            name: 'Kaypal 绑定',
            status: 'blocked',
            message: `本地用户 ${user.id} 没有 kaypalUserId。`,
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    const accessToken = toRuntimeString(user.kaypalDesktopAccessToken);
    if (!accessToken) {
      const cachedCapability = this.buildCachedKaypalEntitlementCapability(
        now,
        user,
        user.kaypalPlan || '',
        '当前会话没有可刷新的 Kaypal desktop access token；已使用本地已同步套餐继续验收。需要重新拉取云端套餐和积分时，请重新登录 Kaypal 账号。',
      );
      if (cachedCapability) {
        return cachedCapability;
      }
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        'Kaypal 测试站授权已失效，不能同步订阅套餐和积分余额。',
        '在账号与设备页重新登录 Kaypal 账号。',
        [
          {
            name: 'Kaypal 授权',
            status: 'blocked',
            message: '当前会话没有可用的 Kaypal desktop access token。',
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    if (!this.kaypalClient) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        'KaypalAuthClient 未注入，不能从测试站同步权益。',
        '检查 AuthModule 与 LocalEngineModule 的依赖装配。',
        [
          {
            name: 'KaypalAuthClient',
            status: 'blocked',
            message: '服务未注入。',
          },
        ],
      );
    }

    let billing: Awaited<ReturnType<KaypalAuthClient['getCloudBilling']>>;
    try {
      billing = await this.kaypalClient.getCloudBilling(accessToken, {
        userId: user.kaypalUserId || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      const cachedCapability = this.buildCachedKaypalEntitlementCapability(
        now,
        user,
        user.kaypalPlan || '',
        `远端权益同步暂时失败：${message}`,
      );
      if (cachedCapability) {
        return cachedCapability;
      }
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        `Kaypal 测试站权益同步失败：${message}`,
        '确认 test.kaypal.cn 可访问，或在账号与设备页重新授权后刷新。',
        [
          {
            name: 'Kaypal 授权',
            status: 'blocked',
            message,
          },
        ],
      );
    }

    const subscription = toRuntimeRecord(billing.subscription) || {};
    const subscriptionUnavailable = subscription.unavailable === true;
    const plan = normalizeKaypalPlan(subscription.plan || user.kaypalPlan);
    const subscriptionStatus =
      toRuntimeString(subscription.status) || 'unknown';
    const subscriptionExpired =
      user.kaypalPlanExpired === true ||
      subscription.expired === true ||
      subscriptionStatus.toLowerCase() === 'expired';
    const balanceUnavailable = billing.balance.unavailable === true;
    const balance = billing.balance.balance;
    const hasBalance = balance != null;
    const planAllowed = isKaypalPlanAtLeast(plan, 'PRO');
    const balanceReady = !balanceUnavailable && hasBalance && balance > 0;
    const remoteWarning = [
      subscriptionUnavailable
        ? toRuntimeString(subscription.message) || '订阅接口不可用'
        : '',
      balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
      !hasBalance ? '积分余额未同步' : '',
    ]
      .filter(Boolean)
      .join('；');
    const cachedCapability = this.buildCachedKaypalEntitlementCapability(
      now,
      user,
      plan,
      remoteWarning || undefined,
    );
    if (
      cachedCapability &&
      (subscriptionUnavailable || balanceUnavailable || !hasBalance)
    ) {
      return cachedCapability;
    }
    const ready =
      !subscriptionUnavailable &&
      !subscriptionExpired &&
      planAllowed &&
      balanceReady;

    const blockerMessages = [
      subscriptionExpired ? '订阅已过期' : '',
      subscriptionUnavailable
        ? toRuntimeString(subscription.message) || '订阅接口不可用'
        : '',
      !planAllowed
        ? `当前套餐 ${plan}，启动本地服务和真实自动化需要 PRO 及以上`
        : '',
      balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
      !hasBalance ? '积分余额未同步' : '',
      hasBalance && balance <= 0 ? '积分余额不足' : '',
    ].filter(Boolean);

    const subscriptionReady =
      !subscriptionUnavailable && !subscriptionExpired && planAllowed;

    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: ready ? 'ready' : 'blocked',
      required: true,
      summary: ready
        ? `Kaypal 权益已同步：套餐 ${plan}，积分 ${this.formatCreditBalance(balance)}。`
        : `Kaypal 权益未满足运行要求：${blockerMessages[0] || '未知阻断'}`,
      checkedAt: now,
      nextAction: ready
        ? ''
        : '在 Kaypal 测试站确认订阅套餐和积分余额，然后回到账号与设备页重新授权或刷新状态。',
      checks: [
        {
          name: 'Kaypal 授权',
          status: 'ready',
          message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，当前授权可访问测试站。`,
        },
        {
          name: '订阅套餐',
          status: subscriptionReady ? 'ready' : 'blocked',
          message: `当前套餐 ${plan}；运行检查启动服务要求 PRO / ADVANCED / FLAGSHIP。`,
        },
        {
          name: '订阅状态',
          status:
            subscriptionUnavailable || subscriptionExpired
              ? 'blocked'
              : 'ready',
          message: subscriptionUnavailable
            ? toRuntimeString(subscription.message) || '订阅接口不可用。'
            : `订阅状态 ${subscriptionStatus}。`,
        },
        {
          name: '积分余额',
          status: balanceReady ? 'ready' : 'blocked',
          message: balanceUnavailable
            ? billing.balance.message || 'Kaypal 积分接口不可用。'
            : `当前积分 ${this.formatCreditBalance(balance)}。`,
        },
      ],
    };
  }

  async buildNodeAgentRuntimeCapability(
    now: string,
    sidecarMessage = 'Node Runtime 模式不要求外部 Python sidecar 监听 17777；旧实现仅作为兼容/诊断项。',
  ): Promise<LocalEngineCapability> {
    if (!this.nodeAgentRuntime) {
      return {
        key: 'agent-s-sidecar',
        name: 'Agent-S 执行能力',
        status: 'blocked',
        required: true,
        summary: 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
        checkedAt: now,
        nextAction: '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
        checks: [
          {
            name: 'NodeAgentRuntimeService',
            status: 'blocked',
            message:
              '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
          },
        ],
      };
    }

    const health = await this.nodeAgentRuntime.health();
    const blockers = health.blockers || health.reasons || [];
    const browserReady = health.capabilities.browserControl === true;
    const status: LocalEngineCapabilityStatus = health.ok
      ? health.status === 'degraded'
        ? 'degraded'
        : 'ready'
      : 'blocked';

    return {
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status,
      required: true,
      summary: health.ok
        ? `Node Agent Runtime 已就绪（runner=${health.runner_mode}）。`
        : `Node Agent Runtime 未达到真实执行标准：${blockers[0] || health.status}`,
      checkedAt: now,
      nextAction:
        health.nextAction ||
        (health.ok
          ? ''
          : '接入非 mock 的包内 Agent-S 浏览器执行器，并完成真实读写、发送、回读和证据落库。'),
      checks: [
        {
          name: 'runner_mode',
          status: 'ready',
          message: `runner_mode=${health.runner_mode}`,
        },
        {
          name: 'browserControl',
          status: browserReady ? 'ready' : 'blocked',
          message: browserReady
            ? '已接入真实浏览器控制。'
            : '浏览器控制未开启，不能执行真实平台读取、发送和回读。',
        },
        {
          name: '证据读写',
          status: health.capabilities.evidenceStore ? 'ready' : 'blocked',
          message: health.capabilities.evidenceStore
            ? '平台执行截图、页面回读和动作结果会写入本地 evidence 目录；Node Runtime artifact 作为会话索引保存。'
            : '缺少真实截图/回读/动作证据落库。',
        },
        {
          name: '外部 17777 sidecar',
          status: 'optional',
          message: sidecarMessage,
        },
      ],
    };
  }

  buildLegacyAgentSCapability(
    now: string,
    sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
  ): LocalEngineCapability {
    const runnerReady =
      sidecarStatus.available &&
      sidecarStatus.runnerMode === 'real' &&
      sidecarStatus.sessionProtocol &&
      sidecarStatus.screenshotArtifacts &&
      sidecarStatus.executionControl;
    return {
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status: runnerReady ? 'ready' : 'blocked',
      required: true,
      summary: runnerReady
        ? sidecarStatus.message
        : `Agent-S 真实执行能力未就绪：${sidecarStatus.message}`,
      checkedAt: now,
      nextAction: runnerReady
        ? 'Agent-S 真实执行能力已接入。'
        : '旧 Python sidecar 路径必须启动 real runner，或迁移到包内 Node Runtime 真实执行层；mock/不可达不能通过。',
      checks: [
        {
          name: '执行服务',
          status: sidecarStatus.available ? 'ready' : 'blocked',
          message: sidecarStatus.available
            ? 'Agent-S 服务可访问。'
            : sidecarStatus.message,
        },
        {
          name: 'runner_mode',
          status: sidecarStatus.runnerMode === 'real' ? 'ready' : 'blocked',
          message: sidecarStatus.runnerMode
            ? `runner_mode=${sidecarStatus.runnerMode}`
            : '未读取到 runner_mode。',
        },
        {
          name: '会话协议',
          status: sidecarStatus.sessionProtocol ? 'ready' : 'blocked',
          message: sidecarStatus.sessionProtocol
            ? '会话协议可用。'
            : '会话协议不可用。',
        },
        {
          name: '截图与执行控制',
          status:
            sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
              ? 'ready'
              : 'blocked',
          message:
            sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
              ? '截图证据和执行控制可用。'
              : '截图证据或执行控制不可用。',
        },
      ],
    };
  }

  async getHealth(
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineHealth> {
    await this.ensureTaskStore();
    const tasks = [...this.tasks.values()];
    const now = new Date().toISOString();
    const capabilities = await this.getFastCapabilities(now, user);
    const blockers = capabilities
      .filter(
        (capability) =>
          capability.required !== false &&
          ['blocked', 'missing', 'degraded'].includes(capability.status),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));

    return {
      online: true,
      ready: blockers.length === 0,
      requiredBlocked: blockers.length,
      blockers,
      service: 'ai-content-local-engine',
      version: '0.1.0',
      mode: 'live',
      // engineUrl = 'internal://' 前缀：表示"我本身就是 local-engine，没有指向外部 runtime"
      // 8001 (kaypal-runtime) 已下线；Node Runtime 模式下 Agent-S 在 3011 进程内提供兼容 API。
      engineUrl: 'internal://ai-content/local-engine',
      engineNote: this.useNodeAgentRuntime()
        ? '内嵌：本机助手服务即本进程；Agent-S API 走包内 Node Runtime；外部 17777 sidecar 不是必需服务'
        : '内嵌：本机助手服务即本进程；Agent-S API 走旧 17777 sidecar；无外部 8001 runtime',
      checkedAt: now,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      queue: {
        running: tasks.filter((task) => task.status === 'running').length,
        waitingForApproval: tasks.filter(
          (task) => task.status === 'waiting_for_send_confirmation',
        ).length,
        completed: tasks.filter((task) => task.status === 'completed').length,
        failed: tasks.filter(
          (task) => task.status === 'failed' || task.status === 'blocked',
        ).length,
      },
      capabilities,
    };
  }

  async getFastCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]> {
    const playwrightStatus = this.playwrightMcp
      ? await this.withCapabilityTimeout(
          'playwright-mcp',
          this.playwrightMcp.getAutomationStatus(),
          {
            online: false,
            childProcessRunning: Boolean(
              this.playwrightMcp?.getStatus().childProcessRunning,
            ),
            transport: 'none' as const,
            endpoint: '',
            pid: this.playwrightMcp?.getStatus().pid,
            toolCount: 0,
            profileKey: this.playwrightMcp?.getStatus().profileKey,
            profileDir: this.playwrightMcp?.getStatus().profileDir,
            visibleWindow:
              this.playwrightMcp?.getStatus().visibleWindow ?? false,
            isolated: this.playwrightMcp?.getStatus().isolated ?? false,
            readyForAutomation: false,
            requiredToolsReady: false,
            requiredTools: [],
            missingRequiredTools: [],
            message: 'playwright-mcp 工具发现超时',
          },
        )
      : undefined;
    const useNodeRuntime = this.useNodeAgentRuntime();
    const nodeRuntimeInjected = Boolean(this.nodeAgentRuntime);
    const wechatSessionLocked =
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt;
    const hasKaypalUser = Boolean(user?.kaypalUserId);
    const hasCommercialSignal =
      user?.commercialExecutionAllowed === true ||
      user?.planMode === 'commercial' ||
      Boolean(user?.kaypalPlan && user.kaypalPlanExpired !== true);
    const agentSCapability: LocalEngineCapability = useNodeRuntime
      ? {
          key: 'agent-s-sidecar',
          name: 'Agent-S 执行能力',
          status: nodeRuntimeInjected ? 'optional' : 'blocked',
          required: !nodeRuntimeInjected,
          summary: nodeRuntimeInjected
            ? 'Node Agent Runtime 已注入；快速健康检查不递归调用真实执行器状态。'
            : 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
          checkedAt: now,
          nextAction: nodeRuntimeInjected
            ? '需要确认真实执行器、截图证据和浏览器控制时查看 /api/agent-s/status 或完整运行检查。'
            : '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
          checks: [
            {
              name: 'NodeAgentRuntimeService',
              status: nodeRuntimeInjected ? 'optional' : 'blocked',
              message: nodeRuntimeInjected
                ? '服务已注入；真实执行细节由 Agent-S 状态接口和 readiness 负责。'
                : '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
            },
          ],
        }
      : {
          key: 'agent-s-sidecar',
          name: 'Agent-S 执行能力',
          status: 'optional',
          required: false,
          summary:
            '旧 sidecar 模式需要完整检查确认 runner_mode=real；快速健康检查不阻塞等待 17777。',
          checkedAt: now,
          nextAction:
            '查看完整运行检查或 /api/agent-s/status；mock、不可达或缺少执行控制必须修复。',
          checks: [
            {
              name: '17777 sidecar',
              status: 'optional',
              message:
                '旧实现需要外部 sidecar，但快速检查不阻塞等待；完整 readiness 会读取真实状态。',
            },
          ],
        };
    return [
      {
        key: 'browser-control',
        name: '浏览器引擎',
        status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightStatus?.readyForAutomation
          ? `本地浏览器控制已启动（pid=${playwrightStatus.pid ?? '?'}）。`
          : '本地浏览器引擎未就绪，不能执行真实平台读取、发送和回读。',
        checkedAt: now,
        nextAction: playwrightStatus?.readyForAutomation
          ? ''
          : '检查包内 Playwright Chromium、@playwright/mcp 和 3011 启动日志。',
        checks: [
          {
            name: 'playwright-mcp',
            status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
            message:
              playwrightStatus?.message || '未检测到 playwright-mcp 状态。',
          },
        ],
      },
      {
        key: 'interaction-capabilities',
        name: '真实互动执行器',
        status: this.runtimeOrchestrator ? 'optional' : 'blocked',
        required: !this.runtimeOrchestrator,
        summary: this.runtimeOrchestrator
          ? '快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。'
          : 'RuntimeOrchestrator 未注入，真实互动执行器不可用。',
        checkedAt: now,
        nextAction: this.runtimeOrchestrator
          ? '查看 /local-engine/readiness 的完整 executor 结果。'
          : '检查 RuntimeModule 与 LocalEngineModule 装配。',
        checks: [
          {
            name: '执行入口',
            status: this.runtimeOrchestrator ? 'optional' : 'blocked',
            message: this.runtimeOrchestrator
              ? '已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。'
              : 'RuntimeOrchestrator 模块未连接。',
          },
        ],
      },
      {
        key: 'kaypal-entitlement',
        name: 'Kaypal 账号与权益',
        status: hasKaypalUser ? 'optional' : 'blocked',
        required: false,
        summary: hasKaypalUser
          ? hasCommercialSignal
            ? '已读取本地 Kaypal 登录态和套餐信号；云端套餐、积分余额和授权有效期由完整检查或真实扣点动作确认。'
            : '已读取本地 Kaypal 登录态；未在健康接口中确认商用套餐和积分余额。'
          : '快速健康检查未读取到 Kaypal 用户上下文；完整检查会给出登录和权益处理建议。',
        checkedAt: now,
        nextAction:
          '需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。',
        checks: [
          {
            name: '本地登录态',
            status: hasKaypalUser ? 'optional' : 'blocked',
            message: hasKaypalUser
              ? `本地会话已绑定 Kaypal 用户 ${user?.kaypalUserId}；未在健康接口中请求云端余额。`
              : '当前请求没有可用 Kaypal 用户上下文。',
          },
          {
            name: '积分余额',
            status: 'optional',
            message:
              '健康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。',
          },
        ],
      },
      {
        key: 'ai-reply-model',
        name: 'AI 回复模型',
        status: 'optional',
        required: false,
        summary:
          '默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。',
        checkedAt: now,
        nextAction:
          '到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。',
        checks: [
          {
            name: '默认模型配置',
            status: 'optional',
            message:
              '已跳过数据库和模型平台检查；真实 AI 任务会在执行前校验模型授权。',
          },
        ],
      },
      {
        key: 'desktop-control',
        name: '桌面控制',
        status: wechatSessionLocked ? 'ready' : 'optional',
        required: false,
        summary: wechatSessionLocked
          ? `已锁定微信联系人：${this.wechatSessionConfirmation.targetContact?.trim()}。`
          : '桌面微信状态不在快速健康检查里执行 AppleScript 探测；完整检查会确认窗口、权限和截图能力。',
        checkedAt: now,
        nextAction: wechatSessionLocked
          ? '微信任务仍会在发送/发布前回读目标和内容。'
          : '需要跑微信任务前先运行完整检查或进入桌面能力页确认权限。',
        checks: [
          {
            name: '联系人锁定',
            status: wechatSessionLocked ? 'ready' : 'optional',
            message: wechatSessionLocked
              ? '当前联系人、窗口和草稿确认状态已锁定。'
              : '快速健康检查未触发桌面窗口读取。',
          },
        ],
      },
      {
        key: 'mcp-manager',
        name: 'Playwright/MCP 工具',
        status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightStatus?.readyForAutomation
          ? `playwright-mcp sidecar 在线（${playwrightStatus.message}）。`
          : 'playwright-mcp 未就绪；浏览器自动化工具不可用。',
        checkedAt: now,
        nextAction: playwrightStatus?.readyForAutomation
          ? `MCP 端点 ${playwrightStatus.endpoint}；工具数 ${playwrightStatus.toolCount ?? 0}。`
          : '检查 3011 启动日志或在运行检查的浏览器页单独刷新 MCP 状态。',
        checks: [
          {
            name: 'sidecar 进程',
            status: playwrightStatus?.childProcessRunning ? 'ready' : 'blocked',
            message: playwrightStatus?.childProcessRunning
              ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightStatus.pid ?? '?'})`
              : '子进程未启动或正在启动。',
          },
          {
            name: 'HTTP 端点',
            status: playwrightStatus?.online ? 'ready' : 'blocked',
            message: playwrightStatus?.endpoint || '端点未就绪。',
          },
          {
            name: '浏览器工具',
            status: playwrightStatus?.requiredToolsReady ? 'ready' : 'blocked',
            message: playwrightStatus?.requiredToolsReady
              ? `${playwrightStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
              : `缺少必需工具：${(playwrightStatus?.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      agentSCapability,
      {
        key: 'wechat-execution',
        name: '微信完整执行链',
        status: wechatSessionLocked ? 'ready' : 'optional',
        required: false,
        summary: wechatSessionLocked
          ? '微信会话已锁定，执行链仍会在动作前做回读和确认。'
          : '微信执行链的进程、窗口、权限和截图能力只在完整检查或具体任务前校验。',
        checkedAt: now,
        nextAction:
          '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。',
        checks: [
          {
            name: '微信进程检测',
            status: 'optional',
            message:
              '快速健康检查未读取桌面进程，避免首页触发系统权限弹窗或超时。',
          },
          {
            name: '受控执行',
            status: 'ready',
            message: '微信任务只在确认后执行真实发送、发布、评论或加好友。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary:
          '远程任务通道保留会话、审计和证据字段；本机 AI 员工任务不依赖远程接管。',
        checkedAt: now,
        nextAction:
          '本机任务按当前电脑的浏览器、桌面微信和发布执行器状态判断。',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '远程接管不是当前本机执行必需条件。',
          },
          {
            name: '用户接管审计',
            status: 'ready',
            message: 'Agent 会话已保留接管审计字段。',
          },
        ],
      },
      {
        key: 'plugin-runtime',
        name: '插件与技能运行时',
        status: 'optional',
        required: false,
        summary: '插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。',
        checkedAt: now,
        nextAction: '需要诊断插件时进入后续插件页或单独运行插件检查。',
        checks: [
          {
            name: '插件目录',
            status: 'optional',
            message: '快速健康检查已跳过目录扫描。',
          },
          {
            name: '插件运行',
            status: 'optional',
            message: '插件执行不影响当前内容生产和客户互动主流程。',
          },
        ],
      },
      {
        key: 'memory-context',
        name: '记忆与上下文',
        status: 'optional',
        required: false,
        summary:
          '记忆系统不在快速健康检查里访问外部 Runtime，避免无配置时误报阻塞。',
        checkedAt: now,
        nextAction: '需要长期记忆时再配置 Redis/向量库或 Kaypal Runtime。',
        checks: [
          {
            name: '消息历史',
            status: 'optional',
            message: '快速健康检查未访问记忆服务。',
          },
          {
            name: '上下文压缩',
            status: 'optional',
            message: '向量库状态不影响当前本地发布和互动主流程。',
          },
        ],
      },
      {
        key: 'sandbox-execution',
        name: '沙箱执行',
        status: 'optional',
        required: false,
        summary:
          '当前一键桌面版不要求用户安装 Docker；沙箱执行保留为下一阶段能力。',
        checkedAt: now,
        nextAction: '本地用户安装包优先使用内置 Node Runtime，不依赖 Docker。',
        checks: [
          {
            name: '平台适配',
            status: 'optional',
            message: '未在快速健康检查中探测 Docker 或 native 沙箱。',
          },
          {
            name: '执行边界',
            status: 'optional',
            message: '当前主流程通过任务风险边界和证据链控制。',
          },
        ],
      },
      {
        key: 'evidence-replay',
        name: '证据链与回放',
        status: 'optional',
        required: false,
        summary:
          '证据链结构已接入；快速健康检查不扫描本地证据目录和任务记录表。',
        checkedAt: now,
        nextAction: '需要确认历史证据、截图和诊断包时运行完整检查。',
        checks: [
          {
            name: '截图证据',
            status: 'optional',
            message: '快速健康检查未访问截图目录。',
          },
          {
            name: '步骤回放',
            status: 'optional',
            message: '快速健康检查未访问任务记录和 evidenceReplay 结构。',
          },
        ],
      },
      {
        key: 'file-access',
        name: '文件访问',
        status: 'optional',
        required: false,
        summary:
          '素材、账号档案和证据目录读写不在快速健康检查里扫描；文件页会做完整验证。',
        checkedAt: now,
        nextAction: '进入文件访问页或运行完整检查确认目录读写权限。',
        checks: [
          {
            name: '目录读写检查',
            status: 'optional',
            message: '快速健康检查已跳过本地目录扫描。',
          },
        ],
      },
      {
        key: 'permission-check',
        name: '权限检查',
        status: 'ready',
        summary: '接口权限由 Kaypal 登录态和套餐守卫实时拦截。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '套餐权限',
            status: 'ready',
            message: '本地接口使用 AuthGuard 注入的 Kaypal 套餐判断。',
          },
        ],
      },
    ];
  }

  async saveInteractionAsset(file: AutoUploadUploadFile | undefined) {
    if (!file) {
      throw new BadRequestException('请选择朋友圈图片素材');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('图片素材为空，不能用于发布');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('朋友圈素材必须是图片文件');
    }
    const maxBytes = 30 * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException('朋友圈图片不能超过 30MB');
    }

    const assetDir = resolveProjectLogPath('interaction-assets');
    await mkdir(assetDir, { recursive: true });

    const fallbackExt =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg';
    const ext = extname(file.originalname || '').toLowerCase() || fallbackExt;
    const safeBaseName =
      (file.originalname || 'moments-asset')
        .replace(extname(file.originalname || ''), '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'moments-asset';
    const filename = `${Date.now()}-${safeBaseName}${ext}`;
    const filepath = join(assetDir, filename);

    await writeFile(filepath, file.buffer);

    return {
      filename,
      filepath,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      uploadedAt: new Date().toISOString(),
    };
  }

  async getWechatContacts(): Promise<WechatContactsResult> {
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      lastFailure?.diagnostics || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    return this.buildWechatContactsResult(cached);
  }

  async getWechatContactsReadiness(): Promise<WechatContactsReadinessResult> {
    const checkedAt = new Date().toISOString();
    const platformName = getRuntimePlatform();
    const nativeRuntimePath = resolveWechatNativeRuntimePath();
    const enginePath = this.resolveWechatEnginePath();
    const sqlitePath = this.resolveWechatSqliteCliPath();
    const dbHelperPath = this.resolveWechatDbHelperPath();
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      lastFailure?.diagnostics || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    const checks: WechatContactsReadinessCheck[] = [];
    const addCheck = (check: WechatContactsReadinessCheck) => {
      checks.push(check);
    };

    addCheck({
      key: 'platform',
      name: '桌面系统',
      status:
        platformName === 'win32'
          ? 'ready'
          : platformName === 'darwin'
            ? 'ready'
            : 'blocked',
      message:
        platformName === 'win32'
          ? '当前是 Windows，可执行微信通讯录同步。'
          : platformName === 'darwin'
            ? '当前是 macOS，可通过已登录的微信窗口同步通讯录。'
            : '当前系统不支持微信桌面通讯录同步。',
      nextAction:
        platformName === 'win32' || platformName === 'darwin'
          ? undefined
          : '请切换到已登录微信的 macOS 或 Windows 桌面系统。',
      details: { platform: platformName },
    });

    let nativeDiagnostics: WechatContactsSyncDiagnostics | undefined;
    if (platformName === 'win32') {
      addCheck({
        key: 'native-runtime',
        name: 'Kaypal 原生通讯录运行时',
        status: nativeRuntimePath ? 'ready' : 'warning',
        message: nativeRuntimePath
          ? '已找到 native runtime，会优先使用数据库/UIA 组合采集。'
          : '未找到 native runtime，会退回 legacy engine 或 PowerShell/OCR。',
        nextAction: nativeRuntimePath
          ? undefined
          : '请安装包含 desktop/runtime/wechat-native-runtime 的完整安装包。',
        details: nativeRuntimePath ? { path: nativeRuntimePath } : undefined,
      });

      addCheck({
        key: 'legacy-engine',
        name: 'Legacy 微信引擎',
        status: enginePath ? 'ready' : 'warning',
        message: enginePath
          ? '已找到 legacy wechat-engine，可作为 native runtime 失败后的备用通道。'
          : '未找到 legacy wechat-engine，只能依赖 PowerShell/OCR 兜底。',
        nextAction: enginePath
          ? undefined
          : '请确认安装包内带有 desktop/runtime/wechat-engine。',
        details: enginePath ? { path: enginePath } : undefined,
      });

      addCheck({
        key: 'sqlite-cli',
        name: 'SQLite 读取工具',
        status: sqlitePath ? 'ready' : 'warning',
        message: sqlitePath
          ? '已找到 sqlite3，可读取明文 contact.db。'
          : '未找到 sqlite3，明文数据库通道会跳过。',
        nextAction: sqlitePath
          ? undefined
          : '请随安装包携带 sqlite3.exe，或配置 AI_CONTENT_SQLITE_EXE。',
        details: sqlitePath ? { path: sqlitePath } : undefined,
      });

      addCheck({
        key: 'db-helper',
        name: '微信数据库 helper',
        status: dbHelperPath ? 'ready' : 'warning',
        message: dbHelperPath
          ? '已找到微信数据库 helper，可提升联系人读取成功率。'
          : '未找到微信数据库 helper，加密数据库只能靠 native runtime 或 UIA/OCR。',
        nextAction: dbHelperPath
          ? undefined
          : '请随安装包携带 wechat-db-helper/wechat-dump-rs，或配置 AI_CONTENT_WECHAT_DB_HELPER。',
        details: dbHelperPath ? { path: dbHelperPath } : undefined,
      });

      if (nativeRuntimePath) {
        nativeDiagnostics =
          await this.probeWechatNativeContactRuntime(nativeRuntimePath);
        if (nativeDiagnostics) {
          const hasBlockingSignal =
            /blocked|failed|error/i.test(
              nativeDiagnostics.platformStatus || '',
            ) ||
            /blocked|failed|error/i.test(
              nativeDiagnostics.windowStatus || '',
            ) ||
            /blocked|failed|error/i.test(nativeDiagnostics.helperStatus || '');
          addCheck({
            key: 'native-diagnose',
            name: 'Native runtime 诊断',
            status: hasBlockingSignal ? 'warning' : 'ready',
            message: hasBlockingSignal
              ? 'Native runtime 可启动，但诊断里有异常信号。'
              : 'Native runtime 诊断命令可启动并返回结构化结果。',
            nextAction: hasBlockingSignal
              ? '请先处理诊断里的窗口、权限或 helper 异常，再同步联系人。'
              : undefined,
            details: {
              stage: nativeDiagnostics.stage,
              windowStatus: nativeDiagnostics.windowStatus,
              dbStatus: nativeDiagnostics.dbStatus,
              helperStatus: nativeDiagnostics.helperStatus,
              uiaStatus: nativeDiagnostics.uiaStatus,
            },
          });
        } else {
          addCheck({
            key: 'native-diagnose',
            name: 'Native runtime 诊断',
            status: 'warning',
            message: 'Native runtime 存在，但诊断命令没有返回可解析结果。',
            nextAction: '安装包需要重新检查 native runtime 是否完整可执行。',
          });
        }
      }
    }

    if (platformName === 'darwin') {
      addCheck(this.buildMacWechatToolReadinessCheck());
    }

    addCheck(
      this.buildWechatNativeCommandRunnerReadinessCheck(
        platformName === 'darwin'
          ? this.resolveMacWechatCommandRunners()
          : nativeDiagnostics?.externalCommandRunners ||
              lastDiagnostics?.externalCommandRunners ||
              cached.diagnostics?.externalCommandRunners,
        platformName,
      ),
    );

    const cachedContactsNeedReview =
      /low-confidence|needs-review|review-required/i.test(
        [cached.diagnostics?.uiaStatus, ...(cached.diagnostics?.warnings || [])]
          .filter(Boolean)
          .join(' '),
      );
    addCheck({
      key: 'cached-contacts',
      name: '本地联系人缓存',
      status: cached.items.length
        ? cachedContactsNeedReview
          ? 'warning'
          : 'ready'
        : 'warning',
      message: cached.items.length
        ? cachedContactsNeedReview
          ? `本机已有 ${cached.items.length} 个联系人，来自窗口文字识别，使用前需要复核姓名。`
          : `本机已有 ${cached.items.length} 个联系人缓存。`
        : '本机还没有可用联系人缓存。',
      nextAction: cached.items.length
        ? cachedContactsNeedReview
          ? '请在微信工作台复核联系人姓名，删除误识别项后再用于批量任务。'
          : undefined
        : '首次使用请先点“同步联系人”，成功后群发/朋友圈营销才能直接填入名单。',
      details: {
        count: cached.items.length,
        source: cached.source,
        syncedAt: cached.syncedAt,
      },
    });

    if (lastFailure) {
      const lastFailureMessage =
        this.wechatContactSyncLastFailureMessage(
          lastFailure,
          lastDiagnostics,
          platformName,
        ) || '存在最近一次失败诊断。';
      addCheck({
        key: 'last-failure',
        name: '最近一次同步失败',
        status: 'warning',
        message: lastFailureMessage,
        nextAction: '点“导出诊断”把最近一次失败记录导出来排查。',
        details: {
          stage: lastDiagnostics?.stage,
          source: lastDiagnostics?.source,
          failureReason: lastDiagnostics?.failureReason,
          fallbackReason: lastDiagnostics?.fallbackReason,
          screenshotPath: lastDiagnostics?.screenshotPath,
        },
      });
    }

    const blockers = checks.filter((check) => check.status === 'blocked');
    const warnings = checks.filter((check) => check.status === 'warning');
    const status = blockers.length
      ? 'blocked'
      : warnings.length
        ? 'warning'
        : 'ready';

    return {
      ready: !blockers.length,
      status,
      checkedAt,
      platform: platformName,
      modeSupport: {
        random: platformName === 'win32' || platformName === 'darwin',
        all: platformName === 'win32' || platformName === 'darwin',
      },
      cached: {
        count: cached.items.length,
        source: cached.source,
        syncedAt: cached.syncedAt,
      },
      paths: {
        nativeRuntimePath,
        enginePath,
        sqlitePath,
        dbHelperPath,
      },
      checks,
      blockers,
      warnings,
      diagnostics: lastDiagnostics || cached.diagnostics,
      lastFailure,
      nextAction: blockers.length
        ? blockers[0].nextAction || blockers[0].message
        : warnings.length
          ? warnings[0].nextAction || warnings[0].message
          : '可以同步联系人。',
    };
  }

  async syncWechatContacts(
    input: boolean | WechatContactsSyncInput = false,
  ): Promise<WechatContactsResult> {
    const force = typeof input === 'boolean' ? input : Boolean(input?.force);
    const mode = this.normalizeWechatContactsSyncMode(
      typeof input === 'boolean' ? undefined : input?.mode,
    );
    const runtimePlatform = getRuntimePlatform();
    if (runtimePlatform !== 'darwin' && runtimePlatform !== 'win32') {
      throw new BadRequestException(
        '当前通讯录同步仅支持 macOS/Windows 微信桌面版，请在已登录微信的桌面系统上重试。',
      );
    }
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      lastFailure?.diagnostics || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    if (!force && cached.items.length && cached.syncedAt) {
      return {
        ...this.buildWechatContactsResult(cached),
        cached: true,
      };
    }

    let result: Record<string, unknown>;
    try {
      result =
        runtimePlatform === 'win32'
          ? await this.runWechatWindowsContactSyncScript(mode)
          : await this.runWechatContactSyncScript(
              this.resolveWechatContactSyncScriptPath(),
              mode,
            );
    } catch (error) {
      if (runtimePlatform === 'win32') {
        const visionResult =
          await this.tryRunWechatContactVisionFallback(error);
        if (visionResult) {
          result = visionResult;
        } else {
          const cachedFallback =
            await this.buildWechatContactsCacheFallbackResult(
              cached,
              error,
              runtimePlatform,
              mode,
            );
          if (cachedFallback) {
            return cachedFallback;
          }
          throw this.toWechatContactsSyncException(error, runtimePlatform);
        }
      } else {
        const cachedFallback =
          await this.buildWechatContactsCacheFallbackResult(
            cached,
            error,
            runtimePlatform,
            mode,
          );
        if (cachedFallback) {
          return cachedFallback;
        }
        if (force) {
          const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
            (error as { diagnostics?: unknown })?.diagnostics,
          );
          if (this.isWechatContactCacheAccountMismatch(cached, diagnostics)) {
            const message = this.humanizeWechatContactSyncErrorMessage(
              error,
              runtimePlatform,
            );
            return this.buildWechatContactsBlockedResult(
              cached,
              message,
              diagnostics,
              diagnostics?.source || 'wechat-contact-cache-account-guard',
              mode,
              { includeCachedItems: false },
            );
          }
        }
        throw this.toWechatContactsSyncException(error, runtimePlatform);
      }
    }
    const syncedAt = new Date().toISOString();
    const rawContactCandidates = this.extractWechatContactCandidateTexts(
      Array.isArray(result.items) ? result.items : result.contacts,
    );
    const contaminatedCandidates = rawContactCandidates.filter((item) =>
      /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/.test(
        item,
      ),
    );
    if (contaminatedCandidates.length) {
      throw new BadRequestException(
        `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${contaminatedCandidates.slice(0, 3).join('、')}`,
      );
    }
    const shellCandidates = rawContactCandidates
      .map((item) => item.trim())
      .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
    if (
      shellCandidates.length &&
      shellCandidates.length === rawContactCandidates.length
    ) {
      throw new BadRequestException(
        `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellCandidates.slice(0, 3).join('、')}`,
      );
    }
    const source =
      typeof result.source === 'string' ? result.source : 'macos-wechat-ocr';
    const normalizedResultDiagnostics =
      this.normalizeWechatContactsSyncDiagnostics(result.diagnostics, {
        source,
        screenshotPath:
          typeof result.screenshotPath === 'string'
            ? result.screenshotPath
            : '',
      });
    const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
      result,
      mode,
    );
    if (lowConfidenceReason) {
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        result.diagnostics,
        {
          source,
          failureLayer: 'quality-gate',
          failureReason: lowConfidenceReason,
          fallbackReason: lowConfidenceReason,
        },
      );
      const qualityGateError = new BadRequestException(
        `微信通讯录同步结果可信度不足，已拒绝覆盖本地名单：${lowConfidenceReason}`,
      ) as BadRequestException & { diagnostics?: unknown };
      qualityGateError.diagnostics = diagnostics;
      if (
        runtimePlatform !== 'win32' &&
        /微信账号标识|macOS OCR/i.test(lowConfidenceReason)
      ) {
        await this.buildWechatContactsBlockedResult(
          cached,
          lowConfidenceReason,
          diagnostics,
          source,
          mode,
          { includeCachedItems: false },
        );
        throw qualityGateError;
      }
      if (force && runtimePlatform === 'win32') {
        return this.buildWechatContactsBlockedResult(
          cached,
          lowConfidenceReason,
          diagnostics,
          source,
          mode,
          { includeCachedItems: false },
        );
      }
      const cachedFallback = await this.buildWechatContactsCacheFallbackResult(
        cached,
        qualityGateError,
        runtimePlatform,
        mode,
      );
      if (cachedFallback) {
        return cachedFallback;
      }
      return this.buildWechatContactsBlockedResult(
        cached,
        lowConfidenceReason,
        diagnostics,
        source,
        mode,
      );
    }
    const currentWechatId = this.resolveWechatContactAccountId(
      result,
      normalizedResultDiagnostics,
    );
    const plannedWechatId =
      typeof result.plannedWechatId === 'string'
        ? result.plannedWechatId
        : cached.plannedWechatId;
    const items = this.normalizeWechatContactList(
      Array.isArray(result.items) ? result.items : result.contacts,
      {
        syncedAt,
        currentWechatId,
        plannedWechatId,
      },
    );
    if (
      this.isPollutedWechatContactCandidateBatch(rawContactCandidates, source)
    ) {
      throw new BadRequestException(
        '微信通讯录同步结果疑似混入新闻、公众号或系统界面文字，已拒绝覆盖本地名单。',
      );
    }
    if (!items.length) {
      throw new BadRequestException(
        '微信通讯录同步没有读取到真实联系人，已拒绝覆盖本地名单。',
      );
    }
    const invalidContacts = items
      .flatMap((item) => [item.wxid, item.nickname, item.remark])
      .filter((item): item is string => Boolean(item))
      .filter((item) =>
        /抖音|发布中心|平台账号|视频工坊|内容素材|知识库|刷新状态|绑定平台/.test(
          item,
        ),
      );
    if (invalidContacts.length) {
      throw new BadRequestException(
        `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${invalidContacts.slice(0, 3).join('、')}`,
      );
    }
    const shellContacts = items
      .map((item) => this.getWechatContactDisplay(item).trim())
      .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
    if (shellContacts.length) {
      throw new BadRequestException(
        `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellContacts.slice(0, 3).join('、')}`,
      );
    }
    const cache = {
      source,
      items,
      currentWechatId,
      plannedWechatId,
      syncedAt,
      screenshotPath:
        typeof result.screenshotPath === 'string' ? result.screenshotPath : '',
      diagnostics: normalizedResultDiagnostics,
    };
    await this.writeWechatContactsCache(cache);
    await rm(this.getWechatContactsDiagnosticsPath(), { force: true }).catch(
      () => undefined,
    );

    return {
      ...this.buildWechatContactsResult(cache),
      cached: false,
    };
  }

  runWechatChatHistorySyncScript(
    scriptPath: string,
    input: SyncWechatChatHistoryInput,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, reject) => {
      const args = [scriptPath];
      if (input.sessionId) {
        args.push('--session-id', input.sessionId);
      }
      if (input.limit && Number.isFinite(Number(input.limit))) {
        args.push('--limit', String(Math.floor(Number(input.limit))));
      }
      const pythonCommand =
        process.env.AI_CONTENT_PYTHON_PATH?.trim() ||
        process.env.PYTHON?.trim() ||
        'python3';
      const child = spawn(pythonCommand, args, {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('微信聊天历史同步执行超时'));
      }, 180000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        if (code !== 0) {
          reject(
            new Error(
              (stderr || stdout || `微信聊天历史同步退出码 ${code}`).trim(),
            ),
          );
          return;
        }
        if (!output) {
          reject(new Error('微信聊天历史同步没有返回结果'));
          return;
        }
        try {
          resolvePromise(JSON.parse(output) as Record<string, unknown>);
        } catch (error) {
          reject(
            new Error(
              `微信聊天历史同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    });
  }

  getRuntimeServiceDefinitions() {
    const logDir = this.getProjectLogRoot();

    return [
      {
        key: 'frontend' as const,
        name: '主系统前端',
        url: 'http://localhost:3010/login',
        port: 3010,
        screenSession: 'ai-content-frontend',
        logPath: join(logDir, 'frontend-3010.log'),
      },
      {
        key: 'backend' as const,
        name: '主系统后端',
        url: 'http://localhost:3011/api/auth/setup-status',
        port: 3011,
        screenSession: 'ai-content-backend',
        logPath: join(logDir, 'backend-3011.log'),
      },
      {
        key: 'agent-s' as const,
        name: this.useNodeAgentRuntime()
          ? 'Agent-S 包内 Node Runtime'
          : 'Agent-S 桌面执行器',
        // Node Runtime 模式下不要求外部 17777 Python sidecar；Agent-S API 由 3011 进程提供。
        url: this.useNodeAgentRuntime()
          ? 'http://localhost:3011/api/agent-s/health'
          : 'http://127.0.0.1:17777/healthz',
        port: this.useNodeAgentRuntime() ? 3011 : 17777,
        screenSession: this.useNodeAgentRuntime()
          ? 'ai-content-backend'
          : 'agent-s',
        logPath: this.useNodeAgentRuntime()
          ? join(logDir, 'backend-3011.log')
          : join(logDir, 'agent-s-17777.log'),
      },
    ];
  }

  async inspectRuntimeService(
    service: Omit<
      LocalEngineRuntimeService,
      'online' | 'managedByScreen' | 'logExists' | 'message' | 'pid'
    >,
    screenSessions: Set<string>,
  ): Promise<LocalEngineRuntimeService> {
    const isNodeRuntimeAgentS =
      service.key === 'agent-s' && this.useNodeAgentRuntime();
    const httpProbeOptions =
      service.key === 'frontend'
        ? { attempts: 3, timeoutMs: 5000, retryDelayMs: 500 }
        : { attempts: 1, timeoutMs: 1500, retryDelayMs: 0 };
    const [portStatus, httpStatus] = await Promise.all([
      this.checkTcpPort(service.port),
      isNodeRuntimeAgentS
        ? Promise.resolve({
            ok: true,
            message: 'Agent-S API 由 3011 进程内 Node Runtime 提供',
          })
        : this.checkHttpUrl(service.url, httpProbeOptions),
    ]);
    const agentSHealth = isNodeRuntimeAgentS
      ? await this.nodeAgentRuntime?.health()
      : null;
    const nodeRuntimeMissing = isNodeRuntimeAgentS && !this.nodeAgentRuntime;
    const online =
      !nodeRuntimeMissing &&
      portStatus.open &&
      httpStatus.ok &&
      (isNodeRuntimeAgentS ? agentSHealth?.ok === true : true);
    const managedByScreen = screenSessions.has(service.screenSession);
    const logExists = existsSync(service.logPath);

    return {
      ...service,
      online,
      managedByScreen,
      logExists,
      pid: portStatus.pid,
      message: online
        ? `${service.name} 在线${managedByScreen ? '，由 screen 托管' : '，但未检测到托管会话'}`
        : nodeRuntimeMissing
          ? `${service.name} 阻断：NodeAgentRuntimeService 未注入`
          : agentSHealth && !agentSHealth.ok
            ? `${service.name} 阻断：${agentSHealth.reasons?.[0] || agentSHealth.blockers?.[0] || agentSHealth.status}`
            : `${service.name} 不可用：${httpStatus.message || portStatus.message}`,
    };
  }

  async readManagedScreenSessions(logDir: string) {
    const sessions = new Set<string>();
    await Promise.all(
      [
        ['frontend-3010.pid', 'ai-content-frontend'],
        ['backend-3011.pid', 'ai-content-backend'],
        ['agent-s-17777.pid', 'agent-s'],
      ].map(async ([filename, expectedSession]) => {
        try {
          const content = await readFile(join(logDir, filename), 'utf8');
          if (content.includes(expectedSession)) {
            sessions.add(expectedSession);
          }
        } catch {
          // Missing pid marker means the service may still be running, but not through our script.
        }
      }),
    );

    return sessions;
  }

  checkTcpPort(port: number) {
    return new Promise<{ open: boolean; message: string; pid?: number | null }>(
      (resolveResult) => {
        const socket = net.createConnection({
          host: '127.0.0.1',
          port,
          timeout: 800,
        });
        socket.once('connect', () => {
          socket.destroy();
          resolveResult({
            open: true,
            message: `端口 ${port} 可连接`,
            pid: null,
          });
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolveResult({
            open: false,
            message: `端口 ${port} 连接超时`,
            pid: null,
          });
        });
        socket.once('error', (error) => {
          resolveResult({ open: false, message: error.message, pid: null });
        });
      },
    );
  }

  async checkHttpUrl(
    url: string,
    options?: { attempts?: number; timeoutMs?: number; retryDelayMs?: number },
  ) {
    const attempts = Math.max(1, options?.attempts ?? 1);
    const timeoutMs = Math.max(1, options?.timeoutMs ?? 1500);
    const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);
    let lastMessage = 'HTTP 请求失败';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // 17777 (Agent-S) 的 /healthz 需要带 x-kaypal-agent-s-token
        // 8001 已下线；其他 (frontend/backend) 用 Accept-only
        const headers: Record<string, string> = {
          Accept: 'application/json,text/html,*/*',
        };
        if (
          url.includes('127.0.0.1:17777') ||
          url.includes('localhost:17777')
        ) {
          const token =
            this.configService?.get<string>('KAYPAL_AGENT_S_TOKEN') || '';
          if (token) {
            headers['x-kaypal-agent-s-token'] = token;
          }
        }
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });

        return {
          ok: response.ok,
          message: response.ok ? 'HTTP 可访问' : `HTTP ${response.status}`,
        };
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : 'HTTP 请求失败';
        if (attempt < attempts && retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    return {
      ok: false,
      message: lastMessage,
    };
  }

  async getBrowserStatus(): Promise<LocalEngineBrowserStatus> {
    const checkedAt = new Date().toISOString();
    const health = await this.autoUploadService.getHealth().catch((error) => ({
      online: false,
      service: 'ai-content local browser runtime',
      version: 'unknown',
      message: error instanceof Error ? error.message : 'HTTP 请求失败',
    }));
    try {
      const accounts = await this.autoUploadService.listAccounts({
        validate: true,
        force: true,
      });
      const cdpSessions = await this.autoUploadService
        .getCdpSessions()
        .catch(() => null);
      const sessionByAccount = new Map(
        (cdpSessions?.sessions || []).map((session) => [
          `${session.platform}:${String(session.accountId)}`,
          session,
        ]),
      );
      const mappedAccounts = accounts.map((account) => {
        const platformKey = this.resolveBrowserSessionPlatformKey(
          account.platform,
          account.type,
        );
        const session = sessionByAccount.get(
          `${platformKey}:${String(account.id)}`,
        );
        const sessionStatus = session?.status;
        const status:
          | 'ready'
          | 'expired'
          | 'needs_login'
          | 'blocked'
          | 'unverified' =
          sessionStatus === 'ready'
            ? 'ready'
            : sessionStatus === 'needs_login' ||
                sessionStatus === 'blocked' ||
                sessionStatus === 'stopped'
              ? sessionStatus === 'stopped'
                ? 'blocked'
                : sessionStatus
              : account.status === 1
                ? 'unverified'
                : 'expired';
        const statusLabel =
          status === 'ready'
            ? '已登录'
            : status === 'needs_login'
              ? '需要重新登录'
              : status === 'blocked'
                ? '浏览器阻断'
                : status === 'unverified'
                  ? '待确认登录'
                  : account.statusLabel;
        return {
          id: account.id,
          platform: account.platform,
          type: account.type,
          displayName:
            account.profileName || account.userName || `账号 ${account.id}`,
          status,
          statusLabel,
          filePath: account.filePath,
          avatarUrl: account.avatarUrl,
          currentUrl: session?.currentUrl ?? null,
          lastError: session?.lastError ?? null,
          nextAction:
            status === 'needs_login'
              ? `请在已打开的 ${account.platform} 后台重新登录。`
              : status === 'blocked'
                ? session?.lastError || '请先恢复本地浏览器 Runtime。'
                : status === 'unverified'
                  ? `请打开 ${account.platform} 后台，等待页面进入平台管理后台后刷新。`
                  : undefined,
        };
      });

      return {
        checkedAt,
        engineOnline: health.online,
        engineMessage: `${health.service} ${health.version} 在线`,
        totalAccounts: mappedAccounts.length,
        readyAccounts: mappedAccounts.filter(
          (account) => account.status === 'ready',
        ).length,
        expiredAccounts: mappedAccounts.filter(
          (account) => account.status === 'expired',
        ).length,
        accounts: mappedAccounts,
        recovery: {
          waitingTasks: 0,
          resumableTasks: 0,
          nextAction: mappedAccounts.some(
            (account) => account.status === 'expired',
          )
            ? '存在失效账号，请到平台账号页重新登录后恢复阻断任务。'
            : mappedAccounts.some((account) => account.status === 'needs_login')
              ? '存在需要重新登录的平台账号，请在已打开的平台后台完成登录后刷新。'
              : mappedAccounts.some((account) => account.status === 'blocked')
                ? '存在浏览器阻断账号，请先恢复本地浏览器 Runtime。'
                : mappedAccounts.some(
                      (account) => account.status === 'unverified',
                    )
                  ? '存在待确认登录的平台账号，请先打开平台后台确认登录态。'
                  : '账号状态正常。',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const tableMissing = this.isPrismaTableMissingError(
        error,
        'publish_accounts',
      );
      return {
        checkedAt,
        engineOnline: Boolean(health.online),
        engineMessage: health.online
          ? tableMissing
            ? `${health.service} ${health.version} 在线；平台账号表正在自修复，当前微信本机任务不依赖该表。`
            : `${health.service} ${health.version} 在线；平台账号读取失败：${message}`
          : `浏览器控制不可用：${'message' in health ? health.message : message}`,
        totalAccounts: 0,
        readyAccounts: 0,
        expiredAccounts: 0,
        accounts: [],
        recovery: {
          waitingTasks: 0,
          resumableTasks: 0,
          nextAction: health.online
            ? tableMissing
              ? '本机数据库会在下次启动自动补齐 publish_accounts；抖音/小红书/视频号任务需要平台账号，微信桌面任务可继续。'
              : '检查平台账号表、CDP 会话和发布账号登录态；微信桌面任务不依赖平台账号。'
            : '先启动发布服务 本地浏览器引擎，再刷新账号状态。',
        },
      };
    }
  }

  resolveBrowserSessionPlatformKey(platformName: string, platformType: number) {
    if (platformType === 2) return 'wechat-channel';
    if (platformType === 3) return 'douyin';
    if (platformType === 4) return 'kuaishou';
    if (platformType === 1) return 'xiaohongshu';
    if (platformType === 5) return 'bilibili';
    if (platformName === '视频号') return 'wechat-channel';
    if (platformName === '抖音') return 'douyin';
    if (platformName === '快手') return 'kuaishou';
    if (platformName === '小红书') return 'xiaohongshu';
    if (platformName === 'B站') return 'bilibili';
    return platformName;
  }

  checkRequiredPlatformAccounts(
    browserStatus: LocalEngineBrowserStatus,
    capabilities: LocalEngineCapability[] = [],
  ) {
    const executorCapability = capabilities.find(
      (capability) => capability.key === 'interaction-capabilities',
    );
    const readyExecutorText =
      executorCapability?.checks?.find((check) => check.name === '就绪率')
        ?.message || '';
    const requiredPlatforms = [
      {
        key: 'douyin',
        label: '抖音',
        executorKeys: ['douyin-comment-reply', 'douyin-direct-message-reply'],
      },
      {
        key: 'wechat-channel',
        label: '视频号',
        executorKeys: [
          'wechat-channel-comment-reply',
          'wechat-channel-direct-message-reply',
        ],
      },
    ];
    const missing = requiredPlatforms.filter(
      (platform) =>
        !browserStatus.accounts.some(
          (account) =>
            this.resolveBrowserSessionPlatformKey(
              account.platform,
              account.type,
            ) === platform.key && account.status === 'ready',
        ) &&
        !platform.executorKeys.every((executorKey) =>
          readyExecutorText.includes(executorKey),
        ),
    );
    if (!missing.length) {
      return {
        ready: true,
        message: '抖音和视频号账号均有可用登录态。',
        nextAction: '',
      };
    }
    return {
      ready: false,
      message: `缺少可用的必需平台账号：${missing
        .map((platform) => platform.label)
        .join('、')}。`,
      nextAction:
        '请到发布中心的平台账号页重新登录或校验抖音、视频号账号状态。',
    };
  }

  isWechatReadinessSessionLocked(capabilities: LocalEngineCapability[] = []) {
    const interactionCapability = capabilities.find(
      (capability) => capability.key === 'interaction-capabilities',
    );
    const readyText =
      interactionCapability?.checks?.find((check) => check.name === '就绪率')
        ?.message || '';
    const wechatExecutorReady = [
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ].every((executorKey) => readyText.includes(executorKey));
    return (
      wechatExecutorReady &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt
    );
  }

  async getExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    return this.getCachedExecutorsStatus();
  }

  getRequiredInteractionExecutorIdsForCurrentHost(): string[] {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return this.requiredInteractionExecutorIds;
    }
    return [...BROWSER_INTERACTION_EXECUTOR_IDS];
  }

  getUnsupportedInteractionExecutorIdsForCurrentHost(): string[] {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return [];
    }
    return [...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS];
  }

  async getCachedExecutorsStatus(
    ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
  ): Promise<LocalEngineExecutorsStatus> {
    const now = Date.now();
    if (
      this.executorsStatusCache &&
      this.executorsStatusCache.expiresAt > now
    ) {
      return this.executorsStatusCache.value;
    }

    const value = await this.loadExecutorsStatus();
    this.executorsStatusCache = {
      value,
      expiresAt: now + ttlMs,
    };
    return value;
  }

  /**
   * 共享：从 RuntimeOrchestrator + 平台 sub-services 拉真 capability 状态
   * 同时被 getExecutorsStatus (GET /executors/status) 和
   *      assertCreateExecutionPreflight (创建任务时的预检) 使用
   * 避免之前 P3-D4 placeholder 写死空数组导致 capability 永远 undefined
   */
  async loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    let healths: Array<{ id: string; ok: boolean; details?: string }>;
    try {
      healths = (await this.runtimeOrchestrator?.healthCheck()) ?? [
        { id: 'agent-s', ok: false, details: 'RuntimeOrchestrator 未注入' },
        {
          id: 'local-runtime',
          ok: false,
          details: 'RuntimeOrchestrator 未注入',
        },
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      healths = [
        {
          id: 'agent-s',
          ok: false,
          details: `浏览器平台能力读取失败：${message}`,
        },
        {
          id: 'local-runtime',
          ok: false,
          details: `浏览器平台能力读取失败：${message}`,
        },
      ];
    }

    const runtimeExecutors: LocalEngineExecutorCapability[] = healths.map((h) =>
      this.mapRuntimeHealthToExecutorCapability(h),
    );
    const desktopExecutors = await this.loadWechatDesktopExecutorCapabilities();
    const executors = this.mergeExecutorCapabilities([
      ...runtimeExecutors,
      ...desktopExecutors,
    ]);
    const requiredExecutorIds =
      this.getRequiredInteractionExecutorIdsForCurrentHost();
    const interactionExecutors = executors.filter((executor) =>
      requiredExecutorIds.includes(String(executor.key)),
    );

    return {
      checkedAt: new Date().toISOString(),
      summary: {
        total: interactionExecutors.length,
        ready: interactionExecutors.filter((e) => e.status === 'ready').length,
        preflightOnly: interactionExecutors.filter(
          (e) => e.status === 'preflight_only',
        ).length,
        missing: interactionExecutors.filter((e) => e.status === 'missing')
          .length,
      },
      executors,
    };
  }

  mergeExecutorCapabilities(
    executors: LocalEngineExecutorCapability[],
  ): LocalEngineExecutorCapability[] {
    const merged = new Map<string, LocalEngineExecutorCapability>();
    for (const executor of executors) {
      merged.set(String(executor.key), executor);
    }
    return Array.from(merged.values());
  }

  async loadWechatDesktopExecutorCapabilities(): Promise<
    LocalEngineExecutorCapability[]
  > {
    const checkedAt = new Date().toISOString();
    const desktop = await this.readDesktopStatusForExecutorList(checkedAt);
    return this.buildWechatDesktopExecutorCapabilities(desktop);
  }

  async readDesktopStatusForExecutorList(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus> {
    const now = Date.now();
    if (
      this.desktopStatusWithEvidenceCache &&
      this.desktopStatusWithEvidenceCache.expiresAt > now
    ) {
      return {
        ...this.desktopStatusWithEvidenceCache.value,
        checkedAt,
      };
    }

    const desktop = await this.readWechatDesktopStatus();
    return this.buildDesktopStatus(desktop, checkedAt);
  }

  buildWechatDesktopExecutorCapabilities(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineExecutorCapability[] {
    const runnable = this.isDesktopWechatRuntimeRunnable(desktop);
    const status: LocalEngineExecutorCapability['status'] =
      isDesktopWechatExecutionReady(desktop) || runnable
        ? 'ready'
        : desktop.running
          ? 'preflight_only'
          : 'missing';
    const ready = status === 'ready';
    const message = ready
      ? '桌面微信、执行脚本、截图、输入、点击和自动发送能力可用。'
      : desktop.blockers[0] || desktop.message || '桌面微信不可用。';
    const nextAction = ready
      ? '可创建微信任务；auto-send 会调用本机微信脚本执行并保存证据。'
      : desktop.nextAction ||
        '请打开桌面微信并确认本机微信脚本、辅助功能和屏幕录制权限可用。';
    const definitions: Array<{ key: InteractionTaskType; name: string }> = [
      { key: 'wechat-reply-draft', name: '微信会话回复' },
      { key: 'wechat-friend-accept', name: '通过好友' },
      { key: 'wechat-group-broadcast', name: '微信群发' },
      { key: 'wechat-contact-add', name: '自动加好友' },
      { key: 'wechat-moments-publish', name: '朋友圈发布' },
      { key: 'wechat-moments-marketing', name: '朋友圈运营' },
    ];

    return definitions.map((definition) => ({
      key: definition.key,
      name: definition.name,
      platformName: '桌面微信',
      status,
      entryPreflight: ready,
      targetRead: ready,
      replyGenerate: ready,
      controlledSend: ready,
      autoSend: ready,
      message,
      nextAction,
    }));
  }

  mapRuntimeHealthToExecutorCapability(h: {
    id: string;
    ok: boolean;
    details?: string;
  }): LocalEngineExecutorCapability {
    if (h.id === 'agent-s' && this.useNodeAgentRuntime()) {
      return {
        key: 'agent-s-legacy-desktop',
        name: '旧 Agent-S 桌面执行器',
        platformName: '微信桌面',
        status: 'optional',
        entryPreflight: false,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message: h.ok
          ? `${h.details ?? 'Node Runtime Agent-S 在线'}。旧 17777 桌面 sidecar 不再作为微信任务入口。`
          : `旧 Python/桌面 Agent-S 未运行：${h.details || '未返回详情'}。当前微信桌面任务走本机 Node Runtime 和 SkillHub 脚本。`,
        nextAction: h.ok
          ? '以微信完整执行链和具体任务状态判断是否可用。'
          : '无需启动 17777；请以微信完整执行链的进程、权限、脚本和确认后执行检查为准。',
      };
    }
    if (h.id === 'local-runtime') {
      return {
        key: 'local-runtime',
        name: '本地互动编排器',
        platformName: '3011 Runtime',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '本地互动编排器在线。' : '本地互动编排器不可用。'),
        nextAction: h.ok
          ? '客户互动是否可用以四条平台执行器为准。'
          : '检查 RuntimeOrchestrator 与 LocalRuntimeClient 装配。',
      };
    }
    if (h.id === 'platform-publish') {
      return {
        key: 'platform-publish',
        name: '内容发布执行器',
        platformName: '发布中心',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '内容发布执行器在线。' : '内容发布执行器不可用。'),
        nextAction: h.ok
          ? '内容发布能力单独验收，不计入客户互动四条链路。'
          : '检查 PlatformPublishService 健康状态。',
      };
    }
    if (h.id === 'video-template-clip') {
      return {
        key: 'video-template-clip',
        name: '视频剪辑执行器',
        platformName: '视频工坊',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: h.ok,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '视频剪辑执行器在线。' : '视频剪辑执行器不可用。'),
        nextAction: h.ok
          ? '可以从 AI 员工创建视频剪辑任务，成功结果会进入聚合发布素材。'
          : '检查本机 ffmpeg 是否可用。',
      };
    }
    if (h.id === 'video-face-swap') {
      return {
        key: 'video-face-swap',
        name: '视频换脸执行器',
        platformName: '视频工坊',
        status: 'optional',
        entryPreflight: h.ok,
        targetRead: h.ok,
        replyGenerate: h.ok,
        controlledSend: false,
        autoSend: false,
        message: h.ok
          ? (h.details ?? '视频换脸引擎在线。')
          : '视频换脸引擎尚未安装；只影响视频换脸页面，不影响常规内容创作、发布和客户互动。',
        nextAction: h.ok
          ? '进入视频换脸页面时会继续检查素材授权、生成环境和计费。'
          : '需要使用视频换脸时，在视频换脸页面完成 FaceFusion 安装；不使用时无需处理。',
      };
    }

    const status: LocalEngineExecutorCapability['status'] = h.ok
      ? 'ready'
      : h.id === 'agent-s'
        ? 'missing'
        : 'missing';

    return {
      key: h.id as InteractionTaskType,
      name: h.id,
      platformName: h.id === 'agent-s' ? '微信桌面' : '浏览器 CDP',
      status,
      entryPreflight: h.ok,
      targetRead: h.ok,
      replyGenerate: h.ok,
      controlledSend: h.ok,
      autoSend: h.ok,
      message: h.details ?? (h.ok ? '执行器就绪' : '执行器未就绪'),
      nextAction: h.ok
        ? '可以开始执行互动任务。'
        : '请检查 RuntimeOrchestrator.healthCheck() 返回的 details。',
    };
  }

  async getDesktopStatus(): Promise<LocalEngineDesktopStatus> {
    const checkedAt = new Date().toISOString();
    return this.readDesktopStatusWithEvidence(checkedAt);
  }

  async readDesktopStatusWithEvidenceCached(
    checkedAt: string,
    ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
  ): Promise<LocalEngineDesktopStatus> {
    const now = Date.now();
    if (
      this.desktopStatusWithEvidenceCache &&
      this.desktopStatusWithEvidenceCache.expiresAt > now
    ) {
      return {
        ...this.desktopStatusWithEvidenceCache.value,
        checkedAt,
      };
    }

    const value = await this.readDesktopStatusWithEvidence(checkedAt);
    this.desktopStatusWithEvidenceCache = {
      value,
      expiresAt: now + ttlMs,
    };
    return value;
  }

  async readDesktopStatusWithEvidence(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus> {
    const desktop = await this.readWechatDesktopStatus();
    const screenshot = await this.captureDesktopScreenshot(
      '桌面微信窗口状态截图',
    ).catch((error) => ({
      type: 'text' as const,
      label: '桌面截图不可用',
      value: error instanceof Error ? error.message : '桌面截图失败',
      capturedAt: checkedAt,
      trusted: false,
      diagnostic: error instanceof Error ? error.message : '桌面截图失败',
    }));
    if (screenshot) {
      this.rememberDesktopEvidence(screenshot);
    }

    return this.buildDesktopStatus(desktop, checkedAt, screenshot);
  }

  async getDesktopCommercialPreflight(): Promise<LocalEngineDesktopCommercialPreflight> {
    const desktop = await this.getDesktopStatus();
    return this.buildDesktopCommercialPreflight(desktop);
  }

  async getWechatSessionStatus(): Promise<LocalEngineWechatSessionStatus> {
    const desktop = await this.getDesktopStatus();
    const blockers = [...desktop.blockers];
    const warnings = [...desktop.warnings];
    const confirmation = this.wechatSessionConfirmation;
    const targetContact = confirmation.targetContact?.trim();
    const anomalySummary = this.detectWechatSessionAnomalies(desktop);

    if (!desktop.running) {
      blockers.push('桌面微信未运行');
    }
    if (!desktop.available) {
      blockers.push(desktop.message || '桌面微信不可用');
    }
    if (anomalySummary.loggedOut && !confirmation.loggedInConfirmed) {
      blockers.push('桌面微信可能已掉线，请先在本机微信完成登录。');
    }
    if (anomalySummary.popupDetected && !confirmation.popupCleared) {
      blockers.push('检测到可能存在弹窗/遮挡，请人工清理后再继续。');
    }
    if (
      anomalySummary.contactAmbiguous &&
      !confirmation.contactAmbiguityResolved
    ) {
      blockers.push('当前窗口或联系人信息存在歧义，请人工核对后再继续。');
    }
    if (anomalySummary.permissionBlocked) {
      blockers.push('桌面控制权限、截图、输入或点击能力未通过 preflight。');
    }
    if (!targetContact) {
      warnings.push('目标联系人为空，无法锁定当前会话。');
    }
    if (!confirmation.currentWindowConfirmed) {
      warnings.push('当前微信窗口尚未人工确认');
    }
    if (!confirmation.contactConfirmed) {
      warnings.push('目标联系人/当前会话尚未人工确认');
    }
    if (!confirmation.draftBeforeFillConfirmed) {
      warnings.push('草稿填入前确认尚未完成');
    }
    if (confirmation.takeoverActive) {
      warnings.push('人工接管中，后端不会继续自动填入草稿');
    }
    if (confirmation.stoppedAt) {
      blockers.push(confirmation.stopReason || '微信会话已停止');
    }

    const canDraft =
      desktop.available &&
      !anomalySummary.permissionBlocked &&
      blockers.length === 0 &&
      Boolean(targetContact) &&
      confirmation.currentWindowConfirmed === true &&
      confirmation.contactConfirmed === true &&
      confirmation.draftBeforeFillConfirmed === true &&
      confirmation.takeoverActive !== true;

    return {
      checkedAt: new Date().toISOString(),
      desktop,
      targetContact,
      alignment: confirmation.alignment,
      currentWindowConfirmed: confirmation.currentWindowConfirmed === true,
      contactConfirmed: confirmation.contactConfirmed === true,
      draftBeforeFillConfirmed: confirmation.draftBeforeFillConfirmed === true,
      manualTakeoverActive: confirmation.takeoverActive === true,
      takeoverActive: confirmation.takeoverActive === true,
      stopped: Boolean(confirmation.stoppedAt),
      stoppedAt: confirmation.stoppedAt,
      stopReason: confirmation.stopReason,
      updatedAt: confirmation.updatedAt,
      canDraft,
      blockers,
      warnings,
      evidence: this.desktopEvidence.slice(-10).reverse(),
      lock: {
        locked: canDraft,
        lockedAt: confirmation.lockCapturedAt,
        windowTitle:
          confirmation.lockedWindowTitle ||
          desktop.window.currentWindowTitle ||
          null,
        targetContact,
        message: canDraft
          ? '当前微信窗口和联系人已锁定，可填入草稿，仍不会自动发送。'
          : '尚未完成窗口、联系人、草稿填入前确认或存在阻断项。',
      },
      anomalySummary,
      nextAction: canDraft
        ? '可以填入草稿；发送按钮仍需人工点击。'
        : blockers[0] || warnings[0] || '请完成人工确认后继续。',
    };
  }

  async confirmWechatSession(
    input: UpdateWechatSessionConfirmationInput,
  ): Promise<LocalEngineWechatSessionStatus> {
    const now = new Date().toISOString();
    this.wechatSessionConfirmation = {
      ...this.wechatSessionConfirmation,
      ...input,
      targetContact:
        input.targetContact?.trim() ||
        this.wechatSessionConfirmation.targetContact,
      lockedWindowTitle:
        input.currentWindowTitle === undefined
          ? this.wechatSessionConfirmation.lockedWindowTitle
          : input.currentWindowTitle,
      contactAmbiguityResolved:
        input.contactAmbiguityResolved ??
        (input.currentWindowConfirmed === true &&
        input.contactConfirmed === true &&
        input.draftBeforeFillConfirmed === true
          ? true
          : this.wechatSessionConfirmation.contactAmbiguityResolved),
      lockCapturedAt:
        input.currentWindowConfirmed &&
        input.contactConfirmed &&
        input.draftBeforeFillConfirmed
          ? now
          : this.wechatSessionConfirmation.lockCapturedAt,
      stoppedAt: undefined,
      stopReason: undefined,
      takeoverActive: false,
      updatedAt: now,
    };
    const evidence = await this.captureDesktopScreenshot(
      '微信会话确认截图',
    ).catch((error) => ({
      type: 'text' as const,
      label: '微信会话确认截图不可用',
      value: error instanceof Error ? error.message : '桌面截图失败',
      capturedAt: now,
    }));
    this.rememberDesktopEvidence(evidence);
    return this.getWechatSessionStatus();
  }

  async alignWechatSession(
    input: AlignWechatSessionInput,
  ): Promise<LocalEngineWechatSessionStatus> {
    const targetContact = input.targetContact?.trim();
    if (!targetContact) {
      throw new BadRequestException('请先填写要自动打开的微信联系人或群名称。');
    }
    const now = new Date().toISOString();
    const alignment =
      await this.autoUploadService.alignWechatContact(targetContact);
    const evidence: LocalEngineDesktopScreenshotEvidence =
      alignment.evidence?.type === 'screenshot' && alignment.evidence.value
        ? {
            type: 'screenshot',
            label: alignment.evidence.label || '微信目标对齐截图',
            value: alignment.evidence.value,
            capturedAt: alignment.alignedAt || now,
          }
        : {
            type: 'text',
            label: '微信目标对齐结果',
            value: alignment.message,
            capturedAt: alignment.alignedAt || now,
          };
    this.rememberDesktopEvidence(evidence);

    this.wechatSessionConfirmation = {
      ...this.wechatSessionConfirmation,
      targetContact,
      currentWindowConfirmed: alignment.ok,
      contactConfirmed: alignment.ok,
      draftBeforeFillConfirmed: alignment.ok,
      currentWindowTitle:
        alignment.windowTitle ||
        alignment.matchedTitle ||
        this.wechatSessionConfirmation.currentWindowTitle ||
        null,
      contactAmbiguityResolved: alignment.ok,
      popupCleared: alignment.ok || this.wechatSessionConfirmation.popupCleared,
      loggedInConfirmed:
        alignment.stage !== 'wechat_missing' ||
        this.wechatSessionConfirmation.loggedInConfirmed,
      lockedWindowTitle:
        alignment.windowTitle ||
        alignment.matchedTitle ||
        this.wechatSessionConfirmation.lockedWindowTitle ||
        null,
      lockCapturedAt: alignment.ok
        ? now
        : this.wechatSessionConfirmation.lockCapturedAt,
      stoppedAt: undefined,
      stopReason: undefined,
      takeoverActive: false,
      updatedAt: now,
      alignment: {
        ok: alignment.ok,
        stage: alignment.stage,
        targetText: alignment.targetText,
        searchedText: alignment.searchedText,
        matchedTitle: alignment.matchedTitle,
        windowTitle: alignment.windowTitle,
        message: alignment.message,
        nextAction: alignment.nextAction,
        screenshotPath: alignment.screenshotPath,
        pageTextSample: alignment.pageTextSample,
        ambiguous: alignment.ambiguous,
        alignedAt: alignment.alignedAt,
      },
      note:
        input.note ||
        (alignment.ok
          ? '系统已自动搜索并打开微信目标会话。'
          : '系统已尝试自动搜索微信目标，但未能确认唯一会话。'),
      operator: input.operator || this.wechatSessionConfirmation.operator,
    };

    return this.getWechatSessionStatus();
  }

  async takeoverWechatSession(
    input: WechatSessionControlInput = {},
    riskContext?: BackendRiskContext,
  ): Promise<LocalEngineWechatSessionStatus> {
    const riskAudit = assertBackendRiskGate({
      action: 'remote-control',
      target: `wechat-session:${input.operator?.trim() || 'current-user'}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: input.riskConfirmation,
      context: riskContext,
      reason: '微信桌面人工接管会暂停自动草稿动作并切换桌面控制权。',
    });
    const now = new Date().toISOString();
    this.wechatSessionConfirmation = {
      ...this.wechatSessionConfirmation,
      takeoverActive: true,
      updatedAt: now,
      note: input.reason?.trim() || this.wechatSessionConfirmation.note,
      operator:
        input.operator?.trim() || this.wechatSessionConfirmation.operator,
    };
    this.rememberDesktopEvidence({
      type: 'text',
      label: '微信人工接管',
      value: input.reason?.trim() || '用户进入人工接管，后端暂停自动草稿动作。',
      capturedAt: now,
    });
    this.rememberDesktopEvidence({
      type: 'diagnostic_bundle',
      label: '后端风控审计',
      value: JSON.stringify(riskAudit, null, 2),
      capturedAt: now,
    });
    return this.getWechatSessionStatus();
  }

  async stopWechatSession(
    input: WechatSessionControlInput = {},
  ): Promise<LocalEngineWechatSessionStatus> {
    const now = new Date().toISOString();
    this.wechatSessionConfirmation = {
      ...this.wechatSessionConfirmation,
      currentWindowConfirmed: false,
      contactConfirmed: false,
      draftBeforeFillConfirmed: false,
      takeoverActive: false,
      stoppedAt: now,
      stopReason: input.reason?.trim() || '用户停止微信桌面会话',
      operator:
        input.operator?.trim() || this.wechatSessionConfirmation.operator,
      updatedAt: now,
    };
    this.rememberDesktopEvidence({
      type: 'text',
      label: '微信会话停止',
      value:
        this.wechatSessionConfirmation.stopReason || '用户停止微信桌面会话',
      capturedAt: now,
    });
    return this.getWechatSessionStatus();
  }

  async getFileAccessStatus(): Promise<LocalEngineFileAccessStatus> {
    const checkedAt = new Date().toISOString();
    const projectRoot = this.getRuntimeStateRoot();
    const runtimePaths = this.resolveLocalRuntimePaths();
    const roots = await Promise.all(
      [
        {
          key: 'project-root',
          name: '本机数据目录',
          path: projectRoot,
          note: '账号状态、任务记录和本机运行数据所在目录。',
        },
        {
          key: 'backend-root',
          name: '本机服务目录',
          path: runtimePaths.root,
          note: '本机服务保存运行状态的目录。',
        },
        {
          key: 'local-logs',
          name: '本机日志目录',
          path: runtimePaths.logs,
          note: '本机运行日志和临时证据所在目录。',
        },
        {
          key: 'local-runtime-root',
          name: '3011 本地 Runtime 目录',
          path: runtimePaths.root,
          note: '3011 后端保存素材、账号状态和证据的本地目录。',
        },
        {
          key: 'local-runtime-materials',
          name: '发布素材目录',
          path: runtimePaths.materials,
          note: '3011 本地 Runtime 读取的视频、图片等待发布素材。',
        },
        {
          key: 'auto-upload-materials',
          name: '发布素材目录',
          path: runtimePaths.materials,
          note: '发布中心和 AI 员工读取的视频、图片等待发布素材。',
        },
        {
          key: 'auto-upload-cookies',
          name: '平台账号凭证目录',
          path: runtimePaths.cookies,
          note: '本机平台账号登录态和 cookiesFile 兼容目录，只检查状态，不展示敏感内容。',
        },
        {
          key: 'auto-upload-logs',
          name: '发布执行日志目录',
          path: runtimePaths.logs,
          note: '发布中心、客户互动和本机执行器的日志目录。',
        },
        {
          key: 'local-runtime-logs',
          name: '本地 Runtime 日志目录',
          path: runtimePaths.logs,
          note: '3011 本地 Runtime 的运行日志和错误记录。',
        },
        {
          key: 'local-runtime-browser-profiles',
          name: '平台账号浏览器档案目录',
          path: runtimePaths.browserProfiles,
          note: '本地保存的平台登录态浏览器 profile，只检查状态，不展示敏感内容。',
        },
        {
          key: 'local-runtime-evidence',
          name: '互动证据目录',
          path: runtimePaths.evidence,
          note: '客户互动、发布执行的截图和页面回读证据。',
        },
        {
          key: 'local-runtime-avatars',
          name: '账号头像缓存目录',
          path: runtimePaths.avatars,
          note: '平台账号头像和身份识别缓存。',
        },
      ].map((target) => this.inspectPath(target)),
    );
    const ready = roots.filter((item) => item.exists && item.readable).length;

    return {
      checkedAt,
      summary: {
        total: roots.length,
        ready,
        warnings: roots.length - ready,
      },
      roots,
    };
  }

  async listTasks(
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

  async listAutomationTasks(
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

  async getAutomationTask(id: string): Promise<AutomationTaskView> {
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

  toAutomationTaskView(
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

  mapInteractionTaskToAutomationStatus(
    status: InteractionTaskStatus,
  ): AutomationTaskViewStatus {
    if (status === 'completed') return 'success';
    if (status === 'waiting_for_send_confirmation')
      return 'waiting_confirmation';
    if (status === 'blocked') return 'failed';
    if (status === 'no_target' || status === 'skipped') return 'cancelled';
    return status;
  }

  mapAgentSessionToAutomationStatus(
    status: AgentSessionStatus,
  ): AutomationTaskViewStatus {
    if (status === 'completed') return 'success';
    if (status === 'waiting_for_confirmation') return 'waiting_confirmation';
    if (status === 'cancelled') return 'cancelled';
    return status;
  }

  automationStatusLabel(status: AutomationTaskViewStatus) {
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

  readMetadataText(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  ) {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  async listTasksByTypes(
    limit = 50,
    types: InteractionTaskType[],
    filter: Omit<InteractionTaskListFilter, 'type'> = {},
  ): Promise<InteractionTask[]> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      limit,
      filter,
      types,
    );
    const allowedTypes = new Set(types);
    const mergedTasks = await this.mergeTaskSummaries(
      storedTasks,
      filter,
      types,
    );

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

  async listRecords(
    limit = 50,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsResult> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      Math.max(limit, 200),
      {
        ...filter,
        recordsOnly: true,
        status: undefined,
      },
    );

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

  async exportRecords(
    limit = 200,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsExportResult> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      Math.max(limit, 200),
      {
        ...filter,
        recordsOnly: true,
        status: undefined,
      },
    );
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
    const rows = filteredRecords.flatMap((task) =>
      this.toRecordExportRows(task),
    );
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
      content: toCsv([headers, ...rows]),
      exportedAt,
      exportStatus: filteredRecords.some(
        (task) => this.buildTaskEvidenceIntegrity(task).status === 'FAILED',
      )
        ? 'FAILED'
        : 'OK',
      summary,
    };
  }

  previewEvidenceCleanup(
    retentionDays = 7,
  ): Promise<InteractionEvidenceCleanupResult> {
    return this.autoUploadService.previewInteractionEvidenceCleanup(
      retentionDays,
    );
  }

  async cleanupEvidence(
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

  listBusinessTasks(
    key: InteractionBusinessRouteKey,
    limit = 50,
    options: { recordsOnly?: boolean; status?: InteractionTaskStatus } = {},
  ): Promise<InteractionTask[]> {
    return this.listTasksByTypes(limit, this.resolveBusinessTaskTypes(key), {
      status: options.status,
      recordsOnly: options.recordsOnly,
    });
  }

  async listBusinessRecords(
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
  createBusinessTask(
    key: InteractionBusinessRouteKey,
    input: Omit<CreateInteractionTaskInput, 'type'> &
      Partial<Pick<CreateInteractionTaskInput, 'type'>>,
  ): Promise<InteractionTask> {
    return this.createTask({
      ...input,
      type: this.resolveBusinessTaskType(key, input),
    });
  }

  async getTask(id: string): Promise<InteractionTask> {
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

  async getTaskForDisplay(id: string): Promise<InteractionTask> {
    return this.normalizeTaskForDisplay(await this.getTask(id));
  }

  async linkAgentSessionToTask(
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

  async exportTaskDiagnostics(
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

  async createTask(
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
      ReturnType<LocalEngineService['assertCreateExecutionPreflight']>
    >;
    let createPreflightFailure:
      | {
          ok: false;
          stageKey: string;
          failureReason: string;
          nextAction: string;
        }
      | undefined;

    if (
      !saveOnly &&
      (needsRealAccount || isDesktopInteractionTask(input.type))
    ) {
      try {
        createPreflight = await this.assertCreateExecutionPreflight(input);
      } catch (error) {
        createPreflightFailure = {
          ok: false,
          stageKey: 'executor-capability',
          failureReason:
            error instanceof Error ? error.message : '真实执行预检失败',
          nextAction:
            '请修复账号登录态、本地 发布服务或服务能力后创建重试任务。',
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
    const misfireProtection = this.createMisfireProtection(
      input.type,
      riskLevel,
    );
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
        createPreflight?.accountName ||
        input.accountName?.trim() ||
        '未指定账号',
      platformType: createPreflight?.platformType ?? input.platformType,
      platformName: createPreflight?.platformName || input.platformName,
      targetName:
        primaryTarget?.targetName || input.targetName?.trim() || '测试对象',
      sourceText: primaryTarget?.sourceText || fallbackSource,
      replyText: primaryTarget?.replyText || fallbackReply,
      sourceUrl:
        primaryTarget?.sourceUrl || optionalTrimmedText(input.sourceUrl),
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
      this.setTaskStep(
        task,
        'account-entry',
        'blocked',
        '真实执行预检未通过。',
      );
      this.setTaskStep(
        task,
        'target-read',
        'blocked',
        '未通过账号或服务检查，不能读取真实对象。',
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '未读取真实对象，不能生成商用草稿。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实执行合同缺失，不能进入受控执行。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        initialContract.failureReason,
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
      this.pushEvent(
        task,
        'info',
        `批量对象已导入 ${batchTargets.length} 条。`,
      );
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

  resolveFutureWechatPlanTime(
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

  async approveTask(
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
      this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
      this.setTaskStep(
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
        this.setTaskStep(
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
        this.setTaskStep(
          task,
          'target-read',
          'completed',
          '本机微信已搜索目标，但目标不可添加或已是联系人。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
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
        this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
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
      this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
      this.updateTask(task, 'failed', sendResult.message, {
        failureReason: sendResult.message,
        nextAction: '请检查微信窗口、联系人和发送权限后重试。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    if (task.executionMode === 'browser-assisted') {
      const contract = await this.resolveExecutionContract(task);
      if (!contract.ok) {
        this.blockTaskForExecutionContract(task, contract);
        await this.persistTask(task);
        return task;
      }

      this.setTaskStep(
        task,
        'send-approval',
        'completed',
        '人工确认通过，开始填入平台草稿。',
      );
      this.setTaskStep(
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
        this.setTaskStep(
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
        if (
          completedTargetCount + failedTargetCount + queuedTargetCount ===
          0
        ) {
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
            sendResult.nextAction ||
            '已完成，可在任务证据里查看发送和回读结果。',
          completedAt: new Date().toISOString(),
        });
        return task;
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
          '真实平台已读取，但目标对象不存在或已处理。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
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

      this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
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

    this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
    this.setTaskStep(task, 'send-result', 'completed', '发送结果已回写。');
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

  async skipTask(id: string): Promise<InteractionTask> {
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
    this.setTaskStep(task, 'send-approval', 'skipped', '用户跳过本次发送。');
    this.setTaskStep(task, 'send-result', 'skipped', '任务已跳过。');
    this.updateTask(task, 'skipped', '用户跳过本次发送。', {
      nextAction:
        '任务已跳过，可在执行记录查看跳过原因和证据；需要继续时可创建重试任务。',
      completedAt: new Date().toISOString(),
    });

    return task;
  }

  async pauseTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (
      ![
        'queued',
        'running',
        'waiting_for_send_confirmation',
        'blocked',
      ].includes(task.status)
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

    const pauseEvent = this.pushEvent(
      task,
      'warning',
      '用户暂停批量互动任务。',
      {
        type: 'stage_log',
        label: '暂停记录',
        value: `paused from ${task.status}`,
        stageKey: 'pause',
      },
    );
    this.markPausableBatchTargets(task, '任务暂停，未继续执行该对象。', {
      nextAction:
        '明确未开始的对象可恢复；已进入执行中的对象需先核对迟到回读，不能自动重发。',
      evidenceEventIds: [pauseEvent.id],
    });
    task.pausedFromStatus =
      task.status === 'paused' ? task.pausedFromStatus : task.status;
    task.pausedAt = new Date().toISOString();
    this.setTaskStep(
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

  async continueTask(id: string): Promise<InteractionTask> {
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
      ? await this.createTask(
          this.buildContinueTaskInput(task, remainingTargets),
        )
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

  async getGroupBroadcastPlanDetails(
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

  async resendGroupBroadcastPlan(
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
    const batchTargets =
      this.buildResendGroupBroadcastTargets(task, input) || [];
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

  async removeGroupBroadcastPlan(id: string): Promise<InteractionTask> {
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

  assertGroupBroadcastTask(task: InteractionTask) {
    if (task.type !== 'wechat-group-broadcast') {
      throw new BadRequestException('该任务不是微信群发计划');
    }
  }

  buildResendGroupBroadcastTargets(
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

  getContinuableBatchTargets(task: InteractionTask) {
    if (!task.batchTargets?.length) {
      return [];
    }
    return task.batchTargets.filter((target) => target.status === 'queued');
  }

  buildContinueTaskInput(
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

  async resumeTask(
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
    this.setTaskStep(
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

  async createTaskResumeConfirmation(id: string) {
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

  requireRiskPolicyService() {
    if (!this.riskPolicyService) {
      throw new InternalServerErrorException('高风险一次性确认服务未装配。');
    }
    return this.riskPolicyService;
  }

  riskApprovalActor(task: InteractionTask) {
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

  buildWechatResumeApprovalTarget(task: InteractionTask) {
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

  async failTask(
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
    this.setTaskStep(task, 'send-result', 'blocked', reason);
    this.updateTask(task, 'failed', reason, {
      failureReason: reason,
      nextAction: '请检查本地能力状态后重试。',
      completedAt: new Date().toISOString(),
    });

    return task;
  }

  async retryTask(
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
      !(
        task.status === 'completed' &&
        hasTargetFilter &&
        hasSelectedRetryTarget
      )
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

  async listAgentSessions(
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

  async getAgentSession(id: string): Promise<AgentSession> {
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

  async createAgentSession(
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
    const executionScope =
      input.executionScope || resolveAgentScope(instruction);
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
        executionScope === 'remote' ||
        /接管|远程控制|远程操作/.test(instruction),
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

  async createPublishTrackingSession(input: {
    title: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentSession> {
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

  async completePublishTrackingSession(
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

  async continueAgentSession(
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
      this.pushAgentEvent(
        session,
        'warning',
        '仍需人工确认',
        session.nextAction,
      );
      await this.persistAgentSession(session);
      return session;
    }
    const now = new Date().toISOString();
    if (input.instruction?.trim()) {
      this.pushAgentEvent(
        session,
        'info',
        '补充指令',
        input.instruction.trim(),
      );
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

  async stopAgentSession(id: string): Promise<AgentSession> {
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

  async archiveAgentSession(
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

  async exportAgentSessionEvidence(
    id: string,
  ): Promise<AgentSessionEvidenceExportResult> {
    const session = await this.getAgentSession(id);
    await this.ensureAgentSessionEvidenceForExport(session);
    const evidenceItems = collectAgentSessionEvidence(session);
    const replayTimeline = this.buildAgentReplayTimeline(session);
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

  async listAgentSessionEvidence(
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

  resolveEvidenceFilePath(filePath: string | undefined) {
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

  resolveBrowserEvidenceFilePath(filename: string | undefined) {
    const rawFilename = String(filename || '').trim();
    if (!/^[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(rawFilename)) {
      throw new ForbiddenException('浏览器证据文件名不合法');
    }
    const evidenceRoot =
      this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(this.getProjectLogRoot(), 'browser-evidence');
    return this.resolveEvidenceFilePath(join(evidenceRoot, rawFilename));
  }

  normalizeEvidenceFilePath(filePath: string) {
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

  async listAgentSessionConfirmations(
    id: string,
    status?: AgentConfirmationStatus,
  ): Promise<AgentConfirmationListItem[]> {
    const session = await this.getAgentSession(id);
    return this.getSessionConfirmations(session)
      .filter((confirmation) => !status || confirmation.status === status)
      .map((confirmation) => this.withAgentConfirmationSession(confirmation))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listAgentConfirmations(
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

  matchesAgentSessionFilter(
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

  withAgentConfirmationSession(
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

  async getAgentConfirmation(id: string): Promise<{
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

  rememberAgentSession(session: AgentSession): AgentSession {
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

  mergeAgentConfirmations(
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

  getSessionConfirmations(session: AgentSession): AgentConfirmation[] {
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

  getSessionPendingConfirmations(session: AgentSession) {
    return this.getSessionConfirmations(session).filter(
      (confirmation) => confirmation.status === 'pending',
    );
  }

  syncAgentConfirmationIntoSession(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ) {
    const confirmations = this.getSessionConfirmations(session);
    const index = confirmations.findIndex(
      (item) => item.id === confirmation.id,
    );
    if (index >= 0) {
      confirmations[index] = confirmation;
    } else {
      confirmations.unshift(confirmation);
    }
    session.confirmations = confirmations;
    this.agentConfirmations.set(confirmation.id, confirmation);
  }

  closePendingAgentConfirmations(
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

  buildAgentReplayTimeline(session: AgentSession) {
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

  buildAgentEvidenceSummary(
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

  buildAgentFailureAnalysis(session: AgentSession) {
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

  buildAgentAuditTrail(session: AgentSession) {
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
    const remoteAudit = (session.riskPolicy?.remoteAudit || []).map(
      (audit) => ({
        type: 'remote-control' as const,
        action: audit.action,
        operator: audit.operator,
        reason: audit.reason,
        createdAt: audit.createdAt,
      }),
    );
    return [...remoteAudit, ...confirmationAudit].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  buildAgentEvidenceIndex(
    session: AgentSession,
    evidenceItems = collectAgentSessionEvidence(session),
  ) {
    const byType = groupEvidenceByType(evidenceItems);
    return {
      counts: byType,
      stageLogs: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'stage_log'),
      ),
      failureReasons: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'failure_reason'),
      ),
      riskAudits: this.toAgentEvidenceIndexItems(
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
      browser: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) =>
          ['screenshot', 'page_snapshot', 'snapshot'].includes(item.type),
        ),
      ),
      desktop: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'desktop_screenshot'),
      ),
      text: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => ['text', 'file'].includes(item.type)),
      ),
    };
  }

  toAgentEvidenceIndexItems(items: AgentEvidence[]) {
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

  buildAgentEvidenceIntegrity(
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

  async ensureAgentSessionEvidenceForExport(session: AgentSession) {
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

  async approveAgentConfirmation(
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

  async approveInteractionTaskConfirmation(
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

  createSyntheticSessionForConfirmation(
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

  async rejectAgentConfirmation(
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

  async rejectInteractionTaskConfirmation(
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
      this.setTaskStep(task, 'send-approval', 'skipped', '用户拒绝发送。');
      this.setTaskStep(
        task,
        'send-result',
        'skipped',
        '用户拒绝发送，未执行。',
      );
      await this.persistTask(task);
    }

    return this.createSyntheticSessionForConfirmation(confirmation);
  }

  async clearPendingConfirmations(): Promise<{ cleared: number }> {
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

  runInteractionTaskLifecycle(taskId: string) {
    const scheduledTask = this.tasks.get(taskId);
    const startDelayMs = scheduledTask
      ? this.resolveCustomerServiceLifecycleDelayMs(scheduledTask)
      : 0;
    setTimeout(async () => {
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
        this.setTaskStep(
          task,
          'reply-generate',
          'completed',
          '跟进话术已生成。',
        );
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

  resolveCustomerServiceLifecycleDelayMs(task: InteractionTask) {
    const value = optionalTrimmedText(task.metadata?.customerServiceNotBefore);
    if (!value) return 0;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.min(24 * 60 * 60 * 1000, Math.max(0, timestamp - Date.now()));
  }

  async runBrowserAssistedTaskWithQueue(taskId: string): Promise<void> {
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

  resolveBrowserInteractionQueueKey(task: InteractionTask): string {
    const platform = task.type.startsWith('douyin')
      ? 'douyin'
      : task.type.startsWith('wechat-channel')
        ? 'wechat-channel'
        : task.type.startsWith('wechat')
          ? 'wechat-desktop'
          : task.platformName || 'browser';
    return `${platform}:${task.accountId || task.accountName || 'default'}`;
  }

  processBatchTargetsWithRateLimit(
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

  async preflightBrowserAssistedTask(task: InteractionTask) {
    const contract = await this.resolveExecutionContract(task);
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
        failureReason: runtimePreflight.message,
        nextAction:
          runtimePreflight.nextAction ||
          '请检查本地 Runtime 引擎、浏览器会话和账号登录状态后重试。',
        stepMessages: {
          accountEntry: runtimePreflight.message,
          targetRead: 'Runtime 前置预检未通过，不能读取目标对象。',
          replyGenerate: '未读取真实对象，不能生成回复。',
          sendApproval: '真实能力缺失，不能进入受控执行。',
          sendResult: '任务已在 Runtime 前置预检阶段阻断。',
        },
      });
      this.pushEvent(task, 'error', runtimePreflight.message, {
        type: 'failure_reason',
        label: 'Runtime 前置预检',
        value: runtimePreflight.blockers.join('；') || runtimePreflight.message,
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
      primaryRuntimeBlocker &&
      !runtimeMessageBase.includes(primaryRuntimeBlocker)
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
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
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
            evidence.type === 'screenshot' &&
            isDesktopInteractionTask(task.type);
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

  async ensureBrowserInteractionTarget(
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
        text: String(item.text || item['content'] || item['message'] || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
        source: String(item.source || '').slice(0, 60),
        targetName: String(
          item['author'] ||
            item['nickname'] ||
            item['sender'] ||
            item['contactName'] ||
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
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        '真实读取失败，未发送。',
      );
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

  markPreparedBrowserInteractionSteps(task: InteractionTask) {
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

  shouldReadRealInteractionTarget(task: InteractionTask): boolean {
    return (
      isPlaceholderInteractionText(task.sourceText) ||
      isPlaceholderInteractionText(task.targetName) ||
      !task.sourceText?.trim()
    );
  }

  isRuntimeAccountEntryBlocker(reasonCode?: string): boolean {
    return (
      reasonCode === 'account_not_logged_in' ||
      reasonCode === 'captcha_required' ||
      reasonCode === 'runtime_unavailable' ||
      reasonCode === 'platform_changed' ||
      reasonCode === 'permission_missing'
    );
  }

  async readBrowserInteractionCandidates(task: InteractionTask): Promise<{
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
  } | null {
    const normalize = (value: unknown) =>
      String(value || '')
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
              const source = String(item.source || '').toLowerCase();
              const context = String(item.context || '');
              const text = String(
                item.text || item['content'] || item['message'] || '',
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
        const source = String(item.source || '').toLowerCase();
        if (
          source.includes('network') ||
          source.includes('window') ||
          source === 'text-node' ||
          source === 'contact-name'
        ) {
          continue;
        }
      }
      const text = String(item.text || item['content'] || item['message'] || '')
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
        item['author'] ||
          item['nickname'] ||
          item['sender'] ||
          item['contactName'] ||
          '',
      ).trim();
      const field = (...keys: string[]) => {
        for (const key of keys) {
          const value = String(item[key] || '').trim();
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

  cleanReadableInteractionText(
    value: string,
    type?: InteractionTaskType,
  ): string {
    let text = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .trim();
    if (type === 'douyin-comment-reply') {
      text = text
        .replace(/\s+(?:回复|删除|举报|查看\d+条回复).*$/g, '')
        .replace(/\s+\d{1,4}$/g, '')
        .trim();
    }
    return text;
  }

  async preflightDesktopInteractionTask(task: InteractionTask) {
    const contract = await this.resolveExecutionContract(task);
    if (!contract.ok) {
      this.blockTaskForExecutionContract(task, contract);
      await this.persistTask(task);
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
          !this.applyRuntimeBatchTargetResults(
            task,
            sendResult,
            evidenceEventIds,
          )
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
            sendResult.nextAction ||
            '请检查桌面微信目标、权限和执行脚本后重试。',
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

  withTaskBillingContext(
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

  async autoSendReplyViaRuntime(task: InteractionTask) {
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

  applyInteractionDraftResult(
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

  applyRuntimeBatchTargetResults(
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

  async sendApprovedBrowserReplyViaRuntime(task: InteractionTask) {
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

  async draftApprovedReplyViaRuntime(task: InteractionTask) {
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

  async preflightBrowserTaskViaRuntime(task: InteractionTask) {
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

  toRuntimeInteractionTaskType(
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

  waitForLiveExecutor(task: InteractionTask) {
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    if (
      task.status === 'waiting_for_send_confirmation' ||
      task.status === 'blocked' ||
      task.status === 'paused'
    ) {
      return;
    }

    if (task.runtimeState === 'executor_missing') {
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '真实读取器未返回内容，无法生成真实回复。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实回复未生成，不能进入受控执行。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        '真实浏览器服务未就绪。',
      );
      this.markQueuedBatchTargets(
        task,
        'failed',
        '评论/私信/微信读取服务未就绪',
        {
          nextAction: '已打开账号入口；请检查真实页面读取和填充服务状态。',
        },
      );
      this.updateTask(
        task,
        'blocked',
        '当前环境无法使用自动处理服务，已停在准备检查阶段。',
        {
          failureReason: '当前环境无法读取评论、私信或微信会话',
          nextAction:
            '已打开账号入口；下一步需要接入桌面版的真实页面读取和填充服务。',
          completedAt: new Date().toISOString(),
        },
      );
      this.pushEvent(
        task,
        'warning',
        '为避免误报，真实账号任务不会继续使用占位内容完成发送链路。',
      );
      this.pushEvent(task, 'error', '当前环境无法读取评论、私信或微信会话', {
        type: 'failure_reason',
        label: '失败原因',
        value: '当前环境无法读取评论、私信或微信会话',
        stageKey: 'send-result',
      });
      return;
    }

    this.setTaskStep(
      task,
      'target-read',
      'blocked',
      '等待本地服务返回目标内容。',
    );
    this.markQueuedBatchTargets(task, 'failed', '本地服务超时', {
      nextAction: '请检查 发布服务日志和浏览器控制状态。',
    });
    this.updateTask(task, 'blocked', '本地服务未返回目标内容。', {
      failureReason: '本地服务超时',
      nextAction: '请检查 发布服务日志和浏览器控制状态。',
      completedAt: new Date().toISOString(),
    });
    this.pushEvent(task, 'error', '本地服务未返回目标内容。', {
      type: 'failure_reason',
      label: '失败原因',
      value: '本地服务超时',
      stageKey: 'target-read',
    });
  }

  async resolveExecutionContract(task: InteractionTask) {
    const baseContract = this.buildExecutionContract(task, {
      requireReadyCapability: false,
      allowMissingAccountException: false,
    });
    if (!baseContract.ok) {
      return baseContract;
    }

    // P3-D4: 旧 getStatus 已删；新路径走 RuntimeOrchestrator.healthCheck()（feature flag 后切换）
    const status = await this.loadExecutorsStatus();
    const capability = status.executors.find(
      (executor) => executor.key === (task as { type?: string }).type,
    );
    return this.buildExecutionContract(task, {
      capability,
      capabilityError:
        capability && 'error' in capability
          ? String(capability.error)
          : undefined,
      requireReadyCapability: true,
      allowMissingAccountException: false,
    });
  }

  async assertCreateExecutionPreflight(
    input: CreateInteractionTaskInput,
  ): Promise<
    | {
        accountName: string;
        platformType: number;
        platformName: string;
        capability: LocalEngineExecutorCapability;
      }
    | undefined
  > {
    if (
      !this.requiresRealAccount(input.type) &&
      !isDesktopInteractionTask(input.type)
    ) {
      return undefined;
    }

    if (isDesktopInteractionTask(input.type)) {
      const status = await this.loadExecutorsStatus();
      const capability = status.executors.find(
        (executor) => executor.key === input.type,
      );
      const contract = this.buildExecutionContract(
        {
          type: input.type,
          accountId: input.accountId || 'wechat-desktop',
          accountName: input.accountName?.trim() || '桌面微信',
          platformType: input.platformType ?? 2,
          platformName: input.platformName || '微信',
          sendMode: input.sendMode,
        },
        {
          capability,
          capabilityError:
            capability && 'error' in capability
              ? String(capability.error)
              : undefined,
          requireReadyCapability: true,
          allowMissingAccountException: false,
        },
      );
      if (!contract.ok) {
        throw new BadRequestException(contract.failureReason);
      }
      if (!capability) {
        throw new BadRequestException(
          `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
        );
      }

      return {
        accountName: input.accountName?.trim() || '桌面微信',
        platformType: input.platformType ?? 2,
        platformName: input.platformName || '微信',
        capability,
      };
    }

    const baseContract = this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId,
        accountName: input.accountName?.trim() || '未指定账号',
        platformType: input.platformType,
        platformName: input.platformName,
        sendMode: input.sendMode,
      },
      {
        requireReadyCapability: false,
        allowMissingAccountException: false,
      },
    );
    if (!baseContract.ok) {
      throw new BadRequestException(baseContract.failureReason);
    }

    const accountId = input.accountId;
    let accounts: Awaited<ReturnType<AutoUploadService['listAccounts']>>;
    try {
      accounts = await this.autoUploadService.listAccounts({
        validate: false,
        ids: accountId ? [accountId] : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new BadRequestException(`本地平台账号预检失败：${message}`);
    }

    const requestedPlatform = this.resolveTaskPlatformAccount(input);
    const account =
      accounts.find(
        (item) =>
          String(item.id) === String(accountId) &&
          this.isSamePlatformAccount(requestedPlatform, {
            type: item.type,
            name: item.platform,
          }),
      ) || accounts.find((item) => String(item.id) === String(accountId));
    if (!account) {
      throw new BadRequestException(
        `本地平台账号不存在或不可读取：${accountId}`,
      );
    }
    if (account.status !== 1) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}账号未登录或已失效：${account.profileName || account.userName || input.accountName || accountId}`,
      );
    }

    const platformType = input.platformType ?? account.type;
    if (
      !this.isSamePlatformAccount(
        {
          type: platformType,
          name: input.platformName,
        },
        {
          type: account.type,
          name: account.platform,
        },
      )
    ) {
      throw new BadRequestException(
        `账号平台类型不匹配：任务选择 ${input.platformName || `平台 ${platformType}`}，实际账号为 ${account.platform || `平台 ${account.type}`}。`,
      );
    }

    // P3-D4: 旧 getStatus 已删；现在从 RuntimeOrchestrator 拉真 capability
    const status = await this.loadExecutorsStatus();
    const capability = status.executors.find(
      (executor) => executor.key === input.type,
    );
    const contract = this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId,
        accountName:
          account.profileName ||
          account.userName ||
          input.accountName?.trim() ||
          '未指定账号',
        platformType,
        platformName: input.platformName || account.platform,
        sendMode: input.sendMode,
      },
      {
        capability,
        capabilityError:
          capability && 'error' in capability
            ? String(capability.error)
            : undefined,
        requireReadyCapability: true,
        allowMissingAccountException: false,
      },
    );
    if (!contract.ok) {
      throw new BadRequestException(contract.failureReason);
    }

    if (!capability) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
      );
    }

    return {
      accountName:
        account.profileName ||
        account.userName ||
        input.accountName?.trim() ||
        `账号 ${accountId}`,
      platformType,
      platformName: input.platformName || account.platform,
      capability,
    };
  }

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
  ) {
    const typeLabel = task.typeLabel || this.resolveTypeLabel(task.type);
    const requiresPlatformAccount = this.requiresRealAccount(task.type);
    const requiresDesktop = isDesktopInteractionTask(task.type);
    if (!requiresPlatformAccount && !requiresDesktop) {
      return { ok: true as const };
    }

    const accountId = String(task.accountId || '').trim();
    if (requiresPlatformAccount && !accountId) {
      const failureReason = `${typeLabel}缺少本地平台账号，不能执行真实平台任务。`;
      return {
        ok: false as const,
        stageKey: 'account-entry',
        failureReason,
        nextAction: options.allowMissingAccountException
          ? '请先选择已登录的平台账号；任务已保留为阻断态，可补齐账号后创建重试任务。'
          : '请先选择已登录的平台账号后创建重试任务。',
        stepMessages: {
          accountEntry: '未绑定已登录平台账号。',
          targetRead: '缺少账号，不能打开真实平台读取对象。',
          replyGenerate: '缺少真实对象，不能生成商用草稿。',
          sendApproval: '缺少真实内容，不能进入受控执行。',
          sendResult: '真实执行合同缺少账号。',
        },
      };
    }

    const numericAccountId = Number(accountId);
    if (
      requiresPlatformAccount &&
      (!Number.isInteger(numericAccountId) || numericAccountId <= 0)
    ) {
      const failureReason = `${typeLabel}账号 ID 无效：${accountId}`;
      return {
        ok: false as const,
        stageKey: 'account-entry',
        failureReason,
        nextAction: '请重新选择有效的本地平台账号后创建重试任务。',
        stepMessages: {
          accountEntry: '账号 ID 无效。',
          targetRead: '账号无效，不能打开真实平台读取对象。',
          replyGenerate: '缺少真实对象，不能生成商用草稿。',
          sendApproval: '缺少真实内容，不能进入受控执行。',
          sendResult: '真实执行合同缺少有效账号。',
        },
      };
    }

    if (!this.isLiveExecutorTask(task.type)) {
      const failureReason = `${typeLabel}自动化执行器未就绪`;
      return {
        ok: false as const,
        stageKey: 'executor-skip',
        failureReason,
        nextAction: '请检查该任务类型的执行器注册和健康状态。',
        stepMessages: {
          accountEntry: '已绑定账号，但该互动类型执行器未就绪。',
          targetRead: '没有真实读取能力，不能继续执行。',
          replyGenerate: '未读取到真实对象，不能生成真实草稿。',
          sendApproval: '未生成真实内容，不能进入受控执行。',
          sendResult: '自动化服务未就绪。',
        },
      };
    }

    if (!options.requireReadyCapability) {
      return { ok: true as const };
    }

    const capability = options.capability;
    if (!capability) {
      const failureReason = options.capabilityError
        ? `${typeLabel}能力预检失败：${options.capabilityError}`
        : `${typeLabel}缺少本地执行能力声明`;
      return {
        ok: false as const,
        stageKey: 'executor-capability',
        failureReason,
        nextAction: options.capabilityError
          ? '请启动或升级 3011 本地 Runtime，并确认互动能力清单可用。'
          : '请升级 3011 本地 Runtime，让互动能力声明包含入口、读取、草稿和发送能力。',
        stepMessages: {
          accountEntry: '账号已绑定，但本地引擎未声明该服务。',
          targetRead: '缺少读取能力声明，不能继续执行。',
          replyGenerate: '缺少回复生成能力声明。',
          sendApproval: '缺少受控草稿能力，不能进入确认。',
          sendResult: '真实执行能力未绑定。',
        },
      };
    }

    const contractSendMode = task.sendMode || 'approval-send';
    const requiresSendCapability =
      contractSendMode === 'auto-send'
        ? Boolean(capability.autoSend)
        : Boolean(capability.controlledSend);
    const missing = [
      capability.entryPreflight ? '' : 'account/executor preflight',
      capability.targetRead ? '' : 'target-read capability',
      capability.replyGenerate ? '' : 'reply-generate capability',
      requiresSendCapability
        ? ''
        : contractSendMode === 'auto-send'
          ? 'auto-send capability'
          : 'controlled-send capability',
    ].filter(Boolean);
    if (capability.status !== 'ready' || missing.length) {
      const failureReason = `${typeLabel}执行能力未就绪：${missing.join('、') || capability.message}`;
      return {
        ok: false as const,
        stageKey: 'executor-capability',
        failureReason,
        nextAction:
          capability.nextAction ||
          '请补齐真实读取、回复生成、发送执行和预检能力后重试。',
        stepMessages: {
          accountEntry: capability.entryPreflight
            ? '账号准备检查可用。'
            : '账号准备检查不可用。',
          targetRead: capability.targetRead
            ? '读取能力已声明。'
            : '缺少真实目标读取能力。',
          replyGenerate: capability.replyGenerate
            ? '回复生成能力已声明。'
            : '缺少真实回复生成能力。',
          sendApproval: requiresSendCapability
            ? '发送能力已声明。'
            : contractSendMode === 'auto-send'
              ? '缺少自动发送能力，不能直接发送。'
              : '缺少确认后草稿填入能力。',
          sendResult: capability.message,
        },
      };
    }

    return { ok: true as const };
  }

  blockTaskForExecutionContract(
    task: InteractionTask,
    contract: {
      ok: false;
      stageKey: string;
      failureReason: string;
      nextAction: string;
      stepMessages?: {
        accountEntry: string;
        targetRead: string;
        replyGenerate: string;
        sendApproval: string;
        sendResult: string;
      };
    },
  ) {
    const messages = contract.stepMessages;
    if (messages) {
      this.setTaskStep(task, 'account-entry', 'blocked', messages.accountEntry);
      this.setTaskStep(task, 'target-read', 'blocked', messages.targetRead);
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        messages.replyGenerate,
      );
      this.setTaskStep(task, 'send-approval', 'blocked', messages.sendApproval);
      this.setTaskStep(task, 'send-result', 'blocked', messages.sendResult);
    }
    this.markQueuedBatchTargets(task, 'failed', contract.failureReason, {
      nextAction: contract.nextAction,
    });
    task.runtimeState = 'executor_missing';
    this.updateTask(
      task,
      'blocked',
      `${contract.failureReason}，任务已阻断。`,
      {
        failureReason: contract.failureReason,
        nextAction: contract.nextAction,
        completedAt: new Date().toISOString(),
      },
    );
    this.pushEvent(
      task,
      'error',
      `${contract.failureReason}，本次不会伪造成已执行。`,
      {
        type: 'failure_reason',
        label: '执行合同失败',
        value: contract.failureReason,
        stageKey: contract.stageKey,
      },
    );
  }

  updateTask(
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
      status === 'failed'
        ? 'error'
        : status === 'completed'
          ? 'success'
          : 'info',
      eventMessage,
    );
    this.refreshTaskDiagnostics(task);
  }

  pushEvent(
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

  createTaskSteps(type: InteractionTaskType, hasAccount: boolean, now: string) {
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

  setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ) {
    task.steps = task.steps?.length
      ? task.steps
      : this.createTaskSteps(
          task.type,
          Boolean(task.accountId),
          task.createdAt,
        );
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

  refreshTaskDiagnostics(task: InteractionTask) {
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
      const platform = task.platformName || this.resolveTypeLabel(task.type);
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

  buildTaskResultSummary(
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
      skipped:
        task.batchSummary?.skipped || (task.status === 'skipped' ? 1 : 0),
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
        counts.skipped > 0
          ? `跳过 ${counts.skipped}/${counts.total}`
          : '已跳过',
      no_target:
        counts.total > 1
          ? `无对象 ${counts.noTarget}/${counts.total}`
          : '无对象',
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

  buildTaskEvidenceReplay(task: InteractionTask) {
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

  buildTaskEvidenceIndex(task: InteractionTask) {
    const evidenceItems = this.collectTaskEvidence(task);
    const isDesktopEvidenceItem = (
      item: ReturnType<LocalEngineService['collectTaskEvidence']>[number],
    ) =>
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
              currentWindowConfirmed:
                task.approvalRecord.currentWindowConfirmed,
              contactConfirmed: task.approvalRecord.contactConfirmed,
              draftBeforeFillConfirmed:
                task.approvalRecord.draftBeforeFillConfirmed,
              confirmedChecklistKeys:
                task.approvalRecord.confirmedChecklistKeys,
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

  collectTaskEvidence(task: InteractionTask) {
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

  toTaskEvidenceIndexItems(
    items: ReturnType<LocalEngineService['collectTaskEvidence']>,
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

  groupTaskEvidenceByType(evidenceItems: InteractionTaskEvent['evidence'][]) {
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

  buildTaskEvidenceIntegrity(
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

  async ensureTaskEvidenceForExport(task: InteractionTask, stageKey: string) {
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

  repairEvidenceIntegrityOnlyFailureTask(task: InteractionTask) {
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

  toRecordExportRows(task: InteractionTask) {
    const evidenceIndex = this.buildTaskEvidenceIndex(task);
    const integrity = this.buildTaskEvidenceIntegrity(task, evidenceIndex);
    const evidenceCount = String(
      task.events.filter((event) => Boolean(event.evidence)).length,
    );
    const riskAudit = this.formatEvidenceIndexForCsv(evidenceIndex.riskAudits);
    const confirmations = formatConfirmationIndexForCsv(
      evidenceIndex.confirmations,
    );
    const stageLogs = this.formatEvidenceIndexForCsv(evidenceIndex.stageLogs);
    const browserEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.browser,
    );
    const desktopEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.desktop,
    );
    const textEvidence = this.formatEvidenceIndexForCsv(evidenceIndex.text);
    const failureEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.failureReasons,
    );
    const base = [
      task.id,
      task.statusLabel,
      task.typeLabel,
      task.platformName || '',
      task.accountName,
    ];

    if (task.batchTargets?.length) {
      return task.batchTargets.map((target, index) => [
        ...base,
        String(index + 1),
        target.targetName,
        target.status,
        target.failureReason || task.failureReason || '',
        task.diagnostics?.summary || '',
        target.nextAction || task.nextAction || '',
        task.riskLevel || '',
        riskAudit,
        confirmations,
        stageLogs,
        browserEvidence,
        desktopEvidence,
        textEvidence,
        failureEvidence,
        task.resultSummary?.headline || '',
        target.sourceText,
        target.replyText,
        evidenceCount,
        (target.evidenceEventIds || []).join('|'),
        integrity.status === 'OK'
          ? 'OK'
          : `FAILED: ${integrity.missing.join('；')}`,
        task.createdAt,
        target.updatedAt || task.updatedAt,
        task.completedAt || '',
      ]);
    }

    return [
      [
        ...base,
        '',
        task.targetName,
        task.status,
        task.failureReason || '',
        task.diagnostics?.summary || '',
        task.nextAction || '',
        task.riskLevel || '',
        riskAudit,
        confirmations,
        stageLogs,
        browserEvidence,
        desktopEvidence,
        textEvidence,
        failureEvidence,
        task.resultSummary?.headline || '',
        task.sourceText,
        task.replyText,
        evidenceCount,
        task.events
          .filter((event) => Boolean(event.evidence))
          .map((event) => event.id)
          .join('|'),
        integrity.status === 'OK'
          ? 'OK'
          : `FAILED: ${integrity.missing.join('；')}`,
        task.createdAt,
        task.updatedAt,
        task.completedAt || '',
      ],
    ];
  }

  formatEvidenceIndexForCsv(
    items: Array<{
      eventId?: string;
      id?: string;
      type: string;
      label: string;
      stageKey?: string;
      createdAt?: string;
    }>,
  ) {
    return items
      .map(
        (item) =>
          `${item.stageKey || item.type}:${item.label}#${item.eventId || item.id || 'n/a'}`,
      )
      .join('；');
  }

  ensureTaskStore() {
    if (!this.taskStoreReady) {
      this.taskStoreReady = Promise.resolve();
    }

    return this.taskStoreReady;
  }

  readonly taskTypeToPrisma: Record<string, string> = {
    'douyin-comment-reply': 'DOUYIN_COMMENT_REPLY',
    'douyin-direct-message-reply': 'DOUYIN_DIRECT_MESSAGE_REPLY',
    'wechat-channel-comment-reply': 'WECHAT_CHANNEL_COMMENT_REPLY',
    'wechat-channel-direct-message-reply':
      'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
    'wechat-reply-draft': 'WECHAT_REPLY_DRAFT',
    'wechat-friend-accept': 'WECHAT_FRIEND_ACCEPT',
    'wechat-group-broadcast': 'WECHAT_GROUP_BROADCAST',
    'wechat-contact-add': 'WECHAT_CONTACT_ADD',
    'wechat-moments-publish': 'WECHAT_MOMENTS_PUBLISH',
    'wechat-moments-marketing': 'WECHAT_MOMENTS_MARKETING',
    'customer-follow-up': 'CUSTOMER_FOLLOW_UP',
  };

  readonly taskTypeFromPrisma: Record<string, string> = {
    DOUYIN_COMMENT_REPLY: 'douyin-comment-reply',
    DOUYIN_DIRECT_MESSAGE_REPLY: 'douyin-direct-message-reply',
    WECHAT_CHANNEL_COMMENT_REPLY: 'wechat-channel-comment-reply',
    WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: 'wechat-channel-direct-message-reply',
    WECHAT_REPLY_DRAFT: 'wechat-reply-draft',
    WECHAT_FRIEND_ACCEPT: 'wechat-friend-accept',
    WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
    WECHAT_CONTACT_ADD: 'wechat-contact-add',
    WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
    WECHAT_MOMENTS_MARKETING: 'wechat-moments-marketing',
    CUSTOMER_FOLLOW_UP: 'customer-follow-up',
  };

  readonly taskStatusToPrisma: Record<string, string> = {
    queued: 'QUEUED',
    running: 'RUNNING',
    waiting_for_send_confirmation: 'WAITING_FOR_SEND_CONFIRMATION',
    completed: 'COMPLETED',
    failed: 'FAILED',
    blocked: 'BLOCKED',
    skipped: 'SKIPPED',
    no_target: 'NO_TARGET',
    paused: 'PAUSED',
  };

  readonly taskStatusFromPrisma: Record<string, string> = {
    QUEUED: 'queued',
    RUNNING: 'running',
    WAITING_FOR_SEND_CONFIRMATION: 'waiting_for_send_confirmation',
    COMPLETED: 'completed',
    FAILED: 'failed',
    BLOCKED: 'blocked',
    SKIPPED: 'skipped',
    NO_TARGET: 'no_target',
    PAUSED: 'paused',
  };

  async persistTask(task: InteractionTask) {
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

  async persistTaskNow(task: InteractionTask) {
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
      localTaskId:
        (task as { localTaskId?: string | null }).localTaskId ?? null,
      requiresDoubleConfirmation: task.requiresDoubleConfirmation ?? false,
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

  async runPrismaTransientRetry<T>(
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

  isPrismaTransientConnectionError(error: unknown): boolean {
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

  formatPrismaRetryError(error: unknown): string {
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

  async persistReplyRule(
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

  async persistAgentSession(session: AgentSession) {
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

  async persistAgentConfirmation(confirmation: AgentConfirmation) {
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
      decidedAt: confirmation.decidedAt
        ? new Date(confirmation.decidedAt)
        : null,
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

  agentSessionSourceToPrisma(source?: AgentSessionSource) {
    return source === 'agent-console' ? 'agent_console' : (source ?? 'web');
  }

  async loadReplyRuleFromStore(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionReplyRuleConfig> {
    await this.ensureTaskStore();
    const scope = requestedScope || (await this.resolveTenantScope());
    const cacheKey = this.tenantScopeKey(scope);
    const cached = this.replyRules.get(cacheKey);
    if (cached) {
      return cached;
    }

    let row = await this.runPrismaTransientRetry(
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

  async hydrateTasksFromStore(limit = 50) {
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
        this.repairHydratedTaskEvidence(row as InteractionTaskSummaryRow, task);
        this.refreshTaskDiagnostics(task);
        this.tasks.set(task.id, task);
      }
    });
  }

  async listStoredTaskSummaries(
    limit = 50,
    filter: InteractionTaskListFilter = {},
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]> {
    const scope = await this.resolveTenantScope();
    const where: Record<string, unknown> = { ...scope };
    const prismaTypes = (
      types?.length ? types : filter.type ? [filter.type] : []
    )
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

  async mergeTaskSummaries(
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

  normalizeTaskForDisplay(task: InteractionTask): InteractionTask {
    const {
      billingIdentity: _billingIdentity,
      tenantId: _tenantId,
      userId: _userId,
      ...publicTask
    } = task as InteractionTask & { billingIdentity?: unknown };
    const needsEvidenceIntegrityRepair =
      this.taskHasEvidenceIntegrityText(task);
    const displayNextAction =
      this.cleanEvidenceIntegrityText(task.nextAction) ||
      defaultNextActionForStatus(task.status);
    const displayFailureReason =
      this.cleanEvidenceIntegrityText(task.failureReason) ||
      this.cleanEvidenceIntegrityText(task.diagnostics?.failureReason) ||
      this.cleanEvidenceIntegrityText(
        task.batchTargets?.find((target) => target.failureReason)
          ?.failureReason,
      ) ||
      (needsEvidenceIntegrityRepair &&
      (task.status === 'failed' || task.status === 'blocked')
        ? `${this.resolveTypeLabel(task.type)}停在${task.diagnostics?.currentStep || task.steps?.find((step) => step.status === 'blocked')?.label || '执行阶段'}。`
        : undefined);
    const displayEvents = needsEvidenceIntegrityRepair
      ? this.ensureStoredSummaryEvidenceEvents(
          this.normalizeStoredTaskEvents(
            [task.events],
            task.id,
            task.updatedAt,
          ),
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

  toStoredTaskSummary(row: InteractionTaskSummaryRow): InteractionTask {
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
      this.cleanEvidenceIntegrityText(
        storedConfig?.diagnostics?.failureReason,
      ) ||
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
        platform: this.resolveSummaryPlatformName(type),
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

  normalizeStoredTaskEvents(
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

  repairHydratedTaskEvidence(
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

  cleanEvidenceIntegrityText(value: unknown) {
    const text = optionalTrimmedText(value);
    return text && !isEvidenceIntegrityText(text) ? text : undefined;
  }

  taskHasEvidenceIntegrityText(task: InteractionTask) {
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

  normalizeStoredTaskEvent(
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
      id:
        optionalTrimmedText(record.id) || `${taskId}-stored-event-${index + 1}`,
      taskId: optionalTrimmedText(record.taskId) || taskId,
      level,
      message,
      createdAt,
      evidence,
    };
  }

  isStoredEvidenceIntegrityBackfill(
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

  normalizeStoredTaskEvidence(
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

  normalizeStoredEventLevel(value: unknown): InteractionTaskEvent['level'] {
    return value === 'success' ||
      value === 'warning' ||
      value === 'error' ||
      value === 'info'
      ? value
      : 'info';
  }

  normalizeStoredEvidenceType(
    value: string | undefined,
  ): NonNullable<InteractionTaskEvent['evidence']>['type'] | undefined {
    const allowed: Array<
      NonNullable<InteractionTaskEvent['evidence']>['type']
    > = [
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

  countStoredTaskSummaryEvidence(input: {
    batchTargets?: InteractionBatchTarget[];
    diagnostics?: Partial<NonNullable<InteractionTask['diagnostics']>>;
    events?: InteractionTaskEvent[];
    resultSummary?: Partial<InteractionTaskResultSummary>;
  }) {
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

  normalizeStoredTaskType(value: unknown): InteractionTaskType {
    const raw = String(value || '');
    const type = this.taskTypeFromPrisma[raw] || raw;
    return this.isKnownInteractionTaskType(type)
      ? type
      : 'douyin-comment-reply';
  }

  normalizeStoredTaskStatus(value: unknown): InteractionTaskStatus {
    const raw = String(value || '');
    const status = this.taskStatusFromPrisma[raw] || raw;
    return this.isKnownInteractionTaskStatus(status) ? status : 'queued';
  }

  isKnownInteractionTaskStatus(
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

  normalizeStoredRiskLevel(value: string): AgentRiskLevel {
    return value === 'low' || value === 'medium' || value === 'high'
      ? value
      : 'medium';
  }

  createStoredSummaryRiskPolicy(
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

  normalizeStoredTaskSummaryTargets(
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

  normalizeStoredSummaryTargetStatus(
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

  normalizeStoredTaskSummaryValue(
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

  resolveSummaryPlatformName(type: InteractionTaskType) {
    if (type.startsWith('douyin')) return '抖音';
    if (type.startsWith('wechat-channel')) return '视频号';
    if (isDesktopInteractionTask(type)) return '微信';
    return '客户跟进';
  }

  resolveSummaryDiagnosticStatus(
    status: InteractionTaskStatus,
  ): NonNullable<InteractionTask['diagnostics']>['status'] {
    if (status === 'completed') return 'completed';
    if (status === 'failed' || status === 'blocked') return 'blocked';
    if (status === 'skipped') return 'skipped';
    if (status === 'no_target') return 'no_target';
    if (status === 'waiting_for_send_confirmation') return 'waiting';
    return 'normal';
  }

  async hydrateAgentSessionsFromStore(
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

  async hydrateAgentConfirmationsFromStore(
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

  async loadStoredAgentSession(
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

  async loadStoredTask(id: string, requestedScope?: LocalEngineTenantScope) {
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

  async getPlaywrightMcpStatusWithCount() {
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

  async getCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]> {
    const useNodeRuntime = this.useNodeAgentRuntime();
    const [
      interactionCapabilities,
      publishingCapability,
      kaypalEntitlement,
      aiReplyModel,
      evidenceReplay,
      fileAccess,
      mcpStatus,
      playwrightMcpStatus,
      sidecarStatus,
      sandboxStatus,
      pluginStatus,
      memoryStatus,
    ] = await Promise.all([
      this.withCapabilityTimeout(
        '互动接口能力',
        this.checkInteractionCapabilities(),
        {
          status: 'blocked' as const,
          summary: '互动接口能力检查超时。',
          nextAction: '刷新状态或重启本地浏览器控制服务后重试。',
          checks: [
            {
              name: '互动能力接口',
              status: 'blocked' as const,
              message: '检查超过 8 秒，不能证明真实互动执行器可用。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        '内容发布能力',
        this.checkContentPublishingCapability(),
        {
          status: 'blocked' as const,
          summary: '内容发布能力检查超时。',
          nextAction: '刷新状态或重启 3011 本地 Runtime 后重试。',
          checks: [
            {
              name: '发布执行器',
              status: 'blocked' as const,
              message: '检查超过 2 秒，不能证明内容发布执行器可用。',
            },
          ],
        },
      ),
      this.withCapabilityTimeout(
        'Kaypal 账号与权益',
        this.buildKaypalEntitlementCapability(now, user),
        this.buildKaypalEntitlementTimeoutFallback(now, user),
        6000,
      ),
      this.withCapabilityTimeout(
        'AI 回复模型',
        this.checkAiReplyModelConfig(),
        {
          status: 'blocked' as const,
          summary: 'AI 默认模型检查超时。',
          nextAction: '稍后刷新，或到模型配置页重新同步 Kaypal 模型台。',
          checks: [
            {
              name: '默认模型配置读取',
              status: 'blocked' as const,
              message: '检查超过 2 秒，不能证明 AI 模型授权/配置可用。',
            },
          ],
        },
      ),
      this.withCapabilityTimeout(
        '证据链与回放',
        this.checkEvidenceReplayCapability(),
        {
          status: 'blocked' as const,
          summary: '证据链检查超时。',
          nextAction: '检查本地证据目录、任务记录表和 RuntimeExecution 表。',
          checks: [
            {
              name: '证据链检查',
              status: 'blocked' as const,
              message: '检查超过 8 秒，不能证明证据和诊断记录可用。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        '文件访问',
        this.checkFileAccess(),
        {
          status: 'blocked' as const,
          summary: '文件访问检查超时。',
          nextAction: '检查本地目录权限后刷新。',
          checks: [
            {
              name: '目录读写检查',
              status: 'blocked' as const,
              message:
                '检查超过 8 秒，不能证明素材、账号档案和证据目录可读写。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        'MCP 工具服务管理',
        this.mcpRuntime.getStatus(),
        {
          available: false,
          serverCount: 0,
          toolCount: 0,
          resourceCount: 0,
          strictMode: false,
          servers: [],
          message: 'MCP 状态检查超时',
        },
      ),
      this.withCapabilityTimeout(
        'playwright-mcp',
        this.getPlaywrightMcpStatusWithCount(),
        {
          online: false,
          childProcessRunning: Boolean(
            this.playwrightMcp?.getStatus().childProcessRunning,
          ),
          transport: 'none' as const,
          endpoint: '',
          pid: this.playwrightMcp?.getStatus().pid,
          toolCount: 0,
          profileKey: this.playwrightMcp?.getStatus().profileKey,
          profileDir: this.playwrightMcp?.getStatus().profileDir,
          visibleWindow: this.playwrightMcp?.getStatus().visibleWindow ?? false,
          isolated: this.playwrightMcp?.getStatus().isolated ?? false,
          message: 'playwright-mcp 工具发现超时',
        },
      ),
      useNodeRuntime
        ? Promise.resolve({
            available: false,
            version: null,
            runnerMode: null,
            sessionProtocol: false,
            eventStream: false,
            screenshotArtifacts: false,
            executionControl: false,
            message:
              'Node Runtime 模式下外部 17777 Python sidecar 为可选兼容项，未参与必需检查。',
          })
        : this.withCapabilityTimeout(
            'Agent-S 执行能力',
            this.agentSidecar.getStatus(),
            {
              available: false,
              version: null,
              runnerMode: null,
              sessionProtocol: false,
              eventStream: false,
              screenshotArtifacts: false,
              executionControl: false,
              message: 'Agent-S sidecar 状态检查超时',
            },
          ),
      this.withCapabilityTimeout('沙箱执行', this.sandboxRuntime.getStatus(), {
        available: false,
        platform: platform(),
        dockerAvailable: false,
        sandboxType: 'none',
        message: '沙箱运行时检查超时',
      }),
      this.withCapabilityTimeout(
        '插件与技能运行时',
        this.pluginRuntime.getStatus(),
        {
          available: false,
          skillDirectory: null,
          skillhubDirectory: null,
          skillhubSkills: [],
          installedSkillCount: 0,
          skillNames: [],
          runtimeApiAvailable: false,
          message: '插件运行时检查超时',
        },
      ),
      this.withCapabilityTimeout(
        '记忆与上下文',
        this.memoryRuntime.getStatus(),
        {
          available: false,
          shortTermAvailable: false,
          dailyAvailable: false,
          longTermAvailable: false,
          runtimeApiAvailable: false,
          message: '记忆运行时检查超时',
        },
      ),
    ]);
    const desktop = await this.withCapabilityTimeout(
      '桌面微信',
      this.readDesktopStatusWithEvidenceCached(now),
      this.buildDesktopStatus(
        {
          platform: 'wechat',
          available: false,
          running: false,
          appName: '微信',
          windowCount: 0,
          message: '桌面微信状态检查超时。',
          permissionHints: ['检查超过 4 秒，不能证明微信桌面链路可用。'],
          screenshotAvailable: false,
          inputControlAvailable: false,
          clickControlAvailable: false,
          fileSelectionAvailable: false,
        },
        now,
      ),
      4000,
    );
    const wechatDesktopReady = isDesktopWechatExecutionReady(desktop);
    const wechatDesktopRunnable = this.isDesktopWechatRuntimeRunnable(desktop);
    const wechatCommerciallyRunnable =
      wechatDesktopRunnable && this.hasWechatControlSurfaceEvidence(desktop);
    const wechatDesktopBlocker = summarizeDesktopWechatBlocker(desktop);
    const wechatSessionLocked =
      wechatDesktopReady &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt;
    const agentSCapability = useNodeRuntime
      ? await this.buildNodeAgentRuntimeCapability(now, sidecarStatus.message)
      : this.buildLegacyAgentSCapability(now, sidecarStatus);

    return [
      {
        key: 'browser-control',
        name: '浏览器引擎',
        status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightMcpStatus.readyForAutomation
          ? `浏览器控制已就绪，可通过 3011 Node Runtime/CDP/Playwright 操作平台后台（tools=${playwrightMcpStatus.toolCount ?? 0}）。`
          : '浏览器自动化工具未就绪，不能执行真实平台读取、发送和回读。',
        checkedAt: now,
        nextAction: playwrightMcpStatus.readyForAutomation
          ? ''
          : '检查包内 Playwright Chromium、@playwright/mcp、工具发现和 3011 启动日志。',
        checks: [
          {
            name: 'playwright-mcp',
            status: playwrightMcpStatus.readyForAutomation
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.message,
          },
          {
            name: '必需浏览器工具',
            status: playwrightMcpStatus.requiredToolsReady
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.requiredToolsReady
              ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
              : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      {
        key: 'interaction-capabilities',
        name: '真实互动执行器',
        status: interactionCapabilities.status,
        required: true,
        summary: interactionCapabilities.summary,
        checkedAt: now,
        nextAction: interactionCapabilities.nextAction,
        checks: interactionCapabilities.checks,
      },
      {
        key: 'content-publishing',
        name: '内容发布执行器',
        status: publishingCapability.status,
        required: true,
        summary: publishingCapability.summary,
        checkedAt: now,
        nextAction: publishingCapability.nextAction,
        checks: publishingCapability.checks,
      },
      kaypalEntitlement,
      {
        key: 'ai-reply-model',
        name: 'AI 回复模型',
        status: aiReplyModel.status,
        required: true,
        summary: aiReplyModel.summary,
        checkedAt: now,
        nextAction: aiReplyModel.nextAction,
        checks: aiReplyModel.checks,
      },
      {
        key: 'desktop-control',
        name: '桌面控制',
        status:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? 'ready'
            : 'blocked',
        required: true,
        summary:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? `桌面微信可控，当前窗口：${desktop.window.currentWindowTitle || '已检测到微信窗口'}。`
            : `桌面微信不可用：${wechatDesktopBlocker}`,
        checkedAt: now,
        nextAction:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '桌面微信已具备执行条件，微信任务会按自动/受控执行规则推进。'
            : desktop.nextAction,
        checks: desktop.permissionChecks.map((check) => ({
          name: check.label,
          status: check.status,
          message: check.message,
        })),
      },
      {
        key: 'mcp-manager',
        name: 'Playwright/MCP 工具',
        status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightMcpStatus.readyForAutomation
          ? `playwright-mcp sidecar 在线（${playwrightMcpStatus.message}）`
          : 'playwright-mcp 未运行；真实浏览器自动化工具不可用。',
        checkedAt: now,
        nextAction: playwrightMcpStatus.readyForAutomation
          ? `MCP 端点 ${playwrightMcpStatus.endpoint} 暴露 ${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具；任何 MCP 客户端（Claude/Cursor/Agent-S）都能通过 POST 调。`
          : '检查 PlaywrightMcpService 初始化日志（一般在 nest-start.log 顶部）',
        checks: [
          {
            name: 'sidecar 进程',
            status: playwrightMcpStatus.childProcessRunning
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.childProcessRunning
              ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightMcpStatus.pid ?? '?'})`
              : '子进程未启动',
          },
          {
            name: 'HTTP 端点',
            status: playwrightMcpStatus.online ? 'ready' : 'blocked',
            message: `${playwrightMcpStatus.endpoint} (${playwrightMcpStatus.transport})`,
          },
          {
            name: '工具发现',
            status: playwrightMcpStatus.requiredToolsReady
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.requiredToolsReady
              ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已暴露 (browser_navigate/click/type/snapshot/screenshot 等)`
              : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      agentSCapability,
      {
        key: 'wechat-execution',
        name: '微信完整执行链',
        status:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? 'ready'
            : 'blocked',
        required: true,
        summary:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '微信会话、回复、群发、加好友、朋友圈发布和朋友圈营销都已接入本机桌面执行链。'
            : `微信执行链未就绪：${wechatDesktopBlocker}`,
        checkedAt: now,
        nextAction:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。'
            : desktop.nextAction,
        checks: [
          {
            name: '微信进程检测',
            status: desktop.running ? 'ready' : 'blocked',
            message: desktop.running
              ? `${desktop.appName || '微信'} 已运行。`
              : '桌面微信未运行。',
          },
          {
            name: '联系人锁定',
            status: wechatSessionLocked
              ? 'ready'
              : wechatDesktopReady || wechatCommerciallyRunnable
                ? 'warning'
                : 'blocked',
            message: wechatSessionLocked
              ? `当前已锁定：${this.wechatSessionConfirmation.targetContact?.trim()}。`
              : wechatDesktopReady || wechatCommerciallyRunnable
                ? '已取得可信微信窗口证据；当前未锁定具体联系人，按商用测试账号受控执行风险提示处理。'
                : '桌面微信未就绪，不能锁定联系人或群聊。',
          },
          {
            name: '执行保护',
            status:
              wechatDesktopReady || wechatCommerciallyRunnable
                ? 'ready'
                : 'blocked',
            message:
              '回复、群发、加好友和朋友圈动作会在自动/受控执行后写入截图、失败原因和任务记录。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary:
          '远程控制不纳入当前 AI 员工主流程，已保留接管审计和会话证据记录。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '当前以本机执行和任务记录为主；远程接管只保留审计记录。',
          },
          {
            name: '用户接管审计',
            status: 'ready',
            message:
              'Agent 会话已包含 remoteTakeoverAuditRequired 和 remoteAudit，确认/拒绝会写入审批日志。',
          },
        ],
      },
      {
        key: 'plugin-runtime',
        name: '插件与技能运行时',
        status: pluginStatus.available ? 'ready' : 'optional',
        required: false,
        summary: pluginStatus.message,
        checkedAt: now,
        nextAction: pluginStatus.available
          ? `已发现 ${pluginStatus.installedSkillCount} 个本地技能、${pluginStatus.skillhubSkills.filter((skill) => skill.installed).length} 个 SkillHub 技能。`
          : '当前主流程使用已注册的本机执行链；需要扩展插件时再安装本地技能。',
        checks: [
          {
            name: '插件目录',
            status: pluginStatus.installedSkillCount > 0 ? 'ready' : 'optional',
            message:
              pluginStatus.installedSkillCount > 0
                ? `${pluginStatus.installedSkillCount} 个技能已安装于 ${pluginStatus.skillDirectory}。`
                : '未找到技能目录或目录为空。',
          },
          {
            name: 'SkillHub 技能',
            status: pluginStatus.skillhubSkills.some((skill) => skill.ready)
              ? 'ready'
              : pluginStatus.skillhubSkills.some((skill) => skill.installed)
                ? 'warning'
                : 'optional',
            message:
              pluginStatus.skillhubSkills
                .filter((skill) => skill.installed)
                .map(
                  (skill) =>
                    `${skill.slug}${skill.ready ? ' 可执行' : ` 缺命令：${skill.missingCommands.join('、')}`}`,
                )
                .join('；') || '未安装 SkillHub 技能。',
          },
          {
            name: '插件运行',
            status: pluginStatus.runtimeApiAvailable ? 'ready' : 'optional',
            message: pluginStatus.runtimeApiAvailable
              ? 'Runtime API 在线，支持 commands、agents、hooks 执行。'
              : 'Runtime API 不可用，插件执行功能受限。',
          },
        ],
      },
      {
        key: 'memory-context',
        name: '记忆与上下文',
        status: memoryStatus.available ? 'ready' : 'optional',
        required: false,
        summary: memoryStatus.message,
        checkedAt: now,
        nextAction: memoryStatus.available
          ? '记忆系统已接入，支持消息历史和上下文管理。'
          : '当前按任务记录和操作证据保存上下文；需要长期记忆时再连接记忆服务。',
        checks: [
          {
            name: '消息历史',
            status:
              memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
                ? 'ready'
                : 'optional',
            message:
              memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
                ? `消息历史存储可用（${memoryStatus.shortTermAvailable ? '短期' : ''}${memoryStatus.shortTermAvailable && memoryStatus.dailyAvailable ? '+' : ''}${memoryStatus.dailyAvailable ? '日常' : ''}）。`
                : '消息历史存储不可用。',
          },
          {
            name: '上下文压缩',
            status: memoryStatus.longTermAvailable ? 'ready' : 'optional',
            message: memoryStatus.longTermAvailable
              ? '长期记忆和上下文压缩通过向量库支持。'
              : '向量库不可用，上下文压缩功能受限。',
          },
        ],
      },
      {
        key: 'sandbox-execution',
        name: '沙箱执行',
        status: sandboxStatus.available ? 'ready' : 'optional',
        required: false,
        summary: sandboxStatus.message,
        checkedAt: now,
        nextAction: sandboxStatus.available
          ? `沙箱类型：${sandboxStatus.sandboxType}，平台：${sandboxStatus.platform}。`
          : 'Docker 沙箱为后续或可选能力，小白安装包不要求用户安装 Docker。',
        checks: [
          {
            name: '平台适配',
            status: sandboxStatus.available ? 'ready' : 'optional',
            message: sandboxStatus.available
              ? `平台 ${sandboxStatus.platform}，沙箱类型 ${sandboxStatus.sandboxType}。`
              : '当前平台不支持沙箱执行。',
          },
          {
            name: '执行边界',
            status: sandboxStatus.available ? 'ready' : 'optional',
            message: sandboxStatus.available
              ? '命令、文件、路径操作的沙箱边界已通过 Docker/native 隔离。'
              : '等待沙箱运行时接入。',
          },
        ],
      },
      {
        key: 'evidence-replay',
        name: '证据链与回放',
        status: evidenceReplay.status,
        required: true,
        summary: evidenceReplay.summary,
        checkedAt: now,
        nextAction: evidenceReplay.nextAction,
        checks: evidenceReplay.checks,
      },
      {
        key: 'file-access',
        name: '文件访问',
        status: fileAccess.status === 'warning' ? 'blocked' : fileAccess.status,
        required: true,
        summary: fileAccess.summary,
        checkedAt: now,
        nextAction: fileAccess.nextAction,
        checks: fileAccess.checks.map((check) => ({
          ...check,
          status: check.status === 'warning' ? 'blocked' : check.status,
        })),
      },
      {
        key: 'permission-check',
        name: '权限检查',
        status: 'ready',
        required: true,
        summary:
          '已接入试用/商用边界、角色审批、白名单、禁止动作和误发误删保护字段。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '试用/商用权限',
            status: 'ready',
            message:
              '任务和 Agent 会话已返回 safetyBoundary、riskPolicy、requiredChecks。',
          },
          {
            name: '禁止动作',
            status: 'ready',
            message: '已配置禁止动作列表，高风险操作需要确认。',
          },
        ],
      },
    ];
  }

  withCapabilityTimeout<T>(
    name: string,
    promise: Promise<T>,
    fallback: T,
    timeoutMs = 2000,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((resolveResult) => {
      timeout = setTimeout(() => {
        console.warn(
          `[LocalEngineHealth] ${name} check timed out after ${timeoutMs}ms`,
        );
        resolveResult(fallback);
      }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  }

  async checkAutoUploadEngine() {
    // 2026-06-04: 5409 已下线；改查 playwright-mcp sidecar (in-process)
    if (!this.playwrightMcp) {
      return {
        ok: false,
        message: 'PlaywrightMcpService 未注入（无浏览器引擎可用）',
      };
    }
    try {
      const status = await this.playwrightMcp.getAutomationStatus();
      if (status.readyForAutomation) {
        return {
          ok: true,
          message: `in-process Chrome via playwright-mcp 已就绪 (pid=${status.pid ?? '?'}, ${status.endpoint}, tools=${status.toolCount ?? 0})`,
        };
      }
      return {
        ok: false,
        message: `playwright-mcp 未达到真实自动化标准：${status.message}${
          status.missingRequiredTools?.length
            ? `；缺少工具 ${status.missingRequiredTools.join(', ')}`
            : ''
        }`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return { ok: false, message: `playwright-mcp 状态检查失败：${message}` };
    }
  }

  async checkInteractionCapabilities() {
    try {
      const status = await this.loadExecutorsStatus();
      const requiredExecutorIds =
        this.getRequiredInteractionExecutorIdsForCurrentHost();
      const unsupportedExecutorIds =
        this.getUnsupportedInteractionExecutorIdsForCurrentHost();
      const requiredExecutors = status.executors.filter((executor) =>
        requiredExecutorIds.includes(String(executor.key)),
      );
      const missingIds = requiredExecutorIds.filter(
        (id) => !requiredExecutors.some((executor) => executor.key === id),
      );
      const ready = requiredExecutors.filter(
        (executor) => executor.status === 'ready',
      ).length;
      const awaitingConfirmation = requiredExecutors.filter(
        (executor) => executor.status === 'preflight_only',
      ).length;
      const readyTaskNames = requiredExecutors
        .filter(
          (executor) =>
            executor.status === 'ready' || executor.status === 'preflight_only',
        )
        .map((executor) => String(executor.key))
        .join('、');
      const taskNames = requiredExecutors
        .map((executor) => String(executor.key))
        .join('、');
      const hasExecutors =
        requiredExecutors.length === requiredExecutorIds.length;
      const allReady = hasExecutors && ready === requiredExecutors.length;
      const allRunnable =
        hasExecutors &&
        requiredExecutors.every(
          (executor) =>
            executor.status === 'ready' || executor.status === 'preflight_only',
        );
      const unsupportedMessage = unsupportedExecutorIds.length
        ? `；${process.platform} 本机不把 ${unsupportedExecutorIds.join(
            '、',
          )} 算入必需范围，这些微信操作需要在支持的桌面系统单独验收`
        : '';

      return {
        status: allReady
          ? ('ready' as const)
          : allRunnable
            ? ('warning' as const)
            : ('blocked' as const),
        summary:
          requiredExecutors.length === 0
            ? '未发现客户互动执行能力。'
            : allRunnable
              ? `客户互动能力已接通：${ready} 项可直接运行，${awaitingConfirmation} 项需要先确认目标会话${unsupportedMessage}。`
              : `客户互动能力 ${ready}/${requiredExecutorIds.length} 项可用：${taskNames || '无'}${unsupportedMessage}。`,
        nextAction: allReady
          ? unsupportedExecutorIds.length
            ? '抖音、视频号互动能力已可用；桌面微信群发、加好友和朋友圈请在支持的桌面系统验收。'
            : '抖音、视频号和桌面微信互动执行器已注册并可调度。'
          : allRunnable
            ? '微信任务选择目标会话并完成发送前确认后即可执行，不需要安装其他组件。'
            : '部分客户互动能力不可用；请检查平台账号登录状态和本地执行服务。',
        checks: [
          {
            name: '客户互动能力',
            status: hasExecutors ? ('ready' as const) : ('blocked' as const),
            message: `${requiredExecutors.length}/${requiredExecutorIds.length} 项已接入：${taskNames || '无'}${missingIds.length ? `；缺少 ${missingIds.join('、')}` : ''}`,
          },
          {
            name: '就绪率',
            status: allReady
              ? ('ready' as const)
              : allRunnable
                ? ('warning' as const)
                : ('blocked' as const),
            message: `${ready}/${requiredExecutorIds.length} 项可直接运行，${awaitingConfirmation} 项等待目标确认：${readyTaskNames || '无'}`,
          },
          ...(unsupportedExecutorIds.length
            ? [
                {
                  name: '桌面微信写入能力',
                  status: 'warning' as const,
                  message: `${unsupportedExecutorIds.join(
                    '、',
                  )} 当前系统不支持真实操作，只保留执行前检查。`,
                },
              ]
            : []),
          {
            name: '执行路径',
            status: allRunnable ? ('ready' as const) : ('blocked' as const),
            message:
              process.platform === 'darwin'
                ? '浏览器平台使用本机浏览器；桌面微信使用 Mac 微信自动化与结果留存。'
                : process.platform === 'win32'
                  ? '浏览器平台使用本机浏览器；桌面微信使用 Windows 微信组件与结果留存。'
                  : '浏览器平台使用本机浏览器；桌面微信在当前系统仅做执行前检查。',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        status: 'blocked' as const,
        summary: `发布服务未返回互动能力清单：${message}`,
        nextAction: '请升级或重启 3011 本地 Runtime，并确认互动能力清单可用。',
        checks: [
          {
            name: '互动能力接口',
            status: 'blocked' as const,
            message,
          },
        ],
      };
    }
  }

  async checkContentPublishingCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    if (!this.runtimeOrchestrator) {
      return {
        status: 'blocked',
        summary: 'RuntimeOrchestrator 未注入，无法读取内容发布执行器。',
        nextAction: '检查 RuntimeModule 与 LocalEngineModule 装配。',
        checks: [
          {
            name: '发布编排器',
            status: 'blocked',
            message: 'RuntimeOrchestrator 模块未连接。',
          },
        ],
      };
    }
    try {
      const healths = await this.runtimeOrchestrator.healthCheck();
      const publish = healths.find(
        (health) => health.id === 'platform-publish',
      );
      if (!publish) {
        return {
          status: 'blocked',
          summary: '未注册内容发布执行器。',
          nextAction: '检查 PlatformPublishService 是否注入 RuntimeModule。',
          checks: [
            {
              name: 'platform-publish',
              status: 'blocked',
              message: 'healthCheck 未返回 platform-publish。',
            },
          ],
        };
      }
      return {
        status: publish.ok ? 'ready' : 'blocked',
        summary: publish.ok
          ? '内容发布执行器已注册；发布能力单独验收，不计入客户互动四条链路。'
          : '内容发布执行器不可用。',
        nextAction: publish.ok
          ? '如需验收发布，请单独跑图文/视频发布读写流程。'
          : '检查 PlatformPublishService 健康详情和 3011 启动日志。',
        checks: [
          {
            name: 'platform-publish',
            status: publish.ok ? 'ready' : 'blocked',
            message:
              publish.details ||
              (publish.ok ? '发布执行器在线。' : '发布执行器离线。'),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        status: 'blocked',
        summary: `内容发布执行器检查失败：${message}`,
        nextAction: '请重启 3011 本地 Runtime 后重试。',
        checks: [
          {
            name: 'platform-publish',
            status: 'blocked',
            message,
          },
        ],
      };
    }
  }

  async checkEvidenceReplayCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    const runtimePaths = this.resolveLocalRuntimePaths();
    const evidenceDir = runtimePaths.evidence;
    const checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }> = [];

    try {
      await mkdir(evidenceDir, { recursive: true });
      const probePath = join(
        evidenceDir,
        `.kaypal-evidence-runcheck-${process.pid}-${Date.now()}.probe`,
      );
      await writeFile(probePath, 'ok', 'utf8');
      await rm(probePath, { force: true });
      checks.push({
        name: '证据目录',
        status: 'ready',
        message: `${evidenceDir} 可创建、写入和删除证据探针。`,
      });
    } catch (error) {
      checks.push({
        name: '证据目录',
        status: 'blocked',
        message: error instanceof Error ? error.message : '证据目录读写失败',
      });
    }

    try {
      const [taskCount, runtimeExecutionCount] = await Promise.all([
        this.prisma.interactionTask.count(),
        this.prisma.runtimeExecution.count(),
      ]);
      checks.push({
        name: '任务记录表',
        status: 'ready',
        message: `interaction_tasks 可读，当前 ${taskCount} 条。`,
      });
      checks.push({
        name: 'Runtime 执行记录表',
        status: 'ready',
        message: `runtime_executions 可读，当前 ${runtimeExecutionCount} 条。`,
      });
    } catch (error) {
      checks.push({
        name: '执行记录表',
        status: 'blocked',
        message:
          error instanceof Error ? error.message : '任务或执行记录表读取失败',
      });
    }

    const blocked = checks.some((check) => check.status === 'blocked');
    return {
      status: blocked ? 'blocked' : 'ready',
      summary: blocked
        ? '证据目录或执行记录表不可用，不能保证截图、页面回读和诊断导出落库。'
        : '证据目录、互动任务表和 Runtime 执行记录表检查通过。',
      nextAction: blocked
        ? '检查本地 evidence 目录权限、SQLite schema 和 Prisma 迁移。'
        : '',
      checks,
    };
  }

  async checkAiReplyModelConfig(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    try {
      const textPurposes = ['article_creation', 'topic_selection'];
      const configs = await this.prisma.defaultModelConfig.findMany({
        where: { purpose: { in: textPurposes } },
      });
      const configuredModelIds = [
        ...new Set(configs.map((config) => config.modelId).filter(Boolean)),
      ];

      if (!configuredModelIds.length) {
        return this.withKaypalModelSyncHint({
          status: 'warning',
          summary:
            '未配置文章创作或精选选题默认模型；微信本机任务可继续，AI 生成类回复会使用规则兜底或在具体任务中提示配置。',
          nextAction:
            '到 3010 系统设置 → Kaypal 模型同步发起一次同步，把 Kaypal 模型台的默认模型拉过来。',
          checks: [
            {
              name: '默认文本模型',
              status: 'warning',
              message:
                'default_model_configs 缺少 article_creation/topic_selection。',
            },
          ],
        });
      }

      const models = await this.prisma.aIModel.findMany({
        where: { id: { in: configuredModelIds } },
        include: { platform: true },
      });
      const usableModels = models.filter(
        (model) =>
          model.enabled &&
          model.platform?.enabled &&
          Boolean(model.platform?.baseUrl?.trim()) &&
          Boolean(model.platform?.apiKey?.trim()),
      );
      const configuredPurposes = new Set(
        configs.map((config) => config.purpose),
      );
      const missingPurposes = textPurposes.filter(
        (purpose) => !configuredPurposes.has(purpose),
      );

      if (!usableModels.length) {
        return this.withKaypalModelSyncHint({
          status: 'warning',
          summary:
            '默认文本模型已填写，但模型不可用；微信本机任务可继续，AI 生成类动作会在具体任务中提示修复模型。',
          nextAction:
            '检查默认模型指向的 AI 模型、平台启用状态、Base URL 和 API Key；不要把规则兜底当作 AI 闭环通过。',
          checks: [
            {
              name: '默认文本模型',
              status: 'warning',
              message: configs
                .map((config) => `${config.purpose}:${config.modelId}`)
                .join('、'),
            },
            {
              name: '模型启用状态',
              status: 'warning',
              message: models.length
                ? models
                    .map(
                      (model) =>
                        `${model.name}: modelEnabled=${model.enabled}, platformEnabled=${model.platform?.enabled ?? false}`,
                    )
                    .join('、')
                : '默认模型 ID 没有匹配到 ai_models 记录。',
            },
          ],
        });
      }

      return {
        status: missingPurposes.length ? 'warning' : 'ready',
        summary: `已配置可用默认文本模型：${usableModels
          .map((model) => `${model.name}(${model.modelId})`)
          .join('、')}。`,
        nextAction: missingPurposes.length
          ? `建议补齐 ${missingPurposes.join('、')}，内容生产完整链路会用到。`
          : '',
        checks: [
          {
            name: '默认文本模型',
            status: 'ready',
            message: configs
              .map((config) => `${config.purpose}:${config.modelId}`)
              .join('、'),
          },
          {
            name: '模型启用状态',
            status: 'ready',
            message: usableModels
              .map((model) => `${model.name}/${model.platform.name}`)
              .join('、'),
          },
          {
            name: '完整用途覆盖',
            status: missingPurposes.length ? 'warning' : 'ready',
            message: missingPurposes.length
              ? `缺少 ${missingPurposes.join('、')}`
              : 'article_creation 与 topic_selection 均已配置。',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const tableMissing =
        this.isPrismaTableMissingError(error, 'default_model_configs') ||
        this.isPrismaTableMissingError(error, 'ai_models') ||
        this.isPrismaTableMissingError(error, 'ai_platforms');
      return {
        status: tableMissing ? 'warning' : 'missing',
        summary: tableMissing
          ? `本机数据库缺少 AI 模型配置表；微信本机任务可继续，AI 生成类动作会在具体任务中提示配置。原始错误：${message}`
          : `无法读取 AI 默认模型配置：${message}`,
        nextAction: tableMissing
          ? '重启本机助手后会自动补齐 SQLite 表；随后到系统设置同步 Kaypal 模型。'
          : '检查 Prisma 数据库、ai_models、ai_platforms 和 default_model_configs 后重试。',
        checks: [
          {
            name: '默认模型配置读取',
            status: tableMissing ? 'warning' : 'missing',
            message,
          },
        ],
      };
    }
  }

  async withKaypalModelSyncHint(result: {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }) {
    if (!this.kaypalModelSync) {
      return {
        ...result,
        checks: [
          ...result.checks,
          {
            name: 'Kaypal 模型台同步',
            status:
              result.status === 'blocked'
                ? ('blocked' as const)
                : ('warning' as const),
            message: 'KaypalModelSyncService 未注入，不能读取模型台同步状态。',
          },
        ],
      };
    }

    return {
      ...result,
      checks: [
        ...result.checks,
        {
          name: 'Kaypal 模型台同步',
          status:
            result.status === 'blocked'
              ? ('blocked' as const)
              : ('warning' as const),
          message:
            '运行检查只读取 3010 本地默认模型配置，不主动请求 Kaypal 云端模型台；需要同步时请在系统设置里手动触发模型同步。',
        },
      ],
    };
  }

  async checkFileAccess(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction?: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    const runtimePaths = this.resolveLocalRuntimePaths();
    const targets = [
      { name: '本机数据目录', path: runtimePaths.root },
      {
        name: '本机日志目录',
        path: runtimePaths.logs,
      },
      { name: '3011 本地 Runtime 目录', path: runtimePaths.root },
      { name: '发布素材目录', path: runtimePaths.materials },
      { name: '平台账号浏览器档案目录', path: runtimePaths.browserProfiles },
      { name: '互动证据目录', path: runtimePaths.evidence },
    ];
    const checks = await Promise.all(
      targets.map(async (target) => {
        try {
          await mkdir(target.path, { recursive: true });
          const probePath = join(
            target.path,
            `.kaypal-runcheck-${process.pid}-${Date.now()}.probe`,
          );
          await writeFile(probePath, 'ok', 'utf8');
          await rm(probePath, { force: true });
          await access(target.path, constants.R_OK | constants.W_OK);
          return {
            name: target.name,
            status: 'ready' as const,
            message: `${target.path} 可创建、可写入、可删除探针文件`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          return {
            name: target.name,
            status: 'blocked' as const,
            message: `${target.path} 读写探针失败：${message}`,
          };
        }
      }),
    );
    const hasWarning = checks.some((check) => check.status !== 'ready');

    return {
      status: hasWarning ? ('blocked' as const) : ('ready' as const),
      summary: hasWarning
        ? '部分本地目录不可读写，素材、账号状态或证据日志可能无法保存。'
        : '主系统目录、3011 Runtime 目录、素材目录和账号状态目录读写检查通过。',
      nextAction: hasWarning
        ? '请检查目录权限，必要时重新创建缺失目录。'
        : undefined,
      checks,
    };
  }

  async readWechatDesktopStatus() {
    try {
      return await this.autoUploadService.getWechatDesktopStatus();
    } catch (error) {
      return {
        platform: 'wechat',
        available: false,
        running: false,
        appName: '微信',
        windowCount: 0,
        permissionHints: [
          '请确认 3011 本地 Runtime 在线。',
          error instanceof Error ? error.message : '桌面微信状态读取失败',
        ],
        requiresManualTarget: true,
        message: '桌面微信状态读取失败',
      };
    }
  }

  buildDesktopStatus(
    desktop: Awaited<ReturnType<typeof this.readWechatDesktopStatus>>,
    checkedAt: string,
    screenshot?: LocalEngineDesktopScreenshotEvidence,
  ): LocalEngineDesktopStatus {
    const permissionHints = desktop.permissionHints || [];
    const available = desktop.available === true && desktop.running === true;
    const appName = desktop.appName || '微信';
    const rawWindowTitle =
      (
        desktop as {
          currentWindowTitle?: string | null;
          windowTitle?: string | null;
        }
      ).currentWindowTitle ||
      (
        desktop as {
          currentWindowTitle?: string | null;
          windowTitle?: string | null;
        }
      ).windowTitle ||
      null;
    const windowTitles = this.normalizeWindowTitles(desktop);
    const currentWindowTitle = available
      ? rawWindowTitle ||
        windowTitles[0] ||
        `${appName}${desktop.windowCount ? `（${desktop.windowCount} 个窗口）` : ''}`
      : null;
    const windowCount = desktop.windowCount || 0;
    const hintText = permissionHints.join('；');
    const alignmentLockEvidenceReady = this.hasTrustedWechatAlignmentLock();
    const softScreenshotDiagnostic =
      screenshot?.trusted === false &&
      this.isWechatScreenshotSoftDiagnostic(screenshot.diagnostic);
    const screenshotTrusted =
      screenshot?.trusted !== false ||
      (alignmentLockEvidenceReady && softScreenshotDiagnostic);
    const screenshotMismatch =
      screenshot?.trusted === false && !screenshotTrusted;
    const screenshotOk = screenshotTrusted && screenshot?.type === 'screenshot';
    const screenshotSessionDiagnostic =
      screenshot && screenshotTrusted
        ? this.detectWechatScreenshotSessionBlocker(screenshot.textSample)
        : null;
    const inputControlOk =
      (desktop as { inputControlAvailable?: boolean }).inputControlAvailable ===
        true && available;
    const clickControlOk =
      (desktop as { clickControlAvailable?: boolean }).clickControlAvailable ===
        true && available;
    const fileSelectionOk =
      (desktop as { fileSelectionAvailable?: boolean })
        .fileSelectionAvailable === true && available;
    const rawFrontmost = (desktop as { frontmost?: boolean }).frontmost;
    const frontmost =
      typeof rawFrontmost === 'boolean' ? rawFrontmost : available;
    const loggedOut = /未登录|掉线|登录已失效|login expired|not logged/i.test(
      `${desktop.message || ''}；${hintText}`,
    );
    const popupDetected = /弹窗|遮挡|modal|alert|dialog|更新|权限提示/i.test(
      `${desktop.message || ''}；${hintText}`,
    );
    const accessibilityBlocked = permissionHints.some((hint) =>
      /辅助|accessibility/i.test(hint),
    );
    const screenBlocked = permissionHints.some((hint) =>
      /屏幕|screen|录制|recording/i.test(hint),
    );
    const inputBlocked = permissionHints.some((hint) =>
      /输入|点击|键盘|鼠标|input|click|keyboard|mouse/i.test(hint),
    );
    const fileSelectionBlocked = permissionHints.some((hint) =>
      /文件选择|选择文件|素材选择|file.?select|file.?picker/i.test(hint),
    );
    const permissionBlocked =
      !available ||
      accessibilityBlocked ||
      screenBlocked ||
      inputBlocked ||
      fileSelectionBlocked ||
      !inputControlOk ||
      !clickControlOk ||
      !fileSelectionOk;
    const lockedWechatTarget = this.isWechatTargetLocked(currentWindowTitle);
    const contactAmbiguous =
      available &&
      !lockedWechatTarget &&
      (windowCount !== 1 ||
        Boolean(this.wechatSessionConfirmation.targetContact) === false ||
        /搜索|通讯录|微信|WeChat$/i.test(currentWindowTitle || ''));
    const blockers = [
      !desktop.running ? '桌面微信未运行。' : '',
      permissionBlocked ? '桌面微信窗口或控制权限不可用。' : '',
      loggedOut ? '桌面微信可能已掉线或登录失效。' : '',
      screenshot?.trusted === false && !screenshotTrusted
        ? `桌面微信截图证据不可信：${screenshot.diagnostic || '截图内容无法证明是微信窗口。'}`
        : '',
      screenshotSessionDiagnostic
        ? `桌面微信不是可发送目标会话：${screenshotSessionDiagnostic}`
        : '',
      popupDetected && !this.wechatSessionConfirmation.popupCleared
        ? '检测到可能存在弹窗/遮挡。'
        : '',
    ].filter(Boolean);
    const warnings = [
      !screenshotOk ? '未拿到桌面截图证据，商用执行会被阻断。' : '',
      windowCount > 1
        ? `检测到 ${windowCount} 个微信窗口，请人工确认当前目标会话。`
        : '',
      contactAmbiguous ? '联系人信息需要人工核对，避免填错会话。' : '',
      available && !frontmost
        ? '桌面微信当前不是前台 App，执行脚本会在操作前切回微信并再次截图确认。'
        : '',
      this.wechatSessionConfirmation.takeoverActive
        ? '人工接管中，后端暂停自动草稿动作。'
        : '',
    ].filter(Boolean);

    return {
      checkedAt,
      platform: desktop.platform || 'wechat',
      available,
      running: desktop.running === true,
      appName,
      windowCount,
      permissionChecks: [
        {
          key: 'accessibility',
          label: '辅助功能权限',
          status: available && !accessibilityBlocked ? 'ready' : 'blocked',
          message:
            permissionHints.find((hint) => /辅助|accessibility/i.test(hint)) ||
            (available
              ? '桌面服务可检测微信窗口。'
              : '需要开启辅助功能权限或启动桌面微信。'),
          nextAction:
            available && !accessibilityBlocked
              ? undefined
              : '在 macOS 系统设置中允许终端/本地引擎控制电脑。',
        },
        {
          key: 'screen-recording',
          label: '屏幕录制权限',
          status:
            !screenBlocked && (screenshotOk || screenshotMismatch)
              ? 'ready'
              : 'blocked',
          message: screenshotOk
            ? screenshot?.trusted === false
              ? '已保存桌面截图；OCR 未识别文字，但自动对齐证据已锁定目标微信会话。'
              : screenshot?.type === 'screenshot'
                ? '已保存桌面截图证据。'
                : '桌面截图能力已通过。'
            : screenshotMismatch
              ? '屏幕录制可返回截图，但截图内容不是可验证的微信会话窗口。'
              : '未拿到桌面截图，回放证据会降级为文本记录。',
          nextAction:
            !screenBlocked && (screenshotOk || screenshotMismatch)
              ? undefined
              : '在 macOS 系统设置中允许屏幕录制后重试。',
        },
        {
          key: 'automation',
          label: '自动化控制权限',
          status: inputControlOk && clickControlOk ? 'ready' : 'blocked',
          message: available
            ? '当前只允许填入草稿，不点击发送。'
            : '微信窗口不可用，无法执行草稿填入。',
        },
        {
          key: 'clipboard',
          label: '剪贴板/输入权限',
          status: inputControlOk && !inputBlocked ? 'ready' : 'blocked',
          message:
            inputControlOk && !inputBlocked
              ? '草稿填入前必须人工确认当前会话。'
              : '微信窗口或输入权限不可用，不能写入草稿。',
        },
        {
          key: 'foreground-app',
          label: '前台 App',
          status: frontmost || available ? 'ready' : 'blocked',
          message: frontmost
            ? `${appName} 当前可作为前台候选。`
            : available
              ? '微信已运行；网页操作会把浏览器置前，执行时会切回微信。'
              : '无法确认微信处于前台。',
          nextAction:
            frontmost || available
              ? undefined
              : '请把桌面微信切到前台目标会话后重试。',
        },
        {
          key: 'window-list',
          label: '窗口列表',
          status:
            available && windowCount === 1
              ? 'ready'
              : available
                ? 'warning'
                : 'blocked',
          message: windowTitles.length
            ? `检测到窗口：${windowTitles.join('、')}`
            : available
              ? `检测到 ${windowCount} 个微信窗口。`
              : '未读取到微信窗口列表。',
          nextAction:
            available && windowCount === 1
              ? undefined
              : '请保留一个目标微信窗口，并人工确认窗口标题。',
        },
        {
          key: 'screenshot',
          label: '截图能力',
          status: screenshotOk ? 'ready' : 'blocked',
          message: screenshotOk
            ? '截图证据可用。'
            : screenshot?.trusted === false
              ? screenshot.diagnostic || '截图内容无法证明是微信窗口。'
              : '截图能力不可用，无法留存商用执行证据。',
        },
        {
          key: 'input-control',
          label: '输入能力',
          status: inputControlOk && !inputBlocked ? 'ready' : 'blocked',
          message:
            inputControlOk && !inputBlocked
              ? '可执行草稿输入预检。'
              : '无法确认键盘输入/粘贴能力。',
        },
        {
          key: 'click-control',
          label: '点击能力',
          status: clickControlOk && !inputBlocked ? 'ready' : 'blocked',
          message:
            clickControlOk && !inputBlocked
              ? '可执行窗口聚焦/定位类点击预检，不允许自动发送。'
              : '无法确认鼠标点击能力。',
        },
        {
          key: 'file-selection',
          label: '文件选择能力',
          status:
            fileSelectionOk && !fileSelectionBlocked ? 'ready' : 'blocked',
          message:
            fileSelectionOk && !fileSelectionBlocked
              ? '素材/文件选择预检可用，仍需人工确认目标窗口。'
              : '无法确认文件选择器或素材选择能力，不能执行带附件/素材的微信桌面任务。',
          nextAction:
            fileSelectionOk && !fileSelectionBlocked
              ? undefined
              : '请确认 Agent-S/local-controller 已接入文件选择预检，并授予必要的文件访问权限。',
        },
        {
          key: 'manual-takeover',
          label: '人工接管',
          status: 'ready',
          message: this.wechatSessionConfirmation.takeoverActive
            ? '人工接管已开启，自动草稿动作暂停。'
            : '人工接管开关可用，可随时暂停自动草稿动作。',
        },
        {
          key: 'stop-control',
          label: '停止任务',
          status: 'ready',
          message: this.wechatSessionConfirmation.stoppedAt
            ? `微信会话已停止：${this.wechatSessionConfirmation.stopReason || '用户停止'}`
            : '停止任务开关可用，会清空窗口/联系人确认。',
        },
      ],
      window: {
        appName,
        windowTitle: currentWindowTitle,
        bundleId: (desktop as { bundleId?: string | null }).bundleId || null,
        isWechat: available,
        running: desktop.running === true,
        frontmost,
        windowCount,
        windowTitles,
        currentWindowTitle,
        currentWindowLikelyWechatChat:
          available &&
          !screenshotSessionDiagnostic &&
          (lockedWechatTarget || (windowCount === 1 && !contactAmbiguous)),
        contactHint: this.wechatSessionConfirmation.targetContact || null,
        currentWindowConfirmed:
          this.wechatSessionConfirmation.currentWindowConfirmed === true,
        targetContact: this.wechatSessionConfirmation.targetContact,
        contactConfirmed:
          this.wechatSessionConfirmation.contactConfirmed === true,
        message: screenshotSessionDiagnostic
          ? screenshotSessionDiagnostic
          : contactAmbiguous
            ? '需要人工确认当前窗口就是目标会话。'
            : '当前窗口可作为微信会话候选。',
        checkedAt,
      },
      screenshot,
      recentEvidence: this.desktopEvidence.slice(-10).reverse(),
      blockers,
      warnings,
      safetyBoundary: {
        draftOnly: desktop.safetyBoundary?.draftOnly ?? true,
        requiresManualTarget: desktop.requiresManualTarget ?? true,
        requiresManualSend: true,
        readsPrivateChats: desktop.safetyBoundary?.readsPrivateChats ?? false,
        sendsMessages: desktop.safetyBoundary?.sendsMessages ?? false,
      },
      takeover: {
        available,
        active: this.wechatSessionConfirmation.takeoverActive === true,
        message: this.wechatSessionConfirmation.takeoverActive
          ? '人工接管中，后端不会继续自动填入。'
          : '可点击人工接管暂停自动动作。',
      },
      takeoverActive: this.wechatSessionConfirmation.takeoverActive === true,
      stopped: Boolean(this.wechatSessionConfirmation.stoppedAt),
      message: desktop.message,
      nextAction: available
        ? '请确认当前微信窗口、联系人和草稿内容后再填入草稿。'
        : '请先打开桌面微信并授予辅助功能/屏幕录制权限。',
    };
  }

  detectWechatSessionAnomalies(desktop: LocalEngineDesktopStatus) {
    const joined = [
      desktop.message,
      desktop.window.currentWindowTitle || '',
      ...desktop.blockers,
      ...desktop.warnings,
      ...desktop.permissionChecks.map((check) => check.message),
    ].join('；');
    const permissionBlocked = desktop.permissionChecks.some(
      (check) => check.status === 'blocked',
    );

    return {
      loggedOut: /未登录|掉线|登录已失效|login expired|not logged/i.test(
        joined,
      ),
      popupDetected: /弹窗|遮挡|modal|alert|dialog|更新|权限提示/i.test(joined),
      contactAmbiguous:
        !this.isWechatTargetLocked(desktop.window.currentWindowTitle) &&
        (desktop.window.windowCount !== 1 ||
          !this.wechatSessionConfirmation.targetContact ||
          /搜索|通讯录|微信|WeChat$/i.test(
            desktop.window.currentWindowTitle || '',
          )),
      permissionBlocked,
    };
  }

  isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus) {
    if (!desktop.available || !desktop.running) return false;
    const hardBlocker = desktop.blockers.some((blocker) =>
      /未运行|掉线|登录失效|登录|权限|不可用|不可信|不是可发送目标会话|弹窗|遮挡/.test(
        blocker,
      ),
    );
    if (hardBlocker) return false;
    const requiredPermissionKeys: LocalEngineDesktopPermissionKey[] = [
      'accessibility',
      'screen-recording',
      'automation',
      'clipboard',
      'screenshot',
      'input-control',
      'click-control',
      'file-selection',
    ];
    return requiredPermissionKeys.every((key) =>
      desktop.permissionChecks.some(
        (check) => check.key === key && check.status === 'ready',
      ),
    );
  }

  hasWechatControlSurfaceEvidence(desktop: LocalEngineDesktopStatus) {
    if (!desktop.available || desktop.takeoverActive || desktop.stopped) {
      return false;
    }
    if (desktop.screenshot?.type !== 'screenshot') {
      return false;
    }
    if (desktop.screenshot.trusted === false) {
      return false;
    }
    if (
      this.detectWechatScreenshotSessionBlocker(desktop.screenshot.textSample)
    ) {
      return false;
    }
    const normalized = String(desktop.screenshot.textSample || '').replace(
      /\s+/g,
      '',
    );
    const controlMarkers = [
      '搜索',
      '聊天',
      '发送',
      '语音输入',
      '表情',
      '通讯录',
      '订阅号',
      '服务号',
      '朋友圈',
    ];
    const titleLooksLikeWechat = /微信|WeChat/i.test(
      desktop.window.currentWindowTitle || desktop.window.windowTitle || '',
    );
    return (
      titleLooksLikeWechat ||
      controlMarkers.some((marker) => normalized.includes(marker))
    );
  }

  hasRunnableWechatWindowEvidence(desktop: LocalEngineDesktopStatus) {
    if (!desktop.available || desktop.blockers.length > 0) return false;
    if (desktop.takeoverActive || desktop.stopped) return false;
    if (desktop.window.windowCount > 1) return false;
    if (desktop.screenshot?.type !== 'screenshot') return false;
    if (desktop.screenshot.trusted === false) return false;
    if (
      this.detectWechatScreenshotSessionBlocker(desktop.screenshot.textSample)
    ) {
      return false;
    }
    const normalized = String(desktop.screenshot.textSample || '').replace(
      /\s+/g,
      '',
    );
    const strongMarkers = [
      '搜索',
      '聊天',
      '群',
      '发送',
      '语音输入',
      '表情',
      '通讯录',
      '订阅号',
      '服务号',
      '朋友圈',
    ];
    const hasStrongMarker = strongMarkers.some((marker) =>
      normalized.includes(marker),
    );
    const genericSingleWechatWindow =
      /^(微信|WeChat)$/i.test(desktop.window.currentWindowTitle || '') &&
      desktop.window.windowCount === 1;
    return hasStrongMarker || genericSingleWechatWindow;
  }

  isWechatTargetLocked(currentWindowTitle?: string | null) {
    const targetContact = this.wechatSessionConfirmation.targetContact?.trim();
    if (!targetContact) return false;
    if (
      this.wechatSessionConfirmation.currentWindowConfirmed !== true ||
      this.wechatSessionConfirmation.contactConfirmed !== true ||
      this.wechatSessionConfirmation.draftBeforeFillConfirmed !== true
    ) {
      return false;
    }
    const lockedTitle =
      this.wechatSessionConfirmation.lockedWindowTitle?.trim();
    const candidates = [currentWindowTitle, lockedTitle]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    if (!candidates.length) return false;
    const titleMatchesTarget = candidates.some(
      (title) =>
        title.includes(targetContact) ||
        targetContact.includes(title) ||
        (Boolean(lockedTitle) && title === lockedTitle),
    );
    if (titleMatchesTarget) return true;

    const hasCapturedLock = Boolean(
      this.wechatSessionConfirmation.lockCapturedAt,
    );
    const singleGenericWechatWindow =
      candidates.length === 1 && /^(微信|WeChat)$/i.test(candidates[0]);
    return (
      hasCapturedLock &&
      this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
      singleGenericWechatWindow
    );
  }

  buildDesktopCommercialPreflight(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineDesktopCommercialPreflight {
    const requiredKeys = new Set([
      'accessibility',
      'screen-recording',
      'foreground-app',
      'window-list',
      'screenshot',
      'input-control',
      'click-control',
      'file-selection',
      'manual-takeover',
      'stop-control',
    ]);
    const requiredChecks = desktop.permissionChecks.filter((check) =>
      requiredKeys.has(check.key),
    );
    const windowEvidenceRunnable =
      this.hasRunnableWechatWindowEvidence(desktop);
    const blockers = [
      ...desktop.blockers,
      ...requiredChecks
        .filter((check) => check.status === 'blocked')
        .map((check) => `${check.label}不可用：${check.message}`),
      !desktop.window.currentWindowLikelyWechatChat && !windowEvidenceRunnable
        ? '无法确认当前前台窗口是唯一微信目标会话。'
        : '',
      desktop.takeoverActive ? '人工接管中，禁止自动填入草稿。' : '',
      desktop.stopped ? '微信桌面任务已停止，禁止继续执行。' : '',
    ].filter(Boolean);
    const warnings = [
      ...desktop.warnings,
      !desktop.window.currentWindowLikelyWechatChat && windowEvidenceRunnable
        ? '已取得可信微信窗口证据，但当前未锁定具体联系人；商用测试账号按受控执行风险提示继续。'
        : '',
      ...requiredChecks
        .filter((check) => check.status === 'warning')
        .map((check) => `${check.label}需要人工确认：${check.message}`),
    ];
    const allowed = blockers.length === 0;

    return {
      allowed,
      checkedAt: new Date().toISOString(),
      requiredFor: [
        'wechat-reply-draft',
        'wechat-group-broadcast',
        'wechat-contact-add',
        'wechat-moments-publish',
        'wechat-moments-marketing',
      ],
      blockers,
      warnings,
      checks: requiredChecks,
      window: desktop.window,
      screenshot: desktop.screenshot,
      takeoverReady: desktop.permissionChecks.some(
        (check) => check.key === 'manual-takeover' && check.status === 'ready',
      ),
      stopReady: desktop.permissionChecks.some(
        (check) => check.key === 'stop-control' && check.status === 'ready',
      ),
      message: allowed
        ? '桌面微信商用 preflight 通过：权限、前台窗口、截图、输入/点击、接管和停止能力均可用。'
        : `桌面微信商用 preflight 阻断：${blockers[0] || '存在未知阻断项'}`,
      nextAction: allowed
        ? '可进入人工确认；系统仍只填入草稿，不自动发送。'
        : blockers[0] || '请修复桌面权限和窗口状态后重试。',
    };
  }

  normalizeWindowTitles(desktop: {
    windowTitles?: string[];
    currentWindowTitle?: string | null;
    windowTitle?: string | null;
  }) {
    const values = [
      ...(Array.isArray(desktop.windowTitles) ? desktop.windowTitles : []),
      desktop.currentWindowTitle,
      desktop.windowTitle,
    ];

    return [
      ...new Set(
        values.map((value) => value?.trim()).filter(Boolean) as string[],
      ),
    ];
  }

  async captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence> {
    if (platform() !== 'darwin') {
      return {
        type: 'text',
        label,
        value: `当前系统 ${platform()} 不支持桌面截图。`,
        capturedAt: new Date().toISOString(),
      };
    }

    const evidenceDir = join(this.getProjectLogRoot(), 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    const capturedAt = new Date();
    const filename = `desktop-wechat-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
    const screenshotPath = join(evidenceDir, filename);
    const frame = await this.readWechatWindowFrame();
    if (!frame) {
      return {
        type: 'text',
        label,
        value: '未读取到可截图的桌面微信主窗口；已拒绝抓取全屏作为微信证据。',
        capturedAt: capturedAt.toISOString(),
        trusted: false,
        diagnostic: '未读取到桌面微信主窗口，不能把全屏截图当作微信会话证据。',
      };
    }
    if (frame.shareable === false) {
      return {
        type: 'text',
        label,
        value:
          '桌面微信主窗口当前禁止屏幕采集或内容不可见；已拒绝把下层窗口截图当作微信证据。',
        capturedAt: capturedAt.toISOString(),
        trusted: false,
        diagnostic:
          '桌面微信主窗口当前禁止屏幕采集或内容不可见，不能确认是真实微信会话窗口。',
      };
    }

    await this.runCommand(
      'screencapture',
      frame.windowId
        ? ['-x', '-l', String(frame.windowId), screenshotPath]
        : [
            '-x',
            '-R',
            `${frame.x},${frame.y},${frame.width},${frame.height}`,
            screenshotPath,
          ],
      3000,
    );
    const textSample = await this.readDesktopScreenshotText(screenshotPath);
    const diagnostic =
      textSample.trim().length === 0
        ? '当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。'
        : this.detectWechatScreenshotMismatch(textSample);
    return {
      type: 'screenshot',
      label,
      value: screenshotPath,
      capturedAt: capturedAt.toISOString(),
      trusted: diagnostic ? false : true,
      diagnostic: diagnostic || undefined,
      textSample: textSample || undefined,
    };
  }

  async readWechatWindowFrame(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    if (platform() !== 'darwin') {
      return null;
    }
    const coreGraphicsFrame =
      await this.readWechatWindowFrameFromCoreGraphics();
    if (coreGraphicsFrame) {
      return coreGraphicsFrame;
    }
    return this.readWechatWindowFrameFromAccessibility();
  }

  async readWechatWindowFrameFromAccessibility(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    const script = [
      'tell application "System Events"',
      'tell process "微信"',
      'repeat with appWindow in windows',
      'set windowNameText to ""',
      'set windowDescriptionText to ""',
      'set windowPositionValue to {0, 0}',
      'set windowSizeValue to {0, 0}',
      'try',
      'set windowNameText to name of appWindow as text',
      'end try',
      'try',
      'set windowDescriptionText to description of appWindow as text',
      'end try',
      'try',
      'set windowPositionValue to position of appWindow',
      'set windowSizeValue to size of appWindow',
      'end try',
      'if (item 1 of windowSizeValue) > 200 and (item 2 of windowSizeValue) > 200 and (windowNameText is "微信" or windowDescriptionText is "标准窗口") then',
      'return (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
      'end if',
      'end repeat',
      'end tell',
      'end tell',
      'return ""',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      const values = String(stdout || '')
        .trim()
        .split(',')
        .map((value) => Number.parseInt(value, 10));
      if (
        values.length !== 4 ||
        values.some((value) => Number.isNaN(value) || value < 0)
      ) {
        return null;
      }
      const [x, y, width, height] = values;
      const windowInfo = await this.readWechatWindowCaptureInfo({
        x,
        y,
        width,
        height,
      });
      return {
        x,
        y,
        width,
        height,
        windowId: windowInfo?.windowId,
        shareable: windowInfo?.shareable,
      };
    } catch {
      return null;
    }
  }

  async readWechatWindowFrameFromCoreGraphics(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    const swiftSource = [
      'import Foundation',
      'import CoreGraphics',
      'struct Candidate { let title: String; let owner: String; let id: Int; let x: Int; let y: Int; let width: Int; let height: Int; let shareable: Bool? }',
      'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
      'var candidates = [Candidate]()',
      'for window in windows {',
      '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
      '  let title = window[kCGWindowName as String] as? String ?? ""',
      '  guard owner.contains("微信") || owner.contains("WeChat") || title.contains("微信") || title.contains("WeChat") else { continue }',
      '  let layer = window[kCGWindowLayer as String] as? Int ?? 0',
      '  guard layer == 0 else { continue }',
      '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
      '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? 0))',
      '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? 0))',
      '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? 0))',
      '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? 0))',
      '  guard width >= 240 && height >= 240 else { continue }',
      '  let id = window[kCGWindowNumber as String] as? Int ?? 0',
      '  guard id > 0 else { continue }',
      '  let sharing = window[kCGWindowSharingState as String] as? Int ?? -1',
      '  let shareable: Bool? = sharing < 0 ? nil : sharing > 0',
      '  candidates.append(Candidate(title: title, owner: owner, id: id, x: x, y: y, width: width, height: height, shareable: shareable))',
      '}',
      'func rank(_ item: Candidate) -> Int {',
      '  let title = item.title.isEmpty ? item.owner : item.title',
      '  if item.title == "微信 (窗口)" || item.title == "微信" || item.title == "WeChat" { return 4 }',
      '  if item.title.contains("朋友圈") { return 3 }',
      '  if item.title.isEmpty { return 1 }',
      '  return 1',
      '}',
      'if let best = candidates.sorted(by: {',
      '  let leftRank = rank($0)',
      '  let rightRank = rank($1)',
      '  if leftRank != rightRank { return leftRank > rightRank }',
      '  let leftShareable = ($0.shareable ?? true) ? 1 : 0',
      '  let rightShareable = ($1.shareable ?? true) ? 1 : 0',
      '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
      '  return ($0.width * $0.height) > ($1.width * $1.height)',
      '}).first {',
      '  print([String(best.x), String(best.y), String(best.width), String(best.height), String(best.id), best.shareable == false ? "blocked" : "shareable"].joined(separator: ","))',
      '}',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync('swift', ['-e', swiftSource], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const [xRaw, yRaw, widthRaw, heightRaw, idRaw, stateRaw] = String(
        stdout || '',
      )
        .trim()
        .split(',');
      const values = [xRaw, yRaw, widthRaw, heightRaw].map((value) =>
        Number.parseInt(value || '', 10),
      );
      if (
        values.length !== 4 ||
        values.some((value) => Number.isNaN(value) || value < 0)
      ) {
        return null;
      }
      const windowId = Number.parseInt(idRaw || '', 10);
      return {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
        windowId:
          Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
        shareable:
          stateRaw?.trim() === 'blocked'
            ? false
            : stateRaw?.trim() === 'shareable'
              ? true
              : undefined,
      };
    } catch {
      return null;
    }
  }

  async readWechatWindowCaptureInfo(frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ windowId?: number; shareable?: boolean } | null> {
    const swiftSource = [
      'import Foundation',
      'import CoreGraphics',
      'let args = CommandLine.arguments',
      'guard args.count >= 5,',
      '  let expectedX = Int(args[1]),',
      '  let expectedY = Int(args[2]),',
      '  let expectedWidth = Int(args[3]),',
      '  let expectedHeight = Int(args[4]) else { exit(2) }',
      'struct Candidate { let title: String; let owner: String; let id: Int; let sharing: Int?; let area: Int }',
      'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
      'var candidates = [Candidate]()',
      'for window in windows {',
      '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
      '  let name = window[kCGWindowName as String] as? String ?? ""',
      '  guard owner.contains("微信") || owner.contains("WeChat") || name.contains("微信") || name.contains("WeChat") else { continue }',
      '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
      '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? -1))',
      '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? -1))',
      '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? -1))',
      '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? -1))',
      '  guard abs(x - expectedX) <= 2, abs(y - expectedY) <= 2, abs(width - expectedWidth) <= 2, abs(height - expectedHeight) <= 2 else { continue }',
      '  let windowId = window[kCGWindowNumber as String] as? Int ?? 0',
      '  guard windowId > 0 else { continue }',
      '  let sharingState = window[kCGWindowSharingState as String] as? Int',
      '  candidates.append(Candidate(title: name, owner: owner, id: windowId, sharing: sharingState, area: width * height))',
      '}',
      'func rank(_ item: Candidate) -> Int {',
      '  let title = item.title.isEmpty ? item.owner : item.title',
      '  if title == "微信 (窗口)" || title == "微信" || title == "WeChat" { return 4 }',
      '  if item.title.isEmpty { return 1 }',
      '  if title.contains("微信") || title.contains("WeChat") { return 2 }',
      '  return 0',
      '}',
      'if let best = candidates.sorted(by: {',
      '  let leftRank = rank($0)',
      '  let rightRank = rank($1)',
      '  if leftRank != rightRank { return leftRank > rightRank }',
      '  let leftShareable = ($0.sharing ?? 1) > 0 ? 1 : 0',
      '  let rightShareable = ($1.sharing ?? 1) > 0 ? 1 : 0',
      '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
      '  return $0.area > $1.area',
      '}).first {',
      '  let state = best.sharing == nil ? "unknown" : ((best.sharing ?? 0) > 0 ? "shareable" : "blocked")',
      '  print("\\(best.id),\\(state)")',
      '} else {',
      '  print("0,unknown")',
      '}',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync(
        'swift',
        [
          '-e',
          swiftSource,
          String(frame.x),
          String(frame.y),
          String(frame.width),
          String(frame.height),
        ],
        {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        },
      );
      const [idRaw, stateRaw] = String(stdout || '')
        .trim()
        .split(',');
      const windowId = Number.parseInt(idRaw || '', 10);
      const state = stateRaw?.trim();
      return {
        windowId:
          Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
        shareable:
          state === 'blocked'
            ? false
            : state === 'shareable'
              ? true
              : undefined,
      };
    } catch {
      return null;
    }
  }

  async readDesktopScreenshotText(imagePath: string): Promise<string> {
    if (!imagePath || !existsSync(imagePath) || platform() !== 'darwin') {
      return '';
    }
    const swiftSource = [
      'import Foundation',
      'import Vision',
      'import AppKit',
      'let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""',
      'let url = URL(fileURLWithPath: path)',
      'guard let image = NSImage(contentsOf: url), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let cg = bitmap.cgImage else { exit(0) }',
      'var output = [String]()',
      'let request = VNRecognizeTextRequest { request, error in',
      '  if error != nil { return }',
      '  output = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { $0.topCandidates(1).first?.string }',
      '}',
      'request.recognitionLanguages = ["zh-Hans", "en-US"]',
      'request.recognitionLevel = .accurate',
      'request.usesLanguageCorrection = true',
      'let handler = VNImageRequestHandler(cgImage: cg, options: [:])',
      'try? handler.perform([request])',
      'print(output.joined(separator: "\\n"))',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync(
        'swift',
        ['-e', swiftSource, imagePath],
        {
          timeout: 15000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      return String(stdout || '')
        .trim()
        .slice(0, 1200);
    } catch {
      return '';
    }
  }

  detectWechatScreenshotMismatch(textSample: string): string | null {
    const normalized = textSample.replace(/\s+/g, '');
    if (!normalized) {
      return null;
    }
    const browserMarkers = [
      'codex.maynor1024.live',
      'test.kaypal.cn/api/desktop-auth/authorize',
      'desktop-auth/authorize',
      '已允许连接',
      '可以回到KaypalDesktop',
      'KaypalDesktop',
      'Kaypal内容工作台',
      '豆包',
      '扣子空间',
      'DeepSeek',
      'MiniMax',
      'nuwax-ai',
      '我的订阅',
      'API密钥',
      'API-Red',
      '使用记录',
      '渠道状态',
      'OpenAI',
      'Chrome',
      '所有书签',
      '微信公众平台',
      'localhost:3010',
      '127.0.0.1:3010',
    ];
    const decisiveBrowserMarkers = [
      'codex.maynor1024.live',
      'test.kaypal.cn/api/desktop-auth/authorize',
      'desktop-auth/authorize',
      '已允许连接',
      '可以回到KaypalDesktop',
      'KaypalDesktop',
      'Kaypal内容工作台',
    ];
    const strongWechatMarkers = [
      '文件传输助手',
      '通讯录',
      '朋友圈',
      '聊天信息',
      '订阅号',
      '服务号',
      '群聊',
      '发送',
      '语音输入',
      '表情',
    ];
    const looksLikeBrowser = browserMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    const hasDecisiveBrowserMarker = decisiveBrowserMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    const looksLikeWechat = strongWechatMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    if (looksLikeBrowser && (hasDecisiveBrowserMarker || !looksLikeWechat)) {
      if (normalized.includes('codex.maynor1024.live')) {
        return '当前截图识别到浏览器订阅页内容，不是可验证的微信会话窗口。';
      }
      if (
        normalized.includes('desktop-auth/authorize') ||
        normalized.includes('已允许连接') ||
        normalized.includes('可以回到KaypalDesktop')
      ) {
        return '当前截图识别到 Kaypal 授权页内容，不是可验证的微信会话窗口。';
      }
      return '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。';
    }
    return null;
  }

  hasTrustedWechatAlignmentLock() {
    const alignment = this.wechatSessionConfirmation.alignment;
    return (
      alignment?.ok === true &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      Boolean(
        alignment.pageTextSample?.trim() || alignment.screenshotPath?.trim(),
      )
    );
  }

  isWechatScreenshotSoftDiagnostic(diagnostic?: string | null) {
    const value = String(diagnostic || '');
    if (!value.trim()) return false;
    return (
      /没有识别到可验证内容|OCR|文字/.test(value) &&
      !/浏览器|授权页|登录|二维码|文件传输助手|下层窗口|不可见/.test(value)
    );
  }

  detectWechatScreenshotSessionBlocker(
    textSample?: string | null,
  ): string | null {
    const normalized = String(textSample || '').replace(/\s+/g, '');
    if (!normalized) {
      return null;
    }
    if (
      normalized.includes('微信文件传输助手网页版') ||
      (normalized.includes('文件传输助手') &&
        (normalized.includes('网页版') || normalized.includes('二维码')))
    ) {
      return '当前是微信文件传输助手网页版二维码，不是桌面微信聊天会话。';
    }
    if (
      normalized.includes('进入微信') ||
      normalized.includes('切换账号') ||
      normalized.includes('仅传输文件')
    ) {
      return '当前停在微信登录/选择账号页，不是桌面微信聊天会话。';
    }
    if (
      normalized.includes('扫码登录') ||
      normalized.includes('请使用微信扫描二维码') ||
      normalized.includes('二维码登录')
    ) {
      return '当前停在扫码登录页，不是桌面微信聊天会话。';
    }
    return null;
  }

  runCommand(command: string, args: string[], timeoutMs: number) {
    return new Promise<void>((resolveResult, rejectResult) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectResult(new Error(`${command} 执行超时`));
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectResult(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolveResult();
          return;
        }
        rejectResult(new Error(`${command} 退出码 ${code}`));
      });
    });
  }

  rememberDesktopEvidence(evidence?: LocalEngineDesktopScreenshotEvidence) {
    if (!evidence) {
      return;
    }
    this.desktopEvidence.push(evidence);
    if (this.desktopEvidence.length > 30) {
      this.desktopEvidence.splice(0, this.desktopEvidence.length - 30);
    }
  }

  resolveLocalRuntimePaths() {
    const root = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim()
      ? resolveRuntimeStateRoot()
      : getProjectRoot();
    const paths = {
      root,
      materials:
        this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
        join(root, 'data', 'materials'),
      cookies:
        this.configService.get<string>('AUTO_UPLOAD_COOKIES_DIR') ||
        join(root, 'data', 'cookiesFile'),
      browserProfiles:
        this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
        resolveProjectDataPath('browser-profiles'),
      evidence:
        this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
        join(this.getProjectLogRoot(), 'browser-evidence'),
      avatars:
        this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
        join(root, 'data', 'avatars'),
      logs: this.getProjectLogRoot(),
    };
    for (const path of [
      paths.materials,
      paths.cookies,
      paths.browserProfiles,
      paths.evidence,
      paths.avatars,
      paths.logs,
    ]) {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    }
    return paths;
  }

  async inspectPath(target: {
    key: string;
    name: string;
    path: string;
    note?: string;
  }): Promise<LocalEngineFileAccessItem> {
    let pathStat: Awaited<ReturnType<typeof stat>> | null = null;
    let readable = false;
    let writable = false;

    try {
      pathStat = await stat(target.path);
    } catch {
      return {
        key: target.key,
        name: target.name,
        path: target.path,
        exists: false,
        readable: false,
        writable: false,
        kind: 'missing',
        note: target.note,
        recentFiles: [],
      };
    }

    try {
      await access(target.path, constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }

    try {
      await access(target.path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    const kind = pathStat.isDirectory()
      ? 'directory'
      : pathStat.isFile()
        ? 'file'
        : 'unknown';
    const item: LocalEngineFileAccessItem = {
      key: target.key,
      name: target.name,
      path: target.path,
      exists: true,
      readable,
      writable,
      kind,
      sizeBytes: pathStat.isFile() ? pathStat.size : undefined,
      updatedAt: pathStat.mtime.toISOString(),
      note: target.note,
      recentFiles: [],
    };

    if (pathStat.isDirectory() && readable) {
      try {
        const entries = await readdir(target.path, { withFileTypes: true });
        item.fileCount = entries.filter((entry) => entry.isFile()).length;
        item.directoryCount = entries.filter((entry) =>
          entry.isDirectory(),
        ).length;
        const recentEntries = await Promise.all(
          entries
            .filter((entry) => !entry.name.startsWith('.'))
            .slice(0, 80)
            .map(async (entry) => {
              const entryPath = join(target.path, entry.name);
              try {
                const entryStat = await stat(entryPath);
                return {
                  name: entry.name,
                  path: entryPath,
                  kind: entry.isDirectory()
                    ? ('directory' as const)
                    : entry.isFile()
                      ? ('file' as const)
                      : ('unknown' as const),
                  sizeBytes: entryStat.isFile() ? entryStat.size : undefined,
                  updatedAt: entryStat.mtime.toISOString(),
                };
              } catch {
                return {
                  name: entry.name,
                  path: entryPath,
                  kind: 'unknown' as const,
                  updatedAt: null,
                };
              }
            }),
        );
        item.recentFiles = recentEntries
          .sort((left, right) =>
            (right.updatedAt || '').localeCompare(left.updatedAt || ''),
          )
          .slice(0, 5);
      } catch {
        item.recentFiles = [];
      }
    }

    return item;
  }

  checkDesktopControl() {
    const currentPlatform = platform();

    if (currentPlatform === 'darwin') {
      return this.checkMacOSDesktopControl();
    } else if (currentPlatform === 'win32') {
      return this.checkWindowsDesktopControl();
    } else if (currentPlatform === 'linux') {
      return this.checkLinuxDesktopControl();
    }

    return {
      status: 'warning' as const,
      summary: `当前系统 ${currentPlatform} 暂不支持桌面控制。`,
      nextAction: '桌面控制目前仅支持 macOS、Windows 和 Linux 系统。',
      checks: [
        {
          name: '操作系统',
          status: 'warning' as const,
          message: `当前系统：${currentPlatform}，不在支持列表中。`,
        },
      ],
    };
  }

  checkMacOSDesktopControl() {
    const hasAccessibility = this.checkMacOSAccessibility();
    const hasScreenRecording = this.checkMacOSScreenRecording();
    const allPermissionsGranted = hasAccessibility && hasScreenRecording;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'macOS 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 macOS 环境，需要用户授予辅助功能和屏幕录制权限。',
      nextAction: allPermissionsGranted
        ? ''
        : '请在 macOS 系统设置 > 隐私与安全性 中授予"辅助功能"和"屏幕录制"权限，然后刷新此页面。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'macOS，可接入桌面控制。',
        },
        {
          name: '辅助功能权限',
          status: hasAccessibility ? 'ready' : 'warning',
          message: hasAccessibility
            ? '辅助功能权限已授予。'
            : '请在 系统设置 > 隐私与安全性 > 辅助功能 中勾选本应用。',
        },
        {
          name: '屏幕录制权限',
          status: hasScreenRecording ? 'ready' : 'warning',
          message: hasScreenRecording
            ? '屏幕录制权限已授予。'
            : '请在 系统设置 > 隐私与安全性 > 屏幕录制 中勾选本应用。',
        },
      ],
    };
  }

  checkWindowsDesktopControl() {
    const hasUIAutomation = this.checkWindowsUIAutomation();
    const hasScreenCapture = this.checkWindowsScreenCapture();
    const allPermissionsGranted = hasUIAutomation && hasScreenCapture;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'Windows 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 Windows 环境，需要检查 UI Automation 和屏幕捕获权限。',
      nextAction: allPermissionsGranted
        ? ''
        : '请确保以管理员身份运行本应用，并在 Windows 安全中心允许屏幕捕获。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'Windows，可接入桌面控制。',
        },
        {
          name: 'UI Automation',
          status: hasUIAutomation ? 'ready' : 'warning',
          message: hasUIAutomation
            ? 'UI Automation 接口可用。'
            : '请确保以管理员身份运行本应用，以启用 UI Automation 接口。',
        },
        {
          name: '屏幕捕获',
          status: hasScreenCapture ? 'ready' : 'warning',
          message: hasScreenCapture
            ? '屏幕捕获权限已授予。'
            : '请在 Windows 安全中心 > 隐私 > 屏幕捕获 中允许本应用。',
        },
      ],
    };
  }

  checkLinuxDesktopControl() {
    const hasX11 = this.checkLinuxX11();
    const hasXdotool = this.checkLinuxXdotool();
    const allPermissionsGranted = hasX11 && hasXdotool;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'Linux 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 Linux 环境，需要检查 X11/Wayland 和 xdotool 工具。',
      nextAction: allPermissionsGranted
        ? ''
        : '请确保已安装 xdotool（sudo apt install xdotool）并在 X11 会话中运行。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'Linux，可接入桌面控制。',
        },
        {
          name: 'X11/Wayland',
          status: hasX11 ? 'ready' : 'warning',
          message: hasX11
            ? 'X11 显示服务器可用。'
            : '请确保在 X11 会话中运行（Wayland 支持有限）。',
        },
        {
          name: 'xdotool 工具',
          status: hasXdotool ? 'ready' : 'warning',
          message: hasXdotool
            ? 'xdotool 已安装。'
            : '请安装 xdotool：sudo apt install xdotool',
        },
      ],
    };
  }

  checkMacOSAccessibility(): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync('tccutil list | grep -i accessibility', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return result.includes('kTCCServiceAccessibility');
    } catch {
      return false;
    }
  }

  checkMacOSScreenRecording(): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync('tccutil list | grep -i screen', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return result.includes('kTCCServiceScreenCapture');
    } catch {
      return false;
    }
  }

  checkWindowsUIAutomation(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(
        'powershell -Command "Add-Type -AssemblyName UIAutomationClient"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
      );
      return true;
    } catch {
      return false;
    }
  }

  checkWindowsScreenCapture(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(
        'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
      );
      return true;
    } catch {
      return false;
    }
  }

  checkLinuxX11(): boolean {
    try {
      const { execSync } = require('child_process');
      const display = process.env.DISPLAY;
      if (!display) return false;
      execSync('xdpyinfo', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return true;
    } catch {
      return false;
    }
  }

  checkLinuxXdotool(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync('which xdotool', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return true;
    } catch {
      return false;
    }
  }

  normalizeGroupBroadcastPlanMetadata(
    input: Partial<CreateInteractionTaskInput>,
    now = new Date().toISOString(),
  ): Record<string, unknown> {
    const metadata =
      input.metadata && typeof input.metadata === 'object'
        ? { ...input.metadata }
        : {};
    const currentWechatId =
      optionalTrimmedText(input.currentWechatId) ||
      optionalTrimmedText(metadata.currentWechatId) ||
      optionalTrimmedText(metadata.current_wechat_id);
    const plannedWechatId =
      optionalTrimmedText(input.plannedWechatId) ||
      optionalTrimmedText(input.associatedWeChat) ||
      optionalTrimmedText(metadata.plannedWechatId) ||
      optionalTrimmedText(metadata.planned_wechat_id) ||
      optionalTrimmedText(metadata.associatedWeChat) ||
      optionalTrimmedText(metadata.associated_wechat);
    if (currentWechatId) {
      metadata.currentWechatId = currentWechatId;
    }
    if (plannedWechatId) {
      metadata.plannedWechatId = plannedWechatId;
      metadata.associatedWeChat =
        optionalTrimmedText(metadata.associatedWeChat) || plannedWechatId;
    }

    if (!input.type || !isDesktopInteractionTask(input.type)) {
      return metadata;
    }

    const planName =
      optionalTrimmedText(input.planName) ||
      optionalTrimmedText(metadata.planName) ||
      optionalTrimmedText(metadata.wechat_plan_name) ||
      optionalTrimmedText(metadata.messageSendPlanName) ||
      optionalTrimmedText(metadata.message_send_plan_name) ||
      this.defaultWechatPlanName(input.type, now);
    const planTime =
      optionalTrimmedText(input.planTime) ||
      optionalTrimmedText(metadata.planTime) ||
      optionalTrimmedText(metadata.wechat_plan_time) ||
      optionalTrimmedText(metadata.wechat_plan_schedule_start_time) ||
      optionalTrimmedText(metadata.scheduledAt) ||
      optionalTrimmedText(metadata.scheduleStartTime) ||
      optionalTrimmedText(metadata.wechat_moments_schedule_start_time) ||
      optionalTrimmedText(metadata.message_send_plan_time);
    const dailyLimit =
      optionalNumber(input.dailyLimit) ??
      optionalNumber(metadata.dailyLimit) ??
      optionalNumber(metadata.wechat_plan_daily_limit) ??
      optionalNumber(metadata.wechat_group_daily_limit) ??
      optionalNumber(metadata.wechat_contact_add_daily_limit) ??
      optionalNumber(metadata.wechat_moments_marketing_daily_limit) ??
      optionalNumber(metadata.dailyViewLimit);
    const associatedWeChat =
      optionalTrimmedText(input.associatedWeChat) ||
      optionalTrimmedText(metadata.associatedWeChat) ||
      optionalTrimmedText(metadata.associated_wechat) ||
      optionalTrimmedText(metadata.wechat_plan_associated_wechat_id) ||
      optionalTrimmedText(metadata.wechat_plan_associated_wechat_name);
    const associatedWeChatName =
      optionalTrimmedText(metadata.associatedWeChatName) ||
      optionalTrimmedText(metadata.associated_wechat_name) ||
      optionalTrimmedText(metadata.wechat_plan_associated_wechat_name) ||
      optionalTrimmedText(input.accountName);
    const generateOnDemand =
      typeof input.generateOnDemand === 'boolean'
        ? input.generateOnDemand
        : typeof metadata.generateOnDemand === 'boolean'
          ? metadata.generateOnDemand
          : typeof metadata.generate_on_demand === 'boolean'
            ? metadata.generate_on_demand
            : undefined;
    const planKind = this.resolveWechatPlanKind(input.type);
    const minIntervalSeconds =
      optionalNumber(input.minIntervalSeconds) ??
      optionalNumber(metadata.minIntervalSeconds) ??
      optionalNumber(metadata.wechat_contact_add_min_interval_seconds);
    const maxIntervalSeconds =
      optionalNumber(input.maxIntervalSeconds) ??
      optionalNumber(metadata.maxIntervalSeconds) ??
      optionalNumber(metadata.wechat_contact_add_max_interval_seconds);
    const verifyMessage =
      optionalTrimmedText(input.verifyMessage) ||
      optionalTrimmedText(metadata.verifyMessage) ||
      optionalTrimmedText(metadata.wechat_contact_add_verify_message);
    const remarkStrategy =
      optionalTrimmedText(input.remarkStrategy) ||
      optionalTrimmedText(metadata.remarkStrategy) ||
      optionalTrimmedText(metadata.wechat_contact_add_remark_strategy);
    const remarkContent =
      optionalTrimmedText(input.remarkContent) ||
      optionalTrimmedText(metadata.remarkContent) ||
      optionalTrimmedText(metadata.wechat_contact_add_remark_content);
    const checkIntervalMinutes =
      optionalNumber(input.checkIntervalMinutes) ??
      optionalNumber(metadata.checkIntervalMinutes) ??
      optionalNumber(metadata.wechat_moments_marketing_check_interval_minutes);
    const publishIntervalMinutes =
      optionalNumber(input.publishIntervalMinutes) ??
      optionalNumber(metadata.publishIntervalMinutes) ??
      optionalNumber(metadata.wechat_moments_publish_interval_minutes);
    const planType =
      optionalTrimmedText(input.planType) ||
      optionalTrimmedText(metadata.planType) ||
      optionalTrimmedText(metadata.wechat_mass_send_plan_type);
    const chunkedSending =
      typeof input.chunkedSending === 'boolean'
        ? input.chunkedSending
        : typeof metadata.chunkedSending === 'boolean'
          ? metadata.chunkedSending
          : typeof metadata.wechat_mass_send_chunked_sending === 'boolean'
            ? metadata.wechat_mass_send_chunked_sending
            : undefined;
    const massSendFiles = Array.isArray(input.massSendFiles)
      ? input.massSendFiles
      : Array.isArray(metadata.massSendFiles)
        ? metadata.massSendFiles
        : Array.isArray(metadata.wechat_mass_send_files)
          ? metadata.wechat_mass_send_files
          : undefined;
    const massSendContents = Array.isArray(metadata.wechat_mass_send_contents)
      ? metadata.wechat_mass_send_contents
      : input.type === 'wechat-group-broadcast'
        ? (input.batchTargets || [])
            .map((target) => ({
              targetName: optionalTrimmedText(target.targetName),
              targetNo: optionalTrimmedText(target.targetName),
              sendContent:
                optionalTrimmedText(target.replyText) ||
                optionalTrimmedText(input.replyText),
              groupType: 'ordinary',
            }))
            .filter((target) => target.targetName && target.sendContent)
        : undefined;
    const momentsDetails = Array.isArray(input.momentsDetails)
      ? input.momentsDetails
      : Array.isArray(metadata.momentsDetails)
        ? metadata.momentsDetails
        : Array.isArray(metadata.wechat_moments_details)
          ? metadata.wechat_moments_details
          : undefined;
    const momentsTotalCount =
      optionalNumber(input.momentsTotalCount) ??
      optionalNumber(metadata.momentsTotalCount) ??
      optionalNumber(metadata.wechat_moments_total_tasks);

    return {
      ...metadata,
      planName,
      wechat_plan_name: planName,
      planTime,
      wechat_plan_time: planTime,
      wechat_plan_schedule_start_time: planTime,
      scheduledAt: planTime,
      dailyLimit,
      wechat_plan_daily_limit: dailyLimit,
      ...(input.type === 'wechat-group-broadcast'
        ? { wechat_group_daily_limit: dailyLimit }
        : {}),
      associatedWeChat,
      associatedWeChatName,
      wechat_plan_associated_wechat_id: associatedWeChat,
      wechat_plan_associated_wechat_name: associatedWeChatName,
      plannedWechatId: associatedWeChat,
      planned_wechat_id: associatedWeChat,
      current_wechat_id: currentWechatId,
      wechat_plan_kind: planKind,
      verifyMessage,
      wechat_contact_add_verify_message: verifyMessage,
      remarkStrategy,
      remarkContent,
      wechat_contact_add_remark_strategy: remarkStrategy,
      wechat_contact_add_remark_content: remarkContent,
      minIntervalSeconds,
      maxIntervalSeconds,
      wechat_contact_add_min_interval_seconds: minIntervalSeconds,
      wechat_contact_add_max_interval_seconds: maxIntervalSeconds,
      checkIntervalMinutes,
      wechat_moments_marketing_check_interval_minutes: checkIntervalMinutes,
      publishIntervalMinutes,
      wechat_moments_publish_interval_minutes: publishIntervalMinutes,
      planType,
      wechat_mass_send_plan_type: planType,
      chunkedSending,
      wechat_mass_send_chunked_sending: chunkedSending,
      massSendFiles,
      wechat_mass_send_files: massSendFiles,
      wechat_mass_send_contents: massSendContents,
      momentsDetails,
      wechat_moments_details: momentsDetails,
      momentsTotalCount,
      wechat_moments_total_tasks: momentsTotalCount,
      generateOnDemand,
    };
  }

  defaultWechatPlanName(type: InteractionTaskType | undefined, now: string) {
    const date = now.slice(0, 10);
    if (type === 'wechat-contact-add') return `添加好友计划 ${date}`;
    if (type === 'wechat-moments-publish') return `朋友圈发布计划 ${date}`;
    if (type === 'wechat-moments-marketing') return `朋友圈营销计划 ${date}`;
    if (type === 'wechat-reply-draft') return `微信回复计划 ${date}`;
    return `微信群发计划 ${date}`;
  }

  resolveWechatPlanKind(type: InteractionTaskType | undefined) {
    if (type === 'wechat-group-broadcast') return 'mass-send';
    if (type === 'wechat-contact-add') return 'contact-add';
    if (type === 'wechat-moments-publish') return 'moments-publish';
    if (type === 'wechat-moments-marketing') return 'moments-marketing';
    if (type === 'wechat-reply-draft') return 'session-reply';
    return undefined;
  }

  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  ) {
    if (type !== 'wechat-group-broadcast') {
      return undefined;
    }
    const explicit = optionalTrimmedText(explicitStatus);
    if (
      explicit === 'draft' ||
      explicit === 'scheduled' ||
      explicit === 'sending' ||
      explicit === 'paused' ||
      explicit === 'completed' ||
      explicit === 'failed' ||
      explicit === 'removed'
    ) {
      return explicit;
    }
    if (taskStatus === 'paused') return 'paused';
    if (taskStatus === 'completed' || taskStatus === 'skipped') {
      return 'completed';
    }
    if (taskStatus === 'failed' || taskStatus === 'blocked') return 'failed';
    if (
      taskStatus === 'running' ||
      taskStatus === 'waiting_for_send_confirmation'
    ) {
      return 'sending';
    }
    return optionalTrimmedText(planTime) ? 'scheduled' : 'draft';
  }

  normalizeMomentsPlanMetadata(
    input: CreateInteractionTaskInput,
  ): Record<string, unknown> | undefined {
    if (
      input.type !== 'wechat-moments-publish' &&
      input.type !== 'wechat-moments-marketing'
    ) {
      return undefined;
    }
    const existing =
      input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : {};
    const dailyPublished = readMetadataPositiveInteger(
      input.dailyPublished ??
        existing.dailyPublished ??
        existing.wechat_moments_daily_published,
      0,
      10000,
    );
    const fallbackQuota =
      input.type === 'wechat-moments-publish'
        ? 1
        : readMetadataPositiveInteger(
            existing.dailyViewLimit ??
              existing.wechat_moments_marketing_daily_limit,
            20,
            100,
          );
    const dailyQuota = readMetadataPositiveInteger(
      input.dailyQuota ??
        existing.dailyQuota ??
        existing.wechat_moments_daily_quota,
      fallbackQuota,
      10000,
    );
    const scheduleStartTime = optionalTrimmedText(
      input.scheduleStartTime ??
        existing.scheduleStartTime ??
        existing.wechat_moments_schedule_start_time,
    );
    const recordSummary = optionalTrimmedText(
      input.recordSummary ??
        existing.recordSummary ??
        existing.wechat_moments_record_summary,
    );
    const prompts = normalizeMomentsPromptConfig(
      input.prompts ?? existing.prompts ?? existing.wechat_moments_prompts,
    );
    const autoLike =
      input.autoLike ??
      (typeof existing.autoLike === 'boolean'
        ? existing.autoLike
        : undefined) ??
      (typeof existing.wechat_moments_auto_like === 'boolean'
        ? existing.wechat_moments_auto_like
        : undefined);
    const autoComment =
      input.autoComment ??
      (typeof existing.autoComment === 'boolean'
        ? existing.autoComment
        : undefined) ??
      (typeof existing.wechat_moments_auto_comment === 'boolean'
        ? existing.wechat_moments_auto_comment
        : undefined);

    return {
      dailyPublished,
      dailyQuota,
      scheduleStartTime,
      autoLike,
      autoComment,
      recordSummary,
      prompts,
      wechat_moments_daily_published: dailyPublished,
      wechat_moments_daily_quota: dailyQuota,
      wechat_moments_schedule_start_time: scheduleStartTime,
      wechat_moments_auto_like: autoLike,
      wechat_moments_auto_comment: autoComment,
      wechat_moments_record_summary: recordSummary,
      wechat_moments_prompts: prompts,
    };
  }

  normalizeBatchTargets(
    input: CreateInteractionTaskInput,
    now: string,
  ): InteractionBatchTarget[] {
    const rawTargets = Array.isArray(input.batchTargets)
      ? input.batchTargets
      : [];
    const normalizedTargets: InteractionBatchTarget[] = [];
    rawTargets.slice(0, 100).forEach((target, index) => {
      const sourceText = String(target?.sourceText || '').trim();
      if (!sourceText) {
        return;
      }
      normalizedTargets.push({
        id: `bt_${index + 1}_${createId()}`,
        targetName:
          String(target?.targetName || '').trim() || `批量对象 ${index + 1}`,
        sourceText,
        replyText:
          String(target?.replyText || input.replyText || '').trim() ||
          this.buildReplyFromRule(sourceText),
        sourceUrl: optionalTrimmedText(target?.sourceUrl || input.sourceUrl),
        profileUrl: optionalTrimmedText(target?.profileUrl || input.profileUrl),
        commentTime: optionalTrimmedText(
          target?.commentTime || input.commentTime,
        ),
        videoTitle: optionalTrimmedText(target?.videoTitle || input.videoTitle),
        videoUrl: optionalTrimmedText(target?.videoUrl || input.videoUrl),
        engagementScore:
          optionalNumber(target?.engagementScore) ??
          optionalNumber(input.engagementScore),
        status: 'queued',
        updatedAt: now,
      });
    });

    if (normalizedTargets.length) {
      return normalizedTargets;
    }

    const sourceText = input.sourceText?.trim() || '等待本机读取真实对象。';
    return [
      {
        id: `bt_1_${createId()}`,
        targetName: input.targetName?.trim() || '测试对象',
        sourceText,
        replyText:
          input.replyText?.trim() || this.buildReplyFromRule(sourceText),
        sourceUrl: optionalTrimmedText(input.sourceUrl),
        profileUrl: optionalTrimmedText(input.profileUrl),
        commentTime: optionalTrimmedText(input.commentTime),
        videoTitle: optionalTrimmedText(input.videoTitle),
        videoUrl: optionalTrimmedText(input.videoUrl),
        engagementScore: optionalNumber(input.engagementScore),
        status: 'queued',
        updatedAt: now,
      },
    ];
  }

  runWechatContactCommand(
    command: 'wechat-auto-reply' | 'wechat-contact-add',
    target: string,
    message: string,
    mode: 'auto-send' | 'approval',
    options?: {
      remarkStrategy?: string;
      remarkContent?: string;
      attachmentPaths?: string[];
    },
  ): Promise<{ screenshotPath?: string }> {
    const extraArgs =
      command === 'wechat-contact-add'
        ? [options?.remarkStrategy || 'none', options?.remarkContent || '']
        : [options?.attachmentPaths?.join('\n') || ''];
    return this.runWechatDesktopCommand(
      command,
      [target, message, mode, ...extraArgs],
      target,
    );
  }

  runWechatDesktopCommand(
    command:
      | 'wechat-auto-reply'
      | 'wechat-contact-add'
      | 'wechat-live-auto-reply'
      | 'wechat-moments-publish'
      | 'wechat-moments-marketing',
    args: string[],
    target: string,
    timeoutMs = 90000,
  ): Promise<WechatDesktopCommandResult> {
    return new Promise((resolve, reject) => {
      const configuredRoot = this.getMacWechatCommandRoot();
      const resolvedCommand =
        [
          configuredRoot ? join(configuredRoot, command) : '',
          join(homedir(), '.local', 'bin', command),
          join('/opt/homebrew/bin', command),
          join('/usr/local/bin', command),
        ].find((candidate) => candidate && existsSync(candidate)) || command;
      const child = spawn(resolvedCommand, args, {
        env: {
          ...process.env,
          AI_CONTENT_CLICLICK_PATH:
            process.env.AI_CONTENT_CLICLICK_PATH ||
            (configuredRoot ? join(configuredRoot, 'cliclick') : ''),
          AI_CONTENT_NODE_PATH:
            process.env.AI_CONTENT_NODE_PATH || process.execPath,
          PATH: [
            configuredRoot,
            process.env.PATH || '',
            join(homedir(), '.local', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
          ]
            .filter(Boolean)
            .join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} 执行超时：${target}`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const output = stdout.trim();
          if (!output) {
            resolve({});
            return;
          }
          try {
            resolve(this.parseWechatDesktopCommandOutput(output, command));
          } catch (error) {
            if (error instanceof SyntaxError) {
              resolve({});
            } else {
              reject(error);
            }
          }
          return;
        }
        reject(
          new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()),
        );
      });
    });
  }

  parseWechatDesktopCommandOutput(
    output: string,
    command: string,
  ): WechatDesktopCommandResult {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const ok = parsed.ok;
    const status = String(parsed.status || '').toLowerCase();
    if (
      ok === false ||
      [
        'failed',
        'error',
        'blocked',
        'captcha_required',
        'risk_blocked',
        'send_failed',
        'draft_not_ready',
        'not_ready',
        'no_target',
      ].includes(status)
    ) {
      const message =
        optionalTrimmedText(parsed.error) ||
        optionalTrimmedText(parsed.message) ||
        optionalTrimmedText(parsed.reason) ||
        `${command} 返回失败`;
      throw new WechatDesktopCommandError(
        message,
        this.toWechatDesktopCommandResult(parsed),
      );
    }
    return this.toWechatDesktopCommandResult(parsed);
  }

  toWechatDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult {
    return {
      screenshotPath: optionalTrimmedText(
        parsed.screenshotPath ?? parsed.screenshot_path,
      ),
      reply: optionalTrimmedText(parsed.reply),
      readText: optionalTrimmedText(parsed.readText ?? parsed.read_text),
      sourceText: optionalTrimmedText(parsed.sourceText ?? parsed.source_text),
      generatedBy: this.normalizeReplyGeneratedBy(
        parsed.generatedBy ??
          parsed.generated_by ??
          parsed.replyGeneratedBy ??
          parsed.reply_generated_by,
      ),
      message: optionalTrimmedText(parsed.message),
      contact: optionalTrimmedText(parsed.contact),
      target: optionalTrimmedText(parsed.target),
      currentWechatId: optionalTrimmedText(
        parsed.currentWechatId ?? parsed.current_wechat_id,
      ),
      plannedWechatId: optionalTrimmedText(
        parsed.plannedWechatId ?? parsed.planned_wechat_id,
      ),
      mode: optionalTrimmedText(parsed.mode),
      status: optionalTrimmedText(parsed.status),
      errorCode: optionalTrimmedText(parsed.errorCode ?? parsed.error_code),
      nextAction: optionalTrimmedText(parsed.nextAction ?? parsed.next_action),
    };
  }

  collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds: string[] = [],
  ) {
    return [
      ...new Set([
        ...eventIds.filter(Boolean),
        ...task.events
          .filter((event) => Boolean(event.evidence))
          .slice(-8)
          .map((event) => event.id),
      ]),
    ];
  }

  normalizeStoredBatchTargets(task: InteractionTask) {
    if (!task.batchTargets?.length) {
      return;
    }

    task.batchTargets = task.batchTargets.map((target) => ({
      ...target,
      status: normalizeBatchTargetStatus(target.status),
      evidenceEventIds: Array.isArray(target.evidenceEventIds)
        ? target.evidenceEventIds.filter(Boolean)
        : undefined,
    }));
    task.batchSummary = buildBatchSummary(task.batchTargets);
  }

  normalizeRuleNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(Math.round(number), max));
  }

  isSendMode(value: unknown): value is InteractionSendMode {
    return (
      value === 'approval-send' ||
      value === 'draft-only' ||
      value === 'auto-send'
    );
  }

  resolveBusinessTaskType(
    key: InteractionBusinessRouteKey,
    input: Partial<CreateInteractionTaskInput> = {},
  ): InteractionTaskType {
    if (input.type && this.isKnownInteractionTaskType(input.type)) {
      return input.type;
    }
    if (this.isWechatChannelBusinessInput(input)) {
      if (key === 'comments') return 'wechat-channel-comment-reply';
      if (key === 'messages') return 'wechat-channel-direct-message-reply';
    }

    const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType> = {
      comments: 'douyin-comment-reply',
      messages: 'douyin-direct-message-reply',
      'channel-comments': 'wechat-channel-comment-reply',
      'channel-messages': 'wechat-channel-direct-message-reply',
      wechat: 'wechat-reply-draft',
      groups: 'wechat-group-broadcast',
      moments: 'wechat-moments-publish',
      customers: 'customer-follow-up',
    };

    return mapping[key];
  }

  resolveBusinessTaskTypes(
    key: InteractionBusinessRouteKey,
  ): InteractionTaskType[] {
    const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType[]> =
      {
        comments: ['douyin-comment-reply'],
        messages: ['douyin-direct-message-reply'],
        'channel-comments': ['wechat-channel-comment-reply'],
        'channel-messages': ['wechat-channel-direct-message-reply'],
        wechat: ['wechat-reply-draft', 'wechat-friend-accept'],
        groups: ['wechat-group-broadcast'],
        moments: ['wechat-moments-publish', 'wechat-moments-marketing'],
        customers: [
          'customer-follow-up',
          'wechat-contact-add',
          'wechat-friend-accept',
        ],
      };

    return mapping[key];
  }

  isKnownInteractionTaskType(type: string): type is InteractionTaskType {
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
      'customer-follow-up',
    ].includes(type);
  }

  isWechatChannelBusinessInput(
    input: Partial<CreateInteractionTaskInput>,
  ): boolean {
    return (
      input.platformType === 2 ||
      /视频号|wechat[-_ ]?channel|channel/i.test(
        `${input.platformName || ''} ${input.type || ''}`,
      )
    );
  }

  isRuleTone(value: unknown): value is InteractionReplyRuleConfig['tone'] {
    return value === 'warm' || value === 'professional' || value === 'concise';
  }

  resolveTypeLabel(type: InteractionTaskType) {
    const labels: Record<InteractionTaskType, string> = {
      'douyin-comment-reply': '抖音自动评论',
      'douyin-direct-message-reply': '抖音私信回复',
      'wechat-channel-comment-reply': '视频号评论回复',
      'wechat-channel-direct-message-reply': '视频号私信回复',
      'wechat-reply-draft': '微信回复草稿',
      'wechat-friend-accept': '接受微信好友请求',
      'wechat-group-broadcast': '微信群发',
      'wechat-contact-add': '自动加好友',
      'wechat-moments-publish': '朋友圈发布',
      'wechat-moments-marketing': '朋友圈营销',
      'customer-follow-up': '客户跟进',
    };
    return labels[type];
  }

  resolveStatusLabel(status: InteractionTaskStatus) {
    const labels: Record<InteractionTaskStatus, string> = {
      queued: '排队中',
      running: '执行中',
      paused: '已暂停',
      blocked: '已阻断',
      waiting_for_send_confirmation: '等待继续执行',
      completed: '已完成',
      failed: '失败',
      skipped: '已跳过',
      no_target: '无对象',
    };
    return labels[status];
  }

  async resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ) {
    if (session.resumeAction?.kind === 'agentwaker-handoff') {
      session.status = 'completed';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = new Date().toISOString();
      session.updatedAt = session.completedAt;
      session.nextAction = `内容已批准进入发布准备，可前往 ${session.resumeAction.targetHref} 继续处理。`;
      this.pushAgentEvent(
        session,
        'success',
        '运营助理产物已批准',
        `${session.resumeAction.label}。本次仅完成内容交接，没有向平台执行发布。`,
        {
          type: 'stage_log',
          label: 'AgentWaker 内容交接',
          value: JSON.stringify(
            {
              articleId: session.resumeAction.articleId,
              role: session.resumeAction.role,
              workflow: session.resumeAction.workflow,
              targetHref: session.resumeAction.targetHref,
              confirmationId: confirmation.id,
            },
            null,
            2,
          ),
          stageKey: 'agentwaker-handoff',
        },
      );
      await this.persistAgentSession(session);
      return;
    }
    if (session.resumeAction?.kind === 'auto-upload-publish') {
      await this.runAutoUploadPublishResume(
        session,
        session.resumeAction,
        confirmation,
      );
      return;
    }
  }

  async runAutoUploadPublishResume(
    session: AgentSession,
    action: Extract<AgentSessionResumeAction, { kind: 'auto-upload-publish' }>,
    confirmation: AgentConfirmation,
  ) {
    try {
      this.pushAgentEvent(
        session,
        'info',
        '开始真实发布',
        `${action.label} 已通过确认，正在提交给 3011 本地 Runtime。`,
      );
      const payloads = this.normalizeAutoUploadPublishPayloads(action.payloads);
      if (!payloads.length) {
        throw new BadRequestException('真实发布 payload 为空，无法继续执行');
      }
      this.pushAgentEvent(
        session,
        'info',
        '发布参数已锁定',
        `即将提交 ${payloads.length} 个平台任务，素材 ${new Set(payloads.flatMap((payload) => payload.fileList)).size} 个。`,
        {
          type: 'text',
          label: '发布 payload 摘要',
          value: JSON.stringify(
            payloads.map((payload) => ({
              platform: this.resolvePlatformName(payload.type),
              title: payload.title,
              accountCount: payload.accountList.length,
              materialCount: payload.fileList.length,
              timer: payload.enableTimer === 1,
              dryRun: payload.debugDryRun,
            })),
            null,
            2,
          ),
        },
      );
      const preflight =
        await this.autoUploadService.preflightPublishBatch(payloads);
      this.pushAgentEvent(
        session,
        preflight.ok ? 'success' : 'error',
        preflight.ok ? '发布 preflight 通过' : '发布 preflight 阻断',
        preflight.summary,
        {
          type: preflight.ok ? 'diagnostic_bundle' : 'failure_reason',
          label: '发布 preflight 矩阵',
          value: JSON.stringify(preflight, null, 2),
          stageKey: 'publish-preflight',
        },
      );
      if (!preflight.ok) {
        throw new BadRequestException(preflight.summary);
      }
      session.status = 'waiting_for_confirmation';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = undefined;
      session.nextAction =
        '发布草稿和发布前检查已保留；请进入发布中心核对本批内容并取得服务端一次性确认。';
      this.pushAgentEvent(
        session,
        'warning',
        '旧发布续跑入口已阻断',
        `已保留 ${payloads.length} 个发布草稿和 preflight 结果；内部 Agent 确认不能替代与当前批次绑定的服务端一次性发布票，本次未向任何平台提交。`,
        {
          type: 'text',
          label: '发布草稿',
          value: JSON.stringify(payloads, null, 2),
        },
      );
    } catch (error) {
      session.status = 'failed';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = new Date().toISOString();
      session.nextAction = '真实发布续跑失败，请检查本地发布引擎状态。';
      this.pushAgentEvent(
        session,
        'error',
        '真实发布续跑失败',
        error instanceof Error ? error.message : '未知错误',
      );
    } finally {
      session.updatedAt = new Date().toISOString();
      this.persistAgentSession(session).catch((error) => {
        console.warn(
          '[local-engine] persist agent publish resume failed',
          error,
        );
      });
    }
  }

  normalizeAutoUploadPublishPayloads(
    payloads: unknown[],
  ): AutoUploadPublishPayload[] {
    if (!Array.isArray(payloads)) {
      return [];
    }
    return payloads
      .filter((payload): payload is AutoUploadPublishPayload => {
        const candidate = payload as AutoUploadPublishPayload;
        return Boolean(
          candidate &&
          typeof candidate.type === 'number' &&
          typeof candidate.title === 'string' &&
          Array.isArray(candidate.tags) &&
          Array.isArray(candidate.fileList) &&
          Array.isArray(candidate.accountList),
        );
      })
      .map((payload) => ({
        ...payload,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
      }));
  }

  pushAgentEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ) {
    const now = new Date().toISOString();
    session.events.push({
      id: createId(),
      sessionId: session.id,
      level,
      title,
      message,
      createdAt: now,
      evidence,
    });
    session.updatedAt = now;
  }

  createAgentConfirmation(
    session: AgentSession,
    input: {
      title: string;
      description: string;
      actionLabel: string;
      riskLevel: Exclude<AgentRiskLevel, 'low'>;
    },
  ): AgentConfirmation {
    return {
      id: createId(),
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id,
      title: input.title,
      description: input.description,
      actionLabel: input.actionLabel,
      riskLevel: input.riskLevel,
      status: 'pending',
      confirmationMode:
        input.riskLevel === 'high' ? 'double-confirmation' : 'standard',
      requiredChecks: this.createAgentConfirmationChecks(
        session,
        input.riskLevel,
      ),
      safetyBoundary: session.safetyBoundary,
      misfireProtection: session.misfireProtection,
      riskPolicy: session.riskPolicy,
      commercialPermissionRequired:
        session.safetyBoundary?.permissionStatus !== 'allowed',
      trialLimited: session.safetyBoundary?.trialLimited,
      blockedReason: session.safetyBoundary?.blockedActions.length
        ? session.safetyBoundary.blockedActions.join('、')
        : undefined,
      createdAt: new Date().toISOString(),
    };
  }

  createInteractionTaskConfirmation(task: InteractionTask): AgentConfirmation {
    const typeLabel = this.resolveTypeLabel(task.type);
    return {
      id: createId(),
      tenantId: task.tenantId,
      userId: task.userId,
      sessionId: `interaction-task:${task.id}`,
      title: `继续执行${typeLabel}回复`,
      description: `客户原文：${task.sourceText}\nAI 回复：${task.replyText}`,
      actionLabel: '继续执行',
      riskLevel: 'medium',
      status: 'pending',
      confirmationMode: 'standard',
      requiredChecks: [
        {
          key: 'target',
          label: '目标确认',
          required: true,
          blocking: false,
          category: 'target',
          status: 'ready',
        },
        {
          key: 'content',
          label: '内容确认',
          required: true,
          blocking: false,
          category: 'content',
          status: 'ready',
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  resolveAgentScopeLabel(scope: AgentExecutionScope) {
    const labels: Record<AgentExecutionScope, string> = {
      browser: '浏览器任务',
      desktop: '桌面任务',
      'local-files': '本机文件',
      remote: '远程任务',
      mixed: '浏览器和桌面混合',
    };
    return labels[scope];
  }

  resolveAgentSessionStatusLabel(status: AgentSessionStatus) {
    const labels: Record<AgentSessionStatus, string> = {
      draft: '草稿',
      running: '执行中',
      waiting_for_confirmation: '待继续',
      completed: '已完成',
      failed: '失败',
      cancelled: '已停止',
    };
    return labels[status];
  }

  resolvePlatformName(type: number) {
    const labels: Record<number, string> = {
      1: '小红书',
      2: '视频号',
      3: '抖音',
      4: '快手',
      5: 'B站',
    };
    return labels[type] || `平台 ${type}`;
  }

  isSamePlatformAccount(
    selected: { type?: number; name?: string },
    actual: { type?: number; name?: string },
  ) {
    const selectedKey = this.resolvePlatformKey(selected);
    const actualKey = this.resolvePlatformKey(actual);
    if (selectedKey && actualKey) {
      return selectedKey === actualKey;
    }
    return selected.type === actual.type;
  }

  resolveTaskPlatformAccount(input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  }) {
    if (input.platformType || input.platformName) {
      return { type: input.platformType, name: input.platformName };
    }
    if (input.type.startsWith('wechat-channel')) {
      return { type: 2, name: '视频号' };
    }
    if (input.type.startsWith('douyin')) {
      return { type: 3, name: '抖音' };
    }
    return { type: input.platformType, name: input.platformName };
  }

  resolvePlatformKey(input: { type?: number; name?: string }) {
    const name = input.name?.trim().toLowerCase();
    if (name) {
      if (name.includes('douyin') || name.includes('抖音')) return 'douyin';
      if (
        name.includes('wechat-channel') ||
        name.includes('channel') ||
        name.includes('视频号')
      ) {
        return 'wechat-channel';
      }
      if (name.includes('xiaohongshu') || name.includes('小红书')) {
        return 'xiaohongshu';
      }
      if (name.includes('kuaishou') || name.includes('快手')) return 'kuaishou';
      if (name.includes('bilibili') || name.includes('b站')) return 'bilibili';
    }
    const keys: Record<number, string> = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
    };
    return typeof input.type === 'number' ? keys[input.type] : undefined;
  }
}

// 方法簇 mixin 挂载（god class 拆解阶段 2）
Object.assign(LocalEngineService.prototype, batchTargetMethods);
Object.assign(LocalEngineService.prototype, wechatNativeMethods);
Object.assign(LocalEngineService.prototype, contactMethods);

Object.assign(LocalEngineService.prototype, customerServiceMethods);

Object.assign(LocalEngineService.prototype, riskSafetyMethods);
