import type {
  DouyinBatchState,
  DouyinStructuredStage,
  DouyinStructuredStatus,
  DouyinBrowserMode,
  DouyinSendMode,
  WechatEntityType,
  WechatExecutionMode,
  OpsWorkbenchWechatConversationSnapshotResult,
} from './runtime';
import { evaluateWechatSendability } from './runtime';

export type AgentSExecuteRoutedTaskInput = {
  capability: string;
  instruction: string;
  session_name?: string | null;
  task_type?: string | null;
  metadata?: Record<string, unknown>;
  labels?: string[];
  risk_level?: 'low' | 'medium' | 'high';
  requires_approval?: boolean;
  local_controller_permission_mode?: 'restricted' | 'custom' | 'full';
  allowed_desktop_action_targets?: string[];
  allowed_desktop_text_inputs?: string[];
  step_count?: number;
  mock_step_delay_ms?: number;
  simulate_failure_step?: number;
};

export type OpsWorkbenchWechatDraftReadyResult = OpsWorkbenchWechatConversationSnapshotResult & {
  ok: boolean;
  stage:
    | 'contact_not_ready'
    | 'draft_ready_for_send_confirmation'
    | 'draft_readback_incomplete'
    | 'error';
  targetContact: string;
  draftText: string;
  draftInserted: boolean;
  inputReady: boolean;
  readbackText?: string;
  screenshotSize?: string;
  inputPoint?: {
    x: number;
    y: number;
    screenshotX: number;
    screenshotY: number;
  };
};

export type BuildDouyinReplyPromptParams = {
  creatorName: string;
  commentUser: string;
  commentText: string;
  replyDraft: string;
  context: string;
};

export type BuildDouyinSessionPlanParams = {
  mode: DouyinBrowserMode;
  sendMode: DouyinSendMode;
  creatorName: string;
  commentUser: string;
  commentText: string;
  replyDraft: string;
  context: string;
  allowedTools: string[];
};

export type BuildDouyinContinuePromptParams = Omit<
  BuildDouyinSessionPlanParams,
  'allowedTools'
> & {
  liveStageHint?: string;
  liveTargetLabel?: string;
  liveEditorPlaceholder?: string;
};

export type BuildDouyinDirectiveContinuePromptParams = BuildDouyinContinuePromptParams & {
  directive: string;
};

export type DouyinBrowserSessionPlan = {
  title: string;
  prompt: string;
  allowedTools: string[];
  targetEntry: 'home' | 'comment-management' | 'direct-message';
  memoryEnabled: false;
};

export type BuildWechatReplyInstructionParams = {
  contact: string;
  draft: string;
  context: string;
};

export type WechatTaskPlan = {
  mode: WechatExecutionMode;
  taskType: string;
  executionPolicy: 'plan_only' | 'approval_execute' | 'auto_execute';
  allowDesktopActionExecution: boolean;
  requiresApproval: boolean;
};

export type WechatRecommendedActionKind =
  | 'advance-next'
  | 'read-only-analyze'
  | 'use-live-conversation'
  | 'align-contact'
  | 'auto-send'
  | 'controlled-send'
  | 'draft';

export type ResolveWechatRecommendedActionParams = {
  expectedContact: string;
  nextCandidateContact: string;
  preferredLiveTarget: string;
  sendPolicy: 'draft-only' | 'approval-send' | 'auto-send' | 'read-only-analyze';
  liveEntityType: WechatEntityType;
  canSend: boolean;
  processedCount: number;
  lastSent: boolean;
  sentTargetContact?: string;
};

export type WechatRecommendedAction = {
  kind: WechatRecommendedActionKind;
  label: string;
  hint: string;
  mode?: WechatExecutionMode;
  candidateContact?: string;
};

export type ResolveWechatAdvanceDecisionParams = {
  candidateContact: string;
  sendPolicy: 'draft-only' | 'approval-send' | 'auto-send' | 'read-only-analyze';
  aligned: boolean;
  note?: string;
  entityType: WechatEntityType;
  canSend: boolean;
  sendReason?: string;
};

export type WechatAdvanceDecision =
  | {
      kind: 'blocked';
      detail: string;
    }
  | {
      kind: 'run';
      mode: WechatExecutionMode;
      contact: string;
      shouldUseGuardOverride: boolean;
    };

export type ResolveWechatResumeDecisionParams = {
  paused: boolean;
  nextCandidateContact: string;
  sendPolicy: 'draft-only' | 'approval-send' | 'auto-send' | 'read-only-analyze';
};

export type WechatResumeDecision =
  | {
      kind: 'pause';
    }
  | {
      kind: 'advance-next';
      candidateContact: string;
    }
  | {
      kind: 'resume-mode';
      mode: WechatExecutionMode;
    };

export type ResolveWechatTaskEntryDecisionParams = {
  mode: WechatExecutionMode;
  contact: string;
  draft: string;
  canSend: boolean;
  sendReason?: string;
};

export type ResolveWechatLiveSnapshotDecisionParams = {
  expectedContact: string;
  snapshot: Partial<OpsWorkbenchWechatConversationSnapshotResult> | null | undefined;
};

