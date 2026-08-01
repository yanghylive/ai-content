import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GeoBridgeService } from './geo-bridge.service';
import type {
  PatchGeoBridgeTaskInput,
  UpsertGeoBridgeTaskInput,
} from './geo-bridge.service';

@ApiTags('GEO 联动')
@Controller('geo-bridge')
export class GeoBridgeController {
  constructor(private readonly service: GeoBridgeService) {}

  @Get('tasks')
  @ApiOperation({ summary: '获取 GEO 联动任务' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  listTasks(@Query('limit') limit?: number) {
    return this.service.listTasks(limit ? Number(limit) : 50);
  }

  @Post('tasks')
  @ApiOperation({ summary: '接收或更新 GEO 联动任务' })
  upsertTask(@Body() body: UpsertGeoBridgeTaskInput) {
    return this.service.upsertTask(body);
  }

  @Patch('tasks')
  @ApiOperation({ summary: '更新 GEO 联动任务状态' })
  patchTask(@Body() body: PatchGeoBridgeTaskInput) {
    return this.service.patchTask(body);
  }
}
