import { api } from "./client";
import type { AutoUploadRiskConfirmationInput } from "./auto-upload";
import type {
  AgentSession,
  ArchiveAgentSessionInput,
  CreateAgentSessionInput,
} from "./local-engine";

export type { AgentSession, ArchiveAgentSessionInput, CreateAgentSessionInput };

export type AiEmployeeLeadCandidate = {
  text: string;
  sourceUrl?: string;
  kind?: string;
  index?: number;
  targetName?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  score?: number;
  reason?: string;
};

export type AiEmployeeEvidence = {
  type: string;
  label: string;
  value?: string;
  url?: string;
  path?: string;
  createdAt: string;
  raw?: Record<string, unknown>;
};

export type AiEmployeeRunResult = {
  ok: boolean;
  status: "success" | "failed" | "blocked" | "skipped";
  reasonCode: string;
  message: string;
  detail?: string;
  executionKind: "candidate_read";
  platformAction: false;
  candidates: AiEmployeeLeadCandidate[];
  evidence: AiEmployeeEvidence[];
};

export type AiEmployeeDouyinFollowUpTarget = {
  targetName: string;
  text: string;
  sourceUrl?: string;
  kind?: string;
  commentMode?: "reply" | "video-comment";
  index?: number;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  score: number;
  reason: string;
  sourceText: string;
  followUpActions?: Array<"comment" | "message">;
  commentTaskEnabled?: boolean;
  messageTaskEnabled?: boolean;
  directMessageBlockedReason?: string;
  commentReplyText: string;
  directMessageText: string;
};

export type AiEmployeeDouyinFollowUpPlan = {
  sourceLabel: string;
  sourceText: string;
  accountName: string;
  dailyLimit: number;
  privateMessage: string;
  commentTemplates: string[];
  messageTemplates: string[];
  filters: {
    includeKeywords: string[];
    blacklistKeywords: string[];
    minScore: number;
  };
  targets: AiEmployeeDouyinFollowUpTarget[];
  skipped: Array<{
    text: string;
    sourceUrl?: string;
    kind?: string;
    index?: number;
    targetName?: string;
    profileUrl?: string;
    commentTime?: string;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    score: number;
    reason: string;
  }>;
  summary: {
    totalCandidates: number;
    selectedCount: number;
    skippedCount: number;
    commentTaskCount: number;
    messageTaskCount: number;
    commentTemplateCount?: number;
    messageTemplateCount?: number;
    nextAction: string;
  };
};

export type AiEmployeeDouyinFollowUpExecuteResult = {
  ok: boolean;
  status: "success" | "partial" | "failed";
  message: string;
  summary: {
    totalTargets: number;
    attemptedCount: number;
    successCount: number;
    failedCount: number;
    sendMode: "auto-send" | "draft-only";
    videoCount?: number;
  };
  results: Array<{
    index: number;
    action: "comment" | "message";
    targetName?: string;
    targetText?: string;
    replyText?: string;
    ok: boolean;
    status: "success" | "failed" | "blocked" | "skipped";
    reasonCode: string;
    message: string;
    evidence: AiEmployeeEvidence[];
    readback?: {
      expectedText?: string;
      actualText?: string;
      matched: boolean;
    };
  }>;
};

export type AiEmployeeAutoAcquisitionConfigStatus =
  | "enabled"
  | "disabled"
  | "running";

export type AiEmployeeAutoAcquisitionConfig = {
  id: string;
  taskName: string;
  accountId: string;
  account: string;
  socialPlatform: "抖音";
  reason: string;
  commentMode: "reply" | "video-comment";
  searchKeywords: string;
  keywords: string;
  contents: string;
  blacklistNicknames: string;
  enterpriseOnly: boolean;
  appendCommentEnabled: boolean;
  appendComments: string;
  dailyLimit: number;
  exposureCount: number;
  exposureDate?: string;
  deduplicate: boolean;
  beginTime: string;
  createdTime: string;
  createdAt?: string;
  updatedAt?: string;
  lastRunAt?: string;
  lastScheduledRunDate?: string;
  status: AiEmployeeAutoAcquisitionConfigStatus;
};

