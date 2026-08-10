import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import type { KaypalAiContentContext } from './context.js';

export type ApiResult = {
  ok: boolean;
  status?: number;
  url: string;
  data?: unknown;
  error?: string;
  authHint?: string;
};

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
};

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function parsePayload(raw: string): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function messageFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const direct = record.message || record.error;
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct)) {
    return direct.map(String).join('; ');
  }
  return undefined;
}

function unwrapPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (record.success === true && 'data' in record) {
    return record.data;
  }
  return payload;
}

async function readLocalMcpToken(filePath: string | null): Promise<string | null> {
  if (!filePath) {
    return null;
  }
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    return token || null;
  } catch {
    return null;
  }
}

async function requestLocalMcpSession(
  ctx: KaypalAiContentContext,
): Promise<string | null> {
  const token = await readLocalMcpToken(ctx.localMcpAuthFile);
  if (!token) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ctx.requestTimeoutMs);
  try {
    const response = await fetch(`${ctx.apiBase}/kaypal/desktop-auth/mcp-session`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-kaypal-local-mcp-token': token,
      },
      body: JSON.stringify(
        ctx.localMcpDeviceId ? { deviceId: ctx.localMcpDeviceId } : {},
      ),
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = unwrapPayload(parsePayload(await response.text()));
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const cookieHeader =
      typeof record.cookieHeader === 'string' ? record.cookieHeader.trim() : '';
    const sessionToken =
      typeof record.sessionToken === 'string' ? record.sessionToken.trim() : '';
    const cookieName =
      typeof record.cookieName === 'string' && record.cookieName.trim()
        ? record.cookieName.trim()
        : 'ai_content_session';
    const nextCookieHeader =
      cookieHeader || (sessionToken ? `${cookieName}=${sessionToken}` : '');
    if (!nextCookieHeader) {
      return null;
    }
    ctx.cookieHeader = nextCookieHeader;
    ctx.authCookieSource = 'local-mcp-session';
    return nextCookieHeader;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureAuthCookie(
  ctx: KaypalAiContentContext,
): Promise<string | null> {
  if (ctx.cookieHeader) {
    return ctx.cookieHeader;
  }
  if (!ctx.authCookieRefreshPromise) {
    ctx.authCookieRefreshPromise = requestLocalMcpSession(ctx).finally(() => {
      ctx.authCookieRefreshPromise = null;
    });
  }
  return ctx.authCookieRefreshPromise;
}

export async function apiFetch(
  ctx: KaypalAiContentContext,
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResult> {
  const url = `${ctx.apiBase}${normalizePath(path)}`;
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.auth !== false) {
    const cookieHeader = await ensureAuthCookie(ctx);
    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs || ctx.requestTimeoutMs,
  );
  try {
    const response = await fetch(url, {
      method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    const data = parsePayload(raw);
    const ok = response.ok;
    const result: ApiResult = {
      ok,
      status: response.status,
      url,
      data,
    };
    if (!ok) {
      result.error =
        messageFromPayload(data) || `HTTP ${response.status} ${response.statusText}`;
      if (response.status === 401 || response.status === 403) {
        result.authHint =
          'Goose MCP 进程没有可用的 3010 登录态。系统已尝试本机 MCP 会话桥；如仍失败，请先在 Kaypal AI Content 桌面应用里完成 Kaypal 登录。';
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      url,
      error:
        message === 'This operation was aborted'
          ? `请求超时：${url}`
          : message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildFrontendUrl(ctx: KaypalAiContentContext, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${ctx.frontendBase}${normalized}`;
}

export function openExternalUrl(url: string): Promise<{ ok: boolean; command: string; error?: string }> {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else if (platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', (error) => {
      resolve({ ok: false, command, error: error.message });
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, command });
    });
  });
}
