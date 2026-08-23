"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  FileSearch,
  Gauge,
  MessageSquareText,
  Search,
  ShieldAlert,
  Sparkles,
  UserRoundSearch,
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
type TaskStage = "setup" | "review" | "dispatch";

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

type QueueItem = {
  id: string;
  candidateTitle: string;
  href: string;
  label: string;
  risk: RiskLevel;
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

const platformOptions: Array<{ label: string; value: PlatformFilter }> = [
  { label: "全网", value: "all" },
  { label: "抖音", value: "douyin" },
  { label: "小红书", value: "xiaohongshu" },
  { label: "B站", value: "bilibili" },
  { label: "公众号", value: "wechat" },
];

const commentPlatformValues = new Set<PlatformFilter>([
  "douyin",
  "xiaohongshu",
  "bilibili",
]);
const engagementPlatformValues = new Set<PlatformFilter>(["wechat"]);

function publicSearchErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    (error instanceof ApiError && error.errorCode === "INSUFFICIENT_CREDITS") ||
    /INSUFFICIENT_CREDITS|积分余额不足|积分不足|余额不足/i.test(message)
  ) {
    return "积分余额不足，请充值或调整任务消耗后再试。";
  }
  if (
    error instanceof ApiError &&
    error.errorCode === "INTELLIGENCE_SEARCH_ALL_SOURCES_FAILED"
  ) {
    return message || "数据查找暂时不可用，请查看各平台原因后重试。";
  }
  if (
    /redfox|api key|key|required|能力目录|数据查找能力|数据服务|unauthorized|forbidden/i.test(
      message,
    )
  ) {
    return "当前数据服务暂时不可用，本次不会用示例替代真实结果。请稍后重试或换个平台、关键词。";
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

const targetOptions: Array<{
  icon: LucideIcon;
  label: string;
  value: TargetFilter;
}> = [
  { icon: Search, label: "全部", value: "all" },
  { icon: FileSearch, label: "作品", value: "post" },
  { icon: UserRoundSearch, label: "账号", value: "account" },
  { icon: MessageSquareText, label: "评论", value: "comment" },
  { icon: Gauge, label: "文章互动", value: "engagement" },
];

const exampleCandidates: SearchCandidate[] = [
  {
    id: "douyin-local-life-post",
    title: "同城探店获客短视频：标题直接给门店场景",
    target: "post",
    targetLabel: "作品样本",
    platform: "抖音",
    sourceSkill: "抖音作品查询",
    sourceLabel: "系统从短视频内容库找到",
    queryIntent: "同城探店、门店获客、短视频脚本",
    quality: 86,
    relevance: 91,
    risk: "medium",
    decision: "导入素材",
    reason:
      "适合拆标题结构、前三秒钩子和评论提问，但价格、功效、优惠表达要复核。",
    evidence: ["标题有明确用户场景", "评论里有到店问题", "可转脚本和素材标签"],
    nextActions: [
      { label: "导入素材", href: "/content", icon: Database },
      { label: "爆款拆解", href: "/intelligence/viral", icon: Gauge },
      { label: "风险复核", href: "/intelligence/risks", icon: ShieldAlert },
    ],
  },
  {
    id: "xiaohongshu-founder-account",
    title: "老板 IP 轻咨询账号：低粉稳定互动",
    target: "account",
    targetLabel: "账号样本",
    platform: "小红书",
    sourceSkill: "小红书爆款笔记查询",
    sourceLabel: "系统从内容社区账号库找到",
    queryIntent: "老板 IP、咨询获客、低粉爆款",
    quality: 89,
    relevance: 88,
    risk: "low",
    decision: "进入对标",
    reason: "账号定位清楚，内容栏目稳定，适合进入长期对标和增长策略拆解。",
    evidence: ["栏目边界清楚", "互动问题集中在获客方法", "适合监控更新节奏"],
    nextActions: [
      {
        label: "对标账号",
        href: "/intelligence/accounts",
        icon: UserRoundSearch,
      },
      { label: "增长策略", href: "/growth?view=strategies", icon: ArrowRight },
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
    ],
  },
  {
    id: "bilibili-ai-tool-post",
    title: "AI 工具流程教程：长视频可拆成系列内容",
    target: "post",
    targetLabel: "作品样本",
    platform: "B站",
    sourceSkill: "B站关键词搜作品",
    sourceLabel: "系统从长视频内容库找到",
    queryIntent: "AI 工具、流程、教程复盘",
    quality: 82,
    relevance: 84,
    risk: "low",
    decision: "导入素材",
    reason:
      "信息密度高，适合拆步骤、工具清单和转化型文章，不直接复用原视频表达。",
    evidence: ["教程结构完整", "可拆文章大纲", "适合生成多平台选题"],
    nextActions: [
      { label: "导入素材", href: "/content", icon: Database },
      { label: "内容优化", href: "/content/optimization", icon: Sparkles },
      { label: "生成选题", href: "/topics", icon: FileSearch },
    ],
  },
  {
    id: "douyin-comment-faq",
    title: "抖音私域获客评论：用户反复问成本和落地难度",
    target: "comment",
    targetLabel: "评论线索",
    platform: "抖音",
    sourceSkill: "抖音评论采集",
    sourceLabel: "系统从作品评论里找到",
    queryIntent: "私域获客、线索承接、用户异议",
    quality: 78,
    relevance: 93,
    risk: "medium",
    decision: "评论洞察",
    reason: "评论能直接沉淀 FAQ、回复规则和转化话术，但不能自动私信触达。",
    evidence: [
      "问题集中，适合生成 FAQ",
      "能反向补内容选题",
      "触达动作需要人工确认",
    ],
    nextActions: [
      {
        label: "线索洞察",
        href: "/intelligence/leads",
        icon: MessageSquareText,
      },
      { label: "情报规则", href: "/intelligence/rules", icon: CheckCircle2 },
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
    ],
  },
  {
    id: "wechat-article-engagement",
    title: "公众号私域方法文章：阅读高但收藏和分享更值得看",
    target: "engagement",
    targetLabel: "文章互动",
    platform: "公众号",
    sourceSkill: "公众号文章互动分析",
    sourceLabel: "系统从公众号文章指标里找到",
    queryIntent: "公众号文章、阅读、点赞、评论数、分享、收藏",
    quality: 81,
    relevance: 86,
    risk: "low",
    decision: "互动分析",
    reason:
      "适合判断文章是不是只有阅读量，还是有收藏、分享、评论数支撑，不能当成评论内容明细。",
    evidence: ["有阅读和互动指标", "可判断内容热度质量", "不展示评论明细"],
    nextActions: [
      { label: "导入素材", href: "/content", icon: Database },
      { label: "生成报告", href: "/intelligence/reports", icon: FileSearch },
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
    ],
  },
  {
    id: "wechat-tourism-feed",
    title: "文旅公众号信息源：政策和活动信息密集",
    target: "post",
    targetLabel: "行业源",
    platform: "公众号",
    sourceSkill: "文旅公众号信息源",
    sourceLabel: "系统从行业信息源找到",
    queryIntent: "文旅活动、城市营销、行业动态",
    quality: 80,
    relevance: 76,
    risk: "low",
    decision: "加入监控",
    reason: "更适合做持续信息源，进入监控后按城市、活动类型和节假日复盘。",
    evidence: ["来源适合长期跟踪", "能支撑行业选题", "可和热点雷达交叉验证"],
    nextActions: [
      { label: "加入监控", href: "/intelligence/monitors", icon: BellRing },
      { label: "行业源", href: "/intelligence/industries", icon: Database },
      { label: "生成选题", href: "/topics", icon: Sparkles },
    ],
  },
  {
    id: "douyin-short-drama-risk",
    title: "短剧投流素材：强刺激标题和版权风险高",
    target: "post",
    targetLabel: "作品样本",
    platform: "抖音",
    sourceSkill: "抖音实时作品搜索",
    sourceLabel: "系统从短视频内容库找到",
    queryIntent: "短剧投流、素材结构、爆款标题",
    quality: 73,
    relevance: 69,
    risk: "high",
    decision: "导入素材",
    reason: "只保留结构观察价值，不能直接进入业务流程，先走风险审核。",
    evidence: ["标题表达刺激性高", "素材版权不确定", "只拆节奏，不复用原文"],
    nextActions: [
      { label: "风险复核", href: "/intelligence/risks", icon: ShieldAlert },
      { label: "爆款拆解", href: "/intelligence/viral", icon: Gauge },
      { label: "沉淀规则", href: "/intelligence/rules", icon: CheckCircle2 },
    ],
  },
];

const routingRules = [
  [
    "作品",
    "质量高、业务相关、来源清楚",
    "素材库 / 爆款拆解",
    "保留来源和发布时间",
  ],
  [
    "账号",
    "定位相近、更新稳定、互动真实",
    "对标账号 / 增长策略",
    "不自动触达账号用户",
  ],
  [
    "评论",
    "抖音、小红书、B站评论问题集中",
    "评论洞察 / 回复规则",
    "触达前必须人工确认",
  ],
  [
    "文章互动",
    "公众号文章有阅读、点赞、评论数、分享等指标",
    "文章互动分析 / 报告",
    "不展示评论明细",
  ],
  [
    "关键词",
    "持续出现、多处有样本",
    "自动跟踪 / 行业源",
    "设置频次并按次扣积分",
  ],
];

function riskLabel(risk: RiskLevel) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需复核";
  return "可入库";
}

