import { api } from "./client";

/**
 * 案例展示中心公开 API 客户端。
 *
 * 消费后端 case-showcase 公开端点（匿名、无 auth），复用统一 fetch 封装，
 * 不在页面/组件内散落裸 fetch。
 */

export type ProvenanceType =
  | "delivery"
  | "open_source"
  | "prototype"
  | "template";

export type CaseSort = "recommended" | "updated" | "popular";

export interface PublicCoverDto {
  url: string | null;
  thumbnailUrl: string | null;
  altText: string | null;
}

export interface CaseSummaryDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  provenanceType: string;
  primaryPlatform: string | null;
  industries: string[];
  capabilityTags: string[];
  experienceStatus: boolean;
  coverMedia: PublicCoverDto | null;
  updatedAt: string;
}

export interface CaseListResult {
  data: CaseSummaryDto[];
  nextCursor: string | null;
}

export interface KeyFeatureDto {
  title: string;
  description: string;
}

export interface PublicMediaDto {
  id: string;
  mediaType: string;
  fileUrl: string | null;
  externalUrl: string | null;
  thumbnailUrl: string | null;
  title: string | null;
  caption: string | null;
  altText: string;
  deviceFrame: string | null;
  sortOrder: number;
}

export interface PublicDemoEndpointDto {
  id: string;
  endpointType: string;
  allowedDevices: string[];
  accessInstruction: string | null;
  validFrom: string | null;
  validUntil: string | null;
  fallbackType: string;
  healthStatus: string;
  shortCode: string | null;
}

export interface PublicAttributionDto {
  grantor: string | null;
  scope: string | null;
  licenseName: string | null;
  sourceUrl: string | null;
}

export interface CaseDetailDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  provenanceType: string;
  clientVisibility: string;
  primaryPlatform: string | null;
  platforms: string[];
  primaryIndustry: string | null;
  industries: string[];
  capabilityTags: string[];
  businessProblem: string | null;
  solutionSummary: string | null;
  keyFeatures: KeyFeatureDto[];
  resultsSummary: string | null;
  evidenceLevel: string;
  evidenceScope: string | null;
  deliveryModes: string[];
  maturity: string;
  techSummary: string | null;
  coverMedia: PublicCoverDto | null;
  media: PublicMediaDto[];
  demoEndpoints: PublicDemoEndpointDto[];
  attribution: PublicAttributionDto[];
  disclaimer: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface CaseDetailResult extends CaseDetailDto {
  relatedCases: CaseSummaryDto[];
}

export interface TaxonomyDto {
  id: string;
  type: string;
  slug: string;
  name: string;
  sortOrder: number;
}

export interface TaxonomyResult {
  platform: TaxonomyDto[];
  industry: TaxonomyDto[];
  capability: TaxonomyDto[];
}

export interface CaseListParams {
  q?: string;
  platform?: string;
  industry?: string;
  capability?: string;
  provenance?: string;
  experience?: "true" | "false";
  sort?: CaseSort;
  cursor?: string;
  limit?: number;
}

function buildQuery(params: CaseListParams): string {
  const qs = new URLSearchParams();
  (Object.keys(params) as Array<keyof CaseListParams>).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null || value === "") return;
    qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `?${query}` : "";
}

export function listCases(params: CaseListParams = {}): Promise<CaseListResult> {
  return api.get<CaseListResult>(`/v1/cases${buildQuery(params)}`);
}

export function getCase(slug: string): Promise<CaseDetailResult> {
  return api.get<CaseDetailResult>(`/v1/cases/${encodeURIComponent(slug)}`);
}

export function getTaxonomies(): Promise<TaxonomyResult> {
  return api.get<TaxonomyResult>("/v1/taxonomies");
}

/** 公开案例合集（合集公开信息 + 仍发布的案例摘要） */
export interface CollectionDto {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  coverMedia: PublicCoverDto | null;
  visibility: string;
  cases: CaseSummaryDto[];
  validUntil: string | null;
  updatedAt: string;
}

export type ContactType = "phone" | "email" | "wechat" | "other";

export interface InquirySubmitPayload {
  name: string;
  contactType?: ContactType;
  contactValue: string;
  message: string;
  company?: string;
  position?: string;
  preferredTime?: string;
  consent: boolean;
  consentVersion?: string;
  sourceCaseSlug?: string;
  sourceCollectionSlug?: string;
  channelCode?: string;
}

/** 咨询提交响应：仅回咨询编号，不回传联系方式/完整记录 */
export interface InquiryResult {
  inquiryId: string | null;
}

export function getCollection(slug: string): Promise<CollectionDto> {
  return api.get<CollectionDto>(
    `/v1/collections/${encodeURIComponent(slug)}`,
  );
}

export function submitInquiry(
  payload: InquirySubmitPayload,
): Promise<InquiryResult> {
  return api.post<InquiryResult>("/v1/inquiries", payload);
}

