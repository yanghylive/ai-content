import { api, type PaginatedData } from "./client";

export type RedfoxConnectionStatus =
  | "missing_key"
  | "untested"
  | "connected"
  | "failed"
  | "disabled";

export type RedfoxConnectionView = {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
  configured: boolean;
  apiKeySource: "saved" | "env" | "missing";
  apiKeyMasked: string | null;
  status: RedfoxConnectionStatus;
  lastTestAt: string | null;
  lastError: string | null;
  dailyUserLimit: number;
  dailyTenantLimit: number;
  highCostConfirmThreshold: number;
  updatedAt: string;
};

export type SaveRedfoxConnectionInput = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  enabled?: boolean;
  dailyUserLimit?: number;
  dailyTenantLimit?: number;
  highCostConfirmThreshold?: number;
};

export type RedfoxSkill = {
  id: string;
  skillNo: string;
  code: string;
  name: string;
  platform: string;
  category: string;
  tags: string[];
  summary: string;
  status: "available" | "disabled" | "unknown";
  enabled: boolean;
  scenario: string | null;
  syncedAt: string;
  updatedAt: string;
};

export type RedfoxInterface = {
  id: string;
  platformCode: string;
  platformName: string | null;
  interfaceNo: string | null;
  code: string;
  name: string;
  path: string;
  method: string;
  scenario: string | null;
  status: string;
  category: string | null;
  description: string;
  price: number | null;
  minPrice: number | null;
  requireAuth: boolean;
  syncedAt: string;
  updatedAt: string;
};

export type RedfoxCallLog = {
  id: string;
  userId: string;
  tenantId: string;
  endpoint: string;
  method: string;
  operation: string;
  skillCode: string | null;
  status: "success" | "failed" | "blocked";
  costPoints: number;
  latencyMs: number;
  requestHash: string;
  responseStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type RedfoxCostSummary = {
  range: { from: string | null; to: string | null };
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  blockedCalls: number;
  totalCostPoints: number;
  averageLatencyMs: number;
  todayUsage: {
    userCalls: number;
    tenantCalls: number;
    dailyUserLimit: number;
    dailyTenantLimit: number;
  };
  byStatus: Record<string, number>;
  bySkill: Array<{
    skillCode: string;
    calls: number;
    costPoints: number;
    failures: number;
  }>;
};

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const redfoxApi = {
  getConnection() {
    return api.get<RedfoxConnectionView>("/redfox/connection");
  },
  saveConnection(input: SaveRedfoxConnectionInput) {
    return api.post<RedfoxConnectionView>("/redfox/connection", input);
  },
  testConnection() {
    return api.post<{
      ok: boolean;
      status: string;
      checkedAt: string;
      baseUrl: string;
      sample: Record<string, unknown>;
    }>("/redfox/connection/test", {});
  },
  listInterfaces(params: {
    page?: number;
    limit?: number;
    keyword?: string;
    platform?: string;
    scenario?: string;
    path?: string;
    status?: string;
  } = {}) {
    return api.get<PaginatedData<RedfoxInterface>>(
      `/redfox/interfaces${query(params)}`,
    );
  },
  syncInterfaces(input: { platforms?: string } = {}) {
    return api.post<{
      syncedAt: string;
      platforms: number;
      attempted: number;
      received: number;
      created: number;
      updated: number;
      failed: number;
      failures: Array<{ platformCode: string; error: string }>;
      total: number;
    }>("/redfox/interfaces/sync", input);
  },
  listSkills(params: {
    page?: number;
    limit?: number;
    keyword?: string;
    platform?: string;
    tag?: string;
    scenario?: string;
    enabled?: boolean;
  } = {}) {
    return api.get<PaginatedData<RedfoxSkill>>(`/redfox/skills${query(params)}`);
  },
  syncSkills(input: { page?: number; pageSize?: number } = {}) {
    return api.post<{
      syncedAt: string;
      received: number;
      created: number;
      updated: number;
      total: number;
    }>("/redfox/skills/sync", input);
  },
  updateSkill(id: string, input: {
    enabled?: boolean;
    scenario?: string | null;
    tags?: string[];
  }) {
    return api.patch<RedfoxSkill>(`/redfox/skills/${encodeURIComponent(id)}`, input);
  },
  getCostSummary(params: { from?: string; to?: string } = {}) {
    return api.get<RedfoxCostSummary>(`/redfox/costs/summary${query(params)}`);
  },
  listCallLogs(params: {
    page?: number;
    limit?: number;
    status?: string;
    skillCode?: string;
    endpoint?: string;
    from?: string;
    to?: string;
  } = {}) {
    return api.get<PaginatedData<RedfoxCallLog>>(`/redfox/call-logs${query(params)}`);
  },
};
