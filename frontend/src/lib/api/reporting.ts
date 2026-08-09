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
}

export function getEffects(range: "7d" | "30d" = "7d") {
  return api.get<EffectReport>(`/reporting/effects?range=${range}`);
}
