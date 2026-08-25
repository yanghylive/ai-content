import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AgentGatewayService } from './agent-gateway.service';
import { KaypalAuthGuard } from './kaypal-auth.guard';
import { AgentGatewayExceptionFilter } from './agent-gateway.filter';
import { TenantContext, ToolRequest } from './core/types';
import {
  CreateSessionDto,
  ResumeSessionDto,
  CreateTaskDto,
  ApproveTaskDto,
  ExecuteToolDto,
  TokenExchangeDto,
} from './agent-gateway.dto';
import { makeError } from './contracts/error-codes';
import { genId } from './core/util';

type CtxRequest = Request & { ctx?: TenantContext };

/**
 * 3010×Octop Agent Gateway REST 控制面（首批接线，/api/agent/*）。
 * 实现 docs/contracts/agent.openapi.yaml 冻结接口；全局前缀 api。
 * 身份：KaypalAuthGuard（HMAC 签名令牌）；错误：统一转 HttpException 走全局 filter。
 */
@Controller('agent')
@UseGuards(KaypalAuthGuard)
@UseFilters(AgentGatewayExceptionFilter)
export class AgentGatewayController {
  constructor(private readonly agent: AgentGatewayService) {}

  private ctx(req: CtxRequest): TenantContext {
    return req.ctx!;
  }

  // ---------------------------------------------------------------- 会话
  @Post('sessions')
  async createSession(@Req() req: CtxRequest, @Body() body: CreateSessionDto) {
    const session = await this.agent.gateway.createSession(
      this.ctx(req),
      body?.mode ?? 'business',
    );
    return { session };
  }

  @Post('sessions/:id/resume')
  @HttpCode(200)
  async resumeSession(
    @Req() req: CtxRequest,
    @Param('id') id: string,
    @Body() body: ResumeSessionDto,
  ) {
    const { session, events } = this.agent.gateway.resumeSession(
      id,
      this.ctx(req),
      body?.lastEventId,
    );
    return {
      session,
      lastEventId: events[events.length - 1]?.eventId ?? session.lastEventId,
      events,
    };
  }

  // ---------------------------------------------------------------- 任务
  @Post('tasks')
  @HttpCode(202)
  async createTask(@Req() req: CtxRequest, @Body() body: CreateTaskDto) {
    const task = this.agent.gateway.createTask(
      this.ctx(req),
      body.sessionId,
      body.type,
      body.plan ?? {},
    );
    return { taskId: task.id, task };
  }

  @Post('tasks/:id/approve')
  @HttpCode(202)
  async approveTask(
    @Req() req: CtxRequest,
    @Param('id') id: string,
    @Body() body: ApproveTaskDto,
  ) {
    const result = await this.agent.gateway.approveTask(
      this.ctx(req),
      id,
      body.approvalId,
      body.currentPreview,
    );
    return { result };
  }

  @Post('tasks/:id/pause')
  @HttpCode(202)
  async pauseTask(@Req() req: CtxRequest, @Param('id') id: string) {
    const task = this.agent.gateway.pauseTask(this.ctx(req), id);
    return { status: task.status };
  }

  @Post('tasks/:id/resume')
  @HttpCode(202)
  async resumeTask(@Req() req: CtxRequest, @Param('id') id: string) {
    const result = await this.agent.gateway.resumeTask(this.ctx(req), id);
    return { result };
  }

  @Post('tasks/:id/cancel')
  @HttpCode(202)
  async cancelTask(@Req() req: CtxRequest, @Param('id') id: string) {
    const task = this.agent.gateway.cancelTask(this.ctx(req), id);
    return { status: task.status };
  }

  // ---------------------------------------------------------------- 工具
  @Post('tools/:name')
  async executeTool(
    @Req() req: CtxRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('name') name: string,
    @Headers('Idempotency-Key') idemHeader: string | undefined,
    @Body() body: ExecuteToolDto,
  ) {
    const ctx = this.ctx(req);
    const spec = this.agent.registry.get(name);
    // P0-14：高风险写请求强制 Idempotency-Key
    const highRisk = spec
      ? spec.risk === 'high' || spec.requiresConfirmation
      : false;
    let idemKey = idemHeader ?? body?.idempotencyKey;
    if (highRisk && !idemKey) {
      throw makeError('IDEMPOTENCY_KEY_REQUIRED', {
        details: { toolName: name },
      });
    }
    if (!idemKey) idemKey = `auto:${name}:${genId('k')}`;

    const request: ToolRequest = {
      requestId: body?.requestId ?? genId('req'),
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      agentId: ctx.agentId,
      workspaceId: ctx.workspaceId,
      sessionId: body.sessionId,
      taskId: body.taskId,
      idempotencyKey: idemKey,
      toolName: name,
      requiresConfirmation: false,
      payload: body?.payload ?? {},
    };
    const outcome = await this.agent.gateway.executeTool(ctx, request);
    if (outcome.kind === 'awaiting_approval') {
      res.status(202);
      return {
        status: 'awaiting_confirmation',
        approvalId: outcome.approvalId,
        taskId: outcome.taskId,
      };
    }
    res.status(200);
    return { result: outcome.result };
  }

  // ---------------------------------------------------------------- Octop 高级模式
  @Post('octop/session')
  async octopSession(@Req() req: CtxRequest) {
    return this.agent.gateway.createOctopSession(this.ctx(req));
  }

  @Post('octop/token-exchange')
  @HttpCode(200)
  async octopTokenExchange(
    @Req() req: CtxRequest,
    @Body() body: TokenExchangeDto,
  ) {
    return this.agent.gateway.tokenExchange(this.ctx(req), body.sessionId);
  }

  @Get('octop/capabilities')
  async capabilities() {
    // 审计 #10：改为先 await 真实适配器 healthy() 探活，再返回，避免过期缓存
    return { capabilities: await this.agent.gateway.refreshCapabilities() };
  }
}
