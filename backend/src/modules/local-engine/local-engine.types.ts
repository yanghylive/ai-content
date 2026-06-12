export type LocalEngineCapabilityKey =
  | 'browser-control'
  | 'interaction-capabilities'
  | 'content-publishing'
  | 'kaypal-entitlement'
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

export type LocalEngineCapabilityStatus =
  | 'ready'
  | 'warning'
  | 'missing'
  | 'developing'
  | 'blocked'
  | 'degraded'
  | 'optional';

export type LocalEngineCapability = {
  key: LocalEngineCapabilityKey;
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
};

export type LocalEngineHealth = {
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
  mode: 'live';
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
};

export type LocalEngineRuntimeService = {
  key: 'frontend' | 'backend' | 'agent-s';
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
};

export type LocalEngineRuntimeServiceKey = LocalEngineRuntimeService['key'];

export type LocalEngineRuntimeStatus = {
  checkedAt: string;
  allOnline: boolean;
  logDir: string;
  startScript: string;
  stopScript: string;
  services: LocalEngineRuntimeService[];
};

export type LocalEngineRuntimeAction = 'start' | 'stop' | 'restart';

export type LocalEngineRuntimeActionResult = {
  action: LocalEngineRuntimeAction;
  accepted: boolean;
  message: string;
  scriptPath: string;
  submittedAt: string;
};

export type LocalEngineRuntimeLog = {
  key: LocalEngineRuntimeServiceKey;
  name: string;
  logPath: string;
  exists: boolean;
  lines: string[];
  readAt: string;
};

export type LocalEngineReadiness = {
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
};

export type LocalEngineBrowserAccount = {
  id: number;
  platform: string;
  type: number;
  displayName: string;
  status: 'ready' | 'expired' | 'needs_login' | 'blocked';
  statusLabel: string;
  filePath: string;
  avatarUrl?: string | null;
  currentUrl?: string | null;
  lastError?: string | null;
  nextAction?: string;
};

export type LocalEngineBrowserStatus = {
  checkedAt: string;
  engineOnline: boolean;
  engineMessage: string;
  totalAccounts: number;
  readyAccounts: number;
  expiredAccounts: number;
  accounts: LocalEngineBrowserAccount[];
  recovery: {
    waitingTasks: number;
    resumableTasks: number;
    nextAction: string;
  };
};

export type LocalEngineExecutorStatus =
  | 'ready'
  | 'preflight_only'
  | 'missing'
  | 'optional';

export type LocalEngineExecutorCapability = {
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
};

export type LocalEngineExecutorsStatus = {
  checkedAt: string;
  summary: {
    total: number;
    ready: number;
    preflightOnly: number;
    missing: number;
  };
  executors: LocalEngineExecutorCapability[];
};

export type LocalEngineFileAccessItem = {
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
};

export type LocalEngineFileAccessStatus = {
  checkedAt: string;
  summary: {
    total: number;
    ready: number;
    warnings: number;
  };
  roots: LocalEngineFileAccessItem[];
};

export type InteractionTaskType =
  | 'douyin-comment-reply'
  | 'douyin-direct-message-reply'
  | 'wechat-channel-comment-reply'
  | 'wechat-channel-direct-message-reply'
  | 'wechat-reply-draft'
  | 'wechat-group-broadcast'
  | 'wechat-moments-publish'
  | 'customer-follow-up';

export type InteractionBusinessRouteKey =
  | 'comments'
  | 'messages'
  | 'channel-comments'
  | 'channel-messages'
  | 'wechat'
  | 'groups'
  | 'moments'
  | 'customers';

export type InteractionTaskListFilter = {
  type?: InteractionTaskType;
  status?: InteractionTaskStatus;
  recordsOnly?: boolean;
};

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

export type LocalEnginePlanMode = 'trial' | 'commercial';

export type LocalEnginePermissionStatus =
  | 'allowed'
  | 'approval_required'
  | 'blocked'
  | 'trial_limited';

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

export type LocalEngineSafetyCheck = {
  key: string;
  label: string;
  required: boolean;
  category: LocalEngineSafetyCheckCategory;
  status: LocalEngineSafetyCheckStatus;
  hint?: string;
  blocking?: boolean;
};

