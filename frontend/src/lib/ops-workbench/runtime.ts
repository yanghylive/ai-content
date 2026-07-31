export type OpsWorkbenchWechatConversationSnapshotResult = {
  screenshotPath?: string;
  screenshotExists: boolean;
  entityType?: "unknown" | "contact" | "search-result";
  activeConversation?: string;
  currentConversation?: string;
  selectedConversation?: string;
  headerTexts: string[];
  listTexts: string[];
  matchedTarget?: string;
  note?: string;
};

export type BrowserCapabilityStatus =
  | "ready"
  | "needs-preset"
  | "needs-config"
  | "needs-enable"
  | "connecting"
  | "failed";

export type BrowserCapability = {
  presetAvailable: boolean;
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  status: BrowserCapabilityStatus;
  setupHint: string;
  browserUrl?: string;
  toolCount?: number;
};

export type DouyinStructuredStage =
  | "login_required"
  | "entering_backend"
  | "locating_target"
  | "no_target_available"
  | "drafting_reply"
  | "waiting_for_send_confirmation"
  | "sent"
  | "skipped"
  | "failed";

export type DouyinStructuredStatus = {
  stage: DouyinStructuredStage;
  target?: string;
  result?: string;
  nextStep?: string;
};

export type WechatBatchState = {
  active: boolean;
  paused: boolean;
  completed: boolean;
  pausedOnce?: boolean;
  processedCount: number;
  skippedCount?: number;
  lastProcessedContact?: string;
  nextCandidate?: string;
  pauseReason?: string;
  lastPauseReason?: string;
  completionSummary?: string;
  lastOutcomeTitle?: string;
  lastOutcomeDetail?: string;
};

export type DouyinBatchState = {
  active: boolean;
  paused: boolean;
  completed: boolean;
  pausedOnce?: boolean;
  processedCount: number;
  skippedCount?: number;
  failedCount?: number;
  consecutiveSkippedOutcomes?: number;
  repeatTargetOutcomeStreak?: number;
  lastProcessedTarget?: string;
  nextTargetHint?: string;
  lastSkippedReason?: string;
  lastFailedReason?: string;
  lastStopTarget?: string;
  lastStopReason?: string;
  pauseReason?: string;
  lastPauseReason?: string;
  completionSummary?: string;
  lastOutcomeTitle?: string;
  lastOutcomeDetail?: string;
  recentOutcomes?: Array<{
    kind: "sent" | "skipped" | "failed";
    target: string;
    detail: string;
  }>;
};

export type DouyinBrowserMode =
  | "comment-reply"
  | "direct-message-reply"
  | "open-only";

export type WechatExecutionMode =
  | "draft"
  | "controlled-send"
  | "auto-send"
  | "read-only-analyze";

export type DouyinSendMode = "auto-send" | "approval-send";

export type WechatEntityType = "unknown" | "contact" | "search-result";

export function detectDouyinLoginRequired(source: string): boolean {
  const normalized = source.trim();
  if (!normalized) return false;
  return (
    /(扫码登录|验证码登录|密码登录|登录\/注册|登录或注册)/.test(normalized) &&
    /(抖音创作者中心|抖音后台|创作者后台|creator\.douyin\.com)/i.test(
      normalized,
    )
  );
}

export function detectDouyinChromeWakeupNeeded(source: string): boolean {
  const normalized = source.trim();
  if (!normalized) return false;
  return /(启用 Chrome MCP|连接 Chrome MCP|未连接到 Chrome MCP|需要先启用 Chrome MCP)/i.test(
    normalized,
  );
}

export function detectDouyinNoTargetAvailable(source: string): boolean {
  const normalized = source.trim();
  if (!normalized) return false;
  return /(暂无更多评论|暂无新的评论|点击刷新|暂无会话|暂无私信|暂无消息|还没有收到消息)/.test(
    normalized,
  );
}

export function looksLikeWechatTimestamp(text: string): boolean {
  const normalized = text.trim();
  return /^(\d{1,2}:\d{2}|昨天|前天|周[一二三四五六日天]|星期[一二三四五六日天])$/.test(
    normalized,
  );
}

