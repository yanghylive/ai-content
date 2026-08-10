import { platform } from 'node:os';

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

import { type InteractionReplyRule } from '@prisma/client';
import {
  BadRequestException,
  Inject,
  forwardRef,
  Injectable,
  Optional,
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
import { runtimeExecMethods } from './local-engine.runtime-exec.mixin';
import { tenantMethods } from './local-engine.tenant.mixin';
import { healthMethods } from './local-engine.health.mixin';
import { miscMethods } from './local-engine.misc.mixin';

import {
  type AutoUploadPublishPayload,
  type AutoUploadUploadFile,
} from '../auto-upload/auto-upload.client';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {} from '../runtime/orchestrator/interaction-task-runtime.mapper';
import type { ExecutorContext } from '../runtime/executor.interface';
import { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { type WechatNativeCommandKey } from './wechat-native-command.contract';

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
  resolveEvidenceFilePath(filePath: string | undefined): { filePath: string };
  resolveBrowserEvidenceFilePath(filename: string | undefined): {
    filePath: string;
  };
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
  cancelTask(id: string): Promise<InteractionTask>;
  editTask(
    id: string,
    patch: {
      replyText?: string;
      targetName?: string;
      dailyLimit?: number;
      intervalSeconds?: number;
    },
  ): Promise<InteractionTask>;
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
  createTaskResumeConfirmation(id: string): Promise<unknown>;
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
  exportTaskDiagnostics(
    id: string,
  ): Promise<InteractionTaskDiagnosticExportResult>;
  preflightDesktopInteractionTask(task: InteractionTask): Promise<unknown>;
  withTaskBillingContext(
    task: InteractionTask,
    ctx: ExecutorContext,
    scope: string,
  ): ExecutorContext;
  autoSendReplyViaRuntime(task: InteractionTask): Promise<unknown>;
  applyInteractionDraftResult(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
  ): void;
  applyRuntimeBatchTargetResults(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
    evidenceEventIds: string[],
  ): void;
  sendApprovedBrowserReplyViaRuntime(task: InteractionTask): Promise<unknown>;
  draftApprovedReplyViaRuntime(task: InteractionTask): Promise<unknown>;
  preflightBrowserTaskViaRuntime(task: InteractionTask): Promise<unknown>;
  toRuntimeInteractionTaskType(
    type: InteractionTaskType,
  ): 'comment-reply' | 'direct-message-reply' | undefined;
  resolveTenantScope(): Promise<LocalEngineTenantScope>;
  tenantScopeKey(scope: LocalEngineTenantScope): string;
  isInTenantScope(record: {
    tenantId?: string | null;
    userId?: string | null;
  }): boolean;
  tenantScopeForRecord(record: {
    tenantId?: string | null;
    userId?: string | null;
  }): LocalEngineTenantScope;
  useNodeAgentRuntime(): boolean;
  buildCurrentInteractionTaskBillingIdentity():
    | InteractionTaskBillingIdentity
    | undefined;
  allowLocalPlanBypass(): boolean;
  currentActorCommercialAllowed(): boolean;
  isPrismaTableMissingError(error: unknown, tableName?: string): boolean;
  getHealth(user?: LocalEngineEntitlementUser): Promise<LocalEngineHealth>;
  getFastCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]>;
  saveInteractionAsset(
    file?: AutoUploadUploadFile,
  ): Promise<{ ok: boolean; path?: string; message?: string }>;
  toRecordExportRows(task: InteractionTask): unknown;
  formatEvidenceIndexForCsv(
    items: Array<{
      id: string;
      eventId: string;
      type: string;
      label: string;
      level: string;
      stageKey?: string;
      createdAt: string;
      artifactUrl?: string;
      valuePreview?: string;
    }>,
  ): Array<Record<string, string>>;
  normalizeWindowTitles(desktop: {
    windowTitle?: string | null;
    windowTitles?: string[];
    currentWindowTitle?: string | null;
  }): string[];
  resolveLocalRuntimePaths(): Record<string, string>;
  inspectPath(target: {
    key: string;
    name: string;
    path: string;
    note?: string;
  }): Promise<{
    key: string;
    name: string;
    path: string;
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
    readable: boolean;
    writable: boolean;
    sizeBytes: number;
    mtime: string;
    note?: string;
  }>;
  collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds: string[],
  ): string[];
  normalizeStoredBatchTargets(task: InteractionTask): void;
  isSendMode(value: unknown): value is InteractionSendMode;
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
    @Optional()
    private readonly entitlements?: EntitlementsService,
  ) {}

  /**
   * 共享：从 RuntimeOrchestrator + 平台 sub-services 拉真 capability 状态
   * 同时被 getExecutorsStatus (GET /executors/status) 和
   *      assertCreateExecutionPreflight (创建任务时的预检) 使用
   * 避免之前 P3-D4 placeholder 写死空数组导致 capability 永远 undefined
   */

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

  /**
   * 微信任务字段契约：计划/群发/加好友/朋友圈发布共用的 wechat_* 元数据字段。
   * 创建任务时按此清单从输入提取并归一化，脚本侧按相同键名取参。
   */
  wechatTaskContractFields(): string[] {
    return [
      'wechat_plan_name',
      'wechat_plan_time',
      'wechat_plan_associated_wechat_id',
      'wechat_plan_kind',
      'wechat_mass_send_plan_type',
      'wechat_mass_send_chunked_sending',
      'wechat_mass_send_files',
      'wechat_mass_send_contents',
      'wechat_contact_add_verify_message',
      'wechat_contact_add_remark_strategy',
      'wechat_contact_add_remark_content',
      'wechat_contact_add_min_interval_seconds',
      'wechat_contact_add_max_interval_seconds',
      'wechat_moments_details',
      'wechat_moments_total_tasks',
      'wechat_moments_publish_interval_minutes',
      'wechat_moments_marketing_check_interval_minutes',
    ];
  }

  /**
   * 读取朋友圈发布任务详情（moments publish executor 的结构化记录）。
   * 从任务元数据还原发布内容、素材、附加评论与发布间隔，供执行器与审计使用。
   */
  readMomentsPublishDetails(task: {
    metadata?: unknown;
    payload?: unknown;
    id?: string;
  }): {
    command: string;
    content?: string;
    assetPaths?: string[];
    additionalComment?: string;
    publishIntervalMinutes?: number;
    marketingCheckIntervalMinutes?: number;
  } {
    const raw =
      (typeof task.metadata === 'object' && task.metadata !== null
        ? task.metadata
        : {}) || {};
    const record = raw as Record<string, unknown>;
    const content =
      typeof record.wechat_moments_details === 'string'
        ? record.wechat_moments_details
        : undefined;
    const totalTasks =
      typeof record.wechat_moments_total_tasks === 'number'
        ? record.wechat_moments_total_tasks
        : undefined;
    const publishIntervalMinutes =
      typeof record.wechat_moments_publish_interval_minutes === 'number'
        ? record.wechat_moments_publish_interval_minutes
        : undefined;
    const marketingCheckIntervalMinutes =
      typeof record.wechat_moments_marketing_check_interval_minutes === 'number'
        ? record.wechat_moments_marketing_check_interval_minutes
        : undefined;
    const additionalComment =
      typeof record.additionalComment === 'string'
        ? record.additionalComment
        : undefined;
    const assetPaths = Array.isArray(record.attachmentPaths)
      ? (record.attachmentPaths as string[])
      : undefined;
    return {
      command: 'wechat-moments-publish',
      content,
      assetPaths,
      additionalComment,
      publishIntervalMinutes,
      marketingCheckIntervalMinutes,
      ...(totalTasks !== undefined ? { totalTasks } : {}),
    };
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
Object.assign(LocalEngineService.prototype, runtimeExecMethods);
Object.assign(LocalEngineService.prototype, tenantMethods);
Object.assign(LocalEngineService.prototype, healthMethods);
Object.assign(LocalEngineService.prototype, miscMethods);
