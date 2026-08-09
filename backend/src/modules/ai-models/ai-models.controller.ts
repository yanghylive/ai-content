import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AiModelsService } from './ai-models.service';
import { CreateModelDto } from './dto/create-model.dto';
import { UpdateModelDto } from './dto/update-model.dto';

@ApiTags('AI 模型管理')
@Controller('ai-models')
export class AiModelsController {
  constructor(private readonly service: AiModelsService) {}

  @Get()
  @ApiOperation({ summary: '获取所有 AI 模型' })
  @ApiQuery({ name: 'platformId', required: false, description: '按平台筛选' })
  findAll(@Query('platformId') platformId?: string) {
    return this.service.findAll(platformId);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个 AI 模型' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建 AI 模型' })
  create(@Body() dto: CreateModelDto) {
    return this.service.create(dto);
  }

  @Post('test')
  @ApiOperation({ summary: '测试 AI 模型连接' })
  testConnection(@Body() body: { platformId: string; modelId: string }) {
    return this.service.testConnection(body.platformId, body.modelId);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新 AI 模型' })
  update(@Param('id') id: string, @Body() dto: UpdateModelDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除 AI 模型' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
