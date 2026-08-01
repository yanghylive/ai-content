import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';

@ApiTags('信息源管理')
@Controller('sources')
export class SourcesController {
  constructor(private readonly service: SourcesService) {}

  @Get()
  @ApiOperation({ summary: '获取所有信息源' })
  findAll() {
    return this.service.findAll();
  }

  // seed 路由必须在 :id 之前声明，避免路径冲突
  @Post('seed')
  @ApiOperation({ summary: '初始化默认信息源' })
  seed() {
    return this.service.seed();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个信息源' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '创建信息源' })
  create(@Body() dto: CreateSourceDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新信息源' })
  update(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: '切换信息源启用状态' })
  toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除信息源' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
