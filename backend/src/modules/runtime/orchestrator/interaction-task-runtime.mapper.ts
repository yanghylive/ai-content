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
  const accountId = parseOptionalNumber(task.accountId);

  return {
    task: {
      relatedId: task.id,
      relatedType: 'interaction-task',
      type,
      platform,
      accountId,
      payload: {
        targetName: task.targetName,
        targetText: task.sourceText,
        sourceText: task.sourceText,
        replyText: task.replyText,
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
              excludeAuthorKeywords:
                task.replyRule.commentExcludeAuthorKeywords,
              noiseKeywords: task.replyRule.commentNoiseKeywords,
              priorityKeywords: task.replyRule.commentPriorityKeywords,
            }
          : undefined,
      },
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

export function mapRuntimeResultToInteractionDraftResult(
  task: InteractionTask,
  result: RuntimeExecutionResult,
): InteractionExecutorDraftResult {
  return {
    ok: result.ok,
    status: mapRuntimeStatus(task, result),
    message: result.userMessage,
    evidence: mapRuntimeEvidence(result.evidence),
    nextAction: result.technicalMessage,
    readbackText: result.readback?.actualText,
    replyVisible: result.readback?.matched,
  };
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

function mapRuntimeEvidence(evidence: ExecutorEvidence[] = []) {
  const first = evidence[0];
  if (!first) {
    return undefined;
  }

  const value = first.value ?? first.path ?? JSON.stringify(first.raw ?? {});
  return {
    type:
      first.type === 'screenshot'
        ? 'screenshot'
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

function parseOptionalNumber(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
