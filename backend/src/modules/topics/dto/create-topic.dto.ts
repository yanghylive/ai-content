import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTopicDto {
  @ApiProperty({ description: '选题标题' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '选题描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '选题摘要' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: '来源类型', default: '外部采集' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: '关联素材 ID 列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  materialIds?: string[];

  @ApiPropertyOptional({ description: '关键词', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
