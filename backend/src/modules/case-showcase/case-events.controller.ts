import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth.decorator';
import { CaseEventsService } from './case-events.service';

/**
 * 案例展示中心 · 分析事件上报端点（M7-01）。
 *
 * POST /api/v1/events（fire-and-forget）：接收 { name, props }，服务端校验
 * 事件名白名单（未知 400），props 清洗（剥敏感键/截断/丢嵌套），日志记录后返回 204。
 * 采用 @Res() 手动 204，避免全局 TransformInterceptor 对空响应二次包装。
 */
@ApiTags('case-showcase')
@Public()
@Controller()
export class CaseEventsController {
  constructor(private readonly eventsService: CaseEventsService) {}

  @Post('v1/events')
  @ApiOperation({ summary: '上报允许的产品分析事件（白名单校验 + 204）' })
  trackEvent(
    @Body() body: { name?: unknown; props?: unknown },
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    this.eventsService.record(body, req?.ip);
    res.status(204).send();
  }
}