function riskScore(risk: RiskLevel) {
  if (risk === "high") return 86;
  if (risk === "medium") return 48;
  return 16;
}

function riskClass(risk: RiskLevel) {
  if (risk === "high") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  if (risk === "medium") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
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

function optionLabel<T extends string>(
  options: Array<{ label: string; value: T }>,
  value: T,
) {
  return options.find((item) => item.value === value)?.label || "全部";
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
              { label: "生成选题", href: "/topics", icon: FileSearch },
            ],
  };
}

export function SearchIntelligenceWorkbench() {
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [target, setTarget] = useState<TargetFilter>("all");
  const [query, setQuery] = useState("私域获客");
  const [submittedQuery, setSubmittedQuery] = useState("私域获客");
  const [selectedId, setSelectedId] = useState("");
  const [taskStage, setTaskStage] = useState<TaskStage>("review");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [realCandidates, setRealCandidates] = useState<SearchCandidate[]>([]);
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
  const emptyEndpoint = searchRun.summary?.endpoints.find(
    (endpoint) => endpoint.status === "empty",
  );
  const hasEmptyResult = Boolean(emptyEndpoint);
  const cachedEndpoint = searchRun.summary?.endpoints.find(
    (endpoint) => endpoint.status === "cached",
  );
  const hasCachedResult = Boolean(cachedEndpoint);
  const failedEndpoints =
    searchRun.summary?.endpoints.filter(
      (endpoint) => endpoint.status === "failed",
    ) ?? [];
  const resultCostPoints =
    searchRun.summary?.endpoints.reduce(
      (sum, endpoint) => sum + (Number(endpoint.costPoints) || 0),
      0,
    ) ?? 0;
  const resultCostText =
    resultCostPoints > 0 ? `本次扣 ${resultCostPoints} 点` : "本次扣 0 点";
  const costHint =
    target === "engagement"
      ? "首次分析预计扣 80 点；复用历史结果扣 0 点。"
      : target === "comment"
        ? "评论采集会扣积分；完成后显示本次扣多少。"
        : "真实查找会扣积分；完成后显示本次扣多少。";

  async function runSearchTask() {
    const nextQuery = query.trim() || "私域获客";
    setSubmittedQuery(nextQuery);
    setTaskStage("review");
    setRealCandidates([]);
    setSelectedId("");
    setQueue([]);

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

  function addToQueue(
    candidate: SearchCandidate,
    action: SearchCandidate["nextActions"][number],
  ) {
    setQueue((current) => {
      const existing = current.find(
        (item) =>
          item.candidateTitle === candidate.title &&
          item.label === action.label,
      );
      if (existing) return current;
      return [
        {
          candidateTitle: candidate.title,
          href: action.href,
          id: `${candidate.id}-${action.label}`,
          label: action.label,
          risk: candidate.risk,
        },
        ...current,
      ].slice(0, 6);
    });
    setTaskStage("dispatch");
  }

  const decisionStats = [
    {
      label: "本次任务",
      value: submittedQuery,
      detail: `${optionLabel(platformOptions, platform)} · ${optionLabel(targetOptions, target)}`,
    },
    {
      label: "可推进样本",
      value: String(
        filteredCandidates.filter((item) => item.risk !== "high").length,
      ),
      detail: searchRun.summary
        ? hasCachedResult
          ? "已复用历史结果"
          : `新增 ${searchRun.summary.created}，更新 ${searchRun.summary.updated}`
        : "可以直接进入下一步处理",
    },
    {
      label: "分发任务",
      value: String(queue.length),
      detail: "你选中的下一步动作",
    },
  ];

  const taskSteps: Array<{ key: TaskStage; label: string; detail: string }> = [
    { key: "setup", label: "说清楚要找什么", detail: "输入一句业务问题" },
    { key: "review", label: "挑有用的结果", detail: "看价值、匹配度和风险" },
    {
      key: "dispatch",
      label: "点下一步处理",
      detail: "保存、分析、跟踪或审核",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
          <header className="border-b border-[var(--kaypal-v3-border)] p-4 xl:border-b-0 xl:border-r">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Search
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">一键找线索</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  输入一句话，系统自动找内容、账号和评论机会
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  输入目标后，可查看相关内容、账号、评论和数据来源，并保存后续跟进事项。
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="block">
                <span className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                  {target === "comment"
                    ? "作品链接或作品 ID"
                    : target === "engagement"
                      ? "公众号文章链接"
                      : "你想找什么"}
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-[8px] border border-[var(--kaypal-v3-field-border)] bg-[var(--kaypal-v3-field-bg)] px-3 text-13 text-[var(--kaypal-v3-ink)] outline-none transition focus:border-[var(--kaypal-v3-accent)] focus:shadow-[var(--kaypal-v3-field-shadow-focus)]"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setTaskStage("setup");
                  }}
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
              </label>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white disabled:opacity-60"
                  disabled={searchRun.loading}
                  onClick={() => void runSearchTask()}
                  type="button"
                >
                  <Sparkles
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                  {searchRun.loading ? "正在查找" : "开始查找"}
                </button>
              </div>
            </div>
            <p className="mt-2 text-12 font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
              {costHint}
            </p>

            {searchRun.error ? (
              <div
                className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]"
                role="alert"
              >
                <p className="font-semibold">{searchRun.error}</p>
                {searchRun.failures.length ? (
                  <ul className="mt-2 grid gap-1 border-t border-[var(--kaypal-v3-danger)]/30 pt-2">
                    {searchRun.failures.map((failure) => (
                      <li key={`${failure.platform}-${failure.callLogId || failure.errorCode || failure.error}`}>
                        <span className="font-semibold">
                          {failure.platformLabel}：
                        </span>
                        {failure.error}
                        {failure.callLogId ? (
                          <span className="ml-1 font-mono text-11 text-[var(--kaypal-v3-muted)]">
                            调用编号 {failure.callLogId}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {searchRun.requestId ? (
                  <p className="mt-2 font-mono text-11 text-[var(--kaypal-v3-muted)]">
                    请求编号 {searchRun.requestId}
                  </p>
                ) : null}
              </div>
            ) : null}

            {searchRun.summary ? (
              <div
                className={[
                  "mt-3 rounded-[8px] border px-3 py-2 text-12 font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]",
                  hasEmptyResult
                    ? "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]"
                    : "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]",
                ].join(" ")}
              >
                {hasEmptyResult ? (
                  <>
                    已完成文章互动分析，{resultCostText}
                    。这篇文章没有返回可用互动指标，未放入结果列表。建议先用“作品”查找公众号文章，再选择已找到的文章做互动分析。
                  </>
                ) : hasCachedResult ? (
                  <>已复用这篇文章的历史互动指标，本次扣 0 点。</>
                ) : (
                  <>
                    已完成{" "}
                    {target === "comment"
                      ? "评论采集"
                      : target === "engagement"
                        ? "文章互动分析"
                        : "数据查找"}{" "}
                    {searchRun.summary.endpoints.length} 次，{resultCostText}
                    ，入库 {searchRun.summary.created} 条，更新{" "}
                    {searchRun.summary.updated} 条。
                  </>
                )}
              </div>
            ) : null}

            {failedEndpoints.length ? (
              <div className="mt-2 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] px-3 py-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                <p className="font-semibold">
                  部分数据来源未完成，其余结果已正常保留。
                </p>
                <ul className="mt-1 grid gap-1">
                  {failedEndpoints.map((endpoint) => (
                    <li key={`${endpoint.platform}-${endpoint.callLogId || endpoint.errorCode || endpoint.endpoint}`}>
                      {endpoint.platformLabel}：
                      {endpoint.error || "数据服务请求失败"}
                      {endpoint.callLogId ? (
                        <span className="ml-1 font-mono text-11 text-[var(--kaypal-v3-muted)]">
                          调用编号 {endpoint.callLogId}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {targetOptions.map(({ icon: Icon, label, value }) => (
                <button
                  aria-pressed={target === value}
                  className={[
                    "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-12 font-semibold transition",
                    target === value
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                  ].join(" ")}
                  key={value}
                  onClick={() => {
                    const needsWorkLink =
                      value === "comment" || value === "engagement";
                    const wasWorkLink =
                      target === "comment" || target === "engagement";
                    setTarget(value);
                    if (value !== target && needsWorkLink) {
                      setQuery("");
                      setSubmittedQuery("待输入链接");
                    } else if (value !== target && wasWorkLink) {
                      setQuery("私域获客");
                      setSubmittedQuery("私域获客");
                    }
                    if (
                      value === "comment" &&
                      !commentPlatformValues.has(platform)
                    ) {
                      setPlatform("douyin");
                    }
                    if (value === "engagement") {
                      setPlatform("wechat");
                    }
                    setSearchRun({
                      loading: false,
                      error: null,
                      failures: [],
                      requestId: null,
                      summary: null,
                    });
                    setRealCandidates([]);
                    setSelectedId("");
                    setQueue([]);
                    setTaskStage("setup");
                  }}
                  type="button"
                >
                  <Icon
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {runnablePlatformOptions.map((item) => (
                <button
                  aria-pressed={platform === item.value}
                  className={[
                    "h-8 rounded-[8px] border px-3 text-12 font-semibold transition",
                    platform === item.value
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                  ].join(" ")}
                  key={item.value}
                  onClick={() => {
                    setPlatform(item.value);
                    setSearchRun({
                      loading: false,
                      error: null,
                      failures: [],
                      requestId: null,
                      summary: null,
                    });
                    setRealCandidates([]);
                    setSelectedId("");
                    setQueue([]);
                    setTaskStage("setup");
                  }}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {target === "engagement" ? (
              <p className="mt-2 text-12 font-semibold leading-5 text-[var(--kaypal-v3-muted)]">
                公众号只分析文章互动指标，包括阅读、点赞、评论数、收藏、分享和赞赏。优先分析系统已找到的公众号文章，陌生链接可能没有可用指标。
              </p>
            ) : null}

          </header>

          <aside className="p-4">
            <p className="kaypal-v3-label">怎么用</p>
            <h2 className="mt-1 text-14 font-bold text-[var(--kaypal-v3-ink)]">
              用户只需要做三件事
            </h2>
            <div className="mt-4 grid gap-2">
              {taskSteps.map((step, index) => {
                const active = taskStage === step.key;
                const done =
                  (taskStage === "review" && index === 0) ||
                  (taskStage === "dispatch" && index < 2);
                return (
                  <div
                    className={[
                      "rounded-[8px] border p-3 transition",
                      active
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                        : done
                          ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)]",
                    ].join(" ")}
                    key={step.key}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
                        {index + 1}
                      </span>
                      <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {step.label}
                      </p>
                    </div>
                    <p className="mt-1 pl-8 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {step.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <section className="grid gap-3 md:grid-cols-3">
            {decisionStats.map((item) => (
              <div className="kaypal-v3-panel p-4" key={item.label}>
                <p className="kaypal-v3-label">{item.label}</p>
                <p className="mt-1 truncate text-xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
                  {item.value}
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  {item.detail}
                </p>
              </div>
            ))}
          </section>

          <article className="kaypal-v3-panel overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--kaypal-v3-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="kaypal-v3-label">搜索结果</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  先看有没有用，再选择下一步
                </h2>
              </div>
              <span className="inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
                <Gauge
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                价值 / 匹配 / 风险
              </span>
            </div>
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {filteredCandidates.map((candidate) => (
                <button
                  className={[
                    "grid w-full gap-3 p-4 text-left transition lg:grid-cols-[minmax(0,1fr)_220px]",
                    selected?.id === candidate.id
                      ? "bg-[var(--kaypal-v3-accent-soft)]"
                      : "hover:bg-[var(--kaypal-v3-paper-soft)]",
                  ].join(" ")}
                  key={candidate.id}
                  onClick={() => {
                    setSelectedId(candidate.id);
                    setTaskStage("review");
                  }}
                  type="button"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                        {candidate.title}
                      </h3>
                      <span
                        className={[
                          "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                          riskClass(candidate.risk),
                        ].join(" ")}
                      >
                        {riskLabel(candidate.risk)}
                      </span>
                      <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                        {candidate.platform} · {candidate.targetLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {candidate.reason}
                    </p>
                    <p className="mt-2 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                      {candidate.sourceLabel} · 你要解决：
                      {candidate.queryIntent}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["价值", candidate.quality],
                      ["匹配", candidate.relevance],
                      ["风险", riskScore(candidate.risk)],
                    ].map(([label, value]) => (
                      <div
                        className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-2"
                        key={`${candidate.id}-${label}`}
                      >
                        <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                          {label}
                        </p>
                        <p className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
              {!filteredCandidates.length ? (
                <div className="grid gap-3 p-4">
                  <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                    <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {searchRun.loading
                        ? "正在读取真实搜索结果"
                        : searchRun.error
                          ? "本次搜索未产生可用结果"
                          : searchRun.summary
                            ? "本次搜索没有匹配结果"
                            : "尚未运行真实搜索"}
                    </p>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {searchRun.loading
                        ? "结果返回前不会展示示例，也不能创建后续动作。"
                        : "请调整关键词、平台或对象类型后重新运行。只有接口返回的真实结果才能进入下一步。"}
                    </p>
                  </div>
                  {!searchRun.loading ? (
                    <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                      <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                        结果结构示例（仅作说明，不是本次搜索结果）
                      </p>
                      <div className="mt-2 grid gap-2">
                        {exampleCandidates.slice(0, 3).map((candidate) => (
                          <div
                            className="rounded-[6px] bg-[var(--kaypal-v3-paper-soft)] px-3 py-2"
                            key={`example-${candidate.id}`}
                          >
                            <p className="text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                              示例：{candidate.title}
                            </p>
                            <p className="mt-0.5 text-11 text-[var(--kaypal-v3-muted)]">
                              {candidate.platform} · {candidate.targetLabel} · 不可派发
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        </div>

        <aside className="grid gap-4">
          {selected ? (
            <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">下一步</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                {selected.decision}：{selected.title}
              </h2>
            </div>
            <div className="p-4">
              <div className="grid gap-2">
                {[
                  ["对象", selected.targetLabel],
                  ["平台", selected.platform],
                  ["风险", riskLabel(selected.risk)],
                ].map(([label, value]) => (
                  <div
                    className="grid grid-cols-[72px_minmax(0,1fr)] items-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                    key={label}
                  >
                    <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                      {label}
                    </p>
                    <p className="truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                <p className="text-12 font-bold text-[var(--kaypal-v3-muted)]">
                  为什么值得处理
                </p>
                <p className="mt-1 text-13 font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {selected.reason}
                </p>
              </div>

              <div className="mt-4 grid gap-2">
                {selected.evidence.map((item) => (
                  <div className="flex items-start gap-2" key={item}>
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
                      strokeWidth={1.8}
                    />
                    <span className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {item}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-2">
                {selected.nextActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)]"
                      key={action.label}
                      onClick={() => addToQueue(selected, action)}
                      type="button"
                    >
                      <Icon
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                      下一步：{action.label}
                    </button>
                  );
                })}
              </div>
            </div>
            </section>
          ) : (
            <section className="kaypal-v3-panel overflow-hidden">
              <div className="border-b border-[var(--kaypal-v3-border)] p-4">
                <p className="kaypal-v3-label">下一步</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  等待真实搜索结果
                </h2>
              </div>
              <div className="p-4 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                示例不会进入待处理队列。运行搜索并选择一条真实结果后，才会显示保存、分析、跟踪或审核动作。
              </div>
            </section>
          )}

          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">待处理</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                你刚刚选择的动作
              </h2>
            </div>
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {queue.map((item) => (
                <div className="p-4" key={item.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={[
                        "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                        riskClass(item.risk),
                      ].join(" ")}
                    >
                      {riskLabel(item.risk)}
                    </span>
                    <Link
                      className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-2.5 text-11 font-semibold text-white"
                      href={item.href}
                    >
                      打开
                      <ArrowRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                    </Link>
                  </div>
                  <p className="mt-2 text-13 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                    {item.label}
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {item.candidateTitle}
                  </p>
                </div>
              ))}
              {!queue.length ? (
                <p className="p-4 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  选中一个结果，点击右侧下一步，就会放到这里。
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <article className="kaypal-v3-panel overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">系统自动处理</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              这些事用户不用配置
            </h2>
          </div>
          <div className="grid gap-2 p-4">
            {[
              ["多处查找", "系统会在内容、账号、评论和行业来源里一起找。"],
              [
                "自动分类",
                "结果会被分成内容样本、对标账号、评论线索和行业来源。",
              ],
              ["风险提示", "高风险结果会先提醒你，不会直接进入生产。"],
              ["下一步建议", "每条结果都给出保存、分析、跟踪或审核的动作。"],
            ].map(([title, detail]) => (
              <div
                className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                key={title}
              >
                <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                  {title}
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="kaypal-v3-panel overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">分流规则</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              搜索结果只有进入正确去向才有商业价值
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-13">
              <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    对象
                  </th>
                  <th className="px-4 py-3" scope="col">
                    入库条件
                  </th>
                  <th className="px-4 py-3" scope="col">
                    去向
                  </th>
                  <th className="px-4 py-3" scope="col">
                    边界
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
                {routingRules.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, index) => (
                      <td
                        className={[
                          "px-4 py-3 align-top leading-5 text-[var(--kaypal-v3-soft-ink)]",
                          index === 0
                            ? "font-bold text-[var(--kaypal-v3-ink)]"
                            : "",
                        ].join(" ")}
                        key={`${row[0]}-${cell}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
