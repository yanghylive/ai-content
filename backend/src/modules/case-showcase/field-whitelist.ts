import { CaseSummaryDto, PublicCoverDto } from './dto/case-summary.dto';
import {
  CaseDetailDto,
  PublicAttributionDto,
  PublicDemoEndpointDto,
  PublicMediaDto,
} from './dto/case-detail.dto';
import { KeyFeatureDto } from './dto/key-feature.dto';
import { CollectionDto } from './dto/collection.dto';
import { TaxonomyDto } from './dto/taxonomy.dto';

/**
 * 公开字段白名单（安全边界核心）。
 *
 * 架构 ADR-02：公开接口走显式 DTO 白名单，禁用 Prisma model 整体序列化。
 * 本文件提供显式 pick 的映射函数，绝不 spread 整个 model。
 *
 * 禁止公开字段（任何公开响应都不得出现）：
 *   - internalCustomerAlias：内部客户简称
 *   - attachment：授权附件（私有，仅审核人/管理员可读）
 *   - contactValue：咨询联系方式（加密落 Lead，公开响应仅回咨询编号）
 *   - targetUrl：演示入口内部目标地址配置
 *   - 以及演示凭据、审核意见、内部项目编号等一切私有字段
 */

/** 公开响应禁止出现的字段（泄露测试以此为准） */
export const FORBIDDEN_PUBLIC_FIELDS = [
  'internalCustomerAlias',
  'attachment',
  'contactValue',
  'targetUrl',
] as const;

/** 来源 → 固定免责声明（PRD 附录 B.1~B.4 原文，不含私有授权附件） */
const PROVENANCE_DISCLAIMERS: Record<string, string> = {
  delivery:
    '本案例为九章参与的真实交付项目。根据客户授权和保密要求，客户名称、部分界面及业务数据已经隐去或替换，展示内容不影响案例事实和九章参与范围的真实性。',
  open_source:
    '本页面用于展示公开开源项目所体现的产品与技术能力，并非九章客户交付项目。原项目名称、作者/组织、仓库地址和许可证见“来源与许可”。九章如有部署、适配或二次开发，将在页面中单独说明。',
  prototype:
    '本案例为方案沟通和产品构想使用的概念原型，采用演示数据，不代表已经完成正式客户上线。实际功能、工期和交付范围以双方确认的需求和合同为准。',
  template:
    '本页面展示可复用的产品结构和能力模板，内容及数据均为演示用途。可根据客户品牌、业务流程、系统接口和部署要求进行二次设计与开发，实际交付范围以确认需求为准。',
};

/**
 * 输入侧「完整 model」形状。M1 尚未 regenerate Prisma Client，
 * 故以独立 interface 描述字段（字段名与 schema 对齐），待 M2 接入 Prisma 后
 * 替换为 Prisma.ShowcaseCaseGetPayload 等真实类型。
 */
export interface ShowcaseCaseRecord {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  provenanceType?: string;
  clientVisibility?: string;
  primaryPlatform?: string | null;
  platforms?: string[];
  primaryIndustry?: string | null;
  industries?: string[];
  capabilityTags?: string[];
  businessProblem?: string | null;
  solutionSummary?: string | null;
  keyFeatures?: KeyFeatureRecord[];
  resultsSummary?: string | null;
  evidenceLevel?: string;
  evidenceScope?: string | null;
  deliveryModes?: string[];
  maturity?: string;
  techSummary?: string | null;
  coverMedia?: unknown;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: string;
  publishedAt?: Date | string | null;
  updatedAt?: Date | string;
  media?: ShowcaseMediaRecord[];
  demoEndpoints?: ShowcaseDemoEndpointRecord[];
  authorizations?: ShowcaseAuthorizationRecord[];
}

/** 授权记录（含私有附件，仅审核人/管理员可读，绝不进公开 DTO） */
export interface ShowcaseAuthorizationRecord {
  id?: string;
  recordType?: string;
  grantor?: string | null;
  scope?: string | null;
  licenseName?: string | null;
  sourceUrl?: string | null;
  versionOrCommit?: string | null;
  attachment?: string | null;
  reviewStatus?: string;
}

