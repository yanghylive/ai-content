import type {
  BrowserCapabilityStatus,
  DouyinBatchState,
  DouyinBrowserMode,
  WechatBatchState,
} from './runtime';

export type OpsWorkbenchWechatSendPolicy =
  | 'draft-only'
  | 'read-only-analyze'
  | 'approval-send'
  | 'auto-send';

type OpsWorkbenchHeroTone = 'neutral' | 'success' | 'warning' | 'accent';

export interface OpsWorkbenchHeroMetric {
  id: string;
  label: string;
  value: string;
  hint?: string;
  tone?: OpsWorkbenchHeroTone;
}

export interface OpsWorkbenchHeroAction {
  id: string;
  title: string;
  description: string;
  valueLabel?: string;
  badgeLabel?: string;
  emphasis?: 'primary' | 'secondary';
  disabled?: boolean;
  onClick?: () => void;
}

export interface OpsWorkbenchHeroReportStat {
  id: string;
  label: string;
  value: string;
}

export interface OpsWorkbenchHeroReport {
  title: string;
  summary: string;
  stats?: OpsWorkbenchHeroReportStat[];
}

export type OpsWorkbenchSummaryTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

export type OpsWorkbenchSummaryCard = {
  id: string;
  label: string;
  value: string;
  description?: string;
  eyebrow?: string;
  tone?: OpsWorkbenchSummaryTone;
};

export type OpsWorkbenchRunItem = {
  id: string;
  title: string;
  statusLabel: string;
  subtitle?: string;
  ownerLabel?: string;
  etaLabel?: string;
  stepLabel?: string;
  badges?: string[];
  tone?: OpsWorkbenchSummaryTone;
};

export type OpsWorkbenchReportStat = {
  label: string;
  value: string;
};

export type OpsWorkbenchReportPreview = {
  id: string;
  title: string;
  periodLabel: string;
  summary: string;
  badges?: string[];
  stats?: OpsWorkbenchReportStat[];
};

type WorkbenchTone = OpsWorkbenchSummaryCard['tone'];

type DouyinBrowserProgressSummaryLike = {
  status?: string;
  detail?: string;
  stageLabel?: string;
  stepLabel?: string;
  elapsedLabel?: string;
  traceCount?: number;
};

type DouyinOutcomePreviewLike = {
  target?: string;
  summary: string;
  nextStep: string;
};

type WechatSendStateLike = {
  sent?: boolean;
  targetContact?: string;
};

type AgentSessionLike = {
  session_id: string;
  status: string;
  task_type: string;
  last_event_seq: number;
  labels: string[];
  metadata?: {
    agent_s_business_scenario?: string | null;
    wechat_contact_name?: string | null;
  } | null;
};

type WechatWorkbenchStateLike = {
  value: string;
  description: string;
  tone?: WorkbenchTone;
};

type DouyinPermissionSummaryLike = {
  title: string;
  detail: string;
  actionLabel: string;
  toolName: string;
};

type MappedSidecarStatusLike = {
  label: string;
  detail: string;
};

type ApprovalRequestLike = {
  id: string;
  title: string;
  description?: string;
  requestedByLabel?: string;
  scopeLabel?: string;
  riskLevel?: string;
};

type BuildSummaryCardsArgs = {
  agentSessionStatus?: string;
  douyinSessionActive: boolean;
  douyinBrowserProgressDetail?: string;
  douyinBatchState: DouyinBatchState;
  douyinPauseReasonLabel: string;
  douyinProgressLabel: string;
  douyinStrategyLabel: string;
  localControllerPermissionMode: string;
  wechatBatchState: WechatBatchState;
  wechatBatchProgressHint: string;
  wechatBatchProgressLabel: string;
  wechatWorkbenchState: WechatWorkbenchStateLike;
};

type BuildRecentReportArgs = {
  agentArtifactsCount: number;
  agentEventsCount: number;
  agentSession: AgentSessionLike | null;
  douyinBatchState: DouyinBatchState;
  douyinBrowserMode: DouyinBrowserMode | null;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinCommentUser: string;
  douyinCreatorName: string;
  douyinOutcomePreview: DouyinOutcomePreviewLike | null;
  douyinPauseReasonLabel: string;
  douyinSessionStatus?: string;
  douyinStructuredStage?: string;
  douyinStrategyLabel: string;
  wechatBatchState: WechatBatchState;
  wechatExpectedContact: string;
  wechatSendState: WechatSendStateLike | null;
};

type BuildRecentReportsArgs = {
  activeDouyinBrowserSession: boolean;
  agentArtifactsCount: number;
  agentEventsCount: number;
  agentSession: AgentSessionLike | null;
  approvalRequestPresent: boolean;
  douyinBatchState: DouyinBatchState;
  douyinBrowserMode: DouyinBrowserMode | null;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinCommentUser: string;
  douyinCreatorName: string;
  douyinOutcomePreview: DouyinOutcomePreviewLike | null;
  douyinPauseReasonLabel: string;
  douyinSessionStatus?: string;
  douyinStructuredStage?: string;
  douyinStrategyLabel: string;
  nextWechatCandidateContact: string;
  wechatBatchProgressLabel: string;
  wechatBatchState: WechatBatchState;
  wechatCanSend: boolean;
  wechatEntityLabel: string;
  wechatExpectedContact: string;
  wechatLiveActiveConversation: string;
  wechatLiveCurrentConversation: string;
  wechatSendPolicy: OpsWorkbenchWechatSendPolicy;
  wechatSendPolicyLabel: string;
  wechatSendState: WechatSendStateLike | null;
};

type BuildRecentTasksArgs = {
  activeDouyinBrowserMode: DouyinBrowserMode | null;
  activeDouyinBrowserSessionId: string | null;
  activeDouyinBrowserSessionStatus?: string;
  agentSession: AgentSessionLike | null;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinCommentUser: string;
  douyinStructuredStage?: string;
  mappedSessionStatusDetail: string;
  wechatCanSend: boolean;
  wechatEntityLabel: string;
  wechatExpectedContact: string;
  wechatLiveActiveConversation: string;
  wechatLiveCurrentConversation: string;
  wechatSendPolicy: OpsWorkbenchWechatSendPolicy;
  wechatSendPolicyLabel: string;
};

