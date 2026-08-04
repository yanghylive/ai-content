"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronDown,
  Database,
  FileSearch,
  Gauge,
  MessageSquareText,
  Search,
  Sparkles,
  TrendingUp,
  UserRoundSearch,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  intelligenceApi,
  type IntelligenceItem,
  type RunIntelligenceSearchResult,
} from "@/lib/api/intelligence";
import { ApiError } from "@/lib/api/client";
import { toPublicError } from "@/lib/public-error";

type PlatformFilter = "all" | "douyin" | "xiaohongshu" | "bilibili" | "wechat";
type TargetFilter = "all" | "post" | "account" | "comment" | "engagement";
type RiskLevel = "low" | "medium" | "high";

type SearchCandidate = {
  id: string;
  title: string;
  target: Exclude<TargetFilter, "all">;
  targetLabel: string;
  platform: string;
  sourceSkill: string;
  sourceLabel: string;
  queryIntent: string;
  quality: number;
  relevance: number;
  risk: RiskLevel;
  decision: "导入素材" | "进入对标" | "评论洞察" | "互动分析" | "加入监控";
  reason: string;
  evidence: string[];
  nextActions: Array<{
    label: string;
    href: string;
    icon: LucideIcon;
  }>;
};

type SearchRunState = {
  loading: boolean;
  error: string | null;
  failures: SearchFailureDetail[];
  requestId: string | null;
  summary: RunIntelligenceSearchResult | null;
};

type SearchFailureDetail = {
  platform: string;
  platformLabel: string;
  error: string;
  errorCode: string | null;
  callLogId: string | null;
};

type UserSearchHistory = {
  lastQuery: string;
  lastPlatform: PlatformFilter;
  lastTarget: TargetFilter;
  lastSearchAt: string;
  recentSearches: Array<{
    query: string;
    platform: PlatformFilter;
    target: TargetFilter;
    resultsCount: number;
    searchedAt: string;
  }>;
};

const platformOptions: Array<{ label: string; value: PlatformFilter }> = [
  { label: "全网", value: "all" },
  { label: "抖音", value: "douyin" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "B站", value: "bilibili" },
  { label: "公众号", value: "wechat" },
];

const targetOptions: Array<{
  icon: LucideIcon;
  label: string;
  value: TargetFilter;
  description: string;
}> = [
  { icon: Search, label: "全部", value: "all", description: "搜索所有类型" },
  { icon: FileSearch, label: "作品", value: "post", description: "找内容样本" },
  { icon: UserRoundSearch, label: "账号", value: "account", description: "找对标账号" },
  { icon: MessageSquareText, label: "评论", value: "comment", description: "找用户痛点" },
  { icon: Gauge, label: "文章互动", value: "engagement", description: "分析文章效果" },
];

const commentPlatformValues = new Set<PlatformFilter>([
  "douyin",
  "xiaohongshu",
  "bilibili",
]);
const engagementPlatformValues = new Set<PlatformFilter>(["wechat"]);

function publicSearchErrorMessage(error: unknown) {
  if (
    error instanceof ApiError &&
    error.errorCode === "INSUFFICIENT_CREDITS"
  ) {
    return "积分余额不足，请充值或调整任务消耗后再试。";
  }
  if (
    error instanceof ApiError &&
    error.errorCode === "INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED"
  ) {
    return "数据查找暂时不可用，请查看各平台原因后重试。";
  }
  return toPublicError(error, "搜索未完成，请调整条件后重试。");
}

function readSearchFailureDetails(error: unknown): SearchFailureDetail[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return [];
  }
  const failures = (details as { failures?: unknown }).failures;
  if (!Array.isArray(failures)) return [];
  return failures.flatMap((failure) => {
    if (!failure || typeof failure !== "object" || Array.isArray(failure)) {
      return [];
    }
    const record = failure as Record<string, unknown>;
    const platform = typeof record.platform === "string" ? record.platform : "";
    const platformLabel =
      typeof record.platformLabel === "string"
        ? record.platformLabel
        : platform || "数据来源";
    const message =
      typeof record.error === "string" ? record.error : "数据服务请求失败";
    return [
      {
        platform,
        platformLabel,
        error: message,
        errorCode:
          typeof record.errorCode === "string" ? record.errorCode : null,
        callLogId:
          typeof record.callLogId === "string" ? record.callLogId : null,
      },
    ];
  });
}

function riskLabel(risk: RiskLevel) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需复核";
  return "可入库";
}

