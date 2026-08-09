/**
 * plan 元数据簇 mixin（群发/朋友圈计划元数据归一）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import {
  createId,
  isDesktopInteractionTask,
  optionalNumber,
  optionalTrimmedText,
} from './local-engine.utils';
import {
  normalizeMomentsPromptConfig,
  readMetadataPositiveInteger,
} from './local-engine.wechat-command.utils';
import type {
  CreateInteractionTaskInput,
  InteractionBatchTarget,
  InteractionReplyRuleConfig,
  InteractionSendMode,
  InteractionTaskStatus,
  InteractionTaskType,
} from './local-engine.types';

/** plan 元数据簇的 host 接口 */
export interface PlanMetadataHost {
  normalizeGroupBroadcastPlanMetadata(
    input: Partial<CreateInteractionTaskInput>,
    now?: unknown,
  ): Record<string, unknown>;
  defaultWechatPlanName(
    type: InteractionTaskType | undefined,
    now: string,
  ): string;
  resolveWechatPlanKind(type: InteractionTaskType | undefined): string;
  resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  );
  normalizeMomentsPlanMetadata(
    input: CreateInteractionTaskInput,
  ): Record<string, unknown> | undefined;
  normalizeBatchTargets(
    input: CreateInteractionTaskInput,
    now: string,
  ): InteractionBatchTarget[];
  normalizeRuleNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  );
  buildReplyFromRule(
    sourceText: string,
    context?: { targetName?: string; accountName?: string },
    replyRule?: InteractionReplyRuleConfig,
  ): string;
  isSendMode(value: unknown): value is InteractionSendMode;
}

