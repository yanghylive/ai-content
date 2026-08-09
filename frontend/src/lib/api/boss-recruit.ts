import { api } from "./client";

// ============ Boss 直聘获客（boss-recruit）API ============

export interface BossRecruitState {
  accounts: Array<{
    id: string;
    name: string;
    loginStatus: "unknown" | "logged_in" | "not_logged_in" | "failed";
    lastCheckedAt: string | null;
  }>;
  candidates: number;
  tasks: number;
  pendingTasks: number;
}

export interface BossLoginCheckResult {
  ok: boolean;
  status: string;
  url?: string;
  title?: string;
}

export interface BossTask {
  id: string;
  taskType: string;
  status: string;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface BossCandidate {
  id: string;
  name: string;
  jobTitle: string | null;
  wechatId: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

export const bossRecruitApi = {
  state: () => api.get<BossRecruitState>("/boss-recruit/state"),
  saveCookie: (storageState: Record<string, unknown>) =>
    api.post<{ ok: boolean; accountId: string }>("/boss-recruit/cookie", {
      storageState,
    }),
  checkLogin: (accountId: string) =>
    api.post<BossLoginCheckResult>(`/boss-recruit/accounts/${accountId}/check-login`),
  refreshPositions: (accountId: string, limit?: number) =>
    api.post<{ refreshed: number; checkedAt: string }>(
      "/boss-recruit/positions/refresh",
      { accountId, limit: limit ?? 3 },
    ),
  sendHello: (accountId: string, candidateName: string, message?: string) =>
    api.post<{ ok: boolean; candidate: string; messageSent: boolean }>(
      "/boss-recruit/hello",
      { accountId, candidateName, message },
    ),
  candidates: () => api.get<BossCandidate[]>("/boss-recruit/candidates"),
  tasks: () => api.get<BossTask[]>("/boss-recruit/tasks"),
};
