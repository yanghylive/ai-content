"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileText,
  GitBranch,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Target,
  UserRoundSearch,
  type LucideIcon,
} from "@/components/iconpark";
import {
  intelligenceApi,
  type IntelligenceItem as ApiIntelligenceItem,
  type QueryIntelligenceItemsInput,
} from "@/lib/api/intelligence";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { publicIntelligenceList, publicIntelligenceText } from "./display-text";
import { publicSourceLabelForItem } from "./redfox-public-labels";
import { toActionableError } from "@/lib/public-error";

type RiskLevel = "low" | "medium" | "high";
type ActionKind = "import_material" | "generate_topic" | "link";

type InboxAction = {
  actionId: string;
  label: string;
  target: string;
  href: string;
  reason: string;
  risk: RiskLevel;
  icon: LucideIcon;
  kind: ActionKind;
};

type InboxItem = {
  id: string;
  title: string;
  platform: string;
  type: string;
  status: string;
  statusLabel: string;
  risk: RiskLevel;
  owner: string;
  source: string;
  collectedAt: string;
  score: number;
  decision: string;
  boundary: string;
  evidence: string[];
  apiItem: ApiIntelligenceItem;
  actions: InboxAction[];
};

type QueueItem = {
  id: string;
  title: string;
  label: string;
  target: string;
  href: string;
  risk: RiskLevel;
  state: "pending" | "running" | "done" | "failed";
  message: string;
};

type FilterState = {
  status: string;
  platform: string;
  type: string;
  keyword: string;
};

const statusFilters = [
  { label: "全部", value: "all" },
  { label: "新发现", value: "new" },
  { label: "已入素材", value: "imported_material" },
  { label: "已生成选题", value: "generated_topic" },
];

const platformFilters = [
  { label: "全平台", value: "all" },
  { label: "小红书", value: "小红书" },
  { label: "抖音", value: "抖音" },
  { label: "B站", value: "B站" },
  { label: "公众号", value: "公众号" },
];

const typeFilters = [
  { label: "全部类型", value: "all" },
  { label: "热点", value: "trend" },
  { label: "搜索", value: "search" },
  { label: "爆款", value: "viral" },
  { label: "账号", value: "account" },
  { label: "评论", value: "comment" },
  { label: "行业源", value: "industry" },
];

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

