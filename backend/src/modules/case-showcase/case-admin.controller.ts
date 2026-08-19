import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RequireKaypalRoles } from '../auth/roles.decorator';
import { CaseAdminService } from './case-admin.service';
import {
  CaseAdminInputDto,
  ReviewCaseDto,
  SetFeaturedDto,
  UnpublishCaseDto,
} from './dto/case-admin.dto';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

/**
 * 后台案例管理 API（M6 · PRD §9.13 审核 + §9.1 精选位 + 审计）。
 *
 * 复用全局 AuthGuard + @RequireKaypalRoles 鉴权（仅 admin/owner），
 * 提供案例 CRUD、提交审核、审核决策、精选位排序、审计查询。
 * 公开响应不经本控制器（公开端走 CaseShowcaseController + 白名单）。
 */
@ApiTags('case-showcase-admin')
@RequireKaypalRoles('admin', 'owner')
@Controller('admin')
export class CaseAdminController {
  constructor(private readonly admin: CaseAdminService) {}

  @Get('cases')
  @ApiOperation({ summary: '后台案例列表（含草稿/审核中，全字段）' })
  async listCases() {
    return this.admin.listCases();
  }

  @Post('cases/validate')
  @ApiOperation({ summary: '表单完整性提示（复用发布校验规则子集）' })
  async validateCompleteness(@Body() dto: CaseAdminInputDto) {
    const hints = this.admin.completenessHints(dto);
    return { complete: hints.length === 0, hints };
  }

  @Post('cases')
  @ApiOperation({ summary: '新建案例（草稿）' })
  async createCase(
    @Body() dto: CaseAdminInputDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.createCase(dto, request.authUser?.id);
  }

  @Get('cases/:id')
  @ApiOperation({ summary: '后台案例详情（含内部字段，供编辑）' })
  async getCase(@Param('id') id: string) {
    return this.admin.getCase(id);
  }

  @Put('cases/:id')
  @ApiOperation({ summary: '更新案例（保留草稿状态）' })
  async updateCase(@Param('id') id: string, @Body() dto: CaseAdminInputDto) {
    return this.admin.updateCase(id, dto);
  }

  @Post('cases/:id/submit')
  @ApiOperation({ summary: '提交审核（draft → submitted）' })
  async submitForReview(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.submitForReview(id, request.authUser?.id);
  }

  @Post('cases/:id/review')
  @ApiOperation({ summary: '审核决策（批准/驳回/要求修改）' })
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewCaseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.review(id, dto, request.authUser?.id);
  }

  @Post('cases/:id/publish')
  @ApiOperation({ summary: '发布案例（approved → published）' })
  async publish(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.admin.publishCase(id, request.authUser?.id);
  }

  @Post('cases/:id/unpublish')
  @ApiOperation({
    summary: '紧急下线案例（published → unpublished，必填原因）',
  })
  async unpublish(
    @Param('id') id: string,
    @Body() dto: UnpublishCaseDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.unpublishCase(id, dto.reason, request.authUser?.id);
  }

  @Get('case-audit')
  @ApiOperation({ summary: '审计查询：审核记录 + 状态变更' })
  async getAudit(@Query('limit') limit?: string) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.admin.getAudit(Number.isFinite(parsed) ? parsed : 100);
  }

  @Get('featured')
  @ApiOperation({ summary: '当前精选位（有序）' })
  async getFeatured() {
    return this.admin.getFeatured();
  }

  @Put('featured')
  @ApiOperation({ summary: '设置精选位（有序覆盖）' })
  async setFeatured(@Body() dto: SetFeaturedDto) {
    return this.admin.setFeatured(dto.caseIds);
  }
}
