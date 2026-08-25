import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { WorkspacesService } from './workspaces.service';
import { KaypalAuthGuard } from './kaypal-auth.guard';
import { AgentGatewayExceptionFilter } from './agent-gateway.filter';
import { TenantContext } from './core/types';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './workspaces.dto';

type CtxRequest = Request & { ctx?: TenantContext };

/**
 * 4.4 多工作区标签壳：Workspace CRUD 控制面（/api/workspaces/*）。
 * 身份由 KaypalAuthGuard 派生 ctx；所有查询以 ctx.tenantId+userId 限定归属。
 * 不存在/不归属统一 403（不泄露存在性）。
 */
@Controller('workspaces')
@UseGuards(KaypalAuthGuard)
@UseFilters(AgentGatewayExceptionFilter)
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  private ctx(req: CtxRequest): TenantContext {
    return req.ctx!;
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: CtxRequest, @Body() body: CreateWorkspaceDto) {
    return { workspace: await this.workspaces.create(this.ctx(req), body) };
  }

  @Get()
  async list(@Req() req: CtxRequest) {
    return { workspaces: await this.workspaces.list(this.ctx(req)) };
  }

  @Get(':id')
  async get(@Req() req: CtxRequest, @Param('id') id: string) {
    return { workspace: await this.workspaces.get(this.ctx(req), id) };
  }

  @Patch(':id')
  async update(
    @Req() req: CtxRequest,
    @Param('id') id: string,
    @Body() body: UpdateWorkspaceDto,
  ) {
    return { workspace: await this.workspaces.update(this.ctx(req), id, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: CtxRequest, @Param('id') id: string) {
    await this.workspaces.remove(this.ctx(req), id);
    return;
  }
}
