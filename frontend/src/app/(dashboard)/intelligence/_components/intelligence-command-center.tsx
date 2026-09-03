"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Database,
  FileText,
  Gauge,
  GitBranch,
  Inbox,
  Layers3,
  LineChart,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Target,
  UserRoundSearch,
  type LucideIcon,
} from "@/components/iconpark";
import {
  intelligenceApi,
  type IntelligenceItem as ApiIntelligenceItem,
  type IntelligenceMonitorSummary,
} from "@/lib/api/intelligence";
import { redfoxApi, type RedfoxSkill } from "@/lib/api/redfox";
import { publicIntelligenceList, publicIntelligenceText } from "./display-text";
import { publicSourceLabelForItem } from "./redfox-public-labels";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

type RiskLevel = "low" | "medium" | "high";
type IntelligenceStatus =
  "new" | "review" | "dispatched" | "compliance" | "monitor_issue";

type DispatchAction = {
  label: string;
  target: string;
  href: string;
  reason: string;
  risk: RiskLevel;
  icon: LucideIcon;
};

type IntelligenceItem = {
  id: string;
  title: string;
  platform: string;
  sourceSkill: string;
  redfoxSkillId?: string;
  redfoxSkillCode?: string;
  skillKeyword: string;
  status: IntelligenceStatus;
  risk: RiskLevel;
  owner: string;
  collectedAt: string;
  intent: string;
  quality: number;
  relevance: number;
  riskScore: number;
  decision: string;
  boundary: string;
  evidence: string[];
  actions: DispatchAction[];
};

type QueueItem = {
  id: string;
  itemId: string;
  title: string;
  label: string;
  target: string;
  href: string;
  risk: RiskLevel;
  state: "queued" | "running" | "done" | "failed";
  detail: string;
};

type MonitorHealth = {
  name: string;
  status: "running" | "attention" | "paused";
  lastRun: string;
  owner: string;
  nextStep: string;
};

const statusMeta: Record<
  IntelligenceStatus,
  { label: string; className: string; icon: LucideIcon }
> = {
  new: {
    label: "新发现",
    icon: Sparkles,
    className:
      "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
  },
  review: {
    label: "待判断",
    icon: Search,
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  dispatched: {
    label: "已派发",
    icon: CheckCircle2,
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  compliance: {
    label: "需复核",
    icon: ShieldAlert,
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  monitor_issue: {
    label: "监控异常",
    icon: AlertTriangle,
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
};

const riskMeta: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "低风险",
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

const reportCenter = [
  {
    title: "今日情报简报",
    input: "已判断情报 + 高风险预警",
    owner: "运营负责人",
    href: "/intelligence/reports",
  },
  {
    title: "竞品账号周报",
    input: "对标账号 + 评论线索",
    owner: "增长负责人",
    href: "/intelligence/accounts",
  },
  {
    title: "选题机会报告",
    input: "热点雷达 + 一键找线索",
    owner: "内容策划",
    href: "/topics",
  },
  {
    title: "风险摘要",
    input: "需复核对象 + 拦截规则",
    owner: "复核负责人",
    href: "/intelligence/risks",
  },
];

const routingMatrix = [
  ["热点", "业务相关、时效明确", "选题库 / 报告中心", "敏感话题先审核"],
  ["作品", "标题清晰、互动真实", "素材库 / 爆款拆解", "不搬运原文"],
  ["账号", "定位相近、更新稳定", "对标账号 / 增长策略", "不自动触达"],
  ["评论", "问题集中、可转话术", "线索洞察 / 回复规则", "人工确认触达"],
];

function riskClass(risk: RiskLevel) {
  return riskMeta[risk].className;
}

function scoreBarClass(score: number, risk?: boolean) {
  if (risk) {
    if (score >= 70) return "bg-[var(--kaypal-v3-danger)]";
    if (score >= 40) return "bg-[var(--kaypal-v3-amber)]";
    return "bg-[var(--kaypal-v3-success)]";
  }

  if (score >= 85) return "bg-[var(--kaypal-v3-success)]";
  if (score >= 70) return "bg-[var(--kaypal-v3-accent)]";
  return "bg-[var(--kaypal-v3-amber)]";
}

function monitorStatusClass(status: MonitorHealth["status"]) {
  if (status === "running") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  if (status === "attention") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }

  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-muted)]";
}

function monitorStatusLabel(status: MonitorHealth["status"]) {
  if (status === "running") return "运行中";
  if (status === "attention") return "需处理";
  return "暂停";
}

function scoreRows(item: IntelligenceItem) {
  return [
    { label: "质量分", value: item.quality, risk: false },
    { label: "相关性", value: item.relevance, risk: false },
    { label: "风险分", value: item.riskScore, risk: true },
  ];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function readNumber(
  record: Record<string, unknown>,
  keys: string[],
  fallback: number,
) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(100, Math.round(value)));
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
    }
  }
  return fallback;
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
    }
  }
  return [];
}

