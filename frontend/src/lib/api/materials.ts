// 素材管理 API
import { api, PaginatedData } from './client';

export interface Material {
  id: string;
  title: string;
  content?: string;
  summary?: string;
  sourceUrl: string;
  platform: string;
  author: string;
  publishDate: string | null;
  collectDate: string;
  status: 'unmined' | 'mined' | 'failed';
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MaterialStats {
  total: number;
  unmined: number;
  mined: number;
  failed: number;
  byPlatform: { platform: string; count: number }[];
}

export type MaterialRiskAction = 'material-delete' | 'material-batch-delete';
export type MaterialRiskLevel = 'low' | 'medium' | 'high';

export interface MaterialRiskConfirmationInput {
  confirmed: boolean;
  confirmedAction: MaterialRiskAction;
  confirmedRiskLevel: MaterialRiskLevel;
  confirmationId?: string;
  operator?: string;
  reason?: string;
  note?: string;
  confirmedAt?: string;
  checklist?: Record<string, boolean>;
  fullPermission?: boolean;
}

export interface MaterialRiskAuditEvent {
  id: string;
  action: MaterialRiskAction;
  target?: string;
  riskLevel: MaterialRiskLevel;
  status: 'allowed' | 'approval_required' | 'blocked';
  reason: string;
  createdAt: string;
  confirmationRecord?: {
    confirmed: boolean;
    confirmationId?: string;
    operator: string;
    reason?: string;
    confirmedAt: string;
    confirmedAction?: string;
    confirmedRiskLevel?: string;
    checklist?: Record<string, boolean>;
  };
}

export type MaterialDeleteResult = Material & {
  riskAudit?: MaterialRiskAuditEvent;
};

export function buildMaterialRiskConfirmation(
  action: MaterialRiskAction,
  level: MaterialRiskLevel,
): MaterialRiskConfirmationInput {
  return {
    confirmed: true,
    confirmedAction: action,
    confirmedRiskLevel: level,
    confirmationId: `material_${Date.now().toString(36)}`,
  };
}

export interface MaterialCollectJob {
  id: string;
  state: string;
  sourceName: string;
  platform: string | null;
  attemptsMade: number;
  progress: number;
  failedReason: string | null;
  processedOn: string | null;
  finishedOn: string | null;
  timestamp: string | null;
  result: { sourceName?: string; total?: number; saved?: number } | null;
}

export interface MaterialCollectStatus {
  active: boolean;
  pendingCount: number;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  };
  activeJobs: MaterialCollectJob[];
  waitingJobs: MaterialCollectJob[];
  recentJobs: MaterialCollectJob[];
  trackedJobs: MaterialCollectJob[];
  checkedAt: string;
}

export interface MaterialQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  platform?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// 构建查询字符串
function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const materialsApi = {
  // 获取素材列表（分页、筛选、排序）
  list(query: MaterialQuery = {}) {
    return api.get<PaginatedData<Material>>(`/materials${buildQuery(query as Record<string, unknown>)}`);
  },

  // 获取单个素材
  getById(id: string) {
    return api.get<Material>(`/materials/${id}`);
  },

  // 获取素材统计
  stats() {
    return api.get<MaterialStats>('/materials/stats');
  },

  // 触发采集任务
  collect(sourceIds?: string[]) {
    return api.post<{ jobCount: number; jobIds: string[]; message: string }>('/materials/collect', { sourceIds });
  },

  // 获取采集队列状态
  collectStatus(jobIds: string[] = []) {
    const query = jobIds.length ? `?jobIds=${encodeURIComponent(jobIds.join(','))}` : '';
    return api.get<MaterialCollectStatus>(`/materials/collect/status${query}`);
  },

  // 删除素材
  remove(id: string, riskConfirmation?: MaterialRiskConfirmationInput) {
    return api.delete<MaterialDeleteResult>(`/materials/${id}`, {
      riskConfirmation,
    });
  },

  // 批量删除
  batchRemove(ids: string[], riskConfirmation?: MaterialRiskConfirmationInput) {
    return api.post<{
      deleted: number;
      requested?: number;
      riskAudit?: MaterialRiskAuditEvent;
    }>('/materials/batch-delete', { ids, riskConfirmation });
  },
};