export function looksLikeWechatNoise(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (normalized.length <= 1) return true;
  if (looksLikeWechatTimestamp(normalized)) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^[~\-—_（）()【】\[\]、，,。.！!？?：:；;]+$/.test(normalized))
    return true;
  if (
    /(你好，刚看到你的消息|请问|方便的话|我这边|视频号|公众号|账号|AI搜索|搜一搜|未读|置顶|条)/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

export function extractWechatCandidateContacts(
  listTexts: string[],
  exclude: string[] = [],
) {
  const excludeSet = new Set(
    exclude.map((item) => item.trim()).filter(Boolean),
  );
  const candidates: string[] = [];
  for (const raw of listTexts) {
    const text = String(raw || "").trim();
    if (looksLikeWechatNoise(text)) continue;
    if (text.length > 16) continue;
    if (excludeSet.has(text)) continue;
    if (!candidates.includes(text)) {
      candidates.push(text);
    }
  }
  return candidates;
}

export function evaluateWechatSendability(
  expectedContact: string,
  snapshot:
    | Partial<OpsWorkbenchWechatConversationSnapshotResult>
    | null
    | undefined,
  entityType: WechatEntityType,
) {
  const currentConversation = String(
    snapshot?.currentConversation || snapshot?.selectedConversation || "",
  ).trim();
  const activeConversation = String(snapshot?.activeConversation || "").trim();
  const matchedTarget = Boolean(snapshot?.matchedTarget);

  if (!expectedContact.trim()) {
    return {
      canSend: false,
      reason: "请先填写目标联系人。",
    };
  }
  if (entityType === "search-result") {
    return {
      canSend: false,
      reason:
        "当前落在搜一搜/公众号结果页，这类对象只支持只读分析，不支持自动发送。",
    };
  }
  if (!activeConversation && !currentConversation) {
    return {
      canSend: false,
      reason: "还没拿到微信现场会话快照，当前不放行发送。",
    };
  }
  if (!matchedTarget) {
    return {
      canSend: false,
      reason: `当前会话还没对齐到目标联系人"${expectedContact}"。`,
    };
  }
  if (currentConversation !== expectedContact) {
    return {
      canSend: false,
      reason: `当前会话头是"${currentConversation || "未识别"}"，不是目标联系人"${expectedContact}"。`,
    };
  }
  if (activeConversation !== expectedContact) {
    return {
      canSend: false,
      reason: `左侧激活条目是"${activeConversation || "未识别"}"，不是目标联系人"${expectedContact}"。`,
    };
  }

  return {
    canSend: true,
    reason: "",
  };
}

export function getWechatSendPolicyLabel(
  policy: "draft-only" | "approval-send" | "auto-send" | "read-only-analyze",
) {
  if (policy === "auto-send") return "自动发送";
  if (policy === "approval-send") return "确认后发送";
  if (policy === "read-only-analyze") return "只读分析";
  return "只整理草稿";
}

export function getWechatEntityLabel(entityType: WechatEntityType) {
  if (entityType === "contact") return "正常聊天联系人";
  if (entityType === "search-result") return "搜一搜/公众号结果";
  return "未确认对象";
}

export function getDouyinSendModeLabel(sendMode: DouyinSendMode) {
  return sendMode === "auto-send" ? "自动发送" : "确认后发送";
}

export function parseDouyinStructuredStatus(
  source: string,
): DouyinStructuredStatus | null {
  const normalized = source.trim();
  if (!normalized) return null;

  const pick = (label: string) => {
    const regex = new RegExp(`\\[${label}\\]\\s*([^\\n]+)`, "i");
    return normalized.match(regex)?.[1]?.trim() || "";
  };

  const stage = pick("作业阶段").toLowerCase() as DouyinStructuredStage;
  if (
    ![
      "login_required",
      "entering_backend",
      "locating_target",
      "no_target_available",
      "drafting_reply",
      "waiting_for_send_confirmation",
      "sent",
      "skipped",
      "failed",
    ].includes(stage)
  ) {
    return null;
  }

  return {
    stage,
    target: pick("目标对象") || undefined,
    result: pick("动作结果") || undefined,
    nextStep: pick("下一步") || undefined,
  };
}

export function buildDouyinOutcomeState(
  current: DouyinBatchState,
  params: {
    kind: "sent" | "skipped" | "failed";
    target: string;
    detail: string;
    mode: DouyinBrowserMode;
  },
): DouyinBatchState {
  const { kind, target, detail, mode } = params;
  const repeatTargetOutcomeStreak =
    current.lastProcessedTarget && current.lastProcessedTarget === target
      ? (current.repeatTargetOutcomeStreak || 1) + 1
      : 1;

  if (kind === "sent") {
    return {
      ...current,
      active: true,
      paused: false,
      completed: false,
      consecutiveSkippedOutcomes: 0,
      repeatTargetOutcomeStreak,
      processedCount: Math.max(current.processedCount + 1, 1),
      lastProcessedTarget: target,
      nextTargetHint: undefined,
      completionSummary: undefined,
      lastFailedReason: undefined,
      lastStopTarget: target,
      lastStopReason: detail,
      lastOutcomeTitle:
        mode === "direct-message-reply"
          ? "上一条私信已真实发出"
          : "上一条评论已真实发出",
      lastOutcomeDetail: detail,
      recentOutcomes: [
        {
          kind: "sent" as const,
          target,
          detail,
        },
        ...(current.recentOutcomes || []),
      ].slice(0, 3),
    };
  }

  if (kind === "skipped") {
    return {
      ...current,
      active: true,
      paused: false,
      completed: false,
      consecutiveSkippedOutcomes: (current.consecutiveSkippedOutcomes || 0) + 1,
      repeatTargetOutcomeStreak,
      skippedCount: (current.skippedCount || 0) + 1,
      lastProcessedTarget: target,
      nextTargetHint: undefined,
      lastSkippedReason: detail,
      completionSummary: undefined,
      lastFailedReason: undefined,
      lastStopTarget: target,
      lastStopReason: detail,
      lastOutcomeTitle:
        mode === "direct-message-reply"
          ? "已跳过当前私信对象"
          : "已跳过当前评论对象",
      lastOutcomeDetail: detail,
      recentOutcomes: [
        {
          kind: "skipped" as const,
          target,
          detail,
        },
        ...(current.recentOutcomes || []),
      ].slice(0, 3),
    };
  }

  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: true,
    completed: false,
    pausedOnce: true,
    consecutiveSkippedOutcomes: 0,
    repeatTargetOutcomeStreak,
    failedCount: (current.failedCount || 0) + 1,
    lastProcessedTarget: target,
    nextTargetHint: target,
    lastFailedReason: detail,
    lastStopTarget: target,
    lastStopReason: detail,
    pauseReason: detail,
    lastPauseReason: detail,
    completionSummary: undefined,
    lastOutcomeTitle:
      mode === "direct-message-reply"
        ? "这一条私信处理失败"
        : "这一条评论处理失败",
    lastOutcomeDetail: detail,
    recentOutcomes: [
      {
        kind: "failed" as const,
        target,
        detail,
      },
      ...(current.recentOutcomes || []),
    ].slice(0, 3),
  };
}

