"use client";

import React, { useEffect, useMemo } from "react";
import Link from "next/link";
import { addToast, Button, Chip, Spinner } from "@heroui/react";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import {
  useDouyinState,
  useAgentSState,
  useWorkbenchPage,
} from "@/lib/ops-workbench/hooks";
import { WorkbenchPageShell } from "@/lib/ops-workbench/components/workbench-page-shell";
import {
  getCrmWelcomeMessagePreparation,
  linkCrmCustomerConversation,
  type CrmWelcomeMessagePreparation,
} from "@/lib/api/crm";
import { localEngineApi, type InteractionTask } from "@/lib/api/local-engine";
import { hasInteractionReadbackProof } from "../interaction-proof";
import { toPublicError } from "@/lib/public-error";

const CONFIG = {
  taskType: "douyin-direct-message-reply" as const,
  businessRoute: "messages" as const,
  accountType: 3,
  platformName: "抖音",
  platformLabel: "抖音",
  targetName: "抖音私信管理",
  cdpPlatform: "douyin" as const,
  startSessionType: "direct-message-reply" as const,
  toastTitle: "私信回复任务已启动",
};

const STARTING_STEPS = {
  selectAccount: {
    label: "选择真实账号",
    readyMessage: "已选择 {account}。",
    blockedMessage: "等待选择抖音账号。",
  },
  createTask: "正在启动真实私信回复",
  readContent: "读取私信并生成回复",
  autoSend: "自动发送结果",
};

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
      Record<string, unknown> | undefined;
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

function preparedTaskOutcome(task: InteractionTask) {
  const hasReadback = hasInteractionReadbackProof(task);
  const terminal = [
    "completed",
    "failed",
    "blocked",
    "skipped",
    "no_target",
  ].includes(task.status);
  if (task.status === "completed" && hasReadback) {
    return {
      cardStatus: "ready" as const,
      roundStatusLabel: "平台已确认",
      roundStatusDetail: "平台已确认本次测试发送。",
      stageLabel: "已确认",
      lastOutcomeTitle: "测试发送结果",
      lastOutcomeDetail: task.resultSummary?.detail || task.statusLabel,
      liveSteps: [],
      liveEvents: [],
      canStart: true,
    };
  }
  if (task.status === "completed") {
    return {
      cardStatus: "attention" as const,
      roundStatusLabel: "等待平台确认",
      roundStatusDetail:
        "任务已经结束，但平台尚未确认送达。",
      stageLabel: "待确认",
      lastOutcomeTitle: "测试发送结果",
      lastOutcomeDetail: task.resultSummary?.detail || task.statusLabel,
      liveSteps: [],
      liveEvents: [],
      canStart: true,
    };
  }
  if (task.status === "waiting_for_send_confirmation") {
    return {
      cardStatus: "review" as const,
      roundStatusLabel: "等待发送确认",
      roundStatusDetail: task.nextAction || "请核对目标与消息内容。",
      stageLabel: "待确认",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [],
      liveEvents: [],
      canStart: false,
    };
  }
  if (terminal) {
    return {
      cardStatus:
        task.status === "no_target"
          ? ("empty" as const)
          : ("attention" as const),
      roundStatusLabel: task.statusLabel,
      roundStatusDetail:
        task.failureReason || task.nextAction || "本次测试发送没有完成。",
      stageLabel: "未完成",
      lastOutcomeTitle: "测试发送结果",
      lastOutcomeDetail: task.resultSummary?.detail || task.statusLabel,
      liveSteps: [],
      liveEvents: [],
      canStart: true,
    };
  }
  return {
    cardStatus: "running" as const,
    roundStatusLabel: task.statusLabel,
    roundStatusDetail: task.nextAction || "正在处理测试发送。",
    stageLabel: "处理中",
    lastOutcomeTitle: undefined,
    lastOutcomeDetail: undefined,
    liveSteps: [],
    liveEvents: [],
    canStart: false,
  };
}

