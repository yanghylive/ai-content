import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { requireDemoMode } from '../../../lib/demo/demo-mode';
import type { CreateDemoTaskInput } from './wechat-personal.service';
import { WechatPersonalDemoService } from './wechat-personal.service';

/**
 * 演示舱·个人微信自动化 controller
 *
 * 每个端点第一行必须 requireDemoMode()（合规书第五节第 3 条运行时门禁）。
 * 全局前缀 /api 由 main.ts 统一设置。
 */
@Controller('demo/wechat-personal')
export class WechatPersonalDemoController {
  constructor(private readonly demoService: WechatPersonalDemoService) {}

  /** mock 联系人列表 */
  @Get('contacts')
  listContacts() {
    requireDemoMode();
    return { contacts: this.demoService.listContacts() };
  }

  /** 任务列表 */
  @Get('tasks')
  listTasks() {
    requireDemoMode();
    return { tasks: this.demoService.listTasks() };
  }

  /** 创建任务（自动加好友 / 群发 / 朋友圈） */
  @Post('tasks')
  createTask(@Body() body: CreateDemoTaskInput) {
    requireDemoMode();
    return this.demoService.createTask(body);
  }

  /** 单任务详情（含实时进度与日志） */
  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    requireDemoMode();
    return this.demoService.getTask(id);
  }

  /** 停止任务 */
  @Post('tasks/:id/stop')
  stopTask(@Param('id') id: string) {
    requireDemoMode();
    return this.demoService.stopTask(id);
  }
}
