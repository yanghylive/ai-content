import type { WechatExecutionMode } from "./runtime";

export type InteractionSkillId =
  | "wechat.live.auto_reply"
  | "wechat.session.auto_reply"
  | "wechat.group.broadcast"
  | "wechat.contact.add"
  | "wechat.friend.accept"
  | "wechat.moments.publish"
  | "wechat.moments.marketing"
  | "video.template.clip"
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
  planName?: string;
  planDescription?: string;
  content: string;
  additionalComment?: string;
  visibility?: string;
  context?: string;
  assetHints?: string[];
  assetPath?: string;
  details?: Array<{
    content: string;
    additionalComment?: string;
    attachments?: string[];
    scheduledPublishTime?: string;
    visibility?: string;
  }>;
  totalCount?: number;
  publishIntervalMinutes?: number;
  dailyPublished?: number;
  dailyQuota?: number;
  scheduleStartTime?: string;
  recordSummary?: string;
  prompts?: Array<{
    key?: string;
    title?: string;
    prompt: string;
    enabled?: boolean;
  }>;
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
  personalizedMessages?: Array<{ target: string; message: string }>;
  planName?: string;
  planType?: "immediate" | "scheduled";
  planTime?: string;
  associatedWeChat?: string;
  generateOnDemand?: boolean;
  chunkedSending?: boolean;
  files?: string[];
  context?: string;
  tags?: string[];
  intervalSeconds?: number;
  dailyLimit?: number;
};

export type WechatContactAddSkillInput = {
  mode: WechatExecutionMode;
  targets: string[];
  verifyMessage: string;
  planName?: string;
  remarkStrategy?: "manual" | "phone_wechat" | "none";
  remarkContent?: string;
  minIntervalSeconds?: number;
  maxIntervalSeconds?: number;
  dailyLimit?: number;
  blacklist?: string[];
  context?: string;
};

export type WechatFriendAcceptSkillInput = {
  mode: WechatExecutionMode;
  planName?: string;
  remarkStrategy?: "request_name" | "phone_wechat" | "manual";
  remarkContent?: string;
  welcomeMessage?: string;
  matchKeywords?: string[];
  dailyLimit?: number;
  context?: string;
};

export type WechatMomentsMarketingSkillInput = {
  mode: WechatExecutionMode;
  planName?: string;
  marketingMode: "random" | "targeted";
  contacts?: string[];
  checkIntervalMinutes?: number;
  dailyViewLimit?: number;
  randomBrowseCount?: number;
  actions: {
    like: boolean;
    comment: boolean;
  };
  commentMode: "ai" | "fixed";
  fixedComment?: string;
  content?: string;
  targetComments?: Array<{
    targetName: string;
    commentText: string;
  }>;
  dailyPublished?: number;
  dailyQuota?: number;
  scheduleStartTime?: string;
  autoLike?: boolean;
  autoComment?: boolean;
  recordSummary?: string;
  prompts?: Array<{
    key?: string;
    title?: string;
    prompt: string;
    enabled?: boolean;
  }>;
  context?: string;
};

export type VideoTemplateClipSkillInput = {
  materialPath: string;
  templateName: string;
  titlePrompt?: string;
  outputName?: string;
  platformHints?: string[];
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
const WECHAT_CONTACT_ADD_SKILL_ID: InteractionSkillId = "wechat.contact.add";
const WECHAT_FRIEND_ACCEPT_SKILL_ID: InteractionSkillId =
  "wechat.friend.accept";
const WECHAT_LIVE_SKILL_ID: InteractionSkillId = "wechat.live.auto_reply";
const WECHAT_MOMENTS_MARKETING_SKILL_ID: InteractionSkillId =
  "wechat.moments.marketing";
const VIDEO_TEMPLATE_CLIP_SKILL_ID: InteractionSkillId = "video.template.clip";

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  max: number,
) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(Math.floor(numberValue), max));
}

function normalizeMomentPrompts(
  prompts:
    | Array<{ key?: string; title?: string; prompt: string; enabled?: boolean }>
    | undefined,
) {
  return (prompts || [])
    .map((item) => ({
      key: item.key?.trim() || undefined,
      title: item.title?.trim() || undefined,
      prompt: item.prompt.trim(),
      enabled: item.enabled !== false,
    }))
    .filter((item) => item.prompt)
    .slice(0, 20);
}

function normalizeMomentsVisibility(value: string) {
  const trimmed = value.trim();
  if (trimmed === "私密") return "private";
  if (trimmed === "部分可见" || trimmed === "不给谁看") return "partial";
  return "public";
}

function requireText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`缺少${label}`);
  }
  return trimmed;
}

