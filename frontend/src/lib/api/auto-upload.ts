import { api, getApiBase } from "./client";

export interface AutoUploadEngineHealth {
  online: boolean;
  status: string;
  service: string;
  version: string;
  engineUrl: string;
  baseDir?: string;
  frontendDist?: string;
  database?: {
    path: string;
    exists: boolean;
  };
  folders?: Record<string, { path: string; exists: boolean }>;
  checkedAt: string;
}

export interface AutoUploadAccount {
  id: number;
  stableId?: string;
  accountName?: string;
  type: number;
  platform: string;
  platformKey?: string;
  filePath: string;
  userName: string;
  profileName?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  status: number;
  statusCode?: string;
  statusLabel: string;
  avatarUpdatedAt?: string | null;
  // 2026-06-04: 真实 session 状态 (从 runtime_executions 反推)
  sessionStatus?: "logged_in" | "needs_login" | "error" | "unknown";
  lastDispatchAt?: string | null;
  lastDispatchOk?: boolean | null;
  lastDispatchReason?: string | null;
}

export interface AutoUploadPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AutoUploadCdpBrowserSession {
  accountId?: string | number | null;
  platform?: string | null;
  status?: string | null;
  lastError?: string | null;
  currentUrl?: string | null;
  debuggingPort?: number | null;
  profileDir?: string | null;
  visibleWindow?: boolean | null;
  activeProfile?: boolean | null;
  browser?: string | null;
  runtimeMode?: string | null;
  browserReused?: boolean | null;
  startedAt?: string | null;
}

export interface AutoUploadCdpSessionsResult {
  available: boolean;
  sessions: AutoUploadCdpBrowserSession[];
  message?: string | null;
  checkedAt?: string | null;
}

export interface AutoUploadOpenAccountsResult {
  opened: number;
  openedIds?: Array<number | string>;
  openedAccounts?: Array<{
    id: number | string;
    platform: string;
    accountId: number | string;
    status?: string | null;
    currentUrl?: string | null;
    lastError?: string | null;
  }>;
  skipped?: Array<{ id: number | string; reason: string }>;
}

export interface AutoUploadInteractionEvidence {
  type: "snapshot" | "screenshot" | "text";
  label: string;
  value: string;
  path?: string;
  url?: string;
  artifactUrl?: string;
}

export interface AutoUploadInteractionEntryResult {
  accountId: number;
  accountName: string;
  platformType: number;
  platformName: string;
  entryType: string;
  entryName: string;
  url: string;
  title?: string | null;
  loggedIn?: boolean | null;
  pageTextSample?: string | null;
  evidence?: AutoUploadInteractionEvidence | null;
  runtimeMode?: string | null;
  profileDir?: string | null;
  cdpPort?: number | null;
  browser?: string | null;
  browserReused?: boolean | null;
  status: string;
  accountStatus?: number;
  openedAt?: string | null;
}

export interface AutoUploadMaterial {
  id: number;
  filename: string;
  filesizeMb: number | null;
  uploadTime: string | null;
  filePath: string | null;
}

export interface AutoUploadLogFile {
  key: string;
  platform: string;
  filename: string;
  path: string;
  size: number;
  updatedAt: string;
  lines: string[];
}

