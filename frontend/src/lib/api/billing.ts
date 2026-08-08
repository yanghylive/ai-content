// B2 云端额度/权益状态（GET /billing/status，手机端展示权益与解冻引导）
import { api } from "@/lib/api/client";

export type BillingStatus = {
  tenantId: string;
  user: { id: string; email: string | null; kaypalUserId: string | null };
  entitlement: {
    source: string;
    plan: string;
    status: string;
    commercialExecutionAllowed: boolean;
    externalSubscriptionId: string | null;
    periodEnd: string | null;
  } | null;
  latestSubscription: {
    provider: string;
    externalSubscriptionId: string;
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  latestInvoice: unknown;
};

export const billingApi = {
  /** 当前用户权益/额度状态（plan、冻结状态、到期时间） */
  status() {
    return api.get<BillingStatus>("/billing/status");
  },
};

/** 权益状态中文映射（B2 展示口径） */
export function entitlementStatusLabel(status: string | undefined | null): string {
  switch (status) {
    case "active":
      return "正常";
    case "frozen":
      return "额度冻结";
    case "past_due":
      return "已逾期";
    case "expired":
      return "已过期";
    case "trial":
      return "试用中";
    default:
      return status || "未知";
  }
}

/** 是否处于受限状态（冻结/逾期/过期 → 发布与采集会被云端拒绝） */
export function isEntitlementBlocked(status: string | undefined | null): boolean {
  return status === "frozen" || status === "past_due" || status === "expired";
}
