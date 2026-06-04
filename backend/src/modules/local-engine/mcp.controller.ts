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

import { All, Body, Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PlaywrightMcpService } from './playwright-mcp.service';
import { McpRuntimeService } from './mcp-runtime.service';
import { Public } from '../auth/auth.decorator';

// MCP 端点公开: 任何 MCP 客户端 (Claude/Cursor/Agent-S/自家 worker) 都能调
// 安全模型: MCP server 只暴露浏览器操作 (playwright), 不暴露系统调用
@Controller('mcp')
@Public()
export class McpController {
  constructor(
    private readonly playwrightMcp: PlaywrightMcpService,
    private readonly mcpRuntime: McpRuntimeService,
  ) {}

  /**
   * 兼容 streamable-HTTP transport 的 MCP JSON-RPC 端点
   * 同时支持 GET (SSE) 和 POST (JSON-RPC) - SDK 内部按 method 分发
   * Body 由 NestJS body parser 中间件解析后通过 @Body() 注入
   */
  @All('playwright')
  async handlePlaywrightMcp(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.playwrightMcp.handleRequest(req, res);
  }

  @Get('status')
  async getStatus() {
    return {
      success: true,
      data: {
        playwright: this.playwrightMcp.getStatus(),
        runtime: await this.mcpRuntime.getStatus(),
      },
    };
  }

  @Get('tools')
  async listTools() {
    return {
      success: true,
      data: {
        playwright: await this.playwrightMcp.listTools(),
      },
    };
  }
}
