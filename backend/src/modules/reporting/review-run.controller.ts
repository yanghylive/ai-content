import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReviewRunService } from './review-run.service';
import { ReportQualityGateService } from './report-quality-gate.service';
import type { ReviewRunInput } from './review-run.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * 复盘报告端点（方案 10.3 报告动作 + 10.4 报表质量门）。
 *
 * 报告动作：复盘生成后可直接把动作落成内容计划、查询动作清单。
 * 报表质量门：报告生成前跑 5 项可信度检查（租户/重复/同步延迟/失败误计/主键关联）。
 */
@ApiTags('效果报告（复盘运行与质量门）')
@Controller('reporting/review-runs')
export class ReviewRunController {
  constructor(
    private readonly reviewRunService: ReviewRunService,
    private readonly qualityGate: ReportQualityGateService,
  ) {}

  private resolveOwner(request: AuthenticatedRequest) {
    const user = request.authUser;
    if (!user) throw new UnauthorizedException('请先登录');
    return {
      userId: user.id,
      tenantId: (user as { tenantId?: string }).tenantId ?? null,
      actorUserId: user.id,
    };
  }

  @Get('quality-gate')
  @ApiOperation({
    summary: '报表质量门：报告生成前的 5 项可信度检查（方案 10.4）',
  })
  runQualityGate(@Req() request: AuthenticatedRequest) {
    const owner = this.resolveOwner(request);
    return this.qualityGate.runGate(owner);
  }

  @Post()
  @ApiOperation({ summary: '生成复盘运行（存漏斗快照+洞察+动作）' })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Body() body: ReviewRunInput,
  ) {
    const owner = this.resolveOwner(request);
    // 10.4：生成前跑质量门，结果附在响应里（fail-closed：不阻断，但前端可见）
    const gate = await this.qualityGate.runGate(owner);
    const run = await this.reviewRunService.generate(body, owner);
    return { ...run, qualityGate: gate };
  }

  @Get()
  @ApiOperation({ summary: '复盘运行列表' })
  list(@Req() request: AuthenticatedRequest) {
    const owner = this.resolveOwner(request);
    return this.reviewRunService.list(owner);
  }

  @Get(':id')
  @ApiOperation({ summary: '复盘运行详情' })
  findOne(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const owner = this.resolveOwner(request);
    return this.reviewRunService.findOne(id, owner);
  }

  @Post(':id/actions/:actionIndex/copy-to-content-plan')
  @HttpCode(201)
  @ApiOperation({
    summary: '报告动作：把复盘动作复制为新内容计划（方案 10.3）',
  })
  copyActionToContentPlan(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('actionIndex') actionIndex: string,
  ) {
    const owner = this.resolveOwner(request);
    return this.reviewRunService.copyActionToContentPlan(
      id,
      Number(actionIndex),
      owner,
    );
  }
}
