import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateModelDto {
  @ApiProperty({ description: '模型显示名称', example: 'DeepSeek V3' })
  @IsString()
  name: string;

  @ApiProperty({ description: '模型 ID', example: 'deepseek-chat' })
  @IsString()
  modelId: string;

  @ApiProperty({ description: '所属平台 ID' })
  @IsString()
  platformId: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