export type AiEmployeeAutoAcquisitionRecord = {
  id: string;
  configId: string;
  taskName: string;
  createdTime: string;
  createdAt?: string;
  trigger?: "manual" | "schedule";
  status: string;
  message: string;
  keyword: string;
  candidateCount: number;
  selectedCount: number;
  videoCount?: number;
  evidenceUrl?: string;
  targets?: AiEmployeeDouyinFollowUpTarget[];
  executionResults?: Array<{
    index: number;
    targetName?: string;
    targetText?: string;
    replyText?: string;
    ok: boolean;
    status: string;
    message: string;
    evidenceUrl?: string;
  }>;
  executionSummary?: {
    attemptedCount: number;
    successCount: number;
    failedCount: number;
    message: string;
  };
  crmCapture?: {
    enabled: boolean;
    capturedCount: number;
    skippedCount: number;
    message: string;
  };
};

export type AiEmployeeAutoAcquisitionSnapshot = {
  configs: AiEmployeeAutoAcquisitionConfig[];
  records: AiEmployeeAutoAcquisitionRecord[];
  scheduler: {
    configured?: boolean;
    enabled: boolean;
    armed?: boolean;
    tickMs: number;
  };
};

export type AiEmployeeAutoAcquisitionExecution = {
  config: AiEmployeeAutoAcquisitionConfig;
  record: AiEmployeeAutoAcquisitionRecord;
};

export type AiEmployeeAutoAcquisitionExecutionConfirmation = {
  confirmationId: string;
  action: string;
  riskLevel: string;
  target?: string | null;
  expiresAt: string;
  singleUse: boolean;
};

export type AiEmployeeCapabilityStatus =
  | "real"
  | "simulated"
  | "needs_config"
  | "unavailable";

export type AiEmployeeCapabilityRiskLevel = "low" | "medium" | "high";

export type AiEmployeeCapability = {
  key: string;
  domain: string;
  title: string;
  platform: string;
  runtimePath: string;
  routeableNow: boolean;
  executorTaskType?: string;
  status: AiEmployeeCapabilityStatus;
  riskLevel: AiEmployeeCapabilityRiskLevel;
  executionMode: "real" | "simulated" | "configuration" | "blocked";
  message: string;
  nextAction: string;
  acceptance: string[];
  blockers: string[];
  executor?: {
    key: string;
    name: string;
    status: string;
    message: string;
    nextAction: string;
  };
};

export type AiEmployeeCapabilitiesSnapshot = {
  checkedAt: string;
  summary: {
    total: number;
    real: number;
    simulated: number;
    needsConfig: number;
    unavailable: number;
    localEngineReady: boolean;
  };
  readiness?: {
    ready: boolean;
    blockers: number;
    warnings: number;
    nextAction: string;
  };
  capabilities: AiEmployeeCapability[];
};

export type AiEmployeeCoreTaskType =
  | "workflow.auto"
  | "exposure.auto"
  | "exposure.targeted"
  | "exposure.link"
  | "exposure.search_account"
  | "exposure.retention"
  | "ai_service.config_test"
  | "publish.multi_platform"
  | "video.template_clip";

export type AiEmployeeDryRunTaskInput = {
  type?: AiEmployeeCoreTaskType;
  title?: string;
  instruction?: string;
  accountId?: string;
  payload?: Record<string, unknown>;
};

export type AiEmployeeDryRunTaskResult = {
  taskType: AiEmployeeCoreTaskType;
  executionMode: "simulated";
  displayStatus: "waiting_confirmation";
  capabilityKey?: string;
  nextAction?: string;
  session: AgentSession;
};

export type AiEmployeeWorkflowPreparationInput = {
  title?: string;
  accountId?: string;
  workflow?: Record<string, unknown> & {
    id?: string;
    platform?: string;
    material?: string;
    exposureMode?: AiEmployeeExposureMode;
    exposureExecutionKind?: "candidate_read" | "customer_action";
    includeVideoClip?: boolean;
    includeExposure?: boolean;
    includePublish?: boolean;
  };
};

export type AiEmployeeExposureMode =
  | "link"
  | "search_account"
  | "hot_video"
  | "targeted"
  | "retention";

