import { api, type ApiRequestOptions, type ApiResponse } from "./client";

type LocalEngineRiskAction =
  | "local-file-delete"
  | "remote-control"
  | "runtime-control"
  | "agent-confirmation-approve"
  | "interaction-approval"
  | "interaction-resume";

type LocalEngineRiskLevel = "low" | "medium" | "high";

export interface LocalEngineRiskConfirmationInput {
  confirmed: boolean;
  confirmedAction: LocalEngineRiskAction | string;
  confirmedRiskLevel: LocalEngineRiskLevel | string;
  confirmationId?: string;
  operator?: string;
  reason?: string;
  note?: string;
  confirmedAt?: string;
  checklist?: Record<string, boolean>;
}

export function buildLocalEngineRiskConfirmation(
  action: LocalEngineRiskAction,
  level: LocalEngineRiskLevel = "high",
  reason?: string,
): LocalEngineRiskConfirmationInput {
  return {
    confirmed: true,
    confirmedAction: action,
    confirmedRiskLevel: level,
    reason,
  };
}

export type LocalEngineCapabilityStatus =
  | "ready"
  | "warning"
  | "missing"
  | "developing"
  | "blocked"
  | "degraded"
  | "optional";

export interface LocalEngineCapability {
  key:
    | "browser-control"
    | "interaction-capabilities"
    | "content-publishing"
    | "kaypal-entitlement"
    | "ai-reply-model"
    | "desktop-control"
    | "mcp-manager"
    | "agent-s-sidecar"
    | "wechat-execution"
    | "remote-control"
    | "plugin-runtime"
    | "memory-context"
    | "sandbox-execution"
    | "evidence-replay"
    | "file-access"
    | "permission-check";
  name: string;
  status: LocalEngineCapabilityStatus;
  required?: boolean;
  summary: string;
  checkedAt: string;
  nextAction?: string;
  checks?: Array<{
    name: string;
    status: LocalEngineCapabilityStatus;
    message: string;
  }>;
}

export interface LocalEngineHealth {
  online: boolean;
  ready?: boolean;
  requiredBlocked?: number;
  blockers?: Array<{
    capability: string;
    message: string;
    nextAction?: string;
  }>;
  service: string;
  version: string;
  mode: "live";
  engineUrl: string;
  engineNote?: string;
  checkedAt: string;
  uptimeSeconds: number;
  queue: {
    running: number;
    waitingForApproval: number;
    completed: number;
    failed: number;
  };
  capabilities: LocalEngineCapability[];
}

export interface LocalEngineRuntimeService {
  key: "frontend" | "backend" | "agent-s";
  name: string;
  url: string;
  port: number;
  online: boolean;
  managedByScreen: boolean;
  screenSession: string;
  logPath: string;
  logExists: boolean;
  pid?: number | null;
  message: string;
}

export type LocalEngineRuntimeServiceKey = LocalEngineRuntimeService["key"];

export interface LocalEngineRuntimeStatus {
  checkedAt: string;
  allOnline: boolean;
  logDir: string;
  startScript: string;
  stopScript: string;
  services: LocalEngineRuntimeService[];
}

export type LocalEngineRuntimeAction = "start" | "stop" | "restart";

export interface LocalEngineRuntimeActionResult {
  action: LocalEngineRuntimeAction;
  accepted: boolean;
  message: string;
  scriptPath: string;
  submittedAt: string;
}

