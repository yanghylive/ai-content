"use client";

import React from "react";
import { addToast } from "@heroui/react";
import { useDouyinState, useAgentSState } from "./index";
import {
  useCdpSessionStatus,
  type CdpSessionPlatform,
} from "../../../app/(dashboard)/workbench/use-cdp-session-status";
import { hasInteractionReadbackProof } from "../../../app/(dashboard)/workbench/interaction-proof";
import {
  localEngineApi,
  type InteractionBusinessRouteKey,
  type InteractionTask,
} from "@/lib/api/local-engine";
import { loadReadyLocalAccountsByType } from "../local-platform-accounts";
import {
  autoUploadApi,
  type AutoUploadAccount,
  type AutoUploadInteractionEntryResult,
} from "@/lib/api/auto-upload";
import { commercialDisplayText } from "@/lib/commercial-display-text";

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

export type WorkbenchStartSessionType =
  | "comment-reply"
  | "direct-message-reply";

export type WorkbenchConfig = {
  taskType: WorkbenchTaskType;
  businessRoute: WorkbenchBusinessRoute;
  accountType: number;
  platformName: string;
  platformLabel: string;
  targetName: string;
  cdpPlatform: CdpSessionPlatform;
  startSessionType: WorkbenchStartSessionType;
  pickDefaultAccount?: (
    accounts: AutoUploadAccount[],
  ) => AutoUploadAccount | null;
  accountBlockedLabel?: string;
  toastTitle: string;
};

function resolveInteractionEntryType(config: WorkbenchConfig) {
  const platform =
    config.cdpPlatform === "wechat-channel" ? "wechat-channel" : "douyin";
  const entry =
    config.startSessionType === "direct-message-reply" ? "message" : "comment";
  return `${platform}:${entry}`;
}

function defaultPickAccount(accounts: AutoUploadAccount[]) {
  return (
    accounts.find((a) => (a.profileName || a.userName || "").trim() !== "磊") ||
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

function cleanTaskDisplayText(value: string | null | undefined) {
  return commercialDisplayText(String(value || ""))
    .replace(/engine:\s*/gi, "")
    .replace(/persistent-cdp-browser/gi, "本机平台后台")
    .replace(/local-browser-engine/gi, "本机浏览器")
    .replace(/browser-cdp/gi, "本机浏览器")
    .replace(/Chrome\/CDP\s*持久浏览器/g, "本机平台后台")
    .replace(/CDP\s*会话/g, "平台后台连接")
    .replace(/CDP/g, "平台后台")
    .replace(/sendMode=auto-send/g, "自动发送")
    .replace(/sendMode=approval-send/g, "确认后发送")
    .replace(/risk=(low|medium|high)/gi, "")
    .replace(/create-task/g, "创建任务")
    .replace(/target-read/g, "读取对象")
    .replace(/environment/g, "运行环境")
    .replace(/\/Users\/[^\s；,，。)）]+/g, "本机文件")
    .replace(/\s+/g, " ")
    .trim();
}

function computeTaskOutcome(task: InteractionTask): TaskOutcome {
  const latestOutcomeEvent = [...(task.events || [])]
    .filter((e) => !e.message.includes("已保存") && !e.message.includes("截图"))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const isRunning = task.status === "queued" || task.status === "running";
  const detail = cleanTaskDisplayText(
    isRunning
      ? latestOutcomeEvent?.message || task.nextAction || task.statusLabel
      : task.failureReason ||
          task.nextAction ||
          latestOutcomeEvent?.message ||
          task.statusLabel,
  );

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
  if (
    task.status === "completed" &&
    hasReadback &&
    task.sourceText &&
    task.replyText
  ) {
    lastOutcomeParts.push(`对象：${task.sourceText}。回复：${task.replyText}`);
  }
  if (task.resultSummary?.counts) {
    const c = task.resultSummary.counts;
    lastOutcomeParts.push(
      `处理：成功 ${c.completed}，失败 ${c.failed}，无对象 ${c.noTarget}。`,
    );
  }
  const evidenceItems = (task.events || [])
    .map((event) => event.evidence)
    .filter(Boolean);
  const latestEvidence = evidenceItems[evidenceItems.length - 1];
  if (latestEvidence) {
    lastOutcomeParts.push(`${latestEvidence.label || "页面证据"}已保存。`);
  }
  if (task.resultSummary?.evidenceCount) {
    lastOutcomeParts.push(`证据数：${task.resultSummary.evidenceCount}。`);
  }
  if (task.diagnostics?.evidenceCount) {
    lastOutcomeParts.push(`过程记录：${task.diagnostics.evidenceCount} 条。`);
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
        message: cleanTaskDisplayText(s.message),
      })) || [],
    liveEvents: [...(task.events || [])]
      .filter(
        (e) => !e.message.includes("已保存") && !e.message.includes("截图"),
      )
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 5)
      .map((e) => ({
        message: cleanTaskDisplayText(e.message),
        level: e.level as TaskOutcomeEvent["level"],
        createdAt: e.createdAt,
      })),
    canStart: !isRunning,
  };
}