export type AiEmployeeWorkflowStepActionKind =
  | "local_operation"
  | "candidate_read"
  | "customer_action"
  | "platform_action";

export type AiEmployeeWorkflowStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AiEmployeeWorkflowRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "blocked"
  | "failed"
  | "cancelling"
  | "cancelled";

export type AiEmployeeWorkflowBlocker = {
  code: string;
  stepId?: string;
  title: string;
  message: string;
  nextAction: string;
};

export type AiEmployeeWorkflowStepDefinition = {
  id: string;
  capabilityKey: string;
  title: string;
  actionKind: AiEmployeeWorkflowStepActionKind;
  exposureMode?: AiEmployeeExposureMode;
  taskType?: string;
  platform: string;
  accountId?: string;
  payload: Record<string, unknown>;
  sendMode: "auto-send" | "draft-only";
  dependencies: string[];
  availability: "available" | "blocked";
  capabilityStatus: AiEmployeeCapabilityStatus;
  message: string;
  nextAction: string;
  requiresEvidence: true;
  requiresReadback: boolean;
};

export type AiEmployeeWorkflowExecutionPolicy = {
  defaultSendMode: "auto-send";
  hasCustomerActions: boolean;
  hasPlatformActions: boolean;
  requiresConfirmation: boolean;
};

export type AiEmployeeWorkflowConfirmationMetadata = {
  auditId: string;
  confirmationId: string;
  action: string;
  riskLevel: "low" | "medium" | "high";
  operator: string;
  operatorId?: string;
  reason?: string;
  confirmedAt: string;
  appliedAt: string;
  source: "manual" | "retry" | "schedule";
  parentAuditId?: string;
  checklist?: Record<string, boolean>;
};

export type AiEmployeeWorkflowSchedule = {
  enabled: true;
  frequency: string;
  timeWindow: string;
  timezone: string;
  status: "awaiting_confirmation" | "active";
  nextRunAt?: string;
  lastScheduledAt?: string;
  authorization?: AiEmployeeWorkflowConfirmationMetadata;
};

export type AiEmployeeWorkflowDefinition = {
  id: string;
  version: number;
  title: string;
  accountId?: string;
  platform: string;
  config: Record<string, unknown>;
  status: "ready" | "partially_ready" | "blocked";
  steps: AiEmployeeWorkflowStepDefinition[];
  blockers: AiEmployeeWorkflowBlocker[];
  executionPolicy: AiEmployeeWorkflowExecutionPolicy;
  schedule?: AiEmployeeWorkflowSchedule;
  createdAt: string;
  updatedAt: string;
};

export type AiEmployeeWorkflowStepRun = {
  stepId: string;
  capabilityKey: string;
  title: string;
  actionKind: AiEmployeeWorkflowStepActionKind;
  exposureMode?: AiEmployeeExposureMode;
  taskType?: string;
  status: AiEmployeeWorkflowStepStatus;
  attempt: number;
  transitions: Array<{
    from: AiEmployeeWorkflowStepStatus | null;
    to: AiEmployeeWorkflowStepStatus;
    at: string;
    attempt: number;
    message: string;
  }>;
  message: string;
  nextAction?: string;
  reasonCode?: string;
  technicalMessage?: string;
  evidence: AiEmployeeEvidence[];
  readback?: {
    expectedText?: string;
    actualText?: string;
    matched: boolean;
  };
  output?: {
    candidateCount?: number;
    candidates?: Array<Record<string, unknown>>;
    runtime?: Record<string, unknown>;
  };
  startedAt?: string;
  finishedAt?: string;
};

export type AiEmployeeWorkflowRun = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  title: string;
  status: AiEmployeeWorkflowRunStatus;
  trigger: "manual" | "retry" | "schedule";
  executionPolicy: AiEmployeeWorkflowExecutionPolicy;
  confirmation?: AiEmployeeWorkflowConfirmationMetadata;
  confirmations: AiEmployeeWorkflowConfirmationMetadata[];
  steps: AiEmployeeWorkflowStepRun[];
  aggregate: {
    totalSteps: number;
    pendingSteps: number;
    runningSteps: number;
    completedSteps: number;
    blockedSteps: number;
    failedSteps: number;
    cancelledSteps: number;
    evidenceCount: number;
    candidateCount: number;
    readbacks: Array<{
      stepId: string;
      title: string;
      matched: boolean;
      expectedText?: string;
      actualText?: string;
    }>;
  };
  cancelRequestedAt?: string;
  cancellationMessage?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  recovery?: {
    recoveredAt: string;
    previousStatus: "queued" | "running" | "cancelling";
    message: string;
  };
};