type BuildTodayMetricsArgs = {
  agentArtifactsCount: number;
  agentReady: boolean;
  browserCapabilityStatus?: BrowserCapabilityStatus;
  browserCapabilityLabel: string;
  douyinBatchState: DouyinBatchState;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinPermissionTitle?: string;
  douyinStructuredStage?: string;
  hasApproval: boolean;
  mappedSidecarStatusLabel: string;
  wechatBatchProgressHint: string;
  wechatBatchState: WechatBatchState;
};

type BuildHeroActionsArgs = {
  activeDouyinBrowserSessionRunning: boolean;
  browserBusy: boolean;
  browserCapabilityStatus?: BrowserCapabilityStatus;
  douyinBatchState: DouyinBatchState;
  douyinStructuredStage?: string;
  onOpenDouyin: () => void;
  onOpenWechat: () => void;
  wechatCanSend: boolean;
  wechatExpectedContact: string;
  wechatLiveEntityType: 'contact' | 'search-result' | 'unknown';
  wechatSendPolicyLabel: string;
  wechatAgentBusy: boolean;
};

type BuildPendingApprovalsArgs = {
  activeDouyinBrowserSessionId: string | null;
  activeDouyinPermissionRequestId?: string;
  approvalRequest: ApprovalRequestLike | null;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinPermissionSummary: DouyinPermissionSummaryLike | null;
};

type BuildPendingQueueArgs = {
  activeDouyinBrowserMode: DouyinBrowserMode | null;
  activeDouyinBrowserSessionId: string | null;
  activeDouyinBrowserSessionStatus?: string;
  browserCapabilityStatus?: BrowserCapabilityStatus;
  browserSetupHint?: string;
  browserCapabilityLabel: string;
  douyinBatchState: DouyinBatchState;
  douyinBrowserProgressSummary: DouyinBrowserProgressSummaryLike | null;
  douyinStructuredStage?: string;
  mappedSidecarStatus: MappedSidecarStatusLike;
  sidecarReady: boolean;
  showWechatPanel: boolean;
  wechatBatchState: WechatBatchState;
  wechatCanSend: boolean;
  wechatEntityLabel: string;
  wechatExpectedContact: string;
  wechatLiveActiveConversation: string;
  wechatLiveCurrentConversation: string;
  wechatLiveEntityType: 'contact' | 'search-result' | 'unknown';
  wechatSendPolicyLabel: string;
};

type BuildFooterHintArgs = {
  activeDouyinBrowserMode: DouyinBrowserMode | null;
  activeDouyinBrowserSession: boolean;
  douyinBatchState: DouyinBatchState;
  douyinStructuredStage?: string;
  wechatBatchProgressLabel: string;
  wechatBatchState: WechatBatchState;
};

function getDouyinModeBadge(mode: DouyinBrowserMode | null) {
  if (mode === 'comment-reply') return '评论回复';
  if (mode === 'direct-message-reply') return '私信回复';
  return '只打开后台';
}

function getDouyinModeTitle(mode: DouyinBrowserMode | null, completed: boolean) {
  if (completed) {
    return mode === 'direct-message-reply' ? '抖音私信这一轮处理结果' : '抖音后台这一轮处理结果';
  }
  return mode === 'direct-message-reply' ? '最近一次抖音私信处理结果' : '最近一次抖音后台处理结果';
}

function mapAgentSessionStatus(status: string) {
  const labels: Record<string, string> = {
    running: '处理中',
    waiting_approval: '待确认',
    completed: '已完成',
    failed: '处理失败',
    cancelled: '已停止',
    paused: '已暂停',
    pending: '待开始',
  };
  return labels[status] || status;
}

function mapAgentTaskType(taskType: string) {
  const labels: Record<string, string> = {
    'douyin-comment-reply': '抖音评论回复',
    'douyin-direct-message-reply': '抖音私信回复',
    'wechat-channel-comment-reply': '视频号评论回复',
    'wechat-channel-direct-message-reply': '视频号私信回复',
    'wechat-reply-draft': '微信会话回复',
    'wechat-group-broadcast': '微信群发',
    'wechat-moments-publish': '朋友圈发布',
  };
  return labels[taskType] || '客户消息处理';
}

export function buildOpsWorkbenchTodayMetrics(
  args: BuildTodayMetricsArgs
): OpsWorkbenchHeroMetric[] {
  const processedCount =
    Math.max(0, args.douyinBatchState.processedCount || 0) +
    Math.max(0, args.wechatBatchState.processedCount || 0);
  const pendingConfirmCount =
    args.hasApproval || args.douyinBrowserProgressSummary?.status === 'review' ? 1 : 0;
  const estimatedSavedMinutes = processedCount > 0 ? Math.max(5, processedCount * 4) : 15;
  const activeWorkText =
    args.douyinBatchState.active || args.wechatBatchState.active
      ? '正在处理'
      : args.douyinBatchState.paused || args.wechatBatchState.paused
        ? '有暂停项'
        : processedCount > 0
          ? '继续清队列'
          : '3 条待处理';

  return [
    {
      id: 'today-queue',
      label: '今日待回',
      value: activeWorkText,
      hint:
        processedCount > 0
          ? `已处理 ${processedCount} 条，剩余队列会继续按成交可能性排序。`
          : '抖音私信、评论和微信会话集中排队，先处理最容易成交或超时的人。',
      tone:
        args.douyinBatchState.paused || args.wechatBatchState.paused
          ? 'warning'
          : processedCount > 0
            ? 'success'
            : 'accent',
    },
    {
      id: 'approvals',
      label: '需要确认',
      value: pendingConfirmCount > 0 ? `${pendingConfirmCount} 项` : '0 项',
      hint:
        args.douyinPermissionTitle ||
        (args.douyinBrowserProgressSummary?.status === 'review'
          ? '当前有一条发送动作需要你确认后再继续。'
          : '高风险发送会先停下来，不会悄悄替你发出去。'),
      tone: pendingConfirmCount > 0 ? 'warning' : 'success',
    },
    {
      id: 'processed',
      label: '已处理',
      value: `${processedCount} 条`,
      hint:
        processedCount > 0
          ? '处理过的对象会留下回复内容、发送策略和结果。'
          : '开始第一轮后，这里会显示今天实际清掉了多少客户消息。',
      tone:
        args.douyinBatchState.paused || args.wechatBatchState.paused
          ? 'warning'
          : processedCount > 0
            ? 'success'
            : 'neutral',
    },
    {
      id: 'saved-time',
      label: '预计省时',
      value: `约 ${estimatedSavedMinutes} 分钟`,
      hint:
        processedCount > 0
          ? '按每条客户消息约 3 到 5 分钟人工处理时间估算。'
          : '先从第一批待回复对象开始，完成后会回填真实节省时间。',
      tone:
        args.douyinBatchState.paused || args.wechatBatchState.paused
          ? 'warning'
          : processedCount > 0
            ? 'success'
            : 'accent',
    },
    {
      id: 'evidence',
      label: '证据留存',
      value: `${args.agentArtifactsCount} 份`,
      hint: '最近处理留下的截图、记录和结果凭证。',
      tone: args.agentArtifactsCount > 0 ? 'accent' : 'neutral',
    },
  ];
}