export interface McpToolCallResponse {
  jsonrpc: string;
  id?: number;
  result?: {
    content?: Array<{
      type?: string;
      text?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

export interface AgentSRuntimeCapabilities {
  browserControl?: boolean;
  persistentProfiles?: boolean;
  localQueue?: boolean;
  evidenceStore?: boolean;
  approvalGate?: boolean;
  [key: string]: unknown;
}

export interface AgentSHealthSnapshot {
  ok?: boolean;
  status?: string;
  service?: string;
  version?: string;
  pid?: number;
  runner_mode?: string;
  runnerMode?: string;
  capabilities?: AgentSRuntimeCapabilities;
  blockers?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface AgentSRuntimeStatusSnapshot {
  state?: string;
  version?: string;
  pid?: number;
  runner_mode?: string;
  runnerMode?: string;
  session_count?: number;
  running_session_count?: number;
  uptime_ms?: number;
  artifact_root?: string;
  capabilities?: AgentSRuntimeCapabilities;
  blockers?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface AgentSManagerStatus {
  phase: string;
  baseUrl: string;
  connected: boolean;
  canSpawn: boolean;
  spawnImplemented: boolean;
  lastSeenAt?: string;
  lastError?: string;
  runner_mode?: string;
  runnerMode?: string;
  browserControl?: boolean;
  capabilities?: AgentSRuntimeCapabilities;
  blockers?: string[];
  warnings?: string[];
  sidecar?: {
    health?: AgentSHealthSnapshot;
    status?: AgentSRuntimeStatusSnapshot;
  };
  [key: string]: unknown;
}

export type AgentSConversationPurpose =
  | "general"
  | "research"
  | "draft"
  | "execute";

export type AgentSConversationStatus =
  | "idle"
  | "running"
  | "blocked"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentSConversationAttachment {
  filename: string;
  filepath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface AgentSConversationMessage {
  message_id: string;
  role: "user" | "assistant" | "system";
  kind: "message" | "result" | "status" | "confirmation";
  content: string;
  created_at: string;
  run_id?: string | null;
  status?: AgentSConversationStatus;
  purpose?: AgentSConversationPurpose;
  model_id?: string | null;
  attachments: AgentSConversationAttachment[];
  event_seq?: number | null;
  metadata: Record<string, unknown>;
}

export interface AgentSConversationEvent {
  seq: number;
  session_id: string;
  run_id?: string | null;
  event_type: string;
  status: AgentSConversationStatus;
  created_at: string;
  message?: string | null;
  step_index?: number | null;
  artifact_id?: string | null;
  payload: Record<string, unknown>;
}

export interface AgentSConversationSessionSummary {
  session_id: string;
  session_name?: string | null;
  task_type: string;
  status: AgentSConversationStatus;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  metadata: Record<string, unknown>;
  labels: string[];
  run_count: number;
  active_run_id?: string | null;
  cancellation_requested: boolean;
  last_error?: string | null;
  last_event_seq: number;
  artifact_count: number;
}

export interface AgentSConversationRunInput {
  instruction: string;
  task_type?: string | null;
  metadata?: Record<string, unknown>;
  risk_level?: "low" | "medium" | "high";
  requires_approval?: boolean;
  attachments?: AgentSConversationAttachment[];
}

export interface AgentSConversationSession {
  session: AgentSConversationSessionSummary;
  purpose: AgentSConversationPurpose;
  model_id: string | null;
  messages: AgentSConversationMessage[];
  events: AgentSConversationEvent[];
  last_run_input: AgentSConversationRunInput | null;
}

export interface AgentSConversationArtifact {
  artifact_id: string;
  session_id?: string;
  run_id?: string | null;
  kind: string;
  filename: string;
  path: string;
  created_at: string;
  size_bytes: number;
  metadata?: Record<string, unknown>;
}

export interface LocalEngineRuntimeLog {
  key: LocalEngineRuntimeServiceKey;
  name: string;
  logPath: string;
  exists: boolean;
  lines: string[];
  readAt: string;
}

export interface LocalEngineReadiness {
  ready: boolean;
  checkedAt: string;
  summary: {
    blockers: number;
    warnings: number;
    readyAccounts: number;
    expiredAccounts: number;
    fileWarnings: number;
  };
  blockers: Array<{
    capability: string;
    message: string;
    nextAction?: string;
  }>;
  warnings: Array<{
    capability: string;
    message: string;
    nextAction?: string;
  }>;
}

export interface LocalEngineBrowserAccount {
  id: number;
  platform: string;
  type: number;
  displayName: string;
  status: "ready" | "expired" | "needs_login" | "blocked" | "unverified";
  statusLabel: string;
  filePath: string;
  avatarUrl?: string | null;
  currentUrl?: string | null;
  lastError?: string | null;
  nextAction?: string | null;
}

export interface LocalEngineBrowserStatus {
  checkedAt: string;
  engineOnline: boolean;
  engineMessage: string;
  totalAccounts: number;
  readyAccounts: number;
  expiredAccounts: number;
  recovery?: {
    waitingTasks: number;
    resumableTasks: number;
    nextAction: string;
  };
  accounts: LocalEngineBrowserAccount[];
}

export type LocalEngineExecutorStatus =
  | "ready"
  | "preflight_only"
  | "missing"
  | "optional";

export interface LocalEngineExecutorCapability {
  key: InteractionTaskType | string;
  name: string;
  platformName: string;
  status: LocalEngineExecutorStatus;
  entryPreflight: boolean;
  targetRead: boolean;
  replyGenerate: boolean;
  controlledSend: boolean;
  autoSend?: boolean;
  message: string;
  nextAction: string;
}

export interface LocalEngineExecutorsStatus {
  checkedAt: string;
  summary: {
    total: number;
    ready: number;
    preflightOnly: number;
    missing: number;
  };
  executors: LocalEngineExecutorCapability[];
}

export interface LocalEngineActionBlocker {
  platform?: string;
  account?: string;
  target?: string;
  stage: string;
  reason: string;
  nextAction: string;
  capability?: string;
}

export interface LocalEngineFailureContext {
  platform?: string;
  account?: string;
  target?: string;
  stage?: string;
  reason: string;
  nextAction?: string;
}

export interface LocalEngineFileAccessItem {
  key: string;
  name: string;
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  kind: "directory" | "file" | "missing" | "unknown";
  fileCount?: number;
  directoryCount?: number;
  sizeBytes?: number;
  updatedAt?: string | null;
  note?: string;
  recentFiles?: Array<{
    name: string;
    path: string;
    kind: "directory" | "file" | "unknown";
    sizeBytes?: number;
    updatedAt?: string | null;
  }>;
}

export interface LocalEngineFileAccessStatus {
  checkedAt: string;
  summary: {
    total: number;
    ready: number;
    warnings: number;
  };
  roots: LocalEngineFileAccessItem[];
}

export interface LocalEngineInteractionAsset {
  filename: string;
  filepath: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export type InteractionTaskType =
  | "douyin-comment-reply"
  | "douyin-direct-message-reply"
  | "wechat-channel-comment-reply"
  | "wechat-channel-direct-message-reply"
  | "wechat-reply-draft"
  | "wechat-group-broadcast"
  | "wechat-contact-add"
  | "wechat-friend-accept"
  | "wechat-moments-publish"
  | "wechat-moments-marketing"
  | "customer-follow-up";

export type InteractionTaskStatus =
  | "queued"
  | "running"
  | "paused"
  | "blocked"
  | "waiting_for_send_confirmation"
  | "completed"
  | "failed"
  | "skipped"
  | "no_target";

export type AutomationTaskViewStatus =
  | "draft"
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "paused"
  | "partial_failed"
  | "failed"
  | "success"
  | "cancelled";

export type AutomationTaskView = {
  id: string;
  source: "interaction-task" | "agent-session";
  taskType: string;
  title: string;
  status: AutomationTaskViewStatus;
  statusLabel: string;
  executionMode: "real" | "simulated" | "configuration" | "blocked";
  riskLevel: AgentRiskLevel;
  currentStep?: string;
  nextAction?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  evidenceCount: number;
  confirmationRequired: boolean;
  taskId?: string;
  agentSessionId?: string;
  runtimeExecutionId?: string;
  metadata?: Record<string, unknown>;
};

export type InteractionSendMode = "approval-send" | "draft-only" | "auto-send";
export type InteractionReplyGeneratedBy = "ai" | "fallback";
export type InteractionGroupBroadcastPlanStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "paused"
  | "completed"
  | "failed"
  | "removed";
export type InteractionFollowUpMethod =
  | "wechat"
  | "message"
  | "phone"
  | "offline";

export interface MomentsPromptConfig {
  key?: string;
  title?: string;
  prompt: string;
  enabled?: boolean;
}

export interface MomentsPlanMetadata {
  dailyPublished?: number;
  dailyQuota?: number;
  scheduleStartTime?: string;
  autoLike?: boolean;
  autoComment?: boolean;
  recordSummary?: string;
  prompts?: MomentsPromptConfig[];
}

export type LocalEnginePlanMode = "trial" | "commercial";

export type LocalEnginePermissionStatus =
  | "allowed"
  | "approval_required"
  | "blocked"
  | "trial_limited";

export type LocalEngineSafetyCheckStatus = "ready" | "warning" | "blocked";

export type LocalEngineSafetyCheckCategory =
  | "scope"
  | "target"
  | "content"
  | "window"
  | "permission"
  | "commercial"
  | "send-protection"
  | "delete-protection";

export interface LocalEngineSafetyCheck {
  key: string;
  label: string;
  required: boolean;
  category: LocalEngineSafetyCheckCategory;
  status: LocalEngineSafetyCheckStatus;
  hint?: string;
  blocking?: boolean;
}

export interface LocalEngineSafetyBoundary {
  planMode: LocalEnginePlanMode;
  trialLimited: boolean;
  commercialExecutionAllowed: boolean;
  permissionStatus: LocalEnginePermissionStatus;
  message: string;
  allowedActions: string[];
  blockedActions: string[];
}

export interface LocalEngineMisfireProtection {
  sendProtected: boolean;
  deleteProtected: boolean;
  targetLockRequired: boolean;
  contentPreviewRequired: boolean;
  destructiveActionBlocked: boolean;
  warning: string;
}

export type LocalEngineEvidenceType =
  | "text"
  | "snapshot"
  | "screenshot"
  | "page_snapshot"
  | "desktop_screenshot"
  | "stage_log"
  | "failure_reason"
  | "diagnostic_bundle"
  | "file";

export interface LocalEngineEvidence {
  id?: string;
  type: LocalEngineEvidenceType;
  label: string;
  value: string;
  stageKey?: string;
  artifactUrl?: string;
  mimeType?: string;
  createdAt?: string;
}

export interface LocalEngineRiskPolicy {
  planMode: LocalEnginePlanMode;
  requiredRole: "operator" | "manager" | "admin";
  approverRoles: Array<"manager" | "admin">;
  targetName: string;
  targetWhitelisted: boolean;
  whitelistTargets: string[];
  forbiddenActions: string[];
  forbiddenActionHits: string[];
  remoteTakeoverAuditRequired: boolean;
  auditRequiredReason?: string;
  remoteAudit: Array<{
    action: "requested" | "approved" | "started" | "stopped" | "rejected";
    operator: string;
    reason: string;
    createdAt: string;
  }>;
  message: string;
}

export type InteractionBatchTargetStatus =
  | "queued"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "failed"
  | "skipped"
  | "no_target";

export interface InteractionBatchTarget {
  id: string;
  targetName: string;
  sourceText: string;
  replyText: string;
  sourceUrl?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  status: InteractionBatchTargetStatus;
  failureReason?: string;
  nextAction?: string;
  evidenceRef?: string;
  evidenceEventIds?: string[];
  updatedAt?: string;
}

export interface InteractionBatchSummary {
  total: number;
  queued?: number;
  running?: number;
  waitingConfirmation?: number;
  completed: number;
  failed: number;
  skipped: number;
  noTarget: number;
}

export interface ResendGroupBroadcastPlanInput {
  planName?: string;
  planTime?: string;
  dailyLimit?: number;
  associatedWeChat?: string;
  generateOnDemand?: boolean;
  targetIds?: string[];
  targetNames?: string[];
  onlyFailed?: boolean;
  onlyUnsent?: boolean;
  immediate?: boolean;
  sendMode?: InteractionSendMode;
  replyText?: string;
  sourceText?: string;
  metadata?: Record<string, unknown>;
  riskConfirmation?: LocalEngineRiskConfirmationInput;
  batchTargets?: Array<{
    targetName?: string;
    sourceText?: string;
    replyText?: string;
    sourceUrl?: string;
    profileUrl?: string;
    commentTime?: string;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
  }>;
}

export interface RetryInteractionTaskInput {
  targetIds?: string[];
  onlyFailed?: boolean;
  onlyUnsent?: boolean;
}

export interface InteractionBatchTargetListResult {
  taskId: string;
  planName?: string;
  planStatus?: InteractionGroupBroadcastPlanStatus;
  summary?: InteractionBatchSummary;
  items: InteractionBatchTarget[];
}

export type InteractionRouteKey =
  | "comments"
  | "messages"
  | "channel-comments"
  | "channel-messages"
  | "wechat"
  | "groups"
  | "moments"
  | "customers"
  | "rules"
  | "records";
export type InteractionBusinessRouteKey = Extract<
  InteractionRouteKey,
  | "comments"
  | "messages"
  | "channel-comments"
  | "channel-messages"
  | "wechat"
  | "groups"
  | "moments"
  | "customers"
>;

export type InteractionTaskResultKind =
  | "success"
  | "failure"
  | "skipped"
  | "no_target"
  | "waiting"
  | "running";

export interface InteractionTaskResultSummary {
  kind: InteractionTaskResultKind;
  headline: string;
  detail: string;
  nextAction: string;
  evidenceCount: number;
  recordsHref: string;
  evidenceHref: string;
  diagnosticsHref: string;
  counts: {
    total: number;
    completed: number;
    failed: number;
    skipped: number;
    noTarget: number;
  };
}

export interface InteractionTaskEvent {
  id: string;
  taskId: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  createdAt: string;
  evidence?: LocalEngineEvidence;
}

export type InteractionTaskStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "skipped";

export interface InteractionTaskStep {
  key: string;
  label: string;
  status: InteractionTaskStepStatus;
  message: string;
  updatedAt?: string;
}

export interface InteractionApprovalRecord {
  operator: string;
  note?: string;
  currentWindowConfirmed: boolean;
  contactConfirmed?: boolean;
  draftBeforeFillConfirmed?: boolean;
  targetContact?: string;
  targetConfirmed: boolean;
  contentConfirmed: boolean;
  checklistConfirmed?: boolean;
  commercialPermissionConfirmed?: boolean;
  misfireProtectionConfirmed?: boolean;
  doubleConfirmationConfirmed?: boolean;
  confirmedChecklistKeys?: string[];
  confirmedAt: string;
}

export interface InteractionTask {
  id: string;
  type: InteractionTaskType;
  typeLabel: string;
  status: InteractionTaskStatus;
  statusLabel: string;
  accountId?: string;
  accountName: string;
  platformType?: number;
  platformName?: string;
  targetName: string;
  sourceText: string;
  replyText: string;
  sourceUrl?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  metadata?: Record<string, unknown>;
  planName?: string;
  planTime?: string;
  planStatus?: InteractionGroupBroadcastPlanStatus;
  dailyLimit?: number;
  associatedWeChat?: string;
  generateOnDemand?: boolean;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  sendMode: InteractionSendMode;
  requestedSendMode?: InteractionSendMode;
  riskLevel?: AgentRiskLevel;
  requiresDoubleConfirmation?: boolean;
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  riskChecklist?: LocalEngineSafetyCheck[];
  executionMode: "browser-assisted" | "internal-record";
  runtimeState?:
    | "preflight_only"
    | "executor_missing"
    | "live_ready"
    | "record_ready"
    | "running"
    | "completed"
    | "blocked";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
  failureContext?: LocalEngineFailureContext;
  blockers?: LocalEngineActionBlocker[];
  nextAction?: string;
  batchTargets?: InteractionBatchTarget[];
  batchSummary?: InteractionBatchSummary;
  approvalRecord?: InteractionApprovalRecord;
  diagnostics?: {
    status:
      | "normal"
      | "waiting"
      | "blocked"
      | "completed"
      | "skipped"
      | "no_target";
    summary: string;
    account: string;
    platform: string;
    currentStep?: string;
    currentStepStatus?: InteractionTaskStepStatus;
    currentStepMessage?: string;
    failureReason?: string;
    nextAction?: string;
    evidenceCount: number;
    lastEventAt?: string;
  };
  resultSummary?: InteractionTaskResultSummary;
  steps?: InteractionTaskStep[];
  events: InteractionTaskEvent[];
}

export interface InteractionRecordsSummary {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  skipped: number;
  noTarget: number;
  evidenceCount: number;
  byType: Record<InteractionTaskType, number>;
  lastUpdatedAt?: string;
}

export interface InteractionRecordsResult {
  items: InteractionTask[];
  summary: InteractionRecordsSummary;
}

export interface WechatContactsResult {
  source: string;
  contacts: string[];
  items: WechatContact[];
  count: number;
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  screenshotPath?: string;
  diagnostics?: WechatContactsSyncDiagnostics;
  cached?: boolean;
  syncFallbackReason?: string;
}

export type WechatContactsSyncMode = "random" | "all";

export interface WechatContactsSyncInput {
  force?: boolean;
  mode?: WechatContactsSyncMode;
}

export interface WechatContactsReadinessCheck {
  key: string;
  name: string;
  status: LocalEngineCapabilityStatus;
  message: string;
  nextAction?: string;
  details?: Record<string, unknown>;
}

export interface WechatContactsReadinessResult {
  ready: boolean;
  status: "ready" | "warning" | "blocked";
  checkedAt: string;
  platform: string;
  modeSupport: {
    random: boolean;
    all: boolean;
  };
  cached: {
    count: number;
    source: string;
    syncedAt?: string;
  };
  paths: {
    nativeRuntimePath?: string;
    enginePath?: string;
    sqlitePath?: string;
    dbHelperPath?: string;
  };
  checks: WechatContactsReadinessCheck[];
  blockers: WechatContactsReadinessCheck[];
  warnings: WechatContactsReadinessCheck[];
  diagnostics?: WechatContactsSyncDiagnostics;
  lastFailure?: Record<string, unknown>;
  nextAction: string;
}

export interface WechatContactsSyncDiagnostics {
  stage?: string;
  source?: string;
  contractVersion?: string;
  contactsContract?: Record<string, unknown>;
  pagesScanned?: number;
  uiaContactCount?: number;
  ocrContactCount?: number;
  dbContactCount?: number;
  rawTextCount?: number;
  screenshotPath?: string;
  engine?: string;
  engineVersion?: string;
  enginePath?: string;
  nativeRuntimePath?: string;
  nativeRuntimeVersion?: string;
  decryptionHelperPath?: string;
  fallbackReason?: string;
  wechatVersion?: string;
  dbKeyStatus?: string;
  dbPaths?: string[];
  dbCandidateDetails?: Array<Record<string, unknown>>;
  dbCandidateResults?: Array<Record<string, unknown>>;
  dbError?: string;
  dbTotalContactCount?: number;
  selectedDbPath?: string;
  selectedDbAccountFolder?: string;
  selectedDbBaseWxid?: string;
  selectedDbActiveMtime?: string;
  selectedDbScore?: number;
  sqlitePath?: string;
  dbHelper?: string;
  helperError?: string;
  keyHelperStatus?: string;
  decryptionStatus?: string;
  resultSource?: string;
  externalKeyToolStatus?: string;
  externalRawKeyToolStatus?: string;
  externalKeyToolCandidates?: Record<string, unknown>;
  externalKeyToolCompatibility?: Array<Record<string, unknown>>;
  externalDbKeyAttempts?: Array<Record<string, unknown>>;
  externalDumpRsPidAttempts?: Array<Record<string, unknown>>;
  externalWxKeyDllAttempts?: Array<Record<string, unknown>>;
  decryptAttempts?: Array<Record<string, unknown>>;
  wechatProcessArchitectures?: Array<Record<string, unknown>>;
  keyScanDiagnostics?: string;
  memoryScanStatus?: string;
  blockedReasons?: string[];
  externalKeyToolCrash?: boolean;
  externalKeyToolTimeout?: boolean;
  externalKeyToolIncompatible?: boolean;
  externalKeyToolUnsupported?: boolean;
  processName?: string;
  processId?: number;
  windowTitle?: string;
  windowRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  screen?: {
    width: number;
    height: number;
  };
  os?: string;
  isCurrentProcessElevated?: boolean;
  attemptedSources?: string[];
  warnings?: string[];
  rawPreview?: string[];
  ocrPreview?: string[];
  runtimeCapabilities?: string[];
  failureReason?: string;
  failureLayer?: string;
  platformStatus?: string;
  windowStatus?: string;
  dbStatus?: string;
  helperStatus?: string;
  uiaStatus?: string;
  uiaStopReason?: string;
  layers?: Record<string, unknown>;
  uiaPageSummaries?: Array<Record<string, unknown>>;
  uiaNodeCount?: number;
}

export class WechatContactsSyncError extends Error {
  diagnostics?: WechatContactsSyncDiagnostics;
  status?: number;
  response?: unknown;

  constructor(
    message: string,
    options: {
      diagnostics?: WechatContactsSyncDiagnostics;
      status?: number;
      response?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "WechatContactsSyncError";
    this.diagnostics = options.diagnostics;
    this.status = options.status;
    this.response = options.response;
  }
}

function maybeWechatContactsSyncDiagnostics(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  return value as WechatContactsSyncDiagnostics;
}

function extractWechatContactsSyncDiagnostics(value: unknown): WechatContactsSyncDiagnostics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = maybeWechatContactsSyncDiagnostics(record.diagnostics);
  if (direct) return direct;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
  if (data?.diagnostics) return maybeWechatContactsSyncDiagnostics(data.diagnostics);
  const response = record.response && typeof record.response === "object" ? record.response as Record<string, unknown> : undefined;
  if (response?.diagnostics) return maybeWechatContactsSyncDiagnostics(response.diagnostics);
  if (response?.data && typeof response.data === "object") {
    return maybeWechatContactsSyncDiagnostics((response.data as Record<string, unknown>).diagnostics);
  }
  return undefined;
}

function extractWechatContactsSyncMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "reason"]) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) return item.trim();
  }
  const response = record.response && typeof record.response === "object" ? record.response as Record<string, unknown> : undefined;
  if (typeof response?.message === "string") return response.message;
  return "";
}

export interface WechatContact {
  wxid: string;
  nickname?: string;
  remark?: string;
  tags: string[];
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  updatedAt: string;
  createdAt: string;
}

export interface UpsertWechatContactInput {
  wxid?: string;
  nickname?: string;
  remark?: string;
  tags?: string[];
  currentWechatId?: string;
  plannedWechatId?: string;
}

export interface WechatContactsExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: "OK" | "FAILED";
  count: number;
}

export interface WechatContactsDiagnosticsExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exists: boolean;
}

