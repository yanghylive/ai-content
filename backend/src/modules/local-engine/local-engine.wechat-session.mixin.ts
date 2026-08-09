// local-engine 微信会话状态簇（god class 拆解阶段 2——mixin 化）
// 方法挂载到 LocalEngineService.prototype（Object.assign）；跨块依赖走 WechatSessionHost 接口：
// autoUploadService/desktopEvidence/wechatSessionConfirmation 字段，
// desktop-evidence/executors/service 方法。

import { BadRequestException } from '@nestjs/common';

import {
  assertBackendRiskGate,
  type BackendRiskContext,
} from '../auth/risk-control';
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import type {
  AlignWechatSessionInput,
  LocalEngineDesktopScreenshotEvidence,
  LocalEngineDesktopStatus,
  LocalEngineFileAccessItem,
  LocalEngineFileAccessStatus,
  LocalEngineWechatSessionStatus,
  UpdateWechatSessionConfirmationInput,
  WechatSessionControlInput,
} from './local-engine.types';

/** 微信会话状态簇的 host 接口：簇方法访问的 service 成员 */
export interface WechatSessionHost {
  autoUploadService: AutoUploadService;
  desktopEvidence: LocalEngineDesktopScreenshotEvidence[];
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
    alignment?: LocalEngineWechatSessionStatus['alignment'];
  };
  getRuntimeStateRoot(): string;
  detectWechatSessionAnomalies(desktop: LocalEngineDesktopStatus): {
    loggedOut: boolean;
    popupDetected: boolean;
    contactAmbiguous: boolean;
    permissionBlocked: boolean;
  };
  getWechatSessionStatus(): Promise<LocalEngineWechatSessionStatus>;
  getDesktopStatus(): Promise<LocalEngineDesktopStatus>;
  captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence>;
  rememberDesktopEvidence(
    evidence?: LocalEngineDesktopScreenshotEvidence,
  ): void;
  resolveLocalRuntimePaths(): Record<string, string>;
  inspectPath(input: {
    key: string;
    name: string;
    path: string;
    note?: string;
  }): Promise<LocalEngineFileAccessItem>;
}

