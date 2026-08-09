// 选题管理 API
import { api, PaginatedData } from './client';

export interface TopicScore {
  audienceFit: number;
  emotionalValue: number;
  simplificationPotential: number;
  networkVolume: number;
  contentValue: number;
}

export interface Topic {
  id: string;
  title: string;
  description?: string;
  summary?: string;
  sourceType: string;
  keywords: string[];
  searchQueries?: string[];
  aiScore: number | null;
  scoreDetails: TopicScore | null;
  scoreReason?: string;
  reasoning?: string;
  status: 'pending' | 'generating' | 'completed';
  isPublished: boolean;
  materials: { id: string; title: string; platform: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface TopicDiscoveryResult {
  created: number;
  message: string;
  topics: Topic[];
  analysis: {
    normalizedSeed: string;
    intent: string;
    audience: string;
    keywords: string[];
    searchQueries: string[];
  };
  retrieval: {
    scannedSources: number;
    fetchedCount: number;
    candidateCount: number;
    matchedCount: number;
    rejectedCount: number;
    savedCount: number;
  };
}

export interface TopicQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  status?: string;
  isPublished?: boolean;
  sortBy?: string; // date-desc, date-asc, score-desc, score-asc
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const topicsApi = {
  // 获取选题列表
  list(query: TopicQuery = {}) {
    return api.get<PaginatedData<Topic>>(`/topics${buildQuery(query as Record<string, unknown>)}`);
  },

  // 获取单个选题
  getById(id: string) {
    return api.get<Topic>(`/topics/${id}`);
  },

  // 创建选题
  create(data: { title: string; description?: string; summary?: string; sourceType?: string; materialIds?: string[]; keywords?: string[] }) {
    return api.post<Topic>('/topics', data);
  },

  // 触发 AI 全维度评估
  generate(id: string) {
    return api.post<{ score: number; details: TopicScore; reason: string; keywords: string[] }>(`/topics/${id}/generate`);
  },

  // 发布选题
  publish(id: string) {
    return api.post<Topic>(`/topics/${id}/publish`);
  },

  // 取消发布
  unpublish(id: string) {
    return api.post<Topic>(`/topics/${id}/unpublish`);
  },

  // 一键挖掘新选题（AI 聚类打分）
  mine() {
    return api.post<{ created: number; message: string }>('/topics/mine');
  },

  // 基于关键词/事件/描述智能挖出候选选题
  discover(seed: string) {
    return api.post<TopicDiscoveryResult>('/topics/discover', { seed });
  },

  // 删除选题
  remove(id: string) {
    return api.delete<Topic>(`/topics/${id}`);
  },
};
