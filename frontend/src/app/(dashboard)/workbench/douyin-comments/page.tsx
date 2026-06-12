"use client";

import React from "react";
import { useDouyinState, useAgentSState, useWorkbenchPage } from "@/lib/ops-workbench/hooks";
import { WorkbenchPageShell } from "@/lib/ops-workbench/components/workbench-page-shell";

const CONFIG = {
  taskType: "douyin-comment-reply" as const,
  businessRoute: "comments" as const,
  accountType: 3,
  platformName: "抖音",
  platformLabel: "抖音",
  targetName: "抖音评论管理",
  cdpPlatform: "douyin" as const,
  startSessionType: "comment-reply" as const,
  toastTitle: "评论回复任务已启动",
};

const STARTING_STEPS = {
  selectAccount: {
    label: "选择真实账号",
    readyMessage: "已选择 {account}。",
    blockedMessage: "等待选择抖音账号。",
  },
  createTask: "正在启动真实评论回复",
  readContent: "读取评论并生成回复",
  autoSend: "自动发送结果",
};

export default function DouyinCommentsPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const wb = useWorkbenchPage(CONFIG, STARTING_STEPS);

  return (
    <WorkbenchPageShell
      wb={wb}
      douyin={douyin}
      agentS={agentS}
      pageTitle="抖音评论回复"
      pageDescription="AI 自动识别真实客户评论并按内容回复，默认直接发送；切到确认后发送才会停下等你确认"
      platformName="抖音"
      platformLabel="抖音"
      browserStatusLabel="抖音后台"
      primaryActionLabel="开始回评论"
      accountReady={Boolean(wb.selectedAccount)}
      accountChip={({ account, ready }) => ({
        label: account
          ? account.profileName || account.userName || `账号 ${account.id}`
          : "未登录",
        color: ready && account ? "success" : account ? "default" : "default",
      })}
      readySummary="AI 识别评论后自动回复"
      processingSummaryTemplate="正在处理中，已处理 {count} 条"
      browserReadyMessage="自动打开抖音后台，AI 识别真实客户评论后按发送设置执行"
      browserBlockedMessage="平台后台未连接，不能读取或回复真实评论。"
    />
  );
}
