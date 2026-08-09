import type {
  ExecutorTask,
  ExecutorTaskPlatform,
  ExecutorTaskType,
} from '../executor.interface';

export type AiEmployeeDomain =
  | 'douyin-acquisition'
  | 'wechat-service'
  | 'wechat-broadcast'
  | 'wechat-moments'
  | 'video-creation'
  | 'multi-platform-publish';

export type AiEmployeeCapabilityKey =
  | 'douyin-link-exposure'
  | 'douyin-search-account-exposure'
  | 'douyin-hot-video-exposure'
  | 'douyin-targeted-exposure'
  | 'douyin-retention-exposure'
  | 'wechat-session-reply'
  | 'wechat-group-broadcast'
  | 'wechat-contact-add'
  | 'wechat-moments-publish'
  | 'wechat-moments-marketing'
  | 'video-template-clip'
  | 'publish-douyin-video'
  | 'publish-douyin-image-text'
  | 'publish-xiaohongshu-video'
  | 'publish-xiaohongshu-image-text'
  | 'publish-kuaishou-video'
  | 'publish-kuaishou-image-text'
  | 'publish-wechat-channel-video'
  | 'publish-wechat-channel-image-text'
  | 'publish-bilibili-video';

export type AiEmployeeRuntimePath =
  | 'local-runtime-browser'
  | 'local-runtime-video'
  | 'agent-s-desktop'
  | 'platform-publish'
  | 'not-integrated';

export interface AiEmployeeCapabilityContract {
  key: AiEmployeeCapabilityKey;
  domain: AiEmployeeDomain;
  title: string;
  referenceWorkflow: string;
  platform: ExecutorTaskPlatform;
  runtimePath: AiEmployeeRuntimePath;
  routeableNow: boolean;
  executorTaskType?: ExecutorTaskType;
  phase0Spike: boolean;
  acceptance: string[];
  blockers: string[];
}

export interface AiEmployeePhase0Spike {
  id: string;
  title: string;
  capabilityKeys: AiEmployeeCapabilityKey[];
  proofRequired: string[];
  exitCriteria: string[];
}

