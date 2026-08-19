import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

/** 内容质量门检查入参（方案 5.3） */
export class ContentQualityCheckDto {
  @ApiProperty({ description: '待检查正文' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '目标平台', default: 'all' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({
    description:
      '内容类型：article / xiaohongshu / video_script / comment_reply',
  })
  @IsOptional()
  @IsString()
  contentType?: string;

  @ApiPropertyOptional({ description: '事实证据来源列表（第 1 项）' })
  @IsOptional()
  @IsArray()
  evidenceSources?: string[];

  @ApiPropertyOptional({ description: 'CTA 文案（第 5 项）' })
  @IsOptional()
  @IsString()
  cta?: string;

  @ApiPropertyOptional({ description: '可追踪链接（第 5 项）' })
  @IsOptional()
  @IsString()
  trackingUrl?: string;

  @ApiPropertyOptional({ description: '素材数量（第 6 项）' })
  @IsOptional()
  @IsNumber()
  materialCount?: number;

  @ApiPropertyOptional({ description: '标签（第 6 项）' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({ description: '链接（第 6 项）' })
  @IsOptional()
  @IsArray()
  links?: string[];
}
