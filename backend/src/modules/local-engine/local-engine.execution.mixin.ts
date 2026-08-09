/**
 * execution contract 簇 mixin（执行契约/预检/阻断）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import { BadRequestException } from '@nestjs/common';
import { isDesktopInteractionTask } from './local-engine.utils';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';

import type {
  CreateInteractionTaskInput,
  InteractionBatchTarget,
  InteractionSendMode,
  InteractionTask,
  InteractionTaskEvent,
  InteractionTaskType,
  LocalEngineExecutorCapability,
  LocalEngineExecutorsStatus,
} from './local-engine.types';

/** execution contract 簇的 host 接口 */
export interface ExecutionHost {
  waitForLiveExecutor(task: InteractionTask): void;
  resolveExecutionContract(task: InteractionTask): Promise<
    | { ok: true }
    | {
        ok: false;
        failureReason?: string;
        stageKey?: string;
        nextAction?: string;
      }
    | undefined
  >;
  assertCreateExecutionPreflight(input: CreateInteractionTaskInput): Promise<
    | {
        accountName: string;
        platformType: number;
        platformName: string;
        capability: LocalEngineExecutorCapability;
      }
    | undefined
  >;
  buildExecutionContract(
    task: Pick<InteractionTask, 'type' | 'accountId' | 'accountName'> & {
      typeLabel?: string;
      platformType?: number;
      platformName?: string;
      sendMode?: InteractionSendMode;
    },
    options: {
      capability?: LocalEngineExecutorCapability;
      capabilityError?: string;
      requireReadyCapability: boolean;
      allowMissingAccountException: boolean;
    },
  ):
    | { ok: true }
    | {
        ok: false;
        failureReason?: string;
        stageKey?: string;
        nextAction?: string;
        status?: string;
        stepMessages?: unknown;
      };
  blockTaskForExecutionContract(
    task: InteractionTask,
    contract: {
      ok: false;
      stageKey?: string;
      failureReason?: string;
      nextAction?: string;
      [key: string]: unknown;
      stepMessages?: {
        accountEntry: string;
        targetRead: string;
        replyGenerate: string;
        sendApproval: string;
        sendResult: string;
      };
    },
  );
  autoUploadService: AutoUploadService;
  isLiveExecutorTask(type: InteractionTaskType): boolean;
  isSamePlatformAccount(
    selected: { type?: number; name?: string },
    actual: { type?: number; name?: string },
  ): boolean;
  loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus>;
  markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata?: unknown,
  ): Promise<void>;
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): void;
  requiresRealAccount(type: InteractionTaskType): boolean;
  resolveTaskPlatformAccount(input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  }): { type?: number; name?: string };
  resolveTypeLabel(type: InteractionTaskType): string;
  setTaskStep(
    task: InteractionTask,
    key: string,
    status: string,
    message?: string,
    details?: unknown,
  ): Promise<void>;
  updateTask(
    task: InteractionTask,
    status?: string,
    message?: string,
    details?: unknown,
  ): Promise<InteractionTask>;
}

export function waitForLiveExecutor(
  this: ExecutionHost,
  task: InteractionTask,
) {
  void this.setTaskStep(
    task,
    'environment',
    'completed',
    '基础执行环境检查完成。',
  );
  if (
    task.status === 'waiting_for_send_confirmation' ||
    task.status === 'blocked' ||
    task.status === 'paused'
  ) {
    return;
  }

  if (task.runtimeState === 'executor_missing') {
    void this.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      '真实读取器未返回内容，无法生成真实回复。',
    );
    void this.setTaskStep(
      task,
      'send-approval',
      'blocked',
      '真实回复未生成，不能进入受控执行。',
    );
    void this.setTaskStep(
      task,
      'send-result',
      'blocked',
      '真实浏览器服务未就绪。',
    );
    void this.markQueuedBatchTargets(
      task,
      'failed',
      '评论/私信/微信读取服务未就绪',
      {
        nextAction: '已打开账号入口；请检查真实页面读取和填充服务状态。',
      },
    );
    void this.updateTask(
      task,
      'blocked',
      '当前环境无法使用自动处理服务，已停在准备检查阶段。',
      {
        failureReason: '当前环境无法读取评论、私信或微信会话',
        nextAction:
          '已打开账号入口；下一步需要接入桌面版的真实页面读取和填充服务。',
        completedAt: new Date().toISOString(),
      },
    );
    this.pushEvent(
      task,
      'warning',
      '为避免误报，真实账号任务不会继续使用占位内容完成发送链路。',
    );
    this.pushEvent(task, 'error', '当前环境无法读取评论、私信或微信会话', {
      type: 'failure_reason',
      label: '失败原因',
      value: '当前环境无法读取评论、私信或微信会话',
      stageKey: 'send-result',
    });
    return;
  }

  void this.setTaskStep(
    task,
    'target-read',
    'blocked',
    '等待本地服务返回目标内容。',
  );
  void this.markQueuedBatchTargets(task, 'failed', '本地服务超时', {
    nextAction: '请检查 发布服务日志和浏览器控制状态。',
  });
  void this.updateTask(task, 'blocked', '本地服务未返回目标内容。', {
    failureReason: '本地服务超时',
    nextAction: '请检查 发布服务日志和浏览器控制状态。',
    completedAt: new Date().toISOString(),
  });
  this.pushEvent(task, 'error', '本地服务未返回目标内容。', {
    type: 'failure_reason',
    label: '失败原因',
    value: '本地服务超时',
    stageKey: 'target-read',
  });
}

