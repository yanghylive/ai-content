import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 公开分类 DTO（平台/行业/能力分类白名单）。
 */
export class TaxonomyDto {
  @ApiProperty({ description: '分类 ID' })
  id: string;

  @ApiProperty({
    description: '分类类型',
    enum: ['platform', 'industry', 'capability'],
  })
  type: string;

  @ApiProperty({ description: '分类 slug' })
  slug: string;

  @ApiProperty({ description: '分类名称' })
  name: string;

  @ApiPropertyOptional({ description: '排序序号' })
  sortOrder: number;
}
