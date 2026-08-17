// 审批中心 API（Sprint 5：ApprovalGateService 前端打通）
// 高风险动作（首次私信/批量评论/批量触达/商机阶段变化）强制人工审批。
import { api } from "./client";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "requested_changes"
  | "expired"
  | "resubmitted"
  | "applied";

export type ApprovalAction =
  | "approve"
  | "reject"
  | "request_changes"
  | "expire"
  | "resubmit";

export interface ApprovalRecord {
  id: string;
  tenantId: string;
  userId: string;
  actionId: string;
  actionType: string;
  riskLevel: "low" | "medium" | "high";
  inputHash: string;
  affectedLeadIds: string[];
  excludedLeadIds: string[];
  approverId: string | null;
  status: ApprovalStatus;
  reason: string | null;
  createdAt: string;
  expiresAt: string | null;
  appliedAt: string | null;
}

export const approvalApi = {
  listPending: (limit = 50) =>
    api.get<ApprovalRecord[]>(`/approvals?limit=${limit}`),
  act: (id: string, body: { action: ApprovalAction; reason?: string }) =>
    api.post<{ status: string; appliedAt?: string }>(`/approvals/${id}/act`, body),
};
