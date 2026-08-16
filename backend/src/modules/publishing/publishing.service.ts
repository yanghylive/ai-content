import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { localEnginePublishAccountId } from './local-engine-account-id';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WechatPublisherService,
  type WechatPublishResult,
  type WechatOfficialDraftPayload,
} from './wechat-publisher/wechat-publisher.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { AutoUploadAccount } from '../auto-upload/auto-upload.client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  CredentialEnvelopeService,
  CredentialEnvelopeError,
  CredentialMigrationRequiredError,
  isSensitiveCredentialKey,
} from '../../common/credential-envelope.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import {
  JpagePreviewClientService,
  type JpageVerifiedFile,
} from './jpage-preview/jpage-preview-client.service';

const PUBLISH_RECORD_METADATA_PREFIX = 'publish-record:v1:';

type PublishRecordMetadata = {
  version: 1;
  platform: string;
  accountId: string;
  resultId?: string;
  publishUrl?: string;
  evidence?: unknown;
  readback?: {
    matched: boolean;
    expectedText?: string;
    actualText?: string;
  };
  failureReason?: string;
};

type PublishingScope = {
  tenantId: string;
  userId: string;
  sessionId: string;
};

type PublishSourceIdentity = {
  sourceType: 'article';
  sourceId: string;
  title: string;
  contentType: string;
  contentFormat: string;
  updatedAt: string;
  sourceUrl: string;
};

type PublishAccountMutation = {
  platform?: string;
  name?: string;
  status?: string;
  appId?: string | null;
  apiToken?: string | null;
  config?: Prisma.InputJsonValue;
};

