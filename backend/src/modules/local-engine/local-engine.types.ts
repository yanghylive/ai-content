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
  status: 'ready' | 'expired' | 'needs_login' | 'blocked' | 'unverified';
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
  key: string;
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
  | 'wechat-friend-accept'
  | 'wechat-group-broadcast'
  | 'wechat-contact-add'
  | 'wechat-moments-publish'
  | 'wechat-moments-marketing'
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

export type CustomerServiceReplyPlatform = 'wechat' | 'douyin';

export type InteractionReplyGeneratedBy = 'ai' | 'fallback';

export type InteractionGroupBroadcastPlanStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'removed';

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
  trusted?: boolean;
  diagnostic?: string;
  textSample?: string;
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

export type AlignWechatSessionInput = {
  targetContact?: string;
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

export type WechatContact = {
  wxid: string;
  nickname?: string;
  remark?: string;
  tags: string[];
  currentWechatId?: string;
  plannedWechatId?: string;
  syncedAt?: string;
  updatedAt: string;
  createdAt: string;
};

export type UpsertWechatContactInput = {
  wxid?: string;
  nickname?: string;
  remark?: string;
  tags?: string[];
  currentWechatId?: string;
  plannedWechatId?: string;
};

export type WechatContactsResult = {
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
};

export type WechatContactsSyncMode = 'random' | 'all';

export type WechatContactsSyncInput = {
  force?: boolean;
  mode?: WechatContactsSyncMode;
};

export type WechatContactsReadinessCheck = {
  key: string;
  name: string;
  status: LocalEngineCapabilityStatus;
  message: string;
  nextAction?: string;
  details?: Record<string, unknown>;
};

export type WechatContactsReadinessResult = {
  ready: boolean;
  status: 'ready' | 'warning' | 'blocked';
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
};

export type WechatContactsSyncDiagnostics = {
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
  dbErrors?: Array<Record<string, unknown>>;
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
  currentAccountDbBlocked?: boolean;
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
  uiaContactNavigationAction?: string;
  uiaContactNavigationTarget?: string;
  layers?: Record<string, unknown>;
  externalCommandRunners?: Record<string, unknown>;
  uiaPageSummaries?: Array<Record<string, unknown>>;
  uiaNodeCount?: number;
  uiaScrollResetAttempts?: number;
};

export type WechatContactsExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exportStatus: 'OK' | 'FAILED';
  count: number;
};

export type WechatContactsDiagnosticsExportResult = {
  filename: string;
  mimeType: string;
  content: string;
  exportedAt: string;
  exists: boolean;
};

export type WechatChatHistorySource =
  | 'empty'
  | 'local-cache'
  | 'macos-wechat-rpa'
  | 'macos-wechat-ocr'
  | 'windows-wechat-contact-cache'
  | 'wechat-db'
  | 'manual-import';

export type WechatChatHistoryStatus = 'ready' | 'empty' | 'blocked' | 'error';

export type WechatChatSession = {
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
};

export type WechatChatMessageDirection =
  | 'incoming'
  | 'outgoing'
  | 'system'
  | 'unknown';

export type WechatChatMessage = {
  id: string;
  sessionId: string;
  senderName?: string;
  direction: WechatChatMessageDirection;
  content: string;
  contentType: 'text' | 'image' | 'file' | 'system' | 'unknown';
  sentAt?: string;
  createdAt?: string;
  source: WechatChatHistorySource;
  raw?: Record<string, unknown>;
};

export type WechatChatHistoryCacheInfo = {
  path: string;
  cached: boolean;
  syncedAt?: string;
  source: WechatChatHistorySource;
};

export type WechatChatSessionsResult = {
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
};

export type WechatChatHistoryResult = {
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
};

export type SyncWechatChatHistoryInput = {
  force?: boolean;
  sessionId?: string;
  limit?: number;
  operator?: string;
  note?: string;
};

