"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
  UsersRound,
  type LucideIcon,
} from "@/components/iconpark";
import { authApi, type AuthUser } from "@/lib/api/auth";
import {
  intelligenceApi,
  type IntelligenceDispatchRecord,
  type IntelligenceDispatchRecordAction,
  type IntelligenceDispatchRecordsKind,
  type IntelligenceItem,
  type IntelligenceOverview,
  type IntelligenceReport,
  type IntelligenceReportAction,
} from "@/lib/api/intelligence";
import { publicIntelligenceText } from "./display-text";
import { publicSourceLabelForItem } from "./redfox-public-labels";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { toPublicError } from "@/lib/public-error";

type Tone = "success" | "warning" | "danger" | "neutral" | "accent";
type LaneKey = "reports" | "risk" | "growth" | "evidence";

type WorkItem = {
  key: string;
  id: string;
  lane: LaneKey;
  type: "report" | "dispatch" | "item";
  title: string;
  owner: string;
  platform: string;
  status: string;
  risk: "low" | "medium" | "high" | "neutral";
  source: string;
  summary: string;
  href: string;
  updatedAt: string;
  report?: IntelligenceReport;
  dispatchKind?: IntelligenceDispatchRecordsKind;
  dispatchRecord?: IntelligenceDispatchRecord;
  item?: IntelligenceItem;
};

type MetricCard = {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  icon: LucideIcon;
};

const lanes: Array<{
  key: LaneKey;
  title: string;
  detail: string;
  empty: string;
}> = [
  {
    key: "reports",
    title: "报告复核",
    detail: "草稿、待复核、待交付报告",
    empty: "报告中心暂无待处理对象",
  },
  {
    key: "risk",
    title: "风险复核与规则",
    detail: "风险审核、规则种子和高风险证据",
    empty: "当前没有风险审核积压",
  },
  {
    key: "growth",
    title: "增长交接",
    detail: "线索洞察和对标账号",
    empty: "当前没有增长交接对象",
  },
  {
    key: "evidence",
    title: "情报补证",
    detail: "新发现、待判断和未派发情报",
    empty: "待处理发现暂无待补证对象",
  },
];

function emptyRecords(): Record<
  IntelligenceDispatchRecordsKind,
  IntelligenceDispatchRecord[]
> {
  return {
    accounts: [],
    leads: [],
    risks: [],
    rules: [],
  };
}

function toneClass(tone: Tone) {
  if (tone === "accent") {
    return "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]";
  }
  if (tone === "success") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (tone === "warning") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  if (tone === "danger") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)] text-[var(--kaypal-v3-soft-ink)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] text-[var(--kaypal-v3-soft-ink)]";
}

function formatTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function reportStatusLabel(status: string) {
  if (status === "in_review") return "待复核";
  if (status === "delivered") return "已交付";
  if (status === "archived") return "已归档";
  return "草稿";
}

function riskLabel(risk: WorkItem["risk"]) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需复核";
  if (risk === "low") return "低风险";
  return "未评级";
}

function riskTone(risk: WorkItem["risk"]): Tone {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  if (risk === "low") return "success";
  return "neutral";
}

function reportAction(report: IntelligenceReport): IntelligenceReportAction {
  if (report.status === "draft") return "submit_review";
  if (report.status === "in_review") return "mark_delivered";
  if (report.status === "delivered") return "archive";
  return "reopen";
}

function reportActionLabel(action: IntelligenceReportAction) {
  if (action === "submit_review") return "提交复核";
  if (action === "mark_delivered") return "标记交付";
  if (action === "archive") return "归档";
  return "重开";
}

function dispatchAction(
  kind: IntelligenceDispatchRecordsKind,
): IntelligenceDispatchRecordAction {
  if (kind === "risks") return "approve";
  if (kind === "rules") return "publish_rule";
  if (kind === "accounts") return "watch_priority";
  return "create_growth_lead";
}

function dispatchActionLabel(kind: IntelligenceDispatchRecordsKind) {
  if (kind === "risks") return "审核通过";
  if (kind === "rules") return "发布规则";
  if (kind === "accounts") return "重点观察";
  return "转增长线索";
}

function dispatchRequiresManager(kind: IntelligenceDispatchRecordsKind) {
  return kind === "risks" || kind === "rules";
}

function canManageReports(user: AuthUser | null) {
  return user?.role === "manager" || user?.role === "admin";
}

