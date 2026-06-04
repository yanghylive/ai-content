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
  remove(id: string) {
    return api.delete<Material>(`/materials/${id}`);
  },

  // 批量删除
  batchRemove(ids: string[]) {
    return api.post<{ deleted: number }>('/materials/batch-delete', { ids });
  },
};
