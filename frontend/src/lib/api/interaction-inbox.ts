import { api } from "./client";

// ---- 统一互动收件箱（报告 5.1）----

export type InboxView =
  | "all"
  | "unassigned"
  | "pending"
  | "replied"
  | "needs_human"
  | "overdue";

export type InboxItem = {
  threadKey: string;
  platform: string;
  channel: string;
  accountId: string | null;
  authorExternalId: string | null;
  authorName: string | null;
  sourceArticleId: string | null;
  sourceArticleTitle: string | null;
  publishRecordId: string | null;
  sourceUrl: string | null;
  latestBody: string | null;
  latestAt: string;
  eventCount: number;
  unreadCount: number;
  priority: string;
  status: string;
  slaDueAt: string | null;
  slaOverdue: boolean;
  assigneeId: string | null;
  handoffState: string;
  handoffReason: string | null;
  draftText: string | null;
  leadId: string | null;
  leadStatus: string | null;
  customerId: string | null;
  allowedActions: string[];
};

export type InboxListResult = {
  items: InboxItem[];
  total: number;
  views: Record<InboxView, number>;
};

export type InboxThreadDetail = {
  thread: InboxItem;
  history: Array<{
    eventId: string;
    body: string | null;
    occurredAt: string;
    channel: string;
    platform: string;
  }>;
};

export function listInbox(input: {
  view?: InboxView;
  platform?: string;
  assignee?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (input.view) params.set("view", input.view);
  if (input.platform) params.set("platform", input.platform);
  if (input.assignee) params.set("assignee", input.assignee);
  if (input.limit) params.set("limit", String(input.limit));
  if (input.offset) params.set("offset", String(input.offset));
  const qs = params.toString();
  return api.get<InboxListResult>(
    "/interaction/inbox" + (qs ? `?${qs}` : ""),
  );
}

export function getInboxViews() {
  return api.get<Record<InboxView, number>>("/interaction/inbox/views");
}

export function getInboxThreadDetail(threadKey: string) {
  return api.get<InboxThreadDetail>(
    "/interaction/inbox/" + encodeURIComponent(threadKey),
  );
}
