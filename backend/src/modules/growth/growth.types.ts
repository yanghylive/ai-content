import type { Prisma } from '@prisma/client';

export type GrowthPlatform =
  'douyin' | 'wechat-channel' | 'wechat' | 'wecom' | 'xiaohongshu' | 'kuaishou';

export type GrowthAcquisitionMode =
  | 'keyword'
  | 'search-account'
  | 'video-link'
  | 'target-account'
  | 'retention'
  | 'manual-import'
  | 'recommended';

export type GrowthRiskMode = 'auto' | 'confirm-first' | 'draft-only';

export type GrowthTaskStatus = 'enabled' | 'disabled' | 'running';

export type GrowthRunStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'skipped'
  | 'cancelled'; // §6.1 用户取消（running→cancelled）

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
  'draft' | 'enabled' | 'running' | 'paused' | 'completed' | 'failed';

export type GrowthWorkflowAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'enable'
  | 'advance'
  | 'complete-step'
  | 'fail'
  | 'reset'
  | 'await-confirmation'
  | 'confirm-step';

export type GrowthWorkflowStepStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'waiting-confirmation';

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
  | 'throttled'
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
  /** auto 模式启用审批留痕（复核#4：自动发送必须有审批，无审批不得 daemon 执行） */
  autoApprovedAt?: string;
  autoApprovedBy?: string;
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
  /** P1-11 复核：产生线索的平台账号 ID（从 config.accountId 透传，归因上游不丢） */
  sourceAccountId?: string;
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
  /** P1-6：统一侧桥接/评分/归因状态（失败时如实标注，前端显示"采集成功但评分未完成"） */
  enrichmentStatus?: 'ok' | 'failed';
  /** P0-5 复核：桥接失败的分段明细（interaction_event/platform_identity/scoring/...） */
  enrichmentFailure?: string;
  /** P0-6 复核：命中抑制名单（禁止自动转 CRM，强制留人工池） */
  suppressed?: boolean;
  /** 4.3：身份置信度（0-100；有 externalUserId=高，仅昵称+文本=低需人工确认） */
  identityConfidence?: number;
  /** 4.3：缺失的外部字段（externalUserId/profileUrl/externalEventId/commentTime 等） */
  missingFields?: string[];
  nextFollowUpAt?: string;
  ownerUserId?: string;
  notes?: GrowthLeadNote[];
  evidenceUrls: string[];
  latestReply?: string;
  createdAt: string;
  updatedAt: string;
  // —— 内容/发布归因（补齐「内容 → 发布 → 互动 → 线索」链路，缺省 null = 无上游内容）——
  sourceArticleId?: string | null;
  sourcePublishRecordId?: string | null;
  /** P1-11 复核：互动事件归因（InteractionEvent.id，桥接后回填） */
  sourceInteractionEventId?: string | null;
  contentId?: string | null;
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
  /** 复核#4 可追责字段：触发来源 / 风控模式 / 是否经本次确认 */
  trigger?: 'manual' | 'scheduled' | 'workflow' | 'api';
  runRiskMode?: GrowthRiskMode;
  approved?: boolean;
  /** P1-2：失败回退追踪（RPA 失败→回退本地适配器时如实标注来源） */
  fallback?: {
    attempted: boolean;
    source: 'rpa' | 'legacy-adapter' | 'manual-import' | 'none';
    rpaExecutionId: string | null;
    reasonCode: string | null;
    fallbackAllowed: boolean;
    message: string;
  };
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
  'commercial-readiness-remediate' | 'acquisition-schedule-run';

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
  /** 所属行业（行业方案库，14 行业体系） */
  industry?: string;
  /** 行业场景（如：小红书种草私域转化） */
  scenario?: string;
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
    /** 画布节点类型（kaypal FlowCanvas 移植）：aimodel/tool/memory/condition/strategy/content/acquisition/follow-up/crm/report */
    nodeType?: string;
    /** 依赖的步骤 id 列表（画布连线 → 执行顺序） */
    dependencies?: string[];
    /** 节点自定义配置（画布节点 data 冗余存储） */
    config?: Prisma.InputJsonValue;
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

// —— 3010「今日增长」首页聚合接口契约（开发文档 7.2 / P0-P1 计划 §2.1）——
// null 语义：底层 service 抛错/不可用时返回 null（前端显示「暂无数据/不可用」），
// 禁止降级成 0；0 仅表示真实统计为空。

