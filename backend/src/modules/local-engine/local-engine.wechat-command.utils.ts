// local-engine 微信命令辅助层（god class 拆解阶段 1 延续——纯函数/类型提取）
// 本文件方法均无 this 依赖（只操作参数 + 模块函数），供 local-engine.service 与后续 mixin 簇调用。

import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { safeText } from '../../common/text.utils';

import type {
  InteractionReplyGeneratedBy,
  InteractionTask,
  InteractionTaskType,
  MomentsPlanMetadata,
} from './local-engine.types';
import {
  getProjectRoot,
  isDesktopInteractionTask,
  optionalTrimmedText,
} from './local-engine.utils';

export type WechatDesktopCommandResult = {
  screenshotPath?: string;
  reply?: string;
  readText?: string;
  sourceText?: string;
  generatedBy?: InteractionReplyGeneratedBy;
  message?: string;
  contact?: string;
  target?: string;
  currentWechatId?: string;
  plannedWechatId?: string;
  mode?: string;
  status?: string;
  errorCode?: string;
  nextAction?: string;
  output?: unknown;
  diagnostics?: unknown;
  raw?: Record<string, unknown>;
};

export type WechatMomentsVisibilityCode = 'public' | 'private' | 'partial';

export type ApprovedWechatTargetResult = {
  target: string;
  ok: boolean;
  message: string;
  screenshotPath?: string;
  result?: WechatDesktopCommandResult;
};

export type ApprovedWechatTaskResult = {
  ok: boolean;
  status?: 'no_target' | 'blocked';
  message: string;
  nextAction?: string;
  screenshotPath?: string;
  completedTargets?: string[];
  failedTargets?: Array<{ targetName: string; reason?: string }>;
  skippedTargets?: string[];
  pendingTargets?: string[];
  results?: ApprovedWechatTargetResult[];
  readbackText?: string;
  sourceText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
};

export type MomentsPlanState = Required<
  Pick<MomentsPlanMetadata, 'dailyPublished' | 'dailyQuota'>
> &
  Pick<
    MomentsPlanMetadata,
    | 'scheduleStartTime'
    | 'autoLike'
    | 'autoComment'
    | 'recordSummary'
    | 'prompts'
  > & {
    remainingToday: number;
  };

export const WECHAT_NATIVE_COMMAND_RUNNER_LABELS: Record<string, string> = {
  'group-broadcast': '群发',
  'contact-add': '加好友',
  'friend-accept': '通过好友',
  'moments-publish': '朋友圈发布',
  'moments-marketing': '朋友圈营销',
  'chat-history': '会话历史',
};

export class WechatDesktopCommandError extends Error {
  constructor(
    message: string,
    readonly result: WechatDesktopCommandResult = {},
  ) {
    super(message);
    this.name = 'WechatDesktopCommandError';
  }
}

export function readMetadataStringList(
  value: unknown,
  fallback: string[],
  max: number,
) {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, max);
    return normalized.length ? normalized : fallback;
  }
  if (typeof value === 'string') {
    const normalized = value
      .split(/[\n,，、]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, max);
    return normalized.length ? normalized : fallback;
  }
  return fallback;
}

export function readMetadataPositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.min(Math.floor(numeric), max);
}

export function readMetadataTargetCommentMap(value: unknown) {
  const map = new Map<string, string>();
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const targetName = optionalTrimmedText(
        record.targetName ?? record.target ?? record.name,
      );
      const commentText = optionalTrimmedText(
        record.commentText ?? record.replyText ?? record.comment,
      );
      if (targetName && commentText) {
        map.set(targetName, commentText);
      }
    }
    return map;
  }
  if (value && typeof value === 'object') {
    for (const [targetName, commentText] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalizedTarget = targetName.trim();
      const normalizedComment = optionalTrimmedText(commentText);
      if (normalizedTarget && normalizedComment) {
        map.set(normalizedTarget, normalizedComment);
      }
    }
  }
  return map;
}

export function readMomentsMarketingActions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { like: true, comment: true };
  }
  const record = value as Record<string, unknown>;
  return {
    like: record.like !== false,
    comment: record.comment !== false,
  };
}

export function readWechatTargetMessageMap(task: InteractionTask) {
  const map = new Map<string, string>();
  for (const target of task.batchTargets || []) {
    const targetName = optionalTrimmedText(target.targetName);
    const message = optionalTrimmedText(target.replyText);
    if (targetName && message) map.set(targetName, message);
  }
  const metadataValue =
    task.metadata?.wechat_group_messages ??
    task.metadata?.wechat_mass_send_contents;
  if (!Array.isArray(metadataValue)) return map;
  for (const item of metadataValue) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const targetName = optionalTrimmedText(
      record.target ?? record.targetName ?? record.contact,
    );
    const message = optionalTrimmedText(
      record.message ?? record.sendContent ?? record.replyText,
    );
    if (targetName && message) map.set(targetName, message);
  }
  return map;
}

