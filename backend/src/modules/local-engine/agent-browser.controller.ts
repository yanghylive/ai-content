import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentBrowserSessionService } from './agent-browser-session.service';
import { AgentBrowserPolicyService } from './agent-browser-policy.service';
import { AgentBrowserLoopService } from './agent-browser-loop.service';
import type { CreateAgentBrowserSessionInput } from './agent-browser.types';

type AuthRequest = Request & { user?: { id: string } };

/**
 * P4 Agent Browser 接口（文档 §7.4）。
 * 命名空间：/local-engine/agent-browser/*
 * 通用网页 agent（general-web），不碰社媒登录态。
 */
@Controller('local-engine/agent-browser')
export class AgentBrowserController {
  constructor(
    private readonly sessions: AgentBrowserSessionService,
    private readonly policy: AgentBrowserPolicyService,
    private readonly loop: AgentBrowserLoopService,
  ) {}

  private getUserId(request: AuthRequest): string {
    return request.user?.id ?? 'local-user';
  }

  /** 创建会话（Profile/租约/域名白名单） */
  @Post('sessions')
  @HttpCode(201)
  create(@Req() request: AuthRequest, @Body() body: CreateAgentBrowserSessionInput = {}) {
    return this.sessions.create(this.getUserId(request), body);
  }

  @Get('sessions')
  list(@Req() request: AuthRequest) {
    return this.sessions.list(this.getUserId(request));
  }

  @Get('sessions/:id')
  get(@Req() request: AuthRequest, @Param('id') id: string) {
    this.sessions.assertOwner(id, this.getUserId(request));
    return this.sessions.get(id);
  }

  /** 运行：进入 Observe-Act-Verify 循环（P4-B 实现执行体） */
  @Post('sessions/:id/run')
  @HttpCode(202)
  async run(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Body() body: { instruction?: string } = {},
  ) {
    this.sessions.assertOwner(id, this.getUserId(request));
    // 1. 懒创建引擎会话 + 置 running
    await this.sessions.updateStatus(id, 'created');
    await this.sessions.acquireEngineSession(id);
    // 2. 若有指令则跑一轮 Observe-Act-Verify
    if (body.instruction?.trim()) {
      const result = await this.loop.run(id, body.instruction);
      if (!result.ok) {
        this.sessions.markError(id, 'Agent 循环未完成任务');
      }
    }
    return this.sessions.get(id);
  }

  @Post('sessions/:id/pause')
  @HttpCode(202)
  pause(@Req() request: AuthRequest, @Param('id') id: string) {
    this.sessions.assertOwner(id, this.getUserId(request));
    this.sessions.updateStatus(id, 'paused');
    return this.sessions.get(id);
  }

  @Post('sessions/:id/resume')
  @HttpCode(202)
  resume(@Req() request: AuthRequest, @Param('id') id: string) {
    this.sessions.assertOwner(id, this.getUserId(request));
    this.sessions.updateStatus(id, 'running');
    return this.sessions.get(id);
  }

  @Get('sessions/:id/events')
  events(@Req() request: AuthRequest, @Param('id') id: string) {
    this.sessions.assertOwner(id, this.getUserId(request));
    return this.sessions.listEvents(id);
  }

  @Post('sessions/:id/stop')
  @HttpCode(202)
  async stop(@Req() request: AuthRequest, @Param('id') id: string) {
    this.sessions.assertOwner(id, this.getUserId(request));
    await this.sessions.stop(id);
    return this.sessions.get(id);
  }

  /** 策略审计（供前端预检/调试） */
  @Post('policy/audit')
  audit(
    @Param() _unused: undefined,
    @Body() body: { tool: string; args?: Record<string, unknown>; url?: string; allowDomains?: string[] },
  ) {
    this.policy.assertToolAllowed(body.tool);
    return this.policy.audit(body.tool as never, body.args ?? {}, {
      url: body.url,
      allowDomains: body.allowDomains ?? [],
    });
  }

  // P4-C：@Get('sessions/:id/events') SSE 事件流
}