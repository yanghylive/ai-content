import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 公开案例摘要 DTO（列表卡片白名单）。
 *
 * 对应架构文档 §4.4「Case 摘要」公开字段白名单：
 *   case_id、slug、title、subtitle、provenance、primary_platform、industries、
 *   capabilities、experience_status、cover、updated_at。
 *
 * 硬约束：不得包含内部客户简称、授权附件、联系方式、演示凭据等私有字段。
 * 序列化必须经 field-whitelist.ts 显式 pick，禁止整体 spread Prisma model。
 */

/** 公开封面（仅暴露 url / thumbnailUrl / altText） */
export class PublicCoverDto {
  @ApiPropertyOptional({ description: '封面图 URL' })
  url?: string | null;

  @ApiPropertyOptional({ description: '封面缩略图 URL' })
  thumbnailUrl?: string | null;

  @ApiPropertyOptional({ description: '封面无障碍替代文本' })
  altText?: string | null;
}

export class CaseSummaryDto {
  @ApiProperty({ description: '案例 ID' })
  id: string;

  @ApiProperty({ description: '公开 slug 标识' })
  slug: string;

  @ApiProperty({ description: '标题' })
  title: string;

  @ApiPropertyOptional({ description: '副标题' })
  subtitle: string | null;

  @ApiProperty({
    description: '案例来源类型',
    enum: ['delivery', 'open_source', 'prototype', 'template'],
  })
  provenanceType: string;

  @ApiPropertyOptional({ description: '主平台' })
  primaryPlatform: string | null;

  @ApiPropertyOptional({ description: '行业分类', type: [String] })
  industries: string[];

  @ApiPropertyOptional({ description: '能力标签', type: [String] })
  capabilityTags: string[];

  @ApiPropertyOptional({
    description: '体验可用状态（有可用演示入口时为 true）',
  })
  experienceStatus: boolean;

  @ApiPropertyOptional({ description: '封面（白名单字段）' })
  coverMedia: PublicCoverDto | null;

  @ApiProperty({ description: '更新时间（ISO 8601）' })
  updatedAt: string;
}
