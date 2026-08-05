import {
  BadRequestException,
  Body,
  Controller,
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
import { RedfoxSkillRunnerService } from './redfox-skill-runner.service';

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
}
