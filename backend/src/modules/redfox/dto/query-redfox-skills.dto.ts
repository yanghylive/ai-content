import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryRedfoxSkillsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search keyword for name, code, summary or tag',
  })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Filter by RedFox platform' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Filter by tag' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ description: 'Filter by local business scenario' })
  @IsOptional()
  @IsString()
  scenario?: string;

  @ApiPropertyOptional({ description: 'Filter by local enabled flag' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['syncedAt', 'name', 'platform'],
    default: 'syncedAt',
  })
  @IsOptional()
  @IsIn(['syncedAt', 'name', 'platform'])
  sortBy?: 'syncedAt' | 'name' | 'platform' = 'syncedAt';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
