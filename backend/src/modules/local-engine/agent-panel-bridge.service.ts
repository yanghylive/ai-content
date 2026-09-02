import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDesktopUserDataDir } from '../../common/project-paths';

/**
 * AgentPanelBridgeService — 3011 ⇄ desktop 右侧浏览器面板的**上行**通道。
 *
 * 为什么用文件而不是 env 注入：3011 **不一定由 desktop 启动**（desktop 的
 * startBackendService 在 3011 端口已被占用时会跳过启动），env 注入子进程
 * 这条路覆盖不到"后端已经在外头跑着"的场景。改为 desktop 把
 * `{ endpoint, token }` 写进 userData 下的 0600 文件（见
 * desktop/browser-panel-bridge-registry.js），3011 按需读取。
 *
 * 安全边界：
 *  - 读取时**强制 chmod 0600**（存量文件历史上落过 0644，只在创建时 chmod
 *    覆盖不到，会让本机任意进程读到 token）——同 local-mcp-auth.ts 的 S5 修复；
 *  - endpoint 必须是回环 http，非回环直接判不可用；
 *  - 文件缺失 / 形状非法 / 老化 / 请求失败 → 一律 `available:false`，
 *    **不重试、不降级、不伪造成功**（AGENTS.md：不得静默降级）；
 *  - token 只在本服务内存里，不进日志、不进事件、不进证据。
 */
export const PANEL_BRIDGE_PROTOCOL = 'kaypal-browser-bridge';
const REGISTRY_FILE_NAME = 'browser-panel-bridge.json';
const TOKEN_HEADER = 'x-kaypal-bridge-token';
const NONCE_HEADER = 'x-kaypal-bridge-nonce';
const TS_HEADER = 'x-kaypal-bridge-ts';
/** 老化阈值：与 desktop 侧一致，兜底"desktop 崩了没来得及删文件" */
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
/** 文件读缓存（避免每个动作都打一次磁盘） */
const CACHE_TTL_MS = 1000;
const REQUEST_TIMEOUT_MS = 3000;

export type PanelBridgeActor = { ownerId: string; tenantId: string };

export type PanelBridgeBinding = {
  panelId: string | null;
  sessionId: string | null;
  webContentsId: number | null;
  url: string | null;
};

export type PanelBridgeStatus = {
  available: boolean;
  reason: string;
  endpoint?: string;
  panelId?: string | null;
  sessionId?: string | null;
  webContentsId?: number | null;
  ageMs?: number;
};

export type PanelObserveResult = {
  binding: PanelBridgeBinding;
  title: string | null;
  textSample: string | null;
};

export type PanelActionTicket = {
  actionId: string;
  binding: { webContentsId: number | null; method: string };
};

export type PanelExecuteResult = {
  binding: PanelBridgeBinding;
  method: string;
  executed: boolean;
  actionId: string | null;
  /** 写动作恒为 null（桥不回传原始 CDP 结果，避免页面内容/凭据带回后端） */
  result: unknown;
};

export type PanelPendingAction = {
  actionId: string;
  method: string;
  summary: unknown;
  createdAt?: number;
};

/** 确认单状态：pending=待用户批准 / approved=已批准待执行 / none=不存在或已消费 */
export type PanelActionState = 'pending' | 'approved' | 'none';

export type PanelActionStateResult = {
  actionId: string;
  state: PanelActionState;
  panelId: string | null;
  method: string | null;
  approvedAt?: number | null;
  binding?: { webContentsId?: number | null; sessionId?: string | null };
};

export class PanelBridgeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(message || code);
    this.name = 'PanelBridgeError';
    this.code = code;
    this.status = status;
  }
}

type RegistryFile = {
  version?: number;
  protocol?: string;
  endpoint?: string;
  token?: string;
  panelId?: string | null;
  sessionId?: string | null;
  webContentsId?: number | null;
  pid?: number;
  startedAt?: string;
};

type CachedRegistry = {
  at: number;
  value: {
    endpoint: string;
    token: string;
    panelId: string | null;
    sessionId: string | null;
    webContentsId: number | null;
    ageMs: number;
  } | null;
};

const LOOPBACK_ENDPOINT = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

@Injectable()
export class AgentPanelBridgeService {
  private readonly logger = new Logger(AgentPanelBridgeService.name);
  private cache: CachedRegistry | null = null;

  /** 凭据文件路径；推导不出 userData 目录时返回 null（fail-closed） */
  registryPath(): string | null {
    const explicit = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE?.trim();
    if (explicit) return explicit;
    const dir = resolveDesktopUserDataDir();
    if (!dir) return null;
    return join(dir, REGISTRY_FILE_NAME);
  }