export type WechatChatHistorySource =
  | "empty"
  | "local-cache"
  | "macos-wechat-rpa"
  | "macos-wechat-ocr"
  | "wechat-db"
  | "manual-import";

export type WechatChatHistoryStatus = "ready" | "empty" | "blocked" | "error";

export interface WechatChatSession {
  id: string;
  title: string;
  contactName?: string;
  avatarUrl?: string | null;
  unreadCount: number;
  lastMessage?: string;
  lastMessageAt?: string;
  updatedAt?: string;
  source: WechatChatHistorySource;
  raw?: Record<string, unknown>;
}

export interface WechatChatMessage {
  id: string;
  sessionId: string;
  senderName?: string;
  direction: "incoming" | "outgoing" | "system" | "unknown";
  content: string;
  contentType: "text" | "image" | "file" | "system" | "unknown";
  sentAt?: string;
  createdAt?: string;
  source: WechatChatHistorySource;
  raw?: Record<string, unknown>;
}

export interface WechatChatHistoryCacheInfo {
  path: string;
  cached: boolean;
  syncedAt?: string;
  source: WechatChatHistorySource;
}

export interface WechatChatSessionsResult {
  status: WechatChatHistoryStatus;
  source: WechatChatHistorySource;
  sessions: WechatChatSession[];
  count: number;
  syncedAt?: string;
  cached: boolean;
  blockers: string[];
  warnings: string[];
  nextAction?: string;
  cache: WechatChatHistoryCacheInfo;
}

