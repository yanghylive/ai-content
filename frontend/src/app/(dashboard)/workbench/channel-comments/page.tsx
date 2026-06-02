"use client";

import React, { useEffect, useCallback } from "react";
import { Card, CardBody, Button, Chip, addToast } from "@heroui/react";
import { useDouyinState, useAgentSState } from "@/lib/ops-workbench/hooks";
import { OpsWorkbenchDouyinCard } from "@/components/ops-workbench/douyin-card";
import { InteractionRealtimePanel } from "@/components/ops-workbench/interaction-realtime-panel";
import { autoUploadApi, type AutoUploadAccount } from "@/lib/api/auto-upload";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { loadReadyLocalAccountsByType } from "@/lib/ops-workbench/local-platform-accounts";
import { hasInteractionReadbackProof } from "../interaction-proof";
import { useCdpSessionStatus } from "../use-cdp-session-status";

export default function ChannelCommentsPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const { refreshAgentSStatus } = agentS;
  const [channelAccount, setChannelAccount] =
    React.useState<AutoUploadAccount | null>(null);
  const [activeTask, setActiveTask] = React.useState<InteractionTask | null>(
    null,
  );
  const [taskBusy, setTaskBusy] = React.useState(false);
  const [openingAccount, setOpeningAccount] = React.useState(false);
  const [startingFeedback, setStartingFeedback] = React.useState<string | null>(
    null,
  );
  const channelAccountReady = channelAccount?.status === 1;
  const cdpStatus = useCdpSessionStatus("wechat-channel", channelAccount);

  useEffect(() => {
    let alive = true;
    async function loadChannelAccount() {
      try {
        const accounts = await loadReadyLocalAccountsByType(2);
        const account = accounts[0] || null;
        if (alive) setChannelAccount(account);
      } catch {
        if (alive) setChannelAccount(null);
      }
    }
    refreshAgentSStatus();
    void loadChannelAccount();
    return () => {
      alive = false;
    };
  }, [refreshAgentSStatus]);

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
                  activeTask.status === "skipped" ||
                  activeTask.status === "blocked"
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
        activeTask.status === "completed" && hasReadbackProof
          ? `对象：${activeTask.sourceText}。回复：${activeTask.replyText}`
          : "",
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
      roundStatusLabel: "正在启动真实视频号评论回复",
      roundStatusDetail:
        startingFeedback || "正在创建任务并连接本机视频号后台。",
      stageLabel: "启动中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [
        {
          label: "选择真实账号",
          status: channelAccountReady
            ? ("completed" as const)
            : ("blocked" as const),
          message: channelAccountReady
            ? `已选择 ${channelAccount?.profileName || channelAccount?.userName || `账号 ${channelAccount?.id}`}。`
            : "等待可用视频号账号。",
        },
        {
          label: "创建执行任务",
          status: "running" as const,
          message: startingFeedback || "正在把任务交给本机引擎。",
        },
        {
          label: "读取评论并生成回复",
          status: "pending" as const,
          message: "任务创建成功后会打开视频号后台读取真实评论。",
        },
        {
          label: "自动发送结果",
          status: "pending" as const,
          message: "自动发送模式会直接调用真实发送执行器。",
        },
      ],
      liveEvents: [
        {
          message:
            startingFeedback || "已点击开始，正在启动真实视频号评论任务。",
          level: "info" as const,
          createdAt: new Date().toISOString(),
        },
      ],
      canStart: false,
    };
  }, [
    channelAccount,
    channelAccountReady,
    startingFeedback,
    taskBusy,
    taskOutcome,
  ]);

  const handleStartCommentReply = useCallback(async () => {
    const accountLabel =
      channelAccount?.profileName ||
      channelAccount?.userName ||
      channelAccount?.filePath ||
      "默认视频号账号";
    if (!channelAccount?.id || !channelAccountReady) {
      addToast({
        title: "没有可用视频号账号",
        description: "请先在平台账号里登录一个视频号账号。",
        color: "danger",
      });
      return;
    }
    if (!cdpStatus.sessionReady) {
      addToast({
        title: "视频号后台未连接",
        description:
          cdpStatus.blocker || "请先让本机浏览器 CDP 会话恢复 ready。",
        color: "danger",
      });
      return;
    }

    try {
      setTaskBusy(true);
      setStartingFeedback("正在创建任务，马上打开视频号后台读取真实评论。");
      const task = await localEngineApi.createBusinessTask("channel-comments", {
        type: "wechat-channel-comment-reply",
        accountId: String(channelAccount.id),
        accountName: accountLabel,
        platformType: channelAccount.type || 2,
        platformName: "视频号",
        targetName: "视频号评论管理",
        sourceText: "等待系统读取真实评论",
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === "auto-send",
      });
      setActiveTask(task);
      setStartingFeedback(null);
      douyin.startDouyinSession("comment-reply");
      addToast({ title: "视频号评论回复任务已启动", color: "success" });
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
  }, [
    cdpStatus.blocker,
    cdpStatus.sessionReady,
    douyin,
    channelAccount,
    channelAccountReady,
  ]);

  const handleOpenChannelAccount = useCallback(async () => {
    if (!channelAccount?.id) {
      window.location.href = "/distribution?tab=accounts";
      return;
    }
    try {
      setOpeningAccount(true);
      await autoUploadApi.openAccounts([channelAccount.id]);
      addToast({
        title: "已打开视频号后台",
        description: "请在打开的页面完成登录，完成后回到这里刷新。",
        color: "success",
      });
    } catch (error) {
      addToast({
        title: "打开视频号后台失败",
        description:
          error instanceof Error ? error.message : "请到平台账号页重新登录。",
        color: "danger",
      });
    } finally {
      setOpeningAccount(false);
    }
  }, [channelAccount]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">视频号评论回复</h1>
        <p className="text-sm text-default-500">
          AI
          自动识别真实客户评论并按内容回复，默认直接发送；切到确认后发送才会停下等你确认
        </p>
      </div>

      <Card>
        <CardBody className="gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Chip
                color={
                  channelAccountReady
                    ? "success"
                    : channelAccount
                      ? "warning"
                      : "default"
                }
                size="sm"
              >
                视频号账号：
                {channelAccountReady
                  ? cdpStatus.sessionReady
                    ? "已登录"
                    : "后台未连接"
                  : channelAccount
                    ? "需重新登录"
                    : "未绑定"}
              </Chip>
              {!channelAccountReady ? (
                <Button
                  size="sm"
                  variant="flat"
                  color="warning"
                  isLoading={openingAccount}
                  onPress={handleOpenChannelAccount}
                >
                  {channelAccount ? "打开视频号重新登录" : "去绑定视频号"}
                </Button>
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
              !channelAccountReady || !cdpStatus.sessionReady
                ? "attention"
                : visibleOutcome?.cardStatus ||
                  (douyin.douyinBatchState?.active ? "running" : "ready")
            }
            sendMode={douyin.douyinSendMode}
            title="视频号评论回复"
            summary={
              !channelAccountReady
                ? "当前视频号账号未登录，不能读取或回复真实评论。"
                : !cdpStatus.sessionReady
                  ? `视频号后台未就绪：${cdpStatus.blocker || "CDP 会话不可用"}`
                  : visibleOutcome?.roundStatusDetail
                    ? visibleOutcome.roundStatusDetail
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
            browserStatusLabel="视频号后台"
            browserStatusDetail={
              cdpStatus.sessionReady
                ? "自动打开视频号后台，AI 识别真实客户评论后按发送设置执行"
                : cdpStatus.blocker ||
                  "CDP 会话不可用，不能读取或回复真实评论。"
            }
            primaryActionLabel="开始回评论"
            secondaryActionLabel="进入视频号后台"
            canStart={
              Boolean(channelAccount?.id) &&
              channelAccountReady &&
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
            <InteractionRealtimePanel
              task={activeTask}
              platformLabel="视频号"
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
