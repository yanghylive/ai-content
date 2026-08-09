import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlatformDto {
  @ApiProperty({ description: '平台名称', example: 'DeepSeek' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'API 基础 URL',
    example: 'https://api.deepseek.com/v1',
  })
  @IsString()
  baseUrl: string;

  @ApiProperty({ description: 'API 密钥' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
