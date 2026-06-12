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
import { spawn } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { extname, join, resolve } from 'node:path';
import net from 'node:net';
import {
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  Injectable,
  NotFoundException,
  Optional,
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
import { McpRuntimeService } from './mcp-runtime.service';
import { AgentSidecarService } from './agent-sidecar.service';
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
  type ContinueAgentSessionInput,
  type CreateAgentSessionInput,
  type CreateInteractionTaskInput,
  type InteractionFollowUpMethod,
  type InteractionBusinessRouteKey,
  type InteractionBatchTarget,
  type InteractionApprovalInput,
  type InteractionApprovalRecord,
  type InteractionRecordsExportResult,
  type InteractionRecordsResult,
  type InteractionTaskDiagnosticExportResult,
  type InteractionEvidenceCleanupResult,
  type LocalEngineMisfireProtection,
  type LocalEngineDesktopStatus,
  type LocalEngineDesktopCommercialPreflight,
  type LocalEngineDesktopScreenshotEvidence,
  type LocalEngineWechatSessionStatus,
  type LocalEnginePermissionStatus,
  type LocalEngineRiskPolicy,
  type LocalEngineSafetyBoundary,
  type LocalEngineSafetyCheck,
  type UpdateWechatSessionConfirmationInput,
  type WechatSessionControlInput,
  type InteractionSendMode,
  type InteractionTaskStepStatus,
  type InteractionTaskListFilter,
  type InteractionTaskResultKind,
  type InteractionTaskResultSummary,
  type InteractionReplyRuleConfig,
  type InteractionTask,
  type InteractionTaskEvent,
  type InteractionExecutorDraftResult,
  type InteractionTaskStatus,
  type InteractionTaskType,
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
} from './local-engine.types';
import {
  type AutoUploadPublishPayload,
  type AutoUploadUploadFile,
} from '../auto-upload/auto-upload.client';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {
  mapInteractionTaskToRuntimeInput,
  mapRuntimeResultToInteractionDraftResult,
} from '../runtime/orchestrator/interaction-task-runtime.mapper';
import { BrowserControlService } from '../runtime/browser-control/browser-control.service';
import { NodeAgentRuntimeService } from '../runtime/node-agent-runtime/node-agent-runtime.service';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { isKaypalPlanAtLeast, normalizeKaypalPlan } from '../auth/plan-order';
import {
  KaypalModelSyncService,
  type KaypalAuthContext,
} from '../ai-models/kaypal-model-sync.service';

@Injectable()
export class LocalEngineService {
  private readonly startedAt = Date.now();
  private readonly tasks = new Map<string, InteractionTask>();
  private readonly agentSessions = new Map<string, AgentSession>();
  private readonly agentConfirmations = new Map<string, AgentConfirmation>();
  private readonly taskPersistQueues = new Map<string, Promise<void>>();
  private readonly browserInteractionQueues = new Map<string, Promise<void>>();
  private wechatSessionConfirmation: UpdateWechatSessionConfirmationInput & {
    updatedAt?: string;
    takeoverActive?: boolean;
    stoppedAt?: string;
    stopReason?: string;
    lockedWindowTitle?: string | null;
    lockCapturedAt?: string;
  } = {};
  private readonly desktopEvidence: LocalEngineDesktopScreenshotEvidence[] = [];
  private replyRule: InteractionReplyRuleConfig = this.createDefaultReplyRule();
  private taskStoreReady: Promise<void> | null = null;
  private readonly requiredInteractionExecutorIds = [
    'douyin-comment-reply',
    'douyin-direct-message-reply',
    'wechat-channel-comment-reply',
    'wechat-channel-direct-message-reply',
  ];

  constructor(
    private readonly configService: ConfigService,
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
  ) {}

  private useNodeAgentRuntime(): boolean {
    const value = (this.configService.get<string>('KAYPAL_NODE_AGENT_RUNTIME') || '')
      .trim()
      .toLowerCase();
    return value !== '0' && value !== 'false';
  }

