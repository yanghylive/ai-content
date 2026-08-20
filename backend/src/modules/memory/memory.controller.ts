import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { MemoryService } from './memory.service';
import { KaypalMemoryService } from './memory-kaypal.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('记忆层（AI 助手记忆管理）')
@Controller('memory')
export class MemoryController {
  constructor(
    private readonly memory: MemoryService,
    @Optional() private readonly kaypalMemory?: KaypalMemoryService,
  ) {}

  @Get()
  @ApiOperation({ summary: '列出当前用户全部记忆（按优先级）' })
  async list(@Req() request: AuthenticatedRequest) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const items = await this.memory.listForUser(user.id);
    const grouped = {
      persona: items.filter((i) => i.type === 'persona'),
      episodic: items.filter((i) => i.type === 'episodic'),
      instruction: items.filter((i) => i.type === 'instruction'),
    };
    return { items, grouped, total: items.length };
  }

  @Get('kaypal')
  @ApiOperation({ summary: '检索 kaypal 长期记忆（AI 记得你上次，获客表单预填用）' })
  async kaypalSearch(
    @Req() request: AuthenticatedRequest,
    @Query('query') query?: string,
    @Query('tier') tier?: string,
    @Query('limit') limit?: string,
  ) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    if (!this.kaypalMemory) return { ok: false, items: [] };
    const items = await this.kaypalMemory.search(
      query || '',
      (tier as 'short' | 'daily' | 'long') || 'long',
      limit ? Math.min(Number(limit) || 5, 20) : 5,
    );
    return { ok: true, items };
  }

  @Post('persona')
  @ApiOperation({ summary: '写入用户行业画像（onboarding 引导用）' })
  async savePersona(
    @Req() request: AuthenticatedRequest,
    @Body() input: { industry: string },
  ) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const industry = (input.industry || '').trim();
    if (!industry) throw new BadRequestException('请提供行业');
    await this.memory.savePersona(user.id, industry);
    return { ok: true, industry };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除单条记忆' })
  async remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const ok = await this.memory.removeForUser(user.id, id);
    return { ok, removed: ok ? 1 : 0 };
  }

  @Delete()
  @ApiOperation({ summary: '清除当前用户全部记忆' })
  async clear(@Req() request: AuthenticatedRequest) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const count = await this.memory.clearForUser(user.id);
    return { ok: true, cleared: count };
  }
}