/** 关键特性（结构化，PRD §11.1：title + description） */
export interface KeyFeatureRecord {
  title?: string;
  description?: string;
}

export interface ShowcaseMediaRecord {
  id: string;
  mediaType?: string;
  fileUrl?: string | null;
  externalUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  caption?: string | null;
  altText?: string;
  deviceFrame?: string | null;
  sortOrder?: number;
  // 内部字段（永不公开）：checksum / rightsStatus / sensitiveReviewed
}

export interface ShowcaseDemoEndpointRecord {
  id: string;
  endpointType?: string;
  allowedDevices?: string[];
  iframeAllowed?: boolean;
  accessInstruction?: string | null;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  fallbackType?: string;
  healthStatus?: string;
  shortCode?: string | null;
  // 内部字段（永不公开）：targetUrl / fallbackTarget / ownerUserId
}

export interface ShowcaseCollectionRecord {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  coverMedia?: unknown;
  visibility?: string;
  validUntil?: Date | string | null;
  updatedAt?: Date | string;
  cases?: ShowcaseCaseRecord[];
  // 内部字段（永不公开）：channelCode / internalCustomerAlias / ownerUserId / status
}

export interface ShowcaseTaxonomyRecord {
  id: string;
  type?: string;
  slug?: string;
  name?: string;
  sortOrder?: number;
}

export interface InquiryRecord {
  inquiryId?: string | null;
  contactValue?: string;
}

/** 咨询提交响应：仅回咨询编号（架构 §4.4） */
export interface InquiryResponseDto {
  inquiryId: string | null;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 关键特性白名单：仅提取 title / description，丢弃多余字段 */
function toKeyFeatureDto(record: KeyFeatureRecord): KeyFeatureDto {
  return {
    title: typeof record.title === 'string' ? record.title : '',
    description:
      typeof record.description === 'string' ? record.description : '',
  };
}

/** 封面白名单：仅提取 url / thumbnailUrl / altText，丢弃其余字段 */
function toPublicCover(coverMedia: unknown): PublicCoverDto | null {
  if (
    !coverMedia ||
    typeof coverMedia !== 'object' ||
    Array.isArray(coverMedia)
  ) {
    return null;
  }
  const raw = coverMedia as Record<string, unknown>;
  const pick = (key: string): string | null =>
    typeof raw[key] === 'string' ? raw[key] : null;
  const url = pick('url');
  const thumbnailUrl = pick('thumbnailUrl');
  const altText = pick('altText');
  if (url === null && thumbnailUrl === null && altText === null) return null;
  return { url, thumbnailUrl, altText };
}

function toPublicMedia(record: ShowcaseMediaRecord): PublicMediaDto {
  return {
    id: record.id,
    mediaType: record.mediaType ?? 'image',
    fileUrl: record.fileUrl ?? null,
    externalUrl: record.externalUrl ?? null,
    thumbnailUrl: record.thumbnailUrl ?? null,
    title: record.title ?? null,
    caption: record.caption ?? null,
    altText: record.altText ?? '',
    deviceFrame: record.deviceFrame ?? null,
    sortOrder: record.sortOrder ?? 0,
  };
}

function toPublicDemoEndpoint(
  record: ShowcaseDemoEndpointRecord,
): PublicDemoEndpointDto {
  return {
    id: record.id,
    endpointType: record.endpointType ?? 'web',
    allowedDevices: toStringArray(record.allowedDevices),
    accessInstruction: record.accessInstruction ?? null,
    validFrom: toIsoString(record.validFrom),
    validUntil: toIsoString(record.validUntil),
    fallbackType: record.fallbackType ?? 'media',
    healthStatus: record.healthStatus ?? 'unknown',
    shortCode: record.shortCode ?? null,
  };
}

/** 授权归属白名单：仅提取 grantor/scope/licenseName/sourceUrl，剥离附件等私有字段 */
function toPublicAttribution(
  record: ShowcaseAuthorizationRecord,
): PublicAttributionDto {
  return {
    grantor: record.grantor ?? null,
    scope: record.scope ?? null,
    licenseName: record.licenseName ?? null,
    sourceUrl: record.sourceUrl ?? null,
  };
}

function disclaimerFor(provenanceType?: string): string | null {
  if (!provenanceType) return null;
  return PROVENANCE_DISCLAIMERS[provenanceType] ?? null;
}

/** 案例摘要白名单映射（列表卡片） */
export function toCaseSummaryDto(record: ShowcaseCaseRecord): CaseSummaryDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    subtitle: record.subtitle ?? null,
    provenanceType: record.provenanceType ?? 'prototype',
    primaryPlatform: record.primaryPlatform ?? null,
    industries: toStringArray(record.industries),
    capabilityTags: toStringArray(record.capabilityTags),
    experienceStatus: (record.demoEndpoints ?? []).length > 0,
    coverMedia: toPublicCover(record.coverMedia),
    updatedAt: toIsoString(record.updatedAt) ?? '',
  };
}

