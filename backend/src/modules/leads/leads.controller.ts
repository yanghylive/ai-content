import {
  Body,
  Controller,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadConvertService } from './lead-convert.service';
import { KeywordIntelligenceService } from '../lead-intelligence/keyword-intelligence.service';

/**
 * 统一线索端点（报告 6.3 节 P0：原子转客户）。
 * 鉴权走全局 guard + resolveTenantId（复用现有机制）。
 */
@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly convertService: LeadConvertService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly prisma: PrismaService,
    private readonly keywordIntelligence: KeywordIntelligenceService,
  ) {}

  @Post(':leadId/convert')
  @ApiOperation({
    summary:
      '原子转 CRM：事务内 锁定线索 → 解析身份 → 建客户/公司/商机/任务/备注 → 写 timeline → 更新线索 → 写 outbox',
  })
  async convert(
    @Param('leadId') leadId: string,
    @Body()
    body: {
      idempotencyKey?: string;
      company?: Record<string, unknown>;
      opportunity?: Record<string, unknown>;
      task?: Record<string, unknown>;
      note?: Record<string, unknown>;
    },
  ) {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后转客户');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return this.convertService.convert({
      leadId,
      idempotencyKey: body?.idempotencyKey,
      scope: { userId, tenantId },
      // Sprint 4 T4.1：一步建商机/任务/备注（可选）
      company: body?.company ? (body.company as never) : undefined,
      opportunity: body?.opportunity ? body.opportunity : undefined,
      task: body?.task ? (body.task as never) : undefined,
      note: body?.note ? (body.note as never) : undefined,
    });
  }

  @Post('keyword-suggestions')
  @ApiOperation({
    summary:
      '关键词智能建议：rule（C-a 词库命中统计，默认）/ llm（C-b 语义归纳造新词，失败回落 rule）。产出 source/demand/exclude 三类建议 + 证据归因，供人工采纳写回策略',
  })
  async keywordSuggestions(
    @Body()
    body: {
      platform?: string;
      industry?: string;
      windowDays?: number;
      minLeadCount?: number;
      /** 生成模式：rule（规则版，默认）| llm（LLM 语义归纳） */
      mode?: 'rule' | 'llm';
    },
  ) {
    const context = this.authRequestContext.get();
    const userId = context?.user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后生成关键词建议');
    }
    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);

    const base = {
      userId,
      tenantId,
      platform: body?.platform,
      industry: body?.industry,
      windowDays: body?.windowDays,
      minLeadCount: body?.minLeadCount,
    };

    if (body?.mode === 'llm') {
      return this.keywordIntelligence.suggestKeywordsWithLLM(base);
    }
    return this.keywordIntelligence.suggestKeywords(base);
  }
}