function normalizeRisk(
  status: string,
  raw: Record<string, unknown>,
  metrics: Record<string, unknown>,
): RiskLevel {
  const riskText = readString(raw, [
    "risk",
    "riskLevel",
    "risk_level",
  ]).toLowerCase();
  if (riskText.includes("high") || riskText.includes("高")) return "high";
  if (riskText.includes("medium") || riskText.includes("中")) return "medium";
  if (riskText.includes("low") || riskText.includes("低")) return "low";

  const riskScore = readNumber(metrics, ["riskScore", "risk_score"], -1);
  if (riskScore >= 70) return "high";
  if (riskScore >= 40) return "medium";
  if (status.includes("risk") || status.includes("compliance")) return "high";
  return "low";
}

function normalizeStatus(status: string, risk: RiskLevel): IntelligenceStatus {
  if (status === "imported_material" || status === "generated_topic") {
    return "dispatched";
  }
  if (status.includes("monitor")) return "monitor_issue";
  if (
    status.includes("compliance") ||
    status.includes("blocked") ||
    risk === "high"
  ) {
    return "compliance";
  }
  if (status.includes("review") || status.includes("pending")) return "review";
  return status === "new" ? "new" : "review";
}

function formatCollectedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function typeIntent(type: string) {
  if (type.includes("trend")) return "热点趋势判断";
  if (type.includes("search")) return "一键找线索样本";
  if (type.includes("viral")) return "爆款结构拆解";
  if (type.includes("account")) return "对标账号观察";
  if (type.includes("comment")) return "评论线索洞察";
  if (type.includes("industry")) return "行业信息源";
  return "业务情报判断";
}

function sourceLabelForItem(item: ApiIntelligenceItem) {
  return publicSourceLabelForItem(item);
}

function actionsForApiItem(item: ApiIntelligenceItem, risk: RiskLevel) {
  if (risk === "high") {
    return [
      {
        label: "风险审核",
        target: "风险审核",
        href: "/intelligence/risks",
        reason: "高风险对象不能直接进入业务流程。",
        risk: "high" as const,
        icon: ShieldAlert,
      },
      {
        label: "沉淀规则",
        target: "情报规则",
        href: "/intelligence/rules",
        reason: "把命中原因写入后续拦截规则。",
        risk: "medium" as const,
        icon: ClipboardCheck,
      },
      {
        label: "爆款拆解",
        target: "爆款拆解",
        href: "/intelligence/viral",
        reason: "只拆结构和节奏，不复用原素材。",
        risk: "medium" as const,
        icon: Gauge,
      },
    ];
  }

  const accountAction =
    item.type.includes("account") || item.type.includes("author")
      ? [
          {
            label: "进入对标",
            target: "对标账号",
            href: "/intelligence/accounts",
            reason: "账号信息可进入观察池，继续看定位和栏目节奏。",
            risk: "low" as const,
            icon: UserRoundSearch,
          },
        ]
      : [];
  const leadAction =
    item.type.includes("comment") || item.type.includes("lead")
      ? [
          {
            label: "线索洞察",
            target: "线索洞察",
            href: "/intelligence/leads",
            reason: "评论和意向词只进入人工判断，不自动触达。",
            risk: "medium" as const,
            icon: Target,
          },
        ]
      : [];

  return [
    {
      label: "生成选题",
      target: "选题库",
      href: "/topics",
      reason: "将情报摘要转成可执行选题草稿。",
      risk: "low" as const,
      icon: Sparkles,
    },
    {
      label: "导入素材",
      target: "素材库",
      href: "/content",
      reason: "保留来源、作者、链接和采集记录。",
      risk: risk === "medium" ? ("medium" as const) : ("low" as const),
      icon: Database,
    },
    ...accountAction,
    ...leadAction,
    {
      label: "加入监控",
      target: "监控",
      href: "/intelligence/monitors",
      reason: "持续跟踪同类关键词、账号或行业源。",
      risk: "low" as const,
      icon: BellRing,
    },
  ].slice(0, 3);
}

