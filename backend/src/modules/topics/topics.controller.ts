import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TopicsService } from './topics.service';
import { AiScorerService } from './ai-scorer.service';
import { TopicMiningService } from './topic-mining.service';
import { QueryTopicDto } from './dto/query-topic.dto';
import { CreateTopicDto } from './dto/create-topic.dto';
import { DiscoverTopicsDto } from './dto/discover-topics.dto';

@ApiTags('选题管理')
@Controller('topics')
export class TopicsController {
  constructor(
    private readonly topicsService: TopicsService,
    private readonly aiScorer: AiScorerService,
    private readonly topicMining: TopicMiningService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取选题列表（分页、筛选、排序）' })
  findAll(@Query() query: QueryTopicDto) {
    return this.topicsService.findAll(query);
  }

  @Post('mine')
  @ApiOperation({ summary: '一键挖掘新选题（AI 聚类打分）' })
  mine() {
    return this.topicMining.mineTopics();
  }

  @Post('discover')
  @ApiOperation({ summary: '基于关键词/事件/描述智能挖出 3-5 个候选选题' })
  discover(@Body() dto: DiscoverTopicsDto) {
    return this.topicMining.discoverTopicsFromSeed(dto.seed);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取选题详情' })
  findOne(@Param('id') id: string) {
    return this.topicsService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建选题' })
  create(@Body() dto: CreateTopicDto) {
    return this.topicsService.create(dto);
  }

  @Post(':id/generate')
  @ApiOperation({ summary: '触发 AI 全维度评估' })
  generate(@Param('id') id: string) {
    return this.aiScorer.scoreTopic(id);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布选题' })
  publish(@Param('id') id: string) {
    return this.topicsService.publish(id, true);
  }

  @Post(':id/unpublish')
  @ApiOperation({ summary: '取消发布选题' })
  unpublish(@Param('id') id: string) {
    return this.topicsService.publish(id, false);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除选题' })
  remove(@Param('id') id: string) {
    return this.topicsService.remove(id);
  }
}
