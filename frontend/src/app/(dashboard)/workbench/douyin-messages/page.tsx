"use client";

import React, { useEffect, useCallback, useMemo } from "react";
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
import { hasInteractionReadbackProof } from "../interaction-proof";
import { loadReadyLocalAccountsByType } from "@/lib/ops-workbench/local-platform-accounts";
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

function parseWorkflowSummary(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  const buildSummary = (browser: Record<string, unknown>) => {
    const snippet = String(browser.textSnippet || text || "");
    const executedSteps = Array.isArray(browser.executedSteps)
      ? browser.executedSteps
      : [];
    const messageInspectStep = executedSteps.find((step) => {
      const action =
        typeof step === "object" && step
          ? (step as Record<string, unknown>).action
          : null;
      return action === "inspectDouyinMessages";
    }) as Record<string, unknown> | undefined;
    const selectedMessage = messageInspectStep?.selected as
      | Record<string, unknown>
      | undefined;
    const selectedTarget =
      typeof selectedMessage?.text === "string"
        ? selectedMessage.text
        : undefined;
    const candidateCount =
      typeof messageInspectStep?.candidateCount === "number"
        ? messageInspectStep.candidateCount
        : undefined;
    const hasLoggedInAccount = /抖音号|粉丝|获赞|施主聒噪|数据中心/.test(
      snippet,
    );
    const hasMessageEntry = /私信管理|用户私信|私信|消息/.test(snippet);
    const hasMessageList = /全部|全部私信|朋友私信|陌生人私信|群消息/.test(
      snippet,
    );
    const noTarget =
      candidateCount === 0 ||
      /暂无会话|暂无私信|暂无消息|没有新的|还没有收到消息/.test(snippet);
    return {
      finalUrl:
        typeof browser.finalUrl === "string"
          ? browser.finalUrl
          : text.match(/"finalUrl":\s*"([^"]+)"/)?.[1],
      pageTitle:
        typeof browser.pageTitle === "string"
          ? browser.pageTitle
          : text.match(/"pageTitle":\s*"([^"]+)"/)?.[1],
      storageStateImported:
        browser.storageStateImported === true ||
        /"storageStateImported":\s*true/.test(text),
      hasLoggedInAccount,
      hasMessageEntry,
      hasMessageList,
      noTarget,
      candidateCount,
      selectedTarget,
      screenshotPath:
        typeof browser.screenshotPath === "string"
          ? browser.screenshotPath
          : undefined,
    };
  };

  if (!match) {
    if (
      !/douyin\.interaction\.browser_session|storageStateImported|抖音创作者中心|私信管理/.test(
        text,
      )
    ) {
      return null;
    }
    return buildSummary({});
  }
  try {
    const parsed = JSON.parse(match[0]);
    const browser = parsed?.browser || {};
    return buildSummary(browser);
  } catch {
    if (
      !/douyin\.interaction\.browser_session|storageStateImported|抖音创作者中心|私信管理/.test(
        text,
      )
    ) {
      return null;
    }
    return buildSummary({});
  }
}

type AgentSWorkflowEventLike = {
  message?: string | null;
  payload?: {
    summary?: string;
    response?: string | Record<string, unknown>;
    message?: string;
    browserAutomationResult?: {
      response?: Record<string, unknown>;
    };
  };
};

function parseWorkflowSummaryFromEvent(event: AgentSWorkflowEventLike) {
  const payload = event?.payload || {};
  const browserResponse =
    payload?.browserAutomationResult &&
    typeof payload.browserAutomationResult === "object" &&
    payload.browserAutomationResult.response &&
    typeof payload.browserAutomationResult.response === "object"
      ? payload.browserAutomationResult.response
      : null;
  if (browserResponse) {
    return parseWorkflowSummary(JSON.stringify({ browser: browserResponse }));
  }

  const rawText = [
    event?.message,
    typeof payload.summary === "string" ? payload.summary : "",
    typeof payload.response === "string" ? payload.response : "",
    typeof payload.message === "string" ? payload.message : "",
  ]
    .filter(Boolean)
    .join("\n");
  return parseWorkflowSummary(rawText);
}

