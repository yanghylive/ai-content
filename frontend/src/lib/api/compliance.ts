import { api } from "./client";

// ---- 发布前合规预检（统一到后端 compliance.service，报告 4.5）----

export type ComplianceRiskLevel = "pass" | "low" | "medium" | "high";

export type ComplianceFinding = {
  id: string;
  category: string;
  riskLevel: ComplianceRiskLevel;
  matchedText: string;
  reason: string;
  suggestion: string;
  replacement?: string;
};

export type ComplianceGate = {
  publishAllowed: boolean;
  manualReviewRequired: boolean;
  reason: string;
  nextActions: string[];
};

export type ComplianceCheckResult = {
  checkId: string;
  targetType: string;
  targetId?: string;
  platform: string;
  riskLevel: ComplianceRiskLevel;
  riskScore: number;
  summary: string;
  findings: ComplianceFinding[];
  suggestions: string[];
  gate: ComplianceGate;
};

export function checkCompliance(input: {
  content: string;
  platform?: string;
  targetType?: string;
  targetId?: string;
  title?: string;
  scenario?: string;
}) {
  return api.post<ComplianceCheckResult>("/compliance/check", input);
}
