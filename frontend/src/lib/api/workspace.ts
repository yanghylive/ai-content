import { api, type ApiRequestOptions, ApiError } from "./client";

/**
 * 4.4 多工作区标签壳 · 前端工作区 API。
 *
 * /api/workspaces 由 KaypalAuthGuard 保护（需要 kaypal HMAC 令牌），
 * 而前端只持有 session cookie。这里先调 /api/auth/workspace-token
 * （session 鉴权）换取一张 kaypal 令牌，再带 Authorization 调 /api/workspaces。
 * 令牌按分区缓存到 localStorage；遇到鉴权错误自动清掉缓存并重试一次。
 */

const KAYPAL_TOKEN_KEY = "ai_content_workspace_token";

export interface Workspace {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  agentId?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  settings?: Record<string, unknown> | null;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KAYPAL_TOKEN_KEY);
}

function setToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KAYPAL_TOKEN_KEY, token);
}

function clearToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KAYPAL_TOKEN_KEY);
}

function isAuthError(err: unknown): boolean {
  if (err instanceof ApiError) {
    const code = err.errorCode;
    return (
      code === "UNAUTHORIZED" ||
      code === "AUTH_INVALID" ||
      code === "SESSION_EXPIRED"
    );
  }
  return false;
}

async function ensureToken(): Promise<string> {
  const existing = getToken();
  if (existing) return existing;
  const data = await api.post<{ token: string }>("/auth/workspace-token");
  setToken(data.token);
  return data.token;
}

function authHeaders(token: string): ApiRequestOptions {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/**
 * 带 kaypal 令牌的请求封装：首次失败且是鉴权错误时，清缓存、重新换令牌重试一次。
 * 仅作用于只读/创建工作区这类幂等或安全的调用。
 */
async function withWorkspaceToken<T>(
  fn: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await ensureToken());
  } catch (err) {
    if (isAuthError(err) && getToken()) {
      clearToken();
      return fn(await ensureToken());
    }
    throw err;
  }
}

export const workspaceApi = {
  /** 列出当前用户的全部工作区（active） */
  list(): Promise<Workspace[]> {
    return withWorkspaceToken(async (token) => {
      const data = await api.get<{ workspaces: Workspace[] }>(
        "/workspaces",
        authHeaders(token),
      );
      return data.workspaces;
    });
  },

  /** 新建工作区，返回创建结果 */
  create(name: string, agentId?: string): Promise<Workspace> {
    return withWorkspaceToken(async (token) => {
      const data = await api.post<{ workspace: Workspace }>(
        "/workspaces",
        { name, agentId },
        authHeaders(token),
      );
      return data.workspace;
    });
  },
};