export type AiEmployeeWorkflowConfirmationInput =
  AutoUploadRiskConfirmationInput & {
    confirmationId: string;
    confirmedAt: string;
    reason: string;
    checklist: Record<string, boolean>;
  };

export type AiEmployeeWorkflowSnapshot = {
  definitions: AiEmployeeWorkflowDefinition[];
  runs: AiEmployeeWorkflowRun[];
};

export type AiEmployeeWorkflowPreparationResult = {
  taskType: "workflow.auto";
  executionMode: "configured";
  displayStatus: "ready" | "partially_ready" | "configuration_required";
  message: string;
  nextAction: string;
  definition: AiEmployeeWorkflowDefinition;
  steps: AiEmployeeWorkflowStepDefinition[];
  blockers: AiEmployeeWorkflowBlocker[];
};

export type AiEmployeeReadinessStep = {
  key: string;
  name: string;
  status: "ready" | "blocked";
  message: string;
  nextAction: string;
};

export type AiEmployeeReadiness = {
  ok: boolean;
  status: "ready" | "blocked";
  checkedAt: string;
  summary: string;
  nextAction: string;
  acceptanceFlow: string[];
  blockers: Array<{
    key: string;
    name: string;
    message: string;
    nextAction: string;
  }>;
  steps: AiEmployeeReadinessStep[];
};

export type AiEmployeeP1ReadinessStep = AiEmployeeReadinessStep;
export type AiEmployeeP1Readiness = AiEmployeeReadiness;
export type AiEmployeeP2ReadinessStep = AiEmployeeReadinessStep;
export type AiEmployeeP2Readiness = AiEmployeeReadiness;