export function compactWechatContactSyncOutput(
  value: string,
  maxLength = 1200,
) {
  const text = String(value || '')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(-maxLength);
}

export function findLastJsonLine(stdout: string) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith('{') && line.endsWith('}')) {
      return line;
    }
  }
  const joined = lines.join('\n');
  const start = joined.lastIndexOf('{');
  const end = joined.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return joined.slice(start, end + 1).trim();
  }
  return undefined;
}

export function getRuntimePlatform() {
  return platform();
}

export function assertMomentsScheduleReady(plan: MomentsPlanState) {
  if (!plan.scheduleStartTime) return;
  const timestamp = Date.parse(plan.scheduleStartTime);
  if (!Number.isFinite(timestamp)) return;
  if (timestamp > Date.now()) {
    throw new Error(
      `朋友圈计划尚未到开始时间：${plan.scheduleStartTime}，请到点后继续执行。`,
    );
  }
}

export function assertMomentsVisibilityExecutable(
  visibility: WechatMomentsVisibilityCode,
  label: string,
) {
  if (visibility === 'public') return;
  throw new Error(
    `当前不能自动设置朋友圈可见范围「${label || visibility}」，本条没有发布。请改为公开可见或由人工发布。`,
  );
}

export function assertWechatDesktopResultProof(input: {
  taskType: InteractionTaskType;
  target: string;
  expectedText?: string;
  result: WechatDesktopCommandResult;
}) {
  const screenshotPath = optionalTrimmedText(input.result.screenshotPath);
  const targetText = optionalTrimmedText(input.target);
  const expectedText = optionalTrimmedText(input.expectedText);
  const syntheticMomentsTarget =
    input.taskType === 'wechat-moments-marketing' &&
    Boolean(targetText) &&
    /^朋友圈第\s*\d+\s*条$/.test(targetText || '');
  const proofText = [
    input.result.contact,
    input.result.target,
    input.result.reply,
    input.result.readText,
    input.result.message,
    input.result.status,
  ]
    .filter(Boolean)
    .join('\n');

  if (!screenshotPath) {
    throw new WechatDesktopCommandError(
      '微信桌面执行缺少截图证据，不能算商用完成。',
      input.result,
    );
  }
  if (!proofText.trim()) {
    throw new WechatDesktopCommandError(
      '微信桌面执行缺少目标/回读文本，不能算商用完成。',
      input.result,
    );
  }
  if (
    targetText &&
    input.taskType !== 'wechat-moments-publish' &&
    !syntheticMomentsTarget &&
    !proofText.includes(targetText)
  ) {
    throw new WechatDesktopCommandError(
      `微信桌面执行结果没有回读目标“${targetText}”，不能算商用完成。`,
      input.result,
    );
  }
  if (
    expectedText &&
    input.taskType !== 'wechat-contact-add' &&
    !proofText.includes(expectedText)
  ) {
    throw new WechatDesktopCommandError(
      '微信桌面执行结果没有回读待发送/待发布文本，不能算商用完成。',
      input.result,
    );
  }
}

export function buildMomentsPlanReadback(plan: MomentsPlanState) {
  return [
    `今日已发布/互动：${plan.dailyPublished}/${plan.dailyQuota}`,
    plan.scheduleStartTime ? `计划开始时间：${plan.scheduleStartTime}` : '',
    plan.autoLike !== undefined
      ? `自动点赞：${plan.autoLike ? '开启' : '关闭'}`
      : '',
    plan.autoComment !== undefined
      ? `自动评论：${plan.autoComment ? '开启' : '关闭'}`
      : '',
    plan.recordSummary ? `记录摘要：${plan.recordSummary}` : '',
    plan.prompts?.length ? `Prompt 配置：${plan.prompts.length} 条` : '',
  ]
    .filter(Boolean)
    .join('；');
}

export function buildWechatDesktopReadback(
  label: string,
  target: string,
  text: string,
  result?: WechatDesktopCommandResult,
) {
  const actualTarget = result?.contact || result?.target || target;
  const modeLabel =
    result?.mode === 'auto-send'
      ? '已自动执行'
      : result?.mode === 'approval'
        ? '已写入并等待继续执行'
        : '已处理';
  const body = result?.readText || result?.reply || result?.message || text;
  return `${label}${modeLabel}：${actualTarget} / ${body}`;
}

