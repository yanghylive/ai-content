import { api } from "./client";
import type { AutoUploadRiskConfirmationInput } from "./auto-upload";

export type GrowthPlatform =
    | "douyin"
    | "wechat-channel"
    | "wechat"
    | "wecom"
    | "xiaohongshu"
    | "kuaishou";

export type GrowthAcquisitionMode =
    | "keyword"
    | "search-account"
    | "video-link"
    | "target-account"
    | "retention"
    | "manual-import"
    | "recommended";

export type GrowthRiskMode = "auto" | "confirm-first" | "draft-only";

export type GrowthLeadStatus =
    | "new"
    | "contacted"
    | "replied"
    | "qualified"
    | "converted"
    | "ignored"
    | "blocked";

export interface GrowthStrategyTemplate {
    id: string;
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
    createdAt: string;
    updatedAt: string;
    diagnostics?: {
        score: number;
        level: "excellent" | "healthy" | "needs-work" | "risky";
        strengths: string[];
        issues: string[];
        suggestions: string[];
        recommendedModes: GrowthAcquisitionMode[];
    };
}

export interface GrowthAcquisitionConfig {
    id: string;
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
    status: "enabled" | "disabled" | "running";
    exposureCount: number;
    lastRunAt?: string;
    createdAt: string;
    updatedAt: string;
    /** 2026-09-04 实时遥测:该任务是否正在真实执行(有则自动开「正在干什么」面板) */
    live?: GrowthConfigLiveMeta;
}

/** 执行实时事件(与后端 growth.types GrowthRunLiveEvent 对齐) */
export interface GrowthRunLiveEvent {
    t: string;
    level: "info" | "ok" | "warn" | "err";
    text: string;
}

export interface GrowthConfigLiveMeta {
    running: true;
    startedAt: string;
    /** 最近一条执行事件文本 */
    stage: string;
}

export interface GrowthRunLiveResponse {
    running: boolean;
    done: boolean;
    startedAt: string;
    doneAt: string | null;
    after: number;
    events: GrowthRunLiveEvent[];
}

export interface GrowthLead {
    id: string;
    platform: GrowthPlatform;
    sourceType: string;
    sourceTaskId?: string;
    sourceRunId?: string;
    crmCustomerId?: string;
    nickname: string;
    profileUrl?: string;
    sourceText: string;
    sourceUrl?: string;
    matchedKeywords: string[];
    score: number;
    scoreReasons: string[];
    status: GrowthLeadStatus;
    nextFollowUpAt?: string;
    notes?: GrowthLeadNote[];
    evidenceUrls: string[];
    latestReply?: string;
    createdAt: string;
    updatedAt: string;
}

export interface GrowthLeadNote {
    id: string;
    text: string;
    type: "follow-up" | "status-change" | "merge" | "general";
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
    configId: string;
    mode: GrowthAcquisitionMode;
    platform: GrowthPlatform;
    status: "queued" | "running" | "success" | "partial" | "failed" | "skipped";
    failureReason?: string;
    message: string;
    /** P1-2：失败回退追踪（RPA 失败→回退本地适配器时如实标注来源） */
    fallback?: {
      attempted: boolean;
      source: "rpa" | "legacy-adapter" | "manual-import" | "none";
      rpaExecutionId: string | null;
      reasonCode: string | null;
      fallbackAllowed: boolean;
      message: string;
    };
    candidateCount: number;
    selectedCount: number;
    contactedCount: number;
    crmCapturedCount: number;
    evidenceUrls: string[];
    leadIds: string[];
    startedAt: string;
    endedAt?: string;
}

export interface GrowthAccountHealth {
    id: string;
    platform: GrowthPlatform;
    accountId: string;
    accountName: string;
    loginStatus: "unknown" | "online" | "expired" | "verification-required";
    todayActionCount: number;
    failureRate: number;
    riskStatus: "normal" | "cooldown" | "paused" | "needs-human";
    cooldownUntil?: string;
    recommendation: string;
    lastCheckedAt: string;
}

