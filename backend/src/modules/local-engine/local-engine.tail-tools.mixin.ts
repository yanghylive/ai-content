/**
 * 尾部小工具簇 mixin（类型映射/agent 事件/平台标签/恢复执行）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { BadRequestException } from '@nestjs/common';
import type { AutoUploadPublishPayload } from '../auto-upload/auto-upload.client';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import { createId } from './local-engine.utils';

import type {
  AgentConfirmation,
  AgentExecutionScope,
  AgentSessionEvent,
  AgentSessionStatus,
  AgentRiskLevel,
  AgentSession,
  AgentSessionResumeAction,
  InteractionReplyRuleConfig,
  CreateInteractionTaskInput,
  InteractionBusinessRouteKey,
  InteractionTask,
  InteractionTaskStatus,
  InteractionTaskType,
  LocalEngineSafetyCheck,
} from './local-engine.types';

/** 尾部小工具簇的 host 接口 */
export interface TailToolsHost {
  autoUploadService: AutoUploadService;
  resolveBusinessTaskType(
    key: InteractionBusinessRouteKey,
    input?: Partial<CreateInteractionTaskInput>,
  ): InteractionTaskType;
  resolveBusinessTaskTypes(
    key: InteractionBusinessRouteKey,
  ): InteractionTaskType[];
  isKnownInteractionTaskType(type: string): type is InteractionTaskType;
  isWechatChannelBusinessInput(
    input: Partial<CreateInteractionTaskInput>,
  ): boolean;
  isRuleTone(value: unknown): value is InteractionReplyRuleConfig['tone'];
  resolveTypeLabel(type: InteractionTaskType): string;
  resolveStatusLabel(status: InteractionTaskStatus): string;
  resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ): Promise<void>;
  runAutoUploadPublishResume(
    session: AgentSession,
    action: Extract<AgentSessionResumeAction, { kind: 'auto-upload-publish' }>,
    _confirmation: AgentConfirmation,
  ): Promise<void>;
  normalizeAutoUploadPublishPayloads(
    payloads: unknown[],
  ): AutoUploadPublishPayload[];
  pushAgentEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ): void;
  createAgentConfirmation(
    session: AgentSession,
    input: {
      title: string;
      description: string;
      actionLabel: string;
      riskLevel: Exclude<AgentRiskLevel, 'low'>;
    },
  ): AgentConfirmation;
  createInteractionTaskConfirmation(task: InteractionTask): AgentConfirmation;
  resolveAgentScopeLabel(scope: AgentExecutionScope): string;
  resolveAgentSessionStatusLabel(status: AgentSessionStatus): string;
  resolvePlatformName(type: number): string;
  isSamePlatformAccount(
    selected: { type?: number; name?: string },
    actual: { type?: number; name?: string },
  ): boolean;
  resolveTaskPlatformAccount(input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  }): { type?: number; name?: string };
  resolvePlatformKey(input: {
    type?: number;
    name?: string;
  }): string | undefined;
  createAgentConfirmationChecks(
    session: AgentSession,
    riskLevel: Exclude<AgentRiskLevel, 'low'>,
  ): LocalEngineSafetyCheck[];
  persistAgentSession(session: AgentSession): Promise<void>;
}

export function resolveBusinessTaskType(
  this: TailToolsHost,
  key: InteractionBusinessRouteKey,
  input: Partial<CreateInteractionTaskInput> = {},
): InteractionTaskType {
  if (input.type && this.isKnownInteractionTaskType(input.type)) {
    return input.type;
  }
  if (this.isWechatChannelBusinessInput(input)) {
    if (key === 'comments') return 'wechat-channel-comment-reply';
    if (key === 'messages') return 'wechat-channel-direct-message-reply';
  }

  const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType> = {
    comments: 'douyin-comment-reply',
    messages: 'douyin-direct-message-reply',
    'channel-comments': 'wechat-channel-comment-reply',
    'channel-messages': 'wechat-channel-direct-message-reply',
    wechat: 'wechat-reply-draft',
    groups: 'wechat-group-broadcast',
    moments: 'wechat-moments-publish',
    customers: 'customer-follow-up',
  };

  return mapping[key];
}

export function resolveBusinessTaskTypes(
  this: TailToolsHost,
  key: InteractionBusinessRouteKey,
): InteractionTaskType[] {
  const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType[]> = {
    comments: ['douyin-comment-reply'],
    messages: ['douyin-direct-message-reply'],
    'channel-comments': ['wechat-channel-comment-reply'],
    'channel-messages': ['wechat-channel-direct-message-reply'],
    wechat: ['wechat-reply-draft', 'wechat-friend-accept'],
    groups: ['wechat-group-broadcast'],
    moments: ['wechat-moments-publish', 'wechat-moments-marketing'],
    customers: [
      'customer-follow-up',
      'wechat-contact-add',
      'wechat-friend-accept',
    ],
  };

  return mapping[key];
}

