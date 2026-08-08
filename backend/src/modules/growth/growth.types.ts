export type GrowthPlatform =
  | 'douyin'
  | 'wechat-channel'
  | 'wechat'
  | 'wecom'
  | 'xiaohongshu'
  | 'kuaishou';

export type GrowthAcquisitionMode =
  | 'keyword'
  | 'search-account'
  | 'video-link'
  | 'target-account'
  | 'retention'
  | 'manual-import';

export type GrowthRiskMode = 'auto' | 'confirm-first' | 'draft-only';

export type GrowthTaskStatus = 'enabled' | 'disabled' | 'running';

export type GrowthRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped';

export type GrowthLeadStatus =
  | 'new'
  | 'contacted'
  | 'replied'
  | 'qualified'
  | 'converted'
  | 'ignored'
  | 'blocked';

export type GrowthLeadSourceType =
  | 'auto-acquisition'
  | 'redfox-intelligence'
  | 'comment'
  | 'direct-message'
  | 'wechat-group'
  | 'wechat-moments'
  | 'manual-import';

export type GrowthWorkflowStatus =
  | 'draft'
  | 'enabled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

export type GrowthWorkflowAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'enable'
  | 'advance'
  | 'complete-step'
  | 'fail'
  | 'reset';

export type GrowthWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'waiting-confirmation';

export type GrowthExecutionFailureReason =
  | 'engine_unavailable'
  | 'account_not_logged_in'
  | 'account_risk_control'
  | 'captcha_required'
  | 'target_not_found'
  | 'editor_missing'
  | 'send_button_missing'
  | 'send_failed'
  | 'readback_failed'
  | 'daily_limit_reached'
  | 'duplicate_target'
  | 'content_policy_blocked'
  | 'platform_structure_changed'
  | 'unknown';

export type GrowthIntelligenceActionType =
  | 'add-benchmark-account'
  | 'create-growth-strategy'
  | 'create-leads'
  | 'enable-acquisition-execution'
  | 'send-comment-or-message';

export type GrowthLeadConfirmationStatus =
  | 'strategy-only'
  | 'needs-human-confirmation'
  | 'ready-for-confirmation'
  | 'skipped-duplicate';

export interface GrowthIntelligenceEvidence {
  source: string;
  sourceId?: string;
  sourceUrl?: string;
  evidenceUrl?: string;
  rawHash?: string;
  collectedAt: string;
  note: string;
}

export interface RedfoxBenchmarkAccountInput {
  platform: GrowthPlatform;
  nickname: string;
  externalUserId?: string;
  profileUrl?: string;
  sourceUrl?: string;
  reason?: string;
  metrics?: Record<string, unknown>;
  contentSignals?: string[];
  intentSignals?: string[];
  evidence?: GrowthIntelligenceEvidence[];
}

export interface GrowthBenchmarkAccountPoolDraft {
  id: string;
  platform: GrowthPlatform;
  nickname: string;
  externalUserId?: string;
  profileUrl?: string;
  reason: string;
  metrics: Record<string, unknown>;
  suggestedUse: 'strategy-source' | 'lead-source' | 'account-health-reference';
  evidenceChain: GrowthIntelligenceEvidence[];
}

export interface GrowthLeadConfirmationDraft {
  id: string;
  platform: GrowthPlatform;
  nickname: string;
  profileUrl?: string;
  externalUserId?: string;
  sourceText: string;
  sourceUrl?: string;
  matchedKeywords: string[];
  score: number;
  scoreReasons: string[];
  confirmationStatus: GrowthLeadConfirmationStatus;
  requiredHumanConfirmation: true;
  confirmationReason: string;
  evidenceChain: GrowthIntelligenceEvidence[];
}

export interface GrowthIntelligenceManualAction {
  action: GrowthIntelligenceActionType;
  required: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  reason: string;
}

