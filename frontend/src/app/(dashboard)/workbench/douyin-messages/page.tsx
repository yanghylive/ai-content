"use client";

import React, { useEffect, useMemo } from "react";
import { useDouyinState, useAgentSState, useWorkbenchPage } from "@/lib/ops-workbench/hooks";
import { WorkbenchPageShell } from "@/lib/ops-workbench/components/workbench-page-shell";

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
  const wb = useWorkbenchPage(CONFIG, STARTING_STEPS);
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
        lastOutcomeTitle: "真实后台检查结果",
        lastOutcomeDetail: `${detail}${typeof workflow.candidateCount === "number" ? ` 这一轮识别到 ${workflow.candidateCount} 个候选会话。` : ""}${workflow.finalUrl ? ` 当前地址：${workflow.finalUrl}` : ""}`,
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
        lastOutcomeTitle: "真实任务已停下",
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
        roundStatusDetail: "系统执行中遇到阻断，请按最近结果处理后重试。",
        stageLabel: "已阻断",
        lastOutcomeTitle: "执行被阻断",
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
      roundStatusDetail: text || "本机助手正在按真实后台路径处理。",
      stageLabel: "处理中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [],
      liveEvents: [],
      canStart: false,
    };
  }, [agentS.agentSEvents]);

  return (
    <WorkbenchPageShell
      wb={wb}
      douyin={douyin}
      agentS={agentS}
      pageTitle="抖音私信回复"
      pageDescription="AI 自动识别真实客户私信并按内容回复，默认直接发送；切到确认后发送才会停下等你确认"
      platformName="抖音"
      platformLabel="抖音"
      browserStatusLabel="抖音后台"
      primaryActionLabel="开始回私信"
      accountReady={Boolean(wb.selectedAccount)}
      accountChip={({ account, ready }) => ({
        label: account
          ? account.profileName || account.userName || `账号 ${account.id}`
          : "未登录",
        color: ready && account ? "success" : account ? "default" : "default",
      })}
      readySummary="AI 识别私信后自动回复"
      processingSummaryTemplate="正在处理中，已处理 {count} 条"
      browserReadyMessage="自动打开抖音后台，AI 识别真实客户私信并生成回复"
      browserBlockedMessage="CDP 会话不可用，不能读取或回复真实私信。"
      overrideOutcome={agentSOutcome ?? undefined}
    />
  );
}
