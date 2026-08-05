import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { access, readFile, stat } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { RemoteImagePreprocessor } from './remote-image-preprocessor';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
} from '../../common/project-paths';
import { LocalEngineService } from '../local-engine/local-engine.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
import { RiskPolicyService } from '../auth/risk-policy.service';
import {
  type AutoUploadAccount,
  AutoUploadClient,
  type AutoUploadLogFile,
  type AutoUploadMaterial,
  type AutoUploadPublishPayload,
  type AutoUploadPublishResponse,
  type AutoUploadPublishTask,
  type AutoUploadUploadFile,
  type AutoUploadPublishBatchResult,
  type AutoUploadPublishPlatformEntry,
  type AutoUploadCdpBrowserSession,
  type AutoUploadPage,
} from './auto-upload.client';
import {
  DURABLE_PUBLISH_RECORD_SOURCE,
  type DurablePublishRecord,
  type DurablePublishRecordPageQuery,
  PublishRecordStore,
  hasVerifiedPlatformReadback,
} from './publish-record.store';

const ACCOUNT_HEALTH_ACCOUNT_READ_TIMEOUT_MS = 20000;
const CURRENT_SESSION_STATUS_TIMEOUT_MS = 2500;

export type AutoUploadAccountHealthIssue = {
  accountId?: number;
  accountFile?: string;
  accountName: string;
  platformType?: number;
  platform: string;
  status: 'expired' | 'missing';
  message: string;
  nextAction: string;
};

export type AutoUploadAccountHealth = {
  checkedAt: string;
  totalAccounts: number;
  readyAccounts: number;
  expiredAccounts: number;
  issues: AutoUploadAccountHealthIssue[];
  waitingTasks: Array<{
    id: number;
    title: string;
    platform: string;
    accountFile: string;
    status: string;
    message: string | null;
    canResume: boolean;
    nextAction: string;
  }>;
};

export type AutoUploadAccountReloginRecovery = {
  checkedAt: string;
  account: {
    id: number;
    accountName: string;
    platform: string;
    status: 'ready' | 'expired';
    statusLabel: string;
  };
  opened: number;
  resumeCandidates: AutoUploadAccountHealth['waitingTasks'];
  nextAction: string;
};

export type AutoUploadResumeBlockedTasksResult = {
  checkedAt: string;
  riskAudit?: BackendRiskAuditEvent;
  resumed: number;
  skipped: number;
  results: Array<{
    taskId: number;
    title: string;
    platform: string;
    accountFile: string;
    status: 'resumed' | 'skipped' | 'failed';
    message: string;
    retryResult?: AutoUploadPublishResponse;
  }>;
};

type PreparedRetryPublishTask = {
  durableRecord: DurablePublishRecord;
  task: AutoUploadPublishTask;
  payloadSource: 'recorded' | 'reconstructed';
  restoredFields: string[];
  missingFields: string[];
  retryPayloads: AutoUploadPublishPayload[];
};

type ResumeBlockedPublishState = {
  accountByFile: Map<string, AutoUploadAccount>;
  candidates: AutoUploadAccountHealth['waitingTasks'];
};

type ResumeBlockedApprovalSnapshot = {
  target: string;
  preparedByTaskId: Map<number, PreparedRetryPublishTask>;
};

export type AutoUploadPublishPreflightIssue = {
  code:
    | 'engine_unavailable'
    | 'payload_empty'
    | 'account_missing'
    | 'account_expired'
    | 'content_kind_missing'
    | 'material_missing'
    | 'material_unreadable'
    | 'material_type_mismatch'
    | 'cover_missing'
    | 'cover_unreadable'
    | 'cover_type_mismatch'
    | 'video_parameter_missing'
    | 'schedule_invalid'
    | 'title_missing'
    | 'article_identity_missing'
    | 'article_body_missing'
    | 'article_missing'
    | 'article_changed'
    | 'bili_partition_missing'
    | 'platform_not_supported';
  scope: 'engine' | 'payload' | 'account' | 'material' | 'cover';
  message: string;
  nextAction: string;
  platform?: string;
  account?: string;
  stage: string;
  payloadIndex?: number;
  platformType?: number;
  accountFile?: string;
  filePath?: string;
  field?: string;
  expected?: string;
  actual?: string;
};

export type AutoUploadPublishPreflightResult = {
  ok: boolean;
  checkedAt: string;
  summary: string;
  payloadCount: number;
  accountCount: number;
  materialCount: number;
  issues: AutoUploadPublishPreflightIssue[];
};

export type PublishBatchResult = AutoUploadPublishBatchResult & {
  publishRecordId?: number;
};

export type PublishPlatformResult = AutoUploadPublishPlatformEntry;

type AutoUploadMaterialKind = 'image' | 'video' | 'unknown';

type AutoUploadEnginePublishResultItem = NonNullable<
  NonNullable<AutoUploadPublishResponse>['results']
>[number];

type AutoUploadPublishEvidence = {
  source: 'platform-api' | 'platform-page' | 'readback';
  externalId?: string;
  publishUrl?: string;
  raw?: unknown;
};

type AutoUploadRecordedPublishPayload = {
  taskId: number;
  payload: AutoUploadPublishPayload;
  recordedAt: string;
};

type AccountSessionStatus = {
  status: 'logged_in' | 'needs_login' | 'error' | 'unknown';
  lastDispatchAt: string;
  lastOk: boolean;
  lastReason: string;
};

type RiskAuditChecklistDetailPayload = {
  label: string;
  checked: boolean;
};

type RiskAuditPreflightIssueDetailPayload = {
  code: string;
  scope: string;
  stage: string;
  message: string;
  nextAction: string;
  platform?: string;
  account?: string;
  field?: string;
  filePath?: string;
};

type RiskAuditConfirmationDetailPayload = {
  type: 'audit-confirmation';
  label: string;
  summary: string;
  operator?: string;
  confirmedAt?: string;
  confirmationId?: string;
  confirmedAction?: string;
  confirmedRiskLevel?: string;
  reason?: string;
  checklist?: RiskAuditChecklistDetailPayload[];
  fullPermission?: boolean;
};

type RiskAuditPublishPayloadDetailPayload = {
  type: 'publish-payload';
  label: string;
  summary: string;
  platform: string;
  accountId?: string;
  contentKind?: string;
  title?: string;
  materialCount: number;
  coverCount: number;
  tagCount: number;
  scheduleSummary?: string;
  dryRun?: boolean;
};

type RiskAuditPreflightDetailPayload = {
  type: 'publish-preflight';
  label: string;
  summary: string;
  ok: boolean;
  checkedAt: string;
  issueCount: number;
  payloadCount: number;
  accountCount: number;
  materialCount: number;
  issues: RiskAuditPreflightIssueDetailPayload[];
};

type RiskAuditPlatformDetailPayload = {
  type: 'publish-platform';
  label: string;
  platform: string;
  accountId?: string;
  status: AutoUploadPublishPlatformEntry['status'];
  statusLabel: string;
  summary: string;
  failureReason?: string;
  nextAction?: string;
  publishTaskId?: string;
  publishUrl?: string;
  externalId?: string;
  evidenceSource?: string;
  evidenceUrl?: string;
};

type RiskAuditDetailPayload =
  | RiskAuditConfirmationDetailPayload
  | RiskAuditPublishPayloadDetailPayload
  | RiskAuditPreflightDetailPayload
  | RiskAuditPlatformDetailPayload;

@Injectable()
export class AutoUploadService {
  private legacyPublishHistoryImport?: Promise<void>;

  constructor(
    private readonly autoUploadClient: AutoUploadClient,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly systemLogsService?: SystemLogsService,
    @Optional()
    @Inject(forwardRef(() => LocalEngineService))
    private readonly localEngineService?: LocalEngineService,
    @Optional()
    private readonly injectedPublishRecordStore?: PublishRecordStore,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly riskPolicyService?: RiskPolicyService,
    @Optional() private readonly imagePreprocessor?: RemoteImagePreprocessor,
  ) {}

  private get publishRecordStore() {
    return (
      this.injectedPublishRecordStore ??
      new PublishRecordStore(this.prisma, this.authRequestContext)
    );
  }

  private async preprocessImages(
    payloads: AutoUploadPublishPayload[],
  ): Promise<void> {
    if (!this.imagePreprocessor) return;
    try {
      await this.imagePreprocessor.preprocessPayloads(payloads);
    } catch {
      // best-effort: if preprocessing fails, continue with original URLs
    }
  }

  getHealth() {
    return this.autoUploadClient.getHealth();
  }

  getInteractionCapabilities() {
    return this.autoUploadClient.getInteractionCapabilities();
  }

  getCdpSessions() {
    return this.autoUploadClient.getCdpSessions();
  }

  previewInteractionEvidenceCleanup(retentionDays?: number) {
    return this.autoUploadClient.previewInteractionEvidenceCleanup(
      retentionDays,
    );
  }

