"use client";

import React from "react";
import Link from "next/link";
import { Button, Card, CardBody, Chip, Spinner, addToast } from "@heroui/react";
import { Icon } from "@/components/lucide-icon-compat";
import { FailureActionPanel } from "@/app/(dashboard)/components/failure-action-panel";
import { getCrmAppState } from "@/lib/api/app-market";
import {
  getCrmSummary,
  listCrmTasks,
  readCrmCloserAdvice,
  type CrmCloserAdvice,
  type CrmCloserSummaryResponse,
  type CrmSummary,
  type CrmTask,
} from "@/lib/api/crm";
import { commercialDisplayText } from "@/lib/commercial-display-text";
import { localEngineApi } from "@/lib/api/local-engine";
import { toActionableError } from "@/lib/public-error";

function formatDateTime(value?: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未设置";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOpenTask(task: CrmTask) {
  return !task.archived && task.status !== "done" && !task.completedAt;
}

function isOverdue(task: CrmTask) {
  if (!task.dueAt || !isOpenTask(task)) return false;
  const due = new Date(task.dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  return due < Date.now();
}

function priorityColor(value?: string | null) {
  if (value === "high") return "danger" as const;
  if (value === "medium" || value === "normal") return "warning" as const;
  return "default" as const;
}

function riskColor(value?: string | null) {
  if (value === "high") return "danger" as const;
  if (value === "medium") return "warning" as const;
  return "success" as const;
}

function taskTarget(task: CrmTask) {
  return (
    task.customerName ||
    task.opportunityName ||
    task.companyName ||
    "未关联对象"
  );
}

function followUpTarget(advice: CrmCloserAdvice | null, task: CrmTask | null) {
  return (
    advice?.customerName ||
    advice?.opportunityName ||
    advice?.companyName ||
    task?.customerName ||
    task?.opportunityName ||
    task?.companyName ||
    task?.title ||
    "未命名客户跟进"
  );
}

function compactLine(value?: string | null) {
  return value?.trim() ? value.trim() : null;
}

function buildFollowUpInstruction({
  advice,
  task,
  closerSummary,
}: {
  advice: CrmCloserAdvice | null;
  task: CrmTask | null;
  closerSummary: CrmCloserSummaryResponse | null;
}) {
  const evidence = advice?.evidence
    ?.slice(0, 5)
    .map((item) => `${item.label}${item.detail ? `：${item.detail}` : ""}`)
    .join("；");
  const riskPoints = advice?.riskPoints?.slice(0, 5).join("；");

  return [
    "请生成一个客户跟进任务的人工执行计划。只输出建议、检查项和下一步，不要自动发送消息，不要写入外部平台。",
    `跟进对象：${followUpTarget(advice, task)}`,
    compactLine(advice?.title) ? `成交助手建议：${advice?.title}` : null,
    compactLine(advice?.reason) ? `建议原因：${advice?.reason}` : null,
    compactLine(advice?.recommendedAction)
      ? `推荐动作：${advice?.recommendedAction}`
      : null,
    compactLine(advice?.nextStep) ? `下一步：${advice?.nextStep}` : null,
    compactLine(advice?.suggestedScript)
      ? `建议话术：${advice?.suggestedScript}`
      : null,
    task ? `关联 CRM 任务：${task.title}` : null,
    compactLine(task?.description) ? `任务说明：${task?.description}` : null,
    task?.dueAt ? `任务截止：${formatDateTime(task.dueAt)}` : null,
    riskPoints ? `风险点：${riskPoints}` : null,
    evidence ? `证据引用：${evidence}` : null,
    closerSummary?.summary ? `队列摘要：${closerSummary.summary}` : null,
    closerSummary?.nextActions?.length
      ? `队列下一步：${closerSummary.nextActions.slice(0, 5).join("；")}`
      : null,
    "输出要求：给出优先级、跟进步骤、人工确认点、建议话术和需要回看证据的位置。",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function CrmNextActionPanel() {
  const [summary, setSummary] = React.useState<CrmSummary | null>(null);
  const [closerSummary, setCloserSummary] =
    React.useState<CrmCloserSummaryResponse | null>(null);
  const [advice, setAdvice] = React.useState<CrmCloserAdvice[]>([]);
  const [tasks, setTasks] = React.useState<CrmTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [creatingSession, setCreatingSession] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadQueue = React.useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") setLoading(true);
    if (mode === "refresh") setRefreshing(true);
    setError("");

    try {
      const appState = await getCrmAppState();
      if (!appState.installed) {
        setError("CRM 尚未安装。安装后会显示待办任务、成交助手建议和客户时间线。");
        setSummary(null);
        setCloserSummary(null);
        setAdvice([]);
        setTasks([]);
        return;
      }
      if (
        appState.commercialEntitlementRequired &&
        !appState.commercialEntitled
      ) {
        setError("CRM 需要有效商用授权后才能读取客户处理队列。");
        setSummary(null);
        setCloserSummary(null);
        setAdvice([]);
        setTasks([]);
        return;
      }

      const [nextSummary, nextTasks, closer] = await Promise.all([
        getCrmSummary(),
        listCrmTasks({ status: "open" }).catch(() => listCrmTasks()),
        readCrmCloserAdvice({
          limit: 3,
          horizonDays: 7,
          includeDormant: true,
        }),
      ]);
      setSummary(nextSummary);
      setTasks(nextTasks.filter(isOpenTask));
      setCloserSummary(closer.summary);
      setAdvice(closer.advice || []);
    } catch (caught: unknown) {
      setError(toActionableError(caught, "客户队列读取失败"));
      setSummary(null);
      setCloserSummary(null);
      setAdvice([]);
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadQueue("initial");
  }, [loadQueue]);

  const sortedTasks = React.useMemo(
    () =>
      [...tasks].sort((left, right) => {
        const leftOverdue = isOverdue(left) ? 0 : 1;
        const rightOverdue = isOverdue(right) ? 0 : 1;
        if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
        const priorityOrder: Record<string, number> = {
          high: 0,
          normal: 1,
          medium: 1,
          low: 2,
        };
        const byPriority =
          (priorityOrder[left.priority] ?? 3) -
          (priorityOrder[right.priority] ?? 3);
        if (byPriority !== 0) return byPriority;
        return String(left.dueAt || "").localeCompare(
          String(right.dueAt || ""),
        );
      }),
    [tasks],
  );
  const firstAdvice = advice[0] || null;
  const firstTask = sortedTasks[0] || null;
  const overdueCount = sortedTasks.filter(isOverdue).length;
  const targetLabel = followUpTarget(firstAdvice, firstTask);
  const canCreateFollowUpTask = Boolean(
    firstAdvice || firstTask || closerSummary?.nextActions?.length,
  );

  const createFollowUpSession = React.useCallback(async () => {
    if (!canCreateFollowUpTask || creatingSession) return;
    setCreatingSession(true);

    try {
      const session = await localEngineApi.createAgentSession({
        source: "interaction",
        executionScope: "browser",
        targetApp: "客户互动 / CRM",
        dryRun: true,
        commercialExecutionRequested: false,
        title: `客户跟进：${targetLabel}`,
        instruction: buildFollowUpInstruction({
          advice: firstAdvice,
          task: firstTask,
          closerSummary,
        }),
        metadata: {
          source: "engagement-customers",
          mode: "crm-follow-up",
          adviceId: firstAdvice?.id ?? null,
          customerId: firstAdvice?.customerId ?? firstTask?.customerId ?? null,
          customerName:
            firstAdvice?.customerName ?? firstTask?.customerName ?? null,
          companyId: firstAdvice?.companyId ?? firstTask?.companyId ?? null,
          companyName:
            firstAdvice?.companyName ?? firstTask?.companyName ?? null,
          opportunityId:
            firstAdvice?.opportunityId ?? firstTask?.opportunityId ?? null,
          opportunityName:
            firstAdvice?.opportunityName ?? firstTask?.opportunityName ?? null,
          taskId: firstAdvice?.taskId ?? firstTask?.id ?? null,
          priority: firstAdvice?.priority ?? firstTask?.priority ?? "normal",
          riskLevel: firstAdvice?.riskLevel ?? "low",
        },
      });

      addToast({
        color: "success",
        title: "已加入任务中心",
        description: session.title || "客户跟进任务已创建，可在任务中心继续处理。",
      });
    } catch (caught: unknown) {
      addToast({
        color: "danger",
        title: "加入任务中心失败",
        description:
          toActionableError(caught, "本机服务暂不可用"),
      });
    } finally {
      setCreatingSession(false);
    }
  }, [
    canCreateFollowUpTask,
    closerSummary,
    creatingSession,
    firstAdvice,
    firstTask,
    targetLabel,
  ]);

  return (
    <Card className="border-small border-divider bg-background shadow-sm">
      <CardBody className="gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip color="primary" size="sm" variant="flat">
                客户处理队列
              </Chip>
              {overdueCount ? (
                <Chip color="danger" size="sm" variant="flat">
                  {overdueCount} 个逾期
                </Chip>
              ) : null}
            </div>
            <h2 className="mt-2 text-lg font-semibold leading-6 text-default-900">
              下一个要处理的人 / 机会
            </h2>
            <p className="mt-1 text-small leading-6 text-default-500">
              汇总 CRM 任务、成交助手建议和互动记录，把客户入口收束成待处理队列。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              as={Link}
              href="/crm"
              size="sm"
              startContent={<Icon icon="solar:user-id-linear" />}
              variant="flat"
            >
              CRM
            </Button>
            <Button
              as={Link}
              href="/crm/closer"
              size="sm"
              startContent={<Icon icon="solar:magic-stick-3-linear" />}
              variant="flat"
            >
              成交助手
            </Button>
            <Button
              as={Link}
              href="/tasks"
              size="sm"
              startContent={<Icon icon="solar:checklist-minimalistic-linear" />}
              variant="flat"
            >
              任务中心
            </Button>
            <Button
              color="primary"
              isLoading={refreshing}
              size="sm"
              startContent={
                refreshing ? null : <Icon icon="solar:refresh-linear" />
              }
              variant="flat"
              onPress={() => void loadQueue("refresh")}
            >
              刷新
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-[8px] border-small border-divider bg-default-50 p-3 text-small text-default-500">
            <Spinner size="sm" /> 正在读取客户队列...
          </div>
        ) : null}

        {error ? (
          <FailureActionPanel
            actions={[
              { href: "/apps", label: "检查 CRM 应用" },
              { href: "/crm", label: "打开 CRM" },
              {
                label: "重新读取",
                onPress: () => {
                  void loadQueue("refresh");
                },
              },
            ]}
            impact="客户待办、成交建议和跟进时间线暂时无法汇总。"
            nextAction="先确认 CRM 应用和商用授权可用，再重新读取客户队列。"
            reason="客户队列暂时不可用，可能是 CRM 应用、授权或客户数据还没准备好。"
            technicalDetails={commercialDisplayText(error)}
            title="客户队列需要处理"
          />
        ) : null}

        {!loading && !error ? (
          <div className="grid gap-3 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Chip
                  color={riskColor(firstAdvice?.riskLevel)}
                  size="sm"
                  variant="flat"
                >
                  {firstAdvice?.riskLevel === "high"
                    ? "高风险"
                    : firstAdvice?.riskLevel === "medium"
                      ? "中风险"
                      : "常规跟进"}
                </Chip>
                <Chip
                  color={priorityColor(firstAdvice?.priority)}
                  size="sm"
                  variant="flat"
                >
                  {firstAdvice?.priority === "high"
                    ? "高优先级"
                    : firstAdvice?.priority === "low"
                      ? "低优先级"
                      : "普通优先级"}
                </Chip>
              </div>
              <h3 className="text-medium font-semibold text-default-900">
                {firstAdvice?.customerName ||
                  firstAdvice?.opportunityName ||
                  firstTask?.customerName ||
                  firstTask?.opportunityName ||
                  firstTask?.title ||
                  "暂无优先客户"}
              </h3>
              <p className="mt-2 text-small leading-6 text-default-600">
                {firstAdvice?.reason ||
                  firstTask?.description ||
                  closerSummary?.summary ||
                  "当前没有成交助手建议或待办任务。"}
              </p>
              {firstAdvice?.recommendedAction || firstAdvice?.nextStep ? (
                <div className="mt-3 rounded-[8px] border-small border-primary-200 bg-primary-50 p-3 text-small text-primary-700">
                  <p className="font-semibold">建议动作</p>
                  <p className="mt-1">
                    {firstAdvice.recommendedAction || firstAdvice.nextStep}
                  </p>
                </div>
              ) : null}
              {firstAdvice?.suggestedScript ? (
                <div className="mt-3 rounded-[8px] border-small border-divider bg-background p-3 text-small text-default-600">
                  <p className="font-semibold text-default-900">建议话术</p>
                  <p className="mt-1 whitespace-pre-wrap leading-6">
                    {firstAdvice.suggestedScript}
                  </p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  color="primary"
                  isDisabled={!canCreateFollowUpTask}
                  isLoading={creatingSession}
                  size="sm"
                  startContent={
                    creatingSession ? null : (
                      <Icon icon="solar:checklist-minimalistic-linear" />
                    )
                  }
                  variant="solid"
                  onPress={() => void createFollowUpSession()}
                >
                  加入任务中心
                </Button>
                <Button as={Link} href="/crm/closer" size="sm" variant="flat">
                  查看完整建议
                </Button>
                <Button
                  as={Link}
                  href="/engagement/records"
                  size="sm"
                  variant="flat"
                >
                  互动记录
                </Button>
              </div>
            </section>

            <section className="rounded-[8px] border-small border-divider bg-default-50 p-4">
              <div className="mb-3 grid grid-cols-2 gap-2">
                <QueueMetric
                  label="活跃客户"
                  value={summary?.activeCustomers ?? 0}
                />
                <QueueMetric
                  label="待办任务"
                  tone={overdueCount ? "danger" : "default"}
                  value={summary?.openTasks ?? sortedTasks.length}
                />
                <QueueMetric
                  label="风险机会"
                  tone={
                    closerSummary?.riskOpportunityCount ? "warning" : "default"
                  }
                  value={closerSummary?.riskOpportunityCount ?? 0}
                />
                <QueueMetric
                  label="建议动作"
                  tone={advice.length ? "primary" : "default"}
                  value={advice.length}
                />
              </div>
              <div className="flex flex-col gap-2">
                {sortedTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    className="rounded-[8px] border-small border-divider bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-small font-semibold text-default-900">
                        {task.title}
                      </p>
                      <Chip
                        color={
                          isOverdue(task)
                            ? "danger"
                            : priorityColor(task.priority)
                        }
                        size="sm"
                        variant="flat"
                      >
                        {isOverdue(task) ? "逾期" : task.priority || "普通"}
                      </Chip>
                    </div>
                    <p className="mt-1 text-tiny text-default-500">
                      {taskTarget(task)} · 截止 {formatDateTime(task.dueAt)}
                    </p>
                  </div>
                ))}
                {!sortedTasks.length ? (
                  <div className="rounded-[8px] border-small border-dashed border-divider bg-background p-4 text-center text-small text-default-500">
                    暂无待处理 CRM 任务。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function QueueMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "primary" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-danger-200 bg-danger-50 text-danger-700"
      : tone === "warning"
        ? "border-warning-200 bg-warning-50 text-warning-700"
        : tone === "primary"
          ? "border-primary-200 bg-primary-50 text-primary-700"
          : "border-divider bg-background text-default-700";

  return (
    <div className={`rounded-[8px] border-small p-3 ${toneClass}`}>
      <p className="text-tiny font-semibold opacity-80">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
