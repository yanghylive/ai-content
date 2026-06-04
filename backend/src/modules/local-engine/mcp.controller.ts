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
@Controller('mcp')
export class McpController {
  constructor(
    private readonly playwrightMcp: PlaywrightMcpService,
    private readonly mcpRuntime: McpRuntimeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 本机访问绕过 (loopback IPv4/IPv6) 允许 dev 直连
   * 远程必须带 X-Kaypal-Mcp-Token: <KAYPAL_MCP_TOKEN>
   */
  private checkAuth(req: Request): void {
    const remote = req.ip || req.socket.remoteAddress || '';
    const isLoopback =
      remote === '127.0.0.1' ||
      remote === '::1' ||
      remote === '::ffff:127.0.0.1' ||
      remote === 'localhost';
    if (isLoopback) return;
    const expected = this.config.get<string>('KAYPAL_MCP_TOKEN') || '';
    if (!expected) {
      throw new HttpException(
        'MCP token not configured (set KAYPAL_MCP_TOKEN env)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const got = req.headers['x-kaypal-mcp-token'];
    if (got !== expected) {
      throw new HttpException('Invalid MCP token', HttpStatus.UNAUTHORIZED);
    }
  }

  @All('playwright')
  @Public()
  async handlePlaywrightMcp(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.checkAuth(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unauthorized';
      res.status(401).json({
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
    return {
      success: true,
      data: {
        playwright: this.playwrightMcp.getStatus(),
        runtime: await this.mcpRuntime.getStatus(),
      },
    };
  }

  @Get('tools')
  @Public()
  async listTools(@Req() req: Request) {
    this.checkAuth(req);
    return {
      success: true,
      data: {
        playwright: await this.playwrightMcp.listTools(),
      },
    };
  }
}
