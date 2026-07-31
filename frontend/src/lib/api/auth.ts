import { api, type ApiRequestOptions } from "./client";

const AUTH_REQUEST_TIMEOUT_MS = 10000;

function withAuthTimeout(options?: ApiRequestOptions): ApiRequestOptions {
  return {
    ...options,
    timeoutMs: options?.timeoutMs ?? AUTH_REQUEST_TIMEOUT_MS,
  };
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  name: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  kaypalUserId?: string | null;
  kaypalPlan?: string;
  kaypalPlanExpired?: boolean;
  kaypalRole?: string | null;
  kaypalPlatformRole?: string | null;
  kaypalPermissionNames?: string[];
  hasKaypalDesktopSession?: boolean;
  kaypalDesktopTokenExpiresAt?: string | null;
  kaypalDesktopDeviceId?: string | null;
  kaypalLocalOnly?: boolean;
  role?: string;
  commercialExecutionAllowed?: boolean;
  planMode?: string;
}

export interface SetupStatus {
  hasUsers: boolean;
  totalUsers: number;
}

export interface AuthTenantMembership {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
}

export const authApi = {
  login(username: string, password: string) {
    return api.post<{ user: AuthUser; expiresAt: string }>("/auth/login", {
      username,
      password,
    });
  },

  logout() {
    return api.post<{ success: boolean }>("/auth/logout");
  },

  me(options?: ApiRequestOptions) {
    return api.get<AuthUser>("/auth/me", withAuthTimeout(options));
  },

  tenants() {
    return api.get<AuthTenantMembership[]>("/auth/tenants");
  },

  setupStatus() {
    return api.get<SetupStatus>("/auth/setup-status");
  },

  listUsers() {
    return api.get<AuthUser[]>("/auth/users");
  },

  updateUserRole(
    id: string,
    patch: {
      role?: string;
      planMode?: string;
      commercialExecutionAllowed?: boolean;
    },
  ) {
    return api.patch<AuthUser>(`/auth/users/${id}/role`, patch);
  },
};

export interface KaypalProfile {
  userId: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  subscriptionPlan?: string | null;
  role?: string | null;
  platformRole?: string | null;
  platformRoleId?: string | null;
  platformRoleName?: string | null;
  permissions?: string[] | null;
}

export interface KaypalDevice {
  id: string;
  name: string;
  platform: "mac" | "windows" | "linux" | "web";
  lastActiveAt?: string;
  lastSeenAt?: string;
  current: boolean;
  status?: "online" | "offline" | string;
}

export interface KaypalSubscription {
  plan: "free" | "pro" | "enterprise" | string;
  status: "active" | "expired" | "cancelled" | string;
  renewsAt: string | null;
  periodEnd?: string | null;
  expired?: boolean;
  features: string[];
}

export interface KaypalBillingSnapshot {
  subscription?: unknown;
  balance?: {
    balance: number | null;
    userId?: string | null;
    unavailable?: boolean;
    message?: string;
    raw?: unknown;
  } | null;
}

export interface KaypalKnowledgeSearchHit {
  assetId: string;
  title: string;
  sourceType: string | null;
  sourceUrl: string | null;
  snippet: string;
  relevanceScore: number;
  rankingReason: string;
  indexedAt: string | null;
  chunkId: string | null;
  chunkIndex: number | null;
  syncStatus?: string;
}

export interface KaypalKnowledgeSearchResult {
  query: string;
  tenantId: string;
  userId?: string;
  total: number;
  matches: KaypalKnowledgeSearchHit[];
  diagnostics?: {
    vectorHitCount?: number;
    localCandidateCount?: number;
    localHitCount?: number;
    cloudHitCount?: number;
    cloudWarning?: string;
    sourceTypes?: string[];
  };
}

export interface KaypalKnowledgeUploadResult {
  items: Array<{ id?: string; title?: string }>;
  total: number;
  local?: boolean;
  cloud?: unknown;
  parsed?: boolean;
  cloudWarning?: string;
}

export interface KaypalKnowledgeSyncResult {
  ok: boolean;
  id: string;
  cloud?: unknown;
  cloudWarning?: string;
}

export interface LocalKnowledgeItem {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  fileName: string | null;
  contentType: string | null;
  fileSize: number | null;
  parsed: boolean;
  syncStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalKnowledgeListResult {
  total: number;
  items: LocalKnowledgeItem[];
}

export const kaypalApi = {
  profile() {
    return api.get<KaypalProfile>("/kaypal/profile");
  },
  devices() {
    return api.get<KaypalDevice[]>("/kaypal/devices");
  },
  subscription() {
    return api.get<KaypalSubscription>("/kaypal/subscription");
  },
  billing() {
    return api.get<KaypalBillingSnapshot>("/kaypal/billing");
  },
  searchKnowledge(input: {
    query: string;
    limit?: number;
    sourceTypes?: string[];
    includeCloud?: boolean;
  }) {
    return api.post<KaypalKnowledgeSearchResult>(
      "/kaypal/knowledge/search",
      input,
    );
  },
  listLocalKnowledge() {
    return api.get<LocalKnowledgeListResult>("/kaypal/knowledge/local");
  },
  createKnowledgeText(input: {
    title?: string;
    content: string;
    syncCloud?: boolean;
  }) {
    return api.post<KaypalKnowledgeUploadResult>(
      "/kaypal/knowledge/text",
      input,
    );
  },
  uploadKnowledgeFile(formData: FormData) {
    return api.upload<KaypalKnowledgeUploadResult>(
      "/kaypal/knowledge/uploads",
      formData,
    );
  },
  syncKnowledge(id: string) {
    return api.post<KaypalKnowledgeSyncResult>("/kaypal/knowledge/sync", {
      id,
    });
  },
  deleteLocalKnowledge(id: string) {
    return api.delete<{ ok: boolean; id: string }>(
      `/kaypal/knowledge/local/${id}`,
    );
  },
  linkKaypalAccount(kaypalUserId: string) {
    return api.post<{ ok: boolean; kaypalUserId: string }>("/kaypal/link", {
      kaypalUserId,
    });
  },
  bindWithCredentials(identifier: string, password: string) {
    return api.post<{
      ok: boolean;
      kaypalUserId: string;
      email?: string;
      displayName?: string | null;
    }>("/kaypal/bind-with-credentials", { identifier, password });
  },
  unlinkKaypalAccount() {
    return api.post<{ ok: boolean }>("/kaypal/unlink");
  },
  startKaypalDeviceAuth(
    input: {
      deviceId: string;
      deviceName: string;
      platform: string;
    },
    options?: ApiRequestOptions,
  ) {
    return api.post<{
      deviceCode: string;
      userCode: string;
      verificationUrl: string;
      expiresIn: number;
      interval: number;
    }>("/kaypal/desktop-auth/start", input, withAuthTimeout(options));
  },
  pollKaypalDeviceAuth(
    input: {
      deviceCode: string;
      deviceId: string;
      forceReauth?: boolean;
    },
    options?: ApiRequestOptions,
  ) {
    return api.post<{
      status: "pending" | "denied" | "authorized";
      tenantId?: string | null;
      user?: {
        id: string;
        username: string;
        name: string;
        email: string;
        kaypalUserId?: string | null;
      };
    }>("/kaypal/desktop-auth/poll", input, withAuthTimeout(options));
  },
  openKaypalDeviceAuth(input: { verificationUrl: string }) {
    return api.post<{ ok: boolean }>("/kaypal/desktop-auth/open", input);
  },
};
