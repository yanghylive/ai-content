"use client";

import React from "react";
import { useDouyinState, useAgentSState, useWorkbenchPage } from "@/lib/ops-workbench/hooks";
import { WorkbenchPageShell } from "@/lib/ops-workbench/components/workbench-page-shell";

const CONFIG = {
  taskType: "wechat-channel-comment-reply" as const,
  businessRoute: "channel-comments" as const,
  accountType: 2,
  platformName: "视频号",
  platformLabel: "视频号",
  targetName: "视频号评论管理",
  cdpPlatform: "wechat-channel" as const,
  startSessionType: "comment-reply" as const,
  toastTitle: "视频号评论回复任务已启动",
};

const STARTING_STEPS = {
  selectAccount: {
    label: "选择真实账号",
    readyMessage: "已选择 {account}。",
    blockedMessage: "等待可用视频号账号。",
  },
  createTask: "正在启动真实视频号评论回复",
  readContent: "读取评论并生成回复",
  autoSend: "自动发送结果",
};

export default function WechatChannelCommentsPage() {
  const douyin = useDouyinState();
  const agentS = useAgentSState();
  const wb = useWorkbenchPage(CONFIG, STARTING_STEPS);
  const accountReady = wb.selectedAccount?.status === 1;

  return (
    <WorkbenchPageShell
      wb={wb}
      douyin={douyin}
      agentS={agentS}
      pageTitle="视频号评论回复"
      pageDescription="AI 自动识别真实客户评论并按内容回复，默认直接发送；切到确认后发送才会停下等你确认"
      platformName="视频号"
      platformLabel="视频号"
      browserStatusLabel="视频号后台"
      primaryActionLabel="开始回评论"
      secondaryActionLabel="进入视频号后台"
      accountReady={accountReady}
      accountChip={({ account, ready }) =>{
        if (!account) return { label: "未绑定", color: "default" };
        if (account.status !== 1) return { label: "需重新登录", color: "warning" };
        return { label: ready ? "已登录" : "后台未连接", color: ready ? "success" : "warning" };
      }}
      readySummary="AI 识别评论后自动回复"
      processingSummaryTemplate="正在处理中，已处理 {count} 条"
      browserReadyMessage="自动打开视频号后台，AI 识别真实客户评论并生成回复"
      browserBlockedMessage="平台后台未连接，不能读取或回复真实评论。"
    />
  );
}
