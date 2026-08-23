"use client";

import { SkeletonRow } from "@/components/skeleton";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Database,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Target,
  UsersRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  intelligenceApi,
  type IntelligenceDispatchRecordAction,
  type IntelligenceDispatchRecord,
  type IntelligenceDispatchRecordsKind,
} from "@/lib/api/intelligence";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { type IntelligencePageKey } from "../data";
import { IntelligenceToolResultContext } from "./intelligence-tool-result-context";
import { useIsMobile } from "@/lib/hooks/use-media-query";

type RiskLevel = IntelligenceDispatchRecord["risk"];

type DispatchPageConfig = {
  activeKey: IntelligencePageKey;
  kind: IntelligenceDispatchRecordsKind;
  title: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDetail: string;
  primaryLabel: string;
  primaryHref: string;
};

const configs: Record<IntelligenceDispatchRecordsKind, DispatchPageConfig> = {
  risks: {
    activeKey: "risks",
    kind: "risks",
    title: "风险审核",
    eyebrow: "风险守门",
    description:
      "承接总控台派发过来的高风险情报，保留证据、风险边界和处理状态，避免对象直接进入业务流程。",
    icon: ShieldAlert,
    emptyTitle: "还没有风险审核记录",
    emptyDetail:
      "在今日情报工作台把高风险对象派发到风险审核后，这里会出现待处理记录。",
    primaryLabel: "回工作台",
    primaryHref: "/intelligence",
  },
  rules: {
    activeKey: "rules",
    kind: "rules",
    title: "情报规则",
    eyebrow: "规则种子",
    description:
      "承接风险审核和总控台沉淀出的规则种子，后续整理为关键词、表达、版权和触达边界。",
    icon: SlidersHorizontal,
    emptyTitle: "还没有规则种子",
    emptyDetail:
      "从风险对象或高价值情报中点击沉淀规则后，这里会形成可整理的规则输入。",
    primaryLabel: "配置监控",
    primaryHref: "/intelligence/monitors",
  },
  accounts: {
    activeKey: "accounts",
    kind: "accounts",
    title: "对标账号",
    eyebrow: "增长观察池",
    description:
      "承接总控台筛出的账号样本，沉淀为长期观察对象，用于栏目、互动、评论异议和增长策略复盘。",
    icon: UsersRound,
    emptyTitle: "还没有对标账号",
    emptyDetail:
      "在情报对象上点击进入对标后，这里会保留账号、来源记录和观察理由。",
    primaryLabel: "跑账号搜索",
    primaryHref: "/intelligence/search",
  },
  leads: {
    activeKey: "leads",
    kind: "leads",
    title: "线索洞察",
    eyebrow: "评论到需求",
    description:
      "承接评论和搜索样本里的痛点、意向词、异议和回复建议，只做人工判断输入，不自动触达。",
    icon: Target,
    emptyTitle: "还没有线索洞察",
    emptyDetail:
      "从评论、搜索或热点对象派发线索洞察后，这里会沉淀用户问题和需求信号。",
    primaryLabel: "看待处理发现",
    primaryHref: "/intelligence/inbox",
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

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending_review: "待审核",
    rule_seeded: "规则种子",
    watching: "观察中",
    insight_ready: "已沉淀",
    queued: "队列中",
    done: "已完成",
    approved: "已通过",
    rejected: "已驳回",
    reviewed: "已复核",
    active_rule: "已发布",
    approved_rule: "已通过",
    rejected_rule: "已驳回",
    rule_reviewed: "已复核",
    priority: "重点观察",
    archived: "已归档",
    lead_created: "已转线索",
  };
  return map[status] || status || "待处理";
}

function riskClass(risk: RiskLevel) {
  return riskMeta[risk].className;
}

type IntelligenceDispatchRecordsPageProps = {
  kind: IntelligenceDispatchRecordsKind;
};

type RecordActionView = {
  action: IntelligenceDispatchRecordAction;
  label: string;
  icon: LucideIcon;
  tone: "primary" | "neutral" | "danger";
  disabled?: boolean;
};