export interface WechatChatHistoryResult {
  status: WechatChatHistoryStatus;
  source: WechatChatHistorySource;
  sessionId: string;
  session?: WechatChatSession;
  messages: WechatChatMessage[];
  count: number;
  syncedAt?: string;
  cached: boolean;
  blockers: string[];
  warnings: string[];
  nextAction?: string;
  cache: WechatChatHistoryCacheInfo;
}

export interface SyncWechatChatHistoryInput {
  force?: boolean;
  sessionId?: string;
  limit?: number;
  operator?: string;
  note?: string;
}

export interface SyncWechatChatHistoryResult extends WechatChatSessionsResult {
  ok: boolean;
  syncAttempted: boolean;
  scriptPath: string;
  message: string;
}

export interface InteractionRecordsExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: "OK" | "FAILED";
  summary: InteractionRecordsSummary;
}

export interface InteractionTaskDiagnosticExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: "OK" | "FAILED";
}

export interface InteractionEvidenceCleanupResult {
  directory: string;
  retentionDays: number;
  execute: boolean;
  candidateCount: number;
  deletedCount: number;
  totalBytes: number;
  files: Array<{
    name: string;
    path: string;
    sizeBytes: number;
    updatedAt: string;
  }>;
  errors: string[];
  checkedAt: string;
  status: {
    directory: string;
    urlPrefix: string;
    fileCount: number;
    totalBytes: number;
    latestUpdatedAt?: string | null;
  };
}

export interface CreateInteractionTaskInput {
  type: InteractionTaskType;
  accountId?: string;
  accountName?: string;
  platformType?: number;
  platformName?: string;
  targetName?: string;
  sourceText?: string;
  replyText?: string;
  sourceUrl?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  metadata?: Record<string, unknown>;
  planName?: string;
  planTime?: string;
  planStatus?: InteractionGroupBroadcastPlanStatus;
  dailyLimit?: number;
  associatedWeChat?: string;
  currentWechatId?: string;
  plannedWechatId?: string;
  generateOnDemand?: boolean;
  verifyMessage?: string;
  blacklist?: string[];
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  remarkStrategy?: string;
  remarkContent?: string;
  planType?: string;
  chunkedSending?: boolean;
  massSendFiles?: string[];
  momentsDetails?: Array<Record<string, unknown>>;
  momentsTotalCount?: number;
  publishIntervalMinutes?: number;
  checkIntervalMinutes?: number;
  dailyPublished?: number;
  dailyQuota?: number;
  scheduleStartTime?: string;
  autoLike?: boolean;
  autoComment?: boolean;
  recordSummary?: string;
  prompts?: MomentsPromptConfig[];
  sendMode?: InteractionSendMode;
  commercialExecutionRequested?: boolean;
  followUpMethod?: InteractionFollowUpMethod;
  batchTargets?: Array<{
    targetName?: string;
    sourceText: string;
    replyText?: string;
    sourceUrl?: string;
    profileUrl?: string;
    commentTime?: string;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
  }>;
}

