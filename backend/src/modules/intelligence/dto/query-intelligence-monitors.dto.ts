import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryIntelligenceMonitorsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by monitor status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by monitor type' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Filter by platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({
    description:
      'Search monitor keyword, account id, industry, platform or type',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Filter by industry' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['updatedAt', 'createdAt', 'nextRunAt', 'lastRunAt'],
    default: 'updatedAt',
  })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'nextRunAt', 'lastRunAt'])
  sortBy?: 'updatedAt' | 'createdAt' | 'nextRunAt' | 'lastRunAt' = 'updatedAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
