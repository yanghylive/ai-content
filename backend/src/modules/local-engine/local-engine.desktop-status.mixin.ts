/**
 * desktop 状态簇 mixin（微信桌面状态/异常检测/商业预检）。
 * 由 local-engine.service.ts 的 god class 拆解而来，EngineHost 模式。
 */
import type { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { AutoUploadWechatDesktopStatus } from '../auto-upload/auto-upload.client';

import type {
  LocalEngineDesktopCommercialPreflight,
  LocalEngineDesktopPermissionKey,
  LocalEngineDesktopScreenshotEvidence,
  LocalEngineDesktopStatus,
  UpdateWechatSessionConfirmationInput,
} from './local-engine.types';

/** desktop 状态簇的 host 接口 */
export interface DesktopStatusHost {
  autoUploadService: AutoUploadService;
  desktopEvidence: LocalEngineDesktopScreenshotEvidence[];
  wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
  };
  readWechatDesktopStatus();
  buildDesktopStatus(
    desktop: AutoUploadWechatDesktopStatus,
    checkedAt: string,
    screenshot?: LocalEngineDesktopScreenshotEvidence,
  ): LocalEngineDesktopStatus;
  detectWechatSessionAnomalies(desktop: LocalEngineDesktopStatus);
  isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus);
  hasWechatControlSurfaceEvidence(desktop: LocalEngineDesktopStatus);
  hasRunnableWechatWindowEvidence(desktop: LocalEngineDesktopStatus): boolean;
  isWechatTargetLocked(currentWindowTitle?: string | null): boolean;
  buildDesktopCommercialPreflight(
    desktop: AutoUploadWechatDesktopStatus,
  ): LocalEngineDesktopCommercialPreflight;

  detectWechatScreenshotSessionBlocker(
    textSample?: string | null,
  ): string | null;
  hasTrustedWechatAlignmentLock(): boolean;
  isWechatScreenshotSoftDiagnostic(diagnostic?: string | null): boolean;
  normalizeWindowTitles(desktop: {
    windowTitles?: string[];
    currentWindowTitle?: string | null;
    windowTitle?: string | null;
  }): string[];
}

export async function readWechatDesktopStatus(this: DesktopStatusHost) {
  try {
    return await this.autoUploadService.getWechatDesktopStatus();
  } catch (error) {
    return {
      platform: 'wechat',
      available: false,
      running: false,
      appName: '微信',
      windowCount: 0,
      permissionHints: [
        '请确认 3011 本地 Runtime 在线。',
        error instanceof Error ? error.message : '桌面微信状态读取失败',
      ],
      requiresManualTarget: true,
      message: '桌面微信状态读取失败',
    };
  }
}