export default function DouyinMessagesPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const wb = useWorkbenchPage(CONFIG, STARTING_STEPS);
  const [crmHandoff, setCrmHandoff] = React.useState<{
    customerId: string;
    preparationId: string;
  } | null>(null);
  const [crmPreparation, setCrmPreparation] =
    React.useState<CrmWelcomeMessagePreparation | null>(null);
  const [crmPreparationLoading, setCrmPreparationLoading] =
    React.useState(false);
  const [crmPreparationError, setCrmPreparationError] = React.useState<
    string | null
  >(null);
  const [preparedTask, setPreparedTask] =
    React.useState<InteractionTask | null>(null);
  const [preparedTaskBusy, setPreparedTaskBusy] = React.useState(false);
  const sessionId = agentS.agentSSession?.id;
  const getAgentSEvents = agentS.getAgentSEvents;
  const setAgentSEvents = agentS.setAgentSEvents;

  useEffect(() => {
    if (!sessionId) return;
    const id = setInterval(async () => {
      try {
        const result = await getAgentSEvents(sessionId);
        setAgentSEvents(result.events);
      } catch (error) {
        console.error("Failed to poll events:", error);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [sessionId, getAgentSEvents, setAgentSEvents]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get("crmCustomerId")?.trim();
    const preparationId = params.get("crmPreparationId")?.trim();
    if (customerId && preparationId) {
      setCrmHandoff({ customerId, preparationId });
    }
  }, []);

  useEffect(() => {
    if (!crmHandoff) return;
    let active = true;
    setCrmPreparationLoading(true);
    setCrmPreparationError(null);
    getCrmWelcomeMessagePreparation(
      crmHandoff.customerId,
      crmHandoff.preparationId,
    )
      .then((preparation) => {
        if (active) setCrmPreparation(preparation);
      })
      .catch((reason) => {
        if (active) {
          setCrmPreparationError(
            toPublicError(reason, "CRM 测试发送准备记录无法加载。"),
          );
        }
      })
      .finally(() => {
        if (active) setCrmPreparationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [crmHandoff]);

  useEffect(() => {
    if (!crmPreparation?.accountId || !wb.accounts.length) return;
    if (String(wb.selectedAccount?.id || "") === crmPreparation.accountId)
      return;
    const account = wb.accounts.find(
      (item) => String(item.id) === crmPreparation.accountId,
    );
    if (account) wb.setSelectedAccount(account);
  }, [crmPreparation?.accountId, wb]);

  useEffect(() => {
    if (!preparedTask?.id) return;
    if (
      ["completed", "failed", "blocked", "skipped", "no_target"].includes(
        preparedTask.status,
      )
    ) {
      return;
    }
    const id = window.setInterval(() => {
      void localEngineApi
        .task(preparedTask.id)
        .then(setPreparedTask)
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, [preparedTask?.id, preparedTask?.status]);

  const agentSOutcome = useMemo(() => {
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
      /\\[作业阶段\\]\s*failed|执行失败|没有成功/.test(text);

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
        lastOutcomeTitle: "后台检查结果",
        lastOutcomeDetail: `${detail}${typeof workflow.candidateCount === "number" ? ` 这一轮识别到 ${workflow.candidateCount} 个候选会话。` : ""}${workflow.finalUrl ? " 平台页面已打开。" : ""}`,
        liveSteps: [],
        liveEvents: [],
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
        lastOutcomeTitle: "任务已暂停",
        lastOutcomeDetail: text,
        liveSteps: [],
        liveEvents: [],
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
        liveSteps: [],
        liveEvents: [],
        canStart: true,
      };
    }
    if (failed) {
      return {
        cardStatus: "attention" as const,
        roundStatusLabel: "这一轮没有完成",
        roundStatusDetail: "系统执行中遇到需处理问题，请按最近结果处理后重试。",
        stageLabel: "需处理",
        lastOutcomeTitle: "执行需处理",
        lastOutcomeDetail: normalizeDouyinMessageDetail(text),
        liveSteps: [],
        liveEvents: [],
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
        liveSteps: [],
        liveEvents: [],
        canStart: true,
      };
    }
    return {
      cardStatus: "running" as const,
      roundStatusLabel: "正在执行",
      roundStatusDetail: text || "本机助手正在处理。",
      stageLabel: "处理中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [],
      liveEvents: [],
      canStart: false,
    };
  }, [agentS.agentSEvents]);

  const handlePreparedStart = React.useCallback(async () => {
    if (!crmPreparation) return;
    const account = wb.selectedAccount;
    if (!account?.id) {
      addToast({
        title: "没有可用抖音账号",
        description: "请先登录一个抖音账号。",
        color: "danger",
      });
      return;
    }
    if (!wb.cdpStatus.sessionReady) {
      addToast({
        title: "抖音后台未连接",
        description: wb.cdpStatus.blocker || "请先打开抖音后台并确认登录状态。",
        color: "danger",
      });
      return;
    }
    const accountName =
      account.profileName || account.userName || `账号 ${account.id}`;
    const sourceText =
      crmPreparation.sourceText ||
      `CRM 欢迎消息测试发送对象：${crmPreparation.customerName}`;
    setPreparedTaskBusy(true);
    try {
      const task = await localEngineApi.createBusinessTask("messages", {
        type: "douyin-direct-message-reply",
        accountId: String(account.id),
        accountName,
        platformType: account.type || CONFIG.accountType,
        platformName: CONFIG.platformName,
        targetName: crmPreparation.targetName,
        sourceText,
        replyText: crmPreparation.message,
        sourceUrl: crmPreparation.sourceUrl || undefined,
        profileUrl: crmPreparation.profileUrl || undefined,
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === "auto-send",
        metadata: {
          crmCustomerId: crmPreparation.customerId,
          crmPreparationId: crmPreparation.id,
          messageKind: "welcome-test-send",
          requiresExternalReadback: true,
        },
        batchTargets: [
          {
            targetName: crmPreparation.targetName,
            sourceText,
            replyText: crmPreparation.message,
            sourceUrl: crmPreparation.sourceUrl || undefined,
            profileUrl: crmPreparation.profileUrl || undefined,
          },
        ],
      });
      setPreparedTask(task);
      douyin.startDouyinSession("direct-message-reply");
      try {
        await linkCrmCustomerConversation(crmPreparation.customerId, {
          preparationId: crmPreparation.id,
          interactionTaskId: task.id,
        });
      } catch (reason) {
        addToast({
          title: "互动任务已启动，CRM 链接待补充",
          description: toPublicError(reason, "客户时间线暂未关联此任务。"),
          color: "warning",
        });
      }
      addToast({ title: "欢迎消息测试发送任务已启动", color: "success" });
    } catch (reason) {
      addToast({
        title: "测试发送未启动",
        description: toPublicError(reason, "请稍后重试。"),
        color: "danger",
      });
    } finally {
      setPreparedTaskBusy(false);
    }
  }, [crmPreparation, douyin, wb.cdpStatus, wb.selectedAccount]);

  const preparedOutcome = useMemo(
    () => (preparedTask ? preparedTaskOutcome(preparedTask) : null),
    [preparedTask],
  );
  const preparedWorkbench = crmPreparation
    ? {
        ...wb,
        activeTask: preparedTask || wb.activeTask,
        recentTasks: preparedTask
          ? [
              preparedTask,
              ...wb.recentTasks.filter((task) => task.id !== preparedTask.id),
            ]
          : wb.recentTasks,
        taskBusy: wb.taskBusy || preparedTaskBusy,
        visibleOutcome: preparedOutcome || wb.visibleOutcome,
        handleStart: handlePreparedStart,
      }
    : wb;

  return (
    <div className="flex flex-col gap-4">
      {crmHandoff ? (
        crmPreparationLoading ? (
          <div className="flex min-h-24 items-center justify-center border border-divider bg-content1">
            <Spinner size="sm" />
          </div>
        ) : crmPreparationError ? (
          <div className="flex flex-col gap-3 border border-danger-200 bg-danger-50 p-4 text-danger-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">{crmPreparationError}</p>
            <Button
              as={Link}
              href={`/crm/customer?id=${encodeURIComponent(crmHandoff.customerId)}`}
              size="sm"
              startContent={<ArrowLeft size={14} />}
              variant="flat"
            >
              返回客户档案
            </Button>
          </div>
        ) : crmPreparation ? (
          <section className="border border-warning-300 bg-warning-50 p-4 text-warning-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <MessageSquareText size={17} />
                  <h2 className="font-semibold">
                    {crmPreparation.customerName}
                  </h2>
                  <Chip color="warning" size="sm" variant="flat">
                    尚未发送
                  </Chip>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {crmPreparation.message}
                </p>
                <p className="mt-2 text-xs text-warning-800">
                  {crmPreparation.targetName} ·{" "}
                  {crmPreparation.accountName || "待选账号"}
                </p>
              </div>
              <Button
                as={Link}
                href={`/crm/customer?id=${encodeURIComponent(crmPreparation.customerId)}`}
                size="sm"
                startContent={<ArrowLeft size={14} />}
                variant="flat"
              >
                返回客户档案
              </Button>
            </div>
          </section>
        ) : null
      ) : null}

      <WorkbenchPageShell
        wb={preparedWorkbench}
        douyin={douyin}
        agentS={agentS}
        pageTitle="抖音私信回复"
        pageDescription="AI 自动识别真实客户私信并按内容回复，默认直接发送；切到确认后发送才会停下等你确认"
        platformName="抖音"
        platformLabel="抖音"
        browserStatusLabel="抖音后台"
        primaryActionLabel={crmPreparation ? "开始测试发送" : "开始回私信"}
        accountReady={Boolean(preparedWorkbench.selectedAccount)}
        accountChip={({ account, ready }) => ({
          label: account
            ? account.profileName || account.userName || `账号 ${account.id}`
            : "未登录",
          color: ready && account ? "success" : account ? "default" : "default",
        })}
        readySummary={
          crmPreparation ? "测试消息已准备，尚未发送" : "AI 识别私信后自动回复"
        }
        processingSummaryTemplate="正在处理中，已处理 {count} 条"
        browserReadyMessage="自动打开抖音后台，AI 识别真实客户私信并生成回复"
        browserBlockedMessage="平台后台未连接，不能读取或回复真实私信。"
        topRowExtras={
          crmPreparation ? (
            <Chip color="warning" size="sm" variant="flat">
              CRM 测试发送
            </Chip>
          ) : undefined
        }
        overrideOutcome={
          preparedOutcome ||
          (!preparedWorkbench.activeTask && agentSOutcome
            ? agentSOutcome
            : undefined)
        }
      />
    </div>
  );
}