function actionsForRecord(
  kind: IntelligenceDispatchRecordsKind,
  record: IntelligenceDispatchRecord,
): RecordActionView[] {
  if (kind === "risks") {
    const closed = ["approved", "rejected", "archived"].includes(record.status);
    return [
      {
        action: "approve",
        label: "通过审核",
        icon: CheckCircle2,
        tone: "primary",
        disabled: closed,
      },
      {
        action: "reject",
        label: "驳回风险",
        icon: XCircle,
        tone: "danger",
        disabled: closed,
      },
    ];
  }
  if (kind === "rules") {
    const closed = ["active_rule", "rejected_rule", "archived"].includes(
      record.status,
    );
    return [
      {
        action: "publish_rule",
        label: "发布规则",
        icon: CheckCircle2,
        tone: "primary",
        disabled: closed,
      },
      {
        action: "reject",
        label: "驳回种子",
        icon: XCircle,
        tone: "danger",
        disabled: closed,
      },
    ];
  }
  if (kind === "accounts") {
    return [
      {
        action: "watch_priority",
        label: "重点观察",
        icon: Star,
        tone: "primary",
        disabled: record.status === "priority" || record.status === "archived",
      },
      {
        action: "archive",
        label: "归档",
        icon: Archive,
        tone: "neutral",
        disabled: record.status === "archived",
      },
    ];
  }
  return [
    {
      action: "create_growth_lead",
      label: "转增长线索",
      icon: Send,
      tone: "primary",
      disabled:
        record.status === "lead_created" || record.status === "archived",
    },
    {
      action: "archive",
      label: "归档",
      icon: Archive,
      tone: "neutral",
      disabled: record.status === "archived",
    },
  ];
}

function actionClass(tone: RecordActionView["tone"]) {
  if (tone === "primary") {
    return "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent)] text-white hover:-translate-y-0.5";
  }
  if (tone === "danger") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-danger)] hover:text-[var(--kaypal-v3-ink)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-soft-ink)] hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]";
}

