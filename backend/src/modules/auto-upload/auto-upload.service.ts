import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
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
} from './auto-upload.client';

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
    | 'bili_partition_missing';
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

export type PublishBatchResult = AutoUploadPublishBatchResult;

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

@Injectable()
export class AutoUploadService {
  constructor(
    private readonly autoUploadClient: AutoUploadClient,
    private readonly prisma: PrismaService,
  ) {}

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

  cleanupInteractionEvidence(retentionDays?: number) {
    return this.autoUploadClient.cleanupInteractionEvidence(retentionDays);
  }

  async listAccounts(options?: {
    validate?: boolean;
    force?: boolean;
    ids?: (number | string)[];
  }) {
    const accounts = await this.autoUploadClient.listAccounts(options);
    // 2026-06-04: 真实 session 状态从 runtime_executions 最近一条反推
    // 5409 老 SQLite 的 status 字段已不可信 (服务早停, session 早过期)
    // 匹配按 platform (绕开 5409 int accountId vs Postgres cuid 不匹配)
    const sessionMap = await this.getAccountSessionStatusMap();
    return accounts.map((acc) => {
      // 5409 SQLite 存中文 platform ("抖音"), DB 存英文 ("douyin"). 双向映射
      const lookupKeys = PLATFORM_NAME_ALIASES[acc.platform] ?? [acc.platform];
      let session:
        | {
            status: 'logged_in' | 'needs_login' | 'error' | 'unknown';
            lastDispatchAt: string;
            lastOk: boolean;
            lastReason: string;
          }
        | undefined;
      for (const key of lookupKeys) {
        session = sessionMap.get(key);
        if (session) break;
      }
      return {
        ...acc,
        sessionStatus: session?.status ?? 'unknown',
        lastDispatchAt: session?.lastDispatchAt ?? null,
        lastDispatchOk: session?.lastOk ?? null,
        lastDispatchReason: session?.lastReason ?? null,
      };
    });
  }

  /**
   * 按 platform 反查最近 30 分钟内 dispatch 结果, 推 session 状态.
   * - 有最近 dispatch 且 ok=true  → 'logged_in'
   * - 有最近 dispatch 且 ok=false + reason=send_failed + message 含"未登录" → 'needs_login'
   * - 有最近 dispatch 但其它失败 → 'error'
   * - 30 分钟内无 dispatch → 'unknown' (无法判定, 不再瞎标"正常")
   */
  private async getAccountSessionStatusMap(): Promise<
    Map<
      string,
      {
        status: 'logged_in' | 'needs_login' | 'error' | 'unknown';
        lastDispatchAt: string;
        lastOk: boolean;
        lastReason: string;
      }
    >
  > {
    // 24h cutoff: 抖音 session 通常 7-15 天有效, 但 cookie 可能被服务器主动踢出.
    // 用最近 24h 内的 dispatch 当真值信号, 比静态 "status: 1" 准得多.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const map = new Map<
      string,
      {
        status: 'logged_in' | 'needs_login' | 'error' | 'unknown';
        lastDispatchAt: string;
        lastOk: boolean;
        lastReason: string;
      }
    >();
    for (const r of rows) {
      if (map.has(r.platform)) continue; // first (most recent) wins
      const msg = r.userMessage ?? '';
      let status: 'logged_in' | 'needs_login' | 'error' | 'unknown' = 'unknown';
      if (r.ok) {
        status = 'logged_in';
      } else if (/未登录|login|扫码登录/i.test(msg)) {
        status = 'needs_login';
      } else {
        status = 'error';
      }
      map.set(r.platform, {
        status,
        lastDispatchAt: r.createdAt.toISOString(),
        lastOk: r.ok,
        lastReason: r.reasonCode,
      });
    }
    return map;
  }

