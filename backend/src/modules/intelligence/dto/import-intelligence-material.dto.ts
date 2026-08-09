import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsOptional, IsString } from 'class-validator';

export class ImportIntelligenceMaterialDto {
  @ApiPropertyOptional({ description: '覆盖导入后的素材标题' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: '覆盖导入后的素材正文' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ description: '覆盖导入后的素材摘要' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: '覆盖素材来源 URL' })
  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: '覆盖素材平台' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: '覆盖素材作者' })
  @IsOptional()
  @IsString()
  author?: string;

  @ApiPropertyOptional({ description: '覆盖素材发布时间，ISO 日期字符串' })
  @IsOptional()
  @IsDateString()
  publishDate?: string;

  @ApiPropertyOptional({ description: '覆盖素材关键词', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