type JpagePreviewReceipt = {
  version: 1;
  status: 'content_verified' | 'verified';
  articleId: string;
  accountId: string;
  revision: string;
  baseUrl: string;
  visibility: 'private';
  tags: string[];
  assetGate: 'pass';
  integratedRenderGate: 'pass';
  contentReadbackGate: 'pass';
  remoteRenderGate: 'pending' | 'pass';
  markdown: JpageVerifiedFile;
  html: JpageVerifiedFile;
  uploadedAt: string;
  remoteRenderVerifiedAt?: string;
};

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wechatPublisher: WechatPublisherService,
    private readonly autoUploadService: AutoUploadService,
    private readonly authRequestContext: AuthRequestContextService,
    private readonly riskPolicyService: RiskPolicyService,
    private readonly credentialEnvelope: CredentialEnvelopeService,
    private readonly jpagePreviewClient: JpagePreviewClientService,
  ) {}

  // ================= 账号管理接口 =================

  async getAccounts(
    options: {
      validate?: boolean;
      force?: boolean;
      ids?: number[];
      source?: string;
      platform?: string;
    } = {},
  ) {
    const scope = await this.resolvePublishingScope();
    if (options.force || options.validate || options.ids?.length) {
      await this.syncLocalEngineAccounts(scope, options);
    }
    const rows = await this.prisma.publishAccount.findMany({
      where: this.ownerWhere(scope),
      orderBy: { createdAt: 'desc' },
    });
    const accounts = rows.map((account) => this.expandPublishAccount(account));
    return this.dedupeExpandedPublishAccounts(accounts)
      .filter((account) => this.matchesAccountFilters(account, options))
      .map((account) => this.toPublicAccount(account));
  }

  private dedupeExpandedPublishAccounts<T extends Record<string, unknown>>(
    accounts: T[],
  ) {
    const bestByAccount = new Map<string, T>();
    for (const account of accounts) {
      const key = this.expandedPublishAccountKey(account);
      const existing = bestByAccount.get(key);
      if (
        !existing ||
        this.expandedPublishAccountScore(account) >
          this.expandedPublishAccountScore(existing)
      ) {
        bestByAccount.set(key, account);
      }
    }
    return Array.from(bestByAccount.values());
  }

  private expandedPublishAccountKey(account: Record<string, unknown>) {
    const id = this.asAccountText(account.id);
    if (account.source !== 'local-engine') {
      return `api:${id}`;
    }
    const config = this.recordValue(account.config);
    const engineAccountId = this.asAccountText(
      account.engineAccountId ?? config.engineAccountId,
    );
    const platform = this.asAccountText(account.platform);
    return `local-engine:${platform}:${engineAccountId || id}`;
  }

  private asAccountText(value: unknown): string {
    return typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'bigint'
        ? String(value)
        : '';
  }

  private expandedPublishAccountScore(account: Record<string, unknown>) {
    const config = this.recordValue(account.config);
    const status =
      this.optionalText(account.status) || this.optionalText(config.status);
    const sessionStatus =
      this.optionalText(account.sessionStatus) ||
      this.optionalText(config.sessionStatus);
    const readyScore = status === 'ready' ? 100 : 0;
    const sessionScore =
      sessionStatus === 'logged_in'
        ? 80
        : sessionStatus === 'needs_login'
          ? -40
          : 0;
    const dispatchScore =
      config.lastDispatchOk === true
        ? 40
        : config.lastDispatchOk === false
          ? -20
          : 0;
    const updatedAt =
      account.updatedAt instanceof Date
        ? account.updatedAt.getTime()
        : new Date(
            this.asAccountText(account.updatedAt) ||
              this.asAccountText(config.syncedAt) ||
              '0',
          ).getTime();
    return (
      readyScore +
      sessionScore +
      dispatchScore +
      (Number.isFinite(updatedAt) ? updatedAt / 1e15 : 0)
    );
  }

  async createAccount(data: {
    platform: string;
    name: string;
    status?: string;
    appId?: string;
    apiToken?: string;
    config?: Record<string, unknown>;
  }) {
    const scope = await this.resolvePublishingScope();
    const mutation = this.buildAccountMutation(data, true);
    const account = await this.prisma.publishAccount.create({
      data: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        platform: mutation.platform!,
        name: mutation.name!,
        status: mutation.status,
        appId: mutation.appId,
        apiToken: mutation.apiToken,
        config: mutation.config,
      },
    });
    return this.toPublicAccount(account);
  }

  async updateAccount(id: string, data: Record<string, unknown>) {
    const scope = await this.resolvePublishingScope();
    const account = await this.findScopedAccount(id, scope);
    const mutation = this.buildAccountMutation(data, false);
    this.rejectLegacyCredentialUpdate(account, data);
    const updated = await this.prisma.publishAccount.update({
      where: { id: account.id },
      data: mutation,
    });
    return this.toPublicAccount(updated);
  }

  async createAccountDeleteConfirmation(id: string) {
    const scope = await this.resolvePublishingScope();
    const account = await this.findScopedAccount(id, scope);
    const target = this.accountDeleteTarget(account, scope);
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'platform-account-delete',
        riskLevel: 'high',
        target,
        reason: `删除发布账号“${account.name}”（${account.id}）`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async deleteAccount(id: string, confirmationId?: string) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('删除发布账号前需要一次性确认');
    }
    const scope = await this.resolvePublishingScope();
    const account = await this.findScopedAccount(id, scope);
    const target = this.accountDeleteTarget(account, scope);
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'platform-account-delete',
        riskLevel: 'high',
        target,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
    const deleted = await this.prisma.publishAccount.delete({
      where: { id: account.id },
    });
    return this.toPublicAccount(deleted);
  }

  async getJpagePreview(articleId: string) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    const prepared = this.prepareJpageArticle(article);
    const receipt = this.readJpagePreviewReceipt(article.wechatData);
    return {
      required:
        this.recordValue(article.wechatData).channel ===
        'wechat-official-account',
      ready: Boolean(
        receipt &&
        receipt.status === 'verified' &&
        receipt.remoteRenderGate === 'pass' &&
        this.jpageReceiptMatches(prepared, receipt),
      ),
      currentRevision: prepared.revision,
      receipt,
    };
  }

  async createJpagePreviewConfirmation(
    articleId: string,
    jpageAccountId: string,
  ) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(jpageAccountId, scope),
    );
    const prepared = this.prepareJpagePreview(article, account);
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'jpage-private-preview-upload',
        riskLevel: 'high',
        target: prepared.confirmationTarget,
        reason: `将文章《${article.title}》的 Markdown 与 HTML 上传为 JPage 私有预览`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async createJpagePreview(
    articleId: string,
    jpageAccountId: string,
    confirmationId?: string,
  ) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('上传 JPage 私有预览前需要一次性确认');
    }
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(jpageAccountId, scope),
    );
    const prepared = this.prepareJpagePreview(article, account);
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'jpage-private-preview-upload',
        riskLevel: 'high',
        target: prepared.confirmationTarget,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );

    const existing = this.readJpagePreviewReceipt(article.wechatData);
    if (existing && this.jpageReceiptMatches(prepared, existing)) {
      await this.verifyJpageReceiptRemote(existing, account);
      return {
        ready: existing.status === 'verified',
        receipt: existing,
      };
    }

    const [markdown, html] = await Promise.all([
      this.jpagePreviewClient.ensurePrivateFile({
        baseUrl: prepared.baseUrl,
        token: prepared.token,
        name: prepared.markdownName,
        content: prepared.markdown,
        tags: prepared.tags,
      }),
      this.jpagePreviewClient.ensurePrivateFile({
        baseUrl: prepared.baseUrl,
        token: prepared.token,
        name: prepared.htmlName,
        content: prepared.html,
        tags: prepared.tags,
      }),
    ]);
    const receipt: JpagePreviewReceipt = {
      version: 1,
      status: 'content_verified',
      articleId: article.id,
      accountId: account.id,
      revision: prepared.revision,
      baseUrl: prepared.baseUrl,
      visibility: 'private',
      tags: prepared.tags,
      assetGate: 'pass',
      integratedRenderGate: 'pass',
      contentReadbackGate: 'pass',
      remoteRenderGate: 'pending',
      markdown,
      html,
      uploadedAt: new Date().toISOString(),
    };
    await this.persistJpagePreviewReceipt(article, receipt);
    return { ready: false, receipt };
  }

  async createJpageRemoteRenderConfirmation(articleId: string) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const prepared = this.prepareJpageArticle(article);
    const receipt = this.requireCurrentJpageReceipt(article, prepared);
    await this.verifyJpageReceiptForScope(receipt, scope);
    const target = this.jpageRenderConfirmationTarget(receipt, scope);
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'jpage-private-preview-render-verify',
        riskLevel: 'high',
        target,
        reason: `确认文章《${article.title}》的 JPage 私有 HTML 已完成移动端渲染检查`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async confirmJpageRemoteRender(articleId: string, confirmationId?: string) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('确认 JPage 远程渲染前需要一次性确认');
    }
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const prepared = this.prepareJpageArticle(article);
    const receipt = this.requireCurrentJpageReceipt(article, prepared);
    await this.verifyJpageReceiptForScope(receipt, scope);
    const target = this.jpageRenderConfirmationTarget(receipt, scope);
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'jpage-private-preview-render-verify',
        riskLevel: 'high',
        target,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
    const verified: JpagePreviewReceipt = {
      ...receipt,
      status: 'verified',
      remoteRenderGate: 'pass',
      remoteRenderVerifiedAt: new Date().toISOString(),
    };
    await this.persistJpagePreviewReceipt(article, verified);
    return { ready: true, receipt: verified };
  }

  private async syncLocalEngineAccounts(
    scope: PublishingScope,
    options: {
      validate?: boolean;
      force?: boolean;
      ids?: number[];
    },
  ) {
    let accounts: AutoUploadAccount[] = [];
    try {
      accounts = await this.autoUploadService.listAccounts({
        validate: options.validate,
        force: options.force,
        ids: options.ids,
      });
    } catch (error) {
      this.logger.warn(
        `同步本地发布账号失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const normalizedAccounts = this.dedupeLocalEngineAccounts(accounts);

    await Promise.all(
      normalizedAccounts.map((account) =>
        this.prisma.publishAccount.upsert({
          where: { id: this.localEnginePublishAccountId(account, scope) },
          create: {
            id: this.localEnginePublishAccountId(account, scope),
            tenantId: scope.tenantId,
            userId: scope.userId,
            platform: this.resolvePublishPlatform(account.type),
            name:
              account.profileName ||
              account.userName ||
              `本地账号 ${account.id}`,
            config: this.buildLocalEngineAccountConfig(account),
          },
          update: {
            tenantId: scope.tenantId,
            userId: scope.userId,
            platform: this.resolvePublishPlatform(account.type),
            name:
              account.profileName ||
              account.userName ||
              `本地账号 ${account.id}`,
            config: this.buildLocalEngineAccountConfig(account),
          },
        }),
      ),
    );
  }

  private localEnginePublishAccountId(
    account: AutoUploadAccount,
    scope: PublishingScope,
  ) {
    return localEnginePublishAccountId({
      engineAccountId: account.id,
      platform: this.resolvePublishPlatform(account.type),
      scope,
    });
  }

  private resolvePublishPlatform(type: number) {
    const map: Record<number, string> = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
      6: 'weibo',
      7: 'zhihu',
      8: 'toutiao',
    };
    return map[type] || `platform-${type}`;
  }

  private buildLocalEngineAccountConfig(
    account: AutoUploadAccount,
  ): Prisma.InputJsonValue {
    const config = {
      source: 'local-engine',
      engineAccountId: account.id,
      platformType: account.type,
      filePath: account.filePath,
      userName: account.userName,
      profileName: account.profileName ?? null,
      avatarPath: account.avatarPath ?? null,
      avatarUrl: account.avatarUrl ?? null,
      status: account.status === 1 ? 'ready' : 'expired',
      statusLabel: account.statusLabel,
      avatarUpdatedAt: account.avatarUpdatedAt ?? null,
      sessionStatus:
        account.sessionStatus ??
        (account.status === 1 ? 'logged_in' : 'needs_login'),
      lastDispatchAt: account.lastDispatchAt ?? null,
      lastDispatchOk: account.lastDispatchOk ?? account.status === 1,
      lastDispatchReason:
        account.lastDispatchReason ??
        (account.status === 1
          ? 'local_engine_account_ready'
          : 'local_engine_account_expired'),
      syncedAt: new Date().toISOString(),
    };
    return this.jsonValue(
      this.credentialEnvelope.encryptSensitiveConfig(config),
    );
  }

  private dedupeLocalEngineAccounts(accounts: AutoUploadAccount[]) {
    const byEngineAccount = new Map<string, AutoUploadAccount>();
    for (const account of accounts) {
      const key = `${account.type}:${account.id}`;
      const existing = byEngineAccount.get(key);
      if (
        !existing ||
        this.localEngineAccountScore(account) >
          this.localEngineAccountScore(existing)
      ) {
        byEngineAccount.set(key, account);
      }
    }
    return Array.from(byEngineAccount.values());
  }

  private localEngineAccountScore(account: AutoUploadAccount) {
    const sessionScore =
      account.sessionStatus === 'logged_in'
        ? 50
        : account.sessionStatus === 'unknown'
          ? 10
          : account.sessionStatus
            ? 0
            : 5;
    const readyScore = account.status === 1 ? 30 : 0;
    const dispatchScore = account.lastDispatchOk === true ? 20 : 0;
    return sessionScore + readyScore + dispatchScore;
  }

  private expandPublishAccount(
    account: Awaited<
      ReturnType<PrismaService['publishAccount']['findMany']>
    >[number],
  ) {
    const config = this.recordValue(account.config);
    if (config.source !== 'local-engine') {
      return account;
    }
    return {
      ...account,
      source: 'local-engine',
      engineAccountId:
        typeof config.engineAccountId === 'number' ||
        typeof config.engineAccountId === 'string'
          ? config.engineAccountId
          : undefined,
      filePath: this.optionalText(config.filePath) || undefined,
      status: this.optionalText(config.status) || account.status,
      statusLabel: this.optionalText(config.statusLabel) || undefined,
    };
  }

  private toPublicAccount(account: Record<string, unknown>) {
    const { apiToken, config, ...publicAccount } = account;
    const publicConfig = this.sanitizePublicConfig(config);
    return {
      ...publicAccount,
      hasApiToken: typeof apiToken === 'string' && apiToken.length > 0,
      config: publicConfig,
    };
  }

  private matchesAccountFilters(
    account: Awaited<
      ReturnType<PrismaService['publishAccount']['findMany']>
    >[number] & { source?: string },
    options: { source?: string; platform?: string },
  ) {
    if (options.source === 'api' && account.source === 'local-engine') {
      return false;
    }

    if (
      options.source === 'local-engine' &&
      account.source !== 'local-engine'
    ) {
      return false;
    }

    if (options.platform && account.platform !== options.platform) {
      return false;
    }

    return true;
  }

  // ================= 发布调度接口 =================

  /**
   * 为旧发布入口签发与当前会话、文章版本、正文和来源绑定的一次性确认。
   */
  async createPublishConfirmation(
    articleId: string,
    accountId: string,
    sourceUrl?: string,
  ) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    this.rejectLegacyPublishForAgentWakerWechat(article);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    const prepared = this.preparePublish(article, account, sourceUrl);

    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target: prepared.confirmationTarget,
        reason: `发布文章《${article.title}》到账号“${account.name}”`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  /**
   * 将文章发往指定账号。任何调用方都必须携带服务端签发的一次性确认；
   * 后台任务若没有明确的租户会话会失败关闭，不能回落到 legacy 账号。
   */
  async publishArticle(
    articleId: string,
    accountId: string,
    confirmationId?: string,
    sourceUrl?: string,
  ): Promise<{
    success: boolean;
    status: 'completed' | 'waiting';
    articleId: string;
    publishRecordId: string;
    durableRecordId: string;
    readback: WechatPublishResult['readback'] | null;
  }> {
    if (!confirmationId?.trim()) {
      throw new BadRequestException(
        '发布属于高风险操作，请先获取服务端一次性确认',
      );
    }

    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    this.rejectLegacyPublishForAgentWakerWechat(article);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    const accountConfig = this.recordValue(account.config);
    const prepared = this.preparePublish(article, account, sourceUrl);

    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'publish',
        riskLevel: 'high',
        target: prepared.confirmationTarget,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );

    const durableRecordId = `publish-${createHash('sha256')
      .update(prepared.operationFingerprint)
      .digest('hex')
      .slice(0, 40)}`;
    let record: Awaited<ReturnType<PrismaService['publishRecord']['create']>>;
    try {
      record = await this.prisma.publishRecord.create({
        data: {
          id: durableRecordId,
          tenantId: scope.tenantId,
          userId: scope.userId,
          durableRecordId,
          articleId: article.id,
          accountId: account.id,
          platform: account.platform,
          status: 'pending',
          sourceIdentity: this.jsonValue(prepared.sourceIdentity),
          bodySnapshot: prepared.body,
          payloadJson: this.jsonValue({
            articleId: article.id,
            accountId: account.id,
            platform: account.platform,
            title: prepared.sourceIdentity.title,
            contentType: prepared.sourceIdentity.contentType,
            contentFormat: prepared.sourceIdentity.contentFormat,
            bodySha256: prepared.bodySha256,
            sourceIdentity: prepared.sourceIdentity,
            confirmationId: confirmationId.trim(),
          }),
          resultJson: this.jsonValue({
            status: 'pending',
            recordedAt: new Date().toISOString(),
          }),
        },
      });
    } catch (error) {
      const code =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof (error as { code?: unknown }).code === 'string'
          ? (error as { code: string }).code
          : '';
      if (code === 'P2002') {
        // S0-P1-4：重复请求幂等返回已有记录，不抛 400（防重复发布）
        const existing = await this.prisma.publishRecord.findUnique({
          where: { id: durableRecordId },
          select: { id: true, status: true },
        });
        if (existing) {
          return {
            success: existing.status === 'success',
            status:
              existing.status === 'success' ? 'completed' : 'waiting',
            articleId: article.id,
            publishRecordId: existing.id,
            durableRecordId,
            readback: null,
          };
        }
        throw new BadRequestException('发布记录冲突，请重试');
      }
      throw error;
    }

    // result 提升到 try 外，catch 里据此判断「外部是否已成功」，
    // 避免外部已发布却因本地 DB 异常被误标 failed（S0-11）。
    let result: WechatPublishResult | undefined;
    try {
      if (accountConfig.source === 'local-engine') {
        const filePath =
          typeof accountConfig.filePath === 'string'
            ? accountConfig.filePath
            : '';
        const platformType = Number(accountConfig.platformType);
        if (!filePath || !Number.isInteger(platformType) || platformType <= 0) {
          throw new BadRequestException(
            '本地 Runtime 发布账号缺少 filePath 或 platformType，请刷新平台账号后重试',
          );
        }
        throw new BadRequestException(
          '文章库一键发布不能直接调用本地 Runtime：缺少可回读的发布素材文件。请进入发布中心选择素材后发布；该入口不会再走旧 5409 或假成功。',
        );
      }

      if (account.platform === 'wechat') {
        const apiToken = this.optionalText(account.apiToken);
        const appId = this.optionalText(account.appId);
        if (!apiToken || !appId) {
          throw new BadRequestException('微信发布需要配置 apiToken 和 appId');
        }

        result = await this.wechatPublisher.publish({
          apiToken,
          authorizerAppid: appId,
          apiUrl:
            this.optionalText(accountConfig.apiUrl) ||
            'https://mp.idouq.com/api/open/article',
          title: prepared.sourceIdentity.title,
          markdownContent: prepared.markdownContent,
          htmlContent: prepared.htmlContent,
          coverUrl: article.coverImage || undefined,
          sourceUrl: prepared.sourceIdentity.sourceUrl,
          categoryId: Number.isFinite(Number(accountConfig.categoryId))
            ? Number(accountConfig.categoryId)
            : undefined,
          needOpenComment:
            accountConfig.openComment !== undefined
              ? Number(accountConfig.openComment)
              : 1,
          onlyFansCanComment:
            accountConfig.onlyFansCanComment !== undefined
              ? Number(accountConfig.onlyFansCanComment)
              : 0,
        });
      } else {
        throw new BadRequestException(
          '该发布账号不是微信公众号 API 账号；请到发布中心走 3011 本地 Runtime 发布',
        );
      }

      const res = result!;
      const readbackMatched = res.readback?.matched === true;
      // 记录级回读状态（六步闭环 PublishReceipt 提列）：
      // 回读匹配=verified；平台返回外部 ID/URL 但未回读=uncertain（需人工确认，勿重复发布）
      const readbackState = readbackMatched
        ? 'verified'
        : res.publishUrl || res.articleId
          ? 'uncertain'
          : 'pending';
      const metadata: PublishRecordMetadata = {
        version: 1,
        platform: account.platform,
        accountId: account.id,
        resultId: res.articleId,
        publishUrl: res.publishUrl,
        evidence: res.evidence,
        readback: res.readback,
      };
      const recordUpdate = this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: readbackMatched ? 'success' : 'pending',
          readbackState,
          publishUrl: res.publishUrl || res.articleId,
          errorMessage: this.serializePublishRecordMetadata(metadata),
          resultJson: this.jsonValue({
            status: readbackMatched ? 'success' : 'pending',
            readbackState,
            providerArticleId: res.articleId,
            publishUrl: res.publishUrl ?? null,
            evidence: res.evidence ?? null,
            readback: res.readback ?? null,
            recordedAt: new Date().toISOString(),
          }),
        },
      });

      if (readbackMatched) {
        await this.prisma.$transaction([
          recordUpdate,
          this.prisma.article.updateMany({
            where: { id: article.id, ...this.ownerWhere(scope) },
            data: { status: 'published' },
          }),
        ]);
      } else {
        await recordUpdate;
      }

      return {
        success: readbackMatched,
        status: readbackMatched ? 'completed' : 'waiting',
        articleId: res.articleId,
        publishRecordId: record.id,
        durableRecordId,
        readback: res.readback ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // S0-11：外部已返回 publishUrl/articleId 说明可能已发布成功，
      // 本地异常时标 uncertain（结果不确定，需回查），不得误标 failed（防重复发布）。
      const externalSucceeded = Boolean(result?.publishUrl || result?.articleId);
      this.logger.error(
        `发布${externalSucceeded ? '结果不确定' : '失败'} [articleId: ${articleId}, accountId: ${accountId}]: ${message}`,
      );

      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: externalSucceeded ? 'pending' : 'failed',
          readbackState: externalSucceeded ? 'uncertain' : undefined,
          errorMessage: this.serializePublishRecordMetadata({
            version: 1,
            platform: account.platform,
            accountId: account.id,
            failureReason: message,
            ...(externalSucceeded
              ? { externalResult: result?.publishUrl || result?.articleId }
              : {}),
          }),
          resultJson: this.jsonValue({
            status: externalSucceeded ? 'uncertain' : 'failed',
            failureReason: message,
            ...(externalSucceeded
              ? {
                  providerArticleId: result?.articleId ?? null,
                  publishUrl: result?.publishUrl ?? null,
                }
              : {}),
            recordedAt: new Date().toISOString(),
          }),
        },
      });

      throw new BadRequestException(
        externalSucceeded
          ? `发布结果不确定（外部可能已发布），请回查后确认: ${message}`
          : `发布失败: ${message}`,
      );
    }
  }

  async createWechatDraftConfirmation(
    articleId: string,
    accountId: string,
    sourceUrl?: string,
  ) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    await this.ensureJpagePreviewVerified(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    this.ensureWechatAccountReady(account);
    const prepared = this.preparePublish(article, account, sourceUrl);
    const config = this.recordValue(account.config);
    const thumbMediaId = this.requiredText(
      config.defaultThumbMediaId,
      '默认封面 media_id',
    );
    const target = `wechat-draft:${prepared.confirmationTarget}:${thumbMediaId}`;
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target,
        reason: `保存文章《${article.title}》到公众号“${account.name}”草稿箱`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async createWechatOfficialDraft(
    articleId: string,
    accountId: string,
    confirmationId?: string,
    sourceUrl?: string,
  ) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('保存公众号草稿前需要一次性确认');
    }
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    await this.ensureJpagePreviewVerified(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    this.ensureWechatAccountReady(account);
    const prepared = this.preparePublish(article, account, sourceUrl);
    if (!prepared.htmlContent) {
      throw new BadRequestException('公众号草稿需要已渲染的微信 HTML');
    }
    const config = this.recordValue(account.config);
    const thumbMediaId = this.requiredText(
      config.defaultThumbMediaId,
      '默认封面 media_id',
    );
    const target = `wechat-draft:${prepared.confirmationTarget}:${thumbMediaId}`;
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'publish',
        riskLevel: 'high',
        target,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );

    const recordId = `wechat-draft-${createHash('sha256')
      .update(`${prepared.operationFingerprint}:${thumbMediaId}`)
      .digest('hex')
      .slice(0, 40)}`;
    const existing = await this.prisma.publishRecord.findUnique({
      where: { id: recordId },
      select: { status: true },
    });
    if (existing) {
      throw new BadRequestException(
        `相同文章版本已有公众号草稿记录（${existing.status}），禁止重复写入。`,
      );
    }
    const record = await this.prisma.publishRecord.create({
      data: {
        id: recordId,
        tenantId: scope.tenantId,
        userId: scope.userId,
        durableRecordId: recordId,
        articleId: article.id,
        accountId: account.id,
        platform: 'wechat',
        status: 'pending',
        sourceIdentity: this.jsonValue(prepared.sourceIdentity),
        bodySnapshot: prepared.body,
        payloadJson: this.jsonValue({
          operation: 'wechat-official-draft-create',
          bodySha256: prepared.bodySha256,
          thumbMediaId,
          confirmationId: confirmationId.trim(),
        }),
        resultJson: this.jsonValue({ status: 'submitting' }),
      },
    });
    try {
      const metadata = this.recordValue(article.wechatData);
      const result = await this.wechatPublisher.createOfficialDraft({
        accessToken: account.apiToken,
        title: prepared.sourceIdentity.title,
        author: this.optionalText(metadata.author) ?? undefined,
        digest: this.optionalText(metadata.digest) ?? undefined,
        htmlContent: prepared.htmlContent,
        sourceUrl: prepared.sourceIdentity.sourceUrl,
        thumbMediaId,
        needOpenComment: Number(config.openComment ?? 1),
        onlyFansCanComment: Number(config.onlyFansCanComment ?? 0),
      });
      const payloadJson = this.recordValue(record.payloadJson);
      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: result.readback.matched ? 'draft_saved' : 'pending',
          publishUrl: result.mediaId,
          errorMessage: result.readback.failureReason || null,
          payloadJson: this.jsonValue({
            ...payloadJson,
            payload: result.payload,
          }),
          resultJson: this.jsonValue({
            status: result.readback.matched
              ? 'draft_saved'
              : 'readback_pending',
            mediaId: result.mediaId,
            payload: result.payload,
            readback: result.readback,
            recordedAt: new Date().toISOString(),
          }),
        },
      });
      return {
        publishRecordId: record.id,
        mediaId: result.mediaId,
        payload: result.payload,
        readback: result.readback,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          errorMessage: message,
          resultJson: this.jsonValue({
            status: 'failed',
            failureReason: message,
            recordedAt: new Date().toISOString(),
          }),
        },
      });
      throw new BadRequestException(`保存公众号草稿失败: ${message}`);
    }
  }

  async createWechatDraftReadbackConfirmation(recordId: string) {
    const scope = await this.resolvePublishingScope();
    const draft = await this.findPendingWechatDraftReadback(recordId, scope);
    const target = this.wechatDraftReadbackTarget(draft, scope);
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target,
        reason: `回读验证公众号草稿 ${draft.mediaId}，不重复写入草稿。`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async reconcileWechatOfficialDraft(
    recordId: string,
    confirmationId?: string,
  ) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('回读公众号草稿前需要一次性确认');
    }
    const scope = await this.resolvePublishingScope();
    const draft = await this.findPendingWechatDraftReadback(recordId, scope);
    const target = this.wechatDraftReadbackTarget(draft, scope);
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'publish',
        riskLevel: 'high',
        target,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );

    const draftAccount = this.decryptAccountCredentials(draft.account);
    const readback = await this.wechatPublisher.readbackOfficialDraft(
      this.requiredText(draftAccount.apiToken, 'Access Token'),
      draft.mediaId,
      draft.payload,
    );
    const status = readback.matched ? 'draft_saved' : 'pending';
    const resultJson = this.recordValue(draft.resultJson);
    await this.prisma.publishRecord.update({
      where: { id: draft.id },
      data: {
        status,
        publishUrl: draft.mediaId,
        errorMessage: readback.failureReason || null,
        resultJson: this.jsonValue({
          ...resultJson,
          status: readback.matched ? 'draft_saved' : 'readback_pending',
          mediaId: draft.mediaId,
          payload: draft.payload,
          readback,
          recordedAt: new Date().toISOString(),
        }),
      },
    });
    return {
      publishRecordId: draft.id,
      mediaId: draft.mediaId,
      status: readback.matched ? 'draft_saved' : 'readback_pending',
      readback,
    };
  }

  async createWechatOfficialPublishConfirmation(
    articleId: string,
    accountId: string,
    mediaId: string,
  ) {
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    this.ensureWechatAccountReady(account);
    const prepared = this.preparePublish(article, account);
    const cleanMediaId = this.requiredText(mediaId, '草稿 media_id');
    await this.requireVerifiedWechatDraft(
      article.id,
      account.id,
      cleanMediaId,
      prepared,
      scope,
    );
    const target = `wechat-official-publish:${prepared.confirmationTarget}:${cleanMediaId}`;
    return this.riskPolicyService.issueHighRiskApproval(
      {
        action: 'publish',
        riskLevel: 'high',
        target,
        reason: `正式发布公众号草稿《${article.title}》；草稿 ID：${cleanMediaId}`,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
  }

  async submitWechatOfficialPublish(
    articleId: string,
    accountId: string,
    mediaId: string,
    confirmationId?: string,
  ) {
    if (!confirmationId?.trim()) {
      throw new BadRequestException('正式发布公众号文章前需要独立确认');
    }
    const scope = await this.resolvePublishingScope();
    const article = await this.findScopedArticle(articleId, scope);
    await this.ensureAgentWakerWechatApproved(article, scope);
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(accountId, scope),
    );
    this.ensureWechatAccountReady(account);
    const prepared = this.preparePublish(article, account);
    const cleanMediaId = this.requiredText(mediaId, '草稿 media_id');
    await this.requireVerifiedWechatDraft(
      article.id,
      account.id,
      cleanMediaId,
      prepared,
      scope,
    );
    const target = `wechat-official-publish:${prepared.confirmationTarget}:${cleanMediaId}`;
    await this.riskPolicyService.consumeHighRiskApproval(
      {
        confirmationId: confirmationId.trim(),
        action: 'publish',
        riskLevel: 'high',
        target,
      },
      {
        tenantId: scope.tenantId,
        userId: scope.userId,
        sessionId: scope.sessionId,
        operator: scope.userId,
      },
    );
    const recordId = `wechat-publish-${createHash('sha256')
      .update(`${prepared.operationFingerprint}:${cleanMediaId}`)
      .digest('hex')
      .slice(0, 40)}`;
    const existing = await this.prisma.publishRecord.findUnique({
      where: { id: recordId },
      select: { status: true },
    });
    if (existing) {
      throw new BadRequestException(
        `该公众号草稿已有发布任务（${existing.status}），请先回查，禁止重复提交。`,
      );
    }
    const record = await this.prisma.publishRecord.create({
      data: {
        id: recordId,
        tenantId: scope.tenantId,
        userId: scope.userId,
        durableRecordId: recordId,
        articleId: article.id,
        accountId: account.id,
        platform: 'wechat',
        status: 'pending',
        sourceIdentity: this.jsonValue(prepared.sourceIdentity),
        bodySnapshot: prepared.body,
        payloadJson: this.jsonValue({
          operation: 'wechat-official-publish-submit',
          mediaId: cleanMediaId,
          confirmationId: confirmationId.trim(),
        }),
        resultJson: this.jsonValue({ status: 'submitting' }),
      },
    });
    let publishId = '';
    try {
      const submitted = await this.wechatPublisher.submitOfficialPublish(
        account.apiToken,
        cleanMediaId,
      );
      publishId = submitted.publishId;
      const status = await this.wechatPublisher.getOfficialPublishStatus(
        account.apiToken,
        publishId,
      );
      const recordStatus = this.wechatPublishRecordStatus(status.status);
      const recordUpdate = this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: recordStatus,
          publishUrl: status.articleUrl || status.articleId || null,
          errorMessage:
            recordStatus === 'failed' ? `微信发布终止：${status.status}` : null,
          resultJson: this.jsonValue({
            ...status,
            recordedAt: new Date().toISOString(),
          }),
        },
      });
      if (recordStatus === 'success') {
        await this.prisma.$transaction([
          recordUpdate,
          this.prisma.article.updateMany({
            where: { id: article.id, ...this.ownerWhere(scope) },
            data: { status: 'published' },
          }),
        ]);
      } else {
        await recordUpdate;
      }
      return { publishRecordId: record.id, ...status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: 'pending',
          errorMessage: message,
          resultJson: this.jsonValue({
            status: 'reconciling',
            publishId: publishId || null,
            failureReason: message,
            recordedAt: new Date().toISOString(),
          }),
        },
      });
      return {
        publishRecordId: record.id,
        publishId,
        status: 'reconciling' as const,
        failureReason: message,
      };
    }
  }

  async refreshWechatOfficialPublish(recordId: string) {
    const scope = await this.resolvePublishingScope();
    const record = await this.prisma.publishRecord.findFirst({
      where: { id: recordId, ...this.ownerWhere(scope), platform: 'wechat' },
      include: { account: true },
    });
    if (!record || !record.account) {
      throw new NotFoundException('公众号发布记录或账号凭据不存在');
    }
    const account = this.decryptAccountCredentials(record.account);
    if (!this.optionalText(account.apiToken)) {
      throw new NotFoundException('公众号发布记录或账号凭据不存在');
    }
    const result = this.recordValue(record.resultJson);
    const publishId = this.optionalText(result.publishId);
    if (!publishId) {
      return {
        publishId: '',
        status: 'reconciling' as const,
        failureReason:
          this.optionalText(result.failureReason) ||
          '平台提交结果不明确且缺少发布任务 ID，需要人工核对公众号后台。',
      };
    }
    const status = await this.wechatPublisher.getOfficialPublishStatus(
      this.optionalText(account.apiToken)!,
      publishId,
    );
    const recordStatus = this.wechatPublishRecordStatus(status.status);
    const recordUpdate = this.prisma.publishRecord.update({
      where: { id: record.id },
      data: {
        status: recordStatus,
        publishUrl: status.articleUrl || status.articleId || record.publishUrl,
        errorMessage:
          recordStatus === 'failed' ? `微信发布终止：${status.status}` : null,
        resultJson: this.jsonValue({
          ...status,
          recordedAt: new Date().toISOString(),
        }),
      },
    });
    if (recordStatus === 'success') {
      await this.prisma.$transaction([
        recordUpdate,
        this.prisma.article.updateMany({
          where: {
            id: record.articleId,
            ...this.ownerWhere(scope),
          },
          data: { status: 'published' },
        }),
      ]);
    } else {
      await recordUpdate;
    }
    return status;
  }

  /**
   * 获取某篇文章的发布记录
   */
  async getRecordsByArticle(articleId: string) {
    const scope = await this.resolvePublishingScope();
    const records = await this.prisma.publishRecord.findMany({
      where: { articleId, ...this.ownerWhere(scope) },
      include: { account: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => {
      const metadata = this.parsePublishRecordMetadata(record.errorMessage);
      return {
        ...record,
        account: record.account
          ? this.toPublicAccount(record.account as Record<string, unknown>)
          : record.account,
        errorMessage: metadata
          ? metadata.failureReason || null
          : record.errorMessage,
        resultId: metadata?.resultId,
        evidence: metadata?.evidence,
        readback: metadata?.readback,
      };
    });
  }

  private async resolvePublishingScope(): Promise<PublishingScope> {
    const context = this.authRequestContext.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    const sessionId = context?.sessionId?.trim() || '';
    if (!userId || !sessionId) {
      throw new UnauthorizedException('请先登录后管理发布账号和发布记录');
    }

    const tenantId = await this.authRequestContext.resolveTenantId(this.prisma);
    return { tenantId, userId, sessionId };
  }

  private ownerWhere(scope: PublishingScope) {
    return { tenantId: scope.tenantId, userId: scope.userId };
  }

  private async findScopedArticle(id: string, scope: PublishingScope) {
    const article = await this.prisma.article.findFirst({
      where: { id, ...this.ownerWhere(scope) },
    });
    if (!article) throw new NotFoundException('文章不存在');
    return article;
  }

  private async findScopedAccount(id: string, scope: PublishingScope) {
    const account = await this.prisma.publishAccount.findFirst({
      where: { id, ...this.ownerWhere(scope) },
    });
    if (!account) throw new NotFoundException('发布账号不存在');
    return account;
  }

  private decryptAccountCredentials<T extends Record<string, unknown>>(
    account: T,
  ): Omit<T, 'apiToken' | 'config'> & {
    apiToken: unknown;
    config: unknown;
  } {
    try {
      return {
        ...account,
        apiToken:
          typeof account.apiToken === 'string' && account.apiToken.trim()
            ? this.credentialEnvelope.decryptString(
                account.apiToken,
                'publishAccount.apiToken',
              )
            : account.apiToken,
        config: this.credentialEnvelope.decryptSensitiveConfig(
          account.config,
          'publishAccount.config',
        ),
      } as Omit<T, 'apiToken' | 'config'> & {
        apiToken: unknown;
        config: unknown;
      };
    } catch (error) {
      if (
        error instanceof CredentialMigrationRequiredError ||
        error instanceof CredentialEnvelopeError
      ) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException('发布账号凭据不可用，请重新配置账号凭据');
    }
  }

  private rejectLegacyCredentialUpdate(
    account: Record<string, unknown>,
    data: Record<string, unknown>,
  ) {
    if (
      this.credentialEnvelope.hasLegacyPlaintext(account.apiToken) &&
      data.apiToken === undefined
    ) {
      throw new BadRequestException(
        '发布账号 apiToken 仍是明文，请在本次更新中重新填写 apiToken 以完成加密迁移',
      );
    }
    if (
      this.credentialEnvelope.hasLegacySensitiveConfig(account.config) &&
      data.config === undefined
    ) {
      throw new BadRequestException(
        '发布账号 config 中仍有明文凭据，请在本次更新中重新提交 config 以完成加密迁移',
      );
    }
  }

  private buildAccountMutation(
    data: Record<string, unknown>,
    requireIdentity: boolean,
  ): PublishAccountMutation {
    const mutation: PublishAccountMutation = {};
    if (requireIdentity || data.platform !== undefined) {
      mutation.platform = this.requiredText(data.platform, '发布平台');
    }
    if (requireIdentity || data.name !== undefined) {
      mutation.name = this.requiredText(data.name, '账号名称');
    }
    if (data.status !== undefined) {
      mutation.status = this.requiredText(data.status, '账号状态');
    }
    if (data.appId !== undefined) {
      mutation.appId = this.optionalText(data.appId);
    }
    if (data.apiToken !== undefined) {
      const apiToken = this.optionalText(data.apiToken);
      mutation.apiToken = apiToken
        ? this.credentialEnvelope.encryptString(
            apiToken,
            'publishAccount.apiToken',
          )
        : null;
    }
    if (data.config !== undefined) {
      if (
        !data.config ||
        typeof data.config !== 'object' ||
        Array.isArray(data.config)
      ) {
        throw new BadRequestException('账号配置必须是对象');
      }
      mutation.config = this.jsonValue(
        this.credentialEnvelope.encryptSensitiveConfig(data.config),
      );
    }
    return mutation;
  }

  private preparePublish(
    article: Record<string, unknown>,
    account: Record<string, unknown>,
    requestedSourceUrl?: string,
  ) {
    const title = this.requiredText(article.title, '文章标题');
    const contentFormat = this.requiredText(
      article.contentFormat || 'markdown',
      '内容格式',
    );
    if (contentFormat !== 'markdown' && contentFormat !== 'html') {
      throw new BadRequestException('内容格式必须是 markdown 或 html');
    }
    const finalHtml = this.optionalText(article.finalHtml);
    const content = this.optionalText(article.content);
    const body = finalHtml || content || '';
    if (!this.hasMeaningfulBody(body)) {
      throw new BadRequestException('文章正文为空，禁止发布');
    }

    const sourceUrl = this.resolveArticleSourceUrl(article, requestedSourceUrl);
    if (!sourceUrl) {
      throw new BadRequestException(
        '文章缺少有效来源链接，请补充 http/https 来源后再发布',
      );
    }

    const updatedAt = this.validDate(article.updatedAt, '文章更新时间');
    const sourceIdentity: PublishSourceIdentity = {
      sourceType: 'article',
      sourceId: this.requiredText(article.id, '文章 ID'),
      title,
      contentType: this.requiredText(
        article.contentType || 'article',
        '内容类型',
      ),
      contentFormat,
      updatedAt: updatedAt.toISOString(),
      sourceUrl,
    };
    const bodySha256 = createHash('sha256').update(body).digest('hex');
    const targetFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: article.tenantId,
          userId: article.userId,
          articleId: article.id,
          accountId: account.id,
          accountUpdatedAt: this.validDate(
            account.updatedAt,
            '账号更新时间',
          ).toISOString(),
          sourceIdentity,
          bodySha256,
        }),
      )
      .digest('hex');
    const operationFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: article.tenantId,
          userId: article.userId,
          articleId: article.id,
          accountId: account.id,
          sourceIdentity,
          bodySha256,
        }),
      )
      .digest('hex');

    return {
      body,
      bodySha256,
      htmlContent:
        finalHtml ||
        (contentFormat === 'html' ? content || undefined : undefined),
      markdownContent:
        !finalHtml && contentFormat === 'markdown'
          ? content || undefined
          : undefined,
      sourceIdentity,
      operationFingerprint,
      confirmationTarget: `publishing:${sourceIdentity.sourceId}:${this.requiredText(account.id, '账号 ID')}:${targetFingerprint}`,
    };
  }

  private resolveArticleSourceUrl(
    article: Record<string, unknown>,
    requestedSourceUrl?: string,
  ) {
    const candidates: unknown[] = [requestedSourceUrl];
    const wechatMetadata = article.wechatData;
    if (
      wechatMetadata &&
      typeof wechatMetadata === 'object' &&
      !Array.isArray(wechatMetadata)
    ) {
      const record = wechatMetadata as Record<string, unknown>;
      candidates.push(record.sourceUrl, record.source_url, record.url);
      if (Array.isArray(record.sourceLedger)) {
        for (const item of record.sourceLedger) {
          const source = this.recordValue(item);
          candidates.push(source.url);
        }
      }
    }
    const metadata = article.xiaohongshuData;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const record = metadata as Record<string, unknown>;
      candidates.push(
        record.sourceUrl,
        record.source_url,
        record.originalUrl,
        record.original_url,
        record.url,
      );
    }

    for (const candidate of candidates) {
      const value = this.optionalText(candidate);
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          !parsed.username &&
          !parsed.password
        ) {
          return parsed.toString();
        }
      } catch {
        // Try the next source candidate.
      }
    }
    return null;
  }

  private hasMeaningfulBody(body: string) {
    if (/<(img|video|audio|iframe|svg)\b/i.test(body)) return true;
    const visibleText = body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(nbsp|#160|#xA0);/gi, ' ')
      .trim();
    return visibleText.length > 0;
  }

  private requiredText(value: unknown, label: string) {
    const text = this.optionalText(value);
    if (!text) throw new BadRequestException(`${label}不能为空`);
    return text;
  }

  private optionalText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private validDate(value: unknown, label: string) {
    const date =
      value instanceof Date
        ? value
        : typeof value === 'string' || typeof value === 'number'
          ? new Date(value)
          : new Date(Number.NaN);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${label}无效`);
    }
    return date;
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private rejectLegacyPublishForAgentWakerWechat(
    article: Record<string, unknown>,
  ) {
    const metadata = this.recordValue(article.wechatData);
    if (metadata.channel === 'wechat-official-account') {
      throw new BadRequestException(
        'AgentWaker 公众号文章必须使用“官方草稿 -> 独立发布确认 -> 状态回查”流程，不能走旧的一键发布入口。',
      );
    }
  }

  private ensureWechatAccountReady(
    account: Record<string, unknown>,
  ): asserts account is Record<string, unknown> & {
    platform: 'wechat';
    status: 'ready';
    apiToken: string;
  } {
    if (
      account.platform !== 'wechat' ||
      account.status !== 'ready' ||
      !this.optionalText(account.apiToken)
    ) {
      throw new BadRequestException(
        '请选择状态正常且已配置 Access Token 的公众号账号',
      );
    }
  }

  private accountDeleteTarget(
    account: Record<string, unknown>,
    scope: PublishingScope,
  ) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          id: account.id,
          platform: account.platform,
          name: account.name,
          status: account.status,
          appId: account.appId ?? null,
          apiTokenSha256: account.apiToken
            ? createHash('sha256')
                .update(this.asAccountText(account.apiToken))
                .digest('hex')
            : null,
          config: account.config ?? null,
          updatedAt: account.updatedAt ?? null,
        }),
      )
      .digest('hex');
    return `platform-account-delete:${scope.tenantId}:${scope.userId}:${scope.sessionId}:${this.requiredText(account.id, '账号 ID')}:${fingerprint}`;
  }

  private async findPendingWechatDraftReadback(
    recordId: string,
    scope: PublishingScope,
  ) {
    const record = await this.prisma.publishRecord.findFirst({
      where: {
        id: recordId,
        platform: 'wechat',
        ...this.ownerWhere(scope),
      },
      include: { account: true },
    });
    if (!record) throw new NotFoundException('公众号草稿记录不存在');
    const resultJson = this.recordValue(record.resultJson);
    if (
      !['pending', 'readback_pending'].includes(record.status) ||
      resultJson.status !== 'readback_pending'
    ) {
      throw new BadRequestException(
        '只有待回读的公众号草稿记录可以执行恢复回读，且不会重复 draft/add。',
      );
    }

    const account = this.recordValue(record.account);
    if (!Object.keys(account).length) {
      throw new NotFoundException('公众号草稿记录或账号不存在');
    }
    if (
      account.tenantId !== scope.tenantId ||
      account.userId !== scope.userId
    ) {
      throw new NotFoundException('公众号草稿记录或账号不存在');
    }
    this.ensureWechatAccountReady(account);

    const mediaId = this.requiredText(
      resultJson.mediaId || record.publishUrl,
      '草稿 media_id',
    );
    const payload = this.readWechatDraftPayload(
      record as Record<string, unknown>,
    );
    return {
      id: record.id,
      articleId: record.articleId,
      accountId: record.accountId,
      status: record.status,
      resultJson: record.resultJson,
      mediaId,
      payload,
      account,
    };
  }

  private readWechatDraftPayload(
    record: Record<string, unknown>,
  ): WechatOfficialDraftPayload {
    const payloadRecord = this.recordValue(record.payloadJson);
    const resultRecord = this.recordValue(record.resultJson);
    const persistedPayload = this.asWechatDraftPayload(payloadRecord.payload);
    if (persistedPayload) return persistedPayload;
    const resultPayload = this.asWechatDraftPayload(resultRecord.payload);
    if (resultPayload) return resultPayload;

    const sourceIdentity = this.recordValue(record.sourceIdentity);
    const title = this.requiredText(sourceIdentity.title, '草稿标题');
    const content = this.requiredText(record.bodySnapshot, '草稿正文');
    const sourceUrl = this.requiredText(
      sourceIdentity.sourceUrl,
      '草稿来源链接',
    );
    const thumbMediaId = this.requiredText(
      payloadRecord.thumbMediaId,
      '草稿封面 media_id',
    );
    return {
      articles: [
        {
          title,
          author: '',
          digest: '',
          content,
          content_source_url: sourceUrl,
          thumb_media_id: thumbMediaId,
          need_open_comment: 1,
          only_fans_can_comment: 0,
        },
      ],
    };
  }

  private asWechatDraftPayload(
    value: unknown,
  ): WechatOfficialDraftPayload | null {
    const payload = this.recordValue(value);
    const articles = payload.articles;
    const article = Array.isArray(articles)
      ? this.recordValue(articles[0])
      : {};
    if (
      !Array.isArray(articles) ||
      articles.length !== 1 ||
      !this.optionalText(article.title) ||
      typeof article.content !== 'string' ||
      !this.optionalText(article.content_source_url) ||
      !this.optionalText(article.thumb_media_id)
    ) {
      return null;
    }
    return {
      articles: [
        {
          title: this.requiredText(article.title, '草稿标题'),
          author: this.optionalText(article.author) || '',
          digest: this.optionalText(article.digest) || '',
          content: article.content,
          content_source_url: this.requiredText(
            article.content_source_url,
            '草稿来源链接',
          ),
          thumb_media_id: this.requiredText(
            article.thumb_media_id,
            '草稿封面 media_id',
          ),
          need_open_comment: Number(article.need_open_comment ?? 1),
          only_fans_can_comment: Number(article.only_fans_can_comment ?? 0),
        },
      ],
    };
  }

  private wechatDraftReadbackTarget(
    draft: {
      id: string;
      mediaId: string;
      payload: WechatOfficialDraftPayload;
    },
    scope: PublishingScope,
  ) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: scope.tenantId,
          userId: scope.userId,
          sessionId: scope.sessionId,
          recordId: draft.id,
          mediaId: draft.mediaId,
          payload: draft.payload,
        }),
      )
      .digest('hex');
    return `wechat-draft-readback:${scope.tenantId}:${scope.userId}:${scope.sessionId}:${draft.id}:${draft.mediaId}:${fingerprint}`;
  }

  private sanitizePublicConfig(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizePublicConfig(item));
    }
    if (!value || typeof value !== 'object') return value ?? null;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !isSensitiveCredentialKey(key))
        .map(([key, item]) => [key, this.sanitizePublicConfig(item)]),
    );
  }

  private async requireVerifiedWechatDraft(
    articleId: string,
    accountId: string,
    mediaId: string,
    prepared: ReturnType<PublishingService['preparePublish']>,
    scope: PublishingScope,
  ) {
    const records = await this.prisma.publishRecord.findMany({
      where: {
        articleId,
        accountId,
        platform: 'wechat',
        status: 'draft_saved',
        ...this.ownerWhere(scope),
      },
      select: {
        id: true,
        bodySnapshot: true,
        sourceIdentity: true,
        resultJson: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const verified = records.some((record) => {
      const result = this.recordValue(record.resultJson);
      const readback = this.recordValue(result.readback);
      const sourceIdentity = this.recordValue(record.sourceIdentity);
      return (
        result.mediaId === mediaId &&
        readback.matched === true &&
        record.bodySnapshot === prepared.body &&
        sourceIdentity.title === prepared.sourceIdentity.title &&
        sourceIdentity.sourceUrl === prepared.sourceIdentity.sourceUrl
      );
    });
    if (!verified) {
      throw new BadRequestException(
        '该草稿 media_id 不属于当前文章、账号和内容版本，或尚未通过标题回读验证。请重新保存草稿后再发布。',
      );
    }
  }

  private wechatPublishRecordStatus(status: string) {
    if (status === 'published') return 'success';
    if (
      ['originality_failed', 'failed', 'audit_failed', 'deleted'].includes(
        status,
      )
    ) {
      return 'failed';
    }
    return 'pending';
  }

  private prepareJpageArticle(article: Record<string, unknown>) {
    const metadata = this.recordValue(article.wechatData);
    if (metadata.channel !== 'wechat-official-account') {
      throw new BadRequestException(
        '只有 AgentWaker 公众号文章需要 JPage 草稿前预览',
      );
    }
    const markdown = this.requiredText(article.content, '公众号 Markdown');
    const html = this.requiredText(
      article.finalHtml || article.rawHtml,
      '公众号 HTML',
    );
    this.validateJpagePreviewContent(markdown, html);
    const markdownSha256 = createHash('sha256')
      .update(markdown, 'utf8')
      .digest('hex');
    const htmlSha256 = createHash('sha256').update(html, 'utf8').digest('hex');
    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          articleId: article.id,
          title: article.title,
          markdownSha256,
          htmlSha256,
        }),
      )
      .digest('hex');
    const stem = `wechat-${this.requiredText(article.id, '文章 ID')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80)}-${revision.slice(0, 12)}`;
    return {
      articleId: this.requiredText(article.id, '文章 ID'),
      markdown,
      html,
      markdownSha256,
      htmlSha256,
      revision,
      markdownName: `${stem}.md`,
      htmlName: `${stem}.html`,
    };
  }

  private prepareJpagePreview(
    article: Record<string, unknown>,
    account: Record<string, unknown>,
  ) {
    this.ensureJpageAccountReady(account);
    const prepared = this.prepareJpageArticle(article);
    const config = this.recordValue(account.config);
    const baseUrl = this.jpagePreviewClient.normalizeBaseUrl(
      this.requiredText(
        config.baseUrl || config.apiUrl || 'https://jpage.cn',
        'JPage 服务地址',
      ),
    );
    const token = this.requiredText(account.apiToken, 'JPage Token');
    const tags = this.normalizeJpageTags(
      config.tags || 'wechat-official-account,pre-draft-preview',
    );
    const targetFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          articleId: prepared.articleId,
          accountId: account.id,
          revision: prepared.revision,
          baseUrl,
          visibility: 'private',
          tags,
          markdownName: prepared.markdownName,
          htmlName: prepared.htmlName,
        }),
      )
      .digest('hex');
    return {
      ...prepared,
      accountId: this.requiredText(account.id, 'JPage 账号 ID'),
      baseUrl,
      token,
      tags,
      confirmationTarget: `jpage-private-preview:${prepared.articleId}:${targetFingerprint}`,
    };
  }

  private ensureJpageAccountReady(
    account: Record<string, unknown>,
  ): asserts account is Record<string, unknown> & {
    id: string;
    platform: 'jpage';
    status: 'ready';
    apiToken: string;
  } {
    if (
      account.platform !== 'jpage' ||
      account.status !== 'ready' ||
      !this.optionalText(account.apiToken)
    ) {
      throw new BadRequestException(
        '请选择状态正常且已配置 Token 的 JPage 私有预览授权',
      );
    }
  }

  private normalizeJpageTags(value: unknown) {
    const raw = Array.isArray(value)
      ? value
      : this.asAccountText(value).split(',') || [];
    const tags = Array.from(
      new Set(
        raw.map((item) => String(item).trim().slice(0, 48)).filter(Boolean),
      ),
    ).slice(0, 10);
    if (!tags.length) {
      throw new BadRequestException('JPage 私有预览至少需要一个审计标签');
    }
    return tags;
  }

  private validateJpagePreviewContent(markdown: string, html: string) {
    if (
      Buffer.byteLength(markdown, 'utf8') > 5 * 1024 * 1024 ||
      Buffer.byteLength(html, 'utf8') > 5 * 1024 * 1024
    ) {
      throw new BadRequestException('JPage 预览文件超过 5MB 安全限制');
    }
    const combined = `${markdown}\n${html}`;
    if (
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(combined) ||
      /\bjp_[A-Za-z0-9_-]{16,}\b/.test(combined) ||
      /\b(?:sk|ak)-[A-Za-z0-9_-]{20,}\b/.test(combined)
    ) {
      throw new BadRequestException('JPage 预览内容疑似包含密钥，已阻止上传');
    }
    if (
      /<script\b/i.test(html) ||
      /\son[a-z]+\s*=/i.test(html) ||
      /(?:src|href)\s*=\s*["'](?:file:|\.{1,2}\/|\/Users\/|[A-Za-z]:\\)/i.test(
        html,
      )
    ) {
      throw new BadRequestException(
        'JPage HTML 含脚本、事件属性或本地路径，已阻止上传',
      );
    }
  }

  private readJpagePreviewReceipt(
    wechatData: unknown,
  ): JpagePreviewReceipt | null {
    const metadata = this.recordValue(wechatData);
    const preview = this.recordValue(metadata.preview);
    const receipt = this.recordValue(preview.jpage);
    const markdown = this.recordValue(receipt.markdown);
    const html = this.recordValue(receipt.html);
    if (
      receipt.version !== 1 ||
      !['content_verified', 'verified'].includes(String(receipt.status)) ||
      receipt.visibility !== 'private' ||
      !Array.isArray(receipt.tags) ||
      !this.optionalText(receipt.articleId) ||
      !this.optionalText(receipt.accountId) ||
      !this.optionalText(receipt.revision) ||
      !this.optionalText(receipt.baseUrl) ||
      !this.optionalText(markdown.id) ||
      !this.optionalText(markdown.name) ||
      !this.optionalText(markdown.sha256) ||
      !this.optionalText(html.id) ||
      !this.optionalText(html.name) ||
      !this.optionalText(html.sha256)
    ) {
      return null;
    }
    return receipt as unknown as JpagePreviewReceipt;
  }

  private jpageReceiptMatches(
    prepared: ReturnType<PublishingService['prepareJpageArticle']>,
    receipt: JpagePreviewReceipt,
  ) {
    return (
      receipt.articleId === prepared.articleId &&
      receipt.revision === prepared.revision &&
      receipt.visibility === 'private' &&
      receipt.assetGate === 'pass' &&
      receipt.integratedRenderGate === 'pass' &&
      receipt.contentReadbackGate === 'pass' &&
      receipt.markdown.name === prepared.markdownName &&
      receipt.markdown.sha256 === prepared.markdownSha256 &&
      receipt.html.name === prepared.htmlName &&
      receipt.html.sha256 === prepared.htmlSha256
    );
  }

  private requireCurrentJpageReceipt(
    article: Record<string, unknown>,
    prepared: ReturnType<PublishingService['prepareJpageArticle']>,
  ) {
    const receipt = this.readJpagePreviewReceipt(article.wechatData);
    if (!receipt || !this.jpageReceiptMatches(prepared, receipt)) {
      throw new ForbiddenException(
        '当前文章版本尚未形成匹配的 JPage 私有 Markdown/HTML 预览对',
      );
    }
    return receipt;
  }

  private async persistJpagePreviewReceipt(
    article: Record<string, unknown>,
    receipt: JpagePreviewReceipt,
  ) {
    const metadata = this.recordValue(article.wechatData);
    const preview = this.recordValue(metadata.preview);
    await this.prisma.article.update({
      where: { id: this.requiredText(article.id, '文章 ID') },
      data: {
        wechatData: this.jsonValue({
          ...metadata,
          preview: {
            ...preview,
            visibility: 'jpage-private',
            assetGate: receipt.assetGate,
            integratedRenderGate: receipt.integratedRenderGate,
            remoteRenderGate: receipt.remoteRenderGate,
            jpage: receipt,
          },
        }),
      },
    });
  }

  private async verifyJpageReceiptForScope(
    receipt: JpagePreviewReceipt,
    scope: PublishingScope,
  ) {
    const account = this.decryptAccountCredentials(
      await this.findScopedAccount(receipt.accountId, scope),
    );
    await this.verifyJpageReceiptRemote(receipt, account);
  }

  private async verifyJpageReceiptRemote(
    receipt: JpagePreviewReceipt,
    account: Record<string, unknown>,
  ) {
    this.ensureJpageAccountReady(account);
    const config = this.recordValue(account.config);
    const baseUrl = this.jpagePreviewClient.normalizeBaseUrl(
      this.requiredText(
        config.baseUrl || config.apiUrl || 'https://jpage.cn',
        'JPage 服务地址',
      ),
    );
    if (baseUrl !== receipt.baseUrl || account.id !== receipt.accountId) {
      throw new ForbiddenException('JPage 预览授权或服务地址已变化');
    }
    const token = this.requiredText(account.apiToken, 'JPage Token');
    const [markdown, html] = await Promise.all([
      this.jpagePreviewClient.verifyPrivateFile(
        { baseUrl, token },
        receipt.markdown.id,
        receipt.markdown.name,
        receipt.markdown.sha256,
      ),
      this.jpagePreviewClient.verifyPrivateFile(
        { baseUrl, token },
        receipt.html.id,
        receipt.html.name,
        receipt.html.sha256,
      ),
    ]);
    if (
      receipt.tags.some(
        (tag) => !markdown.tags.includes(tag) || !html.tags.includes(tag),
      )
    ) {
      throw new ForbiddenException('JPage 私有预览标签已变化');
    }
  }

  private async ensureJpagePreviewVerified(
    article: Record<string, unknown>,
    scope: PublishingScope,
  ) {
    const metadata = this.recordValue(article.wechatData);
    if (metadata.channel !== 'wechat-official-account') return;
    const prepared = this.prepareJpageArticle(article);
    const receipt = this.requireCurrentJpageReceipt(article, prepared);
    if (receipt.status !== 'verified' || receipt.remoteRenderGate !== 'pass') {
      throw new ForbiddenException(
        'JPage 私有预览尚未完成远程移动端渲染确认，不能写入公众号草稿',
      );
    }
    await this.verifyJpageReceiptForScope(receipt, scope);
  }

  private jpageRenderConfirmationTarget(
    receipt: JpagePreviewReceipt,
    scope: PublishingScope,
  ) {
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: scope.tenantId,
          userId: scope.userId,
          articleId: receipt.articleId,
          accountId: receipt.accountId,
          revision: receipt.revision,
          markdownId: receipt.markdown.id,
          htmlId: receipt.html.id,
          visibility: receipt.visibility,
        }),
      )
      .digest('hex');
    return `jpage-private-preview-render:${receipt.articleId}:${fingerprint}`;
  }

  private async ensureAgentWakerWechatApproved(
    article: Record<string, unknown>,
    scope: PublishingScope,
  ) {
    const metadata = this.recordValue(article.wechatData);
    if (metadata.channel !== 'wechat-official-account') return;
    const sessions = await this.prisma.agentSession.findMany({
      where: {
        tenantId: scope.tenantId,
        userId: scope.userId,
        status: 'completed',
        scope: { startsWith: 'agentwaker:wechat-official-account-operator:' },
      },
      select: { sessionJson: true },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const approved = sessions.some((row) => {
      const session = this.recordValue(row.sessionJson);
      const sessionMetadata = this.recordValue(session.metadata);
      return sessionMetadata.articleId === article.id;
    });
    if (!approved) {
      throw new ForbiddenException(
        'AgentWaker 公众号文章尚未通过内容审批，不能写入平台草稿或正式发布。',
      );
    }
  }

  private serializePublishRecordMetadata(metadata: PublishRecordMetadata) {
    return `${PUBLISH_RECORD_METADATA_PREFIX}${JSON.stringify(metadata)}`;
  }

  private parsePublishRecordMetadata(value: string | null) {
    if (!value?.startsWith(PUBLISH_RECORD_METADATA_PREFIX)) return null;
    try {
      const parsed = JSON.parse(
        value.slice(PUBLISH_RECORD_METADATA_PREFIX.length),
      ) as PublishRecordMetadata;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }
}
