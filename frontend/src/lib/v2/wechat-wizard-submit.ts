import {
  localEngineApi,
  type CreateInteractionTaskInput,
  type InteractionTask,
} from "@/lib/api/local-engine";

/**
 * 微信 v2 向导的真实任务提交。
 * 复用旧工作台（wechat-workbench-client.tsx）的任务创建约定：
 * - 群发走 createGroupBroadcastPlan，失败回退 createBusinessTask("groups")
 * - 加好友/通过好友走 createBusinessTask("customers")
 * - 朋友圈走 createBusinessTask("moments")
 * - accountId 固定 "local-wechat-desktop"（本机微信）
 */

const WECHAT_ACCOUNT = {
  accountId: "local-wechat-desktop",
  accountName: "本机微信",
  platformName: "微信桌面",
} as const;

/**
 * 与旧工作台默认行为一致：任务创建为"待确认"（approval-send），
 * 不请求商用执行（commercialExecutionRequested: false），
 * 因此不需要商用授权。用户在任务中心/旧版工作台确认后才真正发送。
 */
const APPROVAL_MODE = {
  commercialExecutionRequested: false,
  sendMode: "approval-send",
} as const;

function toPlanTime(isoLocal?: string): string | undefined {
  if (!isoLocal) return undefined;
  const d = new Date(isoLocal);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 群发消息 */
export async function submitMassSendTask(input: {
  planName: string;
  message: string;
  targets: string[];
  scheduleType: "immediate" | "scheduled";
  scheduledTime?: string;
  dailyLimit: number;
  intervalSeconds: number;
  enableSegmentation: boolean;
}): Promise<InteractionTask> {
  const instruction = `群发消息给 ${input.targets.length} 个联系人`;
  const createInput: CreateInteractionTaskInput = {
    type: "wechat-group-broadcast",
    ...WECHAT_ACCOUNT,
    ...APPROVAL_MODE,
    targetName: `${input.targets.length} 个联系人`,
    sourceText: instruction,
    replyText: input.message,
    metadata: {
      wechat_plan_name: input.planName,
      wechat_group_message: input.message,
      wechat_group_interval_seconds: input.intervalSeconds,
      wechat_group_chunked_sending: input.enableSegmentation,
      wechat_group_targets: input.targets,
    },
    planName: input.planName,
    planTime:
      input.scheduleType === "scheduled"
        ? toPlanTime(input.scheduledTime)
        : undefined,
    planStatus: input.scheduleType === "scheduled" ? "scheduled" : undefined,
    dailyLimit: input.dailyLimit,
    batchTargets: input.targets.map((target) => ({
      targetName: target,
      sourceText: instruction,
      replyText: input.message,
    })),
  };

  return localEngineApi
    .createGroupBroadcastPlan(createInput)
    .catch(() => localEngineApi.createBusinessTask("groups", createInput));
}

/** 添加好友 */
export async function submitContactAddTask(input: {
  planName: string;
  numbers: string[];
  verifyMessage: string;
  dailyLimit: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  remarkStrategy: string;
  customRemark?: string;
}): Promise<InteractionTask> {
  const instruction = `批量添加 ${input.numbers.length} 个好友`;
  const createInput: CreateInteractionTaskInput = {
    type: "wechat-contact-add",
    ...WECHAT_ACCOUNT,
    ...APPROVAL_MODE,
    targetName: `${input.numbers.length} 个号码`,
    sourceText: instruction,
    replyText: input.verifyMessage,
    metadata: {
      wechat_plan_name: input.planName,
      wechat_contact_add_verify_message: input.verifyMessage,
      wechat_contact_add_numbers: input.numbers,
    },
    planName: input.planName,
    dailyLimit: input.dailyLimit,
    verifyMessage: input.verifyMessage,
    minIntervalSeconds: input.minIntervalSeconds,
    maxIntervalSeconds: input.maxIntervalSeconds,
    remarkStrategy: input.remarkStrategy,
    remarkContent:
      input.remarkStrategy === "custom" ? input.customRemark : undefined,
    batchTargets: input.numbers.map((number) => ({
      targetName: number,
      sourceText: instruction,
      replyText: input.verifyMessage,
    })),
  };

  return localEngineApi.createBusinessTask("customers", createInput);
}

/** 通过好友申请 */
export async function submitFriendAcceptTask(input: {
  selectedIds: string[];
  welcomeMessage: string;
  sendWelcome: boolean;
  remarkStrategy: string;
  customRemark?: string;
}): Promise<InteractionTask> {
  const planName = `${new Date().toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 通过好友 ${input.selectedIds.length} 人`;
  const instruction = `通过 ${input.selectedIds.length} 个好友申请`;
  const createInput: CreateInteractionTaskInput = {
    type: "wechat-friend-accept",
    ...WECHAT_ACCOUNT,
    ...APPROVAL_MODE,
    targetName: `${input.selectedIds.length} 个申请`,
    sourceText: instruction,
    replyText: input.sendWelcome ? input.welcomeMessage : "",
    metadata: {
      wechat_plan_name: planName,
      wechat_friend_accept_welcome_message: input.sendWelcome
        ? input.welcomeMessage
        : "",
      wechat_friend_accept_send_welcome: input.sendWelcome,
      wechat_friend_accept_targets: input.selectedIds,
    },
    planName,
    remarkStrategy: input.remarkStrategy,
    remarkContent:
      input.remarkStrategy === "custom" ? input.customRemark : undefined,
    batchTargets: input.selectedIds.map((id) => ({
      targetName: id,
      sourceText: instruction,
      replyText: input.sendWelcome ? input.welcomeMessage : "",
    })),
  };

  return localEngineApi.createBusinessTask("customers", createInput);
}

/** 朋友圈发布 */
export async function submitMomentsPublishTask(input: {
  planName: string;
  content: string;
  mediaPaths: string[];
  scheduleType: "immediate" | "in-10-min" | "custom";
  customTime?: string;
  visibility: "public" | "private";
}): Promise<InteractionTask> {
  const scheduledTime =
    input.scheduleType === "in-10-min"
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : input.scheduleType === "custom"
        ? toPlanTime(input.customTime)
        : undefined;

  const createInput: CreateInteractionTaskInput = {
    type: "wechat-moments-publish",
    ...WECHAT_ACCOUNT,
    ...APPROVAL_MODE,
    targetName: input.planName,
    sourceText: `发布朋友圈：${input.content.slice(0, 30)}${input.content.length > 30 ? "..." : ""}`,
    replyText: input.content,
    metadata: {
      wechat_plan_name: input.planName,
      wechat_moments_content: input.content,
      wechat_moments_media: input.mediaPaths,
      wechat_moments_visibility: input.visibility,
    },
    planName: input.planName,
    planTime: scheduledTime,
    planStatus: scheduledTime ? "scheduled" : undefined,
    massSendFiles: input.mediaPaths.length > 0 ? input.mediaPaths : undefined,
  };

  return localEngineApi.createBusinessTask("moments", createInput);
}

/** 朋友圈营销 */
export async function submitMomentsMarketingTask(input: {
  planName: string;
  mode: "random" | "targeted";
  targetContacts: string[];
  autoLike: boolean;
  autoComment: boolean;
  commentMode: "ai" | "fixed";
  fixedComment?: string;
  customPrompt?: string;
  dailyViewCount: number;
  executionTime: string;
}): Promise<InteractionTask> {
  const createInput: CreateInteractionTaskInput = {
    type: "wechat-moments-marketing",
    ...WECHAT_ACCOUNT,
    ...APPROVAL_MODE,
    targetName:
      input.mode === "random"
        ? "随机浏览朋友圈"
        : `定向 ${input.targetContacts.length} 个好友`,
    sourceText: "朋友圈自动营销",
    replyText:
      input.commentMode === "fixed" ? input.fixedComment || "" : "AI 自动生成",
    metadata: {
      wechat_plan_name: input.planName,
      wechat_moments_marketing_mode: input.mode,
      wechat_moments_marketing_targets: input.targetContacts,
      wechat_moments_marketing_comment_mode: input.commentMode,
      wechat_moments_marketing_custom_prompt: input.customPrompt,
      wechat_moments_marketing_execution_time: input.executionTime,
    },
    planName: input.planName,
    dailyLimit: input.dailyViewCount,
    autoLike: input.autoLike,
    autoComment: input.autoComment,
    prompts: input.customPrompt
      ? [{ key: "custom", title: "自定义提示词", prompt: input.customPrompt, enabled: true }]
      : undefined,
    batchTargets:
      input.mode === "targeted"
        ? input.targetContacts.map((contact) => ({
            targetName: contact,
            sourceText: "朋友圈自动营销",
            replyText:
              input.commentMode === "fixed"
                ? input.fixedComment || ""
                : "AI 自动生成",
          }))
        : undefined,
  };

  return localEngineApi.createBusinessTask("moments", createInput);
}

/** 拉取已同步联系人的目标标识列表（群发"全部联系人"模式用） */
export async function fetchAllContactTargets(): Promise<string[]> {
  const result = await localEngineApi.wechatContacts();
  if (Array.isArray(result.items) && result.items.length > 0) {
    return result.items.map((c) => c.remark || c.nickname || c.wxid);
  }
  return result.contacts || [];
}