export type LocalEngineSafetyBoundary = {
  planMode: LocalEnginePlanMode;
  trialLimited: boolean;
  commercialExecutionAllowed: boolean;
  permissionStatus: LocalEnginePermissionStatus;
  requestedCommercialExecution?: boolean;
  message: string;
  allowedActions: string[];
  blockedActions: string[];
};

export type LocalEngineMisfireProtection = {
  sendProtected: boolean;
  deleteProtected: boolean;
  targetLockRequired: boolean;
  contentPreviewRequired: boolean;
  destructiveActionBlocked: boolean;
  warning: string;
};

export type LocalEngineDesktopPermissionKey =
  | 'accessibility'
  | 'screen-recording'
  | 'automation'
  | 'clipboard'
  | 'foreground-app'
  | 'window-list'
  | 'screenshot'
  | 'input-control'
  | 'click-control'
  | 'file-selection'
  | 'manual-takeover'
  | 'stop-control';

export type LocalEngineDesktopPermissionCheck = {
  key: LocalEngineDesktopPermissionKey;
  label: string;
  status: LocalEngineSafetyCheckStatus;
  message: string;
  nextAction?: string;
};

export type LocalEngineDesktopWindowStatus = {
  appName: string;
  windowTitle?: string | null;
  bundleId?: string | null;
  isWechat?: boolean;
  running: boolean;
  frontmost: boolean;
  windowCount: number;
  windowTitles: string[];
  currentWindowTitle?: string | null;
  currentWindowLikelyWechatChat: boolean;
  contactHint?: string | null;
  currentWindowConfirmed: boolean;
  targetContact?: string;
  contactConfirmed: boolean;
  message: string;
  checkedAt: string;
};

export type LocalEngineDesktopScreenshotEvidence = {
  type: 'screenshot' | 'text' | 'diagnostic_bundle';
  label: string;
  value: string;
  capturedAt: string;
};

export type LocalEngineDesktopStatus = {
  checkedAt: string;
  platform: string;
  available: boolean;
  running: boolean;
  appName?: string | null;
  windowCount: number;
  permissionChecks: LocalEngineDesktopPermissionCheck[];
  window: LocalEngineDesktopWindowStatus;
  screenshot?: LocalEngineDesktopScreenshotEvidence;
  recentEvidence: LocalEngineDesktopScreenshotEvidence[];
  blockers: string[];
  warnings: string[];
  safetyBoundary: {
    draftOnly: boolean;
    requiresManualTarget: boolean;
    requiresManualSend: boolean;
    readsPrivateChats: boolean;
    sendsMessages: boolean;
  };
  takeover: {
    available: boolean;
    active: boolean;
    message: string;
  };
  takeoverActive: boolean;
  stopped: boolean;
  message: string;
  nextAction?: string;
};

export type LocalEngineDesktopCommercialPreflight = {
  allowed: boolean;
  checkedAt: string;
  requiredFor: InteractionTaskType[];
  blockers: string[];
  warnings: string[];
  checks: LocalEngineDesktopPermissionCheck[];
  window: LocalEngineDesktopWindowStatus;
  screenshot?: LocalEngineDesktopScreenshotEvidence;
  takeoverReady: boolean;
  stopReady: boolean;
  message: string;
  nextAction?: string;
};

export type LocalEngineWechatSessionStatus = {
  checkedAt: string;
  desktop: LocalEngineDesktopStatus;
  targetContact?: string;
  currentWindowConfirmed: boolean;
  contactConfirmed: boolean;
  draftBeforeFillConfirmed: boolean;
  manualTakeoverActive: boolean;
  takeoverActive: boolean;
  stopped: boolean;
  stoppedAt?: string;
  stopReason?: string;
  updatedAt?: string;
  canDraft: boolean;
  blockers: string[];
  warnings: string[];
  evidence: LocalEngineDesktopScreenshotEvidence[];
  lock: {
    locked: boolean;
    lockedAt?: string;
    windowTitle?: string | null;
    targetContact?: string;
    message: string;
  };
  anomalySummary: {
    loggedOut: boolean;
    popupDetected: boolean;
    contactAmbiguous: boolean;
    permissionBlocked: boolean;
  };
  nextAction?: string;
};

export type UpdateWechatSessionConfirmationInput = {
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
};

export type WechatSessionControlInput = {
  operator?: string;
  reason?: string;
  riskConfirmation?: {
    confirmed?: boolean;
    confirmationId?: string;
    operator?: string;
    reason?: string;
    note?: string;
    confirmedAt?: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
  };
};

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

