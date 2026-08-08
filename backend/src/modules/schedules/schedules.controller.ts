import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SchedulesService } from './schedules.service';
import type { UpdateScheduleDto } from './schedules.service';

@ApiTags('chedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  @Get()
  @ApiOperation({ summary: '获取所有定时任务配置' })
  async getAllSchedules() {
    return this.schedulesService.getAllSchedules();
  }

  @Put(':taskType')
  @ApiOperation({ summary: '更新指定类型的定时任务配置' })
  async updateSchedule(
    @Param('taskType') taskType: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.schedulesService.updateSchedule(taskType, dto);
  }
}