export function buildDesktopStatus(
  this: DesktopStatusHost,
  desktop: AutoUploadWechatDesktopStatus,
  checkedAt: string,
  screenshot?: LocalEngineDesktopScreenshotEvidence,
): LocalEngineDesktopStatus {
  const permissionHints = desktop.permissionHints || [];
  const available = desktop.available === true && desktop.running === true;
  const appName = desktop.appName || '微信';
  const rawWindowTitle =
    (
      desktop as {
        currentWindowTitle?: string | null;
        windowTitle?: string | null;
      }
    ).currentWindowTitle ||
    (
      desktop as {
        currentWindowTitle?: string | null;
        windowTitle?: string | null;
      }
    ).windowTitle ||
    null;
  const windowTitles = this.normalizeWindowTitles(desktop);
  const currentWindowTitle = available
    ? rawWindowTitle ||
      windowTitles[0] ||
      `${appName}${desktop.windowCount ? `（${desktop.windowCount} 个窗口）` : ''}`
    : null;
  const windowCount = desktop.windowCount || 0;
  const hintText = permissionHints.join('；');
  const alignmentLockEvidenceReady = this.hasTrustedWechatAlignmentLock();
  const softScreenshotDiagnostic =
    screenshot?.trusted === false &&
    this.isWechatScreenshotSoftDiagnostic(screenshot.diagnostic);
  const screenshotTrusted =
    screenshot?.trusted !== false ||
    (alignmentLockEvidenceReady && softScreenshotDiagnostic);
  const screenshotMismatch =
    screenshot?.trusted === false && !screenshotTrusted;
  const screenshotOk = screenshotTrusted && screenshot?.type === 'screenshot';
  const screenshotSessionDiagnostic =
    screenshot && screenshotTrusted
      ? this.detectWechatScreenshotSessionBlocker(screenshot.textSample)
      : null;
  const inputControlOk =
    (desktop as { inputControlAvailable?: boolean }).inputControlAvailable ===
      true && available;
  const clickControlOk =
    (desktop as { clickControlAvailable?: boolean }).clickControlAvailable ===
      true && available;
  const fileSelectionOk =
    (desktop as { fileSelectionAvailable?: boolean }).fileSelectionAvailable ===
      true && available;
  const rawFrontmost = (desktop as { frontmost?: boolean }).frontmost;
  const frontmost =
    typeof rawFrontmost === 'boolean' ? rawFrontmost : available;
  const loggedOut = /未登录|掉线|登录已失效|login expired|not logged/i.test(
    `${desktop.message || ''}；${hintText}`,
  );
  const popupDetected = /弹窗|遮挡|modal|alert|dialog|更新|权限提示/i.test(
    `${desktop.message || ''}；${hintText}`,
  );
  const accessibilityBlocked = permissionHints.some((hint) =>
    /辅助|accessibility/i.test(hint),
  );
  const screenBlocked = permissionHints.some((hint) =>
    /屏幕|screen|录制|recording/i.test(hint),
  );
  const inputBlocked = permissionHints.some((hint) =>
    /输入|点击|键盘|鼠标|input|click|keyboard|mouse/i.test(hint),
  );
  const fileSelectionBlocked = permissionHints.some((hint) =>
    /文件选择|选择文件|素材选择|file.?select|file.?picker/i.test(hint),
  );
  const permissionBlocked =
    !available ||
    accessibilityBlocked ||
    screenBlocked ||
    inputBlocked ||
    fileSelectionBlocked ||
    !inputControlOk ||
    !clickControlOk ||
    !fileSelectionOk;
  const lockedWechatTarget = this.isWechatTargetLocked(currentWindowTitle);
  const contactAmbiguous =
    available &&
    !lockedWechatTarget &&
    (windowCount !== 1 ||
      Boolean(this.wechatSessionConfirmation.targetContact) === false ||
      /搜索|通讯录|微信|WeChat$/i.test(currentWindowTitle || ''));
  const blockers = [
    !desktop.running ? '桌面微信未运行。' : '',
    permissionBlocked ? '桌面微信窗口或控制权限不可用。' : '',
    loggedOut ? '桌面微信可能已掉线或登录失效。' : '',
    screenshot?.trusted === false && !screenshotTrusted
      ? `桌面微信截图证据不可信：${screenshot.diagnostic || '截图内容无法证明是微信窗口。'}`
      : '',
    screenshotSessionDiagnostic
      ? `桌面微信不是可发送目标会话：${screenshotSessionDiagnostic}`
      : '',
    popupDetected && !this.wechatSessionConfirmation.popupCleared
      ? '检测到可能存在弹窗/遮挡。'
      : '',
  ].filter(Boolean);
  const warnings = [
    !screenshotOk ? '未拿到桌面截图证据，商用执行会被阻断。' : '',
    windowCount > 1
      ? `检测到 ${windowCount} 个微信窗口，请人工确认当前目标会话。`
      : '',
    contactAmbiguous ? '联系人信息需要人工核对，避免填错会话。' : '',
    available && !frontmost
      ? '桌面微信当前不是前台 App，执行脚本会在操作前切回微信并再次截图确认。'
      : '',
    this.wechatSessionConfirmation.takeoverActive
      ? '人工接管中，后端暂停自动草稿动作。'
      : '',
  ].filter(Boolean);

  return {
    checkedAt,
    platform: desktop.platform || 'wechat',
    available,
    running: desktop.running === true,
    appName,
    windowCount,
    permissionChecks: [
      {
        key: 'accessibility',
        label: '辅助功能权限',
        status: available && !accessibilityBlocked ? 'ready' : 'blocked',
        message:
          permissionHints.find((hint) => /辅助|accessibility/i.test(hint)) ||
          (available
            ? '桌面服务可检测微信窗口。'
            : '需要开启辅助功能权限或启动桌面微信。'),
        nextAction:
          available && !accessibilityBlocked
            ? undefined
            : '在 macOS 系统设置中允许终端/本地引擎控制电脑。',
      },
      {
        key: 'screen-recording',
        label: '屏幕录制权限',
        status:
          !screenBlocked && (screenshotOk || screenshotMismatch)
            ? 'ready'
            : 'blocked',
        message: screenshotOk
          ? screenshot?.trusted === false
            ? '已保存桌面截图；OCR 未识别文字，但自动对齐证据已锁定目标微信会话。'
            : screenshot?.type === 'screenshot'
              ? '已保存桌面截图证据。'
              : '桌面截图能力已通过。'
          : screenshotMismatch
            ? '屏幕录制可返回截图，但截图内容不是可验证的微信会话窗口。'
            : '未拿到桌面截图，回放证据会降级为文本记录。',
        nextAction:
          !screenBlocked && (screenshotOk || screenshotMismatch)
            ? undefined
            : '在 macOS 系统设置中允许屏幕录制后重试。',
      },
      {
        key: 'automation',
        label: '自动化控制权限',
        status: inputControlOk && clickControlOk ? 'ready' : 'blocked',
        message: available
          ? '当前只允许填入草稿，不点击发送。'
          : '微信窗口不可用，无法执行草稿填入。',
      },
      {
        key: 'clipboard',
        label: '剪贴板/输入权限',
        status: inputControlOk && !inputBlocked ? 'ready' : 'blocked',
        message:
          inputControlOk && !inputBlocked
            ? '草稿填入前必须人工确认当前会话。'
            : '微信窗口或输入权限不可用，不能写入草稿。',
      },
      {
        key: 'foreground-app',
        label: '前台 App',
        status: frontmost || available ? 'ready' : 'blocked',
        message: frontmost
          ? `${appName} 当前可作为前台候选。`
          : available
            ? '微信已运行；网页操作会把浏览器置前，执行时会切回微信。'
            : '无法确认微信处于前台。',
        nextAction:
          frontmost || available
            ? undefined
            : '请把桌面微信切到前台目标会话后重试。',
      },
      {
        key: 'window-list',
        label: '窗口列表',
        status:
          available && windowCount === 1
            ? 'ready'
            : available
              ? 'warning'
              : 'blocked',
        message: windowTitles.length
          ? `检测到窗口：${windowTitles.join('、')}`
          : available
            ? `检测到 ${windowCount} 个微信窗口。`
            : '未读取到微信窗口列表。',
        nextAction:
          available && windowCount === 1
            ? undefined
            : '请保留一个目标微信窗口，并人工确认窗口标题。',
      },
      {
        key: 'screenshot',
        label: '截图能力',
        status: screenshotOk ? 'ready' : 'blocked',
        message: screenshotOk
          ? '截图证据可用。'
          : screenshot?.trusted === false
            ? screenshot.diagnostic || '截图内容无法证明是微信窗口。'
            : '截图能力不可用，无法留存商用执行证据。',
      },
      {
        key: 'input-control',
        label: '输入能力',
        status: inputControlOk && !inputBlocked ? 'ready' : 'blocked',
        message:
          inputControlOk && !inputBlocked
            ? '可执行草稿输入预检。'
            : '无法确认键盘输入/粘贴能力。',
      },
      {
        key: 'click-control',
        label: '点击能力',
        status: clickControlOk && !inputBlocked ? 'ready' : 'blocked',
        message:
          clickControlOk && !inputBlocked
            ? '可执行窗口聚焦/定位类点击预检，不允许自动发送。'
            : '无法确认鼠标点击能力。',
      },
      {
        key: 'file-selection',
        label: '文件选择能力',
        status: fileSelectionOk && !fileSelectionBlocked ? 'ready' : 'blocked',
        message:
          fileSelectionOk && !fileSelectionBlocked
            ? '素材/文件选择预检可用，仍需人工确认目标窗口。'
            : '无法确认文件选择器或素材选择能力，不能执行带附件/素材的微信桌面任务。',
        nextAction:
          fileSelectionOk && !fileSelectionBlocked
            ? undefined
            : '请确认 Agent-S/local-controller 已接入文件选择预检，并授予必要的文件访问权限。',
      },
      {
        key: 'manual-takeover',
        label: '人工接管',
        status: 'ready',
        message: this.wechatSessionConfirmation.takeoverActive
          ? '人工接管已开启，自动草稿动作暂停。'
          : '人工接管开关可用，可随时暂停自动草稿动作。',
      },
      {
        key: 'stop-control',
        label: '停止任务',
        status: 'ready',
        message: this.wechatSessionConfirmation.stoppedAt
          ? `微信会话已停止：${this.wechatSessionConfirmation.stopReason || '用户停止'}`
          : '停止任务开关可用，会清空窗口/联系人确认。',
      },
    ],
    window: {
      appName,
      windowTitle: currentWindowTitle,
      bundleId: (desktop as { bundleId?: string | null }).bundleId || null,
      isWechat: available,
      running: desktop.running === true,
      frontmost,
      windowCount,
      windowTitles,
      currentWindowTitle,
      currentWindowLikelyWechatChat:
        available &&
        !screenshotSessionDiagnostic &&
        (lockedWechatTarget || (windowCount === 1 && !contactAmbiguous)),
      contactHint: this.wechatSessionConfirmation.targetContact || null,
      currentWindowConfirmed:
        this.wechatSessionConfirmation.currentWindowConfirmed === true,
      targetContact: this.wechatSessionConfirmation.targetContact,
      contactConfirmed:
        this.wechatSessionConfirmation.contactConfirmed === true,
      message: screenshotSessionDiagnostic
        ? screenshotSessionDiagnostic
        : contactAmbiguous
          ? '需要人工确认当前窗口就是目标会话。'
          : '当前窗口可作为微信会话候选。',
      checkedAt,
    },
    screenshot,
    recentEvidence: this.desktopEvidence.slice(-10).reverse(),
    blockers,
    warnings,
    safetyBoundary: {
      draftOnly: desktop.safetyBoundary?.draftOnly ?? true,
      requiresManualTarget: desktop.requiresManualTarget ?? true,
      requiresManualSend: true,
      readsPrivateChats: desktop.safetyBoundary?.readsPrivateChats ?? false,
      sendsMessages: desktop.safetyBoundary?.sendsMessages ?? false,
    },
    takeover: {
      available,
      active: this.wechatSessionConfirmation.takeoverActive === true,
      message: this.wechatSessionConfirmation.takeoverActive
        ? '人工接管中，后端不会继续自动填入。'
        : '可点击人工接管暂停自动动作。',
    },
    takeoverActive: this.wechatSessionConfirmation.takeoverActive === true,
    stopped: Boolean(this.wechatSessionConfirmation.stoppedAt),
    message: desktop.message,
    nextAction: available
      ? '请确认当前微信窗口、联系人和草稿内容后再填入草稿。'
      : '请先打开桌面微信并授予辅助功能/屏幕录制权限。',
  };
}