export interface AutoUploadPublishTask {
  id: number;
  title: string;
  platform_type: number;
  platform: string;
  account_file: string;
  file_list: string[] | null;
  tags: string[] | null;
  dry_run: boolean;
  status: string;
  message: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/** 发布日历：单条任务（按天分组展示） */
export interface AutoUploadCalendarTask {
  id: number;
  title: string;
  platform: string;
  /** 后端 decode 归一化后的状态：waiting/claimed/completed/failed/cancelled */
  status: string;
  time: string;
  isRescheduled: boolean;
}

/** 发布日历：一天的分组 */
export interface AutoUploadCalendarDay {
  date: string;
  items: AutoUploadCalendarTask[];
}

export interface AutoUploadPublishPayload {
  type: number;
  accountIds?: number[];
  contentKind?: "article" | "video";
  articleId?: string;
  body?: string;
  sourceIdentity?: {
    sourceType: "article";
    sourceId: string;
    title: string;
    contentType: string;
    contentFormat: string;
    updatedAt: string;
  };
  accountIdentity?: {
    id: string;
    name: string;
    platform: string;
    status: string;
  };
  title: string;
  tags: string[];
  fileList: string[];
  accountList: string[];
  enableTimer: 0 | 1;
  videosPerDay: number;
  dailyTimes: string[];
  startDays: number;
  timeJitterMinutes: number;
  scheduleTime?: string;
  debugDryRun: boolean;
  debugDryRunHoldBrowser: boolean;
  skipAccountCheck?: boolean;
  category: number;
  coverPath?: string;
  coverPaths?: Record<string, string>;
  biliDesc?: string;
  biliTitle?: string;
  biliType?: string;
  biliPartition?: string;
}

export interface AutoUploadPublishPreflightIssue {
  code:
    | "engine_unavailable"
    | "payload_empty"
    | "account_missing"
    | "account_expired"
    | "content_kind_missing"
    | "material_missing"
    | "material_unreadable"
    | "material_type_mismatch"
    | "cover_missing"
    | "cover_unreadable"
    | "cover_type_mismatch"
    | "video_parameter_missing"
    | "schedule_invalid"
    | "title_missing"
    | "article_identity_missing"
    | "article_body_missing"
    | "article_missing"
    | "article_changed"
    | "bili_partition_missing"
    | "platform_not_supported";
  scope: "engine" | "payload" | "account" | "material" | "cover";
  message: string;
  nextAction: string;
  platform?: string;
  account?: string;
  stage: string;
  payloadIndex?: number;
  platformType?: number;
  accountFile?: string;
  filePath?: string;
  field?: string;
  expected?: string;
  actual?: string;
}

export interface AutoUploadPublishPreflightResult {
  ok: boolean;
  checkedAt: string;
  summary: string;
  payloadCount: number;
  accountCount: number;
  materialCount: number;
  issues: AutoUploadPublishPreflightIssue[];
}

export type AutoUploadRiskAction =
  | "publish"
  | "retry-publish"
  | "resume-blocked-publish"
  | "batch-touch"
  | "schedule-enable"
  | "local-file-delete"
  | "platform-account-delete"
  | "runtime-control"
  | "remote-control"
  | "agent-confirmation-approve"
  | "interaction-approval";

export type AutoUploadRiskLevel = "low" | "medium" | "high";

export interface AutoUploadRiskConfirmationInput {
  confirmed: boolean;
  confirmedAction: AutoUploadRiskAction;
  confirmedRiskLevel: AutoUploadRiskLevel;
  confirmationId?: string;
  operator?: string;
  reason?: string;
  note?: string;
  checklist?: Record<string, boolean>;
  fullPermission?: boolean;
}

export function buildRiskConfirmation(
  action: AutoUploadRiskAction,
  level: AutoUploadRiskLevel = "high",
  confirmationId?: string,
): AutoUploadRiskConfirmationInput {
  return {
    confirmed: true,
    confirmedAction: action,
    confirmedRiskLevel: level,
    ...(confirmationId ? { confirmationId } : {}),
  };
}

export interface AutoUploadRiskAuditEvent {
  id: string;
  account: {
    id?: string;
    name: string;
  };
  device: {
    id: string;
    name: string;
    ip?: string;
    userAgent?: string;
  };
  action: AutoUploadRiskAction;
  target?: string;
  riskLevel: AutoUploadRiskLevel;
  status: "allowed" | "approval_required" | "blocked";
  reason: string;
  confirmationRecord?: {
    confirmed: boolean;
    confirmationId?: string;
    operator: string;
    reason?: string;
    confirmedAt: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
  };
  forbiddenActionHits: string[];
  createdAt: string;
}

export interface AutoUploadPublishResult {
  reason?: string;
  taskIds?: number[];
  agentSessionId?: string;
  riskAudit?: AutoUploadRiskAuditEvent;
  platforms?: Array<{
    platform: string;
    accountId: string;
    accountName?: string;
    accountStatus?: string;
    articleId?: string;
    status:
      | "success"
      | "failed"
      | "account_expired"
      | "material_error"
      | "login_required"
      | "pending_manual"
      | "blocked"
      | "not_integrated"
      | "skipped";
    failureReason?: string;
    nextAction?: string;
    publishTaskId?: string;
    publishUrl?: string;
    externalId?: string;
    evidence?: unknown;
  }>;
  summary?: {
    total: number;
    success: number;
    failed: number;
    accountExpired: number;
    materialError: number;
    loginRequired: number;
    pendingManual?: number;
    blocked?: number;
    notIntegrated?: number;
  };
  results?: Array<{
    type: number;
    ok?: boolean | null;
    message?: string;
    platform?: string;
    account?: string;
    publishUrl?: string;
    externalId?: string;
    articleId?: string;
    postId?: string;
    platformUrl?: string;
    notIntegrated?: boolean;
    evidence?: unknown;
  }>;
}

export interface AutoUploadRetryTaskResult {
  retriedFrom: number;
  task: AutoUploadPublishTask;
  payloadSource?: "recorded" | "reconstructed";
  restoredFields?: string[];
  missingFields?: string[];
  riskAudit?: AutoUploadRiskAuditEvent;
  result: AutoUploadPublishResult | null;
}

export interface AutoUploadAccountHealthIssue {
  accountId?: number;
  accountFile?: string;
  accountName: string;
  platformType?: number;
  platform: string;
  status: "expired" | "missing";
  message: string;
  nextAction: string;
}

export interface AutoUploadAccountHealth {
  checkedAt: string;
  totalAccounts: number;
  readyAccounts: number;
  expiredAccounts: number;
  issues: AutoUploadAccountHealthIssue[];
  waitingTasks: Array<{
    id: number;
    title: string;
    platform: string;
    accountFile: string;
    status: string;
    message: string | null;
    canResume: boolean;
    nextAction: string;
  }>;
}

export interface AutoUploadAccountReloginRecovery {
  checkedAt: string;
  account: {
    id: number;
    accountName: string;
    platform: string;
    status: "ready" | "expired";
    statusLabel: string;
  };
  opened: number;
  resumeCandidates: AutoUploadAccountHealth["waitingTasks"];
  nextAction: string;
}

export interface AutoUploadResumeBlockedTasksResult {
  checkedAt: string;
  riskAudit?: AutoUploadRiskAuditEvent;
  resumed: number;
  skipped: number;
  results: Array<{
    taskId: number;
    title: string;
    platform: string;
    accountFile: string;
    status: "resumed" | "skipped" | "failed";
    message: string;
    retryResult?: AutoUploadPublishResult | null;
  }>;
}

export interface AutoUploadServerApproval {
  confirmationId: string;
  expiresAt: string;
  singleUse: boolean;
}

export interface AutoUploadArticleMaterialImportResult {
  articleId: string;
  title: string;
  imported: AutoUploadMaterial[];
  failures: Array<{
    index: number;
    message: string;
  }>;
}

export const autoUploadApi = {
  health() {
    return api.get<AutoUploadEngineHealth>("/auto-upload/health");
  },

  accounts(options?: { validate?: boolean; force?: boolean; ids?: number[] }) {
    const params = new URLSearchParams();
    if (options?.validate) {
      params.set("validate", "1");
    }
    if (options?.force) {
      params.set("force", "1");
    }
    if (options?.ids?.length) {
      params.set("ids", options.ids.join(","));
    }

    return api.get<AutoUploadAccount[]>(
      `/auto-upload/accounts${params.size ? `?${params.toString()}` : ""}`,
    );
  },

  accountPage(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    validate?: boolean;
    force?: boolean;
    ids?: number[];
  } = {}) {
    const params = new URLSearchParams({
      page: String(options.page || 1),
      pageSize: String(options.pageSize || 20),
    });
    if (options.search?.trim()) params.set("search", options.search.trim());
    if (options.validate) params.set("validate", "1");
    if (options.force) params.set("force", "1");
    if (options.ids?.length) params.set("ids", options.ids.join(","));
    return api.get<AutoUploadPage<AutoUploadAccount>>(
      `/auto-upload/accounts?${params.toString()}`,
    );
  },