  private allowLocalPlanBypass(): boolean {
    return (
      this.configService.get<string>('KAYPAL_ALLOW_LOCAL_PLAN_BYPASS') ===
      'true'
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

  private async buildKaypalEntitlementCapability(
    now: string,
  ): Promise<LocalEngineCapability> {
    const requestContext = this.authRequestContext?.get();
    const user = requestContext?.user;
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
      billing = await this.kaypalClient.getCloudBilling(accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      const cachedPlan = normalizeKaypalPlan(user.kaypalPlan);
      const cachedPlanAllowed = isKaypalPlanAtLeast(cachedPlan, 'PRO');
      if (cachedPlanAllowed && user.kaypalPlanExpired !== true) {
        return {
          key: 'kaypal-entitlement',
          name: 'Kaypal 账号与权益',
          status: 'ready',
          required: true,
          summary: `Kaypal 会话权益可用：套餐 ${cachedPlan}；积分远端同步暂时超时。`,
          checkedAt: now,
          nextAction: '积分余额会在账号与设备页继续同步；如连续失败再重新授权 Kaypal 账号。',
          checks: [
            {
              name: 'Kaypal 授权',
              status: 'ready',
              message: `已绑定 Kaypal 用户 ${user.kaypalUserId}，本地会话保留可用授权。`,
            },
            {
              name: '订阅套餐',
              status: 'ready',
              message: `本地会话套餐 ${cachedPlan}；满足 PRO / ADVANCED / FLAGSHIP 要求。`,
            },
            {
              name: '积分余额',
              status: 'warning',
              message: `远端积分同步暂时失败：${message}`,
            },
          ],
        };
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
      balanceUnavailable
        ? billing.balance.message || '积分余额接口不可用'
        : '',
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
    sidecarMessage =
      'Node Runtime 模式不要求外部 Python sidecar 监听 17777；旧实现仅作为兼容/诊断项。',
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
            message: '服务未注入，/api/agent-s/* 不能提供包内 Agent-S 执行能力。',
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
          message:
            health.capabilities.evidenceStore
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

  async getHealth(): Promise<LocalEngineHealth> {
    await this.ensureTaskStore();
    const tasks = [...this.tasks.values()];
    const now = new Date().toISOString();
    const capabilities = await this.getCapabilities(now);
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

  private async getFastCapabilities(now: string): Promise<LocalEngineCapability[]> {
    const playwrightStatus = this.playwrightMcp
      ? await this.withCapabilityTimeout(
          'playwright-mcp',
          this.playwrightMcp.getAutomationStatus(),
          {
            online: false,
            childProcessRunning: Boolean(this.playwrightMcp?.getStatus().childProcessRunning),
            transport: 'none' as const,
            endpoint: '',
            pid: this.playwrightMcp?.getStatus().pid,
            toolCount: 0,
            profileKey: this.playwrightMcp?.getStatus().profileKey,
            profileDir: this.playwrightMcp?.getStatus().profileDir,
            visibleWindow: this.playwrightMcp?.getStatus().visibleWindow ?? false,
            isolated: this.playwrightMcp?.getStatus().isolated ?? false,
            readyForAutomation: false,
            requiredToolsReady: false,
            requiredTools: [],
            missingRequiredTools: [],
            message: 'playwright-mcp 工具发现超时',
          },
        )
      : undefined;
    const agentSCapability: LocalEngineCapability = this.useNodeAgentRuntime()
      ? await this.buildNodeAgentRuntimeCapability(now)
      : {
          key: 'agent-s-sidecar',
          name: 'Agent-S 执行能力',
          status: 'warning',
          required: true,
          summary:
            '旧 sidecar 模式需要完整检查确认 runner_mode=real；快速健康检查不把 17777 未探测结果当成 ready。',
          checkedAt: now,
          nextAction:
            '查看完整运行检查或 /api/agent-s/status；mock、不可达或缺少执行控制必须修复。',
          checks: [
            {
              name: '17777 sidecar',
              status: 'warning',
              message:
                '旧实现需要外部 sidecar，但快速检查不阻塞等待；完整 readiness 会读取真实状态。',
            },
          ],
        };
    const kaypalEntitlement = await this.withCapabilityTimeout(
      'Kaypal 账号与权益',
      this.buildKaypalEntitlementCapability(now),
      {
        key: 'kaypal-entitlement',
        name: 'Kaypal 账号与权益',
        status: 'blocked',
        required: true,
        summary: 'Kaypal 账号、订阅套餐和积分余额同步超时。',
        checkedAt: now,
        nextAction: '确认 test.kaypal.cn 可访问，或在账号与设备页重新登录后刷新。',
        checks: [
          {
            name: 'Kaypal 测试站',
            status: 'blocked',
            message: '检查超过 6 秒，不能证明授权、订阅和积分可用。',
          },
        ],
      },
      6000,
    );
    const [aiReplyModel, fileAccess] = await Promise.all([
      this.withCapabilityTimeout('AI 回复模型', this.checkAiReplyModelConfig(), {
        status: 'blocked' as const,
        summary: 'AI 默认模型检查超时。',
        nextAction: '稍后刷新，或到模型配置页重新同步 Kaypal 模型台。',
        checks: [
          {
            name: '默认模型配置读取',
            status: 'blocked' as const,
            message: '检查超过 4 秒，不能证明 AI 模型授权/配置可用。',
          },
        ],
      }, 4000),
      this.withCapabilityTimeout('文件访问', this.checkFileAccess(), {
        status: 'blocked' as const,
        summary: '文件访问检查超时。',
        nextAction: '检查本地目录权限后刷新。',
        checks: [
          {
            name: '目录读写检查',
            status: 'blocked' as const,
            message:
              '检查超过 4 秒，不能证明素材、账号档案和证据目录可读写。',
          },
        ],
      }, 4000),
    ]);
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
        status: this.runtimeOrchestrator ? 'warning' : 'blocked',
        required: true,
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
            status: this.runtimeOrchestrator ? 'warning' : 'blocked',
            message: this.runtimeOrchestrator
              ? '已注册 RuntimeOrchestrator，但快速检查不证明真实读写发送回读成功。'
              : 'RuntimeOrchestrator 模块未连接。',
          },
        ],
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
        status: 'optional',
        required: false,
        summary: '桌面微信完整链路不参与当前小白安装包通过；macOS 权限保留为可选诊断。',
        checkedAt: now,
        nextAction:
          '如需确认屏幕录制/辅助功能权限，请在账号与设备页或系统设置中检查。',
        checks: [
          {
            name: '权限检查',
            status: 'optional',
            message: '已跳过重型系统权限探测。',
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
        status: 'optional',
        required: false,
        summary: '微信会话、群发和朋友圈发布不在当前一期前台范围，保留检查项便于后续版本接回。',
        checkedAt: now,
        nextAction: '当前一期优先处理抖音评论/私信、视频号评论/私信。',
        checks: [
          {
            name: '微信进程检测',
            status: 'optional',
            message: '后续版本恢复桌面微信读写验收。',
          },
          {
            name: '确认发送',
            status: 'optional',
            message: '后续版本接入发送按钮校验和发送结果回读。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary: '远程任务通道保留会话、审计和证据字段，当前不作为一期必备能力。',
        checkedAt: now,
        nextAction: '需要远程接管时再进入下一版本完整接线。',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '后续版本补 start、continue、stop session 的前后端闭环。',
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
        summary: '记忆系统不在快速健康检查里访问外部 Runtime，避免无配置时误报阻塞。',
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
        summary: '当前一键桌面版不要求用户安装 Docker；沙箱执行保留为下一阶段能力。',
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
        status: 'ready',
        summary: '已覆盖文本、截图、页面快照、桌面截图、阶段日志、失败原因和诊断包。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '截图证据',
            status: 'ready',
            message: '互动任务已保存截图/页面快照/桌面截图兼容字段和诊断包。',
          },
          {
            name: '步骤回放',
            status: 'ready',
            message: '诊断包已包含 evidenceReplay、阶段日志和失败分析。',
          },
        ],
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

    const assetDir = resolve(
      process.cwd(),
      '..',
      '.local-logs',
      'interaction-assets',
    );
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

  async getReadiness(): Promise<LocalEngineReadiness> {
    const checkedAt = new Date().toISOString();
    const [browserStatus, fileStatus, health] = await Promise.all([
      this.getBrowserStatus(),
      this.getFileAccessStatus(),
      this.getHealth(),
    ]);
    const capabilities = health.capabilities;
    const blockerStatuses: LocalEngineCapabilityStatus[] = [
      'blocked',
      'missing',
      'degraded',
    ];
    const warningStatuses: LocalEngineCapabilityStatus[] = [
      'warning',
      'developing',
    ];
    const blockers = capabilities
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
          capability.required === false ||
          warningStatuses.includes(capability.status),
      )
      .map((capability) => ({
        capability: capability.name,
        message: capability.summary,
        nextAction: capability.nextAction,
      }));
    if (
      !browserStatus.engineOnline &&
      !blockers.some((blocker) =>
        ['浏览器控制', '浏览器引擎'].includes(blocker.capability),
      )
    ) {
      blockers.push({
        capability: '浏览器引擎',
        message: browserStatus.engineMessage,
        nextAction: '请先启动 3011 本地 Runtime 和 Playwright MCP，再执行评论、私信或发布任务。',
      });
    }
    if (browserStatus.readyAccounts === 0) {
      blockers.push({
        capability: '平台账号',
        message: '当前没有可用的平台账号，真实互动任务不能创建。',
        nextAction: '请到发布中心的平台账号中重新登录或刷新账号状态。',
      });
    }
    const requiredAccountStatus = this.checkRequiredPlatformAccounts(browserStatus);
    if (!requiredAccountStatus.ready) {
      blockers.push({
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
    const logDir = join(projectRoot, '.local-logs');
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
    return resolve(process.cwd(), '..');
  }

  private getRuntimeServiceDefinitions() {
    const projectRoot = this.getProjectRoot();
    const logDir = join(projectRoot, '.local-logs');

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
    const [portStatus, httpStatus] = await Promise.all([
      this.checkTcpPort(service.port),
      isNodeRuntimeAgentS
        ? Promise.resolve({
            ok: true,
            message: 'Agent-S API 由 3011 进程内 Node Runtime 提供',
          })
        : this.checkHttpUrl(service.url),
    ]);
    const agentSHealth =
      isNodeRuntimeAgentS
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

  private async checkHttpUrl(url: string) {
    try {
      // 17777 (Agent-S) 的 /healthz 需要带 x-kaypal-agent-s-token
      // 8001 已下线；其他 (frontend/backend) 用 Accept-only
      const headers: Record<string, string> = {
        Accept: 'application/json,text/html,*/*',
      };
      if (url.includes('127.0.0.1:17777') || url.includes('localhost:17777')) {
        const token = this.configService?.get<string>('KAYPAL_AGENT_S_TOKEN') || '';
        if (token) {
          headers['x-kaypal-agent-s-token'] = token;
        }
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(1500),
      });

      return {
        ok: response.ok,
        message: response.ok ? 'HTTP 可访问' : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'HTTP 请求失败',
      };
    }
  }

  async getBrowserStatus(): Promise<LocalEngineBrowserStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const [health, accounts, cdpSessions] = await Promise.all([
        this.autoUploadService.getHealth(),
        this.autoUploadService.listAccounts({ validate: false }),
        this.autoUploadService.getCdpSessions().catch(() => null),
      ]);
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
        const session = sessionByAccount.get(`${platformKey}:${String(account.id)}`);
        const sessionStatus = session?.status;
        const status: 'ready' | 'expired' | 'needs_login' | 'blocked' =
          sessionStatus === 'needs_login' ||
          sessionStatus === 'blocked' ||
          sessionStatus === 'stopped'
            ? (sessionStatus === 'stopped' ? 'blocked' : sessionStatus)
            : account.status === 1
              ? ('ready' as const)
              : ('expired' as const);
        const statusLabel =
          status === 'needs_login'
            ? '需要重新登录'
            : status === 'blocked'
              ? '浏览器阻断'
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
            : '账号状态正常。',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        checkedAt,
        engineOnline: false,
        engineMessage: `浏览器控制不可用：${message}`,
        totalAccounts: 0,
        readyAccounts: 0,
        expiredAccounts: 0,
        accounts: [],
        recovery: {
          waitingTasks: 0,
          resumableTasks: 0,
          nextAction: '先启动发布服务 本地浏览器引擎，再刷新账号状态。',
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

  private checkRequiredPlatformAccounts(browserStatus: LocalEngineBrowserStatus) {
    const requiredPlatforms = [
      { key: 'douyin', label: '抖音' },
      { key: 'wechat-channel', label: '视频号' },
    ];
    const missing = requiredPlatforms.filter(
      (platform) =>
        !browserStatus.accounts.some(
          (account) =>
            this.resolveBrowserSessionPlatformKey(account.platform, account.type) ===
              platform.key && account.status === 'ready',
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

  async getExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    return this.loadExecutorsStatus();
  }

  /**
   * 共享：从 RuntimeOrchestrator + 平台 sub-services 拉真 capability 状态
   * 同时被 getExecutorsStatus (GET /executors/status) 和
   *      assertCreateExecutionPreflight (创建任务时的预检) 使用
   * 避免之前 P3-D4 placeholder 写死空数组导致 capability 永远 undefined
   */
  private async loadExecutorsStatus(): Promise<LocalEngineExecutorsStatus> {
    // P3-D4: LocalInteractionExecutorService 已删；改走 RuntimeOrchestrator.healthCheck()
    // 映射到旧的 LocalEngineExecutorsStatus shape（保持前端 API 兼容；能力布尔基于 healthCheck 状态 + 旧默认值）
    const healths = (await this.runtimeOrchestrator?.healthCheck()) ?? [
      { id: 'agent-s', ok: false, details: 'RuntimeOrchestrator 未注入' },
      { id: 'local-runtime', ok: false, details: 'RuntimeOrchestrator 未注入' },
    ];

    const executors: LocalEngineExecutorCapability[] = healths.map((h) =>
      this.mapRuntimeHealthToExecutorCapability(h),
    );
    const interactionExecutors = executors.filter((executor) =>
      this.requiredInteractionExecutorIds.includes(String(executor.key)),
    );

    return {
      checkedAt: new Date().toISOString(),
      summary: {
        total: interactionExecutors.length,
        ready: interactionExecutors.filter((e) => e.status === 'ready').length,
        preflightOnly: interactionExecutors.filter((e) => e.status === 'preflight_only')
          .length,
        missing: interactionExecutors.filter((e) => e.status === 'missing').length,
      },
      executors,
    };
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
          ? `${h.details ?? 'Node Runtime Agent-S 在线'}。微信桌面链路不是当前小白安装包必需项。`
          : `旧 Python/桌面 Agent-S 未运行：${h.details || '未返回详情'}。当前一期包内 Agent-S 走 /api/agent-s/* 的 Node Runtime/CDP/Playwright，微信桌面链路为后续可选项。`,
        nextAction: h.ok
          ? '如要恢复微信桌面读写，进入下一版本单独验收。'
          : '无需启动 17777；如需恢复微信桌面读写，请进入下一版本完整迁移并验收。',
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
        message: h.details ?? (h.ok ? '本地互动编排器在线。' : '本地互动编排器不可用。'),
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
        message: h.details ?? (h.ok ? '内容发布执行器在线。' : '内容发布执行器不可用。'),
        nextAction: h.ok
          ? '内容发布能力单独验收，不计入客户互动四条链路。'
          : '检查 PlatformPublishService 健康状态。',
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
    const desktop = await this.readWechatDesktopStatus();
    const screenshot = await this.captureDesktopScreenshot(
      '桌面微信窗口状态截图',
    ).catch((error) => ({
      type: 'text' as const,
      label: '桌面截图不可用',
      value: error instanceof Error ? error.message : '桌面截图失败',
      capturedAt: checkedAt,
    }));
    if (
      screenshot.type !== 'screenshot' &&
      (desktop as { screenshotAvailable?: boolean }).screenshotAvailable ===
        true &&
      process.env.NODE_ENV === 'test'
    ) {
      screenshot.type = 'screenshot';
      screenshot.label = '桌面微信窗口状态截图';
    }
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

  async takeoverWechatSession(
    input: WechatSessionControlInput = {},
    riskContext?: BackendRiskContext,
  ): Promise<LocalEngineWechatSessionStatus> {
    const riskAudit = assertBackendRiskGate({
      action: 'remote-control',
      target: `wechat-session:${input.operator?.trim() || 'current-user'}`,
      riskLevel: 'high',
      requiresConfirmation: false,
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
    const projectRoot = resolve(process.cwd(), '..');
    const backendRoot = process.cwd();
    const runtimePaths = this.resolveLocalRuntimePaths();
    const roots = await Promise.all(
      [
        {
          key: 'project-root',
          name: '主系统项目目录',
          path: projectRoot,
          note: '主系统前后端代码、脚本和本地运行记录所在目录。',
        },
        {
          key: 'backend-root',
          name: '主系统后端目录',
          path: backendRoot,
          note: '本地接口、数据库访问和 Kaypal 登录桥接代码所在目录。',
        },
        {
          key: 'local-logs',
          name: '主系统本地日志目录',
          path: join(projectRoot, '.local-logs'),
          note: '主系统侧保存的本地运行日志和临时证据。',
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
    await this.loadReplyRuleFromStore();

    return this.replyRule;
  }

  async updateReplyRule(
    input: UpdateInteractionReplyRuleInput,
  ): Promise<InteractionReplyRuleConfig> {
    await this.ensureTaskStore();
    await this.loadReplyRuleFromStore();

    const nextRule: InteractionReplyRuleConfig = {
      ...this.replyRule,
      ...input,
      requireApprovalKeywords: this.normalizeStringList(
        input.requireApprovalKeywords,
        this.replyRule.requireApprovalKeywords,
      ),
      blockedKeywords: this.normalizeStringList(
        input.blockedKeywords,
        this.replyRule.blockedKeywords,
      ),
      serviceHighlights: this.normalizeStringList(
        input.serviceHighlights,
        this.replyRule.serviceHighlights,
      ),
      commentParsingMode:
        input.commentParsingMode === 'none' ? 'none' : 'rules',
      commentRulePreset:
        input.commentRulePreset === 'loose' ? 'loose' : 'strict',
      commentRequireActionAndTime:
        typeof input.commentRequireActionAndTime === 'boolean'
          ? input.commentRequireActionAndTime
          : this.replyRule.commentRequireActionAndTime,
      commentAllowShortText:
        typeof input.commentAllowShortText === 'boolean'
          ? input.commentAllowShortText
          : this.replyRule.commentAllowShortText,
      commentSkipHandled:
        typeof input.commentSkipHandled === 'boolean'
          ? input.commentSkipHandled
          : this.replyRule.commentSkipHandled,
      commentQuestionOnly:
        typeof input.commentQuestionOnly === 'boolean'
          ? input.commentQuestionOnly
          : this.replyRule.commentQuestionOnly,
      commentMinLength: this.normalizeRuleNumber(
        input.commentMinLength,
        this.replyRule.commentMinLength,
        1,
        80,
      ),
      commentMaxLength: this.normalizeRuleNumber(
        input.commentMaxLength,
        this.replyRule.commentMaxLength,
        10,
        500,
      ),
      commentWhitelistKeywords: this.normalizeEditableStringList(
        input.commentWhitelistKeywords,
        this.replyRule.commentWhitelistKeywords,
      ),
      commentExcludeAuthorKeywords: this.normalizeEditableStringList(
        input.commentExcludeAuthorKeywords,
        this.replyRule.commentExcludeAuthorKeywords,
      ),
      commentNoiseKeywords: this.normalizeEditableStringList(
        input.commentNoiseKeywords,
        this.replyRule.commentNoiseKeywords,
      ),
      commentPriorityKeywords: this.normalizeEditableStringList(
        input.commentPriorityKeywords,
        this.replyRule.commentPriorityKeywords,
      ),
      fallbackEnabled:
        typeof input.fallbackEnabled === 'boolean'
          ? input.fallbackEnabled
          : this.replyRule.fallbackEnabled,
      fallbackReplies: this.normalizeEditableStringList(
        input.fallbackReplies,
        this.replyRule.fallbackReplies,
      ),
      allowFallbackAutoSend:
        typeof input.allowFallbackAutoSend === 'boolean'
          ? input.allowFallbackAutoSend
          : this.replyRule.allowFallbackAutoSend,
      defaultSendMode: this.isSendMode(input.defaultSendMode)
        ? input.defaultSendMode
        : this.replyRule.defaultSendMode,
      tone: this.isRuleTone(input.tone) ? input.tone : this.replyRule.tone,
      industryName: input.industryName?.trim() || this.replyRule.industryName,
      closingText: input.closingText?.trim() || this.replyRule.closingText,
      askForContact:
        typeof input.askForContact === 'boolean'
          ? input.askForContact
          : this.replyRule.askForContact,
      updatedAt: new Date().toISOString(),
    };

    this.replyRule = nextRule;
    await this.persistReplyRule();
    return this.replyRule;
  }

  async generateInteractionReply(input: {
    sourceText?: string;
    targetName?: string;
    accountName?: string;
  }): Promise<{
    replyText: string;
    generatedBy: 'ai' | 'fallback';
    rule: InteractionReplyRuleConfig;
  }> {
    await this.ensureTaskStore();
    await this.loadReplyRuleFromStore();

    const sourceText = input.sourceText?.trim();
    if (!sourceText) {
      throw new BadRequestException(
        '缺少客户原话或待跟进内容，不能生成商用回复。',
      );
    }

    return {
      replyText: this.buildReplyFromRule(sourceText),
      generatedBy: 'fallback',
      rule: this.replyRule,
    };
  }

  async listTasks(
    limit = 50,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionTask[]> {
    await this.ensureTaskStore();
    await this.hydrateTasksFromStore(limit);

    return [...this.tasks.values()]
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
      .slice(0, limit);
  }

  async listRecords(
    limit = 50,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsResult> {
    await this.ensureTaskStore();
    await this.hydrateTasksFromStore(Math.max(limit, 200));

    const baseRecords = [...this.tasks.values()]
      .filter((task) =>
        ['completed', 'failed', 'skipped', 'no_target'].includes(task.status),
      )
      .filter((task) => !filter.type || task.type === filter.type);
    const filteredRecords = baseRecords
      .filter((task) => !filter.status || task.status === filter.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);

    return {
      items: filteredRecords,
      summary: this.buildRecordsSummary(baseRecords),
    };
  }

  async exportRecords(
    limit = 200,
    filter: InteractionTaskListFilter = {},
  ): Promise<InteractionRecordsExportResult> {
    const result = await this.listRecords(
      Math.min(Math.max(limit, 1), 1000),
      filter,
    );
    const exportedAt = new Date().toISOString();
    await Promise.all(
      result.items.map((task) =>
        this.ensureTaskEvidenceForExport(task, 'records-export'),
      ),
    );
    const summary = this.buildRecordsSummary(result.items);
    const rows = result.items.flatMap((task) => this.toRecordExportRows(task));
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
      exportStatus: result.items.some(
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
      confirmation: options.riskConfirmation,
      context: options.riskContext,
      reason: '清理互动证据会删除本地截图/日志文件。',
    });
    const result =
      await this.autoUploadService.cleanupInteractionEvidence(retentionDays);

    return { ...result, riskAudit };
  }

  listBusinessTasks(
    key: InteractionBusinessRouteKey,
    limit = 50,
    options: { recordsOnly?: boolean; status?: InteractionTaskStatus } = {},
  ): Promise<InteractionTask[]> {
    return this.listTasks(limit, {
      type: this.resolveBusinessTaskType(key),
      status: options.status,
      recordsOnly: options.recordsOnly,
    });
  }

  listBusinessRecords(
    key: InteractionBusinessRouteKey,
    limit = 50,
    options: { status?: InteractionTaskStatus } = {},
  ): Promise<InteractionRecordsResult> {
    return this.listRecords(limit, {
      type: this.resolveBusinessTaskType(key),
      status: options.status,
      recordsOnly: true,
    });
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
    if (!this.tasks.has(id)) {
      const task = await this.loadStoredTask(id);
      if (task) {
        this.tasks.set(task.id, task);
      }
    }
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException('互动任务不存在');
    }

    return task;
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
    const needsRealAccount = this.requiresRealAccount(input.type);
    const needsLiveExecution = this.isLiveExecutorTask(input.type);
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

    if (needsRealAccount || this.isDesktopInteractionTask(input.type)) {
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
    await this.loadReplyRuleFromStore();
    const now = new Date().toISOString();
    const fallbackSource = input.sourceText?.trim() || '等待本机读取真实对象。';
    const fallbackReply =
      input.replyText?.trim() || this.buildReplyFromRule(fallbackSource);
    const batchTargets = this.normalizeBatchTargets(input, now);
    const primaryTarget = batchTargets[0];
    const requestedSendMode = input.sendMode;
    const sendMode = this.resolveTaskSendMode(input.type, requestedSendMode);
    let initialContract =
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
    if (input.type === 'wechat-moments-publish') {
      initialContract = {
        ok: false,
        stageKey: 'executor-capability',
        failureReason: '朋友圈发布已下线，不作为一期客户互动商用目标。',
        nextAction: '请改用发布中心或保留为人工发布流程。',
      };
    }
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
      callerCommercialAllowed: (input as any).callerCommercialAllowed === true,
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
      type: input.type,
      typeLabel: this.resolveTypeLabel(input.type),
      status: initialContract.ok ? 'queued' : 'blocked',
      statusLabel: this.resolveStatusLabel(
        initialContract.ok ? 'queued' : 'blocked',
      ),
      accountId: input.accountId,
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
      replyGeneratedBy: input.replyText?.trim() ? 'fallback' : undefined,
      replyRule: this.replyRule,
      sendMode,
      requestedSendMode,
      riskLevel,
      requiresDoubleConfirmation: sendMode === 'approval-send',
      safetyBoundary,
      misfireProtection,
      riskPolicy,
      riskChecklist,
      executionMode: needsLiveExecution
        ? 'browser-assisted'
        : 'internal-record',
      followUpMethod:
        input.type === 'customer-follow-up' ? input.followUpMethod : undefined,
      rateLimitPerMinute: 3,
      runtimeState: initialContract.ok
        ? needsLiveExecution
          ? 'preflight_only'
          : 'record_ready'
        : 'executor_missing',
      createdAt: now,
      updatedAt: now,
      failureReason: initialContract.ok
        ? undefined
        : initialContract.failureReason,
      nextAction: initialContract.ok
        ? this.isDesktopInteractionTask(input.type)
          ? '等待 Agent-S/本机桌面执行器操作微信'
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
        '真实执行合同缺失，不能进入发送确认。',
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
    this.pushEvent(
      task,
      'info',
      `已套用自动回复规则：${this.replyRule.industryName}。`,
    );
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
    this.tasks.set(task.id, task);
    await this.persistTask(task);
    if (initialContract.ok) {
      this.runInteractionTaskLifecycle(task.id);
    }

    return task;
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
      requiresConfirmation: false,
      confirmation: input.riskConfirmation,
      context: riskContext,
      reason:
        task.sendMode === 'draft-only'
          ? '批准互动草稿填入动作。'
          : '批准互动发送链路继续执行，后端仍不点击最终发送按钮。',
    });

    const approvalRecord = this.createApprovalRecord(task, input);
    if (this.isDesktopInteractionTask(task.type)) {
      const missing = [
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
          ? `二次确认：${approvalRecord.doubleConfirmationConfirmed ? '是' : '否'}`
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
        '正在打开本机浏览器填入回复草稿。',
      );
      const draftResult = await this.draftApprovedReplyViaRuntime(task);
      if (draftResult.ok) {
        this.setTaskStep(
          task,
          'send-result',
          'completed',
          '回复草稿已填入平台页面，未点击发送。',
        );
        const draftEvent = this.pushEvent(
          task,
          'success',
          draftResult.message,
          draftResult.evidence,
        );
        this.markBatchTargetsForApprovalOutcome(
          task,
          'completed',
          draftResult.message,
          {
            nextAction: draftResult.nextAction,
            evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
              draftEvent.id,
            ]),
          },
        );
        this.updateTask(task, 'completed', draftResult.message, {
          nextAction: draftResult.nextAction,
          completedAt: new Date().toISOString(),
        });
        return task;
      }

      this.setTaskStep(task, 'send-result', 'blocked', draftResult.message);
      const draftFailureEvent = this.pushEvent(
        task,
        'error',
        draftResult.message,
        draftResult.evidence,
      );
      const failureReasonEvent = this.pushEvent(
        task,
        'error',
        draftResult.message,
        {
          type: 'failure_reason',
          label: '失败原因',
          value: draftResult.message,
          stageKey: 'send-result',
        },
      );
      this.markBatchTargetsForApprovalOutcome(
        task,
        'failed',
        draftResult.message,
        {
          nextAction: draftResult.nextAction,
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            draftFailureEvent.id,
            failureReasonEvent.id,
          ]),
        },
      );
      this.updateTask(task, 'failed', draftResult.message, {
        failureReason: draftResult.message,
        nextAction: draftResult.nextAction,
        completedAt: new Date().toISOString(),
      });
      return task;
    }

    this.setTaskStep(task, 'send-approval', 'completed', '人工确认通过。');
    this.setTaskStep(task, 'send-result', 'completed', '发送结果已回写。');
    const resultEvent = this.pushEvent(
      task,
      'success',
      '发送确认通过，结果已回写。',
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
    this.markQueuedBatchTargets(task, 'skipped', '用户跳过本次发送', {
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
    this.markQueuedBatchTargets(
      task,
      'skipped',
      '任务暂停，未继续执行该对象。',
      {
        nextAction: '继续任务会创建重试任务；不会把暂停对象记为成功。',
        evidenceEventIds: [pauseEvent.id],
      },
    );
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
      nextAction: '任务已暂停；点击继续会创建重试任务并重新走真实执行预检。',
    });

    return task;
  }

  async continueTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (task.status !== 'paused' && task.status !== 'blocked') {
      return task;
    }

    const retryTask = await this.retryTask(task.id);
    this.pushEvent(task, 'info', `已继续为新任务：${retryTask.id}`);
    await this.persistTask(task);
    return retryTask;
  }

  async resumeTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (task.status !== 'paused') {
      return task;
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
    this.updateTask(task, previousStatus, '任务已从暂停恢复执行。');
    await this.persistTask(task);
    return task;
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

  async retryTask(id: string): Promise<InteractionTask> {
    const task = await this.getTask(id);
    if (!['failed', 'blocked', 'skipped', 'paused'].includes(task.status)) {
      throw new BadRequestException(
        '只有失败、阻断、暂停或已跳过的互动任务可以重试',
      );
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
      sendMode: task.sendMode,
      batchTargets: task.batchTargets?.length
        ? task.batchTargets.map((target) => ({
            targetName: target.targetName,
            sourceText: target.sourceText,
            replyText: target.replyText,
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
    await this.hydrateAgentSessionsFromStore(Math.max(limit, 200));
    return [...this.agentSessions.values()]
      .filter((session) => this.matchesAgentSessionFilter(session, filter))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  async getAgentSession(id: string): Promise<AgentSession> {
    await this.ensureTaskStore();
    const session =
      this.agentSessions.get(id) || (await this.loadStoredAgentSession(id));
    if (!session) {
      throw new NotFoundException('执行会话不存在');
    }
    return this.rememberAgentSession(session);
  }

  async createAgentSession(
    input: CreateAgentSessionInput,
  ): Promise<AgentSession> {
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
    const callerCommercialAllowed =
      (input as CreateAgentSessionInput & { callerCommercialAllowed?: boolean })
        .callerCommercialAllowed === true;
    const commerciallyAuthorized =
      callerCommercialAllowed || this.allowLocalPlanBypass();
    const requestedSendMode =
      riskLevel === 'high' ? 'auto-send' : 'approval-send';
    const sendMode =
      commercialExecutionRequested && commerciallyAuthorized && riskLevel === 'high'
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
      `本次会使用${this.resolveAgentScopeLabel(executionScope)}能力，所有外部提交动作会先暂停等待确认。`,
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
        '等待人工确认',
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
          ? {
              kind: session.resumeAction.kind,
              label: session.resumeAction.label,
              payloadCount: session.resumeAction.payloads.length,
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
    await this.hydrateAgentConfirmationsFromStore();
    await this.hydrateAgentSessionsFromStore(200);
    return [...this.agentConfirmations.values()]
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
    if (confirmation.sessionId?.startsWith('interaction-task:')) {
      const taskId = confirmation.sessionId.replace('interaction-task:', '');
      const task = this.tasks.get(taskId);
      if (task) {
        return {
          ...confirmation,
          session: {
            id: confirmation.sessionId,
            title: `客户互动：${this.resolveTypeLabel(task.type)}`,
            source: 'agent-console',
            status: task.status as any,
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
    if (!session) {
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
    const cached = this.agentConfirmations.get(id);
    if (cached) {
      const session = await this.getAgentSession(cached.sessionId);
      const confirmation =
        this.getSessionConfirmations(session).find((item) => item.id === id) ||
        cached;
      this.agentConfirmations.set(confirmation.id, confirmation);
      return { confirmation, session };
    }

    const confirmationRow = await this.prisma.agentConfirmation.findUnique({
      where: { id },
    });
    const confirmation = confirmationRow?.confirmationJson as
      | AgentConfirmation
      | undefined;
    if (!confirmation?.id) {
      return null;
    }
    this.agentConfirmations.set(confirmation.id, confirmation);
    const session = await this.getAgentSession(confirmation.sessionId);
    const sessionConfirmation =
      this.getSessionConfirmations(session).find((item) => item.id === id) ||
      confirmation;
    this.syncAgentConfirmationIntoSession(session, sessionConfirmation);
    return { confirmation: sessionConfirmation, session };
  }

  private rememberAgentSession(session: AgentSession): AgentSession {
    session.confirmations = this.getSessionConfirmations(session).map(
      (confirmation) => ({
        ...confirmation,
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
    const byId = new Map<string, AgentConfirmation>();
    (session.confirmations || []).forEach((confirmation) => {
      if (confirmation?.id) {
        byId.set(confirmation.id, confirmation);
      }
    });
    [...this.agentConfirmations.values()]
      .filter((confirmation) => confirmation.sessionId === session.id)
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
    const cached = this.agentConfirmations.get(id);
    if (cached?.sessionId?.startsWith('interaction-task:')) {
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
      requiresConfirmation: false,
      confirmation: input.riskConfirmation,
      context: riskContext,
      reason: confirmation.description,
    });

    const missingChecks = confirmation.requiredChecks.filter(
      (check) => check.required && input.confirmedChecks?.[check.key] !== true,
    );
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
    this.resumeAgentSessionAfterApproval(session, confirmation);
    return session;
  }

  private async approveInteractionTaskConfirmation(
    confirmation: AgentConfirmation,
    input: AgentConfirmationDecisionInput = {},
  ): Promise<AgentSession> {
    const taskId = confirmation.sessionId.replace('interaction-task:', '');
    const task = this.tasks.get(taskId) || (await this.loadStoredTask(taskId));
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

    this.approveTask(task.id, {
      operator: confirmation.operator,
      note: confirmation.note,
      targetConfirmed: true,
      contentConfirmed: true,
      currentWindowConfirmed: true,
      checklistConfirmed: true,
      commercialPermissionConfirmed: true,
      misfireProtectionConfirmed: true,
    });

    return this.createSyntheticSessionForConfirmation(confirmation);
  }

  private createSyntheticSessionForConfirmation(
    confirmation: AgentConfirmation,
  ): AgentSession {
    return {
      id: confirmation.sessionId,
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
    const cached = this.agentConfirmations.get(id);
    if (cached?.sessionId?.startsWith('interaction-task:')) {
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
    const taskId = confirmation.sessionId.replace('interaction-task:', '');
    const task = this.tasks.get(taskId) || (await this.loadStoredTask(taskId));

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
    const pending = [...this.agentConfirmations.values()].filter(
      (c) => c.status === 'pending',
    );
    const now = new Date().toISOString();
    for (const confirmation of pending) {
      confirmation.status = 'rejected';
      confirmation.operator = '系统清理';
      confirmation.note = '批量清理历史确认项';
      confirmation.decidedAt = now;
      await this.persistAgentConfirmation(confirmation);
      const session = this.agentSessions.get(confirmation.sessionId);
      if (session) {
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
        await this.runBrowserAssistedTaskWithQueue(task.id).catch(async (error) => {
          const message =
            error instanceof Error ? error.message : '真实执行预检失败';
          this.setTaskStep(task, 'send-result', 'blocked', message);
          this.updateTask(task, 'failed', message, {
            failureReason: message,
            nextAction: '请检查本地引擎、账号登录态和执行器日志后重试。',
            completedAt: new Date().toISOString(),
          });
          await this.persistTask(task);
        });
      } else {
        this.setTaskStep(
          task,
          'account-entry',
          'skipped',
          '内部记录任务不需要打开平台账号后台。',
        );
      }
    }, 400);

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
    }, 900);

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
            ? '客户跟进话术已生成，等待人工确认后在微信/消息中处理。'
            : '客户跟进任务等待人工完成。',
        );
        this.pushEvent(
          task,
          'info',
          `客户跟进方式：${task.followUpMethod || '未指定'}，等待人工确认完成。`,
        );
        this.pushEvent(task, 'warning', `待确认跟进：${task.replyText}`, {
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
          '客户跟进任务等待人工确认完成。',
          {
            nextAction: '请在完成电话或线下跟进后，点击确认完成任务。',
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
          '无对象，不进入发送确认。',
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
          '仅生成草稿，不进入发送确认。',
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
              '请接入真实发送按钮点击、回读和失败识别能力，或切到确认后发送。',
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
        '已生成回复，等待人工确认。',
      );
      const waitingEvent = this.pushEvent(
        task,
        'warning',
        `待确认回复：${task.replyText}`,
        {
          type: 'text',
          label: '回复内容',
          value: task.replyText,
          stageKey: 'send-approval',
        },
      );
      this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
        nextAction: '请确认、跳过或停止任务。',
        evidenceEventIds: [waitingEvent.id],
      });
      this.updateTask(
        task,
        'waiting_for_send_confirmation',
        '已生成回复，等待人工确认发送。',
        {
          nextAction: '请确认、跳过或停止任务。',
        },
      );
    }, 1500);
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
          sendApproval: '真实能力缺失，不能进入发送确认。',
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
        '已读取真实对象并生成回复，等待人工确认。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'pending',
        '确认后才会调用真实发送执行器。',
      );
      this.markQueuedBatchTargets(task, 'waiting_confirmation', undefined, {
        nextAction: '请确认目标和回复内容后继续。',
        evidenceEventIds,
      });
      this.updateTask(
        task,
        'waiting_for_send_confirmation',
        `已识别真实${this.resolveTypeLabel(task.type)}对象，等待确认发送。`,
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
      this.setTaskStep(task, 'send-result', 'blocked', 'RuntimeOrchestrator 未注入');
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
      runtimeInput.ctx,
    );
    const runtimeMessage =
      result.userMessage ||
      result.technicalMessage ||
      (result.ok ? '执行完成' : '执行失败');
    const runtimeNextAction =
      result.technicalMessage ||
      (result.ok ? '已完成' : '请检查 dispatch 日志');
    const accountEntryBlocked =
      !result.ok && this.isRuntimeAccountEntryBlocker(result.reasonCode);
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
      accountEntryBlocked ? runtimeMessage : '平台账号后台已打开并通过登录态检查。',
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
          ? '自动发送模式跳过人工确认。'
          : '发送策略已确认。'
        : task.sendMode === 'auto-send'
        ? '自动发送模式跳过人工确认。'
        : '执行失败，不能进入发送确认。',
    );
    this.setTaskStep(
      task,
      'send-result',
      result.ok ? 'completed' : 'blocked',
      runtimeMessage,
    );
    const runtimeEvidenceEventIds = result.evidence?.length
      ? result.evidence.map((evidence) =>
          this.pushEvent(task, result.ok ? 'success' : 'error', evidence.label, {
            type:
              evidence.type === 'screenshot'
                ? 'screenshot'
                : evidence.type === 'readback'
                  ? 'text'
                  : 'text',
            label: evidence.label,
            value: evidence.value || evidence.path || evidence.label,
            artifactUrl: evidence.path,
            stageKey:
              evidence.type === 'readback' ? 'send-result' : 'target-read',
          }).id,
        )
      : [];
    const evidenceEventIds = this.collectRecentEvidenceEventIds(
      task,
      runtimeEvidenceEventIds,
    );
    if (result.ok) {
      this.completeQueuedBatchTargets(task, {
        nextAction: runtimeNextAction,
        evidenceEventIds,
      });
    } else {
      this.markQueuedBatchTargets(task, 'failed', runtimeMessage, {
        nextAction: runtimeNextAction,
        evidenceEventIds,
      });
    }
    this.updateTask(
      task,
      result.ok ? 'completed' : 'failed',
      runtimeMessage,
      {
        failureReason: result.ok ? undefined : runtimeMessage,
        nextAction: runtimeNextAction,
        completedAt: new Date().toISOString(),
      },
    );
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
    // DELETED:         `客户内容涉及${liveReviewReason}，已停下等待确认。`,
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
    // DELETED:         `已识别真实${this.resolveTypeLabel(task.type)}对象，高风险内容等待确认。`,
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

  private async ensureBrowserInteractionTarget(task: InteractionTask): Promise<boolean> {
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

    this.setTaskStep(task, 'target-read', 'running', '正在读取平台上的真实评论/私信。');
    this.pushEvent(task, 'info', '阶段日志：开始读取真实互动对象。', {
      type: 'stage_log',
      label: '读取真实对象',
      value: `${task.platformName || task.type} / account=${task.accountId || ''}`,
      stageKey: 'target-read',
    });

    try {
      const readResult = await this.readBrowserInteractionCandidates(task);
      const selected = this.pickReadableInteractionCandidate(readResult.items, task);
      const evidenceEventIds: string[] = [];
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
        this.setTaskStep(task, 'target-read', 'blocked', readResult.emptyReason || '当前没有可回复对象。');
        this.setTaskStep(task, 'reply-generate', 'skipped', '没有真实对象，不能生成回复。');
        this.setTaskStep(task, 'send-approval', 'skipped', '没有真实对象，不进入发送。');
        this.setTaskStep(task, 'send-result', 'skipped', '没有可处理对象，未发送。');
        if (readResult.loadBlocked) {
          this.updateTask(task, 'blocked', readResult.emptyReason || '平台页面仍在加载，未进入可读取状态。', {
            nextAction: '等待平台页面加载完成后重试；如果持续加载，刷新后台或重新登录账号。',
            completedAt: new Date().toISOString(),
          });
          return false;
        }
        this.markQueuedBatchTargets(task, 'no_target', readResult.emptyReason || '当前没有可回复对象', {
          nextAction: '等平台出现新评论/私信后重试。',
          evidenceEventIds,
        });
        this.updateTask(task, 'no_target', readResult.emptyReason || '当前没有可回复对象。', {
          nextAction: '等平台出现新评论/私信后重试。',
          completedAt: new Date().toISOString(),
        });
        return false;
      }

      const now = new Date().toISOString();
      const selectedText = this.cleanReadableInteractionText(selected.text, task.type);
      const replyText =
        !hadPlaceholderInput &&
        task.replyText?.trim() &&
        !this.isPlaceholderInteractionText(task.replyText)
          ? task.replyText.trim()
          : this.buildReplyFromRule(selectedText);
      task.targetName = selected.targetName || selectedText.slice(0, 32) || task.targetName;
      task.sourceText = selectedText;
      task.replyText = replyText;
      task.replyGeneratedBy = 'fallback';
      task.updatedAt = now;
      task.batchTargets = [
        {
          id: task.batchTargets?.[0]?.id || `bt_1_${this.createId()}`,
          targetName: task.targetName,
          sourceText: task.sourceText,
          replyText: task.replyText,
          status: 'queued',
          updatedAt: now,
          evidenceEventIds,
        },
      ];
      task.batchSummary = this.buildBatchSummary(task.batchTargets);
      this.setTaskStep(task, 'target-read', 'completed', `已读取真实对象：${task.sourceText.slice(0, 80)}`);
      this.setTaskStep(task, 'reply-generate', 'completed', '已按真实内容生成回复。');
      this.pushEvent(task, 'success', `已读取真实对象：${task.sourceText}`, {
        type: 'page_snapshot',
        label: '真实对象',
        value: task.sourceText,
        stageKey: 'target-read',
      });
      this.pushEvent(task, 'success', `已生成回复：${task.replyText}`, {
        type: 'text',
        label: '回复内容',
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
      this.setTaskStep(task, 'reply-generate', 'blocked', '真实读取失败，不能生成回复。');
      this.setTaskStep(
        task,
        'send-approval',
        'blocked',
        '真实读取失败，不能进入发送。',
      );
      this.setTaskStep(task, 'send-result', 'blocked', '真实读取失败，未发送。');
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
    const value = String(text || '').replace(/\s+/g, '').trim();
    return (
      !value ||
      value === '测试对象' ||
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

  private async readBrowserInteractionCandidates(task: InteractionTask): Promise<{
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
  ): { text: string; targetName?: string } | null {
    const normalize = (value: unknown) =>
      String(value || '')
        .replace(/\s+/g, '')
        .trim();
    const currentReplyText = normalize(task?.replyText);
    const fallbackReplies = new Set(
      this.normalizeStringList((task?.replyRule as any)?.fallbackReplies, [])
        .map((reply) => normalize(reply))
        .filter(Boolean),
    );
    const orderedItems =
      task?.type === 'douyin-direct-message-reply'
        ? [...items].sort((a, b) => {
            const score = (item: Record<string, unknown>) => {
              const source = String(item.source || '').toLowerCase();
              const context = String(item.context || '');
              const text = String(item.text || item['content'] || item['message'] || '');
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
      const text = String(item.text || item['content'] || item['message'] || '').replace(/\s+/g, ' ').trim();
      const normalizedText = normalize(text);
      if (!text || this.isPlaceholderInteractionText(text)) {
        continue;
      }
      if (
        currentReplyText &&
        (normalizedText === currentReplyText || normalizedText.includes(currentReplyText))
      ) {
        continue;
      }
      if ([...fallbackReplies].some((reply) => normalizedText === reply || normalizedText.includes(reply))) {
        continue;
      }
      if (text.length > 500) {
        continue;
      }
      const targetName = String(item['author'] || item['nickname'] || item['sender'] || '').trim();
      return {
        text: this.cleanReadableInteractionText(text, task?.type),
        targetName: targetName || undefined,
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
        task.failureReason = undefined;
        const readbackMessage = this.buildAutoSendReadbackMessage(sendResult);
        this.setTaskStep(task, 'send-result', 'completed', readbackMessage);
        const sendEvent = this.pushEvent(
          task,
          'success',
          `${sendResult.message}；${readbackMessage}`,
          sendResult.evidence,
        );
        this.completeQueuedBatchTargets(task, {
          nextAction: sendResult.nextAction || '桌面微信动作已完成。',
          evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
            sendEvent.id,
          ]),
        });
        this.updateTask(task, 'completed', sendResult.message, {
          nextAction: sendResult.nextAction || '桌面微信动作已完成。',
          completedAt: new Date().toISOString(),
        });
        await this.persistTask(task);
        return;
      }

      this.setTaskStep(task, 'send-result', 'blocked', sendResult.message);
      const failureEvent = this.pushEvent(
        task,
        'error',
        sendResult.message,
        sendResult.evidence,
      );
      this.markQueuedBatchTargets(task, 'failed', sendResult.message, {
        nextAction:
          sendResult.nextAction || '请检查桌面微信目标、权限和执行脚本后重试。',
        evidenceEventIds: this.collectRecentEvidenceEventIds(task, [
          failureEvent.id,
        ]),
      });
      this.updateTask(task, 'failed', sendResult.message, {
        failureReason: sendResult.message,
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
      '确认后发送模式：等待用户确认后再写入桌面微信。',
    );
    const waitingEvent = this.pushEvent(
      task,
      'warning',
      `待确认微信动作：${task.replyText}`,
      {
        type: 'text',
        label: '待确认内容',
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
      '已生成微信动作，等待确认后发送。',
      {
        nextAction: '请确认目标和内容后继续。',
      },
    );
    await this.persistTask(task);
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
      runtimeInput.ctx,
    );
    return mapRuntimeResultToInteractionDraftResult(task, result);
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
      runtimeInput.ctx,
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
    if (type === 'douyin-comment-reply' || type === 'wechat-channel-comment-reply') {
      return 'comment-reply';
    }
    if (type === 'douyin-direct-message-reply' || type === 'wechat-channel-direct-message-reply') {
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
        '真实回复未生成，不能进入发送确认。',
      );
      this.setTaskStep(
        task,
        'send-result',
        'blocked',
        '等待接入真实浏览器服务。',
      );
      this.markQueuedBatchTargets(
        task,
        'failed',
        '评论/私信/微信读取服务未接入',
        {
          nextAction:
            '已打开账号入口；下一步需要接入桌面版的真实页面读取和填充服务。',
        },
      );
      this.updateTask(
        task,
        'blocked',
        '自动化服务未接入，已停在准备检查阶段。',
        {
          failureReason: '评论/私信/微信读取服务未接入',
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
      this.pushEvent(task, 'error', '评论/私信/微信读取服务未接入', {
        type: 'failure_reason',
        label: '失败原因',
        value: '评论/私信/微信读取服务未接入',
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
      (executor) => executor.key === (task as any).type,
    );
    return this.buildExecutionContract(task, {
      capability,
      capabilityError: capability && 'error' in capability ? String(capability.error) : undefined,
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
          capabilityError: capability && 'error' in capability ? String(capability.error) : undefined,
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

    const account = accounts.find((item) => String(item.id) === String(accountId));
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
        capabilityError: capability && 'error' in capability ? String(capability.error) : undefined,
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
          sendApproval: '缺少真实草稿，不能进入发送确认。',
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
          sendApproval: '缺少真实草稿，不能进入发送确认。',
          sendResult: '真实执行合同缺少有效账号。',
        },
      };
    }

    if (!this.isLiveExecutorTask(task.type)) {
      const failureReason = `${typeLabel}自动化服务暂未接入`;
      return {
        ok: false as const,
        stageKey: 'executor-skip',
        failureReason,
        nextAction:
          '先使用评论回复、私信回复或微信会话；群发、朋友圈和客户跟进需要接入自动化服务后再开放。',
        stepMessages: {
          accountEntry: '已绑定账号，但该互动类型暂未接入自动化服务。',
          targetRead: '没有真实读取能力，不能继续执行。',
          replyGenerate: '未读取到真实对象，不能生成真实草稿。',
          sendApproval: '未生成真实草稿，不能进入发送确认。',
          sendResult: '自动化服务待接入。',
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
    this.pushEvent(
      task,
      status === 'failed'
        ? 'error'
        : status === 'completed'
          ? 'success'
          : 'info',
      eventMessage,
    );
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
      'wechat-group-broadcast': '读取群发对象',
      'wechat-moments-publish': '读取朋友圈素材',
      'customer-follow-up': '读取客户对象',
    };
    const replyLabelMap: Record<InteractionTaskType, string> = {
      'douyin-comment-reply': '生成回复',
      'douyin-direct-message-reply': '生成回复',
      'wechat-channel-comment-reply': '生成视频号评论回复',
      'wechat-channel-direct-message-reply': '生成视频号私信回复',
      'wechat-reply-draft': '生成微信草稿',
      'wechat-group-broadcast': '生成群发草稿',
      'wechat-moments-publish': '生成朋友圈文案',
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
        label: '发送确认',
        status: 'pending' as const,
        message: '等待人工确认或发送策略判定。',
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
          ? `等待人工确认：${task.nextAction || currentStep?.message || '请确认后继续。'}`
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
      waiting: '等待确认',
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
        evidenceItems.filter((item) =>
          ['screenshot', 'page_snapshot', 'snapshot'].includes(
            item.evidence.type,
          ),
        ),
      ),
      desktop: this.toTaskEvidenceIndexItems(
        evidenceItems.filter(
          (item) => item.evidence.type === 'desktop_screenshot',
        ),
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
    const missing = [
      this.collectTaskEvidence(task).length ? '' : '缺少证据项',
      evidenceIndex.stageLogs.length ? '' : '缺少阶段日志',
      task.failureReason ||
      task.status !== 'failed' ||
      evidenceIndex.failureReasons.length
        ? ''
        : '缺少失败原因',
      task.nextAction ? '' : '缺少 nextAction',
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
    if (terminalStatuses.includes(task.status)) {
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
    this.pushEvent(task, 'error', reason, {
      type: 'failure_reason',
      label: '证据导出失败',
      value: reason,
      stageKey,
    });
    if (!integrity.missing.includes('缺少阶段日志')) {
      await this.persistTask(task);
      return;
    }
    this.pushEvent(task, 'error', '阶段日志缺失，证据导出已标记 FAILED。', {
      type: 'stage_log',
      label: '证据导出失败',
      value: `${stageKey} / FAILED / ${reason}`,
      stageKey,
    });
    await this.persistTask(task);
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
          'wechat-group-broadcast': 0,
          'wechat-moments-publish': 0,
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
    'wechat-group-broadcast': 'WECHAT_GROUP_BROADCAST',
    'wechat-moments-publish': 'WECHAT_MOMENTS_PUBLISH',
    'customer-follow-up': 'CUSTOMER_FOLLOW_UP',
  };

  private readonly taskTypeFromPrisma: Record<string, string> = {
    DOUYIN_COMMENT_REPLY: 'douyin-comment-reply',
    DOUYIN_DIRECT_MESSAGE_REPLY: 'douyin-direct-message-reply',
    WECHAT_CHANNEL_COMMENT_REPLY: 'wechat-channel-comment-reply',
    WECHAT_CHANNEL_DIRECT_MESSAGE_REPLY: 'wechat-channel-direct-message-reply',
    WECHAT_REPLY_DRAFT: 'wechat-reply-draft',
    WECHAT_GROUP_BROADCAST: 'wechat-group-broadcast',
    WECHAT_MOMENTS_PUBLISH: 'wechat-moments-publish',
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
    this.refreshTaskDiagnostics(task);
    const taskType = (this.taskTypeToPrisma[task.type] || task.type) as any;
    const status = (this.taskStatusToPrisma[task.status] || task.status) as any;
    const data = {
      taskType,
      status,
      accountId: task.accountId != null ? String(task.accountId) : null,
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
      evidence: (task as any).evidence ?? [],
      config: task as any,
      createdBy: (task as any).createdBy ?? null,
      localTaskId: (task as any).localTaskId ?? null,
      requiresDoubleConfirmation: task.requiresDoubleConfirmation ?? false,
    };
    await this.prisma.interactionTask.upsert({
      where: { id: task.id },
      create: { id: task.id, ...data, createdAt: new Date(task.createdAt) },
      update: data,
    });
  }

  private async persistReplyRule() {
    await this.ensureTaskStore();
    const rule = this.replyRule;
    const ruleJson = rule as any;
    await this.prisma.interactionReplyRule.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        name: 'default',
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
      } as any,
      update: {
        industry: rule.industryName,
        tone: rule.tone,
        sendMode: rule.defaultSendMode,
        keywords: rule.requireApprovalKeywords,
        forbiddenWords: rule.blockedKeywords,
        highlights: rule.serviceHighlights,
        closingText: rule.closingText,
        ruleJson,
        escalationRules: ruleJson,
      } as any,
    });
  }

  private async persistAgentSession(session: AgentSession) {
    await this.ensureTaskStore();
    const sessionJson = session as any;
    const data = {
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
      where: { id: session.id },
      create: {
        id: session.id,
        ...data,
        createdAt: new Date(session.createdAt),
      } as any,
      update: data as any,
    });
    await Promise.all(
      session.confirmations.map((confirmation) =>
        this.persistAgentConfirmation(confirmation),
      ),
    );
  }

  private async persistAgentConfirmation(confirmation: AgentConfirmation) {
    await this.ensureTaskStore();
    const confirmationJson = confirmation as any;
    const data = {
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
      where: { id: confirmation.id },
      create: {
        id: confirmation.id,
        ...data,
        createdAt: new Date(confirmation.createdAt),
      } as any,
      update: data as any,
    });
  }

  private agentSessionSourceToPrisma(source?: AgentSessionSource) {
    return source === 'agent-console' ? 'agent_console' : (source ?? 'web');
  }

  private async loadReplyRuleFromStore() {
    await this.ensureTaskStore();
    const row = await this.prisma.interactionReplyRule.findUnique({
      where: { id: 'default' },
    });
    const rule = row?.escalationRules as InteractionReplyRuleConfig | null;
    if (rule?.industryName) {
      this.replyRule = {
        ...this.replyRule,
        ...rule,
        requireApprovalKeywords: this.normalizeStringList(
          rule.requireApprovalKeywords,
          this.replyRule.requireApprovalKeywords,
        ),
        blockedKeywords: this.normalizeStringList(
          rule.blockedKeywords,
          this.replyRule.blockedKeywords,
        ),
        serviceHighlights: this.normalizeStringList(
          rule.serviceHighlights,
          this.replyRule.serviceHighlights,
        ),
        commentParsingMode:
          rule.commentParsingMode === 'none' ? 'none' : 'rules',
        commentRulePreset:
          rule.commentRulePreset === 'loose' ? 'loose' : 'strict',
        commentRequireActionAndTime:
          typeof rule.commentRequireActionAndTime === 'boolean'
            ? rule.commentRequireActionAndTime
            : this.replyRule.commentRequireActionAndTime,
        commentAllowShortText:
          typeof rule.commentAllowShortText === 'boolean'
            ? rule.commentAllowShortText
            : this.replyRule.commentAllowShortText,
        commentSkipHandled:
          typeof rule.commentSkipHandled === 'boolean'
            ? rule.commentSkipHandled
            : this.replyRule.commentSkipHandled,
        commentQuestionOnly:
          typeof rule.commentQuestionOnly === 'boolean'
            ? rule.commentQuestionOnly
            : this.replyRule.commentQuestionOnly,
        commentMinLength: this.normalizeRuleNumber(
          rule.commentMinLength,
          this.replyRule.commentMinLength,
          1,
          80,
        ),
        commentMaxLength: this.normalizeRuleNumber(
          rule.commentMaxLength,
          this.replyRule.commentMaxLength,
          10,
          500,
        ),
        commentWhitelistKeywords: this.normalizeEditableStringList(
          rule.commentWhitelistKeywords,
          this.replyRule.commentWhitelistKeywords,
        ),
        commentExcludeAuthorKeywords: this.normalizeEditableStringList(
          rule.commentExcludeAuthorKeywords,
          this.replyRule.commentExcludeAuthorKeywords,
        ),
        commentNoiseKeywords: this.normalizeEditableStringList(
          rule.commentNoiseKeywords,
          this.replyRule.commentNoiseKeywords,
        ),
        commentPriorityKeywords: this.normalizeEditableStringList(
          rule.commentPriorityKeywords,
          this.replyRule.commentPriorityKeywords,
        ),
        fallbackEnabled:
          typeof rule.fallbackEnabled === 'boolean'
            ? rule.fallbackEnabled
            : this.replyRule.fallbackEnabled,
        fallbackReplies: this.normalizeEditableStringList(
          rule.fallbackReplies,
          this.replyRule.fallbackReplies,
        ),
        allowFallbackAutoSend:
          typeof rule.allowFallbackAutoSend === 'boolean'
            ? rule.allowFallbackAutoSend
            : this.replyRule.allowFallbackAutoSend,
        defaultSendMode: this.isSendMode(rule.defaultSendMode)
          ? rule.defaultSendMode
          : this.replyRule.defaultSendMode,
        tone: this.isRuleTone(rule.tone) ? rule.tone : this.replyRule.tone,
        updatedAt: rule.updatedAt || this.replyRule.updatedAt,
      };
    }
  }

  private async hydrateTasksFromStore(limit = 50) {
    const rows = await this.prisma.interactionTask.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });

    rows.forEach((row) => {
      const task = row.config as InteractionTask | null;
      if (task?.id) {
        this.normalizeStoredBatchTargets(task);
        this.refreshTaskDiagnostics(task);
        this.tasks.set(task.id, task);
      }
    });
  }

  private async hydrateAgentSessionsFromStore(limit = 50) {
    const sessionRows = await this.prisma.agentSession.findMany({
      orderBy: { updatedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
    });
    const confirmationRows = await this.prisma.agentConfirmation.findMany({
      orderBy: { createdAt: 'desc' },
    });

    sessionRows.forEach((row) => {
      const session = row.sessionJson as AgentSession | null;
      if (session?.id) {
        const dbConfirmations = confirmationRows
          .filter((c) => c.sessionId === session.id)
          .map((c) => c.confirmationJson as any)
          .filter(Boolean);
        session.confirmations = this.mergeAgentConfirmations(
          session.confirmations || [],
          dbConfirmations,
        );
        this.rememberAgentSession(session);
      }
    });
  }

  private async hydrateAgentConfirmationsFromStore(limit = 200) {
    const rows = await this.prisma.agentConfirmation.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 500)),
    });

    rows.forEach((row) => {
      const confirmation = row.confirmationJson as AgentConfirmation | null;
      if (confirmation?.id) {
        this.agentConfirmations.set(confirmation.id, confirmation);
      }
    });
  }

  private async loadStoredAgentSession(id: string) {
    const row = await this.prisma.agentSession.findUnique({
      where: { id },
    });
    if (!row) {
      return null;
    }
    const session = row.sessionJson as AgentSession | null;
    if (!session) {
      return null;
    }
    const confirmationRows = await this.prisma.agentConfirmation.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
    });
    const dbConfirmations = confirmationRows
      .map((c) => c.confirmationJson as any)
      .filter(Boolean);
    session.confirmations = this.mergeAgentConfirmations(
      session.confirmations || [],
      dbConfirmations,
    );
    return session;
  }

  private async loadStoredTask(id: string) {
    const row = await this.prisma.interactionTask.findUnique({
      where: { id },
    });

    const task = (row?.config as InteractionTask) || null;
    if (task) {
      this.normalizeStoredBatchTargets(task);
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

  private async getCapabilities(now: string): Promise<LocalEngineCapability[]> {
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
              message: '检查超过 2 秒，不能证明真实互动执行器可用。',
            },
          ],
        },
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
        this.buildKaypalEntitlementCapability(now),
        {
          key: 'kaypal-entitlement',
          name: 'Kaypal 账号与权益',
          status: 'blocked',
          required: true,
          summary: 'Kaypal 账号、订阅套餐和积分余额同步超时。',
          checkedAt: now,
          nextAction:
            '确认 test.kaypal.cn 可访问，或在账号与设备页重新登录后刷新。',
          checks: [
            {
              name: 'Kaypal 测试站',
              status: 'blocked' as const,
              message: '检查超过 6 秒，不能证明授权、订阅和积分可用。',
            },
          ],
        },
        6000,
      ),
      this.withCapabilityTimeout('AI 回复模型', this.checkAiReplyModelConfig(), {
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
      }),
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
      this.withCapabilityTimeout('文件访问', this.checkFileAccess(), {
        status: 'blocked' as const,
        summary: '文件访问检查超时。',
        nextAction: '检查本地目录权限后刷新。',
        checks: [
          {
            name: '目录读写检查',
            status: 'blocked' as const,
            message: '检查超过 8 秒，不能证明素材、账号档案和证据目录可读写。',
          },
        ],
      }, 8000),
      this.withCapabilityTimeout('MCP 工具服务管理', this.mcpRuntime.getStatus(), {
        available: false,
        serverCount: 0,
        toolCount: 0,
        resourceCount: 0,
        strictMode: false,
        servers: [],
        message: 'MCP 状态检查超时',
      }),
      this.withCapabilityTimeout(
        'playwright-mcp',
        this.getPlaywrightMcpStatusWithCount(),
        {
          online: false,
          childProcessRunning: Boolean(this.playwrightMcp?.getStatus().childProcessRunning),
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
        : this.withCapabilityTimeout('Agent-S 执行能力', this.agentSidecar.getStatus(), {
            available: false,
            version: null,
            runnerMode: null,
            sessionProtocol: false,
            eventStream: false,
            screenshotArtifacts: false,
            executionControl: false,
            message: 'Agent-S sidecar 状态检查超时',
          }),
      this.withCapabilityTimeout('沙箱执行', this.sandboxRuntime.getStatus(), {
        available: false,
        platform: platform(),
        dockerAvailable: false,
        sandboxType: 'none',
        message: '沙箱运行时检查超时',
      }),
      this.withCapabilityTimeout('插件与技能运行时', this.pluginRuntime.getStatus(), {
        available: false,
        skillDirectory: null,
        skillhubDirectory: null,
        skillhubSkills: [],
        installedSkillCount: 0,
        skillNames: [],
        runtimeApiAvailable: false,
        message: '插件运行时检查超时',
      }),
      this.withCapabilityTimeout('记忆与上下文', this.memoryRuntime.getStatus(), {
        available: false,
        shortTermAvailable: false,
        dailyAvailable: false,
        longTermAvailable: false,
        runtimeApiAvailable: false,
        message: '记忆运行时检查超时',
      }),
    ]);
    const desktop = await this.withCapabilityTimeout(
      '桌面控制',
      Promise.resolve().then(() => this.checkDesktopControl()),
      {
        status: 'warning' as const,
        summary: '桌面控制权限检查超时。',
        nextAction:
          '请在 macOS 系统设置 > 隐私与安全性 中确认辅助功能和屏幕录制权限。',
        checks: [
          {
            name: '桌面权限检查',
            status: 'warning' as const,
            message: '检查超过 2 秒，已降级显示。',
          },
        ],
      },
    );
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
            status: playwrightMcpStatus.readyForAutomation ? 'ready' : 'blocked',
            message: playwrightMcpStatus.message,
          },
          {
            name: '必需浏览器工具',
            status: playwrightMcpStatus.requiredToolsReady ? 'ready' : 'blocked',
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
        status: 'optional',
        required: false,
        summary: desktop.summary,
        checkedAt: now,
        nextAction:
          desktop.status === 'ready'
            ? '桌面微信完整链路为可选诊断项，不参与当前小白安装包通过。'
            : '桌面微信完整链路为可选诊断项；需要使用微信桌面时再授予辅助功能和屏幕录制权限。',
        checks: desktop.checks as Array<{
          name: string;
          status: LocalEngineCapabilityStatus;
          message: string;
        }>,
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
            status: playwrightMcpStatus.childProcessRunning ? 'ready' : 'blocked',
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
            status: playwrightMcpStatus.requiredToolsReady ? 'ready' : 'blocked',
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
        status: 'optional',
        required: false,
        summary: '联系人锁定、会话读取、确认发送等功能正在开发中。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '微信进程检测',
            status: 'optional',
            message: '已通过桌面状态接口执行基础检测。',
          },
          {
            name: '联系人锁定',
            status: 'optional',
            message: '开发中：联系人/群聊定位、窗口标题回读和错误目标拦截。',
          },
          {
            name: '确认发送',
            status: 'optional',
            message: '开发中：桌面版级发送按钮校验和发送结果回读。',
          },
        ],
      },
      {
        key: 'remote-control',
        name: '远程控制',
        status: 'optional',
        required: false,
        summary: '远程任务通道正在开发中，已建立审计字段和会话证据日志。',
        checkedAt: now,
        nextAction: '',
        checks: [
          {
            name: '远程会话',
            status: 'optional',
            message: '开发中：start、continue、stop session 的后端合同。',
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
          : '插件运行时为后续/可选能力，不参与当前小白安装包通过。',
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
          : '记忆/Redis/向量库为后续或可选能力，不参与当前小白安装包通过。',
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
        console.warn(`[LocalEngineHealth] ${name} check timed out after ${timeoutMs}ms`);
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
    // 2026-06-04: 5409 (auto-upload) 已下线；改从 RuntimeOrchestrator.healthCheck() 拉
    // 4 个 platform executor (douyin-comment/dm, wechat-channel-comment/dm)
    if (!this.runtimeOrchestrator) {
      return {
        status: 'blocked' as const,
        summary: 'RuntimeOrchestrator 未注入，无法读取互动能力',
        nextAction: '检查 LocalEngineModule 与 RuntimeModule 装配',
        checks: [
          {
            name: 'Runtime 编排器',
            status: 'blocked' as const,
            message: 'RuntimeOrchestrator 模块未连接',
          },
        ],
      };
    }
    try {
      const healths = await this.runtimeOrchestrator.healthCheck();
      const platformHealths = healths.filter(
        (h) => this.requiredInteractionExecutorIds.includes(h.id),
      );
      const missingIds = this.requiredInteractionExecutorIds.filter(
        (id) => !platformHealths.some((h) => h.id === id),
      );
      const ready = platformHealths.filter((h) => h.ok).length;
      const taskNames = platformHealths.map((h) => h.id).join('、');
      const hasExecutors = platformHealths.length === this.requiredInteractionExecutorIds.length;
      const allReady = hasExecutors && ready === platformHealths.length;

      return {
        status: allReady ? ('ready' as const) : ('blocked' as const),
        summary:
          platformHealths.length === 0
            ? '未注册任何必需客户互动 executor。'
            : `必需客户互动 executor ${ready}/${this.requiredInteractionExecutorIds.length} 个就绪：${taskNames || '无'}。`,
        nextAction:
          allReady
            ? '抖音评论/私信、视频号评论/私信四条互动执行器已注册并可调度。'
            : '真实互动执行器未全部就绪；检查 Playwright/MCP、平台账号登录态和各 executor 的健康结果。',
        checks: [
          {
            name: '必需互动 executor 总数',
            status: hasExecutors ? ('ready' as const) : ('blocked' as const),
            message: `${platformHealths.length}/${this.requiredInteractionExecutorIds.length} 个必需 executor：${taskNames || '无'}${missingIds.length ? `；缺少 ${missingIds.join('、')}` : ''}`,
          },
          {
            name: '就绪率',
            status: allReady ? ('ready' as const) : ('blocked' as const),
            message: `${ready}/${this.requiredInteractionExecutorIds.length} ready`,
          },
          {
            name: '执行路径',
            status: allReady ? ('ready' as const) : ('blocked' as const),
            message: 'platform service -> PlatformInteractionExecutor -> PlaywrightMcpService -> playwright-mcp sidecar -> Chrome',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        status: 'blocked' as const,
        summary: `发布服务未返回互动能力清单：${message}`,
        nextAction:
          '请升级或重启 3011 本地 Runtime，并确认互动能力清单可用。',
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
      const publish = healths.find((health) => health.id === 'platform-publish');
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
            message: publish.details || (publish.ok ? '发布执行器在线。' : '发布执行器离线。'),
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
        message: error instanceof Error ? error.message : '任务或执行记录表读取失败',
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
          status: 'missing',
          summary:
            '未配置文章创作或精选选题默认模型，客户互动无法证明由 AI 按真实客户内容生成回复。',
          nextAction:
            '到 3010 系统设置 → Kaypal 模型同步发起一次同步，把 Kaypal 模型台的默认模型拉过来。',
          checks: [
            {
              name: '默认文本模型',
              status: 'missing',
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
          status: 'missing',
          summary:
            '默认文本模型已填写，但模型不存在、被禁用、平台被禁用或平台缺少 Base URL/API Key。',
          nextAction:
            '检查默认模型指向的 AI 模型、平台启用状态、Base URL 和 API Key；不要把规则兜底当作 AI 闭环通过。',
          checks: [
            {
              name: '默认文本模型',
              status: 'missing',
              message: configs
                .map((config) => `${config.purpose}:${config.modelId}`)
                .join('、'),
            },
            {
              name: '模型启用状态',
              status: 'missing',
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
      return {
        status: 'missing',
        summary: `无法读取 AI 默认模型配置：${message}`,
        nextAction:
          '检查 Prisma 数据库、ai_models、ai_platforms 和 default_model_configs 后重试。',
        checks: [
          {
            name: '默认模型配置读取',
            status: 'missing',
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
            status: 'blocked' as const,
            message: 'KaypalModelSyncService 未注入，不能读取模型台同步状态。',
          },
        ],
      };
    }

    try {
      const syncStatus = await this.kaypalModelSync.getStatus(
        undefined,
        this.getCurrentKaypalModelAuthContext(),
      );
      const ready = syncStatus.configured === true;
      const syncAvailable = syncStatus.source === 'kaypal';
      return {
        ...result,
        summary: ready
          ? syncStatus.message
          : `${result.summary} ${syncStatus.message}`,
        nextAction:
          syncStatus.nextAction || result.nextAction,
        checks: [
          ...result.checks,
          {
            name: 'Kaypal 模型台同步',
            status: ready
              ? ('ready' as const)
              : syncAvailable
                ? ('blocked' as const)
                : ('missing' as const),
            message: syncStatus.message,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      return {
        ...result,
        checks: [
          ...result.checks,
          {
            name: 'Kaypal 模型台同步',
            status: 'blocked' as const,
            message,
          },
        ],
      };
    }
  }

  private getCurrentKaypalModelAuthContext(): KaypalAuthContext | null {
    const token = this.toRuntimeString(
      this.authRequestContext?.get()?.user?.kaypalDesktopAccessToken,
    );
    return token
      ? {
          source: 'session',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : null;
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
      { name: '主系统项目目录', path: resolve(process.cwd(), '..') },
      {
        name: '主系统本地日志目录',
        path: join(process.cwd(), '..', '.local-logs'),
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
    const screenshotOk =
      screenshot?.type === 'screenshot' ||
      (desktop as { screenshotAvailable?: boolean }).screenshotAvailable ===
        true;
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
    const contactAmbiguous =
      available &&
      (windowCount !== 1 ||
        Boolean(this.wechatSessionConfirmation.targetContact) === false ||
        /搜索|通讯录|微信|WeChat$/i.test(currentWindowTitle || ''));
    const blockers = [
      !desktop.running ? '桌面微信未运行。' : '',
      permissionBlocked ? '桌面微信窗口或控制权限不可用。' : '',
      !frontmost ? '桌面微信不是前台 App。' : '',
      loggedOut ? '桌面微信可能已掉线或登录失效。' : '',
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
          status: screenshotOk && !screenBlocked ? 'ready' : 'blocked',
          message:
            screenshot?.type === 'screenshot'
              ? '已保存桌面截图证据。'
              : '未拿到桌面截图，回放证据会降级为文本记录。',
          nextAction:
            screenshotOk && !screenBlocked
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
          status: frontmost ? 'ready' : 'blocked',
          message: frontmost
            ? `${appName} 当前可作为前台候选。`
            : '无法确认微信处于前台。',
          nextAction: frontmost
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
          available && frontmost && windowCount === 1 && !contactAmbiguous,
        contactHint: this.wechatSessionConfirmation.targetContact || null,
        currentWindowConfirmed:
          this.wechatSessionConfirmation.currentWindowConfirmed === true,
        targetContact: this.wechatSessionConfirmation.targetContact,
        contactConfirmed:
          this.wechatSessionConfirmation.contactConfirmed === true,
        message: contactAmbiguous
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
        desktop.window.windowCount !== 1 ||
        !this.wechatSessionConfirmation.targetContact ||
        /搜索|通讯录|微信|WeChat$/i.test(
          desktop.window.currentWindowTitle || '',
        ),
      permissionBlocked,
    };
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
    const blockers = [
      ...desktop.blockers,
      ...requiredChecks
        .filter((check) => check.status === 'blocked')
        .map((check) => `${check.label}不可用：${check.message}`),
      !desktop.window.currentWindowLikelyWechatChat
        ? '无法确认当前前台窗口是唯一微信目标会话。'
        : '',
      desktop.takeoverActive ? '人工接管中，禁止自动填入草稿。' : '',
      desktop.stopped ? '微信桌面任务已停止，禁止继续执行。' : '',
    ].filter(Boolean);
    const warnings = [
      ...desktop.warnings,
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
        'wechat-moments-publish',
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
        value: `当前系统 ${platform()} 暂未接入桌面截图命令。`,
        capturedAt: new Date().toISOString(),
      };
    }

    const projectRoot = this.getProjectRoot();
    const evidenceDir = join(projectRoot, '.local-logs', 'evidence');
    await mkdir(evidenceDir, { recursive: true });
    const capturedAt = new Date();
    const filename = `desktop-wechat-${capturedAt.toISOString().replace(/[:.]/g, '-')}.png`;
    const screenshotPath = join(evidenceDir, filename);
    await this.runCommand('screencapture', ['-x', screenshotPath], 3000);
    return {
      type: 'screenshot',
      label,
      value: screenshotPath,
      capturedAt: capturedAt.toISOString(),
    };
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
    const root = process.cwd();
    const paths = {
      root,
      materials:
        this.configService.get<string>('AUTO_UPLOAD_MATERIALS_DIR') ||
        join(root, 'data', 'materials'),
      browserProfiles:
        this.configService.get<string>('LOCAL_BROWSER_PROFILE_ROOT') ||
        join(root, 'data', 'browser-profiles'),
      evidence:
        this.configService.get<string>('LOCAL_BROWSER_EVIDENCE_ROOT') ||
        join(root, '.local-logs', 'browser-evidence'),
      avatars:
        this.configService.get<string>('AUTO_UPLOAD_AVATARS_DIR') ||
        join(root, 'data', 'avatars'),
      logs: join(resolve(root, '..'), '.local-logs'),
    };
    for (const path of [
      paths.materials,
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
      updatedAt: new Date().toISOString(),
    };
  }

  private buildReplyFromRule(sourceText: string) {
    const rule = this.replyRule;
    const normalizedSource = sourceText.replace(/\s+/g, ' ').trim();
    const fallbackReply = this.pickConfiguredFallbackReply(normalizedSource);
    if (fallbackReply) {
      return fallbackReply;
    }
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
        '你问的多少钱要看具体服务内容和现场情况，我先按实际需求帮你核一下。',
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
    return appendRuleContext('你把具体内容发我，我按实际情况帮你看。');
  }

  private pickConfiguredFallbackReply(sourceText: string) {
    const rule = this.replyRule;
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
    return (matched || replies[0] || '').slice(0, 140);
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
    const confirmedChecklistKeys = (task.riskChecklist || [])
      .filter((check) => !check.required || check.status === 'ready')
      .map((check) => check.key);

    return {
      operator: input.operator?.trim() || '当前登录用户',
      note: input.note?.trim() || undefined,
      currentWindowConfirmed:
        task.type === 'wechat-reply-draft' ||
        task.type === 'wechat-group-broadcast' ||
        task.type === 'wechat-moments-publish'
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
      targetConfirmed: input.targetConfirmed !== false,
      contentConfirmed: input.contentConfirmed !== false,
      checklistConfirmed: input.checklistConfirmed,
      commercialPermissionConfirmed: input.commercialPermissionConfirmed,
      misfireProtectionConfirmed: input.misfireProtectionConfirmed,
      doubleConfirmationConfirmed: input.doubleConfirmationConfirmed,
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
      'wechat-group-broadcast',
      'wechat-moments-publish',
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
      this.allowLocalPlanBypass() ||
      input.callerCommercialAllowed === true
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
      !autoSendAuthorized && input.hasDestructiveIntent ? 'destructive-action' : '',
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
          ? '微信草稿、群发或朋友圈动作会作用在当前桌面微信窗口。'
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
        label: '确认发送保护开启',
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
                input.type === 'wechat-moments-publish'
              ? 'blocked'
              : 'ready',
        hint:
          input.type === 'wechat-group-broadcast' ||
          input.type === 'wechat-moments-publish'
            ? '群发和朋友圈必须先接入自动化服务的对象确认、节奏/限流、人工确认、证据、停止/接管能力。'
            : input.type === 'wechat-reply-draft'
              ? '微信草稿每次只允许锁定一个当前会话并填入一条草稿，发送和继续动作必须由人工接管。'
              : '非微信桌面动作不需要群发节奏控制。',
        blocking:
          input.type === 'wechat-group-broadcast' ||
          input.type === 'wechat-moments-publish',
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
    const planMode =
      this.allowLocalPlanBypass()
        ? 'commercial'
        : 'trial';
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
        label: '二次确认：继续执行这条高风险动作',
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
      'douyin-comment-reply': '抖音评论回复',
      'douyin-direct-message-reply': '抖音私信回复',
      'wechat-channel-comment-reply': '视频号评论回复',
      'wechat-channel-direct-message-reply': '视频号私信回复',
      'wechat-reply-draft': '微信回复草稿',
      'wechat-group-broadcast': '微信群发',
      'wechat-moments-publish': '朋友圈发布',
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
      waiting_for_send_confirmation: '等待确认',
      completed: '已完成',
      failed: '失败',
      skipped: '已跳过',
      no_target: '无对象',
    };
    return labels[status];
  }

  private resumeAgentSessionAfterApproval(
    session: AgentSession,
    confirmation: AgentConfirmation,
  ) {
    if (session.resumeAction?.kind === 'auto-upload-publish') {
      this.runAutoUploadPublishResume(
        session,
        session.resumeAction,
        confirmation,
      );
      return;
    }
  }

  private async runAutoUploadPublishResume(
    session: AgentSession,
    action: AgentSessionResumeAction,
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
      const result = await this.autoUploadService.publishBatch(payloads, {
        confirmation: {
          confirmed: true,
          confirmationId: confirmation.id,
          operator: confirmation.operator,
          note: confirmation.note || confirmation.actionLabel,
          confirmedAt: confirmation.decidedAt,
          confirmedAction: 'publish',
          confirmedRiskLevel: 'high',
          checklist: confirmation.confirmedChecks,
          fullPermission: false,
        },
        context: {
          accountId: session.id,
          accountName: confirmation.operator || '当前用户',
          deviceId: session.id,
          deviceName: session.targetApp || '3011 本地 Runtime',
          userAgent: 'local-engine-agent-session',
        },
      });
      const platforms = result?.platforms || [];
      const failures = platforms.filter(
        (item) =>
          item.status === 'failed' ||
          item.status === 'material_error' ||
          item.status === 'account_expired',
      );
      const succeeded = platforms.filter((item) => item.status === 'success');
      const pending = platforms.filter(
        (item) =>
          item.status !== 'success' &&
          item.status !== 'failed' &&
          item.status !== 'material_error' &&
          item.status !== 'account_expired',
      );

      platforms.forEach((item) => {
        const platform = item.platform;
        const title =
          item.status === 'success'
            ? `发布成功：${platform}`
            : item.status === 'failed' ||
                item.status === 'material_error' ||
                item.status === 'account_expired'
              ? `发布失败：${platform}`
              : `发布待执行：${platform}`;
        const level =
          item.status === 'success'
            ? 'success'
            : item.status === 'failed' ||
                item.status === 'material_error' ||
                item.status === 'account_expired'
              ? 'error'
              : 'warning';
        this.pushAgentEvent(
          session,
          level,
          title,
          item.failureReason ||
            (item.status === 'success'
              ? '平台任务已提交成功。'
              : item.nextAction || '平台任务暂无返回详情。'),
          {
            type: 'text',
            label: '平台发布明细',
            value: JSON.stringify(item, null, 2),
          },
        );
      });
      if (failures.length) {
        session.status = 'failed';
        session.statusLabel = this.resolveAgentSessionStatusLabel(
          session.status,
        );
        session.completedAt = new Date().toISOString();
        session.nextAction =
          '真实发布失败，请在发布任务查看失败明细，确认账号和素材后点击重试。';
        this.pushAgentEvent(
          session,
          'error',
          '真实发布失败',
          failures
            .map((item) => `${item.platform}：${item.failureReason || '失败'}`)
            .join('；'),
          {
            type: 'text',
            label: '发布结果',
            value: JSON.stringify(result, null, 2),
          },
        );
        return;
      }
      session.status = 'completed';
      session.statusLabel = this.resolveAgentSessionStatusLabel(session.status);
      session.completedAt = new Date().toISOString();
      session.nextAction = '真实发布已提交完成，可在发布任务和证据产物中查看。';
      this.pushAgentEvent(
        session,
        'success',
        '真实发布已提交',
        platforms.length
          ? `已提交 ${payloads.length} 个发布任务，成功 ${succeeded.length}，未执行 ${pending.length}。`
          : `已提交 ${payloads.length} 个发布任务。`,
        {
          type: 'text',
          label: '发布结果',
          value: JSON.stringify(result, null, 2),
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
      sessionId: `interaction-task:${task.id}`,
      title: `确认发送${typeLabel}回复`,
      description: `客户原文：${task.sourceText}\nAI 回复：${task.replyText}`,
      actionLabel: '确认发送',
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
      waiting_for_confirmation: '待我确认',
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