export async function resolveExecutionContract(
  this: ExecutionHost,
  task: InteractionTask,
) {
  const baseContract = this.buildExecutionContract(task, {
    requireReadyCapability: false,
    allowMissingAccountException: false,
  });
  if (!baseContract.ok) {
    return baseContract;
  }

  // P3-D4: 旧 getStatus 已删；新路径走 RuntimeOrchestrator.healthCheck()（feature flag 后切换）
  const status = await this.loadExecutorsStatus();
  const capability = status.executors.find(
    (executor) => executor.key === (task as { type?: string }).type,
  );
  return this.buildExecutionContract(task, {
    capability,
    capabilityError:
      capability && 'error' in capability
        ? String(capability.error)
        : undefined,
    requireReadyCapability: true,
    allowMissingAccountException: false,
  });
}

export async function assertCreateExecutionPreflight(
  this: ExecutionHost,
  input: CreateInteractionTaskInput,
): Promise<
  | {
      accountName: string;
      platformType: number;
      platformName: string;
      capability: LocalEngineExecutorCapability;
    }
  | undefined
> {
  if (
    !this.requiresRealAccount(input.type) &&
    !isDesktopInteractionTask(input.type)
  ) {
    return undefined;
  }

  if (isDesktopInteractionTask(input.type)) {
    const status = await this.loadExecutorsStatus();
    const capability = status.executors.find(
      (executor) => executor.key === input.type,
    );
    const contract = this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId || 'wechat-desktop',
        accountName: input.accountName?.trim() || '桌面微信',
        platformType: input.platformType ?? 2,
        platformName: input.platformName || '微信',
        sendMode: input.sendMode,
      },
      {
        capability,
        capabilityError:
          capability && 'error' in capability
            ? String(capability.error)
            : undefined,
        requireReadyCapability: true,
        allowMissingAccountException: false,
      },
    );
    if (!contract.ok) {
      throw new BadRequestException(contract.failureReason);
    }
    if (!capability) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
      );
    }

    return {
      accountName: input.accountName?.trim() || '桌面微信',
      platformType: input.platformType ?? 2,
      platformName: input.platformName || '微信',
      capability,
    };
  }

  const baseContract = this.buildExecutionContract(
    {
      type: input.type,
      accountId: input.accountId,
      accountName: input.accountName?.trim() || '未指定账号',
      platformType: input.platformType,
      platformName: input.platformName,
      sendMode: input.sendMode,
    },
    {
      requireReadyCapability: false,
      allowMissingAccountException: false,
    },
  );
  if (!baseContract.ok) {
    throw new BadRequestException(baseContract.failureReason);
  }

  const accountId = input.accountId;
  let accounts: Awaited<ReturnType<AutoUploadService['listAccounts']>>;
  try {
    accounts = await this.autoUploadService.listAccounts({
      validate: false,
      ids: accountId ? [accountId] : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new BadRequestException(`本地平台账号预检失败：${message}`);
  }

  const requestedPlatform = this.resolveTaskPlatformAccount(input);
  const account =
    accounts.find(
      (item) =>
        String(item.id) === String(accountId) &&
        this.isSamePlatformAccount(requestedPlatform, {
          type: item.type,
          name: item.platform,
        }),
    ) || accounts.find((item) => String(item.id) === String(accountId));
  if (!account) {
    throw new BadRequestException(`本地平台账号不存在或不可读取：${accountId}`);
  }
  if (account.status !== 1) {
    throw new BadRequestException(
      `${this.resolveTypeLabel(input.type)}账号未登录或已失效：${account.profileName || account.userName || input.accountName || accountId}`,
    );
  }

  const platformType = input.platformType ?? account.type;
  if (
    !this.isSamePlatformAccount(
      {
        type: platformType,
        name: input.platformName,
      },
      {
        type: account.type,
        name: account.platform,
      },
    )
  ) {
    throw new BadRequestException(
      `账号平台类型不匹配：任务选择 ${input.platformName || `平台 ${platformType}`}，实际账号为 ${account.platform || `平台 ${account.type}`}。`,
    );
  }

  // P3-D4: 旧 getStatus 已删；现在从 RuntimeOrchestrator 拉真 capability
  const status = await this.loadExecutorsStatus();
  const capability = status.executors.find(
    (executor) => executor.key === input.type,
  );
  const contract = this.buildExecutionContract(
    {
      type: input.type,
      accountId: input.accountId,
      accountName:
        account.profileName ||
        account.userName ||
        input.accountName?.trim() ||
        '未指定账号',
      platformType,
      platformName: input.platformName || account.platform,
      sendMode: input.sendMode,
    },
    {
      capability,
      capabilityError:
        capability && 'error' in capability
          ? String(capability.error)
          : undefined,
      requireReadyCapability: true,
      allowMissingAccountException: false,
    },
  );
  if (!contract.ok) {
    throw new BadRequestException(contract.failureReason);
  }

  if (!capability) {
    throw new BadRequestException(
      `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
    );
  }

  return {
    accountName:
      account.profileName ||
      account.userName ||
      input.accountName?.trim() ||
      `账号 ${accountId}`,
    platformType,
    platformName: input.platformName || account.platform,
    capability,
  };
}

export function buildExecutionContract(
  this: ExecutionHost,
  task: Pick<InteractionTask, 'type' | 'accountId' | 'accountName'> & {
    typeLabel?: string;
    platformType?: number;
    platformName?: string;
    sendMode?: InteractionSendMode;
  },
  options: {
    capability?: LocalEngineExecutorCapability;
    capabilityError?: string;
    requireReadyCapability: boolean;
    allowMissingAccountException: boolean;
  },
) {
  const typeLabel = task.typeLabel || this.resolveTypeLabel(task.type);
  const requiresPlatformAccount = this.requiresRealAccount(task.type);
  const requiresDesktop = isDesktopInteractionTask(task.type);
  if (!requiresPlatformAccount && !requiresDesktop) {
    return { ok: true as const };
  }

  const accountId = String(task.accountId || '').trim();
  if (requiresPlatformAccount && !accountId) {
    const failureReason = `${typeLabel}缺少本地平台账号，不能执行真实平台任务。`;
    return {
      ok: false as const,
      stageKey: 'account-entry',
      failureReason,
      nextAction: options.allowMissingAccountException
        ? '请先选择已登录的平台账号；任务已保留为阻断态，可补齐账号后创建重试任务。'
        : '请先选择已登录的平台账号后创建重试任务。',
      stepMessages: {
        accountEntry: '未绑定已登录平台账号。',
        targetRead: '缺少账号，不能打开真实平台读取对象。',
        replyGenerate: '缺少真实对象，不能生成商用草稿。',
        sendApproval: '缺少真实内容，不能进入受控执行。',
        sendResult: '真实执行合同缺少账号。',
      },
    };
  }

  const numericAccountId = Number(accountId);
  if (
    requiresPlatformAccount &&
    (!Number.isInteger(numericAccountId) || numericAccountId <= 0)
  ) {
    const failureReason = `${typeLabel}账号 ID 无效：${accountId}`;
    return {
      ok: false as const,
      stageKey: 'account-entry',
      failureReason,
      nextAction: '请重新选择有效的本地平台账号后创建重试任务。',
      stepMessages: {
        accountEntry: '账号 ID 无效。',
        targetRead: '账号无效，不能打开真实平台读取对象。',
        replyGenerate: '缺少真实对象，不能生成商用草稿。',
        sendApproval: '缺少真实内容，不能进入受控执行。',
        sendResult: '真实执行合同缺少有效账号。',
      },
    };
  }

  if (!this.isLiveExecutorTask(task.type)) {
    const failureReason = `${typeLabel}自动化执行器未就绪`;
    return {
      ok: false as const,
      stageKey: 'executor-skip',
      failureReason,
      nextAction: '请检查该任务类型的执行器注册和健康状态。',
      stepMessages: {
        accountEntry: '已绑定账号，但该互动类型执行器未就绪。',
        targetRead: '没有真实读取能力，不能继续执行。',
        replyGenerate: '未读取到真实对象，不能生成真实草稿。',
        sendApproval: '未生成真实内容，不能进入受控执行。',
        sendResult: '自动化服务未就绪。',
      },
    };
  }

  if (!options.requireReadyCapability) {
    return { ok: true as const };
  }

  const capability = options.capability;
  if (!capability) {
    const failureReason = options.capabilityError
      ? `${typeLabel}能力预检失败：${options.capabilityError}`
      : `${typeLabel}缺少本地执行能力声明`;
    return {
      ok: false as const,
      stageKey: 'executor-capability',
      failureReason,
      nextAction: options.capabilityError
        ? '请启动或升级 3011 本地 Runtime，并确认互动能力清单可用。'
        : '请升级 3011 本地 Runtime，让互动能力声明包含入口、读取、草稿和发送能力。',
      stepMessages: {
        accountEntry: '账号已绑定，但本地引擎未声明该服务。',
        targetRead: '缺少读取能力声明，不能继续执行。',
        replyGenerate: '缺少回复生成能力声明。',
        sendApproval: '缺少受控草稿能力，不能进入确认。',
        sendResult: '真实执行能力未绑定。',
      },
    };
  }

  const contractSendMode = task.sendMode || 'approval-send';
  const requiresSendCapability =
    contractSendMode === 'auto-send'
      ? Boolean(capability.autoSend)
      : Boolean(capability.controlledSend);
  const missing = [
    capability.entryPreflight ? '' : 'account/executor preflight',
    capability.targetRead ? '' : 'target-read capability',
    capability.replyGenerate ? '' : 'reply-generate capability',
    requiresSendCapability
      ? ''
      : contractSendMode === 'auto-send'
        ? 'auto-send capability'
        : 'controlled-send capability',
  ].filter(Boolean);
  if (capability.status !== 'ready' || missing.length) {
    const failureReason = `${typeLabel}执行能力未就绪：${missing.join('、') || capability.message}`;
    return {
      ok: false as const,
      stageKey: 'executor-capability',
      failureReason,
      nextAction:
        capability.nextAction ||
        '请补齐真实读取、回复生成、发送执行和预检能力后重试。',
      stepMessages: {
        accountEntry: capability.entryPreflight
          ? '账号准备检查可用。'
          : '账号准备检查不可用。',
        targetRead: capability.targetRead
          ? '读取能力已声明。'
          : '缺少真实目标读取能力。',
        replyGenerate: capability.replyGenerate
          ? '回复生成能力已声明。'
          : '缺少真实回复生成能力。',
        sendApproval: requiresSendCapability
          ? '发送能力已声明。'
          : contractSendMode === 'auto-send'
            ? '缺少自动发送能力，不能直接发送。'
            : '缺少确认后草稿填入能力。',
        sendResult: capability.message,
      },
    };
  }

  return { ok: true as const };
}

export function blockTaskForExecutionContract(
  this: ExecutionHost,
  task: InteractionTask,
  contract: {
    ok: false;
    stageKey: string;
    failureReason: string;
    nextAction: string;
    stepMessages?: {
      accountEntry: string;
      targetRead: string;
      replyGenerate: string;
      sendApproval: string;
      sendResult: string;
    };
  },
) {
  const messages = contract.stepMessages;
  if (messages) {
    void this.setTaskStep(
      task,
      'account-entry',
      'blocked',
      messages.accountEntry,
    );
    void this.setTaskStep(task, 'target-read', 'blocked', messages.targetRead);
    void this.setTaskStep(
      task,
      'reply-generate',
      'blocked',
      messages.replyGenerate,
    );
    void this.setTaskStep(
      task,
      'send-approval',
      'blocked',
      messages.sendApproval,
    );
    void this.setTaskStep(task, 'send-result', 'blocked', messages.sendResult);
  }
  void this.markQueuedBatchTargets(task, 'failed', contract.failureReason, {
    nextAction: contract.nextAction,
  });
  task.runtimeState = 'executor_missing';
  void this.updateTask(
    task,
    'blocked',
    `${contract.failureReason}，任务已阻断。`,
    {
      failureReason: contract.failureReason,
      nextAction: contract.nextAction,
      completedAt: new Date().toISOString(),
    },
  );
  this.pushEvent(
    task,
    'error',
    `${contract.failureReason}，本次不会伪造成已执行。`,
    {
      type: 'failure_reason',
      label: '执行合同失败',
      value: contract.failureReason,
      stageKey: contract.stageKey,
    },
  );
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const executionMethods = {
  waitForLiveExecutor,
  resolveExecutionContract,
  assertCreateExecutionPreflight,
  buildExecutionContract,
  blockTaskForExecutionContract,
};
