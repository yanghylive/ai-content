import {
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { assertMaterialFileSafe } from './material-file.guard';
import { ConfigService } from '@nestjs/config';
import { safeText } from '../../common/text.utils';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
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
import { execFile, execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { localEnginePublishAccountId } from '../publishing/local-engine-account-id';
import { captureAccountIdentity } from './identity-capture';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { readdir as readdirAsync, stat as statAsync } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'os';
import { dirname, join, resolve } from 'path';
import {
  chromium,
  type BrowserContext,
  type Frame,
  type Page,
} from 'playwright';
import { promisify } from 'util';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveProjectRoot,
} from '../../common/project-paths';

const execFileAsync = promisify(execFile);
const MOJIBAKE_MARKERS =
  /(?:Ã.|Â.|â.|æ|è|é|å|ç|¢|£|¤|¥|¦|§|¨|©|ª|«|¬|®|¯|°|±|²|³|´|µ|¶|·|¸|¹|º|»|¼|½|¾|¿)/;
type PublishAccountRow = {
  id: string;
  tenantId?: string;
  userId?: string;
  platform: string;
  name: string;
  status?: string;
  appId?: string | null;
  apiToken?: string | null;
  config: unknown;
  createdAt?: Date;
  updatedAt?: Date;
};

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
  sourceAccountId?: string | number;
  profileDir?: string;
  debuggingPort?: number;
  status: string;
  visibleWindow?: boolean;
  currentUrl?: string;
  lastError?: string;
  activeProfile?: boolean;
  browser?: string;
  runtimeMode?: string;
  browserReused?: boolean;
  startedAt?: string;
  lastActivityAt?: string;
};

export type AutoUploadCdpSessionsResult = {
  available: boolean;
  sessions: AutoUploadCdpBrowserSession[];
  message: string;
  checkedAt: string;
};

type AutoUploadProfileCdpProbe = {
  loginState: 'logged_in' | 'logged_out' | 'unknown';
  currentUrl?: string;
  profileDir?: string;
  debuggingPort?: number;
  browser?: string;
  runtimeMode?: string;
  browserReused?: boolean;
  lastActivityAt?: string;
};

type AutoUploadLoginQrImageCandidate = {
  src: string;
  alt?: string;
  aria?: string;
  cls?: string;
  id?: string;
  width: number;
  height: number;
  naturalWidth?: number;
  naturalHeight?: number;
  visible?: boolean;
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
  stableId?: string;
  accountName?: string;
  type: number;
  platform: string;
  platformKey?: string;
  filePath: string;
  userName: string;
  profileName?: string | null;
  avatarPath?: string | null;
  avatarUrl?: string | null;
  status: number;
  statusCode?: string;
  statusLabel: string;
  avatarUpdatedAt?: string | null;
  sessionStatus?: string;
  lastDispatchAt?: string | null;
  lastDispatchOk?: boolean | null;
  lastDispatchReason?: string | null;
};

