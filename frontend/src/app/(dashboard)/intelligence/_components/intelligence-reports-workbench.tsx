"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  intelligenceApi,
  type IntelligenceDispatchRecord,
  type IntelligenceDispatchRecordsKind,
  type IntelligenceItem,
  type IntelligenceOverview,
  type IntelligenceReport,
  type IntelligenceReportAction,
} from "@/lib/api/intelligence";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { toPublicError } from "@/lib/public-error";

type ReportKind = "daily" | "competitor" | "opportunity" | "risk";
type RangeKey = "today" | "7d" | "30d";
type Tone = "success" | "warning" | "danger" | "neutral";

type ReportTemplate = {
  key: ReportKind;
  title: string;
  audience: string;
  owner: string;
  detail: string;
  href: string;
  icon: LucideIcon;
};

type DraftReport = {
  id: string;
  title: string;
  createdAt: string;
  markdown: string;
  findings: string[];
  evidence: string[];
};

const reportTemplates: ReportTemplate[] = [
  {
    key: "daily",
    title: "今日情报简报",
    audience: "运营负责人 / 管理层",
    owner: "运营负责人",
    detail: "汇总今日机会、风险、派发对象和监控异常。",
    href: "/intelligence/inbox",
    icon: FileText,
  },
  {
    key: "competitor",
    title: "竞品账号周报",
    audience: "增长负责人",
    owner: "增长负责人",
    detail: "围绕对标账号、内容结构、互动问题和增长动作输出。",
    href: "/intelligence/accounts",
    icon: UsersRound,
  },
  {
    key: "opportunity",
    title: "选题机会报告",
    audience: "内容策划",
    owner: "内容策划",
    detail: "把热点、评论、行业源沉淀成可生产的选题机会。",
    href: "/topics",
    icon: Sparkles,
  },
  {
    key: "risk",
    title: "风险摘要",
    audience: "复核负责人",
    owner: "复核负责人",
    detail: "汇总高风险对象、命中原因、需处理动作和规则建议。",
    href: "/intelligence/risks",
    icon: ShieldAlert,
  },
];

const rangeOptions: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: "today", label: "今天", days: 1 },
  { key: "7d", label: "7 天", days: 7 },
  { key: "30d", label: "30 天", days: 30 },
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