export async function getWechatSessionStatus(
  this: WechatSessionHost,
): Promise<LocalEngineWechatSessionStatus> {
  const desktop = await this.getDesktopStatus();
  const blockers = [...desktop.blockers];
  const warnings = [...desktop.warnings];
  const confirmation = this.wechatSessionConfirmation;
  const targetContact = confirmation.targetContact?.trim();
  const anomalySummary = this.detectWechatSessionAnomalies(desktop);

  if (!desktop.running) {
    blockers.push('桌面微信未运行');
  }
  if (!desktop.available) {
    blockers.push(desktop.message || '桌面微信不可用');
  }
  if (anomalySummary.loggedOut && !confirmation.loggedInConfirmed) {
    blockers.push('桌面微信可能已掉线，请先在本机微信完成登录。');
  }
  if (anomalySummary.popupDetected && !confirmation.popupCleared) {
    blockers.push('检测到可能存在弹窗/遮挡，请人工清理后再继续。');
  }
  if (
    anomalySummary.contactAmbiguous &&
    !confirmation.contactAmbiguityResolved
  ) {
    blockers.push('当前窗口或联系人信息存在歧义，请人工核对后再继续。');
  }
  if (anomalySummary.permissionBlocked) {
    blockers.push('桌面控制权限、截图、输入或点击能力未通过 preflight。');
  }
  if (!targetContact) {
    warnings.push('目标联系人为空，无法锁定当前会话。');
  }
  if (!confirmation.currentWindowConfirmed) {
    warnings.push('当前微信窗口尚未人工确认');
  }
  if (!confirmation.contactConfirmed) {
    warnings.push('目标联系人/当前会话尚未人工确认');
  }
  if (!confirmation.draftBeforeFillConfirmed) {
    warnings.push('草稿填入前确认尚未完成');
  }
  if (confirmation.takeoverActive) {
    warnings.push('人工接管中，后端不会继续自动填入草稿');
  }
  if (confirmation.stoppedAt) {
    blockers.push(confirmation.stopReason || '微信会话已停止');
  }

  const canDraft =
    desktop.available &&
    !anomalySummary.permissionBlocked &&
    blockers.length === 0 &&
    Boolean(targetContact) &&
    confirmation.currentWindowConfirmed === true &&
    confirmation.contactConfirmed === true &&
    confirmation.draftBeforeFillConfirmed === true &&
    confirmation.takeoverActive !== true;

  return {
    checkedAt: new Date().toISOString(),
    desktop,
    targetContact,
    alignment: confirmation.alignment,
    currentWindowConfirmed: confirmation.currentWindowConfirmed === true,
    contactConfirmed: confirmation.contactConfirmed === true,
    draftBeforeFillConfirmed: confirmation.draftBeforeFillConfirmed === true,
    manualTakeoverActive: confirmation.takeoverActive === true,
    takeoverActive: confirmation.takeoverActive === true,
    stopped: Boolean(confirmation.stoppedAt),
    stoppedAt: confirmation.stoppedAt,
    stopReason: confirmation.stopReason,
    updatedAt: confirmation.updatedAt,
    canDraft,
    blockers,
    warnings,
    evidence: this.desktopEvidence.slice(-10).reverse(),
    lock: {
      locked: canDraft,
      lockedAt: confirmation.lockCapturedAt,
      windowTitle:
        confirmation.lockedWindowTitle ||
        desktop.window.currentWindowTitle ||
        null,
      targetContact,
      message: canDraft
        ? '当前微信窗口和联系人已锁定，可填入草稿，仍不会自动发送。'
        : '尚未完成窗口、联系人、草稿填入前确认或存在阻断项。',
    },
    anomalySummary,
    nextAction: canDraft
      ? '可以填入草稿；发送按钮仍需人工点击。'
      : blockers[0] || warnings[0] || '请完成人工确认后继续。',
  };
}

export async function confirmWechatSession(
  this: WechatSessionHost,
  input: UpdateWechatSessionConfirmationInput,
): Promise<LocalEngineWechatSessionStatus> {
  const now = new Date().toISOString();
  this.wechatSessionConfirmation = {
    ...this.wechatSessionConfirmation,
    ...input,
    targetContact:
      input.targetContact?.trim() ||
      this.wechatSessionConfirmation.targetContact,
    lockedWindowTitle:
      input.currentWindowTitle === undefined
        ? this.wechatSessionConfirmation.lockedWindowTitle
        : input.currentWindowTitle,
    contactAmbiguityResolved:
      input.contactAmbiguityResolved ??
      (input.currentWindowConfirmed === true &&
      input.contactConfirmed === true &&
      input.draftBeforeFillConfirmed === true
        ? true
        : this.wechatSessionConfirmation.contactAmbiguityResolved),
    lockCapturedAt:
      input.currentWindowConfirmed &&
      input.contactConfirmed &&
      input.draftBeforeFillConfirmed
        ? now
        : this.wechatSessionConfirmation.lockCapturedAt,
    stoppedAt: undefined,
    stopReason: undefined,
    takeoverActive: false,
    updatedAt: now,
  };
  const evidence = await this.captureDesktopScreenshot(
    '微信会话确认截图',
  ).catch((error) => ({
    type: 'text' as const,
    label: '微信会话确认截图不可用',
    value: error instanceof Error ? error.message : '桌面截图失败',
    capturedAt: now,
  }));
  this.rememberDesktopEvidence(evidence);
  return this.getWechatSessionStatus();
}