export type WechatLiveSnapshotDecision = {
  currentConversation: string;
  activeConversation: string;
  matchedTarget: boolean;
  entityType: WechatEntityType;
  canSend: boolean;
  sendReason: string;
  preferredLiveTarget: string;
};

export type WechatTaskEntryDecision =
  | {
      kind: 'blocked';
      reason: 'missing-input' | 'guard-blocked';
      detail: string;
    }
  | {
      kind: 'proceed';
    };

export type ResolveWechatPreparedDraftDecisionParams = {
  mode: WechatExecutionMode;
  draftReady: Pick<
    OpsWorkbenchWechatDraftReadyResult,
    'draftInserted' | 'inputReady' | 'stage' | 'note' | 'readbackText'
  >;
  previousDraftReadyState?: Pick<
    OpsWorkbenchWechatDraftReadyResult,
    'draftInserted' | 'inputReady' | 'stage'
  > | null;
  hasSendCapability: boolean;
  fallbackDraftText: string;
};

export type WechatPreparedDraftDecision =
  | {
      kind: 'draft-not-ready';
      detail: string;
    }
  | {
      kind: 'hold-for-confirmation';
    }
  | {
      kind: 'send-now';
      sendText: string;
    }
  | {
      kind: 'continue-agent-run';
    };

export type ResolveWechatPreparedDraftExecutionDecisionParams = {
  mode: WechatExecutionMode;
  preparedDraftDecisionKind: WechatPreparedDraftDecision['kind'];
};

export type WechatPreparedDraftExecutionDecision =
  | {
      kind: 'throw-draft-not-ready';
    }
  | {
      kind: 'hold-for-confirmation';
    }
  | {
      kind: 'send-locally';
      sendMode: 'controlled-send' | 'auto-send';
    }
  | {
      kind: 'continue-agent';
    };

export type ResolveWechatLocalExecutionRouteParams = {
  mode: WechatExecutionMode;
  hasPrepareDraftCapability: boolean;
};

export type WechatLocalExecutionRouteDecision =
  | {
      kind: 'prepare-live-draft';
    }
  | {
      kind: 'queue-draft-and-run-agent';
    }
  | {
      kind: 'run-agent-directly';
    };

export type ResolveWechatAgentFallbackDecisionParams = {
  mode: WechatExecutionMode;
  preparedDraftDecisionKind?: WechatPreparedDraftDecision['kind'] | null;
  localSendSucceeded?: boolean;
};

export type WechatAgentFallbackDecision = {
  kind: 'return-early' | 'run-agent';
};

export type ResolveDouyinAutoAdvanceParams = {
  sendMode: DouyinSendMode;
  sessionId?: string | null;
  browserBusy: boolean;
  hasPermissionRequest: boolean;
  sendTransitionState: 'idle' | 'awaiting_result';
  structuredStatus: DouyinStructuredStatus | null | undefined;
  batchState: Pick<
    DouyinBatchState,
    | 'consecutiveSkippedOutcomes'
    | 'lastProcessedTarget'
    | 'repeatTargetOutcomeStreak'
    | 'nextTargetHint'
    | 'lastProcessedTarget'
  >;
  maxConsecutiveSkips?: number;
  maxRepeatTargetOutcomes?: number;
};

export type DouyinAutoAdvanceDecision =
  | {
      kind: 'ignore';
      reason:
        | 'send-mode-not-auto'
        | 'missing-session'
        | 'browser-busy'
        | 'permission-pending'
        | 'transition-busy'
        | 'missing-structured-status'
        | 'stage-not-advanceable';
    }
  | {
      kind: 'pause-repeat-target-outcome';
      target: string;
      repeatTargetOutcomeStreak: number;
    }
  | {
      kind: 'pause-consecutive-skips';
      consecutiveSkippedOutcomes: number;
    }
  | {
      kind: 'advance';
      autoAdvanceKey: string;
    };

export type ResolveDouyinLiveSendDecisionParams = {
  hasPermissionRequest: boolean;
  browserMode: DouyinBrowserMode | null;
  sendMode: DouyinSendMode;
  isSendLikeTool: boolean;
  editorVisible: boolean;
  sendButtonVisible: boolean;
  draftText: string;
  conversationMatched: boolean;
  conversationDetail?: string | null;
  hasPermissionSummary: boolean;
};

export type DouyinLiveSendDecision = {
  canAllowLiveSend: boolean;
  shouldAutoAllowSend: boolean;
  shouldRenderPermissionCard: boolean;
  guardHint: string | null;
};

export type ResolveDouyinStructuredStateDecisionParams = {
  sessionStatus?: string | null;
  structuredStatus?: DouyinStructuredStatus | null;
};

export type DouyinStructuredStateDecision =
  | {
      kind: 'sent' | 'skipped' | 'failed';
      stage: 'sent' | 'skipped' | 'failed';
    }
  | {
      kind: 'completed';
    }
  | {
      kind: 'running';
      stage?: DouyinStructuredStage;
    }
  | {
      kind: 'ignore';
    };

