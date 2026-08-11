import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ContentOptimizationService } from './content-optimization.service';
import { OutlineService } from './outline.service';
import {
  CreateContentVersionCommentDto,
  CreateContentVersionFeedbackDto,
  CreateContentDraftDto,
  CreatePublishIntentDto,
  MarkContentVersionComplianceDto,
  ManualReviewVersionDto,
  QueryContentVersionsDto,
  SaveContentVersionDto,
  SetOfficialVersionDto,
} from './dto/content-version.dto';
import { RewriteDto } from './dto/rewrite.dto';
import { TitleScoreDto } from './dto/title-score.dto';
import { XhsNoteOptimizeDto } from './dto/xhs-note-optimize.dto';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('创作优化')
@Controller('content-optimization')
export class ContentOptimizationController {
  constructor(
    private readonly contentOptimizationService: ContentOptimizationService,
    private readonly outlineService: OutlineService,
  ) {}

  // ---- §3 图文大纲流水线 ----

  @Post('outline')
  @ApiOperation({ summary: '一句话生成图文大纲（可编辑中间表示）' })
  async generateOutline(
    @Body() dto: { topic: string; pageCount?: number },
  ) {
    return this.outlineService.generateOutline(
      dto?.topic || '',
      dto?.pageCount,
    );
  }

  @Post('generate')
  @ApiOperation({ summary: '大纲生成图文（SSE 逐事件：progress/titles/page_done/complete）' })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Body() dto: { topic: string; outline: Array<Record<string, unknown>> },
  ) {
    const authUser = request.authUser;
    if (!authUser) throw new UnauthorizedException('请先登录');
    const outline = (dto?.outline || []).map((p) => ({
      type: (p.type as 'cover' | 'content' | 'summary') || 'content',
      title: typeof p.title === 'string' ? p.title : '',
      points: Array.isArray(p.points)
        ? p.points.map((x) => String(x))
        : [],
      imagePrompt:
        typeof p.imagePrompt === 'string' ? p.imagePrompt : undefined,
    }));
    await this.outlineService.generate(
      authUser,
      { topic: dto?.topic || '', outline },
      response,
    );
  }

  @Get('task/:id')
  @ApiOperation({ summary: '图文任务断点重放（已完成事件，不重复调 AI）' })
  getTask(@Param('id') id: string) {
    return this.outlineService.getTask(id);
  }

  @Post('title-score')
  @ApiOperation({ summary: '标题评分与优化建议' })
  scoreTitle(@Body() dto: TitleScoreDto) {
    return this.contentOptimizationService.scoreTitle(dto);
  }

  @Post('rewrite')
  @ApiOperation({ summary: '多平台文案改写' })
  rewrite(@Body() dto: RewriteDto) {
    return this.contentOptimizationService.rewrite(dto);
  }

  @Post('xhs-note-optimize')
  @ApiOperation({ summary: '小红书笔记优化' })
  optimizeXhsNote(@Body() dto: XhsNoteOptimizeDto) {
    return this.contentOptimizationService.optimizeXhsNote(dto);
  }

  @Post('drafts')
  @ApiOperation({ summary: '创建待优化草稿' })
  createDraft(@Body() dto: CreateContentDraftDto) {
    return this.contentOptimizationService.createDraft(dto);
  }

  @Get('drafts/:id')
  @ApiOperation({ summary: '获取待优化草稿' })
  getDraft(@Param('id') id: string) {
    return this.contentOptimizationService.getDraft(id);
  }

  @Get('versions')
  @ApiOperation({ summary: '获取优化版本列表' })
  listVersions(@Query() query: QueryContentVersionsDto) {
    return this.contentOptimizationService.listVersions(query);
  }

  @Get('versions/:id')
  @ApiOperation({ summary: '获取优化版本详情' })
  getVersion(@Param('id') id: string) {
    return this.contentOptimizationService.getVersion(id);
  }

  @Post('versions')
  @ApiOperation({ summary: '保存优化版本' })
  saveVersion(@Body() dto: SaveContentVersionDto) {
    return this.contentOptimizationService.saveVersion(dto);
  }

  @Post('versions/:id/official')
  @ApiOperation({ summary: '设为正式稿' })
  setOfficialVersion(
    @Param('id') id: string,
    @Body() dto: SetOfficialVersionDto,
  ) {
    return this.contentOptimizationService.setOfficialVersion(id, dto);
  }

  @Post('versions/:id/compliance')
  @ApiOperation({ summary: '写回版本合规检查结果' })
  async markVersionCompliance(
    @Param('id') id: string,
    @Body() dto: MarkContentVersionComplianceDto,
  ) {
    await this.contentOptimizationService.markVersionCompliance({
      versionId: id,
      checkId: dto.checkId,
      riskLevel: dto.riskLevel,
      riskScore: dto.riskScore,
      summary: dto.summary,
      checkedAt: dto.checkedAt,
    });
    return this.contentOptimizationService.getVersion(id);
  }

  @Post('versions/:id/manual-review')
  @ApiOperation({ summary: '负责人复核版本' })
  manualReviewVersion(
    @Param('id') id: string,
    @Body() dto: ManualReviewVersionDto,
  ) {
    return this.contentOptimizationService.manualReviewVersion(id, dto);
  }

  @Get('versions/:id/diff')
  @ApiOperation({ summary: '获取版本差异摘要' })
  getVersionDiff(@Param('id') id: string) {
    return this.contentOptimizationService.getVersionDiff(id);
  }

  @Get('versions/:id/feedback')
  @ApiOperation({ summary: '获取版本发布复盘' })
  listVersionFeedback(@Param('id') id: string) {
    return this.contentOptimizationService.listVersionFeedback(id);
  }

  @Post('versions/:id/feedback')
  @ApiOperation({ summary: '记录版本发布复盘' })
  createVersionFeedback(
    @Param('id') id: string,
    @Body() dto: CreateContentVersionFeedbackDto,
  ) {
    return this.contentOptimizationService.createVersionFeedback(id, dto);
  }

  @Get('versions/:id/comments')
  @ApiOperation({ summary: '获取版本协作备注' })
  listVersionComments(@Param('id') id: string) {
    return this.contentOptimizationService.listVersionComments(id);
  }

  @Post('versions/:id/comments')
  @ApiOperation({ summary: '记录版本协作备注' })
  createVersionComment(
    @Param('id') id: string,
    @Body() dto: CreateContentVersionCommentDto,
  ) {
    return this.contentOptimizationService.createVersionComment(id, dto);
  }

  @Post('publish-intents')
  @ApiOperation({ summary: '创建发布准备任务' })
  createPublishIntent(@Body() dto: CreatePublishIntentDto) {
    return this.contentOptimizationService.createPublishIntent(dto);
  }

  @Get('publish-intents/:id')
  @ApiOperation({ summary: '获取发布准备快照' })
  getPublishIntent(@Param('id') id: string) {
    return this.contentOptimizationService.getPublishIntent(id);
  }
}
