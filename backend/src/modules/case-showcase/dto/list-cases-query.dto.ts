import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 公开案例列表查询参数（GET /api/v1/cases）。
 *
 * 多选维度（platform/industry/capability/provenance）以逗号分隔字符串传入，
 * 由 controller 拆分后交给 repository（同一维度 OR、维度之间 AND）。
 */
export class ListCasesQueryDto {
  @ApiPropertyOptional({
    description: '搜索关键词（模糊匹配标题/副标题/业务问题/方案摘要）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: '平台筛选（逗号分隔多选，同维度 OR）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  platform?: string;

  @ApiPropertyOptional({ description: '行业筛选（逗号分隔多选）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  industry?: string;

  @ApiPropertyOptional({ description: '能力筛选（逗号分隔多选）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  capability?: string;

  @ApiPropertyOptional({ description: '来源筛选（逗号分隔多选）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  provenance?: string;

  @ApiPropertyOptional({
    description: '体验可用筛选',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  experience?: string;

  @ApiPropertyOptional({
    description: '首页精选筛选（true=按运营精选位排序返回已发布案例）',
    enum: ['true', 'false'],
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  featured?: string;

  @ApiPropertyOptional({
    description: '排序',
    enum: ['recommended', 'updated', 'popular'],
  })
  @IsOptional()
  @IsIn(['recommended', 'updated', 'popular'])
  sort?: string;

  @ApiPropertyOptional({ description: '游标（上一页返回的 nextCursor）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ description: '每页数量（服务端上限 48）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit?: number;
}
