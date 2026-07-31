// Dashboard 统计 API
import { api } from './client';

export interface DashboardStats {
  collection: {
    todayCount: number;
    successRate: string;
  };
  pendingDraftArticles: number;
  topKeyword: string;
  articles: {
    todayCount: number;
    totalCount: number;
  };
}

export interface TrendDataPoint {
  date: string;
  total: number;
  [platform: string]: string | number; // 动态平台字段
}

export interface SystemLog {
  id: string;
  level: string;
  content: string;
  createdAt: string;
}

export interface RiskAuditEvidence {
  id: string;
  auditId: string;
  action: string;
  actionLabel: string;
  riskLevel: 'medium' | 'high' | 'unknown';
  status: 'allowed';
  targetLabel: string;
  targetId?: string;
  requestedCount?: number;
  affectedCount?: number;
  detail?: string;
  details?: RiskAuditEvidenceDetail[];
  summary: string;
  source: 'system-log';
  sourceLogId: string;
  level: string;
  createdAt: string;
  rawContent: string;
}

export interface RiskAuditEvidenceChecklistItem {
  label: string;
  checked: boolean;
}

export interface RiskAuditEvidenceIssue {
  code: string;
  scope: string;
  stage: string;
  message: string;
  nextAction: string;
  platform?: string;
  account?: string;
  field?: string;
  filePath?: string;
}

export interface RiskAuditEvidenceDetail {
  type: string;
  label: string;
  platform?: string;
  accountId?: string;
  operator?: string;
  confirmedAt?: string;
  confirmationId?: string;
  confirmedAction?: string;
  confirmedRiskLevel?: string;
  reason?: string;
  checklist?: RiskAuditEvidenceChecklistItem[];
  fullPermission?: boolean;
  status?: string;
  statusLabel?: string;
  summary?: string;
  failureReason?: string;
  nextAction?: string;
  publishTaskId?: string;
  publishUrl?: string;
  externalId?: string;
  evidenceSource?: string;
  evidenceUrl?: string;
  contentKind?: string;
  title?: string;
  materialCount?: number;
  coverCount?: number;
  tagCount?: number;
  scheduleSummary?: string;
  dryRun?: boolean;
  ok?: boolean;
  checkedAt?: string;
  issueCount?: number;
  payloadCount?: number;
  accountCount?: number;
  issues?: RiskAuditEvidenceIssue[];
}

export interface KeywordData {
  text: string;
  value: number;
}

export interface KeywordMatrix {
  highValueKeywords: KeywordData[];
  trendingMaterialKeywords: KeywordData[];
}

export interface DraftArticle {
  id: string;
  title: string;
  topicTitle?: string | null;
  templateName?: string | null;
  contentFormat: string;
  keywords: string[];
  createdAt: string;
}

export const dashboardApi = {
  // 核心指标统计 (新版)
  stats(signal?: AbortSignal) {
    return api.get<DashboardStats>('/dashboard/stats', { signal });
  },

  // 采集趋势
  collectionTrends(days: number = 7, signal?: AbortSignal) {
    return api.get<TrendDataPoint[]>(`/dashboard/collection-trends?days=${days}`, {
      signal,
    });
  },

  // 创作趋势
  creationTrends(days: number = 7, signal?: AbortSignal) {
    return api.get<TrendDataPoint[]>(`/dashboard/creation-trends?days=${days}`, {
      signal,
    });
  },

  // 关键词矩阵
  keywordMatrix() {
    return api.get<KeywordMatrix>('/dashboard/keyword-matrix');
  },

  // 最新待发布草稿
  draftArticles(limit: number = 5, signal?: AbortSignal) {
    return api.get<DraftArticle[]>(`/dashboard/draft-articles?limit=${limit}`, {
      signal,
    });
  },

  // 系统运行日志
  systemLogs(limit: number = 50, signal?: AbortSignal) {
    return api.get<SystemLog[]>(`/dashboard/system-logs?limit=${limit}`, {
      signal,
    });
  },

  // 风险审计证据索引
  riskAuditEvidence(limit: number = 50) {
    return api.get<RiskAuditEvidence[]>(
      `/dashboard/risk-audit-evidence?limit=${limit}`,
    );
  },
};
