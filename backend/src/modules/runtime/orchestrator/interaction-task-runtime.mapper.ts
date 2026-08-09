import type { BackendRiskContext } from '../../auth/risk-control';
import type {
  InteractionExecutorDraftResult,
  InteractionTask,
} from '../../local-engine/local-engine.types';
import type {
  ExecutorContext,
  ExecutorEvidence,
  ExecutorTask,
  ExecutorTaskPlatform,
  ExecutorTaskType,
  RuntimeExecutionResult,
} from '../executor.interface';

const BROWSER_TASK_PLATFORMS: Partial<
  Record<ExecutorTaskType, ExecutorTaskPlatform>
> = {
  'douyin-comment-reply': 'douyin',
  'douyin-direct-message-reply': 'douyin',
  'wechat-channel-comment-reply': 'wechat-channel',
  'wechat-channel-direct-message-reply': 'wechat-channel',
};

export function mapInteractionTaskToRuntimeInput(
  task: InteractionTask,
  riskContext?: BackendRiskContext,
): { task: ExecutorTask; ctx: ExecutorContext } {
  const type = task.type as ExecutorTaskType;
  const platform = BROWSER_TASK_PLATFORMS[type] ?? 'wechat-desktop';
  const accountId = task.accountId ?? undefined;
  const payload = {
    ...(task.metadata && typeof task.metadata === 'object'
      ? task.metadata
      : {}),
    ...buildDesktopWechatRuntimePayload(task),
    targetName: task.targetName,
    targetText: task.sourceText,
    sourceText: task.sourceText,
    sourceUrl: task.sourceUrl,
    profileUrl: task.profileUrl,
    commentTime: task.commentTime,
    videoTitle: task.videoTitle,
    videoUrl: task.videoUrl,
    engagementScore: task.engagementScore,
    replyText: task.replyText,
    replyGeneratedBy: task.replyGeneratedBy,
    reply_generated_by: task.replyGeneratedBy,
    accountName: task.accountName,
    platformType: task.platformType,
    platformName: task.platformName,
    followUpMethod: task.followUpMethod,
    parsingRules: task.replyRule
      ? {
          mode: task.replyRule.commentParsingMode,
          preset: task.replyRule.commentRulePreset,
          requireActionAndTime: task.replyRule.commentRequireActionAndTime,
          allowShortText: task.replyRule.commentAllowShortText,
          skipHandled: task.replyRule.commentSkipHandled,
          questionOnly: task.replyRule.commentQuestionOnly,
          minLength: task.replyRule.commentMinLength,
          maxLength: task.replyRule.commentMaxLength,
          whitelistKeywords: task.replyRule.commentWhitelistKeywords,
          excludeAuthorKeywords: task.replyRule.commentExcludeAuthorKeywords,
          noiseKeywords: task.replyRule.commentNoiseKeywords,
          priorityKeywords: task.replyRule.commentPriorityKeywords,
        }
      : undefined,
  };

  return {
    task: {
      relatedId: task.id,
      relatedType: 'interaction-task',
      type,
      platform,
      accountId,
      payload,
    },
    ctx: {
      riskContext:
        riskContext ??
        ({
          accountId: task.accountId,
          accountName: task.accountName,
          deviceName: 'local-engine',
        } satisfies BackendRiskContext),
      sendMode: task.sendMode === 'auto-send' ? 'auto-send' : 'draft-only',
    },
  };
}