export function buildDouyinCompletedState(
  current: DouyinBatchState,
  params: {
    mode: DouyinBrowserMode;
    detail?: string;
  },
): DouyinBatchState {
  const { mode, detail } = params;
  const resolvedDetail =
    detail ||
    (mode === "direct-message-reply"
      ? "当前私信列表里已经没有新的可处理对象，这一轮先在这里收口。"
      : "当前评论列表里已经没有新的可处理对象，这一轮先在这里收口。");

  return {
    ...current,
    active: false,
    paused: false,
    completed: true,
    consecutiveSkippedOutcomes: 0,
    repeatTargetOutcomeStreak: 0,
    pauseReason: undefined,
    lastStopTarget: current.lastProcessedTarget,
    lastStopReason: resolvedDetail,
    completionSummary: `这一轮已经完成，累计处理 ${Math.max(current.processedCount, 0)} 条，跳过 ${current.skippedCount || 0} 条，失败 ${current.failedCount || 0} 条${current.lastProcessedTarget ? `，最后处理的是"${current.lastProcessedTarget}"` : ""}${current.pausedOnce ? `，中途曾暂停过${current.lastPauseReason ? `（${current.lastPauseReason}）` : "一次"}` : "。"}当前没有新的可处理对象。`,
    lastOutcomeTitle: "抖音这一轮已完成",
    lastOutcomeDetail: resolvedDetail,
  };
}

