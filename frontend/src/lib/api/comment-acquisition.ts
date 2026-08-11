import { api } from "./client";

// ---- 评论获客（comment-acquisition）----

export type AcquisitionPlatform = "douyin" | "wechat-channel" | "xiaohongshu";
export type LeadStatus =
  | "pending"
  | "approved"
  | "replied"
  | "skipped"
  | "failed";

export type AcquisitionLead = {
  id: string;
  tenantId: string | null;
  userId: string;
  platform: AcquisitionPlatform;
  accountId: string;
  commentText: string;
  commenterName?: string | null;
  leadScore: number;
  signals?: string | null;
  replyText?: string | null;
  personaId?: string | null;
  status: LeadStatus;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScanResult = {
  scanned: number;
  leads: number;
  replies: number;
  circuitOpen: boolean;
  retryAfterSeconds: number;
  items: Array<{
    leadId: string;
    comment: string;
    score: number;
    status: string;
    replyText?: string;
    personaName?: string;
  }>;
};

export function scanAccount(input: {
  platform: AcquisitionPlatform;
  accountId: number | string;
  limit?: number;
  autoReply?: boolean;
  minLeadScore?: number;
}) {
  return api.post<ScanResult>("/comment-acquisition/scan", input);
}

export function scanDm(input: {
  platform: "douyin" | "wechat-channel";
  accountId: number | string;
  limit?: number;
  autoReply?: boolean;
  minLeadScore?: number;
}) {
  return api.post<ScanResult>("/comment-acquisition/scan-dm", input);
}

export function listLeads(input: {
  platform?: AcquisitionPlatform;
  status?: LeadStatus;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (input.platform) params.set("platform", input.platform);
  if (input.status) params.set("status", input.status);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const qs = params.toString();
  return api.get<{ items: AcquisitionLead[]; total: number }>(
    "/comment-acquisition/leads" + (qs ? `?${qs}` : ""),
  );
}

export function reviewLead(
  id: string,
  input: { action: "approve" | "skip"; replyText?: string },
) {
  return api.post<{ status: string }>(
    "/comment-acquisition/leads/" + encodeURIComponent(id) + "/review",
    input,
  );
}

export function replyLead(
  id: string,
  input: {
    platform: AcquisitionPlatform;
    accountId: number | string;
    commentText: string;
    replyText: string;
    sourceTitle?: string;
  },
) {
  return api.post<{ ok: boolean }>(
    "/comment-acquisition/leads/" + encodeURIComponent(id) + "/reply",
    input,
  );
}
