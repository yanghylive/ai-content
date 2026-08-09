import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateIntelligenceMonitorDto {
  @ApiPropertyOptional({ description: 'Monitor type' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  type?: string;

  @ApiPropertyOptional({
    description: 'Cron-like schedule or scheduler preset',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  schedule?: string;

  @ApiPropertyOptional({ description: 'Target platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Keyword to monitor' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'External account id or handle' })
  @IsOptional()
  @IsString()
  accountExternalId?: string;

  @ApiPropertyOptional({ description: 'Industry segment to monitor' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({ description: 'Installed RedFox Skill id' })
  @IsOptional()
  @IsString()
  skillInstallId?: string;

  @ApiPropertyOptional({ description: 'Monitor status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Point budget limit for this monitor' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costLimitPoints?: number;

  @ApiPropertyOptional({ description: 'Last scheduled run ISO timestamp' })
  @IsOptional()
  @IsDateString()
  lastRunAt?: string;

  @ApiPropertyOptional({ description: 'Next scheduled run ISO timestamp' })
  @IsOptional()
  @IsDateString()
  nextRunAt?: string;

  @ApiPropertyOptional({ description: 'Last runner error' })
  @IsOptional()
  @IsString()
  lastError?: string;

  @ApiPropertyOptional({ description: 'Runner-specific configuration' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
