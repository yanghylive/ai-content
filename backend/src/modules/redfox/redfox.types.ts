export type RedfoxConnectionStatus =
  'missing_key' | 'untested' | 'connected' | 'failed' | 'disabled';

export type RedfoxConnectionSource = 'saved' | 'env' | 'missing';

export type RedfoxScope = {
  key: string;
  userId: string;
  tenantId?: string;
};

export type RedfoxStoredConnection = {
  baseUrl?: string | null;
  apiKey?: string | null;
  timeoutMs?: number | null;
  enabled?: boolean;
  dailyUserLimit?: number | null;
  dailyTenantLimit?: number | null;
  highCostConfirmThreshold?: number | null;
  status: RedfoxConnectionStatus;
  lastTestAt?: string | null;
  lastError?: string | null;
  updatedAt: string;
};

export type RedfoxEffectiveConnection = {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
  dailyUserLimit: number;
  dailyTenantLimit: number;
  highCostConfirmThreshold: number;
  apiKey: string;
  apiKeySource: RedfoxConnectionSource;
  status: RedfoxConnectionStatus;
  lastTestAt?: string | null;
  lastError?: string | null;
  updatedAt: string;
};

export type RedfoxConnectionView = {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
  configured: boolean;
  apiKeySource: RedfoxConnectionSource;
  apiKeyMasked: string | null;
  status: RedfoxConnectionStatus;
  lastTestAt: string | null;
  lastError: string | null;
  dailyUserLimit: number;
  dailyTenantLimit: number;
  highCostConfirmThreshold: number;
  updatedAt: string;
};

export type RedfoxSkillStatus = 'available' | 'disabled' | 'unknown';

export type RedfoxSkill = {
  id: string;
  skillNo: string;
  code: string;
  name: string;
  platform: string;
  category: string;
  tags: string[];
  summary: string;
  status: RedfoxSkillStatus;
  enabled: boolean;
  scenario: string | null;
  raw: Record<string, unknown>;
  syncedAt: string;
  updatedAt: string;
};

export type RedfoxInterface = {
  id: string;
  platformCode: string;
  platformName: string | null;
  interfaceNo: string | null;
  code: string;
  name: string;
  path: string;
  method: string;
  scenario: string | null;
  status: string;
  category: string | null;
  description: string;
  price: number | null;
  minPrice: number | null;
  requireAuth: boolean;
  syncedAt: string;
  updatedAt: string;
};

export type RedfoxCallLogStatus = 'success' | 'failed' | 'blocked';

export type RedfoxCallLog = {
  id: string;
  scopeKey: string;
  userId: string;
  tenantId: string;
  endpoint: string;
  method: string;
  operation: string;
  skillCode: string | null;
  status: RedfoxCallLogStatus;
  costPoints: number;
  latencyMs: number;
  requestHash: string;
  responseStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type RedfoxCallLogInput = Omit<
  RedfoxCallLog,
  'id' | 'createdAt' | 'scopeKey' | 'userId' | 'tenantId'
> & {
  scope: RedfoxScope;
};

export type RedfoxClientRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  bodyEncoding?: 'json' | 'form';
  operation: string;
  skillCode?: string | null;
  estimatedCostPoints?: number;
  confirmHighCost?: boolean;
  requireApiKey?: boolean;
  onCallLogRecorded?: (log: RedfoxCallLog) => void;
};

export type RedfoxCostSummary = {
  range: {
    from: string | null;
    to: string | null;
  };
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  blockedCalls: number;
  totalCostPoints: number;
  averageLatencyMs: number;
  todayUsage: {
    userCalls: number;
    tenantCalls: number;
    dailyUserLimit: number;
    dailyTenantLimit: number;
  };
  byStatus: Record<string, number>;
  bySkill: Array<{
    skillCode: string;
    calls: number;
    costPoints: number;
    failures: number;
  }>;
};

export type RedfoxListResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type RedfoxSkillRunStatus =
  'dry_run_ready' | 'success' | 'blocked' | 'failed';

export type RedfoxSkillRunResult = {
  id: string;
  dryRun: boolean;
  status: RedfoxSkillRunStatus;
  skill: {
    code: string | null;
    name: string;
    platform: string | null;
    enabled: boolean;
    resolved: boolean;
  };
  endpoint: {
    method: RedfoxClientRequestOptions['method'];
    path: string | null;
    operation: string;
  };
  estimatedCostPoints: number;
  requestPreview: {
    query: unknown;
    body: unknown;
    input: unknown;
  };
  warnings: string[];
  solutionRunId: string | null;
  solutionTaskId: string | null;
  idempotencyKey: string | null;
  callLogId: string | null;
  payloadSummary: unknown;
  payloadSample?: unknown;
  createdAt: string;
};