export async function alignWechatSession(
  this: WechatSessionHost,
  input: AlignWechatSessionInput,
): Promise<LocalEngineWechatSessionStatus> {
  const targetContact = input.targetContact?.trim();
  if (!targetContact) {
    throw new BadRequestException('请先填写要自动打开的微信联系人或群名称。');
  }
  const now = new Date().toISOString();
  const alignment =
    await this.autoUploadService.alignWechatContact(targetContact);
  const evidence: LocalEngineDesktopScreenshotEvidence =
    alignment.evidence?.type === 'screenshot' && alignment.evidence.value
      ? {
          type: 'screenshot',
          label: alignment.evidence.label || '微信目标对齐截图',
          value: alignment.evidence.value,
          capturedAt: alignment.alignedAt || now,
        }
      : {
          type: 'text',
          label: '微信目标对齐结果',
          value: alignment.message,
          capturedAt: alignment.alignedAt || now,
        };
  this.rememberDesktopEvidence(evidence);

  this.wechatSessionConfirmation = {
    ...this.wechatSessionConfirmation,
    targetContact,
    currentWindowConfirmed: alignment.ok,
    contactConfirmed: alignment.ok,
    draftBeforeFillConfirmed: alignment.ok,
    currentWindowTitle:
      alignment.windowTitle ||
      alignment.matchedTitle ||
      this.wechatSessionConfirmation.currentWindowTitle ||
      null,
    contactAmbiguityResolved: alignment.ok,
    popupCleared: alignment.ok || this.wechatSessionConfirmation.popupCleared,
    loggedInConfirmed:
      alignment.stage !== 'wechat_missing' ||
      this.wechatSessionConfirmation.loggedInConfirmed,
    lockedWindowTitle:
      alignment.windowTitle ||
      alignment.matchedTitle ||
      this.wechatSessionConfirmation.lockedWindowTitle ||
      null,
    lockCapturedAt: alignment.ok
      ? now
      : this.wechatSessionConfirmation.lockCapturedAt,
    stoppedAt: undefined,
    stopReason: undefined,
    takeoverActive: false,
    updatedAt: now,
    alignment: {
      ok: alignment.ok,
      stage: alignment.stage,
      targetText: alignment.targetText,
      searchedText: alignment.searchedText,
      matchedTitle: alignment.matchedTitle,
      windowTitle: alignment.windowTitle,
      message: alignment.message,
      nextAction: alignment.nextAction,
      screenshotPath: alignment.screenshotPath,
      pageTextSample: alignment.pageTextSample,
      ambiguous: alignment.ambiguous,
      alignedAt: alignment.alignedAt,
    },
    note:
      input.note ||
      (alignment.ok
        ? '系统已自动搜索并打开微信目标会话。'
        : '系统已尝试自动搜索微信目标，但未能确认唯一会话。'),
    operator: input.operator || this.wechatSessionConfirmation.operator,
  };

  return this.getWechatSessionStatus();
}

export async function takeoverWechatSession(
  this: WechatSessionHost,
  input: WechatSessionControlInput = {},
  riskContext?: BackendRiskContext,
): Promise<LocalEngineWechatSessionStatus> {
  const riskAudit = assertBackendRiskGate({
    action: 'remote-control',
    target: `wechat-session:${input.operator?.trim() || 'current-user'}`,
    riskLevel: 'high',
    requiresConfirmation: true,
    confirmation: input.riskConfirmation,
    context: riskContext,
    reason: '微信桌面人工接管会暂停自动草稿动作并切换桌面控制权。',
  });
  const now = new Date().toISOString();
  this.wechatSessionConfirmation = {
    ...this.wechatSessionConfirmation,
    takeoverActive: true,
    updatedAt: now,
    note: input.reason?.trim() || this.wechatSessionConfirmation.note,
    operator: input.operator?.trim() || this.wechatSessionConfirmation.operator,
  };
  this.rememberDesktopEvidence({
    type: 'text',
    label: '微信人工接管',
    value: input.reason?.trim() || '用户进入人工接管，后端暂停自动草稿动作。',
    capturedAt: now,
  });
  this.rememberDesktopEvidence({
    type: 'diagnostic_bundle',
    label: '后端风控审计',
    value: JSON.stringify(riskAudit, null, 2),
    capturedAt: now,
  });
  return this.getWechatSessionStatus();
}

