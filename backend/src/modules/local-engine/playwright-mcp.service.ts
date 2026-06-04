/**
 * PlaywrightMcpService · 接入 microsoft/playwright-mcp 让 Agent-S 通过 MCP 调浏览器
 *
 * 用 sidecar 模式: spawn `npx @playwright/mcp` 子进程 (stdio) 然后桥到 HTTP.
 * 比 embed createConnection 稳 — 子进程状态隔离, 我们用 SSE 转 HTTP.
 *
 * 暴露 HTTP 端点: POST /api/mcp/playwright (JSON-RPC over HTTP)
 * 内部: 接 client HTTP POST, 转发为 stdio JSON-RPC 给子进程, 回 HTTP.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import type { Request, Response } from 'express';

export type PlaywrightMcpStatus = {
  online: boolean;
  childProcessRunning: boolean;
  transport: 'http-to-stdio' | 'none';
  endpoint: string;
  pid?: number;
  toolCount?: number;
  message: string;
};

@Injectable()
export class PlaywrightMcpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightMcpService.name);
  private child: ChildProcess | null = null;
  private requestQueue: Array<{ id: number; resolve: (v: any) => void; reject: (e: any) => void }> = [];
  private nextId = 1;
  private toolCount = 0;
  private online = false;
  private pendingResponse: { id: number; resolve: (v: any) => void; reject: (e: any) => void } | null = null;

  async onModuleInit(): Promise<void> {
    void this.startChild();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopChild();
  }

  private async startChild(): Promise<void> {
    try {
      this.logger.log('Starting playwright-mcp sidecar...');
      // 默认 playwright-mcp 用系统 Chrome (我们没装), 指到 Playwright 缓存的 Chrome for Testing
      const chromePath = '/Users/yanghy/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
      // 默认 --isolated: profile 在内存, 重启丢 cookies
      // 登录态保留需要持 profile 落盘. PERSIST_PROFILE=true 去掉 --isolated, profile 落 ~/.config/playwright-mcp/
      const persistProfile = process.env.PERSIST_PROFILE === 'true';
      const args = [
        '@playwright/mcp@latest',
        '--no-sandbox',
        '--executable-path', chromePath,
        '--headless',
      ];
      if (!persistProfile) args.push('--isolated');
      this.child = spawn('npx', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });

      this.child.on('error', (err) => {
        this.logger.error(`playwright-mcp sidecar error: ${err.message}`);
      });

      this.child.on('exit', (code) => {
        this.logger.warn(`playwright-mcp sidecar exited code=${code}`);
        this.child = null;
      });

      this.child.stderr?.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) this.logger.debug(`[playwright-mcp stderr] ${msg}`);
      });

      // Parse stdout line-by-line as JSON-RPC responses
      let buffer = '';
      this.child.stdout?.on('data', (d) => {
        buffer += d.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            this.handleResponse(msg);
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

      this.logger.log(
        `playwright-mcp sidecar ready (pid=${this.child.pid}). HTTP bridge at /api/mcp/playwright`,
      );
    } catch (error) {
      this.logger.error(`playwright-mcp sidecar start failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private stopChild(): void {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  private handleResponse(msg: any): void {
    if (msg.id != null && this.pendingResponse?.id === msg.id) {
      const r = this.pendingResponse;
      this.pendingResponse = null;
      r?.resolve(msg);
    }
  }

  /**
   * 发 JSON-RPC 请求给子进程, 等响应
   */
  async rpcCall(request: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.child?.stdin?.writable) {
        reject(new Error('playwright-mcp sidecar not running'));
        return;
      }
      if (this.pendingResponse) {
        reject(new Error('playwright-mcp sidecar: another request pending'));
        return;
      }
      this.pendingResponse = { id: request.id, resolve, reject };
      const timeout = setTimeout(() => {
        if (this.pendingResponse?.id === request.id) {
          this.pendingResponse = null;
          reject(new Error('playwright-mcp sidecar timeout'));
        }
      }, 30000);
      // 包装 resolve/reject 清理 timeout
      const origResolve = this.pendingResponse.resolve;
      const origReject = this.pendingResponse.reject;
      this.pendingResponse.resolve = (v) => { clearTimeout(timeout); origResolve(v); };
      this.pendingResponse.reject = (e) => { clearTimeout(timeout); origReject(e); };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * HTTP 端点处理
   */
  async handleRequest(req: Request, res: Response): Promise<void> {
    if (!this.child) {
      res.status(503).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'playwright-mcp sidecar not running' },
        id: null,
      });
      return;
    }
    try {
      let body: any = req.body;
      if (!body || typeof body === 'string') {
        try {
          body = body ? JSON.parse(body) : null;
        } catch {
          res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Invalid JSON' },
            id: null,
          });
          return;
        }
      }
      if (!body || body.jsonrpc !== '2.0') {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid JSON-RPC request' },
          id: null,
        });
        return;
      }
      // 给 request 一个 id (子进程需要)
      if (body.id == null) {
        body.id = this.nextId++;
      }
      this.logger.debug(`playwright-mcp HTTP ${req.method} ${body.method} id=${body.id}`);
      const result = await this.rpcCall(body);
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
    // 懒获取 toolCount: 启动时只调用一次 tools/list, 后续从缓存读
    return {
      online: this.online,
      childProcessRunning: this.child !== null,
      transport: 'http-to-stdio',
      endpoint: '/api/mcp/playwright',
      pid: this.child?.pid,
      toolCount: this.toolCount,
      message: this.child
        ? `playwright-mcp sidecar running (pid=${this.child.pid})`
        : 'playwright-mcp sidecar not running',
    };
  }

  /**
   * 懒获取并缓存 toolCount, 状态报告时调用
   */
  async getToolCount(): Promise<number> {
    if (this.toolCount > 0) return this.toolCount;
    if (!this.child) return 0;
    try {
      const tools = await this.listTools();
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
    try {
      const reqId = this.nextId++;
      this.logger.debug(`listTools rpcCall id=${reqId}`);
      const result = await this.rpcCall({
        jsonrpc: '2.0',
        id: reqId,
        method: 'tools/list',
        params: {},
      });
      this.logger.debug(`listTools response: keys=${result ? Object.keys(result).join(',') : 'null'} resultKeys=${result?.result ? Object.keys(result.result).join(',') : 'n/a'}`);
      const tools = (result?.result?.tools ?? []) as Array<{ name: string; description?: string }>;
      this.logger.debug(`listTools got ${tools.length} tools`);
      return tools;
    } catch (error) {
      this.logger.warn(`listTools failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}
