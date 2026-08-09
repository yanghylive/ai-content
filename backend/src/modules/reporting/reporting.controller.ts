import {
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReportingService } from './reporting.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('效果报告（AI 产出 ROI 看板）')
@Controller('reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

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
}