function riskClass(risk: RiskLevel) {
  if (risk === "high") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-danger)]";
  }
  if (risk === "medium") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-amber)]";
  }
  return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-success)]";
}

function platformMatches(candidate: SearchCandidate, platform: PlatformFilter) {
  if (platform === "all") return true;
  if (platform === "douyin") return candidate.platform === "抖音";
  if (platform === "xiaohongshu") return candidate.platform === "小红书";
  if (platform === "bilibili") return candidate.platform === "B站";
  if (platform === "wechat") {
    return candidate.platform === "公众号" || candidate.platform === "视频号";
  }
  return true;
}

function targetMatches(candidate: SearchCandidate, target: TargetFilter) {
  return target === "all" || candidate.target === target;
}

function platformLabel(platform: string) {
  if (platform === "douyin") return "抖音";
  if (platform === "xiaohongshu") return "小红书";
  if (platform === "bilibili") return "B站";
  if (platform === "gongzhonghao") return "公众号";
  return platform || "系统";
}

function trimText(value: string | null | undefined, fallback: string) {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 92 ? `${text.slice(0, 92)}...` : text;
}

function itemToCandidate(
  item: IntelligenceItem,
  index: number,
): SearchCandidate {
  const isAccount = item.type === "account";
  const isComment = item.type === "comment";
  const isEngagement =
    item.type === "article_engagement" || item.type === "engagement";
  const quality = Math.max(72, 90 - index);
  const relevance = Math.max(70, 92 - index);
  const sourceLabel = isEngagement
    ? "系统已获取公众号文章互动指标"
    : isComment
      ? "系统已采集评论并整理入库"
      : item.redfoxCallLogId
        ? "系统已完成真实采集并入库"
        : "系统已完成数据整理";

  return {
    id: item.id,
    title: item.title,
    target: isEngagement
      ? "engagement"
      : isComment
        ? "comment"
        : isAccount
          ? "account"
          : "post",
    targetLabel: isEngagement
      ? "文章互动"
      : isComment
        ? "评论线索"
        : isAccount
          ? "账号样本"
          : "作品样本",
    platform: platformLabel(item.platform),
    sourceSkill: isEngagement
      ? "公众号文章互动分析"
      : isComment
        ? "评论采集"
        : "内容与账号查找",
    sourceLabel,
    queryIntent: item.keywords.length ? item.keywords.join("、") : item.type,
    quality,
    relevance,
    risk: "low",
    decision: isEngagement
      ? "互动分析"
      : isComment
        ? "评论洞察"
        : isAccount
          ? "进入对标"
          : "导入素材",
    reason: trimText(
      item.summary || item.content,
      isEngagement
        ? "已获取公众号文章阅读、点赞、评论数、收藏、分享等互动指标，可用于判断文章热度质量。"
        : isComment
          ? "已获取评论内容并整理入库，可继续沉淀 FAQ、回复规则或线索判断。"
          : "已标准化写入情报库，可继续导入素材、进入爆款拆解或加入监控。",
    ),
    evidence: [
      item.author ? `作者：${item.author}` : "已保留采集记录",
      item.sourceUrl ? "已保留来源链接" : "来源链接待平台返回补齐",
      item.redfoxCallLogId
        ? "已记录本次采集用量"
        : isComment
          ? "评论采集结果"
          : "已完成标准化入库",
    ],
    nextActions: isEngagement
      ? [
          { label: "导入素材", href: "/content", icon: Database },
          {
            label: "生成报告",
            href: "/intelligence/reports",
            icon: FileSearch,
          },
          { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
        ]
      : isComment
        ? [
            {
              label: "线索洞察",
              href: "/intelligence/leads",
              icon: MessageSquareText,
            },
            {
              label: "沉淀规则",
              href: "/intelligence/rules",
              icon: CheckCircle2,
            },
            {
              label: "加入监控",
              href: "/intelligence/monitors",
              icon: BellRing,
            },
          ]
        : isAccount
          ? [
              {
                label: "对标账号",
                href: "/intelligence/accounts",
                icon: UserRoundSearch,
              },
              {
                label: "加入监控",
                href: "/intelligence/monitors",
                icon: BellRing,
              },
            ]
          : [
              { label: "导入素材", href: "/content", icon: Database },
              { label: "爆款拆解", href: "/intelligence/viral", icon: Gauge },
              { label: "生成选题", href: "/content/topics", icon: FileSearch },
            ],
  };
}

function loadUserSearchHistory(): UserSearchHistory | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("kaypal-search-history");
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function saveUserSearchHistory(history: UserSearchHistory) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("kaypal-search-history", JSON.stringify(history));
  } catch {
    // 忽略存储错误
  }
}

