import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class SyncRedfoxSkillsDto {
  @ApiPropertyOptional({ description: 'RedFox Skill list page', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'RedFox Skill page size', default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 100;
}