  /**
   * 读取凭据（带 1s 缓存）。任何一步不合规都返回 null。
   * 返回 null 不等于"出错"，而是"面板不可用"——调用方据此走 fail-closed。
   */
  readCredentials(now = Date.now()) {
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return this.cache.value;
    }
    const value = this.readCredentialsUncached(now);
    this.cache = { at: now, value };
    return value;
  }

  /** 丢弃缓存（测试用 / 桥重启后立即生效） */
  clearCache(): void {
    this.cache = null;
  }

  private readCredentialsUncached(now: number) {
    const filePath = this.registryPath();
    if (!filePath) return null;
    if (!existsSync(filePath)) return null;

    // 存量文件强制收紧权限（同 local-mcp-auth.ts：历史上有 0644 落盘的旧文件）
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Windows 无 POSIX mode
    }

    let parsed: RegistryFile;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as RegistryFile;
    } catch {
      return null;
    }

    if (parsed?.protocol !== PANEL_BRIDGE_PROTOCOL) return null;
    if (typeof parsed.endpoint !== 'string' || !LOOPBACK_ENDPOINT.test(parsed.endpoint)) {
      return null;
    }
    if (typeof parsed.token !== 'string' || !parsed.token) return null;

    const startedAtMs = parsed.startedAt ? Date.parse(parsed.startedAt) : NaN;
    if (!Number.isFinite(startedAtMs)) return null;
    const ageMs = Math.max(0, now - startedAtMs);
    if (ageMs > DEFAULT_MAX_AGE_MS) return null;

    // 文件存在不代表进程还活着：pid 记录不一致时按老化处理
    if (typeof parsed.pid === 'number' && !this.isPidAlive(parsed.pid)) {
      return null;
    }

    return {
      endpoint: parsed.endpoint,
      token: parsed.token,
      panelId: parsed.panelId ?? null,
      sessionId: parsed.sessionId ?? null,
      webContentsId:
        typeof parsed.webContentsId === 'number' ? parsed.webContentsId : null,
      ageMs,
    };
  }

  /** pid 存活探测：signal 0 不发信号只探活；ESRCH=已死，EPERM=活着但没权限 */
  private isPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      return code === 'EPERM';
    }
  }

  /** 面板当前是否可用（不发起网络请求，只看凭据文件） */
  status(): PanelBridgeStatus {
    const credentials = this.readCredentials();
    if (!credentials) {
      return { available: false, reason: 'panel-not-open' };
    }
    return {
      available: true,
      reason: 'ready',
      endpoint: credentials.endpoint,
      panelId: credentials.panelId,
      sessionId: credentials.sessionId,
      webContentsId: credentials.webContentsId,
      ageMs: credentials.ageMs,
    };
  }

  /** 探活：真的打一次 /health（凭据存在但桥已关时返回 false） */
  async health(): Promise<boolean> {
    const credentials = this.readCredentials();
    if (!credentials) return false;
    try {
      const json = await this.call<{ ok?: boolean }>(
        credentials,
        '/health',
        'GET',
        undefined,
      );
      return json?.ok === true;
    } catch (error) {
      this.logger.debug(
        `面板桥探活失败（按不可用处理）：${(error as Error)?.message}`,
      );
      return false;
    }
  }

  /**
   * 只读观察：URL / 标题 / 正文摘要。
   * 返回的 binding 里带 webContentsId——调用方应把它钉进证据，
   * 证明"读的就是用户看到的那一个页面目标"。
   */
  async observe(actor: PanelBridgeActor): Promise<PanelObserveResult> {
    this.assertActor(actor);
    const credentials = this.requireCredentials();
    const json = await this.call<{
      binding?: Partial<PanelBridgeBinding>;
      title?: string | null;
      textSample?: string | null;
    }>(credentials, '/observe', 'POST', { panelId: credentials.panelId, actor });
    return {
      binding: {
        panelId: json?.binding?.panelId ?? credentials.panelId ?? null,
        sessionId: json?.binding?.sessionId ?? credentials.sessionId ?? null,
        webContentsId:
          json?.binding?.webContentsId ?? credentials.webContentsId ?? null,
        url: json?.binding?.url ?? null,
      },
      title: json?.title ?? null,
      textSample: json?.textSample ?? null,
    };
  }

  /**
   * 申请写动作确认单——**只签发，不执行，也不自我批准**。
   * 批准权在用户（desktop 侧审批），本服务拿到的 actionId 只是"待批准票据"。
   */
  async requestAction(
    actor: PanelBridgeActor,
    input: {
      method: string;
      params?: Record<string, unknown>;
      summary?: Record<string, unknown>;
    },
  ): Promise<PanelActionTicket> {
    this.assertActor(actor);
    if (!input?.method || typeof input.method !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400);
    }
    const credentials = this.requireCredentials();
    const json = await this.call<{
      actionId?: string;
      binding?: { webContentsId?: number; method?: string };
    }>(credentials, '/action-request', 'POST', {
      panelId: credentials.panelId,
      actor,
      method: input.method,
      params: input.params || {},
      summary: input.summary || {},
    });
    if (!json?.actionId) {
      throw new PanelBridgeError('NO_TICKET', 502, '桥未返回确认单');
    }
    return {
      actionId: json.actionId,
      binding: {
        webContentsId: json.binding?.webContentsId ?? null,
        method: json.binding?.method ?? input.method,
      },
    };
  }

  /**
   * 执行——**拿执行权不等于拿批准权**。
   * 写方法（Page.navigate / Input.*）必须带 actionId，且该确认单必须已被
   * desktop 用户在面板里批准；缺单/错单/换页后旧单 → 桥一律拒绝（fail-closed）。
   * 只读方法可直接执行（等价 observe 的能力，白名单由 Broker 把守）。
   */
  async execute(
    actor: PanelBridgeActor,
    input: {
      method: string;
      params?: Record<string, unknown>;
      actionId?: string | null;
    },
  ): Promise<PanelExecuteResult> {
    this.assertActor(actor);
    if (!input?.method || typeof input.method !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400);
    }
    const credentials = this.requireCredentials();
    const json = await this.call<{
      binding?: Partial<PanelBridgeBinding>;
      method?: string;
      executed?: boolean;
      actionId?: string | null;
      result?: unknown;
    }>(credentials, '/execute', 'POST', {
      panelId: credentials.panelId,
      actor,
      method: input.method,
      params: input.params || {},
      actionId: input.actionId ?? null,
    });
    return {
      binding: {
        panelId: json?.binding?.panelId ?? credentials.panelId ?? null,
        sessionId: json?.binding?.sessionId ?? credentials.sessionId ?? null,
        webContentsId:
          json?.binding?.webContentsId ?? credentials.webContentsId ?? null,
        url: json?.binding?.url ?? null,
      },
      method: json?.method ?? input.method,
      executed: json?.executed === true,
      actionId: json?.actionId ?? input.actionId ?? null,
      result: json?.result ?? null,
    };
  }

  /** 待批确认单列表（供排障/未来审批 UI 查询；不含 token） */
  async pendingActions(actor: PanelBridgeActor): Promise<PanelPendingAction[]> {
    this.assertActor(actor);
    const credentials = this.requireCredentials();
    const json = await this.call<{ items?: PanelPendingAction[] }>(
      credentials,
      '/pending-actions',
      'POST',
      { panelId: credentials.panelId, actor },
    );
    return Array.isArray(json?.items) ? json.items : [];
  }

  /**
   * 查确认单状态——后端驱动写动作的**唯一合法前置**。
   * 只有 state === 'approved' 才允许带单执行；pending 就是"用户还没点头"，
   * 后端不能替用户点头（硬约束 5）。
   */
  async actionState(
    actor: PanelBridgeActor,
    actionId: string,
  ): Promise<PanelActionStateResult> {
    this.assertActor(actor);
    if (!actionId || typeof actionId !== 'string') {
      throw new PanelBridgeError('METHOD_REQUIRED', 400, 'actionId 必填');
    }
    const credentials = this.requireCredentials();
    const json = await this.call<{
      actionId?: string;
      state?: PanelActionState;
      panelId?: string | null;
      method?: string | null;
      approvedAt?: number | null;
      binding?: { webContentsId?: number | null; sessionId?: string | null };
    }>(credentials, '/action-state', 'POST', {
      panelId: credentials.panelId,
      actor,
      actionId,
    });
    return {
      actionId: json?.actionId ?? actionId,
      state: json?.state ?? 'none',
      panelId: json?.panelId ?? credentials.panelId ?? null,
      method: json?.method ?? null,
      approvedAt: json?.approvedAt ?? null,
      binding: json?.binding ?? undefined,
    };
  }

  private assertActor(actor: PanelBridgeActor): void {
    if (!actor || !actor.ownerId || !actor.tenantId) {
      throw new PanelBridgeError('ACTOR_REQUIRED', 400);
    }
  }

  private requireCredentials() {
    const credentials = this.readCredentials();
    if (!credentials) {
      throw new PanelBridgeError('PANEL_UNAVAILABLE', 503);
    }
    return credentials;
  }

  private async call<T>(
    credentials: { endpoint: string; token: string },
    route: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      [TOKEN_HEADER]: credentials.token,
      [NONCE_HEADER]: randomBytes(16).toString('hex'),
      [TS_HEADER]: String(Date.now()),
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    let response: Response;
    try {
      response = await fetch(`${credentials.endpoint}${route}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = (error as Error)?.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
      throw new PanelBridgeError(reason, 0, `面板桥请求失败：${route}`);
    }

    let json: { success?: boolean; data?: T; error?: { code?: string } } | null = null;
    try {
      // 显式类型断言，避免 `as typeof json` 的循环引用把 json 收窄为 never
      json = (await response.json()) as {
        success?: boolean;
        data?: T;
        error?: { code?: string };
      } | null;
    } catch {
      json = null;
    }

    if (response.ok && json?.success && json.data !== undefined) {
      return json.data;
    }
    const code = json?.error?.code || 'UNKNOWN';
    throw new PanelBridgeError(code, response.status, `面板桥拒绝：${code}`);
  }
}

/** 供测试与诊断：凭据文件当前是否存在（不读内容、不缓存） */
export function panelBridgeRegistryExists(): boolean {
  const explicit = process.env.KAYPAL_BROWSER_PANEL_BRIDGE_FILE?.trim();
  if (explicit) return existsSync(explicit);
  const dir = resolveDesktopUserDataDir();
  if (!dir) return false;
  const filePath = join(dir, REGISTRY_FILE_NAME);
  if (!existsSync(filePath)) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