export function isKnownInteractionTaskType(
  this: TailToolsHost,
  type: string,
): type is InteractionTaskType {
  return [
    'douyin-comment-reply',
    'douyin-direct-message-reply',
    'wechat-channel-comment-reply',
    'wechat-channel-direct-message-reply',
    'wechat-reply-draft',
    'wechat-friend-accept',
    'wechat-group-broadcast',
    'wechat-contact-add',
    'wechat-moments-publish',
    'wechat-moments-marketing',
    'customer-follow-up',
  ].includes(type);
}

export function isWechatChannelBusinessInput(
  this: TailToolsHost,
  input: Partial<CreateInteractionTaskInput>,
): boolean {
  return (
    input.platformType === 2 ||
    /视频号|wechat[-_ ]?channel|channel/i.test(
      `${input.platformName || ''} ${input.type || ''}`,
    )
  );
}

export function isRuleTone(
  this: TailToolsHost,
  value: unknown,
): value is InteractionReplyRuleConfig['tone'] {
  return value === 'warm' || value === 'professional' || value === 'concise';
}

export function resolveTypeLabel(
  this: TailToolsHost,
  type: InteractionTaskType,
): string {
  const labels: Record<InteractionTaskType, string> = {
    'douyin-comment-reply': '抖音自动评论',
    'douyin-direct-message-reply': '抖音私信回复',
    'wechat-channel-comment-reply': '视频号评论回复',
    'wechat-channel-direct-message-reply': '视频号私信回复',
    'wechat-reply-draft': '微信回复草稿',
    'wechat-friend-accept': '接受微信好友请求',
    'wechat-group-broadcast': '微信群发',
    'wechat-contact-add': '自动加好友',
    'wechat-moments-publish': '朋友圈发布',
    'wechat-moments-marketing': '朋友圈营销',
    'customer-follow-up': '客户跟进',
  };
  return labels[type];
}

export function resolveStatusLabel(
  this: TailToolsHost,
  status: InteractionTaskStatus,
): string {
  const labels: Record<InteractionTaskStatus, string> = {
    queued: '排队中',
    running: '执行中',
    paused: '已暂停',
    blocked: '已阻断',
    waiting_for_send_confirmation: '等待继续执行',
    cancelled: '已取消',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过',
    no_target: '无对象',
  };
  return labels[status];
}

export async function resumeAgentSessionAfterApproval(
  this: TailToolsHost,
  session: AgentSession,
  confirmation: AgentConfirmation,
): Promise<void> {
  if (session.resumeAction?.kind === 'agentwaker-handoff') {
    session.status = 'completed';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
    session.nextAction = `内容已批准进入发布准备，可前往 ${session.resumeAction.targetHref} 继续处理。`;
    this.pushAgentEvent(
      session,
      'success',
      '运营助理产物已批准',
      `${session.resumeAction.label}。本次仅完成内容交接，没有向平台执行发布。`,
      {
        type: 'stage_log',
        label: 'AgentWaker 内容交接',
        value: JSON.stringify(
          {
            articleId: session.resumeAction.articleId,
            role: session.resumeAction.role,
            workflow: session.resumeAction.workflow,
            targetHref: session.resumeAction.targetHref,
            confirmationId: confirmation.id,
          },
          null,
          2,
        ),
        stageKey: 'agentwaker-handoff',
      },
    );
    await this.persistAgentSession(session);
    return;
  }
  if (session.resumeAction?.kind === 'auto-upload-publish') {
    await this.runAutoUploadPublishResume(
      session,
      session.resumeAction,
      confirmation,
    );
    return;
  }
}