export function detectWechatSessionAnomalies(
  this: DesktopStatusHost,
  desktop: LocalEngineDesktopStatus,
) {
  const joined = [
    desktop.message,
    desktop.window.currentWindowTitle || '',
    ...desktop.blockers,
    ...desktop.warnings,
    ...desktop.permissionChecks.map((check) => check.message),
  ].join('；');
  const permissionBlocked = desktop.permissionChecks.some(
    (check) => check.status === 'blocked',
  );

  return {
    loggedOut: /未登录|掉线|登录已失效|login expired|not logged/i.test(joined),
    popupDetected: /弹窗|遮挡|modal|alert|dialog|更新|权限提示/i.test(joined),
    contactAmbiguous:
      !this.isWechatTargetLocked(desktop.window.currentWindowTitle) &&
      (desktop.window.windowCount !== 1 ||
        !this.wechatSessionConfirmation.targetContact ||
        /搜索|通讯录|微信|WeChat$/i.test(
          desktop.window.currentWindowTitle || '',
        )),
    permissionBlocked,
  };
}

export function isDesktopWechatRuntimeRunnable(
  this: DesktopStatusHost,
  desktop: LocalEngineDesktopStatus,
) {
  if (!desktop.available || !desktop.running) return false;
  const hardBlocker = desktop.blockers.some((blocker) =>
    /未运行|掉线|登录失效|登录|权限|不可用|不可信|不是可发送目标会话|弹窗|遮挡/.test(
      blocker,
    ),
  );
  if (hardBlocker) return false;
  const requiredPermissionKeys: LocalEngineDesktopPermissionKey[] = [
    'accessibility',
    'screen-recording',
    'automation',
    'clipboard',
    'screenshot',
    'input-control',
    'click-control',
    'file-selection',
  ];
  return requiredPermissionKeys.every((key) =>
    desktop.permissionChecks.some(
      (check) => check.key === key && check.status === 'ready',
    ),
  );
}

