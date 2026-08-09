import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { CommentInsightsPlatform } from '../comment-insights.types';

export class QueryCommentInsightsDto {
  @ApiPropertyOptional({ description: '平台筛选' })
  @IsOptional()
  @IsString()
  platform?: CommentInsightsPlatform;

  @ApiPropertyOptional({ description: '作品链接筛选' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '关键词筛选' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
