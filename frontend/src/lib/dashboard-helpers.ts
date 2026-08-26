/**
 * Dashboard 通用工具函数（从 layout.tsx 抽出，P0-2 拆分）
 */

import type { KaypalBillingSnapshot, AuthUser } from "@/lib/api/auth";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function formatPlanLabel(value?: string | null, fallback = "未同步") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;
  const labels: Record<string, string> = {
    FREE: "免费版",
    PRO: "专业版",
    ADVANCED: "高级版",
    ENTERPRISE: "企业版",
  };
  return labels[normalized.toUpperCase()] || normalized;
}

export function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未同步";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export function getBillingPlan(billing: KaypalBillingSnapshot | null) {
  const raw = billing?.subscription;
  const record = asRecord(raw);
  if (!record) return null;
  const data = asRecord(record.data) || record;
  const subscription = asRecord(data.subscription) || data;
  const plan = subscription.plan;
  if (typeof plan === "string") return plan;
  const planRecord = asRecord(plan);
  if (planRecord) {
    return String(planRecord.legacyId || planRecord.code || planRecord.name || "").trim() || null;
  }
  const subscriptionPlan = subscription.subscriptionPlan;
  return typeof subscriptionPlan === "string" ? subscriptionPlan : null;
}

export function hasUsableLocalSession(user: AuthUser | null | undefined) {
  return Boolean(user?.id && user.status === "active");
}

 
export function stripQuery(value?: string) {
  return String(value || "").split("?")[0];
}
