"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  Globe2,
  Inbox,
  Layers3,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  UsersRound,
  type LucideIcon,
} from "@/components/iconpark";
import {
  intelligenceApi,
  type DispatchIntelligenceItemInput,
  type IntelligenceItem,
} from "@/lib/api/intelligence";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceList, publicIntelligenceText } from "./display-text";
import { IntelligenceToolResultContext } from "./intelligence-tool-result-context";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

type RiskLevel = "low" | "medium" | "high";
type IndustryKey =
  | "all"
  | "local_life"
  | "business_service"
  | "education"
  | "health_beauty"
  | "culture_tourism"
  | "retail"
  | "ai_tools";
type SignalAction =
  | "generate_topic"
  | "import_material"
  | "risk_review"
  | "rule_seed"
  | "benchmark_account"
  | "comment_insight"
  | "create_monitor";
type QueueState = "running" | "done" | "failed" | "queued";

type IndustryOption = {
  key: IndustryKey;
  label: string;
  owner: string;
  keywords: string[];
};

type IndustrySignal = {
  id: string;
  item: IntelligenceItem;
  title: string;
  industry: IndustryOption;
  platform: string;
  typeLabel: string;
  risk: RiskLevel;
  score: number;
  status: string;
  decision: string;
  boundary: string;
  evidence: string[];
  keywords: string[];
  createdAt: string;
};

type ActionView = {
  action: SignalAction;
  label: string;
  target: string;
  href: string;
  icon: LucideIcon;
  risk: RiskLevel;
  reason: string;
};

type QueueItem = {
  id: string;
  title: string;
  label: string;
  state: QueueState;
  detail: string;
  href: string;
};

