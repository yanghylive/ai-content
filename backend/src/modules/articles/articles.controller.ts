import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Put,
  Body,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import {
  CreateArticleDraftDto,
  UpdateArticleDto,
} from './dto/article-workspace.dto';

@ApiTags('文章管理')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  @ApiOperation({ summary: '获取文章列表（分页）' })
  findAll(@Query() query: Record<string, string | number | undefined>) {
    return this.articlesService.findAll(query);
  }

  @Post('drafts')
  @ApiOperation({ summary: '创建空白内容草稿' })
  createDraft(
    @Body()
    data: CreateArticleDraftDto,
  ) {
    return this.articlesService.createDraft(data);
  }

  @Post(':topicId/generate')
  @ApiOperation({ summary: '基于选题一键自动化生成图文文章' })
  generateFromTopic(
    @Param('topicId') topicId: string,
    @Query('force') force?: string,
    @Query('contentType') contentType?: 'article' | 'xiaohongshu',
    @Req() request?: Request,
  ) {
    const controller = new AbortController();
    const onRequestClose = () => {
      if (!controller.signal.aborted) {
        controller.abort(new Error('文章生成客户端连接已断开'));
      }
    };
    request?.socket.once('close', onRequestClose);

    const generation = Promise.resolve(
      this.articlesService.generateFromTopic(
        topicId,
        force === 'true',
        contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article',
        false,
        controller.signal,
      ),
    );
    return generation.finally(() =>
      request?.socket.off('close', onRequestClose),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单篇文章详情' })
  findOne(@Param('id') id: string) {
    return this.articlesService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新文章' })
  update(@Param('id') id: string, @Body() data: UpdateArticleDto) {
    return this.articlesService.update(id, data);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除文章' })
  remove(@Param('id') id: string) {
    return this.articlesService.remove(id);
  }
}