export function buildOpsWorkbenchHeroActions(
  args: BuildHeroActionsArgs
): OpsWorkbenchHeroAction[] {
  return [
    {
      id: 'douyin',
      title: args.douyinBatchState.paused
        ? '恢复抖音这一轮'
        : args.douyinBatchState.completed
          ? '开始新一轮抖音处理'
          : '开始处理抖音后台私信',
      description: args.douyinBatchState.paused
        ? args.douyinBatchState.nextTargetHint
          ? `这一轮已暂停，恢复后会优先回到"${args.douyinBatchState.nextTargetHint}"，然后继续按当前策略推进。`
          : '这一轮已暂停，恢复后会回到当前抖音后台列表继续处理。'
          : args.douyinBatchState.completed
            ? args.douyinBatchState.completionSummary ||
            `上一轮已经完成，累计处理 ${Math.max(args.douyinBatchState.processedCount, 0)} 条，跳过 ${args.douyinBatchState.skippedCount || 0} 条。`
          : '打开抖音后台，处理私信回复，并在需要发送时按当前策略确认。',
      valueLabel:
        args.douyinStructuredStage === 'login_required'
          ? '先登录抖音后台'
          : args.douyinBatchState.paused
            ? '恢复这一轮'
            : args.douyinBatchState.completed
              ? '进入下一轮处理'
              : args.activeDouyinBrowserSessionRunning
                ? '继续处理这一轮'
                : args.browserCapabilityStatus === 'ready'
                  ? '进入私信后台'
                  : '先连接抖音后台',
      badgeLabel: '抖音后台处理',
      emphasis: 'primary',
      disabled: args.browserBusy || args.browserCapabilityStatus !== 'ready',
      onClick: args.onOpenDouyin,
    },
    {
      id: 'wechat',
      title:
        args.wechatLiveEntityType === 'search-result'
          ? '分析微信当前对象'
          : args.wechatCanSend
            ? '给目标联系人发微信'
            : args.wechatExpectedContact
              ? '对齐微信目标联系人'
              : '清微信未回复会话',
      description:
        args.wechatLiveEntityType === 'search-result'
          ? '当前识别到的是搜一搜/公众号结果页。先做只读分析和正式回复准备，不会直接发送。'
          : args.wechatCanSend
            ? `目标联系人"${args.wechatExpectedContact}"已对齐，可以按${args.wechatSendPolicyLabel}推进发送。`
            : args.wechatExpectedContact
              ? `先把当前微信会话切到"${args.wechatExpectedContact}"，再决定走自动发送还是确认后发送。`
              : '处理今天还没回复的微信会话。',
      valueLabel:
        args.wechatLiveEntityType === 'search-result'
          ? '进入只读分析'
          : args.wechatCanSend
            ? `进入${args.wechatSendPolicyLabel}`
            : args.wechatExpectedContact
              ? '进入联系人对齐'
              : '进入微信队列',
      badgeLabel:
        args.wechatLiveEntityType === 'search-result'
          ? '只读分析'
          : args.wechatCanSend
            ? '微信会话'
            : '微信待处理',
      emphasis: 'secondary',
      disabled: args.wechatAgentBusy,
      onClick: args.onOpenWechat,
    },
  ];
}

export function buildOpsWorkbenchPendingApprovals(
  args: BuildPendingApprovalsArgs
): OpsWorkbenchRunItem[] {
  const items: OpsWorkbenchRunItem[] = [];
  if (args.activeDouyinPermissionRequestId && args.douyinPermissionSummary) {
    items.push({
      id: args.activeDouyinPermissionRequestId,
      title: args.douyinPermissionSummary.title,
      statusLabel: '待确认',
      subtitle: args.douyinPermissionSummary.detail,
      ownerLabel: '抖音后台处理',
      stepLabel: args.douyinPermissionSummary.actionLabel,
      badges: [
        '发送前确认',
        '抖音后台',
        args.douyinPermissionSummary.toolName.replace('mcp__Chrome__', ''),
      ],
      tone: 'warning',
    });
  } else if (args.douyinBrowserProgressSummary?.status === 'review') {
    items.push({
      id: args.activeDouyinBrowserSessionId || 'douyin-review',
      title: '抖音后台当前回复待确认',
      statusLabel: '待确认',
      subtitle: args.douyinBrowserProgressSummary.detail,
      ownerLabel: '抖音后台处理',
      stepLabel: args.douyinBrowserProgressSummary.stepLabel,
      badges: ['发送前确认', '抖音后台'],
      tone: 'warning',
    });
  }
  if (args.approvalRequest) {
    items.push({
      id: args.approvalRequest.id,
      title: args.approvalRequest.title,
      statusLabel: '待审批',
      subtitle: args.approvalRequest.description || '当前有一项人工确认请求待处理。',
      ownerLabel: args.approvalRequest.requestedByLabel,
      stepLabel: args.approvalRequest.scopeLabel,
      badges: ['人工介入', args.approvalRequest.riskLevel].filter(
        (value): value is string => Boolean(value)
      ),
      tone: 'warning',
    });
  }
  return items;
}