export function hasWechatControlSurfaceEvidence(
  this: DesktopStatusHost,
  desktop: LocalEngineDesktopStatus,
) {
  if (!desktop.available || desktop.takeoverActive || desktop.stopped) {
    return false;
  }
  if (desktop.screenshot?.type !== 'screenshot') {
    return false;
  }
  if (desktop.screenshot.trusted === false) {
    return false;
  }
  if (
    this.detectWechatScreenshotSessionBlocker(desktop.screenshot.textSample)
  ) {
    return false;
  }
  const normalized = String(desktop.screenshot.textSample || '').replace(
    /\s+/g,
    '',
  );
  const controlMarkers = [
    '搜索',
    '聊天',
    '发送',
    '语音输入',
    '表情',
    '通讯录',
    '订阅号',
    '服务号',
    '朋友圈',
  ];
  const titleLooksLikeWechat = /微信|WeChat/i.test(
    desktop.window.currentWindowTitle || desktop.window.windowTitle || '',
  );
  return (
    titleLooksLikeWechat ||
    controlMarkers.some((marker) => normalized.includes(marker))
  );
}

export function hasRunnableWechatWindowEvidence(
  this: DesktopStatusHost,
  desktop: LocalEngineDesktopStatus,
) {
  if (!desktop.available || desktop.blockers.length > 0) return false;
  if (desktop.takeoverActive || desktop.stopped) return false;
  if (desktop.window.windowCount > 1) return false;
  if (desktop.screenshot?.type !== 'screenshot') return false;
  if (desktop.screenshot.trusted === false) return false;
  if (
    this.detectWechatScreenshotSessionBlocker(desktop.screenshot.textSample)
  ) {
    return false;
  }
  const normalized = String(desktop.screenshot.textSample || '').replace(
    /\s+/g,
    '',
  );
  const strongMarkers = [
    '搜索',
    '聊天',
    '群',
    '发送',
    '语音输入',
    '表情',
    '通讯录',
    '订阅号',
    '服务号',
    '朋友圈',
  ];
  const hasStrongMarker = strongMarkers.some((marker) =>
    normalized.includes(marker),
  );
  const genericSingleWechatWindow =
    /^(微信|WeChat)$/i.test(desktop.window.currentWindowTitle || '') &&
    desktop.window.windowCount === 1;
  return hasStrongMarker || genericSingleWechatWindow;
}

