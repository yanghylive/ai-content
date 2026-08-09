import { api } from './client';

export interface ContentStrategy {
  id: string;
  name: string;
  description?: string | null;
  industry: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string | null;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentStrategyPayload {
  name: string;
  description?: string;
  industry?: string;
  targetAudience: string;
  commercialGoal: string;
  corePainPoints: string;
  writingAngles: string;
  toneAndStyle?: string;
  isDefault?: boolean;
  enabled?: boolean;
}

export const contentStrategiesApi = {
  list() {
    return api.get<ContentStrategy[]>('/content-strategies');
  },

  getDefault() {
    return api.get<ContentStrategy>('/content-strategies/default');
  },

  create(data: ContentStrategyPayload) {
    return api.post<ContentStrategy>('/content-strategies', data);
  },

  update(id: string, data: Partial<ContentStrategyPayload>) {
    return api.put<ContentStrategy>(`/content-strategies/${id}`, data);
  },

  remove(id: string) {
    return api.delete<ContentStrategy>(`/content-strategies/${id}`);
  },

  setDefault(id: string) {
    return api.patch<ContentStrategy[]>(`/content-strategies/${id}/default`);
  },
};

/* ===== 行业模板库（2026-08-09 商用能力补齐 R1） ===== */

export interface IndustryInfo {
  industry: string;
  name: string;
  description?: string | null;
  templateCount: Record<string, number>;
}

export interface StrategyTemplate {
  id: string;
  industry: string;
  type: string;
  scene?: string | null;
  hook?: string | null;
  title?: string | null;
  content?: string | null;
  toneHint?: string | null;
  isHot: boolean;
}

export const strategyTemplateApi = {
  /** 行业清单（创作页选择器用） */
  industries() {
    return api.get<{ items: IndustryInfo[] }>('/content-strategies/industries');
  },

  /** 查询行业模板（按行业/类型过滤） */
  templates(input: { industry?: string; type?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (input.industry) params.set('industry', input.industry);
    if (input.type) params.set('type', input.type);
    if (input.limit) params.set('limit', String(input.limit));
    const qs = params.toString();
    return api.get<{ items: StrategyTemplate[]; total: number }>(
      `/content-strategies/templates${qs ? `?${qs}` : ''}`,
    );
  },

  /** 用户改稿/爆款沉淀回库 */
  feedback(input: { industry: string; type: string; title?: string; content?: string }) {
    return api.post<StrategyTemplate>('/content-strategies/templates/feedback', input);
  },
};
