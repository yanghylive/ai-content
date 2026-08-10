export type KaypalAiContentContext = {
  apiBase: string;
  frontendBase: string;
  cookieHeader: string | null;
  authCookieSource: string | null;
  authCookieRefreshPromise?: Promise<string | null> | null;
  localMcpAuthFile: string | null;
  localMcpDeviceId: string | null;
  requestTimeoutMs: number;
};

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_API_BASE = 'http://127.0.0.1:3011/api';
const DEFAULT_FRONTEND_BASE = 'http://127.0.0.1:3010';
const DEFAULT_COOKIE_NAME = 'ai_content_session';

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value || fallback).trim();
  return raw.replace(/\/+$/, '');
}

function normalizeTimeout(value: string | undefined): number {
  const parsed = Number(value || '');
  if (Number.isFinite(parsed) && parsed >= 1000 && parsed <= 120_000) {
    return parsed;
  }
  return 15_000;
}

function buildCookieHeader(): string | null {
  const rawCookie = process.env.KAYPAL_AI_CONTENT_COOKIE?.trim();
  if (rawCookie) {
    return rawCookie;
  }

  const session = process.env.KAYPAL_AI_CONTENT_SESSION?.trim();
  if (!session) {
    return null;
  }

  const cookieName =
    process.env.KAYPAL_AI_CONTENT_AUTH_COOKIE_NAME?.trim() || DEFAULT_COOKIE_NAME;
  return `${cookieName}=${session}`;
}

function buildCookieSource(): string | null {
  if (process.env.KAYPAL_AI_CONTENT_COOKIE?.trim()) {
    return 'env:KAYPAL_AI_CONTENT_COOKIE';
  }
  if (process.env.KAYPAL_AI_CONTENT_SESSION?.trim()) {
    return 'env:KAYPAL_AI_CONTENT_SESSION';
  }
  return null;
}

function getProjectRoot(): string | null {
  const explicit = process.env.KAYPAL_AI_CONTENT_ROOT?.trim();
  if (explicit) {
    return explicit;
  }
  return resolve(import.meta.dirname, '../../..');
}

function localMcpAuthFileCandidates(): string[] {
  const explicit = process.env.KAYPAL_AI_CONTENT_LOCAL_MCP_AUTH_FILE?.trim();
  const desktopUserData = process.env.KAYPAL_DESKTOP_USER_DATA_DIR?.trim();
  const projectRoot = getProjectRoot();
  const home = homedir();
  return [
    explicit || '',
    desktopUserData ? join(desktopUserData, 'local-mcp-auth.json') : '',
    projectRoot ? join(projectRoot, 'backend', 'data', 'local-mcp-auth.json') : '',
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'ai-content-desktop', 'local-mcp-auth.json')
      : '',
    process.platform === 'win32'
      ? join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai-content-desktop', 'local-mcp-auth.json')
      : '',
    process.platform === 'linux'
      ? join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'ai-content-desktop', 'local-mcp-auth.json')
      : '',
  ].filter(Boolean);
}

function buildLocalMcpAuthFile(): string | null {
  const candidates = localMcpAuthFileCandidates();
  return candidates.length ? resolve(candidates[0]) : null;
}

export function createContext(): KaypalAiContentContext {
  const cookieHeader = buildCookieHeader();
  return {
    apiBase: normalizeBaseUrl(
      process.env.KAYPAL_AI_CONTENT_API_BASE,
      DEFAULT_API_BASE,
    ),
    frontendBase: normalizeBaseUrl(
      process.env.KAYPAL_AI_CONTENT_FRONTEND_BASE,
      DEFAULT_FRONTEND_BASE,
    ),
    cookieHeader,
    authCookieSource: buildCookieSource(),
    authCookieRefreshPromise: null,
    localMcpAuthFile: buildLocalMcpAuthFile(),
    localMcpDeviceId:
      process.env.KAYPAL_AI_CONTENT_DEVICE_ID?.trim() || null,
    requestTimeoutMs: normalizeTimeout(
      process.env.KAYPAL_AI_CONTENT_REQUEST_TIMEOUT_MS,
    ),
  };
}

export function hasAuthCookie(ctx: KaypalAiContentContext): boolean {
  return Boolean(ctx.cookieHeader);
}