export function IntelligenceDispatchRecordsPage({
  kind,
}: IntelligenceDispatchRecordsPageProps) {
  const searchParams = useSearchParams();
  const activeTool = searchParams.get("tool");
  const config = configs[kind];
  const PageIcon = config.icon;
  const [records, setRecords] = useState<IntelligenceDispatchRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [queryKeyword, setQueryKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [processingAction, setProcessingAction] =
    useState<IntelligenceDispatchRecordAction | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    intelligenceApi
      .listDispatchRecords(kind, {
        page: 1,
        limit: 50,
        keyword: queryKeyword.trim() || undefined,
      })
      .then((result) => {
        if (!active) return;
        setRecords(result.items);
        setTotal(result.total);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setRecords([]);
        setTotal(0);
        setError(reason instanceof Error ? reason.message : "处理记录读取失败");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [kind, queryKeyword, refreshKey]);

  const selectedRecord = useMemo(
    () =>
      records.find((record) => record.id === selectedId) || records[0] || null,
    [records, selectedId],
  );

  const metrics = useMemo(
    () => [
      {
        label: "记录总数",
        value: String(total),
        detail: "当前处理台已承接的对象",
        icon: Database,
      },
      {
        label: "高风险",
        value: String(
          records.filter((record) => record.risk === "high").length,
        ),
        detail: "需要优先人工确认",
        icon: ShieldAlert,
      },
      {
        label: "可复盘",
        value: String(
          records.filter((record) => record.evidence.length).length,
        ),
        detail: "有证据和来源记录",
        icon: Inbox,
      },
    ],
    [records, total],
  );

  const recordActions = useMemo(
    () => (selectedRecord ? actionsForRecord(kind, selectedRecord) : []),
    [kind, selectedRecord],
  );

  function reload() {
    setLoading(true);
    setActionError("");
    setActionMessage("");
    setRefreshKey((value) => value + 1);
  }

  function search() {
    setLoading(true);
    setActionError("");
    setActionMessage("");
    setQueryKeyword(keyword);
  }

  async function runRecordAction(action: IntelligenceDispatchRecordAction) {
    if (!selectedRecord || processingAction) return;
    setProcessingAction(action);
    setActionError("");
    setActionMessage("");
    try {
      const result = await intelligenceApi.processDispatchRecord(
        kind,
        selectedRecord.id,
        { action },
      );
      setRecords((current) =>
        current.map((record) =>
          record.id === result.record.id ? result.record : record,
        ),
      );
      setSelectedId(result.record.id);
      setActionMessage(result.message);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "处理动作执行失败",
      );
    } finally {
      setProcessingAction(null);
    }
  }

  const isMobile = useIsMobile();
  if (isMobile) {
    const riskBadge = (risk: RiskLevel) =>
      risk === "high" ? "mx-badge mx-badge-red"
        : risk === "medium" ? "mx-badge mx-badge-gold"
          : "mx-badge mx-badge-green";
    return (
      <div className="kx-mobile-ambient">
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">{config.title}</h1>
              <p className="mx-page-sub">{config.eyebrow} · 共 {total} 条</p>
            </div>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 12px", whiteSpace: "nowrap" }}
              disabled={loading}
              onClick={reload}
            >
              <RefreshCw size={13} style={{ marginRight: 4 }} />
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 10 }}>{error}</p>
          ) : null}
          {actionMessage ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-success)", marginBottom: 10 }}>{actionMessage}</p>
          ) : null}
          {actionError ? (
            <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", marginBottom: 10 }}>{actionError}</p>
          ) : null}

          {loading ? (
            <div className="mx-card mx-list-card">
              <SkeletonRow width="70%" />
              <SkeletonRow width="58%" />
            </div>
          ) : records.length === 0 ? (
            <div className="mx-card mx-empty">
              <p>{config.emptyTitle}</p>
              <p style={{ fontSize: 11, marginTop: 4, lineHeight: 1.6 }}>{config.emptyDetail}</p>
              <Link href={config.primaryHref} className="mx-btn-gold" style={{ marginTop: 12, display: "inline-block", textDecoration: "none" }}>
                {config.primaryLabel}
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {records.map((record) => {
                const isOpen = selectedId === record.id;
                const actions = actionsForRecord(kind, record);
                return (
                  <div key={record.id} className="mx-card" style={{ padding: 14, border: isOpen ? "1.5px solid #2563eb" : undefined }}>
                    <button
                      type="button"
                      style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer" }}
                      onClick={() => setSelectedId(isOpen ? "" : record.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className={riskBadge(record.risk)}>{riskMeta[record.risk].label}</span>
                        <span className="mx-badge">{statusLabel(record.status)}</span>
                      </div>
                      <div className="mx-row-title" style={{ marginTop: 8, fontSize: 13.5, fontWeight: 600 }}>
                        {record.title}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: "var(--mx-muted)" }}>
                        {record.platform} · {record.source} · {formatTime(record.createdAt)}
                      </div>
                    </button>

                    {isOpen ? (
                      <>
                        {record.summary ? (
                          <p style={{ marginTop: 8, fontSize: 11.5, color: "var(--mx-ink)", lineHeight: 1.6, background: "rgba(142,165,190,.08)", borderRadius: 10, padding: "8px 10px" }}>
                            {record.summary}
                          </p>
                        ) : null}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          {actions.map(({ action, label, tone, disabled }) => (
                            <button
                              key={action}
                              type="button"
                              disabled={disabled || processingAction === action}
                              onClick={() => void runRecordAction(action)}
                              style={{
                                flex: 1,
                                fontSize: 11.5,
                                padding: "9px 10px",
                                borderRadius: 10,
                                border: tone === "danger" ? "1px solid rgba(239,68,68,.25)" : "1px solid rgba(142,165,190,.3)",
                                background: tone === "primary" ? "rgba(37,99,235,.12)" : tone === "danger" ? "rgba(239,68,68,.08)" : "rgba(120,148,179,.12)",
                                color: tone === "primary" ? "var(--kaypal-v3-cobalt)" : tone === "danger" ? "var(--kaypal-v3-danger)" : "var(--mx-ink)",
                                opacity: disabled || processingAction === action ? 0.5 : 1,
                              }}
                            >
                              {processingAction === action ? "处理中…" : label}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <PageIcon
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">{config.eyebrow}</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  {config.title}
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {config.description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
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
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                href={config.primaryHref}
              >
                {config.primaryLabel}
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
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

          <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--kaypal-v3-muted)]"
                strokeWidth={1.8}
              />
              <input
                className="h-10 w-full rounded-[8px] pl-9 pr-3 text-13"
                onChange={(event) => setKeyword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") search();
                }}
                placeholder="搜索标题、平台、状态或来源"
                value={keyword}
              />
            </div>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-4 text-13 font-semibold text-[var(--kaypal-v3-soft-ink)] transition-colors hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)]"
              onClick={search}
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

      <IntelligenceToolResultContext
        tool={kind === "accounts" ? activeTool : null}
      />

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(0,1.18fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">真实记录</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              处理队列
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {loading ? (
              <div className="flex min-h-[260px] items-center justify-center p-4 text-13 font-semibold text-[var(--kaypal-v3-muted)]">
                <Loader2
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 animate-spin"
                  strokeWidth={1.8}
                />
                正在读取处理记录
              </div>
            ) : error ? (
              <div className="p-4">
                <FailureActionPanel
                  actions={[
                    {
                      label: "重新读取",
                      onPress: () => setRefreshKey((value) => value + 1),
                    },
                    { href: config.primaryHref, label: config.primaryLabel },
                  ]}
                  impact="处理队列、证据记录和动作入口暂时不可用。"
                  nextAction="先重新读取；仍失败时回到上游页面重新生成或派发对象。"
                  reason={error}
                  title={`${config.title}需要处理`}
                />
              </div>
            ) : records.length === 0 ? (
              <div className="p-4">
                <FunctionalEmptyState
                  actions={[
                    { href: config.primaryHref, label: config.primaryLabel },
                    { href: "/intelligence/inbox", label: "待处理发现" },
                  ]}
                  description={config.emptyDetail}
                  examples={["真实记录", "处理状态", "证据来源", "下一步动作"]}
                  icon={config.icon}
                  surface="plain"
                  title={config.emptyTitle}
                />
              </div>
            ) : (
              records.map((record) => {
                const isSelected = selectedRecord?.id === record.id;
                return (
                  <button
                    aria-pressed={isSelected}
                    className={[
                      "block w-full p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--kaypal-v3-accent)]",
                      isSelected
                        ? "bg-[var(--kaypal-v3-accent-soft)]"
                        : "bg-[var(--kaypal-v3-paper)] hover:bg-[var(--kaypal-v3-paper-soft)]",
                    ].join(" ")}
                    key={record.id}
                    onClick={() => setSelectedId(record.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              riskClass(record.risk),
                            ].join(" ")}
                          >
                            {riskMeta[record.risk].label}
                          </span>
                          <span className="rounded-[6px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                            {statusLabel(record.status)}
                          </span>
                        </div>
                        <h3 className="mt-2 text-14 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                          {record.title}
                        </h3>
                        <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          {record.platform} · {record.source} ·{" "}
                          {formatTime(record.createdAt)}
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
            <p className="kaypal-v3-label">证据和处理边界</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {selectedRecord?.title || "等待选择记录"}
            </h2>
          </div>
          {selectedRecord ? (
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
              <div className="min-w-0">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["状态", statusLabel(selectedRecord.status)],
                    ["负责人", selectedRecord.owner],
                    ["时间", formatTime(selectedRecord.createdAt)],
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

                <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                  <p className="kaypal-v3-label">处理摘要</p>
                  <p className="mt-2 text-14 font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                    {selectedRecord.summary || "已进入目标处理台。"}
                  </p>
                  <div className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] p-3">
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {selectedRecord.boundary ||
                        "保留来源和证据，不自动触达，不直接复用第三方原文素材。"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-4">
                  <p className="kaypal-v3-label">业务动作</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {recordActions.map(
                      ({ action, label, icon: ActionIcon, tone, disabled }) => {
                        const isProcessing = processingAction === action;
                        return (
                          <button
                            className={[
                              "inline-flex h-9 items-center gap-2 rounded-[8px] border px-3 text-12 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
                              actionClass(tone),
                            ].join(" ")}
                            disabled={disabled || Boolean(processingAction)}
                            key={action}
                            onClick={() => runRecordAction(action)}
                            type="button"
                          >
                            {isProcessing ? (
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
                  {actionMessage ? (
                    <p className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] px-3 py-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {actionMessage}
                    </p>
                  ) : null}
                  {actionError ? (
                    <p className="mt-3 rounded-[8px] border border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] px-3 py-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {actionError}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <p className="kaypal-v3-label">来源记录</p>
                {selectedRecord.evidence.length > 0 ? (
                  <ol className="mt-3 grid gap-3">
                    {selectedRecord.evidence.slice(0, 6).map((item, index) => (
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
                    暂无来源记录；可回到情报对象补充来源、摘要和边界。
                  </p>
                )}
                <Link
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--kaypal-v3-accent)] active:translate-y-0"
                  href={selectedRecord.href}
                >
                  打开目标模块
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center p-4">
              <div className="max-w-md rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-5 text-center">
                <Inbox
                  aria-hidden="true"
                  className="mx-auto h-8 w-8 text-[var(--kaypal-v3-muted)]"
                  strokeWidth={1.8}
                />
                <p className="mt-3 text-14 font-bold text-[var(--kaypal-v3-ink)]">
                  选择左侧记录查看来源
                </p>
                <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  处理记录会展示来源、风险、记录链、边界和下一步模块。
                </p>
              </div>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
