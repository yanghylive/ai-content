import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InteractionInboxService } from './interaction-inbox.service';

/**
 * 统一互动收件箱（报告 5.1 节）：三栏 Inbox 的 HTTP 只读入口。
 * 鉴权走全局 guard + resolveTenantId（复用现有机制）。
 */
@ApiTags('interaction-inbox')
@Controller('interaction/inbox')
export class InteractionInboxController {
  constructor(private readonly inbox: InteractionInboxService) {}

  @Get()
  @ApiOperation({
    summary: '统一收件箱列表（中栏会话 + 左栏视图计数）',
  })
  list(
    @Query('view') view?: string,
    @Query('platform') platform?: string,
    @Query('assignee') assignee?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inbox.listInbox({
      view: (view as never) ?? 'all',
      platform,
      assignee,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('views')
  @ApiOperation({
    summary:
      '左栏视图计数（all/unassigned/pending/replied/needs_human/overdue）',
  })
  async views() {
    const result = await this.inbox.listInbox({ view: 'all', limit: 1 });
    return result.views;
  }

  @Get('detail')
  @ApiOperation({
    summary: '右栏会话详情（历史 + 任务状态 + 线索/CRM + 草稿）',
  })
  detail(@Query('threadKey') threadKey: string) {
    return this.inbox.getThreadDetail(threadKey);
  }
}
