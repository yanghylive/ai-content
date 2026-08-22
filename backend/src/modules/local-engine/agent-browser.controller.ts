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
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
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
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  private getUserId(request: AuthRequest): string {
    return request.user?.id ?? 'local-user';
  }

  /** §7.4 请求租户（fail-closed：无上下文/无归属抛 403） */
  private async resolveTenantId(): Promise<string> {
    if (!this.authRequestContext) {
      throw new ForbiddenException('缺少租户上下文');
    }
    const prisma = (
      this.sessions as unknown as { prisma?: unknown }
    ).prisma as never;
    if (!prisma) {
      throw new ForbiddenException('缺少数据库租户上下文');
    }
    return await this.authRequestContext.resolveTenantId(prisma);
  }

  /** 创建会话（Profile/租约/域名白名单） */
  @Post('sessions')
  @HttpCode(201)
  async create(@Req() request: AuthRequest, @Body() body: CreateAgentBrowserSessionInput = {}) {
    const tenantId = await this.resolveTenantId();
    return this.sessions.create(this.getUserId(request), body, tenantId);
  }

  @Get('sessions')
  async list(@Req() request: AuthRequest) {
    const tenantId = await this.resolveTenantId();
    return this.sessions.list(this.getUserId(request), tenantId);
  }

  @Get('sessions/:id')
  async get(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  /** 运行：进入 Observe-Act-Verify 循环（P4-B 实现执行体） */
  @Post('sessions/:id/run')
  @HttpCode(202)
  async run(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Body()
    body: {
      instruction?: string;
      confirmedTools?: Array<{ action: string; target?: string; url?: string }>;
    } = {},
  ) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    // §7.4 状态机校验：终态（stopped/failed/cancelled）不可重跑
    const cur = this.sessions.get(id);
    if (['stopped', 'failed', 'cancelled'].includes(cur.status)) {
      throw new BadRequestException(
        `会话已处于终态 ${cur.status}，不能重新运行`,
      );
    }
    // 1. 懒创建引擎会话 + 置 running
    await this.sessions.updateStatus(id, 'created');
    await this.sessions.acquireEngineSession(id);
    // 2. 若有指令则跑一轮 Observe-Act-Verify（confirmedTools 放行需确认动作）
    if (body.instruction?.trim()) {
      const result = await this.loop.run(id, body.instruction, {
        confirmedTools: body.confirmedTools ?? [],
      });
      if (!result.ok) {
        this.sessions.markError(id, 'Agent 循环未完成任务');
      }
    }
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Post('sessions/:id/pause')
  @HttpCode(202)
  async pause(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    this.sessions.updateStatus(id, 'paused');
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Post('sessions/:id/resume')
  @HttpCode(202)
  async resume(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    this.sessions.updateStatus(id, 'running');
    return this.sessions.toPublicDto(this.sessions.get(id));
  }

  @Get('sessions/:id/events')
  async events(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    return this.sessions.listEvents(id);
  }

  @Post('sessions/:id/stop')
  @HttpCode(202)
  async stop(@Req() request: AuthRequest, @Param('id') id: string) {
    const tenantId = await this.resolveTenantId();
    this.sessions.assertOwner(id, this.getUserId(request), tenantId);
    await this.sessions.stop(id);
    return this.sessions.toPublicDto(this.sessions.get(id));
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