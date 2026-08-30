"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Checkbox,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea,
  addToast,
} from "@heroui/react";
import { AgentSessionLifecycleStepper } from "@/components/agent-session-lifecycle-stepper";
import { Icon } from "@/components/lucide-icon-compat";
import {
  OpsDesktopPage,
  OpsDenseTable,
  OpsMetric,
  OpsPanel,
  OpsStatusPill,
  OpsToolbar,
} from "../components/desktop-ops-ui";
import { FailureActionPanel } from "../components/failure-action-panel";
import {
  localEngineApi,
  type AgentConfirmation,
  type AgentSession,
  type AutomationTaskView,
} from "@/lib/api/local-engine";
import {
  autoUploadApi,
  type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import {
  aiEmployeeApi,
  type AiEmployeeCapability,
  type AiEmployeeCapabilitiesSnapshot,
  type AiEmployeeCoreTaskType,
  type AiEmployeeExposureMode,
  type AiEmployeeWorkflowDefinition,
  type AiEmployeeWorkflowConfirmationInput,
  type AiEmployeeWorkflowPreparationResult,
  type AiEmployeeWorkflowRun,
  type AiEmployeeWorkflowRunStatus,
  type AiEmployeeWorkflowStepStatus,
} from "@/lib/api/ai-employee";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { useIsMobile } from "@/lib/hooks/use-media-query";
import {
  buildPublishRecordAgentSession,
  displayPublishRecordFileName,
  displayPublishRecordTitle,
  getPublishRecordEvidenceCount,
  getPublishRecordFailureReason,
  getPublishRecordMetrics,
  getPublishRecordModeLabel,
  getPublishRecordStatusColor,
  resolvePublishRecordStatus,
} from "@/lib/publish-record-view";
import { SkeletonList } from "@/components/skeleton";
import { toActionableError } from "@/lib/public-error";

function normalizeSessions(value: AgentSession[]) {
  return value.map((session) => ({
    ...session,
    events: Array.isArray(session.events) ? session.events : [],
    confirmations: Array.isArray(session.confirmations)
      ? session.confirmations
      : [],
  }));
}

function formatDateTime(value?: string | null) {
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

function taskDisplayText(value?: string | null, fallback = "") {
  return commercialDisplayText(value || fallback, fallback)
    .replaceAll("安全预演", "预览任务")
    .replaceAll("安全演练", "演示任务");
}

function sourceLabel(value: AgentSession["source"]) {
  const labels: Record<AgentSession["source"], string> = {
    "agent-console": "任务历史",
    publishing: "发布中心",
    interaction: "客户互动",
    system: "系统任务",
    web: "网页指令",
  };
  return labels[value] || value;
}

function agentSessionRecordHref(sessionId?: string | null) {
  if (!sessionId || sessionId.startsWith("interaction-task:")) {
    return "/tasks/records";
  }
  return `/tasks/records?sessionId=${encodeURIComponent(sessionId)}`;
}

function confirmationSessionTitle(item: AgentConfirmation) {
  return taskDisplayText(
    item.session?.title || item.title || "待确认任务",
    "待确认任务",
  );
}

function confirmationSourceLabel(item: AgentConfirmation) {
  return item.session?.source ? sourceLabel(item.session.source) : "任务中心";
}

function getSessionEvidenceCount(session: AgentSession) {
  return Array.isArray(session.events)
    ? session.events.filter((event) => Boolean(event.evidence)).length
    : 0;
}

function sessionFailureDetails(session: AgentSession) {
  return [
    session.failureReason,
    session.nextAction,
    ...(session.events || [])
      .filter((event) => event.level === "error")
      .map((event) => `${event.title || "任务异常"}：${event.message}`),
  ].filter(Boolean);
}

function sessionDisplayTitle(session: AgentSession) {
  return taskDisplayText(
    session.title || session.instruction || "任务记录",
    "任务记录",
  );
}

function sessionLifecyclePriority(session: AgentSession) {
  if (session.status === "waiting_for_confirmation") return 0;
  if (session.status === "running") return 1;
  if (session.status === "failed") return 2;
  if (session.resumeAction) return 3;
  if (getSessionEvidenceCount(session)) return 4;
  if (session.status === "completed") return 5;
  if (session.status === "draft") return 6;
  return 7;
}

function agentStatusColor(status: AgentSession["status"]) {
  if (status === "failed") return "danger";
  if (status === "running") return "primary";
  if (status === "waiting_for_confirmation") return "warning";
  if (status === "completed") return "success";
  return "default";
}

function hasPendingSessionConfirmation(session: AgentSession) {
  return (
    session.status === "waiting_for_confirmation" ||
    (session.confirmations || []).some((item) => item.status === "pending")
  );
}

function visibleAgentStatusColor(session: AgentSession) {
  return hasPendingSessionConfirmation(session)
    ? ("warning" as const)
    : agentStatusColor(session.status);
}

function visibleAgentStatusText(session: AgentSession) {
  return hasPendingSessionConfirmation(session)
    ? "待我确认"
    : commercialDisplayText(session.statusLabel || session.status);
}

function agentRiskLabel(riskLevel: AgentSession["riskLevel"]) {
  if (riskLevel === "high") return "高风险";
  if (riskLevel === "medium") return "中风险";
  return "低风险";
}

function agentEventColor(level: AgentSession["events"][number]["level"]) {
  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  if (level === "success") return "success";
  return "default";
}

function automationStatusColor(
  status: AutomationTaskView["status"],
): "default" | "primary" | "success" | "warning" | "danger" {
  if (status === "failed" || status === "partial_failed") return "danger";
  if (status === "running") return "primary";
  if (status === "waiting_confirmation" || status === "queued")
    return "warning";
  if (status === "success") return "success";
  return "default";
}

function automationTaskTypeLabel(value: string) {
  const labels: Record<string, string> = {
    "workflow.auto": "自动工作流",
    "exposure.auto": "自动获客",
    "exposure.targeted": "定向获客",
    "exposure.link": "链接获客",
    "exposure.search_account": "账号搜索获客",
    "exposure.retention": "线索跟进",
    "ai_service.config_test": "AI客服测试",
    "publish.multi_platform": "多平台发布",
    "video.template_clip": "视频剪辑",
  };
  return labels[value] || value;
}

function capabilityStatusLabel(
  capability: Pick<AiEmployeeCapability, "status">,
) {
  if (capability.status === "real") return "可执行";
  if (capability.status === "simulated") return "可预演";
  if (capability.status === "needs_config") return "待配置";
  return "暂不可用";
}

function capabilityStatusTone(
  capability: AiEmployeeCapability,
): "default" | "brand" | "success" | "warning" | "danger" {
  if (capability.status === "real") return "success";
  if (capability.status === "simulated") return "brand";
  if (capability.status === "needs_config") return "warning";
  return "danger";
}

function canControlAgentSession(session?: AgentSession | null) {
  return Boolean(session?.id && !session.id.startsWith("interaction-task:"));
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

type WorkflowFormState = {
  title: string;
  platform: string;
  account: string;
  material: string;
  goal: string;
  frequency: string;
  timeWindow: string;
  riskLevel: "low" | "medium" | "high";
  exposureMode: AiEmployeeExposureMode;
  includeVideoClip: boolean;
  includeExposure: boolean;
  includePublish: boolean;
};

const initialWorkflowForm: WorkflowFormState = {
  title: "每日抖音线索读取",
  platform: "douyin",
  account: "",
  material: "",
  goal: "读取候选线索并保留页面记录和处理结果。",
  frequency: "每天 1 次",
  timeWindow: "09:00-18:00",
  riskLevel: "medium",
  exposureMode: "link",
  includeVideoClip: false,
  includeExposure: true,
  includePublish: false,
};

type WorkflowConfirmationRequest =
  | {
      kind: "start";
      definition: AiEmployeeWorkflowDefinition;
    }
  | {
      kind: "retry";
      definition?: AiEmployeeWorkflowDefinition;
      run: AiEmployeeWorkflowRun;
    };

function buildWorkflowConfirmation(
  request: WorkflowConfirmationRequest,
): AiEmployeeWorkflowConfirmationInput {
  const confirmedAt = new Date().toISOString();
  const confirmationId =
    globalThis.crypto?.randomUUID?.() ||
    `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    confirmed: true,
    confirmedAction: "runtime-control",
    confirmedRiskLevel: "high",
    confirmationId,
    operator: "当前登录用户",
    reason:
      request.kind === "retry"
        ? `已核对并确认重试：${request.run.title}`
        : `已核对并确认启动：${request.definition.title}`,
    confirmedAt,
    checklist: {
      accountReviewed: true,
      targetReviewed: true,
      contentReviewed: true,
      scheduleReviewed: true,
    },
    fullPermission: false,
  };
}

const workflowPlatformOptions = [
  { key: "douyin", label: "抖音" },
  { key: "wechat-channel", label: "视频号" },
  { key: "xiaohongshu", label: "小红书" },
  { key: "kuaishou", label: "快手" },
  { key: "bilibili", label: "B站" },
];

const workflowRiskOptions = [
  { key: "low", label: "低风险" },
  { key: "medium", label: "中风险" },
  { key: "high", label: "高风险" },
] as const;

const workflowExposureOptions: Array<{
  key: AiEmployeeExposureMode;
  label: string;
}> = [
  { key: "link", label: "链接候选读取" },
  { key: "search_account", label: "账号搜索候选" },
  { key: "hot_video", label: "爆款视频候选" },
  { key: "targeted", label: "定向账号候选" },
  { key: "retention", label: "留资线索候选" },
];

function workflowPlatformLabel(value: string) {
  return (
    workflowPlatformOptions.find((option) => option.key === value)?.label ||
    value
  );
}

function workflowRiskLabel(value: WorkflowFormState["riskLevel"]) {
  return (
    workflowRiskOptions.find((option) => option.key === value)?.label ||
    "中风险"
  );
}

function workflowRunStatusLabel(status: AiEmployeeWorkflowRunStatus) {
  const labels: Record<AiEmployeeWorkflowRunStatus, string> = {
    queued: "等待运行",
    running: "运行中",
    completed: "已完成",
    partial: "部分完成",
    blocked: "已阻断",
    failed: "执行失败",
    cancelling: "取消中",
    cancelled: "已取消",
  };
  return labels[status];
}

function workflowRunStatusTone(
  status: AiEmployeeWorkflowRunStatus,
): "default" | "brand" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "running" || status === "queued") return "brand";
  if (status === "partial" || status === "cancelling") return "warning";
  if (status === "failed") return "danger";
  return "default";
}

function workflowStepStatusLabel(status: AiEmployeeWorkflowStepStatus) {
  const labels: Record<AiEmployeeWorkflowStepStatus, string> = {
    pending: "等待",
    running: "执行中",
    completed: "已完成",
    blocked: "已阻断",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status];
}

function workflowStepStatusTone(
  status: AiEmployeeWorkflowStepStatus,
): "default" | "brand" | "success" | "warning" | "danger" {
  if (status === "completed") return "success";
  if (status === "running") return "brand";
  if (status === "blocked" || status === "cancelled") return "warning";
  if (status === "failed") return "danger";
  return "default";
}

type WorkflowSummary = {
  title: string;
  platform: string;
  account: string;
  material: string;
  goal: string;
  frequency: string;
  timeWindow: string;
  riskLevel: string;
};

type ExposureSummary = {
  title: string;
  platform: string;
  account: string;
  sourceLabel: string;
  sourceInputs: string;
  includeKeywords: string;
  dailyLimit: string;
  beginTime: string;
  riskLevel: string;
  goal: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDisplayText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim()
    ? taskDisplayText(value.trim())
    : "";
}

function toDisplayList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toDisplayText(item))
      .filter(Boolean)
      .slice(0, 4)
      .join("、");
  }
  return toDisplayText(value);
}

function getWorkflowSummary(
  session?: AgentSession | null,
): WorkflowSummary | null {
  const metadata = toRecord(session?.metadata);
  const payload = toRecord(metadata.payload);
  const workflow = toRecord(payload.workflow);
  if (!workflow.title && !workflow.account && !workflow.material) {
    return null;
  }

  const riskLevel =
    toDisplayText(payload.riskLabel) ||
    workflowRiskLabel(
      (toDisplayText(workflow.riskLevel) as WorkflowFormState["riskLevel"]) ||
        "medium",
    );

  return {
    title: toDisplayText(workflow.title) || toDisplayText(session?.title),
    platform:
      toDisplayText(payload.platformLabel) ||
      workflowPlatformLabel(toDisplayText(workflow.platform)),
    account: toDisplayText(workflow.account),
    material: toDisplayText(workflow.material),
    goal: toDisplayText(workflow.goal),
    frequency: toDisplayText(workflow.frequency),
    timeWindow: toDisplayText(workflow.timeWindow),
    riskLevel,
  };
}

function WorkflowConfigSummary({
  session,
  compact = false,
}: {
  session?: AgentSession | null;
  compact?: boolean;
}) {
  const summary = getWorkflowSummary(session);
  if (!summary) return null;
  const items = [
    ["平台", summary.platform],
    ["账号", summary.account],
    ["频率", summary.frequency],
    ["时间窗", summary.timeWindow],
    ["素材", summary.material],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="mt-2 rounded-[8px] border-small border-divider bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip color="primary" size="sm" variant="flat">
          工作流配置
        </Chip>
        {summary.riskLevel ? (
          <Chip color="warning" size="sm" variant="flat">
            {summary.riskLevel}
          </Chip>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={`${label}-${value}`} className="min-w-0 text-tiny">
            <span className="text-default-400">{label}：</span>
            <span className="break-all font-medium text-default-700">
              {value}
            </span>
          </div>
        ))}
      </div>
      {!compact && summary.goal ? (
        <p className="mt-2 line-clamp-2 text-tiny leading-5 text-default-500">
          目标：{summary.goal}
        </p>
      ) : null}
    </div>
  );
}

function getExposureSummary(
  session?: AgentSession | null,
): ExposureSummary | null {
  const metadata = toRecord(session?.metadata);
  const payload = toRecord(metadata.payload);
  const exposure = toRecord(payload.exposure);
  if (!exposure.title && !exposure.sourceInputs && !exposure.account) {
    return null;
  }

  return {
    title: toDisplayText(exposure.title) || toDisplayText(session?.title),
    platform: workflowPlatformLabel(toDisplayText(exposure.platform)),
    account: toDisplayText(exposure.account),
    sourceLabel: toDisplayText(exposure.sourceLabel) || "来源",
    sourceInputs: toDisplayList(exposure.sourceInputs),
    includeKeywords: toDisplayList(exposure.includeKeywords),
    dailyLimit: toDisplayText(exposure.dailyLimit),
    beginTime: toDisplayText(exposure.beginTime),
    riskLevel: toDisplayText(exposure.riskLabel) || "中风险",
    goal: toDisplayText(exposure.goal),
  };
}

function ExposureConfigSummary({
  session,
  compact = false,
}: {
  session?: AgentSession | null;
  compact?: boolean;
}) {
  const summary = getExposureSummary(session);
  if (!summary) return null;
  const items = [
    ["类型", summary.title],
    ["平台", summary.platform],
    ["账号", summary.account],
    [summary.sourceLabel, summary.sourceInputs],
    ["意向词", summary.includeKeywords],
    ["上限", summary.dailyLimit ? `${summary.dailyLimit}/天` : ""],
    ["时间", summary.beginTime],
  ].filter(([, value]) => Boolean(value));

  return (
    <div className="mt-2 rounded-[8px] border-small border-divider bg-background/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip color="primary" size="sm" variant="flat">
          曝光配置
        </Chip>
        {summary.riskLevel ? (
          <Chip
            color={summary.riskLevel === "高风险" ? "danger" : "warning"}
            size="sm"
            variant="flat"
          >
            {summary.riskLevel}
          </Chip>
        ) : null}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={`${label}-${value}`} className="min-w-0 text-tiny">
            <span className="text-default-400">{label}：</span>
            <span className="break-all font-medium text-default-700">
              {value}
            </span>
          </div>
        ))}
      </div>
      {!compact && summary.goal ? (
        <p className="mt-2 line-clamp-2 text-tiny leading-5 text-default-500">
          目标：{summary.goal}
        </p>
      ) : null}
    </div>
  );
}

export function TaskCenterPage() {
  const isMobile = useIsMobile();
  const [sessions, setSessions] = React.useState<AgentSession[]>([]);
  const [automationTasks, setAutomationTasks] = React.useState<
    AutomationTaskView[]
  >([]);
  const [confirmations, setConfirmations] = React.useState<AgentConfirmation[]>(
    [],
  );
  const [publishTasks, setPublishTasks] = React.useState<
    AutoUploadPublishTask[]
  >([]);
  const [capabilities, setCapabilities] =
    React.useState<AiEmployeeCapabilitiesSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [previewBusy, setPreviewBusy] = React.useState<
    AiEmployeeCoreTaskType | ""
  >("");
  const [workflowForm, setWorkflowForm] =
    React.useState<WorkflowFormState>(initialWorkflowForm);
  const [workflowSubmitting, setWorkflowSubmitting] = React.useState(false);
  const [workflowPreparation, setWorkflowPreparation] =
    React.useState<AiEmployeeWorkflowPreparationResult | null>(null);
  const [workflowDefinitions, setWorkflowDefinitions] = React.useState<
    AiEmployeeWorkflowDefinition[]
  >([]);
  const [workflowRuns, setWorkflowRuns] = React.useState<
    AiEmployeeWorkflowRun[]
  >([]);
  const [workflowBusyAction, setWorkflowBusyAction] = React.useState("");
  const [workflowConfirmation, setWorkflowConfirmation] =
    React.useState<WorkflowConfirmationRequest | null>(null);
  const [workflowConfirmationChecked, setWorkflowConfirmationChecked] =
    React.useState(false);
  const [clearRecordTarget, setClearRecordTarget] =
    React.useState<AgentSession | null>(null);
  const [clearRecordBusy, setClearRecordBusy] = React.useState(false);
  const [drawerSession, setDrawerSession] = React.useState<AgentSession | null>(
    null,
  );
  const [drawerLoading, setDrawerLoading] = React.useState(false);
  const [drawerBusyAction, setDrawerBusyAction] = React.useState<
    "" | "continue" | "stop" | "export"
  >("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        sessionResult,
        confirmationResult,
        capabilityResult,
        publishTaskResult,
        automationTaskResult,
        workflowResult,
      ] = await Promise.all([
        localEngineApi.agentSessions({ limit: 80 }),
        localEngineApi.confirmations("pending"),
        aiEmployeeApi.capabilities(),
        // 与发布中心同源（taskPage 分页），消除 listTasks 截断 vs taskPage 分页的口径冲突
        autoUploadApi.taskPage({ page: 1, pageSize: 80 }),
        localEngineApi.automationTasks({ limit: 80 }),
        aiEmployeeApi.workflows(50),
      ]);
      setSessions(normalizeSessions(sessionResult || []));
      setConfirmations(confirmationResult || []);
      setCapabilities(capabilityResult);
      setPublishTasks(publishTaskResult?.items ?? []);
      setAutomationTasks(
        Array.isArray(automationTaskResult) ? automationTaskResult : [],
      );
      setWorkflowDefinitions(workflowResult.definitions || []);
      setWorkflowRuns(workflowResult.runs || []);
    } catch (caught: unknown) {
      const message =
        toActionableError(caught, "任务中心读取失败");
      setError(message);
      addToast({
        title: "任务中心读取失败",
        description: message,
        color: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const createPreviewTask = React.useCallback(
    async (type: AiEmployeeCoreTaskType, title: string) => {
      setPreviewBusy(type);
      try {
        const result = await aiEmployeeApi.createDryRunTask({
          type,
          title,
          payload: { source: "tasks-quick-entry" },
        });
        addToast({
          title: "预览已创建",
          description: commercialDisplayText(
            result.nextAction || "仅供查看，不会发送或发布。",
          ),
          color: "success",
        });
        await refresh();
      } catch (caught: unknown) {
        const message =
          toActionableError(caught, "预览任务创建失败");
        addToast({
          title: "预览任务创建失败",
          description: message,
          color: "danger",
        });
      } finally {
        setPreviewBusy("");
      }
    },
    [refresh],
  );

  const updateWorkflowForm = React.useCallback(
    <K extends keyof WorkflowFormState>(
      key: K,
      value: WorkflowFormState[K],
    ) => {
      setWorkflowForm((previous) => ({ ...previous, [key]: value }));
    },
    [],
  );

  const createWorkflow = React.useCallback(async () => {
    const normalized: WorkflowFormState = {
      ...workflowForm,
      title: workflowForm.title.trim(),
      account: workflowForm.account.trim(),
      material: workflowForm.material.trim(),
      goal: workflowForm.goal.trim(),
      frequency: workflowForm.frequency.trim(),
      timeWindow: workflowForm.timeWindow.trim(),
    };
    const missingField = [
      ["任务名称", normalized.title],
      ["账号", normalized.account],
      ["素材或链接", normalized.material],
      ["执行目标", normalized.goal],
      ["频率", normalized.frequency],
      ["时间窗", normalized.timeWindow],
    ].find(([, value]) => !value);

    if (missingField) {
      addToast({
        title: `请填写${missingField[0]}`,
        color: "warning",
      });
      return;
    }
    if (
      !normalized.includeVideoClip &&
      !normalized.includeExposure &&
      !normalized.includePublish
    ) {
      addToast({
        title: "请至少选择一个执行步骤",
        color: "warning",
      });
      return;
    }

    setWorkflowSubmitting(true);
    try {
      const result = await aiEmployeeApi.prepareWorkflow({
        title: normalized.title,
        accountId: normalized.account,
        workflow: normalized,
      });
      setWorkflowPreparation(result);
      setWorkflowDefinitions((current) => [
        result.definition,
        ...current.filter((item) => item.id !== result.definition.id),
      ]);
      addToast({
        title: result.message,
        description: result.nextAction,
        color: result.displayStatus === "ready" ? "success" : "warning",
      });
      setWorkflowForm(normalized);
      await refresh();
    } catch (caught: unknown) {
      const message =
        toActionableError(caught, "工作流创建失败");
      addToast({
        title: "工作流创建失败",
        description: message,
        color: "danger",
      });
    } finally {
      setWorkflowSubmitting(false);
    }
  }, [refresh, workflowForm]);

  const startSavedWorkflow = React.useCallback(
    (definition: AiEmployeeWorkflowDefinition) => {
      setWorkflowConfirmation({ kind: "start", definition });
      setWorkflowConfirmationChecked(false);
    },
    [],
  );

  const retrySavedWorkflow = React.useCallback(
    (run: AiEmployeeWorkflowRun) => {
      const definition = workflowDefinitions.find(
        (item) => item.id === run.workflowId,
      );
      setWorkflowConfirmation({ kind: "retry", definition, run });
      setWorkflowConfirmationChecked(false);
    },
    [workflowDefinitions],
  );

  const confirmWorkflowAction = React.useCallback(async () => {
    const request = workflowConfirmation;
    if (!request || !workflowConfirmationChecked) return;
    const busyKey =
      request.kind === "start"
        ? `start:${request.definition.id}`
        : `retry:${request.run.id}`;
    setWorkflowBusyAction(busyKey);
    try {
      const riskConfirmation = buildWorkflowConfirmation(request);
      const run =
        request.kind === "start"
          ? await aiEmployeeApi.startWorkflow(
              request.definition.id,
              riskConfirmation,
            )
          : await aiEmployeeApi.retryWorkflowRun(request.run.id, {
              riskConfirmation,
            });
      setWorkflowRuns((current) => [
        run,
        ...current.filter((item) => item.id !== run.id),
      ]);
      setWorkflowConfirmation(null);
      setWorkflowConfirmationChecked(false);
      addToast({
        title: workflowRunStatusLabel(run.status),
        description: `${run.aggregate.completedSteps}/${run.aggregate.totalSteps} 个步骤完成，保留 ${run.aggregate.evidenceCount} 条结果资料。`,
        color:
          run.status === "completed"
            ? "success"
            : run.status === "failed"
              ? "danger"
              : "warning",
      });
      await refresh();
    } catch (caught: unknown) {
      addToast({
        title: request.kind === "start" ? "工作流启动失败" : "工作流重试失败",
        description:
          toActionableError(caught, "请核对执行条件后重试"),
        color: "danger",
      });
    } finally {
      setWorkflowBusyAction("");
    }
  }, [refresh, workflowConfirmation, workflowConfirmationChecked]);

  const cancelSavedWorkflow = React.useCallback(
    async (run: AiEmployeeWorkflowRun) => {
      const busyKey = `cancel:${run.id}`;
      setWorkflowBusyAction(busyKey);
      try {
        const cancelled = await aiEmployeeApi.cancelWorkflowRun(run.id);
        setWorkflowRuns((current) => [
          cancelled,
          ...current.filter((item) => item.id !== cancelled.id),
        ]);
        addToast({
          title:
            cancelled.status === "cancelling" ? "正在取消" : "工作流已取消",
          description: cancelled.cancellationMessage,
          color: "warning",
        });
        await refresh();
      } catch (caught: unknown) {
        addToast({
          title: "取消失败",
          description: toActionableError(caught, "请稍后重试"),
          color: "danger",
        });
      } finally {
        setWorkflowBusyAction("");
      }
    },
    [refresh],
  );

  const openAgentDrawer = React.useCallback(async (session: AgentSession) => {
    setDrawerSession(session);
    if (!canControlAgentSession(session)) return;
    setDrawerLoading(true);
    try {
      const detail = await localEngineApi.agentSession(session.id);
      setDrawerSession(normalizeSessions([detail])[0] || session);
    } catch {
      setDrawerSession(session);
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const refreshDrawerSession = React.useCallback(
    async (fallback?: AgentSession | null) => {
      const current = fallback || drawerSession;
      if (!current) return;
      if (!canControlAgentSession(current)) {
        setDrawerSession(current);
        return;
      }
      const detail = await localEngineApi.agentSession(current.id);
      setDrawerSession(normalizeSessions([detail])[0] || current);
    },
    [drawerSession],
  );

  const continueDrawerSession = async () => {
    if (!drawerSession) return;
    if (
      drawerSession.status === "waiting_for_confirmation" ||
      drawerSession.confirmations.some((item) => item.status === "pending")
    ) {
      addToast({
        title: "请先完成确认",
        description: "待确认动作处理完成后才能继续。",
        color: "warning",
      });
      return;
    }
    if (drawerSession.blockers?.length) {
      addToast({
        title: "继续执行需处理",
        description: drawerSession.blockers[0].nextAction,
        color: "warning",
      });
      return;
    }
    if (!canControlAgentSession(drawerSession)) {
      addToast({
        title: "请到记录页处理",
        description: "这条记录没有可直接继续的运行会话。",
        color: "warning",
      });
      return;
    }
    setDrawerBusyAction("continue");
    try {
      await localEngineApi.continueAgentSession(drawerSession.id, {
        instruction: "继续执行当前任务",
        operator: "当前用户",
      });
      addToast({ title: "已继续执行", color: "success" });
      await refresh();
      await refreshDrawerSession(drawerSession);
    } catch (caught: unknown) {
      addToast({
        title: "继续失败",
        description: toActionableError(caught, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setDrawerBusyAction("");
    }
  };

  const clearDrawerRecord = async () => {
    const target = clearRecordTarget;
    if (!target || !canControlAgentSession(target)) return;
    setClearRecordBusy(true);
    try {
      await localEngineApi.archiveAgentSession(target.id, {
        operator: "当前用户",
        reason: "用户从任务中心移除记录。",
      });
      setSessions((current) =>
        current.filter((session) => session.id !== target.id),
      );
      setDrawerSession(null);
      setClearRecordTarget(null);
      addToast({ title: "记录已从任务列表移除", color: "success" });
      await refresh();
    } catch (caught: unknown) {
      addToast({
        title: "移除记录失败",
        description: toActionableError(caught, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setClearRecordBusy(false);
    }
  };

  const stopDrawerSession = async () => {
    if (!drawerSession) return;
    if (!canControlAgentSession(drawerSession)) {
      addToast({
        title: "请到记录页处理",
        description: "这条记录没有可直接停止的运行会话。",
        color: "warning",
      });
      return;
    }
    setDrawerBusyAction("stop");
    try {
      await localEngineApi.stopAgentSession(drawerSession.id);
      addToast({ title: "已停止执行", color: "warning" });
      await refresh();
      await refreshDrawerSession(drawerSession);
    } catch (caught: unknown) {
      addToast({
        title: "停止失败",
        description: toActionableError(caught, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setDrawerBusyAction("");
    }
  };

  const exportDrawerSession = async () => {
    if (!drawerSession) return;
    if (!canControlAgentSession(drawerSession)) {
      addToast({
        title: "请到记录页查看",
        description: "这条记录没有可直接导出的会话证据。",
        color: "warning",
      });
      return;
    }
    setDrawerBusyAction("export");
    try {
      const result = await localEngineApi.exportAgentSessionEvidence(
        drawerSession.id,
      );
      downloadTextFile(result.filename, result.content, result.mimeType);
      addToast({
        title: "记录已导出",
        description: `${result.evidenceCount} 条记录`,
        color: "success",
      });
    } catch (caught: unknown) {
      addToast({
        title: "导出失败",
        description: toActionableError(caught, "请稍后重试"),
        color: "danger",
      });
    } finally {
      setDrawerBusyAction("");
    }
  };

  const runningCount = sessions.filter(
    (session) => session.status === "running",
  ).length;
  const failedCount = sessions.filter(
    (session) => session.status === "failed",
  ).length;
  const evidenceCount = sessions.reduce(
    (sum, session) =>
      sum + session.events.filter((event) => Boolean(event.evidence)).length,
    0,
  );
  const publishRecordEvidenceCount = publishTasks.reduce(
    (sum, task) => sum + getPublishRecordEvidenceCount(task),
    0,
  );
  const publishFailedCount = publishTasks.filter(
    (task) => getPublishRecordMetrics(task).failed > 0,
  ).length;
  const recentFailures = sessions
    .filter((session) => session.status === "failed")
    .slice(0, 3);
  const recentSessions = sessions.slice(0, 5);
  const recentPublishTasks = publishTasks.slice(0, 6);
  const sessionById = React.useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const lifecycleSessions = [...sessions]
    .sort((left, right) => {
      const priority =
        sessionLifecyclePriority(left) - sessionLifecyclePriority(right);
      if (priority !== 0) return priority;
      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    })
    .slice(0, 3);
  const focusedSession = lifecycleSessions[0] || recentSessions[0] || null;
  const highRiskConfirmations = confirmations.filter(
    (item) => item.riskLevel === "high",
  ).length;

  const metricCards = [
    {
      label: "正在运行",
      value: runningCount,
      detail: "正在处理的发布、互动和自动化任务",
      color: "primary" as const,
    },
    {
      label: "待确认",
      value: confirmations.length,
      detail: highRiskConfirmations
        ? `${highRiskConfirmations} 个高风险动作`
        : "需要人工确认后继续",
      color: confirmations.length ? ("warning" as const) : ("default" as const),
    },
    {
      label: "失败待修复",
      value: failedCount,
      detail: "查看失败步骤、重试或回来源修复",
      color: failedCount ? ("danger" as const) : ("default" as const),
    },
    {
      label: "结果留存",
      value: evidenceCount + publishRecordEvidenceCount,
      detail: "截图、步骤、失败原因和文件记录",
      color: "success" as const,
    },
  ];
  const coreQuickTasks: Array<{
    type: AiEmployeeCoreTaskType;
    title: string;
    detail: string;
    capabilityKey: string;
  }> = [
    {
      type: "workflow.auto",
      title: "自动工作流",
      detail: "剪辑、曝光、发布",
      capabilityKey: "video-template-clip",
    },
    {
      type: "exposure.link",
      title: "链接曝光",
      detail: "线索读取与确认",
      capabilityKey: "douyin-link-exposure",
    },
    {
      type: "ai_service.config_test",
      title: "AI客服测试",
      detail: "规则与回复预览",
      capabilityKey: "wechat-session-reply",
    },
    {
      type: "publish.multi_platform",
      title: "发布记录",
      detail: "账号明细与重试",
      capabilityKey: "publish-douyin-video",
    },
  ];

  const capabilityStatus = (task: { capabilityKey: string }) => {
    const capability = capabilities?.capabilities.find(
      (item) => item.key === task.capabilityKey,
    );
    if (!capability) {
      return {
        label: "待检查",
        tone: "default" as const,
        action: "刷新状态",
        nextAction: "请先刷新能力状态。",
        canPreview: false,
      };
    }
    return {
      label: capabilityStatusLabel(capability),
      tone: capabilityStatusTone(capability),
      action:
        capability.status === "real" || capability.status === "simulated"
          ? "创建预览"
          : capability.status === "needs_config"
            ? "查看条件"
            : "查看原因",
      nextAction: capability.nextAction,
      canPreview:
        capability.status === "real" || capability.status === "simulated",
    };
  };

  /* 移动端原生视图（mx-* 明德 VP 风格）——任务中心总览 + 待确认/运行中快览 + 子页跳转 */
  if (isMobile) {
    const mobileStatusBadge = (status?: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed" || s === "done") return "mx-badge-green";
      if (s === "running" || s === "queued") return "mx-badge-blue";
      if (s === "waiting_for_send_confirmation" || s === "paused") return "mx-badge-gold";
      if (s === "failed" || s === "blocked") return "mx-badge-red";
      return "mx-badge-blue";
    };
    const mobileStatusLabel = (status?: string) => {
      const s = (status || "").toLowerCase();
      if (s === "completed" || s === "done") return "已完成";
      if (s === "running" || s === "queued") return "进行中";
      if (s === "waiting_for_send_confirmation") return "待确认";
      if (s === "paused") return "已暂停";
      if (s === "failed") return "失败";
      if (s === "blocked") return "未执行";
      return status || "未知";
    };
    const runningSessions = sessions.filter((s) =>
      ["running", "queued"].includes((s.status || "").toLowerCase()),
    );
    return (
      <div className="kx-mobile-ambient">
        <div className="mx-px" style={{ paddingTop: 10, paddingBottom: 28 }}>
          <div className="mx-header">
            <div className="mx-page-title">任务中心</div>
            <div className="mx-page-sub">自动工作流、运行、待确认和结果留存在这里处理</div>
          </div>

          {/* 操作条 */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" disabled={loading} onClick={() => void refresh()} style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600 }}>
              {loading ? "刷新中…" : "刷新"}
            </button>
            <Link href="/agent-workbench" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              Agent 工作台
            </Link>
            <Link href="/tasks/confirmations" className="mx-btn-gold" style={{ flex: 1.2, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "9px 0" }}>
              待确认 {confirmations.length}
            </Link>
          </div>

          {error && (
            <div className="mx-card" style={{ marginTop: 10, padding: 11, borderColor: "rgba(220,80,80,.4)" }}>
              <p style={{ fontSize: 12, color: "var(--kaypal-v3-danger)", lineHeight: 1.5 }}>任务中心读取失败，可能是本机服务或登录状态暂时不可用。</p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Link href="/local-engine" style={{ flex: 1, padding: "7px 0", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600, textAlign: "center" }}>设备状态</Link>
                <button type="button" onClick={() => void refresh()} style={{ flex: 1, padding: "7px 0", borderRadius: 9, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 11.5, fontWeight: 600 }}>重新读取</button>
              </div>
            </div>
          )}

          {/* 统计 */}
          <div className="mx-stat-grid" style={{ marginTop: 12 }}>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--kaypal-v3-ink)" }}>{sessions.length + confirmations.length + publishTasks.length}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>任务总数</div>
            </div>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--kaypal-v3-cobalt)" }}>{runningCount}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>运行中</div>
            </div>
            <div className="mx-card" style={{ padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: "var(--kaypal-v3-amber)" }}>{confirmations.length}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>待确认</div>
            </div>
          </div>
          <div className="mx-stat-grid" style={{ marginTop: 8 }}>
            <div className="mx-card" style={{ padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kaypal-v3-danger)" }}>{failedCount}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>失败</div>
            </div>
            <div className="mx-card" style={{ padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kaypal-v3-success)" }}>{publishTasks.length}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>发布记录</div>
            </div>
            <div className="mx-card" style={{ padding: 10, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--kaypal-v3-success)" }}>{evidenceCount + publishRecordEvidenceCount}</div>
              <div style={{ fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 2 }}>证据留存</div>
            </div>
          </div>

          {/* 任务档案（从「我的」页归位：会话/记录/产物统一放任务中心） */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Link href="/tasks/runs" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              会话记录
            </Link>
            <Link href="/tasks/records" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              执行历史
            </Link>
            <Link href="/tasks/evidence" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(120,148,179,.12)", color: "var(--kaypal-v3-ink)", border: "1px solid rgba(142,165,190,.3)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              结果留存
            </Link>
            <Link href="/risk-confirm" style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "rgba(220,80,80,.08)", color: "var(--kaypal-v3-danger)", border: "1px solid rgba(220,80,80,.3)", fontSize: 12, fontWeight: 600, textAlign: "center" }}>
              风险确认
            </Link>
          </div>

          {/* 待确认 */}
          {confirmations.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>待确认（{confirmations.length}）</span>
                <Link href="/tasks/confirmations" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--kaypal-v3-amber)" }}>全部 ›</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {confirmations.slice(0, 3).map((item) => (
                  <Link key={item.id} href="/tasks/confirmations" className="mx-card" style={{ padding: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span className="mx-badge mx-badge-gold" style={{ fontSize: 10, flexShrink: 0 }}>待确认</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {confirmationSessionTitle(item)}
                      </span>
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>
                      {confirmationSourceLabel(item)} · 点击去处理
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {/* 运行中 */}
          {runningSessions.length > 0 && (
            <>
              <div className="mx-section-head" style={{ marginTop: 18, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>运行中（{runningSessions.length}）</span>
                <Link href="/tasks/runs" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--kaypal-v3-amber)" }}>全部 ›</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {runningSessions.slice(0, 3).map((session) => (
                  <Link key={session.id} href="/tasks/runs" className="mx-card" style={{ padding: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span className={`mx-badge ${mobileStatusBadge(session.status)}`} style={{ fontSize: 10, flexShrink: 0 }}>
                        {mobileStatusLabel(session.status)}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {taskDisplayText(session.title, "任务")}
                      </span>
                    </span>
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--kaypal-v3-muted)", marginTop: 5 }}>
                      {sourceLabel(session.source)} · {formatDateTime(session.updatedAt || session.createdAt)}
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}

          {/* 快捷入口 */}
          <div className="mx-section-head" style={{ marginTop: 18 }}>快捷入口</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Link href="/tasks/runs" className="mx-card" style={{ padding: 12, fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>正在运行 ›</Link>
            <Link href="/tasks/records" className="mx-card" style={{ padding: 12, fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>任务历史 ›</Link>
            <Link href="/tasks/evidence" className="mx-card" style={{ padding: 12, fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>执行留痕 ›</Link>
            <Link href="/distribution/tasks" className="mx-card" style={{ padding: 12, fontSize: 12.5, fontWeight: 600, color: "var(--kaypal-v3-ink)" }}>发布记录 ›</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    /* B0 容器收编（2026-08-23）：/tasks 为场景路由，根统一 kx-view（34px gutter + 880 居中），
       astryx Layout 仅作内部布局组件，页面级边距由 kx-view 供给 */
    <div className="kx-view">
    <div className="min-h-full">
      <div className="p-0">
          <div className="flex flex-col gap-3">
            <div className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                <span className="text-sm text-default-500">
                  商业增长 · 任务中心
                </span>
                <h1 className="text-2xl font-bold kx-greet">任务中心</h1>
                <span className="text-default-500">
                  自动工作流、正在运行、待确认、失败修复和结果留存在同一个操作台处理。
                </span>
                </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  as={Link}
                  href="/agent-workbench"
                  size="sm"
                  startContent={<Icon icon="solar:chat-round-dots-linear" />}
                  variant="flat"
                >
                  Agent 工作台
                </Button>
                <Button
                  isDisabled={!focusedSession}
                  size="sm"
                  startContent={<Icon icon="solar:radio-linear" />}
                  variant="flat"
                  onPress={() => {
                    if (focusedSession) {
                      void openAgentDrawer(focusedSession);
                    }
                  }}
                >
                  AI专家状态
                </Button>
                <Button
                  as={Link}
                  color="warning"
                  href="/tasks/confirmations"
                  size="sm"
                  variant="flat"
                >
                  待确认 {confirmations.length}
                </Button>
                <Button
                  color="primary"
                  isLoading={loading}
                  size="sm"
                  startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
                  variant="flat"
                  onPress={refresh}
                >
                  刷新
                </Button>
              </div>
            </div>
          </div>
        </div>
      <OpsDesktopPage>
      <OpsToolbar>
        <OpsMetric
          label="任务总数"
          tone="brand"
          value={sessions.length + confirmations.length + publishTasks.length}
        />
        <OpsMetric label="运行中" tone="warning" value={runningCount} />
        <OpsMetric label="待确认" tone="warning" value={confirmations.length} />
        <OpsMetric label="失败" tone="danger" value={failedCount} />
        <OpsMetric
          label="发布记录"
          tone="success"
          value={publishTasks.length}
        />
        <OpsMetric
          label="证据"
          tone="success"
          value={evidenceCount + publishRecordEvidenceCount}
        />
      </OpsToolbar>

      {error ? (
        <FailureActionPanel
          actions={[
            { href: "/local-engine", label: "设备状态" },
            {
              label: "重新读取",
              onPress: () => {
                refresh();
              },
            },
          ]}
          impact="正在运行、待确认、失败修复和结果留存暂时无法汇总。"
          nextAction="先确认设备状态和本机服务可用，再重新读取任务中心。"
          reason="任务中心读取失败，可能是本机服务、登录状态或网络连接暂时不可用。"
          technicalDetails={error}
          title="任务中心需要处理"
        />
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <OpsPanel
          extra={
            <Button
              as={Link}
              href="/local-engine"
              size="sm"
              startContent={<Icon icon="solar:settings-linear" />}
              variant="flat"
            >
              本机状态
            </Button>
          }
          title="AI员工快捷任务"
        >
          <OpsToolbar className="mb-3">
            <OpsStatusPill tone="success">
              已接通 {capabilities?.summary.real ?? 0}
            </OpsStatusPill>
            <OpsStatusPill tone="brand">
              可预览 {capabilities?.summary.simulated ?? 0}
            </OpsStatusPill>
            <OpsStatusPill tone="warning">
              待配置 {capabilities?.summary.needsConfig ?? 0}
            </OpsStatusPill>
            <OpsStatusPill>
              不可用 {capabilities?.summary.unavailable ?? 0}
            </OpsStatusPill>
          </OpsToolbar>
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>覆盖内容</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {coreQuickTasks.map((task) => {
                  const status = capabilityStatus(task);
                  return (
                    <tr key={task.type}>
                      <td className="font-semibold">{task.title}</td>
                      <td>{task.detail}</td>
                      <td>
                        <OpsStatusPill tone={status.tone}>
                          {status.label}
                        </OpsStatusPill>
                      </td>
                      <td>
                        <Button
                          color="primary"
                          data-testid={`core-task-preview-${task.type}`}
                          isLoading={previewBusy === task.type}
                          size="sm"
                          variant="flat"
                          onPress={() => {
                            if (status.canPreview) {
                              void createPreviewTask(task.type, task.title);
                              return;
                            }
                            if (status.action === "刷新状态") {
                              void refresh();
                              return;
                            }
                            addToast({
                              title: status.label,
                              description: status.nextAction,
                              color: "warning",
                            });
                          }}
                        >
                          {status.action}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>

        <OpsPanel title="执行看板">
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>数量</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {metricCards.map((metric) => (
                  <tr key={metric.label}>
                    <td className="font-semibold">{metric.label}</td>
                    <td>
                      <Chip color={metric.color} size="sm" variant="flat">
                        {metric.value}
                      </Chip>
                    </td>
                    <td>{metric.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      </div>

      <OpsPanel
        extra={
          <Chip
            color={
              workflowForm.riskLevel === "high"
                ? "danger"
                : workflowForm.riskLevel === "medium"
                  ? "warning"
                  : "success"
            }
            size="sm"
            variant="flat"
          >
            {workflowRiskLabel(workflowForm.riskLevel)}
          </Chip>
        }
        title="AI员工自动工作流"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-13 leading-5 text-default-500">
              保存后启动可执行步骤；未满足条件的步骤单独保留原因，不影响其他步骤运行。
            </p>
          </div>
        </div>
        <div className="mb-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {[
            {
              key: "clip",
              label: "模板剪辑",
              selected: workflowForm.includeVideoClip,
            },
            {
              key: "exposure",
              label: "候选读取",
              selected: workflowForm.includeExposure,
            },
            {
              key: "publish",
              label: "平台发布",
              selected: workflowForm.includePublish,
            },
          ].map((item) => (
            <div
              key={item.key}
              className="flex h-[46px] items-center justify-between rounded-[6px] border border-divider bg-default-50 px-3"
            >
              <span className="text-13 font-medium text-default-700">
                {item.label}
              </span>
              <OpsStatusPill tone={item.selected ? "brand" : "default"}>
                {item.selected ? "已选择" : "未选择"}
              </OpsStatusPill>
            </div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Input
            label="任务名称"
            size="sm"
            value={workflowForm.title}
            onValueChange={(value) => updateWorkflowForm("title", value)}
          />
          <Select
            label="平台"
            selectedKeys={[workflowForm.platform]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0];
              if (typeof value === "string") {
                updateWorkflowForm("platform", value);
              }
            }}
          >
            {workflowPlatformOptions.map((option) => (
              <SelectItem key={option.key}>{option.label}</SelectItem>
            ))}
          </Select>
          <Select
            isDisabled={!workflowForm.includeExposure}
            label="候选读取方式"
            selectedKeys={[workflowForm.exposureMode]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0];
              if (
                value === "link" ||
                value === "search_account" ||
                value === "hot_video" ||
                value === "targeted" ||
                value === "retention"
              ) {
                updateWorkflowForm("exposureMode", value);
              }
            }}
          >
            {workflowExposureOptions.map((option) => (
              <SelectItem key={option.key}>{option.label}</SelectItem>
            ))}
          </Select>
          <Input
            label="账号"
            placeholder="主账号/门店账号"
            size="sm"
            value={workflowForm.account}
            onValueChange={(value) => updateWorkflowForm("account", value)}
          />
          <Input
            label={
              workflowForm.exposureMode === "link" ? "视频或内容" : "内容或目标"
            }
            placeholder={
              workflowForm.exposureMode === "link"
                ? "粘贴抖音视频链接，或填写要处理的内容"
                : "填写关键词、目标账号或线索来源"
            }
            size="sm"
            value={workflowForm.material}
            onValueChange={(value) => updateWorkflowForm("material", value)}
          />
          <Input
            label="频率"
            placeholder="每天 1 次"
            size="sm"
            value={workflowForm.frequency}
            onValueChange={(value) => updateWorkflowForm("frequency", value)}
          />
          <Input
            label="时间窗"
            placeholder="09:00-18:00"
            size="sm"
            value={workflowForm.timeWindow}
            onValueChange={(value) => updateWorkflowForm("timeWindow", value)}
          />
          <Select
            label="风险级别"
            selectedKeys={[workflowForm.riskLevel]}
            size="sm"
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0];
              if (value === "low" || value === "medium" || value === "high") {
                updateWorkflowForm("riskLevel", value);
              }
            }}
          >
            {workflowRiskOptions.map((option) => (
              <SelectItem key={option.key}>{option.label}</SelectItem>
            ))}
          </Select>
          <div className="flex min-h-[48px] flex-wrap items-center gap-x-5 gap-y-2 lg:col-span-3">
            <Switch
              isSelected={workflowForm.includeVideoClip}
              size="sm"
              onValueChange={(value) =>
                updateWorkflowForm("includeVideoClip", value)
              }
            >
              模板剪辑
            </Switch>
            <Switch
              isSelected={workflowForm.includeExposure}
              size="sm"
              onValueChange={(value) =>
                updateWorkflowForm("includeExposure", value)
              }
            >
              候选读取
            </Switch>
            <Switch
              isSelected={workflowForm.includePublish}
              size="sm"
              onValueChange={(value) =>
                updateWorkflowForm("includePublish", value)
              }
            >
              平台发布
            </Switch>
          </div>
          <Textarea
            className="lg:col-span-2"
            label="执行目标"
            minRows={2}
            size="sm"
            value={workflowForm.goal}
            onValueChange={(value) => updateWorkflowForm("goal", value)}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            isDisabled={workflowSubmitting}
            variant="flat"
            onPress={() => setWorkflowForm(initialWorkflowForm)}
          >
            恢复示例
          </Button>
          <Button
            color="primary"
            data-testid="prepare-workflow"
            isLoading={workflowSubmitting}
            startContent={
              workflowSubmitting ? null : (
                <Icon icon="solar:play-circle-linear" />
              )
            }
            onPress={createWorkflow}
          >
            保存工作流
          </Button>
        </div>
        {workflowPreparation ? (
          <div className="mt-3 rounded-[6px] border border-divider bg-default-50/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <OpsStatusPill
                  tone={
                    workflowPreparation.displayStatus === "ready"
                      ? "success"
                      : "warning"
                  }
                >
                  {workflowPreparation.displayStatus === "ready"
                    ? "可以启动"
                    : workflowPreparation.displayStatus === "partially_ready"
                      ? "部分可启动"
                      : "需要配置"}
                </OpsStatusPill>
                <span className="text-13 font-medium text-default-700">
                  {workflowPreparation.message}
                </span>
              </div>
              <Button
                color="primary"
                isDisabled={
                  !workflowPreparation.steps.some(
                    (step) => step.availability === "available",
                  )
                }
                isLoading={
                  workflowBusyAction ===
                  `start:${workflowPreparation.definition.id}`
                }
                size="sm"
                startContent={<Icon icon="solar:play-circle-linear" />}
                onPress={() =>
                  void startSavedWorkflow(workflowPreparation.definition)
                }
              >
                启动可执行步骤
              </Button>
            </div>
            <p className="mt-2 text-13 leading-5 text-default-600">
              {workflowPreparation.nextAction}
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {workflowPreparation.steps.map((step) => (
                <div
                  key={step.id}
                  className="rounded-[6px] border border-divider bg-background/80 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-13 font-medium text-default-700">
                      {step.title}
                    </span>
                    <OpsStatusPill
                      tone={
                        step.availability === "available"
                          ? "success"
                          : step.capabilityStatus === "needs_config"
                            ? "warning"
                            : step.capabilityStatus === "simulated"
                              ? "brand"
                              : "danger"
                      }
                    >
                      {step.availability === "available" ? "可运行" : "待处理"}
                    </OpsStatusPill>
                  </div>
                  <p className="mt-1 text-tiny leading-5 text-default-500">
                    {step.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 border-t border-divider pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-13 font-semibold text-default-700">
              已保存工作流
            </h3>
            <span className="text-tiny text-default-400">
              {workflowDefinitions.length} 个定义
            </span>
          </div>
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>工作流</th>
                  <th>步骤</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {workflowDefinitions.slice(0, 6).map((definition) => (
                  <tr key={definition.id}>
                    <td>
                      <div className="font-semibold">{definition.title}</div>
                      {definition.schedule ? (
                        <div className="mt-1 text-tiny text-default-400">
                          {definition.schedule.status === "active"
                            ? `计划已启用 · 下次 ${formatDateTime(definition.schedule.nextRunAt)}`
                            : "计划等待首次启动确认"}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {
                        definition.steps.filter(
                          (step) => step.availability === "available",
                        ).length
                      }
                      /{definition.steps.length} 可运行
                    </td>
                    <td>
                      <OpsStatusPill
                        tone={
                          definition.status === "ready"
                            ? "success"
                            : definition.status === "partially_ready"
                              ? "warning"
                              : "default"
                        }
                      >
                        {definition.status === "ready"
                          ? "已就绪"
                          : definition.status === "partially_ready"
                            ? "部分就绪"
                            : "待配置"}
                      </OpsStatusPill>
                    </td>
                    <td>{formatDateTime(definition.updatedAt)}</td>
                    <td>
                      <Button
                        color="primary"
                        isDisabled={
                          !definition.steps.some(
                            (step) => step.availability === "available",
                          )
                        }
                        isLoading={
                          workflowBusyAction === `start:${definition.id}`
                        }
                        size="sm"
                        startContent={<Icon icon="solar:play-circle-linear" />}
                        variant="flat"
                        onPress={() => void startSavedWorkflow(definition)}
                      >
                        启动
                      </Button>
                    </td>
                  </tr>
                ))}
                {!loading && workflowDefinitions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>还没有保存工作流。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </div>

        <div className="mt-4 border-t border-divider pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-13 font-semibold text-default-700">
              最近运行
            </h3>
            <span className="text-tiny text-default-400">
              仅将有结果凭证且已确认的步骤计为完成
            </span>
          </div>
          <OpsDenseTable>
            <table>
              <thead>
                <tr>
                  <th>运行</th>
                  <th>步骤状态</th>
                  <th>结果</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {workflowRuns.slice(0, 8).map((run) => {
                  const canRetry = run.steps.some(
                    (step) =>
                      step.status === "failed" ||
                      step.status === "blocked" ||
                      step.status === "cancelled",
                  );
                  const canCancel =
                    run.status === "queued" || run.status === "running";
                  return (
                    <tr key={run.id}>
                      <td>
                        <div className="max-w-[260px]">
                          <div className="truncate font-semibold">
                            {run.title}
                          </div>
                          <div className="mt-1">
                            <OpsStatusPill
                              tone={workflowRunStatusTone(run.status)}
                            >
                              {workflowRunStatusLabel(run.status)}
                            </OpsStatusPill>
                            <span className="ml-2 text-tiny text-default-400">
                              {run.trigger === "schedule"
                                ? "按计划运行"
                                : run.trigger === "retry"
                                  ? "人工重试"
                                  : "人工启动"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex max-w-[360px] flex-wrap gap-1">
                          {run.steps.map((step) => (
                            <OpsStatusPill
                              key={`${run.id}-${step.stepId}`}
                              tone={workflowStepStatusTone(step.status)}
                            >
                              {step.title} ·{" "}
                              {workflowStepStatusLabel(step.status)}
                            </OpsStatusPill>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="text-tiny leading-5 text-default-600">
                          {run.aggregate.completedSteps}/
                          {run.aggregate.totalSteps} 完成 ·{" "}
                          {run.aggregate.evidenceCount} 条证据
                          {run.aggregate.candidateCount
                            ? ` · ${run.aggregate.candidateCount} 条候选`
                            : ""}
                        </div>
                        {run.aggregate.readbacks.length ? (
                          <div className="text-tiny text-default-400">
                            结果确认{" "}
                            {
                              run.aggregate.readbacks.filter(
                                (item) => item.matched,
                              ).length
                            }
                            /{run.aggregate.readbacks.length} 匹配
                          </div>
                        ) : null}
                      </td>
                      <td>{formatDateTime(run.updatedAt)}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {canRetry ? (
                            <Button
                              isLoading={
                                workflowBusyAction === `retry:${run.id}`
                              }
                              size="sm"
                              startContent={
                                <Icon icon="solar:restart-linear" />
                              }
                              variant="flat"
                              onPress={() => void retrySavedWorkflow(run)}
                            >
                              重试未完成
                            </Button>
                          ) : null}
                          {canCancel ? (
                            <Button
                              color="warning"
                              isLoading={
                                workflowBusyAction === `cancel:${run.id}`
                              }
                              size="sm"
                              startContent={
                                <Icon icon="solar:stop-circle-linear" />
                              }
                              variant="flat"
                              onPress={() => void cancelSavedWorkflow(run)}
                            >
                              取消
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && workflowRuns.length === 0 ? (
                  <tr>
                    <td colSpan={5}>还没有工作流运行记录。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </div>
      </OpsPanel>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <OpsPanel title="审批后执行流程">
          {loading ? <SkeletonList rows={3} /> : null}
          <OpsDenseTable className="mt-3">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {lifecycleSessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <div className="max-w-[360px]">
                        <div className="truncate font-semibold">
                          {sessionDisplayTitle(session)}
                        </div>
                        <WorkflowConfigSummary compact session={session} />
                        <ExposureConfigSummary compact session={session} />
                      </div>
                    </td>
                    <td>{sourceLabel(session.source)}</td>
                    <td>
                      <Chip
                        color={visibleAgentStatusColor(session)}
                        size="sm"
                        variant="flat"
                      >
                        {visibleAgentStatusText(session)}
                      </Chip>
                    </td>
                    <td>{formatDateTime(session.updatedAt)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          startContent={<Icon icon="solar:radio-linear" />}
                          variant="flat"
                          onPress={() => {
                            void openAgentDrawer(session);
                          }}
                        >
                          状态
                        </Button>
                        <Button
                          as={Link}
                          href={agentSessionRecordHref(session.id)}
                          size="sm"
                          variant="flat"
                        >
                          记录
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && lifecycleSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5}>当前没有审批后执行流程。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>

        <OpsPanel title="待处理确认">
          {loading ? <SkeletonList rows={3} /> : null}
          <OpsDenseTable className="mt-3">
            <table>
              <thead>
                <tr>
                  <th>确认任务</th>
                  <th>风险</th>
                  <th>来源</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {confirmations.slice(0, 6).map((item) => {
                  const session = sessionById.get(item.sessionId);
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="max-w-[320px]">
                          <div className="truncate font-semibold">
                            {confirmationSessionTitle(item)}
                          </div>
                          <div className="mt-1 line-clamp-2 text-12 text-default-500">
                            {commercialDisplayText(
                              item.description || item.actionLabel,
                            )}
                          </div>
                          <WorkflowConfigSummary compact session={session} />
                          <ExposureConfigSummary compact session={session} />
                        </div>
                      </td>
                      <td>
                        <Chip
                          color={
                            item.riskLevel === "high" ? "danger" : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {item.riskLevel === "high" ? "高风险" : "中风险"}
                        </Chip>
                      </td>
                      <td>{confirmationSourceLabel(item)}</td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          {session ? (
                            <Button
                              size="sm"
                              startContent={<Icon icon="solar:radio-linear" />}
                              variant="flat"
                              onPress={() => {
                                void openAgentDrawer(session);
                              }}
                            >
                              状态
                            </Button>
                          ) : null}
                          <Button
                            as={Link}
                            href={agentSessionRecordHref(
                              item.session?.id || item.sessionId,
                            )}
                            size="sm"
                            variant="flat"
                          >
                            处理
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && confirmations.length === 0 ? (
                  <tr>
                    <td colSpan={4}>当前没有待确认动作。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </OpsDenseTable>
        </OpsPanel>
      </div>

      <OpsPanel
        extra={
          <Button
            as={Link}
            href="/distribution/tasks"
            size="sm"
            startContent={<Icon icon="solar:document-text-linear" />}
            variant="flat"
          >
            打开发布记录
          </Button>
        }
        title="发布结果留存"
      >
        <OpsToolbar className="mb-3">
          <OpsStatusPill tone="brand">记录 {publishTasks.length}</OpsStatusPill>
          <OpsStatusPill tone={publishFailedCount ? "danger" : "default"}>
            失败 {publishFailedCount}
          </OpsStatusPill>
          <OpsStatusPill tone="success">
            证据 {publishRecordEvidenceCount}
          </OpsStatusPill>
        </OpsToolbar>
        <OpsDenseTable>
          <table>
            <thead>
              <tr>
                <th>发布记录</th>
                <th>状态</th>
                <th>结果</th>
                <th>证据</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {recentPublishTasks.map((task) => {
                const metrics = getPublishRecordMetrics(task);
                const evidenceTotal = getPublishRecordEvidenceCount(task);
                const failureReason = getPublishRecordFailureReason(task);
                return (
                  <tr key={task.id}>
                    <td>
                      <div className="max-w-[360px]">
                        <div className="truncate font-semibold">
                          {displayPublishRecordTitle(task.title)}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Chip size="sm" variant="flat">
                            #{task.id}
                          </Chip>
                          <Chip size="sm" variant="flat">
                            {getPublishRecordModeLabel(task)}
                          </Chip>
                          {task.account_file ? (
                            <Chip size="sm" variant="flat">
                              {displayPublishRecordFileName(
                                task.account_file,
                                "账号",
                              )}
                            </Chip>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <Chip
                        color={getPublishRecordStatusColor(task.status)}
                        size="sm"
                        variant="flat"
                      >
                        {resolvePublishRecordStatus(task.status)}
                      </Chip>
                    </td>
                    <td>
                      <div className="min-w-[150px] text-tiny leading-5 text-default-500">
                        <span className="font-semibold text-success">
                          成功 {metrics.succeeded}
                        </span>
                        <span className="mx-1">/</span>
                        <span className="font-semibold text-danger">
                          失败 {metrics.failed}
                        </span>
                        <span className="mx-1">/</span>
                        <span>待处理 {metrics.waiting}</span>
                        {failureReason ? (
                          <p className="mt-1 line-clamp-2 text-warning-700">
                            {failureReason}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <OpsStatusPill
                        tone={evidenceTotal ? "success" : "default"}
                      >
                        {evidenceTotal}
                      </OpsStatusPill>
                    </td>
                    <td>{formatDateTime(task.updated_at)}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          startContent={<Icon icon="solar:radio-linear" />}
                          variant="flat"
                          onPress={() =>
                            setDrawerSession(
                              buildPublishRecordAgentSession(task),
                            )
                          }
                        >
                          状态
                        </Button>
                        <Button
                          as={Link}
                          href="/distribution/tasks"
                          size="sm"
                          variant="flat"
                        >
                          明细
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && recentPublishTasks.length === 0 ? (
                <tr>
                  <td colSpan={6}>暂无发布记录留存。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </OpsDenseTable>
      </OpsPanel>

      <OpsPanel title="最近运行">
        {loading ? <SkeletonList rows={3} /> : null}
        <OpsDenseTable className="mt-3">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>来源</th>
                <th>状态</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <div className="max-w-[420px]">
                      <div className="truncate font-semibold">
                        {sessionDisplayTitle(session)}
                      </div>
                      <WorkflowConfigSummary compact session={session} />
                      <ExposureConfigSummary compact session={session} />
                    </div>
                  </td>
                  <td>{sourceLabel(session.source)}</td>
                  <td>
                    <Chip
                      color={visibleAgentStatusColor(session)}
                      size="sm"
                      variant="flat"
                    >
                      {visibleAgentStatusText(session)}
                    </Chip>
                  </td>
                  <td>{formatDateTime(session.updatedAt)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        startContent={<Icon icon="solar:radio-linear" />}
                        variant="flat"
                        onPress={() => {
                          void openAgentDrawer(session);
                        }}
                      >
                        状态
                      </Button>
                      <Button
                        as={Link}
                        href={agentSessionRecordHref(session.id)}
                        size="sm"
                        variant="flat"
                      >
                        记录
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && recentSessions.length === 0 ? (
                <tr>
                  <td colSpan={5}>暂无任务历史。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </OpsDenseTable>
      </OpsPanel>

      <OpsPanel title="全部任务记录">
        {loading ? <SkeletonList rows={3} /> : null}
        <OpsDenseTable className="mt-3">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>来源</th>
                <th>状态</th>
                <th>模式</th>
                <th>更新时间</th>
                <th>下一步</th>
              </tr>
            </thead>
            <tbody>
              {automationTasks.slice(0, 8).map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="max-w-[360px]">
                      <div className="truncate font-semibold">{item.title}</div>
                      <div className="mt-1 text-tiny text-default-500">
                        {automationTaskTypeLabel(item.taskType)}
                      </div>
                    </div>
                  </td>
                  <td>
                    {item.source === "agent-session"
                      ? "自动化会话"
                      : "互动任务"}
                  </td>
                  <td>
                    <Chip
                      color={automationStatusColor(item.status)}
                      size="sm"
                      variant="flat"
                    >
                      {item.statusLabel}
                    </Chip>
                  </td>
                  <td>
                    {item.executionMode === "simulated"
                      ? "预演"
                      : item.executionMode === "blocked"
                        ? "受阻"
                        : item.executionMode === "configuration"
                          ? "配置"
                          : "执行"}
                  </td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                  <td>
                    <div className="max-w-[260px] text-tiny leading-5 text-default-500">
                      {item.nextAction || item.failureReason || "查看任务详情"}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && automationTasks.length === 0 ? (
                <tr>
                  <td colSpan={6}>暂无统一任务记录。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </OpsDenseTable>
      </OpsPanel>

      {recentFailures.length ? (
        <FailureActionPanel
          actions={[{ label: "重新读取", onPress: refresh }]}
          impact={`${recentFailures.length} 个任务没有完成，可能影响发布、互动或自动化结果。`}
          nextAction="进入失败记录查看阶段、原因和下一步，再决定重试、跳过或回来源修复。"
          reason={recentFailures
            .map(
              (session) =>
                `${commercialDisplayText(session.title || session.instruction)}：${commercialDisplayText(
                  session.nextAction || "查看任务历史定位失败步骤",
                )}`,
            )
            .join("；")}
          technicalDetails={recentFailures.flatMap(sessionFailureDetails)}
          title="失败待修复"
        />
      ) : null}
      <WorkflowRunConfirmationModal
        checked={workflowConfirmationChecked}
        request={workflowConfirmation}
        busy={Boolean(
          workflowConfirmation &&
          workflowBusyAction ===
            (workflowConfirmation.kind === "start"
              ? `start:${workflowConfirmation.definition.id}`
              : `retry:${workflowConfirmation.run.id}`),
        )}
        onCheckedChange={setWorkflowConfirmationChecked}
        onClose={() => {
          if (!workflowBusyAction) {
            setWorkflowConfirmation(null);
            setWorkflowConfirmationChecked(false);
          }
        }}
        onConfirm={() => void confirmWorkflowAction()}
      />
      <ClearRecordConfirmationModal
        busy={clearRecordBusy}
        session={clearRecordTarget}
        onClose={() => {
          if (!clearRecordBusy) setClearRecordTarget(null);
        }}
        onConfirm={() => void clearDrawerRecord()}
      />
      <AgentStatusDrawer
        busyAction={drawerBusyAction}
        loading={drawerLoading}
        session={drawerSession}
        onClose={() => setDrawerSession(null)}
        onClear={setClearRecordTarget}
        onContinue={continueDrawerSession}
        onExport={exportDrawerSession}
        onOpenRecord={(session) =>
          session.id.startsWith("interaction-task:publish-record:")
            ? "/distribution/tasks"
            : agentSessionRecordHref(session.id)
        }
        onStop={stopDrawerSession}
      />
    </OpsDesktopPage>
    </div>
    </div>
  );
}

function WorkflowRunConfirmationModal({
  request,
  checked,
  busy,
  onCheckedChange,
  onClose,
  onConfirm,
}: {
  request: WorkflowConfirmationRequest | null;
  checked: boolean;
  busy: boolean;
  onCheckedChange: (checked: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const definition =
    request?.kind === "start" ? request.definition : request?.definition;
  const run = request?.kind === "retry" ? request.run : undefined;
  const config = toRecord(definition?.config);
  const frequency =
    definition?.schedule?.frequency || toDisplayText(config.frequency);
  const timeWindow =
    definition?.schedule?.timeWindow || toDisplayText(config.timeWindow);
  const steps = definition?.steps || run?.steps || [];
  const containsExternalActions = Boolean(
    definition?.executionPolicy.hasCustomerActions ||
    definition?.executionPolicy.hasPlatformActions ||
    run?.executionPolicy.hasCustomerActions ||
    run?.executionPolicy.hasPlatformActions,
  );

  return (
    <Modal
      hideCloseButton={busy}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      isOpen={Boolean(request)}
      placement="center"
      scrollBehavior="inside"
      size="lg"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 border-b border-divider">
          <span>
            {request?.kind === "retry" ? "确认重试工作流" : "确认启动工作流"}
          </span>
          <span className="text-small font-normal text-default-500">
            {taskDisplayText(definition?.title || run?.title, "工作流")}
          </span>
        </ModalHeader>
        <ModalBody className="gap-4 py-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[8px] border border-divider p-3">
              <p className="text-tiny text-default-400">运行账号</p>
              <p className="mt-1 break-all text-small font-semibold text-default-800">
                {definition?.accountId || "按工作流配置"}
              </p>
            </div>
            <div className="rounded-[8px] border border-divider p-3">
              <p className="text-tiny text-default-400">运行安排</p>
              <p className="mt-1 text-small font-semibold text-default-800">
                {frequency && timeWindow
                  ? `${frequency}，${timeWindow}`
                  : "仅本次运行"}
              </p>
            </div>
          </div>

          {containsExternalActions ? (
            <div className="rounded-[8px] border border-warning-300 bg-warning-50 p-3 text-small leading-6 text-warning-800">
              此工作流包含评论、私信或平台发布动作。请核对账号、目标和内容。
            </div>
          ) : null}
          {definition?.schedule?.status === "awaiting_confirmation" ? (
            <div className="rounded-[8px] border border-primary-200 bg-primary-50 p-3 text-small leading-6 text-primary-800">
              本次确认后，已填写的频率和时间窗会开始生效。
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-small font-semibold text-default-800">
              本次步骤
            </p>
            <div className="grid gap-2">
              {steps.map((step) => (
                <div
                  key={"id" in step ? step.id : step.stepId}
                  className="flex items-center justify-between gap-3 rounded-[8px] border border-divider px-3 py-2"
                >
                  <span className="min-w-0 text-small font-medium text-default-700">
                    {taskDisplayText(step.title, "未命名步骤")}
                  </span>
                  <Chip size="sm" variant="flat">
                    {"availability" in step
                      ? step.availability === "available"
                        ? "可运行"
                        : "待处理"
                      : workflowStepStatusLabel(step.status)}
                  </Chip>
                </div>
              ))}
            </div>
          </div>

          <Checkbox isSelected={checked} onValueChange={onCheckedChange}>
            我已核对账号、目标、内容和运行时间
          </Checkbox>
        </ModalBody>
        <ModalFooter className="border-t border-divider">
          <Button isDisabled={busy} variant="light" onPress={onClose}>
            取消
          </Button>
          <Button
            color="primary"
            isDisabled={!checked}
            isLoading={busy}
            startContent={
              busy ? null : <Icon icon="solar:play-circle-linear" />
            }
            onPress={onConfirm}
          >
            {request?.kind === "retry" ? "确认重试" : "确认启动"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ClearRecordConfirmationModal({
  session,
  busy,
  onClose,
  onConfirm,
}: {
  session: AgentSession | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      hideCloseButton={busy}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      isOpen={Boolean(session)}
      placement="center"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>清空任务记录</ModalHeader>
        <ModalBody>
          <p className="text-small leading-6 text-default-600">
            “{session ? sessionDisplayTitle(session) : "这条记录"}
            ”将从任务列表移除，待确认动作也会关闭，必要的留痕仍会保留。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button isDisabled={busy} variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="danger" isLoading={busy} onPress={onConfirm}>
            确认清空
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function AgentStatusDrawer({
  busyAction,
  loading,
  session,
  onClose,
  onClear,
  onContinue,
  onExport,
  onOpenRecord,
  onStop,
}: {
  busyAction: "" | "continue" | "stop" | "export";
  loading: boolean;
  session: AgentSession | null;
  onClose: () => void;
  onClear: (session: AgentSession) => void;
  onContinue: () => void;
  onExport: () => void;
  onOpenRecord: (session: AgentSession) => string;
  onStop: () => void;
}) {
  if (!session) return null;

  const evidenceEvents = session.events.filter((event) => event.evidence);
  const failureDetails = sessionFailureDetails(session);
  const canControl = canControlAgentSession(session);
  const hasPendingConfirmation =
    session.status === "waiting_for_confirmation" ||
    session.confirmations.some((item) => item.status === "pending");
  const canContinue =
    canControl &&
    !hasPendingConfirmation &&
    session.status !== "completed" &&
    session.status !== "cancelled";
  const canStop =
    canControl &&
    (session.status === "running" ||
      session.status === "waiting_for_confirmation" ||
      session.status === "draft");
  const lifecycleSession = hasPendingConfirmation
    ? {
        ...session,
        status: "waiting_for_confirmation" as const,
        statusLabel: "待我确认",
      }
    : session;
  const statusBoard = [
    {
      key: "ready",
      title: "准备",
      active:
        session.status === "draft" ||
        session.status === "waiting_for_confirmation",
      detail:
        session.status === "waiting_for_confirmation"
          ? "等待你确认"
          : "配置已读取",
    },
    {
      key: "running",
      title: "执行中",
      active: session.status === "running",
      detail: session.status === "running" ? "正在处理" : "待运行",
    },
    {
      key: "success",
      title: "成功",
      active: session.status === "completed" && !hasPendingConfirmation,
      detail:
        session.status === "completed" && !hasPendingConfirmation
          ? "已完成"
          : hasPendingConfirmation
            ? "等待确认"
            : "暂无完成",
    },
    {
      key: "error",
      title: "异常",
      active: session.status === "failed" || failureDetails.length > 0,
      detail: failureDetails[0]
        ? commercialDisplayText(failureDetails[0])
        : "暂无异常",
    },
  ];

  return (
    <div className="kx-overlay-anim fixed inset-0 z-50 flex justify-end bg-black/30">
      <button
        aria-label="关闭AI专家状态抽屉"
        className="absolute inset-0 cursor-default"
        type="button"
        onClick={onClose}
      />
      <aside className="kx-drawer-panel-anim relative flex h-full w-full max-w-[620px] flex-col border-l border-divider bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-divider p-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Chip
                color={visibleAgentStatusColor(session)}
                size="sm"
                variant="flat"
              >
                {visibleAgentStatusText(session)}
              </Chip>
              <Chip
                color={session.riskLevel === "high" ? "danger" : "warning"}
                size="sm"
                variant="flat"
              >
                {agentRiskLabel(session.riskLevel)}
              </Chip>
              <Chip size="sm" variant="flat">
                {sourceLabel(session.source)}
              </Chip>
            </div>
            <p className="text-12 font-medium text-[#f759ab]">AI专家状态</p>
            <h3 className="line-clamp-2 text-base font-bold leading-6 text-default-900">
              {sessionDisplayTitle(session)}
            </h3>
            <p className="mt-1 text-tiny text-default-500">
              更新于 {formatDateTime(session.updatedAt)}
            </p>
          </div>
          <Button isIconOnly size="sm" variant="light" onPress={onClose}>
            <Icon icon="solar:close-circle-linear" width={18} />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? <SkeletonList rows={3} /> : null}
          <div className="grid gap-4">
            <section className="rounded-[8px] border border-divider bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-14 font-semibold text-foreground">
                  状态反馈
                </h4>
                <Button
                  color="danger"
                  isDisabled={!canControl}
                  size="sm"
                  variant="flat"
                  onPress={() => onClear(session)}
                >
                  清空记录
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                {statusBoard.map((item) => (
                  <div
                    key={item.key}
                    className={`min-h-[86px] rounded-[6px] border p-3 ${
                      item.active
                        ? "border-[#f759ab] bg-[#fff0f6] dark:bg-[#f759ab]/15"
                        : "border-divider bg-default-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-13 font-semibold text-foreground">
                        {item.title}
                      </span>
                      <OpsStatusPill tone={item.active ? "brand" : "default"}>
                        {item.active ? "当前" : "待定"}
                      </OpsStatusPill>
                    </div>
                    <p className="mt-2 line-clamp-2 text-12 leading-5 text-default-500">
                      {item.detail}
                    </p>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-[8px] border-small border-divider p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="text-small font-semibold text-default-900">
                  当前进度
                </h4>
                <Button
                  as={Link}
                  href={onOpenRecord(session)}
                  size="sm"
                  variant="flat"
                >
                  查看记录
                </Button>
              </div>
              <AgentSessionLifecycleStepper
                compact
                showActions
                session={lifecycleSession}
              />
              {session.nextAction ? (
                <p className="mt-3 rounded-small bg-default-50 p-2 text-small text-default-600">
                  下一步：{commercialDisplayText(session.nextAction)}
                </p>
              ) : null}
              {failureDetails.length ? (
                <div className="mt-3 rounded-small border-small border-danger-200 bg-danger-50 p-2">
                  <p className="text-tiny font-semibold text-danger-700">
                    待处理原因
                  </p>
                  <ul className="mt-1 grid gap-1 text-small text-danger-700">
                    {failureDetails.slice(0, 4).map((detail, index) => (
                      <li key={`${session.id}-failure-${index}`}>
                        {commercialDisplayText(detail)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-[8px] border-small border-divider p-3">
              <h4 className="text-small font-semibold text-default-900">
                待确认动作
              </h4>
              <div className="mt-3 grid gap-2">
                {session.confirmations.length ? (
                  session.confirmations.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-small border-small border-divider bg-default-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            item.riskLevel === "high" ? "danger" : "warning"
                          }
                          size="sm"
                          variant="flat"
                        >
                          {item.riskLevel === "high" ? "高风险" : "中风险"}
                        </Chip>
                        <Chip size="sm" variant="flat">
                          {item.status === "pending" ? "待我确认" : "已处理"}
                        </Chip>
                      </div>
                      <p className="mt-2 text-small font-semibold text-default-800">
                        {commercialDisplayText(item.title)}
                      </p>
                      <p className="mt-1 line-clamp-3 text-tiny text-default-500">
                        {commercialDisplayText(
                          item.description || item.actionLabel,
                        )}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-small text-default-500">
                    当前没有待确认动作。
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-[8px] border-small border-divider p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h4 className="text-small font-semibold text-default-900">
                  时间线
                </h4>
                <Chip size="sm" variant="flat">
                  {session.events.length} 条
                </Chip>
                <Chip color="success" size="sm" variant="flat">
                  证据 {evidenceEvents.length}
                </Chip>
              </div>
              <div className="grid gap-2">
                {session.events.length ? (
                  session.events.slice(0, 8).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-small border-small border-divider bg-default-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            hasPendingConfirmation && event.level === "success"
                              ? "warning"
                              : agentEventColor(event.level)
                          }
                          size="sm"
                          variant="flat"
                        >
                          {event.level === "error"
                            ? "异常"
                            : event.level === "warning"
                              ? "提醒"
                              : event.level === "success"
                                ? hasPendingConfirmation
                                  ? "待确认"
                                  : "完成"
                                : "记录"}
                        </Chip>
                        <span className="text-tiny text-default-500">
                          {formatDateTime(event.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-small font-semibold text-default-800">
                        {commercialDisplayText(event.title)}
                      </p>
                      <p className="mt-1 text-tiny leading-5 text-default-500">
                        {commercialDisplayText(event.message)}
                      </p>
                      {event.evidence ? (
                        <p className="mt-2 break-all rounded-small bg-background px-2 py-1 text-tiny text-default-600">
                          {commercialDisplayText(event.evidence.label)}：
                          {commercialDisplayText(event.evidence.value)}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-small text-default-500">
                    暂无时间线记录。
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-divider p-4">
          <Button
            color="primary"
            isDisabled={!canContinue}
            isLoading={busyAction === "continue"}
            startContent={
              busyAction === "continue" ? null : (
                <Icon icon="solar:play-circle-linear" />
              )
            }
            variant="flat"
            onPress={onContinue}
          >
            继续
          </Button>
          <Button
            color="danger"
            isDisabled={!canStop}
            isLoading={busyAction === "stop"}
            startContent={
              busyAction === "stop" ? null : (
                <Icon icon="solar:stop-circle-linear" />
              )
            }
            variant="flat"
            onPress={onStop}
          >
            停止
          </Button>
          <Button
            isDisabled={!canControl || evidenceEvents.length === 0}
            isLoading={busyAction === "export"}
            startContent={
              busyAction === "export" ? null : (
                <Icon icon="solar:download-minimalistic-linear" />
              )
            }
            variant="flat"
            onPress={onExport}
          >
            导出记录
          </Button>
        </div>
      </aside>
    </div>
  );
}
