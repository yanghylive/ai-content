import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SaveRedfoxConnectionDto {
  @ApiPropertyOptional({
    description: 'RedFox API Base URL',
    example: 'https://redfox.hk',
  })
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @ApiPropertyOptional({
    description: 'RedFox API Key. Empty string clears the saved key.',
  })
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Request timeout in milliseconds' })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({ description: 'Whether this connector is enabled' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Per-user daily RedFox call limit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyUserLimit?: number;

  @ApiPropertyOptional({ description: 'Per-tenant daily RedFox call limit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  dailyTenantLimit?: number;

  @ApiPropertyOptional({
    description:
      'Cost point threshold that should require explicit UI confirmation',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  highCostConfirmThreshold?: number;
}