function buildDesktopWechatRuntimePayload(task: InteractionTask) {
  if (!task.type.startsWith('wechat-')) {
    return {};
  }
  const targets = task.batchTargets?.length
    ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
    : [task.targetName].filter(Boolean);
  const firstTarget = targets[0] || task.targetName;
  const batchTargetMessages = (task.batchTargets || [])
    .map((target) => ({
      targetName: target.targetName?.trim(),
      sendContent: target.replyText?.trim() || task.replyText?.trim(),
    }))
    .filter((item): item is { targetName: string; sendContent: string } =>
      Boolean(item.targetName && item.sendContent),
    );
  const targetMessages = batchTargetMessages.length
    ? batchTargetMessages
    : readTargetMessages(task);
  const common = {
    wechat_reply_mode: task.sendMode === 'auto-send' ? 'auto-send' : 'approval',
    wechat_reply_draft: task.replyText,
    commercialExecutionRequested:
      task.safetyBoundary?.requestedCommercialExecution === true,
    commercialExecutionAllowed:
      task.safetyBoundary?.commercialExecutionAllowed === true,
  };

  switch (task.type) {
    case 'wechat-reply-draft':
      return {
        ...common,
        skill_id: 'wechat.session.auto_reply',
        wechat_contact_name: firstTarget,
        wechat_expected_contact_name: firstTarget,
      };
    case 'wechat-group-broadcast':
      return {
        ...common,
        skill_id: 'wechat-group-broadcast',
        wechat_group_targets: targets,
        wechat_mass_send_contents: targetMessages,
        wechat_group_messages: targetMessages.map((item) => ({
          target: item.targetName,
          message: item.sendContent,
        })),
      };
    case 'wechat-friend-accept':
      return {
        ...common,
        skill_id: 'wechat.friend.accept',
        wechat_friend_accept_remark_strategy: readMetadataString(task, [
          'wechat_friend_accept_remark_strategy',
          'remarkStrategy',
        ]),
        wechat_friend_accept_remark_content: readMetadataString(task, [
          'wechat_friend_accept_remark_content',
          'remarkContent',
        ]),
        wechat_friend_accept_welcome_message: readMetadataString(task, [
          'wechat_friend_accept_welcome_message',
          'welcomeMessage',
        ]),
        wechat_friend_accept_match_keywords: readMetadataValue(task, [
          'wechat_friend_accept_match_keywords',
          'matchKeywords',
        ]),
        wechat_friend_accept_daily_limit: readMetadataNumber(task, [
          'wechat_friend_accept_daily_limit',
          'dailyLimit',
        ]),
      };
    case 'wechat-contact-add':
      return {
        ...common,
        skill_id: 'wechat-contact-add',
        wechat_contact_add_targets: targets,
        wechat_contact_add_verify_message: task.replyText,
      };
    case 'wechat-moments-publish': {
      const momentsDetails = readMomentsDetails(task);
      const firstMoment = momentsDetails[0];
      return {
        ...common,
        skill_id: 'wechat-moments-publish',
        wechat_moments_details: momentsDetails,
        momentsDetails,
        wechat_moments_content:
          readRecordString(firstMoment, ['content']) ||
          task.replyText ||
          task.sourceText,
        wechat_moments_asset_path:
          readRecordStringList(firstMoment, ['attachments', 'assetPaths'])[0] ||
          readMetadataString(task, [
            'wechat_moments_asset_path',
            'assetPath',
            'asset_path',
            'materialPath',
            'imagePath',
            'videoPath',
          ]),
        wechat_moments_visibility:
          readRecordString(firstMoment, ['visibility']) ||
          readMetadataString(task, ['wechat_moments_visibility', 'visibility']),
        wechat_moments_visibility_code: readMetadataString(task, [
          'wechat_moments_visibility_code',
          'visibilityCode',
        ]),
      };
    }
    case 'wechat-moments-marketing': {
      const marketingMode =
        readMetadataString(task, [
          'wechat_moments_marketing_mode',
          'marketingMode',
        ]) || (targets.length ? 'targeted' : 'random');
      const marketingContacts = marketingMode === 'targeted' ? targets : [];
      return {
        ...common,
        skill_id: 'wechat-moments-marketing',
        wechat_moments_marketing_mode: marketingMode,
        wechat_moments_marketing_contacts: marketingContacts,
        wechat_moments_marketing_content: task.replyText || task.sourceText,
        wechat_moments_marketing_fixed_comment: task.replyText,
        wechat_moments_marketing_comment_mode:
          readMetadataString(task, [
            'wechat_moments_marketing_comment_mode',
            'commentMode',
          ]) || 'fixed',
        wechat_moments_marketing_random_browse_count:
          readMetadataNumber(task, [
            'wechat_moments_marketing_random_browse_count',
            'randomBrowseCount',
          ]) ||
          (marketingMode === 'targeted' ? marketingContacts.length : 0) ||
          1,
        wechat_moments_marketing_daily_limit:
          readMetadataNumber(task, [
            'wechat_moments_marketing_daily_limit',
            'dailyViewLimit',
            'dailyLimit',
          ]) ||
          (marketingMode === 'targeted' ? marketingContacts.length : 0) ||
          1,
        wechat_moments_marketing_actions: readMetadataValue(task, [
          'wechat_moments_marketing_actions',
          'actions',
        ]) || { like: true, comment: true },
        wechat_moments_marketing_target_comments: readMetadataValue(task, [
          'wechat_moments_marketing_target_comments',
          'targetComments',
        ]),
      };
    }
    default:
      return {};
  }
}

function readMomentsDetails(
  task: InteractionTask,
): Array<Record<string, unknown>> {
  const value = readMetadataValue(task, [
    'wechat_moments_details',
    'momentsDetails',
  ]);
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item)),
    )
    .slice(0, 100)
    .map((item) => ({ ...item }));
}

function readTargetMessages(task: InteractionTask) {
  const value = readMetadataValue(task, [
    'wechat_mass_send_contents',
    'wechat_group_messages',
  ]);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const targetName = readRecordString(record, [
      'targetName',
      'target',
      'contact',
    ]);
    const sendContent = readRecordString(record, [
      'sendContent',
      'message',
      'replyText',
    ]);
    return targetName && sendContent ? [{ targetName, sendContent }] : [];
  });
}

function readRecordString(
  record: Record<string, unknown> | undefined,
  keys: string[],
) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readRecordStringList(
  record: Record<string, unknown> | undefined,
  keys: string[],
) {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) return [value.trim()];
  }
  return [];
}

