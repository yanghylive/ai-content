import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateIntelligenceReportDto } from './dto/create-intelligence-report.dto';
import { CreateIntelligenceMonitorDto } from './dto/create-intelligence-monitor.dto';
import { DispatchIntelligenceItemDto } from './dto/dispatch-intelligence-item.dto';
import { GenerateIntelligenceTopicDto } from './dto/generate-intelligence-topic.dto';
import { IngestRedfoxItemsDto } from './dto/ingest-redfox-items.dto';
import { ImportIntelligenceMaterialDto } from './dto/import-intelligence-material.dto';
import { ProcessIntelligenceDispatchRecordDto } from './dto/process-intelligence-dispatch-record.dto';
import { ProcessIntelligenceReportDto } from './dto/process-intelligence-report.dto';
import { QueryIntelligenceDispatchRecordsDto } from './dto/query-intelligence-dispatch-records.dto';
import { QueryIntelligenceItemsDto } from './dto/query-intelligence-items.dto';
import { QueryIntelligenceMonitorsDto } from './dto/query-intelligence-monitors.dto';
import { QueryIntelligenceOverviewDto } from './dto/query-intelligence-overview.dto';
import { QueryIntelligenceReportsDto } from './dto/query-intelligence-reports.dto';
import { RunIntelligenceSearchDto } from './dto/run-intelligence-search.dto';
import { RunIntelligenceMonitorsDto } from './dto/run-intelligence-monitors.dto';
import { UpdateIntelligenceMonitorDto } from './dto/update-intelligence-monitor.dto';
import { IntelligenceMonitorRunnerService } from './intelligence-monitor-runner.service';
import { IntelligenceService } from './intelligence.service';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('数据情报')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly intelligenceService: IntelligenceService,
    private readonly monitorRunner: IntelligenceMonitorRunnerService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '获取数据情报总览、最近情报、监控和 RedFox 摘要' })
  getOverview(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryIntelligenceOverviewDto,
  ) {
    return this.intelligenceService.getOverview(request.authUser, query);
  }

  @Get('items')
  @ApiOperation({ summary: '分页获取标准化情报条目' })
  listItems(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryIntelligenceItemsDto,
  ) {
    return this.intelligenceService.listItems(request.authUser, query);
  }

  @Get('monitors')
  @ApiOperation({ summary: '分页获取情报监控配置' })
  listMonitors(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryIntelligenceMonitorsDto,
  ) {
    return this.intelligenceService.listMonitors(request.authUser, query);
  }

  @Post('monitors')
  @ApiOperation({ summary: '创建情报监控配置' })
  createMonitor(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateIntelligenceMonitorDto,
  ) {
    return this.intelligenceService.createMonitor(request.authUser, dto);
  }

  @Post('monitors/run-due')
  @ApiOperation({ summary: '手动执行当前用户到期的情报监控' })
  runDueMonitors(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RunIntelligenceMonitorsDto = {},
  ) {
    return this.monitorRunner.runDueMonitors(request.authUser, dto);
  }

  @Post('search/redfox')
  @ApiOperation({ summary: '使用 RedFox 正式平台接口执行一次性情报搜索' })
  runSearch(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RunIntelligenceSearchDto,
  ) {
    return this.monitorRunner.runSearch(request.authUser, dto);
  }

  @Post('monitors/:id/run')
  @ApiOperation({ summary: '立即执行单条情报监控' })
  runMonitor(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.monitorRunner.runMonitor(request.authUser, id);
  }

  @Patch('monitors/:id')
  @ApiOperation({ summary: '更新情报监控配置' })
  updateMonitor(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateIntelligenceMonitorDto,
  ) {
    return this.intelligenceService.updateMonitor(request.authUser, id, dto);
  }

  @Delete('monitors/:id')
  @ApiOperation({ summary: '归档情报监控配置' })
  archiveMonitor(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.intelligenceService.archiveMonitor(request.authUser, id);
  }

  @Get('dispatches/:kind')
  @ApiOperation({ summary: '分页获取情报派发后的真实处理记录' })
  listDispatchRecords(
    @Req() request: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Query() query: QueryIntelligenceDispatchRecordsDto,
  ) {
    return this.intelligenceService.listDispatchRecords(
      request.authUser,
      kind,
      query,
    );
  }

  @Post('dispatches/:kind/:id/actions')
  @ApiOperation({ summary: '处理情报派发记录，例如审核、发布规则或转增长线索' })
  processDispatchRecord(
    @Req() request: AuthenticatedRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() dto: ProcessIntelligenceDispatchRecordDto,
  ) {
    return this.intelligenceService.processDispatchRecord(
      request.authUser,
      kind,
      id,
      dto,
    );
  }

  @Get('reports')
  @ApiOperation({ summary: '分页获取情报报告历史' })
  listReports(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryIntelligenceReportsDto,
  ) {
    return this.intelligenceService.listReports(request.authUser, query);
  }

  @Post('reports')
  @ApiOperation({ summary: '保存情报报告草稿或提交复核' })
  createReport(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateIntelligenceReportDto,
  ) {
    return this.intelligenceService.createReport(request.authUser, dto);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: '获取情报报告详情' })
  getReport(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.intelligenceService.getReport(request.authUser, id);
  }

  @Post('reports/:id/actions')
  @ApiOperation({ summary: '处理情报报告状态，例如提交复核、标记交付或归档' })
  processReport(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ProcessIntelligenceReportDto,
  ) {
    return this.intelligenceService.processReport(request.authUser, id, dto);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '获取标准化情报条目详情' })
  getItem(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.intelligenceService.getItem(request.authUser, id);
  }

  @Post('items/:id/import-material')
  @ApiOperation({ summary: '将标准化情报条目导入内容素材' })
  importMaterial(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ImportIntelligenceMaterialDto,
  ) {
    return this.intelligenceService.importItemToMaterial(
      request.authUser,
      id,
      dto,
    );
  }

  @Post('items/:id/generate-topic')
  @ApiOperation({ summary: '基于标准化情报条目生成选题草稿' })
  generateTopic(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: GenerateIntelligenceTopicDto,
  ) {
    return this.intelligenceService.generateTopicFromItem(
      request.authUser,
      id,
      dto,
    );
  }

  @Post('items/:id/dispatch')
  @ApiOperation({ summary: '将情报条目派发到风险、规则、对标或线索模块' })
  dispatchItem(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DispatchIntelligenceItemDto,
  ) {
    return this.intelligenceService.dispatchItem(request.authUser, id, dto);
  }

  @Post('redfox/items/ingest')
  @ApiOperation({ summary: '将 RedFox 原始结果标准化并写入情报条目' })
  ingestRedfoxItems(
    @Req() request: AuthenticatedRequest,
    @Body() dto: IngestRedfoxItemsDto,
  ) {
    return this.intelligenceService.ingestRedfoxItems(request.authUser, dto);
  }
}