export function buildDouyinModeStartingState(
  current: DouyinBatchState,
  params: {
    mode: DouyinBrowserMode;
    targetHint?: string;
  },
): DouyinBatchState {
  const { mode, targetHint } = params;
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    consecutiveSkippedOutcomes: 0,
    repeatTargetOutcomeStreak: 0,
    nextTargetHint: targetHint || current.nextTargetHint,
    pauseReason: undefined,
    completionSummary: undefined,
    failedCount: 0,
    lastFailedReason: undefined,
    lastStopTarget: undefined,
    lastStopReason: undefined,
    recentOutcomes: [],
    lastOutcomeTitle:
      mode === "comment-reply"
        ? "抖音自动评论已启动"
        : mode === "direct-message-reply"
          ? "抖音私信处理已启动"
          : "抖音后台已打开",
    lastOutcomeDetail:
      mode === "comment-reply"
        ? `正在围绕"${targetHint || "目标留言用户"}"进入抖音自动评论流程并准备处理当前这一轮。`
        : mode === "direct-message-reply"
          ? `正在围绕"${targetHint || "目标会话用户"}"进入私信管理页并准备处理当前这一轮。`
          : "正在打开抖音后台。",
  };
}

export function buildWechatGuardBlockedState(
  current: WechatBatchState,
  reason: string,
): WechatBatchState {
  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: false,
    completed: false,
    completionSummary: undefined,
    lastOutcomeTitle: "暂不发送",
    lastOutcomeDetail:
      reason || "当前微信现场联系人还没完全对齐，这一轮不会继续发送。",
  };
}

export function buildWechatMissingInputState(
  current: WechatBatchState,
): WechatBatchState {
  return {
    ...current,
    lastOutcomeTitle: "这一轮还没开始",
    lastOutcomeDetail: "请先填写目标联系人和回复内容，再继续处理。",
  };
}

export function buildWechatModeStartingState(
  current: WechatBatchState,
  params: {
    mode: WechatExecutionMode;
    contact: string;
    nextCandidate?: string;
  },
): WechatBatchState {
  const { mode, contact, nextCandidate } = params;
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    nextCandidate: nextCandidate || current.nextCandidate,
    pauseReason: undefined,
    completionSummary: undefined,
    lastOutcomeTitle:
      mode === "read-only-analyze"
        ? "正在做只读分析"
        : mode === "draft"
          ? "正在整理这一轮"
          : mode === "controlled-send"
            ? "正在准备受控发送"
            : "正在准备自动发送",
    lastOutcomeDetail:
      mode === "read-only-analyze"
        ? `当前会围绕"${contact}"只读分析现场对象与上下文，不会填写，也不会发送。`
        : mode === "draft"
          ? `正在围绕"${contact}"整理 AI 正式回复，并从真实列表里继续找下一条候选。`
          : mode === "controlled-send"
            ? `正在围绕"${contact}"准备现场正式回复，现场校验不通过会停止并说明原因。`
            : `正在围绕"${contact}"准备自动发送，只有现场校验通过才会继续。`,
  };
}

export function buildWechatDraftReadyState(
  current: WechatBatchState,
  contact: string,
): WechatBatchState {
  return {
    ...current,
    lastOutcomeTitle: "现场回复已就位",
    lastOutcomeDetail: `目标联系人"${contact}"的正式回复已经真实写入输入框，现场校验不通过会停止并说明原因。`,
  };
}