const statusMeta: Record<string, { label: string; className: string }> = {
  new: {
    label: "新发现",
    className:
      "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]",
  },
  imported_material: {
    label: "已入素材",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  generated_topic: {
    label: "已生成选题",
    className:
      "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  review: {
    label: "待判断",
    className:
      "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
  blocked: {
    label: "需处理",
    className:
      "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]",
  },
};

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

function normalizeRisk(item: ApiIntelligenceItem): RiskLevel {
  const raw = asRecord(item.raw);
  const metrics = asRecord(item.metrics);
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
  if (item.status.includes("blocked") || item.status.includes("compliance")) {
    return "high";
  }
  return "low";
}

function statusLabel(status: string) {
  return statusMeta[status]?.label || status || "待判断";
}

function statusClass(status: string) {
  return statusMeta[status]?.className || statusMeta.review.className;
}

function formatTime(value: string | null) {
  if (!value) return "未标注";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "未标注";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function typeLabel(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("trend") || normalized.includes("hot")) return "热点";
  if (normalized.includes("search")) return "搜索线索";
  if (normalized.includes("viral")) return "爆款";
  if (normalized.includes("account") || normalized.includes("author"))
    return "账号";
  if (normalized.includes("comment") || normalized.includes("lead"))
    return "线索";
  if (normalized.includes("industry")) return "行业源";
  if (normalized.includes("risk") || normalized.includes("compliance"))
    return "风险";
  if (normalized.includes("rule")) return "规则";
  return "情报";
}

function sourceLabelForItem(item: ApiIntelligenceItem) {
  return publicSourceLabelForItem(item);
}

function actionsFor(item: ApiIntelligenceItem, risk: RiskLevel): InboxAction[] {
  if (risk === "high") {
    return [
      {
        actionId: "risk-review",
        label: "送风险审核",
        target: "风险审核",
        href: "/intelligence/risks",
        reason: "高风险对象只能先确认边界，不能直接进入生产。",
        risk: "high",
        icon: ShieldAlert,
        kind: "link",
      },
      {
        actionId: "rules",
        label: "沉淀规则",
        target: "情报规则",
        href: "/intelligence/rules",
        reason: "把命中词、版权或触达风险写进规则库。",
        risk: "medium",
        icon: ClipboardCheck,
        kind: "link",
      },
    ];
  }

  const extraAction =
    item.type.includes("account") || item.type.includes("author")
      ? {
          actionId: "benchmark-account",
          label: "进入对标",
          target: "对标账号",
          href: "/intelligence/accounts",
          reason: "账号型情报进入观察池，跟踪栏目和互动结构。",
          risk: "low" as const,
          icon: UserRoundSearch,
          kind: "link" as const,
        }
      : item.type.includes("comment") || item.type.includes("lead")
        ? {
            actionId: "lead-insight",
            label: "线索洞察",
            target: "线索洞察",
            href: "/intelligence/leads",
            reason: "评论问题只做人工判断输入，不自动触达。",
            risk: "medium" as const,
            icon: Target,
            kind: "link" as const,
          }
        : {
            actionId: "monitor",
            label: "加入监控",
            target: "自动跟踪",
            href: "/intelligence/monitors",
            reason: "持续观察同类关键词、账号或行业源。",
            risk: "low" as const,
            icon: BellRing,
            kind: "link" as const,
          };

  return [
    {
      actionId: "import-material",
      label: "导入素材",
      target: "素材库",
      href: "/content",
      reason: "保留来源、作者、链接和采集记录，作为素材资产。",
      risk: risk === "medium" ? "medium" : "low",
      icon: Database,
      kind: "import_material",
    },
    {
      actionId: "generate-topic",
      label: "生成选题",
      target: "选题库",
      href: "/topics",
      reason: "把情报摘要转成可执行选题草稿。",
      risk: "low",
      icon: FileText,
      kind: "generate_topic",
    },
    extraAction,
  ];
}

function mapApiItem(item: ApiIntelligenceItem): InboxItem {
  const raw = asRecord(item.raw);
  const metrics = asRecord(item.metrics);
  const risk = normalizeRisk(item);
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
    type: item.type,
    status: item.status,
    statusLabel: statusLabel(item.status),
    risk,
    owner: risk === "high" ? "复核负责人" : "运营负责人",
    source: sourceLabelForItem(item),
    collectedAt: formatTime(item.createdAt),
    score: readNumber(metrics, ["quality", "qualityScore", "score"], 76),
    decision: publicIntelligenceText(
      readString(raw, ["decision", "recommendation"]) ||
        item.summary ||
        "进入待处理发现，由负责人确认去向。",
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
    apiItem: item,
    actions: actionsFor(item, risk),
  };
}

function scoreBarClass(score: number, risk: RiskLevel) {
  if (risk === "high") return "bg-[var(--kaypal-v3-danger)]";
  if (score >= 85) return "bg-[var(--kaypal-v3-success)]";
  if (score >= 70) return "bg-[var(--kaypal-v3-accent)]";
  return "bg-[var(--kaypal-v3-amber)]";
}

function buildQuery(filters: FilterState): QueryIntelligenceItemsInput {
  return {
    page: 1,
    limit: 20,
    status: filters.status === "all" ? undefined : filters.status,
    platform: filters.platform === "all" ? undefined : filters.platform,
    type: filters.type === "all" ? undefined : filters.type,
    keyword: filters.keyword.trim() || undefined,
    sortBy: "createdAt",
    sortOrder: "desc",
  };
}

export function IntelligenceInboxWorkbench() {
  const [filters, setFilters] = useState<FilterState>({
    status: "all",
    platform: "all",
    type: "all",
    keyword: "",
  });
  const [items, setItems] = useState<InboxItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    intelligenceApi
      .listItems(buildQuery(filters))
      .then((result) => {
        if (!active) return;
        const nextItems = result.items.map(mapApiItem);
        setItems(nextItems);
        setTotal(result.total);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setItems([]);
        setTotal(0);
        setError(toActionableError(reason, "情报库读取失败"));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filters, refreshKey]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  function reloadItems() {
    setLoading(true);
    setError("");
    setRefreshKey((value) => value + 1);
  }

  function updateFilters(nextFilters: Partial<FilterState>) {
    setLoading(true);
    setError("");
    setFilters((current) => ({ ...current, ...nextFilters }));
  }

  const metrics = useMemo(
    () => [
      {
        label: "情报总数",
        value: String(total),
        detail: "当前筛选条件下的入库对象",
        icon: Inbox,
      },
      {
        label: "待处理",
        value: String(items.filter((item) => item.status === "new").length),
        detail: "需要负责人给出去向",
        icon: Search,
      },
      {
        label: "已派发",
        value: String(
          items.filter((item) =>
            ["imported_material", "generated_topic"].includes(item.status),
          ).length,
        ),
        detail: "已进入素材或选题",
        icon: GitBranch,
      },
      {
        label: "高风险",
        value: String(items.filter((item) => item.risk === "high").length),
        detail: "只能进入审核和规则",
        icon: ShieldAlert,
      },
    ],
    [items, total],
  );

  function queueId(item: InboxItem, action: InboxAction) {
    return `${item.id}:${action.actionId}`;
  }

  function upsertQueue(entry: QueueItem) {
    setQueue((current) => {
      const index = current.findIndex((item) => item.id === entry.id);
      if (index >= 0) {
        return current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...entry } : item,
        );
      }
      return [entry, ...current].slice(0, 8);
    });
  }

  async function runAction(action: InboxAction) {
    if (!selectedItem) return;
    const id = queueId(selectedItem, action);
    const baseEntry: QueueItem = {
      id,
      title: selectedItem.title,
      label: action.label,
      target: action.target,
      href: action.href,
      risk: action.risk,
      state: action.kind === "link" ? "pending" : "running",
      message:
        action.kind === "link"
          ? "已加入分发任务，进入目标模块继续处理。"
          : "正在执行处理动作",
    };
    upsertQueue(baseEntry);

    if (action.kind === "link") return;

    try {
      if (action.kind === "import_material") {
        await intelligenceApi.importMaterial(selectedItem.id, {
          title: selectedItem.title,
        });
      } else if (action.kind === "generate_topic") {
        await intelligenceApi.generateTopic(selectedItem.id, {
          title: selectedItem.title,
          summary: selectedItem.decision,
          keywords: selectedItem.apiItem.keywords,
        });
      }

      upsertQueue({
        ...baseEntry,
        state: "done",
        message: "处理动作已完成，状态会随刷新同步。",
      });
      reloadItems();
    } catch (reason) {
      upsertQueue({
        ...baseEntry,
        state: "failed",
        message: publicIntelligenceText(
          toActionableError(reason, "处理动作失败"),
        ),
      });
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <p className="kaypal-v3-label">统一收件箱</p>
              <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                待处理发现
              </h1>
              <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                热点、搜索、账号、评论和行业来源先进入同一个情报库；用户在这里看证据、判风险、再派发到素材、选题、跟踪、线索或风险审核。
              </p>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
                onClick={reloadItems}
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
                className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-[10px] bg-[image:var(--kaypal-v3-gradient-primary)] px-5 text-[15px] font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href="/intelligence/search"
              >
                <Search
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
                一键找线索
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, detail, icon: Icon }) => (
              <div
                className="min-h-[88px] rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3"
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

      <section className="kaypal-v3-panel p-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(240px,0.9fr)]">
          <FilterGroup
            items={statusFilters}
            label="状态"
            value={filters.status}
            onChange={(value) => updateFilters({ status: value })}
          />
          <FilterGroup
            items={platformFilters}
            label="平台"
            value={filters.platform}
            onChange={(value) => updateFilters({ platform: value })}
          />
          <FilterGroup
            items={typeFilters}
            label="类型"
            value={filters.type}
            onChange={(value) => updateFilters({ type: value })}
          />
          <div className="min-w-0">
            <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
              关键词
            </p>
            <div className="mt-2 flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3">
              <Search
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
              <input
                className="min-w-0 flex-1 bg-transparent text-13 font-semibold text-[var(--kaypal-v3-ink)] outline-none placeholder:text-[var(--kaypal-v3-muted)]"
                onChange={(event) =>
                  updateFilters({
                    keyword: event.target.value,
                  })
                }
                placeholder="标题、作者、摘要"
                value={filters.keyword}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(300px,0.86fr)_minmax(0,1.42fr)_minmax(320px,0.82fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="min-w-0">
              <p className="kaypal-v3-label">情报列表</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                待处理对象
              </h2>
            </div>
            {loading ? (
              <Loader2
                aria-hidden="true"
                className="h-5 w-5 animate-spin text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
            ) : (
              <Inbox
                aria-hidden="true"
                className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
            )}
          </div>
          {error ? (
            <StatePanel
              icon={AlertTriangle}
              title="无法读取情报库"
              detail={error}
              actionLabel="重试"
              onAction={reloadItems}
            />
          ) : items.length === 0 ? (
            <StatePanel
              icon={Archive}
              title={loading ? "正在读取情报库" : "当前没有入库情报"}
              detail={
                loading
                  ? "正在读取待处理发现。"
                  : "可以先运行一键找线索，或执行到期自动跟踪。"
              }
              href="/intelligence/search"
              actionLabel={loading ? undefined : "一键找线索"}
            />
          ) : (
            <div className="divide-y divide-[var(--kaypal-v3-border)]">
              {items.map((item) => {
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={[
                          "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                          statusClass(item.status),
                        ].join(" ")}
                      >
                        {item.statusLabel}
                      </span>
                      <span
                        className={[
                          "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                          riskMeta[item.risk].className,
                        ].join(" ")}
                      >
                        {riskMeta[item.risk].label}
                      </span>
                      <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                        {typeLabel(item.type)}
                      </span>
                    </div>
                    <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                      {item.title}
                    </h3>
                    <div className="mt-3 grid gap-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                      <p>
                        平台：
                        <span className="font-semibold">{item.platform}</span>
                      </p>
                      <p>
                        来源：
                        <span className="font-semibold">{item.source}</span>
                      </p>
                      <p>
                        负责人：{item.owner} · {item.collectedAt}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
                      {selectedItem.platform} · {selectedItem.source} ·{" "}
                      {typeLabel(selectedItem.type)}
                    </p>
                  </div>
                  <span
                    className={[
                      "rounded-[6px] border px-2.5 py-1 text-11 font-semibold",
                      riskMeta[selectedItem.risk].className,
                    ].join(" ")}
                  >
                    {riskMeta[selectedItem.risk].label}
                  </span>
                </div>
              </div>
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(280px,0.6fr)]">
                <div className="min-w-0">
                  <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-11 font-bold text-[var(--kaypal-v3-muted)]">
                        情报质量
                      </p>
                      <span className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {selectedItem.score}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--kaypal-v3-border)]">
                      <div
                        className={[
                          "h-full rounded-full",
                          scoreBarClass(selectedItem.score, selectedItem.risk),
                        ].join(" ")}
                        style={{ width: `${selectedItem.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                    <p className="kaypal-v3-label">推荐判断</p>
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
                    <p className="kaypal-v3-label">证据</p>
                    <Archive
                      aria-hidden="true"
                      className="h-4 w-4 text-[var(--kaypal-v3-muted)]"
                      strokeWidth={1.8}
                    />
                  </div>
                  <ol className="mt-3 grid gap-3">
                    {selectedItem.evidence.map((item, index) => (
                      <li
                        className="flex gap-3"
                        key={`${selectedItem.id}-${item}`}
                      >
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
            <StatePanel
              icon={Archive}
              title="选择一条情报"
              detail="左侧列表有情报对象后，这里会展示证据、判断、风险边界和派发动作。"
            />
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
            {selectedItem ? (
              <div className="grid gap-2 p-4">
                {selectedItem.actions.map((action) => {
                  const Icon = action.icon;
                  const queued = queue.some(
                    (item) => item.id === queueId(selectedItem, action),
                  );
                  return (
                    <button
                      className={[
                        "rounded-[8px] border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] disabled:cursor-not-allowed disabled:opacity-60",
                        queued
                          ? "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]"
                          : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] hover:border-[var(--kaypal-v3-border-strong)] hover:bg-[var(--kaypal-v3-paper)]",
                      ].join(" ")}
                      key={action.actionId}
                      onClick={() => void runAction(action)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-2">
                          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]">
                            <Icon
                              aria-hidden="true"
                              className="h-4 w-4 text-[var(--kaypal-v3-accent)]"
                              strokeWidth={1.8}
                            />
                          </span>
                          <div className="min-w-0">
                            <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                              {queued ? "已加入队列" : action.label}
                            </p>
                            <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                              {action.reason}
                            </p>
                          </div>
                        </div>
                        <span
                          className={[
                            "shrink-0 rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                            riskMeta[action.risk].className,
                          ].join(" ")}
                        >
                          {action.target}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <StatePanel
                icon={GitBranch}
                title="等待选择情报"
                detail="选择左侧情报后，系统会给出可执行的派发动作。"
              />
            )}
          </section>

          <section className="kaypal-v3-panel overflow-hidden">
            <div className="border-b border-[var(--kaypal-v3-border)] p-4">
              <p className="kaypal-v3-label">分发任务</p>
              <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                待执行动作
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
                        <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                          {item.label} · {item.target}
                        </p>
                        <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {item.title}
                        </p>
                        <p className="mt-1 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]">
                          {item.message}
                        </p>
                      </div>
                      <QueueStateIcon state={item.state} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <StatePanel
                icon={GitBranch}
                title="队列为空"
                detail="执行派发动作后，会在这里看到处理状态和目标模块。"
              />
            )}
          </section>
        </aside>
      </section>

      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <p className="kaypal-v3-label">发现分流规则</p>
          <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
            从入库对象到业务资产
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-13">
            <thead className="bg-[var(--kaypal-v3-table-head)] text-11 font-bold text-[var(--kaypal-v3-muted)]">
              <tr>
                {["对象", "判断标准", "去向", "边界"].map((column) => (
                  <th className="px-4 py-3" key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--kaypal-v3-border)]">
              {[
                [
                  "热点",
                  "业务相关、时效明确",
                  "选题库 / 报告中心",
                  "敏感话题先审核",
                ],
                [
                  "作品",
                  "标题清晰、互动真实",
                  "素材库 / 爆款拆解",
                  "不搬运原文",
                ],
                [
                  "账号",
                  "定位相近、更新稳定",
                  "对标账号 / 增长策略",
                  "不自动触达",
                ],
                [
                  "评论",
                  "问题集中、可转 FAQ",
                  "线索洞察 / 情报规则",
                  "人工确认触达",
                ],
              ].map((row) => (
                <tr key={row.join("-")}>
                  {row.map((cell, index) => (
                    <td
                      className={[
                        "px-4 py-3 align-top leading-5 text-[var(--kaypal-v3-soft-ink)]",
                        index === 0
                          ? "font-bold text-[var(--kaypal-v3-ink)]"
                          : "",
                      ].join(" ")}
                      key={`${row.join("-")}-${cell}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function FilterGroup({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="text-12 font-bold text-[var(--kaypal-v3-soft-ink)]">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            aria-pressed={value === item.value}
            className={[
              "h-8 rounded-[8px] border px-3 text-12 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]",
              value === item.value
                ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:text-[var(--kaypal-v3-soft-ink)]",
            ].join(" ")}
            key={item.value}
            onClick={() => onChange(item.value)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatePanel({
  icon: Icon,
  title,
  detail,
  actionLabel,
  href,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  actionLabel?: string;
  href?: string;
  onAction?: () => void;
}) {
  const content = (
    <FunctionalEmptyState
      actions={
        actionLabel
          ? [
              href
                ? { href, label: actionLabel }
                : { label: actionLabel, onPress: onAction },
            ]
          : []
      }
      description={detail}
      examples={["一键找线索", "自动跟踪", "风险审核", "交接处理"]}
      icon={Icon}
      surface="plain"
      title={title}
    />
  );

  return (
    <div className="p-4">
      {content}
    </div>
  );
}

function QueueStateIcon({ state }: { state: QueueItem["state"] }) {
  if (state === "running") {
    return (
      <Loader2
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin text-[var(--kaypal-v3-muted)]"
        strokeWidth={1.8}
      />
    );
  }
  if (state === "done") {
    return (
      <CheckCircle2
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-success)]"
        strokeWidth={1.8}
      />
    );
  }
  if (state === "failed") {
    return (
      <AlertTriangle
        aria-hidden="true"
        className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-danger)]"
        strokeWidth={1.8}
      />
    );
  }
  return (
    <ArrowRight
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
      strokeWidth={1.8}
    />
  );
}
