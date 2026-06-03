// 设置管理 API（AI 平台、模型、默认模型配置）
import { api } from './client';

// AI 平台
export interface AIPlatform {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models?: AIModel[];
  createdAt: string;
  updatedAt: string;
}

// AI 模型
export interface AIModel {
  id: string;
  name: string;
  modelId: string;
  platformId: string;
  enabled: boolean;
  platform?: AIPlatform;
  createdAt: string;
  updatedAt: string;
}

// 默认模型配置
export interface DefaultModels {
  articleCreation: string;
  imageCreation: string;
  xCollection: string;
  topicSelection: string;
}

export const settingsApi = {
  // === AI 平台 ===
  listPlatforms() {
    return api.get<AIPlatform[]>('/ai-platforms');
  },
  createPlatform(data: { name: string; baseUrl: string; apiKey: string }) {
    return api.post<AIPlatform>('/ai-platforms', data);
  },
  updatePlatform(id: string, data: Partial<{ name: string; baseUrl: string; apiKey: string }>) {
    return api.put<AIPlatform>(`/ai-platforms/${id}`, data);
  },
  deletePlatform(id: string) {
    return api.delete<AIPlatform>(`/ai-platforms/${id}`);
  },

  // === AI 模型 ===
  listModels(platformId?: string) {
    const query = platformId ? `?platformId=${platformId}` : '';
    return api.get<AIModel[]>(`/ai-models${query}`);
  },
  createModel(data: { name: string; modelId: string; platformId: string }) {
    return api.post<AIModel>('/ai-models', data);
  },
  updateModel(id: string, data: Partial<{ name: string; modelId: string; platformId: string }>) {
    return api.put<AIModel>(`/ai-models/${id}`, data);
  },
  deleteModel(id: string) {
    return api.delete<AIModel>(`/ai-models/${id}`);
  },
  testModel(data: { platformId: string; modelId: string }) {
    return api.post<{ success: boolean; message: string; reply: string }>('/ai-models/test', data);
  },

  // === 默认模型配置 ===
  getDefaults() {
    return api.get<DefaultModels>('/ai-models/defaults');
  },
  updateDefaults(data: Partial<DefaultModels>) {
    return api.put<DefaultModels>('/ai-models/defaults', data);
  },
};

// === 存储配置 ===

export interface StorageConfig {
  provider: 'local' | 'qiniu' | 'aliyun-oss';
  accessKey: string;
  secretKey: string;
  bucket: string;
  domain: string;
  endpoint?: string;
  region?: string;
}

export const storageApi = {
  getConfig: () => api.get<StorageConfig>('/storage/config'),
  updateConfig: (data: StorageConfig) => api.put<{ success: boolean; message: string }>('/storage/config', data),
  testConnection: () => api.post<{ success: boolean; message: string }>('/storage/config/test', {}),
};


// === 信息源管理 ===

export interface Source {
  id: string;
  name: string;
  type: string; // rss | api | crawler
  url: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  lastCrawlTime?: string;
  createdAt: string;
  updatedAt: string;
}

export const sourcesApi = {
  // 获取全部信息源
  list: () => api.get<Source[]>('/sources'),

  // 获取单个信息源
  getById: (id: string) => api.get<Source>(`/sources/${id}`),

  // 创建信息源
  create: (data: Partial<Source>) => api.post<Source>('/sources', data),

  // 更新信息源
  update: (id: string, data: Partial<Source>) => api.put<Source>(`/sources/${id}`, data),

  // 切换启用/禁用
  toggle: (id: string) => api.patch<Source>(`/sources/${id}/toggle`),

  // 删除信息源
  remove: (id: string) => api.delete<void>(`/sources/${id}`),

  // 初始化默认信息源
  seed: () => api.post<{ created: number; skipped: number }>('/sources/seed', {}),
};