export interface GrowthBenchmarkAccountIntakePreview {
  generatedAt: string;
  source: 'redfox-benchmark-accounts';
  accountPoolDrafts: GrowthBenchmarkAccountPoolDraft[];
  strategyDraft: Omit<
    GrowthStrategyTemplate,
    'id' | 'createdAt' | 'updatedAt' | 'diagnostics'
  > & {
    evidenceChain: GrowthIntelligenceEvidence[];
  };
  leadConfirmationDrafts: GrowthLeadConfirmationDraft[];
  manualActions: GrowthIntelligenceManualAction[];
  evidenceChain: GrowthIntelligenceEvidence[];
  nextActions: string[];
}

export interface GrowthLeadConfirmationInput {
  confirmed: boolean;
  confirmedBy?: string;
  note?: string;
  allowDuplicates?: boolean;
  leads: GrowthLeadConfirmationDraft[];
}

export interface GrowthLeadConfirmationResult {
  generatedAt: string;
  createdCount: number;
  skippedCount: number;
  leads: GrowthLead[];
  skipped: Array<{
    draftId: string;
    nickname: string;
    reason: string;
  }>;
  duplicateMatches: Array<{
    draftId: string;
    matches: GrowthLeadDedupeMatch[];
  }>;
}

export interface GrowthStrategyTemplate {
  id: string;
  userId: string;
  tenantId?: string;
  industry: string;
  scenario: string;
  name: string;
  sourceKeywords: string[];
  demandKeywords: string[];
  excludeKeywords: string[];
  blacklistNicknames: string[];
  commentTemplates: string[];
  privateMessageTemplates: string[];
  defaultDailyLimit: number;
  defaultRiskMode: GrowthRiskMode;
  scoringRules: Array<{
    label: string;
    keywords: string[];
    score: number;
  }>;
  createdAt: string;
  updatedAt: string;
  diagnostics?: GrowthStrategyDiagnostics;
}

export interface GrowthStrategyDiagnostics {
  score: number;
  level: 'excellent' | 'healthy' | 'needs-work' | 'risky';
  strengths: string[];
  issues: string[];
  suggestions: string[];
  recommendedModes: GrowthAcquisitionMode[];
}

