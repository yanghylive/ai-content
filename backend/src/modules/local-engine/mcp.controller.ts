/**
 * McpController · MCP 端点 (HTTP)
 *
 * 暴露：
 *   POST /api/mcp/playwright  - playwright-mcp JSON-RPC 端点
 *   GET  /api/mcp/status       - 所有 MCP server 状态
 *   GET  /api/mcp/tools        - playwright-mcp 工具列表
 *
 * 任何 MCP 兼容客户端 (Claude Desktop / Cursor / Agent-S / 自家 worker)
 * 都能 POST JSON-RPC 调工具。
 */

import {
  All,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { McpRuntimeService } from './mcp-runtime.service';
import { Public } from '../auth/auth.decorator';

/**
 * 2026-06-04: /api/mcp/* 加最小鉴权
 *
 * - 不开 @Public() 全开。生产上 MCP 端点暴露 23 个 browser_* 工具能调真实 Chrome (带 cookies 的话能登账号)
 * - 鉴权策略：X-Kaypal-Mcp-Token header 匹配 KAYPAL_MCP_TOKEN env
 * - 本机访问绕过 (loopback IPv4/IPv6) 用于 dev 自家 worker 直连
 * - 任何远程客户端 (Claude/Cursor) 必须带 token
 */

// 远程客户端限流：滑动窗口 60s 内最多 300 次请求（平均 5 次/s，正常 MCP
// 客户端足够，恶意刷会触发）。本机 loopback 直连不限流。
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 300;

// 敏感工具（改变浏览器/页面状态、输入、执行代码、上传文件等）：
// 只读 token（KAYPAL_MCP_READONLY_TOKEN）禁止调用这些，仅主 token（全权限）
// 与本机 loopback 可调。只读工具（navigate/snapshot/screenshot/console/network
// /wait_for）不受限。
const SENSITIVE_MCP_TOOLS = new Set([
  'browser_click',
  'browser_fill_form',
  'browser_type',
  'browser_press_key',
  'browser_select_option',
  'browser_hover',
  'browser_drag',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_run_code',
  'browser_install',
  'browser_close',
  'browser_resize',
  'browser_tabs',
]);

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  /** 按来源 IP 的滑动窗口限流计数 */
  private readonly rateLimit = new Map<
    string,
    { windowStart: number; count: number }
  >();

  constructor(
    private readonly playwrightMcp: PlaywrightMcpService,
    private readonly mcpRuntime: McpRuntimeService,
    private readonly config: ConfigService,
  ) {}

  private static isLoopbackRemote(remote: string): boolean {
    return (
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote === '::ffff:127.0.0.1' ||
      remote === 'localhost'
    );
  }

  /**
   * Origin 是否为本地源（localhost / 127.0.0.1 / ::1）——S11 DNS rebinding 防护。
   * 浏览器场景下 Origin 是页面地址，不会随 DNS 解析改变：恶意网页即使把域名
   * rebinding 到 127.0.0.1，其 Origin 仍是攻击者域名 → 被拒绝。无 Origin 的
   * 请求（curl / 原生 MCP 客户端）放行。
   */
  private static isLocalOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    try {
      const host = new URL(origin).hostname.toLowerCase();
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host === '[::1]'
      );
    } catch {
      return false;
    }
  }

  /**
   * 本机访问绕过 (loopback IPv4/IPv6) 允许 dev 直连
   * 远程必须带 X-Kaypal-Mcp-Token，返回鉴权后的能力级别：
   * - loopback：本机直连，全权限
   * - full：主 token（KAYPAL_MCP_TOKEN）或过渡期旧 token，全权限
   * - readonly：只读 token（KAYPAL_MCP_READONLY_TOKEN，可选），仅只读工具
   *
   * token 轮换：换新 token 时把旧值放到 KAYPAL_MCP_PREVIOUS_TOKEN，
   * 并可选设 KAYPAL_MCP_PREVIOUS_TOKEN_EXPIRES_AT（ISO 8601）作为过渡期
   * 截止时间。过渡期内新旧都认，客户端切完后再清掉旧值；即使忘了清，
   * 过了过期时间旧 token 也会自动失效，不会长期有效。
   */
  private checkAuth(req: Request): 'loopback' | 'full' | 'readonly' {
    const remote = req.ip || req.socket.remoteAddress || '';
    if (McpController.isLoopbackRemote(remote)) {
      // S11 加固（2026-08-18）：DNS rebinding 防护——TCP 来源为本机时，若请求带
      // 非本机 Origin（浏览器跨站页面场景），拒绝 loopback 全权限（browser_run_code
      // 等敏感工具可被恶意网页调用），降级要求携带 token。
      if (!McpController.isLocalOrigin(req.headers.origin)) {
        throw new HttpException(
          'Forbidden: cross-origin loopback access',
          HttpStatus.FORBIDDEN,
        );
      }
      return 'loopback';
    }
    const fullToken = this.config.get<string>('KAYPAL_MCP_TOKEN') || '';
    if (!fullToken) {
      this.logger.warn(
        `[mcp-auth] 拒绝请求：KAYPAL_MCP_TOKEN 未配置 (remote=${remote})`,
      );
      throw new HttpException(
        'MCP token not configured (set KAYPAL_MCP_TOKEN env)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const got = req.headers['x-kaypal-mcp-token'];
    if (got === fullToken) return 'full';

    // 过渡期旧 token（可选）：未过期则按全权限放行
    const previousToken =
      this.config.get<string>('KAYPAL_MCP_PREVIOUS_TOKEN') || '';
    if (previousToken && got === previousToken) {
      const expiresAt = this.config
        .get<string>('KAYPAL_MCP_PREVIOUS_TOKEN_EXPIRES_AT')
        ?.trim();
      if (expiresAt) {
        const expires = Date.parse(expiresAt);
        if (Number.isFinite(expires) && Date.now() > expires) {
          this.logger.warn(
            `[mcp-auth] 拒绝请求：过渡期旧 token 已过期 (remote=${remote})`,
          );
          throw new HttpException(
            'Invalid MCP token (previous token expired)',
            HttpStatus.UNAUTHORIZED,
          );
        }
      }
      return 'full';
    }

    const readonlyToken =
      this.config.get<string>('KAYPAL_MCP_READONLY_TOKEN') || '';
    if (readonlyToken && got === readonlyToken) return 'readonly';
    // 失败审计：记录来源 IP（不含 token 值，避免敏感信息入日志）
    this.logger.warn(`[mcp-auth] 拒绝请求：token 不匹配 (remote=${remote})`);
    throw new HttpException('Invalid MCP token', HttpStatus.UNAUTHORIZED);
  }

  /**
   * 频率限制：仅对远程客户端（非 loopback）生效。
   * 本机 worker 直连是正常高频使用，不限流。
   */
  private checkRateLimit(req: Request): void {
    const remote = req.ip || req.socket.remoteAddress || '';
    if (McpController.isLoopbackRemote(remote)) return;
    const now = Date.now();
    const entry = this.rateLimit.get(remote);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      this.rateLimit.set(remote, { windowStart: now, count: 1 });
      return;
    }
    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
      this.logger.warn(
        `[mcp-rate] 限流触发 (remote=${remote}, count=${entry.count}/${RATE_LIMIT_WINDOW_MS}ms)`,
      );
      throw new HttpException(
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // 定期清理过期条目，防 Map 无限增长
    if (this.rateLimit.size > 5000) {
      for (const [key, value] of this.rateLimit) {
        if (now - value.windowStart > RATE_LIMIT_WINDOW_MS) {
          this.rateLimit.delete(key);
        }
      }
    }
  }

  /**
   * capability 级权限：只读 token 禁止调用敏感工具（写/输入/执行代码/上传）。
   * loopback 与主 token（全权限）不受限。仅校验 tools/call（其它 method 放行）。
   */
  private checkCapability(
    level: 'loopback' | 'full' | 'readonly',
    req: Request,
  ): void {
    if (level !== 'readonly') return;
    const body = req.body as
      { method?: string; params?: { name?: string } } | undefined;
    if (!body || body.method !== 'tools/call') return;
    const name = body.params?.name;
    if (typeof name === 'string' && SENSITIVE_MCP_TOOLS.has(name)) {
      this.logger.warn(`[mcp-cap] 只读 token 尝试调用敏感工具 ${name}，已拒绝`);
      throw new HttpException(
        `Tool "${name}" requires write permission`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @All('playwright')
  @Public()
  async handlePlaywrightMcp(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const level = this.checkAuth(req);
      this.checkRateLimit(req);
      this.checkCapability(level, req);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unauthorized';
      const status = error instanceof HttpException ? error.getStatus() : 401;
      res.status(status).json({
        jsonrpc: '2.0',
        error: { code: -32001, message },
        id: null,
      });
      return;
    }
    await this.playwrightMcp.handleRequest(req, res);
  }

  @Get('status')
  @Public()
  async getStatus(@Req() req: Request) {
    this.checkAuth(req);
    this.checkRateLimit(req);
    return {
      success: true,
      data: {
        playwright: await this.playwrightMcp.getAutomationStatus(),
        runtime: this.mcpRuntime.getStatus(),
      },
    };
  }

  @Get('tools')
  @Public()
  async listTools(@Req() req: Request) {
    this.checkAuth(req);
    this.checkRateLimit(req);
    return {
      success: true,
      data: {
        playwright: await this.playwrightMcp.listTools(),
      },
    };
  }
}