export const AI_EMPLOYEE_CAPABILITIES: readonly AiEmployeeCapabilityContract[] =
  [
    {
      key: 'douyin-link-exposure',
      domain: 'douyin-acquisition',
      title: '抖音链接曝光',
      referenceWorkflow:
        '导入抖音视频链接，读取评论区，筛选评论用户后私信或追加评论。',
      platform: 'douyin',
      runtimePath: 'local-runtime-browser',
      routeableNow: true,
      executorTaskType: 'douyin-link-exposure',
      phase0Spike: true,
      acceptance: [
        '能打开真实抖音视频链接并识别登录态。',
        '能读取至少一屏评论文本并形成候选触达对象。',
        '能把关键词、时间、地区、黑名单、企业号过滤规则固化为任务 payload。',
        '能把候选评论转成评论/私信跟进任务，并按自动/受控执行规则推进。',
      ],
      blockers: ['真实抖音账号完整闭环和风控场景仍需验收。'],
    },
    {
      key: 'douyin-search-account-exposure',
      domain: 'douyin-acquisition',
      title: '抖音搜索账号曝光',
      referenceWorkflow:
        '按关键词搜索账号/作品，翻阅目标内容，再进入评论区执行触达。',
      platform: 'douyin',
      runtimePath: 'local-runtime-browser',
      routeableNow: true,
      executorTaskType: 'douyin-search-account-exposure',
      phase0Spike: true,
      acceptance: [
        '能按关键词进入抖音搜索结果页。',
        '能打开一个目标账号或作品并记录页面证据。',
        '能复用链接曝光的评论筛选 payload。',
        '能将搜索结果候选转入评论/私信跟进任务。',
      ],
      blockers: ['真实抖音搜索页排序和页面结构变化仍需验收。'],
    },
    {
      key: 'douyin-hot-video-exposure',
      domain: 'douyin-acquisition',
      title: '抖音爆款视频获客',
      referenceWorkflow:
        '按行业关键词搜索高互动视频，读取评论区并生成评论/私信跟进。',
      platform: 'douyin',
      runtimePath: 'local-runtime-browser',
      routeableNow: true,
      executorTaskType: 'douyin-hot-video-exposure',
      phase0Spike: true,
      acceptance: [
        '能按关键词打开抖音搜索结果页。',
        '能优先筛选视频/评论相关候选，保存截图证据。',
        '能把候选结果转成评论/私信后续任务，并按自动/受控执行规则推进。',
        '能记录每日上限、失败码和任务证据。',
      ],
      blockers: [
        '爆款排序依赖抖音页面可见互动数据，页面不展示时只能按搜索结果候选降级。',
      ],
    },
    {
      key: 'douyin-targeted-exposure',
      domain: 'douyin-acquisition',
      title: '抖音定向曝光',
      referenceWorkflow: '围绕指定账号或指定目标列表执行私信/评论。',
      platform: 'douyin',
      runtimePath: 'local-runtime-browser',
      routeableNow: true,
      executorTaskType: 'douyin-targeted-exposure',
      phase0Spike: false,
      acceptance: [
        '能读取目标账号列表并逐个进入抖音搜索页。',
        '能保存目标账号列表、每日上限和执行记录。',
        '能把搜索到的候选结果转成评论/私信后续任务，并按自动/受控执行规则推进。',
      ],
      blockers: ['精确账号主页识别和粉丝/作品深扫仍需后续增强。'],
    },
    {
      key: 'douyin-retention-exposure',
      domain: 'douyin-acquisition',
      title: '抖音留资曝光',
      referenceWorkflow: '针对留资/线索人群做后续触达。',
      platform: 'douyin',
      runtimePath: 'local-runtime-browser',
      routeableNow: true,
      executorTaskType: 'douyin-retention-exposure',
      phase0Spike: false,
      acceptance: [
        '能按留资来源或线索关键词进入抖音搜索页。',
        '能定义线索来源、触达状态和回访记录。',
        '能把读取到的候选结果转成评论/私信后续任务，并按自动/受控执行规则推进。',
      ],
      blockers: ['CRM 留资数据模型和外部线索导入仍需后续增强。'],
    },
    {
      key: 'wechat-session-reply',
      domain: 'wechat-service',
      title: '微信客服自动回复',
      referenceWorkflow: '读取微信会话和新消息，生成回复并执行发送或草稿确认。',
      platform: 'wechat-desktop',
      runtimePath: 'agent-s-desktop',
      routeableNow: true,
      executorTaskType: 'wechat-reply-draft',
      phase0Spike: true,
      acceptance: [
        '能检查 Agent-S/Node Runtime 健康状态。',
        '能读取或定位一个微信会话，并保存桌面证据。',
        '默认支持 draft-only，真实发送必须有证据和风控开关。',
      ],
      blockers: ['Windows 常用微信环境和登录态会影响验证。'],
    },
    {
      key: 'wechat-group-broadcast',
      domain: 'wechat-broadcast',
      title: '微信群发',
      referenceWorkflow: '群发计划、联系人选择、频控、暂停恢复、发送日志。',
      platform: 'wechat-desktop',
      runtimePath: 'agent-s-desktop',
      routeableNow: true,
      executorTaskType: 'wechat-group-broadcast',
      phase0Spike: false,
      acceptance: [
        '能以小批量联系人完成草稿或发送动作，并记录每个联系人结果。',
      ],
      blockers: ['真实微信群发小批量、暂停恢复和风控提示仍需验收。'],
    },
    {
      key: 'wechat-contact-add',
      domain: 'wechat-broadcast',
      title: '微信自动加好友',
      referenceWorkflow: '加好友计划、状态管理和失败记录。',
      platform: 'wechat-desktop',
      runtimePath: 'agent-s-desktop',
      routeableNow: true,
      executorTaskType: 'wechat-contact-add',
      phase0Spike: false,
      acceptance: [
        '能创建独立加好友任务，不混入客户跟进。',
        '能记录目标列表、验证消息、每日上限和黑名单。',
        '真实发送必须有目标回读和风控证据，目标或风控不通过时停止并留证据。',
        '普通失败能保留恢复信息，账号风控提示必须停止。',
      ],
      blockers: ['真实微信账号小流量加好友和风控提示仍需验收。'],
    },
    {
      key: 'wechat-moments-publish',
      domain: 'wechat-moments',
      title: '朋友圈发布',
      referenceWorkflow: '配置图文素材并自动发布朋友圈。',
      platform: 'wechat-desktop',
      runtimePath: 'agent-s-desktop',
      routeableNow: true,
      executorTaskType: 'wechat-moments-publish',
      phase0Spike: true,
      acceptance: [
        '能打开朋友圈发布入口。',
        '能填入文案和至少一张图片。',
        'auto-send 前必须能保存发布结果截图。',
      ],
      blockers: ['微信版本和 macOS/Windows 自动化差异需要单独验收。'],
    },
    {
      key: 'wechat-moments-marketing',
      domain: 'wechat-moments',
      title: '朋友圈随机/定向营销',
      referenceWorkflow: '随机或定向浏览朋友圈，执行点赞和 AI 评论。',
      platform: 'wechat-desktop',
      runtimePath: 'agent-s-desktop',
      routeableNow: true,
      executorTaskType: 'wechat-moments-marketing',
      phase0Spike: false,
      acceptance: [
        '能创建独立朋友圈营销任务，不混入朋友圈发布。',
        '能记录随机/定向模式、每日查看条数、点赞、评论和逐目标评论。',
        '随机模式能按朋友圈第 N 条形成执行队列，定向模式能按联系人生成个性化评论。',
        '真实点赞/评论必须有目标回读和证据，目标或风控不通过时停止并留证据。',
        '普通单条失败进入待恢复，账号风险提示必须停止。',
      ],
      blockers: ['真实微信朋友圈发布、随机互动、定向互动和坐标校准仍需验收。'],
    },
    {
      key: 'video-template-clip',
      domain: 'video-creation',
      title: '视频模板剪辑',
      referenceWorkflow: '素材库、模板、一键剪辑、AI 文案和下载结果。',
      platform: 'mixed',
      runtimePath: 'local-runtime-video',
      routeableNow: true,
      executorTaskType: 'video-template-clip',
      phase0Spike: false,
      acceptance: [
        '能读取本机素材文件或素材文件夹。',
        '能用本机 ffmpeg 生成 mp4 结果文件。',
        '剪辑成功后能把输出路径带入聚合发布素材。',
        '缺素材或 ffmpeg 不可用时不能误报成功。',
      ],
      blockers: ['复杂模板、自动字幕和多片段混剪仍需后续增强。'],
    },
    {
      key: 'publish-douyin-video',
      domain: 'multi-platform-publish',
      title: '抖音视频发布',
      referenceWorkflow: '聚合发布到抖音。',
      platform: 'douyin',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-video',
      phase0Spike: true,
      acceptance: [
        '能检查抖音创作者中心登录态，缺素材时阻断，成功时保存回读证据。',
      ],
      blockers: [],
    },
    {
      key: 'publish-douyin-image-text',
      domain: 'multi-platform-publish',
      title: '抖音图文发布',
      referenceWorkflow: '聚合发布到抖音图文。',
      platform: 'douyin',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-image-text',
      phase0Spike: false,
      acceptance: ['能发布图文并回到内容管理页或保存失败证据。'],
      blockers: [],
    },
    {
      key: 'publish-xiaohongshu-video',
      domain: 'multi-platform-publish',
      title: '小红书视频发布',
      referenceWorkflow: '聚合发布到小红书。',
      platform: 'xiaohongshu',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-video',
      phase0Spike: false,
      acceptance: ['能检查小红书登录态并保存发布证据。'],
      blockers: [],
    },
    {
      key: 'publish-xiaohongshu-image-text',
      domain: 'multi-platform-publish',
      title: '小红书图文发布',
      referenceWorkflow: '聚合发布到小红书图文。',
      platform: 'xiaohongshu',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-image-text',
      phase0Spike: false,
      acceptance: ['能发布图文并保存结果证据。'],
      blockers: [],
    },
    {
      key: 'publish-kuaishou-video',
      domain: 'multi-platform-publish',
      title: '快手视频发布',
      referenceWorkflow: '聚合发布到快手。',
      platform: 'kuaishou',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-video',
      phase0Spike: false,
      acceptance: ['能检查快手登录态并保存发布证据。'],
      blockers: [],
    },
    {
      key: 'publish-kuaishou-image-text',
      domain: 'multi-platform-publish',
      title: '快手图文发布',
      referenceWorkflow: '聚合发布到快手图文。',
      platform: 'kuaishou',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-image-text',
      phase0Spike: false,
      acceptance: ['能发布图文并保存结果证据。'],
      blockers: [],
    },
    {
      key: 'publish-wechat-channel-video',
      domain: 'multi-platform-publish',
      title: '视频号视频发布',
      referenceWorkflow: '聚合发布到视频号。',
      platform: 'wechat-channel',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-video',
      phase0Spike: false,
      acceptance: ['能检查视频号助手登录态并保存发布证据。'],
      blockers: [],
    },
    {
      key: 'publish-wechat-channel-image-text',
      domain: 'multi-platform-publish',
      title: '视频号图文发布',
      referenceWorkflow: '聚合发布到视频号图文。',
      platform: 'wechat-channel',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-image-text',
      phase0Spike: false,
      acceptance: ['能发布图文并保存结果证据。'],
      blockers: [],
    },
    {
      key: 'publish-bilibili-video',
      domain: 'multi-platform-publish',
      title: 'B站视频发布',
      referenceWorkflow: '聚合发布扩展平台。',
      platform: 'bilibili',
      runtimePath: 'platform-publish',
      routeableNow: true,
      executorTaskType: 'platform-publish-video',
      phase0Spike: false,
      acceptance: ['能检查 B 站登录态并保存发布证据。'],
      blockers: [],
    },
  ] as const;

