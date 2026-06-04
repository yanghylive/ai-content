import { api } from './client';

export type LocalEngineCapabilityStatus = 'ready' | 'warning' | 'missing' | 'developing';

export interface LocalEngineCapability {
  key:
    | 'browser-control'
    | 'interaction-capabilities'
    | 'ai-reply-model'
    | 'desktop-control'
    | 'mcp-manager'
    | 'agent-s-sidecar'
    | 'wechat-execution'
    | 'remote-control'
    | 'plugin-runtime'
    | 'memory-context'
    | 'sandbox-execution'
    | 'evidence-replay'
    | 'file-access'
    | 'permission-check';
  name: string;
  status: LocalEngineCapabilityStatus;
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
  service: string;
  version: string;
  mode: 'live';
  engineUrl: string;
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
  key: 'frontend' | 'backend' | 'engine';
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

export type LocalEngineRuntimeServiceKey = LocalEngineRuntimeService['key'];

export interface LocalEngineRuntimeStatus {
  checkedAt: string;
  allOnline: boolean;
  logDir: string;
  startScript: string;
  stopScript: string;
  services: LocalEngineRuntimeService[];
}

export type LocalEngineRuntimeAction = 'start' | 'stop' | 'restart';

export interface LocalEngineRuntimeActionResult {
  action: LocalEngineRuntimeAction;
  accepted: boolean;
  message: string;
  scriptPath: string;
  submittedAt: string;
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
  status: 'ready' | 'expired';
  statusLabel: string;
  filePath: string;
  avatarUrl?: string | null;
}

export interface LocalEngineBrowserStatus {
  checkedAt: string;
  engineOnline: boolean;
  engineMessage: string;
  totalAccounts: number;
  readyAccounts: number;
  expiredAccounts: number;
  accounts: LocalEngineBrowserAccount[];
}

export type LocalEngineExecutorStatus = 'ready' | 'preflight_only' | 'missing';

export interface LocalEngineExecutorCapability {
  key: InteractionTaskType;
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
  kind: 'directory' | 'file' | 'missing' | 'unknown';
  fileCount?: number;
  directoryCount?: number;
  sizeBytes?: number;
  updatedAt?: string | null;
  note?: string;
  recentFiles?: Array<{
    name: string;
    path: string;
    kind: 'directory' | 'file' | 'unknown';
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
  | 'douyin-comment-reply'
  | 'douyin-direct-message-reply'
  | 'wechat-channel-comment-reply'
  | 'wechat-channel-direct-message-reply'
  | 'wechat-reply-draft'
  | 'wechat-group-broadcast'
  | 'wechat-moments-publish'
  | 'customer-follow-up';

export type InteractionTaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'waiting_for_send_confirmation'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'no_target';

export type InteractionSendMode = 'approval-send' | 'draft-only' | 'auto-send';
export type InteractionReplyGeneratedBy = 'ai' | 'fallback';
export type InteractionFollowUpMethod = 'wechat' | 'message' | 'phone' | 'offline';

export type LocalEnginePlanMode = 'trial' | 'commercial';

export type LocalEnginePermissionStatus = 'allowed' | 'approval_required' | 'blocked' | 'trial_limited';

export type LocalEngineSafetyCheckStatus = 'ready' | 'warning' | 'blocked';

export type LocalEngineSafetyCheckCategory =
  | 'scope'
  | 'target'
  | 'content'
  | 'window'
  | 'permission'
  | 'commercial'
  | 'send-protection'
  | 'delete-protection';

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
  | 'text'
  | 'snapshot'
  | 'screenshot'
  | 'page_snapshot'
  | 'desktop_screenshot'
  | 'stage_log'
  | 'failure_reason'
  | 'diagnostic_bundle'
  | 'file';

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
  requiredRole: 'operator' | 'manager' | 'admin';
  approverRoles: Array<'manager' | 'admin'>;
  targetName: string;
  targetWhitelisted: boolean;
  whitelistTargets: string[];
  forbiddenActions: string[];
  forbiddenActionHits: string[];
  remoteTakeoverAuditRequired: boolean;
  auditRequiredReason?: string;
  remoteAudit: Array<{
    action: 'requested' | 'approved' | 'started' | 'stopped' | 'rejected';
    operator: string;
    reason: string;
    createdAt: string;
  }>;
  message: string;
}

export type InteractionBatchTargetStatus =
  | 'queued'
  | 'running'
  | 'waiting_confirmation'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'no_target';

export interface InteractionBatchTarget {
  id: string;
  targetName: string;
  sourceText: string;
  replyText: string;
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

export type InteractionRouteKey =
  | 'comments'
  | 'messages'
  | 'channel-comments'
  | 'channel-messages'
  | 'wechat'
  | 'groups'
  | 'moments'
  | 'customers'
  | 'rules'
  | 'records';
export type InteractionBusinessRouteKey = Extract<
  InteractionRouteKey,
  'comments' | 'messages' | 'channel-comments' | 'channel-messages' | 'wechat' | 'groups' | 'moments' | 'customers'
>;

export type InteractionTaskResultKind =
  | 'success'
  | 'failure'
  | 'skipped'
  | 'no_target'
  | 'waiting'
  | 'running';

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
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: string;
  evidence?: LocalEngineEvidence;
}

export type InteractionTaskStepStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'skipped';

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
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  sendMode: InteractionSendMode;
  requestedSendMode?: InteractionSendMode;
  riskLevel?: AgentRiskLevel;
  requiresDoubleConfirmation?: boolean;
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  riskChecklist?: LocalEngineSafetyCheck[];
  executionMode: 'browser-assisted' | 'internal-record';
  runtimeState?: 'preflight_only' | 'executor_missing' | 'live_ready' | 'record_ready';
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
    status: 'normal' | 'waiting' | 'blocked' | 'completed' | 'skipped' | 'no_target';
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

export interface InteractionRecordsExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
  summary: InteractionRecordsSummary;
}

export interface InteractionTaskDiagnosticExportResult {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
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
  sendMode?: InteractionSendMode;
  commercialExecutionRequested?: boolean;
  followUpMethod?: InteractionFollowUpMethod;
  batchTargets?: Array<{
    targetName?: string;
    sourceText: string;
    replyText?: string;
  }>;
}

export interface InteractionApprovalInput {
  operator?: string;
  note?: string;
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
}

export interface InteractionReplyRuleConfig {
  industryName: string;
  tone: 'warm' | 'professional' | 'concise';
  defaultSendMode: InteractionSendMode;
  askForContact: boolean;
  commentParsingMode: 'rules' | 'none';
  commentRulePreset: 'strict' | 'loose';
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
  generatedBy: 'ai' | 'fallback';
  rule: InteractionReplyRuleConfig;
}

export type AgentSessionStatus =
  | 'draft'
  | 'running'
  | 'waiting_for_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentExecutionScope = 'browser' | 'desktop' | 'local-files' | 'remote' | 'mixed';

export type AgentSessionSource = 'agent-console' | 'publishing' | 'interaction' | 'system' | 'web';

export type AgentRiskLevel = 'low' | 'medium' | 'high';

export type AgentConfirmationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

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
  level: 'info' | 'success' | 'warning' | 'error';
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
  riskLevel: Exclude<AgentRiskLevel, 'low'>;
  status: AgentConfirmationStatus;
  confirmationMode?: 'standard' | 'double-confirmation';
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

export interface AgentSessionResumeAction {
  kind: 'auto-upload-publish';
  label: string;
  payloads: unknown[];
}

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
}

