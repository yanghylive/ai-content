/** 数据质量：complete=完整权威统计；partial=部分口径待统一；missing=无数据源 */
export type StatsDataQuality = 'complete' | 'partial' | 'missing';

/** 单个统计指标（方案 4.3 统一 StatsSnapshot 的组成单元） */
export interface StatsMetric {
  /** 唯一标识，如 'today.leads' */
  key: string;
  /** 展示名，如 '今日新线索' */
  label: string;
  /** 数值；null 表示无数据（前端显示 N/A 而非 0） */
  value: number | null;
  /** 定义说明（口径，方案 10.2） */
  definition?: string;
  /** 计算公式（方案 10.2），如 'COUNT(leads) WHERE updatedAt>=today' */
  formula?: string;
  /** 时间范围，如 'today' | 'last_7_days' | 'cumulative' */
  period?: string;
  /** 归因窗口（方案 10.2），如 '7 天回溯归因' */
  attributionWindow?: string;
  /** 平台缺失或不支持说明（方案 10.2），无缺失时为 null */
  platformGap?: string | null;
  /** 样本量（方案 10.2） */
  sampleSize?: number;
  /** 置信度（方案 10.2），样本量小/无数据时为 low/none */
  confidence?: 'none' | 'low' | 'medium' | 'high';
  /** 数据更新时间 */
  lastSyncedAt?: string;
  /** 数据质量 */
  dataQuality?: StatsDataQuality;
}

/** 统一统计快照（方案 4.3：前端不再多接口自行拼数） */
export interface StatsSnapshot {
  domain: string;
  generatedAt: string;
  metrics: StatsMetric[];
}
