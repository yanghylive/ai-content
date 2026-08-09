import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryIntelligenceDispatchRecordsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by dispatch record status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Search title, summary or source text' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