export interface InteractionApprovalInput {
  operator?: string;
  note?: string;
  /** 人工修改后的回复文本，确认时覆盖原草稿发送 */
  replyText?: string;
  currentWindowConfirmed?: boolean;
  contactConfirmed?: boolean;
  draftBeforeFillConfirmed?: boolean;
  targetContact?: string;
  targetConfirmed?: boolean;
  contentConfirmed?: boolean;
  checklistConfirmed?: boolean;
  commercialPermissionConfirmed?: boolean;
  misfireProtectionConfirmed?: boolean;
  doubleConfirmationConfirmed?: boolean;
  riskConfirmation?: LocalEngineRiskConfirmationInput;
}

export interface InteractionReplyRuleConfig {
  botName?: string;
  botType?: "sales" | "advisor";
  authorizedAccounts?: string[];
  replyDelay?: string;
  whitelist?: string[];
  noReplyScenarios?: string[];
  fileRequestPolicy?: string;
  contactScope?: "wechat" | "douyin" | "all";
  knowledgeScope?: "local" | "selected" | "none";
  selectedKnowledgeId?: string;
  industryName: string;
  tone: "warm" | "professional" | "concise";
  defaultSendMode: InteractionSendMode;
  askForContact: boolean;
  commentParsingMode: "rules" | "none";
  commentRulePreset: "strict" | "loose";
  commentRequireActionAndTime: boolean;
  commentAllowShortText: boolean;
  commentSkipHandled: boolean;
  commentQuestionOnly: boolean;
  commentMinLength: number;
  commentMaxLength: number;
  commentWhitelistKeywords: string[];
  commentExcludeAuthorKeywords: string[];
  commentNoiseKeywords: string[];
  commentPriorityKeywords: string[];
  fallbackEnabled: boolean;
  fallbackReplies: string[];
  allowFallbackAutoSend: boolean;
  requireApprovalKeywords: string[];
  blockedKeywords: string[];
  serviceHighlights: string[];
  closingText: string;
  updatedAt: string;
}

export interface InteractionGeneratedReply {
  replyText: string;
  generatedBy: "ai" | "fallback";
  rule: InteractionReplyRuleConfig;
}

export type AgentSessionStatus =
  | "draft"
  | "running"
  | "waiting_for_confirmation"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentExecutionScope =
  | "browser"
  | "desktop"
  | "local-files"
  | "remote"
  | "mixed";

export type AgentSessionSource =
  | "agent-console"
  | "publishing"
  | "interaction"
  | "system"
  | "web";

export type AgentRiskLevel = "low" | "medium" | "high";

export type AgentConfirmationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

export interface AgentEvidence {
  id?: string;
  type: LocalEngineEvidenceType;
  label: string;
  value: string;
  stageKey?: string;
  artifactUrl?: string;
  mimeType?: string;
  createdAt?: string;
  eventId?: string;
  sessionId?: string;
}

export interface AgentSessionEvent {
  id: string;
  sessionId: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  createdAt: string;
  evidence?: AgentEvidence;
}

export interface AgentConfirmation {
  id: string;
  sessionId: string;
  title: string;
  description: string;
  actionLabel: string;
  riskLevel: Exclude<AgentRiskLevel, "low">;
  status: AgentConfirmationStatus;
  confirmationMode?: "standard" | "double-confirmation";
  requiredChecks: LocalEngineSafetyCheck[];
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  commercialPermissionRequired?: boolean;
  trialLimited?: boolean;
  blockedReason?: string;
  createdAt: string;
  decidedAt?: string;
  operator?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
  session?: {
    id: string;
    title: string;
    source: AgentSessionSource;
    status: AgentSessionStatus;
    statusLabel: string;
    riskLevel: AgentRiskLevel;
    updatedAt: string;
    nextAction?: string;
    targetApp?: string;
    targetUrl?: string;
    resumeAction?: AgentSessionResumeAction;
  };
}

export type AgentSessionResumeAction =
  | {
      kind: "auto-upload-publish";
      label: string;
      payloads: unknown[];
    }
  | {
      kind: "agentwaker-handoff";
      label: string;
      articleId: string;
      role: "xiaohongshu-operator" | "wechat-official-account-operator";
      workflow: string;
      targetHref: string;
    };

export interface AgentSession {
  id: string;
  title: string;
  instruction: string;
  status: AgentSessionStatus;
  statusLabel: string;
  executionScope: AgentExecutionScope;
  source: AgentSessionSource;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  nextAction?: string;
  failureReason?: string;
  targetApp?: string;
  targetUrl?: string;
  riskLevel: AgentRiskLevel;
  requiresDoubleConfirmation?: boolean;
  commercialExecutablePermission?: LocalEnginePermissionStatus;
  blockers?: LocalEngineActionBlocker[];
  failureContext?: LocalEngineFailureContext;
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  resumeAction?: AgentSessionResumeAction;
  metadata?: Record<string, unknown>;
  steps?: InteractionTaskStep[];
  requiredChecks?: LocalEngineSafetyCheck[];
  confirmations: AgentConfirmation[];
  events: AgentSessionEvent[];
}

export interface AgentSessionListParams {
  limit?: number;
  status?: AgentSessionStatus;
  source?: AgentSessionSource;
  riskLevel?: AgentRiskLevel;
  executionScope?: AgentExecutionScope;
  targetApp?: string;
  hasPendingConfirmation?: boolean;
  hasEvidence?: boolean;
  keyword?: string;
}

function isHiddenAgentSession(session: AgentSession) {
  const hidden = session.metadata?.hiddenFromAiEmployee;
  return hidden === true || hidden === "true" || hidden === 1;
}

export interface AgentSessionEvidenceExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  sessionId: string;
  evidenceCount: number;
  timelineCount: number;
}

export interface CreateAgentSessionInput {
  title?: string;
  instruction: string;
  executionScope?: AgentExecutionScope;
  source?: AgentSessionSource;
  targetApp?: string;
  targetUrl?: string;
  dryRun?: boolean;
  commercialExecutionRequested?: boolean;
  resumeAction?: AgentSessionResumeAction;
  metadata?: Record<string, unknown>;
}

export interface ContinueAgentSessionInput {
  instruction?: string;
  operator?: string;
}

export interface ArchiveAgentSessionInput {
  operator?: string;
  reason?: string;
}

export interface AgentConfirmationDecisionInput {
  operator?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
  riskConfirmation?: LocalEngineRiskConfirmationInput & {
    fullPermission?: boolean;
  };
}

export type LocalEngineDesktopPermissionKey =
  | "accessibility"
  | "screen-recording"
  | "automation"
  | "clipboard";

export interface LocalEngineDesktopPermissionCheck {
  key: LocalEngineDesktopPermissionKey;
  label: string;
  status: LocalEnginePermissionStatus;
  message: string;
  nextAction?: string;
}

export interface LocalEngineDesktopWindowStatus {
  appName?: string;
  windowTitle?: string;
  bundleId?: string;
  isWechat?: boolean;
  running?: boolean;
  frontmost?: boolean;
  windowCount?: number;
  currentWindowTitle?: string | null;
  currentWindowLikelyWechatChat?: boolean;
  contactHint?: string | null;
  currentWindowConfirmed: boolean;
  targetContact?: string;
  contactConfirmed: boolean;
  message: string;
  checkedAt?: string;
}

