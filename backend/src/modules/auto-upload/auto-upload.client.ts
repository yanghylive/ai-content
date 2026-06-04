import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
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
  // 2026-06-04: 5409 (auto-upload) 已下线. 默认 URL 改成空, 触发 fail-fast
  // 显式设 AUTO_UPLOAD_ENGINE_URL 才会真用 (兼容老发布路径; 新评论/私信路径已走 MCP)
  private readonly defaultEngineUrl = '';

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

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
    // 2026-06-04: 5409 (auto-upload) 已下线. 返 in-process 引擎状态占位.
    // 真状态请看 /api/local-engine/health (PlaywrightMcpService + RuntimeOrchestrator)
    return {
      online: false,
      status: 'deprecated',
      service: 'auto-upload (5409)',
      version: 'n/a',
      engineUrl: '',
      checkedAt: new Date().toISOString(),
    };
  }

  async getInteractionCapabilities(): Promise<AutoUploadInteractionCapabilities> {
    // 2026-06-04: 5409 /interaction/capabilities 已下线. 返空 capabilities 占位.
    // 真 capabilities 看 /api/local-engine/health (LocalBrowserEngine + RuntimeOrchestrator)
    return {
      service: 'auto-upload (deprecated, 5409 已下线)',
      version: 'n/a',
      checkedAt: new Date().toISOString(),
      supportedTaskTypes: [],
      evidence: {
        directory: '',
        urlPrefix: '',
        fileCount: 0,
        totalBytes: 0,
      },
      screenshotCleanup: {
        recommendation: 'deprecated',
        retentionDays: 7,
        maxFiles: 0,
        safePattern: '',
        suggestedCommand: '',
      },
      safetyBoundary: {
        host: '',
        network: '',
        dataLocality: '',
        browserAutomation: '',
        sendPolicy: '',
        pathAccess: [],
      },
    } as unknown as AutoUploadInteractionCapabilities;
  }

  async getCdpSessions(): Promise<AutoUploadCdpSessionsResult> {
    // 2026-06-04: 5409 (auto-upload) 已下线; CDP 会话改由 LocalBrowserEngine (in-process Chrome) 提供.
    // 保留返回结构以便前端 use-cdp-session-status 钩子不需改.
    // 真要拿 sessions, 工作台请调 /api/local-engine/.../cdp-sessions 走 in-process 引擎.
    return {
      available: false,
      sessions: [],
      message: 'CDP 会话接口已下线 (5409 不再启). 浏览器会话由 3011 in-process Chrome 提供, 见 /api/local-engine/health',
      checkedAt: new Date().toISOString(),
    };
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

    return filtered
      .map((row) => this.mapPublishAccountToAutoUploadAccount(row))
      .filter((acc) => !options?.validate || acc.status === 1);
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
      statusLabel: ready ? '已配置' : '失效',
    };
  }

  async openAccounts(ids: (number | string)[]): Promise<AutoUploadOpenAccountsResult> {
    // 2026-06-04: 5409 /openAccounts 已下线. 返空 opened/skipped, 前端不再卡死.
    // 真打开浏览器请前端调 playwright-mcp:open (npm script) 或 Agent-S /status 看会话.
    return {
      opened: [],
      skipped: ids.map((id) => ({
        id: Number(id) || 0,
        reason: '5409 /openAccounts 已下线; 浏览器由 in-process Chrome (playwright-mcp) 自动管理',
      })),
    } as unknown as AutoUploadOpenAccountsResult;
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
    // 2026-06-04: 5409 /getFiles 已下线. 返空列表.
    return [];
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
    // 2026-06-04: 5409 /publishTasks 已下线. 返空列表.
    return [];
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
