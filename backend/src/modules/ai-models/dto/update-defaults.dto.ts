import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDefaultsDto {
  @ApiPropertyOptional({ description: '文章创作默认模型 ID' })
  @IsOptional()
  @IsString()
  articleCreation?: string;

  @ApiPropertyOptional({ description: '图片生成默认模型 ID' })
  @IsOptional()
  @IsString()
  imageCreation?: string;

  @ApiPropertyOptional({ description: 'X 采集默认模型 ID' })
  @IsOptional()
  @IsString()
  xCollection?: string;

  @ApiPropertyOptional({ description: '选题推荐默认模型 ID' })
  @IsOptional()
  @IsString()
  topicSelection?: string;
}