/** 案例详情白名单映射（详情页） */
export function toCaseDetailDto(record: ShowcaseCaseRecord): CaseDetailDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    subtitle: record.subtitle ?? null,
    provenanceType: record.provenanceType ?? 'prototype',
    clientVisibility: record.clientVisibility ?? 'public',
    primaryPlatform: record.primaryPlatform ?? null,
    platforms: toStringArray(record.platforms),
    primaryIndustry: record.primaryIndustry ?? null,
    industries: toStringArray(record.industries),
    capabilityTags: toStringArray(record.capabilityTags),
    businessProblem: record.businessProblem ?? null,
    solutionSummary: record.solutionSummary ?? null,
    keyFeatures: (record.keyFeatures ?? []).map(toKeyFeatureDto),
    resultsSummary: record.resultsSummary ?? null,
    evidenceLevel: record.evidenceLevel ?? 'E0',
    evidenceScope: record.evidenceScope ?? null,
    deliveryModes: toStringArray(record.deliveryModes),
    maturity: record.maturity ?? 'concept',
    techSummary: record.techSummary ?? null,
    coverMedia: toPublicCover(record.coverMedia),
    media: (record.media ?? []).map(toPublicMedia),
    demoEndpoints: (record.demoEndpoints ?? []).map(toPublicDemoEndpoint),
    attribution: (record.authorizations ?? []).map(toPublicAttribution),
    disclaimer: disclaimerFor(record.provenanceType),
    seoTitle: record.seoTitle ?? null,
    seoDescription: record.seoDescription ?? null,
    publishedAt: toIsoString(record.publishedAt),
    updatedAt: toIsoString(record.updatedAt) ?? '',
  };
}

/** 合集白名单映射（仅公开字段 + 有序案例摘要） */
export function toCollectionDto(
  record: ShowcaseCollectionRecord,
): CollectionDto {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description ?? null,
    coverMedia: toPublicCover(record.coverMedia),
    visibility: record.visibility === 'link_only' ? 'link_only' : 'public',
    cases: (record.cases ?? []).map(toCaseSummaryDto),
    validUntil: toIsoString(record.validUntil),
    updatedAt: toIsoString(record.updatedAt) ?? '',
  };
}

/** 分类白名单映射 */
export function toTaxonomyDto(record: ShowcaseTaxonomyRecord): TaxonomyDto {
  return {
    id: record.id,
    type: record.type ?? 'platform',
    slug: record.slug ?? '',
    name: record.name ?? '',
    sortOrder: record.sortOrder ?? 0,
  };
}

/** 咨询响应白名单映射：仅回咨询编号，绝不回显联系方式 */
export function toInquiryResponseDto(
  record: InquiryRecord,
): InquiryResponseDto {
  return { inquiryId: record.inquiryId ?? null };
}

/**
 * 递归检测对象树中是否含禁止公开字段，返回命中的字段路径列表。
 * 供泄露测试与未来控制器出口守卫使用（空数组 = 通过）。
 */
export function findForbiddenFields(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      findForbiddenFields(item, `${path}[${index}]`),
    );
  }
  if (value && typeof value === 'object') {
    const hits: string[] = [];
    for (const [key, item] of Object.entries(value)) {
      const fullPath = path ? `${path}.${key}` : key;
      if ((FORBIDDEN_PUBLIC_FIELDS as readonly string[]).includes(key)) {
        hits.push(fullPath);
      }
      hits.push(...findForbiddenFields(item, fullPath));
    }
    return hits;
  }
  return [];
}
