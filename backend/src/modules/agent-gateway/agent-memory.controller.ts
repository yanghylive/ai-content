import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentGatewayService } from './agent-gateway.service';
import { KaypalAuthGuard } from './kaypal-auth.guard';
import { AgentGatewayExceptionFilter } from './agent-gateway.filter';
import { TenantContext } from './core/types';
import { MemorySearchDto, MemoryAddDto } from './agent-gateway.dto';

type CtxRequest = Request & { ctx?: TenantContext };

/**
 * Agent Gateway 记忆控制面（/api/memory/*，契约路径不带 agent 段）。
 * 与 /api/agent/* 同一引擎；同样鉴权与错误格式。
 */
@Controller('memory')
@UseGuards(KaypalAuthGuard)
@UseFilters(AgentGatewayExceptionFilter)
export class AgentMemoryController {
  constructor(private readonly agent: AgentGatewayService) {}

  private ctx(req: CtxRequest): TenantContext {
    return req.ctx!;
  }

  @Post('search')
  @HttpCode(200)
  async search(@Req() req: CtxRequest, @Body() body: MemorySearchDto) {
    const { items, degraded } = await this.agent.gateway.memorySearch(
      this.ctx(req),
      body?.scope ?? 'user_preference',
      body?.query ?? '',
    );
    return { items, degraded };
  }

  @Post('add')
  @HttpCode(202)
  async add(@Req() req: CtxRequest, @Body() body: MemoryAddDto) {
    const { memoryEventId, outboxId } = await this.agent.gateway.memoryAdd(
      this.ctx(req),
      body?.scope ?? 'user_preference',
      body.content,
      body?.source,
    );
    return { memoryEventId, outboxId };
  }

  @Delete(':id')
  async remove(
    @Req() req: CtxRequest,
    @Param('id') id: string,
    @Query('scope') scope?: string,
  ) {
    return this.agent.gateway.memoryDelete(this.ctx(req), id, scope);
  }
}