export function resolveWechatAccountProtection(task: InteractionTask): {
  associatedWeChat?: string;
  currentWechatId?: string;
  warning?: string;
  blocker?: string;
} {
  if (!isDesktopInteractionTask(task.type)) {
    return {};
  }
  const metadata = task.metadata || {};
  const associatedWeChat =
    optionalTrimmedText(task.associatedWeChat) ||
    optionalTrimmedText(task.plannedWechatId) ||
    optionalTrimmedText(metadata.associatedWeChat) ||
    optionalTrimmedText(metadata.associated_wechat) ||
    optionalTrimmedText(metadata.plannedWechatId) ||
    optionalTrimmedText(metadata.planned_wechat_id);
  if (!associatedWeChat) {
    return {};
  }
  const currentWechatId =
    optionalTrimmedText(task.currentWechatId) ||
    optionalTrimmedText(metadata.currentWechatId) ||
    optionalTrimmedText(metadata.current_wechat_id) ||
    optionalTrimmedText(metadata.currentWeChat) ||
    optionalTrimmedText(metadata.current_wechat);
  if (!currentWechatId) {
    return {
      associatedWeChat,
      blocker: `微信号保护阻断：计划关联微信号为 ${associatedWeChat}，但当前微信号不可读取；无法确认登录账号时禁止执行。`,
    };
  }
  if (currentWechatId !== associatedWeChat) {
    return {
      associatedWeChat,
      currentWechatId,
      blocker: `微信号保护阻断：计划关联微信号为 ${associatedWeChat}，当前微信号为 ${currentWechatId}，不一致时禁止执行。`,
    };
  }
  return { associatedWeChat, currentWechatId };
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function toWechatDesktopCommandError(error: unknown) {
  if (error instanceof WechatDesktopCommandError) {
    return error;
  }
  if (
    error instanceof Error &&
    error.name === 'WechatDesktopCommandError' &&
    typeof (error as { result?: unknown }).result === 'object' &&
    (error as { result?: unknown }).result !== null
  ) {
    return error as WechatDesktopCommandError;
  }
  return null;
}

export function readMomentsPublishDetails(task: InteractionTask) {
  const detailValue =
    task.metadata?.momentsDetails ?? task.metadata?.wechat_moments_details;
  const details: Array<{
    targetName: string;
    content: string;
    additionalComment: string;
    attachments: string[];
    scheduledPublishTime?: string;
    visibility: WechatMomentsVisibilityCode;
    visibilityLabel: string;
  }> = [];
  if (Array.isArray(detailValue)) {
    for (const [index, item] of detailValue.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const content = optionalTrimmedText(
        record.content ??
          record.sendContent ??
          record.replyText ??
          record.wechat_moments_content,
      );
      const attachments = this.readMetadataStringList(
        record.attachments ?? record.assetPaths ?? record.assetPath,
        [],
        9,
      );
      details.push({
        targetName:
          optionalTrimmedText(record.targetName) ||
          optionalTrimmedText(task.batchTargets?.[index]?.targetName) ||
          `朋友圈明细 ${index + 1}`,
        content: content || '',
        additionalComment:
          optionalTrimmedText(record.additionalComment ?? record.comment) || '',
        attachments,
        scheduledPublishTime: optionalTrimmedText(
          record.scheduledPublishTime ?? record.scheduledAt,
        ),
        visibility: this.normalizeMomentsVisibility(
          record.visibility ??
            record.wechat_moments_visibility ??
            task.metadata?.wechat_moments_visibility_code ??
            task.metadata?.wechat_moments_visibility,
        ),
        visibilityLabel:
          optionalTrimmedText(
            record.visibility ?? record.wechat_moments_visibility,
          ) ||
          optionalTrimmedText(task.metadata?.wechat_moments_visibility) ||
          '公开',
      });
    }
  }
  if (details.length) {
    return details;
  }
  const content =
    optionalTrimmedText(
      task.metadata?.content ?? task.metadata?.wechat_moments_content,
    ) ||
    optionalTrimmedText(task.replyText) ||
    '';
  const attachments = this.readMetadataStringList(
    task.metadata?.assetPaths ??
      task.metadata?.attachments ??
      task.metadata?.assetPath ??
      task.metadata?.wechat_moments_asset_path,
    [],
    9,
  );
  return [
    {
      targetName:
        optionalTrimmedText(task.batchTargets?.[0]?.targetName) ||
        task.targetName ||
        '朋友圈明细 1',
      content,
      additionalComment:
        optionalTrimmedText(
          task.metadata?.additionalComment ??
            task.metadata?.wechat_moments_additional_comment,
        ) || '',
      attachments,
      scheduledPublishTime: optionalTrimmedText(
        task.metadata?.scheduleStartTime ??
          task.metadata?.wechat_moments_schedule_start_time,
      ),
      visibility: this.normalizeMomentsVisibility(
        task.metadata?.wechat_moments_visibility_code ??
          task.metadata?.wechat_moments_visibility,
      ),
      visibilityLabel:
        optionalTrimmedText(task.metadata?.wechat_moments_visibility) || '公开',
    },
  ];
}

export function buildApprovedWechatReadback(
  label: string,
  results: ApprovedWechatTargetResult[],
) {
  return results
    .filter((item) => item.ok)
    .map((item) =>
      this.buildWechatDesktopReadback(
        label,
        item.target,
        item.result?.reply || item.result?.readText || item.message,
        item.result,
      ),
    )
    .filter(Boolean)
    .join('\n');
}

export function readMomentsPlanState(
  metadata: Record<string, unknown> | undefined,
  fallbackDailyQuota: number,
): MomentsPlanState {
  const dailyPublished = this.readMetadataPositiveInteger(
    metadata?.dailyPublished ?? metadata?.wechat_moments_daily_published,
    0,
    10000,
  );
  const dailyQuota = this.readMetadataPositiveInteger(
    metadata?.dailyQuota ?? metadata?.wechat_moments_daily_quota,
    fallbackDailyQuota,
    10000,
  );
  return {
    dailyPublished,
    dailyQuota,
    remainingToday: Math.max(0, dailyQuota - dailyPublished),
    scheduleStartTime: optionalTrimmedText(
      metadata?.scheduleStartTime ??
        metadata?.wechat_moments_schedule_start_time,
    ),
    autoLike:
      typeof metadata?.autoLike === 'boolean'
        ? metadata.autoLike
        : typeof metadata?.wechat_moments_auto_like === 'boolean'
          ? metadata.wechat_moments_auto_like
          : undefined,
    autoComment:
      typeof metadata?.autoComment === 'boolean'
        ? metadata.autoComment
        : typeof metadata?.wechat_moments_auto_comment === 'boolean'
          ? metadata.wechat_moments_auto_comment
          : undefined,
    recordSummary: optionalTrimmedText(
      metadata?.recordSummary ?? metadata?.wechat_moments_record_summary,
    ),
    prompts: this.normalizeMomentsPromptConfig(
      metadata?.prompts ?? metadata?.wechat_moments_prompts,
    ),
  };
}

export function normalizeMomentsVisibility(
  value: unknown,
): WechatMomentsVisibilityCode {
  const normalized = safeText(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'private' || normalized === '私密') return 'private';
  if (
    normalized === 'partial' ||
    normalized === '部分可见' ||
    normalized === '不给谁看'
  ) {
    return 'partial';
  }
  return 'public';
}

export function normalizeMomentsPromptConfig(
  value: unknown,
): MomentsPlanMetadata['prompts'] {
  if (!Array.isArray(value)) return undefined;
  const prompts: NonNullable<MomentsPlanMetadata['prompts']> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const prompt = optionalTrimmedText(record.prompt);
    if (!prompt) continue;
    prompts.push({
      key: optionalTrimmedText(record.key),
      title: optionalTrimmedText(record.title),
      prompt,
      enabled: record.enabled !== false,
    });
    if (prompts.length >= 20) break;
  }
  return prompts.length ? prompts : undefined;
}

