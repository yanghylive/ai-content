import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeText } from '../../common/text.utils';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { resolveProjectDataPath } from '../../common/project-paths';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalEngineService } from '../local-engine/local-engine.service';
import type {
  AgentSession,
  AgentExecutionScope,
  ArchiveAgentSessionInput,
  CreateAgentSessionInput,
  LocalEngineExecutorsStatus,
  LocalEngineExecutorCapability,
  LocalEngineReadiness,
} from '../local-engine/local-engine.types';
import {
  AI_EMPLOYEE_CAPABILITIES,
  buildAiEmployeeExecutorTask,
  type AiEmployeeCapabilityContract,
} from '../runtime/ai-employee/ai-employee.contract';
import type {
  ExecutorContext,
  ExecutorTask,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {
  CrmService,
  type CrmAutoAcquisitionCaptureResult,
} from '../crm/crm.service';
import { VideoWorkshopService } from '../video-workshop/video-workshop.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { evaluateRuntimeCompletion } from './ai-employee-execution-evidence';
import { AiEmployeeWorkflowService } from './ai-employee-workflow.service';
import type {
  AiEmployeeWorkflowCapabilityInput,
  AiEmployeeWorkflowConfirmationMetadata,
  AiEmployeeWorkflowPreparationInput,
  AiEmployeeWorkflowPreparationResult,
  AiEmployeeWorkflowRetryInput,
} from './ai-employee-workflow.types';

export type {
  AiEmployeeWorkflowPreparationInput,
  AiEmployeeWorkflowPreparationResult,
  AiEmployeeWorkflowRetryInput,
} from './ai-employee-workflow.types';

const AI_EMPLOYEE_METADATA_FLAG = 'kaypal-ai-employee';
const AUTO_ACQUISITION_STORE_VERSION = 2;
const LEGACY_AUTO_ACQUISITION_TENANT = 'legacy-local-desktop';
const LEGACY_AUTO_ACQUISITION_USER = 'legacy-local-user';
const AUTO_ACQUISITION_DEFAULT_COMMENT_REPLIES = [
  '我这边刚好有相关案例，可以交流一下。',
  '这个问题我们服务过不少客户，可以发你一份参考。',
];
const AUTO_ACQUISITION_DEFAULT_APPEND_REPLIES = [
  '已关注，方便的话可以交流一下。',
];
const AUTO_ACQUISITION_DEFAULT_KEYWORDS = '装修, 家装, 设计, 建材, 门店';
const AUTO_ACQUISITION_SCHEDULER_MS = 30_000;
const DEFAULT_KAYPAL_AUTH_BASE_URL = 'https://test.kaypal.cn';

export type AiEmployeeCapabilityStatus =
  | 'real'
  | 'simulated'
  | 'needs_config'
  | 'unavailable';

export type AiEmployeeCapabilityRiskLevel = 'low' | 'medium' | 'high';

export interface AiEmployeeCapabilityView {
  key: string;
  domain: string;
  title: string;
  platform: string;
  runtimePath: string;
  routeableNow: boolean;
  executorTaskType?: string;
  status: AiEmployeeCapabilityStatus;
  riskLevel: AiEmployeeCapabilityRiskLevel;
  executionMode: 'real' | 'simulated' | 'configuration' | 'blocked';
  message: string;
  nextAction: string;
  acceptance: string[];
  blockers: string[];
  executor?: {
    key: string;
    name: string;
    status: string;
    message: string;
    nextAction: string;
  };
}

export interface AiEmployeeCapabilitiesSnapshot {
  checkedAt: string;
  summary: {
    total: number;
    real: number;
    simulated: number;
    needsConfig: number;
    unavailable: number;
    localEngineReady: boolean;
  };
  readiness?: {
    ready: boolean;
    blockers: number;
    warnings: number;
    nextAction: string;
  };
  capabilities: AiEmployeeCapabilityView[];
}

export type AiEmployeeCoreTaskType =
  | 'workflow.auto'
  | 'exposure.auto'
  | 'exposure.targeted'
  | 'exposure.link'
  | 'exposure.search_account'
  | 'exposure.retention'
  | 'ai_service.config_test'
  | 'publish.multi_platform'
  | 'video.template_clip';

export interface AiEmployeeDryRunTaskInput {
  type?: AiEmployeeCoreTaskType;
  title?: string;
  instruction?: string;
  accountId?: string;
  payload?: Record<string, unknown>;
}

export interface AiEmployeeDryRunTaskResult {
  taskType: AiEmployeeCoreTaskType;
  executionMode: 'simulated';
  displayStatus: 'waiting_confirmation';
  capabilityKey?: string;
  nextAction?: string;
  session: AgentSession;
}

export interface DouyinLinkLeadInput {
  accountId?: string;
  link?: string;
  limit?: number;
  commentTimeMatch?: string;
}

export interface DouyinSearchLeadInput {
  accountId?: string;
  keyword?: string;
  limit?: number;
  commentTimeMatch?: string;
  nicknameKeywords?: string[];
  blacklistNicknames?: string[];
  enterpriseOnly?: boolean;
}

export interface DouyinHotVideoLeadInput {
  accountId?: string;
  keyword?: string;
  limit?: number;
  commentTimeMatch?: string;
  blacklistNicknames?: string[];
}

export interface DouyinTargetedLeadInput {
  accountId?: string;
  targetAccounts?: string[];
  keyword?: string;
  limit?: number;
  commentTimeMatch?: string;
  perTargetLimit?: number;
}

export interface DouyinRetentionLeadInput {
  accountId?: string;
  retentionSourceId?: string;
  keyword?: string;
  limit?: number;
  commentTimeMatch?: string;
}

export interface DouyinFollowUpCandidateInput {
  text?: string;
  sourceUrl?: string;
  kind?: string;
  commentMode?: 'reply' | 'video-comment';
  index?: number;
  targetName?: string;
  profileUrl?: string;
  commentTime?: string;
  videoTitle?: string;
  videoUrl?: string;
  engagementScore?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  score?: number;
  reason?: string;
}

type DouyinFollowUpAction = 'comment' | 'message';

export type DouyinExposureCapabilityKey =
  | 'douyin-link-exposure'
  | 'douyin-search-account-exposure'
  | 'douyin-hot-video-exposure'
  | 'douyin-targeted-exposure'
  | 'douyin-retention-exposure';

export interface DouyinFollowUpPlanInput {
  candidates?: DouyinFollowUpCandidateInput[];
  sourceLabel?: string;
  sourceText?: string;
  accountName?: string;
  privateMessage?: string;
  commentTemplates?: string[];
  messageTemplates?: string[];
  dailyLimit?: number;
  maxTargets?: number;
  includeKeywords?: string[];
  blacklistKeywords?: string[];
  minScore?: number;
  maxActionsPerTarget?: number;
}

export interface DouyinFollowUpExecuteInput {
  accountId?: string;
  targets?: Array<
    DouyinFollowUpCandidateInput & {
      sourceText?: string;
      commentReplyText?: string;
      directMessageText?: string;
      commentTaskEnabled?: boolean;
      messageTaskEnabled?: boolean;
      commentMode?: 'reply' | 'video-comment';
      followUpActions?: DouyinFollowUpAction[];
    }
  >;
  maxTargets?: number;
  autoSend?: boolean;
  sourceCapability?: DouyinExposureCapabilityKey;
}

export interface VideoTemplateClipInput {
  materialPath?: string;
  templateName?: string;
  titlePrompt?: string;
  outputName?: string;
  outputDir?: string;
}

export type AutoAcquisitionConfigStatus = 'enabled' | 'disabled' | 'running';

type AutoAcquisitionScope = {
  tenantId: string;
  userId: string;
};

export interface AutoAcquisitionConfigInput {
  id?: string;
  taskName?: string;
  accountId?: string;
  account?: string;
  commentMode?: 'reply' | 'video-comment';
  searchKeywords?: string;
  keywords?: string;
  contents?: string;
  blacklistNicknames?: string;
  enterpriseOnly?: boolean;
  appendCommentEnabled?: boolean;
  appendComments?: string;
  dailyLimit?: number;
  exposureCount?: number;
  deduplicate?: boolean;
  beginTime?: string;
  enabled?: boolean;
  status?: AutoAcquisitionConfigStatus;
}

export interface AutoAcquisitionConfig {
  tenantId: string;
  userId: string;
  id: string;
  taskName: string;
  accountId: string;
  account: string;
  socialPlatform: '抖音';
  reason: string;
  commentMode: 'reply' | 'video-comment';
  searchKeywords: string;
  keywords: string;
  contents: string;
  blacklistNicknames: string;
  enterpriseOnly: boolean;
  appendCommentEnabled: boolean;
  appendComments: string;
  dailyLimit: number;
  exposureCount: number;
  exposureDate: string;
  deduplicate: boolean;
  beginTime: string;
  createdTime: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastScheduledRunDate?: string;
  status: AutoAcquisitionConfigStatus;
}

export interface AutoAcquisitionExecutionResultRecord {
  index: number;
  targetName?: string;
  targetText?: string;
  replyText?: string;
  ok: boolean;
  status: string;
  message: string;
  evidenceUrl?: string;
}

export interface AutoAcquisitionBillingRecord {
  status: 'charged' | 'skipped';
  amount: number;
  reservationId?: string;
  transactionId?: string;
  balanceAfter?: number;
  policyVersion?: string;
  idempotencyKey?: string;
  message?: string;
}

interface KaypalBillingIdentity {
  userId: string;
  token: string;
}

interface KaypalExternalDataBillingIdentity {
  userId: string;
  headers: Record<string, string>;
  authSource: 'desktop-token' | 'server-api-key';
}

export interface AutoAcquisitionRecord {
  tenantId: string;
  userId: string;
  id: string;
  configId: string;
  taskName: string;
  createdTime: string;
  createdAt: string;
  trigger: 'manual' | 'schedule';
  status: string;
  message: string;
  keyword: string;
  candidateCount: number;
  selectedCount: number;
  videoCount?: number;
  evidenceUrl?: string;
  targets?: Array<
    DouyinFollowUpCandidateInput & {
      sourceText?: string;
      followUpActions?: DouyinFollowUpAction[];
      commentTaskEnabled?: boolean;
      messageTaskEnabled?: boolean;
      directMessageBlockedReason?: string;
      commentReplyText?: string;
      directMessageText?: string;
    }
  >;
  executionResults?: AutoAcquisitionExecutionResultRecord[];
  executionSummary?: {
    attemptedCount: number;
    successCount: number;
    failedCount: number;
    message: string;
  };
  crmCapture?: CrmAutoAcquisitionCaptureResult;
  billing?: AutoAcquisitionBillingRecord;
}

interface AutoAcquisitionStore {
  version: number;
  configs: AutoAcquisitionConfig[];
  records: AutoAcquisitionRecord[];
  dedupe: Record<string, string[]>;
}

export interface P1ClosureReadinessInput {
  douyinAccountId?: string;
  douyinAccountName?: string;
  mode?: string;
  sourceText?: string;
  candidateCount?: number;
  followUpTaskCount?: number;
  followUpFailedCount?: number;
  followUpCompletedCount?: number;
  followUpEvidenceCount?: number;
  evidenceCount?: number;
  commentTemplateCount?: number;
  messageTemplateCount?: number;
  dailyLimit?: number;
  privateMessage?: string;
  publishAccountCount?: number;
  publishMaterialPath?: string;
  publishTitle?: string;
  publishCopy?: string;
  publishDailyLimit?: number;
  publishDailyTimes?: string[];
  publishPreflightOk?: boolean;
  publishPreflightSummary?: string;
  publishResultCount?: number;
  publishFailedCount?: number;
  publishSuccessCount?: number;
  publishPendingCount?: number;
}

export interface P2WechatReadinessInput {
  desktopOnline?: boolean;
  agentConnected?: boolean;
  sessionReadable?: boolean;
  sessionConfirmed?: boolean;
  contactName?: string;
  latestMessageCount?: number;
  replyText?: string;
  replyTaskCount?: number;
  replyCompletedCount?: number;
  groupTargetCount?: number;
  groupTagCount?: number;
  groupDailyLimit?: number;
  groupIntervalSeconds?: number;
  groupMessage?: string;
  groupTaskCount?: number;
  groupPausedCount?: number;
  groupResumableCount?: number;
  groupCompletedCount?: number;
  groupFailedCount?: number;
  contactTaskCount?: number;
  contactCompletedCount?: number;
  contactTargetCount?: number;
  contactDailyLimit?: number;
  contactFailedCount?: number;
  momentsPublishTaskCount?: number;
  momentsPublishCompletedCount?: number;
  momentsPublishFailedCount?: number;
  momentsPublishRemainingCount?: number;
  momentsContent?: string;
  momentsAssetPath?: string;
  momentsDailyCount?: number;
  momentsMarketingTaskCount?: number;
  momentsMarketingCompletedCount?: number;
  momentsMarketingFailedCount?: number;
  momentsMarketingRemainingCount?: number;
  momentsMarketingDailyLimit?: number;
  momentsMarketingMode?: string;
  videoClipTaskCount?: number;
  videoClipCompletedCount?: number;
  videoClipFailedCount?: number;
  videoMaterialPath?: string;
  videoTemplateName?: string;
  videoOutputPath?: string;
  publishAccountCount?: number;
  publishMaterialPath?: string;
  publishTitle?: string;
  publishCopy?: string;
  publishDailyLimit?: number;
  publishDailyTimes?: string[];
  publishPreflightOk?: boolean;
  publishResultCount?: number;
  publishFailedCount?: number;
  publishSuccessCount?: number;
  publishPendingCount?: number;
  evidenceCount?: number;
}

@Injectable()
export class AiEmployeeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiEmployeeService.name);
  private autoAcquisitionScheduler?: NodeJS.Timeout;
  private autoAcquisitionSchedulerRunning = false;
  private readonly autoAcquisitionRunningIds = new Set<string>();
  private autoAcquisitionStoreReady?: Promise<AutoAcquisitionStore>;
  private fallbackWorkflowService?: AiEmployeeWorkflowService;

  constructor(
    private readonly runtime: RuntimeOrchestrator,
    private readonly localEngine: LocalEngineService,
    @Optional()
    private readonly videoWorkshop?: VideoWorkshopService,
    @Optional()
    private readonly crmService?: CrmService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly config?: ConfigService,
    @Optional()
    private readonly autoUploadService?: AutoUploadService,
    @Optional()
    private readonly workflowService?: AiEmployeeWorkflowService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  onModuleInit() {
    if (!this.isAutoAcquisitionSchedulerArmed()) {
      if (process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER === 'true') {
        this.logger.warn(
          'AI employee auto acquisition scheduler is configured but not armed. Set GROWTH_EXECUTION_ENABLED=true and GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true to allow unattended real execution.',
        );
      }
      return;
    }
    this.autoAcquisitionScheduler = setInterval(() => {
      void this.runAutoAcquisitionScheduler('interval');
    }, AUTO_ACQUISITION_SCHEDULER_MS);
    this.autoAcquisitionScheduler.unref?.();
    void this.recoverInterruptedAutoAcquisitionRuns()
      .catch((error) => {
        this.logger.warn(
          `Auto acquisition recovery failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => void this.runAutoAcquisitionScheduler('startup'));
  }

  onModuleDestroy() {
    if (this.autoAcquisitionScheduler) {
      clearInterval(this.autoAcquisitionScheduler);
      this.autoAcquisitionScheduler = undefined;
    }
  }

  async listAutoAcquisition() {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    return {
      configs: store.configs
        .filter((config) => this.inAutoAcquisitionScope(config, scope))
        .map((config) => this.normalizeAutoAcquisitionConfigForToday(config)),
      records: store.records
        .filter((record) => this.inAutoAcquisitionScope(record, scope))
        .slice(0, 100),
      scheduler: {
        configured:
          process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER === 'true',
        enabled: this.isAutoAcquisitionSchedulerArmed(),
        armed: this.isAutoAcquisitionSchedulerArmed(),
        tickMs: AUTO_ACQUISITION_SCHEDULER_MS,
      },
    };
  }

  async getCapabilities(): Promise<AiEmployeeCapabilitiesSnapshot> {
    const checkedAt = new Date().toISOString();
    const { readiness, capabilities } = await this.loadCapabilityContext();

    return {
      checkedAt,
      summary: {
        total: capabilities.length,
        real: capabilities.filter((item) => item.status === 'real').length,
        simulated: capabilities.filter((item) => item.status === 'simulated')
          .length,
        needsConfig: capabilities.filter(
          (item) => item.status === 'needs_config',
        ).length,
        unavailable: capabilities.filter(
          (item) => item.status === 'unavailable',
        ).length,
        localEngineReady: readiness?.ready ?? false,
      },
      readiness: readiness
        ? this.toCapabilityReadinessSummary(readiness)
        : undefined,
      capabilities,
    };
  }

  async createDryRunTask(
    input: AiEmployeeDryRunTaskInput,
  ): Promise<AiEmployeeDryRunTaskResult> {
    const taskType = this.normalizeCoreTaskType(input.type);
    const mapping = this.getCoreTaskMapping(taskType);
    const title =
      this.readOptionalText(input.title) || `${mapping.title}预演任务`;
    const instruction =
      this.readOptionalText(input.instruction) ||
      this.buildCoreDryRunInstruction(taskType, mapping.title);
    const payload =
      input.payload &&
      typeof input.payload === 'object' &&
      !Array.isArray(input.payload)
        ? input.payload
        : {};
    const session = await this.createSession({
      title,
      instruction,
      dryRun: true,
      executionScope: mapping.executionScope,
      targetApp: mapping.targetApp,
      metadata: {
        coreTaskType: taskType,
        capabilityKey: mapping.capabilityKey,
        accountId: this.readOptionalText(input.accountId),
        payload,
        executionMode: 'simulated',
        createdFrom: 'core-dry-run',
      },
    });
    return {
      taskType,
      executionMode: 'simulated',
      displayStatus: 'waiting_confirmation',
      capabilityKey: mapping.capabilityKey,
      nextAction: session.nextAction,
      session,
    };
  }

  async prepareWorkflow(
    input: AiEmployeeWorkflowPreparationInput,
  ): Promise<AiEmployeeWorkflowPreparationResult> {
    const context = await this.loadCapabilityContext();
    return this.getWorkflowService().prepareWorkflow(
      input,
      this.toWorkflowCapabilities(
        context.capabilities,
        context.executorsStatus,
      ),
    );
  }

  listWorkflows(limit?: number) {
    return this.getWorkflowService().listWorkflowSnapshot(limit);
  }

  getWorkflowDefinition(id: string) {
    return this.getWorkflowService().getWorkflowDefinition(id);
  }

  getWorkflowRun(id: string) {
    return this.getWorkflowService().getWorkflowRun(id);
  }

  async refreshWorkflowDefinition(id: string) {
    const context = await this.loadCapabilityContext();
    return this.getWorkflowService().refreshWorkflowDefinition(
      id,
      this.toWorkflowCapabilities(
        context.capabilities,
        context.executorsStatus,
      ),
    );
  }

  async getWorkflowRunDefinition(runId: string) {
    const run = await this.getWorkflowService().getWorkflowRun(runId);
    return this.refreshWorkflowDefinition(run.workflowId);
  }

  async startWorkflowRun(
    id: string,
    options: {
      externalActionsAuthorized: boolean;
      confirmation: AiEmployeeWorkflowConfirmationMetadata;
    },
  ) {
    const context = await this.loadCapabilityContext();
    return this.getWorkflowService().startWorkflowRun(
      id,
      this.toWorkflowCapabilities(
        context.capabilities,
        context.executorsStatus,
      ),
      options,
    );
  }

  async retryWorkflowRun(
    id: string,
    input: AiEmployeeWorkflowRetryInput,
    options: {
      externalActionsAuthorized: boolean;
      confirmation: AiEmployeeWorkflowConfirmationMetadata;
    },
  ) {
    const context = await this.loadCapabilityContext();
    return this.getWorkflowService().retryWorkflowRun(
      id,
      input,
      this.toWorkflowCapabilities(
        context.capabilities,
        context.executorsStatus,
      ),
      options,
    );
  }

  cancelWorkflowRun(id: string) {
    return this.getWorkflowService().cancelWorkflowRun(id);
  }

  async createAutoAcquisitionConfig(input: AutoAcquisitionConfigInput) {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    const requestedId = this.readOptionalText(input.id);
    const collidesWithAnotherScope = requestedId
      ? store.configs.some(
          (item) =>
            item.id === requestedId &&
            !this.inAutoAcquisitionScope(item, scope),
        )
      : false;
    const existingInScope = requestedId
      ? store.configs.find(
          (item) =>
            item.id === requestedId && this.inAutoAcquisitionScope(item, scope),
        )
      : undefined;
    if (existingInScope) {
      this.assertAutoAcquisitionConfigNotRunning(existingInScope);
      throw new BadRequestException('自动获客配置已存在，请使用更新接口');
    }
    const config = this.normalizeAutoAcquisitionConfigInput(
      collidesWithAnotherScope ? { ...input, id: undefined } : input,
      undefined,
      scope,
    );
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: [
        config,
        ...store.configs.filter(
          (item) =>
            item.id !== config.id || !this.inAutoAcquisitionScope(item, scope),
        ),
      ],
    });
    return config;
  }

  async getAutoAcquisitionConfig(id: string) {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    const config = store.configs.find(
      (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
    );
    if (!config) {
      throw new BadRequestException('自动获客配置不存在');
    }
    return this.normalizeAutoAcquisitionConfigForToday(config);
  }

  async updateAutoAcquisitionConfig(
    id: string,
    input: AutoAcquisitionConfigInput,
  ) {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    const existing = store.configs.find(
      (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
    );
    if (!existing) {
      throw new BadRequestException('自动获客配置不存在');
    }
    this.assertAutoAcquisitionConfigNotRunning(existing);
    const config = this.normalizeAutoAcquisitionConfigInput(
      { ...input, id },
      existing,
      scope,
    );
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.map((item) =>
        item.id === id && this.inAutoAcquisitionScope(item, scope)
          ? config
          : item,
      ),
    });
    return config;
  }

  async deleteAutoAcquisitionConfig(id: string) {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    const existing = store.configs.find(
      (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
    );
    if (!existing) {
      throw new BadRequestException('自动获客配置不存在');
    }
    this.assertAutoAcquisitionConfigNotRunning(existing);
    const storeKey = this.autoAcquisitionConfigKey(existing);
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.filter(
        (item) => item.id !== id || !this.inAutoAcquisitionScope(item, scope),
      ),
      dedupe: Object.fromEntries(
        Object.entries(store.dedupe).filter(
          ([configKey]) => configKey !== storeKey,
        ),
      ),
    });
    return { ok: true };
  }

  async updateAutoAcquisitionConfigStatus(
    id: string,
    input: { enabled?: boolean },
  ) {
    const store = await this.loadAutoAcquisitionStore();
    const scope = await this.resolveAutoAcquisitionScope();
    const existing = store.configs.find(
      (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
    );
    if (!existing) {
      throw new BadRequestException('自动获客配置不存在');
    }
    this.assertAutoAcquisitionConfigNotRunning(existing);
    const today = this.dateKey();
    const next = {
      ...this.normalizeAutoAcquisitionConfigForToday(existing, today),
      status: input.enabled === false ? 'disabled' : 'enabled',
      reason: input.enabled === false ? '手动停用' : '无',
      updatedAt: this.nextAutoAcquisitionUpdatedAt(existing.updatedAt),
    } satisfies AutoAcquisitionConfig;
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.map((item) =>
        item.id === id && this.inAutoAcquisitionScope(item, scope)
          ? next
          : item,
      ),
    });
    return next;
  }

  async executeAutoAcquisitionConfig(
    id: string,
    trigger: 'manual' | 'schedule' = 'manual',
    expectedUpdatedAt?: string,
  ) {
    this.assertAutoAcquisitionExecutionEnabled(trigger);
    const scope = await this.resolveAutoAcquisitionScope();
    return this.executeAutoAcquisitionConfigById(
      id,
      trigger,
      scope,
      expectedUpdatedAt,
    );
  }

  private async runAutoAcquisitionScheduler(source: 'startup' | 'interval') {
    if (!this.isAutoAcquisitionSchedulerArmed()) return;
    if (this.autoAcquisitionSchedulerRunning) return;
    this.autoAcquisitionSchedulerRunning = true;
    try {
      const store = await this.loadAutoAcquisitionStore();
      const now = new Date();
      const today = this.dateKey(now);
      const dueConfigs = store.configs
        .map((config) =>
          this.normalizeAutoAcquisitionConfigForToday(config, today),
        )
        .filter((config) =>
          this.isAutoAcquisitionConfigDue(config, now, today),
        );

      for (const config of dueConfigs) {
        try {
          await this.executeAutoAcquisitionConfigById(config.id, 'schedule', {
            tenantId: config.tenantId,
            userId: config.userId,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Auto acquisition scheduled run failed (${source}, ${config.id}): ${message}`,
          );
        }
      }
    } finally {
      this.autoAcquisitionSchedulerRunning = false;
    }
  }

  private async executeAutoAcquisitionConfigById(
    id: string,
    trigger: 'manual' | 'schedule',
    scope: AutoAcquisitionScope,
    expectedUpdatedAt?: string,
  ) {
    this.assertAutoAcquisitionExecutionEnabled(trigger);
    const runningKey = this.autoAcquisitionConfigKey({ ...scope, id });
    if (this.autoAcquisitionRunningIds.has(runningKey)) {
      throw new BadRequestException('这条自动获客配置正在执行');
    }
    this.autoAcquisitionRunningIds.add(runningKey);
    const today = this.dateKey();
    let runningRecord: AutoAcquisitionRecord | undefined;
    let billingReservation: AutoAcquisitionBillingRecord | undefined;
    try {
      let store = await this.loadAutoAcquisitionStore();
      const existing = store.configs.find(
        (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
      );
      if (!existing) {
        throw new BadRequestException('自动获客配置不存在');
      }
      if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
        throw new BadRequestException('自动获客配置已更新，请重新确认后执行');
      }
      const config = this.normalizeAutoAcquisitionConfigForToday(
        existing,
        today,
      );
      if (config.status === 'disabled') {
        throw new BadRequestException('这条自动获客配置已停用');
      }
      if (config.exposureCount >= config.dailyLimit) {
        const record = this.buildAutoAcquisitionSkippedRecord(
          config,
          trigger,
          '当天已曝光次数达到上限',
        );
        await this.appendAutoAcquisitionRecord(record, {
          ...config,
          status: 'enabled',
          reason: record.message,
          lastRunAt: new Date().toISOString(),
          lastScheduledRunDate:
            trigger === 'schedule' ? today : config.lastScheduledRunDate,
        });
        return {
          config: {
            ...config,
            reason: record.message,
            lastRunAt: record.createdAt,
            lastScheduledRunDate:
              trigger === 'schedule' ? today : config.lastScheduledRunDate,
          },
          record,
        };
      }

      const accountBlocker =
        await this.getAutoAcquisitionAccountBlocker(config);
      if (accountBlocker) {
        const record = this.buildAutoAcquisitionSkippedRecord(
          config,
          trigger,
          accountBlocker,
        );
        const blockedConfig: AutoAcquisitionConfig = {
          ...config,
          status: 'enabled',
          reason: record.message,
          lastRunAt: record.createdAt,
          lastScheduledRunDate:
            trigger === 'schedule' ? today : config.lastScheduledRunDate,
          updatedAt: new Date().toISOString(),
        };
        await this.appendAutoAcquisitionRecord(record, blockedConfig);
        return { config: blockedConfig, record };
      }

      const runningConfig: AutoAcquisitionConfig = {
        ...config,
        status: 'running',
        reason: trigger === 'schedule' ? '后台定时执行中' : '执行中',
        lastRunAt: new Date().toISOString(),
        lastScheduledRunDate:
          trigger === 'schedule' ? today : config.lastScheduledRunDate,
        updatedAt: new Date().toISOString(),
      };
      store = await this.replaceAutoAcquisitionConfig(runningConfig);
      runningRecord = this.buildAutoAcquisitionRunningRecord(
        runningConfig,
        trigger,
      );
      await this.appendAutoAcquisitionRecord(runningRecord, runningConfig);
      billingReservation = await this.reserveAutoAcquisitionCredits(
        runningConfig,
        runningRecord,
      );

      const { record, successIncrement, dedupeKeys } =
        await this.runAutoAcquisitionPipeline(runningConfig, store, trigger);
      let completedRecord: AutoAcquisitionRecord = {
        ...record,
        id: runningRecord.id,
        createdAt: runningRecord.createdAt,
        createdTime: runningRecord.createdTime,
      };
      const currentStore = await this.loadAutoAcquisitionStore();
      const currentConfig =
        currentStore.configs.find(
          (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
        ) || runningConfig;
      const completedConfig: AutoAcquisitionConfig = {
        ...this.normalizeAutoAcquisitionConfigForToday(currentConfig, today),
        status: 'enabled',
        reason:
          completedRecord.status === 'success' ||
          completedRecord.status === 'partial'
            ? '无'
            : completedRecord.message,
        exposureCount: Math.min(
          currentConfig.dailyLimit,
          currentConfig.exposureCount + successIncrement,
        ),
        lastRunAt: completedRecord.createdAt,
        lastScheduledRunDate:
          trigger === 'schedule' ? today : currentConfig.lastScheduledRunDate,
        updatedAt: new Date().toISOString(),
      };
      const crmCapture = await this.captureAutoAcquisitionLeads(
        completedConfig,
        completedRecord,
      );
      if (crmCapture) {
        completedRecord = {
          ...completedRecord,
          crmCapture,
        };
      }
      const billing = await this.captureAutoAcquisitionCredits(
        billingReservation,
        completedConfig,
        completedRecord,
      );
      completedRecord = {
        ...completedRecord,
        billing,
      };
      await this.saveAutoAcquisitionStore({
        ...currentStore,
        configs: currentStore.configs.map((item) =>
          item.id === id && this.inAutoAcquisitionScope(item, scope)
            ? completedConfig
            : item,
        ),
        records: this.upsertAutoAcquisitionRecord(
          currentStore.records,
          completedRecord,
        ),
        dedupe:
          dedupeKeys && successIncrement > 0
            ? {
                ...currentStore.dedupe,
                [this.autoAcquisitionConfigKey(completedConfig)]: dedupeKeys,
              }
            : currentStore.dedupe,
      });
      return { config: completedConfig, record: completedRecord };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (billingReservation?.reservationId) {
        await this.releaseAutoAcquisitionCredits(
          billingReservation,
          `自动获客执行失败：${message}`,
        ).catch((releaseError) => {
          const releaseMessage =
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError);
          this.logger.warn(
            `Auto acquisition billing reservation release failed: ${releaseMessage}`,
          );
        });
      }
      await this.markAutoAcquisitionConfigFailed(
        id,
        message,
        trigger,
        today,
        runningRecord,
        scope,
      );
      throw error;
    } finally {
      this.autoAcquisitionRunningIds.delete(runningKey);
    }
  }

  private async getAutoAcquisitionAccountBlocker(
    config: AutoAcquisitionConfig,
  ): Promise<string | undefined> {
    if (!this.autoUploadService) return undefined;
    try {
      const accounts = await this.autoUploadService.listAccounts({
        validate: true,
        force: true,
        ids: [config.accountId],
      });
      const account = accounts.find(
        (item) =>
          item.type === 3 && String(item.id) === String(config.accountId),
      );
      if (!account) {
        return `未找到抖音账号 ${config.accountId}，已阻止自动获客执行；请到发布中心-平台账号重新登录抖音账号后再执行。`;
      }
      const sessionReady =
        !account.sessionStatus || account.sessionStatus === 'logged_in';
      const dispatchReady = account.lastDispatchOk !== false;
      if (account.status !== 1 || !sessionReady || !dispatchReady) {
        const reason =
          account.statusLabel ||
          account.lastDispatchReason ||
          account.sessionStatus ||
          '账号未登录或登录态不可用';
        return `抖音账号 ${account.profileName || account.userName || account.id} 当前${reason}，已阻止自动获客执行；请到发布中心-平台账号重新登录后再执行。`;
      }
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `无法读取抖音账号登录状态，已阻止自动获客执行；请确认本机助手和发布中心账号页可用后重试。原因：${message}`;
    }
  }

  private assertAutoAcquisitionExecutionEnabled(
    trigger: 'manual' | 'schedule',
  ) {
    if (process.env.GROWTH_EXECUTION_ENABLED !== 'true') {
      throw new BadRequestException(
        '真实触达总开关未开启，历史自动获客不会执行外部评论或私信。',
      );
    }
    if (trigger === 'schedule' && !this.isAutoAcquisitionSchedulerArmed()) {
      throw new BadRequestException(
        '历史自动获客定时器未武装，不允许后台无人值守真实触达。',
      );
    }
  }

  private isAutoAcquisitionSchedulerArmed() {
    return (
      process.env.GROWTH_EXECUTION_ENABLED === 'true' &&
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER === 'true' &&
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED === 'true'
    );
  }

  private async captureAutoAcquisitionLeads(
    config: AutoAcquisitionConfig,
    record: AutoAcquisitionRecord,
  ): Promise<CrmAutoAcquisitionCaptureResult | undefined> {
    if (!this.crmService) return undefined;
    try {
      return await this.crmService.captureAutoAcquisitionLeads(config.userId, {
        configId: config.id,
        recordId: record.id,
        taskName: config.taskName,
        trigger: record.trigger,
        keyword: record.keyword,
        accountId: config.accountId,
        accountName: config.account,
        status: record.status,
        message: record.message,
        evidenceUrl: record.evidenceUrl,
        targets: record.targets,
        executionResults: record.executionResults,
        createdAt: record.createdAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto acquisition CRM capture failed: ${message}`);
      return {
        enabled: false,
        capturedCount: 0,
        skippedCount: record.executionSummary?.successCount || 0,
        message: `CRM 沉淀失败：${message}`,
        capturedCustomers: [],
      };
    }
  }

  private async reserveAutoAcquisitionCredits(
    config: AutoAcquisitionConfig,
    record: AutoAcquisitionRecord,
  ): Promise<AutoAcquisitionBillingRecord> {
    const identity = this.getKaypalBillingIdentity();
    const baseUrl = this.getKaypalCloudBaseUrl();
    const billingIdempotencyKey = `ai-content:auto-acquisition:${record.id}`;
    const estimatedActions = Math.max(
      1,
      config.dailyLimit || record.selectedCount || 1,
    );
    const estimatedRuntimeMinutes = this.readPositiveNumberConfig(
      'KAYPAL_AUTO_ACQUISITION_RESERVE_RUNTIME_MINUTES',
      30,
    );

    try {
      const response = await fetch(new URL('/api/billing/reserve', baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          amount: 10,
          service_type: 'runtime_automation',
          resource_type: 'platform_action',
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey: billingIdempotencyKey,
            mode: 'auto_acquisition',
            taskType: 'douyin_auto_acquisition',
            phase: 'reserve',
            configId: config.id,
            recordId: record.id,
            trigger: record.trigger,
            keyword: record.keyword,
            runtimeMinutes: estimatedRuntimeMinutes,
            replies: estimatedActions,
            platformActions: estimatedActions,
            leads: estimatedActions,
            evidences: estimatedActions + 1,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      const payloadRecord = this.asRecord(payload);
      if (!response.ok) {
        throw new Error(
          this.getBillingResponseError(payloadRecord, response.status),
        );
      }

      const billingRecord = this.asRecord(payloadRecord?.billing);
      const amount =
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        0;
      const reservationId =
        typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined;
      const balanceAfter =
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord);
      const policyVersion =
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined;

      if (!reservationId) {
        throw new Error('Kaypal 云端冻结积分未返回 reservation id。');
      }

      this.logger.log(
        `Auto acquisition cloud billing reserved: record=${record.id}, amount=${amount}`,
      );
      return {
        status: 'charged',
        amount,
        reservationId,
        balanceAfter: balanceAfter ?? undefined,
        policyVersion,
        idempotencyKey: billingIdempotencyKey,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Auto acquisition cloud billing reserve failed: ${message}`,
      );
      throw new ServiceUnavailableException(`云端冻结积分失败：${message}`);
    }
  }

  private async captureAutoAcquisitionCredits(
    reservation: AutoAcquisitionBillingRecord | undefined,
    config: AutoAcquisitionConfig,
    record: AutoAcquisitionRecord,
  ): Promise<AutoAcquisitionBillingRecord> {
    if (!reservation?.reservationId) {
      throw new ServiceUnavailableException(
        '自动获客缺少云端冻结记录，不能结算。',
      );
    }

    if (this.hasNoBillableAutoAcquisitionWork(record)) {
      await this.releaseAutoAcquisitionCredits(
        reservation,
        '本次没有搜索、触达、证据或线索沉淀，不扣积分。',
      );
      return {
        ...reservation,
        status: 'skipped',
        amount: 0,
        message: '本次没有搜索、触达、证据或线索沉淀，不扣积分。',
      };
    }

    const identity = this.getKaypalBillingIdentity();
    const baseUrl = this.getKaypalCloudBaseUrl();
    const summary = record.executionSummary;
    const evidenceCount = this.countAutoAcquisitionEvidence(record);
    const runtimeMinutes = this.getAutoAcquisitionRuntimeMinutes(record);

    try {
      const response = await fetch(new URL('/api/billing/capture', baseUrl), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          reservation_id: reservation.reservationId,
          amount: 10,
          service_type: 'runtime_automation',
          resource_type: 'platform_action',
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey: reservation.idempotencyKey,
            mode: 'auto_acquisition',
            taskType: 'douyin_auto_acquisition',
            phase: 'capture',
            configId: config.id,
            recordId: record.id,
            trigger: record.trigger,
            keyword: record.keyword,
            selectedCount: record.selectedCount,
            candidateCount: record.candidateCount,
            runtimeMinutes,
            replies: summary?.successCount || 0,
            platformActions: summary?.attemptedCount || 0,
            leads: record.crmCapture?.capturedCount || 0,
            evidences: evidenceCount,
            attemptedCount: summary?.attemptedCount || 0,
            successCount: summary?.successCount || 0,
            failedCount: summary?.failedCount || 0,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      const payloadRecord = this.asRecord(payload);

      if (!response.ok) {
        throw new Error(
          this.getBillingResponseError(payloadRecord, response.status),
        );
      }

      const billingRecord = this.asRecord(payloadRecord?.billing);
      const amount =
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        0;
      const balanceAfter =
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord);
      const transactionId =
        typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined;
      const policyVersion =
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined;

      this.logger.log(
        `Auto acquisition cloud billing charged: record=${record.id}, amount=${amount}`,
      );
      return {
        status: 'charged',
        amount,
        reservationId: reservation.reservationId,
        transactionId,
        balanceAfter: balanceAfter ?? undefined,
        policyVersion,
        idempotencyKey: reservation.idempotencyKey,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Auto acquisition cloud billing failed: ${message}`);
      throw new ServiceUnavailableException(`云端结算积分失败：${message}`);
    }
  }

  async releaseRuntimeAutomationCredits(
    reservation: AutoAcquisitionBillingRecord,
    reason: string,
  ) {
    return this.releaseAutoAcquisitionCredits(reservation, reason);
  }

  private async releaseAutoAcquisitionCredits(
    reservation: AutoAcquisitionBillingRecord,
    reason: string,
  ) {
    if (!reservation.reservationId) return;
    const identity = this.getKaypalBillingIdentity();
    const response = await fetch(
      new URL('/api/billing/release', this.getKaypalCloudBaseUrl()),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          reservation_id: reservation.reservationId,
          reason,
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            idempotencyKey: reservation.idempotencyKey,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    const payloadRecord = this.asRecord(payload);
    if (!response.ok) {
      throw new Error(
        this.getBillingResponseError(payloadRecord, response.status),
      );
    }
  }

  async reserveRuntimeAutomationCredits(input: {
    idempotencyKey: string;
    mode: string;
    taskType: string;
    amount?: number;
    estimatedRuntimeMinutes: number;
    estimatedActions: number;
    metadata?: Record<string, unknown>;
  }): Promise<AutoAcquisitionBillingRecord> {
    const identity = this.getKaypalBillingIdentity();
    const amount = this.normalizeBillingAmount(input.amount, 10);
    const response = await fetch(
      new URL('/api/billing/reserve', this.getKaypalCloudBaseUrl()),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          amount,
          service_type: 'runtime_automation',
          resource_type: 'platform_action',
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey: input.idempotencyKey,
            mode: input.mode,
            taskType: input.taskType,
            phase: 'reserve',
            runtimeMinutes: input.estimatedRuntimeMinutes,
            replies: input.estimatedActions,
            platformActions: input.estimatedActions,
            leads: 0,
            evidences: input.estimatedActions,
            ...input.metadata,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    const payloadRecord = this.asRecord(payload);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `云端冻结积分失败：${this.getBillingResponseError(payloadRecord, response.status)}`,
      );
    }
    const billingRecord = this.asRecord(payloadRecord?.billing);
    const reservationId =
      typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined;
    if (!reservationId) {
      throw new ServiceUnavailableException(
        'Kaypal 云端冻结积分未返回 reservation id。',
      );
    }
    return {
      status: 'charged',
      amount:
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        0,
      reservationId,
      balanceAfter:
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord) ??
        undefined,
      policyVersion:
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined,
      idempotencyKey: input.idempotencyKey,
    };
  }

  async captureRuntimeAutomationCredits(
    reservation: AutoAcquisitionBillingRecord,
    input: {
      mode: string;
      taskType: string;
      amount?: number;
      runtimeMinutes: number;
      replies: number;
      platformActions: number;
      leads: number;
      evidences: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AutoAcquisitionBillingRecord> {
    const identity = this.getKaypalBillingIdentity();
    const amount = this.normalizeBillingAmount(
      input.amount,
      reservation.amount || 10,
    );
    const response = await fetch(
      new URL('/api/billing/capture', this.getKaypalCloudBaseUrl()),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          reservation_id: reservation.reservationId,
          amount,
          service_type: 'runtime_automation',
          resource_type: 'platform_action',
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            idempotencyKey: reservation.idempotencyKey,
            mode: input.mode,
            taskType: input.taskType,
            phase: 'capture',
            runtimeMinutes: input.runtimeMinutes,
            replies: input.replies,
            platformActions: input.platformActions,
            leads: input.leads,
            evidences: input.evidences,
            ...input.metadata,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    const payloadRecord = this.asRecord(payload);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `云端结算积分失败：${this.getBillingResponseError(payloadRecord, response.status)}`,
      );
    }
    const billingRecord = this.asRecord(payloadRecord?.billing);
    return {
      status: 'charged',
      amount:
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        0,
      reservationId: reservation.reservationId,
      transactionId:
        typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined,
      balanceAfter:
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord) ??
        undefined,
      policyVersion:
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined,
      idempotencyKey: reservation.idempotencyKey,
    };
  }

  async deductExternalDataCredits(input: {
    idempotencyKey: string;
    mode: string;
    taskType: string;
    amount?: number;
    runtimeMinutes: number;
    replies: number;
    platformActions: number;
    leads: number;
    evidences: number;
    metadata?: Record<string, unknown>;
  }): Promise<AutoAcquisitionBillingRecord> {
    let identity = this.getKaypalExternalDataBillingIdentity();
    const amount = this.normalizeBillingAmount(input.amount, 1);
    let result;
    try {
      result = await this.postExternalDataCreditDeduct(input, amount, identity);
    } catch (error) {
      const fallbackIdentity =
        identity.authSource === 'desktop-token'
          ? this.getKaypalServerExternalDataBillingIdentity(identity.userId)
          : null;
      if (!fallbackIdentity) {
        throw this.externalDataBillingException(error);
      }
      identity = fallbackIdentity;
      try {
        result = await this.postExternalDataCreditDeduct(
          input,
          amount,
          identity,
        );
      } catch (fallbackError) {
        throw this.externalDataBillingException(fallbackError);
      }
    }
    if (
      !result.response.ok &&
      identity.authSource === 'desktop-token' &&
      this.isBillingAuthFailure(result.response.status, result.payloadRecord)
    ) {
      const fallbackIdentity = this.getKaypalServerExternalDataBillingIdentity(
        identity.userId,
      );
      if (fallbackIdentity) {
        identity = fallbackIdentity;
        result = await this.postExternalDataCreditDeduct(
          input,
          amount,
          identity,
        );
      }
    }
    const { response, payloadRecord } = result;
    if (!response.ok) {
      throw this.externalDataBillingException(
        this.getBillingResponseError(payloadRecord, response.status),
      );
    }
    const billingRecord = this.asRecord(payloadRecord?.billing);
    return {
      status: 'charged',
      amount:
        this.numberValue(billingRecord?.amount) ??
        this.numberValue(payloadRecord?.amount) ??
        amount,
      transactionId:
        typeof payloadRecord?.id === 'string' ? payloadRecord.id : undefined,
      balanceAfter:
        this.extractBillingBalanceValue(payloadRecord) ??
        this.extractBillingBalanceValue(billingRecord) ??
        undefined,
      policyVersion:
        typeof billingRecord?.policyVersion === 'string'
          ? billingRecord.policyVersion
          : undefined,
      idempotencyKey: input.idempotencyKey,
    };
  }

  private async postExternalDataCreditDeduct(
    input: {
      idempotencyKey: string;
      mode: string;
      taskType: string;
      runtimeMinutes: number;
      replies: number;
      platformActions: number;
      leads: number;
      evidences: number;
      metadata?: Record<string, unknown>;
    },
    amount: number,
    identity: KaypalExternalDataBillingIdentity,
  ) {
    const response = await fetch(
      new URL('/api/billing/deduct', this.getKaypalCloudBaseUrl()),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...identity.headers,
        },
        body: JSON.stringify({
          user_id: identity.userId,
          amount,
          service_type: 'ai_content_workbench',
          resource_type: 'redfox_external_data',
          metadata: {
            source: 'ai-content-workbench',
            billingMode: 'cloud',
            commercialBilling: true,
            billingAuthSource: identity.authSource,
            idempotencyKey: input.idempotencyKey,
            mode: input.mode,
            taskType: input.taskType,
            phase: 'deduct',
            runtimeMinutes: input.runtimeMinutes,
            replies: input.replies,
            platformActions: input.platformActions,
            leads: input.leads,
            evidences: input.evidences,
            dataPoints: amount,
            ...input.metadata,
          },
        }),
        signal: AbortSignal.timeout(
          this.readPositiveNumberConfig(
            'KAYPAL_RUNTIME_BILLING_TIMEOUT_MS',
            8000,
          ),
        ),
      },
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    return {
      response,
      payloadRecord: this.asRecord(payload),
    };
  }

  private hasNoBillableAutoAcquisitionWork(record: AutoAcquisitionRecord) {
    return (
      record.status === 'skipped' &&
      !record.executionSummary &&
      record.candidateCount <= 0 &&
      record.selectedCount <= 0 &&
      (record.videoCount || 0) <= 0 &&
      !record.crmCapture?.capturedCount &&
      this.countAutoAcquisitionEvidence(record) <= 0
    );
  }

  private getKaypalBillingIdentity(): KaypalBillingIdentity {
    const user = this.authRequestContext?.get()?.user;
    const userId = user?.kaypalUserId?.trim() || '';
    const token = user?.kaypalDesktopAccessToken?.trim() || '';

    if (!userId || !token) {
      throw new ServiceUnavailableException(
        '真实执行扣积分需要当前账号接通 Kaypal 云端授权，请在「账号与设备」重新登录后再执行。',
      );
    }

    return { userId, token };
  }

  private getKaypalExternalDataBillingIdentity(): KaypalExternalDataBillingIdentity {
    const user = this.authRequestContext?.get()?.user;
    const userId = user?.kaypalUserId?.trim() || '';
    const token = user?.kaypalDesktopAccessToken?.trim() || '';
    if (userId && token) {
      return {
        userId,
        authSource: 'desktop-token',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      };
    }

    const serverIdentity =
      this.getKaypalServerExternalDataBillingIdentity(userId);
    if (serverIdentity) {
      return serverIdentity;
    }

    throw new ServiceUnavailableException(
      '真实执行扣积分需要当前账号接通 Kaypal 云端授权，或后端配置 KAYPAL_API_KEY/KAYPAL_AI_PROXY_API_KEY 后再执行。',
    );
  }

  private getKaypalServerExternalDataBillingIdentity(
    userId: string,
  ): KaypalExternalDataBillingIdentity | null {
    const serverApiKey = this.getKaypalServerBillingApiKey();
    if (!userId || !serverApiKey) return null;
    return {
      userId,
      authSource: 'server-api-key',
      headers: {
        'x-kaypal-api-key': serverApiKey,
        'x-kaypal-user-id': userId,
      },
    };
  }

  private isBillingAuthFailure(
    status: number,
    payloadRecord: Record<string, unknown> | null,
  ) {
    const message = this.getBillingResponseError(payloadRecord, status);
    return status === 401 || /login|unauthorized|授权|token/i.test(message);
  }

  private externalDataBillingException(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (this.isInsufficientCreditsMessage(message)) {
      return new HttpException(
        {
          code: 'INSUFFICIENT_CREDITS',
          message: '积分余额不足，请充值或调整任务消耗后再试。',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    return new ServiceUnavailableException(`云端扣积分失败：${message}`);
  }

  private isInsufficientCreditsMessage(message: string) {
    return /INSUFFICIENT_CREDITS|积分不足|余额不足|额度不足|insufficient credits/i.test(
      message,
    );
  }

  private getKaypalServerBillingApiKey() {
    return (
      this.config?.get<string>('KAYPAL_API_KEY')?.trim() ||
      this.config?.get<string>('KAYPAL_AI_PROXY_API_KEY')?.trim() ||
      process.env.KAYPAL_API_KEY?.trim() ||
      process.env.KAYPAL_AI_PROXY_API_KEY?.trim() ||
      ''
    );
  }

  private getKaypalCloudBaseUrl() {
    return (
      this.config?.get<string>('KAYPAL_AUTH_BASE_URL')?.trim() ||
      process.env.KAYPAL_AUTH_BASE_URL ||
      DEFAULT_KAYPAL_AUTH_BASE_URL
    ).replace(/\/+$/, '');
  }

  private readPositiveNumberConfig(key: string, fallback: number) {
    const value = Number(
      this.config?.get<string>(key) || process.env[key] || '',
    );
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private normalizeBillingAmount(value: unknown, fallback: number) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value)
          : fallback;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return Math.max(1, Math.round(fallback || 1));
    }
    return Math.max(1, Math.round(parsed));
  }

  private getAutoAcquisitionRuntimeMinutes(record: AutoAcquisitionRecord) {
    const startedAtMs = Date.parse(record.createdAt);
    if (!Number.isFinite(startedAtMs)) return 1;
    return Math.max(1, Math.ceil((Date.now() - startedAtMs) / 60_000));
  }

  private countAutoAcquisitionEvidence(record: AutoAcquisitionRecord) {
    const evidenceUrls = new Set<string>();
    if (record.evidenceUrl) evidenceUrls.add(record.evidenceUrl);
    for (const result of record.executionResults || []) {
      if (result.evidenceUrl) evidenceUrls.add(result.evidenceUrl);
    }
    return evidenceUrls.size;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private extractBillingBalanceValue(value: unknown): number | null {
    const record = this.asRecord(value);
    if (!record) return null;
    return (
      this.numberValue(record.balanceAfter) ??
      this.numberValue(record.balance_after) ??
      this.numberValue(record.balance)
    );
  }

  private getBillingResponseError(
    payloadRecord: Record<string, unknown> | null,
    status: number,
  ) {
    return (
      (typeof payloadRecord?.error === 'string' ? payloadRecord.error : '') ||
      (typeof payloadRecord?.message === 'string'
        ? payloadRecord.message
        : '') ||
      `Kaypal 云端扣积分接口返回 HTTP ${status}`
    );
  }

  private async runAutoAcquisitionPipeline(
    config: AutoAcquisitionConfig,
    store: AutoAcquisitionStore,
    trigger: 'manual' | 'schedule',
  ) {
    const keyword = this.nextAutoAcquisitionKeyword(config, store);
    if (!keyword) {
      return {
        record: this.buildAutoAcquisitionSkippedRecord(
          config,
          trigger,
          '搜索关键词为空',
        ),
        successIncrement: 0,
        dedupeKeys: undefined,
      };
    }

    const remainingLimit = Math.max(
      0,
      config.dailyLimit - config.exposureCount,
    );
    const runResult = await this.findDouyinHotVideoLeads({
      accountId: config.accountId,
      keyword,
      limit: Math.min(Math.max(remainingLimit, 20), 50),
      commentTimeMatch: '7days',
      blacklistNicknames: this.splitAutoAcquisitionList(
        config.blacklistNicknames,
      ),
    });

    const dedupeSet = new Set(
      config.deduplicate
        ? store.dedupe[this.autoAcquisitionConfigKey(config)] || []
        : [],
    );
    const planCandidates = (candidates: DouyinFollowUpCandidateInput[]) =>
      this.planDouyinFollowUp({
        candidates,
        sourceLabel: '短视频评论获客',
        sourceText: keyword,
        accountName: config.account,
        privateMessage: '',
        commentTemplates: this.autoAcquisitionCommentTemplates(config),
        messageTemplates: [],
        dailyLimit: remainingLimit,
        maxTargets: remainingLimit,
        includeKeywords: candidates.some((candidate) =>
          this.isDouyinVideoDirectCommentTarget(candidate),
        )
          ? []
          : this.splitAutoAcquisitionList(config.keywords),
        blacklistKeywords: [],
        minScore: 45,
      });
    const freshOnly = (candidates: DouyinFollowUpCandidateInput[]) =>
      config.deduplicate
        ? candidates.filter((candidate) => {
            const key = this.autoAcquisitionDedupeKey(candidate);
            return key ? !dedupeSet.has(key) : true;
          })
        : candidates;

    const candidatePool: DouyinFollowUpCandidateInput[] =
      config.commentMode === 'video-comment'
        ? this.buildAutoAcquisitionDirectCommentCandidates(
            runResult,
            keyword,
            remainingLimit,
            '配置为视频直评，搜索到视频后直接在视频下评论。',
          )
        : runResult.candidates.length
          ? runResult.candidates
          : this.buildAutoAcquisitionDirectCommentCandidates(
              runResult,
              keyword,
              remainingLimit,
              '该爆款视频未采集到可回复评论，改为直接在视频下评论。',
            );

    let freshCandidates = freshOnly(candidatePool);

    let followPlan: Awaited<
      ReturnType<AiEmployeeService['planDouyinFollowUp']>
    > | null = null;
    if (runResult.ok && freshCandidates.length) {
      followPlan = await planCandidates(freshCandidates);
    }

    let selectedCount =
      followPlan?.summary.selectedCount ?? freshCandidates.length;
    let executableTargets =
      followPlan?.targets.filter(
        (target) => target.commentTaskEnabled && target.commentReplyText,
      ) || [];

    if (
      config.commentMode !== 'video-comment' &&
      runResult.ok &&
      runResult.candidates.length > 0 &&
      executableTargets.length === 0
    ) {
      const directFallbackCandidates = freshOnly(
        this.buildAutoAcquisitionDirectCommentCandidates(
          runResult,
          keyword,
          remainingLimit,
          '评论区没有命中匹配关键词，改为直接在视频下评论。',
        ),
      );
      if (directFallbackCandidates.length) {
        freshCandidates = directFallbackCandidates;
        followPlan = await planCandidates(freshCandidates);
        selectedCount = followPlan.summary.selectedCount;
        executableTargets = followPlan.targets.filter(
          (target) => target.commentTaskEnabled && target.commentReplyText,
        );
      }
    }

    const executeResult = executableTargets.length
      ? await this.executeDouyinFollowUpCore(
          {
            accountId: config.accountId,
            targets: executableTargets,
            maxTargets: remainingLimit,
            autoSend: true,
          },
          { billingCovered: true },
        )
      : null;

    const successfulTargets = executeResult
      ? executableTargets.filter((target, targetIndex) =>
          executeResult.results.some(
            (result) =>
              result.ok &&
              (result.index === (target.index ?? targetIndex) ||
                (result.targetName === target.targetName &&
                  result.targetText === target.text)),
          ),
        )
      : [];

    if (config.deduplicate && successfulTargets.length > 0) {
      successfulTargets.forEach((candidate) => {
        const key = this.autoAcquisitionDedupeKey(candidate);
        if (key) dedupeSet.add(key);
      });
    }

    const successIncrement = executeResult?.summary.successCount ?? 0;
    return {
      record: this.buildAutoAcquisitionRecord({
        config,
        trigger,
        keyword,
        runResult,
        followPlan,
        executeResult,
        freshCandidateCount: freshCandidates.length,
        selectedCount,
      }),
      successIncrement,
      dedupeKeys: config.deduplicate
        ? Array.from(dedupeSet).slice(-1000)
        : undefined,
    };
  }

  private async markAutoAcquisitionConfigFailed(
    id: string,
    message: string,
    trigger: 'manual' | 'schedule',
    today: string,
    runningRecord?: AutoAcquisitionRecord,
    scope: AutoAcquisitionScope = runningRecord || {
      tenantId: LEGACY_AUTO_ACQUISITION_TENANT,
      userId: LEGACY_AUTO_ACQUISITION_USER,
    },
  ) {
    const store = await this.loadAutoAcquisitionStore();
    const existing = store.configs.find(
      (item) => item.id === id && this.inAutoAcquisitionScope(item, scope),
    );
    if (!existing) return;
    const next: AutoAcquisitionConfig = {
      ...this.normalizeAutoAcquisitionConfigForToday(existing, today),
      status: 'enabled',
      reason: message,
      lastRunAt: new Date().toISOString(),
      lastScheduledRunDate:
        trigger === 'schedule' ? today : existing.lastScheduledRunDate,
      updatedAt: new Date().toISOString(),
    };
    const failedRecord = runningRecord
      ? {
          ...runningRecord,
          status: 'failed',
          message,
          executionSummary: {
            attemptedCount: 0,
            successCount: 0,
            failedCount: 1,
            message,
          },
        }
      : undefined;
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.map((item) =>
        item.id === id && this.inAutoAcquisitionScope(item, scope)
          ? next
          : item,
      ),
      records: failedRecord
        ? this.upsertAutoAcquisitionRecord(store.records, failedRecord)
        : store.records,
    });
  }

  private async appendAutoAcquisitionRecord(
    record: AutoAcquisitionRecord,
    config: AutoAcquisitionConfig,
  ) {
    const store = await this.loadAutoAcquisitionStore();
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.map((item) =>
        item.id === config.id && this.inAutoAcquisitionScope(item, config)
          ? config
          : item,
      ),
      records: this.upsertAutoAcquisitionRecord(store.records, record),
    });
  }

  private async recoverInterruptedAutoAcquisitionRuns() {
    const store = await this.loadAutoAcquisitionStore();
    const interruptedKeys = new Set(
      store.configs
        .filter((config) => config.status === 'running')
        .map((config) => this.autoAcquisitionConfigKey(config)),
    );
    if (!interruptedKeys.size) return;

    const message = '上次后台任务中断，等待下一次定时';
    await this.saveAutoAcquisitionStore({
      ...store,
      configs: store.configs.map((config) =>
        interruptedKeys.has(this.autoAcquisitionConfigKey(config))
          ? {
              ...config,
              status: 'enabled',
              reason: message,
              updatedAt: new Date().toISOString(),
            }
          : config,
      ),
      records: store.records.map((record) =>
        interruptedKeys.has(
          this.autoAcquisitionConfigKey({
            tenantId: record.tenantId,
            userId: record.userId,
            id: record.configId,
          }),
        ) && record.status === 'running'
          ? {
              ...record,
              status: 'failed',
              message,
              executionSummary: {
                attemptedCount: 0,
                successCount: 0,
                failedCount: 1,
                message,
              },
            }
          : record,
      ),
    });
  }

  private upsertAutoAcquisitionRecord(
    records: AutoAcquisitionRecord[],
    record: AutoAcquisitionRecord,
  ) {
    const next = [
      record,
      ...records.filter(
        (item) =>
          item.id !== record.id || !this.inAutoAcquisitionScope(item, record),
      ),
    ];
    return this.limitAutoAcquisitionRecordsPerScope(next);
  }

  private async replaceAutoAcquisitionConfig(config: AutoAcquisitionConfig) {
    const store = await this.loadAutoAcquisitionStore();
    const nextStore = {
      ...store,
      configs: store.configs.map((item) =>
        item.id === config.id && this.inAutoAcquisitionScope(item, config)
          ? config
          : item,
      ),
    };
    await this.saveAutoAcquisitionStore(nextStore);
    return nextStore;
  }

  private buildAutoAcquisitionRecord(input: {
    config: AutoAcquisitionConfig;
    trigger: 'manual' | 'schedule';
    keyword: string;
    runResult: Awaited<
      ReturnType<AiEmployeeService['findDouyinHotVideoLeads']>
    >;
    followPlan: Awaited<
      ReturnType<AiEmployeeService['planDouyinFollowUp']>
    > | null;
    executeResult: Awaited<
      ReturnType<AiEmployeeService['executeDouyinFollowUp']>
    > | null;
    freshCandidateCount: number;
    selectedCount: number;
  }): AutoAcquisitionRecord {
    const { config, executeResult, followPlan, runResult } = input;
    const createdAt = new Date().toISOString();
    const targets = followPlan?.targets || [];
    const actualSuccessCount = executeResult?.summary.successCount ?? 0;
    const executionResults = executeResult?.results.map((item) => ({
      index: item.index,
      targetName: item.targetName,
      targetText: item.targetText,
      replyText: item.replyText,
      ok: item.ok,
      status: item.status,
      message: item.message,
      evidenceUrl: this.evidenceReference(item.evidence),
    }));
    return {
      tenantId: config.tenantId,
      userId: config.userId,
      id: this.createAutoAcquisitionId('aar'),
      configId: config.id,
      taskName: config.taskName,
      createdTime: this.formatAutoAcquisitionTime(createdAt),
      createdAt,
      trigger: input.trigger,
      status: executeResult
        ? actualSuccessCount > 0
          ? executeResult.status
          : 'failed'
        : runResult.status,
      message: executeResult
        ? executeResult.message
        : followPlan
          ? `已生成 ${input.selectedCount} 条评论区回复任务，但没有可自动执行的评论目标`
          : config.deduplicate && runResult.candidates.length > 0
            ? '候选评论已命中去重记录，本次未生成新的评论回复'
            : runResult.message,
      keyword: input.keyword,
      candidateCount: input.freshCandidateCount,
      selectedCount: input.selectedCount,
      videoCount:
        executeResult?.summary.videoCount ||
        this.countAutoAcquisitionVideos(targets),
      evidenceUrl: executeResult
        ? this.evidenceReference(
            executeResult.results.flatMap((item) => item.evidence),
          )
        : this.evidenceReference(runResult.evidence),
      targets,
      executionResults,
      executionSummary: executeResult
        ? {
            attemptedCount: executeResult.summary.attemptedCount,
            successCount: executeResult.summary.successCount,
            failedCount: executeResult.summary.failedCount,
            message: executeResult.message,
          }
        : undefined,
    };
  }

  private buildAutoAcquisitionSkippedRecord(
    config: AutoAcquisitionConfig,
    trigger: 'manual' | 'schedule',
    message: string,
  ): AutoAcquisitionRecord {
    const createdAt = new Date().toISOString();
    return {
      tenantId: config.tenantId,
      userId: config.userId,
      id: this.createAutoAcquisitionId('aar'),
      configId: config.id,
      taskName: config.taskName,
      createdTime: this.formatAutoAcquisitionTime(createdAt),
      createdAt,
      trigger,
      status: 'skipped',
      message,
      keyword: this.firstAutoAcquisitionKeyword(config.searchKeywords),
      candidateCount: 0,
      selectedCount: 0,
      videoCount: 0,
      targets: [],
    };
  }

  private buildAutoAcquisitionRunningRecord(
    config: AutoAcquisitionConfig,
    trigger: 'manual' | 'schedule',
  ): AutoAcquisitionRecord {
    const createdAt = new Date().toISOString();
    const message = trigger === 'schedule' ? '后台定时执行中' : '执行中';
    return {
      tenantId: config.tenantId,
      userId: config.userId,
      id: this.createAutoAcquisitionId('aar'),
      configId: config.id,
      taskName: config.taskName,
      createdTime: this.formatAutoAcquisitionTime(createdAt),
      createdAt,
      trigger,
      status: 'running',
      message,
      keyword: this.firstAutoAcquisitionKeyword(config.searchKeywords),
      candidateCount: 0,
      selectedCount: 0,
      videoCount: 0,
      targets: [],
      executionSummary: {
        attemptedCount: 0,
        successCount: 0,
        failedCount: 0,
        message,
      },
    };
  }

  private evidenceReference(items: Array<{ url?: string; path?: string }>) {
    const screenshotPath = items.find((item) =>
      this.readOptionalText(item.path),
    )?.path;
    if (screenshotPath) return screenshotPath;
    return (
      items.find((item) => this.isOpenableEvidenceUrl(item.url))?.url || ''
    );
  }

  private isOpenableEvidenceUrl(value: unknown) {
    const text = this.readOptionalText(value);
    return /^https?:\/\//i.test(text) || text.startsWith('/api/');
  }

  private countAutoAcquisitionVideos(
    targets: Array<{ videoUrl?: string; sourceUrl?: string }>,
  ) {
    return new Set(
      targets.map((target) => this.videoBucketKey(target)).filter(Boolean),
    ).size;
  }

  private autoAcquisitionCommentTemplates(config: AutoAcquisitionConfig) {
    return [
      ...this.splitAutoAcquisitionLines(config.contents),
      ...(config.appendCommentEnabled
        ? this.splitAutoAcquisitionLines(config.appendComments)
        : []),
    ];
  }

  private autoAcquisitionDedupeKey(candidate: DouyinFollowUpCandidateInput) {
    return (
      this.readOptionalText(candidate.videoUrl) ||
      this.readOptionalText(candidate.sourceUrl) ||
      this.readOptionalText(candidate.profileUrl) ||
      this.readOptionalText(candidate.targetName) ||
      this.readOptionalText(candidate.text)
    );
  }

  private buildAutoAcquisitionDirectCommentCandidates(
    runResult: ReturnType<AiEmployeeService['toResponse']>,
    keyword: string,
    limit: number,
    reason = '该爆款视频未采集到可回复评论，改为直接在视频下评论。',
  ): DouyinFollowUpCandidateInput[] {
    const raw = runResult.raw || {};
    const openedVideos = Array.isArray(raw.openedVideos)
      ? raw.openedVideos
      : [];
    const selectedVideos = Array.isArray(raw.selectedVideos)
      ? raw.selectedVideos
      : [];
    const videos: DouyinFollowUpCandidateInput[] = [];
    [...openedVideos, ...selectedVideos].forEach((item, index) => {
      const value = item as Record<string, unknown>;
      const videoUrl = this.readOptionalText(value.url || value.snapshotUrl);
      if (!videoUrl || !/douyin\.com\/video\//i.test(videoUrl)) return;
      const title =
        this.readOptionalText(value.title || value.snapshotTitle) ||
        `${keyword}相关短视频`;
      videos.push({
        text: `${keyword}相关短视频：${title}`.slice(0, 120),
        sourceUrl: videoUrl,
        videoUrl,
        videoTitle: title,
        kind: 'hot-video-direct-comment',
        commentMode: 'video-comment',
        index: 10000 + index,
        engagementScore: this.readOptionalNumber(value.engagementScore),
        likeCount: this.readOptionalNumber(value.likeCount),
        commentCount: this.readOptionalNumber(
          value.commentCount ?? value.candidateCount,
        ),
        shareCount: this.readOptionalNumber(value.shareCount),
        score: 68,
        reason,
      });
    });
    const seen = new Set<string>();
    return videos
      .filter((item) => {
        const key = this.videoBucketKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, Math.max(0, Math.min(limit, 20)));
  }

  private firstAutoAcquisitionKeyword(value: string) {
    return (
      this.splitAutoAcquisitionList(value)[0] || this.readOptionalText(value)
    );
  }

  private nextAutoAcquisitionKeyword(
    config: AutoAcquisitionConfig,
    store: AutoAcquisitionStore,
  ) {
    const keywords = this.splitAutoAcquisitionList(config.searchKeywords);
    if (!keywords.length) return this.readOptionalText(config.searchKeywords);
    const runCount = store.records.filter(
      (record) =>
        record.configId === config.id &&
        this.inAutoAcquisitionScope(record, config),
    ).length;
    return keywords[runCount % keywords.length];
  }

  private splitAutoAcquisitionList(value = '') {
    return String(value || '')
      .split(/[\n,，、\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private splitAutoAcquisitionLines(value = '') {
    return String(value || '')
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isAutoAcquisitionConfigDue(
    config: AutoAcquisitionConfig,
    now: Date,
    today = this.dateKey(now),
  ) {
    if (this.isQuarantinedLegacyAutoAcquisitionScope(config)) return false;
    if (config.status !== 'enabled') return false;
    if (!config.accountId || !config.searchKeywords.trim()) return false;
    if (
      this.autoAcquisitionRunningIds.has(this.autoAcquisitionConfigKey(config))
    )
      return false;
    if (config.lastScheduledRunDate === today) return false;
    if (config.exposureCount >= config.dailyLimit) return false;
    return this.minutesOfDay(now) >= this.minutesFromTime(config.beginTime);
  }

  private isQuarantinedLegacyAutoAcquisitionScope(
    config: AutoAcquisitionScope,
  ) {
    return (
      Boolean(this.authRequestContext && this.prisma) &&
      config.tenantId === LEGACY_AUTO_ACQUISITION_TENANT &&
      config.userId === LEGACY_AUTO_ACQUISITION_USER
    );
  }

  private assertAutoAcquisitionConfigNotRunning(config: AutoAcquisitionConfig) {
    if (
      this.autoAcquisitionRunningIds.has(this.autoAcquisitionConfigKey(config))
    ) {
      throw new BadRequestException('这条自动获客配置正在执行，暂时不能修改');
    }
  }

  private normalizeAutoAcquisitionConfigInput(
    input: AutoAcquisitionConfigInput,
    existing?: AutoAcquisitionConfig,
    scope: AutoAcquisitionScope = existing || {
      tenantId: LEGACY_AUTO_ACQUISITION_TENANT,
      userId: LEGACY_AUTO_ACQUISITION_USER,
    },
  ): AutoAcquisitionConfig {
    const now = this.nextAutoAcquisitionUpdatedAt(existing?.updatedAt);
    const today = this.dateKey();
    const existingForToday = existing
      ? this.normalizeAutoAcquisitionConfigForToday(existing, today)
      : undefined;
    const accountId = this.requireText(
      input.accountId ?? existing?.accountId,
      '请选择抖音账号',
    );
    const searchKeywords = this.requireText(
      input.searchKeywords ?? existing?.searchKeywords,
      '请填写搜索关键词',
    );
    const status: AutoAcquisitionConfigStatus =
      input.enabled === false || input.status === 'disabled'
        ? 'disabled'
        : input.status === 'running'
          ? 'enabled'
          : 'enabled';
    const dailyLimit = Math.min(
      Math.max(
        Math.floor(
          Number(input.dailyLimit ?? existing?.dailyLimit ?? 10) || 10,
        ),
        1,
      ),
      200,
    );
    return {
      tenantId: scope.tenantId,
      userId: scope.userId,
      id: existing?.id || input.id || this.createAutoAcquisitionId('aac'),
      taskName:
        this.readOptionalText(input.taskName ?? existing?.taskName) ||
        `自动获客${Date.now()}`,
      accountId,
      account:
        this.readOptionalText(input.account ?? existing?.account) ||
        `抖音账号 ${accountId}`,
      socialPlatform: '抖音',
      reason: status === 'disabled' ? '手动停用' : existing?.reason || '无',
      commentMode:
        input.commentMode === 'video-comment' ||
        existing?.commentMode === 'video-comment'
          ? 'video-comment'
          : 'reply',
      searchKeywords,
      keywords:
        this.readOptionalText(input.keywords ?? existing?.keywords) ||
        AUTO_ACQUISITION_DEFAULT_KEYWORDS,
      contents:
        this.readOptionalText(input.contents ?? existing?.contents) ||
        AUTO_ACQUISITION_DEFAULT_COMMENT_REPLIES.join('\n'),
      blacklistNicknames: this.readOptionalText(
        input.blacklistNicknames ?? existing?.blacklistNicknames,
      ),
      enterpriseOnly: Boolean(input.enterpriseOnly ?? existing?.enterpriseOnly),
      appendCommentEnabled: Boolean(
        input.appendCommentEnabled ?? existing?.appendCommentEnabled,
      ),
      appendComments:
        this.readOptionalText(
          input.appendComments ?? existing?.appendComments,
        ) || AUTO_ACQUISITION_DEFAULT_APPEND_REPLIES.join('\n'),
      dailyLimit,
      exposureCount: Math.min(
        Math.max(
          Math.floor(
            Number(
              input.exposureCount ?? existingForToday?.exposureCount ?? 0,
            ) || 0,
          ),
          0,
        ),
        dailyLimit,
      ),
      exposureDate: today,
      deduplicate: Boolean(input.deduplicate ?? existing?.deduplicate),
      beginTime:
        this.normalizeDailyTime(
          this.readOptionalText(input.beginTime ?? existing?.beginTime) ||
            '09:00',
        ) || '09:00',
      createdTime: existing?.createdTime || this.formatAutoAcquisitionTime(now),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastRunAt: existing?.lastRunAt,
      lastScheduledRunDate: existing?.lastScheduledRunDate,
      status,
    };
  }

  private normalizeAutoAcquisitionConfigForToday(
    config: AutoAcquisitionConfig,
    today = this.dateKey(),
  ): AutoAcquisitionConfig {
    const exposureDate = this.readOptionalText(config.exposureDate) || today;
    const status: AutoAcquisitionConfigStatus =
      config.status === 'disabled'
        ? 'disabled'
        : config.status === 'running'
          ? 'running'
          : 'enabled';
    return {
      ...config,
      commentMode:
        config.commentMode === 'video-comment' ? 'video-comment' : 'reply',
      exposureCount:
        exposureDate === today
          ? this.readNonNegativeInteger(config.exposureCount)
          : 0,
      exposureDate: today,
      status,
      reason:
        status === 'disabled'
          ? config.reason || '手动停用'
          : status === 'running'
            ? config.reason || '执行中'
            : config.reason || '无',
      beginTime: this.normalizeDailyTime(config.beginTime) || '09:00',
      dailyLimit: Math.min(
        Math.max(this.readNonNegativeInteger(config.dailyLimit) || 10, 1),
        200,
      ),
    };
  }

  private async loadAutoAcquisitionStore() {
    if (!this.autoAcquisitionStoreReady) {
      this.autoAcquisitionStoreReady = this.readAutoAcquisitionStore();
    }
    return this.autoAcquisitionStoreReady;
  }

  private async readAutoAcquisitionStore(): Promise<AutoAcquisitionStore> {
    const filePath = this.autoAcquisitionStorePath();
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AutoAcquisitionStore>;
      return this.normalizeAutoAcquisitionStore(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `Auto acquisition store read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return this.emptyAutoAcquisitionStore();
    }
  }

  private async saveAutoAcquisitionStore(store: AutoAcquisitionStore) {
    const normalized = this.normalizeAutoAcquisitionStore(store);
    const filePath = this.autoAcquisitionStorePath();
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8');
    this.autoAcquisitionStoreReady = Promise.resolve(normalized);
    return normalized;
  }

  private normalizeAutoAcquisitionStore(
    input: Partial<AutoAcquisitionStore>,
  ): AutoAcquisitionStore {
    const today = this.dateKey();
    const configs = Array.isArray(input.configs)
      ? input.configs
          .map((item) => this.normalizeStoredAutoAcquisitionConfig(item, today))
          .filter((item): item is AutoAcquisitionConfig => Boolean(item))
      : [];
    const records = Array.isArray(input.records)
      ? input.records
          .map((item) => this.normalizeStoredAutoAcquisitionRecord(item))
          .filter((item): item is AutoAcquisitionRecord => Boolean(item))
      : [];
    const rawDedupe =
      input.dedupe &&
      typeof input.dedupe === 'object' &&
      !Array.isArray(input.dedupe)
        ? input.dedupe
        : {};
    return {
      version: AUTO_ACQUISITION_STORE_VERSION,
      configs,
      records: this.limitAutoAcquisitionRecordsPerScope(records),
      dedupe: Object.fromEntries(
        Object.entries(rawDedupe).map(([key, value]) => {
          const owner = configs.find(
            (config) =>
              this.autoAcquisitionConfigKey(config) === key ||
              config.id === key,
          );
          const scopedKey = owner ? this.autoAcquisitionConfigKey(owner) : key;
          return [
            scopedKey,
            Array.isArray(value)
              ? value.map((item) => String(item || '').trim()).filter(Boolean)
              : [],
          ];
        }),
      ),
    };
  }

  private normalizeStoredAutoAcquisitionConfig(
    value: unknown,
    today: string,
  ): AutoAcquisitionConfig | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const item = value as Partial<AutoAcquisitionConfig>;
    const storedTenantId = this.readOptionalText(item.tenantId);
    const storedUserId = this.readOptionalText(item.userId);
    const scope =
      storedTenantId && storedUserId
        ? { tenantId: storedTenantId, userId: storedUserId }
        : {
            tenantId: LEGACY_AUTO_ACQUISITION_TENANT,
            userId: LEGACY_AUTO_ACQUISITION_USER,
          };
    try {
      return this.normalizeAutoAcquisitionConfigForToday(
        {
          ...scope,
          id:
            this.readOptionalText(item.id) ||
            this.createAutoAcquisitionId('aac'),
          taskName: this.readOptionalText(item.taskName) || '自动获客',
          accountId: this.readOptionalText(item.accountId),
          account: this.readOptionalText(item.account),
          socialPlatform: '抖音',
          reason: this.readOptionalText(item.reason) || '无',
          commentMode:
            item.commentMode === 'video-comment' ? 'video-comment' : 'reply',
          searchKeywords: this.readOptionalText(item.searchKeywords),
          keywords:
            this.readOptionalText(item.keywords) ||
            AUTO_ACQUISITION_DEFAULT_KEYWORDS,
          contents:
            this.readOptionalText(item.contents) ||
            AUTO_ACQUISITION_DEFAULT_COMMENT_REPLIES.join('\n'),
          blacklistNicknames: this.readOptionalText(item.blacklistNicknames),
          enterpriseOnly: Boolean(item.enterpriseOnly),
          appendCommentEnabled: Boolean(item.appendCommentEnabled),
          appendComments:
            this.readOptionalText(item.appendComments) ||
            AUTO_ACQUISITION_DEFAULT_APPEND_REPLIES.join('\n'),
          dailyLimit: this.readNonNegativeInteger(item.dailyLimit) || 10,
          exposureCount: this.readNonNegativeInteger(item.exposureCount),
          exposureDate: this.readOptionalText(item.exposureDate) || today,
          deduplicate: Boolean(item.deduplicate),
          beginTime:
            this.normalizeDailyTime(this.readOptionalText(item.beginTime)) ||
            '09:00',
          createdTime:
            this.readOptionalText(item.createdTime) ||
            this.formatAutoAcquisitionTime(),
          createdAt:
            this.readOptionalText(item.createdAt) || new Date().toISOString(),
          updatedAt:
            this.readOptionalText(item.updatedAt) || new Date().toISOString(),
          lastRunAt: this.readOptionalText(item.lastRunAt) || undefined,
          lastScheduledRunDate:
            this.readOptionalText(item.lastScheduledRunDate) || undefined,
          status:
            item.status === 'disabled'
              ? 'disabled'
              : item.status === 'running'
                ? 'running'
                : 'enabled',
        },
        today,
      );
    } catch {
      return null;
    }
  }

  private normalizeStoredAutoAcquisitionRecord(
    value: unknown,
  ): AutoAcquisitionRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const item = value as Partial<AutoAcquisitionRecord>;
    const storedTenantId = this.readOptionalText(item.tenantId);
    const storedUserId = this.readOptionalText(item.userId);
    const scope =
      storedTenantId && storedUserId
        ? { tenantId: storedTenantId, userId: storedUserId }
        : {
            tenantId: LEGACY_AUTO_ACQUISITION_TENANT,
            userId: LEGACY_AUTO_ACQUISITION_USER,
          };
    const createdAt =
      this.readOptionalText(item.createdAt) || new Date().toISOString();
    return {
      ...scope,
      id: this.readOptionalText(item.id) || this.createAutoAcquisitionId('aar'),
      configId: this.readOptionalText(item.configId),
      taskName: this.readOptionalText(item.taskName) || '自动获客',
      createdTime:
        this.readOptionalText(item.createdTime) ||
        this.formatAutoAcquisitionTime(createdAt),
      createdAt,
      trigger: item.trigger === 'schedule' ? 'schedule' : 'manual',
      status: this.readOptionalText(item.status) || 'success',
      message: this.readOptionalText(item.message),
      keyword: this.readOptionalText(item.keyword),
      candidateCount: this.readNonNegativeInteger(item.candidateCount),
      selectedCount: this.readNonNegativeInteger(item.selectedCount),
      videoCount: this.readNonNegativeInteger(item.videoCount),
      evidenceUrl: this.readOptionalText(item.evidenceUrl) || undefined,
      targets: Array.isArray(item.targets) ? item.targets : [],
      executionResults: Array.isArray(item.executionResults)
        ? item.executionResults.map((result) => ({
            index: this.readNonNegativeInteger(result.index),
            targetName: this.readOptionalText(result.targetName) || undefined,
            targetText: this.readOptionalText(result.targetText) || undefined,
            replyText: this.readOptionalText(result.replyText) || undefined,
            ok: Boolean(result.ok),
            status: this.readOptionalText(result.status),
            message: this.readOptionalText(result.message),
            evidenceUrl: this.readOptionalText(result.evidenceUrl) || undefined,
          }))
        : undefined,
      executionSummary: item.executionSummary
        ? {
            attemptedCount: this.readNonNegativeInteger(
              item.executionSummary.attemptedCount,
            ),
            successCount: this.readNonNegativeInteger(
              item.executionSummary.successCount,
            ),
            failedCount: this.readNonNegativeInteger(
              item.executionSummary.failedCount,
            ),
            message: this.readOptionalText(item.executionSummary.message),
          }
        : undefined,
    };
  }

  private emptyAutoAcquisitionStore(): AutoAcquisitionStore {
    return {
      version: AUTO_ACQUISITION_STORE_VERSION,
      configs: [],
      records: [],
      dedupe: {},
    };
  }

  private autoAcquisitionStorePath() {
    return (
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_STORE_PATH ||
      resolveProjectDataPath('ai-employee', 'auto-acquisition.json')
    );
  }

  private autoAcquisitionConfigKey(
    value: Pick<AutoAcquisitionConfig, 'tenantId' | 'userId' | 'id'>,
  ) {
    return JSON.stringify([value.tenantId, value.userId, value.id]);
  }

  private inAutoAcquisitionScope(
    value: { tenantId?: string; userId?: string },
    scope: AutoAcquisitionScope,
  ) {
    return value.tenantId === scope.tenantId && value.userId === scope.userId;
  }

  private limitAutoAcquisitionRecordsPerScope(
    records: AutoAcquisitionRecord[],
  ) {
    const counts = new Map<string, number>();
    return records.filter((record) => {
      const scopeKey = JSON.stringify([record.tenantId, record.userId]);
      const count = counts.get(scopeKey) || 0;
      if (count >= 200) return false;
      counts.set(scopeKey, count + 1);
      return true;
    });
  }

  private async resolveAutoAcquisitionScope(): Promise<AutoAcquisitionScope> {
    if (!this.authRequestContext) {
      return {
        tenantId: LEGACY_AUTO_ACQUISITION_TENANT,
        userId: LEGACY_AUTO_ACQUISITION_USER,
      };
    }

    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!user || !userId) {
      throw new UnauthorizedException('请先登录后访问自动获客配置。');
    }

    if (!this.prisma) {
      return { tenantId: `local-desktop:${userId}`, userId };
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
      if (user.kaypalLocalOnly !== true) throw error;
    }

    if (user.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  private createAutoAcquisitionId(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
  }

  private nextAutoAcquisitionUpdatedAt(previous?: string) {
    const previousMs = previous ? Date.parse(previous) : Number.NaN;
    const nextMs = Number.isFinite(previousMs)
      ? Math.max(Date.now(), previousMs + 1)
      : Date.now();
    return new Date(nextMs).toISOString();
  }

  private dateKey(value = new Date()) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  private minutesOfDay(value: Date) {
    return value.getHours() * 60 + value.getMinutes();
  }

  private minutesFromTime(value: string) {
    const normalized = this.normalizeDailyTime(value) || '09:00';
    const [hour, minute] = normalized.split(':').map((item) => Number(item));
    return hour * 60 + minute;
  }

  private formatAutoAcquisitionTime(value: string | Date = new Date()) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(typeof value === 'string' ? new Date(value) : value);
  }

  async listSessions(limit?: number) {
    const normalizedLimit = this.normalizeSessionLimit(limit);
    const sessions = await this.localEngine.listAgentSessions(
      Math.min(normalizedLimit * 3, 200),
      {
        source: 'interaction',
      },
    );
    return sessions
      .filter((session) => this.isVisibleAiEmployeeSession(session))
      .slice(0, normalizedLimit);
  }

  async createSession(input: CreateAgentSessionInput) {
    const metadata = this.normalizeMetadata(input.metadata);
    return this.localEngine.createAgentSession({
      ...input,
      source: 'interaction',
      metadata: {
        ...metadata,
        aiEmployee: AI_EMPLOYEE_METADATA_FLAG,
        createdFrom:
          typeof metadata.createdFrom === 'string'
            ? metadata.createdFrom
            : 'ai-employee-automation',
      },
    });
  }

  async stopSession(id: string) {
    await this.assertAiEmployeeSession(id);
    return this.localEngine.stopAgentSession(id);
  }

  async archiveSession(id: string, input: ArchiveAgentSessionInput = {}) {
    await this.assertAiEmployeeSession(id);
    return this.localEngine.archiveAgentSession(id, input);
  }

  async findDouyinLeadsByLink(input: DouyinLinkLeadInput) {
    const accountId = this.requireText(input.accountId, '缺少抖音账号编号');
    const link = this.requireText(input.link, '请填写抖音视频链接');
    const limit = this.normalizeLimit(input.limit);
    const commentTimeMatch = this.normalizeCommentTimeMatch(
      input.commentTimeMatch,
    );

    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-link-exposure',
      relatedId: `ai-employee-douyin-link-${Date.now()}`,
      relatedType: 'agent-session',
      accountId,
      payload: {
        exposureExecutionKind: 'candidate_read',
        exposureMode: 'link',
        links: [link],
        filters: {
          commentLimit: limit,
          commentTimeMatch,
        },
      },
    });

    return this.toResponse(
      await this.runtime.execute(
        task,
        this.buildContext(`douyin:${accountId}`),
      ),
    );
  }

  async findDouyinLeadsByKeyword(input: DouyinSearchLeadInput) {
    const accountId = this.requireText(input.accountId, '缺少抖音账号编号');
    const keyword = this.requireText(input.keyword, '请填写搜索关键词');
    const limit = this.normalizeLimit(input.limit);
    const commentTimeMatch = this.normalizeCommentTimeMatch(
      input.commentTimeMatch,
    );

    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-search-account-exposure',
      relatedId: `ai-employee-douyin-search-${Date.now()}`,
      relatedType: 'agent-session',
      accountId,
      payload: {
        exposureExecutionKind: 'candidate_read',
        exposureMode: 'search_account',
        searchKeywords: [keyword],
        filters: {
          resultLimit: limit,
          commentTimeMatch,
          nicknameKeywords: this.normalizeTextList(input.nicknameKeywords),
          blacklistNicknames: this.normalizeTextList(input.blacklistNicknames),
          enterpriseOnly: input.enterpriseOnly === true,
        },
      },
    });

    return this.toResponse(
      await this.runtime.execute(
        task,
        this.buildContext(`douyin:${accountId}`),
      ),
    );
  }

  async findDouyinHotVideoLeads(input: DouyinHotVideoLeadInput) {
    const accountId = this.requireText(input.accountId, '缺少抖音账号编号');
    const keyword = this.requireText(input.keyword, '请填写行业关键词');
    const limit = this.normalizeLimit(input.limit);
    const commentTimeMatch = this.normalizeCommentTimeMatch(
      input.commentTimeMatch,
    );

    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-hot-video-exposure',
      relatedId: `ai-employee-douyin-hot-video-${Date.now()}`,
      relatedType: 'agent-session',
      accountId,
      payload: {
        exposureExecutionKind: 'candidate_read',
        exposureMode: 'hot_video',
        searchKeywords: [keyword],
        filters: {
          resultLimit: limit,
          preferVideoResults: true,
          preferHighEngagement: true,
          commentTimeMatch,
          blacklistNicknames: this.normalizeTextList(input.blacklistNicknames),
        },
      },
    });

    return this.toResponse(
      await this.runtime.execute(
        task,
        this.buildContext(`douyin:${accountId}`),
      ),
    );
  }

  async findDouyinTargetedLeads(input: DouyinTargetedLeadInput) {
    const accountId = this.requireText(input.accountId, '缺少抖音账号编号');
    const targets = this.normalizeTextList(input.targetAccounts);
    const keyword = this.readOptionalText(input.keyword);
    if (!targets.length && keyword) {
      targets.push(keyword);
    }
    if (!targets.length) {
      throw new BadRequestException('请填写目标账号或客户名单');
    }
    const limit = this.normalizeLimit(input.limit);
    const commentTimeMatch = this.normalizeCommentTimeMatch(
      input.commentTimeMatch,
    );

    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-targeted-exposure',
      relatedId: `ai-employee-douyin-targeted-${Date.now()}`,
      relatedType: 'agent-session',
      accountId,
      payload: {
        exposureExecutionKind: 'candidate_read',
        exposureMode: 'targeted',
        targetAccounts: targets,
        searchKeywords: targets,
        filters: {
          resultLimit: limit,
          commentTimeMatch,
          targetedMode: true,
          perTargetLimit: Math.min(
            Math.max(Math.floor(Number(input.perTargetLimit) || 1), 1),
            3,
          ),
        },
      },
    });

    return this.toResponse(
      await this.runtime.execute(
        task,
        this.buildContext(`douyin:${accountId}`),
      ),
    );
  }

  async findDouyinRetentionLeads(input: DouyinRetentionLeadInput) {
    const accountId = this.requireText(input.accountId, '缺少抖音账号编号');
    const retentionSourceId =
      this.readOptionalText(input.retentionSourceId) ||
      this.requireText(input.keyword, '请填写留资来源');
    const keyword = this.readOptionalText(input.keyword) || retentionSourceId;
    const limit = this.normalizeLimit(input.limit);
    const commentTimeMatch = this.normalizeCommentTimeMatch(
      input.commentTimeMatch,
    );
    const task = buildAiEmployeeExecutorTask({
      capabilityKey: 'douyin-retention-exposure',
      relatedId: `ai-employee-douyin-retention-${Date.now()}`,
      relatedType: 'agent-session',
      accountId,
      payload: {
        exposureExecutionKind: 'candidate_read',
        exposureMode: 'retention',
        retentionSourceId,
        searchKeywords: [keyword],
        filters: {
          resultLimit: limit,
          commentTimeMatch,
          retentionMode: true,
        },
      },
    });

    return this.toResponse(
      await this.runtime.execute(
        task,
        this.buildContext(`douyin:${accountId}`),
      ),
    );
  }

  async planDouyinFollowUp(input: DouyinFollowUpPlanInput) {
    const candidates = this.normalizeFollowUpCandidates(input.candidates);
    if (!candidates.length) {
      throw new BadRequestException('没有可筛选的抖音候选评论');
    }

    const sourceLabel = this.readOptionalText(input.sourceLabel) || '抖音获客';
    const sourceText = this.readOptionalText(input.sourceText) || '未填写';
    const accountName = this.readOptionalText(input.accountName) || '抖音账号';
    const privateMessage = this.normalizePrivateMessage(input.privateMessage);
    const commentTemplates = this.normalizeTemplatePool(input.commentTemplates);
    const messageTemplates = this.normalizeTemplatePool(input.messageTemplates);
    const dailyLimit = this.normalizeFollowUpLimit(input.dailyLimit);
    const filterConfig = {
      includeKeywords: this.normalizeKeywordList(input.includeKeywords),
      blacklistKeywords: this.normalizeKeywordList(input.blacklistKeywords),
      minScore: this.normalizeMinScore(input.minScore),
    };
    let remainingActions = Math.min(
      this.normalizeFollowUpLimit(input.maxTargets || dailyLimit),
      dailyLimit,
    );
    const maxActionsPerTarget = Math.min(
      Math.max(Math.floor(Number(input.maxActionsPerTarget) || 1), 1),
      2,
    );
    const scored = candidates.map((candidate) =>
      this.scoreDouyinCandidate(candidate, sourceText, filterConfig),
    );
    const deduped = this.dedupeScoredCandidates(scored);
    const eligible = deduped
      .filter((candidate) => !candidate.skipped)
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      );
    const diversifiedEligible = this.diversifyByVideo(eligible);

    const targets = diversifiedEligible
      .map((candidate, index) => {
        const canMessage = this.canCreateDouyinMessageTask(candidate);
        const isSearchAccount = this.isDouyinSearchAccountCandidate(candidate);
        const canComment =
          !isSearchAccount &&
          this.readOptionalText(candidate.kind).toLowerCase() !==
            'retention-contact' &&
          commentTemplates.length > 0;
        const followUpActions: DouyinFollowUpAction[] = [];
        if (
          remainingActions > 0 &&
          followUpActions.length < maxActionsPerTarget &&
          canComment
        ) {
          followUpActions.push('comment');
          remainingActions -= 1;
        }
        if (
          remainingActions > 0 &&
          followUpActions.length < maxActionsPerTarget &&
          canMessage
        ) {
          followUpActions.push('message');
          remainingActions -= 1;
        }
        const directMessageBlockedReason = canMessage
          ? undefined
          : isSearchAccount
            ? '搜索账号/创作者不是客户目标；自动获客只跟进别人视频评论区里的潜在客户留言。'
            : '评论区线索不是已有私信会话，不自动私信；会先自动评论/留言。';
        return {
          targetName:
            candidate.targetName ||
            (isSearchAccount ? candidate.text : '') ||
            '',
          text: candidate.text,
          sourceUrl: candidate.sourceUrl,
          kind: candidate.kind,
          commentMode: candidate.commentMode,
          index: candidate.index,
          profileUrl: candidate.profileUrl,
          commentTime: candidate.commentTime,
          videoTitle: candidate.videoTitle,
          videoUrl: candidate.videoUrl,
          engagementScore: candidate.engagementScore,
          likeCount: candidate.likeCount,
          commentCount: candidate.commentCount,
          shareCount: candidate.shareCount,
          score: candidate.score,
          reason: candidate.reason,
          followUpActions,
          commentTaskEnabled: followUpActions.includes('comment'),
          messageTaskEnabled: followUpActions.includes('message'),
          directMessageBlockedReason,
          sourceText: [
            candidate.targetName ? `目标：${candidate.targetName}` : '',
            candidate.text,
            candidate.commentTime ? `评论时间：${candidate.commentTime}` : '',
            candidate.videoTitle ? `视频：${candidate.videoTitle}` : '',
            candidate.engagementScore
              ? `视频互动分：${candidate.engagementScore}`
              : '',
            candidate.profileUrl ? `主页：${candidate.profileUrl}` : '',
            candidate.sourceUrl ? `来源：${candidate.sourceUrl}` : '',
            `线索来源：${sourceLabel} ${sourceText}`,
            `筛选原因：${candidate.reason}`,
          ]
            .filter(Boolean)
            .join('\n'),
          commentReplyText: this.buildDouyinCommentReply(
            candidate.text,
            sourceText,
            commentTemplates,
            index,
          ),
          directMessageText: this.buildDouyinDirectMessage(
            candidate.text,
            privateMessage,
            sourceText,
            messageTemplates,
            index,
          ),
        };
      })
      .filter((target) => target.followUpActions.length > 0);
    const skipped = deduped
      .filter(
        (candidate) =>
          candidate.skipped ||
          !targets.some(
            (item) =>
              item.index === candidate.index && item.text === candidate.text,
          ),
      )
      .map((candidate) => ({
        text: candidate.text,
        sourceUrl: candidate.sourceUrl,
        kind: candidate.kind,
        index: candidate.index,
        targetName: candidate.targetName,
        profileUrl: candidate.profileUrl,
        commentTime: candidate.commentTime,
        videoTitle: candidate.videoTitle,
        videoUrl: candidate.videoUrl,
        engagementScore: candidate.engagementScore,
        likeCount: candidate.likeCount,
        commentCount: candidate.commentCount,
        shareCount: candidate.shareCount,
        score: candidate.score,
        reason: candidate.reason,
      }));

    return {
      sourceLabel,
      sourceText,
      accountName,
      dailyLimit,
      privateMessage,
      commentTemplates,
      messageTemplates,
      filters: filterConfig,
      targets,
      skipped,
      summary: {
        totalCandidates: candidates.length,
        selectedCount: targets.length,
        skippedCount: skipped.length,
        commentTaskCount: targets.filter((target) => target.commentTaskEnabled)
          .length,
        messageTaskCount: targets.filter((target) => target.messageTaskEnabled)
          .length,
        commentTemplateCount: commentTemplates.length,
        messageTemplateCount: messageTemplates.length,
        nextAction: targets.length
          ? `已筛出 ${targets.length} 条高意向线索，可自动创建 ${targets.reduce(
              (total, target) => total + target.followUpActions.length,
              0,
            )} 个可达跟进任务。`
          : '本次候选评论没有达到跟进条件。',
      },
    };
  }

  async executeDouyinFollowUp(input: DouyinFollowUpExecuteInput) {
    return this.executeDouyinFollowUpCore(input, { billingCovered: false });
  }

  private async executeDouyinFollowUpCore(
    input: DouyinFollowUpExecuteInput,
    options: { billingCovered: boolean },
  ) {
    const accountId = this.readOptionalText(input.accountId);
    if (!accountId) {
      throw new BadRequestException('请选择抖音账号');
    }
    const targets = Array.isArray(input.targets) ? input.targets : [];
    if (!targets.length) {
      throw new BadRequestException('没有可执行的评论区线索');
    }
    const maxTargets = Math.min(
      this.normalizeFollowUpLimit(input.maxTargets || targets.length * 2),
      targets.length * 2,
    );
    const executableTargets = this.diversifyByVideo(targets);
    const executableActions = executableTargets
      .flatMap((target) => {
        const actions: Array<{
          target: (typeof targets)[number];
          action: DouyinFollowUpAction;
          replyText: string;
        }> = [];
        const targetText = this.readOptionalText(target.text);
        const commentReplyText = this.readOptionalText(target.commentReplyText);
        if (
          target.commentTaskEnabled !== false &&
          targetText &&
          commentReplyText &&
          (!this.isPublicDouyinCommentTarget(target) ||
            this.isDouyinVideoDirectCommentTarget(target) ||
            Boolean(this.readOptionalText(target.targetName)))
        ) {
          actions.push({
            target,
            action: 'comment',
            replyText: commentReplyText,
          });
        }
        const directMessageText = this.readOptionalText(
          target.directMessageText,
        );
        if (
          target.messageTaskEnabled === true &&
          targetText &&
          directMessageText &&
          this.canCreateDouyinMessageTask(target)
        ) {
          actions.push({
            target,
            action: 'message',
            replyText: directMessageText,
          });
        }
        return actions;
      })
      .slice(0, maxTargets);

    if (!executableActions.length) {
      throw new BadRequestException('没有可执行的评论或私信跟进任务');
    }

    const startedAt = Date.now();
    let billingReservation: AutoAcquisitionBillingRecord | undefined;
    if (!options.billingCovered) {
      billingReservation = await this.reserveRuntimeAutomationCredits({
        idempotencyKey: `ai-content:douyin-follow-up:${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`,
        mode: 'douyin_follow_up',
        taskType: 'douyin_follow_up',
        estimatedActions: executableActions.length,
        estimatedRuntimeMinutes: 10,
        metadata: {
          accountId,
          totalTargets: targets.length,
          selectedCount: executableTargets.length,
          selectedActionCount: executableActions.length,
          sendMode: input.autoSend === false ? 'draft-only' : 'auto-send',
        },
      });
    }

    const results: Array<{
      index: number;
      action: DouyinFollowUpAction;
      targetName?: string;
      targetText?: string;
      replyText?: string;
      ok: boolean;
      status: RuntimeExecutionResult['status'];
      reasonCode: RuntimeExecutionResult['reasonCode'];
      message: string;
      evidence: Array<{
        type: string;
        label: string;
        url?: string;
        path?: string;
        createdAt: string;
        raw?: Record<string, unknown>;
      }>;
      readback?: RuntimeExecutionResult['readback'];
    }> = [];

    try {
      for (const [targetIndex, executable] of executableActions.entries()) {
        const { target, action, replyText } = executable;
        const task: ExecutorTask = {
          relatedId: `douyin-auto-acquisition-${Date.now()}-${targetIndex}`,
          relatedType: 'agent-session',
          type:
            action === 'message'
              ? 'douyin-direct-message-reply'
              : 'douyin-comment-reply',
          platform: 'douyin',
          accountId,
          payload: {
            aiEmployeeCapability:
              input.sourceCapability || 'douyin-hot-video-exposure',
            aiEmployeeDomain: 'douyin-acquisition',
            followUpAction: action,
            targetName: this.readOptionalText(target.targetName),
            targetText: this.readOptionalText(target.text),
            sourceText:
              this.readOptionalText(target.sourceText) ||
              this.readOptionalText(target.text),
            sourceUrl: this.readOptionalText(target.sourceUrl),
            profileUrl: this.readOptionalText(target.profileUrl),
            commentMode:
              action === 'comment'
                ? this.isDouyinVideoDirectCommentTarget(target)
                  ? 'video-comment'
                  : target.commentMode
                : undefined,
            commentTime: this.readOptionalText(target.commentTime),
            videoTitle: this.readOptionalText(target.videoTitle),
            videoUrl: this.readOptionalText(target.videoUrl),
            engagementScore: target.engagementScore,
            replyText,
          },
        };
        const result = await this.runtime.execute(task, {
          riskContext: {
            accountName: `douyin:${accountId}`,
          },
          sendMode: input.autoSend === false ? 'draft-only' : 'auto-send',
          billing: {
            covered: true,
            scope: options.billingCovered
              ? 'auto_acquisition_batch'
              : 'douyin_follow_up_batch',
          },
        });
        const completion = evaluateRuntimeCompletion(result, {
          requireReadback: input.autoSend !== false,
        });
        results.push({
          index: target.index ?? targetIndex,
          action,
          targetName: target.targetName,
          targetText: target.text,
          replyText,
          ok: completion.complete,
          status: completion.complete
            ? 'success'
            : result.status === 'blocked'
              ? 'blocked'
              : 'failed',
          reasonCode: completion.reasonCode,
          message: completion.message,
          evidence: result.evidence.map((item) => ({
            type: item.type,
            label: item.label,
            url: item.value,
            path: item.path,
            createdAt: item.createdAt,
            raw: item.raw,
          })),
          readback: result.readback,
        });
      }
    } catch (error) {
      if (billingReservation?.reservationId) {
        await this.releaseAutoAcquisitionCredits(
          billingReservation,
          `抖音跟进执行失败：${error instanceof Error ? error.message : String(error)}`,
        ).catch((releaseError) => {
          this.logger.warn(
            `Douyin follow-up billing reservation release failed: ${
              releaseError instanceof Error
                ? releaseError.message
                : String(releaseError)
            }`,
          );
        });
      }
      throw error;
    }

    const successCount = results.filter((item) => item.ok).length;
    const failedCount = results.length - successCount;
    const commentActionCount = results.filter(
      (item) => item.action === 'comment',
    ).length;
    const messageActionCount = results.length - commentActionCount;
    const actionLabel = messageActionCount
      ? commentActionCount
        ? '评论或私信跟进'
        : '私信跟进'
      : '评论回复';
    const execution = {
      ok: failedCount === 0,
      status:
        failedCount === 0 ? 'success' : successCount > 0 ? 'partial' : 'failed',
      message:
        failedCount === 0
          ? `已自动执行 ${successCount} 条${actionLabel}`
          : `已执行 ${results.length} 条${actionLabel}，成功 ${successCount} 条，失败 ${failedCount} 条`,
      summary: {
        totalTargets: targets.length,
        attemptedCount: results.length,
        successCount,
        failedCount,
        sendMode: input.autoSend === false ? 'draft-only' : 'auto-send',
        videoCount: new Set(
          executableActions
            .map((item) => this.videoBucketKey(item.target))
            .filter(Boolean),
        ).size,
      },
      results,
    };
    if (!billingReservation?.reservationId) return execution;

    const evidenceCount = new Set(
      results.flatMap((item) =>
        item.evidence
          .map((evidence) => evidence.url || evidence.path)
          .filter(Boolean),
      ),
    ).size;
    const billing = await this.captureRuntimeAutomationCredits(
      billingReservation,
      {
        mode: 'douyin_follow_up',
        taskType: 'douyin_follow_up',
        runtimeMinutes: Math.max(
          1,
          Math.ceil((Date.now() - startedAt) / 60_000),
        ),
        replies: successCount,
        platformActions: results.length,
        leads: 0,
        evidences: evidenceCount,
        metadata: {
          accountId,
          totalTargets: targets.length,
          attemptedCount: results.length,
          successCount,
          failedCount,
          sendMode: execution.summary.sendMode,
        },
      },
    );
    return {
      ...execution,
      billing,
    };
  }

  private canCreateDouyinMessageTask(candidate: {
    kind?: string;
    text?: string;
    sourceUrl?: string;
    targetName?: string;
    profileUrl?: string;
  }) {
    const kind = this.readOptionalText(candidate.kind).toLowerCase();
    if (
      kind === 'retention-contact' &&
      this.readOptionalText(candidate.targetName) &&
      /douyin\.com\/(?:user|share\/user)\//i.test(
        this.readOptionalText(candidate.profileUrl),
      )
    ) {
      return true;
    }
    if (/message|private|dm|私信|会话/.test(kind)) return true;
    const sourceUrl = this.readOptionalText(candidate.sourceUrl);
    return /creator\.douyin\.com\/.*(?:chat|message|im|private)/i.test(
      sourceUrl,
    );
  }

  private isPublicDouyinCommentTarget(candidate: {
    kind?: string;
    sourceUrl?: string;
    videoUrl?: string;
  }) {
    if (this.isDouyinVideoDirectCommentTarget(candidate)) return false;
    const kind = this.readOptionalText(candidate.kind).toLowerCase();
    const url = `${this.readOptionalText(candidate.videoUrl)} ${this.readOptionalText(candidate.sourceUrl)}`;
    return (
      /hot-video-comment|comment/.test(kind) &&
      /douyin\.com\/video\//i.test(url)
    );
  }

  private isDouyinVideoDirectCommentTarget(candidate: {
    kind?: string;
    commentMode?: string;
  }) {
    const kind = this.readOptionalText(candidate.kind).toLowerCase();
    const commentMode = this.readOptionalText(
      candidate.commentMode,
    ).toLowerCase();
    return (
      commentMode === 'video-comment' ||
      /direct-comment|video-comment|视频直评|直评/.test(kind)
    );
  }

  private isDouyinSearchAccountCandidate(candidate: {
    kind?: string;
    targetName?: string;
    profileUrl?: string;
    sourceUrl?: string;
  }) {
    const kind = this.readOptionalText(candidate.kind).toLowerCase();
    if (!/(search|account|账号|user|profile)/.test(kind)) return false;
    if (this.readOptionalText(candidate.targetName)) return true;
    const profileUrl = this.readOptionalText(candidate.profileUrl);
    const sourceUrl = this.readOptionalText(candidate.sourceUrl);
    return /douyin\.com\/(?:user|search)/i.test(profileUrl || sourceUrl);
  }

  async clipVideoWithTemplate(input: VideoTemplateClipInput) {
    if (!this.videoWorkshop) {
      throw new BadRequestException('视频工坊执行器未初始化');
    }
    return this.videoWorkshop.clipWithTemplate({
      ...input,
      source: 'ai-employee',
    });
  }

  checkP1ClosureReadiness(input: P1ClosureReadinessInput) {
    const followUpDailyLimit = this.readPositiveInteger(input.dailyLimit, 20);
    const publishDailyLimit = this.readPositiveInteger(
      input.publishDailyLimit,
      20,
    );
    const publishDailyTimes = this.normalizeDailyTimes(input.publishDailyTimes);
    const candidateCount = this.readNonNegativeInteger(input.candidateCount);
    const followUpTaskCount = this.readNonNegativeInteger(
      input.followUpTaskCount,
    );
    const followUpCompletedCount = this.readNonNegativeInteger(
      input.followUpCompletedCount,
    );
    const followUpEvidenceCount = this.readNonNegativeInteger(
      input.followUpEvidenceCount,
    );
    const followUpFailedCount = this.readNonNegativeInteger(
      input.followUpFailedCount,
    );
    const commentTemplateCount = this.readNonNegativeInteger(
      input.commentTemplateCount,
    );
    const messageTemplateCount = this.readNonNegativeInteger(
      input.messageTemplateCount,
    );
    const evidenceCount = this.readNonNegativeInteger(input.evidenceCount);
    const publishAccountCount = this.readNonNegativeInteger(
      input.publishAccountCount,
    );
    const publishResultCount = this.readNonNegativeInteger(
      input.publishResultCount,
    );
    const publishSuccessCount = this.readNonNegativeInteger(
      input.publishSuccessCount,
    );
    const publishFailedCount = this.readNonNegativeInteger(
      input.publishFailedCount,
    );
    const publishPendingCount = this.readNonNegativeInteger(
      input.publishPendingCount,
    );
    const steps = [
      this.readinessStep({
        key: 'douyin-account',
        name: '抖音账号',
        ok: Boolean(this.readOptionalText(input.douyinAccountId)),
        message:
          this.readOptionalText(input.douyinAccountName) || '未选择抖音账号',
        nextAction: '先在账号管理里登录一个抖音账号。',
      }),
      this.readinessStep({
        key: 'lead-source',
        name: '线索来源',
        ok: Boolean(this.readOptionalText(input.sourceText)),
        message:
          this.readOptionalText(input.sourceText) ||
          '未填写链接、关键词或线索来源',
        nextAction: '填写抖音视频链接、行业关键词或目标线索。',
      }),
      this.readinessStep({
        key: 'candidate-read',
        name: '候选评论',
        ok: candidateCount > 0,
        message:
          candidateCount > 0
            ? `已读取 ${candidateCount} 条候选内容`
            : '还没有读取到候选评论',
        nextAction: '先执行一次曝光读取，拿到真实评论或搜索结果。',
      }),
      this.readinessStep({
        key: 'follow-up-task',
        name: '跟进任务',
        ok:
          followUpTaskCount > 0 &&
          followUpCompletedCount >= followUpTaskCount &&
          followUpEvidenceCount >= followUpTaskCount &&
          followUpFailedCount === 0,
        message:
          followUpTaskCount > 0
            ? `已创建 ${followUpTaskCount} 条跟进任务，完成 ${followUpCompletedCount} 条，证据 ${followUpEvidenceCount} 条，失败 ${followUpFailedCount} 条`
            : '还没有创建评论或私信跟进任务',
        nextAction:
          '先执行评论或私信跟进任务，并确认任务完成、留下证据，且没有失败任务。',
      }),
      this.readinessStep({
        key: 'copy-pool',
        name: '评论和私信文案',
        ok:
          commentTemplateCount > 0 &&
          messageTemplateCount > 0 &&
          Boolean(this.readOptionalText(input.privateMessage)),
        message: `评论文案 ${commentTemplateCount} 条，私信文案 ${messageTemplateCount} 条`,
        nextAction: '补齐评论文案池、私信文案池和私信内容。',
      }),
      this.readinessStep({
        key: 'follow-up-limit',
        name: '每日上限',
        ok: Boolean(followUpDailyLimit),
        message: followUpDailyLimit
          ? `每日最多 ${followUpDailyLimit} 条`
          : '每日上限未设置或格式不正确',
        nextAction: '设置每天次数限制。',
      }),
      this.readinessStep({
        key: 'evidence-log',
        name: '执行证据',
        ok: evidenceCount > 0,
        message:
          evidenceCount > 0
            ? `已有 ${evidenceCount} 条截图或任务证据`
            : '还没有截图或任务证据',
        nextAction: '先跑一次真实读取或跟进任务，留下截图、失败码或任务证据。',
      }),
      this.readinessStep({
        key: 'publish-account',
        name: '发布账号',
        ok: publishAccountCount > 0,
        message:
          publishAccountCount > 0
            ? `已选择 ${publishAccountCount} 个抖音或小红书账号`
            : '未选择发布账号',
        nextAction: '至少选择一个抖音或小红书发布账号。',
      }),
      this.readinessStep({
        key: 'publish-content',
        name: '发布内容',
        ok:
          Boolean(this.readOptionalText(input.publishMaterialPath)) &&
          Boolean(this.readOptionalText(input.publishTitle)) &&
          Boolean(this.readOptionalText(input.publishCopy)),
        message:
          this.readOptionalText(input.publishTitle) ||
          this.readOptionalText(input.publishMaterialPath) ||
          '发布素材和标题正文未准备',
        nextAction: '填写发布素材、标题和正文。',
      }),
      this.readinessStep({
        key: 'publish-schedule',
        name: '发布时间',
        ok: Boolean(publishDailyLimit) && publishDailyTimes.length > 0,
        message:
          publishDailyLimit && publishDailyTimes.length > 0
            ? `每日 ${publishDailyLimit} 条，${publishDailyTimes.join('、')}`
            : '发布时间未设置或格式不正确',
        nextAction: '设置每日发布数和发布时间。',
      }),
      this.readinessStep({
        key: 'publish-preflight',
        name: '发布前检查',
        ok: input.publishPreflightOk === true,
        message:
          this.readOptionalText(input.publishPreflightSummary) ||
          '还没有通过发布前检查',
        nextAction: '先点击发布前检查，确认账号、素材和发布时间都可用。',
      }),
      this.readinessStep({
        key: 'publish-result',
        name: '发布任务',
        ok:
          publishResultCount > 0 &&
          publishResultCount >= publishAccountCount &&
          publishSuccessCount >= publishResultCount &&
          publishSuccessCount >= publishAccountCount &&
          publishFailedCount === 0 &&
          publishPendingCount === 0,
        message:
          publishResultCount > 0
            ? `已选择 ${publishAccountCount} 个发布账号，已创建 ${publishResultCount} 个平台发布结果，成功 ${publishSuccessCount} 个，待回执 ${publishPendingCount} 个，失败 ${publishFailedCount} 个`
            : '还没有创建发布任务',
        nextAction:
          '点击创建发布任务，并核对所有平台都有真实成功结果，没有待回执或失败。',
      }),
    ];
    const blockers = steps.filter((step) => step.status === 'blocked');
    const checkedAt = new Date().toISOString();
    return {
      ok: blockers.length === 0,
      status: blockers.length === 0 ? 'ready' : 'blocked',
      checkedAt,
      summary:
        blockers.length === 0
          ? '抖音获客和发布任务已经准备好。'
          : `还有 ${blockers.length} 项没有准备好。`,
      nextAction:
        blockers[0]?.nextAction ||
        '用真实抖音账号跑：导入链接 -> 筛评论 -> 生成文案 -> 确认后填入评论/私信草稿 -> 记录证据。',
      acceptanceFlow: [
        '导入抖音链接或爆款关键词',
        '读取真实评论或搜索结果',
        '筛选高意向候选客户',
        '生成评论和私信文案',
        '创建评论和私信草稿任务',
        '记录截图、失败码和证据',
        '用抖音或小红书账号创建发布任务',
      ],
      blockers: blockers.map((step) => ({
        key: step.key,
        name: step.name,
        message: step.message,
        nextAction: step.nextAction,
      })),
      steps,
    };
  }

  checkP2WechatReadiness(input: P2WechatReadinessInput) {
    const latestMessageCount = this.readNonNegativeInteger(
      input.latestMessageCount,
    );
    const replyTaskCount = this.readNonNegativeInteger(input.replyTaskCount);
    const replyCompletedCount = this.readNonNegativeInteger(
      input.replyCompletedCount,
    );
    const groupTargetCount = this.readNonNegativeInteger(
      input.groupTargetCount,
    );
    const groupTagCount = this.readNonNegativeInteger(input.groupTagCount);
    const groupDailyLimit = this.readPositiveInteger(
      input.groupDailyLimit,
      200,
    );
    const groupIntervalSeconds = this.readNonNegativeIntegerOption(
      input.groupIntervalSeconds,
      3600,
    );
    const groupTaskCount = this.readNonNegativeInteger(input.groupTaskCount);
    const groupPausedCount = this.readNonNegativeInteger(
      input.groupPausedCount,
    );
    const groupResumableCount = this.readNonNegativeInteger(
      input.groupResumableCount,
    );
    const groupCompletedCount = this.readNonNegativeInteger(
      input.groupCompletedCount,
    );
    const groupFailedCount = this.readNonNegativeInteger(
      input.groupFailedCount,
    );
    const contactTaskCount = this.readNonNegativeInteger(
      input.contactTaskCount,
    );
    const contactCompletedCount = this.readNonNegativeInteger(
      input.contactCompletedCount,
    );
    const contactTargetCount = this.readNonNegativeInteger(
      input.contactTargetCount,
    );
    const contactDailyLimit = this.readPositiveInteger(
      input.contactDailyLimit,
      50,
    );
    const contactFailedCount = this.readNonNegativeInteger(
      input.contactFailedCount,
    );
    const momentsPublishTaskCount = this.readNonNegativeInteger(
      input.momentsPublishTaskCount,
    );
    const momentsPublishCompletedCount = this.readNonNegativeInteger(
      input.momentsPublishCompletedCount,
    );
    const momentsPublishFailedCount = this.readNonNegativeInteger(
      input.momentsPublishFailedCount,
    );
    const momentsPublishRemainingCount = this.readNonNegativeInteger(
      input.momentsPublishRemainingCount,
    );
    const momentsMarketingTaskCount = this.readNonNegativeInteger(
      input.momentsMarketingTaskCount,
    );
    const momentsMarketingCompletedCount = this.readNonNegativeInteger(
      input.momentsMarketingCompletedCount,
    );
    const momentsMarketingFailedCount = this.readNonNegativeInteger(
      input.momentsMarketingFailedCount,
    );
    const momentsMarketingRemainingCount = this.readNonNegativeInteger(
      input.momentsMarketingRemainingCount,
    );
    const momentsMarketingDailyLimit = this.readPositiveInteger(
      input.momentsMarketingDailyLimit,
      200,
    );
    const videoClipTaskCount = this.readNonNegativeInteger(
      input.videoClipTaskCount,
    );
    const videoClipCompletedCount = this.readNonNegativeInteger(
      input.videoClipCompletedCount,
    );
    const videoClipFailedCount = this.readNonNegativeInteger(
      input.videoClipFailedCount,
    );
    const publishAccountCount = this.readNonNegativeInteger(
      input.publishAccountCount,
    );
    const publishResultCount = this.readNonNegativeInteger(
      input.publishResultCount,
    );
    const publishSuccessCount = this.readNonNegativeInteger(
      input.publishSuccessCount,
    );
    const publishFailedCount = this.readNonNegativeInteger(
      input.publishFailedCount,
    );
    const publishPendingCount = this.readNonNegativeInteger(
      input.publishPendingCount,
    );
    const evidenceCount = this.readNonNegativeInteger(input.evidenceCount);
    const steps = [
      this.readinessStep({
        key: 'wechat-desktop',
        name: '桌面微信',
        ok: input.desktopOnline === true && input.agentConnected === true,
        message:
          input.desktopOnline === true && input.agentConnected === true
            ? '本机微信和桌面助手已连接'
            : '本机微信或桌面助手未就绪',
        nextAction: '打开本机微信并启动桌面助手，再读取当前会话。',
      }),
      this.readinessStep({
        key: 'wechat-session',
        name: '会话读取',
        ok:
          input.sessionReadable === true &&
          input.sessionConfirmed === true &&
          Boolean(this.readOptionalText(input.contactName)),
        message:
          input.sessionReadable === true
            ? `已读取并确认会话：${this.readOptionalText(input.contactName) || '未填写联系人'}`
            : '还没有读取并确认微信会话',
        nextAction: '读取当前微信窗口，确认联系人和输入框，再锁定会话。',
      }),
      this.readinessStep({
        key: 'latest-message',
        name: '聊天记录',
        ok: latestMessageCount > 0,
        message:
          latestMessageCount > 0
            ? `已读取 ${latestMessageCount} 条最近消息`
            : this.readOptionalText(input.replyText)
              ? '已填写回复内容，但还没有聊天记录'
              : '还没有聊天记录或回复内容',
        nextAction: '读取或粘贴最近聊天记录，再生成回复内容。',
      }),
      this.readinessStep({
        key: 'reply-task',
        name: '客服回复',
        ok:
          Boolean(this.readOptionalText(input.replyText)) &&
          replyTaskCount > 0 &&
          replyCompletedCount >= replyTaskCount,
        message:
          replyTaskCount > 0
            ? `已创建 ${replyTaskCount} 条回复任务，完成 ${replyCompletedCount} 条`
            : '还没有创建微信回复任务',
        nextAction: '生成微信回复任务，确认对象和内容后填入草稿或完成发送。',
      }),
      this.readinessStep({
        key: 'group-plan',
        name: '群发计划',
        ok:
          groupTargetCount > 0 &&
          Boolean(this.readOptionalText(input.groupMessage)) &&
          groupTaskCount > 0 &&
          groupTagCount > 0 &&
          Boolean(groupDailyLimit) &&
          groupIntervalSeconds !== undefined,
        message:
          groupTaskCount > 0
            ? `已创建 ${groupTaskCount} 条群发任务，目标 ${groupTargetCount} 个，标签 ${groupTagCount} 个，每日 ${groupDailyLimit || 0} 条，间隔 ${groupIntervalSeconds || 0} 秒`
            : '还没有创建群发任务',
        nextAction:
          '填写群发对象、客户标签、群发文案、每天上限和每次间隔，创建群发任务。',
      }),
      this.readinessStep({
        key: 'group-control',
        name: '群发控制',
        ok:
          groupTaskCount > 0 &&
          groupCompletedCount > 0 &&
          groupFailedCount === 0 &&
          groupCompletedCount + groupPausedCount + groupResumableCount >=
            groupTaskCount,
        message:
          groupTaskCount > 0
            ? `完成 ${groupCompletedCount} 条，暂停 ${groupPausedCount} 条，可恢复 ${groupResumableCount} 条，失败 ${groupFailedCount} 条`
            : '还没有可追踪的群发控制记录',
        nextAction: '确认群发任务可暂停、可恢复，失败任务不能被算作完成。',
      }),
      this.readinessStep({
        key: 'contact-plan',
        name: '加好友计划',
        ok:
          contactTargetCount > 0 &&
          contactTaskCount > 0 &&
          contactCompletedCount > 0 &&
          Boolean(contactDailyLimit) &&
          contactFailedCount === 0,
        message:
          contactTaskCount > 0
            ? `已创建 ${contactTaskCount} 条加好友任务，完成 ${contactCompletedCount} 条，目标 ${contactTargetCount} 个，每日上限 ${contactDailyLimit || 0}，失败 ${contactFailedCount} 条`
            : '还没有创建加好友计划',
        nextAction: '填写目标列表、验证消息和每日上限，创建小流量加好友计划。',
      }),
      this.readinessStep({
        key: 'moments-publish',
        name: '朋友圈发布',
        ok:
          momentsPublishTaskCount > 0 &&
          momentsPublishCompletedCount > 0 &&
          momentsPublishFailedCount === 0,
        message:
          momentsPublishTaskCount > 0
            ? `已创建 ${momentsPublishTaskCount} 条朋友圈发布计划，完成 ${momentsPublishCompletedCount} 条，待继续 ${momentsPublishRemainingCount} 条，失败 ${momentsPublishFailedCount} 条`
            : '还没有创建朋友圈发布计划',
        nextAction:
          '填写朋友圈文案、媒体文件、每日发布数和时间，创建朋友圈发布计划。',
      }),
      this.readinessStep({
        key: 'moments-marketing',
        name: '朋友圈营销',
        ok:
          momentsMarketingTaskCount > 0 &&
          momentsMarketingCompletedCount > 0 &&
          Boolean(momentsMarketingDailyLimit) &&
          momentsMarketingFailedCount === 0,
        message:
          momentsMarketingTaskCount > 0
            ? `已创建 ${momentsMarketingTaskCount} 条朋友圈营销计划，完成 ${momentsMarketingCompletedCount} 条，待继续 ${momentsMarketingRemainingCount} 条，失败 ${momentsMarketingFailedCount} 条`
            : '还没有创建朋友圈营销计划',
        nextAction:
          '选择随机或定向营销，设置每日查看条数，创建朋友圈营销计划。',
      }),
      this.readinessStep({
        key: 'video-clip',
        name: '视频剪辑',
        ok:
          videoClipTaskCount > 0 &&
          videoClipCompletedCount > 0 &&
          videoClipFailedCount === 0 &&
          Boolean(
            this.readOptionalText(input.videoOutputPath) ||
            this.readOptionalText(input.publishMaterialPath),
          ),
        message:
          videoClipTaskCount > 0
            ? `已创建 ${videoClipTaskCount} 条剪辑任务，完成 ${videoClipCompletedCount} 条，失败 ${videoClipFailedCount} 条`
            : '还没有创建剪辑任务',
        nextAction: '选择素材和模板生成视频，剪辑结果要自动带入聚合发布。',
      }),
      this.readinessStep({
        key: 'aggregate-publish',
        name: '聚合发布',
        ok:
          input.publishPreflightOk === true &&
          publishAccountCount > 0 &&
          publishResultCount > 0 &&
          publishResultCount >= publishAccountCount &&
          publishSuccessCount >= publishResultCount &&
          publishFailedCount === 0 &&
          publishPendingCount === 0,
        message:
          publishResultCount > 0
            ? `已选择 ${publishAccountCount} 个发布账号，已创建 ${publishResultCount} 条发布结果，成功 ${publishSuccessCount} 条，待回执 ${publishPendingCount} 条，失败 ${publishFailedCount} 条`
            : this.readOptionalText(input.publishTitle) ||
                this.readOptionalText(input.publishMaterialPath)
              ? '发布内容已填写，还没有完成发布前检查和发布结果'
              : '还没有创建聚合发布任务',
        nextAction:
          '选择平台账号，填写素材、标题、正文和发布时间，先做发布前检查，再创建发布任务。',
      }),
      this.readinessStep({
        key: 'wechat-evidence',
        name: '执行记录',
        ok: evidenceCount > 0,
        message:
          evidenceCount > 0
            ? `已有 ${evidenceCount} 条执行记录或截图`
            : '还没有截图或任务记录',
        nextAction:
          '执行微信、朋友圈、剪辑或发布任务后，保留截图、失败原因和结果记录。',
      }),
    ];
    const blockers = steps.filter((step) => step.status === 'blocked');
    const checkedAt = new Date().toISOString();
    return {
      ok: blockers.length === 0,
      status: blockers.length === 0 ? 'ready' : 'blocked',
      checkedAt,
      summary:
        blockers.length === 0
          ? '微信、朋友圈、剪辑和发布链路已经准备好。'
          : `还有 ${blockers.length} 项没有准备好。`,
      nextAction:
        blockers[0]?.nextAction ||
        '用常用账号跑：读取会话 -> 生成回复 -> 群发/加好友 -> 朋友圈 -> 视频剪辑 -> 聚合发布 -> 留记录。',
      acceptanceFlow: [
        '读取桌面微信登录和当前窗口',
        '确认联系人、会话和输入框',
        '读取最近聊天记录',
        '生成客服回复并确认后填入草稿',
        '创建群发计划并执行小批量发送',
        '暂停、恢复或重试群发任务',
        '创建加好友计划并按每日上限执行',
        '创建朋友圈发布和朋友圈营销计划',
        '生成视频剪辑结果并带入聚合发布',
        '完成发布前检查和聚合发布',
        '记录截图、失败原因和结果导出',
      ],
      blockers: blockers.map((step) => ({
        key: step.key,
        name: step.name,
        message: step.message,
        nextAction: step.nextAction,
      })),
      steps,
    };
  }

  private buildContext(
    accountName: string,
    sendMode: ExecutorContext['sendMode'] = 'draft-only',
  ): ExecutorContext {
    return {
      riskContext: {
        accountName,
      },
      sendMode,
    };
  }

  private toResponse(result: RuntimeExecutionResult) {
    const candidates = this.parseCandidates(result.readback?.actualText);
    const raw = result.evidence.find((item) => item.raw)?.raw;
    const completion = evaluateRuntimeCompletion(result, {
      requireReadback: true,
      ignoredEvidenceLabels: ['douyin-exposure-runtime-contract'],
    });
    return {
      ok: completion.complete,
      status: completion.complete
        ? 'success'
        : result.status === 'blocked'
          ? 'blocked'
          : 'failed',
      reasonCode: completion.reasonCode,
      message: completion.message,
      detail: result.technicalMessage,
      executionKind: 'candidate_read' as const,
      platformAction: false as const,
      candidates,
      evidence: result.evidence.map((item) => ({
        type: item.type,
        label: item.label,
        url: item.value,
        path: item.path,
        createdAt: item.createdAt,
        raw: item.raw,
      })),
      raw,
    };
  }

  private notIntegratedResult(
    userMessage: string,
    technicalMessage: string,
  ): RuntimeExecutionResult {
    return {
      ok: false,
      status: 'blocked',
      reasonCode: 'not_integrated',
      userMessage,
      technicalMessage,
      runtime: {
        mode: 'local-runtime',
        executor: 'browser-cdp',
      },
      evidence: [],
    };
  }

  private parseCandidates(value?: string) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => ({
            text: String(item?.text || '').trim(),
            sourceUrl: String(item?.sourceUrl || ''),
            kind: String(item?.kind || ''),
            commentMode:
              item?.commentMode === 'video-comment'
                ? ('video-comment' as const)
                : undefined,
            index: this.readNonNegativeInteger(item?.index),
            targetName: String(item?.targetName || ''),
            profileUrl: String(item?.profileUrl || ''),
            commentTime: String(item?.commentTime || ''),
            videoTitle: String(item?.videoTitle || ''),
            videoUrl: String(item?.videoUrl || ''),
            engagementScore: this.readNonNegativeInteger(item?.engagementScore),
            likeCount: this.readNonNegativeInteger(item?.likeCount),
            commentCount: this.readNonNegativeInteger(item?.commentCount),
            shareCount: this.readNonNegativeInteger(item?.shareCount),
            score: this.readNonNegativeInteger(item?.score),
            reason: String(item?.reason || ''),
          }))
          .filter((item) => item.text.length > 0);
      }
    } catch {
      return [];
    }
    return [];
  }

  private requireText(value: unknown, message: string) {
    const text = safeText(value || '').trim();
    if (!text) {
      throw new BadRequestException(message);
    }
    return text;
  }

  private readOptionalText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private normalizeTextList(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  private normalizeLimit(value: unknown) {
    const limit = Number(value || 20);
    if (!Number.isFinite(limit)) return 20;
    return Math.min(Math.max(Math.floor(limit), 1), 50);
  }

  private normalizeCommentTimeMatch(value: unknown) {
    const text = this.readOptionalText(value);
    if (['today', 'yesterday', '7days', '30days', 'none'].includes(text))
      return text;
    return '7days';
  }

  private normalizeFollowUpLimit(value: unknown) {
    const limit = Number(value || 3);
    if (!Number.isFinite(limit)) return 3;
    return Math.min(Math.max(Math.floor(limit), 1), 20);
  }

  private readPositiveInteger(value: unknown, max: number) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    const integer = Math.floor(numeric);
    if (integer <= 0 || integer !== numeric) return undefined;
    return Math.min(integer, max);
  }

  private readNonNegativeIntegerOption(value: unknown, max: number) {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    const integer = Math.floor(numeric);
    if (integer < 0 || integer !== numeric) return undefined;
    return Math.min(integer, max);
  }

  private readNonNegativeInteger(value: unknown) {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
  }

  private normalizeDailyTimes(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.readOptionalText(item))
      .map((item) => this.normalizeDailyTime(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 6);
  }

  private normalizeDailyTime(value: string) {
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private normalizePrivateMessage(value: unknown) {
    const text = this.readOptionalText(value);
    return (
      text ||
      '你好，我看了你的评论，感觉你可能正在了解相关方案。我这边可以先发你一份资料，方便的话我们详细沟通。'
    );
  }

  private readinessStep(input: {
    key: string;
    name: string;
    ok: boolean;
    message: string;
    nextAction: string;
  }) {
    return {
      key: input.key,
      name: input.name,
      status: input.ok ? ('ready' as const) : ('blocked' as const),
      message: input.message,
      nextAction: input.ok ? '已准备' : input.nextAction,
    };
  }

  private normalizeFollowUpCandidates(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item, index) => ({
        text: String(item?.text || '').trim(),
        sourceUrl: String(item?.sourceUrl || '').trim(),
        kind: String(item?.kind || 'comment').trim(),
        commentMode:
          item?.commentMode === 'video-comment'
            ? ('video-comment' as const)
            : undefined,
        index: Number.isFinite(Number(item?.index))
          ? Number(item?.index)
          : index,
        targetName: this.readOptionalText(item?.targetName),
        profileUrl: this.readOptionalText(item?.profileUrl),
        commentTime: this.readOptionalText(item?.commentTime),
        videoTitle: this.readOptionalText(item?.videoTitle),
        videoUrl: this.readOptionalText(item?.videoUrl),
        engagementScore: this.readOptionalNumber(item?.engagementScore),
        likeCount: this.readOptionalNumber(item?.likeCount),
        commentCount: this.readOptionalNumber(item?.commentCount),
        shareCount: this.readOptionalNumber(item?.shareCount),
        score: this.readOptionalNumber(item?.score),
        reason: this.readOptionalText(item?.reason),
      }))
      .filter((item) => item.text.length > 0)
      .slice(0, 100);
  }

  private dedupeScoredCandidates(
    candidates: Array<ReturnType<typeof this.scoreDouyinCandidate>>,
  ) {
    const seen = new Set<string>();
    const result: Array<ReturnType<typeof this.scoreDouyinCandidate>> = [];
    for (const candidate of candidates) {
      const key = [
        this.videoBucketKey(candidate),
        candidate.targetName,
        candidate.profileUrl,
        candidate.text,
      ]
        .map((item) =>
          String(item || '')
            .replace(/\s+/g, '')
            .toLowerCase(),
        )
        .filter(Boolean)
        .join('|');
      if (seen.has(key)) {
        result.push({
          ...candidate,
          skipped: true,
          reason: '重复评论，已跳过。',
        });
        continue;
      }
      seen.add(key);
      result.push(candidate);
    }
    return result;
  }

  private diversifyByVideo<
    T extends {
      videoUrl?: string;
      sourceUrl?: string;
      index?: number;
    },
  >(items: T[]) {
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key =
        this.videoBucketKey(item) || `unknown:${item.index ?? groups.size}`;
      const group = groups.get(key);
      if (group) {
        group.push(item);
      } else {
        groups.set(key, [item]);
      }
    }
    const buckets = Array.from(groups.values());
    const result: T[] = [];
    let cursor = 0;
    while (result.length < items.length) {
      let picked = false;
      for (const bucket of buckets) {
        const item = bucket[cursor];
        if (!item) continue;
        result.push(item);
        picked = true;
      }
      if (!picked) break;
      cursor += 1;
    }
    return result;
  }

  private videoBucketKey(value: { videoUrl?: string; sourceUrl?: string }) {
    const raw =
      this.readOptionalText(value.videoUrl) ||
      this.readOptionalText(value.sourceUrl);
    if (!raw) return '';
    const match = raw.match(/douyin\.com\/video\/(\d+)/i);
    if (match?.[1]) return `douyin-video:${match[1]}`;
    return raw.replace(/[?#].*$/, '').trim();
  }

  private readOptionalNumber(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private scoreDouyinCandidate(
    candidate: ReturnType<
      AiEmployeeService['normalizeFollowUpCandidates']
    >[number],
    sourceText: string,
    filters: {
      includeKeywords: string[];
      blacklistKeywords: string[];
      minScore: number;
    } = {
      includeKeywords: [],
      blacklistKeywords: [],
      minScore: 45,
    },
  ) {
    const text = candidate.text.trim();
    const highIntentKeywords = [
      '价格',
      '多少钱',
      '怎么',
      '哪里',
      '联系',
      '私信',
      '想',
      '需要',
      '了解',
      '咨询',
      '报名',
      '加盟',
      '电话',
      '微信',
      '地址',
      '预约',
      '资料',
      '方案',
    ];
    const noiseKeywords = [
      '哈哈',
      '路过',
      '沙发',
      '第一',
      '互关',
      '点赞',
      '666',
      '牛',
      '好看',
    ];
    const negativeKeywords = [
      '赔',
      '亏',
      '骗',
      '坑',
      '垃圾',
      '差评',
      '投诉',
      '维权',
      '后悔',
      '倒闭',
      '关门',
      '失败',
      '黑心',
      '骗子',
      '套路',
      '割韭菜',
      '不靠谱',
      '别加盟',
      '不要加盟',
    ];
    const mergedHighIntentKeywords = [
      ...new Set([...filters.includeKeywords, ...highIntentKeywords]),
    ];
    const mergedNoiseKeywords = [
      ...new Set([...filters.blacklistKeywords, ...noiseKeywords]),
    ];
    const isSearchAccount = this.isDouyinSearchAccountCandidate(candidate);
    const upstreamScore =
      typeof candidate.score === 'number' && Number.isFinite(candidate.score)
        ? candidate.score
        : undefined;
    const upstreamRejected =
      !isSearchAccount &&
      upstreamScore !== undefined &&
      upstreamScore <= 0 &&
      (Boolean(candidate.reason) ||
        negativeKeywords.some((keyword) => text.includes(keyword)));
    if (upstreamRejected) {
      return {
        ...candidate,
        score: 0,
        skipped: true,
        reason: candidate.reason || '采集阶段判定为低意向或负面评论，已跳过。',
      };
    }
    const negativeHits = negativeKeywords.filter((keyword) =>
      text.includes(keyword),
    );
    if (negativeHits.length) {
      return {
        ...candidate,
        score: 0,
        skipped: true,
        reason: `负面或投诉评论：${negativeHits.slice(0, 3).join('、')}`,
      };
    }
    const targetName = this.readOptionalText(candidate.targetName);
    if (!isSearchAccount && /作者|商家|客服/.test(targetName)) {
      return {
        ...candidate,
        score: 0,
        skipped: true,
        reason: '评论者是作者/商家/客服，不作为客户线索。',
      };
    }
    const promotionSignals = [
      '我们帮',
      '我们系统',
      '我们服务',
      '我们公司',
      '服务过',
      '优化过',
      'AI辅助',
      'ai辅助',
      '行业垂直',
      '行业规范',
      'AI模型',
      'ai模型',
      '动态识别',
      '关键词抓取',
      '平台推荐逻辑',
      '数据全程',
      '数据安全',
      '风控机制',
      '平台规范',
      '获客系统',
      '放心用',
    ];
    const promotionHits = promotionSignals.filter((keyword) =>
      text.includes(keyword),
    );
    const looksLikePromotion =
      !isSearchAccount &&
      text.length > 60 &&
      promotionHits.length >= 2 &&
      !/[？?]/.test(text);
    if (looksLikePromotion) {
      return {
        ...candidate,
        score: 0,
        skipped: true,
        reason: '疑似同行或推广长评，不作为客户线索。',
      };
    }
    if (this.isDouyinVideoDirectCommentTarget(candidate)) {
      const hits = mergedHighIntentKeywords.filter((keyword) =>
        text.includes(keyword),
      );
      const score = Math.min(100, 68 + hits.length * 6);
      const directCommentReason =
        candidate.reason || '视频暂无可回复评论，改为直接在视频下评论。';
      return {
        ...candidate,
        score,
        skipped: score < filters.minScore,
        reason:
          score < filters.minScore
            ? `视频直评目标意向分低于 ${filters.minScore}，暂不跟进。`
            : directCommentReason,
      };
    }
    let score = isSearchAccount ? 58 : 35;
    const hits = mergedHighIntentKeywords.filter((keyword) =>
      text.includes(keyword),
    );
    score += hits.length * 14;
    if (/[？?]/.test(text)) score += 8;
    if (/\d{5,}|微信|电话|vx|V信/i.test(text)) score += 16;
    if (sourceText && text.includes(sourceText)) score += 6;
    if (text.length >= 6 && text.length <= 80) score += 8;
    if (candidate.kind === 'comment') score += 4;
    if (isSearchAccount) score += 10;
    const noiseHits = mergedNoiseKeywords.filter((keyword) =>
      text.includes(keyword),
    );
    score -= noiseHits.length * 18;
    if (filters.blacklistKeywords.some((keyword) => text.includes(keyword)))
      score = 0;
    if (!isSearchAccount && (text.length < 3 || text.length > 120)) score -= 40;

    const finalScore = Math.max(0, Math.min(100, score));
    const skipped = finalScore < filters.minScore;
    return {
      ...candidate,
      score: finalScore,
      skipped,
      reason: skipped
        ? noiseHits.length
          ? `低意向或噪声评论：${noiseHits.join('、')}`
          : `意向分低于 ${filters.minScore}，暂不跟进。`
        : hits.length
          ? `命中高意向词：${hits.slice(0, 3).join('、')}`
          : isSearchAccount
            ? '搜索结果账号命中昵称筛选，适合私信触达。'
            : '评论内容完整，适合先轻触达。',
    };
  }

  private normalizeKeywordList(value: unknown) {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .map((item) => this.readOptionalText(item))
      .filter((item): item is string => Boolean(item))
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      })
      .slice(0, 30);
  }

  private normalizeMinScore(value: unknown) {
    const numeric = Number(value ?? 45);
    if (!Number.isFinite(numeric)) return 45;
    return Math.min(Math.max(Math.floor(numeric), 0), 100);
  }

  private buildDouyinCommentReply(
    commentText: string,
    sourceText: string,
    templates: string[],
    index: number,
  ) {
    const topic = sourceText === '未填写' ? '这个需求' : sourceText;
    const preview = commentText.slice(0, 28);
    const template = this.pickTemplate(templates, index);
    if (template) {
      return this.renderFollowUpTemplate(template, commentText, topic);
    }
    return `看到你提到“${preview}”，${topic}这块可以先私信你一份参考资料。`;
  }

  private buildDouyinDirectMessage(
    commentText: string,
    privateMessage: string,
    sourceText: string,
    templates: string[],
    index: number,
  ) {
    const topic = sourceText === '未填写' ? '你评论里提到的需求' : sourceText;
    const template = this.pickTemplate(templates, index);
    if (template) {
      return this.renderFollowUpTemplate(
        template,
        commentText,
        topic,
        privateMessage,
      );
    }
    return `你好，看到你在评论里提到“${commentText.slice(0, 36)}”。${privateMessage}（来源：${topic}）`;
  }

  private normalizeTemplatePool(value: unknown) {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .map((item) => this.readOptionalText(item))
      .filter((item): item is string => Boolean(item))
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter((item) => {
        if (seen.has(item)) return false;
        seen.add(item);
        return true;
      })
      .slice(0, 20);
  }

  private pickTemplate(templates: string[], index: number) {
    if (!templates.length) return '';
    return templates[index % templates.length];
  }

  private renderFollowUpTemplate(
    template: string,
    commentText: string,
    topic: string,
    privateMessage = '',
  ) {
    const preview = commentText.slice(0, 36);
    return template
      .replace(/\{comment\}/g, preview)
      .replace(/\{评论\}/g, preview)
      .replace(/\{topic\}/g, topic)
      .replace(/\{主题\}/g, topic)
      .replace(/\{message\}/g, privateMessage)
      .replace(/\{私信\}/g, privateMessage)
      .trim();
  }

  private indexExecutorsByKey(status: LocalEngineExecutorsStatus | null) {
    const indexed = new Map<string, LocalEngineExecutorCapability>();
    for (const executor of status?.executors ?? []) {
      indexed.set(String(executor.key), executor);
    }
    return indexed;
  }

  private toWorkflowCapabilities(
    capabilities: AiEmployeeCapabilityView[],
    executorsStatus: LocalEngineExecutorsStatus | null,
  ): AiEmployeeWorkflowCapabilityInput[] {
    const mapped = new Map<string, AiEmployeeWorkflowCapabilityInput>(
      capabilities.map((capability) => [
        capability.key,
        {
          key: capability.key,
          title: capability.title,
          status: capability.status,
          message: capability.message,
          nextAction: capability.nextAction,
        },
      ]),
    );
    for (const executor of executorsStatus?.executors ?? []) {
      const key = String(executor.key);
      if (mapped.has(key)) continue;
      const status: AiEmployeeWorkflowCapabilityInput['status'] =
        executor.status === 'ready'
          ? 'real'
          : executor.status === 'preflight_only'
            ? 'needs_config'
            : 'unavailable';
      mapped.set(key, {
        key,
        title: executor.name || key,
        status,
        message: executor.message,
        nextAction: executor.nextAction,
      });
    }
    return Array.from(mapped.values());
  }

  private async loadCapabilityContext() {
    const [readinessResult, executorsResult] = await Promise.allSettled([
      this.localEngine.getReadiness(),
      this.localEngine.getExecutorsStatus(),
    ]);
    const readiness =
      readinessResult.status === 'fulfilled' ? readinessResult.value : null;
    const executorsStatus =
      executorsResult.status === 'fulfilled' ? executorsResult.value : null;
    const executorsByKey = this.indexExecutorsByKey(executorsStatus);
    const capabilities = AI_EMPLOYEE_CAPABILITIES.map((capability) =>
      this.toCapabilityView(capability, executorsByKey),
    );
    return { readiness, executorsStatus, capabilities };
  }

  private toCapabilityReadinessSummary(readiness: LocalEngineReadiness) {
    const nextIssue = readiness.blockers[0] ?? readiness.warnings[0];
    return {
      ready: readiness.ready,
      blockers: readiness.summary.blockers,
      warnings: readiness.summary.warnings,
      nextAction:
        nextIssue?.nextAction ||
        (readiness.ready
          ? '本机执行底座可用，可以创建核心任务。'
          : '请先处理本机引擎阻断项。'),
    };
  }

  private toCapabilityView(
    capability: AiEmployeeCapabilityContract,
    executorsByKey: Map<string, LocalEngineExecutorCapability>,
  ): AiEmployeeCapabilityView {
    const executor = capability.executorTaskType
      ? executorsByKey.get(capability.executorTaskType)
      : undefined;
    const status = this.resolveCapabilityStatus(capability, executor);
    return {
      key: capability.key,
      domain: capability.domain,
      title: capability.title,
      platform: capability.platform,
      runtimePath: capability.runtimePath,
      routeableNow: capability.routeableNow,
      executorTaskType: capability.executorTaskType,
      status,
      riskLevel: this.getCapabilityRiskLevel(capability),
      executionMode: this.getCapabilityExecutionMode(status),
      message: this.getCapabilityMessage(capability, status, executor),
      nextAction: this.getCapabilityNextAction(capability, status, executor),
      acceptance: [...capability.acceptance],
      blockers: [...capability.blockers],
      executor: executor
        ? {
            key: String(executor.key),
            name: executor.name,
            status: executor.status,
            message: executor.message,
            nextAction: executor.nextAction,
          }
        : undefined,
    };
  }

  private resolveCapabilityStatus(
    capability: AiEmployeeCapabilityContract,
    executor?: LocalEngineExecutorCapability,
  ): AiEmployeeCapabilityStatus {
    if (
      !capability.routeableNow ||
      capability.runtimePath === 'not-integrated'
    ) {
      return 'unavailable';
    }
    if (executor?.status === 'ready') return 'real';
    if (executor?.status === 'preflight_only') return 'needs_config';
    return 'simulated';
  }

  private getCapabilityExecutionMode(
    status: AiEmployeeCapabilityStatus,
  ): AiEmployeeCapabilityView['executionMode'] {
    if (status === 'real') return 'real';
    if (status === 'simulated') return 'simulated';
    if (status === 'needs_config') return 'configuration';
    return 'blocked';
  }

  private getCapabilityRiskLevel(
    capability: AiEmployeeCapabilityContract,
  ): AiEmployeeCapabilityRiskLevel {
    if (
      capability.platform === 'wechat-desktop' ||
      capability.key.includes('publish') ||
      capability.key.includes('broadcast') ||
      capability.key.includes('contact-add') ||
      capability.key.includes('retention')
    ) {
      return 'high';
    }
    if (capability.key.includes('exposure')) return 'medium';
    return 'low';
  }

  private getCapabilityMessage(
    capability: AiEmployeeCapabilityContract,
    status: AiEmployeeCapabilityStatus,
    executor?: LocalEngineExecutorCapability,
  ) {
    if (status === 'real') {
      return `${capability.title} 已接通，可在确认后执行。`;
    }
    if (status === 'needs_config') {
      return (
        executor?.message ||
        `${capability.title} 已有预检能力，但执行环境尚未完全就绪。`
      );
    }
    if (status === 'simulated') {
      return `${capability.title} 当前仅可预演，不会向平台发送或发布。`;
    }
    return capability.blockers[0] || `${capability.title} 当前不可路由。`;
  }

  private getCapabilityNextAction(
    capability: AiEmployeeCapabilityContract,
    status: AiEmployeeCapabilityStatus,
    executor?: LocalEngineExecutorCapability,
  ) {
    if (status === 'real') {
      return '请在对应页面配置内容，并在外部动作前确认。';
    }
    if (status === 'needs_config') {
      return executor?.nextAction || '先完成账号、权限、桌面或浏览器预检。';
    }
    if (status === 'simulated') {
      return '可以创建预演，真实操作尚未开放。';
    }
    return capability.blockers[0] || '等待后续版本集成。';
  }

  private normalizeCoreTaskType(value: unknown): AiEmployeeCoreTaskType {
    const normalized = typeof value === 'string' ? value.trim() : '';
    const allowed: AiEmployeeCoreTaskType[] = [
      'workflow.auto',
      'exposure.auto',
      'exposure.targeted',
      'exposure.link',
      'exposure.search_account',
      'exposure.retention',
      'ai_service.config_test',
      'publish.multi_platform',
      'video.template_clip',
    ];
    if (allowed.includes(normalized as AiEmployeeCoreTaskType)) {
      return normalized as AiEmployeeCoreTaskType;
    }
    return 'workflow.auto';
  }

  private getCoreTaskMapping(taskType: AiEmployeeCoreTaskType): {
    title: string;
    capabilityKey?: string;
    executionScope: AgentExecutionScope;
    targetApp: string;
  } {
    const mappings: Record<
      AiEmployeeCoreTaskType,
      {
        title: string;
        capabilityKey?: string;
        executionScope: AgentExecutionScope;
        targetApp: string;
      }
    > = {
      'workflow.auto': {
        title: 'AI员工自动工作流',
        executionScope: 'mixed',
        targetApp: '任务中心',
      },
      'exposure.auto': {
        title: '自动曝光',
        capabilityKey: 'douyin-hot-video-exposure',
        executionScope: 'browser',
        targetApp: '增长获客',
      },
      'exposure.targeted': {
        title: '定向曝光',
        capabilityKey: 'douyin-targeted-exposure',
        executionScope: 'browser',
        targetApp: '增长获客',
      },
      'exposure.link': {
        title: '链接曝光',
        capabilityKey: 'douyin-link-exposure',
        executionScope: 'browser',
        targetApp: '增长获客',
      },
      'exposure.search_account': {
        title: '搜索账号曝光',
        capabilityKey: 'douyin-search-account-exposure',
        executionScope: 'browser',
        targetApp: '增长获客',
      },
      'exposure.retention': {
        title: '留痕曝光',
        capabilityKey: 'douyin-retention-exposure',
        executionScope: 'browser',
        targetApp: '增长获客',
      },
      'ai_service.config_test': {
        title: 'AI客服配置调试',
        executionScope: 'browser',
        targetApp: '客户互动',
      },
      'publish.multi_platform': {
        title: '多平台发布',
        capabilityKey: 'publish-douyin-video',
        executionScope: 'browser',
        targetApp: '发布中心',
      },
      'video.template_clip': {
        title: '模板剪辑',
        capabilityKey: 'video-template-clip',
        executionScope: 'local-files',
        targetApp: '视频工坊',
      },
    };
    return mappings[taskType];
  }

  private getWorkflowCapabilityKeys(platform: string) {
    const publishCapabilityByPlatform: Record<string, string> = {
      douyin: 'publish-douyin-video',
      xiaohongshu: 'publish-xiaohongshu-video',
      kuaishou: 'publish-kuaishou-video',
      'wechat-channel': 'publish-wechat-channel-video',
      bilibili: 'publish-bilibili-video',
    };
    return [
      'video-template-clip',
      'douyin-targeted-exposure',
      publishCapabilityByPlatform[platform] || 'publish-douyin-video',
    ];
  }

  private buildCoreDryRunInstruction(
    taskType: AiEmployeeCoreTaskType,
    title: string,
  ) {
    return [
      `创建 ${title} 的安全预演任务。`,
      `任务类型：${taskType}。`,
      '只生成任务事件、确认项和证据摘要，不执行真实外部触达。',
    ].join('\n');
  }

  private normalizeSessionLimit(value: unknown) {
    const limit = Number(value || 80);
    if (!Number.isFinite(limit)) return 80;
    return Math.min(Math.max(Math.floor(limit), 1), 200);
  }

  private normalizeMetadata(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private getWorkflowService() {
    if (this.workflowService) return this.workflowService;
    if (!this.fallbackWorkflowService) {
      this.fallbackWorkflowService = new AiEmployeeWorkflowService(
        this.runtime,
      );
    }
    return this.fallbackWorkflowService;
  }

  private async assertAiEmployeeSession(id: string) {
    const session = await this.localEngine.getAgentSession(id);
    if (!this.isAiEmployeeSession(session)) {
      throw new BadRequestException('只能操作 AI 员工创建的任务');
    }
    return session;
  }

  private isVisibleAiEmployeeSession(session: AgentSession) {
    return (
      this.isAiEmployeeSession(session) &&
      this.normalizeMetadata(session.metadata).hiddenFromAiEmployee !== true
    );
  }

  private isAiEmployeeSession(session: AgentSession) {
    return (
      this.normalizeMetadata(session.metadata).aiEmployee ===
      AI_EMPLOYEE_METADATA_FLAG
    );
  }
}