function readMetadataValue(task: InteractionTask, keys: string[]) {
  const metadata = task.metadata || {};
  for (const key of keys) {
    const value = metadata[key];
    if (value != null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function readMetadataString(task: InteractionTask, keys: string[]) {
  const value = readMetadataValue(task, keys);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readMetadataNumber(task: InteractionTask, keys: string[]) {
  const value = readMetadataValue(task, keys);
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.floor(numeric)
    : undefined;
}

export function mapRuntimeResultToInteractionDraftResult(
  task: InteractionTask,
  result: RuntimeExecutionResult,
): InteractionExecutorDraftResult {
  const primaryBlocker =
    !result.ok && result.blockers?.length ? result.blockers[0]?.trim() : '';
  const message =
    primaryBlocker && !result.userMessage.includes(primaryBlocker)
      ? `${result.userMessage} ${primaryBlocker}`
      : result.userMessage;
  const nextAction = result.ok
    ? result.technicalMessage || '已完成，可在任务证据里查看发送和回读结果。'
    : result.technicalMessage || primaryBlocker || undefined;
  return {
    ok: result.ok,
    status: mapRuntimeStatus(task, result),
    message,
    failureReason: result.ok ? undefined : message,
    evidence: mapRuntimeEvidence(result.evidence, task),
    nextAction,
    readbackText: result.readback?.actualText,
    replyVisible: result.readback?.matched,
    targetText: result.targetText || result.sourceText,
    sourceText: result.sourceText || result.targetText,
    replyText: result.replyText,
    replyGeneratedBy: result.replyGeneratedBy,
    runtimeMode:
      result.runtime.executor === 'browser-cdp'
        ? 'persistent-cdp-browser'
        : result.runtime.executor === 'desktop-agent-s'
          ? 'desktop-agent-s'
          : result.runtime.mode,
    ...mapRuntimeBatchTargets(result),
  };
}

function mapRuntimeBatchTargets(
  result: RuntimeExecutionResult,
): Pick<
  InteractionExecutorDraftResult,
  'completedTargets' | 'failedTargets' | 'skippedTargets' | 'pendingTargets'
> {
  const resultRecord =
    result.result &&
    typeof result.result === 'object' &&
    !Array.isArray(result.result)
      ? result.result
      : {};
  const rawResults = Array.isArray(resultRecord.results)
    ? (resultRecord.results as Array<unknown>)
    : [];
  const completedTargets: string[] = [];
  const failedTargets: Array<{ targetName: string; reason?: string }> = [];
  for (const rawResult of rawResults) {
    if (
      !rawResult ||
      typeof rawResult !== 'object' ||
      Array.isArray(rawResult)
    ) {
      continue;
    }
    const item = rawResult as Record<string, unknown>;
    const targetName = readRuntimeString(item.target);
    if (!targetName) {
      continue;
    }
    if (item.ok === false) {
      failedTargets.push({
        targetName,
        reason: readRuntimeString(item.message),
      });
    } else {
      completedTargets.push(targetName);
    }
  }
  const pendingTargets = Array.isArray(resultRecord.pendingTargets)
    ? (resultRecord.pendingTargets as Array<unknown>)
        .map(readRuntimeString)
        .filter(Boolean)
    : [];
  return {
    ...(completedTargets.length ? { completedTargets } : {}),
    ...(failedTargets.length ? { failedTargets } : {}),
    ...(pendingTargets.length ? { pendingTargets } : {}),
  };
}

function readRuntimeString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function mapRuntimeStatus(
  task: InteractionTask,
  result: RuntimeExecutionResult,
): InteractionExecutorDraftResult['status'] {
  if (result.ok) {
    return task.sendMode === 'auto-send' ? 'sent' : 'draft_filled';
  }

  switch (result.reasonCode) {
    case 'target_not_found':
      return task.type.includes('direct-message')
        ? 'message_missing'
        : 'comment_missing';
    case 'account_not_logged_in':
    case 'captcha_required':
    case 'runtime_unavailable':
    case 'platform_changed':
      return 'editor_missing';
    case 'permission_missing':
      return task.type.startsWith('wechat-')
        ? 'desktop_permission_missing'
        : 'editor_missing';
    case 'agent_s_unavailable':
      return 'wechat_missing';
    case 'review_required':
      return 'unsupported';
    case 'send_failed':
    case 'readback_failed':
    case 'success':
    default:
      return 'send_failed';
  }
}

function mapRuntimeEvidence(
  evidence: ExecutorEvidence[] = [],
  task?: InteractionTask,
) {
  const first = evidence[0];
  if (!first) {
    return undefined;
  }

  const value = first.value ?? first.path ?? JSON.stringify(first.raw ?? {});
  return {
    type:
      first.type === 'screenshot'
        ? task?.type.startsWith('wechat-')
          ? 'desktop_screenshot'
          : 'screenshot'
        : first.type === 'agent-s-trajectory' ||
            first.type === 'agent-s-action-log'
          ? 'stage_log'
          : 'text',
    label: first.label,
    value,
    artifactUrl: first.path,
    createdAt: first.createdAt,
  } as const;
}