export interface GrowthHomeStats {
  /** 今日新线索数（overview.todayLeadCount） */
  newLeads: number | null;
  /** 高意向线索数（overview.highIntentLeadCount） */
  highIntentLeads: number | null;
  /** 待触达：无成功互动事件且状态为 new/qualified 的线索数 */
  pendingContact: number | null;
  /** 今日进 CRM 数（overview.todayCrmCapturedCount） */
  crmCaptured: number | null;
  /** 未结商机金额（元）；无商机数据时为 null，不显示 ¥0 */
  openOpportunityAmount: number | null;
}

export interface GrowthHomeFunnel {
  candidates: number | null;
  selected: number | null;
  contacted: number | null;
  leads: number | null;
  customers: number | null;
  opportunities: number | null;
  won: number | null;
}

export interface GrowthHomeBlocker {
  code: string;
  title: string;
  /** 面向用户的具体阻断原因（任务/账号/运行时状态）。 */
  detail?: string;
  action: string;
}

export interface GrowthHomeNextAction {
  code: string;
  label: string;
  href: string;
}

export interface GrowthHomeResponse {
  /** ISO 8601，前端显示数据时间；聚合接口整体可用时始终返回 */
  generatedAt: string;
  stats: GrowthHomeStats;
  funnel: GrowthHomeFunnel;
  blockers: GrowthHomeBlocker[];
  recentRuns: GrowthAcquisitionRun[];
  nextActions: GrowthHomeNextAction[];
}

export interface GrowthSixStageFunnel {
  /** 内容数（article） */
  content: number;
  /** 发布记录数 */
  publish: number;
  /** 互动事件数 */
  interaction: number;
  /** 线索数 */
  lead: number;
  /** CRM 客户数 */
  customer: number;
  /** 商机数 */
  opportunity: number;
  /** 成交金额（分） */
  wonAmountCents: number;
  /** 内容→线索转化率（0-1，无内容时为 0）。按主键归因：有归因链的线索数 / 内容数 */
  contentConversionRate: number;
  /** 归因到的线索数（有 interaction/publish/content→lead 归因链的 lead 去重数） */
  attributedLeadCount: number;
  /** 归因到的客户数（有 lead→customer 归因链的 customer 去重数） */
  attributedCustomerCount: number;
  /** 归因置信度（有确定性归因链为 high，仅有规则/推断为 medium/low） */
  attributionConfidence: 'high' | 'medium' | 'low';
  /** 2026-09-01（审计 #12）：计算失败时的错误信息——不再静默归零，前端上屏 */
  funnelError?: string;
  platformComparison: Array<{
    platform: string;
    content: number;
    publish: number;
    interaction: number;
    lead: number;
    customer: number;
    opportunity: number;
  }>;
}

export interface GrowthReports {
  overview: GrowthOverview;
  funnel: GrowthOverview['funnel'];
  /** 六步闭环复盘（内容→发布→互动→线索→客户→商机），P1-15 新增 */
  sixStage: GrowthSixStageFunnel;
  copywriting: Array<{
    text: string;
    usageCount: number;
    averageLeadScore: number;
    contactRate: number;
    /** 样本 <30 时标注，前端显示"样本不足"（T2-2） */
    lowConfidence?: boolean;
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
  /**
   * P2 归因报告四维（按平台/策略/内容/话术）。旧前端可忽略；null 语义与 sixStage 一致。
   */
  attribution?: {
    byPlatform: Array<{
      platform: string;
      leads: number;
      customers: number;
      opportunities: number;
      won: number;
      wonAmountCents: number;
      conversionRate: number | null;
    }>;
    byStrategy: Array<{
      strategyId: string;
      strategyName: string;
      platform: string;
      leads: number;
      won: number;
      wonAmountCents: number;
      conversionRate: number | null;
    }>;
    byContent: Array<{
      articleId: string;
      title: string;
      publishCount: number;
      leads: number;
      customers: number;
      won: number;
      wonAmountCents: number;
    }>;
    byScript: Array<{
      text: string;
      usageCount: number;
      leads: number;
      won: number;
      wonAmountCents: number;
      lowConfidence?: boolean;
    }>;
    generatedAt: string;
  };
}
