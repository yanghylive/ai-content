import { Controller, Get, Delete, Post, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MaterialsService } from './materials.service';
import { QueryMaterialDto } from './dto/query-material.dto';
import { BatchDeleteDto } from './dto/batch-delete.dto';
import { CollectDto } from './dto/collect.dto';

@ApiTags('素材管理')
@Controller('materials')
export class MaterialsController {
  constructor(private readonly service: MaterialsService) {}

  @Get()
  @ApiOperation({ summary: '获取素材列表（分页、筛选、排序）' })
  findAll(@Query() query: QueryMaterialDto) {
    return this.service.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取素材统计' })
  getStats() {
    return this.service.getStats();
  }

  @Get('collect/status')
  @ApiOperation({ summary: '获取素材采集队列状态' })
  getCollectStatus(@Query('jobIds') jobIds?: string) {
    const parsedJobIds = jobIds
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return this.service.getCollectStatus(parsedJobIds);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个素材详情' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('collect')
  @ApiOperation({ summary: '触发素材采集任务' })
  collect(@Body() dto: CollectDto) {
    return this.service.triggerCollect(dto.sourceIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除素材' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('batch-delete')
  @ApiOperation({ summary: '批量删除素材' })
  batchRemove(@Body() dto: BatchDeleteDto) {
    return this.service.batchRemove(dto.ids);
  }
}