export interface GrowthAcquisitionConfig {
  id: string;
  userId: string;
  tenantId?: string;
  mode: GrowthAcquisitionMode;
  taskName: string;
  platform: GrowthPlatform;
  accountId: string;
  accountName?: string;
  sourceInputs: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  blacklistNicknames: string[];
  commentTemplates: string[];
  privateMessageTemplates: string[];
  dailyLimit: number;
  perTargetLimit: number;
  deduplicate: boolean;
  scheduleEnabled: boolean;
  beginTime: string;
  riskMode: GrowthRiskMode;
  status: GrowthTaskStatus;
  exposureCount: number;
  exposureDate: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthLead {
  id: string;
  userId: string;
  tenantId?: string;
  platform: GrowthPlatform;
  sourceType: GrowthLeadSourceType;
  sourceTaskId?: string;
  sourceRunId?: string;
  crmCustomerId?: string;
  nickname: string;
  profileUrl?: string;
  avatarUrl?: string;
  externalUserId?: string;
  sourceText: string;
  sourceUrl?: string;
  videoTitle?: string;
  videoUrl?: string;
  commentTime?: string;
  matchedKeywords: string[];
  score: number;
  scoreReasons: string[];
  status: GrowthLeadStatus;
  nextFollowUpAt?: string;
  ownerUserId?: string;
  notes?: GrowthLeadNote[];
  evidenceUrls: string[];
  latestReply?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthLeadNote {
  id: string;
  text: string;
  type: 'follow-up' | 'status-change' | 'merge' | 'general';
  createdAt: string;
  createdBy?: string;
}

export interface GrowthLeadDedupeMatch {
  lead: GrowthLead;
  reasons: string[];
  score: number;
}

export interface GrowthAcquisitionRun {
  id: string;
  userId: string;
  tenantId?: string;
  configId: string;
  mode: GrowthAcquisitionMode;
  platform: GrowthPlatform;
  status: GrowthRunStatus;
  failureReason?: GrowthExecutionFailureReason;
  message: string;
  candidateCount: number;
  selectedCount: number;
  contactedCount: number;
  crmCapturedCount: number;
  evidenceUrls: string[];
  leadIds: string[];
  startedAt: string;
  endedAt?: string;
}

export interface GrowthSchedulePlan {
  generatedAt: string;
  readyCount: number;
  blockedCount: number;
  waitingCount: number;
  items: Array<{
    configId: string;
    taskName: string;
    platform: GrowthPlatform;
    accountId: string;
    accountName?: string;
    mode: GrowthAcquisitionMode;
    scheduleEnabled: boolean;
    beginTime: string;
    dailyLimit: number;
    exposureCount: number;
    remainingToday: number;
    status:
      | 'ready'
      | 'waiting-confirmation'
      | 'waiting-time'
      | 'blocked'
      | 'exhausted'
      | 'disabled';
    reason: string;
    nextRunAt?: string;
    lastRunAt?: string;
  }>;
}

export interface GrowthRuntimeStatus {
  executionEnabled: boolean;
  schedulerDaemonEnabled: boolean;
  schedulerDaemonArmed: boolean;
  schedulerLeaseMs: number;
  mode: 'live-execution' | 'safety-review';
  ownerId: string;
  running: boolean;
  targetCount: number;
  dueReadyCount: number;
  nextRunAt?: string;
  lastRunAt?: string;
  staleLeaseCount: number;
  leases: Array<{
    id: string;
    userId: string;
    tenantId?: string;
    ownerId: string;
    lockedUntil: string;
    heartbeatAt?: string;
    lastRunAt?: string;
    status: string;
    message?: string;
    locked: boolean;
  }>;
}

export interface GrowthCommercialReadiness {
  generatedAt: string;
  status: 'ready' | 'blocked';
  summary: string;
  runtime: {
    executionEnabled: boolean;
    schedulerDaemonEnabled: boolean;
    schedulerDaemonArmed: boolean;
    mode: GrowthRuntimeStatus['mode'];
    running: boolean;
  };
  accounts: {
    total: number;
    onlineNormal: number;
    blocked: number;
  };
  plan: {
    readyCount: number;
    blockedCount: number;
    waitingCount: number;
    itemCount: number;
  };
  blockers: Array<{
    code: string;
    title: string;
    detail: string;
    action: string;
  }>;
  warnings: Array<{
    code: string;
    title: string;
    detail: string;
    action: string;
  }>;
  nextActions: string[];
}

export interface GrowthCommercialReadinessRemediation {
  generatedAt: string;
  status: 'changed' | 'blocked' | 'noop';
  changedCount: number;
  refreshedAccountCount: number;
  enabledConfigIds: string[];
  requiresHumanLogin: boolean;
  skipped: Array<{
    configId?: string;
    taskName?: string;
    reason: string;
    action: string;
  }>;
  message: string;
  readiness: GrowthCommercialReadiness;
}

export type GrowthCommercialAuditAction =
  | 'commercial-readiness-remediate'
  | 'acquisition-schedule-run';

export interface GrowthCommercialAuditRecord {
  id: string;
  userId: string;
  tenantId?: string;
  action: GrowthCommercialAuditAction;
  status:
    | GrowthCommercialReadiness['status']
    | GrowthCommercialReadinessRemediation['status'];
  createdAt: string;
  runtime: GrowthCommercialReadiness['runtime'];
  accounts: GrowthCommercialReadiness['accounts'];
  plan: GrowthCommercialReadiness['plan'];
  blockers: GrowthCommercialReadiness['blockers'];
  warnings: GrowthCommercialReadiness['warnings'];
  result: {
    message: string;
    changedCount?: number;
    executedCount?: number;
    requestedLimit?: number;
    trigger?: string;
  };
}

export interface GrowthAcquisitionPreflight {
  config: GrowthAcquisitionConfig;
  account?: GrowthAccountHealth;
  planItem?: GrowthSchedulePlan['items'][number];
  allowed: boolean;
  remainingToday: number;
  checks: string[];
  warnings: string[];
  blockers: string[];
  summary: string;
}

export interface GrowthAccountHealth {
  id: string;
  userId: string;
  tenantId?: string;
  platform: GrowthPlatform;
  accountId: string;
  accountName: string;
  loginStatus: 'unknown' | 'online' | 'expired' | 'verification-required';
  todayActionCount: number;
  failureRate: number;
  riskStatus: 'normal' | 'cooldown' | 'paused' | 'needs-human';
  cooldownUntil?: string;
  recommendation: string;
  lastCheckedAt: string;
}

export interface GrowthWorkflow {
  id: string;
  userId: string;
  tenantId?: string;
  name: string;
  template: string;
  status: GrowthWorkflowStatus;
  steps: Array<{
    id: string;
    name: string;
    type:
      | 'strategy'
      | 'content'
      | 'publish'
      | 'acquisition'
      | 'follow-up'
      | 'crm'
      | 'report';
    riskMode: GrowthRiskMode;
    status: GrowthWorkflowStepStatus;
    description?: string;
    linkedResourceId?: string;
    startedAt?: string;
    completedAt?: string;
    outputSummary?: string;
  }>;
  currentStepId?: string;
  lastAction?: string;
  lastActionAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthStore {
  version: number;
  strategies: GrowthStrategyTemplate[];
  configs: GrowthAcquisitionConfig[];
  runs: GrowthAcquisitionRun[];
  leads: GrowthLead[];
  accountHealth: GrowthAccountHealth[];
  workflows: GrowthWorkflow[];
  commercialAudits: GrowthCommercialAuditRecord[];
}

export interface GrowthOverview {
  todayLeadCount: number;
  todayContactedCount: number;
  todayCrmCapturedCount: number;
  activeConfigCount: number;
  highIntentLeadCount: number;
  accountRiskCount: number;
  funnel: {
    candidates: number;
    selected: number;
    contacted: number;
    crmCaptured: number;
    converted: number;
  };
  recentRuns: GrowthAcquisitionRun[];
  hotStrategies: GrowthStrategyTemplate[];
}

export interface GrowthReports {
  overview: GrowthOverview;
  funnel: GrowthOverview['funnel'];
  copywriting: Array<{
    text: string;
    usageCount: number;
    averageLeadScore: number;
    contactRate: number;
  }>;
  accounts: GrowthAccountHealth[];
  tasks: GrowthAcquisitionRun[];
  trend: Array<{
    date: string;
    leads: number;
    selected: number;
    contacted: number;
    converted: number;
    failed: number;
    skipped: number;
  }>;
  taskPerformance: Array<{
    configId: string;
    taskName: string;
    mode: GrowthAcquisitionMode;
    platform: GrowthPlatform;
    runCount: number;
    candidateCount: number;
    selectedCount: number;
    contactedCount: number;
    failedCount: number;
    skippedCount: number;
    lastRunAt?: string;
  }>;
  accountPerformance: Array<{
    accountKey: string;
    accountName: string;
    platform: GrowthPlatform;
    runCount: number;
    candidateCount: number;
    selectedCount: number;
    contactedCount: number;
    failedCount: number;
    skippedCount: number;
    lastRunAt?: string;
  }>;
  bottlenecks: Array<{
    level: 'info' | 'warning' | 'danger';
    title: string;
    detail: string;
    action: string;
  }>;
  leadStatusDistribution: Array<{
    status: GrowthLeadStatus;
    count: number;
  }>;
}