export function resolveFirstExistingLocalPath(
  candidates: Array<string | undefined>,
) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) {
      continue;
    }
    if (existsSync(value)) {
      return value;
    }
  }
  return '';
}

export function resolveWechatNativeRuntimePath(): string {
  return resolveFirstExistingLocalPath([
    process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME,
    join(
      process.cwd(),
      'wechat-native-runtime',
      'kaypal-wechat-native-runtime.exe',
    ),
    join(
      process.cwd(),
      'wechat-native-runtime',
      'kaypal-wechat-native-runtime.js',
    ),
    join(process.cwd(), 'kaypal-wechat-native-runtime.exe'),
    join(process.cwd(), 'kaypal-wechat-native-runtime.js'),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-native-runtime',
      'kaypal-wechat-native-runtime.exe',
    ),
    join(
      getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-native-runtime',
      'kaypal-wechat-native-runtime.js',
    ),
  ]);
}

export function normalizeAiInteractionReply(output: string) {
  const cleaned = String(output || '')
    .replace(/^```(?:text|markdown|json)?/i, '')
    .replace(/```$/i, '')
    .replace(/^回复[:：]\s*/i, '')
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (
    /保证治好|最低价|绝对有效|返现|私下转账|加微信|留电话|马上安排专人|尊敬的客户|亲亲|亲爱的|作为AI|我是AI/i.test(
      cleaned,
    )
  ) {
    return '';
  }
  return cleaned.slice(0, 160);
}
