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
  targetName: "抖音评论回复",
  cdpPlatform: "douyin" as const,
  startSessionType: "comment-reply" as const,
  toastTitle: "抖音评论回复已启动",
};

const STARTING_STEPS = {
  selectAccount: {
    label: "选择真实账号",
    readyMessage: "已选择 {account}。",
    blockedMessage: "等待选择抖音账号。",
  },
  createTask: "正在启动抖音评论回复",
  readContent: "读取评论并生成回复内容",
  autoSend: "自动发送评论结果",
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
      pageDescription="处理已进入客户互动的抖音评论并生成回复；短视频评论获客和自动上评论在「增长获客-短视频评论获客」。"
      platformName="抖音"
      platformLabel="抖音"
      browserStatusLabel="抖音后台"
      primaryActionLabel="开始处理评论"
      accountReady={Boolean(wb.selectedAccount)}
      accountChip={({ account, ready }) => ({
        label: account
          ? account.profileName || account.userName || `账号 ${account.id}`
          : "未登录",
        color: ready && account ? "success" : account ? "default" : "default",
      })}
      readySummary="AI 识别评论后生成回复"
      processingSummaryTemplate="正在处理中，已处理 {count} 条"
      browserReadyMessage="自动打开抖音后台，AI 识别真实客户评论后按发送设置执行"
      browserBlockedMessage="平台后台未连接，不能读取或回复真实评论。"
    />
  );
}