  cdpSessions() {
    return api.get<AutoUploadCdpSessionsResult>("/auto-upload/cdp-sessions");
  },

  accountHealth(options?: { validate?: boolean; force?: boolean }) {
    const params = new URLSearchParams();
    if (options?.validate !== undefined) {
      params.set("validate", options.validate ? "1" : "0");
    }
    if (options?.force) {
      params.set("force", "1");
    }

    return api.get<AutoUploadAccountHealth>(
      `/auto-upload/accounts/health${params.size ? `?${params.toString()}` : ""}`,
    );
  },

  openAccounts(ids: number[], options?: { platform?: string }) {
    return api.post<AutoUploadOpenAccountsResult>(
      "/auto-upload/accounts/open",
      { ids, platform: options?.platform },
    );
  },

  openInteractionEntry(input: { accountId: number; entryType: string }) {
    return api.post<AutoUploadInteractionEntryResult>(
      "/auto-upload/interaction/open-entry",
      input,
    );
  },

  prepareAccountRelogin(id: number, platform?: string) {
    const params = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    return api.post<AutoUploadAccountReloginRecovery>(
      `/auto-upload/accounts/${id}/relogin${params}`,
      {},
    );
  },

  recoverBlockedTasks(
    accountId: number | undefined,
    confirmationId: string,
  ) {
    return api.post<AutoUploadResumeBlockedTasksResult>(
      "/auto-upload/accounts/recover-blocked-tasks",
      { ...(accountId ? { accountId } : {}), confirmationId },
    );
  },

  createRecoverBlockedTasksConfirmation(accountId?: number) {
    return api.post<AutoUploadServerApproval>(
      "/auto-upload/accounts/recover-blocked-tasks/confirmations",
      accountId ? { accountId } : {},
    );
  },

  refreshAccountAvatar(id: number) {
    return api.post<{ avatarPath: string | null; avatarUrl: string | null }>(
      `/auto-upload/accounts/${id}/avatar`,
    );
  },