export interface LocalEngineDesktopScreenshotEvidence {
  type: "screenshot" | "text" | "diagnostic_bundle";
  label: string;
  value: string;
  capturedAt: string;
  trusted?: boolean;
  diagnostic?: string;
  textSample?: string;
}

export interface LocalEngineDesktopStatus {
  available: boolean;
  platform: string;
  checkedAt: string;
  permissionChecks: LocalEngineDesktopPermissionCheck[];
  window: LocalEngineDesktopWindowStatus;
  screenshot?: LocalEngineDesktopScreenshotEvidence;
  recentEvidence: LocalEngineDesktopScreenshotEvidence[];
  blockers: string[];
  warnings: string[];
  nextAction?: string;
  takeoverActive: boolean;
  stopped: boolean;
}

export interface LocalEngineWechatSessionStatus {
  checkedAt?: string;
  desktop: LocalEngineDesktopStatus;
  targetContact?: string;
  alignment?: {
    ok: boolean;
    stage: string;
    targetText: string;
    searchedText?: string;
    matchedTitle?: string | null;
    windowTitle?: string | null;
    message: string;
    nextAction?: string;
    screenshotPath?: string;
    pageTextSample?: string;
    ambiguous: boolean;
    alignedAt: string;
  };
  currentWindowConfirmed: boolean;
  contactConfirmed: boolean;
  draftBeforeFillConfirmed: boolean;
  manualTakeoverActive?: boolean;
  canDraft: boolean;
  takeoverActive: boolean;
  stopped: boolean;
  stoppedAt?: string;
  stopReason?: string;
  updatedAt?: string;
  blockers?: string[];
  warnings?: string[];
  evidence?: LocalEngineDesktopScreenshotEvidence[];
  lock?: {
    locked: boolean;
    lockedAt?: string;
    windowTitle?: string | null;
    targetContact?: string;
    message: string;
  };
  anomalySummary?: {
    loggedOut: boolean;
    popupDetected: boolean;
    contactAmbiguous: boolean;
    permissionBlocked: boolean;
  };
  nextAction?: string;
}

export interface UpdateWechatSessionConfirmationInput {
  targetContact?: string;
  currentWindowConfirmed?: boolean;
  contactConfirmed?: boolean;
  draftBeforeFillConfirmed?: boolean;
  currentWindowTitle?: string | null;
  contactAmbiguityResolved?: boolean;
  popupCleared?: boolean;
  loggedInConfirmed?: boolean;
  operator?: string;
  note?: string;
}

export interface AlignWechatSessionInput {
  targetContact?: string;
  operator?: string;
  note?: string;
}

export interface WechatSessionControlInput {
  operator?: string;
  reason?: string;
  riskConfirmation?: LocalEngineRiskConfirmationInput;
}