const industryOptions: IndustryOption[] = [
  {
    key: "all",
    label: "全部行业",
    owner: "运营负责人",
    keywords: [],
  },
  {
    key: "local_life",
    label: "本地生活",
    owner: "增长负责人",
    keywords: ["本地生活", "同城", "门店", "探店", "到店", "团购", "生活服务"],
  },
  {
    key: "business_service",
    label: "企业服务",
    owner: "内容策划",
    keywords: ["企业服务", "SaaS", "CRM", "获客", "私域", "管理", "咨询"],
  },
  {
    key: "education",
    label: "教育培训",
    owner: "运营负责人",
    keywords: ["教育", "培训", "课程", "学习", "留学", "考研", "职教"],
  },
  {
    key: "health_beauty",
    label: "医美健康",
    owner: "复核负责人",
    keywords: ["医美", "健康", "口腔", "皮肤", "变美", "功效", "治疗"],
  },
  {
    key: "culture_tourism",
    label: "文旅活动",
    owner: "内容策划",
    keywords: ["文旅", "旅游", "城市", "活动", "展览", "节日", "景区"],
  },
  {
    key: "retail",
    label: "零售消费",
    owner: "增长负责人",
    keywords: ["零售", "消费", "餐饮", "品牌", "门店", "新品", "直播"],
  },
  {
    key: "ai_tools",
    label: "AI 工具",
    owner: "产品运营",
    keywords: ["AI", "智能体", "工具", "自动化", "流程", "模型", "Agent"],
  },
];

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "可推进",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  medium: {
    label: "需复核",
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  high: {
    label: "高风险",
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
};

const statusLabels: Record<string, string> = {
  new: "新发现",
  imported_material: "已入素材",
  generated_topic: "已成选题",
  pending_compliance: "待风险复核",
  rule_seeded: "规则种子",
  benchmarked_account: "已入对标",
  comment_insight: "线索洞察",
  growth_lead_created: "已转线索",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未标注";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    }
  }
  return [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function textForItem(item: IntelligenceItem) {
  const raw = asRecord(item.raw);
  return [
    item.title,
    item.summary,
    item.content,
    item.author,
    item.platform,
    item.type,
    item.keywords.join(" "),
    readString(raw, ["industry", "category", "scene", "topic"]),
  ]
    .filter(Boolean)
    .join(" ");
}

function industryForItem(item: IntelligenceItem) {
  const raw = asRecord(item.raw);
  const explicit = readString(raw, ["industry", "category", "vertical"]);
  const text = `${explicit} ${textForItem(item)}`.toLowerCase();
  const matched = industryOptions
    .filter((option) => option.key !== "all")
    .find((option) =>
      option.keywords.some((keyword) => text.includes(keyword.toLowerCase())),
    );
  return matched || industryOptions[1];
}

function riskForItem(item: IntelligenceItem): RiskLevel {
  const raw = asRecord(item.raw);
  const metrics = asRecord(item.metrics);
  const text = [
    item.status,
    readString(raw, ["risk", "riskLevel", "risk_level", "boundary"]),
    item.summary || "",
    item.title,
  ].join(" ");
  if (/高风险|敏感|版权|夸大|治疗|承诺|自动触达|risk|compliance/i.test(text)) {
    return "high";
  }
  const riskScore = Number(
    metrics.riskScore ?? metrics.risk_score ?? metrics.risk,
  );
  if (Number.isFinite(riskScore)) {
    if (riskScore >= 70) return "high";
    if (riskScore >= 40) return "medium";
  }
  if (/价格|报价|私信|联系方式|功效|优惠|限时/.test(text)) return "medium";
  return "low";
}

function scoreForItem(item: IntelligenceItem, risk: RiskLevel) {
  const metrics = asRecord(item.metrics);
  const metricScore = Number(
    metrics.score ??
      metrics.quality ??
      metrics.heat ??
      metrics.hotScore ??
      metrics.likeCount,
  );
  const base = Number.isFinite(metricScore) ? Math.min(96, metricScore) : 62;
  const keywordBonus = Math.min(14, item.keywords.length * 2);
  const sourceBonus = item.sourceUrl ? 8 : 0;
  const riskPenalty = risk === "high" ? 18 : risk === "medium" ? 6 : 0;
  return Math.max(
    30,
    Math.round(base + keywordBonus + sourceBonus - riskPenalty),
  );
}

function typeLabel(item: IntelligenceItem) {
  const text = `${item.type} ${item.title}`.toLowerCase();
  if (text.includes("comment") || text.includes("评论")) return "评论信号";
  if (text.includes("account") || text.includes("账号") || item.authorUrl) {
    return "账号样本";
  }
  if (text.includes("hot") || text.includes("trend") || text.includes("热点")) {
    return "趋势信号";
  }
  if (text.includes("viral") || text.includes("爆款")) return "内容样本";
  return "行业信号";
}

function evidenceForItem(item: IntelligenceItem) {
  const raw = asRecord(item.raw);
  return publicIntelligenceList(
    uniqueStrings([
      ...readStringArray(raw, ["evidence", "evidences", "proofs"]),
      item.summary || "",
      item.sourceUrl ? `来源链接：${item.sourceUrl}` : "",
      item.author ? `来源账号：${item.author}` : "",
      item.redfoxSkill?.name ? "系统来源：行业来源" : "",
    ]),
  );
}

function boundaryForSignal(signal: Pick<IndustrySignal, "risk" | "typeLabel">) {
  if (signal.risk === "high") {
    return "先进入风险审核，不进入内容生产，不直接复用第三方表达。";
  }
  if (signal.typeLabel === "评论信号") {
    return "只作为人工判断输入，不自动私信，不自动触达用户。";
  }
  if (signal.typeLabel === "账号样本") {
    return "只观察栏目、互动和定位，不采集隐私字段，不自动外联。";
  }
  return "保留来源和证据，可转选题、素材或监控，不搬运原文。";
}

function decisionForSignal(signal: Pick<IndustrySignal, "risk" | "typeLabel">) {
  if (signal.risk === "high") return "先送风险审核，再决定是否进入内容流程。";
  if (signal.typeLabel === "评论信号")
    return "沉淀痛点、异议和需求词，转线索洞察。";
  if (signal.typeLabel === "账号样本")
    return "进入对标账号池，观察栏目和评论问题。";
  if (signal.typeLabel === "趋势信号")
    return "创建行业监控，进入日报和选题判断。";
  return "可生成选题或导入素材，保留证据后进入生产准备。";
}

function toSignal(item: IntelligenceItem): IndustrySignal {
  const industry = industryForItem(item);
  const risk = riskForItem(item);
  const signalType = typeLabel(item);
  const score = scoreForItem(item, risk);
  const shell = {
    risk,
    typeLabel: signalType,
  };
  return {
    id: item.id,
    item,
    title: publicIntelligenceText(item.title, "行业信号"),
    industry,
    platform: item.platform,
    typeLabel: signalType,
    risk,
    score,
    status: item.status,
    decision: decisionForSignal(shell),
    boundary: boundaryForSignal(shell),
    evidence: evidenceForItem(item),
    keywords: uniqueStrings([industry.label, ...item.keywords]).slice(0, 8),
    createdAt: item.createdAt,
  };
}

function primaryPlatform(platform: string) {
  if (platform.includes("抖音") || platform.toLowerCase().includes("douyin")) {
    return "douyin";
  }
  if (platform.includes("小红书") || platform.toLowerCase().includes("xiao")) {
    return "xiaohongshu";
  }
  if (platform.includes("B站") || platform.toLowerCase().includes("bilibili")) {
    return "bilibili";
  }
  if (platform.includes("视频号") || platform.includes("公众号")) {
    return "wechat";
  }
  return platform || "all";
}

function actionKey(action: SignalAction) {
  const map: Record<
    SignalAction,
    DispatchIntelligenceItemInput["action"] | SignalAction
  > = {
    generate_topic: "generate_topic",
    import_material: "import_material",
    risk_review: "risk_review",
    rule_seed: "rule_seed",
    benchmark_account: "benchmark_account",
    comment_insight: "comment_insight",
    create_monitor: "create_monitor",
  };
  return map[action];
}

function actionsForSignal(signal: IndustrySignal): ActionView[] {
  const base: ActionView[] = [
    {
      action: "generate_topic",
      label: "生成选题",
      target: "选题库",
      href: "/topics",
      icon: Sparkles,
      risk: "low",
      reason: "行业信号可进入选题判断。",
    },
    {
      action: "import_material",
      label: "导入素材",
      target: "素材库",
      href: "/content",
      icon: Database,
      risk: "low",
      reason: "保留来源后进入素材池。",
    },
    {
      action: "create_monitor",
      label: "创建监控",
      target: "自动跟踪",
      href: "/intelligence/monitors",
      icon: BellRing,
      risk: "low",
      reason: "行业信号需要持续观察。",
    },
  ];

  if (signal.risk === "high") {
    return [
      {
        action: "risk_review",
        label: "送风险审核",
        target: "风险审核",
        href: "/intelligence/risks",
        icon: ShieldAlert,
        risk: "high",
        reason: signal.boundary,
      },
      {
        action: "rule_seed",
        label: "沉淀规则",
        target: "情报规则",
        href: "/intelligence/rules",
        icon: CheckCircle2,
        risk: "medium",
        reason: "把风险原因沉淀为行业规则。",
      },
      base[2],
    ];
  }

  if (signal.typeLabel === "评论信号") {
    return [
      {
        action: "comment_insight",
        label: "线索洞察",
        target: "线索洞察",
        href: "/intelligence/leads",
        icon: Target,
        risk: "medium",
        reason: "评论问题可沉淀为痛点、异议和意向词。",
      },
      base[0],
      base[2],
    ];
  }

  if (signal.typeLabel === "账号样本") {
    return [
      {
        action: "benchmark_account",
        label: "进入对标",
        target: "对标账号",
        href: "/intelligence/accounts",
        icon: UsersRound,
        risk: "low",
        reason: "账号定位和互动可进入长期观察。",
      },
      base[2],
      base[0],
    ];
  }

  return base;
}

function riskClass(risk: RiskLevel) {
  return riskMeta[risk].className;
}

function statusLabel(status: string) {
  return statusLabels[status] || status || "待判断";
}

export function IndustryIntelligenceWorkbench() {
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool");
  const [items, setItems] = useState<IntelligenceItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [industryKey, setIndustryKey] = useState<IndustryKey>("all");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [runningAction, setRunningAction] = useState<SignalAction | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    intelligenceApi
      .listItems({
        page: 1,
        limit: 100,
        keyword: submittedQuery.trim() || undefined,
        sortBy: "updatedAt",
        sortOrder: "desc",
      })
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setItems([]);
        setError(toActionableError(reason, "行业情报读取失败"));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey, submittedQuery]);

  const allSignals = useMemo(() => items.map(toSignal), [items]);

  const filteredSignals = useMemo(() => {
    const trimmed = submittedQuery.trim();
    return allSignals.filter((signal) => {
      const industryMatched =
        industryKey === "all" || signal.industry.key === industryKey;
      if (!industryMatched) return false;
      if (!trimmed) return true;
      return [
        signal.title,
        signal.industry.label,
        signal.platform,
        signal.typeLabel,
        signal.keywords.join(" "),
        signal.decision,
      ]
        .join(" ")
        .includes(trimmed);
    });
  }, [allSignals, industryKey, submittedQuery]);

  const selectedSignal =
    filteredSignals.find((signal) => signal.id === selectedId) ||
    filteredSignals[0] ||
    null;

  const industryRows = useMemo(() => {
    return industryOptions.map((option) => {
      const scoped =
        option.key === "all"
          ? allSignals
          : allSignals.filter((signal) => signal.industry.key === option.key);
      return {
        ...option,
        count: scoped.length,
        highRisk: scoped.filter((signal) => signal.risk === "high").length,
        avgScore: scoped.length
          ? Math.round(
              scoped.reduce((total, signal) => total + signal.score, 0) /
                scoped.length,
            )
          : 0,
      };
    });
  }, [allSignals]);

  const metrics = useMemo(
    () => [
      {
        label: "行业信号",
        value: String(filteredSignals.length),
        detail: "当前筛选下可判断对象",
        icon: Globe2,
      },
      {
        label: "高风险",
        value: String(
          filteredSignals.filter((signal) => signal.risk === "high").length,
        ),
        detail: "先进入风险审核",
        icon: ShieldAlert,
      },
      {
        label: "可派发",
        value: String(
          filteredSignals.filter((signal) => signal.status === "new").length,
        ),
        detail: "可转选题、素材、监控",
        icon: GitBranch,
      },
      {
        label: "平台覆盖",
        value: String(
          new Set(filteredSignals.map((signal) => signal.platform)).size,
        ),
        detail: "跨平台样本数量",
        icon: Layers3,
      },
    ],
    [filteredSignals],
  );

  const actions = selectedSignal ? actionsForSignal(selectedSignal) : [];

  function runSearch() {
    setSubmittedQuery(query.trim());
  }

  function reload() {
    setRefreshKey((value) => value + 1);
  }

  function updateQueue(id: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function runAction(action: ActionView) {
    if (!selectedSignal || runningAction) return;
    const queueId = `${selectedSignal.id}:${action.action}`;
    setRunningAction(action.action);
    setQueue((current) =>
      [
        {
          id: queueId,
          title: selectedSignal.title,
          label: action.label,
          href: action.href,
          state: "running" as const,
          detail: "正在写入业务模块",
        },
        ...current.filter((item) => item.id !== queueId),
      ].slice(0, 8),
    );

    try {
      if (action.action === "generate_topic") {
        await intelligenceApi.generateTopic(selectedSignal.id, {
          title: selectedSignal.title,
          description: selectedSignal.decision,
          summary: selectedSignal.boundary,
          sourceType: "行业情报",
          keywords: selectedSignal.keywords,
          searchQueries: selectedSignal.keywords.slice(0, 3),
        });
        updateQueue(queueId, {
          state: "done",
          detail: "已生成选题草稿。",
          href: "/topics",
        });
        reload();
        return;
      }

      if (action.action === "import_material") {
        await intelligenceApi.importMaterial(selectedSignal.id, {
          title: selectedSignal.title,
          summary: selectedSignal.decision,
          sourceUrl: selectedSignal.item.sourceUrl || undefined,
          platform: selectedSignal.platform,
          author: selectedSignal.item.author || undefined,
          keywords: selectedSignal.keywords,
        });
        updateQueue(queueId, {
          state: "done",
          detail: "已导入素材库，来源和行业标签已保留。",
          href: "/content",
        });
        reload();
        return;
      }

      if (action.action === "create_monitor") {
        await intelligenceApi.createMonitor({
          type: "industry",
          schedule: "0 */8 * * *",
          platform: primaryPlatform(selectedSignal.platform),
          industry: selectedSignal.industry.label,
          keyword: selectedSignal.keywords[1] || selectedSignal.industry.label,
          status: "active",
          costLimitPoints: 300,
          config: {
            source: "industry-intelligence-workbench",
            intelligenceItemId: selectedSignal.id,
            sourceTitle: selectedSignal.title,
            guardrails: ["保留来源", "高风险先审核", "不自动触达"],
          },
        });
        updateQueue(queueId, {
          state: "done",
          detail: "已创建 8 小时频率的行业监控。",
          href: "/intelligence/monitors",
        });
        return;
      }

      const result = await intelligenceApi.dispatchItem(selectedSignal.id, {
        action: actionKey(action.action),
        label: action.label,
        target: action.target,
        href: action.href,
        risk: action.risk,
        reason: action.reason,
      });
      updateQueue(queueId, {
        state: result.status === "queued" ? "queued" : "done",
        detail: result.message,
        href: result.href || action.href,
      });
      reload();
    } catch (reason) {
      updateQueue(queueId, {
        state: "failed",
        detail: toActionableError(reason, "动作执行失败"),
      });
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <Globe2
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">行业源</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  行业情报驾驶舱
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  按行业聚合真实情报对象，判断机会、风险、样本和监控去向。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                onClick={reload}
                type="button"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={["h-4 w-4", loading ? "animate-spin" : ""].join(
                    " ",
                  )}
                  strokeWidth={1.8}
                />
                刷新
              </button>
              <Link
                className="inline-flex h-12 items-center gap-2 rounded-[10px] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0"
                href="/intelligence/monitors"
              >
                创建监控
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
              <input
                className="h-10 w-full rounded-[8px] pl-9 pr-3 text-13"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") runSearch();
                }}
                placeholder="搜索行业、关键词、账号、评论问题或平台"
                value={query}
              />
            </div>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-5 text-sm font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
              onClick={runSearch}
              type="button"
            >
              <Search
                aria-hidden="true"
                className="h-4 w-4"
                strokeWidth={1.8}
              />
              搜索
            </button>
          </div>

        </div>
      </section>

      <IntelligenceToolResultContext tool={activeTool} />

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <div className="kaypal-v3-panel min-h-[92px] p-3" key={label}>
            <div className="flex items-center justify-between gap-3">
              <p className="kaypal-v3-label">{label}</p>
              <Icon
                aria-hidden="true"
                className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
            </div>
            <p className="mt-1 text-xl font-bold leading-7 text-[var(--kaypal-v3-ink)]">
              {value}
            </p>
            <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
              {detail}
            </p>
          </div>
        ))}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[300px_minmax(360px,0.95fr)_minmax(0,1.05fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">行业分组</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              信号密度
            </h2>
          </div>
          <div className="grid gap-2 p-3">
            {industryRows.map((row) => {
              const active = industryKey === row.key;
              return (
                <button
                  aria-pressed={active}
                  className={[
                    "rounded-[8px] border p-3 text-left transition",
                    active
                      ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                      : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                  ].join(" ")}
                  key={row.key}
                  onClick={() => setIndustryKey(row.key)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {row.label}
                    </span>
                    <span className="text-12 font-bold text-[var(--kaypal-v3-accent-ink)]">
                      {row.count}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                    <span>均分 {row.avgScore || "--"}</span>
                    <span>高风险 {row.highRisk}</span>
                  </div>
                  <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                    {row.owner}
                  </p>
                </button>
              );
            })}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">真实情报</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              行业信号队列
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center p-4 text-13 font-semibold text-[var(--kaypal-v3-muted)]">
                <SkeletonList rows={3} />
              </div>
            ) : error ? (
              <div className="p-4">
                <FailureActionPanel
                  actions={[
                    {
                      label: "重新读取",
                      onPress: () => {
                        setRefreshKey((value) => value + 1);
                      },
                    },
                    { href: "/intelligence/search", label: "一键找线索" },
                  ]}
                  impact="行业信号、证据、分发动作和行业判断暂时不可用。"
                  nextAction="先重新读取；仍失败时回到一键找线索或自动跟踪补充来源。"
                  reason={error}
                  title="行业情报需要处理"
                />
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="p-4">
                <FunctionalEmptyState
                  actions={[
                    { href: "/intelligence/search", label: "一键找线索" },
                    { href: "/intelligence/trends", label: "热点雷达" },
                    { href: "/intelligence/monitors", label: "自动跟踪" },
                  ]}
                  description="当前筛选下没有可判断的行业信号。先从一键找线索、热点雷达或自动跟踪同步情报对象。"
                  examples={["行业关键词", "平台热点", "监控结果", "证据文本"]}
                  icon={Globe2}
                  surface="plain"
                  title="当前没有行业信号"
                />
              </div>
            ) : (
              filteredSignals.map((signal) => {
                const active = selectedSignal?.id === signal.id;
                return (
                  <button
                    aria-pressed={active}
                    className={[
                      "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                      active
                        ? "bg-[var(--kaypal-v3-accent-soft)]"
                        : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                    ].join(" ")}
                    key={signal.id}
                    onClick={() => setSelectedId(signal.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                            {signal.industry.label}
                          </span>
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              riskClass(signal.risk),
                            ].join(" ")}
                          >
                            {riskMeta[signal.risk].label}
                          </span>
                          <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                            {signal.score}
                          </span>
                        </div>
                        <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                          {signal.title}
                        </h3>
                        <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {signal.platform} · {signal.typeLabel} ·{" "}
                          {statusLabel(signal.status)} ·{" "}
                          {formatTime(signal.createdAt)}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="mt-1 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                        strokeWidth={1.8}
                      />
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">证据和去向</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {selectedSignal?.title || "等待选择信号"}
            </h2>
          </div>
          {selectedSignal ? (
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["行业", selectedSignal.industry.label],
                  ["负责人", selectedSignal.industry.owner],
                  ["状态", statusLabel(selectedSignal.status)],
                ].map(([label, value]) => (
                  <div
                    className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                    key={label}
                  >
                    <p className="kaypal-v3-label">{label}</p>
                    <p className="mt-1 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                <p className="kaypal-v3-label">判断结论</p>
                <p className="mt-2 text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                  {selectedSignal.decision}
                </p>
                <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3">
                  <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {selectedSignal.boundary}
                  </p>
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                <p className="kaypal-v3-label">业务动作</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {actions.map(
                    ({ action, label, icon: ActionIcon, ...rest }) => {
                      const running = runningAction === action;
                      return (
                        <button
                          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={Boolean(runningAction)}
                          key={action}
                          onClick={() =>
                            runAction({
                              action,
                              label,
                              icon: ActionIcon,
                              ...rest,
                            })
                          }
                          type="button"
                        >
                          {running ? (
                            <Loader2
                              aria-hidden="true"
                              className="h-3.5 w-3.5 animate-spin"
                              strokeWidth={1.8}
                            />
                          ) : (
                            <ActionIcon
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                              strokeWidth={1.8}
                            />
                          )}
                          {label}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.78fr)]">
                <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="kaypal-v3-label">来源记录</p>
                  {selectedSignal.evidence.length ? (
                    <ol className="mt-3 grid gap-3">
                      {selectedSignal.evidence
                        .slice(0, 6)
                        .map((item, index) => (
                          <li className="flex gap-3" key={`${item}-${index}`}>
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--kaypal-v3-accent)] text-11 font-bold text-white">
                              {index + 1}
                            </span>
                            <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                              {item}
                            </p>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="mt-3 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      暂无证据文本；可回到搜索或监控补充来源。
                    </p>
                  )}
                </div>

                <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="kaypal-v3-label">执行任务</p>
                  <div className="mt-3 grid gap-2">
                    {queue.length ? (
                      queue.map((item) => (
                        <Link
                          className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]"
                          href={item.href}
                          key={item.id}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-12 font-bold text-[var(--kaypal-v3-ink)]">
                              {item.label}
                            </span>
                            <span
                              className={[
                                "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                                item.state === "failed"
                                  ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]"
                                  : item.state === "running"
                                    ? "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]"
                                    : "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
                              ].join(" ")}
                            >
                              {item.state === "running"
                                ? "执行中"
                                : item.state === "failed"
                                  ? "失败"
                                  : "完成"}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                            {item.detail}
                          </p>
                        </Link>
                      ))
                    ) : (
                      <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] p-3">
                        <Inbox
                          aria-hidden="true"
                          className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                          strokeWidth={1.8}
                        />
                        <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          选择动作后会显示写入结果。
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center p-4">
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/search", label: "一键找线索" },
                  { href: "/intelligence/monitors", label: "自动跟踪" },
                ]}
                description="从搜索、热点或监控同步真实情报后，这里会按行业聚合，并展示证据、边界和可执行动作。"
                examples={["行业聚合", "证据", "边界", "可执行动作"]}
                icon={FileText}
                surface="plain"
                title="当前没有可判断行业信号"
              />
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
