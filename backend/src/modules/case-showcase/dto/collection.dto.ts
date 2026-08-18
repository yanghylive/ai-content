import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CaseSummaryDto, PublicCoverDto } from './case-summary.dto';

/**
 * 公开案例合集 DTO（合集公开信息 + 有效案例摘要）。
 *
 * 硬约束：禁止公开 internalCustomerAlias（内部客户简称）、channelCode（渠道内部码）、
 * ownerUserId、status（内部状态）。仅暴露已发布案例摘要，绝不整体序列化 Prisma model。
 */
export class CollectionDto {
  @ApiProperty({ description: '合集 ID' })
  id: string;

  @ApiProperty({ description: '公开 slug 标识' })
  slug: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiPropertyOptional({ description: '描述' })
  description: string | null;

  @ApiPropertyOptional({ description: '封面（白名单字段）' })
  coverMedia: PublicCoverDto | null;

  @ApiPropertyOptional({ description: '可见性', enum: ['public', 'link_only'] })
  visibility: string;

  @ApiPropertyOptional({
    description: '合集内案例（有序，仅已发布摘要）',
    type: [CaseSummaryDto],
  })
  cases: CaseSummaryDto[];

  @ApiPropertyOptional({
    description: '到期时间（ISO 8601，null 表示长期有效）',
  })
  validUntil: string | null;

  @ApiProperty({ description: '更新时间（ISO 8601）' })
  updatedAt: string;
}