export const AI_EMPLOYEE_PHASE0_SPIKES: readonly AiEmployeePhase0Spike[] = [
  {
    id: 'P0-S1',
    title: '抖音链接曝光评论读取 spike',
    capabilityKeys: ['douyin-link-exposure'],
    proofRequired: [
      '真实视频链接页面截图',
      '评论候选列表 JSON',
      '过滤规则 payload',
    ],
    exitCriteria: [
      '能稳定读到至少一屏评论',
      '失败时能区分未登录、验证码、页面结构变化',
    ],
  },
  {
    id: 'P0-S2',
    title: '抖音搜索账号曝光 spike',
    capabilityKeys: ['douyin-search-account-exposure'],
    proofRequired: [
      '搜索结果页截图',
      '目标账号/作品 URL',
      '进入评论区动作日志',
    ],
    exitCriteria: ['能按关键词找到目标', '能复用链接曝光过滤 payload'],
  },
  {
    id: 'P0-S3',
    title: '微信会话读取/回复 spike',
    capabilityKeys: ['wechat-session-reply'],
    proofRequired: ['Agent-S health', '微信会话截图', 'draft-only 回复证据'],
    exitCriteria: [
      '能证明微信桌面任务经 Agent-S 路由',
      '不走 local-runtime 浏览器路径',
    ],
  },
  {
    id: 'P0-S4',
    title: '朋友圈发布 spike',
    capabilityKeys: ['wechat-moments-publish'],
    proofRequired: [
      '朋友圈发布窗口截图',
      '文案和图片填充记录',
      '发布或草稿结果截图',
    ],
    exitCriteria: ['能打开发布入口', '能保存结果证据', 'auto-send 有显式开关'],
  },
  {
    id: 'P0-S5',
    title: '聚合发布 spike',
    capabilityKeys: ['publish-douyin-video'],
    proofRequired: [
      '平台发布 task payload',
      '登录态检查结果',
      '发布成功或阻断证据',
    ],
    exitCriteria: [
      '能通过 PlatformPublishService 路由',
      '缺素材/未登录不误报成功',
    ],
  },
] as const;

