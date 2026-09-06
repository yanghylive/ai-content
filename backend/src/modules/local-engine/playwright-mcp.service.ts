/**
 * PlaywrightMcpService · 接入 microsoft/playwright-mcp 让 Agent-S 通过 MCP 调浏览器
 *
 * 用 sidecar 模式: spawn 本地 @playwright/mcp CLI 子进程 (stdio) 然后桥到 HTTP.
 * 比 embed createConnection 稳 — 子进程状态隔离, 我们用 SSE 转 HTTP.
 * 一体化安装包不允许运行时 npx 下载，必须解析本地已打包 CLI。
 *
 * 暴露 HTTP 端点: POST /api/mcp/playwright (JSON-RPC over HTTP)
 * 内部: 接 client HTTP POST, 转发为 stdio JSON-RPC 给子进程, 回 HTTP.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn, ChildProcess } from 'child_process';
import type { Request, Response } from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CdpBrowserProfileService } from './cdp-browser-profile.service';
import { PlaywrightBrowserRuntimeService } from './playwright-browser-runtime.service';
import { resolveProjectDataPath } from '../../common/project-paths';

export type PlaywrightMcpStatus = {
  online: boolean;
  childProcessRunning: boolean;
  transport: 'http-to-stdio' | 'none';
  endpoint: string;
  command?: string;
  pid?: number;
  toolCount?: number;
  profileKey?: string;
  profileDir?: string;
  visibleWindow: boolean;
  isolated: boolean;
  message: string;
  readyForAutomation?: boolean;
  requiredToolsReady?: boolean;
  requiredTools?: string[];
  missingRequiredTools?: string[];
  lastError?: string;
};

/** JSON-RPC 请求（playwright-mcp stdio/HTTP 桥接） */
type RpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
};

/** JSON-RPC 响应 */
type RpcResponse = {
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
  /** MCP tools/call 结果透传字段（部分调用方直接读顶层） */
  isError?: boolean;
  content?: Array<{ type?: string; text?: string }>;
};