export interface GrowthAcquisitionPreflight {
    allowed: boolean;
    summary: string;
    config: GrowthAcquisitionConfig;
    account?: GrowthAccountHealth;
    planItem?: GrowthSchedulePlan["items"][number];
    remainingToday: number;
    checks: string[];
    warnings: string[];
    blockers: string[];
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
        status: "ready" | "waiting-confirmation" | "waiting-time" | "blocked" | "exhausted" | "disabled";
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
    mode: "live-execution" | "safety-review";
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
    status: "ready" | "blocked";
    summary: string;
    runtime: {
        executionEnabled: boolean;
        schedulerDaemonEnabled: boolean;
        schedulerDaemonArmed: boolean;
        mode: GrowthRuntimeStatus["mode"];
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
    status: "changed" | "blocked" | "noop";
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

export interface GrowthCommercialAuditEvent {
    id: string;
    action?: string;
    title?: string;
    status?: string;
    result?: string;
    detail?: string;
    operator?: string;
    evidenceUrls?: string[];
    createdAt: string;
}

export interface GrowthWorkflow {
    id: string;
    name: string;
    template: string;
    industry?: string;
    scenario?: string;
    status: "draft" | "enabled" | "running" | "paused" | "completed" | "failed";
    steps: Array<{
        id: string;
        name: string;
        type: string;
        riskMode: GrowthRiskMode;
        status: "pending" | "running" | "completed" | "failed" | "waiting-confirmation";
        description?: string;
        linkedResourceId?: string;
        startedAt?: string;
        completedAt?: string;
        outputSummary?: string;
        nodeType?: string;
        dependencies?: string[];
        config?: unknown;
    }>;
    currentStepId?: string;
    lastAction?: string;
    lastActionAt?: string;
    createdAt: string;
    updatedAt: string;
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

/** 首页聚合接口 range 参数，缺省 today。 */
export type GrowthHomeRange = "today" | "30d";

export interface GrowthHomeStats {
    /** 今日新线索数 */
    newLeads: number | null;
    /** 高意向线索数 */
    highIntentLeads: number | null;
    /** 待触达：无成功互动事件且状态为 new/qualified 的线索数 */
    pendingContact: number | null;
    /** 今日进 CRM 数 */
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
    /** 具体任务、账号或运行时阻断原因；旧后端缺失时允许为空。 */
    detail?: string;
    action: string;
}

export interface GrowthHomeNextAction {
    code: string;
    label: string;
    href: string;
}

export interface GrowthHomeTrendSeries {
    date: string;
    value: number;
}

export interface GrowthHomeTrends {
    newLeads: GrowthHomeTrendSeries[];
    highIntent: GrowthHomeTrendSeries[];
    crmCaptured: GrowthHomeTrendSeries[];
}

export interface GrowthHomeResponse {
    /** ISO 8601，前端显示数据时间 */
    generatedAt: string;
    stats: GrowthHomeStats;
    funnel: GrowthHomeFunnel;
    blockers: GrowthHomeBlocker[];
    recentRuns: GrowthAcquisitionRun[];
    nextActions: GrowthHomeNextAction[];
    trends?: GrowthHomeTrends | null;
}

export interface GrowthReports {
    overview: GrowthOverview;
    funnel: GrowthOverview["funnel"];
    copywriting: Array<{
        text: string;
        usageCount: number;
        averageLeadScore: number;
        contactRate: number;
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
        level: "info" | "warning" | "danger";
        title: string;
        detail: string;
        action: string;
    }>;
    leadStatusDistribution: Array<{
        status: GrowthLeadStatus;
        count: number;
    }>;
    sixStage: {
        content: number;
        publish: number;
        interaction: number;
        lead: number;
        customer: number;
        opportunity: number;
        wonAmountCents: number;
        contentConversionRate: number;
        attributedLeadCount: number;
        attributedCustomerCount: number;
        attributionConfidence: "high" | "medium" | "low";
        /** 2026-09-01（审计 #12）：计算失败原因上屏 */
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
    };
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

export interface GrowthReportQuery {
    startDate?: string;
    endDate?: string;
    platform?: string;
    configId?: string;
}

export const growthApi = {
    /**
 * 今日增长首页聚合接口（T04 接入 GET /growth/home）。
 * range 缺省 today；30d 时追加查询参数，与后端 GrowthHomeResponse 契约一致。
 */
getGrowthHome: (range: GrowthHomeRange = "today"): Promise<GrowthHomeResponse> =>
  api.get<GrowthHomeResponse>(`/growth/home${range === "30d" ? "?range=30d" : ""}`),
overview: () => api.get<GrowthOverview>("/growth/overview"),
    runtimeStatus: () => api.get<GrowthRuntimeStatus>("/growth/runtime-status"),
    commercialReadiness: () => api.get<GrowthCommercialReadiness>("/growth/commercial-readiness"),
    commercialAudits: () =>
        api.get<GrowthCommercialAuditEvent[]>("/growth/commercial-readiness/audits"),
    remediateCommercialReadiness: (riskConfirmation: AutoUploadRiskConfirmationInput) =>
        api.post<GrowthCommercialReadinessRemediation>("/growth/commercial-readiness/remediate", {
            riskConfirmation,
        }),
    reports: (params: GrowthReportQuery = {}) => {
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value && value !== "all") search.set(key, value);
        });
        return api.get<GrowthReports>(`/growth/reports${search.toString() ? `?${search}` : ""}`);
    },
    listStrategies: () => api.get<GrowthStrategyTemplate[]>("/growth/strategies"),
    createStrategy: (body: Partial<GrowthStrategyTemplate>) =>
        api.post<GrowthStrategyTemplate>("/growth/strategies", body),
    updateStrategy: (id: string, body: Partial<GrowthStrategyTemplate>) =>
        api.patch<GrowthStrategyTemplate>(`/growth/strategies/${id}`, body),
    deleteStrategy: (id: string) => api.delete<{ ok: boolean }>(`/growth/strategies/${id}`),
    generateStrategy: (body: { industry?: string; scenario?: string }) =>
        api.post<GrowthStrategyTemplate>("/growth/strategies/generate", body),
    applyStrategy: (id: string, body: { mode?: GrowthAcquisitionMode; platform?: GrowthPlatform; taskName?: string } = {}) =>
        api.post<{ strategy: GrowthStrategyTemplate; config: GrowthAcquisitionConfig; message: string }>(
            `/growth/strategies/${id}/apply`,
            body,
        ),
    listConfigs: (mode?: GrowthAcquisitionMode) =>
        api.get<GrowthAcquisitionConfig[]>(`/growth/acquisition/configs${mode ? `?mode=${mode}` : ""}`),
    createConfig: (body: Partial<GrowthAcquisitionConfig> & { riskConfirmation?: AutoUploadRiskConfirmationInput }) =>
        api.post<GrowthAcquisitionConfig>("/growth/acquisition/configs", body),
    updateConfig: (id: string, body: Partial<GrowthAcquisitionConfig> & { riskConfirmation?: AutoUploadRiskConfirmationInput }) =>
        api.patch<GrowthAcquisitionConfig>(`/growth/acquisition/configs/${id}`, body),
    deleteConfig: (id: string) => api.delete<{ ok: boolean }>(`/growth/acquisition/configs/${id}`),
    setConfigStatus: (
        id: string,
        enabled: boolean,
        riskConfirmation?: AutoUploadRiskConfirmationInput,
    ) =>
        api.post<GrowthAcquisitionConfig>(`/growth/acquisition/configs/${id}/status`, {
            enabled,
            riskConfirmation,
        }),
    preflightConfig: (id: string) =>
        api.get<GrowthAcquisitionPreflight>(`/growth/acquisition/configs/${id}/preflight`),
    executeConfig: (id: string, riskConfirmation?: AutoUploadRiskConfirmationInput) =>
        api.post<{ config: GrowthAcquisitionConfig; run: GrowthAcquisitionRun; leads: GrowthLead[] }>(
            `/growth/acquisition/configs/${id}/execute`,
            { riskConfirmation },
        ),
    schedulePlan: () => api.get<GrowthSchedulePlan>("/growth/acquisition/schedule-plan"),
    runSchedule: (limit = 5, riskConfirmation?: AutoUploadRiskConfirmationInput) =>
        api.post<{
            plan: GrowthSchedulePlan;
            executedCount: number;
            results: Array<{ config: GrowthAcquisitionConfig; run: GrowthAcquisitionRun; leads: GrowthLead[] }>;
            message: string;
        }>("/growth/acquisition/schedule/run", { limit, riskConfirmation }),
    listRuns: (configId?: string) =>
        api.get<GrowthAcquisitionRun[]>(`/growth/acquisition/runs${configId ? `?configId=${configId}` : ""}`),
    fetchRunLive: (configId: string, after = 0) =>
        api.get<GrowthRunLiveResponse>(`/growth/acquisition/runs/live/${configId}?after=${after}`),
    listLeads: (params: { q?: string; status?: string; platform?: string } = {}) => {
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value) search.set(key, value);
        });
        return api.get<GrowthLead[]>(`/growth/leads${search.toString() ? `?${search}` : ""}`);
    },
    createLead: (body: Partial<GrowthLead>) => api.post<GrowthLead>("/growth/leads", body),
    updateLead: (id: string, body: Partial<GrowthLead>) => api.patch<GrowthLead>(`/growth/leads/${id}`, body),
    deleteLead: (id: string) => api.delete<{ ok: boolean }>(`/growth/leads/${id}`),
    syncLeadToCrm: (id: string) =>
        api.post<{ ok: boolean; enabled: boolean; lead: GrowthLead; customerId?: string | null; message: string }>(
            `/growth/leads/${id}/sync-crm`,
        ),
    dedupePreview: (body: Partial<GrowthLead> & { leadId?: string }) =>
        api.post<{ duplicate: boolean; matches: GrowthLeadDedupeMatch[] }>("/growth/leads/dedupe-preview", body),
    mergeLeads: (body: { primaryId: string; duplicateIds: string[] }) =>
        api.post<{ ok: boolean; lead: GrowthLead; mergedCount: number }>("/growth/leads/merge", body),
    // Sprint 4 前端收尾：评分历史 + 归因链 + T4-6 重评
    getLeadScoreHistory: (id: string) =>
        api.get<LeadScoreHistoryDto>(`/growth/leads/${id}/score-history`),
    rescoreLead: (id: string) =>
        api.post<{
            available: boolean;
            snapshotId?: string;
            totalScore?: number;
            components?: Record<string, number>;
            scoredAt?: string;
            message?: string;
        }>(`/growth/leads/${id}/rescore`),
    getLeadAttribution: (id: string) =>
        api.get<LeadAttributionDto>(`/growth/leads/${id}/attribution`),
    listAccountHealth: () => api.get<GrowthAccountHealth[]>("/growth/account-health"),
    checkAccountHealth: (platform: GrowthPlatform, accountId: string) =>
        api.post<GrowthAccountHealth>(`/growth/account-health/${platform}/${accountId}/check`),
    cooldownAccount: (platform: GrowthPlatform, accountId: string, minutes = 60) =>
        api.post<GrowthAccountHealth>(`/growth/account-health/${platform}/${accountId}/cooldown`, { minutes }),
    releaseAccountCooldown: (platform: GrowthPlatform, accountId: string) =>
        api.post<GrowthAccountHealth>(`/growth/account-health/${platform}/${accountId}/release-cooldown`),
    listWorkflows: () => api.get<GrowthWorkflow[]>("/growth/workflows"),
    createWorkflow: (body: Partial<GrowthWorkflow>) => api.post<GrowthWorkflow>("/growth/workflows", body),
    /** 行业方案库：14 行业 × 场景 Playbook 清单 */
    listWorkflowPlaybooks: () =>
        api.get<Array<{
            industry: string;
            scenarios: Array<{
                key: string;
                name: string;
                description: string;
                platforms: string[];
                stepCount: number;
                riskNotes: string[];
            }>;
            keywords: {
                industry: string;
                aliases: string[];
                sourceKeywords: string[];
                demandKeywords: string[];
                excludeKeywords: string[];
                /** 意向词同义词簇（行业预设返回，供词库调优展示） */
                demandSynonymGroups?: string[][] | null;
                /** 本地行业标记（到店/上门，可叠加地域词搜索） */
                isLocal?: boolean | null;
            } | null;
        }>>("/growth/workflow-playbooks"),
    updateWorkflow: (
        id: string,
        body: Partial<GrowthWorkflow> & { stepId?: string; stepDescription?: string; stepOutputSummary?: string },
    ) => api.patch<GrowthWorkflow>(`/growth/workflows/${id}`, body),
    deleteWorkflow: (id: string) => api.delete<{ ok: boolean }>(`/growth/workflows/${id}`),
    workflowAction: (
        id: string,
        action: "start" | "pause" | "resume" | "stop" | "enable" | "advance" | "complete-step" | "fail" | "reset" | "confirm-step",
        body: { stepId?: string; outputSummary?: string } = {},
    ) => api.post<GrowthWorkflow>(`/growth/workflows/${id}/${action}`, body),
};

