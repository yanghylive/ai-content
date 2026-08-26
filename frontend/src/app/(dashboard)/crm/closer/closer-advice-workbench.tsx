"use client";

import React from "react";
import Link from "next/link";
import {
  V2StatusChip,
  V2GhostButton,
  V2PrimaryButton,
} from "@/components/v2/ui-kit";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clipboard,
  Copy,
  DatabaseZap,
  FileText,
  Gauge,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import toast from "@/lib/toast";
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { getCrmAppState } from "@/lib/api/app-market";
import { api } from "@/lib/api/client";
import { SkeletonList, SkeletonText, SkeletonCard, SkeletonLine, SkeletonCircle } from "@/components/skeleton";

type ChipColor = "accent" | "success" | "warning" | "danger" | "muted";

function isChipColor(value: unknown): value is ChipColor {
  return (
    value === "accent" ||
    value === "success" ||
    value === "warning" ||
    value === "danger" ||
    value === "muted"
  );
}

interface CloserMetric {
  label?: string;
  value?: string | number;
  tone?: ChipColor;
}

interface CloserFollowUp {
  id?: string;
  customerId?: string;
  customerName?: string;
  displayName?: string;
  companyName?: string | null;
  title?: string | null;
  priority?: string;
  urgency?: string;
  reason?: string;
  why?: string;
  suggestedAction?: string;
  action?: string;
  howToFollow?: string;
  script?: unknown;
  suggestedScript?: unknown;
  talkTrack?: unknown;
  risk?: string;
  riskPoint?: string;
  nextTask?: unknown;
  nextStep?: unknown;
  dueAt?: string | null;
  confidence?: number;
  evidence?: unknown;
  sources?: unknown;
  sourceRefs?: unknown;
}

interface CloserRiskCustomer {
  id?: string;
  customerId?: string;
  customerName?: string;
  title?: string;
  targetName?: string;
  companyName?: string | null;
  riskLevel?: string;
  level?: string;
  riskReason?: string;
  reason?: string;
  recommendedAction?: string;
  action?: string;
  owner?: string | null;
  valueAtRiskCents?: number;
  amountCents?: number;
  evidence?: unknown;
  sources?: unknown;
}

interface CloserOpportunityMove {
  id?: string;
  opportunityId?: string;
  opportunityName?: string;
  name?: string;
  customerName?: string | null;
  companyName?: string | null;
  stage?: string;
  amountCents?: number;
  probability?: number;
  blocker?: string;
  obstacle?: string;
  nextStep?: string;
  suggestedAction?: string;
  suggestedMessage?: string;
  evidence?: unknown;
  sources?: unknown;
}

interface CloserScript {
  id?: string;
  title?: string;
  channel?: string;
  audience?: string;
  customerName?: string;
  goal?: unknown;
  objection?: string;
  text?: unknown;
  script?: unknown;
  content?: unknown;
}

interface CloserDailyReport {
  title?: string;
  summary?: string;
  highlights?: string[];
  risks?: string[];
  actions?: string[];
  blockers?: string[];
  text?: string;
}

interface CloserAdviceResponse {
  generatedAt?: string;
  model?: string;
  owner?: string;
  summary?: string;
  metrics?: CloserMetric[];
  todayFollowUps?: CloserFollowUp[];
  followUps?: CloserFollowUp[];
  followUpRecommendations?: CloserFollowUp[];
  riskCustomers?: CloserRiskCustomer[];
  risks?: CloserRiskCustomer[];
  opportunityMoves?: CloserOpportunityMove[];
  opportunityAdvices?: CloserOpportunityMove[];
  opportunities?: CloserOpportunityMove[];
  scripts?: CloserScript[];
  talkTracks?: CloserScript[];
  copyableScripts?: CloserScript[];
  managerDailyReport?: CloserDailyReport | string;
  managerReport?: CloserDailyReport | string;
  dailyReport?: CloserDailyReport | string;
}

