"use client";

import React from "react";
import Link from "next/link";
import {
  Button,
  Card,
  CardBody,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
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
import { FailureActionPanel } from "../../components/failure-action-panel";
import { FunctionalEmptyState } from "../../components/functional-empty-state";
import { ResultSummaryPanel } from "../../components/result-summary-panel";
import {
  dashboardApi,
  type RiskAuditEvidence,
  type RiskAuditEvidenceDetail,
} from "@/lib/api/dashboard";
import {
  autoUploadApi,
  type AutoUploadPublishTask,
} from "@/lib/api/auto-upload";
import {
  localEngineApi,
  type AgentEvidence,
  type AgentSession,
  type AgentSessionEvent,
} from "@/lib/api/local-engine";
import {
  aiEmployeeApi,
  type AiEmployeeWorkflowRun,
  type AiEmployeeWorkflowRunStatus,
  type AiEmployeeWorkflowStepRun,
  type AiEmployeeWorkflowStepStatus,
} from "@/lib/api/ai-employee";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import {
  displayPublishRecordFileName,
  displayPublishRecordTitle,
  getPublishRecordEvidenceCount,
  getPublishRecordFailureReason,
  getPublishRecordMetrics,
  getPublishRecordModeLabel,
  getPublishRecordReceipt,
  getPublishRecordStatusColor,
  resolvePublishRecordStatus,
  summarizePublishRecordResult,
} from "@/lib/publish-record-view";

type AgentEvidenceRow = {
  id: string;
  session: AgentSession;
  event: AgentSessionEvent;
  evidence: AgentEvidence;
};

const riskColorMap: Record<
  RiskAuditEvidence["riskLevel"],
  "default" | "warning" | "danger"
> = {
  medium: "warning",
  high: "danger",
  unknown: "default",
};

const publishStatusColorMap: Record<
  string,
  "default" | "primary" | "success" | "warning" | "danger"
> = {
  success: "success",
  failed: "danger",
  account_expired: "warning",
  material_error: "warning",
  login_required: "warning",
  pending_manual: "warning",
  blocked: "danger",
  not_integrated: "default",
  skipped: "default",
};

const publishStatusLabelMap: Record<string, string> = {
  success: "已发布",
  failed: "发布失败",
  account_expired: "账号失效",
  material_error: "素材异常",
  login_required: "需要登录",
  pending_manual: "待确认",
  blocked: "需处理",
  not_integrated: "暂未开通",
  skipped: "已跳过",
};

const evidenceTypeLabelMap: Record<string, string> = {
  screenshot: "浏览器截图",
  page_snapshot: "页面记录",
  snapshot: "页面记录",
  desktop_screenshot: "桌面截图",
  stage_log: "步骤记录",
  failure_reason: "失败原因",
  file: "文件记录",
  text: "文本记录",
};

const workflowRunStatusLabelMap: Record<AiEmployeeWorkflowRunStatus, string> = {
  queued: "等待运行",
  running: "运行中",
  completed: "已完成",
  partial: "部分完成",
  blocked: "已阻断",
  failed: "执行失败",
  cancelling: "取消中",
  cancelled: "已取消",
};

const workflowStepStatusLabelMap: Record<AiEmployeeWorkflowStepStatus, string> =
  {
    pending: "等待",
    running: "执行中",
    completed: "已完成",
    blocked: "已阻断",
    failed: "失败",
    cancelled: "已取消",
  };

function workflowStatusColor(
  status: AiEmployeeWorkflowRunStatus | AiEmployeeWorkflowStepStatus,
) {
  if (status === "completed") return "success" as const;
  if (status === "running" || status === "queued") return "primary" as const;
  if (
    status === "partial" ||
    status === "blocked" ||
    status === "cancelling" ||
    status === "cancelled"
  ) {
    return "warning" as const;
  }
  if (status === "failed") return "danger" as const;
  return "default" as const;
}

function workflowTriggerLabel(value: AiEmployeeWorkflowRun["trigger"]) {
  if (value === "schedule") return "按计划运行";
  if (value === "retry") return "人工重试";
  return "人工启动";
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

function riskLabel(value: RiskAuditEvidence["riskLevel"]) {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  return "风险审计";
}

function publishStatusColor(value?: string) {
  return publishStatusColorMap[value || ""] || "default";
}

function publishStatusLabel(value?: string, fallback?: string) {
  return fallback || publishStatusLabelMap[value || ""] || value || "详情";
}

function evidenceSourceLabel(value?: string) {
  if (value === "platform-api") return "平台回执";
  if (value === "platform-page") return "页面结果";
  if (value === "readback") return "结果确认记录";
  return commercialDisplayText(value || "记录");
}

function riskDetailLabel(value?: string) {
  if (value === "high") return "高风险";
  if (value === "medium") return "中风险";
  if (value === "low") return "低风险";
  return value || "风险";
}

function contentKindLabel(value?: string) {
  if (value === "video") return "视频";
  if (value === "article") return "图文";
  return value || "未记录";
}

function numericLabel(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "0";
}

function getPlatformDetails(details?: RiskAuditEvidence["details"]) {
  return (Array.isArray(details) ? details : []).filter(
    (detail) => detail.type === "publish-platform",
  );
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

function truncate(value?: string | null, max = 96) {
  const text = commercialDisplayText(value || "").trim();
  if (!text) return "无详情";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function buildAgentEvidenceRows(sessions: AgentSession[]): AgentEvidenceRow[] {
  return sessions
    .flatMap((session) =>
      (Array.isArray(session.events) ? session.events : [])
        .filter((event) => Boolean(event.evidence))
        .map((event) => ({
          id: `${session.id}:${event.id}`,
          session,
          event,
          evidence: event.evidence!,
        })),
    )
    .slice(0, 80);
}

export default function TasksEvidencePage() {
  const [riskEvidence, setRiskEvidence] = React.useState<RiskAuditEvidence[]>(
    [],
  );
  const [agentSessions, setAgentSessions] = React.useState<AgentSession[]>([]);
  const [publishTasks, setPublishTasks] = React.useState<
    AutoUploadPublishTask[]
  >([]);
  const [workflowRuns, setWorkflowRuns] = React.useState<
    AiEmployeeWorkflowRun[]
  >([]);
  const [selectedRiskEvidence, setSelectedRiskEvidence] =
    React.useState<RiskAuditEvidence | null>(null);
  const [selectedWorkflowRun, setSelectedWorkflowRun] =
    React.useState<AiEmployeeWorkflowRun | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [riskResult, sessionResult, publishTaskResult, workflowResult] =
        await Promise.all([
          dashboardApi.riskAuditEvidence(80),
          localEngineApi.agentSessions({ limit: 80 }),
          autoUploadApi.tasks(80).catch(() => [] as AutoUploadPublishTask[]),
          aiEmployeeApi.workflows(80).catch(() => ({
            definitions: [],
            runs: [] as AiEmployeeWorkflowRun[],
          })),
        ]);
      setRiskEvidence(Array.isArray(riskResult) ? riskResult : []);
      setAgentSessions(Array.isArray(sessionResult) ? sessionResult : []);
      setPublishTasks(
        Array.isArray(publishTaskResult) ? publishTaskResult : [],
      );
      setWorkflowRuns(
        Array.isArray(workflowResult.runs) ? workflowResult.runs : [],
      );
    } catch (caught: unknown) {
      const message = commercialDisplayText(
        caught instanceof Error ? caught.message : "结果留存读取失败",
      );
      setError(message);
      addToast({
        title: "结果留存读取失败",
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

  const agentEvidenceRows = React.useMemo(
    () => buildAgentEvidenceRows(agentSessions),
    [agentSessions],
  );
  const highRiskCount = riskEvidence.filter(
    (item) => item.riskLevel === "high",
  ).length;
  const publishAuditCount = riskEvidence.filter(
    (item) => item.action === "publish",
  ).length;
  const publishTaskEvidenceCount = publishTasks.reduce(
    (sum, task) => sum + getPublishRecordEvidenceCount(task),
    0,
  );
  const workflowEvidenceCount = workflowRuns.reduce(
    (sum, run) => sum + run.aggregate.evidenceCount,
    0,
  );
  const pendingSessionIds = new Set(
    agentSessions
      .filter(
        (session) =>
          session.status === "waiting_for_confirmation" ||
          (session.confirmations || []).some(
            (confirmation) => confirmation.status === "pending",
          ),
      )
      .map((session) => session.id),
  );
  const confirmedAgentEvidenceCount = agentEvidenceRows.filter(
    (row) => !pendingSessionIds.has(row.session.id),
  ).length;
  const completedWorkflowCount = workflowRuns.filter(
    (run) => run.status === "completed",
  ).length;
  const publishTaskFailureCount = publishTasks.filter(
    (task) => getPublishRecordMetrics(task).failed > 0,
  ).length;
  const platformDetailCount = riskEvidence.reduce(
    (sum, item) => sum + getPlatformDetails(item.details).length,
    0,
  );
  const publishPlatformDetailCount = publishTasks.reduce(
    (sum, task) =>
      sum + summarizePublishRecordResult(task.result).results.length,
    0,
  );
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
      <header className="rounded-[8px] border-small border-divider bg-background p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-success/10 text-success">
              <Icon icon="solar:gallery-check-linear" width={26} />
            </div>
            <div>
              <h2 className="text-[17px] font-bold leading-6 text-[var(--kaypal-v3-ink)]">
                结果留存
              </h2>
              <p className="mt-1 max-w-3xl text-small leading-6 text-default-500">
                查看任务过程、风险确认、发布结果和可追溯记录。
              </p>
            </div>
          </div>
          <Button
            color="primary"
            isLoading={loading}
            startContent={loading ? null : <Icon icon="solar:refresh-linear" />}
            variant="flat"
            onPress={refresh}
          >
            刷新
          </Button>
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-5">
        <MetricCard label="风险记录" value={riskEvidence.length} />
        <MetricCard label="高风险" value={highRiskCount} />
        <MetricCard
          label="发布记录"
          value={publishAuditCount + publishTasks.length}
        />
        <MetricCard
          label="平台详情"
          value={platformDetailCount + publishPlatformDetailCount}
        />
        <MetricCard
          label="证据留存"
          value={
            agentEvidenceRows.length +
            publishTaskEvidenceCount +
            workflowEvidenceCount
          }
        />
      </div>

      {error ? (
        <FailureActionPanel
          actions={[
            {
              label: "重新读取",
              onPress: () => {
                refresh();
              },
            },
            { href: "/tasks/records", label: "任务历史" },
          ]}
          impact="暂时无法查看任务过程、风险确认、发布回执和失败原因。"
          nextAction="先重新读取；如果仍失败，回到任务历史查看单条任务记录。"
          reason="结果留存读取失败，可能是记录服务或本机服务暂时不可用。"
          technicalDetails={error}
          title="结果留存需要处理"
        />
      ) : null}

      <ResultSummaryPanel
        actions={[
          { href: "/tasks/records", label: "任务历史" },
          { href: "/distribution?tab=tasks", label: "发布记录" },
          { href: "/tasks/confirmations", label: "待我确认" },
        ]}
        failed={
          publishTaskFailureCount +
          workflowRuns.filter((run) =>
            ["failed", "blocked", "partial"].includes(run.status),
          ).length
        }
        skipped={pendingSessionIds.size}
        succeeded={
          riskEvidence.length +
          confirmedAgentEvidenceCount +
          completedWorkflowCount +
          publishTasks.filter(
            (task) => task.status === "success" || task.status === "completed",
          ).length
        }
        subtitle="这里沉淀任务过程、人工确认、发布回执、失败原因和可追溯记录。"
        title="结果留存总览"
        total={
          riskEvidence.length +
          agentEvidenceRows.length +
          publishTasks.length +
          workflowRuns.length
        }
      />

      <RiskAuditEvidenceTable
        items={riskEvidence}
        loading={loading}
        onSelect={setSelectedRiskEvidence}
      />
      <WorkflowRunEvidenceTable
        items={workflowRuns}
        loading={loading}
        onSelect={setSelectedWorkflowRun}
      />
      <PublishRecordEvidenceTable items={publishTasks} loading={loading} />
      <AgentEvidenceTable items={agentEvidenceRows} loading={loading} />
      <RiskAuditEvidenceDetailModal
        item={selectedRiskEvidence}
        onClose={() => setSelectedRiskEvidence(null)}
      />
      <WorkflowRunEvidenceDetailModal
        run={selectedWorkflowRun}
        onClose={() => setSelectedWorkflowRun(null)}
      />
    </div>
  );
}

function RiskAuditEvidenceTable({
  items,
  loading,
  onSelect,
}: {
  items: RiskAuditEvidence[];
  loading: boolean;
  onSelect: (item: RiskAuditEvidence) => void;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              风险确认记录
            </h3>
            <p className="mt-1 text-small text-default-500">
              由人工确认、任务执行和系统记录形成的高影响动作留痕。
            </p>
          </div>
          <Button as={Link} href="/capabilities/risk" variant="flat">
            风控策略
          </Button>
        </div>
        <Table
          aria-label="风险确认记录"
          classNames={{
            wrapper: "border-small border-divider shadow-none",
            th: "bg-default-50 text-default-500",
          }}
        >
          <TableHeader>
            <TableColumn>动作</TableColumn>
            <TableColumn>对象</TableColumn>
            <TableColumn>详情</TableColumn>
            <TableColumn>审计编号</TableColumn>
            <TableColumn>时间</TableColumn>
            <TableColumn>来源</TableColumn>
            <TableColumn>操作</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={
              loading ? (
                " "
              ) : (
                <FunctionalEmptyState
                  actions={[
                    { href: "/tasks/confirmations", label: "待我确认" },
                    {
                      href: "/distribution?tab=article",
                      label: "创建发布任务",
                    },
                  ]}
                  description="完成正式发布确认、批量触达确认或高风险动作确认后，这里会留下审计记录。"
                  examples={["人工确认", "风险记录", "发布回执"]}
                  title="暂无风险确认记录"
                />
              )
            }
            isLoading={loading}
            items={items}
            loadingContent={<Spinner label="读取中..." />}
          >
            {(item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    <Chip
                      color={riskColorMap[item.riskLevel]}
                      size="sm"
                      variant="flat"
                    >
                      {riskLabel(item.riskLevel)}
                    </Chip>
                    <Chip color="success" size="sm" variant="flat">
                      已确认
                    </Chip>
                    <span className="text-small font-medium text-default-800">
                      {item.actionLabel}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="max-w-[300px] space-y-1">
                    <p className="truncate text-small text-default-800">
                      {item.targetLabel}
                    </p>
                    <p className="text-tiny text-default-500">
                      {truncate(item.summary)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <RiskAuditDetails details={item.details} />
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <code className="rounded-small bg-default-100 px-2 py-1 text-tiny text-default-700">
                      {item.auditId}
                    </code>
                    {item.targetId ? (
                      <p className="text-tiny text-default-400">
                        {item.targetId}
                      </p>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-tiny text-default-500">
                    {formatDateTime(item.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat">
                    系统记录
                  </Chip>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    startContent={<Icon icon="solar:eye-linear" />}
                    variant="flat"
                    onPress={() => onSelect(item)}
                  >
                    详情
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function WorkflowRunEvidenceTable({
  items,
  loading,
  onSelect,
}: {
  items: AiEmployeeWorkflowRun[];
  loading: boolean;
  onSelect: (run: AiEmployeeWorkflowRun) => void;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              工作流结果
            </h3>
            <p className="mt-1 text-small text-default-500">
              查看每次运行的步骤结果、结果资料、核对记录和人工确认。
            </p>
          </div>
          <Button as={Link} href="/tasks" variant="flat">
            打开任务中心
          </Button>
        </div>
        <Table
          aria-label="工作流结果"
          classNames={{
            wrapper: "border-small border-divider shadow-none",
            th: "bg-default-50 text-default-500",
          }}
        >
          <TableHeader>
            <TableColumn>工作流</TableColumn>
            <TableColumn>来源</TableColumn>
            <TableColumn>状态</TableColumn>
            <TableColumn>步骤结果</TableColumn>
            <TableColumn>结果资料</TableColumn>
            <TableColumn>确认记录</TableColumn>
            <TableColumn>操作</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={
              loading ? (
                " "
              ) : (
                <FunctionalEmptyState
                  actions={[{ href: "/tasks", label: "创建工作流" }]}
                  description="工作流完成启动、重试或按计划运行后，这里会显示逐步骤结果。"
                  examples={["步骤状态", "结果资料", "结果核对", "确认编号"]}
                  title="暂无工作流结果"
                />
              )
            }
            isLoading={loading}
            items={items}
            loadingContent={<Spinner label="读取中..." />}
          >
            {(run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <div className="max-w-[240px] space-y-1">
                    <p className="truncate text-small font-semibold text-default-800">
                      {commercialDisplayText(run.title, "工作流")}
                    </p>
                    <p className="text-tiny text-default-400">
                      {formatDateTime(run.updatedAt)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="flat">
                    {workflowTriggerLabel(run.trigger)}
                  </Chip>
                </TableCell>
                <TableCell>
                  <Chip
                    color={workflowStatusColor(run.status)}
                    size="sm"
                    variant="flat"
                  >
                    {workflowRunStatusLabelMap[run.status]}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex max-w-[340px] flex-wrap gap-1">
                    {run.steps.slice(0, 3).map((step) => (
                      <Chip
                        key={`${run.id}-${step.stepId}`}
                        color={workflowStatusColor(step.status)}
                        size="sm"
                        variant="flat"
                      >
                        {commercialDisplayText(step.title, "步骤")} ·{" "}
                        {workflowStepStatusLabelMap[step.status]}
                      </Chip>
                    ))}
                    {run.steps.length > 3 ? (
                      <Chip size="sm" variant="flat">
                        另 {run.steps.length - 3} 步
                      </Chip>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-tiny leading-5 text-default-600">
                    {run.aggregate.completedSteps}/{run.aggregate.totalSteps}{" "}
                    步完成
                    <br />
                    {run.aggregate.evidenceCount} 条结果资料
                  </div>
                </TableCell>
                <TableCell>
                  {run.confirmation ? (
                    <div className="max-w-[220px] space-y-1 text-tiny text-default-500">
                      <p>{commercialDisplayText(run.confirmation.operator)}</p>
                      <code className="block truncate rounded-small bg-default-100 px-2 py-1">
                        {run.confirmation.confirmationId}
                      </code>
                    </div>
                  ) : (
                    <span className="text-tiny text-default-400">
                      旧记录未留存
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    startContent={<Icon icon="solar:eye-linear" />}
                    variant="flat"
                    onPress={() => onSelect(run)}
                  >
                    逐步查看
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function PublishRecordEvidenceTable({
  items,
  loading,
}: {
  items: AutoUploadPublishTask[];
  loading: boolean;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              发布记录留存
            </h3>
            <p className="mt-1 text-small text-default-500">
              汇总发布任务的账号、平台状态、失败原因、回执和证据。
            </p>
          </div>
          <Button as={Link} href="/distribution?tab=tasks" variant="flat">
            打开发布记录
          </Button>
        </div>
        <Table
          aria-label="发布记录留存"
          classNames={{
            wrapper: "border-small border-divider shadow-none",
            th: "bg-default-50 text-default-500",
          }}
        >
          <TableHeader>
            <TableColumn>发布记录</TableColumn>
            <TableColumn>账号</TableColumn>
            <TableColumn>结果</TableColumn>
            <TableColumn>失败原因</TableColumn>
            <TableColumn>证据</TableColumn>
            <TableColumn>时间</TableColumn>
            <TableColumn>操作</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={
              loading ? (
                " "
              ) : (
                <FunctionalEmptyState
                  actions={[
                    {
                      href: "/distribution?tab=article",
                      label: "创建发布任务",
                    },
                    { href: "/distribution?tab=tasks", label: "发布记录" },
                  ]}
                  description="发布任务完成后，这里会自动汇总平台回执、失败原因和结果留存。"
                  examples={["平台状态", "失败原因", "发布回执", "证据留存"]}
                  title="暂无发布记录留存"
                />
              )
            }
            isLoading={loading}
            items={items}
            loadingContent={<Spinner label="读取中..." />}
          >
            {(item) => {
              const metrics = getPublishRecordMetrics(item);
              const evidenceCount = getPublishRecordEvidenceCount(item);
              const failureReason = getPublishRecordFailureReason(item);
              const resultSummary = summarizePublishRecordResult(item.result);
              const firstReceipt =
                resultSummary.results
                  .map((result) => getPublishRecordReceipt(result))
                  .find(Boolean) || "";
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="max-w-[300px] space-y-1">
                      <p className="truncate text-small font-semibold text-default-900">
                        {displayPublishRecordTitle(item.title)}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Chip size="sm" variant="flat">
                          #{item.id}
                        </Chip>
                        <Chip size="sm" variant="flat">
                          {getPublishRecordModeLabel(item)}
                        </Chip>
                        <Chip
                          color={getPublishRecordStatusColor(item.status)}
                          size="sm"
                          variant="flat"
                        >
                          {resolvePublishRecordStatus(item.status)}
                        </Chip>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {displayPublishRecordFileName(item.account_file, "-")}
                  </TableCell>
                  <TableCell>
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
                    </div>
                  </TableCell>
                  <TableCell>
                    <p
                      className="line-clamp-3 max-w-[260px] text-tiny leading-5 text-default-500"
                      title={failureReason || "暂无失败原因"}
                    >
                      {failureReason || "-"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Chip
                        color={evidenceCount ? "success" : "default"}
                        size="sm"
                        variant="flat"
                      >
                        {evidenceCount} 条
                      </Chip>
                      {firstReceipt ? (
                        <p className="max-w-[180px] truncate text-tiny text-default-400">
                          {commercialDisplayText(firstReceipt)}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-tiny text-default-500">
                      {formatDateTime(item.updated_at)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      as={Link}
                      href="/distribution?tab=tasks"
                      size="sm"
                      variant="flat"
                    >
                      明细
                    </Button>
                  </TableCell>
                </TableRow>
              );
            }}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
  );
}

function RiskAuditDetails({
  details,
}: {
  details?: RiskAuditEvidence["details"];
}) {
  const items = getPlatformDetails(details);
  if (!items.length) {
    return <span className="text-tiny text-default-400">暂无平台详情</span>;
  }

  return (
    <div className="min-w-[280px] max-w-[420px] space-y-2">
      {items.slice(0, 3).map((detail, index) => {
        const evidenceUrl = detail.publishUrl || detail.evidenceUrl;
        return (
          <div
            key={`${detail.label}-${detail.status || index}`}
            className="rounded-[6px] border-small border-divider bg-default-50/70 p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                color={publishStatusColor(detail.status)}
                size="sm"
                variant="flat"
              >
                {publishStatusLabel(detail.status, detail.statusLabel)}
              </Chip>
              <span className="max-w-[240px] truncate text-small font-medium text-default-800">
                {detail.label}
              </span>
            </div>

            <p className="mt-1 text-tiny leading-5 text-default-500">
              {truncate(
                commercialDisplayText(
                  detail.summary || detail.nextAction || detail.failureReason,
                ),
                128,
              )}
            </p>

            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-5 text-default-400">
              {detail.publishTaskId ? (
                <span>任务 {detail.publishTaskId}</span>
              ) : null}
              {detail.externalId ? (
                <span>外部 ID {detail.externalId}</span>
              ) : null}
              {detail.evidenceSource ? (
                <span>{evidenceSourceLabel(detail.evidenceSource)}</span>
              ) : null}
            </div>

            {detail.nextAction && detail.status !== "success" ? (
              <p className="mt-1 text-tiny leading-5 text-warning-700">
                下一步：{truncate(detail.nextAction, 112)}
              </p>
            ) : null}

            {evidenceUrl ? (
              <a
                className="mt-1 inline-flex text-tiny text-primary"
                href={evidenceUrl}
                rel="noreferrer"
                target="_blank"
              >
                打开发布记录
              </a>
            ) : null}
          </div>
        );
      })}
      {items.length > 3 ? (
        <p className="text-tiny text-default-400">
          另有 {items.length - 3} 条平台详情
        </p>
      ) : null}
    </div>
  );
}

function WorkflowRunEvidenceDetailModal({
  run,
  onClose,
}: {
  run: AiEmployeeWorkflowRun | null;
  onClose: () => void;
}) {
  const confirmations = run
    ? Array.isArray(run.confirmations)
      ? run.confirmations
      : run.confirmation
        ? [run.confirmation]
        : []
    : [];
  const confirmation = run?.confirmation || confirmations.at(-1);

  return (
    <Modal
      isOpen={Boolean(run)}
      placement="center"
      scrollBehavior="inside"
      size="4xl"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        {run ? (
          <>
            <ModalHeader className="flex flex-col gap-3 border-b border-divider/70">
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  color={workflowStatusColor(run.status)}
                  size="sm"
                  variant="flat"
                >
                  {workflowRunStatusLabelMap[run.status]}
                </Chip>
                <Chip size="sm" variant="flat">
                  {workflowTriggerLabel(run.trigger)}
                </Chip>
                <span className="text-medium font-semibold text-default-900">
                  {commercialDisplayText(run.title, "工作流结果")}
                </span>
              </div>
              <p className="text-tiny font-normal text-default-500">
                运行时间 {formatDateTime(run.startedAt || run.createdAt)} ·
                更新于 {formatDateTime(run.updatedAt)}
              </p>
            </ModalHeader>
            <ModalBody className="gap-4 py-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <EvidenceInfoCard
                  label="全部步骤"
                  value={run.aggregate.totalSteps}
                />
                <EvidenceInfoCard
                  label="完成步骤"
                  value={run.aggregate.completedSteps}
                />
                <EvidenceInfoCard
                  label="结果资料"
                  value={run.aggregate.evidenceCount}
                />
                <EvidenceInfoCard
                  label="候选结果"
                  value={run.aggregate.candidateCount}
                />
              </div>

              {run.recovery ? (
                <section className="rounded-[8px] border border-warning-300 bg-warning-50 p-3">
                  <p className="text-small font-semibold text-warning-800">
                    重启后已停止不确定状态
                  </p>
                  <p className="mt-1 text-tiny leading-5 text-warning-700">
                    {commercialDisplayText(run.recovery.message)}
                  </p>
                </section>
              ) : null}

              {confirmation ? (
                <section className="rounded-[8px] border border-divider p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-small font-semibold text-default-900">
                      本次确认
                    </h4>
                    <Chip color="success" size="sm" variant="flat">
                      已确认
                    </Chip>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <AuditField label="确认人" value={confirmation.operator} />
                    <AuditField
                      label="确认时间"
                      value={formatDateTime(confirmation.confirmedAt)}
                    />
                    <AuditField
                      code
                      label="确认编号"
                      value={confirmation.confirmationId}
                    />
                    <AuditField
                      code
                      label="服务端记录编号"
                      value={confirmation.auditId}
                    />
                  </div>
                  {confirmation.reason ? (
                    <p className="mt-3 text-tiny leading-5 text-default-500">
                      {commercialDisplayText(confirmation.reason)}
                    </p>
                  ) : null}
                  {confirmation.checklist ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(confirmation.checklist).map(
                        ([key, checked]) => (
                          <Chip
                            color={checked ? "success" : "default"}
                            key={key}
                            size="sm"
                            variant="flat"
                          >
                            {checked ? "已核对" : "未核对"}
                          </Chip>
                        ),
                      )}
                    </div>
                  ) : null}
                </section>
              ) : (
                <section className="rounded-[8px] border border-warning-300 bg-warning-50 p-3 text-small text-warning-800">
                  这是一条旧记录，没有保存完整确认信息。
                </section>
              )}

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-small font-semibold text-default-900">
                    逐步骤结果
                  </h4>
                  <Chip size="sm" variant="flat">
                    {run.steps.length} 步
                  </Chip>
                </div>
                <div className="grid gap-3">
                  {run.steps.map((step, index) => (
                    <WorkflowStepEvidenceDetail
                      index={index}
                      key={`${run.id}-${step.stepId}`}
                      step={step}
                    />
                  ))}
                </div>
              </section>
            </ModalBody>
            <ModalFooter className="border-t border-divider/70">
              <Button variant="flat" onPress={onClose}>
                关闭
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function WorkflowStepEvidenceDetail({
  step,
  index,
}: {
  step: AiEmployeeWorkflowStepRun;
  index: number;
}) {
  const latestTransitions = (step.transitions || []).slice(-4);
  return (
    <section className="rounded-[8px] border border-divider bg-background p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-tiny text-default-400">步骤 {index + 1}</p>
          <h5 className="mt-1 text-small font-semibold text-default-900">
            {commercialDisplayText(step.title, "未命名步骤")}
          </h5>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip
            color={workflowStatusColor(step.status)}
            size="sm"
            variant="flat"
          >
            {workflowStepStatusLabelMap[step.status]}
          </Chip>
          <Chip size="sm" variant="flat">
            第 {step.attempt} 次
          </Chip>
        </div>
      </div>

      <p className="mt-3 text-small leading-6 text-default-600">
        {commercialDisplayText(step.message, "没有结果说明")}
      </p>
      {step.nextAction ? (
        <p className="mt-2 rounded-[6px] bg-default-50 px-3 py-2 text-tiny leading-5 text-default-600">
          下一步：{commercialDisplayText(step.nextAction)}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-tiny font-semibold text-default-700">
            结果资料 {step.evidence.length}
          </p>
          <div className="mt-2 grid gap-2">
            {step.evidence.length ? (
              step.evidence.map((evidence, evidenceIndex) => (
                <div
                  className="rounded-[6px] border border-divider px-3 py-2"
                  key={`${step.stepId}-evidence-${evidenceIndex}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-tiny font-semibold text-default-700">
                      {commercialDisplayText(evidence.label, "结果资料")}
                    </span>
                    <Chip size="sm" variant="flat">
                      {evidenceTypeLabelMap[evidence.type] || "结果记录"}
                    </Chip>
                  </div>
                  <p className="mt-2 break-all text-tiny leading-5 text-default-500">
                    {truncate(
                      evidence.value ||
                        evidence.path ||
                        evidence.url ||
                        "已留存",
                      240,
                    )}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-tiny text-default-400">本步骤没有结果资料。</p>
            )}
          </div>
        </div>

        <div>
          <p className="text-tiny font-semibold text-default-700">结果核对</p>
          {step.readback ? (
            <div className="mt-2 rounded-[6px] border border-divider px-3 py-2">
              <Chip
                color={step.readback.matched ? "success" : "warning"}
                size="sm"
                variant="flat"
              >
                {step.readback.matched ? "核对一致" : "核对不一致"}
              </Chip>
              {step.readback.expectedText ? (
                <p className="mt-2 text-tiny leading-5 text-default-500">
                  预期：{truncate(step.readback.expectedText, 180)}
                </p>
              ) : null}
              {step.readback.actualText ? (
                <p className="mt-1 text-tiny leading-5 text-default-500">
                  实际：{truncate(step.readback.actualText, 180)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-tiny text-default-400">
              本步骤没有结果核对记录。
            </p>
          )}
          {typeof step.output?.candidateCount === "number" ? (
            <p className="mt-2 text-tiny text-default-500">
              候选结果：{step.output.candidateCount} 条
            </p>
          ) : null}
        </div>
      </div>

      {latestTransitions.length ? (
        <div className="mt-4 border-t border-divider pt-3">
          <p className="text-tiny font-semibold text-default-700">处理过程</p>
          <div className="mt-2 grid gap-1">
            {latestTransitions.map((transition, transitionIndex) => (
              <p
                className="text-tiny leading-5 text-default-500"
                key={`${step.stepId}-transition-${transitionIndex}`}
              >
                {formatDateTime(transition.at)} ·{" "}
                {workflowStepStatusLabelMap[transition.to]} ·{" "}
                {commercialDisplayText(transition.message)}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RiskAuditEvidenceDetailModal({
  item,
  onClose,
}: {
  item: RiskAuditEvidence | null;
  onClose: () => void;
}) {
  const details = Array.isArray(item?.details) ? item.details : [];
  const confirmationDetail = details.find(
    (detail) => detail.type === "audit-confirmation",
  );
  const payloadDetails = details.filter(
    (detail) => detail.type === "publish-payload",
  );
  const preflightDetail = details.find(
    (detail) => detail.type === "publish-preflight",
  );
  const platformDetails = getPlatformDetails(details);
  const successCount = platformDetails.filter(
    (detail) => detail.status === "success",
  ).length;
  const blockedCount = platformDetails.filter((detail) =>
    [
      "blocked",
      "failed",
      "account_expired",
      "material_error",
      "login_required",
    ].includes(detail.status || ""),
  ).length;
  const pendingCount = platformDetails.filter((detail) =>
    ["pending_manual", "not_integrated", "skipped"].includes(
      detail.status || "",
    ),
  ).length;

  return (
    <Modal
      isOpen={Boolean(item)}
      scrollBehavior="inside"
      size="4xl"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        {item ? (
          <>
            <ModalHeader className="flex flex-col gap-3 border-b border-divider/70">
              <div className="flex flex-wrap items-center gap-2">
                <Chip
                  color={riskColorMap[item.riskLevel]}
                  size="sm"
                  variant="flat"
                >
                  {riskLabel(item.riskLevel)}
                </Chip>
                <Chip color="success" size="sm" variant="flat">
                  已确认
                </Chip>
                <Chip size="sm" variant="flat">
                  {item.actionLabel}
                </Chip>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-default-900">
                  {item.targetLabel}
                </h3>
                <p className="mt-1 text-small font-normal leading-6 text-default-500">
                  {commercialDisplayText(item.summary)}
                </p>
              </div>
            </ModalHeader>
            <ModalBody className="gap-4 py-5">
              <div className="grid gap-3 md:grid-cols-4">
                <EvidenceInfoCard
                  label="平台详情"
                  value={platformDetails.length}
                />
                <EvidenceInfoCard label="已发布" value={successCount} />
                <EvidenceInfoCard label="需处理" value={blockedCount} />
                <EvidenceInfoCard label="待确认" value={pendingCount} />
              </div>

              <section className="rounded-[8px] border-small border-divider bg-default-50/60 p-3">
                <h4 className="text-small font-semibold text-default-900">
                  审计信息
                </h4>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <AuditField label="审计编号" value={item.auditId} code />
                  <AuditField label="来源记录" value={item.sourceLogId} code />
                  <AuditField
                    label="确认时间"
                    value={formatDateTime(item.createdAt)}
                  />
                  <AuditField label="动作类型" value={item.action} />
                  {item.detail ? (
                    <AuditField label="执行摘要" value={item.detail} />
                  ) : null}
                  {item.targetId ? (
                    <AuditField label="对象 ID" value={item.targetId} code />
                  ) : null}
                </div>
              </section>

              <ConfirmationDetailPanel detail={confirmationDetail} />
              <PayloadSummaryPanel details={payloadDetails} />
              <PreflightDetailPanel detail={preflightDetail} />

              <section className="space-y-3">
                <div>
                  <h4 className="text-small font-semibold text-default-900">
                    平台执行明细
                  </h4>
                  <p className="mt-1 text-tiny leading-5 text-default-500">
                    按平台展示发布结果、记录来源和下一步处理动作。
                  </p>
                </div>
                {platformDetails.length ? (
                  <div className="grid gap-3">
                    {platformDetails.map((detail, index) => (
                      <RiskAuditPlatformDetail
                        detail={detail}
                        index={index}
                        key={`${detail.label}-${detail.status || index}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[8px] border-small border-dashed border-divider p-4 text-small text-default-500">
                    这条记录来自旧格式数据，暂无平台级详情。
                  </div>
                )}
              </section>
            </ModalBody>
            <ModalFooter className="border-t border-divider/70">
              <Button variant="flat" onPress={onClose}>
                关闭
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </ModalContent>
    </Modal>
  );
}

function ConfirmationDetailPanel({
  detail,
}: {
  detail?: RiskAuditEvidenceDetail;
}) {
  if (!detail) return null;

  return (
    <section className="rounded-[8px] border-small border-divider bg-background p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-small font-semibold text-default-900">
            确认记录
          </h4>
          <p className="mt-1 text-tiny leading-5 text-default-500">
            {commercialDisplayText(
              detail.summary || "高风险动作已通过人工确认。",
            )}
          </p>
        </div>
        {detail.fullPermission ? (
          <Chip color="warning" size="sm" variant="flat">
            完整权限确认
          </Chip>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <AuditField label="确认人" value={detail.operator || "未记录"} />
        <AuditField
          label="确认时间"
          value={formatDateTime(detail.confirmedAt)}
        />
        <AuditField
          label="风险等级"
          value={riskDetailLabel(detail.confirmedRiskLevel)}
        />
        <AuditField
          label="确认动作"
          value={detail.confirmedAction || "未记录"}
        />
        {detail.confirmationId ? (
          <AuditField label="确认 ID" value={detail.confirmationId} code />
        ) : null}
        {detail.reason ? (
          <AuditField label="确认原因" value={detail.reason} />
        ) : null}
      </div>

      {detail.checklist?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.checklist.map((item) => (
            <Chip
              color={item.checked ? "success" : "default"}
              key={item.label}
              size="sm"
              variant="flat"
            >
              {item.label}
            </Chip>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PayloadSummaryPanel({
  details,
}: {
  details: RiskAuditEvidenceDetail[];
}) {
  if (!details.length) return null;

  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-small font-semibold text-default-900">
          提交内容摘要
        </h4>
        <p className="mt-1 text-tiny leading-5 text-default-500">
          展示本次提交的账号、素材、封面、标签和定时策略摘要。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {details.map((detail, index) => (
          <div
            className="rounded-[8px] border-small border-divider bg-background p-3"
            key={`${detail.label}-${index}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="flat">
                {detail.platform || "平台"}
              </Chip>
              <Chip size="sm" variant="flat">
                {contentKindLabel(detail.contentKind)}
              </Chip>
              {detail.dryRun ? (
                <Chip color="warning" size="sm" variant="flat">
                  预发布检查
                </Chip>
              ) : null}
            </div>
            <p className="mt-2 text-small font-semibold text-default-900">
              {detail.title || detail.label}
            </p>
            <p className="mt-1 text-tiny leading-5 text-default-500">
              {commercialDisplayText(detail.summary || "未记录提交内容摘要")}
            </p>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <AuditField label="账号" value={detail.accountId || "未记录"} />
              <AuditField
                label="素材数"
                value={numericLabel(detail.materialCount)}
              />
              <AuditField
                label="封面数"
                value={numericLabel(detail.coverCount)}
              />
              <AuditField
                label="标签数"
                value={numericLabel(detail.tagCount)}
              />
              <AuditField
                label="发布策略"
                value={detail.scheduleSummary || "未记录"}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PreflightDetailPanel({
  detail,
}: {
  detail?: RiskAuditEvidenceDetail;
}) {
  if (!detail) return null;

  const issues = Array.isArray(detail.issues) ? detail.issues : [];

  return (
    <section className="rounded-[8px] border-small border-divider bg-default-50/60 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-small font-semibold text-default-900">
            发布前检查
          </h4>
          <p className="mt-1 text-tiny leading-5 text-default-500">
            {commercialDisplayText(detail.summary || "发布前检查记录")}
          </p>
        </div>
        <Chip
          color={detail.ok ? "success" : "warning"}
          size="sm"
          variant="flat"
        >
          {detail.ok ? "检查通过" : "需处理"}
        </Chip>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <AuditField label="检查时间" value={formatDateTime(detail.checkedAt)} />
        <AuditField
          label="提交内容"
          value={numericLabel(detail.payloadCount)}
        />
        <AuditField label="账号" value={numericLabel(detail.accountCount)} />
        <AuditField label="素材" value={numericLabel(detail.materialCount)} />
        <AuditField label="问题" value={numericLabel(detail.issueCount)} />
      </div>

      {issues.length ? (
        <div className="mt-3 space-y-2">
          {issues.map((issue, index) => (
            <div
              className="rounded-[6px] border-small border-warning-200 bg-warning-50 p-3"
              key={`${issue.code}-${index}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Chip color="warning" size="sm" variant="flat">
                  {issue.stage}
                </Chip>
                <span className="text-tiny text-default-500">
                  {issue.platform || issue.scope}
                  {issue.account ? ` · ${issue.account}` : ""}
                </span>
              </div>
              <p className="mt-2 text-small leading-6 text-warning-800">
                {issue.message}
              </p>
              <p className="mt-1 text-tiny leading-5 text-warning-700">
                下一步：{issue.nextAction}
              </p>
              {issue.filePath ? (
                <code className="mt-2 block truncate rounded-small bg-warning-100 px-2 py-1 text-[11px] text-warning-800">
                  {issue.filePath}
                </code>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function RiskAuditPlatformDetail({
  detail,
  index,
}: {
  detail: NonNullable<RiskAuditEvidence["details"]>[number];
  index: number;
}) {
  const evidenceUrl = detail.publishUrl || detail.evidenceUrl;
  return (
    <div className="rounded-[8px] border-small border-divider bg-background p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              color={publishStatusColor(detail.status)}
              size="sm"
              variant="flat"
            >
              {publishStatusLabel(detail.status, detail.statusLabel)}
            </Chip>
            <span className="text-small font-semibold text-default-900">
              {detail.label || `平台 ${index + 1}`}
            </span>
          </div>
          <p className="mt-2 text-small leading-6 text-default-600">
            {commercialDisplayText(
              detail.summary ||
                detail.failureReason ||
                detail.nextAction ||
                "无详情",
            )}
          </p>
        </div>
        {evidenceUrl ? (
          <Button
            as="a"
            href={evidenceUrl}
            rel="noreferrer"
            size="sm"
            target="_blank"
            variant="flat"
          >
            打开发布记录
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <AuditField label="平台" value={detail.platform || "未知平台"} />
        <AuditField label="账号" value={detail.accountId || "未记录"} />
        <AuditField
          label="记录来源"
          value={evidenceSourceLabel(detail.evidenceSource)}
        />
        {detail.publishTaskId ? (
          <AuditField label="任务编号" value={detail.publishTaskId} code />
        ) : null}
        {detail.externalId ? (
          <AuditField label="外部编号" value={detail.externalId} code />
        ) : null}
        {detail.publishUrl ? (
          <AuditField label="发布链接" value={detail.publishUrl} code />
        ) : null}
      </div>

      {detail.failureReason ? (
        <div className="mt-3 rounded-[6px] bg-danger-50 p-3">
          <p className="text-tiny font-semibold text-danger-700">失败原因</p>
          <p className="mt-1 text-small leading-6 text-danger-700">
            {commercialDisplayText(detail.failureReason)}
          </p>
        </div>
      ) : null}

      {detail.nextAction ? (
        <div className="mt-3 rounded-[6px] bg-warning-50 p-3">
          <p className="text-tiny font-semibold text-warning-700">下一步动作</p>
          <p className="mt-1 text-small leading-6 text-warning-700">
            {commercialDisplayText(detail.nextAction)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceInfoCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] border-small border-divider bg-background p-3">
      <p className="text-tiny text-default-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-default-900">{value}</p>
    </div>
  );
}

function AuditField({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-tiny text-default-400">{label}</p>
      {code ? (
        <code className="mt-1 block truncate rounded-small bg-default-100 px-2 py-1 text-tiny text-default-700">
          {commercialDisplayText(value)}
        </code>
      ) : (
        <p className="mt-1 truncate text-small text-default-700">
          {commercialDisplayText(value)}
        </p>
      )}
    </div>
  );
}

function AgentEvidenceTable({
  items,
  loading,
}: {
  items: AgentEvidenceRow[];
  loading: boolean;
}) {
  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-medium font-semibold text-default-900">
              任务过程记录
            </h3>
            <p className="mt-1 text-small text-default-500">
              任务事件中的截图、页面记录、步骤记录、失败原因和文件记录。
            </p>
          </div>
        </div>
        <Table
          aria-label="任务过程记录"
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
            emptyContent={
              loading ? (
                " "
              ) : (
                <FunctionalEmptyState
                  actions={[
                    { href: "/tasks/records", label: "任务历史" },
                    { href: "/solutions", label: "开始任务" },
                  ]}
                  description="完成发布、互动或检查后，这里会展示截图、页面记录、步骤记录、失败原因和文件记录。"
                  examples={["截图", "步骤记录", "失败原因", "文件记录"]}
                  title="暂无任务过程记录"
                />
              )
            }
            isLoading={loading}
            items={items}
            loadingContent={<Spinner label="读取中..." />}
          >
            {(row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Chip size="sm" variant="flat">
                    {evidenceTypeLabelMap[row.evidence.type] ||
                      row.evidence.type}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="max-w-[320px] space-y-1">
                    <p className="truncate text-small font-medium text-default-800">
                      {commercialDisplayText(
                        row.evidence.label || row.event.title || "过程凭证",
                      )}
                    </p>
                    <p className="truncate text-tiny text-default-500">
                      {truncate(row.evidence.value)}
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
                      {commercialDisplayText(row.session.title)}
                    </p>
                    <p className="text-tiny text-default-400">
                      {sourceLabel(row.session.source)}
                    </p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-tiny text-default-500">
                    {formatDateTime(row.event.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    as={Link}
                    href={`/tasks/records?sessionId=${encodeURIComponent(
                      row.session.id,
                    )}`}
                    size="sm"
                    variant="flat"
                  >
                    记录
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardBody>
    </Card>
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