export function buildWechatDraftNotReadyState(
  current: WechatBatchState,
  detail?: string,
): WechatBatchState {
  return {
    ...current,
    lastOutcomeTitle: "现场草稿还没准备好",
    lastOutcomeDetail: detail || "微信输入框还没准备完成，这一轮先停在发送前。",
  };
}

export function buildWechatSentState(
  current: WechatBatchState,
  params: {
    contact: string;
    detail: string;
  },
): WechatBatchState {
  const { contact, detail } = params;
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    processedCount: current.processedCount + 1,
    lastProcessedContact: contact,
    completionSummary: undefined,
    lastOutcomeTitle: "上一条已真实发出",
    lastOutcomeDetail: detail,
  };
}

export function buildWechatSendFailedState(
  current: WechatBatchState,
  params: {
    mode: "controlled-send" | "auto-send";
    contact: string;
    detail?: string;
  },
): WechatBatchState {
  const { mode, contact, detail } = params;
  return {
    ...current,
    lastOutcomeTitle:
      mode === "controlled-send" ? "发送没有成功收口" : "自动发送没有成功收口",
    lastOutcomeDetail:
      detail || `目标联系人"${contact}"这一条没有完成真实发送。`,
  };
}

export function buildWechatDraftQueueState(
  current: WechatBatchState,
): WechatBatchState {
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    completionSummary: undefined,
    lastOutcomeTitle: "队列整理中",
    lastOutcomeDetail: "系统会继续处理下一条候选联系人。",
  };
}

export function buildWechatSkippedState(
  current: WechatBatchState,
  params: {
    skippedTarget?: string;
  },
): WechatBatchState {
  const { skippedTarget } = params;
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    skippedCount: (current.skippedCount || 0) + 1,
    pauseReason: undefined,
    completionSummary: undefined,
    lastOutcomeTitle: "已跳过当前对象",
    lastOutcomeDetail: skippedTarget
      ? `已明确跳过"${skippedTarget}"，当前会继续准备下一条候选。`
      : "已明确跳过当前对象，当前会继续准备下一条候选。",
  };
}

export function buildWechatTaskFailedState(
  current: WechatBatchState,
  detail?: string,
): WechatBatchState {
  return {
    ...current,
    lastOutcomeTitle: "这一轮卡住了",
    lastOutcomeDetail: detail || "微信任务执行失败，需要回到现场看原因。",
  };
}

export function buildWechatCompletedState(
  current: WechatBatchState,
): WechatBatchState {
  return {
    ...current,
    active: false,
    paused: false,
    completed: true,
    nextCandidate: "",
    pauseReason: undefined,
    completionSummary: `这一轮已经完成，累计处理 ${Math.max(1, current.processedCount)} 条${current.lastProcessedContact ? `，最后处理的是"${current.lastProcessedContact}"` : ""}${current.pausedOnce ? `，中途曾暂停过${current.lastPauseReason ? `（${current.lastPauseReason}）` : "一次"}` : "。"}当前没有新的候选联系人。`,
    lastOutcomeTitle: "这一轮已完成",
    lastOutcomeDetail: current.lastProcessedContact
      ? `最后处理的是"${current.lastProcessedContact}"，当前没有新的候选联系人，这一轮先在这里收口。`
      : "当前没有新的候选联系人，这一轮先在这里收口。",
  };
}

export function buildWechatCandidateSyncState(
  current: WechatBatchState,
  nextCandidate?: string,
): WechatBatchState {
  return {
    ...current,
    nextCandidate: nextCandidate || current.nextCandidate,
    completed: current.completed && !nextCandidate,
  };
}

export function buildDouyinPausedState(
  current: DouyinBatchState,
): DouyinBatchState {
  const pauseReason = current.nextTargetHint
    ? `已手动暂停，恢复后优先回到"${current.nextTargetHint}"。`
    : "已手动暂停，恢复后会回到当前抖音后台继续这一轮。";

  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: true,
    completed: false,
    pausedOnce: true,
    lastStopTarget: current.nextTargetHint || current.lastProcessedTarget,
    lastStopReason: pauseReason,
    pauseReason,
    lastPauseReason: pauseReason,
    lastOutcomeTitle: "抖音这一轮已暂停",
    lastOutcomeDetail: current.nextTargetHint
      ? `本轮已处理 ${Math.max(0, current.processedCount)} 条，下一条目标提示是"${current.nextTargetHint}"。`
      : `本轮已处理 ${Math.max(0, current.processedCount)} 条，恢复后会继续从当前后台列表推进。`,
  };
}