export type AutoUploadPage<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AutoUploadOpenAccountsResult = {
  opened: number;
  openedIds?: Array<number | string>;
  openedAccounts?: Array<{
    id: number | string;
    platform: string;
    accountId: number | string;
    status?: AutoUploadCdpBrowserSession['status'];
    currentUrl?: string;
    lastError?: string;
  }>;
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
  runtimeMode?: string;
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

type AutoUploadMacWindowInfo = {
  title: string;
  owner: string;
  windowId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shareable?: boolean;
};

export type AutoUploadWechatContactAlignmentResult = {
  ok: boolean;
  stage:
    | 'aligned'
    | 'candidate_found'
    | 'search_page'
    | 'ambiguous'
    | 'contact_not_found'
    | 'wechat_missing'
    | 'wechat_not_frontmost'
    | 'desktop_permission_missing'
    | 'risk_blocked';
  targetText: string;
  searchedText?: string;
  matchedTitle?: string | null;
  windowTitle?: string | null;
  pageTextSample?: string;
  screenshotPath?: string;
  message: string;
  nextAction?: string;
  evidence?: AutoUploadInteractionEvidence | null;
  matches: Array<{ name: string; remark: string; id: string }>;
  ambiguous: boolean;
  alignedAt: string;
};

export type AutoUploadWechatDraftResult = {
  status:
    | 'draft_filled'
    | 'draft_not_ready'
    | 'wechat_missing'
    | 'desktop_permission_missing';
  message: string;
  targetText?: string;
  replyText: string;
  desktop?: AutoUploadWechatDesktopStatus;
  evidence?: AutoUploadInteractionEvidence | null;
  readbackText?: string;
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

export type AutoUploadPublishResponse = {
  reason?: string;
  taskIds?: number[];
  agentSessionId?: string;
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

export type AutoUploadUploadFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

import type { AutoUploadPublishPayload } from './auto-upload.publish.types';
export type {
  AutoUploadPublishSourceIdentity,
  AutoUploadPublishAccountIdentity,
  AutoUploadPublishPayload,
  AutoUploadPublishPlatformEntry,
  AutoUploadPublishBatchResult,
} from './auto-upload.publish.types';

@Injectable()
export class AutoUploadClient {
  private readonly logger = new Logger(AutoUploadClient.name);
  private readonly cancelledLoginRequestIds = new Set<string>();
  private readonly activeLoginSessionKeys = new Map<string, string>();
  /**
   * 账号验证冷却：openAccountForValidation 会打开浏览器+带到前台，
   * 防止高频轮询/重复校验反复拉起窗口（窗口乱跳）。默认 60s。
   */
  private readonly validationCooldownMs = 60_000;
  private readonly lastValidationAt = new Map<string, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mcp: PlaywrightMcpService,
    private readonly interactionExecutor: PlatformInteractionExecutor,
    private readonly runtime: RuntimeOrchestrator,
    private readonly browserRuntime: PlaywrightBrowserRuntimeService,
    @Optional() private readonly localBrowser?: LocalBrowserEngine,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
  ) {}

  private getKaypalDesktopScriptRoots() {
    const explicitRoot = this.configService.get<string>(
      'KAYPAL_DESKTOP_SCRIPT_ROOT',
    );
    const runtimeProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    const resourcesPath = runtimeProcess.resourcesPath || '';
    return [
      explicitRoot,
      join(process.cwd(), 'vendor', 'open-cowork-upstream', 'scripts'),
      join(process.cwd(), '..', 'vendor', 'open-cowork-upstream', 'scripts'),
      join(
        process.cwd(),
        '..',
        '..',
        'kaypal-ai',
        'vendor',
        'open-cowork-upstream',
        'scripts',
      ),
      join(
        dirname(process.cwd()),
        'kaypal-ai',
        'vendor',
        'open-cowork-upstream',
        'scripts',
      ),
      resourcesPath
        ? join(resourcesPath, 'open-cowork-upstream', 'scripts')
        : '',
      resourcesPath
        ? join(
            resourcesPath,
            'app.asar.unpacked',
            'open-cowork-upstream',
            'scripts',
          )
        : '',
    ].filter((value): value is string => Boolean(value));
  }

  private findKaypalDesktopScriptPath(scriptName: string) {
    return this.getKaypalDesktopScriptRoots()
      .map((root) => join(root, scriptName))
      .find((candidate) => existsSync(candidate));
  }

  private getKaypalDesktopScriptPath(scriptName: string) {
    const found = this.findKaypalDesktopScriptPath(scriptName);
    if (!found) {
      throw new Error(`系统内置微信桌面脚本不存在：${scriptName}`);
    }
    return found;
  }

  private resolveAgentSPythonPath() {
    const configured =
      this.configService.get<string>('KAYPAL_AGENT_S_PYTHON')?.trim() ||
      process.env.KAYPAL_AGENT_S_PYTHON?.trim() ||
      '';
    const runtimeProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    const resourcesPath = runtimeProcess.resourcesPath || '';
    const candidates = [
      configured,
      join(
        process.cwd(),
        'desktop',
        'sidecars',
        'agent-s-executor',
        '.venv',
        'bin',
        'python',
      ),
      join(
        process.cwd(),
        '..',
        '..',
        'kaypal-ai',
        'services',
        'agent-s-executor',
        '.venv',
        'bin',
        'python',
      ),
      join(
        dirname(process.cwd()),
        'kaypal-ai',
        'services',
        'agent-s-executor',
        '.venv',
        'bin',
        'python',
      ),
      resourcesPath
        ? join(resourcesPath, 'agent-s-executor', '.venv', 'bin', 'python')
        : '',
    ].filter((value): value is string => Boolean(value));
    return candidates.find((candidate) => existsSync(candidate)) || '';
  }

  private resolveWechatAppPath() {
    const configured =
      this.configService.get<string>('KAYPAL_WECHAT_APP_PATH')?.trim() ||
      process.env.KAYPAL_WECHAT_APP_PATH?.trim() ||
      '';
    return (
      [configured, '/Applications/微信.app', '/Applications/WeChat.app'].find(
        (candidate) => candidate && existsSync(candidate),
      ) ||
      configured ||
      '/Applications/微信.app'
    );
  }

  private async executeWechatDesktopScript(
    scriptName: string,
    args: string[],
    timeoutMs = 120000,
  ): Promise<Record<string, unknown>> {
    const scriptPath = this.getKaypalDesktopScriptPath(scriptName);
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: dirname(scriptPath),
        env: {
          ...process.env,
          KAYPAL_AGENT_S_PYTHON:
            this.resolveAgentSPythonPath() ||
            process.env.KAYPAL_AGENT_S_PYTHON ||
            '',
          KAYPAL_WECHAT_APP_PATH: this.resolveWechatAppPath(),
        },
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const output = stdout.trim();
    if (!output) {
      throw new Error(`${scriptName} 未返回执行结果`);
    }
    return JSON.parse(output) as Record<string, unknown>;
  }

  private async canRunAdvancedWechatScript() {
    const python = this.resolveAgentSPythonPath();
    if (!python) return false;
    try {
      await execFileAsync(
        python,
        ['-c', 'import pyautogui; from PIL import Image'],
        { timeout: 5000, maxBuffer: 1024 * 1024 },
      );
      return Boolean(
        this.findKaypalDesktopScriptPath(
          'prepare-ops-workbench-wechat-draft-live.mjs',
        ) &&
        this.findKaypalDesktopScriptPath('send-ops-workbench-wechat-live.mjs'),
      );
    } catch {
      return false;
    }
  }

  private async executeWechatDesktopCommand(
    command: string,
    args: string[],
    timeoutMs = 120000,
  ): Promise<Record<string, unknown>> {
    const commandPath = this.resolveWechatCommandPaths(command).find(
      (candidate) => existsSync(candidate),
    );
    if (!commandPath) {
      throw new Error(`微信桌面执行命令不存在：${command}`);
    }
    const commandRoot = dirname(commandPath);
    const { stdout } = await execFileAsync(commandPath, args, {
      env: {
        ...process.env,
        KAYPAL_WECHAT_COMMAND_ROOT:
          process.env.KAYPAL_WECHAT_COMMAND_ROOT || commandRoot,
        AI_CONTENT_CLICLICK_PATH:
          process.env.AI_CONTENT_CLICLICK_PATH ||
          this.resolveCliclickPath() ||
          '',
        PATH: [
          commandRoot,
          process.env.PATH || '',
          join(homedir(), '.local', 'bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
        ]
          .filter(Boolean)
          .join(':'),
      },
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = String(stdout || '').trim();
    if (!output) {
      throw new Error(`${command} 未返回执行结果`);
    }
    return JSON.parse(output) as Record<string, unknown>;
  }

  private async runAppleScript(
    lines: string[],
    timeoutMs = 5000,
  ): Promise<string> {
    const args = lines.flatMap((line) => ['-e', line]);
    const { stdout } = await execFileAsync('osascript', args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return String(stdout).trim();
  }

  private async runAppleScriptWithArgs(
    lines: string[],
    args: string[] = [],
    timeoutMs = 30000,
  ): Promise<string> {
    const osascriptArgs = [...lines.flatMap((line) => ['-e', line]), ...args];
    const { stdout } = await execFileAsync('osascript', osascriptArgs, {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout).trim();
  }

  private async readWechatMacProcess(processName: 'WeChat' | '微信'): Promise<{
    appName: string;
    running: boolean;
    frontmost: boolean;
    windowTitles: string[];
    permissionHints: string[];
  } | null> {
    const exists = await this.runAppleScript([
      `tell application "System Events" to exists process "${processName}"`,
    ]);
    if (!/^true$/i.test(exists)) {
      return null;
    }

    const permissionHints: string[] = [];
    const [frontmostOutput, windowOutput] = await Promise.all([
      this.runAppleScript([
        `tell application "System Events" to tell process "${processName}" to get frontmost`,
      ]).catch((error) => {
        permissionHints.push(
          `读取微信前台状态失败：${
            error instanceof Error ? error.message : '未知错误'
          }`,
        );
        return 'false';
      }),
      this.runAppleScript([
        'tell application "System Events"',
        `tell process "${processName}"`,
        'set titleList to {}',
        'repeat with appWindow in windows',
        'set candidateTitle to ""',
        'try',
        'set candidateTitle to name of appWindow as text',
        'end try',
        'if candidateTitle is "" then try',
        'set candidateTitle to title of appWindow as text',
        'end try',
        'if candidateTitle is "" then try',
        'set candidateTitle to description of appWindow as text',
        'end try',
        'if candidateTitle is not "" then set end of titleList to candidateTitle',
        'end repeat',
        "set AppleScript's text item delimiters to linefeed",
        'return titleList as text',
        'end tell',
        'end tell',
      ]).catch((error) => {
        permissionHints.push(
          `读取微信窗口列表失败：${
            error instanceof Error ? error.message : '未知错误'
          }`,
        );
        return '';
      }),
    ]);

    const windowTitles = windowOutput
      .split(/\r?\n/)
      .map((title) => title.trim())
      .filter(Boolean);

    return {
      appName: processName,
      running: true,
      frontmost: /^true$/i.test(frontmostOutput),
      windowTitles,
      permissionHints,
    };
  }

  private async listMacWechatWindows(): Promise<AutoUploadMacWindowInfo[]> {
    if (osPlatform() !== 'darwin') return [];
    const swiftSource = [
      'import Foundation',
      'import CoreGraphics',
      'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
      'for window in windows {',
      '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
      '  let title = window[kCGWindowName as String] as? String ?? ""',
      '  guard owner.contains("微信") || owner.contains("WeChat") || title.contains("微信") || title.contains("WeChat") else { continue }',
      '  let layer = window[kCGWindowLayer as String] as? Int ?? 0',
      '  guard layer == 0 else { continue }',
      '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
      '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? 0))',
      '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? 0))',
      '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? 0))',
      '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? 0))',
      '  guard width >= 240 && height >= 240 else { continue }',
      '  let windowId = window[kCGWindowNumber as String] as? Int ?? 0',
      '  let sharing = window[kCGWindowSharingState as String] as? Int ?? -1',
      '  let safeOwner = owner.replacingOccurrences(of: "\\t", with: " ").replacingOccurrences(of: "\\n", with: " ")',
      '  let safeTitle = title.replacingOccurrences(of: "\\t", with: " ").replacingOccurrences(of: "\\n", with: " ")',
      '  print([safeTitle, safeOwner, String(windowId), String(x), String(y), String(width), String(height), sharing > 0 ? "shareable" : "blocked"].joined(separator: "\\t"))',
      '}',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync('swift', ['-e', swiftSource], {
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return String(stdout || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, owner, windowId, x, y, width, height, shareable] =
            line.split('\t');
          return {
            title: title?.trim() || owner?.trim() || '微信',
            owner: owner?.trim() || '微信',
            windowId: Number.parseInt(windowId || '', 10) || 0,
            x: Number.parseInt(x || '', 10) || 0,
            y: Number.parseInt(y || '', 10) || 0,
            width: Number.parseInt(width || '', 10) || 0,
            height: Number.parseInt(height || '', 10) || 0,
            shareable:
              shareable === 'blocked'
                ? false
                : shareable === 'shareable'
                  ? true
                  : undefined,
          };
        })
        .filter(
          (window) =>
            window.windowId > 0 && window.width > 0 && window.height > 0,
        )
        .sort((a, b) => {
          const rank = (window: AutoUploadMacWindowInfo) => {
            if (/^(微信|WeChat)( \(窗口\))?$/.test(window.title)) return 4;
            if (window.title === window.owner) return 1;
            if (/微信|WeChat/.test(window.title)) return 2;
            return 0;
          };
          const rankA = rank(a);
          const rankB = rank(b);
          const shareableA = a.shareable === false ? 0 : 1;
          const shareableB = b.shareable === false ? 0 : 1;
          return (
            rankB - rankA ||
            shareableB - shareableA ||
            b.width * b.height - a.width * a.height
          );
        });
    } catch {
      return [];
    }
  }

  private resolveWechatCommandPaths(command: string) {
    const explicitRoot =
      this.configService.get<string>('KAYPAL_WECHAT_COMMAND_ROOT')?.trim() ||
      process.env.KAYPAL_WECHAT_COMMAND_ROOT?.trim() ||
      '';
    const runtimeProcess = process as NodeJS.Process & {
      resourcesPath?: string;
    };
    const resourcesPath = runtimeProcess.resourcesPath || '';
    return [
      explicitRoot ? join(explicitRoot, command) : '',
      // 打包后：resources/wechat-macos/bin（mac）或 resources/wechat-macos/bin（win 共享布局）
      resourcesPath
        ? join(resourcesPath, 'wechat-macos', 'bin', command)
        : '',
      // 打包后：resources/open-cowork-upstream/scripts（自动回复 mjs 脚本同目录可执行命令）
      resourcesPath
        ? join(resourcesPath, 'open-cowork-upstream', 'scripts', command)
        : '',
      join(process.cwd(), 'desktop', 'runtime', 'wechat-macos', 'bin', command),
      join(
        process.cwd(),
        '..',
        'desktop',
        'runtime',
        'wechat-macos',
        'bin',
        command,
      ),
      join(homedir(), '.local', 'bin', command),
      join('/opt/homebrew/bin', command),
      join('/usr/local/bin', command),
    ].filter(Boolean);
  }

  private resolveCliclickPath() {
    return (
      [
        this.configService.get<string>('AI_CONTENT_CLICLICK_PATH')?.trim() ||
          '',
        process.env.AI_CONTENT_CLICLICK_PATH?.trim() || '',
        ...this.resolveWechatCommandPaths('cliclick'),
        '/opt/homebrew/bin/cliclick',
        '/usr/local/bin/cliclick',
      ].find((candidate) => candidate && existsSync(candidate)) || ''
    );
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
    const evidenceStatus = this.collectInteractionEvidenceCleanup(
      7,
      false,
    ).status;
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
          evidence: [
            'runtime_executions',
            'interaction_tasks',
            'browser_snapshot',
          ],
        },
        {
          key: 'DOUYIN_DIRECT_MESSAGE_REPLY',
          platformType: 3,
          platformName: '抖音',
          entryType: 'douyin:message',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: [
            'runtime_executions',
            'interaction_tasks',
            'browser_snapshot',
          ],
        },
        {
          key: 'WECHAT_CHANNEL_COMMENT_REPLY',
          platformType: 2,
          platformName: '视频号',
          entryType: 'wechat-channel:comment',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: [
            'runtime_executions',
            'interaction_tasks',
            'browser_snapshot',
          ],
        },
        {
          key: 'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
          platformType: 2,
          platformName: '视频号',
          entryType: 'wechat-channel:message',
          stages: ['open', 'read', 'draft', 'send', 'readback'],
          controlledSend: true,
          autoSend: true,
          evidence: [
            'runtime_executions',
            'interaction_tasks',
            'browser_snapshot',
          ],
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
        browserAutomation:
          status.visibleWindow && !status.isolated
            ? 'local-browser-engine visible persistent profile'
            : 'local-browser-engine not commercial-ready',
        sendPolicy: 'default auto-send; controlled by task policy',
        pathAccess: [evidenceStatus.directory, this.getLocalMaterialDir()],
      },
    };
  }

  async getCdpSessions(): Promise<AutoUploadCdpSessionsResult> {
    const ownerScope = await this.resolvePublishOwnerScope();
    const status = await this.interactionExecutor.getStatus();
    const rows = await this.prisma.publishAccount.findMany({
      where: ownerScope,
      orderBy: { createdAt: 'asc' },
    });
    const activeSessions = this.interactionExecutor.listSessions();
    const recentInteractionTasks = await this.prisma.interactionTask.findMany({
      where: {
        ...ownerScope,
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
    const sessions: AutoUploadCdpBrowserSession[] = [];
    for (const row of rows) {
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
      const runtimeReady =
        status.online && status.visibleWindow && !status.isolated;
      const activeSession = activeSessions.find(
        (session) =>
          session.platform === row.platform &&
          String(session.accountId) === String(engineAccountId),
      );
      const profileCdpSession = !activeSession
        ? await this.withTimedResult(
            this.inspectProfileCdpLoginState(
              row.platform,
              String(engineAccountId),
              accountArtifacts.profileDir,
            ),
            null,
            `CDP profile 登录态读取超时 ${row.platform}:${String(engineAccountId)}`,
            6000,
          )
        : null;
      let currentUrl =
        activeSession?.currentUrl ?? profileCdpSession?.currentUrl;
      const activePageProbeAvailable = Boolean(
        activeSession &&
        typeof this.localBrowser?.getSession === 'function' &&
        this.localBrowser.getSession(
          `${row.platform}-${String(engineAccountId)}`,
        )?.page,
      );
      let currentPageLoginState = activeSession
        ? await this.withTimedResult(
            this.inspectActiveSessionLoginState(
              row.platform,
              String(engineAccountId),
            ),
            'unknown',
            `CDP 当前页登录态读取超时 ${row.platform}:${String(engineAccountId)}`,
            5000,
          )
        : (profileCdpSession?.loginState ?? null);
      if (
        activeSession &&
        (currentPageLoginState === 'logged_out' ||
          this.isLoginPageUrl(currentUrl)) &&
        typeof this.localBrowser?.recoverAccountSessionFromSavedCookies ===
          'function'
      ) {
        const recovered = await this.withTimedResult(
          this.localBrowser.recoverAccountSessionFromSavedCookies({
            platform: this.resolvePlatformSlugFromString(row.platform),
            accountId: engineAccountId,
            targetUrl: this.resolvePlatformHomeUrl(row.platform),
          }),
          null,
          `CDP 当前页登录态恢复超时 ${row.platform}:${String(engineAccountId)}`,
          10000,
        );
        if (recovered) {
          currentUrl = recovered.page.url();
          currentPageLoginState = await this.withTimedResult(
            this.inspectActiveSessionLoginState(
              row.platform,
              String(engineAccountId),
            ),
            'unknown',
            `CDP 当前页恢复后登录态读取超时 ${row.platform}:${String(engineAccountId)}`,
            5000,
          );
        }
      }
      const latestInteractionTask = this.findLatestInteractionTaskForAccount(
        recentInteractionTasks,
        row.platform,
        [row.id, engineAccountId],
      );
      const pageNeedsLogin =
        currentPageLoginState === 'logged_out' ||
        this.isLoginPageUrl(currentUrl);
      const currentUrlIsPlatformPage =
        currentUrl != null && this.isPlatformPageUrl(row.platform, currentUrl);
      const currentPageLoggedIn = currentPageLoginState === 'logged_in';
      const allowsPlatformUrlReadinessFallback = true;
      const sessionProvesPlatformReady =
        currentPageLoggedIn ||
        (allowsPlatformUrlReadinessFallback &&
          (activeSession || profileCdpSession) &&
          !pageNeedsLogin &&
          currentUrlIsPlatformPage) ||
        (allowsPlatformUrlReadinessFallback &&
          !activePageProbeAvailable &&
          currentPageLoginState === 'unknown' &&
          activeSession?.status === 'ready' &&
          currentUrlIsPlatformPage);
      const sessionLastActivityAt =
        activeSession?.lastActivityAt ?? profileCdpSession?.lastActivityAt;
      const latestTaskNeedsLogin =
        !currentPageLoggedIn &&
        this.isRecentInteractionLoginBlocker(latestInteractionTask) &&
        (!currentUrl ||
          pageNeedsLogin ||
          !currentUrlIsPlatformPage ||
          this.isTaskNewerThanSessionActivity(
            latestInteractionTask,
            sessionLastActivityAt,
          ));
      const needsLogin = pageNeedsLogin || latestTaskNeedsLogin;
      const sessionStatus = (() => {
        // runtimeReady 是浏览器引擎基础设施状态（online/visible/isolated），
        // 其瞬时未就绪 ≠ 账号登录态失败。改判 unknown 避免引擎抖动时整页误报
        // "全部 blocked"；真正账号级 blocked 由 CDP 显式 status==='blocked' 经
        // mapCdpSessionToAccountSessionStatus 走 error 分支，不受此处影响。
        if (!runtimeReady) return 'unknown';
        if (needsLogin) return 'needs_login';
        if (sessionProvesPlatformReady) return 'ready';
        if (!activeSession && !profileCdpSession) return 'unknown';
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
        if (sessionProvesPlatformReady) {
          return undefined;
        }
        if (!accountReady) {
          return '未找到 cookiesFile 或持久浏览器 profile 登录态';
        }
        if (!activeSession && !profileCdpSession) {
          return undefined;
        }
        if (!currentUrlIsPlatformPage) {
          return currentUrl
            ? '当前 CDP 页面不在平台后台，尚未确认平台登录态'
            : 'CDP 会话尚未返回平台页面地址，尚未确认平台登录态';
        }
        if (profileCdpSession) {
          return 'CDP 页面已打开，但尚未确认平台登录态';
        }
        return undefined;
      })();
      const activeProfile =
        activeSession != null ||
        profileCdpSession != null ||
        accountArtifacts.hasPersistentLoginState;
      sessions.push({
        platform: row.platform,
        accountId: engineAccountId,
        sourceAccountId: activeSession?.sourceAccountId,
        profileDir:
          activeSession?.profileDir ||
          profileCdpSession?.profileDir ||
          accountArtifacts.profileDir,
        status: sessionStatus,
        visibleWindow: runtimeReady,
        currentUrl,
        lastError: sessionLastError,
        activeProfile,
        browser:
          activeSession?.browser ||
          profileCdpSession?.browser ||
          'local-browser-engine',
        debuggingPort:
          activeSession?.debuggingPort ?? profileCdpSession?.debuggingPort,
        runtimeMode:
          activeSession?.runtimeMode ||
          profileCdpSession?.runtimeMode ||
          'persistent-cdp-browser',
        browserReused:
          activeSession?.browserReused ?? profileCdpSession?.browserReused,
        lastActivityAt: sessionLastActivityAt,
        startedAt: new Date().toISOString(),
      });
    }
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
      currentStepMessage?: string;
    };
    const text = [config.failureReason, config.currentStepMessage]
      .filter(Boolean)
      .join('\n');
    if (/入口未打开|首页卡片文案|未出现视频号(?:评论|私信)业务区/.test(text)) {
      return false;
    }
    return this.containsExplicitLoginBlockSignal(text);
  }

  private isTaskNewerThanSessionActivity(
    task: { updatedAt: Date } | null,
    lastActivityAt?: string | null,
  ) {
    if (!task || !lastActivityAt) {
      return true;
    }
    const sessionTime = Date.parse(lastActivityAt);
    if (!Number.isFinite(sessionTime)) {
      return true;
    }
    return task.updatedAt.getTime() >= sessionTime;
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
    if (platform === 'xiaohongshu') {
      return this.isXiaohongshuBackendUrl(currentUrl);
    }
    if (platform === 'kuaishou') {
      return currentUrl.includes('cp.kuaishou.com');
    }
    if (platform === 'bilibili') {
      return currentUrl.includes('member.bilibili.com');
    }
    return false;
  }

  private isPlatformPageUrl(platform: string, currentUrl: string): boolean {
    if (!currentUrl) return false;
    if (this.isLoginPageUrl(currentUrl)) return false;
    if (platform === 'douyin') {
      return currentUrl.includes('creator.douyin.com');
    }
    if (platform === 'wechat-channel') {
      return this.isWechatChannelBackendUrl(currentUrl);
    }
    if (platform === 'xiaohongshu') {
      return this.isXiaohongshuBackendUrl(currentUrl);
    }
    if (platform === 'kuaishou') {
      return currentUrl.includes('cp.kuaishou.com');
    }
    if (platform === 'bilibili') {
      return currentUrl.includes('member.bilibili.com');
    }
    return this.isInteractionEntryUrl(platform, currentUrl);
  }

  private resolvePlatformHomeUrl(platform: string): string {
    if (platform === 'douyin') return 'https://creator.douyin.com/';
    if (platform === 'wechat-channel') return 'https://channels.weixin.qq.com/';
    if (platform === 'xiaohongshu') return 'https://creator.xiaohongshu.com/';
    if (platform === 'kuaishou') return 'https://cp.kuaishou.com/';
    if (platform === 'bilibili') return 'https://member.bilibili.com/';
    return 'about:blank';
  }

  private isLoginPageUrl(url?: string | null) {
    return /login|signin|passport/i.test(url || '');
  }

  private normalizePageText(text: string): string {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isWechatChannelBackendUrl(url?: string | null): boolean {
    return /channels\.weixin\.qq\.com\/(?:platform|micro)(?:[/?#]|$)/.test(
      url || '',
    );
  }

  private isWechatChannelMarketingLandingText(text: string): boolean {
    const normalizedText = this.normalizePageText(text);
    return (
      /一站式服务/.test(normalizedText) &&
      /让创作更简单|多人运营|内容管理|互动管理|数据中心|认证管理/.test(
        normalizedText,
      ) &&
      !/发表记录|评论管理|私信管理|数据概览|创作管理|发布视频|创建直播|作品管理|全部私信|打招呼消息/.test(
        normalizedText,
      )
    );
  }

  private isWechatChannelAuthenticatedPage(
    url?: string | null,
    text = '',
  ): boolean {
    const normalizedText = this.normalizePageText(text);
    const isBackendUrl = this.isWechatChannelBackendUrl(url);
    const isChannelUrl = /channels\.weixin\.qq\.com(?:[/?#]|$)/.test(url || '');
    if (!isBackendUrl && !isChannelUrl) return false;
    if (this.isLoginPageUrl(url)) return false;
    if (this.isWechatChannelMarketingLandingText(normalizedText)) return false;
    if (
      /扫码登录|验证码登录|密码登录|账号登录|登录后|请先登录|未登录|二维码|微信扫一扫/.test(
        normalizedText,
      )
    ) {
      return false;
    }
    if (isBackendUrl) return true;
    return /发表记录|评论管理|私信管理|数据概览|创作管理|发布视频|创建直播|作品管理|全部私信|全部消息|打招呼消息/.test(
      normalizedText,
    );
  }

  private isXiaohongshuBackendUrl(url?: string | null): boolean {
    return /creator\.xiaohongshu\.com\/new(?:[/?#]|$)/.test(url || '');
  }

  private isXiaohongshuAuthenticatedPage(
    url?: string | null,
    text = '',
  ): boolean {
    const normalizedText = this.normalizePageText(text);
    if (!this.isXiaohongshuBackendUrl(url)) return false;
    if (this.isLoginPageUrl(url)) return false;
    if (
      /手机号登录|扫码登录|验证码登录|密码登录|登录\/注册|登录或注册|登录后|请先登录|未登录|二维码|扫一扫/.test(
        normalizedText,
      )
    ) {
      return false;
    }
    return /小红书创作服务平台|创作服务平台|笔记管理|发布笔记|数据中心|账号设置|服务市场|技能中心|蒲公英|素材中心/.test(
      normalizedText,
    );
  }

  private containsLoginRequiredSignal(text: string) {
    return /未登录|重新登录|登录态|登录失效|登录过期|请先登录|扫码登录|验证码登录|密码登录|登录\/注册|打开「抖音APP」|passport|signin|login required/i.test(
      text,
    );
  }

  private containsExplicitLoginBlockSignal(text: string) {
    const value = String(text || '');
    if (!value.trim()) return false;
    if (
      /检查.+是否.+(?:登录|重新登录|登录态)|是否要求重新登录|可能(?:未登录|登录失效)|请检查.+登录/.test(
        value,
      )
    ) {
      return false;
    }
    return /账号未登录|未登录或已失效|登录态(?:已)?失效|登录失效|登录过期|需要重新登录|请先登录|扫码登录|验证码登录|密码登录|平台页面要求重新登录|passport|signin|login required/i.test(
      value,
    );
  }

  private async inspectActiveSessionLoginState(
    platform: string,
    accountId: string,
  ): Promise<'logged_in' | 'logged_out' | 'unknown'> {
    const session =
      typeof this.localBrowser?.getSession === 'function'
        ? this.localBrowser.getSession(`${platform}-${accountId}`)
        : undefined;
    const page = session?.page;
    if (!page) {
      return 'unknown';
    }
    try {
      const state = await Promise.race<{
        url: string;
        text: string;
      } | null>([
        page.evaluate(() => {
          const normalize = (value: unknown) =>
            (typeof value === 'string'
              ? value
              : value == null
                ? ''
                : (JSON.stringify(value) ?? '')
            )
              .replace(/\s+/g, ' ')
              // eslint-disable-next-line no-misleading-character-class -- 故意清洗零宽不可见字符（ZWSP/ZWJ/LRM/BOM）
              .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
              .trim();
          return {
            url: location.href,
            text: normalize(document.body ? document.body.innerText : '').slice(
              0,
              2000,
            ),
          };
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!state) {
        return 'unknown';
      }
      if (
        this.isLoginPageUrl(state.url) ||
        this.containsLoginRequiredSignal(state.text) ||
        (platform === 'xiaohongshu' &&
          !this.isXiaohongshuAuthenticatedPage(state.url, state.text))
      ) {
        return 'logged_out';
      }
      if (
        platform === 'wechat-channel' &&
        this.isWechatChannelAuthenticatedPage(state.url, state.text)
      ) {
        return 'logged_in';
      }
      if (
        platform === 'wechat-channel' &&
        /channels\.weixin\.qq\.com(?:[/?#]|$)/.test(state.url)
      ) {
        return 'logged_out';
      }
      if (
        platform === 'xiaohongshu' &&
        this.isXiaohongshuAuthenticatedPage(state.url, state.text)
      ) {
        return 'logged_in';
      }
      if (this.isPlatformPageUrl(platform, state.url)) {
        return 'logged_in';
      }
    } catch {
      return 'unknown';
    }
    return 'unknown';
  }

  private async inspectProfileCdpLoginState(
    platform: string,
    accountId: string,
    profileDir: string,
  ): Promise<AutoUploadProfileCdpProbe | null> {
    const ports = this.findCdpPortsUsingProfile(profileDir);
    for (const port of ports) {
      if (!(await this.isCdpResponding(port))) {
        continue;
      }
      try {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
        );
        try {
          const pages = browser
            .contexts()
            .flatMap((context) => context.pages());
          const page =
            pages.find((candidate) =>
              this.isPlatformPageUrl(platform, candidate.url()),
            ) ??
            pages.find((candidate) =>
              this.isInteractionEntryUrl(platform, candidate.url()),
            ) ??
            pages.find((candidate) => candidate.url() !== 'about:blank') ??
            pages[0];
          if (!page) {
            continue;
          }
          const state = await Promise.race<{
            url: string;
            text: string;
            title: string;
          } | null>([
            page.evaluate(() => {
              const normalize = (value: unknown) =>
                (typeof value === 'string'
                  ? value
                  : value == null
                    ? ''
                    : (JSON.stringify(value) ?? '')
                )
                  .replace(/\s+/g, ' ')
                  // eslint-disable-next-line no-misleading-character-class -- 故意清洗零宽不可见字符（ZWSP/ZWJ/LRM/BOM）
                  .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
                  .trim();
              return {
                url: location.href,
                title: document.title || '',
                text: normalize(
                  document.body ? document.body.innerText : '',
                ).slice(0, 2500),
              };
            }),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 3000),
            ),
          ]);
          if (!state) {
            return {
              loginState: 'unknown',
              currentUrl: page.url(),
              profileDir,
              debuggingPort: port,
              browser: 'local-browser-engine',
              runtimeMode: 'persistent-cdp-browser',
              browserReused: true,
              lastActivityAt: new Date().toISOString(),
            };
          }
          const text = `${state.title}\n${state.text}`;
          const loginState =
            this.isLoginPageUrl(state.url) ||
            this.containsLoginRequiredSignal(text) ||
            (platform === 'xiaohongshu' &&
              !this.isXiaohongshuAuthenticatedPage(state.url, text))
              ? 'logged_out'
              : platform === 'wechat-channel'
                ? this.isWechatChannelAuthenticatedPage(state.url, text)
                  ? 'logged_in'
                  : /channels\.weixin\.qq\.com(?:[/?#]|$)/.test(state.url)
                    ? 'logged_out'
                    : 'unknown'
                : platform === 'xiaohongshu'
                  ? this.isXiaohongshuAuthenticatedPage(state.url, text)
                    ? 'logged_in'
                    : 'unknown'
                  : this.isPlatformPageUrl(platform, state.url)
                    ? 'logged_in'
                    : 'unknown';
          return {
            loginState,
            currentUrl: state.url,
            profileDir,
            debuggingPort: port,
            browser: 'local-browser-engine',
            runtimeMode: 'persistent-cdp-browser',
            browserReused: true,
            lastActivityAt: new Date().toISOString(),
          };
        } finally {
          await browser.close().catch(() => undefined);
        }
      } catch (error) {
        this.logger.debug(
          `CDP profile 登录态探测失败 ${platform}:${accountId}@${port}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return null;
  }

  private findCdpPortsUsingProfile(profileDir: string): number[] {
    if (!profileDir || osPlatform() === 'win32') return [];
    try {
      const output = execFileSync('ps', ['ax', '-o', 'command='], {
        encoding: 'utf8',
      });
      const normalizedProfile = profileDir.replace(/\/+$/, '');
      const ports = new Set<number>();
      for (const line of output.split('\n')) {
        if (!line.includes(normalizedProfile)) continue;
        const match = line.match(/--remote-debugging-port=(\d+)/);
        if (!match) continue;
        const port = Number(match[1]);
        if (Number.isFinite(port)) ports.add(port);
      }
      return [...ports];
    } catch {
      return [];
    }
  }

  private async isCdpResponding(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return false;
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      return Boolean(data.webSocketDebuggerUrl);
    } catch {
      return false;
    }
  }

  previewInteractionEvidenceCleanup(
    retentionDays = 7,
  ): AutoUploadInteractionEvidenceCleanupResult {
    return this.collectInteractionEvidenceCleanup(retentionDays, false);
  }

  cleanupInteractionEvidence(
    retentionDays = 7,
  ): AutoUploadInteractionEvidenceCleanupResult {
    return this.collectInteractionEvidenceCleanup(retentionDays, true);
  }

  async listAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }): Promise<AutoUploadAccount[]> {
    const ownerScope = await this.resolvePublishOwnerScope();
    const idFilter = options?.ids?.length
      ? options.ids.map((id) => String(id)).filter((id) => id.length > 0)
      : null;
    await this.restoreDesktopRuntimePublishAccountsIfNeeded();
    const rows = await this.prisma.publishAccount.findMany({
      where: {
        ...ownerScope,
        ...(idFilter ? { id: { in: idFilter } } : {}),
      },
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
          where: ownerScope,
          orderBy: { createdAt: 'asc' },
        });
        filtered = all.filter((row) => {
          const cfg = (row.config ?? {}) as { engineAccountId?: number };
          return (
            idFilter.includes(row.id) ||
            (typeof cfg.engineAccountId === 'number' &&
              intIds.includes(cfg.engineAccountId))
          );
        });
      }
    }

    const uniqueRows = this.dedupePublishAccountRows(filtered);
    const validatedRows = options?.validate
      ? await this.validatePublishAccountRows(uniqueRows)
      : uniqueRows;
    const effectiveRows = options?.validate
      ? await this.applyRecentPublishLoginBlocks(validatedRows)
      : validatedRows;

    return effectiveRows.map((row) =>
      this.mapPublishAccountToAutoUploadAccount(row),
    );
  }

  private dedupePublishAccountRows<
    T extends {
      id: string;
      platform: string;
      config: unknown;
      status?: string | null;
      updatedAt?: Date | string | null;
    },
  >(rows: T[]): T[] {
    const rowsByAccount = new Map<string, T>();
    for (const row of rows) {
      const config = (row.config ?? {}) as {
        engineAccountId?: number | string;
      };
      const accountId =
        config.engineAccountId == null
          ? row.id
          : String(config.engineAccountId);
      const platform = this.resolvePlatformSlugFromString(row.platform);
      const key = `${platform}:${accountId}`;
      const existing = rowsByAccount.get(key);
      if (
        !existing ||
        this.publishAccountRowScore(row) >=
          this.publishAccountRowScore(existing)
      ) {
        rowsByAccount.set(key, row);
      }
    }
    return Array.from(rowsByAccount.values());
  }

  private publishAccountRowScore(row: {
    status?: string | null;
    config: unknown;
    updatedAt?: Date | string | null;
  }) {
    const cfg = (row.config ?? {}) as {
      status?: string;
      sessionStatus?: string;
      lastDispatchOk?: boolean;
    };
    const status = String(cfg.status || row.status || '').toLowerCase();
    const sessionStatus = String(cfg.sessionStatus || '').toLowerCase();
    const readyScore = status === 'ready' ? 30 : status === 'expired' ? -10 : 0;
    const sessionScore =
      sessionStatus === 'logged_in'
        ? 50
        : sessionStatus === 'unknown'
          ? 10
          : sessionStatus === 'needs_login'
            ? -20
            : 0;
    const dispatchScore =
      cfg.lastDispatchOk === true ? 20 : cfg.lastDispatchOk === false ? -10 : 0;
    const updatedAt =
      row.updatedAt instanceof Date
        ? row.updatedAt.getTime()
        : row.updatedAt
          ? new Date(row.updatedAt).getTime()
          : 0;
    return (
      readyScore +
      sessionScore +
      dispatchScore +
      (Number.isFinite(updatedAt) ? updatedAt / 1e15 : 0)
    );
  }

  async listAccountPage(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }): Promise<AutoUploadPage<AutoUploadAccount>> {
    const page = Math.max(1, Math.floor(options.page || 1));
    const pageSize = Math.max(
      1,
      Math.min(100, Math.floor(options.pageSize || 20)),
    );
    const search = options.search?.trim().toLocaleLowerCase() || '';
    const accounts = await this.listAccounts(options);
    const filtered = search
      ? accounts.filter((account) =>
          [
            account.stableId,
            account.accountName,
            account.platform,
            account.platformKey,
            account.statusLabel,
            account.statusCode,
          ].some((value) =>
            String(value || '')
              .toLocaleLowerCase()
              .includes(search),
          ),
        )
      : accounts;
    const start = (page - 1) * pageSize;

    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    };
  }

  async hasAccountAvatar(filename: string) {
    const ownerScope = await this.resolvePublishOwnerScope();
    const rows = await this.prisma.publishAccount.findMany({
      where: ownerScope,
      select: { config: true },
    });
    return rows.some((row) => {
      const value = ((row.config ?? {}) as { avatarPath?: unknown }).avatarPath;
      const avatarPath = (typeof value === 'string' ? value : '').replace(
        /\\/g,
        '/',
      );
      return avatarPath.split('/').filter(Boolean).pop() === filename;
    });
  }

  private async restoreDesktopRuntimePublishAccountsIfNeeded() {
    const ownerScope = await this.resolvePublishOwnerScope();
    if (typeof this.prisma.publishAccount.count !== 'function') return;
    const existing = await this.prisma.publishAccount
      .count({ where: ownerScope })
      .catch(() => 0);
    if (existing > 0) return;

    const rows = this.dedupeDesktopRuntimePublishAccountRows(
      this.readDesktopRuntimePublishAccounts(),
    );
    if (!rows.length) return;

    let restored = 0;
    for (const row of rows) {
      const legacyId = row.id ?? '';
      // 旧格式：local-engine-{n}-{platform}[-{ownerKey12}]；platform 可含连字符（wechat-channel）
      const legacyMatch = /^local-engine-(\d+)-(.+)$/.exec(String(legacyId));
      const legacyPlatform = legacyMatch
        ? legacyMatch[2].replace(/-[a-f0-9]{12}$/, '')
        : '';
      const scopedId =
        legacyMatch && legacyPlatform
          ? localEnginePublishAccountId({
              engineAccountId: Number(legacyMatch[1]),
              platform: legacyPlatform,
              scope: ownerScope,
            })
          : this.scopedPublishAccountId(row.id, ownerScope);
      await this.prisma.publishAccount
        .upsert({
          where: { id: scopedId },
          create: {
            id: scopedId,
            ...ownerScope,
            platform: row.platform,
            name: row.name,
            status: row.status ?? 'ready',
            appId: row.appId ?? undefined,
            apiToken: row.apiToken ?? undefined,
            config: row.config as object,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
          update: {
            platform: row.platform,
            name: row.name,
            status: row.status ?? 'ready',
            appId: row.appId ?? undefined,
            apiToken: row.apiToken ?? undefined,
            config: row.config as object,
            updatedAt: row.updatedAt,
          },
        })
        .then(() => {
          restored += 1;
        });
    }

    if (restored > 0) {
      this.logger.log(`已从桌面 runtime 库恢复 ${restored} 个发布账号`);
    }
  }

  private dedupeDesktopRuntimePublishAccountRows(rows: PublishAccountRow[]) {
    const bestByAccount = new Map<string, PublishAccountRow>();
    for (const row of rows) {
      if (!this.isRestorableDesktopRuntimePublishAccount(row)) continue;
      const key = this.desktopRuntimePublishAccountKey(row);
      const existing = bestByAccount.get(key);
      if (
        !existing ||
        this.desktopRuntimePublishAccountScore(row) >
          this.desktopRuntimePublishAccountScore(existing)
      ) {
        bestByAccount.set(key, row);
      }
    }
    return Array.from(bestByAccount.values());
  }

  private desktopRuntimePublishAccountKey(row: PublishAccountRow) {
    const cfg = (row.config ?? {}) as { engineAccountId?: number };
    return `${this.resolvePlatformSlugFromString(row.platform)}:${cfg.engineAccountId}`;
  }

  private desktopRuntimePublishAccountScore(row: PublishAccountRow) {
    const cfg = (row.config ?? {}) as {
      status?: string;
      sessionStatus?: string;
      lastDispatchOk?: boolean;
    };
    const status = row.status || cfg.status;
    const readyScore = status === 'ready' ? 30 : 0;
    const sessionScore =
      cfg.sessionStatus === 'logged_in'
        ? 50
        : cfg.sessionStatus === 'needs_login'
          ? -20
          : 0;
    const dispatchScore =
      cfg.lastDispatchOk === true ? 20 : cfg.lastDispatchOk === false ? -10 : 0;
    const updatedAt = row.updatedAt?.getTime() || 0;
    return readyScore + sessionScore + dispatchScore + updatedAt / 1e15;
  }

  private isRestorableDesktopRuntimePublishAccount(row: PublishAccountRow) {
    const cfg = (row.config ?? {}) as {
      source?: string;
      platformType?: number;
      filePath?: string;
      engineAccountId?: number;
    };
    return (
      row.id.length > 0 &&
      row.platform.length > 0 &&
      row.name.length > 0 &&
      cfg.source === 'local-engine' &&
      typeof cfg.platformType === 'number' &&
      typeof cfg.filePath === 'string' &&
      cfg.filePath.trim().length > 0 &&
      typeof cfg.engineAccountId === 'number'
    );
  }

  private readDesktopRuntimePublishAccounts(): PublishAccountRow[] {
    const runtimeDb = this.resolveDesktopRuntimeDatabaseFile();
    const currentDb = this.resolveCurrentSqliteDatabaseFile();
    if (!runtimeDb || !existsSync(runtimeDb)) return [];
    if (currentDb && resolve(currentDb) === resolve(runtimeDb)) return [];
    const sqliteCli = this.resolveSqliteCliPath();
    if (!sqliteCli) {
      this.logger.warn('未找到 sqlite3，无法恢复桌面 runtime 发布账号');
      return [];
    }

    try {
      const raw = execFileSync(
        sqliteCli,
        [
          '-json',
          runtimeDb,
          'select id, platform, name, app_id as appId, api_token as apiToken, config, created_at as createdAt, updated_at as updatedAt from publish_accounts order by created_at asc;',
        ],
        { encoding: 'utf8', timeout: 10000 },
      );
      const parsed: unknown = JSON.parse(raw || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => this.normalizeDesktopRuntimePublishAccount(item))
        .filter((item): item is PublishAccountRow => Boolean(item));
    } catch (error) {
      this.logger.warn(
        `恢复桌面 runtime 发布账号失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private normalizeDesktopRuntimePublishAccount(
    item: unknown,
  ): PublishAccountRow | null {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const id = this.optionalString(row.id);
    const platform = this.optionalString(row.platform);
    const name = this.optionalString(row.name);
    if (!id || !platform || !name) return null;

    return {
      id,
      platform,
      name,
      appId: this.optionalString(row.appId),
      apiToken: this.optionalString(row.apiToken),
      config: this.parseJsonField(row.config),
      createdAt: this.parseDateField(row.createdAt),
      updatedAt: this.parseDateField(row.updatedAt),
    };
  }

  private parseJsonField(value: unknown) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value.trim()) return {};
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private parseDateField(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      const date =
        Number.isFinite(numeric) && /^\d+$/.test(value)
          ? new Date(numeric)
          : new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private resolveCurrentSqliteDatabaseFile() {
    return this.sqliteFileFromUrl(
      process.env.SQLITE_DATABASE_URL || process.env.DATABASE_URL || '',
    );
  }

  private resolveDesktopRuntimeDatabaseFile() {
    const explicit =
      this.configService.get<string>('KAYPAL_DESKTOP_RUNTIME_DATABASE') ||
      process.env.KAYPAL_DESKTOP_RUNTIME_DATABASE ||
      process.env.KAYPAL_DESKTOP_RUNTIME_DATABASE_FILE;
    const candidates = [
      explicit,
      this.resolveDefaultDesktopRuntimeDatabaseFile(),
      join(
        this.getProjectRoot(),
        'backend',
        'prisma',
        'data',
        'sqlite-runtime',
        'kaypal-ai.sqlite',
      ),
      join(
        this.getProjectRoot(),
        'backend',
        'prisma',
        'data',
        'kaypal-ai.sqlite',
      ),
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate));
  }

  private resolveDefaultDesktopRuntimeDatabaseFile() {
    const explicitUserDataDir =
      this.configService.get<string>('KAYPAL_DESKTOP_USER_DATA_DIR') ||
      process.env.KAYPAL_DESKTOP_USER_DATA_DIR ||
      process.env.AI_CONTENT_DESKTOP_USER_DATA_DIR;
    let userDataDir = explicitUserDataDir?.trim() || '';
    if (!userDataDir) {
      if (osPlatform() === 'darwin') {
        userDataDir = join(
          process.env.HOME || homedir(),
          'Library',
          'Application Support',
          'ai-content-desktop',
        );
      } else if (osPlatform() === 'win32') {
        const appData = process.env.APPDATA || '';
        userDataDir = appData ? join(appData, 'ai-content-desktop') : '';
      } else {
        userDataDir = join(
          process.env.XDG_CONFIG_HOME ||
            join(process.env.HOME || homedir(), '.config'),
          'ai-content-desktop',
        );
      }
    }
    return userDataDir ? join(userDataDir, 'kaypal-ai.sqlite') : '';
  }

  private sqliteFileFromUrl(databaseUrl: string) {
    if (!databaseUrl.startsWith('file:')) return null;
    const raw = databaseUrl.slice('file:'.length);
    if (!raw) return null;
    return raw.startsWith('./') || raw.startsWith('../')
      ? resolve(process.cwd(), raw)
      : resolve(raw);
  }

  private resolveSqliteCliPath() {
    const candidates = [
      process.env.AI_CONTENT_SQLITE_EXE,
      process.env.SQLITE_EXE,
      '/usr/bin/sqlite3',
      '/opt/homebrew/bin/sqlite3',
      join(process.cwd(), 'sqlite3.exe'),
      join(this.getProjectRoot(), 'vendor', 'sqlite-tools', 'sqlite3.exe'),
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate));
  }

  private getProjectRoot() {
    return resolveProjectRoot();
  }

  private async resolvePublishOwnerScope(): Promise<
    { tenantId: string; userId: string } | Record<string, never>
  > {
    if (!this.authRequestContext || !this.authRequestContext.hasContext()) {
      return {};
    }

    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后管理平台账号。');
    }

    if (typeof this.authRequestContext.resolveTenantId === 'function') {
      const tenantId = await this.authRequestContext.resolveTenantId(
        this.prisma,
      );
      return { tenantId, userId };
    }

    try {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: { tenantId: true },
      });
      if (membership?.tenantId) {
        return { tenantId: membership.tenantId, userId };
      }
    } catch (error) {
      if (user?.kaypalLocalOnly !== true) throw error;
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  private scopedPublishAccountId(
    baseId: string,
    scope: { tenantId?: string; userId?: string },
  ) {
    if (!scope.tenantId || !scope.userId) return baseId;
    const ownerKey = createHash('sha256')
      .update(`${scope.tenantId}\u0000${scope.userId}`)
      .digest('hex')
      .slice(0, 12);
    return `${baseId}-${ownerKey}`;
  }

  private async applyRecentPublishLoginBlocks<
    T extends { id: string; platform: string; config: unknown },
  >(rows: T[]): Promise<T[]> {
    if (!rows.length) return rows;
    const ownerScope = await this.resolvePublishOwnerScope();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const accountKeys = new Set(
      rows.map((row) => {
        const cfg = (row.config ?? {}) as { engineAccountId?: number };
        const accountId =
          typeof cfg.engineAccountId === 'number'
            ? String(cfg.engineAccountId)
            : row.id;
        return `${row.platform}:${accountId}`;
      }),
    );
    const failures =
      (await this.prisma.runtimeExecution
        ?.findMany({
          where: {
            ...ownerScope,
            executor: 'platform-publish',
            reasonCode: 'account_not_logged_in',
            createdAt: { gte: cutoff },
          },
          orderBy: { createdAt: 'desc' },
          take: Math.max(20, rows.length * 4),
        })
        .catch(() => [])) ?? [];
    const blocked = new Map<
      string,
      { createdAt: Date; technicalMessage?: string | null }
    >();
    for (const failure of failures) {
      if (!failure.accountId) continue;
      const key = `${failure.platform}:${failure.accountId}`;
      if (!accountKeys.has(key) || blocked.has(key)) continue;
      blocked.set(key, {
        createdAt: failure.createdAt,
        technicalMessage: failure.technicalMessage,
      });
    }
    if (!blocked.size) return rows;
    return rows.map((row) => {
      const cfg = (row.config ?? {}) as {
        engineAccountId?: number;
        status?: string;
        sessionStatus?: string;
        lastDispatchOk?: boolean;
        lastDispatchReason?: string;
      };
      const accountId =
        typeof cfg.engineAccountId === 'number'
          ? String(cfg.engineAccountId)
          : row.id;
      const failure = blocked.get(`${row.platform}:${accountId}`);
      if (!failure) return row;
      const hasFreshReadySignal =
        cfg.sessionStatus === 'logged_in' && cfg.lastDispatchOk === true;
      if (hasFreshReadySignal) return row;
      return {
        ...row,
        config: {
          ...((row.config ?? {}) as Record<string, unknown>),
          status: 'expired',
          statusLabel: '需要重新登录',
          sessionStatus: 'needs_login',
          lastDispatchOk: false,
          lastDispatchReason: 'platform_publish_account_not_logged_in',
          lastDispatchAt: failure.createdAt.toISOString(),
          lastError:
            failure.technicalMessage ||
            '最近一次真实发布检测到平台要求重新登录',
        },
      } as T;
    });
  }

  private mapPublishAccountToAutoUploadAccount(row: {
    id: string;
    platform: string;
    name: string;
    status?: string;
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
      sessionStatus?: string;
      lastDispatchAt?: string;
      lastDispatchOk?: boolean;
      lastDispatchReason?: string;
    };
    const platformType =
      typeof cfg.platformType === 'number'
        ? cfg.platformType
        : (AutoUploadClient.PUBLISH_PLATFORM_TYPE_MAP[row.platform] ?? 0);
    const currentSessionNeedsLogin =
      cfg.sessionStatus === 'needs_login' ||
      cfg.lastDispatchReason === 'browser_session_needs_login';
    const currentSessionBlocked =
      cfg.sessionStatus === 'blocked' ||
      cfg.lastDispatchReason === 'browser_session_blocked';
    const hasFreshReadySignal =
      cfg.sessionStatus === 'logged_in' && cfg.lastDispatchOk === true;
    const durableStatus = hasFreshReadySignal
      ? 'ready'
      : cfg.status || row.status || 'ready';
    const ready =
      !currentSessionNeedsLogin &&
      !currentSessionBlocked &&
      durableStatus === 'ready';
    return {
      id:
        typeof cfg.engineAccountId === 'number'
          ? cfg.engineAccountId
          : Number(row.id) || 0,
      stableId: row.id,
      accountName: cfg.profileName ?? cfg.userName ?? row.name,
      type: platformType,
      platform: this.resolvePlatformName(platformType) || row.platform,
      platformKey: row.platform,
      filePath: cfg.filePath ?? '',
      userName: cfg.userName ?? row.name,
      status: ready ? 1 : 0,
      statusCode: ready ? 'ready' : durableStatus,
      profileName: cfg.profileName ?? row.name,
      avatarPath: cfg.avatarPath ?? null,
      avatarUpdatedAt: cfg.avatarUpdatedAt ?? null,
      statusLabel: currentSessionNeedsLogin
        ? '需要重新登录'
        : currentSessionBlocked
          ? '浏览器阻断'
          : ready
            ? hasFreshReadySignal || cfg.statusLabel === '待校验'
              ? '已登录'
              : (cfg.statusLabel ?? '已登录')
            : (cfg.statusLabel ?? '登录失效'),
      sessionStatus: currentSessionNeedsLogin
        ? 'needs_login'
        : currentSessionBlocked
          ? 'error'
          : cfg.sessionStatus,
      lastDispatchAt: cfg.lastDispatchAt ?? null,
      lastDispatchOk: cfg.lastDispatchOk ?? null,
      lastDispatchReason: cfg.lastDispatchReason ?? null,
    };
  }

  private resolveEngineAccountId(account: { id: string; config: unknown }) {
    const cfg = (account.config ?? {}) as { engineAccountId?: number };
    if (typeof cfg.engineAccountId === 'number') return cfg.engineAccountId;
    return Number(account.id) || account.id;
  }

  async openAccounts(
    ids: (number | string)[],
    options: { platform?: string } = {},
  ): Promise<AutoUploadOpenAccountsResult> {
    const targetPlatform = options.platform
      ? this.resolvePlatformSlugFromString(options.platform)
      : null;
    const openedIds: Array<number | string> = [];
    const openedAccounts: AutoUploadOpenAccountsResult['openedAccounts'] = [];
    const skipped: Array<{ id: number | string; reason: string }> = [];
    for (const id of ids) {
      const accounts = (await this.findPublishAccountsByAnyId(id)).filter(
        (account) =>
          !targetPlatform ||
          this.resolvePlatformSlugFromString(account.platform) ===
            targetPlatform,
      );
      if (!accounts.length) {
        skipped.push({
          id,
          reason: targetPlatform
            ? `账号不存在或平台不匹配: ${targetPlatform}`
            : '账号不存在',
        });
        continue;
      }
      for (const account of accounts) {
        const cfg = (account.config ?? {}) as { profileName?: string };
        const url = this.platformProfileUrl(account.platform, cfg.profileName);
        if (!url || url === 'about:blank') {
          skipped.push({ id, reason: `未知平台 ${account.platform}` });
          continue;
        }
        try {
          const engineAccountId = this.resolveEngineAccountId(account);
          if (!this.localBrowser) {
            throw new Error(
              'LocalBrowserEngine 未注入，无法打开 CDP 持久浏览器',
            );
          }
          const platform = this.resolvePlatformSlugFromString(account.platform);
          const session = await this.localBrowser.getOrCreateSession({
            platform,
            accountId: engineAccountId,
          });
          await session.page.goto(url, { waitUntil: 'commit', timeout: 30000 });
          await session.page.bringToFront().catch(() => undefined);
          const loginState = await this.inspectActiveSessionLoginState(
            platform,
            String(engineAccountId),
          );
          const currentUrl =
            typeof session.page.url === 'function' ? session.page.url() : url;
          const openedStatus =
            loginState === 'logged_out' || this.isLoginPageUrl(currentUrl)
              ? 'needs_login'
              : loginState === 'logged_in'
                ? 'ready'
                : 'unknown';
          this.monitorAccountLoginState({
            rowId: account.id,
            platform,
            platformType: this.resolvePlatformTypeFromSlug(platform),
            accountId: engineAccountId,
            storageFileName: ((account.config ?? {}) as { filePath?: string })
              .filePath,
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
          openedAccounts?.push({
            id: account.id,
            platform: account.platform,
            accountId: engineAccountId,
            status: openedStatus,
            currentUrl,
            lastError:
              openedStatus === 'needs_login'
                ? '平台页面要求重新登录'
                : openedStatus === 'ready'
                  ? undefined
                  : '当前页面尚未确认平台登录态',
          });
        } catch (error) {
          skipped.push({
            id,
            reason:
              error instanceof Error
                ? `${account.platform}: ${error.message}`
                : `${account.platform}: 打开平台后台失败`,
          });
        }
      }
    }
    return { opened: openedIds.length, openedIds, openedAccounts, skipped };
  }

  async openInteractionEntry(input: {
    accountId: number | string;
    entryType: string;
  }): Promise<AutoUploadInteractionEntryResult> {
    const entry = this.resolveInteractionEntry(input.entryType);
    const account = await this.findPublishAccountByAnyId(
      input.accountId,
      entry.platform,
    );
    if (!account) {
      throw new ServiceUnavailableException('平台账号不存在，请先刷新账号列表');
    }
    if (
      account.platform !== 'douyin' &&
      account.platform !== 'wechat-channel'
    ) {
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
        ? await this.captureInteractionEntryEvidence(
            opened.sessionKey,
            input.entryType,
          )
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
    });
  }

  async readDouyinMessages(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<AutoUploadDouyinMessagesReadResult> {
    return this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'douyin',
      taskType: 'direct-message-reply',
      platformName: '抖音',
      platformType: 3,
      limit: input.limit || 50,
    }) as unknown as Promise<AutoUploadDouyinMessagesReadResult>;
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
    });
  }

  async readWechatChannelMessages(input: {
    accountId: number | string;
    limit?: number;
  }): Promise<AutoUploadWechatChannelMessagesReadResult> {
    return this.readLivePlatformInteractions({
      accountId: input.accountId,
      platform: 'wechat-channel',
      taskType: 'direct-message-reply',
      platformName: '视频号',
      platformType: 2,
      limit: input.limit || 50,
    }) as unknown as Promise<AutoUploadWechatChannelMessagesReadResult>;
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
        this.findPublishAccountByAnyId(input.accountId, input.platform).catch(
          () => null,
        ),
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
            : (account?.name ?? ''),
        platformType: Number(result.platformType ?? input.platformType),
        platformName:
          typeof result.platformName === 'string'
            ? result.platformName
            : input.platformName,
        url: String(result.url ?? ''),
        title: String(result.title ?? ''),
        comments: Array.isArray(result.comments)
          ? (result.comments as AutoUploadDouyinComment[])
          : [],
        messages: Array.isArray(result.messages) ? result.messages : [],
        summary: result.summary as AutoUploadInteractionReadSummary | undefined,
        pageTextSample:
          typeof result.pageTextSample === 'string'
            ? result.pageTextSample
            : undefined,
        evidence:
          (result.evidence as AutoUploadInteractionEvidence | null) ?? null,
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
        cdpPort: typeof result.cdpPort === 'number' ? result.cdpPort : null,
        browser: typeof result.browser === 'string' ? result.browser : null,
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
    const account = await this.findPublishAccountByAnyId(
      input.accountId,
      input.platform,
    );
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
      .map((row) =>
        [row.currentTarget, row.draftText].filter(Boolean).join('：'),
      )
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
    const checkedAt = new Date().toISOString();
    if (osPlatform() !== 'darwin') {
      return {
        platform: 'wechat',
        available: false,
        running: false,
        appName: '微信',
        windowCount: 0,
        screenshotAvailable: false,
        inputControlAvailable: false,
        clickControlAvailable: false,
        fileSelectionAvailable: false,
        requiresManualTarget: true,
        permissionHints: [`当前系统 ${osPlatform()} 暂未接入桌面微信检测。`],
        safetyBoundary: {
          draftOnly: false,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'macOS desktop automation',
          manualSteps: ['请在 macOS 桌面微信环境运行真实微信任务。'],
        },
        message: '当前系统暂不支持桌面微信自动化。',
        checkedAt,
      };
    }

    try {
      const processStatus =
        (await this.readWechatMacProcess('WeChat')) ??
        (await this.readWechatMacProcess('微信'));
      const cgWindows = await this.listMacWechatWindows();
      if (!processStatus) {
        return {
          platform: 'wechat',
          available: false,
          running: false,
          appName: '微信',
          windowCount: 0,
          screenshotAvailable: false,
          inputControlAvailable: false,
          clickControlAvailable: false,
          fileSelectionAvailable: false,
          requiresManualTarget: true,
          permissionHints: ['未检测到桌面微信进程。'],
          safetyBoundary: {
            draftOnly: false,
            readsPrivateChats: false,
            readsContacts: false,
            sendsMessages: false,
            targeting: 'macOS desktop automation',
            manualSteps: ['请先打开桌面微信并确认已登录。'],
          },
          message: '桌面微信未运行。',
          checkedAt,
        };
      }

      const scriptCommands = [
        'wechat-auto-reply',
        'wechat-contact-add',
        'wechat-moments-publish',
        'wechat-moments-marketing',
      ];
      const missingCommands = scriptCommands.filter((command) => {
        return !this.resolveWechatCommandPaths(command).some((candidate) =>
          existsSync(candidate),
        );
      });
      const requiredDesktopScripts = [
        'validate-ops-workbench-wechat-live.mjs',
        'align-ops-workbench-wechat-contact-live.mjs',
        'prepare-ops-workbench-wechat-draft-live.mjs',
        'send-ops-workbench-wechat-live.mjs',
      ];
      const advancedDesktopScriptsReady = requiredDesktopScripts.every(
        (scriptName) => Boolean(this.findKaypalDesktopScriptPath(scriptName)),
      );
      const cliclickPath = this.resolveCliclickPath();
      const windowTitles = processStatus.windowTitles.length
        ? processStatus.windowTitles
        : cgWindows.map((window) => window.title).filter(Boolean);
      const windowCount = windowTitles.length;
      const permissionHints = [...processStatus.permissionHints];
      if (windowCount === 0) {
        permissionHints.push(
          '已检测到微信进程，但未读取到窗口标题；执行前需要人工确认当前目标窗口。',
        );
      } else if (!processStatus.windowTitles.length && cgWindows.length > 0) {
        permissionHints.push('已通过 macOS 窗口列表读取到微信窗口。');
      }
      if (cgWindows.length > 1) {
        const windowSummary = cgWindows
          .slice(0, 5)
          .map((window, index) => {
            const title = window.title || window.owner || `窗口 ${index + 1}`;
            return `${title}(${window.width}x${window.height})`;
          })
          .join('、');
        permissionHints.push(
          `检测到多个微信窗口候选：${windowSummary}。请只保留目标聊天主窗口在前台，避免写入错误会话。`,
        );
      }
      if (missingCommands.length > 0) {
        permissionHints.push(
          `缺少微信桌面执行脚本：${missingCommands.join('、')}`,
        );
      }
      if (!cliclickPath) {
        permissionHints.push(
          '缺少桌面点击工具；联系人、朋友圈等需要鼠标定位的操作无法执行。',
        );
      }
      const controlsAvailable =
        missingCommands.length === 0 && Boolean(cliclickPath);
      const windowUsable =
        windowCount > 0 || processStatus.permissionHints.length === 0;

      return {
        platform: 'wechat',
        available: windowUsable && controlsAvailable,
        running: true,
        appName: processStatus.appName,
        windowCount,
        currentWindowTitle: windowTitles[0] || null,
        windowTitles,
        bundleId: 'com.tencent.xinWeChat',
        frontmost: processStatus.frontmost,
        screenshotAvailable: true,
        inputControlAvailable: controlsAvailable,
        clickControlAvailable: controlsAvailable,
        fileSelectionAvailable: controlsAvailable,
        requiresManualTarget: true,
        permissionHints,
        safetyBoundary: {
          draftOnly: false,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: true,
          targeting: '当前桌面微信窗口',
          manualSteps: [
            '执行前确认当前微信窗口和联系人。',
            '遇到验证码、系统权限或异常弹窗时人工接管。',
          ],
        },
        message: controlsAvailable
          ? advancedDesktopScriptsReady
            ? '已检测到桌面微信、包内执行命令和增强会话控制组件。'
            : '已检测到桌面微信和包内执行命令；基础控制链路可用。'
          : '已检测到桌面微信，但本机控制运行时尚未完整就绪。',
        checkedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      return {
        platform: 'wechat',
        available: false,
        running: false,
        appName: '微信',
        windowCount: 0,
        screenshotAvailable: false,
        inputControlAvailable: false,
        clickControlAvailable: false,
        fileSelectionAvailable: false,
        requiresManualTarget: true,
        permissionHints: [
          '读取桌面微信状态失败，请检查 macOS 自动化/辅助功能权限。',
          message,
        ],
        safetyBoundary: {
          draftOnly: false,
          readsPrivateChats: false,
          readsContacts: false,
          sendsMessages: false,
          targeting: 'macOS desktop automation',
          manualSteps: ['授予本地引擎辅助功能和屏幕录制权限后重试。'],
        },
        message: '桌面微信状态读取失败。',
        checkedAt,
      };
    }
  }

  async listWechatWindows(): Promise<{
    windows: Array<{ id: string; title: string; isMain: boolean }>;
  }> {
    const status = await this.getWechatDesktopStatus();
    const titles = status.windowTitles || [];
    return {
      windows: titles.map((title, index) => ({
        id: `wechat-window-${index + 1}`,
        title,
        isMain: index === 0,
      })),
    };
  }

  async checkWechatAlive(): Promise<{ alive: boolean; reason?: string }> {
    const status = await this.getWechatDesktopStatus();
    return {
      alive: status.running === true,
      reason: status.running ? status.message : status.message,
    };
  }

  resolveWechatContact(query: string): {
    matches: Array<{ name: string; remark: string; id: string }>;
    ambiguous: boolean;
  } {
    return { matches: query.trim() ? [] : [], ambiguous: false };
  }

  async alignWechatContact(
    query: string,
  ): Promise<AutoUploadWechatContactAlignmentResult> {
    const target = query.trim();
    const searchText = this.buildWechatContactSearchText(target);
    if (!target) {
      throw new ServiceUnavailableException(
        '微信目标对齐失败：缺少联系人或群名称',
      );
    }
    if (osPlatform() !== 'darwin') {
      return {
        ok: false,
        stage: 'desktop_permission_missing',
        targetText: target,
        message: `当前系统 ${osPlatform()} 暂不支持桌面微信目标对齐。`,
        nextAction: '请在 macOS 桌面微信环境运行真实微信任务。',
        matches: [],
        ambiguous: true,
        alignedAt: new Date().toISOString(),
      };
    }

    try {
      const desktop = await this.getWechatDesktopStatus();
      if (!desktop.running) {
        return {
          ok: false,
          stage: 'wechat_missing',
          targetText: target,
          message: desktop.message || '桌面微信未运行。',
          nextAction: '请先打开桌面微信并确认已登录。',
          matches: [],
          ambiguous: true,
          alignedAt: new Date().toISOString(),
        };
      }

      const output = await this.runAppleScriptWithArgs(
        [
          'on mainWechatWindow(processName)',
          'tell application "System Events"',
          'tell process processName',
          'repeat with appWindow in windows',
          'set windowNameText to ""',
          'set windowDescriptionText to ""',
          'set windowSizeValue to {0, 0}',
          'try',
          'set windowNameText to name of appWindow as text',
          'end try',
          'try',
          'set windowDescriptionText to description of appWindow as text',
          'end try',
          'try',
          'set windowSizeValue to size of appWindow',
          'end try',
          'if (item 1 of windowSizeValue) > 600 and (item 2 of windowSizeValue) > 400 and (windowNameText is "微信 (窗口)" or windowNameText is "微信" or windowDescriptionText is "标准窗口") then return appWindow',
          'end repeat',
          'end tell',
          'end tell',
          'return missing value',
          'end mainWechatWindow',
          '',
          'on raiseMainWechatWindow(processName)',
          'set didRaise to false',
          'tell application "System Events"',
          'tell process processName',
          'set frontmost to true',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'if mainWindowRef is not missing value then',
          'try',
          'perform action "AXRaise" of mainWindowRef',
          'end try',
          'try',
          'set position of mainWindowRef to {90, 45}',
          'set size of mainWindowRef to {1180, 860}',
          'end try',
          'set didRaise to true',
          'end if',
          'end tell',
          'end tell',
          'return didRaise',
          'end raiseMainWechatWindow',
          '',
          'on currentWechatText(processName)',
          'set collectedText to ""',
          'tell application "System Events"',
          'tell process processName',
          'try',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'if mainWindowRef is missing value then return collectedText',
          'set uiElements to entire contents of mainWindowRef',
          'repeat with uiElement in uiElements',
          'try',
          'set itemName to name of uiElement',
          'if itemName is not missing value then set collectedText to collectedText & " " & (itemName as text)',
          'end try',
          'try',
          'set itemValue to value of uiElement',
          'if itemValue is not missing value then set collectedText to collectedText & " " & (itemValue as text)',
          'end try',
          'try',
          'set itemDescription to description of uiElement',
          'if itemDescription is not missing value then set collectedText to collectedText & " " & (itemDescription as text)',
          'end try',
          'end repeat',
          'end try',
          'end tell',
          'end tell',
          'return collectedText',
          'end currentWechatText',
          '',
          'on dismissWechatBlockingDialogs()',
          'tell application "System Events"',
          'repeat 3 times',
          'try',
          'key code 53',
          'end try',
          'delay 0.2',
          'end repeat',
          'end tell',
          'end dismissWechatBlockingDialogs',
          '',
          'on closeWechatSearchWindows(processName)',
          'tell application "System Events"',
          'tell process processName',
          'repeat 4 times',
          'set closedWindow to false',
          'set windowTotal to count of windows',
          'repeat with windowIndex from 1 to windowTotal',
          'set windowNameText to ""',
          'set windowDescriptionText to ""',
          'set windowSizeValue to {0, 0}',
          'try',
          'set windowNameText to name of window windowIndex as text',
          'end try',
          'try',
          'set windowDescriptionText to description of window windowIndex as text',
          'end try',
          'try',
          'set windowSizeValue to size of window windowIndex',
          'end try',
          'set isMainWechatWindow to false',
          'if (item 1 of windowSizeValue) > 600 and (item 2 of windowSizeValue) > 400 and (windowNameText is "微信 (窗口)" or windowNameText is "微信" or windowDescriptionText is "标准窗口") then set isMainWechatWindow to true',
          'if isMainWechatWindow is false and (windowDescriptionText is "窗口" or windowDescriptionText is "对话框" or windowNameText contains "搜一搜" or windowNameText contains "AI搜索") then',
          'try',
          'click button 1 of window windowIndex',
          'set closedWindow to true',
          'delay 0.5',
          'exit repeat',
          'end try',
          'end if',
          'end repeat',
          'if closedWindow is false then exit repeat',
          'end repeat',
          'end tell',
          'end tell',
          'end closeWechatSearchWindows',
          '',
          'on currentWindowTitle(processName)',
          'set titleText to ""',
          'tell application "System Events"',
          'tell process processName',
          'try',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'if mainWindowRef is not missing value then set titleText to name of mainWindowRef as text',
          'end try',
          'if titleText is "" then try',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'if mainWindowRef is not missing value then set titleText to title of mainWindowRef as text',
          'end try',
          'if titleText is "" then try',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'if mainWindowRef is not missing value then set titleText to description of mainWindowRef as text',
          'end try',
          'end tell',
          'end tell',
          'return titleText',
          'end currentWindowTitle',
          '',
          'on searchRecordWindowFrame(processName)',
          'tell application "System Events"',
          'tell process processName',
          'repeat with appWindow in windows',
          'set windowNameText to ""',
          'set windowPositionValue to {0, 0}',
          'set windowSizeValue to {0, 0}',
          'try',
          'set windowNameText to name of appWindow as text',
          'end try',
          'try',
          'set windowPositionValue to position of appWindow',
          'end try',
          'try',
          'set windowSizeValue to size of appWindow',
          'end try',
          'if windowNameText contains "搜索聊天记录" then return (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
          'end repeat',
          'end tell',
          'end tell',
          'return ""',
          'end searchRecordWindowFrame',
          '',
          'on searchPanelWindowFrame(processName)',
          'tell application "System Events"',
          'tell process processName',
          'repeat with appWindow in windows',
          'set windowNameText to ""',
          'set windowDescriptionText to ""',
          'set windowPositionValue to {0, 0}',
          'set windowSizeValue to {0, 0}',
          'try',
          'set windowNameText to name of appWindow as text',
          'end try',
          'try',
          'set windowDescriptionText to description of appWindow as text',
          'end try',
          'try',
          'set windowPositionValue to position of appWindow',
          'end try',
          'try',
          'set windowSizeValue to size of appWindow',
          'end try',
          'if windowDescriptionText is "对话框" and (item 1 of windowSizeValue) > 250 and (item 2 of windowSizeValue) > 350 then return (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
          'end repeat',
          'end tell',
          'end tell',
          'return ""',
          'end searchPanelWindowFrame',
          '',
          'on currentFrontmostProcessName()',
          'set frontmostName to ""',
          'tell application "System Events"',
          'try',
          'set frontmostName to name of first process whose frontmost is true',
          'end try',
          'end tell',
          'return frontmostName',
          'end currentFrontmostProcessName',
          '',
          'on detectWechatRisk(pageText)',
          'repeat with riskWord in {"验证码", "频繁", "风险", "账号异常", "账号限制", "操作过快", "安全验证", "稍后再试", "无法发送", "发送失败", "被限制", "登录过期"}',
          'if pageText contains (riskWord as text) then return "微信出现" & (riskWord as text) & "提示，已停止。"',
          'end repeat',
          'return ""',
          'end detectWechatRisk',
          '',
          'on captureWechatWindowScreenshot(processName, screenshotPath)',
          'set mainWindowRef to missing value',
          'try',
          'set mainWindowRef to my mainWechatWindow(processName)',
          'end try',
          'if mainWindowRef is missing value then',
          'return ""',
          'end if',
          'set windowPositionValue to {0, 0}',
          'set windowSizeValue to {0, 0}',
          'tell application "System Events"',
          'tell process processName',
          'try',
          'set windowPositionValue to position of mainWindowRef',
          'set windowSizeValue to size of mainWindowRef',
          'end try',
          'end tell',
          'end tell',
          'set captureRegion to (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
          'set shareableScript to "import Foundation\\nimport CoreGraphics\\nlet args = CommandLine.arguments\\nguard args.count >= 5, let expectedX = Int(args[1]), let expectedY = Int(args[2]), let expectedWidth = Int(args[3]), let expectedHeight = Int(args[4]) else { exit(2) }\\nlet windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []\\nfor window in windows {\\n  let owner = window[kCGWindowOwnerName as String] as? String ?? \\"\\"\\n  let name = window[kCGWindowName as String] as? String ?? \\"\\"\\n  guard owner.contains(\\"微信\\") || owner.contains(\\"WeChat\\") || name.contains(\\"微信\\") || name.contains(\\"WeChat\\") else { continue }\\n  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }\\n  let x = Int(bounds[\\"X\\"] as? Double ?? Double(bounds[\\"X\\"] as? Int ?? -1))\\n  let y = Int(bounds[\\"Y\\"] as? Double ?? Double(bounds[\\"Y\\"] as? Int ?? -1))\\n  let width = Int(bounds[\\"Width\\"] as? Double ?? Double(bounds[\\"Width\\"] as? Int ?? -1))\\n  let height = Int(bounds[\\"Height\\"] as? Double ?? Double(bounds[\\"Height\\"] as? Int ?? -1))\\n  guard abs(x - expectedX) <= 2, abs(y - expectedY) <= 2, abs(width - expectedWidth) <= 2, abs(height - expectedHeight) <= 2 else { continue }\\n  if let sharingState = window[kCGWindowSharingState as String] as? Int { print(sharingState > 0 ? \\"shareable\\" : \\"blocked\\"); exit(0) }\\n}\\nprint(\\"unknown\\")"',
          'set shareableState to do shell script "swift -e " & quoted form of shareableScript & " " & (item 1 of windowPositionValue as text) & " " & (item 2 of windowPositionValue as text) & " " & (item 1 of windowSizeValue as text) & " " & (item 2 of windowSizeValue as text)',
          'if shareableState is "blocked" then return ""',
          'do shell script "screencapture -x -R " & quoted form of captureRegion & " " & quoted form of screenshotPath',
          'return screenshotPath',
          'end captureWechatWindowScreenshot',
          '',
          'on run argv',
          'set targetText to item 1 of argv',
          'set processName to item 2 of argv',
          'set fieldSeparator to linefeed & "--KAYPAL-WECHAT-ALIGN-FIELD--" & linefeed',
          'set cliclickPath to item 3 of argv',
          'set searchText to item 4 of argv',
          'do shell script "open -b com.tencent.xinWeChat"',
          'tell application id "com.tencent.xinWeChat" to activate',
          'delay 0.8',
          'my dismissWechatBlockingDialogs()',
          'tell application id "com.tencent.xinWeChat" to activate',
          'delay 0.5',
          'my closeWechatSearchWindows(processName)',
          'my raiseMainWechatWindow(processName)',
          'delay 0.3',
          'set frontmostProcessName to my currentFrontmostProcessName()',
          'if frontmostProcessName is not processName then',
          'set screenshotPath to "/tmp/ai-content-wechat-align-" & (do shell script "date +%s") & ".png"',
          'set screenshotPath to my captureWechatWindowScreenshot(processName, screenshotPath)',
          'return "wechat_not_frontmost" & fieldSeparator & screenshotPath & fieldSeparator & frontmostProcessName & fieldSeparator & "" & fieldSeparator & "前台应用不是微信：" & frontmostProcessName',
          'end if',
          'if cliclickPath is not "" then do shell script quoted form of cliclickPath & " m:1400,500"',
          'delay 0.2',
          'tell application "System Events" to keystroke "f" using {command down}',
          'delay 0.2',
          'set the clipboard to searchText',
          'tell application "System Events" to keystroke "v" using {command down}',
          'delay 0.8',
          'set beforeClickText to my currentWechatText(processName)',
          'set searchPanelFrameBeforeClick to my searchPanelWindowFrame(processName)',
          'set searchHasCandidate to false',
          'if beforeClickText contains "群聊" and beforeClickText contains searchText then set searchHasCandidate to true',
          'if beforeClickText contains "聊天记录" and beforeClickText contains searchText then set searchHasCandidate to true',
          'if searchPanelFrameBeforeClick is not "" then set searchHasCandidate to true',
          'set clickedCandidate to false',
          'if cliclickPath is not "" and searchHasCandidate is true then',
          'set searchPanelFrame to searchPanelFrameBeforeClick',
          'if searchPanelFrame is not "" then',
          'set AppleScript\'s text item delimiters to ","',
          'set searchPanelItems to text items of searchPanelFrame',
          'set searchPanelX to item 1 of searchPanelItems as integer',
          'set searchPanelY to item 2 of searchPanelItems as integer',
          'set AppleScript\'s text item delimiters to ""',
          'set localChatX to searchPanelX + 150',
          'set localChatY to searchPanelY + 70',
          'do shell script quoted form of cliclickPath & " c:" & localChatX & "," & localChatY',
          'delay 0.25',
          'do shell script quoted form of cliclickPath & " c:" & localChatX & "," & localChatY',
          'else',
          'do shell script quoted form of cliclickPath & " c:290,150"',
          'delay 0.25',
          'do shell script quoted form of cliclickPath & " c:290,150"',
          'end if',
          'set clickedCandidate to true',
          'delay 0.7',
          'set recordWindowFrame to my searchRecordWindowFrame(processName)',
          'if recordWindowFrame is not "" then',
          'set AppleScript\'s text item delimiters to ","',
          'set recordWindowItems to text items of recordWindowFrame',
          'set recordWindowX to item 1 of recordWindowItems as integer',
          'set recordWindowY to item 2 of recordWindowItems as integer',
          'set recordWindowW to item 3 of recordWindowItems as integer',
          'set AppleScript\'s text item delimiters to ""',
          'set enterChatX to recordWindowX + recordWindowW - 48',
          'set enterChatY to recordWindowY + 155',
          'do shell script quoted form of cliclickPath & " c:" & enterChatX & "," & enterChatY',
          'delay 1.0',
          'end if',
          'repeat 3 times',
          'try',
          'tell application "System Events" to key code 53',
          'end try',
          'delay 0.3',
          'end repeat',
          'if cliclickPath is not "" then',
          'do shell script quoted form of cliclickPath & " c:300,154"',
          'delay 1.0',
          'end if',
          'end if',
          'delay 1.2',
          'tell application id "com.tencent.xinWeChat" to activate',
          'delay 0.2',
          'set pageText to my currentWechatText(processName)',
          'set windowTitleText to my currentWindowTitle(processName)',
          'set screenshotPath to "/tmp/ai-content-wechat-align-" & (do shell script "date +%s") & ".png"',
          'set screenshotPath to my captureWechatWindowScreenshot(processName, screenshotPath)',
          'set riskMessage to my detectWechatRisk(pageText)',
          'set matched to false',
          'if pageText contains targetText then set matched to true',
          'if windowTitleText contains targetText then set matched to true',
          'if searchHasCandidate is true and pageText contains searchText then set matched to true',
          'if searchHasCandidate is true and windowTitleText contains searchText then set matched to true',
          'set landedOnSearchPage to false',
          'if pageText contains "AI搜索" then set landedOnSearchPage to true',
          'if pageText contains "搜索网络结果" then set landedOnSearchPage to true',
          'if pageText contains "搜一搜" then set landedOnSearchPage to true',
          'if pageText contains "AI for 教师教学" then set landedOnSearchPage to true',
          'set stillSearching to false',
          'if pageText contains "搜索网络结果" then set stillSearching to true',
          'if pageText contains "群聊" and pageText contains searchText then set stillSearching to true',
          'if pageText contains "聊天记录" and pageText contains searchText then set stillSearching to true',
          'if windowTitleText contains "搜索聊天记录" then set stillSearching to true',
          'set stageText to "ambiguous"',
          'if riskMessage is not "" then set stageText to "risk_blocked"',
          'if riskMessage is "" and landedOnSearchPage is true then set stageText to "search_page"',
          'if riskMessage is "" and landedOnSearchPage is false and searchHasCandidate is true then set stageText to "candidate_found"',
          'if riskMessage is "" and matched and landedOnSearchPage is false and stillSearching is false and clickedCandidate is true then set stageText to "aligned"',
          'return stageText & fieldSeparator & screenshotPath & fieldSeparator & windowTitleText & fieldSeparator & riskMessage & fieldSeparator & pageText',
          'end run',
        ],
        [
          target,
          desktop.appName || 'WeChat',
          this.resolveCliclickPath(),
          searchText,
        ],
        30000,
      );
      const fields = output.split(/\r?\n--KAYPAL-WECHAT-ALIGN-FIELD--\r?\n/);
      const [rawStage, rawScreenshotPath, rawWindowTitle, rawRiskMessage] =
        fields;
      const accessibilityTextSample = fields
        .slice(4)
        .join('\n')
        .trim()
        .slice(0, 800);
      let stage = this.toWechatAlignmentStage(rawStage?.trim());
      const screenshotPath = (rawScreenshotPath || '').trim();
      const windowTitle = (rawWindowTitle || '').trim();
      const riskMessage = (rawRiskMessage || '').trim();
      const visualText = await this.readLocalImageText(screenshotPath).catch(
        () => '',
      );
      const visualTextSample = visualText.trim().slice(0, 800);
      if (
        riskMessage === '' &&
        stage !== 'wechat_not_frontmost' &&
        stage !== 'desktop_permission_missing' &&
        stage !== 'wechat_missing' &&
        stage !== 'risk_blocked' &&
        this.isWechatVisualTargetMatch(visualText, target, searchText) &&
        !this.wechatVisualTextLooksLikeSearchSurface(visualText)
      ) {
        stage = 'aligned';
      }
      const pageTextSample = [
        accessibilityTextSample,
        visualTextSample ? `OCR: ${visualTextSample}` : '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 800);
      const evidence: AutoUploadInteractionEvidence | null = screenshotPath
        ? {
            type: 'screenshot',
            label:
              stage === 'aligned' ? '微信目标对齐截图' : '微信目标对齐异常截图',
            value: screenshotPath,
            path: screenshotPath,
          }
        : {
            type: 'text',
            label: '微信目标对齐结果',
            value: output,
          };
      const ok = stage === 'aligned';
      const message = riskMessage
        ? riskMessage
        : ok
          ? '已自动打开目标微信会话。'
          : stage === 'search_page'
            ? '微信打开了搜索结果页，没有进入目标会话。'
            : stage === 'candidate_found'
              ? '已找到疑似微信会话结果，但还没有确认进入目标会话。'
              : stage === 'wechat_not_frontmost'
                ? `微信没有切到前台，当前前台窗口是 ${windowTitle || '其他应用'}。`
                : '已搜索目标，但无法从当前微信窗口回读确认联系人或群名。';
      const matchedTitle = ok ? target : null;
      return {
        ok,
        stage,
        targetText: target,
        searchedText: searchText,
        matchedTitle,
        windowTitle: windowTitle || null,
        pageTextSample: pageTextSample || undefined,
        screenshotPath: screenshotPath || undefined,
        message,
        nextAction: ok
          ? '可以继续填入草稿；发送动作仍需确认。'
          : stage === 'candidate_found'
            ? '请核对微信搜索结果；系统下一步需要接入视觉点击后才能自动锁定。'
            : stage === 'search_page'
              ? '请关闭微信搜一搜窗口后重试，系统会再次尝试打开本地联系人结果。'
              : stage === 'wechat_not_frontmost'
                ? '请关闭遮挡的浏览器或系统弹窗，并授予本地引擎辅助功能权限后重试。'
                : '请检查联系人重名、搜索结果和微信窗口状态后重试。',
        evidence,
        matches: matchedTitle
          ? [{ name: matchedTitle, remark: target, id: `wechat-${target}` }]
          : [],
        ambiguous: !ok,
        alignedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        ok: false,
        stage: 'desktop_permission_missing',
        targetText: target,
        message: `微信目标对齐失败：${
          error instanceof Error ? error.message : '未知错误'
        }`,
        nextAction:
          '检查桌面微信、辅助功能权限、搜索框快捷键和截图权限后重试。',
        matches: [],
        ambiguous: true,
        alignedAt: new Date().toISOString(),
      };
    }
  }

  private toWechatAlignmentStage(
    stage: unknown,
  ): AutoUploadWechatContactAlignmentResult['stage'] {
    if (
      stage === 'aligned' ||
      stage === 'candidate_found' ||
      stage === 'search_page' ||
      stage === 'ambiguous' ||
      stage === 'contact_not_found' ||
      stage === 'wechat_missing' ||
      stage === 'wechat_not_frontmost' ||
      stage === 'desktop_permission_missing' ||
      stage === 'risk_blocked'
    ) {
      return stage;
    }
    return 'ambiguous';
  }

  private buildWechatContactSearchText(target: string): string {
    const normalized = target.replace(/\s+/g, ' ').trim();
    const separators = ['｜', '|', '-', '—', '_', '/', '\\'];
    for (const separator of separators) {
      if (!normalized.includes(separator)) continue;
      const parts = normalized
        .split(separator)
        .map((part) => part.replace(/\(\d+\)$/, '').trim())
        .filter((part) => part.length >= 2);
      const preferred = [...parts]
        .reverse()
        .find((part) => /群|客户|沟通|联系人|私信|会话/.test(part));
      if (preferred) return preferred;
      const longest = parts.sort((a, b) => b.length - a.length)[0];
      if (longest) return longest;
    }
    return normalized.replace(/\(\d+\)$/, '').trim() || target;
  }

  private normalizeWechatVisualText(value: string): string {
    return value
      .replace(/[｜|]/g, '')
      .replace(/[()（）]/g, '')
      .replace(/\s+/g, '')
      .trim();
  }

  private isWechatVisualTargetMatch(
    visualText: string,
    target: string,
    searchText: string,
  ): boolean {
    const normalizedVisual = this.normalizeWechatVisualText(visualText);
    if (!normalizedVisual) return false;
    const candidates = [
      target,
      target.replace(/\(\d+\)$/, ''),
      searchText,
      this.buildWechatContactSearchText(target),
    ]
      .map((candidate) => this.normalizeWechatVisualText(candidate))
      .filter((candidate) => candidate.length >= 2);
    return candidates.some((candidate) => normalizedVisual.includes(candidate));
  }

  private wechatVisualTextLooksLikeSearchSurface(visualText: string): boolean {
    const normalized = visualText.replace(/\s+/g, '');
    return (
      normalized.includes('搜索网络结果') ||
      normalized.includes('搜一搜') ||
      normalized.includes('聊天记录') ||
      normalized.includes('最常使用')
    );
  }

  private async readLocalImageText(imagePath: string): Promise<string> {
    if (!imagePath || !existsSync(imagePath) || osPlatform() !== 'darwin') {
      return '';
    }
    const swiftSource = [
      'import Foundation',
      'import Vision',
      'import AppKit',
      'let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""',
      'let url = URL(fileURLWithPath: path)',
      'guard let image = NSImage(contentsOf: url), let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let cg = bitmap.cgImage else { exit(0) }',
      'var output = [String]()',
      'let request = VNRecognizeTextRequest { request, error in',
      '  if error != nil { return }',
      '  output = (request.results as? [VNRecognizedTextObservation] ?? []).compactMap { $0.topCandidates(1).first?.string }',
      '}',
      'request.recognitionLanguages = ["zh-Hans", "en-US"]',
      'request.recognitionLevel = .accurate',
      'request.usesLanguageCorrection = true',
      'let handler = VNImageRequestHandler(cgImage: cg, options: [:])',
      'try? handler.perform([request])',
      'print(output.joined(separator: "\\n"))',
    ].join('\n');
    const { stdout } = await execFileAsync(
      'swift',
      ['-e', swiftSource, imagePath],
      {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return String(stdout || '').trim();
  }

  dismissWechatPopup(): {
    dismissed: boolean;
    popupType?: string;
  } {
    return { dismissed: false, popupType: 'agent-s-required' };
  }

  async draftWechatReply(input: {
    targetText?: string;
    replyText: string;
  }): Promise<AutoUploadWechatDraftResult> {
    const target = input.targetText?.trim();
    if (!target) {
      throw new ServiceUnavailableException('微信草稿写入失败：缺少目标联系人');
    }
    try {
      const draft = (await this.canRunAdvancedWechatScript())
        ? await this.executeWechatDesktopScript(
            'prepare-ops-workbench-wechat-draft-live.mjs',
            ['--target', target, '--draft', input.replyText],
            120000,
          )
        : await this.executeWechatDesktopCommand('wechat-auto-reply', [
            target,
            input.replyText,
            'approval',
            '',
          ]);
      if (draft.ok === true && draft.status === 'drafted') {
        draft.draftInserted = true;
        draft.stage = 'drafted';
      }
      const ok = draft.ok === true && draft.draftInserted === true;
      const evidence: AutoUploadInteractionEvidence =
        typeof draft.screenshotPath === 'string' && draft.screenshotPath
          ? {
              type: 'screenshot',
              label: ok ? '微信草稿截图' : '微信草稿失败截图',
              value: draft.screenshotPath,
              path: draft.screenshotPath,
            }
          : {
              type: 'text',
              label: ok ? '微信草稿结果' : '微信草稿失败',
              value: JSON.stringify(draft),
            };
      return {
        status: ok
          ? 'draft_filled'
          : draft.stage === 'contact_not_ready'
            ? 'desktop_permission_missing'
            : 'draft_not_ready',
        message: safeText(
          draft.note ||
            draft.message ||
            (ok
              ? '微信回复已写入并完成回读，后续按受控执行规则推进。'
              : '微信回复写入失败。'),
        ),
        targetText: target,
        replyText: input.replyText,
        evidence,
        readbackText:
          typeof draft.readbackText === 'string'
            ? draft.readbackText
            : undefined,
        confirmsDraftOnly: true,
        requiresManualSend: true,
        draftedAt: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new ServiceUnavailableException(`微信草稿写入失败：${message}`);
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
      const advancedScriptReady = await this.canRunAdvancedWechatScript();
      const draft = advancedScriptReady
        ? await this.executeWechatDesktopScript(
            'prepare-ops-workbench-wechat-draft-live.mjs',
            ['--target', target, '--draft', input.replyText],
            120000,
          )
        : await this.executeWechatDesktopCommand('wechat-auto-reply', [
            target,
            input.replyText,
            'approval',
            '',
          ]);
      if (draft.ok === true && draft.status === 'drafted') {
        draft.draftInserted = true;
        draft.stage = 'drafted';
      }
      if (draft.ok !== true || draft.draftInserted !== true) {
        return {
          status:
            draft.stage === 'contact_not_ready'
              ? 'desktop_permission_missing'
              : 'send_failed',
          sent: false,
          message: safeText(
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

      const sent = advancedScriptReady
        ? await this.executeWechatDesktopScript(
            'send-ops-workbench-wechat-live.mjs',
            ['--target', target, '--expected', input.replyText],
            120000,
          )
        : await this.executeWechatDesktopCommand('wechat-auto-reply', [
            target,
            input.replyText,
            'auto-send',
            '',
          ]);
      if (sent.ok === true && sent.status === 'sent') {
        sent.sent = true;
        sent.stage = 'sent';
      }
      const ok = sent.sent === true && sent.stage === 'sent';
      return {
        status: ok
          ? 'sent'
          : sent.stage === 'draft_not_ready'
            ? 'draft_not_ready'
            : 'send_failed',
        sent: ok,
        message: safeText(
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
      const account = await this.findPublishAccountByAnyId(id);
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
      const platform = account.platform;
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
      return {
        ok: false,
        id,
        avatarPath: null,
        avatarUrl: null,
        error: message,
      };
    }
  }

  private platformProfileUrl(platform: string, _profileName?: string): string {
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
    T extends {
      id: string;
      platform: string;
      name: string;
      status?: string | null;
      config: unknown;
    },
  >(rows: T[]): Promise<T[]> {
    const updated: T[] = [];
    const currentSessionByAccount = await this.loadCurrentCdpSessionMap();
    for (const row of rows) {
      const config = (row.config ?? {}) as Record<string, unknown> & {
        filePath?: string;
        platformType?: number;
        engineAccountId?: number | string;
      };
      const platformType =
        typeof config.platformType === 'number'
          ? config.platformType
          : (AutoUploadClient.PUBLISH_PLATFORM_TYPE_MAP[row.platform] ?? 0);
      const fileName =
        typeof config.filePath === 'string' ? config.filePath : '';
      const engineAccountId =
        config.engineAccountId == null
          ? row.id
          : String(config.engineAccountId);
      const platformKey = this.resolvePlatformSlugFromString(row.platform);
      const currentSession = currentSessionByAccount.get(
        `${platformKey}:${String(engineAccountId)}`,
      );
      if (
        currentSession?.status === 'needs_login' ||
        currentSession?.status === 'blocked' ||
        currentSession?.status === 'stopped'
      ) {
        const nextConfig = {
          ...config,
          status: 'expired',
          statusLabel:
            currentSession.status === 'needs_login'
              ? '需要重新登录'
              : '浏览器阻断',
          checkedAt: new Date().toISOString(),
        };
        // validate 只读检测：不写库（写库副作用曾致移动端/无浏览器环境全账号误判 expired）
        updated.push({
          ...row,
          config: nextConfig,
        });
        continue;
      }
      if (currentSession?.status === 'ready') {
        const nextConfig = {
          ...config,
          status: 'ready',
          statusLabel: '已登录',
          sessionStatus: 'logged_in',
          lastDispatchOk: true,
          lastDispatchReason: 'browser_session_ready',
          checkedAt: new Date().toISOString(),
        };
        // validate 只读检测：不写库（写库副作用曾致移动端/无浏览器环境全账号误判 expired）
        updated.push({
          ...row,
          config: nextConfig,
        });
        continue;
      }
      const attemptedRuntimeValidation = Boolean(this.localBrowser);
      const openedSession = await this.withAccountValidationTimeout(
        this.openAccountForValidation({
          platform: platformKey,
          accountId: engineAccountId,
          url: this.platformProfileUrl(platformKey),
        }),
        `${platformKey}:${String(engineAccountId)}`,
      );
      if (openedSession) {
        const openedReady = openedSession.status === 'ready';
        const nextConfig = {
          ...config,
          status: openedReady ? 'ready' : 'expired',
          statusLabel: openedReady
            ? '已登录'
            : openedSession.status === 'needs_login'
              ? '需要重新登录'
              : '待确认登录',
          sessionStatus: openedReady
            ? 'logged_in'
            : openedSession.status === 'needs_login'
              ? 'needs_login'
              : 'unknown',
          lastDispatchOk: openedReady,
          lastDispatchReason: openedReady
            ? 'browser_session_ready'
            : openedSession.status === 'needs_login'
              ? 'browser_session_needs_login'
              : 'browser_session_unknown',
          checkedAt: new Date().toISOString(),
        };
        // validate 只读检测：不写库（写库副作用曾致移动端/无浏览器环境全账号误判 expired）
        updated.push({
          ...row,
          config: nextConfig,
        });
        continue;
      }
      if (attemptedRuntimeValidation) {
        // 浏览器验证不可用/超时（云端或无浏览器环境是常态）≠ 账号失效：
        // 保持原状态不降级（降级曾致移动端/无浏览器环境全账号误判 expired）。
        this.logger?.warn?.(
          `validate: 浏览器验证超时，保持原状态 ${platformKey}:${String(engineAccountId)}`,
        );
        updated.push(row);
        continue;
      }
      if (currentSession != null) {
        // 当前 CDP 会话存在但非明确失效状态（如 unknown）：无法确认失效，保持原状态。
        this.logger?.warn?.(
          `validate: 会话状态 ${currentSession.status} 非明确失效，保持原状态 ${platformKey}:${String(engineAccountId)}`,
        );
        updated.push(row);
        continue;
      }
      const artifacts = this.getAccountLoginArtifacts(
        row.platform,
        String(engineAccountId),
        fileName,
      );
      const hasPersistentLoginState = artifacts.hasPersistentLoginState;
      if (hasPersistentLoginState) {
        const nextConfig = {
          ...config,
          status: 'ready',
          statusLabel: '已登录',
          sessionStatus: 'logged_in',
          lastDispatchOk: true,
          lastDispatchReason: 'persistent_profile_ready',
          checkedAt: new Date().toISOString(),
        };
        // validate 只读检测：不写库（写库副作用曾致移动端/无浏览器环境全账号误判 expired）
        updated.push({
          ...row,
          config: nextConfig,
        });
        continue;
      }
      const cookiePath = fileName
        ? this.resolveAccountCookiePath(fileName)
        : null;
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
      if (transient) {
        updated.push(row);
        continue;
      }
      const nextConfig = {
        ...config,
        status: valid ? 'ready' : 'expired',
        statusLabel: valid ? '已登录' : '登录失效',
        sessionStatus: valid ? 'logged_in' : 'needs_login',
        lastDispatchOk: valid,
        lastDispatchReason: valid ? 'cookie_file_ready' : 'cookie_file_expired',
        checkedAt: new Date().toISOString(),
      };
      // validate 只读检测：不写库（写库副作用曾致移动端/无浏览器环境全账号误判 expired）
      void config;
      void nextConfig;
      updated.push({ ...row, config: nextConfig });
    }
    return updated;
  }

  private async loadCurrentCdpSessionMap() {
    const sessionByAccount = new Map<string, AutoUploadCdpBrowserSession>();
    try {
      const cdp = await this.getCdpSessions();
      for (const session of cdp.sessions ?? []) {
        sessionByAccount.set(
          `${session.platform}:${String(session.accountId)}`,
          session,
        );
      }
    } catch {
      // Account validation must still work when CDP status is temporarily unavailable.
    }
    return sessionByAccount;
  }

  private async withAccountValidationTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs = 12000,
  ): Promise<T | null> {
    return this.withTimedResult(
      promise,
      null,
      `账号登录态校验超时 ${label}: ${timeoutMs}ms`,
      timeoutMs,
    );
  }

  private async withTimedResult<T>(
    promise: Promise<T>,
    fallback: T,
    timeoutMessage: string,
    timeoutMs: number,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => {
            this.logger.warn(timeoutMessage);
            resolve(fallback);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async openAccountForValidation(input: {
    platform: Parameters<
      LocalBrowserEngine['getOrCreateSession']
    >[0]['platform'];
    accountId: string | number;
    url: string;
  }): Promise<AutoUploadCdpBrowserSession | null> {
    if (!this.localBrowser) return null;
    // 冷却：同一账号在冷却期内不重复打开浏览器验证（防止轮询反复拉起窗口）
    const cooldownKey = `${input.platform}:${String(input.accountId)}`;
    const lastAt = this.lastValidationAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastAt < this.validationCooldownMs) {
      return null;
    }
    this.lastValidationAt.set(cooldownKey, Date.now());
    try {
      const session = await this.localBrowser.getOrCreateSession({
        platform: input.platform,
        accountId: input.accountId,
      });
      if (input.url && input.url !== 'about:blank') {
        await session.page
          .goto(input.url, {
            waitUntil: 'commit',
            timeout: 30000,
          })
          .catch(() => undefined);
      }
      await session.page.bringToFront().catch(() => undefined);
      session.lastActivityAt = new Date().toISOString();
      const loginState = await this.inspectActiveSessionLoginState(
        input.platform,
        String(input.accountId),
      );
      const currentUrl = session.page.url();
      const currentUrlIsPlatformPage = this.isPlatformPageUrl(
        input.platform,
        currentUrl,
      );
      const openedReady =
        loginState === 'logged_in' ||
        (input.platform !== 'wechat-channel' &&
          currentUrlIsPlatformPage &&
          loginState !== 'logged_out');
      return {
        platform: input.platform,
        accountId: input.accountId,
        profileDir: session.profileDir,
        status:
          loginState === 'logged_out' || this.isLoginPageUrl(currentUrl)
            ? 'needs_login'
            : openedReady
              ? 'ready'
              : 'unknown',
        visibleWindow: session.visibleWindow,
        currentUrl,
        lastError:
          loginState === 'logged_out' || this.isLoginPageUrl(currentUrl)
            ? '平台页面要求重新登录'
            : openedReady
              ? undefined
              : '当前 CDP 页面不在平台后台，尚未确认平台登录态',
        activeProfile: true,
        browser: session.browser,
        debuggingPort: session.debuggingPort,
        runtimeMode: 'persistent-cdp-browser',
        browserReused: session.browserReused,
        lastActivityAt: session.lastActivityAt,
        startedAt: session.startedAt,
      };
    } catch (error) {
      this.logger.warn(
        `账号校验打开 CDP profile 失败 ${input.platform}-${input.accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private resolvePlatformSlugFromString(
    platform: string,
  ): LocalBrowserEngine extends never
    ? never
    : Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform'] {
    const normalized = String(platform || '').trim();
    const byName: Record<
      string,
      Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform']
    > = {
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

  private resolveBrowserPlatformSlug(
    type: number,
  ):
    | Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform']
    | null {
    const map: Record<
      number,
      Parameters<LocalBrowserEngine['getOrCreateSession']>[0]['platform']
    > = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
      6: 'weibo',
      7: 'zhihu',
      8: 'toutiao',
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
    // 注意：engineAccountId 是「本机全局」资源，profile 目录 browser-profiles/{platform}-{id}
    // 不带租户/用户维度。若按 ownerScope 过滤，切换桌面登录身份后新身份的 used 为空，
    // 会重新分配 1 等已被占用 id → 新账号复用旧身份的已登录 profile → "再添加跳到已登录账号"。
    // 因此必须跨 owner 取全局 max，并叠加文件系统占用探测，彻底避免撞号。
    const platform = this.resolveBrowserPlatformSlug(input.type);
    const rows = await this.prisma.publishAccount.findMany({
      where: platform ? { platform } : {},
      orderBy: { createdAt: 'asc' },
    });
    const used = rows
      .map((row) => {
        const config = (row.config ?? {}) as { engineAccountId?: unknown };
        const fromConfig = Number(config.engineAccountId);
        if (Number.isInteger(fromConfig) && fromConfig > 0) return fromConfig;
        // 兜底：旧版本创建的账号可能没写 config.engineAccountId，
        // 从主键 local-engine-<N>-<platform>[-<ownerKey>] 解析，避免新绑定撞号
        // （主键撞车 → upsert 覆盖 → "弹窗已绑定、列表不显示"）。
        const match = /^local-engine-(\d+)-/.exec(String(row.id ?? ''));
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isInteger(value) && value > 0);
    let candidate = used.length ? Math.max(...used) + 1 : 1;
    // 兜底：跳过文件系统里已被占用的 profile 目录（legacy 导入、孤儿目录、跨 owner 残留），
    // 防止新账号撞上已有登录态的 profile → 打开浏览器直接进入旧账号。
    // profile root 与 CdpBrowserProfileService.getProfileRootDir() 保持同一解析规则。
    if (platform) {
      const profileRoot =
        this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
        resolveProjectDataPath('browser-profiles');
      const isProfileDirTaken = (id: number) =>
        existsSync(join(profileRoot, `${platform}-${id}`));
      let guard = 0;
      while (isProfileDirTaken(candidate) && guard < 10000) {
        candidate += 1;
        guard += 1;
      }
    }
    return candidate;
  }

  private async prepareLoginPage(
    page: Page,
    platformType: number,
  ): Promise<void> {
    const url = this.platformLoginStartUrl(platformType);
    await this.gotoLoginPageBestEffort(page, url);
    if (platformType === 4) {
      await page
        .getByRole('link', { name: '立即登录' })
        .click({ timeout: 10000 })
        .catch(() => undefined);
      await page
        .getByText('扫码登录')
        .click({ timeout: 10000 })
        .catch(() => undefined);
    }
    if (platformType === 1) {
      await page
        .locator('img.css-wemwzq')
        .click({ timeout: 10000 })
        .catch(() => undefined);
    }
    await page.waitForTimeout(1000).catch(() => undefined);
  }

  private platformLoginStartUrl(type: number): string {
    const urls: Record<number, string> = {
      1: 'https://creator.xiaohongshu.com/login',
      2: 'https://channels.weixin.qq.com',
      3: 'https://creator.douyin.com/',
      4: 'https://cp.kuaishou.com',
      5: 'https://member.bilibili.com/platform/upload/video/frame',
    };
    return urls[type] || 'about:blank';
  }

  private async gotoLoginPageBestEffort(
    page: Page,
    url: string,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const currentUrl = page.url();
        if (
          currentUrl &&
          currentUrl !== 'about:blank' &&
          this.isRecoverableLoginNavigationError(message)
        ) {
          return;
        }
        if (!this.isRecoverableLoginNavigationError(message) || attempt >= 2) {
          throw error;
        }
        await page.waitForTimeout(1200).catch(() => undefined);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private isRecoverableLoginNavigationError(message: string): boolean {
    return /ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_ABORTED|Navigation interrupted|frame was detached|Timeout/i.test(
      message,
    );
  }

  private async extractLoginQrData(
    page: Page,
    platformType: number,
    timeoutMs = 60000,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const src = await this.findQrImageSrc(page, platformType).catch(
        () => null,
      );
      if (src) return src;
      await page.waitForTimeout(500).catch(() => undefined);
    }
    return null;
  }

  private async findQrImageSrc(
    page: Page,
    platformType: number,
  ): Promise<string | null> {
    for (const frame of page.frames()) {
      const candidates = await this.collectLoginQrImageCandidates(
        frame,
        platformType,
      ).catch(() => []);
      const best = this.pickLoginQrImageSrc(candidates, platformType);
      if (best) {
        return this.resolveLoginQrImageSrc(best, frame.url() || page.url());
      }
    }
    return null;
  }

  private async collectLoginQrImageCandidates(
    frame: Page | Frame,
    platformType: number,
  ): Promise<AutoUploadLoginQrImageCandidate[]> {
    return await frame.evaluate((type) => {
      void type;
      const normalizeNumber = (value: number) =>
        Number.isFinite(value) ? Math.round(value) : 0;
      const attrs = (node: Element) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        const image = node as HTMLImageElement;
        return {
          src: node.getAttribute('src') || '',
          alt: node.getAttribute('alt') || '',
          aria: node.getAttribute('aria-label') || '',
          cls: node.getAttribute('class') || '',
          id: node.getAttribute('id') || '',
          width: normalizeNumber(rect.width),
          height: normalizeNumber(rect.height),
          naturalWidth: normalizeNumber(image.naturalWidth || 0),
          naturalHeight: normalizeNumber(image.naturalHeight || 0),
          visible:
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0',
        };
      };
      return Array.from(document.querySelectorAll('img'))
        .map(attrs)
        .filter((item) => item.src && item.visible);
    }, platformType);
  }

  private pickLoginQrImageSrc(
    candidates: AutoUploadLoginQrImageCandidate[],
    platformType: number,
  ): string | null {
    const scored = candidates
      .map((candidate) => {
        const width = Math.max(candidate.width, 0);
        const height = Math.max(candidate.height, 0);
        const shorter = Math.min(width, height);
        const longer = Math.max(width, height);
        const squareRatio = longer > 0 ? shorter / longer : 0;
        const meta = `${candidate.src} ${candidate.alt || ''} ${
          candidate.aria || ''
        } ${candidate.cls || ''} ${candidate.id || ''}`;
        const qrHint =
          /qr|qrcode|二维码|扫码|scan me|scan/i.test(meta) ||
          (platformType === 2 && /login-for-iframe/i.test(meta));
        const decorativeHint =
          /logo|avatar|icon|feature|banner|background|double-bg|card-bg|success|fail/i.test(
            meta,
          );
        const acceptableSize =
          shorter >= 110 &&
          shorter <= 420 &&
          longer <= 460 &&
          squareRatio >= 0.82;
        if (!acceptableSize || decorativeHint) {
          return { candidate, score: -1 };
        }

        const naturalSquare =
          candidate.naturalWidth && candidate.naturalHeight
            ? Math.min(candidate.naturalWidth, candidate.naturalHeight) /
              Math.max(candidate.naturalWidth, candidate.naturalHeight)
            : squareRatio;
        let score = shorter;
        if (qrHint) score += 1000;
        if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(candidate.src)) {
          score += 220;
        }
        if (naturalSquare >= 0.9) score += 80;
        if (platformType === 1 && shorter >= 140) score += 80;
        if (platformType === 3 && /qrcode/i.test(meta)) score += 240;
        if (platformType === 5 && /scan/i.test(meta)) score += 160;
        return { candidate, score };
      })
      .filter((item) => item.score >= 180)
      .sort((left, right) => right.score - left.score);
    return scored[0]?.candidate.src || null;
  }

  private resolveLoginQrImageSrc(src: string, pageUrl: string): string {
    if (src.startsWith('data:image')) return src;
    if (src.startsWith('//')) return `https:${src}`;
    if (src.startsWith('/')) {
      return new URL(src, pageUrl).toString();
    }
    return src;
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

  private async pageLooksLoggedIn(
    platformType: number,
    page: Page,
  ): Promise<boolean> {
    let url = '';
    try {
      url = page.url() || '';
    } catch {
      return false;
    }
    const text = await page
      .locator('body')
      .innerText({ timeout: 2000 })
      .catch(() => '');
    if (platformType === 3) {
      if (!url.includes('creator.douyin.com')) return false;
      return !/扫码登录|验证码登录|密码登录|登录\/注册|打开「抖音APP」点击左上角/.test(
        text,
      );
    }
    if (platformType === 2) {
      if (!url.includes('channels.weixin.qq.com') || url.includes('login'))
        return false;
      return this.isWechatChannelAuthenticatedPage(url, text);
    }
    if (platformType === 4) {
      if (!url.includes('kuaishou.com') || url.includes('login')) return false;
      return !/立即登录|扫码登录|快手扫码登录|请扫码登录/.test(text);
    }
    if (platformType === 1) {
      return this.isXiaohongshuAuthenticatedPage(url, text);
    }
    if (platformType === 5) {
      if (url.includes('passport.bilibili.com')) return false;
      return (
        url.includes('bilibili.com') && !/立即登录|扫码登录|密码登录/.test(text)
      );
    }
    return false;
  }

  private async validateCookieFile(
    platformType: number,
    cookiePath: string,
  ): Promise<boolean> {
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
        timeout: 45000,
      });
      await page
        .waitForLoadState('networkidle', { timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(1000).catch(() => undefined);
      return await this.pageLooksLoggedIn(platformType, page);
    } finally {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private platformValidationUrl(type: number): string {
    const urls: Record<number, string> = {
      1: 'https://creator.xiaohongshu.com/new/note-manager',
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
      writeFileSync(
        join(profileDir, '.login-cookies.json'),
        JSON.stringify(filtered),
        'utf8',
      );
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
          const domain = safeText(
            (cookie as { domain?: unknown })?.domain || '',
          );
          return this.domainMatches(domain, domains);
        })
      : [];
    const origins = Array.isArray(state.origins)
      ? state.origins.filter((originState) => {
          const origin = safeText(
            (originState as { origin?: unknown })?.origin || '',
          );
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
    return domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    );
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
    return (
      candidates.find((candidate) => existsSync(candidate)) ??
      candidates[0] ??
      null
    );
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
    const legacyProfileMarkerPath = join(
      profileDir,
      '.legacy-profile-imported.json',
    );
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

  private storageStateFileHasPlatformData(
    filepath: string,
    platform: string,
  ): boolean {
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
    const ownerScope = await this.resolvePublishOwnerScope();
    const id = localEnginePublishAccountId({
      engineAccountId: input.engineAccountId,
      platform: input.platform,
      scope: ownerScope,
    });
    const config = {
      source: 'local-engine',
      status: 'ready',
      statusLabel: '已登录',
      filePath: input.filePath,
      userName: input.identity?.userName || input.profileName,
      profileName: input.profileName,
      platformType: input.platformType,
      engineAccountId:
        input.update && input.recordId ? input.recordId : input.engineAccountId,
      avatarPath: input.identity?.avatarPath || null,
      avatarUpdatedAt: input.identity?.avatarPath
        ? new Date().toISOString()
        : null,
      syncedAt: new Date().toISOString(),
    };
    const saved = await this.prisma.publishAccount.upsert({
      where: { id },
      create: {
        id,
        ...ownerScope,
        platform: input.platform,
        name: config.userName,
        status: 'ready',
        config,
      },
      update: {
        platform: input.platform,
        name: config.userName,
        status: 'ready',
        config,
      },
    });
    return saved.id;
  }

  private async saveVerifiedLoginSession(input: {
    platform: string;
    platformType: number;
    engineAccountId: number;
    profileName: string;
    context: BrowserContext;
    page: Page;
    profileDir?: string;
    update?: boolean;
    recordId?: number;
  }): Promise<{ ok: true; savedId: string } | { ok: false; message: string }> {
    await input.page.waitForTimeout(1500).catch(() => undefined);
    const storageFileName = `${randomUUID()}.json`;
    const storagePath = this.getAccountCookiePath(storageFileName);
    await this.saveFilteredStorageState(
      input.context,
      input.platform,
      storagePath,
      input.profileDir,
    );
    let valid = false;
    try {
      valid = await this.validateCookieFile(
        input.platformType,
        storagePath,
      );
    } catch (error) {
      // headless 打开平台页验证失败（抖音等重风控站点常见超时）——
      // 主浏览器会话已确认登录、cookie 已导出，验证仅兜底，降级为信任主会话。
      this.logger.warn(
        `登录态验证跳过（headless 打开平台页失败，信任主浏览器会话）: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      valid = true;
    }
    if (!valid) {
      // headless 验证判定未登录（小红书等重风控平台对 headless 误判率高）：
      // 若主浏览器会话此刻确认已登录，则信任主会话，避免"登录成功却显示失败"。
      const mainSessionLoggedIn = await this.pageLooksLoggedIn(
        input.platformType,
        input.page,
      ).catch(() => false);
      if (mainSessionLoggedIn) {
        this.logger.warn(
          `headless 验证判定未登录但主会话已登录（平台风控误判），信任主会话: platform=${input.platform} account=${input.engineAccountId}`,
        );
        valid = true;
      }
    }
    if (!valid) {
      return {
        ok: false,
        message:
          input.platform === 'wechat-channel'
            ? '视频号登录态保存后校验未通过。请确认浏览器已进入视频号助手后台，不要停在二维码、登录页或营销介绍页，然后重新绑定。'
            : '登录态保存后校验未通过。请确认平台后台已登录成功，再重新绑定。',
      };
    }
    const identity = await captureAccountIdentity(
      input.page,
      input.platformType,
      input.engineAccountId,
      this.getLocalAvatarDir(),
    );
    const savedId = await this.saveLoginPublishAccount({
      platform: input.platform,
      platformType: input.platformType,
      engineAccountId: input.engineAccountId,
      profileName: input.profileName,
      filePath: storageFileName,
      update: input.update,
      recordId: input.recordId,
      identity,
    });
    return { ok: true, savedId };
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
        if (!(await this.pageLooksLoggedIn(input.platformType, input.page)))
          return;
        await this.saveFilteredStorageState(
          input.context,
          input.platform,
          storagePath,
          input.profileDir,
        );
        await this.prisma.publishAccount.update({
          where: { id: input.rowId },
          data: {
            status: 'ready',
            config: {
              ...(((
                await this.prisma.publishAccount.findUnique({
                  where: { id: input.rowId },
                })
              )?.config as object) || {}),
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
      resolveProjectDataPath('browser-profiles');
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
      await page
        .waitForLoadState('networkidle', { timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(1200).catch(() => undefined);
      return await page.evaluate(() => {
        const normalize = (value: unknown) =>
          (typeof value === 'string'
            ? value
            : value == null
              ? ''
              : (JSON.stringify(value) ?? '')
          )
            .replace(/\s+/g, ' ')
            // eslint-disable-next-line no-misleading-character-class -- 故意清洗零宽不可见字符（ZWSP/ZWJ/LRM/BOM）
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

  private async findPublishAccountByAnyId(
    accountId: number | string,
    platform?: string,
  ) {
    const accounts = await this.findPublishAccountsByAnyId(accountId, platform);
    return accounts[0] ?? null;
  }

  private async findPublishAccountsByAnyId(
    accountId: number | string,
    platform?: string,
  ) {
    const ownerScope = await this.resolvePublishOwnerScope();
    const id = String(accountId);
    const intId = Number(accountId);
    const byPrimaryId = await this.prisma.publishAccount.findMany({
      where: { id, ...ownerScope },
      orderBy: { createdAt: 'asc' },
    });
    const byEngineId = Number.isFinite(intId)
      ? (
          await this.prisma.publishAccount.findMany({
            where: ownerScope,
            orderBy: { createdAt: 'asc' },
          })
        ).filter((account) => {
          const config = (account.config ?? {}) as { engineAccountId?: number };
          return Number(config.engineAccountId) === intId;
        })
      : [];
    const accountsById = new Map<string, (typeof byPrimaryId)[number]>();
    [...byPrimaryId, ...byEngineId].forEach((account) => {
      accountsById.set(account.id, account);
    });
    const accounts = Array.from(accountsById.values());
    if (!platform) return accounts;
    const expectedPlatform = this.resolvePlatformSlugFromString(platform);
    return accounts.filter(
      (account) =>
        this.resolvePlatformSlugFromString(account.platform) ===
        expectedPlatform,
    );
  }

  private nextRpcId() {
    return Math.floor(Math.random() * 1e9) + 1;
  }

  private getLocalCookieDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_COOKIES_DIR') ||
      resolveProjectDataPath('cookiesFile');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getLocalAvatarDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
      resolveProjectDataPath('avatars');
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getLocalMaterialDir() {
    const dir =
      this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
      resolveProjectDataPath('materials');
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
      const parsed = JSON.parse(
        readFileSync(indexPath, 'utf8'),
      ) as Partial<LocalUploadMaterialIndex>;
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
            })
          : [],
      };
    } catch {
      return { nextId: 1, files: [] };
    }
  }

  private writeLocalMaterialIndex(index: LocalUploadMaterialIndex) {
    writeFileSync(
      this.getLocalMaterialIndexPath(),
      JSON.stringify(index, null, 2),
    );
  }

  private normalizeLocalMaterialFile(
    file: LocalUploadMaterialIndex['files'][number],
  ) {
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
    const normalizedOriginalName =
      this.decodePossiblyLatin1Filename(originalName);
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
    return (
      filename
        .trim()
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 120) || 'material'
    );
  }

  private isSafeLocalFilename(filename: string) {
    return (
      Boolean(filename) &&
      !filename.includes('..') &&
      !filename.includes('/') &&
      !filename.includes('\\')
    );
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
      resolveProjectLogPath('browser-evidence');
    mkdirSync(directory, { recursive: true });
    const cutoff =
      Date.now() - Math.max(0, Math.floor(retentionDays)) * 24 * 60 * 60 * 1000;
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
      files: candidates.map(({ expired: _expired, ...file }) => file),
      errors,
      checkedAt: new Date().toISOString(),
      status: {
        directory,
        urlPrefix: '/api/local-engine/evidence',
        fileCount: files.length - deletedCount,
        totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
        latestUpdatedAt:
          files.sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt),
          )[0]?.updatedAt ?? null,
      },
    };
  }

  async deleteAccount(id: number, platform?: string): Promise<null> {
    const account = await this.findPublishAccountByAnyId(id, platform);
    if (!account) {
      throw new ServiceUnavailableException(
        `本地账号删除失败：账号不存在 ${id}`,
      );
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
    return profileName
      ? `${base}?profile=${encodeURIComponent(profileName)}`
      : base;
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
      reuseLoggedInSession: false,
    });
    this.activeLoginSessionKeys.set(input.requestId, session.key);

    try {
      if (await this.pageLooksLoggedIn(platformType, session.page)) {
        const saved = await this.saveVerifiedLoginSession({
          platform,
          platformType,
          engineAccountId,
          profileName: input.profileName,
          context: session.context,
          page: session.page,
          profileDir: session.profileDir,
          update: input.update,
          recordId: input.recordId,
        });
        if (!saved.ok) {
          yield `ERROR: ${saved.message}`;
          yield '500';
          return;
        }
        yield `ACCOUNT_ID:${engineAccountId}`;
        yield '200';
        return;
      }
      await this.prepareLoginPage(session.page, platformType);
      if (await this.pageLooksLoggedIn(platformType, session.page)) {
        const saved = await this.saveVerifiedLoginSession({
          platform,
          platformType,
          engineAccountId,
          profileName: input.profileName,
          context: session.context,
          page: session.page,
          profileDir: session.profileDir,
          update: input.update,
          recordId: input.recordId,
        });
        if (!saved.ok) {
          yield `ERROR: ${saved.message}`;
          yield '500';
          return;
        }
        yield `ACCOUNT_ID:${engineAccountId}`;
        yield '200';
        return;
      }
      const qr = await this.extractLoginQrData(
        session.page,
        platformType,
        platformType === 2 ? 5000 : 60000,
      );
      if (!qr) {
        if (platformType === 2) {
          yield `LOGIN_URL:${this.platformLoginStartUrl(platformType)}`;
        } else {
          yield 'ERROR: 登录页面加载超时，未获取到二维码。请关闭弹窗后重试，或检查平台登录页是否改版、浏览器是否被拦截。';
          yield '500';
          return;
        }
      } else {
        yield qr;
      }

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
        yield 'ERROR: 登录未完成或平台没有进入已登录状态。请在本机打开的平台窗口完成扫码/登录后，再刷新账号状态。';
        yield '500';
        return;
      }

      const saved = await this.saveVerifiedLoginSession({
        platform,
        platformType,
        engineAccountId,
        profileName: input.profileName,
        context: session.context,
        page: session.page,
        profileDir: session.profileDir,
        update: input.update,
        recordId: input.recordId,
      });
      if (!saved.ok) {
        yield `ERROR: ${saved.message}`;
        yield '500';
        return;
      }
      yield `ACCOUNT_ID:${engineAccountId}`;
      yield '200';
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
      return {
        cancelled: false,
        requestId,
        message: `关闭浏览器失败: ${message}`,
      };
    }
  }

  async listMaterials(): Promise<AutoUploadMaterial[]> {
    const index = this.readLocalMaterialIndex();
    const materialDir = this.getLocalMaterialDir();
    const indexed = new Map(
      index.files.map((file) => [
        file.filename,
        this.normalizeLocalMaterialFile(file),
      ]),
    );
    const entries = await readdirAsync(materialDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name !== 'index.json')
        .map(async (entry) => {
          const normalizedEntryName = this.decodePossiblyLatin1Filename(
            entry.name,
          );
          const indexedFile =
            indexed.get(entry.name) || indexed.get(normalizedEntryName);
          const filepath =
            indexedFile?.filepath || join(materialDir, entry.name);
          const stats = await statAsync(filepath);

          return {
            id: indexedFile?.id || this.localMaterialIdFromFilename(entry.name),
            filename: indexedFile?.filename || normalizedEntryName,
            filesizeMb: Number((stats.size / 1024 / 1024).toFixed(2)),
            uploadTime: indexedFile?.uploadedAt || stats.mtime.toISOString(),
            filePath: filepath,
          };
        }),
    );

    return files.sort((left, right) =>
      (right.uploadTime || '').localeCompare(left.uploadTime || ''),
    );
  }

  async listLogs(limit = 80): Promise<AutoUploadLogFile[]> {
    // 2026-06-04: 5409 (auto-upload) 已下线. 旧 endpoint /logs/recent 不存在.
    // 真执行日志走 runtime_executions (orchestrator 每次 execute 都写一条).
    try {
      const ownerScope = await this.resolvePublishOwnerScope();
      const rows = await this.prisma.runtimeExecution.findMany({
        where: ownerScope,
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
          updatedAt:
            rows[0]?.createdAt?.toISOString() ?? new Date().toISOString(),
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
      DOUYIN_COMMENT_REPLY: '抖音自动评论',
      DOUYIN_DIRECT_MESSAGE_REPLY: '抖音私信回复',
      WECHAT_CHANNEL_COMMENT_REPLY: '视频号评论回复',
      WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: '视频号私信回复',
      WECHAT_REPLY_DRAFT: '微信草稿',
      WECHAT_GROUP_BROADCAST: '微信群发',
      WECHAT_CONTACT_ADD: '自动加好友',
      WECHAT_MOMENTS_PUBLISH: '朋友圈发布',
      WECHAT_MOMENTS_MARKETING: '朋友圈营销',
      CUSTOMER_FOLLOW_UP: '客户跟进',
    };
    const platformFromTaskType: Record<string, { type: number; name: string }> =
      {
        DOUYIN_COMMENT_REPLY: { type: 3, name: '抖音' },
        DOUYIN_DIRECT_MESSAGE_REPLY: { type: 3, name: '抖音' },
        WECHAT_CHANNEL_COMMENT_REPLY: { type: 2, name: '视频号' },
        WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: { type: 2, name: '视频号' },
        WECHAT_REPLY_DRAFT: { type: 6, name: '微信' },
        WECHAT_GROUP_BROADCAST: { type: 6, name: '微信' },
        WECHAT_CONTACT_ADD: { type: 6, name: '微信' },
        WECHAT_MOMENTS_PUBLISH: { type: 6, name: '微信' },
        WECHAT_MOMENTS_MARKETING: { type: 6, name: '微信' },
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
      const platform = platformFromTaskType[row.taskType] || {
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

  uploadMaterial(input: {
    file: AutoUploadUploadFile;
    filename?: string;
  }): UploadedAutoUploadMaterial {
    try {
      // P0 安全加固：落盘前强制校验（类型/大小），防公网直打磁盘耗尽
      assertMaterialFileSafe(input.file);
      const materialDir = this.getLocalMaterialDir();
      const sourceName = this.decodePossiblyLatin1Filename(
        input.file.originalname || 'material',
      );
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

  fetchMaterialFile(filename: string) {
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

  deleteMaterial(id: number): { id: number; filename: string } {
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
          uploadedAt: statSync(
            join(materialDir, entry.name),
          ).mtime.toISOString(),
        }))
        .find((file) => file.id === id);
      target = scanned;
    }
    if (!target) {
      throw new ServiceUnavailableException(
        `本地素材删除失败：素材不存在 ${id}`,
      );
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
    options: { agentSessionId?: string } = {},
  ): Promise<AutoUploadPublishResponse> {
    if (!payloads.length) {
      throw new Error('请至少选择一个发布账号');
    }
    const results = await Promise.all(
      payloads.map(async (payload, index) => {
        const runtimeAccountId =
          await this.resolvePublishRuntimeAccountId(payload);
        const result = await this.runtime.execute(
          {
            relatedId:
              options.agentSessionId || `publish-${Date.now()}-${index}`,
            relatedType: 'agent-session',
            type:
              payload.contentKind === 'article'
                ? 'platform-publish-image-text'
                : 'platform-publish-video',
            platform: this.resolveRuntimePlatform(payload.type),
            accountId: runtimeAccountId,
            payload: {
              platform: this.resolvePlatformName(payload.type),
              platformType: payload.type,
              contentKind: payload.contentKind,
              articleId: payload.articleId,
              body: payload.body,
              sourceIdentity: payload.sourceIdentity,
              accountIdentity: payload.accountIdentity,
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
      agentSessionId: options.agentSessionId,
      results: publishResults,
    };
  }

  private buildRuntimePublishResult(
    payload: AutoUploadPublishPayload,
    result: RuntimeExecutionResult,
  ): AutoUploadPublishResultItem {
    const publishUrl = this.extractRuntimePublishUrl(result);
    const readbackOk = result.ok === true && result.readback?.matched === true;
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
      ok: readbackOk ? true : result.ok === false ? false : null,
      platform: this.resolvePlatformName(payload.type),
      account: payload.accountIdentity?.name || payload.accountList?.[0] || '',
      articleId: payload.articleId,
      publishUrl,
      platformUrl: publishUrl,
      notIntegrated: result.reasonCode === 'not_integrated',
      message:
        result.ok === true && !readbackOk
          ? `${result.userMessage}；平台尚未确认结果。`
          : result.userMessage,
      evidence,
    };
  }

  private buildRuntimePublishReason(results: AutoUploadPublishResultItem[]) {
    if (results.length > 0 && results.every((item) => item.ok === true)) {
      return '平台已确认全部发布结果。';
    }

    if (results.some((item) => item.ok === true)) {
      return '部分平台已确认发布，其他平台仍需处理。';
    }

    if (results.some((item) => item.ok == null)) {
      return '发布请求已提交，正在等待平台确认。';
    }

    if (results.every((item) => item.notIntegrated === true)) {
      return '当前平台暂不支持正式发布，未标记为成功。';
    }

    return '发布失败或被平台阻止，请查看各平台结果。';
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
      const ownerScope = await this.resolvePublishOwnerScope();
      const rows = await this.prisma.publishAccount.findMany({
        where: { ...ownerScope, ...(platform ? { platform } : {}) },
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
        return candidates.some((candidate) =>
          rowCandidates.includes(candidate),
        );
      });
      if (!match) return fallback;
      const cfg = (match.config ?? {}) as { engineAccountId?: number | string };
      return String(cfg.engineAccountId ?? match.id);
    } catch {
      return fallback;
    }
  }

  private resolvePlatformSlug(
    type: number,
  ): Exclude<ExecutorTaskPlatform, 'wechat-desktop' | 'mixed'> | undefined {
    const names: Record<
      number,
      Exclude<ExecutorTaskPlatform, 'wechat-desktop' | 'mixed'>
    > = {
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
      6: '微博',
      7: '知乎',
      8: '头条',
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
