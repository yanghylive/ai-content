import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';
import type {
  CommentInsightsPlatform,
  CommentSourceType,
} from '../comment-insights.types';

export class CommentInputDto {
  @ApiPropertyOptional({ description: '评论 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: '评论作者' })
  @IsOptional()
  @IsString()
  author?: string;

  @ApiPropertyOptional({ description: '评论内容' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '点赞数' })
  @IsOptional()
  @IsNumber()
  likedCount?: number;

  @ApiPropertyOptional({ description: '发布时间' })
  @IsOptional()
  @IsString()
  publishedAt?: string;
}

export class AnalyzeCommentsDto {
  @ApiPropertyOptional({ description: '平台', default: 'all' })
  @IsOptional()
  @IsString()
  platform?: CommentInsightsPlatform;

  @ApiPropertyOptional({
    description: '评论来源类型',
    default: 'manual_comments',
  })
  @IsOptional()
  @IsString()
  sourceType?: CommentSourceType;

  @ApiPropertyOptional({ description: '作品或评论来源链接' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '作品标题' })
  @IsOptional()
  @IsString()
  workTitle?: string;

  @ApiPropertyOptional({ description: '产品或服务名称，用于生成回复建议' })
  @IsOptional()
  @IsString()
  productName?: string;

  @ApiPropertyOptional({
    description: '评论列表，可传字符串数组或对象数组',
    type: [CommentInputDto],
  })
  @IsOptional()
  @IsArray()
  comments?: Array<string | CommentInputDto>;

  @ApiPropertyOptional({ description: '分析关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
