import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import type { OptimizationPlatform } from '../content-optimization.types';

export class TitleScoreDto {
  @ApiProperty({ description: '待评分标题' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '目标平台', default: 'all' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({
    description: '内容类型，例如 article、xiaohongshu、video_script',
  })
  @IsOptional()
  @IsString()
  contentType?: string;

  @ApiPropertyOptional({ description: '目标受众' })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({ description: '希望覆盖的关键词', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ description: '标题目标，例如涨粉、转化、搜索收录' })
  @IsOptional()
  @IsString()
  goal?: string;
}