export async function runAutoUploadPublishResume(
  this: TailToolsHost,
  session: AgentSession,
  action: Extract<AgentSessionResumeAction, { kind: 'auto-upload-publish' }>,
  _confirmation: AgentConfirmation,
): Promise<void> {
  void _confirmation;
  try {
    this.pushAgentEvent(
      session,
      'info',
      '开始真实发布',
      `${action.label} 已通过确认，正在提交给 3011 本地 Runtime。`,
    );
    const payloads = this.normalizeAutoUploadPublishPayloads(action.payloads);
    if (!payloads.length) {
      throw new BadRequestException('真实发布 payload 为空，无法继续执行');
    }
    this.pushAgentEvent(
      session,
      'info',
      '发布参数已锁定',
      `即将提交 ${payloads.length} 个平台任务，素材 ${new Set(payloads.flatMap((payload) => payload.fileList)).size} 个。`,
      {
        type: 'text',
        label: '发布 payload 摘要',
        value: JSON.stringify(
          payloads.map((payload) => ({
            platform: this.resolvePlatformName(payload.type),
            title: payload.title,
            accountCount: payload.accountList.length,
            materialCount: payload.fileList.length,
            timer: payload.enableTimer === 1,
            dryRun: payload.debugDryRun,
          })),
          null,
          2,
        ),
      },
    );
    const preflight =
      await this.autoUploadService.preflightPublishBatch(payloads);
    this.pushAgentEvent(
      session,
      preflight.ok ? 'success' : 'error',
      preflight.ok ? '发布 preflight 通过' : '发布 preflight 阻断',
      preflight.summary,
      {
        type: preflight.ok ? 'diagnostic_bundle' : 'failure_reason',
        label: '发布 preflight 矩阵',
        value: JSON.stringify(preflight, null, 2),
        stageKey: 'publish-preflight',
      },
    );
    if (!preflight.ok) {
      throw new BadRequestException(preflight.summary);
    }
    session.status = 'waiting_for_confirmation';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.completedAt = undefined;
    session.nextAction =
      '发布草稿和发布前检查已保留；请进入发布中心核对本批内容并取得服务端一次性确认。';
    this.pushAgentEvent(
      session,
      'warning',
      '旧发布续跑入口已阻断',
      `已保留 ${payloads.length} 个发布草稿和 preflight 结果；内部 Agent 确认不能替代与当前批次绑定的服务端一次性发布票，本次未向任何平台提交。`,
      {
        type: 'text',
        label: '发布草稿',
        value: JSON.stringify(payloads, null, 2),
      },
    );
  } catch (error) {
    session.status = 'failed';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.completedAt = new Date().toISOString();
    session.nextAction = '真实发布续跑失败，请检查本地发布引擎状态。';
    this.pushAgentEvent(
      session,
      'error',
      '真实发布续跑失败',
      error instanceof Error ? error.message : '未知错误',
    );
  } finally {
    session.updatedAt = new Date().toISOString();
    this.persistAgentSession(session).catch((error) => {
      console.warn('[local-engine] persist agent publish resume failed', error);
    });
  }
}

export function normalizeAutoUploadPublishPayloads(
  this: TailToolsHost,
  payloads: unknown[],
): AutoUploadPublishPayload[] {
  if (!Array.isArray(payloads)) {
    return [];
  }
  return payloads
    .filter((payload): payload is AutoUploadPublishPayload => {
      const candidate = payload as AutoUploadPublishPayload;
      return Boolean(
        candidate &&
        typeof candidate.type === 'number' &&
        typeof candidate.title === 'string' &&
        Array.isArray(candidate.tags) &&
        Array.isArray(candidate.fileList) &&
        Array.isArray(candidate.accountList),
      );
    })
    .map((payload) => ({
      ...payload,
      debugDryRun: false,
      debugDryRunHoldBrowser: false,
    }));
}

export function pushAgentEvent(
  this: TailToolsHost,
  session: AgentSession,
  level: AgentSessionEvent['level'],
  title: string,
  message: string,
  evidence?: AgentSessionEvent['evidence'],
): void {
  const now = new Date().toISOString();
  session.events.push({
    id: createId(),
    sessionId: session.id,
    level,
    title,
    message,
    createdAt: now,
    evidence,
  });
  session.updatedAt = now;
}

