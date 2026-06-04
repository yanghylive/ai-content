import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile, execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
  browser?: string;
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

type AutoUploadEngineResponse<T> = {
  code?: number;
  data?: T;
  msg?: string | null;
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
};

export type AutoUploadCancelLoginResult = {
  cancelled: boolean;
};

type AutoUploadEngineMaterial = {
  id: number;
  filename: string;
  filesize?: number | null;
  upload_time?: string | null;
  file_path?: string | null;
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
    evidence?: unknown;
  }>;
} | null;

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
  private readonly defaultEngineUrl = 'http://127.0.0.1:5409';

  constructor(private readonly configService: ConfigService) {}

  getEngineUrl() {
    return (
      this.configService.get<string>('AUTO_UPLOAD_ENGINE_URL') ||
      this.defaultEngineUrl
    ).replace(/\/$/, '');
  }

  private async getEngineJson<T>(
    pathname: string,
    options?: RequestInit,
  ): Promise<T> {
    const engineUrl = this.getEngineUrl();
    const timeout = pathname.includes('getValidAccounts') ? 120000 : 10000;
    const response = await fetch(`${engineUrl}${pathname}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeout),
      ...options,
    });
    const data = (await response.json()) as AutoUploadEngineResponse<T>;

    if (!response.ok || data.code !== 200) {
      throw new Error(
        data.msg || `Auto Upload request failed: ${response.status}`,
      );
    }

    return data.data as T;
  }

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
    const engineUrl = this.getEngineUrl();

    try {
      const response = await fetch(`${engineUrl}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000),
      });
      const data = (await response.json()) as Partial<AutoUploadEngineHealth>;

      if (!response.ok) {
        throw new Error(`Engine health failed: ${response.status}`);
      }

      return {
        online: true,
        status: data.status || 'ok',
        service: data.service || 'auto-upload',
        version: data.version || 'unknown',
        engineUrl,
        baseDir: data.baseDir,
        frontendDist: data.frontendDist,
        database: data.database,
        folders: data.folders,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(
        `本地发布引擎未启动或不可访问：${message}`,
      );
    }
  }

  async getInteractionCapabilities(): Promise<AutoUploadInteractionCapabilities> {
    try {
      return await this.getEngineJson<AutoUploadInteractionCapabilities>(
        '/interaction/capabilities',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地互动能力读取失败：${message}`);
    }
  }

  async getCdpSessions(): Promise<AutoUploadCdpSessionsResult> {
    try {
      const sessionsByKey = await this.getEngineJson<
        Record<string, AutoUploadCdpBrowserSession>
      >('/interaction/cdp/sessions', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      const sessions = Object.values(sessionsByKey || {});
      return {
        available: sessions.length > 0,
        sessions,
        message:
          sessions.length > 0
            ? `CDP 浏览器在线：${sessions.length} 个会话`
            : 'CDP 浏览器未启动或没有在线会话',
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        available: false,
        sessions: [],
        message: `CDP 会话接口不可用：${message}`,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async previewInteractionEvidenceCleanup(
    retentionDays = 7,
  ): Promise<AutoUploadInteractionEvidenceCleanupResult> {
    try {
      const params = new URLSearchParams({
        retentionDays: String(Math.max(0, Math.floor(retentionDays))),
      });
      return await this.getEngineJson<AutoUploadInteractionEvidenceCleanupResult>(
        `/interaction/evidence/cleanup-preview?${params.toString()}`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地证据清理预览失败：${message}`);
    }
  }

  async cleanupInteractionEvidence(
    retentionDays = 7,
  ): Promise<AutoUploadInteractionEvidenceCleanupResult> {
    try {
      return await this.getEngineJson<AutoUploadInteractionEvidenceCleanupResult>(
        '/interaction/evidence/cleanup',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            retentionDays: Math.max(0, Math.floor(retentionDays)),
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地证据清理失败：${message}`);
    }
  }

  async listAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: number[];
  }): Promise<AutoUploadAccount[]> {
    try {
      const params = new URLSearchParams();
      if (options?.validate) {
        params.set('validate', '1');
      }
      if (options?.force) {
        params.set('force', '1');
      }
      if (options?.ids?.length) {
        params.set('ids', options.ids.join(','));
      }
      const accounts = await this.getEngineJson<
        Omit<AutoUploadAccount, 'platform' | 'statusLabel'>[]
      >(`/getValidAccounts${params.size ? `?${params.toString()}` : ''}`);

      return accounts.map((account) => ({
        ...account,
        platform: this.resolvePlatformName(account.type),
        statusLabel: account.status === 1 ? '正常' : '失效',
      }));
    } catch (error) {
      const fallbackAccounts = this.listAccountsFromLocalDatabase(options);
      if (fallbackAccounts.length > 0) {
        return fallbackAccounts;
      }
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地发布账号读取失败：${message}`);
    }
  }

  async openAccounts(ids: number[]): Promise<AutoUploadOpenAccountsResult> {
    try {
      return await this.getEngineJson<AutoUploadOpenAccountsResult>(
        '/openAccounts',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids }),
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地账号后台打开失败：${message}`);
    }
  }

  async openInteractionEntry(input: {
    accountId: number;
    entryType: string;
  }): Promise<AutoUploadInteractionEntryResult> {
    try {
      return await this.getEngineJson<AutoUploadInteractionEntryResult>(
        '/interaction/openEntry',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地互动入口打开失败：${message}`);
    }
  }

  async readDouyinComments(input: {
    accountId: number;
    limit?: number;
    parsingRules?: unknown;
  }): Promise<AutoUploadDouyinCommentsReadResult> {
    try {
      return await this.getEngineJson<AutoUploadDouyinCommentsReadResult>(
        '/interaction/douyin/comments/read',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(150000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`抖音评论读取失败：${message}`);
    }
  }

  async readDouyinMessages(input: {
    accountId: number;
    limit?: number;
  }): Promise<AutoUploadDouyinMessagesReadResult> {
    try {
      return await this.getEngineJson<AutoUploadDouyinMessagesReadResult>(
        '/interaction/douyin/messages/read',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(150000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`抖音私信读取失败：${message}`);
    }
  }

  async readWechatChannelComments(input: {
    accountId: number;
    limit?: number;
  }): Promise<AutoUploadWechatChannelCommentsReadResult> {
    try {
      return await this.getEngineJson<AutoUploadWechatChannelCommentsReadResult>(
        '/interaction/wechat-channel/comments/read',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(150000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`视频号评论读取失败：${message}`);
    }
  }

  async readWechatChannelMessages(input: {
    accountId: number;
    limit?: number;
  }): Promise<AutoUploadWechatChannelMessagesReadResult> {
    try {
      return await this.getEngineJson<AutoUploadWechatChannelMessagesReadResult>(
        '/interaction/wechat-channel/messages/read',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(60000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`视频号私信读取失败：${message}`);
    }
  }

  async getWechatDesktopStatus(): Promise<AutoUploadWechatDesktopStatus> {
    try {
      return await this.getEngineJson<AutoUploadWechatDesktopStatus>(
        '/interaction/wechat/desktop/status',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信桌面状态检测失败：${message}`);
    }
  }

  async listWechatWindows(): Promise<{
    windows: Array<{ id: string; title: string; isMain: boolean }>;
  }> {
    try {
      return await this.getEngineJson<{
        windows: Array<{ id: string; title: string; isMain: boolean }>;
      }>('/interaction/wechat/desktop/windows', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信窗口列表读取失败：${message}`);
    }
  }

  async resolveWechatContact(query: string): Promise<{
    matches: Array<{ name: string; remark: string; id: string }>;
    ambiguous: boolean;
  }> {
    try {
      const params = new URLSearchParams({ query });
      return await this.getEngineJson<{
        matches: Array<{ name: string; remark: string; id: string }>;
        ambiguous: boolean;
      }>(`/interaction/wechat/desktop/contacts/search?${params.toString()}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信联系人搜索失败：${message}`);
    }
  }

  async dismissWechatPopup(): Promise<{
    dismissed: boolean;
    popupType?: string;
  }> {
    try {
      return await this.getEngineJson<{
        dismissed: boolean;
        popupType?: string;
      }>('/interaction/wechat/desktop/dismiss-popup', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信弹窗关闭失败：${message}`);
    }
  }

  async checkWechatAlive(): Promise<{ alive: boolean; reason?: string }> {
    try {
      return await this.getEngineJson<{ alive: boolean; reason?: string }>(
        '/interaction/wechat/desktop/alive',
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信存活检测失败：${message}`);
    }
  }

  async draftWechatReply(input: {
    targetText?: string;
    replyText: string;
  }): Promise<AutoUploadWechatDraftResult> {
    try {
      return await this.getEngineJson<AutoUploadWechatDraftResult>(
        '/interaction/wechat/draft',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信草稿粘贴失败：${message}`);
    }
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
    try {
      return await this.getEngineJson<AutoUploadRefreshAccountAvatarResult>(
        '/refreshAccountAvatar',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id }),
          signal: AbortSignal.timeout(120000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地账号头像刷新失败：${message}`);
    }
  }

  async deleteAccount(id: number): Promise<null> {
    try {
      return await this.getEngineJson<null>(
        `/deleteAccount?id=${encodeURIComponent(String(id))}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地账号删除失败：${message}`);
    }
  }

  buildLoginUrl(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }) {
    const params = new URLSearchParams({
      type: String(input.type),
      id: input.profileName,
      request_id: input.requestId,
    });
    if (input.update && input.recordId) {
      params.set('update', '1');
      params.set('record_id', String(input.recordId));
    }

    return `${this.getEngineUrl()}/login?${params.toString()}`;
  }

  async cancelLogin(requestId: string): Promise<AutoUploadCancelLoginResult> {
    try {
      return await this.getEngineJson<AutoUploadCancelLoginResult>(
        '/cancelLogin',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestId }),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地登录取消失败：${message}`);
    }
  }

  async listMaterials(): Promise<AutoUploadMaterial[]> {
    try {
      const materials =
        await this.getEngineJson<AutoUploadEngineMaterial[]>('/getFiles');

      return materials.map((material) => ({
        id: material.id,
        filename: material.filename,
        filesizeMb:
          typeof material.filesize === 'number' ? material.filesize : null,
        uploadTime: material.upload_time || null,
        filePath: material.file_path || null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地分发素材读取失败：${message}`);
    }
  }

  async listLogs(limit = 80): Promise<AutoUploadLogFile[]> {
    try {
      return await this.getEngineJson<AutoUploadLogFile[]>(
        `/logs/recent?limit=${encodeURIComponent(String(limit))}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地运行日志读取失败：${message}`);
    }
  }

  async listTasks(limit = 50): Promise<AutoUploadPublishTask[]> {
    try {
      return await this.getEngineJson<AutoUploadPublishTask[]>(
        `/publishTasks?limit=${encodeURIComponent(String(limit))}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地发布任务读取失败：${message}`);
    }
  }

  async uploadMaterial(input: {
    file: AutoUploadUploadFile;
    filename?: string;
  }): Promise<UploadedAutoUploadMaterial> {
    const formData = new FormData();
    const arrayBuffer = input.file.buffer.buffer.slice(
      input.file.buffer.byteOffset,
      input.file.buffer.byteOffset + input.file.buffer.byteLength,
    ) as ArrayBuffer;
    formData.append(
      'file',
      new Blob([arrayBuffer], {
        type: input.file.mimetype || 'application/octet-stream',
      }),
      input.file.originalname,
    );
    if (input.filename?.trim()) {
      formData.append('filename', input.filename.trim());
    }

    try {
      return await this.getEngineJson<UploadedAutoUploadMaterial>(
        '/uploadSave',
        {
          method: 'POST',
          body: formData,
          headers: undefined,
          signal: AbortSignal.timeout(120000),
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地素材上传失败：${message}`);
    }
  }

  async fetchMaterialFile(filename: string) {
    const engineUrl = this.getEngineUrl();
    const response = await fetch(
      `${engineUrl}/getFile?filename=${encodeURIComponent(filename)}`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `本地素材预览读取失败：${response.status}`,
      );
    }

    return {
      contentType:
        response.headers.get('content-type') || 'application/octet-stream',
      contentLength: response.headers.get('content-length'),
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  async deleteMaterial(id: number): Promise<{ id: number; filename: string }> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('素材 ID 无效');
    }

    try {
      return await this.getEngineJson<{ id: number; filename: string }>(
        `/deleteFile?id=${encodeURIComponent(String(id))}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地素材删除失败：${message}`);
    }
  }

  async publishBatch(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishResponse> {
    if (!payloads.length) {
      throw new Error('请至少选择一个发布账号');
    }

    try {
      return await this.postEnginePublishBatch(payloads);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`本地发布任务提交失败：${message}`);
    }
  }

  private async postEnginePublishBatch(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishResponse> {
    const engineUrl = this.getEngineUrl();
    const response = await fetch(`${engineUrl}/postVideoBatch`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payloads),
      signal: AbortSignal.timeout(1000 * 60 * 20),
    });
    const data =
      (await response.json()) as AutoUploadEngineResponse<AutoUploadPublishResponse>;

    if (response.ok && data.code === 200) {
      return data.data ?? null;
    }

    if (
      data.data &&
      typeof data.data === 'object' &&
      Array.isArray(data.data.results)
    ) {
      return data.data;
    }

    throw new Error(
      data.msg || `Auto Upload request failed: ${response.status}`,
    );
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

  private listAccountsFromLocalDatabase(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: number[];
  }): AutoUploadAccount[] {
    const root =
      this.configService.get<string>('AUTO_UPLOAD_ENGINE_ROOT') ||
      join(homedir(), 'auto-upload');
    const databasePath = join(root, 'db', 'database.db');
    if (!existsSync(databasePath)) {
      return [];
    }

    const idFilter = options?.ids?.length
      ? `where id in (${
          options.ids
            .map((id) => Number(id))
            .filter(Number.isFinite)
            .join(',') || 'null'
        })`
      : '';
    const sql = [
      'select id,type,filePath,userName,status,profileName,avatarPath,avatarUpdatedAt',
      'from user_info',
      idFilter,
      'order by id',
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const raw = execFileSync('sqlite3', ['-json', databasePath, sql], {
        encoding: 'utf8',
        timeout: 3000,
      });
      const accounts = JSON.parse(raw || '[]') as Array<{
        id: number;
        type: number;
        filePath: string;
        userName: string;
        status: number;
        profileName?: string | null;
        avatarPath?: string | null;
        avatarUpdatedAt?: string | null;
      }>;

      return accounts
        .filter((account) => !options?.validate || account.status === 1)
        .map((account) => ({
          ...account,
          platform: this.resolvePlatformName(account.type),
          statusLabel: account.status === 1 ? '正常' : '失效',
        }));
    } catch {
      return [];
    }
  }
}
