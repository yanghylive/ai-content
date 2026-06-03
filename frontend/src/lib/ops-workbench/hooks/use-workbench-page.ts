"use client";

import React from "react";
import { addToast } from "@heroui/react";
import { useDouyinState, useAgentSState } from "./index";
import { useCdpSessionStatus, type CdpSessionPlatform } from "../../../app/(dashboard)/workbench/use-cdp-session-status";
import { hasInteractionReadbackProof } from "../../../app/(dashboard)/workbench/interaction-proof";
import {
  localEngineApi,
  type InteractionBusinessRouteKey,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { loadReadyLocalAccountsByType } from "../local-platform-accounts";
import type { AutoUploadAccount } from "@/lib/api/auto-upload";

export type WorkbenchTaskType =
  | "douyin-comment-reply"
  | "douyin-direct-message-reply"
  | "wechat-channel-comment-reply"
  | "wechat-channel-direct-message-reply";

export type WorkbenchBusinessRoute =
  | "comments"
  | "messages"
  | "channel-comments"
  | "channel-messages";

export type WorkbenchStartSessionType = "comment-reply" | "direct-message-reply";

export type WorkbenchConfig = {
  taskType: WorkbenchTaskType;
  businessRoute: WorkbenchBusinessRoute;
  accountType: number;
  platformName: string;
  platformLabel: string;
  targetName: string;
  cdpPlatform: CdpSessionPlatform;
  startSessionType: WorkbenchStartSessionType;
  pickDefaultAccount?: (accounts: AutoUploadAccount[]) => AutoUploadAccount | null;
  accountBlockedLabel?: string;
  toastTitle: string;
};

function defaultPickAccount(accounts: AutoUploadAccount[]) {
  return (
    accounts.find(
      (a) => (a.profileName || a.userName || "").trim() !== "磊",
    ) ||
    accounts[0] ||
    null
  );
}

export type TaskOutcomeStep = {
  label: string;
  status: "pending" | "running" | "blocked" | "completed" | "skipped";
  message: string;
};

export type TaskOutcomeEvent = {
  message: string;
  level: "success" | "warning" | "info" | "error";
  createdAt?: string;
};

export type TaskOutcome = {
  cardStatus: "ready" | "attention" | "empty" | "review" | "running";
  roundStatusLabel?: string;
  roundStatusDetail: string;
  stageLabel: string;
  lastOutcomeTitle?: string;
  lastOutcomeDetail?: string;
  liveSteps: TaskOutcomeStep[];
  liveEvents: TaskOutcomeEvent[];
  canStart: boolean;
};

function computeTaskOutcome(task: InteractionTask): TaskOutcome {
  const latestOutcomeEvent = [...(task.events || [])]
    .filter(
      (e) => !e.message.includes("已保存") && !e.message.includes("截图"),
    )
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const isRunning =
    task.status === "queued" || task.status === "running";
  const detail = isRunning
    ? latestOutcomeEvent?.message ||
      task.nextAction ||
      task.statusLabel
    : task.failureReason ||
      task.nextAction ||
      latestOutcomeEvent?.message ||
      task.statusLabel;

  const hasReadback = hasInteractionReadbackProof(task);
  let cardStatus: TaskOutcome["cardStatus"];
  if (task.status === "completed" && hasReadback) {
    cardStatus = "ready";
  } else if (task.status === "completed") {
    cardStatus = "attention";
  } else if (task.status === "no_target") {
    cardStatus = "empty";
  } else if (
    task.status === "failed" ||
    task.status === "skipped" ||
    task.status === "blocked"
  ) {
    cardStatus = "attention";
  } else if (task.status === "waiting_for_send_confirmation") {
    cardStatus = "review";
  } else {
    cardStatus = "running";
  }

  const lastOutcomeParts = [detail];
  if (task.status === "completed" && hasReadback && task.sourceText && task.replyText) {
    lastOutcomeParts.push(`对象：${task.sourceText}。回复：${task.replyText}`);
  }
  if (task.resultSummary?.counts) {
    const c = task.resultSummary.counts;
    lastOutcomeParts.push(
      `处理：成功 ${c.completed}，失败 ${c.failed}，无对象 ${c.noTarget}。`,
    );
  }

  return {
    cardStatus,
    roundStatusLabel: task.statusLabel,
    roundStatusDetail: detail,
    stageLabel: isRunning ? "处理中" : task.statusLabel,
    lastOutcomeTitle: "最近一次执行结果",
    lastOutcomeDetail: lastOutcomeParts.filter(Boolean).join(" "),
    liveSteps:
      task.steps?.map((s) => ({
        label: s.label,
        status: s.status as TaskOutcomeStep["status"],
        message: s.message,
      })) || [],
    liveEvents: [...(task.events || [])]
      .filter(
        (e) => !e.message.includes("已保存") && !e.message.includes("截图"),
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 5)
      .map((e) => ({
        message: e.message,
        level: e.level as TaskOutcomeEvent["level"],
        createdAt: e.createdAt,
      })),
    canStart: !isRunning,
  };
}

export type StartingSteps = {
  selectAccount: { label: string; readyMessage: string; blockedMessage: string };
  createTask: string;
  readContent: string;
  autoSend: string;
};

export type UseWorkbenchPageReturn = {
  accounts: AutoUploadAccount[];
  selectedAccount: AutoUploadAccount | null;
  setSelectedAccount: (account: AutoUploadAccount | null) => void;
  activeTask: InteractionTask | null;
  taskBusy: boolean;
  startingFeedback: string | null;
  cdpStatus: ReturnType<typeof useCdpSessionStatus>;
  agentS: ReturnType<typeof useAgentSState>;
  douyin: ReturnType<typeof useDouyinState>;
  taskOutcome: TaskOutcome | null;
  visibleOutcome: TaskOutcome | null;
  handleStart: () => Promise<void>;
};

export function useWorkbenchPage(
  config: WorkbenchConfig,
  startingSteps: StartingSteps,
): UseWorkbenchPageReturn {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const [accounts, setAccounts] = React.useState<AutoUploadAccount[]>([]);
  const [selectedAccount, setSelectedAccount] =
    React.useState<AutoUploadAccount | null>(null);
  const [activeTask, setActiveTask] = React.useState<InteractionTask | null>(null);
  const [taskBusy, setTaskBusy] = React.useState(false);
  const [startingFeedback, setStartingFeedback] = React.useState<string | null>(null);
  const cdpStatus = useCdpSessionStatus(config.cdpPlatform, selectedAccount);

  const pickAccount = config.pickDefaultAccount || defaultPickAccount;

  React.useEffect(() => {
    let alive = true;
    async function loadAccounts() {
      try {
        const list = await loadReadyLocalAccountsByType(config.accountType);
        if (!alive) return;
        setAccounts(list);
        setSelectedAccount(pickAccount(list));
      } catch {
        if (!alive) return;
        setAccounts([]);
        setSelectedAccount(null);
      }
    }
    agentS.refreshAgentSStatus();
    void loadAccounts();
    return () => {
      alive = false;
    };
  }, [agentS.refreshAgentSStatus, config.accountType, pickAccount]);

  React.useEffect(() => {
    if (!activeTask?.id) return;
    const id = setInterval(async () => {
      try {
        const task = await localEngineApi.task(activeTask.id);
        setActiveTask(task);
      } catch (error) {
        console.error("Failed to poll task:", error);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [activeTask?.id]);

  const taskOutcome = React.useMemo(() => {
    if (!activeTask) return null;
    return computeTaskOutcome(activeTask);
  }, [activeTask]);

  const handleStart = React.useCallback(async () => {
    const account = selectedAccount;
    if (!account?.id) {
      addToast({
        title: `没有可用${config.platformName}账号`,
        description:
          config.accountBlockedLabel ||
          `请先在平台账号里登录一个${config.platformName}账号。`,
        color: "danger",
      });
      return;
    }
    if (!cdpStatus.sessionReady) {
      addToast({
        title: `${config.platformName}后台未连接`,
        description: cdpStatus.blocker || "请先让本机浏览器 CDP 会话恢复 ready。",
        color: "danger",
      });
      return;
    }

    const accountLabel =
      account.profileName || account.userName || account.filePath || `账号 ${account.id}`;
    try {
      setTaskBusy(true);
      setStartingFeedback(
        `正在创建任务，马上打开${config.platformName}后台读取真实${config.targetName}。`,
      );
      const task = await localEngineApi.createBusinessTask(
        config.businessRoute as InteractionBusinessRouteKey,
        {
          type: config.taskType,
          accountId: String(account.id),
          accountName: accountLabel,
          platformType: account.type || config.accountType,
          platformName: config.platformName,
          targetName: config.targetName,
          sourceText: "等待系统读取真实内容",
          sendMode: douyin.douyinSendMode,
          commercialExecutionRequested: douyin.douyinSendMode === "auto-send",
        },
      );
      setActiveTask(task);
      setStartingFeedback(null);
      douyin.startDouyinSession(config.startSessionType);
      addToast({ title: config.toastTitle, color: "success" });
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
    config.accountBlockedLabel,
    config.businessRoute,
    config.platformName,
    config.startSessionType,
    config.targetName,
    config.taskType,
    config.toastTitle,
    douyin,
    selectedAccount,
  ]);

  const visibleOutcome = React.useMemo<TaskOutcome | null>(() => {
    if (taskOutcome) return taskOutcome;
    if (!taskBusy && !startingFeedback) return null;
    const accountLabel = selectedAccount
      ? selectedAccount.profileName ||
        selectedAccount.userName ||
        `账号 ${selectedAccount.id}`
      : null;
    return {
      cardStatus: "running",
      roundStatusLabel: startingSteps.createTask,
      roundStatusDetail: startingFeedback || "正在把任务交给本机引擎。",
      stageLabel: "启动中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [
        {
          label: startingSteps.selectAccount.label,
          status: accountLabel ? "completed" : "pending",
          message: accountLabel
            ? startingSteps.selectAccount.readyMessage.replace("{account}", accountLabel)
            : startingSteps.selectAccount.blockedMessage,
        },
        {
          label: "创建执行任务",
          status: "running",
          message: startingFeedback || "正在把任务交给本机引擎。",
        },
        {
          label: startingSteps.readContent,
          status: "pending",
          message: "任务创建成功后会继续打开平台后台。",
        },
        {
          label: startingSteps.autoSend,
          status: "pending",
          message: "自动发送模式会直接调用真实发送执行器。",
        },
      ],
      liveEvents: [
        {
          message: startingFeedback || "已点击开始，正在启动真实任务。",
          level: "info",
          createdAt: new Date().toISOString(),
        },
      ],
      canStart: false,
    };
  }, [startingFeedback, taskBusy, taskOutcome, selectedAccount, startingSteps]);

  return {
    accounts,
    selectedAccount,
    setSelectedAccount: (account) => {
      setSelectedAccount(account);
      setActiveTask(null);
    },
    activeTask,
    taskBusy,
    startingFeedback,
    cdpStatus,
    agentS,
    douyin,
    taskOutcome,
    visibleOutcome,
    handleStart,
  };
}
