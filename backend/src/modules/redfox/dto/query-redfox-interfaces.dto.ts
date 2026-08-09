import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryRedfoxInterfacesDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by name, path, interfaceNo' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Filter by RedFox platform code' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: 'Filter by normalized scenario' })
  @IsOptional()
  @IsString()
  scenario?: string;

  @ApiPropertyOptional({ description: 'Filter by endpoint substring' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: 'Filter by RedFox interface status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['syncedAt', 'name', 'platform', 'price'],
    default: 'platform',
  })
  @IsOptional()
  @IsIn(['syncedAt', 'name', 'platform', 'price'])
  sortBy?: 'syncedAt' | 'name' | 'platform' | 'price' = 'platform';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'asc';
}
