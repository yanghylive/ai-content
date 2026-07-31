"use client";

import React, { useEffect, useCallback } from 'react';
import { Card, CardBody, Button, Chip, addToast } from '@heroui/react';
import type { AutoUploadAccount } from '@/lib/api/auto-upload';
import { localEngineApi, type InteractionTask } from '@/lib/api/local-engine';
import { useDouyinState, useWechatState, useAgentSState } from '@/lib/ops-workbench/hooks';
import { OpsWorkbenchDouyinCard } from './douyin-card';
import { OpsWorkbenchWechatCard } from './wechat-card'; // eslint-disable-line @typescript-eslint/no-unused-vars -- 二阶段启用微信子卡片前先保持 props 已就绪
import type { OpsWorkbenchDouyinCardStatus } from './douyin-card';
import type { OpsWorkbenchWechatCardStatus, OpsWorkbenchWechatSendPolicy } from './wechat-card';
import { wechatLiveAutoReplySkill, wechatSessionAutoReplySkill } from '@/lib/ops-workbench/interaction-skills';
import {
  buildWechatModeStartingState,
  buildWechatPausedState,
  buildWechatSkippedState,
  getDouyinSendModeLabel as getDouyinSendModeLabelRuntime,
} from '@/lib/ops-workbench/runtime';
import { hasInteractionReadbackProof } from '@/lib/ops-workbench/interaction-proof';
import { loadReadyLocalAccountsByType } from '@/lib/ops-workbench/local-platform-accounts';
import type {
  DouyinBatchState,
  WechatBatchState,
  WechatExecutionMode,
} from '@/lib/ops-workbench/runtime';

const INITIAL_DOUYIN_BATCH_STATE: DouyinBatchState = {
  active: false,
  paused: false,
  completed: false,
  processedCount: 0,
};

const INITIAL_WECHAT_BATCH_STATE: WechatBatchState = {
  active: false,
  paused: false,
  completed: false,
  processedCount: 0,
};

