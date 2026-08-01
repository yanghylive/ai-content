import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class XhsNoteOptimizeDto {
  @ApiPropertyOptional({ description: '原笔记标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '原笔记正文' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '已有话题标签', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];

  @ApiPropertyOptional({ description: '目标用户画像' })
  @IsOptional()
  @IsString()
  targetAudience?: string;

  @ApiPropertyOptional({ description: '账号定位' })
  @IsOptional()
  @IsString()
  accountPositioning?: string;

  @ApiPropertyOptional({ description: '优化目标，例如收藏、搜索、咨询、转化' })
  @IsOptional()
  @IsString()
  optimizationGoal?: string;
}
