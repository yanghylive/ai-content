import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalBrowserEngine } from '../local-engine/local-browser-engine.service';
import { PlaywrightBrowserRuntimeService } from '../local-engine/playwright-browser-runtime.service';
import { PlaywrightMcpService } from '../local-engine/playwright-mcp.service';
import { PlatformInteractionExecutor } from '../local-engine/platform-interaction-executor.service';
import type {
  ExecutorTaskPlatform,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MOJIBAKE_MARKERS = /(?:Ã.|Â.|â.|æ|è|é|å|ç|¢|£|¤|¥|¦|§|¨|©|ª|«|¬|®|¯|°|±|²|³|´|µ|¶|·|¸|¹|º|»|¼|½|¾|¿)/;

export type AutoUploadEngineHealth = {
  online: boolean;
  status: string;
  service: string;
  version: string;
  engineUrl: string;
  baseDir?: string;
  frontendDist?: string;
  database?: {
    path: string;
    exists: boolean;
  };
  folders?: Record<string, { path: string; exists: boolean }>;
  checkedAt: string;
};

export type AutoUploadInteractionCapabilities = {
  service: string;
  version: string;
  checkedAt: string;
  supportedTaskTypes: Array<{
    key: string;
    platformType: number;
    platformName: string;
    entryType: string;
    stages: string[];
    controlledSend: boolean;
    autoSend?: boolean;
    evidence: string[];
  }>;
  evidence: {
    directory: string;
    urlPrefix: string;
    fileCount: number;
    totalBytes: number;
    latestUpdatedAt?: string | null;
  };
  screenshotCleanup: {
    recommendation: string;
    retentionDays: number;
    maxFiles: number;
    safePattern: string;
    suggestedCommand: string;
  };
  safetyBoundary: {
    host: string;
    network: string;
    dataLocality: string;
    browserAutomation: string;
    sendPolicy: string;
    pathAccess: string[];
  };
};

export type AutoUploadCdpBrowserSession = {
  platform: string;
  accountId: string | number;
  profileDir?: string;
  debuggingPort?: number;
  status: 'starting' | 'ready' | 'needs_login' | 'blocked' | 'stopped' | string;
  visibleWindow?: boolean;
  currentUrl?: string;
  lastError?: string;
  activeProfile?: boolean;
  browser?: string;
  runtimeMode?: string;
  browserReused?: boolean;
  startedAt?: string;
};

export type AutoUploadCdpSessionsResult = {
  available: boolean;
  sessions: AutoUploadCdpBrowserSession[];
  message: string;
  checkedAt: string;
};

export type AutoUploadInteractionEvidenceCleanupResult = {
  directory: string;
  retentionDays: number;
  execute: boolean;
  candidateCount: number;
  deletedCount: number;
  totalBytes: number;
  files: Array<{
    name: string;
    path: string;
    sizeBytes: number;
    updatedAt: string;
  }>;
  errors: string[];
  checkedAt: string;
  status: AutoUploadInteractionCapabilities['evidence'];
};

export type AutoUploadAccount = {
  id: number;
  type: number;
  platform: string;
  filePath: string;
  userName: string;
  profileName?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  status: number;
  statusLabel: string;
  avatarUpdatedAt?: string | null;
};

export type AutoUploadOpenAccountsResult = {
  opened: number;
  openedIds?: Array<number | string>;
  skipped?: Array<{ id: number | string; reason: string }>;
};

export type AutoUploadInteractionEvidence = {
  type: 'snapshot' | 'screenshot' | 'text';
  label: string;
  value: string;
  path?: string;
};

export type AutoUploadInteractionEntryResult = {
  accountId: number;
  accountName: string;
  platformType: number;
  platformName: string;
  entryType: string;
  entryName: string;
  url: string;
  title?: string | null;
  loggedIn?: boolean | null;
  pageTextSample?: string | null;
  evidence?: AutoUploadInteractionEvidence | null;
  runtimeMode?: string | null;
  profileDir?: string | null;
  cdpPort?: number | null;
  browser?: string | null;
  browserReused?: boolean | null;
  status: string;
  accountStatus?: number;
  openedAt?: string | null;
};

export type AutoUploadDouyinComment = {
  text: string;
  looksLikeComment?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type AutoUploadInteractionReadSummary = {
  totalCandidates: number;
  usableCount: number;
  emptyReason?: string | null;
  blocked?: boolean;
  blockedReason?: string | null;
  nextAction?: string | null;
};

export type AutoUploadInteractionRuntime = {
  runtimeMode?: 'persistent-cdp-browser' | string;
  profileDir?: string | null;
  cdpPort?: number | null;
  browser?: string | null;
  browserReused?: boolean | null;
  currentUrl?: string | null;
  networkTrace?: Array<{
    kind?: string;
    url?: string;
    method?: string;
    status?: number;
    resourceType?: string;
    errorText?: string;
    timestamp?: string;
  }>;
};

export type AutoUploadDouyinCommentsReadResult = {
  accountId: number;
  accountName: string;
  platformType: number;
  platformName: string;
  url: string;
  title: string;
  comments: AutoUploadDouyinComment[];
  summary?: AutoUploadInteractionReadSummary;
  pageTextSample?: string;
  evidence?: AutoUploadInteractionEvidence | null;
  readAt: string;
} & AutoUploadInteractionRuntime;

export type AutoUploadWechatChannelCommentsReadResult =
  AutoUploadDouyinCommentsReadResult;

export type AutoUploadDouyinMessage = {
  text: string;
  looksLikeMessage?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type AutoUploadDouyinMessagesReadResult = {
  accountId: number;
  accountName: string;
  platformType: number;
  platformName: string;
  url: string;
  title: string;
  messages: AutoUploadDouyinMessage[];
  summary?: AutoUploadInteractionReadSummary;
  loadBlocked?: boolean;
  loadBlockedReason?: string | null;
  selectedTab?: string | null;
  scannedTabs?: Array<{
    label?: string;
    clicked?: boolean;
    totalCandidates?: number;
    usableCount?: number;
    loading?: number;
    pageTextSample?: string;
  }>;
  pageLoadState?: {
    text?: string;
    tabsVisible?: boolean;
    hasEmptyState?: boolean;
    hasConversationHint?: boolean;
    contentLength?: number;
    visibleLoaders?: number;
  } | null;
  pageTextSample?: string;
  evidence?: AutoUploadInteractionEvidence | null;
  readAt: string;
} & AutoUploadInteractionRuntime;

export type AutoUploadWechatChannelMessagesReadResult =
  AutoUploadDouyinMessagesReadResult;

export type AutoUploadWechatDesktopStatus = {
  platform: string;
  available: boolean;
  running: boolean;
  appName?: string | null;
  windowCount: number;
  currentWindowTitle?: string | null;
  windowTitles?: string[];
  bundleId?: string | null;
  frontmost?: boolean;
  screenshotAvailable?: boolean;
  inputControlAvailable?: boolean;
  clickControlAvailable?: boolean;
  fileSelectionAvailable?: boolean;
  permissionHints?: string[];
  safetyBoundary?: {
    draftOnly: boolean;
    readsPrivateChats: boolean;
    readsContacts: boolean;
    sendsMessages: boolean;
    targeting: string;
    manualSteps: string[];
  };
  requiresManualTarget?: boolean;
  message: string;
  checkedAt?: string;
};

export type AutoUploadWechatDraftResult = {
  status: 'draft_filled' | 'wechat_missing' | 'desktop_permission_missing';
  message: string;
  targetText?: string;
  replyText: string;
  desktop?: AutoUploadWechatDesktopStatus;
  confirmsDraftOnly: boolean;
  requiresManualSend: boolean;
  draftedAt: string;
};

export type AutoUploadWechatSendResult = Omit<
  AutoUploadWechatDraftResult,
  'status' | 'confirmsDraftOnly' | 'requiresManualSend'
> & {
  status:
    | 'sent'
    | 'send_failed'
    | 'draft_not_ready'
    | 'wechat_missing'
    | 'desktop_permission_missing';
  sent: boolean;
  evidence?: AutoUploadInteractionEvidence | null;
  readbackText?: string;
  editorCleared?: boolean;
  replyVisible?: boolean;
  nextAction?: string | null;
  sentAt?: string;
};

export type AutoUploadRefreshAccountAvatarResult = {
  avatarPath: string | null;
  avatarUrl: string | null;
  ok?: boolean;
  id?: number;
  error?: string | null;
};

export type AutoUploadCancelLoginResult = {
  cancelled: boolean;
  requestId?: string;
  message?: string;
};

type AutoUploadEngineMaterial = {
  id: number;
  filename: string;
  filesize?: number | null;
  upload_time?: string | null;
  file_path?: string | null;
};

type LocalUploadMaterialIndex = {
  nextId: number;
  files: Array<{
    id: number;
    filename: string;
    filepath: string;
    uploadedAt: string;
  }>;
};

export type AutoUploadMaterial = {
  id: number;
  filename: string;
  filesizeMb: number | null;
  uploadTime: string | null;
  filePath: string | null;
};

export type AutoUploadLogFile = {
  key: string;
  platform: string;
  filename: string;
  path: string;
  size: number;
  updatedAt: string;
  lines: string[];
};

export type AutoUploadPublishTask = {
  id: number;
  title: string;
  platform_type: number;
  platform: string;
  account_file: string;
  file_list: string[] | null;
  tags: string[] | null;
  dry_run: boolean;
  status: string;
  message: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type UploadedAutoUploadMaterial = {
  filename: string;
  filepath: string;
};

export type AutoUploadPublishPayload = {
  type: number;
  accountIds?: number[];
  contentKind?: 'article' | 'video';
  title: string;
  tags: string[];
  fileList: string[];
  accountList: string[];
  enableTimer?: 0 | 1;
  videosPerDay?: number;
  dailyTimes?: string[];
  startDays?: number;
  timeJitterMinutes?: number;
  scheduleTime?: string;
  debugDryRun?: boolean;
  debugDryRunHoldBrowser?: boolean;
  skipAccountCheck?: boolean;
  category?: number;
  coverPath?: string;
  coverPaths?: Record<string, string>;
  biliTitle?: string;
  biliType?: string;
  biliPartition?: string;
  biliDesc?: string;
};

export type AutoUploadPublishResponse = {
  reason?: string;
  taskIds?: number[];
  results?: Array<{
    type: number;
    ok?: boolean | null;
    message?: string;
    platform?: string;
    account?: string;
    publishUrl?: string;
    externalId?: string;
    articleId?: string;
    postId?: string;
    platformUrl?: string;
    notIntegrated?: boolean;
    evidence?: unknown;
  }>;
} | null;

type AutoUploadPublishResultItem = NonNullable<
  NonNullable<AutoUploadPublishResponse>['results']
>[number];

export type AutoUploadPublishPlatformEntry = {
  platform: string;
  accountId: string;
  status:
    | 'success'
    | 'failed'
    | 'account_expired'
    | 'material_error'
    | 'login_required'
    | 'pending_manual'
    | 'not_integrated'
    | 'skipped';
  failureReason?: string;
  nextAction?: string;
  publishTaskId?: string;
  publishUrl?: string;
  externalId?: string;
  evidence?: unknown;
};

export type AutoUploadPublishBatchResult = {
  platforms: AutoUploadPublishPlatformEntry[];
  summary: {
    total: number;
    success: number;
    failed: number;
    accountExpired: number;
    materialError: number;
    loginRequired: number;
    pendingManual: number;
    notIntegrated: number;
  };
};

export type AutoUploadUploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

@Injectable()
export class AutoUploadClient {
  private readonly logger = new Logger(AutoUploadClient.name);
  private readonly cancelledLoginRequestIds = new Set<string>();
  private readonly activeLoginSessionKeys = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mcp: PlaywrightMcpService,
    private readonly interactionExecutor: PlatformInteractionExecutor,
    private readonly runtime: RuntimeOrchestrator,
    private readonly browserRuntime: PlaywrightBrowserRuntimeService,
    @Optional() private readonly localBrowser?: LocalBrowserEngine,
  ) {}

  private getKaypalDesktopScriptPath(scriptName: string) {
    const explicitRoot = this.configService.get<string>(
      'KAYPAL_DESKTOP_SCRIPT_ROOT',
    );
    const candidates = [
      explicitRoot ? join(explicitRoot, scriptName) : '',
      join(
        process.cwd(),
        '..',
        '..',
        'kaypal-ai',
        'vendor',
        'open-cowork-upstream',
        'scripts',
        scriptName,
      ),
      join(
        dirname(process.cwd()),
        'kaypal-ai',
        'vendor',
        'open-cowork-upstream',
        'scripts',
        scriptName,
      ),
    ].filter(Boolean);
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
      throw new Error(`系统内置微信桌面脚本不存在：${scriptName}`);
    }
    return found;
  }

  private async executeWechatDesktopScript(
    scriptName: string,
    args: string[],
    timeoutMs = 120000,
  ): Promise<Record<string, any>> {
    const scriptPath = this.getKaypalDesktopScriptPath(scriptName);
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: dirname(scriptPath),
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const output = stdout.trim();
    if (!output) {
      throw new Error(`${scriptName} 未返回执行结果`);
    }
    return JSON.parse(output);
  }

  async getHealth(): Promise<AutoUploadEngineHealth> {
    const status = await this.interactionExecutor.getStatus();
    return {
      online: status.online,
      status: status.online ? 'ok' : 'missing',
      service: 'ai-content local browser runtime',
      version: '0.1.0',
      engineUrl: 'internal://local-browser-engine',
      baseDir: process.cwd(),
      checkedAt: new Date().toISOString(),
    };
  }

  async getInteractionCapabilities(): Promise<AutoUploadInteractionCapabilities> {
    const evidenceStatus = this.collectInteractionEvidenceCleanup(7, false).status;
    const status = await this.interactionExecutor.getStatus();
    return {
      service: 'ai-content local interaction runtime',
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
      supportedTaskTypes: [
        {
          key: 'DOUYIN_COMMENT_REPLY',
          platformType: 3,
          platformName: '抖音',
          entryType: 'douyin:comment',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: ['runtime_executions', 'interaction_tasks', 'browser_snapshot'],
        },
        {
          key: 'DOUYIN_DIRECT_MESSAGE_REPLY',
          platformType: 3,
          platformName: '抖音',
          entryType: 'douyin:message',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: ['runtime_executions', 'interaction_tasks', 'browser_snapshot'],
        },
        {
          key: 'WECHAT_CHANNEL_COMMENT_REPLY',
          platformType: 2,
          platformName: '视频号',
          entryType: 'wechat-channel:comment',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: ['runtime_executions', 'interaction_tasks', 'browser_snapshot'],
        },
        {
          key: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
          platformType: 2,
          platformName: '视频号',
          entryType: 'wechat-channel:message',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: ['runtime_executions', 'interaction_tasks', 'browser_snapshot'],
        },
      ],
      evidence: evidenceStatus,
      screenshotCleanup: {
        recommendation: 'keep-last-7-days',
        retentionDays: 7,
        maxFiles: evidenceStatus.fileCount,
        safePattern: evidenceStatus.directory,
        suggestedCommand:
          'POST /api/auto-upload/interaction/evidence/cleanup?retentionDays=7',
      },
      safetyBoundary: {
        host: '127.0.0.1:3011',
        network: status.online ? 'ready' : 'offline',
        dataLocality: 'Postgres ai_content + local evidence files',
        browserAutomation: status.visibleWindow && !status.isolated
          ? 'local-browser-engine visible persistent profile'
          : 'local-browser-engine not commercial-ready',
        sendPolicy: 'default auto-send; controlled by task policy',
        pathAccess: [evidenceStatus.directory, this.getLocalMaterialDir()],
      },
    };
  }

  async getCdpSessions(): Promise<AutoUploadCdpSessionsResult> {
    const status = await this.interactionExecutor.getStatus();
    const rows = await this.prisma.publishAccount.findMany({
      orderBy: { createdAt: 'asc' },
    });
    const activeSessions = await this.interactionExecutor.listSessions();
    const recentInteractionTasks = await this.prisma.interactionTask.findMany({
      where: {
        taskType: {
          in: [
            'DOUYIN_COMMENT_REPLY',
            'DOUYIN_DIRECT_MESSAGE_REPLY',
            'WECHAT_CHANNEL_COMMENT_REPLY',
            'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
          ] as never,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    const sessions: AutoUploadCdpBrowserSession[] = rows.map((row) => {
      const cfg = (row.config ?? {}) as {
        engineAccountId?: number;
        platformType?: number;
        profileName?: string;
        filePath?: string;
        status?: string;
      };
      const engineAccountId =
        typeof cfg.engineAccountId === 'number' ? cfg.engineAccountId : row.id;
      const accountArtifacts = this.getAccountLoginArtifacts(
        row.platform,
        String(engineAccountId),
        cfg.filePath,
      );
      const accountReady =
        (cfg.status ?? 'ready') === 'ready' ||
        accountArtifacts.hasPersistentLoginState;
      const runtimeReady = status.online && status.visibleWindow && !status.isolated;
      const activeSession = activeSessions.find(
        (session) =>
          session.platform === row.platform &&
          String(session.accountId) === String(engineAccountId),
      );
      const currentUrl = activeSession?.currentUrl;
      const latestInteractionTask = this.findLatestInteractionTaskForAccount(
        recentInteractionTasks,
        row.platform,
        [row.id, engineAccountId],
      );
      const pageNeedsLogin = this.isLoginPageUrl(currentUrl);
      const currentUrlIsPlatformPage =
        currentUrl != null && this.isPlatformPageUrl(row.platform, currentUrl);
      const latestTaskNeedsLogin =
        this.isRecentInteractionLoginBlocker(latestInteractionTask) &&
        (!currentUrl || pageNeedsLogin || !currentUrlIsPlatformPage);
      const needsLogin = pageNeedsLogin || latestTaskNeedsLogin;
      const sessionStatus = (() => {
        if (!runtimeReady) return 'blocked';
        if (needsLogin) return 'needs_login';
        if (!activeSession) return 'unknown';
        if (currentUrlIsPlatformPage) return 'ready';
        return 'unknown';
      })();
      const sessionLastError = (() => {
        if (!runtimeReady) {
          return status.online
            ? `浏览器 Runtime 不满足商用要求：visible=${status.visibleWindow}, isolated=${status.isolated}`
            : status.message || 'local-browser-engine 未就绪';
        }
        if (needsLogin) {
          return latestTaskNeedsLogin
            ? '平台页面要求重新登录（最近一次真实读取失败）'
            : '平台页面要求重新登录';
        }
        if (!accountReady) {
          return '未找到 cookiesFile 或持久浏览器 profile 登录态';
        }
        if (!activeSession) {
          return undefined;
        }
        if (!currentUrlIsPlatformPage) {
          return currentUrl
            ? '当前 CDP 页面不在平台后台，尚未确认平台登录态'
            : 'CDP 会话尚未返回平台页面地址，尚未确认平台登录态';
        }
        return undefined;
      })();
      const activeProfile =
        activeSession != null || accountArtifacts.hasPersistentLoginState;
      return {
        platform: row.platform,
        accountId: engineAccountId,
        profileDir: accountArtifacts.profileDir,
        status: sessionStatus,
        visibleWindow: runtimeReady,
        currentUrl,
        lastError: sessionLastError,
        activeProfile,
        browser: activeSession?.browser || 'local-browser-engine',
        debuggingPort: activeSession?.debuggingPort,
        runtimeMode: activeSession?.runtimeMode || 'persistent-cdp-browser',
        browserReused: activeSession?.browserReused,
        startedAt: new Date().toISOString(),
      };
    });
    return {
      available: status.online,
      sessions,
      message: status.online
        ? '本地浏览器 Runtime 已就绪；账号 profile 已准备，真实登录态会在进入平台页后确认。'
        : `本地浏览器 Runtime 未就绪：${status.message || 'unknown'}`,
      checkedAt: new Date().toISOString(),
    };
  }

  private findLatestInteractionTaskForAccount(
    rows: Array<{
      accountId: string | null;
      taskType: string;
      status: string;
      config: unknown;
      updatedAt: Date;
    }>,
    platform: string,
    accountIds: Array<number | string | null | undefined>,
  ) {
    const expectedTaskTypes = this.getInteractionTaskTypesForPlatform(platform);
    if (!expectedTaskTypes.length) {
      return null;
    }
    const idSet = new Set(
      accountIds
        .map((id) => (id == null ? '' : String(id).trim()))
        .filter(Boolean),
    );
    return (
      rows.find((row) => {
        return (
          row.accountId != null &&
          idSet.has(String(row.accountId)) &&
          expectedTaskTypes.includes(String(row.taskType))
        );
      }) ?? null
    );
  }

  private getInteractionTaskTypesForPlatform(platform: string) {
    if (platform === 'douyin') {
      return ['DOUYIN_COMMENT_REPLY', 'DOUYIN_DIRECT_MESSAGE_REPLY'];
    }
    if (platform === 'wechat-channel') {
      return [
        'WECHAT_CHANNEL_COMMENT_REPLY',
        'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
      ];
    }
    return [];
  }

  private isRecentInteractionLoginBlocker(
    task: {
      status: string;
      config: unknown;
      updatedAt: Date;
    } | null,
  ) {
    if (!task) {
      return false;
    }
    if (!['FAILED', 'BLOCKED'].includes(String(task.status))) {
      return false;
    }
    const maxAgeMs = 24 * 60 * 60 * 1000;
    if (Date.now() - task.updatedAt.getTime() > maxAgeMs) {
      return false;
    }
    const config = (task.config ?? {}) as {
      failureReason?: string;
      nextAction?: string;
      currentStepMessage?: string;
      events?: Array<{ message?: string }>;
    };
    const text = [
      config.failureReason,
      config.nextAction,
      config.currentStepMessage,
      ...(Array.isArray(config.events)
        ? config.events.slice(-6).map((event) => event.message)
        : []),
    ]
      .filter(Boolean)
      .join('\n');
    if (/入口未打开|首页卡片文案|未出现视频号(?:评论|私信)业务区/.test(text)) {
      return false;
    }
    return this.containsLoginRequiredSignal(text);
  }

  private isInteractionEntryUrl(platform: string, currentUrl: string): boolean {
    if (!currentUrl) return false;
    if (platform === 'douyin') {
      return (
        currentUrl.includes('creator.douyin.com') &&
        (currentUrl.includes('/interactive/comment') ||
          currentUrl.includes('/following/chat'))
      );
    }
    if (platform === 'wechat-channel') {
      return (
        currentUrl.includes('channels.weixin.qq.com') &&
        (currentUrl.includes('/comment') ||
          currentUrl.includes('/private_msg') ||
          currentUrl.includes('/message'))
      );
    }
    return true;
  }

  private isPlatformPageUrl(platform: string, currentUrl: string): boolean {
    if (!currentUrl) return false;
    if (platform === 'douyin') {
      return currentUrl.includes('creator.douyin.com');
    }
    if (platform === 'wechat-channel') {
      return currentUrl.includes('channels.weixin.qq.com');
    }
    return this.isInteractionEntryUrl(platform, currentUrl);
  }

  private isLoginPageUrl(url?: string | null) {
    return /login|signin|passport/i.test(url || '');
  }

  private containsLoginRequiredSignal(text: string) {
    return /未登录|重新登录|登录态|登录失效|登录过期|passport|signin|login required/i.test(
      text,
    );
  }

  async previewInteractionEvidenceCleanup(
    retentionDays = 7,
  ): Promise<AutoUploadInteractionEvidenceCleanupResult> {
    return this.collectInteractionEvidenceCleanup(retentionDays, false);
  }

  async cleanupInteractionEvidence(
    retentionDays = 7,
  ): Promise<AutoUploadInteractionEvidenceCleanupResult> {
    return this.collectInteractionEvidenceCleanup(retentionDays, true);
  }

  async listAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }): Promise<AutoUploadAccount[]> {
    // 2026-06-04: 5409 已下线, 不再 fetch 老 endpoint 或读 ~/auto-upload/db/database.db.
    // 改读 Postgres publish_accounts 表 (新源), 通过 prisma. 之前 'status: 1 / 正常'
    // 全部来自 5409 老 SQLite, session 早过期, 标签是僵尸数据.
    const idFilter =
      options?.ids?.length
        ? options.ids
            .map((id) => String(id))
            .filter((id) => id.length > 0)
        : null;
    // 简化: 只用 id (cuid) 过滤. 老 int engineAccountId 过滤留到上层 (按 platform 配对).
    // 老 5409 HTTP /getValidAccounts?ids=N 走不通了, 5409 已下线.
    const rows = await this.prisma.publishAccount.findMany({
      where: idFilter ? { id: { in: idFilter } } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    // 若 ids 是 int, 还得 client-side 过滤 (publish_accounts.config.engineAccountId 匹配)
    let filtered = rows;
    if (idFilter && rows.length === 0) {
      const intIds = idFilter
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      if (intIds.length > 0) {
        const all = await this.prisma.publishAccount.findMany({
          orderBy: { createdAt: 'asc' },
        });
        filtered = all.filter((row) => {
          const cfg = (row.config ?? {}) as { engineAccountId?: number };
          return (
            idFilter.includes(row.id) ||
            (typeof cfg.engineAccountId === 'number' && intIds.includes(cfg.engineAccountId))
          );
        });
      }
    }

    const effectiveRows = options?.validate
      ? await this.validatePublishAccountRows(filtered)
      : filtered;

    return effectiveRows.map((row) => this.mapPublishAccountToAutoUploadAccount(row));
  }

  private mapPublishAccountToAutoUploadAccount(row: {
    id: string;
    platform: string;
    name: string;
    config: unknown;
  }): AutoUploadAccount {
    const cfg = (row.config ?? {}) as {
      platformType?: number;
      filePath?: string;
      userName?: string;
      profileName?: string;
      avatarPath?: string;
      avatarUpdatedAt?: string;
      status?: string;
      statusLabel?: string;
      engineAccountId?: number;
    };
    const platformType = typeof cfg.platformType === 'number'
      ? cfg.platformType
      : AutoUploadClient.PUBLISH_PLATFORM_TYPE_MAP[row.platform] ?? 0;
    const ready = (cfg.status ?? 'ready') === 'ready';
    return {
      id: typeof cfg.engineAccountId === 'number' ? cfg.engineAccountId : Number(row.id) || 0,
      type: platformType,
      platform: this.resolvePlatformName(platformType) || row.platform,
      filePath: cfg.filePath ?? '',
      userName: cfg.userName ?? row.name,
      status: ready ? 1 : 0,
      profileName: cfg.profileName ?? row.name,
      avatarPath: cfg.avatarPath ?? null,
      avatarUpdatedAt: cfg.avatarUpdatedAt ?? null,
      statusLabel: ready
        ? cfg.statusLabel === '待校验'
          ? '已登录'
          : (cfg.statusLabel ?? '已登录')
        : (cfg.statusLabel ?? '登录失效'),
    };
  }

  private resolveEngineAccountId(account: { id: string; config: unknown }) {
    const cfg = (account.config ?? {}) as { engineAccountId?: number };
    if (typeof cfg.engineAccountId === 'number') return cfg.engineAccountId;
    return Number(account.id) || account.id;
  }

  async openAccounts(ids: (number | string)[]): Promise<AutoUploadOpenAccountsResult> {
    const openedIds: Array<number | string> = [];
    const skipped: Array<{ id: number | string; reason: string }> = [];
    for (const id of ids) {
      const account = await this.findPublishAccountByAnyId(id);
      if (!account) {
        skipped.push({ id, reason: '账号不存在' });
        continue;
      }
      const cfg = (account.config ?? {}) as { profileName?: string };
      const url = this.platformProfileUrl(account.platform, cfg.profileName);
      if (!url || url === 'about:blank') {
        skipped.push({ id, reason: `未知平台 ${account.platform}` });
        continue;
      }
      try {
        const engineAccountId = this.resolveEngineAccountId(account);
        if (!this.localBrowser) {
          throw new Error('LocalBrowserEngine 未注入，无法打开 CDP 持久浏览器');
        }
        const platform = this.resolvePlatformSlugFromString(account.platform);
        const session = await this.localBrowser.getOrCreateSession({
          platform,
          accountId: engineAccountId,
        });
        await session.page.goto(url, { waitUntil: 'commit', timeout: 30000 });
        await session.page.bringToFront().catch(() => undefined);
        this.monitorAccountLoginState({
          rowId: account.id,
          platform,
          platformType: this.resolvePlatformTypeFromSlug(platform),
          accountId: engineAccountId,
          storageFileName: ((account.config ?? {}) as { filePath?: string }).filePath,
          context: session.context,
          page: session.page,
          profileDir: session.profileDir,
        }).catch((error) =>
          this.logger.warn(
            `账号登录状态监听失败 ${account.platform}-${engineAccountId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
        openedIds.push(id);
      } catch (error) {
        skipped.push({
          id,
          reason: error instanceof Error ? error.message : '打开平台后台失败',
        });
      }
    }
    return { opened: openedIds.length, openedIds, skipped };
  }

  async openInteractionEntry(input: {
    accountId: number | string;
    entryType: string;
  }): Promise<AutoUploadInteractionEntryResult> {
    const entry = this.resolveInteractionEntry(input.entryType);
    const account = await this.findPublishAccountByAnyId(input.accountId);
    if (!account) {
      throw new ServiceUnavailableException('平台账号不存在，请先刷新账号列表');
    }
    if (account.platform !== 'douyin' && account.platform !== 'wechat-channel') {
      throw new ServiceUnavailableException(
        `${account.platform} 暂不支持客户互动入口`,
      );
    }
    if (account.platform !== entry.platform) {
      throw new ServiceUnavailableException(
        `账号平台 ${account.platform} 与入口 ${entry.platformName} 不匹配`,
      );
    }

    try {
      const cfg = (account.config ?? {}) as { filePath?: string };
      const cookiePath = cfg.filePath
        ? this.resolveAccountCookiePath(cfg.filePath)
        : null;
      const opened = await this.interactionExecutor.openAccount({
        platform: account.platform,
        accountId: this.resolveEngineAccountId(account),
        url: entry.url,
        storagePath: cookiePath,
      });
      const session = this.localBrowser?.getSession(opened.sessionKey);
      const pageProbe = session
        ? await this.probeInteractionEntryPage(session.page)
        : {
            url: opened.currentUrl || entry.url,
            title: null,
            loggedIn: null,
            pageTextSample: null,
          };
      const evidence = session
        ? await this.captureInteractionEntryEvidence(opened.sessionKey, input.entryType)
        : null;
      return {
        accountId: Number(input.accountId) || 0,
        accountName: account.name ?? '',
        platformType: entry.platformType,
        platformName: entry.platformName,
        entryType: input.entryType,
        entryName: entry.entryName,
        url: pageProbe.url || opened.currentUrl || entry.url,
        title: pageProbe.title,
        loggedIn: pageProbe.loggedIn,
        pageTextSample: pageProbe.pageTextSample,
        evidence,
        runtimeMode: opened.runtimeMode,
        profileDir: opened.profileDir,
        cdpPort: opened.cdpPort ?? null,
        browser: opened.browser ?? null,
        browserReused: opened.browserReused ?? null,
        status: 'opened',
        accountStatus: 1,
        openedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地互动入口打开失败：${message}`);
    }
  }

  async readDouyinComments(input: {
    accountId: number | string;
    limit?: number;
    parsingRules?: unknown;
  }): Promise<AutoUploadDouyinCommentsReadResult> {
    return this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'douyin',
      taskType: 'comment-reply',
      platformName: '抖音',
      platformType: 3,
      limit: input.limit || 50,
      parsingRules: input.parsingRules,
    }) as Promise<AutoUploadDouyinCommentsReadResult>;
  }

  async readDouyinMessages(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<AutoUploadDouyinMessagesReadResult> {
    return (this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'douyin',
      taskType: 'direct-message-reply',
      platformName: '抖音',
      platformType: 3,
      limit: input.limit || 50,
    }) as unknown) as Promise<AutoUploadDouyinMessagesReadResult>;
  }

  async readWechatChannelComments(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<AutoUploadWechatChannelCommentsReadResult> {
    return this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'wechat-channel',
      taskType: 'comment-reply',
      platformName: '视频号',
      platformType: 2,
      limit: input.limit || 50,
    }) as Promise<AutoUploadWechatChannelCommentsReadResult>;
  }

  async readWechatChannelMessages(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<AutoUploadWechatChannelMessagesReadResult> {
    return (this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'wechat-channel',
      taskType: 'direct-message-reply',
      platformName: '视频号',
      platformType: 2,
      limit: input.limit || 50,
    }) as unknown) as Promise<AutoUploadWechatChannelMessagesReadResult>;
  }

  private async readLivePlatformInteractions(input: {
    accountId: number | string;
    platform: 'douyin' | 'wechat-channel';
    taskType: 'comment-reply' | 'direct-message-reply';
    platformName: string;
    platformType: number;
    limit: number;
    parsingRules?: unknown;
  }): Promise<AutoUploadDouyinCommentsReadResult> {
    try {
      const [account, result] = await Promise.all([
        this.findPublishAccountByAnyId(input.accountId).catch(() => null),
        this.interactionExecutor.read({
          accountId: input.accountId,
          platform: input.platform,
          taskType: input.taskType,
          limit: input.limit,
          parsingRules: input.parsingRules,
        }),
      ]);
      return {
        accountId: Number(result.accountId ?? input.accountId) || 0,
        accountName:
          typeof result.accountName === 'string'
            ? result.accountName
            : account?.name ?? '',
        platformType: Number(result.platformType ?? input.platformType),
        platformName:
          typeof result.platformName === 'string'
            ? result.platformName
            : input.platformName,
        url: String(result.url ?? ''),
        title: String(result.title ?? ''),
        comments: Array.isArray(result.comments)
          ? result.comments
          : [],
        messages: Array.isArray(result.messages)
          ? result.messages
          : [],
        summary: result.summary,
        pageTextSample:
          typeof result.pageTextSample === 'string'
            ? result.pageTextSample
            : undefined,
        evidence: result.evidence ?? null,
        readAt:
          typeof result.readAt === 'string'
            ? result.readAt
            : new Date().toISOString(),
        runtimeMode:
          typeof result.runtimeMode === 'string'
            ? result.runtimeMode
            : 'persistent-cdp-browser',
        profileDir:
          typeof result.profileDir === 'string' ? result.profileDir : null,
        cdpPort:
          typeof result.cdpPort === 'number' ? result.cdpPort : null,
        browser:
          typeof result.browser === 'string' ? result.browser : null,
        browserReused:
          typeof result.browserReused === 'boolean'
            ? result.browserReused
            : null,
        currentUrl:
          typeof result.currentUrl === 'string' ? result.currentUrl : null,
      } as AutoUploadDouyinCommentsReadResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ServiceUnavailableException(
        `${input.platformName}真实读取失败：${message}`,
      );
    }
  }

  /**
   * 通用读 interaction_tasks 方法 (替换 4 个 5409 read* 端点).
   * 5409 时代是实时 navigate + 解析, 慢且脆. 新版直接读 PG 表里已 dispatch 的真数据.
   * 数据来源: orchestrator 每次 dispatch 写一条 task + runtime_execution.
   */
  private async readPlatformInteractions(input: {
    accountId: number | string;
    platform: 'douyin' | 'wechat-channel';
    taskType: string;
    platformName: string;
    platformType: number;
    limit: number;
  }): Promise<AutoUploadDouyinCommentsReadResult> {
    const account = await this.findPublishAccountByAnyId(input.accountId);
    const accountIds = Array.from(
      new Set(
        [String(input.accountId), account?.id]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const rows = await this.prisma.interactionTask.findMany({
      where: {
        accountId: { in: accountIds },
        taskType: input.taskType as never,
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(200, Math.floor(input.limit))),
    });
    const completed = rows.filter((r) => r.status === 'COMPLETED').length;
    const isMessage = input.taskType.includes('DIRECT_MESSAGE');
    const entry = this.resolveInteractionEntry(
      `${input.platform}:${isMessage ? 'message' : 'comment'}`,
    );
    const pageTextSample = rows
      .slice(0, 5)
      .map((row) => [row.currentTarget, row.draftText].filter(Boolean).join('：'))
      .filter(Boolean)
      .join('\n')
      .slice(0, 1200);
    return {
      accountId: Number(input.accountId) || 0,
      accountName: account?.name ?? rows[0]?.currentTarget ?? '',
      platformType: input.platformType,
      platformName: input.platformName,
      url: entry.url,
      title: `${input.platformName}${isMessage ? '私信' : '评论'}记录`,
      comments: rows.map((row) => ({
        text: row.draftText || '',
        looksLikeComment: Boolean(row.draftText),
        taskId: row.id,
        status: row.status,
        target: row.currentTarget || '',
        updatedAt: row.updatedAt.toISOString(),
      })),
      messages: rows.map((row) => ({
        text: row.draftText || '',
        target: row.currentTarget || '',
        taskId: row.id,
        status: row.status,
        updatedAt: row.updatedAt.toISOString(),
      })),
      pageTextSample,
      evidence: rows[0]
        ? {
            type: 'text',
            label: 'interaction_tasks',
            value: `task=${rows[0].id}; status=${rows[0].status}`,
          }
        : null,
      readAt: new Date().toISOString(),
      summary: {
        totalCandidates: rows.length,
        usableCount: completed,
        emptyReason: rows.length === 0 ? '该账号暂无 dispatch 记录' : null,
        nextAction:
          rows.length === 0
            ? '先启动对应客户互动任务，系统会把真实读取/发送记录写入 interaction_tasks。'
            : null,
      },
      runtimeMode: 'postgres-interaction-tasks',
    } as unknown as AutoUploadDouyinCommentsReadResult;
  }

  async getWechatDesktopStatus(): Promise<AutoUploadWechatDesktopStatus> {
    return {
      platform: 'wechat',
      available: false,
      running: false,
      windowCount: 0,
      screenshotAvailable: false,
      inputControlAvailable: false,
      clickControlAvailable: false,
      fileSelectionAvailable: false,
      requiresManualTarget: true,
      permissionHints: [
        '微信桌面能力尚未接入 Agent-S / local-controller 桌面执行通道',
        '接入前不会尝试读取、输入或点击微信窗口',
      ],
      safetyBoundary: {
        draftOnly: true,
        readsPrivateChats: false,
        readsContacts: false,
        sendsMessages: false,
        targeting: 'Agent-S/local-controller',
        manualSteps: ['先接入 Agent-S 微信桌面工具，再开放微信桌面操作'],
      },
      message: '微信桌面能力尚未接入 Agent-S 桌面通道，当前不会执行微信窗口操作。',
      checkedAt: new Date().toISOString(),
    };
  }

  async listWechatWindows(): Promise<{
    windows: Array<{ id: string; title: string; isMain: boolean }>;
  }> {
    return { windows: [] };
  }

  async resolveWechatContact(query: string): Promise<{
    matches: Array<{ name: string; remark: string; id: string }>;
    ambiguous: boolean;
  }> {
    return { matches: query.trim() ? [] : [], ambiguous: false };
  }

  async dismissWechatPopup(): Promise<{
    dismissed: boolean;
    popupType?: string;
  }> {
    return { dismissed: false, popupType: 'agent-s-required' };
  }

  async checkWechatAlive(): Promise<{ alive: boolean; reason?: string }> {
    return {
      alive: false,
      reason: '微信桌面能力尚未接入 Agent-S/local-controller，暂不能安全操作微信窗口。',
    };
  }

  async draftWechatReply(input: {
    targetText?: string;
    replyText: string;
  }): Promise<AutoUploadWechatDraftResult> {
    return {
      status: 'desktop_permission_missing',
      message: '微信草稿能力尚未接入 Agent-S/local-controller，暂不能创建桌面微信草稿。',
      targetText: input.targetText,
      replyText: input.replyText,
      confirmsDraftOnly: true,
      requiresManualSend: true,
      draftedAt: new Date().toISOString(),
    };
  }

  async sendWechatReply(input: {
    targetText?: string;
    replyText: string;
  }): Promise<AutoUploadWechatSendResult> {
    const target = input.targetText?.trim();
    if (!target) {
      throw new ServiceUnavailableException('微信自动发送失败：缺少目标联系人');
    }
    try {
      const draft = await this.executeWechatDesktopScript(
        'prepare-ops-workbench-wechat-draft-live.mjs',
        ['--target', target, '--draft', input.replyText],
        120000,
      );
      if (draft.ok !== true || draft.draftInserted !== true) {
        return {
          status:
            draft.stage === 'contact_not_ready'
              ? 'desktop_permission_missing'
              : 'send_failed',
          sent: false,
          message: String(
            draft.note || draft.message || '微信草稿写入失败，未执行发送。',
          ),
          targetText: target,
          replyText: input.replyText,
          evidence:
            typeof draft.screenshotPath === 'string' && draft.screenshotPath
              ? {
                  type: 'screenshot',
                  label: '微信草稿失败截图',
                  value: draft.screenshotPath,
                  path: draft.screenshotPath,
                }
              : {
                  type: 'text',
                  label: '微信草稿失败',
                  value: JSON.stringify(draft),
                },
          desktop: undefined,
          draftedAt: new Date().toISOString(),
        };
      }

      const sent = await this.executeWechatDesktopScript(
        'send-ops-workbench-wechat-live.mjs',
        ['--target', target, '--expected', input.replyText],
        120000,
      );
      const ok = sent.sent === true && sent.stage === 'sent';
      return {
        status: ok
          ? 'sent'
          : sent.stage === 'draft_not_ready'
            ? 'draft_not_ready'
            : 'send_failed',
        sent: ok,
        message: String(
          sent.note ||
            (ok
              ? '微信回复已由系统自动发出，并确认输入框已清空。'
              : '微信自动发送失败。'),
        ),
        targetText: target,
        replyText: input.replyText,
        evidence:
          typeof sent.screenshotPath === 'string' && sent.screenshotPath
            ? {
                type: 'screenshot',
                label: ok ? '微信发送截图' : '微信发送失败截图',
                value: sent.screenshotPath,
                path: sent.screenshotPath,
              }
            : {
                type: 'text',
                label: ok ? '微信发送结果' : '微信发送失败',
                value: JSON.stringify(sent),
              },
        readbackText:
          typeof sent.readbackText === 'string' ? sent.readbackText : undefined,
        draftedAt: new Date().toISOString(),
        sentAt: ok ? new Date().toISOString() : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信自动发送失败：${message}`);
    }
  }

  async refreshAccountAvatar(
    id: number,
  ): Promise<AutoUploadRefreshAccountAvatarResult> {
    // 2026-06-04: 5409 /refreshAccountAvatar 已下线. 改用 playwright-mcp navigate +
    // browser_take_screenshot, 保存到 backend/data/avatars/.
    try {
      const account = await this.prisma.publishAccount.findFirst({
        where: {
          OR: [
            { id: String(id) },
            { config: this.publishAccountConfigEquals('engineAccountId', Number(id)) },
          ],
        },
      });
      if (!account) {
        return {
          ok: false,
          id,
          avatarPath: null,
          avatarUrl: null,
          error: '账号不存在',
        };
      }
      const cfg = (account.config ?? {}) as Record<string, unknown> & {
        profileName?: string;
        platformType?: number;
      };
      const platform = account.platform as
        | 'douyin' | 'wechat-channel' | 'xiaohongshu' | 'kuaishou' | 'bilibili' | string;
      const profileUrl = this.platformProfileUrl(platform, cfg.profileName);
      // 1. navigate
      await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        method: 'tools/call',
        params: { name: 'browser_navigate', arguments: { url: profileUrl } },
      });
      // 2. screenshot
      const dataDir = this.getLocalAvatarDir();
      mkdirSync(dataDir, { recursive: true });
      const filename = `account_${id}_${Date.now()}.png`;
      const filepath = join(dataDir, filename);
      await this.mcp.rpcCall({
        jsonrpc: '2.0',
        id: this.nextRpcId(),
        method: 'tools/call',
        params: {
          name: 'browser_take_screenshot',
          arguments: { filename: filepath, fullPage: false, type: 'png' },
        },
      });
      if (!existsSync(filepath)) {
        throw new Error('截图文件未生成');
      }
      const avatarPath = `/api/auto-upload/avatars/${filename}`;
      await this.prisma.publishAccount.update({
        where: { id: account.id },
        data: {
          config: {
            ...cfg,
            avatarPath,
            avatarUpdatedAt: new Date().toISOString(),
          },
        },
      });
      return {
        ok: true,
        id,
        avatarPath,
        avatarUrl: avatarPath,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`refreshAccountAvatar 失败: ${message}`);
      return { ok: false, id, avatarPath: null, avatarUrl: null, error: message };
    }
  }

  private platformProfileUrl(platform: string, profileName?: string): string {
    const urls: Record<string, string> = {
      douyin: 'https://creator.douyin.com/creator-micro/content/manage',
      'wechat-channel': 'https://channels.weixin.qq.com/platform/post/list',
      xiaohongshu: 'https://creator.xiaohongshu.com/new/note-manager',
      kuaishou: 'https://cp.kuaishou.com/article/publish/video',
      bilibili: 'https://member.bilibili.com/platform/upload-manager/article',
    };
    return urls[platform] || 'about:blank';
  }

  private async validatePublishAccountRows<
    T extends { id: string; platform: string; name: string; config: unknown },
  >(rows: T[]): Promise<T[]> {
    const updated: T[] = [];
    for (const row of rows) {
      const config = (row.config ?? {}) as Record<string, unknown> & {
      filePath?: string;
      platformType?: number;
      engineAccountId?: number | string;
    };
      const platformType =
        typeof config.platformType === 'number'
          ? config.platformType
          : AutoUploadClient.PUBLISH_PLATFORM_TYPE_MAP[row.platform] ?? 0;
      const fileName = typeof config.filePath === 'string' ? config.filePath : '';
      const cookiePath = fileName ? this.resolveAccountCookiePath(fileName) : null;
      let valid = false;
      let transient = false;
      if (cookiePath && existsSync(cookiePath)) {
        try {
          valid = await this.validateCookieFile(platformType, cookiePath);
        } catch (error) {
          transient = true;
          this.logger.warn(
            `账号 cookie 校验临时失败 ${row.platform}-${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      const engineAccountId =
        config.engineAccountId == null ? row.id : String(config.engineAccountId);
      const artifacts = this.getAccountLoginArtifacts(
        row.platform,
        String(engineAccountId),
        fileName,
      );
      const hasPersistentLoginState = artifacts.hasPersistentLoginState;
      if (transient) {
        updated.push(row);
        continue;
      }
      if (!valid && hasPersistentLoginState) {
        const nextConfig = {
          ...config,
          status: 'ready',
          statusLabel: '已登录',
          checkedAt: new Date().toISOString(),
        };
        if (config.status !== nextConfig.status || config.statusLabel !== nextConfig.statusLabel) {
          await this.prisma.publishAccount.update({
            where: { id: row.id },
            data: { config: nextConfig },
          });
        }
        updated.push({
          ...row,
          config: nextConfig,
        });
        continue;
      }
      const nextConfig = {
        ...config,
        status: valid ? 'ready' : 'expired',
        statusLabel: valid ? '已登录' : '登录失效',
        checkedAt: new Date().toISOString(),
      };
      if (config.status !== nextConfig.status || config.statusLabel !== nextConfig.statusLabel) {
        await this.prisma.publishAccount.update({
          where: { id: row.id },
          data: { config: nextConfig },
        });
      }
      updated.push({ ...row, config: nextConfig });
    }
    return updated;
  }

  private resolvePlatformSlugFromString(platform: string): LocalBrowserEngine extends never ? never : Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform'] {
    const normalized = String(platform || '').trim();
    const byName: Record<string, Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform']> = {
      douyin: 'douyin',
      抖音: 'douyin',
      'wechat-channel': 'wechat-channel',
      视频号: 'wechat-channel',
      xiaohongshu: 'xiaohongshu',
      小红书: 'xiaohongshu',
      kuaishou: 'kuaishou',
      快手: 'kuaishou',
      bilibili: 'bilibili',
      B站: 'bilibili',
    };
    const platformSlug = byName[normalized];
    if (!platformSlug) {
      throw new Error(`未知平台 ${platform}`);
    }
    return platformSlug;
  }

  private resolveBrowserPlatformSlug(type: number): Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform'] | null {
    const map: Record<number, Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform']> = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
    };
    return map[type] ?? null;
  }

  private resolvePlatformTypeFromSlug(platform: string): number {
    return AutoUploadClient.PUBLISH_PLATFORM_TYPE_MAP[platform] ?? 0;
  }

  private async resolveLoginEngineAccountId(input: {
    type: number;
    profileName: string;
    update?: boolean;
    recordId?: number;
  }): Promise<number> {
    if (input.update && input.recordId) return input.recordId;
    const platform = this.resolveBrowserPlatformSlug(input.type);
    const rows = await this.prisma.publishAccount.findMany({
      where: platform ? { platform } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    const used = rows
      .map((row) => {
        const config = (row.config ?? {}) as { engineAccountId?: unknown };
        return Number(config.engineAccountId);
      })
      .filter((value) => Number.isInteger(value) && value > 0);
    return used.length ? Math.max(...used) + 1 : 1;
  }

  private async prepareLoginPage(page: Page, platformType: number): Promise<void> {
    const url = this.platformLoginStartUrl(platformType);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (platformType === 4) {
      await page.getByRole('link', { name: '立即登录' }).click({ timeout: 10000 }).catch(() => undefined);
      await page.getByText('扫码登录').click({ timeout: 10000 }).catch(() => undefined);
    }
    if (platformType === 1) {
      await page.locator('img.css-wemwzq').click({ timeout: 10000 }).catch(() => undefined);
    }
    await page.waitForTimeout(1000).catch(() => undefined);
  }

  private platformLoginStartUrl(type: number): string {
    const urls: Record<number, string> = {
      1: 'https://creator.xiaohongshu.com/',
      2: 'https://channels.weixin.qq.com',
      3: 'https://creator.douyin.com/',
      4: 'https://cp.kuaishou.com',
      5: 'https://member.bilibili.com/platform/upload/video/frame',
    };
    return urls[type] || 'about:blank';
  }

  private async extractLoginQrData(page: Page, platformType: number): Promise<string | null> {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const src = await this.findQrImageSrc(page, platformType).catch(() => null);
      if (src) return src;
      await page.waitForTimeout(500).catch(() => undefined);
    }
    return null;
  }

  private async findQrImageSrc(page: Page, platformType: number): Promise<string | null> {
    const candidates = await page.evaluate((type) => {
      const attrs = (node: Element) => ({
        src: node.getAttribute('src') || '',
        alt: node.getAttribute('alt') || '',
        aria: node.getAttribute('aria-label') || '',
        cls: node.getAttribute('class') || '',
      });
      const images = Array.from(document.querySelectorAll('img')).map(attrs);
      return images
        .filter((item) => item.src)
        .map((item) => ({
          ...item,
          score:
            (/qr|qrcode|二维码|login/i.test(`${item.src} ${item.alt} ${item.aria} ${item.cls}`) ? 100 : 0) +
            (String(type) === '2' && /weixin|qrcode|login/i.test(item.src) ? 30 : 0),
        }))
        .sort((a, b) => b.score - a.score);
    }, platformType);
    const best = candidates[0];
    if (!best?.src) return null;
    if (best.src.startsWith('data:image')) return best.src;
    if (best.src.startsWith('//')) return `https:${best.src}`;
    if (best.src.startsWith('/')) {
      return new URL(best.src, page.url()).toString();
    }
    return best.src;
  }

  private async waitForLoginSuccess(
    page: Page,
    platformType: number,
    requestId: string,
  ): Promise<'logged_in' | 'cancelled' | 'timeout'> {
    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      if (this.cancelledLoginRequestIds.has(requestId)) {
        this.cancelledLoginRequestIds.delete(requestId);
        return 'cancelled';
      }
      if (await this.pageLooksLoggedIn(platformType, page)) {
        return 'logged_in';
      }
      await page.waitForTimeout(500).catch(() => undefined);
    }
    return 'timeout';
  }

  private async pageLooksLoggedIn(platformType: number, page: Page): Promise<boolean> {
    const url = page.url() || '';
    const text = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (platformType === 3) {
      if (!url.includes('creator.douyin.com')) return false;
      return !/扫码登录|验证码登录|密码登录|登录\/注册|打开「抖音APP」点击左上角/.test(text);
    }
    if (platformType === 2) {
      if (!url.includes('channels.weixin.qq.com') || url.includes('login')) return false;
      return !(/扫码登录|微信扫一扫/.test(text) && !/互动管理|内容管理/.test(text));
    }
    if (platformType === 4) {
      if (!url.includes('kuaishou.com') || url.includes('login')) return false;
      return !/立即登录|扫码登录|快手扫码登录|请扫码登录/.test(text);
    }
    if (platformType === 1) {
      if (!url.includes('xiaohongshu.com')) return false;
      return !/手机号登录|扫码登录/.test(text);
    }
    if (platformType === 5) {
      if (url.includes('passport.bilibili.com')) return false;
      return url.includes('bilibili.com') && !/立即登录|扫码登录|密码登录/.test(text);
    }
    return false;
  }

  private async validateCookieFile(platformType: number, cookiePath: string): Promise<boolean> {
    const platform = this.resolveBrowserPlatformSlug(platformType);
    if (!platform) return false;
    const browserRuntime = this.browserRuntime.resolve();
    if (!browserRuntime.exists) {
      throw new ServiceUnavailableException(browserRuntime.message);
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath: browserRuntime.executablePath,
    });
    const context = await browser.newContext({
      storageState: cookiePath,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();
    try {
      await page.goto(this.platformValidationUrl(platformType), {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);
      return await this.pageLooksLoggedIn(platformType, page);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private platformValidationUrl(type: number): string {
    const urls: Record<number, string> = {
      1: 'https://creator.xiaohongshu.com/creator-micro/content/upload',
      2: 'https://channels.weixin.qq.com/platform/post/create',
      3: 'https://creator.douyin.com/creator-micro/content/upload',
      4: 'https://cp.kuaishou.com/article/publish/video',
      5: 'https://member.bilibili.com/platform/upload/video/frame',
    };
    return urls[type] || 'about:blank';
  }

  private async saveFilteredStorageState(
    context: BrowserContext,
    platform: string,
    storagePath: string,
    profileDir?: string,
  ): Promise<void> {
    const state = await this.getStorageStateWithIndexedDb(context);
    const filtered = this.filterStorageStateForPlatform(state, platform);
    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, JSON.stringify(filtered, null, 2), 'utf8');
    if (profileDir) {
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, '.login-cookies.json'), JSON.stringify(filtered), 'utf8');
    }
  }

  private async getStorageStateWithIndexedDb(
    context: BrowserContext,
  ): Promise<{ cookies?: unknown[]; origins?: unknown[] }> {
    try {
      return await (
        context.storageState as (options?: {
          indexedDB?: boolean;
        }) => Promise<{ cookies?: unknown[]; origins?: unknown[] }>
      )({ indexedDB: true });
    } catch {
      return await context.storageState();
    }
  }

  private filterStorageStateForPlatform(
    state: { cookies?: unknown[]; origins?: unknown[] },
    platform: string,
  ): { cookies: unknown[]; origins: unknown[] } {
    const domains = this.resolvePlatformDomains(platform);
    const cookies = Array.isArray(state.cookies)
      ? state.cookies.filter((cookie) => {
          const domain = String((cookie as { domain?: unknown })?.domain || '');
          return this.domainMatches(domain, domains);
        })
      : [];
    const origins = Array.isArray(state.origins)
      ? state.origins.filter((originState) => {
          const origin = String((originState as { origin?: unknown })?.origin || '');
          return this.originMatches(origin, domains);
        })
      : [];
    return { cookies, origins };
  }

  private resolvePlatformDomains(platform: string): string[] {
    const domains: Record<string, string[]> = {
      xiaohongshu: ['xiaohongshu.com'],
      'wechat-channel': ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'],
      douyin: ['douyin.com', 'bytedance.com', 'iesdouyin.com'],
      kuaishou: ['kuaishou.com'],
      bilibili: ['bilibili.com'],
    };
    return domains[platform] ?? [];
  }

  private domainMatches(value: string, domains: string[]): boolean {
    const normalized = value.toLowerCase().replace(/^\./, '');
    return domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
  }

  private originMatches(origin: string, domains: string[]): boolean {
    try {
      const host = new URL(origin).hostname;
      return this.domainMatches(host, domains);
    } catch {
      return this.domainMatches(origin, domains);
    }
  }

  private getAccountCookiePath(filename: string): string {
    return join(this.getLocalCookieDir(), this.safeLocalFilename(filename));
  }

  private resolveAccountCookiePath(filename: string): string | null {
    const safe = this.safeLocalFilename(filename);
    const candidates = [
      join(this.getLocalCookieDir(), safe),
      join(homedir(), 'auto-upload', 'cookiesFile', safe),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? null;
  }

  private getAccountLoginArtifacts(
    platform: string,
    accountId: string,
    cookieFileName?: string,
  ): {
    cookiePath: string | null;
    profileDir: string;
    profileCookiesPath: string;
    legacyProfileMarkerPath: string;
    hasPersistentLoginState: boolean;
  } {
    const cookiePath = cookieFileName
      ? this.resolveAccountCookiePath(cookieFileName)
      : null;
    const profileDir = this.getLocalBrowserProfileDir(platform, accountId);
    const profileCookiesPath = join(profileDir, '.login-cookies.json');
    const legacyProfileMarkerPath = join(profileDir, '.legacy-profile-imported.json');
    const cookieStateReady =
      Boolean(cookiePath && existsSync(cookiePath)) &&
      this.storageStateFileHasPlatformData(cookiePath as string, platform);
    const profileCookieReady =
      existsSync(profileCookiesPath) &&
      this.storageStateFileHasPlatformData(profileCookiesPath, platform);
    const legacyProfileReady =
      existsSync(legacyProfileMarkerPath) &&
      existsSync(join(profileDir, 'Local State')) &&
      existsSync(join(profileDir, 'Default', 'Preferences'));
    return {
      cookiePath,
      profileDir,
      profileCookiesPath,
      legacyProfileMarkerPath,
      hasPersistentLoginState:
        cookieStateReady || profileCookieReady || legacyProfileReady,
    };
  }

  private storageStateFileHasPlatformData(filepath: string, platform: string): boolean {
    try {
      const state = JSON.parse(readFileSync(filepath, 'utf8')) as {
        cookies?: unknown[];
        origins?: unknown[];
      };
      const filtered = this.filterStorageStateForPlatform(state, platform);
      return Boolean(filtered.cookies.length || filtered.origins.length);
    } catch {
      return false;
    }
  }

  private async captureAccountIdentityBestEffort(
    page: Page,
    engineAccountId: number | string,
  ): Promise<{ avatarPath?: string | null; userName?: string | null }> {
    try {
      const dataDir = this.getLocalAvatarDir();
      mkdirSync(dataDir, { recursive: true });
      const filename = `account_${engineAccountId}.png`;
      await page.screenshot({ path: join(dataDir, filename), fullPage: false });
      const title = await page.title().catch(() => '');
      return { avatarPath: filename, userName: title || null };
    } catch {
      return {};
    }
  }

  private async saveLoginPublishAccount(input: {
    platform: string;
    platformType: number;
    engineAccountId: number;
    profileName: string;
    filePath: string;
    update?: boolean;
    recordId?: number;
    identity?: { avatarPath?: string | null; userName?: string | null };
  }): Promise<string> {
    const id = `local-engine-${input.update && input.recordId ? input.recordId : input.engineAccountId}`;
    const config = {
      source: 'local-engine',
      status: 'ready',
      statusLabel: '已登录',
      filePath: input.filePath,
      userName: input.identity?.userName || input.profileName,
      profileName: input.profileName,
      platformType: input.platformType,
      engineAccountId: input.update && input.recordId ? input.recordId : input.engineAccountId,
      avatarPath: input.identity?.avatarPath || null,
      avatarUpdatedAt: input.identity?.avatarPath ? new Date().toISOString() : null,
      syncedAt: new Date().toISOString(),
    };
    const saved = await this.prisma.publishAccount.upsert({
      where: { id },
      create: {
        id,
        platform: input.platform,
        name: config.userName,
        config,
      },
      update: {
        platform: input.platform,
        name: config.userName,
        config,
      },
    });
    return saved.id;
  }

  private async monitorAccountLoginState(input: {
    rowId: string;
    platform: string;
    platformType: number;
    accountId: number | string;
    storageFileName?: string;
    context: BrowserContext;
    page: Page;
    profileDir?: string;
  }): Promise<void> {
    if (!input.storageFileName) return;
    const storagePath = this.getAccountCookiePath(input.storageFileName);
    for (let i = 0; i < 300; i += 1) {
      if (input.page.isClosed()) return;
      if (await this.pageLooksLoggedIn(input.platformType, input.page)) {
        await input.page.waitForTimeout(1800).catch(() => undefined);
        if (!(await this.pageLooksLoggedIn(input.platformType, input.page))) return;
        await this.saveFilteredStorageState(
          input.context,
          input.platform,
          storagePath,
          input.profileDir,
        );
        await this.prisma.publishAccount.update({
          where: { id: input.rowId },
          data: {
            config: {
              ...((await this.prisma.publishAccount.findUnique({ where: { id: input.rowId } }))?.config as object || {}),
              status: 'ready',
              statusLabel: '已登录',
              checkedAt: new Date().toISOString(),
            },
          },
        });
        return;
      }
      await input.page.waitForTimeout(1000).catch(() => undefined);
    }
  }

  private getLocalBrowserProfileDir(platform: string, profileName?: string) {
    const root =
      this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
      join(process.cwd(), 'data', 'browser-profiles');
    const safePlatform = this.safeLocalFilename(platform || 'platform');
    const safeProfile = this.safeLocalFilename(profileName || 'default');
    return join(root, `${safePlatform}-${safeProfile}`);
  }

  private resolveInteractionEntry(entryType: string): {
    platform: 'douyin' | 'wechat-channel';
    platformType: number;
    platformName: string;
    entryName: string;
    url: string;
  } {
    const normalized = entryType.toLowerCase();
    const isWechat =
      normalized.includes('wechat') ||
      normalized.includes('channel') ||
      normalized.includes('视频号');
    const isMessage =
      normalized.includes('message') ||
      normalized.includes('direct') ||
      normalized.includes('私信');
    if (isWechat) {
      return {
        platform: 'wechat-channel',
        platformType: 2,
        platformName: '视频号',
        entryName: isMessage ? '视频号私信' : '视频号评论',
        url: 'https://channels.weixin.qq.com/platform',
      };
    }
    return {
      platform: 'douyin',
      platformType: 3,
      platformName: '抖音',
      entryName: isMessage ? '抖音私信' : '抖音评论',
      url: isMessage
        ? 'https://creator.douyin.com/creator-micro/data/following/chat'
        : 'https://creator.douyin.com/creator-micro/content/manage',
    };
  }

  private async probeInteractionEntryPage(page: Page): Promise<{
    url: string;
    title: string | null;
    loggedIn: boolean | null;
    pageTextSample: string | null;
  }> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1200).catch(() => undefined);
      return await page.evaluate(() => {
        const normalize = (value: unknown) =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
            .trim();
        const text = normalize(document.body ? document.body.innerText : '');
        const loginHints = ['登录', '扫码登录', '手机登录', '密码登录'];
        const hasLoginHint = loginHints.some((item) => text.includes(item));
        const hasBusinessHint =
          text.includes('创作者服务中心') ||
          text.includes('视频号助手') ||
          text.includes('互动管理') ||
          text.includes('内容管理') ||
          text.includes('私信') ||
          text.includes('评论');
        const loggedOut =
          (hasLoginHint && !hasBusinessHint) || location.href.includes('login');
        return {
          url: location.href,
          title: document.title || null,
          loggedIn: !loggedOut,
          pageTextSample: text.slice(0, 600),
        };
      });
    } catch {
      return {
        url: page.url(),
        title: null,
        loggedIn: null,
        pageTextSample: null,
      };
    }
  }

  private async captureInteractionEntryEvidence(
    sessionKey: string,
    entryType: string,
  ): Promise<AutoUploadInteractionEvidence | null> {
    if (!this.localBrowser) return null;
    try {
      const safeEntryType = this.safeLocalFilename(entryType || 'entry');
      const result = await this.localBrowser.captureEvidence({
        sessionKey,
        label: `${safeEntryType}-entry`,
      });
      return {
        type: 'screenshot',
        label: '入口页面截图',
        value: result.path,
        path: result.path,
      };
    } catch {
      return null;
    }
  }

  private async findPublishAccountByAnyId(accountId: number | string) {
    const id = String(accountId);
    const intId = Number(accountId);
    return this.prisma.publishAccount.findFirst({
      where: {
        OR: [
          { id },
          ...(Number.isFinite(intId)
            ? [{ config: this.publishAccountConfigEquals('engineAccountId', intId) }]
            : []),
        ],
      },
    });
  }

  private publishAccountConfigEquals(key: string, value: number | string | boolean) {
    const path = process.env.KAYPAL_DESKTOP_DATABASE_MODE === 'sqlite' ? `$.${key}` : [key];
    return { path, equals: value };
  }

  private nextRpcId() {
    return Math.floor(Math.random() * 1e9) + 1;
  }

  private getLocalCookieDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_COOKIES_DIR') ||
      join(process.cwd(), 'data', 'cookiesFile');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getLocalAvatarDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
      join(process.cwd(), 'data', 'avatars');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getLocalMaterialDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
      join(process.cwd(), 'data', 'materials');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getLocalMaterialIndexPath() {
    return join(this.getLocalMaterialDir(), 'index.json');
  }

  private readLocalMaterialIndex(): LocalUploadMaterialIndex {
    const indexPath = this.getLocalMaterialIndexPath();
    if (!existsSync(indexPath)) {
      return { nextId: 1, files: [] };
    }
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as Partial<LocalUploadMaterialIndex>;
      return {
        nextId:
          typeof parsed.nextId === 'number' && parsed.nextId > 0
            ? parsed.nextId
            : 1,
        files: Array.isArray(parsed.files)
          ? parsed.files.filter((file) => {
              return (
                typeof file?.id === 'number' &&
                typeof file?.filename === 'string' &&
                typeof file?.filepath === 'string' &&
                typeof file?.uploadedAt === 'string'
              );
            }) as LocalUploadMaterialIndex['files']
          : [],
      };
    } catch {
      return { nextId: 1, files: [] };
    }
  }

  private writeLocalMaterialIndex(index: LocalUploadMaterialIndex) {
    writeFileSync(this.getLocalMaterialIndexPath(), JSON.stringify(index, null, 2));
  }

  private normalizeLocalMaterialFile(file: LocalUploadMaterialIndex['files'][number]) {
    return {
      ...file,
      filename: this.decodePossiblyLatin1Filename(file.filename),
    };
  }

  private decodePossiblyLatin1Filename(filename: string) {
    if (!filename || !MOJIBAKE_MARKERS.test(filename)) {
      return filename;
    }

    const repairedFilename = filename.replace(/ç´-/g, 'ç´\u00a0');
    const decoded = Buffer.from(repairedFilename, 'latin1').toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) {
      return filename;
    }

    return decoded;
  }

  private encodeUtf8FilenameAsLatin1(filename: string) {
    return Buffer.from(filename, 'utf8').toString('latin1');
  }

  private buildLocalMaterialFilename(inputName: string, originalName: string) {
    const normalizedInputName = this.decodePossiblyLatin1Filename(inputName);
    const normalizedOriginalName = this.decodePossiblyLatin1Filename(originalName);
    const originalExt = this.fileExtension(normalizedOriginalName);
    const inputExt = this.fileExtension(normalizedInputName);
    const base = normalizedInputName.replace(/\.[^.]+$/, '');
    const safeBase = this.safeLocalFilename(base || 'material');
    const ext = inputExt || originalExt;
    let filename = ext ? `${safeBase}.${ext}` : safeBase;
    const dir = this.getLocalMaterialDir();
    if (!existsSync(join(dir, filename))) {
      return filename;
    }
    const stamp = Date.now();
    filename = ext ? `${safeBase}-${stamp}.${ext}` : `${safeBase}-${stamp}`;
    return filename;
  }

  private fileExtension(filename: string) {
    const match = filename.match(/\.([a-zA-Z0-9]{1,10})$/);
    return match ? match[1].toLowerCase() : '';
  }

  private safeLocalFilename(filename: string) {
    return filename
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 120) || 'material';
  }

  private isSafeLocalFilename(filename: string) {
    return Boolean(filename) && !filename.includes('..') && !filename.includes('/') && !filename.includes('\\');
  }

  private localMaterialIdFromFilename(filename: string) {
    let hash = 0;
    for (let i = 0; i < filename.length; i += 1) {
      hash = (hash * 31 + filename.charCodeAt(i)) >>> 0;
    }
    return hash || 1;
  }

  private contentTypeFromFilename(filename: string) {
    const ext = this.fileExtension(filename);
    const types: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      pdf: 'application/pdf',
      txt: 'text/plain; charset=utf-8',
    };
    return types[ext] || 'application/octet-stream';
  }

  private collectInteractionEvidenceCleanup(
    retentionDays: number,
    execute: boolean,
  ): AutoUploadInteractionEvidenceCleanupResult {
    const directory =
      this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(process.cwd(), '.local-logs', 'browser-evidence');
    mkdirSync(directory, { recursive: true });
    const cutoff = Date.now() - Math.max(0, Math.floor(retentionDays)) * 24 * 60 * 60 * 1000;
    const errors: string[] = [];
    const files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(directory, entry.name);
        const stats = statSync(path);
        return {
          name: entry.name,
          path,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
          expired: stats.mtime.getTime() < cutoff,
        };
      });
    const candidates = files.filter((file) => file.expired);
    let deletedCount = 0;
    if (execute) {
      for (const file of candidates) {
        try {
          rmSync(file.path, { force: true });
          deletedCount += 1;
        } catch (error) {
          errors.push(
            `${file.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
    }
    return {
      directory,
      retentionDays: Math.max(0, Math.floor(retentionDays)),
      execute,
      candidateCount: candidates.length,
      deletedCount,
      totalBytes: candidates.reduce((sum, file) => sum + file.sizeBytes, 0),
      files: candidates.map(({ expired, ...file }) => file),
      errors,
      checkedAt: new Date().toISOString(),
      status: {
        directory,
        urlPrefix: '/api/local-engine/evidence',
        fileCount: files.length - deletedCount,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        latestUpdatedAt:
          files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
            ?.updatedAt ?? null,
      },
    };
  }

  async deleteAccount(id: number): Promise<null> {
    const account = await this.findPublishAccountByAnyId(id);
    if (!account) {
      throw new ServiceUnavailableException(`本地账号删除失败：账号不存在 ${id}`);
    }
    await this.prisma.publishAccount.delete({ where: { id: account.id } });
    return null;
  }

  buildLoginUrl(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }) {
    // 2026-06-04: 5409 /login 已下线. 改成返真平台登录页 URL, 前端用 playwright-mcp 打开.
    // requestId 仍保留, 用于后续 cancelLogin 关联同一个会话.
    const platformUrl = this.platformLoginUrl(input.type, input.profileName);
    const params = new URLSearchParams({
      type: String(input.type),
      id: input.profileName,
      request_id: input.requestId,
    });
    if (input.update && input.recordId) {
      params.set('update', '1');
      params.set('record_id', String(input.recordId));
    }
    return `${platformUrl}?${params.toString()}`;
  }

  /**
   * 各平台登录页 URL (原 5409 /login 端点的能力迁移).
   * type: 1=小红书 2=视频号 3=抖音 4=快手 5=B站
   */
  private platformLoginUrl(type: number, profileName?: string): string {
    const urls: Record<number, string> = {
      3: 'https://creator.douyin.com/creator-micro/login', // 抖音
      2: 'https://channels.weixin.qq.com/login', // 视频号
      1: 'https://creator.xiaohongshu.com/login', // 小红书
      4: 'https://cp.kuaishou.com/article/publish/video', // 快手
      5: 'https://member.bilibili.com/v2/#/login', // B站
    };
    const base = urls[type] || 'about:blank';
    return profileName ? `${base}?profile=${encodeURIComponent(profileName)}` : base;
  }

  async *streamAccountLogin(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }): AsyncGenerator<string> {
    if (this.cancelledLoginRequestIds.has(input.requestId)) {
      this.cancelledLoginRequestIds.delete(input.requestId);
      yield 'CANCELLED';
      return;
    }
    if (!this.localBrowser) {
      yield 'ERROR: LocalBrowserEngine 未注入，无法启动 CDP 持久浏览器';
      yield '500';
      return;
    }

    const platform = this.resolveBrowserPlatformSlug(input.type);
    if (!platform) {
      yield `ERROR: 不支持的平台类型：${input.type}`;
      yield '500';
      return;
    }
    const platformType = input.type;
    const engineAccountId = await this.resolveLoginEngineAccountId(input);
    const session = await this.localBrowser.getOrCreateSession({
      platform,
      accountId: engineAccountId,
    });
    this.activeLoginSessionKeys.set(input.requestId, session.key);

    try {
      await this.prepareLoginPage(session.page, platformType);
      const qr = await this.extractLoginQrData(session.page, platformType);
      if (!qr) {
        yield 'ERROR: 登录页面加载超时，未获取到二维码。请关闭弹窗后重试，或检查平台登录页是否改版、浏览器是否被拦截。';
        yield '500';
        return;
      }
      yield qr;

      const loggedIn = await this.waitForLoginSuccess(
        session.page,
        platformType,
        input.requestId,
      );
      if (loggedIn === 'cancelled') {
        yield 'CANCELLED';
        return;
      }
      if (loggedIn !== 'logged_in') {
        yield '500';
        return;
      }

      await session.page.waitForTimeout(1500).catch(() => undefined);
      const storageFileName = `${randomUUID()}.json`;
      const storagePath = this.getAccountCookiePath(storageFileName);
      await this.saveFilteredStorageState(
        session.context,
        platform,
        storagePath,
        session.profileDir,
      );
      const valid = await this.validateCookieFile(platformType, storagePath);
      if (!valid) {
        yield '500';
        return;
      }
      const identity = await this.captureAccountIdentityBestEffort(
        session.page,
        engineAccountId,
      );
      const savedId = await this.saveLoginPublishAccount({
        platform,
        platformType,
        engineAccountId,
        profileName: input.profileName,
        filePath: storageFileName,
        update: input.update,
        recordId: input.recordId,
        identity,
      });
      yield `ACCOUNT_ID:${engineAccountId}`;
      yield '200';
      if (savedId !== `local-engine-${engineAccountId}`) {
        this.logger.log(`登录账号保存到 publish_accounts: ${savedId}`);
      }
    } catch (error) {
      yield `ERROR: 登录页面初始化失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      yield '500';
    } finally {
      this.activeLoginSessionKeys.delete(input.requestId);
    }
  }

  async cancelLogin(requestId: string): Promise<AutoUploadCancelLoginResult> {
    this.cancelledLoginRequestIds.add(requestId);
    try {
      const key = this.activeLoginSessionKeys.get(requestId);
      if (key && this.localBrowser) {
        await this.localBrowser.closeSession(key);
      }
      return { cancelled: true, requestId, message: '已取消登录流程' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`cancelLogin 失败: ${message}`);
      return { cancelled: false, requestId, message: `关闭浏览器失败: ${message}` };
    }
  }

  async listMaterials(): Promise<AutoUploadMaterial[]> {
    const index = this.readLocalMaterialIndex();
    const materialDir = this.getLocalMaterialDir();
    const indexed = new Map(index.files.map((file) => [file.filename, this.normalizeLocalMaterialFile(file)]));
    const files = readdirSync(materialDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'index.json')
      .map((entry) => {
        const normalizedEntryName = this.decodePossiblyLatin1Filename(entry.name);
        const indexedFile = indexed.get(entry.name) || indexed.get(normalizedEntryName);
        if (indexedFile) return indexedFile;
        const id = this.localMaterialIdFromFilename(entry.name);
        return {
          id,
          filename: normalizedEntryName,
          filepath: join(materialDir, entry.name),
          uploadedAt: statSync(join(materialDir, entry.name)).mtime.toISOString(),
        };
      });
    return files
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
      .map((file) => {
        const stats = statSync(file.filepath);
        return {
          id: file.id,
          filename: file.filename,
          filesizeMb: Number((stats.size / 1024 / 1024).toFixed(2)),
          uploadTime: file.uploadedAt,
          filePath: file.filepath,
        };
      });
  }

  async listLogs(limit = 80): Promise<AutoUploadLogFile[]> {
    // 2026-06-04: 5409 (auto-upload) 已下线. 旧 endpoint /logs/recent 不存在.
    // 真执行日志走 runtime_executions (orchestrator 每次 execute 都写一条).
    try {
      const rows = await this.prisma.runtimeExecution.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.max(1, Math.min(500, Math.floor(limit))),
      });
      const lines = rows.map((r) => {
        const ts = r.createdAt.toISOString();
        const ok = r.ok ? 'OK ' : 'ERR';
        return `${ts} [${ok}] ${r.executor} ${r.platform}/${r.taskType} status=${r.status} reason=${r.reasonCode} ${r.userMessage}`;
      });
      // 占位: 把所有行打包成 1 个虚拟 log 文件; 前端 UI 仍按 "运行日志" 渲染
      return [
        {
          key: 'runtime-executions',
          platform: 'runtime',
          filename: 'runtime-executions.log',
          path: 'db://runtime_executions',
          size: lines.length,
          updatedAt: rows[0]?.createdAt?.toISOString() ?? new Date().toISOString(),
          lines,
        },
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地运行日志读取失败：${message}`);
    }
  }

  async listTasks(limit = 50): Promise<AutoUploadPublishTask[]> {
    const taskTypeLabel: Record<string, string> = {
      DOUYIN_COMMENT_REPLY: '抖音评论回复',
      DOUYIN_DIRECT_MESSAGE_REPLY: '抖音私信回复',
      WECHAT_CHANNEL_COMMENT_REPLY: '视频号评论回复',
      WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: '视频号私信回复',
      WECHAT_REPLY_DRAFT: '微信草稿',
      WECHAT_GROUP_BROADCAST: '微信群发',
      WECHAT_MOMENTS_PUBLISH: '朋友圈发布',
      CUSTOMER_FOLLOW_UP: '客户跟进',
    };
    const platformFromTaskType: Record<string, { type: number; name: string }> = {
      DOUYIN_COMMENT_REPLY: { type: 3, name: '抖音' },
      DOUYIN_DIRECT_MESSAGE_REPLY: { type: 3, name: '抖音' },
      WECHAT_CHANNEL_COMMENT_REPLY: { type: 2, name: '视频号' },
      WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: { type: 2, name: '视频号' },
      WECHAT_REPLY_DRAFT: { type: 6, name: '微信' },
      WECHAT_GROUP_BROADCAST: { type: 6, name: '微信' },
      WECHAT_MOMENTS_PUBLISH: { type: 6, name: '微信' },
      CUSTOMER_FOLLOW_UP: { type: 0, name: '客户互动' },
    };
    const rows = await this.prisma.interactionTask.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(200, Math.floor(limit))),
    });
    return rows.map((row, index) => {
      const config = (row.config || {}) as {
        title?: string;
        sourceText?: string;
        typeLabel?: string;
        platformName?: string;
        accountName?: string;
        targetName?: string;
        statusLabel?: string;
        nextAction?: string;
        failureReason?: string;
      };
      const platform =
        platformFromTaskType[row.taskType] || {
          type: 0,
          name: config.platformName || '本地互动',
        };
      const message =
        config.failureReason ||
        config.nextAction ||
        row.draftText ||
        config.sourceText ||
        null;
      return {
        id: this.localTaskIdToNumber(row.id, index),
        title:
          config.title ||
          config.typeLabel ||
          taskTypeLabel[row.taskType] ||
          row.taskType,
        platform_type: platform.type,
        platform: config.platformName || platform.name,
        account_file: row.accountId || '',
        file_list: [],
        tags: [row.taskType],
        dry_run: false,
        status: String(row.status).toLowerCase(),
        message,
        result: {
          source: 'interaction_tasks',
          id: row.id,
          taskType: row.taskType,
          currentTarget: row.currentTarget,
          processedCount: row.processedCount,
          failedCount: row.failedCount,
          skippedCount: row.skippedCount,
          batchSummary: row.batchSummary,
          evidence: row.evidence,
          accountName: config.accountName,
          targetName: config.targetName,
          statusLabel: config.statusLabel,
        },
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      };
    });
  }

  async uploadMaterial(input: {
    file: AutoUploadUploadFile;
    filename?: string;
  }): Promise<UploadedAutoUploadMaterial> {
    try {
      const materialDir = this.getLocalMaterialDir();
      const sourceName = this.decodePossiblyLatin1Filename(input.file.originalname || 'material');
      const finalName = this.buildLocalMaterialFilename(
        input.filename?.trim() || sourceName,
        sourceName,
      );
      const filepath = join(materialDir, finalName);
      writeFileSync(filepath, input.file.buffer);

      const index = this.readLocalMaterialIndex();
      const existing = index.files.find((file) => file.filename === finalName);
      if (existing) {
        existing.filepath = filepath;
        existing.uploadedAt = new Date().toISOString();
      } else {
        index.files.push({
          id: index.nextId++,
          filename: finalName,
          filepath,
          uploadedAt: new Date().toISOString(),
        });
      }
      this.writeLocalMaterialIndex(index);
      return { filename: finalName, filepath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地素材上传失败：${message}`);
    }
  }

  async fetchMaterialFile(filename: string) {
    if (!this.isSafeLocalFilename(filename)) {
      throw new ServiceUnavailableException('本地素材预览失败：文件名无效');
    }
    const materialDir = this.getLocalMaterialDir();
    let filepath = join(materialDir, filename);
    const legacyMojibakeFilename = this.encodeUtf8FilenameAsLatin1(filename);
    const legacySafeFilename = this.safeLocalFilename(legacyMojibakeFilename);
    if (!existsSync(filepath)) {
      for (const candidate of [legacyMojibakeFilename, legacySafeFilename]) {
        if (candidate === filename) continue;
        const legacyPath = join(materialDir, candidate);
        if (existsSync(legacyPath)) {
          filepath = legacyPath;
          break;
        }
      }
    }
    if (!existsSync(filepath)) {
      throw new ServiceUnavailableException(
        `本地素材预览读取失败：文件不存在 ${filename}`,
      );
    }
    const stats = statSync(filepath);

    return {
      contentType: this.contentTypeFromFilename(filename),
      contentLength: String(stats.size),
      buffer: readFileSync(filepath),
    };
  }

  async deleteMaterial(id: number): Promise<{ id: number; filename: string }> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('素材 ID 无效');
    }

    const index = this.readLocalMaterialIndex();
    let target = index.files.find((file) => file.id === id);
    if (!target) {
      const materialDir = this.getLocalMaterialDir();
      const scanned = readdirSync(materialDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name !== 'index.json')
        .map((entry) => ({
          id: this.localMaterialIdFromFilename(entry.name),
          filename: entry.name,
          filepath: join(materialDir, entry.name),
          uploadedAt: statSync(join(materialDir, entry.name)).mtime.toISOString(),
        }))
        .find((file) => file.id === id);
      target = scanned;
    }
    if (!target) {
      throw new ServiceUnavailableException(`本地素材删除失败：素材不存在 ${id}`);
    }
    if (existsSync(target.filepath)) {
      rmSync(target.filepath, { force: true });
    }
    index.files = index.files.filter((file) => file.id !== id);
    this.writeLocalMaterialIndex(index);
    return { id, filename: target.filename };
  }

  async publishBatch(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishResponse> {
    if (!payloads.length) {
      throw new Error('请至少选择一个发布账号');
    }
    const results = await Promise.all(
      payloads.map(async (payload, index) => {
        const runtimeAccountId = await this.resolvePublishRuntimeAccountId(payload);
        const result = await this.runtime.execute(
          {
            relatedId: `publish-${Date.now()}-${index}`,
            relatedType: 'agent-session',
            type:
              payload.contentKind === 'article'
                ? 'platform-publish-image-text'
                : 'platform-publish-video',
            platform:
              this.resolveRuntimePlatform(payload.type),
            accountId: runtimeAccountId,
            payload: {
              platform: this.resolvePlatformName(payload.type),
              platformType: payload.type,
              contentKind: payload.contentKind,
              title: payload.title,
              tags: payload.tags,
              accountId: runtimeAccountId,
              materialFiles: payload.fileList,
              coverPath: payload.coverPath,
              coverPaths: payload.coverPaths,
              scheduleTime: payload.scheduleTime,
            },
          },
          {
            riskContext: {
              accountId: runtimeAccountId,
              accountName: runtimeAccountId,
              deviceName: 'local-runtime',
            },
            sendMode: 'auto-send',
          },
        );
        return { payload, result };
      }),
    );
    const publishResults = results.map(({ payload, result }) =>
      this.buildRuntimePublishResult(payload, result),
    );

    return {
      reason: this.buildRuntimePublishReason(publishResults),
      taskIds: [],
      results: publishResults,
    };
  }

  private buildRuntimePublishResult(
    payload: AutoUploadPublishPayload,
    result: RuntimeExecutionResult,
  ): AutoUploadPublishResultItem {
    const publishUrl = this.extractRuntimePublishUrl(result);
    const readbackOk = result.readback?.matched === true;
    const evidence = {
      source: readbackOk ? 'readback' : 'runtime',
      reasonCode: result.reasonCode,
      status: result.status,
      technicalMessage: result.technicalMessage,
      readbackOk,
      publishUrl,
      platformUrl: publishUrl,
      runtimeEvidence: result.evidence,
      readback: result.readback,
    };

    return {
      type: payload.type,
      ok: result.ok,
      platform: this.resolvePlatformName(payload.type),
      account: payload.accountList?.[0] ?? '',
      publishUrl,
      platformUrl: publishUrl,
      notIntegrated: result.reasonCode === 'not_integrated',
      message: result.userMessage,
      evidence,
    };
  }

  private buildRuntimePublishReason(results: AutoUploadPublishResultItem[]) {
    if (results.length > 0 && results.every((item) => item.ok === true)) {
      return '3011 Runtime 已返回平台发布回读证据。';
    }

    if (results.some((item) => item.ok === true)) {
      return '3011 Runtime 部分发布完成，部分平台需要处理。';
    }

    if (results.every((item) => item.notIntegrated === true)) {
      return '真实发布执行器尚未全部迁入 3011 Runtime，不能假装发布成功。';
    }

    return '3011 Runtime 发布执行失败或被阻断，请查看逐平台结果。';
  }

  private extractRuntimePublishUrl(
    result: RuntimeExecutionResult,
  ): string | undefined {
    const readbackText = result.readback?.actualText;
    if (typeof readbackText === 'string') {
      const url = readbackText.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
      if (url) return url;
    }

    const technicalUrl =
      typeof result.technicalMessage === 'string'
        ? result.technicalMessage.match(/https?:\/\/[^\s"'<>]+/i)?.[0]
        : undefined;
    if (technicalUrl) return technicalUrl;

    for (const item of result.evidence ?? []) {
      const valueUrl =
        typeof item.value === 'string'
          ? item.value.match(/https?:\/\/[^\s"'<>]+/i)?.[0]
          : undefined;
      if (valueUrl) return valueUrl;
      const rawUrl =
        typeof item.raw?.currentUrl === 'string'
          ? item.raw.currentUrl
          : undefined;
      if (rawUrl) return rawUrl;
    }

    return undefined;
  }

  private async resolvePublishRuntimeAccountId(
    payload: AutoUploadPublishPayload,
  ): Promise<string | undefined> {
    const candidates = [
      ...(payload.accountIds ?? []).map((id) => String(id)),
      ...(payload.accountList ?? []).map((id) => String(id)),
    ].filter(Boolean);
    if (!candidates.length) return undefined;

    const fallback = candidates[0];
    const platform = this.resolvePlatformSlug(payload.type);
    try {
      const rows = await this.prisma.publishAccount.findMany({
        where: platform ? { platform } : undefined,
        orderBy: { createdAt: 'asc' },
      });
      const match = rows.find((row: { id: string; config: unknown }) => {
        const cfg = (row.config ?? {}) as {
          engineAccountId?: number | string;
          filePath?: string;
          accountFile?: string;
          profileName?: string;
        };
        const rowCandidates = [
          row.id,
          cfg.engineAccountId,
          cfg.filePath,
          cfg.accountFile,
          cfg.profileName,
        ]
          .filter((value) => value !== undefined && value !== null)
          .map((value) => String(value));
        return candidates.some((candidate) => rowCandidates.includes(candidate));
      });
      if (!match) return fallback;
      const cfg = (match.config ?? {}) as { engineAccountId?: number | string };
      return String(cfg.engineAccountId ?? match.id);
    } catch {
      return fallback;
    }
  }

  private resolvePlatformSlug(type: number): Exclude<ExecutorTaskPlatform, 'wechat-desktop' | 'mixed'> | undefined {
    const names: Record<number, Exclude<ExecutorTaskPlatform, 'wechat-desktop' | 'mixed'>> = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
    };
    return names[type];
  }

  private resolveRuntimePlatform(type: number): ExecutorTaskPlatform {
    return this.resolvePlatformSlug(type) ?? 'mixed';
  }

  private resolvePlatformName(type: number) {
    const names: Record<number, string> = {
      1: '小红书',
      2: '视频号',
      3: '抖音',
      4: '快手',
      5: 'B站',
    };
    return names[type] || `未知平台 ${type}`;
  }

  private localTaskIdToNumber(id: string, index: number) {
    const digits = id.replace(/\D/g, '').slice(-9);
    const parsed = digits ? Number(digits) : Number.NaN;
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return (hash % 900000000) + 100000000 + index;
  }

  // 2026-06-04: 补 platform -> platformType 映射 (publish_accounts.platform 是英文 enum)
  private static readonly PUBLISH_PLATFORM_TYPE_MAP: Record<string, number> = {
    xiaohongshu: 1,
    'wechat-channel': 2,
    douyin: 3,
    kuaishou: 4,
    bilibili: 5,
  };

  /* 2026-06-04: 5409 SQLite reader 已删除. 之前返回僵尸 'status: 1 / 正常' 标签的根因.
   * 之前逻辑: 5409 HTTP fail -> 落回 ~/auto-upload/db/database.db (5409 SQLite)
   * 现在逻辑: 直接读 Postgres publish_accounts (prisma). session 状态用 runtime_executions 反推.
   */
}
