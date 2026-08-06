// local-engine 执行器状态簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 ExecutorsHost 接口：
// requiredInteractionExecutorIds/executorsStatusCache/desktopStatusWithEvidenceCache 字段、
// useNodeAgentRuntime（本 service）、desktop-status 簇与 desktop-evidence 簇方法。

import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type { AutoUploadWechatDesktopStatus } from '../auto-upload/auto-upload.client';
import type {
  InteractionTaskType,
  LocalEngineDesktopCommercialPreflight,
  LocalEngineDesktopStatus,
  LocalEngineExecutorCapability,
  LocalEngineExecutorsStatus,
  LocalEngineDesktopScreenshotEvidence,
} from './local-engine.types';
import {
  isDesktopWechatExecutionReady,
  optionalTrimmedText,
} from './local-engine.utils';

export const BROWSER_INTERACTION_EXECUTOR_IDS = [
  'douyin-comment-reply',
  'douyin-direct-message-reply',
  'wechat-channel-comment-reply',
  'wechat-channel-direct-message-reply',
] as const;

export const DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS = [
  'wechat-reply-draft',
  'wechat-friend-accept',
  'wechat-group-broadcast',
  'wechat-contact-add',
  'wechat-moments-publish',
  'wechat-moments-marketing',
] as const;

export const ALL_INTERACTION_EXECUTOR_IDS = [
  ...BROWSER_INTERACTION_EXECUTOR_IDS,
  ...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS,
] as const;

export const LOCAL_ENGINE_STATUS_CACHE_TTL_MS = 5000;

