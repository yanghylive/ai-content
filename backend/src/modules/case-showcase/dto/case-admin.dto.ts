import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * 后台案例管理 DTO（仅后台权限接口使用，公开响应不经过这些结构）。
 *
 * 后台可读写完整字段（含 targetUrl 等内部配置），但公开响应仍经 field-whitelist
 * 白名单映射，绝不整体序列化。联系方式（Lead.signals）不在案例模型内，本组 DTO 不涉及。
 */

export class KeyFeatureInputDto {
  @ApiProperty({ description: '关键特性标题' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: '关键特性描述' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;
}

export class MediaInputDto {
  @ApiPropertyOptional({
    description: '媒体类型',
    enum: ['image', 'video', 'document'],
  })
  @IsOptional()
  @IsIn(['image', 'video', 'document'])
  mediaType?: string;

  @ApiPropertyOptional({ description: '文件 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fileUrl?: string;

  @ApiPropertyOptional({ description: '外部 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  externalUrl?: string;

  @ApiPropertyOptional({ description: '缩略图 URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  thumbnailUrl?: string;

  @ApiPropertyOptional({ description: '媒体标题' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '媒体说明' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @ApiProperty({ description: '无障碍替代文本（必填）' })
  @IsString()
  @MaxLength(500)
  altText: string;

  @ApiPropertyOptional({ description: '设备框架' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  deviceFrame?: string;

  @ApiPropertyOptional({ description: '排序号' })
  @IsOptional()
  sortOrder?: number;
}

export class DemoEndpointInputDto {
  @ApiProperty({
    description: '入口类型',
    enum: ['h5', 'web', 'wechat_mini_program', 'download', 'appointment'],
  })
  @IsIn(['h5', 'web', 'wechat_mini_program', 'download', 'appointment'])
  endpointType: string;

  @ApiPropertyOptional({ description: '内部目标 URL（后台可写，禁公开）' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  targetUrl?: string;

  @ApiPropertyOptional({ description: '短码' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  shortCode?: string;

  @ApiPropertyOptional({ description: '允许设备', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDevices?: string[];

  @ApiPropertyOptional({ description: '是否允许 iframe 嵌入' })
  @IsOptional()
  @IsBoolean()
  iframeAllowed?: boolean;

  @ApiPropertyOptional({ description: '访问说明' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  accessInstruction?: string;

  @ApiPropertyOptional({ description: '生效时间（ISO）' })
  @IsOptional()
  @IsString()
  validFrom?: string;

  @ApiPropertyOptional({ description: '失效时间（ISO）' })
  @IsOptional()
  @IsString()
  validUntil?: string;

  @ApiProperty({ description: '回退类型', enum: ['media', 'url', 'none'] })
  @IsIn(['media', 'url', 'none'])
  fallbackType: string;

  @ApiPropertyOptional({ description: '回退目标' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fallbackTarget?: string;

  @ApiPropertyOptional({ description: '负责人用户 ID' })
  @IsOptional()
  @IsString()
  ownerUserId?: string;
}

export class CaseAdminInputDto {
  @ApiProperty({ description: '案例标题' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ description: '公开 slug（缺省自动生成）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ description: '副标题' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subtitle?: string;

  @ApiPropertyOptional({
    description: '来源类型',
    enum: ['delivery', 'open_source', 'prototype', 'template'],
  })
  @IsOptional()
  @IsIn(['delivery', 'open_source', 'prototype', 'template'])
  provenanceType?: string;

  @ApiPropertyOptional({
    description: '客户可见性',
    enum: ['public', 'limited'],
  })
  @IsOptional()
  @IsIn(['public', 'limited'])
  clientVisibility?: string;

  @ApiPropertyOptional({ description: '主平台代码' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryPlatform?: string;

  @ApiPropertyOptional({ description: '平台代码列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[];

  @ApiPropertyOptional({ description: '主行业代码' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryIndustry?: string;

  @ApiPropertyOptional({ description: '行业代码列表', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  industries?: string[];

  @ApiPropertyOptional({ description: '能力标签', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilityTags?: string[];

  @ApiPropertyOptional({ description: '业务问题' })
  @IsOptional()
  @IsString()
  businessProblem?: string;

  @ApiPropertyOptional({ description: '方案摘要' })
  @IsOptional()
  @IsString()
  solutionSummary?: string;

  @ApiPropertyOptional({ description: '关键特性', type: [KeyFeatureInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KeyFeatureInputDto)
  keyFeatures?: KeyFeatureInputDto[];

  @ApiPropertyOptional({ description: '成果摘要' })
  @IsOptional()
  @IsString()
  resultsSummary?: string;

  @ApiPropertyOptional({
    description: '证据等级',
    enum: ['E0', 'E1', 'E2', 'E3'],
  })
  @IsOptional()
  @IsIn(['E0', 'E1', 'E2', 'E3'])
  evidenceLevel?: string;

  @ApiPropertyOptional({ description: '证据范围' })
  @IsOptional()
  @IsString()
  evidenceScope?: string;

  @ApiPropertyOptional({ description: '交付方式', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deliveryModes?: string[];

  @ApiPropertyOptional({
    description: '成熟度',
    enum: ['concept', 'prototype', 'mvp', 'product', 'scale'],
  })
  @IsOptional()
  @IsIn(['concept', 'prototype', 'mvp', 'product', 'scale'])
  maturity?: string;

  @ApiPropertyOptional({ description: '技术概要' })
  @IsOptional()
  @IsString()
  techSummary?: string;

  @ApiPropertyOptional({ description: '封面（公开安全 JSON）' })
  @IsOptional()
  @IsObject()
  coverMedia?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'SEO 标题' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string;

  @ApiPropertyOptional({ description: 'SEO 描述' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  seoDescription?: string;

  @ApiPropertyOptional({ description: '原型/模板案例演示数据声明' })
  @IsOptional()
  @IsBoolean()
  demoDataDeclaration?: boolean;

  @ApiPropertyOptional({ description: '媒体列表', type: [MediaInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaInputDto)
  media?: MediaInputDto[];

  @ApiPropertyOptional({
    description: '演示入口列表',
    type: [DemoEndpointInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DemoEndpointInputDto)
  demoEndpoints?: DemoEndpointInputDto[];
}

export class ReviewCaseDto {
  @ApiProperty({
    description: '审核决策',
    enum: ['approved', 'rejected', 'requested_changes'],
  })
  @IsIn(['approved', 'rejected', 'requested_changes'])
  decision: 'approved' | 'rejected' | 'requested_changes';

  @ApiPropertyOptional({ description: '审核意见' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comments?: string;
}

export class SetFeaturedDto {
  @ApiProperty({
    description: '精选案例 ID 有序列表（按数组顺序即为排序）',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  caseIds: string[];
}

export class UnpublishCaseDto {
  @ApiProperty({ description: '下线原因（紧急下线必填）' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}