export const aiEmployeeApi = {
  sessions(limit = 80) {
    return api.get<AgentSession[]>(`/ai-employee/sessions?limit=${limit}`);
  },

  capabilities() {
    return api.get<AiEmployeeCapabilitiesSnapshot>("/ai-employee/capabilities");
  },

  createSession(input: CreateAgentSessionInput) {
    return api.post<AgentSession>("/ai-employee/sessions", input);
  },

  createDryRunTask(input: AiEmployeeDryRunTaskInput) {
    return api.post<AiEmployeeDryRunTaskResult>(
      "/ai-employee/tasks/dry-run",
      input,
    );
  },

  prepareWorkflow(input: AiEmployeeWorkflowPreparationInput) {
    return api.post<AiEmployeeWorkflowPreparationResult>(
      "/ai-employee/workflows/prepare",
      input,
    );
  },

  workflows(limit = 50) {
    return api.get<AiEmployeeWorkflowSnapshot>(
      `/ai-employee/workflows?limit=${limit}`,
    );
  },

  workflowRun(id: string) {
    return api.get<AiEmployeeWorkflowRun>(
      `/ai-employee/workflows/runs/${encodeURIComponent(id)}`,
    );
  },

  startWorkflow(
    id: string,
    riskConfirmation: AiEmployeeWorkflowConfirmationInput,
  ) {
    return api.post<AiEmployeeWorkflowRun>(
      `/ai-employee/workflows/${encodeURIComponent(id)}/runs`,
      { riskConfirmation },
    );
  },

  retryWorkflowRun(
    id: string,
    input: {
      stepIds?: string[];
      riskConfirmation: AiEmployeeWorkflowConfirmationInput;
    },
  ) {
    return api.post<AiEmployeeWorkflowRun>(
      `/ai-employee/workflows/runs/${encodeURIComponent(id)}/retry`,
      input,
    );
  },

  cancelWorkflowRun(id: string) {
    return api.post<AiEmployeeWorkflowRun>(
      `/ai-employee/workflows/runs/${encodeURIComponent(id)}/cancel`,
    );
  },

  stopSession(id: string) {
    return api.post<AgentSession>(`/ai-employee/sessions/${id}/stop`);
  },

  archiveSession(id: string, input?: ArchiveAgentSessionInput) {
    return api.delete<AgentSession>(`/ai-employee/sessions/${id}`, input || {});
  },

  autoAcquisition() {
    return api.get<AiEmployeeAutoAcquisitionSnapshot>(
      "/ai-employee/auto-acquisition",
    );
  },

  createAutoAcquisitionConfig(
    input: Partial<AiEmployeeAutoAcquisitionConfig> & {
      enabled?: boolean;
      riskConfirmation?: AutoUploadRiskConfirmationInput;
    },
  ) {
    return api.post<AiEmployeeAutoAcquisitionConfig>(
      "/ai-employee/auto-acquisition",
      input,
    );
  },

  updateAutoAcquisitionConfig(
    id: string,
    input: Partial<AiEmployeeAutoAcquisitionConfig> & {
      enabled?: boolean;
      riskConfirmation?: AutoUploadRiskConfirmationInput;
    },
  ) {
    return api.post<AiEmployeeAutoAcquisitionConfig>(
      `/ai-employee/auto-acquisition/${id}`,
      input,
    );
  },

  updateAutoAcquisitionConfigStatus(
    id: string,
    input: {
      enabled: boolean;
      riskConfirmation?: AutoUploadRiskConfirmationInput;
    },
  ) {
    return api.post<AiEmployeeAutoAcquisitionConfig>(
      `/ai-employee/auto-acquisition/${id}/status`,
      input,
    );
  },

  deleteAutoAcquisitionConfig(id: string) {
    return api.delete<{ ok: boolean }>(`/ai-employee/auto-acquisition/${id}`);
  },

  executeAutoAcquisitionConfig(
    id: string,
    riskConfirmation?: AutoUploadRiskConfirmationInput,
  ) {
    return api.post<AiEmployeeAutoAcquisitionExecution>(
      `/ai-employee/auto-acquisition/${id}/execute`,
      { riskConfirmation },
    );
  },

  createAutoAcquisitionExecutionConfirmation(id: string) {
    return api.post<AiEmployeeAutoAcquisitionExecutionConfirmation>(
      `/ai-employee/auto-acquisition/${id}/execute/confirmations`,
    );
  },

  findDouyinLeadsByLink(input: {
    accountId: string;
    link: string;
    limit?: number;
    commentTimeMatch?: string;
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/douyin/link-leads",
      input,
    );
  },

  findDouyinLeadsByKeyword(input: {
    accountId: string;
    keyword: string;
    limit?: number;
    commentTimeMatch?: string;
    nicknameKeywords?: string[];
    blacklistNicknames?: string[];
    enterpriseOnly?: boolean;
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/douyin/search-leads",
      input,
    );
  },

  findDouyinHotVideoLeads(input: {
    accountId: string;
    keyword: string;
    limit?: number;
    commentTimeMatch?: string;
    blacklistNicknames?: string[];
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/douyin/hot-video-leads",
      input,
    );
  },

  findDouyinTargetedLeads(input: {
    accountId: string;
    targetAccounts: string[];
    keyword?: string;
    limit?: number;
    commentTimeMatch?: string;
    perTargetLimit?: number;
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/douyin/targeted-leads",
      input,
    );
  },

  findDouyinRetentionLeads(input: {
    accountId: string;
    retentionSourceId: string;
    keyword?: string;
    limit?: number;
    commentTimeMatch?: string;
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/douyin/retention-leads",
      input,
    );
  },

  planDouyinFollowUp(input: {
    candidates: AiEmployeeLeadCandidate[];
    sourceLabel: string;
    sourceText: string;
    accountName: string;
    privateMessage?: string;
    commentTemplates?: string[];
    messageTemplates?: string[];
    dailyLimit?: number;
    includeKeywords?: string[];
    blacklistKeywords?: string[];
    minScore?: number;
    maxTargets?: number;
    maxActionsPerTarget?: number;
  }) {
    return api.post<AiEmployeeDouyinFollowUpPlan>(
      "/ai-employee/douyin/follow-up-plan",
      input,
    );
  },

  executeDouyinFollowUp(input: {
    accountId: string;
    targets: AiEmployeeDouyinFollowUpTarget[];
    maxTargets?: number;
    autoSend?: boolean;
    sourceCapability?:
      | "douyin-link-exposure"
      | "douyin-search-account-exposure"
      | "douyin-hot-video-exposure"
      | "douyin-targeted-exposure"
      | "douyin-retention-exposure";
    riskConfirmation?: AutoUploadRiskConfirmationInput;
  }) {
    return api.post<AiEmployeeDouyinFollowUpExecuteResult>(
      "/ai-employee/douyin/follow-up-execute",
      input,
    );
  },

  checkP1Readiness(input: {
    douyinAccountId?: string;
    douyinAccountName?: string;
    mode?: string;
    sourceText?: string;
    candidateCount?: number;
    followUpTaskCount?: number;
    followUpFailedCount?: number;
    followUpCompletedCount?: number;
    followUpEvidenceCount?: number;
    evidenceCount?: number;
    commentTemplateCount?: number;
    messageTemplateCount?: number;
    dailyLimit?: number;
    privateMessage?: string;
    publishAccountCount?: number;
    publishMaterialPath?: string;
    publishTitle?: string;
    publishCopy?: string;
    publishDailyLimit?: number;
    publishDailyTimes?: string[];
    publishPreflightOk?: boolean;
    publishPreflightSummary?: string;
    publishResultCount?: number;
    publishFailedCount?: number;
    publishSuccessCount?: number;
    publishPendingCount?: number;
  }) {
    return api.post<AiEmployeeP1Readiness>("/ai-employee/p1/readiness", input);
  },

  checkP2Readiness(input: {
    desktopOnline?: boolean;
    agentConnected?: boolean;
    sessionReadable?: boolean;
    sessionConfirmed?: boolean;
    contactName?: string;
    latestMessageCount?: number;
    replyText?: string;
    replyTaskCount?: number;
    replyCompletedCount?: number;
    groupTargetCount?: number;
    groupTagCount?: number;
    groupDailyLimit?: number;
    groupIntervalSeconds?: number;
    groupMessage?: string;
    groupTaskCount?: number;
    groupPausedCount?: number;
    groupResumableCount?: number;
    groupCompletedCount?: number;
    groupFailedCount?: number;
    contactTaskCount?: number;
    contactCompletedCount?: number;
    contactTargetCount?: number;
    contactDailyLimit?: number;
    contactFailedCount?: number;
    momentsPublishTaskCount?: number;
    momentsPublishCompletedCount?: number;
    momentsPublishFailedCount?: number;
    momentsPublishRemainingCount?: number;
    momentsContent?: string;
    momentsAssetPath?: string;
    momentsDailyCount?: number;
    momentsMarketingTaskCount?: number;
    momentsMarketingCompletedCount?: number;
    momentsMarketingFailedCount?: number;
    momentsMarketingRemainingCount?: number;
    momentsMarketingDailyLimit?: number;
    momentsMarketingMode?: string;
    videoClipTaskCount?: number;
    videoClipCompletedCount?: number;
    videoClipFailedCount?: number;
    videoMaterialPath?: string;
    videoTemplateName?: string;
    videoOutputPath?: string;
    publishAccountCount?: number;
    publishMaterialPath?: string;
    publishTitle?: string;
    publishCopy?: string;
    publishDailyLimit?: number;
    publishDailyTimes?: string[];
    publishPreflightOk?: boolean;
    publishResultCount?: number;
    publishFailedCount?: number;
    publishSuccessCount?: number;
    publishPendingCount?: number;
    evidenceCount?: number;
  }) {
    return api.post<AiEmployeeP2Readiness>("/ai-employee/p2/readiness", input);
  },

  clipVideoWithTemplate(input: {
    materialPath: string;
    templateName: string;
    titlePrompt?: string;
    outputName?: string;
  }) {
    return api.post<AiEmployeeRunResult>(
      "/ai-employee/video/template-clip",
      input,
    );
  },
};
