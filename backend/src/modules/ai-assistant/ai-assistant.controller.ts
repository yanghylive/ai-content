import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { AiAssistantNestService } from './ai-assistant.service';

type AuthRequest = Request & { authUser?: { id: string } };

@Controller('ai/assistant')
export class AiAssistantController {
  constructor(private readonly drafts: AiAssistantNestService) {}

  private getUserId(request: AuthRequest): string {
    // P0-1（审计 2026-08-22）：AuthGuard 写入 request.authUser，读 request.user 恒空
    // 回落 local-user 导致用户级隔离失效。无身份直接 401，禁止回落。
    const userId = request.authUser?.id?.trim();
    if (!userId) {
      throw new UnauthorizedException('请先登录');
    }
    return userId;
  }

  /** 创建任务草稿（NL -> 结构化草稿，不执行） */
  @Post('task-drafts')
  @HttpCode(201)
  createDraft(
    @Req() request: AuthRequest,
    @Body() body: { naturalLanguage: string },
  ) {
    return this.drafts.createDraft(this.getUserId(request), body);
  }

  @Get('task-drafts')
  listDrafts(@Req() request: AuthRequest, @Query('status') status?: string) {
    return this.drafts.listDrafts(this.getUserId(request), status);
  }

  @Get('task-drafts/:id')
  getDraft(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.drafts.getDraft(this.getUserId(request), id);
  }

  /** 确认草稿：记录操作者/租户/风险摘要/哈希/过期时间 */
  @Post('task-drafts/:id/confirm')
  confirmDraft(
    @Req() request: AuthRequest,
    @Param('id') id: string,
    @Body() body: { riskSummary?: string } = {},
  ) {
    return this.drafts.confirmDraft(this.getUserId(request), id, body);
  }

  /** 执行已确认草稿（走 GrowthService 统一风险门） */
  @Post('task-drafts/:id/execute')
  @HttpCode(201)
  executeDraft(@Req() request: AuthRequest, @Param('id') id: string) {
    return this.drafts.executeDraft(this.getUserId(request), id);
  }
}