export type LocalEngineEvidence = {
  id?: string;
  type: LocalEngineEvidenceType;
  label: string;
  value: string;
  stageKey?: string;
  artifactUrl?: string;
  mimeType?: string;
  createdAt?: string;
};

export type LocalEngineRiskPolicy = {
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
};

export type LocalEngineActionBlocker = {
  platform?: string;
  account?: string;
  target?: string;
  stage: string;
  reason: string;
  nextAction: string;
  capability?: string;
};

export type LocalEngineFailureContext = {
  platform?: string;
  account?: string;
  target?: string;
  stage?: string;
  reason: string;
  nextAction?: string;
};

export type InteractionBatchTargetStatus =
  | 'queued'
  | 'running'
  | 'waiting_confirmation'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'no_target';

export type InteractionBatchTarget = {
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
};

export type InteractionBatchSummary = {
  total: number;
  queued: number;
  running: number;
  waitingConfirmation: number;
  completed: number;
  failed: number;
  skipped: number;
  noTarget: number;
};

export type InteractionTaskResultKind =
  | 'success'
  | 'failure'
  | 'skipped'
  | 'no_target'
  | 'waiting'
  | 'running';

export type InteractionTaskResultSummary = {
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
};

export type InteractionFollowUpMethod =
  | 'wechat'
  | 'message'
  | 'phone'
  | 'offline';

export type CreateInteractionTaskInput = {
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
};

export type InteractionApprovalInput = {
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
  riskConfirmation?: {
    confirmed?: boolean;
    confirmationId?: string;
    operator?: string;
    reason?: string;
    note?: string;
    confirmedAt?: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
  };
};

export type InteractionApprovalRecord = {
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
};

export type InteractionReplyRuleConfig = {
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
};

export type UpdateInteractionReplyRuleInput = Partial<
  Omit<InteractionReplyRuleConfig, 'updatedAt'>
>;

export type InteractionTaskEvent = {
  id: string;
  taskId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: string;
  evidence?: LocalEngineEvidence;
};

export type InteractionTaskStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'skipped';

export type InteractionTaskStep = {
  key: string;
  label: string;
  status: InteractionTaskStepStatus;
  message: string;
  updatedAt?: string;
};

export type InteractionTask = {
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
  replyRule?: InteractionReplyRuleConfig;
  sendMode: InteractionSendMode;
  requestedSendMode?: InteractionSendMode;
  riskLevel?: AgentRiskLevel;
  requiresDoubleConfirmation?: boolean;
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  riskChecklist?: LocalEngineSafetyCheck[];
  executionMode: 'browser-assisted' | 'internal-record';
  followUpMethod?: InteractionFollowUpMethod;
  rateLimitPerMinute?: number;
  runtimeState?:
    | 'preflight_only'
    | 'executor_missing'
    | 'live_ready'
    | 'record_ready';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
  failureContext?: LocalEngineFailureContext;
  blockers?: LocalEngineActionBlocker[];
  pausedFromStatus?: Exclude<InteractionTaskStatus, 'paused'>;
  pausedAt?: string;
  nextAction?: string;
  batchTargets?: InteractionBatchTarget[];
  batchSummary?: InteractionBatchSummary;
  approvalRecord?: InteractionApprovalRecord;
  diagnostics?: {
    status:
      | 'normal'
      | 'waiting'
      | 'blocked'
      | 'completed'
      | 'skipped'
      | 'no_target';
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
};

export type InteractionRecordsSummary = {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  skipped: number;
  noTarget: number;
  evidenceCount: number;
  byType: Record<InteractionTaskType, number>;
  lastUpdatedAt?: string;
};

export type InteractionRecordsResult = {
  items: InteractionTask[];
  summary: InteractionRecordsSummary;
};

export type InteractionRecordsExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
  summary: InteractionRecordsSummary;
};

export type InteractionTaskDiagnosticExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
};

export type InteractionEvidenceCleanupResult = {
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
};

export type InteractionTaskRuntimePort = {
  setTaskStep: (
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ) => void;
  pushEvent: (
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: LocalEngineEvidence,
  ) => InteractionTaskEvent;
};