function mapApiItem(item: ApiIntelligenceItem): IntelligenceItem {
  const raw = asRecord(item.raw);
  const metrics = asRecord(item.metrics);
  const risk = normalizeRisk(item.status, raw, metrics);
  const status = normalizeStatus(item.status, risk);
  const riskScore = readNumber(
    metrics,
    ["riskScore", "risk_score", "risk"],
    risk === "high" ? 84 : risk === "medium" ? 52 : 18,
  );
  const evidence = readStringArray(raw, ["evidence", "evidences", "proofs"]);
  const fallbackEvidence = [
    item.sourceUrl ? `来源链接：${item.sourceUrl}` : "",
    item.sourceExternalId ? `来源记录：${item.sourceExternalId}` : "",
    item.redfoxSkill?.name ? `系统来源：${sourceLabelForItem(item)}` : "",
  ].filter(Boolean);

  return {
    id: item.id,
    title: publicIntelligenceText(item.title, "系统情报"),
    platform: item.platform,
    sourceSkill: sourceLabelForItem(item),
    redfoxSkillId: item.redfoxSkill?.id,
    redfoxSkillCode: item.redfoxSkill?.code,
    skillKeyword: item.keywords[0] || item.platform,
    status,
    risk,
    owner: risk === "high" ? "复核负责人" : "运营负责人",
    collectedAt: formatCollectedAt(item.createdAt),
    intent: readString(raw, ["intent", "queryIntent"]) || typeIntent(item.type),
    quality: readNumber(
      metrics,
      ["quality", "qualityScore", "quality_score"],
      76,
    ),
    relevance: readNumber(
      metrics,
      ["relevance", "relevanceScore", "relevance_score"],
      78,
    ),
    riskScore,
    decision: publicIntelligenceText(
      readString(raw, ["decision", "recommendation"]) ||
        item.summary ||
        "进入待处理发现，由负责人判断去向。",
    ),
    boundary: publicIntelligenceText(
      readString(raw, ["boundary", "riskBoundary"]) ||
        (risk === "high"
          ? "高风险对象只能进入风险审核、规则沉淀或结构观察。"
          : "保留来源和记录，不自动触达，不直接复用第三方原文素材。"),
    ),
    evidence:
      evidence.length > 0
        ? publicIntelligenceList(evidence)
        : fallbackEvidence.length > 0
          ? publicIntelligenceList(fallbackEvidence)
          : ["系统已保留来源记录，可在详情页追溯。"],
    actions: actionsForApiItem(item, risk),
  };
}

function mapApiMonitor(monitor: IntelligenceMonitorSummary): MonitorHealth {
  const status: MonitorHealth["status"] =
    monitor.status === "paused"
      ? "paused"
      : monitor.lastError || monitor.status === "error"
        ? "attention"
        : "running";
  const name =
    monitor.keyword ||
    monitor.industry ||
    monitor.accountExternalId ||
    `${monitor.platform || "全平台"} ${monitor.type}`;

  return {
    name: publicIntelligenceText(name, "自动跟踪"),
    status,
    lastRun: monitor.lastRunAt
      ? formatCollectedAt(monitor.lastRunAt)
      : "未运行",
    owner: "运营负责人",
    nextStep: publicIntelligenceText(
      monitor.lastError ||
        (monitor.nextRunAt
          ? `下次运行 ${formatCollectedAt(monitor.nextRunAt)}`
          : "等待调度"),
    ),
  };
}

function primaryPlatform(value: string) {
  const first = value.split(/[\/、,，]/)[0]?.trim();
  return first || undefined;
}

function actionStateLabel(state: QueueItem["state"]) {
  if (state === "running") return "执行中";
  if (state === "done") return "已完成";
  if (state === "failed") return "失败";
  return "待处理";
}

