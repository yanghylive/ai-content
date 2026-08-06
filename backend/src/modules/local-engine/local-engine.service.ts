import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants, existsSync, mkdirSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { homedir, platform, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import net from 'node:net';
import {
  Prisma,
  type InteractionReplyRule,
  type InteractionTaskStatus as PrismaInteractionTaskStatus,
  type InteractionTaskType as PrismaInteractionTaskType,
} from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { PlaywrightMcpService } from './playwright-mcp.service';
import {
  assertBackendRiskGate,
  type BackendRiskAuditEvent,
  type BackendRiskConfirmationInput,
  type BackendRiskContext,
} from '../auth/risk-control';
import type { AuthenticatedUser } from '../auth/auth.types';
import { McpRuntimeService } from './mcp-runtime.service';
import { AgentSidecarService } from './agent-sidecar.service';
import { AgentSService } from '../agent-s/agent-s.service';
import { SandboxRuntimeService } from './sandbox-runtime.service';
import { PluginRuntimeService } from './plugin-runtime.service';
import { MemoryRuntimeService } from './memory-runtime.service';
import {
  type AgentConfirmation,
  type AgentConfirmationDecisionInput,
  type AgentConfirmationListItem,
  type AgentConfirmationStatus,
  type AgentExecutionScope,
  type AgentEvidence,
  type AgentSessionResumeAction,
  type AgentSessionEvidenceExportResult,
  type AgentSessionEvidenceListResult,
  type AgentSessionListFilter,
  type AgentRiskLevel,
  type AgentSession,
  type AgentSessionEvent,
  type AgentSessionSource,
  type AgentSessionStatus,
  type ArchiveAgentSessionInput,
  type ContinueAgentSessionInput,
  type CreateAgentSessionInput,
  type CreateCustomerServiceReplyTaskInput,
  type CreateInteractionTaskInput,
  type CustomerServiceReplyBot,
  type CustomerServiceReplyDecision,
  type CustomerServiceReplyPlatform,
  type InteractionFollowUpMethod,
  type MomentsPlanMetadata,
  type InteractionBusinessRouteKey,
  type InteractionBatchTarget,
  type InteractionBatchTargetListResult,
  type InteractionApprovalInput,
  type InteractionApprovalRecord,
  type InteractionRecordsExportResult,
  type InteractionRecordsResult,
  type InteractionTaskDiagnosticExportResult,
  type InteractionReplyGeneratedBy,
  type InteractionEvidenceCleanupResult,
  type LocalEngineMisfireProtection,
  type LocalEngineDesktopStatus,
  type LocalEngineDesktopPermissionKey,
  type LocalEngineDesktopCommercialPreflight,
  type LocalEngineDesktopScreenshotEvidence,
  type LocalEngineWechatSessionStatus,
  type AlignWechatSessionInput,
  type LocalEnginePermissionStatus,
  type LocalEngineRiskPolicy,
  type LocalEngineSafetyBoundary,
  type LocalEngineSafetyCheck,
  type UpdateWechatSessionConfirmationInput,
  type WechatSessionControlInput,
  type SyncWechatChatHistoryInput,
  type SyncWechatChatHistoryResult,
  type WechatChatHistoryResult,
  type WechatChatHistorySource,
  type WechatChatHistoryStatus,
  type WechatChatMessage,
  type WechatChatSession,
  type WechatChatSessionsResult,
  type InteractionSendMode,
  type InteractionTaskStepStatus,
  type InteractionTaskListFilter,
  type InteractionTaskResultKind,
  type InteractionTaskResultSummary,
  type InteractionReplyRuleConfig,
  type InteractionTask,
  type AutomationTaskView,
  type AutomationTaskViewStatus,
  type InteractionTaskBillingIdentity,
  type InteractionTaskEvent,
  type InteractionExecutorDraftResult,
  type InteractionTaskStatus,
  type InteractionTaskType,
  type ResendGroupBroadcastPlanInput,
  type RetryInteractionTaskInput,
  type LocalEngineBrowserStatus,
  type LocalEngineCapability,
  type LocalEngineCapabilityStatus,
  type LocalEngineExecutorCapability,
  type LocalEngineFileAccessItem,
  type LocalEngineFileAccessStatus,
  type LocalEngineHealth,
  type LocalEngineReadiness,
  type LocalEngineExecutorsStatus,
  type LocalEngineRuntimeAction,
  type LocalEngineRuntimeActionResult,
  type LocalEngineRuntimeLog,
  type LocalEngineRuntimeServiceKey,
  type LocalEngineRuntimeService,
  type LocalEngineRuntimeStatus,
  type UpdateInteractionReplyRuleInput,
  type UpsertWechatContactInput,
  type WechatContact,
  type WechatContactsDiagnosticsExportResult,
  type WechatContactsExportResult,
  type WechatContactsReadinessCheck,
  type WechatContactsReadinessResult,
  type WechatContactsResult,
  type WechatContactsSyncDiagnostics,
  type WechatContactsSyncInput,
  type WechatContactsSyncMode,
} from './local-engine.types';

type InteractionTaskSummaryRow = Prisma.InteractionTaskGetPayload<{
  select: {
    id: true;
    tenantId: true;
    userId: true;
    taskType: true;
    accountId: true;
    sendMode: true;
    status: true;
    riskLevel: true;
    stage: true;
    currentTarget: true;
    draftText: true;
    processedCount: true;
    failedCount: true;
    skippedCount: true;
    batchTargets: true;
    batchSummary: true;
    config: true;
    createdBy: true;
    localTaskId: true;
    requiresDoubleConfirmation: true;
    createdAt: true;
    updatedAt: true;
  };
}>;

type LocalEngineTenantScope = {
  tenantId: string;
  userId: string;
};

const WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS = 12 * 60 * 1000;

type LocalEngineEntitlementUser = Pick<
  AuthenticatedUser,
  | 'id'
  | 'kaypalUserId'
  | 'kaypalPlan'
  | 'kaypalPlanExpired'
  | 'kaypalDesktopAccessToken'
> & {
  planMode?: string;
  commercialExecutionAllowed?: boolean;
};

type WechatDesktopCommandResult = {
  screenshotPath?: string;
  reply?: string;
  readText?: string;
  sourceText?: string;
  generatedBy?: InteractionReplyGeneratedBy;
  message?: string;
  contact?: string;
  target?: string;
  currentWechatId?: string;
  plannedWechatId?: string;
  mode?: string;
  status?: string;
  errorCode?: string;
  nextAction?: string;
  output?: unknown;
  diagnostics?: unknown;
  raw?: Record<string, unknown>;
};

type WechatMomentsVisibilityCode = 'public' | 'private' | 'partial';

type WechatContactSyncAttempt = {
  result: Record<string, unknown> | null;
  diagnostics?: WechatContactsSyncDiagnostics;
};

const WECHAT_NATIVE_COMMAND_RUNNER_LABELS: Record<string, string> = {
  'group-broadcast': '群发',
  'contact-add': '加好友',
  'friend-accept': '通过好友',
  'moments-publish': '朋友圈发布',
  'moments-marketing': '朋友圈营销',
  'chat-history': '会话历史',
};

const BROWSER_INTERACTION_EXECUTOR_IDS = [
  'douyin-comment-reply',
  'douyin-direct-message-reply',
  'wechat-channel-comment-reply',
  'wechat-channel-direct-message-reply',
] as const;

const DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS = [
  'wechat-reply-draft',
  'wechat-friend-accept',
  'wechat-group-broadcast',
  'wechat-contact-add',
  'wechat-moments-publish',
  'wechat-moments-marketing',
] as const;

const ALL_INTERACTION_EXECUTOR_IDS = [
  ...BROWSER_INTERACTION_EXECUTOR_IDS,
  ...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS,
] as const;

type ApprovedWechatTargetResult = {
  target: string;
  ok: boolean;
  message: string;
  screenshotPath?: string;
  result?: WechatDesktopCommandResult;
};

type ApprovedWechatTaskResult = {
  ok: boolean;
  status?: 'no_target' | 'blocked';
  message: string;
  nextAction?: string;
  screenshotPath?: string;
  completedTargets?: string[];
  failedTargets?: Array<{ targetName: string; reason?: string }>;
  skippedTargets?: string[];
  pendingTargets?: string[];
  results?: ApprovedWechatTargetResult[];
  readbackText?: string;
  sourceText?: string;
  replyText?: string;
  replyGeneratedBy?: InteractionReplyGeneratedBy;
};

type MomentsPlanState = Required<
  Pick<MomentsPlanMetadata, 'dailyPublished' | 'dailyQuota'>
> &
  Pick<
    MomentsPlanMetadata,
    | 'scheduleStartTime'
    | 'autoLike'
    | 'autoComment'
    | 'recordSummary'
    | 'prompts'
  > & {
    remainingToday: number;
  };

type CustomerServiceKnowledgeContext = {
  scope: 'local' | 'selected' | 'none';
  selectedKnowledgeId?: string;
  selectedKnowledgeTitle?: string;
  content?: string;
  available: boolean;
};

type WechatChatHistoryCache = {
  source: WechatChatHistorySource;
  sessions: WechatChatSession[];
  messages: WechatChatMessage[];
  syncedAt?: string;
  blockers: string[];
  warnings: string[];
};

class WechatDesktopCommandError extends Error {
  constructor(
    message: string,
    readonly result: WechatDesktopCommandResult = {},
  ) {
    super(message);
    this.name = 'WechatDesktopCommandError';
  }
}
import {
  type AutoUploadPublishPayload,
  type AutoUploadUploadFile,
} from '../auto-upload/auto-upload.client';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from '../runtime/orchestrator/interaction-task-runtime.mapper';
import type { ExecutorContext } from '../runtime/executor.interface';
import { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { isKaypalPlanAtLeast, normalizeKaypalPlan } from '../auth/plan-order';
import { KaypalModelSyncService } from '../ai-models/kaypal-model-sync.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { RiskPolicyService } from '../auth/risk-policy.service';
import {
  WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
  resolveWechatNativeCommandKey,
  type WechatNativeCommandKey,
} from './wechat-native-command.contract';
import { promisify } from 'node:util';
import {
  resolveProjectDataPath,
  resolveProjectLogPath,
  resolveProjectRoot,
  resolveRuntimeStateRoot,
} from '../../common/project-paths';

const execFileAsync = promisify(execFile);
const LOCAL_ENGINE_STATUS_CACHE_TTL_MS = 5000;
const WECHAT_RESUME_RISK_ACTION = 'interaction-resume';

@Injectable()
export class LocalEngineService {
  private readonly startedAt = Date.now();
  private readonly tasks = new Map<string, InteractionTask>();
  private readonly agentSessions = new Map<string, AgentSession>();
  private readonly agentConfirmations = new Map<string, AgentConfirmation>();
  private readonly replyRules = new Map<string, InteractionReplyRuleConfig>();
  private readonly taskPersistQueues = new Map<string, Promise<void>>();
  private readonly browserInteractionQueues = new Map<string, Promise<void>>();
  private wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
    alignment?: LocalEngineWechatSessionStatus['alignment'];
  } = {};
  private readonly desktopEvidence: LocalEngineDesktopScreenshotEvidence[] = [];
  private executorsStatusCache: {
    value: LocalEngineExecutorsStatus;
    expiresAt: number;
  } | null = null;
  private desktopStatusWithEvidenceCache: {
    value: LocalEngineDesktopStatus;
    expiresAt: number;
  } | null = null;
  private replyRule: InteractionReplyRuleConfig = this.createDefaultReplyRule();
  private taskStoreReady: Promise<void> | null = null;
  private readonly requiredInteractionExecutorIds = [
    ...ALL_INTERACTION_EXECUTOR_IDS,
  ];

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => AutoUploadService))
    private readonly autoUploadService: AutoUploadService,
    private readonly prisma: PrismaService,
    private readonly mcpRuntime: McpRuntimeService,
    private readonly agentSidecar: AgentSidecarService,
    private readonly sandboxRuntime: SandboxRuntimeService,
    private readonly pluginRuntime: PluginRuntimeService,
    private readonly memoryRuntime: MemoryRuntimeService,
    @Optional()
    @Inject(forwardRef(() => PlaywrightMcpService))
    private readonly playwrightMcp?: PlaywrightMcpService,
    @Optional()
    @Inject(forwardRef(() => RuntimeOrchestrator))
    private readonly runtimeOrchestrator?: RuntimeOrchestrator,
    @Optional()
    @Inject(forwardRef(() => BrowserControlService))
    private readonly browserControl?: BrowserControlService,
    @Optional()
    @Inject(forwardRef(() => NodeAgentRuntimeService))
    private readonly nodeAgentRuntime?: NodeAgentRuntimeService,
    @Optional()
    private readonly kaypalClient?: KaypalAuthClient,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly kaypalModelSync?: KaypalModelSyncService,
    @Optional()
    private readonly aiClient?: AiClientService,
    @Optional()
    private readonly defaultModels?: DefaultModelsService,
    @Optional()
    private readonly agentS?: AgentSService,
    @Optional()
    private readonly riskPolicyService?: RiskPolicyService,
  ) {}

  private async resolveTenantScope(): Promise<LocalEngineTenantScope> {
    const context = this.authRequestContext?.get();
    const user = context?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后访问客户互动数据。');
    }

    const requestedTenantId =
      context?.requestedTenantId?.trim() || context?.tenantId?.trim() || '';
    if (requestedTenantId) {
      if (
        user?.kaypalLocalOnly === true &&
        requestedTenantId === `local-desktop:${userId}`
      ) {
        return { tenantId: requestedTenantId, userId };
      }
      const membership = await this.prisma.tenantMember.findFirst({
        where: {
          userId,
          tenantId: requestedTenantId,
          status: 'active',
          tenant: { status: 'active' },
        },
        select: { tenantId: true },
      });
      if (membership?.tenantId === requestedTenantId) {
        return { tenantId: requestedTenantId, userId };
      }
      throw new ForbiddenException('当前账号无权访问指定组织。');
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
      if (user?.kaypalLocalOnly !== true) {
        throw error;
      }
    }

    if (user?.kaypalLocalOnly === true) {
      return { tenantId: `local-desktop:${userId}`, userId };
    }

    throw new ForbiddenException('当前账号尚未绑定可用组织。');
  }

  private tenantScopeKey(scope: LocalEngineTenantScope) {
    return `${scope.tenantId}\u0000${scope.userId}`;
  }

  private isInTenantScope(
    record: { tenantId?: string | null; userId?: string | null },
    scope: LocalEngineTenantScope,
  ) {
    return record.tenantId === scope.tenantId && record.userId === scope.userId;
  }

  private tenantScopeForRecord(record: {
    tenantId?: string | null;
    userId?: string | null;
  }): LocalEngineTenantScope {
    if (!record.tenantId || !record.userId) {
      throw new ForbiddenException('记录缺少租户归属，已拒绝访问。');
    }
    return { tenantId: record.tenantId, userId: record.userId };
  }

  private useNodeAgentRuntime(): boolean {
    const value = (
      this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || ''
    )
      .trim()
      .toLowerCase();
    return value !== '0' && value !== 'false';
  }

  private buildCurrentInteractionTaskBillingIdentity():
    InteractionTaskBillingIdentity | undefined {
    const context = this.authRequestContext?.get();
    const user = context?.user;
    const sessionId = context?.sessionId?.trim() || '';
    const localUserId = user?.id?.trim() || '';
    const kaypalUserId = user?.kaypalUserId?.trim() || '';
    const deviceId = user?.kaypalDesktopDeviceId?.trim() || '';

    if (!sessionId || !localUserId || !kaypalUserId) {
      return undefined;
    }

    return {
      sessionId,
      localUserId,
      kaypalUserId,
      kaypalDesktopTokenExpiresAt:
        user?.kaypalDesktopTokenExpiresAt?.trim() || undefined,
      kaypalDesktopDeviceId: deviceId || undefined,
      kaypalPlan: user?.kaypalPlan,
      kaypalRole: user?.kaypalRole,
      kaypalPlatformRole: user?.kaypalPlatformRole,
      commercialExecutionAllowed: user?.commercialExecutionAllowed,
      planMode: user?.planMode,
      capturedAt: new Date().toISOString(),
    };
  }

  private allowLocalPlanBypass(): boolean {
    return (
      this.configService.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') ===
      'true'
    );
  }

  private currentActorCommercialAllowed(): boolean {
    const user = this.authRequestContext?.get()?.user;
    return (
      user?.commercialExecutionAllowed === true ||
      (Boolean(user?.kaypalPlan) &&
        user?.kaypalPlanExpired !== true &&
        isKaypalPlanAtLeast(user?.kaypalPlan, 'STANDARD'))
    );
  }

  private toRuntimeRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private toRuntimeString(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private isPrismaTableMissingError(error: unknown, tableName?: string) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : undefined;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      code === 'P2021' ||
      /does not exist in the current database/i.test(message) ||
      /no such table/i.test(message);
    return missing && (!tableName || message.includes(tableName));
  }

  private formatCreditBalance(balance: number | null): string {
    if (balance == null) return '未同步';
    return Number.isInteger(balance)
      ? String(balance)
      : balance.toLocaleString('zh-CN', {
          maximumFractionDigits: 2,
        });
  }

  private buildBlockedKaypalEntitlementCapability(
    now: string,
    summary: string,
    nextAction: string,
    checks: NonNullable<LocalEngineCapability['checks']>,
  ): LocalEngineCapability {
    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'blocked',
      required: true,
      summary,
      checkedAt: now,
      nextAction,
      checks,
    };
  }

  private buildKaypalEntitlementTimeoutFallback(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): LocalEngineCapability {
    const cachedCapability = user
      ? this.buildCachedKaypalEntitlementCapability(
          now,
          user,
          user.kaypalPlan || '',
          '云端权益同步超过 6 秒；本机先按已登录套餐和本地会话继续验收。',
        )
      : null;
    if (cachedCapability) {
      return cachedCapability;
    }
    return this.buildBlockedKaypalEntitlementCapability(
      now,
      'Kaypal 账号、订阅套餐和积分余额同步超时。',
      '确认 test.kaypal.cn 可访问，或在账号与设备页重新登录后刷新。',
      [
        {
          name: 'Kaypal 测试站',
          status: 'blocked',
          message: '检查超过 6 秒，不能证明授权、订阅和积分可用。',
        },
      ],
    );
  }

  private buildCachedKaypalEntitlementCapability(
    now: string,
    user: LocalEngineEntitlementUser,
    plan: string,
    warning?: string,
  ): LocalEngineCapability | null {
    const cachedPlan = normalizeKaypalPlan(plan || user.kaypalPlan);
    const cachedPlanAllowed = isKaypalPlanAtLeast(cachedPlan, 'PRO');
    const localExecutionAllowed =
      (user.planMode || 'trial') === 'commercial' ||
      user.commercialExecutionAllowed === true ||
      (Boolean(user.kaypalPlan) &&
        user.kaypalPlanExpired !== true &&
        isKaypalPlanAtLeast(user.kaypalPlan, 'STANDARD'));

    if (
      !localExecutionAllowed ||
      !cachedPlanAllowed ||
      user.kaypalPlanExpired
    ) {
      return null;
    }

    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: 'ready',
      required: true,
      summary: warning
        ? `Kaypal 会话权益可用：套餐 ${cachedPlan}；${warning}`
        : `Kaypal 会话权益可用：套餐 ${cachedPlan}。`,
      checkedAt: now,
      nextAction: warning
        ? '云端权益会继续在账号与设备页同步；本机商用执行按当前登录态和本地权限继续验收。'
        : '',
      checks: [
        {
          name: 'Kaypal 授权',
          status: 'ready',
          message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，本地会话保留商用执行授权。`,
        },
        {
          name: '订阅套餐',
          status: 'ready',
          message: `本地会话套餐 ${cachedPlan}；满足 PRO / ADVANCED / FLAGSHIP 要求。`,
        },
        {
          name: '本机商用执行权限',
          status: 'ready',
          message: `planMode=${user.planMode}，commercialExecutionAllowed=${user.commercialExecutionAllowed}，kaypalPlan=${user.kaypalPlan}`,
        },
        {
          name: '积分余额',
          status: warning ? 'warning' : 'ready',
          message: warning || '云端权益同步正常。',
        },
      ],
    };
  }

  private async buildKaypalEntitlementCapability(
    now: string,
    explicitUser?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability> {
    const requestContext = this.authRequestContext?.get();
    const user = explicitUser || requestContext?.user;
    if (!user) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        '当前请求没有登录上下文，不能确认 Kaypal 授权、订阅套餐和积分余额。',
        '重新登录 Kaypal 账号后刷新运行检查。',
        [
          {
            name: '登录上下文',
            status: 'blocked',
            message: 'AuthGuard 未提供当前用户上下文。',
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    if (!user.kaypalUserId) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        '当前本地账号未绑定 Kaypal 测试站账号。',
        '在账号与设备页重新登录 Kaypal 账号。',
        [
          {
            name: 'Kaypal 绑定',
            status: 'blocked',
            message: `本地用户 ${user.id} 没有 kaypalUserId。`,
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    const accessToken = this.toRuntimeString(user.kaypalDesktopAccessToken);
    if (!accessToken) {
      const cachedCapability = this.buildCachedKaypalEntitlementCapability(
        now,
        user,
        user.kaypalPlan || '',
        '当前会话没有可刷新的 Kaypal desktop access token；已使用本地已同步套餐继续验收。需要重新拉取云端套餐和积分时，请重新登录 Kaypal 账号。',
      );
      if (cachedCapability) {
        return cachedCapability;
      }
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        'Kaypal 测试站授权已失效，不能同步订阅套餐和积分余额。',
        '在账号与设备页重新登录 Kaypal 账号。',
        [
          {
            name: 'Kaypal 授权',
            status: 'blocked',
            message: '当前会话没有可用的 Kaypal desktop access token。',
          },
          {
            name: '订阅套餐',
            status: 'blocked',
            message: '未读取 Kaypal 测试站订阅信息。',
          },
          {
            name: '积分余额',
            status: 'blocked',
            message: '未读取 Kaypal 测试站积分余额。',
          },
        ],
      );
    }

    if (!this.kaypalClient) {
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        'KaypalAuthClient 未注入，不能从测试站同步权益。',
        '检查 AuthModule 与 LocalEngineModule 的依赖装配。',
        [
          {
            name: 'KaypalAuthClient',
            status: 'blocked',
            message: '服务未注入。',
          },
        ],
      );
    }

    let billing: Awaited<ReturnType<KaypalAuthClient['getCloudBilling']>>;
    try {
      billing = await this.kaypalClient.getCloudBilling(accessToken, {
        userId: user.kaypalUserId || null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      const cachedCapability = this.buildCachedKaypalEntitlementCapability(
        now,
        user,
        user.kaypalPlan || '',
        `远端权益同步暂时失败：${message}`,
      );
      if (cachedCapability) {
        return cachedCapability;
      }
      return this.buildBlockedKaypalEntitlementCapability(
        now,
        `Kaypal 测试站权益同步失败：${message}`,
        '确认 test.kaypal.cn 可访问，或在账号与设备页重新授权后刷新。',
        [
          {
            name: 'Kaypal 授权',
            status: 'blocked',
            message,
          },
        ],
      );
    }

    const subscription = this.toRuntimeRecord(billing.subscription) || {};
    const subscriptionUnavailable = subscription.unavailable === true;
    const plan = normalizeKaypalPlan(subscription.plan || user.kaypalPlan);
    const subscriptionStatus =
      this.toRuntimeString(subscription.status) || 'unknown';
    const subscriptionExpired =
      user.kaypalPlanExpired === true ||
      subscription.expired === true ||
      subscriptionStatus.toLowerCase() === 'expired';
    const balanceUnavailable = billing.balance.unavailable === true;
    const balance = billing.balance.balance;
    const hasBalance = balance != null;
    const planAllowed = isKaypalPlanAtLeast(plan, 'PRO');
    const balanceReady = !balanceUnavailable && hasBalance && balance > 0;
    const remoteWarning = [
      subscriptionUnavailable
        ? this.toRuntimeString(subscription.message) || '订阅接口不可用'
        : '',
      balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
      !hasBalance ? '积分余额未同步' : '',
    ]
      .filter(Boolean)
      .join('；');
    const cachedCapability = this.buildCachedKaypalEntitlementCapability(
      now,
      user,
      plan,
      remoteWarning || undefined,
    );
    if (
      cachedCapability &&
      (subscriptionUnavailable || balanceUnavailable || !hasBalance)
    ) {
      return cachedCapability;
    }
    const ready =
      !subscriptionUnavailable &&
      !subscriptionExpired &&
      planAllowed &&
      balanceReady;

    const blockerMessages = [
      subscriptionExpired ? '订阅已过期' : '',
      subscriptionUnavailable
        ? this.toRuntimeString(subscription.message) || '订阅接口不可用'
        : '',
      !planAllowed
        ? `当前套餐 ${plan}，启动本地服务和真实自动化需要 PRO 及以上`
        : '',
      balanceUnavailable ? billing.balance.message || '积分余额接口不可用' : '',
      !hasBalance ? '积分余额未同步' : '',
      hasBalance && balance <= 0 ? '积分余额不足' : '',
    ].filter(Boolean);

    const subscriptionReady =
      !subscriptionUnavailable && !subscriptionExpired && planAllowed;

    return {
      key: 'kaypal-entitlement',
      name: 'Kaypal 账号与权益',
      status: ready ? 'ready' : 'blocked',
      required: true,
      summary: ready
        ? `Kaypal 权益已同步：套餐 ${plan}，积分 ${this.formatCreditBalance(balance)}。`
        : `Kaypal 权益未满足运行要求：${blockerMessages[0] || '未知阻断'}`,
      checkedAt: now,
      nextAction: ready
        ? ''
        : '在 Kaypal 测试站确认订阅套餐和积分余额，然后回到账号与设备页重新授权或刷新状态。',
      checks: [
        {
          name: 'Kaypal 授权',
          status: 'ready',
          message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，当前授权可访问测试站。`,
        },
        {
          name: '订阅套餐',
          status: subscriptionReady ? 'ready' : 'blocked',
          message: `当前套餐 ${plan}；运行检查启动服务要求 PRO / ADVANCED / FLAGSHIP。`,
        },
        {
          name: '订阅状态',
          status:
            subscriptionUnavailable || subscriptionExpired
              ? 'blocked'
              : 'ready',
          message: subscriptionUnavailable
            ? this.toRuntimeString(subscription.message) || '订阅接口不可用。'
            : `订阅状态 ${subscriptionStatus}。`,
        },
        {
          name: '积分余额',
          status: balanceReady ? 'ready' : 'blocked',
          message: balanceUnavailable
            ? billing.balance.message || 'Kaypal 积分接口不可用。'
            : `当前积分 ${this.formatCreditBalance(balance)}。`,
        },
      ],
    };
  }

  private async buildNodeAgentRuntimeCapability(
    now: string,
    sidecarMessage = 'Node Runtime 模式不要求外部 Python sidecar 监听 17777；旧实现仅作为兼容/诊断项。',
  ): Promise<LocalEngineCapability> {
    if (!this.nodeAgentRuntime) {
      return {
        key: 'agent-s-sidecar',
        name: 'Agent-S 执行能力',
        status: 'blocked',
        required: true,
        summary: 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
        checkedAt: now,
        nextAction: '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
        checks: [
          {
            name: 'NodeAgentRuntimeService',
            status: 'blocked',
            message:
              '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
          },
        ],
      };
    }

    const health = await this.nodeAgentRuntime.health();
    const blockers = health.blockers || health.reasons || [];
    const browserReady = health.capabilities.browserControl === true;
    const status: LocalEngineCapabilityStatus = health.ok
      ? health.status === 'degraded'
        ? 'degraded'
        : 'ready'
      : 'blocked';

    return {
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status,
      required: true,
      summary: health.ok
        ? `Node Agent Runtime 已就绪（runner=${health.runner_mode}）。`
        : `Node Agent Runtime 未达到真实执行标准：${blockers[0] || health.status}`,
      checkedAt: now,
      nextAction:
        health.nextAction ||
        (health.ok
          ? ''
          : '接入非 mock 的包内 Agent-S 浏览器执行器，并完成真实读写、发送、回读和证据落库。'),
      checks: [
        {
          name: 'runner_mode',
          status: 'ready',
          message: `runner_mode=${health.runner_mode}`,
        },
        {
          name: 'browserControl',
          status: browserReady ? 'ready' : 'blocked',
          message: browserReady
            ? '已接入真实浏览器控制。'
            : '浏览器控制未开启，不能执行真实平台读取、发送和回读。',
        },
        {
          name: '证据读写',
          status: health.capabilities.evidenceStore ? 'ready' : 'blocked',
          message: health.capabilities.evidenceStore
            ? '平台执行截图、页面回读和动作结果会写入本地 evidence 目录；Node Runtime artifact 作为会话索引保存。'
            : '缺少真实截图/回读/动作证据落库。',
        },
        {
          name: '外部 17777 sidecar',
          status: 'optional',
          message: sidecarMessage,
        },
      ],
    };
  }

  private buildLegacyAgentSCapability(
    now: string,
    sidecarStatus: Awaited<ReturnType<AgentSidecarService['getStatus']>>,
  ): LocalEngineCapability {
    const runnerReady =
      sidecarStatus.available &&
      sidecarStatus.runnerMode === 'real' &&
      sidecarStatus.sessionProtocol &&
      sidecarStatus.screenshotArtifacts &&
      sidecarStatus.executionControl;
    return {
      key: 'agent-s-sidecar',
      name: 'Agent-S 执行能力',
      status: runnerReady ? 'ready' : 'blocked',
      required: true,
      summary: runnerReady
        ? sidecarStatus.message
        : `Agent-S 真实执行能力未就绪：${sidecarStatus.message}`,
      checkedAt: now,
      nextAction: runnerReady
        ? 'Agent-S 真实执行能力已接入。'
        : '旧 Python sidecar 路径必须启动 real runner，或迁移到包内 Node Runtime 真实执行层；mock/不可达不能通过。',
      checks: [
        {
          name: '执行服务',
          status: sidecarStatus.available ? 'ready' : 'blocked',
          message: sidecarStatus.available
            ? 'Agent-S 服务可访问。'
            : sidecarStatus.message,
        },
        {
          name: 'runner_mode',
          status: sidecarStatus.runnerMode === 'real' ? 'ready' : 'blocked',
          message: sidecarStatus.runnerMode
            ? `runner_mode=${sidecarStatus.runnerMode}`
            : '未读取到 runner_mode。',
        },
        {
          name: '会话协议',
          status: sidecarStatus.sessionProtocol ? 'ready' : 'blocked',
          message: sidecarStatus.sessionProtocol
            ? '会话协议可用。'
            : '会话协议不可用。',
        },
        {
          name: '截图与执行控制',
          status:
            sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
              ? 'ready'
              : 'blocked',
          message:
            sidecarStatus.screenshotArtifacts && sidecarStatus.executionControl
              ? '截图证据和执行控制可用。'
              : '截图证据或执行控制不可用。',
        },
      ],
    };
  }

  async getHealth(
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineHealth> {
    await this.ensureTaskStore();
    const tasks = [...this.tasks.values()];
    const now = new Date().toISOString();
    const capabilities = await this.getFastCapabilities(now, user);
    const blockers = capabilities
      .filter(
        (capability) =>
          capability.required !== false &&
          ['blocked', 'missing', 'degraded'].includes(capability.status),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));

    return {
      online: true,
      ready: blockers.length === 0,
      requiredBlocked: blockers.length,
      blockers,
      service: 'ai-content-local-engine',
      version: '0.1.0',
      mode: 'live',
      // engineUrl = 'internal://' 前缀：表示"我本身就是 local-engine，没有指向外部 runtime"
      // 8001 (kaypal-runtime) 已下线；Node Runtime 模式下 Agent-S 在 3011 进程内提供兼容 API。
      engineUrl: 'internal://ai-content/local-engine',
      engineNote: this.useNodeAgentRuntime()
        ? '内嵌：本机助手服务即本进程；Agent-S API 走包内 Node Runtime；外部 17777 sidecar 不是必需服务'
        : '内嵌：本机助手服务即本进程；Agent-S API 走旧 17777 sidecar；无外部 8001 runtime',
      checkedAt: now,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      queue: {
        running: tasks.filter((task) => task.status === 'running').length,
        waitingForApproval: tasks.filter(
          (task) => task.status === 'waiting_for_send_confirmation',
        ).length,
        completed: tasks.filter((task) => task.status === 'completed').length,
        failed: tasks.filter(
          (task) => task.status === 'failed' || task.status === 'blocked',
        ).length,
      },
      capabilities,
    };
  }

  private async getFastCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]> {
    const playwrightStatus = this.playwrightMcp
      ? await this.withCapabilityTimeout(
          'playwright-mcp',
          this.playwrightMcp.getAutomationStatus(),
          {
            online: false,
            childProcessRunning: Boolean(
              this.playwrightMcp?.getStatus().childProcessRunning,
            ),
            transport: 'none' as const,
            endpoint: '',
            pid: this.playwrightMcp?.getStatus().pid,
            toolCount: 0,
            profileKey: this.playwrightMcp?.getStatus().profileKey,
            profileDir: this.playwrightMcp?.getStatus().profileDir,
            visibleWindow:
              this.playwrightMcp?.getStatus().visibleWindow ?? false,
            isolated: this.playwrightMcp?.getStatus().isolated ?? false,
            readyForAutomation: false,
            requiredToolsReady: false,
            requiredTools: [],
            missingRequiredTools: [],
            message: 'playwright-mcp 工具发现超时',
          },
        )
      : undefined;
    const useNodeRuntime = this.useNodeAgentRuntime();
    const nodeRuntimeInjected = Boolean(this.nodeAgentRuntime);
    const wechatSessionLocked =
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt;
    const hasKaypalUser = Boolean(user?.kaypalUserId);
    const hasCommercialSignal =
      user?.commercialExecutionAllowed === true ||
      user?.planMode === 'commercial' ||
      Boolean(user?.kaypalPlan && user.kaypalPlanExpired !== true);
    const agentSCapability: LocalEngineCapability = useNodeRuntime
      ? {
          key: 'agent-s-sidecar',
          name: 'Agent-S 执行能力',
          status: nodeRuntimeInjected ? 'optional' : 'blocked',
          required: !nodeRuntimeInjected,
          summary: nodeRuntimeInjected
            ? 'Node Agent Runtime 已注入；快速健康检查不递归调用真实执行器状态。'
            : 'Node Runtime 模式已启用，但 NodeAgentRuntimeService 未注入。',
          checkedAt: now,
          nextAction: nodeRuntimeInjected
            ? '需要确认真实执行器、截图证据和浏览器控制时查看 /api/agent-s/status 或完整运行检查。'
            : '检查 RuntimeModule 与 LocalEngineModule 的依赖装配。',
          checks: [
            {
              name: 'NodeAgentRuntimeService',
              status: nodeRuntimeInjected ? 'optional' : 'blocked',
              message: nodeRuntimeInjected
                ? '服务已注入；真实执行细节由 Agent-S 状态接口和 readiness 负责。'
                : '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
            },
          ],
        }
      : {
          key: 'agent-s-sidecar',
          name: 'Agent-S 执行能力',
          status: 'optional',
          required: false,
          summary:
            '旧 sidecar 模式需要完整检查确认 runner_mode=real；快速健康检查不阻塞等待 17777。',
          checkedAt: now,
          nextAction:
            '查看完整运行检查或 /api/agent-s/status；mock、不可达或缺少执行控制必须修复。',
          checks: [
            {
              name: '17777 sidecar',
              status: 'optional',
              message:
                '旧实现需要外部 sidecar，但快速检查不阻塞等待；完整 readiness 会读取真实状态。',
            },
          ],
        };
    return [
      {
        key: 'browser-control',
        name: '浏览器引擎',
        status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightStatus?.readyForAutomation
          ? `本地浏览器控制已启动（pid=${playwrightStatus.pid ?? '?'}）。`
          : '本地浏览器引擎未就绪，不能执行真实平台读取、发送和回读。',
        checkedAt: now,
        nextAction: playwrightStatus?.readyForAutomation
          ? ''
          : '检查包内 Playwright Chromium、@playwright/mcp 和 3011 启动日志。',
        checks: [
          {
            name: 'playwright-mcp',
            status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
            message:
              playwrightStatus?.message || '未检测到 playwright-mcp 状态。',
          },
        ],
      },
      {
        key: 'interaction-capabilities',
        name: '真实互动执行器',
        status: this.runtimeOrchestrator ? 'optional' : 'blocked',
        required: !this.runtimeOrchestrator,
        summary: this.runtimeOrchestrator
          ? '快速健康检查不下发真实互动任务；完整 readiness 会检查各平台 executor。'
          : 'RuntimeOrchestrator 未注入，真实互动执行器不可用。',
        checkedAt: now,
        nextAction: this.runtimeOrchestrator
          ? '查看 /local-engine/readiness 的完整 executor 结果。'
          : '检查 RuntimeModule 与 LocalEngineModule 装配。',
        checks: [
          {
            name: '执行入口',
            status: this.runtimeOrchestrator ? 'optional' : 'blocked',
            message: this.runtimeOrchestrator
              ? '已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。'
              : 'RuntimeOrchestrator 模块未连接。',
          },
        ],
      },
      {
        key: 'kaypal-entitlement',
        name: 'Kaypal 账号与权益',
        status: hasKaypalUser ? 'optional' : 'blocked',
        required: false,
        summary: hasKaypalUser
          ? hasCommercialSignal
            ? '已读取本地 Kaypal 登录态和套餐信号；云端套餐、积分余额和授权有效期由完整检查或真实扣点动作确认。'
            : '已读取本地 Kaypal 登录态；未在健康接口中确认商用套餐和积分余额。'
          : '快速健康检查未读取到 Kaypal 用户上下文；完整检查会给出登录和权益处理建议。',
        checkedAt: now,
        nextAction:
          '需要确认套餐、积分余额或外部授权时运行完整检查；真实采集/扣点接口会按云端授权拦截。',
        checks: [
          {
            name: '本地登录态',
            status: hasKaypalUser ? 'optional' : 'blocked',
            message: hasKaypalUser
              ? `本地会话已绑定 Kaypal 用户 ${user?.kaypalUserId}；未在健康接口中请求云端余额。`
              : '当前请求没有可用 Kaypal 用户上下文。',
          },
          {
            name: '积分余额',
            status: 'optional',
            message:
              '健康接口不再读取云端积分余额，避免系统首页被外部授权/网络拖慢。',
          },
        ],
      },
      {
        key: 'ai-reply-model',
        name: 'AI 回复模型',
        status: 'optional',
        required: false,
        summary:
          '默认模型配置不在快速健康检查里读取；需要生成回复时由具体任务和完整检查确认。',
        checkedAt: now,
        nextAction:
          '到模型配置或完整运行检查确认文章创作/选题/互动回复模型是否已同步。',
        checks: [
          {
            name: '默认模型配置',
            status: 'optional',
            message:
              '已跳过数据库和模型平台检查；真实 AI 任务会在执行前校验模型授权。',
          },
        ],
      },
      {
        key: 'desktop-control',
        name: '桌面控制',
        status: wechatSessionLocked ? 'ready' : 'optional',
        required: false,
        summary: wechatSessionLocked
          ? `已锁定微信联系人：${this.wechatSessionConfirmation.targetContact?.trim()}。`
          : '桌面微信状态不在快速健康检查里执行 AppleScript 探测；完整检查会确认窗口、权限和截图能力。',
        checkedAt: now,
        nextAction: wechatSessionLocked
          ? '微信任务仍会在发送/发布前回读目标和内容。'
          : '需要跑微信任务前先运行完整检查或进入桌面能力页确认权限。',
        checks: [
          {
            name: '联系人锁定',
            status: wechatSessionLocked ? 'ready' : 'optional',
            message: wechatSessionLocked
              ? '当前联系人、窗口和草稿确认状态已锁定。'
              : '快速健康检查未触发桌面窗口读取。',
          },
        ],
      },
      {
        key: 'mcp-manager',
        name: 'Playwright/MCP 工具',
        status: playwrightStatus?.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightStatus?.readyForAutomation
          ? `playwright-mcp sidecar 在线（${playwrightStatus.message}）。`
          : 'playwright-mcp 未就绪；浏览器自动化工具不可用。',
        checkedAt: now,
        nextAction: playwrightStatus?.readyForAutomation
          ? `MCP 端点 ${playwrightStatus.endpoint}；工具数 ${playwrightStatus.toolCount ?? 0}。`
          : '检查 3011 启动日志或在运行检查的浏览器页单独刷新 MCP 状态。',
        checks: [
          {
            name: 'sidecar 进程',
            status: playwrightStatus?.childProcessRunning ? 'ready' : 'blocked',
            message: playwrightStatus?.childProcessRunning
              ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightStatus.pid ?? '?'})`
              : '子进程未启动或正在启动。',
          },
          {
            name: 'HTTP 端点',
            status: playwrightStatus?.online ? 'ready' : 'blocked',
            message: playwrightStatus?.endpoint || '端点未就绪。',
          },
          {
            name: '浏览器工具',
            status: playwrightStatus?.requiredToolsReady ? 'ready' : 'blocked',
            message: playwrightStatus?.requiredToolsReady
              ? `${playwrightStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
              : `缺少必需工具：${(playwrightStatus?.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      agentSCapability,
      {
        key: 'wechat-execution',
        name: '微信完整执行链',
        status: wechatSessionLocked ? 'ready' : 'optional',
        required: false,
        summary: wechatSessionLocked
          ? '微信会话已锁定，执行链仍会在动作前做回读和确认。'
          : '微信执行链的进程、窗口、权限和截图能力只在完整检查或具体任务前校验。',
        checkedAt: now,
        nextAction:
          '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。',
        checks: [
          {
            name: '微信进程检测',
            status: 'optional',
            message:
              '快速健康检查未读取桌面进程，避免首页触发系统权限弹窗或超时。',
          },
          {
            name: '受控执行',
            status: 'ready',
            message: '微信任务只在确认后执行真实发送、发布、评论或加好友。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary:
          '远程任务通道保留会话、审计和证据字段；本机 AI 员工任务不依赖远程接管。',
        checkedAt: now,
        nextAction:
          '本机任务按当前电脑的浏览器、桌面微信和发布执行器状态判断。',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '远程接管不是当前本机执行必需条件。',
          },
          {
            name: '用户接管审计',
            status: 'ready',
            message: 'Agent 会话已保留接管审计字段。',
          },
        ],
      },
      {
        key: 'plugin-runtime',
        name: '插件与技能运行时',
        status: 'optional',
        required: false,
        summary: '插件和技能目录不在快速健康检查里做磁盘扫描，避免启动页卡顿。',
        checkedAt: now,
        nextAction: '需要诊断插件时进入后续插件页或单独运行插件检查。',
        checks: [
          {
            name: '插件目录',
            status: 'optional',
            message: '快速健康检查已跳过目录扫描。',
          },
          {
            name: '插件运行',
            status: 'optional',
            message: '插件执行不影响当前内容生产和客户互动主流程。',
          },
        ],
      },
      {
        key: 'memory-context',
        name: '记忆与上下文',
        status: 'optional',
        required: false,
        summary:
          '记忆系统不在快速健康检查里访问外部 Runtime，避免无配置时误报阻塞。',
        checkedAt: now,
        nextAction: '需要长期记忆时再配置 Redis/向量库或 Kaypal Runtime。',
        checks: [
          {
            name: '消息历史',
            status: 'optional',
            message: '快速健康检查未访问记忆服务。',
          },
          {
            name: '上下文压缩',
            status: 'optional',
            message: '向量库状态不影响当前本地发布和互动主流程。',
          },
        ],
      },
      {
        key: 'sandbox-execution',
        name: '沙箱执行',
        status: 'optional',
        required: false,
        summary:
          '当前一键桌面版不要求用户安装 Docker；沙箱执行保留为下一阶段能力。',
        checkedAt: now,
        nextAction: '本地用户安装包优先使用内置 Node Runtime，不依赖 Docker。',
        checks: [
          {
            name: '平台适配',
            status: 'optional',
            message: '未在快速健康检查中探测 Docker 或 native 沙箱。',
          },
          {
            name: '执行边界',
            status: 'optional',
            message: '当前主流程通过任务风险边界和证据链控制。',
          },
        ],
      },
      {
        key: 'evidence-replay',
        name: '证据链与回放',
        status: 'optional',
        required: false,
        summary:
          '证据链结构已接入；快速健康检查不扫描本地证据目录和任务记录表。',
        checkedAt: now,
        nextAction: '需要确认历史证据、截图和诊断包时运行完整检查。',
        checks: [
          {
            name: '截图证据',
            status: 'optional',
            message: '快速健康检查未访问截图目录。',
          },
          {
            name: '步骤回放',
            status: 'optional',
            message: '快速健康检查未访问任务记录和 evidenceReplay 结构。',
          },
        ],
      },
      {
        key: 'file-access',
        name: '文件访问',
        status: 'optional',
        required: false,
        summary:
          '素材、账号档案和证据目录读写不在快速健康检查里扫描；文件页会做完整验证。',
        checkedAt: now,
        nextAction: '进入文件访问页或运行完整检查确认目录读写权限。',
        checks: [
          {
            name: '目录读写检查',
            status: 'optional',
            message: '快速健康检查已跳过本地目录扫描。',
          },
        ],
      },
      {
        key: 'permission-check',
        name: '权限检查',
        status: 'ready',
        summary: '接口权限由 Kaypal 登录态和套餐守卫实时拦截。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '套餐权限',
            status: 'ready',
            message: '本地接口使用 AuthGuard 注入的 Kaypal 套餐判断。',
          },
        ],
      },
    ];
  }

  async saveInteractionAsset(file: AutoUploadUploadFile | undefined) {
    if (!file) {
      throw new BadRequestException('请选择朋友圈图片素材');
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('图片素材为空，不能用于发布');
    }
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('朋友圈素材必须是图片文件');
    }
    const maxBytes = 30 * 1024 * 1024;
    if (file.buffer.length > maxBytes) {
      throw new BadRequestException('朋友圈图片不能超过 30MB');
    }

    const assetDir = resolveProjectLogPath('interaction-assets');
    await mkdir(assetDir, { recursive: true });

    const fallbackExt =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg';
    const ext = extname(file.originalname || '').toLowerCase() || fallbackExt;
    const safeBaseName =
      (file.originalname || 'moments-asset')
        .replace(extname(file.originalname || ''), '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'moments-asset';
    const filename = `${Date.now()}-${safeBaseName}${ext}`;
    const filepath = join(assetDir, filename);

    await writeFile(filepath, file.buffer);

    return {
      filename,
      filepath,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      uploadedAt: new Date().toISOString(),
    };
  }

  async getWechatContacts(): Promise<WechatContactsResult> {
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      (lastFailure?.diagnostics as unknown) || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    return this.buildWechatContactsResult(cached);
  }

  async getWechatContactsReadiness(): Promise<WechatContactsReadinessResult> {
    const checkedAt = new Date().toISOString();
    const platformName = this.getRuntimePlatform();
    const nativeRuntimePath = this.resolveWechatNativeRuntimePath();
    const enginePath = this.resolveWechatEnginePath();
    const sqlitePath = this.resolveWechatSqliteCliPath();
    const dbHelperPath = this.resolveWechatDbHelperPath();
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      (lastFailure?.diagnostics as unknown) || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    const checks: WechatContactsReadinessCheck[] = [];
    const addCheck = (check: WechatContactsReadinessCheck) => {
      checks.push(check);
    };

    addCheck({
      key: 'platform',
      name: '桌面系统',
      status:
        platformName === 'win32'
          ? 'ready'
          : platformName === 'darwin'
            ? 'ready'
            : 'blocked',
      message:
        platformName === 'win32'
          ? '当前是 Windows，可执行微信通讯录同步。'
          : platformName === 'darwin'
            ? '当前是 macOS，可通过已登录的微信窗口同步通讯录。'
            : '当前系统不支持微信桌面通讯录同步。',
      nextAction:
        platformName === 'win32' || platformName === 'darwin'
          ? undefined
          : '请切换到已登录微信的 macOS 或 Windows 桌面系统。',
      details: { platform: platformName },
    });

    let nativeDiagnostics: WechatContactsSyncDiagnostics | undefined;
    if (platformName === 'win32') {
      addCheck({
        key: 'native-runtime',
        name: 'Kaypal 原生通讯录运行时',
        status: nativeRuntimePath ? 'ready' : 'warning',
        message: nativeRuntimePath
          ? '已找到 native runtime，会优先使用数据库/UIA 组合采集。'
          : '未找到 native runtime，会退回 legacy engine 或 PowerShell/OCR。',
        nextAction: nativeRuntimePath
          ? undefined
          : '请安装包含 desktop/runtime/wechat-native-runtime 的完整安装包。',
        details: nativeRuntimePath ? { path: nativeRuntimePath } : undefined,
      });

      addCheck({
        key: 'legacy-engine',
        name: 'Legacy 微信引擎',
        status: enginePath ? 'ready' : 'warning',
        message: enginePath
          ? '已找到 legacy wechat-engine，可作为 native runtime 失败后的备用通道。'
          : '未找到 legacy wechat-engine，只能依赖 PowerShell/OCR 兜底。',
        nextAction: enginePath
          ? undefined
          : '请确认安装包内带有 desktop/runtime/wechat-engine。',
        details: enginePath ? { path: enginePath } : undefined,
      });

      addCheck({
        key: 'sqlite-cli',
        name: 'SQLite 读取工具',
        status: sqlitePath ? 'ready' : 'warning',
        message: sqlitePath
          ? '已找到 sqlite3，可读取明文 contact.db。'
          : '未找到 sqlite3，明文数据库通道会跳过。',
        nextAction: sqlitePath
          ? undefined
          : '请随安装包携带 sqlite3.exe，或配置 AI_CONTENT_SQLITE_EXE。',
        details: sqlitePath ? { path: sqlitePath } : undefined,
      });

      addCheck({
        key: 'db-helper',
        name: '微信数据库 helper',
        status: dbHelperPath ? 'ready' : 'warning',
        message: dbHelperPath
          ? '已找到微信数据库 helper，可提升联系人读取成功率。'
          : '未找到微信数据库 helper，加密数据库只能靠 native runtime 或 UIA/OCR。',
        nextAction: dbHelperPath
          ? undefined
          : '请随安装包携带 wechat-db-helper/wechat-dump-rs，或配置 AI_CONTENT_WECHAT_DB_HELPER。',
        details: dbHelperPath ? { path: dbHelperPath } : undefined,
      });

      if (nativeRuntimePath) {
        nativeDiagnostics =
          await this.probeWechatNativeContactRuntime(nativeRuntimePath);
        if (nativeDiagnostics) {
          const hasBlockingSignal =
            /blocked|failed|error/i.test(
              nativeDiagnostics.platformStatus || '',
            ) ||
            /blocked|failed|error/i.test(
              nativeDiagnostics.windowStatus || '',
            ) ||
            /blocked|failed|error/i.test(nativeDiagnostics.helperStatus || '');
          addCheck({
            key: 'native-diagnose',
            name: 'Native runtime 诊断',
            status: hasBlockingSignal ? 'warning' : 'ready',
            message: hasBlockingSignal
              ? 'Native runtime 可启动，但诊断里有异常信号。'
              : 'Native runtime 诊断命令可启动并返回结构化结果。',
            nextAction: hasBlockingSignal
              ? '请先处理诊断里的窗口、权限或 helper 异常，再同步联系人。'
              : undefined,
            details: {
              stage: nativeDiagnostics.stage,
              windowStatus: nativeDiagnostics.windowStatus,
              dbStatus: nativeDiagnostics.dbStatus,
              helperStatus: nativeDiagnostics.helperStatus,
              uiaStatus: nativeDiagnostics.uiaStatus,
            },
          });
        } else {
          addCheck({
            key: 'native-diagnose',
            name: 'Native runtime 诊断',
            status: 'warning',
            message: 'Native runtime 存在，但诊断命令没有返回可解析结果。',
            nextAction: '安装包需要重新检查 native runtime 是否完整可执行。',
          });
        }
      }
    }

    if (platformName === 'darwin') {
      addCheck(this.buildMacWechatToolReadinessCheck());
    }

    addCheck(
      this.buildWechatNativeCommandRunnerReadinessCheck(
        platformName === 'darwin'
          ? this.resolveMacWechatCommandRunners()
          : nativeDiagnostics?.externalCommandRunners ||
              lastDiagnostics?.externalCommandRunners ||
              cached.diagnostics?.externalCommandRunners,
        platformName,
      ),
    );

    const cachedContactsNeedReview =
      /low-confidence|needs-review|review-required/i.test(
        [cached.diagnostics?.uiaStatus, ...(cached.diagnostics?.warnings || [])]
          .filter(Boolean)
          .join(' '),
      );
    addCheck({
      key: 'cached-contacts',
      name: '本地联系人缓存',
      status: cached.items.length
        ? cachedContactsNeedReview
          ? 'warning'
          : 'ready'
        : 'warning',
      message: cached.items.length
        ? cachedContactsNeedReview
          ? `本机已有 ${cached.items.length} 个联系人，来自窗口文字识别，使用前需要复核姓名。`
          : `本机已有 ${cached.items.length} 个联系人缓存。`
        : '本机还没有可用联系人缓存。',
      nextAction: cached.items.length
        ? cachedContactsNeedReview
          ? '请在微信工作台复核联系人姓名，删除误识别项后再用于批量任务。'
          : undefined
        : '首次使用请先点“同步联系人”，成功后群发/朋友圈营销才能直接填入名单。',
      details: {
        count: cached.items.length,
        source: cached.source,
        syncedAt: cached.syncedAt,
      },
    });

    if (lastFailure) {
      const lastFailureMessage =
        this.wechatContactSyncLastFailureMessage(
          lastFailure,
          lastDiagnostics,
          platformName,
        ) || '存在最近一次失败诊断。';
      addCheck({
        key: 'last-failure',
        name: '最近一次同步失败',
        status: 'warning',
        message: lastFailureMessage,
        nextAction: '点“导出诊断”把最近一次失败记录导出来排查。',
        details: {
          stage: lastDiagnostics?.stage,
          source: lastDiagnostics?.source,
          failureReason: lastDiagnostics?.failureReason,
          fallbackReason: lastDiagnostics?.fallbackReason,
          screenshotPath: lastDiagnostics?.screenshotPath,
        },
      });
    }

    const blockers = checks.filter((check) => check.status === 'blocked');
    const warnings = checks.filter((check) => check.status === 'warning');
    const status = blockers.length
      ? 'blocked'
      : warnings.length
        ? 'warning'
        : 'ready';

    return {
      ready: !blockers.length,
      status,
      checkedAt,
      platform: platformName,
      modeSupport: {
        random: platformName === 'win32' || platformName === 'darwin',
        all: platformName === 'win32' || platformName === 'darwin',
      },
      cached: {
        count: cached.items.length,
        source: cached.source,
        syncedAt: cached.syncedAt,
      },
      paths: {
        nativeRuntimePath,
        enginePath,
        sqlitePath,
        dbHelperPath,
      },
      checks,
      blockers,
      warnings,
      diagnostics: lastDiagnostics || cached.diagnostics,
      lastFailure,
      nextAction: blockers.length
        ? blockers[0].nextAction || blockers[0].message
        : warnings.length
          ? warnings[0].nextAction || warnings[0].message
          : '可以同步联系人。',
    };
  }

  async syncWechatContacts(
    input: boolean | WechatContactsSyncInput = false,
  ): Promise<WechatContactsResult> {
    const force = typeof input === 'boolean' ? input : Boolean(input?.force);
    const mode = this.normalizeWechatContactsSyncMode(
      typeof input === 'boolean' ? undefined : input?.mode,
    );
    const runtimePlatform = this.getRuntimePlatform();
    if (runtimePlatform !== 'darwin' && runtimePlatform !== 'win32') {
      throw new BadRequestException(
        '当前通讯录同步仅支持 macOS/Windows 微信桌面版，请在已登录微信的桌面系统上重试。',
      );
    }
    const lastFailure = await this.readWechatContactSyncDiagnosticsFile();
    const lastDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      (lastFailure?.diagnostics as unknown) || lastFailure,
    );
    const cached = this.withWechatContactsCacheAccountGuard(
      await this.readWechatContactsCache(),
      lastDiagnostics,
    );
    if (!force && cached.items.length && cached.syncedAt) {
      return {
        ...this.buildWechatContactsResult(cached),
        cached: true,
      };
    }

    let result: Record<string, unknown>;
    try {
      result =
        runtimePlatform === 'win32'
          ? await this.runWechatWindowsContactSyncScript(mode)
          : await this.runWechatContactSyncScript(
              this.resolveWechatContactSyncScriptPath(),
              mode,
            );
    } catch (error) {
      if (runtimePlatform === 'win32') {
        const visionResult =
          await this.tryRunWechatContactVisionFallback(error);
        if (visionResult) {
          result = visionResult;
        } else {
          const cachedFallback =
            await this.buildWechatContactsCacheFallbackResult(
              cached,
              error,
              runtimePlatform,
              mode,
            );
          if (cachedFallback) {
            return cachedFallback;
          }
          throw this.toWechatContactsSyncException(error, runtimePlatform);
        }
      } else {
        const cachedFallback =
          await this.buildWechatContactsCacheFallbackResult(
            cached,
            error,
            runtimePlatform,
            mode,
          );
        if (cachedFallback) {
          return cachedFallback;
        }
        if (force) {
          const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
            (error as { diagnostics?: unknown })?.diagnostics,
          );
          if (this.isWechatContactCacheAccountMismatch(cached, diagnostics)) {
            const message = this.humanizeWechatContactSyncErrorMessage(
              error,
              runtimePlatform,
            );
            return this.buildWechatContactsBlockedResult(
              cached,
              message,
              diagnostics,
              diagnostics?.source || 'wechat-contact-cache-account-guard',
              mode,
              { includeCachedItems: false },
            );
          }
        }
        throw this.toWechatContactsSyncException(error, runtimePlatform);
      }
    }
    const syncedAt = new Date().toISOString();
    const rawContactCandidates = this.extractWechatContactCandidateTexts(
      Array.isArray(result.items) ? result.items : result.contacts,
    );
    const contaminatedCandidates = rawContactCandidates.filter((item) =>
      /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/.test(
        item,
      ),
    );
    if (contaminatedCandidates.length) {
      throw new BadRequestException(
        `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${contaminatedCandidates.slice(0, 3).join('、')}`,
      );
    }
    const shellCandidates = rawContactCandidates
      .map((item) => item.trim())
      .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
    if (
      shellCandidates.length &&
      shellCandidates.length === rawContactCandidates.length
    ) {
      throw new BadRequestException(
        `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellCandidates.slice(0, 3).join('、')}`,
      );
    }
    const source =
      typeof result.source === 'string' ? result.source : 'macos-wechat-ocr';
    const normalizedResultDiagnostics =
      this.normalizeWechatContactsSyncDiagnostics(result.diagnostics, {
        source,
        screenshotPath:
          typeof result.screenshotPath === 'string'
            ? result.screenshotPath
            : '',
      });
    const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
      result,
      mode,
    );
    if (lowConfidenceReason) {
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        result.diagnostics,
        {
          source,
          failureLayer: 'quality-gate',
          failureReason: lowConfidenceReason,
          fallbackReason: lowConfidenceReason,
        },
      );
      const qualityGateError = new BadRequestException(
        `微信通讯录同步结果可信度不足，已拒绝覆盖本地名单：${lowConfidenceReason}`,
      ) as BadRequestException & { diagnostics?: unknown };
      qualityGateError.diagnostics = diagnostics;
      if (
        runtimePlatform !== 'win32' &&
        /微信账号标识|macOS OCR/i.test(lowConfidenceReason)
      ) {
        await this.buildWechatContactsBlockedResult(
          cached,
          lowConfidenceReason,
          diagnostics,
          source,
          mode,
          { includeCachedItems: false },
        );
        throw qualityGateError;
      }
      if (force && runtimePlatform === 'win32') {
        return this.buildWechatContactsBlockedResult(
          cached,
          lowConfidenceReason,
          diagnostics,
          source,
          mode,
          { includeCachedItems: false },
        );
      }
      const cachedFallback = await this.buildWechatContactsCacheFallbackResult(
        cached,
        qualityGateError,
        runtimePlatform,
        mode,
      );
      if (cachedFallback) {
        return cachedFallback;
      }
      return this.buildWechatContactsBlockedResult(
        cached,
        lowConfidenceReason,
        diagnostics,
        source,
        mode,
      );
    }
    const currentWechatId = this.resolveWechatContactAccountId(
      result,
      normalizedResultDiagnostics,
    );
    const plannedWechatId =
      typeof result.plannedWechatId === 'string'
        ? result.plannedWechatId
        : cached.plannedWechatId;
    const items = this.normalizeWechatContactList(
      Array.isArray(result.items) ? result.items : result.contacts,
      {
        syncedAt,
        currentWechatId,
        plannedWechatId,
      },
    );
    if (
      this.isPollutedWechatContactCandidateBatch(rawContactCandidates, source)
    ) {
      throw new BadRequestException(
        '微信通讯录同步结果疑似混入新闻、公众号或系统界面文字，已拒绝覆盖本地名单。',
      );
    }
    if (!items.length) {
      throw new BadRequestException(
        '微信通讯录同步没有读取到真实联系人，已拒绝覆盖本地名单。',
      );
    }
    const invalidContacts = items
      .flatMap((item) => [item.wxid, item.nickname, item.remark])
      .filter((item): item is string => Boolean(item))
      .filter((item) =>
        /抖音|发布中心|平台账号|视频工坊|内容素材|知识库|刷新状态|绑定平台/.test(
          item,
        ),
      );
    if (invalidContacts.length) {
      throw new BadRequestException(
        `微信通讯录同步结果包含非微信页面内容，已拒绝写入：${invalidContacts.slice(0, 3).join('、')}`,
      );
    }
    const shellContacts = items
      .map((item) => this.getWechatContactDisplay(item).trim())
      .filter((item) => /^(微信|WeChat|Weixin|通讯录|联系人)$/i.test(item));
    if (shellContacts.length) {
      throw new BadRequestException(
        `微信通讯录同步结果只包含窗口标题或导航文本，已拒绝写入：${shellContacts.slice(0, 3).join('、')}`,
      );
    }
    const cache = {
      source,
      items,
      currentWechatId,
      plannedWechatId,
      syncedAt,
      screenshotPath:
        typeof result.screenshotPath === 'string' ? result.screenshotPath : '',
      diagnostics: normalizedResultDiagnostics,
    };
    await this.writeWechatContactsCache(cache);
    await rm(this.getWechatContactsDiagnosticsPath(), { force: true }).catch(
      () => undefined,
    );

    return {
      ...this.buildWechatContactsResult(cache),
      cached: false,
    };
  }

  private resolveWechatContactAccountId(
    result: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    fallback = '',
  ) {
    return (
      this.optionalTrimmedText(result?.currentWechatId) ||
      this.optionalTrimmedText(result?.current_wechat_id) ||
      this.optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
      this.optionalTrimmedText(diagnostics?.selectedDbBaseWxid) ||
      this.optionalTrimmedText(fallback) ||
      undefined
    );
  }

  private isWechatContactsLegacyAccountlessRuntimeCache(input: {
    source?: string;
    items?: WechatContact[];
    currentWechatId?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }) {
    if (!input.items?.length) {
      return false;
    }
    if (this.optionalTrimmedText(input.currentWechatId)) {
      return false;
    }
    if (
      this.optionalTrimmedText(input.diagnostics?.selectedDbAccountFolder) ||
      this.optionalTrimmedText(input.diagnostics?.selectedDbBaseWxid)
    ) {
      return false;
    }
    const sourceText = [
      input.source,
      input.diagnostics?.source,
      input.diagnostics?.resultSource,
      input.diagnostics?.stage,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      /wechat/i.test(sourceText) &&
      /windows|win32|native|helper|db|decrypted|ocr|uia|macos/i.test(sourceText)
    );
  }

  private isWechatContactCacheAccountMismatch(
    cached: {
      currentWechatId?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ) {
    const cachedAccount =
      this.optionalTrimmedText(cached.currentWechatId) ||
      this.optionalTrimmedText(cached.diagnostics?.selectedDbAccountFolder) ||
      this.optionalTrimmedText(cached.diagnostics?.selectedDbBaseWxid);
    const activeAccount =
      this.optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
      this.optionalTrimmedText(diagnostics?.selectedDbBaseWxid);
    return Boolean(
      cachedAccount && activeAccount && cachedAccount !== activeAccount,
    );
  }

  private withWechatContactsCacheAccountGuard(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    diagnostics?: WechatContactsSyncDiagnostics,
  ) {
    if (!this.isWechatContactCacheAccountMismatch(cached, diagnostics)) {
      return cached;
    }
    return {
      ...cached,
      source: 'empty',
      items: [],
      syncedAt: undefined,
      screenshotPath: undefined,
      diagnostics: {
        ...(cached.diagnostics || {}),
        ...(diagnostics || {}),
        source: 'wechat-contact-cache-account-guard',
        stage: 'cache-account-mismatch',
        failureReason:
          '当前微信账号和本地联系人缓存账号不一致，已拒绝展示旧缓存。',
        warnings: this.mergeWechatDiagnosticStringArrays(
          cached.diagnostics?.warnings,
          diagnostics?.warnings,
          ['当前微信账号和本地联系人缓存账号不一致，已拒绝展示旧缓存。'],
        ),
      },
    };
  }

  private async buildWechatContactsCacheFallbackResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
    mode: WechatContactsSyncMode,
  ): Promise<WechatContactsResult | null> {
    if (!cached.items.length) {
      return null;
    }
    const fallbackReason = this.humanizeWechatContactSyncErrorMessage(
      error,
      runtimePlatform,
    );
    const errorDiagnostics = this.normalizeWechatContactsSyncDiagnostics(
      (error as { diagnostics?: unknown })?.diagnostics,
      {
        source: 'wechat-contact-cache-fallback',
        stage: 'sync-cache-fallback',
        fallbackReason,
      },
    );
    if (this.shouldBlockWechatContactCacheFallback(errorDiagnostics)) {
      return this.buildWechatContactsBlockedResult(
        cached,
        fallbackReason,
        errorDiagnostics,
        errorDiagnostics?.source || 'wechat-contact-cache-blocked',
        mode,
        { includeCachedItems: false },
      );
    }
    if (this.isWechatContactCacheAccountMismatch(cached, errorDiagnostics)) {
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        fallback: 'blocked-account-mismatch',
        mode,
        error: '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。',
        cachedCount: cached.items.length,
        diagnostics: {
          ...(errorDiagnostics || {}),
          source: 'wechat-contact-cache-fallback',
          stage: 'sync-cache-account-mismatch',
          fallbackReason,
          failureReason:
            '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。',
        },
        capturedAt: new Date().toISOString(),
      });
      return null;
    }
    const diagnostics: WechatContactsSyncDiagnostics = {
      ...(cached.diagnostics || {}),
      ...(errorDiagnostics || {}),
      source: 'wechat-contact-cache-fallback',
      stage: 'sync-cache-fallback',
      fallbackReason,
      warnings: this.mergeWechatDiagnosticStringArrays(
        cached.diagnostics?.warnings,
        errorDiagnostics?.warnings,
        [
          '本次同步没有拿到新的通讯录结果，已保留本地联系人缓存。',
          fallbackReason,
        ],
      ),
    };
    const fallbackCache = {
      ...cached,
      diagnostics,
    };
    await this.writeWechatContactsCache(fallbackCache);
    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      fallback: 'cache',
      mode,
      error: fallbackReason,
      cachedCount: cached.items.length,
      diagnostics,
      capturedAt: new Date().toISOString(),
    });
    return {
      ...this.buildWechatContactsResult(fallbackCache),
      cached: true,
      syncFallbackReason: fallbackReason,
    };
  }

  private async buildWechatContactsBlockedResult(
    cached: {
      source: string;
      items: WechatContact[];
      currentWechatId?: string;
      plannedWechatId?: string;
      syncedAt?: string;
      screenshotPath?: string;
      diagnostics?: WechatContactsSyncDiagnostics;
    },
    reason: string,
    diagnosticsInput: WechatContactsSyncDiagnostics | null | undefined,
    source: string,
    mode: WechatContactsSyncMode,
    options: { includeCachedItems?: boolean } = {},
  ): Promise<WechatContactsResult> {
    const cacheAccountMismatch = this.isWechatContactCacheAccountMismatch(
      cached,
      diagnosticsInput || undefined,
    );
    const includeCachedItems =
      options.includeCachedItems !== false && !cacheAccountMismatch;
    const blockedItems = includeCachedItems ? cached.items : [];
    const diagnostics: WechatContactsSyncDiagnostics = {
      ...(cached.diagnostics || {}),
      ...(diagnosticsInput || {}),
      source:
        source || diagnosticsInput?.source || 'wechat-contact-sync-blocked',
      stage: diagnosticsInput?.stage || 'sync-quality-gate',
      fallbackReason: reason,
      failureReason: reason,
      failureLayer: 'quality-gate',
      warnings: this.mergeWechatDiagnosticStringArrays(
        cached.diagnostics?.warnings,
        diagnosticsInput?.warnings,
        [
          '本次同步结果不可信，已拒绝覆盖本地联系人。',
          cacheAccountMismatch
            ? '当前微信账号和本地联系人缓存账号不一致，已拒绝使用旧缓存。'
            : '',
          reason,
        ],
      ),
    };

    await this.writeWechatContactSyncDiagnostics({
      ok: false,
      fallback: blockedItems.length ? 'cache' : 'blocked',
      mode,
      error: reason,
      cachedCount: blockedItems.length,
      diagnostics,
      capturedAt: new Date().toISOString(),
    });

    return {
      ...this.buildWechatContactsResult({
        source: blockedItems.length
          ? cached.source
          : diagnostics.source || source,
        items: blockedItems,
        currentWechatId: blockedItems.length
          ? cached.currentWechatId
          : undefined,
        plannedWechatId: blockedItems.length
          ? cached.plannedWechatId
          : undefined,
        syncedAt: blockedItems.length ? cached.syncedAt : undefined,
        screenshotPath:
          diagnostics.screenshotPath ||
          (blockedItems.length ? cached.screenshotPath : ''),
        diagnostics,
      }),
      cached: blockedItems.length > 0,
      syncFallbackReason: reason,
    };
  }

  private normalizeWechatContactsSyncMode(
    value: unknown,
  ): WechatContactsSyncMode {
    return value === 'all' ? 'all' : 'random';
  }

  async upsertWechatContact(
    input: UpsertWechatContactInput,
  ): Promise<WechatContactsResult> {
    const cached = await this.readWechatContactsCache();
    const now = new Date().toISOString();
    const contact = this.normalizeWechatContact(input, {
      updatedAt: now,
      createdAt: now,
    });
    if (!contact) {
      throw new BadRequestException('请填写微信 wxid、昵称或备注。');
    }
    const existing = cached.items.find((item) => item.wxid === contact.wxid);
    const merged: WechatContact = existing
      ? {
          ...existing,
          ...contact,
          nickname: contact.nickname ?? existing.nickname,
          remark: contact.remark ?? existing.remark,
          tags: contact.tags.length ? contact.tags : existing.tags,
          currentWechatId: contact.currentWechatId ?? existing.currentWechatId,
          plannedWechatId: contact.plannedWechatId ?? existing.plannedWechatId,
          syncedAt: contact.syncedAt || existing.syncedAt,
          createdAt: existing.createdAt,
          updatedAt: now,
        }
      : contact;
    const items = existing
      ? cached.items.map((item) => (item.wxid === merged.wxid ? merged : item))
      : [...cached.items, merged];
    const cache = {
      ...cached,
      source: cached.source === 'empty' ? 'local-cache' : cached.source,
      items,
    };
    await this.writeWechatContactsCache(cache);
    return this.buildWechatContactsResult(cache);
  }

  async removeWechatContact(wxid: string): Promise<WechatContactsResult> {
    const normalizedWxid = String(wxid || '').trim();
    if (!normalizedWxid) {
      throw new BadRequestException('请提供要删除的微信联系人 wxid。');
    }
    const cached = await this.readWechatContactsCache();
    const items = cached.items.filter((item) => item.wxid !== normalizedWxid);
    const cache = { ...cached, items };
    await this.writeWechatContactsCache(cache);
    return this.buildWechatContactsResult(cache);
  }

  async clearWechatContacts(): Promise<WechatContactsResult> {
    const cached = await this.readWechatContactsCache();
    const cache = {
      ...cached,
      source: 'local-cache',
      items: [],
      syncedAt: new Date().toISOString(),
    };
    await this.writeWechatContactsCache(cache);
    return this.buildWechatContactsResult(cache);
  }

  async exportWechatContacts(): Promise<WechatContactsExportResult> {
    const cached = await this.readWechatContactsCache();
    const exportedAt = new Date().toISOString();
    return {
      filename: `wechat-contacts-${exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json',
      content: JSON.stringify(this.buildWechatContactsResult(cached), null, 2),
      exportedAt,
      exportStatus: 'OK',
      count: cached.items.length,
    };
  }

  async exportWechatContactSyncDiagnostics(): Promise<WechatContactsDiagnosticsExportResult> {
    const exportedAt = new Date().toISOString();
    try {
      const content = await readFile(
        this.getWechatContactsDiagnosticsPath(),
        'utf8',
      );
      return {
        filename: `wechat-contact-sync-diagnostics-${exportedAt.slice(0, 10)}.json`,
        mimeType: 'application/json',
        content,
        exportedAt,
        exists: true,
      };
    } catch {
      return {
        filename: `wechat-contact-sync-diagnostics-${exportedAt.slice(0, 10)}.json`,
        mimeType: 'application/json',
        content: JSON.stringify(
          {
            exists: false,
            exportedAt,
            message: '还没有 Windows 微信通讯录同步失败诊断记录。',
          },
          null,
          2,
        ),
        exportedAt,
        exists: false,
      };
    }
  }

  async getWechatChatSessions(): Promise<WechatChatSessionsResult> {
    const cache = await this.readWechatChatHistoryCache();
    return this.buildWechatChatSessionsResult(cache, {
      cached: Boolean(cache.syncedAt || cache.sessions.length),
    });
  }

  async getWechatChatHistory(
    sessionId: string,
    limit?: number,
  ): Promise<WechatChatHistoryResult> {
    const safeSessionId = String(sessionId || '').trim();
    if (!safeSessionId) {
      throw new BadRequestException('请提供要读取的微信会话 sessionId。');
    }

    const safeLimit =
      Number.isFinite(limit) && Number(limit) > 0
        ? Math.min(Math.floor(Number(limit)), 500)
        : 100;
    const cache = await this.readWechatChatHistoryCache();
    const session = cache.sessions.find((item) => item.id === safeSessionId);
    const messages = cache.messages
      .filter((item) => item.sessionId === safeSessionId)
      .sort((a, b) => this.compareOptionalTime(a.sentAt, b.sentAt))
      .slice(-safeLimit);
    const missingSessionWarning =
      session || cache.sessions.length === 0
        ? []
        : [`缓存中没有找到 sessionId=${safeSessionId} 的微信会话。`];
    const status = this.resolveWechatChatHistoryStatus(cache, messages.length);

    return {
      status: missingSessionWarning.length ? 'empty' : status,
      source: cache.source,
      sessionId: safeSessionId,
      session,
      messages,
      count: messages.length,
      syncedAt: cache.syncedAt,
      cached: Boolean(cache.syncedAt || messages.length),
      blockers: cache.blockers,
      warnings: [...cache.warnings, ...missingSessionWarning],
      nextAction: this.resolveWechatChatHistoryNextAction(cache),
      cache: this.buildWechatChatHistoryCacheInfo(cache),
    };
  }

  async syncWechatChatHistory(
    input: SyncWechatChatHistoryInput = {},
  ): Promise<SyncWechatChatHistoryResult> {
    const force = input.force === true;
    const cached = await this.readWechatChatHistoryCache();
    const scriptPath = this.resolveWechatChatHistorySyncScriptPath() || '';

    if (!force && cached.sessions.length && cached.syncedAt) {
      const cachedBlocked = cached.blockers.length > 0;
      return {
        ...this.buildWechatChatSessionsResult(cached, { cached: true }),
        ok: !cachedBlocked,
        syncAttempted: false,
        scriptPath,
        errorCode: cachedBlocked ? 'not_integrated' : undefined,
        message: cachedBlocked
          ? '已返回微信聊天历史缓存，但缓存带有阻断原因，未视为真实同步成功。'
          : '已返回微信聊天历史缓存；传 force=true 可触发重新同步。',
      };
    }

    const runtimePlatform = this.getRuntimePlatform();
    if (runtimePlatform === 'win32') {
      const windowsCache =
        await this.buildWindowsWechatChatHistoryFromContacts(cached);
      if (windowsCache.sessions.length) {
        const blocked = this.withWechatChatHistoryBlocker(
          windowsCache,
          '当前 Windows 环境只能显示由联系人缓存生成的会话入口，无法读取聊天正文，因此不计为聊天历史同步成功。',
        );
        await this.writeWechatChatHistoryCache(blocked);
        return {
          ...this.buildWechatChatSessionsResult(blocked, {
            cached: false,
          }),
          ok: false,
          syncAttempted: true,
          scriptPath,
          errorCode: 'not_integrated',
          message:
            'Windows 微信聊天历史同步已阻断：会话入口来自联系人缓存，当前无法读取消息正文。',
        };
      }
      const blocked = this.withWechatChatHistoryBlocker(
        windowsCache,
        'Windows 会话历史暂未拿到真实联系人缓存；请先同步通讯录，或接入 Windows 微信 DB/RPA 读取器。',
      );
      return {
        ...this.buildWechatChatSessionsResult(blocked, {
          cached: Boolean(blocked.syncedAt || blocked.sessions.length),
        }),
        ok: false,
        syncAttempted: true,
        scriptPath,
        errorCode: 'target_missing',
        message: 'Windows 微信会话同步未写入新数据：当前没有可用联系人缓存。',
      };
    }

    if (runtimePlatform !== 'darwin') {
      const blocked = this.withWechatChatHistoryBlocker(
        cached,
        '当前聊天历史同步只支持 macOS 与 Windows；当前系统不支持真实采集。',
      );
      return {
        ...this.buildWechatChatSessionsResult(blocked, {
          cached: Boolean(blocked.syncedAt || blocked.sessions.length),
        }),
        ok: false,
        syncAttempted: false,
        scriptPath,
        errorCode: 'not_integrated',
        message: '微信聊天历史同步被阻断：当前系统暂不支持。',
      };
    }

    if (!scriptPath) {
      const blocked = this.withWechatChatHistoryBlocker(
        cached,
        '当前安装缺少微信聊天记录同步组件，请重新安装完整桌面版。',
      );
      return {
        ...this.buildWechatChatSessionsResult(blocked, {
          cached: Boolean(blocked.syncedAt || blocked.sessions.length),
        }),
        ok: false,
        syncAttempted: false,
        scriptPath,
        errorCode: 'not_integrated',
        message: '微信聊天记录同步组件未安装。',
      };
    }

    const result = await this.runWechatChatHistorySyncScript(scriptPath, input);
    if (result.ok === false) {
      const blocked = this.withWechatChatHistoryBlocker(
        cached,
        typeof result.error === 'string'
          ? result.error
          : '当前环境无法真实采集微信聊天历史。',
      );
      return {
        ...this.buildWechatChatSessionsResult(blocked, {
          cached: Boolean(blocked.syncedAt || blocked.sessions.length),
        }),
        ok: false,
        syncAttempted: true,
        scriptPath,
        errorCode: 'not_integrated',
        message:
          typeof result.message === 'string'
            ? result.message
            : '微信聊天历史同步未写入新数据。',
      };
    }

    const nextCache = this.normalizeWechatChatHistoryCache({
      source:
        typeof result.source === 'string' ? result.source : 'macos-wechat-rpa',
      sessions: result.sessions,
      messages: result.messages,
      syncedAt: new Date().toISOString(),
      blockers: Array.isArray(result.blockers) ? result.blockers : [],
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    });
    await this.writeWechatChatHistoryCache(nextCache);

    return {
      ...this.buildWechatChatSessionsResult(nextCache, { cached: false }),
      ok: true,
      syncAttempted: true,
      scriptPath,
      message: '微信聊天历史缓存已更新。',
    };
  }

  async getReadiness(
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineReadiness> {
    const checkedAt = new Date().toISOString();
    const [browserStatus, fileStatus, capabilities] = await Promise.all([
      this.getBrowserStatus(),
      this.getFileAccessStatus(),
      this.getCapabilities(checkedAt, user),
    ]);
    const blockerStatuses: LocalEngineCapabilityStatus[] = [
      'blocked',
      'missing',
      'degraded',
    ];
    const warningStatuses: LocalEngineCapabilityStatus[] = [
      'warning',
      'developing',
    ];
    const rawBlockers = capabilities
      .filter(
        (capability) =>
          capability.required !== false &&
          blockerStatuses.includes(capability.status),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));
    const warnings = capabilities
      .filter(
        (capability) =>
          warningStatuses.includes(capability.status) ||
          (capability.required === false &&
            blockerStatuses.includes(capability.status)),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));
    const desktopReadinessLocked =
      this.isWechatReadinessSessionLocked(capabilities);
    const downgradedDesktopBlockers: Array<{
      capability: string;
      message: string;
      nextAction?: string;
    }> = [];
    const blockers = rawBlockers.filter((blocker) => {
      const isDesktopWindowLockBlocker =
        ['桌面控制', '微信完整执行链'].includes(blocker.capability) &&
        /无法确认当前前台窗口是唯一微信目标会话/.test(blocker.message);
      if (desktopReadinessLocked && isDesktopWindowLockBlocker) {
        downgradedDesktopBlockers.push(blocker);
        return false;
      }
      return true;
    });
    warnings.push(
      ...downgradedDesktopBlockers.map((blocker) => ({
        capability: blocker.capability,
        message: `${blocker.message}；已检测到微信执行器就绪且本机会话已确认，按受控执行风险提示处理。`,
        nextAction: blocker.nextAction,
      })),
    );

    if (
      !browserStatus.engineOnline &&
      !blockers.some((blocker) =>
        ['浏览器控制', '浏览器引擎'].includes(blocker.capability),
      )
    ) {
      blockers.push({
        capability: '浏览器引擎',
        message: browserStatus.engineMessage,
        nextAction:
          '请先启动 3011 本地 Runtime 和 Playwright MCP，再执行评论、私信或发布任务。',
      });
    }
    if (browserStatus.readyAccounts === 0) {
      warnings.push({
        capability: '平台账号',
        message:
          '当前没有可用的平台账号；抖音、小红书、视频号等平台任务需要登录，微信桌面任务不依赖平台账号。',
        nextAction:
          '需要平台发布或平台互动时，到发布中心的平台账号中重新登录或刷新账号状态。',
      });
    }
    const requiredAccountStatus = this.checkRequiredPlatformAccounts(
      browserStatus,
      capabilities,
    );
    if (!requiredAccountStatus.ready) {
      warnings.push({
        capability: '必需平台账号',
        message: requiredAccountStatus.message,
        nextAction: requiredAccountStatus.nextAction,
      });
    }
    if (fileStatus.summary.warnings > 0) {
      blockers.push({
        capability: '文件访问',
        message: `${fileStatus.summary.warnings} 个本地目录或文件不可访问。`,
        nextAction: '请到本地能力的文件访问页查看具体路径。',
      });
    }

    return {
      ready: blockers.length === 0,
      checkedAt,
      summary: {
        blockers: blockers.length,
        warnings: warnings.length,
        readyAccounts: browserStatus.readyAccounts,
        expiredAccounts: browserStatus.expiredAccounts,
        fileWarnings: fileStatus.summary.warnings,
      },
      blockers,
      warnings,
    };
  }

  async getRuntimeStatus(): Promise<LocalEngineRuntimeStatus> {
    const checkedAt = new Date().toISOString();
    const projectRoot = this.getProjectRoot();
    const logDir = this.getProjectLogRoot();
    const screenSessions = await this.readManagedScreenSessions(logDir);
    const services = await Promise.all(
      this.getRuntimeServiceDefinitions().map((service) =>
        this.inspectRuntimeService(service, screenSessions),
      ),
    );

    return {
      checkedAt,
      allOnline: services.every((service) => service.online),
      logDir,
      startScript: join(projectRoot, 'scripts', 'start-local-integration.sh'),
      stopScript: join(projectRoot, 'scripts', 'stop-local-integration.sh'),
      services,
    };
  }

  async runRuntimeAction(
    action: LocalEngineRuntimeAction,
    options: {
      riskConfirmation?: BackendRiskConfirmationInput;
      riskContext?: BackendRiskContext;
    } = {},
  ): Promise<
    LocalEngineRuntimeActionResult & { riskAudit: BackendRiskAuditEvent }
  > {
    const projectRoot = this.getProjectRoot();
    const startScript = join(
      projectRoot,
      'scripts',
      'start-local-integration.sh',
    );
    const stopScript = join(
      projectRoot,
      'scripts',
      'stop-local-integration.sh',
    );
    const submittedAt = new Date().toISOString();

    if (!['start', 'stop', 'restart'].includes(action)) {
      throw new BadRequestException('不支持的本机控制动作');
    }

    const riskAudit = assertBackendRiskGate({
      action: 'runtime-control',
      target: `local-engine-runtime:${action}`,
      riskLevel: action === 'start' ? 'medium' : 'high',
      requiresConfirmation: false,
      confirmation: options.riskConfirmation,
      context: options.riskContext,
      reason: '本地服务启停会影响后端、前端或 发布服务执行通道。',
    });

    const scriptPath = action === 'stop' ? stopScript : startScript;
    const command =
      action === 'restart'
        ? `sleep 0.5; '${stopScript}'; sleep 0.5; '${startScript}'`
        : `sleep 0.5; '${scriptPath}'`;

    const child = spawn('bash', ['-lc', command], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return {
      action,
      accepted: true,
      riskAudit,
      scriptPath,
      submittedAt,
      message:
        action === 'stop'
          ? '已提交停止本机服务动作，页面可能会短暂断开。'
          : action === 'restart'
            ? '已提交重启本机服务动作，请稍等后刷新状态。'
            : '已提交启动本机服务动作，请稍等后刷新状态。',
    };
  }

  async getRuntimeLog(
    key: LocalEngineRuntimeServiceKey,
    lineCount = 80,
  ): Promise<LocalEngineRuntimeLog> {
    const service = this.getRuntimeServiceDefinitions().find(
      (item) => item.key === key,
    );
    if (!service) {
      throw new BadRequestException('不支持的本地服务日志');
    }

    const safeLineCount = Math.min(Math.max(lineCount, 20), 300);
    const exists = existsSync(service.logPath);
    const readAt = new Date().toISOString();

    if (!exists) {
      return {
        key: service.key,
        name: service.name,
        logPath: service.logPath,
        exists: false,
        lines: [],
        readAt,
      };
    }

    const content = await readFile(service.logPath, 'utf8');
    const lines = content.split(/\r?\n/).slice(-safeLineCount).filter(Boolean);

    return {
      key: service.key,
      name: service.name,
      logPath: service.logPath,
      exists: true,
      lines,
      readAt,
    };
  }

  private getProjectRoot() {
    return resolveProjectRoot(process.cwd());
  }

  private getProjectLogRoot() {
    const configured = process.env.KAYPAL_RUNTIME_LOG_ROOT?.trim();
    return configured
      ? resolve(configured)
      : join(this.getProjectRoot(), '.local-logs');
  }

  private getRuntimeStateRoot() {
    const configured = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim();
    return configured ? resolve(configured) : this.getProjectRoot();
  }

  private getMacWechatCommandRoot() {
    const configured =
      this.configService?.get<string>('KAYPAL_WECHAT_COMMAND_ROOT')?.trim() ||
      process.env.KAYPAL_WECHAT_COMMAND_ROOT?.trim() ||
      '';
    if (configured) {
      return configured;
    }
    const developmentRoot = join(
      this.getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-macos',
      'bin',
    );
    return existsSync(developmentRoot) ? developmentRoot : '';
  }

  private resolveWechatContactSyncScriptPath() {
    const commandRoot = this.getMacWechatCommandRoot();
    const scriptPath = this.resolveFirstExistingLocalPath([
      this.configService
        ?.get<string>('AI_CONTENT_WECHAT_CONTACT_SYNC_SCRIPT')
        ?.trim(),
      process.env.AI_CONTENT_WECHAT_CONTACT_SYNC_SCRIPT?.trim(),
      commandRoot
        ? resolve(
            commandRoot,
            '..',
            'skillhub',
            'wechat-contact-sync',
            'wechat-contact-sync.py',
          )
        : undefined,
      join(
        this.getProjectRoot(),
        'vendor',
        'skillhub',
        'wechat-contact-sync',
        'wechat-contact-sync.py',
      ),
    ]);
    if (!scriptPath) {
      throw new BadRequestException(
        '当前安装缺少微信通讯录同步组件，请重新安装完整桌面版。',
      );
    }
    return scriptPath;
  }

  private resolveWechatChatHistorySyncScriptPath() {
    const commandRoot = this.getMacWechatCommandRoot();
    return this.resolveFirstExistingLocalPath([
      this.configService
        ?.get<string>('AI_CONTENT_WECHAT_CHAT_SYNC_SCRIPT')
        ?.trim(),
      process.env.AI_CONTENT_WECHAT_CHAT_SYNC_SCRIPT?.trim(),
      commandRoot
        ? resolve(
            commandRoot,
            '..',
            'skillhub',
            'wechat-chat-sync',
            'wechat-chat-sync.py',
          )
        : undefined,
      join(
        this.getProjectRoot(),
        'vendor',
        'skillhub',
        'wechat-chat-sync',
        'wechat-chat-sync.py',
      ),
    ]);
  }

  private getWechatContactsCachePath() {
    return join(this.getProjectLogRoot(), 'wechat-contacts.json');
  }

  private getWechatContactsDiagnosticsPath() {
    return join(
      this.getProjectLogRoot(),
      'wechat-contact-sync-diagnostics.json',
    );
  }

  private async readWechatContactSyncDiagnosticsFile(): Promise<
    Record<string, unknown> | undefined
  > {
    try {
      const raw = await readFile(
        this.getWechatContactsDiagnosticsPath(),
        'utf8',
      );
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private getWechatChatHistoryCachePath() {
    return join(this.getProjectLogRoot(), 'wechat-chat-history.json');
  }

  private async readWechatContactsCache(): Promise<{
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }> {
    try {
      const raw = await readFile(this.getWechatContactsCachePath(), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const syncedAt =
        typeof parsed.syncedAt === 'string' ? parsed.syncedAt : undefined;
      const currentWechatId =
        typeof parsed.currentWechatId === 'string'
          ? parsed.currentWechatId
          : undefined;
      const plannedWechatId =
        typeof parsed.plannedWechatId === 'string'
          ? parsed.plannedWechatId
          : undefined;
      const source =
        typeof parsed.source === 'string' ? parsed.source : 'local-cache';
      const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
        parsed.diagnostics,
        {
          source,
          screenshotPath:
            typeof parsed.screenshotPath === 'string'
              ? parsed.screenshotPath
              : undefined,
        },
      );
      const inferredCurrentWechatId =
        currentWechatId ||
        this.optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
        this.optionalTrimmedText(diagnostics?.selectedDbBaseWxid) ||
        undefined;
      const rawContactInput = Array.isArray(parsed.items)
        ? parsed.items
        : parsed.contacts;
      const rawContactCandidates =
        this.extractWechatContactCandidateTexts(rawContactInput);
      const items = this.normalizeWechatContactList(rawContactInput, {
        syncedAt,
        currentWechatId: inferredCurrentWechatId,
        plannedWechatId,
      });
      const cacheLooksPolluted = this.isPollutedWechatContactCandidateBatch(
        rawContactCandidates,
        source,
      );
      const cacheIsLegacyAccountless =
        this.isWechatContactsLegacyAccountlessRuntimeCache({
          source,
          items,
          currentWechatId: inferredCurrentWechatId,
          diagnostics,
        });
      const cacheSafetyDiagnostics = cacheIsLegacyAccountless
        ? {
            ...(diagnostics || {}),
            source: 'wechat-contact-cache-account-guard',
            stage: 'legacy-cache-without-account-id',
            failureReason:
              '旧版本联系人缓存没有微信账号标识，已拒绝当作当前微信通讯录。',
            warnings: this.mergeWechatDiagnosticStringArrays(
              diagnostics?.warnings,
              ['旧版本联系人缓存没有微信账号标识，已拒绝当作当前微信通讯录。'],
            ),
          }
        : diagnostics;
      return {
        source,
        items: cacheLooksPolluted || cacheIsLegacyAccountless ? [] : items,
        currentWechatId: inferredCurrentWechatId,
        plannedWechatId,
        syncedAt,
        screenshotPath:
          typeof parsed.screenshotPath === 'string'
            ? parsed.screenshotPath
            : undefined,
        diagnostics: cacheSafetyDiagnostics,
      };
    } catch {
      return {
        source: 'empty',
        items: [],
      };
    }
  }

  private async writeWechatContactsCache(input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }) {
    const cachePath = this.getWechatContactsCachePath();
    await mkdir(resolve(cachePath, '..'), { recursive: true });
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          ...input,
          contacts: input.items.map((item) =>
            this.getWechatContactDisplay(item),
          ),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  private buildWechatContactsResult(input: {
    source: string;
    items: WechatContact[];
    currentWechatId?: string;
    plannedWechatId?: string;
    syncedAt?: string;
    screenshotPath?: string;
    diagnostics?: WechatContactsSyncDiagnostics;
  }): WechatContactsResult {
    return {
      source: input.source,
      contacts: input.items.map((item) => this.getWechatContactDisplay(item)),
      items: input.items,
      count: input.items.length,
      currentWechatId: input.currentWechatId,
      plannedWechatId: input.plannedWechatId,
      syncedAt: input.syncedAt,
      screenshotPath: input.screenshotPath,
      diagnostics: input.diagnostics,
    };
  }

  private async readWechatChatHistoryCache(): Promise<WechatChatHistoryCache> {
    try {
      const raw = await readFile(this.getWechatChatHistoryCachePath(), 'utf8');
      return this.normalizeWechatChatHistoryCache(JSON.parse(raw));
    } catch {
      return this.normalizeWechatChatHistoryCache({
        source: 'empty',
        sessions: [],
        messages: [],
        blockers: ['本机还没有微信聊天历史缓存，当前无法从微信读取聊天正文。'],
        warnings: [],
      });
    }
  }

  private async writeWechatChatHistoryCache(input: WechatChatHistoryCache) {
    const cachePath = this.getWechatChatHistoryCachePath();
    await mkdir(resolve(cachePath, '..'), { recursive: true });
    await writeFile(cachePath, JSON.stringify(input, null, 2), 'utf8');
  }

  private async buildWindowsWechatChatHistoryFromContacts(
    cached: WechatChatHistoryCache,
  ): Promise<WechatChatHistoryCache> {
    const contactsCache = await this.readWechatContactsCache();
    const now = new Date().toISOString();
    const contactSessions = contactsCache.items.map((contact) => {
      const title = this.getWechatContactDisplay(contact);
      const id = `contact:${contact.wxid || title}`;
      return {
        id,
        title,
        contactName: title,
        unreadCount: 0,
        lastMessage: '已从 Windows 微信通讯录缓存建立会话入口。',
        lastMessageAt: contact.syncedAt || contact.updatedAt || now,
        updatedAt: contact.updatedAt || contact.syncedAt || now,
        source: 'windows-wechat-contact-cache' as WechatChatHistorySource,
        raw: {
          wxid: contact.wxid,
          nickname: contact.nickname,
          remark: contact.remark,
          tags: contact.tags,
          contactsSource: contactsCache.source,
          contactsSyncedAt: contactsCache.syncedAt,
        },
      };
    });
    const existingById = new Map(
      cached.sessions.map((session) => [session.id, session]),
    );
    for (const session of contactSessions) {
      existingById.set(session.id, {
        ...existingById.get(session.id),
        ...session,
      });
    }
    return this.normalizeWechatChatHistoryCache({
      source: contactSessions.length
        ? 'windows-wechat-contact-cache'
        : cached.source,
      sessions: [...existingById.values()],
      messages: cached.messages,
      syncedAt: contactSessions.length ? now : cached.syncedAt,
      blockers: contactSessions.length ? [] : cached.blockers,
      warnings: [
        ...cached.warnings,
        contactSessions.length
          ? 'Windows 当前先用联系人库生成会话列表；聊天消息正文需要 Windows 微信 DB/RPA 读取器后续接管。'
          : 'Windows 未找到联系人缓存，不能生成会话入口。',
      ],
    });
  }

  private normalizeWechatChatHistoryCache(
    input: unknown,
  ): WechatChatHistoryCache {
    const parsed =
      input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};
    const source = this.normalizeWechatChatHistorySource(parsed.source);
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions
          .map((item) => this.normalizeWechatChatSession(item, source))
          .filter((item): item is WechatChatSession => Boolean(item))
      : [];
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .map((item) => this.normalizeWechatChatMessage(item, source))
          .filter((item): item is WechatChatMessage => Boolean(item))
      : [];
    const sessionIds = new Set(sessions.map((item) => item.id));
    for (const message of messages) {
      if (!sessionIds.has(message.sessionId)) {
        sessions.push({
          id: message.sessionId,
          title: message.sessionId,
          unreadCount: 0,
          updatedAt: message.sentAt || message.createdAt,
          source: message.source,
        });
        sessionIds.add(message.sessionId);
      }
    }

    return {
      source,
      sessions,
      messages,
      syncedAt:
        typeof parsed.syncedAt === 'string' ? parsed.syncedAt : undefined,
      blockers: Array.isArray(parsed.blockers)
        ? parsed.blockers
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [],
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [],
    };
  }

  private normalizeWechatChatSession(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatSession | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const item = input as Record<string, unknown>;
    const id = String(item.id || item.sessionId || '').trim();
    const title = String(
      item.title || item.contactName || item.name || '',
    ).trim();
    if (!id || !title) {
      return null;
    }
    return {
      id,
      title,
      contactName:
        typeof item.contactName === 'string' ? item.contactName : undefined,
      avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
      unreadCount: Number.isFinite(Number(item.unreadCount))
        ? Math.max(0, Math.floor(Number(item.unreadCount)))
        : 0,
      lastMessage:
        typeof item.lastMessage === 'string' ? item.lastMessage : undefined,
      lastMessageAt:
        typeof item.lastMessageAt === 'string' ? item.lastMessageAt : undefined,
      updatedAt:
        typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
      source: this.normalizeWechatChatHistorySource(
        item.source,
        fallbackSource,
      ),
      raw:
        item.raw && typeof item.raw === 'object'
          ? (item.raw as Record<string, unknown>)
          : undefined,
    };
  }

  private normalizeWechatChatMessage(
    input: unknown,
    fallbackSource: WechatChatHistorySource,
  ): WechatChatMessage | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const item = input as Record<string, unknown>;
    const id = String(item.id || '').trim();
    const sessionId = String(item.sessionId || '').trim();
    const content = String(item.content || item.text || '').trim();
    if (!id || !sessionId || !content) {
      return null;
    }
    return {
      id,
      sessionId,
      senderName:
        typeof item.senderName === 'string' ? item.senderName : undefined,
      direction: this.normalizeWechatMessageDirection(item.direction),
      content,
      contentType: this.normalizeWechatMessageContentType(item.contentType),
      sentAt: typeof item.sentAt === 'string' ? item.sentAt : undefined,
      createdAt:
        typeof item.createdAt === 'string' ? item.createdAt : undefined,
      source: this.normalizeWechatChatHistorySource(
        item.source,
        fallbackSource,
      ),
      raw:
        item.raw && typeof item.raw === 'object'
          ? (item.raw as Record<string, unknown>)
          : undefined,
    };
  }

  private normalizeWechatChatHistorySource(
    value: unknown,
    fallback: WechatChatHistorySource = 'local-cache',
  ): WechatChatHistorySource {
    const source = String(value || '').trim();
    const allowed: WechatChatHistorySource[] = [
      'empty',
      'local-cache',
      'macos-wechat-rpa',
      'macos-wechat-ocr',
      'windows-wechat-contact-cache',
      'wechat-db',
      'manual-import',
    ];
    return allowed.includes(source as WechatChatHistorySource)
      ? (source as WechatChatHistorySource)
      : fallback;
  }

  private normalizeWechatMessageDirection(
    value: unknown,
  ): WechatChatMessage['direction'] {
    const direction = String(value || '');
    return ['incoming', 'outgoing', 'system', 'unknown'].includes(direction)
      ? (direction as WechatChatMessage['direction'])
      : 'unknown';
  }

  private normalizeWechatMessageContentType(
    value: unknown,
  ): WechatChatMessage['contentType'] {
    const contentType = String(value || '');
    return ['text', 'image', 'file', 'system', 'unknown'].includes(contentType)
      ? (contentType as WechatChatMessage['contentType'])
      : 'text';
  }

  private buildWechatChatSessionsResult(
    cache: WechatChatHistoryCache,
    options: { cached: boolean },
  ): WechatChatSessionsResult {
    const sessions = [...cache.sessions].sort((a, b) =>
      this.compareOptionalTime(
        b.lastMessageAt || b.updatedAt,
        a.lastMessageAt || a.updatedAt,
      ),
    );
    return {
      status: this.resolveWechatChatHistoryStatus(cache, sessions.length),
      source: cache.source,
      sessions,
      count: sessions.length,
      syncedAt: cache.syncedAt,
      cached: options.cached,
      blockers: cache.blockers,
      warnings: cache.warnings,
      nextAction: this.resolveWechatChatHistoryNextAction(cache),
      cache: this.buildWechatChatHistoryCacheInfo(cache),
    };
  }

  private buildWechatChatHistoryCacheInfo(cache: WechatChatHistoryCache) {
    return {
      path: this.getWechatChatHistoryCachePath(),
      cached: Boolean(
        cache.syncedAt || cache.sessions.length || cache.messages.length,
      ),
      syncedAt: cache.syncedAt,
      source: cache.source,
    };
  }

  private resolveWechatChatHistoryStatus(
    cache: WechatChatHistoryCache,
    itemCount: number,
  ): WechatChatHistoryStatus {
    if (cache.blockers.length > 0) {
      return 'blocked';
    }
    return itemCount > 0 ? 'ready' : 'empty';
  }

  private resolveWechatChatHistoryNextAction(
    cache: WechatChatHistoryCache,
  ): string {
    if (cache.blockers.length > 0) {
      return '接入真实微信 DB 读取、Agent-S/RPA 当前会话采集或 OCR 采集器后，再执行同步。';
    }
    if (!cache.sessions.length) {
      return '当前缓存为空；可先执行同步，或导入后续 RPA/OCR 产出的缓存文件。';
    }
    return '可按 sessionId 读取聊天历史；后续同步会复用同一缓存结构。';
  }

  private withWechatChatHistoryBlocker(
    cache: WechatChatHistoryCache,
    blocker: string,
  ): WechatChatHistoryCache {
    return {
      ...cache,
      blockers: [
        ...new Set(
          [...cache.blockers, blocker]
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ],
    };
  }

  private compareOptionalTime(left?: string, right?: string) {
    const leftTime = left ? Date.parse(left) : 0;
    const rightTime = right ? Date.parse(right) : 0;
    return (
      (Number.isFinite(leftTime) ? leftTime : 0) -
      (Number.isFinite(rightTime) ? rightTime : 0)
    );
  }

  private normalizeWechatContactList(
    value: unknown,
    defaults: Partial<WechatContact> = {},
  ): WechatContact[] {
    const rawItems = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const contacts: WechatContact[] = [];

    for (const rawItem of rawItems) {
      const contact = this.normalizeWechatContact(rawItem, defaults);
      if (!contact || this.isRejectedWechatContact(contact)) {
        continue;
      }
      const key = this.getWechatContactDisplay(contact);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      contacts.push(contact);
    }

    return contacts;
  }

  private extractWechatContactCandidateTexts(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .flatMap((item) => {
        if (item && typeof item === 'object') {
          const raw = item as Record<string, unknown>;
          return [raw.wxid, raw.nickname, raw.remark, raw.id];
        }
        return [item];
      })
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  private isPollutedWechatContactCandidateBatch(
    candidates: string[],
    source?: string,
  ) {
    const items = candidates
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (!items.length) {
      return false;
    }

    const shellPattern =
      /^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$/i;
    const hardNonWechatPattern =
      /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/;
    const publicAccountNoisePattern =
      /微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选/;
    const systemNoisePattern =
      /A new version of Dock|Upgrade plan|Engine starting|Macintosh|iCloud|Finder|Safari|Chrome|Edge|浏览器|This page could not be found|404/i;
    const chatOrNewsNoisePattern =
      /折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶|新闻|直播|链接|网友|茉莉奶/;

    const hardNonWechatCount = items.filter((item) =>
      hardNonWechatPattern.test(item),
    ).length;
    if (hardNonWechatCount > 0) {
      return true;
    }

    const pollutionCount = items.filter((item) => {
      const compact = item.replace(/\s+/g, '');
      return (
        shellPattern.test(compact) ||
        compact.includes('星标朋友') ||
        compact.includes('我的企业') ||
        publicAccountNoisePattern.test(item) ||
        systemNoisePattern.test(item) ||
        chatOrNewsNoisePattern.test(item) ||
        /^[【\[\［].*[】\]\］]/.test(compact)
      );
    }).length;
    const likelyContactCount = items.filter((item) => {
      const compact = item.replace(/\s+/g, '');
      return (
        compact.length >= 2 &&
        compact.length <= 40 &&
        !shellPattern.test(compact) &&
        !compact.includes('星标朋友') &&
        !compact.includes('我的企业') &&
        !publicAccountNoisePattern.test(item) &&
        !systemNoisePattern.test(item) &&
        !chatOrNewsNoisePattern.test(item) &&
        !/^[【\[\［].*[】\]\］]/.test(compact)
      );
    }).length;
    const sourceLooksLikeOcr = /wechat|weixin|ocr|uia|cache/i.test(
      source || '',
    );

    if (likelyContactCount === 0 && pollutionCount > 0) {
      return true;
    }
    const pollutionRatio = pollutionCount / items.length;
    return (
      sourceLooksLikeOcr &&
      items.length >= 4 &&
      (pollutionRatio >= 0.8 || (pollutionCount >= 8 && pollutionRatio >= 0.5))
    );
  }

  private isRejectedWechatContact(contact: WechatContact) {
    const display = this.getWechatContactDisplay(contact).trim();
    const compact = display.replace(/\s+/g, '');
    if (!compact) {
      return true;
    }
    if (
      /^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$/i.test(
        compact,
      )
    ) {
      return true;
    }
    if (compact.includes('星标朋友') || compact.includes('我的企业')) {
      return true;
    }
    if (
      /抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|刷新状态|绑定平台/.test(
        display,
      )
    ) {
      return true;
    }
    if (
      /A new version of Dock|Upgrade plan|Engine starting|Macintosh|iCloud|Finder/i.test(
        display,
      )
    ) {
      return true;
    }
    if (
      /微信小店助手|腾讯新闻|东方甄选|服务通知|订阅号消息|微信团队|福利小管|时惠叭|网友|茉莉奶|新闻/.test(
        display,
      )
    ) {
      return true;
    }
    if (/^[【\[\［].*[】\]\］]/.test(compact)) {
      return true;
    }
    if (
      /折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶/.test(
        display,
      )
    ) {
      return true;
    }
    return compact.length < 2 || compact.length > 40;
  }

  private normalizeWechatContact(
    value: unknown,
    defaults: Partial<WechatContact> = {},
  ): WechatContact | null {
    const now = new Date().toISOString();
    const raw =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : { nickname: value };
    const nickname = this.optionalTrimmedText(raw.nickname);
    const remark = this.optionalTrimmedText(raw.remark);
    const wxid =
      this.optionalTrimmedText(raw.wxid) ||
      this.optionalTrimmedText(raw.id) ||
      remark ||
      nickname;

    if (!wxid) {
      return null;
    }

    return {
      wxid,
      nickname,
      remark,
      tags: this.normalizeWechatContactTags(raw.tags),
      currentWechatId:
        this.optionalTrimmedText(raw.currentWechatId) ||
        defaults.currentWechatId,
      plannedWechatId:
        this.optionalTrimmedText(raw.plannedWechatId) ||
        defaults.plannedWechatId,
      syncedAt: this.optionalTrimmedText(raw.syncedAt) || defaults.syncedAt,
      updatedAt:
        this.optionalTrimmedText(raw.updatedAt) || defaults.updatedAt || now,
      createdAt:
        this.optionalTrimmedText(raw.createdAt) || defaults.createdAt || now,
    };
  }

  private normalizeWechatContactTags(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return [
      ...new Set(
        value
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 50),
      ),
    ];
  }

  private getWechatContactDisplay(contact: WechatContact) {
    return contact.remark || contact.nickname || contact.wxid;
  }

  private normalizeWechatContactsSyncDiagnostics(
    value: unknown,
    defaults: Partial<WechatContactsSyncDiagnostics> = {},
  ): WechatContactsSyncDiagnostics | undefined {
    const raw =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const diagnostics: WechatContactsSyncDiagnostics = {
      ...defaults,
      stage: this.optionalTrimmedText(raw.stage) || defaults.stage,
      source: this.optionalTrimmedText(raw.source) || defaults.source,
      contractVersion:
        this.optionalTrimmedText(raw.contractVersion) ||
        defaults.contractVersion,
      contactsContract:
        this.normalizeJsonRecord(raw.contactsContract) ||
        defaults.contactsContract,
      screenshotPath:
        this.optionalTrimmedText(raw.screenshotPath) || defaults.screenshotPath,
      engine: this.optionalTrimmedText(raw.engine) || defaults.engine,
      engineVersion:
        this.optionalTrimmedText(raw.engineVersion) || defaults.engineVersion,
      enginePath:
        this.optionalTrimmedText(raw.enginePath) || defaults.enginePath,
      nativeRuntimePath:
        this.optionalTrimmedText(raw.nativeRuntimePath) ||
        defaults.nativeRuntimePath,
      nativeRuntimeVersion:
        this.optionalTrimmedText(raw.nativeRuntimeVersion) ||
        defaults.nativeRuntimeVersion,
      decryptionHelperPath:
        this.optionalTrimmedText(raw.decryptionHelperPath) ||
        defaults.decryptionHelperPath,
      fallbackReason:
        this.optionalTrimmedText(raw.fallbackReason) || defaults.fallbackReason,
      wechatVersion:
        this.optionalTrimmedText(raw.wechatVersion) || defaults.wechatVersion,
      dbKeyStatus:
        this.optionalTrimmedText(raw.dbKeyStatus) || defaults.dbKeyStatus,
      processName:
        this.optionalTrimmedText(raw.processName) || defaults.processName,
      windowTitle:
        this.optionalTrimmedText(raw.windowTitle) || defaults.windowTitle,
      os: this.optionalTrimmedText(raw.os) || defaults.os,
      attemptedSources: this.normalizeStringArray(
        raw.attemptedSources,
        defaults.attemptedSources,
      ),
      warnings: this.normalizeStringArray(raw.warnings, defaults.warnings),
      rawPreview: this.normalizeStringArray(
        raw.rawPreview,
        defaults.rawPreview,
      ),
      ocrPreview: this.normalizeStringArray(
        raw.ocrPreview,
        defaults.ocrPreview,
      ),
      runtimeCapabilities: this.normalizeStringArray(
        raw.runtimeCapabilities,
        defaults.runtimeCapabilities,
      ),
      dbPaths: this.normalizeStringArray(raw.dbPaths, defaults.dbPaths),
      dbCandidateDetails:
        this.normalizeJsonRecordArray(raw.dbCandidateDetails) ||
        defaults.dbCandidateDetails,
      dbCandidateResults:
        this.normalizeJsonRecordArray(raw.dbCandidateResults) ||
        defaults.dbCandidateResults,
      dbErrors:
        this.normalizeJsonRecordArray(raw.dbErrors) || defaults.dbErrors,
      dbError: this.optionalTrimmedText(raw.dbError) || defaults.dbError,
      selectedDbPath:
        this.optionalTrimmedText(raw.selectedDbPath) || defaults.selectedDbPath,
      selectedDbAccountFolder:
        this.optionalTrimmedText(raw.selectedDbAccountFolder) ||
        defaults.selectedDbAccountFolder,
      selectedDbBaseWxid:
        this.optionalTrimmedText(raw.selectedDbBaseWxid) ||
        defaults.selectedDbBaseWxid,
      selectedDbActiveMtime:
        this.optionalTrimmedText(raw.selectedDbActiveMtime) ||
        defaults.selectedDbActiveMtime,
      sqlitePath:
        this.optionalTrimmedText(raw.sqlitePath) || defaults.sqlitePath,
      dbHelper: this.optionalTrimmedText(raw.dbHelper) || defaults.dbHelper,
      helperError:
        this.optionalTrimmedText(raw.helperError) || defaults.helperError,
      keyHelperStatus:
        this.optionalTrimmedText(raw.keyHelperStatus) ||
        defaults.keyHelperStatus,
      decryptionStatus:
        this.optionalTrimmedText(raw.decryptionStatus) ||
        defaults.decryptionStatus,
      resultSource:
        this.optionalTrimmedText(raw.resultSource) || defaults.resultSource,
      externalKeyToolStatus:
        this.optionalTrimmedText(raw.externalKeyToolStatus) ||
        defaults.externalKeyToolStatus,
      externalRawKeyToolStatus:
        this.optionalTrimmedText(raw.externalRawKeyToolStatus) ||
        defaults.externalRawKeyToolStatus,
      externalKeyToolCandidates:
        this.normalizeJsonRecord(raw.externalKeyToolCandidates) ||
        defaults.externalKeyToolCandidates,
      externalKeyToolCompatibility:
        this.normalizeJsonRecordArray(raw.externalKeyToolCompatibility) ||
        defaults.externalKeyToolCompatibility,
      externalDbKeyAttempts:
        this.normalizeJsonRecordArray(raw.externalDbKeyAttempts) ||
        defaults.externalDbKeyAttempts,
      externalDumpRsPidAttempts:
        this.normalizeJsonRecordArray(raw.externalDumpRsPidAttempts) ||
        defaults.externalDumpRsPidAttempts,
      externalWxKeyDllAttempts:
        this.normalizeJsonRecordArray(raw.externalWxKeyDllAttempts) ||
        defaults.externalWxKeyDllAttempts,
      decryptAttempts:
        this.normalizeJsonRecordArray(raw.decryptAttempts) ||
        defaults.decryptAttempts,
      wechatProcessArchitectures:
        this.normalizeJsonRecordArray(raw.wechatProcessArchitectures) ||
        defaults.wechatProcessArchitectures,
      keyScanDiagnostics:
        this.optionalTrimmedText(raw.keyScanDiagnostics) ||
        defaults.keyScanDiagnostics,
      memoryScanStatus:
        this.optionalTrimmedText(raw.memoryScanStatus) ||
        defaults.memoryScanStatus,
      blockedReasons: this.normalizeStringArray(
        raw.blockedReasons,
        defaults.blockedReasons,
      ),
      failureReason:
        this.optionalTrimmedText(raw.failureReason) || defaults.failureReason,
      failureLayer:
        this.optionalTrimmedText(raw.failureLayer) || defaults.failureLayer,
      platformStatus:
        this.optionalTrimmedText(raw.platformStatus) || defaults.platformStatus,
      windowStatus:
        this.optionalTrimmedText(raw.windowStatus) || defaults.windowStatus,
      dbStatus: this.optionalTrimmedText(raw.dbStatus) || defaults.dbStatus,
      helperStatus:
        this.optionalTrimmedText(raw.helperStatus) || defaults.helperStatus,
      uiaStatus: this.optionalTrimmedText(raw.uiaStatus) || defaults.uiaStatus,
      uiaStopReason:
        this.optionalTrimmedText(raw.uiaStopReason) || defaults.uiaStopReason,
      uiaContactNavigationAction:
        this.optionalTrimmedText(raw.uiaContactNavigationAction) ||
        defaults.uiaContactNavigationAction,
      uiaContactNavigationTarget:
        this.optionalTrimmedText(raw.uiaContactNavigationTarget) ||
        defaults.uiaContactNavigationTarget,
      layers: this.normalizeJsonRecord(raw.layers) || defaults.layers,
      externalCommandRunners:
        this.normalizeJsonRecord(raw.externalCommandRunners) ||
        defaults.externalCommandRunners,
      uiaPageSummaries:
        this.normalizeJsonRecordArray(raw.uiaPageSummaries) ||
        defaults.uiaPageSummaries,
    };
    for (const key of [
      'pagesScanned',
      'uiaContactCount',
      'ocrContactCount',
      'dbContactCount',
      'dbTotalContactCount',
      'rawTextCount',
      'processId',
      'uiaNodeCount',
      'uiaScrollResetAttempts',
      'selectedDbScore',
    ] as const) {
      const parsed = Number(raw[key]);
      if (Number.isFinite(parsed)) {
        diagnostics[key] = parsed;
      } else if (defaults[key] !== undefined) {
        diagnostics[key] = defaults[key];
      }
    }
    if (typeof raw.isCurrentProcessElevated === 'boolean') {
      diagnostics.isCurrentProcessElevated = raw.isCurrentProcessElevated;
    } else if (typeof defaults.isCurrentProcessElevated === 'boolean') {
      diagnostics.isCurrentProcessElevated = defaults.isCurrentProcessElevated;
    }
    for (const key of [
      'externalKeyToolCrash',
      'externalKeyToolTimeout',
      'externalKeyToolIncompatible',
      'externalKeyToolUnsupported',
      'currentAccountDbBlocked',
    ] as const) {
      if (typeof raw[key] === 'boolean') {
        diagnostics[key] = raw[key];
      } else if (typeof defaults[key] === 'boolean') {
        diagnostics[key] = defaults[key];
      }
    }
    if (raw.windowRect && typeof raw.windowRect === 'object') {
      const rect = raw.windowRect as Record<string, unknown>;
      const left = Number(rect.left);
      const top = Number(rect.top);
      const width = Number(rect.width);
      const height = Number(rect.height);
      if ([left, top, width, height].every((item) => Number.isFinite(item))) {
        diagnostics.windowRect = { left, top, width, height };
      }
    } else if (defaults.windowRect) {
      diagnostics.windowRect = defaults.windowRect;
    }
    if (raw.screen && typeof raw.screen === 'object') {
      const screen = raw.screen as Record<string, unknown>;
      const width = Number(screen.width);
      const height = Number(screen.height);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        diagnostics.screen = { width, height };
      }
    } else if (defaults.screen) {
      diagnostics.screen = defaults.screen;
    }
    const hasUsefulValue = Object.values(diagnostics).some((item) =>
      Array.isArray(item) ? item.length > 0 : item !== undefined,
    );
    return hasUsefulValue ? diagnostics : undefined;
  }

  private isNonWechatContactSyncDiagnostics(
    diagnostics?: WechatContactsSyncDiagnostics,
  ) {
    if (!diagnostics) return false;
    const text = [
      diagnostics.failureReason,
      diagnostics.fallbackReason,
      diagnostics.windowTitle,
      ...(diagnostics.rawPreview || []),
      ...(diagnostics.ocrPreview || []),
      ...(diagnostics.warnings || []),
    ]
      .filter(Boolean)
      .join('\n');
    return /不是微信窗口|不是微信通讯录|非微信页面|抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|AI员工TOS|智能运营系统|增长获客/.test(
      text,
    );
  }

  private normalizeStringArray(value: unknown, fallback: string[] = []) {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const normalized = value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 50);
    return normalized.length ? normalized : fallback;
  }

  private normalizeJsonRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private normalizeInteractionTaskBillingIdentity(
    value: unknown,
  ): InteractionTaskBillingIdentity | undefined {
    const record = this.normalizeJsonRecord(value);
    if (!record) return undefined;
    const sessionId = this.optionalTrimmedText(record.sessionId);
    const localUserId = this.optionalTrimmedText(record.localUserId);
    const kaypalUserId = this.optionalTrimmedText(record.kaypalUserId);
    const accessToken = this.optionalTrimmedText(
      record.kaypalDesktopAccessToken,
    );
    const refreshToken = this.optionalTrimmedText(
      record.kaypalDesktopRefreshToken,
    );
    if (
      !localUserId ||
      !kaypalUserId ||
      (!sessionId && !accessToken && !refreshToken)
    ) {
      return undefined;
    }
    return {
      sessionId,
      localUserId,
      kaypalUserId,
      kaypalDesktopAccessToken: accessToken,
      kaypalDesktopRefreshToken: refreshToken,
      kaypalDesktopTokenExpiresAt: this.optionalTrimmedText(
        record.kaypalDesktopTokenExpiresAt,
      ),
      kaypalDesktopDeviceId: this.optionalTrimmedText(
        record.kaypalDesktopDeviceId,
      ),
      kaypalPlan: this.optionalTrimmedText(record.kaypalPlan),
      kaypalRole: this.optionalTrimmedText(record.kaypalRole),
      kaypalPlatformRole: this.optionalTrimmedText(record.kaypalPlatformRole),
      commercialExecutionAllowed:
        typeof record.commercialExecutionAllowed === 'boolean'
          ? record.commercialExecutionAllowed
          : undefined,
      planMode: this.optionalTrimmedText(record.planMode),
      capturedAt:
        this.optionalTrimmedText(record.capturedAt) || new Date().toISOString(),
    };
  }

  private buildWechatNativeCommandRunnerReadinessCheck(
    commandRunners: Record<string, unknown> | undefined,
    platformName: string,
  ): WechatContactsReadinessCheck {
    const commands = Object.entries(WECHAT_NATIVE_COMMAND_RUNNER_LABELS).map(
      ([command, label]) => {
        const runner = this.normalizeJsonRecord(commandRunners?.[command]);
        const status = this.optionalTrimmedText(runner?.status) || 'missing';
        return {
          command,
          label,
          status,
          path: this.optionalTrimmedText(runner?.path),
          kind: this.optionalTrimmedText(runner?.kind),
          candidateCount: Array.isArray(runner?.candidates)
            ? runner.candidates.length
            : 0,
        };
      },
    );
    const readyCommands = commands.filter((item) => item.status === 'ready');
    const missingCommands = commands
      .filter((item) => item.status !== 'ready')
      .map((item) => item.label);
    const allReady = readyCommands.length === commands.length;
    const missingRunnerSummary = missingCommands.join('、');
    return {
      key: 'wechat-command-runners',
      name: '微信操作能力',
      status: allReady ? 'ready' : 'warning',
      message: allReady
        ? '群发、加好友、通过好友、朋友圈和会话历史能力已安装。'
        : `${missingRunnerSummary}尚未安装，相关微信操作会停止在执行前。`,
      nextAction: allReady
        ? undefined
        : platformName === 'win32'
          ? '请重新安装包含微信操作组件的完整桌面版，并完成 Windows 微信检查。'
          : '请重新安装包含微信操作组件的完整桌面版，并在本机授权辅助功能和屏幕录制。',
      details: {
        configuredCount: readyCommands.length,
        requiredCount: commands.length,
        commands,
        raw: commandRunners,
      },
    };
  }

  private resolveMacWechatCommandRunners() {
    const commandRoot = this.getMacWechatCommandRoot();
    const developmentRoot = join(
      this.getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-macos',
      'bin',
    );
    const commandMap: Record<string, string> = {
      'group-broadcast': 'wechat-auto-reply',
      'contact-add': 'wechat-contact-add',
      'moments-publish': 'wechat-moments-publish',
      'moments-marketing': 'wechat-moments-marketing',
      'chat-history': 'wechat-chat-history',
    };
    return Object.fromEntries(
      Object.entries(commandMap).map(([command, executable]) => {
        const runnerPath = this.resolveFirstExistingLocalPath([
          commandRoot ? join(commandRoot, executable) : undefined,
          join(developmentRoot, executable),
          join(homedir(), '.local', 'bin', executable),
          join('/opt/homebrew/bin', executable),
          join('/usr/local/bin', executable),
        ]);
        return [
          command,
          {
            status: runnerPath ? 'ready' : 'missing',
            path: runnerPath,
            kind: runnerPath ? 'shell-script' : undefined,
            platform: 'darwin',
          },
        ];
      }),
    );
  }

  private buildMacWechatToolReadinessCheck(): WechatContactsReadinessCheck {
    const commandRoot = this.getMacWechatCommandRoot();
    const developmentRoot = join(
      this.getProjectRoot(),
      'desktop',
      'runtime',
      'wechat-macos',
      'bin',
    );
    const tools = [
      {
        key: 'desktop-control',
        label: '桌面控制',
        path: this.resolveFirstExistingLocalPath([
          commandRoot ? join(commandRoot, 'cliclick') : undefined,
          join(developmentRoot, 'cliclick'),
        ]),
      },
      {
        key: 'python',
        label: '本机脚本服务',
        path: this.resolveFirstExistingLocalPath([
          process.env.PYTHON,
          '/usr/bin/python3',
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
        ]),
      },
      {
        key: 'vision',
        label: '文字识别',
        path: this.resolveFirstExistingLocalPath([
          '/usr/bin/swift',
          '/Library/Developer/CommandLineTools/usr/bin/swift',
        ]),
      },
      {
        key: 'automation',
        label: '系统自动化',
        path: this.resolveFirstExistingLocalPath(['/usr/bin/osascript']),
      },
      {
        key: 'screenshot',
        label: '屏幕读取',
        path: this.resolveFirstExistingLocalPath(['/usr/sbin/screencapture']),
      },
    ];
    const missing = tools.filter((item) => !item.path);
    return {
      key: 'macos-wechat-tools',
      name: 'Mac 微信运行环境',
      status: missing.length ? 'warning' : 'ready',
      message: missing.length
        ? `${missing.map((item) => item.label).join('、')}不可用，部分微信操作会停止在执行前。`
        : '桌面控制、文字识别和屏幕读取能力均可用。',
      nextAction: missing.length
        ? '请安装完整桌面版并在系统设置中允许辅助功能和屏幕录制。'
        : undefined,
      details: { tools },
    };
  }

  private normalizeJsonRecordArray(value: unknown) {
    if (!Array.isArray(value)) {
      return undefined;
    }
    const records = value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
    return records.length ? records.slice(0, 100) : undefined;
  }

  private mergeWechatDiagnosticStringArrays(
    ...values: Array<string[] | undefined>
  ) {
    return [
      ...new Set(
        values
          .flatMap((items) => items || [])
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 50);
  }

  private mergeWechatContactsSyncDiagnostics(
    ...values: unknown[]
  ): WechatContactsSyncDiagnostics | undefined {
    let merged: WechatContactsSyncDiagnostics | undefined;
    for (const value of values) {
      const normalized = this.normalizeWechatContactsSyncDiagnostics(value);
      if (!normalized) {
        continue;
      }
      const previous = merged;
      merged = this.normalizeWechatContactsSyncDiagnostics(
        normalized,
        previous,
      );
      if (previous && merged) {
        merged.attemptedSources = this.mergeWechatDiagnosticStringArrays(
          previous.attemptedSources,
          normalized.attemptedSources,
        );
        merged.warnings = this.mergeWechatDiagnosticStringArrays(
          previous.warnings,
          normalized.warnings,
        );
        merged.rawPreview = this.mergeWechatDiagnosticStringArrays(
          previous.rawPreview,
          normalized.rawPreview,
        );
        merged.ocrPreview = this.mergeWechatDiagnosticStringArrays(
          previous.ocrPreview,
          normalized.ocrPreview,
        );
        merged.runtimeCapabilities = this.mergeWechatDiagnosticStringArrays(
          previous.runtimeCapabilities,
          normalized.runtimeCapabilities,
        );
        merged.dbPaths = this.mergeWechatDiagnosticStringArrays(
          previous.dbPaths,
          normalized.dbPaths,
        );
      }
    }
    return merged;
  }

  private isWechatContactVisionFallbackEnabled() {
    if (!this.configService) {
      return false;
    }
    const value = (
      this.configService.get<string>(
        'AI_CONTENT_WECHAT_CONTACT_VISION_FALLBACK',
      ) || ''
    )
      .trim()
      .toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  }

  private resolveImageMimeType(filePath: string) {
    const ext = extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
  }

  private async tryRunWechatContactVisionFallback(error: unknown) {
    if (
      !this.isWechatContactVisionFallbackEnabled() ||
      !this.aiClient ||
      !this.defaultModels
    ) {
      return null;
    }
    const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
      (error as { diagnostics?: unknown })?.diagnostics,
    );
    if (this.isNonWechatContactSyncDiagnostics(diagnostics)) {
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        fallback: 'vision',
        skipped: true,
        reason: '本地诊断已确认当前焦点不是微信通讯录窗口，已跳过视觉兜底。',
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return null;
    }
    const screenshotPath = diagnostics?.screenshotPath;
    if (!screenshotPath || !existsSync(screenshotPath)) {
      return null;
    }
    try {
      const defaults = await this.defaultModels.getDefaults();
      const modelId =
        this.configService
          .get<string>('AI_CONTENT_WECHAT_CONTACT_VISION_MODEL_ID')
          ?.trim() ||
        defaults.articleCreation ||
        defaults.topicSelection;
      if (!modelId) {
        return null;
      }
      const image = await readFile(screenshotPath);
      const maxBytes = Number(
        this.configService.get<string>(
          'AI_CONTENT_WECHAT_CONTACT_VISION_MAX_BYTES',
        ) || 7 * 1024 * 1024,
      );
      if (Number.isFinite(maxBytes) && image.length > maxBytes) {
        await this.writeWechatContactSyncDiagnostics({
          ok: false,
          fallback: 'vision',
          skipped: true,
          reason: `截图过大：${image.length} bytes`,
          diagnostics,
          capturedAt: new Date().toISOString(),
        });
        return null;
      }
      const output = await this.aiClient.generateWithImage(
        modelId,
        {
          system:
            '你是桌面微信通讯录截图识别器，只从图片中提取联系人或群聊名称。',
          prompt: [
            '请从这张 Windows 微信通讯录截图中提取可见联系人/群聊名称。',
            '只输出 JSON，不要解释。格式：{"contacts":["名称1","名称2"],"warnings":[]}',
            '不要输出“微信、通讯录、联系人、搜索、新的朋友、群聊、标签、公众号”等导航文字。',
            '不要猜测图片里没有出现的名字。',
          ].join('\n'),
          imageBase64: image.toString('base64'),
        },
        {
          mimeType: this.resolveImageMimeType(screenshotPath),
          temperature: 0,
          maxTokens: 900,
          detail: 'high',
          knowledgeMode: 'off',
        },
      );
      const parsed = this.parseWechatVisionContactsOutput(output);
      const contacts = this.normalizeWechatContactList(parsed.contacts, {
        syncedAt: new Date().toISOString(),
      });
      const names = contacts.map((item) => this.getWechatContactDisplay(item));
      if (!names.length) {
        await this.writeWechatContactSyncDiagnostics({
          ok: false,
          fallback: 'vision',
          skipped: false,
          reason: '视觉模型没有提取到联系人',
          modelId,
          output,
          diagnostics,
          capturedAt: new Date().toISOString(),
        });
        return null;
      }
      const mergedDiagnostics = {
        ...diagnostics,
        source: 'windows-wechat-vision',
        stage: 'vision-fallback-completed',
        screenshotPath,
        attemptedSources: [
          ...(diagnostics?.attemptedSources || []),
          'cloud-vision',
        ],
        warnings: [
          ...(diagnostics?.warnings || []),
          '已启用云端视觉兜底识别通讯录截图。',
          ...parsed.warnings,
        ],
      };
      await this.writeWechatContactSyncDiagnostics({
        ok: true,
        fallback: 'vision',
        modelId,
        contacts: names,
        diagnostics: mergedDiagnostics,
        capturedAt: new Date().toISOString(),
      });
      return {
        ok: true,
        source: 'windows-wechat-vision',
        contacts: names,
        count: names.length,
        screenshotPath,
        diagnostics: mergedDiagnostics,
      };
    } catch (visionError) {
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        fallback: 'vision',
        error:
          visionError instanceof Error
            ? visionError.message
            : String(visionError || 'vision fallback failed'),
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return null;
    }
  }

  private parseWechatVisionContactsOutput(output: string): {
    contacts: string[];
    warnings: string[];
  } {
    const text = String(output || '').trim();
    const jsonText =
      text.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim() ||
      text.match(/```\s*([\s\S]*?)```/)?.[1]?.trim() ||
      text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try {
      const parsed = JSON.parse(jsonText || text) as Record<string, unknown>;
      return {
        contacts: this.normalizeStringArray(parsed.contacts),
        warnings: this.normalizeStringArray(parsed.warnings),
      };
    } catch {
      return {
        contacts: this.normalizeStringArray(
          text
            .split(/\r?\n|[,，、]/)
            .map((item) => item.replace(/^[-*\d.、\s]+/, '').trim()),
        ),
        warnings: ['视觉模型没有返回标准 JSON，已按文本行兜底解析。'],
      };
    }
  }

  private getRuntimePlatform() {
    return platform();
  }

  private humanizeWechatContactSyncErrorMessage(
    error: unknown,
    runtimePlatform?: ReturnType<typeof platform>,
  ) {
    const rawMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : this.stringifyWechatDiagnosticMessage(error);
    let message = rawMessage
      .replace(/\s+/g, ' ')
      .replace(/\/Users\/[^\s]+/g, '本机文件')
      .replace(/[A-Z]:\\[^\s]+/gi, '本机文件')
      .trim();
    if (!message) {
      message =
        runtimePlatform === 'win32'
          ? '请确认微信桌面版已登录并打开主窗口。'
          : '请确认微信已登录，并授权屏幕录制、辅助功能。';
    }
    if (/failed to fetch|fetch failed|networkerror/i.test(message)) {
      message =
        '本机微信通讯录同步服务暂时不可用，请确认本地运行时已启动并允许后端访问。';
    }
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
      message =
        '本机微信通讯录同步服务连接不上，请确认桌面运行时已启动后再重试。';
    }
    if (/spawn powershell\.exe ENOENT/i.test(message)) {
      message = '没有找到 Windows PowerShell，无法启动微信通讯录同步控制器。';
    }
    if (
      runtimePlatform === 'darwin' &&
      (/osascript.*不允许辅助访问|not allowed assistive access|not authorized to send Apple events|-25211/i.test(
        message,
      ) ||
        (message.includes('System Events') && message.includes('osascript')))
    ) {
      message =
        '本机没有授权桌面控制权限，系统已保留现有联系人名单，没有覆盖本地数据。';
    }
    message = this.cleanWechatContactSyncUserMessage(message, runtimePlatform);
    if (message.length > 600) {
      message = `${message.slice(0, 600)}...`;
    }
    return message;
  }

  private wechatContactSyncLastFailureMessage(
    lastFailure: Record<string, unknown>,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    runtimePlatform: ReturnType<typeof platform>,
  ) {
    const directMessage =
      this.optionalDiagnosticText(lastFailure.error) ||
      this.optionalDiagnosticText(lastFailure.reason) ||
      this.optionalDiagnosticText(lastFailure.message) ||
      this.optionalDiagnosticText(lastFailure.fallbackReason) ||
      this.optionalDiagnosticText(lastFailure.syncFallbackReason) ||
      this.optionalDiagnosticText(diagnostics?.failureReason) ||
      this.optionalDiagnosticText(diagnostics?.fallbackReason);
    if (directMessage) {
      return this.humanizeWechatContactSyncErrorMessage(
        directMessage,
        runtimePlatform,
      );
    }
    const formatted = this.formatWechatContactsDiagnosticsForError(
      diagnostics || lastFailure,
    );
    if (formatted) {
      return this.humanizeWechatContactSyncErrorMessage(
        formatted,
        runtimePlatform,
      );
    }
    return '';
  }

  private stringifyWechatDiagnosticMessage(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return String(value ?? '');
    }
    const record = value as Record<string, unknown>;
    const direct =
      this.optionalDiagnosticText(record.message) ||
      this.optionalDiagnosticText(record.error) ||
      this.optionalDiagnosticText(record.reason) ||
      this.optionalDiagnosticText(record.failureReason) ||
      this.optionalDiagnosticText(record.fallbackReason);
    if (direct) return direct;
    const diagnostics = this.normalizeWechatContactsSyncDiagnostics(value);
    const formatted = this.formatWechatContactsDiagnosticsForError(diagnostics);
    return formatted || '';
  }

  private optionalDiagnosticText(value: unknown) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }
    const text = String(value).trim();
    return text && text !== '[object Object]' ? text : undefined;
  }

  private cleanWechatContactSyncUserMessage(
    value: string,
    runtimePlatform?: ReturnType<typeof platform>,
  ) {
    const message = String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const isWindows =
      runtimePlatform === 'win32' || /Windows|win32/i.test(message);
    const technicalBlocked =
      /native-db-helper-blocked|DB\/helper|db-helper|helper 主链路|数据库\/helper|UIA\/OCR screen collection was skipped|已跳过 UIA\/OCR|skipped-db-helper-required|failed-contract|failed-exit|helper exit|file is not a database|encrypted-or-locked|memory-key-missing|current-account-db-key-missing|wx_key\.dll|Dbkey|decrypt/i.test(
        message,
      );
    if (isWindows && technicalBlocked) {
      if (
        /windowStatus["']?\s*[:=]\s*["']?not-found|微信进程存在，但当前执行器拿不到可控窗口|not-found.*WeChat|window-not-found|not-logged-in/i.test(
          message,
        )
      ) {
        return '本机没有拿到可控的微信窗口，通讯录暂时没同步成功。请在当前登录的桌面会话打开微信并进入通讯录页，再重新同步。';
      }
      if (
        /encrypted-or-locked|memory-key-missing|current-account-db-key-missing|key-missing|file is not a database|wx_key\.dll|Dbkey|decrypt/i.test(
          message,
        )
      ) {
        return '本机没有读到当前微信账号的可用联系人。请确认电脑微信已登录当前账号并保持在线，必要时重启微信后重新同步。';
      }
      return '微信通讯录暂时没同步成功。请确认电脑微信已登录并保持在线，然后重新同步。';
    }
    return message
      .replace(/Windows 微信联系人(?:全量)?同步失败[:：]\s*/g, '')
      .replace(
        /数据库\/helper 主链路没有拿到联系人[，, ]*已跳过 UIA\/OCR 屏幕采集。?/gi,
        '本机没有读到可用联系人。',
      )
      .replace(
        /DB\/helper did not return contacts; UIA\/OCR screen collection is disabled by default/gi,
        '本机没有读到可用联系人。',
      )
      .replace(
        /UIA\/OCR screen collection was skipped; WeChat contacts must come from the database\/helper chain\.?/gi,
        '已使用安全读取策略。',
      );
  }

  private shouldBlockWechatContactCacheFallback(
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ) {
    if (!diagnostics) return false;
    const signal = [
      diagnostics.currentAccountDbBlocked ? 'current-account-db-blocked' : '',
      ...(diagnostics.blockedReasons || []),
      ...(diagnostics.dbErrors || []).map((item) =>
        [item.status, item.reason].filter(Boolean).join(' '),
      ),
    ]
      .filter(Boolean)
      .join(' ');
    return /current-account-db-(?:blocked|unreadable)|current-account-db-unreadable/i.test(
      signal,
    );
  }

  private toWechatContactsSyncException(
    error: unknown,
    runtimePlatform: ReturnType<typeof platform>,
  ) {
    const message = this.humanizeWechatContactSyncErrorMessage(
      error,
      runtimePlatform,
    );
    const prefix =
      runtimePlatform === 'win32'
        ? 'Windows 微信通讯录同步失败'
        : '微信通讯录同步失败';
    return new BadRequestException(`${prefix}：${message}`);
  }

  private compactWechatContactSyncOutput(value: string, maxLength = 1200) {
    const text = String(value || '')
      .replace(/\u0000/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(-maxLength);
  }

  private runWechatContactSyncScript(
    scriptPath: string,
    mode: WechatContactsSyncMode = 'random',
  ): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, reject) => {
      const pythonCommand =
        process.env.AI_CONTENT_PYTHON_PATH?.trim() ||
        process.env.PYTHON?.trim() ||
        'python3';
      const child = spawn(pythonCommand, [scriptPath, '--mode', mode], {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('微信联系人同步执行超时'));
      }, 180000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        if (!output) {
          reject(new Error('微信联系人同步没有返回结果'));
          return;
        }
        try {
          const parsed = JSON.parse(output) as Record<string, unknown>;
          if (parsed.ok === false) {
            const parsedError = new Error(
              typeof parsed.error === 'string'
                ? parsed.error
                : '微信联系人同步失败',
            );
            (
              parsedError as Error & {
                diagnostics?: unknown;
                parsed?: unknown;
              }
            ).diagnostics = parsed.diagnostics;
            (
              parsedError as Error & {
                diagnostics?: unknown;
                parsed?: unknown;
              }
            ).parsed = parsed;
            reject(parsedError);
            return;
          }
          if (code !== 0) {
            reject(
              new Error(
                (stderr || stdout || `微信联系人同步退出码 ${code}`).trim(),
              ),
            );
            return;
          }
          resolvePromise(parsed);
        } catch (error) {
          if (code !== 0) {
            reject(
              new Error(
                (stderr || stdout || `微信联系人同步退出码 ${code}`).trim(),
              ),
            );
            return;
          }
          reject(
            new Error(
              `微信联系人同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    });
  }

  private async runWechatWindowsContactSyncScript(
    mode: WechatContactsSyncMode = 'random',
  ): Promise<Record<string, unknown>> {
    const sqliteCliPath = this.resolveWechatSqliteCliPath();
    const wechatDbHelperPath = this.resolveWechatDbHelperPath();
    const fallbackDiagnostics: WechatContactsSyncDiagnostics[] = [];
    const nativeRuntimeAttempt = await this.tryRunWechatNativeContactSync(
      mode,
      sqliteCliPath,
      wechatDbHelperPath,
    );
    if (nativeRuntimeAttempt.result) {
      return nativeRuntimeAttempt.result;
    }
    if (nativeRuntimeAttempt.diagnostics) {
      fallbackDiagnostics.push(nativeRuntimeAttempt.diagnostics);
    }

    const engineAttempt = await this.tryRunWechatEngineContactSync(
      mode,
      sqliteCliPath,
    );
    if (engineAttempt.result) {
      return this.withWechatContactFallbackDiagnostics(
        engineAttempt.result,
        fallbackDiagnostics,
      );
    }
    if (engineAttempt.diagnostics) {
      fallbackDiagnostics.push(engineAttempt.diagnostics);
    }

    const scriptPath = join(
      tmpdir(),
      `ai-content-wechat-contact-sync-${Date.now()}.ps1`,
    );
    await writeFile(
      scriptPath,
      `\uFEFF${this.getWechatWindowsContactSyncScript()}`,
      'utf8',
    );

    const powershellResult = await new Promise<Record<string, unknown>>(
      (resolvePromise, reject) => {
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
          {
            env: {
              ...process.env,
              AI_CONTENT_WECHAT_CONTACT_SYNC_MODE: mode,
              ...(wechatDbHelperPath
                ? { AI_CONTENT_WECHAT_DB_HELPER: wechatDbHelperPath }
                : {}),
              ...(sqliteCliPath
                ? { AI_CONTENT_SQLITE_EXE: sqliteCliPath }
                : {}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        const timeoutMs =
          mode === 'all'
            ? WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS
            : WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS;
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(
            new Error(
              mode === 'all'
                ? 'Windows 微信联系人全量同步执行超时'
                : 'Windows 微信联系人同步执行超时',
            ),
          );
        }, timeoutMs);
        child.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          clearTimeout(timeout);
          void rm(scriptPath, { force: true });
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          void rm(scriptPath, { force: true });
          const output = this.findLastJsonLine(stdout);
          if (!output) {
            const detail = this.compactWechatContactSyncOutput(
              stderr || stdout || `退出码 ${code ?? 'unknown'}，没有输出`,
            );
            const diagnostics = {
              ok: false,
              code,
              mode,
              error: '微信通讯录暂时没同步成功',
              stderrTail: stderr.slice(-4000),
              stdoutTail: stdout.slice(-4000),
              outputTail: this.compactWechatContactSyncOutput(
                stderr || stdout,
                4000,
              ),
              capturedAt: new Date().toISOString(),
            };
            const mergedDiagnostics = this.mergeWechatContactsSyncDiagnostics(
              ...fallbackDiagnostics,
              {
                stage: 'powershell-no-output',
                source: 'windows-wechat-powershell',
                fallbackReason: diagnostics.error,
              },
            );
            void this.writeWechatContactSyncDiagnostics({
              ...diagnostics,
              diagnostics: mergedDiagnostics,
            });
            const noOutputError = new Error(
              detail
                ? `微信通讯录暂时没同步成功：${detail}`
                : '微信通讯录暂时没同步成功',
            );
            (noOutputError as Error & { diagnostics?: unknown }).diagnostics =
              mergedDiagnostics;
            reject(noOutputError);
            return;
          }
          try {
            const parsed = JSON.parse(output) as Record<string, unknown>;
            if (parsed.ok === false) {
              const parsedErrorMessage =
                typeof parsed.error === 'string'
                  ? this.humanizeWechatContactSyncErrorMessage(
                      parsed.error,
                      'win32',
                    )
                  : '微信通讯录暂时没同步成功';
              const mergedDiagnostics = this.mergeWechatContactsSyncDiagnostics(
                ...fallbackDiagnostics,
                parsed.diagnostics,
                {
                  stage: 'powershell-failed',
                  source: 'windows-wechat-powershell',
                  fallbackReason: parsedErrorMessage,
                },
              );
              void this.writeWechatContactSyncDiagnostics({
                ok: false,
                code,
                mode,
                parsed: { ...parsed, error: parsedErrorMessage },
                diagnostics: mergedDiagnostics,
                stderrTail: stderr.slice(-4000),
                stdoutTail: stdout.slice(-4000),
                capturedAt: new Date().toISOString(),
              });
              const diagnosticText =
                this.formatWechatContactsDiagnosticsForError(mergedDiagnostics);
              const parsedError = new Error(
                [parsedErrorMessage, diagnosticText].filter(Boolean).join('；'),
              );
              (
                parsedError as Error & {
                  diagnostics?: unknown;
                  parsed?: unknown;
                }
              ).diagnostics = mergedDiagnostics;
              (
                parsedError as Error & {
                  diagnostics?: unknown;
                  parsed?: unknown;
                }
              ).parsed = parsed;
              reject(parsedError);
              return;
            }
            if (code !== 0) {
              const detail = this.compactWechatContactSyncOutput(
                stderr || stdout || `Windows 微信联系人同步退出码 ${code}`,
              );
              reject(
                new Error(detail || `Windows 微信联系人同步退出码 ${code}`),
              );
              return;
            }
            resolvePromise(parsed);
          } catch (error) {
            if (code !== 0) {
              const detail = this.compactWechatContactSyncOutput(
                stderr || stdout || `Windows 微信联系人同步退出码 ${code}`,
              );
              reject(
                new Error(detail || `Windows 微信联系人同步退出码 ${code}`),
              );
              return;
            }
            const rawOutput = this.compactWechatContactSyncOutput(
              stdout || stderr,
              800,
            );
            reject(
              new Error(
                `Windows 微信联系人同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}；原始输出：${rawOutput}`,
              ),
            );
            void this.writeWechatContactSyncDiagnostics({
              ok: false,
              code,
              mode,
              error:
                error instanceof Error
                  ? error.message
                  : String(error || 'JSON parse error'),
              stderrTail: stderr.slice(-4000),
              stdoutTail: stdout.slice(-4000),
              capturedAt: new Date().toISOString(),
            });
          }
        });
      },
    );
    return this.withWechatContactFallbackDiagnostics(
      powershellResult,
      fallbackDiagnostics,
    );
  }

  private resolveWechatEnginePath() {
    return this.resolveFirstExistingLocalPath([
      process.env.AI_CONTENT_WECHAT_ENGINE,
      join(process.cwd(), 'wechat-engine', 'kaypal-wechat-engine.exe'),
      join(process.cwd(), 'wechat-engine', 'kaypal-wechat-engine.js'),
      join(process.cwd(), 'kaypal-wechat-engine.exe'),
      join(process.cwd(), 'kaypal-wechat-engine.js'),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-engine',
        'kaypal-wechat-engine.exe',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-engine',
        'kaypal-wechat-engine.js',
      ),
    ]);
  }

  private resolveWechatNativeRuntimePath() {
    return this.resolveFirstExistingLocalPath([
      process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME,
      join(
        process.cwd(),
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.exe',
      ),
      join(
        process.cwd(),
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.js',
      ),
      join(process.cwd(), 'kaypal-wechat-native-runtime.exe'),
      join(process.cwd(), 'kaypal-wechat-native-runtime.js'),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.exe',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-native-runtime',
        'kaypal-wechat-native-runtime.js',
      ),
    ]);
  }

  private getWechatContactSyncResultCount(result: Record<string, unknown>) {
    const declaredCount = Number(result.count);
    const itemCount = Array.isArray(result.items) ? result.items.length : 0;
    const contactCount = Array.isArray(result.contacts)
      ? result.contacts.length
      : 0;
    return Math.max(
      Number.isFinite(declaredCount) ? declaredCount : 0,
      itemCount,
      contactCount,
    );
  }

  private getWechatContactSyncLowConfidenceReason(
    result: Record<string, unknown>,
    mode: WechatContactsSyncMode,
  ) {
    const count = this.getWechatContactSyncResultCount(result);
    const diagnostics = this.normalizeWechatContactsSyncDiagnostics(
      result.diagnostics,
    );
    const source =
      typeof result.source === 'string'
        ? result.source
        : diagnostics?.source || '';
    const stage = diagnostics?.stage || '';
    const engine = diagnostics?.engine || '';
    const uiaStatus = diagnostics?.uiaStatus || '';
    const uiaStopReason = diagnostics?.uiaStopReason || '';
    const failureReason = diagnostics?.failureReason || '';
    const fallbackReason = diagnostics?.fallbackReason || '';
    const dbKeyStatus = diagnostics?.dbKeyStatus || '';
    const dbStatus = diagnostics?.dbStatus || '';
    const dbError = diagnostics?.dbError || '';
    const helperStatus = diagnostics?.helperStatus || '';
    const helperError = diagnostics?.helperError || '';
    const keyHelperStatus = diagnostics?.keyHelperStatus || '';
    const decryptionStatus = diagnostics?.decryptionStatus || '';
    const resultSource = diagnostics?.resultSource || '';
    const pagesScanned = Number(diagnostics?.pagesScanned) || 0;
    const uiaContactCount = Number(diagnostics?.uiaContactCount);
    const signal = [
      source,
      stage,
      engine,
      uiaStatus,
      uiaStopReason,
      failureReason,
      fallbackReason,
      ...(diagnostics?.warnings || []),
    ]
      .filter(Boolean)
      .join(' ');
    const looksLikeWindowsCollector =
      /windows|uia|powershell|wechat-engine|native-runtime|kaypal-wechat-engine/i.test(
        signal,
      );
    const isDatabaseResult =
      /native-db|engine-db|wechat-db|db-completed|database/i.test(
        `${source} ${stage}`,
      );
    const accountSignal =
      this.optionalTrimmedText(result.currentWechatId) ||
      this.optionalTrimmedText(result.current_wechat_id) ||
      this.optionalTrimmedText(diagnostics?.selectedDbAccountFolder) ||
      this.optionalTrimmedText(diagnostics?.selectedDbBaseWxid);
    const isMacosOcrResult = /macos-wechat-ocr/i.test(
      `${source} ${stage} ${resultSource}`,
    );
    if (isMacosOcrResult && count > 0 && !accountSignal) {
      return 'macOS OCR 通讯录结果没有微信账号标识，已拒绝写入，避免同步后页面又被账号守卫清空';
    }
    if (
      looksLikeWindowsCollector &&
      isDatabaseResult &&
      count > 0 &&
      !accountSignal
    ) {
      return '数据库通讯录结果没有微信账号标识，已拒绝写入，避免新账号继续显示旧账号名单';
    }
    const dbPrimaryState = [
      dbKeyStatus,
      dbStatus,
      dbError,
      helperStatus,
      helperError,
      keyHelperStatus,
      decryptionStatus,
      resultSource,
      JSON.stringify(diagnostics?.layers || {}),
    ]
      .filter(Boolean)
      .join(' ');
    const dbPrimaryBlocked =
      !isDatabaseResult &&
      /encrypted-or-locked|locked-or-permission-denied|decryptor-missing|memory-key-missing|helper.*(missing|failed|blocked)|db helper|database is locked|file is not a database|contact database not found|contacts-blocked/i.test(
        dbPrimaryState,
      );
    const dbPrimaryAttempted =
      !isDatabaseResult &&
      /db|sqlite|helper|decrypt|contact\.db|MicroMsg\.db|windows-db/i.test(
        dbPrimaryState,
      );
    const hasUiaEvidence =
      !isDatabaseResult &&
      (/uia|控制器|powershell|not-wechat-contacts-page|no-scrollable-container/i.test(
        signal,
      ) ||
        diagnostics?.uiaContactCount !== undefined);
    const hasBrokenUiaSignal =
      !isDatabaseResult &&
      /not-wechat-contacts-page|no-scrollable-container|scroll-no-progress|duplicate-page|window-not-found|不是微信通讯录|没有识别到微信窗口特征|UIA did not look/i.test(
        signal,
      );

    if (!looksLikeWindowsCollector) {
      return '';
    }
    if (hasBrokenUiaSignal && count <= 1) {
      return `采集器明确没有停在微信通讯录页，只识别到 ${count} 个联系人`;
    }
    if (mode === 'all') {
      if (hasUiaEvidence && count <= 1) {
        return `全量同步只识别到 ${count} 个联系人，低于可信阈值`;
      }
      if (hasUiaEvidence && count < 5 && pagesScanned >= 2) {
        return `全量同步扫描 ${pagesScanned} 页但只识别到 ${count} 个联系人`;
      }
      if (
        Number.isFinite(uiaContactCount) &&
        uiaContactCount > 0 &&
        uiaContactCount < 5 &&
        pagesScanned >= 2
      ) {
        return `全量 UIA 扫描 ${pagesScanned} 页但只产出 ${uiaContactCount} 个候选`;
      }
      if (
        count < 10 &&
        dbKeyStatus === 'encrypted-or-locked' &&
        helperStatus !== 'completed'
      ) {
        return '微信数据库加密或被占用，解密 helper 未完成，UIA 结果过少';
      }
    } else if (
      (dbPrimaryBlocked || dbPrimaryAttempted) &&
      hasUiaEvidence &&
      count <= 0
    ) {
      return '微信通讯录窗口同步没有识别到可用联系人';
    }
    return '';
  }

  private withWechatContactFallbackDiagnostics(
    result: Record<string, unknown>,
    fallbackDiagnostics: WechatContactsSyncDiagnostics[],
  ) {
    const source =
      typeof result.source === 'string' ? result.source : undefined;
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      ...fallbackDiagnostics,
      result.diagnostics,
      source ? { source } : undefined,
    );
    return diagnostics ? { ...result, diagnostics } : result;
  }

  private async tryRunWechatNativeContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    decryptionHelperPath: string,
  ): Promise<WechatContactSyncAttempt> {
    const nativeRuntimePath = this.resolveWechatNativeRuntimePath();
    if (!nativeRuntimePath) {
      return { result: null };
    }
    const baseDiagnostics = this.normalizeWechatContactsSyncDiagnostics({
      source: 'kaypal-wechat-native-runtime',
      engine: 'kaypal-wechat-native-runtime',
      nativeRuntimePath,
      decryptionHelperPath,
      sqlitePath: sqliteCliPath,
      attemptedSources: ['native-runtime'],
    });
    try {
      const result = await this.runWechatEngineContactSyncScript(
        nativeRuntimePath,
        mode,
        sqliteCliPath,
        'kaypal-wechat-native-runtime',
      );
      const count = this.getWechatContactSyncResultCount(result);
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        baseDiagnostics,
        result.diagnostics,
        typeof result.source === 'string'
          ? { source: result.source }
          : undefined,
      );
      const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
        diagnostics ? { ...result, diagnostics } : result,
        mode,
      );
      if (count > 0 && !lowConfidenceReason) {
        return {
          result: diagnostics ? { ...result, diagnostics } : result,
          diagnostics,
        };
      }
      const fallbackDiagnostics = this.mergeWechatContactsSyncDiagnostics(
        diagnostics,
        {
          fallbackReason:
            lowConfidenceReason ||
            'Native runtime 没有读到联系人，已自动回退到 legacy wechat-engine。',
          failureReason: lowConfidenceReason || undefined,
        },
      );
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        mode,
        fallback: 'wechat-engine',
        reason:
          lowConfidenceReason ||
          'Native runtime 没有读到联系人，已自动回退到 legacy wechat-engine。',
        parsed: result,
        diagnostics: fallbackDiagnostics,
        capturedAt: new Date().toISOString(),
      });
      return { result: null, diagnostics: fallbackDiagnostics };
    } catch (error) {
      const message = this.humanizeWechatContactSyncErrorMessage(
        error,
        'win32',
      );
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        baseDiagnostics,
        (error as { diagnostics?: unknown })?.diagnostics,
        {
          fallbackReason: message,
          failureReason: message,
        },
      );
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        mode,
        fallback: 'wechat-engine',
        nativeRuntimePath,
        error: message,
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return { result: null, diagnostics };
    }
  }

  private async tryRunWechatEngineContactSync(
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
  ): Promise<WechatContactSyncAttempt> {
    const enginePath = this.resolveWechatEnginePath();
    if (!enginePath) {
      return { result: null };
    }
    const baseDiagnostics = this.normalizeWechatContactsSyncDiagnostics({
      source: 'kaypal-wechat-engine',
      engine: 'kaypal-wechat-engine',
      enginePath,
      sqlitePath: sqliteCliPath,
      attemptedSources: ['wechat-engine'],
    });
    try {
      const result = await this.runWechatEngineContactSyncScript(
        enginePath,
        mode,
        sqliteCliPath,
      );
      const count = this.getWechatContactSyncResultCount(result);
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        baseDiagnostics,
        result.diagnostics,
        typeof result.source === 'string'
          ? { source: result.source }
          : undefined,
      );
      const lowConfidenceReason = this.getWechatContactSyncLowConfidenceReason(
        diagnostics ? { ...result, diagnostics } : result,
        mode,
      );
      if (count > 0 && !lowConfidenceReason) {
        return {
          result: diagnostics ? { ...result, diagnostics } : result,
          diagnostics,
        };
      }
      const fallbackDiagnostics = this.mergeWechatContactsSyncDiagnostics(
        diagnostics,
        {
          fallbackReason:
            lowConfidenceReason ||
            'Legacy wechat-engine 没有读到联系人，已自动回退到 PowerShell/OCR 采集。',
          failureReason: lowConfidenceReason || undefined,
        },
      );
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        mode,
        fallback: 'powershell-legacy',
        reason:
          lowConfidenceReason ||
          'Legacy wechat-engine 没有读到联系人，已自动回退到 PowerShell/OCR 采集。',
        parsed: result,
        diagnostics: fallbackDiagnostics,
        capturedAt: new Date().toISOString(),
      });
      return { result: null, diagnostics: fallbackDiagnostics };
    } catch (error) {
      const message = this.humanizeWechatContactSyncErrorMessage(
        error,
        'win32',
      );
      const diagnostics = this.mergeWechatContactsSyncDiagnostics(
        baseDiagnostics,
        (error as { diagnostics?: unknown })?.diagnostics,
        {
          fallbackReason: message,
          failureReason: message,
        },
      );
      await this.writeWechatContactSyncDiagnostics({
        ok: false,
        mode,
        fallback: 'powershell-legacy',
        enginePath,
        error: message,
        diagnostics,
        capturedAt: new Date().toISOString(),
      });
      return { result: null, diagnostics };
    }
  }

  private probeWechatNativeContactRuntime(
    nativeRuntimePath: string,
  ): Promise<WechatContactsSyncDiagnostics | undefined> {
    const isNodeScript = extname(nativeRuntimePath).toLowerCase() === '.js';
    const command = isNodeScript ? process.execPath : nativeRuntimePath;
    const args = isNodeScript ? [nativeRuntimePath, 'diagnose'] : ['diagnose'];

    return new Promise((resolveProbe) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          AI_CONTENT_WECHAT_NATIVE_RUNTIME: nativeRuntimePath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (value?: WechatContactsSyncDiagnostics) => {
        if (settled) return;
        settled = true;
        resolveProbe(value);
      };
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        settle(
          this.normalizeWechatContactsSyncDiagnostics({
            stage: 'native-diagnose-timeout',
            source: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
            fallbackReason: 'Native runtime 诊断超时。',
          }),
        );
      }, 15000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        settle(
          this.normalizeWechatContactsSyncDiagnostics({
            stage: 'native-diagnose-spawn-error',
            source: 'kaypal-wechat-native-runtime',
            nativeRuntimePath,
            fallbackReason: error.message,
          }),
        );
      });
      child.on('close', () => {
        clearTimeout(timeout);
        const jsonLine = this.findLastJsonLine(stdout);
        if (!jsonLine) {
          settle(
            this.normalizeWechatContactsSyncDiagnostics({
              stage: 'native-diagnose-no-output',
              source: 'kaypal-wechat-native-runtime',
              nativeRuntimePath,
              fallbackReason: this.compactWechatContactSyncOutput(
                stderr || stdout || 'Native runtime 诊断没有输出。',
              ),
            }),
          );
          return;
        }
        try {
          const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
          settle(
            this.normalizeWechatContactsSyncDiagnostics(parsed.diagnostics, {
              stage:
                typeof parsed.stage === 'string'
                  ? parsed.stage
                  : 'native-diagnose',
              source: 'kaypal-wechat-native-runtime',
              nativeRuntimePath,
            }),
          );
        } catch (error) {
          settle(
            this.normalizeWechatContactsSyncDiagnostics({
              stage: 'native-diagnose-parse-error',
              source: 'kaypal-wechat-native-runtime',
              nativeRuntimePath,
              fallbackReason:
                error instanceof Error ? error.message : String(error),
            }),
          );
        }
      });
    });
  }

  private runWechatEngineContactSyncScript(
    enginePath: string,
    mode: WechatContactsSyncMode,
    sqliteCliPath: string,
    runtimeName = 'kaypal-wechat-engine',
  ): Promise<Record<string, unknown>> {
    const isNodeScript = extname(enginePath).toLowerCase() === '.js';
    const command = isNodeScript ? process.execPath : enginePath;
    const args = isNodeScript
      ? [enginePath, 'contacts', '--mode', mode]
      : ['contacts', '--mode', mode];

    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, {
        env: {
          ...process.env,
          AI_CONTENT_WECHAT_CONTACT_SYNC_MODE: mode,
          AI_CONTENT_WECHAT_ENGINE: enginePath,
          ...(runtimeName === 'kaypal-wechat-native-runtime'
            ? { AI_CONTENT_WECHAT_NATIVE_RUNTIME: enginePath }
            : process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME
              ? {
                  AI_CONTENT_WECHAT_NATIVE_RUNTIME:
                    process.env.AI_CONTENT_WECHAT_NATIVE_RUNTIME,
                }
              : {}),
          ...(sqliteCliPath ? { AI_CONTENT_SQLITE_EXE: sqliteCliPath } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const settleReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const timeoutMs =
        mode === 'all'
          ? WECHAT_CONTACT_ALL_SYNC_TIMEOUT_MS
          : WECHAT_CONTACT_RANDOM_SYNC_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        const timeoutError = new Error(
          mode === 'all'
            ? 'Windows 微信联系人引擎全量同步执行超时'
            : 'Windows 微信联系人引擎同步执行超时',
        ) as Error & { diagnostics?: unknown };
        timeoutError.diagnostics = {
          stage: 'engine-timeout',
          source: runtimeName,
          enginePath,
          fallbackReason: timeoutError.message,
        };
        settleReject(timeoutError);
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        const engineError = new Error(
          `Windows 微信联系人引擎启动失败：${error.message}`,
        ) as Error & { diagnostics?: unknown };
        engineError.diagnostics = {
          stage: 'engine-spawn-error',
          source: runtimeName,
          enginePath,
          fallbackReason: error.message,
        };
        settleReject(engineError);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        const output = this.findLastJsonLine(stdout);
        if (!output) {
          const detail = this.compactWechatContactSyncOutput(
            stderr || stdout || `退出码 ${code ?? 'unknown'}，没有输出`,
          );
          const error = new Error(
            detail
              ? `Windows 微信联系人引擎没有返回结果：${detail}`
              : 'Windows 微信联系人引擎没有返回结果',
          ) as Error & { diagnostics?: unknown };
          error.diagnostics = {
            stage: 'engine-no-output',
            source: runtimeName,
            enginePath,
            fallbackReason: error.message,
            stderrTail: stderr.slice(-2000),
            stdoutTail: stdout.slice(-2000),
          };
          settleReject(error);
          return;
        }
        try {
          const parsed = JSON.parse(output) as Record<string, unknown>;
          if (parsed.ok === false || code !== 0) {
            const parsedErrorText =
              typeof parsed.error === 'string'
                ? parsed.error
                : `Windows 微信联系人引擎退出码 ${code ?? 'unknown'}`;
            const error = new Error(parsedErrorText) as Error & {
              diagnostics?: unknown;
              parsed?: unknown;
            };
            error.diagnostics = this.normalizeWechatContactsSyncDiagnostics(
              parsed.diagnostics,
              {
                stage: 'engine-failed',
                source: runtimeName,
                enginePath,
                fallbackReason: parsedErrorText,
              },
            );
            error.parsed = parsed;
            settleReject(error);
            return;
          }
          settled = true;
          resolvePromise(parsed);
        } catch (parseError) {
          const rawOutput = this.compactWechatContactSyncOutput(
            stdout || stderr,
            800,
          );
          const error = new Error(
            `Windows 微信联系人引擎返回结果不可解析：${parseError instanceof Error ? parseError.message : String(parseError)}；原始输出：${rawOutput}`,
          ) as Error & { diagnostics?: unknown };
          error.diagnostics = {
            stage: 'engine-parse-error',
            source: runtimeName,
            enginePath,
            fallbackReason: error.message,
          };
          settleReject(error);
        }
      });
    });
  }

  private resolveWechatDbHelperPath() {
    return this.resolveFirstExistingLocalPath([
      process.env.AI_CONTENT_WECHAT_DB_HELPER,
      join(process.cwd(), 'wechat-db-helper.exe'),
      join(process.cwd(), 'wechat-db-helper.js'),
      join(process.cwd(), 'bin', 'wechat-db-helper.exe'),
      join(process.cwd(), 'bin', 'wechat-db-helper.js'),
      join(process.cwd(), 'tools', 'wechat-db-helper.exe'),
      join(process.cwd(), 'tools', 'wechat-db-helper.js'),
      join(
        this.getProjectRoot(),
        'vendor',
        'wechat-db-helper',
        'wechat-db-helper.exe',
      ),
      join(
        this.getProjectRoot(),
        'vendor',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      join(
        this.getProjectRoot(),
        'vendor',
        'wechat-db-helper',
        'wechat-dump-rs.exe',
      ),
      join(
        this.getProjectRoot(),
        'vendor',
        'skillhub',
        'wechat-contact-sync',
        'bin',
        'wechat-db-helper.exe',
      ),
      join(
        this.getProjectRoot(),
        'vendor',
        'skillhub',
        'wechat-contact-sync',
        'bin',
        'wechat-db-helper.js',
      ),
      join(
        this.getProjectRoot(),
        'vendor',
        'skillhub',
        'wechat-contact-sync',
        'bin',
        'wechat-dump-rs.exe',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.exe',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-db-helper.js',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-db-helper',
        'wechat-dump-rs.exe',
      ),
    ]);
  }

  private resolveWechatSqliteCliPath() {
    return this.resolveFirstExistingLocalPath([
      process.env.AI_CONTENT_SQLITE_EXE,
      process.env.SQLITE_EXE,
      join(process.cwd(), 'sqlite3.exe'),
      join(process.cwd(), 'bin', 'sqlite3.exe'),
      join(process.cwd(), 'tools', 'sqlite3.exe'),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'wechat-db-helper',
        'sqlite3.exe',
      ),
      join(
        this.getProjectRoot(),
        'desktop',
        'runtime',
        'sqlite-tools',
        'sqlite3.exe',
      ),
      join(this.getProjectRoot(), 'vendor', 'sqlite-tools', 'sqlite3.exe'),
    ]);
  }

  private resolveFirstExistingLocalPath(candidates: Array<string | undefined>) {
    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (!value) {
        continue;
      }
      if (existsSync(value)) {
        return value;
      }
    }
    return '';
  }

  private async writeWechatContactSyncDiagnostics(
    payload: Record<string, unknown>,
  ) {
    try {
      const diagnosticsPath = this.getWechatContactsDiagnosticsPath();
      const capturedAt =
        this.optionalTrimmedText(payload.capturedAt) ||
        new Date().toISOString();
      const failureRecord = this.buildWechatContactFailureRecord(
        payload,
        capturedAt,
      );
      const evidencePackage = this.buildWechatContactDiagnosticEvidencePackage(
        payload,
        failureRecord,
        capturedAt,
      );
      await mkdir(resolve(diagnosticsPath, '..'), { recursive: true });
      await writeFile(
        diagnosticsPath,
        JSON.stringify(
          {
            ...payload,
            capturedAt,
            failureRecord,
            evidencePackage,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // Best-effort diagnostic persistence only.
    }
  }

  private buildWechatContactFailureRecord(
    payload: Record<string, unknown>,
    capturedAt: string,
  ) {
    const parsed = this.normalizeJsonRecord(payload.parsed);
    const diagnostics = this.mergeWechatContactsSyncDiagnostics(
      parsed?.diagnostics,
      payload.diagnostics,
    );
    const diagnosticsRecord = this.normalizeJsonRecord(diagnostics) || {};
    const command =
      this.optionalTrimmedText(payload.command) ||
      this.optionalTrimmedText(parsed?.command) ||
      this.optionalTrimmedText(diagnosticsRecord.command) ||
      'contacts';
    const runner =
      this.optionalTrimmedText(payload.runner) ||
      this.optionalTrimmedText(parsed?.runner) ||
      this.optionalTrimmedText(payload.fallback) ||
      this.optionalTrimmedText(diagnostics?.engine) ||
      this.optionalTrimmedText(diagnostics?.source) ||
      'wechat-contact-sync';
    const platformName =
      this.optionalTrimmedText(payload.platform) ||
      this.optionalTrimmedText(parsed?.platform) ||
      this.optionalTrimmedText(diagnosticsRecord.platform) ||
      this.optionalTrimmedText(diagnostics?.os) ||
      this.getRuntimePlatform();
    const screenshotPath =
      this.optionalTrimmedText(payload.screenshotPath) ||
      this.optionalTrimmedText(parsed?.screenshotPath) ||
      this.optionalTrimmedText(diagnostics?.screenshotPath) ||
      '';
    const message =
      this.optionalTrimmedText(payload.error) ||
      this.optionalTrimmedText(payload.reason) ||
      this.optionalTrimmedText(parsed?.error) ||
      this.optionalTrimmedText(parsed?.message) ||
      diagnostics?.failureReason ||
      diagnostics?.fallbackReason ||
      '微信联系人同步失败';
    const nextAction = this.inferWechatContactFailureNextAction(
      payload,
      parsed,
      diagnostics,
      message,
      screenshotPath,
    );
    const rawSummary = this.summarizeWechatContactFailureRaw(
      payload,
      parsed,
      diagnostics,
    );

    return {
      id: `wechat-${command}-${capturedAt.replace(/[^0-9A-Za-z]/g, '')}`,
      command,
      runner,
      platform: platformName,
      screenshotPath,
      rawSummary,
      nextAction,
      message,
      stage: diagnostics?.stage || '',
      errorCode:
        this.optionalTrimmedText(payload.errorCode) ||
        this.optionalTrimmedText(parsed?.errorCode) ||
        '',
      mode: this.optionalTrimmedText(payload.mode) || '',
      capturedAt,
    };
  }

  private buildWechatContactDiagnosticEvidencePackage(
    payload: Record<string, unknown>,
    failureRecord: Record<string, unknown>,
    generatedAt: string,
  ) {
    const validation =
      this.validateWechatContactDiagnosticEvidencePackage(failureRecord);
    return {
      schemaVersion: '2026-06-29.wechat-diagnostics-evidence-pack.v1',
      generatedAt,
      source: {
        kind: 'local-engine/wechat/contacts/diagnostics',
        diagnosticsPath: this.getWechatContactsDiagnosticsPath(),
      },
      summary: {
        status: validation.ok ? 'ready' : 'incomplete',
        failureCount: 1,
        command: failureRecord.command,
        runner: failureRecord.runner,
        platform: failureRecord.platform,
        screenshotPath: failureRecord.screenshotPath,
        nextAction: failureRecord.nextAction,
      },
      failureRecords: [failureRecord],
      validation,
      raw: {
        ok: payload.ok,
        code: payload.code,
        mode: payload.mode,
        fallback: payload.fallback,
      },
    };
  }

  private validateWechatContactDiagnosticEvidencePackage(
    failureRecord: Record<string, unknown>,
  ) {
    const requiredFields = [
      'command',
      'runner',
      'platform',
      'rawSummary',
      'nextAction',
    ];
    const errors = requiredFields
      .filter((field) => !this.optionalTrimmedText(failureRecord[field]))
      .map((field) => `failureRecord.${field} is required`);
    const warnings = this.optionalTrimmedText(failureRecord.screenshotPath)
      ? []
      : [
          'failureRecord.screenshotPath is empty; capture a screenshot on retry',
        ];
    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  private inferWechatContactFailureNextAction(
    payload: Record<string, unknown>,
    parsed: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
    message: string,
    screenshotPath: string,
  ) {
    const explicit =
      this.optionalTrimmedText(payload.nextAction) ||
      this.optionalTrimmedText(parsed?.nextAction);
    if (explicit) {
      return explicit;
    }
    const text = [
      message,
      diagnostics?.failureReason,
      diagnostics?.fallbackReason,
      diagnostics?.stage,
      diagnostics?.windowStatus,
      diagnostics?.platformStatus,
      diagnostics?.dbStatus,
      diagnostics?.helperStatus,
      diagnostics?.keyHelperStatus,
      diagnostics?.decryptionStatus,
      diagnostics?.externalKeyToolStatus,
      diagnostics?.externalRawKeyToolStatus,
      ...(diagnostics?.blockedReasons || []),
      ...(diagnostics?.decryptAttempts || []).map(
        (item) =>
          this.optionalTrimmedText(item.reason) ||
          this.optionalTrimmedText(item.status),
      ),
      ...(diagnostics?.externalDbKeyAttempts || []).map(
        (item) =>
          this.optionalTrimmedText(item.reason) ||
          this.optionalTrimmedText(item.status),
      ),
      ...(diagnostics?.externalDumpRsPidAttempts || []).map((item) =>
        this.optionalTrimmedText(item.status),
      ),
    ]
      .filter(Boolean)
      .join(' ');
    if (/unsupported|not-windows|只能在 Windows|非 Windows/i.test(text)) {
      return '请在 Windows 桌面端运行微信联系人同步，并保留本机诊断包。';
    }
    if (
      /完整好友同步.*Windows|全量同步.*Windows|macOS.*随机抽样读取/i.test(text)
    ) {
      return '当前电脑不能执行完整好友同步；请切换为随机抽样同步，或在已登录微信的 Windows 桌面环境执行完整同步。';
    }
    if (/permission|权限|辅助功能|屏幕录制|access/i.test(text)) {
      return '补齐桌面控制、屏幕录制或 UIA 权限后，重新打开微信通讯录再重试。';
    }
    if (
      /window-not-found|not running|未找到|没有识别到微信窗口|微信窗口/i.test(
        text,
      )
    ) {
      return '打开并登录桌面微信，固定到通讯录窗口后重新执行同步。';
    }
    if (/incompatible-and-unsupported/i.test(text)) {
      return '当前打包的取钥匙链路同时存在架构不匹配和微信版本不支持；需要补齐支持当前 WeChat 版本、同架构的原生 DB key helper。';
    }
    if (/architecture-mismatch|tool-incompatible|架构/i.test(text)) {
      return '当前微信进程和已打包的取钥匙组件架构不匹配；需要补齐同架构的原生 DB key helper 后再验收。';
    }
    if (
      /wechat-version-unsupported|unsupported-wechat|profile-layout|user info|phone type/i.test(
        text,
      )
    ) {
      return '当前打包的 DB key/dump 工具不适配这个微信版本；需要替换为支持当前 WeChat 数据结构的原生 helper。';
    }
    if (/db|sqlite|helper|encrypted|locked|数据库|解密/i.test(text)) {
      return '检查微信数据库 helper、sqlite 路径和微信占用状态；必要时先关闭微信后重试。';
    }
    if (!screenshotPath) {
      return '重新执行同步并保留截图路径，便于确认当前窗口、runner 和原始输出。';
    }
    return '查看 failureRecord.rawSummary、截图和 runner 状态，修复阻断项后重试。';
  }

  private summarizeWechatContactFailureRaw(
    payload: Record<string, unknown>,
    parsed: Record<string, unknown> | undefined,
    diagnostics: WechatContactsSyncDiagnostics | undefined,
  ) {
    const parts = [
      this.optionalTrimmedText(payload.rawSummary),
      this.optionalTrimmedText(payload.outputTail),
      this.optionalTrimmedText(payload.stderrTail),
      this.optionalTrimmedText(payload.stdoutTail),
      this.optionalTrimmedText(payload.error),
      this.optionalTrimmedText(payload.reason),
      this.optionalTrimmedText(parsed?.error),
      this.optionalTrimmedText(parsed?.message),
      diagnostics?.failureReason,
      diagnostics?.fallbackReason,
      diagnostics?.rawPreview?.length
        ? `rawPreview=${diagnostics.rawPreview.slice(0, 5).join(' / ')}`
        : '',
      diagnostics?.ocrPreview?.length
        ? `ocrPreview=${diagnostics.ocrPreview.slice(0, 5).join(' / ')}`
        : '',
    ].filter(Boolean);
    const text =
      parts.join(' | ') ||
      JSON.stringify({
        ok: payload.ok,
        code: payload.code,
        mode: payload.mode,
        fallback: payload.fallback,
      });
    return this.compactWechatContactSyncOutput(text, 600);
  }

  private findLastJsonLine(stdout: string) {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line.startsWith('{') && line.endsWith('}')) {
        return line;
      }
    }
    const joined = lines.join('\n');
    const start = joined.lastIndexOf('{');
    const end = joined.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return joined.slice(start, end + 1).trim();
    }
    return undefined;
  }

  private formatWechatContactsDiagnosticsForError(value: unknown) {
    const diagnostics = this.normalizeWechatContactsSyncDiagnostics(value);
    if (!diagnostics) {
      return '';
    }
    const parts = [
      diagnostics.stage ? `阶段 ${diagnostics.stage}` : '',
      diagnostics.engine ? `引擎 ${diagnostics.engine}` : '',
      diagnostics.engineVersion ? `版本 ${diagnostics.engineVersion}` : '',
      diagnostics.failureReason ? `失败原因 ${diagnostics.failureReason}` : '',
      diagnostics.dbContactCount !== undefined
        ? `DB联系人 ${diagnostics.dbContactCount} 个`
        : '',
      diagnostics.dbError ? `DB错误 ${diagnostics.dbError}` : '',
      diagnostics.fallbackReason
        ? `回退原因 ${diagnostics.fallbackReason}`
        : '',
      diagnostics.windowTitle ? `窗口 ${diagnostics.windowTitle}` : '',
      diagnostics.rawTextCount !== undefined
        ? `UIA原文 ${diagnostics.rawTextCount} 条`
        : '',
      diagnostics.ocrPreview?.length
        ? `OCR预览 ${diagnostics.ocrPreview.slice(0, 3).join(' / ')}`
        : '',
      diagnostics.screenshotPath ? `截图 ${diagnostics.screenshotPath}` : '',
    ].filter(Boolean);
    return parts.length ? `诊断：${parts.join('，')}` : '';
  }

  private getWechatWindowsContactSyncScript() {
    return String.raw`
	$ErrorActionPreference = 'Stop'
	try {
	  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
	  $OutputEncoding = [System.Text.Encoding]::UTF8
	} catch {}

	function Emit-Json($payload, [int]$code = 0) {
	  try {
	    $json = $payload | ConvertTo-Json -Depth 8 -Compress
	    [Console]::Out.WriteLine($json)
	  } catch {
	    [Console]::Out.WriteLine('{"ok":false,"error":"Windows 微信通讯录同步输出 JSON 失败","contacts":[]}')
	    $code = 1
	  }
	  exit $code
	}

	$script:KaypalContactSyncDiagnostics = [ordered]@{
	  stage = 'init'
	  attemptedSources = @()
	  warnings = @()
	  rawPreview = @()
	  ocrPreview = @()
	  pagesScanned = 0
	  uiaContactCount = 0
	  ocrContactCount = 0
	  rawTextCount = 0
	  screenshotPath = ''
	  dbContactCount = 0
	  dbPaths = @()
	  dbError = ''
	  selectedDbPath = ''
	  selectedDbAccountFolder = ''
	  selectedDbBaseWxid = ''
	  selectedDbActiveMtime = ''
	  selectedDbScore = 0
	  dbCandidateResults = @()
	}
	$script:KaypalDecryptedDbSourceMap = @{}

	function Set-Diagnostic($key, $value) {
	  $script:KaypalContactSyncDiagnostics[$key] = $value
	}

	function Add-DiagnosticListItem($key, [string]$value, [int]$max = 30) {
	  if ([string]::IsNullOrWhiteSpace($value)) { return }
	  $items = @($script:KaypalContactSyncDiagnostics[$key])
	  $value = ($value -replace '\s+', ' ').Trim()
	  if (-not $items.Contains($value)) {
	    $items += $value
	  }
	  if ($items.Count -gt $max) {
	    $items = $items[0..($max - 1)]
	  }
	  $script:KaypalContactSyncDiagnostics[$key] = @($items)
	}

	function Add-AttemptedSource([string]$source) {
	  Add-DiagnosticListItem 'attemptedSources' $source 20
	}

	function Add-DiagnosticWarning([string]$warning) {
	  Add-DiagnosticListItem 'warnings' $warning 20
	}

	function Update-MaxDiagnosticNumber($key, [int]$value) {
	  $current = 0
	  try { $current = [int]$script:KaypalContactSyncDiagnostics[$key] } catch {}
	  if ($value -gt $current) {
	    $script:KaypalContactSyncDiagnostics[$key] = $value
	  }
	}

	function Get-Diagnostics() {
	  return $script:KaypalContactSyncDiagnostics
	}

	function Fail($message) {
	  Set-Diagnostic 'failureReason' $message
	  Emit-Json @{ ok = $false; error = $message; contacts = @(); diagnostics = (Get-Diagnostics) } 1
	}

	function Normalize-DbContactText([string]$line) {
	  if ([string]::IsNullOrWhiteSpace($line)) { return '' }
	  $value = ($line -replace '\s+', ' ').Trim()
	  $value = [regex]::Replace($value, '\p{C}+', '').Trim()
	  $compact = ($value -replace '\s+', '')
	  if (-not $compact) { return '' }
	  if ($compact -match '^(微信|WeChat|Weixin|通讯录|联系人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$') { return '' }
	  if ($compact -match '星标朋友|我的企业') { return '' }
	  if ($value -match '微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选|新闻') { return '' }
	  if ($value -match '抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站') { return '' }
	  if ($compact.Length -lt 2 -or $compact.Length -gt 80) { return '' }
	  if ($compact -notmatch '[\u4e00-\u9fffA-Za-z0-9]') { return '' }
	  return $value
	}

	function Test-WeChatSystemContactId([string]$id) {
	  if ([string]::IsNullOrWhiteSpace($id)) { return $true }
	  $value = $id.Trim()
	  $lower = $value.ToLowerInvariant()
	  $systemIds = @(
	    'fmessage', 'qmessage', 'tmessage', 'weixin', 'filehelper', 'newsapp',
	    'qqmail', 'floatbottle', 'lbsapp', 'medianote', 'qqsync', 'weibo',
	    'masssendapp', 'feedsapp', 'voip', 'weixinreminder', 'officialaccounts',
	    'notification_messages', 'notifymessage', 'mphelper', 'weixin'
	  )
	  if ($systemIds -contains $lower) { return $true }
	  if ($lower.EndsWith('@chatroom')) { return $true }
	  if ($lower.StartsWith('gh_')) { return $true }
	  return $false
	}

	function Add-DbContactItem($items, [string]$wxid, [string]$nickname, [string]$remark, [string]$alias) {
	  if (Test-WeChatSystemContactId $wxid) { return }
	  $cleanRemark = Normalize-DbContactText $remark
	  $cleanNickname = Normalize-DbContactText $nickname
	  $cleanAlias = Normalize-DbContactText $alias
	  $cleanWxid = Normalize-DbContactText $wxid
	  if (-not $cleanRemark -and -not $cleanNickname -and -not $cleanAlias -and -not $cleanWxid) { return }
	  $keyParts = @($wxid, $cleanNickname, $cleanRemark, $cleanAlias) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
	  $key = ($keyParts -join '|').ToLowerInvariant()
	  for ($i = 0; $i -lt $items.Count; $i++) {
	    try {
	      $existing = $items[$i]
	      $existingKey = @($existing.wxid, $existing.nickname, $existing.remark, $existing.alias) |
	        Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
	      if ((($existingKey -join '|').ToLowerInvariant()) -eq $key) { return }
	    } catch {}
	  }
	  $items.Add([ordered]@{
	    wxid = if ([string]::IsNullOrWhiteSpace($wxid)) { $cleanNickname } else { $wxid.Trim() }
	    nickname = $cleanNickname
	    remark = $cleanRemark
	    tags = @()
	    source = 'wechat-db'
	  }) | Out-Null
	}

	function Add-UniquePath($paths, [string]$path, [bool]$diagnostic = $false) {
	  if ([string]::IsNullOrWhiteSpace($path)) { return }
	  try {
	    $full = [System.IO.Path]::GetFullPath($path)
	    if ((Test-Path -LiteralPath $full) -and -not $paths.Contains($full)) {
	      $paths.Add($full) | Out-Null
	      if ($diagnostic) {
	        Add-DiagnosticListItem 'dbPaths' $full 20
	      }
	    }
	  } catch {}
	}

	function Get-WeChatDataRoots {
	  $roots = New-Object System.Collections.Generic.List[string]
	  foreach ($path in @(
	    $env:AI_CONTENT_WECHAT_CONTACT_DB_DIR,
	    $env:AI_CONTENT_WECHAT_FILES_DIR,
	    $env:WECHAT_FILES_DIR
	  )) {
	    Add-UniquePath $roots $path
	  }
	  try {
	    $documents = [Environment]::GetFolderPath('MyDocuments')
	    Add-UniquePath $roots (Join-Path $documents 'WeChat Files')
	    Add-UniquePath $roots (Join-Path $documents 'xwechat_files')
	  } catch {}
	  foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA, $env:USERPROFILE)) {
	    if ([string]::IsNullOrWhiteSpace($base)) { continue }
	    Add-UniquePath $roots (Join-Path $base 'Tencent\WeChat')
	    Add-UniquePath $roots (Join-Path $base 'Tencent\Weixin')
	    Add-UniquePath $roots (Join-Path $base 'Documents\WeChat Files')
	    Add-UniquePath $roots (Join-Path $base 'Documents\xwechat_files')
	  }
	  try {
	    $systemDrive = [string]$env:SystemDrive
	    if ([string]::IsNullOrWhiteSpace($systemDrive)) { $systemDrive = 'C:' }
	    $usersRoot = Join-Path $systemDrive 'Users'
	    if (Test-Path -LiteralPath $usersRoot) {
	      foreach ($userDir in Get-ChildItem -LiteralPath $usersRoot -Directory -Force -ErrorAction SilentlyContinue) {
	        Add-UniquePath $roots (Join-Path $userDir.FullName 'Documents\WeChat Files')
	        Add-UniquePath $roots (Join-Path $userDir.FullName 'Documents\xwechat_files')
	      }
	    }
	  } catch {}
	  try {
	    $props = Get-ItemProperty -Path 'HKCU:\Software\Tencent\WeChat' -ErrorAction SilentlyContinue
	    foreach ($name in @('FileSavePath', 'InstallPath')) {
	      $value = [string]$props.$name
	      Add-UniquePath $roots $value
	      if (-not [string]::IsNullOrWhiteSpace($value)) {
	        Add-UniquePath $roots (Join-Path $value 'WeChat Files')
	        Add-UniquePath $roots (Join-Path $value 'xwechat_files')
	      }
	    }
	  } catch {}
	  return @($roots)
	}

	function Find-FilesLimited($root, [string[]]$names, [int]$maxDepth, [int]$maxCount) {
	  $found = New-Object System.Collections.Generic.List[string]
	  if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) { return @($found) }
	  $queue = New-Object System.Collections.Queue
	  $queue.Enqueue(@{ Path = $root; Depth = 0 })
	  while ($queue.Count -gt 0 -and $found.Count -lt $maxCount) {
	    $node = $queue.Dequeue()
	    $path = [string]$node.Path
	    $depth = [int]$node.Depth
	    $children = @()
	    try {
	      $children = @(Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)
	    } catch {
	      continue
	    }
	    foreach ($child in $children) {
	      if ($found.Count -ge $maxCount) { break }
	      if ($child.PSIsContainer) {
	        if ($depth -lt $maxDepth) {
	          $queue.Enqueue(@{ Path = $child.FullName; Depth = $depth + 1 })
	        }
	        continue
	      }
	      foreach ($name in $names) {
	        if ($child.Name -ieq $name -and -not $found.Contains($child.FullName)) {
	          $found.Add($child.FullName) | Out-Null
	          Add-DiagnosticListItem 'dbPaths' $child.FullName 20
	          break
	        }
	      }
	    }
	  }
	  return @($found)
	}

	function Get-WeChatDbCandidateInfo([string]$dbPath) {
	  $normalized = ([string]$dbPath) -replace '\\', '/'
	  $rootKind = ''
	  $accountFolder = ''
	  $baseWxid = ''
	  $accountRoot = ''
	  $match = [regex]::Match($normalized, '(?i)(?:^|/)(xwechat_files|WeChat Files)/([^/]+)(?:/|$)')
	  if ($match.Success) {
	    $rootKind = [string]$match.Groups[1].Value
	    $accountFolder = [string]$match.Groups[2].Value
	    $baseWxid = $accountFolder
	    $baseMatch = [regex]::Match($accountFolder, '(?i)^(wxid_[A-Za-z0-9]+)(?:_|$)')
	    if ($baseMatch.Success) { $baseWxid = [string]$baseMatch.Groups[1].Value }
	    $accountRoot = $normalized.Substring(0, $match.Index + $match.Length).TrimEnd('/')
	  }
	  $activeTicks = [int64]0
	  $probes = New-Object System.Collections.Generic.List[string]
	  foreach ($probe in @($dbPath, (Split-Path -Parent $dbPath), $accountRoot)) {
	    if (-not [string]::IsNullOrWhiteSpace($probe)) { $probes.Add($probe) | Out-Null }
	  }
	  if (-not [string]::IsNullOrWhiteSpace($accountRoot)) {
	    foreach ($child in @('db_storage', 'db_storage/contact', 'db_storage/message', 'config', 'msg', 'resource', 'temp')) {
	      $probes.Add((Join-Path $accountRoot $child)) | Out-Null
	    }
	  }
	  foreach ($probe in $probes) {
	    try {
	      if (Test-Path -LiteralPath $probe) {
	        $item = Get-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
	        if ($null -ne $item) {
	          $activeTicks = [Math]::Max($activeTicks, [int64]$item.LastWriteTimeUtc.Ticks)
	          $activeTicks = [Math]::Max($activeTicks, [int64]$item.CreationTimeUtc.Ticks)
	        }
	      }
	    } catch {}
	  }
	  $score = 0
	  if ($rootKind -ieq 'xwechat_files') { $score += 80 }
	  if ($normalized -match '(?i)/db_storage/contact/contact\.db$|/contact\.db$') { $score += 60 }
	  if ($accountFolder -match '(?i)^wxid_') { $score += 40 }
	  if ($normalized -match '(?i)/(msg|db_storage/message|message)/.*(micromsg|msg)\.db$|/(micromsg|msg)\.db$') { $score -= 20 }
	  if ($normalized -match '(?i)/backup(/|$)|/all_users(/|$)' -or $accountFolder -ieq 'all_users') { $score -= 2000 }
	  return [pscustomobject]@{
	    Path = $dbPath
	    Score = $score
	    ActiveTicks = $activeTicks
	    AccountFolder = $accountFolder
	    BaseWxid = $baseWxid
	  }
	}

	function Sort-WeChatContactDbCandidates([string[]]$paths) {
	  $items = @()
	  foreach ($path in $paths) {
	    if ([string]::IsNullOrWhiteSpace($path)) { continue }
	    $items += Get-WeChatDbCandidateInfo $path
	  }
	  return @(
	    $items |
	      Sort-Object @{ Expression = 'ActiveTicks'; Descending = $true }, @{ Expression = 'Score'; Descending = $true } |
	      ForEach-Object { $_.Path }
	  )
	}

	function Find-WeChatContactDbCandidates {
	  Set-Diagnostic 'stage' 'find-contact-db'
	  $paths = New-Object System.Collections.Generic.List[string]
	  Add-UniquePath $paths $env:AI_CONTENT_WECHAT_CONTACT_DB_PATH $true
	  foreach ($root in Get-WeChatDataRoots) {
	    foreach ($path in Find-FilesLimited $root @('contact.db', 'Contact.db', 'MicroMsg.db') 7 40) {
	      Add-UniquePath $paths $path $true
	    }
	  }
	  return @(Sort-WeChatContactDbCandidates @($paths))
	}

	function Get-SqliteCliPath {
	  foreach ($path in @($env:AI_CONTENT_SQLITE_EXE, $env:SQLITE_EXE)) {
	    if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) { return $path }
	  }
	  foreach ($name in @('sqlite3.exe', 'sqlite3')) {
	    try {
	      $cmd = Get-Command $name -ErrorAction SilentlyContinue
	      if ($null -ne $cmd -and -not [string]::IsNullOrWhiteSpace($cmd.Source)) {
	        return $cmd.Source
	      }
	    } catch {}
	  }
	  return ''
	}

	function Invoke-SqliteRows([string]$sqlitePath, [string]$dbPath, [string]$query) {
	  try {
	    $tab = [string][char]9
	    $output = @(& $sqlitePath '-noheader' '-separator' $tab $dbPath $query 2>&1)
	    $code = $LASTEXITCODE
	    return @{ Code = $code; Output = @($output) }
	  } catch {
	    return @{ Code = 1; Output = @($_.Exception.Message) }
	  }
	}

	function Ensure-WeChatDbDecryptor {
	  if ('KaypalWechatDbDecryptor' -as [type]) { return $true }
	  $source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('dXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uQ29sbGVjdGlvbnMuR2VuZXJpYzsKdXNpbmcgU3lzdGVtLkRpYWdub3N0aWNzOwp1c2luZyBTeXN0ZW0uSU87CnVzaW5nIFN5c3RlbS5SdW50aW1lLkludGVyb3BTZXJ2aWNlczsKdXNpbmcgU3lzdGVtLlNlY3VyaXR5LkNyeXB0b2dyYXBoeTsKdXNpbmcgU3lzdGVtLlRleHQ7CgpwdWJsaWMgY2xhc3MgS2F5cGFsV2VjaGF0RGJEZWNyeXB0b3IKewogICAgc3RhdGljIExpc3Q8c3RyaW5nPiBMYXN0U2NhbkRpYWdub3N0aWNzID0gbmV3IExpc3Q8c3RyaW5nPigpOwogICAgc3RhdGljIGxvbmcgU2NhblJlZ2lvbnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhbkJ5dGVzID0gMDsKICAgIHN0YXRpYyBsb25nIFNjYW5TYWx0SGl0cyA9IDA7CiAgICBzdGF0aWMgbG9uZyBTY2FuTGl0ZXJhbENhbmRpZGF0ZXMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgc3RhdGljIGxvbmcgU2NhblJhd0NhbmRpZGF0ZXMgPSAwOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIEdldExhc3REaWFnbm9zdGljcygpCiAgICB7CiAgICAgICAgcmV0dXJuIFN0cmluZy5Kb2luKCIgfCAiLCBMYXN0U2NhbkRpYWdub3N0aWNzLlRvQXJyYXkoKSk7CiAgICB9CgogICAgc3RhdGljIHZvaWQgUmVzZXRQcm9jZXNzU2NhbkNvdW50ZXJzKCkKICAgIHsKICAgICAgICBTY2FuUmVnaW9ucyA9IDA7CiAgICAgICAgU2NhbkJ5dGVzID0gMDsKICAgICAgICBTY2FuU2FsdEhpdHMgPSAwOwogICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyA9IDA7CiAgICAgICAgU2NhblJhd0FuY2hvcnMgPSAwOwogICAgICAgIFNjYW5SYXdDYW5kaWRhdGVzID0gMDsKICAgIH0KCiAgICBzdGF0aWMgdm9pZCBBZGRTY2FuRGlhZ25vc3RpYyhzdHJpbmcgdmFsdWUpCiAgICB7CiAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eSh2YWx1ZSkgJiYgTGFzdFNjYW5EaWFnbm9zdGljcy5Db3VudCA8IDQwKSBMYXN0U2NhbkRpYWdub3N0aWNzLkFkZCh2YWx1ZSk7CiAgICB9CiAgICBjb25zdCBpbnQgUGFnZVNpemUgPSA0MDk2OwogICAgY29uc3QgaW50IFNhbHRTaXplID0gMTY7CiAgICBjb25zdCBpbnQgUmVzZXJ2ZVNpemUgPSA4MDsKICAgIGNvbnN0IGludCBJdlNpemUgPSAxNjsKICAgIGNvbnN0IGludCBIbWFjU2l6ZSA9IDY0OwogICAgY29uc3QgaW50IE1lbUNvbW1pdCA9IDB4MTAwMDsKICAgIGNvbnN0IGludCBDaHVua1NpemUgPSA0ICogMTAyNCAqIDEwMjQ7CiAgICBjb25zdCB1aW50IFByb2Nlc3NBY2Nlc3MgPSAweDAwMTAgfCAweDA0MDAgfCAweDEwMDA7CgogICAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXQogICAgc3RydWN0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24KICAgIHsKICAgICAgICBwdWJsaWMgSW50UHRyIEJhc2VBZGRyZXNzOwogICAgICAgIHB1YmxpYyBJbnRQdHIgQWxsb2NhdGlvbkJhc2U7CiAgICAgICAgcHVibGljIHVpbnQgQWxsb2NhdGlvblByb3RlY3Q7CiAgICAgICAgcHVibGljIEludFB0ciBSZWdpb25TaXplOwogICAgICAgIHB1YmxpYyB1aW50IFN0YXRlOwogICAgICAgIHB1YmxpYyB1aW50IFByb3RlY3Q7CiAgICAgICAgcHVibGljIHVpbnQgVHlwZTsKICAgIH0KCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIE9wZW5Qcm9jZXNzKHVpbnQgZHdEZXNpcmVkQWNjZXNzLCBib29sIGJJbmhlcml0SGFuZGxlLCBpbnQgZHdQcm9jZXNzSWQpOwoKICAgIFtEbGxJbXBvcnQoImtlcm5lbDMyLmRsbCIsIFNldExhc3RFcnJvciA9IHRydWUpXQogICAgc3RhdGljIGV4dGVybiBib29sIENsb3NlSGFuZGxlKEludFB0ciBoT2JqZWN0KTsKCiAgICBbRGxsSW1wb3J0KCJrZXJuZWwzMi5kbGwiLCBTZXRMYXN0RXJyb3IgPSB0cnVlKV0KICAgIHN0YXRpYyBleHRlcm4gSW50UHRyIFZpcnR1YWxRdWVyeUV4KEludFB0ciBoUHJvY2VzcywgSW50UHRyIGxwQWRkcmVzcywgb3V0IE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbHBCdWZmZXIsIEludFB0ciBkd0xlbmd0aCk7CgogICAgW0RsbEltcG9ydCgia2VybmVsMzIuZGxsIiwgU2V0TGFzdEVycm9yID0gdHJ1ZSldCiAgICBzdGF0aWMgZXh0ZXJuIGJvb2wgUmVhZFByb2Nlc3NNZW1vcnkoSW50UHRyIGhQcm9jZXNzLCBJbnRQdHIgbHBCYXNlQWRkcmVzcywgYnl0ZVtdIGxwQnVmZmVyLCBJbnRQdHIgZHdTaXplLCBvdXQgSW50UHRyIGxwTnVtYmVyT2ZCeXRlc1JlYWQpOwoKICAgIHB1YmxpYyBzdGF0aWMgc3RyaW5nIERlY3J5cHRXaXRoTWVtb3J5S2V5KHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoKQogICAgewogICAgICAgIHN0cmluZyBrZXkgPSBGaW5kTWVtb3J5S2V5KGRiUGF0aCk7CiAgICAgICAgaWYgKFN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiAiIjsKICAgICAgICBEZWNyeXB0RGF0YWJhc2UoZGJQYXRoLCBvdXRwdXRQYXRoLCBrZXkpOwogICAgICAgIHJldHVybiBrZXk7CiAgICB9CgogICAgcHVibGljIHN0YXRpYyBzdHJpbmcgRmluZE1lbW9yeUtleShzdHJpbmcgZGJQYXRoKQogICAgewogICAgICAgIExhc3RTY2FuRGlhZ25vc3RpY3MuQ2xlYXIoKTsKICAgICAgICBieXRlW10gcGFnZTEgPSBSZWFkRmlyc3RQYWdlKGRiUGF0aCk7CiAgICAgICAgc3RyaW5nIHNhbHRIZXggPSBUb0hleChwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIExpc3Q8UHJvY2Vzcz4gcHJvY2Vzc2VzID0gbmV3IExpc3Q8UHJvY2Vzcz4oKTsKICAgICAgICBmb3JlYWNoIChzdHJpbmcgbmFtZSBpbiBuZXcgc3RyaW5nW10geyAiV2VpeGluIiwgIldlQ2hhdCIsICJXZUNoYXRBcHBFeCIsICJXZUNoYXRBcHAiLCAiV2VDaGF0QnJvd3NlciIgfSkKICAgICAgICB7CiAgICAgICAgICAgIHRyeSB7IHByb2Nlc3Nlcy5BZGRSYW5nZShQcm9jZXNzLkdldFByb2Nlc3Nlc0J5TmFtZShuYW1lKSk7IH0gY2F0Y2ggeyB9CiAgICAgICAgfQogICAgICAgIEFkZFNjYW5EaWFnbm9zdGljKCJwcm9jZXNzLWNvdW50PSIgKyBwcm9jZXNzZXMuQ291bnQpOwogICAgICAgIHByb2Nlc3Nlcy5Tb3J0KGRlbGVnYXRlKFByb2Nlc3MgYSwgUHJvY2VzcyBiKQogICAgICAgIHsKICAgICAgICAgICAgbG9uZyBidyA9IDA7CiAgICAgICAgICAgIGxvbmcgYXcgPSAwOwogICAgICAgICAgICB0cnkgeyBidyA9IGIuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICB0cnkgeyBhdyA9IGEuV29ya2luZ1NldDY0OyB9IGNhdGNoIHsgfQogICAgICAgICAgICByZXR1cm4gYncuQ29tcGFyZVRvKGF3KTsKICAgICAgICB9KTsKCiAgICAgICAgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCA9IG5ldyBIYXNoU2V0PHN0cmluZz4oU3RyaW5nQ29tcGFyZXIuT3JkaW5hbElnbm9yZUNhc2UpOwogICAgICAgIGZvcmVhY2ggKFByb2Nlc3MgcHJvY2VzcyBpbiBwcm9jZXNzZXMpCiAgICAgICAgewogICAgICAgICAgICBJbnRQdHIgaGFuZGxlID0gSW50UHRyLlplcm87CiAgICAgICAgICAgIHRyeQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBSZXNldFByb2Nlc3NTY2FuQ291bnRlcnMoKTsKICAgICAgICAgICAgICAgIGhhbmRsZSA9IE9wZW5Qcm9jZXNzKFByb2Nlc3NBY2Nlc3MsIGZhbHNlLCBwcm9jZXNzLklkKTsKICAgICAgICAgICAgICAgIGlmIChoYW5kbGUgPT0gSW50UHRyLlplcm8pCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49ZmFpbGVkIik7CiAgICAgICAgICAgICAgICAgICAgY29udGludWU7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBzdHJpbmcga2V5ID0gU2NhblByb2Nlc3NGb3JLZXkoaGFuZGxlLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICAgICAgICAgIHN0cmluZyBzdW1tYXJ5ID0gcHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOm9wZW49b2s6cmVnaW9ucz0iICsgU2NhblJlZ2lvbnMgKyAiOm1iPSIgKyAoU2NhbkJ5dGVzIC8gMTAyNCAvIDEwMjQpICsgIjpzYWx0PSIgKyBTY2FuU2FsdEhpdHMgKyAiOmxpdGVyYWw9IiArIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcyArICI6cmF3QW5jaG9ycz0iICsgU2NhblJhd0FuY2hvcnMgKyAiOnJhdz0iICsgU2NhblJhd0NhbmRpZGF0ZXMgKyAiOmZvdW5kPSIgKyAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkgPyAieWVzIiA6ICJubyIpOwogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMoc3VtbWFyeSk7CiAgICAgICAgICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgY2F0Y2ggKEV4Y2VwdGlvbiBleCkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgQWRkU2NhbkRpYWdub3N0aWMocHJvY2Vzcy5Qcm9jZXNzTmFtZSArICIjIiArIHByb2Nlc3MuSWQgKyAiOmVycm9yPSIgKyBleC5HZXRUeXBlKCkuTmFtZSk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgZmluYWxseQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlICE9IEludFB0ci5aZXJvKSBDbG9zZUhhbmRsZShoYW5kbGUpOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5Qcm9jZXNzRm9yS2V5KEludFB0ciBoYW5kbGUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgbG9uZyBhZGRyZXNzID0gMDsKICAgICAgICBsb25nIG1heEFkZHJlc3MgPSAweDdGRkZGRkZGRkZGRjsKICAgICAgICBpbnQgbWJpU2l6ZSA9IE1hcnNoYWwuU2l6ZU9mKHR5cGVvZihNZW1vcnlCYXNpY0luZm9ybWF0aW9uKSk7CiAgICAgICAgd2hpbGUgKGFkZHJlc3MgPiAtMSAmJiBhZGRyZXNzIDwgbWF4QWRkcmVzcykKICAgICAgICB7CiAgICAgICAgICAgIE1lbW9yeUJhc2ljSW5mb3JtYXRpb24gbWJpOwogICAgICAgICAgICBJbnRQdHIgcXVlcnkgPSBuZXcgSW50UHRyKGFkZHJlc3MpOwogICAgICAgICAgICBJbnRQdHIgcmVzdWx0ID0gVmlydHVhbFF1ZXJ5RXgoaGFuZGxlLCBxdWVyeSwgb3V0IG1iaSwgbmV3IEludFB0cihtYmlTaXplKSk7CiAgICAgICAgICAgIGlmIChyZXN1bHQgPT0gSW50UHRyLlplcm8pIGJyZWFrOwoKICAgICAgICAgICAgbG9uZyBiYXNlQWRkcmVzcyA9IG1iaS5CYXNlQWRkcmVzcy5Ub0ludDY0KCk7CiAgICAgICAgICAgIGxvbmcgcmVnaW9uU2l6ZSA9IG1iaS5SZWdpb25TaXplLlRvSW50NjQoKTsKICAgICAgICAgICAgaWYgKHJlZ2lvblNpemUgPiAwICYmIHJlZ2lvblNpemUgPCA1MDBMICogMTAyNEwgKiAxMDI0TCAmJiBtYmkuU3RhdGUgPT0gTWVtQ29tbWl0ICYmIElzUmVhZGFibGVQcm90ZWN0KG1iaS5Qcm90ZWN0KSkKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgU2NhblJlZ2lvbnMrKzsKICAgICAgICAgICAgICAgIHN0cmluZyBrZXkgPSBTY2FuTWVtb3J5UmVnaW9uKGhhbmRsZSwgYmFzZUFkZHJlc3MsIHJlZ2lvblNpemUsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICB9CgogICAgICAgICAgICBsb25nIG5leHQgPSBiYXNlQWRkcmVzcyArIHJlZ2lvblNpemU7CiAgICAgICAgICAgIGlmIChuZXh0IDw9IGFkZHJlc3MpIGJyZWFrOwogICAgICAgICAgICBhZGRyZXNzID0gbmV4dDsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2Nhbk1lbW9yeVJlZ2lvbihJbnRQdHIgaGFuZGxlLCBsb25nIGJhc2VBZGRyZXNzLCBsb25nIHJlZ2lvblNpemUsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgYnl0ZVtdIHRhaWwgPSBuZXcgYnl0ZVswXTsKICAgICAgICBsb25nIG9mZnNldCA9IDA7CiAgICAgICAgd2hpbGUgKG9mZnNldCA8IHJlZ2lvblNpemUpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZFNpemUgPSAoaW50KU1hdGguTWluKChsb25nKUNodW5rU2l6ZSwgcmVnaW9uU2l6ZSAtIG9mZnNldCk7CiAgICAgICAgICAgIGJ5dGVbXSBidWZmZXIgPSBuZXcgYnl0ZVtyZWFkU2l6ZV07CiAgICAgICAgICAgIEludFB0ciBieXRlc1JlYWQ7CiAgICAgICAgICAgIGJvb2wgb2sgPSBSZWFkUHJvY2Vzc01lbW9yeShoYW5kbGUsIG5ldyBJbnRQdHIoYmFzZUFkZHJlc3MgKyBvZmZzZXQpLCBidWZmZXIsIG5ldyBJbnRQdHIocmVhZFNpemUpLCBvdXQgYnl0ZXNSZWFkKTsKICAgICAgICAgICAgaWYgKG9rICYmIGJ5dGVzUmVhZC5Ub0ludDY0KCkgPiAwKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBpbnQgYWN0dWFsID0gKGludClNYXRoLk1pbigobG9uZylyZWFkU2l6ZSwgYnl0ZXNSZWFkLlRvSW50NjQoKSk7CiAgICAgICAgICAgICAgICBpZiAoYWN0dWFsICE9IGJ1ZmZlci5MZW5ndGgpCiAgICAgICAgICAgICAgICB7CiAgICAgICAgICAgICAgICAgICAgYnl0ZVtdIHNtYWxsZXIgPSBuZXcgYnl0ZVthY3R1YWxdOwogICAgICAgICAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoYnVmZmVyLCAwLCBzbWFsbGVyLCAwLCBhY3R1YWwpOwogICAgICAgICAgICAgICAgICAgIGJ1ZmZlciA9IHNtYWxsZXI7CiAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICBTY2FuQnl0ZXMgKz0gYnVmZmVyLkxlbmd0aDsKICAgICAgICAgICAgICAgIGJ5dGVbXSBkYXRhID0gQ29tYmluZSh0YWlsLCBidWZmZXIpOwogICAgICAgICAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5DYW5kaWRhdGVzKGRhdGEsIHBhZ2UxLCBzYWx0SGV4LCB0ZXN0ZWQpOwogICAgICAgICAgICAgICAgaWYgKCFTdHJpbmcuSXNOdWxsT3JFbXB0eShrZXkpKSByZXR1cm4ga2V5OwogICAgICAgICAgICAgICAgdGFpbCA9IExhc3RCeXRlcyhkYXRhLCAyNTYpOwogICAgICAgICAgICB9CiAgICAgICAgICAgIG9mZnNldCArPSByZWFkU2l6ZTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuICIiOwogICAgfQoKICAgIHN0YXRpYyBzdHJpbmcgU2NhbkNhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgc3RyaW5nIGtleSA9IFNjYW5TcWxDaXBoZXJMaXRlcmFsQ2FuZGlkYXRlcyhkYXRhLCBwYWdlMSwgc2FsdEhleCwgdGVzdGVkKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGtleSkpIHJldHVybiBrZXk7CiAgICAgICAgcmV0dXJuIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoZGF0YSwgcGFnZTEsIHRlc3RlZCk7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBTY2FuU3FsQ2lwaGVyTGl0ZXJhbENhbmRpZGF0ZXMoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgc3RyaW5nIHNhbHRIZXgsIEhhc2hTZXQ8c3RyaW5nPiB0ZXN0ZWQpCiAgICB7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgKyAzIDwgZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGlmICgoZGF0YVtpXSAhPSAoYnl0ZSkneCcgJiYgZGF0YVtpXSAhPSAoYnl0ZSknWCcpIHx8IGRhdGFbaSArIDFdICE9IChieXRlKSdcJycpIGNvbnRpbnVlOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBpICsgMjsKICAgICAgICAgICAgaW50IGogPSBzdGFydDsKICAgICAgICAgICAgd2hpbGUgKGogPCBkYXRhLkxlbmd0aCAmJiBJc0hleEJ5dGUoZGF0YVtqXSkgJiYgaiAtIHN0YXJ0IDw9IDE5MikgaisrOwogICAgICAgICAgICBpbnQgbGVuID0gaiAtIHN0YXJ0OwogICAgICAgICAgICBpZiAoaiA+PSBkYXRhLkxlbmd0aCB8fCBkYXRhW2pdICE9IChieXRlKSdcJycgfHwgbGVuIDwgNjQgfHwgbGVuID4gMTkyIHx8IChsZW4gJSAyKSAhPSAwKSBjb250aW51ZTsKICAgICAgICAgICAgc3RyaW5nIGhleCA9IEVuY29kaW5nLkFTQ0lJLkdldFN0cmluZyhkYXRhLCBzdGFydCwgbGVuKTsKICAgICAgICAgICAgc3RyaW5nIG1hcmtlciA9ICJzcWxjaXBoZXItbGl0ZXJhbDoiICsgaGV4OwogICAgICAgICAgICBpZiAodGVzdGVkLkNvbnRhaW5zKG1hcmtlcikpIGNvbnRpbnVlOwogICAgICAgICAgICB0ZXN0ZWQuQWRkKG1hcmtlcik7CiAgICAgICAgICAgIFNjYW5MaXRlcmFsQ2FuZGlkYXRlcysrOwoKICAgICAgICAgICAgc3RyaW5nIGVuY0tleUhleCA9ICIiOwogICAgICAgICAgICBzdHJpbmcgY2FuZGlkYXRlU2FsdCA9ICIiOwogICAgICAgICAgICBpZiAobGVuID09IDY0KQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBlbmNLZXlIZXggPSBoZXg7CiAgICAgICAgICAgICAgICBjYW5kaWRhdGVTYWx0ID0gc2FsdEhleDsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlIGlmIChsZW4gPT0gOTYpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGVuY0tleUhleCA9IGhleC5TdWJzdHJpbmcoMCwgNjQpOwogICAgICAgICAgICAgICAgY2FuZGlkYXRlU2FsdCA9IGhleC5TdWJzdHJpbmcoNjQsIDMyKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBlbHNlCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGNvbnRpbnVlOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmICghU3RyaW5nLkVxdWFscyhjYW5kaWRhdGVTYWx0LCBzYWx0SGV4LCBTdHJpbmdDb21wYXJpc29uLk9yZGluYWxJZ25vcmVDYXNlKSkgY29udGludWU7CiAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGVuY0tleUhleCk7CiAgICAgICAgICAgIGlmIChWZXJpZnlFbmNLZXkoZW5jS2V5LCBwYWdlMSkpIHJldHVybiBlbmNLZXlIZXg7CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgc3RyaW5nIFNjYW5SYXdDYW5kaWRhdGVzTmVhclNhbHQoYnl0ZVtdIGRhdGEsIGJ5dGVbXSBwYWdlMSwgSGFzaFNldDxzdHJpbmc+IHRlc3RlZCkKICAgIHsKICAgICAgICBieXRlW10gc2FsdCA9IFNsaWNlKHBhZ2UxLCAwLCBTYWx0U2l6ZSk7CiAgICAgICAgaW50IGFuY2hvcnMgPSAwOwogICAgICAgIGZvciAoaW50IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCAwKTsgYW5jaG9yID49IDA7IGFuY2hvciA9IEluZGV4T2ZCeXRlcyhkYXRhLCBzYWx0LCBhbmNob3IgKyAxKSkKICAgICAgICB7CiAgICAgICAgICAgIGFuY2hvcnMrKzsKICAgICAgICAgICAgU2NhblNhbHRIaXRzKys7CiAgICAgICAgICAgIFNjYW5SYXdBbmNob3JzKys7CiAgICAgICAgICAgIGlmIChhbmNob3JzID4gNjQpIGJyZWFrOwogICAgICAgICAgICBpbnQgc3RhcnQgPSBNYXRoLk1heCgwLCBhbmNob3IgLSA0MDk2KTsKICAgICAgICAgICAgaW50IGVuZCA9IE1hdGguTWluKGRhdGEuTGVuZ3RoIC0gMzIsIGFuY2hvciArIDQwOTYpOwogICAgICAgICAgICBpbnQgcHJvYmVzID0gMDsKICAgICAgICAgICAgZm9yIChpbnQgaSA9IHN0YXJ0OyBpIDw9IGVuZDsgaSsrKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBwcm9iZXMrKzsKICAgICAgICAgICAgICAgIGlmIChwcm9iZXMgPiAxMjAwMCkgYnJlYWs7CiAgICAgICAgICAgICAgICBpZiAoIUxvb2tzTGlrZVJhd0tleShkYXRhLCBpKSkgY29udGludWU7CiAgICAgICAgICAgICAgICBTY2FuUmF3Q2FuZGlkYXRlcysrOwogICAgICAgICAgICAgICAgc3RyaW5nIGhleCA9IFRvSGV4KGRhdGEsIGksIDMyKTsKICAgICAgICAgICAgICAgIHN0cmluZyBtYXJrZXIgPSAicmF3LW5lYXItc2FsdDoiICsgaGV4OwogICAgICAgICAgICAgICAgaWYgKHRlc3RlZC5Db250YWlucyhtYXJrZXIpKSBjb250aW51ZTsKICAgICAgICAgICAgICAgIHRlc3RlZC5BZGQobWFya2VyKTsKICAgICAgICAgICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBTbGljZShkYXRhLCBpLCAzMik7CiAgICAgICAgICAgICAgICBpZiAoVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSByZXR1cm4gaGV4OwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHJldHVybiAiIjsKICAgIH0KCiAgICBzdGF0aWMgaW50IEluZGV4T2ZCeXRlcyhieXRlW10gZGF0YSwgYnl0ZVtdIG5lZWRsZSwgaW50IHN0YXJ0KQogICAgewogICAgICAgIGlmIChkYXRhID09IG51bGwgfHwgbmVlZGxlID09IG51bGwgfHwgbmVlZGxlLkxlbmd0aCA9PSAwKSByZXR1cm4gLTE7CiAgICAgICAgZm9yIChpbnQgaSA9IE1hdGguTWF4KDAsIHN0YXJ0KTsgaSArIG5lZWRsZS5MZW5ndGggPD0gZGF0YS5MZW5ndGg7IGkrKykKICAgICAgICB7CiAgICAgICAgICAgIGludCBqID0gMDsKICAgICAgICAgICAgZm9yICg7IGogPCBuZWVkbGUuTGVuZ3RoOyBqKyspCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGlmIChkYXRhW2kgKyBqXSAhPSBuZWVkbGVbal0pIGJyZWFrOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChqID09IG5lZWRsZS5MZW5ndGgpIHJldHVybiBpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gLTE7CiAgICB9CgogICAgc3RhdGljIGJvb2wgTG9va3NMaWtlUmF3S2V5KGJ5dGVbXSBkYXRhLCBpbnQgc3RhcnQpCiAgICB7CiAgICAgICAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCArIDMyID4gZGF0YS5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBib29sW10gc2VlbiA9IG5ldyBib29sWzI1Nl07CiAgICAgICAgaW50IHVuaXF1ZSA9IDA7CiAgICAgICAgaW50IHplcm9zID0gMDsKICAgICAgICBpbnQgcHJpbnRhYmxlID0gMDsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IDMyOyBpKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlIHZhbHVlID0gZGF0YVtzdGFydCArIGldOwogICAgICAgICAgICBpZiAodmFsdWUgPT0gMCkgemVyb3MrKzsKICAgICAgICAgICAgaWYgKHZhbHVlID49IDB4MjAgJiYgdmFsdWUgPD0gMHg3ZSkgcHJpbnRhYmxlKys7CiAgICAgICAgICAgIGlmICghc2Vlblt2YWx1ZV0pCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHNlZW5bdmFsdWVdID0gdHJ1ZTsKICAgICAgICAgICAgICAgIHVuaXF1ZSsrOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmICh6ZXJvcyA+IDQpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAodW5pcXVlIDwgMTgpIHJldHVybiBmYWxzZTsKICAgICAgICBpZiAocHJpbnRhYmxlID49IDMwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgcmV0dXJuIHRydWU7CiAgICB9CgogICAgc3RhdGljIGJvb2wgSXNSZWFkYWJsZVByb3RlY3QodWludCBwcm90ZWN0KQogICAgewogICAgICAgIGlmICgocHJvdGVjdCAmIDB4MTAwKSAhPSAwKSByZXR1cm4gZmFsc2U7CiAgICAgICAgdWludCBwID0gcHJvdGVjdCAmIDB4ZmY7CiAgICAgICAgcmV0dXJuIHAgPT0gMHgwMiB8fCBwID09IDB4MDQgfHwgcCA9PSAweDA4IHx8IHAgPT0gMHgxMCB8fCBwID09IDB4MjAgfHwgcCA9PSAweDQwIHx8IHAgPT0gMHg4MDsKICAgIH0KCiAgICBzdGF0aWMgYm9vbCBJc0hleEJ5dGUoYnl0ZSB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKHZhbHVlID49IChieXRlKScwJyAmJiB2YWx1ZSA8PSAoYnl0ZSknOScpIHx8CiAgICAgICAgICAgICAgICh2YWx1ZSA+PSAoYnl0ZSknYScgJiYgdmFsdWUgPD0gKGJ5dGUpJ2YnKSB8fAogICAgICAgICAgICAgICAodmFsdWUgPj0gKGJ5dGUpJ0EnICYmIHZhbHVlIDw9IChieXRlKSdGJyk7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBSZWFkRmlyc3RQYWdlKHN0cmluZyBkYlBhdGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIHBhZ2UgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgdXNpbmcgKEZpbGVTdHJlYW0gZnMgPSBGaWxlLk9wZW5SZWFkKGRiUGF0aCkpCiAgICAgICAgewogICAgICAgICAgICBpbnQgcmVhZCA9IGZzLlJlYWQocGFnZSwgMCwgcGFnZS5MZW5ndGgpOwogICAgICAgICAgICBpZiAocmVhZCA8IFBhZ2VTaXplKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiY29udGFjdC5kYiBpcyBzbWFsbGVyIHRoYW4gb25lIFNRTENpcGhlciBwYWdlIik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBwYWdlOwogICAgfQoKICAgIHN0YXRpYyBib29sIFZlcmlmeUVuY0tleShieXRlW10gZW5jS2V5LCBieXRlW10gcGFnZTEpCiAgICB7CiAgICAgICAgYnl0ZVtdIHNhbHQgPSBTbGljZShwYWdlMSwgMCwgU2FsdFNpemUpOwogICAgICAgIGJ5dGVbXSBtYWNTYWx0ID0gbmV3IGJ5dGVbc2FsdC5MZW5ndGhdOwogICAgICAgIGZvciAoaW50IGkgPSAwOyBpIDwgc2FsdC5MZW5ndGg7IGkrKykgbWFjU2FsdFtpXSA9IChieXRlKShzYWx0W2ldIF4gMHgzYSk7CiAgICAgICAgYnl0ZVtdIG1hY0tleSA9IFBia2RmMlNoYTUxMihlbmNLZXksIG1hY1NhbHQsIDIsIDMyKTsKICAgICAgICBieXRlW10gaG1hY0RhdGEgPSBTbGljZShwYWdlMSwgU2FsdFNpemUsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgKyBJdlNpemUgLSBTYWx0U2l6ZSk7CiAgICAgICAgYnl0ZVtdIGV4cGVjdGVkID0gU2xpY2UocGFnZTEsIFBhZ2VTaXplIC0gSG1hY1NpemUsIEhtYWNTaXplKTsKICAgICAgICBieXRlW10gcGFnZU5vID0gbmV3IGJ5dGVbXSB7IDEsIDAsIDAsIDAgfTsKICAgICAgICB1c2luZyAoSE1BQ1NIQTUxMiBobWFjID0gbmV3IEhNQUNTSEE1MTIobWFjS2V5KSkKICAgICAgICB7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtQmxvY2soaG1hY0RhdGEsIDAsIGhtYWNEYXRhLkxlbmd0aCwgbnVsbCwgMCk7CiAgICAgICAgICAgIGhtYWMuVHJhbnNmb3JtRmluYWxCbG9jayhwYWdlTm8sIDAsIHBhZ2VOby5MZW5ndGgpOwogICAgICAgICAgICByZXR1cm4gRml4ZWRUaW1lRXF1YWxzKGhtYWMuSGFzaCwgZXhwZWN0ZWQpOwogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIFBia2RmMlNoYTUxMihieXRlW10gcGFzc3dvcmQsIGJ5dGVbXSBzYWx0LCBpbnQgaXRlcmF0aW9ucywgaW50IGRrTGVuKQogICAgewogICAgICAgIGludCBoYXNoTGVuID0gNjQ7CiAgICAgICAgaW50IGJsb2NrcyA9IChpbnQpTWF0aC5DZWlsaW5nKChkb3VibGUpZGtMZW4gLyBoYXNoTGVuKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbYmxvY2tzICogaGFzaExlbl07CiAgICAgICAgaW50IG9mZnNldCA9IDA7CiAgICAgICAgZm9yIChpbnQgYmxvY2sgPSAxOyBibG9jayA8PSBibG9ja3M7IGJsb2NrKyspCiAgICAgICAgewogICAgICAgICAgICBieXRlW10gaW50QmxvY2sgPSBuZXcgYnl0ZVtdIHsKICAgICAgICAgICAgICAgIChieXRlKSgoYmxvY2sgPj4gMjQpICYgMHhmZiksCiAgICAgICAgICAgICAgICAoYnl0ZSkoKGJsb2NrID4+IDE2KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKChibG9jayA+PiA4KSAmIDB4ZmYpLAogICAgICAgICAgICAgICAgKGJ5dGUpKGJsb2NrICYgMHhmZikKICAgICAgICAgICAgfTsKICAgICAgICAgICAgYnl0ZVtdIHU7CiAgICAgICAgICAgIHVzaW5nIChITUFDU0hBNTEyIGhtYWMgPSBuZXcgSE1BQ1NIQTUxMihwYXNzd29yZCkpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIHUgPSBobWFjLkNvbXB1dGVIYXNoKENvbWJpbmUoc2FsdCwgaW50QmxvY2spKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBieXRlW10gdCA9IChieXRlW10pdS5DbG9uZSgpOwogICAgICAgICAgICBmb3IgKGludCBpID0gMTsgaSA8IGl0ZXJhdGlvbnM7IGkrKykKICAgICAgICAgICAgewogICAgICAgICAgICAgICAgdXNpbmcgKEhNQUNTSEE1MTIgaG1hYyA9IG5ldyBITUFDU0hBNTEyKHBhc3N3b3JkKSkKICAgICAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgICAgICB1ID0gaG1hYy5Db21wdXRlSGFzaCh1KTsKICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgIGZvciAoaW50IGogPSAwOyBqIDwgaGFzaExlbjsgaisrKSB0W2pdIF49IHVbal07CiAgICAgICAgICAgIH0KICAgICAgICAgICAgQnVmZmVyLkJsb2NrQ29weSh0LCAwLCBvdXRwdXQsIG9mZnNldCwgaGFzaExlbik7CiAgICAgICAgICAgIG9mZnNldCArPSBoYXNoTGVuOwogICAgICAgIH0KICAgICAgICByZXR1cm4gU2xpY2Uob3V0cHV0LCAwLCBka0xlbik7CiAgICB9CgogICAgc3RhdGljIHZvaWQgRGVjcnlwdERhdGFiYXNlKHN0cmluZyBkYlBhdGgsIHN0cmluZyBvdXRwdXRQYXRoLCBzdHJpbmcga2V5SGV4KQogICAgewogICAgICAgIGJ5dGVbXSBlbmNLZXkgPSBIZXhUb0J5dGVzKGtleUhleCk7CiAgICAgICAgYnl0ZVtdIHBhZ2UxID0gUmVhZEZpcnN0UGFnZShkYlBhdGgpOwogICAgICAgIGlmICghVmVyaWZ5RW5jS2V5KGVuY0tleSwgcGFnZTEpKSB0aHJvdyBuZXcgSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvbigiSE1BQyB2ZXJpZmljYXRpb24gZmFpbGVkIik7CiAgICAgICAgc3RyaW5nIGRpcmVjdG9yeSA9IFBhdGguR2V0RGlyZWN0b3J5TmFtZShvdXRwdXRQYXRoKTsKICAgICAgICBpZiAoIVN0cmluZy5Jc051bGxPckVtcHR5KGRpcmVjdG9yeSkpIERpcmVjdG9yeS5DcmVhdGVEaXJlY3RvcnkoZGlyZWN0b3J5KTsKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBpbnB1dCA9IEZpbGUuT3BlblJlYWQoZGJQYXRoKSkKICAgICAgICB1c2luZyAoRmlsZVN0cmVhbSBvdXRwdXQgPSBGaWxlLkNyZWF0ZShvdXRwdXRQYXRoKSkKICAgICAgICB7CiAgICAgICAgICAgIGludCBwYWdlTm8gPSAxOwogICAgICAgICAgICBieXRlW10gcGFnZSA9IG5ldyBieXRlW1BhZ2VTaXplXTsKICAgICAgICAgICAgd2hpbGUgKHRydWUpCiAgICAgICAgICAgIHsKICAgICAgICAgICAgICAgIGludCByZWFkID0gUmVhZEZ1bGxQYWdlKGlucHV0LCBwYWdlKTsKICAgICAgICAgICAgICAgIGlmIChyZWFkID09IDApIGJyZWFrOwogICAgICAgICAgICAgICAgaWYgKHJlYWQgPCBQYWdlU2l6ZSkgYnJlYWs7CiAgICAgICAgICAgICAgICBieXRlW10gcGxhaW4gPSBEZWNyeXB0UGFnZShlbmNLZXksIHBhZ2UsIHBhZ2VObyk7CiAgICAgICAgICAgICAgICBvdXRwdXQuV3JpdGUocGxhaW4sIDAsIHBsYWluLkxlbmd0aCk7CiAgICAgICAgICAgICAgICBwYWdlTm8rKzsKICAgICAgICAgICAgICAgIEFycmF5LkNsZWFyKHBhZ2UsIDAsIHBhZ2UuTGVuZ3RoKTsKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0KCiAgICBzdGF0aWMgaW50IFJlYWRGdWxsUGFnZShGaWxlU3RyZWFtIGlucHV0LCBieXRlW10gcGFnZSkKICAgIHsKICAgICAgICBpbnQgdG90YWwgPSAwOwogICAgICAgIHdoaWxlICh0b3RhbCA8IHBhZ2UuTGVuZ3RoKQogICAgICAgIHsKICAgICAgICAgICAgaW50IHJlYWQgPSBpbnB1dC5SZWFkKHBhZ2UsIHRvdGFsLCBwYWdlLkxlbmd0aCAtIHRvdGFsKTsKICAgICAgICAgICAgaWYgKHJlYWQgPT0gMCkgYnJlYWs7CiAgICAgICAgICAgIHRvdGFsICs9IHJlYWQ7CiAgICAgICAgfQogICAgICAgIHJldHVybiB0b3RhbDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIERlY3J5cHRQYWdlKGJ5dGVbXSBrZXksIGJ5dGVbXSBwYWdlLCBpbnQgcGFnZU5vKQogICAgewogICAgICAgIGJ5dGVbXSBpdiA9IFNsaWNlKHBhZ2UsIFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUsIEl2U2l6ZSk7CiAgICAgICAgaW50IHN0YXJ0ID0gcGFnZU5vID09IDEgPyBTYWx0U2l6ZSA6IDA7CiAgICAgICAgaW50IGxlbmd0aCA9IFBhZ2VTaXplIC0gUmVzZXJ2ZVNpemUgLSBzdGFydDsKICAgICAgICBieXRlW10gY2lwaGVyVGV4dCA9IFNsaWNlKHBhZ2UsIHN0YXJ0LCBsZW5ndGgpOwogICAgICAgIGJ5dGVbXSBkZWNyeXB0ZWQ7CiAgICAgICAgdXNpbmcgKEFlc0NyeXB0b1NlcnZpY2VQcm92aWRlciBhZXMgPSBuZXcgQWVzQ3J5cHRvU2VydmljZVByb3ZpZGVyKCkpCiAgICAgICAgewogICAgICAgICAgICBhZXMuS2V5U2l6ZSA9IDI1NjsKICAgICAgICAgICAgYWVzLkJsb2NrU2l6ZSA9IDEyODsKICAgICAgICAgICAgYWVzLk1vZGUgPSBDaXBoZXJNb2RlLkNCQzsKICAgICAgICAgICAgYWVzLlBhZGRpbmcgPSBQYWRkaW5nTW9kZS5Ob25lOwogICAgICAgICAgICBhZXMuS2V5ID0ga2V5OwogICAgICAgICAgICBhZXMuSVYgPSBpdjsKICAgICAgICAgICAgdXNpbmcgKElDcnlwdG9UcmFuc2Zvcm0gdHJhbnNmb3JtID0gYWVzLkNyZWF0ZURlY3J5cHRvcigpKQogICAgICAgICAgICB7CiAgICAgICAgICAgICAgICBkZWNyeXB0ZWQgPSB0cmFuc2Zvcm0uVHJhbnNmb3JtRmluYWxCbG9jayhjaXBoZXJUZXh0LCAwLCBjaXBoZXJUZXh0Lkxlbmd0aCk7CiAgICAgICAgICAgIH0KICAgICAgICB9CiAgICAgICAgYnl0ZVtdIHBhZ2VPdXQgPSBuZXcgYnl0ZVtQYWdlU2l6ZV07CiAgICAgICAgaWYgKHBhZ2VObyA9PSAxKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZVtdIGhlYWRlciA9IEVuY29kaW5nLkFTQ0lJLkdldEJ5dGVzKCJTUUxpdGUgZm9ybWF0IDNcMCIpOwogICAgICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGhlYWRlciwgMCwgcGFnZU91dCwgMCwgaGVhZGVyLkxlbmd0aCk7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCBTYWx0U2l6ZSwgZGVjcnlwdGVkLkxlbmd0aCk7CiAgICAgICAgfQogICAgICAgIGVsc2UKICAgICAgICB7CiAgICAgICAgICAgIEJ1ZmZlci5CbG9ja0NvcHkoZGVjcnlwdGVkLCAwLCBwYWdlT3V0LCAwLCBkZWNyeXB0ZWQuTGVuZ3RoKTsKICAgICAgICB9CiAgICAgICAgcmV0dXJuIHBhZ2VPdXQ7CiAgICB9CgogICAgc3RhdGljIGJ5dGVbXSBDb21iaW5lKGJ5dGVbXSBsZWZ0LCBieXRlW10gcmlnaHQpCiAgICB7CiAgICAgICAgaWYgKGxlZnQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCA9PSAwKSByZXR1cm4gcmlnaHQ7CiAgICAgICAgaWYgKHJpZ2h0ID09IG51bGwgfHwgcmlnaHQuTGVuZ3RoID09IDApIHJldHVybiBsZWZ0OwogICAgICAgIGJ5dGVbXSBjb21iaW5lZCA9IG5ldyBieXRlW2xlZnQuTGVuZ3RoICsgcmlnaHQuTGVuZ3RoXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGxlZnQsIDAsIGNvbWJpbmVkLCAwLCBsZWZ0Lkxlbmd0aCk7CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShyaWdodCwgMCwgY29tYmluZWQsIGxlZnQuTGVuZ3RoLCByaWdodC5MZW5ndGgpOwogICAgICAgIHJldHVybiBjb21iaW5lZDsKICAgIH0KCiAgICBzdGF0aWMgYnl0ZVtdIExhc3RCeXRlcyhieXRlW10gaW5wdXQsIGludCBjb3VudCkKICAgIHsKICAgICAgICBpZiAoaW5wdXQgPT0gbnVsbCB8fCBpbnB1dC5MZW5ndGggPT0gMCkgcmV0dXJuIG5ldyBieXRlWzBdOwogICAgICAgIGludCBsZW4gPSBNYXRoLk1pbihjb3VudCwgaW5wdXQuTGVuZ3RoKTsKICAgICAgICBieXRlW10gb3V0cHV0ID0gbmV3IGJ5dGVbbGVuXTsKICAgICAgICBCdWZmZXIuQmxvY2tDb3B5KGlucHV0LCBpbnB1dC5MZW5ndGggLSBsZW4sIG91dHB1dCwgMCwgbGVuKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gU2xpY2UoYnl0ZVtdIGlucHV0LCBpbnQgc3RhcnQsIGludCBsZW5ndGgpCiAgICB7CiAgICAgICAgYnl0ZVtdIG91dHB1dCA9IG5ldyBieXRlW2xlbmd0aF07CiAgICAgICAgQnVmZmVyLkJsb2NrQ29weShpbnB1dCwgc3RhcnQsIG91dHB1dCwgMCwgbGVuZ3RoKTsKICAgICAgICByZXR1cm4gb3V0cHV0OwogICAgfQoKICAgIHN0YXRpYyBib29sIEZpeGVkVGltZUVxdWFscyhieXRlW10gbGVmdCwgYnl0ZVtdIHJpZ2h0KQogICAgewogICAgICAgIGlmIChsZWZ0ID09IG51bGwgfHwgcmlnaHQgPT0gbnVsbCB8fCBsZWZ0Lkxlbmd0aCAhPSByaWdodC5MZW5ndGgpIHJldHVybiBmYWxzZTsKICAgICAgICBpbnQgZGlmZiA9IDA7CiAgICAgICAgZm9yIChpbnQgaSA9IDA7IGkgPCBsZWZ0Lkxlbmd0aDsgaSsrKSBkaWZmIHw9IGxlZnRbaV0gXiByaWdodFtpXTsKICAgICAgICByZXR1cm4gZGlmZiA9PSAwOwogICAgfQoKICAgIHN0YXRpYyBieXRlW10gSGV4VG9CeXRlcyhzdHJpbmcgaGV4KQogICAgewogICAgICAgIGJ5dGVbXSBieXRlcyA9IG5ldyBieXRlW2hleC5MZW5ndGggLyAyXTsKICAgICAgICBmb3IgKGludCBpID0gMDsgaSA8IGJ5dGVzLkxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZXNbaV0gPSBDb252ZXJ0LlRvQnl0ZShoZXguU3Vic3RyaW5nKGkgKiAyLCAyKSwgMTYpOwogICAgICAgIH0KICAgICAgICByZXR1cm4gYnl0ZXM7CiAgICB9CgogICAgc3RhdGljIHN0cmluZyBUb0hleChieXRlW10gYnl0ZXMsIGludCBzdGFydCwgaW50IGxlbmd0aCkKICAgIHsKICAgICAgICBjaGFyW10gYyA9IG5ldyBjaGFyW2xlbmd0aCAqIDJdOwogICAgICAgIGludCBiID0gMDsKICAgICAgICBmb3IgKGludCBpID0gc3RhcnQ7IGkgPCBzdGFydCArIGxlbmd0aDsgaSsrKQogICAgICAgIHsKICAgICAgICAgICAgYnl0ZSB2ID0gYnl0ZXNbaV07CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgLyAxNik7CiAgICAgICAgICAgIGNbYisrXSA9IEdldEhleFZhbHVlKHYgJSAxNik7CiAgICAgICAgfQogICAgICAgIHJldHVybiBuZXcgc3RyaW5nKGMpOwogICAgfQoKICAgIHN0YXRpYyBjaGFyIEdldEhleFZhbHVlKGludCB2YWx1ZSkKICAgIHsKICAgICAgICByZXR1cm4gKGNoYXIpKHZhbHVlIDwgMTAgPyB2YWx1ZSArICcwJyA6IHZhbHVlIC0gMTAgKyAnYScpOwogICAgfQp9'))
	  try {
	    Add-Type -TypeDefinition $source -Language CSharp
	    return $true
	  } catch {
	    Set-Diagnostic 'dbError' $_.Exception.Message
	    Add-DiagnosticWarning "微信数据库解密器初始化失败：$($_.Exception.Message)"
	    return $false
	  }
	}

	function Test-SqlitePlainDatabase([string]$dbPath) {
	  try {
	    if ([string]::IsNullOrWhiteSpace($dbPath) -or -not (Test-Path -LiteralPath $dbPath)) { return $false }
	    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
	    $stream = [System.IO.File]::Open($dbPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
	    try {
	      $bytes = New-Object byte[] 16
	      $read = $stream.Read($bytes, 0, 16)
	    } finally {
	      $stream.Dispose()
	    }
	    if ($bytes.Length -lt 16) { return $false }
	    if ($read -lt 16) { return $false }
	    $expected = [System.Text.Encoding]::ASCII.GetBytes('SQLite format 3')
	    for ($i = 0; $i -lt $expected.Length; $i++) {
	      if ($bytes[$i] -ne $expected[$i]) { return $false }
	    }
	    return $bytes[15] -eq 0
	  } catch {
	    return $false
	  }
	}

	function Copy-WeChatDbSharedRead([string]$dbPath) {
	  if ([string]::IsNullOrWhiteSpace($dbPath) -or -not (Test-Path -LiteralPath $dbPath)) { return $dbPath }
	  $target = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-content-wechat-contact-shared-" + [guid]::NewGuid().ToString('N') + [System.IO.Path]::GetExtension($dbPath))
	  try {
	    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
	    $input = [System.IO.File]::Open($dbPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
	    try {
	      $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
	      try {
	        $input.CopyTo($output)
	      } finally {
	        $output.Dispose()
	      }
	    } finally {
	      $input.Dispose()
	    }
	    Add-DiagnosticListItem 'dbSharedReadSnapshotPaths' $target 20
	    return $target
	  } catch {
	    Add-DiagnosticWarning "微信 contact.db 共享读取快照失败：$($_.Exception.Message)"
	    return $dbPath
	  }
	}

	function Get-StableTempDbPath([string]$dbPath) {
	  $sha1 = [System.Security.Cryptography.SHA1]::Create()
	  try {
	    $raw = [System.Text.Encoding]::UTF8.GetBytes($dbPath)
	    $hash = -join ($sha1.ComputeHash($raw) | ForEach-Object { $_.ToString('x2') })
	    $root = Join-Path ([System.IO.Path]::GetTempPath()) 'ai-content-wechat-contact-db'
	    if (-not (Test-Path -LiteralPath $root)) {
	      New-Item -ItemType Directory -Force -Path $root | Out-Null
	    }
	    return (Join-Path $root ("contact-$hash.db"))
	  } finally {
	    $sha1.Dispose()
	  }
	}

	function Try-DecryptWeChatContactDbs([string[]]$dbPaths) {
	  $paths = New-Object System.Collections.Generic.List[string]
	  foreach ($dbPath in $dbPaths) {
	    if (Test-SqlitePlainDatabase $dbPath) {
	      Add-UniquePath $paths $dbPath $true
	    }
	  }
	  if (-not (Ensure-WeChatDbDecryptor)) { return @($paths) }
	  foreach ($dbPath in $dbPaths) {
	    if (Test-SqlitePlainDatabase $dbPath) { continue }
	    $decryptInputPath = $dbPath
	    try {
	      $decryptInputPath = Copy-WeChatDbSharedRead $dbPath
	      $outPath = Get-StableTempDbPath $dbPath
	      $key = [KaypalWechatDbDecryptor]::DecryptWithMemoryKey($decryptInputPath, $outPath)
	      if (-not [string]::IsNullOrWhiteSpace($key) -and (Test-SqlitePlainDatabase $outPath)) {
	        try {
	          $outFull = [System.IO.Path]::GetFullPath($outPath)
	          $script:KaypalDecryptedDbSourceMap[$outFull] = $dbPath
	        } catch {}
	        Add-UniquePath $paths $outPath $true
	      }
	    } catch {
	      Set-Diagnostic 'dbError' $_.Exception.Message
	      Add-DiagnosticWarning "微信加密 contact.db 解密失败：$($_.Exception.Message)"
	    } finally {
	      if ($decryptInputPath -ne $dbPath -and (Test-Path -LiteralPath $decryptInputPath)) {
	        Remove-Item -LiteralPath $decryptInputPath -Force -ErrorAction SilentlyContinue
	      }
	    }
	  }
	  return @($paths)
	}

	function Resolve-OriginalWeChatDbPath([string]$dbPath) {
	  try {
	    $full = [System.IO.Path]::GetFullPath($dbPath)
	    if ($script:KaypalDecryptedDbSourceMap.ContainsKey($full)) {
	      return [string]$script:KaypalDecryptedDbSourceMap[$full]
	    }
	  } catch {}
	  return $dbPath
	}

	function Convert-ContactListToArray($items) {
	  $result = @()
	  if ($null -eq $items) { return @() }
	  foreach ($item in $items) {
	    if ($null -ne $item) {
	      $result += $item
	    }
	  }
	  return @($result)
	}

	function New-ContactBatch($items, [string]$source = '', [string]$errorText = '') {
	  return @{
	    Items = @(Convert-ContactListToArray $items)
	    Source = $source
	    Error = $errorText
	  }
	}

	function Try-CollectContactsBySqliteCli([string[]]$dbPaths, [string]$syncMode) {
	  $sqlitePath = Get-SqliteCliPath
	  $items = New-Object System.Collections.Generic.List[object]
	  if ([string]::IsNullOrWhiteSpace($sqlitePath)) {
	    Add-DiagnosticWarning '未找到 sqlite3 命令，已跳过明文 contact.db 读取。'
	    return (New-ContactBatch $items '' 'sqlite3 not found')
	  }
	  Set-Diagnostic 'sqlitePath' $sqlitePath
	  $limit = if ($syncMode -eq 'all') { 50000 } else { 300 }
	  $order = if ($syncMode -eq 'all') { '' } else { ' ORDER BY RANDOM()' }
	  $systemContactIds = "'fmessage','qmessage','tmessage','weixin','filehelper','newsapp','qqmail','floatbottle','lbsapp','medianote','qqsync','weibo','masssendapp','feedsapp','voip','officialaccounts','notification_messages','notifymessage','mphelper'"
	  $queries = @(
	    "SELECT replace(replace(replace(COALESCE(user_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM user_info WHERE user_name IS NOT NULL AND user_name NOT LIKE '%@chatroom' AND user_name NOT LIKE 'gh_%'$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nickname, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0 AND COALESCE(local_type, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(UserName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(NickName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN ($systemContactIds) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0 AND COALESCE(LocalType, 1) = 1$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nick_name, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(username, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(nickname, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE username IS NOT NULL AND username NOT LIKE '%@chatroom' AND username NOT LIKE 'gh_%' AND lower(username) NOT IN ($systemContactIds) AND COALESCE(delete_flag, 0) = 0 AND (COALESCE(flag, 0) & 1) != 0 AND COALESCE(verify_flag, 0) = 0$order LIMIT $limit;",
	    "SELECT replace(replace(replace(COALESCE(UserName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(NickName, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Remark, ''), char(13), ' '), char(10), ' '), char(9), ' '), replace(replace(replace(COALESCE(Alias, ''), char(13), ' '), char(10), ' '), char(9), ' ') FROM Contact WHERE UserName IS NOT NULL AND UserName NOT LIKE '%@chatroom' AND UserName NOT LIKE 'gh_%' AND lower(UserName) NOT IN ($systemContactIds) AND COALESCE(DeleteFlag, 0) = 0 AND (COALESCE(Flag, 0) & 1) != 0 AND COALESCE(VerifyFlag, 0) = 0$order LIMIT $limit;"
	  )
	  foreach ($dbPath in $dbPaths) {
	    $originDbPath = Resolve-OriginalWeChatDbPath $dbPath
	    $candidateInfo = Get-WeChatDbCandidateInfo $originDbPath
	    foreach ($query in $queries) {
	      $result = Invoke-SqliteRows $sqlitePath $dbPath $query
	      if ([int]$result.Code -ne 0) {
	        $errorText = (($result.Output | Select-Object -First 2) -join ' ')
	        if (-not [string]::IsNullOrWhiteSpace($errorText)) {
	          Set-Diagnostic 'dbError' $errorText
	        }
	        continue
	      }
	      foreach ($line in $result.Output) {
	        $text = [string]$line
	        if ([string]::IsNullOrWhiteSpace($text)) { continue }
	        $parts = @($text -split ([string][char]9), 4)
	        Add-DbContactItem $items $parts[0] $parts[1] $parts[2] $parts[3]
	      }
	      if ($items.Count -gt 0) {
	        Set-Diagnostic 'dbContactCount' ([int]$items.Count)
	        Set-Diagnostic 'selectedDbPath' $originDbPath
	        Set-Diagnostic 'selectedDbAccountFolder' ([string]$candidateInfo.AccountFolder)
	        Set-Diagnostic 'selectedDbBaseWxid' ([string]$candidateInfo.BaseWxid)
	        Set-Diagnostic 'selectedDbActiveMtime' ([string]$candidateInfo.ActiveTicks)
	        Set-Diagnostic 'selectedDbScore' ([int]$candidateInfo.Score)
	        return (New-ContactBatch $items)
	      }
	    }
	  }
	  return (New-ContactBatch $items '' ([string]$script:KaypalContactSyncDiagnostics['dbError']))
	}

	function Find-JsonPayloadLine([string]$text) {
	  if ([string]::IsNullOrWhiteSpace($text)) { return '' }
	  $lines = @($text -split '\r?\n')
	  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
	    $line = ([string]$lines[$i]).Trim()
	    if ($line.StartsWith('{') -and $line.EndsWith('}')) { return $line }
	  }
	  return ''
	}

	function Find-ContactDbPathsFromHelperOutput([string]$text) {
	  $paths = New-Object System.Collections.Generic.List[string]
	  if ([string]::IsNullOrWhiteSpace($text)) { return @($paths) }
	  $matches = [regex]::Matches($text, '[A-Za-z]:\\[^\r\n"''<>|]+')
	  foreach ($match in $matches) {
	    $candidate = ([string]$match.Value).Trim()
	    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
	    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
	      if ($candidate -match '(?i)(contact|micromsg).*\.db$') {
	        Add-UniquePath $paths $candidate $true
	      }
	      continue
	    }
	    if (Test-Path -LiteralPath $candidate -PathType Container) {
	      foreach ($path in Find-FilesLimited $candidate @('contact.db', 'Contact.db', 'MicroMsg.db') 6 40) {
	        Add-UniquePath $paths $path $true
	      }
	    }
	  }
	  return @($paths)
	}

	function Try-CollectContactsByDbHelper([string]$syncMode) {
	  $helper = [string]$env:AI_CONTENT_WECHAT_DB_HELPER
	  $items = New-Object System.Collections.Generic.List[object]
	  if ([string]::IsNullOrWhiteSpace($helper) -or -not (Test-Path -LiteralPath $helper)) {
	    return (New-ContactBatch $items '' 'helper not configured')
	  }
	  Set-Diagnostic 'dbHelper' $helper
	  try {
	    $helperName = [System.IO.Path]::GetFileName($helper)
	    $helperArgs = @('--mode', $syncMode)
	    if ($helperName -match '(?i)wechat-dump-rs') {
	      $helperArgs = @('-a')
	    }
	    $output = @(& $helper @helperArgs 2>&1) -join [Environment]::NewLine
	    $jsonLine = Find-JsonPayloadLine $output
	      if ($jsonLine) {
	        $parsed = $jsonLine | ConvertFrom-Json
	        try {
	          if ($parsed.currentWechatId) { Set-Diagnostic 'selectedDbAccountFolder' ([string]$parsed.currentWechatId) }
	          if ($parsed.diagnostics.selectedDbAccountFolder) { Set-Diagnostic 'selectedDbAccountFolder' ([string]$parsed.diagnostics.selectedDbAccountFolder) }
	          if ($parsed.diagnostics.selectedDbBaseWxid) { Set-Diagnostic 'selectedDbBaseWxid' ([string]$parsed.diagnostics.selectedDbBaseWxid) }
	          if ($parsed.diagnostics.selectedDbPath) { Set-Diagnostic 'selectedDbPath' ([string]$parsed.diagnostics.selectedDbPath) }
	        } catch {}
	        $rawItems = @()
	      if ($parsed.items) { $rawItems = @($parsed.items) }
	      elseif ($parsed.contacts) { $rawItems = @($parsed.contacts) }
	      foreach ($raw in $rawItems) {
	        if ($raw -is [string]) {
	          Add-DbContactItem $items $raw $raw '' ''
	        } else {
	          Add-DbContactItem $items ([string]$raw.wxid) ([string]$raw.nickname) ([string]$raw.remark) ([string]$raw.alias)
	        }
	      }
	      Set-Diagnostic 'dbContactCount' ([int]$items.Count)
	      return (New-ContactBatch $items)
	    }
	    $helperDbPaths = @(Find-ContactDbPathsFromHelperOutput $output)
	    if ($helperDbPaths.Count -gt 0) {
	      $sqliteBatch = Try-CollectContactsBySqliteCli $helperDbPaths $syncMode
	      if ($sqliteBatch['Items'].Count -gt 0) {
	        return (New-ContactBatch $sqliteBatch['Items'])
	      }
	    }
	    Set-Diagnostic 'dbError' 'DB helper 没有返回联系人 JSON，也没有识别到可读 contact.db 输出目录。'
	    return (New-ContactBatch $items '' 'helper no contacts')
	  } catch {
	    Set-Diagnostic 'dbError' $_.Exception.Message
	    Add-DiagnosticWarning "DB helper 执行失败：$($_.Exception.Message)"
	    return (New-ContactBatch $items '' $_.Exception.Message)
	  }
	}

	function Try-CollectContactsByDatabase([string]$syncMode) {
	  Add-AttemptedSource 'windows-db'
	  Set-Diagnostic 'stage' 'db-sync'
	  $helperBatch = Try-CollectContactsByDbHelper $syncMode
	  if ($helperBatch['Items'].Count -gt 0) {
	    return (New-ContactBatch $helperBatch['Items'] 'windows-wechat-db-helper')
	  }
	  $dbPaths = @(Find-WeChatContactDbCandidates)
	  if ($dbPaths.Count -eq 0) {
	    Set-Diagnostic 'dbError' '未找到微信 contact.db/MicroMsg.db。'
	    Add-DiagnosticWarning '未找到微信 contact.db/MicroMsg.db，已退回 UIA/OCR。'
	    return (New-ContactBatch @() 'windows-wechat-db' 'db not found')
	  }
	  $sqliteBatch = Try-CollectContactsBySqliteCli $dbPaths $syncMode
	  if ($sqliteBatch['Items'].Count -gt 0) {
	    return (New-ContactBatch $sqliteBatch['Items'] 'windows-wechat-db')
	  }
	  $decryptedDbPaths = @(Try-DecryptWeChatContactDbs $dbPaths)
	  if ($decryptedDbPaths.Count -gt 0) {
	    $decryptedBatch = Try-CollectContactsBySqliteCli $decryptedDbPaths $syncMode
	    if ($decryptedBatch['Items'].Count -gt 0) {
	      return (New-ContactBatch $decryptedBatch['Items'] 'windows-wechat-db-decrypted')
	    }
	    if ($decryptedBatch['Error']) {
	      Set-Diagnostic 'dbError' $decryptedBatch['Error']
	    }
	  }
	  if ($sqliteBatch['Error']) {
	    Add-DiagnosticWarning "数据库通道未读到联系人：$($sqliteBatch['Error'])"
	  }
	  return (New-ContactBatch @() 'windows-wechat-db' $sqliteBatch['Error'])
	}

	$syncMode = 'random'
	if ($env:AI_CONTENT_WECHAT_CONTACT_SYNC_MODE -eq 'all') {
	  $syncMode = 'all'
	}
	$dbBatch = Try-CollectContactsByDatabase $syncMode
	if ($dbBatch['Items'].Count -gt 0) {
	  Set-Diagnostic 'stage' 'completed-db'
	  Set-Diagnostic 'source' $dbBatch['Source']
	  Emit-Json @{
	    ok = $true
	    source = $dbBatch['Source']
	    mode = $syncMode
	    items = @($dbBatch['Items'])
	    contacts = @($dbBatch['Items'])
	    count = $dbBatch['Items'].Count
	    diagnostics = (Get-Diagnostics)
	  }
	}

	if ($env:AI_CONTENT_WECHAT_CONTACT_DB_ONLY -match '^(1|true|yes)$') {
	  Set-Diagnostic 'stage' 'db-sync-blocked'
	  Set-Diagnostic 'failureLayer' 'db-helper'
	  $dbOnlyReason = '数据库主链路没有读到联系人，已禁用 UIA/OCR 覆盖通讯录。'
	  if ($dbBatch['Error']) {
	    $dbOnlyReason = "$dbOnlyReason $($dbBatch['Error'])"
	  }
	  Set-Diagnostic 'failureReason' $dbOnlyReason
	  Add-DiagnosticWarning $dbOnlyReason
	  Fail "Windows 微信通讯录数据库同步失败：$dbOnlyReason"
	}

	try {
	  Add-Type -AssemblyName UIAutomationClient
	  Add-Type -AssemblyName UIAutomationTypes
	  Add-Type -AssemblyName System.Windows.Forms
	  Add-Type -AssemblyName System.Drawing
	} catch {
	  Fail "Windows 微信通讯录同步控制器初始化失败：$($_.Exception.Message)"
	}

	$script:KaypalWinRtAvailable = $true
	$script:KaypalWinRtError = ''
	try {
	  Add-Type -AssemblyName System.Runtime.WindowsRuntime
	} catch {
	  $script:KaypalWinRtAvailable = $false
	  $script:KaypalWinRtError = $_.Exception.Message
	}

		try {
		  $kaypalWin32Type = @(
		    'using System;',
		    'using System.Runtime.InteropServices;',
		    'public static class KaypalWin32 {',
		    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
		    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
		    '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
		    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);',
		    '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);',
		    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
		    '}'
		  ) -join [Environment]::NewLine
		  Add-Type -TypeDefinition $kaypalWin32Type
		} catch {
	  Fail "Windows 微信通讯录同步 Win32 控制器初始化失败：$($_.Exception.Message)"
	}

	function Await-WinRt($async, [Type]$resultType) {
	  if (-not $script:KaypalWinRtAvailable) {
	    throw "Windows OCR 运行时不可用：$script:KaypalWinRtError"
	  }
	  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
	    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
	  })[0]
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($async))
  $task.Wait()
  if ($task.IsFaulted) {
    throw $task.Exception
	  }
	  return $task.Result
	}

function Click-Point([int]$x, [int]$y) {
  [KaypalWin32]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [KaypalWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [KaypalWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 350
}

function Wheel-Down([int]$x, [int]$y) {
  [KaypalWin32]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [KaypalWin32]::mouse_event(0x0800, 0, 0, -720, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 500
}

function Test-NonWechatPageText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  return $text -match '抖音|Douyin|发布中心|平台账号|视频工坊|内容素材|知识库|选题库|文章库|小红书|快手|B站|AI员工TOS|智能运营系统|应用市场|增长获客'
}

function Test-WechatContactPageText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  return $text -match '微信|WeChat|Weixin|通讯录|联系人|新的朋友|群聊|标签|公众号|企业微信联系人|搜索'
}

	function Clean-Contact([string]$line) {
	  if ([string]::IsNullOrWhiteSpace($line)) { return '' }
	  $value = ($line -replace '\s+', ' ').Trim()
  $value = ($value -replace '^[•·@#\->＞〉›\s]+', '').Trim()
  $value = ($value -replace '[《》<>]', '').Trim()
  if ($value -match '[\u4e00-\u9fff]') {
    $value = [regex]::Replace($value, '(?<=[\u4e00-\u9fffA-Za-z0-9])\s+(?=[\u4e00-\u9fffA-Za-z0-9])', '')
  }
  $value = [regex]::Replace($value, '\s*(微信号|wxid|备注|标签)[:：].*$', '', 'IgnoreCase').Trim()
  $value = ($value -replace '[.。…⋯]+$', '').Trim()
  $compact = ($value -replace '\s+', '')
  if (-not $compact) { return '' }
		  if ($compact -match '^(微信|WeChat|Weixin|通讯录|联系人|联 系 人|新的朋友|朋友|群聊|标签|公众号|服务号|企业微信联系人|搜索|聊天|收藏|文件传输助手|朋友圈|视频号|订阅号|服务通知|小程序|更多|全部|添加朋友|新的联系人|我的企业|星标朋友|公星标朋友)$') { return '' }
	  if ($compact -match '星标朋友|我的企业') { return '' }
  if ($compact -match '联系人|通讯录|搜索') { return '' }
  if ($value -match '^(联系人|通讯录)\s*\d+$') { return '' }
  if (Test-NonWechatPageText $value) { return '__CONTAMINATION__' }
	  if ($value -match '微信小店助手|腾讯新闻|东方甄选|订阅号消息|微信团队|服务通知|公众号|服务号|福利小管|时惠叭|甄选|网友|茉莉奶|新闻|A new version of Dock|Upgrade plan|Engine starting') { return '' }
	  if ($compact -match '^[【\[\［].*[】\]\］]') { return '' }
	  if ($value -match '折叠的聊天|@所有人|\[\d+条\]|分钟前|昨天|今天|[0-2]?\d:[0-5]\d|招聘|工作内容|上班时间|微信同步|置顶') { return '' }
  if ($value -match '每月|满\d|元|小时|专业|速度|参与|赠|抽|送|工资|电话|地址|直播间|微信安全|[!！。；;]') { return '' }
  if ($compact.Length -lt 2 -or $compact.Length -gt 40) { return '' }
  if ($compact -match '^[\d:：.。/\\|｜)(（）\[\]{}]+$') { return '' }
	  if ($compact -notmatch '[\u4e00-\u9fffA-Za-z0-9]') { return '' }
	  return $value
	}

	function Add-ContactCandidate($contacts, [string]$candidate) {
	  $clean = Clean-Contact $candidate
	  if ($clean -eq '__CONTAMINATION__') {
		    Fail '当前焦点不是微信通讯录窗口：通讯录读取结果混入抖音/发布中心等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
	  }
	  if ($clean -and -not $contacts.Contains($clean)) {
	    $contacts.Add($clean) | Out-Null
	  }
	}

	function Add-RawCandidate($raw, [string]$candidate) {
	  if (-not [string]::IsNullOrWhiteSpace($candidate)) {
	    $value = ($candidate -replace '\s+', ' ').Trim()
	    if ($value -and -not $raw.Contains($value)) {
	      $raw.Add($value) | Out-Null
	    }
	  }
	}

	function Get-ElementTextCandidates($el) {
	  $values = New-Object System.Collections.Generic.List[string]
	  foreach ($propName in @('Name', 'AutomationId', 'ClassName', 'HelpText', 'ItemStatus', 'ItemType')) {
	    try {
	      $value = [string]$el.Current.$propName
	      if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	        $values.Add($value) | Out-Null
	      }
	    } catch {}
	  }
	  try {
	    $legacy = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
	    foreach ($value in @([string]$legacy.Current.Name, [string]$legacy.Current.Value, [string]$legacy.Current.Description)) {
	      if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	        $values.Add($value) | Out-Null
	      }
	    }
	  } catch {}
	  try {
	    $valuePattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
	    $value = [string]$valuePattern.Current.Value
	    if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	      $values.Add($value) | Out-Null
	    }
	  } catch {}
	  try {
	    $textPattern = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
	    $value = [string]$textPattern.DocumentRange.GetText(200)
	    if (-not [string]::IsNullOrWhiteSpace($value) -and -not $values.Contains($value)) {
	      $values.Add($value) | Out-Null
	    }
	  } catch {}
	  return $values
	}

function Get-WeChatWindow {
  $candidates = New-Object System.Collections.Generic.List[object]
  $processes = Get-Process | Where-Object {
    $_.MainWindowHandle -ne 0 -and (
      $_.ProcessName -match 'WeChat|Weixin|WeChatAppEx|微信' -or
      $_.MainWindowTitle -match '微信|WeChat'
    )
  }
  foreach ($proc in $processes) {
    try {
      $element = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
      if ($null -eq $element) { continue }
      $rect = $element.Current.BoundingRectangle
      if (
        ($rect.Width -ge 520 -and $rect.Height -ge 480) -or
        $proc.MainWindowTitle -match '微信|WeChat' -or
        $proc.ProcessName -match 'WeChat|Weixin|微信'
      ) {
        $candidates.Add(@{
          Process = $proc
          Element = $element
          Rect = $rect
          Handle = $proc.MainWindowHandle
          Area = [double]($rect.Width * $rect.Height)
          Title = [string]$proc.MainWindowTitle
        }) | Out-Null
      }
    } catch {
      continue
    }
  }
  try {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $windows = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition
    )
    for ($i = 0; $i -lt $windows.Count; $i++) {
      $element = $windows.Item($i)
      $name = [string]$element.Current.Name
      $pid = [int]$element.Current.ProcessId
      if ($pid -le 0) { continue }
      $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
      if ($null -eq $proc) { continue }
      if ($proc.ProcessName -notmatch 'WeChat|Weixin|WeChatAppEx|微信' -and $name -notmatch '微信|WeChat') { continue }
      $rect = $element.Current.BoundingRectangle
      if (
        ($rect.Width -ge 520 -and $rect.Height -ge 480) -or
        $name -match '微信|WeChat' -or
        $proc.ProcessName -match 'WeChat|Weixin|微信'
      ) {
        $candidates.Add(@{
          Process = $proc
          Element = $element
          Rect = $rect
          Handle = $element.Current.NativeWindowHandle
          Area = [double]($rect.Width * $rect.Height)
          Title = $name
        }) | Out-Null
      }
    }
  } catch {}
  if ($candidates.Count -eq 0) { return $null }
  $best = $candidates |
    Sort-Object @{ Expression = { if ($_.Title -match '微信|WeChat') { 1 } else { 0 } }; Descending = $true },
                @{ Expression = 'Area'; Descending = $true } |
    Select-Object -First 1
  $candidatePreview = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in $candidates) {
    try {
      $candidateArea = [string]$candidate.Area
      $candidatePreview.Add("$($candidate.Process.ProcessName)/$($candidate.Title)/$candidateArea") | Out-Null
    } catch {}
  }
  if ($candidatePreview.Count -gt 0) {
    Add-DiagnosticListItem 'rawPreview' ("候选微信窗口：" + ($candidatePreview -join ' | ')) 5
  }
  return $best
}

function Focus-WeChat($window) {
  $handle = [IntPtr]$window.Handle
  if ($handle -eq [IntPtr]::Zero -and $window.Process.MainWindowHandle -ne 0) {
    $handle = [IntPtr]$window.Process.MainWindowHandle
  }
  if ($handle -eq [IntPtr]::Zero) { return }
  [KaypalWin32]::ShowWindowAsync($handle, 9) | Out-Null
  [KaypalWin32]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 600
  try {
    $window['Element'] = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $window['Rect'] = $window['Element'].Current.BoundingRectangle
    $window['Handle'] = $handle
  } catch {}
}

function Get-WindowRectByHandle($window) {
  $handle = [IntPtr]$window.Handle
  if ($handle -eq [IntPtr]::Zero -and $window.Process.MainWindowHandle -ne 0) {
    $handle = [IntPtr]$window.Process.MainWindowHandle
  }
  $rect = New-Object KaypalWin32+RECT
  if (-not [KaypalWin32]::GetWindowRect($handle, [ref]$rect)) {
    return $null
  }
  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 300 -or $height -lt 300) {
    return $null
  }
  return @{
    Left = [int]$rect.Left
    Top = [int]$rect.Top
    Width = [int]$width
    Height = [int]$height
    Right = [int]$rect.Right
    Bottom = [int]$rect.Bottom
  }
}

function Capture-EnvironmentDiagnostics($window) {
  try {
    Set-Diagnostic 'processName' ([string]$window.Process.ProcessName)
    Set-Diagnostic 'processId' ([int]$window.Process.Id)
    Set-Diagnostic 'windowTitle' ([string]$window.Process.MainWindowTitle)
  } catch {}
  try {
    $rect = Get-WindowRectByHandle $window
    if ($null -ne $rect) {
      Set-Diagnostic 'windowRect' @{
        left = $rect.Left
        top = $rect.Top
        width = $rect.Width
        height = $rect.Height
      }
    }
  } catch {}
  try {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Set-Diagnostic 'screen' @{ width = [int]$screen.Width; height = [int]$screen.Height }
  } catch {}
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($null -ne $os) {
      Set-Diagnostic 'os' "$($os.Caption) $($os.Version)"
    }
  } catch {}
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Set-Diagnostic 'isCurrentProcessElevated' ([bool]$isAdmin)
    if (-not $isAdmin) {
      Add-DiagnosticWarning '当前同步控制器不是管理员权限；如果微信以管理员权限启动，Windows UIA 可能读不到通讯录。'
    }
  } catch {}
}

function Read-OcrLinesFromRegion([int]$x, [int]$y, [int]$width, [int]$height) {
  try {
    [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null

    $safeX = [Math]::Max(0, $x)
    $safeY = [Math]::Max(0, $y)
    $safeWidth = [Math]::Max(120, $width)
    $safeHeight = [Math]::Max(120, $height)
    $bitmap = [System.Drawing.Bitmap]::new($safeWidth, $safeHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($safeX, $safeY, 0, 0, [System.Drawing.Size]::new($safeWidth, $safeHeight))
    $graphics.Dispose()

    $maxOcrDimension = 2200
    try {
      $ocrMax = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
      if ($ocrMax -gt 0) {
        $maxOcrDimension = [Math]::Min($maxOcrDimension, [int]($ocrMax - 20))
      }
    } catch {}
    $scale = 2.0
    $largestSide = [Math]::Max($safeWidth, $safeHeight)
    if (($largestSide * $scale) -gt $maxOcrDimension) {
      $scale = [Math]::Max(1.0, $maxOcrDimension / $largestSide)
    }
    $scaledWidth = [int]([Math]::Max(120, [Math]::Round($safeWidth * $scale)))
    $scaledHeight = [int]([Math]::Max(120, [Math]::Round($safeHeight * $scale)))
    $scaled = [System.Drawing.Bitmap]::new($scaledWidth, $scaledHeight)
    $scaledGraphics = [System.Drawing.Graphics]::FromImage($scaled)
    $scaledGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaledGraphics.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
    $scaledGraphics.Dispose()
    $bitmap.Dispose()

    $path = Join-Path $env:TEMP ("ai-content-wechat-contacts-" + [Guid]::NewGuid().ToString("N") + ".png")
    $scaled.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $scaled.Dispose()

    $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    if ($softwareBitmap.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8 -or $softwareBitmap.BitmapAlphaMode -ne [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied) {
      $softwareBitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert(
        $softwareBitmap,
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied
      )
    }
    $language = New-Object Windows.Globalization.Language('zh-Hans')
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
    if ($null -eq $engine) {
      $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    }
    if ($null -eq $engine) {
      return @{ Lines = @(); Image = $path; Error = 'Windows OCR 引擎不可用' }
    }
    $ocrResult = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @()
    foreach ($line in $ocrResult.Lines) {
      $text = [string]$line.Text
      if (-not [string]::IsNullOrWhiteSpace($text)) {
        $lines += $text
      }
    }
    return @{ Lines = $lines; Image = $path; Error = '' }
  } catch {
    return @{ Lines = @(); Image = ''; Error = $_.Exception.Message }
  }
}

function Collect-ContactsByOcr($window, [int]$pageIndex) {
  Add-AttemptedSource 'windows-ocr'
  $rect = Get-WindowRectByHandle $window
  if ($null -eq $rect) {
    Add-DiagnosticWarning '无法获取微信窗口位置，OCR 截图已跳过。'
    return @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '无法获取微信窗口位置' }
  }
  $candidates = @(
    @{ X = $rect.Left + 60; Y = $rect.Top + 72; W = [Math]::Min(300, $rect.Width - 70); H = $rect.Height - 90 },
    @{ X = $rect.Left + 70; Y = $rect.Top + 95; W = [Math]::Min(330, $rect.Width - 90); H = $rect.Height - 125 },
    @{ X = $rect.Left + 95; Y = $rect.Top + 105; W = [Math]::Min(250, $rect.Width - 120); H = $rect.Height - 140 }
  )
  $best = @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '' }
  foreach ($candidate in $candidates) {
    $candidateX = [int]($candidate['X'])
    $candidateY = [int]($candidate['Y'])
    $candidateW = [int]($candidate['W'])
    $candidateH = [int]($candidate['H'])
    $ocr = Read-OcrLinesFromRegion $candidateX $candidateY $candidateW $candidateH
    if ($ocr.Image) {
      Set-Diagnostic 'screenshotPath' $ocr.Image
    }
    if ($ocr.Error) {
      Add-DiagnosticWarning "OCR 区域 $candidateX,$candidateY,$candidateW,$candidateH 失败：$($ocr.Error)"
    }
    foreach ($line in $ocr.Lines) {
      Add-DiagnosticListItem 'ocrPreview' $line 30
    }
    $ocrText = ($ocr.Lines -join [Environment]::NewLine)
    if (Test-NonWechatPageText $ocrText) {
      Fail '当前焦点不是微信通讯录窗口：OCR 识别到抖音/发布中心/知识库等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
    }
    if ($pageIndex -eq 1 -and $ocr.Lines.Count -gt 0 -and -not (Test-WechatContactPageText $ocrText)) {
      Add-DiagnosticWarning "首页 OCR 区域 $candidateX,$candidateY,$candidateW,$candidateH 未识别到微信通讯录特征，已跳过该区域。"
      continue
    }
    $contacts = New-Object System.Collections.Generic.List[string]
    foreach ($line in $ocr.Lines) {
      foreach ($part in ([string]$line -split '\s{2,}|[|｜]')) {
        $clean = Clean-Contact $part
        if ($clean -eq '__CONTAMINATION__') {
          Fail '当前焦点不是微信通讯录窗口：OCR 识别到非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
        }
        if ($clean -and -not $contacts.Contains($clean)) {
          $contacts.Add($clean) | Out-Null
        }
      }
    }
    if ($contacts.Count -gt $best.Contacts.Count) {
      $best = @{ Contacts = @($contacts); Raw = @($ocr.Lines); ScreenshotPath = $ocr.Image; Error = $ocr.Error }
    }
  }
  Update-MaxDiagnosticNumber 'ocrContactCount' ([int]$best.Contacts.Count)
  return $best
}

function Try-ClickContactTabByCoordinate($window) {
  $rect = $window.Element.Current.BoundingRectangle
  if ($rect.Width -lt 240 -or $rect.Height -lt 320) { return $false }
  $x = [int]($rect.Left + 28)
  $candidateYs = @(
    [int]($rect.Top + 94),
    [int]($rect.Top + 128),
    [int]($rect.Top + 166),
    [int]($rect.Top + 204)
  )
  foreach ($y in $candidateYs) {
    Click-Point $x $y
    Start-Sleep -Milliseconds 450
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
    $batch = Collect-Contacts $root
    $rawText = ($batch.Raw -join [Environment]::NewLine)
    if ($batch.Contacts.Count -gt 0 -or $rawText -match '通讯录|联系人|新的朋友|群聊|标签|公众号|企业微信联系人') {
      return $true
    }
  }
  return $false
}

	function Try-ClickContactTab($root) {
	  $all = $root.FindAll(
	    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
  )
  for ($i = 0; $i -lt $all.Count; $i++) {
    $el = $all.Item($i)
    $name = [string]$el.Current.Name
    if ($name -notmatch '通讯录|联系人') { continue }
    try {
      $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      Start-Sleep -Milliseconds 700
      return $true
    } catch {}
    try {
      $select = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $select.Select()
      Start-Sleep -Milliseconds 700
      return $true
    } catch {}
  }
	  return $false
	}

	function Collect-ContactsFromElements($elements, [int]$maxCount) {
	  Add-AttemptedSource 'windows-uia'
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  $max = [Math]::Min($elements.Count, $maxCount)
	  for ($i = 0; $i -lt $max; $i++) {
	    $el = $elements.Item($i)
	    $texts = Get-ElementTextCandidates $el
	    foreach ($text in $texts) {
	      Add-RawCandidate $raw $text
	      Add-DiagnosticListItem 'rawPreview' $text 30
	      foreach ($part in ([string]$text -split '\r?\n|\s{2,}|[|｜]')) {
	        Add-ContactCandidate $contacts $part
	      }
	    }
	  }
	  Update-MaxDiagnosticNumber 'rawTextCount' ([int]$raw.Count)
	  Update-MaxDiagnosticNumber 'uiaContactCount' ([int]$contacts.Count)
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Collect-ContactsByControlView($root) {
	  $all = $root.FindAll(
	    [System.Windows.Automation.TreeScope]::Descendants,
	    [System.Windows.Automation.Condition]::TrueCondition
	  )
	  return Collect-ContactsFromElements $all 2500
	}

	function Collect-ContactsByRawView($root) {
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  try {
	    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
	    $queue = New-Object System.Collections.Queue
	    $queue.Enqueue($root)
	    $visited = 0
	    while ($queue.Count -gt 0 -and $visited -lt 4500) {
	      $el = $queue.Dequeue()
	      $visited += 1
	      $texts = Get-ElementTextCandidates $el
	      foreach ($text in $texts) {
	        Add-RawCandidate $raw $text
	        foreach ($part in ([string]$text -split '\r?\n|\s{2,}|[|｜]')) {
	          Add-ContactCandidate $contacts $part
	        }
	      }
	      try {
	        $child = $walker.GetFirstChild($el)
	        while ($null -ne $child -and $visited + $queue.Count -lt 4500) {
	          $queue.Enqueue($child)
	          $child = $walker.GetNextSibling($child)
	        }
	      } catch {}
	    }
	  } catch {}
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Merge-ContactBatches($primary, $secondary) {
	  $raw = New-Object System.Collections.Generic.List[string]
	  $contacts = New-Object System.Collections.Generic.List[string]
	  foreach ($batch in @($primary, $secondary)) {
	    foreach ($item in $batch.Raw) { Add-RawCandidate $raw $item }
	    foreach ($item in $batch.Contacts) {
	      if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
	    }
	  }
	  return @{ Raw = $raw; Contacts = $contacts }
	}

	function Collect-Contacts($root) {
	  $control = Collect-ContactsByControlView $root
	  if ($control.Contacts.Count -ge 2) { return $control }
	  $rawView = Collect-ContactsByRawView $root
	  return Merge-ContactBatches $control $rawView
	}

	function Collect-VisibleContacts($root, $window, [int]$pageIndex) {
	  Set-Diagnostic 'stage' "collect-page-$pageIndex-uia"
	  $uia = Collect-Contacts $root
	  $merged = $uia
	  $ocr = @{ Contacts = @(); Raw = @(); ScreenshotPath = ''; Error = '' }
	  $ocrEveryPage = $false
	  if ($env:AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE -match '^(1|true|yes)$') {
	    $ocrEveryPage = $true
	  }
	  $shouldUseOcr = $pageIndex -eq 1 -or $ocrEveryPage
	  if (-not $shouldUseOcr -and $uia.Contacts.Count -lt 2) {
	    Add-DiagnosticWarning "第 $pageIndex 页 UIA 读取不足，已跳过滚动页 OCR，避免误扫非微信页面。需要强制逐页 OCR 时可设置 AI_CONTENT_WECHAT_CONTACT_OCR_EACH_PAGE=1。"
	  }
	  if ($shouldUseOcr) {
	    Set-Diagnostic 'stage' "collect-page-$pageIndex-ocr"
	    $ocr = Collect-ContactsByOcr $window $pageIndex
	    $ocrBatch = @{ Raw = @($ocr.Raw); Contacts = @($ocr.Contacts) }
	    $merged = Merge-ContactBatches $uia $ocrBatch
	  }
	  Update-MaxDiagnosticNumber 'uiaContactCount' ([int]$uia.Contacts.Count)
	  Update-MaxDiagnosticNumber 'ocrContactCount' ([int]$ocr.Contacts.Count)
	  Set-Diagnostic 'pagesScanned' $pageIndex
	  return @{
	    Raw = @($merged.Raw)
	    Contacts = @($merged.Contacts)
	    UiaContacts = @($uia.Contacts)
	    OcrContacts = @($ocr.Contacts)
	    ScreenshotPath = $ocr.ScreenshotPath
	    Error = $ocr.Error
	  }
	}

function Scroll-Contacts($root) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty,
    $true
  )
  $scrollables = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
  for ($i = 0; $i -lt $scrollables.Count; $i++) {
    try {
      $pattern = $scrollables.Item($i).GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($pattern.Current.VerticallyScrollable) {
        $pattern.Scroll(
          [System.Windows.Automation.ScrollAmount]::NoAmount,
          [System.Windows.Automation.ScrollAmount]::LargeIncrement
        )
        Start-Sleep -Milliseconds 450
        return
      }
    } catch {}
  }
  try {
    $rect = Get-WindowRectByHandle $window
    if ($null -ne $rect) {
      $x = [int]($rect.Left + [Math]::Min(260, [Math]::Max(120, $rect.Width * 0.22)))
      $y = [int]($rect.Top + [Math]::Max(220, $rect.Height * 0.62))
      Wheel-Down $x $y
      return
    }
  } catch {
    Add-DiagnosticWarning "鼠标滚轮翻页失败：$($_.Exception.Message)"
  }
  [System.Windows.Forms.SendKeys]::SendWait('{PGDN}')
  Start-Sleep -Milliseconds 450
}

function Reset-ContactsToTop($root, $window) {
  Set-Diagnostic 'stage' 'reset-contact-list-top'
  $didReset = $false
  try {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty,
      $true
    )
    $scrollables = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
    for ($i = 0; $i -lt $scrollables.Count; $i++) {
      try {
        $pattern = $scrollables.Item($i).GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
        if ($pattern.Current.VerticallyScrollable) {
          $pattern.SetScrollPercent(
            [System.Windows.Automation.ScrollPattern]::NoScroll,
            0
          )
          Start-Sleep -Milliseconds 700
          $didReset = $true
          break
        }
      } catch {}
    }
  } catch {}
  if (-not $didReset) {
    try {
      [System.Windows.Forms.SendKeys]::SendWait('^{HOME}')
      Start-Sleep -Milliseconds 900
      $didReset = $true
    } catch {}
  }
  if (-not $didReset) {
    Add-DiagnosticWarning '未能确认通讯录列表已回到顶部，将从当前可见位置开始全量扫描。'
  }
}

Set-Diagnostic 'stage' 'find-window'
$window = Get-WeChatWindow
if ($null -eq $window) {
  Fail '没有找到已登录的 Windows 微信主窗口。请先打开微信桌面版并停留在主窗口。'
}
Set-Diagnostic 'stage' 'focus-window'
Focus-WeChat $window
Capture-EnvironmentDiagnostics $window
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
Set-Diagnostic 'stage' 'open-contact-tab'
Try-ClickContactTab $root | Out-Null
[System.Windows.Forms.SendKeys]::SendWait('^2')
Start-Sleep -Milliseconds 800
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
if ($syncMode -eq 'all') {
  Reset-ContactsToTop $root $window
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
}
$first = Collect-VisibleContacts $root $window 1
$rawText = ($first.Raw -join [Environment]::NewLine)
if (Test-NonWechatPageText $rawText) {
	  Fail '当前焦点不是微信通讯录窗口：读取到抖音/发布中心/知识库等非微信页面内容。请把 Windows 微信主窗口切到“通讯录”后重试；本次不会覆盖本地通讯录缓存。'
}
	if ($first.Contacts.Count -eq 0) {
	  Set-Diagnostic 'stage' 'coordinate-contact-tab'
	  Try-ClickContactTabByCoordinate $window | Out-Null
	  [System.Windows.Forms.SendKeys]::SendWait('^2')
	  Start-Sleep -Milliseconds 800
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
  if ($syncMode -eq 'all') {
    Reset-ContactsToTop $root $window
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
  }
  $first = Collect-VisibleContacts $root $window 1
  $rawText = ($first.Raw -join [Environment]::NewLine)
}
if ($first.Contacts.Count -eq 0 -and -not (Test-WechatContactPageText $rawText)) {
  Fail "没有识别到微信通讯录窗口特征，当前窗口可读文本 $($first.Raw.Count) 条。请确认 Windows 微信桌面版已打开主窗口，再点通讯录同步。"
}

$contacts = New-Object System.Collections.Generic.List[string]
foreach ($item in $first.Contacts) {
  if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
}
$source = 'windows-wechat-uia'
if ($first.UiaContacts.Count -eq 0 -and $first.OcrContacts.Count -gt 0) {
  $source = 'windows-wechat-ocr'
} elseif ($first.OcrContacts.Count -gt 0) {
  $source = 'windows-wechat-hybrid'
}
$screenshotPath = ''
if ($first.ScreenshotPath) { $screenshotPath = $first.ScreenshotPath }

$pages = 8
$staleLimit = 2
if ($syncMode -eq 'all') {
  $pages = 200
  $staleLimit = 5
}
if ($env:AI_CONTENT_WECHAT_CONTACT_SCROLL_PAGES) {
  $parsed = 0
  if ([int]::TryParse($env:AI_CONTENT_WECHAT_CONTACT_SCROLL_PAGES, [ref]$parsed)) {
    $maxPages = if ($syncMode -eq 'all') { 300 } else { 30 }
    $pages = [Math]::Max(1, [Math]::Min($parsed, $maxPages))
  }
}
$stalePages = 0
for ($page = 2; $page -le $pages; $page++) {
  Set-Diagnostic 'stage' "scroll-page-$page"
  $beforeCount = $contacts.Count
  Scroll-Contacts $root
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window.Handle)
  $batch = Collect-VisibleContacts $root $window $page
  $batchRawText = ($batch.Raw -join [Environment]::NewLine)
  if (Test-NonWechatPageText $batchRawText) {
    Fail "滚动到第 $page 页时当前焦点离开微信通讯录窗口，读取到非微信页面内容；已停止并拒绝写入通讯录缓存。请把 Windows 微信主窗口切到“通讯录”后重试。"
  }
  if ($batch.ScreenshotPath) { $screenshotPath = $batch.ScreenshotPath }
  if ($batch.OcrContacts.Count -gt 0 -and $source -eq 'windows-wechat-uia') {
    $source = 'windows-wechat-hybrid'
  }
  foreach ($item in $batch.Contacts) {
    if (-not $contacts.Contains($item)) { $contacts.Add($item) | Out-Null }
  }
  if ($contacts.Count -eq $beforeCount) {
    $stalePages += 1
  } else {
    $stalePages = 0
  }
  if ($stalePages -ge $staleLimit) {
    Add-DiagnosticWarning "连续 $staleLimit 页没有新增联系人，已停止滚动采集。"
    break
  }
}

if ($contacts.Count -eq 0) {
  Fail '没有从 Windows 微信通讯录读取到真实联系人。当前微信版本未向 UIA 暴露通讯录文本，Windows OCR 也未识别到可用联系人；诊断信息已包含窗口、截图和原始识别预览。'
}

Set-Diagnostic 'stage' 'completed'
Set-Diagnostic 'source' $source
Set-Diagnostic 'screenshotPath' $screenshotPath
Emit-Json @{
  ok = $true
  source = $source
  mode = $syncMode
  contacts = @($contacts)
  count = $contacts.Count
  screenshotPath = $screenshotPath
  diagnostics = (Get-Diagnostics)
}
`.trim();
  }

  private runWechatChatHistorySyncScript(
    scriptPath: string,
    input: SyncWechatChatHistoryInput,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, reject) => {
      const args = [scriptPath];
      if (input.sessionId) {
        args.push('--session-id', input.sessionId);
      }
      if (input.limit && Number.isFinite(Number(input.limit))) {
        args.push('--limit', String(Math.floor(Number(input.limit))));
      }
      const pythonCommand =
        process.env.AI_CONTENT_PYTHON_PATH?.trim() ||
        process.env.PYTHON?.trim() ||
        'python3';
      const child = spawn(pythonCommand, args, {
        env: {
          ...process.env,
          PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('微信聊天历史同步执行超时'));
      }, 180000);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const output = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        if (code !== 0) {
          reject(
            new Error(
              (stderr || stdout || `微信聊天历史同步退出码 ${code}`).trim(),
            ),
          );
          return;
        }
        if (!output) {
          reject(new Error('微信聊天历史同步没有返回结果'));
          return;
        }
        try {
          resolvePromise(JSON.parse(output) as Record<string, unknown>);
        } catch (error) {
          reject(
            new Error(
              `微信聊天历史同步返回结果不可解析：${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      });
    });
  }

  private getRuntimeServiceDefinitions() {
    const projectRoot = this.getProjectRoot();
    const logDir = this.getProjectLogRoot();

    return [
      {
        key: 'frontend' as const,
        name: '主系统前端',
        url: 'http://localhost:3010/login',
        port: 3010,
        screenSession: 'ai-content-frontend',
        logPath: join(logDir, 'frontend-3010.log'),
      },
      {
        key: 'backend' as const,
        name: '主系统后端',
        url: 'http://localhost:3011/api/auth/setup-status',
        port: 3011,
        screenSession: 'ai-content-backend',
        logPath: join(logDir, 'backend-3011.log'),
      },
      {
        key: 'agent-s' as const,
        name: this.useNodeAgentRuntime()
          ? 'Agent-S 包内 Node Runtime'
          : 'Agent-S 桌面执行器',
        // Node Runtime 模式下不要求外部 17777 Python sidecar；Agent-S API 由 3011 进程提供。
        url: this.useNodeAgentRuntime()
          ? 'http://localhost:3011/api/agent-s/health'
          : 'http://127.0.0.1:17777/healthz',
        port: this.useNodeAgentRuntime() ? 3011 : 17777,
        screenSession: this.useNodeAgentRuntime()
          ? 'ai-content-backend'
          : 'agent-s',
        logPath: this.useNodeAgentRuntime()
          ? join(logDir, 'backend-3011.log')
          : join(logDir, 'agent-s-17777.log'),
      },
    ];
  }

  private async inspectRuntimeService(
    service: Omit<
      LocalEngineRuntimeService,
      'online' | 'managedByScreen' | 'logExists' | 'message' | 'pid'
    >,
    screenSessions: Set<string>,
  ): Promise<LocalEngineRuntimeService> {
    const isNodeRuntimeAgentS =
      service.key === 'agent-s' && this.useNodeAgentRuntime();
    const httpProbeOptions =
      service.key === 'frontend'
        ? { attempts: 3, timeoutMs: 5000, retryDelayMs: 500 }
        : { attempts: 1, timeoutMs: 1500, retryDelayMs: 0 };
    const [portStatus, httpStatus] = await Promise.all([
      this.checkTcpPort(service.port),
      isNodeRuntimeAgentS
        ? Promise.resolve({
            ok: true,
            message: 'Agent-S API 由 3011 进程内 Node Runtime 提供',
          })
        : this.checkHttpUrl(service.url, httpProbeOptions),
    ]);
    const agentSHealth = isNodeRuntimeAgentS
      ? await this.nodeAgentRuntime?.health()
      : null;
    const nodeRuntimeMissing = isNodeRuntimeAgentS && !this.nodeAgentRuntime;
    const online =
      !nodeRuntimeMissing &&
      portStatus.open &&
      httpStatus.ok &&
      (isNodeRuntimeAgentS ? agentSHealth?.ok === true : true);
    const managedByScreen = screenSessions.has(service.screenSession);
    const logExists = existsSync(service.logPath);

    return {
      ...service,
      online,
      managedByScreen,
      logExists,
      pid: portStatus.pid,
      message: online
        ? `${service.name} 在线${managedByScreen ? '，由 screen 托管' : '，但未检测到托管会话'}`
        : nodeRuntimeMissing
          ? `${service.name} 阻断：NodeAgentRuntimeService 未注入`
          : agentSHealth && !agentSHealth.ok
            ? `${service.name} 阻断：${agentSHealth.reasons?.[0] || agentSHealth.blockers?.[0] || agentSHealth.status}`
            : `${service.name} 不可用：${httpStatus.message || portStatus.message}`,
    };
  }

  private async readManagedScreenSessions(logDir: string) {
    const sessions = new Set<string>();
    await Promise.all(
      [
        ['frontend-3010.pid', 'ai-content-frontend'],
        ['backend-3011.pid', 'ai-content-backend'],
        ['agent-s-17777.pid', 'agent-s'],
      ].map(async ([filename, expectedSession]) => {
        try {
          const content = await readFile(join(logDir, filename), 'utf8');
          if (content.includes(expectedSession)) {
            sessions.add(expectedSession);
          }
        } catch {
          // Missing pid marker means the service may still be running, but not through our script.
        }
      }),
    );

    return sessions;
  }

  private checkTcpPort(port: number) {
    return new Promise<{ open: boolean; message: string; pid?: number | null }>(
      (resolveResult) => {
        const socket = net.createConnection({
          host: '127.0.0.1',
          port,
          timeout: 800,
        });
        socket.once('connect', () => {
          socket.destroy();
          resolveResult({
            open: true,
            message: `端口 ${port} 可连接`,
            pid: null,
          });
        });
        socket.once('timeout', () => {
          socket.destroy();
          resolveResult({
            open: false,
            message: `端口 ${port} 连接超时`,
            pid: null,
          });
        });
        socket.once('error', (error) => {
          resolveResult({ open: false, message: error.message, pid: null });
        });
      },
    );
  }

  private async checkHttpUrl(
    url: string,
    options?: { attempts?: number; timeoutMs?: number; retryDelayMs?: number },
  ) {
    const attempts = Math.max(1, options?.attempts ?? 1);
    const timeoutMs = Math.max(1, options?.timeoutMs ?? 1500);
    const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);
    let lastMessage = 'HTTP 请求失败';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        // 17777 (Agent-S) 的 /healthz 需要带 x-kaypal-agent-s-token
        // 8001 已下线；其他 (frontend/backend) 用 Accept-only
        const headers: Record<string, string> = {
          Accept: 'application/json,text/html,*/*',
        };
        if (
          url.includes('127.0.0.1:17777') ||
          url.includes('localhost:17777')
        ) {
          const token =
            this.configService?.get<string>('KAYPAL_AGENT_S_TOKEN') || '';
          if (token) {
            headers['x-kaypal-agent-s-token'] = token;
          }
        }
        const response = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });

        return {
          ok: response.ok,
          message: response.ok ? 'HTTP 可访问' : `HTTP ${response.status}`,
        };
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : 'HTTP 请求失败';
        if (attempt < attempts && retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    return {
      ok: false,
      message: lastMessage,
    };
  }

  async getBrowserStatus(): Promise<LocalEngineBrowserStatus> {
    const checkedAt = new Date().toISOString();
    const health = await this.autoUploadService.getHealth().catch((error) => ({
      online: false,
      service: 'ai-content local browser runtime',
      version: 'unknown',
      message: error instanceof Error ? error.message : 'HTTP 请求失败',
    }));
    try {
      const accounts = await this.autoUploadService.listAccounts({
        validate: true,
        force: true,
      });
      const cdpSessions = await this.autoUploadService
        .getCdpSessions()
        .catch(() => null);
      const sessionByAccount = new Map(
        (cdpSessions?.sessions || []).map((session) => [
          `${session.platform}:${String(session.accountId)}`,
          session,
        ]),
      );
      const mappedAccounts = accounts.map((account) => {
        const platformKey = this.resolveBrowserSessionPlatformKey(
          account.platform,
          account.type,
        );
        const session = sessionByAccount.get(
          `${platformKey}:${String(account.id)}`,
        );
        const sessionStatus = session?.status;
        const status:
          'ready' | 'expired' | 'needs_login' | 'blocked' | 'unverified' =
          sessionStatus === 'ready'
            ? 'ready'
            : sessionStatus === 'needs_login' ||
                sessionStatus === 'blocked' ||
                sessionStatus === 'stopped'
              ? sessionStatus === 'stopped'
                ? 'blocked'
                : sessionStatus
              : account.status === 1
                ? 'unverified'
                : 'expired';
        const statusLabel =
          status === 'ready'
            ? '已登录'
            : status === 'needs_login'
              ? '需要重新登录'
              : status === 'blocked'
                ? '浏览器阻断'
                : status === 'unverified'
                  ? '待确认登录'
                  : account.statusLabel;
        return {
          id: account.id,
          platform: account.platform,
          type: account.type,
          displayName:
            account.profileName || account.userName || `账号 ${account.id}`,
          status,
          statusLabel,
          filePath: account.filePath,
          avatarUrl: account.avatarUrl,
          currentUrl: session?.currentUrl ?? null,
          lastError: session?.lastError ?? null,
          nextAction:
            status === 'needs_login'
              ? `请在已打开的 ${account.platform} 后台重新登录。`
              : status === 'blocked'
                ? session?.lastError || '请先恢复本地浏览器 Runtime。'
                : status === 'unverified'
                  ? `请打开 ${account.platform} 后台，等待页面进入平台管理后台后刷新。`
                  : undefined,
        };
      });

      return {
        checkedAt,
        engineOnline: health.online,
        engineMessage: `${health.service} ${health.version} 在线`,
        totalAccounts: mappedAccounts.length,
        readyAccounts: mappedAccounts.filter(
          (account) => account.status === 'ready',
        ).length,
        expiredAccounts: mappedAccounts.filter(
          (account) => account.status === 'expired',
        ).length,
        accounts: mappedAccounts,
        recovery: {
          waitingTasks: 0,
          resumableTasks: 0,
          nextAction: mappedAccounts.some(
            (account) => account.status === 'expired',
          )
            ? '存在失效账号，请到平台账号页重新登录后恢复阻断任务。'
            : mappedAccounts.some((account) => account.status === 'needs_login')
              ? '存在需要重新登录的平台账号，请在已打开的平台后台完成登录后刷新。'
              : mappedAccounts.some((account) => account.status === 'blocked')
                ? '存在浏览器阻断账号，请先恢复本地浏览器 Runtime。'
                : mappedAccounts.some(
                      (account) => account.status === 'unverified',
                    )
                  ? '存在待确认登录的平台账号，请先打开平台后台确认登录态。'
                  : '账号状态正常。',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const tableMissing = this.isPrismaTableMissingError(
        error,
        'publish_accounts',
      );
      return {
        checkedAt,
        engineOnline: Boolean(health.online),
        engineMessage: health.online
          ? tableMissing
            ? `${health.service} ${health.version} 在线；平台账号表正在自修复，当前微信本机任务不依赖该表。`
            : `${health.service} ${health.version} 在线；平台账号读取失败：${message}`
          : `浏览器控制不可用：${'message' in health ? health.message : message}`,
        totalAccounts: 0,
        readyAccounts: 0,
        expiredAccounts: 0,
        accounts: [],
        recovery: {
          waitingTasks: 0,
          resumableTasks: 0,
          nextAction: health.online
            ? tableMissing
              ? '本机数据库会在下次启动自动补齐 publish_accounts；抖音/小红书/视频号任务需要平台账号，微信桌面任务可继续。'
              : '检查平台账号表、CDP 会话和发布账号登录态；微信桌面任务不依赖平台账号。'
            : '先启动发布服务 本地浏览器引擎，再刷新账号状态。',
        },
      };
    }
  }

  private resolveBrowserSessionPlatformKey(
    platformName: string,
    platformType: number,
  ) {
    if (platformType === 2) return 'wechat-channel';
    if (platformType === 3) return 'douyin';
    if (platformType === 4) return 'kuaishou';
    if (platformType === 1) return 'xiaohongshu';
    if (platformType === 5) return 'bilibili';
    if (platformName === '视频号') return 'wechat-channel';
    if (platformName === '抖音') return 'douyin';
    if (platformName === '快手') return 'kuaishou';
    if (platformName === '小红书') return 'xiaohongshu';
    if (platformName === 'B站') return 'bilibili';
    return platformName;
  }

  private checkRequiredPlatformAccounts(
    browserStatus: LocalEngineBrowserStatus,
    capabilities: LocalEngineCapability[] = [],
  ) {
    const executorCapability = capabilities.find(
      (capability) => capability.key === 'interaction-capabilities',
    );
    const readyExecutorText =
      executorCapability?.checks?.find((check) => check.name === '就绪率')
        ?.message || '';
    const requiredPlatforms = [
      {
        key: 'douyin',
        label: '抖音',
        executorKeys: ['douyin-comment-reply', 'douyin-direct-message-reply'],
      },
      {
        key: 'wechat-channel',
        label: '视频号',
        executorKeys: [
          'wechat-channel-comment-reply',
          'wechat-channel-direct-message-reply',
        ],
      },
    ];
    const missing = requiredPlatforms.filter(
      (platform) =>
        !browserStatus.accounts.some(
          (account) =>
            this.resolveBrowserSessionPlatformKey(
              account.platform,
              account.type,
            ) === platform.key && account.status === 'ready',
        ) &&
        !platform.executorKeys.every((executorKey) =>
          readyExecutorText.includes(executorKey),
        ),
    );
    if (!missing.length) {
      return {
        ready: true,
        message: '抖音和视频号账号均有可用登录态。',
        nextAction: '',
      };
    }
    return {
      ready: false,
      message: `缺少可用的必需平台账号：${missing
        .map((platform) => platform.label)
        .join('、')}。`,
      nextAction:
        '请到发布中心的平台账号页重新登录或校验抖音、视频号账号状态。',
    };
  }

  private isWechatReadinessSessionLocked(
    capabilities: LocalEngineCapability[] = [],
  ) {
    const interactionCapability = capabilities.find(
      (capability) => capability.key === 'interaction-capabilities',
    );
    const readyText =
      interactionCapability?.checks?.find((check) => check.name === '就绪率')
        ?.message || '';
    const wechatExecutorReady = [
      'wechat-reply-draft',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ].every((executorKey) => readyText.includes(executorKey));
    return (
      wechatExecutorReady &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt
    );
  }

  async getExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    return this.getCachedExecutorsStatus();
  }

  private getRequiredInteractionExecutorIdsForCurrentHost(): string[] {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return this.requiredInteractionExecutorIds;
    }
    return [...BROWSER_INTERACTION_EXECUTOR_IDS];
  }

  private getUnsupportedInteractionExecutorIdsForCurrentHost(): string[] {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      return [];
    }
    return [...DESKTOP_WECHAT_INTERACTION_EXECUTOR_IDS];
  }

  private async getCachedExecutorsStatus(
    ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
  ): Promise<LocalEngineExecutorsStatus> {
    const now = Date.now();
    if (
      this.executorsStatusCache &&
      this.executorsStatusCache.expiresAt > now
    ) {
      return this.executorsStatusCache.value;
    }

    const value = await this.loadExecutorsStatus();
    this.executorsStatusCache = {
      value,
      expiresAt: now + ttlMs,
    };
    return value;
  }

  /**
   * 共享：从 RuntimeOrchestrator + 平台 sub-services 拉真 capability 状态
   * 同时被 getExecutorsStatus (GET /executors/status) 和
   *      assertCreateExecutionPreflight (创建任务时的预检) 使用
   * 避免之前 P3-D4 placeholder 写死空数组导致 capability 永远 undefined
   */
  private async loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    let healths: Array<{ id: string; ok: boolean; details?: string }>;
    try {
      healths = (await this.runtimeOrchestrator?.healthCheck()) ?? [
        { id: 'agent-s', ok: false, details: 'RuntimeOrchestrator 未注入' },
        {
          id: 'local-runtime',
          ok: false,
          details: 'RuntimeOrchestrator 未注入',
        },
      ];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      healths = [
        {
          id: 'agent-s',
          ok: false,
          details: `浏览器平台能力读取失败：${message}`,
        },
        {
          id: 'local-runtime',
          ok: false,
          details: `浏览器平台能力读取失败：${message}`,
        },
      ];
    }

    const runtimeExecutors: LocalEngineExecutorCapability[] = healths.map((h) =>
      this.mapRuntimeHealthToExecutorCapability(h),
    );
    const desktopExecutors = await this.loadWechatDesktopExecutorCapabilities();
    const executors = this.mergeExecutorCapabilities([
      ...runtimeExecutors,
      ...desktopExecutors,
    ]);
    const requiredExecutorIds =
      this.getRequiredInteractionExecutorIdsForCurrentHost();
    const interactionExecutors = executors.filter((executor) =>
      requiredExecutorIds.includes(String(executor.key)),
    );

    return {
      checkedAt: new Date().toISOString(),
      summary: {
        total: interactionExecutors.length,
        ready: interactionExecutors.filter((e) => e.status === 'ready').length,
        preflightOnly: interactionExecutors.filter(
          (e) => e.status === 'preflight_only',
        ).length,
        missing: interactionExecutors.filter((e) => e.status === 'missing')
          .length,
      },
      executors,
    };
  }

  private mergeExecutorCapabilities(
    executors: LocalEngineExecutorCapability[],
  ): LocalEngineExecutorCapability[] {
    const merged = new Map<string, LocalEngineExecutorCapability>();
    for (const executor of executors) {
      merged.set(String(executor.key), executor);
    }
    return Array.from(merged.values());
  }

  private async loadWechatDesktopExecutorCapabilities(): Promise<
    LocalEngineExecutorCapability[]
  > {
    const checkedAt = new Date().toISOString();
    const desktop = await this.readDesktopStatusForExecutorList(checkedAt);
    return this.buildWechatDesktopExecutorCapabilities(desktop);
  }

  private async readDesktopStatusForExecutorList(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus> {
    const now = Date.now();
    if (
      this.desktopStatusWithEvidenceCache &&
      this.desktopStatusWithEvidenceCache.expiresAt > now
    ) {
      return {
        ...this.desktopStatusWithEvidenceCache.value,
        checkedAt,
      };
    }

    const desktop = await this.readWechatDesktopStatus();
    return this.buildDesktopStatus(desktop, checkedAt);
  }

  private buildWechatDesktopExecutorCapabilities(
    desktop: LocalEngineDesktopStatus,
  ): LocalEngineExecutorCapability[] {
    const runnable = this.isDesktopWechatRuntimeRunnable(desktop);
    const status: LocalEngineExecutorCapability['status'] =
      this.isDesktopWechatExecutionReady(desktop) || runnable
        ? 'ready'
        : desktop.running
          ? 'preflight_only'
          : 'missing';
    const ready = status === 'ready';
    const message = ready
      ? '桌面微信、执行脚本、截图、输入、点击和自动发送能力可用。'
      : desktop.blockers[0] || desktop.message || '桌面微信不可用。';
    const nextAction = ready
      ? '可创建微信任务；auto-send 会调用本机微信脚本执行并保存证据。'
      : desktop.nextAction ||
        '请打开桌面微信并确认本机微信脚本、辅助功能和屏幕录制权限可用。';
    const definitions: Array<{ key: InteractionTaskType; name: string }> = [
      { key: 'wechat-reply-draft', name: '微信会话回复' },
      { key: 'wechat-friend-accept', name: '通过好友' },
      { key: 'wechat-group-broadcast', name: '微信群发' },
      { key: 'wechat-contact-add', name: '自动加好友' },
      { key: 'wechat-moments-publish', name: '朋友圈发布' },
      { key: 'wechat-moments-marketing', name: '朋友圈运营' },
    ];

    return definitions.map((definition) => ({
      key: definition.key,
      name: definition.name,
      platformName: '桌面微信',
      status,
      entryPreflight: ready,
      targetRead: ready,
      replyGenerate: ready,
      controlledSend: ready,
      autoSend: ready,
      message,
      nextAction,
    }));
  }

  private mapRuntimeHealthToExecutorCapability(h: {
    id: string;
    ok: boolean;
    details?: string;
  }): LocalEngineExecutorCapability {
    if (h.id === 'agent-s' && this.useNodeAgentRuntime()) {
      return {
        key: 'agent-s-legacy-desktop',
        name: '旧 Agent-S 桌面执行器',
        platformName: '微信桌面',
        status: 'optional',
        entryPreflight: false,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message: h.ok
          ? `${h.details ?? 'Node Runtime Agent-S 在线'}。旧 17777 桌面 sidecar 不再作为微信任务入口。`
          : `旧 Python/桌面 Agent-S 未运行：${h.details || '未返回详情'}。当前微信桌面任务走本机 Node Runtime 和 SkillHub 脚本。`,
        nextAction: h.ok
          ? '以微信完整执行链和具体任务状态判断是否可用。'
          : '无需启动 17777；请以微信完整执行链的进程、权限、脚本和确认后执行检查为准。',
      };
    }
    if (h.id === 'local-runtime') {
      return {
        key: 'local-runtime',
        name: '本地互动编排器',
        platformName: '3011 Runtime',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '本地互动编排器在线。' : '本地互动编排器不可用。'),
        nextAction: h.ok
          ? '客户互动是否可用以四条平台执行器为准。'
          : '检查 RuntimeOrchestrator 与 LocalRuntimeClient 装配。',
      };
    }
    if (h.id === 'platform-publish') {
      return {
        key: 'platform-publish',
        name: '内容发布执行器',
        platformName: '发布中心',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: false,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '内容发布执行器在线。' : '内容发布执行器不可用。'),
        nextAction: h.ok
          ? '内容发布能力单独验收，不计入客户互动四条链路。'
          : '检查 PlatformPublishService 健康状态。',
      };
    }
    if (h.id === 'video-template-clip') {
      return {
        key: 'video-template-clip',
        name: '视频剪辑执行器',
        platformName: '视频工坊',
        status: h.ok ? 'optional' : 'missing',
        entryPreflight: h.ok,
        targetRead: h.ok,
        replyGenerate: false,
        controlledSend: false,
        autoSend: false,
        message:
          h.details ??
          (h.ok ? '视频剪辑执行器在线。' : '视频剪辑执行器不可用。'),
        nextAction: h.ok
          ? '可以从 AI 员工创建视频剪辑任务，成功结果会进入聚合发布素材。'
          : '检查本机 ffmpeg 是否可用。',
      };
    }
    if (h.id === 'video-face-swap') {
      return {
        key: 'video-face-swap',
        name: '视频换脸执行器',
        platformName: '视频工坊',
        status: 'optional',
        entryPreflight: h.ok,
        targetRead: h.ok,
        replyGenerate: h.ok,
        controlledSend: false,
        autoSend: false,
        message: h.ok
          ? (h.details ?? '视频换脸引擎在线。')
          : '视频换脸引擎尚未安装；只影响视频换脸页面，不影响常规内容创作、发布和客户互动。',
        nextAction: h.ok
          ? '进入视频换脸页面时会继续检查素材授权、生成环境和计费。'
          : '需要使用视频换脸时，在视频换脸页面完成 FaceFusion 安装；不使用时无需处理。',
      };
    }

    const status: LocalEngineExecutorCapability['status'] = h.ok
      ? 'ready'
      : h.id === 'agent-s'
        ? 'missing'
        : 'missing';

    return {
      key: h.id as InteractionTaskType,
      name: h.id,
      platformName: h.id === 'agent-s' ? '微信桌面' : '浏览器 CDP',
      status,
      entryPreflight: h.ok,
      targetRead: h.ok,
      replyGenerate: h.ok,
      controlledSend: h.ok,
      autoSend: h.ok,
      message: h.details ?? (h.ok ? '执行器就绪' : '执行器未就绪'),
      nextAction: h.ok
        ? '可以开始执行互动任务。'
        : '请检查 RuntimeOrchestrator.healthCheck() 返回的 details。',
    };
  }

  async getDesktopStatus(): Promise<LocalEngineDesktopStatus> {
    const checkedAt = new Date().toISOString();
    return this.readDesktopStatusWithEvidence(checkedAt);
  }

  private async readDesktopStatusWithEvidenceCached(
    checkedAt: string,
    ttlMs = LOCAL_ENGINE_STATUS_CACHE_TTL_MS,
  ): Promise<LocalEngineDesktopStatus> {
    const now = Date.now();
    if (
      this.desktopStatusWithEvidenceCache &&
      this.desktopStatusWithEvidenceCache.expiresAt > now
    ) {
      return {
        ...this.desktopStatusWithEvidenceCache.value,
        checkedAt,
      };
    }

    const value = await this.readDesktopStatusWithEvidence(checkedAt);
    this.desktopStatusWithEvidenceCache = {
      value,
      expiresAt: now + ttlMs,
    };
    return value;
  }

  private async readDesktopStatusWithEvidence(
    checkedAt: string,
  ): Promise<LocalEngineDesktopStatus> {
    const desktop = await this.readWechatDesktopStatus();
    const screenshot = await this.captureDesktopScreenshot(
      '桌面微信窗口状态截图',
    ).catch((error) => ({
      type: 'text' as const,
      label: '桌面截图不可用',
      value: error instanceof Error ? error.message : '桌面截图失败',
      capturedAt: checkedAt,
      trusted: false,
      diagnostic: error instanceof Error ? error.message : '桌面截图失败',
    }));
    if (screenshot) {
      this.rememberDesktopEvidence(screenshot);
    }

    return this.buildDesktopStatus(desktop, checkedAt, screenshot);
  }

  async getDesktopCommercialPreflight(): Promise<LocalEngineDesktopCommercialPreflight> {
    const desktop = await this.getDesktopStatus();
    return this.buildDesktopCommercialPreflight(desktop);
  }

  async getWechatSessionStatus(): Promise<LocalEngineWechatSessionStatus> {
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

  async confirmWechatSession(
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

  async alignWechatSession(
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

  async takeoverWechatSession(
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
      operator:
        input.operator?.trim() || this.wechatSessionConfirmation.operator,
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

  async stopWechatSession(
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
      operator:
        input.operator?.trim() || this.wechatSessionConfirmation.operator,
      updatedAt: now,
    };
    this.rememberDesktopEvidence({
      type: 'text',
      label: '微信会话停止',
      value:
        this.wechatSessionConfirmation.stopReason || '用户停止微信桌面会话',
      capturedAt: now,
    });
    return this.getWechatSessionStatus();
  }

  async getFileAccessStatus(): Promise<LocalEngineFileAccessStatus> {
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

  async getReplyRule(): Promise<InteractionReplyRuleConfig> {
    await this.ensureTaskStore();
    return this.loadReplyRuleFromStore();
  }

  async listReplyBots(): Promise<CustomerServiceReplyBot[]> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    await this.loadReplyRuleFromStore(scope);

    const rows = await this.runPrismaTransientRetry(
      'list customer service bots',
      () =>
        this.prisma.interactionReplyRule.findMany({
          where: scope,
          orderBy: { updatedAt: 'desc' },
        }),
    );
    return rows.map((row) => this.toCustomerServiceReplyBot(row));
  }

  async getReplyBot(id: string): Promise<CustomerServiceReplyBot> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    const safeId = this.optionalTrimmedText(id);
    if (!safeId) {
      throw new BadRequestException('请选择客服机器人。');
    }
    if (safeId === 'default') {
      await this.loadReplyRuleFromStore(scope);
    }
    let row = await this.prisma.interactionReplyRule.findFirst({
      where: {
        ...scope,
        ...(safeId === 'default' ? { botKey: 'default' } : { id: safeId }),
      },
    });
    if (!row && safeId === 'default') {
      await this.persistReplyRule(this.createDefaultReplyRule(), scope);
      row = await this.prisma.interactionReplyRule.findFirst({
        where: { ...scope, botKey: 'default' },
      });
    }
    if (!row) {
      throw new NotFoundException('客服机器人不存在或已被删除。');
    }
    return this.toCustomerServiceReplyBot(row);
  }

  async createReplyBot(
    input: UpdateInteractionReplyRuleInput = {},
  ): Promise<CustomerServiceReplyBot> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    const base = this.createDefaultReplyRule();
    const config = this.normalizeCustomerServiceRule(input, base);
    config.configVersion = 1;
    config.revision = 1;
    config.botName =
      this.optionalTrimmedText(input.botName) ||
      (config.botType === 'advisor' ? '顾问型客服机器人' : '销售顾问机器人');
    const id = this.createId();
    const now = new Date();
    const row = await this.prisma.interactionReplyRule.create({
      data: {
        id,
        ...scope,
        botKey: id,
        configVersion: config.configVersion,
        revision: config.revision,
        name: config.botName,
        industry: config.industryName,
        tone: config.tone,
        sendMode: config.defaultSendMode,
        keywords: config.requireApprovalKeywords,
        forbiddenWords: config.blockedKeywords,
        highlights: config.serviceHighlights,
        closingText: config.closingText,
        ruleJson: config as unknown as Prisma.InputJsonValue,
        escalationRules: config as unknown as Prisma.InputJsonValue,
        enabled: true,
        updatedAt: now,
      },
    });
    return this.toCustomerServiceReplyBot(row);
  }

  async updateReplyBot(
    id: string,
    input: UpdateInteractionReplyRuleInput,
  ): Promise<CustomerServiceReplyBot> {
    const scope = await this.resolveTenantScope();
    const current = await this.getReplyBot(id);
    if (
      input.expectedRevision !== undefined &&
      (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
    ) {
      throw new BadRequestException('机器人修订号必须是正整数。');
    }
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== current.revision
    ) {
      throw new ConflictException('机器人配置已更新，请刷新后重试。');
    }
    const config = this.normalizeCustomerServiceRule(input, current.config);
    config.configVersion = current.configVersion;
    config.revision = current.revision + 1;
    const updated = await this.prisma.interactionReplyRule.updateMany({
      where: { id: current.id, ...scope, revision: current.revision },
      data: {
        name: config.botName || current.name,
        industry: config.industryName,
        tone: config.tone,
        sendMode: config.defaultSendMode,
        keywords: config.requireApprovalKeywords,
        forbiddenWords: config.blockedKeywords,
        highlights: config.serviceHighlights,
        closingText: config.closingText,
        ruleJson: config as unknown as Prisma.InputJsonValue,
        escalationRules: config as unknown as Prisma.InputJsonValue,
        configVersion: config.configVersion,
        revision: config.revision,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('机器人配置已更新，请刷新后重试。');
    }
    const row = await this.prisma.interactionReplyRule.findFirst({
      where: { id: current.id, ...scope },
    });
    if (!row) {
      throw new NotFoundException('客服机器人不存在或已被删除。');
    }
    if (row.botKey === 'default') {
      this.replyRules.set(this.tenantScopeKey(scope), config);
    }
    return this.toCustomerServiceReplyBot(row);
  }

  async setReplyBotEnabled(
    id: string,
    enabled: boolean,
    expectedRevision?: number,
  ): Promise<CustomerServiceReplyBot> {
    const scope = await this.resolveTenantScope();
    const current = await this.getReplyBot(id);
    if (
      expectedRevision !== undefined &&
      (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    ) {
      throw new BadRequestException('机器人修订号必须是正整数。');
    }
    if (
      expectedRevision !== undefined &&
      expectedRevision !== current.revision
    ) {
      throw new ConflictException('机器人配置已更新，请刷新后重试。');
    }
    const revision = current.revision + 1;
    const config = {
      ...current.config,
      revision,
      updatedAt: new Date().toISOString(),
    };
    const updated = await this.prisma.interactionReplyRule.updateMany({
      where: { id: current.id, ...scope, revision: current.revision },
      data: {
        enabled,
        revision,
        ruleJson: config as unknown as Prisma.InputJsonValue,
        escalationRules: config as unknown as Prisma.InputJsonValue,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('机器人配置已更新，请刷新后重试。');
    }
    const row = await this.prisma.interactionReplyRule.findFirst({
      where: { id: current.id, ...scope },
    });
    if (!row) {
      throw new NotFoundException('客服机器人不存在或已被删除。');
    }
    if (row.botKey === 'default') {
      this.replyRules.set(this.tenantScopeKey(scope), config);
    }
    return this.toCustomerServiceReplyBot(row);
  }

  async createCustomerServiceReplyTask(
    botId: string,
    input: CreateCustomerServiceReplyTaskInput,
  ): Promise<InteractionTask> {
    const bot = await this.getReplyBot(botId);
    const callerCommercialAllowed = this.currentActorCommercialAllowed();
    if (!bot.enabled) {
      throw new BadRequestException('该机器人已停用，请启用后再创建回复任务。');
    }
    const accountName = this.optionalTrimmedText(input.accountName);
    if (!accountName) {
      throw new BadRequestException('请选择承接账号。');
    }
    const authorizedAccounts = this.normalizeStringList(
      bot.config.authorizedAccounts,
      [],
    );
    if (
      authorizedAccounts.length > 0 &&
      !authorizedAccounts.some(
        (account) =>
          account.trim().toLocaleLowerCase() ===
          accountName.toLocaleLowerCase(),
      )
    ) {
      throw new BadRequestException(
        '该账号未绑定到当前机器人，请先在机器人配置中添加。',
      );
    }

    const platform = this.resolveCustomerServicePlatform(
      bot.config,
      input.platform,
      accountName,
    );
    const sourceText = this.optionalTrimmedText(input.sourceText);
    if (!sourceText) {
      throw new BadRequestException('请输入客户问题后再创建回复任务。');
    }
    const replyText =
      this.optionalTrimmedText(input.replyText) ||
      this.buildReplyFromRule(sourceText, { accountName }, bot.config);
    const knowledge = await this.resolveCustomerServiceKnowledge(bot.config);
    const decision = this.evaluateCustomerServiceReplyDecision(bot.config, {
      sourceText,
      replyText,
      targetName: input.targetName,
      accountName,
      platform,
      contactLabels: input.contactLabels,
      requestedSendMode: input.sendMode,
      commercialExecutionAllowed:
        callerCommercialAllowed || this.allowLocalPlanBypass(),
      knowledge,
    });
    const sendMode = decision.sendMode;
    const type: InteractionTaskType =
      platform === 'wechat'
        ? 'wechat-reply-draft'
        : 'douyin-direct-message-reply';
    return this.createTask({
      type,
      replyBotId: bot.id,
      accountId: input.accountId,
      accountName,
      platformName: platform === 'wechat' ? '微信' : '抖音',
      targetName: this.optionalTrimmedText(input.targetName) || '未命名客户',
      sourceText,
      replyText:
        decision.action === 'no-reply'
          ? '按当前客服规则转人工处理，不自动回复。'
          : replyText,
      replyGeneratedBy: input.replyGeneratedBy,
      sendMode,
      planStatus: decision.action === 'no-reply' ? 'draft' : undefined,
      commercialExecutionRequested:
        decision.action !== 'no-reply' &&
        input.commercialExecutionRequested !== false,
      callerCommercialAllowed,
      metadata: {
        customerServiceBotId: bot.id,
        customerServiceBotName: bot.name,
        customerServicePlatform: platform,
        knowledgeScope: bot.config.knowledgeScope,
        selectedKnowledgeId: bot.config.selectedKnowledgeId,
        contactScope: bot.config.contactScope,
        contactLabels: input.contactLabels || [],
        customerServiceDecision: decision,
        customerServiceDelaySeconds: decision.delay.selectedSeconds,
        customerServiceNotBefore: decision.delay.notBefore,
        customerServiceNoReply: decision.action === 'no-reply',
        customerServiceFileRequest: decision.fileRequest,
      },
    });
  }

  async updateReplyRule(
    input: UpdateInteractionReplyRuleInput,
  ): Promise<InteractionReplyRuleConfig> {
    return (await this.updateReplyBot('default', input)).config;
  }

  async generateInteractionReply(input: {
    sourceText?: string;
    targetName?: string;
    accountName?: string;
    botId?: string;
    platform?: CustomerServiceReplyPlatform;
    contactLabels?: string[];
  }): Promise<{
    replyText: string;
    generatedBy: 'ai' | 'fallback';
    rule: InteractionReplyRuleConfig;
    decision: CustomerServiceReplyDecision;
  }> {
    await this.ensureTaskStore();
    const defaultRule = await this.loadReplyRuleFromStore();

    const sourceText = input.sourceText?.trim();
    if (!sourceText) {
      throw new BadRequestException(
        '缺少客户原话或待跟进内容，不能生成商用回复。',
      );
    }

    const bot = input.botId ? await this.getReplyBot(input.botId) : undefined;
    if (bot && !bot.enabled) {
      throw new BadRequestException('该机器人已停用，请启用后再生成回复。');
    }
    const rule = bot?.config || defaultRule;
    const knowledge = await this.resolveCustomerServiceKnowledge(rule);
    const decisionInput = {
      sourceText,
      targetName: input.targetName,
      accountName: input.accountName,
      platform: input.platform,
      contactLabels: input.contactLabels,
      commercialExecutionAllowed:
        this.currentActorCommercialAllowed() || this.allowLocalPlanBypass(),
      knowledge,
    };
    const beforeGeneration = this.evaluateCustomerServiceReplyDecision(
      rule,
      decisionInput,
    );
    if (!beforeGeneration.canGenerate) {
      return {
        replyText: '',
        generatedBy: 'fallback',
        rule,
        decision: beforeGeneration,
      };
    }
    const fallbackReply = this.buildReplyFromRule(
      sourceText,
      {
        targetName: input.targetName,
        accountName: input.accountName,
      },
      rule,
    );

    const aiReply = await this.tryGenerateInteractionReplyWithAi(
      sourceText,
      {
        targetName: input.targetName,
        accountName: input.accountName,
        fallbackReply,
      },
      rule,
      knowledge,
    );
    const replyText = aiReply || fallbackReply;
    const decision = this.evaluateCustomerServiceReplyDecision(rule, {
      ...decisionInput,
      replyText,
    });
    if (aiReply) {
      return {
        replyText: decision.action === 'no-reply' ? '' : aiReply,
        generatedBy: 'ai',
        rule,
        decision,
      };
    }

    return {
      replyText: decision.action === 'no-reply' ? '' : fallbackReply,
      generatedBy: 'fallback',
      rule,
      decision,
    };
  }

  async listTasks(
    limit = 50,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionTask[]> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(limit, filter);
    const mergedTasks = await this.mergeTaskSummaries(storedTasks, filter);

    return mergedTasks
      .filter((task) => !filter.type || task.type === filter.type)
      .filter((task) => !filter.status || task.status === filter.status)
      .filter(
        (task) =>
          !filter.recordsOnly ||
          ['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
            task.status,
          ),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => this.normalizeTaskForDisplay(task));
  }

  async listAutomationTasks(
    limit = 80,
    filter: { status?: string } = {},
  ): Promise<AutomationTaskView[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const [tasks, sessions] = await Promise.all([
      this.listTasks(Math.max(safeLimit, 100)),
      this.listAgentSessions(Math.max(safeLimit, 100)),
    ]);
    const items = [
      ...tasks.map((task) => this.toAutomationTaskView(task)),
      ...sessions.map((session) => this.toAutomationTaskView(session)),
    ]
      .filter((item) => !filter.status || item.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    return items.slice(0, safeLimit);
  }

  async getAutomationTask(id: string): Promise<AutomationTaskView> {
    const safeId = String(id || '').trim();
    if (!safeId) {
      throw new BadRequestException('缺少任务记录 ID');
    }

    if (safeId.startsWith('agent-session:')) {
      return this.toAutomationTaskView(
        await this.getAgentSession(safeId.slice('agent-session:'.length)),
      );
    }
    if (safeId.startsWith('interaction-task:')) {
      return this.toAutomationTaskView(
        await this.getTask(safeId.slice('interaction-task:'.length)),
      );
    }

    try {
      return this.toAutomationTaskView(await this.getTask(safeId));
    } catch (taskError) {
      try {
        return this.toAutomationTaskView(await this.getAgentSession(safeId));
      } catch {
        throw taskError;
      }
    }
  }

  private toAutomationTaskView(
    item: InteractionTask | AgentSession,
  ): AutomationTaskView {
    if ('type' in item) {
      const status = this.mapInteractionTaskToAutomationStatus(item.status);
      const metadata = item.metadata || {};
      const runtimeExecutionId = this.readMetadataText(metadata, [
        'runtimeExecutionId',
        'runtime_execution_id',
      ]);
      return {
        id: `interaction-task:${item.id}`,
        source: 'interaction-task',
        taskType: item.type,
        title: item.planName || item.typeLabel || '互动任务',
        status,
        statusLabel: this.automationStatusLabel(status),
        executionMode:
          item.executionMode === 'browser-assisted' ? 'real' : 'configuration',
        riskLevel: item.riskLevel || 'medium',
        currentStep: item.diagnostics?.currentStep,
        nextAction: item.nextAction || item.diagnostics?.nextAction,
        failureReason: item.failureReason || item.diagnostics?.failureReason,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        evidenceCount:
          (Array.isArray((item as { evidence?: unknown }).evidence)
            ? ((item as { evidence?: unknown }).evidence as unknown[])
                .length
            : 0) ||
          item.diagnostics?.evidenceCount ||
          0,
        confirmationRequired:
          Boolean(item.requiresDoubleConfirmation) ||
          item.status === 'waiting_for_send_confirmation',
        taskId: item.id,
        agentSessionId: this.readMetadataText(metadata, [
          'agentSessionId',
          'agent_session_id',
          'sessionId',
        ]),
        runtimeExecutionId,
        metadata,
      };
    }

    const status = this.mapAgentSessionToAutomationStatus(item.status);
    const executionMode = this.readMetadataText(item.metadata, [
      'executionMode',
      'execution_mode',
    ]);
    return {
      id: `agent-session:${item.id}`,
      source: 'agent-session',
      taskType:
        this.readMetadataText(item.metadata, ['coreTaskType', 'taskType']) ||
        item.source,
      title: item.title || '自动化任务',
      status,
      statusLabel: this.automationStatusLabel(status),
      executionMode:
        executionMode === 'simulated'
          ? 'simulated'
          : status === 'failed'
            ? 'blocked'
            : 'real',
      riskLevel: item.riskLevel,
      currentStep: item.events.at(-1)?.title,
      nextAction: item.nextAction,
      failureReason: item.events.findLast((event) => event.level === 'error')
        ?.message,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      evidenceCount: item.events.filter((event) => Boolean(event.evidence))
        .length,
      confirmationRequired:
        Boolean(item.requiresDoubleConfirmation) ||
        item.status === 'waiting_for_confirmation',
      agentSessionId: item.id,
      metadata: item.metadata,
    };
  }

  private mapInteractionTaskToAutomationStatus(
    status: InteractionTaskStatus,
  ): AutomationTaskViewStatus {
    if (status === 'completed') return 'success';
    if (status === 'waiting_for_send_confirmation')
      return 'waiting_confirmation';
    if (status === 'blocked') return 'failed';
    if (status === 'no_target' || status === 'skipped') return 'cancelled';
    return status;
  }

  private mapAgentSessionToAutomationStatus(
    status: AgentSessionStatus,
  ): AutomationTaskViewStatus {
    if (status === 'completed') return 'success';
    if (status === 'waiting_for_confirmation') return 'waiting_confirmation';
    if (status === 'cancelled') return 'cancelled';
    return status;
  }

  private automationStatusLabel(status: AutomationTaskViewStatus) {
    const labels: Record<AutomationTaskViewStatus, string> = {
      draft: '草稿',
      queued: '排队中',
      running: '运行中',
      waiting_confirmation: '待确认',
      paused: '已暂停',
      partial_failed: '部分失败',
      failed: '失败',
      success: '已完成',
      cancelled: '已取消',
    };
    return labels[status];
  }

  private readMetadataText(
    metadata: Record<string, unknown> | undefined,
    keys: string[],
  ) {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private async listTasksByTypes(
    limit = 50,
    types: InteractionTaskType[],
    filter: Omit<InteractionTaskListFilter, 'type'> = {},
  ): Promise<InteractionTask[]> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      limit,
      filter,
      types,
    );
    const allowedTypes = new Set(types);
    const mergedTasks = await this.mergeTaskSummaries(
      storedTasks,
      filter,
      types,
    );

    return mergedTasks
      .filter((task) => allowedTypes.has(task.type))
      .filter((task) => !filter.status || task.status === filter.status)
      .filter(
        (task) =>
          !filter.recordsOnly ||
          ['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
            task.status,
          ),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((task) => this.normalizeTaskForDisplay(task));
  }

  async listRecords(
    limit = 50,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsResult> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      Math.max(limit, 200),
      {
        ...filter,
        recordsOnly: true,
        status: undefined,
      },
    );

    const mergedTasks = await this.mergeTaskSummaries(storedTasks, {
      ...filter,
      recordsOnly: true,
      status: undefined,
    });
    const baseRecords = mergedTasks
      .filter((task) =>
        ['completed', 'failed', 'skipped', 'no_target'].includes(task.status),
      )
      .filter((task) => !filter.type || task.type === filter.type);
    const filteredRecords = baseRecords
      .filter((task) => !filter.status || task.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);

    return {
      items: filteredRecords.map((task) => this.normalizeTaskForDisplay(task)),
      summary: this.buildRecordsSummary(baseRecords),
    };
  }

  async exportRecords(
    limit = 200,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsExportResult> {
    await this.ensureTaskStore();
    const storedTasks = await this.listStoredTaskSummaries(
      Math.max(limit, 200),
      {
        ...filter,
        recordsOnly: true,
        status: undefined,
      },
    );
    const mergedTasks = await this.mergeTaskSummaries(storedTasks, {
      ...filter,
      recordsOnly: true,
      status: undefined,
    });
    const baseRecords = mergedTasks
      .filter((task) =>
        ['completed', 'failed', 'skipped', 'no_target'].includes(task.status),
      )
      .filter((task) => !filter.type || task.type === filter.type);
    const filteredRecords = baseRecords
      .filter((task) => !filter.status || task.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.min(Math.max(limit, 1), 1000));
    const exportedAt = new Date().toISOString();
    const summary = this.buildRecordsSummary(baseRecords);
    const rows = filteredRecords.flatMap((task) =>
      this.toRecordExportRows(task),
    );
    const headers = [
      '任务ID',
      '状态',
      '类型',
      '平台',
      '账号',
      '批量序号',
      '目标对象',
      '对象状态',
      '失败原因',
      '诊断摘要',
      '下一步',
      '风险等级',
      '风险审计',
      '确认记录',
      '阶段日志',
      '浏览器证据索引',
      '桌面证据索引',
      '文本证据索引',
      '失败证据索引',
      '结果摘要',
      '原始内容',
      '回复内容',
      '证据数',
      '对象证据事件',
      '导出完整性',
      '创建时间',
      '更新时间',
      '完成时间',
    ];

    return {
      filename: `interaction-records-${exportedAt.slice(0, 10)}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: this.toCsv([headers, ...rows]),
      exportedAt,
      exportStatus: filteredRecords.some(
        (task) => this.buildTaskEvidenceIntegrity(task).status === 'FAILED',
      )
        ? 'FAILED'
        : 'OK',
      summary,
    };
  }

  previewEvidenceCleanup(
    retentionDays = 7,
  ): Promise<InteractionEvidenceCleanupResult> {
    return this.autoUploadService.previewInteractionEvidenceCleanup(
      retentionDays,
    );
  }

  async cleanupEvidence(
    retentionDays = 7,
    options: {
      riskConfirmation?: BackendRiskConfirmationInput;
      riskContext?: BackendRiskContext;
    } = {},
  ): Promise<
    InteractionEvidenceCleanupResult & { riskAudit: BackendRiskAuditEvent }
  > {
    const riskAudit = assertBackendRiskGate({
      action: 'local-file-delete',
      target: `interaction-evidence:retentionDays=${retentionDays}`,
      riskLevel: 'high',
      requiresConfirmation: true,
      confirmation: options.riskConfirmation,
      context: options.riskContext,
      reason: '清理互动证据会删除本地截图/日志文件。',
    });
    const result = await this.autoUploadService.cleanupInteractionEvidence(
      retentionDays,
      {
        confirmation: options.riskConfirmation,
        context: options.riskContext,
      },
    );

    return { ...result, riskAudit };
  }

  listBusinessTasks(
    key: InteractionBusinessRouteKey,
    limit = 50,
    options: { recordsOnly?: boolean; status?: InteractionTaskStatus } = {},
  ): Promise<InteractionTask[]> {
    return this.listTasksByTypes(limit, this.resolveBusinessTaskTypes(key), {
      status: options.status,
      recordsOnly: options.recordsOnly,
    });
  }

  async listBusinessRecords(
    key: InteractionBusinessRouteKey,
    limit = 50,
    options: { status?: InteractionTaskStatus } = {},
  ): Promise<InteractionRecordsResult> {
    const records = await this.listTasksByTypes(
      limit,
      this.resolveBusinessTaskTypes(key),
      {
        status: options.status,
        recordsOnly: true,
      },
    );
    return {
      items: records,
      summary: this.buildRecordsSummary(records),
    };
  }
  createBusinessTask(
    key: InteractionBusinessRouteKey,
    input: Omit<CreateInteractionTaskInput, 'type'> &
      Partial<Pick<CreateInteractionTaskInput, 'type'>>,
  ): Promise<InteractionTask> {
    return this.createTask({
      ...input,
      type: this.resolveBusinessTaskType(key, input),
    });
  }

  async getTask(id: string): Promise<InteractionTask> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    const cached = this.tasks.get(id);
    if (!cached || !this.isInTenantScope(cached, scope)) {
      const task = await this.loadStoredTask(id, scope);
      if (task) {
        this.tasks.set(task.id, task);
      }
    }
    const task = this.tasks.get(id);
    if (!task || !this.isInTenantScope(task, scope)) {
      throw new NotFoundException('互动任务不存在');
    }

    return task;
  }

  async getTaskForDisplay(id: string): Promise<InteractionTask> {
    return this.normalizeTaskForDisplay(await this.getTask(id));
  }

  async linkAgentSessionToTask(
    id: string,
    sessionId: string,
  ): Promise<InteractionTask> {
    const safeSessionId = this.optionalTrimmedText(sessionId);
    if (!safeSessionId) {
      throw new BadRequestException('本机助手没有返回会话 ID。');
    }
    const task = await this.getTask(id);
    task.metadata = {
      ...(task.metadata || {}),
      agentSessionId: safeSessionId,
      agent_session_id: safeSessionId,
    };
    task.status = 'running';
    task.statusLabel = this.resolveStatusLabel('running');
    task.runtimeState = 'running';
    if (task.planStatus && task.planStatus !== 'removed') {
      task.planStatus = 'sending';
    }
    task.updatedAt = new Date().toISOString();
    task.nextAction = '本机助手正在执行，收到逐对象结果后更新状态。';
    this.pushEvent(task, 'info', '业务任务已关联本机助手会话。', {
      type: 'stage_log',
      label: '本机执行',
      value: safeSessionId,
      stageKey: 'agent-s-immediate-running',
    });
    await this.persistTask(task);
    await this.prisma.interactionTask.update({
      where: { id: task.id },
      data: {
        sessionId: safeSessionId,
        status: 'RUNNING',
        stage: 'agent-s-immediate-running',
      },
    });
    return this.normalizeTaskForDisplay(task);
  }

  async exportTaskDiagnostics(
    id: string,
  ): Promise<InteractionTaskDiagnosticExportResult> {
    const task = await this.getTask(id);
    const exportedAt = new Date().toISOString();
    await this.ensureTaskEvidenceForExport(task, 'diagnostics-export');
    const evidenceIndex = this.buildTaskEvidenceIndex(task);
    const evidenceIntegrity = this.buildTaskEvidenceIntegrity(
      task,
      evidenceIndex,
    );
    const exportStatus = evidenceIntegrity.status;
    const runtime = await this.getRuntimeStatus().catch((error) => ({
      error: error instanceof Error ? error.message : '运行状态读取失败',
    }));
    const readiness = await this.getReadiness().catch((error) => ({
      error: error instanceof Error ? error.message : '权限检查读取失败',
    }));
    const payload = {
      exportedAt,
      exportStatus,
      integrity: evidenceIntegrity,
      task: {
        id: task.id,
        type: task.type,
        typeLabel: task.typeLabel,
        status: task.status,
        statusLabel: task.statusLabel,
        accountId: task.accountId,
        accountName: task.accountName,
        platformType: task.platformType,
        platformName: task.platformName,
        targetName: task.targetName,
        sourceText: task.sourceText,
        replyText: task.replyText,
        sendMode: task.sendMode,
        requestedSendMode: task.requestedSendMode,
        riskLevel: task.riskLevel,
        requiresDoubleConfirmation: task.requiresDoubleConfirmation,
        safetyBoundary: task.safetyBoundary,
        misfireProtection: task.misfireProtection,
        riskPolicy: task.riskPolicy,
        riskChecklist: task.riskChecklist,
        executionMode: task.executionMode,
        runtimeState: task.runtimeState,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        failureReason: task.failureReason,
        failureContext: task.failureContext,
        blockers: task.blockers,
        nextAction: task.nextAction,
        pausedFromStatus: task.pausedFromStatus,
        pausedAt: task.pausedAt,
        diagnostics: task.diagnostics,
        steps: task.steps || [],
        batchSummary: task.batchSummary,
        batchTargets: task.batchTargets || [],
        approvalRecord: task.approvalRecord,
        events: task.events,
        evidence: task.events
          .filter((event) => Boolean(event.evidence))
          .map((event) => ({
            eventId: event.id,
            level: event.level,
            message: event.message,
            createdAt: event.createdAt,
            evidence: event.evidence,
          })),
        evidenceIndex,
        evidenceReplay: this.buildTaskEvidenceReplay(task),
        failureAnalysis: this.buildTaskFailureAnalysis(task),
      },
      runtime,
      readiness,
      supportHint:
        '试用期排查请优先查看 task.diagnostics、task.steps、task.events、task.evidenceReplay、task.failureAnalysis 和权限风控字段。',
    };

    return {
      filename: `interaction-task-${task.id}-diagnostics-${exportedAt.slice(0, 10)}.json`,
      mimeType: 'application/json;charset=utf-8',
      content: JSON.stringify(payload, null, 2),
      exportedAt,
      exportStatus,
    };
  }

  async createTask(
    input: CreateInteractionTaskInput,
  ): Promise<InteractionTask> {
    const tenantScope = await this.resolveTenantScope();
    const callerCommercialAllowed = this.currentActorCommercialAllowed();
    const needsRealAccount = this.requiresRealAccount(input.type);
    const saveOnly = input.planStatus === 'draft';
    const isLiveTask = this.isLiveExecutorTask(input.type);
    const needsLiveExecution = isLiveTask && !saveOnly;
    if (needsRealAccount && !input.accountId) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}需要选择已登录的本地账号。请先到发布中心-平台账号完成登录，再回来创建任务。`,
      );
    }
    let createPreflight: Awaited<
      ReturnType<LocalEngineService['assertCreateExecutionPreflight']>
    >;
    let createPreflightFailure:
      | {
          ok: false;
          stageKey: string;
          failureReason: string;
          nextAction: string;
        }
      | undefined;

    if (
      !saveOnly &&
      (needsRealAccount || this.isDesktopInteractionTask(input.type))
    ) {
      try {
        createPreflight = await this.assertCreateExecutionPreflight(input);
      } catch (error) {
        createPreflightFailure = {
          ok: false,
          stageKey: 'executor-capability',
          failureReason:
            error instanceof Error ? error.message : '真实执行预检失败',
          nextAction:
            '请修复账号登录态、本地 发布服务或服务能力后创建重试任务。',
        };
      }
    }
    await this.ensureTaskStore();
    const defaultReplyRule = await this.loadReplyRuleFromStore(tenantScope);
    const now = new Date().toISOString();
    const metadata = this.normalizeGroupBroadcastPlanMetadata(input, now);
    const fallbackSource = input.sourceText?.trim() || '等待本机读取真实对象。';
    const taskReplyBot = input.replyBotId
      ? await this.getReplyBot(input.replyBotId)
      : undefined;
    const taskRule = taskReplyBot?.config || defaultReplyRule;
    const fallbackReply =
      input.replyText?.trim() ||
      this.buildReplyFromRule(fallbackSource, {}, taskRule);
    const batchTargets = this.normalizeBatchTargets(input, now);
    const momentsPlanMetadata = this.normalizeMomentsPlanMetadata(input);
    const primaryTarget = batchTargets[0];
    const requestedSendMode = input.sendMode;
    const sendMode = this.resolveTaskSendMode(input.type, requestedSendMode);
    const initialContract =
      createPreflightFailure ||
      this.buildExecutionContract(
        {
          type: input.type,
          accountId: input.accountId,
          accountName: input.accountName?.trim() || '未指定账号',
          platformType: input.platformType,
          platformName: input.platformName,
          sendMode,
        },
        {
          capability: createPreflight?.capability,
          requireReadyCapability: needsLiveExecution,
          allowMissingAccountException: false,
        },
      );
    const riskLevel = this.resolveInteractionRisk(
      input.type,
      sendMode,
      fallbackSource,
      fallbackReply,
    );
    const safetyBoundary = this.createSafetyBoundary({
      riskLevel,
      requestedSendMode,
      sendMode,
      hasDestructiveIntent: this.hasDestructiveIntent(
        `${fallbackSource}\n${fallbackReply}`,
      ),
      commercialExecutionRequested: input.commercialExecutionRequested === true,
      callerCommercialAllowed,
    });
    const misfireProtection = this.createMisfireProtection(
      input.type,
      riskLevel,
    );
    const riskPolicy = this.createRiskPolicy({
      riskLevel,
      scope: this.isDesktopInteractionTask(input.type)
        ? 'desktop'
        : input.type === 'customer-follow-up'
          ? 'mixed'
          : 'browser',
      targetName:
        primaryTarget?.targetName || input.targetName?.trim() || '测试对象',
      hasRemoteTakeover: false,
    });
    const riskChecklist = this.createInteractionRiskChecklist({
      type: input.type,
      riskLevel,
      sendMode,
      safetyBoundary,
      misfireProtection,
      riskPolicy,
    });
    const task: InteractionTask = {
      id: this.createId(),
      ...tenantScope,
      type: input.type,
      typeLabel: this.resolveTypeLabel(input.type),
      status: initialContract.ok ? 'queued' : 'blocked',
      statusLabel: this.resolveStatusLabel(
        initialContract.ok ? 'queued' : 'blocked',
      ),
      planName: this.optionalTrimmedText(metadata.planName),
      planTime: this.optionalTrimmedText(metadata.planTime),
      planStatus: this.resolveGroupBroadcastPlanStatus(
        input.type,
        initialContract.ok ? 'queued' : 'blocked',
        metadata.planStatus,
        metadata.planTime,
      ),
      dailyLimit: this.optionalNumber(metadata.dailyLimit),
      associatedWeChat: this.optionalTrimmedText(metadata.associatedWeChat),
      currentWechatId: this.optionalTrimmedText(metadata.currentWechatId),
      plannedWechatId: this.optionalTrimmedText(metadata.plannedWechatId),
      generateOnDemand:
        typeof metadata.generateOnDemand === 'boolean'
          ? metadata.generateOnDemand
          : undefined,
      accountId: input.accountId,
      replyBotId: input.replyBotId,
      accountName:
        createPreflight?.accountName ||
        input.accountName?.trim() ||
        '未指定账号',
      platformType: createPreflight?.platformType ?? input.platformType,
      platformName: createPreflight?.platformName || input.platformName,
      targetName:
        primaryTarget?.targetName || input.targetName?.trim() || '测试对象',
      sourceText: primaryTarget?.sourceText || fallbackSource,
      replyText: primaryTarget?.replyText || fallbackReply,
      sourceUrl:
        primaryTarget?.sourceUrl || this.optionalTrimmedText(input.sourceUrl),
      profileUrl:
        primaryTarget?.profileUrl || this.optionalTrimmedText(input.profileUrl),
      commentTime:
        primaryTarget?.commentTime ||
        this.optionalTrimmedText(input.commentTime),
      videoTitle:
        primaryTarget?.videoTitle || this.optionalTrimmedText(input.videoTitle),
      videoUrl:
        primaryTarget?.videoUrl || this.optionalTrimmedText(input.videoUrl),
      engagementScore:
        primaryTarget?.engagementScore ??
        this.optionalNumber(input.engagementScore),
      replyGeneratedBy:
        input.replyGeneratedBy ||
        (input.replyText?.trim() ? 'fallback' : undefined),
      replyRule: taskRule,
      sendMode,
      requestedSendMode,
      riskLevel,
      requiresDoubleConfirmation: sendMode === 'approval-send',
      safetyBoundary,
      misfireProtection,
      riskPolicy,
      riskChecklist,
      executionMode: isLiveTask ? 'browser-assisted' : 'internal-record',
      metadata:
        Object.keys(metadata).length || momentsPlanMetadata
          ? { ...metadata, ...(momentsPlanMetadata || {}) }
          : undefined,
      billingIdentity: isLiveTask
        ? this.buildCurrentInteractionTaskBillingIdentity()
        : undefined,
      followUpMethod:
        input.type === 'customer-follow-up' ? input.followUpMethod : undefined,
      rateLimitPerMinute: 3,
      runtimeState: saveOnly
        ? 'record_ready'
        : initialContract.ok
          ? needsLiveExecution
            ? 'preflight_only'
            : 'record_ready'
          : 'executor_missing',
      createdAt: now,
      updatedAt: now,
      failureReason: initialContract.ok
        ? undefined
        : initialContract.failureReason,
      nextAction: saveOnly
        ? '草稿已保存，可以继续编辑或开始执行。'
        : initialContract.ok
          ? this.isDesktopInteractionTask(input.type)
            ? '等待本机微信执行器操作'
            : '等待本地引擎领取任务'
          : initialContract.nextAction,
      batchTargets,
      batchSummary: initialContract.ok
        ? this.buildBatchSummary(batchTargets)
        : this.buildBatchSummary(
            batchTargets.map((target) => ({
              ...target,
              status: 'failed',
              failureReason: initialContract.failureReason,
              nextAction: initialContract.nextAction,
              updatedAt: now,
            })),
          ),
      steps: this.createTaskSteps(input.type, Boolean(input.accountId), now),
      events: [],
    };

    if (!initialContract.ok) {
      task.batchTargets = task.batchTargets?.map((target) => ({
        ...target,
        status: 'failed',
        failureReason: initialContract.failureReason,
        nextAction: initialContract.nextAction,
        updatedAt: now,
      }));
      task.batchSummary = this.buildBatchSummary(task.batchTargets);
      this.setTaskStep(
        task,
        'account-entry',
        'blocked',
        '真实执行预检未通过。',
      );
      this.setTaskStep(
        task,
        'target-read',
        'blocked',
        '未通过账号或服务检查，不能读取真实对象。',
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '未读取真实对象，不能生成商用草稿。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实执行合同缺失，不能进入受控执行。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        initialContract.failureReason,
      );
    }

    if (initialContract.ok) {
      this.pushEvent(task, 'info', '互动任务已创建，等待本地引擎执行。');
    } else {
      this.pushEvent(
        task,
        'warning',
        '互动任务已创建，但真实执行合同尚未满足，生命周期会停在阻断态。',
      );
      this.pushEvent(
        task,
        'warning',
        initialContract.failureReason || '真实执行合同缺失',
        {
          type: 'failure_reason',
          label: '执行合同缺失',
          value: initialContract.failureReason || '真实执行合同缺失',
          stageKey: initialContract.stageKey,
        },
      );
    }
    this.pushEvent(
      task,
      'info',
      task.executionMode === 'browser-assisted'
        ? task.sendMode === 'auto-send'
          ? '当前会尝试打开本地账号后台；自动发送模式会在真实对象、输入框、发送按钮和回复回读通过后直接发送。'
          : '当前会尝试打开本地账号后台；确认后发送模式会在真实发送前等待用户确认。'
        : '当前仅创建内部跟进记录，不触发平台动作。',
    );
    this.pushEvent(task, 'info', `已套用客服规则：${taskRule.industryName}。`);
    this.pushEvent(task, 'info', '阶段日志已开启：任务创建', {
      type: 'stage_log',
      label: '阶段日志',
      value: `create-task / risk=${riskLevel} / sendMode=${sendMode}`,
      stageKey: 'create-task',
    });
    if (requestedSendMode === 'auto-send' && sendMode !== 'auto-send') {
      this.pushEvent(
        task,
        'warning',
        this.isDesktopInteractionTask(input.type)
          ? '微信桌面动作暂不允许自动发送，已降级为确认后发送。'
          : safetyBoundary.message,
      );
    }
    this.pushEvent(
      task,
      safetyBoundary.permissionStatus === 'allowed' ? 'info' : 'warning',
      `商用执行权限：${this.resolvePermissionStatusLabel(safetyBoundary.permissionStatus)}`,
      {
        type: 'text',
        label: '试用/商用边界',
        value: safetyBoundary.message,
      },
    );
    if (this.isDesktopInteractionTask(input.type)) {
      this.pushEvent(
        task,
        task.sendMode === 'auto-send' ? 'info' : 'warning',
        task.sendMode === 'auto-send'
          ? '微信桌面任务使用自动发送模式：必须通过桌面 preflight、目标锁定、窗口确认和草稿回读，缺一项就阻断。'
          : '微信桌面任务使用确认后发送模式：只填入草稿，执行前必须确认当前桌面微信窗口。',
      );
    }
    if (batchTargets.length > 1) {
      this.pushEvent(
        task,
        'info',
        `批量对象已导入 ${batchTargets.length} 条。`,
      );
    }
    const scheduledAt = this.resolveFutureWechatPlanTime(task, now);
    if (saveOnly) {
      task.planStatus = 'draft';
      task.runtimeState = 'record_ready';
      task.nextAction = '草稿已保存，可以继续编辑或开始执行。';
      this.pushEvent(task, 'info', '计划草稿已保存，当前没有发送。', {
        type: 'stage_log',
        label: '草稿',
        value: task.id,
        stageKey: 'draft-saved',
      });
    } else if (scheduledAt) {
      task.planStatus = 'scheduled';
      task.runtimeState = 'record_ready';
      task.nextAction = `将在 ${new Date(scheduledAt).toLocaleString('zh-CN', {
        hour12: false,
      })} 由本机助手开始执行。`;
      this.pushEvent(task, 'info', '计划已保存，等待设定时间。', {
        type: 'stage_log',
        label: '等待执行',
        value: scheduledAt,
        stageKey: 'scheduled-wait',
      });
    }
    this.tasks.set(task.id, task);
    await this.persistTask(task);
    if (initialContract.ok && !saveOnly && !scheduledAt) {
      this.runInteractionTaskLifecycle(task.id);
    }

    return task;
  }

  private resolveFutureWechatPlanTime(
    task: InteractionTask,
    now = new Date().toISOString(),
  ) {
    if (!this.isDesktopInteractionTask(task.type)) return undefined;
    const value =
      this.optionalTrimmedText(task.planTime) ||
      this.optionalTrimmedText(task.metadata?.scheduledAt) ||
      this.optionalTrimmedText(task.metadata?.scheduleStartTime) ||
      this.optionalTrimmedText(
        task.metadata?.wechat_plan_schedule_start_time,
      ) ||
      this.optionalTrimmedText(
        task.metadata?.wechat_moments_schedule_start_time,
      );
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= Date.parse(now)) {
      return undefined;
    }
    return new Date(timestamp).toISOString();
  }

  async approveTask(
    id: string,
    input: InteractionApprovalInput = {},
    riskContext?: BackendRiskContext,
  ): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (task.status !== 'waiting_for_send_confirmation') {
      return task;
    }

    const riskAudit = assertBackendRiskGate({
      action: 'interaction-approval',
      target: `${task.type}:${task.accountName}:${task.targetName}`,
      riskLevel: task.riskLevel || 'medium',
      requiresConfirmation: true,
      confirmation: input.riskConfirmation,
      context: riskContext,
      reason:
        task.sendMode === 'draft-only'
          ? '批准互动草稿填入动作。'
          : '批准互动发送链路继续执行，后端会调用真实执行器并做发送后回读。',
    });

    const approvalRecord = this.createApprovalRecord(task, input);
    // 人工在确认前修改过草稿 → 用修改后的文本覆盖，确保发出去的是人改过的版本
    const editedReply = this.optionalTrimmedText(input.replyText);
    if (editedReply && editedReply !== task.replyText) {
      const originalLength = (task.replyText || '').length;
      task.replyText = editedReply;
      this.pushEvent(
        task,
        'info',
        `人工已修改回复草稿（原 ${originalLength} 字 → 新 ${editedReply.length} 字），将按修改后版本发送。`,
      );
    }
    if (this.isDesktopInteractionTask(task.type)) {
      const missing = [
        approvalRecord.targetConfirmed ? '' : '目标对象',
        approvalRecord.contentConfirmed ? '' : '执行内容',
        approvalRecord.checklistConfirmed ? '' : '风险清单',
        approvalRecord.commercialPermissionConfirmed ? '' : '商用权限',
        approvalRecord.misfireProtectionConfirmed ? '' : '误操作保护',
        task.requiresDoubleConfirmation &&
        !approvalRecord.doubleConfirmationConfirmed
          ? '二次确认'
          : '',
        approvalRecord.currentWindowConfirmed ? '' : '当前微信窗口',
        approvalRecord.contactConfirmed ? '' : '目标联系人/当前会话',
        approvalRecord.draftBeforeFillConfirmed ? '' : '草稿填入前确认',
      ].filter(Boolean);
      if (missing.length) {
        throw new BadRequestException(`请先确认：${missing.join('、')}`);
      }
      const preflight = await this.getDesktopCommercialPreflight();
      if (!preflight.allowed) {
        throw new BadRequestException(
          `微信桌面 preflight 未通过：${preflight.blockers.join('；')}`,
        );
      }
      this.wechatSessionConfirmation = {
        ...this.wechatSessionConfirmation,
        currentWindowConfirmed: true,
        contactConfirmed: true,
        draftBeforeFillConfirmed: true,
        targetContact:
          approvalRecord.targetContact ||
          this.wechatSessionConfirmation.targetContact,
        updatedAt: approvalRecord.confirmedAt,
        takeoverActive: false,
      };
      const evidence = await this.captureDesktopScreenshot(
        '微信草稿填入前截图',
      ).catch((error) => ({
        type: 'text' as const,
        label: '微信草稿填入前截图不可用',
        value: error instanceof Error ? error.message : '桌面截图失败',
        capturedAt: approvalRecord.confirmedAt,
      }));
      this.rememberDesktopEvidence(evidence);
      this.pushEvent(task, 'info', '已保存微信草稿填入前桌面证据。', {
        type: evidence.type,
        label: evidence.label,
        value: evidence.value,
      });
    }
    task.approvalRecord = approvalRecord;
    this.pushEvent(task, 'info', '人工确认记录已保存。', {
      type: 'text',
      label: '确认记录',
      value: [
        `操作人：${approvalRecord.operator}`,
        approvalRecord.targetContact
          ? `微信联系人：${approvalRecord.targetContact}`
          : '',
        `目标确认：${approvalRecord.targetConfirmed ? '是' : '否'}`,
        `内容确认：${approvalRecord.contentConfirmed ? '是' : '否'}`,
        `当前窗口确认：${approvalRecord.currentWindowConfirmed ? '是' : '否'}`,
        approvalRecord.contactConfirmed !== undefined
          ? `联系人确认：${approvalRecord.contactConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.draftBeforeFillConfirmed !== undefined
          ? `草稿填入前确认：${approvalRecord.draftBeforeFillConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.checklistConfirmed !== undefined
          ? `检查项确认：${approvalRecord.checklistConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.commercialPermissionConfirmed !== undefined
          ? `商用权限确认：${approvalRecord.commercialPermissionConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.misfireProtectionConfirmed !== undefined
          ? `误发误删保护确认：${approvalRecord.misfireProtectionConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.doubleConfirmationConfirmed !== undefined
          ? `高风险继续保护：${approvalRecord.doubleConfirmationConfirmed ? '是' : '否'}`
          : '',
        approvalRecord.note ? `备注：${approvalRecord.note}` : '',
      ]
        .filter(Boolean)
        .join('；'),
    });
    this.pushEvent(task, 'warning', '后端风控审批已记录。', {
      type: 'diagnostic_bundle',
      label: '后端风控审计',
      value: JSON.stringify(riskAudit, null, 2),
      stageKey: 'approval',
    });

    if (this.isDesktopInteractionTask(task.type)) {
      this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
      this.setTaskStep(
        task,
        'send-result',
        'running',
        '正在通过本机微信继续发送。',
      );
      const sendResult = await this.sendApprovedWechatTask(task).catch(
        (error): ApprovedWechatTaskResult => {
          const desktopError = this.toWechatDesktopCommandError(error);
          const message =
            error instanceof Error ? error.message : '本机微信发送失败';
          return {
            ok: false,
            status:
              desktopError?.result.status === 'blocked'
                ? 'blocked'
                : desktopError && this.isWechatNoTargetMessage(message)
                  ? 'no_target'
                  : undefined,
            message,
            nextAction: desktopError?.result.nextAction,
            screenshotPath: desktopError?.result.screenshotPath,
            results: desktopError
              ? [
                  {
                    target: task.targetName,
                    ok: false,
                    message,
                    screenshotPath: desktopError.result.screenshotPath,
                    result: desktopError.result,
                  },
                ]
              : undefined,
          };
        },
      );
      if (sendResult.ok) {
        if (sendResult.sourceText) {
          task.sourceText = sendResult.sourceText;
        }
        if (sendResult.replyText) {
          task.replyText = sendResult.replyText;
        }
        if (sendResult.replyGeneratedBy) {
          task.replyGeneratedBy = sendResult.replyGeneratedBy;
        }
        const evidenceValue =
          sendResult.readbackText ||
          (sendResult.results?.length
            ? JSON.stringify(sendResult.results, null, 2)
            : sendResult.screenshotPath || sendResult.message);
        const sentEvent = this.pushEvent(
          task,
          'success',
          sendResult.readbackText
            ? `${sendResult.message}；回读确认：${sendResult.readbackText}`
            : sendResult.message,
          {
            type: 'desktop_screenshot',
            label: '微信发送结果',
            value: evidenceValue,
            artifactUrl: sendResult.screenshotPath,
            stageKey: 'send-result',
          },
        );
        const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
          sentEvent.id,
        ]);
        const completedTargetCount = this.markBatchTargetsByNames(
          task,
          sendResult.completedTargets || [],
          'completed',
          sendResult.message,
          {
            nextAction: '发送完成，可在任务证据里查看结果。',
            evidenceEventIds,
          },
        );
        const failedTargetCount = (sendResult.failedTargets || []).reduce(
          (count, target) =>
            count +
            this.markBatchTargetsByNames(
              task,
              [target.targetName],
              'failed',
              target.reason || sendResult.message,
              {
                nextAction:
                  target.reason || '请检查桌面微信目标、权限和执行脚本后重试。',
                evidenceEventIds,
              },
            ),
          0,
        );
        const hasExplicitPendingTargets = Array.isArray(
          sendResult.pendingTargets,
        );
        const skippedTargetCount = this.markBatchTargetsByNames(
          task,
          hasExplicitPendingTargets ? sendResult.skippedTargets || [] : [],
          'skipped',
          '已按计划规则跳过本次执行。',
          {
            nextAction: '该对象已跳过，不会在本计划内自动继续执行。',
            evidenceEventIds,
          },
        );
        const queuedTargetCount = this.markBatchTargetsByNames(
          task,
          hasExplicitPendingTargets
            ? sendResult.pendingTargets || []
            : sendResult.skippedTargets || [],
          'queued',
          '已达到本次执行上限，等待下一批继续。',
          {
            nextAction: '本次达到上限，点击继续下一批可处理剩余对象。',
            evidenceEventIds,
          },
        );
        if (
          completedTargetCount +
            failedTargetCount +
            skippedTargetCount +
            queuedTargetCount ===
          0
        ) {
          this.markBatchTargetsForApprovalOutcome(
            task,
            'completed',
            sendResult.message,
            {
              nextAction: '发送完成，可在任务证据里查看结果。',
              evidenceEventIds,
            },
          );
        }
        this.setTaskStep(
          task,
          'send-result',
          'completed',
          sendResult.readbackText
            ? `${sendResult.message}；回读确认：${sendResult.readbackText}`
            : sendResult.message,
        );
        const hasRemainingTargets =
          queuedTargetCount > 0 || failedTargetCount > 0;
        this.updateTask(task, 'completed', sendResult.message, {
          nextAction: hasRemainingTargets
            ? `本次已完成 ${completedTargetCount} 个对象，失败 ${failedTargetCount} 个对象，跳过 ${skippedTargetCount} 个对象，还有 ${queuedTargetCount} 个对象待继续。`
            : '发送完成，可在任务证据里查看结果。',
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      if (sendResult.status === 'no_target') {
        this.setTaskStep(
          task,
          'target-read',
          'completed',
          '本机微信已搜索目标，但目标不可添加或已是联系人。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
        const noTargetEvent = this.pushEvent(
          task,
          'warning',
          sendResult.message,
          {
            type: 'desktop_screenshot',
            label: '微信加好友无可添加对象',
            value: sendResult.screenshotPath || sendResult.message,
            artifactUrl: sendResult.screenshotPath,
            stageKey: 'send-result',
          },
        );
        this.markBatchTargetsForApprovalOutcome(
          task,
          'no_target',
          sendResult.message,
          {
            nextAction:
              '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
            evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
              noTargetEvent.id,
            ]),
          },
        );
        this.updateTask(task, 'no_target', sendResult.message, {
          failureReason: undefined,
          nextAction:
            '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      if (sendResult.status === 'blocked') {
        const nextAction =
          sendResult.nextAction ||
          '接入对应 Windows 微信 native command 后重新执行。';
        const failureEvent = this.pushEvent(task, 'error', sendResult.message, {
          type: 'failure_reason',
          label: '微信 native command blocked',
          value: JSON.stringify(
            {
              message: sendResult.message,
              errorCode: 'not_integrated',
              nextAction,
              result: sendResult.results?.[0]?.result,
            },
            null,
            2,
          ),
          stageKey: 'send-result',
        });
        this.markBatchTargetsForApprovalOutcome(
          task,
          'failed',
          sendResult.message,
          {
            nextAction,
            evidenceEventIds: [failureEvent.id],
          },
        );
        this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
        this.updateTask(task, 'failed', sendResult.message, {
          failureReason: sendResult.message,
          nextAction,
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      const failureEvent = this.pushEvent(task, 'error', sendResult.message, {
        type: 'failure_reason',
        label: '微信发送失败',
        value: sendResult.message,
        stageKey: 'send-result',
      });
      this.markBatchTargetsForApprovalOutcome(
        task,
        'failed',
        sendResult.message,
        {
          nextAction: '请检查微信窗口、联系人和发送权限后重试。',
          evidenceEventIds: [failureEvent.id],
        },
      );
      this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
      this.updateTask(task, 'failed', sendResult.message, {
        failureReason: sendResult.message,
        nextAction: '请检查微信窗口、联系人和发送权限后重试。',
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    if (task.executionMode === 'browser-assisted') {
      const contract = await this.resolveExecutionContract(task);
      if (!contract.ok) {
        this.blockTaskForExecutionContract(task, contract);
        await this.persistTask(task);
        return task;
      }

      this.setTaskStep(
        task,
        'send-approval',
        'completed',
        '人工确认通过，开始填入平台草稿。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'running',
        '正在打开本机浏览器执行真实发送。',
      );
      const sendResult = await this.sendApprovedBrowserReplyViaRuntime(task);
      if (sendResult.ok) {
        this.applyInteractionDraftResult(task, sendResult);
        if (sendResult.runtimeMode) {
          task.runtimeMode = sendResult.runtimeMode;
        }
        this.setTaskStep(
          task,
          'send-result',
          'completed',
          '回复已通过真实执行器发送并完成回读。',
        );
        const draftEvent = this.pushEvent(
          task,
          'success',
          sendResult.message,
          sendResult.evidence,
        );
        const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
          draftEvent.id,
        ]);
        const completedTargetCount = this.markBatchTargetsByNames(
          task,
          sendResult.completedTargets || [],
          'completed',
          sendResult.message,
          {
            nextAction:
              sendResult.nextAction ||
              '已完成，可在任务证据里查看发送和回读结果。',
            evidenceEventIds,
          },
        );
        const failedTargetCount = (sendResult.failedTargets || []).reduce(
          (count, target) =>
            count +
            this.markBatchTargetsByNames(
              task,
              [target.targetName],
              'failed',
              target.reason || sendResult.message,
              {
                nextAction:
                  target.reason ||
                  sendResult.nextAction ||
                  '请检查桌面微信目标、权限和执行脚本后重试。',
                evidenceEventIds,
              },
            ),
          0,
        );
        const queuedTargetCount = this.markBatchTargetsByNames(
          task,
          sendResult.skippedTargets || [],
          'queued',
          '等待继续执行。',
          {
            nextAction:
              sendResult.nextAction ||
              '本次达到上限，点击继续下一批可处理剩余对象。',
            evidenceEventIds,
          },
        );
        if (
          completedTargetCount + failedTargetCount + queuedTargetCount ===
          0
        ) {
          this.markBatchTargetsForApprovalOutcome(
            task,
            'completed',
            sendResult.message,
            {
              nextAction:
                sendResult.nextAction ||
                '已完成，可在任务证据里查看发送和回读结果。',
              evidenceEventIds,
            },
          );
        }
        this.updateTask(task, 'completed', sendResult.message, {
          nextAction:
            sendResult.nextAction ||
            '已完成，可在任务证据里查看发送和回读结果。',
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      if (
        ['comment_missing', 'message_missing', 'no_target'].includes(
          sendResult.status,
        )
      ) {
        this.setTaskStep(
          task,
          'target-read',
          'completed',
          '真实平台已读取，但目标对象不存在或已处理。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
        const noTargetEvent = this.pushEvent(
          task,
          'warning',
          sendResult.message,
          sendResult.evidence,
        );
        this.markBatchTargetsForApprovalOutcome(
          task,
          'no_target',
          sendResult.message,
          {
            nextAction:
              sendResult.nextAction ||
              '目标已不存在或已处理；等平台出现新对象后重试。',
            evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
              noTargetEvent.id,
            ]),
          },
        );
        this.updateTask(task, 'no_target', sendResult.message, {
          failureReason: undefined,
          nextAction:
            sendResult.nextAction ||
            '目标已不存在或已处理；等平台出现新对象后重试。',
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
      const draftFailureEvent = this.pushEvent(
        task,
        'error',
        sendResult.message,
        sendResult.evidence,
      );
      const failureReasonEvent = this.pushEvent(
        task,
        'error',
        sendResult.message,
        {
          type: 'failure_reason',
          label: '失败原因',
          value: sendResult.message,
          stageKey: 'send-result',
        },
      );
      this.markBatchTargetsForApprovalOutcome(
        task,
        'failed',
        sendResult.message,
        {
          nextAction: sendResult.nextAction,
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            draftFailureEvent.id,
            failureReasonEvent.id,
          ]),
        },
      );
      this.updateTask(task, 'failed', sendResult.message, {
        failureReason: sendResult.message,
        nextAction: sendResult.nextAction,
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
    this.setTaskStep(task, 'send-result', 'completed', '发送结果已回写。');
    const resultEvent = this.pushEvent(
      task,
      'success',
      '执行保护通过，结果已回写。',
      {
        type: 'text',
        label: '发送结果',
        value: `${task.accountName} -> ${task.targetName}`,
      },
    );
    this.markBatchTargetsForApprovalOutcome(
      task,
      'completed',
      '内部记录已人工确认完成',
      {
        nextAction: '任务已完成，可在回复记录中查看证据。',
        evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
          resultEvent.id,
        ]),
      },
    );
    this.updateTask(task, 'completed', '已人工确认，内部记录已完成。', {
      nextAction: '任务已完成，可在回复记录中查看证据。',
      completedAt: new Date().toISOString(),
    });

    return task;
  }

  async skipTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (
      ![
        'running',
        'waiting_for_send_confirmation',
        'queued',
        'paused',
        'blocked',
        'failed',
      ].includes(task.status)
    ) {
      return task;
    }

    const skipEvent = this.pushEvent(task, 'warning', '用户跳过本次发送。', {
      type: 'stage_log',
      label: '跳过记录',
      value: 'operator skipped the remaining interaction targets',
      stageKey: 'send-result',
    });
    this.markUnfinishedBatchTargets(task, 'skipped', '用户跳过本次发送', {
      nextAction: '任务已跳过；如需继续，请创建重试任务。',
      evidenceEventIds: [skipEvent.id],
    });
    this.setTaskStep(task, 'send-approval', 'skipped', '用户跳过本次发送。');
    this.setTaskStep(task, 'send-result', 'skipped', '任务已跳过。');
    this.updateTask(task, 'skipped', '用户跳过本次发送。', {
      nextAction:
        '任务已跳过，可在执行记录查看跳过原因和证据；需要继续时可创建重试任务。',
      completedAt: new Date().toISOString(),
    });

    return task;
  }

  async pauseTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (
      ![
        'queued',
        'running',
        'waiting_for_send_confirmation',
        'blocked',
      ].includes(task.status)
    ) {
      return task;
    }

    const linkedAgentSessionId =
      this.optionalTrimmedText(task.metadata?.agentSessionId) ||
      this.optionalTrimmedText(task.metadata?.agent_session_id);
    if (
      this.isDesktopInteractionTask(task.type) &&
      linkedAgentSessionId &&
      task.status === 'running'
    ) {
      if (!this.agentS) {
        throw new BadRequestException(
          '本机助手服务不可用，无法确认微信任务已经停止。',
        );
      }
      try {
        await this.agentS.cancelSession(linkedAgentSessionId);
      } catch (error) {
        throw new BadRequestException(
          `本机助手未确认停止，任务没有标记为暂停：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const pauseEvent = this.pushEvent(
      task,
      'warning',
      '用户暂停批量互动任务。',
      {
        type: 'stage_log',
        label: '暂停记录',
        value: `paused from ${task.status}`,
        stageKey: 'pause',
      },
    );
    this.markPausableBatchTargets(task, '任务暂停，未继续执行该对象。', {
      nextAction:
        '明确未开始的对象可恢复；已进入执行中的对象需先核对迟到回读，不能自动重发。',
      evidenceEventIds: [pauseEvent.id],
    });
    task.pausedFromStatus =
      task.status === 'paused' ? task.pausedFromStatus : task.status;
    task.pausedAt = new Date().toISOString();
    this.setTaskStep(
      task,
      'send-result',
      'blocked',
      '任务已暂停，后端不会继续执行。',
    );
    this.updateTask(task, 'paused', '用户暂停批量互动任务。', {
      nextAction:
        '任务已暂停；恢复只会继续明确未开始的对象，执行中断点需先核对证据。',
    });

    return task;
  }

  async continueTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    const remainingTargets = this.getContinuableBatchTargets(task);
    if (!['paused', 'blocked', 'completed'].includes(task.status)) {
      return task;
    }
    if (task.status === 'paused' && this.isLiveExecutorTask(task.type)) {
      throw new BadRequestException(
        '暂停后的微信真实执行必须先获取服务端一次性恢复确认，不能通过继续接口绕过。',
      );
    }
    if (task.status === 'completed' && !remainingTargets.length) {
      return task;
    }

    const retryTask = remainingTargets.length
      ? await this.createTask(
          this.buildContinueTaskInput(task, remainingTargets),
        )
      : await this.retryTask(task.id);
    this.pushEvent(
      task,
      'info',
      remainingTargets.length
        ? `已继续下一批：${retryTask.id}，对象 ${remainingTargets.length} 个。`
        : `已继续为新任务：${retryTask.id}`,
    );
    this.pushEvent(
      retryTask,
      'info',
      remainingTargets.length
        ? `由任务 ${task.id} 的剩余对象继续创建。`
        : `由任务 ${task.id} 继续创建。`,
    );
    await this.persistTask(task);
    await this.persistTask(retryTask);
    return retryTask;
  }

  async getGroupBroadcastPlanDetails(
    id: string,
  ): Promise<InteractionBatchTargetListResult> {
    const task = await this.getTaskForDisplay(id);
    this.assertGroupBroadcastTask(task);
    return {
      taskId: task.id,
      planName: task.planName,
      planStatus: task.planStatus,
      summary: task.batchSummary,
      items: task.batchTargets || [],
    };
  }

  async resendGroupBroadcastPlan(
    id: string,
    input: ResendGroupBroadcastPlanInput = {},
  ): Promise<InteractionTask> {
    const task = await this.getTask(id);
    this.assertGroupBroadcastTask(task);
    assertBackendRiskGate({
      action: 'interaction-approval',
      target: `wechat-group-broadcast-resend:${task.accountName}:${task.planName || task.id}`,
      riskLevel: task.riskLevel || 'high',
      requiresConfirmation: true,
      confirmation: input.riskConfirmation,
      reason: '批准微信群发计划重发；重发会重新进入真实微信执行链路。',
    });
    const batchTargets =
      this.buildResendGroupBroadcastTargets(task, input) || [];
    if (!batchTargets.length) {
      throw new BadRequestException('没有可重发的群发对象');
    }
    const firstTarget = batchTargets[0];
    const replyText =
      this.optionalTrimmedText(input.replyText) ||
      firstTarget.replyText ||
      task.replyText;
    const resendInput: CreateInteractionTaskInput = {
      type: 'wechat-group-broadcast',
      accountId: task.accountId,
      accountName: task.accountName,
      platformType: task.platformType,
      platformName: task.platformName,
      targetName:
        batchTargets
          .map((target) => target.targetName)
          .filter(Boolean)
          .slice(0, 3)
          .join('、') || task.targetName,
      sourceText:
        this.optionalTrimmedText(input.sourceText) ||
        firstTarget.sourceText ||
        task.sourceText,
      replyText,
      planName: input.planName || task.planName,
      planTime: input.planTime || task.planTime,
      dailyLimit: input.dailyLimit ?? task.dailyLimit,
      associatedWeChat: input.associatedWeChat || task.associatedWeChat,
      generateOnDemand: input.generateOnDemand ?? task.generateOnDemand,
      metadata: this.normalizeGroupBroadcastPlanMetadata({
        type: 'wechat-group-broadcast',
        metadata: {
          ...(task.metadata || {}),
          ...(input.metadata || {}),
          resendOfPlanId: task.id,
          retryOfTaskId: task.id,
        },
        planName: input.planName || task.planName,
        planTime: input.planTime || task.planTime,
        dailyLimit: input.dailyLimit ?? task.dailyLimit,
        associatedWeChat: input.associatedWeChat || task.associatedWeChat,
        generateOnDemand: input.generateOnDemand ?? task.generateOnDemand,
      }),
      sendMode: input.immediate ? 'auto-send' : input.sendMode || task.sendMode,
      commercialExecutionRequested:
        input.immediate === true ||
        task.safetyBoundary?.requestedCommercialExecution === true ||
        task.safetyBoundary?.commercialExecutionAllowed === true,
      callerCommercialAllowed:
        task.safetyBoundary?.commercialExecutionAllowed === true,
      batchTargets,
    };
    const resendTask = await this.createTask(resendInput);
    this.pushEvent(task, 'info', `已创建群发重发任务：${resendTask.id}`);
    this.pushEvent(resendTask, 'info', `由群发计划 ${task.id} 重发创建。`);
    await this.persistTask(task);
    await this.persistTask(resendTask);
    return resendTask;
  }

  async removeGroupBroadcastPlan(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    this.assertGroupBroadcastTask(task);
    const now = new Date().toISOString();
    task.batchTargets = (task.batchTargets || []).map((target) =>
      target.status === 'completed' || target.status === 'no_target'
        ? target
        : {
            ...target,
            status: 'skipped',
            nextAction: '群发计划已移除，未继续执行该对象。',
            updatedAt: now,
          },
    );
    task.batchSummary = this.buildBatchSummary(task.batchTargets);
    this.updateTask(task, 'skipped', '群发计划已移除。', {
      planStatus: 'removed',
      nextAction: '计划已移除，保留历史明细和证据。',
      completedAt: now,
    });
    await this.persistTask(task);
    return task;
  }

  private assertGroupBroadcastTask(task: InteractionTask) {
    if (task.type !== 'wechat-group-broadcast') {
      throw new BadRequestException('该任务不是微信群发计划');
    }
  }

  private buildResendGroupBroadcastTargets(
    task: InteractionTask,
    input: ResendGroupBroadcastPlanInput,
  ): CreateInteractionTaskInput['batchTargets'] {
    if (Array.isArray(input.batchTargets) && input.batchTargets.length) {
      return input.batchTargets
        .map((target) => {
          const targetName = this.optionalTrimmedText(target.targetName);
          const sourceText =
            this.optionalTrimmedText(target.sourceText) ||
            this.optionalTrimmedText(input.sourceText) ||
            targetName ||
            task.sourceText;
          return {
            targetName,
            sourceText,
            replyText:
              this.optionalTrimmedText(target.replyText) ||
              this.optionalTrimmedText(input.replyText) ||
              task.replyText,
            sourceUrl: target.sourceUrl,
            profileUrl: target.profileUrl,
            commentTime: target.commentTime,
            videoTitle: target.videoTitle,
            videoUrl: target.videoUrl,
            engagementScore: target.engagementScore,
          };
        })
        .filter((target) => Boolean(target.sourceText));
    }

    const targetIds = new Set((input.targetIds || []).map(String));
    const targetNames = new Set(
      (input.targetNames || []).map((target) => target.trim()).filter(Boolean),
    );
    const hasExplicitTargets = targetIds.size > 0 || targetNames.size > 0;
    const sourceTargets = task.batchTargets?.length
      ? task.batchTargets
      : [
          {
            id: task.id,
            targetName: task.targetName,
            sourceText: task.sourceText,
            replyText: task.replyText,
            status: task.status === 'failed' ? 'failed' : 'queued',
          } as InteractionBatchTarget,
        ];
    return sourceTargets
      .filter((target) => {
        if (input.onlyFailed) return target.status === 'failed';
        if (input.onlyUnsent) return target.status === 'queued';
        if (hasExplicitTargets) {
          return (
            (targetIds.has(target.id) || targetNames.has(target.targetName)) &&
            (target.status === 'failed' || target.status === 'queued')
          );
        }
        return true;
      })
      .map((target) => ({
        targetName: target.targetName,
        sourceText:
          this.optionalTrimmedText(input.sourceText) ||
          target.sourceText ||
          target.targetName,
        replyText:
          this.optionalTrimmedText(input.replyText) ||
          target.replyText ||
          task.replyText,
        sourceUrl: target.sourceUrl,
        profileUrl: target.profileUrl,
        commentTime: target.commentTime,
        videoTitle: target.videoTitle,
        videoUrl: target.videoUrl,
        engagementScore: target.engagementScore,
      }));
  }

  private getContinuableBatchTargets(task: InteractionTask) {
    if (!task.batchTargets?.length) {
      return [];
    }
    return task.batchTargets.filter((target) => target.status === 'queued');
  }

  private buildContinueTaskInput(
    task: InteractionTask,
    targets: InteractionBatchTarget[],
  ): CreateInteractionTaskInput {
    const firstTarget = targets[0];
    return {
      type: task.type,
      accountId: task.accountId,
      accountName: task.accountName,
      platformType: task.platformType,
      platformName: task.platformName,
      targetName:
        targets
          .map((target) => target.targetName)
          .filter(Boolean)
          .slice(0, 3)
          .join('、') || task.targetName,
      sourceText: firstTarget?.sourceText || task.sourceText,
      replyText: firstTarget?.replyText || task.replyText,
      sourceUrl: firstTarget?.sourceUrl || task.sourceUrl,
      profileUrl: firstTarget?.profileUrl || task.profileUrl,
      commentTime: firstTarget?.commentTime || task.commentTime,
      videoTitle: firstTarget?.videoTitle || task.videoTitle,
      videoUrl: firstTarget?.videoUrl || task.videoUrl,
      engagementScore: firstTarget?.engagementScore || task.engagementScore,
      planName: task.planName,
      planTime: task.planTime,
      planStatus: undefined,
      dailyLimit: task.dailyLimit,
      associatedWeChat: task.associatedWeChat,
      generateOnDemand: task.generateOnDemand,
      metadata: {
        ...(task.metadata || {}),
        continueOfTaskId: task.id,
      },
      sendMode: task.sendMode,
      commercialExecutionRequested:
        task.safetyBoundary?.requestedCommercialExecution === true,
      callerCommercialAllowed:
        task.safetyBoundary?.commercialExecutionAllowed === true,
      batchTargets: targets.map((target) => ({
        targetName: target.targetName,
        sourceText: target.sourceText,
        replyText: target.replyText,
        sourceUrl: target.sourceUrl,
        profileUrl: target.profileUrl,
        commentTime: target.commentTime,
        videoTitle: target.videoTitle,
        videoUrl: target.videoUrl,
        engagementScore: target.engagementScore,
      })),
    };
  }

  async resumeTask(
    id: string,
    input: InteractionApprovalInput = {},
    riskContext?: BackendRiskContext,
  ): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (task.status !== 'paused') {
      return task;
    }
    if (this.isLiveExecutorTask(task.type)) {
      void riskContext;
      const confirmationId = this.optionalTrimmedText(
        input.riskConfirmation?.confirmationId,
      );
      if (!confirmationId) {
        throw new BadRequestException(
          '恢复微信任务属于高风险操作，请先获取服务端一次性确认。',
        );
      }
      const issuedTarget = this.buildWechatResumeApprovalTarget(task);
      await this.requireRiskPolicyService().consumeHighRiskApproval(
        {
          confirmationId,
          action: WECHAT_RESUME_RISK_ACTION,
          riskLevel: 'high',
          target: issuedTarget,
        },
        this.riskApprovalActor(task),
      );
      const currentTask = await this.getTask(task.id);
      if (this.buildWechatResumeApprovalTarget(currentTask) !== issuedTarget) {
        throw new ConflictException(
          '任务或未完成对象在确认后发生变化，请重新核对并获取新的恢复确认。',
        );
      }
      const remainingTargets = this.getContinuableBatchTargets(task);
      if (!remainingTargets.length) {
        throw new BadRequestException(
          '当前没有可自动恢复的明确未开始对象；执行中断点请先核对迟到回读，再显式重试。',
        );
      }
      const resumedTask = await this.createTask(
        this.buildContinueTaskInput(task, remainingTargets),
      );
      this.pushEvent(task, 'info', `已确认恢复为新任务：${resumedTask.id}`);
      this.pushEvent(
        resumedTask,
        'info',
        `由暂停任务 ${task.id} 的未完成对象恢复创建。`,
      );
      await this.persistTask(task);
      await this.persistTask(resumedTask);
      return resumedTask;
    }

    const previousStatus = task.pausedFromStatus || 'running';
    task.pausedFromStatus = undefined;
    task.pausedAt = undefined;
    this.pushEvent(task, 'info', '任务已恢复执行。', {
      type: 'stage_log',
      label: '恢复记录',
      value: `resumed from paused to ${previousStatus}`,
      stageKey: 'resume',
    });
    this.setTaskStep(
      task,
      'send-result',
      'running',
      '任务已恢复，继续真实执行未完成对象。',
    );
    this.updateTask(task, 'queued', '任务已从暂停恢复执行。', {
      nextAction: '本地引擎将重新领取任务并继续处理未完成对象。',
    });
    await this.persistTask(task);
    this.runInteractionTaskLifecycle(task.id);
    return task;
  }

  async createTaskResumeConfirmation(id: string) {
    const task = await this.getTask(id);
    if (!this.isLiveExecutorTask(task.type) || task.status !== 'paused') {
      throw new BadRequestException(
        '只有已暂停的微信真实执行任务可以申请恢复确认。',
      );
    }
    if (!this.getContinuableBatchTargets(task).length) {
      throw new BadRequestException(
        '当前没有可自动恢复的明确未开始对象；请先核对执行中断点。',
      );
    }
    return this.requireRiskPolicyService().issueHighRiskApproval(
      {
        action: WECHAT_RESUME_RISK_ACTION,
        riskLevel: 'high',
        target: this.buildWechatResumeApprovalTarget(task),
        reason: `恢复微信任务 ${task.id} 的明确未开始对象`,
      },
      this.riskApprovalActor(task),
    );
  }

  private requireRiskPolicyService() {
    if (!this.riskPolicyService) {
      throw new InternalServerErrorException('高风险一次性确认服务未装配。');
    }
    return this.riskPolicyService;
  }

  private riskApprovalActor(task: InteractionTask) {
    const context = this.authRequestContext?.get();
    const sessionId = this.optionalTrimmedText(context?.sessionId);
    const userId = this.optionalTrimmedText(task.userId);
    const tenantId = this.optionalTrimmedText(task.tenantId);
    if (!sessionId || !userId || !tenantId || context?.user?.id !== userId) {
      throw new UnauthorizedException('当前登录会话不能确认该微信任务。');
    }
    return {
      tenantId,
      userId,
      sessionId,
      operator: userId,
    };
  }

  private buildWechatResumeApprovalTarget(task: InteractionTask) {
    const targets = (
      task.batchTargets?.length
        ? task.batchTargets
        : [
            {
              id: task.id,
              targetName: task.targetName,
              replyText: task.replyText,
              status: task.status,
            },
          ]
    )
      .filter((target) => target.status !== 'completed')
      .map((target) => ({
        id: target.id,
        targetName: target.targetName,
        status: target.status,
        replyHash: createHash('sha256')
          .update(target.replyText || '')
          .digest('hex'),
      }));
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          id: task.id,
          type: task.type,
          accountId: task.accountId || null,
          accountName: task.accountName,
          sendMode: task.sendMode,
          updatedAt: task.updatedAt,
          commercialExecutionAllowed:
            task.safetyBoundary?.commercialExecutionAllowed === true,
          commercialExecutionRequested:
            task.safetyBoundary?.requestedCommercialExecution === true,
          targets,
        }),
      )
      .digest('hex');
    return `wechat-resume:v1:${task.id}:${fingerprint}`;
  }

  async failTask(
    id: string,
    reason = '用户停止任务',
  ): Promise<InteractionTask> {
    const task = await this.getTask(id);
    const failureEvent = this.pushEvent(task, 'error', reason, {
      type: 'failure_reason',
      label: '失败原因',
      value: reason,
      stageKey: 'send-result',
    });
    this.markQueuedBatchTargets(task, 'failed', reason, {
      nextAction: '请检查本地能力状态后重试。',
      evidenceEventIds: [failureEvent.id],
    });
    this.setTaskStep(task, 'send-result', 'blocked', reason);
    this.updateTask(task, 'failed', reason, {
      failureReason: reason,
      nextAction: '请检查本地能力状态后重试。',
      completedAt: new Date().toISOString(),
    });

    return task;
  }

  async retryTask(
    id: string,
    input: RetryInteractionTaskInput = {},
  ): Promise<InteractionTask> {
    const task = await this.getTask(id);
    const targetIds = new Set((input.targetIds || []).map(String));
    const hasTargetFilter = targetIds.size > 0;
    const hasSelectedRetryTarget = task.batchTargets?.some(
      (target) =>
        targetIds.has(target.id) &&
        (target.status === 'failed' || target.status === 'queued'),
    );
    if (
      !['failed', 'blocked', 'skipped', 'paused'].includes(task.status) &&
      !(
        task.status === 'completed' &&
        hasTargetFilter &&
        hasSelectedRetryTarget
      )
    ) {
      throw new BadRequestException(
        '只有失败、阻断、暂停、已跳过，或仍有失败/未发送对象的已完成任务可以重试',
      );
    }

    const retryTargets = task.batchTargets?.length
      ? task.batchTargets.filter((target) => {
          if (input.onlyFailed) return target.status === 'failed';
          if (input.onlyUnsent) return target.status === 'queued';
          if (hasTargetFilter) {
            return (
              targetIds.has(target.id) &&
              (target.status === 'failed' || target.status === 'queued')
            );
          }
          return target.status === 'failed' || target.status === 'queued';
        })
      : undefined;
    if (task.batchTargets?.length && !retryTargets?.length) {
      throw new BadRequestException('没有失败或明确未发送的对象可重试');
    }

    const retryInput: CreateInteractionTaskInput = {
      type: task.type,
      accountId: task.accountId,
      accountName: task.accountName,
      platformType: task.platformType,
      platformName: task.platformName,
      targetName: task.targetName,
      sourceText: task.sourceText,
      replyText: task.replyText,
      sourceUrl: task.sourceUrl,
      profileUrl: task.profileUrl,
      commentTime: task.commentTime,
      videoTitle: task.videoTitle,
      videoUrl: task.videoUrl,
      engagementScore: task.engagementScore,
      planName: task.planName,
      planTime: task.planTime,
      dailyLimit: task.dailyLimit,
      associatedWeChat: task.associatedWeChat,
      generateOnDemand: task.generateOnDemand,
      metadata: {
        ...(task.metadata || {}),
        retryOfTaskId: task.id,
      },
      sendMode: task.sendMode,
      commercialExecutionRequested:
        task.safetyBoundary?.requestedCommercialExecution === true ||
        task.safetyBoundary?.commercialExecutionAllowed === true,
      callerCommercialAllowed:
        task.safetyBoundary?.commercialExecutionAllowed === true,
      batchTargets: retryTargets?.length
        ? retryTargets.map((target) => ({
            targetName: target.targetName,
            sourceText: target.sourceText,
            replyText: target.replyText,
            sourceUrl: target.sourceUrl,
            profileUrl: target.profileUrl,
            commentTime: target.commentTime,
            videoTitle: target.videoTitle,
            videoUrl: target.videoUrl,
            engagementScore: target.engagementScore,
          }))
        : undefined,
    };
    const retryTask = await this.createTask(retryInput);
    this.pushEvent(task, 'info', `已创建重试任务：${retryTask.id}`);
    this.pushEvent(retryTask, 'info', `由任务 ${task.id} 重试创建。`);
    await this.persistTask(task);
    await this.persistTask(retryTask);

    return retryTask;
  }

  async listAgentSessions(
    limit = 50,
    filter: AgentSessionListFilter = {},
  ): Promise<AgentSession[]> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    await this.hydrateAgentSessionsFromStore(Math.max(limit, 200), scope);
    return [...this.agentSessions.values()]
      .filter((session) => this.isInTenantScope(session, scope))
      .filter((session) => this.matchesAgentSessionFilter(session, filter))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async getAgentSession(id: string): Promise<AgentSession> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    const cached = this.agentSessions.get(id);
    const session =
      cached && this.isInTenantScope(cached, scope)
        ? cached
        : await this.loadStoredAgentSession(id, scope);
    if (!session || !this.isInTenantScope(session, scope)) {
      throw new NotFoundException('执行会话不存在');
    }
    return this.rememberAgentSession(session);
  }

  async createAgentSession(
    input: CreateAgentSessionInput,
  ): Promise<AgentSession> {
    const tenantScope = await this.resolveTenantScope();
    const instruction = input.instruction?.trim();
    if (!instruction) {
      throw new BadRequestException('请先输入要让本机 Agent 执行的指令');
    }

    const now = new Date().toISOString();
    const id = this.createId();
    const riskLevel = this.resolveAgentRisk(instruction);
    const executionScope =
      input.executionScope || this.resolveAgentScope(instruction);
    const commercialExecutionRequested =
      input.commercialExecutionRequested === true;
    const callerCommercialAllowed = this.currentActorCommercialAllowed();
    const commerciallyAuthorized =
      callerCommercialAllowed || this.allowLocalPlanBypass();
    const requestedSendMode =
      riskLevel === 'high' ? 'auto-send' : 'approval-send';
    const sendMode =
      commercialExecutionRequested &&
      commerciallyAuthorized &&
      riskLevel === 'high'
        ? 'auto-send'
        : riskLevel === 'high'
          ? 'approval-send'
          : 'draft-only';
    const safetyBoundary = this.createSafetyBoundary({
      riskLevel,
      requestedSendMode,
      sendMode,
      hasDestructiveIntent: this.hasDestructiveIntent(instruction),
      commercialExecutionRequested,
      callerCommercialAllowed,
    });
    const misfireProtection = this.createMisfireProtection(
      executionScope === 'desktop'
        ? 'wechat-reply-draft'
        : 'douyin-comment-reply',
      riskLevel,
    );
    const riskPolicy = this.createRiskPolicy({
      riskLevel,
      scope: executionScope,
      targetName:
        input.targetApp?.trim() ||
        this.resolveAgentTargetApp(instruction) ||
        '未指定目标',
      instruction,
      hasRemoteTakeover:
        executionScope === 'remote' ||
        /接管|远程控制|远程操作/.test(instruction),
    });
    const session: AgentSession = {
      id,
      ...tenantScope,
      title: input.title?.trim() || this.buildAgentTitle(instruction),
      instruction,
      status:
        riskLevel === 'high' || input.dryRun
          ? 'waiting_for_confirmation'
          : 'running',
      statusLabel: this.resolveAgentSessionStatusLabel(
        riskLevel === 'high' || input.dryRun
          ? 'waiting_for_confirmation'
          : 'running',
      ),
      executionScope,
      source: input.source || 'agent-console',
      createdAt: now,
      updatedAt: now,
      targetApp:
        input.targetApp?.trim() || this.resolveAgentTargetApp(instruction),
      targetUrl: input.targetUrl?.trim(),
      riskLevel,
      requiresDoubleConfirmation: riskLevel === 'high',
      commercialExecutablePermission: safetyBoundary.permissionStatus,
      safetyBoundary,
      misfireProtection,
      riskPolicy,
      resumeAction: input.resumeAction,
      metadata:
        input.metadata && typeof input.metadata === 'object'
          ? input.metadata
          : undefined,
      confirmations: [],
      events: [],
    };

    this.pushAgentEvent(
      session,
      'info',
      '指令已接收',
      '本机 Agent 已创建执行会话，开始解析目标、工具权限和风险动作。',
    );
    this.pushAgentEvent(
      session,
      'info',
      '执行范围',
      `本次会使用${this.resolveAgentScopeLabel(executionScope)}能力，所有外部提交动作会按受控执行策略推进，条件异常时停止并留证据。`,
      { type: 'text', label: '用户指令', value: instruction },
    );
    this.pushAgentEvent(
      session,
      safetyBoundary.permissionStatus === 'allowed' ? 'info' : 'warning',
      '试用/商用边界',
      safetyBoundary.message,
      {
        type: 'text',
        label: '执行权限',
        value: `正式商用可执行权限：${this.resolvePermissionStatusLabel(safetyBoundary.permissionStatus)}`,
      },
    );
    this.pushAgentEvent(
      session,
      'info',
      '阶段日志已开启',
      'Agent 会话创建完成，后续事件会进入证据回放时间线。',
      {
        type: 'stage_log',
        label: '阶段日志',
        value: `create-agent-session / scope=${executionScope} / risk=${riskLevel}`,
        stageKey: 'create-agent-session',
      },
    );
    if (riskPolicy.remoteTakeoverAuditRequired) {
      this.pushAgentEvent(
        session,
        'warning',
        '远程接管审计',
        riskPolicy.message,
        {
          type: 'stage_log',
          label: '远程接管审计',
          value: JSON.stringify(riskPolicy.remoteAudit, null, 2),
          stageKey: 'remote-takeover-audit',
        },
      );
      this.pushAgentEvent(
        session,
        'info',
        '远程审计字段',
        '已记录远程接管申请、目标、白名单命中、禁止动作和审计原因。',
        {
          type: 'diagnostic_bundle',
          label: '远程审计摘要',
          value: JSON.stringify(
            {
              targetName: riskPolicy.targetName,
              targetWhitelisted: riskPolicy.targetWhitelisted,
              forbiddenActions: riskPolicy.forbiddenActions,
              forbiddenActionHits: riskPolicy.forbiddenActionHits,
              auditRequiredReason: riskPolicy.auditRequiredReason,
            },
            null,
            2,
          ),
          stageKey: 'remote-takeover-audit',
        },
      );
    }

    if (riskLevel === 'high' || input.dryRun) {
      const confirmation = this.createAgentConfirmation(session, {
        title: '执行前确认',
        description:
          '这条指令可能触发发布、发送、改文件、删除或外部平台提交。请确认目标、内容和当前窗口后再继续。',
        actionLabel: input.dryRun ? '开始试运行' : '继续执行高风险动作',
        riskLevel: riskLevel === 'low' ? 'medium' : riskLevel,
      });
      session.confirmations.push(confirmation);
      session.nextAction = '请到“待我确认”确认后继续执行。';
      this.agentConfirmations.set(confirmation.id, confirmation);
      this.pushAgentEvent(
        session,
        'warning',
        '等待继续执行',
        confirmation.description,
        {
          type: 'text',
          label: '确认项',
          value: confirmation.requiredChecks
            .map((check) => check.label)
            .join(' / '),
        },
      );
    } else {
      session.nextAction = '正在执行，可在执行会话里继续补充指令或停止。';
      this.pushAgentEvent(
        session,
        'success',
        '开始执行',
        '低风险的任务已进入本机执行队列。',
      );
    }

    this.agentSessions.set(id, session);
    await this.persistAgentSession(session);
    return session;
  }

  async createPublishTrackingSession(input: {
    title: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentSession> {
    const tenantScope = await this.resolveTenantScope();
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: this.createId(),
      ...tenantScope,
      title: input.title.trim() || '发布任务',
      instruction: `记录发布任务：${input.title.trim() || '发布任务'}`,
      status: 'running',
      statusLabel: '运行中',
      executionScope: 'browser',
      source: 'publishing',
      createdAt: now,
      updatedAt: now,
      targetApp: '发布中心',
      riskLevel: 'high',
      requiresDoubleConfirmation: false,
      metadata: input.metadata,
      confirmations: [],
      events: [],
    };
    this.pushAgentEvent(
      session,
      'info',
      '发布任务已创建',
      '发布任务已经进入执行记录，平台结果会持续写入本次会话。',
      {
        type: 'stage_log',
        label: '发布任务',
        value: session.title,
        stageKey: 'publish-created',
      },
    );
    this.agentSessions.set(session.id, session);
    await this.persistAgentSession(session);
    return session;
  }

  async completePublishTrackingSession(
    id: string,
    input: { ok: boolean; message: string; evidenceCount?: number },
  ): Promise<AgentSession> {
    const session = await this.getAgentSession(id);
    session.status = input.ok ? 'completed' : 'failed';
    session.statusLabel = input.ok ? '已完成' : '执行失败';
    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
    session.nextAction = input.ok
      ? '请在发布记录查看平台回执和结果留存。'
      : '请查看失败原因，修复账号、素材或平台状态后重试。';
    this.pushAgentEvent(
      session,
      input.ok ? 'success' : 'error',
      input.ok ? '发布执行完成' : '发布执行失败',
      input.message,
      {
        type: input.ok ? 'stage_log' : 'failure_reason',
        label: '发布结果',
        value: input.message,
        stageKey: input.ok ? 'publish-completed' : 'publish-failed',
      },
    );
    session.metadata = {
      ...(session.metadata || {}),
      evidenceCount: input.evidenceCount ?? 0,
    };
    await this.persistAgentSession(session);
    return session;
  }

  async continueAgentSession(
    id: string,
    input: ContinueAgentSessionInput = {},
  ): Promise<AgentSession> {
    const session = await this.getAgentSession(id);
    if (session.status === 'cancelled' || session.status === 'completed') {
      return session;
    }
    const pendingConfirmations = this.getSessionPendingConfirmations(session);
    if (pendingConfirmations.length) {
      session.status = 'waiting_for_confirmation';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.nextAction = `还有 ${pendingConfirmations.length} 个确认项未处理，请先确认或拒绝后再继续。`;
      this.pushAgentEvent(
        session,
        'warning',
        '仍需人工确认',
        session.nextAction,
      );
      await this.persistAgentSession(session);
      return session;
    }
    const now = new Date().toISOString();
    if (input.instruction?.trim()) {
      this.pushAgentEvent(
        session,
        'info',
        '补充指令',
        input.instruction.trim(),
      );
    }
    session.status = 'running';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.updatedAt = now;
    session.nextAction =
      '继续执行中，遇到提交、发送、改文件等动作会再次暂停确认。';
    this.pushAgentEvent(
      session,
      'success',
      '继续执行',
      `${input.operator?.trim() || '用户'} 已要求本机 Agent 继续当前会话。`,
    );
    await this.persistAgentSession(session);
    return session;
  }

  async stopAgentSession(id: string): Promise<AgentSession> {
    const session = await this.getAgentSession(id);
    if (session.status === 'completed' || session.status === 'cancelled') {
      return session;
    }
    const stoppedAt = new Date().toISOString();
    this.recordRemoteAudit(
      session,
      'stopped',
      '用户',
      '用户停止了本机 Agent 执行。',
    );
    this.closePendingAgentConfirmations(session, 'rejected', {
      operator: '用户',
      note: '会话已停止，未处理确认项自动关闭。',
      decidedAt: stoppedAt,
    });
    session.status = 'cancelled';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.updatedAt = stoppedAt;
    session.completedAt = session.updatedAt;
    session.nextAction = '会话已停止。';
    this.pushAgentEvent(
      session,
      'warning',
      '已停止',
      '用户停止了本机 Agent 执行。',
    );
    await this.persistAgentSession(session);
    return session;
  }

  async archiveAgentSession(
    id: string,
    input: ArchiveAgentSessionInput = {},
  ): Promise<AgentSession> {
    const session = await this.getAgentSession(id);
    const archivedAt = new Date().toISOString();
    const operator = input.operator?.trim() || '用户';
    const reason = input.reason?.trim() || '用户从列表删除。';
    this.closePendingAgentConfirmations(session, 'rejected', {
      operator,
      note: reason,
      decidedAt: archivedAt,
    });
    session.status = 'cancelled';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.updatedAt = archivedAt;
    session.completedAt = session.completedAt || archivedAt;
    session.nextAction = '已从列表移除。';
    session.metadata = {
      ...(session.metadata || {}),
      hiddenFromAiEmployee: true,
      archivedAt,
      archiveReason: reason,
    };
    this.pushAgentEvent(session, 'warning', '已移除', reason);
    await this.persistAgentSession(session);
    return session;
  }

  async exportAgentSessionEvidence(
    id: string,
  ): Promise<AgentSessionEvidenceExportResult> {
    const session = await this.getAgentSession(id);
    await this.ensureAgentSessionEvidenceForExport(session);
    const evidenceItems = this.collectAgentSessionEvidence(session);
    const replayTimeline = this.buildAgentReplayTimeline(session);
    const evidenceSummary = this.buildAgentEvidenceSummary(
      session,
      evidenceItems,
    );
    const failureAnalysis = this.buildAgentFailureAnalysis(session);
    const auditTrail = this.buildAgentAuditTrail(session);
    const evidenceIndex = this.buildAgentEvidenceIndex(session, evidenceItems);
    const evidenceIntegrity = this.buildAgentEvidenceIntegrity(
      session,
      evidenceItems,
      evidenceIndex,
    );
    const exportStatus = evidenceIntegrity.status;
    const exportedAt = new Date().toISOString();
    const payload = {
      exportedAt,
      exportStatus,
      summary: evidenceSummary,
      integrity: evidenceIntegrity,
      session: {
        id: session.id,
        title: session.title,
        instruction: session.instruction,
        source: session.source,
        status: session.status,
        statusLabel: session.statusLabel,
        riskLevel: session.riskLevel,
        executionScope: session.executionScope,
        requiresDoubleConfirmation: session.requiresDoubleConfirmation,
        commercialExecutablePermission: session.commercialExecutablePermission,
        safetyBoundary: session.safetyBoundary,
        misfireProtection: session.misfireProtection,
        riskPolicy: session.riskPolicy,
        targetApp: session.targetApp,
        targetUrl: session.targetUrl,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        completedAt: session.completedAt,
        nextAction: session.nextAction,
        resumeAction: session.resumeAction
          ? session.resumeAction.kind === 'auto-upload-publish'
            ? {
                kind: session.resumeAction.kind,
                label: session.resumeAction.label,
                payloadCount: session.resumeAction.payloads.length,
              }
            : {
                kind: session.resumeAction.kind,
                label: session.resumeAction.label,
                articleId: session.resumeAction.articleId,
                targetHref: session.resumeAction.targetHref,
              }
          : undefined,
      },
      confirmations: session.confirmations,
      evidence: evidenceItems,
      evidenceIndex,
      evidenceByType: this.groupEvidenceByType(evidenceItems),
      failureAnalysis,
      auditTrail,
      replay: {
        timeline: replayTimeline,
        summary: {
          totalEvents: session.events.length,
          totalEvidence: evidenceItems.length,
          pendingConfirmations:
            this.getSessionPendingConfirmations(session).length,
          screenshots:
            evidenceSummary.byType.screenshot +
            evidenceSummary.byType.desktop_screenshot,
          pageSnapshots:
            evidenceSummary.byType.page_snapshot +
            evidenceSummary.byType.snapshot,
          stageLogs: evidenceSummary.byType.stage_log,
          failureReasons: evidenceSummary.byType.failure_reason,
          auditEvents: auditTrail.length,
        },
      },
      timeline: session.events,
    };

    return {
      filename: `agent-session-${session.id}-evidence.json`,
      mimeType: 'application/json',
      content: JSON.stringify(payload, null, 2),
      exportedAt,
      exportStatus,
      sessionId: session.id,
      evidenceCount: evidenceItems.length,
      timelineCount: replayTimeline.length,
    };
  }

  async listAgentSessionEvidence(
    id: string,
  ): Promise<AgentSessionEvidenceListResult> {
    const session = await this.getAgentSession(id);
    const items = this.collectAgentSessionEvidence(session);
    return {
      sessionId: session.id,
      evidenceCount: items.length,
      items,
    };
  }

  resolveEvidenceFilePath(filePath: string | undefined) {
    const rawPath = String(filePath || '').trim();
    if (!rawPath) {
      throw new BadRequestException('证据文件路径不能为空');
    }

    const normalizedPath = this.normalizeEvidenceFilePath(rawPath);
    const resolvedPath = resolve(normalizedPath);
    const allowedRoots = [
      resolve(this.getProjectLogRoot()),
      resolve(this.resolveLocalRuntimePaths().evidence),
      resolve(this.getProjectRoot(), '.local-logs'),
      resolve(this.getProjectRoot(), 'backend', '.local-logs'),
      resolve(process.cwd(), '.local-logs'),
      resolve('/tmp'),
    ];
    const isAllowed = allowedRoots.some(
      (root) => resolvedPath === root || resolvedPath.startsWith(`${root}/`),
    );
    if (!isAllowed) {
      throw new ForbiddenException('证据文件不在允许读取的目录内');
    }

    const extension = extname(resolvedPath).toLowerCase();
    const allowedExtensions = new Set([
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.json',
      '.txt',
      '.log',
    ]);
    if (!allowedExtensions.has(extension)) {
      throw new ForbiddenException('证据文件类型不允许直接打开');
    }
    if (!existsSync(resolvedPath)) {
      throw new NotFoundException('证据文件不存在');
    }

    return { filePath: resolvedPath };
  }

  resolveBrowserEvidenceFilePath(filename: string | undefined) {
    const rawFilename = String(filename || '').trim();
    if (!/^[A-Za-z0-9_.-]+\.(?:png|jpe?g|webp|gif)$/i.test(rawFilename)) {
      throw new ForbiddenException('浏览器证据文件名不合法');
    }
    const evidenceRoot =
      this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
      join(this.getProjectLogRoot(), 'browser-evidence');
    return this.resolveEvidenceFilePath(join(evidenceRoot, rawFilename));
  }

  private normalizeEvidenceFilePath(filePath: string) {
    const trimmed = filePath.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'file:') {
        return decodeURIComponent(parsed.pathname);
      }
    } catch {
      // Plain local filesystem paths are expected here.
    }

    const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/, '');
    if (/^\/Users\//.test(withoutOrigin) || withoutOrigin.startsWith('/tmp/')) {
      return decodeURIComponent(withoutOrigin);
    }
    return withoutOrigin;
  }

  async listAgentSessionConfirmations(
    id: string,
    status?: AgentConfirmationStatus,
  ): Promise<AgentConfirmationListItem[]> {
    const session = await this.getAgentSession(id);
    return this.getSessionConfirmations(session)
      .filter((confirmation) => !status || confirmation.status === status)
      .map((confirmation) => this.withAgentConfirmationSession(confirmation))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listAgentConfirmations(
    status?: AgentConfirmationStatus,
    sessionId?: string,
  ): Promise<AgentConfirmationListItem[]> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    await this.hydrateAgentConfirmationsFromStore(200, scope);
    await this.hydrateAgentSessionsFromStore(200, scope);
    return [...this.agentConfirmations.values()]
      .filter((confirmation) => this.isInTenantScope(confirmation, scope))
      .filter((confirmation) => !status || confirmation.status === status)
      .filter(
        (confirmation) => !sessionId || confirmation.sessionId === sessionId,
      )
      .map((confirmation) => this.withAgentConfirmationSession(confirmation))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private matchesAgentSessionFilter(
    session: AgentSession,
    filter: AgentSessionListFilter,
  ) {
    if (filter.status && session.status !== filter.status) {
      return false;
    }
    if (filter.source && session.source !== filter.source) {
      return false;
    }
    if (
      filter.executionScope &&
      session.executionScope !== filter.executionScope
    ) {
      return false;
    }
    if (filter.riskLevel && session.riskLevel !== filter.riskLevel) {
      return false;
    }
    if (
      filter.targetApp &&
      !String(session.targetApp || '')
        .toLowerCase()
        .includes(filter.targetApp.trim().toLowerCase())
    ) {
      return false;
    }
    if (
      typeof filter.hasPendingConfirmation === 'boolean' &&
      this.getSessionPendingConfirmations(session).length > 0 !==
        filter.hasPendingConfirmation
    ) {
      return false;
    }
    if (
      typeof filter.hasEvidence === 'boolean' &&
      this.collectAgentSessionEvidence(session).length > 0 !==
        filter.hasEvidence
    ) {
      return false;
    }
    const keyword = filter.keyword?.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return [
      session.title,
      session.instruction,
      session.targetApp,
      session.targetUrl,
      session.nextAction,
      session.statusLabel,
      session.events
        .map(
          (event) =>
            `${event.title} ${event.message} ${event.evidence?.value || ''}`,
        )
        .join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  }

  private withAgentConfirmationSession(
    confirmation: AgentConfirmation,
  ): AgentConfirmationListItem {
    const confirmationScope = this.tenantScopeForRecord(confirmation);
    if (confirmation.sessionId?.startsWith('interaction-task:')) {
      const taskId = confirmation.sessionId.replace('interaction-task:', '');
      const task = this.tasks.get(taskId);
      if (task && this.isInTenantScope(task, confirmationScope)) {
        return {
          ...confirmation,
          session: {
            id: confirmation.sessionId,
            title: `客户互动：${this.resolveTypeLabel(task.type)}`,
            source: 'agent-console',
            status: task.status as unknown as AgentSessionStatus,
            statusLabel: task.statusLabel || task.status,
            riskLevel: 'medium',
            updatedAt: task.updatedAt || confirmation.createdAt,
            nextAction: task.nextAction,
          },
        };
      }
      return confirmation;
    }

    const session = this.agentSessions.get(confirmation.sessionId);
    if (!session || !this.isInTenantScope(session, confirmationScope)) {
      return confirmation;
    }

    return {
      ...confirmation,
      session: {
        id: session.id,
        title: session.title,
        source: session.source,
        status: session.status,
        statusLabel: session.statusLabel,
        riskLevel: session.riskLevel,
        updatedAt: session.updatedAt,
        nextAction: session.nextAction,
        resumeAction: session.resumeAction,
      },
    };
  }

  private async getAgentConfirmation(id: string): Promise<{
    confirmation: AgentConfirmation;
    session: AgentSession;
  } | null> {
    await this.ensureTaskStore();
    const scope = await this.resolveTenantScope();
    const cached = this.agentConfirmations.get(id);
    if (cached && this.isInTenantScope(cached, scope)) {
      const session = await this.getAgentSession(cached.sessionId);
      const confirmation =
        this.getSessionConfirmations(session).find((item) => item.id === id) ||
        cached;
      this.agentConfirmations.set(confirmation.id, confirmation);
      return { confirmation, session };
    }

    const confirmationRow = await this.prisma.agentConfirmation.findFirst({
      where: { id, ...scope },
    });
    const confirmation = confirmationRow?.confirmationJson as
      AgentConfirmation | undefined;
    if (!confirmationRow || !confirmation?.id) {
      return null;
    }
    confirmation.tenantId = confirmationRow.tenantId;
    confirmation.userId = confirmationRow.userId;
    this.agentConfirmations.set(confirmation.id, confirmation);
    const session = await this.getAgentSession(confirmation.sessionId);
    const sessionConfirmation =
      this.getSessionConfirmations(session).find((item) => item.id === id) ||
      confirmation;
    this.syncAgentConfirmationIntoSession(session, sessionConfirmation);
    return { confirmation: sessionConfirmation, session };
  }

  private rememberAgentSession(session: AgentSession): AgentSession {
    const scope = this.tenantScopeForRecord(session);
    session.confirmations = this.getSessionConfirmations(session).map(
      (confirmation) => ({
        ...confirmation,
        ...scope,
        sessionId: session.id,
      }),
    );
    this.agentSessions.set(session.id, session);
    session.confirmations.forEach((confirmation) => {
      this.agentConfirmations.set(confirmation.id, confirmation);
    });
    return session;
  }

  private mergeAgentConfirmations(
    left: AgentConfirmation[],
    right: AgentConfirmation[],
  ): AgentConfirmation[] {
    const byId = new Map<string, AgentConfirmation>();
    [...left, ...right].forEach((confirmation) => {
      if (confirmation?.id) {
        byId.set(confirmation.id, confirmation);
      }
    });
    return [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  private getSessionConfirmations(session: AgentSession): AgentConfirmation[] {
    const sessionScope = this.tenantScopeForRecord(session);
    const byId = new Map<string, AgentConfirmation>();
    (session.confirmations || []).forEach((confirmation) => {
      if (confirmation?.id) {
        byId.set(confirmation.id, confirmation);
      }
    });
    [...this.agentConfirmations.values()]
      .filter(
        (confirmation) =>
          confirmation.sessionId === session.id &&
          this.isInTenantScope(confirmation, sessionScope),
      )
      .forEach((confirmation) => {
        byId.set(confirmation.id, confirmation);
      });
    return [...byId.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  private getSessionPendingConfirmations(session: AgentSession) {
    return this.getSessionConfirmations(session).filter(
      (confirmation) => confirmation.status === 'pending',
    );
  }

  private syncAgentConfirmationIntoSession(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ) {
    const confirmations = this.getSessionConfirmations(session);
    const index = confirmations.findIndex(
      (item) => item.id === confirmation.id,
    );
    if (index >= 0) {
      confirmations[index] = confirmation;
    } else {
      confirmations.unshift(confirmation);
    }
    session.confirmations = confirmations;
    this.agentConfirmations.set(confirmation.id, confirmation);
  }

  private closePendingAgentConfirmations(
    session: AgentSession,
    status: Extract<AgentConfirmationStatus, 'rejected' | 'expired'>,
    input: { operator: string; note: string; decidedAt: string },
  ) {
    this.getSessionPendingConfirmations(session).forEach((confirmation) => {
      confirmation.status = status;
      confirmation.operator = input.operator;
      confirmation.note = input.note;
      confirmation.decidedAt = input.decidedAt;
      this.syncAgentConfirmationIntoSession(session, confirmation);
    });
  }

  private collectAgentSessionEvidence(session: AgentSession): AgentEvidence[] {
    return session.events
      .filter((event) => event.evidence)
      .map((event) => ({
        ...event.evidence!,
        id: event.evidence?.id || event.id,
        eventId: event.id,
        sessionId: session.id,
        createdAt: event.evidence?.createdAt || event.createdAt,
      }));
  }

  private buildAgentReplayTimeline(session: AgentSession) {
    return session.events.map((event, index) => ({
      seq: index + 1,
      id: event.id,
      level: event.level,
      title: event.title,
      message: event.message,
      createdAt: event.createdAt,
      evidence: event.evidence
        ? {
            ...event.evidence,
            id: event.evidence.id || event.id,
            eventId: event.id,
            sessionId: session.id,
            createdAt: event.evidence.createdAt || event.createdAt,
          }
        : undefined,
    }));
  }

  private buildAgentEvidenceSummary(
    session: AgentSession,
    evidenceItems: AgentEvidence[],
  ) {
    const byType = this.groupEvidenceByType(evidenceItems);
    const stages = [
      ...new Set(evidenceItems.map((item) => item.stageKey).filter(Boolean)),
    ];
    const failedEvents = session.events.filter(
      (event) =>
        event.level === 'error' || event.evidence?.type === 'failure_reason',
    );
    return {
      sessionId: session.id,
      generatedAt: new Date().toISOString(),
      riskLevel: session.riskLevel,
      status: session.status,
      totalEvents: session.events.length,
      totalEvidence: evidenceItems.length,
      byType,
      stages,
      screenshotCount: byType.screenshot + byType.desktop_screenshot,
      pageSnapshotCount: byType.page_snapshot + byType.snapshot,
      desktopScreenshotCount: byType.desktop_screenshot,
      stageLogCount: byType.stage_log,
      failureReasonCount: byType.failure_reason,
      pendingConfirmations: this.getSessionPendingConfirmations(session).length,
      remoteAuditCount: session.riskPolicy?.remoteAudit.length || 0,
      failureEventCount: failedEvents.length,
    };
  }

  private groupEvidenceByType(evidenceItems: AgentEvidence[]) {
    const empty: Record<AgentEvidence['type'], number> = {
      text: 0,
      snapshot: 0,
      screenshot: 0,
      page_snapshot: 0,
      desktop_screenshot: 0,
      stage_log: 0,
      failure_reason: 0,
      diagnostic_bundle: 0,
      file: 0,
    };
    return evidenceItems.reduce((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, empty);
  }

  private buildAgentFailureAnalysis(session: AgentSession) {
    const failureEvents = session.events.filter(
      (event) =>
        event.level === 'error' || event.evidence?.type === 'failure_reason',
    );
    const rejectedConfirmations = this.getSessionConfirmations(session).filter(
      (confirmation) => confirmation.status === 'rejected',
    );
    return {
      failed:
        session.status === 'failed' ||
        failureEvents.length > 0 ||
        rejectedConfirmations.length > 0,
      status: session.status,
      nextAction: session.nextAction,
      failedAt:
        failureEvents.at(-1)?.createdAt ||
        rejectedConfirmations.at(-1)?.decidedAt,
      reasons: [
        ...failureEvents.map((event) => event.evidence?.value || event.message),
        ...rejectedConfirmations.map(
          (confirmation) => confirmation.note || `${confirmation.title} 被拒绝`,
        ),
      ].filter(Boolean),
      events: failureEvents.map((event) => ({
        id: event.id,
        title: event.title,
        message: event.message,
        createdAt: event.createdAt,
        evidence: event.evidence,
      })),
      rejectedConfirmations: rejectedConfirmations.map((confirmation) => ({
        id: confirmation.id,
        title: confirmation.title,
        operator: confirmation.operator,
        note: confirmation.note,
        decidedAt: confirmation.decidedAt,
      })),
    };
  }

  private buildAgentAuditTrail(session: AgentSession) {
    const confirmationAudit = this.getSessionConfirmations(session)
      .filter((confirmation) => confirmation.status !== 'pending')
      .map((confirmation) => ({
        type: 'confirmation-decision' as const,
        action: confirmation.status,
        operator: confirmation.operator || 'system',
        reason: confirmation.note || confirmation.actionLabel,
        createdAt: confirmation.decidedAt || confirmation.createdAt,
        confirmationId: confirmation.id,
      }));
    const remoteAudit = (session.riskPolicy?.remoteAudit || []).map(
      (audit) => ({
        type: 'remote-control' as const,
        action: audit.action,
        operator: audit.operator,
        reason: audit.reason,
        createdAt: audit.createdAt,
      }),
    );
    return [...remoteAudit, ...confirmationAudit].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  private buildAgentEvidenceIndex(
    session: AgentSession,
    evidenceItems = this.collectAgentSessionEvidence(session),
  ) {
    const byType = this.groupEvidenceByType(evidenceItems);
    return {
      counts: byType,
      stageLogs: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'stage_log'),
      ),
      failureReasons: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'failure_reason'),
      ),
      riskAudits: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'diagnostic_bundle'),
      ),
      confirmations: this.getSessionConfirmations(session).map(
        (confirmation) => ({
          id: confirmation.id,
          title: confirmation.title,
          status: confirmation.status,
          operator: confirmation.operator,
          createdAt: confirmation.createdAt,
          decidedAt: confirmation.decidedAt,
        }),
      ),
      browser: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) =>
          ['screenshot', 'page_snapshot', 'snapshot'].includes(item.type),
        ),
      ),
      desktop: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => item.type === 'desktop_screenshot'),
      ),
      text: this.toAgentEvidenceIndexItems(
        evidenceItems.filter((item) => ['text', 'file'].includes(item.type)),
      ),
    };
  }

  private toAgentEvidenceIndexItems(items: AgentEvidence[]) {
    return items.map((item) => ({
      id: item.id,
      eventId: item.eventId,
      type: item.type,
      label: item.label,
      stageKey: item.stageKey,
      createdAt: item.createdAt,
      artifactUrl: item.artifactUrl,
      valuePreview: this.previewEvidenceValue(item.value),
    }));
  }

  private buildAgentEvidenceIntegrity(
    session: AgentSession,
    evidenceItems = this.collectAgentSessionEvidence(session),
    evidenceIndex = this.buildAgentEvidenceIndex(session, evidenceItems),
  ) {
    const missing = [
      evidenceItems.length ? '' : '缺少证据项',
      evidenceIndex.stageLogs.length ? '' : '缺少阶段日志',
      session.nextAction ? '' : '缺少 nextAction',
      evidenceIndex.riskAudits.length ? '' : '缺少风险审计',
      session.riskLevel !== 'high' || session.confirmations.length
        ? ''
        : '缺少确认记录',
      session.status !== 'failed' || evidenceIndex.failureReasons.length
        ? ''
        : '缺少失败原因证据',
      this.agentSessionNeedsBrowserEvidence(session) &&
      !evidenceIndex.browser.length
        ? '缺少浏览器证据索引'
        : '',
      this.agentSessionNeedsDesktopEvidence(session) &&
      !evidenceIndex.desktop.length
        ? '缺少桌面证据索引'
        : '',
      evidenceIndex.text.length ? '' : '缺少文本证据索引',
    ].filter(Boolean);

    return {
      status: missing.length ? ('FAILED' as const) : ('OK' as const),
      missing,
      required: [
        '阶段日志',
        '失败原因',
        'nextAction',
        '风险审计',
        '确认记录',
        '浏览器/桌面/文本证据索引',
      ],
      checkedAt: new Date().toISOString(),
    };
  }

  private async ensureAgentSessionEvidenceForExport(session: AgentSession) {
    let evidenceItems = this.collectAgentSessionEvidence(session);
    if (evidenceItems.length > 0) {
      return;
    }

    const failedAt = new Date().toISOString();
    session.status = 'failed';
    session.statusLabel = this.resolveAgentSessionStatusLabel('failed');
    session.updatedAt = failedAt;
    session.completedAt = failedAt;
    session.nextAction =
      '证据链为空，导出已标记 FAILED；请重新执行会话并确认阶段日志、确认记录和浏览器/桌面证据已生成。';
    this.pushAgentEvent(
      session,
      'error',
      '证据链缺失',
      'Agent 会话没有任何可导出的证据项，不能生成空证据包。',
      {
        type: 'failure_reason',
        label: '证据链缺失',
        value: 'Agent session evidence export blocked: no evidence items',
        stageKey: 'evidence-export',
      },
    );
    evidenceItems = this.collectAgentSessionEvidence(session);
    if (!evidenceItems.some((item) => item.type === 'stage_log')) {
      this.pushAgentEvent(
        session,
        'error',
        '阶段日志缺失',
        '证据导出失败，缺少阶段日志。',
        {
          type: 'stage_log',
          label: '证据导出失败',
          value: 'evidence-export / FAILED / missing evidence',
          stageKey: 'evidence-export',
        },
      );
    }
    await this.persistAgentSession(session);
  }

  async approveAgentConfirmation(
    id: string,
    input: AgentConfirmationDecisionInput = {},
    riskContext?: BackendRiskContext,
  ): Promise<AgentSession> {
    const scope = await this.resolveTenantScope();
    const cached = this.agentConfirmations.get(id);
    if (
      cached?.sessionId?.startsWith('interaction-task:') &&
      this.isInTenantScope(cached, scope)
    ) {
      return this.approveInteractionTaskConfirmation(cached, input);
    }

    const loaded = await this.getAgentConfirmation(id);
    if (!loaded) {
      throw new NotFoundException('确认项不存在');
    }
    const { confirmation, session } = loaded;
    if (confirmation.status !== 'pending') {
      return session;
    }

    const riskAudit = assertBackendRiskGate({
      action: 'agent-confirmation-approve',
      target: `${session.executionScope}:${session.targetApp || session.title}`,
      riskLevel: confirmation.riskLevel,
      requiresConfirmation: true,
      confirmation: input.riskConfirmation,
      context: riskContext,
      reason: confirmation.description,
    });

    const missingChecks = confirmation.requiredChecks.filter(
      (check) => check.required && input.confirmedChecks?.[check.key] !== true,
    );
    const blockedChecks = confirmation.requiredChecks.filter(
      (check) => check.required && check.status === 'blocked',
    );
    if (blockedChecks.length) {
      throw new BadRequestException(
        `当前不能批准，请先处理：${blockedChecks.map((check) => check.label).join('、')}`,
      );
    }
    if (missingChecks.length) {
      throw new BadRequestException(
        `请先确认：${missingChecks.map((check) => check.label).join('、')}`,
      );
    }

    confirmation.status = 'approved';
    confirmation.operator = input.operator?.trim() || '用户';
    confirmation.note = input.note?.trim();
    confirmation.confirmedChecks = input.confirmedChecks;
    confirmation.decidedAt = new Date().toISOString();
    this.syncAgentConfirmationIntoSession(session, confirmation);
    if (session.riskPolicy?.remoteTakeoverAuditRequired) {
      session.riskPolicy.remoteAudit.push({
        action: 'approved',
        operator: confirmation.operator,
        reason: confirmation.note || confirmation.actionLabel,
        createdAt: confirmation.decidedAt,
      });
    }
    session.updatedAt = confirmation.decidedAt;
    session.status = 'running';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.nextAction = '确认通过，正在继续执行原会话。';
    this.recordRemoteAudit(
      session,
      'started',
      confirmation.operator,
      '确认通过后恢复本机执行。',
    );
    this.pushAgentEvent(
      session,
      'success',
      '确认通过',
      `${confirmation.operator} 已确认：${confirmation.actionLabel}`,
      {
        type: 'stage_log',
        label: '审批日志',
        value: JSON.stringify(
          {
            operator: confirmation.operator,
            action: confirmation.actionLabel,
            checks: confirmation.confirmedChecks,
            remoteAudit: session.riskPolicy?.remoteAudit,
          },
          null,
          2,
        ),
        stageKey: 'approval',
      },
    );
    this.pushAgentEvent(
      session,
      'warning',
      '后端风控审批已记录',
      '账号、设备、动作、风险等级和确认记录已写入审计事件。',
      {
        type: 'diagnostic_bundle',
        label: '后端风控审计',
        value: JSON.stringify(riskAudit, null, 2),
        stageKey: 'approval',
      },
    );
    await this.persistAgentConfirmation(confirmation);
    await this.persistAgentSession(session);
    await this.resumeAgentSessionAfterApproval(session, confirmation);
    return session;
  }

  private async approveInteractionTaskConfirmation(
    confirmation: AgentConfirmation,
    input: AgentConfirmationDecisionInput = {},
  ): Promise<AgentSession> {
    const scope = this.tenantScopeForRecord(confirmation);
    const taskId = confirmation.sessionId.replace('interaction-task:', '');
    const cachedTask = this.tasks.get(taskId);
    const task =
      cachedTask && this.isInTenantScope(cachedTask, scope)
        ? cachedTask
        : await this.loadStoredTask(taskId, scope);
    if (!task) {
      throw new NotFoundException('互动任务不存在');
    }
    if (task.status !== 'waiting_for_send_confirmation') {
      confirmation.status = 'approved';
      confirmation.decidedAt = new Date().toISOString();
      await this.persistAgentConfirmation(confirmation);
      return this.createSyntheticSessionForConfirmation(confirmation);
    }

    confirmation.status = 'approved';
    confirmation.operator = input.operator?.trim() || '用户';
    confirmation.note = input.note?.trim();
    confirmation.confirmedChecks = input.confirmedChecks;
    confirmation.decidedAt = new Date().toISOString();
    await this.persistAgentConfirmation(confirmation);

    await this.approveTask(task.id, {
      operator: confirmation.operator,
      note: confirmation.note,
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'interaction-approval',
        confirmedRiskLevel: task.riskLevel || 'medium',
        operator: confirmation.operator,
        reason: confirmation.note || confirmation.description,
        confirmedAt: confirmation.decidedAt,
      },
      targetConfirmed: true,
      contentConfirmed: true,
      currentWindowConfirmed: true,
      contactConfirmed: true,
      draftBeforeFillConfirmed: true,
      checklistConfirmed: true,
      commercialPermissionConfirmed: true,
      misfireProtectionConfirmed: true,
      doubleConfirmationConfirmed: task.requiresDoubleConfirmation
        ? true
        : undefined,
      targetContact: task.targetName,
    });

    return this.createSyntheticSessionForConfirmation(confirmation);
  }

  private createSyntheticSessionForConfirmation(
    confirmation: AgentConfirmation,
  ): AgentSession {
    return {
      id: confirmation.sessionId,
      tenantId: confirmation.tenantId,
      userId: confirmation.userId,
      title: confirmation.title,
      instruction: confirmation.description,
      status: 'running',
      statusLabel: '执行中',
      executionScope: 'browser',
      source: 'agent-console',
      createdAt: confirmation.createdAt,
      updatedAt: confirmation.decidedAt || new Date().toISOString(),
      riskLevel: confirmation.riskLevel,
      confirmations: [confirmation],
      events: [],
    };
  }

  async rejectAgentConfirmation(
    id: string,
    input: AgentConfirmationDecisionInput = {},
  ): Promise<AgentSession> {
    const scope = await this.resolveTenantScope();
    const cached = this.agentConfirmations.get(id);
    if (
      cached?.sessionId?.startsWith('interaction-task:') &&
      this.isInTenantScope(cached, scope)
    ) {
      return this.rejectInteractionTaskConfirmation(cached, input);
    }

    const loaded = await this.getAgentConfirmation(id);
    if (!loaded) {
      throw new NotFoundException('确认项不存在');
    }
    const { confirmation, session } = loaded;
    if (confirmation.status !== 'pending') {
      return session;
    }
    confirmation.status = 'rejected';
    confirmation.operator = input.operator?.trim() || '用户';
    confirmation.note = input.note?.trim();
    confirmation.decidedAt = new Date().toISOString();
    this.syncAgentConfirmationIntoSession(session, confirmation);
    if (session.riskPolicy?.remoteTakeoverAuditRequired) {
      session.riskPolicy.remoteAudit.push({
        action: 'rejected',
        operator: confirmation.operator,
        reason: confirmation.note || '用户拒绝继续执行',
        createdAt: confirmation.decidedAt,
      });
    }
    session.status = 'cancelled';
    session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
    session.updatedAt = confirmation.decidedAt;
    session.completedAt = confirmation.decidedAt;
    session.nextAction = '确认被拒绝，会话已停止。';
    this.pushAgentEvent(
      session,
      'warning',
      '确认被拒绝',
      confirmation.note || '用户拒绝继续执行。',
      {
        type: 'stage_log',
        label: '审批日志',
        value: JSON.stringify(session.riskPolicy?.remoteAudit || [], null, 2),
        stageKey: 'approval',
      },
    );
    this.pushAgentEvent(
      session,
      'error',
      '执行被人工拒绝',
      confirmation.note || '用户拒绝继续执行。',
      {
        type: 'failure_reason',
        label: '拒绝原因',
        value: confirmation.note || '用户拒绝继续执行。',
        stageKey: 'approval',
      },
    );
    await this.persistAgentConfirmation(confirmation);
    await this.persistAgentSession(session);
    return session;
  }

  private async rejectInteractionTaskConfirmation(
    confirmation: AgentConfirmation,
    input: AgentConfirmationDecisionInput = {},
  ): Promise<AgentSession> {
    const scope = this.tenantScopeForRecord(confirmation);
    const taskId = confirmation.sessionId.replace('interaction-task:', '');
    const cachedTask = this.tasks.get(taskId);
    const task =
      cachedTask && this.isInTenantScope(cachedTask, scope)
        ? cachedTask
        : await this.loadStoredTask(taskId, scope);

    confirmation.status = 'rejected';
    confirmation.operator = input.operator?.trim() || '用户';
    confirmation.note = input.note?.trim() || '用户拒绝发送';
    confirmation.decidedAt = new Date().toISOString();
    await this.persistAgentConfirmation(confirmation);

    if (task && task.status === 'waiting_for_send_confirmation') {
      task.status = 'skipped';
      task.statusLabel = this.resolveStatusLabel('skipped');
      task.nextAction = `用户拒绝发送：${confirmation.note}`;
      task.completedAt = confirmation.decidedAt;
      this.setTaskStep(task, 'send-approval', 'skipped', '用户拒绝发送。');
      this.setTaskStep(
        task,
        'send-result',
        'skipped',
        '用户拒绝发送，未执行。',
      );
      await this.persistTask(task);
    }

    return this.createSyntheticSessionForConfirmation(confirmation);
  }

  async clearPendingConfirmations(): Promise<{ cleared: number }> {
    const scope = await this.resolveTenantScope();
    await this.hydrateAgentConfirmationsFromStore(500, scope);
    await this.hydrateAgentSessionsFromStore(200, scope);
    const pending = [...this.agentConfirmations.values()].filter(
      (c) => this.isInTenantScope(c, scope) && c.status === 'pending',
    );
    const now = new Date().toISOString();
    for (const confirmation of pending) {
      confirmation.status = 'rejected';
      confirmation.operator = '系统清理';
      confirmation.note = '批量清理历史确认项';
      confirmation.decidedAt = now;
      await this.persistAgentConfirmation(confirmation);
      const session = this.agentSessions.get(confirmation.sessionId);
      if (session && this.isInTenantScope(session, scope)) {
        this.syncAgentConfirmationIntoSession(session, confirmation);
        if (
          session.status === 'waiting_for_confirmation' ||
          session.status === 'running'
        ) {
          session.status = 'cancelled';
          session.statusLabel = this.resolveAgentSessionStatusLabel(
            session.status,
          );
          session.updatedAt = now;
          session.completedAt = now;
          session.nextAction = '历史确认项已清理，会话已停止。';
          await this.persistAgentSession(session);
        }
      }
    }
    return { cleared: pending.length };
  }

  private runInteractionTaskLifecycle(taskId: string) {
    const scheduledTask = this.tasks.get(taskId);
    const startDelayMs = scheduledTask
      ? this.resolveCustomerServiceLifecycleDelayMs(scheduledTask)
      : 0;
    setTimeout(async () => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'queued') return;
      this.setTaskStep(
        task,
        'environment',
        'running',
        '正在检查 发布服务、平台账号和本地文件访问。',
      );
      this.pushEvent(task, 'info', '阶段日志：环境检查开始。', {
        type: 'stage_log',
        label: '环境检查日志',
        value: 'checking local engine, platform account and file access',
        stageKey: 'environment',
      });
      this.updateTask(
        task,
        'running',
        '本地引擎已领取任务，开始检查执行环境。',
        {
          nextAction: '检查平台登录态和目标对象。',
        },
      );
      this.pushEvent(
        task,
        'info',
        '浏览器控制、桌面控制和文件访问状态开始检查。',
      );
      if (task.executionMode === 'browser-assisted') {
        await this.persistTask(task);
        await this.runBrowserAssistedTaskWithQueue(task.id).catch(
          async (error) => {
            const message =
              error instanceof Error ? error.message : '真实执行预检失败';
            this.setTaskStep(task, 'send-result', 'blocked', message);
            this.updateTask(task, 'failed', message, {
              failureReason: message,
              nextAction: '请检查本地引擎、账号登录态和执行器日志后重试。',
              completedAt: new Date().toISOString(),
            });
            await this.persistTask(task);
          },
        );
      } else {
        this.setTaskStep(
          task,
          'account-entry',
          'skipped',
          '内部记录任务不需要打开平台账号后台。',
        );
      }
    }, 400 + startDelayMs);

    setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'running') return;
      if (task.executionMode === 'browser-assisted') {
        return;
      }
      this.setTaskStep(
        task,
        'environment',
        'completed',
        '基础执行环境检查完成。',
      );
      this.setTaskStep(
        task,
        'target-read',
        'running',
        '正在读取或定位目标对象。',
      );
      this.pushEvent(task, 'info', `已锁定目标对象：${task.targetName}`, {
        type: 'page_snapshot',
        label: '目标对象',
        value: task.targetName,
        stageKey: 'target-read',
      });
      this.pushEvent(task, 'info', `已读取原文：${task.sourceText}`, {
        type:
          task.type === 'wechat-reply-draft'
            ? 'desktop_screenshot'
            : 'page_snapshot',
        label: task.type === 'wechat-reply-draft' ? '桌面会话快照' : '页面快照',
        value: task.sourceText,
        stageKey: 'target-read',
      });
      if (task.batchTargets?.length) {
        this.pushEvent(
          task,
          'info',
          `批量读取完成：${task.batchTargets.length} 个对象。`,
        );
      }
      this.setTaskStep(
        task,
        'target-read',
        'completed',
        `已读取目标内容：${task.targetName}`,
      );
    }, 900 + startDelayMs);

    setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'running') return;
      if (task.executionMode === 'browser-assisted') return;

      if (task.type === 'customer-follow-up') {
        this.setTaskStep(
          task,
          'reply-generate',
          'completed',
          '跟进话术已生成。',
        );
        this.pushEvent(task, 'info', '阶段日志：跟进话术已生成。', {
          type: 'stage_log',
          label: '生成日志',
          value: task.replyText,
          stageKey: 'reply-generate',
        });

        this.setTaskStep(
          task,
          'send-approval',
          'completed',
          task.followUpMethod === 'wechat' || task.followUpMethod === 'message'
            ? '客户跟进话术已生成，等待继续在微信/消息中处理。'
            : '客户跟进任务等待人工完成。',
        );
        this.pushEvent(
          task,
          'info',
          `客户跟进方式：${task.followUpMethod || '未指定'}，等待继续完成。`,
        );
        this.pushEvent(task, 'warning', `待继续跟进：${task.replyText}`, {
          type: 'text',
          label: '跟进话术',
          value: task.replyText,
          stageKey: 'send-approval',
        });
        this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
          nextAction: '请在人工完成跟进后手动标记任务完成。',
        });
        this.updateTask(
          task,
          'waiting_for_send_confirmation',
          '客户跟进任务等待继续完成。',
          {
            nextAction: '完成电话或线下跟进后，标记任务完成。',
          },
        );
        this.persistTask(task);
        return;
      }

      this.setTaskStep(task, 'reply-generate', 'running', '正在生成回复草稿。');
      this.setTaskStep(task, 'reply-generate', 'completed', '回复草稿已生成。');
      this.pushEvent(task, 'info', '阶段日志：回复草稿已生成。', {
        type: 'stage_log',
        label: '生成日志',
        value: task.replyText,
        stageKey: 'reply-generate',
      });

      if (this.hasNoInteractionTarget(task)) {
        this.setTaskStep(task, 'target-read', 'skipped', '没有可处理对象。');
        this.setTaskStep(
          task,
          'send-approval',
          'skipped',
          '无对象，不进入执行保护。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', '任务以无对象结束。');
        const noTargetEvent = this.pushEvent(
          task,
          'warning',
          '无对象：本次没有可处理评论、私信、微信会话、群或客户。',
          {
            type: 'stage_log',
            label: '无对象',
            value: `${task.type} / ${task.targetName}`,
            stageKey: 'no-target',
          },
        );
        this.markQueuedBatchTargets(task, 'no_target', '无可处理对象', {
          nextAction:
            '无需处理；如对象来自外部列表，请补充客户、群或朋友圈素材后重新创建任务。',
          evidenceEventIds: [noTargetEvent.id],
        });
        this.updateTask(
          task,
          'no_target',
          '没有可处理对象，任务未执行发送或发布。',
          {
            failureReason: undefined,
            nextAction:
              '无需处理；如对象来自外部列表，请补充客户、群或朋友圈素材后重新创建任务。',
            completedAt: new Date().toISOString(),
          },
        );
        return;
      }

      if (task.sendMode === 'draft-only') {
        this.setTaskStep(
          task,
          'send-approval',
          'skipped',
          '仅生成内容，不进入受控执行。',
        );
        this.setTaskStep(task, 'send-result', 'completed', '草稿任务完成。');
        const completedEvent = this.pushEvent(
          task,
          'success',
          task.batchTargets && task.batchTargets.length > 1
            ? `批量草稿内容已生成 ${task.batchTargets.length} 条。`
            : `草稿内容：${task.replyText}`,
          {
            type: 'diagnostic_bundle',
            label: '草稿诊断摘要',
            value: `draft-only completed / targets=${task.batchTargets?.length || 1}`,
            stageKey: 'send-result',
          },
        );
        const completedCount = this.completeQueuedBatchTargets(task, {
          nextAction: '请在目标平台确认草稿。',
          evidenceEventIds: [completedEvent.id],
        });
        this.updateTask(
          task,
          'completed',
          completedCount > 1
            ? `批量草稿已生成 ${completedCount} 条，等待人工复制或发送。`
            : '草稿已生成，等待人工复制或发送。',
          {
            nextAction: '请在目标平台确认草稿。',
            completedAt: new Date().toISOString(),
          },
        );
        return;
      }

      if (task.sendMode === 'auto-send') {
        this.setTaskStep(
          task,
          'send-approval',
          'skipped',
          '自动发送模式跳过人工确认。',
        );
        this.setTaskStep(
          task,
          'send-result',
          'blocked',
          '自动发送缺少真实执行器。',
        );
        const blockedEvent = this.pushEvent(
          task,
          'error',
          task.batchTargets && task.batchTargets.length > 1
            ? `批量自动发送缺少真实执行器，已阻断 ${task.batchTargets.length} 条。`
            : `自动发送缺少真实执行器，已阻断：${task.replyText}`,
          {
            type: 'diagnostic_bundle',
            label: '自动发送诊断摘要',
            value: `auto-send blocked / targets=${task.batchTargets?.length || 1}`,
            stageKey: 'send-result',
          },
        );
        const failedCount = this.markQueuedBatchTargets(
          task,
          'failed',
          '自动发送缺少真实执行器',
          {
            nextAction:
              '请接入真实发送按钮点击、回读和失败识别能力，或切到受控发送。',
            evidenceEventIds: [blockedEvent.id],
          },
        );
        this.updateTask(
          task,
          'failed',
          failedCount > 1
            ? `批量自动发送缺少真实执行器，已阻断 ${failedCount} 条。`
            : '自动发送缺少真实执行器，任务已阻断。',
          {
            failureReason: '自动发送缺少真实执行器',
            nextAction:
              '请接入真实发送按钮点击、回读和失败识别能力，或切到确认后发送。',
            completedAt: new Date().toISOString(),
          },
        );
        return;
      }

      this.setTaskStep(
        task,
        'send-approval',
        'running',
        '已生成回复，等待继续执行。',
      );
      const waitingEvent = this.pushEvent(
        task,
        'warning',
        `待继续回复：${task.replyText}`,
        {
          type: 'text',
          label: '回复内容',
          value: task.replyText,
          stageKey: 'send-approval',
        },
      );
      this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
        nextAction: '条件通过后继续执行，或跳过/停止任务。',
        evidenceEventIds: [waitingEvent.id],
      });
      this.updateTask(
        task,
        'waiting_for_send_confirmation',
        '已生成回复，等待继续执行。',
        {
          nextAction: '条件通过后继续执行，或跳过/停止任务。',
        },
      );
    }, 1500 + startDelayMs);
  }

  private resolveCustomerServiceLifecycleDelayMs(task: InteractionTask) {
    const value = this.optionalTrimmedText(
      task.metadata?.customerServiceNotBefore,
    );
    if (!value) return 0;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 0;
    return Math.min(24 * 60 * 60 * 1000, Math.max(0, timestamp - Date.now()));
  }

  private async runBrowserAssistedTaskWithQueue(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.executionMode !== 'browser-assisted') return;

    const queueKey = this.resolveBrowserInteractionQueueKey(task);
    const previous = this.browserInteractionQueues.get(queueKey);

    if (previous) {
      task.status = 'running';
      task.statusLabel = this.resolveStatusLabel('running');
      this.setTaskStep(
        task,
        'account-entry',
        'running',
        '等待同平台账号前一个浏览器任务完成。',
      );
      task.nextAction = '同一平台账号的浏览器任务会串行执行，稍后自动继续。';
      task.updatedAt = new Date().toISOString();
      this.pushEvent(task, 'info', `同平台账号浏览器任务已排队：${queueKey}`, {
        type: 'stage_log',
        label: '浏览器任务串行队列',
        value: queueKey,
        stageKey: 'account-entry',
      });
      await this.persistTask(task);
    }

    const queued = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const currentTask = this.tasks.get(taskId);
        if (
          !currentTask ||
          !['queued', 'running'].includes(currentTask.status) ||
          currentTask.executionMode !== 'browser-assisted'
        ) {
          return;
        }

        if (currentTask.status === 'queued') {
          this.updateTask(
            currentTask,
            'running',
            '本地引擎已领取任务，开始检查执行环境。',
            {
              nextAction: '检查平台登录态和目标对象。',
            },
          );
        }

        if (this.isDesktopInteractionTask(currentTask.type)) {
          await this.preflightDesktopInteractionTask(currentTask);
        } else {
          await this.preflightBrowserAssistedTask(currentTask);
        }
      });

    this.browserInteractionQueues.set(queueKey, queued);
    queued
      .finally(() => {
        if (this.browserInteractionQueues.get(queueKey) === queued) {
          this.browserInteractionQueues.delete(queueKey);
        }
      })
      .catch(() => undefined);

    return queued;
  }

  private resolveBrowserInteractionQueueKey(task: InteractionTask): string {
    const platform = task.type.startsWith('douyin')
      ? 'douyin'
      : task.type.startsWith('wechat-channel')
        ? 'wechat-channel'
        : task.type.startsWith('wechat')
          ? 'wechat-desktop'
          : task.platformName || 'browser';
    return `${platform}:${task.accountId || task.accountName || 'default'}`;
  }

  private processBatchTargetsWithRateLimit(
    taskId: string,
    processTarget: (
      task: InteractionTask,
      target: InteractionBatchTarget,
      index: number,
    ) => Promise<void>,
  ) {
    const task = this.tasks.get(taskId);
    if (!task || !task.batchTargets?.length) return;

    const rateLimit = task.rateLimitPerMinute || 3;
    const delayMs = Math.floor(60000 / rateLimit);
    const targets = task.batchTargets;

    const processNext = (index: number) => {
      if (index >= targets.length) return;
      const currentTask = this.tasks.get(taskId);
      if (!currentTask || currentTask.status === 'paused') return;

      processTarget(currentTask, targets[index], index)
        .then(() => {
          if (index + 1 < targets.length) {
            setTimeout(() => processNext(index + 1), delayMs);
          }
        })
        .catch(() => {
          if (index + 1 < targets.length) {
            setTimeout(() => processNext(index + 1), delayMs);
          }
        });
    };

    processNext(0);
  }

  private async preflightBrowserAssistedTask(task: InteractionTask) {
    const contract = await this.resolveExecutionContract(task);
    if (!contract.ok) {
      this.blockTaskForExecutionContract(task, contract);
      await this.persistTask(task);
      return;
    }

    const runtimePreflight = await this.preflightBrowserTaskViaRuntime(task);
    if (runtimePreflight && !runtimePreflight.ok) {
      this.blockTaskForExecutionContract(task, {
        ok: false,
        stageKey: 'account-entry',
        failureReason: runtimePreflight.message,
        nextAction:
          runtimePreflight.nextAction ||
          '请检查本地 Runtime 引擎、浏览器会话和账号登录状态后重试。',
        stepMessages: {
          accountEntry: runtimePreflight.message,
          targetRead: 'Runtime 前置预检未通过，不能读取目标对象。',
          replyGenerate: '未读取真实对象，不能生成回复。',
          sendApproval: '真实能力缺失，不能进入受控执行。',
          sendResult: '任务已在 Runtime 前置预检阶段阻断。',
        },
      });
      this.pushEvent(task, 'error', runtimePreflight.message, {
        type: 'failure_reason',
        label: 'Runtime 前置预检',
        value: runtimePreflight.blockers.join('；') || runtimePreflight.message,
        stageKey: 'account-entry',
      });
      await this.persistTask(task);
      return;
    }

    const targetReady = await this.ensureBrowserInteractionTarget(task);
    if (!targetReady) {
      await this.persistTask(task);
      return;
    }
    this.markPreparedBrowserInteractionSteps(task);

    if (task.sendMode === 'approval-send') {
      const evidenceEventIds = this.collectRecentEvidenceEventIds(task);
      this.setTaskStep(
        task,
        'environment',
        'completed',
        '基础执行环境检查完成。',
      );
      this.setTaskStep(
        task,
        'account-entry',
        'completed',
        '平台账号后台已打开并通过登录态检查。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'running',
        '已读取真实对象并生成回复，等待继续执行。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'pending',
        '条件通过后调用真实发送执行器。',
      );
      this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
        nextAction: '目标和回复内容通过回读后继续执行。',
        evidenceEventIds,
      });
      this.updateTask(
        task,
        'waiting_for_send_confirmation',
        `已识别真实${this.resolveTypeLabel(task.type)}对象，等待继续执行。`,
        {
          nextAction: `当前对象：${task.sourceText}；回复：${task.replyText}`,
        },
      );
      await this.persistTask(task);
      return;
    }

    // P3-D4 + 2026-06-04: 删旧 preflightTask 后, 现在直接调 RuntimeOrchestrator.execute()
    // 让 Runtime 路径 (playwright + platform services) 真实跑任务
    if (!this.runtimeOrchestrator) {
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        'RuntimeOrchestrator 未注入',
      );
      this.updateTask(task, 'failed', 'RuntimeOrchestrator 未注入', {
        failureReason: 'RuntimeOrchestrator 未注入',
        nextAction: '检查 LocalEngineModule 与 RuntimeModule 装配',
        completedAt: new Date().toISOString(),
      });
      await this.persistTask(task);
      return;
    }
    const runtimeInput = mapInteractionTaskToRuntimeInput(task);
    const result = await this.runtimeOrchestrator.execute(
      runtimeInput.task,
      this.withTaskBillingContext(task, runtimeInput.ctx, 'local-engine-task'),
    );
    const primaryRuntimeBlocker =
      !result.ok && result.blockers?.length
        ? this.optionalTrimmedText(result.blockers[0])
        : undefined;
    const runtimeMessageBase =
      result.userMessage ||
      result.technicalMessage ||
      (result.ok ? '执行完成' : '执行失败');
    const runtimeMessage =
      primaryRuntimeBlocker &&
      !runtimeMessageBase.includes(primaryRuntimeBlocker)
        ? `${runtimeMessageBase} ${primaryRuntimeBlocker}`
        : runtimeMessageBase;
    const runtimeNextAction =
      result.technicalMessage ||
      primaryRuntimeBlocker ||
      (result.ok ? '已完成' : '请检查 dispatch 日志');
    const accountEntryBlocked =
      !result.ok && this.isRuntimeAccountEntryBlocker(result.reasonCode);
    if (result.runtime?.executor === 'browser-cdp') {
      task.runtimeMode = 'persistent-cdp-browser';
    }
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    this.setTaskStep(
      task,
      'account-entry',
      accountEntryBlocked ? 'blocked' : 'completed',
      accountEntryBlocked
        ? runtimeMessage
        : '平台账号后台已打开并通过登录态检查。',
    );
    this.setTaskStep(
      task,
      'send-approval',
      result.ok
        ? task.sendMode === 'auto-send'
          ? 'skipped'
          : 'completed'
        : task.sendMode === 'auto-send'
          ? 'skipped'
          : 'blocked',
      result.ok
        ? task.sendMode === 'auto-send'
          ? '自动发送模式直接执行。'
          : '发送策略已通过。'
        : task.sendMode === 'auto-send'
          ? '自动发送模式直接执行。'
          : '执行失败，不能进入受控执行。',
    );
    this.setTaskStep(
      task,
      'send-result',
      result.ok ? 'completed' : 'blocked',
      runtimeMessage,
    );
    const runtimeEvidenceEventIds = result.evidence?.length
      ? result.evidence.map((evidence) => {
          const isDesktopScreenshotEvidence =
            evidence.type === 'screenshot' &&
            this.isDesktopInteractionTask(task.type);
          return this.pushEvent(
            task,
            result.ok ? 'success' : 'error',
            evidence.label,
            {
              type: isDesktopScreenshotEvidence
                ? 'desktop_screenshot'
                : evidence.type === 'screenshot'
                  ? 'screenshot'
                  : evidence.type === 'readback'
                    ? 'text'
                    : 'text',
              label: evidence.label,
              value: evidence.value || evidence.path || evidence.label,
              artifactUrl: evidence.path,
              stageKey:
                evidence.type === 'readback' || isDesktopScreenshotEvidence
                  ? 'send-result'
                  : 'target-read',
            },
          ).id;
        })
      : [];
    const evidenceEventIds = this.collectRecentEvidenceEventIds(
      task,
      runtimeEvidenceEventIds,
    );
    if (result.ok) {
      if (result.readback?.actualText) {
        task.metadata = {
          ...(task.metadata || {}),
          lastReadbackText: result.readback.actualText,
        };
      }
      this.completeQueuedBatchTargets(task, {
        nextAction: runtimeNextAction,
        evidenceEventIds,
      });
    } else if (result.reasonCode === 'target_not_found') {
      this.setTaskStep(
        task,
        'target-read',
        'completed',
        '真实平台已读取，但目标对象不存在或已处理。',
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'skipped',
        '目标不存在，未生成或使用回复。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'skipped',
        '目标不存在，不进入发送。',
      );
      this.setTaskStep(task, 'send-result', 'skipped', runtimeMessage);
      this.markQueuedBatchTargets(task, 'no_target', runtimeMessage, {
        nextAction:
          result.technicalMessage ||
          '目标已不存在或已处理；等平台出现新对象后重试。',
        evidenceEventIds,
      });
    } else {
      this.markQueuedBatchTargets(task, 'failed', runtimeMessage, {
        nextAction: runtimeNextAction,
        evidenceEventIds,
      });
    }
    const finalStatus = result.ok
      ? 'completed'
      : result.reasonCode === 'target_not_found'
        ? 'no_target'
        : 'failed';
    this.updateTask(task, finalStatus, runtimeMessage, {
      failureReason:
        result.ok || finalStatus === 'no_target' ? undefined : runtimeMessage,
      nextAction:
        finalStatus === 'no_target'
          ? result.technicalMessage ||
            '目标已不存在或已处理；等平台出现新对象后重试。'
          : runtimeNextAction,
      completedAt: new Date().toISOString(),
    });
    await this.persistTask(task);
    return;
    // DELETED:     const result = {
    // DELETED:       state: 'ready' as const,
    // DELETED:       blockers: [],
    // DELETED:     };
    // DELETED:     task.runtimeState = result.state;
    // DELETED:     if (result.failureReason) {
    // DELETED:       task.failureReason = result.failureReason;
    // DELETED:     }
    // DELETED:     if (result.nextAction) {
    // DELETED:       task.nextAction = result.nextAction;
    // DELETED:     }
    // DELETED:     if (result.targetText) {
    // DELETED:       task.sourceText = result.targetText;
    // DELETED:     }
    // DELETED:     if (result.replyText) {
    // DELETED:       task.replyText = result.replyText;
    // DELETED:     }
    // DELETED:     if (result.replyGeneratedBy) {
    // DELETED:       task.replyGeneratedBy = result.replyGeneratedBy;
    // DELETED:     }
    // DELETED:     const noTargetBySteps =
    // DELETED:       task.steps?.some(
    // DELETED:         (step) => step.key === 'target-read' && step.status === 'skipped',
    // DELETED:       ) &&
    // DELETED:       task.steps?.some(
    // DELETED:         (step) => step.key === 'reply-generate' && step.status === 'skipped',
    // DELETED:       ) &&
    // DELETED:       task.steps?.some(
    // DELETED:         (step) => step.key === 'send-approval' && step.status === 'skipped',
    // DELETED:       ) &&
    // DELETED:       task.events.some((event) =>
    // DELETED:         /无可处理|没有可处理|未读取到可处理/.test(event.message),
    // DELETED:       );
    // DELETED:     if (result.terminalStatus === 'no_target' || noTargetBySteps) {
    // DELETED:       const evidenceEventIds = this.collectRecentEvidenceEventIds(task);
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'environment',
    // DELETED:         'completed',
    // DELETED:         '基础执行环境检查完成。',
    // DELETED:       );
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'send-result',
    // DELETED:         'skipped',
    // DELETED:         '无可处理对象，未执行发送。',
    // DELETED:       );
    // DELETED:       this.markQueuedBatchTargets(
    // DELETED:         task,
    // DELETED:         'no_target',
    // DELETED:         result.nextAction || '无可处理对象',
    // DELETED:         {
    // DELETED:           nextAction:
    // DELETED:             result.nextAction || '没有可处理对象；补充对象后重新创建任务。',
    // DELETED:           evidenceEventIds,
    // DELETED:         },
    // DELETED:       );
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'no_target',
    // DELETED:         '真实读取完成：本次没有可处理对象，未执行发送。',
    // DELETED:         {
    // DELETED:           failureReason: undefined,
    // DELETED:           nextAction:
    // DELETED:             result.nextAction || '没有可处理对象；补充对象后重新创建任务。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     if (result.terminalStatus === 'skipped') {
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'environment',
    // DELETED:         'completed',
    // DELETED:         '基础执行环境检查完成。',
    // DELETED:       );
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'send-result',
    // DELETED:         'skipped',
    // DELETED:         '任务已跳过，未执行发送。',
    // DELETED:       );
    // DELETED:       this.markQueuedBatchTargets(
    // DELETED:         task,
    // DELETED:         'skipped',
    // DELETED:         result.nextAction || '任务已跳过',
    // DELETED:         {
    // DELETED:           nextAction:
    // DELETED:             result.nextAction || '任务已跳过；如需继续，请创建重试任务。',
    // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'skipped',
    // DELETED:         '真实读取完成：任务已跳过，未执行发送。',
    // DELETED:         {
    // DELETED:           failureReason: undefined,
    // DELETED:           nextAction:
    // DELETED:             result.nextAction || '任务已跳过；如需继续，请创建重试任务。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     if (result.terminalStatus === 'failed') {
    // DELETED:       this.markQueuedBatchTargets(
    // DELETED:         task,
    // DELETED:         'failed',
    // DELETED:         result.failureReason || '真实读取失败',
    // DELETED:         {
    // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
    // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'failed',
    // DELETED:         result.failureReason || '真实读取失败，未执行发送。',
    // DELETED:         {
    // DELETED:           failureReason: result.failureReason,
    // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     if (result.state === 'executor_missing') {
    // DELETED:       this.markQueuedBatchTargets(
    // DELETED:         task,
    // DELETED:         'failed',
    // DELETED:         result.failureReason || '真实执行预检失败',
    // DELETED:         {
    // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
    // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'failed',
    // DELETED:         result.failureReason || '真实执行预检失败，未执行发送。',
    // DELETED:         {
    // DELETED:           failureReason: result.failureReason,
    // DELETED:           nextAction: result.nextAction || '请检查本地引擎和账号状态后重试。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         },
    // DELETED:       );
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     const liveReviewReason = this.resolveCustomerReplyReviewReason(
    // DELETED:       task.sourceText,
    // DELETED:     );
    // DELETED:     if (task.sendMode === 'approval-send' && liveReviewReason) {
    // DELETED:       task.riskLevel = 'high';
    // DELETED:       task.requiresDoubleConfirmation = true;
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'send-approval',
    // DELETED:         'running',
    // DELETED:       );
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'send-result',
    // DELETED:         'pending',
    // DELETED:         '确认后才会调用真实发送执行器。',
    // DELETED:       );
    // DELETED:       const reviewEvent = this.pushEvent(
    // DELETED:         task,
    // DELETED:         'warning',
    // DELETED:         `客户内容涉及${liveReviewReason}，请确认回复内容后再发送。`,
    // DELETED:         {
    // DELETED:           type: 'text',
    // DELETED:           label: '内容风控',
    // DELETED:           value: `source=${task.sourceText} / reply=${task.replyText}`,
    // DELETED:         },
    // DELETED:       );
    // DELETED:       this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
    // DELETED:         nextAction: `请确认${liveReviewReason}回复是否能发送。`,
    // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
    // DELETED:           reviewEvent.id,
    // DELETED:         ]),
    // DELETED:       });
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'waiting_for_send_confirmation',
    // DELETED:         {
    // DELETED:           nextAction: `客户内容涉及${liveReviewReason}；请确认回复内容后再发送。`,
    // DELETED:         },
    // DELETED:       );
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     if (task.sendMode === 'auto-send') {
    // DELETED:       this.setTaskStep(
    // DELETED:         task,
    // DELETED:         'send-result',
    // DELETED:         'running',
    // DELETED:         '正在调用真实自动发送执行器。',
    // DELETED:       );
    // DELETED:       this.updateTask(
    // DELETED:         task,
    // DELETED:         'running',
    // DELETED:         `已识别真实${this.resolveTypeLabel(task.type)}对象，正在自动发送。`,
    // DELETED:         {
    // DELETED:           nextAction: `当前对象：${task.sourceText}；回复：${task.replyText}`,
    // DELETED:         },
    // DELETED:       );
    // DELETED:       const sendResult = await this.autoSendReplyViaRuntime(task);
    // DELETED:       if (sendResult.ok) {
    // DELETED:         task.failureReason = undefined;
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'environment',
    // DELETED:           'completed',
    // DELETED:           '基础执行环境检查完成。',
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'account-entry',
    // DELETED:           'completed',
    // DELETED:           '真实账号入口已通过，自动发送执行完成。',
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'target-read',
    // DELETED:           'completed',
    // DELETED:           `已锁定真实对象：${task.sourceText}`,
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'reply-generate',
    // DELETED:           'completed',
    // DELETED:           '回复内容已生成并用于真实发送。',
    // DELETED:         );
    // DELETED:         const readbackMessage = this.buildAutoSendReadbackMessage(sendResult);
    // DELETED:         this.setTaskStep(task, 'send-result', 'completed', readbackMessage);
    // DELETED:         const sendEvent = this.pushEvent(
    // DELETED:           task,
    // DELETED:           'success',
    // DELETED:           `${sendResult.message}；${readbackMessage}`,
    // DELETED:           sendResult.evidence,
    // DELETED:         );
    // DELETED:         this.completeQueuedBatchTargets(task, {
    // DELETED:           nextAction:
    // DELETED:             sendResult.nextAction || '自动发送已完成，可在执行记录查看证据。',
    // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
    // DELETED:             sendEvent.id,
    // DELETED:           ]),
    // DELETED:         });
    // DELETED:         this.updateTask(task, 'completed', sendResult.message, {
    // DELETED:           nextAction:
    // DELETED:             sendResult.nextAction || '自动发送已完成，可在执行记录查看证据。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         });
    // DELETED:         await this.persistTask(task);
    // DELETED:         return;
    // DELETED:       }
    // DELETED:
    // DELETED:       if (
    // DELETED:         sendResult.status === 'message_missing' ||
    // DELETED:         sendResult.status === 'comment_missing' ||
    // DELETED:         sendResult.status === 'no_target'
    // DELETED:       ) {
    // DELETED:         task.failureReason = undefined;
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'environment',
    // DELETED:           'completed',
    // DELETED:           '基础执行环境检查完成。',
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'account-entry',
    // DELETED:           'completed',
    // DELETED:           '真实账号入口已通过。',
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'target-read',
    // DELETED:           'completed',
    // DELETED:           `已锁定真实对象：${task.sourceText}`,
    // DELETED:         );
    // DELETED:         this.setTaskStep(
    // DELETED:           task,
    // DELETED:           'reply-generate',
    // DELETED:           'completed',
    // DELETED:           '回复内容已生成，但目标已不存在或无需发送。',
    // DELETED:         );
    // DELETED:         this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
    // DELETED:         const noTargetEvent = this.pushEvent(
    // DELETED:           task,
    // DELETED:           'warning',
    // DELETED:           sendResult.message,
    // DELETED:           sendResult.evidence,
    // DELETED:         );
    // DELETED:         this.markQueuedBatchTargets(task, 'no_target', sendResult.message, {
    // DELETED:           nextAction:
    // DELETED:             sendResult.nextAction || '目标已不存在或已处理，无需继续发送。',
    // DELETED:           evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
    // DELETED:             noTargetEvent.id,
    // DELETED:           ]),
    // DELETED:         });
    // DELETED:         this.updateTask(task, 'no_target', sendResult.message, {
    // DELETED:           failureReason: undefined,
    // DELETED:           nextAction:
    // DELETED:             sendResult.nextAction || '目标已不存在或已处理，无需继续发送。',
    // DELETED:           completedAt: new Date().toISOString(),
    // DELETED:         });
    // DELETED:         await this.persistTask(task);
    // DELETED:         return;
    // DELETED:       }
    // DELETED:
    // DELETED:       this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
    // DELETED:       const failureEvent = this.pushEvent(
    // DELETED:         task,
    // DELETED:         'error',
    // DELETED:         sendResult.message,
    // DELETED:         sendResult.evidence,
    // DELETED:       );
    // DELETED:       this.markQueuedBatchTargets(task, 'failed', sendResult.message, {
    // DELETED:         nextAction: sendResult.nextAction || '请检查真实自动发送能力后重试。',
    // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
    // DELETED:           failureEvent.id,
    // DELETED:         ]),
    // DELETED:       });
    // DELETED:       this.updateTask(task, 'failed', sendResult.message, {
    // DELETED:         failureReason: sendResult.message,
    // DELETED:         nextAction: sendResult.nextAction || '请检查真实自动发送能力后重试。',
    // DELETED:         completedAt: new Date().toISOString(),
    // DELETED:       });
    // DELETED:       await this.persistTask(task);
    // DELETED:       return;
    // DELETED:     }
    // DELETED:     if (result.readyForApproval) {
    // DELETED:       task.status = 'waiting_for_send_confirmation';
    // DELETED:       task.statusLabel = this.resolveStatusLabel(
    // DELETED:         'waiting_for_send_confirmation',
    // DELETED:       );
    // DELETED:       this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
    // DELETED:         nextAction: result.nextAction || '请确认目标和回复内容后继续。',
    // DELETED:         evidenceEventIds: this.collectRecentEvidenceEventIds(task),
    // DELETED:       });
    // DELETED:       const confirmation = this.createInteractionTaskConfirmation(task);
    // DELETED:       this.agentConfirmations.set(confirmation.id, confirmation);
    // DELETED:     await this.persistAgentConfirmation(confirmation);
    // DELETED:     }
    // DELETED:     await this.persistTask(task);
  }

  private async ensureBrowserInteractionTarget(
    task: InteractionTask,
  ): Promise<boolean> {
    if (!this.isBrowserPlatformInteractionTask(task.type)) {
      return true;
    }
    const hadPlaceholderInput =
      this.isPlaceholderInteractionText(task.sourceText) ||
      this.isPlaceholderInteractionText(task.targetName) ||
      !task.sourceText?.trim();
    if (!this.shouldReadRealInteractionTarget(task)) {
      return true;
    }

    this.setTaskStep(
      task,
      'target-read',
      'running',
      '正在读取平台上的真实评论/私信。',
    );
    this.pushEvent(task, 'info', '阶段日志：开始读取真实互动对象。', {
      type: 'stage_log',
      label: '读取真实对象',
      value: `${task.platformName || task.type} / account=${task.accountId || ''}`,
      stageKey: 'target-read',
    });

    try {
      const readResult = await this.readBrowserInteractionCandidates(task);
      const selected = this.pickReadableInteractionCandidate(
        readResult.items,
        task,
      );
      const evidenceEventIds: string[] = [];
      const candidatePreview = readResult.items.slice(0, 5).map((item) => ({
        text: String(item.text || item['content'] || item['message'] || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120),
        source: String(item.source || '').slice(0, 60),
        targetName: String(
          item['author'] ||
            item['nickname'] ||
            item['sender'] ||
            item['contactName'] ||
            '',
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80),
      }));
      const candidateSummary = this.pushEvent(
        task,
        'info',
        `真实读取候选：${readResult.items.length} 条。`,
        {
          type: 'text',
          label: '真实读取候选摘要',
          value: JSON.stringify({
            count: readResult.items.length,
            preview: candidatePreview,
            emptyReason: readResult.emptyReason || null,
            loadBlocked: Boolean(readResult.loadBlocked),
          }),
          stageKey: 'target-read',
        },
      );
      evidenceEventIds.push(candidateSummary.id);
      if (readResult.evidence) {
        const event = this.pushEvent(task, 'info', '已保存真实读取页面截图。', {
          type: 'page_snapshot',
          label: '真实读取截图',
          value: readResult.evidence,
          stageKey: 'target-read',
        });
        evidenceEventIds.push(event.id);
      }

      if (!selected) {
        this.setTaskStep(
          task,
          'environment',
          'completed',
          '基础执行环境检查完成。',
        );
        this.setTaskStep(
          task,
          'account-entry',
          'completed',
          '平台账号后台已打开并通过登录态检查。',
        );
        this.setTaskStep(
          task,
          'target-read',
          'blocked',
          readResult.emptyReason || '当前没有可回复对象。',
        );
        this.setTaskStep(
          task,
          'reply-generate',
          'skipped',
          '没有真实对象，不能生成回复。',
        );
        this.setTaskStep(
          task,
          'send-approval',
          'skipped',
          '没有真实对象，不进入发送。',
        );
        this.setTaskStep(
          task,
          'send-result',
          'skipped',
          '没有可处理对象，未发送。',
        );
        if (readResult.loadBlocked) {
          this.updateTask(
            task,
            'blocked',
            readResult.emptyReason || '平台页面仍在加载，未进入可读取状态。',
            {
              nextAction:
                '等待平台页面加载完成后重试；如果持续加载，刷新后台或重新登录账号。',
              completedAt: new Date().toISOString(),
            },
          );
          return false;
        }
        this.markQueuedBatchTargets(
          task,
          'no_target',
          readResult.emptyReason || '当前没有可回复对象',
          {
            nextAction: '等平台出现新评论/私信后重试。',
            evidenceEventIds,
          },
        );
        this.updateTask(
          task,
          'no_target',
          readResult.emptyReason || '当前没有可回复对象。',
          {
            nextAction: '等平台出现新评论/私信后重试。',
            completedAt: new Date().toISOString(),
          },
        );
        return false;
      }

      const now = new Date().toISOString();
      const selectedText = this.cleanReadableInteractionText(
        selected.text,
        task.type,
      );
      const existingReply =
        !hadPlaceholderInput &&
        task.replyText?.trim() &&
        !this.isPlaceholderInteractionText(task.replyText)
          ? task.replyText.trim()
          : '';
      let replyGeneratedBy: InteractionReplyGeneratedBy =
        existingReply && task.replyGeneratedBy === 'ai' ? 'ai' : 'fallback';
      let replyText = existingReply;
      if (!replyText) {
        const generatedReply = await this.generateInteractionReply({
          sourceText: selectedText,
          targetName: selected.targetName || selectedText.slice(0, 32),
          accountName: task.accountName,
        });
        replyText = generatedReply.replyText;
        replyGeneratedBy = generatedReply.generatedBy;
      }
      task.targetName =
        selected.targetName || selectedText.slice(0, 32) || task.targetName;
      task.sourceText = selectedText;
      task.replyText = replyText;
      task.replyGeneratedBy = replyGeneratedBy;
      task.sourceUrl = selected.sourceUrl || task.sourceUrl;
      task.profileUrl = selected.profileUrl || task.profileUrl;
      task.commentTime = selected.commentTime || task.commentTime;
      task.videoTitle = selected.videoTitle || task.videoTitle;
      task.videoUrl = selected.videoUrl || task.videoUrl;
      task.engagementScore =
        typeof selected.engagementScore === 'number'
          ? selected.engagementScore
          : task.engagementScore;
      task.updatedAt = now;
      task.batchTargets = [
        {
          id: task.batchTargets?.[0]?.id || `bt_1_${this.createId()}`,
          targetName: task.targetName,
          sourceText: task.sourceText,
          replyText: task.replyText,
          sourceUrl: task.sourceUrl,
          profileUrl: task.profileUrl,
          commentTime: task.commentTime,
          videoTitle: task.videoTitle,
          videoUrl: task.videoUrl,
          engagementScore: task.engagementScore,
          status: 'queued',
          updatedAt: now,
          evidenceEventIds,
        },
      ];
      task.batchSummary = this.buildBatchSummary(task.batchTargets);
      this.setTaskStep(
        task,
        'target-read',
        'completed',
        `已读取真实对象：${task.sourceText.slice(0, 80)}`,
      );
      this.setTaskStep(
        task,
        'reply-generate',
        'completed',
        '已按真实内容生成回复。',
      );
      this.pushEvent(task, 'success', `已读取真实对象：${task.sourceText}`, {
        type: 'page_snapshot',
        label: '真实对象',
        value: task.sourceText,
        stageKey: 'target-read',
      });
      this.pushEvent(task, 'success', `已生成回复：${task.replyText}`, {
        type: 'text',
        label: replyGeneratedBy === 'ai' ? 'AI 回复内容' : '规则兜底回复内容',
        value: task.replyText,
        stageKey: 'reply-generate',
      });
      await this.persistTask(task);
      return true;
    } catch (error) {
      const message = this.sanitizeInteractionFailureMessage(
        error instanceof Error ? error.message : String(error),
      );
      this.setTaskStep(
        task,
        'environment',
        'completed',
        '基础执行环境检查完成。',
      );
      this.setTaskStep(
        task,
        'account-entry',
        'blocked',
        '平台账号后台未通过登录态检查。',
      );
      this.setTaskStep(task, 'target-read', 'blocked', message);
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '真实读取失败，不能生成回复。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实读取失败，不能进入发送。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        '真实读取失败，未发送。',
      );
      this.pushEvent(task, 'error', message, {
        type: 'failure_reason',
        label: '真实读取失败',
        value: message,
        stageKey: 'target-read',
      });
      this.markQueuedBatchTargets(task, 'failed', message, {
        nextAction: '请确认平台账号已登录、页面能打开，然后重试。',
        evidenceEventIds: this.collectRecentEvidenceEventIds(task),
      });
      this.updateTask(task, 'failed', message, {
        failureReason: message,
        nextAction: '请确认平台账号已登录、页面能打开，然后重试。',
        completedAt: new Date().toISOString(),
      });
      return false;
    }
  }

  private markPreparedBrowserInteractionSteps(task: InteractionTask) {
    this.setTaskStep(
      task,
      'target-read',
      'completed',
      `已锁定目标对象：${(task.sourceText || task.targetName || '当前对象').slice(0, 80)}`,
    );
    this.setTaskStep(
      task,
      'reply-generate',
      'completed',
      '回复内容已生成并准备执行。',
    );
  }

  private sanitizeInteractionFailureMessage(message: string): string {
    return String(message || '真实读取失败')
      .replace(/\s*\|\s*pageText=[\s\S]*?(?=\s*\|\s*evidence=|\)$|$)/, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, 600)
      .trim();
  }

  private isBrowserPlatformInteractionTask(type: InteractionTaskType): boolean {
    return (
      type === 'douyin-comment-reply' ||
      type === 'douyin-direct-message-reply' ||
      type === 'wechat-channel-comment-reply' ||
      type === 'wechat-channel-direct-message-reply'
    );
  }

  private shouldReadRealInteractionTarget(task: InteractionTask): boolean {
    return (
      this.isPlaceholderInteractionText(task.sourceText) ||
      this.isPlaceholderInteractionText(task.targetName) ||
      !task.sourceText?.trim()
    );
  }

  private isPlaceholderInteractionText(text?: string | null): boolean {
    const value = String(text || '')
      .replace(/\s+/g, '')
      .trim();
    return (
      !value ||
      value === '测试对象' ||
      (value.includes('等待本机读取真实') &&
        (value.includes('对象') ||
          value.includes('评论') ||
          value.includes('私信'))) ||
      value.includes('等待本机读取真实对象') ||
      value.includes('等待系统读取真实') ||
      value.includes('等待读取真实') ||
      value.includes('浏览器预检将自动打开') ||
      value.includes('浏览器读取评论') ||
      value.includes('浏览器读取私信') ||
      value.includes('读取第一条可处理评论') ||
      value.includes('读取第一条可处理私信') ||
      value.includes('自动打开抖音后台') ||
      value.includes('自动打开视频号后台')
    );
  }

  private isRuntimeAccountEntryBlocker(reasonCode?: string): boolean {
    return (
      reasonCode === 'account_not_logged_in' ||
      reasonCode === 'captcha_required' ||
      reasonCode === 'runtime_unavailable' ||
      reasonCode === 'platform_changed' ||
      reasonCode === 'permission_missing'
    );
  }

  private async readBrowserInteractionCandidates(
    task: InteractionTask,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    evidence?: string;
    emptyReason?: string;
    loadBlocked?: boolean;
  }> {
    const accountId = Number(task.accountId);
    if (!Number.isFinite(accountId)) {
      throw new Error('缺少可用的平台账号 ID，不能读取真实互动对象。');
    }
    const limit = 10;
    if (task.type === 'douyin-comment-reply') {
      const result = await this.autoUploadService.readDouyinComments({
        accountId,
        limit,
        parsingRules: task.replyRule,
      });
      return this.normalizeInteractionReadResult(result.comments, result);
    }
    if (task.type === 'douyin-direct-message-reply') {
      const result = await this.autoUploadService.readDouyinMessages({
        accountId,
        limit,
      });
      return this.normalizeInteractionReadResult(result.messages, result);
    }
    if (task.type === 'wechat-channel-comment-reply') {
      const result = await this.autoUploadService.readWechatChannelComments({
        accountId,
        limit,
      });
      return this.normalizeInteractionReadResult(result.comments, result);
    }
    const result = await this.autoUploadService.readWechatChannelMessages({
      accountId,
      limit,
    });
    return this.normalizeInteractionReadResult(result.messages, result);
  }

  private normalizeInteractionReadResult(
    items: Array<Record<string, unknown>> | undefined,
    result: {
      summary?: { emptyReason?: string | null; loadBlocked?: boolean };
      evidence?: { path?: string; value?: string } | null;
    },
  ): {
    items: Array<Record<string, unknown>>;
    evidence?: string;
    emptyReason?: string;
    loadBlocked?: boolean;
  } {
    return {
      items: Array.isArray(items) ? items : [],
      evidence:
        typeof result.evidence?.path === 'string'
          ? result.evidence.path
          : typeof result.evidence?.value === 'string'
            ? result.evidence.value
            : undefined,
      emptyReason:
        typeof result.summary?.emptyReason === 'string'
          ? result.summary.emptyReason
          : undefined,
      loadBlocked: Boolean(result.summary?.loadBlocked),
    };
  }

  private pickReadableInteractionCandidate(
    items: Array<Record<string, unknown>>,
    task?: InteractionTask,
  ): {
    text: string;
    targetName?: string;
    sourceUrl?: string;
    profileUrl?: string;
    commentTime?: string;
    videoTitle?: string;
    videoUrl?: string;
    engagementScore?: number;
  } | null {
    const normalize = (value: unknown) =>
      String(value || '')
        .replace(/\s+/g, '')
        .trim();
    const currentReplyText = normalize(task?.replyText);
    const fallbackReplies = new Set(
      this.normalizeStringList((task?.replyRule as Record<string, unknown> | null)?.fallbackReplies, [])
        .map((reply) => normalize(reply))
        .filter(Boolean),
    );
    const orderedItems =
      task?.type === 'douyin-direct-message-reply'
        ? [...items].sort((a, b) => {
            const score = (item: Record<string, unknown>) => {
              const source = String(item.source || '').toLowerCase();
              const context = String(item.context || '');
              const text = String(
                item.text || item['content'] || item['message'] || '',
              );
              let value = 0;
              if (source === 'dom') value += 80;
              if (source.includes('dom')) value += 50;
              if (context && context.includes(text)) value += 30;
              if (source.includes('network')) value -= 40;
              if (source.includes('window')) value -= 20;
              return value;
            };
            return score(b) - score(a);
          })
        : items;
    for (const item of orderedItems) {
      if (task?.type === 'douyin-direct-message-reply') {
        const source = String(item.source || '').toLowerCase();
        if (
          source.includes('network') ||
          source.includes('window') ||
          source === 'text-node' ||
          source === 'contact-name'
        ) {
          continue;
        }
      }
      const text = String(item.text || item['content'] || item['message'] || '')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizedText = normalize(text);
      if (!text || this.isPlaceholderInteractionText(text)) {
        continue;
      }
      if (
        currentReplyText &&
        (normalizedText === currentReplyText ||
          normalizedText.includes(currentReplyText))
      ) {
        continue;
      }
      if (
        [...fallbackReplies].some(
          (reply) => normalizedText === reply || normalizedText.includes(reply),
        )
      ) {
        continue;
      }
      if (text.length > 500) {
        continue;
      }
      const targetName = String(
        item['author'] ||
          item['nickname'] ||
          item['sender'] ||
          item['contactName'] ||
          '',
      ).trim();
      const field = (...keys: string[]) => {
        for (const key of keys) {
          const value = String(item[key] || '').trim();
          if (value) return value;
        }
        return undefined;
      };
      const engagementScore = Number(item['engagementScore']);
      return {
        text: this.cleanReadableInteractionText(text, task?.type),
        targetName: targetName || undefined,
        sourceUrl: field('sourceUrl', 'url', 'link'),
        profileUrl: field('profileUrl', 'authorUrl'),
        commentTime: field('commentTime', 'time', 'createdAt'),
        videoTitle: field('videoTitle', 'workTitle', 'selectedWorkTitle'),
        videoUrl: field('videoUrl', 'awemeUrl'),
        engagementScore: Number.isFinite(engagementScore)
          ? engagementScore
          : undefined,
      };
    }
    return null;
  }

  private cleanReadableInteractionText(
    value: string,
    type?: InteractionTaskType,
  ): string {
    let text = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
      .trim();
    if (type === 'douyin-comment-reply') {
      text = text
        .replace(/\s+(?:回复|删除|举报|查看\d+条回复).*$/g, '')
        .replace(/\s+\d{1,4}$/g, '')
        .trim();
    }
    return text;
  }

  private async preflightDesktopInteractionTask(task: InteractionTask) {
    const contract = await this.resolveExecutionContract(task);
    if (!contract.ok) {
      this.blockTaskForExecutionContract(task, contract);
      await this.persistTask(task);
      return;
    }

    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    this.setTaskStep(
      task,
      'account-entry',
      'completed',
      '桌面微信执行不需要平台账号，已进入本机微信执行。',
    );
    this.setTaskStep(
      task,
      'target-read',
      'completed',
      `已锁定桌面微信目标：${task.targetName}`,
    );
    this.setTaskStep(
      task,
      'reply-generate',
      'completed',
      '回复/发布内容已生成并准备执行。',
    );

    if (task.sendMode === 'auto-send') {
      this.setTaskStep(
        task,
        'send-approval',
        'skipped',
        '自动发送模式跳过人工确认。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'running',
        '正在调用桌面微信自动发送执行器。',
      );
      const sendResult = await this.autoSendReplyViaRuntime(task);
      if (sendResult.ok) {
        this.applyInteractionDraftResult(task, sendResult);
        task.failureReason = undefined;
        const readbackMessage = this.buildAutoSendReadbackMessage(sendResult);
        this.setTaskStep(task, 'send-result', 'completed', readbackMessage);
        const sendEvent = this.pushEvent(
          task,
          'success',
          `${sendResult.message}；${readbackMessage}`,
          sendResult.evidence,
        );
        const evidenceEventIds = this.collectRecentEvidenceEventIds(task, [
          sendEvent.id,
        ]);
        if (
          !this.applyRuntimeBatchTargetResults(
            task,
            sendResult,
            evidenceEventIds,
          )
        ) {
          this.completeQueuedBatchTargets(task, {
            nextAction: sendResult.nextAction || '桌面微信动作已完成。',
            evidenceEventIds,
          });
        }
        this.updateTask(task, 'completed', sendResult.message, {
          nextAction: sendResult.nextAction || '桌面微信动作已完成。',
          completedAt: new Date().toISOString(),
        });
        await this.persistTask(task);
        return;
      }

      if (
        ['comment_missing', 'message_missing', 'no_target'].includes(
          sendResult.status,
        )
      ) {
        this.setTaskStep(
          task,
          'target-read',
          'completed',
          '本机微信已搜索目标，但目标不可添加或已是联系人。',
        );
        this.setTaskStep(
          task,
          'reply-generate',
          'skipped',
          '目标不可添加，未生成或使用回复。',
        );
        this.setTaskStep(task, 'send-result', 'skipped', sendResult.message);
        const noTargetEvent = this.pushEvent(
          task,
          'warning',
          sendResult.message,
          sendResult.evidence,
        );
        this.markQueuedBatchTargets(task, 'no_target', sendResult.message, {
          nextAction:
            sendResult.nextAction ||
            '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            noTargetEvent.id,
          ]),
        });
        this.updateTask(task, 'no_target', sendResult.message, {
          failureReason: undefined,
          nextAction:
            sendResult.nextAction ||
            '当前目标不可添加或已是联系人；请换一个未成为好友且可搜索/可添加的微信测试对象。',
          completedAt: new Date().toISOString(),
        });
        await this.persistTask(task);
        return;
      }

      const sendFailureReason = sendResult.failureReason || sendResult.message;
      this.setTaskStep(task, 'send-result', 'blocked', sendFailureReason);
      const failureEvent = this.pushEvent(
        task,
        'error',
        sendFailureReason,
        sendResult.evidence,
      );
      const failureEvidenceEventIds = this.collectRecentEvidenceEventIds(task, [
        failureEvent.id,
      ]);
      if (
        !this.applyRuntimeBatchTargetResults(
          task,
          sendResult,
          failureEvidenceEventIds,
        )
      ) {
        this.markQueuedBatchTargets(task, 'failed', sendFailureReason, {
          nextAction:
            sendResult.nextAction ||
            '请检查桌面微信目标、权限和执行脚本后重试。',
          evidenceEventIds: failureEvidenceEventIds,
        });
      }
      this.updateTask(task, 'failed', sendFailureReason, {
        failureReason: sendFailureReason,
        nextAction:
          sendResult.nextAction || '请检查桌面微信目标、权限和执行脚本后重试。',
        completedAt: new Date().toISOString(),
      });
      await this.persistTask(task);
      return;
    }

    this.setTaskStep(
      task,
      'send-approval',
      'running',
      '受控执行模式：目标、内容和当前窗口通过回读后继续写入桌面微信。',
    );
    const waitingEvent = this.pushEvent(
      task,
      'warning',
      `待继续微信动作：${task.replyText}`,
      {
        type: 'text',
        label: '待继续内容',
        value: task.replyText,
        stageKey: 'send-approval',
      },
    );
    this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
      nextAction: '请确认目标和内容后继续。',
      evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
        waitingEvent.id,
      ]),
    });
    this.updateTask(
      task,
      'waiting_for_send_confirmation',
      '已生成微信动作，等待继续执行。',
      {
        nextAction: '目标、内容和当前窗口通过回读后继续执行。',
      },
    );
    await this.persistTask(task);
  }

  private withTaskBillingContext(
    task: InteractionTask,
    ctx: ExecutorContext,
    scope: string,
  ): ExecutorContext {
    const identity = this.normalizeInteractionTaskBillingIdentity(
      task.billingIdentity,
    );
    return {
      ...ctx,
      billing: {
        ...ctx.billing,
        scope: ctx.billing?.scope || scope,
        identity: ctx.billing?.identity || identity,
      },
    };
  }

  private async autoSendReplyViaRuntime(task: InteractionTask) {
    if (!this.runtimeOrchestrator) {
      // P3-D4: LocalInteractionExecutorService 已删；fallback 不可达
      throw new Error(
        'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
      );
    }

    const runtimeInput = mapInteractionTaskToRuntimeInput(task);
    const result = await this.runtimeOrchestrator.execute(
      runtimeInput.task,
      this.withTaskBillingContext(task, runtimeInput.ctx, 'local-engine-task'),
    );
    return mapRuntimeResultToInteractionDraftResult(task, result);
  }

  private applyInteractionDraftResult(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
  ) {
    const sourceText = (result.sourceText || result.targetText || '').trim();
    if (sourceText && !this.isPlaceholderInteractionText(sourceText)) {
      task.sourceText = sourceText;
    }
    const replyText = result.replyText?.trim();
    if (replyText) {
      task.replyText = replyText;
    }
    if (result.replyGeneratedBy) {
      task.replyGeneratedBy = result.replyGeneratedBy;
    }
    if (result.runtimeMode) {
      task.runtimeMode = result.runtimeMode;
    }
    if (result.readbackText?.trim()) {
      task.metadata = {
        ...(task.metadata || {}),
        lastReadbackText: result.readbackText.trim(),
      };
    }
    if (task.batchTargets?.length) {
      const updatedAt = new Date().toISOString();
      task.batchTargets = task.batchTargets.map((target, index) =>
        index === 0
          ? {
              ...target,
              sourceText: task.sourceText,
              replyText: task.replyText,
              updatedAt,
            }
          : target,
      );
      task.batchSummary = this.buildBatchSummary(task.batchTargets);
    }
  }

  private applyRuntimeBatchTargetResults(
    task: InteractionTask,
    result: InteractionExecutorDraftResult,
    evidenceEventIds: string[],
  ) {
    let updated = 0;
    updated += this.markBatchTargetsByNames(
      task,
      result.completedTargets || [],
      'completed',
      undefined,
      {
        nextAction: '该对象已有真实执行结果和回读证据。',
        evidenceEventIds,
      },
    );
    for (const failed of result.failedTargets || []) {
      updated += this.markBatchTargetsByNames(
        task,
        [failed.targetName],
        'failed',
        failed.reason || result.failureReason || result.message,
        {
          nextAction: failed.reason || '核对该对象证据后再显式重试。',
          evidenceEventIds,
        },
      );
    }
    updated += this.markBatchTargetsByNames(
      task,
      result.skippedTargets || [],
      'skipped',
      '该对象按执行规则跳过。',
      {
        nextAction: '该对象已跳过，不会自动重发。',
        evidenceEventIds,
      },
    );
    updated += this.markBatchTargetsByNames(
      task,
      result.pendingTargets || [],
      'queued',
      undefined,
      {
        nextAction: '该对象尚未开始，可在后续批次继续。',
        evidenceEventIds,
      },
    );
    return updated > 0;
  }

  private async sendApprovedBrowserReplyViaRuntime(task: InteractionTask) {
    if (!this.runtimeOrchestrator) {
      throw new Error(
        'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
      );
    }

    const runtimeTask = {
      ...task,
      sendMode: 'auto-send' as const,
    };
    const runtimeInput = mapInteractionTaskToRuntimeInput(runtimeTask);
    const result = await this.runtimeOrchestrator.execute(
      runtimeInput.task,
      this.withTaskBillingContext(
        task,
        runtimeInput.ctx,
        'local-engine-approved-task',
      ),
    );
    return mapRuntimeResultToInteractionDraftResult(runtimeTask, result);
  }

  private async draftApprovedReplyViaRuntime(task: InteractionTask) {
    if (!this.runtimeOrchestrator) {
      // P3-D4: LocalInteractionExecutorService 已删；fallback 不可达
      throw new Error(
        'P3-D4: RuntimeOrchestrator 必须可用（LocalInteractionExecutorService 已删）',
      );
    }

    const runtimeInput = mapInteractionTaskToRuntimeInput({
      ...task,
      sendMode: 'draft-only',
    });
    const result = await this.runtimeOrchestrator.execute(
      runtimeInput.task,
      this.withTaskBillingContext(
        task,
        runtimeInput.ctx,
        'local-engine-draft-task',
      ),
    );
    return mapRuntimeResultToInteractionDraftResult(
      { ...task, sendMode: 'draft-only' },
      result,
    );
  }

  private async preflightBrowserTaskViaRuntime(task: InteractionTask) {
    if (!this.browserControl || this.isDesktopInteractionTask(task.type)) {
      return null;
    }

    const runtimeInput = mapInteractionTaskToRuntimeInput(task);
    if (runtimeInput.task.accountId == null) {
      return {
        ok: false,
        message: '浏览器互动任务必须选择有效账号。',
        blockers: ['missing accountId'],
        nextAction: '请先选择已登录的平台账号。',
      };
    }

    return this.browserControl.preflight(
      runtimeInput.task.platform,
      runtimeInput.task.accountId,
      this.toRuntimeInteractionTaskType(task.type),
    );
  }

  private toRuntimeInteractionTaskType(
    type: InteractionTaskType,
  ): 'comment-reply' | 'direct-message-reply' | undefined {
    if (
      type === 'douyin-comment-reply' ||
      type === 'wechat-channel-comment-reply'
    ) {
      return 'comment-reply';
    }
    if (
      type === 'douyin-direct-message-reply' ||
      type === 'wechat-channel-direct-message-reply'
    ) {
      return 'direct-message-reply';
    }
    return undefined;
  }

  private waitForLiveExecutor(task: InteractionTask) {
    this.setTaskStep(
      task,
      'environment',
      'completed',
      '基础执行环境检查完成。',
    );
    if (
      task.status === 'waiting_for_send_confirmation' ||
      task.status === 'blocked' ||
      task.status === 'paused'
    ) {
      return;
    }

    if (task.runtimeState === 'executor_missing') {
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        '真实读取器未返回内容，无法生成真实回复。',
      );
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实回复未生成，不能进入受控执行。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        '真实浏览器服务未就绪。',
      );
      this.markQueuedBatchTargets(
        task,
        'failed',
        '评论/私信/微信读取服务未就绪',
        {
          nextAction: '已打开账号入口；请检查真实页面读取和填充服务状态。',
        },
      );
      this.updateTask(
        task,
        'blocked',
        '当前环境无法使用自动处理服务，已停在准备检查阶段。',
        {
          failureReason: '当前环境无法读取评论、私信或微信会话',
          nextAction:
            '已打开账号入口；下一步需要接入桌面版的真实页面读取和填充服务。',
          completedAt: new Date().toISOString(),
        },
      );
      this.pushEvent(
        task,
        'warning',
        '为避免误报，真实账号任务不会继续使用占位内容完成发送链路。',
      );
      this.pushEvent(task, 'error', '当前环境无法读取评论、私信或微信会话', {
        type: 'failure_reason',
        label: '失败原因',
        value: '当前环境无法读取评论、私信或微信会话',
        stageKey: 'send-result',
      });
      return;
    }

    this.setTaskStep(
      task,
      'target-read',
      'blocked',
      '等待本地服务返回目标内容。',
    );
    this.markQueuedBatchTargets(task, 'failed', '本地服务超时', {
      nextAction: '请检查 发布服务日志和浏览器控制状态。',
    });
    this.updateTask(task, 'blocked', '本地服务未返回目标内容。', {
      failureReason: '本地服务超时',
      nextAction: '请检查 发布服务日志和浏览器控制状态。',
      completedAt: new Date().toISOString(),
    });
    this.pushEvent(task, 'error', '本地服务未返回目标内容。', {
      type: 'failure_reason',
      label: '失败原因',
      value: '本地服务超时',
      stageKey: 'target-read',
    });
  }

  private async resolveExecutionContract(task: InteractionTask) {
    const baseContract = this.buildExecutionContract(task, {
      requireReadyCapability: false,
      allowMissingAccountException: false,
    });
    if (!baseContract.ok) {
      return baseContract;
    }

    // P3-D4: 旧 getStatus 已删；新路径走 RuntimeOrchestrator.healthCheck()（feature flag 后切换）
    const status = await this.loadExecutorsStatus();
    const capability = status.executors.find(
      (executor) => executor.key === (task as { type?: string }).type,
    );
    return this.buildExecutionContract(task, {
      capability,
      capabilityError:
        capability && 'error' in capability
          ? String(capability.error)
          : undefined,
      requireReadyCapability: true,
      allowMissingAccountException: false,
    });
  }

  private async assertCreateExecutionPreflight(
    input: CreateInteractionTaskInput,
  ): Promise<
    | {
        accountName: string;
        platformType: number;
        platformName: string;
        capability: LocalEngineExecutorCapability;
      }
    | undefined
  > {
    if (
      !this.requiresRealAccount(input.type) &&
      !this.isDesktopInteractionTask(input.type)
    ) {
      return undefined;
    }

    if (this.isDesktopInteractionTask(input.type)) {
      const status = await this.loadExecutorsStatus();
      const capability = status.executors.find(
        (executor) => executor.key === input.type,
      );
      const contract = this.buildExecutionContract(
        {
          type: input.type,
          accountId: input.accountId || 'wechat-desktop',
          accountName: input.accountName?.trim() || '桌面微信',
          platformType: input.platformType ?? 2,
          platformName: input.platformName || '微信',
          sendMode: input.sendMode,
        },
        {
          capability,
          capabilityError:
            capability && 'error' in capability
              ? String(capability.error)
              : undefined,
          requireReadyCapability: true,
          allowMissingAccountException: false,
        },
      );
      if (!contract.ok) {
        throw new BadRequestException(contract.failureReason);
      }
      if (!capability) {
        throw new BadRequestException(
          `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
        );
      }

      return {
        accountName: input.accountName?.trim() || '桌面微信',
        platformType: input.platformType ?? 2,
        platformName: input.platformName || '微信',
        capability,
      };
    }

    const baseContract = this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId,
        accountName: input.accountName?.trim() || '未指定账号',
        platformType: input.platformType,
        platformName: input.platformName,
        sendMode: input.sendMode,
      },
      {
        requireReadyCapability: false,
        allowMissingAccountException: false,
      },
    );
    if (!baseContract.ok) {
      throw new BadRequestException(baseContract.failureReason);
    }

    const accountId = input.accountId;
    let accounts: Awaited<ReturnType<AutoUploadService['listAccounts']>>;
    try {
      accounts = await this.autoUploadService.listAccounts({
        validate: false,
        ids: accountId ? [accountId] : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      throw new BadRequestException(`本地平台账号预检失败：${message}`);
    }

    const requestedPlatform = this.resolveTaskPlatformAccount(input);
    const account =
      accounts.find(
        (item) =>
          String(item.id) === String(accountId) &&
          this.isSamePlatformAccount(requestedPlatform, {
            type: item.type,
            name: item.platform,
          }),
      ) || accounts.find((item) => String(item.id) === String(accountId));
    if (!account) {
      throw new BadRequestException(
        `本地平台账号不存在或不可读取：${accountId}`,
      );
    }
    if (account.status !== 1) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}账号未登录或已失效：${account.profileName || account.userName || input.accountName || accountId}`,
      );
    }

    const platformType = input.platformType ?? account.type;
    if (
      !this.isSamePlatformAccount(
        {
          type: platformType,
          name: input.platformName,
        },
        {
          type: account.type,
          name: account.platform,
        },
      )
    ) {
      throw new BadRequestException(
        `账号平台类型不匹配：任务选择 ${input.platformName || `平台 ${platformType}`}，实际账号为 ${account.platform || `平台 ${account.type}`}。`,
      );
    }

    // P3-D4: 旧 getStatus 已删；现在从 RuntimeOrchestrator 拉真 capability
    const status = await this.loadExecutorsStatus();
    const capability = status.executors.find(
      (executor) => executor.key === input.type,
    );
    const contract = this.buildExecutionContract(
      {
        type: input.type,
        accountId: input.accountId,
        accountName:
          account.profileName ||
          account.userName ||
          input.accountName?.trim() ||
          '未指定账号',
        platformType,
        platformName: input.platformName || account.platform,
        sendMode: input.sendMode,
      },
      {
        capability,
        capabilityError:
          capability && 'error' in capability
            ? String(capability.error)
            : undefined,
        requireReadyCapability: true,
        allowMissingAccountException: false,
      },
    );
    if (!contract.ok) {
      throw new BadRequestException(contract.failureReason);
    }

    if (!capability) {
      throw new BadRequestException(
        `${this.resolveTypeLabel(input.type)}缺少本地执行能力声明`,
      );
    }

    return {
      accountName:
        account.profileName ||
        account.userName ||
        input.accountName?.trim() ||
        `账号 ${accountId}`,
      platformType,
      platformName: input.platformName || account.platform,
      capability,
    };
  }

  private buildExecutionContract(
    task: Pick<InteractionTask, 'type' | 'accountId' | 'accountName'> & {
      typeLabel?: string;
      platformType?: number;
      platformName?: string;
      sendMode?: InteractionSendMode;
    },
    options: {
      capability?: LocalEngineExecutorCapability;
      capabilityError?: string;
      requireReadyCapability: boolean;
      allowMissingAccountException: boolean;
    },
  ) {
    const typeLabel = task.typeLabel || this.resolveTypeLabel(task.type);
    const requiresPlatformAccount = this.requiresRealAccount(task.type);
    const requiresDesktop = this.isDesktopInteractionTask(task.type);
    if (!requiresPlatformAccount && !requiresDesktop) {
      return { ok: true as const };
    }

    const accountId = String(task.accountId || '').trim();
    if (requiresPlatformAccount && !accountId) {
      const failureReason = `${typeLabel}缺少本地平台账号，不能执行真实平台任务。`;
      return {
        ok: false as const,
        stageKey: 'account-entry',
        failureReason,
        nextAction: options.allowMissingAccountException
          ? '请先选择已登录的平台账号；任务已保留为阻断态，可补齐账号后创建重试任务。'
          : '请先选择已登录的平台账号后创建重试任务。',
        stepMessages: {
          accountEntry: '未绑定已登录平台账号。',
          targetRead: '缺少账号，不能打开真实平台读取对象。',
          replyGenerate: '缺少真实对象，不能生成商用草稿。',
          sendApproval: '缺少真实内容，不能进入受控执行。',
          sendResult: '真实执行合同缺少账号。',
        },
      };
    }

    const numericAccountId = Number(accountId);
    if (
      requiresPlatformAccount &&
      (!Number.isInteger(numericAccountId) || numericAccountId <= 0)
    ) {
      const failureReason = `${typeLabel}账号 ID 无效：${accountId}`;
      return {
        ok: false as const,
        stageKey: 'account-entry',
        failureReason,
        nextAction: '请重新选择有效的本地平台账号后创建重试任务。',
        stepMessages: {
          accountEntry: '账号 ID 无效。',
          targetRead: '账号无效，不能打开真实平台读取对象。',
          replyGenerate: '缺少真实对象，不能生成商用草稿。',
          sendApproval: '缺少真实内容，不能进入受控执行。',
          sendResult: '真实执行合同缺少有效账号。',
        },
      };
    }

    if (!this.isLiveExecutorTask(task.type)) {
      const failureReason = `${typeLabel}自动化执行器未就绪`;
      return {
        ok: false as const,
        stageKey: 'executor-skip',
        failureReason,
        nextAction: '请检查该任务类型的执行器注册和健康状态。',
        stepMessages: {
          accountEntry: '已绑定账号，但该互动类型执行器未就绪。',
          targetRead: '没有真实读取能力，不能继续执行。',
          replyGenerate: '未读取到真实对象，不能生成真实草稿。',
          sendApproval: '未生成真实内容，不能进入受控执行。',
          sendResult: '自动化服务未就绪。',
        },
      };
    }

    if (!options.requireReadyCapability) {
      return { ok: true as const };
    }

    const capability = options.capability;
    if (!capability) {
      const failureReason = options.capabilityError
        ? `${typeLabel}能力预检失败：${options.capabilityError}`
        : `${typeLabel}缺少本地执行能力声明`;
      return {
        ok: false as const,
        stageKey: 'executor-capability',
        failureReason,
        nextAction: options.capabilityError
          ? '请启动或升级 3011 本地 Runtime，并确认互动能力清单可用。'
          : '请升级 3011 本地 Runtime，让互动能力声明包含入口、读取、草稿和发送能力。',
        stepMessages: {
          accountEntry: '账号已绑定，但本地引擎未声明该服务。',
          targetRead: '缺少读取能力声明，不能继续执行。',
          replyGenerate: '缺少回复生成能力声明。',
          sendApproval: '缺少受控草稿能力，不能进入确认。',
          sendResult: '真实执行能力未绑定。',
        },
      };
    }

    const contractSendMode = task.sendMode || 'approval-send';
    const requiresSendCapability =
      contractSendMode === 'auto-send'
        ? Boolean(capability.autoSend)
        : Boolean(capability.controlledSend);
    const missing = [
      capability.entryPreflight ? '' : 'account/executor preflight',
      capability.targetRead ? '' : 'target-read capability',
      capability.replyGenerate ? '' : 'reply-generate capability',
      requiresSendCapability
        ? ''
        : contractSendMode === 'auto-send'
          ? 'auto-send capability'
          : 'controlled-send capability',
    ].filter(Boolean);
    if (capability.status !== 'ready' || missing.length) {
      const failureReason = `${typeLabel}执行能力未就绪：${missing.join('、') || capability.message}`;
      return {
        ok: false as const,
        stageKey: 'executor-capability',
        failureReason,
        nextAction:
          capability.nextAction ||
          '请补齐真实读取、回复生成、发送执行和预检能力后重试。',
        stepMessages: {
          accountEntry: capability.entryPreflight
            ? '账号准备检查可用。'
            : '账号准备检查不可用。',
          targetRead: capability.targetRead
            ? '读取能力已声明。'
            : '缺少真实目标读取能力。',
          replyGenerate: capability.replyGenerate
            ? '回复生成能力已声明。'
            : '缺少真实回复生成能力。',
          sendApproval: requiresSendCapability
            ? '发送能力已声明。'
            : contractSendMode === 'auto-send'
              ? '缺少自动发送能力，不能直接发送。'
              : '缺少确认后草稿填入能力。',
          sendResult: capability.message,
        },
      };
    }

    return { ok: true as const };
  }

  private blockTaskForExecutionContract(
    task: InteractionTask,
    contract: {
      ok: false;
      stageKey: string;
      failureReason: string;
      nextAction: string;
      stepMessages?: {
        accountEntry: string;
        targetRead: string;
        replyGenerate: string;
        sendApproval: string;
        sendResult: string;
      };
    },
  ) {
    const messages = contract.stepMessages;
    if (messages) {
      this.setTaskStep(task, 'account-entry', 'blocked', messages.accountEntry);
      this.setTaskStep(task, 'target-read', 'blocked', messages.targetRead);
      this.setTaskStep(
        task,
        'reply-generate',
        'blocked',
        messages.replyGenerate,
      );
      this.setTaskStep(task, 'send-approval', 'blocked', messages.sendApproval);
      this.setTaskStep(task, 'send-result', 'blocked', messages.sendResult);
    }
    this.markQueuedBatchTargets(task, 'failed', contract.failureReason, {
      nextAction: contract.nextAction,
    });
    task.runtimeState = 'executor_missing';
    this.updateTask(
      task,
      'blocked',
      `${contract.failureReason}，任务已阻断。`,
      {
        failureReason: contract.failureReason,
        nextAction: contract.nextAction,
        completedAt: new Date().toISOString(),
      },
    );
    this.pushEvent(
      task,
      'error',
      `${contract.failureReason}，本次不会伪造成已执行。`,
      {
        type: 'failure_reason',
        label: '执行合同失败',
        value: contract.failureReason,
        stageKey: contract.stageKey,
      },
    );
  }

  private updateTask(
    task: InteractionTask,
    status: InteractionTaskStatus,
    eventMessage: string,
    patch?: Partial<InteractionTask>,
  ) {
    task.status = status;
    task.statusLabel = this.resolveStatusLabel(status);
    task.updatedAt = new Date().toISOString();
    Object.assign(task, patch);
    task.planStatus =
      patch?.planStatus ||
      this.resolveGroupBroadcastPlanStatus(
        task.type,
        status,
        undefined,
        task.planTime,
      );
    this.pushEvent(
      task,
      status === 'failed'
        ? 'error'
        : status === 'completed'
          ? 'success'
          : 'info',
      eventMessage,
    );
    this.refreshTaskDiagnostics(task);
  }

  private pushEvent(
    task: InteractionTask,
    level: InteractionTaskEvent['level'],
    message: string,
    evidence?: InteractionTaskEvent['evidence'],
  ) {
    const event = {
      id: this.createId(),
      taskId: task.id,
      level,
      message,
      evidence,
      createdAt: new Date().toISOString(),
    };
    task.events.push(event);
    task.updatedAt = new Date().toISOString();
    this.persistTask(task).catch((error) => {
      console.warn('[local-engine] persist task event failed', error);
    });
    return event;
  }

  private createTaskSteps(
    type: InteractionTaskType,
    hasAccount: boolean,
    now: string,
  ) {
    const targetLabelMap: Record<InteractionTaskType, string> = {
      'douyin-comment-reply': '读取评论',
      'douyin-direct-message-reply': '读取私信',
      'wechat-channel-comment-reply': '读取视频号评论',
      'wechat-channel-direct-message-reply': '读取视频号私信',
      'wechat-reply-draft': '读取微信会话',
      'wechat-friend-accept': '读取好友请求',
      'wechat-group-broadcast': '读取群发对象',
      'wechat-contact-add': '读取加好友对象',
      'wechat-moments-publish': '读取朋友圈素材',
      'wechat-moments-marketing': '读取朋友圈营销对象',
      'customer-follow-up': '读取客户对象',
    };
    const replyLabelMap: Record<InteractionTaskType, string> = {
      'douyin-comment-reply': '生成回复',
      'douyin-direct-message-reply': '生成回复',
      'wechat-channel-comment-reply': '生成视频号评论回复',
      'wechat-channel-direct-message-reply': '生成视频号私信回复',
      'wechat-reply-draft': '生成微信草稿',
      'wechat-friend-accept': '准备好友接受动作',
      'wechat-group-broadcast': '生成群发草稿',
      'wechat-contact-add': '生成好友验证消息',
      'wechat-moments-publish': '生成朋友圈文案',
      'wechat-moments-marketing': '生成朋友圈评论',
      'customer-follow-up': '生成跟进话术',
    };

    return [
      {
        key: 'environment',
        label: '环境检查',
        status: 'pending' as const,
        message: '等待检查本地引擎和权限。',
        updatedAt: now,
      },
      {
        key: 'account-entry',
        label: '账号入口',
        status: hasAccount ? ('pending' as const) : ('skipped' as const),
        message: hasAccount
          ? '等待打开本地账号后台。'
          : '内部记录任务不需要平台账号。',
        updatedAt: now,
      },
      {
        key: 'target-read',
        label: targetLabelMap[type],
        status: 'pending' as const,
        message: '等待定位目标对象。',
        updatedAt: now,
      },
      {
        key: 'reply-generate',
        label: replyLabelMap[type],
        status: 'pending' as const,
        message: '等待生成回复内容。',
        updatedAt: now,
      },
      {
        key: 'send-approval',
        label: '执行保护',
        status: 'pending' as const,
        message: '等待自动/受控执行策略判定。',
        updatedAt: now,
      },
      {
        key: 'send-result',
        label: '结果回写',
        status: 'pending' as const,
        message: '等待写入执行结果和证据。',
        updatedAt: now,
      },
    ];
  }

  private setTaskStep(
    task: InteractionTask,
    key: string,
    status: InteractionTaskStepStatus,
    message: string,
  ) {
    task.steps = task.steps?.length
      ? task.steps
      : this.createTaskSteps(
          task.type,
          Boolean(task.accountId),
          task.createdAt,
        );
    const step = task.steps.find((item) => item.key === key);
    if (!step) return;

    step.status = status;
    step.message = message;
    step.updatedAt = new Date().toISOString();
    task.updatedAt = step.updatedAt;
    this.persistTask(task).catch((error) => {
      console.warn('[local-engine] persist task step failed', error);
    });
  }

  private refreshTaskDiagnostics(task: InteractionTask) {
    const currentStep =
      task.steps?.find((step) => step.status === 'blocked') ||
      task.steps?.find((step) => step.status === 'running') ||
      task.steps?.find((step) => step.status === 'pending') ||
      task.steps?.at(-1);
    const lastEvent = task.events.at(-1);
    const evidenceCount = task.events.filter((event) =>
      Boolean(event.evidence),
    ).length;
    const diagnosticStatus =
      task.status === 'failed' || task.status === 'blocked'
        ? 'blocked'
        : task.status === 'waiting_for_send_confirmation'
          ? 'waiting'
          : task.status === 'completed'
            ? 'completed'
            : task.status === 'skipped'
              ? 'skipped'
              : task.status === 'no_target'
                ? 'no_target'
                : currentStep?.status === 'blocked'
                  ? 'blocked'
                  : 'normal';
    const stepText = currentStep
      ? `${currentStep.label}：${currentStep.message}`
      : '等待任务开始。';
    const summary =
      diagnosticStatus === 'blocked'
        ? `卡在${stepText}`
        : diagnosticStatus === 'waiting'
          ? `等待继续执行：${task.nextAction || currentStep?.message || '条件通过后继续执行。'}`
          : diagnosticStatus === 'completed'
            ? '任务已完成，结果和证据已回写。'
            : diagnosticStatus === 'no_target'
              ? '无对象，未执行发送或发布。'
              : diagnosticStatus === 'skipped'
                ? '任务已跳过。'
                : stepText;
    const resolvedNextAction =
      task.nextAction || this.defaultNextActionForStatus(task.status);

    if (task.failureReason) {
      const platform = task.platformName || this.resolveTypeLabel(task.type);
      task.failureContext = {
        platform,
        account: task.accountName || undefined,
        target: task.targetName || undefined,
        stage: currentStep?.label,
        reason: task.failureReason,
        nextAction: resolvedNextAction,
      };
      if (!task.blockers?.length) {
        task.blockers = [
          {
            platform,
            account: task.accountName || undefined,
            target: task.targetName || undefined,
            stage: currentStep?.label || currentStep?.key || '执行阶段',
            reason: task.failureReason,
            nextAction: resolvedNextAction,
            capability: 'local-engine-diagnostics',
          },
        ];
      }
    } else if (
      task.blockers?.every(
        (blocker) => blocker.capability === 'local-engine-diagnostics',
      )
    ) {
      task.failureContext = undefined;
      task.blockers = undefined;
    }

    const resultSummary = this.buildTaskResultSummary(
      task,
      evidenceCount,
      summary,
    );
    task.diagnostics = {
      status: diagnosticStatus,
      summary,
      account: task.accountName || '未指定账号',
      platform: task.platformName || this.resolveTypeLabel(task.type),
      currentStep: currentStep?.label,
      currentStepStatus: currentStep?.status,
      currentStepMessage: currentStep?.message,
      failureReason: task.failureReason,
      nextAction: task.nextAction,
      runtimeMode: task.runtimeMode,
      evidenceCount,
      lastEventAt: lastEvent?.createdAt,
    };
    task.resultSummary = resultSummary;
  }

  private buildTaskResultSummary(
    task: InteractionTask,
    evidenceCount: number,
    diagnosticSummary: string,
  ): InteractionTaskResultSummary {
    const counts = {
      total: task.batchSummary?.total || task.batchTargets?.length || 1,
      completed:
        task.batchSummary?.completed || (task.status === 'completed' ? 1 : 0),
      failed:
        task.batchSummary?.failed ||
        (['failed', 'blocked'].includes(task.status) ? 1 : 0),
      skipped:
        task.batchSummary?.skipped || (task.status === 'skipped' ? 1 : 0),
      noTarget:
        task.batchSummary?.noTarget || (task.status === 'no_target' ? 1 : 0),
    };
    const kind: InteractionTaskResultKind =
      task.status === 'completed'
        ? 'success'
        : task.status === 'failed' || task.status === 'blocked'
          ? 'failure'
          : task.status === 'skipped'
            ? 'skipped'
            : task.status === 'no_target'
              ? 'no_target'
              : task.status === 'waiting_for_send_confirmation'
                ? 'waiting'
                : 'running';
    const headlineMap = {
      success:
        counts.total > 1 ? `成功 ${counts.completed}/${counts.total}` : '成功',
      failure:
        counts.failed > 0 ? `失败 ${counts.failed}/${counts.total}` : '失败',
      skipped:
        counts.skipped > 0
          ? `跳过 ${counts.skipped}/${counts.total}`
          : '已跳过',
      no_target:
        counts.total > 1
          ? `无对象 ${counts.noTarget}/${counts.total}`
          : '无对象',
      waiting: '等待继续执行',
      running: '执行中',
    } satisfies Record<string, string>;

    return {
      kind,
      headline: headlineMap[kind],
      detail:
        task.failureReason || task.diagnostics?.summary || diagnosticSummary,
      nextAction:
        task.nextAction || this.defaultNextActionForStatus(task.status),
      evidenceCount,
      recordsHref: `/interaction/records?taskId=${task.id}`,
      evidenceHref: `/local-engine?tab=evidence&taskId=${task.id}`,
      diagnosticsHref: `/local-engine?tab=evidence&taskId=${task.id}&diagnostics=1`,
      counts,
    };
  }

  private buildAutoSendReadbackMessage(result: InteractionExecutorDraftResult) {
    const readbackText = result.readbackText?.trim();
    if (readbackText) {
      return `自动发送已完成，回读确认：${readbackText}`;
    }
    return '自动发送已完成，但没有记录到可比对的页面回读文本；不能作为真实回读成功证据。';
  }

  private buildTaskEvidenceReplay(task: InteractionTask) {
    return (task.steps || []).map((step, index) => ({
      seq: index + 1,
      stageKey: step.key,
      label: step.label,
      status: step.status,
      message: step.message,
      updatedAt: step.updatedAt,
      evidence: task.events
        .filter(
          (event) =>
            event.evidence?.stageKey === step.key ||
            event.message.includes(step.label),
        )
        .map((event) => ({
          eventId: event.id,
          level: event.level,
          message: event.message,
          createdAt: event.createdAt,
          evidence: event.evidence,
        })),
    }));
  }

  private buildTaskEvidenceIndex(task: InteractionTask) {
    const evidenceItems = this.collectTaskEvidence(task);
    const isDesktopEvidenceItem = (
      item: ReturnType<LocalEngineService['collectTaskEvidence']>[number],
    ) =>
      item.evidence.type === 'desktop_screenshot' ||
      (this.taskNeedsDesktopEvidence(task) &&
        item.evidence.type === 'screenshot' &&
        /微信|WeChat|Node Runtime 微信执行截图|node-runtime/i.test(
          `${item.evidence.label || ''} ${item.message || ''}`,
        ));
    return {
      counts: this.groupTaskEvidenceByType(
        evidenceItems.map((item) => item.evidence),
      ),
      stageLogs: this.toTaskEvidenceIndexItems(
        evidenceItems.filter((item) => item.evidence.type === 'stage_log'),
      ),
      failureReasons: this.toTaskEvidenceIndexItems(
        evidenceItems.filter((item) => item.evidence.type === 'failure_reason'),
      ),
      riskAudits: this.toTaskEvidenceIndexItems(
        evidenceItems.filter(
          (item) => item.evidence.type === 'diagnostic_bundle',
        ),
      ),
      confirmations: task.approvalRecord
        ? [
            {
              operator: task.approvalRecord.operator,
              targetConfirmed: task.approvalRecord.targetConfirmed,
              contentConfirmed: task.approvalRecord.contentConfirmed,
              currentWindowConfirmed:
                task.approvalRecord.currentWindowConfirmed,
              contactConfirmed: task.approvalRecord.contactConfirmed,
              draftBeforeFillConfirmed:
                task.approvalRecord.draftBeforeFillConfirmed,
              confirmedChecklistKeys:
                task.approvalRecord.confirmedChecklistKeys,
              confirmedAt: task.approvalRecord.confirmedAt,
            },
          ]
        : [],
      browser: this.toTaskEvidenceIndexItems(
        evidenceItems.filter(
          (item) =>
            !isDesktopEvidenceItem(item) &&
            ['screenshot', 'page_snapshot', 'snapshot'].includes(
              item.evidence.type,
            ),
        ),
      ),
      desktop: this.toTaskEvidenceIndexItems(
        evidenceItems.filter(isDesktopEvidenceItem),
      ),
      text: this.toTaskEvidenceIndexItems(
        evidenceItems.filter((item) =>
          ['text', 'file'].includes(item.evidence.type),
        ),
      ),
    };
  }

  private collectTaskEvidence(task: InteractionTask) {
    return task.events
      .filter(
        (
          event,
        ): event is InteractionTaskEvent & {
          evidence: NonNullable<InteractionTaskEvent['evidence']>;
        } => Boolean(event.evidence),
      )
      .map((event) => ({
        eventId: event.id,
        taskId: task.id,
        level: event.level,
        message: event.message,
        createdAt: event.evidence.createdAt || event.createdAt,
        evidence: {
          ...event.evidence,
          id: event.evidence.id || event.id,
          createdAt: event.evidence.createdAt || event.createdAt,
        },
      }));
  }

  private toTaskEvidenceIndexItems(
    items: ReturnType<LocalEngineService['collectTaskEvidence']>,
  ) {
    return items.map((item) => ({
      id: item.evidence.id,
      eventId: item.eventId,
      type: item.evidence.type,
      label: item.evidence.label,
      level: item.level,
      stageKey: item.evidence.stageKey,
      createdAt: item.createdAt,
      artifactUrl: item.evidence.artifactUrl,
      valuePreview: this.previewEvidenceValue(item.evidence.value),
    }));
  }

  private groupTaskEvidenceByType(
    evidenceItems: InteractionTaskEvent['evidence'][],
  ) {
    const empty: Record<
      NonNullable<InteractionTaskEvent['evidence']>['type'],
      number
    > = {
      text: 0,
      snapshot: 0,
      screenshot: 0,
      page_snapshot: 0,
      desktop_screenshot: 0,
      stage_log: 0,
      failure_reason: 0,
      diagnostic_bundle: 0,
      file: 0,
    };
    return evidenceItems.filter(Boolean).reduce((acc, item) => {
      acc[item!.type] = (acc[item!.type] || 0) + 1;
      return acc;
    }, empty);
  }

  private buildTaskEvidenceIntegrity(
    task: InteractionTask,
    evidenceIndex = this.buildTaskEvidenceIndex(task),
  ) {
    const hasActionConclusion =
      Boolean(task.nextAction) ||
      (task.status === 'completed' &&
        (Boolean(task.completedAt) ||
          task.steps?.some(
            (step) => step.key === 'send-result' && step.status === 'completed',
          )));
    const missing = [
      this.collectTaskEvidence(task).length ? '' : '缺少证据项',
      evidenceIndex.stageLogs.length ? '' : '缺少阶段日志',
      task.failureReason ||
      task.status !== 'failed' ||
      evidenceIndex.failureReasons.length
        ? ''
        : '缺少失败原因',
      hasActionConclusion ? '' : '缺少 nextAction',
      task.riskPolicy ? '' : '缺少风险审计',
      task.sendMode === 'approval-send'
        ? evidenceIndex.confirmations.length || task.status !== 'completed'
          ? ''
          : '缺少确认记录'
        : '',
      this.taskNeedsBrowserEvidence(task) && !evidenceIndex.browser.length
        ? '缺少浏览器证据索引'
        : '',
      this.taskNeedsDesktopEvidence(task) && !evidenceIndex.desktop.length
        ? '缺少桌面证据索引'
        : '',
      evidenceIndex.text.length ? '' : '缺少文本证据索引',
    ].filter(Boolean);

    return {
      status: missing.length ? ('FAILED' as const) : ('OK' as const),
      missing,
      required: [
        '阶段日志',
        '失败原因',
        'nextAction',
        '风险审计',
        '确认记录',
        '浏览器/桌面/文本证据索引',
      ],
      checkedAt: new Date().toISOString(),
    };
  }

  private async ensureTaskEvidenceForExport(
    task: InteractionTask,
    stageKey: string,
  ) {
    const integrity = this.buildTaskEvidenceIntegrity(task);
    if (integrity.status === 'OK') {
      return;
    }

    const reason = `证据链不完整：${integrity.missing.join('、')}`;
    const terminalStatuses: InteractionTaskStatus[] = [
      'completed',
      'failed',
      'blocked',
      'skipped',
      'no_target',
    ];
    const preserveExternalBlocker =
      terminalStatuses.includes(task.status) &&
      this.shouldPreserveEvidenceIntegrityBlocker(task);
    const preserveCompletedBusinessResult =
      terminalStatuses.includes(task.status) &&
      this.shouldPreserveCompletedBusinessResult(task);
    const completedWithOnlyActionConclusionMissing =
      task.status === 'completed' &&
      integrity.missing.length === 1 &&
      integrity.missing[0] === '缺少 nextAction';
    if (
      terminalStatuses.includes(task.status) &&
      !preserveExternalBlocker &&
      !preserveCompletedBusinessResult &&
      !completedWithOnlyActionConclusionMissing
    ) {
      this.markQueuedBatchTargets(task, 'failed', reason, {
        nextAction: '导出证据链不完整，请重新执行任务并保留证据。',
      });
      task.status = 'failed';
      task.statusLabel = this.resolveStatusLabel('failed');
      task.failureReason = task.failureReason || reason;
      task.nextAction =
        '导出证据链不完整，已标记 FAILED；请重新执行任务并确认阶段日志、确认记录和平台证据已生成。';
      task.completedAt = task.completedAt || new Date().toISOString();
    }
    if (completedWithOnlyActionConclusionMissing) {
      task.nextAction = '已完成，可在任务证据里查看发送和回读结果。';
      await this.persistTask(task);
      return;
    }
    const eventLevel =
      preserveExternalBlocker || preserveCompletedBusinessResult
        ? 'warning'
        : 'error';
    const eventLabel =
      preserveExternalBlocker || preserveCompletedBusinessResult
        ? '证据导出提醒'
        : '证据导出失败';
    this.pushEvent(task, eventLevel, reason, {
      type: 'failure_reason',
      label: eventLabel,
      value: reason,
      stageKey,
    });
    if (!integrity.missing.includes('缺少阶段日志')) {
      await this.persistTask(task);
      return;
    }
    this.pushEvent(
      task,
      eventLevel,
      preserveExternalBlocker || preserveCompletedBusinessResult
        ? '阶段日志缺失，已保留原始任务状态。'
        : '阶段日志缺失，证据导出已标记 FAILED。',
      {
        type: 'stage_log',
        label: eventLabel,
        value: `${stageKey} / FAILED / ${reason}`,
        stageKey,
      },
    );
    await this.persistTask(task);
  }

  private shouldPreserveCompletedBusinessResult(task: InteractionTask) {
    const summaryCompleted =
      task.batchSummary && Number(task.batchSummary.completed || 0) > 0;
    const targetCompleted = Boolean(
      task.batchTargets?.some((target) => target.status === 'completed'),
    );
    const stepCompleted = Boolean(
      task.steps?.some(
        (step) => step.key === 'send-result' && step.status === 'completed',
      ),
    );
    const successEvent = task.events.some((event) => event.level === 'success');
    return (
      task.status === 'completed' ||
      summaryCompleted ||
      targetCompleted ||
      stepCompleted ||
      successEvent
    );
  }

  private repairEvidenceIntegrityOnlyFailureTask(task: InteractionTask) {
    if (task.status !== 'failed') {
      return false;
    }
    if (!this.shouldPreserveCompletedBusinessResult(task)) {
      return false;
    }

    const summaryFailed = Number(task.batchSummary?.failed || 0);
    const summaryNoTarget = Number(task.batchSummary?.noTarget || 0);
    const summarySkipped = Number(task.batchSummary?.skipped || 0);
    const targetHasRealFailure = Boolean(
      task.batchTargets?.some((target) =>
        ['failed', 'blocked', 'no_target'].includes(target.status),
      ),
    );
    if (
      summaryFailed > 0 ||
      summaryNoTarget > 0 ||
      summarySkipped > 0 ||
      targetHasRealFailure
    ) {
      return false;
    }

    const evidenceIntegritySignals = [
      task.failureReason,
      task.nextAction,
      task.resultSummary?.detail,
      task.resultSummary?.nextAction,
      task.diagnostics?.summary,
      task.diagnostics?.failureReason,
      ...(task.batchTargets || []).flatMap((target) => [target.failureReason]),
    ].filter(Boolean);
    const evidenceIntegrityOnly =
      evidenceIntegritySignals.length > 0 &&
      evidenceIntegritySignals.every((value) =>
        /证据链不完整|导出证据链不完整/.test(String(value)),
      );
    if (!evidenceIntegrityOnly) {
      return false;
    }

    const now = new Date().toISOString();
    task.status = 'completed';
    task.statusLabel = this.resolveStatusLabel('completed');
    task.failureReason = undefined;
    task.failureContext = undefined;
    task.blockers = undefined;
    task.nextAction =
      task.batchTargets?.find((target) => target.nextAction)?.nextAction ||
      '已完成，可在任务证据里查看发送和回读结果。';
    task.completedAt = task.completedAt || now;
    task.batchTargets = task.batchTargets?.map((target) => ({
      ...target,
      status: target.status === 'completed' ? target.status : 'completed',
      failureReason: undefined,
      nextAction:
        target.nextAction &&
        !/证据链不完整|导出证据链不完整/.test(target.nextAction)
          ? target.nextAction
          : '已完成，可在任务证据里查看发送和回读结果。',
      updatedAt: target.updatedAt || now,
    }));
    task.batchSummary = this.buildBatchSummary(task.batchTargets || []);
    task.steps = task.steps?.map((step) =>
      step.status === 'blocked' &&
      /证据链不完整|导出证据链不完整/.test(step.message)
        ? {
            ...step,
            status: 'completed',
            message: '已完成，可在任务证据里查看发送和回读结果。',
            updatedAt: step.updatedAt || now,
          }
        : step,
    );
    return true;
  }

  private shouldPreserveEvidenceIntegrityBlocker(task: InteractionTask) {
    if (['blocked', 'skipped', 'no_target'].includes(task.status)) {
      return true;
    }
    const text = [
      task.status,
      task.failureReason,
      task.nextAction,
      task.resultSummary?.detail,
      task.resultSummary?.nextAction,
      task.diagnostics?.summary,
    ]
      .filter(Boolean)
      .join('\n');
    return /需要登录|未登录|重新登录|登录失效|登录过期|扫码|验证码|账号|权限|无对象|无可处理|没有可处理|no target|no_target|target_not_found|平台未就绪|仍在加载|执行器|本地引擎/i.test(
      text,
    );
  }

  private buildTaskFailureAnalysis(task: InteractionTask) {
    const failedStep = task.steps?.find((step) => step.status === 'blocked');
    const failureEvents = task.events.filter(
      (event) =>
        event.level === 'error' || event.evidence?.type === 'failure_reason',
    );
    return {
      failed:
        task.status === 'failed' ||
        task.status === 'blocked' ||
        Boolean(task.failureReason),
      failureReason: task.failureReason || failedStep?.message,
      failedStage: failedStep?.key,
      nextAction: task.nextAction,
      eventCount: failureEvents.length,
      events: failureEvents.map((event) => ({
        id: event.id,
        message: event.message,
        createdAt: event.createdAt,
        evidence: event.evidence,
      })),
    };
  }

  private buildRecordsSummary(records: InteractionTask[]) {
    const summary = records.reduce(
      (acc, task) => {
        acc.total += 1;
        if (task.status === 'completed') acc.completed += 1;
        if (task.status === 'failed' || task.status === 'blocked')
          acc.failed += 1;
        if (task.status === 'blocked') acc.blocked += 1;
        if (task.status === 'skipped') acc.skipped += 1;
        if (task.status === 'no_target') acc.noTarget += 1;
        acc.evidenceCount += task.events.filter((event) =>
          Boolean(event.evidence),
        ).length;
        acc.byType[task.type] = (acc.byType[task.type] || 0) + 1;
        if (
          !acc.lastUpdatedAt ||
          task.updatedAt.localeCompare(acc.lastUpdatedAt) > 0
        ) {
          acc.lastUpdatedAt = task.updatedAt;
        }
        return acc;
      },
      {
        total: 0,
        completed: 0,
        failed: 0,
        blocked: 0,
        skipped: 0,
        noTarget: 0,
        evidenceCount: 0,
        byType: {
          'douyin-comment-reply': 0,
          'douyin-direct-message-reply': 0,
          'wechat-channel-comment-reply': 0,
          'wechat-channel-direct-message-reply': 0,
          'wechat-reply-draft': 0,
          'wechat-friend-accept': 0,
          'wechat-group-broadcast': 0,
          'wechat-contact-add': 0,
          'wechat-moments-publish': 0,
          'wechat-moments-marketing': 0,
          'customer-follow-up': 0,
        },
        lastUpdatedAt: undefined as string | undefined,
      },
    );

    return summary;
  }

  private toRecordExportRows(task: InteractionTask) {
    const evidenceIndex = this.buildTaskEvidenceIndex(task);
    const integrity = this.buildTaskEvidenceIntegrity(task, evidenceIndex);
    const evidenceCount = String(
      task.events.filter((event) => Boolean(event.evidence)).length,
    );
    const riskAudit = this.formatEvidenceIndexForCsv(evidenceIndex.riskAudits);
    const confirmations = this.formatConfirmationIndexForCsv(
      evidenceIndex.confirmations,
    );
    const stageLogs = this.formatEvidenceIndexForCsv(evidenceIndex.stageLogs);
    const browserEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.browser,
    );
    const desktopEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.desktop,
    );
    const textEvidence = this.formatEvidenceIndexForCsv(evidenceIndex.text);
    const failureEvidence = this.formatEvidenceIndexForCsv(
      evidenceIndex.failureReasons,
    );
    const base = [
      task.id,
      task.statusLabel,
      task.typeLabel,
      task.platformName || '',
      task.accountName,
    ];

    if (task.batchTargets?.length) {
      return task.batchTargets.map((target, index) => [
        ...base,
        String(index + 1),
        target.targetName,
        target.status,
        target.failureReason || task.failureReason || '',
        task.diagnostics?.summary || '',
        target.nextAction || task.nextAction || '',
        task.riskLevel || '',
        riskAudit,
        confirmations,
        stageLogs,
        browserEvidence,
        desktopEvidence,
        textEvidence,
        failureEvidence,
        task.resultSummary?.headline || '',
        target.sourceText,
        target.replyText,
        evidenceCount,
        (target.evidenceEventIds || []).join('|'),
        integrity.status === 'OK'
          ? 'OK'
          : `FAILED: ${integrity.missing.join('；')}`,
        task.createdAt,
        target.updatedAt || task.updatedAt,
        task.completedAt || '',
      ]);
    }

    return [
      [
        ...base,
        '',
        task.targetName,
        task.status,
        task.failureReason || '',
        task.diagnostics?.summary || '',
        task.nextAction || '',
        task.riskLevel || '',
        riskAudit,
        confirmations,
        stageLogs,
        browserEvidence,
        desktopEvidence,
        textEvidence,
        failureEvidence,
        task.resultSummary?.headline || '',
        task.sourceText,
        task.replyText,
        evidenceCount,
        task.events
          .filter((event) => Boolean(event.evidence))
          .map((event) => event.id)
          .join('|'),
        integrity.status === 'OK'
          ? 'OK'
          : `FAILED: ${integrity.missing.join('；')}`,
        task.createdAt,
        task.updatedAt,
        task.completedAt || '',
      ],
    ];
  }

  private toCsv(rows: string[][]) {
    const bom = '\uFEFF';
    return `${bom}${rows
      .map((row) =>
        row
          .map((cell) => {
            const value = String(cell ?? '');
            return `"${value.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\n')}`;
  }

  private formatEvidenceIndexForCsv(
    items: Array<{
      eventId?: string;
      id?: string;
      type: string;
      label: string;
      stageKey?: string;
      createdAt?: string;
    }>,
  ) {
    return items
      .map(
        (item) =>
          `${item.stageKey || item.type}:${item.label}#${item.eventId || item.id || 'n/a'}`,
      )
      .join('；');
  }

  private formatConfirmationIndexForCsv(items: Array<Record<string, unknown>>) {
    return items
      .map((item) =>
        [
          item.id ? `id=${item.id}` : '',
          item.operator ? `operator=${item.operator}` : '',
          item.status ? `status=${item.status}` : '',
          item.confirmedAt ? `confirmedAt=${item.confirmedAt}` : '',
          item.decidedAt ? `decidedAt=${item.decidedAt}` : '',
        ]
          .filter(Boolean)
          .join('/'),
      )
      .filter(Boolean)
      .join('；');
  }

  private ensureTaskStore() {
    if (!this.taskStoreReady) {
      this.taskStoreReady = Promise.resolve();
    }

    return this.taskStoreReady;
  }

  private readonly taskTypeToPrisma: Record<string, string> = {
    'douyin-comment-reply': 'DOUYIN_COMMENT_REPLY',
    'douyin-direct-message-reply': 'DOUYIN_DIRECT_MESSAGE_REPLY',
    'wechat-channel-comment-reply': 'WECHAT_CHANNEL_COMMENT_REPLY',
    'wechat-channel-direct-message-reply':
      'WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY',
    'wechat-reply-draft': 'WECHAT_REPLY_DRAFT',
    'wechat-friend-accept': 'WECHAT_FRIEND_ACCEPT',
    'wechat-group-broadcast': 'WECHAT_GROUP_BROADCAST',
    'wechat-contact-add': 'WECHAT_CONTACT_ADD',
    'wechat-moments-publish': 'WECHAT_MOMENTS_PUBLISH',
    'wechat-moments-marketing': 'WECHAT_MOMENTS_MARKETING',
    'customer-follow-up': 'CUSTOMER_FOLLOW_UP',
  };

  private readonly taskTypeFromPrisma: Record<string, string> = {
    DOUYIN_COMMENT_REPLY: 'douyin-comment-reply',
    DOUYIN_DIRECT_MESSAGE_REPLY: 'douyin-direct-message-reply',
    WECHAT_CHANNEL_COMMENT_REPLY: 'wechat-channel-comment-reply',
    WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: 'wechat-channel-direct-message-reply',
    WECHAT_REPLY_DRAFT: 'wechat-reply-draft',
    WECHAT_FRIEND_ACCEPT: 'wechat-friend-accept',
    WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
    WECHAT_CONTACT_ADD: 'wechat-contact-add',
    WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
    WECHAT_MOMENTS_MARKETING: 'wechat-moments-marketing',
    CUSTOMER_FOLLOW_UP: 'customer-follow-up',
  };

  private readonly taskStatusToPrisma: Record<string, string> = {
    queued: 'QUEUED',
    running: 'RUNNING',
    waiting_for_send_confirmation: 'WAITING_FOR_SEND_CONFIRMATION',
    completed: 'COMPLETED',
    failed: 'FAILED',
    blocked: 'BLOCKED',
    skipped: 'SKIPPED',
    no_target: 'NO_TARGET',
    paused: 'PAUSED',
  };

  private readonly taskStatusFromPrisma: Record<string, string> = {
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

  private async persistTask(task: InteractionTask) {
    const previous = this.taskPersistQueues.get(task.id) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.persistTaskNow(task));
    this.taskPersistQueues.set(task.id, next);
    try {
      await next;
    } finally {
      if (this.taskPersistQueues.get(task.id) === next) {
        this.taskPersistQueues.delete(task.id);
      }
    }
  }

  private async persistTaskNow(task: InteractionTask) {
    await this.ensureTaskStore();
    if (!task.tenantId || !task.userId) {
      const scope = await this.resolveTenantScope().catch(() => null);
      if (scope) {
        task.tenantId = task.tenantId || scope.tenantId;
        task.userId = task.userId || scope.userId;
      }
    }
    if ((!task.tenantId || !task.userId) && task.id) {
      const existing = await this.prisma.interactionTask.findUnique({
        where: { id: task.id },
        select: { tenantId: true, userId: true },
      });
      if (existing?.tenantId && existing?.userId) {
        task.tenantId = task.tenantId || existing.tenantId;
        task.userId = task.userId || existing.userId;
      }
    }
    if (!task.tenantId || !task.userId) {
      throw new ForbiddenException('互动任务缺少租户归属，已拒绝写入。');
    }
    this.refreshTaskDiagnostics(task);
    const taskType = (this.taskTypeToPrisma[task.type] ||
      task.type) as PrismaInteractionTaskType;
    const status = (this.taskStatusToPrisma[task.status] ||
      task.status) as PrismaInteractionTaskStatus;
    const data = {
      tenantId: task.tenantId,
      userId: task.userId,
      taskType,
      status,
      accountId: task.accountId != null ? String(task.accountId) : null,
      ruleId: task.replyBotId ?? null,
      sendMode: task.sendMode || 'approval-send',
      riskLevel: task.riskLevel || 'medium',
      stage: task.diagnostics?.currentStep ?? null,
      currentTarget: task.targetName ?? null,
      draftText: task.replyText ?? null,
      processedCount: task.batchSummary
        ? task.batchSummary.total -
          task.batchSummary.queued -
          task.batchSummary.failed -
          task.batchSummary.skipped
        : 0,
      failedCount: task.batchSummary?.failed ?? 0,
      skippedCount: task.batchSummary?.skipped ?? 0,
      batchTargets: task.batchTargets ?? undefined,
      batchSummary: task.batchSummary ?? undefined,
      events: task.events ?? [],
      evidence: (task as { evidence?: unknown }).evidence ?? [],
      config: task as unknown as Prisma.InputJsonValue,
      createdBy: (task as { createdBy?: string | null }).createdBy ?? null,
      localTaskId: (task as { localTaskId?: string | null }).localTaskId ?? null,
      requiresDoubleConfirmation: task.requiresDoubleConfirmation ?? false,
    };
    await this.runPrismaTransientRetry('persist interaction task', () =>
      this.prisma.interactionTask.upsert({
        where: {
          id: task.id,
          tenantId: task.tenantId,
          userId: task.userId,
        },
        create: { id: task.id, ...data, createdAt: new Date(task.createdAt) },
        update: data,
      }),
    );
  }

  private async runPrismaTransientRetry<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (attempt >= 2 || !this.isPrismaTransientConnectionError(error)) {
          throw error;
        }
        const waitMs = 500 * (attempt + 1);
        console.warn(
          `[local-engine] ${label} transient database error, retrying in ${waitMs}ms`,
          this.formatPrismaRetryError(error),
        );
        await this.delay(waitMs);
      }
    }
    throw lastError;
  }

  private isPrismaTransientConnectionError(error: unknown): boolean {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const message = this.formatPrismaRetryError(error);
    return (
      code === 'P1001' ||
      code === 'P1002' ||
      code === 'P2024' ||
      message.includes("Can't reach database server") ||
      message.includes('Timed out fetching a new connection') ||
      message.includes('Connection terminated unexpectedly') ||
      message.includes('ECONNRESET') ||
      message.includes('ECONNREFUSED')
    );
  }

  private formatPrismaRetryError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  private async persistReplyRule(
    rule: InteractionReplyRuleConfig = this.replyRule,
    requestedScope?: LocalEngineTenantScope,
  ) {
    await this.ensureTaskStore();
    const scope = requestedScope || (await this.resolveTenantScope());
    const ruleJson = rule as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.interactionReplyRule.upsert({
      where: {
        tenantId_userId_botKey: {
          ...scope,
          botKey: 'default',
        },
      },
      create: {
        id: this.createId(),
        ...scope,
        botKey: 'default',
        configVersion: rule.configVersion,
        revision: rule.revision,
        name: rule.botName || '销售顾问机器人',
        industry: rule.industryName,
        tone: rule.tone,
        sendMode: rule.defaultSendMode,
        keywords: rule.requireApprovalKeywords,
        forbiddenWords: rule.blockedKeywords,
        highlights: rule.serviceHighlights,
        closingText: rule.closingText,
        ruleJson,
        escalationRules: ruleJson,
        enabled: true,
      },
      update: {
        name: rule.botName || '销售顾问机器人',
        industry: rule.industryName,
        tone: rule.tone,
        sendMode: rule.defaultSendMode,
        keywords: rule.requireApprovalKeywords,
        forbiddenWords: rule.blockedKeywords,
        highlights: rule.serviceHighlights,
        closingText: rule.closingText,
        ruleJson,
        escalationRules: ruleJson,
        configVersion: rule.configVersion,
        revision: rule.revision,
      },
    });
    this.replyRules.set(this.tenantScopeKey(scope), rule);
    return row;
  }

  private async persistAgentSession(session: AgentSession) {
    await this.ensureTaskStore();
    if (!session.tenantId || !session.userId) {
      throw new ForbiddenException('Agent 会话缺少租户归属，已拒绝写入。');
    }
    const sessionJson = session as unknown as Prisma.InputJsonValue;
    const data = {
      tenantId: session.tenantId,
      userId: session.userId,
      title: session.title,
      instruction: session.instruction,
      source: this.agentSessionSourceToPrisma(session.source),
      status: session.status,
      scope: session.executionScope,
      targetApp: session.targetApp ?? null,
      riskLevel: session.riskLevel ?? null,
      events: session.events ?? [],
      confirmations: session.confirmations ?? [],
      evidence: [],
      sessionJson,
      completedAt: session.completedAt ? new Date(session.completedAt) : null,
    };
    await this.prisma.agentSession.upsert({
      where: {
        id: session.id,
        tenantId: session.tenantId,
        userId: session.userId,
      },
      create: {
        id: session.id,
        ...data,
        createdAt: new Date(session.createdAt),
      },
      update: data,
    });
    await Promise.all(
      session.confirmations.map((confirmation) =>
        this.persistAgentConfirmation(confirmation),
      ),
    );
  }

  private async persistAgentConfirmation(confirmation: AgentConfirmation) {
    await this.ensureTaskStore();
    if (!confirmation.tenantId || !confirmation.userId) {
      throw new ForbiddenException('Agent 确认项缺少租户归属，已拒绝写入。');
    }
    const confirmationJson = confirmation as unknown as Prisma.InputJsonValue;
    const data = {
      tenantId: confirmation.tenantId,
      userId: confirmation.userId,
      sessionId: confirmation.sessionId,
      action: confirmation.actionLabel,
      riskLevel: confirmation.riskLevel,
      status: confirmation.status,
      target: confirmation.title,
      targetLabel: confirmation.title,
      content: confirmation.description,
      replyText: null,
      operator: confirmation.operator ?? null,
      note: confirmation.note ?? null,
      confirmationJson,
      decidedAt: confirmation.decidedAt
        ? new Date(confirmation.decidedAt)
        : null,
    };
    await this.prisma.agentConfirmation.upsert({
      where: {
        id: confirmation.id,
        tenantId: confirmation.tenantId,
        userId: confirmation.userId,
      },
      create: {
        id: confirmation.id,
        ...data,
        createdAt: new Date(confirmation.createdAt),
      },
      update: data,
    });
  }

  private agentSessionSourceToPrisma(source?: AgentSessionSource) {
    return source === 'agent-console' ? 'agent_console' : (source ?? 'web');
  }

  private async loadReplyRuleFromStore(
    requestedScope?: LocalEngineTenantScope,
  ): Promise<InteractionReplyRuleConfig> {
    await this.ensureTaskStore();
    const scope = requestedScope || (await this.resolveTenantScope());
    const cacheKey = this.tenantScopeKey(scope);
    const cached = this.replyRules.get(cacheKey);
    if (cached) {
      return cached;
    }

    let row = await this.runPrismaTransientRetry(
      'load scoped interaction reply rule',
      () =>
        this.prisma.interactionReplyRule.findFirst({
          where: { ...scope, botKey: 'default' },
        }),
    );
    if (!row) {
      row = await this.persistReplyRule(this.createDefaultReplyRule(), scope);
    }
    const rule = this.toCustomerServiceReplyBot(row).config;
    this.replyRules.set(cacheKey, rule);
    return rule;
  }

  private async hydrateTasksFromStore(limit = 50) {
    const scope = await this.resolveTenantScope();
    const rows = await this.prisma.interactionTask.findMany({
      where: scope,
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });

    rows.forEach((row) => {
      const task = row.config as InteractionTask | null;
      if (task?.id) {
        task.tenantId = row.tenantId;
        task.userId = row.userId;
        this.normalizeStoredBatchTargets(task);
        this.repairEvidenceIntegrityOnlyFailureTask(task);
        this.repairHydratedTaskEvidence(row as InteractionTaskSummaryRow, task);
        this.refreshTaskDiagnostics(task);
        this.tasks.set(task.id, task);
      }
    });
  }

  private async listStoredTaskSummaries(
    limit = 50,
    filter: InteractionTaskListFilter = {},
    types?: InteractionTaskType[],
  ): Promise<InteractionTask[]> {
    const scope = await this.resolveTenantScope();
    const where: Record<string, unknown> = { ...scope };
    const prismaTypes = (
      types?.length ? types : filter.type ? [filter.type] : []
    )
      .map((type) => this.taskTypeToPrisma[type] || type)
      .filter(Boolean);
    if (prismaTypes.length === 1) {
      where.taskType = prismaTypes[0];
    } else if (prismaTypes.length > 1) {
      where.taskType = { in: prismaTypes };
    }
    if (filter.status) {
      where.status = this.taskStatusToPrisma[filter.status] || filter.status;
    } else if (filter.recordsOnly) {
      where.status = {
        in: ['COMPLETED', 'FAILED', 'BLOCKED', 'SKIPPED', 'NO_TARGET'],
      };
    }

    const rows = await this.prisma.interactionTask.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
      select: {
        id: true,
        tenantId: true,
        userId: true,
        taskType: true,
        accountId: true,
        sendMode: true,
        status: true,
        riskLevel: true,
        stage: true,
        currentTarget: true,
        draftText: true,
        processedCount: true,
        failedCount: true,
        skippedCount: true,
        batchTargets: true,
        batchSummary: true,
        config: true,
        createdBy: true,
        localTaskId: true,
        requiresDoubleConfirmation: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return rows.map((row) => this.toStoredTaskSummary(row));
  }

  private async mergeTaskSummaries(
    storedTasks: InteractionTask[],
    filter: InteractionTaskListFilter = {},
    types?: InteractionTaskType[],
  ) {
    const scope = await this.resolveTenantScope();
    const allowedTypes = types?.length ? new Set(types) : undefined;
    const merged = new Map<string, InteractionTask>();
    for (const task of storedTasks) {
      merged.set(task.id, task);
    }
    for (const task of this.tasks.values()) {
      if (!this.isInTenantScope(task, scope)) continue;
      if (filter.type && task.type !== filter.type) continue;
      if (allowedTypes && !allowedTypes.has(task.type)) continue;
      if (filter.status && task.status !== filter.status) continue;
      if (
        filter.recordsOnly &&
        !['completed', 'failed', 'blocked', 'skipped', 'no_target'].includes(
          task.status,
        )
      ) {
        continue;
      }
      merged.set(task.id, task);
    }
    return [...merged.values()];
  }

  private normalizeTaskForDisplay(task: InteractionTask): InteractionTask {
    const {
      billingIdentity: _billingIdentity,
      tenantId: _tenantId,
      userId: _userId,
      ...publicTask
    } = task as InteractionTask & { billingIdentity?: unknown };
    const needsEvidenceIntegrityRepair =
      this.taskHasEvidenceIntegrityText(task);
    const displayNextAction =
      this.cleanEvidenceIntegrityText(task.nextAction) ||
      this.defaultNextActionForStatus(task.status);
    const displayFailureReason =
      this.cleanEvidenceIntegrityText(task.failureReason) ||
      this.cleanEvidenceIntegrityText(task.diagnostics?.failureReason) ||
      this.cleanEvidenceIntegrityText(
        task.batchTargets?.find((target) => target.failureReason)
          ?.failureReason,
      ) ||
      (needsEvidenceIntegrityRepair &&
      (task.status === 'failed' || task.status === 'blocked')
        ? `${this.resolveTypeLabel(task.type)}停在${task.diagnostics?.currentStep || task.steps?.find((step) => step.status === 'blocked')?.label || '执行阶段'}。`
        : undefined);
    const displayEvents = needsEvidenceIntegrityRepair
      ? this.ensureStoredSummaryEvidenceEvents(
          this.normalizeStoredTaskEvents(
            [task.events],
            task.id,
            task.updatedAt,
          ),
          {
            taskId: task.id,
            type: task.type,
            status: task.status,
            stage:
              task.diagnostics?.currentStep ||
              task.steps?.find((step) => step.status === 'blocked')?.key ||
              'summary',
            targetName: task.targetName,
            sourceText: task.sourceText,
            replyText: task.replyText,
            failureReason: displayFailureReason,
            nextAction: displayNextAction,
            updatedAt: task.updatedAt,
          },
        )
      : task.events;
    return {
      ...publicTask,
      statusLabel: this.normalizeTaskDisplayText(
        task.statusLabel || this.resolveStatusLabel(task.status),
      ),
      failureReason: displayFailureReason
        ? this.normalizeTaskDisplayText(displayFailureReason)
        : undefined,
      nextAction: displayNextAction
        ? this.normalizeTaskDisplayText(displayNextAction)
        : undefined,
      failureContext: task.failureContext
        ? {
            ...task.failureContext,
            stage: task.failureContext.stage
              ? this.normalizeTaskDisplayText(task.failureContext.stage)
              : undefined,
            reason: this.normalizeTaskDisplayText(task.failureContext.reason),
            nextAction: task.failureContext.nextAction
              ? this.normalizeTaskDisplayText(task.failureContext.nextAction)
              : undefined,
          }
        : undefined,
      blockers: task.blockers?.map((blocker) => ({
        ...blocker,
        stage: this.normalizeTaskDisplayText(blocker.stage || '执行阶段'),
        reason: this.normalizeTaskDisplayText(blocker.reason),
        nextAction: blocker.nextAction
          ? this.normalizeTaskDisplayText(blocker.nextAction)
          : this.defaultNextActionForStatus(task.status),
      })),
      batchTargets: task.batchTargets?.map((target) => ({
        ...target,
        failureReason: target.failureReason
          ? this.normalizeTaskDisplayText(target.failureReason)
          : undefined,
        nextAction: target.nextAction
          ? this.normalizeTaskDisplayText(target.nextAction)
          : undefined,
      })),
      diagnostics: task.diagnostics
        ? {
            ...task.diagnostics,
            summary: this.normalizeTaskDisplayText(task.diagnostics.summary),
            currentStep: task.diagnostics.currentStep
              ? this.normalizeTaskDisplayText(task.diagnostics.currentStep)
              : undefined,
            currentStepMessage: task.diagnostics.currentStepMessage
              ? this.normalizeTaskDisplayText(
                  task.diagnostics.currentStepMessage,
                )
              : undefined,
            failureReason: displayFailureReason
              ? this.normalizeTaskDisplayText(displayFailureReason)
              : undefined,
            nextAction: displayNextAction
              ? this.normalizeTaskDisplayText(displayNextAction)
              : undefined,
            evidenceCount: needsEvidenceIntegrityRepair
              ? displayEvents.filter((event) => Boolean(event.evidence)).length
              : task.diagnostics.evidenceCount,
          }
        : undefined,
      resultSummary: task.resultSummary
        ? {
            ...task.resultSummary,
            headline: this.normalizeTaskDisplayText(
              task.resultSummary.headline,
            ),
            detail: this.normalizeTaskDisplayText(
              this.cleanEvidenceIntegrityText(task.resultSummary.detail) ||
                displayFailureReason ||
                task.resultSummary.detail,
            ),
            nextAction: this.normalizeTaskDisplayText(
              this.cleanEvidenceIntegrityText(task.resultSummary.nextAction) ||
                displayNextAction,
            ),
            evidenceCount: needsEvidenceIntegrityRepair
              ? displayEvents.filter((event) => Boolean(event.evidence)).length
              : task.resultSummary.evidenceCount,
          }
        : undefined,
      steps: task.steps?.map((step) => ({
        ...step,
        key: this.normalizeTaskDisplayText(step.key),
        label: this.normalizeTaskDisplayText(step.label),
        message: this.normalizeTaskDisplayText(step.message),
      })),
      events: displayEvents.map((event) => ({
        ...event,
        message: this.normalizeTaskDisplayText(event.message),
        evidence: event.evidence
          ? {
              ...event.evidence,
              label: event.evidence.label
                ? this.normalizeTaskDisplayText(event.evidence.label)
                : event.evidence.label,
              value:
                typeof event.evidence.value === 'string'
                  ? this.normalizeTaskDisplayText(event.evidence.value)
                  : event.evidence.value,
            }
          : undefined,
      })),
    };
  }

  private normalizeTaskDisplayText(value: string) {
    return String(value || '')
      .replaceAll('发送确认', '执行保护')
      .replaceAll('确认后发送模式', '受控执行模式')
      .replaceAll('确认后发送', '受控发送')
      .replaceAll('确认后发布', '受控发布')
      .replaceAll('确认后提交', '受控提交')
      .replaceAll('等待人工确认或发送策略判定', '等待自动/受控执行策略判定')
      .replaceAll('等待人工确认', '等待继续执行')
      .replaceAll('等待用户确认', '等待继续执行')
      .replaceAll('等待确认后发送', '等待继续执行')
      .replaceAll('等待确认', '等待继续执行')
      .replaceAll('待确认', '待继续')
      .replaceAll(
        '请确认目标和内容后继续',
        '目标、内容和当前窗口通过回读后继续执行',
      )
      .replaceAll('请确认后继续', '条件通过后继续执行')
      .replaceAll('确认目标和内容', '回读目标和内容')
      .replaceAll('停在发送前等待确认', '条件不完整时停止并留下证据')
      .replaceAll('停在发表前等待确认', '条件不完整时停止并留下证据')
      .replaceAll('停在提交前等待确认', '条件不完整时停止并留下证据')
      .replaceAll('停在发送前', '等待继续执行')
      .replaceAll('停在发表前', '等待继续执行')
      .replaceAll('停在提交前', '等待继续执行')
      .replaceAll('停在确认前', '等待继续执行')
      .replaceAll('二次确认', '高风险继续保护');
  }

  private toStoredTaskSummary(row: InteractionTaskSummaryRow): InteractionTask {
    const storedConfig =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? (row.config as unknown as Partial<InteractionTask>)
        : undefined;
    const type = this.normalizeStoredTaskType(row.taskType);
    const status = this.normalizeStoredTaskStatus(row.status);
    const batchTargets = this.normalizeStoredTaskSummaryTargets(
      storedConfig?.batchTargets || row.batchTargets,
      status,
    );
    const primaryTarget = batchTargets[0];
    const batchSummary =
      this.normalizeStoredTaskSummaryValue(row.batchSummary) ||
      (batchTargets.length
        ? this.buildBatchSummary(batchTargets)
        : {
            total:
              row.processedCount + row.failedCount + row.skippedCount > 0
                ? row.processedCount + row.failedCount + row.skippedCount
                : 0,
            queued: 0,
            running: 0,
            waitingConfirmation: 0,
            completed: Math.max(
              0,
              row.processedCount - row.failedCount - row.skippedCount,
            ),
            failed: row.failedCount,
            skipped: row.skippedCount,
            noTarget: status === 'no_target' ? 1 : 0,
          });
    const createdAt = row.createdAt.toISOString();
    const updatedAt = row.updatedAt.toISOString();
    const targetName =
      primaryTarget?.targetName || row.currentTarget || '未记录对象';
    const sourceText = primaryTarget?.sourceText || row.currentTarget || '';
    const replyText = primaryTarget?.replyText || row.draftText || '';
    const riskLevel = this.normalizeStoredRiskLevel(row.riskLevel);
    const nextAction =
      this.cleanEvidenceIntegrityText(storedConfig?.nextAction) ||
      primaryTarget?.nextAction ||
      this.defaultNextActionForStatus(status);
    const failureReason =
      this.cleanEvidenceIntegrityText(storedConfig?.failureReason) ||
      this.cleanEvidenceIntegrityText(primaryTarget?.failureReason) ||
      this.cleanEvidenceIntegrityText(
        storedConfig?.diagnostics?.failureReason,
      ) ||
      (status === 'failed' || status === 'blocked'
        ? `${this.resolveTypeLabel(type)}停在${row.stage || '执行阶段'}。`
        : undefined);
    const storedEvidenceColumns = row as {
      events?: unknown;
      evidence?: unknown;
    };
    const events = this.ensureStoredSummaryEvidenceEvents(
      this.normalizeStoredTaskEvents(
        [
          storedConfig?.events,
          storedEvidenceColumns.events,
          storedEvidenceColumns.evidence,
        ],
        row.id,
        updatedAt,
      ),
      {
        taskId: row.id,
        type,
        status,
        stage: row.stage || 'summary',
        targetName,
        sourceText,
        replyText,
        failureReason,
        nextAction,
        updatedAt,
      },
    );
    const evidenceCount = this.countStoredTaskSummaryEvidence({
      batchTargets,
      diagnostics: storedConfig?.diagnostics,
      events,
      resultSummary: storedConfig?.resultSummary,
    });
    const riskPolicy =
      storedConfig?.riskPolicy ||
      this.createStoredSummaryRiskPolicy(riskLevel, targetName, updatedAt);
    const task: InteractionTask = {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      type,
      typeLabel: this.resolveTypeLabel(type),
      status,
      statusLabel: this.resolveStatusLabel(status),
      planName: this.optionalTrimmedText(storedConfig?.planName),
      planTime: this.optionalTrimmedText(storedConfig?.planTime),
      planStatus: this.resolveGroupBroadcastPlanStatus(
        type,
        status,
        storedConfig?.planStatus,
        storedConfig?.planTime,
      ),
      dailyLimit: this.optionalNumber(storedConfig?.dailyLimit),
      associatedWeChat: this.optionalTrimmedText(
        storedConfig?.associatedWeChat,
      ),
      currentWechatId: this.optionalTrimmedText(storedConfig?.currentWechatId),
      plannedWechatId: this.optionalTrimmedText(storedConfig?.plannedWechatId),
      generateOnDemand:
        typeof storedConfig?.generateOnDemand === 'boolean'
          ? storedConfig.generateOnDemand
          : undefined,
      accountId: row.accountId || undefined,
      accountName: row.createdBy || row.accountId || '未指定账号',
      platformName: this.resolveSummaryPlatformName(type),
      targetName,
      sourceText,
      replyText,
      sendMode: this.isSendMode(row.sendMode) ? row.sendMode : 'approval-send',
      riskLevel,
      requiresDoubleConfirmation: row.requiresDoubleConfirmation,
      executionMode: this.isDesktopInteractionTask(type)
        ? 'browser-assisted'
        : 'internal-record',
      runtimeState: this.isLiveExecutorTask(type)
        ? 'preflight_only'
        : 'record_ready',
      createdAt,
      updatedAt,
      failureReason,
      nextAction,
      batchTargets,
      batchSummary,
      billingIdentity: this.normalizeInteractionTaskBillingIdentity(
        storedConfig?.billingIdentity,
      ),
      riskPolicy,
      diagnostics: {
        status: this.resolveSummaryDiagnosticStatus(status),
        summary: `${this.resolveTypeLabel(type)}${row.stage ? ` / ${row.stage}` : ''}`,
        account: row.accountId || row.createdBy || '未指定账号',
        platform: this.resolveSummaryPlatformName(type),
        currentStep: row.stage || undefined,
        currentStepStatus:
          status === 'failed' || status === 'blocked'
            ? 'blocked'
            : status === 'completed'
              ? 'completed'
              : status === 'running'
                ? 'running'
                : 'pending',
        failureReason,
        nextAction,
        evidenceCount,
        lastEventAt: updatedAt,
      },
      resultSummary: storedConfig?.resultSummary
        ? {
            ...storedConfig.resultSummary,
            evidenceCount: Math.max(
              this.toNonNegativeInteger(
                storedConfig.resultSummary.evidenceCount,
              ),
              evidenceCount,
            ),
          }
        : evidenceCount > 0
          ? {
              kind:
                status === 'completed'
                  ? 'success'
                  : status === 'no_target'
                    ? 'no_target'
                    : status === 'skipped'
                      ? 'skipped'
                      : status === 'failed' || status === 'blocked'
                        ? 'failure'
                        : status === 'waiting_for_send_confirmation'
                          ? 'waiting'
                          : 'running',
              headline: this.resolveStatusLabel(status),
              detail: `${this.resolveTypeLabel(type)}${row.stage ? ` / ${row.stage}` : ''}`,
              nextAction,
              evidenceCount,
              recordsHref: `/interaction/records?taskId=${row.id}`,
              evidenceHref: `/local-engine?tab=evidence&taskId=${row.id}`,
              diagnosticsHref: `/local-engine?tab=evidence&taskId=${row.id}&diagnostics=1`,
              counts: {
                total: batchSummary.total || batchTargets.length || 1,
                completed: batchSummary.completed || 0,
                failed: batchSummary.failed || 0,
                skipped: batchSummary.skipped || 0,
                noTarget: batchSummary.noTarget || 0,
              },
            }
          : undefined,
      steps: row.stage
        ? [
            {
              key: row.stage,
              label: row.stage,
              status:
                status === 'failed' || status === 'blocked'
                  ? 'blocked'
                  : status === 'completed'
                    ? 'completed'
                    : status === 'running'
                      ? 'running'
                      : 'pending',
              message: `${this.resolveStatusLabel(status)} / ${targetName}`,
              updatedAt,
            },
          ]
        : [],
      events,
    };

    this.repairEvidenceIntegrityOnlyFailureTask(task);
    return task;
  }

  private normalizeStoredTaskEvents(
    sources: unknown[],
    taskId: string,
    fallbackCreatedAt: string,
  ): InteractionTaskEvent[] {
    const events: InteractionTaskEvent[] = [];
    let index = 0;
    for (const source of sources) {
      if (!Array.isArray(source)) {
        continue;
      }
      for (const item of source) {
        const event = this.normalizeStoredTaskEvent(
          item,
          taskId,
          fallbackCreatedAt,
          index,
        );
        index += 1;
        if (event) {
          events.push(event);
        }
      }
    }

    const unique = new Map<string, InteractionTaskEvent>();
    events.forEach((event) => {
      if (!unique.has(event.id)) {
        unique.set(event.id, event);
      }
    });
    return [...unique.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  private repairHydratedTaskEvidence(
    row: InteractionTaskSummaryRow,
    task: InteractionTask,
  ) {
    const updatedAt = row.updatedAt.toISOString();
    const primaryTarget = task.batchTargets?.[0];
    const nextAction =
      this.cleanEvidenceIntegrityText(task.nextAction) ||
      this.cleanEvidenceIntegrityText(primaryTarget?.nextAction) ||
      this.defaultNextActionForStatus(task.status);
    const failureReason =
      this.cleanEvidenceIntegrityText(task.failureReason) ||
      this.cleanEvidenceIntegrityText(task.diagnostics?.failureReason) ||
      this.cleanEvidenceIntegrityText(primaryTarget?.failureReason) ||
      (task.status === 'failed' || task.status === 'blocked'
        ? `${this.resolveTypeLabel(task.type)}停在${row.stage || task.diagnostics?.currentStep || '执行阶段'}。`
        : undefined);
    const stage =
      row.stage ||
      task.diagnostics?.currentStep ||
      task.steps?.find((step) => step.status === 'blocked')?.key ||
      'summary';

    task.nextAction = nextAction;
    if (failureReason) {
      task.failureReason = failureReason;
    } else if (this.isEvidenceIntegrityText(task.failureReason)) {
      task.failureReason = undefined;
    }
    const storedEvidenceColumns = row as {
      events?: unknown;
      evidence?: unknown;
    };
    task.events = this.ensureStoredSummaryEvidenceEvents(
      this.normalizeStoredTaskEvents(
        [
          task.events,
          storedEvidenceColumns.events,
          storedEvidenceColumns.evidence,
        ],
        task.id,
        updatedAt,
      ),
      {
        taskId: task.id,
        type: task.type,
        status: task.status,
        stage,
        targetName: task.targetName,
        sourceText: task.sourceText,
        replyText: task.replyText,
        failureReason,
        nextAction,
        updatedAt,
      },
    );
    task.riskPolicy =
      task.riskPolicy ||
      this.createStoredSummaryRiskPolicy(
        task.riskLevel || this.normalizeStoredRiskLevel(row.riskLevel),
        task.targetName,
        updatedAt,
      );
  }

  private cleanEvidenceIntegrityText(value: unknown) {
    const text = this.optionalTrimmedText(value);
    return text && !this.isEvidenceIntegrityText(text) ? text : undefined;
  }

  private isEvidenceIntegrityText(value: unknown) {
    return /证据链不完整|导出证据链不完整|阶段日志缺失|证据导出/.test(
      String(value || ''),
    );
  }

  private taskHasEvidenceIntegrityText(task: InteractionTask) {
    return [
      task.failureReason,
      task.nextAction,
      task.diagnostics?.failureReason,
      task.diagnostics?.summary,
      task.resultSummary?.detail,
      task.resultSummary?.nextAction,
      ...(task.batchTargets || []).flatMap((target) => [
        target.failureReason,
        target.nextAction,
      ]),
      ...(task.events || []).flatMap((event) => [
        event.message,
        event.evidence?.label,
        event.evidence?.value,
      ]),
    ].some((value) => this.isEvidenceIntegrityText(value));
  }

  private normalizeStoredTaskEvent(
    input: unknown,
    taskId: string,
    fallbackCreatedAt: string,
    index: number,
  ): InteractionTaskEvent | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return null;
    }
    const record = input as Record<string, unknown>;
    const evidence =
      this.normalizeStoredTaskEvidence(record.evidence, fallbackCreatedAt) ||
      this.normalizeStoredTaskEvidence(record, fallbackCreatedAt);
    const createdAt =
      this.optionalTrimmedText(record.createdAt) ||
      evidence?.createdAt ||
      fallbackCreatedAt;
    const message =
      this.optionalTrimmedText(record.message) ||
      evidence?.label ||
      evidence?.value?.toString() ||
      '历史任务证据';
    if (this.isStoredEvidenceIntegrityBackfill(record, evidence, message)) {
      return null;
    }
    const level = this.normalizeStoredEventLevel(record.level);
    return {
      id:
        this.optionalTrimmedText(record.id) ||
        `${taskId}-stored-event-${index + 1}`,
      taskId: this.optionalTrimmedText(record.taskId) || taskId,
      level,
      message,
      createdAt,
      evidence,
    };
  }

  private isStoredEvidenceIntegrityBackfill(
    record: Record<string, unknown>,
    evidence: InteractionTaskEvent['evidence'],
    message: string,
  ) {
    const text = [message, evidence?.label, evidence?.value, record.message]
      .filter(Boolean)
      .join('\n');
    const stageKey =
      evidence?.stageKey || this.optionalTrimmedText(record.stageKey);
    return (
      stageKey === 'records-export' &&
      /证据链不完整|阶段日志缺失|证据导出/.test(text)
    );
  }

  private normalizeStoredTaskEvidence(
    input: unknown,
    fallbackCreatedAt: string,
  ): InteractionTaskEvent['evidence'] | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }
    const record = input as Record<string, unknown>;
    const rawType = this.optionalTrimmedText(record.type);
    const type = this.normalizeStoredEvidenceType(rawType);
    if (!type) {
      return undefined;
    }
    return {
      id: this.optionalTrimmedText(record.id),
      type,
      label:
        this.optionalTrimmedText(record.label) ||
        this.optionalTrimmedText(record.message) ||
        '历史任务证据',
      value:
        typeof record.value === 'string'
          ? record.value
          : record.value == null
            ? ''
            : JSON.stringify(record.value),
      artifactUrl:
        this.optionalTrimmedText(record.artifactUrl) ||
        this.optionalTrimmedText(record.path),
      stageKey: this.optionalTrimmedText(record.stageKey),
      createdAt:
        this.optionalTrimmedText(record.createdAt) || fallbackCreatedAt,
    };
  }

  private normalizeStoredEventLevel(
    value: unknown,
  ): InteractionTaskEvent['level'] {
    return value === 'success' ||
      value === 'warning' ||
      value === 'error' ||
      value === 'info'
      ? value
      : 'info';
  }

  private normalizeStoredEvidenceType(
    value: string | undefined,
  ): NonNullable<InteractionTaskEvent['evidence']>['type'] | undefined {
    const allowed: Array<
      NonNullable<InteractionTaskEvent['evidence']>['type']
    > = [
      'text',
      'snapshot',
      'screenshot',
      'page_snapshot',
      'desktop_screenshot',
      'stage_log',
      'failure_reason',
      'diagnostic_bundle',
      'file',
    ];
    return allowed.find((type) => type === value);
  }

  private ensureStoredSummaryEvidenceEvents(
    events: InteractionTaskEvent[],
    context: {
      taskId: string;
      type: InteractionTaskType;
      status: InteractionTaskStatus;
      stage: string;
      targetName: string;
      sourceText: string;
      replyText: string;
      failureReason?: string;
      nextAction: string;
      updatedAt: string;
    },
  ) {
    const result = [...events];
    const hasEvidenceType = (
      type: NonNullable<InteractionTaskEvent['evidence']>['type'],
    ) => result.some((event) => event.evidence?.type === type);
    const pushSummaryEvidence = (
      suffix: string,
      level: InteractionTaskEvent['level'],
      message: string,
      evidence: NonNullable<InteractionTaskEvent['evidence']>,
    ) => {
      result.push({
        id: `${context.taskId}-summary-${suffix}`,
        taskId: context.taskId,
        level,
        message,
        evidence,
        createdAt: context.updatedAt,
      });
    };

    if (!hasEvidenceType('stage_log')) {
      pushSummaryEvidence('stage-log', 'info', '历史任务阶段日志已补齐。', {
        type: 'stage_log',
        label: '历史任务阶段',
        value: `${context.stage} / ${context.status}`,
        stageKey: context.stage,
        createdAt: context.updatedAt,
      });
    }
    if (
      (context.status === 'failed' || context.status === 'blocked') &&
      !hasEvidenceType('failure_reason')
    ) {
      pushSummaryEvidence(
        'failure-reason',
        'warning',
        context.failureReason || '历史失败原因已补齐。',
        {
          type: 'failure_reason',
          label: '历史失败原因',
          value: context.failureReason || '历史任务失败或被阻断。',
          stageKey: context.stage,
          createdAt: context.updatedAt,
        },
      );
    }
    if (!hasEvidenceType('text')) {
      pushSummaryEvidence('text', 'info', '历史任务文本摘要已补齐。', {
        type: 'text',
        label: '历史任务摘要',
        value: JSON.stringify(
          {
            type: this.resolveTypeLabel(context.type),
            status: context.status,
            stage: context.stage,
            targetName: context.targetName,
            sourceText: context.sourceText,
            replyText: context.replyText,
            failureReason: context.failureReason,
            nextAction: context.nextAction,
          },
          null,
          2,
        ),
        stageKey: context.stage,
        createdAt: context.updatedAt,
      });
    }
    return result.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  private countStoredTaskSummaryEvidence(input: {
    batchTargets?: InteractionBatchTarget[];
    diagnostics?: Partial<NonNullable<InteractionTask['diagnostics']>>;
    events?: InteractionTaskEvent[];
    resultSummary?: Partial<InteractionTaskResultSummary>;
  }) {
    const eventEvidenceCount = Array.isArray(input.events)
      ? input.events.filter((event) => Boolean(event?.evidence)).length
      : 0;
    const targetEvidenceIds = new Set<string>();
    input.batchTargets?.forEach((target) => {
      target.evidenceEventIds?.forEach((id) => {
        if (id) targetEvidenceIds.add(id);
      });
    });

    return Math.max(
      eventEvidenceCount,
      targetEvidenceIds.size,
      this.toNonNegativeInteger(input.diagnostics?.evidenceCount),
      this.toNonNegativeInteger(input.resultSummary?.evidenceCount),
    );
  }

  private normalizeStoredTaskType(value: unknown): InteractionTaskType {
    const raw = String(value || '');
    const type = this.taskTypeFromPrisma[raw] || raw;
    return this.isKnownInteractionTaskType(type)
      ? type
      : 'douyin-comment-reply';
  }

  private normalizeStoredTaskStatus(value: unknown): InteractionTaskStatus {
    const raw = String(value || '');
    const status = this.taskStatusFromPrisma[raw] || raw;
    return this.isKnownInteractionTaskStatus(status) ? status : 'queued';
  }

  private isKnownInteractionTaskStatus(
    status: string,
  ): status is InteractionTaskStatus {
    return [
      'queued',
      'running',
      'paused',
      'blocked',
      'waiting_for_send_confirmation',
      'completed',
      'failed',
      'skipped',
      'no_target',
    ].includes(status);
  }

  private normalizeStoredRiskLevel(value: string): AgentRiskLevel {
    return value === 'low' || value === 'medium' || value === 'high'
      ? value
      : 'medium';
  }

  private createStoredSummaryRiskPolicy(
    riskLevel: AgentRiskLevel,
    targetName: string,
    createdAt: string,
  ): LocalEngineRiskPolicy {
    const requiredRole = riskLevel === 'high' ? 'manager' : 'operator';
    return {
      planMode: 'commercial',
      requiredRole,
      approverRoles: ['manager', 'admin'],
      targetName,
      targetWhitelisted: false,
      whitelistTargets: [],
      forbiddenActions:
        riskLevel === 'high'
          ? ['delete', 'payment', 'transfer', 'mass-send', 'clear-data']
          : [],
      forbiddenActionHits: [],
      remoteTakeoverAuditRequired: false,
      remoteAudit: [
        {
          action: 'requested',
          operator: 'system',
          reason: `历史任务汇总恢复，风险等级=${riskLevel}，目标=${targetName}`,
          createdAt,
        },
      ],
      message:
        requiredRole === 'operator'
          ? '历史任务汇总：操作员可查看，真实执行仍以原任务证据为准。'
          : '历史任务汇总：高风险任务需要管理员/经理查看，真实执行仍以原任务证据为准。',
    };
  }

  private normalizeStoredTaskSummaryTargets(
    value: unknown,
    taskStatus?: InteractionTaskStatus,
  ): InteractionBatchTarget[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((target): target is Record<string, unknown> =>
        Boolean(target && typeof target === 'object' && !Array.isArray(target)),
      )
      .map((target, index) => {
        const status = this.normalizeStoredSummaryTargetStatus(
          this.normalizeBatchTargetStatus(
            this.optionalTrimmedText(
              target.status,
            ) as InteractionBatchTarget['status'],
          ),
          taskStatus,
        );
        return {
          id:
            this.optionalTrimmedText(target.id) || `stored-target-${index + 1}`,
          targetName:
            this.optionalTrimmedText(target.targetName) ||
            this.optionalTrimmedText(target.name) ||
            `对象 ${index + 1}`,
          sourceText: this.optionalTrimmedText(target.sourceText) || '',
          replyText: this.optionalTrimmedText(target.replyText) || '',
          status,
          failureReason:
            status === 'skipped'
              ? undefined
              : this.optionalTrimmedText(target.failureReason),
          nextAction:
            status === 'skipped'
              ? '任务已跳过，未继续执行该对象。'
              : this.optionalTrimmedText(target.nextAction),
          evidenceEventIds: Array.isArray(target.evidenceEventIds)
            ? target.evidenceEventIds.map(String).filter(Boolean)
            : undefined,
          updatedAt: this.optionalTrimmedText(target.updatedAt),
        };
      });
  }

  private normalizeStoredSummaryTargetStatus(
    status: InteractionBatchTarget['status'],
    taskStatus?: InteractionTaskStatus,
  ): InteractionBatchTarget['status'] {
    if (
      taskStatus === 'skipped' &&
      status !== 'completed' &&
      status !== 'no_target'
    ) {
      return 'skipped';
    }
    return status;
  }

  private normalizeStoredTaskSummaryValue(
    value: unknown,
  ): InteractionTask['batchSummary'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    return {
      total: this.toNonNegativeInteger(record.total),
      queued: this.toNonNegativeInteger(record.queued),
      running: this.toNonNegativeInteger(record.running),
      waitingConfirmation: this.toNonNegativeInteger(
        record.waitingConfirmation,
      ),
      completed: this.toNonNegativeInteger(record.completed),
      failed: this.toNonNegativeInteger(record.failed),
      skipped: this.toNonNegativeInteger(record.skipped),
      noTarget: this.toNonNegativeInteger(record.noTarget),
    };
  }

  private toNonNegativeInteger(value: unknown) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
  }

  private resolveSummaryPlatformName(type: InteractionTaskType) {
    if (type.startsWith('douyin')) return '抖音';
    if (type.startsWith('wechat-channel')) return '视频号';
    if (this.isDesktopInteractionTask(type)) return '微信';
    return '客户跟进';
  }

  private resolveSummaryDiagnosticStatus(
    status: InteractionTaskStatus,
  ): NonNullable<InteractionTask['diagnostics']>['status'] {
    if (status === 'completed') return 'completed';
    if (status === 'failed' || status === 'blocked') return 'blocked';
    if (status === 'skipped') return 'skipped';
    if (status === 'no_target') return 'no_target';
    if (status === 'waiting_for_send_confirmation') return 'waiting';
    return 'normal';
  }

  private async hydrateAgentSessionsFromStore(
    limit = 50,
    requestedScope?: LocalEngineTenantScope,
  ) {
    const scope = requestedScope || (await this.resolveTenantScope());
    const sessionRows = await this.prisma.agentSession.findMany({
      where: scope,
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });
    const confirmationRows = await this.prisma.agentConfirmation.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
    });

    sessionRows.forEach((row) => {
      const session = row.sessionJson as AgentSession | null;
      if (session?.id) {
        session.tenantId = row.tenantId;
        session.userId = row.userId;
        const dbConfirmations = confirmationRows
          .filter((c) => c.sessionId === session.id)
          .map(
            (c) =>
              ({
                ...(c.confirmationJson as Record<string, unknown>),
                tenantId: c.tenantId,
                userId: c.userId,
              }) as unknown as AgentConfirmation,
          )
          .filter(Boolean);
        session.confirmations = this.mergeAgentConfirmations(
          session.confirmations || [],
          dbConfirmations,
        );
        this.rememberAgentSession(session);
      }
    });
  }

  private async hydrateAgentConfirmationsFromStore(
    limit = 200,
    requestedScope?: LocalEngineTenantScope,
  ) {
    const scope = requestedScope || (await this.resolveTenantScope());
    const rows = await this.prisma.agentConfirmation.findMany({
      where: scope,
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
    });

    rows.forEach((row) => {
      const confirmation = row.confirmationJson as AgentConfirmation | null;
      if (confirmation?.id) {
        confirmation.tenantId = row.tenantId;
        confirmation.userId = row.userId;
        this.agentConfirmations.set(confirmation.id, confirmation);
      }
    });
  }

  private async loadStoredAgentSession(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ) {
    const scope = requestedScope || (await this.resolveTenantScope());
    const row = await this.prisma.agentSession.findFirst({
      where: { id, ...scope },
    });
    if (!row) {
      return null;
    }
    const session = row.sessionJson as AgentSession | null;
    if (!session) {
      return null;
    }
    session.tenantId = row.tenantId;
    session.userId = row.userId;
    const confirmationRows = await this.prisma.agentConfirmation.findMany({
      where: { sessionId: id, ...scope },
      orderBy: { createdAt: 'desc' },
    });
    const dbConfirmations = confirmationRows
      .map(
        (c) =>
          ({
            ...(c.confirmationJson as Record<string, unknown>),
            tenantId: c.tenantId,
            userId: c.userId,
          }) as unknown as AgentConfirmation,
      )
      .filter(Boolean);
    session.confirmations = this.mergeAgentConfirmations(
      session.confirmations || [],
      dbConfirmations,
    );
    return session;
  }

  private async loadStoredTask(
    id: string,
    requestedScope?: LocalEngineTenantScope,
  ) {
    const scope = requestedScope || (await this.resolveTenantScope());
    const row = await this.prisma.interactionTask.findFirst({
      where: { id, ...scope },
    });

    const task = (row?.config as InteractionTask) || null;
    if (task) {
      task.tenantId = row!.tenantId;
      task.userId = row!.userId;
      this.normalizeStoredBatchTargets(task);
      this.repairEvidenceIntegrityOnlyFailureTask(task);
      this.refreshTaskDiagnostics(task);
    }
    return task;
  }

  private async getPlaywrightMcpStatusWithCount() {
    if (!this.playwrightMcp) {
      return {
        online: false,
        childProcessRunning: false,
        transport: 'none' as const,
        endpoint: '',
        pid: undefined,
        toolCount: 0,
        profileKey: undefined,
        profileDir: undefined,
        visibleWindow: false,
        isolated: false,
        readyForAutomation: false,
        requiredToolsReady: false,
        requiredTools: [],
        missingRequiredTools: [],
        message: 'PlaywrightMcpService 未注入',
      };
    }
    return this.playwrightMcp.getAutomationStatus();
  }

  private async getCapabilities(
    now: string,
    user?: LocalEngineEntitlementUser,
  ): Promise<LocalEngineCapability[]> {
    const useNodeRuntime = this.useNodeAgentRuntime();
    const [
      interactionCapabilities,
      publishingCapability,
      kaypalEntitlement,
      aiReplyModel,
      evidenceReplay,
      fileAccess,
      mcpStatus,
      playwrightMcpStatus,
      sidecarStatus,
      sandboxStatus,
      pluginStatus,
      memoryStatus,
    ] = await Promise.all([
      this.withCapabilityTimeout(
        '互动接口能力',
        this.checkInteractionCapabilities(),
        {
          status: 'blocked' as const,
          summary: '互动接口能力检查超时。',
          nextAction: '刷新状态或重启本地浏览器控制服务后重试。',
          checks: [
            {
              name: '互动能力接口',
              status: 'blocked' as const,
              message: '检查超过 8 秒，不能证明真实互动执行器可用。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        '内容发布能力',
        this.checkContentPublishingCapability(),
        {
          status: 'blocked' as const,
          summary: '内容发布能力检查超时。',
          nextAction: '刷新状态或重启 3011 本地 Runtime 后重试。',
          checks: [
            {
              name: '发布执行器',
              status: 'blocked' as const,
              message: '检查超过 2 秒，不能证明内容发布执行器可用。',
            },
          ],
        },
      ),
      this.withCapabilityTimeout(
        'Kaypal 账号与权益',
        this.buildKaypalEntitlementCapability(now, user),
        this.buildKaypalEntitlementTimeoutFallback(now, user),
        6000,
      ),
      this.withCapabilityTimeout(
        'AI 回复模型',
        this.checkAiReplyModelConfig(),
        {
          status: 'blocked' as const,
          summary: 'AI 默认模型检查超时。',
          nextAction: '稍后刷新，或到模型配置页重新同步 Kaypal 模型台。',
          checks: [
            {
              name: '默认模型配置读取',
              status: 'blocked' as const,
              message: '检查超过 2 秒，不能证明 AI 模型授权/配置可用。',
            },
          ],
        },
      ),
      this.withCapabilityTimeout(
        '证据链与回放',
        this.checkEvidenceReplayCapability(),
        {
          status: 'blocked' as const,
          summary: '证据链检查超时。',
          nextAction: '检查本地证据目录、任务记录表和 RuntimeExecution 表。',
          checks: [
            {
              name: '证据链检查',
              status: 'blocked' as const,
              message: '检查超过 8 秒，不能证明证据和诊断记录可用。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        '文件访问',
        this.checkFileAccess(),
        {
          status: 'blocked' as const,
          summary: '文件访问检查超时。',
          nextAction: '检查本地目录权限后刷新。',
          checks: [
            {
              name: '目录读写检查',
              status: 'blocked' as const,
              message:
                '检查超过 8 秒，不能证明素材、账号档案和证据目录可读写。',
            },
          ],
        },
        8000,
      ),
      this.withCapabilityTimeout(
        'MCP 工具服务管理',
        this.mcpRuntime.getStatus(),
        {
          available: false,
          serverCount: 0,
          toolCount: 0,
          resourceCount: 0,
          strictMode: false,
          servers: [],
          message: 'MCP 状态检查超时',
        },
      ),
      this.withCapabilityTimeout(
        'playwright-mcp',
        this.getPlaywrightMcpStatusWithCount(),
        {
          online: false,
          childProcessRunning: Boolean(
            this.playwrightMcp?.getStatus().childProcessRunning,
          ),
          transport: 'none' as const,
          endpoint: '',
          pid: this.playwrightMcp?.getStatus().pid,
          toolCount: 0,
          profileKey: this.playwrightMcp?.getStatus().profileKey,
          profileDir: this.playwrightMcp?.getStatus().profileDir,
          visibleWindow: this.playwrightMcp?.getStatus().visibleWindow ?? false,
          isolated: this.playwrightMcp?.getStatus().isolated ?? false,
          message: 'playwright-mcp 工具发现超时',
        },
      ),
      useNodeRuntime
        ? Promise.resolve({
            available: false,
            version: null,
            runnerMode: null,
            sessionProtocol: false,
            eventStream: false,
            screenshotArtifacts: false,
            executionControl: false,
            message:
              'Node Runtime 模式下外部 17777 Python sidecar 为可选兼容项，未参与必需检查。',
          })
        : this.withCapabilityTimeout(
            'Agent-S 执行能力',
            this.agentSidecar.getStatus(),
            {
              available: false,
              version: null,
              runnerMode: null,
              sessionProtocol: false,
              eventStream: false,
              screenshotArtifacts: false,
              executionControl: false,
              message: 'Agent-S sidecar 状态检查超时',
            },
          ),
      this.withCapabilityTimeout('沙箱执行', this.sandboxRuntime.getStatus(), {
        available: false,
        platform: platform(),
        dockerAvailable: false,
        sandboxType: 'none',
        message: '沙箱运行时检查超时',
      }),
      this.withCapabilityTimeout(
        '插件与技能运行时',
        this.pluginRuntime.getStatus(),
        {
          available: false,
          skillDirectory: null,
          skillhubDirectory: null,
          skillhubSkills: [],
          installedSkillCount: 0,
          skillNames: [],
          runtimeApiAvailable: false,
          message: '插件运行时检查超时',
        },
      ),
      this.withCapabilityTimeout(
        '记忆与上下文',
        this.memoryRuntime.getStatus(),
        {
          available: false,
          shortTermAvailable: false,
          dailyAvailable: false,
          longTermAvailable: false,
          runtimeApiAvailable: false,
          message: '记忆运行时检查超时',
        },
      ),
    ]);
    const desktop = await this.withCapabilityTimeout(
      '桌面微信',
      this.readDesktopStatusWithEvidenceCached(now),
      this.buildDesktopStatus(
        {
          platform: 'wechat',
          available: false,
          running: false,
          appName: '微信',
          windowCount: 0,
          message: '桌面微信状态检查超时。',
          permissionHints: ['检查超过 4 秒，不能证明微信桌面链路可用。'],
          screenshotAvailable: false,
          inputControlAvailable: false,
          clickControlAvailable: false,
          fileSelectionAvailable: false,
        },
        now,
      ),
      4000,
    );
    const wechatDesktopReady = this.isDesktopWechatExecutionReady(desktop);
    const wechatDesktopRunnable = this.isDesktopWechatRuntimeRunnable(desktop);
    const wechatCommerciallyRunnable =
      wechatDesktopRunnable && this.hasWechatControlSurfaceEvidence(desktop);
    const wechatDesktopBlocker = this.summarizeDesktopWechatBlocker(desktop);
    const wechatSessionLocked =
      wechatDesktopReady &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.takeoverActive !== true &&
      !this.wechatSessionConfirmation.stoppedAt;
    const agentSCapability = useNodeRuntime
      ? await this.buildNodeAgentRuntimeCapability(now, sidecarStatus.message)
      : this.buildLegacyAgentSCapability(now, sidecarStatus);

    return [
      {
        key: 'browser-control',
        name: '浏览器引擎',
        status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightMcpStatus.readyForAutomation
          ? `浏览器控制已就绪，可通过 3011 Node Runtime/CDP/Playwright 操作平台后台（tools=${playwrightMcpStatus.toolCount ?? 0}）。`
          : '浏览器自动化工具未就绪，不能执行真实平台读取、发送和回读。',
        checkedAt: now,
        nextAction: playwrightMcpStatus.readyForAutomation
          ? ''
          : '检查包内 Playwright Chromium、@playwright/mcp、工具发现和 3011 启动日志。',
        checks: [
          {
            name: 'playwright-mcp',
            status: playwrightMcpStatus.readyForAutomation
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.message,
          },
          {
            name: '必需浏览器工具',
            status: playwrightMcpStatus.requiredToolsReady
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.requiredToolsReady
              ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已发现。`
              : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      {
        key: 'interaction-capabilities',
        name: '真实互动执行器',
        status: interactionCapabilities.status,
        required: true,
        summary: interactionCapabilities.summary,
        checkedAt: now,
        nextAction: interactionCapabilities.nextAction,
        checks: interactionCapabilities.checks,
      },
      {
        key: 'content-publishing',
        name: '内容发布执行器',
        status: publishingCapability.status,
        required: true,
        summary: publishingCapability.summary,
        checkedAt: now,
        nextAction: publishingCapability.nextAction,
        checks: publishingCapability.checks,
      },
      kaypalEntitlement,
      {
        key: 'ai-reply-model',
        name: 'AI 回复模型',
        status: aiReplyModel.status,
        required: true,
        summary: aiReplyModel.summary,
        checkedAt: now,
        nextAction: aiReplyModel.nextAction,
        checks: aiReplyModel.checks,
      },
      {
        key: 'desktop-control',
        name: '桌面控制',
        status:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? 'ready'
            : 'blocked',
        required: true,
        summary:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? `桌面微信可控，当前窗口：${desktop.window.currentWindowTitle || '已检测到微信窗口'}。`
            : `桌面微信不可用：${wechatDesktopBlocker}`,
        checkedAt: now,
        nextAction:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '桌面微信已具备执行条件，微信任务会按自动/受控执行规则推进。'
            : desktop.nextAction,
        checks: desktop.permissionChecks.map((check) => ({
          name: check.label,
          status: check.status,
          message: check.message,
        })),
      },
      {
        key: 'mcp-manager',
        name: 'Playwright/MCP 工具',
        status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
        required: true,
        summary: playwrightMcpStatus.readyForAutomation
          ? `playwright-mcp sidecar 在线（${playwrightMcpStatus.message}）`
          : 'playwright-mcp 未运行；真实浏览器自动化工具不可用。',
        checkedAt: now,
        nextAction: playwrightMcpStatus.readyForAutomation
          ? `MCP 端点 ${playwrightMcpStatus.endpoint} 暴露 ${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具；任何 MCP 客户端（Claude/Cursor/Agent-S）都能通过 POST 调。`
          : '检查 PlaywrightMcpService 初始化日志（一般在 nest-start.log 顶部）',
        checks: [
          {
            name: 'sidecar 进程',
            status: playwrightMcpStatus.childProcessRunning
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.childProcessRunning
              ? `本地 @playwright/mcp 子进程运行中 (pid=${playwrightMcpStatus.pid ?? '?'})`
              : '子进程未启动',
          },
          {
            name: 'HTTP 端点',
            status: playwrightMcpStatus.online ? 'ready' : 'blocked',
            message: `${playwrightMcpStatus.endpoint} (${playwrightMcpStatus.transport})`,
          },
          {
            name: '工具发现',
            status: playwrightMcpStatus.requiredToolsReady
              ? 'ready'
              : 'blocked',
            message: playwrightMcpStatus.requiredToolsReady
              ? `${playwrightMcpStatus.toolCount ?? 0} 个 browser_* 工具已暴露 (browser_navigate/click/type/snapshot/screenshot 等)`
              : `缺少必需工具：${(playwrightMcpStatus.missingRequiredTools || []).join(', ') || '未完成工具发现'}`,
          },
        ],
      },
      agentSCapability,
      {
        key: 'wechat-execution',
        name: '微信完整执行链',
        status:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? 'ready'
            : 'blocked',
        required: true,
        summary:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '微信会话、回复、群发、加好友、朋友圈发布和朋友圈营销都已接入本机桌面执行链。'
            : `微信执行链未就绪：${wechatDesktopBlocker}`,
        checkedAt: now,
        nextAction:
          wechatDesktopReady || wechatCommerciallyRunnable
            ? '创建微信任务后，系统会回读目标、内容和当前窗口，条件通过后继续执行。'
            : desktop.nextAction,
        checks: [
          {
            name: '微信进程检测',
            status: desktop.running ? 'ready' : 'blocked',
            message: desktop.running
              ? `${desktop.appName || '微信'} 已运行。`
              : '桌面微信未运行。',
          },
          {
            name: '联系人锁定',
            status: wechatSessionLocked
              ? 'ready'
              : wechatDesktopReady || wechatCommerciallyRunnable
                ? 'warning'
                : 'blocked',
            message: wechatSessionLocked
              ? `当前已锁定：${this.wechatSessionConfirmation.targetContact?.trim()}。`
              : wechatDesktopReady || wechatCommerciallyRunnable
                ? '已取得可信微信窗口证据；当前未锁定具体联系人，按商用测试账号受控执行风险提示处理。'
                : '桌面微信未就绪，不能锁定联系人或群聊。',
          },
          {
            name: '执行保护',
            status:
              wechatDesktopReady || wechatCommerciallyRunnable
                ? 'ready'
                : 'blocked',
            message:
              '回复、群发、加好友和朋友圈动作会在自动/受控执行后写入截图、失败原因和任务记录。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary:
          '远程控制不纳入当前 AI 员工主流程，已保留接管审计和会话证据记录。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '当前以本机执行和任务记录为主；远程接管只保留审计记录。',
          },
          {
            name: '用户接管审计',
            status: 'ready',
            message:
              'Agent 会话已包含 remoteTakeoverAuditRequired 和 remoteAudit，确认/拒绝会写入审批日志。',
          },
        ],
      },
      {
        key: 'plugin-runtime',
        name: '插件与技能运行时',
        status: pluginStatus.available ? 'ready' : 'optional',
        required: false,
        summary: pluginStatus.message,
        checkedAt: now,
        nextAction: pluginStatus.available
          ? `已发现 ${pluginStatus.installedSkillCount} 个本地技能、${pluginStatus.skillhubSkills.filter((skill) => skill.installed).length} 个 SkillHub 技能。`
          : '当前主流程使用已注册的本机执行链；需要扩展插件时再安装本地技能。',
        checks: [
          {
            name: '插件目录',
            status: pluginStatus.installedSkillCount > 0 ? 'ready' : 'optional',
            message:
              pluginStatus.installedSkillCount > 0
                ? `${pluginStatus.installedSkillCount} 个技能已安装于 ${pluginStatus.skillDirectory}。`
                : '未找到技能目录或目录为空。',
          },
          {
            name: 'SkillHub 技能',
            status: pluginStatus.skillhubSkills.some((skill) => skill.ready)
              ? 'ready'
              : pluginStatus.skillhubSkills.some((skill) => skill.installed)
                ? 'warning'
                : 'optional',
            message:
              pluginStatus.skillhubSkills
                .filter((skill) => skill.installed)
                .map(
                  (skill) =>
                    `${skill.slug}${skill.ready ? ' 可执行' : ` 缺命令：${skill.missingCommands.join('、')}`}`,
                )
                .join('；') || '未安装 SkillHub 技能。',
          },
          {
            name: '插件运行',
            status: pluginStatus.runtimeApiAvailable ? 'ready' : 'optional',
            message: pluginStatus.runtimeApiAvailable
              ? 'Runtime API 在线，支持 commands、agents、hooks 执行。'
              : 'Runtime API 不可用，插件执行功能受限。',
          },
        ],
      },
      {
        key: 'memory-context',
        name: '记忆与上下文',
        status: memoryStatus.available ? 'ready' : 'optional',
        required: false,
        summary: memoryStatus.message,
        checkedAt: now,
        nextAction: memoryStatus.available
          ? '记忆系统已接入，支持消息历史和上下文管理。'
          : '当前按任务记录和操作证据保存上下文；需要长期记忆时再连接记忆服务。',
        checks: [
          {
            name: '消息历史',
            status:
              memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
                ? 'ready'
                : 'optional',
            message:
              memoryStatus.shortTermAvailable || memoryStatus.dailyAvailable
                ? `消息历史存储可用（${memoryStatus.shortTermAvailable ? '短期' : ''}${memoryStatus.shortTermAvailable && memoryStatus.dailyAvailable ? '+' : ''}${memoryStatus.dailyAvailable ? '日常' : ''}）。`
                : '消息历史存储不可用。',
          },
          {
            name: '上下文压缩',
            status: memoryStatus.longTermAvailable ? 'ready' : 'optional',
            message: memoryStatus.longTermAvailable
              ? '长期记忆和上下文压缩通过向量库支持。'
              : '向量库不可用，上下文压缩功能受限。',
          },
        ],
      },
      {
        key: 'sandbox-execution',
        name: '沙箱执行',
        status: sandboxStatus.available ? 'ready' : 'optional',
        required: false,
        summary: sandboxStatus.message,
        checkedAt: now,
        nextAction: sandboxStatus.available
          ? `沙箱类型：${sandboxStatus.sandboxType}，平台：${sandboxStatus.platform}。`
          : 'Docker 沙箱为后续或可选能力，小白安装包不要求用户安装 Docker。',
        checks: [
          {
            name: '平台适配',
            status: sandboxStatus.available ? 'ready' : 'optional',
            message: sandboxStatus.available
              ? `平台 ${sandboxStatus.platform}，沙箱类型 ${sandboxStatus.sandboxType}。`
              : '当前平台不支持沙箱执行。',
          },
          {
            name: '执行边界',
            status: sandboxStatus.available ? 'ready' : 'optional',
            message: sandboxStatus.available
              ? '命令、文件、路径操作的沙箱边界已通过 Docker/native 隔离。'
              : '等待沙箱运行时接入。',
          },
        ],
      },
      {
        key: 'evidence-replay',
        name: '证据链与回放',
        status: evidenceReplay.status,
        required: true,
        summary: evidenceReplay.summary,
        checkedAt: now,
        nextAction: evidenceReplay.nextAction,
        checks: evidenceReplay.checks,
      },
      {
        key: 'file-access',
        name: '文件访问',
        status: fileAccess.status === 'warning' ? 'blocked' : fileAccess.status,
        required: true,
        summary: fileAccess.summary,
        checkedAt: now,
        nextAction: fileAccess.nextAction,
        checks: fileAccess.checks.map((check) => ({
          ...check,
          status: check.status === 'warning' ? 'blocked' : check.status,
        })),
      },
      {
        key: 'permission-check',
        name: '权限检查',
        status: 'ready',
        required: true,
        summary:
          '已接入试用/商用边界、角色审批、白名单、禁止动作和误发误删保护字段。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '试用/商用权限',
            status: 'ready',
            message:
              '任务和 Agent 会话已返回 safetyBoundary、riskPolicy、requiredChecks。',
          },
          {
            name: '禁止动作',
            status: 'ready',
            message: '已配置禁止动作列表，高风险操作需要确认。',
          },
        ],
      },
    ];
  }

  private withCapabilityTimeout<T>(
    name: string,
    promise: Promise<T>,
    fallback: T,
    timeoutMs = 2000,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((resolveResult) => {
      timeout = setTimeout(() => {
        console.warn(
          `[LocalEngineHealth] ${name} check timed out after ${timeoutMs}ms`,
        );
        resolveResult(fallback);
      }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  }

  private async checkAutoUploadEngine() {
    // 2026-06-04: 5409 已下线；改查 playwright-mcp sidecar (in-process)
    if (!this.playwrightMcp) {
      return {
        ok: false,
        message: 'PlaywrightMcpService 未注入（无浏览器引擎可用）',
      };
    }
    try {
      const status = await this.playwrightMcp.getAutomationStatus();
      if (status.readyForAutomation) {
        return {
          ok: true,
          message: `in-process Chrome via playwright-mcp 已就绪 (pid=${status.pid ?? '?'}, ${status.endpoint}, tools=${status.toolCount ?? 0})`,
        };
      }
      return {
        ok: false,
        message: `playwright-mcp 未达到真实自动化标准：${status.message}${
          status.missingRequiredTools?.length
            ? `；缺少工具 ${status.missingRequiredTools.join(', ')}`
            : ''
        }`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return { ok: false, message: `playwright-mcp 状态检查失败：${message}` };
    }
  }

  private async checkInteractionCapabilities() {
    try {
      const status = await this.loadExecutorsStatus();
      const requiredExecutorIds =
        this.getRequiredInteractionExecutorIdsForCurrentHost();
      const unsupportedExecutorIds =
        this.getUnsupportedInteractionExecutorIdsForCurrentHost();
      const requiredExecutors = status.executors.filter((executor) =>
        requiredExecutorIds.includes(String(executor.key)),
      );
      const missingIds = requiredExecutorIds.filter(
        (id) => !requiredExecutors.some((executor) => executor.key === id),
      );
      const ready = requiredExecutors.filter(
        (executor) => executor.status === 'ready',
      ).length;
      const awaitingConfirmation = requiredExecutors.filter(
        (executor) => executor.status === 'preflight_only',
      ).length;
      const readyTaskNames = requiredExecutors
        .filter(
          (executor) =>
            executor.status === 'ready' || executor.status === 'preflight_only',
        )
        .map((executor) => String(executor.key))
        .join('、');
      const taskNames = requiredExecutors
        .map((executor) => String(executor.key))
        .join('、');
      const hasExecutors =
        requiredExecutors.length === requiredExecutorIds.length;
      const allReady = hasExecutors && ready === requiredExecutors.length;
      const allRunnable =
        hasExecutors &&
        requiredExecutors.every(
          (executor) =>
            executor.status === 'ready' || executor.status === 'preflight_only',
        );
      const unsupportedMessage = unsupportedExecutorIds.length
        ? `；${process.platform} 本机不把 ${unsupportedExecutorIds.join(
            '、',
          )} 算入必需范围，这些微信操作需要在支持的桌面系统单独验收`
        : '';

      return {
        status: allReady
          ? ('ready' as const)
          : allRunnable
            ? ('warning' as const)
            : ('blocked' as const),
        summary:
          requiredExecutors.length === 0
            ? '未发现客户互动执行能力。'
            : allRunnable
              ? `客户互动能力已接通：${ready} 项可直接运行，${awaitingConfirmation} 项需要先确认目标会话${unsupportedMessage}。`
              : `客户互动能力 ${ready}/${requiredExecutorIds.length} 项可用：${taskNames || '无'}${unsupportedMessage}。`,
        nextAction: allReady
          ? unsupportedExecutorIds.length
            ? '抖音、视频号互动能力已可用；桌面微信群发、加好友和朋友圈请在支持的桌面系统验收。'
            : '抖音、视频号和桌面微信互动执行器已注册并可调度。'
          : allRunnable
            ? '微信任务选择目标会话并完成发送前确认后即可执行，不需要安装其他组件。'
            : '部分客户互动能力不可用；请检查平台账号登录状态和本地执行服务。',
        checks: [
          {
            name: '客户互动能力',
            status: hasExecutors ? ('ready' as const) : ('blocked' as const),
            message: `${requiredExecutors.length}/${requiredExecutorIds.length} 项已接入：${taskNames || '无'}${missingIds.length ? `；缺少 ${missingIds.join('、')}` : ''}`,
          },
          {
            name: '就绪率',
            status: allReady
              ? ('ready' as const)
              : allRunnable
                ? ('warning' as const)
                : ('blocked' as const),
            message: `${ready}/${requiredExecutorIds.length} 项可直接运行，${awaitingConfirmation} 项等待目标确认：${readyTaskNames || '无'}`,
          },
          ...(unsupportedExecutorIds.length
            ? [
                {
                  name: '桌面微信写入能力',
                  status: 'warning' as const,
                  message: `${unsupportedExecutorIds.join(
                    '、',
                  )} 当前系统不支持真实操作，只保留执行前检查。`,
                },
              ]
            : []),
          {
            name: '执行路径',
            status: allRunnable ? ('ready' as const) : ('blocked' as const),
            message:
              process.platform === 'darwin'
                ? '浏览器平台使用本机浏览器；桌面微信使用 Mac 微信自动化与结果留存。'
                : process.platform === 'win32'
                  ? '浏览器平台使用本机浏览器；桌面微信使用 Windows 微信组件与结果留存。'
                  : '浏览器平台使用本机浏览器；桌面微信在当前系统仅做执行前检查。',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        status: 'blocked' as const,
        summary: `发布服务未返回互动能力清单：${message}`,
        nextAction: '请升级或重启 3011 本地 Runtime，并确认互动能力清单可用。',
        checks: [
          {
            name: '互动能力接口',
            status: 'blocked' as const,
            message,
          },
        ],
      };
    }
  }

  private async checkContentPublishingCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    if (!this.runtimeOrchestrator) {
      return {
        status: 'blocked',
        summary: 'RuntimeOrchestrator 未注入，无法读取内容发布执行器。',
        nextAction: '检查 RuntimeModule 与 LocalEngineModule 装配。',
        checks: [
          {
            name: '发布编排器',
            status: 'blocked',
            message: 'RuntimeOrchestrator 模块未连接。',
          },
        ],
      };
    }
    try {
      const healths = await this.runtimeOrchestrator.healthCheck();
      const publish = healths.find(
        (health) => health.id === 'platform-publish',
      );
      if (!publish) {
        return {
          status: 'blocked',
          summary: '未注册内容发布执行器。',
          nextAction: '检查 PlatformPublishService 是否注入 RuntimeModule。',
          checks: [
            {
              name: 'platform-publish',
              status: 'blocked',
              message: 'healthCheck 未返回 platform-publish。',
            },
          ],
        };
      }
      return {
        status: publish.ok ? 'ready' : 'blocked',
        summary: publish.ok
          ? '内容发布执行器已注册；发布能力单独验收，不计入客户互动四条链路。'
          : '内容发布执行器不可用。',
        nextAction: publish.ok
          ? '如需验收发布，请单独跑图文/视频发布读写流程。'
          : '检查 PlatformPublishService 健康详情和 3011 启动日志。',
        checks: [
          {
            name: 'platform-publish',
            status: publish.ok ? 'ready' : 'blocked',
            message:
              publish.details ||
              (publish.ok ? '发布执行器在线。' : '发布执行器离线。'),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        status: 'blocked',
        summary: `内容发布执行器检查失败：${message}`,
        nextAction: '请重启 3011 本地 Runtime 后重试。',
        checks: [
          {
            name: 'platform-publish',
            status: 'blocked',
            message,
          },
        ],
      };
    }
  }

  private async checkEvidenceReplayCapability(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    const runtimePaths = this.resolveLocalRuntimePaths();
    const evidenceDir = runtimePaths.evidence;
    const checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }> = [];

    try {
      await mkdir(evidenceDir, { recursive: true });
      const probePath = join(
        evidenceDir,
        `.kaypal-evidence-runcheck-${process.pid}-${Date.now()}.probe`,
      );
      await writeFile(probePath, 'ok', 'utf8');
      await rm(probePath, { force: true });
      checks.push({
        name: '证据目录',
        status: 'ready',
        message: `${evidenceDir} 可创建、写入和删除证据探针。`,
      });
    } catch (error) {
      checks.push({
        name: '证据目录',
        status: 'blocked',
        message: error instanceof Error ? error.message : '证据目录读写失败',
      });
    }

    try {
      const [taskCount, runtimeExecutionCount] = await Promise.all([
        this.prisma.interactionTask.count(),
        this.prisma.runtimeExecution.count(),
      ]);
      checks.push({
        name: '任务记录表',
        status: 'ready',
        message: `interaction_tasks 可读，当前 ${taskCount} 条。`,
      });
      checks.push({
        name: 'Runtime 执行记录表',
        status: 'ready',
        message: `runtime_executions 可读，当前 ${runtimeExecutionCount} 条。`,
      });
    } catch (error) {
      checks.push({
        name: '执行记录表',
        status: 'blocked',
        message:
          error instanceof Error ? error.message : '任务或执行记录表读取失败',
      });
    }

    const blocked = checks.some((check) => check.status === 'blocked');
    return {
      status: blocked ? 'blocked' : 'ready',
      summary: blocked
        ? '证据目录或执行记录表不可用，不能保证截图、页面回读和诊断导出落库。'
        : '证据目录、互动任务表和 Runtime 执行记录表检查通过。',
      nextAction: blocked
        ? '检查本地 evidence 目录权限、SQLite schema 和 Prisma 迁移。'
        : '',
      checks,
    };
  }

  private async checkAiReplyModelConfig(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    try {
      const textPurposes = ['article_creation', 'topic_selection'];
      const configs = await this.prisma.defaultModelConfig.findMany({
        where: { purpose: { in: textPurposes } },
      });
      const configuredModelIds = [
        ...new Set(configs.map((config) => config.modelId).filter(Boolean)),
      ];

      if (!configuredModelIds.length) {
        return this.withKaypalModelSyncHint({
          status: 'warning',
          summary:
            '未配置文章创作或精选选题默认模型；微信本机任务可继续，AI 生成类回复会使用规则兜底或在具体任务中提示配置。',
          nextAction:
            '到 3010 系统设置 → Kaypal 模型同步发起一次同步，把 Kaypal 模型台的默认模型拉过来。',
          checks: [
            {
              name: '默认文本模型',
              status: 'warning',
              message:
                'default_model_configs 缺少 article_creation/topic_selection。',
            },
          ],
        });
      }

      const models = await this.prisma.aIModel.findMany({
        where: { id: { in: configuredModelIds } },
        include: { platform: true },
      });
      const usableModels = models.filter(
        (model) =>
          model.enabled &&
          model.platform?.enabled &&
          Boolean(model.platform?.baseUrl?.trim()) &&
          Boolean(model.platform?.apiKey?.trim()),
      );
      const configuredPurposes = new Set(
        configs.map((config) => config.purpose),
      );
      const missingPurposes = textPurposes.filter(
        (purpose) => !configuredPurposes.has(purpose),
      );

      if (!usableModels.length) {
        return this.withKaypalModelSyncHint({
          status: 'warning',
          summary:
            '默认文本模型已填写，但模型不可用；微信本机任务可继续，AI 生成类动作会在具体任务中提示修复模型。',
          nextAction:
            '检查默认模型指向的 AI 模型、平台启用状态、Base URL 和 API Key；不要把规则兜底当作 AI 闭环通过。',
          checks: [
            {
              name: '默认文本模型',
              status: 'warning',
              message: configs
                .map((config) => `${config.purpose}:${config.modelId}`)
                .join('、'),
            },
            {
              name: '模型启用状态',
              status: 'warning',
              message: models.length
                ? models
                    .map(
                      (model) =>
                        `${model.name}: modelEnabled=${model.enabled}, platformEnabled=${model.platform?.enabled ?? false}`,
                    )
                    .join('、')
                : '默认模型 ID 没有匹配到 ai_models 记录。',
            },
          ],
        });
      }

      return {
        status: missingPurposes.length ? 'warning' : 'ready',
        summary: `已配置可用默认文本模型：${usableModels
          .map((model) => `${model.name}(${model.modelId})`)
          .join('、')}。`,
        nextAction: missingPurposes.length
          ? `建议补齐 ${missingPurposes.join('、')}，内容生产完整链路会用到。`
          : '',
        checks: [
          {
            name: '默认文本模型',
            status: 'ready',
            message: configs
              .map((config) => `${config.purpose}:${config.modelId}`)
              .join('、'),
          },
          {
            name: '模型启用状态',
            status: 'ready',
            message: usableModels
              .map((model) => `${model.name}/${model.platform.name}`)
              .join('、'),
          },
          {
            name: '完整用途覆盖',
            status: missingPurposes.length ? 'warning' : 'ready',
            message: missingPurposes.length
              ? `缺少 ${missingPurposes.join('、')}`
              : 'article_creation 与 topic_selection 均已配置。',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      const tableMissing =
        this.isPrismaTableMissingError(error, 'default_model_configs') ||
        this.isPrismaTableMissingError(error, 'ai_models') ||
        this.isPrismaTableMissingError(error, 'ai_platforms');
      return {
        status: tableMissing ? 'warning' : 'missing',
        summary: tableMissing
          ? `本机数据库缺少 AI 模型配置表；微信本机任务可继续，AI 生成类动作会在具体任务中提示配置。原始错误：${message}`
          : `无法读取 AI 默认模型配置：${message}`,
        nextAction: tableMissing
          ? '重启本机助手后会自动补齐 SQLite 表；随后到系统设置同步 Kaypal 模型。'
          : '检查 Prisma 数据库、ai_models、ai_platforms 和 default_model_configs 后重试。',
        checks: [
          {
            name: '默认模型配置读取',
            status: tableMissing ? 'warning' : 'missing',
            message,
          },
        ],
      };
    }
  }

  private async withKaypalModelSyncHint(result: {
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }) {
    if (!this.kaypalModelSync) {
      return {
        ...result,
        checks: [
          ...result.checks,
          {
            name: 'Kaypal 模型台同步',
            status:
              result.status === 'blocked'
                ? ('blocked' as const)
                : ('warning' as const),
            message: 'KaypalModelSyncService 未注入，不能读取模型台同步状态。',
          },
        ],
      };
    }

    return {
      ...result,
      checks: [
        ...result.checks,
        {
          name: 'Kaypal 模型台同步',
          status:
            result.status === 'blocked'
              ? ('blocked' as const)
              : ('warning' as const),
          message:
            '运行检查只读取 3010 本地默认模型配置，不主动请求 Kaypal 云端模型台；需要同步时请在系统设置里手动触发模型同步。',
        },
      ],
    };
  }

  private async checkFileAccess(): Promise<{
    status: LocalEngineCapabilityStatus;
    summary: string;
    nextAction?: string;
    checks: Array<{
      name: string;
      status: LocalEngineCapabilityStatus;
      message: string;
    }>;
  }> {
    const runtimePaths = this.resolveLocalRuntimePaths();
    const targets = [
      { name: '本机数据目录', path: runtimePaths.root },
      {
        name: '本机日志目录',
        path: runtimePaths.logs,
      },
      { name: '3011 本地 Runtime 目录', path: runtimePaths.root },
      { name: '发布素材目录', path: runtimePaths.materials },
      { name: '平台账号浏览器档案目录', path: runtimePaths.browserProfiles },
      { name: '互动证据目录', path: runtimePaths.evidence },
    ];
    const checks = await Promise.all(
      targets.map(async (target) => {
        try {
          await mkdir(target.path, { recursive: true });
          const probePath = join(
            target.path,
            `.kaypal-runcheck-${process.pid}-${Date.now()}.probe`,
          );
          await writeFile(probePath, 'ok', 'utf8');
          await rm(probePath, { force: true });
          await access(target.path, constants.R_OK | constants.W_OK);
          return {
            name: target.name,
            status: 'ready' as const,
            message: `${target.path} 可创建、可写入、可删除探针文件`,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误';
          return {
            name: target.name,
            status: 'blocked' as const,
            message: `${target.path} 读写探针失败：${message}`,
          };
        }
      }),
    );
    const hasWarning = checks.some((check) => check.status !== 'ready');

    return {
      status: hasWarning ? ('blocked' as const) : ('ready' as const),
      summary: hasWarning
        ? '部分本地目录不可读写，素材、账号状态或证据日志可能无法保存。'
        : '主系统目录、3011 Runtime 目录、素材目录和账号状态目录读写检查通过。',
      nextAction: hasWarning
        ? '请检查目录权限，必要时重新创建缺失目录。'
        : undefined,
      checks,
    };
  }

  private async readWechatDesktopStatus() {
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

  private buildDesktopStatus(
    desktop: Awaited<ReturnType<typeof this.readWechatDesktopStatus>>,
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
      (desktop as { fileSelectionAvailable?: boolean })
        .fileSelectionAvailable === true && available;
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
          status:
            fileSelectionOk && !fileSelectionBlocked ? 'ready' : 'blocked',
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

  private detectWechatSessionAnomalies(desktop: LocalEngineDesktopStatus) {
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
      loggedOut: /未登录|掉线|登录已失效|login expired|not logged/i.test(
        joined,
      ),
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

  private isDesktopWechatExecutionReady(desktop: LocalEngineDesktopStatus) {
    return (
      desktop.available &&
      desktop.blockers.length === 0 &&
      desktop.window.currentWindowLikelyWechatChat === true
    );
  }

  private isDesktopWechatRuntimeRunnable(desktop: LocalEngineDesktopStatus) {
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

  private hasWechatControlSurfaceEvidence(desktop: LocalEngineDesktopStatus) {
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

  private hasRunnableWechatWindowEvidence(desktop: LocalEngineDesktopStatus) {
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

  private summarizeDesktopWechatBlocker(desktop: LocalEngineDesktopStatus) {
    if (desktop.blockers.length > 0) {
      return desktop.blockers[0];
    }
    if (desktop.available && !desktop.window.currentWindowLikelyWechatChat) {
      const windowHint =
        desktop.warnings.find((warning) =>
          /检测到 \d+ 个微信窗口/.test(warning),
        ) ||
        desktop.permissionChecks.find((check) => check.key === 'window-list')
          ?.message;
      return windowHint
        ? `无法确认当前前台窗口是唯一微信目标会话。${windowHint}`
        : '无法确认当前前台窗口是唯一微信目标会话。';
    }
    return desktop.message;
  }

  private isWechatTargetLocked(currentWindowTitle?: string | null) {
    const targetContact = this.wechatSessionConfirmation.targetContact?.trim();
    if (!targetContact) return false;
    if (
      this.wechatSessionConfirmation.currentWindowConfirmed !== true ||
      this.wechatSessionConfirmation.contactConfirmed !== true ||
      this.wechatSessionConfirmation.draftBeforeFillConfirmed !== true
    ) {
      return false;
    }
    const lockedTitle =
      this.wechatSessionConfirmation.lockedWindowTitle?.trim();
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

  private buildDesktopCommercialPreflight(
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
    const windowEvidenceRunnable =
      this.hasRunnableWechatWindowEvidence(desktop);
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

  private normalizeWindowTitles(desktop: {
    windowTitles?: string[];
    currentWindowTitle?: string | null;
    windowTitle?: string | null;
  }) {
    const values = [
      ...(Array.isArray(desktop.windowTitles) ? desktop.windowTitles : []),
      desktop.currentWindowTitle,
      desktop.windowTitle,
    ];

    return [
      ...new Set(
        values.map((value) => value?.trim()).filter(Boolean) as string[],
      ),
    ];
  }

  private async captureDesktopScreenshot(
    label: string,
  ): Promise<LocalEngineDesktopScreenshotEvidence> {
    if (platform() !== 'darwin') {
      return {
        type: 'text',
        label,
        value: `当前系统 ${platform()} 不支持桌面截图。`,
        capturedAt: new Date().toISOString(),
      };
    }

    const evidenceDir = join(this.getProjectLogRoot(), 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    const capturedAt = new Date();
    const filename = `desktop-wechat-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
    const screenshotPath = join(evidenceDir, filename);
    const frame = await this.readWechatWindowFrame();
    if (!frame) {
      return {
        type: 'text',
        label,
        value: '未读取到可截图的桌面微信主窗口；已拒绝抓取全屏作为微信证据。',
        capturedAt: capturedAt.toISOString(),
        trusted: false,
        diagnostic: '未读取到桌面微信主窗口，不能把全屏截图当作微信会话证据。',
      };
    }
    if (frame.shareable === false) {
      return {
        type: 'text',
        label,
        value:
          '桌面微信主窗口当前禁止屏幕采集或内容不可见；已拒绝把下层窗口截图当作微信证据。',
        capturedAt: capturedAt.toISOString(),
        trusted: false,
        diagnostic:
          '桌面微信主窗口当前禁止屏幕采集或内容不可见，不能确认是真实微信会话窗口。',
      };
    }

    await this.runCommand(
      'screencapture',
      frame.windowId
        ? ['-x', '-l', String(frame.windowId), screenshotPath]
        : [
            '-x',
            '-R',
            `${frame.x},${frame.y},${frame.width},${frame.height}`,
            screenshotPath,
          ],
      3000,
    );
    const textSample = await this.readDesktopScreenshotText(screenshotPath);
    const diagnostic =
      textSample.trim().length === 0
        ? '当前微信窗口截图没有识别到可验证内容，不能确认是真实微信会话窗口。'
        : this.detectWechatScreenshotMismatch(textSample);
    return {
      type: 'screenshot',
      label,
      value: screenshotPath,
      capturedAt: capturedAt.toISOString(),
      trusted: diagnostic ? false : true,
      diagnostic: diagnostic || undefined,
      textSample: textSample || undefined,
    };
  }

  private async readWechatWindowFrame(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    if (platform() !== 'darwin') {
      return null;
    }
    const coreGraphicsFrame =
      await this.readWechatWindowFrameFromCoreGraphics();
    if (coreGraphicsFrame) {
      return coreGraphicsFrame;
    }
    return this.readWechatWindowFrameFromAccessibility();
  }

  private async readWechatWindowFrameFromAccessibility(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    const script = [
      'tell application "System Events"',
      'tell process "微信"',
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
      'set windowSizeValue to size of appWindow',
      'end try',
      'if (item 1 of windowSizeValue) > 200 and (item 2 of windowSizeValue) > 200 and (windowNameText is "微信" or windowDescriptionText is "标准窗口") then',
      'return (item 1 of windowPositionValue as text) & "," & (item 2 of windowPositionValue as text) & "," & (item 1 of windowSizeValue as text) & "," & (item 2 of windowSizeValue as text)',
      'end if',
      'end repeat',
      'end tell',
      'end tell',
      'return ""',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: 3000,
        maxBuffer: 1024 * 1024,
      });
      const values = String(stdout || '')
        .trim()
        .split(',')
        .map((value) => Number.parseInt(value, 10));
      if (
        values.length !== 4 ||
        values.some((value) => Number.isNaN(value) || value < 0)
      ) {
        return null;
      }
      const [x, y, width, height] = values;
      const windowInfo = await this.readWechatWindowCaptureInfo({
        x,
        y,
        width,
        height,
      });
      return {
        x,
        y,
        width,
        height,
        windowId: windowInfo?.windowId,
        shareable: windowInfo?.shareable,
      };
    } catch {
      return null;
    }
  }

  private async readWechatWindowFrameFromCoreGraphics(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
    windowId?: number;
    shareable?: boolean;
  } | null> {
    const swiftSource = [
      'import Foundation',
      'import CoreGraphics',
      'struct Candidate { let title: String; let owner: String; let id: Int; let x: Int; let y: Int; let width: Int; let height: Int; let shareable: Bool? }',
      'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
      'var candidates = [Candidate]()',
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
      '  let id = window[kCGWindowNumber as String] as? Int ?? 0',
      '  guard id > 0 else { continue }',
      '  let sharing = window[kCGWindowSharingState as String] as? Int ?? -1',
      '  let shareable: Bool? = sharing < 0 ? nil : sharing > 0',
      '  candidates.append(Candidate(title: title, owner: owner, id: id, x: x, y: y, width: width, height: height, shareable: shareable))',
      '}',
      'func rank(_ item: Candidate) -> Int {',
      '  let title = item.title.isEmpty ? item.owner : item.title',
      '  if item.title == "微信 (窗口)" || item.title == "微信" || item.title == "WeChat" { return 4 }',
      '  if item.title.contains("朋友圈") { return 3 }',
      '  if item.title.isEmpty { return 1 }',
      '  return 1',
      '}',
      'if let best = candidates.sorted(by: {',
      '  let leftRank = rank($0)',
      '  let rightRank = rank($1)',
      '  if leftRank != rightRank { return leftRank > rightRank }',
      '  let leftShareable = ($0.shareable ?? true) ? 1 : 0',
      '  let rightShareable = ($1.shareable ?? true) ? 1 : 0',
      '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
      '  return ($0.width * $0.height) > ($1.width * $1.height)',
      '}).first {',
      '  print([String(best.x), String(best.y), String(best.width), String(best.height), String(best.id), best.shareable == false ? "blocked" : "shareable"].joined(separator: ","))',
      '}',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync('swift', ['-e', swiftSource], {
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      const [xRaw, yRaw, widthRaw, heightRaw, idRaw, stateRaw] = String(
        stdout || '',
      )
        .trim()
        .split(',');
      const values = [xRaw, yRaw, widthRaw, heightRaw].map((value) =>
        Number.parseInt(value || '', 10),
      );
      if (
        values.length !== 4 ||
        values.some((value) => Number.isNaN(value) || value < 0)
      ) {
        return null;
      }
      const windowId = Number.parseInt(idRaw || '', 10);
      return {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
        windowId:
          Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
        shareable:
          stateRaw?.trim() === 'blocked'
            ? false
            : stateRaw?.trim() === 'shareable'
              ? true
              : undefined,
      };
    } catch {
      return null;
    }
  }

  private async readWechatWindowCaptureInfo(frame: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<{ windowId?: number; shareable?: boolean } | null> {
    const swiftSource = [
      'import Foundation',
      'import CoreGraphics',
      'let args = CommandLine.arguments',
      'guard args.count >= 5,',
      '  let expectedX = Int(args[1]),',
      '  let expectedY = Int(args[2]),',
      '  let expectedWidth = Int(args[3]),',
      '  let expectedHeight = Int(args[4]) else { exit(2) }',
      'struct Candidate { let title: String; let owner: String; let id: Int; let sharing: Int?; let area: Int }',
      'let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []',
      'var candidates = [Candidate]()',
      'for window in windows {',
      '  let owner = window[kCGWindowOwnerName as String] as? String ?? ""',
      '  let name = window[kCGWindowName as String] as? String ?? ""',
      '  guard owner.contains("微信") || owner.contains("WeChat") || name.contains("微信") || name.contains("WeChat") else { continue }',
      '  guard let bounds = window[kCGWindowBounds as String] as? [String: Any] else { continue }',
      '  let x = Int(bounds["X"] as? Double ?? Double(bounds["X"] as? Int ?? -1))',
      '  let y = Int(bounds["Y"] as? Double ?? Double(bounds["Y"] as? Int ?? -1))',
      '  let width = Int(bounds["Width"] as? Double ?? Double(bounds["Width"] as? Int ?? -1))',
      '  let height = Int(bounds["Height"] as? Double ?? Double(bounds["Height"] as? Int ?? -1))',
      '  guard abs(x - expectedX) <= 2, abs(y - expectedY) <= 2, abs(width - expectedWidth) <= 2, abs(height - expectedHeight) <= 2 else { continue }',
      '  let windowId = window[kCGWindowNumber as String] as? Int ?? 0',
      '  guard windowId > 0 else { continue }',
      '  let sharingState = window[kCGWindowSharingState as String] as? Int',
      '  candidates.append(Candidate(title: name, owner: owner, id: windowId, sharing: sharingState, area: width * height))',
      '}',
      'func rank(_ item: Candidate) -> Int {',
      '  let title = item.title.isEmpty ? item.owner : item.title',
      '  if title == "微信 (窗口)" || title == "微信" || title == "WeChat" { return 4 }',
      '  if item.title.isEmpty { return 1 }',
      '  if title.contains("微信") || title.contains("WeChat") { return 2 }',
      '  return 0',
      '}',
      'if let best = candidates.sorted(by: {',
      '  let leftRank = rank($0)',
      '  let rightRank = rank($1)',
      '  if leftRank != rightRank { return leftRank > rightRank }',
      '  let leftShareable = ($0.sharing ?? 1) > 0 ? 1 : 0',
      '  let rightShareable = ($1.sharing ?? 1) > 0 ? 1 : 0',
      '  if leftShareable != rightShareable { return leftShareable > rightShareable }',
      '  return $0.area > $1.area',
      '}).first {',
      '  let state = best.sharing == nil ? "unknown" : ((best.sharing ?? 0) > 0 ? "shareable" : "blocked")',
      '  print("\\(best.id),\\(state)")',
      '} else {',
      '  print("0,unknown")',
      '}',
    ].join('\n');
    try {
      const { stdout } = await execFileAsync(
        'swift',
        [
          '-e',
          swiftSource,
          String(frame.x),
          String(frame.y),
          String(frame.width),
          String(frame.height),
        ],
        {
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        },
      );
      const [idRaw, stateRaw] = String(stdout || '')
        .trim()
        .split(',');
      const windowId = Number.parseInt(idRaw || '', 10);
      const state = stateRaw?.trim();
      return {
        windowId:
          Number.isFinite(windowId) && windowId > 0 ? windowId : undefined,
        shareable:
          state === 'blocked'
            ? false
            : state === 'shareable'
              ? true
              : undefined,
      };
    } catch {
      return null;
    }
  }

  private async readDesktopScreenshotText(imagePath: string): Promise<string> {
    if (!imagePath || !existsSync(imagePath) || platform() !== 'darwin') {
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
    try {
      const { stdout } = await execFileAsync(
        'swift',
        ['-e', swiftSource, imagePath],
        {
          timeout: 15000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      return String(stdout || '')
        .trim()
        .slice(0, 1200);
    } catch {
      return '';
    }
  }

  private detectWechatScreenshotMismatch(textSample: string): string | null {
    const normalized = textSample.replace(/\s+/g, '');
    if (!normalized) {
      return null;
    }
    const browserMarkers = [
      'codex.maynor1024.live',
      'test.kaypal.cn/api/desktop-auth/authorize',
      'desktop-auth/authorize',
      '已允许连接',
      '可以回到KaypalDesktop',
      'KaypalDesktop',
      'Kaypal内容工作台',
      '豆包',
      '扣子空间',
      'DeepSeek',
      'MiniMax',
      'nuwax-ai',
      '我的订阅',
      'API密钥',
      'API-Red',
      '使用记录',
      '渠道状态',
      'OpenAI',
      'Chrome',
      '所有书签',
      '微信公众平台',
      'localhost:3010',
      '127.0.0.1:3010',
    ];
    const decisiveBrowserMarkers = [
      'codex.maynor1024.live',
      'test.kaypal.cn/api/desktop-auth/authorize',
      'desktop-auth/authorize',
      '已允许连接',
      '可以回到KaypalDesktop',
      'KaypalDesktop',
      'Kaypal内容工作台',
    ];
    const strongWechatMarkers = [
      '文件传输助手',
      '通讯录',
      '朋友圈',
      '聊天信息',
      '订阅号',
      '服务号',
      '群聊',
      '发送',
      '语音输入',
      '表情',
    ];
    const looksLikeBrowser = browserMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    const hasDecisiveBrowserMarker = decisiveBrowserMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    const looksLikeWechat = strongWechatMarkers.some((marker) =>
      normalized.includes(marker.replace(/\s+/g, '')),
    );
    if (looksLikeBrowser && (hasDecisiveBrowserMarker || !looksLikeWechat)) {
      if (normalized.includes('codex.maynor1024.live')) {
        return '当前截图识别到浏览器订阅页内容，不是可验证的微信会话窗口。';
      }
      if (
        normalized.includes('desktop-auth/authorize') ||
        normalized.includes('已允许连接') ||
        normalized.includes('可以回到KaypalDesktop')
      ) {
        return '当前截图识别到 Kaypal 授权页内容，不是可验证的微信会话窗口。';
      }
      return '当前截图识别到浏览器页面内容，不是可验证的微信会话窗口。';
    }
    return null;
  }

  private hasTrustedWechatAlignmentLock() {
    const alignment = this.wechatSessionConfirmation.alignment;
    return (
      alignment?.ok === true &&
      this.wechatSessionConfirmation.currentWindowConfirmed === true &&
      this.wechatSessionConfirmation.contactConfirmed === true &&
      this.wechatSessionConfirmation.draftBeforeFillConfirmed === true &&
      this.wechatSessionConfirmation.contactAmbiguityResolved === true &&
      Boolean(this.wechatSessionConfirmation.targetContact?.trim()) &&
      Boolean(
        alignment.pageTextSample?.trim() || alignment.screenshotPath?.trim(),
      )
    );
  }

  private isWechatScreenshotSoftDiagnostic(diagnostic?: string | null) {
    const value = String(diagnostic || '');
    if (!value.trim()) return false;
    return (
      /没有识别到可验证内容|OCR|文字/.test(value) &&
      !/浏览器|授权页|登录|二维码|文件传输助手|下层窗口|不可见/.test(value)
    );
  }

  private detectWechatScreenshotSessionBlocker(
    textSample?: string | null,
  ): string | null {
    const normalized = String(textSample || '').replace(/\s+/g, '');
    if (!normalized) {
      return null;
    }
    if (
      normalized.includes('微信文件传输助手网页版') ||
      (normalized.includes('文件传输助手') &&
        (normalized.includes('网页版') || normalized.includes('二维码')))
    ) {
      return '当前是微信文件传输助手网页版二维码，不是桌面微信聊天会话。';
    }
    if (
      normalized.includes('进入微信') ||
      normalized.includes('切换账号') ||
      normalized.includes('仅传输文件')
    ) {
      return '当前停在微信登录/选择账号页，不是桌面微信聊天会话。';
    }
    if (
      normalized.includes('扫码登录') ||
      normalized.includes('请使用微信扫描二维码') ||
      normalized.includes('二维码登录')
    ) {
      return '当前停在扫码登录页，不是桌面微信聊天会话。';
    }
    return null;
  }

  private runCommand(command: string, args: string[], timeoutMs: number) {
    return new Promise<void>((resolveResult, rejectResult) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        rejectResult(new Error(`${command} 执行超时`));
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectResult(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolveResult();
          return;
        }
        rejectResult(new Error(`${command} 退出码 ${code}`));
      });
    });
  }

  private rememberDesktopEvidence(
    evidence?: LocalEngineDesktopScreenshotEvidence,
  ) {
    if (!evidence) {
      return;
    }
    this.desktopEvidence.push(evidence);
    if (this.desktopEvidence.length > 30) {
      this.desktopEvidence.splice(0, this.desktopEvidence.length - 30);
    }
  }

  private resolveLocalRuntimePaths() {
    const root = process.env.KAYPAL_RUNTIME_STATE_ROOT?.trim()
      ? resolveRuntimeStateRoot()
      : this.getProjectRoot();
    const paths = {
      root,
      materials:
        this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
        join(root, 'data', 'materials'),
      cookies:
        this.configService.get<string>('AUTO_UPLOAD_COOKIES_DIR') ||
        join(root, 'data', 'cookiesFile'),
      browserProfiles:
        this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
        resolveProjectDataPath('browser-profiles'),
      evidence:
        this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
        join(this.getProjectLogRoot(), 'browser-evidence'),
      avatars:
        this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
        join(root, 'data', 'avatars'),
      logs: this.getProjectLogRoot(),
    };
    for (const path of [
      paths.materials,
      paths.cookies,
      paths.browserProfiles,
      paths.evidence,
      paths.avatars,
      paths.logs,
    ]) {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    }
    return paths;
  }

  private async inspectPath(target: {
    key: string;
    name: string;
    path: string;
    note?: string;
  }): Promise<LocalEngineFileAccessItem> {
    let pathStat: Awaited<ReturnType<typeof stat>> | null = null;
    let readable = false;
    let writable = false;

    try {
      pathStat = await stat(target.path);
    } catch {
      return {
        key: target.key,
        name: target.name,
        path: target.path,
        exists: false,
        readable: false,
        writable: false,
        kind: 'missing',
        note: target.note,
        recentFiles: [],
      };
    }

    try {
      await access(target.path, constants.R_OK);
      readable = true;
    } catch {
      readable = false;
    }

    try {
      await access(target.path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    const kind = pathStat.isDirectory()
      ? 'directory'
      : pathStat.isFile()
        ? 'file'
        : 'unknown';
    const item: LocalEngineFileAccessItem = {
      key: target.key,
      name: target.name,
      path: target.path,
      exists: true,
      readable,
      writable,
      kind,
      sizeBytes: pathStat.isFile() ? pathStat.size : undefined,
      updatedAt: pathStat.mtime.toISOString(),
      note: target.note,
      recentFiles: [],
    };

    if (pathStat.isDirectory() && readable) {
      try {
        const entries = await readdir(target.path, { withFileTypes: true });
        item.fileCount = entries.filter((entry) => entry.isFile()).length;
        item.directoryCount = entries.filter((entry) =>
          entry.isDirectory(),
        ).length;
        const recentEntries = await Promise.all(
          entries
            .filter((entry) => !entry.name.startsWith('.'))
            .slice(0, 80)
            .map(async (entry) => {
              const entryPath = join(target.path, entry.name);
              try {
                const entryStat = await stat(entryPath);
                return {
                  name: entry.name,
                  path: entryPath,
                  kind: entry.isDirectory()
                    ? ('directory' as const)
                    : entry.isFile()
                      ? ('file' as const)
                      : ('unknown' as const),
                  sizeBytes: entryStat.isFile() ? entryStat.size : undefined,
                  updatedAt: entryStat.mtime.toISOString(),
                };
              } catch {
                return {
                  name: entry.name,
                  path: entryPath,
                  kind: 'unknown' as const,
                  updatedAt: null,
                };
              }
            }),
        );
        item.recentFiles = recentEntries
          .sort((left, right) =>
            (right.updatedAt || '').localeCompare(left.updatedAt || ''),
          )
          .slice(0, 5);
      } catch {
        item.recentFiles = [];
      }
    }

    return item;
  }

  private checkDesktopControl() {
    const currentPlatform = platform();

    if (currentPlatform === 'darwin') {
      return this.checkMacOSDesktopControl();
    } else if (currentPlatform === 'win32') {
      return this.checkWindowsDesktopControl();
    } else if (currentPlatform === 'linux') {
      return this.checkLinuxDesktopControl();
    }

    return {
      status: 'warning' as const,
      summary: `当前系统 ${currentPlatform} 暂不支持桌面控制。`,
      nextAction: '桌面控制目前仅支持 macOS、Windows 和 Linux 系统。',
      checks: [
        {
          name: '操作系统',
          status: 'warning' as const,
          message: `当前系统：${currentPlatform}，不在支持列表中。`,
        },
      ],
    };
  }

  private checkMacOSDesktopControl() {
    const hasAccessibility = this.checkMacOSAccessibility();
    const hasScreenRecording = this.checkMacOSScreenRecording();
    const allPermissionsGranted = hasAccessibility && hasScreenRecording;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'macOS 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 macOS 环境，需要用户授予辅助功能和屏幕录制权限。',
      nextAction: allPermissionsGranted
        ? ''
        : '请在 macOS 系统设置 > 隐私与安全性 中授予"辅助功能"和"屏幕录制"权限，然后刷新此页面。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'macOS，可接入桌面控制。',
        },
        {
          name: '辅助功能权限',
          status: hasAccessibility ? 'ready' : 'warning',
          message: hasAccessibility
            ? '辅助功能权限已授予。'
            : '请在 系统设置 > 隐私与安全性 > 辅助功能 中勾选本应用。',
        },
        {
          name: '屏幕录制权限',
          status: hasScreenRecording ? 'ready' : 'warning',
          message: hasScreenRecording
            ? '屏幕录制权限已授予。'
            : '请在 系统设置 > 隐私与安全性 > 屏幕录制 中勾选本应用。',
        },
      ],
    };
  }

  private checkWindowsDesktopControl() {
    const hasUIAutomation = this.checkWindowsUIAutomation();
    const hasScreenCapture = this.checkWindowsScreenCapture();
    const allPermissionsGranted = hasUIAutomation && hasScreenCapture;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'Windows 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 Windows 环境，需要检查 UI Automation 和屏幕捕获权限。',
      nextAction: allPermissionsGranted
        ? ''
        : '请确保以管理员身份运行本应用，并在 Windows 安全中心允许屏幕捕获。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'Windows，可接入桌面控制。',
        },
        {
          name: 'UI Automation',
          status: hasUIAutomation ? 'ready' : 'warning',
          message: hasUIAutomation
            ? 'UI Automation 接口可用。'
            : '请确保以管理员身份运行本应用，以启用 UI Automation 接口。',
        },
        {
          name: '屏幕捕获',
          status: hasScreenCapture ? 'ready' : 'warning',
          message: hasScreenCapture
            ? '屏幕捕获权限已授予。'
            : '请在 Windows 安全中心 > 隐私 > 屏幕捕获 中允许本应用。',
        },
      ],
    };
  }

  private checkLinuxDesktopControl() {
    const hasX11 = this.checkLinuxX11();
    const hasXdotool = this.checkLinuxXdotool();
    const allPermissionsGranted = hasX11 && hasXdotool;

    return {
      status: allPermissionsGranted ? 'ready' : 'warning',
      summary: allPermissionsGranted
        ? 'Linux 桌面控制权限已授予，可以执行桌面自动化任务。'
        : '已识别 Linux 环境，需要检查 X11/Wayland 和 xdotool 工具。',
      nextAction: allPermissionsGranted
        ? ''
        : '请确保已安装 xdotool（sudo apt install xdotool）并在 X11 会话中运行。',
      checks: [
        {
          name: '操作系统',
          status: 'ready' as const,
          message: 'Linux，可接入桌面控制。',
        },
        {
          name: 'X11/Wayland',
          status: hasX11 ? 'ready' : 'warning',
          message: hasX11
            ? 'X11 显示服务器可用。'
            : '请确保在 X11 会话中运行（Wayland 支持有限）。',
        },
        {
          name: 'xdotool 工具',
          status: hasXdotool ? 'ready' : 'warning',
          message: hasXdotool
            ? 'xdotool 已安装。'
            : '请安装 xdotool：sudo apt install xdotool',
        },
      ],
    };
  }

  private checkMacOSAccessibility(): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync('tccutil list | grep -i accessibility', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return result.includes('kTCCServiceAccessibility');
    } catch {
      return false;
    }
  }

  private checkMacOSScreenRecording(): boolean {
    try {
      const { execSync } = require('child_process');
      const result = execSync('tccutil list | grep -i screen', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return result.includes('kTCCServiceScreenCapture');
    } catch {
      return false;
    }
  }

  private checkWindowsUIAutomation(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(
        'powershell -Command "Add-Type -AssemblyName UIAutomationClient"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
      );
      return true;
    } catch {
      return false;
    }
  }

  private checkWindowsScreenCapture(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(
        'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen"',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 800 },
      );
      return true;
    } catch {
      return false;
    }
  }

  private checkLinuxX11(): boolean {
    try {
      const { execSync } = require('child_process');
      const display = process.env.DISPLAY;
      if (!display) return false;
      execSync('xdpyinfo', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return true;
    } catch {
      return false;
    }
  }

  private checkLinuxXdotool(): boolean {
    try {
      const { execSync } = require('child_process');
      execSync('which xdotool', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 800,
      });
      return true;
    } catch {
      return false;
    }
  }

  private createDefaultReplyRule(): InteractionReplyRuleConfig {
    return {
      configVersion: 1,
      revision: 1,
      industryName: '本地生活/电商服务',
      tone: 'warm',
      defaultSendMode: 'auto-send',
      askForContact: true,
      commentParsingMode: 'none',
      commentRulePreset: 'loose',
      commentRequireActionAndTime: false,
      commentAllowShortText: true,
      commentSkipHandled: false,
      commentQuestionOnly: false,
      commentMinLength: 1,
      commentMaxLength: 500,
      commentWhitelistKeywords: [],
      commentExcludeAuthorKeywords: ['作者', '商家', '客服', '施主聒噪 作者'],
      commentNoiseKeywords: [
        '发布作品',
        '作品管理',
        '评论管理',
        '互动管理',
        '数据中心',
        '回复',
        '删除',
        '加载中',
        '暂无',
      ],
      commentPriorityKeywords: [
        '价格',
        '多少',
        '怎么',
        '哪里',
        '联系',
        '电话',
        '微信',
        '私信',
        '预约',
        '吗',
        '呢',
      ],
      fallbackEnabled: true,
      fallbackReplies: [
        '你把具体内容发我，我按实际情况帮你看。',
        '可以，你说下具体款式、订单或时间，我帮你核一下。',
        '这个要看具体情况，你把截图或问题发我，我按实际内容回复你。',
      ],
      allowFallbackAutoSend: true,
      requireApprovalKeywords: [
        '投诉',
        '退款',
        '售后',
        '差评',
        '发票',
        '转账',
        '支付',
        '维权',
      ],
      blockedKeywords: ['保证治好', '最低价', '绝对有效', '返现', '私下转账'],
      serviceHighlights: [
        '按客户具体问题回复',
        '不编造价格和承诺',
        '必要时转人工核实',
      ],
      closingText: '你把具体款式、订单或时间发我，我按实际情况帮你看。',
      botName: '销售顾问机器人',
      botType: 'sales',
      authorizedAccounts: ['抖音门店号', '微信客服号'],
      replyDelay: '20-45 秒',
      whitelist: ['老客户', '高意向客户', '售后客户'],
      noReplyScenarios: ['投诉', '退款', '发票', '私下转账', '平台违规词'],
      fileRequestPolicy: '客户要求文件、合同、报价单时先转人工确认。',
      contactScope: 'all',
      knowledgeScope: 'local',
      selectedKnowledgeId: '',
      updatedAt: new Date().toISOString(),
    };
  }

  private toCustomerServiceReplyBot(
    row: InteractionReplyRule,
  ): CustomerServiceReplyBot {
    const configVersion =
      Number.isInteger(row.configVersion) && row.configVersion > 0
        ? row.configVersion
        : 1;
    const revision =
      Number.isInteger(row.revision) && row.revision > 0 ? row.revision : 1;
    const base = {
      ...this.createDefaultReplyRule(),
      configVersion,
      revision,
    };
    const stored =
      (row.ruleJson as UpdateInteractionReplyRuleInput | undefined) ||
      (row.escalationRules as UpdateInteractionReplyRuleInput | undefined) ||
      {};
    const config = this.normalizeCustomerServiceRule(stored, base);
    const name =
      this.optionalTrimmedText(row.name) || config.botName || '客服机器人';
    const createdAt = row.createdAt.toISOString();
    const updatedAt = row.updatedAt.toISOString();
    return {
      id: String(row.id),
      name,
      enabled: row.enabled !== false,
      configVersion,
      revision,
      createdAt,
      updatedAt,
      config: {
        ...config,
        botName: name,
        configVersion,
        revision,
        updatedAt,
      },
    };
  }

  private normalizeCustomerServiceRule(
    input: UpdateInteractionReplyRuleInput,
    base: InteractionReplyRuleConfig,
  ): InteractionReplyRuleConfig {
    const configInput = { ...input };
    delete configInput.expectedRevision;
    const next = { ...base, ...configInput };
    return {
      ...next,
      configVersion: base.configVersion,
      revision: base.revision,
      botName: this.optionalTrimmedText(input.botName) || base.botName,
      botType:
        input.botType === 'advisor'
          ? 'advisor'
          : input.botType === 'sales'
            ? 'sales'
            : base.botType,
      authorizedAccounts: this.normalizeStringList(
        input.authorizedAccounts,
        base.authorizedAccounts || [],
      ),
      replyDelay: this.optionalTrimmedText(input.replyDelay) || base.replyDelay,
      whitelist: this.normalizeStringList(
        input.whitelist,
        base.whitelist || [],
      ),
      noReplyScenarios: this.normalizeStringList(
        input.noReplyScenarios,
        base.noReplyScenarios || [],
      ),
      fileRequestPolicy:
        this.optionalTrimmedText(input.fileRequestPolicy) ||
        base.fileRequestPolicy,
      contactScope:
        input.contactScope === 'wechat' ||
        input.contactScope === 'douyin' ||
        input.contactScope === 'all'
          ? input.contactScope
          : base.contactScope,
      knowledgeScope:
        input.knowledgeScope === 'selected' ||
        input.knowledgeScope === 'none' ||
        input.knowledgeScope === 'local'
          ? input.knowledgeScope
          : base.knowledgeScope,
      selectedKnowledgeId:
        input.knowledgeScope === 'none'
          ? ''
          : this.optionalTrimmedText(input.selectedKnowledgeId) ||
            base.selectedKnowledgeId ||
            '',
      industryName:
        this.optionalTrimmedText(input.industryName) || base.industryName,
      tone: this.isRuleTone(input.tone) ? input.tone : base.tone,
      defaultSendMode: this.isSendMode(input.defaultSendMode)
        ? input.defaultSendMode
        : base.defaultSendMode,
      askForContact:
        typeof input.askForContact === 'boolean'
          ? input.askForContact
          : base.askForContact,
      commentParsingMode:
        input.commentParsingMode === 'none' ? 'none' : base.commentParsingMode,
      commentRulePreset:
        input.commentRulePreset === 'loose' ? 'loose' : base.commentRulePreset,
      commentRequireActionAndTime:
        typeof input.commentRequireActionAndTime === 'boolean'
          ? input.commentRequireActionAndTime
          : base.commentRequireActionAndTime,
      commentAllowShortText:
        typeof input.commentAllowShortText === 'boolean'
          ? input.commentAllowShortText
          : base.commentAllowShortText,
      commentSkipHandled:
        typeof input.commentSkipHandled === 'boolean'
          ? input.commentSkipHandled
          : base.commentSkipHandled,
      commentQuestionOnly:
        typeof input.commentQuestionOnly === 'boolean'
          ? input.commentQuestionOnly
          : base.commentQuestionOnly,
      commentMinLength: this.normalizeRuleNumber(
        input.commentMinLength,
        base.commentMinLength,
        1,
        80,
      ),
      commentMaxLength: this.normalizeRuleNumber(
        input.commentMaxLength,
        base.commentMaxLength,
        10,
        500,
      ),
      commentWhitelistKeywords: this.normalizeEditableStringList(
        input.commentWhitelistKeywords,
        base.commentWhitelistKeywords,
      ),
      commentExcludeAuthorKeywords: this.normalizeEditableStringList(
        input.commentExcludeAuthorKeywords,
        base.commentExcludeAuthorKeywords,
      ),
      commentNoiseKeywords: this.normalizeEditableStringList(
        input.commentNoiseKeywords,
        base.commentNoiseKeywords,
      ),
      commentPriorityKeywords: this.normalizeEditableStringList(
        input.commentPriorityKeywords,
        base.commentPriorityKeywords,
      ),
      fallbackEnabled:
        typeof input.fallbackEnabled === 'boolean'
          ? input.fallbackEnabled
          : base.fallbackEnabled,
      fallbackReplies: this.normalizeEditableStringList(
        input.fallbackReplies,
        base.fallbackReplies,
      ),
      allowFallbackAutoSend:
        typeof input.allowFallbackAutoSend === 'boolean'
          ? input.allowFallbackAutoSend
          : base.allowFallbackAutoSend,
      requireApprovalKeywords: this.normalizeStringList(
        input.requireApprovalKeywords,
        base.requireApprovalKeywords,
      ),
      blockedKeywords: this.normalizeStringList(
        input.blockedKeywords,
        base.blockedKeywords,
      ),
      serviceHighlights: this.normalizeStringList(
        input.serviceHighlights,
        base.serviceHighlights,
      ),
      closingText:
        this.optionalTrimmedText(input.closingText) || base.closingText,
      updatedAt: new Date().toISOString(),
    };
  }

  private async resolveCustomerServiceKnowledge(
    rule: InteractionReplyRuleConfig,
  ): Promise<CustomerServiceKnowledgeContext> {
    const scope = rule.knowledgeScope || 'local';
    if (scope === 'none') {
      return { scope, available: true };
    }
    if (scope === 'local') {
      return { scope, available: true };
    }
    const selectedKnowledgeId = this.optionalTrimmedText(
      rule.selectedKnowledgeId,
    );
    if (!selectedKnowledgeId) {
      return { scope, available: false };
    }
    const material = await this.prisma.material.findFirst({
      where: { id: selectedKnowledgeId, platform: 'LocalKnowledge' },
      select: { id: true, title: true, content: true, summary: true },
    });
    if (!material) {
      return { scope, selectedKnowledgeId, available: false };
    }
    return {
      scope,
      selectedKnowledgeId: material.id,
      selectedKnowledgeTitle: material.title,
      content: String(material.content || material.summary || '')
        .trim()
        .slice(0, 5000),
      available: true,
    };
  }

  private evaluateCustomerServiceReplyDecision(
    rule: InteractionReplyRuleConfig,
    input: {
      sourceText: string;
      replyText?: string;
      targetName?: string;
      accountName?: string;
      platform?: CustomerServiceReplyPlatform;
      contactLabels?: string[];
      requestedSendMode?: InteractionSendMode;
      commercialExecutionAllowed: boolean;
      knowledge: CustomerServiceKnowledgeContext;
      now?: Date;
    },
  ): CustomerServiceReplyDecision {
    const sourceText = this.optionalTrimmedText(input.sourceText) || '';
    const replyText = this.optionalTrimmedText(input.replyText) || '';
    const accountName = this.optionalTrimmedText(input.accountName) || '';
    const targetName = this.optionalTrimmedText(input.targetName) || '';
    const platform =
      input.platform ||
      (/微信|wechat/i.test(accountName)
        ? 'wechat'
        : /抖音|douyin|字节|tiktok|视频号/i.test(accountName)
          ? 'douyin'
          : undefined);
    const authorizedAccounts = this.normalizeStringList(
      rule.authorizedAccounts,
      [],
    );
    const accountBound =
      authorizedAccounts.length === 0 ||
      authorizedAccounts.some(
        (account) => account.toLowerCase() === accountName.toLowerCase(),
      );
    const scopeMatched =
      rule.contactScope === 'all' ||
      !rule.contactScope ||
      rule.contactScope === platform;
    const contactText = [
      targetName,
      ...this.normalizeStringList(input.contactLabels, []),
    ]
      .join('\n')
      .toLowerCase();
    const whitelist = this.normalizeStringList(rule.whitelist, []);
    const whitelistHits = whitelist.filter((item) =>
      contactText.includes(item.toLowerCase()),
    );
    const whitelisted = whitelist.length === 0 || whitelistHits.length > 0;
    const content = `${sourceText}\n${replyText}`;
    const noReplyHits = this.matchCustomerServiceTerms(
      rule.noReplyScenarios,
      sourceText,
    );
    const approvalHits = this.matchCustomerServiceTerms(
      rule.requireApprovalKeywords,
      content,
    );
    const blockedHits = this.matchCustomerServiceTerms(
      rule.blockedKeywords,
      content,
    );
    const fileRequest =
      /(文件|附件|合同|报价单|价目表|资料|方案|pdf|word|excel|表格|文档).{0,12}(发|发送|给|要|下载|提供)|(?:发|发送|给).{0,12}(文件|附件|合同|报价单|资料|方案|pdf)/i.test(
        sourceText,
      );
    const fileMayAutoSend =
      /允许.{0,6}发送|可以.{0,6}发送|自动发送|直接发送/.test(
        rule.fileRequestPolicy || '',
      );
    const reviewReason = this.resolveCustomerReplyReviewReason(content);
    const noReplyReasons = [
      ...noReplyHits.map((item) => `命中不回复场景：${item}`),
      ...blockedHits.map((item) => `命中禁止表达：${item}`),
      !accountBound ? '承接账号未绑定到当前机器人' : '',
      !scopeMatched ? '客户来源不在当前机器人范围内' : '',
      input.knowledge.scope === 'selected' && !input.knowledge.available
        ? '指定知识资料不存在或不可用'
        : '',
    ].filter(Boolean);
    const reviewReasons = [
      ...approvalHits.map((item) => `命中发送前确认词：${item}`),
      reviewReason ? `需要人工核对：${reviewReason}` : '',
      !whitelisted ? '联系人未命中白名单' : '',
      fileRequest && !fileMayAutoSend
        ? this.optionalTrimmedText(rule.fileRequestPolicy) ||
          '文件请求需要人工确认'
        : '',
      !input.commercialExecutionAllowed ? '当前账号没有自动发送权限' : '',
    ].filter(Boolean);
    const baseSendMode = this.resolveCustomerServiceSendMode(
      rule,
      input.requestedSendMode,
      sourceText,
      replyText,
      input.commercialExecutionAllowed,
    );
    const action = noReplyReasons.length
      ? 'no-reply'
      : reviewReasons.length || baseSendMode !== 'auto-send'
        ? 'review'
        : 'reply';
    const sendMode: InteractionSendMode =
      action === 'no-reply'
        ? 'draft-only'
        : action === 'review'
          ? baseSendMode === 'draft-only'
            ? 'draft-only'
            : 'approval-send'
          : 'auto-send';
    const delay = this.parseCustomerServiceReplyDelay(
      rule.replyDelay,
      input.now || new Date(),
    );
    const reasons = action === 'no-reply' ? noReplyReasons : reviewReasons;
    const reason =
      reasons[0] ||
      (action === 'reply'
        ? delay.selectedSeconds > 0
          ? `低风险回复将在 ${delay.selectedSeconds} 秒后进入发送队列。`
          : '低风险回复可以进入发送队列。'
        : sendMode === 'draft-only'
          ? '当前规则只生成草稿。'
          : '当前规则要求发送前确认。');
    return {
      action,
      sendMode,
      canGenerate: action !== 'no-reply',
      canCreateTask: action !== 'no-reply',
      reason,
      reasons: reasons.length ? reasons : [reason],
      matchedRules: {
        whitelist: whitelistHits,
        noReply: noReplyHits,
        approval: approvalHits,
        blocked: blockedHits,
      },
      delay,
      knowledge: {
        scope: input.knowledge.scope,
        selectedKnowledgeId: input.knowledge.selectedKnowledgeId,
        selectedKnowledgeTitle: input.knowledge.selectedKnowledgeTitle,
        available: input.knowledge.available,
      },
      contact: {
        platform,
        accountBound,
        scopeMatched,
        whitelisted,
      },
      fileRequest,
    };
  }

  private matchCustomerServiceTerms(
    values: string[] | undefined,
    text: string,
  ) {
    const normalizedText = text.toLowerCase();
    return this.normalizeStringList(values, []).filter((item) =>
      normalizedText.includes(item.toLowerCase()),
    );
  }

  private parseCustomerServiceReplyDelay(value: unknown, now: Date) {
    const text = this.optionalTrimmedText(value) || '';
    if (!text || /立即|即时|马上/.test(text)) {
      return { minSeconds: 0, maxSeconds: 0, selectedSeconds: 0 };
    }
    const numbers = Array.from(text.matchAll(/\d+(?:\.\d+)?/g))
      .map((match) => Number(match[0]))
      .filter((number) => Number.isFinite(number) && number >= 0);
    if (!numbers.length) {
      return { minSeconds: 0, maxSeconds: 0, selectedSeconds: 0 };
    }
    const multiplier = /小时/.test(text) ? 3600 : /分钟|分/.test(text) ? 60 : 1;
    const minSeconds = Math.min(
      24 * 60 * 60,
      Math.max(0, Math.round(Math.min(...numbers) * multiplier)),
    );
    const maxSeconds = Math.min(
      24 * 60 * 60,
      Math.max(minSeconds, Math.round(Math.max(...numbers) * multiplier)),
    );
    const selectedSeconds = minSeconds;
    return {
      minSeconds,
      maxSeconds,
      selectedSeconds,
      notBefore:
        selectedSeconds > 0
          ? new Date(now.getTime() + selectedSeconds * 1000).toISOString()
          : undefined,
    };
  }

  private resolveCustomerServicePlatform(
    rule: InteractionReplyRuleConfig,
    requested: CustomerServiceReplyPlatform | undefined,
    accountName: string,
  ): CustomerServiceReplyPlatform {
    const inferred = /微信|wechat/i.test(accountName)
      ? 'wechat'
      : /抖音|douyin|字节|tiktok/i.test(accountName)
        ? 'douyin'
        : undefined;
    const platform = requested || inferred;
    if (!platform) {
      throw new BadRequestException(
        '无法判断承接账号的平台，请选择微信或抖音。',
      );
    }
    if (rule.contactScope !== 'all' && rule.contactScope !== platform) {
      throw new BadRequestException(
        '该机器人没有绑定当前平台，请更换机器人或账号。',
      );
    }
    return platform;
  }

  private resolveCustomerServiceSendMode(
    rule: InteractionReplyRuleConfig,
    requested: InteractionSendMode | undefined,
    sourceText: string,
    replyText: string,
    commercialExecutionAllowed: boolean,
  ): InteractionSendMode {
    if (requested === 'draft-only' || requested === 'approval-send') {
      return requested;
    }
    if (rule.defaultSendMode !== 'auto-send') {
      return rule.defaultSendMode;
    }
    const content = `${sourceText}\n${replyText}`;
    const requiresReview =
      !commercialExecutionAllowed ||
      Boolean(this.resolveCustomerReplyReviewReason(content)) ||
      this.normalizeStringList(rule.requireApprovalKeywords, []).some(
        (keyword) => content.includes(keyword),
      ) ||
      this.normalizeStringList(rule.blockedKeywords, []).some((keyword) =>
        content.includes(keyword),
      );
    return requiresReview ? 'approval-send' : 'auto-send';
  }

  private buildReplyFromRule(
    sourceText: string,
    context: { targetName?: string; accountName?: string } = {},
    replyRule: InteractionReplyRuleConfig = this.replyRule,
  ) {
    const rule = replyRule;
    const normalizedSource = sourceText.replace(/\s+/g, ' ').trim();
    const namePrefix = context.targetName?.trim()
      ? `${context.targetName.trim()}，`
      : '';
    const serviceHighlight = rule.serviceHighlights
      .map((highlight) => highlight.trim())
      .find(Boolean);
    const closing = rule.askForContact
      ? this.resolveSafeReplyClosing(rule.closingText)
      : '';
    const appendRuleContext = (reply: string) =>
      [reply, serviceHighlight ? `我们这边${serviceHighlight}。` : '', closing]
        .filter(Boolean)
        .join(' ');
    const hitApproval = rule.requireApprovalKeywords.find((keyword) =>
      normalizedSource.includes(keyword),
    );
    if (
      /退款|退货|售后|坏了|破损|发错|没收到|少发|漏发|质量|订单|物流|快递|发票/.test(
        normalizedSource,
      )
    ) {
      return '先别急，你把订单号和问题照片发我，我核实后按平台售后流程处理。';
    }
    if (
      /投诉|差评|不满意|垃圾|骗子|曝光|举报|拉黑|太差|生气|坑人|维权/.test(
        normalizedSource,
      )
    ) {
      return '抱歉让你体验不好了。你把具体问题和订单信息发我，我先核实处理。';
    }
    if (/价格|多少钱|收费|费用|报价|贵不贵|怎么卖/.test(normalizedSource)) {
      return appendRuleContext(
        `${namePrefix}你问的价格要看具体需求、数量和时间，我先按你的情况核准后再回复，避免乱报。`,
      );
    }
    if (
      /预约|预定|时间|几点|营业|排期|今天|明天|后天|周末|上门|到店/.test(
        normalizedSource,
      )
    ) {
      return '可以约，你把大概时间和要办的事发我，我先帮你看下能不能排上。';
    }
    if (
      /怎么买|购买|下单|链接|入口|橱窗|商品|有吗|还有吗|库存|现货/.test(
        normalizedSource,
      )
    ) {
      return '可以，你想看哪一款？把名称或截图发我，我帮你对应到具体入口。';
    }
    if (/在哪|哪里|地址|位置|怎么去|导航|门店/.test(normalizedSource)) {
      return '你想找门店地址还是商品入口？我按你要的给你发。';
    }
    if (/电话|联系|微信|私信|加我|客服|人工/.test(normalizedSource)) {
      return '可以，你直接私信发具体需求就行，我先看内容，再告诉你下一步怎么处理。';
    }
    if (hitApproval) {
      return `这个涉及${hitApproval}，你把订单和具体情况发我，我先按平台规则核实。`;
    }
    const configuredFallback = this.pickConfiguredFallbackReply(
      normalizedSource,
      rule,
    );
    if (configuredFallback) {
      return appendRuleContext(configuredFallback);
    }
    const subject = this.extractReplySubject(normalizedSource);
    return appendRuleContext(
      `${namePrefix}我看到你提到“${subject}”，这块我先按你的实际情况帮你核一下，再给你明确回复。`,
    );
  }

  private async tryGenerateInteractionReplyWithAi(
    sourceText: string,
    context: {
      targetName?: string;
      accountName?: string;
      fallbackReply: string;
    },
    replyRule: InteractionReplyRuleConfig = this.replyRule,
    knowledge: CustomerServiceKnowledgeContext = {
      scope: 'local',
      available: true,
    },
  ) {
    if (!this.aiClient || !this.defaultModels) {
      return '';
    }

    try {
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.articleCreation || defaults.topicSelection;
      if (!modelId) {
        return '';
      }

      const rule = replyRule;
      const prompt = [
        `行业：${rule.industryName || '本地生活/电商服务'}`,
        `语气：${rule.tone === 'concise' ? '简洁直接' : rule.tone === 'warm' ? '自然友好' : '专业克制'}`,
        context.accountName ? `账号：${context.accountName}` : '',
        context.targetName ? `客户/对象：${context.targetName}` : '',
        knowledge.scope === 'selected' && knowledge.selectedKnowledgeTitle
          ? `仅可引用指定资料：${knowledge.selectedKnowledgeTitle}`
          : knowledge.scope === 'none'
            ? '本次不得引用知识库；信息不足时直接追问或转人工。'
            : '可引用当前本地知识库中的相关资料。',
        knowledge.scope === 'selected' && knowledge.content
          ? `指定资料内容：\n${knowledge.content}`
          : '',
        `客户原话：${sourceText}`,
        `规则兜底参考：${context.fallbackReply}`,
        '请生成一条可直接回复客户的中文短句，要求：',
        '1. 不编造价格、库存、疗效、承诺、联系方式或平台外交易。',
        '2. 不使用“亲亲”“尊敬的客户”“马上安排”“专人跟进”等模板腔。',
        '3. 能回答就回答，信息不足时请自然地追问必要信息。',
        '4. 只输出回复正文，控制在 80 字以内。',
      ]
        .filter(Boolean)
        .join('\n');
      const output = await this.aiClient.generate(
        modelId,
        [
          {
            role: 'system',
            content:
              '你是商家账号的客服回复助手，只能输出要发给客户的一句话。必须真实、克制、可商用。',
          },
          { role: 'user', content: prompt },
        ],
        {
          temperature: 0.35,
          maxTokens: 180,
          knowledgeMode: knowledge.scope === 'local' ? 'required' : 'off',
          knowledgeQuery:
            knowledge.scope === 'local'
              ? `${context.accountName || ''}\n${context.targetName || ''}\n${sourceText}`
              : undefined,
        },
      );
      return this.normalizeAiInteractionReply(output);
    } catch (error) {
      console.warn(
        '[local-engine] AI interaction reply failed, falling back to rule',
        error instanceof Error ? error.message : error,
      );
      return '';
    }
  }

  private normalizeAiInteractionReply(output: string) {
    const cleaned = String(output || '')
      .replace(/^```(?:text|markdown|json)?/i, '')
      .replace(/```$/i, '')
      .replace(/^回复[:：]\s*/i, '')
      .replace(/^["“”']+|["“”']+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '';
    if (
      /保证治好|最低价|绝对有效|返现|私下转账|加微信|留电话|马上安排专人|尊敬的客户|亲亲|亲爱的|作为AI|我是AI/i.test(
        cleaned,
      )
    ) {
      return '';
    }
    return cleaned.slice(0, 160);
  }

  private pickConfiguredFallbackReply(
    sourceText: string,
    rule: InteractionReplyRuleConfig = this.replyRule,
  ) {
    if (!rule.fallbackEnabled) {
      return '';
    }
    const replies = this.normalizeStringList(rule.fallbackReplies, []);
    if (!replies.length) {
      return '';
    }
    const source = sourceText.replace(/\s+/g, ' ').trim();
    const matched = replies.find((reply) => {
      if (/订单|售后|退款|物流|发票/.test(source)) {
        return /订单|售后|物流|核实|问题/.test(reply);
      }
      if (/价格|多少|费用|收费/.test(source)) {
        return /价格|费用|具体|核/.test(reply);
      }
      if (/预约|时间|上门|到店/.test(source)) {
        return /时间|预约|具体/.test(reply);
      }
      return false;
    });
    return (matched || '').slice(0, 140);
  }

  private extractReplySubject(sourceText: string) {
    const cleaned = sourceText
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^(你好|您好|在吗|哈喽|hello|hi)[，,、\s]*/i, '')
      .trim();
    if (!cleaned) return '这个问题';
    return cleaned.length > 24 ? `${cleaned.slice(0, 24)}...` : cleaned;
  }

  private resolveSafeReplyClosing(closingText?: string | null) {
    const cleaned = String(closingText || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      !cleaned ||
      /收到(您的)?(留言|咨询)|专人跟进|马上(帮您)?安排|给您合适方案|感谢咨询|欢迎了解|亲亲|亲爱的|^亲[，,、\s]|尊敬的客户|方便留个联系方式|留下联系方式|留个联系方式|私信我们吗|[~～]/.test(
        cleaned,
      )
    ) {
      return '你把具体款式、订单或时间发我，我按实际情况帮你看。';
    }
    return cleaned.slice(0, 140);
  }

  private optionalTrimmedText(value: unknown) {
    const text = String(value || '').trim();
    return text || undefined;
  }

  private normalizeReplyGeneratedBy(
    value: unknown,
  ): InteractionReplyGeneratedBy | undefined {
    const text = this.optionalTrimmedText(value);
    return text === 'ai' || text === 'fallback' ? text : undefined;
  }

  private optionalNumber(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private normalizeGroupBroadcastPlanMetadata(
    input: Partial<CreateInteractionTaskInput>,
    now = new Date().toISOString(),
  ): Record<string, unknown> {
    const metadata =
      input.metadata && typeof input.metadata === 'object'
        ? { ...input.metadata }
        : {};
    const currentWechatId =
      this.optionalTrimmedText(input.currentWechatId) ||
      this.optionalTrimmedText(metadata.currentWechatId) ||
      this.optionalTrimmedText(metadata.current_wechat_id);
    const plannedWechatId =
      this.optionalTrimmedText(input.plannedWechatId) ||
      this.optionalTrimmedText(input.associatedWeChat) ||
      this.optionalTrimmedText(metadata.plannedWechatId) ||
      this.optionalTrimmedText(metadata.planned_wechat_id) ||
      this.optionalTrimmedText(metadata.associatedWeChat) ||
      this.optionalTrimmedText(metadata.associated_wechat);
    if (currentWechatId) {
      metadata.currentWechatId = currentWechatId;
    }
    if (plannedWechatId) {
      metadata.plannedWechatId = plannedWechatId;
      metadata.associatedWeChat =
        this.optionalTrimmedText(metadata.associatedWeChat) || plannedWechatId;
    }

    if (!input.type || !this.isDesktopInteractionTask(input.type)) {
      return metadata;
    }

    const planName =
      this.optionalTrimmedText(input.planName) ||
      this.optionalTrimmedText(metadata.planName) ||
      this.optionalTrimmedText(metadata.wechat_plan_name) ||
      this.optionalTrimmedText(metadata.messageSendPlanName) ||
      this.optionalTrimmedText(metadata.message_send_plan_name) ||
      this.defaultWechatPlanName(input.type, now);
    const planTime =
      this.optionalTrimmedText(input.planTime) ||
      this.optionalTrimmedText(metadata.planTime) ||
      this.optionalTrimmedText(metadata.wechat_plan_time) ||
      this.optionalTrimmedText(metadata.wechat_plan_schedule_start_time) ||
      this.optionalTrimmedText(metadata.scheduledAt) ||
      this.optionalTrimmedText(metadata.scheduleStartTime) ||
      this.optionalTrimmedText(metadata.wechat_moments_schedule_start_time) ||
      this.optionalTrimmedText(metadata.message_send_plan_time);
    const dailyLimit =
      this.optionalNumber(input.dailyLimit) ??
      this.optionalNumber(metadata.dailyLimit) ??
      this.optionalNumber(metadata.wechat_plan_daily_limit) ??
      this.optionalNumber(metadata.wechat_group_daily_limit) ??
      this.optionalNumber(metadata.wechat_contact_add_daily_limit) ??
      this.optionalNumber(metadata.wechat_moments_marketing_daily_limit) ??
      this.optionalNumber(metadata.dailyViewLimit);
    const associatedWeChat =
      this.optionalTrimmedText(input.associatedWeChat) ||
      this.optionalTrimmedText(metadata.associatedWeChat) ||
      this.optionalTrimmedText(metadata.associated_wechat) ||
      this.optionalTrimmedText(metadata.wechat_plan_associated_wechat_id) ||
      this.optionalTrimmedText(metadata.wechat_plan_associated_wechat_name);
    const associatedWeChatName =
      this.optionalTrimmedText(metadata.associatedWeChatName) ||
      this.optionalTrimmedText(metadata.associated_wechat_name) ||
      this.optionalTrimmedText(metadata.wechat_plan_associated_wechat_name) ||
      this.optionalTrimmedText(input.accountName);
    const generateOnDemand =
      typeof input.generateOnDemand === 'boolean'
        ? input.generateOnDemand
        : typeof metadata.generateOnDemand === 'boolean'
          ? metadata.generateOnDemand
          : typeof metadata.generate_on_demand === 'boolean'
            ? metadata.generate_on_demand
            : undefined;
    const planKind = this.resolveWechatPlanKind(input.type);
    const minIntervalSeconds =
      this.optionalNumber(input.minIntervalSeconds) ??
      this.optionalNumber(metadata.minIntervalSeconds) ??
      this.optionalNumber(metadata.wechat_contact_add_min_interval_seconds);
    const maxIntervalSeconds =
      this.optionalNumber(input.maxIntervalSeconds) ??
      this.optionalNumber(metadata.maxIntervalSeconds) ??
      this.optionalNumber(metadata.wechat_contact_add_max_interval_seconds);
    const verifyMessage =
      this.optionalTrimmedText(input.verifyMessage) ||
      this.optionalTrimmedText(metadata.verifyMessage) ||
      this.optionalTrimmedText(metadata.wechat_contact_add_verify_message);
    const remarkStrategy =
      this.optionalTrimmedText(input.remarkStrategy) ||
      this.optionalTrimmedText(metadata.remarkStrategy) ||
      this.optionalTrimmedText(metadata.wechat_contact_add_remark_strategy);
    const remarkContent =
      this.optionalTrimmedText(input.remarkContent) ||
      this.optionalTrimmedText(metadata.remarkContent) ||
      this.optionalTrimmedText(metadata.wechat_contact_add_remark_content);
    const checkIntervalMinutes =
      this.optionalNumber(input.checkIntervalMinutes) ??
      this.optionalNumber(metadata.checkIntervalMinutes) ??
      this.optionalNumber(
        metadata.wechat_moments_marketing_check_interval_minutes,
      );
    const publishIntervalMinutes =
      this.optionalNumber(input.publishIntervalMinutes) ??
      this.optionalNumber(metadata.publishIntervalMinutes) ??
      this.optionalNumber(metadata.wechat_moments_publish_interval_minutes);
    const planType =
      this.optionalTrimmedText(input.planType) ||
      this.optionalTrimmedText(metadata.planType) ||
      this.optionalTrimmedText(metadata.wechat_mass_send_plan_type);
    const chunkedSending =
      typeof input.chunkedSending === 'boolean'
        ? input.chunkedSending
        : typeof metadata.chunkedSending === 'boolean'
          ? metadata.chunkedSending
          : typeof metadata.wechat_mass_send_chunked_sending === 'boolean'
            ? metadata.wechat_mass_send_chunked_sending
            : undefined;
    const massSendFiles = Array.isArray(input.massSendFiles)
      ? input.massSendFiles
      : Array.isArray(metadata.massSendFiles)
        ? metadata.massSendFiles
        : Array.isArray(metadata.wechat_mass_send_files)
          ? metadata.wechat_mass_send_files
          : undefined;
    const massSendContents = Array.isArray(metadata.wechat_mass_send_contents)
      ? metadata.wechat_mass_send_contents
      : input.type === 'wechat-group-broadcast'
        ? (input.batchTargets || [])
            .map((target) => ({
              targetName: this.optionalTrimmedText(target.targetName),
              targetNo: this.optionalTrimmedText(target.targetName),
              sendContent:
                this.optionalTrimmedText(target.replyText) ||
                this.optionalTrimmedText(input.replyText),
              groupType: 'ordinary',
            }))
            .filter((target) => target.targetName && target.sendContent)
        : undefined;
    const momentsDetails = Array.isArray(input.momentsDetails)
      ? input.momentsDetails
      : Array.isArray(metadata.momentsDetails)
        ? metadata.momentsDetails
        : Array.isArray(metadata.wechat_moments_details)
          ? metadata.wechat_moments_details
          : undefined;
    const momentsTotalCount =
      this.optionalNumber(input.momentsTotalCount) ??
      this.optionalNumber(metadata.momentsTotalCount) ??
      this.optionalNumber(metadata.wechat_moments_total_tasks);

    return {
      ...metadata,
      planName,
      wechat_plan_name: planName,
      planTime,
      wechat_plan_time: planTime,
      wechat_plan_schedule_start_time: planTime,
      scheduledAt: planTime,
      dailyLimit,
      wechat_plan_daily_limit: dailyLimit,
      ...(input.type === 'wechat-group-broadcast'
        ? { wechat_group_daily_limit: dailyLimit }
        : {}),
      associatedWeChat,
      associatedWeChatName,
      wechat_plan_associated_wechat_id: associatedWeChat,
      wechat_plan_associated_wechat_name: associatedWeChatName,
      plannedWechatId: associatedWeChat,
      planned_wechat_id: associatedWeChat,
      current_wechat_id: currentWechatId,
      wechat_plan_kind: planKind,
      verifyMessage,
      wechat_contact_add_verify_message: verifyMessage,
      remarkStrategy,
      remarkContent,
      wechat_contact_add_remark_strategy: remarkStrategy,
      wechat_contact_add_remark_content: remarkContent,
      minIntervalSeconds,
      maxIntervalSeconds,
      wechat_contact_add_min_interval_seconds: minIntervalSeconds,
      wechat_contact_add_max_interval_seconds: maxIntervalSeconds,
      checkIntervalMinutes,
      wechat_moments_marketing_check_interval_minutes: checkIntervalMinutes,
      publishIntervalMinutes,
      wechat_moments_publish_interval_minutes: publishIntervalMinutes,
      planType,
      wechat_mass_send_plan_type: planType,
      chunkedSending,
      wechat_mass_send_chunked_sending: chunkedSending,
      massSendFiles,
      wechat_mass_send_files: massSendFiles,
      wechat_mass_send_contents: massSendContents,
      momentsDetails,
      wechat_moments_details: momentsDetails,
      momentsTotalCount,
      wechat_moments_total_tasks: momentsTotalCount,
      generateOnDemand,
    };
  }

  private defaultWechatPlanName(
    type: InteractionTaskType | undefined,
    now: string,
  ) {
    const date = now.slice(0, 10);
    if (type === 'wechat-contact-add') return `添加好友计划 ${date}`;
    if (type === 'wechat-moments-publish') return `朋友圈发布计划 ${date}`;
    if (type === 'wechat-moments-marketing') return `朋友圈营销计划 ${date}`;
    if (type === 'wechat-reply-draft') return `微信回复计划 ${date}`;
    return `微信群发计划 ${date}`;
  }

  private resolveWechatPlanKind(type: InteractionTaskType | undefined) {
    if (type === 'wechat-group-broadcast') return 'mass-send';
    if (type === 'wechat-contact-add') return 'contact-add';
    if (type === 'wechat-moments-publish') return 'moments-publish';
    if (type === 'wechat-moments-marketing') return 'moments-marketing';
    if (type === 'wechat-reply-draft') return 'session-reply';
    return undefined;
  }

  private resolveWechatAccountProtection(task: InteractionTask): {
    associatedWeChat?: string;
    currentWechatId?: string;
    warning?: string;
    blocker?: string;
  } {
    if (!this.isDesktopInteractionTask(task.type)) {
      return {};
    }
    const metadata = task.metadata || {};
    const associatedWeChat =
      this.optionalTrimmedText(task.associatedWeChat) ||
      this.optionalTrimmedText(task.plannedWechatId) ||
      this.optionalTrimmedText(metadata.associatedWeChat) ||
      this.optionalTrimmedText(metadata.associated_wechat) ||
      this.optionalTrimmedText(metadata.plannedWechatId) ||
      this.optionalTrimmedText(metadata.planned_wechat_id);
    if (!associatedWeChat) {
      return {};
    }
    const currentWechatId =
      this.optionalTrimmedText(task.currentWechatId) ||
      this.optionalTrimmedText(metadata.currentWechatId) ||
      this.optionalTrimmedText(metadata.current_wechat_id) ||
      this.optionalTrimmedText(metadata.currentWeChat) ||
      this.optionalTrimmedText(metadata.current_wechat);
    if (!currentWechatId) {
      return {
        associatedWeChat,
        blocker: `微信号保护阻断：计划关联微信号为 ${associatedWeChat}，但当前微信号不可读取；无法确认登录账号时禁止执行。`,
      };
    }
    if (currentWechatId !== associatedWeChat) {
      return {
        associatedWeChat,
        currentWechatId,
        blocker: `微信号保护阻断：计划关联微信号为 ${associatedWeChat}，当前微信号为 ${currentWechatId}，不一致时禁止执行。`,
      };
    }
    return { associatedWeChat, currentWechatId };
  }

  private resolveGroupBroadcastPlanStatus(
    type: InteractionTaskType,
    taskStatus: InteractionTaskStatus,
    explicitStatus?: unknown,
    planTime?: unknown,
  ) {
    if (type !== 'wechat-group-broadcast') {
      return undefined;
    }
    const explicit = this.optionalTrimmedText(explicitStatus);
    if (
      explicit === 'draft' ||
      explicit === 'scheduled' ||
      explicit === 'sending' ||
      explicit === 'paused' ||
      explicit === 'completed' ||
      explicit === 'failed' ||
      explicit === 'removed'
    ) {
      return explicit;
    }
    if (taskStatus === 'paused') return 'paused';
    if (taskStatus === 'completed' || taskStatus === 'skipped') {
      return 'completed';
    }
    if (taskStatus === 'failed' || taskStatus === 'blocked') return 'failed';
    if (
      taskStatus === 'running' ||
      taskStatus === 'waiting_for_send_confirmation'
    ) {
      return 'sending';
    }
    return this.optionalTrimmedText(planTime) ? 'scheduled' : 'draft';
  }

  private normalizeMomentsPromptConfig(
    value: unknown,
  ): MomentsPlanMetadata['prompts'] {
    if (!Array.isArray(value)) return undefined;
    const prompts: NonNullable<MomentsPlanMetadata['prompts']> = [];
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const prompt = this.optionalTrimmedText(record.prompt);
      if (!prompt) continue;
      prompts.push({
        key: this.optionalTrimmedText(record.key),
        title: this.optionalTrimmedText(record.title),
        prompt,
        enabled: record.enabled !== false,
      });
      if (prompts.length >= 20) break;
    }
    return prompts.length ? prompts : undefined;
  }

  private normalizeMomentsPlanMetadata(
    input: CreateInteractionTaskInput,
  ): Record<string, unknown> | undefined {
    if (
      input.type !== 'wechat-moments-publish' &&
      input.type !== 'wechat-moments-marketing'
    ) {
      return undefined;
    }
    const existing =
      input.metadata && typeof input.metadata === 'object'
        ? input.metadata
        : {};
    const dailyPublished = this.readMetadataPositiveInteger(
      input.dailyPublished ??
        existing.dailyPublished ??
        existing.wechat_moments_daily_published,
      0,
      10000,
    );
    const fallbackQuota =
      input.type === 'wechat-moments-publish'
        ? 1
        : this.readMetadataPositiveInteger(
            existing.dailyViewLimit ??
              existing.wechat_moments_marketing_daily_limit,
            20,
            100,
          );
    const dailyQuota = this.readMetadataPositiveInteger(
      input.dailyQuota ??
        existing.dailyQuota ??
        existing.wechat_moments_daily_quota,
      fallbackQuota,
      10000,
    );
    const scheduleStartTime = this.optionalTrimmedText(
      input.scheduleStartTime ??
        existing.scheduleStartTime ??
        existing.wechat_moments_schedule_start_time,
    );
    const recordSummary = this.optionalTrimmedText(
      input.recordSummary ??
        existing.recordSummary ??
        existing.wechat_moments_record_summary,
    );
    const prompts = this.normalizeMomentsPromptConfig(
      input.prompts ?? existing.prompts ?? existing.wechat_moments_prompts,
    );
    const autoLike =
      input.autoLike ??
      (typeof existing.autoLike === 'boolean'
        ? existing.autoLike
        : undefined) ??
      (typeof existing.wechat_moments_auto_like === 'boolean'
        ? existing.wechat_moments_auto_like
        : undefined);
    const autoComment =
      input.autoComment ??
      (typeof existing.autoComment === 'boolean'
        ? existing.autoComment
        : undefined) ??
      (typeof existing.wechat_moments_auto_comment === 'boolean'
        ? existing.wechat_moments_auto_comment
        : undefined);

    return {
      dailyPublished,
      dailyQuota,
      scheduleStartTime,
      autoLike,
      autoComment,
      recordSummary,
      prompts,
      wechat_moments_daily_published: dailyPublished,
      wechat_moments_daily_quota: dailyQuota,
      wechat_moments_schedule_start_time: scheduleStartTime,
      wechat_moments_auto_like: autoLike,
      wechat_moments_auto_comment: autoComment,
      wechat_moments_record_summary: recordSummary,
      wechat_moments_prompts: prompts,
    };
  }

  private readMomentsPlanState(
    metadata: Record<string, unknown> | undefined,
    fallbackDailyQuota: number,
  ): MomentsPlanState {
    const dailyPublished = this.readMetadataPositiveInteger(
      metadata?.dailyPublished ?? metadata?.wechat_moments_daily_published,
      0,
      10000,
    );
    const dailyQuota = this.readMetadataPositiveInteger(
      metadata?.dailyQuota ?? metadata?.wechat_moments_daily_quota,
      fallbackDailyQuota,
      10000,
    );
    return {
      dailyPublished,
      dailyQuota,
      remainingToday: Math.max(0, dailyQuota - dailyPublished),
      scheduleStartTime: this.optionalTrimmedText(
        metadata?.scheduleStartTime ??
          metadata?.wechat_moments_schedule_start_time,
      ),
      autoLike:
        typeof metadata?.autoLike === 'boolean'
          ? metadata.autoLike
          : typeof metadata?.wechat_moments_auto_like === 'boolean'
            ? metadata.wechat_moments_auto_like
            : undefined,
      autoComment:
        typeof metadata?.autoComment === 'boolean'
          ? metadata.autoComment
          : typeof metadata?.wechat_moments_auto_comment === 'boolean'
            ? metadata.wechat_moments_auto_comment
            : undefined,
      recordSummary: this.optionalTrimmedText(
        metadata?.recordSummary ?? metadata?.wechat_moments_record_summary,
      ),
      prompts: this.normalizeMomentsPromptConfig(
        metadata?.prompts ?? metadata?.wechat_moments_prompts,
      ),
    };
  }

  private assertMomentsScheduleReady(plan: MomentsPlanState) {
    if (!plan.scheduleStartTime) return;
    const timestamp = Date.parse(plan.scheduleStartTime);
    if (!Number.isFinite(timestamp)) return;
    if (timestamp > Date.now()) {
      throw new Error(
        `朋友圈计划尚未到开始时间：${plan.scheduleStartTime}，请到点后继续执行。`,
      );
    }
  }

  private buildMomentsPlanReadback(plan: MomentsPlanState) {
    return [
      `今日已发布/互动：${plan.dailyPublished}/${plan.dailyQuota}`,
      plan.scheduleStartTime ? `计划开始时间：${plan.scheduleStartTime}` : '',
      plan.autoLike !== undefined
        ? `自动点赞：${plan.autoLike ? '开启' : '关闭'}`
        : '',
      plan.autoComment !== undefined
        ? `自动评论：${plan.autoComment ? '开启' : '关闭'}`
        : '',
      plan.recordSummary ? `记录摘要：${plan.recordSummary}` : '',
      plan.prompts?.length ? `Prompt 配置：${plan.prompts.length} 条` : '',
    ]
      .filter(Boolean)
      .join('；');
  }

  private normalizeBatchTargets(
    input: CreateInteractionTaskInput,
    now: string,
  ): InteractionBatchTarget[] {
    const rawTargets = Array.isArray(input.batchTargets)
      ? input.batchTargets
      : [];
    const normalizedTargets: InteractionBatchTarget[] = [];
    rawTargets.slice(0, 100).forEach((target, index) => {
      const sourceText = String(target?.sourceText || '').trim();
      if (!sourceText) {
        return;
      }
      normalizedTargets.push({
        id: `bt_${index + 1}_${this.createId()}`,
        targetName:
          String(target?.targetName || '').trim() || `批量对象 ${index + 1}`,
        sourceText,
        replyText:
          String(target?.replyText || input.replyText || '').trim() ||
          this.buildReplyFromRule(sourceText),
        sourceUrl: this.optionalTrimmedText(
          target?.sourceUrl || input.sourceUrl,
        ),
        profileUrl: this.optionalTrimmedText(
          target?.profileUrl || input.profileUrl,
        ),
        commentTime: this.optionalTrimmedText(
          target?.commentTime || input.commentTime,
        ),
        videoTitle: this.optionalTrimmedText(
          target?.videoTitle || input.videoTitle,
        ),
        videoUrl: this.optionalTrimmedText(target?.videoUrl || input.videoUrl),
        engagementScore:
          this.optionalNumber(target?.engagementScore) ??
          this.optionalNumber(input.engagementScore),
        status: 'queued',
        updatedAt: now,
      });
    });

    if (normalizedTargets.length) {
      return normalizedTargets;
    }

    const sourceText = input.sourceText?.trim() || '等待本机读取真实对象。';
    return [
      {
        id: `bt_1_${this.createId()}`,
        targetName: input.targetName?.trim() || '测试对象',
        sourceText,
        replyText:
          input.replyText?.trim() || this.buildReplyFromRule(sourceText),
        sourceUrl: this.optionalTrimmedText(input.sourceUrl),
        profileUrl: this.optionalTrimmedText(input.profileUrl),
        commentTime: this.optionalTrimmedText(input.commentTime),
        videoTitle: this.optionalTrimmedText(input.videoTitle),
        videoUrl: this.optionalTrimmedText(input.videoUrl),
        engagementScore: this.optionalNumber(input.engagementScore),
        status: 'queued',
        updatedAt: now,
      },
    ];
  }

  private completeQueuedBatchTargets(
    task: InteractionTask,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    return this.markQueuedBatchTargets(task, 'completed', undefined, metadata);
  }

  private markQueuedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    const now = new Date().toISOString();
    const targets = task.batchTargets || [];
    targets.forEach((target) => {
      if (
        target.status === 'queued' ||
        target.status === 'running' ||
        target.status === 'waiting_confirmation'
      ) {
        target.status = status;
        target.updatedAt = now;
        if (failureReason) {
          target.failureReason = failureReason;
        }
        if (metadata.nextAction) {
          target.nextAction = metadata.nextAction;
        }
        if (metadata.evidenceEventIds?.length) {
          target.evidenceEventIds = [
            ...new Set([
              ...(target.evidenceEventIds || []),
              ...metadata.evidenceEventIds,
            ]),
          ];
        }
      }
    });
    task.batchSummary = this.buildBatchSummary(targets);
    return targets.filter((target) => target.status === status).length;
  }

  private markPausableBatchTargets(
    task: InteractionTask,
    reason?: string,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    const now = new Date().toISOString();
    const targets = task.batchTargets || [];
    targets.forEach((target) => {
      if (target.status === 'running') {
        target.status = 'failed';
        target.failureReason =
          '暂停发生在执行中，无法证明发送按钮尚未生效，禁止自动重发。';
        target.updatedAt = now;
        target.nextAction =
          '请核对该对象的微信会话和迟到回读；确认未发送后再显式重试。';
        if (metadata.evidenceEventIds?.length) {
          target.evidenceEventIds = [
            ...new Set([
              ...(target.evidenceEventIds || []),
              ...metadata.evidenceEventIds,
            ]),
          ];
        }
      } else if (
        target.status === 'queued' ||
        target.status === 'waiting_confirmation'
      ) {
        target.status = 'queued';
        target.updatedAt = now;
        delete target.failureReason;
        if (reason) {
          target.nextAction = metadata.nextAction || reason;
        }
        if (metadata.evidenceEventIds?.length) {
          target.evidenceEventIds = [
            ...new Set([
              ...(target.evidenceEventIds || []),
              ...metadata.evidenceEventIds,
            ]),
          ];
        }
      }
    });
    task.batchSummary = this.buildBatchSummary(targets);
    return targets.filter((target) => target.status === 'queued').length;
  }

  private markUnfinishedBatchTargets(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    failureReason?: string,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    const now = new Date().toISOString();
    const terminalStatuses: InteractionBatchTarget['status'][] = [
      'completed',
      'skipped',
      'no_target',
    ];
    const targets = task.batchTargets || [];
    targets.forEach((target) => {
      if (terminalStatuses.includes(target.status)) {
        return;
      }
      target.status = status;
      target.updatedAt = now;
      if (failureReason) {
        target.failureReason = failureReason;
      } else if (status !== 'failed') {
        delete target.failureReason;
      }
      if (metadata.nextAction) {
        target.nextAction = metadata.nextAction;
      }
      if (metadata.evidenceEventIds?.length) {
        target.evidenceEventIds = [
          ...new Set([
            ...(target.evidenceEventIds || []),
            ...metadata.evidenceEventIds,
          ]),
        ];
      }
    });
    task.batchSummary = this.buildBatchSummary(targets);
    return targets.filter((target) => target.status === status).length;
  }

  private markBatchTargetsForApprovalOutcome(
    task: InteractionTask,
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    return this.markQueuedBatchTargets(task, status, reason, metadata);
  }

  private markBatchTargetsByNames(
    task: InteractionTask,
    targetNames: string[],
    status: InteractionBatchTarget['status'],
    reason?: string,
    metadata: {
      nextAction?: string;
      evidenceEventIds?: string[];
    } = {},
  ) {
    if (!task.batchTargets?.length || !targetNames.length) {
      return 0;
    }

    const targets = new Set(
      targetNames.map((name) => name.trim()).filter(Boolean),
    );
    if (!targets.size) {
      return 0;
    }

    let updated = 0;
    const updatedAt = new Date().toISOString();
    task.batchTargets.forEach((target) => {
      if (!targets.has(target.targetName)) {
        return;
      }
      target.status = status;
      target.updatedAt = updatedAt;
      if (
        status === 'failed' ||
        status === 'skipped' ||
        status === 'no_target'
      ) {
        target.failureReason = reason;
      } else {
        delete target.failureReason;
      }
      if (metadata.nextAction) {
        target.nextAction = metadata.nextAction;
      }
      if (metadata.evidenceEventIds?.length) {
        target.evidenceEventIds = [
          ...new Set([
            ...(target.evidenceEventIds || []),
            ...metadata.evidenceEventIds,
          ]),
        ];
      }
      updated += 1;
    });
    task.batchSummary = this.buildBatchSummary(task.batchTargets);
    return updated;
  }

  private resolveWindowsWechatNativeCommandForTask(
    type: InteractionTaskType,
  ): WechatNativeCommandKey | undefined {
    const command = resolveWechatNativeCommandKey(type);
    if (!command || command === 'contacts') {
      return undefined;
    }
    return command;
  }

  private resolveWechatNativeSendMode(task: InteractionTask) {
    const raw =
      this.optionalTrimmedText(task.metadata?.wechat_reply_mode) ||
      this.optionalTrimmedText(task.metadata?.sendMode) ||
      this.optionalTrimmedText(task.requestedSendMode) ||
      this.optionalTrimmedText(task.sendMode) ||
      'approval';
    if (/auto|自动/.test(raw)) return 'auto-send';
    if (/draft|草稿/.test(raw)) return 'draft-only';
    if (/read|只读/.test(raw)) return 'read-only';
    return 'approval';
  }

  private wechatNativeTargetRefs(
    task: InteractionTask,
    metadataValue?: unknown,
    max = 200,
  ) {
    const fromBatch = (task.batchTargets || []).flatMap((target, index) => {
      const displayName = this.optionalTrimmedText(target.targetName);
      if (!displayName) return [];
      return [
        {
          id: this.optionalTrimmedText(target.id) || `batch-${index + 1}`,
          displayName,
          nickname: displayName,
          searchText: displayName,
          source: 'interaction-task-batch',
          raw: {
            sourceText: target.sourceText,
            replyText: target.replyText,
            status: target.status,
          },
        },
      ];
    });
    if (fromBatch.length) {
      return fromBatch.slice(0, max);
    }

    const names = this.readMetadataStringList(metadataValue, [], max);
    const fallbackName = this.optionalTrimmedText(task.targetName);
    const source = names.length ? names : fallbackName ? [fallbackName] : [];
    return source.slice(0, max).map((displayName, index) => ({
      id: `target-${index + 1}`,
      displayName,
      nickname: displayName,
      searchText: displayName,
      source: names.length ? 'interaction-task-metadata' : 'interaction-task',
    }));
  }

  private wechatNativeAssetRefs(paths: string[]) {
    return paths.map((filePath) => ({
      path: filePath,
      role: 'attachment',
    }));
  }

  private buildWechatNativeCommandInput(
    command: WechatNativeCommandKey,
    task: InteractionTask,
  ): Record<string, unknown> {
    if (command === 'group-broadcast') {
      const targets = this.wechatNativeTargetRefs(
        task,
        task.metadata?.wechat_group_targets ?? task.metadata?.targets,
      );
      const attachmentPaths = this.readMetadataStringList(
        task.metadata?.massSendFiles ?? task.metadata?.wechat_mass_send_files,
        [],
        20,
      );
      const dailyLimit = this.readMetadataPositiveInteger(
        task.metadata?.dailyLimit ?? task.metadata?.wechat_group_daily_limit,
        targets.length || 1,
        200,
      );
      const intervalSeconds = this.readMetadataPositiveInteger(
        task.metadata?.intervalSeconds ??
          task.metadata?.wechat_group_interval_seconds,
        0,
        3600,
      );
      const personalizedMessages = this.readWechatTargetMessageMap(task);
      return {
        targets,
        message: {
          text:
            this.optionalTrimmedText(task.replyText) ||
            this.optionalTrimmedText(task.metadata?.wechat_reply_draft) ||
            '',
          attachments: this.wechatNativeAssetRefs(attachmentPaths),
        },
        messages: targets.flatMap((target) => {
          const targetName = this.optionalTrimmedText(target.displayName);
          const message = targetName
            ? personalizedMessages.get(targetName)
            : undefined;
          return targetName && message
            ? [
                {
                  targetId: this.optionalTrimmedText(target.id),
                  targetName,
                  message: {
                    text: message,
                    attachments: this.wechatNativeAssetRefs(attachmentPaths),
                  },
                },
              ]
            : [];
        }),
        rateLimit: {
          dailyLimit,
          intervalMs: intervalSeconds * 1000,
        },
        allowGroupChats: true,
        stopOnFailure: false,
      };
    }

    if (command === 'contact-add') {
      const targets = this.wechatNativeTargetRefs(
        task,
        task.metadata?.wechat_contact_add_targets ?? task.metadata?.targets,
      );
      const verifyMessage =
        this.optionalTrimmedText(task.replyText) ||
        this.optionalTrimmedText(task.metadata?.verifyMessage) ||
        this.optionalTrimmedText(
          task.metadata?.wechat_contact_add_verify_message,
        ) ||
        '';
      const blacklistTags = this.readMetadataStringList(
        task.metadata?.blacklist ?? task.metadata?.wechat_contact_add_blacklist,
        [],
        200,
      );
      return {
        targets: targets.map((target) => ({
          ...target,
          searchText:
            this.optionalTrimmedText(target.searchText) ||
            this.optionalTrimmedText(target.displayName) ||
            '',
          verifyMessage,
        })),
        verifyMessage,
        remark: {
          strategy:
            this.optionalTrimmedText(task.metadata?.remarkStrategy) ||
            this.optionalTrimmedText(
              task.metadata?.wechat_contact_add_remark_strategy,
            ) ||
            'none',
          value:
            this.optionalTrimmedText(task.metadata?.remarkContent) ||
            this.optionalTrimmedText(
              task.metadata?.wechat_contact_add_remark_content,
            ) ||
            '',
        },
        blacklistTags,
        rateLimit: {
          dailyLimit: this.readMetadataPositiveInteger(
            task.metadata?.dailyLimit ??
              task.metadata?.wechat_contact_add_daily_limit,
            targets.length || 1,
            50,
          ),
          intervalMs:
            this.readMetadataPositiveInteger(
              task.metadata?.minIntervalSeconds ??
                task.metadata?.wechat_contact_add_min_interval_seconds,
              180,
              86400,
            ) * 1000,
        },
      };
    }

    if (command === 'friend-accept') {
      return {
        remark: {
          strategy:
            this.optionalTrimmedText(
              task.metadata?.wechat_friend_accept_remark_strategy,
            ) || 'request_name',
          value:
            this.optionalTrimmedText(
              task.metadata?.wechat_friend_accept_remark_content,
            ) || '',
        },
        welcomeMessage:
          this.optionalTrimmedText(
            task.metadata?.wechat_friend_accept_welcome_message,
          ) || '',
        matchKeywords: this.readMetadataStringList(
          task.metadata?.wechat_friend_accept_match_keywords,
          [],
          100,
        ),
        dailyLimit: this.readMetadataPositiveInteger(
          task.metadata?.wechat_friend_accept_daily_limit,
          20,
          100,
        ),
      };
    }

    if (command === 'moments-publish') {
      const details = this.readMomentsPublishDetails(task);
      const first = details[0];
      const allAssets = details.flatMap((detail) => detail.attachments);
      return {
        content: {
          text: first?.content || '',
          assets: this.wechatNativeAssetRefs(allAssets),
          firstComment: first?.additionalComment || '',
          visibility: first?.visibility || 'public',
          publishAt: first?.scheduledPublishTime || '',
        },
        items: details.map((detail, index) => ({
          id: detail.targetName || `moment-${index + 1}`,
          text: detail.content,
          assets: this.wechatNativeAssetRefs(detail.attachments),
          firstComment: detail.additionalComment,
          visibility: detail.visibility,
          publishAt: detail.scheduledPublishTime || '',
        })),
      };
    }

    if (command === 'moments-marketing') {
      const actions = this.readMomentsMarketingActions(
        task.metadata?.actions ??
          task.metadata?.wechat_moments_marketing_actions,
      );
      const contacts = this.wechatNativeTargetRefs(
        task,
        task.metadata?.contacts ??
          task.metadata?.wechat_moments_marketing_contacts,
        100,
      );
      const marketingMode =
        this.optionalTrimmedText(
          task.metadata?.wechat_moments_marketing_mode,
        ) ||
        this.optionalTrimmedText(task.metadata?.marketingMode) ||
        (contacts.length ? 'targeted' : 'random');
      const targetedContacts = marketingMode === 'targeted' ? contacts : [];
      const targetComments = this.readMetadataTargetCommentMap(
        task.metadata?.targetComments ??
          task.metadata?.wechat_moments_marketing_target_comments,
      );
      const fixedText =
        this.optionalTrimmedText(task.metadata?.fixedComment) ||
        this.optionalTrimmedText(
          task.metadata?.wechat_moments_marketing_fixed_comment,
        ) ||
        this.optionalTrimmedText(task.replyText) ||
        '';
      const randomBrowseCount = this.readMetadataPositiveInteger(
        task.metadata?.randomBrowseCount ??
          task.metadata?.wechat_moments_marketing_random_browse_count,
        0,
        100,
      );
      const browseTargets =
        targetedContacts.length > 0
          ? targetedContacts.map((contact, index) => ({
              id: this.optionalTrimmedText(contact.id) || `moment-${index + 1}`,
              ordinal: index + 1,
              contact,
            }))
          : Array.from({ length: randomBrowseCount }, (_, index) => ({
              id: `moment-${index + 1}`,
              ordinal: index + 1,
              momentText: `朋友圈第 ${index + 1} 条`,
            }));
      return {
        mode: marketingMode === 'targeted' ? 'targeted' : 'random',
        actions: {
          browse: true,
          like: actions.like,
          comment: actions.comment,
        },
        contacts: targetedContacts,
        targets: browseTargets,
        browseLimit: randomBrowseCount || browseTargets.length,
        dailyLimit: this.readMetadataPositiveInteger(
          task.metadata?.dailyViewLimit ??
            task.metadata?.wechat_moments_marketing_daily_limit,
          browseTargets.length || 1,
          100,
        ),
        comment: {
          mode:
            this.optionalTrimmedText(task.metadata?.commentMode) ||
            this.optionalTrimmedText(
              task.metadata?.wechat_moments_marketing_comment_mode,
            ) ||
            (fixedText ? 'fixed' : 'none'),
          fixedText,
          targetComments: Array.from(targetComments.entries()).map(
            ([targetName, commentText]) => ({
              targetName,
              commentText,
            }),
          ),
        },
      };
    }

    if (command === 'chat-history') {
      return {
        action: 'sync',
        sessionId:
          this.optionalTrimmedText(
            task.metadata?.wechat_chat_history_session_id,
          ) ||
          this.optionalTrimmedText(task.targetName) ||
          '',
      };
    }

    return {};
  }

  private buildWechatNativeCommandRequest(
    command: WechatNativeCommandKey,
    task: InteractionTask,
  ) {
    const sendMode = this.resolveWechatNativeSendMode(task);
    return {
      contractVersion: WECHAT_NATIVE_COMMAND_CONTRACT_VERSION,
      command,
      input: this.buildWechatNativeCommandInput(command, task),
      context: {
        runId: task.id,
        relatedId: task.id,
        relatedType: 'interaction-task',
        locale: 'zh-CN',
        account: {
          accountId: task.accountId,
          accountName: task.accountName,
          currentWechatId: task.currentWechatId,
          plannedWechatId: task.plannedWechatId || task.associatedWeChat,
        },
        runtime: {
          platform: 'win32',
          engine: 'native-runtime',
        },
        safety: {
          sendMode,
          dryRun: false,
          requiresApproval: true,
          readbackRequired: true,
          stopOnRiskPrompt: true,
        },
        metadata: {
          taskType: task.type,
          planName: task.planName,
          riskLevel: task.riskLevel,
        },
      },
    };
  }

  private runWechatNativeRuntimeCommand(
    commandKey: WechatNativeCommandKey,
    request: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<Record<string, unknown>> {
    const runtimePath = this.resolveWechatNativeRuntimePath();
    if (!runtimePath) {
      throw new WechatDesktopCommandError(
        'Windows 微信 native runtime 不存在，无法执行受控预检。',
        {
          status: 'blocked',
          errorCode: 'runtime_unavailable',
          nextAction:
            '请安装包含 desktop/runtime/wechat-native-runtime 的完整安装包后重试。',
          message: 'native runtime missing',
        },
      );
    }
    const isNodeScript = extname(runtimePath).toLowerCase() === '.js';
    const executable = isNodeScript ? process.execPath : runtimePath;
    const args = isNodeScript ? [runtimePath, commandKey] : [commandKey];

    return new Promise((resolvePromise, reject) => {
      const child = spawn(executable, args, {
        env: {
          ...process.env,
          AI_CONTENT_WECHAT_NATIVE_RUNTIME: runtimePath,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(
          new WechatDesktopCommandError(
            `Windows 微信 native runtime ${commandKey} 执行超时。`,
            {
              status: 'blocked',
              errorCode: 'timeout',
              nextAction: '请导出诊断，检查微信窗口、权限和 runtime 日志。',
              message: stderr || stdout,
            },
          ),
        );
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(
          new WechatDesktopCommandError(
            `Windows 微信 native runtime 启动失败：${error.message}`,
            {
              status: 'blocked',
              errorCode: 'runtime_unavailable',
              nextAction: '请检查安装包 runtime 文件和杀毒/权限拦截。',
              message: error.message,
            },
          ),
        );
      });
      child.on('close', () => {
        clearTimeout(timeout);
        const jsonLine = this.findLastJsonLine(stdout);
        if (!jsonLine) {
          reject(
            new WechatDesktopCommandError(
              `Windows 微信 native runtime ${commandKey} 没有返回 JSON 结果。`,
              {
                status: 'blocked',
                errorCode: 'runtime_unavailable',
                nextAction: '请导出诊断，检查 runtime stdout/stderr。',
                message: this.compactWechatContactSyncOutput(
                  stderr || stdout || 'no output',
                ),
              },
            ),
          );
          return;
        }
        try {
          resolvePromise(JSON.parse(jsonLine) as Record<string, unknown>);
        } catch (error) {
          reject(
            new WechatDesktopCommandError(
              `Windows 微信 native runtime ${commandKey} JSON 解析失败。`,
              {
                status: 'blocked',
                errorCode: 'runtime_unavailable',
                nextAction: '请导出诊断，检查 runtime 输出格式。',
                message: error instanceof Error ? error.message : String(error),
              },
            ),
          );
        }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  private nativeRuntimeResponseMessage(
    command: WechatNativeCommandKey,
    parsed: Record<string, unknown>,
  ) {
    const errorDetail =
      parsed.errorDetail &&
      typeof parsed.errorDetail === 'object' &&
      !Array.isArray(parsed.errorDetail)
        ? (parsed.errorDetail as Record<string, unknown>)
        : {};
    return (
      this.optionalTrimmedText(parsed.message) ||
      this.optionalTrimmedText(parsed.error) ||
      this.optionalTrimmedText(errorDetail.message) ||
      `Windows 微信 native runtime ${command} 返回阻断。`
    );
  }

  private toWechatNativeDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult {
    return {
      status: this.optionalTrimmedText(parsed.status),
      errorCode: this.optionalTrimmedText(
        parsed.errorCode ?? parsed.error_code,
      ),
      nextAction: this.optionalTrimmedText(
        parsed.nextAction ?? parsed.next_action,
      ),
      message:
        this.optionalTrimmedText(parsed.message) ||
        this.optionalTrimmedText(parsed.error),
      readText:
        parsed.output === undefined
          ? undefined
          : JSON.stringify(parsed.output, null, 2),
      output: parsed.output,
      diagnostics: parsed.diagnostics,
      raw: parsed,
    };
  }

  private async tryRunWindowsWechatNativeControlledTask(
    task: InteractionTask,
  ): Promise<ApprovedWechatTaskResult | null> {
    if (this.getRuntimePlatform() !== 'win32') {
      return null;
    }
    const command = this.resolveWindowsWechatNativeCommandForTask(task.type);
    if (!command) {
      return null;
    }
    const request = this.buildWechatNativeCommandRequest(command, task);
    const parsed = await this.runWechatNativeRuntimeCommand(
      command,
      request,
      command === 'chat-history' ? 60000 : 30000,
    );
    const result = this.toWechatNativeDesktopCommandResult(parsed);
    const message = this.nativeRuntimeResponseMessage(command, parsed);
    if (parsed.ok === true && parsed.status === 'success') {
      return {
        ok: true,
        message,
        completedTargets: (task.batchTargets || [])
          .map((target) => target.targetName)
          .filter(Boolean),
        readbackText: result.readText,
        results: [
          {
            target: task.targetName,
            ok: true,
            message,
            result,
          },
        ],
      };
    }
    throw new WechatDesktopCommandError(message, result);
  }

  private async sendApprovedWechatTask(
    task: InteractionTask,
  ): Promise<ApprovedWechatTaskResult> {
    const customerServiceDecision =
      task.metadata?.customerServiceDecision &&
      typeof task.metadata.customerServiceDecision === 'object' &&
      !Array.isArray(task.metadata.customerServiceDecision)
        ? (task.metadata.customerServiceDecision as Record<string, unknown>)
        : {};
    if (
      task.metadata?.customerServiceNoReply === true ||
      customerServiceDecision.action === 'no-reply'
    ) {
      throw new Error('当前客服规则要求不自动回复，本次没有发送。');
    }
    const customerServiceNotBefore = this.optionalTrimmedText(
      task.metadata?.customerServiceNotBefore,
    );
    if (
      customerServiceNotBefore &&
      Date.parse(customerServiceNotBefore) > Date.now()
    ) {
      throw new Error(
        `当前回复将在 ${customerServiceNotBefore} 之后处理，本次没有发送。`,
      );
    }
    const nativeControlledResult =
      await this.tryRunWindowsWechatNativeControlledTask(task);
    if (nativeControlledResult) {
      return nativeControlledResult;
    }
    const wechatAccountProtection = this.resolveWechatAccountProtection(task);
    if (wechatAccountProtection.blocker) {
      throw new WechatDesktopCommandError(wechatAccountProtection.blocker);
    }
    if (wechatAccountProtection.warning) {
      this.pushEvent(task, 'warning', wechatAccountProtection.warning, {
        type: 'diagnostic_bundle',
        label: '微信号保护提示',
        value: wechatAccountProtection.warning,
        stageKey: 'send-result',
      });
    }

    if (task.type === 'wechat-contact-add') {
      const targets = task.batchTargets?.length
        ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
        : [task.targetName].filter(Boolean);
      if (!targets.length || !task.replyText?.trim()) {
        throw new Error('缺少加好友目标或验证消息，不能继续执行。');
      }
      const blacklist = new Set(
        this.readMetadataStringList(
          task.metadata?.blacklist ??
            task.metadata?.wechat_contact_add_blacklist,
          [],
          200,
        ),
      );
      const dailyLimit = this.readMetadataPositiveInteger(
        task.metadata?.dailyLimit ??
          task.metadata?.wechat_contact_add_daily_limit,
        targets.length,
        50,
      );
      const minIntervalSeconds = this.readMetadataPositiveInteger(
        task.metadata?.minIntervalSeconds ??
          task.metadata?.wechat_contact_add_min_interval_seconds,
        180,
        86400,
      );
      const maxIntervalSeconds = Math.max(
        minIntervalSeconds,
        this.readMetadataPositiveInteger(
          task.metadata?.maxIntervalSeconds ??
            task.metadata?.wechat_contact_add_max_interval_seconds,
          36000,
          86400,
        ),
      );
      const remarkStrategy =
        this.optionalTrimmedText(task.metadata?.remarkStrategy) ||
        this.optionalTrimmedText(
          task.metadata?.wechat_contact_add_remark_strategy,
        ) ||
        'none';
      const remarkContent =
        this.optionalTrimmedText(task.metadata?.remarkContent) ||
        this.optionalTrimmedText(
          task.metadata?.wechat_contact_add_remark_content,
        ) ||
        '';
      const skippedTargets = targets.filter((target) => blacklist.has(target));
      const allowedTargets = targets.filter((target) => !blacklist.has(target));
      const limitedTargets = allowedTargets.slice(
        0,
        Math.min(dailyLimit, allowedTargets.length),
      );
      const pendingTargets = allowedTargets.slice(limitedTargets.length);
      if (!limitedTargets.length) {
        throw new Error('加好友目标都在黑名单或超过本次上限，不能继续执行。');
      }
      const results: ApprovedWechatTargetResult[] = [];
      const failedTargets: Array<{ targetName: string; reason: string }> = [];
      for (let index = 0; index < limitedTargets.length; index += 1) {
        const target = limitedTargets[index];
        try {
          const result = await this.runWechatContactCommand(
            'wechat-contact-add',
            target,
            task.replyText,
            'auto-send',
            {
              remarkStrategy,
              remarkContent,
            },
          );
          this.assertWechatDesktopResultProof({
            taskType: task.type,
            target,
            expectedText: task.replyText,
            result,
          });
          results.push({
            target,
            ok: true,
            message: `好友申请已发送：${target}`,
            screenshotPath: result.screenshotPath,
            result,
          });
        } catch (error) {
          const desktopError = this.toWechatDesktopCommandError(error);
          const reason = error instanceof Error ? error.message : String(error);
          if (this.isWechatAccountProtectionBlocker(reason)) {
            throw error;
          }
          failedTargets.push({ targetName: target, reason });
          results.push({
            target,
            ok: false,
            message: reason,
            screenshotPath: desktopError?.result.screenshotPath,
            result: desktopError?.result,
          });
        }
        if (index < limitedTargets.length - 1) {
          const intervalSeconds = Math.min(
            maxIntervalSeconds,
            Math.max(minIntervalSeconds, minIntervalSeconds),
          );
          await this.sleep(intervalSeconds * 1000);
        }
      }
      const completedTargets = results
        .filter((item) => item.ok)
        .map((item) => item.target);
      if (!completedTargets.length) {
        const firstFailure = failedTargets[0]?.reason;
        const firstFailureResult = results.find((item) => item.result)?.result;
        const message = firstFailure
          ? `微信好友申请没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。${firstFailure}`
          : '微信好友申请没有任何对象处理成功。';
        if (
          firstFailure &&
          failedTargets.every((target) =>
            this.isWechatNoTargetMessage(target.reason),
          )
        ) {
          throw new WechatDesktopCommandError(message, firstFailureResult);
        }
        throw new Error(message);
      }
      const screenshotPath = results.find(
        (item) => item.ok && item.screenshotPath,
      )?.screenshotPath;
      return {
        ok: true,
        message: `微信好友申请已发送 ${completedTargets.length}/${targets.length} 个对象，失败 ${failedTargets.length} 个，跳过 ${skippedTargets.length} 个，待执行 ${pendingTargets.length} 个。`,
        screenshotPath,
        completedTargets,
        failedTargets,
        skippedTargets,
        pendingTargets,
        results,
        readbackText: [
          this.buildApprovedWechatReadback('自动加好友', results),
          `计划统计：完成 ${completedTargets.length}，失败 ${failedTargets.length}，跳过 ${skippedTargets.length}，待执行 ${pendingTargets.length}，每日上限 ${dailyLimit}，间隔 ${minIntervalSeconds}-${maxIntervalSeconds} 秒。`,
        ].join('；'),
      };
    }

    if (task.type === 'wechat-moments-publish') {
      const details = this.readMomentsPublishDetails(task);
      const plan = this.readMomentsPlanState(
        task.metadata,
        details.length || 1,
      );
      this.assertMomentsScheduleReady(plan);
      if (plan.remainingToday <= 0) {
        throw new Error(
          `朋友圈发布今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
        );
      }
      const executionTime = Date.now();
      const dueDetails = details.filter((detail) => {
        if (!detail.scheduledPublishTime) return true;
        const scheduledAt = Date.parse(detail.scheduledPublishTime);
        return !Number.isFinite(scheduledAt) || scheduledAt <= executionTime;
      });
      const executableDetails = dueDetails.slice(0, plan.remainingToday);
      const pendingTargets = details
        .filter((detail) => !executableDetails.includes(detail))
        .map((detail) => detail.targetName);
      if (!executableDetails.length) {
        throw new Error('朋友圈明细还未到执行时间，当前没有发布。');
      }
      const results: ApprovedWechatTargetResult[] = [];
      const failedTargets: Array<{ targetName: string; reason: string }> = [];
      for (const detail of executableDetails) {
        if (!detail.content || !detail.attachments.length) {
          failedTargets.push({
            targetName: detail.targetName,
            reason: '缺少朋友圈文案或媒体文件路径。',
          });
          continue;
        }
        try {
          this.assertMomentsVisibilityExecutable(
            detail.visibility,
            detail.visibilityLabel,
          );
          const result = await this.runWechatDesktopCommand(
            'wechat-moments-publish',
            [
              detail.content,
              'auto-send',
              detail.attachments.join('\n'),
              detail.additionalComment,
              detail.visibility,
            ],
            detail.targetName,
            150000,
          );
          this.assertWechatDesktopResultProof({
            taskType: task.type,
            target: detail.targetName,
            expectedText: detail.content,
            result,
          });
          results.push({
            target: detail.targetName,
            ok: true,
            message: `朋友圈已发布：${detail.targetName}`,
            screenshotPath: result.screenshotPath,
            result,
          });
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          if (this.isWechatAccountProtectionBlocker(failure)) {
            throw error;
          }
          failedTargets.push({
            targetName: detail.targetName,
            reason: failure,
          });
        }
      }
      if (!results.length) {
        const firstFailure = failedTargets[0]?.reason;
        throw new Error(
          firstFailure
            ? `朋友圈发布没有任何明细成功：${firstFailure}`
            : '朋友圈发布没有任何明细成功。',
        );
      }
      const screenshotPath = results.find(
        (item) => item.screenshotPath,
      )?.screenshotPath;
      return {
        ok: true,
        message: `朋友圈已发布 ${results.length}/${details.length} 条${failedTargets.length ? `，${failedTargets.length} 条失败待恢复` : ''}。${plan.recordSummary ? `记录摘要：${plan.recordSummary}` : ''}`,
        screenshotPath,
        completedTargets: results.map((item) => item.target),
        failedTargets,
        skippedTargets: [],
        pendingTargets,
        results,
        readbackText: [
          this.buildApprovedWechatReadback('微信朋友圈', results),
          this.buildMomentsPlanReadback(plan),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    if (task.type === 'wechat-moments-marketing') {
      const contacts =
        this.readMetadataStringList(
          task.metadata?.contacts ??
            task.metadata?.wechat_moments_marketing_contacts,
          [],
          100,
        ) || [];
      const marketingMode =
        this.optionalTrimmedText(
          task.metadata?.wechat_moments_marketing_mode,
        ) ||
        this.optionalTrimmedText(task.metadata?.marketingMode) ||
        (contacts.length ? 'targeted' : 'random');
      const targetedContacts = marketingMode === 'targeted' ? contacts : [];
      const targetCommentMap = this.readMetadataTargetCommentMap(
        task.metadata?.targetComments ??
          task.metadata?.wechat_moments_marketing_target_comments,
      );
      const batchTargetMap = new Map(
        (task.batchTargets || [])
          .map(
            (target) =>
              [
                target.targetName,
                this.optionalTrimmedText(target.replyText),
              ] as const,
          )
          .filter((entry): entry is readonly [string, string] =>
            Boolean(entry[0] && entry[1]),
          ),
      );
      const randomBrowseCount = this.readMetadataPositiveInteger(
        task.metadata?.randomBrowseCount ??
          task.metadata?.wechat_moments_marketing_random_browse_count,
        0,
        100,
      );
      const batchTargets = task.batchTargets?.length
        ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
        : [];
      const fallbackRandomTargets =
        randomBrowseCount > 0
          ? Array.from(
              { length: randomBrowseCount },
              (_, index) => `朋友圈第 ${index + 1} 条`,
            )
          : [];
      const targets = targetedContacts.length
        ? targetedContacts
        : batchTargets.length
          ? batchTargets
          : fallbackRandomTargets.length
            ? fallbackRandomTargets
            : [task.targetName || '朋友圈第 1 条'].filter(Boolean);
      const dailyLimit = this.readMetadataPositiveInteger(
        task.metadata?.dailyViewLimit ??
          task.metadata?.wechat_moments_marketing_daily_limit,
        targets.length,
        100,
      );
      const plan = this.readMomentsPlanState(task.metadata, dailyLimit);
      this.assertMomentsScheduleReady(plan);
      if (plan.autoLike !== undefined || plan.autoComment !== undefined) {
        task.metadata = {
          ...(task.metadata || {}),
          actions: {
            like: plan.autoLike !== false,
            comment: plan.autoComment !== false,
          },
          wechat_moments_marketing_actions: {
            like: plan.autoLike !== false,
            comment: plan.autoComment !== false,
          },
        };
      }
      const executableLimit = Math.min(dailyLimit, plan.remainingToday);
      if (executableLimit <= 0) {
        throw new Error(
          `朋友圈营销今日额度已用完：${plan.dailyPublished}/${plan.dailyQuota}。`,
        );
      }
      const limitedTargets = targets.slice(
        0,
        Math.min(executableLimit, targets.length),
      );
      const overLimitTargets = targets.filter(
        (target) => !limitedTargets.includes(target),
      );
      const actions = this.readMomentsMarketingActions(
        task.metadata?.actions ??
          task.metadata?.wechat_moments_marketing_actions,
      );
      const actionKind =
        actions.like && actions.comment
          ? 'like-comment'
          : actions.comment
            ? 'comment'
            : actions.like
              ? 'like'
              : 'browse';
      const commentMode = this.optionalTrimmedText(
        task.metadata?.commentMode ??
          task.metadata?.wechat_moments_marketing_comment_mode,
      );
      const fixedComment = this.optionalTrimmedText(
        task.metadata?.fixedComment ??
          task.metadata?.wechat_moments_marketing_fixed_comment,
      );
      const content = this.optionalTrimmedText(
        task.metadata?.content ??
          task.metadata?.wechat_moments_marketing_content,
      );
      const results: ApprovedWechatTargetResult[] = [];
      const failedTargets: string[] = [];
      const failedTargetResults: Array<{ targetName: string; reason: string }> =
        [];
      const failureMessages: string[] = [];
      for (const [index, target] of limitedTargets.entries()) {
        const targetComment =
          targetCommentMap.get(target) ||
          batchTargetMap.get(target) ||
          (commentMode === 'fixed' ? fixedComment : '') ||
          content ||
          task.replyText ||
          '';
        if (actions.comment && !targetComment) {
          const failure = '缺少朋友圈评论内容，不能继续执行。';
          failedTargets.push(target);
          failedTargetResults.push({ targetName: target, reason: failure });
          failureMessages.push(`${target}: ${failure}`);
          continue;
        }
        try {
          const result = await this.runWechatDesktopCommand(
            'wechat-moments-marketing',
            [
              target,
              actions.comment ? targetComment : '',
              'auto-send',
              actionKind,
              String(index + 1),
            ],
            target,
            120000,
          );
          this.assertWechatDesktopResultProof({
            taskType: task.type,
            target,
            expectedText: actions.comment ? targetComment : '',
            result,
          });
          results.push({
            target,
            ok: true,
            message: `朋友圈营销已处理：${target}`,
            screenshotPath: result.screenshotPath,
            result,
          });
        } catch (error) {
          const failure =
            error instanceof Error ? error.message : String(error);
          if (this.isWechatAccountProtectionBlocker(failure)) {
            throw error;
          }
          failedTargets.push(target);
          failedTargetResults.push({ targetName: target, reason: failure });
          failureMessages.push(`${target}: ${failure}`);
        }
      }
      if (!results.length) {
        const firstFailure = failureMessages[0];
        throw new Error(
          firstFailure
            ? `朋友圈营销没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。${firstFailure}`
            : failedTargets.length
              ? `朋友圈营销没有任何对象处理成功，${failedTargets.length} 个对象进入待恢复。`
              : '缺少朋友圈评论内容，不能继续执行。',
        );
      }
      const screenshotPath = results.find(
        (item) => item.screenshotPath,
      )?.screenshotPath;
      return {
        ok: true,
        message: `朋友圈营销已处理 ${results.length}/${targets.length} 个对象${failedTargets.length ? `，${failedTargets.length} 个对象待恢复` : ''}。${plan.recordSummary ? `记录摘要：${plan.recordSummary}` : ''}`,
        screenshotPath,
        completedTargets: results.map((item) => item.target),
        failedTargets: failedTargetResults,
        skippedTargets: overLimitTargets,
        results,
        readbackText: [
          this.buildApprovedWechatReadback('朋友圈营销', results),
          this.buildMomentsPlanReadback(plan),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    const targets = task.batchTargets?.length
      ? task.batchTargets.map((target) => target.targetName).filter(Boolean)
      : [task.targetName].filter(Boolean);
    if (
      !targets.length ||
      (task.type !== 'wechat-reply-draft' && !task.replyText?.trim())
    ) {
      throw new Error('缺少微信目标或发送内容，不能继续执行。');
    }

    const dailyLimit = this.readMetadataPositiveInteger(
      task.metadata?.dailyLimit,
      targets.length,
      200,
    );
    const intervalSeconds = this.readMetadataPositiveInteger(
      task.metadata?.intervalSeconds,
      0,
      3600,
    );
    const limitedTargets =
      task.type === 'wechat-group-broadcast'
        ? targets.slice(0, Math.min(dailyLimit, targets.length))
        : targets.slice(0, 1);
    if (task.type === 'wechat-reply-draft') {
      const target = limitedTargets[0];
      const explicitReplyText =
        this.optionalTrimmedText(task.metadata?.wechat_reply_draft) ||
        this.optionalTrimmedText(task.metadata?.replyText) ||
        this.optionalTrimmedText(task.replyText);
      let sourceText = this.optionalTrimmedText(task.sourceText);
      let replyText = explicitReplyText;
      let replyGeneratedBy: InteractionReplyGeneratedBy =
        task.replyGeneratedBy || 'fallback';

      if (!replyText) {
        const readResult = await this.runWechatDesktopCommand(
          'wechat-live-auto-reply',
          [target, 'read-only'],
          target,
        );
        sourceText = this.optionalTrimmedText(
          readResult.readText || readResult.sourceText,
        );
        if (!sourceText) {
          throw new Error('未读取到当前微信会话原文，不能生成商用回复。');
        }
        const fallbackReply = this.buildReplyFromRule(sourceText, {
          targetName: target,
          accountName: task.accountName,
        });
        const aiReply = await this.tryGenerateInteractionReplyWithAi(
          sourceText,
          {
            targetName: target,
            accountName: task.accountName,
            fallbackReply,
          },
        );
        replyText = aiReply || fallbackReply;
        replyGeneratedBy = aiReply ? 'ai' : 'fallback';
      }

      if (!replyText) {
        throw new Error('缺少微信回复内容，不能继续执行。');
      }

      const sendResult = await this.autoUploadService.sendWechatReply({
        targetText: target,
        replyText,
      });
      const screenshotPath =
        sendResult.evidence?.path || sendResult.evidence?.value;
      if (sendResult.sent !== true || sendResult.status !== 'sent') {
        throw new WechatDesktopCommandError(
          sendResult.message || '微信自动发送失败。',
          {
            screenshotPath,
            target: sendResult.targetText || target,
            reply: sendResult.replyText || replyText,
            readText: sendResult.readbackText,
            sourceText,
            status: sendResult.status,
            message: sendResult.message,
          },
        );
      }
      const result: WechatDesktopCommandResult = {
        screenshotPath,
        target: sendResult.targetText || target,
        contact: sendResult.targetText || target,
        reply: sendResult.replyText || replyText,
        readText: sendResult.readbackText || replyText,
        sourceText,
        generatedBy: replyGeneratedBy,
        status: sendResult.status,
        message: sendResult.message,
        mode: 'auto-send',
      };
      const completedTargets = [target];
      return {
        ok: true,
        message: `微信消息已发送给 ${target}。`,
        screenshotPath,
        completedTargets,
        results: [
          {
            target,
            ok: true,
            message: `微信消息已发送：${target}`,
            screenshotPath,
            result: {
              ...result,
              reply: replyText,
              readText: sourceText,
              sourceText,
              generatedBy: replyGeneratedBy,
            },
          },
        ],
        readbackText: this.buildWechatDesktopReadback(
          '微信消息',
          target,
          replyText,
          result,
        ),
        sourceText,
        replyText,
        replyGeneratedBy,
      };
    }
    const results: ApprovedWechatTargetResult[] = [];
    const groupTargetMessages =
      task.type === 'wechat-group-broadcast'
        ? this.readWechatTargetMessageMap(task)
        : new Map<string, string>();
    const groupAttachmentPaths =
      task.type === 'wechat-group-broadcast'
        ? this.readMetadataStringList(
            task.metadata?.massSendFiles ??
              task.metadata?.wechat_mass_send_files,
            [],
            20,
          )
        : [];
    for (const [index, target] of limitedTargets.entries()) {
      const targetMessage = groupTargetMessages.get(target) || task.replyText;
      if (!targetMessage?.trim()) {
        throw new Error(`缺少 ${target} 的群发内容，不能继续执行。`);
      }
      const result = await this.runWechatContactCommand(
        'wechat-auto-reply',
        target,
        targetMessage,
        'auto-send',
        { attachmentPaths: groupAttachmentPaths },
      );
      this.assertWechatDesktopResultProof({
        taskType: task.type,
        target,
        expectedText: targetMessage,
        result,
      });
      results.push({
        target,
        ok: true,
        message: `微信消息已发送：${target}`,
        screenshotPath: result.screenshotPath,
        result,
      });
      if (
        task.type === 'wechat-group-broadcast' &&
        intervalSeconds > 0 &&
        index < limitedTargets.length - 1
      ) {
        await this.delay(intervalSeconds * 1000);
      }
    }
    const screenshotPath = results.find(
      (item) => item.screenshotPath,
    )?.screenshotPath;
    if (task.type === 'wechat-group-broadcast') {
      return {
        ok: true,
        message: `微信群发已发送 ${results.length}/${targets.length} 个对象。`,
        screenshotPath,
        completedTargets: limitedTargets,
        skippedTargets: targets.filter(
          (target) => !limitedTargets.includes(target),
        ),
        results,
        readbackText: this.buildApprovedWechatReadback('微信群发', results),
      };
    }
    return {
      ok: true,
      message: `微信消息已发送给 ${limitedTargets[0]}。`,
      screenshotPath,
      completedTargets: limitedTargets,
      results,
      readbackText: this.buildApprovedWechatReadback('微信消息', results),
    };
  }

  private runWechatContactCommand(
    command: 'wechat-auto-reply' | 'wechat-contact-add',
    target: string,
    message: string,
    mode: 'auto-send' | 'approval',
    options?: {
      remarkStrategy?: string;
      remarkContent?: string;
      attachmentPaths?: string[];
    },
  ): Promise<{ screenshotPath?: string }> {
    const extraArgs =
      command === 'wechat-contact-add'
        ? [options?.remarkStrategy || 'none', options?.remarkContent || '']
        : [options?.attachmentPaths?.join('\n') || ''];
    return this.runWechatDesktopCommand(
      command,
      [target, message, mode, ...extraArgs],
      target,
    );
  }

  private runWechatDesktopCommand(
    command:
      | 'wechat-auto-reply'
      | 'wechat-contact-add'
      | 'wechat-live-auto-reply'
      | 'wechat-moments-publish'
      | 'wechat-moments-marketing',
    args: string[],
    target: string,
    timeoutMs = 90000,
  ): Promise<WechatDesktopCommandResult> {
    return new Promise((resolve, reject) => {
      const configuredRoot = this.getMacWechatCommandRoot();
      const resolvedCommand =
        [
          configuredRoot ? join(configuredRoot, command) : '',
          join(homedir(), '.local', 'bin', command),
          join('/opt/homebrew/bin', command),
          join('/usr/local/bin', command),
        ].find((candidate) => candidate && existsSync(candidate)) || command;
      const child = spawn(resolvedCommand, args, {
        env: {
          ...process.env,
          AI_CONTENT_CLICLICK_PATH:
            process.env.AI_CONTENT_CLICLICK_PATH ||
            (configuredRoot ? join(configuredRoot, 'cliclick') : ''),
          AI_CONTENT_NODE_PATH:
            process.env.AI_CONTENT_NODE_PATH || process.execPath,
          PATH: [
            configuredRoot,
            process.env.PATH || '',
            join(homedir(), '.local', 'bin'),
            '/opt/homebrew/bin',
            '/usr/local/bin',
          ]
            .filter(Boolean)
            .join(':'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${command} 执行超时：${target}`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const output = stdout.trim();
          if (!output) {
            resolve({});
            return;
          }
          try {
            resolve(this.parseWechatDesktopCommandOutput(output, command));
          } catch (error) {
            if (error instanceof SyntaxError) {
              resolve({});
            } else {
              reject(error);
            }
          }
          return;
        }
        reject(
          new Error((stderr || stdout || `${command} 退出码 ${code}`).trim()),
        );
      });
    });
  }

  private parseWechatDesktopCommandOutput(
    output: string,
    command: string,
  ): WechatDesktopCommandResult {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const ok = parsed.ok;
    const status = String(parsed.status || '').toLowerCase();
    if (
      ok === false ||
      [
        'failed',
        'error',
        'blocked',
        'captcha_required',
        'risk_blocked',
        'send_failed',
        'draft_not_ready',
        'not_ready',
        'no_target',
      ].includes(status)
    ) {
      const message =
        this.optionalTrimmedText(parsed.error) ||
        this.optionalTrimmedText(parsed.message) ||
        this.optionalTrimmedText(parsed.reason) ||
        `${command} 返回失败`;
      throw new WechatDesktopCommandError(
        message,
        this.toWechatDesktopCommandResult(parsed),
      );
    }
    return this.toWechatDesktopCommandResult(parsed);
  }

  private assertWechatDesktopResultProof(input: {
    taskType: InteractionTaskType;
    target: string;
    expectedText?: string;
    result: WechatDesktopCommandResult;
  }) {
    const screenshotPath = this.optionalTrimmedText(
      input.result.screenshotPath,
    );
    const targetText = this.optionalTrimmedText(input.target);
    const expectedText = this.optionalTrimmedText(input.expectedText);
    const syntheticMomentsTarget =
      input.taskType === 'wechat-moments-marketing' &&
      Boolean(targetText) &&
      /^朋友圈第\s*\d+\s*条$/.test(targetText || '');
    const proofText = [
      input.result.contact,
      input.result.target,
      input.result.reply,
      input.result.readText,
      input.result.message,
      input.result.status,
    ]
      .filter(Boolean)
      .join('\n');

    if (!screenshotPath) {
      throw new WechatDesktopCommandError(
        '微信桌面执行缺少截图证据，不能算商用完成。',
        input.result,
      );
    }
    if (!proofText.trim()) {
      throw new WechatDesktopCommandError(
        '微信桌面执行缺少目标/回读文本，不能算商用完成。',
        input.result,
      );
    }
    if (
      targetText &&
      input.taskType !== 'wechat-moments-publish' &&
      !syntheticMomentsTarget &&
      !proofText.includes(targetText)
    ) {
      throw new WechatDesktopCommandError(
        `微信桌面执行结果没有回读目标“${targetText}”，不能算商用完成。`,
        input.result,
      );
    }
    if (
      expectedText &&
      input.taskType !== 'wechat-contact-add' &&
      !proofText.includes(expectedText)
    ) {
      throw new WechatDesktopCommandError(
        '微信桌面执行结果没有回读待发送/待发布文本，不能算商用完成。',
        input.result,
      );
    }
  }

  private toWechatDesktopCommandResult(
    parsed: Record<string, unknown>,
  ): WechatDesktopCommandResult {
    return {
      screenshotPath: this.optionalTrimmedText(
        parsed.screenshotPath ?? parsed.screenshot_path,
      ),
      reply: this.optionalTrimmedText(parsed.reply),
      readText: this.optionalTrimmedText(parsed.readText ?? parsed.read_text),
      sourceText: this.optionalTrimmedText(
        parsed.sourceText ?? parsed.source_text,
      ),
      generatedBy: this.normalizeReplyGeneratedBy(
        parsed.generatedBy ??
          parsed.generated_by ??
          parsed.replyGeneratedBy ??
          parsed.reply_generated_by,
      ),
      message: this.optionalTrimmedText(parsed.message),
      contact: this.optionalTrimmedText(parsed.contact),
      target: this.optionalTrimmedText(parsed.target),
      currentWechatId: this.optionalTrimmedText(
        parsed.currentWechatId ?? parsed.current_wechat_id,
      ),
      plannedWechatId: this.optionalTrimmedText(
        parsed.plannedWechatId ?? parsed.planned_wechat_id,
      ),
      mode: this.optionalTrimmedText(parsed.mode),
      status: this.optionalTrimmedText(parsed.status),
      errorCode: this.optionalTrimmedText(
        parsed.errorCode ?? parsed.error_code,
      ),
      nextAction: this.optionalTrimmedText(
        parsed.nextAction ?? parsed.next_action,
      ),
    };
  }

  private buildApprovedWechatReadback(
    label: string,
    results: ApprovedWechatTargetResult[],
  ) {
    return results
      .filter((item) => item.ok)
      .map((item) =>
        this.buildWechatDesktopReadback(
          label,
          item.target,
          item.result?.reply || item.result?.readText || item.message,
          item.result,
        ),
      )
      .filter(Boolean)
      .join('\n');
  }

  private buildWechatDesktopReadback(
    label: string,
    target: string,
    text: string,
    result?: WechatDesktopCommandResult,
  ) {
    const actualTarget = result?.contact || result?.target || target;
    const modeLabel =
      result?.mode === 'auto-send'
        ? '已自动执行'
        : result?.mode === 'approval'
          ? '已写入并等待继续执行'
          : '已处理';
    const body = result?.readText || result?.reply || result?.message || text;
    return `${label}${modeLabel}：${actualTarget} / ${body}`;
  }

  private readMetadataPositiveInteger(
    value: unknown,
    fallback: number,
    max: number,
  ) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return Math.min(Math.floor(numeric), max);
  }

  private readMetadataStringList(
    value: unknown,
    fallback: string[],
    max: number,
  ) {
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, max);
      return normalized.length ? normalized : fallback;
    }
    if (typeof value === 'string') {
      const normalized = value
        .split(/[\n,，、]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, max);
      return normalized.length ? normalized : fallback;
    }
    return fallback;
  }

  private readMetadataTargetCommentMap(value: unknown) {
    const map = new Map<string, string>();
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const targetName = this.optionalTrimmedText(
          record.targetName ?? record.target ?? record.name,
        );
        const commentText = this.optionalTrimmedText(
          record.commentText ?? record.replyText ?? record.comment,
        );
        if (targetName && commentText) {
          map.set(targetName, commentText);
        }
      }
      return map;
    }
    if (value && typeof value === 'object') {
      for (const [targetName, commentText] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const normalizedTarget = targetName.trim();
        const normalizedComment = this.optionalTrimmedText(commentText);
        if (normalizedTarget && normalizedComment) {
          map.set(normalizedTarget, normalizedComment);
        }
      }
    }
    return map;
  }

  private readWechatTargetMessageMap(task: InteractionTask) {
    const map = new Map<string, string>();
    for (const target of task.batchTargets || []) {
      const targetName = this.optionalTrimmedText(target.targetName);
      const message = this.optionalTrimmedText(target.replyText);
      if (targetName && message) map.set(targetName, message);
    }
    const metadataValue =
      task.metadata?.wechat_group_messages ??
      task.metadata?.wechat_mass_send_contents;
    if (!Array.isArray(metadataValue)) return map;
    for (const item of metadataValue) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const targetName = this.optionalTrimmedText(
        record.target ?? record.targetName ?? record.contact,
      );
      const message = this.optionalTrimmedText(
        record.message ?? record.sendContent ?? record.replyText,
      );
      if (targetName && message) map.set(targetName, message);
    }
    return map;
  }

  private readMomentsPublishDetails(task: InteractionTask) {
    const detailValue =
      task.metadata?.momentsDetails ?? task.metadata?.wechat_moments_details;
    const details: Array<{
      targetName: string;
      content: string;
      additionalComment: string;
      attachments: string[];
      scheduledPublishTime?: string;
      visibility: WechatMomentsVisibilityCode;
      visibilityLabel: string;
    }> = [];
    if (Array.isArray(detailValue)) {
      for (const [index, item] of detailValue.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          continue;
        }
        const record = item as Record<string, unknown>;
        const content = this.optionalTrimmedText(
          record.content ??
            record.sendContent ??
            record.replyText ??
            record.wechat_moments_content,
        );
        const attachments = this.readMetadataStringList(
          record.attachments ?? record.assetPaths ?? record.assetPath,
          [],
          9,
        );
        details.push({
          targetName:
            this.optionalTrimmedText(record.targetName) ||
            this.optionalTrimmedText(task.batchTargets?.[index]?.targetName) ||
            `朋友圈明细 ${index + 1}`,
          content: content || '',
          additionalComment:
            this.optionalTrimmedText(
              record.additionalComment ?? record.comment,
            ) || '',
          attachments,
          scheduledPublishTime: this.optionalTrimmedText(
            record.scheduledPublishTime ?? record.scheduledAt,
          ),
          visibility: this.normalizeMomentsVisibility(
            record.visibility ??
              record.wechat_moments_visibility ??
              task.metadata?.wechat_moments_visibility_code ??
              task.metadata?.wechat_moments_visibility,
          ),
          visibilityLabel:
            this.optionalTrimmedText(
              record.visibility ?? record.wechat_moments_visibility,
            ) ||
            this.optionalTrimmedText(
              task.metadata?.wechat_moments_visibility,
            ) ||
            '公开',
        });
      }
    }
    if (details.length) {
      return details;
    }
    const content =
      this.optionalTrimmedText(
        task.metadata?.content ?? task.metadata?.wechat_moments_content,
      ) ||
      this.optionalTrimmedText(task.replyText) ||
      '';
    const attachments = this.readMetadataStringList(
      task.metadata?.assetPaths ??
        task.metadata?.attachments ??
        task.metadata?.assetPath ??
        task.metadata?.wechat_moments_asset_path,
      [],
      9,
    );
    return [
      {
        targetName:
          this.optionalTrimmedText(task.batchTargets?.[0]?.targetName) ||
          task.targetName ||
          '朋友圈明细 1',
        content,
        additionalComment:
          this.optionalTrimmedText(
            task.metadata?.additionalComment ??
              task.metadata?.wechat_moments_additional_comment,
          ) || '',
        attachments,
        scheduledPublishTime: this.optionalTrimmedText(
          task.metadata?.scheduleStartTime ??
            task.metadata?.wechat_moments_schedule_start_time,
        ),
        visibility: this.normalizeMomentsVisibility(
          task.metadata?.wechat_moments_visibility_code ??
            task.metadata?.wechat_moments_visibility,
        ),
        visibilityLabel:
          this.optionalTrimmedText(task.metadata?.wechat_moments_visibility) ||
          '公开',
      },
    ];
  }

  private normalizeMomentsVisibility(
    value: unknown,
  ): WechatMomentsVisibilityCode {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    if (normalized === 'private' || normalized === '私密') return 'private';
    if (
      normalized === 'partial' ||
      normalized === '部分可见' ||
      normalized === '不给谁看'
    ) {
      return 'partial';
    }
    return 'public';
  }

  private assertMomentsVisibilityExecutable(
    visibility: WechatMomentsVisibilityCode,
    label: string,
  ) {
    if (visibility === 'public') return;
    throw new Error(
      `当前不能自动设置朋友圈可见范围「${label || visibility}」，本条没有发布。请改为公开可见或由人工发布。`,
    );
  }

  private isWechatAccountProtectionBlocker(message: string) {
    return /验证码|频繁|风险|账号异常|账号限制|操作过快|安全验证|稍后再试|被限制|登录过期|未登录|登录/.test(
      message,
    );
  }

  private toWechatDesktopCommandError(error: unknown) {
    if (error instanceof WechatDesktopCommandError) {
      return error;
    }
    if (
      error instanceof Error &&
      error.name === 'WechatDesktopCommandError' &&
      typeof (error as { result?: unknown }).result === 'object' &&
      (error as { result?: unknown }).result !== null
    ) {
      return error as WechatDesktopCommandError;
    }
    return null;
  }

  private isWechatNoTargetMessage(message: string) {
    return /未进入好友申请页面|没有找到可添加对象|目标已是联系人|已是联系人|不可添加|无可添加对象/.test(
      message,
    );
  }

  private readMomentsMarketingActions(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { like: true, comment: true };
    }
    const record = value as Record<string, unknown>;
    return {
      like: record.like !== false,
      comment: record.comment !== false,
    };
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  private collectRecentEvidenceEventIds(
    task: InteractionTask,
    eventIds: string[] = [],
  ) {
    return [
      ...new Set([
        ...eventIds.filter(Boolean),
        ...task.events
          .filter((event) => Boolean(event.evidence))
          .slice(-8)
          .map((event) => event.id),
      ]),
    ];
  }

  private normalizeStoredBatchTargets(task: InteractionTask) {
    if (!task.batchTargets?.length) {
      return;
    }

    task.batchTargets = task.batchTargets.map((target) => ({
      ...target,
      status: this.normalizeBatchTargetStatus(target.status),
      evidenceEventIds: Array.isArray(target.evidenceEventIds)
        ? target.evidenceEventIds.filter(Boolean)
        : undefined,
    }));
    task.batchSummary = this.buildBatchSummary(task.batchTargets);
  }

  private normalizeBatchTargetStatus(status: InteractionBatchTarget['status']) {
    const allowed: InteractionBatchTarget['status'][] = [
      'queued',
      'running',
      'waiting_confirmation',
      'completed',
      'failed',
      'skipped',
      'no_target',
    ];
    return allowed.includes(status) ? status : 'queued';
  }

  private buildBatchSummary(targets: InteractionBatchTarget[] = []) {
    return targets.reduce(
      (summary, target) => {
        summary.total += 1;
        if (target.status === 'queued') summary.queued += 1;
        if (target.status === 'running') summary.running += 1;
        if (target.status === 'waiting_confirmation')
          summary.waitingConfirmation += 1;
        if (target.status === 'completed') summary.completed += 1;
        if (target.status === 'failed') summary.failed += 1;
        if (target.status === 'skipped') summary.skipped += 1;
        if (target.status === 'no_target') summary.noTarget += 1;
        return summary;
      },
      {
        total: 0,
        queued: 0,
        running: 0,
        waitingConfirmation: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        noTarget: 0,
      },
    );
  }

  private normalizeStringList(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const normalized = value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 20);

    return normalized.length ? normalized : fallback;
  }

  private normalizeEditableStringList(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) {
      return fallback;
    }

    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  private normalizeRuleNumber(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(Math.round(number), max));
  }

  private isSendMode(value: unknown): value is InteractionSendMode {
    return (
      value === 'approval-send' ||
      value === 'draft-only' ||
      value === 'auto-send'
    );
  }

  private createApprovalRecord(
    task: InteractionTask,
    input: InteractionApprovalInput,
  ): InteractionApprovalRecord {
    const strictConfirmationRequired = this.isLiveExecutorTask(task.type);
    const confirmedChecklistKeys = (task.riskChecklist || [])
      .filter((check) => !check.required || check.status === 'ready')
      .map((check) => check.key);

    return {
      operator: input.operator?.trim() || '当前登录用户',
      note: input.note?.trim() || undefined,
      currentWindowConfirmed:
        task.type === 'wechat-reply-draft' ||
        task.type === 'wechat-group-broadcast' ||
        task.type === 'wechat-contact-add' ||
        task.type === 'wechat-moments-publish' ||
        task.type === 'wechat-moments-marketing'
          ? input.currentWindowConfirmed === true
          : input.currentWindowConfirmed !== false,
      contactConfirmed:
        task.type === 'wechat-reply-draft'
          ? input.contactConfirmed === true
          : input.contactConfirmed,
      draftBeforeFillConfirmed:
        task.type === 'wechat-reply-draft'
          ? input.draftBeforeFillConfirmed === true
          : input.draftBeforeFillConfirmed,
      targetContact: input.targetContact?.trim() || undefined,
      targetConfirmed: strictConfirmationRequired
        ? input.targetConfirmed === true
        : input.targetConfirmed !== false,
      contentConfirmed: strictConfirmationRequired
        ? input.contentConfirmed === true
        : input.contentConfirmed !== false,
      checklistConfirmed: strictConfirmationRequired
        ? input.checklistConfirmed === true
        : input.checklistConfirmed,
      commercialPermissionConfirmed: strictConfirmationRequired
        ? input.commercialPermissionConfirmed === true
        : input.commercialPermissionConfirmed,
      misfireProtectionConfirmed: strictConfirmationRequired
        ? input.misfireProtectionConfirmed === true
        : input.misfireProtectionConfirmed,
      doubleConfirmationConfirmed: task.requiresDoubleConfirmation
        ? input.doubleConfirmationConfirmed === true
        : input.doubleConfirmationConfirmed,
      confirmedChecklistKeys,
      confirmedAt: new Date().toISOString(),
    };
  }

  private isLiveExecutorTask(type: InteractionTaskType) {
    return [
      'douyin-comment-reply',
      'douyin-direct-message-reply',
      'wechat-channel-comment-reply',
      'wechat-channel-direct-message-reply',
      'wechat-reply-draft',
      'wechat-friend-accept',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ].includes(type);
  }

  private requiresRealAccount(type: InteractionTaskType) {
    return [
      'douyin-comment-reply',
      'douyin-direct-message-reply',
      'wechat-channel-comment-reply',
      'wechat-channel-direct-message-reply',
    ].includes(type);
  }

  private hasNoInteractionTarget(task: InteractionTask) {
    const emptyMarkers = [
      '无对象',
      '没有对象',
      '暂无对象',
      '无客户',
      '暂无客户',
      '无群',
      '暂无群',
      '无评论',
      '无私信',
      '无素材',
      'empty',
      'none',
      'no target',
    ];
    const haystack = [
      task.targetName,
      task.sourceText,
      task.replyText,
      ...(task.batchTargets || []).flatMap((target) => [
        target.targetName,
        target.sourceText,
        target.replyText,
      ]),
    ]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    return emptyMarkers.some((marker) =>
      haystack.includes(marker.toLowerCase()),
    );
  }

  private defaultNextActionForStatus(status: InteractionTaskStatus) {
    const actions: Record<InteractionTaskStatus, string> = {
      queued: '等待本地引擎领取任务。',
      running: '继续观察执行记录和证据回放。',
      paused: '任务已暂停；如需继续，请创建重试任务。',
      blocked: '任务已阻断；请查看失败原因、阶段日志和证据后重试。',
      waiting_for_send_confirmation:
        '请在任务卡或待我确认中核对目标、内容和当前窗口。',
      completed: '可回到执行记录查看结果，或导出诊断包留存。',
      failed: '请查看失败原因、阶段日志和证据后重试。',
      skipped: '任务已跳过；如需继续，请创建重试任务。',
      no_target: '无可处理对象；补充对象后重新创建任务。',
    };
    return actions[status];
  }

  private previewEvidenceValue(value: string, maxLength = 120) {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength)}...`
      : normalized;
  }

  private taskNeedsBrowserEvidence(task: InteractionTask) {
    return (
      task.executionMode === 'browser-assisted' &&
      !this.isDesktopInteractionTask(task.type)
    );
  }

  private taskNeedsDesktopEvidence(task: InteractionTask) {
    return this.isDesktopInteractionTask(task.type);
  }

  private agentSessionNeedsBrowserEvidence(session: AgentSession) {
    return ['browser', 'mixed', 'remote'].includes(session.executionScope);
  }

  private agentSessionNeedsDesktopEvidence(session: AgentSession) {
    return ['desktop', 'mixed', 'remote'].includes(session.executionScope);
  }

  private resolveTaskSendMode(
    type: InteractionTaskType,
    requested?: InteractionSendMode,
  ): InteractionSendMode {
    const sendMode = requested || this.replyRule.defaultSendMode;
    return sendMode;
  }

  private resolveInteractionRisk(
    type: InteractionTaskType,
    sendMode: InteractionSendMode,
    sourceText: string,
    replyText: string,
  ): AgentRiskLevel {
    const content = `${sourceText}\n${replyText}`;
    if (sendMode === 'auto-send' || this.hasDestructiveIntent(content)) {
      return 'high';
    }
    if (this.isDesktopInteractionTask(type) || sendMode === 'approval-send') {
      return 'medium';
    }
    return 'low';
  }

  private isDesktopInteractionTask(type: InteractionTaskType) {
    return [
      'wechat-reply-draft',
      'wechat-friend-accept',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
    ].includes(type);
  }

  private resolveCustomerReplyReviewReason(sourceText?: string | null) {
    const content = sourceText || '';
    if (
      /退款|退货|售后|坏了|破损|发错|没收到|少发|漏发|质量|订单|物流|快递|发票|赔付|赔偿/.test(
        content,
      )
    ) {
      return '售后/退款';
    }
    if (
      /投诉|差评|不满意|垃圾|骗子|曝光|举报|拉黑|太差|生气|坑人|维权/.test(
        content,
      )
    ) {
      return '投诉/差评';
    }
    if (/转账|私下转账|支付|扣费|定金|保证金|返现|垫付/.test(content)) {
      return '付款/转账';
    }
    if (
      /治疗|疗效|治好|诊断|法律|合同纠纷|贷款|保险|投资|签证|政务/.test(content)
    ) {
      return '高风险合规问题';
    }
    return null;
  }

  private hasDestructiveIntent(content: string) {
    return /(删除|移除|清空|撤回|拉黑|投诉|退款|转账|支付|扣费|购买|群发|发布|发送|提交)/.test(
      content,
    );
  }

  private createSafetyBoundary(input: {
    riskLevel: AgentRiskLevel;
    requestedSendMode?: InteractionSendMode;
    sendMode: InteractionSendMode;
    hasDestructiveIntent: boolean;
    commercialExecutionRequested?: boolean;
    callerCommercialAllowed?: boolean;
  }): LocalEngineSafetyBoundary {
    const planMode =
      this.allowLocalPlanBypass() || input.callerCommercialAllowed === true
        ? 'commercial'
        : 'trial';
    const commercialExecutionAllowed =
      this.allowLocalPlanBypass() || input.callerCommercialAllowed === true;
    const trialLimited = planMode === 'trial';
    const blockedAutoSend =
      input.requestedSendMode === 'auto-send' && input.sendMode !== 'auto-send';
    const autoSendAuthorized =
      input.sendMode === 'auto-send' && commercialExecutionAllowed;
    const blockedActions = [
      blockedAutoSend ? 'auto-send' : '',
      // 只有在用户没明确授权 auto-send 时，才把破坏性内容当成 blocker
      !autoSendAuthorized && input.hasDestructiveIntent
        ? 'destructive-action'
        : '',
    ].filter(Boolean);
    const permissionStatus: LocalEnginePermissionStatus = trialLimited
      ? 'trial_limited'
      : commercialExecutionAllowed
        ? blockedActions.length
          ? 'approval_required'
          : 'allowed'
        : 'blocked';

    return {
      planMode,
      trialLimited,
      commercialExecutionAllowed,
      permissionStatus,
      requestedCommercialExecution: input.commercialExecutionRequested === true,
      message: blockedAutoSend
        ? '当前能力或权限未允许自动发送，任务会降级为确认后发送。'
        : permissionStatus === 'blocked'
          ? '当前未开启正式商用可执行权限，只允许草稿、预检和人工确认态。'
          : permissionStatus === 'allowed'
            ? '正式商用可执行权限已开启，低风险动作可进入执行队列。'
            : input.riskLevel === 'high'
              ? '高风险互动动作需要通过商用权限、目标回读和现场校验。确认后发送模式会等待用户确认；自动发送模式校验通过才会发出。'
              : '当前任务按试用安全线执行；自动发送需要商用权限和真实执行能力通过。',
      allowedActions:
        input.sendMode === 'auto-send'
          ? ['draft', 'preflight', 'live-send']
          : ['draft', 'preflight', 'approval-gated-run'],
      blockedActions,
    };
  }

  private createMisfireProtection(
    type: InteractionTaskType,
    riskLevel: AgentRiskLevel,
  ): LocalEngineMisfireProtection {
    const sendProtected =
      riskLevel !== 'low' || this.isDesktopInteractionTask(type);
    const deleteProtected = riskLevel === 'high';
    return {
      sendProtected,
      deleteProtected,
      targetLockRequired: true,
      contentPreviewRequired: true,
      destructiveActionBlocked: deleteProtected,
      warning: deleteProtected
        ? '检测到高风险动作，删除、群发、支付等动作不会自动执行。'
        : type === 'douyin-comment-reply' ||
            type === 'douyin-direct-message-reply'
          ? '浏览器互动自动发送必须通过目标回读、输入框回读、发送按钮识别和发送后证据校验。'
          : sendProtected
            ? '发送动作已启用人工确认和目标回读保护。'
            : '低风险草稿任务仍会记录目标和内容证据。',
    };
  }

  private createInteractionRiskChecklist(input: {
    type: InteractionTaskType;
    riskLevel: AgentRiskLevel;
    sendMode: InteractionSendMode;
    safetyBoundary: LocalEngineSafetyBoundary;
    misfireProtection: LocalEngineMisfireProtection;
    riskPolicy?: LocalEngineRiskPolicy;
  }): LocalEngineSafetyCheck[] {
    return [
      {
        key: 'target',
        label: '确认目标账号/对象正确',
        required: true,
        category: 'target',
        status: input.sendMode === 'auto-send' ? 'ready' : 'warning',
        hint: this.isDesktopInteractionTask(input.type)
          ? '微信草稿、群发、加好友或朋友圈动作会作用在当前桌面微信窗口。'
          : input.sendMode === 'auto-send'
            ? '自动发送前必须由执行器读取真实对象并锁定当前会话。'
            : '请确认本地浏览器账号和目标评论/私信没有选错。',
      },
      {
        key: 'content',
        label: '确认回复内容正确',
        required: true,
        category: 'content',
        status: input.sendMode === 'auto-send' ? 'ready' : 'warning',
        hint:
          input.sendMode === 'auto-send'
            ? '系统会在发送前填入并回读回复文本，回读不一致则阻断。'
            : '发送或粘贴前需要人工核对文本。',
      },
      {
        key: 'window',
        label: '确认当前窗口没有选错',
        required: input.misfireProtection.targetLockRequired,
        category: 'window',
        status: input.misfireProtection.targetLockRequired
          ? 'warning'
          : 'ready',
      },
      {
        key: 'commercial-permission',
        label: '确认商用执行权限',
        required:
          input.safetyBoundary.permissionStatus === 'blocked' ||
          input.safetyBoundary.permissionStatus === 'trial_limited',
        category: 'commercial',
        status:
          input.safetyBoundary.permissionStatus === 'blocked' ||
          input.safetyBoundary.permissionStatus === 'trial_limited'
            ? 'warning'
            : 'ready',
        hint: input.safetyBoundary.message,
      },
      {
        key: 'send-protection',
        label: '发送保护开启',
        required: input.sendMode !== 'draft-only',
        category: 'send-protection',
        status:
          input.sendMode === 'auto-send'
            ? 'ready'
            : input.misfireProtection.sendProtected
              ? 'warning'
              : 'ready',
        hint: input.misfireProtection.warning,
        blocking: input.riskLevel === 'high' && input.sendMode !== 'auto-send',
      },
      {
        key: 'rate-limit',
        label: '确认节奏/限流保护开启',
        required: this.isDesktopInteractionTask(input.type),
        category: 'send-protection',
        status:
          input.type === 'wechat-reply-draft'
            ? 'warning'
            : input.type === 'wechat-group-broadcast' ||
                input.type === 'wechat-contact-add' ||
                input.type === 'wechat-moments-publish' ||
                input.type === 'wechat-moments-marketing'
              ? 'warning'
              : 'ready',
        hint:
          input.type === 'wechat-group-broadcast' ||
          input.type === 'wechat-contact-add' ||
          input.type === 'wechat-moments-publish' ||
          input.type === 'wechat-moments-marketing'
            ? '群发、加好友和朋友圈已启用对象确认、节奏/限流、人工确认、证据、停止/接管保护。'
            : input.type === 'wechat-reply-draft'
              ? '微信草稿每次只允许锁定一个当前会话并填入一条草稿，发送和继续动作必须由人工接管。'
              : '非微信桌面动作不需要群发节奏控制。',
        blocking:
          input.type === 'wechat-group-broadcast' ||
          input.type === 'wechat-contact-add' ||
          input.type === 'wechat-moments-publish' ||
          input.type === 'wechat-moments-marketing'
            ? input.sendMode === 'auto-send' &&
              input.safetyBoundary.permissionStatus !== 'allowed'
            : false,
      },
      {
        key: 'role-approval',
        label: '确认角色审批满足要求',
        required: input.riskPolicy?.requiredRole !== 'operator',
        category: 'permission',
        status:
          input.riskPolicy?.requiredRole === 'operator' ? 'ready' : 'warning',
        hint: input.riskPolicy?.message,
      },
      {
        key: 'forbidden-actions',
        label: '确认没有触发禁止动作',
        required: Boolean(input.riskPolicy?.forbiddenActions.length),
        category: input.misfireProtection.deleteProtected
          ? 'delete-protection'
          : 'permission',
        status: input.riskPolicy?.forbiddenActions.length ? 'warning' : 'ready',
        hint: input.riskPolicy?.forbiddenActions.length
          ? `禁止动作：${input.riskPolicy.forbiddenActions.join('、')}`
          : '未命中禁止动作。',
        blocking: Boolean(input.riskPolicy?.forbiddenActions.length),
      },
    ];
  }

  private createRiskPolicy(input: {
    riskLevel: AgentRiskLevel;
    scope: AgentExecutionScope;
    targetName: string;
    instruction?: string;
    hasRemoteTakeover: boolean;
    commercialExecutionRequested?: boolean;
  }): LocalEngineRiskPolicy {
    const planMode = this.allowLocalPlanBypass() ? 'commercial' : 'trial';
    const whitelistTargets = this.normalizePolicyList(
      this.configService.get<string>('LOCAL_ENGINE_TARGET_WHITELIST'),
      ['测试对象', '微信客户', '抖音用户', '线上服务'],
    );
    const forbiddenActions = this.normalizePolicyList(
      this.configService.get<string>('LOCAL_ENGINE_FORBIDDEN_ACTIONS'),
      ['delete', 'payment', 'transfer', 'mass-send', 'clear-data'],
    );
    const forbiddenActionHits =
      input.riskLevel === 'high'
        ? forbiddenActions.filter((action) =>
            this.riskActionMatchesTarget(action, input.instruction || ''),
          )
        : [];
    const requiredRole =
      input.riskLevel === 'high' || input.scope === 'remote'
        ? 'manager'
        : 'operator';
    const remoteTakeoverAuditRequired =
      input.scope === 'remote' || input.hasRemoteTakeover;
    const targetWhitelisted = whitelistTargets.some(
      (target) =>
        input.targetName.includes(target) || target.includes(input.targetName),
    );

    return {
      planMode,
      requiredRole,
      approverRoles:
        requiredRole === 'operator'
          ? ['manager', 'admin']
          : ['manager', 'admin'],
      targetName: input.targetName,
      targetWhitelisted,
      whitelistTargets,
      forbiddenActions: input.riskLevel === 'high' ? forbiddenActions : [],
      forbiddenActionHits,
      remoteTakeoverAuditRequired,
      auditRequiredReason: remoteTakeoverAuditRequired
        ? `执行范围=${input.scope}，目标=${input.targetName}`
        : undefined,
      remoteAudit: remoteTakeoverAuditRequired
        ? [
            {
              action: 'requested',
              operator: 'system',
              reason: `远程/接管范围需要审计，目标：${input.targetName}`,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
      message: [
        `要求角色：${requiredRole === 'operator' ? '操作员' : '经理/管理员审批'}`,
        targetWhitelisted
          ? '目标命中白名单'
          : '目标未命中白名单，继续前需人工确认',
        forbiddenActionHits.length
          ? `命中禁止动作：${forbiddenActionHits.join('、')}`
          : '未命中禁止动作',
        remoteTakeoverAuditRequired ? '远程接管审计已开启' : '无需远程接管审计',
      ].join('；'),
    };
  }

  private riskActionMatchesTarget(action: string, targetName: string) {
    const normalized = targetName.toLowerCase();
    const patterns: Record<string, RegExp> = {
      delete: /(delete|删除|移除|清空)/i,
      payment: /(payment|pay|支付|扣费|购买)/i,
      transfer: /(transfer|转账)/i,
      'mass-send': /(mass|群发|批量发送)/i,
      'clear-data': /(clear|清空|清除数据)/i,
    };
    return (
      patterns[action]?.test(normalized) ||
      normalized.includes(action.toLowerCase())
    );
  }

  private normalizePolicyList(value: string | undefined, fallback: string[]) {
    const items = value
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return items?.length ? items : fallback;
  }

  private recordRemoteAudit(
    session: AgentSession,
    action: 'requested' | 'approved' | 'started' | 'stopped' | 'rejected',
    operator: string,
    reason: string,
    createdAt = new Date().toISOString(),
  ) {
    if (!session.riskPolicy?.remoteTakeoverAuditRequired) {
      return;
    }

    session.riskPolicy.remoteAudit.push({
      action,
      operator,
      reason,
      createdAt,
    });
  }

  private resolvePermissionStatusLabel(status: LocalEnginePermissionStatus) {
    const labels: Record<LocalEnginePermissionStatus, string> = {
      allowed: '允许',
      approval_required: '需要人工确认',
      blocked: '已阻断',
      trial_limited: '试用限制',
    };
    return labels[status];
  }

  private createAgentConfirmationChecks(
    session: AgentSession,
    riskLevel: Exclude<AgentRiskLevel, 'low'>,
  ): LocalEngineSafetyCheck[] {
    const safetyBoundary = session.safetyBoundary;
    const misfireProtection = session.misfireProtection;
    return [
      {
        key: 'scope',
        label: '确认执行范围正确',
        required: true,
        category: 'scope',
        status: 'warning',
        hint: `本次范围：${this.resolveAgentScopeLabel(session.executionScope)}。`,
      },
      {
        key: 'target',
        label: '确认目标账号/对象正确',
        required: true,
        category: 'target',
        status: 'warning',
        hint: session.targetApp
          ? `目标应用：${session.targetApp}`
          : '确认没有选错平台、账号或会话。',
      },
      {
        key: 'content',
        label: '确认即将提交或写入的内容正确',
        required: true,
        category: 'content',
        status: 'warning',
        hint: '继续前需要预览待发送、待发布或待写入内容。',
      },
      {
        key: 'window',
        label: '确认当前浏览器/桌面窗口没有选错',
        required: true,
        category: 'window',
        status: 'warning',
        hint: '桌面和浏览器自动化必须确认前台窗口与目标一致。',
      },
      {
        key: 'commercial-permission',
        label: '确认试用限制和正式商用可执行权限',
        required: safetyBoundary?.permissionStatus !== 'allowed',
        category: 'commercial',
        status:
          safetyBoundary?.permissionStatus === 'allowed' ? 'ready' : 'warning',
        hint: safetyBoundary?.message,
      },
      {
        key: 'misfire-protection',
        label: '确认误发误删保护已开启',
        required: true,
        category: misfireProtection?.deleteProtected
          ? 'delete-protection'
          : 'send-protection',
        status: riskLevel === 'high' ? 'warning' : 'ready',
        hint: misfireProtection?.warning,
        blocking: riskLevel === 'high',
      },
      {
        key: 'double-confirmation',
        label: '高风险动作继续执行保护',
        required: riskLevel === 'high',
        category: 'permission',
        status: riskLevel === 'high' ? 'warning' : 'ready',
        hint: '高风险动作需要额外确认一次，避免误发、误删或误发布。',
      },
      {
        key: 'role-approval',
        label: '确认角色审批满足要求',
        required: session.riskPolicy?.requiredRole !== 'operator',
        category: 'permission',
        status:
          session.riskPolicy?.requiredRole === 'operator' ? 'ready' : 'warning',
        hint: session.riskPolicy?.message,
      },
      {
        key: 'remote-takeover-audit',
        label: '确认远程接管审计已记录',
        required: Boolean(session.riskPolicy?.remoteTakeoverAuditRequired),
        category: 'permission',
        status: session.riskPolicy?.remoteTakeoverAuditRequired
          ? 'warning'
          : 'ready',
        hint: session.riskPolicy?.remoteTakeoverAuditRequired
          ? '远程或接管类动作会写入审计事件，确认后才继续。'
          : '当前会话不需要远程接管审计。',
      },
    ];
  }

  private resolveBusinessTaskType(
    key: InteractionBusinessRouteKey,
    input: Partial<CreateInteractionTaskInput> = {},
  ): InteractionTaskType {
    if (input.type && this.isKnownInteractionTaskType(input.type)) {
      return input.type;
    }
    if (this.isWechatChannelBusinessInput(input)) {
      if (key === 'comments') return 'wechat-channel-comment-reply';
      if (key === 'messages') return 'wechat-channel-direct-message-reply';
    }

    const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType> = {
      comments: 'douyin-comment-reply',
      messages: 'douyin-direct-message-reply',
      'channel-comments': 'wechat-channel-comment-reply',
      'channel-messages': 'wechat-channel-direct-message-reply',
      wechat: 'wechat-reply-draft',
      groups: 'wechat-group-broadcast',
      moments: 'wechat-moments-publish',
      customers: 'customer-follow-up',
    };

    return mapping[key];
  }

  private resolveBusinessTaskTypes(
    key: InteractionBusinessRouteKey,
  ): InteractionTaskType[] {
    const mapping: Record<InteractionBusinessRouteKey, InteractionTaskType[]> =
      {
        comments: ['douyin-comment-reply'],
        messages: ['douyin-direct-message-reply'],
        'channel-comments': ['wechat-channel-comment-reply'],
        'channel-messages': ['wechat-channel-direct-message-reply'],
        wechat: ['wechat-reply-draft', 'wechat-friend-accept'],
        groups: ['wechat-group-broadcast'],
        moments: ['wechat-moments-publish', 'wechat-moments-marketing'],
        customers: [
          'customer-follow-up',
          'wechat-contact-add',
          'wechat-friend-accept',
        ],
      };

    return mapping[key];
  }

  private isKnownInteractionTaskType(
    type: string,
  ): type is InteractionTaskType {
    return [
      'douyin-comment-reply',
      'douyin-direct-message-reply',
      'wechat-channel-comment-reply',
      'wechat-channel-direct-message-reply',
      'wechat-reply-draft',
      'wechat-friend-accept',
      'wechat-group-broadcast',
      'wechat-contact-add',
      'wechat-moments-publish',
      'wechat-moments-marketing',
      'customer-follow-up',
    ].includes(type);
  }

  private isWechatChannelBusinessInput(
    input: Partial<CreateInteractionTaskInput>,
  ): boolean {
    return (
      input.platformType === 2 ||
      /视频号|wechat[-_ ]?channel|channel/i.test(
        `${input.platformName || ''} ${input.type || ''}`,
      )
    );
  }

  private isRuleTone(
    value: unknown,
  ): value is InteractionReplyRuleConfig['tone'] {
    return value === 'warm' || value === 'professional' || value === 'concise';
  }

  private resolveTypeLabel(type: InteractionTaskType) {
    const labels: Record<InteractionTaskType, string> = {
      'douyin-comment-reply': '抖音自动评论',
      'douyin-direct-message-reply': '抖音私信回复',
      'wechat-channel-comment-reply': '视频号评论回复',
      'wechat-channel-direct-message-reply': '视频号私信回复',
      'wechat-reply-draft': '微信回复草稿',
      'wechat-friend-accept': '接受微信好友请求',
      'wechat-group-broadcast': '微信群发',
      'wechat-contact-add': '自动加好友',
      'wechat-moments-publish': '朋友圈发布',
      'wechat-moments-marketing': '朋友圈营销',
      'customer-follow-up': '客户跟进',
    };
    return labels[type];
  }

  private resolveStatusLabel(status: InteractionTaskStatus) {
    const labels: Record<InteractionTaskStatus, string> = {
      queued: '排队中',
      running: '执行中',
      paused: '已暂停',
      blocked: '已阻断',
      waiting_for_send_confirmation: '等待继续执行',
      completed: '已完成',
      failed: '失败',
      skipped: '已跳过',
      no_target: '无对象',
    };
    return labels[status];
  }

  private async resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ) {
    if (session.resumeAction?.kind === 'agentwaker-handoff') {
      session.status = 'completed';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = new Date().toISOString();
      session.updatedAt = session.completedAt;
      session.nextAction = `内容已批准进入发布准备，可前往 ${session.resumeAction.targetHref} 继续处理。`;
      this.pushAgentEvent(
        session,
        'success',
        '运营助理产物已批准',
        `${session.resumeAction.label}。本次仅完成内容交接，没有向平台执行发布。`,
        {
          type: 'stage_log',
          label: 'AgentWaker 内容交接',
          value: JSON.stringify(
            {
              articleId: session.resumeAction.articleId,
              role: session.resumeAction.role,
              workflow: session.resumeAction.workflow,
              targetHref: session.resumeAction.targetHref,
              confirmationId: confirmation.id,
            },
            null,
            2,
          ),
          stageKey: 'agentwaker-handoff',
        },
      );
      await this.persistAgentSession(session);
      return;
    }
    if (session.resumeAction?.kind === 'auto-upload-publish') {
      await this.runAutoUploadPublishResume(
        session,
        session.resumeAction,
        confirmation,
      );
      return;
    }
  }

  private async runAutoUploadPublishResume(
    session: AgentSession,
    action: Extract<AgentSessionResumeAction, { kind: 'auto-upload-publish' }>,
    confirmation: AgentConfirmation,
  ) {
    try {
      this.pushAgentEvent(
        session,
        'info',
        '开始真实发布',
        `${action.label} 已通过确认，正在提交给 3011 本地 Runtime。`,
      );
      const payloads = this.normalizeAutoUploadPublishPayloads(action.payloads);
      if (!payloads.length) {
        throw new BadRequestException('真实发布 payload 为空，无法继续执行');
      }
      this.pushAgentEvent(
        session,
        'info',
        '发布参数已锁定',
        `即将提交 ${payloads.length} 个平台任务，素材 ${new Set(payloads.flatMap((payload) => payload.fileList)).size} 个。`,
        {
          type: 'text',
          label: '发布 payload 摘要',
          value: JSON.stringify(
            payloads.map((payload) => ({
              platform: this.resolvePlatformName(payload.type),
              title: payload.title,
              accountCount: payload.accountList.length,
              materialCount: payload.fileList.length,
              timer: payload.enableTimer === 1,
              dryRun: payload.debugDryRun,
            })),
            null,
            2,
          ),
        },
      );
      const preflight =
        await this.autoUploadService.preflightPublishBatch(payloads);
      this.pushAgentEvent(
        session,
        preflight.ok ? 'success' : 'error',
        preflight.ok ? '发布 preflight 通过' : '发布 preflight 阻断',
        preflight.summary,
        {
          type: preflight.ok ? 'diagnostic_bundle' : 'failure_reason',
          label: '发布 preflight 矩阵',
          value: JSON.stringify(preflight, null, 2),
          stageKey: 'publish-preflight',
        },
      );
      if (!preflight.ok) {
        throw new BadRequestException(preflight.summary);
      }
      session.status = 'waiting_for_confirmation';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = undefined;
      session.nextAction =
        '发布草稿和发布前检查已保留；请进入发布中心核对本批内容并取得服务端一次性确认。';
      this.pushAgentEvent(
        session,
        'warning',
        '旧发布续跑入口已阻断',
        `已保留 ${payloads.length} 个发布草稿和 preflight 结果；内部 Agent 确认不能替代与当前批次绑定的服务端一次性发布票，本次未向任何平台提交。`,
        {
          type: 'text',
          label: '发布草稿',
          value: JSON.stringify(payloads, null, 2),
        },
      );
    } catch (error) {
      session.status = 'failed';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = new Date().toISOString();
      session.nextAction = '真实发布续跑失败，请检查本地发布引擎状态。';
      this.pushAgentEvent(
        session,
        'error',
        '真实发布续跑失败',
        error instanceof Error ? error.message : '未知错误',
      );
    } finally {
      session.updatedAt = new Date().toISOString();
      this.persistAgentSession(session).catch((error) => {
        console.warn(
          '[local-engine] persist agent publish resume failed',
          error,
        );
      });
    }
  }

  private normalizeAutoUploadPublishPayloads(
    payloads: unknown[],
  ): AutoUploadPublishPayload[] {
    if (!Array.isArray(payloads)) {
      return [];
    }
    return payloads
      .filter((payload): payload is AutoUploadPublishPayload => {
        const candidate = payload as AutoUploadPublishPayload;
        return Boolean(
          candidate &&
          typeof candidate.type === 'number' &&
          typeof candidate.title === 'string' &&
          Array.isArray(candidate.tags) &&
          Array.isArray(candidate.fileList) &&
          Array.isArray(candidate.accountList),
        );
      })
      .map((payload) => ({
        ...payload,
        debugDryRun: false,
        debugDryRunHoldBrowser: false,
      }));
  }

  private pushAgentEvent(
    session: AgentSession,
    level: AgentSessionEvent['level'],
    title: string,
    message: string,
    evidence?: AgentSessionEvent['evidence'],
  ) {
    const now = new Date().toISOString();
    session.events.push({
      id: this.createId(),
      sessionId: session.id,
      level,
      title,
      message,
      createdAt: now,
      evidence,
    });
    session.updatedAt = now;
  }

  private createAgentConfirmation(
    session: AgentSession,
    input: {
      title: string;
      description: string;
      actionLabel: string;
      riskLevel: Exclude<AgentRiskLevel, 'low'>;
    },
  ): AgentConfirmation {
    return {
      id: this.createId(),
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id,
      title: input.title,
      description: input.description,
      actionLabel: input.actionLabel,
      riskLevel: input.riskLevel,
      status: 'pending',
      confirmationMode:
        input.riskLevel === 'high' ? 'double-confirmation' : 'standard',
      requiredChecks: this.createAgentConfirmationChecks(
        session,
        input.riskLevel,
      ),
      safetyBoundary: session.safetyBoundary,
      misfireProtection: session.misfireProtection,
      riskPolicy: session.riskPolicy,
      commercialPermissionRequired:
        session.safetyBoundary?.permissionStatus !== 'allowed',
      trialLimited: session.safetyBoundary?.trialLimited,
      blockedReason: session.safetyBoundary?.blockedActions.length
        ? session.safetyBoundary.blockedActions.join('、')
        : undefined,
      createdAt: new Date().toISOString(),
    };
  }

  private createInteractionTaskConfirmation(
    task: InteractionTask,
  ): AgentConfirmation {
    const typeLabel = this.resolveTypeLabel(task.type);
    return {
      id: this.createId(),
      tenantId: task.tenantId,
      userId: task.userId,
      sessionId: `interaction-task:${task.id}`,
      title: `继续执行${typeLabel}回复`,
      description: `客户原文：${task.sourceText}\nAI 回复：${task.replyText}`,
      actionLabel: '继续执行',
      riskLevel: 'medium',
      status: 'pending',
      confirmationMode: 'standard',
      requiredChecks: [
        {
          key: 'target',
          label: '目标确认',
          required: true,
          blocking: false,
          category: 'target',
          status: 'ready',
        },
        {
          key: 'content',
          label: '内容确认',
          required: true,
          blocking: false,
          category: 'content',
          status: 'ready',
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  private resolveAgentRisk(instruction: string): AgentRiskLevel {
    if (
      /(发布|发送|提交|删除|移除|转账|支付|购买|扣费|改配置|写文件|清空|群发|朋友圈)/.test(
        instruction,
      )
    ) {
      return 'high';
    }
    if (
      /(打开|登录|读取|采集|导出|整理|生成|回复|评论|私信|微信)/.test(
        instruction,
      )
    ) {
      return 'medium';
    }
    return 'low';
  }

  private resolveAgentScope(instruction: string): AgentExecutionScope {
    if (/(微信|桌面|窗口|键盘|鼠标)/.test(instruction)) return 'desktop';
    if (/(网页|浏览器|抖音|小红书|B站|视频号|后台)/.test(instruction))
      return 'browser';
    if (/(文件|目录|素材|下载|导出|保存)/.test(instruction))
      return 'local-files';
    if (/(服务器|远程|线上)/.test(instruction)) return 'remote';
    return 'mixed';
  }

  private resolveAgentTargetApp(instruction: string) {
    if (/微信/.test(instruction)) return '微信';
    if (/抖音/.test(instruction)) return '抖音后台';
    if (/小红书/.test(instruction)) return '小红书后台';
    if (/B站|哔哩/.test(instruction)) return 'B站后台';
    return undefined;
  }

  private resolveAgentScopeLabel(scope: AgentExecutionScope) {
    const labels: Record<AgentExecutionScope, string> = {
      browser: '浏览器任务',
      desktop: '桌面任务',
      'local-files': '本机文件',
      remote: '远程任务',
      mixed: '浏览器和桌面混合',
    };
    return labels[scope];
  }

  private resolveAgentSessionStatusLabel(status: AgentSessionStatus) {
    const labels: Record<AgentSessionStatus, string> = {
      draft: '草稿',
      running: '执行中',
      waiting_for_confirmation: '待继续',
      completed: '已完成',
      failed: '失败',
      cancelled: '已停止',
    };
    return labels[status];
  }

  private resolvePlatformName(type: number) {
    const labels: Record<number, string> = {
      1: '小红书',
      2: '视频号',
      3: '抖音',
      4: '快手',
      5: 'B站',
    };
    return labels[type] || `平台 ${type}`;
  }

  private isSamePlatformAccount(
    selected: { type?: number; name?: string },
    actual: { type?: number; name?: string },
  ) {
    const selectedKey = this.resolvePlatformKey(selected);
    const actualKey = this.resolvePlatformKey(actual);
    if (selectedKey && actualKey) {
      return selectedKey === actualKey;
    }
    return selected.type === actual.type;
  }

  private resolveTaskPlatformAccount(input: {
    type: InteractionTaskType;
    platformType?: number;
    platformName?: string;
  }) {
    if (input.platformType || input.platformName) {
      return { type: input.platformType, name: input.platformName };
    }
    if (input.type.startsWith('wechat-channel')) {
      return { type: 2, name: '视频号' };
    }
    if (input.type.startsWith('douyin')) {
      return { type: 3, name: '抖音' };
    }
    return { type: input.platformType, name: input.platformName };
  }

  private resolvePlatformKey(input: { type?: number; name?: string }) {
    const name = input.name?.trim().toLowerCase();
    if (name) {
      if (name.includes('douyin') || name.includes('抖音')) return 'douyin';
      if (
        name.includes('wechat-channel') ||
        name.includes('channel') ||
        name.includes('视频号')
      ) {
        return 'wechat-channel';
      }
      if (name.includes('xiaohongshu') || name.includes('小红书')) {
        return 'xiaohongshu';
      }
      if (name.includes('kuaishou') || name.includes('快手')) return 'kuaishou';
      if (name.includes('bilibili') || name.includes('b站')) return 'bilibili';
    }
    const keys: Record<number, string> = {
      1: 'xiaohongshu',
      2: 'wechat-channel',
      3: 'douyin',
      4: 'kuaishou',
      5: 'bilibili',
    };
    return typeof input.type === 'number' ? keys[input.type] : undefined;
  }

  private buildAgentTitle(instruction: string) {
    const normalized = instruction.replace(/\s+/g, ' ').trim();
    return normalized.length > 22
      ? `${normalized.slice(0, 22)}...`
      : normalized;
  }

  private createId() {
    return `le_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