export type InteractionExecutorPreflightResult = {
  state: 'preflight_only' | 'executor_missing' | 'live_ready' | 'record_ready';
  terminalStatus?: Extract<
    InteractionTaskStatus,
    'failed' | 'no_target' | 'skipped'
  >;
  failureReason?: string;
  nextAction?: string;
  targetText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  readyForApproval?: boolean;
};

export type InteractionExecutorDraftResult = {
  ok: boolean;
  status:
    | 'draft_filled'
    | 'sent'
    | 'send_failed'
    | 'comment_missing'
    | 'message_missing'
    | 'editor_missing'
    | 'wechat_missing'
    | 'desktop_permission_missing'
    | 'unsupported'
    | 'all_completed'
    | 'partial_completed'
    | 'all_failed'
    | 'moments_publish_failed'
    | 'no_target';
  message: string;
  evidence?: InteractionTaskEvent['evidence'];
  nextAction?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  readbackText?: string;
  replyVisible?: boolean;
};

export type AgentSessionStatus =
  | 'draft'
  | 'running'
  | 'waiting_for_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentSessionEventLevel = 'info' | 'success' | 'warning' | 'error';

export type AgentExecutionScope =
  | 'browser'
  | 'desktop'
  | 'local-files'
  | 'remote'
  | 'mixed';

export type AgentSessionSource =
  | 'web'
  | 'agent-console'
  | 'publishing'
  | 'interaction'
  | 'system';

export type AgentRiskLevel = 'low' | 'medium' | 'high';

export type AgentConfirmationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

export type AgentSessionListFilter = {
  status?: AgentSessionStatus;
  source?: AgentSessionSource;
  executionScope?: AgentExecutionScope;
  riskLevel?: AgentRiskLevel;
  targetApp?: string;
  hasPendingConfirmation?: boolean;
  hasEvidence?: boolean;
  keyword?: string;
};

export type AgentEvidence = {
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
};

export type AgentSessionEvent = {
  id: string;
  sessionId: string;
  level: AgentSessionEventLevel;
  title: string;
  message: string;
  createdAt: string;
  evidence?: AgentEvidence;
};

export type AgentConfirmation = {
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
};

export type AgentConfirmationListItem = AgentConfirmation & {
  session?: {
    id: string;
    title: string;
    source: AgentSessionSource;
    status: AgentSessionStatus;
    statusLabel: string;
    riskLevel: AgentRiskLevel;
    updatedAt: string;
    nextAction?: string;
    resumeAction?: AgentSessionResumeAction;
  };
};

export type AgentSessionResumeAction = {
  kind: 'auto-upload-publish';
  label: string;
  payloads: unknown[];
};

export type AgentSession = {
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
  targetApp?: string;
  targetUrl?: string;
  riskLevel: AgentRiskLevel;
  requiresDoubleConfirmation?: boolean;
  commercialExecutablePermission?: LocalEnginePermissionStatus;
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  resumeAction?: AgentSessionResumeAction;
  confirmations: AgentConfirmation[];
  events: AgentSessionEvent[];
};

export type AgentSessionEvidenceExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
  sessionId: string;
  evidenceCount: number;
  timelineCount: number;
};

export type AgentSessionEvidenceListResult = {
  sessionId: string;
  evidenceCount: number;
  items: AgentEvidence[];
};

export type CreateAgentSessionInput = {
  title?: string;
  instruction: string;
  executionScope?: AgentExecutionScope;
  source?: AgentSessionSource;
  targetApp?: string;
  targetUrl?: string;
  dryRun?: boolean;
  commercialExecutionRequested?: boolean;
  resumeAction?: AgentSessionResumeAction;
};

export type ContinueAgentSessionInput = {
  instruction?: string;
  operator?: string;
};

export type AgentConfirmationDecisionInput = {
  operator?: string;
  note?: string;
  confirmedChecks?: Record<string, boolean>;
  riskConfirmation?: {
    confirmed?: boolean;
    confirmationId?: string;
    operator?: string;
    reason?: string;
    note?: string;
    confirmedAt?: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
    fullPermission?: boolean;
  };
};

export interface WechatDesktopWindow {
  id: string;
  title: string;
  isMain: boolean;
}

export interface WechatContactMatch {
  name: string;
  remark: string;
  id: string;
}

export interface WechatDesktopPreflightResult {
  ready: boolean;
  reason?: string;
  windowId?: string;
  popupDismissed?: boolean;
}