export function SearchIntelligenceWorkbench() {
  const [userHistory] = useState<UserSearchHistory | null>(() =>
    loadUserSearchHistory(),
  );

  const [platform, setPlatform] = useState<PlatformFilter>(
    userHistory?.lastPlatform || "all",
  );
  const [target, setTarget] = useState<TargetFilter>(
    userHistory?.lastTarget || "all",
  );
  const [query, setQuery] = useState(userHistory?.lastQuery || "");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [realCandidates, setRealCandidates] = useState<SearchCandidate[]>([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searchRun, setSearchRun] = useState<SearchRunState>({
    loading: false,
    error: null,
    failures: [],
    requestId: null,
    summary: null,
  });

  const runnablePlatformOptions =
    target === "comment"
      ? platformOptions.filter((item) => commentPlatformValues.has(item.value))
      : target === "engagement"
        ? platformOptions.filter((item) =>
            engagementPlatformValues.has(item.value),
          )
        : platformOptions;

  const scopedCandidates = useMemo(() => {
    return realCandidates.filter((candidate) => {
      return (
        platformMatches(candidate, platform) && targetMatches(candidate, target)
      );
    });
  }, [platform, realCandidates, target]);

  const filteredCandidates = useMemo(() => {
    const trimmed = submittedQuery.trim();
    if (!trimmed) return scopedCandidates;

    const directMatches = scopedCandidates.filter((candidate) => {
      return [
        candidate.title,
        candidate.queryIntent,
        candidate.reason,
        candidate.sourceSkill,
        candidate.platform,
      ]
        .join(" ")
        .includes(trimmed);
    });

    return directMatches.length ? directMatches : scopedCandidates;
  }, [scopedCandidates, submittedQuery]);

  const selected =
    filteredCandidates.find((candidate) => candidate.id === selectedId) ||
    filteredCandidates[0] ||
    null;

  const hasResults = filteredCandidates.length > 0;
  const hasSearched = Boolean(searchRun.summary || searchRun.error);

  async function runSearchTask() {
    const nextQuery = query.trim();
    if (!nextQuery) return;

    setSubmittedQuery(nextQuery);
    setRealCandidates([]);
    setSelectedId("");

    setSearchRun({
      loading: true,
      error: null,
      failures: [],
      requestId: null,
      summary: null,
    });

    try {
      const result = await intelligenceApi.runSearch({
        keyword: nextQuery,
        platform:
          target === "comment"
            ? commentPlatformValues.has(platform)
              ? platform
              : "douyin"
            : target === "engagement"
              ? "wechat"
              : platform === "wechat"
                ? "wechat"
                : platform,
        target,
        limit: 20,
        workUrl:
          target === "comment" || target === "engagement"
            ? nextQuery
            : undefined,
      });

      const nextCandidates = result.items.map(itemToCandidate);
      setRealCandidates(nextCandidates);
      setSelectedId(nextCandidates[0]?.id || "");
      setSearchRun({
        loading: false,
        error: null,
        failures: [],
        requestId: null,
        summary: result,
      });

      const newHistory: UserSearchHistory = {
        lastQuery: nextQuery,
        lastPlatform: platform,
        lastTarget: target,
        lastSearchAt: new Date().toISOString(),
        recentSearches: [
          {
            query: nextQuery,
            platform,
            target,
            resultsCount: nextCandidates.length,
            searchedAt: new Date().toISOString(),
          },
          ...(userHistory?.recentSearches || []),
        ].slice(0, 5),
      };
      saveUserSearchHistory(newHistory);
    } catch (error) {
      setSearchRun({
        loading: false,
        error: publicSearchErrorMessage(error),
        failures: readSearchFailureDetails(error),
        requestId: error instanceof ApiError ? error.requestId : null,
        summary: null,
      });
    }
  }

  const recommendedSearches = useMemo(() => {
    if (!userHistory?.recentSearches.length) return [];
    return userHistory.recentSearches.slice(0, 3);
  }, [userHistory]);

  return (
    <div className="kaypal-v2-search flex flex-col gap-6">
      {/* 智能引导区域 */}
      {!hasSearched && recommendedSearches.length > 0 && (
        <section className="kaypal-v3-panel kaypal-v2-guide p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-[var(--kaypal-v3-accent-ink)]" />
                <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
                  继续上次的工作
                </h2>
              </div>
              <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                你最近搜索了 "{recommendedSearches[0].query}"，找到了{" "}
                {recommendedSearches[0].resultsCount} 个结果
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {recommendedSearches.map((search, index) => (
                  <button
                    key={index}
                    className="kaypal-v2-chip inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-2 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] shadow-sm transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)]"
                    onClick={() => {
                      setQuery(search.query);
                      setPlatform(search.platform);
                      setTarget(search.target);
                      void runSearchTask();
                    }}
                    type="button"
                  >
                    <Search className="h-4 w-4" />
                    {search.query}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="rounded-[var(--kaypal-v3-radius-sm)] p-1 text-[var(--kaypal-v3-muted)] transition hover:bg-[var(--kaypal-v3-paper-soft)] hover:text-[var(--kaypal-v3-ink)]"
              onClick={() => {
                localStorage.removeItem("kaypal-search-history");
                window.location.reload();
              }}
              type="button"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </section>
      )}

      {/* 主搜索区域 */}
      <section className="kaypal-v3-panel">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="kaypal-v3-icon-tile h-12 w-12 shrink-0">
              <Search className="h-6 w-6" strokeWidth={2} />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                搜索情报
              </h1>
              <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                输入一句话，系统自动找内容、账号和评论机会
              </p>
            </div>
          </div>

          {/* 主搜索框 */}
          <div className="mt-6">
            <label className="block">
              <span className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                {target === "comment"
                  ? "作品链接或作品 ID"
                  : target === "engagement"
                    ? "公众号文章链接"
                    : "你想找什么"}
              </span>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  className="kaypal-v2-input h-12 flex-1 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-4 text-base text-[var(--kaypal-v3-ink)] outline-none transition placeholder:text-[var(--kaypal-v3-muted)] focus:border-[var(--kaypal-v3-accent)] focus:ring-4 focus:ring-[var(--kaypal-v3-field-focus-ring)]"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void runSearchTask();
                    }
                  }}
                  placeholder={
                    target === "comment"
                      ? "粘贴抖音作品链接、小红书笔记链接或 B站 BV 号"
                      : target === "engagement"
                        ? "粘贴 mp.weixin.qq.com 公众号文章链接"
                        : "例如：帮我找私域获客的选题、竞品账号和用户痛点"
                  }
                  value={query}
                />
                <button
                  className="kaypal-v2-primary-btn inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] bg-[var(--kaypal-v3-accent)] px-6 text-base font-semibold text-white shadow-sm transition hover:bg-[var(--kaypal-v3-accent-ink)] disabled:opacity-60 sm:w-auto"
                  disabled={searchRun.loading || !query.trim()}
                  onClick={() => void runSearchTask()}
                  type="button"
                >
                  <Sparkles className="h-5 w-5" strokeWidth={2} />
                  {searchRun.loading ? "正在查找..." : "开始查找"}
                </button>
              </div>
            </label>
          </div>

          {/* 高级筛选（渐进式披露） */}
          <div className="mt-4">
            <button
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--kaypal-v3-muted)] transition hover:text-[var(--kaypal-v3-ink)]"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              type="button"
            >
              <span>高级筛选</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  showAdvancedFilters ? "rotate-180" : ""
                }`}
              />
            </button>

            {showAdvancedFilters && (
              <div className="kaypal-v3-surface mt-4 space-y-4 p-4">
                {/* 目标类型 */}
                <div>
                  <label className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    查找类型
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {targetOptions.map(({ icon: Icon, label, value, description }) => (
                      <button
                        key={value}
                        className={`kaypal-v2-filter-chip inline-flex items-center gap-2 rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-2 text-sm font-medium transition ${
                          target === value
                            ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                            : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                        }`}
                        onClick={() => {
                          setTarget(value);
                          if (value === "comment" && !commentPlatformValues.has(platform)) {
                            setPlatform("douyin");
                          }
                          if (value === "engagement") {
                            setPlatform("wechat");
                          }
                        }}
                        title={description}
                        type="button"
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 平台筛选 */}
                <div>
                  <label className="text-sm font-medium text-[var(--kaypal-v3-soft-ink)]">
                    平台范围
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {runnablePlatformOptions.map((item) => (
                      <button
                        key={item.value}
                        className={`kaypal-v2-filter-chip rounded-[var(--kaypal-v3-radius-sm)] border px-4 py-2 text-sm font-medium transition ${
                          platform === item.value
                            ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                            : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)]"
                        }`}
                        onClick={() => setPlatform(item.value)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 错误提示 */}
          {searchRun.error && (
            <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
              <p className="text-sm font-medium text-[var(--kaypal-v3-danger)]">{searchRun.error}</p>
              {searchRun.failures.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-[var(--kaypal-v3-danger)] pt-2 text-sm text-[var(--kaypal-v3-danger)]">
                  {searchRun.failures.map((failure) => (
                    <li key={`${failure.platform}-${failure.callLogId || failure.errorCode || failure.error}`}>
                      <span className="font-medium">{failure.platformLabel}：</span>
                      {failure.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 成功提示 */}
          {searchRun.summary && !searchRun.error && (
            <div className="mt-4 rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] p-4">
              <p className="text-sm font-medium text-[var(--kaypal-v3-success)]">
                已完成搜索，找到 {filteredCandidates.length} 个结果
              </p>
            </div>
          )}
        </div>
      </section>

      {/* 搜索结果区域 */}
      {hasResults && (
        <section className="grid gap-6 lg:grid-cols-[1fr_400px]">
          {/* 左侧：结果列表 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[var(--kaypal-v3-ink)]">
                搜索结果（{filteredCandidates.length}）
              </h2>
              <span className="text-sm text-[var(--kaypal-v3-muted)]">
                点击卡片查看详情
              </span>
            </div>

            <div className="space-y-3">
              {filteredCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  className={`kaypal-v3-panel w-full p-5 text-left transition ${
                    selected?.id === candidate.id
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] shadow-md"
                      : "hover:border-[var(--kaypal-v3-border-strong)] hover:shadow-sm"
                  }`}
                  onClick={() => setSelectedId(candidate.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                          {candidate.title}
                        </h3>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${riskClass(candidate.risk)}`}
                        >
                          {riskLabel(candidate.risk)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)] line-clamp-2">
                        {candidate.reason}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--kaypal-v3-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Database className="h-3.5 w-3.5" />
                          {candidate.platform}
                        </span>
                        <span>·</span>
                        <span>{candidate.targetLabel}</span>
                        <span>·</span>
                        <span>{candidate.sourceLabel}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                          {candidate.quality}
                        </div>
                        <div className="text-xs text-[var(--kaypal-v3-muted)]">价值</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-[var(--kaypal-v3-ink)]">
                          {candidate.relevance}
                        </div>
                        <div className="text-xs text-[var(--kaypal-v3-muted)]">匹配</div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：详情和下一步 */}
          {selected && (
            <aside className="space-y-4">
              <div className="kaypal-v3-panel p-5">
                <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                  下一步行动
                </h3>
                <p className="mt-1 text-sm text-[var(--kaypal-v3-muted)]">
                  选择一个动作继续处理这条情报
                </p>

                <div className="mt-4 space-y-2">
                  {selected.nextActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <a
                        key={action.label}
                        href={action.href}
                        className="flex items-center justify-between rounded-[var(--kaypal-v3-radius-sm)] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 py-3 text-sm font-medium text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-accent)] hover:bg-[var(--kaypal-v3-accent-soft)] hover:text-[var(--kaypal-v3-accent-ink)]"
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          {action.label}
                        </span>
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    );
                  })}
                </div>
              </div>

              <div className="kaypal-v3-panel p-5">
                <h3 className="text-base font-semibold text-[var(--kaypal-v3-ink)]">
                  为什么值得处理
                </h3>
                <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
                  {selected.reason}
                </p>

                <div className="mt-4 space-y-2">
                  {selected.evidence.map((item, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]" />
                      <span className="text-sm text-[var(--kaypal-v3-muted)]">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </section>
      )}

      {/* 空状态 */}
      {!hasResults && hasSearched && !searchRun.loading && (
        <section className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-paper-muted)]">
            <Search className="h-8 w-8 text-[var(--kaypal-v3-muted)]" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            没有找到匹配的结果
          </h3>
          <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
            试试调整关键词、平台或对象类型后重新搜索
          </p>
        </section>
      )}

      {/* 加载状态 */}
      {searchRun.loading && (
        <section className="kaypal-v3-panel p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--kaypal-v3-accent-soft)]">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--kaypal-v3-accent)] border-t-transparent" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-[var(--kaypal-v3-ink)]">
            正在搜索...
          </h3>
          <p className="mt-2 text-sm text-[var(--kaypal-v3-muted)]">
            系统正在从多个平台查找相关情报
          </p>
        </section>
      )}
    </div>
  );
}
