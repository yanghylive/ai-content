import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateIntelligenceMonitorDto {
  @ApiProperty({
    description: 'Monitor type, e.g. keyword/account/industry/trend/viral',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({
    description: 'Cron-like schedule or scheduler preset used by the runner',
  })
  @IsString()
  @IsNotEmpty()
  schedule!: string;

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

  @ApiPropertyOptional({ description: 'Initial status', default: 'active' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Point budget limit for this monitor' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costLimitPoints?: number;

  @ApiPropertyOptional({ description: 'Next scheduled run ISO timestamp' })
  @IsOptional()
  @IsDateString()
  nextRunAt?: string;

  @ApiPropertyOptional({ description: 'Runner-specific configuration' })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
