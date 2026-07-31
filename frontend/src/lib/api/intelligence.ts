import { api, type PaginatedData } from "./client";
import type {
  RedfoxConnectionView,
  RedfoxCostSummary,
  RedfoxSkill,
} from "./redfox";

export type IntelligenceItem = {
  id: string;
  tenantId: string | null;
  userId: string;
  platform: string;
  type: string;
  title: string;
  content: string | null;
  summary: string | null;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  author: string | null;
  authorUrl: string | null;
  publishDate: string | null;
  metrics: Record<string, unknown>;
  keywords: string[];
  raw: unknown;
  status: string;
  dedupeKey: string | null;
  redfoxSkill: {
    id: string;
    code: string;
    skillNo: string | null;
    name: string;
    platform: string | null;
    category: string | null;
  } | null;
  redfoxCallLogId: string | null;
  materialId: string | null;
  topicId: string | null;
  growthLeadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceMonitorSummary = {
  id: string;
  tenantId: string | null;
  userId: string;
  skillInstallId: string | null;
  type: string;
  platform: string | null;
  keyword: string | null;
  accountExternalId: string | null;
  industry: string | null;
  schedule: string;
  status: string;
  costLimitPoints: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  config: unknown;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceOverview = {
  range: {
    from: string | null;
    to: string | null;
  };
  metrics: {
    totalItems: number;
    newItems: number;
    importedMaterials: number;
    generatedTopics: number;
    activeMonitors: number;
    monitorErrors: number;
  };
  byStatus: Array<{ key: string; count: number }>;
  byType: Array<{ key: string; count: number }>;
  byPlatform: Array<{ key: string; count: number }>;
  recentItems: IntelligenceItem[];
  monitors: IntelligenceMonitorSummary[];
  redfox: {
    connection: RedfoxConnectionView;
    skills: {
      total: number;
      enabled: number;
      items: RedfoxSkill[];
    };
    costs: RedfoxCostSummary;
  };
};

export type QueryIntelligenceItemsInput = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
  platform?: string;
  keyword?: string;
  skillCode?: string;
  from?: string;
  to?: string;
  sortBy?: "createdAt" | "updatedAt" | "publishDate" | "title";
  sortOrder?: "asc" | "desc";
};

export type QueryIntelligenceOverviewInput = {
  from?: string;
  to?: string;
  limit?: number;
};

export type QueryIntelligenceMonitorsInput = {
  page?: number;
  limit?: number;
  status?: string;
  type?: string;
  platform?: string;
  keyword?: string;
  industry?: string;
  sortBy?: "updatedAt" | "createdAt" | "nextRunAt" | "lastRunAt";
  sortOrder?: "asc" | "desc";
};

export type CreateIntelligenceMonitorInput = {
  type: string;
  schedule: string;
  platform?: string;
  keyword?: string;
  accountExternalId?: string;
  industry?: string;
  skillInstallId?: string;
  status?: string;
  costLimitPoints?: number;
  nextRunAt?: string;
  config?: Record<string, unknown>;
};

export type UpdateIntelligenceMonitorInput = Partial<
  Omit<CreateIntelligenceMonitorInput, "nextRunAt">
> & {
  lastRunAt?: string;
  nextRunAt?: string;
  lastError?: string;
};

export type IntelligenceMonitorRunResult = {
  monitorId: string;
  status: "success" | "failed";
  trigger?: "manual" | "schedule";
  callLogId?: string | null;
  received?: number;
  normalized?: number;
  created?: number;
  updated?: number;
  error?: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
};

export type RunDueIntelligenceMonitorsResult = {
  scanned: number;
  executed: number;
  succeeded: number;
  failed: number;
  results: IntelligenceMonitorRunResult[];
};

export type RunIntelligenceSearchInput = {
  keyword: string;
  platform?:
    | "all"
    | "douyin"
    | "xiaohongshu"
    | "bilibili"
    | "wechat"
    | "gongzhonghao";
  target?: "all" | "post" | "account" | "comment" | "engagement";
  limit?: number;
  accountId?: string;
  workUrl?: string;
  workId?: string;
  cursor?: string;
  page?: number;
};

export type IntelligenceSearchEndpointResult = {
  platform: string;
  platformLabel: string;
  endpoint: string;
  status: "success" | "failed" | "empty" | "cached";
  callLogId: string | null;
  estimatedCostPoints?: number;
  costPoints?: number;
  received: number;
  normalized: number;
  created: number;
  updated: number;
  error?: string;
  errorCode?: string;
  message?: string;
  source?: string;
};

export type RunIntelligenceSearchResult = {
  keyword: string;
  platform: string;
  target: string;
  received: number;
  normalized: number;
  created: number;
  updated: number;
  endpoints: IntelligenceSearchEndpointResult[];
  items: IntelligenceItem[];
};

export type IngestRedfoxItemsInput = {
  platform: string;
  type: string;
  redfoxSkillId?: string;
  redfoxSkillCode?: string;
  redfoxCallLogId?: string;
  status?: string;
  rawItems: Record<string, unknown>[];
};

export type IngestRedfoxItemsResult = {
  received: number;
  normalized: number;
  created: number;
  updated: number;
  items: IntelligenceItem[];
};

export type ImportIntelligenceMaterialInput = {
  title?: string;
  content?: string;
  summary?: string;
  sourceUrl?: string;
  platform?: string;
  author?: string;
  publishDate?: string;
  keywords?: string[];
};

export type GenerateIntelligenceTopicInput = {
  title?: string;
  description?: string;
  summary?: string;
  sourceType?: string;
  materialIds?: string[];
  keywords?: string[];
  searchQueries?: string[];
};

export type DispatchIntelligenceItemInput = {
  action: string;
  label?: string;
  target?: string;
  href?: string;
  risk?: "low" | "medium" | "high";
  reason?: string;
};

export type DispatchIntelligenceItemResult = {
  intelligenceItemId: string;
  action: string;
  label: string;
  target: string;
  href: string;
  risk: "low" | "medium" | "high";
  status: string;
  recordType: string;
  recordId: string;
  message: string;
  item: IntelligenceItem;
  createdAt: string;
};

export type IntelligenceDispatchRecordsKind =
  | "risks"
  | "rules"
  | "accounts"
  | "leads";

export type QueryIntelligenceDispatchRecordsInput = {
  page?: number;
  limit?: number;
  status?: string;
  keyword?: string;
};

export type IntelligenceDispatchRecord = {
  id: string;
  recordType: string;
  intelligenceItemId: string | null;
  title: string;
  platform: string;
  status: string;
  risk: "low" | "medium" | "high";
  owner: string;
  source: string;
  summary: string;
  evidence: string[];
  boundary: string;
  href: string;
  createdAt: string;
  updatedAt: string;
};

export type IntelligenceDispatchRecordAction =
  | "approve"
  | "reject"
  | "publish_rule"
  | "watch_priority"
  | "archive"
  | "create_growth_lead"
  | "mark_done";

export type ProcessIntelligenceDispatchRecordInput = {
  action: IntelligenceDispatchRecordAction;
  note?: string;
  status?: string;
};

export type ProcessIntelligenceDispatchRecordResult = {
  kind: IntelligenceDispatchRecordsKind;
  action: IntelligenceDispatchRecordAction;
  status: string;
  message: string;
  growthLeadId?: string;
  record: IntelligenceDispatchRecord;
};

export type IntelligenceReportStatus =
  | "draft"
  | "in_review"
  | "delivered"
  | "archived";

export type IntelligenceReport = {
  id: string;
  tenantId: string | null;
  userId: string;
  kind: string;
  title: string;
  audience: string | null;
  owner: string | null;
  rangeKey: string | null;
  status: IntelligenceReportStatus | string;
  completeness: number;
  findings: string[];
  evidence: string[];
  markdown: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type QueryIntelligenceReportsInput = {
  page?: number;
  limit?: number;
  status?: string;
  kind?: string;
  keyword?: string;
};

export type CreateIntelligenceReportInput = {
  kind: string;
  title: string;
  audience?: string;
  owner?: string;
  rangeKey?: string;
  status?: IntelligenceReportStatus;
  completeness?: number;
  findings?: string[];
  evidence?: string[];
  markdown: string;
  metadata?: Record<string, unknown>;
};

export type IntelligenceReportAction =
  | "submit_review"
  | "mark_delivered"
  | "archive"
  | "reopen";

export type ProcessIntelligenceReportInput = {
  action: IntelligenceReportAction;
  note?: string;
};

export type ProcessIntelligenceReportResult = {
  action: IntelligenceReportAction;
  status: string;
  message: string;
  report: IntelligenceReport;
};

function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export const intelligenceApi = {
  overview(params: QueryIntelligenceOverviewInput = {}) {
    return api.get<IntelligenceOverview>(
      `/intelligence/overview${query(params)}`,
    );
  },
  listItems(params: QueryIntelligenceItemsInput = {}) {
    return api.get<PaginatedData<IntelligenceItem>>(
      `/intelligence/items${query(params)}`,
    );
  },
  listMonitors(params: QueryIntelligenceMonitorsInput = {}) {
    return api.get<PaginatedData<IntelligenceMonitorSummary>>(
      `/intelligence/monitors${query(params)}`,
    );
  },
  createMonitor(input: CreateIntelligenceMonitorInput) {
    return api.post<IntelligenceMonitorSummary>(
      "/intelligence/monitors",
      input,
    );
  },
  updateMonitor(id: string, input: UpdateIntelligenceMonitorInput) {
    return api.patch<IntelligenceMonitorSummary>(
      `/intelligence/monitors/${encodeURIComponent(id)}`,
      input,
    );
  },
  archiveMonitor(id: string) {
    return api.delete<IntelligenceMonitorSummary>(
      `/intelligence/monitors/${encodeURIComponent(id)}`,
    );
  },
  runMonitor(id: string) {
    return api.post<IntelligenceMonitorRunResult>(
      `/intelligence/monitors/${encodeURIComponent(id)}/run`,
      {},
    );
  },
  runDueMonitors(input: { limit?: number } = {}) {
    return api.post<RunDueIntelligenceMonitorsResult>(
      "/intelligence/monitors/run-due",
      input,
    );
  },
  runSearch(input: RunIntelligenceSearchInput) {
    return api.post<RunIntelligenceSearchResult>(
      "/intelligence/search/redfox",
      input,
    );
  },
  getItem(id: string) {
    return api.get<IntelligenceItem>(
      `/intelligence/items/${encodeURIComponent(id)}`,
    );
  },
  ingestRedfoxItems(input: IngestRedfoxItemsInput) {
    return api.post<IngestRedfoxItemsResult>(
      "/intelligence/redfox/items/ingest",
      input,
    );
  },
  importMaterial(id: string, input: ImportIntelligenceMaterialInput = {}) {
    return api.post<{ intelligenceItemId: string; material: unknown }>(
      `/intelligence/items/${encodeURIComponent(id)}/import-material`,
      input,
    );
  },
  generateTopic(id: string, input: GenerateIntelligenceTopicInput = {}) {
    return api.post<{ intelligenceItemId: string; topic: unknown }>(
      `/intelligence/items/${encodeURIComponent(id)}/generate-topic`,
      input,
    );
  },
  dispatchItem(id: string, input: DispatchIntelligenceItemInput) {
    return api.post<DispatchIntelligenceItemResult>(
      `/intelligence/items/${encodeURIComponent(id)}/dispatch`,
      input,
    );
  },
  listDispatchRecords(
    kind: IntelligenceDispatchRecordsKind,
    params: QueryIntelligenceDispatchRecordsInput = {},
  ) {
    return api.get<PaginatedData<IntelligenceDispatchRecord>>(
      `/intelligence/dispatches/${kind}${query(params)}`,
    );
  },
  processDispatchRecord(
    kind: IntelligenceDispatchRecordsKind,
    id: string,
    input: ProcessIntelligenceDispatchRecordInput,
  ) {
    return api.post<ProcessIntelligenceDispatchRecordResult>(
      `/intelligence/dispatches/${kind}/${encodeURIComponent(id)}/actions`,
      input,
    );
  },
  listReports(params: QueryIntelligenceReportsInput = {}) {
    return api.get<PaginatedData<IntelligenceReport>>(
      `/intelligence/reports${query(params)}`,
    );
  },
  createReport(input: CreateIntelligenceReportInput) {
    return api.post<IntelligenceReport>("/intelligence/reports", input);
  },
  getReport(id: string) {
    return api.get<IntelligenceReport>(
      `/intelligence/reports/${encodeURIComponent(id)}`,
    );
  },
  processReport(id: string, input: ProcessIntelligenceReportInput) {
    return api.post<ProcessIntelligenceReportResult>(
      `/intelligence/reports/${encodeURIComponent(id)}/actions`,
      input,
    );
  },
};