function dispatchActionKey(action: DispatchAction) {
  const text = `${action.label} ${action.target} ${action.href}`.toLowerCase();
  if (text.includes("规则") || text.includes("rule")) return "rules";
  if (text.includes("风险") || text.includes("风险复核") || text.includes("risk")) {
    return "risk_review";
  }
  if (
    text.includes("对标") ||
    text.includes("账号") ||
    text.includes("account")
  ) {
    return "benchmark_account";
  }
  if (text.includes("线索") || text.includes("评论") || text.includes("lead")) {
    return "comment_insight";
  }
  return "manual_queue";
}

function SkillRecommendations({ keyword }: { keyword: string }) {
  const [skillState, setSkillState] = useState<{
    keyword: string;
    items: RedfoxSkill[];
    error: string;
  }>({
    keyword: "",
    items: [],
    error: "",
  });

  useEffect(() => {
    let active = true;

    redfoxApi
      .listSkills({ page: 1, limit: 4, keyword })
      .then((result) => {
        if (!active) return;
        setSkillState({
          keyword,
          items: result.items,
          error: "",
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSkillState({
          keyword,
          items: [],
          error: publicIntelligenceText(
            toActionableError(reason, "能力建议读取失败"),
          ),
        });
      });

    return () => {
      active = false;
    };
  }, [keyword]);

  const loading = skillState.keyword !== keyword;
  const skills = skillState.items;
  const error = skillState.error;

  return (
    <section className="kaypal-v3-panel overflow-hidden">
      <div className="border-b border-[var(--kaypal-v3-border)] p-4">
        <p className="kaypal-v3-label">下一步建议</p>
        <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
          系统还能继续做什么
        </h2>
      </div>
      <div className="divide-y divide-[var(--kaypal-v3-border)]">
        {loading ? (
          <div className="p-4 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
            正在读取可用建议
          </div>
        ) : error ? (
          <div className="p-4 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
            {error}
          </div>
        ) : skills.length > 0 ? (
          skills.map((skill) => (
            <div className="p-4" key={skill.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-13 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                    {publicIntelligenceText(skill.name, "系统功能")}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {publicIntelligenceText(
                      skill.summary,
                      "可继续用于查找、跟踪或拆解。",
                    )}
                  </p>
                </div>
                <span className="shrink-0 rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-1 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                  {publicIntelligenceText(skill.platform, "平台")}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="p-4 text-12 font-semibold text-[var(--kaypal-v3-muted)]">
            当前关键词没有匹配到可用建议，可以先换个关键词或刷新功能。
          </div>
        )}
      </div>
    </section>
  );
}

export function IntelligenceCommandCenter() {
  const [overviewState, setOverviewState] = useState<{
    items: IntelligenceItem[];
    monitors: MonitorHealth[];
    loading: boolean;
    error: string;
  }>({
    items: [],
    monitors: [],
    loading: true,
    error: "",
  });
  const [selectedId, setSelectedId] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [overviewRefreshKey, setOverviewRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    intelligenceApi
      .overview({ limit: 8 })
      .then((overview) => {
        if (!active) return;
        setOverviewState({
          items: overview.recentItems.map(mapApiItem),
          monitors: overview.monitors.map(mapApiMonitor),
          loading: false,
          error: "",
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setOverviewState({
          items: [],
          monitors: [],
          loading: false,
          error: publicIntelligenceText(
            toActionableError(reason, "情报总控台读取失败"),
          ),
        });
      });

    return () => {
      active = false;
    };
  }, [overviewRefreshKey]);

  const activeItems = overviewState.items;
  const activeMonitorHealth = overviewState.monitors;

  const selectedItem = useMemo(
    () =>
      activeItems.find((item) => item.id === selectedId) ||
      activeItems[0] ||
      null,
    [activeItems, selectedId],
  );

  const metrics = useMemo(
    () => [
      {
        label: "待判断情报",
        value: activeItems.filter(
          (item) => item.status === "review" || item.status === "new",
        ).length,
        detail: "需要运营今天完成判断",
        icon: Inbox,
        className:
          "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]",
      },
      {
        label: "高风险预警",
        value: activeItems.filter((item) => item.risk === "high").length,
        detail: "进入风险复核或拦截规则",
        icon: ShieldAlert,
        className:
          "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]",
      },
      {
        label: "可派发样本",
        value: activeItems.filter((item) => item.risk !== "high").length,
        detail: "可转素材、选题、监控",
        icon: GitBranch,
        className:
          "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]",
      },
      {
        label: "监控异常",
        value: activeMonitorHealth.filter((item) => item.status === "attention")
          .length,
        detail: "影响日报和趋势判断",
        icon: AlertTriangle,
        className:
          "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]",
      },
      {
        label: "分发任务",
        value: queue.length,
        detail: "页面内即时反馈",
        icon: ClipboardList,
        className:
          "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]",
      },
    ],
    [activeItems, activeMonitorHealth, queue.length],
  );

  function queueState(action: DispatchAction) {
    if (!selectedItem) return null;
    return (
      queue.find(
        (item) =>
          item.id === `${selectedItem.id}:${action.label}:${action.target}`,
      ) || null
    );
  }

  function isQueued(action: DispatchAction) {
    const matched = queueState(action);
    return Boolean(matched && matched.state !== "failed");
  }

  function updateQueueItem(id: string, patch: Partial<QueueItem>) {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function dispatchAction(action: DispatchAction) {
    if (!selectedItem) return;

    const id = `${selectedItem.id}:${action.label}:${action.target}`;
    const existing = queue.find((item) => item.id === id);
    if (existing && existing.state !== "failed") return;

    const initial: QueueItem = {
      id,
      itemId: selectedItem.id,
      title: selectedItem.title,
      label: action.label,
      target: action.target,
      href: action.href,
      risk: action.risk,
      state: "running",
      detail: "正在写入业务模块",
    };

    setQueue((current) =>
      [initial, ...current.filter((item) => item.id !== id)].slice(0, 6),
    );

    try {
      if (action.label === "生成选题") {
        await intelligenceApi.generateTopic(selectedItem.id, {
          title: selectedItem.title,
          description: selectedItem.decision,
          summary: selectedItem.boundary,
          sourceType: "数据情报",
          keywords: selectedItem.skillKeyword
            ? [selectedItem.skillKeyword]
            : [],
          searchQueries: selectedItem.skillKeyword
            ? [selectedItem.skillKeyword]
            : [],
        });
        updateQueueItem(id, {
          state: "done",
          detail: "已生成选题草稿，情报状态已回写。",
          href: "/topics",
        });
        setOverviewRefreshKey((value) => value + 1);
        return;
      }

      if (action.label === "导入素材") {
        await intelligenceApi.importMaterial(selectedItem.id, {
          title: selectedItem.title,
          summary: selectedItem.decision,
          platform: selectedItem.platform,
          keywords: selectedItem.skillKeyword
            ? [selectedItem.skillKeyword]
            : [],
        });
        updateQueueItem(id, {
          state: "done",
          detail: "已导入素材库，来源记录和风险边界已保留。",
          href: "/content",
        });
        setOverviewRefreshKey((value) => value + 1);
        return;
      }

      if (action.label === "加入监控") {
        const skillInstallId =
          selectedItem.redfoxSkillCode || selectedItem.redfoxSkillId;
        if (!skillInstallId) {
          updateQueueItem(id, {
            state: "queued",
            detail: "当前情报还不能直接自动跟踪，请在自动跟踪页手动选择对象。",
            href: "/intelligence/monitors",
          });
          return;
        }

        await intelligenceApi.createMonitor({
          type: "keyword",
          schedule: "0 */6 * * *",
          platform: primaryPlatform(selectedItem.platform),
          keyword: selectedItem.skillKeyword || selectedItem.title.slice(0, 24),
          skillInstallId,
          status: "active",
          costLimitPoints: 300,
          config: {
            source: "intelligence-command-center",
            intelligenceItemId: selectedItem.id,
            sourceTitle: selectedItem.title,
            guardrails: ["保留来源", "高风险先审核", "不自动触达"],
          },
        });
        updateQueueItem(id, {
          state: "done",
          detail: "已创建 6 小时频率的关键词监控。",
          href: "/intelligence/monitors",
        });
        setOverviewRefreshKey((value) => value + 1);
        return;
      }

      const result = await intelligenceApi.dispatchItem(selectedItem.id, {
        action: dispatchActionKey(action),
        label: action.label,
        target: action.target,
        href: action.href,
        risk: action.risk,
        reason: action.reason,
      });
      updateQueueItem(id, {
        state: result.status === "queued" ? "queued" : "done",
        detail: publicIntelligenceText(result.message),
        href: result.href || action.href,
      });
      setOverviewRefreshKey((value) => value + 1);
    } catch (reason) {
      updateQueueItem(id, {
        state: "failed",
        detail: publicIntelligenceText(
          toActionableError(reason, "派发失败"),
        ),
      });
    }
  }

  function retryOverview() {
    setOverviewState((current) => ({ ...current, loading: true, error: "" }));
    setOverviewRefreshKey((value) => value + 1);
  }

  function actionButtonLabel(action: DispatchAction) {
    const matched = queueState(action);
    if (!matched) return action.label;
    if (matched.state === "running") return "正在执行";
    if (matched.state === "done") return "已完成";
    if (matched.state === "queued") return "已加入队列";
    return "重试";
  }

  const SelectedStatusIcon = selectedItem
    ? statusMeta[selectedItem.status].icon
    : Inbox;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <p className="kaypal-v3-label">商业情报</p>
              <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                今日情报工作台
              </h1>
              <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                用户进来先处理情报对象：看证据、判风险、选去向，再派发到素材、选题、对标、监控、风险复核和报告。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <Link
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                href="/intelligence/search"
              >
                <Search
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                跑搜索
              </Link>
              <Link
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href="/capabilities/models"
              >
                <Sparkles
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                AI 能力
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map(({ label, value, detail, icon: Icon, className }) => (
              <div
                className={[
                  "min-h-[92px] rounded-[8px] border p-3",
                  className,
                ].join(" ")}
                key={label}
              >
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
          </div>

        </div>
      </section>

      <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(300px,0.86fr)_minmax(0,1.42fr)_minmax(320px,0.82fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="min-w-0">
              <p className="kaypal-v3-label">待处理发现</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                今日待处理对象
              </h2>
            </div>
            <Inbox
              aria-hidden="true"
              className="h-5 w-5 shrink-0 text-[var(--kaypal-v3-muted)]"
              strokeWidth={1.8}
            />
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {overviewState.loading ? (
              <div className="flex min-h-[260px] items-center justify-center p-4 text-13 font-semibold text-[var(--kaypal-v3-muted)]">
                <SkeletonList rows={3} />
              </div>
            ) : overviewState.error ? (
              <div className="p-4">
                <div className="rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] p-4">
                  <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    情报读取失败
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {overviewState.error}
                  </p>
                  <button
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                    onClick={retryOverview}
                    type="button"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    重新读取
                  </button>
                </div>
              </div>
            ) : activeItems.length === 0 ? (
              <div className="p-4">
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    今日还没有入库情报
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    先跑一次搜索，或执行到期跟踪，把结果写入待处理发现
                    后再判断和派发。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                      href="/intelligence/search"
                    >
                      <Search
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                      跑搜索
                    </Link>
                    <Link
                      className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                      href="/intelligence/monitors"
                    >
                      <BellRing
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        strokeWidth={1.8}
                      />
                      配置监控
                    </Link>
                  </div>
                </div>
              </div>
            ) : (
              activeItems.map((item) => {
                const StatusIcon = statusMeta[item.status].icon;
                const isSelected = item.id === selectedItem?.id;

                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                      isSelected
                        ? "bg-[var(--kaypal-v3-accent-soft)]"
                        : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                    ].join(" ")}
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              statusMeta[item.status].className,
                            ].join(" ")}
                          >
                            <StatusIcon
                              aria-hidden="true"
                              className="h-3 w-3"
                              strokeWidth={1.8}
                            />
                            {statusMeta[item.status].label}
                          </span>
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              riskClass(item.risk),
                            ].join(" ")}
                          >
                            {riskMeta[item.risk].label}
                          </span>
                        </div>
                        <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                          {item.title}
                        </h3>
                      </div>
                      <ChevronRight
                        aria-hidden="true"
                        className={[
                          "mt-7 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)] transition-transform",
                          isSelected ? "translate-x-0.5" : "",
                        ].join(" ")}
                        strokeWidth={1.8}
                      />
                    </div>
                    <div className="mt-3 grid gap-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      <p>
                        平台：
                        <span className="font-semibold">{item.platform}</span>
                      </p>
                      <p>
                        来源：
                        <span className="font-semibold">
                          {item.sourceSkill}
                        </span>
                      </p>
                      <p>
                        负责人：{item.owner} · {item.collectedAt}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          {selectedItem ? (
            <>
              <div className="border-b border-[var(--kaypal-v3-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="kaypal-v3-label">证据与判断</p>
                    <h2 className="mt-1 text-lg font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                      {selectedItem.title}
                    </h2>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {selectedItem.platform} · {selectedItem.sourceSkill} ·{" "}
                      {selectedItem.intent}
                    </p>
                  </div>
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-11 font-semibold",
                      statusMeta[selectedItem.status].className,
                    ].join(" ")}
                  >
                    <SelectedStatusIcon
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    {statusMeta[selectedItem.status].label}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.88fr)_minmax(280px,0.62fr)]">
                <div className="min-w-0">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {scoreRows(selectedItem).map((row) => (
                      <div
                        className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                        key={row.label}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                            {row.label}
                          </p>
                          <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                            {row.value}
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
                          <div
                            className={[
                              "h-full rounded-full",
                              scoreBarClass(row.value, row.risk),
                            ].join(" ")}
                            style={{ width: `${row.value}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                    <p className="kaypal-v3-label">推荐决策</p>
                    <p className="mt-2 text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                      {selectedItem.decision}
                    </p>
                    <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3">
                      <ShieldAlert
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-amber)]"
                        strokeWidth={1.8}
                      />
                      <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                        {selectedItem.boundary}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="min-w-0 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="kaypal-v3-label">证据列表</p>
                    <Archive
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                      strokeWidth={1.8}
                    />
                  </div>
                  <ol className="mt-3 grid gap-3">
                    {selectedItem.evidence.map((item, index) => (
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
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center p-4">
              <div className="max-w-md rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-5 text-center">
                <Inbox
                  aria-hidden="true"
                  className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]"
                  strokeWidth={1.8}
                />
                <p className="mt-3 text-14 font-bold text-[var(--kaypal-v3-ink)]">
                  等待情报对象进入待处理发现
                </p>
                <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  搜索或自动跟踪跑完后，这里会展示证据、评分、风险边界和推荐动作。
                </p>
              </div>
            </div>
          )}
        </article>

        <aside className="grid min-w-0 gap-4">
          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">下一步动作</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                派发到业务模块
              </h2>
            </div>
            <div className="grid gap-2 p-4">
              {selectedItem ? (
                selectedItem.actions.map((action) => {
                  const Icon = action.icon;
                  const queuedItem = queueState(action);
                  const queued = isQueued(action);
                  const running = queuedItem?.state === "running";

                  return (
                    <button
                      className={[
                        "rounded-[8px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-60",
                        queued
                          ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)] hover:bg-[var(--kaypal-v3-paper)]",
                      ].join(" ")}
                      disabled={queued}
                      key={`${selectedItem.id}-${action.label}`}
                      onClick={() => void dispatchAction(action)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
                            {running ? (
                              <Loader2
                                aria-hidden="true"
                                className="h-4 w-4 animate-spin text-[var(--kaypal-v3-accent)]"
                                strokeWidth={1.8}
                              />
                            ) : (
                              <Icon
                                aria-hidden="true"
                                className="h-4 w-4 text-[var(--kaypal-v3-accent)]"
                                strokeWidth={1.8}
                              />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                              {actionButtonLabel(action)}
                            </p>
                            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                              {queuedItem?.detail || action.reason}
                            </p>
                          </div>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                            riskClass(action.risk),
                          ].join(" ")}
                        >
                          {action.target}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  先让情报对象进入
                  待处理发现，再选择生成选题、导入素材、加入监控或进入风险复核处理。
                </div>
              )}
            </div>
          </section>

          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">分发任务</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                准备执行的动作
              </h2>
            </div>
            {queue.length > 0 ? (
              <div className="divide-y divide-[var(--kaypal-v3-border)]">
                {queue.map((item) => (
                  <Link
                    className="block p-4 transition-colors hover:bg-[var(--kaypal-v3-paper-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]"
                    href={item.href}
                    key={item.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                            {item.label} · {item.target}
                          </p>
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              item.state === "failed"
                                ? "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]"
                                : item.state === "done"
                                  ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]"
                                  : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-muted)]",
                            ].join(" ")}
                          >
                            {actionStateLabel(item.state)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                          {item.detail}
                        </p>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                        strokeWidth={1.8}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-start gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                  <GitBranch
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                  <p className="text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    先在“下一步动作”里选择去向，系统会把当前情报加入分发任务。
                  </p>
                </div>
              </div>
            )}
          </section>
        </aside>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,0.75fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">监控健康</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              情报源运行状态
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {activeMonitorHealth.length > 0 ? (
              activeMonitorHealth.map((monitor, index) => (
                <div
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"
                  key={`${monitor.name}-${monitor.status}-${monitor.lastRun}-${index}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {monitor.name}
                      </h3>
                      <span
                        className={[
                          "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                          monitorStatusClass(monitor.status),
                        ].join(" ")}
                      >
                        {monitorStatusLabel(monitor.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      {monitor.nextStep}
                    </p>
                  </div>
                  <p className="text-12 font-semibold leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {monitor.owner}
                    <br />
                    <span className="text-[var(--kaypal-v3-muted)]">
                      {monitor.lastRun}
                    </span>
                  </p>
                </div>
              ))
            ) : (
              <div className="p-4">
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    还没有运行中的情报源
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    去自动跟踪页绑定关键词、账号或行业来源，运行后这里会显示最近运行和异常原因。
                  </p>
                  <Link
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                    href="/intelligence/monitors"
                  >
                    <BellRing
                      aria-hidden="true"
                      className="h-3.5 w-3.5"
                      strokeWidth={1.8}
                    />
                    打开监控
                  </Link>
                </div>
              </div>
            )}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">报告中心</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              可交付情报报告
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {reportCenter.map((report) => (
              <Link
                className="block p-4 text-[var(--kaypal-v3-soft-ink)] transition-colors hover:bg-[var(--kaypal-v3-paper-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]"
                href={report.href}
                key={report.title}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {report.title}
                    </h3>
                    <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      输入：{report.input}
                    </p>
                    <p className="mt-1 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                      负责人：{report.owner}
                    </p>
                  </div>
                  <FileText
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                </div>
              </Link>
            ))}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">治理规则</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              派发边界
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {routingMatrix.map(([source, rule, target, boundary], index) => (
              <div className="p-4" key={`${source}-${target}-${index}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    {source}
                  </h3>
                  <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                    {target}
                  </span>
                </div>
                <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  判断：{rule}
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  边界：{boundary}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.58fr)]">
        {selectedItem ? (
          <SkillRecommendations keyword={selectedItem.skillKeyword} />
        ) : (
          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">下一步建议</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                系统还能继续做什么
              </h2>
            </div>
            <div className="p-4 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
              选中情报对象后，会按关键词和平台推荐可继续执行的动作。
            </div>
          </section>
        )}

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">商用流程</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              从信号到交付
            </h2>
          </div>
          <div className="grid gap-3 p-4">
            {[
              {
                icon: Radio,
                label: "发现",
                detail: "搜索、热点和自动跟踪产生情报对象",
              },
              {
                icon: Activity,
                label: "判断",
                detail: "证据、评分、风险和负责人同屏确认",
              },
              {
                icon: Layers3,
                label: "沉淀",
                detail: "进入素材、选题、账号、规则和报告",
              },
              {
                icon: CircleDollarSign,
                label: "治理",
                detail: "用量、失败、权限和风险复核全程留痕",
              },
              {
                icon: LineChart,
                label: "复盘",
                detail: "日报、周报和竞品报告回到经营视角",
              },
            ].map(({ icon: Icon, label, detail }, index) => (
              <div
                className="flex items-start gap-3 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
                key={`${label}-${index}`}
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 text-[var(--kaypal-v3-accent)]"
                    strokeWidth={1.8}
                  />
                </span>
                <div>
                  <h3 className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    {label}
                  </h3>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    {detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
