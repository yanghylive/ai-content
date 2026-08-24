import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from './core/types';
import { makeError } from './contracts/error-codes';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './workspaces.dto';

/**
 * 4.4 多工作区标签壳 · Workspace 仓储服务。
 * 所有读/写均以 ctx.tenantId + ctx.userId 限定归属（服务端派生，永不可来自客户端）。
 * 不存在/不归属 → 统一 FORBIDDEN(403)（不泄露 workspace 是否存在，防枚举）。
 * 删除为软删除（status='archived'），列表与详情默认只返回 active。
 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 归属筛选：租户 + 用户（双维度，防跨用户访问） */
  private scope(ctx: TenantContext) {
    return { tenantId: ctx.tenantId, userId: ctx.userId };
  }

  async create(ctx: TenantContext, dto: CreateWorkspaceDto) {
    const name = dto.name.trim();
    if (!name) {
      throw makeError('NAMESPACE_INVALID', { details: { field: 'name', message: 'workspace 名称不能为空' } });
    }
    try {
      return await this.prisma.workspace.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          name,
          agentId: dto.agentId,
          settings: (dto.settings ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw makeError('DUPLICATE_REQUEST', { details: { name, message: '同名 workspace 已存在' } });
      }
      throw e;
    }
  }

  async list(ctx: TenantContext) {
    return this.prisma.workspace.findMany({
      where: { ...this.scope(ctx), status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 归属校验 + 取详情；不存在/不归属一律 403（不区分，防枚举） */
  async get(ctx: TenantContext, id: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: { id, ...this.scope(ctx), status: 'active' },
    });
    if (!ws) {
      throw makeError('FORBIDDEN', { details: { workspaceId: id, message: 'workspace 不存在或不属于当前用户' } });
    }
    return ws;
  }

  async update(ctx: TenantContext, id: string, dto: UpdateWorkspaceDto) {
    await this.get(ctx, id); // 归属校验（不存在/不归属即 403）
    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw makeError('NAMESPACE_INVALID', { details: { field: 'name', message: 'workspace 名称不能为空' } });
      }
      data.name = name;
    }
    if (dto.agentId !== undefined) data.agentId = dto.agentId;
    if (dto.settings !== undefined) data.settings = dto.settings as Prisma.InputJsonValue;
    return this.prisma.workspace.update({ where: { id }, data });
  }

  /** 软删除（status='archived'），保留数据用于审计/恢复 */
  async remove(ctx: TenantContext, id: string) {
    await this.get(ctx, id); // 归属校验
    return this.prisma.workspace.update({ where: { id }, data: { status: 'archived' } });
  }
}
