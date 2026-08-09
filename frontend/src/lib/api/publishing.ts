import { api } from "./client";

export interface PublishAccountConfig {
  apiUrl?: string;
  openComment?: number;
  onlyFansCanComment?: number;
  categoryId?: string | number;
  defaultThumbMediaId?: string;
  baseUrl?: string;
  tags?: string | string[];
  visibility?: "private";
  source?: string;
  engineAccountId?: number | string;
  platformType?: number | string;
  filePath?: string;
  userName?: string;
  profileName?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  status?: string;
  statusLabel?: string;
  sessionStatus?: "logged_in" | "needs_login" | "error" | "unknown" | string;
  lastDispatchAt?: string | null;
  lastDispatchOk?: boolean | null;
  lastDispatchReason?: string | null;
  checkedAt?: string | null;
  avatarUpdatedAt?: string | null;
  syncedAt?: string;
}

export interface PublishAccount {
  id: string;
  platform: string;
  name: string;
  appId?: string;
  apiToken?: string;
  hasApiToken?: boolean;
  config?: PublishAccountConfig;
  source?: string;
  engineAccountId?: number | string;
  filePath?: string;
  status?: string;
  statusLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishRecord {
  id: string;
  durableRecordId?: string | null;
  articleId: string;
  accountId: string;
  platform: string;
  status: string;
  publishUrl?: string | null;
  errorMessage?: string | null;
  bodySnapshot?: string | null;
  sourceIdentity?: Record<string, unknown> | null;
  payloadJson?: Record<string, unknown> | null;
  resultJson?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  account?: PublishAccount;
}

export interface JpagePreviewFile {
  id: string;
  name: string;
  fileType: string;
  size: number;
  isPublic: false;
  sha256: string;
  authenticatedRenderUrl: string;
  tags: string[];
}

export interface JpagePreviewReceipt {
  version: 1;
  status: "content_verified" | "verified";
  articleId: string;
  accountId: string;
  revision: string;
  baseUrl: string;
  visibility: "private";
  tags: string[];
  assetGate: "pass";
  integratedRenderGate: "pass";
  contentReadbackGate: "pass";
  remoteRenderGate: "pending" | "pass";
  markdown: JpagePreviewFile;
  html: JpagePreviewFile;
  uploadedAt: string;
  remoteRenderVerifiedAt?: string;
}

export const publishingApi = {
  getAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: number[];
    source?: "api" | "local-engine";
    platform?: string;
  }) {
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
    if (options?.source) {
      params.set("source", options.source);
    }
    if (options?.platform) {
      params.set("platform", options.platform);
    }

    return api.get<PublishAccount[]>(
      `/publishing/accounts${params.size ? `?${params.toString()}` : ""}`,
    );
  },

  createAccount(data: Partial<PublishAccount>) {
    return api.post<PublishAccount>("/publishing/accounts", data);
  },

  updateAccount(id: string, data: Partial<PublishAccount>) {
    return api.put<PublishAccount>(`/publishing/accounts/${id}`, data);
  },

  createAccountDeleteConfirmation(id: string) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>(`/publishing/accounts/${encodeURIComponent(id)}/delete/confirmations`);
  },

  deleteAccount(id: string, confirmationId: string) {
    return api.delete(`/publishing/accounts/${encodeURIComponent(id)}`, {
      confirmationId,
    });
  },

  createPublishConfirmation(
    articleId: string,
    accountId: string,
    sourceUrl?: string,
  ) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>("/publishing/publish/confirmations", {
      articleId,
      accountId,
      sourceUrl,
    });
  },

  publishArticle(
    articleId: string,
    accountId: string,
    confirmationId: string,
    sourceUrl?: string,
  ) {
    return api.post<{
      success: boolean;
      status: "completed" | "waiting";
      articleId: string;
      publishRecordId: string;
      durableRecordId: string;
    }>("/publishing/publish", {
      articleId,
      accountId,
      confirmationId,
      sourceUrl,
    });
  },

  getRecords(articleId: string) {
    return api.get<PublishRecord[]>(
      `/publishing/records/${encodeURIComponent(articleId)}`,
    );
  },

  getJpagePreview(articleId: string) {
    return api.get<{
      required: boolean;
      ready: boolean;
      currentRevision: string;
      receipt: JpagePreviewReceipt | null;
    }>(`/publishing/wechat/previews/${encodeURIComponent(articleId)}`);
  },

  createJpagePreviewConfirmation(articleId: string, jpageAccountId: string) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>("/publishing/wechat/previews/confirmations", {
      articleId,
      jpageAccountId,
    });
  },

  createJpagePreview(
    articleId: string,
    jpageAccountId: string,
    confirmationId: string,
  ) {
    return api.post<{
      ready: boolean;
      receipt: JpagePreviewReceipt;
    }>("/publishing/wechat/previews", {
      articleId,
      jpageAccountId,
      confirmationId,
    });
  },

  createJpageRemoteRenderConfirmation(articleId: string) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>(
      `/publishing/wechat/previews/${encodeURIComponent(articleId)}/render/confirmations`,
    );
  },

  confirmJpageRemoteRender(articleId: string, confirmationId: string) {
    return api.post<{
      ready: true;
      receipt: JpagePreviewReceipt;
    }>(
      `/publishing/wechat/previews/${encodeURIComponent(articleId)}/render/confirm`,
      { confirmationId },
    );
  },

  createWechatDraftConfirmation(
    articleId: string,
    accountId: string,
    sourceUrl?: string,
  ) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>("/publishing/wechat/drafts/confirmations", {
      articleId,
      accountId,
      sourceUrl,
    });
  },

  createWechatDraft(
    articleId: string,
    accountId: string,
    confirmationId: string,
    sourceUrl?: string,
  ) {
    return api.post<{
      publishRecordId: string;
      mediaId: string;
      readback: {
        matched: boolean;
        expectedTitle: string;
        actualTitle?: string;
        contentMatched?: boolean;
        failureReason?: string;
      };
    }>("/publishing/wechat/drafts", {
      articleId,
      accountId,
      confirmationId,
      sourceUrl,
    });
  },

  createWechatDraftReadbackConfirmation(recordId: string) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>(
      `/publishing/wechat/drafts/${encodeURIComponent(recordId)}/readback/confirmations`,
    );
  },

  reconcileWechatDraft(recordId: string, confirmationId: string) {
    return api.post<{
      publishRecordId: string;
      mediaId: string;
      status: "draft_saved" | "readback_pending";
      readback: {
        matched: boolean;
        expectedTitle: string;
        actualTitle?: string;
        contentMatched?: boolean;
        failureReason?: string;
      };
    }>(
      `/publishing/wechat/drafts/${encodeURIComponent(recordId)}/readback/reconcile`,
      { confirmationId },
    );
  },

  createWechatPublishConfirmation(
    articleId: string,
    accountId: string,
    mediaId: string,
  ) {
    return api.post<{
      confirmationId: string;
      expiresAt: string;
      singleUse: boolean;
    }>("/publishing/wechat/publish/confirmations", {
      articleId,
      accountId,
      mediaId,
    });
  },

  submitWechatPublish(
    articleId: string,
    accountId: string,
    mediaId: string,
    confirmationId: string,
  ) {
    return api.post<{
      publishRecordId: string;
      publishId: string;
      status: string;
      articleId?: string;
      articleUrl?: string;
    }>("/publishing/wechat/publish", {
      articleId,
      accountId,
      mediaId,
      confirmationId,
    });
  },

  refreshWechatPublish(recordId: string) {
    return api.post<{
      publishId: string;
      status: string;
      articleId?: string;
      articleUrl?: string;
      failureReason?: string;
    }>(`/publishing/wechat/publish/${encodeURIComponent(recordId)}/refresh`);
  },
};
