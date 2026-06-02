"use client";

import React, { useEffect, useCallback } from "react";
import {
  Card,
  CardBody,
  Button,
  Chip,
  Select,
  SelectItem,
  addToast,
} from "@heroui/react";
import { useDouyinState, useAgentSState } from "@/lib/ops-workbench/hooks";
import { OpsWorkbenchDouyinCard } from "@/components/ops-workbench/douyin-card";
import { InteractionRealtimePanel } from "@/components/ops-workbench/interaction-realtime-panel";
import type { AutoUploadAccount } from "@/lib/api/auto-upload";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { loadReadyLocalAccountsByType } from "@/lib/ops-workbench/local-platform-accounts";
import { hasInteractionReadbackProof } from "../interaction-proof";
import { useCdpSessionStatus } from "../use-cdp-session-status";

function pickDefaultDouyinAccount(accounts: AutoUploadAccount[]) {
  return (
    accounts.find(
      (account) =>
        (account.profileName || account.userName || "").trim() !== "磊",
    ) ||
    accounts[0] ||
    null
  );
}

export default function DouyinCommentsPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const [douyinAccounts, setDouyinAccounts] = React.useState<
    AutoUploadAccount[]
  >([]);
  const [douyinAccount, setDouyinAccount] =
    React.useState<AutoUploadAccount | null>(null);
  const [activeTask, setActiveTask] = React.useState<InteractionTask | null>(
    null,
  );
  const [taskBusy, setTaskBusy] = React.useState(false);
  const [startingFeedback, setStartingFeedback] = React.useState<string | null>(
    null,
  );
  const cdpStatus = useCdpSessionStatus("douyin", douyinAccount);

  useEffect(() => {
    let alive = true;
    async function loadAccounts() {
      try {
        const readyDouyinAccounts = await loadReadyLocalAccountsByType(3);
        if (!alive) return;
        setDouyinAccounts(readyDouyinAccounts);
        setDouyinAccount(pickDefaultDouyinAccount(readyDouyinAccounts));
      } catch {
        if (!alive) return;
        setDouyinAccounts([]);
        setDouyinAccount(null);
      }
    }
    agentS.refreshAgentSStatus();
    void loadAccounts();
    return () => {
      alive = false;
    };
  }, [agentS.refreshAgentSStatus]);

  useEffect(() => {
    if (!activeTask?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        const task = await localEngineApi.task(activeTask.id);
        setActiveTask(task);
      } catch (error) {
        console.error("Failed to poll task:", error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeTask?.id]);

  const taskOutcome = React.useMemo(() => {
    if (!activeTask) return null;
    const latestOutcomeEvent = [...(activeTask.events || [])]
      .filter(
        (event) =>
          !event.message.includes("已保存") && !event.message.includes("截图"),
      )
      .sort((a, b) =>
        String(b.createdAt).localeCompare(String(a.createdAt)),
      )[0];
    const isRunning =
      activeTask.status === "queued" || activeTask.status === "running";
    const detail = isRunning
      ? latestOutcomeEvent?.message ||
        activeTask.nextAction ||
        activeTask.statusLabel
      : activeTask.failureReason ||
        activeTask.nextAction ||
        latestOutcomeEvent?.message ||
        activeTask.statusLabel;
    const hasReadbackProof = hasInteractionReadbackProof(activeTask);
    return {
      cardStatus:
        activeTask.status === "completed" && hasReadbackProof
          ? ("ready" as const)
          : activeTask.status === "completed"
            ? ("attention" as const)
            : activeTask.status === "no_target"
              ? ("empty" as const)
              : activeTask.status === "failed" ||
                  activeTask.status === "skipped"
                ? ("attention" as const)
                : activeTask.status === "waiting_for_send_confirmation"
                  ? ("review" as const)
                  : ("running" as const),
      roundStatusLabel: activeTask.statusLabel,
      roundStatusDetail: detail,
      stageLabel: isRunning ? "处理中" : activeTask.statusLabel,
      lastOutcomeTitle: "最近一次执行结果",
      lastOutcomeDetail: [
        detail,
        activeTask.resultSummary?.counts
          ? `处理：成功 ${activeTask.resultSummary.counts.completed}，失败 ${activeTask.resultSummary.counts.failed}，无对象 ${activeTask.resultSummary.counts.noTarget}。`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      liveSteps:
        activeTask.steps?.map((step) => ({
          label: step.label,
          status: step.status,
          message: step.message,
        })) || [],
      liveEvents: [...(activeTask.events || [])]
        .filter(
          (event) =>
            !event.message.includes("已保存") &&
            !event.message.includes("截图"),
        )
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 5)
        .map((event) => ({
          message: event.message,
          level: event.level,
          createdAt: event.createdAt,
        })),
      canStart: !isRunning,
    };
  }, [activeTask]);

  const visibleOutcome = React.useMemo(() => {
    if (taskOutcome) return taskOutcome;
    if (!taskBusy && !startingFeedback) return null;
    return {
      cardStatus: "running" as const,
      roundStatusLabel: "正在启动真实评论回复",
      roundStatusDetail: startingFeedback || "正在创建任务并连接本机抖音后台。",
      stageLabel: "启动中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [
        {
          label: "选择真实账号",
          status: "completed" as const,
          message: douyinAccount
            ? `已选择 ${douyinAccount.profileName || douyinAccount.userName || `账号 ${douyinAccount.id}`}。`
            : "等待选择抖音账号。",
        },
        {
          label: "创建执行任务",
          status: "running" as const,
          message: startingFeedback || "正在把任务交给本机引擎。",
        },
        {
          label: "读取评论并生成回复",
          status: "pending" as const,
          message: "任务创建成功后会继续打开抖音后台读取真实评论。",
        },
        {
          label: "自动发送结果",
          status: "pending" as const,
          message: "自动发送模式会跳过人工确认，直接调用真实发送执行器。",
        },
      ],
      liveEvents: [
        {
          message: startingFeedback || "已点击开始，正在启动真实抖音评论任务。",
          level: "info" as const,
          createdAt: new Date().toISOString(),
        },
      ],
      canStart: false,
    };
  }, [douyinAccount, startingFeedback, taskBusy, taskOutcome]);

  const handleStartCommentReply = useCallback(async () => {
    const accountLabel =
      douyinAccount?.profileName ||
      douyinAccount?.userName ||
      douyinAccount?.filePath ||
      "默认抖音账号";
    if (!douyinAccount?.id) {
      addToast({
        title: "没有可用抖音账号",
        description: "请先在平台账号里登录一个抖音账号。",
        color: "danger",
      });
      return;
    }
    if (!cdpStatus.sessionReady) {
      addToast({
        title: "抖音后台未连接",
        description:
          cdpStatus.blocker || "请先让本机浏览器 CDP 会话恢复 ready。",
        color: "danger",
      });
      return;
    }

    try {
      setTaskBusy(true);
      setStartingFeedback("正在创建任务，马上打开抖音后台读取真实评论。");
      const task = await localEngineApi.createBusinessTask("comments", {
        type: "douyin-comment-reply",
        accountId: String(douyinAccount.id),
        accountName: accountLabel,
        platformType: douyinAccount.type || 3,
        platformName: "抖音",
        targetName: "抖音评论管理",
        sourceText: "等待系统读取真实评论",
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === "auto-send",
      });
      setActiveTask(task);
      setStartingFeedback(null);
      douyin.startDouyinSession("comment-reply");
      addToast({ title: "评论回复任务已启动", color: "success" });
    } catch (error) {
      setStartingFeedback(null);
      addToast({
        title: "启动失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        color: "danger",
      });
    } finally {
      setTaskBusy(false);
    }
  }, [cdpStatus.blocker, cdpStatus.sessionReady, douyin, douyinAccount]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">抖音评论回复</h1>
        <p className="text-sm text-default-500">
          AI
          自动识别真实客户评论并按内容回复，默认直接发送；切到确认后发送才会停下等你确认
        </p>
      </div>

      <Card>
        <CardBody className="gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Chip color={douyinAccount ? "success" : "default"} size="sm">
                抖音账号：
                {douyinAccount
                  ? douyinAccount.profileName ||
                    douyinAccount.userName ||
                    `账号 ${douyinAccount.id}`
                  : "未登录"}
              </Chip>
              {douyinAccounts.length > 1 ? (
                <Select
                  aria-label="选择抖音账号"
                  className="w-56"
                  size="sm"
                  selectedKeys={
                    douyinAccount?.id ? [String(douyinAccount.id)] : []
                  }
                  onSelectionChange={(keys) => {
                    const selectedId = Number(Array.from(keys)[0]);
                    setDouyinAccount(
                      douyinAccounts.find(
                        (account) => account.id === selectedId,
                      ) || null,
                    );
                    setActiveTask(null);
                  }}
                >
                  {douyinAccounts.map((account) => (
                    <SelectItem key={String(account.id)}>
                      {account.profileName ||
                        account.userName ||
                        `账号 ${account.id}`}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              {agentS.agentSStatus?.connected ? (
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  onPress={agentS.stopAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  color="primary"
                  onPress={agentS.startAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  启动
                </Button>
              )}
            </div>
          </div>

          {agentS.agentSError && (
            <Chip color="danger" size="sm">
              {agentS.agentSError}
            </Chip>
          )}

          <OpsWorkbenchDouyinCard
            status={
              visibleOutcome?.cardStatus ||
              (!cdpStatus.sessionReady
                ? "attention"
                : douyin.douyinBatchState?.active
                  ? "running"
                  : "ready")
            }
            sendMode={douyin.douyinSendMode}
            title="抖音评论回复"
            summary={
              visibleOutcome?.roundStatusDetail
                ? visibleOutcome.roundStatusDetail
                : !cdpStatus.sessionReady
                  ? `抖音后台未就绪：${cdpStatus.blocker || "CDP 会话不可用"}`
                  : douyin.douyinBatchState?.active
                    ? `正在处理中，已处理 ${douyin.douyinBatchState.processedCount} 条`
                    : "AI 识别评论后自动回复"
            }
            roundStatusLabel={visibleOutcome?.roundStatusLabel}
            roundStatusDetail={visibleOutcome?.roundStatusDetail}
            stageLabel={visibleOutcome?.stageLabel}
            lastOutcomeTitle={visibleOutcome?.lastOutcomeTitle}
            lastOutcomeDetail={visibleOutcome?.lastOutcomeDetail}
            liveSteps={visibleOutcome?.liveSteps}
            liveEvents={visibleOutcome?.liveEvents}
            browserStatusLabel="抖音后台"
            browserStatusDetail={
              cdpStatus.sessionReady
                ? "自动打开抖音后台，AI 识别真实客户评论后按发送设置执行"
                : cdpStatus.blocker ||
                  "CDP 会话不可用，不能读取或回复真实评论。"
            }
            primaryActionLabel="开始回评论"
            canStart={
              Boolean(douyinAccount?.id) &&
              cdpStatus.sessionReady &&
              (visibleOutcome?.canStart ?? !douyin.douyinBatchState?.active)
            }
            canOpen={false}
            canTertiary={false}
            isBusy={agentS.agentSBusy || taskBusy}
            onStartAutoReply={handleStartCommentReply}
            onSendModeChange={douyin.setDouyinSendMode}
            onRefresh={() => {
              void cdpStatus.refresh();
              agentS.refreshAgentSStatus();
            }}
          />

          {activeTask && (
            <InteractionRealtimePanel task={activeTask} platformLabel="抖音" />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
