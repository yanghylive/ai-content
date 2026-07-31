import type { WechatExecutionMode } from "./runtime";

export type InteractionSkillId =
  | "wechat.live.auto_reply"
  | "wechat.session.auto_reply"
  | "wechat.group.broadcast"
  | "wechat.moments.publish"
  | "douyin.comment.auto_reply"
  | "douyin.dm.auto_reply";

export type InteractionSkillExecutor = "agent-s-desktop" | "browser-platform";

export type InteractionSkillRunRequest = {
  skillId: InteractionSkillId;
  sessionName: string;
  taskType: string;
  instruction: string;
  metadata: Record<string, unknown>;
  labels: string[];
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
  localControllerPermissionMode?: "restricted" | "custom" | "full";
  commercialExecutionRequested: boolean;
};

export type WechatMomentsPublishSkillInput = {
  mode: WechatExecutionMode;
  content: string;
  visibility?: string;
  context?: string;
  assetHints?: string[];
  assetPath?: string;
};

export type WechatSessionAutoReplySkillInput = {
  mode: WechatExecutionMode;
  contact: string;
  reply: string;
  context?: string;
};

export type WechatLiveAutoReplySkillInput = {
  context?: string;
};

export type WechatGroupBroadcastSkillInput = {
  mode: WechatExecutionMode;
  targets: string[];
  message: string;
  context?: string;
};

type InteractionSkillDefinition<TInput> = {
  id: InteractionSkillId;
  title: string;
  executor: InteractionSkillExecutor;
  source: "skillhub" | "local";
  skillhubSlug?: string;
  requiredCommands?: string[];
  buildRunRequest(input: TInput): InteractionSkillRunRequest;
};

const WECHAT_MOMENTS_SKILL_ID: InteractionSkillId = "wechat.moments.publish";
const WECHAT_SESSION_SKILL_ID: InteractionSkillId = "wechat.session.auto_reply";
const WECHAT_GROUP_SKILL_ID: InteractionSkillId = "wechat.group.broadcast";
const WECHAT_LIVE_SKILL_ID: InteractionSkillId = "wechat.live.auto_reply";