export function createAgentConfirmation(
  this: TailToolsHost,
  session: AgentSession,
  input: {
    title: string;
    description: string;
    actionLabel: string;
    riskLevel: Exclude<AgentRiskLevel, 'low'>;
  },
): AgentConfirmation {
  return {
    id: createId(),
    tenantId: session.tenantId,
    userId: session.userId,
    sessionId: session.id,
    title: input.title,
    description: input.description,
    actionLabel: input.actionLabel,
    riskLevel: input.riskLevel,
    status: 'pending',
    confirmationMode:
      input.riskLevel === 'high' ? 'double-confirmation' : 'standard',
    requiredChecks: this.createAgentConfirmationChecks(
      session,
      input.riskLevel,
    ),
    safetyBoundary: session.safetyBoundary,
    misfireProtection: session.misfireProtection,
    riskPolicy: session.riskPolicy,
    commercialPermissionRequired:
      session.safetyBoundary?.permissionStatus !== 'allowed',
    trialLimited: session.safetyBoundary?.trialLimited,
    blockedReason: session.safetyBoundary?.blockedActions.length
      ? session.safetyBoundary.blockedActions.join('、')
      : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function createInteractionTaskConfirmation(
  this: TailToolsHost,
  task: InteractionTask,
): AgentConfirmation {
  const typeLabel = this.resolveTypeLabel(task.type);
  return {
    id: createId(),
    tenantId: task.tenantId,
    userId: task.userId,
    sessionId: `interaction-task:${task.id}`,
    title: `继续执行${typeLabel}回复`,
    description: `客户原文：${task.sourceText}\nAI 回复：${task.replyText}`,
    actionLabel: '继续执行',
    riskLevel: 'medium',
    status: 'pending',
    confirmationMode: 'standard',
    requiredChecks: [
      {
        key: 'target',
        label: '目标确认',
        required: true,
        blocking: false,
        category: 'target',
        status: 'ready',
      },
      {
        key: 'content',
        label: '内容确认',
        required: true,
        blocking: false,
        category: 'content',
        status: 'ready',
      },
    ],
    createdAt: new Date().toISOString(),
  };
}

export function resolveAgentScopeLabel(
  this: TailToolsHost,
  scope: AgentExecutionScope,
): string {
  const labels: Record<AgentExecutionScope, string> = {
    browser: '浏览器任务',
    desktop: '桌面任务',
    'local-files': '本机文件',
    remote: '远程任务',
    mixed: '浏览器和桌面混合',
  };
  return labels[scope];
}

export function resolveAgentSessionStatusLabel(
  this: TailToolsHost,
  status: AgentSessionStatus,
): string {
  const labels: Record<AgentSessionStatus, string> = {
    draft: '草稿',
    running: '执行中',
    waiting_for_confirmation: '待继续',
    completed: '已完成',
    failed: '失败',
    cancelled: '已停止',
  };
  return labels[status];
}

export function resolvePlatformName(this: TailToolsHost, type: number): string {
  const labels: Record<number, string> = {
    1: '小红书',
    2: '视频号',
    3: '抖音',
    4: '快手',
    5: 'B站',
  };
  return labels[type] || `平台 ${type}`;
}

export function isSamePlatformAccount(
  this: TailToolsHost,
  selected: { type?: number; name?: string },
  actual: { type?: number; name?: string },
): boolean {
  const selectedKey = this.resolvePlatformKey(selected);
  const actualKey = this.resolvePlatformKey(actual);
  if (selectedKey && actualKey) {
    return selectedKey === actualKey;
  }
  return selected.type === actual.type;
}

export function resolveTaskPlatformAccount(
  this: TailToolsHost,
  input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  },
): { type?: number; name?: string } {
  if (input.platformType || input.platformName) {
    return { type: input.platformType, name: input.platformName };
  }
  if (input.type.startsWith('wechat-channel')) {
    return { type: 2, name: '视频号' };
  }
  if (input.type.startsWith('douyin')) {
    return { type: 3, name: '抖音' };
  }
  return { type: input.platformType, name: input.platformName };
}

export function resolvePlatformKey(
  this: TailToolsHost,
  input: { type?: number; name?: string },
): string | undefined {
  const name = input.name?.trim().toLowerCase();
  if (name) {
    if (name.includes('douyin') || name.includes('抖音')) return 'douyin';
    if (
      name.includes('wechat-channel') ||
      name.includes('channel') ||
      name.includes('视频号')
    ) {
      return 'wechat-channel';
    }
    if (name.includes('xiaohongshu') || name.includes('小红书')) {
      return 'xiaohongshu';
    }
    if (name.includes('kuaishou') || name.includes('快手')) return 'kuaishou';
    if (name.includes('bilibili') || name.includes('b站')) return 'bilibili';
  }
  const keys: Record<number, string> = {
    1: 'xiaohongshu',
    2: 'wechat-channel',
    3: 'douyin',
    4: 'kuaishou',
    5: 'bilibili',
  };
  return typeof input.type === 'number' ? keys[input.type] : undefined;
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const tailToolsMethods = {
  resolveBusinessTaskType,
  resolveBusinessTaskTypes,
  isKnownInteractionTaskType,
  isWechatChannelBusinessInput,
  isRuleTone,
  resolveTypeLabel,
  resolveStatusLabel,
  resumeAgentSessionAfterApproval,
  runAutoUploadPublishResume,
  normalizeAutoUploadPublishPayloads,
  pushAgentEvent,
  createAgentConfirmation,
  createInteractionTaskConfirmation,
  resolveAgentScopeLabel,
  resolveAgentSessionStatusLabel,
  resolvePlatformName,
  isSamePlatformAccount,
  resolveTaskPlatformAccount,
  resolvePlatformKey,
};
