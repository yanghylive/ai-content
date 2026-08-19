import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { QueryRedfoxCallLogsDto } from './dto/query-redfox-call-logs.dto';
import { QueryRedfoxInterfacesDto } from './dto/query-redfox-interfaces.dto';
import { QueryRedfoxSkillsDto } from './dto/query-redfox-skills.dto';
import { RunRedfoxSkillDto } from './dto/run-redfox-skill.dto';
import { SaveRedfoxConnectionDto } from './dto/save-redfox-connection.dto';
import { SyncRedfoxInterfacesDto } from './dto/sync-redfox-interfaces.dto';
import { SyncRedfoxSkillsDto } from './dto/sync-redfox-skills.dto';
import { UpdateRedfoxSkillDto } from './dto/update-redfox-skill.dto';
import { RedfoxService } from './redfox.service';
import { RedfoxHotTopicsService } from './redfox-hot-topics.service';
import { RedfoxComplianceService } from './redfox-compliance.service';
import { RedfoxRadarService } from './redfox-radar.service';
import { RedfoxCollectService } from './redfox-collect.service';
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';
import { RedfoxAccountService } from './redfox-account.service';
import { RedfoxVideoService } from './redfox-video.service';
import { RedfoxPlatformService } from './redfox-platform.service';
import { findRedfoxSkill } from './redfox-skill-catalog';

type AuthenticatedRequest = Request & { authUser?: AuthenticatedUser };

