import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';

@ApiTags('数据统计')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: '获取核心指标统计' })
  getStats() {
    return this.service.getStats();
  }

  @Get('content-attribution/:articleId')
  @ApiOperation({ summary: '内容归因链：发布记录 + 互动任务（阶段 B）' })
  getContentAttribution(@Param('articleId') articleId: string) {
    return this.service.resolveContentAttribution(articleId);
  }

  @Get('task-center')
  @ApiOperation({ summary: '统一任务中心：聚合各模块任务（报告 16.3 第 14 项）' })
  getTaskCenter(@Query('limit') limit?: number) {
    return this.service.unifiedTaskCenter(limit ? Number(limit) : 50);
  }

  @Get('system-logs')
  @ApiOperation({ summary: '获取最新系统运行日志' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '限制条数',
    example: 50,
  })
  getSystemLogs(@Query('limit') limit?: number) {
    return this.service.getSystemLogs(limit ? Number(limit) : 50);
  }

  @Get('risk-audit-evidence')
  @ApiOperation({ summary: '获取风险审计证据索引' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '限制条数',
    example: 50,
  })
  getRiskAuditEvidence(@Query('limit') limit?: number) {
    return this.service.getRiskAuditEvidence(limit ? Number(limit) : 50);
  }

  @Get('collection-trends')
  @ApiOperation({ summary: '获取采集趋势数据' })
  @ApiQuery({ name: 'days', required: false, description: '天数', example: 7 })
  getCollectionTrends(@Query('days') days?: number) {
    return this.service.getCollectionTrends(days || 7);
  }

  @Get('creation-trends')
  @ApiOperation({ summary: '获取创作趋势数据' })
  @ApiQuery({ name: 'days', required: false, description: '天数', example: 7 })
  getCreationTrends(@Query('days') days?: number) {
    return this.service.getCreationTrends(days || 7);
  }

  @Get('keyword-matrix')
  @ApiOperation({ summary: '获取关键词分析矩阵 (高分风向词 vs 抓取热词)' })
  getKeywordMatrix() {
    return this.service.getKeywordMatrix();
  }

  @Get('draft-articles')
  @ApiOperation({ summary: '获取最新待发布草稿' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: '限制条数',
    example: 50,
  })
  @ApiQuery({
    name: 'keyword',
    required: false,
    description: '标题关键词筛选',
  })
  getDraftArticles(
    @Query('limit') limit?: number,
    @Query('keyword') keyword?: string,
  ) {
    return this.service.getLatestDraftArticles(
      limit ? Number(limit) : 50,
      keyword?.trim() || undefined,
    );
  }
}
