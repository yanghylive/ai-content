import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CommentInsightsService } from './comment-insights.service';
import { AnalyzeCommentsDto } from './dto/analyze-comments.dto';
import { ReplySuggestDto } from './dto/reply-suggest.dto';
import { QueryCommentInsightsDto } from './dto/query-comment-insights.dto';

@ApiTags('评论洞察')
@Controller('comment-insights')
export class CommentInsightsController {
  constructor(
    private readonly commentInsightsService: CommentInsightsService,
  ) {}

  @Post('analyze')
  @ApiOperation({ summary: '分析评论痛点、意向和回复建议' })
  analyze(@Body() dto: AnalyzeCommentsDto) {
    return this.commentInsightsService.analyze(dto);
  }

  @Post('reply/suggest')
  @ApiOperation({ summary: 'AI 生成单条评论的回复建议（D2，2-3 版）' })
  suggestReply(@Body() dto: ReplySuggestDto) {
    return this.commentInsightsService.suggestReply(dto);
  }

  @Get()
  @ApiOperation({ summary: '获取评论洞察记录列表' })
  list(@Query() query: QueryCommentInsightsDto) {
    return this.commentInsightsService.list(query);
  }
}
