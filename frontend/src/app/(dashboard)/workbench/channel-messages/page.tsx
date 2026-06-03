"use client";

import React from "react";
import { Button, addToast } from "@heroui/react";
import { useDouyinState, useAgentSState, useWorkbenchPage } from "@/lib/ops-workbench/hooks";
import { WorkbenchPageShell } from "@/lib/ops-workbench/components/workbench-page-shell";
import { autoUploadApi } from "@/lib/api/auto-upload";

const CONFIG = {
  taskType: "wechat-channel-direct-message-reply" as const,
  businessRoute: "channel-messages" as const,
  accountType: 2,
  platformName: "视频号",
  platformLabel: "视频号",
  targetName: "视频号私信管理",
  cdpPlatform: "wechat-channel" as const,
  startSessionType: "direct-message-reply" as const,
  toastTitle: "视频号私信回复任务已启动",
};

const STARTING_STEPS = {
  selectAccount: {
    label: "选择真实账号",
    readyMessage: "已选择 {account}。",
    blockedMessage: "等待可用视频号账号。",
  },
  createTask: "正在启动真实视频号私信回复",
  readContent: "读取私信并生成回复",
  autoSend: "自动发送结果",
};

function useOpenAccount(accountId: number | undefined) {
  const [opening, setOpening] = React.useState(false);
  const open = React.useCallback(async () => {
    if (!accountId) {
      window.location.href = "/distribution?tab=accounts";
      return;
    }
    try {
      setOpening(true);
      await autoUploadApi.openAccounts([accountId]);
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
      setOpening(false);
    }
  }, [accountId]);
  return { opening, open };
}

export default function ChannelMessagesPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const wb = useWorkbenchPage(CONFIG, STARTING_STEPS);
  const accountReady = wb.selectedAccount?.status === 1;
  const { opening, open } = useOpenAccount(wb.selectedAccount?.id);

  const openAccountButton = !accountReady ? (
    <Button
      size="sm"
      variant="flat"
      color="warning"
      isLoading={opening}
      onPress={open}
    >
      {wb.selectedAccount ? "打开视频号重新登录" : "去绑定视频号"}
    </Button>
  ) : null;

  return (
    <WorkbenchPageShell
      wb={wb}
      douyin={douyin}
      agentS={agentS}
      pageTitle="视频号私信回复"
      pageDescription="AI 自动识别真实客户私信并按内容回复，默认直接发送；切到确认后发送才会停下等你确认"
      platformName="视频号"
      platformLabel="视频号"
      browserStatusLabel="视频号后台"
      primaryActionLabel="开始清私信"
      secondaryActionLabel="进入视频号后台"
      accountReady={accountReady}
      accountChip={({ account, ready }) => {
        if (!account) return { label: "未绑定", color: "default" };
        if (account.status !== 1) return { label: "需重新登录", color: "warning" };
        return { label: ready ? "已登录" : "后台未连接", color: ready ? "success" : "warning" };
      }}
      readySummary="AI 识别私信后自动回复"
      processingSummaryTemplate="正在处理中，已处理 {count} 条"
      browserReadyMessage="自动打开视频号后台，AI 识别真实客户私信并生成回复"
      browserBlockedMessage="CDP 会话不可用，不能读取或回复真实私信。"
      topRowExtras={openAccountButton}
    />
  );
}
