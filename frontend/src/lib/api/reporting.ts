import { api } from "./client";

/** 效果报告（R3：AI 产出 ROI 看板） */

export interface EffectReport {
  generatedAt: string;
  range: "7d" | "30d";
  aiGenerated: { count: number };
  published: { count: number };
  exposure: { count: number | null; available: boolean };
  interactions: { count: number | null; available: boolean };
  weeklySummary: {
    text: string;
    sharePayload: string;
  };
  topContent: Array<{
    publishRecordId: string;
    articleId: string;
    title: string;
    platform: string;
    exposure: number | null;
    interactions: number | null;
    publishUrl: string | null;
  }>;
}

export function getEffects(range: "7d" | "30d" = "7d") {
  return api.get<EffectReport>(`/reporting/effects?range=${range}`);
}

// —— Sprint 4 T4.6：归因漏斗 ——

export interface FunnelStageMeta {
  stage: string;
  definition: string;
  denominator: string;
  value: number;
  naReason: string | null;
}

export interface FunnelReport {
  range: string;
  since: string;
  funnel: {
    content: number;
    publish: number;
    interaction: number;
    lead: number;
    customer: number;
    opportunity: number;
  };
  meta?: {
    window: string;
    lastSyncedAt: string;
    stages: FunnelStageMeta[];
  };
}

export function getFunnel(days: 7 | 30 = 7) {
  return api.get<FunnelReport>(`/reporting/funnel?days=${days}`);
}