  async cleanupInteractionEvidence(
    retentionDays?: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const riskAudit = assertBackendRiskGate({
      action: 'local-file-delete',
      target: `interaction-evidence:retentionDays=${retentionDays ?? 7}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.confirmation,
      context: options.context,
      reason: '清理互动证据会删除本地截图/日志文件。',
    });

    const result =
      await this.autoUploadClient.cleanupInteractionEvidence(retentionDays);
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '清理互动证据',
      targetLabel: `保留 ${retentionDays ?? 7} 天`,
    });

    return { ...result, riskAudit };
  }

  async listAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }) {
    const accounts = this.dedupeAccounts(
      await this.autoUploadClient.listAccounts(options),
    );
    return this.decorateAccountSessionStatus(accounts);
  }

  async listAccountPage(options: {
    page?: number;
    pageSize?: number;
    search?: string;
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }): Promise<AutoUploadPage<AutoUploadAccount>> {
    const result = await this.autoUploadClient.listAccountPage(options);
    return {
      ...result,
      items: await this.decorateAccountSessionStatus(
        this.dedupeAccounts(result.items),
      ),
    };
  }

  private async decorateAccountSessionStatus(accounts: AutoUploadAccount[]) {
    // 当前 browser/CDP session 是账号级真值。历史执行记录不能按平台
    // 覆盖多个账号，否则同平台账号会互换登录状态。
    const currentSessionMap = await this.getCurrentAccountSessionStatusMap();
    return accounts.map((acc) => {
      const current = currentSessionMap.get(
        this.accountSessionKey(acc.platform, acc.id),
      );
      if (!current || current.status === 'unknown') return acc;
      const ready = current.status === 'logged_in';
      return {
        ...acc,
        status: ready ? 1 : 0,
        statusCode: ready ? 'ready' : 'expired',
        statusLabel: ready ? '已登录' : '需要重新登录',
        sessionStatus: current.status,
        lastDispatchAt: current.lastDispatchAt,
        lastDispatchOk: current.lastOk,
        lastDispatchReason: current.lastReason,
      };
    });
  }

  private async getCurrentAccountSessionStatusMap(): Promise<
    Map<string, AccountSessionStatus>
  > {
    try {
      const cdp = await this.withTimeout(
        this.autoUploadClient.getCdpSessions(),
        CURRENT_SESSION_STATUS_TIMEOUT_MS,
        '当前平台会话读取超时',
      );
      const now = cdp.checkedAt || new Date().toISOString();
      const map = new Map<string, AccountSessionStatus>();
      for (const session of cdp.sessions ?? []) {
        const key = this.accountSessionKey(session.platform, session.accountId);
        map.set(key, this.mapCdpSessionToAccountSessionStatus(session, now));
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private mapCdpSessionToAccountSessionStatus(
    session: AutoUploadCdpBrowserSession,
    checkedAt: string,
  ): AccountSessionStatus {
    if (session.status === 'ready') {
      return {
        status: 'logged_in',
        lastDispatchAt: checkedAt,
        lastOk: true,
        lastReason: 'browser_session_ready',
      };
    }
    if (session.status === 'needs_login') {
      return {
        status: 'needs_login',
        lastDispatchAt: checkedAt,
        lastOk: false,
        lastReason: 'browser_session_needs_login',
      };
    }
    if (session.status === 'blocked') {
      return {
        status: 'error',
        lastDispatchAt: checkedAt,
        lastOk: false,
        lastReason: 'browser_session_blocked',
      };
    }
    return {
      status: 'unknown',
      lastDispatchAt: checkedAt,
      lastOk: false,
      lastReason: `browser_session_${String(session.status || 'unknown')}`,
    };
  }

  private accountSessionKey(
    platform: string | number,
    accountId: string | number,
  ) {
    return `${this.normalizePlatformKey(platform)}:${String(accountId)}`;
  }

  private normalizePlatformKey(platform: string | number) {
    const raw = String(platform || '').trim();
    for (const [key, aliases] of Object.entries(PLATFORM_NAME_ALIASES)) {
      if (aliases.includes(raw)) {
        return key.includes('-') || /^[a-z]/i.test(key)
          ? key
          : (aliases.find((item) => /^[a-z]/i.test(item)) ?? key);
      }
    }
    return raw;
  }

  async getAccountHealth(
    options: { validate?: boolean; force?: boolean } = {},
  ): Promise<AutoUploadAccountHealth> {
    let accounts: AutoUploadAccount[] = [];
    let accountError: string | null = null;
    try {
      accounts = await this.withTimeout(
        this.autoUploadClient.listAccounts({
          validate: options.validate ?? false,
          force: options.force,
        }),
        ACCOUNT_HEALTH_ACCOUNT_READ_TIMEOUT_MS,
        '账号状态读取超时',
      );
    } catch (error) {
      accountError =
        error instanceof Error ? error.message : '本地发布引擎不可用';
    }
    const tasks = await this.autoUploadClient.listTasks(200).catch(() => []);
    const uniqueAccounts = this.dedupeAccounts(accounts);
    const accountByFile = this.mapAccountsByFile(uniqueAccounts);
    const issues: AutoUploadAccountHealthIssue[] = uniqueAccounts
      .filter((account) => account.status !== 1)
      .map((account) => this.createAccountIssue(account));
    if (accountError) {
      issues.unshift({
        accountName: '本机发布服务',
        platform: '本机发布服务',
        status: 'missing',
        message: `暂时无法读取平台账号：${accountError}`,
        nextAction: '请确认本机发布服务可用，再刷新账号状态。',
      });
    }
    const waitingTasks = this.findAccountBlockedTasks(tasks, accountByFile);

    return {
      checkedAt: new Date().toISOString(),
      totalAccounts: uniqueAccounts.length,
      readyAccounts: uniqueAccounts.filter((account) => account.status === 1)
        .length,
      expiredAccounts: uniqueAccounts.filter((account) => account.status !== 1)
        .length,
      issues,
      waitingTasks,
    };
  }

  async prepareAccountRelogin(
    id: number,
    options: { platform?: string } = {},
  ): Promise<AutoUploadAccountReloginRecovery> {
    const targetPlatform = options.platform
      ? this.normalizePlatformKey(options.platform)
      : null;
    const accounts = await this.autoUploadClient.listAccounts({
      validate: false,
      force: true,
      ids: [id],
    });
    const account = accounts.find((item) => {
      if (item.id !== id) return false;
      if (!targetPlatform) return true;
      return this.normalizePlatformKey(item.platform) === targetPlatform;
    });
    if (!account) {
      throw new NotFoundException('平台账号不存在，请先刷新账号列表');
    }
    const [opened, tasks] = await Promise.all([
      this.autoUploadClient.openAccounts([id], {
        platform: targetPlatform ?? undefined,
      }),
      this.autoUploadClient.listTasks(200).catch(() => []),
    ]);
    const currentSessionMap = await this.getCurrentAccountSessionStatusMap();
    const currentSession = currentSessionMap.get(
      this.accountSessionKey(account.platform, account.id),
    );
    const openedAccount = opened.openedAccounts?.find(
      (item) =>
        String(item.accountId) === String(account.id) &&
        this.normalizePlatformKey(item.platform) ===
          this.normalizePlatformKey(account.platform),
    );
    const openedStatus =
      openedAccount?.status === 'ready'
        ? 'logged_in'
        : openedAccount?.status === 'needs_login'
          ? 'needs_login'
          : undefined;
    const sessionStatus = openedStatus ?? currentSession?.status;
    const sessionReady = sessionStatus === 'logged_in';
    const sessionReason =
      openedAccount?.lastError ||
      currentSession?.lastReason ||
      '未检测到有效平台会话';
    const accountByFile = this.mapAccountsByFile(accounts);
    const resumeCandidates = this.findAccountBlockedTasks(
      tasks,
      accountByFile,
    ).filter((task) => task.accountFile === account.filePath);

    return {
      checkedAt: new Date().toISOString(),
      account: {
        id: account.id,
        accountName: this.resolveAccountName(account),
        platform: account.platform,
        status: sessionReady ? 'ready' : 'expired',
        statusLabel: sessionReady ? '已登录' : '需要登录',
      },
      opened: opened.opened,
      resumeCandidates,
      nextAction: sessionReady
        ? resumeCandidates.length
          ? '账号当前可用，可点击“恢复阻断任务”重试这些任务。'
          : '账号当前可用，暂无因该账号阻断的待恢复任务。'
        : `请在本机打开的 ${account.platform} 后台完成扫码或登录，再刷新校验；当前状态来自浏览器会话：${sessionReason}。`,
    };
  }

  openAccounts(ids: (number | string)[], options: { platform?: string } = {}) {
    return this.autoUploadClient.openAccounts(ids, options);
  }

  openInteractionEntry(input: { accountId: number; entryType: string }) {
    return this.autoUploadClient.openInteractionEntry(input);
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  readDouyinComments(input: {
    accountId: number;
    limit?: number;
    parsingRules?: unknown;
  }) {
    return this.autoUploadClient.readDouyinComments(input);
  }

  readDouyinMessages(input: { accountId: number; limit?: number }) {
    return this.autoUploadClient.readDouyinMessages(input);
  }

  readWechatChannelComments(input: { accountId: number; limit?: number }) {
    return this.autoUploadClient.readWechatChannelComments(input);
  }

  readWechatChannelMessages(input: { accountId: number; limit?: number }) {
    return this.autoUploadClient.readWechatChannelMessages(input);
  }

  getWechatDesktopStatus() {
    return this.autoUploadClient.getWechatDesktopStatus();
  }

  listWechatWindows() {
    return this.autoUploadClient.listWechatWindows();
  }

  resolveWechatContact(query: string) {
    return this.autoUploadClient.resolveWechatContact(query);
  }

  alignWechatContact(query: string) {
    return this.autoUploadClient.alignWechatContact(query);
  }

  dismissWechatPopup() {
    return this.autoUploadClient.dismissWechatPopup();
  }

  checkWechatAlive() {
    return this.autoUploadClient.checkWechatAlive();
  }

  draftWechatReply(input: { targetText?: string; replyText: string }) {
    return this.autoUploadClient.draftWechatReply(input);
  }

  sendWechatReply(input: { targetText?: string; replyText: string }) {
    return this.autoUploadClient.sendWechatReply(input);
  }

  refreshAccountAvatar(id: number) {
    return this.autoUploadClient.refreshAccountAvatar(id);
  }

  hasAccountAvatar(filename: string) {
    return this.autoUploadClient.hasAccountAvatar(filename);
  }

  async deleteAccount(
    id: number,
    options: {
      platform?: string;
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const riskAudit = assertBackendRiskGate({
      action: 'platform-account-delete',
      target: `account:${options.platform ? `${options.platform}:` : ''}${id}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.confirmation,
      context: options.context,
      reason: '删除平台账号会移除本地账号绑定和登录态引用。',
    });
    const result = await this.autoUploadClient.deleteAccount(id, options.platform);
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '删除平台账号',
      targetLabel: `${options.platform ? `${options.platform} ` : ''}账号 ${id}`,
    });

    return { ...(result || {}), riskAudit };
  }

  buildLoginUrl(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }) {
    return this.autoUploadClient.buildLoginUrl(input);
  }

  streamAccountLogin(input: {
    type: number;
    profileName: string;
    requestId: string;
    update?: boolean;
    recordId?: number;
  }) {
    return this.autoUploadClient.streamAccountLogin(input);
  }

  cancelLogin(requestId: string) {
    return this.autoUploadClient.cancelLogin(requestId);
  }

  listMaterials() {
    return this.autoUploadClient.listMaterials();
  }

  async listLogs(limit = 80) {
    const platformLogs = await this.autoUploadClient.listLogs(limit);
    const interactionLog = await this.buildInteractionLog(limit);

    return interactionLog ? [interactionLog, ...platformLogs] : platformLogs;
  }

  async listTasks(limit?: number) {
    const safeLimit = Number.isInteger(limit)
      ? Math.max(1, Math.min(200, Math.floor(limit as number)))
      : 50;
    await this.ensureLegacyPublishHistoryImported();
    const records = await this.publishRecordStore.list(safeLimit);
    return records
      .map((record) => this.durablePublishRecordToTask(record))
      .filter((task) => !this.isInternalPublishTestTask(task))
      .slice(0, safeLimit);
  }

  async executeClaimedDurableTask(record: DurablePublishRecord) {
    const payloads = record.envelope.payloads;
    const title = record.envelope.title;
    await this.preprocessImages(payloads);
    const response = await this.publishBatchWithTracking(payloads, title);
    const publishEntries = this.buildEnginePublishEntries(payloads, response);
    const batchResult = {
      ...this.buildBatchResult(publishEntries),
      agentSessionId: response?.agentSessionId,
    };
    await this.publishRecordStore.updateResult(record, batchResult, {
      engineTaskIds: response?.taskIds,
      agentSessionId: response?.agentSessionId,
    });
  }

  async listTaskPage(query: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
    platform?: string;
  }) {
    await this.ensureLegacyPublishHistoryImported();
    const statusMap: Record<string, DurablePublishRecordPageQuery['status']> = {
      confirmed: 'completed',
      completed: 'completed',
      failed: 'failed',
      waiting: 'waiting',
    };
    const page = await this.publishRecordStore.listPage({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status ? statusMap[query.status] : undefined,
      platform:
        query.platform && query.platform !== 'all' ? query.platform : undefined,
    });
    const items = page.items
      .map((record) => this.durablePublishRecordToTask(record))
      .filter((task) => !this.isInternalPublishTestTask(task));
    const total = Math.max(0, page.total - (page.items.length - items.length));
    return {
      ...page,
      items,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageSize)),
    };
  }

  async createRetryPublishConfirmation(
    id: number,
    context?: BackendRiskContext,
  ) {
    await this.ensureLegacyPublishHistoryImported();
    const prepared = await this.prepareRetryPublishTask(id);
    const scope = await this.resolvePublishApprovalScope(context);
    const target = await this.buildRetryPublishApprovalTarget(prepared, scope);
    return this.requireRiskPolicyService().issueHighRiskApproval(
      {
        action: 'retry-publish',
        riskLevel: 'high',
        target,
        reason: `确认重新提交发布记录 ${id} 的 ${prepared.retryPayloads.length} 个失败平台。`,
      },
      scope,
    );
  }

  async retryPublishTask(
    id: number,
    options: {
      confirmationId?: string;
      context?: BackendRiskContext;
    } = {},
  ) {
    await this.ensureLegacyPublishHistoryImported();
    const prepared = await this.prepareRetryPublishTask(id);
    const scope = await this.resolvePublishApprovalScope(options.context);
    const target = await this.buildRetryPublishApprovalTarget(prepared, scope);
    const confirmation =
      await this.requireRiskPolicyService().consumeHighRiskApproval(
        {
          confirmationId: options.confirmationId,
          action: 'retry-publish',
          riskLevel: 'high',
          target,
          reason: `重试发布会重新提交 ${prepared.retryPayloads.length} 个失败平台。`,
        },
        scope,
      );
    const refreshed = await this.prepareRetryPublishTask(id);
    const refreshedTarget = await this.buildRetryPublishApprovalTarget(
      refreshed,
      scope,
    );
    if (refreshedTarget !== target) {
      throw new ConflictException(
        '发布记录、账号或素材在确认后发生变化，请重新确认后再重试。',
      );
    }
    const riskAudit = assertBackendRiskGate({
      action: 'retry-publish',
      target,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation,
      context: options.context,
      reason: `重试发布会重新提交 ${prepared.retryPayloads.length} 个失败平台。`,
    });
    return this.executePreparedRetryPublishTask(refreshed, riskAudit);
  }

  private async prepareRetryPublishTask(
    id: number,
  ): Promise<PreparedRetryPublishTask> {
    const durableRecord = await this.publishRecordStore.findByPublicId(id);
    if (!durableRecord) {
      throw new NotFoundException('发布任务不存在');
    }
    const task = this.durablePublishRecordToTask(durableRecord);
    if (!this.hasRetryablePublishFailure(durableRecord.envelope.result)) {
      throw new BadRequestException(
        '只有包含失败平台的有效发布记录才能重试；等待确认或已完成记录不能重复提交。',
      );
    }

    if (!task.account_file) {
      throw new BadRequestException('发布任务缺少账号信息，无法重试');
    }

    const recordedPayload = durableRecord.envelope.payloads[0];
    const payloadSource = recordedPayload ? 'recorded' : 'reconstructed';
    const payload = recordedPayload
      ? this.normalizeRetryPayload(recordedPayload, task)
      : this.reconstructRetryPayload(task);
    const restoredFields = this.describeRestoredPayloadFields(payload, task);
    const missingFields = this.describeMissingPayloadFields(payload);

    const previousBatchResult = durableRecord.envelope.result;

    const retryEntries = previousBatchResult.platforms.filter((entry) =>
      this.isRetryablePublishStatus(entry.status),
    );
    const retryPayloads = this.findPayloadsForPlatformEntries(
      durableRecord.envelope.payloads,
      retryEntries,
    );
    if (!retryPayloads.length) {
      retryPayloads.push(payload);
    }

    return {
      durableRecord,
      task,
      payloadSource,
      restoredFields,
      missingFields,
      retryPayloads,
    };
  }

  private async executePreparedRetryPublishTask(
    prepared: PreparedRetryPublishTask,
    riskAudit: BackendRiskAuditEvent,
  ) {
    await this.assertPublishPreflightReady(prepared.retryPayloads);
    const execution = await this.executeDurablePublishRecord(
      prepared.retryPayloads,
      prepared.retryPayloads.length > 1 ? '失败平台重试' : '发布任务重试',
    );
    const sanitizedResult = this.sanitizePublishResponse(execution.response);
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '重试发布任务',
      targetLabel: `发布记录 ${prepared.task.id}`,
      detail: `retried=${prepared.retryPayloads.length};newRecord=${execution.record.publicId}`,
    });

    return {
      retriedFrom: prepared.task.id,
      task: prepared.task,
      payloadSource: prepared.payloadSource,
      restoredFields: prepared.restoredFields,
      missingFields: prepared.missingFields,
      riskAudit,
      result: sanitizedResult,
      publishRecordId: execution.record.publicId,
      retryResults: prepared.retryPayloads.map((retryPayload, index) => {
        const engineResult = sanitizedResult?.results?.[index];
        return {
          taskId: String(
            sanitizedResult?.taskIds?.[index] ?? execution.record.publicId,
          ),
          platform: this.resolvePlatformName(retryPayload.type),
          status: engineResult?.ok === false ? 'failed' : 'retried',
          message:
            engineResult?.message ||
            (engineResult?.ok === true
              ? '平台已确认'
              : '已重新提交，等待平台确认'),
        };
      }),
    };
  }

  async deletePublishTask(
    id: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const riskAudit = assertBackendRiskGate({
      action: 'local-file-delete',
      target: `publish-task:${id}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.confirmation,
      context: options.context,
      reason:
        '删除发布记录会修改本地发布留存，删除后不能在列表中回溯该条聚合记录。',
    });

    await this.ensureLegacyPublishHistoryImported();
    const record = await this.publishRecordStore.findByPublicId(id);
    if (!record) {
      throw new NotFoundException('发布记录不存在或不是有效的发布记录');
    }
    await this.publishRecordStore.delete(record);
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '删除发布记录',
      targetLabel: `发布任务 ${id}`,
    });

    return {
      id,
      deletedRecordKey: String(id),
      message: '发布记录已删除',
      riskAudit,
    };
  }

  /** 发布日历：近 N 天任务按天分组 */
  async listPublishCalendar(days?: number) {
    await this.ensureLegacyPublishHistoryImported();
    return this.publishRecordStore.listCalendar(
      days && Number.isInteger(days) ? days : 7,
    );
  }

  /** 取消排队中的发布任务（仅等待中/未认领） */
  async cancelPublishTask(id: number) {
    await this.ensureLegacyPublishHistoryImported();
    const record = await this.publishRecordStore.findByPublicId(id);
    if (!record) {
      throw new NotFoundException('发布记录不存在或不是有效的发布记录');
    }
    const cancelled = await this.publishRecordStore.cancelTask(record);
    return {
      id,
      status: cancelled.status,
      message: '任务已取消，不再执行发布。',
    };
  }

  /** 改期：记录计划发布时间，到点由扫描器重新入队执行 */
  async reschedulePublishTask(id: number, plannedAt: string) {
    await this.ensureLegacyPublishHistoryImported();
    const record = await this.publishRecordStore.findByPublicId(id);
    if (!record) {
      throw new NotFoundException('发布记录不存在或不是有效的发布记录');
    }
    const updated = await this.publishRecordStore.rescheduleTask(record, {
      plannedAt,
    });
    return {
      id,
      status: updated.status,
      plannedAt: updated.envelope.plannedAt,
      message: updated.message,
    };
  }

  /** 后台扫描：到点的改期任务重新入队；返回入队数量 */
  async reenqueueDueScheduledPublishes(): Promise<number> {
    try {
      return await this.publishRecordStore.reenqueueDueScheduled();
    } catch {
      return 0;
    }
  }

  async preflightPublishBatch(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishPreflightResult> {
    const issues: AutoUploadPublishPreflightIssue[] = [];
    const checkedAt = new Date().toISOString();
    issues.push(...(await this.collectArticlePublishIdentityIssues(payloads)));
    const accountFiles = Array.from(
      new Set(
        payloads
          .flatMap((payload) => payload.accountList || [])
          .filter(Boolean),
      ),
    );
    const materialFiles = Array.from(
      new Set(
        payloads.flatMap((payload) => payload.fileList || []).filter(Boolean),
      ),
    );
    const coverFiles = Array.from(
      new Set(
        payloads
          .flatMap((payload) => [
            payload.coverPath,
            ...Object.values(payload.coverPaths || {}),
          ])
          .filter((filePath): filePath is string => Boolean(filePath)),
      ),
    );
    let accountByFile = new Map<string, AutoUploadAccount>();

    try {
      const health = await this.autoUploadClient.getHealth();
      if (!health.online) {
        issues.push({
          code: 'engine_unavailable',
          scope: 'engine',
          stage: '发布服务在线检查',
          platform: '本机发布服务',
          account: '自动化服务',
          message: `本机发布服务暂不可用：${health.status}`,
          nextAction: '请打开运行检查，确认发布服务和浏览器权限正常。',
        });
      }
    } catch (error) {
      issues.push({
        code: 'engine_unavailable',
        scope: 'engine',
        stage: '发布服务在线检查',
        platform: '本机发布服务',
        account: '自动化服务',
        message: `本机发布服务暂时无法连接：${error instanceof Error ? error.message : '请稍后重试'}`,
        nextAction: '请打开运行检查，确认发布服务和浏览器权限正常。',
      });
    }

    if (!payloads.length) {
      issues.push({
        code: 'payload_empty',
        scope: 'payload',
        stage: '发布参数检查',
        message: '没有可发布的内容。',
        nextAction: '请选择至少一个平台账号和素材后再提交发布。',
      });
    }

    payloads.forEach((payload, index) => {
      const platform = this.resolvePlatformName(payload.type);
      const accountLabel = this.resolvePayloadAccountLabel(payload);
      if (!payload.accountList?.length) {
        issues.push({
          code: 'account_missing',
          scope: 'account',
          stage: '账号检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: '未选择账号',
          message: `${platform} 未选择发布账号。`,
          nextAction: '请先在发布中心选择已登录账号。',
        });
      }
      if (!payload.fileList?.length) {
        issues.push({
          code: 'material_missing',
          scope: 'material',
          stage: '素材检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          message: `${platform} 未选择发布素材。`,
          nextAction: '请先上传或选择图文/视频素材。',
        });
      }
      if (
        payload.contentKind !== 'article' &&
        payload.contentKind !== 'video'
      ) {
        issues.push({
          code: 'content_kind_missing',
          scope: 'payload',
          stage: '图文/视频参数检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          field: 'contentKind',
          message: `${platform} 未声明图文或视频发布类型。`,
          nextAction: '请从图文发布或视频发布入口重新提交。',
        });
      }
      if (!payload.title?.trim()) {
        issues.push({
          code: 'title_missing',
          scope: 'payload',
          stage: '发布参数检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          field: 'title',
          message: `${platform} 发布缺少标题。`,
          nextAction: '请填写发布标题后重试。',
        });
      }
      if (payload.contentKind === 'video') {
        this.collectVideoParameterIssues(payload, index, issues);
      }
      if (payload.type === 5 && payload.contentKind === 'article') {
        issues.push({
          code: 'platform_not_supported',
          scope: 'payload',
          stage: '平台能力检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          field: 'contentKind',
          message: 'B站图文发布未接入；当前仅支持 B站视频投稿。',
          nextAction: '请切换到视频发布，或暂不选择 B站账号。',
        });
      }
      if (payload.type === 5 && !payload.biliTitle && !payload.title) {
        issues.push({
          code: 'title_missing',
          scope: 'payload',
          stage: 'B站参数检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          field: 'biliTitle',
          message: 'B站发布缺少标题。',
          nextAction: '请填写 B站标题后重试。',
        });
      }
      if (payload.type === 5 && !payload.biliPartition) {
        issues.push({
          code: 'bili_partition_missing',
          scope: 'payload',
          stage: 'B站参数检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          field: 'biliPartition',
          message: 'B站发布缺少分区。',
          nextAction: '请先选择 B站分区后重试。',
        });
      }
    });

    if (accountFiles.length) {
      try {
        const accounts = await this.autoUploadClient.listAccounts({
          validate: true,
          force: true,
          ...this.resolvePayloadAccountIdsOption(payloads),
        });
        accountByFile = this.mapAccountsByFile(accounts);
        for (const accountFile of accountFiles) {
          const account = accountByFile.get(accountFile);
          if (!account) {
            const platform = this.resolvePlatformForAccountFile(
              payloads,
              accountFile,
            );
            issues.push({
              code: 'account_missing',
              scope: 'account',
              stage: '账号检查',
              accountFile,
              platform,
              account: '未识别账号',
              message: `未找到 ${platform || '所选平台'} 的发布账号。`,
              nextAction: '请到平台账号页重新选择或绑定账号。',
            });
            continue;
          }
          if (account.status !== 1) {
            const issue = this.createAccountIssue(account);
            issues.push({
              code: 'account_expired',
              scope: 'account',
              stage: '账号检查',
              accountFile: issue.accountFile,
              platformType: issue.platformType,
              platform: issue.platform,
              account: issue.accountName,
              message: issue.message,
              nextAction: issue.nextAction,
            });
          }
        }
      } catch (error) {
        issues.push({
          code: 'engine_unavailable',
          scope: 'engine',
          stage: '账号检查',
          platform: '本机发布服务',
          account: '自动化服务',
          message: `发布前暂时无法检查账号：${error instanceof Error ? error.message : '请稍后重试'}`,
          nextAction: '请确认本机发布服务可用，并检查平台账号登录状态。',
        });
      }
    }

    const materialKinds = new Map<string, AutoUploadMaterialKind>();
    for (const filePath of materialFiles) {
      const issue = await this.checkReadablePublishFile(filePath, 'material');
      if (issue) {
        issues.push(issue);
        continue;
      }
      materialKinds.set(filePath, this.resolveMaterialKind(filePath));
    }

    for (const filePath of coverFiles) {
      const issue = await this.checkReadablePublishFile(filePath, 'cover');
      if (issue) {
        issues.push(issue);
        continue;
      }
      const kind = this.resolveMaterialKind(filePath);
      if (kind !== 'image') {
        issues.push({
          code: 'cover_type_mismatch',
          scope: 'cover',
          stage: '封面检查',
          filePath,
          expected: '图片文件',
          actual: this.resolveMaterialKindLabel(kind),
          message: '所选封面不是图片文件。',
          nextAction: '请为封面选择 png、jpg、jpeg、webp 或 gif 图片。',
        });
      }
    }

    payloads.forEach((payload, index) => {
      const platform = this.resolvePlatformName(payload.type);
      const accountLabel = this.resolveAccountLabelForPayload(
        payload,
        accountByFile,
      );
      const expectedKind =
        payload.contentKind === 'article'
          ? 'image'
          : payload.contentKind === 'video'
            ? 'video'
            : null;
      if (!expectedKind) return;

      for (const filePath of payload.fileList || []) {
        const actualKind = materialKinds.get(filePath);
        if (!actualKind || actualKind === expectedKind) continue;
        issues.push({
          code: 'material_type_mismatch',
          scope: 'material',
          stage: '图文/视频素材检查',
          payloadIndex: index,
          platformType: payload.type,
          platform,
          account: accountLabel,
          filePath,
          expected: expectedKind === 'image' ? '图片素材' : '视频素材',
          actual: this.resolveMaterialKindLabel(actualKind),
          message: `${platform} ${payload.contentKind === 'article' ? '图文发布' : '视频发布'}的素材类型不匹配。`,
          nextAction:
            payload.contentKind === 'article'
              ? '请只选择 png、jpg、jpeg、webp 或 gif 图片素材。'
              : '请只选择 mp4、mov、m4v 或 webm 视频素材。',
        });
      }
    });

    return {
      ok: issues.length === 0,
      checkedAt,
      summary: issues.length
        ? `发布前检查未通过：${issues.map((issue) => this.formatPreflightIssue(issue)).join('；')}`
        : `发布前检查通过：${payloads.length} 个发布目标，${accountFiles.length} 个账号，${materialFiles.length} 个素材，${coverFiles.length} 个封面。`,
      payloadCount: payloads.length,
      accountCount: accountFiles.length,
      materialCount: materialFiles.length,
      issues,
    };
  }

  async createResumeBlockedTasksConfirmation(
    accountId?: number,
    context?: BackendRiskContext,
  ) {
    await this.ensureLegacyPublishHistoryImported();
    const state = await this.loadResumeBlockedPublishState(accountId);
    if (!state.candidates.length) {
      throw new BadRequestException('没有可恢复的阻断发布任务');
    }
    const scope = await this.resolvePublishApprovalScope(context);
    const snapshot = await this.buildResumeBlockedApprovalSnapshot(
      accountId,
      state,
      scope,
    );
    return this.requireRiskPolicyService().issueHighRiskApproval(
      {
        action: 'resume-blocked-publish',
        riskLevel: 'high',
        target: snapshot.target,
        reason: `确认恢复 ${state.candidates.length} 个账号阻断发布任务。`,
      },
      scope,
    );
  }

  async resumeAccountBlockedTasks(
    accountId?: number,
    options: {
      confirmationId?: string;
      context?: BackendRiskContext;
    } = {},
  ): Promise<AutoUploadResumeBlockedTasksResult> {
    await this.ensureLegacyPublishHistoryImported();
    const state = await this.loadResumeBlockedPublishState(accountId);
    const scope = await this.resolvePublishApprovalScope(options.context);
    const snapshot = await this.buildResumeBlockedApprovalSnapshot(
      accountId,
      state,
      scope,
    );
    const confirmation =
      await this.requireRiskPolicyService().consumeHighRiskApproval(
        {
          confirmationId: options.confirmationId,
          action: 'resume-blocked-publish',
          riskLevel: 'high',
          target: snapshot.target,
          reason: '恢复阻断任务可能批量重新提交外部平台发布。',
        },
        scope,
      );
    const refreshedState = await this.loadResumeBlockedPublishState(accountId);
    const refreshedSnapshot = await this.buildResumeBlockedApprovalSnapshot(
      accountId,
      refreshedState,
      scope,
    );
    if (refreshedSnapshot.target !== snapshot.target) {
      throw new ConflictException(
        '阻断任务、账号或素材在确认后发生变化，请重新确认后再恢复。',
      );
    }
    const riskAudit = assertBackendRiskGate({
      action: 'resume-blocked-publish',
      target: refreshedSnapshot.target,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation,
      context: options.context,
      reason: '恢复阻断任务可能批量重新提交外部平台发布。',
    });
    const results: AutoUploadResumeBlockedTasksResult['results'] = [];
    const { accountByFile, candidates } = refreshedState;

    for (const task of candidates) {
      const account = accountByFile.get(task.accountFile);
      if (!account || account.status !== 1) {
        results.push({
          taskId: task.id,
          title: task.title,
          platform: task.platform,
          accountFile: task.accountFile,
          status: 'skipped',
          message: account
            ? `${account.platform}账号「${this.resolveAccountName(account)}」仍未恢复登录，请先扫码或登录。`
            : '未找到原发布账号，请重新选择或绑定。',
        });
        continue;
      }

      try {
        const prepared = refreshedSnapshot.preparedByTaskId.get(task.id);
        if (!prepared) {
          throw new ConflictException(
            '发布记录已不可重试，请重新检查任务状态。',
          );
        }
        const retry = await this.executePreparedRetryPublishTask(
          prepared,
          riskAudit,
        );
        results.push({
          taskId: task.id,
          title: task.title,
          platform: task.platform,
          accountFile: task.accountFile,
          status: 'resumed',
          message: `${account.platform}账号「${this.resolveAccountName(account)}」已恢复，已重新提交任务。`,
          retryResult: retry.result,
        });
      } catch (error) {
        results.push({
          taskId: task.id,
          title: task.title,
          platform: task.platform,
          accountFile: task.accountFile,
          status: 'failed',
          message: error instanceof Error ? error.message : '恢复任务失败',
        });
      }
    }

    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '恢复阻断发布任务',
      targetLabel: accountId
        ? `账号 ${accountId}`
        : `阻断任务 ${candidates.length} 个`,
      detail: `resumed=${results.filter((item) => item.status === 'resumed').length};skipped=${results.filter((item) => item.status !== 'resumed').length}`,
    });

    return {
      checkedAt: new Date().toISOString(),
      riskAudit,
      resumed: results.filter((item) => item.status === 'resumed').length,
      skipped: results.filter((item) => item.status !== 'resumed').length,
      results,
    };
  }

  private async loadResumeBlockedPublishState(
    accountId?: number,
  ): Promise<ResumeBlockedPublishState> {
    const [accounts, tasks] = await Promise.all([
      this.autoUploadClient.listAccounts({ validate: true, force: true }),
      this.autoUploadClient.listTasks(200),
    ]);
    const accountByFile = this.mapAccountsByFile(accounts);
    const allowedFiles = new Set(
      accounts
        .filter((account) => (accountId ? account.id === accountId : true))
        .map((account) => account.filePath),
    );
    const candidates = this.findAccountBlockedTasks(
      tasks,
      accountByFile,
    ).filter((task) => allowedFiles.has(task.accountFile));
    return { accountByFile, candidates };
  }

  async uploadMaterial(file: AutoUploadUploadFile, filename?: string) {
    return this.autoUploadClient.uploadMaterial({ file, filename });
  }

  /** 保存内存素材（视频成片等）：复用客户端写文件+索引逻辑 */
  async saveMaterialBuffer(buffer: Buffer, filename: string) {
    const fakeFile = {
      fieldname: 'file',
      originalname: filename,
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: buffer.byteLength,
      buffer,
    } as AutoUploadUploadFile;
    return this.autoUploadClient.uploadMaterial({
      file: fakeFile,
      filename,
    });
  }

  async importArticleMaterials(articleId: string) {
    const ownerScope = await this.resolvePublishOwnerScope();
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, ...ownerScope },
    });
    if (!article) {
      throw new NotFoundException('内容不存在');
    }

    if (article.contentType !== 'xiaohongshu') {
      throw new BadRequestException('当前仅支持导入小红书笔记卡图');
    }

    const xiaohongshuData = article.xiaohongshuData as {
      slides?: Array<{
        cardImageUrl?: string | null;
        imageUrl?: string | null;
        title?: string;
        coverText?: string;
      }>;
    } | null;
    const slides = Array.isArray(xiaohongshuData?.slides)
      ? xiaohongshuData.slides
      : [];
    const targets = slides
      .map((slide, index) => ({
        index,
        url: slide.cardImageUrl || slide.imageUrl || '',
        title: slide.title || slide.coverText || article.title,
      }))
      .filter((item) => item.url);

    if (!targets.length) {
      throw new BadRequestException('这篇小红书笔记没有可导入的成品卡图');
    }

    const imported: AutoUploadMaterial[] = [];
    const failures: Array<{ index: number; message: string }> = [];

    for (const target of targets) {
      try {
        const file = await this.loadRemoteFile(
          target.url,
          `${this.safeBaseName(article.title)}-${String(target.index + 1).padStart(2, '0')}`,
        );
        const result = await this.autoUploadClient.uploadMaterial({
          file,
          filename: `${this.safeBaseName(article.title)}-${String(target.index + 1).padStart(2, '0')}`,
        });
        imported.push({
          id: 0,
          filename: result.filename,
          filesizeMb: null,
          uploadTime: null,
          filePath: result.filepath,
        });
      } catch (error) {
        failures.push({
          index: target.index + 1,
          message: error instanceof Error ? error.message : '导入失败',
        });
      }
    }

    if (!imported.length) {
      throw new BadRequestException(
        `卡图导入失败：${failures.map((item) => `第 ${item.index} 张 ${item.message}`).join('；')}`,
      );
    }

    return {
      articleId,
      title: article.title,
      imported,
      failures,
    };
  }

  fetchMaterialFile(filename: string) {
    return this.autoUploadClient.fetchMaterialFile(filename);
  }

  async deleteMaterial(
    id: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const riskAudit = assertBackendRiskGate({
      action: 'local-file-delete',
      target: `material:${id}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.confirmation,
      context: options.context,
      reason: '删除素材会修改本地文件/素材库。',
    });
    const result = await this.autoUploadClient.deleteMaterial(id);
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '删除本地素材文件',
      targetLabel: `素材 ${id}`,
    });

    return { ...result, riskAudit };
  }

  async publishBatch(
    payloads: AutoUploadPublishPayload[],
    options: {
      confirmationId?: string;
      context?: BackendRiskContext;
    } = {},
  ): Promise<PublishBatchResult & { riskAudit?: BackendRiskAuditEvent }> {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new BadRequestException('请至少选择一个发布账号');
    }
    const hasRealPublish = payloads.some(
      (payload) => payload.debugDryRun !== true,
    );
    const riskReason =
      payloads.length > 1
        ? '批量发布会向多个平台账号提交内容。'
        : '发布会向外部平台提交内容。';
    let riskAudit: BackendRiskAuditEvent;
    if (hasRealPublish) {
      const scope = await this.resolvePublishApprovalScope(options.context);
      const target = await this.buildPublishApprovalTarget(payloads, scope);
      const riskPolicyService = this.requireRiskPolicyService();
      const confirmation = await riskPolicyService.consumeHighRiskApproval(
        {
          confirmationId: options.confirmationId,
          action: 'publish',
          riskLevel: 'high',
          target,
          reason: riskReason,
        },
        scope,
      );
      riskAudit = assertBackendRiskGate({
        action: 'publish',
        target,
        riskLevel: 'high',
        requiresConfirmation: true,
        confirmation,
        context: options.context,
        reason: riskReason,
      });
    } else {
      riskAudit = assertBackendRiskGate({
        action: 'publish',
        target: 'auto-upload-publish:dry-run',
        riskLevel: 'low',
        requiresConfirmation: false,
        context: options.context,
        reason: '发布前检查不会向平台提交内容。',
      });
    }

    const articleIdentityIssues =
      await this.collectArticlePublishIdentityIssues(payloads);
    if (articleIdentityIssues.length > 0) {
      throw new BadRequestException(
        articleIdentityIssues.map((issue) => issue.message).join('；'),
      );
    }

    let accounts: AutoUploadAccount[] = [];
    try {
      accounts = await this.autoUploadClient.listAccounts({
        validate: true,
        force: true,
        ...this.resolvePayloadAccountIdsOption(payloads),
      });
    } catch {
      // engine unavailable
    }
    const accountByFile = this.mapAccountsByFile(accounts);

    const validPayloads: AutoUploadPublishPayload[] = [];
    const recordPayloads: AutoUploadPublishPayload[] = [];
    const preEntries: AutoUploadPublishPlatformEntry[] = [];
    let preflightResult: AutoUploadPublishPreflightResult | null = null;

    for (const payload of payloads) {
      const platform = this.resolvePlatformName(payload.type);
      const accountLookup =
        payload.accountIdentity?.id || payload.accountList?.[0] || '';
      const account = accountLookup
        ? accountByFile.get(accountLookup)
        : undefined;
      const recordedPayload = this.attachDurableAccountIdentity(
        payload,
        account,
      );
      recordPayloads.push(recordedPayload);
      const accountId =
        recordedPayload.accountIdentity?.id || accountLookup || '';
      const accountName =
        recordedPayload.accountIdentity?.name ||
        (account ? this.resolveAccountName(account) : '未识别账号');
      const accountStatus =
        recordedPayload.accountIdentity?.status ||
        (account?.status === 1 ? 'ready' : 'unknown');

      if (account && account.status !== 1) {
        preEntries.push({
          platform,
          accountId,
          accountName,
          accountStatus,
          articleId: recordedPayload.articleId,
          status: 'account_expired',
          failureReason: `${platform}账号「${this.resolveAccountName(account)}」登录态失效`,
          nextAction: '请重新登录该平台账号',
        });
        continue;
      }

      let materialError: string | null = null;
      for (const filePath of payload.fileList || []) {
        const issue = await this.checkReadablePublishFile(filePath, 'material');
        if (issue) {
          materialError = filePath;
          break;
        }
      }

      const coverFiles = [
        payload.coverPath,
        ...Object.values(payload.coverPaths || {}),
      ].filter((f): f is string => Boolean(f));
      for (const filePath of coverFiles) {
        if (materialError) break;
        const issue = await this.checkReadablePublishFile(filePath, 'cover');
        if (issue) {
          materialError = filePath;
          break;
        }
      }

      if (materialError) {
        preEntries.push({
          platform,
          accountId,
          accountName,
          accountStatus,
          articleId: recordedPayload.articleId,
          status: 'material_error',
          failureReason: `素材不可读：${materialError}`,
          nextAction: '请确认素材文件存在且可读后重试',
        });
        continue;
      }

      validPayloads.push(recordedPayload);
    }

    if (validPayloads.length > 0) {
      const preflight = await this.preflightPublishBatch(validPayloads);
      preflightResult = preflight;
      if (!preflight.ok) {
        const blockingIssues = preflight.issues.filter(
          (issue) =>
            issue.code !== 'account_expired' &&
            issue.code !== 'material_missing' &&
            issue.code !== 'material_unreadable',
        );
        if (blockingIssues.length > 0) {
          throw new BadRequestException(
            `发布前检查未通过：${blockingIssues
              .map((issue) => `${issue.message} 下一步：${issue.nextAction}`)
              .join('；')}`,
          );
        }
      }
    }

    if (validPayloads.length > 0) {
      const execution = await this.executeDurablePublishRecord(
        validPayloads,
        validPayloads[0]?.title || '发布任务',
        preEntries,
        recordPayloads,
      );
      const batchResult = execution.batchResult;
      const allEntries = batchResult.platforms;

      await this.recordRiskAuditEvidenceLog(riskAudit, {
        actionLabel: '真实发布',
        targetLabel:
          payloads.length > 1
            ? `发布任务 ${payloads.length} 个`
            : payloads[0]?.title || '发布任务',
        detail: `submitted=${validPayloads.length};blocked=${preEntries.length}`,
        details: this.buildPublishRiskAuditDetails({
          riskAudit,
          payloads,
          preflight: preflightResult,
          entries: allEntries,
        }),
      });

      return {
        ...batchResult,
        publishRecordId: execution.record.publicId,
        riskAudit,
      };
    }

    const batchResult = this.buildBatchResult(preEntries);
    const record = await this.createDurablePublishRecord(
      recordPayloads,
      batchResult,
    );
    await this.recordRiskAuditEvidenceLog(riskAudit, {
      actionLabel: '真实发布',
      targetLabel:
        payloads.length > 1
          ? `发布任务 ${payloads.length} 个`
          : payloads[0]?.title || '发布任务',
      detail: `submitted=0;blocked=${preEntries.length}`,
      details: this.buildPublishRiskAuditDetails({
        riskAudit,
        payloads,
        preflight: preflightResult,
        entries: preEntries,
      }),
    });
    return { ...batchResult, publishRecordId: record.publicId, riskAudit };
  }

  async getPublishBatchResults(taskId: number): Promise<PublishBatchResult> {
    await this.ensureLegacyPublishHistoryImported();
    const record = await this.publishRecordStore.findByPublicId(taskId);
    if (!record) {
      throw new NotFoundException('未找到该任务的发布结果');
    }

    const displayResult = this.normalizePublishBatchResultForDisplay(
      record.envelope.result,
    );

    return {
      platforms: displayResult.platforms.map((entry) => ({
        platform: entry.platform,
        accountId: entry.accountId,
        accountName: entry.accountName,
        accountStatus: entry.accountStatus,
        articleId: entry.articleId,
        status: entry.status,
        failureReason: entry.failureReason,
        nextAction: entry.nextAction,
        publishTaskId: entry.publishTaskId,
        publishUrl: entry.publishUrl,
        externalId: entry.externalId,
        evidence: entry.evidence,
      })),
      summary: displayResult.summary,
    };
  }

  async createPublishConfirmation(
    payloads: AutoUploadPublishPayload[],
    context?: BackendRiskContext,
  ) {
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new BadRequestException('请至少选择一个发布账号');
    }
    if (payloads.every((payload) => payload.debugDryRun === true)) {
      throw new BadRequestException('发布前检查不需要高风险确认');
    }
    const scope = await this.resolvePublishApprovalScope(context);
    const target = await this.buildPublishApprovalTarget(payloads, scope);
    return this.requireRiskPolicyService().issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target,
        reason:
          payloads.length > 1
            ? '确认向多个平台账号提交本批内容。'
            : '确认向外部平台提交本批内容。',
      },
      scope,
    );
  }

  private reconstructRetryPayload(
    task: AutoUploadPublishTask,
  ): AutoUploadPublishPayload {
    return {
      type: task.platform_type,
      contentKind: this.inferContentKindFromFiles(task.file_list || []),
      title: task.title || `重试任务 ${task.id}`,
      tags: task.tags || [],
      fileList: task.file_list || [],
      accountList: [task.account_file],
      enableTimer: 0,
      videosPerDay: 1,
      dailyTimes: ['10:00'],
      startDays: 0,
      timeJitterMinutes: 0,
      debugDryRun: task.dry_run,
      debugDryRunHoldBrowser: task.dry_run,
      category: 0,
    };
  }

  private normalizeRetryPayload(
    payload: AutoUploadPublishPayload,
    task: AutoUploadPublishTask,
  ): AutoUploadPublishPayload {
    return {
      ...payload,
      type: payload.type || task.platform_type,
      contentKind:
        payload.contentKind ||
        this.inferContentKindFromFiles(
          payload.fileList?.length ? payload.fileList : task.file_list || [],
        ),
      title: payload.title || task.title || `重试任务 ${task.id}`,
      tags: payload.tags || task.tags || [],
      fileList: payload.fileList?.length
        ? payload.fileList
        : task.file_list || [],
      accountList: payload.accountList?.length
        ? payload.accountList
        : [task.account_file],
      debugDryRun: payload.debugDryRun ?? task.dry_run,
      debugDryRunHoldBrowser: payload.debugDryRunHoldBrowser ?? task.dry_run,
    };
  }

  private describeRestoredPayloadFields(
    payload: AutoUploadPublishPayload,
    task: AutoUploadPublishTask,
  ) {
    const fields: string[] = ['标题', '标签', '素材', '账号', '发布模式'];
    if (payload.contentKind)
      fields.push(payload.contentKind === 'video' ? '视频类型' : '图文类型');
    if (payload.enableTimer) fields.push('定时发布');
    if (payload.scheduleTime) fields.push('固定发布时间');
    if (payload.dailyTimes?.length) fields.push('每日发布时间');
    if (payload.coverPath || Object.keys(payload.coverPaths || {}).length)
      fields.push('封面设置');
    if (
      payload.biliTitle ||
      payload.biliDesc ||
      payload.biliType ||
      payload.biliPartition
    )
      fields.push('B站参数');
    if ((payload.fileList || []).join('|') !== (task.file_list || []).join('|'))
      fields.push('原始素材列表');

    return Array.from(new Set(fields));
  }

  private describeMissingPayloadFields(payload: AutoUploadPublishPayload) {
    const fields: string[] = [];
    if (!payload.fileList?.length) fields.push('素材文件');
    if (!payload.accountList?.length) fields.push('发布账号');
    if (payload.contentKind !== 'article' && payload.contentKind !== 'video')
      fields.push('图文/视频类型');
    if (!payload.title?.trim()) fields.push('发布标题');
    if (payload.contentKind === 'video') {
      if (!this.hasAnyVideoMaterial(payload.fileList || []))
        fields.push('视频素材');
      if (
        payload.enableTimer === 1 &&
        !payload.dailyTimes?.length &&
        !payload.scheduleTime
      )
        fields.push('视频发布时间');
    }
    if (payload.type === 5 && !payload.biliTitle && !payload.title)
      fields.push('B站标题');
    if (payload.type === 5 && !payload.biliPartition) fields.push('B站分区');

    return fields;
  }

  private async executeDurablePublishRecord(
    executionPayloads: AutoUploadPublishPayload[],
    title: string,
    existingEntries: AutoUploadPublishPlatformEntry[] = [],
    recordPayloads: AutoUploadPublishPayload[] = executionPayloads,
  ) {
    await this.preprocessImages(executionPayloads);
    const articleIdentityIssues =
      await this.collectArticlePublishIdentityIssues(executionPayloads);
    if (articleIdentityIssues.length > 0) {
      throw new BadRequestException(
        articleIdentityIssues.map((issue) => issue.message).join('；'),
      );
    }
    const pendingEntries = executionPayloads.map((payload) => ({
      platform: this.resolvePlatformName(payload.type),
      accountId: payload.accountIdentity?.id || payload.accountList?.[0] || '',
      accountName: payload.accountIdentity?.name,
      accountStatus: payload.accountIdentity?.status,
      articleId: payload.articleId,
      status: 'pending_manual' as const,
      failureReason: '发布请求准备提交，等待平台回读。',
      nextAction: '平台回读完成前不会标记为已完成。',
    }));
    let record = await this.createDurablePublishRecord(
      recordPayloads,
      this.buildBatchResult([...existingEntries, ...pendingEntries]),
    );

    try {
      const response = await this.publishBatchWithTracking(
        executionPayloads,
        title,
      );
      const publishEntries = this.buildEnginePublishEntries(
        executionPayloads,
        response,
      );
      const batchResult = {
        ...this.buildBatchResult([...existingEntries, ...publishEntries]),
        agentSessionId: response?.agentSessionId,
      };
      record = await this.publishRecordStore.updateResult(record, batchResult, {
        engineTaskIds: response?.taskIds,
        agentSessionId: response?.agentSessionId,
      });
      return { response, batchResult, record };
    } catch (error) {
      const message = error instanceof Error ? error.message : '发布执行失败';
      const failedEntries = executionPayloads.map((payload) => ({
        platform: this.resolvePlatformName(payload.type),
        accountId:
          payload.accountIdentity?.id || payload.accountList?.[0] || '',
        accountName: payload.accountIdentity?.name,
        accountStatus: payload.accountIdentity?.status,
        articleId: payload.articleId,
        status: 'failed' as const,
        failureReason: message,
        nextAction: '请核对平台状态、账号和素材后重试。',
      }));
      await this.publishRecordStore
        .updateResult(
          record,
          this.buildBatchResult([...existingEntries, ...failedEntries]),
        )
        .catch(() => undefined);
      throw error;
    }
  }

  private buildEnginePublishEntries(
    payloads: AutoUploadPublishPayload[],
    response: AutoUploadPublishResponse,
  ): AutoUploadPublishPlatformEntry[] {
    const taskIds = Array.isArray(response?.taskIds) ? response.taskIds : [];
    const results = Array.isArray(response?.results) ? response.results : [];

    return payloads.map((payload, index) => {
      const platform = this.resolvePlatformName(payload.type);
      const accountId =
        payload.accountIdentity?.id || payload.accountList?.[0] || '';
      const taskId = taskIds[index];
      const result = results[index];
      const evidence = this.extractPublishResultEvidence(result);
      const common = {
        platform,
        accountId,
        accountName: payload.accountIdentity?.name,
        accountStatus: payload.accountIdentity?.status,
        articleId: payload.articleId,
        publishTaskId: taskId != null ? String(taskId) : undefined,
        publishUrl: evidence?.publishUrl,
        externalId: evidence?.externalId,
        evidence: evidence || result?.evidence,
      };

      if (result?.ok === false) {
        const notIntegrated =
          result.notIntegrated === true ||
          /真实发布执行器未接入|尚未接入/.test(result.message || '');
        const reasonCode = this.extractPublishReasonCode(result);
        const status = notIntegrated
          ? ('not_integrated' as const)
          : reasonCode === 'account_not_logged_in'
            ? ('login_required' as const)
            : reasonCode === 'target_not_found'
              ? ('material_error' as const)
              : this.isPublishBlockedReasonCode(reasonCode)
                ? ('blocked' as const)
                : ('failed' as const);
        return {
          ...common,
          status,
          failureReason: result.message || '发布失败',
          nextAction: notIntegrated
            ? '请先接入真实发布执行器和平台回读，再开放该平台发布。'
            : status === 'login_required'
              ? '请先在平台账号页重新登录该账号，再重新发布。'
              : status === 'material_error'
                ? '请检查素材是否存在、格式是否正确后重试。'
                : status === 'blocked'
                  ? '请处理平台账号权限、验证码、社区规范风控或页面状态后重试。'
                  : '请检查发布参数后重试。',
        };
      }

      if (result?.ok === true && hasVerifiedPlatformReadback(common)) {
        return { ...common, status: 'success' as const };
      }

      return {
        ...common,
        status: 'pending_manual' as const,
        failureReason:
          result?.message ||
          (taskId != null
            ? '发布请求已提交，但平台尚未确认结果。'
            : '发布服务尚未返回可确认的结果。'),
        nextAction: '请等待平台确认；确认完成前不会标记为发布成功。',
      };
    });
  }

  private async createDurablePublishRecord(
    payloads: AutoUploadPublishPayload[],
    result: PublishBatchResult,
    options: {
      recordedAt?: string;
      preferredPublicId?: number;
      legacyStoreKey?: string;
      engineTaskIds?: Array<number | string>;
    } = {},
  ) {
    const primaryPayload = payloads[0];
    return this.publishRecordStore.create({
      title: primaryPayload?.title || this.describePublishBatchTitle(result),
      platformType: primaryPayload?.type || 0,
      accountFile:
        payloads
          .map((payload) => payload.accountIdentity?.name)
          .filter(Boolean)
          .join('、') ||
        result.platforms
          .map((entry) => entry.accountName || entry.accountId)
          .filter(Boolean)
          .join('、'),
      fileList: primaryPayload?.fileList || [],
      tags: primaryPayload?.tags || [],
      dryRun: primaryPayload?.debugDryRun === true,
      payloads,
      result,
      engineTaskIds: options.engineTaskIds,
      agentSessionId: result.agentSessionId,
      recordedAt: options.recordedAt,
      preferredPublicId: options.preferredPublicId,
      legacyStoreKey: options.legacyStoreKey,
    });
  }

  private async publishBatchWithTracking(
    payloads: AutoUploadPublishPayload[],
    title: string,
  ): Promise<AutoUploadPublishResponse> {
    const session = this.localEngineService
      ? await this.localEngineService.createPublishTrackingSession({
          title,
          metadata: {
            payloadCount: payloads.length,
            platforms: payloads.map((payload) =>
              this.resolvePlatformName(payload.type),
            ),
            source: 'auto-upload-publish',
          },
        })
      : null;
    try {
      const result = session
        ? await this.autoUploadClient.publishBatch(payloads, {
            agentSessionId: session.id,
          })
        : await this.autoUploadClient.publishBatch(payloads);
      if (session) {
        const ok =
          result?.results?.length === payloads.length &&
          result.results.every((item) => {
            const evidence = this.extractPublishResultEvidence(item);
            return (
              item.ok === true &&
              Boolean(evidence) &&
              hasVerifiedPlatformReadback({ evidence })
            );
          });
        await this.localEngineService?.completePublishTrackingSession(
          session.id,
          {
            ok,
            message:
              result?.reason ||
              (ok ? '平台回读已确认。' : '平台发布尚未通过回读确认。'),
          },
        );
      }
      return result;
    } catch (error) {
      if (session) {
        await this.localEngineService?.completePublishTrackingSession(
          session.id,
          {
            ok: false,
            message: error instanceof Error ? error.message : '发布执行失败',
          },
        );
      }
      throw error;
    }
  }

  private async readPublishPayloadRecords() {
    try {
      const text = await readFile(this.publishPayloadStorePath(), 'utf8');
      const parsed = JSON.parse(text) as Record<
        string,
        AutoUploadRecordedPublishPayload
      >;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private publishPayloadStorePath() {
    return resolveProjectLogPath('auto-upload-publish-payloads.json');
  }

  private async readPublishBatchResultsStore(): Promise<
    Record<string, PublishBatchResult>
  > {
    try {
      const text = await readFile(this.publishBatchResultStorePath(), 'utf8');
      const parsed = JSON.parse(text) as Record<string, PublishBatchResult>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private publishBatchResultStorePath() {
    return resolveProjectLogPath('auto-upload-batch-results.json');
  }

  private buildPublishRiskAuditDetails(input: {
    riskAudit: BackendRiskAuditEvent;
    payloads: AutoUploadPublishPayload[];
    preflight: AutoUploadPublishPreflightResult | null;
    entries: AutoUploadPublishPlatformEntry[];
  }): RiskAuditDetailPayload[] {
    return [
      this.buildRiskAuditConfirmationDetail(input.riskAudit),
      ...this.buildPublishPayloadRiskAuditDetails(input.payloads),
      input.preflight
        ? this.buildPublishPreflightRiskAuditDetail(input.preflight)
        : null,
      ...this.buildPublishPlatformRiskAuditDetails(input.entries),
    ].filter((detail): detail is RiskAuditDetailPayload => Boolean(detail));
  }

  private buildRiskAuditConfirmationDetail(
    riskAudit: BackendRiskAuditEvent,
  ): RiskAuditConfirmationDetailPayload {
    const confirmation = riskAudit.confirmationRecord;
    const checklist = Object.entries(confirmation?.checklist || {})
      .slice(0, 20)
      .reduce<RiskAuditChecklistDetailPayload[]>((items, [label, checked]) => {
        const itemLabel = this.trimRiskAuditDetailValue(label, 80);
        if (itemLabel) {
          items.push({ label: itemLabel, checked: checked === true });
        }
        return items;
      }, []);
    const operator = this.trimRiskAuditDetailValue(
      confirmation?.operator || riskAudit.account.name,
      80,
    );
    const confirmedAction = this.trimRiskAuditDetailValue(
      confirmation?.confirmedAction || riskAudit.action,
      80,
    );
    const confirmedRiskLevel = this.trimRiskAuditDetailValue(
      confirmation?.confirmedRiskLevel || riskAudit.riskLevel,
      80,
    );

    return {
      type: 'audit-confirmation',
      label: '人工确认记录',
      summary: operator
        ? `${operator} 已确认 ${confirmedRiskLevel} 风险动作`
        : '高风险动作已确认',
      operator,
      confirmedAt: confirmation?.confirmedAt || riskAudit.createdAt,
      confirmationId: this.trimRiskAuditDetailValue(
        confirmation?.confirmationId,
        120,
      ),
      confirmedAction,
      confirmedRiskLevel,
      reason: this.trimRiskAuditDetailValue(
        confirmation?.reason || riskAudit.reason,
        200,
      ),
      checklist: checklist.length ? checklist : undefined,
      fullPermission: confirmation?.fullPermission === true,
    };
  }

  private buildPublishPayloadRiskAuditDetails(
    payloads: AutoUploadPublishPayload[],
  ): RiskAuditPublishPayloadDetailPayload[] {
    return payloads.map((payload, index) => {
      const platform = this.resolvePlatformName(payload.type);
      const title =
        this.trimRiskAuditDetailValue(
          payload.title || `发布任务 ${index + 1}`,
          120,
        ) || `发布任务 ${index + 1}`;
      const accountCount = payload.accountList?.filter(Boolean).length || 0;
      const materialCount = payload.fileList?.filter(Boolean).length || 0;
      const coverCount = [
        payload.coverPath,
        ...Object.values(payload.coverPaths || {}),
      ].filter(Boolean).length;
      const tagCount = payload.tags?.filter(Boolean).length || 0;

      return {
        type: 'publish-payload',
        label: `${platform} · ${title}`,
        summary: `${accountCount} 个账号，${materialCount} 个素材，${coverCount} 个封面`,
        platform,
        accountId: this.trimRiskAuditDetailValue(
          payload.accountList?.join('、'),
          200,
        ),
        contentKind: payload.contentKind,
        title,
        materialCount,
        coverCount,
        tagCount,
        scheduleSummary: this.summarizePublishPayloadSchedule(payload),
        dryRun: payload.debugDryRun === true,
      };
    });
  }

  private buildPublishPreflightRiskAuditDetail(
    preflight: AutoUploadPublishPreflightResult,
  ): RiskAuditPreflightDetailPayload {
    const issueCount = preflight.issues.length;

    return {
      type: 'publish-preflight',
      label: '发布前检查',
      summary:
        preflight.summary ||
        (preflight.ok
          ? '发布前检查通过'
          : `发布前检查发现 ${issueCount} 项问题`),
      ok: preflight.ok,
      checkedAt: preflight.checkedAt,
      issueCount,
      payloadCount: preflight.payloadCount,
      accountCount: preflight.accountCount,
      materialCount: preflight.materialCount,
      issues: preflight.issues.slice(0, 12).map((issue) => ({
        code: issue.code,
        scope: issue.scope,
        stage: this.trimRiskAuditDetailValue(issue.stage, 120) || '检查步骤',
        message:
          this.trimRiskAuditDetailValue(issue.message, 200) || '未记录原因',
        nextAction:
          this.trimRiskAuditDetailValue(issue.nextAction, 200) || '请人工复核',
        platform: this.trimRiskAuditDetailValue(issue.platform, 80),
        account: this.trimRiskAuditDetailValue(issue.account, 120),
        field: this.trimRiskAuditDetailValue(issue.field, 80),
        filePath: this.trimRiskAuditDetailValue(issue.filePath, 200),
      })),
    };
  }

  private buildPublishPlatformRiskAuditDetails(
    entries: AutoUploadPublishPlatformEntry[],
  ): RiskAuditPlatformDetailPayload[] {
    return entries.map((entry) => {
      const evidence = this.asRecord(entry.evidence);
      const evidenceUrl = this.resolveEvidenceUrl(evidence || {});
      const evidenceSource =
        typeof evidence?.source === 'string' ? evidence.source : undefined;
      const externalEvidenceId =
        typeof evidence?.externalId === 'string'
          ? evidence.externalId
          : undefined;
      const publishUrl = entry.publishUrl || evidenceUrl;
      const externalId = entry.externalId || externalEvidenceId;
      const statusLabel = this.publishStatusLabel(entry.status);
      const summary =
        entry.status === 'success'
          ? publishUrl || externalId
            ? '平台发布证据已确认'
            : '平台返回成功证据'
          : entry.failureReason || entry.nextAction || statusLabel;

      return {
        type: 'publish-platform',
        label: entry.accountId
          ? `${entry.platform} · ${entry.accountId}`
          : entry.platform,
        platform: entry.platform,
        accountId: entry.accountId || undefined,
        status: entry.status,
        statusLabel,
        summary,
        failureReason: entry.failureReason,
        nextAction: entry.nextAction,
        publishTaskId: entry.publishTaskId,
        publishUrl,
        externalId,
        evidenceSource,
        evidenceUrl,
      };
    });
  }

  private summarizePublishPayloadSchedule(payload: AutoUploadPublishPayload) {
    if (payload.scheduleTime) {
      return `定时发布：${this.trimRiskAuditDetailValue(payload.scheduleTime, 80)}`;
    }
    if (payload.enableTimer === 1) {
      const times = (payload.dailyTimes || []).filter(Boolean).join('、');
      return times
        ? `定时发布：${times}，起始 ${payload.startDays || 0} 天后`
        : '定时发布';
    }
    return '立即发布';
  }

  private trimRiskAuditDetailValue(value: unknown, max = 160) {
    if (typeof value !== 'string') return undefined;
    const text = value
      .replace(/[\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return undefined;
    return text.length > max ? `${text.slice(0, max)}...` : text;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private async recordRiskAuditEvidenceLog(
    riskAudit: BackendRiskAuditEvent | null | undefined,
    input: {
      actionLabel: string;
      targetLabel: string;
      detail?: string;
      details?: RiskAuditDetailPayload[];
    },
  ) {
    if (!riskAudit || !this.systemLogsService) return;

    const actionLabel = this.sanitizeRiskAuditLogField(input.actionLabel);
    const targetLabel = this.sanitizeRiskAuditLogField(input.targetLabel);
    const detail = input.detail
      ? `, detail=${this.sanitizeRiskAuditLogField(input.detail)}`
      : '';
    const details = this.encodeRiskAuditDetails(input.details);
    const detailPayload = details ? `, details=${details}` : '';

    await this.systemLogsService.record(
      `风险审计已确认：${actionLabel}（action=${riskAudit.action}, target=${targetLabel}, audit=${riskAudit.id}, risk=${riskAudit.riskLevel}, status=${riskAudit.status}${detail}${detailPayload}）`,
      'warning',
    );
  }

  private encodeRiskAuditDetails(details?: RiskAuditDetailPayload[]) {
    if (!details?.length) return '';
    return Buffer.from(JSON.stringify(details), 'utf8').toString('base64url');
  }

  private publishStatusLabel(status: AutoUploadPublishPlatformEntry['status']) {
    const labels: Record<AutoUploadPublishPlatformEntry['status'], string> = {
      success: '已发布',
      failed: '发布失败',
      account_expired: '账号失效',
      material_error: '素材异常',
      login_required: '需要登录',
      pending_manual: '待人工确认',
      blocked: '平台阻断',
      not_integrated: '未接入',
      skipped: '已跳过',
    };
    return labels[status] || status;
  }

  private sanitizeRiskAuditLogField(value: string) {
    return String(value || '')
      .replace(/[,\n\r()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ensureLegacyPublishHistoryImported() {
    if (!this.legacyPublishHistoryImport) {
      this.legacyPublishHistoryImport = this.importLegacyPublishHistory().catch(
        (error) => {
          this.legacyPublishHistoryImport = undefined;
          throw error;
        },
      );
    }
    return this.legacyPublishHistoryImport;
  }

  private async importLegacyPublishHistory() {
    const [batchRecords, payloadRecords] = await Promise.all([
      this.readPublishBatchResultsStore(),
      this.readPublishPayloadRecords(),
    ]);
    for (const [taskKey, rawResult] of Object.entries(batchRecords)) {
      const rawMetadata = rawResult as PublishBatchResult & {
        source?: string;
        recordedAt?: string;
        payloads?: AutoUploadPublishPayload[];
      };
      if (rawMetadata.source === 'interaction_tasks') continue;
      if (await this.publishRecordStore.findLegacyImport(taskKey)) continue;

      const numericTaskId = Number(taskKey);
      const preferredPublicId = Number.isSafeInteger(numericTaskId)
        ? Math.abs(numericTaskId)
        : undefined;
      const legacyTask = this.publishBatchResultToTask(
        preferredPublicId || Date.now(),
        rawResult,
        payloadRecords[taskKey],
      );
      if (!legacyTask || this.isInternalPublishTestTask(legacyTask)) continue;

      const payloads = Array.isArray(rawMetadata.payloads)
        ? rawMetadata.payloads
        : payloadRecords[taskKey]?.payload
          ? [payloadRecords[taskKey].payload]
          : [];
      const result = this.normalizePublishBatchResultForDisplay(rawResult);
      await this.createDurablePublishRecord(payloads, result, {
        recordedAt:
          rawMetadata.recordedAt || payloadRecords[taskKey]?.recordedAt,
        preferredPublicId,
        legacyStoreKey: taskKey,
        engineTaskIds: result.platforms
          .map((entry) => entry.publishTaskId)
          .filter((value): value is string => Boolean(value)),
      });
    }
  }

  private durablePublishRecordToTask(
    record: DurablePublishRecord,
  ): AutoUploadPublishTask {
    const envelope = record.envelope;
    const displayResult = this.normalizePublishBatchResultForDisplay(
      envelope.result,
    );
    const failedCount =
      (displayResult.summary.failed || 0) +
      (displayResult.summary.accountExpired || 0) +
      (displayResult.summary.materialError || 0) +
      (displayResult.summary.loginRequired || 0) +
      (displayResult.summary.blocked || 0) +
      (displayResult.summary.notIntegrated || 0);
    return {
      id: record.publicId,
      title: envelope.title,
      platform_type: envelope.platformType,
      platform:
        displayResult.platforms.map((entry) => entry.platform).join('、') ||
        '聚合发布',
      account_file: envelope.accountFile,
      file_list: envelope.fileList,
      tags: envelope.tags,
      dry_run: envelope.dryRun,
      status:
        record.status === 'completed'
          ? 'completed'
          : record.status === 'failed'
            ? 'failed'
            : 'waiting_for_send_confirmation',
      message: this.describePublishBatchMessage(displayResult, failedCount),
      result: {
        source: DURABLE_PUBLISH_RECORD_SOURCE,
        recordId: record.databaseId,
        agentSessionId: displayResult.agentSessionId,
        platforms: displayResult.platforms,
        summary: displayResult.summary,
        payloads: envelope.payloads,
        engineTaskIds: envelope.engineTaskIds,
      },
      created_at: envelope.createdAt,
      updated_at: envelope.updatedAt,
    };
  }

  private publishBatchResultToTask(
    taskId: number,
    result: PublishBatchResult,
    recordedPayload?: AutoUploadRecordedPublishPayload,
  ): AutoUploadPublishTask | null {
    if (
      !result ||
      !Array.isArray(result.platforms) ||
      result.platforms.length === 0
    ) {
      return null;
    }
    const displayResult = this.normalizePublishBatchResultForDisplay(result);
    const metadata = displayResult as PublishBatchResult & {
      recordedAt?: string;
      payloads?: AutoUploadPublishPayload[];
    };
    const payloads = Array.isArray(metadata.payloads)
      ? metadata.payloads
      : recordedPayload?.payload
        ? [recordedPayload.payload]
        : [];
    const primaryPayload = payloads[0];
    const successCount = displayResult.summary?.success || 0;
    const failedCount =
      (displayResult.summary?.failed || 0) +
      (displayResult.summary?.accountExpired || 0) +
      (displayResult.summary?.materialError || 0) +
      (displayResult.summary?.loginRequired || 0) +
      (displayResult.summary?.blocked || 0) +
      (displayResult.summary?.notIntegrated || 0);
    const pendingCount = displayResult.summary?.pendingManual || 0;
    const status =
      successCount > 0 && failedCount === 0 && pendingCount === 0
        ? 'completed'
        : failedCount > 0
          ? 'failed'
          : 'waiting_for_send_confirmation';
    const createdAt =
      metadata.recordedAt ||
      recordedPayload?.recordedAt ||
      new Date(Math.abs(taskId) || Date.now()).toISOString();
    const title =
      primaryPayload?.title || this.describePublishBatchTitle(result);
    return {
      id: taskId,
      title,
      platform_type: primaryPayload?.type || 0,
      platform:
        displayResult.platforms.map((entry) => entry.platform).join('、') ||
        '聚合发布',
      account_file: displayResult.platforms
        .map((entry) => entry.accountId)
        .filter(Boolean)
        .join('、'),
      file_list: primaryPayload?.fileList || [],
      tags: primaryPayload?.tags || ['AGGREGATE_PUBLISH'],
      dry_run: false,
      status,
      message: this.describePublishBatchMessage(displayResult, failedCount),
      result: {
        source: 'auto_upload_batch_results',
        agentSessionId: displayResult.agentSessionId,
        platforms: displayResult.platforms,
        summary: displayResult.summary,
        payloads,
      },
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  private describePublishBatchTitle(result: PublishBatchResult) {
    const platforms = result.platforms
      .map((entry) => entry.platform)
      .filter(Boolean);
    return platforms.length > 1
      ? `聚合发布 ${platforms.join('、')}`
      : `${platforms[0] || '平台'}发布`;
  }

  private isInternalPublishTestTask(task: AutoUploadPublishTask) {
    const text = [
      task.title,
      task.message,
      ...(task.tags || []),
      JSON.stringify(task.result?.payloads || []),
    ]
      .filter(Boolean)
      .join(' ');

    return (
      /\b(?:smoke|fixture|acceptance|commercial(?:[-_ ]?(?:acceptance|e2e|test))?|e2e|test(?:[-_ ][\w.-]+)?)\b/i.test(
        text,
      ) || /(?:冒烟|验收|测试)(?:发布|记录|任务)?/.test(text)
    );
  }

  private hasRetryablePublishFailure(result: PublishBatchResult) {
    return result.platforms.some((entry) =>
      this.isRetryablePublishStatus(entry.status),
    );
  }

  private isRetryablePublishStatus(
    status: AutoUploadPublishPlatformEntry['status'],
  ) {
    return (
      status === 'failed' ||
      status === 'account_expired' ||
      status === 'material_error' ||
      status === 'login_required' ||
      status === 'blocked'
    );
  }

  private findPayloadsForPlatformEntries(
    payloads: AutoUploadPublishPayload[],
    entries: AutoUploadPublishPlatformEntry[],
  ) {
    const usedIndexes = new Set<number>();
    return entries.reduce<AutoUploadPublishPayload[]>((matched, entry) => {
      const exactIndex = payloads.findIndex(
        (payload, index) =>
          !usedIndexes.has(index) &&
          this.resolvePlatformName(payload.type) === entry.platform &&
          payload.accountList?.includes(entry.accountId),
      );
      const platformIndex = payloads.findIndex(
        (payload, index) =>
          !usedIndexes.has(index) &&
          this.resolvePlatformName(payload.type) === entry.platform,
      );
      const fallbackIndex = payloads.findIndex(
        (_payload, index) => !usedIndexes.has(index),
      );
      const payloadIndex =
        exactIndex >= 0
          ? exactIndex
          : platformIndex >= 0
            ? platformIndex
            : fallbackIndex;
      if (payloadIndex >= 0) {
        usedIndexes.add(payloadIndex);
        matched.push(payloads[payloadIndex]);
      }
      return matched;
    }, []);
  }

  private hasPlatformPublishReadback(entry: AutoUploadPublishPlatformEntry) {
    return hasVerifiedPlatformReadback(entry);
  }

  private normalizePublishBatchResultForDisplay(
    result: PublishBatchResult,
  ): PublishBatchResult {
    const platforms = result.platforms.map((entry) => {
      if (
        entry.status === 'success' &&
        !this.hasPlatformPublishReadback(entry)
      ) {
        return {
          ...entry,
          status: 'pending_manual' as const,
          failureReason: '等待平台确认',
          nextAction: '请在平台后台确认发布结果。',
        };
      }
      return entry;
    });

    return {
      ...result,
      platforms,
      summary: {
        total: platforms.length,
        success: platforms.filter((entry) => entry.status === 'success').length,
        failed: platforms.filter((entry) => entry.status === 'failed').length,
        accountExpired: platforms.filter(
          (entry) => entry.status === 'account_expired',
        ).length,
        materialError: platforms.filter(
          (entry) => entry.status === 'material_error',
        ).length,
        loginRequired: platforms.filter(
          (entry) => entry.status === 'login_required',
        ).length,
        pendingManual: platforms.filter(
          (entry) => entry.status === 'pending_manual',
        ).length,
        blocked: platforms.filter((entry) => entry.status === 'blocked').length,
        notIntegrated: platforms.filter(
          (entry) => entry.status === 'not_integrated',
        ).length,
      },
    };
  }

  private describePublishBatchMessage(
    result: PublishBatchResult,
    failedCount: number,
  ) {
    const summary = result.summary;
    if (summary) {
      return `发布结果：成功 ${summary.success || 0}/${summary.total || result.platforms.length}，失败 ${failedCount}，待回执 ${summary.pendingManual || 0}`;
    }
    return result.platforms
      .map((entry) => `${entry.platform}:${entry.status}`)
      .join('；');
  }

  private buildBatchResult(
    platforms: AutoUploadPublishPlatformEntry[],
  ): PublishBatchResult {
    return {
      platforms,
      summary: {
        total: platforms.length,
        success: platforms.filter((p) => p.status === 'success').length,
        failed: platforms.filter((p) => p.status === 'failed').length,
        accountExpired: platforms.filter((p) => p.status === 'account_expired')
          .length,
        materialError: platforms.filter((p) => p.status === 'material_error')
          .length,
        loginRequired: platforms.filter((p) => p.status === 'login_required')
          .length,
        pendingManual: platforms.filter((p) => p.status === 'pending_manual')
          .length,
        blocked: platforms.filter((p) => p.status === 'blocked').length,
        notIntegrated: platforms.filter((p) => p.status === 'not_integrated')
          .length,
      },
    };
  }

  private extractPublishResultEvidence(
    result: AutoUploadEnginePublishResultItem | undefined,
  ): AutoUploadPublishEvidence | null {
    if (!result) return null;

    const structuredEvidence = this.asRecord(result.evidence);
    const publishUrl = [
      result.publishUrl,
      result.platformUrl,
      structuredEvidence?.publishUrl,
      structuredEvidence?.platformUrl,
    ]
      .find((value) => typeof value === 'string' && value.trim())
      ?.toString()
      .trim();
    const externalId = [
      result.externalId,
      result.articleId,
      result.postId,
      structuredEvidence?.externalId,
    ]
      .find((value) => typeof value === 'string' && value.trim())
      ?.toString()
      .trim();

    if (!publishUrl && !externalId && !structuredEvidence) return null;

    return {
      source:
        structuredEvidence &&
        hasVerifiedPlatformReadback({ evidence: structuredEvidence })
          ? 'readback'
          : this.resolvePublishEvidenceSource(structuredEvidence?.source),
      publishUrl,
      externalId,
      raw: structuredEvidence || result.evidence,
    };
  }

  private extractPublishReasonCode(
    result: AutoUploadEnginePublishResultItem | undefined,
  ): string | undefined {
    const evidence = result?.evidence;
    if (!evidence || typeof evidence !== 'object') return undefined;
    const reasonCode = (evidence as { reasonCode?: unknown }).reasonCode;
    return typeof reasonCode === 'string' ? reasonCode : undefined;
  }

  private isPublishBlockedReasonCode(reasonCode: string | undefined) {
    return (
      reasonCode === 'permission_missing' ||
      reasonCode === 'captcha_required' ||
      reasonCode === 'platform_changed' ||
      reasonCode === 'review_required' ||
      reasonCode === 'readback_failed'
    );
  }

  private sanitizePublishResponse(
    response: AutoUploadPublishResponse,
  ): AutoUploadPublishResponse {
    if (!response?.results?.length) {
      return response;
    }

    return {
      ...response,
      results: response.results.map((result, index) => {
        const evidence = this.extractPublishResultEvidence(result);
        if (
          result.ok !== true ||
          (evidence && hasVerifiedPlatformReadback({ evidence }))
        ) {
          return result;
        }

        const taskId = response.taskIds?.[index];
        return {
          ...result,
          ok: null,
          message:
            result.message ||
            (taskId != null
              ? '发布请求已提交，但平台尚未确认结果。'
              : '发布服务尚未返回可确认的结果。'),
        };
      }),
    };
  }

  private resolvePublishEvidenceSource(
    source: unknown,
  ): AutoUploadPublishEvidence['source'] {
    if (source === 'platform-page' || source === 'readback') {
      return source;
    }

    return 'platform-api';
  }

  private resolveEvidenceUrl(evidence: Record<string, unknown>) {
    const url = [evidence.publishUrl, evidence.platformUrl].find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    );

    return url?.trim();
  }

  private async assertPublishPreflightReady(
    payloads: AutoUploadPublishPayload[],
  ) {
    const preflight = await this.preflightPublishBatch(payloads);
    if (!preflight.ok) {
      throw new BadRequestException(
        `发布前检查未通过：${preflight.issues
          .map((issue) => `${issue.message} 下一步：${issue.nextAction}`)
          .join('；')}`,
      );
    }
  }

  private collectVideoParameterIssues(
    payload: AutoUploadPublishPayload,
    payloadIndex: number,
    issues: AutoUploadPublishPreflightIssue[],
  ) {
    const platform = this.resolvePlatformName(payload.type);
    const account = this.resolvePayloadAccountLabel(payload);
    const videosPerDay = Number(payload.videosPerDay);
    const startDays = Number(payload.startDays);
    const timeJitterMinutes = Number(payload.timeJitterMinutes);

    if (!Number.isFinite(videosPerDay) || videosPerDay < 1) {
      issues.push({
        code: 'video_parameter_missing',
        scope: 'payload',
        stage: '视频参数检查',
        payloadIndex,
        platformType: payload.type,
        platform,
        account,
        field: 'videosPerDay',
        message: `${platform} 视频发布每天条数无效。`,
        nextAction: '请把每天条数设置为大于等于 1 的数字。',
      });
    }
    if (!Number.isFinite(startDays) || startDays < 0) {
      issues.push({
        code: 'video_parameter_missing',
        scope: 'payload',
        stage: '视频参数检查',
        payloadIndex,
        platformType: payload.type,
        platform,
        account,
        field: 'startDays',
        message: `${platform} 视频发布起始天数无效。`,
        nextAction: '请把起始天数设置为 0 或更大的数字。',
      });
    }
    if (!Number.isFinite(timeJitterMinutes) || timeJitterMinutes < 0) {
      issues.push({
        code: 'video_parameter_missing',
        scope: 'payload',
        stage: '视频参数检查',
        payloadIndex,
        platformType: payload.type,
        platform,
        account,
        field: 'timeJitterMinutes',
        message: `${platform} 视频发布随机浮动分钟无效。`,
        nextAction: '请把随机浮动分钟设置为 0 或更大的数字。',
      });
    }
    if (
      payload.enableTimer === 1 &&
      !payload.scheduleTime &&
      !payload.dailyTimes?.length
    ) {
      issues.push({
        code: 'schedule_invalid',
        scope: 'payload',
        stage: '视频排期检查',
        payloadIndex,
        platformType: payload.type,
        platform,
        account,
        field: 'dailyTimes',
        message: `${platform} 已启用定时发布，但没有每日时间或固定发布时间。`,
        nextAction: '请填写至少一个每日时间，或填写固定发布时间。',
      });
    }
    for (const time of payload.dailyTimes || []) {
      if (!/^\d{1,2}:\d{2}$/.test(time)) {
        issues.push({
          code: 'schedule_invalid',
          scope: 'payload',
          stage: '视频排期检查',
          payloadIndex,
          platformType: payload.type,
          platform,
          account,
          field: 'dailyTimes',
          actual: time,
          message: `${platform} 每日时间格式无效：${time}。`,
          nextAction: '请使用 HH:mm 格式，例如 10:00 或 18:30。',
        });
      }
    }
  }

  private async checkReadablePublishFile(
    filePath: string,
    scope: 'material' | 'cover',
  ): Promise<AutoUploadPublishPreflightIssue | null> {
    const label = scope === 'cover' ? '封面' : '素材';

    // If filePath is just a filename, resolve it against the 3011 material store.
    // 5409's ~/auto-upload/videoFile is no longer a source of truth.
    const fullPath =
      filePath.includes('/') || filePath.includes('\\')
        ? filePath
        : join(
            process.env.AUTO_UPLOAD_MATERIALS_DIR ||
              resolveProjectDataPath('materials'),
            filePath,
          );

    try {
      const fileStat = await stat(fullPath);
      await access(fullPath, constants.R_OK);
      if (!fileStat.isFile()) {
        return {
          code: scope === 'cover' ? 'cover_unreadable' : 'material_unreadable',
          scope,
          stage: scope === 'cover' ? '封面检查' : '素材检查',
          filePath,
          message: `${label}不是可读取文件。`,
          nextAction:
            scope === 'cover'
              ? '请重新选择本地图片封面文件。'
              : '请重新选择本地图片或视频文件。',
        };
      }
      if (fileStat.size <= 0) {
        return {
          code: scope === 'cover' ? 'cover_unreadable' : 'material_unreadable',
          scope,
          stage: scope === 'cover' ? '封面检查' : '素材检查',
          filePath,
          message: `${label}是空文件。`,
          nextAction:
            scope === 'cover'
              ? '请重新生成或上传有效封面。'
              : '请重新上传有效素材。',
        };
      }
    } catch {
      return {
        code: scope === 'cover' ? 'cover_missing' : 'material_missing',
        scope,
        stage: scope === 'cover' ? '封面检查' : '素材检查',
        filePath,
        message: `${label}不存在或暂时无法读取。`,
        nextAction:
          scope === 'cover'
            ? '请确认封面仍在本机可访问目录，或重新选择封面。'
            : '请确认素材仍在本机可访问目录，或重新上传素材。',
      };
    }

    return null;
  }

  private resolveMaterialKind(filePath: string): AutoUploadMaterialKind {
    const ext = filePath.split('?')[0]?.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
    if (['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video';
    return 'unknown';
  }

  private resolveMaterialKindLabel(kind: AutoUploadMaterialKind) {
    if (kind === 'image') return '图片文件';
    if (kind === 'video') return '视频文件';
    return '未知类型文件';
  }

  private inferContentKindFromFiles(
    fileList: string[],
  ): AutoUploadPublishPayload['contentKind'] {
    if (this.hasAnyVideoMaterial(fileList)) return 'video';
    if (
      fileList.some(
        (filePath) => this.resolveMaterialKind(filePath) === 'image',
      )
    )
      return 'article';
    return undefined;
  }

  private hasAnyVideoMaterial(fileList: string[]) {
    return fileList.some(
      (filePath) => this.resolveMaterialKind(filePath) === 'video',
    );
  }

  private async collectArticlePublishIdentityIssues(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishPreflightIssue[]> {
    const issues: AutoUploadPublishPreflightIssue[] = [];
    const ownerScope = await this.resolvePublishOwnerScope();
    const articleDelegate = (
      this.prisma as unknown as {
        article?: {
          findFirst?: (args: Record<string, unknown>) => Promise<{
            id: string;
            title: string;
            content: string;
            finalHtml: string | null;
            contentType: string;
            contentFormat: string;
            updatedAt: Date;
          } | null>;
        };
      }
    ).article;

    for (let index = 0; index < payloads.length; index += 1) {
      const payload = payloads[index];
      if (payload.contentKind !== 'article') continue;
      const platform = this.resolvePlatformName(payload.type);
      const identity = payload.sourceIdentity;
      const base = {
        scope: 'payload' as const,
        stage: '来源内容检查',
        payloadIndex: index,
        platformType: payload.type,
        platform,
        account: payload.accountIdentity?.name,
      };

      if (
        !payload.articleId?.trim() ||
        !identity ||
        identity.sourceType !== 'article' ||
        !identity.sourceId?.trim() ||
        identity.sourceId !== payload.articleId
      ) {
        issues.push({
          ...base,
          code: 'article_identity_missing',
          field: 'articleId',
          message: `${platform} 发布缺少明确的来源文章。`,
          nextAction: '请重新选择文章后再发布。',
        });
        continue;
      }

      if (!payload.body?.trim()) {
        issues.push({
          ...base,
          code: 'article_body_missing',
          field: 'body',
          message: `${platform} 发布缺少完整正文。`,
          nextAction: '请重新载入来源文章后再发布。',
        });
        continue;
      }

      if (typeof articleDelegate?.findFirst !== 'function') continue;
      const article = await articleDelegate.findFirst({
        where: { id: payload.articleId, ...ownerScope },
        select: {
          id: true,
          title: true,
          content: true,
          finalHtml: true,
          contentType: true,
          contentFormat: true,
          updatedAt: true,
        },
      });
      if (!article) {
        issues.push({
          ...base,
          code: 'article_missing',
          field: 'articleId',
          message: `${platform} 找不到当前账号可用的来源文章。`,
          nextAction: '请回到文章库重新选择内容。',
        });
        continue;
      }

      const canonicalBody = article.finalHtml || article.content;
      const updatedAt = new Date(article.updatedAt).toISOString();
      const identityMatches =
        identity.sourceId === article.id &&
        identity.title === article.title &&
        identity.contentType === article.contentType &&
        identity.contentFormat === article.contentFormat &&
        identity.updatedAt === updatedAt;
      if (payload.body !== canonicalBody || !identityMatches) {
        issues.push({
          ...base,
          code: 'article_changed',
          field: 'sourceIdentity',
          message: `${platform} 的来源文章已发生变化。`,
          nextAction: '请重新载入最新文章并再次确认发布内容。',
        });
      }
    }

    return issues;
  }

  private resolvePayloadAccountLabel(payload: AutoUploadPublishPayload) {
    return payload.accountIdentity?.name || '未选择账号';
  }

  private resolveAccountLabelForPayload(
    payload: AutoUploadPublishPayload,
    accountByFile: Map<string, AutoUploadAccount>,
  ) {
    const names = (payload.accountList || []).map((filePath) => {
      const account = accountByFile.get(filePath);
      return account ? this.resolveAccountName(account) : '未识别账号';
    });

    return payload.accountIdentity?.name || names.join('、') || '未选择账号';
  }

  private resolvePlatformForAccountFile(
    payloads: AutoUploadPublishPayload[],
    accountFile: string,
  ) {
    const payload = payloads.find((item) =>
      item.accountList?.includes(accountFile),
    );
    return payload ? this.resolvePlatformName(payload.type) : undefined;
  }

  private resolvePayloadAccountIds(payloads: AutoUploadPublishPayload[]) {
    const ids = payloads
      .flatMap((payload) => [
        ...(payload.accountIds || []),
        ...(payload.accountList || []).map((accountFile) =>
          this.findAccountIdFromFile(accountFile),
        ),
      ])
      .filter(
        (id): id is number =>
          typeof id === 'number' && Number.isInteger(id) && id > 0,
      );

    return [...new Set(ids)];
  }

  private resolvePayloadAccountIdsOption(payloads: AutoUploadPublishPayload[]) {
    const ids = this.resolvePayloadAccountIds(payloads);
    return ids.length ? { ids } : {};
  }

  private findAccountIdFromFile(accountFile: string) {
    const match = accountFile.match(/(?:^|[_-])account[_-]?(\d+)\.json$/i);
    if (match) {
      return Number(match[1]);
    }
    return undefined;
  }

  private formatPreflightIssue(issue: AutoUploadPublishPreflightIssue) {
    return [
      issue.platform ? `平台：${issue.platform}` : null,
      issue.account ? `账号：${issue.account}` : null,
      issue.filePath
        ? issue.scope === 'cover'
          ? '封面：已选择'
          : '素材：已选择'
        : null,
      `阶段：${issue.stage}`,
      `原因：${issue.message}`,
      `下一步：${issue.nextAction}`,
    ]
      .filter(Boolean)
      .join('，');
  }

  private mapAccountsByFile(accounts: AutoUploadAccount[]) {
    const map = new Map<string, AutoUploadAccount>();
    for (const account of accounts) {
      const keys = [
        account.stableId,
        account.filePath,
        String(account.id),
        `account_${account.id}.json`,
        `local-engine-${account.id}`,
        account.userName,
        account.profileName ?? undefined,
      ];
      for (const key of keys) {
        if (key) map.set(key, account);
      }
    }
    return map;
  }

  private dedupeAccounts(accounts: AutoUploadAccount[]) {
    const map = new Map<string, AutoUploadAccount>();
    for (const account of accounts) {
      const key = [
        account.platformKey || account.platform,
        account.id ||
          account.stableId ||
          account.filePath ||
          account.userName ||
          account.profileName,
      ].join(':');
      const existing = map.get(key);
      if (!existing || (existing.status !== 1 && account.status === 1)) {
        map.set(key, account);
      }
    }
    return Array.from(map.values());
  }

  private attachDurableAccountIdentity(
    payload: AutoUploadPublishPayload,
    account?: AutoUploadAccount,
  ): AutoUploadPublishPayload {
    if (!account) return payload;
    return {
      ...payload,
      accountIdentity: {
        id: account.stableId || String(account.id),
        name: account.accountName || this.resolveAccountName(account),
        platform: account.platformKey || account.platform,
        status:
          account.statusCode || (account.status === 1 ? 'ready' : 'expired'),
      },
    };
  }

  private requireRiskPolicyService() {
    if (!this.riskPolicyService) {
      throw new BadRequestException(
        '发布确认服务不可用，已阻止本次平台提交。',
      );
    }
    return this.riskPolicyService;
  }

  private async resolvePublishApprovalScope(context?: BackendRiskContext) {
    const requestContext = this.authRequestContext?.get();
    const requestUser = requestContext?.user;
    const userId =
      requestUser?.id?.trim() || String(context?.accountId || '').trim();
    const sessionId =
      requestContext?.sessionId?.trim() || String(context?.deviceId || '').trim();
    if (!userId || !sessionId) {
      throw new UnauthorizedException('真实发布需要当前登录会话的一次性确认。');
    }

    try {
      const membership = await this.prisma.tenantMember.findFirst({
        where: { userId, status: 'active' },
        orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
        select: { tenantId: true },
      });
      if (membership?.tenantId) {
        return {
          tenantId: membership.tenantId,
          userId,
          sessionId,
          operator: context?.accountName || userId,
        };
      }
    } catch (error) {
      if (requestUser?.kaypalLocalOnly !== true) throw error;
    }

    if (
      requestUser?.kaypalLocalOnly === true &&
      requestUser.id.trim() === userId
    ) {
      return {
        tenantId: `local-desktop:${userId}`,
        userId,
        sessionId,
        operator: context?.accountName || userId,
      };
    }
    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  private async buildPublishApprovalTarget(
    payloads: AutoUploadPublishPayload[],
    scope: { tenantId: string; userId: string; sessionId: string },
  ) {
    const normalizedPayloads = await Promise.all(
      payloads.map(async (payload) => {
        const body = typeof payload.body === 'string' ? payload.body : '';
        const articleId =
          payload.articleId || payload.sourceIdentity?.sourceId || '';
        const articleDelegate = (
          this.prisma as unknown as {
            article?: {
              findFirst?: (args: Record<string, unknown>) => Promise<
                | {
                    id: string;
                    title: string;
                    content: string;
                    finalHtml: string | null;
                    contentType: string;
                    contentFormat: string;
                    updatedAt: Date;
                  }
                | null
              >;
            };
          }
        ).article;
        const sourceArticle =
          articleId && articleDelegate?.findFirst
            ? await articleDelegate.findFirst({
                where: {
                  id: articleId,
                  tenantId: scope.tenantId,
                  userId: scope.userId,
                },
                select: {
                  id: true,
                  title: true,
                  content: true,
                  finalHtml: true,
                  contentType: true,
                  contentFormat: true,
                  updatedAt: true,
                },
              })
            : null;
        const sourceBody = sourceArticle
          ? sourceArticle.finalHtml || sourceArticle.content || ''
          : body;
        const filePaths = Array.from(
          new Set([
            ...(payload.fileList || []),
            ...(payload.accountList || []),
            ...(payload.coverPath ? [payload.coverPath] : []),
            ...Object.values(payload.coverPaths || {}),
          ]),
        );
        return {
          payload: {
            ...payload,
            body: undefined,
            bodySha256: createHash('sha256').update(body).digest('hex'),
          },
          sourceArticle: sourceArticle
            ? {
                id: sourceArticle.id,
                title: sourceArticle.title,
                contentType: sourceArticle.contentType,
                contentFormat: sourceArticle.contentFormat,
                updatedAt: sourceArticle.updatedAt.toISOString(),
                bodySha256: createHash('sha256')
                  .update(sourceBody)
                  .digest('hex'),
              }
            : null,
          files: await Promise.all(
            filePaths.map((filePath) => this.publishFileFingerprint(filePath)),
          ),
        };
      }),
    );
    const fingerprint = createHash('sha256')
      .update(
        this.stablePublishJson({
          version: 1,
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          payloads: normalizedPayloads,
        }),
      )
      .digest('hex');
    return `auto-upload-publish:${fingerprint}`;
  }

  private async buildRetryPublishApprovalTarget(
    prepared: PreparedRetryPublishTask,
    scope: { tenantId: string; userId: string; sessionId: string },
  ) {
    const payloadTarget = await this.buildPublishApprovalTarget(
      prepared.retryPayloads,
      scope,
    );
    const { durableRecord, task } = prepared;
    const fingerprint = createHash('sha256')
      .update(
        this.stablePublishJson({
          version: 1,
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          record: {
            databaseId: durableRecord.databaseId,
            publicId: durableRecord.publicId,
            tenantId: durableRecord.tenantId,
            userId: durableRecord.userId,
            status: durableRecord.status,
            message: durableRecord.message,
            createdAt: durableRecord.createdAt.toISOString(),
            envelopeVersion: durableRecord.envelope.version,
            envelopeCreatedAt: durableRecord.envelope.createdAt,
            envelopeUpdatedAt: durableRecord.envelope.updatedAt,
            result: durableRecord.envelope.result,
          },
          task: {
            id: task.id,
            title: task.title,
            platformType: task.platform_type,
            platform: task.platform,
            accountFile: task.account_file,
            fileList: task.file_list,
            tags: task.tags,
            dryRun: task.dry_run,
            status: task.status,
            message: task.message,
            updatedAt: task.updated_at,
          },
          payloadTarget,
        }),
      )
      .digest('hex');
    return `auto-upload-retry:${fingerprint}`;
  }

  private async buildResumeBlockedApprovalSnapshot(
    accountId: number | undefined,
    state: ResumeBlockedPublishState,
    scope: { tenantId: string; userId: string; sessionId: string },
  ): Promise<ResumeBlockedApprovalSnapshot> {
    const preparedByTaskId = new Map<number, PreparedRetryPublishTask>();
    const candidates = await Promise.all(
      [...state.candidates]
        .sort((left, right) => left.id - right.id)
        .map(async (task) => {
          const account = state.accountByFile.get(task.accountFile);
          let retryTarget: string | undefined;
          let retryBlockedReason: string | undefined;
          try {
            const prepared = await this.prepareRetryPublishTask(task.id);
            preparedByTaskId.set(task.id, prepared);
            retryTarget = await this.buildRetryPublishApprovalTarget(
              prepared,
              scope,
            );
          } catch (error) {
            retryBlockedReason =
              error instanceof Error ? error.message : '发布记录不可重试';
          }
          return {
            task,
            account: account
              ? {
                  id: account.id,
                  type: account.type,
                  platform: account.platform,
                  filePath: account.filePath,
                  accountName: this.resolveAccountName(account),
                  status: account.status,
                  statusLabel: account.statusLabel,
                }
              : null,
            retryTarget,
            retryBlockedReason,
          };
        }),
    );
    const fingerprint = createHash('sha256')
      .update(
        this.stablePublishJson({
          version: 1,
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          accountId: accountId ?? null,
          candidates,
        }),
      )
      .digest('hex');
    return {
      target: `auto-upload-resume-blocked:${fingerprint}`,
      preparedByTaskId,
    };
  }

  private async publishFileFingerprint(filePath: string) {
    const resolvedPath = this.resolvePublishFilePath(filePath);
    try {
      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile()) {
        return { filePath, resolvedPath, missing: true };
      }
      return {
        filePath,
        resolvedPath,
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs),
        sha256: await this.hashPublishFile(resolvedPath),
      };
    } catch {
      return { filePath, resolvedPath, missing: true };
    }
  }

  private resolvePublishFilePath(filePath: string) {
    return filePath.includes('/') || filePath.includes('\\')
      ? filePath
      : join(
          process.env.AUTO_UPLOAD_MATERIALS_DIR ||
            resolveProjectDataPath('materials'),
          filePath,
        );
  }

  private hashPublishFile(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private stablePublishJson(value: unknown): string {
    const normalize = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map((item) => normalize(item));
      if (input && typeof input === 'object') {
        return Object.fromEntries(
          Object.entries(input as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, normalize(item)]),
        );
      }
      return input;
    };
    return JSON.stringify(normalize(value));
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
      throw new UnauthorizedException('请先登录后查看发布内容。');
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

  private createAccountIssue(
    account: AutoUploadAccount,
  ): AutoUploadAccountHealthIssue {
    return {
      accountId: account.id,
      accountFile: account.filePath,
      accountName: this.resolveAccountName(account),
      platformType: account.type,
      platform: account.platform,
      status: 'expired',
      message: `${account.platform}账号「${this.resolveAccountName(account)}」登录态失效或不可用。`,
      nextAction: `请在本机浏览器重新登录 ${account.platform}，完成后点击校验状态，再恢复被阻断任务。`,
    };
  }

  private findAccountBlockedTasks(
    tasks: AutoUploadPublishTask[],
    accountByFile: Map<string, AutoUploadAccount>,
  ): AutoUploadAccountHealth['waitingTasks'] {
    return tasks
      .filter((task) => this.isAccountBlockedTask(task, accountByFile))
      .map((task) => ({
        id: task.id,
        title: task.title || `任务 ${task.id}`,
        platform: task.platform || this.resolvePlatformName(task.platform_type),
        accountFile: task.account_file,
        status: task.status,
        message: task.message,
        canResume: accountByFile.get(task.account_file)?.status === 1,
        nextAction:
          accountByFile.get(task.account_file)?.status === 1
            ? '账号已恢复，可重新提交任务。'
            : '请先重登该账号，恢复登录态后再重试。',
      }));
  }

  private isAccountBlockedTask(
    task: AutoUploadPublishTask,
    accountByFile: Map<string, AutoUploadAccount>,
  ) {
    if (!task.account_file) return false;
    const account = accountByFile.get(task.account_file);
    const text = `${task.status} ${task.message || ''} ${JSON.stringify(task.result || {})}`;
    return (
      ['failed', 'blocked'].includes(task.status) &&
      (/账号|登录|cookie|Cookie|失效|扫码|授权|login/i.test(text) ||
        !account ||
        account.status !== 1)
    );
  }

  private resolveAccountName(account: AutoUploadAccount) {
    return (
      account.profileName ||
      account.userName ||
      account.filePath ||
      `账号 ${account.id}`
    );
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
      9: '公众号',
    };
    return names[type] || `未知平台 ${type}`;
  }

  private async loadRemoteFile(
    url: string,
    fallbackName: string,
  ): Promise<AutoUploadUploadFile> {
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
      if (!match) {
        throw new Error('卡图数据格式无效');
      }

      const mimetype = match[1] || 'image/png';
      const isBase64 = Boolean(match[2]);
      const raw = decodeURIComponent(match[3] || '');
      const buffer = isBase64 ? Buffer.from(raw, 'base64') : Buffer.from(raw);
      const ext = this.extensionFromMime(mimetype);

      return {
        buffer,
        mimetype,
        originalname: `${fallbackName}.${ext}`,
      };
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) {
      throw new Error(`下载卡图失败：HTTP ${response.status}`);
    }

    const mimetype = response.headers.get('content-type') || 'image/png';
    const ext =
      this.extensionFromMime(mimetype) || this.extensionFromUrl(url) || 'png';

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimetype,
      originalname: `${fallbackName}.${ext}`,
    };
  }

  private safeBaseName(value: string) {
    return (
      value.replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || 'xiaohongshu-card'
    );
  }

  private async buildInteractionLog(
    limit: number,
  ): Promise<AutoUploadLogFile | null> {
    try {
      const taskTypeFromPrisma: Record<string, string> = {
        DOUYIN_COMMENT_REPLY: 'douyin-comment-reply',
        DOUYIN_DIRECT_MESSAGE_REPLY: 'douyin-direct-message-reply',
        WECHAT_REPLY_DRAFT: 'wechat-reply-draft',
        WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
        WECHAT_CONTACT_ADD: 'wechat-contact-add',
        WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
        WECHAT_MOMENTS_MARKETING: 'wechat-moments-marketing',
        CUSTOMER_FOLLOW_UP: 'customer-follow-up',
      };
      const taskStatusFromPrisma: Record<string, string> = {
        QUEUED: 'queued',
        RUNNING: 'running',
        WAITING_FOR_SEND_CONFIRMATION: 'waiting_for_send_confirmation',
        COMPLETED: 'completed',
        FAILED: 'failed',
        BLOCKED: 'blocked',
        SKIPPED: 'skipped',
        NO_TARGET: 'no_target',
        PAUSED: 'paused',
      };

      const rows = await this.prisma.interactionTask.findMany({
        orderBy: { updatedAt: 'desc' },
        take: Math.max(1, Math.min(limit, 200)),
      });

      if (!rows.length) {
        return null;
      }

      const lines = rows.flatMap((row) => {
        const task = (row.config || {}) as {
          type?: string;
          typeLabel?: string;
          status?: string;
          statusLabel?: string;
          accountName?: string;
          platformName?: string;
          targetName?: string;
          nextAction?: string;
          events?: Array<{
            level: string;
            message: string;
            createdAt: string;
          }>;
        };
        const header = [
          `[${this.formatDate(row.updatedAt)}]`,
          task.typeLabel || taskTypeFromPrisma[row.taskType] || row.taskType,
          task.statusLabel || taskStatusFromPrisma[row.status] || row.status,
          task.platformName || '本地',
          task.accountName || '未指定账号',
          '->',
          task.targetName || row.currentTarget || '未指定对象',
        ].join(' ');
        const events = (task.events || []).slice(-6).map((event) => {
          return `  - ${this.formatDate(event.createdAt)} [${event.level}] ${event.message}`;
        });

        return [header, ...events];
      });

      return {
        key: 'local-engine-interaction',
        platform: '互动任务',
        filename: 'local-engine-interaction.log',
        path: 'database://local_engine_interaction_tasks',
        size: lines.join('\n').length,
        updatedAt: new Date(rows[0].updatedAt).toISOString(),
        lines,
      };
    } catch {
      return null;
    }
  }

  private formatDate(value: Date | string) {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return date.toISOString().replace('T', ' ').slice(0, 19);
  }

  private extensionFromMime(mimetype: string) {
    if (mimetype.includes('jpeg') || mimetype.includes('jpg')) return 'jpg';
    if (mimetype.includes('webp')) return 'webp';
    if (mimetype.includes('gif')) return 'gif';
    return 'png';
  }

  private extensionFromUrl(url: string) {
    const cleanUrl = url.split('?')[0] || '';
    const ext = cleanUrl.split('.').pop()?.toLowerCase();
    return ext && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
      ? ext
      : null;
  }
}

/**
 * 5409 老 SQLite 用中文 platform ("抖音"), runtime_executions 用英文 ("douyin").
 * 双向 alias 用于匹配.
 */
const PLATFORM_NAME_ALIASES: Record<string, string[]> = {
  抖音: ['抖音', 'douyin'],
  视频号: ['视频号', 'wechat-channel'],
  小红书: ['小红书', 'xiaohongshu'],
  快手: ['快手', 'kuaishou'],
  B站: ['B站', 'bilibili'],
  douyin: ['douyin', '抖音'],
  'wechat-channel': ['wechat-channel', '视频号'],
  xiaohongshu: ['xiaohongshu', '小红书'],
  kuaishou: ['kuaishou', '快手'],
  bilibili: ['bilibili', 'B站'],
};
