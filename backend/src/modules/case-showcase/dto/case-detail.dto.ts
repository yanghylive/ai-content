import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PublicCoverDto } from './case-summary.dto';
import { KeyFeatureDto } from './key-feature.dto';

/**
 * 公开案例详情 DTO（详情页白名单）。
 *
 * 对应架构文档 §4.4「Case 详情」公开字段白名单：
 *   hero、provenance、business_problem、solution、key_features、results/evidence、
 *   media、public_endpoints、public_technical_info、attribution/disclaimer、
 *   related_cases、seo。
 *
 * 硬约束：禁止公开完整 target_url 内部配置、internal_customer_alias、授权附件、
 * 联系方式、演示凭据。授权记录（含私有附件）绝不进入公开详情，仅以固定免责声明
 * （disclaimer）形式体现来源/许可证摘要。
 */

/** 公开媒体（排除 checksum / rightsStatus / sensitiveReviewed 等内部字段） */
export class PublicMediaDto {
  @ApiProperty({ description: '媒体 ID' })
  id: string;

  @ApiProperty({
    description: '媒体类型',
    enum: ['image', 'video', 'document'],
  })
  mediaType: string;

  @ApiPropertyOptional({ description: '文件 URL' })
  fileUrl: string | null;

  @ApiPropertyOptional({ description: '外部 URL' })
  externalUrl: string | null;

  @ApiPropertyOptional({ description: '缩略图 URL' })
  thumbnailUrl: string | null;

  @ApiPropertyOptional({ description: '标题' })
  title: string | null;

  @ApiPropertyOptional({ description: '说明文字' })
  caption: string | null;

  @ApiProperty({ description: '无障碍替代文本（必填）' })
  altText: string;

  @ApiPropertyOptional({
    description: '设备框架',
    enum: ['desktop', 'mobile', 'tablet'],
  })
  deviceFrame: string | null;

  @ApiProperty({ description: '排序序号' })
  sortOrder: number;
}

/**
 * 公开演示入口（排除 targetUrl 内部配置、fallbackTarget、ownerUserId）。
 * 仅暴露终端适配、访问说明、短链码（跳转走 /r/:code）与回退类型，不暴露可直达的内部目标地址。
 */
export class PublicDemoEndpointDto {
  @ApiProperty({ description: '演示入口 ID' })
  id: string;

  @ApiProperty({
    description: '入口类型',
    enum: ['h5', 'web', 'wechat_mini_program', 'download', 'appointment'],
  })
  endpointType: string;

  @ApiPropertyOptional({ description: '允许设备', type: [String] })
  allowedDevices: string[];

  @ApiPropertyOptional({ description: '访问说明' })
  accessInstruction: string | null;

  @ApiPropertyOptional({ description: '生效时间（ISO 8601）' })
  validFrom: string | null;

  @ApiPropertyOptional({ description: '失效时间（ISO 8601）' })
  validUntil: string | null;

  @ApiPropertyOptional({
    description: '回退类型（入口异常时回退到视频/图集/URL）',
    enum: ['media', 'url', 'none'],
  })
  fallbackType: string;

  @ApiPropertyOptional({
    description: '健康状态',
    enum: ['unknown', 'healthy', 'broken', 'expired'],
  })
  healthStatus: string;

  @ApiPropertyOptional({
    description: '短链码（跳转走 /r/:code，不直接暴露 targetUrl）',
  })
  shortCode: string | null;
}

/**
 * 公开授权归属文本（排除私有附件 attachment、审核意见等）。
 * 仅暴露授权方、授权范围、许可证名称与来源链接。
 */
export class PublicAttributionDto {
  @ApiPropertyOptional({ description: '授权方 / 项目作者或组织' })
  grantor: string | null;

  @ApiPropertyOptional({ description: '授权范围说明' })
  scope: string | null;

  @ApiPropertyOptional({ description: '许可证名称' })
  licenseName: string | null;

  @ApiPropertyOptional({ description: '来源链接' })
  sourceUrl: string | null;
}

export class CaseDetailDto {
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

  @ApiPropertyOptional({
    description: '客户可见性',
    enum: ['public', 'limited'],
  })
  clientVisibility: string;

  @ApiPropertyOptional({ description: '主平台' })
  primaryPlatform: string | null;

  @ApiPropertyOptional({ description: '平台列表', type: [String] })
  platforms: string[];

  @ApiPropertyOptional({ description: '主行业' })
  primaryIndustry: string | null;

  @ApiPropertyOptional({ description: '行业列表', type: [String] })
  industries: string[];

  @ApiPropertyOptional({ description: '能力标签', type: [String] })
  capabilityTags: string[];

  @ApiPropertyOptional({ description: '业务问题' })
  businessProblem: string | null;

  @ApiPropertyOptional({ description: '解决方案摘要' })
  solutionSummary: string | null;

  @ApiPropertyOptional({
    description: '关键特性（结构化：title + description）',
    type: [KeyFeatureDto],
  })
  keyFeatures: KeyFeatureDto[];

  @ApiPropertyOptional({ description: '成果摘要' })
  resultsSummary: string | null;

  @ApiProperty({ description: '证据等级', enum: ['E0', 'E1', 'E2', 'E3'] })
  evidenceLevel: string;

  @ApiPropertyOptional({ description: '证据范围说明' })
  evidenceScope: string | null;

  @ApiPropertyOptional({ description: '交付方式', type: [String] })
  deliveryModes: string[];

  @ApiPropertyOptional({
    description: '成熟度',
    enum: ['concept', 'prototype', 'mvp', 'product', 'scale'],
  })
  maturity: string;

  @ApiPropertyOptional({ description: '公开技术概要' })
  techSummary: string | null;

  @ApiPropertyOptional({ description: '封面（白名单字段）' })
  coverMedia: PublicCoverDto | null;

  @ApiPropertyOptional({ description: '公开媒体列表', type: [PublicMediaDto] })
  media: PublicMediaDto[];

  @ApiPropertyOptional({
    description: '公开演示入口列表',
    type: [PublicDemoEndpointDto],
  })
  demoEndpoints: PublicDemoEndpointDto[];

  @ApiPropertyOptional({
    description: '公开授权归属列表（grantor/scope/licenseName/sourceUrl，不含私有附件）',
    type: [PublicAttributionDto],
  })
  attribution: PublicAttributionDto[];

  @ApiPropertyOptional({
    description: '来源/许可证免责声明（固定文案，不含私有授权附件）',
  })
  disclaimer: string | null;

  @ApiPropertyOptional({ description: 'SEO 标题' })
  seoTitle: string | null;

  @ApiPropertyOptional({ description: 'SEO 描述' })
  seoDescription: string | null;

  @ApiPropertyOptional({ description: '发布时间（ISO 8601）' })
  publishedAt: string | null;

  @ApiProperty({ description: '更新时间（ISO 8601）' })
  updatedAt: string;
}