  async getAccountHealth(
    options: { validate?: boolean; force?: boolean } = {},
  ): Promise<AutoUploadAccountHealth> {
    let accounts: AutoUploadAccount[] = [];
    let accountError: string | null = null;
    try {
      accounts = await this.autoUploadClient.listAccounts({
        validate: options.validate ?? true,
        force: options.force,
      });
    } catch (error) {
      accountError =
        error instanceof Error ? error.message : '本地发布引擎不可用';
    }
    const tasks = await this.autoUploadClient.listTasks(200).catch(() => []);
    const accountByFile = this.mapAccountsByFile(accounts);
    const issues: AutoUploadAccountHealthIssue[] = accounts
      .filter((account) => account.status !== 1)
      .map((account) => this.createAccountIssue(account));
    if (accountError) {
      issues.unshift({
        accountName: '本地发布引擎',
        platform: '本地发布服务',
        status: 'missing',
        message: `无法读取本机浏览器账号：${accountError}`,
        nextAction: '请先启动 本地发布服务，再刷新校验账号状态。',
      });
    }
    const waitingTasks = this.findAccountBlockedTasks(tasks, accountByFile);

    return {
      checkedAt: new Date().toISOString(),
      totalAccounts: accounts.length,
      readyAccounts: accounts.filter((account) => account.status === 1).length,
      expiredAccounts: accounts.filter((account) => account.status !== 1)
        .length,
      issues,
      waitingTasks,
    };
  }

