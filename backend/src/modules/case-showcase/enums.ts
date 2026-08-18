/**
 * 案例展示中心（case-showcase）枚举定义。
 *
 * 唯一真源：本文件是四类案例来源、状态机、证据等级、交付方式等取值的权威定义，
 * 供校验服务（case-validation.service.ts）、状态机（state-machine.ts）与 DTO 白名单共用。
 *
 * 采用 `as const` 对象 + 字符串字面量联合类型的写法（而非 TS `enum`）：
 *   - 与 Prisma schema 中对应 String 字段的取值保持一致（DB 层不建 PostgreSQL enum）；
 *   - 避免 TS enum 与外部字符串比较时触发 `@typescript-eslint/no-unsafe-enum-comparison`；
 *   - 每个「枚举」同时导出值对象（ProvenanceType.Delivery）与联合类型（ProvenanceType）。
 */

/** 四类案例来源（PRD 核心区分，首屏必须文字标识） */
export const ProvenanceType = {
  /** 九章交付案例 */
  Delivery: 'delivery',
  /** 开源演示案例 */
  OpenSource: 'open_source',
  /** 概念原型 */
  Prototype: 'prototype',
  /** 可定制模板 */
  Template: 'template',
} as const;
export type ProvenanceType =
  (typeof ProvenanceType)[keyof typeof ProvenanceType];

/** 客户可见性 */
export const ClientVisibility = {
  Public: 'public',
  Limited: 'limited',
} as const;
export type ClientVisibility =
  (typeof ClientVisibility)[keyof typeof ClientVisibility];

/** 证据等级：E0 无证据 → E3 最强证据 */
export const EvidenceLevel = {
  E0: 'E0',
  E1: 'E1',
  E2: 'E2',
  E3: 'E3',
} as const;
export type EvidenceLevel = (typeof EvidenceLevel)[keyof typeof EvidenceLevel];

/** 案例生命周期状态机 */
export const CaseStatus = {
  Draft: 'draft',
  Submitted: 'submitted',
  Approved: 'approved',
  Published: 'published',
  Unpublished: 'unpublished',
  Archived: 'archived',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];

/** 案例成熟度 */
export const Maturity = {
  Concept: 'concept',
  Prototype: 'prototype',
  Mvp: 'mvp',
  Product: 'product',
  Scale: 'scale',
} as const;
export type Maturity = (typeof Maturity)[keyof typeof Maturity];

/** 交付/体验方式 */
export const DeliveryMode = {
  H5: 'h5',
  Web: 'web',
  WechatMiniProgram: 'wechat_mini_program',
  Download: 'download',
  Appointment: 'appointment',
} as const;
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

/** 媒体类型 */
export const MediaType = {
  Image: 'image',
  Video: 'video',
  Document: 'document',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

/** 演示体验入口类型 */
export const EndpointType = {
  H5: 'h5',
  Web: 'web',
  WechatMiniProgram: 'wechat_mini_program',
  Download: 'download',
  Appointment: 'appointment',
} as const;
export type EndpointType = (typeof EndpointType)[keyof typeof EndpointType];

/** 审核决策 */
export const ReviewDecision = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  RequestedChanges: 'requested_changes',
} as const;
export type ReviewDecision =
  (typeof ReviewDecision)[keyof typeof ReviewDecision];

/** 合集可见性 */
export const CollectionVisibility = {
  Public: 'public',
  LinkOnly: 'link_only',
  Internal: 'internal',
} as const;
export type CollectionVisibility =
  (typeof CollectionVisibility)[keyof typeof CollectionVisibility];

/** 分类类型（平台/行业/能力） */
export const TaxonomyType = {
  Platform: 'platform',
  Industry: 'industry',
  Capability: 'capability',
} as const;
export type TaxonomyType = (typeof TaxonomyType)[keyof typeof TaxonomyType];

/** 授权记录类型 */
export const AuthorizationRecordType = {
  CustomerAuthorization: 'customer_authorization',
  OssLicense: 'oss_license',
  Trademark: 'trademark',
  Other: 'other',
} as const;
export type AuthorizationRecordType =
  (typeof AuthorizationRecordType)[keyof typeof AuthorizationRecordType];

/** 演示入口回退类型（无回退不得公开） */
export const FallbackType = {
  Media: 'media',
  Url: 'url',
  None: 'none',
} as const;
export type FallbackType = (typeof FallbackType)[keyof typeof FallbackType];

/** 短链目标类型 */
export const ShortLinkTargetType = {
  Case: 'case',
  Collection: 'collection',
  DemoEndpoint: 'demo_endpoint',
  External: 'external',
} as const;
export type ShortLinkTargetType =
  (typeof ShortLinkTargetType)[keyof typeof ShortLinkTargetType];

/** 全部四类来源取值（校验用） */
export const PROVENANCE_TYPES: readonly string[] =
  Object.values(ProvenanceType);

/** 全部证据等级取值（校验用） */
export const EVIDENCE_LEVELS: readonly string[] = Object.values(EvidenceLevel);

/** 全部案例状态取值（校验用） */
export const CASE_STATUSES: readonly string[] = Object.values(CaseStatus);

/** 全部成熟度取值（校验用） */
export const MATURITY_LEVELS: readonly string[] = Object.values(Maturity);

/** 全部分类类型取值（校验用） */
export const TAXONOMY_TYPES: readonly string[] = Object.values(TaxonomyType);

/** 全部回退类型取值（校验用） */
export const FALLBACK_TYPES: readonly string[] = Object.values(FallbackType);

/** 全部授权记录类型取值（校验用） */
export const AUTHORIZATION_RECORD_TYPES: readonly string[] = Object.values(
  AuthorizationRecordType,
);