// —— Sprint 4 前端收尾：线索评分历史 + 归因链（T2.6/T4.3 展示）——

export interface LeadScoreSnapshotDto {
  id: string;
  scoredAt: string;
  totalScore: number;
  fitScore: number;
  intentScore: number;
  identityConfidence: number;
  riskScore: number;
  confidence: number;
  components: Record<string, number>;
  reasons: string[];
  evidenceIds: string[];
  modelVersion: string;
  ruleVersion: string;
}

export interface LeadScoreHistoryDto {
  available: boolean;
  leadId?: string;
  /** 四维质量分（最新快照的 totalScore） */
  totalScore?: number;
  /** 采集时的裸分/印象分（lead.score，与四维质量分并存） */
  roughScore?: number;
  snapshots: LeadScoreSnapshotDto[];
  message?: string;
}

export interface LeadAttributionDto {
  layer: "confirmed" | "rule_matched" | "inferred" | "unknown";
  hops: Array<{
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    model: string;
    label: string | null;
  }>;
  lead: {
    sourceArticleId: string | null;
    sourcePublishRecordId: string | null;
    sourceInteractionEventId: string | null;
    sourceUrl: string | null;
  };
}

/** 曝光/纳管账号（RPA 账号选择器数据源） */
export interface ExposureAccount {
  id: string;
  userId: string;
  platform: string;
  accountId: string;
  name: string;
  note?: string | null;
  status?: string | null;
  createdAt: string;
}

/** 已授权账号列表（账号选择器：不允许随意输入任意账号 ID 执行） */
export async function fetchExposureAccounts(): Promise<ExposureAccount[]> {
  return api.get<ExposureAccount[]>("/growth/exposure-accounts");
}