function reportToWorkItem(report: IntelligenceReport): WorkItem {
  const targetHref =
    typeof report.metadata.targetHref === "string"
      ? report.metadata.targetHref
      : "/intelligence/reports";
  return {
    key: `report:${report.id}`,
    id: report.id,
    lane: "reports",
    type: "report",
    title: report.title,
    owner: report.owner || "运营负责人",
    platform: report.rangeKey || "报告",
    status: reportStatusLabel(report.status),
    risk: report.status === "in_review" ? "medium" : "neutral",
    source: "报告中心",
    summary: `证据 ${report.evidence.length} 条，完整度 ${report.completeness}%`,
    href: targetHref,
    updatedAt: report.updatedAt,
    report,
  };
}

function dispatchToWorkItem(
  kind: IntelligenceDispatchRecordsKind,
  record: IntelligenceDispatchRecord,
): WorkItem {
  const lane: LaneKey =
    kind === "leads" || kind === "accounts" ? "growth" : "risk";
  return {
    key: `${kind}:${record.id}`,
    id: record.id,
    lane,
    type: "dispatch",
    title: record.title,
    owner: record.owner,
    platform: record.platform,
    status: record.status,
    risk: record.risk,
    source: record.source,
    summary: record.summary || record.evidence[0] || record.boundary,
    href: record.href || "/intelligence/inbox",
    updatedAt: record.updatedAt,
    dispatchKind: kind,
    dispatchRecord: record,
  };
}

function itemToWorkItem(item: IntelligenceItem): WorkItem {
  return {
    key: `item:${item.id}`,
    id: item.id,
    lane: "evidence",
    type: "item",
    title: publicIntelligenceText(item.title, "系统情报"),
    owner: item.status.includes("risk") ? "复核负责人" : "内容策划",
    platform: item.platform,
    status: item.status,
    risk: item.status.includes("risk") ? "high" : "neutral",
    source: publicSourceLabelForItem(item),
    summary: publicIntelligenceText(
      item.summary || item.content || "需要人工判断去向和证据完整性。",
    ),
    href: `/intelligence/inbox`,
    updatedAt: item.updatedAt,
    item,
  };
}

