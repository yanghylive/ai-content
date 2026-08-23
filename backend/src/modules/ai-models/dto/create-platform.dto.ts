import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlatformDto {
  @ApiProperty({ description: '平台名称', example: 'KAYPAL 统一网关' })
  @IsString()
  name: string;

  // 2026-08-23 Stage 1D：OpenAPI 示例只允许 KAYPAL 网关地址，
  // 禁止给出任何模型厂商的直连域名示例（会被当成可用配置从而绕过计费）。
  // 门禁：backend/scripts/check-no-direct-provider.mjs
  @ApiProperty({
    description: 'API 基础 URL（仅允许 KAYPAL 网关，禁止第三方直连）',
    example: 'https://kaypal.cn/api/v1',
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
