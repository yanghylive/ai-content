import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { AiAuditService } from './ai-audit.service';

/**
 * AI 用量追踪（对标炼刀 /token + /token/rpa/use/pre_check + /token/rpa/use/report）
 *
 * - GET  /api/usage/token             今日 token 用量与额度
 * - POST /api/usage/token/pre-check   调用前预检（estimatedTokens）
 * - POST /api/usage/token/report      调用后上报实际消耗
 *
 * 与现有次数配额（chat/tool）同源：ai_usage_quotas 表按天汇总 + ai_tool_call_logs 明细。
 */
@Controller('usage/token')
export class AiAuditController {
  constructor(private readonly aiAudit: AiAuditService) {}

  private resolveUserId(@Req() request: Request): string {
    const user = (request as unknown as { authUser?: { id?: string } })
      .authUser;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录');
    }
    return userId;
  }

  /** 查今日 Token 用量与额度 */
  @Get()
  async getTokenQuota(@Req() request: Request) {
    const userId = this.resolveUserId(request);
    const quota = await this.aiAudit.getQuota(userId);
    // 返回裸数据，由 TransformInterceptor 统一包装 { success, data }
    return { scene: 'token', ...quota };
  }

  /** 调用前预检：预计消耗 estimatedTokens 是否在额度内 */
  @Post('pre-check')
  async preCheck(
    @Req() request: Request,
    @Body() body: { estimatedTokens?: number; scene?: string },
  ) {
    const userId = this.resolveUserId(request);
    const estimated = Math.max(Math.floor(body?.estimatedTokens ?? 0), 0);
    const result = await this.aiAudit.canUseTokens(userId, estimated);
    return {
      ok: result.ok,
      estimatedTokens: estimated,
      scene: body?.scene ?? 'unknown',
      quota: result.quota,
    };
  }

  /** 调用后上报实际消耗（幂等由调用方保证，明细写入 ai_tool_call_logs） */
  @Post('report')
  async report(
    @Req() request: Request,
    @Body()
    body: {
      tokens: number;
      tool?: string;
      scene?: string;
      refType?: string;
      refId?: string;
    },
  ) {
    const userId = this.resolveUserId(request);
    const tokens = Math.max(Math.floor(body?.tokens ?? 0), 0);
    await this.aiAudit.recordTokenUsage({
      userId,
      tokens,
      tool: body?.tool,
      scene: body?.scene,
      refType: body?.refType,
      refId: body?.refId,
    });
    const quota = await this.aiAudit.getQuota(userId);
    return { recordedTokens: tokens, quota };
  }

  /**
   * Token 经济看板（大王商业模式：只赚 token 钱）：
   * 近 N 天 token 消耗 + costPoints（token×20）收入口径 + 场景分布 + 每日趋势。
   * GET /usage/token/economy?days=7
   */
  @Get('economy')
  async economy(
    @Req() request: Request,
    @Query() query: Record<string, string>,
  ) {
    this.resolveUserId(request);
    const days = Math.min(Math.max(Number(query.days) || 7, 1), 90);
    return this.aiAudit.economySummary({ days });
  }
}