export interface ContinueAgentSessionInput {
  instruction?: string;
  operator?: string;
}

export interface AgentConfirmationDecisionInput {
  operator?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
  riskConfirmation?: {
    confirmed?: boolean;
    fullPermission?: boolean;
  };
}

export type LocalEngineDesktopPermissionKey =
  | 'accessibility'
  | 'screen-recording'
  | 'automation'
  | 'clipboard';

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
  type: 'screenshot' | 'text';
  label: string;
  value: string;
  capturedAt: string;
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

export interface WechatSessionControlInput {
  operator?: string;
  reason?: string;
}

export const localEngineApi = {
  health() {
    return api.get<LocalEngineHealth>('/local-engine/health');
  },

  runtimeStatus() {
    return api.get<LocalEngineRuntimeStatus>('/local-engine/runtime/status');
  },

  runRuntimeAction(action: LocalEngineRuntimeAction) {
    return api.post<LocalEngineRuntimeActionResult>(`/local-engine/runtime/${action}`);
  },

  runtimeLog(key: LocalEngineRuntimeServiceKey, lines = 80) {
    return api.get<LocalEngineRuntimeLog>(`/local-engine/runtime/logs/${key}?lines=${lines}`);
  },

  readiness() {
    return api.get<LocalEngineReadiness>('/local-engine/readiness');
  },

  browserStatus() {
    return api.get<LocalEngineBrowserStatus>('/local-engine/browser/status');
  },

  desktopStatus() {
    return api.get<LocalEngineDesktopStatus>('/local-engine/desktop/status');
  },

  wechatSessionStatus() {
    return api.get<LocalEngineWechatSessionStatus>('/local-engine/wechat/session/status');
  },

  confirmWechatSession(input: UpdateWechatSessionConfirmationInput) {
    return api.post<LocalEngineWechatSessionStatus>('/local-engine/wechat/session/confirm', input);
  },

  takeoverWechatSession(input?: WechatSessionControlInput) {
    return api.post<LocalEngineWechatSessionStatus>('/local-engine/wechat/session/takeover', input || {});
  },

  stopWechatSession(input?: WechatSessionControlInput) {
    return api.post<LocalEngineWechatSessionStatus>('/local-engine/wechat/session/stop', input || {});
  },

  executorsStatus() {
    return api.get<LocalEngineExecutorsStatus>('/local-engine/executors/status');
  },

  fileAccessStatus() {
    return api.get<LocalEngineFileAccessStatus>('/local-engine/files/status');
  },

  agentSessions(params: number | AgentSessionListParams = 50) {
    const options: AgentSessionListParams = typeof params === 'number' ? { limit: params } : params;
    const query = new URLSearchParams();
    if (options.limit) query.set('limit', String(options.limit));
    if (options.status) query.set('status', options.status);
    if (options.source) query.set('source', options.source);
    if (options.riskLevel) query.set('riskLevel', options.riskLevel);
    if (options.executionScope) query.set('executionScope', options.executionScope);
    if (options.targetApp?.trim()) query.set('targetApp', options.targetApp.trim());
    if (typeof options.hasPendingConfirmation === 'boolean') {
      query.set('hasPendingConfirmation', String(options.hasPendingConfirmation));
    }
    if (typeof options.hasEvidence === 'boolean') query.set('hasEvidence', String(options.hasEvidence));
    if (options.keyword?.trim()) query.set('keyword', options.keyword.trim());
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return api.get<AgentSession[]>(`/local-engine/agent-sessions${suffix}`);
  },

  createAgentSession(input: CreateAgentSessionInput) {
    return api.post<AgentSession>('/local-engine/agent-sessions', input);
  },

  agentSession(id: string) {
    return api.get<AgentSession>(`/local-engine/agent-sessions/${id}`);
  },

  exportAgentSessionEvidence(id: string) {
    return api.get<AgentSessionEvidenceExportResult>(`/local-engine/agent-sessions/${id}/evidence/export`);
  },

  continueAgentSession(id: string, input?: ContinueAgentSessionInput) {
    return api.post<AgentSession>(`/local-engine/agent-sessions/${id}/continue`, input || {});
  },

  stopAgentSession(id: string) {
    return api.post<AgentSession>(`/local-engine/agent-sessions/${id}/stop`);
  },

  confirmations(status?: AgentConfirmationStatus) {
    const query = status ? `?status=${status}` : '';
    return api.get<AgentConfirmation[]>(`/local-engine/confirmations${query}`);
  },

  approveConfirmation(id: string, input?: AgentConfirmationDecisionInput) {
    return api.post<AgentSession>(`/local-engine/confirmations/${id}/approve`, input || {});
  },

  rejectConfirmation(id: string, input?: AgentConfirmationDecisionInput) {
    return api.post<AgentSession>(`/local-engine/confirmations/${id}/reject`, input || {});
  },

  replyRule() {
    return api.get<InteractionReplyRuleConfig>('/local-engine/reply-rules');
  },

  updateReplyRule(input: Partial<Omit<InteractionReplyRuleConfig, 'updatedAt'>>) {
    return api.post<InteractionReplyRuleConfig>('/local-engine/reply-rules', input);
  },

  generateInteractionReply(input: { sourceText: string; targetName?: string; accountName?: string }) {
    return api.post<InteractionGeneratedReply>('/local-engine/reply/generate', input);
  },

  tasks(limit = 50) {
    return api.get<InteractionTask[]>(`/local-engine/tasks?limit=${limit}`);
  },

  task(id: string) {
    return api.get<InteractionTask>(`/local-engine/tasks/${id}`);
  },

  records(params: { limit?: number; status?: InteractionTaskStatus; type?: InteractionTaskType } = {}) {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(params.limit || 50));
    if (params.status) searchParams.set('status', params.status);
    if (params.type) searchParams.set('type', params.type);
    return api.get<InteractionRecordsResult>(`/local-engine/records?${searchParams.toString()}`);
  },

  exportRecords(params: { limit?: number; status?: InteractionTaskStatus; type?: InteractionTaskType } = {}) {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(params.limit || 200));
    if (params.status) searchParams.set('status', params.status);
    if (params.type) searchParams.set('type', params.type);
    return api.get<InteractionRecordsExportResult>(`/local-engine/records/export?${searchParams.toString()}`);
  },

  previewEvidenceCleanup(retentionDays = 7) {
    return api.get<InteractionEvidenceCleanupResult>(
      `/local-engine/evidence/cleanup-preview?retentionDays=${retentionDays}`,
    );
  },

  cleanupEvidence(retentionDays = 7) {
    return api.post<InteractionEvidenceCleanupResult>('/local-engine/evidence/cleanup', { retentionDays });
  },

  uploadInteractionAsset(formData: FormData) {
    return api.upload<LocalEngineInteractionAsset>('/local-engine/interaction-assets', formData);
  },

  createTask(input: CreateInteractionTaskInput) {
    return api.post<InteractionTask>('/local-engine/tasks', input);
  },

  businessTasks(route: InteractionBusinessRouteKey, limit = 50, status?: InteractionTaskStatus) {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(limit));
    if (status) searchParams.set('status', status);
    return api.get<InteractionTask[]>(`/local-engine/${route}/tasks?${searchParams.toString()}`);
  },

  businessRecords(route: InteractionBusinessRouteKey, limit = 50, status?: InteractionTaskStatus) {
    const searchParams = new URLSearchParams();
    searchParams.set('limit', String(limit));
    if (status) searchParams.set('status', status);
    return api.get<InteractionRecordsResult>(`/local-engine/${route}/records?${searchParams.toString()}`);
  },

  createBusinessTask(route: InteractionBusinessRouteKey, input: CreateInteractionTaskInput) {
    return api.post<InteractionTask>(`/local-engine/${route}/tasks`, input);
  },

  approveTask(id: string, input?: InteractionApprovalInput) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/approve`, input || {});
  },

  skipTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/skip`);
  },

  failTask(id: string, reason?: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/fail`, { reason });
  },

  retryTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/retry`);
  },

  exportTaskDiagnostics(id: string) {
    return api.get<InteractionTaskDiagnosticExportResult>(
      `/local-engine/tasks/${id}/diagnostics/export`,
    );
  },

  pauseTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/pause`);
  },

  resumeTask(id: string) {
    return api.post<InteractionTask>(`/local-engine/tasks/${id}/resume`);
  },

  agentSStatus() {
    return api.get<{
      phase: string;
      baseUrl: string;
      connected: boolean;
      canSpawn: boolean;
      spawnImplemented: boolean;
      lastSeenAt?: string;
      lastError?: string;
      sidecar?: {
        health?: Record<string, unknown>;
        status?: Record<string, unknown>;
      };
    }>('/agent-s/status');
  },

  agentSEnsureRunning() {
    return api.post<{
      phase: string;
      baseUrl: string;
      connected: boolean;
    }>('/agent-s/ensure-running');
  },

  agentSStop() {
    return api.post<{
      phase: string;
      connected: boolean;
    }>('/agent-s/stop');
  },

  agentSCreateSession(input: {
    session_name?: string | null;
    task_type?: string;
    metadata?: Record<string, unknown>;
    labels?: string[];
    commercialExecutionRequested?: boolean;
  }) {
    return api.post<{ session: Record<string, unknown> }>('/agent-s/sessions', input);
  },

  agentSRunTask(sessionId: string, input: {
    instruction: string;
    task_type?: string | null;
    metadata?: Record<string, unknown>;
    risk_level?: 'low' | 'medium' | 'high';
    requires_approval?: boolean;
  }) {
    return api.post<{ accepted: boolean; session_id: string; run_id: string; status: string }>(`/agent-s/sessions/${sessionId}/run`, input);
  },

  agentSGetEvents(sessionId: string, afterSeq?: number) {
    const query = afterSeq !== undefined ? `?after_seq=${afterSeq}` : '';
    return api.get<{ session_id: string; after_seq: number; next_seq: number; events: Array<{ seq: number; session_id: string; event_type: string; status: string; created_at: string; message?: string | null; payload: Record<string, unknown> }> }>(`/agent-s/sessions/${sessionId}/events${query}`);
  },

  agentSCancelSession(sessionId: string) {
    return api.post<{ session_id: string; status: string; cancellation_requested: boolean }>(`/agent-s/sessions/${sessionId}/cancel`);
  },

  agentSApproveSession(sessionId: string, input: { decision: 'approved' | 'rejected'; comment?: string }) {
    return api.post<{ session_id: string; status: string; decision: string }>(`/agent-s/sessions/${sessionId}/approve`, input);
  },

  agentSGetArtifacts(sessionId: string) {
    return api.get<{ session_id: string; artifacts: Array<{ artifact_id: string; kind: string; filename: string; path: string; created_at: string; size_bytes: number }> }>(`/agent-s/sessions/${sessionId}/artifacts`);
  },
};

export interface RiskPolicy {
  action: string;
  riskLevel: string;
  requireConfirm: boolean;
  autoExecute: boolean;
  forbidden: boolean;
  minPlan: string;
  source?: 'default' | 'custom';
  description?: string | null;
}

export const riskPolicyApi = {
  list() {
    return api.get<RiskPolicy[]>('/risk-policies');
  },
  update(action: string, data: Partial<RiskPolicy>) {
    return api.put<RiskPolicy>(`/risk-policies/${action}`, data);
  },
};