export function buildDouyinAdvancingState(
  current: DouyinBatchState,
  mode: DouyinBrowserMode,
): DouyinBatchState {
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    consecutiveSkippedOutcomes: 0,
    repeatTargetOutcomeStreak: 0,
    pauseReason: undefined,
    completionSummary: undefined,
    lastStopTarget: undefined,
    lastStopReason: undefined,
    lastOutcomeTitle:
      mode === "direct-message-reply"
        ? "正在继续下一条私信对象"
        : "正在继续下一条评论对象",
    lastOutcomeDetail: current.nextTargetHint
      ? `将优先回到"${current.nextTargetHint}"，然后继续这一轮。`
      : mode === "direct-message-reply"
        ? "将继续留在当前私信列表里定位下一条需要处理的真实会话。"
        : "将继续留在当前评论列表里定位下一条需要处理的真实评论。",
  };
}

export function buildDouyinSkippingState(
  current: DouyinBatchState,
  params: {
    mode: DouyinBrowserMode;
    target?: string;
  },
): DouyinBatchState {
  const { mode, target } = params;
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    repeatTargetOutcomeStreak: 0,
    nextTargetHint: undefined,
    pauseReason: undefined,
    completionSummary: undefined,
    lastStopTarget: undefined,
    lastStopReason: undefined,
    lastOutcomeTitle:
      mode === "direct-message-reply"
        ? "正在跳过当前私信对象"
        : "正在跳过当前评论对象",
    lastOutcomeDetail: target
      ? `正在跳过"${target}"，随后会回到后台列表继续处理下一条。`
      : "正在跳过当前对象，随后会回到后台列表继续处理下一条。",
  };
}

export function buildDouyinResumingState(
  current: DouyinBatchState,
): DouyinBatchState {
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    consecutiveSkippedOutcomes: 0,
    repeatTargetOutcomeStreak: 0,
    pauseReason: undefined,
    lastStopTarget: undefined,
    lastStopReason: undefined,
    lastOutcomeTitle: "正在恢复这一轮",
    lastOutcomeDetail: current.nextTargetHint
      ? `正在回到"${current.nextTargetHint}"继续处理这一轮。`
      : "正在回到当前抖音后台列表继续这一轮。",
  };
}

export function buildDouyinRunningState(
  current: DouyinBatchState,
  params: {
    currentTarget: string;
    stage?: DouyinStructuredStage;
  },
): DouyinBatchState {
  const { currentTarget, stage } = params;
  const shouldReset = stage === "locating_target" || stage === "drafting_reply";
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    consecutiveSkippedOutcomes: shouldReset
      ? 0
      : current.consecutiveSkippedOutcomes,
    repeatTargetOutcomeStreak: shouldReset
      ? 0
      : current.repeatTargetOutcomeStreak,
    nextTargetHint: currentTarget,
    pauseReason: undefined,
    lastStopTarget: undefined,
    lastStopReason: undefined,
  };
}

export function buildDouyinRepeatOutcomePausedState(
  current: DouyinBatchState,
  params: {
    target: string;
    repeatTargetOutcomeStreak: number;
  },
): DouyinBatchState {
  const { target, repeatTargetOutcomeStreak } = params;
  const reason = `连续收口到同一对象"${target}"，已自动暂停这一轮，请先检查页面是否真正切到了下一条。`;
  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: true,
    completed: false,
    pausedOnce: true,
    repeatTargetOutcomeStreak,
    lastStopTarget: target,
    lastStopReason: reason,
    pauseReason: reason,
    lastPauseReason: reason,
    lastOutcomeTitle: "疑似停在同一对象，已自动暂停",
    lastOutcomeDetail: `这一轮连续两次收口到"${target}"，当前先停下，避免在同一对象上空转。`,
  };
}

