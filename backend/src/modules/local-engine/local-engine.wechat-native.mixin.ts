// local-engine 微信原生命令执行簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；簇内互调走模块函数引用；
// 仅 sendApprovedWechatTask 访问 service 成员（通过 WechatNativeCommandHost 接口，避免循环 import）。

import { spawn } from 'node:child_process';
import { extname } from 'node:path';

import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type {
  CustomerServiceKnowledgeContext,
  InteractionReplyGeneratedBy,
  InteractionReplyRuleConfig,
  InteractionTask,
  InteractionTaskEvent,
  InteractionTaskType,
} from './local-engine.types';
import {
  ApprovedWechatTargetResult,
  ApprovedWechatTaskResult,
  WechatDesktopCommandError,
  WechatDesktopCommandResult,
} from './local-engine.wechat-command.utils';
import type { WechatMomentsVisibilityCode } from './local-engine.wechat-command.utils';
import {
  WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
  resolveWechatNativeCommandKey,
  type WechatNativeCommandKey,
} from './wechat-native-command.contract';
import {
  assertMomentsScheduleReady,
  assertMomentsVisibilityExecutable,
  assertWechatDesktopResultProof,
  buildApprovedWechatReadback,
  buildMomentsPlanReadback,
  buildWechatDesktopReadback,
  compactWechatContactSyncOutput,
  findLastJsonLine,
  readMetadataPositiveInteger,
  readMetadataStringList,
  readMetadataTargetCommentMap,
  readMomentsMarketingActions,
  readMomentsPlanState,
  readMomentsPublishDetails,
  readWechatTargetMessageMap,
  resolveWechatAccountProtection,
  getRuntimePlatform,
  resolveWechatNativeRuntimePath,
  sleep,
  toWechatDesktopCommandError,
} from './local-engine.wechat-command.utils';
import {
  createId,
  delay,
  isWechatAccountProtectionBlocker,
  isWechatNoTargetMessage,
  optionalTrimmedText,
  toNonNegativeInteger,
} from './local-engine.utils';

/** native command 簇的 host 接口：簇方法访问的 service 成员（其余依赖全部在 utils/本文件内） */
interface WechatNativeCommandHost {
  autoUploadService: AutoUploadService;
  replyRule: InteractionReplyRuleConfig;
  buildReplyFromRule(
    sourceText: string,
    context?: { targetName?: string; accountName?: string },
    replyRule?: InteractionReplyRuleConfig,
  ): string;
  pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ): void;
  runWechatContactCommand(
    command: 'wechat-auto-reply' | 'wechat-contact-add',
    target: string,
    message: string,
    mode: 'auto-send' | 'approval',
    options?: {
      remarkStrategy?: string;
      remarkContent?: string;
      attachmentPaths?: string[];
    },
  ): Promise<{ screenshotPath?: string }>;
  runWechatDesktopCommand(
    command:
      | 'wechat-auto-reply'
      | 'wechat-contact-add'
      | 'wechat-live-auto-reply'
      | 'wechat-moments-publish'
      | 'wechat-moments-marketing',
    args: string[],
    target: string,
    timeoutMs?: number,
  ): Promise<WechatDesktopCommandResult>;
  tryGenerateInteractionReplyWithAi(
    sourceText: string,
    context: {
      targetName?: string;
      accountName?: string;
      fallbackReply: string;
    },
    replyRule?: InteractionReplyRuleConfig,
    knowledge?: CustomerServiceKnowledgeContext,
  ): Promise<string>;
}

export function resolveWindowsWechatNativeCommandForTask(
  type: InteractionTaskType,
): WechatNativeCommandKey | undefined {
  const command = resolveWechatNativeCommandKey(type);
  if (!command || command === 'contacts') {
    return undefined;
  }
  return command;
}

export function resolveWechatNativeSendMode(task: InteractionTask) {
  const raw =
    optionalTrimmedText(task.metadata?.wechat_reply_mode) ||
    optionalTrimmedText(task.metadata?.sendMode) ||
    optionalTrimmedText(task.requestedSendMode) ||
    optionalTrimmedText(task.sendMode) ||
    'approval';
  if (/auto|自动/.test(raw)) return 'auto-send';
  if (/draft|草稿/.test(raw)) return 'draft-only';
  if (/read|只读/.test(raw)) return 'read-only';
  return 'approval';
}

export function wechatNativeTargetRefs(
  task: InteractionTask,
  metadataValue?: unknown,
  max = 200,
) {
  const fromBatch = (task.batchTargets || []).flatMap((target, index) => {
    const displayName = optionalTrimmedText(target.targetName);
    if (!displayName) return [];
    return [
      {
        id: optionalTrimmedText(target.id) || `batch-${index + 1}`,
        displayName,
        nickname: displayName,
        searchText: displayName,
        source: 'interaction-task-batch',
        raw: {
          sourceText: target.sourceText,
          replyText: target.replyText,
          status: target.status,
        },
      },
    ];
  });
  if (fromBatch.length) {
    return fromBatch.slice(0, max);
  }

  const names = readMetadataStringList(metadataValue, [], max);
  const fallbackName = optionalTrimmedText(task.targetName);
  const source = names.length ? names : fallbackName ? [fallbackName] : [];
  return source.slice(0, max).map((displayName, index) => ({
    id: `target-${index + 1}`,
    displayName,
    nickname: displayName,
    searchText: displayName,
    source: names.length ? 'interaction-task-metadata' : 'interaction-task',
  }));
}