export function normalizeGroupBroadcastPlanMetadata(
  this: PlanMetadataHost,
  input: Partial<CreateInteractionTaskInput>,
  now = new Date().toISOString(),
): Record<string, unknown> {
  const metadata =
    input.metadata && typeof input.metadata === 'object'
      ? { ...input.metadata }
      : {};
  const currentWechatId =
    optionalTrimmedText(input.currentWechatId) ||
    optionalTrimmedText(metadata.currentWechatId) ||
    optionalTrimmedText(metadata.current_wechat_id);
  const plannedWechatId =
    optionalTrimmedText(input.plannedWechatId) ||
    optionalTrimmedText(input.associatedWeChat) ||
    optionalTrimmedText(metadata.plannedWechatId) ||
    optionalTrimmedText(metadata.planned_wechat_id) ||
    optionalTrimmedText(metadata.associatedWeChat) ||
    optionalTrimmedText(metadata.associated_wechat);
  if (currentWechatId) {
    metadata.currentWechatId = currentWechatId;
  }
  if (plannedWechatId) {
    metadata.plannedWechatId = plannedWechatId;
    metadata.associatedWeChat =
      optionalTrimmedText(metadata.associatedWeChat) || plannedWechatId;
  }

  if (!input.type || !isDesktopInteractionTask(input.type)) {
    return metadata;
  }

  const planName =
    optionalTrimmedText(input.planName) ||
    optionalTrimmedText(metadata.planName) ||
    optionalTrimmedText(metadata.wechat_plan_name) ||
    optionalTrimmedText(metadata.messageSendPlanName) ||
    optionalTrimmedText(metadata.message_send_plan_name) ||
    this.defaultWechatPlanName(input.type, now);
  const planTime =
    optionalTrimmedText(input.planTime) ||
    optionalTrimmedText(metadata.planTime) ||
    optionalTrimmedText(metadata.wechat_plan_time) ||
    optionalTrimmedText(metadata.wechat_plan_schedule_start_time) ||
    optionalTrimmedText(metadata.scheduledAt) ||
    optionalTrimmedText(metadata.scheduleStartTime) ||
    optionalTrimmedText(metadata.wechat_moments_schedule_start_time) ||
    optionalTrimmedText(metadata.message_send_plan_time);
  const dailyLimit =
    optionalNumber(input.dailyLimit) ??
    optionalNumber(metadata.dailyLimit) ??
    optionalNumber(metadata.wechat_plan_daily_limit) ??
    optionalNumber(metadata.wechat_group_daily_limit) ??
    optionalNumber(metadata.wechat_contact_add_daily_limit) ??
    optionalNumber(metadata.wechat_moments_marketing_daily_limit) ??
    optionalNumber(metadata.dailyViewLimit);
  const associatedWeChat =
    optionalTrimmedText(input.associatedWeChat) ||
    optionalTrimmedText(metadata.associatedWeChat) ||
    optionalTrimmedText(metadata.associated_wechat) ||
    optionalTrimmedText(metadata.wechat_plan_associated_wechat_id) ||
    optionalTrimmedText(metadata.wechat_plan_associated_wechat_name);
  const associatedWeChatName =
    optionalTrimmedText(metadata.associatedWeChatName) ||
    optionalTrimmedText(metadata.associated_wechat_name) ||
    optionalTrimmedText(metadata.wechat_plan_associated_wechat_name) ||
    optionalTrimmedText(input.accountName);
  const generateOnDemand =
    typeof input.generateOnDemand === 'boolean'
      ? input.generateOnDemand
      : typeof metadata.generateOnDemand === 'boolean'
        ? metadata.generateOnDemand
        : typeof metadata.generate_on_demand === 'boolean'
          ? metadata.generate_on_demand
          : undefined;
  const planKind = this.resolveWechatPlanKind(input.type);
  const minIntervalSeconds =
    optionalNumber(input.minIntervalSeconds) ??
    optionalNumber(metadata.minIntervalSeconds) ??
    optionalNumber(metadata.wechat_contact_add_min_interval_seconds);
  const maxIntervalSeconds =
    optionalNumber(input.maxIntervalSeconds) ??
    optionalNumber(metadata.maxIntervalSeconds) ??
    optionalNumber(metadata.wechat_contact_add_max_interval_seconds);
  const verifyMessage =
    optionalTrimmedText(input.verifyMessage) ||
    optionalTrimmedText(metadata.verifyMessage) ||
    optionalTrimmedText(metadata.wechat_contact_add_verify_message);
  const remarkStrategy =
    optionalTrimmedText(input.remarkStrategy) ||
    optionalTrimmedText(metadata.remarkStrategy) ||
    optionalTrimmedText(metadata.wechat_contact_add_remark_strategy);
  const remarkContent =
    optionalTrimmedText(input.remarkContent) ||
    optionalTrimmedText(metadata.remarkContent) ||
    optionalTrimmedText(metadata.wechat_contact_add_remark_content);
  const checkIntervalMinutes =
    optionalNumber(input.checkIntervalMinutes) ??
    optionalNumber(metadata.checkIntervalMinutes) ??
    optionalNumber(metadata.wechat_moments_marketing_check_interval_minutes);
  const publishIntervalMinutes =
    optionalNumber(input.publishIntervalMinutes) ??
    optionalNumber(metadata.publishIntervalMinutes) ??
    optionalNumber(metadata.wechat_moments_publish_interval_minutes);
  const planType =
    optionalTrimmedText(input.planType) ||
    optionalTrimmedText(metadata.planType) ||
    optionalTrimmedText(metadata.wechat_mass_send_plan_type);
  const chunkedSending =
    typeof input.chunkedSending === 'boolean'
      ? input.chunkedSending
      : typeof metadata.chunkedSending === 'boolean'
        ? metadata.chunkedSending
        : typeof metadata.wechat_mass_send_chunked_sending === 'boolean'
          ? metadata.wechat_mass_send_chunked_sending
          : undefined;
  const massSendFiles = Array.isArray(input.massSendFiles)
    ? input.massSendFiles
    : Array.isArray(metadata.massSendFiles)
      ? metadata.massSendFiles
      : Array.isArray(metadata.wechat_mass_send_files)
        ? metadata.wechat_mass_send_files
        : undefined;
  const massSendContents = Array.isArray(metadata.wechat_mass_send_contents)
    ? metadata.wechat_mass_send_contents
    : input.type === 'wechat-group-broadcast'
      ? (input.batchTargets || [])
          .map((target) => ({
            targetName: optionalTrimmedText(target.targetName),
            targetNo: optionalTrimmedText(target.targetName),
            sendContent:
              optionalTrimmedText(target.replyText) ||
              optionalTrimmedText(input.replyText),
            groupType: 'ordinary',
          }))
          .filter((target) => target.targetName && target.sendContent)
      : undefined;
  const momentsDetails = Array.isArray(input.momentsDetails)
    ? input.momentsDetails
    : Array.isArray(metadata.momentsDetails)
      ? metadata.momentsDetails
      : Array.isArray(metadata.wechat_moments_details)
        ? metadata.wechat_moments_details
        : undefined;
  const momentsTotalCount =
    optionalNumber(input.momentsTotalCount) ??
    optionalNumber(metadata.momentsTotalCount) ??
    optionalNumber(metadata.wechat_moments_total_tasks);

  return {
    ...metadata,
    planName,
    wechat_plan_name: planName,
    planTime,
    wechat_plan_time: planTime,
    wechat_plan_schedule_start_time: planTime,
    scheduledAt: planTime,
    dailyLimit,
    wechat_plan_daily_limit: dailyLimit,
    ...(input.type === 'wechat-group-broadcast'
      ? { wechat_group_daily_limit: dailyLimit }
      : {}),
    associatedWeChat,
    associatedWeChatName,
    wechat_plan_associated_wechat_id: associatedWeChat,
    wechat_plan_associated_wechat_name: associatedWeChatName,
    plannedWechatId: associatedWeChat,
    planned_wechat_id: associatedWeChat,
    current_wechat_id: currentWechatId,
    wechat_plan_kind: planKind,
    verifyMessage,
    wechat_contact_add_verify_message: verifyMessage,
    remarkStrategy,
    remarkContent,
    wechat_contact_add_remark_strategy: remarkStrategy,
    wechat_contact_add_remark_content: remarkContent,
    minIntervalSeconds,
    maxIntervalSeconds,
    wechat_contact_add_min_interval_seconds: minIntervalSeconds,
    wechat_contact_add_max_interval_seconds: maxIntervalSeconds,
    checkIntervalMinutes,
    wechat_moments_marketing_check_interval_minutes: checkIntervalMinutes,
    publishIntervalMinutes,
    wechat_moments_publish_interval_minutes: publishIntervalMinutes,
    planType,
    wechat_mass_send_plan_type: planType,
    chunkedSending,
    wechat_mass_send_chunked_sending: chunkedSending,
    massSendFiles,
    wechat_mass_send_files: massSendFiles,
    wechat_mass_send_contents: massSendContents,
    momentsDetails,
    wechat_moments_details: momentsDetails,
    momentsTotalCount,
    wechat_moments_total_tasks: momentsTotalCount,
    generateOnDemand,
  };
}