@Injectable()
export class PlaywrightMcpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightMcpService.name);
  private child: ChildProcess | null = null;
  private requestQueue: Array<{
    id: number;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }> = [];
  private nextId = 1;
  private toolCount = 0;
  private toolNames = new Set<string>();
  private cachedTools: Array<{ name: string; description?: string }> = [];
  private toolDiscoveryPromise: Promise<
    Array<{ name: string; description?: string }>
  > | null = null;
  private online = false;
  private pendingResponse: {
    id: number | string | null;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  } | null = null;
  private rpcQueue: Promise<unknown> = Promise.resolve();
  private profileKey = 'shared';
  private profileDir = '';
  private visibleWindow = true;
  private isolated = false;
  private commandLabel = '';
  private startupPromise: Promise<void> | null = null;
  private lastError = '';
  // 2026-09-05 复核五轮（大王打回）：sidecar 退出后此前只 WARN 不重启，
  // MCP 永久 mcp-down（实测 3013：sidecar exited code=0 后 online=false 不恢复）。
  // 加自动重启：指数退避 + 连续失败上限，人为 stopChild 不触发。
  private stopping = false;
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private static readonly RESTART_MAX_ATTEMPTS = 5;
  private static readonly RESTART_BASE_DELAY_MS = 2000;
  private static readonly RESTART_MAX_DELAY_MS = 30_000;
  private readonly requiredAutomationTools = [
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_fill_form',
    'browser_take_screenshot',
  ];

  constructor(
    private readonly config: ConfigService,
    private readonly profiles: CdpBrowserProfileService,
    private readonly browsers: PlaywrightBrowserRuntimeService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    // The MCP browser sidecar can take tens of seconds to launch on first run.
    // Keep Nest/3011 startup independent so login, account sync, and UI pages stay usable.
    setImmediate(() => {
      void this.startDefaultChildInBackground();
    });
  }

  onModuleDestroy(): void {
    this.stopChild();
  }

  async ensureProfile(input: {
    platform: string;
    accountId: string | number;
  }): Promise<PlaywrightMcpStatus> {
    const profileKey = `${input.platform}-${input.accountId}`;
    const profileDir = this.profiles.ensureProfileExists(
      input.platform,
      String(input.accountId),
    );
    if (
      this.child &&
      this.online &&
      this.profileKey === profileKey &&
      this.profileDir === profileDir
    ) {
      return this.getStatus();
    }
    this.stopChild();
    await this.startChild({ profileKey, profileDir });
    return this.getStatus();
  }

  private startDefaultChildInBackground(): Promise<void> {
    if (this.child || this.startupPromise) {
      return this.startupPromise ?? Promise.resolve();
    }
    this.startupPromise = this.startChild({
      profileKey: 'shared',
      profileDir: this.getSharedProfileDir(),
    }).finally(() => {
      this.startupPromise = null;
    });
    return this.startupPromise;
  }

  private async startChild(input: {
    profileKey: string;
    profileDir: string;
  }): Promise<void> {
    try {
      this.online = false;
      this.toolCount = 0;
      this.toolNames = new Set();
      this.cachedTools = [];
      this.toolDiscoveryPromise = null;
      this.pendingResponse = null;
      this.profileKey = input.profileKey;
      this.profileDir = input.profileDir;
      // 2026-09-05 复核五轮：主动启动 = 复位人为停止标志（stopChild → startChild 切 profile 场景）
      this.stopping = false;
      mkdirSync(this.profileDir, { recursive: true });
      this.logger.log(
        `Starting playwright-mcp sidecar profile=${this.profileKey} dir=${this.profileDir}`,
      );
      const browserRuntime = this.browsers.resolve();
      const chromePath = browserRuntime.executablePath;
      if (!browserRuntime.exists) {
        this.lastError = browserRuntime.message;
        this.logger.warn(browserRuntime.message);
        return;
      }
      const command = this.resolvePlaywrightMcpCommand();
      if (!command) {
        this.lastError =
          'local @playwright/mcp cli not found. Runtime downloads via npx are disabled for one-click packaging.';
        this.logger.warn(
          'playwright-mcp sidecar skipped: local @playwright/mcp cli not found. Runtime downloads via npx are disabled for one-click packaging.',
        );
        return;
      }
      this.lastError = '';
      this.commandLabel = `${command.command} ${command.args.join(' ')}`;
      // 2026-09-05 复核修正：sidecar 默认 headless——它是 MCP 兜底执行器，
      // 不需要人看；此前默认 visible=true 导致 3011/3013 每次重启都向桌面
      // 弹一个独立 Chrome 窗口（被当成「调起外部浏览器」）。要恢复可见窗口
      // 显式设 LOCAL_MCP_VISIBLE=true。dispatchViaMcp 的 visible 商用闸不受
      // 影响（该分支已是死分支，主路径 dispatchWithLocalBrowser 走 playwright）。
      this.visibleWindow =
        this.config.get<string>('LOCAL_MCP_VISIBLE') === 'true';
      this.isolated =
        this.config.get<string>('LOCAL_BROWSER_ISOLATED') === 'true';
      const args = [
        ...command.args,
        '--no-sandbox',
        '--executable-path',
        chromePath,
        '--user-data-dir',
        this.profileDir,
        '--shared-browser-context',
        '--viewport-size',
        '1366x900',
      ];
      if (!this.visibleWindow) args.push('--headless');
      if (this.isolated) args.push('--isolated');
      const child = spawn(command.command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      this.child = child;

      child.on('error', (err) => {
        this.lastError = err.message;
        this.logger.error(`playwright-mcp sidecar error: ${err.message}`);
      });

      child.on('exit', (code) => {
        this.lastError = `playwright-mcp sidecar exited code=${code}`;
        this.logger.warn(`playwright-mcp sidecar exited code=${code}`);
        if (this.child === child) {
          this.child = null;
          this.online = false;
          this.toolCount = 0;
          this.toolNames = new Set();
          this.cachedTools = [];
          this.toolDiscoveryPromise = null;
        }
        // 2026-09-05 复核五轮：意外退出自动重启（人为 stopChild 置 stopping 不触发）。
        // 指数退避 2s→4s→8s→16s→30s 封顶；连续 5 次失败放弃并 ERROR 留痕，
        // 防坏产物/端口冲突类 crash loop。成功启动后 attempts 归零。
        if (this.stopping) return;
        if (this.restartAttempts >= PlaywrightMcpService.RESTART_MAX_ATTEMPTS) {
          this.lastError = `playwright-mcp sidecar 连续 ${PlaywrightMcpService.RESTART_MAX_ATTEMPTS} 次启动失败，放弃自动重启`;
          this.logger.error(this.lastError);
          return;
        }
        const delay = Math.min(
          PlaywrightMcpService.RESTART_BASE_DELAY_MS *
            2 ** this.restartAttempts,
          PlaywrightMcpService.RESTART_MAX_DELAY_MS,
        );
        this.restartAttempts += 1;
        this.logger.warn(
          `playwright-mcp sidecar 将在 ${delay}ms 后自动重启（第 ${this.restartAttempts}/${PlaywrightMcpService.RESTART_MAX_ATTEMPTS} 次）`,
        );
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.startupPromise = this.startChild({
            profileKey: this.profileKey,
            profileDir: this.profileDir,
          })
            .catch((err) => {
              this.lastError = `playwright-mcp sidecar 自动重启失败：${err instanceof Error ? err.message : String(err)}`;
              this.logger.error(this.lastError);
            })
            .finally(() => {
              this.startupPromise = null;
            });
        }, delay);
      });

      child.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.logger.debug(`[playwright-mcp stderr] ${msg}`);
      });

      // Parse stdout line-by-line as JSON-RPC responses
      let buffer = '';
      child.stdout?.on('data', (d: Buffer) => {
        buffer += d.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg: unknown = JSON.parse(line);
            this.handleResponse(msg as RpcResponse);
          } catch {
            // 非 JSON 输出 (像 server 启动日志), 忽略
          }
        }
      });

      // 初始化 handshake
      await this.rpcCall({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'kaypal-local-engine', version: '1.0.0' },
        },
      });
      this.online = true;
      // 2026-09-05 复核五轮：启动成功即重置自动重启计数（新一轮故障从 1 数起）
      this.restartAttempts = 0;

      this.logger.log(
        `playwright-mcp sidecar ready (pid=${child.pid}, profile=${this.profileKey}, visible=${this.visibleWindow}). HTTP bridge at /api/mcp/playwright`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.error(`playwright-mcp sidecar start failed: ${message}`);
    }
  }

  private resolvePlaywrightMcpCommand(): {
    command: string;
    args: string[];
  } | null {
    const explicitCliPath = this.config.get<string>('PLAYWRIGHT_MCP_CLI_PATH');
    const candidates = [
      explicitCliPath,
      join(process.cwd(), 'node_modules', '@playwright', 'mcp', 'cli.js'),
      join(
        process.cwd(),
        'backend',
        'node_modules',
        '@playwright',
        'mcp',
        'cli.js',
      ),
      join(__dirname, 'node_modules', '@playwright', 'mcp', 'cli.js'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'node_modules',
        '@playwright',
        'mcp',
        'cli.js',
      ),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return {
          command: process.execPath,
          args: [candidate],
        };
      }
    }

    return null;
  }

  private getSharedProfileDir(): string {
    const root =
      this.config.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      resolveProjectDataPath('browser-profiles');
    const dir = join(root, 'shared-mcp');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private stopChild(): void {
    // 2026-09-05 复核五轮：人为停止不打自动重启；切 profile 的 ensureProfile
    // 也会走这里（stop 后立刻 startChild 重开），stopping 会在 startChild 入口复位
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
      this.online = false;
    }
    this.toolCount = 0;
    this.toolNames = new Set();
    this.cachedTools = [];
    this.toolDiscoveryPromise = null;
  }

  private handleResponse(msg: RpcResponse): void {
    if (msg.id != null && this.pendingResponse?.id === msg.id) {
      const r = this.pendingResponse;
      this.pendingResponse = null;
      r?.resolve(msg);
    }
  }

  /**
   * 发 JSON-RPC 请求给子进程, 等响应
   */
  async rpcCall(request: RpcRequest, timeoutMs = 30000): Promise<RpcResponse> {
    const queued = this.rpcQueue.then(
      () => this.executeRpcCall(request, timeoutMs),
      () => this.executeRpcCall(request, timeoutMs),
    );
    this.rpcQueue = queued.catch(() => undefined);
    return queued;
  }

  private async executeRpcCall(
    request: RpcRequest,
    timeoutMs = 30000,
  ): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error('playwright-mcp sidecar not running'));
        return;
      }
      if (this.pendingResponse) {
        reject(
          new Error('playwright-mcp sidecar: internal request still pending'),
        );
        return;
      }
      this.pendingResponse = {
        id: request.id as number | string | null,
        resolve,
        reject,
      };
      const timeout = setTimeout(() => {
        if (this.pendingResponse?.id === request.id) {
          this.pendingResponse = null;
          reject(new Error('playwright-mcp sidecar timeout'));
        }
      }, timeoutMs);
      // 包装 resolve/reject 清理 timeout
      const pending = this.pendingResponse;
      const origResolve = pending.resolve;
      const origReject = pending.reject;
      pending.resolve = (v) => {
        clearTimeout(timeout);
        origResolve(v);
      };
      pending.reject = (e) => {
        clearTimeout(timeout);
        origReject(e);
      };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * HTTP 端点处理
   */
  async handleRequest(req: Request, res: Response): Promise<void> {
    if (!this.child) {
      void this.startDefaultChildInBackground();
      res.status(503).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'playwright-mcp sidecar is starting or not running',
        },
        id: null,
      });
      return;
    }
    try {
      let body: unknown = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Invalid JSON' },
            id: null,
          });
          return;
        }
      }
      if (!body || typeof body !== 'object') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
          id: null,
        });
        return;
      }
      const rpcBody = body as Record<string, unknown>;
      if (rpcBody.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
          id: null,
        });
        return;
      }
      // 给 request 一个 id (子进程需要)
      if (rpcBody.id == null) {
        rpcBody.id = this.nextId++;
      }
      this.logger.debug(
        `playwright-mcp HTTP ${req.method} method=${typeof rpcBody.method === 'string' ? rpcBody.method : ''} id=${typeof rpcBody.id === 'string' || typeof rpcBody.id === 'number' ? rpcBody.id : ''}`,
      );
      const result = await this.rpcCall(rpcBody as unknown as RpcRequest);
      // SSE-style response (跟 stdio 行为一致)
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`playwright-mcp HTTP error: ${message}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message },
          id: null,
        });
      }
    }
  }

  getStatus(): PlaywrightMcpStatus {
    const missingRequiredTools =
      this.online && this.toolNames.size > 0
        ? this.requiredAutomationTools.filter(
            (tool) => !this.toolNames.has(tool),
          )
        : [...this.requiredAutomationTools];
    const requiredToolsReady =
      this.online &&
      this.toolNames.size > 0 &&
      missingRequiredTools.length === 0;
    // 懒获取 toolCount: 启动时只调用一次 tools/list, 后续从缓存读
    return {
      online: this.online,
      childProcessRunning: this.child !== null,
      transport: 'http-to-stdio',
      endpoint: '/api/mcp/playwright',
      command: this.commandLabel || undefined,
      pid: this.child?.pid,
      toolCount: this.toolCount,
      profileKey: this.profileKey,
      profileDir: this.profileDir,
      visibleWindow: this.visibleWindow,
      isolated: this.isolated,
      // 2026-09-05 复核修正：readiness 与可见性解耦——headless sidecar 是合法
      // 自动化通道（MCP 兜底执行器不需要人看），此前硬性要求 visibleWindow=true
      // 与默认 headless 配置冲突，把健康的 Agent-S 误判成 mcp-down。
      // isolated 仍作为阻断条件（无持久 profile，登录态不落盘，不能承载真机自动化）。
      readyForAutomation:
        this.online &&
        this.child !== null &&
        !this.isolated &&
        requiredToolsReady,
      requiredToolsReady,
      requiredTools: [...this.requiredAutomationTools],
      missingRequiredTools,
      lastError: this.lastError || undefined,
      message: this.child
        ? `playwright-mcp sidecar running (visible=${this.visibleWindow})`
        : this.lastError
          ? 'playwright-mcp sidecar unavailable'
          : 'playwright-mcp sidecar not running',
    };
  }

  async getAutomationStatus(): Promise<PlaywrightMcpStatus> {
    const tools = this.child ? await this.getToolListCached() : [];
    this.toolCount = tools.length;
    const names = new Set(tools.map((tool) => tool.name));
    this.toolNames = names;
    const missingRequiredTools = this.requiredAutomationTools.filter(
      (tool) => !names.has(tool),
    );
    const base = this.getStatus();
    const requiredToolsReady =
      this.online && this.toolCount > 0 && missingRequiredTools.length === 0;
    return {
      ...base,
      toolCount: this.toolCount,
      requiredToolsReady,
      missingRequiredTools,
      readyForAutomation:
        // 2026-09-05 复核修正：与 getStatus 同步解耦可见性（headless 是合法
        // 自动化通道），isolated（无持久登录态）仍是阻断条件。
        this.online &&
        this.child !== null &&
        !this.isolated &&
        requiredToolsReady,
      message:
        this.online && requiredToolsReady
          ? base.message
          : this.online
            ? `playwright-mcp browser tools incomplete: missing ${missingRequiredTools.join(', ') || 'tool list'}`
            : base.message,
    };
  }

  /**
   * 懒获取并缓存 toolCount, 状态报告时调用
   */
  async getToolCount(): Promise<number> {
    if (this.toolCount > 0) return this.toolCount;
    if (!this.child) return 0;
    try {
      const tools = await this.getToolListCached();
      this.toolCount = tools.length;
      return this.toolCount;
    } catch {
      return 0;
    }
  }

  /**
   * 列出可用工具 (用 sidecar RPC)
   */
  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return this.getToolListCached();
  }

  private async getToolListCached(): Promise<
    Array<{ name: string; description?: string }>
  > {
    if (this.cachedTools.length > 0) {
      return this.cachedTools;
    }
    if (this.toolDiscoveryPromise) {
      return this.toolDiscoveryPromise;
    }
    this.toolDiscoveryPromise = this.listToolsRaw()
      .then((tools) => {
        this.cachedTools = tools;
        this.toolCount = tools.length;
        this.toolNames = new Set(tools.map((tool) => tool.name));
        return tools;
      })
      .finally(() => {
        this.toolDiscoveryPromise = null;
      });
    return this.toolDiscoveryPromise;
  }

  private async listToolsRaw(): Promise<
    Array<{ name: string; description?: string }>
  > {
    try {
      const reqId = this.nextId++;
      this.logger.debug(`listTools rpcCall id=${reqId}`);
      const result = await this.rpcCall(
        {
          jsonrpc: '2.0',
          id: reqId,
          method: 'tools/list',
          params: {},
        },
        1500,
      );
      this.logger.debug(
        `listTools response: keys=${result ? Object.keys(result).join(',') : 'null'} resultKeys=${result?.result ? Object.keys(result.result).join(',') : 'n/a'}`,
      );
      const tools = (result?.result?.tools ?? []) as Array<{
        name: string;
        description?: string;
      }>;
      this.logger.debug(`listTools got ${tools.length} tools`);
      return tools;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = `listTools failed: ${message}`;
      this.logger.warn(`listTools failed: ${message}`);
      return [];
    }
  }
}