export type SyncWechatChatHistoryResult = WechatChatSessionsResult & {
  ok: boolean;
  syncAttempted: boolean;
  scriptPath: string;
  message: string;
  errorCode?: string;
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

export type ResendGroupBroadcastPlanInput = {
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
  riskConfirmation?: InteractionApprovalInput['riskConfirmation'];
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
};

export type RetryInteractionTaskInput = {
  targetIds?: string[];
  onlyFailed?: boolean;
  onlyUnsent?: boolean;
};

export type InteractionBatchTargetListResult = {
  taskId: string;
  planName?: string;
  planStatus?: InteractionGroupBroadcastPlanStatus;
  summary?: InteractionBatchSummary;
  items: InteractionBatchTarget[];
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

export type MomentsPromptConfig = {
  key?: string;
  title?: string;
  prompt: string;
  enabled?: boolean;
};

export type MomentsPlanMetadata = {
  dailyPublished?: number;
  dailyQuota?: number;
  scheduleStartTime?: string;
  autoLike?: boolean;
  autoComment?: boolean;
  recordSummary?: string;
  prompts?: MomentsPromptConfig[];
};

export type CreateInteractionTaskInput = {
  type: InteractionTaskType;
  /** 客服机器人创建的任务会写入对应规则 ID，便于追溯配置与执行结果。 */
  replyBotId?: string;
  accountId?: string;
  accountName?: string;
  platformType?: number;
  platformName?: string;
  targetName?: string;
  sourceText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
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
  callerCommercialAllowed?: boolean;
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
};

export type InteractionApprovalInput = {
  operator?: string;
  note?: string;
  /** 人工修改后的回复文本：确认时若提供，将覆盖任务原草稿发送 */
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
  /** AI 客服产品配置保存在 ruleJson 中，保留在现有规则表内，避免浏览器成为业务数据源。 */
  configVersion: number;
  revision: number;
  botName?: string;
  botType?: 'sales' | 'advisor';
  authorizedAccounts?: string[];
  replyDelay?: string;
  whitelist?: string[];
  noReplyScenarios?: string[];
  fileRequestPolicy?: string;
  contactScope?: 'wechat' | 'douyin' | 'all';
  knowledgeScope?: 'local' | 'selected' | 'none';
  selectedKnowledgeId?: string;
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

export type CustomerServiceReplyBot = {
  id: string;
  name: string;
  enabled: boolean;
  configVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  config: InteractionReplyRuleConfig;
};

export type CustomerServiceReplyDecision = {
  action: 'reply' | 'review' | 'no-reply';
  sendMode: InteractionSendMode;
  canGenerate: boolean;
  canCreateTask: boolean;
  reason: string;
  reasons: string[];
  matchedRules: {
    whitelist: string[];
    noReply: string[];
    approval: string[];
    blocked: string[];
  };
  delay: {
    minSeconds: number;
    maxSeconds: number;
    selectedSeconds: number;
    notBefore?: string;
  };
  knowledge: {
    scope: 'local' | 'selected' | 'none';
    selectedKnowledgeId?: string;
    selectedKnowledgeTitle?: string;
    available: boolean;
  };
  contact: {
    platform?: CustomerServiceReplyPlatform;
    accountBound: boolean;
    scopeMatched: boolean;
    whitelisted: boolean;
  };
  fileRequest: boolean;
};

export type CreateCustomerServiceReplyTaskInput = {
  accountId?: string;
  accountName?: string;
  platform?: CustomerServiceReplyPlatform;
  targetName?: string;
  contactLabels?: string[];
  sourceText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  sendMode?: InteractionSendMode;
  commercialExecutionRequested?: boolean;
};

export type UpdateInteractionReplyRuleInput = Partial<
  Omit<InteractionReplyRuleConfig, 'configVersion' | 'revision' | 'updatedAt'>
> & {
  expectedRevision?: number;
};

export type InteractionTaskEvent = {
  id: string;
  taskId: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: string;
  evidence?: LocalEngineEvidence;
};

export type InteractionTaskBillingIdentity = {
  sessionId?: string;
  localUserId: string;
  kaypalUserId: string;
  kaypalDesktopAccessToken?: string;
  kaypalDesktopRefreshToken?: string;
  kaypalDesktopTokenExpiresAt?: string;
  kaypalDesktopDeviceId?: string;
  kaypalPlan?: string;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  commercialExecutionAllowed?: boolean;
  planMode?: string;
  capturedAt: string;
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
  /** Internal persistence scope. Removed from display responses. */
  tenantId?: string;
  /** Internal actor scope. Removed from display responses. */
  userId?: string;
  type: InteractionTaskType;
  typeLabel: string;
  status: InteractionTaskStatus;
  statusLabel: string;
  planName?: string;
  planTime?: string;
  planStatus?: InteractionGroupBroadcastPlanStatus;
  dailyLimit?: number;
  associatedWeChat?: string;
  currentWechatId?: string;
  plannedWechatId?: string;
  generateOnDemand?: boolean;
  accountId?: string;
  replyBotId?: string;
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
  /** 服务端内部字段：后台执行恢复云端扣积分身份。返回前必须脱敏/移除。 */
  billingIdentity?: InteractionTaskBillingIdentity;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  runtimeMode?: string;
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
    | 'record_ready'
    | 'running'
    | 'completed'
    | 'blocked';
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
    runtimeMode?: string;
    evidenceCount: number;
    lastEventAt?: string;
  };
  resultSummary?: InteractionTaskResultSummary;
  steps?: InteractionTaskStep[];
  events: InteractionTaskEvent[];
};

export type AutomationTaskViewStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'waiting_confirmation'
  | 'paused'
  | 'partial_failed'
  | 'failed'
  | 'success'
  | 'cancelled';

export type AutomationTaskView = {
  id: string;
  source: 'interaction-task' | 'agent-session';
  taskType: string;
  title: string;
  status: AutomationTaskViewStatus;
  statusLabel: string;
  executionMode: 'real' | 'simulated' | 'configuration' | 'blocked';
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
  failureReason?: string;
  evidence?: InteractionTaskEvent['evidence'];
  nextAction?: string;
  targetText?: string;
  sourceText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
  runtimeMode?: string;
  readbackText?: string;
  replyVisible?: boolean;
  completedTargets?: string[];
  failedTargets?: Array<{
    targetName: string;
    reason?: string;
  }>;
  skippedTargets?: string[];
  pendingTargets?: string[];
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
  tenantId?: string;
  userId?: string;
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

export type AgentSessionResumeAction =
  | {
      kind: 'auto-upload-publish';
      label: string;
      payloads: unknown[];
    }
  | {
      kind: 'agentwaker-handoff';
      label: string;
      articleId: string;
      role: 'xiaohongshu-operator' | 'wechat-official-account-operator';
      workflow: string;
      targetHref: string;
    };

export type AgentSession = {
  id: string;
  tenantId?: string;
  userId?: string;
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
  safetyBoundary?: LocalEngineSafetyBoundary;
  misfireProtection?: LocalEngineMisfireProtection;
  riskPolicy?: LocalEngineRiskPolicy;
  resumeAction?: AgentSessionResumeAction;
  metadata?: Record<string, unknown>;
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
  metadata?: Record<string, unknown>;
};

export type ContinueAgentSessionInput = {
  instruction?: string;
  operator?: string;
};

export type ArchiveAgentSessionInput = {
  operator?: string;
  reason?: string;
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
