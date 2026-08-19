import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommentAcquisitionService } from './comment-acquisition.service';
import type {
  AcquisitionPlatform,
  LeadStatus,
} from './comment-acquisition.service';

@ApiTags('评论获客')
@Controller('comment-acquisition')
export class CommentAcquisitionController {
  constructor(
    private readonly commentAcquisitionService: CommentAcquisitionService,
  ) {}

  @Post('scan')
  @ApiOperation({
    summary: '扫描账号评论 → 潜客评分 → 生成回复（可选自动回复）',
  })
  scan(
    @Body()
    dto: {
      platform: AcquisitionPlatform;
      accountId: number | string;
      limit?: number;
      autoReply?: boolean;
      minLeadScore?: number;
    },
  ) {
    return this.commentAcquisitionService.scanAccount(dto);
  }

  @Post('scan-dm')
  @ApiOperation({
    summary: '扫描私信 → 潜客评分 → 生成回复（可选自动回复，抖音/视频号）',
  })
  scanDm(
    @Body()
    dto: {
      platform: 'douyin' | 'wechat-channel';
      accountId: number | string;
      limit?: number;
      autoReply?: boolean;
      minLeadScore?: number;
    },
  ) {
    return this.commentAcquisitionService.scanDm(dto);
  }

  @Get('leads')
  @ApiOperation({ summary: '潜客列表' })
  listLeads(
    @Query('platform') platform?: AcquisitionPlatform,
    @Query('status') status?: LeadStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.commentAcquisitionService.listLeads({
      platform,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('leads/:id/review')
  @ApiOperation({ summary: '人工审核：通过待回复 / 跳过' })
  reviewLead(
    @Param('id') id: string,
    @Body() dto: { action: 'approve' | 'skip'; replyText?: string },
  ) {
    return this.commentAcquisitionService.reviewLead(id, dto);
  }

  @Post('leads/:id/reply')
  @ApiOperation({ summary: '对已审核潜客执行真实回复' })
  async replyLead(
    @Param('id') id: string,
    @Body()
    dto: {
      platform: AcquisitionPlatform;
      accountId: number | string;
      commentText: string;
      replyText: string;
      sourceTitle?: string;
    },
  ) {
    const ok = await this.commentAcquisitionService.dispatchReply(id, dto);
    return { ok };
  }
}