export function OpsWorkbenchView() {
  const douyin = useDouyinState();
  const wechat = useWechatState();
  const agentS = useAgentSState();
  const [douyinAccount, setDouyinAccount] = React.useState<AutoUploadAccount | null>(null);
  const [activeDouyinTask, setActiveDouyinTask] = React.useState<InteractionTask | null>(null);
  const [douyinTaskBusy, setDouyinTaskBusy] = React.useState(false);

  useEffect(() => {
    agentS.refreshAgentSStatus();
    loadReadyLocalAccountsByType(3)
      .then((accounts) => {
        setDouyinAccount(accounts[0] || null);
      })
      .catch(() => setDouyinAccount(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 一次性初始化，agentS 在 mount 期间稳定
  }, []);

  useEffect(() => {
    const sessionId = agentS.agentSSession?.id;
    if (!sessionId) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await agentS.getAgentSEvents(sessionId);
        agentS.setAgentSEvents(result.events);
      } catch (error) {
        console.error('Failed to poll events:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling by session id,agentS 对象引用无需作为 deps
  }, [agentS.agentSSession?.id]);

  useEffect(() => {
    if (!activeDouyinTask?.id) return;

    const pollInterval = setInterval(async () => {
      try {
        const task = await localEngineApi.task(activeDouyinTask.id);
        setActiveDouyinTask(task);
      } catch (error) {
        console.error('Failed to poll Douyin task:', error);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeDouyinTask?.id]);

  const handleStartDouyinCommentReply = useCallback(async () => {
    const accountLabel =
      douyinAccount?.profileName || douyinAccount?.userName || douyinAccount?.filePath || '默认抖音账号';
    if (!douyinAccount?.id) {
      addToast({ title: '没有可用抖音账号', description: '请先在平台账号里登录一个抖音账号。', color: 'danger' });
      return;
    }

    try {
      setDouyinTaskBusy(true);
      const task = await localEngineApi.createBusinessTask('comments', {
        type: 'douyin-comment-reply',
        accountId: String(douyinAccount.id),
        accountName: accountLabel,
        platformType: douyinAccount.type || 3,
        platformName: '抖音',
        targetName: '抖音评论管理',
        sourceText: '等待系统读取真实评论',
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === 'auto-send',
      });
      setActiveDouyinTask(task);
      douyin.startDouyinSession('comment-reply');
      addToast({ title: '评论回复已开始', color: 'success' });
    } catch (error) {
      console.error('Failed to start Douyin session:', error);
      addToast({
        title: '启动失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        color: 'danger',
      });
    } finally {
      setDouyinTaskBusy(false);
    }
  }, [douyin, douyinAccount]);

  const handleStartDouyinDirectMessageReply = useCallback(async () => {
    const accountLabel =
      douyinAccount?.profileName || douyinAccount?.userName || douyinAccount?.filePath || '默认抖音账号';
    if (!douyinAccount?.id) {
      addToast({ title: '没有可用抖音账号', description: '请先在平台账号里登录一个抖音账号。', color: 'danger' });
      return;
    }

    try {
      setDouyinTaskBusy(true);
      const task = await localEngineApi.createBusinessTask('messages', {
        type: 'douyin-direct-message-reply',
        accountId: String(douyinAccount.id),
        accountName: accountLabel,
        platformType: douyinAccount.type || 3,
        platformName: '抖音',
        targetName: '抖音私信管理',
        sourceText: '等待系统读取真实私信',
        sendMode: douyin.douyinSendMode,
        commercialExecutionRequested: douyin.douyinSendMode === 'auto-send',
      });
      setActiveDouyinTask(task);
      douyin.startDouyinSession('direct-message-reply');
      addToast({ title: '私信回复已开始', color: 'success' });
    } catch (error) {
      console.error('Failed to start Douyin session:', error);
      addToast({
        title: '启动失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        color: 'danger',
      });
    } finally {
      setDouyinTaskBusy(false);
    }
  }, [douyin, douyinAccount]);

  const handleDouyinSendModeChange = useCallback((mode: 'auto-send' | 'approval-send') => {
    douyin.setDouyinSendMode(mode);
  }, [douyin]);

  const handleRunWechatTask = useCallback(async (mode: WechatExecutionMode) => {
    const contact = wechat.wechatReplyContact.trim();
    const draft = wechat.wechatReplyDraft.trim();
    if (!contact || !draft) {
      addToast({ title: '缺少联系人或回复内容', description: '微信真实发送必须先明确目标联系人和要发的内容。', color: 'danger' });
      return;
    }

    try {
      const skillRequest = wechatSessionAutoReplySkill.buildRunRequest({
        mode,
        contact,
        reply: draft,
        context: wechat.wechatReplyContext,
      });
      await agentS.runAgentSTask({
        skillId: skillRequest.skillId,
        sessionName: skillRequest.sessionName,
        taskType: skillRequest.taskType,
        instruction: skillRequest.instruction,
        metadata: skillRequest.metadata,
        labels: skillRequest.labels,
        riskLevel: skillRequest.riskLevel,
        requiresApproval: skillRequest.requiresApproval,
        localControllerPermissionMode: skillRequest.localControllerPermissionMode,
        commercialExecutionRequested: mode === 'auto-send',
      });
      const currentState = wechat.wechatBatchState || INITIAL_WECHAT_BATCH_STATE;
      wechat.setWechatBatchState(buildWechatModeStartingState(currentState, {
        mode,
        contact,
      }));
      wechat.setWechatExecutionMode(mode);
      addToast({ title: mode === 'auto-send' ? '微信自动发送已开始' : '微信确认后发送已开始', color: 'success' });
    } catch (error) {
      console.error('Failed to start WeChat task:', error);
      addToast({
        title: '启动失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        color: 'danger',
      });
    }
  }, [wechat, agentS]);

  const handleRunWechatLiveConversation = useCallback(async () => {
    const context = wechat.wechatReplyContext.trim();
    const skillRequest = wechatLiveAutoReplySkill.buildRunRequest({ context });

    try {
      await agentS.runAgentSTask({
        skillId: skillRequest.skillId,
        sessionName: skillRequest.sessionName,
        taskType: skillRequest.taskType,
        instruction: skillRequest.instruction,
        metadata: skillRequest.metadata,
        labels: skillRequest.labels,
        riskLevel: skillRequest.riskLevel,
        requiresApproval: skillRequest.requiresApproval,
        localControllerPermissionMode: skillRequest.localControllerPermissionMode,
        commercialExecutionRequested: skillRequest.commercialExecutionRequested,
      });
      const currentState = wechat.wechatBatchState || INITIAL_WECHAT_BATCH_STATE;
      wechat.setWechatBatchState(buildWechatModeStartingState(currentState, {
        mode: 'auto-send',
        contact: '当前微信会话',
      }));
      wechat.setWechatExecutionMode('auto-send');
      addToast({ title: '微信当前会话自动回复已开始', color: 'success' });
    } catch (error) {
      console.error('Failed to start live WeChat task:', error);
      addToast({
        title: '启动失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        color: 'danger',
      });
    }
  }, [wechat, agentS]);

  const handleWechatContactChange = useCallback((contact: string) => {
    wechat.setWechatReplyContact(contact);
  }, [wechat]);

  const handleWechatDraftChange = useCallback((draft: string) => {
    wechat.setWechatReplyDraft(draft);
  }, [wechat]);

  const handleWechatContextChange = useCallback((context: string) => {
    wechat.setWechatReplyContext(context);
  }, [wechat]);

  const handlePauseWechat = useCallback(() => {
    const currentState = wechat.wechatBatchState || INITIAL_WECHAT_BATCH_STATE;
    wechat.setWechatBatchState(buildWechatPausedState(currentState));
  }, [wechat]);

  const handleSkipWechat = useCallback(() => {
    const currentState = wechat.wechatBatchState || INITIAL_WECHAT_BATCH_STATE;
    wechat.setWechatBatchState(buildWechatSkippedState(currentState, {
      skippedTarget: wechat.wechatReplyContact,
    }));
  }, [wechat]);

  const handleStartAgentS = useCallback(async () => {
    await agentS.startAgentS();
  }, [agentS]);

  const handleStopAgentS = useCallback(async () => {
    await agentS.stopAgentS();
  }, [agentS]);

  const effectiveDouyinBatchState = douyin.douyinBatchState || INITIAL_DOUYIN_BATCH_STATE;
  const effectiveWechatBatchState = wechat.wechatBatchState || INITIAL_WECHAT_BATCH_STATE;
  const douyinTaskRunning = activeDouyinTask?.status === 'queued' || activeDouyinTask?.status === 'running';
  const latestDouyinTaskEvent = activeDouyinTask
    ? [...(activeDouyinTask.events || [])]
        .filter((event) => !event.message.includes('已保存') && !event.message.includes('截图'))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    : null;
  const douyinTaskDetail = activeDouyinTask
    ? activeDouyinTask.failureReason || activeDouyinTask.nextAction || latestDouyinTaskEvent?.message || activeDouyinTask.statusLabel
    : null;
  const activeDouyinTaskHasReadback = hasInteractionReadbackProof(activeDouyinTask);

  let douyinCardStatus: OpsWorkbenchDouyinCardStatus = 'offline';
  if (activeDouyinTask?.status === 'completed' && activeDouyinTaskHasReadback) {
    douyinCardStatus = 'ready';
  } else if (activeDouyinTask?.status === 'completed') {
    douyinCardStatus = 'attention';
  } else if (activeDouyinTask?.status === 'no_target') {
    douyinCardStatus = 'empty';
  } else if (activeDouyinTask?.status === 'failed' || activeDouyinTask?.status === 'blocked' || activeDouyinTask?.status === 'skipped') {
    douyinCardStatus = 'attention';
  } else if (activeDouyinTask?.status === 'waiting_for_send_confirmation') {
    douyinCardStatus = 'review';
  } else if (douyinTaskRunning || effectiveDouyinBatchState.active) {
    douyinCardStatus = 'running';
  } else if (effectiveDouyinBatchState.paused) {
    douyinCardStatus = 'attention';
  } else if (effectiveDouyinBatchState.completed) {
    douyinCardStatus = 'ready';
  } else if (douyinAccount) {
    douyinCardStatus = 'ready';
  }

  const douyinCardProps = {
    status: douyinCardStatus,
    sendMode: douyin.douyinSendMode,
    title: '抖音自动回复',
    summary: activeDouyinTask
      ? `正在按真实抖音后台链路处理：${activeDouyinTask.typeLabel}`
      : effectiveDouyinBatchState.active
      ? `正在处理抖音后台消息，已处理 ${effectiveDouyinBatchState.processedCount} 条`
      : effectiveDouyinBatchState.completed
        ? effectiveDouyinBatchState.completionSummary || '这一轮已完成'
        : '会打开真实抖音后台，读取评论或私信，按发送设置自动回复；只有切到确认后发送才停下。',
    roundStatusLabel: activeDouyinTask?.statusLabel || effectiveDouyinBatchState.lastOutcomeTitle || '准备开始',
    roundStatusDetail: douyinTaskDetail || effectiveDouyinBatchState.lastOutcomeDetail || '开始后显示当前对象、处理结果和停下原因。',
    progressLabel: `已处理 ${effectiveDouyinBatchState.processedCount} 条`,
    progressHint: effectiveDouyinBatchState.active
      ? `跳过 ${effectiveDouyinBatchState.skippedCount || 0} 条，失败 ${effectiveDouyinBatchState.failedCount || 0} 条`
      : '尚未开始。',
    lastOutcomeTitle: activeDouyinTask ? '最近一次真实任务结果' : effectiveDouyinBatchState.lastOutcomeTitle,
    lastOutcomeDetail: activeDouyinTask
      ? [
          douyinTaskDetail,
          activeDouyinTask.status === 'completed' && !activeDouyinTaskHasReadback
            ? '未找到包含本次回复文本的页面回读证据，不能标记为真实回读成功。'
            : '',
          activeDouyinTask.status === 'completed' && activeDouyinTaskHasReadback
            ? `对象：${activeDouyinTask.sourceText}。回复：${activeDouyinTask.replyText}`
            : '',
          activeDouyinTask.resultSummary?.counts
            ? `成功 ${activeDouyinTask.resultSummary.counts.completed}，失败 ${activeDouyinTask.resultSummary.counts.failed}，无对象 ${activeDouyinTask.resultSummary.counts.noTarget}。`
            : '',
        ].filter(Boolean).join(' ')
      : effectiveDouyinBatchState.lastOutcomeDetail,
    lastSkipReasonDetail: effectiveDouyinBatchState.lastSkippedReason,
    pauseReasonDetail: effectiveDouyinBatchState.pauseReason,
    recentOutcomeItems: effectiveDouyinBatchState.recentOutcomes?.map((outcome) => ({
      title: outcome.kind === 'sent' ? '已发送' : outcome.kind === 'skipped' ? '已跳过' : '失败',
      detail: `${outcome.target}: ${outcome.detail}`,
      tone: outcome.kind === 'sent' ? 'success' as const : outcome.kind === 'skipped' ? 'warning' as const : 'danger' as const,
    })),
    strategyLabel: getDouyinSendModeLabelRuntime(douyin.douyinSendMode),
    skippedLabel: `${effectiveDouyinBatchState.skippedCount || 0} 条`,
    failedLabel: `${effectiveDouyinBatchState.failedCount || 0} 条`,
    pauseResumeLabel: effectiveDouyinBatchState.paused ? '已暂停' : effectiveDouyinBatchState.active ? '运行中' : '待开始',
    browserStatusLabel: '抖音后台',
    browserStatusDetail: douyinAccount
      ? `账号：${douyinAccount.profileName || douyinAccount.userName || douyinAccount.filePath}`
      : '未检测到可用抖音账号，请先到平台账号登录。',
    permissionModeLabel: getDouyinSendModeLabelRuntime(douyin.douyinSendMode),
    stageLabel: activeDouyinTask?.statusLabel || (effectiveDouyinBatchState.active ? '处理中' : '待开始'),
    primaryActionLabel: '开始清私信',
    secondaryActionLabel: '进入抖音后台',
    tertiaryActionLabel: '开始回评论',
    refreshActionLabel: '刷新后台',
    canStart: Boolean(douyinAccount?.id) && !douyinTaskRunning,
    canOpen: Boolean(douyinAccount?.id) && !douyinTaskRunning,
    canTertiary: Boolean(douyinAccount?.id) && !douyinTaskRunning,
    isBusy: agentS.agentSBusy || douyinTaskBusy || douyinTaskRunning,
    onSendModeChange: handleDouyinSendModeChange,
    onStartAutoReply: handleStartDouyinDirectMessageReply,
    onOpenBackend: handleStartDouyinDirectMessageReply,
    onStartCommentReply: handleStartDouyinCommentReply,
  };

  const latestWechatAgentEvent = [...agentS.agentSEvents]
    .sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0))[0];
  const latestWechatAgentStatus = String(latestWechatAgentEvent?.status || agentS.agentSSession?.status || '');
  const wechatAgentRunning = latestWechatAgentStatus === 'running' || latestWechatAgentStatus === 'waiting_approval';
  const wechatAgentDetail = latestWechatAgentEvent?.message || null;

  let wechatCardStatus: OpsWorkbenchWechatCardStatus = 'idle';
  if (latestWechatAgentStatus === 'completed') {
    wechatCardStatus = 'ready';
  } else if (latestWechatAgentStatus === 'failed' || latestWechatAgentStatus === 'cancelled') {
    wechatCardStatus = 'paused';
  } else if (latestWechatAgentStatus === 'waiting_approval') {
    wechatCardStatus = 'review';
  } else if (wechatAgentRunning || effectiveWechatBatchState.active) {
    wechatCardStatus = 'sending';
  } else if (effectiveWechatBatchState.paused) {
    wechatCardStatus = 'paused';
  } else if (effectiveWechatBatchState.completed) {
    wechatCardStatus = 'ready';
  }

  const wechatSendPolicy: OpsWorkbenchWechatSendPolicy = wechat.wechatExecutionMode === 'auto-send'
    ? 'auto-send'
    : wechat.wechatExecutionMode === 'controlled-send'
      ? 'approval-send'
      : wechat.wechatExecutionMode === 'read-only-analyze'
        ? 'read-only-analyze'
        : 'auto-send';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 二阶段启用微信子卡片前先就绪
  const wechatCardProps = {
    contactName: wechat.wechatReplyContact,
    draftText: wechat.wechatReplyDraft,
    title: '微信会话回复',
    eyebrow: '微信会话',
    subjectLabel: '联系人',
    messageLabel: '正式回复',
    summaryWhenEmpty: '选择联系人，或直接处理当前微信聊天。',
    contextNote: wechat.wechatReplyContext,
    status: wechatCardStatus,
    sendPolicy: wechatSendPolicy,
    guardState: wechat.wechatReplyContact ? 'instruction-guarded' as const : 'not-configured' as const,
    batchHeadline: effectiveWechatBatchState.active ? '批量处理中' : effectiveWechatBatchState.completed ? '本轮已完成' : undefined,
    batchSummary: effectiveWechatBatchState.completionSummary,
    batchProgressLabel: `已处理 ${effectiveWechatBatchState.processedCount} 条`,
    batchProgressHint: effectiveWechatBatchState.nextCandidate ? `下一条候选：${effectiveWechatBatchState.nextCandidate}` : undefined,
    lastOutcomeTitle: wechatAgentDetail ? 'Agent-S 桌面执行结果' : effectiveWechatBatchState.lastOutcomeTitle,
    lastOutcomeDetail: wechatAgentDetail || effectiveWechatBatchState.lastOutcomeDetail,
    pauseReason: effectiveWechatBatchState.pauseReason,
    pauseLabel: effectiveWechatBatchState.paused ? '已暂停' : '暂停',
    expanded: true,
    disabled: agentS.agentSBusy || wechatAgentRunning,
    onContactNameChange: handleWechatContactChange,
    onDraftTextChange: handleWechatDraftChange,
    onContextNoteChange: handleWechatContextChange,
    onPrepareQueue: () => handleRunWechatTask('draft'),
    onReadOnlyAnalyze: () => handleRunWechatTask('read-only-analyze'),
    onUseLiveConversation: handleRunWechatLiveConversation,
    onControlledSend: () => handleRunWechatTask('controlled-send'),
    onAutoSend: () => handleRunWechatTask('auto-send'),
    onPause: handlePauseWechat,
    onSkipCurrent: handleSkipWechat,
    canPrepareQueue: false,
    canReadOnlyAnalyze: false,
    canUseLiveConversation: !agentS.agentSBusy && !wechatAgentRunning,
    canAlignContact: false,
    canControlledSend: Boolean(wechat.wechatReplyContact) && !wechatAgentRunning,
    canAutoSend: Boolean(wechat.wechatReplyContact && wechat.wechatReplyDraft) && !wechatAgentRunning,
    canSkipCurrent: effectiveWechatBatchState.active,
    sendBlockReason: wechat.wechatReplyContact && wechat.wechatReplyDraft
      ? undefined
      : '可以直接处理当前微信聊天；指定联系人发送时再填写联系人和正式回复',
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[17px] font-semibold leading-6">客户互动</h2>
              <p className="text-sm text-default-500">集中处理抖音和视频号客户消息；微信会话和群发放到二阶段</p>
            </div>
            <div className="flex gap-2">
              <Chip color={agentS.agentSStatus?.connected ? 'success' : 'default'}>
                本机助手：{agentS.agentSStatus?.connected ? '已连接' : '未连接'}
              </Chip>
              {agentS.agentSStatus?.connected ? (
                <Button
                  size="sm"
                  color="danger"
                  onPress={handleStopAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  color="primary"
                  onPress={handleStartAgentS}
                  isDisabled={agentS.agentSBusy}
                >
                  启动
                </Button>
              )}
            </div>
          </div>

          {agentS.agentSError && (
            <Chip color="danger" className="mb-4">
              {agentS.agentSError}
            </Chip>
          )}

          <div className="grid grid-cols-1 gap-4">
            <OpsWorkbenchDouyinCard {...douyinCardProps} />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