export function defaultWechatPlanName(
  this: PlanMetadataHost,
  type: InteractionTaskType | undefined,
  now: string,
) {
  const date = now.slice(0, 10);
  if (type === 'wechat-contact-add') return `添加好友计划 ${date}`;
  if (type === 'wechat-moments-publish') return `朋友圈发布计划 ${date}`;
  if (type === 'wechat-moments-marketing') return `朋友圈营销计划 ${date}`;
  if (type === 'wechat-reply-draft') return `微信回复计划 ${date}`;
  return `微信群发计划 ${date}`;
}

export function resolveWechatPlanKind(
  this: PlanMetadataHost,
  type: InteractionTaskType | undefined,
) {
  if (type === 'wechat-group-broadcast') return 'mass-send';
  if (type === 'wechat-contact-add') return 'contact-add';
  if (type === 'wechat-moments-publish') return 'moments-publish';
  if (type === 'wechat-moments-marketing') return 'moments-marketing';
  if (type === 'wechat-reply-draft') return 'session-reply';
  return undefined;
}

export function resolveGroupBroadcastPlanStatus(
  this: PlanMetadataHost,
  type: InteractionTaskType,
  taskStatus: InteractionTaskStatus,
  explicitStatus?: unknown,
  planTime?: unknown,
) {
  if (type !== 'wechat-group-broadcast') {
    return undefined;
  }
  const explicit = optionalTrimmedText(explicitStatus);
  if (
    explicit === 'draft' ||
    explicit === 'scheduled' ||
    explicit === 'sending' ||
    explicit === 'paused' ||
    explicit === 'completed' ||
    explicit === 'failed' ||
    explicit === 'removed'
  ) {
    return explicit;
  }
  if (taskStatus === 'paused') return 'paused';
  if (taskStatus === 'completed' || taskStatus === 'skipped') {
    return 'completed';
  }
  if (taskStatus === 'failed' || taskStatus === 'blocked') return 'failed';
  if (
    taskStatus === 'running' ||
    taskStatus === 'waiting_for_send_confirmation'
  ) {
    return 'sending';
  }
  return optionalTrimmedText(planTime) ? 'scheduled' : 'draft';
}