function getCrmCloserAdvice() {
  return api.get<CloserAdviceResponse>("/crm/closer/advice");
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMoney(cents?: number | null) {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPercent(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const normalized = value > 1 ? value : value * 100;
  return `${Math.round(normalized)}%`;
}

function itemKey(prefix: string, index: number, id?: string) {
  return id || `${prefix}-${index}`;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join("\n");
  }

  const record = toRecord(value);
  if (!record) return "";

  const orderedKeys = [
    "text",
    "content",
    "script",
    "opener",
    "discovery",
    "valuePoint",
    "close",
    "title",
    "label",
    "name",
    "action",
    "summary",
  ];
  return orderedKeys
    .map((key) => textValue(record[key]))
    .filter(Boolean)
    .join("\n");
}

function textOrDash(value?: unknown) {
  const text = textValue(value);
  return text || "-";
}

function priorityColor(priority?: string): ChipColor {
  const normalized = (priority || "").toLowerCase();
  if (["high", "urgent", "p0", "p1", "高", "紧急"].includes(normalized)) {
    return "danger";
  }
  if (["medium", "normal", "p2", "中", "普通"].includes(normalized)) {
    return "warning";
  }
  return "accent";
}

function riskColor(level?: string): ChipColor {
  const normalized = (level || "").toLowerCase();
  if (["high", "critical", "danger", "高", "严重"].includes(normalized)) {
    return "danger";
  }
  if (["medium", "warning", "中"].includes(normalized)) {
    return "warning";
  }
  return "success";
}

function labelPriority(priority?: string) {
  const normalized = (priority || "").toLowerCase();
  if (["high", "urgent", "p0", "p1"].includes(normalized)) return "高优先";
  if (["medium", "normal", "p2"].includes(normalized)) return "中优先";
  if (["low", "p3"].includes(normalized)) return "低优先";
  return priority || "AI 推荐";
}

function labelRisk(level?: string) {
  const normalized = (level || "").toLowerCase();
  if (["high", "critical", "danger"].includes(normalized)) return "高风险";
  if (["medium", "warning"].includes(normalized)) return "中风险";
  if (["low", "safe"].includes(normalized)) return "低风险";
  return level || "待观察";
}

function toRecord(value: unknown) {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      const record = toRecord(item);
      if (!record) return "";
      const candidate =
        record.label || record.title || record.name || record.id || record.url;
      return typeof candidate === "string" ? candidate.trim() : "";
    })
    .filter(Boolean);
}

function evidenceList(...values: unknown[]) {
  return values.flatMap(toStringArray).slice(0, 4);
}

function followUpCustomer(item: CloserFollowUp) {
  return item.customerName || item.displayName || "未命名客户";
}

function followUpReason(item: CloserFollowUp) {
  return textOrDash(item.reason || item.why);
}

function followUpAction(item: CloserFollowUp) {
  return textOrDash(item.suggestedAction || item.action || item.howToFollow);
}

function followUpScript(item: CloserFollowUp) {
  return textOrDash(item.script || item.suggestedScript || item.talkTrack);
}

function managerReportToText(report?: CloserDailyReport | string) {
  if (!report) return "";
  if (typeof report === "string") return report;

  const lines: string[] = [];
  if (report.title) lines.push(report.title);
  if (report.summary || report.text)
    lines.push(report.summary || report.text || "");

  const sections: Array<[string, string[] | undefined]> = [
    ["亮点", report.highlights],
    ["风险", report.risks],
    ["今日动作", report.actions],
    ["阻塞", report.blockers],
  ];

  sections.forEach(([title, items]) => {
    if (!items?.length) return;
    lines.push(`${title}:`);
    items.forEach((item) => lines.push(`- ${item}`));
  });

  return lines.filter(Boolean).join("\n");
}

function normalizeReport(
  report?: CloserDailyReport | string,
): CloserDailyReport {
  if (!report) return {};
  if (typeof report === "string") return { text: report };
  return report;
}

