import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContentReviewService } from './content-review.service';
import { reviewContent } from './content-reviewer';

@ApiTags('内容审稿')
@Controller('content-review')
export class ContentReviewController {
  constructor(private readonly contentReviewService: ContentReviewService) {}

  @Post('review')
  @ApiOperation({ summary: '内容质量审稿（规则评分）' })
  review(
    @Body()
    dto: {
      titles?: string[];
      pages?: Array<{ type: string; heading?: string; content?: string }>;
      generatedImageCount?: number;
      aiFlavorScore?: number;
    },
  ) {
    const titles = Array.isArray(dto?.titles) ? dto.titles.map(String) : [];
    const pages = Array.isArray(dto?.pages) ? dto.pages : [];
    return reviewContent({
      titles,
      pagesContent: pages.map((p) => String(p?.content || '')),
      pageTypes: pages.map((p) => String(p?.type || 'content')),
      generatedImageCount: dto?.generatedImageCount ?? 0,
      aiFlavorScore: dto?.aiFlavorScore,
    });
  }

  @Post('revise')
  @ApiOperation({ summary: '审稿 + 定向修订 + 复检' })
  revise(
    @Body()
    dto: {
      titles?: string[];
      pages?: Array<{ type: string; heading?: string; content?: string; imagePrompt?: string }>;
      generatedImageCount?: number;
      aiFlavorScore?: number;
    },
  ) {
    const titles = Array.isArray(dto?.titles) ? dto.titles.map(String) : [];
    const pages = (Array.isArray(dto?.pages) ? dto.pages : []).map((p) => ({
      type: String(p?.type || 'content'),
      heading: String(p?.heading || ''),
      content: String(p?.content || ''),
      imagePrompt: String(p?.imagePrompt || ''),
    }));
    return this.contentReviewService.reviewAndRevise({
      titles,
      pages,
      pagesContent: pages.map((p) => p.content),
      pageTypes: pages.map((p) => p.type),
      generatedImageCount: dto?.generatedImageCount ?? 0,
      aiFlavorScore: dto?.aiFlavorScore,
    });
  }
}
