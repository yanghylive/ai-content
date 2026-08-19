import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('统一统计')
@Controller('stats')
export class StatsController {
  constructor(private readonly service: StatsService) {}

  @Get('snapshot')
  @ApiOperation({ summary: '统一统计快照（方案 4.3 状态事实源）' })
  getSnapshot(@Query('domain') domain?: string) {
    return this.service.getSnapshot((domain || 'today').trim());
  }
}