function normalizeDouyinMessageDetail(detail?: string | null) {
  if (!detail) return detail || undefined;
  if (
    /私信页会话列表持续加载|私信列表持续加载|没有进入可读取状态|会话列表还在加载/.test(
      detail,
    )
  ) {
    return "抖音后台私信列表还在转圈，系统没有读到可回复会话，也没有发送。请刷新抖音私信页或稍后重试。";
  }
  if (/私信回复已点击发送|回复输入框已清空或关闭|自动发送已完成/.test(detail)) {
    return "已在抖音后台真实发送私信回复。";
  }
  if (
    /已点击发送按钮，但回复输入框仍保留内容|没有确认发出|send_failed/.test(
      detail,
    )
  ) {
    return "回复已写进抖音私信输入框，但抖音没有确认发出；系统已停下，避免重复发送。";
  }
  if (/没有打开可编辑回复框|editor_missing|输入框/.test(detail)) {
    return "已识别到私信，但当前抖音网页没有打开聊天输入框，系统没有发送。";
  }
  if (/你收到一条新类型消息|请打开抖音app查看/.test(detail)) {
    return "抖音网页只返回了 App 才能查看的新类型消息，系统没有发送。";
  }
  return detail;
}

export default function DouyinMessagesPage() {
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

  useEffect(() => {
    let alive = true;
    async function loadLatestTask() {
      if (activeTask?.id) return;
      try {
        const tasks = await localEngineApi.businessTasks("messages", 1);
        const latest =
          tasks.find(
            (task) =>
              task.type === "douyin-direct-message-reply" &&
              ["queued", "running", "waiting_for_send_confirmation"].includes(
                task.status,
              ),
          ) ||
          null;
        if (alive && latest) {
          setActiveTask(latest);
        }
      } catch (error) {
        console.error("Failed to load latest douyin message task:", error);
      }
    }
    void loadLatestTask();
    return () => {
      alive = false;
    };
  }, [activeTask?.id]);

  useEffect(() => {
    const sessionId = agentS.agentSSession?.id;
    if (!sessionId) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await agentS.getAgentSEvents(sessionId);
        agentS.setAgentSEvents(result.events);
      } catch (error) {
        console.error("Failed to poll events:", error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [agentS.agentSSession?.id]);

  const agentSOutcome = useMemo(() => {
    if (activeTask) {
      const latestOutcomeEvent = [...(activeTask.events || [])]
        .filter(
          (event) =>
            !event.message.includes("已保存") &&
            !event.message.includes("截图"),
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
      const normalizedDetail = normalizeDouyinMessageDetail(detail);
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
        roundStatusDetail: normalizedDetail,
        stageLabel: isRunning ? "处理中" : activeTask.statusLabel,
        lastOutcomeTitle: "真实互动任务结果",
        lastOutcomeDetail: [
          normalizedDetail,
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
            message:
              normalizeDouyinMessageDetail(step.message) || step.message || "",
          })) || [],
        liveEvents: [...(activeTask.events || [])]
          .filter(
            (event) =>
              !event.message.includes("已保存") &&
              !event.message.includes("截图"),
          )
          .sort((a, b) =>
            String(b.createdAt).localeCompare(String(a.createdAt)),
          )
          .slice(0, 5)
          .map((event) => ({
            message:
              normalizeDouyinMessageDetail(event.message) || event.message,
            level: event.level,
            createdAt: event.createdAt,
          })),
        canStart: !isRunning,
      };
    }
    const sortedEvents = [...agentS.agentSEvents].sort(
      (a, b) => Number(b.seq || 0) - Number(a.seq || 0),
    );
    const latest = sortedEvents[0];
    if (!latest) return null;

    const payload = latest.payload || {};
    const rawText = [
      latest.message,
      typeof payload.summary === "string" ? payload.summary : "",
      typeof payload.response === "string" ? payload.response : "",
      typeof payload.message === "string" ? payload.message : "",
    ]
      .filter(Boolean)
      .join("\n");
    const text = rawText.length > 900 ? `${rawText.slice(0, 900)}...` : rawText;
    const workflowCandidates = sortedEvents
      .map(parseWorkflowSummaryFromEvent)
      .filter(Boolean) as Array<
      NonNullable<ReturnType<typeof parseWorkflowSummaryFromEvent>>
    >;
    const workflow =
      workflowCandidates.find((candidate) => candidate.selectedTarget) ||
      workflowCandidates.find(
        (candidate) => typeof candidate.candidateCount === "number",
      ) ||
      workflowCandidates[0] ||
      parseWorkflowSummary(rawText);
    const isTerminal = ["completed", "failed", "cancelled"].includes(
      latest.status,
    );
    const loginRequired =
      /login_required|扫码登录|验证码登录|密码登录|登录\/注册/.test(text);
    const noTarget =
      /no_target_available|暂无会话|暂无私信|暂无消息|没有新的/.test(text);
    const failed =
      latest.status === "failed" ||
      /\\[作业阶段\\]\\s*failed|执行失败|没有成功/.test(text);

    if (workflow && isTerminal) {
      const detail = [
        workflow.storageStateImported
          ? "已复用平台账号登录态。"
          : "没有拿到平台账号登录态。",
        workflow.hasLoggedInAccount
          ? "已进入抖音创作者后台账号页。"
          : "还没有确认进入账号后台。",
        workflow.hasMessageList
          ? "已进入私信列表页。"
          : workflow.hasMessageEntry
            ? "页面里已识别到私信管理入口。"
            : "还没识别到私信管理入口。",
        workflow.selectedTarget
          ? `已选中真实会话：${workflow.selectedTarget}。`
          : workflow.noTarget
            ? "当前没有发现可处理私信。"
            : "已留下本轮后台截图证据。",
      ].join("");
      return {
        cardStatus: workflow.hasLoggedInAccount
          ? ("ready" as const)
          : ("attention" as const),
        roundStatusLabel: workflow.selectedTarget
          ? "已选中一条真实私信"
          : workflow.noTarget
            ? "当前没有可处理私信"
            : "已进入抖音私信后台",
        roundStatusDetail: detail,
        stageLabel: workflow.selectedTarget
          ? "已定位会话"
          : workflow.noTarget
            ? "暂无对象"
            : "后台已打开",
        lastOutcomeTitle: "真实后台检查结果",
        lastOutcomeDetail: `${detail}${typeof workflow.candidateCount === "number" ? ` 这一轮识别到 ${workflow.candidateCount} 个候选会话。` : ""}${workflow.finalUrl ? ` 当前地址：${workflow.finalUrl}` : ""}`,
        canStart: true,
      };
    }

    if (loginRequired) {
      return {
        cardStatus: "attention" as const,
        roundStatusLabel: "需要先登录抖音后台",
        roundStatusDetail:
          "系统已经打开抖音创作者中心，但当前停在登录页。请先扫码或验证码登录，再重新开始清私信。",
        stageLabel: "需要登录",
        lastOutcomeTitle: "真实任务已停下",
        lastOutcomeDetail: text,
        canStart: true,
      };
    }
    if (noTarget) {
      return {
        cardStatus: "empty" as const,
        roundStatusLabel: "当前没有可处理私信",
        roundStatusDetail: "系统已经进入后台检查，没有发现新的私信对象。",
        stageLabel: "暂无对象",
        lastOutcomeTitle: "这一轮已收口",
        lastOutcomeDetail: text,
        canStart: true,
      };
    }
    if (failed) {
      return {
        cardStatus: "attention" as const,
        roundStatusLabel: "这一轮没有完成",
        roundStatusDetail: "系统执行中遇到阻断，请按最近结果处理后重试。",
        stageLabel: "已阻断",
        lastOutcomeTitle: "执行被阻断",
        lastOutcomeDetail: normalizeDouyinMessageDetail(text),
        canStart: true,
      };
    }
    if (isTerminal) {
      return {
        cardStatus: "ready" as const,
        roundStatusLabel: "这一轮已结束",
        roundStatusDetail: text || "任务已经结束。",
        stageLabel: "已结束",
        lastOutcomeTitle: "最近一次执行结果",
        lastOutcomeDetail: normalizeDouyinMessageDetail(text),
        canStart: true,
      };
    }
    return {
      cardStatus: "running" as const,
      roundStatusLabel: "正在执行",
      roundStatusDetail: text || "本机助手正在按真实后台路径处理。",
      stageLabel: "处理中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      canStart: false,
    };
  }, [agentS.agentSEvents, activeTask]);

  const visibleOutcome = useMemo(() => {
    if (agentSOutcome) return agentSOutcome;
    if (!taskBusy && !startingFeedback) return null;
    return {
      cardStatus: "running" as const,
      roundStatusLabel: "正在启动真实私信回复",
      roundStatusDetail:
        startingFeedback || "正在创建任务并连接本机抖音私信后台。",
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
          label: "读取私信并生成回复",
          status: "pending" as const,
          message: "任务创建成功后会继续打开抖音后台读取真实私信。",
        },
        {
          label: "自动发送结果",
          status: "pending" as const,
          message: "自动发送模式会跳过人工确认，直接调用真实发送执行器。",
        },
      ],
      liveEvents: [
        {
          message: startingFeedback || "已点击开始，正在启动真实抖音私信任务。",
          level: "info" as const,
          createdAt: new Date().toISOString(),
        },
      ],
      canStart: false,
    };
  }, [agentSOutcome, douyinAccount, startingFeedback, taskBusy]);

  const handleStartMessageReply = useCallback(async () => {
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
      setStartingFeedback("正在创建任务，马上打开抖音后台读取真实私信。");
      const task = await localEngineApi.createBusinessTask("messages", {
        type: "douyin-direct-message-reply",
        accountId: String(douyinAccount.id),
        accountName: accountLabel,
        platformType: douyinAccount.type || 3,
        platformName: "抖音",
        targetName: "抖音私信管理",
        sourceText: "等待系统读取真实私信",
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === "auto-send",
      });
      setActiveTask(task);
      setStartingFeedback(null);
      douyin.startDouyinSession("direct-message-reply");
      addToast({ title: "私信回复任务已启动", color: "success" });
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
        <h1 className="text-2xl font-bold">抖音私信回复</h1>
        <p className="text-sm text-default-500">
          AI
          自动识别真实客户私信并按内容回复，默认直接发送；切到确认后发送才会停下等你确认
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
            title="抖音私信回复"
            summary={
              visibleOutcome?.roundStatusDetail
                ? visibleOutcome.roundStatusDetail
                : !cdpStatus.sessionReady
                  ? `抖音后台未就绪：${cdpStatus.blocker || "CDP 会话不可用"}`
                  : douyin.douyinBatchState?.active
                    ? `正在处理中，已处理 ${douyin.douyinBatchState.processedCount} 条`
                    : "AI 识别私信后自动回复"
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
                ? "自动打开抖音后台，AI 识别真实客户私信并生成回复"
                : cdpStatus.blocker ||
                  "CDP 会话不可用，不能读取或回复真实私信。"
            }
            canStart={
              Boolean(douyinAccount?.id) &&
              cdpStatus.sessionReady &&
              (visibleOutcome?.canStart ?? !douyin.douyinBatchState?.active)
            }
            canOpen={false}
            canTertiary={false}
            isBusy={agentS.agentSBusy || taskBusy}
            onStartAutoReply={handleStartMessageReply}
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