export function wechatNativeAssetRefs(paths: string[]) {
  return paths.map((filePath) => ({
    path: filePath,
    role: 'attachment',
  }));
}

export function buildWechatNativeCommandInput(
  command: WechatNativeCommandKey,
  task: InteractionTask,
): Record<string, unknown> {
  if (command === 'group-broadcast') {
    const targets = wechatNativeTargetRefs(
      task,
      task.metadata?.wechat_group_targets ?? task.metadata?.targets,
    );
    const attachmentPaths = readMetadataStringList(
      task.metadata?.massSendFiles ?? task.metadata?.wechat_mass_send_files,
      [],
      20,
    );
    const dailyLimit = readMetadataPositiveInteger(
      task.metadata?.dailyLimit ?? task.metadata?.wechat_group_daily_limit,
      targets.length || 1,
      200,
    );
    const intervalSeconds = readMetadataPositiveInteger(
      task.metadata?.intervalSeconds ??
        task.metadata?.wechat_group_interval_seconds,
      0,
      3600,
    );
    const personalizedMessages = readWechatTargetMessageMap(task);
    return {
      targets,
      message: {
        text:
          optionalTrimmedText(task.replyText) ||
          optionalTrimmedText(task.metadata?.wechat_reply_draft) ||
          '',
        attachments: wechatNativeAssetRefs(attachmentPaths),
      },
      messages: targets.flatMap((target) => {
        const targetName = optionalTrimmedText(target.displayName);
        const message = targetName
          ? personalizedMessages.get(targetName)
          : undefined;
        return targetName && message
          ? [
              {
                targetId: optionalTrimmedText(target.id),
                targetName,
                message: {
                  text: message,
                  attachments: wechatNativeAssetRefs(attachmentPaths),
                },
              },
            ]
          : [];
      }),
      rateLimit: {
        dailyLimit,
        intervalMs: intervalSeconds * 1000,
      },
      allowGroupChats: true,
      stopOnFailure: false,
    };
  }

  if (command === 'contact-add') {
    const targets = wechatNativeTargetRefs(
      task,
      task.metadata?.wechat_contact_add_targets ?? task.metadata?.targets,
    );
    const verifyMessage =
      optionalTrimmedText(task.replyText) ||
      optionalTrimmedText(task.metadata?.verifyMessage) ||
      optionalTrimmedText(task.metadata?.wechat_contact_add_verify_message) ||
      '';
    const blacklistTags = readMetadataStringList(
      task.metadata?.blacklist ?? task.metadata?.wechat_contact_add_blacklist,
      [],
      200,
    );
    return {
      targets: targets.map((target) => ({
        ...target,
        searchText:
          optionalTrimmedText(target.searchText) ||
          optionalTrimmedText(target.displayName) ||
          '',
        verifyMessage,
      })),
      verifyMessage,
      remark: {
        strategy:
          optionalTrimmedText(task.metadata?.remarkStrategy) ||
          optionalTrimmedText(
            task.metadata?.wechat_contact_add_remark_strategy,
          ) ||
          'none',
        value:
          optionalTrimmedText(task.metadata?.remarkContent) ||
          optionalTrimmedText(
            task.metadata?.wechat_contact_add_remark_content,
          ) ||
          '',
      },
      blacklistTags,
      rateLimit: {
        dailyLimit: readMetadataPositiveInteger(
          task.metadata?.dailyLimit ??
            task.metadata?.wechat_contact_add_daily_limit,
          targets.length || 1,
          50,
        ),
        intervalMs:
          readMetadataPositiveInteger(
            task.metadata?.minIntervalSeconds ??
              task.metadata?.wechat_contact_add_min_interval_seconds,
            180,
            86400,
          ) * 1000,
      },
    };
  }

  if (command === 'friend-accept') {
    return {
      remark: {
        strategy:
          optionalTrimmedText(
            task.metadata?.wechat_friend_accept_remark_strategy,
          ) || 'request_name',
        value:
          optionalTrimmedText(
            task.metadata?.wechat_friend_accept_remark_content,
          ) || '',
      },
      welcomeMessage:
        optionalTrimmedText(
          task.metadata?.wechat_friend_accept_welcome_message,
        ) || '',
      matchKeywords: readMetadataStringList(
        task.metadata?.wechat_friend_accept_match_keywords,
        [],
        100,
      ),
      dailyLimit: readMetadataPositiveInteger(
        task.metadata?.wechat_friend_accept_daily_limit,
        20,
        100,
      ),
    };
  }

  if (command === 'moments-publish') {
    const details = readMomentsPublishDetails(task);
    const first = details[0];
    const allAssets = details.flatMap((detail) => detail.attachments);
    return {
      content: {
        text: first?.content || '',
        assets: wechatNativeAssetRefs(allAssets),
        firstComment: first?.additionalComment || '',
        visibility: first?.visibility || 'public',
        publishAt: first?.scheduledPublishTime || '',
      },
      items: details.map((detail, index) => ({
        id: detail.targetName || `moment-${index + 1}`,
        text: detail.content,
        assets: wechatNativeAssetRefs(detail.attachments),
        firstComment: detail.additionalComment,
        visibility: detail.visibility,
        publishAt: detail.scheduledPublishTime || '',
      })),
    };
  }

  if (command === 'moments-marketing') {
    const actions = readMomentsMarketingActions(
      task.metadata?.actions ?? task.metadata?.wechat_moments_marketing_actions,
    );
    const contacts = wechatNativeTargetRefs(
      task,
      task.metadata?.contacts ??
        task.metadata?.wechat_moments_marketing_contacts,
      100,
    );
    const marketingMode =
      optionalTrimmedText(task.metadata?.wechat_moments_marketing_mode) ||
      optionalTrimmedText(task.metadata?.marketingMode) ||
      (contacts.length ? 'targeted' : 'random');
    const targetedContacts = marketingMode === 'targeted' ? contacts : [];
    const targetComments = readMetadataTargetCommentMap(
      task.metadata?.targetComments ??
        task.metadata?.wechat_moments_marketing_target_comments,
    );
    const fixedText =
      optionalTrimmedText(task.metadata?.fixedComment) ||
      optionalTrimmedText(
        task.metadata?.wechat_moments_marketing_fixed_comment,
      ) ||
      optionalTrimmedText(task.replyText) ||
      '';
    const randomBrowseCount = readMetadataPositiveInteger(
      task.metadata?.randomBrowseCount ??
        task.metadata?.wechat_moments_marketing_random_browse_count,
      0,
      100,
    );
    const browseTargets =
      targetedContacts.length > 0
        ? targetedContacts.map((contact, index) => ({
            id: optionalTrimmedText(contact.id) || `moment-${index + 1}`,
            ordinal: index + 1,
            contact,
          }))
        : Array.from({ length: randomBrowseCount }, (_, index) => ({
            id: `moment-${index + 1}`,
            ordinal: index + 1,
            momentText: `朋友圈第 ${index + 1} 条`,
          }));
    return {
      mode: marketingMode === 'targeted' ? 'targeted' : 'random',
      actions: {
        browse: true,
        like: actions.like,
        comment: actions.comment,
      },
      contacts: targetedContacts,
      targets: browseTargets,
      browseLimit: randomBrowseCount || browseTargets.length,
      dailyLimit: readMetadataPositiveInteger(
        task.metadata?.dailyViewLimit ??
          task.metadata?.wechat_moments_marketing_daily_limit,
        browseTargets.length || 1,
        100,
      ),
      comment: {
        mode:
          optionalTrimmedText(task.metadata?.commentMode) ||
          optionalTrimmedText(
            task.metadata?.wechat_moments_marketing_comment_mode,
          ) ||
          (fixedText ? 'fixed' : 'none'),
        fixedText,
        targetComments: Array.from(targetComments.entries()).map(
          ([targetName, commentText]) => ({
            targetName,
            commentText,
          }),
        ),
      },
    };
  }

  if (command === 'chat-history') {
    return {
      action: 'sync',
      sessionId:
        optionalTrimmedText(task.metadata?.wechat_chat_history_session_id) ||
        optionalTrimmedText(task.targetName) ||
        '',
    };
  }

  return {};
}

