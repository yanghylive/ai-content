import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class GenerateIntelligenceTopicDto {
  @ApiPropertyOptional({ description: '覆盖生成的选题标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '覆盖生成的选题描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '覆盖生成的选题摘要' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({
    description: '覆盖选题来源类型',
    default: 'RedFox 情报',
  })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({
    description: '额外关联的素材 ID 列表',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  materialIds?: string[];

  @ApiPropertyOptional({ description: '覆盖选题关键词', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];

  @ApiPropertyOptional({ description: '覆盖选题搜索词', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  searchQueries?: string[];
}