export function buildOpsWorkbenchPendingQueue(
  args: BuildPendingQueueArgs
): OpsWorkbenchRunItem[] {
  const items: OpsWorkbenchRunItem[] = [];

  if (args.activeDouyinBrowserSessionId && args.douyinBrowserProgressSummary) {
    items.push({
      id: `${args.activeDouyinBrowserSessionId}-queue`,
      title:
        args.douyinStructuredStage === 'login_required'
          ? '抖音后台停在登录门槛'
          : args.douyinBatchState.paused
            ? '抖音这一轮已暂停'
            : args.douyinBatchState.completed
              ? '这一轮抖音后台作业已收口'
              : args.activeDouyinBrowserSessionStatus === 'completed'
                ? '这一轮抖音后台作业已收口'
                : '抖音后台正在推进',
      statusLabel: args.douyinBatchState.paused
        ? '已暂停'
        : args.douyinBatchState.completed
          ? '本轮已完成'
          : args.douyinBrowserProgressSummary.stageLabel || '处理中',
      subtitle: args.douyinBatchState.paused
        ? args.douyinBatchState.pauseReason || '暂停后会从当前后台列表继续推进。'
        : args.douyinBatchState.completed
          ? args.douyinBatchState.completionSummary ||
            `这一轮已经完成，累计处理 ${Math.max(args.douyinBatchState.processedCount, 0)} 条，跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
          : args.douyinBrowserProgressSummary.detail,
      ownerLabel: '今日任务',
      stepLabel: args.douyinBatchState.paused
        ? args.douyinBatchState.nextTargetHint
          ? `恢复后优先回到"${args.douyinBatchState.nextTargetHint}"`
          : '恢复后继续当前后台列表'
        : args.douyinBatchState.completed
          ? '已完成本轮作业'
          : args.douyinBrowserProgressSummary.stepLabel,
      etaLabel: args.douyinBrowserProgressSummary.elapsedLabel,
      badges: [
        '抖音后台',
        args.activeDouyinBrowserMode === 'comment-reply'
          ? '评论回复'
          : args.activeDouyinBrowserMode === 'direct-message-reply'
            ? '私信回复'
            : '进入后台',
      ],
      tone:
        args.douyinStructuredStage === 'login_required'
          ? 'warning'
          : args.douyinBatchState.paused
            ? 'warning'
            : args.douyinBatchState.completed || args.activeDouyinBrowserSessionStatus === 'completed'
              ? 'success'
              : args.douyinBrowserProgressSummary.status === 'review'
                ? 'warning'
                : 'accent',
    });
  }

  if (args.browserCapabilityStatus !== 'ready') {
    items.push({
      id: 'browser-setup',
      title: '浏览器后台处理待连接',
      statusLabel: args.browserCapabilityLabel,
      subtitle: args.browserSetupHint || '需要先连接浏览器后台，才能直接进抖音后台自动处理私信。',
      ownerLabel: '浏览器后台处理',
      badges: ['后台前置'],
      tone: 'warning',
    });
  }

  if (!args.sidecarReady) {
    items.push({
      id: 'sidecar-setup',
      title: '本地接管可按需开启',
      statusLabel: args.mappedSidecarStatus.label,
      subtitle: args.mappedSidecarStatus.detail,
      ownerLabel: '人工接管',
      badges: ['备用处理'],
      tone: 'neutral',
    });
  }

  if (args.showWechatPanel || args.wechatExpectedContact || args.wechatLiveEntityType !== 'unknown') {
    items.push({
      id: 'wechat-queue',
      title:
        args.wechatLiveEntityType === 'search-result'
          ? '微信当前对象已切到只读分析'
          : args.wechatCanSend
            ? '微信目标联系人已对齐，可发送'
            : args.wechatExpectedContact
              ? '微信目标联系人待对齐'
              : '微信会话待准备',
      statusLabel:
        args.wechatLiveEntityType === 'search-result'
          ? '只读分析'
          : args.wechatCanSend
            ? '可发送'
            : args.wechatExpectedContact
              ? '待对齐'
              : '待准备',
      subtitle:
        args.wechatLiveEntityType === 'search-result'
          ? `当前对象"${args.wechatLiveCurrentConversation || args.wechatLiveActiveConversation || '未识别'}"属于${args.wechatEntityLabel}，只允许做上下文分析和回复准备。`
          : args.wechatCanSend
            ? `目标联系人"${args.wechatExpectedContact}"已对齐，可以按${args.wechatSendPolicyLabel}处理。`
            : args.wechatExpectedContact
              ? `目标联系人"${args.wechatExpectedContact}"还没完全对齐，当前会话是"${args.wechatLiveCurrentConversation || args.wechatLiveActiveConversation || '未识别'}"。`
              : '先选择目标联系人或直接进入只读分析。',
      ownerLabel: '微信会话',
      badges: [
        args.wechatEntityLabel,
        args.wechatSendPolicyLabel,
        args.wechatBatchState.paused
          ? '本轮已暂停'
          : args.wechatBatchState.active
            ? `本轮已处理 ${Math.max(1, args.wechatBatchState.processedCount)} 条`
            : '准备开始',
      ],
      tone:
        args.wechatLiveEntityType === 'search-result'
          ? 'warning'
          : args.wechatCanSend
            ? 'success'
            : 'neutral',
    });
  }

  return items;
}

export function buildOpsWorkbenchFooterHint(args: BuildFooterHintArgs): string {
  if (args.douyinBatchState.paused) {
    return args.douyinBatchState.pauseReason || '抖音这一轮已经暂停，恢复后会回到当前后台继续推进。';
  }
  if (args.douyinBatchState.completed) {
    return (
      args.douyinBatchState.completionSummary ||
      `抖音这一轮已经完成，累计处理 ${Math.max(args.douyinBatchState.processedCount, 0)} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
    );
  }
  if (args.activeDouyinBrowserSession) {
    if (args.douyinStructuredStage === 'login_required') {
      return '抖音创作者中心已经打开，但当前卡在登录页。先完成登录，再回作战台继续这一轮。';
    }
    return args.activeDouyinBrowserMode === 'direct-message-reply'
      ? '抖音私信任务已经能在作战台里恢复最近一轮作业；继续查看现场会直接带你回那条正在跑或刚跑完的真实私信会话。'
      : '抖音任务已经能在作战台里恢复最近一轮作业；继续查看现场会直接带你回那条正在跑或刚跑完的后台会话。';
  }
  if (args.wechatBatchState.paused) {
    return (
      args.wechatBatchState.pauseReason ||
      '微信这一轮已经暂停。恢复后会继续处理下一条候选。'
    );
  }
  if (args.wechatBatchState.active) {
    return `微信这一轮${args.wechatBatchProgressLabel}${args.wechatBatchState.nextCandidate ? `，下一条候选是"${args.wechatBatchState.nextCandidate}"` : ''}。`;
  }
  return '选择一个任务开始处理。';
}

export function buildOpsWorkbenchSummaryCards(
  args: BuildSummaryCardsArgs
): OpsWorkbenchSummaryCard[] {
  return [
    {
      id: 'run',
      label: '运行中任务',
      value:
        args.agentSessionStatus === 'running' || args.agentSessionStatus === 'waiting_approval'
          ? '1'
          : '0',
      description: '当前正在跑的任务和待确认动作。',
      tone:
        args.agentSessionStatus === 'running'
          ? 'accent'
          : args.agentSessionStatus === 'waiting_approval'
            ? 'warning'
            : 'neutral',
    },
    {
      id: 'douyin-batch-state',
      label: '抖音这一轮',
      value: args.douyinBatchState.paused
        ? '暂停中'
        : args.douyinBatchState.completed
          ? '本轮已完成'
          : args.douyinSessionActive
            ? args.douyinProgressLabel
            : '准备开始',
      description: args.douyinBatchState.completed
        ? args.douyinBatchState.completionSummary ||
          `抖音这一轮已经完成，累计处理 ${Math.max(args.douyinBatchState.processedCount, 0)} 条，跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
        : args.douyinBatchState.paused
          ? `${args.douyinPauseReasonLabel || '这一轮已暂停。'} 当前按${args.douyinStrategyLabel}策略运行，已跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
          : args.douyinBatchState.lastSkippedReason
            ? `当前按${args.douyinStrategyLabel}策略推进，已跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。最近一次跳过：${args.douyinBatchState.lastSkippedReason}`
            : args.douyinBatchState.lastFailedReason
              ? `当前按${args.douyinStrategyLabel}策略推进，已跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。最近一次失败：${args.douyinBatchState.lastFailedReason}`
              : args.douyinBrowserProgressDetail
                ? `${args.douyinBrowserProgressDetail} 当前按${args.douyinStrategyLabel}策略推进。`
                : '启动后会记录本轮进度、暂停原因和跳过原因。',
      tone: args.douyinBatchState.paused
        ? 'warning'
        : args.douyinBatchState.completed
          ? 'success'
          : args.douyinSessionActive
            ? 'accent'
            : 'neutral',
    },
    {
      id: 'wechat-object',
      label: '微信对象',
      value: args.wechatWorkbenchState.value,
      description: args.wechatWorkbenchState.description,
      tone: args.wechatWorkbenchState.tone,
    },
    {
      id: 'wechat-batch-state',
      label: '微信这一轮',
      value: args.wechatBatchState.paused
        ? '暂停中'
        : args.wechatBatchState.completed
          ? '本轮已完成'
          : args.wechatBatchState.active
            ? args.wechatBatchProgressLabel
            : '准备开始',
      description:
        args.wechatBatchProgressHint || '发送成功后会记录本轮进度和下一条候选。',
      tone: args.wechatBatchState.paused
        ? 'warning'
        : args.wechatBatchState.completed
          ? 'success'
          : args.wechatBatchState.active
            ? 'accent'
            : 'neutral',
    },
    {
      id: 'governance',
      label: '发送设置',
      value:
        args.localControllerPermissionMode === 'restricted'
          ? '确认后发送'
          : args.localControllerPermissionMode === 'custom'
            ? '按规则发送'
            : args.localControllerPermissionMode === 'full'
              ? '自动发送'
              : args.localControllerPermissionMode,
      description: '自动发送、批量处理和敏感动作都会按当前设置确认后再执行。',
      tone: args.localControllerPermissionMode === 'full' ? 'warning' : 'neutral',
    },
  ];
}

export function buildOpsWorkbenchRecentReport(
  args: BuildRecentReportArgs
): OpsWorkbenchHeroReport | null {
  if (args.wechatBatchState.completed && args.wechatSendState?.sent) {
    const processed = Math.max(args.wechatBatchState.processedCount, 1);
    const savedActions = processed * 4;
    const completedTarget =
      args.wechatBatchState.lastProcessedContact ||
      args.wechatExpectedContact ||
      args.wechatSendState.targetContact ||
      '未识别';
    return {
      title: '微信这一轮已经完成',
      summary:
        args.wechatBatchState.completionSummary ||
        `这一轮已经完成，累计处理 ${processed} 条，最后处理的是"${completedTarget}"。`,
      stats: [
        { id: 'wechat-processed', label: '本轮处理', value: `${processed} 条` },
        { id: 'wechat-last-contact', label: '最后对象', value: completedTarget },
        {
          id: 'wechat-paused',
          label: '中途暂停',
          value: args.wechatBatchState.pausedOnce ? '有' : '无',
        },
        { id: 'wechat-saved-actions', label: '预估省动作', value: `${savedActions} 步` },
        {
          id: 'wechat-skipped',
          label: '已跳过',
          value: `${args.wechatBatchState.skippedCount || 0} 条`,
        },
      ],
    };
  }

  if (args.douyinBatchState.completed || args.douyinBrowserProgressSummary) {
    const processed = Math.max(
      args.douyinBatchState.processedCount,
      args.douyinStructuredStage === 'sent' ? 1 : 0
    );
    const savedActions = Math.max(
      processed + (args.douyinBatchState.skippedCount || 0),
      1
    ) * 4;
    const completedTarget =
      args.douyinBatchState.lastProcessedTarget ||
      args.douyinOutcomePreview?.target ||
      `${args.douyinCreatorName || '抖音后台'}${args.douyinCommentUser ? ` / ${args.douyinCommentUser}` : ''}`;

    return {
      title: args.douyinBatchState.completed
        ? '抖音这一轮已经完成'
        : args.douyinStructuredStage === 'login_required'
          ? '抖音后台已打开，但还没登录'
          : args.douyinSessionStatus === 'completed'
            ? '最近一次抖音后台作业已收口'
            : args.douyinBrowserProgressSummary?.status === 'review'
              ? '抖音后台作业停在发送前确认'
              : '抖音后台作业正在推进',
      summary: args.douyinBatchState.completed
        ? args.douyinBatchState.completionSummary ||
          `这一轮已经完成，累计处理 ${processed} 条，跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条，最后处理的是"${completedTarget}"。`
        : args.douyinBatchState.paused
          ? `${args.douyinBatchState.pauseReason || '这一轮已暂停。'} 当前按${args.douyinStrategyLabel}策略运行，已跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
          : args.douyinOutcomePreview
            ? `${args.douyinOutcomePreview.summary} 下一步：${args.douyinOutcomePreview.nextStep}`
            : args.douyinStructuredStage === 'login_required'
              ? args.douyinBrowserMode === 'direct-message-reply'
                ? '这轮已经成功打开抖音创作者中心，并读到了登录页。下一步不是继续猜页面，而是先完成扫码或验证码登录，再回到私信后台继续。'
                : '这轮已经成功打开抖音创作者中心，并读到了登录页。下一步不是继续猜页面，而是先完成扫码或验证码登录。'
              : args.douyinSessionStatus === 'completed'
                ? '这轮后台处理已经收口，可以在本轮战报里查看处理数量、跳过原因和预计省下的操作。'
                : args.douyinBrowserProgressSummary?.detail || '这轮抖音后台作业还在推进中。',
      stats: [
        {
          id: 'douyin-processed',
          label: args.douyinBatchState.completed ? '本轮处理' : '当前阶段',
          value: args.douyinBatchState.completed
            ? `${processed} 条`
            : args.douyinBrowserProgressSummary?.stageLabel || '统计中',
        },
        {
          id: 'douyin-last-target',
          label:
            args.douyinBatchState.completed || args.douyinBatchState.paused ? '最后对象' : '已记录步骤',
          value: args.douyinBatchState.completed
            ? completedTarget
            : args.douyinBatchState.paused
              ? args.douyinBatchState.lastStopTarget || completedTarget
              : `${args.douyinBrowserProgressSummary?.traceCount || 0}`,
        },
        {
          id: 'douyin-paused',
          label: args.douyinBatchState.completed ? '中途暂停' : '已运行',
          value: args.douyinBatchState.completed
            ? args.douyinBatchState.pausedOnce
              ? '有'
              : '无'
            : args.douyinBrowserProgressSummary?.elapsedLabel || '刚开始',
        },
        {
          id: 'douyin-saved-actions',
          label: args.douyinBatchState.completed ? '预估省动作' : '已跳过',
          value: args.douyinBatchState.completed
            ? `${savedActions} 步`
            : `${args.douyinBatchState.skippedCount || 0} 条`,
        },
        {
          id: 'douyin-failed-count',
          label: args.douyinBatchState.completed ? '失败' : '已失败',
          value: `${args.douyinBatchState.failedCount || 0} 条`,
        },
        {
          id: 'douyin-strategy',
          label: '当前策略',
          value: args.douyinStrategyLabel,
        },
        ...(args.douyinBatchState.lastSkippedReason
          ? [
              {
                id: 'douyin-skip-reason',
                label: '最近跳过原因',
                value: args.douyinBatchState.lastSkippedReason,
              },
            ]
          : []),
        ...(args.douyinBatchState.lastFailedReason
          ? [
              {
                id: 'douyin-failed-reason',
                label: '最近失败原因',
                value: args.douyinBatchState.lastFailedReason,
              },
            ]
          : []),
        ...(args.douyinPauseReasonLabel
          ? [
              {
                id: 'douyin-pause-reason',
                label: args.douyinBatchState.completed ? '暂停原因' : '当前停因',
                value: args.douyinPauseReasonLabel,
              },
            ]
          : []),
        ...(args.douyinBatchState.paused && args.douyinBatchState.lastStopTarget
          ? [
              {
                id: 'douyin-stop-target',
                label: '停在对象',
                value: args.douyinBatchState.lastStopTarget,
              },
            ]
          : []),
      ],
    };
  }

  if (!args.agentSession) return null;
  return {
    title:
      args.agentSession.status === 'completed'
        ? '最近一次任务已跑完'
        : args.agentSession.status === 'waiting_approval'
          ? '最近一次任务停在人工确认'
          : '最近一次任务正在处理中',
    summary:
      args.agentSession.status === 'completed'
        ? '已经留下处理记录和结果凭证，可以继续查看这轮客户互动的处理结果。'
        : '当前任务还没完全收口，页面会继续追踪进度、确认动作和结果凭证。',
    stats: [
      { id: 'events', label: '处理记录', value: `${args.agentEventsCount} 条` },
      { id: 'artifacts', label: '结果凭证', value: `${args.agentArtifactsCount} 份` },
      { id: 'status', label: '当前状态', value: mapAgentSessionStatus(args.agentSession.status) },
    ],
  };
}

export function buildOpsWorkbenchRecentReports(
  args: BuildRecentReportsArgs
): OpsWorkbenchReportPreview[] {
  if (args.wechatSendState?.sent) {
    const processed = Math.max(args.wechatBatchState.processedCount, 1);
    const savedActions = processed * 4;
    return [
      {
        id: 'latest-wechat-send',
        title: args.wechatBatchState.completed ? '微信这一轮处理结果' : '最近一次微信发送结果',
        periodLabel: args.wechatBatchState.completed
          ? '本轮已完成'
          : args.wechatBatchState.active
            ? '批量续跑中'
            : '已完成单条发送收口',
        summary: args.wechatBatchState.completed
          ? args.wechatBatchState.completionSummary ||
            `目标联系人"${args.wechatExpectedContact || args.wechatSendState.targetContact || '未识别'}"这一条已经发出。${args.wechatBatchProgressLabel}，当前这一轮已经收口。`
          : args.nextWechatCandidateContact
            ? `目标联系人"${args.wechatExpectedContact || args.wechatSendState.targetContact || '未识别'}"这一条已经发出。${args.wechatBatchProgressLabel}，下一条候选"${args.nextWechatCandidateContact}"已准备好。`
            : `目标联系人"${args.wechatExpectedContact || args.wechatSendState.targetContact || '未识别'}"这一条已经发出。${args.wechatBatchProgressLabel}，下一步可以继续处理下一条。`,
        badges: ['微信发送', '已发送', args.wechatEntityLabel],
        stats: [
          { label: '发送状态', value: '已发出' },
          { label: '对象', value: args.wechatExpectedContact || args.wechatSendState.targetContact || '未识别' },
          { label: '策略', value: args.wechatSendPolicyLabel },
          { label: '本轮进度', value: args.wechatBatchProgressLabel },
          { label: '预估省动作', value: `${savedActions} 步` },
          { label: '已跳过', value: `${args.wechatBatchState.skippedCount || 0} 条` },
          ...(args.wechatBatchState.lastProcessedContact
            ? [{ label: '最后处理', value: args.wechatBatchState.lastProcessedContact }]
            : []),
          ...(args.wechatBatchState.pausedOnce
            ? [{ label: '中途暂停', value: '有' }]
            : []),
          ...(args.wechatBatchState.lastPauseReason
            ? [{ label: '暂停原因', value: args.wechatBatchState.lastPauseReason }]
            : []),
          ...(args.wechatBatchState.completed
            ? [{ label: '本轮收口', value: '已完成' }]
            : []),
          ...(args.nextWechatCandidateContact
            ? [{ label: '下一条候选', value: args.nextWechatCandidateContact }]
            : []),
        ],
      },
    ];
  }

  if (args.douyinBatchState.completed || (args.activeDouyinBrowserSession && args.douyinBrowserProgressSummary)) {
    const processed = Math.max(
      args.douyinBatchState.processedCount,
      args.douyinStructuredStage === 'sent' ? 1 : 0
    );
    const savedActions = Math.max(
      processed + (args.douyinBatchState.skippedCount || 0),
      1
    ) * 4;
    const targetLabel =
      args.douyinBatchState.lastProcessedTarget ||
      args.douyinOutcomePreview?.target ||
      `${args.douyinCreatorName || '抖音后台'}${args.douyinCommentUser ? ` / ${args.douyinCommentUser}` : ''}`;
    return [
      {
        id: 'latest-douyin-browser-run',
        title: getDouyinModeTitle(args.douyinBrowserMode, args.douyinBatchState.completed),
        periodLabel: args.douyinBatchState.completed
          ? '本轮已完成'
          : args.douyinStructuredStage === 'sent' ||
              args.douyinStructuredStage === 'skipped' ||
              args.douyinStructuredStage === 'failed'
            ? '单条已收口'
            : '本轮处理中',
        summary: args.douyinBatchState.completed
          ? args.douyinBatchState.completionSummary ||
            `这一轮已经完成，累计处理 ${processed} 条，跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条，最后处理的是"${targetLabel}"。`
          : args.douyinBatchState.paused
            ? `${args.douyinBatchState.pauseReason || '这一轮已暂停。'} 当前按${args.douyinStrategyLabel}策略运行，已跳过 ${args.douyinBatchState.skippedCount || 0} 条，失败 ${args.douyinBatchState.failedCount || 0} 条。`
            : args.douyinOutcomePreview
              ? `${args.douyinOutcomePreview.summary} 下一步：${args.douyinOutcomePreview.nextStep}`
              : args.douyinStructuredStage === 'login_required'
                ? args.douyinBrowserMode === 'direct-message-reply'
                  ? '已经成功开到抖音创作者中心，并确认当前账号还没登录。下一步先完成登录，再进入私信区继续自动处理。'
                  : '已经成功开到抖音创作者中心，并确认当前账号还没登录。下一步先完成登录，再进入评论区继续自动处理。'
                : args.douyinSessionStatus === 'completed'
                  ? '这轮抖音后台处理已经收口，可以看到处理数量、跳过原因和预计省下的操作。'
                  : '这轮后台任务正在处理。需要你确认、跳过或接管时，会停在这里提示。',
        badges: [
          getDouyinModeBadge(args.douyinBrowserMode),
          args.douyinBatchState.completed
            ? '本轮已完成'
            : args.douyinSessionStatus || 'running',
          args.douyinBatchState.completed
            ? `已处理 ${processed} 条`
            : args.douyinBrowserProgressSummary?.stageLabel || '处理中',
        ],
        stats: [
          {
            label: '处理结果',
            value: args.douyinBatchState.completed
              ? '本轮已完成'
              : args.douyinStructuredStage === 'sent'
                ? '已发送'
                : args.douyinStructuredStage === 'skipped'
                  ? '已跳过'
                  : args.douyinStructuredStage === 'failed'
                    ? '失败'
                    : args.douyinBrowserProgressSummary?.stageLabel || '处理中',
          },
          {
            label: '目标对象',
            value:
              args.douyinBatchState.completed || !args.douyinBatchState.lastStopTarget
                ? targetLabel
                : args.douyinBatchState.lastStopTarget,
          },
          {
            label: '预估省动作',
            value: args.douyinBatchState.completed
              ? `${savedActions} 步`
              : args.douyinStructuredStage === 'sent' || args.douyinStructuredStage === 'skipped'
                ? '4 步'
                : '统计中',
          },
          {
            label: args.douyinBatchState.completed ? '已跳过' : '步骤数',
            value: args.douyinBatchState.completed
              ? `${args.douyinBatchState.skippedCount || 0} 条`
              : `${args.douyinBrowserProgressSummary?.traceCount || 0}`,
          },
          { label: '失败', value: `${args.douyinBatchState.failedCount || 0} 条` },
          {
            label: args.douyinBatchState.completed ? '中途暂停' : '已运行',
            value: args.douyinBatchState.completed
              ? args.douyinBatchState.pausedOnce
                ? '有'
                : '无'
              : args.douyinBrowserProgressSummary?.elapsedLabel || '刚开始',
          },
          { label: '当前策略', value: args.douyinStrategyLabel },
          ...(args.douyinBatchState.lastSkippedReason
            ? [{ label: '最近跳过原因', value: args.douyinBatchState.lastSkippedReason }]
            : []),
          ...(args.douyinBatchState.lastFailedReason
            ? [{ label: '最近失败原因', value: args.douyinBatchState.lastFailedReason }]
            : []),
          ...(args.douyinPauseReasonLabel
            ? [{ label: args.douyinBatchState.completed ? '暂停原因' : '当前停因', value: args.douyinPauseReasonLabel }]
            : []),
          ...(args.douyinBatchState.paused && args.douyinBatchState.lastStopTarget
            ? [{ label: '停在对象', value: args.douyinBatchState.lastStopTarget }]
            : []),
        ],
      },
    ];
  }

  if (!args.agentSession) return [];
  const isWechatReplyDraft =
    args.agentSession.metadata?.agent_s_business_scenario === 'wechat-reply-draft';
  return [
    {
      id: 'latest-run',
      title: isWechatReplyDraft
        ? args.wechatSendPolicy === 'read-only-analyze'
          ? '最近一次微信只读分析预告'
          : args.wechatCanSend
            ? '最近一次微信发送预告'
            : '最近一次微信联系人对齐预告'
        : '最近一次作业结果预告',
      periodLabel: '最近任务',
      summary: isWechatReplyDraft
        ? args.wechatSendPolicy === 'read-only-analyze'
          ? `当前对象识别为${args.wechatEntityLabel}，这轮只做上下文分析和 AI 正式回复准备，不会填写，也不会发送。`
          : args.wechatCanSend
            ? `目标联系人"${args.wechatExpectedContact || '未提供'}"已对齐，可以按当前发送方式继续。`
            : `目标联系人还没对齐，当前对象是"${args.wechatLiveCurrentConversation || args.wechatLiveActiveConversation || '未识别'}"，暂不发送。`
        : '任务完成后会显示已处理数量、跳过数量和结果摘要。',
      badges: [
        mapAgentSessionStatus(args.agentSession.status),
        args.approvalRequestPresent ? '含审批节点' : '无审批节点',
        '结果已记录',
        isWechatReplyDraft ? args.wechatEntityLabel : null,
      ].filter((badge): badge is string => Boolean(badge)),
      stats: [
        { label: '处理记录', value: `${args.agentEventsCount} 条` },
        { label: '结果凭证', value: `${args.agentArtifactsCount} 份` },
        {
          label: '最近任务',
          value: isWechatReplyDraft ? args.wechatSendPolicyLabel : mapAgentTaskType(args.agentSession.task_type),
        },
      ],
    },
  ];
}

export function buildOpsWorkbenchRecentTasks(
  args: BuildRecentTasksArgs
): OpsWorkbenchRunItem[] {
  const items: OpsWorkbenchRunItem[] = [];

  if (args.activeDouyinBrowserSessionId && args.douyinBrowserProgressSummary) {
    const douyinModeLabel =
      args.activeDouyinBrowserMode === 'comment-reply'
        ? '评论回复'
        : args.activeDouyinBrowserMode === 'direct-message-reply'
          ? '私信回复'
          : '只打开后台';
    items.push({
      id: args.activeDouyinBrowserSessionId,
      title:
        args.activeDouyinBrowserMode === 'open-only'
          ? '抖音后台进入任务'
          : args.activeDouyinBrowserMode === 'comment-reply'
            ? '抖音后台评论回复任务'
            : '抖音后台私信回复任务',
      statusLabel: args.douyinBrowserProgressSummary.stageLabel || '处理中',
      subtitle: args.douyinBrowserProgressSummary.detail,
      ownerLabel: '抖音后台处理',
      stepLabel: args.douyinBrowserProgressSummary.stepLabel,
      etaLabel: args.douyinBrowserProgressSummary.elapsedLabel,
      badges: [
        douyinModeLabel,
        args.douyinCommentUser ? `目标：${args.douyinCommentUser}` : null,
        args.douyinStructuredStage === 'login_required' ? '待登录' : null,
        '抖音后台',
        args.activeDouyinBrowserSessionStatus,
      ].filter((badge): badge is string => Boolean(badge)),
      tone:
        args.douyinBrowserProgressSummary.status === 'review'
          ? 'warning'
          : args.activeDouyinBrowserSessionStatus === 'completed'
            ? 'success'
            : args.activeDouyinBrowserSessionStatus === 'error'
              ? 'danger'
              : 'accent',
    });
  }

  if (args.agentSession) {
    const isWechatTask =
      args.agentSession.metadata?.agent_s_business_scenario === 'wechat-reply-draft';
    const wechatTaskTitle =
      args.wechatSendPolicy === 'read-only-analyze'
        ? '微信对象只读分析任务'
        : args.wechatCanSend
          ? '微信目标联系人发送任务'
          : '微信目标联系人对齐任务';
    const wechatTaskSubtitle =
      args.wechatSendPolicy === 'read-only-analyze'
        ? `当前对象：${args.wechatLiveCurrentConversation || args.wechatLiveActiveConversation || '未识别'}（${args.wechatEntityLabel}，不会发送）`
        : args.wechatCanSend
          ? `联系人：${String(args.agentSession.metadata?.wechat_contact_name || args.wechatExpectedContact || '未提供')}；当前会话已对齐，可按${args.wechatSendPolicyLabel}推进。`
          : `联系人：${String(args.agentSession.metadata?.wechat_contact_name || args.wechatExpectedContact || '未提供')}；当前对象为"${args.wechatLiveCurrentConversation || args.wechatLiveActiveConversation || '未识别'}"，还没放行发送。`;
    items.push({
      id: args.agentSession.session_id,
      title: isWechatTask ? wechatTaskTitle : '桌面运营任务',
      statusLabel: mapAgentSessionStatus(args.agentSession.status),
      subtitle: isWechatTask ? wechatTaskSubtitle : args.mappedSessionStatusDetail,
      ownerLabel: '私域运营作战台',
      stepLabel: `已记录 ${args.agentSession.last_event_seq} 步`,
      badges: isWechatTask
        ? [...args.agentSession.labels, args.wechatEntityLabel, args.wechatSendPolicyLabel]
        : args.agentSession.labels,
      tone:
        args.agentSession.status === 'completed'
          ? 'success'
          : args.agentSession.status === 'waiting_approval'
            ? 'warning'
            : args.agentSession.status === 'failed'
              ? 'danger'
              : 'accent',
    });
  }

  return items;
}
