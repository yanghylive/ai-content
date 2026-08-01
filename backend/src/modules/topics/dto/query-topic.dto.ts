import { IsOptional, IsString, IsIn, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Transform } from 'class-transformer';

function parseOptionalBoolean(value: unknown, rawValue: unknown) {
  const candidate = rawValue ?? value;
  if (candidate === true || candidate === 'true') return true;
  if (candidate === false || candidate === 'false') return false;
  return candidate;
}

export class QueryTopicDto extends PaginationDto {
  @ApiPropertyOptional({ description: '搜索关键词' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({
    description: '状态筛选',
    enum: ['pending', 'generating', 'completed'],
  })
  @IsOptional()
  @IsIn(['pending', 'generating', 'completed'])
  status?: string;

  @ApiPropertyOptional({ description: '是否已发布' })
  @IsOptional()
  @Transform(({ value, obj, key }) => parseOptionalBoolean(value, obj?.[key]))
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    description: '排序方式',
    enum: ['date-desc', 'date-asc', 'score-desc', 'score-asc'],
    default: 'date-desc',
  })
  @IsOptional()
  @IsIn(['date-desc', 'date-asc', 'score-desc', 'score-asc'])
  sortBy?: string = 'date-desc';
}
