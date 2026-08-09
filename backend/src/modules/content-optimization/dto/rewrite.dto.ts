import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import type { OptimizationPlatform } from '../content-optimization.types';

export class RewriteDto {
  @ApiProperty({ description: '待改写正文' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ description: '目标平台', default: 'all' })
  @IsOptional()
  @IsString()
  platform?: OptimizationPlatform;

  @ApiPropertyOptional({
    description: '改写语气，例如 professional、friendly、xhs',
  })
  @IsOptional()
  @IsString()
  tone?: string;

  @ApiPropertyOptional({ description: '目标受众' })
  @IsOptional()
  @IsString()
  audience?: string;

  @ApiPropertyOptional({ description: '改写目标', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  goals?: string[];

  @ApiPropertyOptional({ description: '是否尽量保留事实信息', default: true })
  @IsOptional()
  @IsBoolean()
  keepFacts?: boolean;
}
