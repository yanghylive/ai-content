import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReportingService } from './reporting.service';
import { FunnelReportService } from './funnel-report.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('效果报告（AI 产出 ROI 看板）')
@Controller('reporting')
export class ReportingController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly funnelReport: FunnelReportService,
  ) {}

  @Get('effects')
  @ApiOperation({ summary: '效果报告：AI 生成/发布/曝光/互动（7/30 天）' })
  getEffects(
    @Req() request: AuthenticatedRequest,
    @Query('range') range?: string,
  ) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const r = range === '30d' ? '30d' : '7d';
    return this.reporting.report(user, r);
  }

  @Get('funnel')
  @ApiOperation({
    summary: '六步漏斗（内容→发布→互动→线索→客户→商机，近 N 天）',
  })
  getFunnel(
    @Req() request: AuthenticatedRequest,
    @Query('days') days?: string,
  ) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const d = Math.min(30, Math.max(1, Number(days) || 7));
    const tenantId = (user as AuthenticatedUser & { tenantId?: string })
      .tenantId;
    return this.funnelReport.funnel(d, user.id, tenantId ?? null);
  }

  @Get('content/:articleId')
  @ApiOperation({
    summary: '按文章六步漏斗（该内容带来多少发布/互动/线索/客户/商机）',
  })
  getContentFunnel(
    @Req() request: AuthenticatedRequest,
    @Param('articleId') articleId: string,
  ) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    const tenantId = (user as AuthenticatedUser & { tenantId?: string })
      .tenantId;
    return this.funnelReport.articleFunnel(
      articleId,
      user.id,
      tenantId ?? null,
    );
  }
}