export const localEngineApi = {
  health(options?: ApiRequestOptions) {
    return api.get<LocalEngineHealth>("/local-engine/health", options);
  },

  runtimeStatus() {
    return api.get<LocalEngineRuntimeStatus>("/local-engine/runtime/status");
  },

  mcpStatus() {
    return api.get<{
      success: boolean;
      data: {
        playwright: {
          online: boolean;
          childProcessRunning: boolean;
          transport: string;
          endpoint: string;
          pid?: number;
          toolCount?: number;
          message: string;
        };
        runtime: {
          available: boolean;
          serverCount: number;
          toolCount: number;
          message: string;
        };
      };
    }>("/mcp/status");
  },

  mcpTools() {
    return api.get<{
      success: boolean;
      data: {
        playwright: Array<{ name: string; description?: string }>;
      };
    }>("/mcp/tools");
  },

  mcpCallTool(name: string, args: Record<string, unknown>) {
    return api.post<McpToolCallResponse>("/mcp/playwright", {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    });
  },

  runRuntimeAction(action: LocalEngineRuntimeAction) {
    return api.post<LocalEngineRuntimeActionResult>(
      `/local-engine/runtime/${action}`,
    );
  },

  runtimeLog(key: LocalEngineRuntimeServiceKey, lines = 80) {
    return api.get<LocalEngineRuntimeLog>(
      `/local-engine/runtime/logs/${key}?lines=${lines}`,
    );
  },

  readiness(options?: ApiRequestOptions) {
    return api.get<LocalEngineReadiness>("/local-engine/readiness", options);
  },

  browserStatus(options?: ApiRequestOptions) {
    return api.get<LocalEngineBrowserStatus>(
      "/local-engine/browser/status",
      options,
    );
  },

  desktopStatus() {
    return api.get<LocalEngineDesktopStatus>("/local-engine/desktop/status");
  },

  wechatSessionStatus() {
    return api.get<LocalEngineWechatSessionStatus>(
      "/local-engine/wechat/session/status",
    );
  },
  wechatContacts() {
    return api.get<WechatContactsResult>("/local-engine/wechat/contacts");
  },
  wechatContactsReadiness() {
    return api.get<WechatContactsReadinessResult>(
      "/local-engine/wechat/contacts/readiness",
    );
  },
  upsertWechatContact(input: UpsertWechatContactInput) {
    return api.post<WechatContactsResult>(
      "/local-engine/wechat/contacts",
      input,
    );
  },
  removeWechatContact(wxid: string) {
    return api.delete<WechatContactsResult>(
      `/local-engine/wechat/contacts/${encodeURIComponent(wxid)}`,
    );
  },
  clearWechatContacts() {
    return api.delete<WechatContactsResult>("/local-engine/wechat/contacts");
  },
  exportWechatContacts() {
    return api.get<WechatContactsExportResult>(
      "/local-engine/wechat/contacts/export",
    );
  },
  exportWechatContactSyncDiagnostics() {
    return api.get<WechatContactsDiagnosticsExportResult>(
      "/local-engine/wechat/contacts/diagnostics/export",
    );
  },
  syncWechatContacts(input: boolean | WechatContactsSyncInput = false) {
    const payload =
      typeof input === "boolean" ? { force: input } : input;
    return fetch(api.url("/local-engine/wechat/contacts/sync"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    }).then(async (response) => {
      const text = await response.text();
      let json: ApiResponse<WechatContactsResult> | Record<string, unknown> | null = null;
      if (text) {
        try {
          json = JSON.parse(text) as ApiResponse<WechatContactsResult>;
        } catch {
          json = null;
        }
      }
      if (!response.ok || !(json && "success" in json && json.success === true)) {
        const diagnostics = extractWechatContactsSyncDiagnostics(json);
        const message =
          extractWechatContactsSyncMessage(json) ||
          (text && !text.trim().startsWith("{") ? text.trim() : "") ||
          `请求失败: ${response.status}`;
        throw new WechatContactsSyncError(message, {
          diagnostics,
          status: response.status,
          response: json || text,
        });
      }
      return (json as ApiResponse<WechatContactsResult>).data;
    });
  },
  wechatChatSessions() {
    return api.get<WechatChatSessionsResult>(
      "/local-engine/wechat/chat-sessions",
    );
  },
  wechatChatHistory(sessionId: string, limit = 100) {
    const params = new URLSearchParams({
      sessionId,
      limit: String(limit),
    });
    return api.get<WechatChatHistoryResult>(
      `/local-engine/wechat/chat-history?${params.toString()}`,
    );
  },
  syncWechatChatHistory(input: SyncWechatChatHistoryInput = {}) {
    return api.post<SyncWechatChatHistoryResult>(
      "/local-engine/wechat/chat-history/sync",
      input,
    );
  },

  confirmWechatSession(input: UpdateWechatSessionConfirmationInput) {
    return api.post<LocalEngineWechatSessionStatus>(
      "/local-engine/wechat/session/confirm",
      input,
    );
  },

  alignWechatSession(input: AlignWechatSessionInput) {
    return api.post<LocalEngineWechatSessionStatus>(
      "/local-engine/wechat/session/align",
      input,
    );
  },

  takeoverWechatSession(input?: WechatSessionControlInput) {
    return api.post<LocalEngineWechatSessionStatus>(
      "/local-engine/wechat/session/takeover",
      input || {},
    );
  },

  stopWechatSession(input?: WechatSessionControlInput) {
    return api.post<LocalEngineWechatSessionStatus>(
      "/local-engine/wechat/session/stop",
      input || {},
    );
  },

  executorsStatus() {
    return api.get<LocalEngineExecutorsStatus>(
      "/local-engine/executors/status",
    );
  },

  fileAccessStatus() {
    return api.get<LocalEngineFileAccessStatus>("/local-engine/files/status");
  },

	evidenceFileUrl(filePath?: string | null) {
		const value = String(filePath || "").trim();
		if (!value) return "";
		if (value.startsWith("/api/")) {
			return api.url(value.replace(/^\/api/, ""));
		}
		if (
			/^https?:\/\//i.test(value) &&
			!/\/Users\/|\.local-logs|\/tmp\//i.test(value)
    ) {
      return value;
    }
    return api.url(
      `/local-engine/evidence/file?path=${encodeURIComponent(value)}`,
    );
  },

  agentSessions(params: number | AgentSessionListParams = 50) {
    const options: AgentSessionListParams =
      typeof params === "number" ? { limit: params } : params;
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.status) query.set("status", options.status);
    if (options.source) query.set("source", options.source);
    if (options.riskLevel) query.set("riskLevel", options.riskLevel);
    if (options.executionScope)
      query.set("executionScope", options.executionScope);
    if (options.targetApp?.trim())
      query.set("targetApp", options.targetApp.trim());
    if (typeof options.hasPendingConfirmation === "boolean") {
      query.set(
        "hasPendingConfirmation",
        String(options.hasPendingConfirmation),
      );
    }
    if (typeof options.hasEvidence === "boolean")
      query.set("hasEvidence", String(options.hasEvidence));
    if (options.keyword?.trim()) query.set("keyword", options.keyword.trim());
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api
      .get<AgentSession[]>(`/local-engine/agent-sessions${suffix}`)
      .then((sessions) =>
        (Array.isArray(sessions) ? sessions : []).filter(
          (session) => !isHiddenAgentSession(session),
        ),
      );
  },

  createAgentSession(input: CreateAgentSessionInput) {
    return api.post<AgentSession>("/local-engine/agent-sessions", input);
  },

  agentSession(id: string) {
    return api.get<AgentSession>(`/local-engine/agent-sessions/${id}`);
  },

  exportAgentSessionEvidence(id: string) {
    return api.get<AgentSessionEvidenceExportResult>(
      `/local-engine/agent-sessions/${id}/evidence/export`,
    );
  },

  continueAgentSession(id: string, input?: ContinueAgentSessionInput) {
    return api.post<AgentSession>(
      `/local-engine/agent-sessions/${id}/continue`,
      input || {},
    );
  },

  stopAgentSession(id: string) {
    return api.post<AgentSession>(`/local-engine/agent-sessions/${id}/stop`);
  },

  archiveAgentSession(id: string, input?: ArchiveAgentSessionInput) {
    return api.delete<AgentSession>(
      `/local-engine/agent-sessions/${id}`,
      input || {},
    );
  },

  confirmations(status?: AgentConfirmationStatus) {
    const query = status ? `?status=${status}` : "";
    return api.get<AgentConfirmation[]>(`/local-engine/confirmations${query}`);
  },

  approveConfirmation(id: string, input?: AgentConfirmationDecisionInput) {
    return api.post<AgentSession>(
      `/local-engine/confirmations/${id}/approve`,
      input || {},
    );
  },

  rejectConfirmation(id: string, input?: AgentConfirmationDecisionInput) {
    return api.post<AgentSession>(
      `/local-engine/confirmations/${id}/reject`,
      input || {},
    );
  },

  replyRule() {
    return api.get<InteractionReplyRuleConfig>("/local-engine/reply-rules");
  },

  updateReplyRule(
    input: Partial<Omit<InteractionReplyRuleConfig, "updatedAt">>,
  ) {
    return api.post<InteractionReplyRuleConfig>(
      "/local-engine/reply-rules",
      input,
    );
  },

  generateInteractionReply(input: {
    sourceText: string;
    targetName?: string;
    accountName?: string;
  }) {
    return api.post<InteractionGeneratedReply>(
      "/local-engine/reply/generate",
      input,
    );
  },

  tasks(limit = 50, options?: ApiRequestOptions) {
    return api.get<InteractionTask[]>(
      `/local-engine/tasks?limit=${limit}`,
      options,
    );
  },

  automationTasks(params: { limit?: number; status?: AutomationTaskViewStatus } = {}) {
    const query = new URLSearchParams();
    query.set("limit", String(params.limit || 80));
    if (params.status) query.set("status", params.status);
    return api.get<AutomationTaskView[]>(
      `/local-engine/automation/tasks?${query.toString()}`,
    );
  },

  automationTask(id: string) {
    return api.get<AutomationTaskView>(
      `/local-engine/automation/tasks/${encodeURIComponent(id)}`,
    );
  },

  task(id: string) {
    return api.get<InteractionTask>(`/local-engine/tasks/${id}`);
  },

  records(
    params: {
      limit?: number;
      status?: InteractionTaskStatus;
      type?: InteractionTaskType;
    } = {},
  ) {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.limit || 50));
    if (params.status) searchParams.set("status", params.status);
    if (params.type) searchParams.set("type", params.type);
    return api.get<InteractionRecordsResult>(
      `/local-engine/records?${searchParams.toString()}`,
    );
  },

  exportRecords(
    params: {
      limit?: number;
      status?: InteractionTaskStatus;
      type?: InteractionTaskType;
    } = {},
  ) {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.limit || 200));
    if (params.status) searchParams.set("status", params.status);
    if (params.type) searchParams.set("type", params.type);
    return api.get<InteractionRecordsExportResult>(
      `/local-engine/records/export?${searchParams.toString()}`,
    );
  },

  previewEvidenceCleanup(retentionDays = 7) {
    return api.get<InteractionEvidenceCleanupResult>(
      `/local-engine/evidence/cleanup-preview?retentionDays=${retentionDays}`,
    );
  },

  cleanupEvidence(
    retentionDays = 7,
    riskConfirmation?: LocalEngineRiskConfirmationInput,
  ) {
    return api.post<InteractionEvidenceCleanupResult>(
      "/local-engine/evidence/cleanup",
      {
        retentionDays,
        riskConfirmation,
      },
    );
  },

  uploadInteractionAsset(formData: FormData) {
    return api.upload<LocalEngineInteractionAsset>(
      "/local-engine/interaction-assets",
      formData,
    );
  },

  createTask(input: CreateInteractionTaskInput) {
    return api.post<InteractionTask>("/local-engine/tasks", input);
  },

  businessTasks(
    route: InteractionBusinessRouteKey,
    limit = 50,
    status?: InteractionTaskStatus,
  ) {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(limit));
    if (status) searchParams.set("status", status);
    return api.get<InteractionTask[]>(
      `/local-engine/${route}/tasks?${searchParams.toString()}`,
    );
  },

  businessRecords(
    route: InteractionBusinessRouteKey,
    limit = 50,
    status?: InteractionTaskStatus,
  ) {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(limit));
    if (status) searchParams.set("status", status);
    return api.get<InteractionRecordsResult>(
      `/local-engine/${route}/records?${searchParams.toString()}`,
    );
  },

  createBusinessTask(
    route: InteractionBusinessRouteKey,
    input: CreateInteractionTaskInput,
  ) {
    return api.post<InteractionTask>(`/local-engine/${route}/tasks`, input);
  },

  groupBroadcastPlans(
    limit = 50,
    status?: InteractionTaskStatus | InteractionGroupBroadcastPlanStatus,
  ) {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(limit));
    if (status) searchParams.set("status", status);
    return api.get<InteractionTask[]>(
      `/local-engine/groups/plans?${searchParams.toString()}`,
    );
  },

  createGroupBroadcastPlan(input: CreateInteractionTaskInput) {
    return api.post<InteractionTask>("/local-engine/groups/plans", input);
  },

  groupBroadcastPlanDetails(id: string) {
    return api.get<InteractionBatchTargetListResult>(
      `/local-engine/groups/plans/${id}/detail-list`,
    );
  },

  createMomentsPlanRevision(
    id: string,
    input: {
      planName?: string;
      content?: string;
      additionalComment?: string;
      assetPaths?: string[];
      visibility?: string;
      scheduleStartTime?: string;
      momentsDetails?: Array<Record<string, unknown>>;
    },
  ) {
    return api.post<InteractionTask>(
      `/local-engine/wechat-plans/${encodeURIComponent(id)}/moments-revision`,
      input,
    );
  },

  regenerateMomentsPlanContent(
    id: string,
    input: { instruction?: string; currentContent?: string },
  ) {
    return api.post<{ content: string }>(
      `/local-engine/wechat-plans/${encodeURIComponent(id)}/regenerate-moments`,
      input,
    );
  },

  generateMomentsDraftContent(
    input: { instruction?: string; currentContent?: string },
  ) {
    return api.post<{ content: string }>(
      "/local-engine/wechat-plans/moments-draft",
      input,
    );
  },

  linkWechatTaskAgentSession(id: string, sessionId: string) {
    return api.post<InteractionTask>(
      `/local-engine/wechat-plans/${encodeURIComponent(id)}/agent-session`,
      { sessionId },
    );
  },

  pauseGroupBroadcastPlan(id: string) {
    return api.post<InteractionTask>(`/local-engine/groups/plans/${id}/pause`);
  },

  resumeGroupBroadcastPlan(id: string, input: InteractionApprovalInput) {
    return api.post<InteractionTask>(
      `/local-engine/groups/plans/${id}/resume`,
      input,
    );
  },

  createGroupBroadcastResumeConfirmation(id: string) {
    return api.post<{
      confirmationId: string;
      action: string;
      riskLevel: string;
      target: string;
      expiresAt: string;
      singleUse: boolean;
    }>(`/local-engine/groups/plans/${id}/resume-confirmation`);
  },

  resendGroupBroadcastPlan(
    id: string,
    input: ResendGroupBroadcastPlanInput = {},
  ) {
    return api.post<InteractionTask>(
      `/local-engine/groups/plans/${id}/resend`,
      input,
    );
  },

  removeGroupBroadcastPlan(id: string) {
    return api.post<InteractionTask>(`/local-engine/groups/plans/${id}/remove`);
  },

  deleteGroupBroadcastPlan(id: string) {
    return api.delete<InteractionTask>(`/local-engine/groups/plans/${id}`);
  },

  approveTask(id: string, input?: InteractionApprovalInput) {
    return api.post<InteractionTask>(
      `/local-engine/tasks/${id}/approve`,
      input || {},
    );
  },

  skipTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/skip`);
  },

  failTask(id: string, reason?: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/fail`, {
      reason,
    });
  },

  retryTask(id: string, input: RetryInteractionTaskInput = {}) {
    return api.post<InteractionTask>(
      `/local-engine/tasks/${id}/retry`,
      input,
    );
  },

  continueTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/continue`);
  },

  exportTaskDiagnostics(id: string) {
    return api.get<InteractionTaskDiagnosticExportResult>(
      `/local-engine/tasks/${id}/diagnostics/export`,
    );
  },

  pauseTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/pause`);
  },

  resumeTask(id: string, input: InteractionApprovalInput) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/resume`, input);
  },

  createTaskResumeConfirmation(id: string) {
    return api.post<{
      confirmationId: string;
      action: string;
      riskLevel: string;
      target: string;
      expiresAt: string;
      singleUse: boolean;
    }>(`/local-engine/tasks/${id}/resume-confirmation`);
  },

  agentSStatus() {
    return api.get<AgentSManagerStatus>("/agent-s/status");
  },

  agentSEnsureRunning() {
    return api.post<{
      phase: string;
      baseUrl: string;
      connected: boolean;
    }>("/agent-s/ensure-running");
  },

  agentSStop() {
    return api.post<{
      phase: string;
      connected: boolean;
    }>("/agent-s/stop");
  },

  agentSCreateSession(input: {
    session_name?: string | null;
    task_type?: string;
    metadata?: Record<string, unknown>;
    labels?: string[];
    commercialExecutionRequested?: boolean;
  }) {
    return api.post<{ session: AgentSConversationSessionSummary }>(
      "/agent-s/sessions",
      input,
    );
  },

  agentSListSessions(limit = 50) {
    return api.get<{ sessions: AgentSConversationSession[] }>(
      `/agent-s/sessions?limit=${limit}`,
    );
  },

  agentSGetSession(sessionId: string) {
    return api.get<AgentSConversationSession>(
      `/agent-s/sessions/${sessionId}`,
    );
  },

  agentSRunTask(
    sessionId: string,
    input: AgentSConversationRunInput,
  ) {
    return api.post<{
      accepted: boolean;
      session_id: string;
      run_id: string;
      status: string;
    }>(`/agent-s/sessions/${sessionId}/run`, input);
  },

  agentSGetEvents(sessionId: string, afterSeq?: number) {
    const query = afterSeq !== undefined ? `?after_seq=${afterSeq}` : "";
    return api.get<{
      session_id: string;
      after_seq: number;
      next_seq: number;
      events: AgentSConversationEvent[];
    }>(`/agent-s/sessions/${sessionId}/events${query}`);
  },

  agentSRetrySession(sessionId: string) {
    return api.post<{
      accepted: boolean;
      session_id: string;
      run_id: string;
      status: string;
    }>(`/agent-s/sessions/${sessionId}/retry`);
  },

  agentSCancelSession(sessionId: string) {
    return api.post<{
      session_id: string;
      status: string;
      cancellation_requested: boolean;
    }>(`/agent-s/sessions/${sessionId}/cancel`);
  },

  agentSApproveSession(
    sessionId: string,
    input: { decision: "approved" | "rejected"; comment?: string },
  ) {
    return api.post<{ session_id: string; status: string; decision: string }>(
      `/agent-s/sessions/${sessionId}/approve`,
      input,
    );
  },

  agentSGetArtifacts(sessionId: string) {
    return api.get<{
      session_id: string;
      artifacts: AgentSConversationArtifact[];
    }>(`/agent-s/sessions/${sessionId}/artifacts`);
  },
};

export interface RiskPolicy {
  action: string;
  riskLevel: string;
  requireConfirm: boolean;
  autoExecute: boolean;
  forbidden: boolean;
  minPlan: string;
  source?: "default" | "custom";
  description?: string | null;
}

export const riskPolicyApi = {
  list() {
    return api.get<RiskPolicy[]>("/risk-policies");
  },
  update(action: string, data: Partial<RiskPolicy>) {
    return api.put<RiskPolicy>(`/risk-policies/${action}`, data);
  },
};