export function buildDouyinConsecutiveSkipPausedState(
  current: DouyinBatchState,
  params: {
    consecutiveSkippedOutcomes: number;
  },
): DouyinBatchState {
  const { consecutiveSkippedOutcomes } = params;
  const reason = `连续跳过 ${consecutiveSkippedOutcomes} 条，已自动暂停这一轮，请先检查当前筛选条件或对象质量。`;
  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: true,
    completed: false,
    pausedOnce: true,
    consecutiveSkippedOutcomes,
    lastStopTarget: current.nextTargetHint || current.lastProcessedTarget,
    lastStopReason: reason,
    pauseReason: reason,
    lastPauseReason: reason,
    lastOutcomeTitle: "连续跳过过多，已自动暂停",
    lastOutcomeDetail: current.nextTargetHint
      ? `最近停在"${current.nextTargetHint}"，连续跳过过多，恢复前建议先检查当前对象筛选。`
      : "这一轮连续跳过过多，恢复前建议先检查当前对象筛选。",
  };
}

export function buildWechatPausedState(
  current: WechatBatchState,
): WechatBatchState {
  const pauseReason = current.nextCandidate
    ? `已手动暂停，恢复后会从"${current.nextCandidate}"继续。`
    : "已手动暂停，恢复后会继续从真实列表里提取下一条候选。";

  return {
    ...current,
    active: current.active || current.processedCount > 0,
    paused: true,
    pausedOnce: true,
    pauseReason,
    lastPauseReason: pauseReason,
    lastOutcomeTitle: "这一轮已暂停",
    lastOutcomeDetail: current.nextCandidate
      ? `本轮已处理 ${Math.max(1, current.processedCount)} 条，下一条候选是"${current.nextCandidate}"。`
      : `本轮已处理 ${Math.max(1, current.processedCount)} 条，恢复后会继续从真实列表里接下一条。`,
  };
}

export function buildWechatAdvancingState(
  current: WechatBatchState,
  nextCandidate: string,
): WechatBatchState {
  return {
    ...current,
    active: true,
    paused: false,
    completed: false,
    nextCandidate,
    pauseReason: undefined,
    completionSummary: undefined,
    lastOutcomeTitle: "正在切到下一条",
    lastOutcomeDetail: `已把候选联系人"${nextCandidate}"带回作战台，正在自动对齐并准备现场草稿。`,
  };
}

export function buildWechatCandidateSelectedState(
  current: WechatBatchState,
  contact: string,
): WechatBatchState {
  return {
    ...current,
    pauseReason: undefined,
    lastOutcomeTitle: "已切到候选联系人",
    lastOutcomeDetail: `候选联系人"${contact}"已带回作战台，正在准备目标对齐。`,
  };
}

export function buildWechatAlignSucceededState(
  current: WechatBatchState,
  contact: string,
): WechatBatchState {
  return {
    ...current,
    completed: false,
    completionSummary: undefined,
    lastOutcomeTitle: "目标联系人已对齐",
    lastOutcomeDetail: `当前会话已经切到"${contact}"，可以继续准备回复。`,
  };
}

export function buildWechatAlignPendingState(
  current: WechatBatchState,
  params: {
    contact: string;
    detail: string;
  },
): WechatBatchState {
  const { contact, detail } = params;
  return {
    ...current,
    completed: false,
    completionSummary: undefined,
    lastOutcomeTitle: "目标联系人还没对齐",
    lastOutcomeDetail:
      detail ||
      `已尝试切到"${contact}"，当前仍未完成真机对齐，这一轮不会直接放行发送。`,
  };
}

export function buildWechatAlignFailedState(
  current: WechatBatchState,
  params: {
    contact: string;
    detail: string;
  },
): WechatBatchState {
  const { contact, detail } = params;
  return {
    ...current,
    completed: false,
    completionSummary: undefined,
    lastOutcomeTitle: "联系人对齐失败",
    lastOutcomeDetail: detail || `目标联系人"${contact}"对齐失败。`,
  };
}
