import { IsOptional, IsArray, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CollectDto {
  @ApiPropertyOptional({ description: '指定信息源 ID 列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];
}
