import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryRedfoxCallLogsDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by call status',
    enum: ['success', 'failed', 'blocked'],
  })
  @IsOptional()
  @IsIn(['success', 'failed', 'blocked'])
  status?: 'success' | 'failed' | 'blocked';

  @ApiPropertyOptional({ description: 'Filter by RedFox Skill code' })
  @IsOptional()
  @IsString()
  skillCode?: string;

  @ApiPropertyOptional({ description: 'Filter by endpoint substring' })
  @IsOptional()
  @IsString()
  endpoint?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp lower bound' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp upper bound' })
  @IsOptional()
  @IsString()
  to?: string;
}