export type StartingSteps = {
  selectAccount: {
    label: string;
    readyMessage: string;
    blockedMessage: string;
  };
  createTask: string;
  readContent: string;
  autoSend: string;
};

export type UseWorkbenchPageReturn = {
  accounts: AutoUploadAccount[];
  selectedAccount: AutoUploadAccount | null;
  setSelectedAccount: (account: AutoUploadAccount | null) => void;
  activeTask: InteractionTask | null;
  recentTasks: InteractionTask[];
  processedCount: number;
  taskBusy: boolean;
  openBackendBusy: boolean;
  startingFeedback: string | null;
  lastEntryResult: AutoUploadInteractionEntryResult | null;
  cdpStatus: ReturnType<typeof useCdpSessionStatus>;
  agentS: ReturnType<typeof useAgentSState>;
  douyin: ReturnType<typeof useDouyinState>;
  taskOutcome: TaskOutcome | null;
  visibleOutcome: TaskOutcome | null;
  handleStart: () => Promise<void>;
  handleOpenBackend: () => Promise<void>;
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
  const [activeTask, setActiveTask] = React.useState<InteractionTask | null>(
    null,
  );
  const [recentTasks, setRecentTasks] = React.useState<InteractionTask[]>([]);
  const [taskBusy, setTaskBusy] = React.useState(false);
  const [openBackendBusy, setOpenBackendBusy] = React.useState(false);
  const [startingFeedback, setStartingFeedback] = React.useState<string | null>(
    null,
  );
  const [lastEntryResult, setLastEntryResult] =
    React.useState<AutoUploadInteractionEntryResult | null>(null);
  const cdpStatus = useCdpSessionStatus(config.cdpPlatform, selectedAccount);

  const pickAccount = React.useCallback(
    (list: AutoUploadAccount[]) =>
      (config.pickDefaultAccount || defaultPickAccount)(list),
    [config.pickDefaultAccount],
  );
  const refreshAgentSStatus = agentS.refreshAgentSStatus;

  const refreshRecentTasks = React.useCallback(async () => {
    try {
      const tasks = await localEngineApi.businessTasks(
        config.businessRoute as InteractionBusinessRouteKey,
        20,
      );
      setRecentTasks(tasks);
      setActiveTask((current) => {
        if (current?.id) {
          return tasks.find((task) => task.id === current.id) || current;
        }
        return tasks[0] || null;
      });
    } catch (error) {
      console.error("Failed to load recent workbench tasks:", error);
    }
  }, [config.businessRoute]);

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
    refreshAgentSStatus();
    void loadAccounts();
    void refreshRecentTasks();
    return () => {
      alive = false;
    };
  }, [
    refreshAgentSStatus,
    config.accountType,
    pickAccount,
    refreshRecentTasks,
  ]);

  React.useEffect(() => {
    if (!activeTask?.id) return;
    const id = setInterval(async () => {
      try {
        const task = await localEngineApi.task(activeTask.id);
        setActiveTask(task);
        setRecentTasks((current) =>
          current.map((item) => (item.id === task.id ? task : item)),
        );
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

  const handleOpenBackend = React.useCallback(async () => {
    const account = selectedAccount;
    if (!account?.id) {
      window.location.href = "/distribution?tab=accounts";
      return;
    }
    try {
      setOpenBackendBusy(true);
      const result = await autoUploadApi.openInteractionEntry({
        accountId: account.id,
        entryType: resolveInteractionEntryType(config),
      });
      setLastEntryResult(result);
      await cdpStatus.refreshAndGetSession();
      window.setTimeout(() => {
        void cdpStatus.refreshAndGetSession();
      }, 2500);
      const session = await new Promise<
        Awaited<ReturnType<typeof cdpStatus.refreshAndGetSession>>
      >((resolve) => {
        window.setTimeout(() => {
          void cdpStatus.refreshAndGetSession().then(resolve);
        }, 1200);
      });
      const sessionReady = session?.status === "ready";
      addToast({
        title: sessionReady
          ? `已连接${result.entryName}`
          : `已打开${result.entryName}`,
        description: sessionReady
          ? "平台后台已确认，可以开始真实任务。"
          : cleanTaskDisplayText(session?.lastError) ||
            "请在打开的页面完成登录，完成后回到这里刷新或开始任务。",
        color: sessionReady ? "success" : "warning",
      });
    } catch (error) {
      addToast({
        title: `打开${config.platformName}后台失败`,
        description:
          error instanceof Error
            ? cleanTaskDisplayText(error.message)
            : "请到平台账号页重新登录。",
        color: "danger",
      });
    } finally {
      setOpenBackendBusy(false);
    }
  }, [cdpStatus, config, selectedAccount]);

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
        description:
          cleanTaskDisplayText(cdpStatus.blocker) ||
          "请先打开平台后台并确认登录状态。",
        color: "danger",
      });
      return;
    }

    const accountLabel =
      account.profileName ||
      account.userName ||
      account.filePath ||
      `账号 ${account.id}`;
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
      setRecentTasks((current) =>
        [task, ...current.filter((item) => item.id !== task.id)].slice(0, 20),
      );
      setStartingFeedback(null);
      douyin.startDouyinSession(config.startSessionType);
      addToast({ title: config.toastTitle, color: "success" });
    } catch (error) {
      setStartingFeedback(null);
      addToast({
        title: "启动失败",
        description:
          error instanceof Error ? cleanTaskDisplayText(error.message) : "请稍后重试",
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
    config.accountType,
    douyin,
    selectedAccount,
  ]);

  const processedCount = React.useMemo(() => {
    return recentTasks.filter((task) => task.status === "completed").length;
  }, [recentTasks]);

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
      roundStatusDetail: startingFeedback || "正在把任务交给本机服务。",
      stageLabel: "启动中",
      lastOutcomeTitle: undefined,
      lastOutcomeDetail: undefined,
      liveSteps: [
        {
          label: startingSteps.selectAccount.label,
          status: accountLabel ? "completed" : "pending",
          message: accountLabel
            ? startingSteps.selectAccount.readyMessage.replace(
                "{account}",
                accountLabel,
              )
            : startingSteps.selectAccount.blockedMessage,
        },
        {
          label: "创建执行任务",
          status: "running",
          message: startingFeedback || "正在启动本机执行服务。",
        },
        {
          label: startingSteps.readContent,
          status: "pending",
          message: "任务创建成功后会继续打开平台后台。",
        },
        {
          label: startingSteps.autoSend,
          status: "pending",
          message: "自动发送模式会直接发送，并确认发送结果。",
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
      setLastEntryResult(null);
    },
    activeTask,
    recentTasks,
    processedCount,
    taskBusy,
    openBackendBusy,
    startingFeedback,
    lastEntryResult,
    cdpStatus,
    agentS,
    douyin,
    taskOutcome,
    visibleOutcome,
    handleStart,
    handleOpenBackend,
  };
}
