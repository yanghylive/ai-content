import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryIntelligenceReportsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by report status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by report kind' })
  @IsOptional()
  @IsString()
  kind?: string;

  @ApiPropertyOptional({
    description: 'Search title, markdown, owner or audience',
  })
  @IsOptional()
  @IsString()
  keyword?: string;
}