@ApiTags('RedFox 数据情报连接器')
@Controller('redfox')
export class RedfoxController {
  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly redfoxSkillRunner: RedfoxSkillRunnerService,
    private readonly hotTopics: RedfoxHotTopicsService,
    private readonly compliance: RedfoxComplianceService,
    private readonly radar: RedfoxRadarService,
    private readonly collect: RedfoxCollectService,
    private readonly account: RedfoxAccountService,
    private readonly video: RedfoxVideoService,
    private readonly platform: RedfoxPlatformService,
  ) {}

  /** 发布前合规体检：RedFox 多平台违禁词检测 */
  @Post('check/prohibited')
  async checkProhibited(
    @Req() request: AuthenticatedRequest,
    @Body() input: { text: string; platforms?: string[] },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    if (!input?.text || !input.text.trim()) {
      throw new BadRequestException('需要提供待检测文案（text）');
    }
    return this.compliance.checkProhibited(request.authUser, {
      text: input.text,
      platforms: input.platforms,
    });
  }

  /** 竞品雷达：RedFox 抖音账号搜索（按关键词，30 分钟缓存） */
  /** 从分享链接去水印采集素材（短视频/图文 → 素材库） */
  @Post('collect/link')
  async collectFromLink(
    @Req() request: AuthenticatedRequest,
    @Body() input: { url: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    if (!input?.url?.trim()) {
      throw new BadRequestException('请提供作品链接');
    }
    return this.collect.collectFromLink(request.authUser, input);
  }

  /** AI 生图（image2-GPT → 素材库） */
  @Post('image/gen')
  async generateImage(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; size?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    if (!input?.prompt?.trim()) {
      throw new BadRequestException('请提供生图描述（prompt）');
    }
    return this.collect.generateImage(request.authUser, input);
  }

  /** D5 爆款拆解：作品链接 → 数据 + AI 策略拆解 */
  @Post('viral/analyze')
  async viralAnalyze(
    @Req() request: AuthenticatedRequest,
    @Body() input: { url: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    if (!input?.url?.trim()) {
      throw new BadRequestException('请提供爆款作品链接');
    }
    return this.collect.viralAnalyze(request.authUser, input);
  }

  @Get('radar')
  async getRadar(
    @Req() request: AuthenticatedRequest,
    @Query('keyword') keyword?: string,
    @Query('limit') limit?: string,
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.radar.getRadarAccounts(request.authUser, {
      keyword,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ---------- A6/M5 账号诊断 + 竞品订阅（主文档 P2） ----------

  @Post('account/diagnose')
  @ApiOperation({ summary: '账号诊断：链接/ID → 健康打分（A-D + 建议）' })
  diagnoseAccount(
    @Req() request: AuthenticatedRequest,
    @Body() input: { accountUrl?: string; accountId?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.account.diagnose(request.authUser, input || {});
  }

  @Post('account/subscribe')
  @ApiOperation({ summary: '订阅竞品账号（upsert，自动诊断建档）' })
  subscribeAccount(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: { accountUrl?: string; accountId?: string; platform?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.account.subscribe(request.authUser, input || {});
  }

  @Get('account/health-report')
  @ApiOperation({ summary: '账号体检 30 天报告（历史快照趋势聚合）' })
  healthReport(
    @Req() request: AuthenticatedRequest,
    @Query('accountId') accountId?: string,
    @Query('days') days?: string,
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.account.healthReport(request.authUser, {
      accountId: accountId?.trim() || undefined,
      days: days ? Number(days) : 30,
    });
  }

  @Get('account/subscriptions')
  @ApiOperation({ summary: '我的竞品订阅列表' })
  listSubscriptions(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.account.listSubscriptions(request.authUser);
  }

  @Delete('account/subscriptions/:id')
  @ApiOperation({ summary: '取消订阅' })
  unsubscribeAccount(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.account.unsubscribe(request.authUser, id);
  }

  // ---------- A7/M6 Seedance 视频生成（主文档 P2） ----------

  @Post('video/gen')
  @ApiOperation({
    summary: 'Seedance 视频生成：提交任务（150 积分，异步轮询 taskId）',
  })
  submitVideoGen(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: {
      prompt: string;
      duration?: number;
      ratio?: string;
      imageUrl?: string;
    },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.video.submit(request.authUser, input || {});
  }

  @Get('video/gen/:taskId')
  @ApiOperation({
    summary: 'Seedance 视频生成：查询结果（done 后自动入素材库）',
  })
  queryVideoGen(
    @Req() request: AuthenticatedRequest,
    @Param('taskId') taskId: string,
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.video.query(request.authUser, taskId);
  }

  /* ========== 平台能力开采（2026-08-09，RedFoxHub 6 项扩展） ========== */

  @Get('platform/download-platforms')
  @ApiOperation({ summary: '支持去水印下载的平台列表' })
  listDownloadPlatforms(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return { items: this.platform.getDownloadPlatforms() };
  }

  @Get('platform/search-platforms')
  @ApiOperation({ summary: '支持内容采集的平台列表' })
  listSearchPlatforms(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return { items: this.platform.getSearchPlatforms() };
  }

  @Post('platform/download')
  @ApiOperation({
    summary:
      '多平台去水印下载（抖音/快手/小红书/视频号/B站/TikTok/YouTube/X/Instagram）',
  })
  platformDownload(
    @Req() request: AuthenticatedRequest,
    @Body() input: { platform: string; url: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.platform.download(request.authUser, input);
  }

  @Post('platform/transcript')
  @ApiOperation({ summary: '视频提文案（抖音/小红书/YouTube）' })
  platformTranscript(
    @Req() request: AuthenticatedRequest,
    @Body() input: { platform: string; url: string; taskId?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.platform.transcript(request.authUser, input);
  }

  @Post('platform/collect')
  @ApiOperation({
    summary:
      '统一内容采集：search(关键词搜作品)/detail(作品详情)/list(账号作品列表)',
  })
  platformCollect(
    @Req() request: AuthenticatedRequest,
    @Body()
    input: {
      platform: string;
      action: 'search' | 'detail' | 'list';
      keyword?: string;
      url?: string;
      workId?: string;
      accountId?: string;
      page?: number;
    },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.platform.collect(request.authUser, input);
  }

  @Post('platform/ai-search')
  @ApiOperation({
    summary: 'AI 作品搜索（抖音/小红书/公众号，AI 生成内容趋势）',
  })
  platformAiSearch(
    @Req() request: AuthenticatedRequest,
    @Body() input: { platform: string; keyword: string; page?: number },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.platform.aiSearch(request.authUser, input);
  }

  @Post('platform/seedream-pro')
  @ApiOperation({ summary: 'Seedream 5.0 Pro 生图（较 lite 更高质量）' })
  platformSeedreamPro(
    @Req() request: AuthenticatedRequest,
    @Body() input: { prompt: string; taskId?: string },
  ) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return this.platform.seedreamPro(request.authUser, input);
  }

  @Get('hot-topics')
  @ApiOperation({ summary: '全网聚合热点榜单（30 分钟缓存，供首页新闻条）' })
  getHotTopics(@Req() request: AuthenticatedRequest) {
    if (!request.authUser) {
      throw new UnauthorizedException('请先登录');
    }
    return this.hotTopics.getHotTopics(request.authUser);
  }

  @Get('connection')
  @ApiOperation({ summary: '获取 RedFox 连接状态和脱敏配置' })
  getConnection(@Req() request: AuthenticatedRequest) {
    return this.redfoxService.getConnection(request.authUser);
  }

  @Post('connection')
  @ApiOperation({ summary: '保存 RedFox 连接配置' })
  saveConnection(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SaveRedfoxConnectionDto,
  ) {
    return this.redfoxService.saveConnection(request.authUser, dto);
  }

  @Post('connection/test')
  @ApiOperation({ summary: '测试 RedFox 连接' })
  testConnection(@Req() request: AuthenticatedRequest) {
    return this.redfoxService.testConnection(request.authUser);
  }

  @Get('interfaces')
  @ApiOperation({ summary: '获取 RedFox 官方平台接口目录' })
  listInterfaces(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryRedfoxInterfacesDto,
  ) {
    return this.redfoxService.listInterfaces(request.authUser, query);
  }

  @Post('interfaces/sync')
  @ApiOperation({ summary: '同步 RedFox 官方平台接口目录' })
  syncInterfaces(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SyncRedfoxInterfacesDto = {},
  ) {
    return this.redfoxService.syncInterfaces(request.authUser, dto);
  }

  @Get('skills')
  @ApiOperation({ summary: '获取本地 RedFox Skill 目录' })
  listSkills(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryRedfoxSkillsDto,
  ) {
    return this.redfoxService.listSkills(request.authUser, query);
  }

  @Post('skills/sync')
  @ApiOperation({ summary: '同步 RedFox Skill 广场列表' })
  syncSkills(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SyncRedfoxSkillsDto = {},
  ) {
    return this.redfoxService.syncSkills(request.authUser, dto);
  }

  @Patch('skills/:id')
  @ApiOperation({ summary: '更新本地 RedFox Skill 启用状态和业务场景' })
  updateSkill(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRedfoxSkillDto,
  ) {
    return this.redfoxService.updateSkill(request.authUser, id, dto);
  }

  @Post('skills/run')
  @ApiOperation({ summary: 'RedFox Skill 试执行，默认 dry-run 不外呼' })
  runSkill(
    @Req() request: AuthenticatedRequest,
    @Body() dto: RunRedfoxSkillDto = {},
  ) {
    if (!request.authUser) {
      throw new UnauthorizedException('请先登录');
    }
    return this.redfoxSkillRunner.runSkill(request.authUser, dto);
  }

  @Get('call-logs')
  @ApiOperation({ summary: '获取 RedFox 调用日志' })
  listCallLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryRedfoxCallLogsDto,
  ) {
    return this.redfoxService.listCallLogs(request.authUser, query);
  }

  @Get('costs/summary')
  @ApiOperation({ summary: '获取 RedFox 成本和调用汇总' })
  getCostSummary(
    @Req() request: AuthenticatedRequest,
    @Query() query: QueryRedfoxCallLogsDto,
  ) {
    return this.redfoxService.getCostSummary(request.authUser, query);
  }

  /** C 档：RedFox 技能 catalog（官方仓库目录建模，可检索） */
  @Get('skills/catalog')
  skillCatalog(@Req() request: AuthenticatedRequest, @Query('q') q?: string) {
    if (!request.authUser) throw new UnauthorizedException('请先登录');
    return {
      total: findRedfoxSkill(q ?? '').length,
      items: findRedfoxSkill(q ?? ''),
    };
  }
}
