import { api, type PaginatedData } from "./client";

export type RedfoxConnectionStatus =
  | "missing_key"
  | "untested"
  | "connected"
  | "failed"
  | "disabled";

export type RedfoxConnectionView = {
  baseUrl: string;
  timeoutMs: number;
  enabled: boolean;
  configured: boolean;
  apiKeySource: "saved" | "env" | "missing";
  apiKeyMasked: string | null;
  status: RedfoxConnectionStatus;
  lastTestAt: string | null;
  lastError: string | null;
  dailyUserLimit: number;
  dailyTenantLimit: number;
  highCostConfirmThreshold: number;
  updatedAt: string;
};

export type SaveRedfoxConnectionInput = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  enabled?: boolean;
  dailyUserLimit?: number;
  dailyTenantLimit?: number;
  highCostConfirmThreshold?: number;
};

export type HotTopicItem = {
  title: string;
  platform: string;
  heat: string;
  url?: string;
};

export type HotTopicsResult = {
  items: HotTopicItem[];
  fetchedAt?: number;
  fromCache?: boolean;
};

export type RedfoxSkill = {
  id: string;
  skillNo: string;
  code: string;
  name: string;
  platform: string;
  category: string;
  tags: string[];
  summary: string;
  status: "available" | "disabled" | "unknown";
  enabled: boolean;
  scenario: string | null;
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

export type RedfoxCallLog = {
  id: string;
  userId: string;
  tenantId: string;
  endpoint: string;
  method: string;
  operation: string;
  skillCode: string | null;
  status: "success" | "failed" | "blocked";
  costPoints: number;
  latencyMs: number;
  requestHash: string;
  responseStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type RedfoxCostSummary = {
  range: { from: string | null; to: string | null };
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

export const redfoxApi = {
  getConnection() {
    return api.get<RedfoxConnectionView>("/redfox/connection");
  },
  saveConnection(input: SaveRedfoxConnectionInput) {
    return api.post<RedfoxConnectionView>("/redfox/connection", input);
  },
  testConnection() {
    return api.post<{
      ok: boolean;
      status: string;
      checkedAt: string;
      baseUrl: string;
      sample: Record<string, unknown>;
    }>("/redfox/connection/test", {});
  },
  listInterfaces(params: {
    page?: number;
    limit?: number;
    keyword?: string;
    platform?: string;
    scenario?: string;
    path?: string;
    status?: string;
  } = {}) {
    return api.get<PaginatedData<RedfoxInterface>>(
      `/redfox/interfaces${query(params)}`,
    );
  },
  syncInterfaces(input: { platforms?: string } = {}) {
    return api.post<{
      syncedAt: string;
      platforms: number;
      attempted: number;
      received: number;
      created: number;
      updated: number;
      failed: number;
      failures: Array<{ platformCode: string; error: string }>;
      total: number;
    }>("/redfox/interfaces/sync", input);
  },
  listSkills(params: {
    page?: number;
    limit?: number;
    keyword?: string;
    platform?: string;
    tag?: string;
    scenario?: string;
    enabled?: boolean;
  } = {}) {
    return api.get<PaginatedData<RedfoxSkill>>(`/redfox/skills${query(params)}`);
  },
  syncSkills(input: { page?: number; pageSize?: number } = {}) {
    return api.post<{
      syncedAt: string;
      received: number;
      created: number;
      updated: number;
      total: number;
    }>("/redfox/skills/sync", input);
  },
  updateSkill(id: string, input: {
    enabled?: boolean;
    scenario?: string | null;
    tags?: string[];
  }) {
    return api.patch<RedfoxSkill>(`/redfox/skills/${encodeURIComponent(id)}`, input);
  },
  getCostSummary(params: { from?: string; to?: string } = {}) {
    return api.get<RedfoxCostSummary>(`/redfox/costs/summary${query(params)}`);
  },
  listCallLogs(params: {
    page?: number;
    limit?: number;
    status?: string;
    skillCode?: string;
    endpoint?: string;
    from?: string;
    to?: string;
  } = {}) {
    return api.get<PaginatedData<RedfoxCallLog>>(`/redfox/call-logs${query(params)}`);
  },

  /** 今日热榜选题（RedFox 全网聚合热点，选题灵感用） */
  hotTopics() {
    return api.get<HotTopicsResult>("/redfox/hot-topics");
  },

  /** 发布前合规体检：多平台违禁词检测 */
  checkProhibited(input: { text: string; platforms?: string[] }) {
    return api.post<ComplianceResult>("/redfox/check/prohibited", input);
  },

  /** Skill 试执行（默认 dry-run 不外呼，P1 前端接入 2026-08-10） */
  runSkill(input: { code?: string; skillId?: string; params?: Record<string, unknown> }) {
    return api.post<{ ok: boolean; dryRun: boolean; summary?: string; message?: string }>(
      "/redfox/skills/run",
      input,
    );
  },

  /** 竞品雷达：RedFox 抖音账号搜索（按关键词，30 分钟缓存） */
  radar(params: { keyword?: string; limit?: number } = {}) {
    return api.get<RadarResult>(
      `/redfox/radar${query(params)}`,
    );
  },

  /** A4：从分享链接去水印采集（短视频/图文 → 素材库） */
  collectFromLink(input: { url: string }) {
    return api.post<CollectResult>("/redfox/collect/link", input);
  },

  /** A5：AI 生图（image2-GPT → 素材库） */
  generateImage(input: { prompt: string; size?: string }) {
    return api.post<CollectResult>("/redfox/image/gen", input);
  },
  /** Seedance 生视频：提交任务（异步轮询 taskId） */
  videoGenSubmit(input: { prompt: string; duration?: number; ratio?: string; imageUrl?: string }) {
    return api.post<{ taskId: string }>("/redfox/video/gen", input);
  },
  /** Seedance 生视频：查询结果（done 后自动入素材库） */
  videoGenQuery(taskId: string) {
    return api.get<{ taskId: string; status: string; error?: string; filename?: string; sizeBytes?: number }>(
      `/redfox/video/gen/${taskId}`,
    );
  },

  /** D5：爆款拆解（作品链接 → 数据 + AI 策略拆解） */
  viralAnalyze(input: { url: string }) {
    return api.post<ViralAnalyzeResult>("/redfox/viral/analyze", input);
  },

  /* ===== 平台能力开采（2026-08-09，RedFoxHub 6 项扩展） ===== */

  /** 支持去水印下载的平台列表 */
  listDownloadPlatforms() {
    return api.get<{ items: Array<{ key: string; label: string }> }>(
      "/redfox/platform/download-platforms",
    );
  },

  /** 支持内容采集的平台列表 */
  listSearchPlatforms() {
    return api.get<{ items: Array<{ key: string; label: string }> }>(
      "/redfox/platform/search-platforms",
    );
  },

  /** 多平台去水印下载（抖音/快手/小红书/视频号/B站/TikTok/YouTube/X/Instagram） */
  platformDownload(input: { platform: string; url: string }) {
    return api.post<{
      platform: string;
      platformLabel: string;
      url: string;
      data: Record<string, unknown>;
      generatedAt: string;
    }>("/redfox/platform/download", input);
  },

  /** 视频提文案（抖音/小红书/YouTube；抖音/小红书异步提交+查询） */
  platformTranscript(input: {
    platform: string;
    url?: string;
    taskId?: string;
  }) {
    return api.post<{
      platform: string;
      platformLabel: string;
      taskId?: string;
      submitted?: boolean;
      result?: boolean;
      sync?: boolean;
      data?: Record<string, unknown>;
    }>("/redfox/platform/transcript", input);
  },

  /** 统一内容采集：search(关键词搜作品)/detail(作品详情)/list(账号作品列表) */
  platformCollect(input: {
    platform: string;
    action: "search" | "detail" | "list";
    keyword?: string;
    url?: string;
    workId?: string;
    accountId?: string;
    page?: number;
  }) {
    return api.post<{
      platform: string;
      platformLabel: string;
      action: string;
      data: Record<string, unknown>;
      generatedAt: string;
    }>("/redfox/platform/collect", input);
  },

  /** AI 作品搜索（抖音/小红书/公众号 AI 生成内容趋势） */
  platformAiSearch(input: { platform: string; keyword: string; page?: number }) {
    return api.post<{
      platform: string;
      platformLabel: string;
      data: Record<string, unknown>;
      generatedAt: string;
    }>("/redfox/platform/ai-search", input);
  },

  /** Seedream 5.0 Pro 生图（较 lite 更高质量） */
  platformSeedreamPro(input: { prompt?: string; taskId?: string }) {
    return api.post<{
      taskId?: string;
      submitted?: boolean;
      result?: boolean;
      data?: Record<string, unknown>;
    }>("/redfox/platform/seedream-pro", input);
  },
};

/** D5 爆款拆解结果 */
export type ViralAnalyzeResult = {
  url: string;
  work: {
    title: string;
    author: string;
    likes: number;
    comments: number;
    shares: number;
    collects: number;
    plays: number;
    duration: number;
    topics: unknown[];
    platform: string;
    workType?: string;
    publishTime?: string;
    coverUrl: string | null;
  };
  analysis: {
    titleTrick?: string;
    coverAdvice?: string;
    contentStructure?: unknown;
    hashtagStrategy?: string;
    interactionHook?: string;
    replicableStrategy?: unknown;
    riskNote?: string;
  } | null;
  generatedAt: string;
};

export type ComplianceViolation = {
  word: string;
  suggestion?: string;
  reason?: string;
};

export type ComplianceResult = {
  pass: boolean;
  violations: ComplianceViolation[];
  platform: string;
  checkedAt: string;
  degraded?: boolean;
};

export type RadarAccount = {
  name: string;
  accountId: string;
  avatarUrl?: string;
  followers: number;
  works: number;
  works30d: number;
  totalFavorited?: number;
  description?: string;
};

export type RadarResult = {
  keyword: string;
  items: RadarAccount[];
  fetchedAt: number;
  fromCache: boolean;
};

export type CollectResult = {
  filename: string;
  sizeBytes: number;
  source?: string;
  prompt?: string;
};
