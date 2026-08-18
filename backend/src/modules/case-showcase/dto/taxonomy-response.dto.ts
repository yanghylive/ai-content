import { ApiProperty } from '@nestjs/swagger';
import { TaxonomyDto } from './taxonomy.dto';

/**
 * 公开分类响应（GET /api/v1/taxonomies）。
 * 按 platform / industry / capability 三类分组返回已启用分类。
 */
export class TaxonomyResponseDto {
  @ApiProperty({ type: [TaxonomyDto], description: '平台分类' })
  platform: TaxonomyDto[];

  @ApiProperty({ type: [TaxonomyDto], description: '行业分类' })
  industry: TaxonomyDto[];

  @ApiProperty({ type: [TaxonomyDto], description: '能力分类' })
  capability: TaxonomyDto[];
}