function rangeFrom(range: RangeKey) {
  const option =
    rangeOptions.find((item) => item.key === range) || rangeOptions[1];
  const date = new Date();
  date.setDate(date.getDate() - option.days + 1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function riskTone(risk?: string | null): Tone {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  if (risk === "low") return "success";
  return "neutral";
}

function toneClass(tone: Tone) {
  if (tone === "success") {
    return "border-[var(--kaypal-v3-success)] bg-[var(--kaypal-v3-success-soft)]";
  }
  if (tone === "warning") {
    return "border-[var(--kaypal-v3-amber)] bg-[var(--kaypal-v3-amber-soft)]";
  }
  if (tone === "danger") {
    return "border-[var(--kaypal-v3-danger)] bg-[var(--kaypal-v3-danger-soft)]";
  }
  return "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)]";
}

function riskLabel(risk?: string | null) {
  if (risk === "high") return "高风险";
  if (risk === "medium") return "需复核";
  if (risk === "low") return "低风险";
  return "未评级";
}

function reportStatusLabel(status: string) {
  if (status === "in_review") return "待复核";
  if (status === "delivered") return "已交付";
  if (status === "archived") return "已归档";
  return "草稿";
}

function reportStatusTone(status: string): Tone {
  if (status === "delivered") return "success";
  if (status === "in_review") return "warning";
  if (status === "archived") return "neutral";
  return "neutral";
}

function reportKind(value?: string | null): ReportKind | null {
  return reportTemplates.some((item) => item.key === value)
    ? (value as ReportKind)
    : null;
}

function reportToDraft(report: IntelligenceReport): DraftReport {
  return {
    id: report.id,
    title: report.title,
    createdAt: report.createdAt,
    markdown: report.markdown,
    findings: report.findings,
    evidence: report.evidence,
  };
}

function reportActionLabel(action: IntelligenceReportAction) {
  if (action === "submit_review") return "提交复核";
  if (action === "mark_delivered") return "标记交付";
  if (action === "archive") return "归档";
  return "重开";
}

function platformLabel(platform?: string | null) {
  const key = (platform || "").toLowerCase();
  if (key === "douyin") return "抖音";
  if (key === "xiaohongshu") return "小红书";
  if (key === "bilibili") return "B站";
  if (key === "wechat") return "公众号";
  if (key === "weibo") return "微博";
  return platform || "公开渠道";
}

function intelligenceTypeLabel(type?: string | null) {
  const key = (type || "").toLowerCase();
  if (key.includes("trend") || key.includes("hot")) return "热点";
  if (key.includes("lead") || key.includes("comment")) return "线索";
  if (key.includes("account") || key.includes("author")) return "账号";
  if (key.includes("viral")) return "爆款样本";
  if (key.includes("risk") || key.includes("compliance")) return "风险";
  if (key.includes("industry")) return "行业";
  if (key.includes("rule")) return "规则";
  return "情报";
}

function recordEvidence(record: IntelligenceDispatchRecord) {
  return (
    record.evidence[0] || record.summary || record.boundary || record.title
  );
}

function reportRecords(
  kind: ReportKind,
  records: Record<
    IntelligenceDispatchRecordsKind,
    IntelligenceDispatchRecord[]
  >,
) {
  if (kind === "risk") return records.risks;
  if (kind === "competitor") return records.accounts;
  if (kind === "opportunity") return [...records.leads, ...records.rules];
  return [
    ...records.risks.slice(0, 4),
    ...records.leads.slice(0, 4),
    ...records.accounts.slice(0, 4),
    ...records.rules.slice(0, 4),
  ];
}

function buildFindings(
  kind: ReportKind,
  overview: IntelligenceOverview | null,
  items: IntelligenceItem[],
  records: IntelligenceDispatchRecord[],
) {
  const metrics = overview?.metrics;
  if (kind === "risk") {
    return [
      `当前风险证据 ${records.length} 条，监控异常 ${metrics?.monitorErrors ?? 0} 个。`,
      `数据使用失败 ${overview?.redfox.costs.failedCalls ?? 0} 次，需和用量治理联动。`,
      "高风险对象必须先完成审核，再进入素材、选题或增长流程。",
    ];
  }
  if (kind === "competitor") {
    return [
      `对标账号证据 ${records.length} 条，近期情报对象 ${items.length} 条。`,
      "优先看栏目稳定性、评论问题和互动质量，不复制原内容。",
      "可交付给增长负责人用于账号监控和策略复盘。",
    ];
  }
  if (kind === "opportunity") {
    return [
      `线索和规则证据 ${records.length} 条，已生成选题 ${metrics?.generatedTopics ?? 0} 个。`,
      "把评论问题、行业源和热点样本沉淀成可生产选题。",
      "涉及价格、效果、案例真实性的问题先补充表达边界。",
    ];
  }
  return [
    `本周期新增情报 ${metrics?.newItems ?? 0} 条，总情报 ${metrics?.totalItems ?? 0} 条。`,
    `已导入素材 ${metrics?.importedMaterials ?? 0} 条，已生成选题 ${metrics?.generatedTopics ?? 0} 个。`,
    `活跃监控 ${metrics?.activeMonitors ?? 0} 个，异常监控 ${metrics?.monitorErrors ?? 0} 个。`,
  ];
}

function buildMarkdown(
  template: ReportTemplate,
  findings: string[],
  records: IntelligenceDispatchRecord[],
  items: IntelligenceItem[],
) {
  const evidenceLines = records
    .slice(0, 8)
    .map((record) => `- ${record.title}：${recordEvidence(record)}`);
  const itemLines = items
    .slice(0, 6)
    .map(
      (item) =>
        `- ${item.title}（${platformLabel(item.platform)} / ${intelligenceTypeLabel(item.type)}）`,
    );
  return [
    `# ${template.title}`,
    "",
    `受众：${template.audience}`,
    `负责人：${template.owner}`,
    `生成时间：${formatTime(new Date().toISOString())}`,
    "",
    "## 核心结论",
    ...findings.map((finding) => `- ${finding}`),
    "",
    "## 证据对象",
    ...(evidenceLines.length
      ? evidenceLines
      : ["- 暂无派发证据，请回到待处理发现补充判断。"]),
    "",
    "## 近期情报",
    ...(itemLines.length ? itemLines : ["- 暂无近期情报对象。"]),
  ].join("\n");
}

export function IntelligenceReportsWorkbench() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const requestedReportId = (searchParams.get("reportId") || "").trim();
  const [overview, setOverview] = useState<IntelligenceOverview | null>(null);
  const [items, setItems] = useState<IntelligenceItem[]>([]);
  const [records, setRecords] = useState(emptyRecords);
  const [range, setRange] = useState<RangeKey>("7d");
  const [selected, setSelected] = useState<ReportKind>("daily");
  const [draft, setDraft] = useState<DraftReport | null>(null);
  const [reports, setReports] = useState<IntelligenceReport[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionKey, setActionKey] = useState("");

  const writeFocusedReportToUrl = useCallback(
    (reportId: string) => {
      const params = new URLSearchParams(currentSearch);
      params.set("reportId", reportId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [currentSearch, pathname, router],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const from = rangeFrom(range);
      const [
        overviewResult,
        itemsResult,
        risksResult,
        leadsResult,
        accountsResult,
        rulesResult,
        reportsResult,
      ] = await Promise.all([
        intelligenceApi.overview({ from, limit: 12 }),
        intelligenceApi.listItems({ from, page: 1, limit: 30 }),
        intelligenceApi.listDispatchRecords("risks", { page: 1, limit: 20 }),
        intelligenceApi.listDispatchRecords("leads", { page: 1, limit: 20 }),
        intelligenceApi.listDispatchRecords("accounts", { page: 1, limit: 20 }),
        intelligenceApi.listDispatchRecords("rules", { page: 1, limit: 20 }),
        intelligenceApi.listReports({ page: 1, limit: 8 }),
      ]);
      setOverview(overviewResult);
      setItems(itemsResult.items);
      setRecords({
        accounts: accountsResult.items,
        leads: leadsResult.items,
        risks: risksResult.items,
        rules: rulesResult.items,
      });
      let focusedReport = requestedReportId
        ? reportsResult.items.find((report) => report.id === requestedReportId) || null
        : null;
      let focusedReportMessage = "";
      if (requestedReportId && !focusedReport) {
        try {
          focusedReport = await intelligenceApi.getReport(requestedReportId);
        } catch (error) {
          focusedReportMessage = toPublicError(
            error,
            "链接指定的报告暂时无法读取，请返回报告历史重新选择。",
          );
        }
      }
      setReports(
        focusedReport
          ? [
              focusedReport,
              ...reportsResult.items.filter((report) => report.id !== focusedReport?.id),
            ].slice(0, 8)
          : reportsResult.items,
      );
      if (focusedReport) {
        setDraft(reportToDraft(focusedReport));
        const focusedKind = reportKind(focusedReport.kind);
        if (focusedKind) setSelected(focusedKind);
        focusedReportMessage = `已定位报告：${focusedReport.title}`;
      }
      setMessage(focusedReportMessage);
    } catch (error) {
      setMessage(toPublicError(error, "报告数据暂时无法读取，请重新加载。"));
    } finally {
      setLoading(false);
    }
  }, [range, requestedReportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const focusReport = useCallback(
    (report: IntelligenceReport) => {
      setDraft(reportToDraft(report));
      const focusedKind = reportKind(report.kind);
      if (focusedKind) setSelected(focusedKind);
      setMessage(`已定位报告：${report.title}`);
      writeFocusedReportToUrl(report.id);
    },
    [writeFocusedReportToUrl],
  );

  const template = useMemo(
    () =>
      reportTemplates.find((item) => item.key === selected) ||
      reportTemplates[0],
    [selected],
  );
  const selectedRecords = useMemo(
    () => reportRecords(selected, records),
    [records, selected],
  );
  const selectedItems = useMemo(() => {
    if (selected === "risk") {
      return items.filter((item) => item.status.includes("risk")).slice(0, 10);
    }
    if (selected === "competitor") {
      return items
        .filter(
          (item) =>
            item.type.includes("account") || item.type.includes("viral"),
        )
        .slice(0, 10);
    }
    if (selected === "opportunity") {
      return items
        .filter(
          (item) =>
            item.topicId || item.materialId || item.type.includes("comment"),
        )
        .slice(0, 10);
    }
    return items.slice(0, 10);
  }, [items, selected]);
  const findings = useMemo(
    () => buildFindings(selected, overview, selectedItems, selectedRecords),
    [overview, selected, selectedItems, selectedRecords],
  );
  const completeness = Math.min(
    100,
    30 +
      selectedRecords.length * 10 +
      selectedItems.length * 3 +
      (overview?.metrics.generatedTopics ?? 0) * 2,
  );

  const metrics = useMemo(
    () => [
      {
        label: "可交付报告",
        value: String(reportTemplates.length),
        detail: "日报、竞品、机会、风险",
        icon: FileText,
        tone: "neutral" as Tone,
      },
      {
        label: "证据对象",
        value: String(selectedRecords.length),
        detail: "已派发记录可追溯",
        icon: ClipboardList,
        tone: selectedRecords.length
          ? ("success" as Tone)
          : ("warning" as Tone),
      },
      {
        label: "近期情报",
        value: String(items.length),
        detail: "来自待处理发现和自动跟踪",
        icon: BarChart3,
        tone: items.length ? ("success" as Tone) : ("neutral" as Tone),
      },
      {
        label: "完整度",
        value: `${completeness}%`,
        detail: completeness >= 80 ? "可交付" : "需补证",
        icon: CheckCircle2,
        tone: completeness >= 80 ? ("success" as Tone) : ("warning" as Tone),
      },
    ],
    [completeness, items.length, selectedRecords.length],
  );

  async function generateDraft() {
    const nextFindings = buildFindings(
      selected,
      overview,
      selectedItems,
      selectedRecords,
    );
    const markdown = buildMarkdown(
      template,
      nextFindings,
      selectedRecords,
      selectedItems,
    );
    const nextDraft: DraftReport = {
      id: `${selected}-${Date.now()}`,
      title: template.title,
      createdAt: new Date().toISOString(),
      markdown,
      findings: nextFindings,
      evidence: [
        ...selectedRecords.slice(0, 6).map((record) => record.title),
        ...selectedItems.slice(0, 4).map((item) => item.title),
      ],
    };
    setDraft(nextDraft);
    setSaving(true);
    setMessage("");
    try {
      const saved = await intelligenceApi.createReport({
        kind: selected,
        title: template.title,
        audience: template.audience,
        owner: template.owner,
        rangeKey: range,
        status: "draft",
        completeness,
        findings: nextFindings,
        evidence: nextDraft.evidence,
        markdown,
        metadata: {
          targetHref: template.href,
          dispatchRecordIds: selectedRecords.map((record) => record.id),
          intelligenceItemIds: selectedItems.map((item) => item.id),
        },
      });
      setDraft({ ...nextDraft, id: saved.id, createdAt: saved.createdAt });
      setReports((current) =>
        [saved, ...current.filter((item) => item.id !== saved.id)].slice(0, 8),
      );
      setMessage("报告已保存到历史，可提交复核或交付。");
      writeFocusedReportToUrl(saved.id);
    } catch (error) {
      setMessage(toPublicError(error, "报告未保存，请重试。"));
    } finally {
      setSaving(false);
    }
  }

  async function runReportAction(
    report: IntelligenceReport,
    action: IntelligenceReportAction,
  ) {
    const key = `${report.id}:${action}`;
    setActionKey(key);
    setMessage("");
    try {
      const result = await intelligenceApi.processReport(report.id, {
        action,
        note: `${reportActionLabel(action)}：${report.title}`,
      });
      setReports((current) =>
        current.map((item) => (item.id === report.id ? result.report : item)),
      );
      if (draft?.id === report.id) {
        setDraft({
          id: result.report.id,
          title: result.report.title,
          createdAt: result.report.createdAt,
          markdown: result.report.markdown,
          findings: result.report.findings,
          evidence: result.report.evidence,
        });
      }
      setMessage(result.message);
    } catch (error) {
      setMessage(toPublicError(error, "报告操作未完成，请重试。"));
    } finally {
      setActionKey("");
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="kaypal-v3-panel overflow-hidden">
        <div className="border-b border-[var(--kaypal-v3-border)] p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="flex min-w-0 items-start gap-3">
              <span className="kaypal-v3-icon-tile shrink-0">
                <FileText
                  aria-hidden="true"
                  className="h-5 w-5"
                  strokeWidth={1.8}
                />
              </span>
              <div className="min-w-0">
                <p className="kaypal-v3-label">交付物</p>
                <h1 className="mt-1 kx-greet text-[var(--kaypal-v3-ink)]">
                  报告中心
                </h1>
                <p className="mt-1 max-w-4xl text-13 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  把情报对象、派发记录、用量和风险沉淀成可交付报告。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              {rangeOptions.map((item) => {
                const active = range === item.key;
                return (
                  <button
                    aria-pressed={active}
                    className={[
                      "h-10 rounded-[8px] border px-3 text-13 font-semibold transition",
                      active
                        ? "border-[var(--kaypal-v3-accent)] bg-[var(--kaypal-v3-accent-soft)] text-[var(--kaypal-v3-accent-ink)]"
                        : "border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] text-[var(--kaypal-v3-muted)] hover:border-[var(--kaypal-v3-border-strong)]",
                    ].join(" ")}
                    key={item.key}
                    onClick={() => setRange(item.key)}
                    type="button"
                  >
                    {item.label}
                  </button>
                );
              })}
              <button
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-4 text-13 font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
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
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
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

      <section className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">报告模板</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              选择交付口径
            </h2>
          </div>
          <div className="grid gap-2 p-3">
            {reportTemplates.map((item) => {
              const active = selected === item.key;
              const TemplateIcon = item.icon;
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
                  onClick={() => setSelected(item.key)}
                  type="button"
                >
                  <div className="flex items-start gap-2">
                    <TemplateIcon
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                      strokeWidth={1.8}
                    />
                    <div className="min-w-0">
                      <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {item.title}
                      </p>
                      <p className="mt-1 text-11 leading-4 text-[var(--kaypal-v3-muted)]">
                        {item.audience}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                    {item.detail}
                  </p>
                </button>
              );
            })}
          </div>
        </article>

        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="kaypal-v3-label">报告预览</p>
                <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
                  {template.title}
                </h2>
              </div>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving}
                onClick={() => void generateDraft()}
                type="button"
              >
                {saving ? (
                  <Loader2
                    aria-hidden="true"
                    className="h-3.5 w-3.5 animate-spin"
                    strokeWidth={1.8}
                  />
                ) : (
                  <FileText
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    strokeWidth={1.8}
                  />
                )}
                生成并保存
              </button>
            </div>
          </div>

          <div className="grid gap-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              {[
                ["受众", template.audience],
                ["负责人", template.owner],
                ["完整度", `${completeness}%`],
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
              <p className="kaypal-v3-label">核心结论</p>
              <div className="mt-3 grid gap-2">
                {findings.map((finding) => (
                  <div className="flex gap-2" key={finding}>
                    <CheckCircle2
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kaypal-v3-accent)]"
                      strokeWidth={1.8}
                    />
                    <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                      {finding}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {draft ? (
              <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="kaypal-v3-label">
                      {requestedReportId === draft.id ? "当前报告" : "已生成预览"}
                    </p>
                    <p className="mt-1 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                      {draft.title}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-11 font-semibold text-[var(--kaypal-v3-muted)]">
                    <Clock3 aria-hidden="true" className="h-3 w-3" />
                    {formatTime(draft.createdAt)}
                  </span>
                </div>
                <pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] p-3 text-11 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                  {draft.markdown}
                </pre>
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                <p className="text-13 font-bold text-[var(--kaypal-v3-ink)]">
                  等待生成报告预览
                </p>
                <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                  生成后会展示 Markdown 结构、证据对象和近期情报。
                </p>
              </div>
            )}

            {message ? (
              <p className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3 text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                {message}
              </p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">证据包</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              可追溯对象
            </h2>
          </div>
          <div className="divide-y divide-[var(--kaypal-v3-border)]">
            {selectedRecords.length ? (
              selectedRecords.slice(0, 10).map((record) => (
                <Link
                  className="block p-4 transition hover:bg-[var(--kaypal-v3-paper-soft)]"
                  href={record.href || "/intelligence/inbox"}
                  key={record.id}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={[
                            "rounded-[6px] border px-2 py-0.5 text-11 font-semibold text-[var(--kaypal-v3-soft-ink)]",
                            toneClass(riskTone(record.risk)),
                          ].join(" ")}
                        >
                          {riskLabel(record.risk)}
                        </span>
                        <span className="text-11 text-[var(--kaypal-v3-muted)]">
                          {record.platform} · {record.owner}
                        </span>
                      </div>
                      <p className="mt-2 truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                        {record.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                        {recordEvidence(record)}
                      </p>
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-[var(--kaypal-v3-muted)]"
                      strokeWidth={1.8}
                    />
                  </div>
                </Link>
              ))
            ) : (
              <div className="p-4">
                <div className="rounded-[8px] border border-dashed border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-4">
                  <ClipboardList
                    aria-hidden="true"
                    className="h-5 w-5 text-[var(--kaypal-v3-muted)]"
                    strokeWidth={1.8}
                  />
                  <p className="mt-2 text-13 font-bold text-[var(--kaypal-v3-ink)]">
                    当前模板缺少派发证据
                  </p>
                  <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                    先从待处理发现、风险、线索或对标账号补齐证据。
                  </p>
                </div>
              </div>
            )}
          </div>
        </article>

        <aside className="kaypal-v3-panel min-w-0 overflow-hidden">
          <div className="border-b border-[var(--kaypal-v3-border)] p-4">
            <p className="kaypal-v3-label">交付队列</p>
            <h2 className="mt-1 text-base font-bold text-[var(--kaypal-v3-ink)]">
              报告历史
            </h2>
          </div>
          <div className="grid gap-2 p-4">
            {reports.length ? (
              reports.map((item) => {
                const targetHref =
                  typeof item.metadata.targetHref === "string"
                    ? item.metadata.targetHref
                    : "/intelligence/reports";
                const primaryAction: IntelligenceReportAction =
                  item.status === "draft"
                    ? "submit_review"
                    : item.status === "in_review"
                      ? "mark_delivered"
                      : item.status === "delivered"
                        ? "archive"
                        : "reopen";
                const busy = actionKey === `${item.id}:${primaryAction}`;
                return (
                  <div
                    className={[
                      "rounded-[8px] border bg-[var(--kaypal-v3-paper)] p-3 transition hover:border-[var(--kaypal-v3-border-strong)]",
                      requestedReportId === item.id
                        ? "border-[var(--kaypal-v3-accent)] ring-1 ring-[var(--kaypal-v3-accent)]/20"
                        : "border-[var(--kaypal-v3-border)]",
                    ].join(" ")}
                    id={`intelligence-report-${item.id}`}
                    key={item.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-13 font-bold text-[var(--kaypal-v3-ink)]">
                            {item.title}
                          </p>
                          <span
                            className={[
                              "rounded-[6px] border px-2 py-0.5 text-11 font-semibold",
                              toneClass(reportStatusTone(item.status)),
                            ].join(" ")}
                          >
                            {reportStatusLabel(item.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-12 leading-5 text-[var(--kaypal-v3-muted)]">
                          证据 {item.evidence.length} 条，完整度{" "}
                          {item.completeness}% · {formatTime(item.updatedAt)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]"
                        onClick={() => focusReport(item)}
                        type="button"
                      >
                        查看报告
                        <FileText aria-hidden="true" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-3 text-12 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(actionKey)}
                        onClick={() =>
                          void runReportAction(item, primaryAction)
                        }
                        type="button"
                      >
                        {busy ? (
                          <Loader2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 animate-spin"
                            strokeWidth={1.8}
                          />
                        ) : (
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            strokeWidth={1.8}
                          />
                        )}
                        {reportActionLabel(primaryAction)}
                      </button>
                      <Link
                        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)]"
                        href={targetHref}
                      >
                        查看去向
                        <ArrowRight
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                          strokeWidth={1.8}
                        />
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <FunctionalEmptyState
                actions={[
                  { href: "/intelligence/inbox", label: "待处理发现" },
                  { href: "/intelligence/monitors", label: "自动跟踪" },
                ]}
                description="选择报告模板并生成预览后，草稿、复核和交付记录会进入这里。报告只能引用已入库或已派发的证据对象。"
                examples={["今日简报", "竞品周报", "机会报告", "风险报告"]}
                icon={FileText}
                surface="plain"
                title="当前没有生成记录"
              />
            )}
          </div>
          <div className="border-t border-[var(--kaypal-v3-border)] p-4">
            <div className="rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper-soft)] p-3">
              <p className="text-12 leading-5 text-[var(--kaypal-v3-soft-ink)]">
                报告只能引用已入库或已派发的证据对象；高风险内容必须保留审核结论。
              </p>
              <Link
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-[8px] border border-[var(--kaypal-v3-border)] bg-[var(--kaypal-v3-paper)] px-3 text-12 font-semibold text-[var(--kaypal-v3-soft-ink)] transition hover:border-[var(--kaypal-v3-border-strong)] hover:text-[var(--kaypal-v3-ink)]"
                href="/intelligence/inbox"
              >
                回到待处理发现
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={1.8}
                />
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
