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
  type: number;
  platform: string;
  filePath: string;
  userName: string;
  profileName?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  status: number;
  statusLabel: string;
  avatarUpdatedAt?: string | null;
}

export interface AutoUploadCdpBrowserSession {
  accountId?: string | number | null;
  platform?: string | null;
  status?: string | null;
  lastError?: string | null;
  currentUrl?: string | null;
  debuggingPort?: number | null;
  profileDir?: string | null;
  startedAt?: string | null;
}

export interface AutoUploadCdpSessionsResult {
  available: boolean;
  sessions: AutoUploadCdpBrowserSession[];
  message?: string | null;
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

export interface AutoUploadPublishPayload {
  type: number;
  accountIds?: number[];
  contentKind?: "article" | "video";
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
    | "bili_partition_missing";
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
): AutoUploadRiskConfirmationInput {
  return {
    confirmed: true,
    confirmedAction: action,
    confirmedRiskLevel: level,
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
  riskAudit?: AutoUploadRiskAuditEvent;
  platforms?: Array<{
    platform: string;
    accountId: string;
    status:
      | "success"
      | "failed"
      | "account_expired"
      | "material_error"
      | "login_required"
      | "pending_manual"
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

  openAccounts(ids: number[]) {
    return api.post<{ opened: number }>("/auto-upload/accounts/open", { ids });
  },

  prepareAccountRelogin(id: number) {
    return api.post<AutoUploadAccountReloginRecovery>(
      `/auto-upload/accounts/${id}/relogin`,
      {},
    );
  },

  recoverBlockedTasks(
    accountId?: number,
    riskConfirmation?: AutoUploadRiskConfirmationInput,
  ) {
    return api.post<AutoUploadResumeBlockedTasksResult>(
      "/auto-upload/accounts/recover-blocked-tasks",
      { ...(accountId ? { accountId } : {}), riskConfirmation },
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
  ) {
    return api.delete<{ riskAudit?: AutoUploadRiskAuditEvent }>(
      `/auto-upload/accounts/${id}`,
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

  retryTask(id: number, riskConfirmation?: AutoUploadRiskConfirmationInput) {
    return api.post<AutoUploadRetryTaskResult>(
      `/auto-upload/tasks/${id}/retry`,
      {
        riskConfirmation,
      },
    );
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
    riskConfirmation?: AutoUploadRiskConfirmationInput,
  ) {
    return api.post<AutoUploadPublishResult | null>("/auto-upload/publish", {
      payloads,
      riskConfirmation,
    });
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