  deleteAccount(
    id: number,
    riskConfirmation?: AutoUploadRiskConfirmationInput,
    platform?: string,
  ) {
    const params = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    return api.delete<{ riskAudit?: AutoUploadRiskAuditEvent }>(
      `/auto-upload/accounts/${id}${params}`,
      { riskConfirmation },
    );
  },

  loginUrl(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }) {
    const params = new URLSearchParams({
      type: String(input.type),
      profileName: input.profileName,
      requestId: input.requestId,
    });
    if (input.update && input.recordId) {
      params.set("update", "1");
      params.set("recordId", String(input.recordId));
    }

    return `${getApiBase()}/auto-upload/accounts/login?${params.toString()}`;
  },

  cancelLogin(requestId: string) {
    return api.post<{ cancelled: boolean }>(
      "/auto-upload/accounts/login/cancel",
      { requestId },
    );
  },

  materials() {
    return api.get<AutoUploadMaterial[]>("/auto-upload/materials");
  },

  logs(limit = 80) {
    return api.get<AutoUploadLogFile[]>(`/auto-upload/logs?limit=${limit}`);
  },

  tasks(limit = 50) {
    return api.get<AutoUploadPublishTask[]>(
      `/auto-upload/tasks?limit=${limit}`,
    );
  },

  taskPage(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    platform?: string;
  } = {}) {
    const params = new URLSearchParams({
      page: String(options.page || 1),
      pageSize: String(options.pageSize || 20),
    });
    if (options.search?.trim()) params.set("search", options.search.trim());
    if (options.status && options.status !== "all") {
      params.set("status", options.status);
    }
    if (options.platform && options.platform !== "all") {
      params.set("platform", options.platform);
    }
    return api.get<AutoUploadPage<AutoUploadPublishTask>>(
      `/auto-upload/tasks?${params.toString()}`,
    );
  },

  retryTask(id: number, confirmationId: string) {
    return api.post<AutoUploadRetryTaskResult>(
      `/auto-upload/tasks/${id}/retry`,
      {
        confirmationId,
      },
    );
  },

  createRetryTaskConfirmation(id: number) {
    return api.post<AutoUploadServerApproval>(
      `/auto-upload/tasks/${id}/retry/confirmations`,
      {},
    );
  },

  deleteTask(id: number, riskConfirmation?: AutoUploadRiskConfirmationInput) {
    return api.delete<{
      id: number;
      deletedRecordKey?: string;
      message: string;
      riskAudit?: AutoUploadRiskAuditEvent;
    }>(`/auto-upload/tasks/${id}`, { riskConfirmation });
  },

  /** 发布日历：近 N 天任务按天分组（默认 7 天） */
  calendar(days = 7) {
    return api.get<AutoUploadCalendarDay[]>(
      `/auto-upload/calendar?days=${Math.max(1, Math.min(31, days))}`,
    );
  },

  /** 取消排队中的发布任务 */
  cancelTask(id: number) {
    return api.post<{ id: number; status: string; message: string }>(
      `/auto-upload/tasks/${id}/cancel`,
      {},
    );
  },

  /** 改期：设置新的计划发布时间 */
  rescheduleTask(id: number, plannedAt: string) {
    return api.post<{
      id: number;
      status: string;
      plannedAt?: string;
      message: string;
    }>(`/auto-upload/tasks/${id}/reschedule`, { plannedAt });
  },

  uploadMaterial(formData: FormData) {
    return api.upload<{ filename: string; filepath: string }>(
      "/auto-upload/materials",
      formData,
    );
  },

  importArticleMaterials(articleId: string) {
    return api.post<AutoUploadArticleMaterialImportResult>(
      "/auto-upload/materials/import-article",
      { articleId },
    );
  },

  materialPreviewUrl(filename: string) {
    return api.url(
      `/auto-upload/materials/preview?filename=${encodeURIComponent(filename)}`,
    );
  },

  deleteMaterial(
    id: number,
    riskConfirmation?: AutoUploadRiskConfirmationInput,
  ) {
    return api.delete<{
      id: number;
      filename: string;
      riskAudit?: AutoUploadRiskAuditEvent;
    }>(`/auto-upload/materials/${id}`, { riskConfirmation });
  },

  publish(
    payloads: AutoUploadPublishPayload[],
    confirmationId?: string,
  ) {
    return api.post<AutoUploadPublishResult | null>("/auto-upload/publish", {
      payloads,
      confirmationId,
    });
  },

  createPublishConfirmation(payloads: AutoUploadPublishPayload[]) {
    return api.post<AutoUploadServerApproval>(
      "/auto-upload/publish/confirmations",
      { payloads },
    );
  },

  preflight(payloads: AutoUploadPublishPayload[]) {
    return api.post<AutoUploadPublishPreflightResult>(
      "/auto-upload/preflight",
      {
        payloads,
      },
    );
  },
};