/** 执行器状态簇的 host 接口：簇方法访问的 service 成员 */
export interface ExecutorsHost {
  runtimeOrchestrator: RuntimeOrchestrator;
  requiredInteractionExecutorIds: string[];
  executorsStatusCache: {
    value: LocalEngineExecutorsStatus;
    expiresAt: number;
  } | null;
  desktopStatusWithEvidenceCache: {
    value: LocalEngineDesktopStatus;
    expiresAt: number;
  } | null;
  useNodeAgentRuntime(): boolean;
  buildDesktopStatus(
    desktop: AutoUploadWechatDesktopStatus,
    checkedAt: string,
    screenState?: LocalEngineDesktopScreenshotEvidence,
  ): LocalEngineDesktopStatus;
  readWechatDesktopStatus(): Promise<AutoUploadWechatDesktopStatus>;
  isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus): boolean;
  buildDesktopCommercialPreflight(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineDesktopCommercialPreflight;
  captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence>;
  rememberDesktopEvidence(
    evidence?: LocalEngineDesktopScreenshotEvidence | null,
  ): void;
  getCachedExecutorsStatus(ttlMs?: number): Promise<LocalEngineExecutorsStatus>;
  loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus>;
  loadWechatDesktopExecutorCapabilities(): Promise<
    LocalEngineExecutorCapability[]
  >;
  mergeExecutorCapabilities(
    executors: LocalEngineExecutorCapability[],
  ): LocalEngineExecutorCapability[];
  getRequiredInteractionExecutorIdsForCurrentHost(): string[];
  mapRuntimeHealthToExecutorCapability(h: {
    id: string;
    ok: boolean;
    details?: string;
  }): LocalEngineExecutorCapability;
  readDesktopStatusForExecutorList(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus>;
  buildWechatDesktopExecutorCapabilities(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineExecutorCapability[];
  getDesktopStatus(): Promise<LocalEngineDesktopStatus>;
  readDesktopStatusWithEvidenceCached(
    checkedAt: string,
    ttlMs?: number,
  ): Promise<LocalEngineDesktopStatus>;
  readDesktopStatusWithEvidence(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus>;
}

export async function getExecutorsStatus(
  this: ExecutorsHost,
): Promise<LocalEngineExecutorsStatus> {
  return this.getCachedExecutorsStatus();
}

export function getRequiredInteractionExecutorIdsForCurrentHost(
  this: ExecutorsHost,
): string[] {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return this.requiredInteractionExecutorIds;
  }
  return [...BROWSER_INTERACTION_EXECUTOR_IDS];
}

export function getUnsupportedInteractionExecutorIdsForCurrentHost(
  this: ExecutorsHost,
): string[] {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return [];
  }
  return [...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS];
}

export async function getCachedExecutorsStatus(
  this: ExecutorsHost,
  ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
): Promise<LocalEngineExecutorsStatus> {
  const now = Date.now();
  if (this.executorsStatusCache && this.executorsStatusCache.expiresAt > now) {
    return this.executorsStatusCache.value;
  }

  const value = await this.loadExecutorsStatus();
  this.executorsStatusCache = {
    value,
    expiresAt: now + ttlMs,
  };
  return value;
}

export async function loadExecutorsStatus(
  this: ExecutorsHost,
): Promise<LocalEngineExecutorsStatus> {
  let healths: Array<{ id: string; ok: boolean; details?: string }>;
  try {
    healths = (await this.runtimeOrchestrator?.healthCheck()) ?? [
      { id: 'agent-s', ok: false, details: 'RuntimeOrchestrator 未注入' },
      {
        id: 'local-runtime',
        ok: false,
        details: 'RuntimeOrchestrator 未注入',
      },
    ];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    healths = [
      {
        id: 'agent-s',
        ok: false,
        details: `浏览器平台能力读取失败：${message}`,
      },
      {
        id: 'local-runtime',
        ok: false,
        details: `浏览器平台能力读取失败：${message}`,
      },
    ];
  }

  const runtimeExecutors: LocalEngineExecutorCapability[] = healths.map((h) =>
    this.mapRuntimeHealthToExecutorCapability(h),
  );
  const desktopExecutors = await this.loadWechatDesktopExecutorCapabilities();
  const executors = this.mergeExecutorCapabilities([
    ...runtimeExecutors,
    ...desktopExecutors,
  ]);
  const requiredExecutorIds =
    this.getRequiredInteractionExecutorIdsForCurrentHost();
  const interactionExecutors = executors.filter((executor) =>
    requiredExecutorIds.includes(String(executor.key)),
  );

  return {
    checkedAt: new Date().toISOString(),
    summary: {
      total: interactionExecutors.length,
      ready: interactionExecutors.filter((e) => e.status === 'ready').length,
      preflightOnly: interactionExecutors.filter(
        (e) => e.status === 'preflight_only',
      ).length,
      missing: interactionExecutors.filter((e) => e.status === 'missing')
        .length,
    },
    executors,
  };
}

export function mergeExecutorCapabilities(
  this: ExecutorsHost,
  executors: LocalEngineExecutorCapability[],
): LocalEngineExecutorCapability[] {
  const merged = new Map<string, LocalEngineExecutorCapability>();
  for (const executor of executors) {
    merged.set(String(executor.key), executor);
  }
  return Array.from(merged.values());
}

export async function loadWechatDesktopExecutorCapabilities(
  this: ExecutorsHost,
): Promise<LocalEngineExecutorCapability[]> {
  const checkedAt = new Date().toISOString();
  const desktop = await this.readDesktopStatusForExecutorList(checkedAt);
  return this.buildWechatDesktopExecutorCapabilities(desktop);
}

export async function readDesktopStatusForExecutorList(
  this: ExecutorsHost,
  checkedAt: string,
): Promise<LocalEngineDesktopStatus> {
  const now = Date.now();
  if (
    this.desktopStatusWithEvidenceCache &&
    this.desktopStatusWithEvidenceCache.expiresAt > now
  ) {
    return {
      ...this.desktopStatusWithEvidenceCache.value,
      checkedAt,
    };
  }

  const desktop = await this.readWechatDesktopStatus();
  return this.buildDesktopStatus(desktop, checkedAt);
}

export function buildWechatDesktopExecutorCapabilities(
  this: ExecutorsHost,
  desktop: LocalEngineDesktopStatus,
): LocalEngineExecutorCapability[] {
  const runnable = this.isDesktopWechatRuntimeRunnable(desktop);
  const status: LocalEngineExecutorCapability['status'] =
    isDesktopWechatExecutionReady(desktop) || runnable
      ? 'ready'
      : desktop.running
        ? 'preflight_only'
        : 'missing';
  const ready = status === 'ready';
  const message = ready
    ? '桌面微信、执行脚本、截图、输入、点击和自动发送能力可用。'
    : desktop.blockers[0] || desktop.message || '桌面微信不可用。';
  const nextAction = ready
    ? '可创建微信任务；auto-send 会调用本机微信脚本执行并保存证据。'
    : desktop.nextAction ||
      '请打开桌面微信并确认本机微信脚本、辅助功能和屏幕录制权限可用。';
  const definitions: Array<{ key: InteractionTaskType; name: string }> = [
    { key: 'wechat-reply-draft', name: '微信会话回复' },
    { key: 'wechat-friend-accept', name: '通过好友' },
    { key: 'wechat-group-broadcast', name: '微信群发' },
    { key: 'wechat-contact-add', name: '自动加好友' },
    { key: 'wechat-moments-publish', name: '朋友圈发布' },
    { key: 'wechat-moments-marketing', name: '朋友圈运营' },
  ];

  return definitions.map((definition) => ({
    key: definition.key,
    name: definition.name,
    platformName: '桌面微信',
    status,
    entryPreflight: ready,
    targetRead: ready,
    replyGenerate: ready,
    controlledSend: ready,
    autoSend: ready,
    message,
    nextAction,
  }));
}

export function mapRuntimeHealthToExecutorCapability(
  this: ExecutorsHost,
  h: {
    id: string;
    ok: boolean;
    details?: string;
  },
): LocalEngineExecutorCapability {
  if (h.id === 'agent-s' && this.useNodeAgentRuntime()) {
    return {
      key: 'agent-s-legacy-desktop',
      name: '旧 Agent-S 桌面执行器',
      platformName: '微信桌面',
      status: 'optional',
      entryPreflight: false,
      targetRead: false,
      replyGenerate: false,
      controlledSend: false,
      autoSend: false,
      message: h.ok
        ? `${h.details ?? 'Node Runtime Agent-S 在线'}。旧 17777 桌面 sidecar 不再作为微信任务入口。`
        : `旧 Python/桌面 Agent-S 未运行：${h.details || '未返回详情'}。当前微信桌面任务走本机 Node Runtime 和 SkillHub 脚本。`,
      nextAction: h.ok
        ? '以微信完整执行链和具体任务状态判断是否可用。'
        : '无需启动 17777；请以微信完整执行链的进程、权限、脚本和确认后执行检查为准。',
    };
  }
  if (h.id === 'local-runtime') {
    return {
      key: 'local-runtime',
      name: '本地互动编排器',
      platformName: '3011 Runtime',
      status: h.ok ? 'optional' : 'missing',
      entryPreflight: h.ok,
      targetRead: false,
      replyGenerate: false,
      controlledSend: false,
      autoSend: false,
      message:
        h.details ?? (h.ok ? '本地互动编排器在线。' : '本地互动编排器不可用。'),
      nextAction: h.ok
        ? '客户互动是否可用以四条平台执行器为准。'
        : '检查 RuntimeOrchestrator 与 LocalRuntimeClient 装配。',
    };
  }
  if (h.id === 'platform-publish') {
    return {
      key: 'platform-publish',
      name: '内容发布执行器',
      platformName: '发布中心',
      status: h.ok ? 'optional' : 'missing',
      entryPreflight: h.ok,
      targetRead: false,
      replyGenerate: false,
      controlledSend: false,
      autoSend: false,
      message:
        h.details ?? (h.ok ? '内容发布执行器在线。' : '内容发布执行器不可用。'),
      nextAction: h.ok
        ? '内容发布能力单独验收，不计入客户互动四条链路。'
        : '检查 PlatformPublishService 健康状态。',
    };
  }
  if (h.id === 'video-template-clip') {
    return {
      key: 'video-template-clip',
      name: '视频剪辑执行器',
      platformName: '视频工坊',
      status: h.ok ? 'optional' : 'missing',
      entryPreflight: h.ok,
      targetRead: h.ok,
      replyGenerate: false,
      controlledSend: false,
      autoSend: false,
      message:
        h.details ?? (h.ok ? '视频剪辑执行器在线。' : '视频剪辑执行器不可用。'),
      nextAction: h.ok
        ? '可以从 AI 员工创建视频剪辑任务，成功结果会进入聚合发布素材。'
        : '检查本机 ffmpeg 是否可用。',
    };
  }
  if (h.id === 'video-face-swap') {
    return {
      key: 'video-face-swap',
      name: '视频换脸执行器',
      platformName: '视频工坊',
      status: 'optional',
      entryPreflight: h.ok,
      targetRead: h.ok,
      replyGenerate: h.ok,
      controlledSend: false,
      autoSend: false,
      message: h.ok
        ? (h.details ?? '视频换脸引擎在线。')
        : '视频换脸引擎尚未安装；只影响视频换脸页面，不影响常规内容创作、发布和客户互动。',
      nextAction: h.ok
        ? '进入视频换脸页面时会继续检查素材授权、生成环境和计费。'
        : '需要使用视频换脸时，在视频换脸页面完成 FaceFusion 安装；不使用时无需处理。',
    };
  }

  const status: LocalEngineExecutorCapability['status'] = h.ok
    ? 'ready'
    : h.id === 'agent-s'
      ? 'missing'
      : 'missing';

  return {
    key: h.id as InteractionTaskType,
    name: h.id,
    platformName: h.id === 'agent-s' ? '微信桌面' : '浏览器 CDP',
    status,
    entryPreflight: h.ok,
    targetRead: h.ok,
    replyGenerate: h.ok,
    controlledSend: h.ok,
    autoSend: h.ok,
    message: h.details ?? (h.ok ? '执行器就绪' : '执行器未就绪'),
    nextAction: h.ok
      ? '可以开始执行互动任务。'
      : '请检查 RuntimeOrchestrator.healthCheck() 返回的 details。',
  };
}

export async function getDesktopStatus(
  this: ExecutorsHost,
): Promise<LocalEngineDesktopStatus> {
  const checkedAt = new Date().toISOString();
  return this.readDesktopStatusWithEvidence(checkedAt);
}

export async function readDesktopStatusWithEvidenceCached(
  this: ExecutorsHost,
  checkedAt: string,
  ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
): Promise<LocalEngineDesktopStatus> {
  const now = Date.now();
  if (
    this.desktopStatusWithEvidenceCache &&
    this.desktopStatusWithEvidenceCache.expiresAt > now
  ) {
    return {
      ...this.desktopStatusWithEvidenceCache.value,
      checkedAt,
    };
  }

  const value = await this.readDesktopStatusWithEvidence(checkedAt);
  this.desktopStatusWithEvidenceCache = {
    value,
    expiresAt: now + ttlMs,
  };
  return value;
}

export async function readDesktopStatusWithEvidence(
  this: ExecutorsHost,
  checkedAt: string,
): Promise<LocalEngineDesktopStatus> {
  const desktop = await this.readWechatDesktopStatus();
  const screenshot = await this.captureDesktopScreenshot(
    '桌面微信窗口状态截图',
  ).catch((error) => ({
    type: 'text' as const,
    label: '桌面截图不可用',
    value: error instanceof Error ? error.message : '桌面截图失败',
    capturedAt: checkedAt,
    trusted: false,
    diagnostic: error instanceof Error ? error.message : '桌面截图失败',
  }));
  if (screenshot) {
    this.rememberDesktopEvidence(screenshot);
  }

  return this.buildDesktopStatus(desktop, checkedAt, screenshot);
}

export async function getDesktopCommercialPreflight(
  this: ExecutorsHost,
): Promise<LocalEngineDesktopCommercialPreflight> {
  const desktop = await this.getDesktopStatus();
  return this.buildDesktopCommercialPreflight(desktop);
}

export const executorsMethods = {
  getExecutorsStatus,
  getRequiredInteractionExecutorIdsForCurrentHost,
  getUnsupportedInteractionExecutorIdsForCurrentHost,
  getCachedExecutorsStatus,
  loadExecutorsStatus,
  mergeExecutorCapabilities,
  loadWechatDesktopExecutorCapabilities,
  readDesktopStatusForExecutorList,
  buildWechatDesktopExecutorCapabilities,
  mapRuntimeHealthToExecutorCapability,
  getDesktopStatus,
  readDesktopStatusWithEvidenceCached,
  readDesktopStatusWithEvidence,
  getDesktopCommercialPreflight,
};