export function getAiEmployeeCapability(
  key: AiEmployeeCapabilityKey,
): AiEmployeeCapabilityContract {
  const capability = AI_EMPLOYEE_CAPABILITIES.find((item) => item.key === key);
  if (!capability) {
    throw new Error(`Unknown AI employee capability: ${key}`);
  }
  return capability;
}

export function listRouteableAiEmployeeCapabilities(): AiEmployeeCapabilityContract[] {
  return AI_EMPLOYEE_CAPABILITIES.filter((item) => item.routeableNow);
}

export function buildAiEmployeeExecutorTask(input: {
  capabilityKey: AiEmployeeCapabilityKey;
  relatedId: string;
  relatedType: ExecutorTask['relatedType'];
  accountId?: string;
  payload?: Record<string, unknown>;
}): ExecutorTask {
  const capability = getAiEmployeeCapability(input.capabilityKey);
  if (!capability.routeableNow || !capability.executorTaskType) {
    throw new Error(
      `${capability.key} is not routeable in Phase 0; blocker: ${capability.blockers[0] ?? 'not integrated'}`,
    );
  }

  return {
    relatedId: input.relatedId,
    relatedType: input.relatedType,
    type: capability.executorTaskType,
    platform: capability.platform,
    accountId: input.accountId,
    payload: {
      aiEmployeeCapability: capability.key,
      aiEmployeeDomain: capability.domain,
      ...(input.payload ?? {}),
    },
  };
}