export async function stopWechatSession(
  this: WechatSessionHost,
  input: WechatSessionControlInput = {},
): Promise<LocalEngineWechatSessionStatus> {
  const now = new Date().toISOString();
  this.wechatSessionConfirmation = {
    ...this.wechatSessionConfirmation,
    currentWindowConfirmed: false,
    contactConfirmed: false,
    draftBeforeFillConfirmed: false,
    takeoverActive: false,
    stoppedAt: now,
    stopReason: input.reason?.trim() || '用户停止微信桌面会话',
    operator: input.operator?.trim() || this.wechatSessionConfirmation.operator,
    updatedAt: now,
  };
  this.rememberDesktopEvidence({
    type: 'text',
    label: '微信会话停止',
    value: this.wechatSessionConfirmation.stopReason || '用户停止微信桌面会话',
    capturedAt: now,
  });
  return this.getWechatSessionStatus();
}

export async function getFileAccessStatus(
  this: WechatSessionHost,
): Promise<LocalEngineFileAccessStatus> {
  const checkedAt = new Date().toISOString();
  const projectRoot = this.getRuntimeStateRoot();
  const runtimePaths = this.resolveLocalRuntimePaths();
  const roots = await Promise.all(
    [
      {
        key: 'project-root',
        name: '本机数据目录',
        path: projectRoot,
        note: '账号状态、任务记录和本机运行数据所在目录。',
      },
      {
        key: 'backend-root',
        name: '本机服务目录',
        path: runtimePaths.root,
        note: '本机服务保存运行状态的目录。',
      },
      {
        key: 'local-logs',
        name: '本机日志目录',
        path: runtimePaths.logs,
        note: '本机运行日志和临时证据所在目录。',
      },
      {
        key: 'local-runtime-root',
        name: '3011 本地 Runtime 目录',
        path: runtimePaths.root,
        note: '3011 后端保存素材、账号状态和证据的本地目录。',
      },
      {
        key: 'local-runtime-materials',
        name: '发布素材目录',
        path: runtimePaths.materials,
        note: '3011 本地 Runtime 读取的视频、图片等待发布素材。',
      },
      {
        key: 'auto-upload-materials',
        name: '发布素材目录',
        path: runtimePaths.materials,
        note: '发布中心和 AI 员工读取的视频、图片等待发布素材。',
      },
      {
        key: 'auto-upload-cookies',
        name: '平台账号凭证目录',
        path: runtimePaths.cookies,
        note: '本机平台账号登录态和 cookiesFile 兼容目录，只检查状态，不展示敏感内容。',
      },
      {
        key: 'auto-upload-logs',
        name: '发布执行日志目录',
        path: runtimePaths.logs,
        note: '发布中心、客户互动和本机执行器的日志目录。',
      },
      {
        key: 'local-runtime-logs',
        name: '本地 Runtime 日志目录',
        path: runtimePaths.logs,
        note: '3011 本地 Runtime 的运行日志和错误记录。',
      },
      {
        key: 'local-runtime-browser-profiles',
        name: '平台账号浏览器档案目录',
        path: runtimePaths.browserProfiles,
        note: '本地保存的平台登录态浏览器 profile，只检查状态，不展示敏感内容。',
      },
      {
        key: 'local-runtime-evidence',
        name: '互动证据目录',
        path: runtimePaths.evidence,
        note: '客户互动、发布执行的截图和页面回读证据。',
      },
      {
        key: 'local-runtime-avatars',
        name: '账号头像缓存目录',
        path: runtimePaths.avatars,
        note: '平台账号头像和身份识别缓存。',
      },
    ].map((target) => this.inspectPath(target)),
  );
  const ready = roots.filter((item) => item.exists && item.readable).length;

  return {
    checkedAt,
    summary: {
      total: roots.length,
      ready,
      warnings: roots.length - ready,
    },
    roots,
  };
}

export const wechatSessionMethods = {
  getWechatSessionStatus,
  confirmWechatSession,
  alignWechatSession,
  takeoverWechatSession,
  stopWechatSession,
  getFileAccessStatus,
};
