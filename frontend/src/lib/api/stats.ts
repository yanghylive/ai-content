import { api } from './client';

export type StatsDataQuality = 'complete' | 'partial' | 'missing';

export interface StatsMetric {
  key: string;
  label: string;
  value: number | null;
  definition?: string;
  period?: string;
  lastSyncedAt?: string;
  dataQuality?: StatsDataQuality;
}

export interface StatsSnapshot {
  domain: string;
  generatedAt: string;
  metrics: StatsMetric[];
}

/** 统一统计快照（方案 4.3 状态事实源）：前端不再多接口自行拼数 */
export const statsApi = {
  snapshot(domain = 'today') {
    return api.get<StatsSnapshot>(`/stats/snapshot?domain=${domain}`);
  },
};