export function IntelligenceCollaborationWorkbench() {
  const [overview, setOverview] = useState<IntelligenceOverview | null>(null);
  const [records, setRecords] = useState(emptyRecords);
  const [items, setItems] = useState<IntelligenceItem[]>([]);
  const [reports, setReports] = useState<IntelligenceReport[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionKey, setActionKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [
        meResult,
        overviewResult,
        itemsResult,
        reportsResult,
        risksResult,
        leadsResult,
        accountsResult,
        rulesResult,
      ] = await Promise.all([
        authApi.me(),
        intelligenceApi.overview({ limit: 10 }),
        intelligenceApi.listItems({ page: 1, limit: 18, sortBy: "updatedAt" }),
        intelligenceApi.listReports({ page: 1, limit: 12 }),
        intelligenceApi.listDispatchRecords("risks", { page: 1, limit: 12 }),
        intelligenceApi.listDispatchRecords("leads", { page: 1, limit: 12 }),
        intelligenceApi.listDispatchRecords("accounts", { page: 1, limit: 12 }),
        intelligenceApi.listDispatchRecords("rules", { page: 1, limit: 12 }),
      ]);
      setUser(meResult);
      setOverview(overviewResult);
      setItems(itemsResult.items);
      setReports(reportsResult.items);
      setRecords({
        accounts: accountsResult.items,
        leads: leadsResult.items,
        risks: risksResult.items,
        rules: rulesResult.items,
      });
    } catch (error) {
      setMessage(toPublicError(error, "团队协作数据暂时无法读取，请重新加载。"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workItems = useMemo(() => {
    const activeReports = reports
      .filter((report) => report.status !== "archived")
      .map(reportToWorkItem);
    const dispatchItems = (
      [
        ["risks", records.risks],
        ["rules", records.rules],
        ["leads", records.leads],
        ["accounts", records.accounts],
      ] as Array<
        [IntelligenceDispatchRecordsKind, IntelligenceDispatchRecord[]]
      >
    ).flatMap(([kind, list]) =>
      list
        .filter((record) => !["archived", "done"].includes(record.status))
        .map((record) => dispatchToWorkItem(kind, record)),
    );
    const evidenceItems = items
      .filter(
        (item) =>
          item.status === "new" ||
          item.status.includes("queued") ||
          item.status.includes("risk"),
      )
      .slice(0, 10)
      .map(itemToWorkItem);
    return [...activeReports, ...dispatchItems, ...evidenceItems].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
  }, [items, records, reports]);

  const selected =
    workItems.find((item) => item.key === selectedKey) || workItems[0] || null;

  const metrics: MetricCard[] = useMemo(() => {
    const openReports = reports.filter((report) =>
      ["draft", "in_review"].includes(report.status),
    ).length;
    const highRisk = workItems.filter((item) => item.risk === "high").length;
    const growthCount = workItems.filter(
      (item) => item.lane === "growth",
    ).length;
    return [
      {
        label: "待协作对象",
        value: String(workItems.length),
        detail: "报告、风险、线索、补证",
        tone: workItems.length ? "accent" : "neutral",
        icon: ClipboardList,
      },
      {
        label: "待复核报告",
        value: String(openReports),
        detail: "草稿与待复核",
        tone: openReports ? "warning" : "success",
        icon: FileText,
      },
      {
        label: "高风险需处理",
        value: String(highRisk),
        detail: "需要复核负责人确认",
        tone: highRisk ? "danger" : "success",
        icon: ShieldAlert,
      },
      {
        label: "增长交接",
        value: String(growthCount),
        detail: "线索洞察与对标账号",
        tone: growthCount ? "success" : "neutral",
        icon: UsersRound,
      },
    ];
  }, [reports, workItems]);

  async function runAction(item: WorkItem) {
    if (item.type === "item") return;
    const key = item.key;
    setActionKey(key);
    setMessage("");
    try {
      if (item.report) {
        const action = reportAction(item.report);
        const result = await intelligenceApi.processReport(item.report.id, {
          action,
          note: `团队协作台执行：${reportActionLabel(action)}`,
        });
        setReports((current) =>
          current.map((report) =>
            report.id === result.report.id ? result.report : report,
          ),
        );
        setMessage(result.message);
        return;
      }
      if (item.dispatchKind && item.dispatchRecord) {
        const action = dispatchAction(item.dispatchKind);
        const result = await intelligenceApi.processDispatchRecord(
          item.dispatchKind,
          item.dispatchRecord.id,
          {
            action,
            note: `团队协作台执行：${dispatchActionLabel(item.dispatchKind)}`,
          },
        );
        setRecords((current) => ({
          ...current,
          [item.dispatchKind as IntelligenceDispatchRecordsKind]: current[
            item.dispatchKind as IntelligenceDispatchRecordsKind
          ].map((record) =>
            record.id === result.record.id ? result.record : record,
          ),
        }));
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(toPublicError(error, "协作操作未完成，请重试。"));
    } finally {
      setActionKey("");
    }
  }

  const userCanManageReports = canManageReports(user);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <UsersRound
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">团队处理进度</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  团队协作工作台
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  把报告复核、风险审核、增长交接和情报补证放到一个队列，按负责人和权限推进。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <span
                className={[
                  "inline-flex h-10 items-center gap-2 rounded-[8px] border px-3 text-12 font-semibold",
                  userCanManageReports
                    ? toneClass("success")
                    : toneClass("warning"),
                ].join(" ")}
              >
                <UserCheck aria-hidden="true" className="h-4 w-4" />
                {user?.role || "operator"} ·{" "}
                {userCanManageReports ? "可交付/归档" : "需上级复核"}
              </span>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={loading}
                onClick={() => void load()}
                type="button"
              >
                {loading ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <RefreshCw
                    aria-hidden="true"
                    className="h-4 w-4"
                    strokeWidth={1.8}
                  />
                )}
                刷新
              </button>
            </div>
          </div>

        </div>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, detail, tone, icon: Icon }) => (
          <article
            className={[
              "kaypal-v3-panel min-h-[96px] p-3",
              toneClass(tone),
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
          </article>
        ))}
      </section>

      {message ? (
        <p className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
          {message}
        </p>
      ) : null}

      <section className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid min-w-0 gap-3 xl:grid-cols-4">
          {lanes.map((lane) => {
            const laneItems = workItems.filter(
              (item) => item.lane === lane.key,
            );
            return (
              <article
                className="kaypal-v3-panel min-w-0 overflow-hidden"
                key={lane.key}
              >
                <div className="border-b border-[var(--kaypal-v3-border)] p-3">
                  <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    {lane.title}
                  </p>
                  <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                    {lane.detail}
                  </p>
                </div>
                <div className="grid gap-2 p-2">
                  {laneItems.length ? (
                    laneItems.slice(0, 6).map((item) => {
                      const active = selected?.key === item.key;
                      const canRun =
                        (item.type === "dispatch" &&
                          (!item.dispatchKind ||
                            !dispatchRequiresManager(item.dispatchKind) ||
                            userCanManageReports)) ||
                        (item.type === "report" &&
                          (reportAction(item.report as IntelligenceReport) ===
                            "submit_review" ||
                            userCanManageReports));
                      return (
                        <button
                          aria-pressed={active}
                          className={[
                            "rounded-[8px] border p-3 text-left transition",
                            active
                              ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)]"
                              : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] hover:border-[var(--kaypal-v3-border-strong)]",
                          ].join(" ")}
                          key={item.key}
                          onClick={() => setSelectedKey(item.key)}
                          type="button"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                                toneClass(riskTone(item.risk)),
                              ].join(" ")}
                            >
                              {riskLabel(item.risk)}
                            </span>
                            <span className="text-11 text-[var(--kaypal-v3-muted)]">
                              {item.owner}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-13 font-bold leading-5 text-[var(--kaypal-v3-ink)]">
                            {item.title}
                          </p>
                          <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                            {item.summary}
                          </p>
                          <div className="mt-2 flex items-center justify-between gap-2 text-11 text-[var(--kaypal-v3-muted)]">
                            <span>{item.platform}</span>
                            <span>{canRun ? "可处理" : "需上级"}</span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <FunctionalEmptyState
                      description={`${lane.empty}。有新报告、风险、增长交接或补证对象时会进入这条协作泳道。`}
                      examples={[lane.title, "负责人", "处理状态"]}
                      icon={ClipboardList}
                      surface="plain"
                      title="当前队列为空"
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <aside className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">处理详情</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              {selected ? selected.title : "等待选择对象"}
            </h2>
          </div>
          {selected ? (
            <div className="grid gap-4 p-4">
              <div className="grid gap-2">
                {[
                  ["负责人", selected.owner],
                  ["状态", selected.status],
                  ["来源", selected.source],
                  ["更新时间", formatTime(selected.updatedAt)],
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

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                <p className="kaypal-v3-label">判断摘要</p>
                <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {selected.summary || "暂无摘要，需要人工补齐证据。"}
                </p>
              </div>

              {selected.dispatchRecord?.evidence.length ? (
                <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3">
                  <p className="kaypal-v3-label">证据</p>
                  <div className="mt-2 grid gap-2">
                    {selected.dispatchRecord.evidence
                      .slice(0, 4)
                      .map((item) => (
                        <p
                          className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]"
                          key={item}
                        >
                          {item}
                        </p>
                      ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {selected.type !== "item" ? (
                  <button
                    className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={
                      Boolean(actionKey) ||
                      (selected.type === "report" &&
                        selected.report !== undefined &&
                        reportAction(selected.report) !== "submit_review" &&
                        !userCanManageReports) ||
                      (selected.type === "dispatch" &&
                        selected.dispatchKind !== undefined &&
                        dispatchRequiresManager(selected.dispatchKind) &&
                        !userCanManageReports)
                    }
                    onClick={() => void runAction(selected)}
                    type="button"
                  >
                    {actionKey === selected.key ? (
                      <Loader2
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin"
                        strokeWidth={1.8}
                      />
                    ) : (
                      <CheckCircle2
                        aria-hidden="true"
                        className="h-4 w-4"
                        strokeWidth={1.8}
                      />
                    )}
                    {selected.report
                      ? reportActionLabel(reportAction(selected.report))
                      : selected.dispatchKind
                        ? dispatchActionLabel(selected.dispatchKind)
                        : "处理"}
                  </button>
                ) : null}
                <Link
                  className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]"
                  href={selected.href}
                >
                  打开去向
                  <ArrowRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                </Link>
              </div>

              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
                <p className="kaypal-v3-label">权限边界</p>
                <div className="mt-2 grid gap-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  <p>operator：保存报告、提交复核、整理证据和去向。</p>
                  <p>经理/管理员：交付报告、归档、重开和处理高风险收口。</p>
                  <p>
                    当前数据使用成功率{" "}
                    {overview?.redfox.costs.totalCalls
                      ? `${Math.round(
                          (overview.redfox.costs.successCalls /
                            overview.redfox.costs.totalCalls) *
                            100,
                        )}%`
                      : "--"}
                    ，异常监控 {overview?.metrics.monitorErrors ?? 0} 个。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/reports", label: "报告中心" },
                  { href: "/intelligence/inbox", label: "待处理发现" },
                  { href: "/intelligence/risks", label: "风险审核" },
                ]}
                description="回到报告中心、待处理发现或风险审核生成可协作对象。这里会承接复核、审核、增长交接和补证任务。"
                examples={["报告复核", "风险审核", "增长交接", "补充证据"]}
                icon={UsersRound}
                surface="plain"
                title="当前没有待处理对象"
              />
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
