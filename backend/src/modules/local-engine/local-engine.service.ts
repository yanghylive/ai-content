import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { constants, existsSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { extname, join } from 'node:path';

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

import { Prisma, type InteractionReplyRule } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { AutoUploadWechatDesktopStatus } from '../auto-upload/auto-upload.client';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
import {
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
  type InteractionTaskStep,
  type InteractionTaskStepStatus,
  type InteractionTaskListFilter,
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
  type BatchTargetMetadata,
  type InteractionTaskSummaryRow,
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
import { tailToolsMethods } from './local-engine.tail-tools.mixin';
import { agentMethods } from './local-engine.agent.mixin';
import { taskQueryMethods } from './local-engine.task-query.mixin';
import { executionMethods } from './local-engine.execution.mixin';
import { taskOperationMethods } from './local-engine.task-operation.mixin';
import { capabilitiesMethods } from './local-engine.capabilities.mixin';
import { desktopStatusMethods } from './local-engine.desktop-status.mixin';
import { hydrateMethods } from './local-engine.hydrate.mixin';
import { entitlementMethods } from './local-engine.entitlement.mixin';
import { browserAssistMethods } from './local-engine.browser-assist.mixin';
import { desktopEvidenceMethods } from './local-engine.desktop-evidence.mixin';
import { planMetadataMethods } from './local-engine.plan-metadata.mixin';
import { desktopControlMethods } from './local-engine.desktop-control.mixin';
import { wechatCommandMethods } from './local-engine.wechat-command.mixin';
import {
  ALL_INTERACTION_EXECUTOR_IDS,
  executorsMethods,
} from './local-engine.executors.mixin';
import {
  taskEvidenceMethods,
  type TaskEvidenceIndex,
  type TaskEvidenceIndexItem,
  type TaskEvidenceIntegrity,
  type TaskEvidenceItem,
  type TaskEvidenceReplayItem,
} from './local-engine.task-evidence.mixin';
import { persistMethods } from './local-engine.persist.mixin';
import { wechatSessionMethods } from './local-engine.wechat-session.mixin';
import { wechatContactsSyncMethods } from './local-engine.wechat-contacts-sync.mixin';
import { runtimeCheckMethods } from './local-engine.runtime-check.mixin';

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
import { isKaypalPlanAtLeast } from '../auth/plan-order';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { type WechatNativeCommandKey } from './wechat-native-command.contract';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveRuntimeStateRoot,
} from '../../common/project-paths';
import {
  getProjectRoot,
  isDesktopInteractionTask,
  buildAutoSendReadbackMessage,
  buildBatchSummary,
  buildTaskFailureAnalysis,
  formatConfirmationIndexForCsv,
  isPlaceholderInteractionText,
  normalizeBatchTargetStatus,
} from './local-engine.utils';
import { batchTargetMethods } from './local-engine.batch-targets.mixin';
import { wechatNativeMethods } from './local-engine.wechat-native.mixin';
import { contactMethods } from './local-engine.contact.mixin';
import {} from './local-engine.wechat-command.utils';
import type {
  ApprovedWechatTaskResult,
  WechatDesktopCommandResult,
} from './local-engine.wechat-command.utils';

/** batch targets 方法簇的 mixin 类型声明（实现见 local-engine.batch-targets.mixin.ts） */
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
  resolveBusinessTaskType(
    key: InteractionBusinessRouteKey,
    input?: Partial<CreateInteractionTaskInput>,
  ): InteractionTaskType;
  resolveBusinessTaskTypes(
    key: InteractionBusinessRouteKey,
  ): InteractionTaskType[];
  isKnownInteractionTaskType(type: string): type is InteractionTaskType;
  isWechatChannelBusinessInput(
    input: Partial<CreateInteractionTaskInput>,
  ): boolean;
  isRuleTone(value: unknown): value is InteractionReplyRuleConfig['tone'];
  resolveTypeLabel(type: InteractionTaskType): string;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ): Promise<void>;
  runAutoUploadPublishResume(
    session: AgentSession,
    action: Extract<AgentSessionResumeAction, { kind: 'auto-upload-publish' }>,
    confirmation: AgentConfirmation,
  ): Promise<void>;
  normalizeAutoUploadPublishPayloads(
    payloads: unknown[],
  ): AutoUploadPublishPayload[];
  pushAgentEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ): void;
  createAgentConfirmation(
    session: AgentSession,
    input: {
      title: string;
      description: string;
      actionLabel: string;
      riskLevel: Exclude<AgentRiskLevel, 'low'>;
    },
  ): AgentConfirmation;
  createInteractionTaskConfirmation(task: InteractionTask): AgentConfirmation;
  resolveAgentScopeLabel(scope: AgentExecutionScope): string;
  resolveAgentSessionStatusLabel(status: AgentSessionStatus): string;
  resolvePlatformName(type: number): string;
  isSamePlatformAccount(
    selected: { type?: number; name?: string },
    actual: { type?: number; name?: string },
  ): boolean;
  resolveTaskPlatformAccount(input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  }): { type?: number; name?: string };
  resolvePlatformKey(input: {
    type?: number;
    name?: string;
  }): string | undefined;
  createAgentConfirmationChecks(
    session: AgentSession,
    riskLevel: Exclude<AgentRiskLevel, 'low'>,
  ): LocalEngineSafetyCheck[];
  persistAgentSession(session: AgentSession): Promise<void>;
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
  resolveEvidenceFilePath(filePath: string | undefined);
  resolveBrowserEvidenceFilePath(filename: string | undefined);
  normalizeEvidenceFilePath(filePath: string);
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
  getSessionPendingConfirmations(session: AgentSession);
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
  );
  buildAgentFailureAnalysis(session: AgentSession);
  buildAgentAuditTrail(session: AgentSession);
  buildAgentEvidenceIndex(session: AgentSession, evidenceItems?: unknown);
  toAgentEvidenceIndexItems(items: AgentEvidence[]);
  buildAgentEvidenceIntegrity(
    session: AgentSession,
    evidenceItems?: unknown,
    evidenceIndex?: unknown,
  );
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
  automationStatusLabel(status: AutomationTaskViewStatus);
  readMetadataText(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  );
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
  waitForLiveExecutor(task: InteractionTask): void;
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
  assertCreateExecutionPreflight(input: CreateInteractionTaskInput): Promise<
    | {
        accountName: string;
        platformType: number;
        platformName: string;
        capability: LocalEngineExecutorCapability;
      }
    | undefined
  >;
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
  createTask(input: CreateInteractionTaskInput): Promise<InteractionTask>;
  resolveFutureWechatPlanTime(task: InteractionTask, now?: unknown);
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
  getContinuableBatchTargets(task: InteractionTask);
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
  requireRiskPolicyService();
  riskApprovalActor(task: InteractionTask);
  buildWechatResumeApprovalTarget(task: InteractionTask);
  failTask(id: string, reason?: unknown): Promise<InteractionTask>;
  retryTask(
    id: string,
    input?: RetryInteractionTaskInput,
  ): Promise<InteractionTask>;
  getCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]>;
  checkAutoUploadEngine();
  checkInteractionCapabilities();
  checkContentPublishingCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  checkEvidenceReplayCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  checkAiReplyModelConfig(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  withKaypalModelSyncHint(result: {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }): {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  };
  checkFileAccess(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction?: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }>;
  withCapabilityTimeout<T>(
    name: string,
    promise: Promise<T>,
    fallback: T,
    timeoutMs?: unknown,
  ): Promise<T>;
  readWechatDesktopStatus(): Promise<AutoUploadWechatDesktopStatus>;
  buildDesktopStatus(
    desktop: Awaited<ReturnType<typeof this.readWechatDesktopStatus>>,
    checkedAt: string,
    screenshot?: LocalEngineDesktopScreenshotEvidence,
  ): LocalEngineDesktopStatus;
  detectWechatSessionAnomalies(desktop: LocalEngineDesktopStatus): {
    loggedOut: boolean;
    popupDetected: boolean;
    contactAmbiguous: boolean;
    permissionBlocked: boolean;
  };
  isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus);
  hasWechatControlSurfaceEvidence(desktop: LocalEngineDesktopStatus);
  hasRunnableWechatWindowEvidence(desktop: LocalEngineDesktopStatus);
  isWechatTargetLocked(currentWindowTitle?: string | null);
  buildDesktopCommercialPreflight(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineDesktopCommercialPreflight;
  hydrateTasksFromStore(limit?: unknown);
  listStoredTaskSummaries(
    limit?: unknown,
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]>;
  mergeTaskSummaries(
    storedTasks: InteractionTask[],
    filter?: InteractionTaskListFilter,
    types?: InteractionTaskType[],
  );
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
  );
  cleanEvidenceIntegrityText(value: unknown);
  taskHasEvidenceIntegrityText(task: InteractionTask);
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
  );
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
  );
  countStoredTaskSummaryEvidence(input: {
    batchTargets?: InteractionBatchTarget[];
    diagnostics?: Partial<NonNullable<InteractionTask['diagnostics']>>;
    events?: InteractionTaskEvent[];
    resultSummary?: Partial<InteractionTaskResultSummary>;
  });
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
  buildBlockedKaypalEntitlementCapability(
    now: string,
    summary: string,
    nextAction: string,
    checks: NonNullable<LocalEngineCapability['checks']>,
  ): LocalEngineCapability;
  buildKaypalEntitlementTimeoutFallback(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): LocalEngineCapability;
  buildCachedKaypalEntitlementCapability(
    now: string,
    user: LocalEngineEntitlementUser,
    plan: string,
    warning?: string,
  ): LocalEngineCapability | null;
  buildKaypalEntitlementCapability(
    now: string,
    explicitUser?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability>;
  buildNodeAgentRuntimeCapability(
    now: string,
    sidecarMessage?: unknown,
  ): Promise<LocalEngineCapability>;
  buildLegacyAgentSCapability(
    now: string,
    sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
  ): LocalEngineCapability;
  formatCreditBalance(balance: number | null): string;
  runInteractionTaskLifecycle(taskId: string);
  resolveCustomerServiceLifecycleDelayMs(task: InteractionTask);
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
  captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence>;
  readWechatWindowFrame(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowFrameFromAccessibility(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowFrameFromCoreGraphics(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null>;
  readWechatWindowCaptureInfo(frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ windowId?: number; shareable?: boolean } | null>;
  readDesktopScreenshotText(imagePath: string): Promise<string>;
  detectWechatScreenshotMismatch(textSample: string): string | null;
  hasTrustedWechatAlignmentLock();
  isWechatScreenshotSoftDiagnostic(diagnostic?: string | null);
  detectWechatScreenshotSessionBlocker(
    textSample?: string | null,
  ): string | null;
  runCommand(command: string, args: string[], timeoutMs: number);
  rememberDesktopEvidence(evidence?: LocalEngineDesktopScreenshotEvidence);
  normalizeGroupBroadcastPlanMetadata(
    input: Partial<CreateInteractionTaskInput>,
    now?: unknown,
  ): Record<string, unknown>;
  defaultWechatPlanName(type: InteractionTaskType | undefined, now: string);
  resolveWechatPlanKind(type: InteractionTaskType | undefined);
  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  );
  normalizeMomentsPlanMetadata(
    input: CreateInteractionTaskInput,
  ): Record<string, unknown> | undefined;
  normalizeBatchTargets(
    input: CreateInteractionTaskInput,
    now: string,
  ): InteractionBatchTarget[];
  normalizeRuleNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  );
  checkDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkMacOSDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkWindowsDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkLinuxDesktopControl(): {
    status: 'ready' | 'warning';
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: 'ready' | 'warning';
      message: string;
    }>;
  };
  checkMacOSAccessibility(): boolean;
  checkMacOSScreenRecording(): boolean;
  checkWindowsUIAutomation(): boolean;
  checkWindowsScreenCapture(): boolean;
  checkLinuxX11(): boolean;
  checkLinuxXdotool(): boolean;
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
  ): Promise<{ screenshotPath?: string }>;
  runWechatDesktopCommand(
    command:
      | 'wechat-auto-reply'
      | 'wechat-contact-add'
      | 'wechat-live-auto-reply'
      | 'wechat-moments-publish'
      | 'wechat-moments-marketing',
    args: string[],
    target: string,
    timeoutMs?: number,
  ): Promise<WechatDesktopCommandResult>;
  parseWechatDesktopCommandOutput(
    output: string,
    command: string,
  ): WechatDesktopCommandResult;
  toWechatDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult;
  getExecutorsStatus(): Promise<LocalEngineExecutorsStatus>;
  getRequiredInteractionExecutorIdsForCurrentHost(): string[];
  getUnsupportedInteractionExecutorIdsForCurrentHost(): string[];
  getCachedExecutorsStatus(ttlMs?: number): Promise<LocalEngineExecutorsStatus>;
  loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus>;
  mergeExecutorCapabilities(
    executors: LocalEngineExecutorCapability[],
  ): LocalEngineExecutorCapability[];
  loadWechatDesktopExecutorCapabilities(): Promise<
    LocalEngineExecutorCapability[]
  >;
  readDesktopStatusForExecutorList(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus>;
  buildWechatDesktopExecutorCapabilities(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineExecutorCapability[];
  mapRuntimeHealthToExecutorCapability(h: {
    id: string;
    ok: boolean;
    details?: string;
  }): LocalEngineExecutorCapability;
  getDesktopStatus(): Promise<LocalEngineDesktopStatus>;
  readDesktopStatusWithEvidenceCached(
    checkedAt: string,
    ttlMs?: number,
  ): Promise<LocalEngineDesktopStatus>;
  readDesktopStatusWithEvidence(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus>;
  getDesktopCommercialPreflight(): Promise<LocalEngineDesktopCommercialPreflight>;
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
  ensureTaskStore(): Promise<void>;
  persistTask(task: InteractionTask): Promise<void>;
  persistTaskNow(task: InteractionTask): Promise<void>;
  runPrismaTransientRetry<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T>;
  isPrismaTransientConnectionError(error: unknown): boolean;
  formatPrismaRetryError(error: unknown): string;
  persistReplyRule(
    rule?: InteractionReplyRuleConfig,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  persistAgentSession(session: AgentSession): Promise<void>;
  persistAgentConfirmation(confirmation: AgentConfirmation): Promise<void>;
  agentSessionSourceToPrisma(source?: AgentSessionSource): unknown;
  loadReplyRuleFromStore(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionReplyRuleConfig>;
  resolveSummaryPlatformName(type: InteractionTaskType): string;
  resolveSummaryDiagnosticStatus(
    status: InteractionTaskStatus,
  ): NonNullable<InteractionTask['diagnostics']>['status'];
  hydrateAgentSessionsFromStore(
    limit?: number,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  hydrateAgentConfirmationsFromStore(
    limit?: number,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<void>;
  loadStoredAgentSession(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<AgentSession | null>;
  loadStoredTask(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionTask | null>;
  getPlaywrightMcpStatusWithCount(): unknown;
  getWechatSessionStatus(): Promise<LocalEngineWechatSessionStatus>;
  confirmWechatSession(
    input: UpdateWechatSessionConfirmationInput,
  ): Promise<LocalEngineWechatSessionStatus>;
  alignWechatSession(
    input: AlignWechatSessionInput,
  ): Promise<LocalEngineWechatSessionStatus>;
  takeoverWechatSession(
    input?: WechatSessionControlInput,
    riskContext?: BackendRiskContext,
  ): Promise<LocalEngineWechatSessionStatus>;
  stopWechatSession(
    input?: WechatSessionControlInput,
  ): Promise<LocalEngineWechatSessionStatus>;
  getFileAccessStatus(): Promise<LocalEngineFileAccessStatus>;
  getWechatContacts(): Promise<WechatContactsResult>;
  getWechatContactsReadiness(): Promise<WechatContactsReadinessResult>;
  syncWechatContacts(
    input?: boolean | WechatContactsSyncInput,
  ): Promise<WechatContactsResult>;
  runWechatChatHistorySyncScript(
    scriptPath: string,
    input: SyncWechatChatHistoryInput,
  ): Promise<Record<string, unknown>>;
  getRuntimeServiceDefinitions(): LocalEngineRuntimeService[];
  inspectRuntimeService(
    service: Omit<
      LocalEngineRuntimeService,
      'online' | 'managedByScreen' | 'logExists' | 'message' | 'pid'
    >,
    screenSessions: Set<string>,
  ): Promise<LocalEngineRuntimeService>;
  readManagedScreenSessions(logDir: string): Promise<Set<string>>;
  checkTcpPort(port: number): Promise<boolean>;
  checkHttpUrl(
    url: string,
    options?: { attempts?: number; timeoutMs?: number; retryDelayMs?: number },
  ): Promise<boolean>;
  getBrowserStatus(): Promise<LocalEngineBrowserStatus>;
  resolveBrowserSessionPlatformKey(
    platformName: string,
    platformType: number,
  ): string;
  checkRequiredPlatformAccounts(
    browserStatus: LocalEngineBrowserStatus,
    capabilities?: LocalEngineCapability[],
  ): { ready: boolean; message: string; nextAction: string };
  isWechatReadinessSessionLocked(
    capabilities?: LocalEngineCapability[],
  ): boolean;
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

  /**
   * 共享：从 RuntimeOrchestrator + 平台 sub-services 拉真 capability 状态
   * 同时被 getExecutorsStatus (GET /executors/status) 和
   *      assertCreateExecutionPreflight (创建任务时的预检) 使用
   * 避免之前 P3-D4 placeholder 写死空数组导致 capability 永远 undefined
   */

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

  async preflightDesktopInteractionTask(task: InteractionTask) {
    const contract = await this.resolveExecutionContract(task);
    if (!contract) {
      return;
    }
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

  isSendMode(value: unknown): value is InteractionSendMode {
    return (
      value === 'approval-send' ||
      value === 'draft-only' ||
      value === 'auto-send'
    );
  }
}

// 方法簇 mixin 挂载（god class 拆解阶段 2）
Object.assign(LocalEngineService.prototype, batchTargetMethods);
Object.assign(LocalEngineService.prototype, wechatNativeMethods);
Object.assign(LocalEngineService.prototype, contactMethods);

Object.assign(LocalEngineService.prototype, customerServiceMethods);

Object.assign(LocalEngineService.prototype, riskSafetyMethods);

Object.assign(LocalEngineService.prototype, tailToolsMethods);

Object.assign(LocalEngineService.prototype, agentMethods);

Object.assign(LocalEngineService.prototype, taskQueryMethods);

Object.assign(LocalEngineService.prototype, executionMethods);

Object.assign(LocalEngineService.prototype, taskOperationMethods);

Object.assign(LocalEngineService.prototype, capabilitiesMethods);

Object.assign(LocalEngineService.prototype, desktopStatusMethods);

Object.assign(LocalEngineService.prototype, hydrateMethods);

Object.assign(LocalEngineService.prototype, entitlementMethods);

Object.assign(LocalEngineService.prototype, browserAssistMethods);

Object.assign(LocalEngineService.prototype, desktopEvidenceMethods);

Object.assign(LocalEngineService.prototype, planMetadataMethods);
Object.assign(LocalEngineService.prototype, desktopControlMethods);
Object.assign(LocalEngineService.prototype, wechatCommandMethods);
Object.assign(LocalEngineService.prototype, executorsMethods);
Object.assign(LocalEngineService.prototype, taskEvidenceMethods);
Object.assign(LocalEngineService.prototype, persistMethods);
Object.assign(LocalEngineService.prototype, wechatSessionMethods);
Object.assign(LocalEngineService.prototype, wechatContactsSyncMethods);
Object.assign(LocalEngineService.prototype, runtimeCheckMethods);