export function buildWechatNativeCommandRequest(
  command: WechatNativeCommandKey,
  task: InteractionTask,
) {
  const sendMode = resolveWechatNativeSendMode(task);
  return {
    contractVersion: WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
    command,
    input: buildWechatNativeCommandInput(command, task),
    context: {
      runId: task.id,
      relatedId: task.id,
      relatedType: 'interaction-task',
      locale: 'zh-CN',
      account: {
        accountId: task.accountId,
        accountName: task.accountName,
        currentWechatId: task.currentWechatId,
        plannedWechatId: task.plannedWechatId || task.associatedWeChat,
      },
      runtime: {
        platform: 'win32',
        engine: 'native-runtime',
      },
      safety: {
        sendMode,
        dryRun: false,
        requiresApproval: true,
        readbackRequired: true,
        stopOnRiskPrompt: true,
      },
      metadata: {
        taskType: task.type,
        planName: task.planName,
        riskLevel: task.riskLevel,
      },
    },
  };
}

export function runWechatNativeRuntimeCommand(
  commandKey: WechatNativeCommandKey,
  request: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const runtimePath = resolveWechatNativeRuntimePath();
  if (!runtimePath) {
    throw new WechatDesktopCommandError(
      'Windows 微信 native runtime 不存在，无法执行受控预检。',
      {
        status: 'blocked',
        errorCode: 'runtime_unavailable',
        nextAction:
          '请安装包含 desktop/runtime/wechat-native-runtime 的完整安装包后重试。',
        message: 'native runtime missing',
      },
    );
  }
  const isNodeScript = extname(runtimePath).toLowerCase() === '.js';
  const executable = isNodeScript ? process.execPath : runtimePath;
  const args = isNodeScript ? [runtimePath, commandKey] : [commandKey];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      env: {
        ...process.env,
        AI_CONTENT_WECHAT_NATIVE_RUNTIME: runtimePath,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(
        new WechatDesktopCommandError(
          `Windows 微信 native runtime ${commandKey} 执行超时。`,
          {
            status: 'blocked',
            errorCode: 'timeout',
            nextAction: '请导出诊断，检查微信窗口、权限和 runtime 日志。',
            message: stderr || stdout,
          },
        ),
      );
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(
        new WechatDesktopCommandError(
          `Windows 微信 native runtime 启动失败：${error.message}`,
          {
            status: 'blocked',
            errorCode: 'runtime_unavailable',
            nextAction: '请检查安装包 runtime 文件和杀毒/权限拦截。',
            message: error.message,
          },
        ),
      );
    });
    child.on('close', () => {
      clearTimeout(timeout);
      const jsonLine = findLastJsonLine(stdout);
      if (!jsonLine) {
        reject(
          new WechatDesktopCommandError(
            `Windows 微信 native runtime ${commandKey} 没有返回 JSON 结果。`,
            {
              status: 'blocked',
              errorCode: 'runtime_unavailable',
              nextAction: '请导出诊断，检查 runtime stdout/stderr。',
              message: compactWechatContactSyncOutput(
                stderr || stdout || 'no output',
              ),
            },
          ),
        );
        return;
      }
      try {
        resolvePromise(JSON.parse(jsonLine) as Record<string, unknown>);
      } catch (error) {
        reject(
          new WechatDesktopCommandError(
            `Windows 微信 native runtime ${commandKey} JSON 解析失败。`,
            {
              status: 'blocked',
              errorCode: 'runtime_unavailable',
              nextAction: '请导出诊断，检查 runtime 输出格式。',
              message: error instanceof Error ? error.message : String(error),
            },
          ),
        );
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function nativeRuntimeResponseMessage(
  command: WechatNativeCommandKey,
  parsed: Record<string, unknown>,
) {
  const errorDetail =
    parsed.errorDetail &&
    typeof parsed.errorDetail === 'object' &&
    !Array.isArray(parsed.errorDetail)
      ? (parsed.errorDetail as Record<string, unknown>)
      : {};
  return (
    optionalTrimmedText(parsed.message) ||
    optionalTrimmedText(parsed.error) ||
    optionalTrimmedText(errorDetail.message) ||
    `Windows 微信 native runtime ${command} 返回阻断。`
  );
}

export function toWechatNativeDesktopCommandResult(
  parsed: Record<string, unknown>,
): WechatDesktopCommandResult {
  return {
    status: optionalTrimmedText(parsed.status),
    errorCode: optionalTrimmedText(parsed.errorCode ?? parsed.error_code),
    nextAction: optionalTrimmedText(parsed.nextAction ?? parsed.next_action),
    message:
      optionalTrimmedText(parsed.message) || optionalTrimmedText(parsed.error),
    readText:
      parsed.output === undefined
        ? undefined
        : JSON.stringify(parsed.output, null, 2),
    output: parsed.output,
    diagnostics: parsed.diagnostics,
    raw: parsed,
  };
}

export async function tryRunWindowsWechatNativeControlledTask(
  task: InteractionTask,
): Promise<ApprovedWechatTaskResult | null> {
  if (getRuntimePlatform() !== 'win32') {
    return null;
  }
  const command = resolveWindowsWechatNativeCommandForTask(task.type);
  if (!command) {
    return null;
  }
  const request = buildWechatNativeCommandRequest(command, task);
  const parsed = await runWechatNativeRuntimeCommand(
    command,
    request,
    command === 'chat-history' ? 60000 : 30000,
  );
  const result = toWechatNativeDesktopCommandResult(parsed);
  const message = nativeRuntimeResponseMessage(command, parsed);
  if (parsed.ok === true && parsed.status === 'success') {
    return {
      ok: true,
      message,
      completedTargets: (task.batchTargets || [])
        .map((target) => target.targetName)
        .filter(Boolean),
      readbackText: result.readText,
      results: [
        {
          target: task.targetName,
          ok: true,
          message,
          result,
        },
      ],
    };
  }
  throw new WechatDesktopCommandError(message, result);
}

export async function sendApprovedWechatTask(
  this: WechatNativeCommandHost,
  task: InteractionTask,
): Promise<ApprovedWechatTaskResult> {
  const customerServiceDecision =
    task.metadata?.customerServiceDecision &&
    typeof task.metadata.customerServiceDecision === 'object' &&
    !Array.isArray(task.metadata.customerServiceDecision)
      ? (task.metadata.customerServiceDecision as Record<string, unknown>)
      : {};
  if (
    task.metadata?.customerServiceNoReply === true ||
    customerServiceDecision.action === 'no-reply'
  ) {
    throw new Error('当前客服规则要求不自动回复，本次没有发送。');
  }
  const customerServiceNotBefore = optionalTrimmedText(
    task.metadata?.customerServiceNotBefore,
  );
  if (
    customerServiceNotBefore &&
    Date.parse(customerServiceNotBefore) > Date.now()
  ) {
    throw new Error(
      `当前回复将在 ${customerServiceNotBefore} 之后处理，本次没有发送。`,
    );
  }
  const nativeControlledResult =
    await tryRunWindowsWechatNativeControlledTask(task);
  if (nativeControlledResult) {
    return nativeControlledResult;
  }
  const wechatAccountProtection = resolveWechatAccountProtection(task);
  if (wechatAccountProtection.blocker) {
    throw new WechatDesktopCommandError(wechatAccountProtection.blocker);
  }
  if (wechatAccountProtection.warning) {
    this.pushEvent(task, 'warning', wechatAccountProtection.warning, {
      type: 'diagnostic_bundle',
      label: '微信号保护提示',
      value: wechatAccountProtection.warning,
      stageKey: 'send-result',
    });
  }

  if (task.type === 'wechat-contact-add') {
    const targets = task.batchTargets?.length
      ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
      : [task.targetName].filter(Boolean);
    if (!targets.length || !task.replyText?.trim()) {
      throw new Error('缺少加好友目标或验证消息，不能继续执行。');
    }
    const blacklist = new Set(
      readMetadataStringList(
        task.metadata?.blacklist ?? task.metadata?.wechat_contact_add_blacklist,
        [],
        200,
      ),
    );
    const dailyLimit = readMetadataPositiveInteger(
      task.metadata?.dailyLimit ??
        task.metadata?.wechat_contact_add_daily_limit,
      targets.length,
      50,
    );
    const minIntervalSeconds = readMetadataPositiveInteger(
      task.metadata?.minIntervalSeconds ??
        task.metadata?.wechat_contact_add_min_interval_seconds,
      180,
      86400,
    );
    const maxIntervalSeconds = Math.max(
      minIntervalSeconds,
      readMetadataPositiveInteger(
        task.metadata?.maxIntervalSeconds ??
          task.metadata?.wechat_contact_add_max_interval_seconds,
        36000,
        86400,
      ),
    );
    const remarkStrategy =
      optionalTrimmedText(task.metadata?.remarkStrategy) ||
      optionalTrimmedText(task.metadata?.wechat_contact_add_remark_strategy) ||
      'none';
    const remarkContent =
      optionalTrimmedText(task.metadata?.remarkContent) ||
      optionalTrimmedText(task.metadata?.wechat_contact_add_remark_content) ||
      '';
    const skippedTargets = targets.filter((target) => blacklist.has(target));
    const allowedTargets = targets.filter((target) => !blacklist.has(target));
    const limitedTargets = allowedTargets.slice(
      0,
      Math.min(dailyLimit, allowedTargets.length),
    );
    const pendingTargets = allowedTargets.slice(limitedTargets.length);
    if (!limitedTargets.length) {
      throw new Error('加好友目标都在黑名单或超过本次上限，不能继续执行。');
    }
    const results: ApprovedWechatTargetResult[] = [];
    const failedTargets: Array<{ targetName: string; reason: string }> = [];
    for (let index = 0; index < limitedTargets.length; index += 1) {
      const target = limitedTargets[index];
      try {
        const result = await this.runWechatContactCommand(
          'wechat-contact-add',
          target,
          task.replyText,
          'auto-send',
          {
            remarkStrategy,
            remarkContent,
          },
        );
        assertWechatDesktopResultProof({
          taskType: task.type,
          target,
          expectedText: task.replyText,
          result,
        });
        results.push({
          target,
          ok: true,
          message: `好友申请已发送：${target}`,
          screenshotPath: result.screenshotPath,
          result,
        });
      } catch (error) {
        const desktopError = toWechatDesktopCommandError(error);
        const reason = error instanceof Error ? error.message : String(error);
        if (isWechatAccountProtectionBlocker(reason)) {
          throw error;
        }
        failedTargets.push({ targetName: target, reason });
        results.push({
          target,
          ok: false,
          message: reason,
          screenshotPath: desktopError?.result.screenshotPath,
          result: desktopError?.result,
        });
      }
      if (index < limitedTargets.length - 1) {
        const intervalSeconds = Math.min(
          maxIntervalSeconds,
          Math.max(minIntervalSeconds, minIntervalSeconds),
        );
        await sleep(intervalSeconds * 1000);
      }
    }
    const completedTargets = results
      .filter((item) => item.ok)
      .map((item) => item.target);
    if (!completedTargets.length) {
      const firstFailure = failedTargets[0]?.reason;
      const firstFailureResult = results.find((item) => item.result)?.result;
      const message = firstFailure
        ? `微信好友申请没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。${firstFailure}`
        : '微信好友申请没有任何对象处理成功。';
      if (
        firstFailure &&
        failedTargets.every((target) => isWechatNoTargetMessage(target.reason))
      ) {
        throw new WechatDesktopCommandError(message, firstFailureResult);
      }
      throw new Error(message);
    }
    const screenshotPath = results.find(
      (item) => item.ok && item.screenshotPath,
    )?.screenshotPath;
    return {
      ok: true,
      message: `微信好友申请已发送 ${completedTargets.length}/${targets.length} 个对象，失败 ${failedTargets.length} 个，跳过 ${skippedTargets.length} 个，待执行 ${pendingTargets.length} 个。`,
      screenshotPath,
      completedTargets,
      failedTargets,
      skippedTargets,
      pendingTargets,
      results,
      readbackText: [
        buildApprovedWechatReadback('自动加好友', results),
        `计划统计：完成 ${completedTargets.length}，失败 ${failedTargets.length}，跳过 ${skippedTargets.length}，待执行 ${pendingTargets.length}，每日上限 ${dailyLimit}，间隔 ${minIntervalSeconds}-${maxIntervalSeconds} 秒。`,
      ].join('；'),
    };
  }

  if (task.type === 'wechat-moments-publish') {
    const details = readMomentsPublishDetails(task);
    const plan = readMomentsPlanState(task.metadata, details.length || 1);
    assertMomentsScheduleReady(plan);
    if (plan.remainingToday <= 0) {
      throw new Error(
        `朋友圈发布今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
      );
    }
    const executionTime = Date.now();
    const dueDetails = details.filter((detail) => {
      if (!detail.scheduledPublishTime) return true;
      const scheduledAt = Date.parse(detail.scheduledPublishTime);
      return !Number.isFinite(scheduledAt) || scheduledAt <= executionTime;
    });
    const executableDetails = dueDetails.slice(0, plan.remainingToday);
    const pendingTargets = details
      .filter((detail) => !executableDetails.includes(detail))
      .map((detail) => detail.targetName);
    if (!executableDetails.length) {
      throw new Error('朋友圈明细还未到执行时间，当前没有发布。');
    }
    const results: ApprovedWechatTargetResult[] = [];
    const failedTargets: Array<{ targetName: string; reason: string }> = [];
    for (const detail of executableDetails) {
      if (!detail.content || !detail.attachments.length) {
        failedTargets.push({
          targetName: detail.targetName,
          reason: '缺少朋友圈文案或媒体文件路径。',
        });
        continue;
      }
      try {
        assertMomentsVisibilityExecutable(
          detail.visibility,
          detail.visibilityLabel,
        );
        const result = await this.runWechatDesktopCommand(
          'wechat-moments-publish',
          [
            detail.content,
            'auto-send',
            detail.attachments.join('\n'),
            detail.additionalComment,
            detail.visibility,
          ],
          detail.targetName,
          150000,
        );
        assertWechatDesktopResultProof({
          taskType: task.type,
          target: detail.targetName,
          expectedText: detail.content,
          result,
        });
        results.push({
          target: detail.targetName,
          ok: true,
          message: `朋友圈已发布：${detail.targetName}`,
          screenshotPath: result.screenshotPath,
          result,
        });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        if (isWechatAccountProtectionBlocker(failure)) {
          throw error;
        }
        failedTargets.push({
          targetName: detail.targetName,
          reason: failure,
        });
      }
    }
    if (!results.length) {
      const firstFailure = failedTargets[0]?.reason;
      throw new Error(
        firstFailure
          ? `朋友圈发布没有任何明细成功：${firstFailure}`
          : '朋友圈发布没有任何明细成功。',
      );
    }
    const screenshotPath = results.find(
      (item) => item.screenshotPath,
    )?.screenshotPath;
    return {
      ok: true,
      message: `朋友圈已发布 ${results.length}/${details.length} 条${failedTargets.length ? `，${failedTargets.length} 条失败待恢复` : ''}。${plan.recordSummary ? `记录摘要：${plan.recordSummary}` : ''}`,
      screenshotPath,
      completedTargets: results.map((item) => item.target),
      failedTargets,
      skippedTargets: [],
      pendingTargets,
      results,
      readbackText: [
        buildApprovedWechatReadback('微信朋友圈', results),
        buildMomentsPlanReadback(plan),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (task.type === 'wechat-moments-marketing') {
    const contacts =
      readMetadataStringList(
        task.metadata?.contacts ??
          task.metadata?.wechat_moments_marketing_contacts,
        [],
        100,
      ) || [];
    const marketingMode =
      optionalTrimmedText(task.metadata?.wechat_moments_marketing_mode) ||
      optionalTrimmedText(task.metadata?.marketingMode) ||
      (contacts.length ? 'targeted' : 'random');
    const targetedContacts = marketingMode === 'targeted' ? contacts : [];
    const targetCommentMap = readMetadataTargetCommentMap(
      task.metadata?.targetComments ??
        task.metadata?.wechat_moments_marketing_target_comments,
    );
    const batchTargetMap = new Map(
      (task.batchTargets || [])
        .map(
          (target) =>
            [target.targetName, optionalTrimmedText(target.replyText)] as const,
        )
        .filter((entry): entry is readonly [string, string] =>
          Boolean(entry[0] && entry[1]),
        ),
    );
    const randomBrowseCount = readMetadataPositiveInteger(
      task.metadata?.randomBrowseCount ??
        task.metadata?.wechat_moments_marketing_random_browse_count,
      0,
      100,
    );
    const batchTargets = task.batchTargets?.length
      ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
      : [];
    const fallbackRandomTargets =
      randomBrowseCount > 0
        ? Array.from(
            { length: randomBrowseCount },
            (_, index) => `朋友圈第 ${index + 1} 条`,
          )
        : [];
    const targets = targetedContacts.length
      ? targetedContacts
      : batchTargets.length
        ? batchTargets
        : fallbackRandomTargets.length
          ? fallbackRandomTargets
          : [task.targetName || '朋友圈第 1 条'].filter(Boolean);
    const dailyLimit = readMetadataPositiveInteger(
      task.metadata?.dailyViewLimit ??
        task.metadata?.wechat_moments_marketing_daily_limit,
      targets.length,
      100,
    );
    const plan = readMomentsPlanState(task.metadata, dailyLimit);
    assertMomentsScheduleReady(plan);
    if (plan.autoLike !== undefined || plan.autoComment !== undefined) {
      task.metadata = {
        ...(task.metadata || {}),
        actions: {
          like: plan.autoLike !== false,
          comment: plan.autoComment !== false,
        },
        wechat_moments_marketing_actions: {
          like: plan.autoLike !== false,
          comment: plan.autoComment !== false,
        },
      };
    }
    const executableLimit = Math.min(dailyLimit, plan.remainingToday);
    if (executableLimit <= 0) {
      throw new Error(
        `朋友圈营销今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
      );
    }
    const limitedTargets = targets.slice(
      0,
      Math.min(executableLimit, targets.length),
    );
    const overLimitTargets = targets.filter(
      (target) => !limitedTargets.includes(target),
    );
    const actions = readMomentsMarketingActions(
      task.metadata?.actions ?? task.metadata?.wechat_moments_marketing_actions,
    );
    const actionKind =
      actions.like && actions.comment
        ? 'like-comment'
        : actions.comment
          ? 'comment'
          : actions.like
            ? 'like'
            : 'browse';
    const commentMode = optionalTrimmedText(
      task.metadata?.commentMode ??
        task.metadata?.wechat_moments_marketing_comment_mode,
    );
    const fixedComment = optionalTrimmedText(
      task.metadata?.fixedComment ??
        task.metadata?.wechat_moments_marketing_fixed_comment,
    );
    const content = optionalTrimmedText(
      task.metadata?.content ?? task.metadata?.wechat_moments_marketing_content,
    );
    const results: ApprovedWechatTargetResult[] = [];
    const failedTargets: string[] = [];
    const failedTargetResults: Array<{ targetName: string; reason: string }> =
      [];
    const failureMessages: string[] = [];
    for (const [index, target] of limitedTargets.entries()) {
      const targetComment =
        targetCommentMap.get(target) ||
        batchTargetMap.get(target) ||
        (commentMode === 'fixed' ? fixedComment : '') ||
        content ||
        task.replyText ||
        '';
      if (actions.comment && !targetComment) {
        const failure = '缺少朋友圈评论内容，不能继续执行。';
        failedTargets.push(target);
        failedTargetResults.push({ targetName: target, reason: failure });
        failureMessages.push(`${target}: ${failure}`);
        continue;
      }
      try {
        const result = await this.runWechatDesktopCommand(
          'wechat-moments-marketing',
          [
            target,
            actions.comment ? targetComment : '',
            'auto-send',
            actionKind,
            String(index + 1),
          ],
          target,
          120000,
        );
        assertWechatDesktopResultProof({
          taskType: task.type,
          target,
          expectedText: actions.comment ? targetComment : '',
          result,
        });
        results.push({
          target,
          ok: true,
          message: `朋友圈营销已处理：${target}`,
          screenshotPath: result.screenshotPath,
          result,
        });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        if (isWechatAccountProtectionBlocker(failure)) {
          throw error;
        }
        failedTargets.push(target);
        failedTargetResults.push({ targetName: target, reason: failure });
        failureMessages.push(`${target}: ${failure}`);
      }
    }
    if (!results.length) {
      const firstFailure = failureMessages[0];
      throw new Error(
        firstFailure
          ? `朋友圈营销没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。${firstFailure}`
          : failedTargets.length
            ? `朋友圈营销没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。`
            : '缺少朋友圈评论内容，不能继续执行。',
      );
    }
    const screenshotPath = results.find(
      (item) => item.screenshotPath,
    )?.screenshotPath;
    return {
      ok: true,
      message: `朋友圈营销已处理 ${results.length}/${targets.length} 个对象${failedTargets.length ? `，${failedTargets.length} 个对象待恢复` : ''}。${plan.recordSummary ? `记录摘要：${plan.recordSummary}` : ''}`,
      screenshotPath,
      completedTargets: results.map((item) => item.target),
      failedTargets: failedTargetResults,
      skippedTargets: overLimitTargets,
      results,
      readbackText: [
        buildApprovedWechatReadback('朋友圈营销', results),
        buildMomentsPlanReadback(plan),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  const targets = task.batchTargets?.length
    ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
    : [task.targetName].filter(Boolean);
  if (
    !targets.length ||
    (task.type !== 'wechat-reply-draft' && !task.replyText?.trim())
  ) {
    throw new Error('缺少微信目标或发送内容，不能继续执行。');
  }

  const dailyLimit = readMetadataPositiveInteger(
    task.metadata?.dailyLimit,
    targets.length,
    200,
  );
  const intervalSeconds = readMetadataPositiveInteger(
    task.metadata?.intervalSeconds,
    0,
    3600,
  );
  const limitedTargets =
    task.type === 'wechat-group-broadcast'
      ? targets.slice(0, Math.min(dailyLimit, targets.length))
      : targets.slice(0, 1);
  if (task.type === 'wechat-reply-draft') {
    const target = limitedTargets[0];
    const explicitReplyText =
      optionalTrimmedText(task.metadata?.wechat_reply_draft) ||
      optionalTrimmedText(task.metadata?.replyText) ||
      optionalTrimmedText(task.replyText);
    let sourceText = optionalTrimmedText(task.sourceText);
    let replyText = explicitReplyText;
    let replyGeneratedBy: InteractionReplyGeneratedBy =
      task.replyGeneratedBy || 'fallback';

    if (!replyText) {
      const readResult = await this.runWechatDesktopCommand(
        'wechat-live-auto-reply',
        [target, 'read-only'],
        target,
      );
      sourceText = optionalTrimmedText(
        readResult.readText || readResult.sourceText,
      );
      if (!sourceText) {
        throw new Error('未读取到当前微信会话原文，不能生成商用回复。');
      }
      const fallbackReply = this.buildReplyFromRule(sourceText, {
        targetName: target,
        accountName: task.accountName,
      });
      const aiReply = await this.tryGenerateInteractionReplyWithAi(sourceText, {
        targetName: target,
        accountName: task.accountName,
        fallbackReply,
      });
      replyText = aiReply || fallbackReply;
      replyGeneratedBy = aiReply ? 'ai' : 'fallback';
    }

    if (!replyText) {
      throw new Error('缺少微信回复内容，不能继续执行。');
    }

    const sendResult = await this.autoUploadService.sendWechatReply({
      targetText: target,
      replyText,
    });
    const screenshotPath =
      sendResult.evidence?.path || sendResult.evidence?.value;
    if (sendResult.sent !== true || sendResult.status !== 'sent') {
      throw new WechatDesktopCommandError(
        sendResult.message || '微信自动发送失败。',
        {
          screenshotPath,
          target: sendResult.targetText || target,
          reply: sendResult.replyText || replyText,
          readText: sendResult.readbackText,
          sourceText,
          status: sendResult.status,
          message: sendResult.message,
        },
      );
    }
    const result: WechatDesktopCommandResult = {
      screenshotPath,
      target: sendResult.targetText || target,
      contact: sendResult.targetText || target,
      reply: sendResult.replyText || replyText,
      readText: sendResult.readbackText || replyText,
      sourceText,
      generatedBy: replyGeneratedBy,
      status: sendResult.status,
      message: sendResult.message,
      mode: 'auto-send',
    };
    const completedTargets = [target];
    return {
      ok: true,
      message: `微信消息已发送给 ${target}。`,
      screenshotPath,
      completedTargets,
      results: [
        {
          target,
          ok: true,
          message: `微信消息已发送：${target}`,
          screenshotPath,
          result: {
            ...result,
            reply: replyText,
            readText: sourceText,
            sourceText,
            generatedBy: replyGeneratedBy,
          },
        },
      ],
      readbackText: buildWechatDesktopReadback(
        '微信消息',
        target,
        replyText,
        result,
      ),
      sourceText,
      replyText,
      replyGeneratedBy,
    };
  }
  const results: ApprovedWechatTargetResult[] = [];
  const groupTargetMessages =
    task.type === 'wechat-group-broadcast'
      ? readWechatTargetMessageMap(task)
      : new Map<string, string>();
  const groupAttachmentPaths =
    task.type === 'wechat-group-broadcast'
      ? readMetadataStringList(
          task.metadata?.massSendFiles ?? task.metadata?.wechat_mass_send_files,
          [],
          20,
        )
      : [];
  for (const [index, target] of limitedTargets.entries()) {
    const targetMessage = groupTargetMessages.get(target) || task.replyText;
    if (!targetMessage?.trim()) {
      throw new Error(`缺少 ${target} 的群发内容，不能继续执行。`);
    }
    const result = await this.runWechatContactCommand(
      'wechat-auto-reply',
      target,
      targetMessage,
      'auto-send',
      { attachmentPaths: groupAttachmentPaths },
    );
    assertWechatDesktopResultProof({
      taskType: task.type,
      target,
      expectedText: targetMessage,
      result,
    });
    results.push({
      target,
      ok: true,
      message: `微信消息已发送：${target}`,
      screenshotPath: result.screenshotPath,
      result,
    });
    if (
      task.type === 'wechat-group-broadcast' &&
      intervalSeconds > 0 &&
      index < limitedTargets.length - 1
    ) {
      await delay(intervalSeconds * 1000);
    }
  }
  const screenshotPath = results.find(
    (item) => item.screenshotPath,
  )?.screenshotPath;
  if (task.type === 'wechat-group-broadcast') {
    return {
      ok: true,
      message: `微信群发已发送 ${results.length}/${targets.length} 个对象。`,
      screenshotPath,
      completedTargets: limitedTargets,
      skippedTargets: targets.filter(
        (target) => !limitedTargets.includes(target),
      ),
      results,
      readbackText: buildApprovedWechatReadback('微信群发', results),
    };
  }
  return {
    ok: true,
    message: `微信消息已发送给 ${limitedTargets[0]}。`,
    screenshotPath,
    completedTargets: limitedTargets,
    results,
    readbackText: buildApprovedWechatReadback('微信消息', results),
  };
}

/** native command 方法簇（挂载到 LocalEngineService.prototype） */
export const wechatNativeMethods = {
  resolveWindowsWechatNativeCommandForTask,
  resolveWechatNativeSendMode,
  wechatNativeTargetRefs,
  wechatNativeAssetRefs,
  buildWechatNativeCommandInput,
  buildWechatNativeCommandRequest,
  runWechatNativeRuntimeCommand,
  nativeRuntimeResponseMessage,
  toWechatNativeDesktopCommandResult,
  tryRunWindowsWechatNativeControlledTask,
  sendApprovedWechatTask,
};
