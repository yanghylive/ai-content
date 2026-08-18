// 案例展示中心 · 后台管理 API（M6：运营效率 + 内容健康 + 安全待办）
// 仅后台登录用户（admin/owner）可调用，路由复用 (dashboard) 布局鉴权。
import { api } from "./client";

export interface AdminKeyFeature {
  title: string;
  description: string;
}

export interface AdminMedia {
  id: string;
  mediaType: string;
  fileUrl?: string | null;
  externalUrl?: string | null;
  thumbnailUrl?: string | null;
  title?: string | null;
  caption?: string | null;
  altText?: string;
  deviceFrame?: string | null;
  sortOrder?: number;
}

export interface AdminDemoEndpoint {
  id: string;
  endpointType: string;
  targetUrl?: string | null;
  shortCode?: string | null;
  allowedDevices: string[];
  iframeAllowed: boolean;
  accessInstruction?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  fallbackType: string;
  fallbackTarget?: string | null;
  healthStatus: string;
  ownerUserId?: string | null;
}

export interface AdminAuthorization {
  id: string;
  recordType: string;
  grantor?: string | null;
  scope?: string | null;
  licenseName?: string | null;
  sourceUrl?: string | null;
  versionOrCommit?: string | null;
  reviewStatus: string;
  validFrom?: string | null;
  validUntil?: string | null;
  restrictionNotes?: string | null;
}

export interface AdminCase {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  provenanceType: string;
  clientVisibility: string;
  primaryPlatform?: string | null;
  platforms: string[];
  primaryIndustry?: string | null;
  industries: string[];
  capabilityTags: string[];
  businessProblem?: string | null;
  solutionSummary?: string | null;
  keyFeatures: AdminKeyFeature[];
  resultsSummary?: string | null;
  evidenceLevel: string;
  evidenceScope?: string | null;
  deliveryModes: string[];
  maturity: string;
  techSummary?: string | null;
  coverMedia?: { url?: string | null; thumbnailUrl?: string | null; altText?: string | null } | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status: string;
  publishedAt?: string | null;
  lastReviewedAt?: string | null;
  nextReviewAt?: string | null;
  ownerUserId?: string | null;
  reviewerUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  media: AdminMedia[];
  demoEndpoints: AdminDemoEndpoint[];
  authorizations: AdminAuthorization[];
}

export interface CaseAdminInput {
  title: string;
  slug?: string;
  subtitle?: string;
  provenanceType?: string;
  clientVisibility?: string;
  primaryPlatform?: string;
  platforms?: string[];
  primaryIndustry?: string;
  industries?: string[];
  capabilityTags?: string[];
  businessProblem?: string;
  solutionSummary?: string;
  keyFeatures?: AdminKeyFeature[];
  resultsSummary?: string;
  evidenceLevel?: string;
  evidenceScope?: string;
  deliveryModes?: string[];
  maturity?: string;
  techSummary?: string;
  coverMedia?: Record<string, unknown>;
  seoTitle?: string;
  seoDescription?: string;
  demoDataDeclaration?: boolean;
  media?: Array<{
    mediaType?: string;
    fileUrl?: string;
    externalUrl?: string;
    thumbnailUrl?: string;
    title?: string;
    caption?: string;
    altText: string;
    deviceFrame?: string;
    sortOrder?: number;
  }>;
  demoEndpoints?: Array<{
    endpointType: string;
    targetUrl?: string;
    shortCode?: string;
    allowedDevices?: string[];
    iframeAllowed?: boolean;
    accessInstruction?: string;
    validFrom?: string;
    validUntil?: string;
    fallbackType: string;
    fallbackTarget?: string;
    ownerUserId?: string;
  }>;
}

export interface AuditEntry {
  id: string;
  caseId: string;
  caseSlug: string;
  caseTitle: string;
  reviewType: string;
  submittedBy?: string | null;
  reviewedBy?: string | null;
  decision: string;
  comments?: string | null;
  changedFields: unknown;
  createdAt: string;
}

export interface FeaturedCase {
  caseId: string;
  slug: string;
  title: string;
  status: string;
  sortOrder: number;
}

export interface ContentHealthOverview {
  generatedAt: string;
  demoEndpoints: {
    total: number;
    healthy: number;
    warning: number;
    broken: number;
    expired: number;
    unknown: number;
  };
  demoEndpointAnomalies: Array<{
    endpointId: string;
    caseId: string;
    caseSlug: string;
    caseTitle: string;
    endpointType: string;
    healthStatus: string;
    lastCheckedAt?: string | null;
    ownerUserId?: string | null;
  }>;
  authorizationsExpiring: Array<{
    id: string;
    caseId: string;
    recordType: string;
    grantor?: string | null;
    licenseName?: string | null;
    validUntil: string;
    daysRemaining: number;
    window: "7d" | "30d";
  }>;
  reviewsDue: Array<{
    id: string;
    slug: string;
    title: string;
    status: string;
    nextReviewAt?: string | null;
    lastReviewedAt?: string | null;
    ownerUserId?: string | null;
    daysRemaining: number;
    overdue: boolean;
  }>;
}

export const caseAdminApi = {
  list: () => api.get<AdminCase[]>("/admin/cases"),
  get: (id: string) => api.get<AdminCase>(`/admin/cases/${id}`),
  create: (body: CaseAdminInput) => api.post<AdminCase>("/admin/cases", body),
  update: (id: string, body: CaseAdminInput) =>
    api.put<AdminCase>(`/admin/cases/${id}`, body),
  validate: (body: CaseAdminInput) =>
    api.post<{ complete: boolean; hints: string[] }>("/admin/cases/validate", body),
  submit: (id: string) => api.post<AdminCase>(`/admin/cases/${id}/submit`),
  review: (id: string, body: { decision: "approved" | "rejected" | "requested_changes"; comments?: string }) =>
    api.post<AdminCase>(`/admin/cases/${id}/review`, body),
  audit: (limit = 100) =>
    api.get<AuditEntry[]>(`/admin/case-audit?limit=${limit}`),
  featured: () => api.get<FeaturedCase[]>("/admin/featured"),
  setFeatured: (caseIds: string[]) =>
    api.put<FeaturedCase[]>("/admin/featured", { caseIds }),
  contentHealth: () => api.get<ContentHealthOverview>("/admin/content-health"),
};