function requireText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`缺少${label}`);
  }
  return trimmed;
}
function buildWechatSessionInstruction(input: Required<WechatSessionAutoReplySkillInput>) {
  return [
    "你正在执行 skill: wechat.session.auto_reply。",
    "目标：使用本机微信桌面客户端给指定联系人真实回复消息。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要只写执行记录，不要伪造成功。",
    "动作顺序：",
    "1. 打开或聚焦微信桌面客户端。",
    "2. 搜索并打开目标联系人会话。",
    "3. 确认当前会话头部名称与目标联系人完全一致。",
    "4. 阅读最近上下文，确认不是搜一搜、公众号、视频号或账号结果页。",
    "5. 输入正式回复。",
    "6. 回读输入框内容，确认与回复内容一致。",
    "7. 自动发送模式下直接点击发送；确认后发送模式下停在发送前等待确认。",
    input.mode === "auto-send"
      ? "发送策略：自动发送。目标联系人、正常聊天会话、输入框回读和发送按钮都确认无误后直接点击发送。"
      : "发送策略：确认后发送。回复准备好后停在发送前，不点击发送。",
    `目标联系人：${input.contact}`,
    `回复内容：${input.reply}`,
    input.context ? `补充要求：${input.context}` : null,
    "阻断规则：目标不一致、联系人重名未确认、落到搜一搜/公众号/视频号、输入框回读不一致、微信未登录、权限不足或窗口不确定时必须停止并回报卡点。",
    "成功标准：只有真实点击发送并看到微信消息发出后的结果，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatLiveInstruction(input: Required<WechatLiveAutoReplySkillInput>) {
  return [
    "你正在执行 skill: wechat.live.auto_reply。",
    "目标：直接操作本机微信当前聊天或第一条明确的客户聊天，读取最近上下文，生成正式回复并自动发送。",
    "执行器：必须使用 Agent-S 桌面控制和本机 SkillHub 命令操作微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要只写执行记录，不要把回复返回系统让用户再确认，不要伪造成功。",
    "动作顺序：",
    "1. 聚焦本机微信桌面客户端。",
    "2. 读取当前可见聊天内容。",
    "3. 生成简洁自然、可直接发送的客户回复。",
    "4. 输入回复，回读或截图验证。",
    "5. 默认自动发送；只有没有读取到客户内容、窗口不确定或发送后无法验证时停止。",
    input.context ? `补充要求：${input.context}` : null,
    "成功标准：只有真实点击发送，并在发送后截图/OCR 中看到回复内容，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatGroupInstruction(input: Required<WechatGroupBroadcastSkillInput>) {
  return [
    "你正在执行 skill: wechat.group.broadcast。",
    "目标：使用本机微信桌面客户端按目标列表逐个真实发送同一条消息。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要只写执行记录，不要伪造成功。",
    "动作顺序：",
    "1. 打开或聚焦微信桌面客户端。",
    "2. 按目标列表逐个搜索并打开群或联系人。",
    "3. 每个目标都要确认当前会话头部名称与目标一致。",
    "4. 输入群发内容。",
    "5. 回读输入框内容，确认与群发内容一致。",
    "6. 自动发送模式下逐个直接点击发送；确认后发送模式下每个目标停在发送前等待确认。",
    "7. 单个目标失败时记录卡点，能继续的继续下一个；出现权限或窗口安全问题时停止整轮。",
    input.mode === "auto-send"
      ? "发送策略：自动发送。目标匹配、正常会话、输入框回读和发送按钮都确认无误后直接发送，不逐条要求用户确认。"
      : "发送策略：确认后发送。每个目标准备好后停在发送前，不点击发送。",
    "目标列表：",
    ...input.targets.map((target, index) => `${index + 1}. ${target}`),
    `群发内容：${input.message}`,
    input.context ? `补充要求：${input.context}` : null,
    "阻断规则：目标不一致、联系人/群重名未确认、输入框回读不一致、微信未登录、权限不足、窗口不确定或疑似群发风险时必须停止并回报卡点。",
    "成功标准：只有目标列表里的消息真实发出，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

export const wechatLiveAutoReplySkill: InteractionSkillDefinition<WechatLiveAutoReplySkillInput> = {
  id: WECHAT_LIVE_SKILL_ID,
  title: "微信当前聊天自动回复",
  executor: "agent-s-desktop",
  source: "skillhub",
  skillhubSlug: "wechat-live-auto-reply",
  requiredCommands: ["wechat-live-auto-reply"],
  buildRunRequest(input) {
    const context = input.context?.trim() || "";

    return {
      skillId: WECHAT_LIVE_SKILL_ID,
      sessionName: `wechat-live-auto-reply-${Date.now()}`,
      taskType: WECHAT_LIVE_SKILL_ID,
      instruction: buildWechatLiveInstruction({ context }),
      metadata: {
        skill_id: WECHAT_LIVE_SKILL_ID,
        source: "ops-workbench-wechat-live",
        agent_s_business_scenario: WECHAT_LIVE_SKILL_ID,
        wechat_reply_mode: "auto-send",
        wechat_context_note: context || null,
        allow_desktop_action_execution: true,
        agent_s_execution_policy: "auto_execute",
        commercialExecutionRequested: true,
      },
      labels: ["wechat", "live-auto-reply", "ops-workbench", "skill"],
      riskLevel: "high",
      requiresApproval: false,
      localControllerPermissionMode: "custom",
      commercialExecutionRequested: true,
    };
  },
};

export const wechatSessionAutoReplySkill: InteractionSkillDefinition<WechatSessionAutoReplySkillInput> = {
  id: WECHAT_SESSION_SKILL_ID,
  title: "微信会话回复",
  executor: "agent-s-desktop",
  source: "skillhub",
  skillhubSlug: "wechat-auto-reply",
  requiredCommands: ["wechat-auto-reply"],
  buildRunRequest(input) {
    const contact = requireText(input.contact, "目标联系人");
    const reply = requireText(input.reply, "回复内容");
    const mode = input.mode;
    const context = input.context?.trim() || "";
    const commercialExecutionRequested = mode === "auto-send";

    return {
      skillId: WECHAT_SESSION_SKILL_ID,
      sessionName: `wechat-session-auto-reply-${Date.now()}`,
      taskType: WECHAT_SESSION_SKILL_ID,
      instruction: buildWechatSessionInstruction({ mode, contact, reply, context }),
      metadata: {
        skill_id: WECHAT_SESSION_SKILL_ID,
        source: "ops-workbench-wechat",
        agent_s_business_scenario: WECHAT_SESSION_SKILL_ID,
        wechat_contact_name: contact,
        wechat_expected_contact_name: contact,
        wechat_contact_guard_mode: "strict_target_match",
        wechat_reply_draft: reply,
        wechat_reply_mode: mode,
        wechat_context_note: context || null,
        allow_desktop_action_execution: true,
        agent_s_execution_policy: commercialExecutionRequested ? "auto_execute" : "approval_execute",
        commercialExecutionRequested,
      },
      labels: ["wechat", "session-auto-reply", "ops-workbench", "skill"],
      riskLevel: commercialExecutionRequested ? "high" : "medium",
      requiresApproval: !commercialExecutionRequested,
      localControllerPermissionMode: "custom",
      commercialExecutionRequested,
    };
  },
};

export const wechatGroupBroadcastSkill: InteractionSkillDefinition<WechatGroupBroadcastSkillInput> = {
  id: WECHAT_GROUP_SKILL_ID,
  title: "微信群发",
  executor: "agent-s-desktop",
  source: "skillhub",
  skillhubSlug: "wechat-auto-reply",
  requiredCommands: ["wechat-auto-reply"],
  buildRunRequest(input) {
    const targets = input.targets.map((target) => target.trim()).filter(Boolean);
    if (!targets.length) {
      throw new Error("缺少群或联系人列表");
    }
    const message = requireText(input.message, "群发内容");
    const mode = input.mode;
    const context = input.context?.trim() || "";
    const commercialExecutionRequested = mode === "auto-send";

    return {
      skillId: WECHAT_GROUP_SKILL_ID,
      sessionName: `wechat-group-broadcast-${Date.now()}`,
      taskType: WECHAT_GROUP_SKILL_ID,
      instruction: buildWechatGroupInstruction({ mode, targets, message, context }),
      metadata: {
        skill_id: WECHAT_GROUP_SKILL_ID,
        source: "ops-workbench-wechat-groups",
        agent_s_business_scenario: WECHAT_GROUP_SKILL_ID,
        wechat_group_targets: targets,
        wechat_reply_draft: message,
        wechat_reply_mode: mode,
        wechat_context_note: context || null,
        allow_desktop_action_execution: true,
        agent_s_execution_policy: commercialExecutionRequested ? "auto_execute" : "approval_execute",
        commercialExecutionRequested,
      },
      labels: ["wechat", "group-broadcast", "ops-workbench", "skill"],
      riskLevel: "high",
      requiresApproval: !commercialExecutionRequested,
      localControllerPermissionMode: "custom",
      commercialExecutionRequested,
    };
  },
};

export const wechatMomentsPublishSkill: InteractionSkillDefinition<WechatMomentsPublishSkillInput> = {
  id: WECHAT_MOMENTS_SKILL_ID,
  title: "朋友圈发布",
  executor: "agent-s-desktop",
  source: "skillhub",
  skillhubSlug: "wechat-sender",
  requiredCommands: ["wechat-moments-publish"],
  buildRunRequest() {
    throw new Error("朋友圈发布功能已下线。");
  },
};

export const interactionSkillRegistry = {
  [WECHAT_LIVE_SKILL_ID]: wechatLiveAutoReplySkill,
  [WECHAT_SESSION_SKILL_ID]: wechatSessionAutoReplySkill,
  [WECHAT_GROUP_SKILL_ID]: wechatGroupBroadcastSkill,
} satisfies Partial<Record<InteractionSkillId, InteractionSkillDefinition<unknown>>>;
