"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  Chip,
  Input,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  addToast,
} from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import {
  buildLocalEngineRiskConfirmation,
  localEngineApi,
  type AgentConfirmation,
  type AgentSession,
  type InteractionTask,
  type LocalEngineBrowserStatus,
  type LocalEngineCapability,
  type LocalEngineExecutorsStatus,
  type LocalEngineActionBlocker,
  type LocalEngineFailureContext,
  type LocalEngineHealth,
  type LocalEngineReadiness,
} from "@/lib/api/local-engine";
import {
  AgentSStatusPanel,
  type AgentSTimelineEvent,
} from "@/components/agent-s-status-panel";
import { AgentSessionLifecycleStepper } from "@/components/agent-session-lifecycle-stepper";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { toPublicError } from "@/lib/public-error";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import { AgentConversationWorkbench } from "./agent-conversation-workbench";
import { V2BackButton } from "@/components/v2/v2-back-button";

const statusColor: Record<
  AgentSession["status"],
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  draft: "default",
  running: "primary",
  waiting_for_confirmation: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "default",
};

const confirmationSourceHref: Record<AgentSession["source"], string> = {
  "agent-console": "/tasks/records",
  publishing: "/distribution?tab=article",
  interaction: "/engagement/records",
  system: "/local-engine?tab=engine",
  web: "/tasks",
};

const confirmationSourceLabel: Record<AgentSession["source"], string> = {
  "agent-console": "任务历史",
  publishing: "发布中心",
  interaction: "客户互动",
  system: "系统任务",
  web: "网页指令",
};

function agentSessionRecordHref(sessionId?: string | null) {
  if (!sessionId || sessionId.startsWith("interaction-task:")) {
    return "/tasks/records";
  }
  return `/tasks/records?sessionId=${encodeURIComponent(sessionId)}`;
}

function confirmationRecordHref(item: AgentConfirmation) {
  return agentSessionRecordHref(item.session?.id || item.sessionId);
}

function formatAgentDateTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const agentStatusFilterOptions: Array<{
  key: "all" | AgentSession["status"];
  label: string;
}> = [
  { key: "all", label: "全部状态" },
  { key: "running", label: "运行中" },
  { key: "waiting_for_confirmation", label: "待确认" },
  { key: "completed", label: "已完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "已停止" },
];

const agentSourceFilterOptions: Array<{
  key: "all" | AgentSession["source"];
  label: string;
}> = [
  { key: "all", label: "全部来源" },
  { key: "agent-console", label: "任务历史" },
  { key: "publishing", label: "发布中心" },
  { key: "interaction", label: "客户互动" },
  { key: "system", label: "系统任务" },
];

const evidenceTypeName: Record<string, string> = {
  text: "文本",
  snapshot: "页面记录",
  screenshot: "浏览器截图",
  page_snapshot: "页面记录",
  desktop_screenshot: "桌面截图",
  stage_log: "步骤记录",
  failure_reason: "失败原因",
  diagnostic_bundle: "诊断凭证",
  file: "文件",
};

function commercialCapabilityLabel(value?: string | null) {
  const labels: Record<string, string> = {
    "local-engine": "自动化服务",
    "browser-control": "浏览器操作",
    executor: "处理服务",
    "permission-check": "权限检查",
    "risk-policy": "风险规则",
  };
  return commercialDisplayText(
    labels[String(value || "")] || String(value || "").replace(/-/g, " "),
  );
}

function commercialAgentText(value?: string | null) {
  return commercialDisplayText(
    String(value || "")
      .replace(/本地引擎/g, "自动化服务")
      .replace(/local-engine/gi, "自动化服务")
      .replace(/引擎/g, "服务")
      .replace(/\bready\b/gi, "可用"),
  );
}

function displayEventTitle(value?: string | null) {
  return commercialAgentText(value || "事件");
}

function displayEventMessage(value?: string | null) {
  return commercialAgentText(value || "");
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFailureContext(context: LocalEngineFailureContext) {
  return [
    context.platform ? `平台：${context.platform}` : null,
    context.account ? `账号：${context.account}` : null,
    context.target ? `对象：${context.target}` : null,
    context.stage ? `阶段：${context.stage}` : null,
    `原因：${context.reason}`,
    context.nextAction ? `下一步：${context.nextAction}` : null,
  ]
    .filter(Boolean)
    .join("；");
}

function normalizeAgentSession(session: AgentSession): AgentSession {
  return {
    ...session,
    events: Array.isArray(session.events) ? session.events : [],
    steps: Array.isArray(session.steps) ? session.steps : [],
    blockers: Array.isArray(session.blockers) ? session.blockers : [],
    requiredChecks: Array.isArray(session.requiredChecks)
      ? session.requiredChecks
      : [],
  };
}

function getSessionEvents(session: AgentSession) {
  return Array.isArray(session.events) ? session.events : [];
}

function isCurrentTaskSession(session: AgentSession) {
  if (
    session.status === "running" ||
    session.status === "waiting_for_confirmation" ||
    session.status === "failed" ||
    session.status === "draft"
  ) {
    return true;
  }
  return Boolean(
    session.resumeAction &&
    session.status !== "cancelled" &&
    session.status !== "completed",
  );
}

function formatEvidenceStage(value?: string | null) {
  const labels: Record<string, string> = {
    "create-task": "创建任务",
    "target-read": "读取对象",
    environment: "运行环境",
    "open-entry": "打开平台后台",
    "send-reply": "发送回复",
    readback: "结果确认",
  };
  return labels[String(value || "")] || commercialAgentText(value || "");
}

function previewEvidenceValue(value?: string | null) {
  const normalized = commercialAgentText(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "-";
  if (
    /\/Users\/|file:\/\/|screenshot|\.png|\.jpg|\.jpeg|\.webp|\.json/i.test(
      normalized,
    )
  ) {
    return "记录已保存，可在需要时打开查看。";
  }
  return normalized.length > 160
    ? `${normalized.slice(0, 160)}...`
    : normalized;
}

function deriveSessionFailureContext(
  session: AgentSession,
): LocalEngineFailureContext | null {
  if (session.failureContext) return session.failureContext;
  if (!session.failureReason && session.status !== "failed") return null;
  const failedEvent = [...getSessionEvents(session)]
    .reverse()
    .find((event) => event.level === "error");
  return {
    platform: session.targetApp || confirmationSourceLabel[session.source],
    account:
      session.source === "agent-console"
        ? "任务历史"
        : confirmationSourceLabel[session.source],
    target: session.targetUrl || session.title,
    stage: failedEvent?.evidence?.stageKey || failedEvent?.title || "执行阶段",
    reason: session.failureReason || failedEvent?.message || "执行失败",
    nextAction:
      session.nextAction || "查看事件时间线，修正账号/权限/对象后重试或停止。",
  };
}

export function AgentConsolePage() {
  return (
    <AgentShell
      title="Agent 工作台"
      description="多轮对话、模型协作与本机助手执行"
      icon="solar:magic-stick-3-linear"
    >
      <AgentConversationWorkbench />
    </AgentShell>
  );
}

export function ConfirmationsPage() {
  const [items, setItems] = React.useState<AgentConfirmation[]>([]);
  const [pendingTasks, setPendingTasks] = React.useState<InteractionTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState("");
  const [confirmedChecksById, setConfirmedChecksById] = React.useState<
    Record<string, Record<string, boolean>>
  >({});

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      // 两个数据源：①互动任务-等待发送确认（客服/消息流创建的）
      // ②agent 高风险确认（发布等高风险动作的确认令牌）
      const [confirmations, allTasks] = await Promise.all([
        localEngineApi.confirmations(),
        localEngineApi.tasks(50).catch(() => [] as InteractionTask[]),
      ]);
      const pendingConfirmations = confirmations.filter(
        (item) => item.status === "pending",
      );
      setItems(pendingConfirmations);
      setPendingTasks(
        (Array.isArray(allTasks) ? allTasks : []).filter(
          (t) => t.status === "waiting_for_send_confirmation",
        ),
      );
    } catch (error: unknown) {
      addToast({
        title: "待确认读取失败",
        description: toPublicError(
          error,
          "待确认任务暂时无法读取，请稍后重试。",
        ),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // 互动任务的确认发送（approveTask，支持人工改过的草稿）
  const approveTask = async (task: InteractionTask) => {
    setBusyId(task.id);
    try {
      // 风险确认：等级必须和任务自身 riskLevel 一致（后端校验"等级不匹配"）
      await localEngineApi.approveTask(task.id, {
        operator: "当前用户",
        contentConfirmed: true,
        targetConfirmed: true,
        checklistConfirmed: true,
        commercialPermissionConfirmed: true,
        misfireProtectionConfirmed: true,
        currentWindowConfirmed: true,
        contactConfirmed: true,
        draftBeforeFillConfirmed: true,
        riskConfirmation: buildLocalEngineRiskConfirmation(
          "interaction-approval",
          task.riskLevel || "medium",
          `用户确认发送回复：${task.targetName || task.id}`,
        ),
      });
      await refresh();
      addToast({ title: "已确认，开始发送", color: "success" });
    } catch (error: unknown) {
      addToast({
        title: "确认失败",
        description: toPublicError(error, "确认操作未完成，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  const decide = async (item: AgentConfirmation, approved: boolean) => {
    if (approved && isConfirmationBlocked(item)) {
      addToast({
        title: "确认需处理",
        description:
          getConfirmationBlockers(item)[0]?.nextAction ||
          "请先处理权限或账号限制。",
        color: "warning",
      });
      return;
    }
    setBusyId(item.id);
    try {
      const confirmedChecks = confirmedChecksById[item.id] || {};
      if (approved) {
        await localEngineApi.approveConfirmation(item.id, {
          operator: "当前用户",
          confirmedChecks,
          riskConfirmation: {
            ...buildLocalEngineRiskConfirmation(
              "agent-confirmation-approve",
              item.riskLevel,
              item.description || item.actionLabel,
            ),
            fullPermission: false,
          },
        });
      } else {
        await localEngineApi.rejectConfirmation(item.id, {
          operator: "当前用户",
          note: "用户拒绝继续执行",
        });
      }
      await refresh();
      addToast({
        title: approved ? "已确认继续" : "已拒绝执行",
        color: approved ? "success" : "warning",
      });
    } catch (error: unknown) {
      addToast({
        title: "操作失败",
        description: toPublicError(error, "确认操作未完成，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  /* 移动端（<768px）：明德 VP 风格，复用同一批 state/handlers */
  const isMobile = useIsMobile();
  if (isMobile) {
    const riskBadge = (level: string) =>
      level === "critical" || level === "high" ? "mx-badge mx-badge-red"
        : level === "medium" ? "mx-badge mx-badge-gold"
          : "mx-badge mx-badge-blue";
    const riskText = (level: string) =>
      level === "critical" ? "高危" : level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div>
              <div className="mx-brand-eyebrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 .304.377l6.001 4.1a.5.5 0 0 1-.29.908l-6.985.49a1 1 0 0 0-.673.42l-3.45 4.8a.5.5 0 0 1-.84 0l-3.45-4.8a1 1 0 0 0-.673-.42l-6.985-.49a.5.5 0 0 1-.29-.908l6.001-4.1a1 1 0 0 0 .304-.377z" /></svg>
                JIUZHANG AI
              </div>
              <h1 className="mx-page-title">待我确认</h1>
              <p className="mx-page-sub">以下动作需要你确认后才能继续</p>
            </div>
            <button type="button" className="mx-control" aria-label="刷新" style={{ width: 40, height: 40, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#16335d", flexShrink: 0 }} onClick={() => void refresh()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" /></svg>
            </button>
          </div>
        </header>

        <section className="mx-px" style={{ marginTop: 14, paddingBottom: 28 }}>
          {loading ? (
            <div className="mx-card mx-list-card">
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : items.length === 0 && pendingTasks.length === 0 ? (
            <div className="mx-empty">
              <p>当前没有待处理确认</p>
            </div>
          ) : (
            <>
              {/* 回复待确认（互动任务） */}
              {pendingTasks.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div className="mx-section-head">
                    <div>
                      <div className="mx-section-title">
                        <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg></span>
                        回复待确认（{pendingTasks.length}）
                      </div>
                    </div>
                  </div>
                  <div className="mx-card mx-list-card">
                    {pendingTasks.map((task) => (
                      <div className="mx-row" key={task.id}>
                        <span className="mx-row-ic" style={{ background: "rgba(37,99,235,.1)", color: "#2563eb" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
                        </span>
                        <div className="mx-row-main">
                          <div className="mx-row-title">{task.targetName || "未命名客户"}</div>
                          <div className="mx-row-desc">{task.typeLabel || "客户回复"}{task.sourceText ? ` · ${task.sourceText.slice(0, 24)}` : ""}</div>
                        </div>
                        <div className="mx-row-right">
                          <button type="button" className="mx-btn-gold" style={{ fontSize: 11, padding: "7px 12px" }} disabled={busyId === task.id} onClick={() => void approveTask(task)}>确认发送</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 高风险确认（agent） */}
              {items.length > 0 ? (
                <div>
                  <div className="mx-section-head">
                    <div>
                      <div className="mx-section-title">
                        <span className="mx-sec-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg></span>
                        高风险确认（{items.length}）
                      </div>
                    </div>
                  </div>
                  <div className="mx-card mx-list-card">
                    {items.map((item) => (
                      <div className="mx-row" key={item.id}>
                        <span className="mx-row-ic" style={{ background: "rgba(239,68,68,.09)", color: "#dc2626" }}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
                        </span>
                        <div className="mx-row-main">
                          <div className="mx-row-title">{item.title}</div>
                          <div className="mx-row-desc">{item.description?.slice(0, 28) || item.actionLabel}</div>
                        </div>
                        <div className="mx-row-right">
                          <span className={riskBadge(item.riskLevel || "medium")}>{riskText(item.riskLevel || "medium")}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 12, width: "100%" }}>
                          <button type="button" className="mx-btn-gold" style={{ flex: 1, fontSize: 11, padding: "9px 0" }} disabled={busyId === item.id} onClick={() => void decide(item, true)}>确认</button>
                          <button type="button" className="mx-btn-gold" style={{ flex: 1, fontSize: 11, padding: "9px 0", background: "rgba(239,68,68,.1)", color: "#dc2626", border: "1px solid rgba(239,68,68,.25)", boxShadow: "none", backgroundImage: "none" }} disabled={busyId === item.id} onClick={() => void decide(item, false)}>拒绝</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <AgentShell
      title="待我确认"
      backHref="/mine"
      description="以下动作需要你确认后才能继续。确认后会自动执行，拒绝则取消。"
      icon="solar:check-square-linear"
      action={
        <Button variant="flat" onPress={refresh}>
          刷新
        </Button>
      }
    >
      {loading ? <LoadingBlock /> : null}
      {!loading && items.length === 0 && pendingTasks.length === 0 ? (
        <EmptyBlock
          actionHref="/distribution"
          actionLabel="去发布中心"
          text="当前没有待处理确认。需要你确认的发布、触达或高影响动作会出现在这里。"
        />
      ) : null}

      {/* 互动任务：等待发送确认（客服/消息流创建的回复） */}
      {pendingTasks.length > 0 ? (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-default-600">
            回复待确认（{pendingTasks.length}）
          </h3>
          <div className="grid gap-4">
            {pendingTasks.map((task) => (
              <Card
                key={task.id}
                className="border-small border-divider bg-background shadow-sm"
              >
                <CardBody className="gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip size="sm" variant="flat" color="primary">
                      {task.typeLabel || "客户回复"}
                    </Chip>
                    <Chip size="sm" variant="flat">
                      {task.targetName || "未命名客户"}
                    </Chip>
                    {task.accountName ? (
                      <Chip size="sm" variant="flat">
                        {task.accountName}
                      </Chip>
                    ) : null}
                  </div>
                  {task.sourceText ? (
                    <div>
                      <p className="text-xs text-default-500">客户说：</p>
                      <p className="mt-1 rounded-medium bg-default-100 p-3 text-small">
                        {task.sourceText}
                      </p>
                    </div>
                  ) : null}
                  {task.replyText ? (
                    <div>
                      <p className="text-xs text-default-500">AI 准备回复：</p>
                      <p className="mt-1 rounded-medium bg-primary-50 p-3 text-small">
                        {task.replyText}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <Button
                      color="primary"
                      isLoading={busyId === task.id}
                      onPress={() => void approveTask(task)}
                    >
                      确认发送
                    </Button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {/* 高风险动作确认（发布等） */}
      {items.length > 0 ? (
        <h3 className="mb-3 text-sm font-semibold text-default-600">
          高风险动作（{items.length}）
        </h3>
      ) : null}
      <div className="grid gap-4">
        {items.map((item) => {
          const sessionTitle = item.session?.title || item.title;
          const source =
            item.session?.source && confirmationSourceLabel[item.session.source]
              ? confirmationSourceLabel[item.session.source]
              : "任务中心";
          const sourceHref = item.session?.source
            ? confirmationSourceHref[item.session.source]
            : "/tasks";
          const selectedChecks = confirmedChecksById[item.id] || {};
          const allRequiredChecked = (item.requiredChecks || []).every(
            (check) => !check.required || selectedChecks[check.key] === true,
          );
          return (
            <Card
              key={item.id}
              className="border-small border-divider bg-background shadow-sm"
            >
              <CardBody className="gap-3">
                {getConfirmationBlockers(item).length ? (
                  <BlockerList blockers={getConfirmationBlockers(item)} />
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip size="sm" variant="flat">
                        {source}
                      </Chip>
                      {item.session?.statusLabel ? (
                        <Chip size="sm" variant="flat">
                          {item.session.statusLabel}
                        </Chip>
                      ) : null}
                      <Chip size="sm" variant="flat">
                        {formatAgentDateTime(
                          item.session?.updatedAt || item.createdAt,
                        )}
                      </Chip>
                    </div>
                    <h3 className="truncate font-semibold text-default-900">
                      {sessionTitle}
                    </h3>
                    <p className="mt-1 text-small font-semibold text-default-600">
                      确认项：{item.title}
                    </p>
                    <p className="mt-2 text-small text-default-700">
                      {item.description}
                    </p>
                    {item.session?.nextAction ? (
                      <p className="mt-2 text-tiny text-default-500">
                        下一步：{item.session.nextAction}
                      </p>
                    ) : null}
                    {item.session?.resumeAction ? (
                      <p className="mt-2 text-tiny text-warning-600">
                        续跑动作：{item.session.resumeAction.label}
                      </p>
                    ) : null}
                    {item.requiredChecks?.length ? (
                      <div className="mt-3 space-y-2 border-t border-divider pt-3">
                        {item.requiredChecks.map((check) => (
                          <Checkbox
                            key={check.key}
                            color={
                              check.status === "blocked" ? "danger" : "primary"
                            }
                            isDisabled={check.status === "blocked"}
                            isSelected={selectedChecks[check.key] === true}
                            size="sm"
                            onValueChange={(selected) =>
                              setConfirmedChecksById((current) => ({
                                ...current,
                                [item.id]: {
                                  ...(current[item.id] || {}),
                                  [check.key]: selected,
                                },
                              }))
                            }
                          >
                            {check.label}
                          </Checkbox>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      as={Link}
                      href={confirmationRecordHref(item)}
                      variant="flat"
                    >
                      查看记录
                    </Button>
                    <Button as={Link} href={sourceHref} variant="flat">
                      回来源
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={
                        item.status !== "pending" ||
                        isConfirmationBlocked(item) ||
                        !allRequiredChecked
                      }
                      isLoading={busyId === item.id}
                      onPress={() => decide(item, true)}
                    >
                      确认执行
                    </Button>
                    <Button
                      color="danger"
                      variant="flat"
                      isDisabled={item.status !== "pending"}
                      isLoading={busyId === item.id}
                      onPress={() => decide(item, false)}
                    >
                      拒绝
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </AgentShell>
  );
}

export function SessionsPage({
  mode = "sessions",
}: {
  mode?: "sessions" | "records" | "artifacts";
}) {
  const [highlightedSessionId, setHighlightedSessionId] = React.useState("");
  const [items, setItems] = React.useState<AgentSession[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [continueText, setContinueText] = React.useState("");
  const [busyId, setBusyId] = React.useState("");
  const [exportingId, setExportingId] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<
    "all" | AgentSession["status"]
  >("all");
  const [sourceFilter, setSourceFilter] = React.useState<
    "all" | AgentSession["source"]
  >("all");
  const [keyword, setKeyword] = React.useState("");

  React.useEffect(() => {
    setHighlightedSessionId(
      new URLSearchParams(window.location.search).get("sessionId") || "",
    );
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const sessions = await localEngineApi.agentSessions({
        limit: 80,
        status: statusFilter === "all" ? undefined : statusFilter,
        source: sourceFilter === "all" ? undefined : sourceFilter,
        keyword: keyword || undefined,
      });
      let normalized = (Array.isArray(sessions) ? sessions : []).map(
        normalizeAgentSession,
      );
      if (
        highlightedSessionId &&
        !normalized.some((session) => session.id === highlightedSessionId)
      ) {
        const target = await localEngineApi
          .agentSession(highlightedSessionId)
          .catch(() => null);
        if (target) {
          normalized = [normalizeAgentSession(target), ...normalized];
        }
      }
      if (mode === "sessions") {
        normalized = normalized.filter(isCurrentTaskSession);
      }
      if (highlightedSessionId) {
        normalized = [...normalized].sort((left, right) => {
          if (left.id === highlightedSessionId) return -1;
          if (right.id === highlightedSessionId) return 1;
          return (
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime()
          );
        });
      }
      setItems(normalized);
    } catch (error: unknown) {
      addToast({
        title: "任务读取失败",
        description: toPublicError(error, "任务暂时无法读取，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [highlightedSessionId, keyword, mode, sourceFilter, statusFilter]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const continueSession = async (session: AgentSession) => {
    if (session.blockers?.length) {
      addToast({
        title: "继续执行需处理",
        description: session.blockers[0].nextAction,
        color: "warning",
      });
      return;
    }
    setBusyId(session.id);
    try {
      await localEngineApi.continueAgentSession(session.id, {
        instruction: continueText || "继续执行当前任务",
        operator: "当前用户",
      });
      setContinueText("");
      await refresh();
    } catch (error: unknown) {
      addToast({
        title: "继续失败",
        description: formatFailureContext({
          platform:
            session.targetApp || confirmationSourceLabel[session.source],
          account: confirmationSourceLabel[session.source],
          target: session.title,
          stage: "继续执行",
          reason: toPublicError(error, "任务未能继续，请稍后重试。"),
          nextAction: "确认没有必须处理项；必要时先停止后重试。",
        }),
        color: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  const stopSession = async (session: AgentSession) => {
    setBusyId(session.id);
    try {
      await localEngineApi.stopAgentSession(session.id);
      await refresh();
    } catch (error: unknown) {
      addToast({
        title: "停止失败",
        description: formatFailureContext({
          platform:
            session.targetApp || confirmationSourceLabel[session.source],
          account: confirmationSourceLabel[session.source],
          target: session.title,
          stage: "停止执行",
          reason: toPublicError(error, "任务未能停止，请稍后重试。"),
          nextAction: "刷新任务状态，确认任务仍在执行后重试。",
        }),
        color: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  const exportEvidence = async (session: AgentSession) => {
    setExportingId(session.id);
    try {
      const result = await localEngineApi.exportAgentSessionEvidence(
        session.id,
      );
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title: "记录已导出",
        description: `${result.evidenceCount} 条记录`,
        color: "success",
      });
    } catch (error: unknown) {
      addToast({
        title: "记录导出失败",
        description: toPublicError(error, "任务记录未能导出，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setExportingId("");
    }
  };

  const meta = {
    sessions: {
      title: "正在运行",
      description:
        "只看当前需要处理的任务：运行中、待确认、失败和可继续执行的任务都在这里。",
      icon: "solar:dialog-2-linear",
    },
    records: {
      title: "任务历史",
      description:
        "跨发布、互动、浏览器、桌面任务的执行台账，重点看成功、失败、暂停和下一步。",
      icon: "solar:clipboard-list-linear",
    },
    artifacts: {
      title: "结果留存",
      description:
        "集中查看执行过程中留下的截图、页面记录、步骤记录、失败原因和文件记录。",
      icon: "solar:gallery-check-linear",
    },
  }[mode];

  const pendingCount = items.filter(
    (session) => session.status === "waiting_for_confirmation",
  ).length;
  const runningCount = items.filter(
    (session) => session.status === "running",
  ).length;
  const evidenceCount = items.reduce(
    (sum, session) =>
      sum + getSessionEvents(session).filter((event) => event.evidence).length,
    0,
  );
  const evidenceStats = React.useMemo(() => {
    return items.reduce<Record<string, number>>((acc, session) => {
      getSessionEvents(session).forEach((event) => {
        if (event.evidence)
          acc[event.evidence.type] = (acc[event.evidence.type] || 0) + 1;
      });
      return acc;
    }, {});
  }, [items]);

  const isMobile = useIsMobile();
  if (isMobile) {
    const statusBadgeClass = (status: AgentSession["status"]) =>
      status === "running" ? "mx-badge mx-badge-blue"
        : status === "waiting_for_confirmation" ? "mx-badge mx-badge-gold"
          : status === "completed" ? "mx-badge mx-badge-green"
            : status === "failed" ? "mx-badge mx-badge-red"
              : "mx-badge";
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ marginTop: 8 }}>
          <V2BackButton />
        </div>
        <header className="mx-header">
          <div className="mx-header-row">
            <div style={{ minWidth: 0 }}>
              <div className="mx-brand-eyebrow">JIUZHANG AI</div>
              <h1 className="mx-page-title">{meta.title}</h1>
              <p className="mx-page-sub">{meta.description}</p>
            </div>
            <Link
              href="/tasks/confirmations"
              className="mx-btn-gold"
              style={{ fontSize: 12, padding: "8px 12px", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              待确认 {pendingCount}
            </Link>
          </div>
        </header>

        <div className="mx-px" style={{ paddingTop: 14, paddingBottom: 28 }}>
          {/* 统计 */}
          <div className="mx-stat-grid">
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num">{items.length}</div>
              <div className="mx-stat-label">任务</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num mx-gold-text">{runningCount}</div>
              <div className="mx-stat-label">运行中</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num" style={{ color: "#b45309" }}>{pendingCount}</div>
              <div className="mx-stat-label">待确认</div>
            </div>
            <div className="mx-stat-item mx-control">
              <div className="mx-stat-num" style={{ color: "#059669" }}>{evidenceCount}</div>
              <div className="mx-stat-label">结果留存</div>
            </div>
          </div>

          {/* 筛选 */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ flex: 1, padding: "9px 10px", borderRadius: 11, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}
            >
              {agentStatusFilterOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
              style={{ flex: 1, padding: "9px 10px", borderRadius: 11, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 12.5 }}
            >
              {agentSourceFilterOptions.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="mx-btn-gold"
              style={{ fontSize: 11.5, padding: "7px 12px" }}
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按指令、标题或目标应用搜索"
            style={{ width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 11, border: "1px solid rgba(142,165,190,.3)", background: "rgba(255,255,255,.06)", color: "var(--mx-ink)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
          />

          {/* 任务列表 */}
          {loading ? (
            <div className="mx-card mx-list-card" style={{ marginTop: 12 }}>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "70%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
              <div className="mx-skeleton-row"><span className="mx-skeleton mx-skeleton-ic" /><div style={{ flex: 1 }}><div className="mx-skeleton mx-skeleton-line" style={{ width: "58%" }} /><div className="mx-skeleton mx-skeleton-line mx-skeleton-line-sm" style={{ marginTop: 7 }} /></div></div>
            </div>
          ) : items.length === 0 ? (
            <div className="mx-card mx-empty" style={{ marginTop: 12 }}>
              <p>{mode === "sessions" ? "当前没有运行中、待确认或失败任务" : "暂无任务历史"}</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {items.map((session) => (
                <div
                  key={session.id}
                  className="mx-card"
                  style={{
                    padding: 14,
                    border: session.id === highlightedSessionId ? "1.5px solid #2563eb" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="mx-row-title" style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
                      {commercialAgentText(session.title)}
                    </span>
                    <span className={statusBadgeClass(session.status)}>
                      {commercialAgentText(session.statusLabel)}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--mx-muted)" }}>
                    {confirmationSourceLabel[session.source] || session.source} · {formatAgentDateTime(session.createdAt)}
                    {session.targetApp ? ` · ${session.targetApp}` : ""}
                  </div>

                  {/* 下一步 / 失败原因 */}
                  {session.failureReason ? (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "#dc2626", background: "rgba(239,68,68,.07)", borderRadius: 10, padding: "8px 10px", lineHeight: 1.6 }}>
                      失败原因：{commercialAgentText(session.failureReason)}
                    </div>
                  ) : null}
                  {session.nextAction ? (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "#b45309", background: "rgba(245,158,11,.09)", borderRadius: 10, padding: "8px 10px", lineHeight: 1.6 }}>
                      下一步：{commercialAgentText(session.nextAction)}
                    </div>
                  ) : null}
                  {session.resumeAction ? (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: "#b45309", background: "rgba(245,158,11,.09)", borderRadius: 10, padding: "8px 10px", lineHeight: 1.6 }}>
                      确认后继续：{commercialAgentText(session.resumeAction.label)}
                    </div>
                  ) : null}

                  {/* 操作 */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {mode === "sessions" ? (
                      <>
                        <button
                          type="button"
                          style={{ fontSize: 11, padding: "6px 10px", borderRadius: 9, background: "rgba(37,99,235,.1)", color: "#2563eb", border: "none" }}
                          disabled={
                            busyId === session.id ||
                            session.status === "completed" ||
                            session.status === "cancelled" ||
                            Boolean(session.blockers?.length)
                          }
                          onClick={() => void continueSession(session)}
                        >
                          {busyId === session.id ? "执行中…" : "继续执行"}
                        </button>
                        <button
                          type="button"
                          style={{ fontSize: 11, padding: "6px 10px", borderRadius: 9, background: "rgba(239,68,68,.08)", color: "#dc2626", border: "1px solid rgba(239,68,68,.2)" }}
                          disabled={session.status === "completed" || session.status === "cancelled"}
                          onClick={() => void stopSession(session)}
                        >
                          停止
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      style={{ fontSize: 11, padding: "6px 10px", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)" }}
                      disabled={exportingId === session.id}
                      onClick={() => void exportEvidence(session)}
                    >
                      {exportingId === session.id ? "导出中…" : "导出记录"}
                    </button>
                    <Link
                      href={confirmationSourceHref[session.source]}
                      style={{ fontSize: 11, padding: "6px 10px", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--mx-ink)", border: "1px solid rgba(142,165,190,.3)", textDecoration: "none" }}
                    >
                      回来源
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <AgentShell
      title={meta.title}
      backHref="/mine"
      description={meta.description}
      icon={meta.icon}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            as={Link}
            href="/tasks/confirmations"
            color={pendingCount ? "warning" : "default"}
            variant="flat"
          >
            待确认 {pendingCount}
          </Button>
          <Button variant="flat" onPress={refresh}>
            刷新
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="任务" value={items.length} />
        <MetricCard label="运行中" value={runningCount} />
        <MetricCard label="待确认" value={pendingCount} />
        <MetricCard label="结果留存" value={evidenceCount} />
      </div>{" "}
      {mode === "artifacts" ? (
        <Card className="border-small border-divider bg-background shadow-sm">
          <CardBody>
            <div className="grid gap-2 md:grid-cols-5">
              <StatusPill
                label="浏览器截图"
                value={evidenceStats.screenshot || 0}
              />
              <StatusPill
                label="页面记录"
                value={
                  (evidenceStats.page_snapshot || 0) +
                  (evidenceStats.snapshot || 0)
                }
              />
              <StatusPill
                label="桌面截图"
                value={evidenceStats.desktop_screenshot || 0}
              />
              <StatusPill
                label="步骤记录"
                value={evidenceStats.stage_log || 0}
              />
              <StatusPill
                label="失败原因"
                value={evidenceStats.failure_reason || 0}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody>
          <div className="grid gap-3 md:grid-cols-[180px_180px_1fr_auto] md:items-end">
            <Select
              label="状态"
              selectedKeys={[statusFilter]}
              size="sm"
              onSelectionChange={(keys) =>
                setStatusFilter(Array.from(keys)[0] as typeof statusFilter)
              }
            >
              {agentStatusFilterOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
            <Select
              label="来源"
              selectedKeys={[sourceFilter]}
              size="sm"
              onSelectionChange={(keys) =>
                setSourceFilter(Array.from(keys)[0] as typeof sourceFilter)
              }
            >
              {agentSourceFilterOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
            <Input
              label="搜索"
              placeholder="按指令、标题或目标应用搜索"
              size="sm"
              value={keyword}
              onValueChange={setKeyword}
            />
            <Button
              color="primary"
              isLoading={loading}
              size="sm"
              onPress={refresh}
            >
              应用筛选
            </Button>
          </div>
        </CardBody>
      </Card>
      {mode === "artifacts" && !loading ? (
        <ArtifactsTable
          items={items}
          onExport={exportEvidence}
          exportingId={exportingId}
        />
      ) : null}
      {loading ? <LoadingBlock /> : null}
      {!loading && items.length === 0 ? (
        <EmptyBlock
          actionHref="/distribution"
          actionLabel="去发布中心"
          text={
            mode === "sessions"
              ? "当前没有正在运行、待确认或失败待处理任务。"
              : "暂无任务历史。完成发布、互动或检查后，这里会展示过程、结果和下一步。"
          }
        />
      ) : null}
      <div className="grid gap-4">
        {items.map((session) => (
          <Card
            key={session.id}
            className={`border-small shadow-sm ${
              session.id === highlightedSessionId
                ? "border-primary/50 bg-primary/5"
                : "border-divider bg-background"
            }`}
          >
            <CardBody className="gap-4">
              {session.id === highlightedSessionId ? (
                <div className="flex flex-wrap items-center gap-2 rounded-[8px] border-small border-primary/30 bg-background px-3 py-2 text-small text-primary">
                  <Icon icon="solar:pin-list-linear" width={16} />
                  当前打开的任务历史
                </div>
              ) : null}
              <SessionHeader session={session} />
              <AgentSessionLifecycleStepper compact session={session} />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  isLoading={exportingId === session.id}
                  startContent={
                    exportingId === session.id ? null : (
                      <Icon icon="solar:download-minimalistic-linear" />
                    )
                  }
                  onPress={() => exportEvidence(session)}
                >
                  导出记录
                </Button>
                <Button
                  as={Link}
                  href="/tasks/confirmations"
                  size="sm"
                  variant="flat"
                >
                  待我确认
                </Button>
                <Button
                  as={Link}
                  href={confirmationSourceHref[session.source]}
                  size="sm"
                  variant="flat"
                >
                  回来源
                </Button>
              </div>
              {session.resumeAction ? (
                <div className="rounded-[8px] border-small border-warning-200 bg-warning-50 p-3 text-small text-warning-700">
                  <div className="flex items-center gap-2 font-semibold">
                    <Icon icon="solar:play-circle-linear" />
                    <span>
                      确认后继续处理：
                      {commercialAgentText(session.resumeAction.label)}
                    </span>
                  </div>
                  <p className="mt-1">
                    类型：
                    {session.resumeAction.kind === "auto-upload-publish"
                      ? "本机执行服务继续发布"
                      : "运营助理内容交接"}
                    {session.resumeAction.kind === "auto-upload-publish"
                      ? `；任务数：${session.resumeAction.payloads.length}`
                      : "；批准后进入内容库，不会自动发布"}
                  </p>
                </div>
              ) : null}
              {mode === "sessions" ? (
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    className="flex-1"
                    placeholder="补充指令，例如：只生成草稿，不要发送"
                    value={continueText}
                    onValueChange={setContinueText}
                  />
                  <Button
                    color="primary"
                    isDisabled={
                      session.status === "completed" ||
                      session.status === "cancelled" ||
                      Boolean(session.blockers?.length)
                    }
                    isLoading={busyId === session.id}
                    onPress={() => continueSession(session)}
                  >
                    继续执行
                  </Button>
                  <Button
                    color="danger"
                    variant="flat"
                    isDisabled={
                      session.status === "completed" ||
                      session.status === "cancelled"
                    }
                    onPress={() => stopSession(session)}
                  >
                    停止
                  </Button>
                </div>
              ) : null}
              <EventTimeline
                session={session}
                artifactsOnly={mode === "artifacts"}
              />
              <AgentSStatusPanel
                sidecar={{ status: "ready", label: "任务服务" }}
                session={{
                  status:
                    session.status === "waiting_for_confirmation"
                      ? "waiting_approval"
                      : session.status === "draft"
                        ? "idle"
                        : (session.status as
                            "running" | "completed" | "failed" | "cancelled"),
                  label: session.title || "任务",
                  sessionId: session.id,
                }}
                events={getSessionEvents(session).map(
                  (event): AgentSTimelineEvent => ({
                    id: event.id,
                    title: displayEventTitle(event.title),
                    detail: displayEventMessage(event.message) || undefined,
                    timestampLabel: event.createdAt
                      ? new Date(event.createdAt).toLocaleString()
                      : undefined,
                    status:
                      event.level === "success"
                        ? "completed"
                        : event.level === "error"
                          ? "failed"
                          : event.level === "warning"
                            ? "blocked"
                            : "completed",
                  }),
                )}
                timelineTitle={session.title || "任务时间线"}
              />
            </CardBody>
          </Card>
        ))}
      </div>
    </AgentShell>
  );
}

export function SimpleFeaturePage({
  title,
  description,
  icon,
  items,
  capabilityKey,
  localEngineTab = "engine",
  primaryAction,
  secondaryActions,
  children,
}: {
  title: string;
  description: string;
  icon: string;
  items: string[];
  capabilityKey?: LocalEngineCapability["key"];
  localEngineTab?:
    | "engine"
    | "browser"
    | "desktop"
    | "files"
    | "permissions"
    | "tasks"
    | "remote"
    | "evidence"
    | "logs";
  primaryAction?: {
    label: string;
    href: string;
    icon?: string;
  };
  secondaryActions?: Array<{
    label: string;
    href: string;
    icon?: string;
  }>;
  children?: React.ReactNode;
}) {
  const actions = secondaryActions || [
    {
      label: "设备状态",
      href: "/local-engine?tab=engine",
      icon: "solar:monitor-linear",
    },
    {
      label: "平台账号",
      href: "/distribution?tab=accounts",
      icon: "solar:user-id-linear",
    },
    {
      label: "任务历史",
      href: "/tasks/records",
      icon: "solar:clipboard-list-linear",
    },
  ];
  return (
    <AgentShell
      title={title}
      description={description}
      icon={icon}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            as={Link}
            href={primaryAction?.href || "/tasks/records"}
            color="primary"
            startContent={
              <Icon icon={primaryAction?.icon || "solar:play-circle-linear"} />
            }
            variant="flat"
          >
            {primaryAction?.label || "查看记录"}
          </Button>
          <Button
            as={Link}
            href="/distribution?tab=accounts"
            color="default"
            variant="flat"
          >
            平台账号
          </Button>
        </div>
      }
    >
      <CapabilityOperationsPanel
        capabilityKey={capabilityKey}
        localEngineTab={localEngineTab}
        title={title}
      />
      <Card className="border-small border-divider bg-background shadow-sm">
        <CardBody>
          <div className="grid gap-3 md:grid-cols-3">
            {actions.map((action) => (
              <Button
                key={action.href}
                as={Link}
                href={action.href}
                startContent={action.icon ? <Icon icon={action.icon} /> : null}
                variant="flat"
              >
                {action.label}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <Card
            key={item}
            className="border-small border-divider bg-background shadow-sm"
          >
            <CardBody className="flex-row items-start gap-3">
              <Icon
                className="mt-0.5 text-primary"
                icon="solar:check-circle-linear"
                width={20}
              />
              <p className="text-small text-default-600">{item}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      {children}
    </AgentShell>
  );
}

function CapabilityOperationsPanel({
  capabilityKey,
  localEngineTab,
  title,
}: {
  capabilityKey?: LocalEngineCapability["key"];
  localEngineTab: string;
  title: string;
}) {
  const [health, setHealth] = React.useState<LocalEngineHealth | null>(null);
  const [browserStatus, setBrowserStatus] =
    React.useState<LocalEngineBrowserStatus | null>(null);
  const [executorsStatus, setExecutorsStatus] =
    React.useState<LocalEngineExecutorsStatus | null>(null);
  const [readiness, setReadiness] = React.useState<LocalEngineReadiness | null>(
    null,
  );
  const [sessions, setSessions] = React.useState<AgentSession[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyAction, setBusyAction] = React.useState<
    "retry" | "stop" | "export" | "refresh" | null
  >(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [
        nextHealth,
        nextBrowserStatus,
        nextExecutorsStatus,
        nextReadiness,
        nextSessions,
      ] = await Promise.all([
        localEngineApi.health().catch(() => null),
        localEngineApi.browserStatus().catch(() => null),
        localEngineApi.executorsStatus().catch(() => null),
        localEngineApi.readiness().catch(() => null),
        localEngineApi.agentSessions(40).catch(() => [] as AgentSession[]),
      ]);
      setHealth(nextHealth);
      setBrowserStatus(nextBrowserStatus);
      setExecutorsStatus(nextExecutorsStatus);
      setReadiness(nextReadiness);
      setSessions(
        (Array.isArray(nextSessions) ? nextSessions : []).map(
          normalizeAgentSession,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const capability = React.useMemo(() => {
    if (!capabilityKey) return null;
    return (
      health?.capabilities.find((item) => item.key === capabilityKey) || null
    );
  }, [capabilityKey, health]);

  const failedSession = sessions.find((session) => session.status === "failed");
  const runningSession = sessions.find(
    (session) =>
      session.status === "running" ||
      session.status === "waiting_for_confirmation",
  );
  const evidenceSession = sessions.find((session) =>
    getSessionEvents(session).some((event) => event.evidence),
  );
  const pendingCount = sessions.filter(
    (session) => session.status === "waiting_for_confirmation",
  ).length;
  const runningCount = sessions.filter(
    (session) => session.status === "running",
  ).length;
  const failedCount = sessions.filter(
    (session) => session.status === "failed",
  ).length;
  const evidenceCount = sessions.reduce(
    (sum, session) =>
      sum + getSessionEvents(session).filter((event) => event.evidence).length,
    0,
  );
  const readyExecutorCount = executorsStatus?.summary.ready ?? 0;
  const readyAccountCount =
    browserStatus?.readyAccounts ?? readiness?.summary.readyAccounts ?? 0;

  const blockers = React.useMemo(() => {
    const items: LocalEngineActionBlocker[] = [];
    if (!loading && !health?.online) {
      items.push({
        platform: title,
        account: "自动化服务",
        target: "能力入口",
        stage: "执行前检查",
        reason: "自动化服务离线或状态未读取，不能启动真实动作。",
        nextAction: "请先进入系统状态启动或刷新服务，再重试操作。",
        capability: "local-engine",
      });
    }
    if (browserStatus && browserStatus.totalAccounts === 0) {
      items.push({
        platform: title,
        account: "平台账号",
        target: "浏览器/互动任务",
        stage: "账号检查",
        reason: "没有可用平台账号，不能执行需要账号后台的动作。",
        nextAction: "到浏览器控制或平台账号页补齐登录态，再创建任务。",
        capability: "browser-control",
      });
    } else if (
      browserStatus &&
      browserStatus.readyAccounts === 0 &&
      browserStatus.expiredAccounts > 0
    ) {
      items.push({
        platform: title,
        account: "平台账号",
        target: "浏览器/互动任务",
        stage: "账号检查",
        reason: "平台账号登录态已失效。",
        nextAction: "重新登录或切换到可用账号后再重试。",
        capability: "browser-control",
      });
    }
    if (executorsStatus && executorsStatus.summary.ready === 0) {
      items.push({
        platform: title,
        account: "互动服务",
        target: "正式执行",
        stage: "服务检查",
        reason: "当前没有可用服务，正式发送、发布或设备操作前请先恢复服务。",
        nextAction: "启动本机服务或改为草稿模式。",
        capability: "executor",
      });
    }
    if (readiness?.blockers?.length) {
      readiness.blockers.slice(0, 2).forEach((item) => {
        items.push({
          platform: title,
          account: "当前账号",
          target: item.capability,
          stage: "权限检查",
          reason: item.message,
          nextAction: item.nextAction || "处理待办项后重新检查。",
          capability: "permission-check",
        });
      });
    }
    if (capability && capability.status === "missing") {
      items.push({
        platform: title,
        account: "能力模块",
        target: capability.name,
        stage: "能力检查",
        reason: capability.summary,
        nextAction: capability.nextAction || "补齐该能力后再执行。",
        capability: capability.key,
      });
    }
    return items;
  }, [
    browserStatus,
    capability,
    executorsStatus,
    health,
    loading,
    readiness,
    title,
  ]);

  const isBlocked = blockers.length > 0;
  const retryDisabled = isBlocked || !failedSession;
  const stopDisabled = !runningSession;
  const exportDisabled = !evidenceSession;
  const retryUnavailableReason = !failedSession
    ? "暂无失败任务"
    : isBlocked
      ? "请先处理当前问题"
      : undefined;
  const stopUnavailableReason = runningSession ? undefined : "暂无运行中的任务";
  const exportUnavailableReason = evidenceSession
    ? undefined
    : "暂无可导出的任务记录";

  const runRetry = async () => {
    if (!failedSession) return;
    if (isBlocked) {
      addToast({
        title: "需要处理",
        description: blockers[0].nextAction,
        color: "warning",
      });
      return;
    }
    setBusyAction("retry");
    try {
      await localEngineApi.continueAgentSession(failedSession.id, {
        operator: "当前用户",
        instruction: "修复失败原因后重试当前任务。",
      });
      addToast({
        title: "已提交重试",
        description: failedSession.title,
        color: "success",
      });
      await refresh();
    } catch (error: unknown) {
      addToast({
        title: "重试失败",
        description: toPublicError(error, "任务重试未能提交，请稍后再试。"),
        color: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runStop = async () => {
    if (!runningSession) return;
    setBusyAction("stop");
    try {
      await localEngineApi.stopAgentSession(runningSession.id);
      addToast({
        title: "已停止执行",
        description: runningSession.title,
        color: "warning",
      });
      await refresh();
    } catch (error: unknown) {
      addToast({
        title: "停止失败",
        description: toPublicError(error, "任务未能停止，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runExport = async () => {
    if (!evidenceSession) return;
    setBusyAction("export");
    try {
      const result = await localEngineApi.exportAgentSessionEvidence(
        evidenceSession.id,
      );
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title: "记录已导出",
        description: `${result.evidenceCount} 条记录`,
        color: "success",
      });
    } catch (error: unknown) {
      addToast({
        title: "导出失败",
        description: toPublicError(error, "任务记录未能导出，请稍后重试。"),
        color: "danger",
      });
    } finally {
      setBusyAction(null);
    }
  };
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-medium font-semibold text-default-900">
                任务处理
              </h3>
              <Chip
                color={isBlocked ? "danger" : "success"}
                size="sm"
                variant="flat"
              >
                {isBlocked ? "需要处理" : "就绪"}
              </Chip>
              {capability ? (
                <Chip
                  color={
                    capability.status === "ready"
                      ? "success"
                      : capability.status === "warning"
                        ? "warning"
                        : "danger"
                  }
                  size="sm"
                  variant="flat"
                >
                  {capability.name}
                </Chip>
              ) : null}
            </div>
          </div>
          <Button
            isLoading={loading || busyAction === "refresh"}
            size="sm"
            startContent={
              loading || busyAction === "refresh" ? null : (
                <Icon icon="solar:refresh-linear" />
              )
            }
            variant="flat"
            onPress={() => {
              setBusyAction("refresh");
              refresh().finally(() => setBusyAction(null));
            }}
          >
            刷新状态
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-6">
          <StatusPill
            label="服务"
            value={loading ? "检查中" : health?.online ? "在线" : "离线"}
          />
          <StatusPill label="账号可用" value={readyAccountCount} />
          <StatusPill label="服务可用" value={readyExecutorCount} />
          <StatusPill label="运行中" value={runningCount} />
          <StatusPill label="失败" value={failedCount} />
          <StatusPill label="结果留存" value={evidenceCount} />
        </div>
        {blockers.length ? <BlockerList blockers={blockers} /> : null}
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Button
            as={Link}
            href={`/local-engine?tab=${localEngineTab}`}
            startContent={<Icon icon="solar:wrench-linear" />}
            variant="flat"
          >
            失败修复
          </Button>
          <Button
            aria-label={
              retryUnavailableReason
                ? `重试失败任务，${retryUnavailableReason}`
                : "重试失败任务"
            }
            color="primary"
            isDisabled={retryDisabled}
            isLoading={busyAction === "retry"}
            startContent={
              busyAction === "retry" ? null : (
                <Icon icon="solar:restart-linear" />
              )
            }
            title={retryUnavailableReason}
            variant="flat"
            onPress={runRetry}
          >
            重试失败
          </Button>
          <Button
            aria-label={
              stopUnavailableReason
                ? `停止任务，${stopUnavailableReason}`
                : "停止任务"
            }
            color="danger"
            isDisabled={stopDisabled}
            isLoading={busyAction === "stop"}
            startContent={
              busyAction === "stop" ? null : (
                <Icon icon="solar:stop-circle-linear" />
              )
            }
            title={stopUnavailableReason}
            variant="flat"
            onPress={runStop}
          >
            停止
          </Button>
          <Button
            aria-label={
              exportUnavailableReason
                ? `导出任务记录，${exportUnavailableReason}`
                : "导出任务记录"
            }
            isDisabled={exportDisabled}
            isLoading={busyAction === "export"}
            startContent={
              busyAction === "export" ? null : (
                <Icon icon="solar:download-minimalistic-linear" />
              )
            }
            title={exportUnavailableReason}
            variant="flat"
            onPress={runExport}
          >
            导出记录
          </Button>
          <Button
            as={Link}
            color={pendingCount ? "warning" : "default"}
            href="/tasks/confirmations"
            variant="flat"
          >
            待确认 {pendingCount}
          </Button>
          <Button as={Link} href="/tasks/records" variant="flat">
            任务历史
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
function AgentShell({
  title,
  description,
  icon,
  action,
  children,
  backHref,
}: {
  title: string;
  description: string;
  icon: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  backHref?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      {backHref ? <V2BackButton to={backHref} /> : null}
      <header className="flex flex-col gap-4 rounded-[8px] border-small border-divider bg-background p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] bg-primary/10 text-primary">
            <Icon icon={icon} width={26} />
          </div>
          <div>
            <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
              {title}
            </h2>
            <p className="mt-1 text-small text-default-500">{description}</p>
          </div>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}
function SessionHeader({ session }: { session: AgentSession }) {
  const failureContext = deriveSessionFailureContext(session);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-default-900">
            {commercialAgentText(session.title)}
          </h3>
          <Chip color={statusColor[session.status]} size="sm" variant="flat">
            {commercialAgentText(session.statusLabel)}
          </Chip>
          <Chip size="sm" variant="flat">
            {commercialAgentText(session.executionScope)}
          </Chip>
          <Chip
            color={
              session.riskLevel === "high"
                ? "danger"
                : session.riskLevel === "medium"
                  ? "warning"
                  : "success"
            }
            size="sm"
            variant="flat"
          >
            {session.riskLevel === "high"
              ? "高风险"
              : session.riskLevel === "medium"
                ? "中风险"
                : "低风险"}
          </Chip>
        </div>
        <p className="mt-1 text-small text-default-500">
          {commercialAgentText(session.instruction)}
        </p>
        {session.nextAction ? (
          <p className="mt-2 text-small text-default-600">
            下一步：{commercialAgentText(session.nextAction)}
          </p>
        ) : null}
        {session.blockers?.length ? (
          <BlockerList blockers={session.blockers} />
        ) : null}
        {failureContext ? (
          <FailureContextPanel context={failureContext} />
        ) : null}
      </div>
      <span className="text-tiny text-default-400">
        {new Date(session.updatedAt).toLocaleString()}
      </span>
    </div>
  );
}
function ArtifactsTable({
  items,
  onExport,
  exportingId,
}: {
  items: AgentSession[];
  onExport: (session: AgentSession) => void;
  exportingId: string;
}) {
  const rows = items
    .flatMap((session) =>
      getSessionEvents(session)
        .filter((event) => event.evidence)
        .map((event) => ({ session, event, evidence: event.evidence! })),
    )
    .slice(0, 80);
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              结果留存索引
            </h3>
            <p className="mt-1 text-small text-default-500">
              从任务事件中抽取截图、页面记录、桌面截图、步骤记录、失败原因和文件记录，可回来源或导出单个任务历史。
            </p>
          </div>
        </div>
        <Table
          aria-label="结果留存"
          classNames={{
            wrapper: "border-small border-divider shadow-none",
            th: "bg-default-50 text-default-500",
          }}
        >
          <TableHeader>
            <TableColumn>类型</TableColumn>
            <TableColumn>记录</TableColumn>
            <TableColumn>任务</TableColumn>
            <TableColumn>时间</TableColumn>
            <TableColumn>操作</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent="暂无结果留存。完成发布、互动或检查后，这里会展示截图、步骤和结果。"
            items={rows}
          >
            {(row) => (
              <TableRow key={`${row.session.id}-${row.event.id}`}>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Chip size="sm" variant="flat">
                      {evidenceTypeName[row.evidence.type] || row.evidence.type}
                    </Chip>
                    {row.evidence.stageKey ? (
                      <Chip size="sm" variant="flat">
                        {formatEvidenceStage(row.evidence.stageKey)}
                      </Chip>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[320px] space-y-1">
                    <p className="text-small font-medium text-default-800">
                      {commercialAgentText(row.evidence.label || "过程凭证")}
                    </p>
                    <p className="truncate text-tiny text-default-500">
                      {previewEvidenceValue(row.evidence.value)}
                    </p>
                    {row.evidence.artifactUrl ? (
                      <Link
                        className="text-tiny text-primary"
                        href={localEngineApi.evidenceFileUrl(
                          row.evidence.artifactUrl,
                        )}
                      >
                        打开记录
                      </Link>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[240px] space-y-1">
                    <p className="truncate text-small text-default-800">
                      {commercialAgentText(row.session.title)}
                    </p>
                    <p className="text-tiny text-default-400">
                      {confirmationSourceLabel[row.session.source]}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-tiny text-default-500">
                    {new Date(row.event.createdAt).toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      as={Link}
                      href={confirmationSourceHref[row.session.source]}
                      size="sm"
                      variant="flat"
                    >
                      来源
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      isLoading={exportingId === row.session.id}
                      onPress={() => onExport(row.session)}
                    >
                      导出
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function EventTimeline({
  session,
  artifactsOnly = false,
}: {
  session: AgentSession;
  artifactsOnly?: boolean;
}) {
  const sessionEvents = getSessionEvents(session);
  const events = artifactsOnly
    ? sessionEvents.filter((event) => event.evidence)
    : sessionEvents;
  if (events.length === 0) {
    return (
      <EmptyBlock
        actionHref="/tasks/records"
        actionLabel="查看任务历史"
        text={
          artifactsOnly
            ? "当前任务还没有结果留存。完成关键动作后会留下截图、页面记录或文件记录。"
            : "当前任务还没有过程凭证。任务开始执行后会展示每一步进展。"
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {events.map((event) => (
        <div
          key={event.id}
          className="rounded-[8px] border-small border-divider p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Icon
                icon={
                  event.level === "success"
                    ? "solar:check-circle-linear"
                    : event.level === "warning"
                      ? "solar:danger-triangle-linear"
                      : event.level === "error"
                        ? "solar:close-circle-linear"
                        : "solar:info-circle-linear"
                }
              />
              <span className="font-medium text-default-800">
                {displayEventTitle(event.title)}
              </span>
            </div>
            <span className="text-tiny text-default-400">
              {new Date(event.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <p className="mt-1 text-small text-default-500">
            {displayEventMessage(event.message)}
          </p>
          {event.evidence ? (
            <div className="mt-2 rounded-small bg-default-100 p-2 text-small text-default-600">
              <div className="flex flex-wrap items-center gap-2">
                <Chip size="sm" variant="flat">
                  {evidenceTypeName[event.evidence.type] || event.evidence.type}
                </Chip>
                {event.evidence.stageKey ? (
                  <Chip size="sm" variant="flat">
                    {formatEvidenceStage(event.evidence.stageKey)}
                  </Chip>
                ) : null}
                <span className="font-medium">
                  {commercialAgentText(event.evidence.label || "过程凭证")}
                </span>
              </div>
              <p className="mt-1 break-words">
                {previewEvidenceValue(event.evidence.value)}
              </p>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody>
        <p className="text-tiny text-default-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-default-900">{value}</p>
      </CardBody>
    </Card>
  );
}
function StatusPill({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-[8px] border-small border-divider bg-default-50 px-3 py-2">
      <p className="text-tiny text-default-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-default-900">{value}</p>
    </div>
  );
}

function getConfirmationBlockers(
  item: AgentConfirmation,
): LocalEngineActionBlocker[] {
  const blockers: LocalEngineActionBlocker[] = [];
  if (
    item.blockedReason ||
    item.trialLimited ||
    item.safetyBoundary?.permissionStatus === "blocked" ||
    item.safetyBoundary?.permissionStatus === "trial_limited"
  ) {
    blockers.push({
      platform:
        item.session?.targetApp ||
        confirmationSourceLabel[item.session?.source || "system"],
      account: item.operator || "当前用户",
      target: item.riskPolicy?.targetName || item.title,
      stage: "人工确认",
      reason:
        item.blockedReason ||
        item.safetyBoundary?.message ||
        "当前账号或版本没有执行该真实动作的权限。",
      nextAction:
        item.safetyBoundary?.permissionStatus === "trial_limited"
          ? "切换到已授权商用账号，或改为只生成草稿/检查。"
          : "补齐商用执行权限、白名单或审批角色后再确认。",
      capability: "permission-check",
    });
  }
  if ((item.riskPolicy?.forbiddenActionHits || []).length) {
    blockers.push({
      platform:
        item.session?.targetApp ||
        confirmationSourceLabel[item.session?.source || "system"],
      account: item.operator || "当前用户",
      target: item.riskPolicy?.targetName || item.title,
      stage: "风控策略",
      reason: `命中禁止动作：${item.riskPolicy?.forbiddenActionHits.join("、")}`,
      nextAction: "调整任务内容，移除禁止动作后重新发起或让管理员更新策略。",
      capability: "risk-policy",
    });
  }
  return blockers;
}
function isConfirmationBlocked(item: AgentConfirmation) {
  return getConfirmationBlockers(item).length > 0;
}
function BlockerList({ blockers }: { blockers: LocalEngineActionBlocker[] }) {
  if (!blockers.length) return null;
  return (
    <div className="mt-3 grid gap-2">
      {blockers.map((blocker, index) => (
        <div
          key={`${blocker.stage}-${index}`}
          className="rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700"
        >
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <Icon icon="solar:shield-warning-linear" />
            <span>需处理：{commercialAgentText(blocker.stage)}</span>
            {blocker.capability ? (
              <Chip color="danger" size="sm" variant="flat">
                {commercialCapabilityLabel(blocker.capability)}
              </Chip>
            ) : null}
          </div>
          <p className="mt-2">
            {[
              blocker.platform ? `平台：${blocker.platform}` : null,
              blocker.account ? `账号：${blocker.account}` : null,
              blocker.target ? `对象：${blocker.target}` : null,
              `原因：${commercialAgentText(blocker.reason)}`,
            ]
              .filter(Boolean)
              .join("；")}
          </p>
          <p className="mt-1 text-tiny">
            下一步：{commercialAgentText(blocker.nextAction)}
          </p>
        </div>
      ))}
    </div>
  );
}
function FailureContextPanel({
  context,
}: {
  context: LocalEngineFailureContext;
}) {
  return (
    <div className="mt-3 rounded-[8px] border-small border-danger-200 bg-danger-50 p-3 text-small text-danger-700">
      <div className="flex items-center gap-2 font-semibold">
        <Icon icon="solar:close-circle-linear" /> <span>失败原因</span>
      </div>
      <p className="mt-2">{formatFailureContext(context)}</p>
    </div>
  );
}
function EmptyBlock({
  text,
  actionLabel,
  actionHref,
}: {
  text: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="items-center justify-center gap-3 py-12 text-center text-small text-default-500">
        <p className="max-w-xl leading-6">{text}</p>
        {actionLabel && actionHref ? (
          <Button as={Link} href={actionHref} size="sm" variant="flat">
            {actionLabel}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
function LoadingBlock() {
  return (
    <div className="flex justify-center py-16">
      <Spinner size="sm" />
    </div>
  );
}
