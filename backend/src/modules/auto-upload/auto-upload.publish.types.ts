// 发布负载与结果类型（独立文件，避免 local-bridge ↔ auto-upload 类型依赖成环）

export type AutoUploadPublishSourceIdentity = {
  sourceType: 'article';
  sourceId: string;
  title: string;
  contentType: string;
  contentFormat: string;
  updatedAt: string;
};

export type AutoUploadPublishAccountIdentity = {
  id: string;
  name: string;
  platform: string;
  status: string;
};

export type AutoUploadPublishPayload = {
  type: number;
  accountIds?: number[];
  contentKind?: 'article' | 'video';
  articleId?: string;
  body?: string;
  sourceIdentity?: AutoUploadPublishSourceIdentity;
  accountIdentity?: AutoUploadPublishAccountIdentity;
  title: string;
  tags: string[];
  fileList: string[];
  accountList: string[];
  enableTimer?: 0 | 1;
  videosPerDay?: number;
  dailyTimes?: string[];
  startDays?: number;
  timeJitterMinutes?: number;
  scheduleTime?: string;
  debugDryRun?: boolean;
  debugDryRunHoldBrowser?: boolean;
  skipAccountCheck?: boolean;
  category?: number;
  coverPath?: string;
  coverPaths?: Record<string, string>;
  biliTitle?: string;
  biliType?: string;
  biliPartition?: string;
  biliDesc?: string;
};

export type AutoUploadPublishPlatformEntry = {
  platform: string;
  accountId: string;
  accountName?: string;
  accountStatus?: string;
  articleId?: string;
  status:
    | 'success'
    | 'failed'
    | 'account_expired'
    | 'material_error'
    | 'login_required'
    | 'pending_manual'
    | 'blocked'
    | 'not_integrated'
    | 'skipped';
  failureReason?: string;
  nextAction?: string;
  publishTaskId?: string;
  publishUrl?: string;
  externalId?: string;
  evidence?: unknown;
};

export type AutoUploadPublishBatchResult = {
  agentSessionId?: string;
  platforms: AutoUploadPublishPlatformEntry[];
  summary: {
    total: number;
    success: number;
    failed: number;
    accountExpired: number;
    materialError: number;
    loginRequired: number;
    pendingManual: number;
    blocked: number;
    notIntegrated: number;
  };
};