function buildWechatMomentsInstruction(
  input: Pick<
    Required<WechatMomentsPublishSkillInput>,
    "mode" | "content" | "visibility" | "context" | "assetHints" | "assetPath"
  >,
) {
  return [
    "你正在执行 skill: wechat.moments.publish。",
    "目标：使用本机微信桌面客户端真实发表一条朋友圈。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要只写执行记录，不要伪造成功。",
    "动作顺序：",
    "1. 打开或聚焦微信桌面客户端。",
    "2. 进入朋友圈发布入口。",
    "3. 填入朋友圈文案。",
    "4. 选择并添加真实素材。",
    "5. 按可见范围要求设置可见范围。",
    "6. 回读文案、素材和可见范围；确认与输入一致。",
    "7. 自动发布模式下直接点击发表；受控发布模式下完成回读和风控保护后继续执行。",
    input.mode === "auto-send"
      ? "发送策略：自动发布。只要窗口、入口、内容回读、发布按钮都确认无误，就直接点击发表。"
      : "发送策略：受控发布。内容、入口和风控保护通过后继续发表；条件不完整时停止并留下证据。",
    `朋友圈文案：${input.content}`,
    `可见范围：${input.visibility}`,
    `素材路径：${input.assetPath}`,
    input.context ? `补充要求：${input.context}` : null,
    input.assetHints.length ? `素材提示：${input.assetHints.join("；")}` : null,
    "阻断规则：微信未登录、入口找不到、发布按钮不可见、文案回读不一致、素材缺失、权限不足、窗口不确定时必须停止并回报卡点。",
    "成功标准：只有真实点击发表并看到微信发布后的结果，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatSessionInstruction(
  input: Required<WechatSessionAutoReplySkillInput>,
) {
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
    "7. 自动发送模式下直接点击发送；受控发送模式下完成回读和风控保护后继续执行。",
    input.mode === "auto-send"
      ? "发送策略：自动发送。目标联系人、正常聊天会话、输入框回读和发送按钮都确认无误后直接点击发送。"
      : "发送策略：受控发送。回复、目标和风控保护通过后继续发送；条件不完整时停止并留下证据。",
    `目标联系人：${input.contact}`,
    `回复内容：${input.reply}`,
    input.context ? `补充要求：${input.context}` : null,
    "阻断规则：目标不一致、联系人重名未确认、落到搜一搜/公众号/视频号、输入框回读不一致、微信未登录、权限不足或窗口不确定时必须停止并回报卡点。",
    "成功标准：只有真实点击发送并看到微信消息发出后的结果，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatLiveInstruction(
  input: Required<WechatLiveAutoReplySkillInput>,
) {
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

function buildWechatGroupInstruction(
  input: Required<WechatGroupBroadcastSkillInput>,
) {
  const personalized = input.personalizedMessages.length > 0;
  return [
    "你正在执行 skill: wechat.group.broadcast。",
    personalized
      ? "目标：使用本机微信桌面客户端按对象逐个发送各自对应的消息。"
      : "目标：使用本机微信桌面客户端按目标列表逐个真实发送同一条消息。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要只写执行记录，不要伪造成功。",
    "动作顺序：",
    "1. 打开或聚焦微信桌面客户端。",
    "2. 按目标列表逐个搜索并打开群或联系人。",
    "3. 每个目标都要确认当前会话头部名称与目标一致。",
    personalized ? "4. 按对象输入该对象对应的消息。" : "4. 输入群发内容。",
    personalized
      ? "5. 每个对象都回读输入框，确认内容与该对象的专属消息一致。"
      : "5. 回读输入框内容，确认与群发内容一致。",
    "6. 自动发送模式下逐个直接点击发送；受控发送模式下每个目标完成回读和风控保护后继续执行。",
    "7. 单个目标失败时记录卡点，能继续的继续下一个；出现权限或窗口安全问题时停止整轮。",
    input.mode === "auto-send"
      ? "发送策略：自动发送。目标匹配、正常会话、输入框回读和发送按钮都确认无误后直接发送，不逐条要求用户确认。"
      : "发送策略：受控发送。每个目标、输入框回读和风控保护通过后继续发送；条件不完整时停止并留下证据。",
    input.tags.length ? `客户标签：${input.tags.join("、")}` : null,
    input.planName ? `计划名称：${input.planName}` : null,
    `计划类型：${input.planType === "scheduled" ? "定时计划" : "立即执行"}`,
    input.planTime ? `计划时间：${input.planTime}` : null,
    input.associatedWeChat ? `关联微信：${input.associatedWeChat}` : null,
    input.chunkedSending ? "分段发送：开启。" : "分段发送：关闭。",
    input.files.length ? `附件路径：${input.files.join("；")}` : null,
    input.generateOnDemand
      ? "生成策略：发送前按对象即时生成或修正文案。"
      : null,
    `每天发送上限：${input.dailyLimit}`,
    `每次发送间隔：${input.intervalSeconds} 秒`,
    personalized ? "对象与专属消息：" : "目标列表：",
    ...(personalized
      ? input.personalizedMessages.map(
          (item, index) => `${index + 1}. ${item.target}｜${item.message}`,
        )
      : input.targets.map((target, index) => `${index + 1}. ${target}`)),
    personalized ? null : `群发内容：${input.message}`,
    input.context ? `补充要求：${input.context}` : null,
    "阻断规则：目标不一致、联系人/群重名未确认、输入框回读不一致、微信未登录、权限不足、窗口不确定或疑似群发风险时必须停止并回报卡点。",
    "成功标准：只有目标列表里的消息真实发出，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatContactAddInstruction(
  input: Required<WechatContactAddSkillInput>,
) {
  return [
    "你正在执行 skill: wechat.contact.add。",
    "目标：使用本机微信桌面客户端按计划添加好友。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成草稿，不要只创建任务，不要跳过风控检查，不要伪造成功。",
    "动作顺序：",
    "1. 打开或聚焦微信桌面客户端。",
    "2. 确认微信已登录、当前窗口可控、账号没有明显限制提示。",
    "3. 按目标列表逐个搜索手机号、微信号或联系人线索。",
    "4. 命中黑名单、重复联系人、企业/公众号/视频号结果时跳过并记录原因。",
    "5. 打开正确目标后填写验证消息。",
    "6. 回读验证消息和目标名称，确认无误后再提交。",
    "7. 单日达到上限、出现验证码、频繁操作提示、账号风险提示时立即停止整轮。",
    input.mode === "auto-send"
      ? "发送策略：自动提交好友申请。目标和验证消息确认无误后提交。"
      : "发送策略：受控提交。每个目标和验证消息回读通过后继续提交；条件不完整时停止并留下证据。",
    input.planName ? `计划名称：${input.planName}` : null,
    "目标列表：",
    ...input.targets.map((target, index) => `${index + 1}. ${target}`),
    `验证消息：${input.verifyMessage}`,
    `备注策略：${input.remarkStrategy}`,
    input.remarkContent ? `备注内容：${input.remarkContent}` : null,
    `每天次数限制：${input.dailyLimit}`,
    `执行间隔：${input.minIntervalSeconds}-${input.maxIntervalSeconds} 秒`,
    input.blacklist.length ? `黑名单：${input.blacklist.join("；")}` : null,
    input.context ? `补充要求：${input.context}` : null,
    "成功标准：只有真实提交好友申请并记录截图、目标、时间、结果，才算成功。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatFriendAcceptInstruction(
  input: Required<WechatFriendAcceptSkillInput>,
) {
  return [
    "你正在执行 skill: wechat.friend.accept。",
    "目标：使用 Agent-S 操作本机微信，处理“新的朋友”中尚未处理的好友申请。",
    "禁止：不要只改任务状态，不要把打开申请页当作已通过，不要伪造成功。",
    "动作顺序：",
    "1. 打开本机微信并进入“通讯录 > 新的朋友”。",
    "2. 逐条读取申请人、申请语和当前状态，已经处理的直接跳过。",
    input.matchKeywords.length
      ? `3. 只处理申请语包含这些关键词的对象：${input.matchKeywords.join("、")}。`
      : "3. 处理当前列表中目标明确且状态正常的待处理申请。",
    "4. 点击接受后回读联系人状态，确认已经进入通讯录。",
    `5. 备注策略：${input.remarkStrategy}；${input.remarkContent ? `备注内容：${input.remarkContent}` : "没有固定备注内容。"}`,
    input.welcomeMessage
      ? `6. 通过后发送欢迎语：${input.welcomeMessage}`
      : "6. 通过后不主动发送欢迎语。",
    `每天最多处理 ${input.dailyLimit} 条。`,
    input.mode === "auto-send"
      ? "执行策略：目标明确、申请状态和账号正常时自动通过；对象不确定、出现风控或无法回读时停止。"
      : "执行策略：每条通过前等待确认。",
    input.context ? `补充要求：${input.context}` : null,
    "成功标准：每个对象必须有接受后的联系人回读或截图；欢迎语只有发送后回读可见才算完成。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildWechatMomentsMarketingInstruction(
  input: Pick<
    Required<WechatMomentsMarketingSkillInput>,
    | "mode"
    | "marketingMode"
    | "contacts"
    | "dailyViewLimit"
    | "randomBrowseCount"
    | "actions"
    | "commentMode"
    | "fixedComment"
    | "content"
    | "targetComments"
    | "context"
  >,
) {
  return [
    "你正在执行 skill: wechat.moments.marketing。",
    "目标：使用本机微信桌面客户端执行朋友圈营销计划。",
    "执行器：必须使用 Agent-S 桌面控制和 local-controller 操作本机微信。",
    "禁止：不要只生成评论文案，不要只创建任务，不要无节制批量点赞或评论，不要伪造成功。",
    "营销方式：",
    input.marketingMode === "random"
      ? "随机营销：从朋友圈信息流按计划浏览公开内容。"
      : "定向营销：按指定联系人进入其朋友圈主页执行动作。",
    "执行动作设置：",
    input.actions.like ? "自动点赞：开启。" : "自动点赞：关闭。",
    input.actions.comment ? "自动评论：开启。" : "自动评论：关闭。",
    input.commentMode === "ai"
      ? "评论方式：使用AI智能生成评论。"
      : "评论方式：使用固定评论内容。",
    `每天查看条数：${input.dailyViewLimit}`,
    input.marketingMode === "random"
      ? `随机浏览条数：${input.randomBrowseCount}`
      : null,
    input.contacts.length ? "联系人列表：" : null,
    ...input.contacts.map((target, index) => `${index + 1}. ${target}`),
    input.targetComments.length ? "逐个目标评论：" : null,
    ...input.targetComments.map(
      (item, index) => `${index + 1}. ${item.targetName}：${item.commentText}`,
    ),
    input.content ? `营销文案或评论基调：${input.content}` : null,
    input.fixedComment ? `固定评论内容：${input.fixedComment}` : null,
    input.context ? `补充要求：${input.context}` : null,
    "阻断规则：微信未登录、朋友圈入口不可用、联系人不一致、频繁操作提示、验证码、账号风险提示、评论框回读不一致时必须停止并回报卡点。",
    "成功标准：每次浏览、点赞、评论都要记录对象、内容、时间、结果和截图。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildVideoTemplateClipInstruction(
  input: Required<VideoTemplateClipSkillInput>,
) {
  return [
    "你正在执行 skill: video.template.clip。",
    "目标：按产品视频剪辑流程，把素材整理成可发布的视频成品。",
    "执行器：优先使用本机可用的视频工坊、自动上传素材库或系统内置剪辑能力；不能直接剪辑时要生成明确的剪辑任务和阻断原因。",
    "禁止：不要只写文案，不要只返回建议，不要伪造输出文件。",
    "动作顺序：",
    "1. 检查素材路径是否存在，并列出可用视频、图片、音频素材。",
    "2. 按模板整理镜头顺序、片头、主体、结尾和字幕文案。",
    "3. 生成标题、正文、标签和平台差异化文案。",
    "4. 能调用本机剪辑能力时输出真实视频文件；不能调用时保留任务、素材清单和需要人工补齐的原因。",
    "5. 输出结果要能进入聚合发布。",
    `素材路径：${input.materialPath}`,
    `剪辑模板：${input.templateName}`,
    input.titlePrompt ? `AI文案要求：${input.titlePrompt}` : null,
    `输出名称：${input.outputName}`,
    input.platformHints.length
      ? `发布平台：${input.platformHints.join("、")}`
      : null,
    input.context ? `补充要求：${input.context}` : null,
    "成功标准：只有生成可打开的视频文件、文案和任务记录，才算完成剪辑。",
  ]
    .filter(Boolean)
    .join("\n");
}

export const wechatLiveAutoReplySkill: InteractionSkillDefinition<WechatLiveAutoReplySkillInput> =
  {
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

export const wechatSessionAutoReplySkill: InteractionSkillDefinition<WechatSessionAutoReplySkillInput> =
  {
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
        instruction: buildWechatSessionInstruction({
          mode,
          contact,
          reply,
          context,
        }),
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
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
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

export const wechatGroupBroadcastSkill: InteractionSkillDefinition<WechatGroupBroadcastSkillInput> =
  {
    id: WECHAT_GROUP_SKILL_ID,
    title: "微信群发",
    executor: "agent-s-desktop",
    source: "skillhub",
    skillhubSlug: "wechat-auto-reply",
    requiredCommands: ["wechat-auto-reply"],
    buildRunRequest(input) {
      const personalizedMessages = (input.personalizedMessages || [])
        .map((item) => ({
          target: item.target.trim(),
          message: item.message.trim(),
        }))
        .filter((item) => item.target && item.message)
        .slice(0, 200);
      const targets = (personalizedMessages.length
        ? personalizedMessages.map((item) => item.target)
        : input.targets
      )
        .map((target) => target.trim())
        .filter(Boolean);
      if (!targets.length) {
        throw new Error("缺少群或联系人列表");
      }
      const message = personalizedMessages.length
        ? personalizedMessages[0].message
        : requireText(input.message, "群发内容");
      const mode = input.mode;
      const context = input.context?.trim() || "";
      const planName = input.planName?.trim() || "";
      const planType =
        input.planType === "scheduled" ? "scheduled" : "immediate";
      const planTime = input.planTime?.trim() || "";
      const associatedWeChat = input.associatedWeChat?.trim() || "";
      const files = (input.files || [])
        .map((file) => file.trim())
        .filter(Boolean)
        .slice(0, 20);
      const tags = (input.tags || [])
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
      const intervalSeconds = Math.max(
        5,
        Math.min(Math.floor(input.intervalSeconds || 30), 3600),
      );
      const dailyLimit = Math.max(
        1,
        Math.min(Math.floor(input.dailyLimit || 20), 200),
      );
      const commercialExecutionRequested = mode === "auto-send";

      return {
        skillId: WECHAT_GROUP_SKILL_ID,
        sessionName: `wechat-group-broadcast-${Date.now()}`,
        taskType: WECHAT_GROUP_SKILL_ID,
        instruction: buildWechatGroupInstruction({
          mode,
          targets,
          message,
          personalizedMessages,
          planName,
          planType,
          planTime,
          associatedWeChat,
          generateOnDemand: input.generateOnDemand === true,
          chunkedSending: input.chunkedSending === true,
          files,
          context,
          tags,
          intervalSeconds,
          dailyLimit,
        }),
        metadata: {
          skill_id: WECHAT_GROUP_SKILL_ID,
          source: "ops-workbench-wechat-groups",
          agent_s_business_scenario: WECHAT_GROUP_SKILL_ID,
          planName: planName || null,
          wechat_plan_name: planName || null,
          wechat_plan_kind: "mass-send",
          planType,
          wechat_mass_send_plan_type: planType,
          planTime: planTime || null,
          wechat_plan_time: planTime || null,
          associatedWeChat: associatedWeChat || null,
          wechat_plan_associated_wechat_id: associatedWeChat || null,
          generateOnDemand: input.generateOnDemand === true,
          chunkedSending: input.chunkedSending === true,
          wechat_mass_send_chunked_sending: input.chunkedSending === true,
          massSendFiles: files,
          wechat_mass_send_files: files,
          wechat_group_targets: targets,
          wechat_mass_send_contents: personalizedMessages.length
            ? personalizedMessages.map((item) => ({
                targetName: item.target,
                targetNo: item.target,
                sendContent: item.message,
                groupType: "personalized",
              }))
            : targets.map((target) => ({
                targetName: target,
                targetNo: target,
                sendContent: message,
                groupType: "ordinary",
              })),
          wechat_mass_send_mode: personalizedMessages.length
            ? "personalized"
            : "ordinary",
          wechat_group_tags: tags,
          wechat_group_interval_seconds: intervalSeconds,
          wechat_group_daily_limit: dailyLimit,
          wechat_reply_draft: message,
          wechat_reply_mode: mode,
          wechat_context_note: context || null,
          allow_desktop_action_execution: true,
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
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

export const wechatContactAddSkill: InteractionSkillDefinition<WechatContactAddSkillInput> =
  {
    id: WECHAT_CONTACT_ADD_SKILL_ID,
    title: "自动加好友",
    executor: "agent-s-desktop",
    source: "skillhub",
    skillhubSlug: "wechat-contact-add",
    requiredCommands: ["wechat-contact-add"],
    buildRunRequest(input) {
      const targets = input.targets
        .map((target) => target.trim())
        .filter(Boolean);
      if (!targets.length) {
        throw new Error("缺少加好友目标");
      }
      const verifyMessage = requireText(input.verifyMessage, "验证消息");
      const mode = input.mode;
      const planName = input.planName?.trim() || "";
      const remarkStrategy = input.remarkStrategy || "none";
      const remarkContent = input.remarkContent?.trim() || "";
      const minIntervalSeconds = Math.max(
        1,
        Math.min(Math.floor(input.minIntervalSeconds || 180), 86400),
      );
      const maxIntervalSeconds = Math.max(
        minIntervalSeconds,
        Math.min(Math.floor(input.maxIntervalSeconds || 36000), 86400),
      );
      const dailyLimit = Math.max(
        1,
        Math.min(Math.floor(input.dailyLimit || 10), 50),
      );
      const blacklist = (input.blacklist || [])
        .map((item) => item.trim())
        .filter(Boolean);
      const context = input.context?.trim() || "";
      const commercialExecutionRequested = mode === "auto-send";

      return {
        skillId: WECHAT_CONTACT_ADD_SKILL_ID,
        sessionName: `wechat-contact-add-${Date.now()}`,
        taskType: WECHAT_CONTACT_ADD_SKILL_ID,
        instruction: buildWechatContactAddInstruction({
          mode,
          targets,
          verifyMessage,
          planName,
          remarkStrategy,
          remarkContent,
          minIntervalSeconds,
          maxIntervalSeconds,
          dailyLimit,
          blacklist,
          context,
        }),
        metadata: {
          skill_id: WECHAT_CONTACT_ADD_SKILL_ID,
          source: "ops-workbench-wechat-contact-add",
          agent_s_business_scenario: WECHAT_CONTACT_ADD_SKILL_ID,
          planName: planName || null,
          wechat_plan_name: planName || null,
          wechat_plan_kind: "contact-add",
          wechat_contact_add_targets: targets,
          wechat_contact_add_verify_message: verifyMessage,
          verifyMessage,
          wechat_contact_add_remark_strategy: remarkStrategy,
          wechat_contact_add_remark_content: remarkContent || null,
          remarkStrategy,
          remarkContent: remarkContent || null,
          wechat_contact_add_min_interval_seconds: minIntervalSeconds,
          wechat_contact_add_max_interval_seconds: maxIntervalSeconds,
          minIntervalSeconds,
          maxIntervalSeconds,
          wechat_contact_add_daily_limit: dailyLimit,
          wechat_contact_add_blacklist: blacklist,
          dailyLimit,
          blacklist,
          wechat_reply_mode: mode,
          wechat_context_note: context || null,
          allow_desktop_action_execution: true,
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
          commercialExecutionRequested,
        },
        labels: ["wechat", "contact-add", "ops-workbench", "skill"],
        riskLevel: "high",
        requiresApproval: !commercialExecutionRequested,
        localControllerPermissionMode: "custom",
        commercialExecutionRequested,
      };
    },
  };

export const wechatFriendAcceptSkill: InteractionSkillDefinition<WechatFriendAcceptSkillInput> =
  {
    id: WECHAT_FRIEND_ACCEPT_SKILL_ID,
    title: "自动通过好友",
    executor: "agent-s-desktop",
    source: "skillhub",
    skillhubSlug: "wechat-friend-accept",
    requiredCommands: ["wechat-friend-accept"],
    buildRunRequest(input) {
      const mode = input.mode;
      const planName = input.planName?.trim() || "自动通过好友";
      const remarkStrategy = input.remarkStrategy || "request_name";
      const remarkContent = input.remarkContent?.trim() || "";
      const welcomeMessage = input.welcomeMessage?.trim() || "";
      const matchKeywords = (input.matchKeywords || [])
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 20);
      const dailyLimit = Math.max(
        1,
        Math.min(Math.floor(input.dailyLimit || 20), 100),
      );
      const context = input.context?.trim() || "";
      const commercialExecutionRequested = mode === "auto-send";
      return {
        skillId: WECHAT_FRIEND_ACCEPT_SKILL_ID,
        sessionName: `wechat-friend-accept-${Date.now()}`,
        taskType: WECHAT_FRIEND_ACCEPT_SKILL_ID,
        instruction: buildWechatFriendAcceptInstruction({
          mode,
          planName,
          remarkStrategy,
          remarkContent,
          welcomeMessage,
          matchKeywords,
          dailyLimit,
          context,
        }),
        metadata: {
          skill_id: WECHAT_FRIEND_ACCEPT_SKILL_ID,
          source: "ops-workbench-wechat-friend-accept",
          agent_s_business_scenario: WECHAT_FRIEND_ACCEPT_SKILL_ID,
          wechat_plan_name: planName,
          wechat_plan_kind: "friend-accept",
          wechat_friend_accept_remark_strategy: remarkStrategy,
          wechat_friend_accept_remark_content: remarkContent || null,
          wechat_friend_accept_welcome_message: welcomeMessage || null,
          wechat_friend_accept_match_keywords: matchKeywords,
          wechat_friend_accept_daily_limit: dailyLimit,
          wechat_reply_mode: mode,
          wechat_context_note: context || null,
          allow_desktop_action_execution: true,
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
          commercialExecutionRequested,
        },
        labels: ["wechat", "friend-accept", "ops-workbench", "skill"],
        riskLevel: "high",
        requiresApproval: !commercialExecutionRequested,
        localControllerPermissionMode: "custom",
        commercialExecutionRequested,
      };
    },
  };

export const wechatMomentsPublishSkill: InteractionSkillDefinition<WechatMomentsPublishSkillInput> =
  {
    id: WECHAT_MOMENTS_SKILL_ID,
    title: "朋友圈发布",
    executor: "agent-s-desktop",
    source: "skillhub",
    skillhubSlug: "wechat-sender",
    requiredCommands: ["wechat-moments-publish"],
    buildRunRequest(input) {
      const content = requireText(input.content, "朋友圈文案");
      const mode = input.mode;
      const planName = input.planName?.trim() || "";
      const planDescription = input.planDescription?.trim() || "";
      const additionalComment = input.additionalComment?.trim() || "";
      const visibility = input.visibility?.trim() || "默认可见范围";
      const context = input.context?.trim() || "";
      const assetPath = requireText(input.assetPath || "", "朋友圈素材路径");
      const assetHints = input.assetHints || [];
      const details = (
        input.details || [
          {
            content,
            additionalComment,
            attachments: assetPath ? [assetPath] : [],
            scheduledPublishTime: input.scheduleStartTime?.trim() || undefined,
            visibility,
          },
        ]
      )
        .map((item) => ({
          content: item.content.trim(),
          additionalComment: item.additionalComment?.trim() || "",
          attachments: (item.attachments || [])
            .map((file) => file.trim())
            .filter(Boolean),
          scheduledPublishTime: item.scheduledPublishTime?.trim() || "",
          visibility: item.visibility?.trim() || visibility,
          status: "pending",
        }))
        .filter((item) => item.content)
        .slice(0, 100);
      const totalCount = Math.max(
        1,
        Math.min(Math.floor(input.totalCount || details.length || 1), 100),
      );
      const publishIntervalMinutes = Math.max(
        0,
        Math.min(Math.floor(input.publishIntervalMinutes || 0), 1440),
      );
      const dailyPublished = normalizePositiveInteger(
        input.dailyPublished,
        0,
        10000,
      );
      const dailyQuota = normalizePositiveInteger(input.dailyQuota, 1, 100);
      const scheduleStartTime = input.scheduleStartTime?.trim() || null;
      const recordSummary = input.recordSummary?.trim() || null;
      const prompts = normalizeMomentPrompts(input.prompts);
      const visibilityCode = normalizeMomentsVisibility(visibility);
      const visibilityAutomationSupported = details.every(
        (item) => normalizeMomentsVisibility(item.visibility) === "public",
      );
      const commercialExecutionRequested = mode === "auto-send";

      return {
        skillId: WECHAT_MOMENTS_SKILL_ID,
        sessionName: `wechat-moments-publish-${Date.now()}`,
        taskType: WECHAT_MOMENTS_SKILL_ID,
        instruction: buildWechatMomentsInstruction({
          mode,
          content,
          visibility,
          context,
          assetHints,
          assetPath,
        }),
        metadata: {
          skill_id: WECHAT_MOMENTS_SKILL_ID,
          source: "ops-workbench-wechat-moments",
          agent_s_business_scenario: WECHAT_MOMENTS_SKILL_ID,
          wechat_moments_content: content,
          planName: planName || null,
          wechat_plan_name: planName || null,
          wechat_plan_kind: "moments-publish",
          planDescription: planDescription || null,
          wechat_moments_plan_description: planDescription || null,
          wechat_moments_additional_comment: additionalComment || null,
          wechat_moments_visibility: visibility,
          wechat_moments_visibility_code: visibilityCode,
          wechat_moments_visibility_automation_supported:
            visibilityAutomationSupported,
          wechat_moments_visibility_blocker: visibilityAutomationSupported
            ? null
            : "当前只能自动发布公开可见的朋友圈；其他可见范围会逐条停止，不影响其余明细。",
          wechat_moments_asset_path: assetPath,
          wechat_moments_details: details,
          momentsDetails: details,
          wechat_moments_total_tasks: totalCount,
          momentsTotalCount: totalCount,
          wechat_moments_publish_interval_minutes: publishIntervalMinutes,
          publishIntervalMinutes,
          dailyPublished,
          dailyQuota,
          scheduleStartTime,
          recordSummary,
          prompts,
          wechat_moments_daily_published: dailyPublished,
          wechat_moments_daily_quota: dailyQuota,
          wechat_moments_schedule_start_time: scheduleStartTime,
          wechat_moments_record_summary: recordSummary,
          wechat_moments_prompts: prompts,
          wechat_reply_mode: mode,
          wechat_context_note: context || null,
          allow_desktop_action_execution: true,
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
          commercialExecutionRequested,
        },
        labels: ["wechat", "moments-publish", "ops-workbench", "skill"],
        riskLevel: "high",
        requiresApproval: !commercialExecutionRequested,
        localControllerPermissionMode: "custom",
        commercialExecutionRequested,
      };
    },
  };

export const wechatMomentsMarketingSkill: InteractionSkillDefinition<WechatMomentsMarketingSkillInput> =
  {
    id: WECHAT_MOMENTS_MARKETING_SKILL_ID,
    title: "朋友圈营销",
    executor: "agent-s-desktop",
    source: "skillhub",
    skillhubSlug: "wechat-moments-marketing",
    requiredCommands: ["wechat-moments-marketing"],
    buildRunRequest(input) {
      const mode = input.mode;
      const planName = input.planName?.trim() || "";
      const contacts = (input.contacts || [])
        .map((target) => target.trim())
        .filter(Boolean);
      if (input.marketingMode === "targeted" && contacts.length === 0) {
        throw new Error("定向营销需要联系人列表");
      }
      const content = input.content?.trim() || "";
      const fixedComment = input.fixedComment?.trim() || "";
      const autoLike = input.autoLike ?? input.actions.like;
      const autoComment = input.autoComment ?? input.actions.comment;
      const actions = {
        like: autoLike,
        comment: autoComment,
      };
      if (actions.comment && input.commentMode === "fixed" && !fixedComment) {
        throw new Error("固定评论模式需要填写评论内容");
      }
      const context = input.context?.trim() || "";
      const dailyViewLimit = Math.max(
        1,
        Math.min(Math.floor(input.dailyViewLimit || 20), 100),
      );
      const checkIntervalMinutes = Math.max(
        1,
        Math.min(Math.floor(input.checkIntervalMinutes || 30), 1440),
      );
      const dailyPublished = normalizePositiveInteger(
        input.dailyPublished,
        0,
        10000,
      );
      const dailyQuota = normalizePositiveInteger(
        input.dailyQuota,
        dailyViewLimit,
        100,
      );
      const scheduleStartTime = input.scheduleStartTime?.trim() || null;
      const recordSummary = input.recordSummary?.trim() || null;
      const prompts = normalizeMomentPrompts(input.prompts);
      const targetComments = (input.targetComments || [])
        .map((item) => ({
          targetName: item.targetName.trim(),
          commentText: item.commentText.trim(),
        }))
        .filter((item) => item.targetName && item.commentText)
        .slice(0, 100);
      const randomBrowseCount =
        input.marketingMode === "random"
          ? Math.max(
              1,
              Math.min(
                Math.floor(input.randomBrowseCount || dailyViewLimit),
                dailyViewLimit,
                100,
              ),
            )
          : 0;
      const commercialExecutionRequested = mode === "auto-send";

      return {
        skillId: WECHAT_MOMENTS_MARKETING_SKILL_ID,
        sessionName: `wechat-moments-marketing-${Date.now()}`,
        taskType: WECHAT_MOMENTS_MARKETING_SKILL_ID,
        instruction: buildWechatMomentsMarketingInstruction({
          mode,
          marketingMode: input.marketingMode,
          contacts,
          dailyViewLimit,
          actions,
          commentMode: input.commentMode,
          fixedComment,
          content,
          targetComments,
          randomBrowseCount,
          context,
        }),
        metadata: {
          skill_id: WECHAT_MOMENTS_MARKETING_SKILL_ID,
          source: "ops-workbench-wechat-moments-marketing",
          agent_s_business_scenario: WECHAT_MOMENTS_MARKETING_SKILL_ID,
          planName: planName || null,
          wechat_plan_name: planName || null,
          wechat_plan_kind: "moments-marketing",
          wechat_moments_marketing_mode: input.marketingMode,
          wechat_moments_marketing_contacts: contacts,
          wechat_moments_marketing_check_interval_minutes: checkIntervalMinutes,
          checkIntervalMinutes,
          wechat_moments_marketing_actions: actions,
          wechat_moments_marketing_comment_mode: input.commentMode,
          wechat_moments_marketing_daily_limit: dailyViewLimit,
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
          wechat_moments_marketing_random_browse_count: randomBrowseCount,
          wechat_moments_marketing_target_comments: targetComments,
          wechat_moments_marketing_content: content || null,
          wechat_moments_marketing_fixed_comment: fixedComment || null,
          wechat_reply_mode: mode,
          wechat_context_note: context || null,
          allow_desktop_action_execution: true,
          agent_s_execution_policy: commercialExecutionRequested
            ? "auto_execute"
            : "approval_execute",
          commercialExecutionRequested,
        },
        labels: ["wechat", "moments-marketing", "ops-workbench", "skill"],
        riskLevel: "high",
        requiresApproval: !commercialExecutionRequested,
        localControllerPermissionMode: "custom",
        commercialExecutionRequested,
      };
    },
  };

export const videoTemplateClipSkill: InteractionSkillDefinition<VideoTemplateClipSkillInput> =
  {
    id: VIDEO_TEMPLATE_CLIP_SKILL_ID,
    title: "产品视频剪辑",
    executor: "agent-s-desktop",
    source: "local",
    buildRunRequest(input) {
      const materialPath = requireText(input.materialPath, "素材路径");
      const templateName = requireText(input.templateName, "剪辑模板");
      const titlePrompt = input.titlePrompt?.trim() || "";
      const outputName =
        input.outputName?.trim() || `ai-employee-video-${Date.now()}.mp4`;
      const platformHints = input.platformHints || [];
      const context = input.context?.trim() || "";

      return {
        skillId: VIDEO_TEMPLATE_CLIP_SKILL_ID,
        sessionName: `video-template-clip-${Date.now()}`,
        taskType: VIDEO_TEMPLATE_CLIP_SKILL_ID,
        instruction: buildVideoTemplateClipInstruction({
          materialPath,
          templateName,
          titlePrompt,
          outputName,
          platformHints,
          context,
        }),
        metadata: {
          skill_id: VIDEO_TEMPLATE_CLIP_SKILL_ID,
          source: "ops-workbench-video-template-clip",
          agent_s_business_scenario: VIDEO_TEMPLATE_CLIP_SKILL_ID,
          video_material_path: materialPath,
          video_template_name: templateName,
          video_title_prompt: titlePrompt || null,
          video_output_name: outputName,
          video_platform_hints: platformHints,
          agent_s_execution_policy: "approval_execute",
          commercialExecutionRequested: false,
        },
        labels: ["video", "template-clip", "ops-workbench", "skill"],
        riskLevel: "medium",
        requiresApproval: true,
        localControllerPermissionMode: "custom",
        commercialExecutionRequested: false,
      };
    },
  };

export const interactionSkillRegistry = {
  [WECHAT_LIVE_SKILL_ID]: wechatLiveAutoReplySkill,
  [WECHAT_SESSION_SKILL_ID]: wechatSessionAutoReplySkill,
  [WECHAT_GROUP_SKILL_ID]: wechatGroupBroadcastSkill,
  [WECHAT_CONTACT_ADD_SKILL_ID]: wechatContactAddSkill,
  [WECHAT_FRIEND_ACCEPT_SKILL_ID]: wechatFriendAcceptSkill,
  [WECHAT_MOMENTS_SKILL_ID]: wechatMomentsPublishSkill,
  [WECHAT_MOMENTS_MARKETING_SKILL_ID]: wechatMomentsMarketingSkill,
  [VIDEO_TEMPLATE_CLIP_SKILL_ID]: videoTemplateClipSkill,
} satisfies Partial<
  Record<InteractionSkillId, InteractionSkillDefinition<unknown>>
>;
