import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiPlatformsService } from './ai-platforms.service';
import { CreatePlatformDto } from './dto/create-platform.dto';
import { UpdatePlatformDto } from './dto/update-platform.dto';

@ApiTags('AI 平台管理')
@Controller('ai-platforms')
export class AiPlatformsController {
  constructor(private readonly service: AiPlatformsService) {}

  @Get()
  @ApiOperation({ summary: '获取所有 AI 平台' })
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个 AI 平台' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建 AI 平台' })
  create(@Body() dto: CreatePlatformDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新 AI 平台' })
  update(@Param('id') id: string, @Body() dto: UpdatePlatformDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除 AI 平台' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