async function copyText(value: string, message = "已复制到剪贴板") {
  const text = value.trim();
  if (!text || text === "-") {
    toast.error("暂无可复制内容");
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}

export function CloserAdviceWorkbench() {
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [installed, setInstalled] = React.useState(false);
  const [advice, setAdvice] = React.useState<CloserAdviceResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeFollowUpId, setActiveFollowUpId] = React.useState<string | null>(
    null,
  );

  const loadAdvice = React.useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError(null);

    try {
      const appState = await getCrmAppState();
      setInstalled(Boolean(appState.installed));
      if (!appState.installed) {
        setAdvice(null);
        return;
      }

      const nextAdvice = await getCrmCloserAdvice();
      setAdvice(nextAdvice);
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "加载成交建议失败";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    loadAdvice("initial");
  }, [loadAdvice]);

  const followUps = React.useMemo(
    () =>
      advice?.todayFollowUps ||
      advice?.followUps ||
      advice?.followUpRecommendations ||
      [],
    [advice],
  );
  const riskCustomers = React.useMemo(
    () => advice?.riskCustomers || advice?.risks || [],
    [advice],
  );
  const opportunityMoves = React.useMemo(
    () =>
      advice?.opportunityMoves ||
      advice?.opportunityAdvices ||
      advice?.opportunities ||
      [],
    [advice],
  );
  const scripts = React.useMemo(
    () =>
      advice?.scripts || advice?.talkTracks || advice?.copyableScripts || [],
    [advice],
  );

  React.useEffect(() => {
    if (!followUps.length) {
      setActiveFollowUpId(null);
      return;
    }

    const hasActive = followUps.some((item, index) => {
      const key = itemKey("follow", index, item.id || item.customerId);
      return key === activeFollowUpId;
    });
    if (!hasActive) {
      const first = followUps[0];
      setActiveFollowUpId(itemKey("follow", 0, first.id || first.customerId));
    }
  }, [activeFollowUpId, followUps]);

  const selectedFollowUp =
    followUps.find((item, index) => {
      const key = itemKey("follow", index, item.id || item.customerId);
      return key === activeFollowUpId;
    }) ||
    followUps[0] ||
    null;

  const managerReport = normalizeReport(
    advice?.managerDailyReport || advice?.managerReport || advice?.dailyReport,
  );
  const managerReportText = managerReportToText(
    advice?.managerDailyReport || advice?.managerReport || advice?.dailyReport,
  );
  const metricItems: CloserMetric[] = advice?.metrics?.length
    ? advice.metrics.map((metric) => ({
        ...metric,
        tone: isChipColor(metric.tone) ? metric.tone : "muted",
      }))
    : [
        { label: "今日跟进", value: followUps.length, tone: "accent" },
        { label: "风险客户", value: riskCustomers.length, tone: "danger" },
        { label: "推进商机", value: opportunityMoves.length, tone: "warning" },
        { label: "可复制话术", value: scripts.length, tone: "success" },
      ];

  if (loading && !advice) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 rounded-[8px] border border-default-200 bg-content1 px-4 py-3 shadow-sm">
          <SkeletonList rows={5} />
          <span className="text-sm text-default-500">
            成交助手正在读取 CRM 数据...
          </span>
        </div>
      </div>
    );
  }

  if (!installed) {
    return (
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
        <header className="kaypal-v3-page-header p-5">
          <V2StatusChip tone="warning">
            <DatabaseZap size={14} /> CRM 未安装
          </V2StatusChip>
          <h1 className="mt-3">Kaypal 成交助手</h1>
          <p className="mt-2 text-sm leading-6 text-default-500">
            成交助手需要读取 CRM Lite 的联系人、任务、商机和时间线，安装 CRM
            后才能生成 AI 销售跟进建议。
          </p>
          <Link
            href="/apps"
            className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--kaypal-v3-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--kaypal-v3-accent-ink)]"
          >
            去应用市场安装 CRM
            <ArrowRight size={16} />
          </Link>
        </header>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1460px] flex-col gap-3 pb-8 text-13">
      <header className="kaypal-v3-page-header flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <V2StatusChip tone="accent">
              <Bot size={14} /> 成交助手
            </V2StatusChip>
            <V2StatusChip tone="warning">
              <ShieldAlert size={14} /> AI 建议，需人工判断
            </V2StatusChip>
            {advice?.model ? <V2StatusChip>{advice.model}</V2StatusChip> : null}
          </div>
          <h1 className="mt-2">Kaypal 成交助手工作台</h1>
          <p className="mt-1 text-sm text-default-500">
            从 CRM 数据生成今日跟进、风险预警、商机推进、可复制话术和经理日报。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <V2GhostButton
            icon={RefreshCw}
            loading={refreshing}
            onClick={() => loadAdvice("refresh")}
          >
            刷新建议
          </V2GhostButton>
          <V2PrimaryButton
            icon={Clipboard}
            onClick={() => copyText(managerReportText, "经理日报已复制")}
          >
            复制日报
          </V2PrimaryButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {metricItems.slice(0, 4).map((metric, index) => (
          <Metric
            key={`${metric.label || "metric"}-${index}`}
            label={metric.label || "指标"}
            value={metric.value ?? "-"}
            tone={metric.tone || "muted"}
          />
        ))}
      </div>

      {error ? (
        <FailureActionPanel
          actions={[
            {
              label: "刷新建议",
              onPress: () => {
                void loadAdvice("refresh");
              },
            },
            { href: "/crm", label: "CRM 客户" },
            { href: "/crm/import", label: "导入线索" },
          ]}
          impact="今日跟进队列、风险客户、商机推进和经理日报暂时无法生成。"
          nextAction="先刷新建议；仍失败时检查 CRM 是否有客户、商机、任务和互动时间线。"
          reason="成交建议暂时无法生成，可能是 CRM 数据、商用授权或互动记录还没准备好。"
          technicalDetails={error}
          title="成交建议需要处理"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.45fr_0.75fr]">
        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                今日 AI 跟进队列
              </h2>
              <p className="text-xs text-default-500">
                按任务、互动、客户状态和商机信号排序；不会自动外发消息。
              </p>
            </div>
            <V2StatusChip tone="accent">
              {formatDate(advice?.generatedAt)} 生成
            </V2StatusChip>
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="p-0">
            <div className="overflow-x-auto">
              <FollowUpTable
                followUps={followUps}
                activeId={activeFollowUpId}
                onSelect={setActiveFollowUpId}
              />
            </div>
          </div>
        </section>

        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex items-center justify-between p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                选中客户 Copilot
              </h2>
              <p className="text-xs text-default-500">
                原因、动作、话术和证据源。
              </p>
            </div>
            <Sparkles className="h-4 w-4 text-primary" />
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="flex flex-col gap-3 p-3">
            {selectedFollowUp ? (
              <SelectedFollowUpPanel followUp={selectedFollowUp} />
            ) : (
              <EmptyState label="暂无今日跟进建议" />
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex items-center justify-between p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                风险客户
              </h2>
              <p className="text-xs text-default-500">
                流失、沉睡、异议和高价值拖延信号。
              </p>
            </div>
            <ShieldAlert className="h-4 w-4 text-danger" />
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="p-0">
            <RiskCustomerList risks={riskCustomers} />
          </div>
        </section>

        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex items-center justify-between p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                机会推进建议
              </h2>
              <p className="text-xs text-default-500">
                下一步、阻塞点、成交概率和建议触达口径。
              </p>
            </div>
            <Target className="h-4 w-4 text-warning" />
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="p-0">
            <OpportunityMoveTable moves={opportunityMoves} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex items-center justify-between p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                可复制话术
              </h2>
              <p className="text-xs text-default-500">
                给销售直接复制，发送前保留人工确认。
              </p>
            </div>
            <MessageSquareText className="h-4 w-4 text-success" />
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="flex max-h-[420px] flex-col gap-2 overflow-auto p-3">
            {scripts.length ? (
              scripts.map((script, index) => (
                <ScriptBlock
                  key={itemKey("script", index, script.id)}
                  script={script}
                />
              ))
            ) : selectedFollowUp ? (
              <ScriptBlock
                script={{
                  title: `${followUpCustomer(selectedFollowUp)} 跟进话术`,
                  channel: "微信/电话",
                  text: followUpScript(selectedFollowUp),
                  goal: selectedFollowUp.nextTask || selectedFollowUp.nextStep,
                }}
              />
            ) : (
              <EmptyState label="暂无可复制话术" />
            )}
          </div>
        </section>

        <section className="kaypal-v3-panel overflow-hidden">
          <header className="flex items-center justify-between p-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
                经理日报
              </h2>
              <p className="text-xs text-default-500">
                用于晨会、复盘和团队风险同步。
              </p>
            </div>
            <V2GhostButton
              icon={Copy}
              onClick={() => copyText(managerReportText, "经理日报已复制")}
            >
              复制
            </V2GhostButton>
          </header>
          <hr className="border-[var(--kaypal-v3-border)]" />
          <div className="flex flex-col gap-3 p-3">
            <ManagerReportPanel report={managerReport} />
          </div>
        </section>
      </div>
    </div>
  );
}

function FollowUpTable({
  followUps,
  activeId,
  onSelect,
}: {
  followUps: CloserFollowUp[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <table className="w-full min-w-[980px] border-collapse text-left">
      <thead className="bg-default-50 text-12 font-semibold text-default-500">
        <tr>
          <th className="px-3 py-2">优先级</th>
          <th className="px-3 py-2">客户</th>
          <th className="px-3 py-2">为什么跟</th>
          <th className="px-3 py-2">AI 建议动作</th>
          <th className="px-3 py-2">下一步</th>
          <th className="px-3 py-2 text-right">操作</th>
        </tr>
      </thead>
      <tbody>
        {followUps.length ? (
          followUps.map((item, index) => {
            const key = itemKey("follow", index, item.id || item.customerId);
            const selected = activeId === key;
            return (
              <tr
                key={key}
                className={`border-t border-default-100 hover:bg-default-50 ${
                  selected ? "bg-primary-50/50" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <V2StatusChip
                   
                   
                    tone={priorityColor(item.priority || item.urgency)}
                  >
                    {labelPriority(item.priority || item.urgency)}
                  </V2StatusChip>
                  {item.confidence !== undefined ? (
                    <div className="mt-1 text-11 text-default-400">
                      置信 {formatPercent(item.confidence)}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-left font-semibold text-[var(--kaypal-v3-ink)]"
                    onClick={() => onSelect(key)}
                  >
                    {followUpCustomer(item)}
                  </button>
                  <div className="text-xs text-default-400">
                    {item.companyName || item.title || "-"}
                  </div>
                </td>
                <td className="max-w-[300px] px-3 py-2 text-default-600">
                  <div className="line-clamp-2">{followUpReason(item)}</div>
                </td>
                <td className="max-w-[300px] px-3 py-2 text-default-600">
                  <div className="line-clamp-2">{followUpAction(item)}</div>
                </td>
                <td className="max-w-[240px] px-3 py-2 text-default-600">
                  <div className="line-clamp-2">
                    {textOrDash(item.nextTask || item.nextStep)}
                  </div>
                  <div className="text-xs text-default-400">
                    {formatDate(item.dueAt)}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <V2GhostButton
                      icon={Gauge}
                      onClick={() => onSelect(key)}
                    >
                      查看
                    </V2GhostButton>
                    <V2GhostButton
                      icon={Copy}
                      onClick={() =>
                        copyText(followUpScript(item), "跟进话术已复制")
                      }
                    >
                      复制
                    </V2GhostButton>
                  </div>
                </td>
              </tr>
            );
          })
        ) : (
          <EmptyTableRow colSpan={6} label="暂无今日跟进建议" />
        )}
      </tbody>
    </table>
  );
}

function SelectedFollowUpPanel({ followUp }: { followUp: CloserFollowUp }) {
  const evidence = evidenceList(
    followUp.evidence,
    followUp.sources,
    followUp.sourceRefs,
  );

  return (
    <>
      <div className="rounded-[8px] border border-default-200 bg-content2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[var(--kaypal-v3-ink)]">
              {followUpCustomer(followUp)}
            </h3>
            <p className="text-xs text-default-500">
              {followUp.companyName || followUp.title || "CRM 客户"}
            </p>
          </div>
          <V2StatusChip
           
           
            tone={priorityColor(followUp.priority || followUp.urgency)}
          >
            {labelPriority(followUp.priority || followUp.urgency)}
          </V2StatusChip>
        </div>
      </div>
      <InfoBlock icon={<Sparkles size={14} />} label="为什么跟">
        {followUpReason(followUp)}
      </InfoBlock>
      <InfoBlock icon={<Target size={14} />} label="怎么跟">
        {followUpAction(followUp)}
      </InfoBlock>
      <InfoBlock icon={<MessageSquareText size={14} />} label="建议话术">
        <div className="flex flex-col gap-2">
          <p>{followUpScript(followUp)}</p>
          <V2GhostButton
            icon={Copy}
            onClick={() => copyText(followUpScript(followUp), "跟进话术已复制")}
          >
            复制话术
          </V2GhostButton>
        </div>
      </InfoBlock>
      <InfoBlock icon={<AlertTriangle size={14} />} label="风险点">
        {textOrDash(followUp.risk || followUp.riskPoint)}
      </InfoBlock>
      <InfoBlock icon={<CheckCircle2 size={14} />} label="下一步任务">
        {textOrDash(followUp.nextTask || followUp.nextStep)}
      </InfoBlock>
      <div className="rounded-[8px] border border-default-200 bg-content1 p-3">
        <div className="text-xs font-semibold text-default-500">数据来源</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {evidence.length ? (
            evidence.map((item) => (
              <V2StatusChip
                key={item}
               
               
               
              >
                {item}
              </V2StatusChip>
            ))
          ) : (
            <span className="text-xs text-default-400">
              正在读取客户、商机、任务或时间线证据。
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function RiskCustomerList({ risks }: { risks: CloserRiskCustomer[] }) {
  if (!risks.length) {
    return <EmptyState label="暂无风险客户" />;
  }

  return (
    <div className="divide-y divide-default-100">
      {risks.map((risk, index) => {
        const evidence = evidenceList(risk.evidence, risk.sources);
        return (
          <div
            key={itemKey("risk", index, risk.id || risk.customerId)}
            className="p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                  {risk.customerName ||
                    risk.targetName ||
                    risk.title ||
                    risk.companyName ||
                    "未命名客户"}
                </div>
                <div className="text-xs text-default-400">
                  {risk.companyName || risk.owner || "-"}
                </div>
              </div>
              <V2StatusChip
               
               
                tone={riskColor(risk.riskLevel || risk.level)}
              >
                {labelRisk(risk.riskLevel || risk.level)}
              </V2StatusChip>
            </div>
            <p className="mt-2 text-sm leading-6 text-default-600">
              {textOrDash(risk.riskReason || risk.reason)}
            </p>
            <div className="mt-2 rounded-[8px] bg-default-50 p-2 text-xs leading-5 text-default-600">
              建议：{textOrDash(risk.recommendedAction || risk.action)}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {risk.valueAtRiskCents || risk.amountCents ? (
                <V2StatusChip tone="warning">
                  风险金额{" "}
                  {formatMoney(risk.valueAtRiskCents || risk.amountCents)}
                </V2StatusChip>
              ) : null}
              {evidence.map((item) => (
                <V2StatusChip
                  key={item}
                 
                 
                 
                >
                  {item}
                </V2StatusChip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpportunityMoveTable({ moves }: { moves: CloserOpportunityMove[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead className="bg-default-50 text-12 font-semibold text-default-500">
          <tr>
            <th className="px-3 py-2">商机</th>
            <th className="px-3 py-2">阶段/金额</th>
            <th className="px-3 py-2">阻塞点</th>
            <th className="px-3 py-2">推进动作</th>
            <th className="px-3 py-2 text-right">话术</th>
          </tr>
        </thead>
        <tbody>
          {moves.length ? (
            moves.map((move, index) => (
              <tr
                key={itemKey("move", index, move.id || move.opportunityId)}
                className="border-t border-default-100 hover:bg-default-50"
              >
                <td className="px-3 py-2">
                  <div className="font-semibold text-[var(--kaypal-v3-ink)]">
                    {move.opportunityName || move.name || "未命名商机"}
                  </div>
                  <div className="text-xs text-default-400">
                    {move.companyName || move.customerName || "-"}
                  </div>
                </td>
                <td className="px-3 py-2 text-default-600">
                  <V2StatusChip tone="accent">
                    {move.stage || "待推进"}
                  </V2StatusChip>
                  <div className="mt-1 text-xs text-default-400">
                    {formatMoney(move.amountCents)} · 胜率{" "}
                    {formatPercent(move.probability)}
                  </div>
                </td>
                <td className="max-w-[220px] px-3 py-2 text-default-600">
                  <div className="line-clamp-2">
                    {textOrDash(move.blocker || move.obstacle)}
                  </div>
                </td>
                <td className="max-w-[260px] px-3 py-2 text-default-600">
                  <div className="line-clamp-2">
                    {textOrDash(move.nextStep || move.suggestedAction)}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <V2GhostButton
                    icon={Copy}
                    onClick={() =>
                      copyText(
                        move.suggestedMessage || move.suggestedAction || "",
                        "商机推进话术已复制",
                      )
                    }
                  >
                    复制
                  </V2GhostButton>
                </td>
              </tr>
            ))
          ) : (
            <EmptyTableRow colSpan={5} label="暂无机会推进建议" />
          )}
        </tbody>
      </table>
    </div>
  );
}

function ScriptBlock({ script }: { script: CloserScript }) {
  const text = textOrDash(script.text || script.script || script.content);

  return (
    <div className="rounded-[8px] border border-default-200 bg-content2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-[var(--kaypal-v3-ink)]">
            {script.title || script.customerName || "销售跟进话术"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {script.channel ? (
              <V2StatusChip tone="accent">
                {script.channel}
              </V2StatusChip>
            ) : null}
            {script.goal ? (
              <V2StatusChip>
                {textOrDash(script.goal)}
              </V2StatusChip>
            ) : null}
            {script.objection ? (
              <V2StatusChip tone="warning">
                异议：{script.objection}
              </V2StatusChip>
            ) : null}
          </div>
        </div>
        <V2GhostButton
          icon={Copy}
          onClick={() => copyText(text, "话术已复制")}
        >
          复制
        </V2GhostButton>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-default-700">
        {text}
      </p>
    </div>
  );
}

function ManagerReportPanel({ report }: { report: CloserDailyReport }) {
  const hasStructuredContent =
    Boolean(report.summary || report.text) ||
    Boolean(report.highlights?.length) ||
    Boolean(report.risks?.length) ||
    Boolean(report.actions?.length) ||
    Boolean(report.blockers?.length);

  if (!hasStructuredContent) {
    return <EmptyState label="暂无经理日报" />;
  }

  return (
    <>
      {report.title || report.summary || report.text ? (
        <div className="rounded-[8px] border border-default-200 bg-content2 p-3">
          <div className="font-semibold text-[var(--kaypal-v3-ink)]">
            {report.title || "今日销售日报"}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-default-600">
            {report.summary || report.text || "-"}
          </p>
        </div>
      ) : null}
      <ReportSection
        title="亮点"
        icon={<CheckCircle2 size={14} />}
        items={report.highlights}
        tone="success"
      />
      <ReportSection
        title="风险"
        icon={<AlertTriangle size={14} />}
        items={report.risks}
        tone="danger"
      />
      <ReportSection
        title="今日动作"
        icon={<Target size={14} />}
        items={report.actions}
        tone="accent"
      />
      <ReportSection
        title="阻塞"
        icon={<ShieldAlert size={14} />}
        items={report.blockers}
        tone="warning"
      />
    </>
  );
}

function ReportSection({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  items?: string[];
  tone: ChipColor;
}) {
  if (!items?.length) return null;

  return (
    <div className="rounded-[8px] border border-default-200 bg-content1 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-default-500">
        <V2StatusChip
         
          tone={tone}
         
         
        >
          {icon}
        </V2StatusChip>
        {title}
      </div>
      <ul className="space-y-1 text-sm leading-6 text-default-700">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-default-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoBlock({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-content1 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-default-500">
        {icon}
        {label}
      </div>
      <div className="text-sm leading-6 text-[var(--kaypal-v3-ink)]">
        {children}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number | string;
  tone?: ChipColor;
}) {
  return (
    <div className="rounded-[8px] border border-default-200 bg-content1 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-11 font-semibold text-default-500">
          {label}
        </div>
        <V2StatusChip
         
         
          tone={tone}
         
        >
          AI
        </V2StatusChip>
      </div>
      <div className="mt-1 truncate text-xl font-bold text-[var(--kaypal-v3-ink)]">
        {value}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  const meta = getCloserEmptyMeta(label);
  return (
    <FunctionalEmptyState
      actions={meta.actions}
      description={meta.description}
      examples={meta.examples}
      icon={FileText}
      surface="plain"
      title={meta.title}
    />
  );
}

function EmptyTableRow({ colSpan, label }: { colSpan: number; label: string }) {
  const meta = getCloserEmptyMeta(label);
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-6">
        <FunctionalEmptyState
          actions={meta.actions}
          description={meta.description}
          examples={meta.examples}
          icon={FileText}
          surface="plain"
          title={meta.title}
        />
      </td>
    </tr>
  );
}

function getCloserEmptyMeta(label: string) {
  const map: Record<
    string,
    {
      actions: Array<{ href?: string; label: string }>;
      description: string;
      examples: string[];
      title: string;
    }
  > = {
    暂无今日跟进建议: {
      actions: [
        { href: "/crm", label: "CRM 客户" },
        { href: "/crm/import", label: "导入线索" },
        { href: "/engagement", label: "客户互动" },
      ],
      description:
        "今日还没有可排序的跟进对象。先补充客户、商机、任务或互动记录，系统才有依据生成建议。",
      examples: ["客户资料", "互动时间线", "跟进任务", "商机阶段"],
      title: "当前没有跟进建议",
    },
    暂无可复制话术: {
      actions: [
        { href: "/crm", label: "CRM 客户" },
        { href: "/engagement", label: "客户互动" },
      ],
      description:
        "没有选中客户或缺少客户上下文时，系统不会生成可直接复制的话术。",
      examples: ["选中客户", "客户背景", "最近回复", "人工确认"],
      title: "当前没有可复制话术",
    },
    暂无风险客户: {
      actions: [
        { href: "/crm", label: "CRM 客户" },
        { href: "/tasks", label: "任务中心" },
      ],
      description:
        "当前没有识别到流失、沉睡、异议或高价值拖延信号。继续沉淀互动记录后再复盘。",
      examples: ["流失风险", "异议", "沉睡客户", "高价值拖延"],
      title: "当前没有风险客户",
    },
    暂无机会推进建议: {
      actions: [
        { href: "/crm", label: "CRM 商机" },
        { href: "/growth?view=leads", label: "增长线索" },
      ],
      description:
        "当前没有可推进的商机。先补充商机阶段、金额、阻塞点和下一步动作。",
      examples: ["阶段", "金额", "阻塞点", "下一步"],
      title: "当前没有商机推进建议",
    },
    暂无经理日报: {
      actions: [
        { href: "/crm", label: "CRM 客户" },
	        { href: "/tasks/records", label: "任务记录" },
      ],
      description:
        "日报需要客户、任务、商机和互动数据作为输入。数据不足时先补齐业务记录。",
      examples: ["跟进队列", "风险客户", "商机推进", "团队复盘"],
      title: "当前没有经理日报",
    },
  };
  return (
    map[label] || {
      actions: [{ href: "/crm", label: "CRM 客户" }],
      description: "当前模块还没有可展示的数据，可以先补充 CRM 业务记录。",
      examples: ["客户", "商机", "任务", "互动"],
      title: label,
    }
  );
}