export function normalizeMomentsPlanMetadata(
  this: PlanMetadataHost,
  input: CreateInteractionTaskInput,
): Record<string, unknown> | undefined {
  if (
    input.type !== 'wechat-moments-publish' &&
    input.type !== 'wechat-moments-marketing'
  ) {
    return undefined;
  }
  const existing =
    input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const dailyPublished = readMetadataPositiveInteger(
    input.dailyPublished ??
      existing.dailyPublished ??
      existing.wechat_moments_daily_published,
    0,
    10000,
  );
  const fallbackQuota =
    input.type === 'wechat-moments-publish'
      ? 1
      : readMetadataPositiveInteger(
          existing.dailyViewLimit ??
            existing.wechat_moments_marketing_daily_limit,
          20,
          100,
        );
  const dailyQuota = readMetadataPositiveInteger(
    input.dailyQuota ??
      existing.dailyQuota ??
      existing.wechat_moments_daily_quota,
    fallbackQuota,
    10000,
  );
  const scheduleStartTime = optionalTrimmedText(
    input.scheduleStartTime ??
      existing.scheduleStartTime ??
      existing.wechat_moments_schedule_start_time,
  );
  const recordSummary = optionalTrimmedText(
    input.recordSummary ??
      existing.recordSummary ??
      existing.wechat_moments_record_summary,
  );
  const prompts = normalizeMomentsPromptConfig(
    input.prompts ?? existing.prompts ?? existing.wechat_moments_prompts,
  );
  const autoLike =
    input.autoLike ??
    (typeof existing.autoLike === 'boolean' ? existing.autoLike : undefined) ??
    (typeof existing.wechat_moments_auto_like === 'boolean'
      ? existing.wechat_moments_auto_like
      : undefined);
  const autoComment =
    input.autoComment ??
    (typeof existing.autoComment === 'boolean'
      ? existing.autoComment
      : undefined) ??
    (typeof existing.wechat_moments_auto_comment === 'boolean'
      ? existing.wechat_moments_auto_comment
      : undefined);

  return {
    dailyPublished,
    dailyQuota,
    scheduleStartTime,
    autoLike,
    autoComment,
    recordSummary,
    prompts,
    wechat_moments_daily_published: dailyPublished,
    wechat_moments_daily_quota: dailyQuota,
    wechat_moments_schedule_start_time: scheduleStartTime,
    wechat_moments_auto_like: autoLike,
    wechat_moments_auto_comment: autoComment,
    wechat_moments_record_summary: recordSummary,
    wechat_moments_prompts: prompts,
  };
}

export function normalizeBatchTargets(
  this: PlanMetadataHost,
  input: CreateInteractionTaskInput,
  now: string,
): InteractionBatchTarget[] {
  const rawTargets = Array.isArray(input.batchTargets)
    ? input.batchTargets
    : [];
  const normalizedTargets: InteractionBatchTarget[] = [];
  rawTargets.slice(0, 100).forEach((target, index) => {
    const sourceText = String(target?.sourceText || '').trim();
    if (!sourceText) {
      return;
    }
    normalizedTargets.push({
      id: `bt_${index + 1}_${createId()}`,
      targetName:
        String(target?.targetName || '').trim() || `批量对象 ${index + 1}`,
      sourceText,
      replyText:
        String(target?.replyText || input.replyText || '').trim() ||
        this.buildReplyFromRule(sourceText),
      sourceUrl: optionalTrimmedText(target?.sourceUrl || input.sourceUrl),
      profileUrl: optionalTrimmedText(target?.profileUrl || input.profileUrl),
      commentTime: optionalTrimmedText(
        target?.commentTime || input.commentTime,
      ),
      videoTitle: optionalTrimmedText(target?.videoTitle || input.videoTitle),
      videoUrl: optionalTrimmedText(target?.videoUrl || input.videoUrl),
      engagementScore:
        optionalNumber(target?.engagementScore) ??
        optionalNumber(input.engagementScore),
      status: 'queued',
      updatedAt: now,
    });
  });

  if (normalizedTargets.length) {
    return normalizedTargets;
  }

  const sourceText = input.sourceText?.trim() || '等待本机读取真实对象。';
  return [
    {
      id: `bt_1_${createId()}`,
      targetName: input.targetName?.trim() || '测试对象',
      sourceText,
      replyText: input.replyText?.trim() || this.buildReplyFromRule(sourceText),
      sourceUrl: optionalTrimmedText(input.sourceUrl),
      profileUrl: optionalTrimmedText(input.profileUrl),
      commentTime: optionalTrimmedText(input.commentTime),
      videoTitle: optionalTrimmedText(input.videoTitle),
      videoUrl: optionalTrimmedText(input.videoUrl),
      engagementScore: optionalNumber(input.engagementScore),
      status: 'queued',
      updatedAt: now,
    },
  ];
}

export function normalizeRuleNumber(
  this: PlanMetadataHost,
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.round(number), max));
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const planMetadataMethods = {
  normalizeGroupBroadcastPlanMetadata,
  defaultWechatPlanName,
  resolveWechatPlanKind,
  resolveGroupBroadcastPlanStatus,
  normalizeMomentsPlanMetadata,
  normalizeBatchTargets,
  normalizeRuleNumber,
};