export function isWechatTargetLocked(
  this: DesktopStatusHost,
  currentWindowTitle?: string | null,
) {
  const targetContact = this.wechatSessionConfirmation.targetContact?.trim();
  if (!targetContact) return false;
  if (
    this.wechatSessionConfirmation.currentWindowConfirmed !== true ||
    this.wechatSessionConfirmation.contactConfirmed !== true ||
    this.wechatSessionConfirmation.draftBeforeFillConfirmed !== true
  ) {
    return false;
  }
  const lockedTitle = this.wechatSessionConfirmation.lockedWindowTitle?.trim();
  const candidates = [currentWindowTitle, lockedTitle]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (!candidates.length) return false;
  const titleMatchesTarget = candidates.some(
    (title) =>
      title.includes(targetContact) ||
      targetContact.includes(title) ||
      (Boolean(lockedTitle) && title === lockedTitle),
  );
  if (titleMatchesTarget) return true;

  const hasCapturedLock = Boolean(
    this.wechatSessionConfirmation.lockCapturedAt,
  );
  const singleGenericWechatWindow =
    candidates.length === 1 && /^(微信|WeChat)$/i.test(candidates[0]);
  return (
    hasCapturedLock &&
    this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
    singleGenericWechatWindow
  );
}

export function buildDesktopCommercialPreflight(
  this: DesktopStatusHost,
  desktop: LocalEngineDesktopStatus,
): LocalEngineDesktopCommercialPreflight {
  const requiredKeys = new Set([
    'accessibility',
    'screen-recording',
    'foreground-app',
    'window-list',
    'screenshot',
    'input-control',
    'click-control',
    'file-selection',
    'manual-takeover',
    'stop-control',
  ]);
  const requiredChecks = desktop.permissionChecks.filter((check) =>
    requiredKeys.has(check.key),
  );
  const windowEvidenceRunnable = this.hasRunnableWechatWindowEvidence(desktop);
  const blockers = [
    ...desktop.blockers,
    ...requiredChecks
      .filter((check) => check.status === 'blocked')
      .map((check) => `${check.label}不可用：${check.message}`),
    !desktop.window.currentWindowLikelyWechatChat && !windowEvidenceRunnable
      ? '无法确认当前前台窗口是唯一微信目标会话。'
      : '',
    desktop.takeoverActive ? '人工接管中，禁止自动填入草稿。' : '',
    desktop.stopped ? '微信桌面任务已停止，禁止继续执行。' : '',
  ].filter(Boolean);
  const warnings = [
    ...desktop.warnings,
    !desktop.window.currentWindowLikelyWechatChat && windowEvidenceRunnable
      ? '已取得可信微信窗口证据，但当前未锁定具体联系人；商用测试账号按受控执行风险提示继续。'
      : '',
    ...requiredChecks
      .filter((check) => check.status === 'warning')
      .map((check) => `${check.label}需要人工确认：${check.message}`),
  ];
  const allowed = blockers.length === 0;

  return {
    allowed,
    checkedAt: new Date().toISOString(),
    requiredFor: [
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ],
    blockers,
    warnings,
    checks: requiredChecks,
    window: desktop.window,
    screenshot: desktop.screenshot,
    takeoverReady: desktop.permissionChecks.some(
      (check) => check.key === 'manual-takeover' && check.status === 'ready',
    ),
    stopReady: desktop.permissionChecks.some(
      (check) => check.key === 'stop-control' && check.status === 'ready',
    ),
    message: allowed
      ? '桌面微信商用 preflight 通过：权限、前台窗口、截图、输入/点击、接管和停止能力均可用。'
      : `桌面微信商用 preflight 阻断：${blockers[0] || '存在未知阻断项'}`,
    nextAction: allowed
      ? '可进入人工确认；系统仍只填入草稿，不自动发送。'
      : blockers[0] || '请修复桌面权限和窗口状态后重试。',
  };
}

/** mixin 挂载对象（service 底部 Object.assign） */
export const desktopStatusMethods = {
  readWechatDesktopStatus,
  buildDesktopStatus,
  detectWechatSessionAnomalies,
  isDesktopWechatRuntimeRunnable,
  hasWechatControlSurfaceEvidence,
  hasRunnableWechatWindowEvidence,
  isWechatTargetLocked,
  buildDesktopCommercialPreflight,
};