  async prepareAccountRelogin(
    id: number,
  ): Promise<AutoUploadAccountReloginRecovery> {
    const accounts = await this.autoUploadClient.listAccounts({
      validate: true,
      force: true,
      ids: [id],
    });
    const account = accounts.find((item) => item.id === id);
    if (!account) {
      throw new NotFoundException('平台账号不存在，请先刷新账号列表');
    }
    const [opened, tasks] = await Promise.all([
      this.autoUploadClient.openAccounts([id]),
      this.autoUploadClient.listTasks(200).catch(() => []),
    ]);
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
        status: account.status === 1 ? 'ready' : 'expired',
        statusLabel: account.statusLabel,
      },
      opened: opened.opened,
      resumeCandidates,
      nextAction:
        account.status === 1
          ? resumeCandidates.length
            ? '账号当前可用，可点击“恢复阻断任务”重试这些任务。'
            : '账号当前可用，暂无因该账号阻断的待恢复任务。'
          : `请在本机打开的 ${account.platform} 后台完成扫码或登录，再刷新校验；恢复前不会自动提交外部动作。`,
    };
  }

  openAccounts(ids: (number | string)[]) {
    return this.autoUploadClient.openAccounts(ids);
  }

  openInteractionEntry(input: { accountId: number; entryType: string }) {
    return this.autoUploadClient.openInteractionEntry(input);
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

  async deleteAccount(
    id: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const riskAudit = assertBackendRiskGate({
      action: 'platform-account-delete',
      target: `account:${id}`,
      riskLevel: 'high',
      confirmation: options.confirmation,
      context: options.context,
      reason: '删除平台账号会移除本地账号绑定和登录态引用。',
    });
    const result = await this.autoUploadClient.deleteAccount(id);

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

  listTasks(limit?: number) {
    return this.autoUploadClient.listTasks(limit);
  }

  async retryPublishTask(
    id: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ) {
    const tasks = await this.autoUploadClient.listTasks(200);
    const task = tasks.find((item) => item.id === id);
    if (!task) {
      throw new NotFoundException('发布任务不存在');
    }

    if (!task.account_file) {
      throw new BadRequestException('发布任务缺少账号文件，无法重试');
    }

    const recorded = await this.findRecordedPublishPayload(task.id);
    const payloadSource = recorded ? 'recorded' : 'reconstructed';
    const payload = recorded
      ? this.normalizeRetryPayload(recorded.payload, task)
      : this.reconstructRetryPayload(task);
    const restoredFields = this.describeRestoredPayloadFields(payload, task);
    const missingFields = this.describeMissingPayloadFields(payload);

    const previousBatchResult = await this.findPublishBatchResult(task.id);

    if (previousBatchResult && previousBatchResult.platforms.length > 1) {
      const failedEntries = previousBatchResult.platforms.filter(
        (entry) =>
          entry.status === 'failed' || entry.status === 'material_error',
      );

      if (
        failedEntries.length > 0 &&
        failedEntries.length < previousBatchResult.platforms.length
      ) {
        const failedTaskIds = failedEntries
          .map((entry) => entry.publishTaskId)
          .filter((tid): tid is string => Boolean(tid));

        const retryResults: Array<{
          taskId: string;
          platform: string;
          status: 'retried' | 'skipped' | 'failed';
          message: string;
        }> = [];

        const retryPayloads: AutoUploadPublishPayload[] = [];

        for (const entry of failedEntries) {
          const failedTask = entry.publishTaskId
            ? tasks.find((t) => String(t.id) === entry.publishTaskId)
            : null;

          if (!failedTask) {
            retryResults.push({
              taskId: entry.publishTaskId || String(task.id),
              platform: entry.platform,
              status: 'skipped',
              message: '未找到对应的失败任务',
            });
            continue;
          }

          const failedRecorded = await this.findRecordedPublishPayload(
            failedTask.id,
          );
          const failedPayload = failedRecorded
            ? this.normalizeRetryPayload(failedRecorded.payload, failedTask)
            : this.reconstructRetryPayload(failedTask);

          try {
            await this.assertPublishPreflightReady([failedPayload]);
            retryPayloads.push(failedPayload);
          } catch (error) {
            retryResults.push({
              taskId: String(failedTask.id),
              platform: entry.platform,
              status: 'failed',
              message: error instanceof Error ? error.message : '预检失败',
            });
          }
        }

        if (!retryPayloads.length) {
          return {
            retriedFrom: task.id,
            task,
            batchRetry: true,
            payloadSource,
            restoredFields,
            missingFields,
            riskAudit: null,
            result: null,
            retryResults,
          };
        }

        const riskAudit = assertBackendRiskGate({
          action: 'retry-publish',
          target: `batch-failed:${failedTaskIds.join(',')}`,
          riskLevel: 'high',
          confirmation: options.confirmation,
          context: options.context,
          reason: `重试 ${retryPayloads.length} 个失败平台的发布任务。`,
        });

        const publishResult =
          await this.autoUploadClient.publishBatch(retryPayloads);
        await this.recordPublishPayloads(retryPayloads, publishResult);
        const sanitizedPublishResult =
          this.sanitizePublishResponse(publishResult);

        const publishTaskIds = Array.isArray(sanitizedPublishResult?.taskIds)
          ? sanitizedPublishResult.taskIds
          : [];
        publishTaskIds.forEach((newTaskId, index) => {
          const retryPayload = retryPayloads[index];
          if (!retryPayload) return;
          const engineResult = sanitizedPublishResult?.results?.[index];
          retryResults.push({
            taskId: String(newTaskId),
            platform: this.resolvePlatformName(retryPayload.type),
            status: engineResult?.ok === false ? 'failed' : 'retried',
            message:
              engineResult?.message ||
              (engineResult?.ok === true
                ? '平台证据已确认'
                : '已重新提交，等待平台回执或页面回读证据'),
          });
        });

        return {
          retriedFrom: task.id,
          task,
          batchRetry: true,
          retriedCount: retryPayloads.length,
          payloadSource,
          restoredFields,
          missingFields,
          riskAudit,
          result: sanitizedPublishResult,
          retryResults,
        };
      }
    }

    const riskAudit = assertBackendRiskGate({
      action: 'retry-publish',
      target: `${task.platform || this.resolvePlatformName(task.platform_type)}:${task.title || task.id}`,
      riskLevel: 'high',
      confirmation: options.confirmation,
      context: options.context,
      reason: '重试发布会重新向外部平台提交内容。',
    });
    await this.assertPublishPreflightReady([payload]);
    const result = await this.autoUploadClient.publishBatch([payload]);
    await this.recordPublishPayloads([payload], result);
    const sanitizedResult = this.sanitizePublishResponse(result);

    return {
      retriedFrom: task.id,
      task,
      payloadSource,
      restoredFields,
      missingFields,
      riskAudit,
      result: sanitizedResult,
    };
  }

  async preflightPublishBatch(
    payloads: AutoUploadPublishPayload[],
  ): Promise<AutoUploadPublishPreflightResult> {
    const issues: AutoUploadPublishPreflightIssue[] = [];
    const checkedAt = new Date().toISOString();
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
      await this.autoUploadClient.getHealth();
    } catch (error) {
      issues.push({
        code: 'engine_unavailable',
        scope: 'engine',
        stage: '发布服务在线检查',
        platform: '本地发布服务',
        account: '自动化服务',
        message: `本地发布服务不可访问：${error instanceof Error ? error.message : 'unknown error'}`,
        nextAction: '请先启动 本地发布服务，确认 /health 在线后再提交。',
      });
    }

    if (!payloads.length) {
      issues.push({
        code: 'payload_empty',
        scope: 'payload',
        stage: '发布参数检查',
        message: '真实发布 payload 为空。',
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
          nextAction:
            '请从图文发布或视频发布入口提交，确保 payload.contentKind 为 article 或 video。',
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
              account: accountFile,
              message: `账号文件 ${accountFile} 未在本地账号库找到。`,
              nextAction: '请到发布中心-平台账号重新绑定该平台账号。',
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
          platform: '本地发布服务',
          account: '自动化服务',
          message: `发布前账号检查无法连接发布服务：${error instanceof Error ? error.message : 'unknown error'}`,
          nextAction: '请先启动 本地发布服务，并确认平台账号登录态后重试。',
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
          message: `封面 ${filePath} 不是图片文件。`,
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
          message: `${platform} ${payload.contentKind === 'article' ? '图文发布' : '视频发布'}素材类型不匹配：${filePath} 是 ${this.resolveMaterialKindLabel(actualKind)}。`,
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
        ? `发布 preflight 未通过：${issues.map((issue) => this.formatPreflightIssue(issue)).join('；')}`
        : `发布 preflight 通过：${payloads.length} 个 payload，${accountFiles.length} 个账号，${materialFiles.length} 个素材，${coverFiles.length} 个封面。`,
      payloadCount: payloads.length,
      accountCount: accountFiles.length,
      materialCount: materialFiles.length,
      issues,
    };
  }

  async resumeAccountBlockedTasks(
    accountId?: number,
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ): Promise<AutoUploadResumeBlockedTasksResult> {
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
    const riskAudit = assertBackendRiskGate({
      action: 'resume-blocked-publish',
      target: accountId
        ? `account:${accountId}`
        : `blocked-tasks:${candidates.length}`,
      riskLevel: 'high',
      confirmation: options.confirmation,
      context: options.context,
      reason: '恢复阻断任务可能批量重新提交外部平台发布。',
    });
    const results: AutoUploadResumeBlockedTasksResult['results'] = [];

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
            : `账号文件 ${task.accountFile} 未在本地账号库找到，请重新绑定。`,
        });
        continue;
      }

      try {
        const retry = await this.retryPublishTask(task.id, {
          confirmation: {
            ...options.confirmation,
            confirmedAction: 'retry-publish',
          },
          context: options.context,
        });
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

    return {
      checkedAt: new Date().toISOString(),
      riskAudit,
      resumed: results.filter((item) => item.status === 'resumed').length,
      skipped: results.filter((item) => item.status !== 'resumed').length,
      results,
    };
  }

  async uploadMaterial(file: AutoUploadUploadFile, filename?: string) {
    return this.autoUploadClient.uploadMaterial({ file, filename });
  }

  async importArticleMaterials(articleId: string) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
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
      confirmation: options.confirmation,
      context: options.context,
      reason: '删除素材会修改本地文件/素材库。',
    });
    const result = await this.autoUploadClient.deleteMaterial(id);

    return { ...result, riskAudit };
  }

  async publishBatch(
    payloads: AutoUploadPublishPayload[],
    options: {
      confirmation?: BackendRiskConfirmationInput;
      context?: BackendRiskContext;
    } = {},
  ): Promise<PublishBatchResult & { riskAudit?: BackendRiskAuditEvent }> {
    const riskAudit = assertBackendRiskGate({
      action: 'publish',
      target: payloads
        .map(
          (payload) =>
            `${this.resolvePlatformName(payload.type)}:${payload.title}`,
        )
        .join('；'),
      riskLevel: 'high',
      confirmation: options.confirmation,
      context: options.context,
      reason:
        payloads.length > 1
          ? '批量发布会向多个平台账号提交内容。'
          : '发布会向外部平台提交内容。',
    });

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
    const preEntries: AutoUploadPublishPlatformEntry[] = [];

    for (const payload of payloads) {
      const platform = this.resolvePlatformName(payload.type);
      const accountId = payload.accountList?.[0] || '';
      const account = accountId ? accountByFile.get(accountId) : null;

      if (account && account.status !== 1) {
        preEntries.push({
          platform,
          accountId,
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
          status: 'material_error',
          failureReason: `素材不可读：${materialError}`,
          nextAction: '请确认素材文件存在且可读后重试',
        });
        continue;
      }

      validPayloads.push(payload);
    }

    if (validPayloads.length > 0) {
      const preflight = await this.preflightPublishBatch(validPayloads);
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
      const engineResult =
        await this.autoUploadClient.publishBatch(validPayloads);
      await this.recordPublishPayloads(validPayloads, engineResult);

      const taskIds = Array.isArray(engineResult?.taskIds)
        ? engineResult.taskIds
        : [];
      const engineResults = Array.isArray(engineResult?.results)
        ? engineResult.results
        : [];

      const publishEntries: AutoUploadPublishPlatformEntry[] =
        validPayloads.map((payload, index) => {
          const platform = this.resolvePlatformName(payload.type);
          const accountId = payload.accountList?.[0] || '';
          const taskId = taskIds[index];
          const result = engineResults[index];

          if (result?.ok === false) {
            return {
              platform,
              accountId,
              status: 'failed' as const,
              failureReason: result.message || '发布失败',
              nextAction: '请检查发布参数后重试',
              publishTaskId: taskId != null ? String(taskId) : undefined,
            };
          }

          const evidence = this.extractPublishEvidence(result);
          if (evidence) {
            return {
              platform,
              accountId,
              status: 'success' as const,
              publishTaskId: taskId != null ? String(taskId) : undefined,
              publishUrl: evidence.publishUrl,
              externalId: evidence.externalId,
              evidence,
            };
          }

          return {
            platform,
            accountId,
            status:
              taskId != null
                ? ('pending_manual' as const)
                : ('not_integrated' as const),
            failureReason:
              result?.message ||
              (taskId != null
                ? '本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。'
                : '本地发布引擎未返回任务 ID、平台回执或页面回读证据。'),
            nextAction:
              taskId != null
                ? '请在发布任务或平台后台确认结果；回读或回执补齐前不能视为商用发布成功。'
                : '请接入真实发布执行与结果回读后再标记成功。',
            publishTaskId: taskId != null ? String(taskId) : undefined,
          };
        });

      const allEntries = [...preEntries, ...publishEntries];
      const batchResult = this.buildBatchResult(allEntries);

      for (const entry of publishEntries) {
        if (entry.publishTaskId) {
          await this.storePublishBatchResult(
            Number(entry.publishTaskId),
            batchResult,
          );
        }
      }

      return { ...batchResult, riskAudit };
    }

    const batchResult = this.buildBatchResult(preEntries);
    return { ...batchResult, riskAudit };
  }

  async getPublishBatchResults(taskId: number): Promise<PublishBatchResult> {
    const result = await this.findPublishBatchResult(taskId);
    if (!result) {
      throw new NotFoundException('未找到该任务的发布结果');
    }

    return {
      platforms: result.platforms.map((entry) => ({
        platform: entry.platform,
        accountId: entry.accountId,
        status: entry.status,
        failureReason: entry.failureReason,
        nextAction: entry.nextAction,
        publishTaskId: entry.publishTaskId,
        publishUrl: entry.publishUrl,
        externalId: entry.externalId,
        evidence: entry.evidence,
      })),
      summary: result.summary,
    };
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

  private async recordPublishPayloads(
    payloads: AutoUploadPublishPayload[],
    result: AutoUploadPublishResponse | null | undefined,
  ) {
    const taskIds = Array.isArray(result?.taskIds) ? result.taskIds : [];
    if (!taskIds.length) return;

    const records = await this.readPublishPayloadRecords();
    const recordedAt = new Date().toISOString();
    taskIds.forEach((taskId, index) => {
      const payload = payloads[index] || payloads[0];
      if (!payload) return;
      records[String(taskId)] = {
        taskId,
        payload,
        recordedAt,
      };
    });

    await this.writePublishPayloadRecords(records);
  }

  private async findRecordedPublishPayload(taskId: number) {
    const records = await this.readPublishPayloadRecords();

    return records[String(taskId)] || null;
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

  private async writePublishPayloadRecords(
    records: Record<string, AutoUploadRecordedPublishPayload>,
  ) {
    const filePath = this.publishPayloadStorePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
  }

  private publishPayloadStorePath() {
    return join(
      process.cwd(),
      '..',
      '.local-logs',
      'auto-upload-publish-payloads.json',
    );
  }

  private async storePublishBatchResult(
    taskId: number,
    result: PublishBatchResult,
  ) {
    const records = await this.readPublishBatchResultsStore();
    records[String(taskId)] = result;
    await this.writePublishBatchResultsStore(records);
  }

  private async findPublishBatchResult(
    taskId: number,
  ): Promise<PublishBatchResult | null> {
    const records = await this.readPublishBatchResultsStore();
    return records[String(taskId)] || null;
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

  private async writePublishBatchResultsStore(
    records: Record<string, PublishBatchResult>,
  ) {
    const filePath = this.publishBatchResultStorePath();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8');
  }

  private publishBatchResultStorePath() {
    return join(
      process.cwd(),
      '..',
      '.local-logs',
      'auto-upload-batch-results.json',
    );
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
        notIntegrated: platforms.filter((p) => p.status === 'not_integrated')
          .length,
      },
    };
  }

  private extractPublishEvidence(
    result: AutoUploadEnginePublishResultItem | undefined,
  ): AutoUploadPublishEvidence | null {
    if (!result || result.ok !== true) {
      return null;
    }

    const publishUrl = [result.publishUrl, result.platformUrl]
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim();
    const externalId = [result.externalId, result.articleId, result.postId]
      .find((value) => typeof value === 'string' && value.trim())
      ?.trim();

    if (publishUrl || externalId) {
      return {
        source: 'platform-api',
        publishUrl,
        externalId,
        raw: result.evidence,
      };
    }

    if (this.hasStructuredPublishEvidence(result.evidence)) {
      const evidence = result.evidence as Record<string, unknown>;
      return {
        source: this.resolvePublishEvidenceSource(evidence.source),
        publishUrl: this.resolveEvidenceUrl(evidence),
        externalId:
          typeof evidence.externalId === 'string'
            ? evidence.externalId
            : undefined,
        raw: evidence,
      };
    }

    return null;
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
        if (result.ok !== true || this.extractPublishEvidence(result)) {
          return result;
        }

        const taskId = response.taskIds?.[index];
        return {
          ...result,
          ok: null,
          message:
            result.message ||
            (taskId != null
              ? '本地发布引擎只返回任务 ID，尚无平台发布回执或页面回读证据。'
              : '本地发布引擎未返回平台发布证据。'),
        };
      }),
    };
  }

  private hasStructuredPublishEvidence(evidence: unknown) {
    if (!evidence || typeof evidence !== 'object') {
      return false;
    }

    const record = evidence as Record<string, unknown>;
    return (
      record.readbackOk === true ||
      (typeof record.publishUrl === 'string' && record.publishUrl.trim()) ||
      (typeof record.externalId === 'string' && record.externalId.trim()) ||
      (typeof record.platformUrl === 'string' && record.platformUrl.trim())
    );
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

    // If filePath is just a filename, prepend the videoFile directory
    const fullPath =
      filePath.includes('/') || filePath.includes('\\')
        ? filePath
        : join('/Users/yanghy/auto-upload/videoFile', filePath);

    try {
      const fileStat = await stat(fullPath);
      await access(fullPath, constants.R_OK);
      if (!fileStat.isFile()) {
        return {
          code: scope === 'cover' ? 'cover_unreadable' : 'material_unreadable',
          scope,
          stage: scope === 'cover' ? '封面检查' : '素材检查',
          filePath,
          message: `${label} ${filePath} 不是可读取文件。`,
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
          message: `${label} ${filePath} 是空文件。`,
          nextAction:
            scope === 'cover'
              ? '请重新生成或上传有效封面。'
              : '请重新上传有效素材。',
        };
      }
    } catch (error) {
      return {
        code: scope === 'cover' ? 'cover_missing' : 'material_missing',
        scope,
        stage: scope === 'cover' ? '封面检查' : '素材检查',
        filePath,
        message: `${label} ${filePath} 不存在或不可读：${error instanceof Error ? error.message : 'unknown error'}`,
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

  private resolvePayloadAccountLabel(payload: AutoUploadPublishPayload) {
    return payload.accountList?.join('、') || '未选择账号';
  }

  private resolveAccountLabelForPayload(
    payload: AutoUploadPublishPayload,
    accountByFile: Map<string, AutoUploadAccount>,
  ) {
    const names = (payload.accountList || []).map((filePath) => {
      const account = accountByFile.get(filePath);
      return account ? this.resolveAccountName(account) : filePath;
    });

    return names.join('、') || '未选择账号';
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
        ? `${issue.scope === 'cover' ? '封面' : '素材'}：${issue.filePath}`
        : null,
      `阶段：${issue.stage}`,
      `原因：${issue.message}`,
      `下一步：${issue.nextAction}`,
    ]
      .filter(Boolean)
      .join('，');
  }

  private mapAccountsByFile(accounts: AutoUploadAccount[]) {
    return new Map(accounts.map((account) => [account.filePath, account]));
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
        WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
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