export function buildDouyinReplyPrompt(
  mode: DouyinBrowserMode,
  sendMode: DouyinSendMode,
  params: BuildDouyinReplyPromptParams,
) {
  return [
    '你现在要作为运营助手，优先使用浏览器后台能力直接在页面里工作。',
    '第一步必须打开抖音创作者后台或抖音商家后台的消息/评论管理页面。',
    '每次新开页或切页后，必须先确认当前页面，再选中目标页，然后才能继续读取页面、截图或执行后续操作。',
    '如果当前未连接浏览器后台，先提示需要连接浏览器后台，不要编造结果。',
    '如果页面显示扫码登录、验证码登录、密码登录或登录/注册，立即停止后续自动处理，并按待登录状态回报，不要假装已经进入真实后台作业区。',
    mode === 'comment-reply'
      ? sendMode === 'auto-send'
        ? '进入页面后，优先进入评论管理页；如果当前没有可处理评论，要明确回报 no_target_available，不要假装正在处理。只有发现真实目标留言时，才继续分析上下文，生成一条适合当前对象的 AI 正式回复，并把这条回复真实填入页面；确认输入框和发送按钮真实可见后，可以直接执行发送，并在发出后立即回报 sent / failed。'
        : '进入页面后，优先进入评论管理页；如果当前没有可处理评论，要明确回报 no_target_available，不要假装正在处理。只有发现真实目标留言时，才继续分析上下文，生成一条适合当前对象的 AI 正式回复，并把这条回复真实填入页面；在实际点击发送前必须停在 waiting_for_send_confirmation，等待用户确认后发送。'
      : mode === 'direct-message-reply'
        ? sendMode === 'auto-send'
          ? '进入页面后，优先进入私信管理页；定位一个真实会话，读取最近上下文，分析对方当前意图和沟通阶段，生成一条适合当前对象的 AI 正式回复；如果已经给了参考回复，也只能把它当约束，不要机械照抄。最终要把你分析后的正式回复真实填入当前输入区；确认真实输入框、真实发送按钮和真实现场草稿都已就位后，直接执行发送，并在发出后立即回报 sent / failed。如果当前列表没有合适会话，要明确回报 no_target_available，不要假装已经发出。'
          : '进入页面后，优先进入私信管理页；定位一个真实会话，读取最近上下文，分析对方当前意图和沟通阶段，生成一条适合当前对象的 AI 正式回复；如果已经给了参考回复，也只能把它当约束，不要机械照抄。最终要把你分析后的正式回复真实填入当前输入区，并在填入后立即回报 waiting_for_send_confirmation。在实际点击发送前必须停在发送前确认节点，绝不能提前发出。如果当前列表没有合适会话，要明确回报 no_target_available，不要假装已经发出。'
        : '进入页面后，确认后台页面、评论列表或消息入口可见，并汇报可自动回复的下一步。',
    params.creatorName ? `目标账号：${params.creatorName}` : null,
    params.commentUser
      ? `${mode === 'direct-message-reply' ? '目标会话用户' : '目标留言用户'}：${params.commentUser}`
      : null,
    params.commentText
      ? `${mode === 'direct-message-reply' ? '最近一条消息' : '目标留言内容'}：${params.commentText}`
      : null,
    params.replyDraft ? `参考回复约束：${params.replyDraft}` : null,
    params.context ? `补充要求：${params.context}` : null,
    sendMode === 'approval-send'
      ? '发送策略：确认后发送。在实际点击发送或提交前，必须先停在发送前确认节点，等待用户确认，不要跨目标扩散。'
      : '发送策略：自动发送。只要真实输入框、真实发送按钮和当前正式回复都能在页面上确认，就直接发出；如果现场条件不完整，必须停住并明确说明原因，不要盲点。',
    '每次关键阶段变化后，都请严格按下面 4 行格式回报一次：',
    '[作业阶段] login_required | entering_backend | locating_target | no_target_available | drafting_reply | waiting_for_send_confirmation | sent | skipped | failed',
    `[目标对象] ${params.creatorName || '目标账号'} / ${
      params.commentUser || (mode === 'direct-message-reply' ? '目标会话用户' : '目标留言用户')
    }`,
    '[动作结果] 用一句话说明当前这一步已经做到了什么',
    '[下一步] 用一句话说明接下来要做什么',
    '优先走浏览器后台处理；只有浏览器路径不可行时，才切到桌面接管。整个过程要持续在会话里汇报当前页面、动作和结果。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildWechatReplyDraftInstruction(
  mode: WechatExecutionMode,
  params: BuildWechatReplyInstructionParams,
) {
  const trimmedContact = params.contact.trim();
  const trimmedDraft = params.draft.trim();
  const trimmedContext = params.context.trim();

  return [
    '请在本机微信桌面客户端中定位目标联系人会话，阅读最近上下文，先处理未回复会话队列；如果当前任务要求发草稿，只在边界内填写或生成候选回复。',
    '在任何填写或发送之前，必须先确认当前微信会话头部名称与目标联系人完全一致；只要不一致，就立即停止并明确回报，不要继续发送。',
    '如果当前落到的是搜一搜、公众号、视频号、账号结果页，而不是正常聊天会话，则只允许做只读分析并回报"当前对象不支持自动发送"，绝对不要发送。',
    mode === 'read-only-analyze'
      ? '这轮是只读分析模式。只允许阅读当前对象页面内容、判断是否属于正常聊天联系人、总结上下文并整理 AI 正式回复，不允许填写，也不允许发送。'
      : mode === 'auto-send'
        ? '这轮是自动发送模式。只有在目标联系人已经锁定、当前会话头与目标联系人完全一致、正式回复已经就位时，才允许真正发送。'
        : mode === 'controlled-send'
          ? '这轮是受控发送模式。先锁定目标联系人并准备正式回复，发送前必须停在确认节点。'
          : '这轮是草稿整理模式。只允许定位目标联系人和整理正式回复，不要真的发送。',
    trimmedContact ? `目标联系人：${trimmedContact}。` : null,
    trimmedDraft ? `候选回复草稿：${trimmedDraft}。` : null,
    trimmedContext ? `补充要求：${trimmedContext}。` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function getWechatTaskType(mode: WechatExecutionMode) {
  if (mode === 'read-only-analyze') return 'wechat.reply.read_only_analysis';
  if (mode === 'draft') return 'wechat.reply.draft';
  if (mode === 'controlled-send') return 'wechat.reply.controlled_send';
  return 'wechat.reply.auto_send';
}

export function getWechatExecutionPolicy(mode: WechatExecutionMode) {
  if (mode === 'read-only-analyze' || mode === 'draft') return 'plan_only';
  if (mode === 'controlled-send') return 'approval_execute';
  return 'auto_execute';
}

export function shouldWechatAllowDesktopActionExecution(mode: WechatExecutionMode) {
  return mode !== 'draft' && mode !== 'read-only-analyze';
}

export function shouldWechatRequireApproval(mode: WechatExecutionMode) {
  return mode !== 'auto-send';
}

export function resolveWechatSendPolicy(
  taskType: string | undefined,
  currentMode: WechatExecutionMode,
): 'draft-only' | 'approval-send' | 'auto-send' | 'read-only-analyze' {
  if (taskType === 'wechat.reply.auto_send') return 'auto-send';
  if (taskType === 'wechat.reply.controlled_send') return 'approval-send';
  if (taskType === 'wechat.reply.read_only_analysis') return 'read-only-analyze';
  if (currentMode === 'auto-send') return 'auto-send';
  if (currentMode === 'controlled-send') return 'approval-send';
  if (currentMode === 'read-only-analyze') return 'read-only-analyze';
  return 'draft-only';
}

export function resolveWechatNextMode(
  sendPolicy: 'draft-only' | 'approval-send' | 'auto-send' | 'read-only-analyze',
): 'draft' | 'controlled-send' | 'auto-send' | 'read-only-analyze' {
  if (sendPolicy === 'auto-send') return 'auto-send';
  if (sendPolicy === 'approval-send') return 'controlled-send';
  if (sendPolicy === 'read-only-analyze') return 'read-only-analyze';
  return 'draft';
}

export function resolveWechatResumeDecision(
  params: ResolveWechatResumeDecisionParams,
): WechatResumeDecision {
  if (!params.paused) {
    return { kind: 'pause' };
  }

  const trimmedCandidate = params.nextCandidateContact.trim();
  if (trimmedCandidate) {
    return {
      kind: 'advance-next',
      candidateContact: trimmedCandidate,
    };
  }

  return {
    kind: 'resume-mode',
    mode: resolveWechatNextMode(params.sendPolicy),
  };
}

export function getDouyinSessionTitle(mode: DouyinBrowserMode) {
  if (mode === 'comment-reply') return '私域运营作战台：抖音后台评论自动回复';
  if (mode === 'direct-message-reply') return '私域运营作战台：抖音后台私信自动回复';
  return '私域运营作战台：打开抖音后台';
}

export function getDouyinTargetEntry(mode: DouyinBrowserMode) {
  if (mode === 'comment-reply') return 'comment-management';
  if (mode === 'direct-message-reply') return 'direct-message';
  return 'home';
}

export function getDouyinSkipDirective(mode: DouyinBrowserMode) {
  return mode === 'direct-message-reply'
    ? '请明确跳过当前这条私信对象，不要发送；随后继续留在当前私信列表里，定位下一条需要处理的真实会话，并按结构化阶段继续回报。'
    : '请明确跳过当前这条评论对象，不要发送；随后继续留在当前评论列表里，定位下一条需要处理的真实评论，并按结构化阶段继续回报。';
}

export function getDouyinAdvanceDirective(mode: DouyinBrowserMode) {
  return mode === 'direct-message-reply'
    ? '请继续处理下一条真实私信对象。如果当前列表里还有待处理会话，优先回到下一条并继续按相同结构化阶段推进；如果列表里没有新的可处理对象，要明确回报 no_target_available。'
    : '请继续处理下一条真实评论对象。如果当前列表里还有待处理评论，优先回到下一条并继续按相同结构化阶段推进；如果列表里没有新的可处理对象，要明确回报 no_target_available。';
}

export function getDouyinResumeDirective(mode: DouyinBrowserMode) {
  return mode === 'direct-message-reply'
    ? '请从刚才暂停的位置继续这一轮抖音私信处理。如果已有下一条目标提示，优先回到那条真实会话；否则继续在当前私信列表里定位下一条需要处理的会话，并按结构化阶段回报。'
    : '请从刚才暂停的位置继续这一轮抖音评论处理。如果已有下一条目标提示，优先回到那条真实评论；否则继续在当前评论列表里定位下一条需要处理的对象，并按结构化阶段回报。';
}

export function buildDouyinBrowserSessionPlan(
  params: BuildDouyinSessionPlanParams,
): DouyinBrowserSessionPlan {
  return {
    title: getDouyinSessionTitle(params.mode),
    prompt: buildDouyinReplyPrompt(params.mode, params.sendMode, {
      creatorName: params.creatorName,
      commentUser: params.commentUser,
      commentText: params.commentText,
      replyDraft: params.replyDraft,
      context: params.context,
    }),
    allowedTools: params.allowedTools,
    targetEntry: getDouyinTargetEntry(params.mode),
    memoryEnabled: false,
  };
}

export function buildDouyinContinuePrompt(
  params: BuildDouyinContinuePromptParams,
) {
  const basePrompt = buildDouyinReplyPrompt(params.mode, params.sendMode, {
    creatorName: params.creatorName,
    commentUser: params.commentUser,
    commentText: params.commentText,
    replyDraft: params.replyDraft,
    context: params.context,
  });

  const liveHints = [
    params.liveStageHint ? `当前页面阶段提示：${params.liveStageHint}` : null,
    params.liveTargetLabel ? `当前页面对象提示：${params.liveTargetLabel}` : null,
    params.liveEditorPlaceholder ? `当前回复框占位提示：${params.liveEditorPlaceholder}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return liveHints ? `${basePrompt}\n${liveHints}` : basePrompt;
}

export function buildDouyinDirectiveContinuePrompt(
  params: BuildDouyinDirectiveContinuePromptParams,
) {
  return `${params.directive}\n\n${buildDouyinContinuePrompt(params)}`;
}

export function planWechatTask(mode: WechatExecutionMode): WechatTaskPlan {
  return {
    mode,
    taskType: getWechatTaskType(mode),
    executionPolicy: getWechatExecutionPolicy(mode),
    allowDesktopActionExecution: shouldWechatAllowDesktopActionExecution(mode),
    requiresApproval: shouldWechatRequireApproval(mode),
  };
}

export function buildWechatExecuteRequest(input: {
  mode: WechatExecutionMode;
  contact: string;
  draft: string;
  context: string;
  entityType: WechatEntityType;
  localControllerPermissionMode: 'restricted' | 'custom' | 'full';
}): AgentSExecuteRoutedTaskInput {
  const plan = planWechatTask(input.mode);
  return {
    capability: 'desktop-gui',
    session_name: `wechat-queue-${input.mode}-${Date.now()}`,
    instruction: buildWechatReplyDraftInstruction(input.mode, {
      contact: input.contact,
      draft: input.draft,
      context: input.context,
    }),
    task_type: plan.taskType,
    metadata: {
      source: 'ops-workbench-wechat-reply-draft',
      agent_s_business_scenario: 'wechat-reply-draft',
      wechat_contact_name: input.contact,
      wechat_expected_contact_name: input.contact,
      wechat_contact_guard_mode: 'strict_target_match',
      wechat_reply_draft: input.draft,
      wechat_reply_mode: input.mode,
      wechat_entity_type: input.entityType,
      wechat_context_note: input.context || null,
      agent_s_execution_policy: plan.executionPolicy,
      allow_desktop_action_execution: plan.allowDesktopActionExecution,
    },
    labels: ['wechat', 'reply-draft', 'ops-workbench'],
    risk_level: input.mode === 'auto-send' ? 'high' : 'medium',
    requires_approval: plan.requiresApproval,
    local_controller_permission_mode: input.localControllerPermissionMode,
    allowed_desktop_action_targets: ['WeChat', '微信', input.contact],
    allowed_desktop_text_inputs: [input.contact, input.draft],
  };
}

export function resolveWechatRecommendedAction(
  params: ResolveWechatRecommendedActionParams,
): WechatRecommendedAction {
  const effectiveProcessedCount = Math.max(1, params.processedCount);
  const effectiveTarget = params.expectedContact || params.sentTargetContact || '当前联系人';

  if (params.lastSent) {
    if (params.nextCandidateContact) {
      return {
        kind: 'advance-next',
        label: '继续处理下一条',
        hint: `上一条已经发给"${effectiveTarget}"，本轮已处理 ${effectiveProcessedCount} 条，系统已从真机列表里提取到下一条候选"${params.nextCandidateContact}"，点击后会直接带回作战台、自动对齐并准备下一条现场草稿。`,
        candidateContact: params.nextCandidateContact,
      };
    }
    return {
      kind: 'draft',
      label: '继续处理下一条',
      hint: `上一条已经发给"${effectiveTarget}"，本轮已处理 ${effectiveProcessedCount} 条，现在可以回到清队列模式继续下一条。`,
      mode: 'draft',
    };
  }

  if (params.liveEntityType === 'search-result') {
    return {
      kind: 'read-only-analyze',
      label: '继续只读分析',
      hint: '当前对象是搜一搜/公众号结果页，不适合发送，先做只读分析和正式回复准备。',
      mode: 'read-only-analyze',
    };
  }

  if (params.preferredLiveTarget && params.preferredLiveTarget !== params.expectedContact) {
    return {
      kind: 'use-live-conversation',
      label: '用当前会话当目标',
      hint: `当前会话更像正常聊天联系人"${params.preferredLiveTarget}"，先把它带回作战台当目标联系人。`,
      candidateContact: params.preferredLiveTarget,
    };
  }

  if (params.expectedContact && !params.canSend) {
    return {
      kind: 'align-contact',
      label: '继续对齐目标联系人',
      hint: `目标联系人"${params.expectedContact}"还没完全对齐到当前微信窗口，先做联系人确认。`,
    };
  }

  if (params.canSend) {
    if (params.sendPolicy === 'auto-send') {
      return {
        kind: 'auto-send',
        label: '继续自动发送',
        hint: `目标联系人"${params.expectedContact}"已对齐，当前可以直接按自动发送推进。`,
        mode: 'auto-send',
      };
    }
    return {
      kind: 'controlled-send',
      label: '进入确认后发送',
      hint: `目标联系人"${params.expectedContact}"已对齐，当前可以先停在发送前确认。`,
      mode: 'controlled-send',
    };
  }

  return {
    kind: 'draft',
    label: '先清未回复队列',
    hint: '先把微信会话拉进队列，再决定要不要发。',
    mode: 'draft',
  };
}

export function resolveWechatAdvanceDecision(
  params: ResolveWechatAdvanceDecisionParams,
): WechatAdvanceDecision {
  const trimmedContact = params.candidateContact.trim();
  if (!trimmedContact) {
    return {
      kind: 'blocked',
      detail: '当前没有可用的下一条候选联系人，这一轮不会继续推进。',
    };
  }

  if (!params.aligned) {
    return {
      kind: 'blocked',
      detail:
        params.note || `候选联系人"${trimmedContact}"还没完成真机对齐，这一轮不会直接放行发送。`,
    };
  }

  const mode = resolveWechatNextMode(params.sendPolicy);
  const shouldUseGuardOverride = mode === 'controlled-send' || mode === 'auto-send';

  if (shouldUseGuardOverride && !params.canSend) {
    return {
      kind: 'blocked',
      detail:
        params.sendReason ||
        `候选联系人"${trimmedContact}"虽然已经对齐，但发送确认还没通过，这一轮不会继续发送。`,
    };
  }

  return {
    kind: 'run',
    mode,
    contact: trimmedContact,
    shouldUseGuardOverride,
  };
}

export function resolveWechatTaskEntryDecision(
  params: ResolveWechatTaskEntryDecisionParams,
): WechatTaskEntryDecision {
  const trimmedContact = params.contact.trim();
  const trimmedDraft = params.draft.trim();

  if (!trimmedContact || !trimmedDraft) {
    return {
      kind: 'blocked',
      reason: 'missing-input',
      detail: '请先填写联系人和回复草稿，再发起微信任务。',
    };
  }

  if (
    (params.mode === 'controlled-send' || params.mode === 'auto-send') &&
    !params.canSend
  ) {
    return {
      kind: 'blocked',
      reason: 'guard-blocked',
      detail: params.sendReason || '微信现场联系人还没对齐，当前不允许发送。',
    };
  }

  return { kind: 'proceed' };
}

export function resolveWechatLiveSnapshotDecision(
  params: ResolveWechatLiveSnapshotDecisionParams,
): WechatLiveSnapshotDecision {
  const expectedContact = params.expectedContact.trim();
  const snapshot = params.snapshot;
  const currentConversation = String(
    snapshot?.currentConversation || snapshot?.selectedConversation || ''
  ).trim();
  const activeConversation = String(snapshot?.activeConversation || '').trim();
  const matchedTarget = Boolean(String(snapshot?.matchedTarget || '').trim());

  let entityType: WechatEntityType = 'unknown';
  if (snapshot?.entityType === 'contact' || snapshot?.entityType === 'search-result') {
    entityType = snapshot.entityType;
  } else {
    const headerTexts = Array.isArray(snapshot?.headerTexts) ? snapshot.headerTexts : [];
    const listTexts = Array.isArray(snapshot?.listTexts) ? snapshot.listTexts : [];
    const looksLikeSearchResult =
      headerTexts.some((text) => typeof text === 'string' && text.includes('搜一搜')) ||
      listTexts.some(
        (text) =>
          typeof text === 'string' &&
          (text.includes('AI搜索') ||
            text.includes('公众号') ||
            text.includes('视频号') ||
            text.includes('账号'))
      ) ||
      currentConversation.includes('搜一搜') ||
      activeConversation.includes('搜一搜');

    if (looksLikeSearchResult) {
      entityType = 'search-result';
    } else if (
      expectedContact &&
      currentConversation === expectedContact &&
      activeConversation === expectedContact
    ) {
      entityType = 'contact';
    }
  }

  const guardResult = evaluateWechatSendability(
    expectedContact,
    {
      ...snapshot,
      currentConversation,
      selectedConversation: currentConversation,
      activeConversation,
      matchedTarget: matchedTarget ? expectedContact : '',
    },
    entityType,
  );

  const candidates = [
    snapshot?.selectedConversation,
    snapshot?.currentConversation,
    snapshot?.activeConversation,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const firstCandidate = candidates[0] || '';
  const preferredLiveTarget = entityType === 'contact' ? firstCandidate : '';

  return {
    currentConversation,
    activeConversation,
    matchedTarget,
    entityType,
    canSend: guardResult.canSend,
    sendReason: guardResult.reason,
    preferredLiveTarget,
  };
}

export function resolveWechatPreparedDraftDecision(
  params: ResolveWechatPreparedDraftDecisionParams,
): WechatPreparedDraftDecision {
  if (!params.draftReady.draftInserted || !params.draftReady.inputReady) {
    return {
      kind: 'draft-not-ready',
      detail: params.draftReady.note || '微信输入框还没准备完成，这一轮先停在发送前。',
    };
  }

  if (params.mode === 'controlled-send') {
    const wasAlreadyConfirmedReady =
      params.previousDraftReadyState?.draftInserted &&
      params.previousDraftReadyState?.inputReady &&
      params.previousDraftReadyState?.stage === 'draft_ready_for_send_confirmation';

    if (wasAlreadyConfirmedReady && params.hasSendCapability) {
      return {
        kind: 'send-now',
        sendText: params.draftReady.readbackText || params.fallbackDraftText,
      };
    }

    return { kind: 'hold-for-confirmation' };
  }

  if (params.mode === 'auto-send') {
    if (params.hasSendCapability) {
      return {
        kind: 'send-now',
        sendText: params.draftReady.readbackText || params.fallbackDraftText,
      };
    }

    return { kind: 'continue-agent-run' };
  }

  return { kind: 'continue-agent-run' };
}

export function resolveWechatPreparedDraftExecutionDecision(
  params: ResolveWechatPreparedDraftExecutionDecisionParams,
): WechatPreparedDraftExecutionDecision {
  if (params.preparedDraftDecisionKind === 'draft-not-ready') {
    return { kind: 'throw-draft-not-ready' };
  }

  if (params.mode === 'controlled-send') {
    if (params.preparedDraftDecisionKind === 'hold-for-confirmation') {
      return { kind: 'hold-for-confirmation' };
    }

    if (params.preparedDraftDecisionKind === 'send-now') {
      return {
        kind: 'send-locally',
        sendMode: 'controlled-send',
      };
    }
  }

  if (params.mode === 'auto-send' && params.preparedDraftDecisionKind === 'send-now') {
    return {
      kind: 'send-locally',
      sendMode: 'auto-send',
    };
  }

  return { kind: 'continue-agent' };
}

export function resolveWechatLocalExecutionRoute(
  params: ResolveWechatLocalExecutionRouteParams,
): WechatLocalExecutionRouteDecision {
  if (params.mode === 'draft') {
    return { kind: 'queue-draft-and-run-agent' };
  }

  if (
    (params.mode === 'controlled-send' || params.mode === 'auto-send') &&
    params.hasPrepareDraftCapability
  ) {
    return { kind: 'prepare-live-draft' };
  }

  return { kind: 'run-agent-directly' };
}

export function resolveWechatAgentFallbackDecision(
  params: ResolveWechatAgentFallbackDecisionParams,
): WechatAgentFallbackDecision {
  if (params.preparedDraftDecisionKind === 'hold-for-confirmation') {
    return { kind: 'return-early' };
  }

  if (
    params.mode === 'auto-send' &&
    params.preparedDraftDecisionKind === 'send-now' &&
    params.localSendSucceeded
  ) {
    return { kind: 'return-early' };
  }

  return { kind: 'run-agent' };
}

export function resolveDouyinAutoAdvanceDecision(
  params: ResolveDouyinAutoAdvanceParams,
): DouyinAutoAdvanceDecision {
  const {
    sendMode,
    sessionId,
    browserBusy,
    hasPermissionRequest,
    sendTransitionState,
    structuredStatus,
    batchState,
    maxConsecutiveSkips = 3,
    maxRepeatTargetOutcomes = 2,
  } = params;

  if (sendMode !== 'auto-send') {
    return { kind: 'ignore', reason: 'send-mode-not-auto' };
  }
  if (!sessionId) {
    return { kind: 'ignore', reason: 'missing-session' };
  }
  if (browserBusy) {
    return { kind: 'ignore', reason: 'browser-busy' };
  }
  if (hasPermissionRequest) {
    return { kind: 'ignore', reason: 'permission-pending' };
  }
  if (sendTransitionState !== 'idle') {
    return { kind: 'ignore', reason: 'transition-busy' };
  }
  if (!structuredStatus) {
    return { kind: 'ignore', reason: 'missing-structured-status' };
  }
  if (structuredStatus.stage !== 'sent' && structuredStatus.stage !== 'skipped') {
    return { kind: 'ignore', reason: 'stage-not-advanceable' };
  }

  const nextConsecutiveSkips =
    structuredStatus.stage === 'skipped'
      ? (batchState.consecutiveSkippedOutcomes || 0) + 1
      : 0;
  const nextRepeatTargetOutcomeStreak =
    batchState.lastProcessedTarget &&
    structuredStatus.target &&
    batchState.lastProcessedTarget === structuredStatus.target
      ? (batchState.repeatTargetOutcomeStreak || 1) + 1
      : 1;

  if (
    nextRepeatTargetOutcomeStreak >= maxRepeatTargetOutcomes &&
    structuredStatus.target
  ) {
    return {
      kind: 'pause-repeat-target-outcome',
      target:
        structuredStatus.target ||
        batchState.nextTargetHint ||
        batchState.lastProcessedTarget ||
        '当前对象',
      repeatTargetOutcomeStreak: nextRepeatTargetOutcomeStreak,
    };
  }

  if (
    structuredStatus.stage === 'skipped' &&
    nextConsecutiveSkips >= maxConsecutiveSkips
  ) {
    return {
      kind: 'pause-consecutive-skips',
      consecutiveSkippedOutcomes: nextConsecutiveSkips,
    };
  }

  return {
    kind: 'advance',
    autoAdvanceKey: [
      sessionId,
      structuredStatus.stage,
      structuredStatus.target || '',
      structuredStatus.result || '',
    ].join('::'),
  };
}

export function resolveDouyinLiveSendDecision(
  params: ResolveDouyinLiveSendDecisionParams,
): DouyinLiveSendDecision {
  const {
    hasPermissionRequest,
    browserMode,
    sendMode,
    isSendLikeTool,
    editorVisible,
    sendButtonVisible,
    draftText,
    conversationMatched,
    conversationDetail,
    hasPermissionSummary,
  } = params;

  const canAllowLiveSend =
    hasPermissionRequest &&
    (browserMode !== 'direct-message-reply' ||
      Boolean(editorVisible && sendButtonVisible && draftText.trim() && conversationMatched));

  const shouldAutoAllowSend =
    Boolean(hasPermissionRequest && isSendLikeTool && sendMode === 'auto-send' && canAllowLiveSend);

  const shouldRenderPermissionCard =
    Boolean(hasPermissionRequest && hasPermissionSummary) &&
    !(sendMode === 'auto-send' && isSendLikeTool && canAllowLiveSend);

  let guardHint: string | null = null;
  if (hasPermissionRequest && browserMode === 'direct-message-reply') {
    if (!conversationMatched) {
      guardHint = conversationDetail || null;
    } else if (sendMode === 'auto-send') {
      guardHint = canAllowLiveSend
        ? '自动发送已就绪：左侧激活会话、右侧当前会话、真实输入框、真实发送按钮和 AI 分析后的正式回复都已对齐，系统会自动放行发送并等待结果回抬。'
        : '自动发送已开启，但现场校验还没过：必须先确认对象一致、真实输入框、真实发送按钮和 AI 分析后的正式回复都已就位，才能真正自动发出。';
    } else {
      guardHint = canAllowLiveSend
        ? '现场校验已通过：左侧激活会话、右侧当前会话、真实输入框、真实发送按钮和 AI 分析后的正式回复都已对齐，点"允许继续发送"就会在抖音后台真正发出这条私信。'
        : '现场校验还没过：必须先确认对象一致、真实输入框、真实发送按钮和 AI 分析后的正式回复都已就位，才能继续发送。';
    }
  }

  return {
    canAllowLiveSend,
    shouldAutoAllowSend,
    shouldRenderPermissionCard,
    guardHint,
  };
}

export function resolveDouyinStructuredStateDecision(
  params: ResolveDouyinStructuredStateDecisionParams,
): DouyinStructuredStateDecision {
  const stage = params.structuredStatus?.stage;

  if (stage === 'sent' || stage === 'skipped' || stage === 'failed') {
    return {
      kind: stage,
      stage,
    };
  }

  if (stage === 'no_target_available' || params.sessionStatus === 'completed') {
    return {
      kind: 'completed',
    };
  }

  if (params.sessionStatus === 'running') {
    return {
      kind: 'running',
      stage:
        stage === 'login_required' ||
        stage === 'entering_backend' ||
        stage === 'locating_target' ||
        stage === 'drafting_reply' ||
        stage === 'waiting_for_send_confirmation' ||
        stage === 'sent' ||
        stage === 'skipped' ||
        stage === 'failed'
          ? stage
          : undefined,
    };
  }

  return { kind: 'ignore' };
}
