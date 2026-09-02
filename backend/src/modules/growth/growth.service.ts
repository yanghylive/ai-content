import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveProjectDataPath } from '../../common/project-paths';
import { KaypalMemoryService } from '../memory/memory-kaypal.service';
import {
  industryPlaybook,
  listWorkflowPlaybooks,
} from './growth-playbooks.data';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  AiEmployeeService,
  type AutoAcquisitionBillingRecord,
  type DouyinFollowUpCandidateInput,
} from '../ai-employee/ai-employee.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { CrmService } from '../crm/crm.service';
import { ActivationService } from '../activation/activation.service';
import { GrowthLeadBridgeService } from './growth-lead-bridge.service';
import { LeadConvertService } from '../leads/lead-convert.service';
import { LeadScoreService } from '../lead-intelligence/lead-score.service';
import { LeadRepository } from '../leads/lead.repository';
import { RpaExecutionStore } from '../rpa/rpa-execution-store.service';
import type {
  RpaExecutionFinalizeInput,
  RpaExecutionStepInput,
} from '../rpa/rpa-execution-store.service';
import { RpaDriverRegistry } from '../rpa/rpa-driver-registry.service';
import type { RpaDriver } from '../rpa/rpa-driver.interface';
import type { RpaSession } from '../rpa/rpa.types';
import type { RpaReasonCode, RpaStepResult } from '../rpa/rpa.types';
import {
  type ExecutorReasonCode,
  type ExecutorTask,
  type RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import {
  type GrowthAccountHealth,
  type GrowthAcquisitionConfig,
  type GrowthAcquisitionMode,
  type GrowthAcquisitionRun,
  type GrowthCommercialAuditAction,
  type GrowthCommercialAuditRecord,
  type GrowthCommercialReadiness,
  type GrowthCommercialReadinessRemediation,
  type GrowthExecutionFailureReason,
  type GrowthHomeBlocker,
  type GrowthHomeResponse,
  type GrowthHomeStats,
  type GrowthBenchmarkAccountIntakePreview,
  type GrowthIntelligenceEvidence,
  type GrowthLeadConfirmationDraft,
  type GrowthLeadConfirmationInput,
  type GrowthLeadConfirmationResult,
  type GrowthLead,
  type GrowthLeadNote,
  type GrowthOverview,
  type GrowthPlatform,
  type GrowthReports,
  type GrowthRuntimeStatus,
  type GrowthRiskMode,
  type GrowthSchedulePlan,
  type GrowthStore,
  type GrowthTaskStatus,
  type GrowthStrategyDiagnostics,
  type GrowthStrategyTemplate,
  type GrowthRunStatus,
  type GrowthWorkflowAction,
  type GrowthWorkflowStatus,
  type GrowthWorkflow,
  type RedfoxBenchmarkAccountInput,
} from './growth.types';

type QueryInput = Record<string, unknown>;
type GrowthScope = { userId: string; tenantId?: string };
type GrowthSchedulerTarget = GrowthScope & { lockKey: string };
type GrowthMembershipScope = GrowthScope & {
  role: string;
  permissions: string[];
  legacy: boolean;
  /** 当前用户是否为该租户 owner（owner 即使云端同步 role=member 也应具备完整权限） */
  isOwner?: boolean;
};
type GrowthStoreCollection =
  | 'strategies'
  | 'configs'
  | 'runs'
  | 'leads'
  | 'accountHealth'
  | 'workflows'
  | 'commercialAudits';
type GrowthPersistenceOptions = {
  scope?: GrowthScope;
  collections?: GrowthStoreCollection[];
  deleteIds?: Partial<Record<GrowthStoreCollection, string[]>>;
};

const STORE_VERSION = 1;

type AiEmployeeLeadResponse = {
  ok?: boolean;
  status?: string;
  reasonCode?: string;
  message?: string;
  detail?: string;
  candidates?: DouyinFollowUpCandidateInput[];
  evidence?: Array<{
    type?: string;
    label?: string;
    url?: string;
    path?: string;
    createdAt?: string;
    raw?: Record<string, unknown>;
  }>;
  /** 复核#4-6：driver 真实状态机记录 id（成功路径带出，供合成记录跳过；参数透传，不用单例字段） */
  rpaRecordId?: string | null;
  /** P1-2：失败回退可追责信息（前端展示"原始失败原因/是否回退/回退来源/执行 ID"） */
  fallback?: FallbackTrace;
  raw?: unknown;
};

/** P1-2：失败回退追踪（RPA 失败→回退旧链路时如实标注来源） */
type FallbackTrace = {
  attempted: boolean;
  source: 'rpa' | 'legacy-adapter' | 'manual-import' | 'none';
  rpaExecutionId: string | null;
  reasonCode: string | null;
  fallbackAllowed: boolean;
  message: string;
};

type AiEmployeeFollowUpPlan = Awaited<
  ReturnType<AiEmployeeService['planDouyinFollowUp']>
>;
type AiEmployeeFollowUpExecution = Awaited<
  ReturnType<AiEmployeeService['executeDouyinFollowUp']>
>;

@Injectable()
export class GrowthService implements OnModuleInit {
  private readonly logger = new Logger(GrowthService.name);
  private schedulerRunning = false;
  private workflowDaemonRunning = false;
  private dbMigrated = false;
  private storeSnapshotWrite: Promise<void> = Promise.resolve();
  private readonly schedulerOwnerId = `growth-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  /** T2-9：account-health 30s 短 TTL 缓存（listAccounts force 校验很慢，避免每次 2.6s） */
  private readonly accountHealthCache = new Map<
    string,
    { data: unknown; at: number }
  >();
  private static readonly ACCOUNT_HEALTH_CACHE_TTL_MS = 30_000;

  /** T2-4 防平台风控：同账号执行节流（记录最近执行时间，防连跑触发反爬） */
  private readonly acquisitionThrottle = new Map<
    string,
    { lastRunAt: number }
  >();
  private static readonly ACQUISITION_THROTTLE_MS = 60_000;

  constructor(
    private readonly aiEmployeeService: AiEmployeeService,
    private readonly autoUploadService: AutoUploadService,
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeOrchestrator,
    @Optional() private readonly kaypalMemory?: KaypalMemoryService,
    @Optional() private readonly crmService?: CrmService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional() private readonly activation?: ActivationService,
    @Optional() private readonly leadBridge?: GrowthLeadBridgeService,
    @Optional() private readonly leadConvertService?: LeadConvertService,
    @Optional() private readonly rpaExecutionStore?: RpaExecutionStore,
    @Optional() private readonly rpaDriverRegistry?: RpaDriverRegistry,
    @Optional() private readonly leadScoreService?: LeadScoreService,
  ) {}

  async onModuleInit() {
    await this.migrateLocalStoreToDatabase();
  }

  @Interval(60_000)
  async runGrowthSchedulerDaemon() {
    if (!this.isGrowthSchedulerDaemonArmed()) return;
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      const targets = await this.listGrowthSchedulerTargets();
      for (const target of targets) {
        const lease = await this.acquireGrowthSchedulerLease(target);
        if (!lease.acquired) continue;
        const heartbeat = this.startGrowthSchedulerLeaseHeartbeat(target);
        try {
          await this.runScheduledConfigs(target.userId, {
            limit: 3,
            trigger: 'daemon',
          });
          await this.releaseGrowthSchedulerLease(target, 'success');
        } catch (error) {
          await this.releaseGrowthSchedulerLease(
            target,
            'failed',
            error instanceof Error ? error.message : String(error),
          );
          this.logger.warn(
            `增长调度 target ${target.lockKey} 执行失败：${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          this.stopGrowthSchedulerLeaseHeartbeat(heartbeat);
        }
      }
    } catch (error) {
      this.logger.warn(
        `增长调度 daemon 执行失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.schedulerRunning = false;
    }
  }

  async getOverview(userId: string): Promise<GrowthOverview> {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const today = this.dateKey();
    const userLeads = store.leads.filter((item) =>
      this.inGrowthScope(item, scope),
    );
    const userRuns = store.runs.filter((item) =>
      this.inGrowthScope(item, scope),
    );
    const todayRuns = userRuns.filter((item) =>
      item.startedAt.startsWith(today),
    );
    const todayCrmCapturedCount = userLeads.filter(
      (item) => item.crmCustomerId && item.updatedAt.startsWith(today),
    ).length;
    return {
      todayLeadCount: userLeads.filter((item) =>
        item.createdAt.startsWith(today),
      ).length,
      todayContactedCount: todayRuns.reduce(
        (total, item) => total + item.contactedCount,
        0,
      ),
      todayCrmCapturedCount,
      activeConfigCount: store.configs.filter(
        (item) => this.inGrowthScope(item, scope) && item.status === 'enabled',
      ).length,
      highIntentLeadCount: userLeads.filter(
        (item) => item.score >= 75 && item.status !== 'blocked',
      ).length,
      accountRiskCount: store.accountHealth.filter(
        (item) =>
          this.inGrowthScope(item, scope) && item.riskStatus !== 'normal',
      ).length,
      funnel: {
        candidates: todayRuns.reduce(
          (total, item) => total + item.candidateCount,
          0,
        ),
        selected: todayRuns.reduce(
          (total, item) => total + item.selectedCount,
          0,
        ),
        contacted: todayRuns.reduce(
          (total, item) => total + item.contactedCount,
          0,
        ),
        crmCaptured: todayCrmCapturedCount,
        converted: userLeads.filter((item) => item.status === 'converted')
          .length,
      },
      recentRuns: userRuns.slice(0, 8),
      hotStrategies: store.strategies
        .filter((item) => this.inGrowthScope(item, scope))
        .slice(0, 6),
    };
  }

  /**
   * 3010「今日增长」首页聚合接口（开发文档 7.2 / P0-P1 计划 §2.1）。
   *
   * 聚合 overview（JSON store）+ 统一侧事实表（Lead / InteractionEvent / CrmCustomer / CrmOpportunity）。
   * null 语义铁律：每个数据块独立 try/catch，底层 service / 查询抛错时该字段返回 null
   * （前端显示「暂无数据/不可用」），禁止降级成 0（0 仅表示真实统计为空），禁止把错误冒泡成 5xx。
   */
  async getGrowthHome(
    userId: string,
    _options: { range?: 'today' | '30d' } = {},
  ): Promise<GrowthHomeResponse> {
    const generatedAt = new Date().toISOString();
    const overview = await this.getGrowthOverviewSafely(userId);
    const stats = await this.buildGrowthHomeStats(overview, userId);
    const funnel = await this.buildGrowthHomeFunnel(overview, userId);
    const blockers = await this.buildGrowthHomeBlockers(userId);
    const recentRuns = overview?.recentRuns?.slice(0, 8) ?? [];
    const nextActions: GrowthHomeResponse['nextActions'] = [
      {
        code: 'create-task',
        label: '新建获客任务',
        href: '/auto-acquisition/create',
      },
      { code: 'process-leads', label: '处理线索', href: '/growth/leads' },
      {
        code: 'account-health',
        label: '检查账号健康',
        href: '/growth/account-health',
      },
    ];

    return {
      generatedAt,
      stats,
      funnel,
      blockers,
      recentRuns,
      nextActions,
    };
  }

  /** overview 隔离：getOverview 抛错时返回 undefined（stats/funnel.recentRuns 相关字段走 null） */
  private async getGrowthOverviewSafely(userId: string) {
    try {
      return await this.getOverview(userId);
    } catch (error) {
      this.logger.warn(
        `getGrowthHome overview 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** stats：每个字段独立 try/catch，底层不可用 → null */
  private async buildGrowthHomeStats(
    overview: GrowthOverview | undefined,
    userId: string,
  ): Promise<GrowthHomeStats> {
    const overviewSafe = overview ?? ({} as GrowthOverview);
    const newLeads = await this.safeNumber(
      async () => overviewSafe.todayLeadCount,
      null,
    );
    const highIntentLeads = await this.safeNumber(
      async () => overviewSafe.highIntentLeadCount,
      null,
    );
    // pendingContact：统一 Lead 表口径（status in (new,qualified)）。
    // 与 InteractionEvent 的成功互动关联（Lead.sourceInteractionEventId → InteractionEvent.id，
    // 无成功事件的 lastError 为空）当前表达力不足且无统一状态列，保守实现为 status 过滤，
    // 注释说明口径；详见汇报。
    const pendingContact = await this.countPendingContactLeads(userId);
    const crmCaptured = await this.safeNumber(
      async () => overviewSafe.todayCrmCapturedCount,
      null,
    );
    const openOpportunityAmount = await this.sumOpenOpportunityAmount(userId);

    return {
      newLeads,
      highIntentLeads,
      pendingContact,
      crmCaptured,
      openOpportunityAmount,
    };
  }

  /** funnel：Lead/CrmCustomer/CrmOpportunity 计数，每项独立降级 */
  private async buildGrowthHomeFunnel(
    overview: GrowthOverview | undefined,
    userId: string,
  ): Promise<GrowthHomeResponse['funnel']> {
    const candidates = await this.safeNumber(
      async () => overview?.funnel?.candidates ?? null,
      null,
    );
    const selected = await this.safeNumber(
      async () => overview?.funnel?.selected ?? null,
      null,
    );
    const contacted = await this.safeNumber(
      async () => overview?.funnel?.contacted ?? null,
      null,
    );
    const leads = await this.countUnifiedLeads(userId);
    const customers = await this.countCrmCustomers(userId);
    const opportunities = await this.countCrmOpportunities(userId);
    const won = await this.countWonOpportunities(userId);

    return {
      candidates,
      selected,
      contacted,
      leads,
      customers,
      opportunities,
      won,
    };
  }

  /** blockers：优先复用 commercial readiness 的真实阻断项；不可用则用账号健康聚合降级 */
  private async buildGrowthHomeBlockers(
    userId: string,
  ): Promise<GrowthHomeBlocker[]> {
    try {
      const readiness = await this.getCommercialReadiness(userId);
      if (readiness?.blockers?.length) {
        return readiness.blockers.slice(0, 5).map((b) => ({
          code: b.code,
          title: b.title,
          ...(b.detail ? { detail: b.detail } : {}),
          action: b.action,
        }));
      }
      return [];
    } catch (error) {
      this.logger.warn(
        `getGrowthHome commercial readiness 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // 降级：账号健康风险数 > 0 时生成轻量 blocker（含守护，防止 loadStore 自身抛错）
    try {
      const store = await this.loadStore();
      const scope = await this.growthScope(userId);
      const riskAccounts = store.accountHealth.filter(
        (item) =>
          this.inGrowthScope(item, scope) && item.riskStatus !== 'normal',
      );
      if (riskAccounts.length > 0) {
        const first = riskAccounts[0];
        return [
          {
            code: 'account-health-risk',
            title: `${riskAccounts.length} 个平台账号健康异常`,
            action: `前往账号健康检查并处理 ${first.accountName} 的风险状态（${first.riskStatus}）。`,
          },
        ];
      }
      return [];
    } catch (error) {
      this.logger.warn(
        `getGrowthHome 账号健康降级不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /** 统一 Lead 表 count（scope 内） */
  private async countUnifiedLeads(userId: string): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      return await this.prisma.lead.count({
        where: this.growthScopeWhere(scope),
      });
    } catch (error) {
      this.logger.warn(
        `getGrowthHome lead count 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** pendingContact：status in (new,qualified) 的统一 Lead 数（scope 内） */
  private async countPendingContactLeads(
    userId: string,
  ): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      const where = this.growthScopeWhere(scope) as Prisma.LeadWhereInput;
      return await this.prisma.lead.count({
        where: {
          ...where,
          status: { in: ['new', 'qualified'] },
        },
      });
    } catch (error) {
      this.logger.warn(
        `getGrowthHome pendingContact count 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** CrmCustomer count（ownerId / tenant scope，archivedAt: null） */
  private async countCrmCustomers(userId: string): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      return await this.prisma.crmCustomer.count({
        where: {
          ...this.crmScopeWhere(scope),
          archivedAt: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `getGrowthHome crmCustomer count 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** opening 商机 count（archivedAt: null, stage notIn [won,lost]） */
  private async countCrmOpportunities(userId: string): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      return await this.prisma.crmOpportunity.count({
        where: {
          ...this.crmScopeWhere(scope),
          archivedAt: null,
          stage: { notIn: ['won', 'lost'] },
        },
      });
    } catch (error) {
      this.logger.warn(
        `getGrowthHome crmOpportunity count 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** won 商机 count（archivedAt: null, stage won） */
  private async countWonOpportunities(userId: string): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      return await this.prisma.crmOpportunity.count({
        where: {
          ...this.crmScopeWhere(scope),
          archivedAt: null,
          stage: 'won',
        },
      });
    } catch (error) {
      this.logger.warn(
        `getGrowthHome won opportunity count 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 未结商机金额（元）：opening 商机 amountCents 合计 / 100；无数据 → null，不返回 0 */
  private async sumOpenOpportunityAmount(
    userId: string,
  ): Promise<number | null> {
    try {
      const scope = await this.growthScope(userId);
      const agg = await this.prisma.crmOpportunity.aggregate({
        where: {
          ...this.crmScopeWhere(scope),
          archivedAt: null,
          stage: { notIn: ['won', 'lost'] },
        },
        _sum: { amountCents: true },
      });
      const cents = agg._sum?.amountCents ?? null;
      if (cents === null || cents === undefined) return null;
      return cents / 100;
    } catch (error) {
      this.logger.warn(
        `getGrowthHome open opportunity amount 不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** CRM 侧 scope：与 crm.service scopedCrmWhere 同构（tenant 存在时归属租户 + owner 私有） */
  private crmScopeWhere(scope: GrowthScope): {
    ownerId?: string;
    OR?: Array<Record<string, unknown>>;
  } {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          { ownerId: scope.userId, tenantId: null },
        ],
      };
    }
    return { ownerId: scope.userId };
  }

  /** 数值字段统一兜底：factory 抛错 → fallback（null）；成功 → number */
  private async safeNumber(
    factory: () => Promise<number | null>,
    fallback: number | null,
  ): Promise<number | null> {
    try {
      const value = await factory();
      return value ?? fallback;
    } catch (error) {
      this.logger.warn(
        `getGrowthHome 数值字段不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }

  async getRuntimeStatus(userId?: string): Promise<GrowthRuntimeStatus> {
    const executionEnabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    const schedulerDaemonEnabled =
      process.env.GROWTH_SCHEDULER_DAEMON === 'true';
    const schedulerDaemonArmed = this.isGrowthSchedulerDaemonArmed();
    const targets = await this.listGrowthSchedulerTargets();
    const plan = userId
      ? await this.getSchedulePlan(userId, { refreshAccounts: false })
      : undefined;
    const allLeases = await this.listGrowthSchedulerLeases();
    const targetLockKeys = new Set(targets.map((target) => target.lockKey));
    const leases = allLeases.filter((lease) => targetLockKeys.has(lease.id));
    const lastRunAt = leases
      .map((item) => item.lastRunAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return {
      executionEnabled,
      schedulerDaemonEnabled,
      schedulerDaemonArmed,
      schedulerLeaseMs: this.schedulerLeaseDurationMs(),
      mode: executionEnabled ? 'live-execution' : 'safety-review',
      ownerId: this.schedulerOwnerId,
      running: this.schedulerRunning,
      targetCount: targets.length,
      dueReadyCount: plan?.readyCount ?? 0,
      nextRunAt: plan?.items
        .map((item) => item.nextRunAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0],
      lastRunAt,
      staleLeaseCount: allLeases.length - leases.length,
      leases,
    };
  }

  async getCommercialReadiness(
    userId: string,
  ): Promise<GrowthCommercialReadiness> {
    const accounts = await this.listAccountHealth(userId);
    const [runtime, plan] = await Promise.all([
      this.getRuntimeStatus(userId),
      this.getSchedulePlan(userId, { refreshAccounts: false }),
    ]);
    return this.buildCommercialReadinessSnapshot(runtime, accounts, plan);
  }

  async listCommercialAuditRecords(
    userId: string,
    query: QueryInput = {},
  ): Promise<GrowthCommercialAuditRecord[]> {
    const limit = Math.max(1, Math.min(50, this.number(query.limit, 20)));
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.commercialAudits
      .filter((item) => this.inGrowthScope(item, scope))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async remediateCommercialReadiness(
    userId: string,
  ): Promise<GrowthCommercialReadinessRemediation> {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const accounts = await this.listAccountHealth(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const accountByKey = new Map(
      accounts.map((account) => [
        `${account.platform}:${account.accountId}`,
        account,
      ]),
    );
    const today = this.dateKey();
    const enabledConfigIds: string[] = [];
    const skipped: GrowthCommercialReadinessRemediation['skipped'] = [];
    let requiresHumanLogin = false;

    const configs = store.configs.map((config) => {
      if (!this.inGrowthScope(config, scope)) return config;
      const account = accountByKey.get(
        `${config.platform}:${config.accountId}`,
      );
      const exposureCount =
        config.exposureDate === today ? config.exposureCount : 0;
      const remainingToday = Math.max(0, config.dailyLimit - exposureCount);

      if (!account) {
        requiresHumanLogin = true;
        skipped.push({
          configId: config.id,
          taskName: config.taskName,
          reason: '未找到可验证的真实账号。',
          action: '先完成平台账号绑定或重新登录，再重新执行商用闭环修复。',
        });
        return config;
      }

      if (account.loginStatus !== 'online' || account.riskStatus !== 'normal') {
        requiresHumanLogin = true;
        skipped.push({
          configId: config.id,
          taskName: config.taskName,
          reason: `${account.accountName}: login=${account.loginStatus}, risk=${account.riskStatus}`,
          action:
            account.loginStatus === 'online'
              ? '先解除账号冷却或风险状态，再重新执行商用闭环修复。'
              : '先在本机浏览器/平台后台完成账号登录或验证，再重新执行商用闭环修复。',
        });
        return config;
      }

      if (config.status === 'disabled') {
        skipped.push({
          configId: config.id,
          taskName: config.taskName,
          reason: '任务已被停用。',
          action: '停用任务不会被自动恢复；确认要商用执行后手动启用。',
        });
        return config;
      }

      if (config.riskMode !== 'auto') {
        skipped.push({
          configId: config.id,
          taskName: config.taskName,
          reason: `任务风控模式为 ${config.riskMode}，不是自动执行。`,
          action: '确认允许后台自动触达后，将任务风控模式改为 auto。',
        });
        return config;
      }

      if (remainingToday <= 0) {
        skipped.push({
          configId: config.id,
          taskName: config.taskName,
          reason: '今日额度已用尽。',
          action: '等待明日额度重置，或人工降低风险后调整每日上限。',
        });
        return config;
      }

      if (config.scheduleEnabled) return config;

      enabledConfigIds.push(config.id);
      return {
        ...config,
        scheduleEnabled: true,
        updatedAt: new Date().toISOString(),
      };
    });

    if (enabledConfigIds.length > 0) {
      await this.saveStore(
        { ...store, configs },
        { scope, collections: ['configs'] },
      );
    }

    const readiness = await this.getCommercialReadiness(userId);
    const status =
      enabledConfigIds.length > 0
        ? 'changed'
        : readiness.status === 'ready'
          ? 'noop'
          : 'blocked';
    const remediation: GrowthCommercialReadinessRemediation = {
      generatedAt: new Date().toISOString(),
      status,
      changedCount: enabledConfigIds.length,
      refreshedAccountCount: accounts.length,
      enabledConfigIds,
      requiresHumanLogin,
      skipped: skipped.slice(0, 12),
      message: enabledConfigIds.length
        ? `已将 ${enabledConfigIds.length} 个真实账号自动获客任务加入后台计划。`
        : requiresHumanLogin
          ? '没有可自动修复的任务：需要先完成人工登录或账号风险处理。'
          : readiness.status === 'ready'
            ? '商用闭环已就绪，无需自动修复。'
            : '没有可自动修复的任务，请按阻断项处理。',
      readiness,
    };
    await this.recordCommercialAudit(
      userId,
      'commercial-readiness-remediate',
      readiness,
      {
        status,
        result: {
          message: remediation.message,
          changedCount: remediation.changedCount,
        },
      },
    );
    return remediation;
  }

  async previewBenchmarkAccountIntake(
    userId: string,
    input: QueryInput = {},
  ): Promise<GrowthBenchmarkAccountIntakePreview> {
    const accounts = this.benchmarkAccountInputs(input.accounts);
    if (!accounts.length)
      throw new BadRequestException('至少需要 1 个 RedFox 对标账号');

    const tenantId = await this.resolveGrowthTenantId(userId);
    const now = new Date().toISOString();
    const industry =
      this.text(input.industry) || this.inferBenchmarkIndustry(accounts);
    const scenario = this.text(input.scenario) || 'RedFox 对标账号增长';
    const evidenceChain = this.buildBenchmarkEvidenceChain(
      input,
      accounts,
      now,
    );
    const accountNicknames = accounts
      .map((account) => account.nickname)
      .filter(Boolean);
    const contentSignals = accounts.flatMap(
      (account) => account.contentSignals || [],
    );
    const intentSignals = accounts.flatMap(
      (account) => account.intentSignals || [],
    );
    const sourceKeywords = this.uniqueList([
      ...this.list(input.sourceKeywords),
      industry,
      scenario,
      ...accountNicknames,
      ...contentSignals,
    ]).slice(0, 12);
    const demandKeywords = this.uniqueList([
      ...this.list(input.demandKeywords),
      ...intentSignals,
      '求推荐',
      '多少钱',
      '哪里靠谱',
      '私信',
      '联系',
    ]).slice(0, 12);
    const excludeKeywords = this.uniqueList([
      ...this.list(input.excludeKeywords),
      '招聘',
      '招商',
      '教程',
      '官方',
      '同行',
    ]).slice(0, 12);
    const blacklistNicknames = this.uniqueList([
      ...this.list(input.blacklistNicknames),
      ...accountNicknames.filter((name) => /官方|旗舰|招商|代理/i.test(name)),
    ]).slice(0, 12);
    const scoreSignals = demandKeywords.slice(0, 5);

    return {
      generatedAt: now,
      source: 'redfox-benchmark-accounts',
      accountPoolDrafts: accounts.map((account, index) => ({
        id: this.text(account.externalUserId) || `benchmark-${index + 1}`,
        platform: account.platform,
        nickname: account.nickname,
        externalUserId: account.externalUserId,
        profileUrl: account.profileUrl,
        reason:
          account.reason || 'RedFox 对标账号命中，适合进入增长策略来源池。',
        metrics: account.metrics || {},
        suggestedUse: account.intentSignals?.length
          ? 'lead-source'
          : 'strategy-source',
        evidenceChain: this.mergeEvidenceChains(
          evidenceChain,
          account.evidence || [],
        ),
      })),
      strategyDraft: {
        userId,
        tenantId,
        industry,
        scenario,
        name: this.text(input.strategyName) || `${industry}对标账号获客策略`,
        sourceKeywords: sourceKeywords.length
          ? sourceKeywords
          : ['对标账号', industry],
        demandKeywords,
        excludeKeywords,
        blacklistNicknames,
        commentTemplates: this.uniqueList([
          ...this.list(input.commentTemplates),
          '我刚好整理过这个问题的对比资料，可以先给你一个参考。',
          '你这个需求要结合具体情况看，建议先把关键约束列出来。',
          '这个方向容易踩坑，可以先对比几个公开案例再决定。',
        ]).slice(0, 6),
        privateMessageTemplates: this.uniqueList([
          ...this.list(input.privateMessageTemplates),
          '你好，看到你在关注这个问题，我可以先发你一份公开参考清单。',
        ]).slice(0, 4),
        defaultDailyLimit: Math.min(
          30,
          Math.max(5, this.number(input.defaultDailyLimit, 20)),
        ),
        defaultRiskMode: 'confirm-first',
        scoringRules: scoreSignals.map((keyword, index) => ({
          label: `RedFox 意向信号 ${index + 1}`,
          keywords: [keyword],
          score: 12 + index * 2,
        })),
        evidenceChain,
      },
      leadConfirmationDrafts: accounts.map((account, index) =>
        this.buildBenchmarkLeadConfirmationDraft(account, index, evidenceChain),
      ),
      manualActions: [
        {
          action: 'add-benchmark-account',
          required: true,
          riskLevel: 'low',
          reason:
            '对标账号只能先进入账号池或策略来源池，避免把竞品账号误当客户。',
        },
        {
          action: 'create-growth-strategy',
          required: true,
          riskLevel: 'medium',
          reason:
            '策略草稿必须由运营确认行业、关键词、排除词和话术后才能保存或应用。',
        },
        {
          action: 'create-leads',
          required: true,
          riskLevel: 'medium',
          reason:
            '只有出现明确需求、评论意图、联系方式或咨询语境的情报，才能人工确认入线索池。',
        },
        {
          action: 'enable-acquisition-execution',
          required: true,
          riskLevel: 'high',
          reason:
            '启用真实增长获客任务会触达外部平台用户，必须走后端风险确认。',
        },
        {
          action: 'send-comment-or-message',
          required: true,
          riskLevel: 'high',
          reason:
            '任何评论、私信、加微、群发都不得由情报自动触发，必须人工确认目标、话术和账号状态。',
        },
      ],
      evidenceChain,
      nextActions: [
        '先把 accountPoolDrafts 作为对标账号池候选展示给运营确认。',
        '将 strategyDraft 保存为获客策略前，人工复核行业、关键词、排除词和默认风控模式。',
        '只把 leadConfirmationDrafts 中确认状态为 ready-for-confirmation 的条目入线索池。',
        '后续如要创建获客任务，保持 riskMode=confirm-first，执行前继续走增长安全闸。',
      ],
    };
  }

  async confirmIntelligenceLeads(
    userId: string,
    input: QueryInput = {},
  ): Promise<GrowthLeadConfirmationResult> {
    const membership = await this.requireGrowthMutationScope(userId);
    const confirmation = this.leadConfirmationInput(input);
    if (!confirmation.confirmed) {
      throw new BadRequestException(
        'RedFox 情报转线索必须由人工确认后才能入池',
      );
    }
    if (!confirmation.leads.length) {
      throw new BadRequestException('请选择至少 1 条已确认的情报线索');
    }

    const store = await this.loadStore();
    const tenantId = membership.tenantId;
    const scope: GrowthScope = { userId, tenantId };
    const now = new Date().toISOString();
    const created: GrowthLead[] = [];
    const skipped: GrowthLeadConfirmationResult['skipped'] = [];
    const duplicateMatches: GrowthLeadConfirmationResult['duplicateMatches'] =
      [];

    for (const draft of confirmation.leads) {
      const matches = [...store.leads, ...created]
        .filter((item) => this.inGrowthScope(item, scope))
        .map((item) => ({
          lead: item,
          reasons: this.duplicateReasons(draft, item),
          score: this.duplicateScore(draft, item),
        }))
        .filter((item) => item.score >= 60)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);

      if (matches.length) {
        duplicateMatches.push({ draftId: draft.id, matches });
      }
      if (matches.length && !confirmation.allowDuplicates) {
        skipped.push({
          draftId: draft.id,
          nickname: draft.nickname,
          reason: `疑似重复线索：${matches[0].reasons.join('、')}`,
        });
        continue;
      }

      const sourceText =
        draft.sourceText ||
        `${this.platformLabel(draft.platform)}对标账号：${draft.nickname}`;
      const score = this.scoreText(
        `${sourceText} ${draft.matchedKeywords.join(' ')}`,
      );
      const evidenceUrls = this.evidenceUrlsFromIntelligence(
        draft.evidenceChain,
      );
      created.push({
        id: this.id('lead'),
        userId,
        tenantId,
        platform: draft.platform,
        sourceType: 'redfox-intelligence',
        nickname: draft.nickname || 'RedFox 情报线索',
        profileUrl: draft.profileUrl,
        externalUserId: draft.externalUserId,
        sourceText,
        sourceUrl: draft.sourceUrl,
        matchedKeywords: draft.matchedKeywords,
        score: Math.max(
          0,
          Math.min(100, this.number(draft.score, score.score)),
        ),
        scoreReasons: this.uniqueList([
          ...draft.scoreReasons,
          ...score.reasons,
        ]),
        status: 'new',
        notes: [
          {
            id: this.id('note'),
            text: [
              'RedFox 情报人工确认入池。',
              confirmation.confirmedBy
                ? `确认人：${confirmation.confirmedBy}。`
                : '',
              confirmation.note ? `确认备注：${confirmation.note}` : '',
              draft.confirmationReason,
            ]
              .filter(Boolean)
              .join(' '),
            type: 'general',
            createdAt: now,
            createdBy: userId,
          },
          {
            id: this.id('note'),
            text: `证据链：${
              draft.evidenceChain
                .map((item) => item.note || item.sourceId || item.sourceUrl)
                .filter(Boolean)
                .join('；') || 'RedFox 标准化情报'
            }`,
            type: 'general',
            createdAt: now,
            createdBy: userId,
          },
        ],
        evidenceUrls,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (created.length) {
      await this.saveStore(
        {
          ...store,
          leads: [...created, ...store.leads].slice(0, 1000),
        },
        { scope, collections: ['leads'] },
      );
    }

    return {
      generatedAt: now,
      createdCount: created.length,
      skippedCount: skipped.length,
      leads: created,
      skipped,
      duplicateMatches,
    };
  }

  async listStrategies(userId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.strategies
      .filter((item) => this.inGrowthScope(item, scope))
      .map((item) => this.withStrategyDiagnostics(item));
  }

  async createStrategy(userId: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const tenantId = membership.tenantId;
    const scope: GrowthScope = membership;
    const now = new Date().toISOString();
    const strategy: GrowthStrategyTemplate = {
      id: this.id('strategy'),
      userId,
      tenantId,
      industry: this.text(input.industry) || '通用行业',
      scenario: this.text(input.scenario) || '自动获客',
      name:
        this.text(input.name) ||
        `${this.text(input.industry) || '通用'}获客策略`,
      sourceKeywords: this.list(input.sourceKeywords),
      demandKeywords: this.list(input.demandKeywords),
      excludeKeywords: this.list(input.excludeKeywords),
      blacklistNicknames: this.list(input.blacklistNicknames),
      commentTemplates: this.list(input.commentTemplates),
      privateMessageTemplates: this.list(input.privateMessageTemplates),
      defaultDailyLimit: this.number(input.defaultDailyLimit, 20),
      defaultRiskMode: this.riskMode(input.defaultRiskMode),
      scoringRules: Array.isArray(input.scoringRules)
        ? (input.scoringRules as GrowthStrategyTemplate['scoringRules'])
        : [],
      createdAt: now,
      updatedAt: now,
    };
    await this.saveStore(
      {
        ...store,
        strategies: [strategy, ...store.strategies],
      },
      { scope, collections: ['strategies'] },
    );
    return this.withStrategyDiagnostics(strategy);
  }

  async generateStrategy(userId: string, input: QueryInput) {
    const industry = this.text(input.industry) || '本地生活';
    const scenario = this.text(input.scenario) || '评论获客';
    const templates = this.defaultIndustryTemplate(industry, scenario);
    return this.createStrategy(userId, templates);
  }

  async updateStrategy(userId: string, id: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.strategies.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('获客策略不存在');
    const updated: GrowthStrategyTemplate = {
      ...existing,
      industry: this.text(input.industry) || existing.industry,
      scenario: this.text(input.scenario) || existing.scenario,
      name: this.text(input.name) || existing.name,
      sourceKeywords:
        input.sourceKeywords === undefined
          ? existing.sourceKeywords
          : this.list(input.sourceKeywords),
      demandKeywords:
        input.demandKeywords === undefined
          ? existing.demandKeywords
          : this.list(input.demandKeywords),
      excludeKeywords:
        input.excludeKeywords === undefined
          ? existing.excludeKeywords
          : this.list(input.excludeKeywords),
      blacklistNicknames:
        input.blacklistNicknames === undefined
          ? existing.blacklistNicknames
          : this.list(input.blacklistNicknames),
      commentTemplates:
        input.commentTemplates === undefined
          ? existing.commentTemplates
          : this.list(input.commentTemplates),
      privateMessageTemplates:
        input.privateMessageTemplates === undefined
          ? existing.privateMessageTemplates
          : this.list(input.privateMessageTemplates),
      defaultDailyLimit: this.number(
        input.defaultDailyLimit,
        existing.defaultDailyLimit,
      ),
      defaultRiskMode: this.riskMode(
        input.defaultRiskMode || existing.defaultRiskMode,
      ),
      updatedAt: new Date().toISOString(),
    };
    await this.saveStore(
      {
        ...store,
        strategies: store.strategies.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['strategies'] },
    );
    return this.withStrategyDiagnostics(updated);
  }

  async deleteStrategy(userId: string, id: string) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.strategies.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('获客策略不存在');
    await this.saveStore(
      {
        ...store,
        strategies: store.strategies.filter(
          (item) => !this.sameGrowthRecord(item, scope, id),
        ),
      },
      {
        scope,
        collections: ['strategies'],
        deleteIds: { strategies: [id] },
      },
    );
    return { ok: true };
  }

  async applyStrategy(userId: string, id: string, input: QueryInput = {}) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const strategy = store.strategies.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!strategy) throw new NotFoundException('获客策略不存在');
    const accounts = await this.listAccountHealth(userId);
    const requestedPlatform =
      input.platform === undefined ? undefined : this.platform(input.platform);
    const availableAccounts = requestedPlatform
      ? accounts.filter((account) => account.platform === requestedPlatform)
      : accounts;
    const account =
      availableAccounts.find(
        (item) =>
          item.platform === 'douyin' &&
          item.loginStatus === 'online' &&
          item.riskStatus === 'normal',
      ) ||
      availableAccounts.find(
        (item) => item.loginStatus === 'online' && item.riskStatus === 'normal',
      ) ||
      availableAccounts.find((item) => item.loginStatus === 'online') ||
      availableAccounts[0];
    const platform = account?.platform || requestedPlatform || 'douyin';
    if (!account || !account.accountId) {
      throw new BadRequestException(
        '暂无可用执行账号，请先在账号管理完成平台登录并验证后再套用策略。',
      );
    }
    const config = await this.createConfig(userId, {
      taskName: this.text(input.taskName) || `${strategy.name} · 自动获客`,
      mode: this.mode(input.mode) || 'keyword',
      platform,
      accountId: account.accountId,
      accountName: account.accountName,
      sourceInputs: strategy.sourceKeywords.length
        ? strategy.sourceKeywords
        : [strategy.industry, strategy.scenario],
      includeKeywords: strategy.demandKeywords,
      excludeKeywords: strategy.excludeKeywords,
      blacklistNicknames: strategy.blacklistNicknames,
      commentTemplates: strategy.commentTemplates,
      privateMessageTemplates: strategy.privateMessageTemplates,
      dailyLimit: strategy.defaultDailyLimit,
      riskMode: strategy.defaultRiskMode,
    });
    return {
      strategy: this.withStrategyDiagnostics(strategy),
      config,
      message: `已按策略生成获客任务，并绑定 ${this.platformLabel(platform)} 账号 ${account.accountName}。`,
    };
  }

  async listConfigs(userId: string, query: QueryInput = {}) {
    const mode = this.text(query.mode);
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.configs.filter(
      (item) =>
        this.inGrowthScope(item, scope) && (!mode || item.mode === mode),
    );
  }

  async getConfig(userId: string, id: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const config = store.configs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!config) throw new NotFoundException('获客任务不存在');
    return config;
  }

  async createConfig(userId: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const store = await this.loadStore();
    const tenantId = membership.tenantId;
    const scope: GrowthScope = membership;
    const now = new Date().toISOString();
    const config: GrowthAcquisitionConfig = {
      id: this.id('config'),
      userId,
      tenantId,
      mode: this.mode(input.mode),
      taskName: this.text(input.taskName) || '增长获客任务',
      platform: this.platform(input.platform),
      accountId: this.text(input.accountId),
      accountName: this.text(input.accountName),
      sourceInputs: this.list(input.sourceInputs),
      includeKeywords: this.list(input.includeKeywords),
      excludeKeywords: this.list(input.excludeKeywords),
      blacklistNicknames: this.list(input.blacklistNicknames),
      commentTemplates: this.list(input.commentTemplates),
      privateMessageTemplates: this.list(input.privateMessageTemplates),
      dailyLimit: this.number(input.dailyLimit, 20),
      perTargetLimit: this.number(input.perTargetLimit, 1),
      deduplicate: input.deduplicate !== false,
      scheduleEnabled: input.scheduleEnabled === true,
      beginTime: this.text(input.beginTime) || '09:30',
      riskMode: this.riskMode(input.riskMode),
      // 止血：新获客任务默认禁用，需用户显式启用（防保存即自动启用污染）
      status: input.status === 'enabled' ? 'enabled' : 'disabled',
      exposureCount: 0,
      exposureDate: this.dateKey(),
      createdAt: now,
      updatedAt: now,
    };
    // 复核#4：create 时 auto + 已启用 + 已过 controller 风险门 → 落审批留痕（daemon 执行依赖此字段）
    if (
      config.riskMode === 'auto' &&
      config.status === 'enabled' &&
      config.scheduleEnabled
    ) {
      config.autoApprovedAt = now;
      config.autoApprovedBy = 'backend-risk-gate';
    }
    this.assertValidConfig(config);
    await this.assertGrowthPlatformAccountScope(
      userId,
      config.platform,
      config.accountId,
      store,
    );
    await this.saveStore(
      { ...store, configs: [config, ...store.configs] },
      { scope, collections: ['configs'] },
    );
    // T3-3：创建获客任务 → 写用户长期记忆（kaypal 记忆系统，fire-and-forget 不阻塞主流程）
    void this.kaypalMemory
      ?.add(
        'long',
        `用户创建获客任务「${config.taskName}」：平台=${config.platform}，关键词=${
          (config.includeKeywords || []).join('、') || '未填'
        }，每日上限=${config.dailyLimit}，话术风格=${
          (config.commentTemplates || []).join('；').slice(0, 80) || '未配置'
        }`,
        {
          summary: `获客任务「${config.taskName}」已创建`,
          metadata: {
            source: 'ai-content',
            scope: 'acquisition-config',
            configId: config.id,
            platform: config.platform,
            keywords: config.includeKeywords,
          },
        },
      )
      .catch(() => undefined);
    return config;
  }

  async updateConfig(userId: string, id: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.configs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('获客任务不存在');
    const updated: GrowthAcquisitionConfig = {
      ...existing,
      mode: input.mode === undefined ? existing.mode : this.mode(input.mode),
      taskName: this.text(input.taskName) || existing.taskName,
      platform:
        input.platform === undefined
          ? existing.platform
          : this.platform(input.platform),
      accountId: this.text(input.accountId) || existing.accountId,
      accountName: this.text(input.accountName) || existing.accountName,
      sourceInputs:
        input.sourceInputs === undefined
          ? existing.sourceInputs
          : this.list(input.sourceInputs),
      includeKeywords:
        input.includeKeywords === undefined
          ? existing.includeKeywords
          : this.list(input.includeKeywords),
      excludeKeywords:
        input.excludeKeywords === undefined
          ? existing.excludeKeywords
          : this.list(input.excludeKeywords),
      blacklistNicknames:
        input.blacklistNicknames === undefined
          ? existing.blacklistNicknames
          : this.list(input.blacklistNicknames),
      commentTemplates:
        input.commentTemplates === undefined
          ? existing.commentTemplates
          : this.list(input.commentTemplates),
      privateMessageTemplates:
        input.privateMessageTemplates === undefined
          ? existing.privateMessageTemplates
          : this.list(input.privateMessageTemplates),
      dailyLimit: this.number(input.dailyLimit, existing.dailyLimit),
      perTargetLimit: this.number(
        input.perTargetLimit,
        existing.perTargetLimit,
      ),
      deduplicate:
        input.deduplicate === undefined
          ? existing.deduplicate
          : input.deduplicate !== false,
      scheduleEnabled:
        input.scheduleEnabled === undefined
          ? existing.scheduleEnabled
          : input.scheduleEnabled === true,
      beginTime: this.text(input.beginTime) || existing.beginTime,
      riskMode:
        input.riskMode === undefined
          ? existing.riskMode
          : this.riskMode(input.riskMode),
      // 复核#4：riskMode 切到 auto 时落审批留痕（controller 已过后端风险确认门，operator 记录在 riskAudit）
      ...(input.riskMode === 'auto' && existing.riskMode !== 'auto'
        ? {
            autoApprovedAt: new Date().toISOString(),
            autoApprovedBy: 'backend-risk-gate',
          }
        : {}),
      status:
        input.status === undefined
          ? existing.status
          : input.status === 'disabled'
            ? 'disabled'
            : 'enabled',
      updatedAt: new Date().toISOString(),
    };
    // 复核#4 审批留痕完整化：
    // - 切离 auto → 清除留痕（再启用需重新审批）；
    // - 已是 auto 且本次由禁用改启用（setConfigStatus 走这里，已过风险门）→ 补记留痕。
    if (updated.riskMode !== 'auto') {
      delete updated.autoApprovedAt;
      delete updated.autoApprovedBy;
    } else if (
      !updated.autoApprovedAt &&
      input.status === 'enabled' &&
      existing.status !== 'enabled'
    ) {
      updated.autoApprovedAt = new Date().toISOString();
      updated.autoApprovedBy = 'backend-risk-gate';
    }
    this.assertValidConfig(updated);
    await this.assertGrowthPlatformAccountScope(
      userId,
      updated.platform,
      updated.accountId,
      store,
    );
    await this.saveStore(
      {
        ...store,
        configs: store.configs.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['configs'] },
    );
    return updated;
  }

  async deleteConfig(userId: string, id: string) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.configs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('获客任务不存在');
    await this.saveStore(
      {
        ...store,
        configs: store.configs.filter(
          (item) => !this.sameGrowthRecord(item, scope, id),
        ),
      },
      {
        scope,
        collections: ['configs'],
        deleteIds: { configs: [id] },
      },
    );
    return { ok: true };
  }

  async setConfigStatus(userId: string, id: string, enabled: boolean) {
    return this.updateConfig(userId, id, {
      status: enabled ? 'enabled' : 'disabled',
    });
  }

  async executeConfig(
    userId: string,
    id: string,
    options: {
      confirmedExecution?: boolean;
      /** 复核#4 可追责：触发来源（默认 manual） */
      trigger?: 'manual' | 'scheduled' | 'workflow' | 'api';
    } = {},
  ) {
    const trigger = options.trigger ?? 'manual';
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const config = store.configs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!config) throw new NotFoundException('获客任务不存在');
    await this.assertGrowthPlatformAccountScope(
      userId,
      config.platform,
      config.accountId,
      store,
    );
    if (config.status === 'disabled')
      throw new BadRequestException('获客任务已停用');
    const today = this.dateKey();
    const normalizedConfig =
      config.exposureDate === today
        ? config
        : { ...config, exposureDate: today, exposureCount: 0 };
    const accountHealth = store.accountHealth.find((item) =>
      this.sameGrowthAccount(
        item,
        scope,
        normalizedConfig.platform,
        normalizedConfig.accountId,
      ),
    );
    const executionEnabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    if (!accountHealth) {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: '未找到可验证的执行账号，已阻止增长获客执行。',
        failureReason: 'account_not_logged_in',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }
    if (accountHealth?.loginStatus && accountHealth.loginStatus !== 'online') {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message:
          accountHealth.loginStatus === 'verification-required'
            ? `账号 ${accountHealth.accountName} 需要人工验证，已阻止自动获客执行。`
            : `账号 ${accountHealth.accountName} 未登录或已过期，已阻止自动获客执行。`,
        failureReason:
          accountHealth.loginStatus === 'verification-required'
            ? 'captcha_required'
            : 'account_not_logged_in',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }
    if (accountHealth?.riskStatus && accountHealth.riskStatus !== 'normal') {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: `账号 ${accountHealth.accountName} 当前风险状态为 ${accountHealth.riskStatus}，已阻止自动获客执行。`,
        failureReason: 'account_risk_control',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }
    const remaining = Math.max(
      0,
      normalizedConfig.dailyLimit - normalizedConfig.exposureCount,
    );
    if (remaining <= 0) {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: '当天触达次数已达到上限',
        failureReason: 'daily_limit_reached',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }

    // T2-4 防平台风控：同账号执行节流（防连跑触发平台反爬）+ 人类化随机延迟
    const throttleKey = `${normalizedConfig.platform}:${normalizedConfig.accountId}`;
    const throttle = this.acquisitionThrottle.get(throttleKey);
    if (
      throttle &&
      Date.now() - throttle.lastRunAt < GrowthService.ACQUISITION_THROTTLE_MS
    ) {
      const waitMs = Math.max(
        0,
        GrowthService.ACQUISITION_THROTTLE_MS -
          (Date.now() - throttle.lastRunAt),
      );
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: `防平台风控：账号 ${normalizedConfig.accountName || normalizedConfig.accountId} 距上次执行不足 ${
          GrowthService.ACQUISITION_THROTTLE_MS / 1000
        }s，已节流（还需 ${Math.ceil(waitMs / 1000)}s），避免触发平台反爬。`,
        failureReason: 'throttled',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }
    // 人类化随机延迟（仅 daemon 自动执行时，模拟人工操作节奏）
    if (trigger === 'scheduled' || trigger === 'workflow') {
      const jitter = 2000 + Math.floor(Math.random() * 6000); // 2-8s
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }

    const executionCapability =
      this.growthAutoExecutionCapability(normalizedConfig);
    // D 阶段：小红书/快手自动触达未接入 → auto 无人值守被能力门拒绝；
    // 手动 confirm-first 确认执行允许走「发现 → 候选沉淀线索池（partial，触达待人工）」。
    const isManualConfirmed =
      normalizedConfig.riskMode === 'confirm-first' &&
      options.confirmedExecution === true;
    // T2-4c：daemon 调度 + confirm-first/draft-only → 「自动采集 + 候选沉淀线索池」，
    // 不真实触达（触达仍人工确认）。解决"任务 7 天 0 产出"，同时不触碰真实平台操作。
    const collectOnly =
      (trigger === 'scheduled' || trigger === 'workflow') &&
      (normalizedConfig.riskMode === 'confirm-first' ||
        normalizedConfig.riskMode === 'draft-only');
    if (!executionCapability.ready && !isManualConfirmed && !collectOnly) {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: executionCapability.reason,
        failureReason: 'engine_unavailable',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }

    const executionApproved =
      normalizedConfig.riskMode === 'auto' ||
      (normalizedConfig.riskMode === 'confirm-first' &&
        options.confirmedExecution === true) ||
      collectOnly;

    // 复核#4：自动触发（daemon/workflow）执行 auto 任务必须有启用审批留痕，
    // 无 autoApprovedAt 一律拒绝（manual 手动执行走逐次风险确认，不受此门限制）。
    const automatedTrigger = trigger === 'scheduled' || trigger === 'workflow';
    if (
      normalizedConfig.riskMode === 'auto' &&
      automatedTrigger &&
      !normalizedConfig.autoApprovedAt
    ) {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message:
          '自动触达任务缺少启用审批留痕（autoApprovedAt），已阻止自动执行；请在启用任务时完成风险确认后再运行。',
        failureReason: 'engine_unavailable',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }

    if (!executionEnabled || !executionApproved) {
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'skipped',
        message: executionEnabled
          ? normalizedConfig.riskMode === 'draft-only'
            ? `风控预检通过：账号可执行、今日剩余额度 ${remaining}，平台能力为「${this.platformCapabilityLabel(normalizedConfig.platform, normalizedConfig.mode)}」。任务当前为「draft-only」，只生成草稿，不触发外部平台执行。`
            : `风控预检通过：账号可执行、今日剩余额度 ${remaining}，平台能力为「${this.platformCapabilityLabel(normalizedConfig.platform, normalizedConfig.mode)}」。任务当前为「confirm-first」，需要本次后端确认后才会触发外部平台执行。`
          : `风控预检通过：账号可执行、今日剩余额度 ${remaining}，平台能力为「${this.platformCapabilityLabel(normalizedConfig.platform, normalizedConfig.mode)}」。当前为安全演练，未触发采集、评论、私信或外部平台执行。`,
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }

    // 复核#4-6：driver 成功路径的状态机记录 id（try 内赋值，catch 分支共用，防并发串单）
    let driverRpaRecordId: string | null = null;
    try {
      // T2-4 防平台风控：真实执行前记录本次执行时间（供下次节流判断）
      this.acquisitionThrottle.set(throttleKey, { lastRunAt: Date.now() });
      const candidateResponse = await this.fetchCandidatesWithAiEmployee(
        normalizedConfig,
        remaining,
      );
      const candidates = Array.isArray(candidateResponse.candidates)
        ? candidateResponse.candidates
        : [];
      // 复核#4-6：driver 成功路径的状态机记录 id 参数透传（防并发串单）
      driverRpaRecordId = candidateResponse.rpaRecordId ?? null;
      const candidateEvidenceUrls = this.evidenceUrls(
        candidateResponse.evidence,
      );
      if (!candidates.length) {
        return this.createRunResult(normalizedConfig, {
          trigger,
          status: candidateResponse.ok === false ? 'failed' : 'skipped',
          failureReason:
            candidateResponse.ok === false
              ? this.mapReasonCode(candidateResponse.reasonCode)
              : 'target_not_found',
          message:
            candidateResponse.message ||
            '没有采集到可跟进的候选线索，已结束本次执行。',
          candidateCount: 0,
          selectedCount: 0,
          contactedCount: 0,
          evidenceUrls: candidateEvidenceUrls,
          rpaRecordId: driverRpaRecordId,
          fallback: candidateResponse.fallback,
        });
      }

      if (normalizedConfig.mode === 'search-account') {
        const accountCandidates = candidates.slice(0, remaining);
        const leads = accountCandidates.map((candidate, index) =>
          this.createLeadFromCandidate(
            userId,
            normalizedConfig,
            candidate,
            index,
            candidateEvidenceUrls,
          ),
        );
        return this.createRunResult(normalizedConfig, {
          trigger,
          status: candidateResponse.ok === false ? 'failed' : 'success',
          failureReason:
            candidateResponse.ok === false
              ? this.mapReasonCode(candidateResponse.reasonCode)
              : undefined,
          message:
            candidateResponse.message ||
            `已完成账号搜索并留存 ${accountCandidates.length} 条候选结果。`,
          candidateCount: candidates.length,
          selectedCount: accountCandidates.length,
          contactedCount: 0,
          quotaConsumedCount: accountCandidates.length,
          evidenceUrls: candidateEvidenceUrls,
          rpaRecordId: driverRpaRecordId,
          leads,
        });
      }

      // D 阶段修正（大王纠错）：获客线索 = 评论区表达需求的用户（对齐抖音"读评论找客户"）。
      // 发现层返回的是内容（笔记/视频），必须读评论拿用户；评论不可达 → 如实失败，不把内容当客户。
      if (!this.platformTouchReady(normalizedConfig.platform)) {
        // P1 复核：读评论关闭失败经 closeState 回传 → run 标注需人工核对（不静默）
        const commentCloseState: { failed: boolean } = { failed: false };
        const commentLeads = await this.fetchCommentUsersAsLeads(
          normalizedConfig,
          candidates,
          remaining,
          commentCloseState,
        );
        if (!commentLeads.length) {
          return this.createRunResult(normalizedConfig, {
            trigger,
            status: 'failed',
            failureReason: 'target_not_found',
            fallback: candidateResponse.fallback,
            message: `${this.platformLabel(normalizedConfig.platform)} 网页版内容详情页被平台反爬拦截或无可读评论，无法获取评论用户线索；请改用抖音或人工跟进。`,
            candidateCount: candidates.length,
            selectedCount: 0,
            contactedCount: 0,
            evidenceUrls: candidateEvidenceUrls,
            rpaRecordId: driverRpaRecordId,
          });
        }
        return this.createRunResult(normalizedConfig, {
          trigger,
          status: 'partial',
          message: `发现 ${candidates.length} 条内容，读评论获得 ${commentLeads.length} 个评论用户线索；${this.platformLabel(normalizedConfig.platform)} 自动触达未接入，需人工跟进。${
            commentCloseState.failed
              ? '且浏览器会话关闭失败，需人工核对平台实际结果。'
              : ''
          }`,
          candidateCount: candidates.length,
          selectedCount: commentLeads.length,
          contactedCount: 0,
          evidenceUrls: candidateEvidenceUrls,
          leadIds: commentLeads.map((lead) => lead.id),
          leads: commentLeads,
          rpaRecordId: driverRpaRecordId,
        });
      }

      // T2-4c：daemon 采集模式（confirm-first/draft-only）→ 抖音也走「读评论沉淀线索」，
      // 不执行真实评论/私信触达；触达留在用户人工确认后执行。
      if (collectOnly && this.platformTouchReady(normalizedConfig.platform)) {
        const commentCloseState: { failed: boolean } = { failed: false };
        const commentLeads = await this.fetchCommentUsersAsLeads(
          normalizedConfig,
          candidates,
          remaining,
          commentCloseState,
        );
        if (!commentLeads.length) {
          return this.createRunResult(normalizedConfig, {
            trigger,
            status: 'partial',
            failureReason: 'target_not_found',
            fallback: candidateResponse.fallback,
            message: `${this.platformLabel(normalizedConfig.platform)} 本次未读到评论用户线索；已保留采集证据，请在线索池人工确认后执行触达。`,
            candidateCount: candidates.length,
            selectedCount: 0,
            contactedCount: 0,
            evidenceUrls: candidateEvidenceUrls,
            rpaRecordId: driverRpaRecordId,
          });
        }
        return this.createRunResult(normalizedConfig, {
          trigger,
          status: 'partial',
          message: `【自动采集】发现 ${candidates.length} 条内容，沉淀 ${commentLeads.length} 个评论用户候选线索；触达待你确认后执行。${
            commentCloseState.failed
              ? '且浏览器会话关闭失败，需人工核对平台实际结果。'
              : ''
          }`,
          candidateCount: candidates.length,
          selectedCount: commentLeads.length,
          contactedCount: 0,
          evidenceUrls: candidateEvidenceUrls,
          leadIds: commentLeads.map((lead) => lead.id),
          leads: commentLeads,
          rpaRecordId: driverRpaRecordId,
        });
      }

      // planDouyinFollowUp 同步实现，但测试里 mock 为 async；用 Promise.resolve 包一层统一 await
      const followUpPlan = await Promise.resolve(
        this.aiEmployeeService.planDouyinFollowUp({
          candidates,
          sourceLabel: this.platformLabel(normalizedConfig.platform),
          sourceText:
            normalizedConfig.sourceInputs.join('、') ||
            normalizedConfig.taskName,
          accountName:
            normalizedConfig.accountName || normalizedConfig.accountId,
          commentTemplates: normalizedConfig.commentTemplates,
          messageTemplates: normalizedConfig.privateMessageTemplates,
          dailyLimit: normalizedConfig.dailyLimit,
          maxTargets: remaining,
          maxActionsPerTarget: normalizedConfig.perTargetLimit,
          includeKeywords: normalizedConfig.includeKeywords,
          blacklistKeywords: [
            ...normalizedConfig.excludeKeywords,
            ...normalizedConfig.blacklistNicknames,
          ],
        }),
      );
      if (!followUpPlan.targets.length) {
        return this.createRunResult(normalizedConfig, {
          trigger,
          status: 'skipped',
          failureReason: 'target_not_found',
          message:
            followUpPlan.summary.nextAction ||
            '候选线索未达到跟进条件，已跳过本次执行。',
          candidateCount: candidates.length,
          selectedCount: 0,
          contactedCount: 0,
          evidenceUrls: candidateEvidenceUrls,
          rpaRecordId: driverRpaRecordId,
        });
      }

      const execution = await this.executePlatformFollowUp(
        normalizedConfig,
        followUpPlan.targets,
        remaining,
      );
      const executionEvidenceUrls = Array.from(
        new Set([
          ...candidateEvidenceUrls,
          ...this.evidenceUrls(
            execution.results?.flatMap((item) => item.evidence) || [],
          ),
        ]),
      );
      const leads = followUpPlan.targets.map((target, index) =>
        this.createLeadFromCandidate(
          userId,
          normalizedConfig,
          target,
          index,
          executionEvidenceUrls,
        ),
      );
      this.applyExecutionToLeads(leads, execution);
      const successCount =
        execution.summary?.successCount ??
        execution.results?.filter((item) => item.ok).length ??
        0;
      const failureReason =
        execution.status === 'failed'
          ? this.mapReasonCode(
              execution.results?.find((item) => !item.ok)?.reasonCode,
            )
          : undefined;
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: this.followUpStatusToRunStatus(execution.status),
        failureReason,
        message: execution.message,
        candidateCount: candidates.length,
        selectedCount: followUpPlan.targets.length,
        contactedCount: successCount,
        evidenceUrls: executionEvidenceUrls,
        leadIds: leads.map((lead) => lead.id),
        leads,
        rpaRecordId: driverRpaRecordId,
      });
    } catch (error) {
      // P1 复核：账号忙（并发执行同一账号被 createWithLock 拦截）→ 透传给 controller 转 409，
      // 与主 RPA 控制器统一语义；不转 failed run（否则并发仍会绕过锁各建一条记录）。
      if (error instanceof ConflictException) {
        throw error;
      }
      return this.createRunResult(normalizedConfig, {
        trigger,
        status: 'failed',
        failureReason: this.mapReasonCode(
          error && typeof error === 'object'
            ? (error as { reasonCode?: string; code?: string }).reasonCode ||
                (error as { code?: string }).code
            : undefined,
        ),
        message: error instanceof Error ? error.message : '真实执行器调用失败',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
        rpaRecordId: driverRpaRecordId,
      });
    }
  }

  async preflightConfig(userId: string, id: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const config = store.configs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!config) throw new NotFoundException('获客任务不存在');
    const accounts = await this.listAccountHealth(userId);
    const plan = this.buildSchedulePlan([config], accounts);
    const account = accounts.find(
      (item) =>
        item.platform === config.platform &&
        item.accountId === config.accountId,
    );
    const planItem = plan.items[0];
    const blockers: string[] = [];
    const executionEnabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    const executionCapability = this.growthAutoExecutionCapability(config);
    const willExecuteAfterConfirmation =
      executionEnabled && config.riskMode !== 'draft-only';
    const warnings: string[] = [
      willExecuteAfterConfirmation
        ? executionCapability.ready
          ? config.riskMode === 'confirm-first'
            ? '真实执行开关已开启，本次后端确认通过后会进入平台执行器；请确认账号、额度、话术和证据回读均可接受。'
            : '真实执行开关已开启，自动任务到期后会进入平台执行器；请确认账号、额度、话术和证据回读均可接受。'
          : `真实执行开关已开启，但该任务当前不能自动执行：${executionCapability.reason}`
        : config.riskMode === 'draft-only'
          ? '任务为草稿模式，本次确认只做安全审阅，不会触发真实采集、评论、私信或外部平台执行。'
          : '真实执行开关未开启，当前确认只做安全审阅，不会触发真实采集、评论、私信或外部平台执行。',
      `${this.platformLabel(config.platform)}：${this.platformCapabilityLabel(config.platform, config.mode)}。`,
    ];
    const checks: string[] = [
      `任务状态：${config.status === 'disabled' ? '已停用' : '可进入预检'}`,
      `执行模式：${this.modeLabel(config.mode)}，风控策略：${config.riskMode}`,
      `今日剩余额度：${planItem?.remainingToday ?? Math.max(0, config.dailyLimit - config.exposureCount)}/${config.dailyLimit}`,
    ];

    if (config.status === 'disabled')
      blockers.push('任务已停用，请先启用任务。');
    if (!account) {
      blockers.push('未找到可验证的执行账号。');
    } else {
      checks.push(
        `账号：${account.accountName}，登录状态 ${account.loginStatus}，风险状态 ${account.riskStatus}`,
      );
      if (account.loginStatus !== 'online')
        blockers.push('账号未在线或需要人工验证。');
      if (account.riskStatus === 'cooldown')
        blockers.push(
          `账号冷却中，${this.cooldownRemainingLabel(account.cooldownUntil)} 后可重新预检。`,
        );
      if (account.riskStatus !== 'normal' && account.riskStatus !== 'cooldown')
        blockers.push(`账号风险状态为 ${account.riskStatus}。`);
      if (account.failureRate >= 0.2)
        warnings.push(
          `账号失败率 ${Math.round(account.failureRate * 100)}%，建议降低频率或继续冷却。`,
        );
    }
    if (!executionCapability.ready) blockers.push(executionCapability.reason);
    if (planItem?.remainingToday === 0) blockers.push('今日额度已用尽。');
    if (config.riskMode === 'auto' && !executionEnabled)
      warnings.push(
        '任务配置为自动触达，但真实执行开关未开启；当前只生成安全确认单，不执行发送动作。',
      );
    if (config.dailyLimit > 50)
      warnings.push('每日上限偏高，建议冷启动阶段控制在 20-50。');

    const allowed = blockers.length === 0;
    return {
      allowed,
      summary: allowed
        ? willExecuteAfterConfirmation
          ? '账号、额度和平台能力已通过预检；完成本次后端风险确认后会调用真实执行器并保存证据。'
          : '账号、额度和平台能力已通过预检；当前只记录安全审阅，不触发外部执行。'
        : '存在阻断项，不能进入真实执行；请先处理账号、冷却或额度问题。',
      config,
      account,
      planItem,
      remainingToday:
        planItem?.remainingToday ??
        Math.max(0, config.dailyLimit - config.exposureCount),
      checks,
      warnings,
      blockers,
    };
  }

  async getSchedulePlan(
    userId: string,
    options: { refreshAccounts?: boolean } = {},
  ): Promise<GrowthSchedulePlan> {
    const configs = await this.listConfigs(userId);
    const scope = await this.growthScope(userId);
    const accounts =
      options.refreshAccounts === false
        ? (await this.loadStore()).accountHealth.filter((item) =>
            this.inGrowthScope(item, scope),
          )
        : await this.listAccountHealth(userId);
    return this.buildSchedulePlan(configs, accounts);
  }

  async runScheduledConfigs(userId: string, input: QueryInput = {}) {
    await this.requireGrowthMutationScope(userId, { platformAccount: true });
    const limit = Math.max(1, Math.min(10, this.number(input.limit, 5)));
    const trigger = this.text(input.trigger) || 'manual';
    const plan = await this.getSchedulePlan(userId, {
      refreshAccounts: trigger !== 'daemon',
    });
    const scope = await this.growthScope(userId);
    const accounts = (await this.loadStore()).accountHealth.filter((item) =>
      this.inGrowthScope(item, scope),
    );
    const runtime = await this.getRuntimeStatus(userId);
    const readiness = this.buildCommercialReadinessSnapshot(
      runtime,
      accounts,
      plan,
    );
    const executionEnabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    const configById = new Map(
      (await this.listConfigs(userId)).map((config) => [config.id, config]),
    );
    const readyItems = plan.items
      .filter((item) => {
        const config = configById.get(item.configId);
        // 复核#4：自动发送必须有审批留痕，无 autoApprovedAt 的 auto 任务拒绝 daemon 执行
        const approved = Boolean(config?.autoApprovedAt);
        // T2-4c：confirm-first 任务允许 daemon 执行「自动采集 → 候选沉淀线索池」
        // （不真实触达，触达仍人工确认），解决"任务 7 天 0 产出"问题；
        // auto 任务仍须 autoApprovedAt 审批留痕。
        const riskEligible =
          config?.riskMode === 'auto'
            ? approved
            : config?.riskMode === 'confirm-first' ||
              config?.riskMode === 'draft-only';
        return (
          executionEnabled &&
          item.status === 'ready' &&
          riskEligible &&
          config?.status === 'enabled'
        );
      })
      .slice(0, limit);
    const results: Array<{
      config: GrowthAcquisitionConfig;
      run: GrowthAcquisitionRun;
      leads: GrowthLead[];
    }> = [];
    for (const item of readyItems) {
      results.push(
        await this.executeConfig(userId, item.configId, {
          trigger: 'scheduled',
        }),
      );
    }
    const response = {
      plan,
      executedCount: results.length,
      results,
      message: results.length
        ? `已执行 ${results.length} 个到期获客任务。`
        : executionEnabled
          ? '当前没有到期且允许自动执行的获客任务。'
          : '真实执行开关未开启，当前只生成计划和安全预检，不会触发外部平台动作。',
    };
    await this.recordCommercialAudit(
      userId,
      'acquisition-schedule-run',
      readiness,
      {
        status: readiness.status,
        result: {
          message: response.message,
          executedCount: response.executedCount,
          requestedLimit: limit,
          trigger,
        },
      },
    );
    return response;
  }

  async listRuns(userId: string, query: QueryInput = {}) {
    const configId = this.text(query.configId);
    const scope = await this.growthScope(userId);
    const pageSize = this.queryPageSize(query.pageSize);
    const offset = this.queryOffset(query.page, query.offset, pageSize);
    // 六步闭环 P1-14：数据库分页 + 服务端筛选（不再全量 loadStore 后内存过滤）。
    // 无数据库 delegate（测试环境 mock）时回退 loadStore，保持行为兼容。
    if (!this.hasDbListDelegates()) {
      const store = await this.loadStore();
      return store.runs
        .filter(
          (item) =>
            this.inGrowthScope(item, scope) &&
            (!configId || item.configId === configId),
        )
        .slice(offset, offset + pageSize);
    }
    const where: Prisma.GrowthAcquisitionRunWhereInput = {
      ...(this.growthScopeWhere(
        scope,
      ) as Prisma.GrowthAcquisitionRunWhereInput),
      ...(configId ? { configId } : {}),
    };
    const rows = await this.prisma.growthAcquisitionRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: pageSize,
    });
    return rows.map((item) => this.mapRunRow(item));
  }

  async getRun(userId: string, id: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const run = store.runs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!run) throw new NotFoundException('获客执行记录不存在');
    return run;
  }

  /** §6.1 取消执行：running/queued → cancelled（释放租约，不再调度） */
  async cancelRun(userId: string, id: string) {
    await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const run = store.runs.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!run) throw new NotFoundException('获客执行记录不存在');
    if (run.status !== 'running' && run.status !== 'queued') {
      throw new BadRequestException(
        `只有运行中或排队中的执行可取消（当前 ${run.status}）`,
      );
    }
    run.status = 'cancelled';
    run.endedAt = new Date().toISOString();
    run.message = `已由用户取消（${new Date().toISOString()}）`;
    await this.saveStore(store);
    // 释放该用户调度租约（若持有），避免残留调度
    try {
      await this.releaseGrowthSchedulerLease(
        { userId, lockKey: `growth-scheduler:${userId}` },
        'failed',
        'cancelled by user',
      );
    } catch (error) {
      this.logger.warn(
        `取消执行后释放调度租约失败（不阻断）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.logger.log(`获客执行 ${id} 已取消（userId=${userId}）`);
    return run;
  }

  async listLeads(userId: string, query: QueryInput = {}) {
    const status = this.text(query.status);
    const platform = this.text(query.platform);
    const q = this.text(query.q).toLowerCase();
    const scope = await this.growthScope(userId);
    const pageSize = this.queryPageSize(query.pageSize);
    const offset = this.queryOffset(query.page, query.offset, pageSize);
    // 六步闭环 P1-14：数据库分页 + 服务端筛选（status/platform/q 下推）。
    // 无数据库 delegate（测试环境 mock）时回退 loadStore，保持行为兼容。
    if (!this.hasDbListDelegates()) {
      const store = await this.loadStore();
      return store.leads
        .filter((item) => {
          if (!this.inGrowthScope(item, scope)) return false;
          if (status && status !== 'all' && item.status !== status)
            return false;
          if (platform && platform !== 'all' && item.platform !== platform)
            return false;
          if (
            q &&
            !`${item.nickname} ${item.sourceText} ${item.matchedKeywords.join(' ')}`
              .toLowerCase()
              .includes(q)
          ) {
            return false;
          }
          return true;
        })
        .slice(offset, offset + pageSize);
    }
    const where: Prisma.LeadWhereInput = {
      ...(this.growthScopeWhere(scope) as Prisma.LeadWhereInput),
      sourceType: { notIn: ['comment', 'dm'] },
      ...(status && status !== 'all' ? { status } : {}),
      ...(platform && platform !== 'all' ? { platform } : {}),
      ...(q
        ? {
            OR: [
              { nickname: { contains: q } },
              { sourceText: { contains: q } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: pageSize,
    });
    return rows.map((item) => this.mapLeadRow(item));
  }

  async createLead(userId: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const tenantId = membership.tenantId;
    const scope: GrowthScope = membership;
    const now = new Date().toISOString();
    const sourceText = this.text(input.sourceText) || '手动创建线索';
    const status = this.leadStatus(input.status) || 'new';
    const lead: GrowthLead = {
      id: this.id('lead'),
      userId,
      tenantId,
      platform: this.platform(input.platform),
      sourceType: this.leadSourceType(input.sourceType),
      sourceTaskId: this.text(input.sourceTaskId),
      sourceRunId: this.text(input.sourceRunId),
      nickname: this.text(input.nickname) || '未知线索',
      profileUrl: this.text(input.profileUrl),
      avatarUrl: this.text(input.avatarUrl),
      externalUserId: this.text(input.externalUserId),
      sourceText,
      sourceUrl: this.text(input.sourceUrl),
      videoTitle: this.text(input.videoTitle),
      videoUrl: this.text(input.videoUrl),
      commentTime: this.text(input.commentTime),
      matchedKeywords: this.list(input.matchedKeywords),
      score: this.number(input.score, this.scoreText(sourceText).score),
      scoreReasons: this.list(input.scoreReasons),
      status,
      nextFollowUpAt: this.text(input.nextFollowUpAt) || undefined,
      notes: this.createInitialLeadNotes(userId, input),
      evidenceUrls: this.list(input.evidenceUrls),
      latestReply: this.text(input.latestReply),
      createdAt: now,
      updatedAt: now,
    };
    await this.saveStore(
      { ...store, leads: [lead, ...store.leads] },
      { scope, collections: ['leads'] },
    );
    return lead;
  }

  async updateLead(userId: string, id: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.leads.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('线索不存在');
    const nextStatus = this.leadStatus(input.status);
    const sourceText = this.text(input.sourceText);
    const scoreInput =
      input.score === undefined
        ? existing.score
        : this.number(input.score, existing.score);
    const now = new Date().toISOString();
    const notes = [...(existing.notes || [])];
    const followUpNote = this.text(input.followUpNote || input.noteText);
    if (followUpNote) {
      notes.unshift({
        id: this.id('note'),
        text: followUpNote,
        type: 'follow-up',
        createdAt: now,
        createdBy: userId,
      });
    }
    if (nextStatus && nextStatus !== existing.status) {
      notes.unshift({
        id: this.id('note'),
        text: `状态从「${existing.status}」流转为「${nextStatus}」。`,
        type: 'status-change',
        createdAt: now,
        createdBy: userId,
      });
    }
    const updated: GrowthLead = {
      ...existing,
      platform:
        input.platform === undefined
          ? existing.platform
          : this.platform(input.platform),
      nickname: this.text(input.nickname) || existing.nickname,
      profileUrl:
        input.profileUrl === undefined
          ? existing.profileUrl
          : this.text(input.profileUrl),
      sourceText: sourceText || existing.sourceText,
      sourceUrl:
        input.sourceUrl === undefined
          ? existing.sourceUrl
          : this.text(input.sourceUrl),
      matchedKeywords:
        input.matchedKeywords === undefined
          ? existing.matchedKeywords
          : this.list(input.matchedKeywords),
      score: Math.max(0, Math.min(100, scoreInput)),
      scoreReasons:
        input.scoreReasons === undefined
          ? existing.scoreReasons
          : this.list(input.scoreReasons),
      status: nextStatus || existing.status,
      nextFollowUpAt:
        input.nextFollowUpAt === undefined
          ? existing.nextFollowUpAt
          : this.text(input.nextFollowUpAt),
      ownerUserId:
        input.ownerUserId === undefined
          ? existing.ownerUserId
          : this.text(input.ownerUserId),
      latestReply:
        input.latestReply === undefined
          ? existing.latestReply
          : this.text(input.latestReply),
      evidenceUrls:
        input.evidenceUrls === undefined
          ? existing.evidenceUrls
          : this.list(input.evidenceUrls),
      notes,
      updatedAt: now,
    };
    await this.saveStore(
      {
        ...store,
        leads: store.leads.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['leads'] },
    );
    // T4-8 学习闭环：用户把线索标记为无效（ignored/blocked）→ 写记忆反馈，AI 下次校准评分
    if (
      nextStatus &&
      nextStatus !== existing.status &&
      (nextStatus === 'ignored' || nextStatus === 'blocked')
    ) {
      const memoText = `用户将线索标记为无效（${nextStatus}）：平台=${updated.platform}，命中词=${(updated.matchedKeywords || []).slice(0, 3).join('、')}，评论摘要=${(updated.sourceText || '').slice(0, 60)}。评分需下调此类线索权重。`;
      void this.kaypalMemory?.add?.('daily', memoText, {
        summary: 'acquisition-learning',
        metadata: { scope: 'lead-feedback', leadId: id, verdict: nextStatus },
      });
    }
    return updated;
  }

  async deleteLead(userId: string, id: string) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.leads.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('线索不存在');
    await this.saveStore(
      {
        ...store,
        leads: store.leads.filter(
          (item) => !this.sameGrowthRecord(item, scope, id),
        ),
        runs: store.runs.map((run) =>
          this.inGrowthScope(run, scope)
            ? { ...run, leadIds: run.leadIds.filter((leadId) => leadId !== id) }
            : run,
        ),
      },
      {
        scope,
        collections: ['leads', 'runs'],
        deleteIds: { leads: [id] },
      },
    );
    return { ok: true };
  }

  async syncLeadToCrm(userId: string, id: string) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.leads.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('线索不存在');

    // 六步闭环 P1-7：优先走统一 LeadConvertService（原子转客户，10 步事务），
    // 转换后回写 GrowthLead.customerId 保持两套对齐，并补线索→客户归因链。
    if (this.leadConvertService) {
      const converted = await this.leadConvertService.convert({
        leadId: existing.id,
        scope: { userId, tenantId: membership.tenantId ?? null },
      });
      const customer = converted.customer;
      // 统一 Lead 已在 convert 内 status=converted，这里同步 GrowthLead.status 保持两套一致
      const updated = this.withCrmCustomerNote(
        userId,
        existing,
        customer.id,
        customer.displayName,
        'manual',
      );
      if (updated.status !== 'converted') {
        updated.status = 'converted';
        updated.notes = [
          {
            id: this.id('note'),
            text: '状态从「已触达/培育」流转为「已转化」。',
            type: 'status-change',
            createdAt: new Date().toISOString(),
            createdBy: userId,
          },
          ...(updated.notes || []),
        ];
      }
      await this.saveStore(
        {
          ...store,
          leads: store.leads.map((item) =>
            this.sameGrowthRecord(item, scope, id) ? updated : item,
          ),
        },
        { scope, collections: ['leads'] },
      );
      // 第 4 步（线索转换侧）：归因链落库（失败不阻断，错误不静默）
      if (this.leadBridge) {
        try {
          await this.leadBridge.saveLeadResultChain({
            tenantId: membership.tenantId ?? 'legacy-local-desktop',
            userId,
            leadId: existing.id,
            customerId: customer.id,
            opportunityId: converted.opportunityId ?? null,
          });
        } catch (error) {
          this.logger.warn(
            `线索转换归因链落库失败（lead=${existing.id}）：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return {
        ok: true,
        enabled: true,
        lead: updated,
        customerId: customer.id,
        message: `已同步到 CRM 客户：${customer.displayName}`,
      };
    }

    // 回退旧链路（leadConvertService 未注入时，保持原有 captureGrowthLead 行为）
    if (!this.crmService) throw new BadRequestException('CRM 服务未接入');
    const capture = await this.crmService.captureGrowthLead(
      userId,
      this.growthLeadToCrmCaptureInput(existing),
    );
    if (!capture.enabled) {
      return {
        ok: false,
        enabled: false,
        lead: existing,
        customerId: existing.crmCustomerId || null,
        message: capture.message,
      };
    }
    const customer = capture.capturedCustomers[0];
    if (!customer) {
      return {
        ok: false,
        enabled: true,
        lead: existing,
        customerId: existing.crmCustomerId || null,
        message: 'CRM 未返回客户记录，请稍后重试',
      };
    }

    const updated = this.withCrmCustomerNote(
      userId,
      existing,
      customer.customerId,
      customer.displayName,
      'manual',
    );
    await this.saveStore(
      {
        ...store,
        leads: store.leads.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['leads'] },
    );
    return {
      ok: true,
      enabled: true,
      lead: updated,
      customerId: customer.customerId,
      message: `已同步到 CRM 客户：${customer.displayName}`,
    };
  }

  async dedupePreview(userId: string, input: QueryInput) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const leadId = this.text(input.leadId);
    const baseLead = leadId
      ? store.leads.find((item) => this.sameGrowthRecord(item, scope, leadId))
      : undefined;
    const probe = baseLead || {
      id: '',
      nickname: this.text(input.nickname),
      profileUrl: this.text(input.profileUrl),
      externalUserId: this.text(input.externalUserId),
      sourceText: this.text(input.sourceText),
      platform: this.platform(input.platform),
      matchedKeywords: this.list(input.matchedKeywords),
    };
    const matches = store.leads
      .filter((item) => this.inGrowthScope(item, scope) && item.id !== probe.id)
      .map((item) => ({
        lead: item,
        reasons: this.duplicateReasons(probe, item),
        score: this.duplicateScore(probe, item),
      }))
      .filter((item) => item.score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return { duplicate: matches.length > 0, matches };
  }

  async mergeLeads(userId: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const primaryId = this.text(input.primaryId);
    const duplicateIds = this.list(input.duplicateIds);
    if (!primaryId || duplicateIds.length === 0)
      throw new BadRequestException('请选择主线索和待合并线索');
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const primary = store.leads.find((item) =>
      this.sameGrowthRecord(item, scope, primaryId),
    );
    if (!primary) throw new NotFoundException('主线索不存在');
    const duplicates = store.leads.filter(
      (item) =>
        this.inGrowthScope(item, scope) && duplicateIds.includes(item.id),
    );
    if (duplicates.length === 0)
      throw new NotFoundException('没有找到可合并线索');
    const now = new Date().toISOString();
    const merged: GrowthLead = {
      ...primary,
      score: Math.max(primary.score, ...duplicates.map((item) => item.score)),
      scoreReasons: Array.from(
        new Set([
          ...primary.scoreReasons,
          ...duplicates.flatMap((item) => item.scoreReasons),
        ]),
      ),
      matchedKeywords: Array.from(
        new Set([
          ...primary.matchedKeywords,
          ...duplicates.flatMap((item) => item.matchedKeywords),
        ]),
      ),
      evidenceUrls: Array.from(
        new Set([
          ...primary.evidenceUrls,
          ...duplicates.flatMap((item) => item.evidenceUrls),
        ]),
      ),
      latestReply:
        primary.latestReply ||
        duplicates.find((item) => item.latestReply)?.latestReply,
      nextFollowUpAt:
        primary.nextFollowUpAt ||
        duplicates.find((item) => item.nextFollowUpAt)?.nextFollowUpAt,
      notes: [
        {
          id: this.id('note'),
          text: `合并了 ${duplicates.length} 条重复线索：${duplicates.map((item) => item.nickname).join('、')}。`,
          type: 'merge',
          createdAt: now,
          createdBy: userId,
        },
        ...(primary.notes || []),
        ...duplicates.flatMap((item) => item.notes || []),
      ],
      updatedAt: now,
    };
    await this.saveStore(
      {
        ...store,
        leads: store.leads
          .filter(
            (item) =>
              !(
                this.inGrowthScope(item, scope) &&
                duplicateIds.includes(item.id)
              ),
          )
          .map((item) =>
            this.sameGrowthRecord(item, scope, primaryId) ? merged : item,
          ),
        runs: store.runs.map((run) =>
          this.inGrowthScope(run, scope)
            ? {
                ...run,
                leadIds: Array.from(
                  new Set(
                    run.leadIds.map((leadId) =>
                      duplicateIds.includes(leadId) ? primaryId : leadId,
                    ),
                  ),
                ),
              }
            : run,
        ),
      },
      {
        scope,
        collections: ['leads', 'runs'],
        deleteIds: { leads: duplicates.map((item) => item.id) },
      },
    );
    return { ok: true, lead: merged, mergedCount: duplicates.length };
  }

  async listAccountHealth(userId: string) {
    // T2-9：30s 内重复请求直接用缓存，避免每次触发 force 真实校验（实测 2.6s）
    const cacheKey = `user:${userId}`;
    const cached = this.accountHealthCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.at < GrowthService.ACCOUNT_HEALTH_CACHE_TTL_MS
    ) {
      return cached.data as GrowthAccountHealth[];
    }
    const membership = await this.requireGrowthReadScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const tenantId = scope.tenantId;
    const persisted = store.accountHealth.filter((item) =>
      this.inGrowthScope(item, scope),
    );
    try {
      const [accounts, health] = await Promise.all([
        this.autoUploadService.listAccounts({
          validate: true,
          force: true,
        }),
        this.autoUploadService.getAccountHealth({
          validate: true,
          force: true,
        }),
      ]);
      const issueByAccount = new Map(
        health.issues.map((issue) => [
          `${issue.platform}:${issue.accountName}`,
          issue,
        ]),
      );
      const live = accounts.map((account) => {
        const platform = this.platformFromAccount(
          account.platform,
          account.type,
        );
        const accountName =
          account.profileName ||
          account.userName ||
          account.filePath ||
          String(account.id);
        const platformNames = new Set(
          [
            this.text(account.platform),
            this.platformLabel(platform),
            platform,
          ].filter(Boolean),
        );
        const issue =
          Array.from(platformNames)
            .map((name) => issueByAccount.get(`${name}:${accountName}`))
            .find(Boolean) ||
          health.issues.find(
            (item) =>
              platformNames.has(this.text(item.platform)) &&
              item.accountName === accountName,
          );
        const persistedRow = persisted.find(
          (item) =>
            item.platform === platform && item.accountId === String(account.id),
        );
        const loginStatus =
          account.status === 1
            ? 'online'
            : /扫码|验证|captcha|login/i.test(issue?.message || '')
              ? 'verification-required'
              : 'expired';
        const riskStatus = this.isCooldownActive(persistedRow)
          ? 'cooldown'
          : account.status === 1
            ? 'normal'
            : 'needs-human';
        return {
          id: `${platform}:${account.id}`,
          userId,
          tenantId: persistedRow?.tenantId || tenantId,
          platform,
          accountId: String(account.id),
          accountName,
          loginStatus,
          todayActionCount: persistedRow?.todayActionCount || 0,
          failureRate: this.accountFailureRate(
            store.runs,
            store.configs,
            scope,
            platform,
            String(account.id),
            persistedRow?.failureRate,
          ),
          riskStatus,
          cooldownUntil:
            riskStatus === 'cooldown' ? persistedRow?.cooldownUntil : undefined,
          recommendation:
            riskStatus === 'cooldown'
              ? this.cooldownRecommendation(persistedRow?.cooldownUntil)
              : issue?.nextAction ||
                (account.status === 1
                  ? '账号可用于增长任务；仍需遵守每日上限和回读证据。'
                  : '账号不可用于自动任务，请先完成人工登录或验证。'),
          lastCheckedAt: health.checkedAt,
        } satisfies GrowthAccountHealth;
      });
      // 历史脏数据兜底：同一平台下 accountId 可能重复（映射曾把非数字
      // 行主键坍缩为 0），导致前端多个账号同时选中、无法单选。此处给
      // id 追加去重后缀，保证返回的每条账号 id 唯一（accountId 语义不变）。
      const seenIds = new Set<string>();
      for (const item of live) {
        let key = item.id;
        let n = 2;
        while (seenIds.has(key)) {
          key = `${item.id}#${n++}`;
        }
        seenIds.add(key);
        item.id = key;
      }
      const latestStore = await this.loadStore();
      const liveKeys = new Set(
        live.map((item) => `${item.platform}:${item.accountId}`),
      );
      const taskBlockers = this.missingTaskAccountHealthRows(
        userId,
        tenantId,
        latestStore.configs,
        liveKeys,
        persisted,
      );
      const scopedPersistedFallbacks = latestStore.accountHealth.filter(
        (item) =>
          this.inGrowthScope(item, scope) &&
          !taskBlockers.some(
            (blocker) =>
              blocker.platform === item.platform &&
              blocker.accountId === item.accountId,
          ) &&
          !liveKeys.has(`${item.platform}:${item.accountId}`),
      );
      await this.saveStore(
        {
          ...latestStore,
          accountHealth: [
            ...live,
            ...taskBlockers,
            ...scopedPersistedFallbacks,
            ...latestStore.accountHealth.filter(
              (item) => !this.inGrowthScope(item, scope),
            ),
          ],
        },
        { scope, collections: ['accountHealth'] },
      );
      const result = [...live, ...taskBlockers, ...scopedPersistedFallbacks];
      this.accountHealthCache.set(cacheKey, {
        data: result,
        at: Date.now(),
      });
      return result;
    } catch {
      return this.ensureAccountHealth(userId, store, scope);
    }
  }

  async checkAccountHealth(
    userId: string,
    platform: GrowthPlatform,
    accountId: string,
  ) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const initialStore = await this.loadStore();
    await this.assertGrowthPlatformAccountScope(
      userId,
      platform,
      accountId,
      initialStore,
    );
    const refreshed = await this.listAccountHealth(userId);
    const matched = refreshed.find(
      (item) => item.platform === platform && item.accountId === accountId,
    );
    if (matched) return matched;
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const health = this.buildAccountHealth(
      userId,
      platform,
      accountId,
      '未在本机账号列表中找到该账号，请先完成平台账号授权。',
      scope.tenantId,
    );
    await this.saveStore(
      {
        ...store,
        accountHealth: [
          health,
          ...store.accountHealth.filter(
            (item) => !this.sameGrowthAccount(item, scope, platform, accountId),
          ),
        ],
      },
      { scope, collections: ['accountHealth'] },
    );
    // T2-9：手动检查后清缓存，保证"重新检查"立即生效
    this.accountHealthCache.delete(`user:${userId}`);
    return health;
  }

  async cooldownAccount(
    userId: string,
    platform: GrowthPlatform,
    accountId: string,
    minutesInput = 60,
  ) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const health = await this.checkAccountHealth(userId, platform, accountId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const minutes = this.normalizeCooldownMinutes(minutesInput);
    const cooldownUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    const updated = {
      ...health,
      riskStatus: 'cooldown' as const,
      cooldownUntil,
      recommendation: this.cooldownRecommendation(cooldownUntil),
      lastCheckedAt: new Date().toISOString(),
    };
    await this.saveStore(
      {
        ...store,
        accountHealth: store.accountHealth.map((item) =>
          this.sameGrowthAccount(item, scope, platform, accountId)
            ? updated
            : item,
        ),
      },
      { scope, collections: ['accountHealth'] },
    );
    return updated;
  }

  async releaseAccountCooldown(
    userId: string,
    platform: GrowthPlatform,
    accountId: string,
  ) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const health = await this.checkAccountHealth(userId, platform, accountId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const executable = health.loginStatus === 'online';
    const updated = {
      ...health,
      riskStatus: executable ? ('normal' as const) : ('needs-human' as const),
      cooldownUntil: undefined,
      recommendation: executable
        ? '冷却已解除；账号可进入风控预检，但仍需遵守每日上限、低频启动和人工复核策略。'
        : '冷却已解除，但账号仍未在线或需验证，请先完成平台登录后再执行。',
      lastCheckedAt: new Date().toISOString(),
    };
    await this.saveStore(
      {
        ...store,
        accountHealth: store.accountHealth.map((item) =>
          this.sameGrowthAccount(item, scope, platform, accountId)
            ? updated
            : item,
        ),
      },
      { scope, collections: ['accountHealth'] },
    );
    return updated;
  }

  async getReports(
    userId: string,
    query: QueryInput = {},
  ): Promise<GrowthReports> {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const platform = this.text(query.platform);
    const configId = this.text(query.configId);
    const startDate = this.text(query.startDate);
    const endDate = this.text(query.endDate);
    const startAt = startDate
      ? new Date(`${startDate}T00:00:00.000Z`).getTime()
      : undefined;
    const endAt = endDate
      ? new Date(`${endDate}T23:59:59.999Z`).getTime()
      : undefined;
    const inRange = (value?: string) => {
      if (!value) return false;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return false;
      if (startAt !== undefined && time < startAt) return false;
      if (endAt !== undefined && time > endAt) return false;
      return true;
    };
    const configs = store.configs.filter((config) => {
      if (!this.inGrowthScope(config, scope)) return false;
      if (platform && platform !== 'all' && config.platform !== platform)
        return false;
      if (configId && configId !== 'all' && config.id !== configId)
        return false;
      return true;
    });
    const configIds = new Set(configs.map((config) => config.id));
    const runs = store.runs
      .filter((run) => {
        if (!this.inGrowthScope(run, scope)) return false;
        if (platform && platform !== 'all' && run.platform !== platform)
          return false;
        if (configId && configId !== 'all' && run.configId !== configId)
          return false;
        if (!configIds.has(run.configId)) return false;
        if (
          (startAt !== undefined || endAt !== undefined) &&
          !inRange(run.startedAt)
        )
          return false;
        return true;
      })
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const runIds = new Set(runs.map((run) => run.id));
    const leads = store.leads.filter((lead) => {
      if (!this.inGrowthScope(lead, scope)) return false;
      if (platform && platform !== 'all' && lead.platform !== platform)
        return false;
      if (configId && configId !== 'all' && lead.sourceTaskId !== configId)
        return false;
      if (lead.sourceRunId && !runIds.has(lead.sourceRunId)) return false;
      if (
        (startAt !== undefined || endAt !== undefined) &&
        !inRange(lead.createdAt)
      )
        return false;
      return true;
    });
    const accounts = store.accountHealth.filter((account) => {
      if (!this.inGrowthScope(account, scope)) return false;
      if (platform && platform !== 'all' && account.platform !== platform)
        return false;
      if (configId && configId !== 'all') {
        return configs.some(
          (config) =>
            config.platform === account.platform &&
            config.accountId === account.accountId,
        );
      }
      return true;
    });
    const overview: GrowthOverview = {
      todayLeadCount: leads.length,
      todayContactedCount: runs.reduce(
        (total, run) => total + run.contactedCount,
        0,
      ),
      todayCrmCapturedCount: leads.filter((lead) => lead.crmCustomerId).length,
      activeConfigCount: configs.filter((config) => config.status === 'enabled')
        .length,
      highIntentLeadCount: leads.filter(
        (lead) => lead.score >= 75 && lead.status !== 'blocked',
      ).length,
      accountRiskCount: accounts.filter(
        (account) =>
          account.riskStatus !== 'normal' || account.loginStatus !== 'online',
      ).length,
      funnel: {
        candidates: runs.reduce((total, run) => total + run.candidateCount, 0),
        selected: runs.reduce((total, run) => total + run.selectedCount, 0),
        contacted: runs.reduce((total, run) => total + run.contactedCount, 0),
        // 进 CRM 统一用 lead.crmCustomerId（线索真实关联 CRM 的证据），
        // 与 /growth/overview 同口径；不再用 run.crmCapturedCount（运行时同步计数，语义易漂移）
        crmCaptured: leads.filter((lead) => lead.crmCustomerId).length,
        converted: leads.filter((lead) => lead.status === 'converted').length,
      },
      recentRuns: runs.slice(0, 8),
      hotStrategies: store.strategies
        .filter((strategy) => this.inGrowthScope(strategy, scope))
        .slice(0, 6),
    };
    const copywriting = this.copywritingReport(leads);
    // 六步闭环复盘：数据库 delegate 不可用（测试环境）时返回空闭环，不阻断报告
    let sixStage: GrowthReports['sixStage'] = {
      content: 0,
      publish: 0,
      interaction: 0,
      lead: 0,
      customer: 0,
      opportunity: 0,
      wonAmountCents: 0,
      contentConversionRate: 0,
      attributedLeadCount: 0,
      attributedCustomerCount: 0,
      attributionConfidence: 'low',
      platformComparison: [],
    };
    if (this.hasDbListDelegates()) {
      try {
        sixStage = await this.computeSixStageFunnel(scope, platform);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`六步闭环复盘计算失败：${message}`);
        // 2026-09-01（审计 #12）：不再静默归零——错误上屏（前端展示原因，
        // 页面不至于把"计算失败"误读成"没有数据"）
        sixStage.funnelError = message.slice(0, 200);
      }
    }

    // P2 T04：归因报告四维（拍板 R5：扩展 reports 返回体，旧前端忽略；R6 话术弱关联）
    let attribution: GrowthReports['attribution'];
    if (this.hasDbListDelegates()) {
      try {
        attribution = await this.computeAttributionReport(scope, platform);
      } catch (error) {
        this.logger.warn(
          `P2 归因报告计算失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      overview,
      funnel: overview.funnel,
      sixStage,
      copywriting,
      accounts,
      tasks: runs,
      trend: this.trendReport(runs, leads, startDate, endDate),
      taskPerformance: this.taskPerformanceReport(runs, configs),
      accountPerformance: this.accountPerformanceReport(
        runs,
        configs,
        accounts,
      ),
      bottlenecks: this.bottleneckReport(overview, runs, leads, accounts),
      leadStatusDistribution: this.leadStatusDistribution(leads),
      attribution,
    };
  }

  /**
   * 六步闭环复盘（P1-15）：内容→发布→互动→线索→客户→商机。
   * 数据来自统一侧事实表（article / publishRecord / interactionEvent / lead / crmCustomer / crmOpportunity），
   * 含成交金额、内容转化率、平台对比、归因置信度。
   */
  private async computeSixStageFunnel(scope: GrowthScope, platform: string) {
    const scopeWhere = this.growthScopeWhere(scope);
    // CRM 客户/商机表用 ownerId 做归属（非 userId）；两者 where 结构一致，用宽松类型承载
    const crmScopeWhere: {
      ownerId?: string;
      OR?: Array<Record<string, unknown>>;
    } = scope.tenantId
      ? {
          OR: [
            { tenantId: scope.tenantId },
            { ownerId: scope.userId, tenantId: null },
          ],
        }
      : { ownerId: scope.userId };
    const platformFilter = platform && platform !== 'all' ? { platform } : {};

    const [content, publish, interaction, customer, opportunity] =
      await Promise.all([
        this.prisma.article.count({ where: { ...scopeWhere } }),
        this.prisma.publishRecord.count({
          where: { ...scopeWhere, ...platformFilter },
        }),
        this.prisma.interactionEvent.count({
          where: { ...scopeWhere, ...platformFilter },
        }),
        this.prisma.crmCustomer.count({ where: { ...crmScopeWhere } }),
        this.prisma.crmOpportunity.count({ where: { ...crmScopeWhere } }),
      ]);

    const leadCount = await this.prisma.lead.count({
      where: {
        ...(scopeWhere as Prisma.LeadWhereInput),
        sourceType: { notIn: ['comment', 'dm'] },
        ...(platformFilter as Prisma.LeadWhereInput),
      },
    });

    // 成交金额（已赢单商机的金额，分）
    const wonAgg = await this.prisma.crmOpportunity.aggregate({
      where: { ...crmScopeWhere, stage: 'won' },
      _sum: { amountCents: true },
    });
    const wonAmountCents = wonAgg._sum?.amountCents ?? 0;

    // 归因置信度：有确定性（deterministic）归因链为 high，规则/推断为 medium，否则 low
    const deterministicLinks = await this.prisma.attributionLink.count({
      where: { ...scopeWhere, model: 'deterministic' },
    });
    const anyLinks = await this.prisma.attributionLink.count({
      where: { ...scopeWhere },
    });
    const attributionConfidence: 'high' | 'medium' | 'low' =
      deterministicLinks > 0 ? 'high' : anyLinks > 0 ? 'medium' : 'low';

    // 按主键归因：内容实际带动的线索/客户（通过归因链，而非简单 count 相除）。
    // 归因到的线索数 = 有 interaction→lead / publish→lead / content→lead 归因链的 lead（去重）。
    const attributedLeadRows = await this.prisma.attributionLink.findMany({
      where: {
        ...scopeWhere,
        toType: 'lead',
        fromType: { in: ['interaction', 'publish', 'content'] },
      },
      select: { toId: true },
      distinct: ['toId'],
    });
    const attributedLeadCount = attributedLeadRows.length;
    // 归因到的客户数 = 有 lead→customer 归因链的 customer（去重）。
    const attributedCustomerRows = await this.prisma.attributionLink.findMany({
      where: { ...scopeWhere, toType: 'customer', fromType: 'lead' },
      select: { toId: true },
      distinct: ['toId'],
    });
    const attributedCustomerCount = attributedCustomerRows.length;

    // 平台对比（内容用 SourceContent 事实表按平台统计）
    const platforms = await this.prisma.interactionEvent.groupBy({
      by: ['platform'],
      where: { ...scopeWhere },
      _count: { _all: true },
    });
    const platformComparison = await Promise.all(
      platforms.map(async (p) => {
        const pf = p.platform;
        return {
          platform: pf,
          content: await this.prisma.sourceContent.count({
            where: { ...scopeWhere, platform: pf },
          }),
          publish: await this.prisma.publishRecord.count({
            where: { ...scopeWhere, platform: pf },
          }),
          interaction: p._count._all,
          lead: await this.prisma.lead.count({
            where: {
              ...(scopeWhere as Prisma.LeadWhereInput),
              sourceType: { notIn: ['comment', 'dm'] },
              platform: pf,
            },
          }),
          customer: await this.prisma.crmCustomer.count({
            where: { ...crmScopeWhere, sourcePlatform: pf },
          }),
          opportunity: await this.prisma.crmOpportunity.count({
            where: { ...crmScopeWhere, source: { contains: pf } },
          }),
        };
      }),
    );

    return {
      content,
      publish,
      interaction,
      lead: leadCount,
      customer,
      opportunity,
      wonAmountCents,
      // 按主键归因的转化率：有归因链的线索数 / 内容数（修复：原为 leadCount/content 直接相除）
      contentConversionRate: content > 0 ? attributedLeadCount / content : 0,
      attributedLeadCount,
      attributedCustomerCount,
      attributionConfidence,
      platformComparison,
    };
  }

  /**
   * P2 T04 归因报告四维：按平台 / 策略（获客任务）/ 内容（文章）/ 话术 分组统计
   * 线索→客户→商机→成交。数据来自统一事实表 + attributionLink 归因链；
   * 话术维度为弱关联（sourceText/sourceTaskId 兜底），样本<3 标 lowConfidence（拍板 R6）。
   */
  private async computeAttributionReport(scope: GrowthScope, platform: string) {
    const crmScopeWhere: {
      ownerId?: string;
      OR?: Array<Record<string, unknown>>;
    } = scope.tenantId
      ? {
          OR: [
            { tenantId: scope.tenantId },
            { ownerId: scope.userId, tenantId: null },
          ],
        }
      : { ownerId: scope.userId };
    const platformFilter = platform && platform !== 'all' ? { platform } : {};

    // 1) 成交商机（含来源客户归因）
    const wonOpps = await this.prisma.crmOpportunity.findMany({
      where: { ...crmScopeWhere, archivedAt: null, stage: 'won' },
      select: {
        id: true,
        amountCents: true,
        primaryCustomerId: true,
        metadata: true,
      },
    });
    // 2) 客户 → 归因（source* 列）
    const customerIds = wonOpps
      .map((o) => o.primaryCustomerId)
      .filter((v): v is string => Boolean(v));
    const customers = customerIds.length
      ? await this.prisma.crmCustomer.findMany({
          where: { id: { in: customerIds } },
          select: {
            id: true,
            sourcePlatform: true,
            sourceTaskId: true,
            sourceArticleId: true,
            sourceText: true,
            sourceUrl: true,
          },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    // 3) 文章标题
    const articleIds = customers
      .map((c) => c.sourceArticleId)
      .filter((v): v is string => Boolean(v));
    const articles = articleIds.length
      ? await this.prisma.article.findMany({
          where: { id: { in: articleIds } },
          select: { id: true, title: true },
        })
      : [];
    const articleById = new Map(articles.map((a) => [a.id, a]));

    // 4) 获客任务名（sourceTaskId → config）
    const taskIds = customers
      .map((c) => c.sourceTaskId)
      .filter((v): v is string => Boolean(v));
    const configs = taskIds.length
      ? await this.prisma.growthAcquisitionConfig.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, taskName: true, platform: true },
        })
      : [];
    const configById = new Map(configs.map((c) => [c.id, c]));

    // 5) 线索量：按客户 source* 归因的反查（lead.customerId）
    const leadsForCustomers = customerIds.length
      ? await this.prisma.lead.findMany({
          where: { customerId: { in: customerIds } },
          select: {
            id: true,
            customerId: true,
            platform: true,
            sourceText: true,
          },
        })
      : [];

    // —— byPlatform：按客户 sourcePlatform 聚合 ——
    const platformMap = new Map<
      string,
      {
        leads: number;
        customers: number;
        opportunities: number;
        won: number;
        wonAmountCents: number;
      }
    >();
    for (const opp of wonOpps) {
      const customer = opp.primaryCustomerId
        ? customerById.get(opp.primaryCustomerId)
        : null;
      const p =
        customer?.sourcePlatform || platformFilter.platform || 'unknown';
      const entry = platformMap.get(p) ?? {
        leads: 0,
        customers: 0,
        opportunities: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.opportunities += 1;
      entry.won += 1;
      entry.wonAmountCents += opp.amountCents ?? 0;
      if (opp.primaryCustomerId) entry.customers += 1;
      platformMap.set(p, entry);
    }
    for (const lead of leadsForCustomers) {
      const p = lead.platform || platformFilter.platform || 'unknown';
      const entry = platformMap.get(p) ?? {
        leads: 0,
        customers: 0,
        opportunities: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.leads += 1;
      platformMap.set(p, entry);
    }
    const byPlatform = Array.from(platformMap.entries()).map(
      ([platformName, v]) => ({
        platform: platformName,
        leads: v.leads,
        customers: v.customers,
        opportunities: v.opportunities,
        won: v.won,
        wonAmountCents: v.wonAmountCents,
        conversionRate: v.leads > 0 ? v.won / v.leads : null,
      }),
    );

    // —— byStrategy：按 sourceTaskId（获客任务）聚合 ——
    const strategyMap = new Map<
      string,
      {
        strategyId: string;
        strategyName: string;
        platform: string;
        leads: number;
        won: number;
        wonAmountCents: number;
      }
    >();
    for (const opp of wonOpps) {
      const customer = opp.primaryCustomerId
        ? customerById.get(opp.primaryCustomerId)
        : null;
      const taskId = customer?.sourceTaskId;
      if (!taskId) continue;
      const config = configById.get(taskId);
      const key = config?.id ?? taskId;
      const entry = strategyMap.get(key) ?? {
        strategyId: config?.id ?? taskId,
        strategyName: config?.taskName ?? `任务 ${taskId.slice(0, 8)}`,
        platform: config?.platform ?? customer?.sourcePlatform ?? 'unknown',
        leads: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.won += 1;
      entry.wonAmountCents += opp.amountCents ?? 0;
      strategyMap.set(key, entry);
    }
    for (const lead of leadsForCustomers) {
      const customer = lead.customerId
        ? customerById.get(lead.customerId)
        : null;
      const taskId = customer?.sourceTaskId;
      if (!taskId) continue;
      const config = configById.get(taskId);
      const key = config?.id ?? taskId;
      const entry = strategyMap.get(key);
      if (entry) entry.leads += 1;
    }
    const byStrategy = Array.from(strategyMap.values()).map((s) => ({
      ...s,
      conversionRate: s.leads > 0 ? s.won / s.leads : null,
    }));

    // —— byContent：按 sourceArticleId 聚合 ——
    const contentMap = new Map<
      string,
      {
        articleId: string;
        title: string;
        publishCount: number;
        leads: number;
        customers: number;
        won: number;
        wonAmountCents: number;
      }
    >();
    for (const opp of wonOpps) {
      const customer = opp.primaryCustomerId
        ? customerById.get(opp.primaryCustomerId)
        : null;
      const articleId = customer?.sourceArticleId;
      if (!articleId) continue;
      const article = articleById.get(articleId);
      const key = articleId;
      const entry = contentMap.get(key) ?? {
        articleId,
        title: article?.title ?? articleId.slice(0, 8),
        publishCount: 0,
        leads: 0,
        customers: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.won += 1;
      entry.wonAmountCents += opp.amountCents ?? 0;
      if (opp.primaryCustomerId) entry.customers += 1;
      contentMap.set(key, entry);
    }
    for (const lead of leadsForCustomers) {
      const customer = lead.customerId
        ? customerById.get(lead.customerId)
        : null;
      const articleId = customer?.sourceArticleId;
      if (!articleId) continue;
      const entry = contentMap.get(articleId);
      if (entry) entry.leads += 1;
    }
    const byContent = Array.from(contentMap.values());

    // —— byScript：按话术（sourceText 兜底 + copywriting 口径）弱关联 ——
    const scriptMap = new Map<
      string,
      {
        text: string;
        usageCount: number;
        leads: number;
        won: number;
        wonAmountCents: number;
      }
    >();
    for (const lead of leadsForCustomers) {
      const text = (lead.sourceText || '').slice(0, 40) || '（无话术文本）';
      const entry = scriptMap.get(text) ?? {
        text,
        usageCount: 0,
        leads: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.leads += 1;
      scriptMap.set(text, entry);
    }
    for (const opp of wonOpps) {
      const customer = opp.primaryCustomerId
        ? customerById.get(opp.primaryCustomerId)
        : null;
      const text =
        (customer?.sourceText || '').slice(0, 40) || '（无话术文本）';
      const entry = scriptMap.get(text) ?? {
        text,
        usageCount: 0,
        leads: 0,
        won: 0,
        wonAmountCents: 0,
      };
      entry.won += 1;
      entry.wonAmountCents += opp.amountCents ?? 0;
      scriptMap.set(text, entry);
    }
    const byScript = Array.from(scriptMap.values()).map((s) => ({
      ...s,
      lowConfidence: s.leads < 3 && s.won < 3 ? true : undefined,
    }));

    return {
      byPlatform,
      byStrategy,
      byContent,
      byScript,
      generatedAt: new Date().toISOString(),
    };
  }

  async listWorkflows(userId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.workflows.filter((item) => this.inGrowthScope(item, scope));
  }

  async createWorkflow(userId: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const tenantId = membership.tenantId;
    const scope: GrowthScope = membership;
    const now = new Date().toISOString();
    const template = this.workflowTemplate(input.template);
    // 行业方案库：industry + scenario → 行业 Playbook 步骤链（优先于通用模板）
    const industry = this.text(input.industry);
    const scenario = this.text(input.scenario);
    const playbook = industry
      ? industryPlaybook(industry, scenario || undefined)
      : undefined;
    const workflow: GrowthWorkflow = {
      id: this.id('workflow'),
      userId,
      tenantId,
      name: this.text(input.name) || playbook?.name || template.name,
      template: playbook ? 'industry-playbook' : template.key,
      industry: playbook ? industry : undefined,
      scenario: playbook ? scenario || playbook.name : undefined,
      status: 'draft',
      steps: playbook
        ? playbook.steps.map((step) => ({
            id: this.id('step'),
            name: step.name,
            type: step.type,
            riskMode: step.riskMode,
            status: 'pending' as const,
            description: step.description,
          }))
        : this.workflowSteps(template.key),
      currentStepId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await this.saveStore(
      {
        ...store,
        workflows: [workflow, ...store.workflows],
      },
      { scope, collections: ['workflows'] },
    );
    return workflow;
  }

  /** 行业方案库：14 行业 × 场景 Playbook 清单（前端方案库渲染） */
  listWorkflowPlaybooks() {
    return Promise.resolve(listWorkflowPlaybooks());
  }

  async updateWorkflow(userId: string, id: string, input: QueryInput) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.workflows.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('增长工作流不存在');

    const name = this.text(input.name);
    const requestedTemplate = this.text(input.template);
    const nextTemplate = requestedTemplate
      ? this.workflowTemplate(requestedTemplate).key
      : existing.template;
    const shouldResetSteps =
      requestedTemplate &&
      nextTemplate !== existing.template &&
      existing.status === 'draft';
    const stepId = this.text(input.stepId);
    const stepDescription = this.text(input.stepDescription);
    const stepOutputSummary = this.text(input.stepOutputSummary);
    // 画布整体保存：前端把 nodes/edges 转换为 steps 数组提交（含 dependencies/nodeType/config）
    const canvasSteps = Array.isArray(input.steps)
      ? (input.steps as GrowthWorkflow['steps']).map((step) => ({
          ...step,
          dependencies: Array.isArray(step.dependencies)
            ? step.dependencies
            : [],
          nodeType: this.text(step.nodeType) || step.type,
        }))
      : null;
    const steps = canvasSteps
      ? canvasSteps
      : shouldResetSteps
        ? this.workflowSteps(nextTemplate)
        : existing.steps.map((step) => {
            if (step.id !== stepId) return step;
            return {
              ...step,
              description: stepDescription || step.description,
              outputSummary: stepOutputSummary || step.outputSummary,
            };
          });

    const updated: GrowthWorkflow = {
      ...existing,
      name: name || existing.name,
      template: nextTemplate,
      steps,
      currentStepId: shouldResetSteps ? undefined : existing.currentStepId,
      lastAction: shouldResetSteps
        ? '切换工作流模板'
        : stepId
          ? '更新步骤详情'
          : name
            ? '重命名工作流'
            : existing.lastAction,
      lastActionAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveStore(
      {
        ...store,
        workflows: store.workflows.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['workflows'] },
    );
    return updated;
  }

  async deleteWorkflow(userId: string, id: string) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const exists = store.workflows.some((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!exists) throw new NotFoundException('增长工作流不存在');
    await this.saveStore(
      {
        ...store,
        workflows: store.workflows.filter(
          (item) => !this.sameGrowthRecord(item, scope, id),
        ),
      },
      {
        scope,
        collections: ['workflows'],
        deleteIds: { workflows: [id] },
      },
    );
    return { ok: true };
  }

  async setWorkflowStatus(
    userId: string,
    id: string,
    status: GrowthWorkflow['status'],
  ) {
    const membership = await this.requireGrowthMutationScope(userId);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.workflows.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('增长工作流不存在');
    const updated = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    };
    await this.saveStore(
      {
        ...store,
        workflows: store.workflows.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['workflows'] },
    );
    return updated;
  }

  async applyWorkflowAction(
    userId: string,
    id: string,
    actionInput: unknown,
    input: QueryInput = {},
  ) {
    const membership = await this.requireGrowthMutationScope(userId);
    const action = this.workflowAction(actionInput);
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.workflows.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('增长工作流不存在');
    // 确认步骤（执行引擎）：先执行当前等待确认步骤的真实动作，再推进下一步
    if (action === 'confirm-step') {
      const waitingIdx = existing.steps.findIndex(
        (step) => step.status === 'waiting-confirmation',
      );
      if (waitingIdx < 0)
        throw new BadRequestException('当前没有等待确认的步骤');
      const step = existing.steps[waitingIdx];
      const result = await this.executeWorkflowStepAction(existing, step);
      if (result.error)
        throw new BadRequestException(`步骤执行失败：${result.error}`);
      const advanced = this.transitionWorkflow(existing, 'advance', {
        stepId: step.id,
        outputSummary: result.summary || '人工确认，已继续执行',
      });
      await this.saveStore(
        {
          ...store,
          workflows: store.workflows.map((item) =>
            this.sameGrowthRecord(item, scope, id) ? advanced : item,
          ),
        },
        { scope, collections: ['workflows'] },
      );
      return advanced;
    }
    const updated = this.transitionWorkflow(existing, action, input);
    await this.saveStore(
      {
        ...store,
        workflows: store.workflows.map((item) =>
          this.sameGrowthRecord(item, scope, id) ? updated : item,
        ),
      },
      { scope, collections: ['workflows'] },
    );
    return updated;
  }

  /**
   * 执行工作流步骤的真实动作（执行引擎）
   * 当前支持：acquisition 步骤绑定获客配置（step.config.acquisitionConfigId）→ 调 executeConfig 真跑评论/私信获客
   * 返回：{ executed, summary?, error? }——executed=false 且无 error 表示该步骤无需自动执行（人工步骤）
   */
  private async executeWorkflowStepAction(
    workflow: GrowthWorkflow,
    step: GrowthWorkflow['steps'][number],
  ): Promise<{ executed: boolean; summary?: string; error?: string }> {
    const executionEnabled = process.env.GROWTH_EXECUTION_ENABLED === 'true';
    const config = (step.config ?? {}) as Record<string, unknown>;
    const configId = config.acquisitionConfigId;
    if (
      step.type === 'acquisition' &&
      typeof configId === 'string' &&
      configId &&
      executionEnabled
    ) {
      try {
        const runResult = await this.executeConfig(workflow.userId, configId, {
          confirmedExecution: true,
          trigger: 'workflow',
        });
        const run = runResult?.run;
        const summary =
          run?.message ||
          (run
            ? `获客执行完成：候选 ${run.candidateCount ?? 0}，触达 ${
                run.contactedCount ?? 0
              } 人，沉淀线索 ${run.leadIds?.length ?? 0} 条`
            : '获客执行完成');
        return { executed: true, summary };
      } catch (error) {
        return {
          executed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { executed: false };
  }

  /**
   * 工作流执行引擎：扫描 running 工作流，执行当前步骤并自动推进
   * - auto 步骤：执行真实动作（若有）→ 完成 → 自动推进下一步
   * - confirm-first 步骤：转"等待确认"，用户确认后（confirm-step）执行并推进
   * - 执行失败：步骤标记 failed，工作流暂停，不自动推进
   */
  @Interval(15_000)
  async runWorkflowExecutionDaemon() {
    if (this.workflowDaemonRunning) return;
    this.workflowDaemonRunning = true;
    try {
      // 性能优化：daemon 每 15s 空转触发时先做轻量计数（单表 count 仅过滤 status='running'），
      // 无活跃执行直接 return，避免每次都全量 loadStore 读 7 张表。判据与下方执行过滤保持一致。
      const runningCount = await this.prisma.growthWorkflow.count({
        where: { status: 'running' },
      });
      if (runningCount === 0) return;
      const store = await this.loadStore();
      const runningWorkflows = store.workflows.filter(
        (wf) => wf.status === 'running',
      );
      for (const workflow of runningWorkflows) {
        try {
          const stepIndex = workflow.steps.findIndex(
            (step) => step.status === 'running',
          );
          if (stepIndex < 0) continue;
          const step = workflow.steps[stepIndex];
          // confirm-first：转等待确认（不自动执行）
          if (step.riskMode === 'confirm-first') {
            await this.applyWorkflowAction(
              workflow.userId,
              workflow.id,
              'await-confirmation',
              {
                stepId: step.id,
              },
            );
            continue;
          }
          // auto 步骤：执行真实动作（若有），完成并推进下一步
          const result = await this.executeWorkflowStepAction(workflow, step);
          if (result.error) {
            await this.applyWorkflowAction(
              workflow.userId,
              workflow.id,
              'fail',
              {
                stepId: step.id,
                outputSummary: `执行失败：${result.error}`,
              },
            );
            continue;
          }
          await this.applyWorkflowAction(
            workflow.userId,
            workflow.id,
            'advance',
            {
              stepId: step.id,
              outputSummary:
                result.summary ||
                (result.executed
                  ? '步骤执行完成'
                  : '步骤完成（无自动执行动作）'),
            },
          );
        } catch (error) {
          this.logger.warn(
            `工作流 ${workflow.id} 执行引擎异常：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } finally {
      this.workflowDaemonRunning = false;
    }
  }

  private benchmarkAccountInputs(
    value: unknown,
  ): RedfoxBenchmarkAccountInput[] {
    if (!Array.isArray(value)) return [];
    const accounts: RedfoxBenchmarkAccountInput[] = [];
    value.forEach((item, index) => {
      const record = this.objectRecord(item);
      if (!record) return;
      const nickname =
        this.text(record.nickname) ||
        this.text(record.accountName) ||
        this.text(record.name) ||
        this.text(record.title) ||
        `RedFox 对标账号${index + 1}`;
      const contentSignals = this.uniqueList([
        ...this.list(record.contentSignals),
        ...this.list(record.signals),
        ...this.list(record.keywords),
        ...this.list(record.tags),
      ]);
      const intentSignals = this.uniqueList([
        ...this.list(record.intentSignals),
        ...this.list(record.demandKeywords),
        ...this.list(record.intentKeywords),
        ...contentSignals.filter((signal) =>
          /求|需要|想|多少钱|预算|私信|微信|联系|购买|报价/.test(signal),
        ),
      ]);
      accounts.push({
        platform: this.platform(record.platform),
        nickname,
        externalUserId: this.text(
          record.externalUserId || record.userId || record.uid,
        ),
        profileUrl: this.text(
          record.profileUrl || record.homepage || record.url,
        ),
        sourceUrl: this.text(
          record.sourceUrl || record.redfoxSourceUrl || record.url,
        ),
        reason: this.text(
          record.reason || record.summary || record.description,
        ),
        metrics: this.objectRecord(record.metrics) || {},
        contentSignals,
        intentSignals,
        evidence: this.intelligenceEvidenceList(record.evidence),
      });
    });
    return accounts;
  }

  private buildBenchmarkLeadConfirmationDraft(
    account: RedfoxBenchmarkAccountInput,
    index: number,
    batchEvidence: GrowthIntelligenceEvidence[],
  ): GrowthLeadConfirmationDraft {
    const evidenceChain = this.mergeEvidenceChains(
      batchEvidence,
      account.evidence || [],
    );
    const matchedKeywords = this.uniqueList([
      ...(account.intentSignals || []),
      ...(account.contentSignals || []).filter((signal) =>
        /求|需要|想|多少钱|预算|私信|微信|联系|购买|报价/.test(signal),
      ),
    ]).slice(0, 8);
    const sourceText =
      this.uniqueList([
        account.reason || '',
        ...(account.intentSignals || []),
        ...(account.contentSignals || []),
      ]).join('；') ||
      `${this.platformLabel(account.platform)}对标账号：${account.nickname}`;
    const score = this.scoreText(`${sourceText} ${matchedKeywords.join(' ')}`);
    const hasLeadIntent =
      matchedKeywords.length > 0 ||
      /求|需要|想|多少钱|预算|私信|微信|联系|购买|报价|咨询/.test(sourceText);
    return {
      id:
        account.externalUserId ||
        account.profileUrl ||
        `redfox-lead-draft-${index + 1}`,
      platform: account.platform,
      nickname: account.nickname,
      profileUrl: account.profileUrl,
      externalUserId: account.externalUserId,
      sourceText,
      sourceUrl: account.sourceUrl || account.profileUrl,
      matchedKeywords,
      score: Math.min(100, score.score + (hasLeadIntent ? 12 : 0)),
      scoreReasons: this.uniqueList([
        ...(hasLeadIntent
          ? ['RedFox 命中明确意图信号']
          : ['RedFox 对标账号，仅建议进入策略来源池']),
        ...score.reasons,
      ]),
      confirmationStatus: hasLeadIntent
        ? 'ready-for-confirmation'
        : 'strategy-only',
      requiredHumanConfirmation: true,
      confirmationReason: hasLeadIntent
        ? '该账号或关联内容出现需求、咨询、联系方式或购买意图，允许人工确认后入线索池。'
        : '当前只有对标账号价值，不能直接当作客户线索；建议先进入对标账号池和策略草稿。',
      evidenceChain,
    };
  }

  private buildBenchmarkEvidenceChain(
    input: QueryInput,
    accounts: RedfoxBenchmarkAccountInput[],
    now: string,
  ): GrowthIntelligenceEvidence[] {
    const sourceId =
      this.text(input.redfoxRequestId) ||
      this.text(input.requestId) ||
      this.text(input.skillCode) ||
      'redfox-benchmark-account-batch';
    const base: GrowthIntelligenceEvidence = {
      source: 'redfox',
      sourceId,
      sourceUrl: this.text(input.sourceUrl),
      evidenceUrl: this.text(input.evidenceUrl),
      rawHash: this.rawHash({ sourceId, accounts }),
      collectedAt: this.text(input.collectedAt) || now,
      note: this.text(input.evidenceNote) || 'RedFox 对标账号批次情报',
    };
    return this.mergeEvidenceChains(
      [base],
      this.intelligenceEvidenceList(input.evidence),
    );
  }

  private leadConfirmationInput(
    input: QueryInput,
  ): GrowthLeadConfirmationInput {
    const confirmation = this.objectRecord(input.confirmation);
    const confirmed =
      input.confirmed === true || confirmation?.confirmed === true;
    const confirmedBy =
      this.text(input.confirmedBy) ||
      this.text(confirmation?.confirmedBy) ||
      this.text(confirmation?.operator);
    const note = this.text(input.note) || this.text(confirmation?.note);
    const leads = Array.isArray(input.leads)
      ? input.leads
          .map((item, index) => this.leadConfirmationDraftInput(item, index))
          .filter((item): item is GrowthLeadConfirmationDraft => Boolean(item))
      : [];
    return {
      confirmed,
      confirmedBy,
      note,
      allowDuplicates:
        input.allowDuplicates === true ||
        confirmation?.allowDuplicates === true,
      leads,
    };
  }

  private leadConfirmationDraftInput(
    value: unknown,
    index: number,
  ): GrowthLeadConfirmationDraft | null {
    const record = this.objectRecord(value);
    if (!record) return null;
    const platform = this.platform(record.platform);
    const nickname =
      this.text(record.nickname) ||
      this.text(record.accountName) ||
      this.text(record.name) ||
      `RedFox 情报线索${index + 1}`;
    const sourceText =
      this.text(record.sourceText) ||
      this.text(record.reason) ||
      `${this.platformLabel(platform)}情报线索：${nickname}`;
    const score = this.scoreText(sourceText);
    return {
      id: this.text(record.id) || `redfox-confirm-${index + 1}`,
      platform,
      nickname,
      profileUrl: this.text(record.profileUrl),
      externalUserId: this.text(record.externalUserId),
      sourceText,
      sourceUrl: this.text(record.sourceUrl),
      matchedKeywords: this.list(record.matchedKeywords),
      score: this.number(record.score, score.score),
      scoreReasons: this.list(record.scoreReasons).length
        ? this.list(record.scoreReasons)
        : score.reasons,
      confirmationStatus:
        this.text(record.confirmationStatus) === 'strategy-only'
          ? 'strategy-only'
          : 'ready-for-confirmation',
      requiredHumanConfirmation: true,
      confirmationReason:
        this.text(record.confirmationReason) ||
        '运营已从 RedFox 情报中确认该对象可作为线索跟进。',
      evidenceChain: this.intelligenceEvidenceList(
        record.evidenceChain || record.evidence,
      ),
    };
  }

  private intelligenceEvidenceList(
    value: unknown,
  ): GrowthIntelligenceEvidence[] {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    const evidence: GrowthIntelligenceEvidence[] = [];
    for (const item of items) {
      if (typeof item === 'string') {
        evidence.push({
          source: 'manual',
          sourceUrl: item,
          evidenceUrl: item,
          collectedAt: new Date().toISOString(),
          note: '外部证据链接',
        });
        continue;
      }
      const record = this.objectRecord(item);
      if (!record) continue;
      const source = this.text(record.source) || 'redfox';
      const sourceUrl = this.text(record.sourceUrl || record.url);
      const evidenceUrl = this.text(
        record.evidenceUrl || record.url || record.path,
      );
      evidence.push({
        source,
        sourceId: this.text(record.sourceId || record.id || record.requestId),
        sourceUrl,
        evidenceUrl,
        rawHash:
          this.text(record.rawHash) ||
          (record.raw ? this.rawHash(record.raw) : undefined),
        collectedAt:
          this.text(record.collectedAt || record.createdAt) ||
          new Date().toISOString(),
        note:
          this.text(record.note || record.label || record.title) ||
          'RedFox 情报证据',
      });
    }
    return evidence;
  }

  private mergeEvidenceChains(
    left: GrowthIntelligenceEvidence[],
    right: GrowthIntelligenceEvidence[],
  ): GrowthIntelligenceEvidence[] {
    const seen = new Set<string>();
    const merged: GrowthIntelligenceEvidence[] = [];
    for (const item of [...left, ...right]) {
      const key = [
        item.source,
        item.sourceId,
        item.sourceUrl,
        item.evidenceUrl,
        item.rawHash,
      ]
        .filter(Boolean)
        .join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged.slice(0, 12);
  }

  private evidenceUrlsFromIntelligence(
    evidenceChain: GrowthIntelligenceEvidence[],
  ) {
    return this.uniqueList(
      evidenceChain.flatMap(
        (item) =>
          [item.evidenceUrl, item.sourceUrl].filter(Boolean) as string[],
      ),
    ).slice(0, 20);
  }

  private inferBenchmarkIndustry(accounts: RedfoxBenchmarkAccountInput[]) {
    const text = accounts
      .flatMap((account) => [
        account.reason,
        ...(account.contentSignals || []),
        ...(account.intentSignals || []),
      ])
      .filter(Boolean)
      .join(' ');
    if (/装修|家装|设计|全屋/.test(text)) return '装修';
    if (/餐饮|开店|探店|加盟|外卖/.test(text)) return '餐饮';
    if (/教育|课程|升学|考研|培训/.test(text)) return '教育';
    if (/美业|皮肤|医美|美甲|祛痘/.test(text)) return '美业';
    return '本地服务';
  }

  private rawHash(value: unknown) {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex')
      .slice(0, 24);
  }

  private async createRunResult(
    config: GrowthAcquisitionConfig,
    input: {
      status: GrowthAcquisitionRun['status'];
      message: string;
      failureReason?: GrowthExecutionFailureReason;
      candidateCount: number;
      selectedCount: number;
      contactedCount: number;
      quotaConsumedCount?: number;
      evidenceUrls?: string[];
      leadIds?: string[];
      leads?: GrowthLead[];
      /** 复核#4 可追责：触发来源（默认 api）与是否经审批（默认取 config 审批留痕） */
      trigger?: GrowthAcquisitionRun['trigger'];
      approved?: boolean;
      /** 复核#4-6：driver 真实状态机记录 id（参数透传，防并发串单） */
      rpaRecordId?: string | null;
      /** P1-2：失败回退追踪（RPA 失败→回退本地适配器时如实标注来源） */
      fallback?: FallbackTrace;
    },
  ) {
    const now = new Date().toISOString();
    const tenantId =
      config.tenantId || (await this.resolveGrowthTenantId(config.userId));
    const run: GrowthAcquisitionRun = {
      id: this.id('run'),
      userId: config.userId,
      tenantId,
      configId: config.id,
      mode: config.mode,
      platform: config.platform,
      status: input.status,
      failureReason: input.failureReason,
      message: input.message,
      candidateCount: input.candidateCount,
      selectedCount: input.selectedCount,
      contactedCount: input.contactedCount,
      crmCapturedCount: 0,
      evidenceUrls: input.evidenceUrls || [],
      leadIds: input.leadIds || (input.leads || []).map((lead) => lead.id),
      trigger: input.trigger ?? 'api',
      runRiskMode: config.riskMode,
      approved: input.approved ?? Boolean(config.autoApprovedAt),
      fallback: input.fallback,
      startedAt: now,
      endedAt: now,
    };
    let leads: GrowthLead[] = (input.leads || []).map((lead) => ({
      ...lead,
      tenantId,
      sourceRunId: run.id,
    }));
    const updatedConfig: GrowthAcquisitionConfig = {
      ...config,
      tenantId,
      exposureCount:
        config.exposureCount +
        (input.quotaConsumedCount ?? input.contactedCount),
      lastRunAt: now,
      updatedAt: now,
    };
    const scope: GrowthScope = { userId: config.userId, tenantId };
    // 六步闭环 P1-6：先幂等桥接统一侧（lead 落库统一 leads 表 + 评分 + 归因），
    // 再转 CRM（LeadConvertService.convert 内部 findUnique lead，需要 lead 已落库）。
    // 桥接失败不阻断 JSON 主流程（审计尽力而为，错误不静默）。
    await this.bridgeLeadsToUnified(config, leads, scope);

    leads = await this.captureRunLeadsToCrm(config, run, leads);
    run.leadIds = input.leadIds || leads.map((lead) => lead.id);

    // 复核#2：每次获客执行持久化 RPA 执行记录（步骤/断点/证据/指纹/原因码/下一动作）。
    // 复核#4-6：driver 成功路径的 rpaRecordId 参数透传（不用单例字段，防并发串单）。
    // P1 复核：不再 fire-and-forget——await 等待审计落库；写失败时 run 不能显示成功
    // （无审计记录的「成功」不可追责），降级为 failed 并标注原因。
    // 关键：审计写入必须前置在 saveStore 之前——否则库/快照里的 run 已是 success，
    // 审计失败后仅内存改状态不二次持久化，刷新任务列表仍显示成功。
    const auditPersisted = await this.persistRpaExecution(
      config,
      run,
      input,
      tenantId ?? 'legacy-local-desktop',
      input.rpaRecordId ?? null,
    );
    if (
      !auditPersisted &&
      (run.status === 'success' || run.status === 'partial')
    ) {
      run.status = 'failed';
      run.failureReason = 'engine_unavailable';
      run.message = `${run.message}（RPA 执行审计记录写入失败，已降级为失败，不可追责）`;
    }

    const latestStore = await this.loadStore();
    const configExists = latestStore.configs.some((item) =>
      this.sameGrowthRecord(item, scope, config.id),
    );
    await this.saveStore(
      {
        ...latestStore,
        configs: configExists
          ? latestStore.configs.map((item) =>
              this.sameGrowthRecord(item, scope, config.id)
                ? updatedConfig
                : item,
            )
          : [updatedConfig, ...latestStore.configs],
        runs: [run, ...latestStore.runs].slice(0, 500),
        leads: [...leads, ...latestStore.leads].slice(0, 1000),
      },
      { scope, collections: ['configs', 'runs', 'leads'] },
    );
    return { config: updatedConfig, run, leads };
  }

  /** 复核#2：把本次获客执行落 rpa_executions（失败记 warn，不阻断） */
  private async persistRpaExecution(
    config: GrowthAcquisitionConfig,
    run: GrowthAcquisitionRun,
    input: {
      status: GrowthAcquisitionRun['status'];
      message: string;
      failureReason?: GrowthExecutionFailureReason;
      candidateCount: number;
      selectedCount: number;
      contactedCount: number;
      evidenceUrls?: string[];
      trigger?: GrowthAcquisitionRun['trigger'];
      approved?: boolean;
      /** 复核#4-6：driver 真实状态机记录 id（参数透传，防并发串单） */
      rpaRecordId?: string | null;
    },
    tenantId: string,
    driverRecordId?: string | null,
  ): Promise<boolean> {
    // P1 复核：store 未注入 = 本环境未启用 RPA 审计（如抖音 legacy 直连路径），
    // 视为「无需 RPA 记录」，不降级 run；只有 store 存在但写入失败才返回 false。
    if (!this.rpaExecutionStore) return true;
    // 复核#4-6：driver 真实状态机已记录本次执行（成功路径，recordId 参数透传），
    // 跳过合成记录防重复（审计已由 driver 状态机覆盖，视为成功）；
    // 任务最终非成功（如后续流程失败）时仍写合成记录，如实反映最终结果。
    if (driverRecordId) {
      if (input.status === 'success' || input.status === 'partial') {
        this.logger.log(
          `本次获客走 driver 真实状态机（record=${driverRecordId}），跳过合成 RPA 记录（run=${run.id}）`,
        );
        return true;
      }
    }
    try {
      // 如实保留执行状态（success/failed/skipped/partial），不折叠
      const failed = input.status === 'failed';
      const stepTrace = [
        { name: 'fetch-candidates', count: input.candidateCount },
        { name: 'select-targets', count: input.selectedCount },
        { name: 'follow-up', count: input.contactedCount },
      ];
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            runId: run.id,
            configId: config.id,
            mode: config.mode,
            platform: config.platform,
            status: input.status,
            candidates: input.candidateCount,
            contacted: input.contactedCount,
          }),
        )
        .digest('hex');
      await this.rpaExecutionStore.create({
        tenantId,
        userId: config.userId,
        platform: config.platform,
        sessionId: null,
        accountId: config.accountId || null,
        mode: config.mode,
        // P1-14 复核：合成留痕显式标注 source=growth-synthesis——
        // 不经 driver 真实步骤/独立 evidence/finalize 门禁的记录不得冒充「RPA 浏览器执行成功」，
        // 审计查询按 source 区分真实执行与获客流程合成。
        source: 'growth-synthesis',
        steps: stepTrace,
        resumeStep: failed ? 'fetch-candidates' : null,
        reasonCode: input.failureReason ?? null,
        nextAction: failed
          ? '检查账号登录态与平台额度后重跑本次获客任务'
          : null,
        pageFingerprint: fingerprint,
        evidence: input.evidenceUrls || [],
        status: input.status,
        driverVersion: '1.0.0',
        runId: run.id,
        userMessage: input.message,
        technicalMessage: null,
      });
      // P1 复核：审计写入成功
      return true;
    } catch (error) {
      this.logger.warn(
        `增长获客 RPA 执行留痕失败（run=${run.id}）：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** 事实来源桥接：把本次落库的 GrowthLead 幂等桥接到统一侧（失败不阻断） */
  private async bridgeLeadsToUnified(
    config: GrowthAcquisitionConfig,
    leads: GrowthLead[],
    scope: GrowthScope,
  ) {
    if (!this.leadBridge || !leads.length) return;
    const ctx = {
      tenantId: scope.tenantId ?? 'legacy-local-desktop',
      userId: scope.userId,
      accountId: config.accountId,
    };
    for (const lead of leads) {
      try {
        const bridgeResult = await this.leadBridge.bridgeAndEnrich(lead, ctx);
        // 桥接结果是后续持久化的唯一事实来源。若只标 enrichmentStatus，
        // sourceInteractionEventId/suppression/评分仍留在临时返回值，下一次
        // saveStore 会用空字段覆盖统一 Lead，造成归因断链或误触达。
        lead.sourceInteractionEventId =
          bridgeResult.sourceInteractionEventId ??
          lead.sourceInteractionEventId;
        lead.suppressed = bridgeResult.suppressed;
        if (bridgeResult.scoreTotal !== null) {
          lead.score = bridgeResult.scoreTotal;
        }
        if (bridgeResult.scoreReasons) {
          lead.scoreReasons = bridgeResult.scoreReasons;
        }
        if (bridgeResult.scoreIdentityConfidence !== null) {
          lead.identityConfidence = bridgeResult.scoreIdentityConfidence;
        }
        // 被资格服务明确阻断的线索等同于抑制，绝不能进入自动 CRM/触达链路。
        if (bridgeResult.qualification?.outcome === 'blocked') {
          lead.suppressed = true;
        }
        // P0-5 复核：桥接任一分段失败（事件/身份/归因/评分/抑制/资格）→ 不得标 ok，
        // 持久化 enrichmentStatus=failed（前端显示"采集完成但评分/归因未闭环"，禁止假闭环）。
        const failedSegments = bridgeResult?.failedSegments ?? [];
        if (failedSegments.length > 0) {
          lead.enrichmentStatus = 'failed';
          lead.enrichmentFailure = failedSegments.join(',');
          this.logger.warn(
            `增长线索桥接统一侧分段失败（lead=${lead.id}）：${failedSegments.join(',')}`,
          );
        } else {
          lead.enrichmentStatus = 'ok';
        }
      } catch (error) {
        // P1-6：桥接失败不静默——线索如实标注 enrichment_failed，
        // 前端显示"线索已采集，评分/归因未完成"，不允许显示为已完成闭环。
        lead.enrichmentStatus = 'failed';
        lead.enrichmentFailure =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `增长线索桥接统一侧失败（lead=${lead.id}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async captureRunLeadsToCrm(
    config: GrowthAcquisitionConfig,
    run: GrowthAcquisitionRun,
    leads: GrowthLead[],
  ) {
    if (!leads.length || run.contactedCount <= 0) {
      return leads;
    }
    const nextLeads: GrowthLead[] = [];
    let capturedCount = 0;
    let crmDisabled = false;
    for (const lead of leads) {
      if (!this.isCrmCaptureEligibleLead(lead) || crmDisabled) {
        nextLeads.push(lead);
        continue;
      }
      try {
        // 六步闭环 P1-7：自动获客也统一走 LeadConvertService（与手动 sync-crm 同一套数据链）。
        // 前置：bridgeLeadsToUnified 已把 lead 落库到统一 leads 表（convert 内部 findUnique lead）。
        if (this.leadConvertService) {
          const converted = await this.leadConvertService.convert({
            leadId: lead.id,
            scope: { userId: config.userId, tenantId: run.tenantId ?? null },
          });
          const customer = converted.customer;
          capturedCount += 1;
          nextLeads.push(
            this.withCrmCustomerNote(
              config.userId,
              lead,
              customer.id,
              customer.displayName,
              'auto',
            ),
          );
          continue;
        }
        // 回退旧链路（leadConvertService 未注入时）
        if (!this.crmService) {
          nextLeads.push(lead);
          continue;
        }
        const capture = await this.crmService.captureGrowthLead(
          config.userId,
          this.growthLeadToCrmCaptureInput(lead),
        );
        if (!capture.enabled) {
          crmDisabled = true;
          nextLeads.push(lead);
          continue;
        }
        const customer = capture.capturedCustomers[0];
        if (!customer) {
          nextLeads.push(lead);
          continue;
        }
        capturedCount += 1;
        nextLeads.push(
          this.withCrmCustomerNote(
            config.userId,
            lead,
            customer.customerId,
            customer.displayName,
            'auto',
          ),
        );
      } catch (error) {
        this.logger.warn(
          `增长线索同步 CRM 失败（lead=${lead.id}）：${error instanceof Error ? error.message : String(error)}`,
        );
        nextLeads.push(lead);
      }
    }
    if (capturedCount > 0) {
      run.crmCapturedCount = capturedCount;
      run.message = `${run.message}；已同步 ${capturedCount} 条线索到 CRM`;
    }
    return nextLeads;
  }

  /**
   * P0-6 复核：CRM 资格门禁——不能只看 status 是 contacted/replied 就自动转 CRM。
   * 低质量/桥接失败/缺关键身份字段/被抑制的线索必须强制留在人工池：
   * - enrichmentStatus=failed（桥接/评分/归因未闭环）→ 不转 CRM；
   * - 无 externalUserId 且无 sourceUrl（只有昵称/文本）→ 身份不可归因，不自动转 CRM；
   * - suppressed（命中抑制名单）→ 不转 CRM；
   * - missingFields 含关键身份字段 → 不自动转 CRM（留人工补录）。
   */
  private isCrmCaptureEligibleLead(lead: GrowthLead) {
    if (
      !['contacted', 'replied', 'qualified', 'converted'].includes(lead.status)
    ) {
      return false;
    }
    if (lead.enrichmentStatus === 'failed') return false;
    if (lead.suppressed === true) return false;
    // 身份可归因门槛：有外部用户 ID，或至少可溯源内容 URL（仅昵称+文本不可自动转 CRM）
    const hasIdentity = Boolean(
      lead.externalUserId || lead.sourceUrl || lead.profileUrl,
    );
    if (!hasIdentity) return false;
    // missingFields 含关键身份字段 → 留人工池。
    // externalEventId（评论事件 ID）缺失时降级即可（有 externalUserId/profileUrl/sourceUrl
    // 仍可归因），不作为硬门槛；externalUserId/profileUrl 才是身份硬字段。
    const criticalMissing = (lead.missingFields ?? []).filter((f) =>
      ['externalUserId', 'profileUrl'].includes(f),
    );
    if (criticalMissing.length > 0) return false;
    return true;
  }

  private growthLeadToCrmCaptureInput(lead: GrowthLead) {
    return {
      leadId: lead.id,
      platform: lead.platform,
      sourceType: lead.sourceType,
      sourceTaskId: lead.sourceTaskId,
      sourceRunId: lead.sourceRunId,
      nickname: lead.nickname,
      profileUrl: lead.profileUrl,
      externalUserId: lead.externalUserId,
      sourceText: lead.sourceText,
      sourceUrl: lead.sourceUrl,
      videoTitle: lead.videoTitle,
      videoUrl: lead.videoUrl,
      matchedKeywords: lead.matchedKeywords,
      score: lead.score,
      scoreReasons: lead.scoreReasons,
      status: lead.status,
      latestReply: lead.latestReply,
      evidenceUrls: lead.evidenceUrls,
    };
  }

  private withCrmCustomerNote(
    userId: string,
    lead: GrowthLead,
    customerId: string,
    displayName: string,
    mode: 'auto' | 'manual',
  ): GrowthLead {
    const now = new Date().toISOString();
    const alreadyLinked = lead.crmCustomerId === customerId;
    const text =
      mode === 'auto'
        ? `真实触达成功后已自动沉淀到 CRM 客户：${displayName}。`
        : `已同步到 CRM 客户：${displayName}。`;
    return {
      ...lead,
      crmCustomerId: customerId,
      notes: alreadyLinked
        ? lead.notes
        : [
            {
              id: this.id('note'),
              text,
              type: 'general',
              createdAt: now,
              createdBy: userId,
            },
            ...(lead.notes || []),
          ],
      updatedAt: now,
    };
  }

  private assertValidConfig(config: GrowthAcquisitionConfig) {
    const errors: string[] = [];
    if (!config.taskName.trim()) errors.push('任务名称不能为空');
    if (config.taskName.length > 60) errors.push('任务名称最多 60 个字');
    if (!config.sourceInputs.length)
      errors.push('至少需要 1 条来源关键词、链接、账号或候选文本');
    if (config.sourceInputs.length > 80)
      errors.push('来源最多 80 条，请拆分为多个任务');
    if (
      config.mode === 'retention' &&
      config.sourceInputs.some(
        (item) =>
          !/^https?:\/\/(?:www\.)?douyin\.com\/(?:video|user|share\/user)\//i.test(
            item,
          ),
      )
    ) {
      errors.push(
        '留资曝光只接受明确的抖音视频互动链接或客户主页链接，不能使用普通搜索词代替客户来源',
      );
    }
    if (!config.includeKeywords.length) errors.push('至少需要 1 个意向关键词');
    if (
      !config.commentTemplates.length &&
      !config.privateMessageTemplates.length
    )
      errors.push('评论话术或私信话术至少需要配置一类');
    if (
      !Number.isInteger(config.dailyLimit) ||
      config.dailyLimit < 1 ||
      config.dailyLimit > 200
    )
      errors.push('每日上限需为 1-200 的整数');
    if (
      !Number.isInteger(config.perTargetLimit) ||
      config.perTargetLimit < 1 ||
      config.perTargetLimit > 10
    )
      errors.push('单目标上限需为 1-10 的整数');
    if (!/^\d{2}:\d{2}$/.test(config.beginTime)) {
      errors.push('计划开始时间格式需为 HH:mm');
    } else {
      const [hour, minute] = config.beginTime.split(':').map(Number);
      if (hour > 23 || minute > 59) errors.push('计划开始时间无效');
    }
    if (config.riskMode === 'auto' && config.dailyLimit > 50)
      errors.push('自动触达模式下每日上限不能超过 50');
    if (
      !config.accountId ||
      ['default', 'demo-growth-account'].includes(config.accountId)
    )
      errors.push('请先选择真实执行账号，不能使用占位账号创建任务');
    if (errors.length) throw new BadRequestException(errors.join('；'));
  }

  private async fetchCandidatesWithAiEmployee(
    config: GrowthAcquisitionConfig,
    remaining: number,
  ): Promise<AiEmployeeLeadResponse> {
    const limit = Math.min(Math.max(remaining, 20), 50);
    const primaryInput = await this.nextGrowthAcquisitionSourceInput(config);
    // 抖音 keyword/search-account：优先两段式（行业词搜账号 → 读作品 → 读评论）
    if (
      config.platform === 'douyin' &&
      (config.mode === 'keyword' || config.mode === 'search-account')
    ) {
      const journey = await this.tryFetchDouyinAccountJourney(config, remaining);
      if (journey?.ok === true) return journey;
      // 两段式失败/不可用 → fallthrough 到下方 findDouyinXXX 旧链路兜底
    }
    const shouldTryRpa = config.platform !== 'douyin';
    if (shouldTryRpa) {
      // 阶段 A：优先走统一 RPA driver（浏览器行为式搜索，绕 /search/ 验证码）。
      // 抖音 keyword/search-account 也纳入（原直接 goto /search/ 触发验证码）。
      // 失败/不支持静默回退旧链路（fail-safe，不破坏现有行为）
      const driverResult = await this.tryFetchCandidatesWithRpaDriver(
        config,
        remaining,
      );
      if (driverResult?.ok) return driverResult;
      // P0 复核：RPA 执行了但审计落库失败（audit_record_failed/audit_persist_failed）
      // → 不回退 legacy adapter（那会产生与 RPA 执行无关的误导性候选），干净返回失败。
      // 仅当 RPA 执行本身失败/不可用时才回退 legacy adapter（fail-safe）。
      const auditFailed =
        driverResult?.fallback?.reasonCode === 'audit_record_failed' ||
        driverResult?.fallback?.reasonCode === 'audit_persist_failed';
      if (auditFailed) {
        return {
          ok: false,
          fallback: driverResult?.fallback,
          candidates: [],
          message:
            driverResult?.fallback?.message ||
            'RPA 执行成功但审计落库失败，已阻断成功标记',
        };
      }
      // 非抖音：RPA 失败/不可用 → 回退旧链路（抖音两段式已在上方优先处理，此处不再涉及抖音）
      const legacy = this.fetchCandidatesWithPlatformAdapter(config);
      const fallback: FallbackTrace = driverResult?.fallback ?? {
        attempted: false,
        source: 'legacy-adapter',
        rpaExecutionId: null,
        reasonCode: null,
        fallbackAllowed: true,
        message: 'RPA 路径未尝试，直接使用本地适配器',
      };
      return { ...legacy, fallback };
    }
    if (config.mode === 'search-account') {
      return this.aiEmployeeService.findDouyinLeadsByKeyword({
        accountId: config.accountId,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
        nicknameKeywords: config.includeKeywords,
        blacklistNicknames: config.blacklistNicknames,
      });
    }
    if (config.mode === 'video-link') {
      return this.aiEmployeeService.findDouyinLeadsByLink({
        accountId: config.accountId,
        link: primaryInput,
        limit,
        commentTimeMatch: '7days',
      });
    }
    if (config.mode === 'target-account') {
      return this.aiEmployeeService.findDouyinTargetedLeads({
        accountId: config.accountId,
        targetAccounts: config.sourceInputs,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
        perTargetLimit: config.perTargetLimit,
      });
    }
    if (config.mode === 'retention') {
      return this.aiEmployeeService.findDouyinRetentionLeads({
        accountId: config.accountId,
        retentionSourceId: primaryInput,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
      });
    }
    if (config.mode === 'manual-import') {
      return {
        ok: true,
        status: 'partial',
        message: '手动导入模式已按来源文本生成候选线索。',
        candidates: config.sourceInputs.map((text, index) => ({
          text,
          index,
          kind: 'manual-import',
          reason: '手动导入候选',
          score: this.scoreText(text).score,
        })),
        evidence: [],
      };
    }
    return this.aiEmployeeService.findDouyinHotVideoLeads({
      accountId: config.accountId,
      keyword: primaryInput,
      limit,
      commentTimeMatch: '7days',
      blacklistNicknames: config.blacklistNicknames,
    });
  }

  /**
   * 阶段 A/B：尝试用统一 RPA driver 发现候选（快手/小红书浏览器搜索），
   * 并把执行记录升级为真实状态机（openSession→create → execute→appendStep → finalize）。
   * fail-safe：driver 不存在/不支持/失败 → 返回 null，调用方回退旧链路；
   * 状态机写库失败（store 不可用/写失败）不阻断 driver 路径，仅记 warn。
   */
  private async tryFetchCandidatesWithRpaDriver(
    config: GrowthAcquisitionConfig,
    remaining: number,
  ): Promise<
    | ({ ok: true } & AiEmployeeLeadResponse & { fallback?: undefined })
    | { ok: false; fallback: FallbackTrace }
  > {
    if (!this.rpaDriverRegistry) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'no_driver',
          fallbackAllowed: true,
          message: 'RPA driver 注册表不可用，回退本地适配器',
        },
      };
    }
    const driver = this.rpaDriverRegistry.get(config.platform);
    if (!driver) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'no_driver',
          fallbackAllowed: true,
          message: `${config.platform} 无统一 RPA driver，回退本地适配器`,
        },
      };
    }
    // 仅用 driver 的能力声明判断是否支持，避免对抖音等成熟链路造成影响；
    // 卡点1：增长后台执行也走账号级预检（未登录/风控 → 拒绝，防绕过）
    const caps = await driver.capabilities({ accountId: config.accountId });
    const probe = caps.accountProbe;
    if (
      probe &&
      (!probe.loggedIn || probe.captchaRequired || probe.riskControl)
    ) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: probe.reasonCode ?? 'not_logged_in',
          fallbackAllowed: true,
          message: `账号 ${config.accountId} 预检未通过（${probe.reasonCode ?? 'not_logged_in'}），回退本地适配器`,
        },
      };
    }
    const action = this.driverActionForMode(config.mode);
    if (!action) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'unsupported_mode',
          fallbackAllowed: true,
          message: `模式 ${config.mode} 无对应 RPA 动作，回退本地适配器`,
        },
      };
    }
    const actionCap = caps.actions.find((a) => a.action === action);
    if (!actionCap?.supported || !caps.runtimeReady) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: actionCap?.supported
            ? 'runtime_not_ready'
            : 'unsupported_action',
          fallbackAllowed: true,
          message: `${driver.displayName} 不支持 ${action} 或运行时未就绪，回退本地适配器`,
        },
      };
    }

    const owner = {
      userId: config.userId,
      tenantId: config.tenantId ?? 'legacy-local-desktop',
    };
    const sessionRunId = `growth-rpa-${config.id}-${Date.now()}`;
    let recordId: string | null = null;
    // 用对象引用保存 session：TS 对跨异步闭包的 let 收窄不可靠（会推断成 null/never），
    // 对象属性访问可正确追踪类型。
    const sessionRef: { current: RpaSession | null } = { current: null };
    // P1 复核：try/catch 主体包进 IIFE（保留内部所有 return 语义），
    // 会话收尾（原 finally）移到 IIFE 外——关闭失败时同步降级 run 返回值，
    // 避免「任务列表成功、审计页待核对」状态不一致。
    const outcome:
      | ({ ok: true } & AiEmployeeLeadResponse & { fallback?: undefined })
      | { ok: false; fallback: FallbackTrace } = await (async () => {
      try {
        sessionRef.current = await driver.openSession({
          userId: config.userId,
          accountId: config.accountId,
          runId: sessionRunId,
        });
        // B 阶段：openSession 后立即建真实状态机记录（失败不阻断 driver 路径）
        recordId = await this.openDriverExecutionRecord(
          driver,
          config,
          sessionRef.current.sessionId,
          sessionRunId,
        );
        const input =
          action === 'discover-keyword'
            ? {
                keyword:
                  config.sourceInputs[0] ??
                  config.taskName ??
                  config.includeKeywords?.join(' ') ??
                  '',
                limit: remaining,
                userId: config.userId,
              }
            : action === 'read-comments'
              ? {
                  // 复核#4-5：video-link 打开视频详情页读评论区（评论者 = 候选）
                  contentUrl: config.sourceInputs[0] ?? '',
                  limit: remaining,
                  userId: config.userId,
                }
              : action === 'discover-account-search'
                ? {
                    keyword:
                      config.sourceInputs[0] ?? config.taskName ?? '',
                    limit: remaining,
                    userId: config.userId,
                  }
                : action === 'discover-recommended'
                  ? {
                      // P2 复核：推荐流不需要关键词/目标，keyword 仅作配额与审计标识
                      keyword: config.taskName ?? 'recommended',
                      limit: remaining,
                      userId: config.userId,
                    }
                  : {
                    targetId: config.sourceInputs[0] ?? '',
                    limit: remaining,
                    userId: config.userId,
                  };
        const result = await driver.execute(sessionRef.current, {
          name: action,
          action,
          input,
        });
        if (result.status !== 'success' || !result.items?.length) {
          // 如实记录失败步骤 + 终态，再回退旧链路（合成记录仍会如实写最终结果）
          const failReason = result.reasonCode ?? 'parse_failed';
          await this.appendDriverStep(recordId, owner, {
            stepName: action,
            status: 'failed',
            reasonCode: failReason,
            message:
              result.message ||
              `${driver.displayName} 未发现候选，已回退本地适配器`,
          });
          await this.finalizeDriverRecord(recordId, owner, {
            status: 'failed',
            reasonCode: failReason,
            nextAction: '已回退本地适配器；请检查浏览器登录态与页面结构后重试',
          });
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: recordId,
              reasonCode: failReason,
              fallbackAllowed: true,
              message:
                result.message ||
                `${driver.displayName} 未发现候选，已回退本地适配器（执行 ${recordId}）`,
            },
          };
        }
        // P0 复核：RPA 状态记录失败必须阻断成功——
        // 记录创建失败（recordId=null）时不得标记成功（无可追责记录）。
        if (!recordId) {
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: null,
              reasonCode: 'audit_record_failed',
              fallbackAllowed: true,
              message:
                'RPA 执行成功但状态记录创建失败（无可追责审计），已阻断成功标记，回退本地适配器',
            },
          };
        }
        // P1-9 复核：RPA 结果字段完整透传到候选——externalContentId/externalUserId/
        // externalEventId/authorName/profileUrl/occurredAt/rawHash 不丢（Lead 归因/去重/CRM 依赖）
        const candidates: DouyinFollowUpCandidateInput[] = result.items.map(
          (item, index) => ({
            text: item.title || item.text || item.url || '',
            sourceUrl: item.url,
            kind: `${config.platform}-${action}`,
            index,
            reason: '统一 RPA 浏览器发现',
            score: this.scoreText(item.title || item.text || '').score,
            // P1-4/P1-9：评论用户身份/事件字段贯穿（RPA → Lead → CRM 不丢）
            externalContentId: item.externalContentId,
            externalUserId: item.externalUserId,
            externalEventId: item.externalEventId,
            authorName: item.authorName,
            profileUrl: item.profileUrl,
            commentTime: item.occurredAt,
            rawHash: item.rawHash,
          }),
        );
        const stepPersisted = await this.appendDriverStep(recordId, owner, {
          stepName: action,
          status: 'success',
          reasonCode: 'ok',
          message: `${driver.displayName} 发现 ${result.items.length} 条候选`,
          evidenceUrl: result.evidenceUrl,
          pageFingerprint: result.pageFingerprint,
        });
        const finalizePersisted = await this.finalizeDriverRecord(
          recordId,
          owner,
          {
            status: 'success',
            reasonCode: 'ok',
            evidence: result.items.map((item) => ({
              type: 'rpa-discover',
              label: item.title || item.externalContentId,
              url: item.url,
              createdAt: new Date().toISOString(),
            })),
          },
        );
        // P0 复核：成功步骤/终态落库失败 → 不返回成功（证据不完整不能标成功）
        if (!stepPersisted || !finalizePersisted) {
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: recordId,
              reasonCode: 'audit_persist_failed',
              fallbackAllowed: true,
              message: `RPA 执行成功但审计落库失败（步骤=${stepPersisted} 终态=${finalizePersisted}），已阻断成功标记（执行 ${recordId}）`,
            },
          };
        }
        // driver 成功路径：rpaRecordId 参数透传给合成记录跳过（复核#4-6：不用单例字段，防并发串单）
        return {
          ok: true,
          fallback: undefined,
          status: 'success',
          message: `统一 RPA 发现 ${candidates.length} 条候选`,
          candidates,
          rpaRecordId: recordId,
          evidence: result.items.map((item) => ({
            type: 'rpa-discover',
            label: item.title || item.externalContentId,
            url: item.url,
            createdAt: new Date().toISOString(),
          })),
        };
      } catch (error) {
        // P1 复核：账号忙（createWithLock 抛 ConflictException）→ 透传给上层转 409，
        // 不能当 driver 执行失败回退 legacy adapter（那会绕过账号锁并发执行）。
        if (error instanceof ConflictException) {
          throw error;
        }
        // fail-safe：driver 执行失败回退旧链路；状态机如实记录失败
        await this.appendDriverStep(recordId, owner, {
          stepName: action,
          status: 'failed',
          reasonCode: 'network_error',
          message: error instanceof Error ? error.message : 'driver 执行异常',
        });
        await this.finalizeDriverRecord(recordId, owner, {
          status: 'failed',
          reasonCode: 'network_error',
          nextAction: '已回退本地适配器；请检查平台会话后重试',
        });
        return {
          ok: false,
          fallback: {
            attempted: true,
            source: 'legacy-adapter',
            rpaExecutionId: recordId,
            reasonCode: 'network_error',
            fallbackAllowed: true,
            message: `RPA driver 执行异常，已回退本地适配器（执行 ${recordId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
      }
    })();
    // P0 复核：发现路径统一收尾关闭会话（防浏览器残留/账号锁不释放）。
    // P1 复核：关闭失败 → 执行记录转 reconcile_required（不能只留日志），
    // 同时降级本函数返回值状态（run 列表不再显示「成功」，与审计页「待核对」一致）。
    let sessionCloseFailed = false;
    const activeSession: RpaSession | null = sessionRef.current;
    if (activeSession) {
      try {
        await driver.closeSession({
          sessionId: activeSession.sessionId,
          platform: config.platform,
          accountId: config.accountId,
          engineSessionKey: `${config.platform}-${config.accountId}`,
          pageAvailable: false,
        });
      } catch (closeErr) {
        sessionCloseFailed = true;
        this.logger.warn(
          `[tryFetchCandidatesWithRpaDriver] 会话关闭失败 platform=${config.platform} account=${config.accountId}：${
            closeErr instanceof Error ? closeErr.message : String(closeErr)
          }`,
        );
        await this.markDriverSessionCloseFailure(
          config,
          recordId,
          closeErr,
          'tryFetchCandidatesWithRpaDriver',
        );
      }
    }
    if (sessionCloseFailed && outcome.ok === true) {
      return {
        ...outcome,
        // 关闭失败：候选已发现但浏览器会话状态不可确认 → 降级 partial（需人工核对），
        // 与 rpa_executions 的 reconcile_required 语义对齐，避免状态不一致。
        status: 'partial',
        reasonCode: 'session_close_failed',
        message: `${outcome.message}；浏览器会话关闭失败，需人工核对平台实际结果`,
      };
    }
    return outcome;
  }

  /**
   * 抖音两段式发现（2026-09-03）：行业词搜账号 → 进账号主页读作品 → 读评论找客户。
   *
   * 背景：keyword/search-account 直接拿「提示词」goto /search/ 会触发验证码，且搜不到
   * 「先找账号再找客户」的正确链路。改为三段 RPA 动作串行（同一会话）：
   *   1. discover-account-search（sourceInputs 行业词）→ 相关账号
   *   2. discover-account-works（账号 targetId）→ 账号作品
   *   3. read-comments（作品 url）→ 评论用户（这才是客户候选）
   * 评论用户候选交回 executeConfig → planDouyinFollowUp 用 includeKeywords（意向词）匹配触达。
   * 失败/不可用返回 ok:false + fallback，调用方回退 exposure-collector 旧链路。
   */
  private async tryFetchDouyinAccountJourney(
    config: GrowthAcquisitionConfig,
    remaining: number,
  ): Promise<
    | ({ ok: true } & AiEmployeeLeadResponse & { fallback?: undefined })
    | { ok: false; fallback: FallbackTrace }
  > {
    if (!this.rpaDriverRegistry) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'no_driver',
          fallbackAllowed: true,
          message: 'RPA driver 注册表不可用，回退本地适配器',
        },
      };
    }
    const driver = this.rpaDriverRegistry.get(config.platform);
    if (!driver) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'no_driver',
          fallbackAllowed: true,
          message: `${config.platform} 无统一 RPA driver，回退本地适配器`,
        },
      };
    }
    const caps = await driver.capabilities({ accountId: config.accountId });
    const probe = caps.accountProbe;
    if (probe && (!probe.loggedIn || probe.captchaRequired || probe.riskControl)) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: probe.reasonCode ?? 'not_logged_in',
          fallbackAllowed: true,
          message: `账号 ${config.accountId} 预检未通过（${probe.reasonCode ?? 'not_logged_in'}），回退本地适配器`,
        },
      };
    }
    const searchCap = caps.actions.find((a) => a.action === 'discover-account-search');
    const worksCap = caps.actions.find((a) => a.action === 'discover-account-works');
    const commentsCap = caps.actions.find((a) => a.action === 'read-comments');
    if (
      !caps.runtimeReady ||
      !searchCap?.supported ||
      !worksCap?.supported ||
      !commentsCap?.supported
    ) {
      return {
        ok: false,
        fallback: {
          attempted: false,
          source: 'legacy-adapter',
          rpaExecutionId: null,
          reasonCode: 'unsupported_action',
          fallbackAllowed: true,
          message: `${driver.displayName} 两段式发现能力不完整（搜账号/读作品/读评论缺一），回退本地适配器`,
        },
      };
    }

    const owner = {
      userId: config.userId,
      tenantId: config.tenantId ?? 'legacy-local-desktop',
    };
    const sessionRunId = `growth-rpa-journey-${config.id}-${Date.now()}`;
    let recordId: string | null = null;
    const sessionRef: { current: RpaSession | null } = { current: null };

    const outcome:
      | ({ ok: true } & AiEmployeeLeadResponse & { fallback?: undefined })
      | { ok: false; fallback: FallbackTrace } = await (async () => {
      try {
        sessionRef.current = await driver.openSession({
          userId: config.userId,
          accountId: config.accountId,
          runId: sessionRunId,
        });
        recordId = await this.openDriverExecutionRecord(
          driver,
          config,
          sessionRef.current.sessionId,
          sessionRunId,
        );

        // 第一段：行业词搜账号
        const accountKeyword = config.sourceInputs[0] ?? config.taskName ?? '';
        const accountResult = await driver.execute(sessionRef.current, {
          name: 'discover-account-search',
          action: 'discover-account-search',
          input: { keyword: accountKeyword, limit: 10, userId: config.userId },
        });
        if (accountResult.status !== 'success' || !accountResult.items?.length) {
          const failReason = accountResult.reasonCode ?? 'parse_failed';
          await this.appendDriverStep(recordId, owner, {
            stepName: 'discover-account-search',
            status: 'failed',
            reasonCode: failReason,
            message: accountResult.message || '行业词搜账号未解析到结果',
          });
          await this.finalizeDriverRecord(recordId, owner, {
            status: 'failed',
            reasonCode: failReason,
            nextAction: '已回退本地适配器；请检查浏览器登录态与页面结构后重试',
          });
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: recordId,
              reasonCode: failReason,
              fallbackAllowed: true,
              message:
                accountResult.message ||
                `两段式发现：行业词搜账号未解析到结果，已回退本地适配器（执行 ${recordId}）`,
            },
          };
        }
        const accountIds = accountResult.items
          .map((item) => item.externalUserId || item.externalContentId)
          .filter((value): value is string => Boolean(value));
        await this.appendDriverStep(recordId, owner, {
          stepName: 'discover-account-search',
          status: 'success',
          reasonCode: 'ok',
          message: `行业词「${accountKeyword}」搜到 ${accountIds.length} 个账号`,
        });

        // 第二段 + 第三段：读账号作品 → 读评论
        const commentUsers: DouyinFollowUpCandidateInput[] = [];
        const seen = new Set<string>();
        const accountLimit = Math.min(3, accountIds.length);
        for (let ai = 0; ai < accountLimit && commentUsers.length < remaining; ai += 1) {
          const targetId = accountIds[ai];
          const worksResult = await driver.execute(sessionRef.current, {
            name: 'discover-account-works',
            action: 'discover-account-works',
            input: { targetId, limit: 3, userId: config.userId },
          });
          if (worksResult.status !== 'success' || !worksResult.items?.length) {
            continue;
          }
          for (const work of worksResult.items.slice(0, 3)) {
            if (commentUsers.length >= remaining) break;
            const workUrl = this.text(work.url);
            if (!workUrl) continue;
            const commentResult = await driver.execute(sessionRef.current, {
              name: 'read-comments',
              action: 'read-comments',
              input: { contentUrl: workUrl, limit: 10, userId: config.userId },
            });
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (commentResult.status !== 'success' || !commentResult.items?.length) {
              continue;
            }
            for (const item of commentResult.items) {
              if (commentUsers.length >= remaining) break;
              const rawNickname = this.text(item.authorName);
              const nickname = rawNickname.replace(/作者$/, '').trim();
              const commentText = this.text(item.text);
              const externalUserId = this.text(item.externalUserId) || '';
              const dedupe = `${workUrl}:${externalUserId}:${nickname}:${commentText}`;
              if (!commentText || seen.has(dedupe)) continue;
              if (nickname && /作者|商家|客服|官方/.test(nickname)) continue;
              seen.add(dedupe);
              commentUsers.push({
                text: commentText,
                sourceUrl: workUrl,
                targetName: nickname || '抖音用户',
                kind: 'douyin-account-comment-user',
                index: commentUsers.length,
                reason: `评论区用户：${nickname || '匿名'}`,
                score: this.scoreText(commentText).score,
                externalUserId: externalUserId || undefined,
                profileUrl: this.text(item.profileUrl) || undefined,
                commentTime: this.text(item.occurredAt) || undefined,
                externalEventId: this.text(item.externalEventId) || undefined,
                externalContentId: this.text(item.externalContentId) || undefined,
                rawHash: this.text(item.rawHash) || undefined,
              });
            }
          }
        }

        if (!commentUsers.length) {
          await this.finalizeDriverRecord(recordId, owner, {
            status: 'failed',
            reasonCode: 'target_not_found',
            nextAction: '已回退本地适配器；账号作品评论区无可读评论',
          });
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: recordId,
              reasonCode: 'target_not_found',
              fallbackAllowed: true,
              message: `两段式发现：搜到 ${accountIds.length} 个账号但未读到评论用户，已回退本地适配器（执行 ${recordId}）`,
            },
          };
        }

        const stepPersisted = await this.appendDriverStep(recordId, owner, {
          stepName: 'read-comments',
          status: 'success',
          reasonCode: 'ok',
          message: `两段式读评论获得 ${commentUsers.length} 个评论用户`,
        });
        const finalizePersisted = await this.finalizeDriverRecord(recordId, owner, {
          status: 'success',
          reasonCode: 'ok',
          evidence: commentUsers.map((candidate) => ({
            type: 'rpa-discover',
            label: candidate.targetName || candidate.externalContentId,
            url: candidate.sourceUrl,
            createdAt: new Date().toISOString(),
          })),
        });
        if (!stepPersisted || !finalizePersisted) {
          return {
            ok: false,
            fallback: {
              attempted: true,
              source: 'legacy-adapter',
              rpaExecutionId: recordId,
              reasonCode: 'audit_persist_failed',
              fallbackAllowed: true,
              message: `两段式发现成功但审计落库失败（步骤=${stepPersisted} 终态=${finalizePersisted}），已阻断成功标记（执行 ${recordId}）`,
            },
          };
        }
        return {
          ok: true,
          fallback: undefined,
          status: 'success',
          message: `两段式发现：${accountIds.length} 个账号 → ${commentUsers.length} 个评论用户`,
          candidates: commentUsers,
          rpaRecordId: recordId,
          evidence: commentUsers.map((candidate) => ({
            type: 'rpa-discover',
            label: candidate.targetName || candidate.externalContentId,
            url: candidate.sourceUrl,
            createdAt: new Date().toISOString(),
          })),
        };
      } catch (error) {
        if (error instanceof ConflictException) {
          throw error;
        }
        await this.appendDriverStep(recordId, owner, {
          stepName: 'discover-account-search',
          status: 'failed',
          reasonCode: 'network_error',
          message: error instanceof Error ? error.message : '两段式发现执行异常',
        });
        await this.finalizeDriverRecord(recordId, owner, {
          status: 'failed',
          reasonCode: 'network_error',
          nextAction: '已回退本地适配器；请检查平台会话后重试',
        });
        return {
          ok: false,
          fallback: {
            attempted: true,
            source: 'legacy-adapter',
            rpaExecutionId: recordId,
            reasonCode: 'network_error',
            fallbackAllowed: true,
            message: `两段式发现执行异常，已回退本地适配器（执行 ${recordId}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
      }
    })();

    let sessionCloseFailed = false;
    const activeSession: RpaSession | null = sessionRef.current;
    if (activeSession) {
      try {
        await driver.closeSession({
          sessionId: activeSession.sessionId,
          platform: config.platform,
          accountId: config.accountId,
          engineSessionKey: `${config.platform}-${config.accountId}`,
          pageAvailable: false,
        });
      } catch (closeErr) {
        sessionCloseFailed = true;
        this.logger.warn(
          `[tryFetchDouyinAccountJourney] 会话关闭失败 platform=${config.platform} account=${config.accountId}：${
            closeErr instanceof Error ? closeErr.message : String(closeErr)
          }`,
        );
        await this.markDriverSessionCloseFailure(
          config,
          recordId,
          closeErr,
          'tryFetchDouyinAccountJourney',
        );
      }
    }
    if (sessionCloseFailed && outcome.ok === true) {
      return {
        ...outcome,
        status: 'partial',
        reasonCode: 'session_close_failed',
        message: `${outcome.message}；浏览器会话关闭失败，需人工核对平台实际结果`,
      };
    }
    return outcome;
  }

  /** B 阶段：openSession 后建初始状态机记录（store 不可用/写失败返回 null，不阻断）。
   *  P1 复核：走 createWithLock 原子锁，与主 RPA 控制器统一锁语义——并发同账号执行时
   *  account_busy 抛 ConflictException，不静默绕过。 */
  private async openDriverExecutionRecord(
    driver: { displayName: string; driverVersion: string },
    config: GrowthAcquisitionConfig,
    sessionId: string,
    runId: string,
  ): Promise<string | null> {
    if (!this.rpaExecutionStore) return null;
    try {
      const record = await this.rpaExecutionStore.createWithLock({
        tenantId: config.tenantId ?? 'legacy-local-desktop',
        userId: config.userId,
        platform: config.platform,
        sessionId,
        accountId: config.accountId || null,
        mode: config.mode,
        steps: [
          {
            stepName: 'open-session',
            status: 'success',
            message: `${driver.displayName} 会话已打开`,
            occurredAt: new Date().toISOString(),
          },
        ],
        status: 'running',
        driverVersion: driver.driverVersion,
        runId,
        userMessage: `${driver.displayName} 统一 RPA 发现开始`,
      });
      return record?.id ?? null;
    } catch (error) {
      // P1 复核：Growth 发现链路与主 RPA 控制器统一原子账号锁语义。
      // account_busy（同账号已有活动执行，并发被事务锁拦截）→ 明确抛出由调用方转 ConflictException，
      // 不能当普通创建失败吞掉（否则并发同账号仍会绕过锁）。
      if (error instanceof Error && error.message === 'account_busy') {
        throw new ConflictException(
          `账号 ${config.accountId} 已有进行中的任务（Growth 发现被事务锁拦截）；请先处理现有任务`,
        );
      }
      this.logger.warn(
        `RPA 状态机记录创建失败（${config.platform}）：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** B 阶段：追加真实执行步骤（记录不存在/store 不可用 → false，不误判成功） */
  private async appendDriverStep(
    recordId: string | null,
    owner: { userId: string; tenantId?: string | null },
    step: RpaExecutionStepInput,
  ): Promise<boolean> {
    if (!recordId || !this.rpaExecutionStore) return false;
    try {
      // P0-1 复核：服务端 driver 执行上下文写入必须 internal=true，
      // 否则成功步骤被门禁降级 running → 终态被强制 reconcile_required（破坏获客闭环）。
      const result = await this.rpaExecutionStore.appendStep(
        recordId,
        owner,
        step,
        {
          internal: true,
        },
      );
      // P1 复核：appendStep 返回 null（记录不存在/租户不匹配）→ 不能误判审计成功
      return result !== null;
    } catch (error) {
      this.logger.error(
        `RPA 状态机步骤追加失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /** B 阶段：finalize 真实状态机记录（记录不存在/store 不可用 → false，不误判成功） */
  private async finalizeDriverRecord(
    recordId: string | null,
    owner: { userId: string; tenantId?: string | null },
    input: RpaExecutionFinalizeInput,
  ): Promise<boolean> {
    if (!recordId || !this.rpaExecutionStore) return false;
    try {
      const result = await this.rpaExecutionStore.finalize(
        recordId,
        owner,
        input,
      );
      // P1 复核：finalize 返回 null（记录不存在/租户不匹配）→ 不能误判审计成功
      return result !== null;
    } catch (error) {
      this.logger.error(
        `RPA 状态机记录收尾失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * P1 复核：会话关闭失败必须改变执行终态 → reconcile_required（不能只记日志）。
   * 会话释放失败意味着「平台侧实际结果无法确认、浏览器可能仍在运行」，
   * 即使业务步骤已报成功也需人工核对。
   * - 有执行记录（发现路径）：transition 到 reconcile_required；
   * - 无执行记录（触达/读评论路径）：落一条独立审计记录（status=reconcile_required），
   *   保证关闭失败可追责、可进对账队列。
   * 本方法自身异常只记 error（finally 内不得覆盖业务异常/返回值）。
   */
  private async markDriverSessionCloseFailure(
    config: GrowthAcquisitionConfig,
    recordId: string | null,
    closeError: unknown,
    context: string,
  ): Promise<boolean> {
    if (!this.rpaExecutionStore) {
      this.logger.error(
        `[${context}] 会话关闭失败且 RPA 执行记录服务不可用，无法落 reconcile_required：platform=${config.platform} account=${config.accountId}：${
          closeError instanceof Error ? closeError.message : String(closeError)
        }`,
      );
      return false;
    }
    const owner = {
      userId: config.userId,
      tenantId: config.tenantId ?? 'legacy-local-desktop',
    };
    const technicalMessage = `浏览器会话释放失败：${
      closeError instanceof Error ? closeError.message : String(closeError)
    }`;
    try {
      if (recordId) {
        await this.rpaExecutionStore.transition(
          recordId,
          owner,
          'reconcile_required',
          {
            reasonCode: 'session_close_failed',
            nextAction:
              '请人工确认浏览器会话是否已退出，并核对平台实际执行结果',
            technicalMessage,
          },
        );
      } else {
        await this.rpaExecutionStore.create({
          tenantId: owner.tenantId,
          userId: owner.userId,
          platform: config.platform,
          accountId: config.accountId,
          mode: 'session-close-audit',
          status: 'reconcile_required',
          reasonCode: 'session_close_failed',
          nextAction: '请人工确认浏览器会话是否已退出，并核对平台实际执行结果',
          userMessage: 'RPA 会话释放失败，需人工核对平台实际结果',
          technicalMessage,
        });
      }
      // P1 复核：标记成功 → 调用方据此同步 run 状态（避免列表「成功」与审计「待核对」不一致）
      return true;
    } catch (error) {
      this.logger.error(
        `[${context}] 会话关闭失败落 reconcile_required 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  /** 获客模式 → RPA 动作映射（仅映射 driver 已支持的动作） */
  private driverActionForMode(
    mode: GrowthAcquisitionMode,
  ):
    | 'discover-keyword'
    | 'discover-account-search'
    | 'discover-account-works'
    | 'read-comments'
    | 'discover-recommended'
    | null {
    if (mode === 'keyword') return 'discover-keyword';
    // 复核#4-5：video-link 是打开视频详情页读评论区（评论者 = 候选），不是关键词搜索
    if (mode === 'video-link') return 'read-comments';
    if (mode === 'search-account') return 'discover-account-search';
    if (mode === 'target-account') return 'discover-account-works';
    // P2 复核：推荐流独立模式（与关键词搜索解耦，对齐 rpa.controller.modeToAction）
    if (mode === 'recommended') return 'discover-recommended';
    return null;
  }

  private async nextGrowthAcquisitionSourceInput(
    config: GrowthAcquisitionConfig,
  ) {
    const sourceInputs = config.sourceInputs.filter(Boolean);
    if (!sourceInputs.length) return config.taskName;
    const store = await this.loadStore();
    const runCount = store.runs.filter(
      (run) => run.configId === config.id,
    ).length;
    return sourceInputs[runCount % sourceInputs.length] || config.taskName;
  }

  private fetchCandidatesWithPlatformAdapter(
    config: GrowthAcquisitionConfig,
  ): AiEmployeeLeadResponse {
    if (config.platform === 'wechat-channel') {
      if (
        config.mode === 'manual-import' ||
        config.mode === 'video-link' ||
        config.mode === 'target-account'
      ) {
        const candidates = config.sourceInputs.map((text, index) => ({
          text,
          index,
          kind: `${config.platform}-${config.mode}`,
          targetName: text.includes('@') ? text.replace('@', '') : undefined,
          sourceUrl: /^https?:\/\//i.test(text) ? text : undefined,
          reason:
            '视频号候选来源由用户提供，后续执行走本机 runtime 互动执行器。',
          score: this.scoreText(`${text} ${config.includeKeywords.join(' ')}`)
            .score,
        }));
        return {
          ok: true,
          status: 'partial',
          message: `已载入 ${candidates.length} 条视频号候选，真实触达由 runtime 执行器处理。`,
          candidates,
          evidence: [],
        };
      }
      throw new BadRequestException(
        '视频号关键词自动采集尚未接入，请先使用视频链接、目标账号或手动导入候选。',
      );
    }
    if (config.platform === 'wechat' || config.platform === 'wecom') {
      if (config.mode === 'manual-import') {
        return {
          ok: true,
          status: 'partial',
          message:
            '已载入微信/企微手动候选，后续跟进需通过线索跟进工作台确认目标会话。',
          candidates: config.sourceInputs.map((text, index) => ({
            text,
            index,
            kind: `${config.platform}-manual-import`,
            targetName: text,
            // P1-12 复核：文本若是 URL 保留为来源证据；否则为 null（人工待补，不冒充来源）
            sourceUrl: /^https?:\/\//i.test(text) ? text : undefined,
            reason: '微信类桌面执行需要明确会话目标，已先沉淀为候选线索。',
            score: this.scoreText(text).score,
          })),
          evidence: [],
        };
      }
      throw new BadRequestException(
        `${this.platformLabel(config.platform)} 自动采集需要明确会话目标，请使用手动导入候选。`,
      );
    }
    throw new BadRequestException(
      `${this.platformLabel(config.platform)} 获客互动执行器尚未接入，已阻止本次执行。`,
    );
  }

  private async executePlatformFollowUp(
    config: GrowthAcquisitionConfig,
    targets: AiEmployeeFollowUpPlan['targets'],
    remaining: number,
  ): Promise<AiEmployeeFollowUpExecution> {
    if (config.platform === 'douyin') {
      return this.aiEmployeeService.executeDouyinFollowUp({
        accountId: config.accountId,
        targets,
        maxTargets: remaining,
        autoSend: true,
        sourceCapability: this.douyinExposureCapability(config.mode),
      });
    }
    if (config.platform === 'wechat-channel') {
      return this.executeWechatChannelFollowUp(config, targets, remaining);
    }
    // C 阶段：非抖音/企微平台查统一 RPA driver 触达能力。
    // reply-comment 只代表工作台逐条人工确认能力；Growth 无人值守触达仍由
    // platformTouchReady 门禁控制，send-direct-message 保持 unsupported。
    const driver = this.rpaDriverRegistry?.get(config.platform);
    if (driver) {
      // 卡点1：触达能力查询也带账号级预检
      const caps = await driver.capabilities({ accountId: config.accountId });
      const touch = caps.actions.find(
        (item) =>
          item.action === 'reply-comment' ||
          item.action === 'send-direct-message',
      );
      if (touch?.supported) {
        return this.executeFollowUpViaDriver(
          driver,
          caps.driverVersion,
          config,
          targets,
          remaining,
        );
      }
    }
    throw new BadRequestException(
      `${this.platformLabel(config.platform)} 自动触达执行器尚未接入（RPA 触达未实现或未授权），请使用人工确认或草稿模式。`,
    );
  }

  /**
   * C 阶段：经统一 RPA driver 执行触达（回复评论/私信）。
   * 逐 target 调 driver.execute，如实组装 AiEmployeeFollowUpExecution 结果。
   * 真实执行依赖 driver 动作落地 + 用户已登录会话（D 阶段验收），
   * 当前不伪装：driver 未声明支持时不会到达本方法（调用方已拦）。
   * P1 复核：会话关闭失败必须降级本次执行结果（status→partial + message 标注），
   * 上层据此创建「待核对/部分完成」run，不能关闭失败仍报成功。
   */
  private async executeFollowUpViaDriver(
    driver: RpaDriver,
    driverVersion: string,
    config: GrowthAcquisitionConfig,
    targets: AiEmployeeFollowUpPlan['targets'],
    remaining: number,
  ): Promise<AiEmployeeFollowUpExecution> {
    const session = await driver.openSession({
      userId: config.userId,
      accountId: config.accountId,
      runId: `growth-followup-${config.id}-${Date.now()}`,
    });
    const startedAt = Date.now();
    const results: AiEmployeeFollowUpExecution['results'] = [];
    // P1 复核：用引用容器携带「是否关闭失败」，finally 在 return 之后执行无法改返回值，
    // 故 IIFE 内标记 closeFailed，IIFE 结束后统一降级返回值（与发现路径语义一致）。
    const stateRef: {
      value: AiEmployeeFollowUpExecution;
      closeFailed: boolean;
    } = { value: results as never, closeFailed: false };
    const execution = await (async () => {
      try {
        const exec = await this.executeFollowUpLoop(
          driver,
          driverVersion,
          config,
          session,
          targets,
          remaining,
          results,
          startedAt,
        );
        stateRef.value = exec;
        return exec;
      } finally {
        // 会话泄漏修复：增长批量触达成功/失败/异常都释放真实浏览器会话
        try {
          await driver.closeSession({
            sessionId: session.sessionId,
            platform: config.platform,
            accountId: config.accountId,
            engineSessionKey: `${config.platform}-${config.accountId}`,
            pageAvailable: false,
          });
        } catch (closeErr) {
          // P1 复核：关闭失败 → 落 reconcile_required 审计记录（触达路径无独立执行记录，
          // 不能只静默——释放失败说明平台侧实际触达结果不可确认，需人工核对）
          stateRef.closeFailed = true;
          this.logger.warn(
            `[executeFollowUpViaDriver] 会话关闭失败 platform=${config.platform} account=${config.accountId}：${
              closeErr instanceof Error ? closeErr.message : String(closeErr)
            }`,
          );
          await this.markDriverSessionCloseFailure(
            config,
            null,
            closeErr,
            'executeFollowUpViaDriver',
          );
        }
      }
    })();
    // P1 复核：关闭失败 → 本次执行结果降级 partial（需人工核对），上层据此创建待核对 run
    if (stateRef.closeFailed && execution.status === 'success') {
      execution.status = 'partial';
      execution.message = `${execution.message}；浏览器会话关闭失败，需人工核对平台实际结果`;
    }
    return execution;
  }

  /** 触达循环主体（便于 try/finally 统一释放会话） */
  private async executeFollowUpLoop(
    driver: RpaDriver,
    driverVersion: string,
    config: GrowthAcquisitionConfig,
    session: RpaSession,
    targets: AiEmployeeFollowUpPlan['targets'],
    remaining: number,
    results: AiEmployeeFollowUpExecution['results'],
    startedAt: number,
  ): Promise<AiEmployeeFollowUpExecution> {
    for (const [index, target] of targets.slice(0, remaining).entries()) {
      const replyText = this.text(
        target.commentReplyText || target.directMessageText,
      );
      if (!replyText) continue;
      const action: 'comment' | 'message' = target.directMessageText
        ? 'message'
        : 'comment';
      const rpaAction = target.directMessageText
        ? 'send-direct-message'
        : 'reply-comment';
      let stepResult: RpaStepResult;
      try {
        stepResult = await driver.execute(session, {
          name: rpaAction,
          action: rpaAction,
          input: {
            targetId: this.text(target.targetName) || undefined,
            sourceUrl: this.text(target.sourceUrl),
            targetText: this.text(target.text || target.sourceText),
            replyText,
            userId: config.userId,
          },
        });
      } catch (error) {
        stepResult = {
          stepName: rpaAction,
          status: 'failed',
          reasonCode: 'network_error',
          attempt: 1,
          durationMs: Date.now() - startedAt,
          driverVersion,
          message: error instanceof Error ? error.message : 'driver 触达异常',
        };
      }
      results.push({
        index,
        action,
        targetName: this.text(target.targetName),
        targetText: this.text(target.text || target.sourceText),
        replyText,
        ok: stepResult.status === 'success',
        status:
          stepResult.status === 'success' ? 'success' : ('failed' as const),
        reasonCode: this.mapRpaReasonCodeToExecutor(stepResult.reasonCode),
        message:
          stepResult.message ||
          `${this.platformLabel(config.platform)} ${rpaAction} ${stepResult.status}`,
        evidence: stepResult.evidenceUrl
          ? [
              {
                type: 'rpa-touch',
                label: rpaAction,
                url: stepResult.evidenceUrl,
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      });
    }
    if (!results.length) {
      throw new BadRequestException('没有可执行的 RPA 评论或私信跟进任务');
    }
    const successCount = results.filter((item) => item.ok).length;
    const failedCount = results.length - successCount;
    return {
      ok: failedCount === 0,
      status:
        failedCount === 0 ? 'success' : successCount > 0 ? 'partial' : 'failed',
      message:
        failedCount === 0
          ? `统一 RPA 已自动执行 ${successCount} 条触达`
          : `统一 RPA 已执行 ${results.length} 条触达，成功 ${successCount} 条，失败 ${failedCount} 条`,
      summary: {
        totalTargets: targets.length,
        attemptedCount: results.length,
        successCount,
        failedCount,
        sendMode: 'auto-send',
        videoCount: 0,
      },
      results,
    };
  }

  /** RPA 原因码 → 执行器原因码（语义对齐，供 AiEmployeeFollowUpExecution.results） */
  private mapRpaReasonCodeToExecutor(code: RpaReasonCode): ExecutorReasonCode {
    switch (code) {
      case 'ok':
      case 'partial':
        return 'success';
      case 'unsupported':
      case 'no_web_search_entry':
        return 'not_integrated';
      case 'no_browser_session':
      case 'not_logged_in':
        return 'account_not_logged_in';
      case 'captcha_required':
        return 'captcha_required';
      case 'risk_control':
      case 'reconcile_required':
        return 'review_required';
      case 'quota_exceeded':
      case 'network_error':
        return 'runtime_unavailable';
      case 'parse_failed':
      case 'page_not_found':
        return 'platform_changed';
      default:
        return 'runtime_unavailable';
    }
  }

  private douyinExposureCapability(mode: GrowthAcquisitionMode) {
    const capabilities = {
      keyword: 'douyin-hot-video-exposure',
      'search-account': 'douyin-search-account-exposure',
      'video-link': 'douyin-link-exposure',
      'target-account': 'douyin-targeted-exposure',
      retention: 'douyin-retention-exposure',
      'manual-import': 'douyin-hot-video-exposure',
      // P2 复核：推荐流独立配额标识（快手推荐流走同一能力名，平台维度区分）
      recommended: 'douyin-recommended-exposure',
    } as const;
    return capabilities[mode];
  }

  /**
   * §10.1 幂等门：查询该 config 最近的成功 run 是否已触达过目标（文本指纹）。
   * 组合键：tenantId + configId + targetExternalId(文本指纹) + actionType。
   * 命中则返回 true（调用方跳过，避免重复评论/私信）。
   */
  private async isGrowthTouchAlreadyCompleted(
    userId: string,
    config: GrowthAcquisitionConfig,
    targetFingerprint: string,
    actionType: string,
  ): Promise<boolean> {
    const fingerprint = this.text(targetFingerprint).trim().slice(0, 120);
    if (!fingerprint) return false;
    try {
      const recentRuns = await this.prisma.growthAcquisitionRun.findMany({
        where: {
          configId: config.id,
          userId,
          status: { in: ['success', 'partial'] },
        },
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: { message: true, evidenceUrls: true },
      });
      if (!recentRuns.length) return false;
      const needle = fingerprint;
      return recentRuns.some((run) => {
        const haystack = [
          run.message ?? '',
          ...(Array.isArray(run.evidenceUrls)
            ? (run.evidenceUrls as unknown[]).map((e) =>
                typeof e === 'string' ? e : JSON.stringify(e),
              )
            : []),
        ].join('\n');
        // 指纹匹配：目标文本出现在历史 run 摘要/证据中，且动作类型一致（由 message 携带）
        return (
          haystack.includes(needle) &&
          (haystack.includes(actionType) ||
            haystack.includes('触达') ||
            haystack.includes('已完成'))
        );
      });
    } catch (error) {
      this.logger.warn(
        `幂等检查失败（放行，避免误阻断）：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async executeWechatChannelFollowUp(
    config: GrowthAcquisitionConfig,
    targets: AiEmployeeFollowUpPlan['targets'],
    remaining: number,
  ): Promise<AiEmployeeFollowUpExecution> {
    const executableTargets = targets
      .filter((target) => this.text(target.text || target.sourceText))
      .filter((target) =>
        this.text(target.commentReplyText || target.directMessageText),
      )
      .slice(0, remaining);
    const results: AiEmployeeFollowUpExecution['results'] = [];
    let billingReservation: AutoAcquisitionBillingRecord | undefined;
    const startedAt = Date.now();
    if (executableTargets.length) {
      billingReservation =
        await this.aiEmployeeService.reserveRuntimeAutomationCredits({
          idempotencyKey: `ai-content:growth-wechat-channel:${config.id}:${Date.now()}`,
          mode: 'growth_wechat_channel_follow_up',
          taskType: 'wechat_channel_follow_up',
          estimatedRuntimeMinutes: 10,
          estimatedActions: executableTargets.length,
          metadata: {
            configId: config.id,
            accountId: config.accountId,
            platform: config.platform,
            taskName: config.taskName,
            totalTargets: targets.length,
            selectedCount: executableTargets.length,
            sendMode: 'auto-send',
          },
        });
    }

    try {
      for (const [index, target] of executableTargets.entries()) {
        const replyText = this.text(
          target.commentReplyText || target.directMessageText,
        );
        // §10.1 幂等键：tenantId+configId+targetExternalId+actionType。
        // 同一 config 对同一目标（文本指纹）已触达成功则跳过，返回 already_completed。
        if (
          await this.isGrowthTouchAlreadyCompleted(
            config.userId,
            config,
            this.text(target.text || target.sourceText),
            target.directMessageText ? 'direct-message' : 'comment-reply',
          )
        ) {
          results.push({
            index: target.index ?? index,
            action: target.directMessageText ? 'message' : 'comment',
            targetName: target.targetName,
            targetText: target.text || target.sourceText,
            replyText,
            ok: true,
            status: 'skipped',
            reasonCode: 'already_completed',
            message: '该目标此前已触达成功，幂等跳过（不重复发送）',
            evidence: [],
          });
          continue;
        }
        const task: ExecutorTask = {
          relatedId: `growth-wechat-channel-${config.id}-${Date.now()}-${index}`,
          relatedType: 'agent-session',
          type: target.directMessageText
            ? 'wechat-channel-direct-message-reply'
            : 'wechat-channel-comment-reply',
          platform: 'wechat-channel',
          accountId: config.accountId,
          payload: {
            targetName: this.text(target.targetName),
            targetText: this.text(target.text || target.sourceText),
            sourceUrl: this.text(target.sourceUrl),
            profileUrl: this.text(target.profileUrl),
            replyText,
          },
        };
        const result: RuntimeExecutionResult = await this.runtime.execute(
          task,
          {
            riskContext: {
              accountName: `${config.platform}:${config.accountId}`,
            },
            sendMode: 'auto-send',
            billing: {
              covered: true,
              scope: 'growth_wechat_channel_follow_up_batch',
            },
          },
        );
        results.push({
          index: target.index ?? index,
          action: target.directMessageText ? 'message' : 'comment',
          targetName: target.targetName,
          targetText: target.text || target.sourceText,
          replyText,
          ok: result.ok,
          status: result.status,
          reasonCode: result.reasonCode,
          message: result.userMessage,
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
        await this.aiEmployeeService
          .releaseRuntimeAutomationCredits(
            billingReservation,
            `视频号跟进执行失败：${error instanceof Error ? error.message : String(error)}`,
          )
          .catch((releaseError) => {
            this.logger.warn(
              `视频号跟进扣费冻结释放失败：${
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
    const execution = {
      ok: failedCount === 0,
      status:
        failedCount === 0 ? 'success' : successCount > 0 ? 'partial' : 'failed',
      message: successCount
        ? `视频号已完成 ${successCount} 条真实触达。`
        : '视频号真实触达未成功，请检查账号登录、页面结构和目标定位。',
      results,
      summary: {
        totalTargets: targets.length,
        attemptedCount: results.length,
        successCount,
        failedCount,
        sendMode: 'auto-send',
        videoCount: new Set(
          results.map((item) => item.targetText).filter(Boolean),
        ).size,
        message: `尝试 ${results.length} 条，成功 ${successCount} 条，失败 ${failedCount} 条。`,
      },
    } as unknown as AiEmployeeFollowUpExecution;
    if (!billingReservation?.reservationId) return execution;

    const evidenceCount = new Set(
      results.flatMap((item) =>
        item.evidence
          .map((evidence) => evidence.url || evidence.path)
          .filter(Boolean),
      ),
    ).size;
    const billing =
      await this.aiEmployeeService.captureRuntimeAutomationCredits(
        billingReservation,
        {
          mode: 'growth_wechat_channel_follow_up',
          taskType: 'wechat_channel_follow_up',
          runtimeMinutes: Math.max(
            1,
            Math.ceil((Date.now() - startedAt) / 60_000),
          ),
          replies: successCount,
          platformActions: results.length,
          leads: 0,
          evidences: evidenceCount,
          metadata: {
            configId: config.id,
            accountId: config.accountId,
            platform: config.platform,
            taskName: config.taskName,
            attemptedCount: results.length,
            successCount,
            failedCount,
            sendMode: 'auto-send',
          },
        },
      );
    return {
      ...execution,
      billing,
    };
  }

  /**
   * P1-11 复核：统一 dedupeKey——对齐 LeadRepository.dedupeKeyOf 规则
   * （`lead:sha256(platform:uid|nick:...)`），保证 bridge/patchUnifiedLead
   * 与 growth 保存层用同一把钥匙，统一 Lead 不再「找不到」。
   */
  private unifiedLeadDedupeKey(lead: GrowthLead): string {
    return LeadRepository.dedupeKeyOf({
      platform: lead.platform,
      externalUserId: lead.externalUserId,
      nickname: lead.nickname,
      sourceText: lead.sourceText,
    });
  }

  private createLeadFromCandidate(
    userId: string,
    config: GrowthAcquisitionConfig,
    candidate: DouyinFollowUpCandidateInput & {
      sourceText?: string;
      commentReplyText?: string;
      directMessageText?: string;
      reason?: string;
      score?: number;
    },
    index: number,
    evidenceUrls: string[],
  ): GrowthLead {
    const now = new Date().toISOString();
    const sourceText =
      candidate.sourceText ||
      candidate.text ||
      `${this.modeLabel(config.mode)}：${config.sourceInputs.join('、') || config.taskName}`;
    const score = this.scoreText(
      `${sourceText} ${config.includeKeywords.join(' ')}`,
    );
    return {
      id: this.id('lead'),
      userId,
      tenantId: config.tenantId,
      platform: config.platform,
      sourceType: 'auto-acquisition',
      // P1-11 复核：账号维度归因（config.accountId → sourceAccountId）
      sourceAccountId: config.accountId,
      sourceTaskId: config.id,
      nickname:
        candidate.targetName ||
        `${this.platformLabel(config.platform)}线索${index + 1}`,
      // P1-4/P0-6 复核：评论用户外部身份必须透传到 Lead（去重/归因/CRM 资格依赖）
      externalUserId: candidate.externalUserId,
      profileUrl: candidate.profileUrl,
      sourceText,
      sourceUrl: candidate.sourceUrl,
      videoTitle: candidate.videoTitle,
      videoUrl: candidate.videoUrl,
      commentTime: candidate.commentTime,
      // 4.3：身份置信度分级（有稳定外部 ID 高置信；仅昵称+文本低置信待人工）
      identityConfidence: candidate.externalUserId
        ? 90
        : candidate.profileUrl
          ? 60
          : 30,
      missingFields: [
        // P1-12 复核：无来源内容证据（URL）必须显式标注——视频号/微信/企微
        // 手动候选可只有文本或账号名，缺 sourceUrl 不得进入可归因 Lead/CRM，
        // 只能留人工池待补录。
        ...(!candidate.sourceUrl ? ['sourceUrl'] : []),
        ...(!candidate.externalUserId ? ['externalUserId'] : []),
        ...(!candidate.profileUrl ? ['profileUrl'] : []),
        ...(!candidate.externalEventId ? ['externalEventId'] : []),
        ...(!candidate.commentTime ? ['commentTime'] : []),
      ],
      matchedKeywords: config.includeKeywords.slice(0, 5),
      score: Math.max(candidate.score || 0, score.score),
      scoreReasons: [candidate.reason, ...score.reasons].filter(
        (item): item is string => Boolean(item),
      ),
      status: 'new',
      evidenceUrls,
      latestReply: candidate.commentReplyText || candidate.directMessageText,
      createdAt: now,
      updatedAt: now,
      // P1-9/P1-10 复核：来源内容/事件指纹透传到 Lead 归因链（内容 → 发布 → 互动 → 线索）
      sourceArticleId: candidate.externalContentId || null,
      contentId: candidate.externalContentId || null,
    };
  }

  /**
   * P1-17 复核：跟进结果匹配升级——优先按执行目标 index 精确对应（leads 数组下标 =
   * plan targets 下标，一一对应不串线），兜底用 sourceUrl+昵称+文本复合键；
   * 不再仅按昵称/文本模糊匹配（相同昵称/同文评论会把结果写到错误线索）。
   */
  private applyExecutionToLeads(
    leads: GrowthLead[],
    execution: AiEmployeeFollowUpExecution,
  ) {
    const results = execution.results || [];
    leads.forEach((lead, leadIndex) => {
      // 1) 精确匹配：results 中 index 与 lead 创建下标一致（最可靠）
      let matches = results.filter((item) => item.index === leadIndex);
      // 2) 兜底复合键：sourceUrl 一致 + 昵称/文本一致（兼容无 index 的旧执行记录）
      if (!matches.length) {
        matches = results.filter(
          (item) =>
            (lead.sourceUrl &&
              item.targetName &&
              item.targetName === lead.nickname) ||
            (item.targetName === lead.nickname &&
              item.targetText === lead.sourceText) ||
            (item.targetName === lead.nickname &&
              lead.sourceText.includes(item.targetText || '')),
        );
      }
      if (!matches.length) return;
      // P0-6 复核：跟进成功但线索低质量/桥接失败/被抑制 → 不得标 contacted 自动进 CRM，
      // 强制留人工池（blocked 语义 = 需人工核对，不触发自动转 CRM）。
      const crmEligible = this.isCrmCaptureEligibleLead({
        ...lead,
        status: 'contacted',
      });
      lead.status = matches.some((item) => item.ok)
        ? crmEligible
          ? 'contacted'
          : 'blocked'
        : 'blocked';
      if (lead.status === 'blocked' && matches.some((item) => item.ok)) {
        lead.notes = [
          ...(lead.notes ?? []),
          {
            id: this.id('note'),
            text: '触达成功但线索缺少可归因身份/桥接未闭环，已留人工池待补录',
            type: 'status-change',
            createdAt: new Date().toISOString(),
            createdBy: 'system',
          },
        ];
      }
      lead.evidenceUrls = Array.from(
        new Set([
          ...lead.evidenceUrls,
          ...matches.flatMap((item) => this.evidenceUrls(item.evidence)),
        ]),
      );
      const successfulReply = matches.find((item) => item.ok)?.replyText;
      if (successfulReply) lead.latestReply = successfulReply;
      lead.updatedAt = new Date().toISOString();
    });
  }

  private followUpStatusToRunStatus(
    status?: string,
  ): GrowthAcquisitionRun['status'] {
    if (status === 'success') return 'success';
    if (status === 'partial') return 'partial';
    if (status === 'skipped') return 'skipped';
    return 'failed';
  }

  private evidenceUrls(evidence: unknown): string[] {
    if (!Array.isArray(evidence)) return [];
    return evidence
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const record = item as { url?: string; path?: string; value?: string };
        return [record.url, record.value, record.path].filter(
          Boolean,
        ) as string[];
      })
      .filter(Boolean);
  }

  private mapReasonCode(reasonCode?: string): GrowthExecutionFailureReason {
    if (!reasonCode) return 'unknown';
    if (/login|account_not_logged_in/.test(reasonCode))
      return 'account_not_logged_in';
    if (/captcha|verification/.test(reasonCode)) return 'captcha_required';
    if (/target|not_found|missing/.test(reasonCode)) return 'target_not_found';
    if (/editor/.test(reasonCode)) return 'editor_missing';
    if (/send/.test(reasonCode)) return 'send_failed';
    if (/readback/.test(reasonCode)) return 'readback_failed';
    if (/risk|blocked/.test(reasonCode)) return 'account_risk_control';
    if (/not_integrated|engine|runtime/.test(reasonCode))
      return 'engine_unavailable';
    return 'unknown';
  }

  private async ensureAccountHealth(
    userId: string,
    store: GrowthStore,
    scopeInput?: GrowthScope,
  ) {
    const scope = scopeInput || (await this.growthScope(userId));
    const existing = store.accountHealth.filter((item) =>
      this.inGrowthScope(item, scope),
    );
    if (existing.length) return existing;
    const defaults: GrowthAccountHealth[] = [
      this.buildAccountHealth(
        userId,
        'douyin',
        'default-douyin',
        '抖音账号等待真实检测。',
        scope.tenantId,
      ),
      this.buildAccountHealth(
        userId,
        'wechat-channel',
        'default-channel',
        '视频号账号等待真实检测。',
        scope.tenantId,
      ),
    ];
    await this.saveStore(
      {
        ...store,
        accountHealth: [...defaults, ...store.accountHealth],
      },
      { scope, collections: ['accountHealth'] },
    );
    return defaults;
  }

  private accountFailureRate(
    runs: GrowthAcquisitionRun[],
    configs: GrowthAcquisitionConfig[],
    scope: GrowthScope,
    platform: GrowthPlatform,
    accountId: string,
    fallback = 0,
  ) {
    const configIds = new Set(
      configs
        .filter(
          (config) =>
            this.inGrowthScope(config, scope) &&
            config.platform === platform &&
            config.accountId === accountId,
        )
        .map((config) => config.id),
    );
    const history = runs
      .filter(
        (run) => this.inGrowthScope(run, scope) && configIds.has(run.configId),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, 20);
    if (!history.length) return Math.max(0, Math.min(1, fallback));
    const failed = history.filter(
      (run) => run.status === 'failed' || Boolean(run.failureReason),
    ).length;
    return Number((failed / history.length).toFixed(4));
  }

  private missingTaskAccountHealthRows(
    userId: string,
    tenantId: string | undefined,
    configs: GrowthAcquisitionConfig[],
    liveKeys: Set<string>,
    persisted: GrowthAccountHealth[],
  ): GrowthAccountHealth[] {
    const scope: GrowthScope = { userId, tenantId };
    const now = new Date().toISOString();
    const rows = new Map<string, GrowthAccountHealth>();
    for (const config of configs) {
      if (!this.inGrowthScope(config, scope)) continue;
      if (config.status !== 'enabled') continue;
      const accountId = this.text(config.accountId);
      if (!accountId || accountId === 'default') continue;
      const platform = this.platform(config.platform);
      const key = `${platform}:${accountId}`;
      if (liveKeys.has(key) || rows.has(key)) continue;
      const previous = persisted.find(
        (item) => item.platform === platform && item.accountId === accountId,
      );
      rows.set(key, {
        ...this.buildAccountHealth(
          userId,
          platform,
          accountId,
          `任务「${config.taskName}」绑定的账号未在平台账号列表中找到。请到发布中心-平台账号完成登录或重新授权，账号恢复在线后才能真实执行。`,
          config.tenantId || tenantId,
          config.accountName || this.platformLabel(platform),
        ),
        todayActionCount: previous?.todayActionCount || 0,
        cooldownUntil: previous?.cooldownUntil,
        loginStatus:
          previous?.loginStatus === 'online'
            ? 'expired'
            : previous?.loginStatus || 'expired',
        failureRate: previous?.failureRate ?? 1,
        riskStatus:
          previous?.riskStatus === 'cooldown' ? 'cooldown' : 'needs-human',
        lastCheckedAt: now,
      });
    }
    return Array.from(rows.values());
  }

  private buildAccountHealth(
    userId: string,
    platform: GrowthPlatform,
    accountId: string,
    recommendation: string,
    tenantId?: string,
    accountName?: string,
  ): GrowthAccountHealth {
    return {
      id: `${platform}:${accountId}`,
      userId,
      tenantId,
      platform,
      accountId,
      accountName: accountName || this.platformLabel(platform),
      loginStatus: 'unknown',
      todayActionCount: 0,
      failureRate: 0,
      riskStatus: 'normal',
      recommendation,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  private buildCommercialReadinessSnapshot(
    runtime: GrowthRuntimeStatus,
    accounts: GrowthAccountHealth[],
    plan: GrowthSchedulePlan,
  ): GrowthCommercialReadiness {
    const onlineNormalAccounts = accounts.filter(
      (account) =>
        account.loginStatus === 'online' && account.riskStatus === 'normal',
    );
    const blockedAccounts = accounts.filter(
      (account) =>
        account.loginStatus !== 'online' || account.riskStatus !== 'normal',
    );
    const blockers: GrowthCommercialReadiness['blockers'] = [];
    const warnings: GrowthCommercialReadiness['warnings'] = [];

    if (!runtime.executionEnabled) {
      blockers.push({
        code: 'growth-execution-disabled',
        title: '真实执行开关未开启',
        detail: '当前后端处于安全审阅模式，不会执行评论、私信或后台计划任务。',
        action:
          '商用部署时显式设置 GROWTH_EXECUTION_ENABLED=true，并重新跑 live gate。',
      });
    }

    if (!runtime.schedulerDaemonArmed) {
      blockers.push({
        code: 'scheduler-daemon-not-armed',
        title: '后台定时未武装',
        detail: runtime.schedulerDaemonEnabled
          ? '调度 daemon 已配置，但缺少真实无人值守许可，不能算商用后台闭环。'
          : '调度 daemon 未开启，任务只能由页面或接口手动触发。',
        action:
          '商用部署时同时设置 GROWTH_SCHEDULER_DAEMON=true 和 GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED=true。',
      });
    }

    if (onlineNormalAccounts.length === 0) {
      const accountDetail = blockedAccounts[0]
        ? `${blockedAccounts[0].accountName}: login=${blockedAccounts[0].loginStatus}, risk=${blockedAccounts[0].riskStatus}`
        : '当前用户没有可验证的平台账号。';
      blockers.push({
        code: 'no-online-normal-account',
        title: '没有可自动执行的在线账号',
        detail: accountDetail,
        action: '先在本机浏览器/平台后台完成账号登录或验证，再刷新账号健康。',
      });
    }

    if (plan.readyCount === 0) {
      const firstItem = plan.items[0];
      blockers.push({
        code: 'no-ready-auto-task',
        title: '没有 ready 自动任务',
        detail: firstItem
          ? `${firstItem.taskName}: ${firstItem.reason}`
          : '当前没有加入后台计划的获客任务。',
        action:
          '启用真实账号任务、确认风险模式为自动、检查每日额度和启动时间。',
      });
    }

    if (runtime.running) {
      warnings.push({
        code: 'scheduler-currently-running',
        title: '后台任务正在运行',
        detail:
          '当前已有一轮增长调度在执行，新的商用验收应等待本轮结束后再开始。',
        action: '等待运行态变为空闲，再重新执行 gate。',
      });
    }

    const nextActions = blockers.map((item) => item.action);
    return {
      generatedAt: new Date().toISOString(),
      status: blockers.length ? 'blocked' : 'ready',
      summary: blockers.length
        ? `商用闭环未就绪：${blockers.length} 个阻断项需要处理。`
        : '商用闭环就绪：真实执行、后台调度、账号和 ready 任务均通过预检。',
      runtime: {
        executionEnabled: runtime.executionEnabled,
        schedulerDaemonEnabled: runtime.schedulerDaemonEnabled,
        schedulerDaemonArmed: runtime.schedulerDaemonArmed,
        mode: runtime.mode,
        running: runtime.running,
      },
      accounts: {
        total: accounts.length,
        onlineNormal: onlineNormalAccounts.length,
        blocked: blockedAccounts.length,
      },
      plan: {
        readyCount: plan.readyCount,
        blockedCount: plan.blockedCount,
        waitingCount: plan.waitingCount,
        itemCount: plan.items.length,
      },
      blockers,
      warnings,
      nextActions,
    };
  }

  private async recordCommercialAudit(
    userId: string,
    action: GrowthCommercialAuditAction,
    readiness: GrowthCommercialReadiness,
    input: {
      status: GrowthCommercialAuditRecord['status'];
      result: GrowthCommercialAuditRecord['result'];
    },
  ): Promise<GrowthCommercialAuditRecord> {
    const scope = await this.growthScope(userId);
    const now = new Date().toISOString();
    const record: GrowthCommercialAuditRecord = {
      id: this.id('commercial-audit'),
      userId,
      tenantId: scope.tenantId,
      action,
      status: input.status,
      createdAt: now,
      runtime: readiness.runtime,
      accounts: readiness.accounts,
      plan: readiness.plan,
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      result: input.result,
    };
    const store = await this.loadStore();
    await this.saveStore(
      {
        ...store,
        commercialAudits: [record, ...store.commercialAudits].slice(0, 200),
      },
      { scope, collections: ['commercialAudits'] },
    );
    return record;
  }

  private copywritingReport(leads: GrowthLead[]) {
    const map = new Map<
      string,
      {
        text: string;
        usageCount: number;
        leadScoreTotal: number;
        contactedCount: number;
      }
    >();
    for (const lead of leads) {
      // T2-2 修复：无话术内容的线索不参与聚合，禁止生成"未记录话术"占位行上 TOP
      const text = (lead.latestReply || '').trim();
      if (!text) continue;
      const row = map.get(text) || {
        text,
        usageCount: 0,
        leadScoreTotal: 0,
        contactedCount: 0,
      };
      row.usageCount += 1;
      row.leadScoreTotal += lead.score;
      if (
        lead.status === 'contacted' ||
        lead.status === 'replied' ||
        lead.status === 'qualified'
      )
        row.contactedCount += 1;
      map.set(text, row);
    }
    // 按使用量降序；样本 <30 标注 lowConfidence（前端显示"样本不足"），避免小样本得出 100% 触达率的假结论
    const MIN_RELIABLE_SAMPLE = 30;
    return Array.from(map.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .map((item) => ({
        ...item,
        averageLeadScore: item.usageCount
          ? Math.round(item.leadScoreTotal / item.usageCount)
          : 0,
        contactRate: item.usageCount
          ? Number((item.contactedCount / item.usageCount).toFixed(2))
          : 0,
        lowConfidence: item.usageCount < MIN_RELIABLE_SAMPLE,
      }));
  }

  private buildSchedulePlan(
    configs: GrowthAcquisitionConfig[],
    accounts: GrowthAccountHealth[],
  ): GrowthSchedulePlan {
    const now = new Date();
    const today = this.dateKey(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const accountByKey = new Map(
      accounts.map((account) => [
        `${account.platform}:${account.accountId}`,
        account,
      ]),
    );
    const items: GrowthSchedulePlan['items'] = configs
      .map((config) => {
        const exposureCount =
          config.exposureDate === today ? config.exposureCount : 0;
        const remainingToday = Math.max(0, config.dailyLimit - exposureCount);
        const beginMinutes = this.timeToMinutes(config.beginTime);
        const account = accountByKey.get(
          `${config.platform}:${config.accountId}`,
        );
        const nextRunAt = this.nextRunAt(
          today,
          config.beginTime,
          currentMinutes <= beginMinutes,
        );
        let status: GrowthSchedulePlan['items'][number]['status'] = 'ready';
        let reason =
          process.env.GROWTH_EXECUTION_ENABLED === 'true'
            ? '已到计划时间，账号和每日上限通过预检；可进入真实执行队列。'
            : '已到计划时间，账号和每日上限通过预检；当前为演练模式，仅允许人工安全确认。';

        if (!config.scheduleEnabled) {
          status = 'disabled';
          reason = '任务未加入执行计划，仅允许手动执行。';
        } else if (config.status === 'disabled') {
          status = 'disabled';
          reason = '任务已停用。';
        } else if (remainingToday <= 0) {
          status = 'exhausted';
          reason = '今日执行量已达到任务上限。';
        } else if (currentMinutes < beginMinutes) {
          status = 'waiting-time';
          reason = `等待 ${config.beginTime} 后进入执行队列。`;
        } else if (account && account.loginStatus !== 'online') {
          status = 'blocked';
          reason =
            account.loginStatus === 'verification-required'
              ? '账号需要人工验证，调度已阻断。'
              : '账号未登录或已过期，调度已阻断。';
        } else if (account && account.riskStatus !== 'normal') {
          status = 'blocked';
          reason =
            account.riskStatus === 'cooldown'
              ? `账号冷却中，${this.cooldownRemainingLabel(account.cooldownUntil)} 后可重新预检。`
              : `账号当前为 ${account.riskStatus} 状态，调度已阻断。`;
        } else if (!account) {
          status = 'blocked';
          reason = '未找到可验证的执行账号，调度已阻断。';
        } else {
          const executionCapability =
            this.growthAutoExecutionCapability(config);
          if (!executionCapability.ready) {
            status = 'blocked';
            reason = executionCapability.reason;
          }
        }

        if (
          status === 'ready' &&
          config.riskMode === 'auto' &&
          process.env.GROWTH_EXECUTION_ENABLED !== 'true'
        ) {
          status = 'waiting-confirmation';
          reason = '真实执行开关未开启，当前只能进入安全预检确认单。';
        }

        return {
          configId: config.id,
          taskName: config.taskName,
          platform: config.platform,
          accountId: config.accountId,
          accountName: config.accountName || account?.accountName,
          mode: config.mode,
          scheduleEnabled: config.scheduleEnabled,
          beginTime: config.beginTime,
          dailyLimit: config.dailyLimit,
          exposureCount,
          remainingToday,
          status,
          reason,
          nextRunAt: status === 'waiting-time' ? nextRunAt : undefined,
          lastRunAt: config.lastRunAt,
        };
      })
      .sort((left, right) => {
        const rank = {
          ready: 0,
          'waiting-confirmation': 1,
          'waiting-time': 2,
          blocked: 3,
          exhausted: 4,
          disabled: 5,
        };
        return (
          rank[left.status] - rank[right.status] ||
          left.beginTime.localeCompare(right.beginTime)
        );
      });
    return {
      generatedAt: now.toISOString(),
      readyCount: items.filter((item) => item.status === 'ready').length,
      blockedCount: items.filter((item) => item.status === 'blocked').length,
      waitingCount: items.filter((item) => item.status === 'waiting-time')
        .length,
      items,
    };
  }

  private timeToMinutes(value: string) {
    const [hour = '0', minute = '0'] = value.split(':');
    const total = Number(hour) * 60 + Number(minute);
    return Number.isFinite(total) ? total : 0;
  }

  private nextRunAt(
    today: string,
    beginTime: string,
    todayStillAvailable: boolean,
  ) {
    const date = new Date(`${today}T${beginTime || '00:00'}:00.000Z`);
    if (!todayStillAvailable) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }

  private isCooldownActive(account?: GrowthAccountHealth) {
    if (!account || account.riskStatus !== 'cooldown') return false;
    if (!account.cooldownUntil) return true;
    return new Date(account.cooldownUntil).getTime() > Date.now();
  }

  private normalizeCooldownMinutes(value: unknown) {
    const minutes = this.number(value, 60);
    return Math.max(15, Math.min(24 * 60, Math.round(minutes)));
  }

  private cooldownRecommendation(cooldownUntil?: string) {
    return `账号已进入冷却，预计 ${this.cooldownRemainingLabel(cooldownUntil)} 后再进入增长任务预检。`;
  }

  private cooldownRemainingLabel(cooldownUntil?: string) {
    if (!cooldownUntil) return '人工解除';
    const remaining = Math.max(
      0,
      new Date(cooldownUntil).getTime() - Date.now(),
    );
    const minutes = Math.ceil(remaining / 60_000);
    if (minutes <= 0) return '现在';
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }

  private reportSince(range: string) {
    const now = new Date();
    const days =
      range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 0;
    if (!days) return undefined;
    const since = new Date(now);
    if (range === 'today') {
      since.setHours(0, 0, 0, 0);
    } else {
      since.setDate(now.getDate() - days + 1);
      since.setHours(0, 0, 0, 0);
    }
    return since.toISOString();
  }

  private platformCapabilityLabel(
    platform: GrowthPlatform,
    mode: GrowthAcquisitionMode,
  ) {
    if (platform === 'douyin') return '抖音线索采集与触达预检';
    if (platform === 'wechat-channel') {
      return mode === 'keyword'
        ? '视频号需使用链接、目标账号或手动候选'
        : '视频号候选导入与互动预检';
    }
    if (platform === 'wechat' || platform === 'wecom')
      return '微信类账号需先沉淀手动候选和会话目标';
    return `${this.platformLabel(platform)} 暂仅支持账号状态纳管`;
  }

  private growthAutoExecutionCapability(config: GrowthAcquisitionConfig): {
    ready: boolean;
    reason: string;
  } {
    if (config.platform === 'douyin') {
      return {
        ready: true,
        reason: '抖音短视频评论获客已接入采集、筛选、触达和证据回读。',
      };
    }

    if (config.platform === 'wechat-channel') {
      if (
        config.mode === 'manual-import' ||
        config.mode === 'video-link' ||
        config.mode === 'target-account'
      ) {
        return {
          ready: true,
          reason:
            '视频号候选导入、链接和目标账号模式已接入互动执行器与结果留存。',
        };
      }
      return {
        ready: false,
        reason:
          '视频号关键词自动采集尚未接入，不能加入后台自动执行；请改用视频链接、目标账号或手动导入候选。',
      };
    }

    if (config.platform === 'wechat' || config.platform === 'wecom') {
      return {
        ready: false,
        reason: `${this.platformLabel(config.platform)}需要明确会话目标，当前不能由增长后台自动采集和触达；请在客户互动页完成候选确认后执行。`,
      };
    }

    // T2-4b（2026-08-19 激进放行）：快手 RPA driver 已具备 reply-comment 真实执行
    // （runner.replyComment 已实现：定位评论→填话术→发送，支持 dryRun），
    // 放行 keyword/target-account/search-account 自动触达；私信（send-direct-message）
    // 保持 unsupported（风控）。小红书评论反爬限制多，维持手动确认制。
    if (config.platform === 'kuaishou') {
      if (
        config.mode === 'manual-import' ||
        config.mode === 'keyword' ||
        config.mode === 'video-link' ||
        config.mode === 'target-account' ||
        config.mode === 'search-account'
      ) {
        return {
          ready: true,
          reason:
            '快手浏览器获客已接入采集、评论回复触达与证据回读（私信未开放）。',
        };
      }
      return {
        ready: false,
        reason: `快手模式 ${config.mode} 暂不支持自动采集。`,
      };
    }
    if (config.platform === 'xiaohongshu') {
      if (
        config.mode === 'manual-import' ||
        config.mode === 'keyword' ||
        config.mode === 'video-link' ||
        config.mode === 'target-account' ||
        config.mode === 'search-account'
      ) {
        return {
          ready: false,
          reason: `${this.platformLabel(config.platform)}自动触达执行器未接入（评论反爬限制），不能无人值守自动获客；可手动确认执行（候选将沉淀为线索待人工跟进）。`,
        };
      }
      return {
        ready: false,
        reason: `${this.platformLabel(config.platform)}模式 ${config.mode} 暂不支持自动采集。`,
      };
    }

    return {
      ready: false,
      reason: `${this.platformLabel(config.platform)}当前仅支持账号纳管和发布前检查，增长自动触达执行器未接入；不能加入后台自动获客执行。`,
    };
  }

  /** D 阶段 → T2-4b：平台是否已接入自动触达。
   * 抖音（专用执行器）与快手（RPA reply-comment 已实现）为 ready；
   * 小红书评论反爬限制多 → 候选沉淀待人工；微信系走会话目标。 */
  private platformTouchReady(platform: string): boolean {
    if (platform === 'douyin' || platform === 'wechat-channel') return true;
    if (platform === 'kuaishou') return true;
    return false;
  }

  /**
   * D 阶段修正（大王纠错）：读内容评论区，把「评论用户」映射为获客候选（对齐抖音）。
   * 候选 = 评论者昵称 + 评论文本 + 来源内容 URL；评论不可达/无评论 → 返回空（调用方如实失败，不把内容当客户）。
   * P1 复核：会话关闭失败通过 closeState out 引用回传（lead 数组本身无状态字段），
   * 调用方据此把本次 run 标注为「需人工核对」，不把关闭失败静默吞掉。
   */
  private async fetchCommentUsersAsLeads(
    config: GrowthAcquisitionConfig,
    contentCandidates: DouyinFollowUpCandidateInput[],
    remaining: number,
    closeState?: { failed: boolean },
  ): Promise<GrowthLead[]> {
    if (!this.rpaDriverRegistry) return [];
    const driver = this.rpaDriverRegistry.get(config.platform);
    if (!driver) return [];
    // 卡点1：评论读取也走账号级预检
    const caps = await driver.capabilities({ accountId: config.accountId });
    const cap = caps.actions.find((item) => item.action === 'read-comments');
    if (!cap?.supported || !caps.runtimeReady) return [];
    const leads: GrowthLead[] = [];
    let session: RpaSession | null = null;
    try {
      session = await driver.openSession({
        userId: config.userId,
        accountId: config.accountId,
        runId: `growth-comments-${config.id}-${Date.now()}`,
      });
      const seen = new Set<string>();
      const commentUsers: DouyinFollowUpCandidateInput[] = [];
      // D 阶段实测：小红书连续打开多个详情页会触发反爬（详情 404/评论区空）。
      // 只读前 2 条内容 + 每条间隔，拿够剩余额度即停——少而稳，不伪装。
      for (const content of contentCandidates.slice(0, 2)) {
        const url = this.text(content.sourceUrl);
        if (!url) continue;
        const result = await driver.execute(session, {
          name: 'read-comments',
          action: 'read-comments',
          input: {
            contentUrl: url,
            // 小红书详情页需从搜索页真实点击进入，用任务关键词作搜索入口
            keyword:
              this.text(config.sourceInputs[0]) ||
              this.text(config.taskName) ||
              undefined,
            limit: 20,
            userId: config.userId,
          },
        });
        // 间隔 2s：避免连续请求触发平台反爬
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (result.status !== 'success' || !result.items?.length) {
          this.logger.warn(
            `[fetchCommentUsersAsLeads] ${config.platform} 读评论失败 url=${url} status=${result.status} reason=${result.reasonCode} msg=${result.message ?? ''}`,
          );
          continue;
        }
        this.logger.log(
          `[fetchCommentUsersAsLeads] ${config.platform} 读评论成功 url=${url} items=${result.items?.length ?? 0}`,
        );
        for (const item of result.items) {
          const rawNickname = this.text(item.authorName);
          // 对齐抖音逻辑：评论者是作者/商家/客服，不作为客户线索（去"作者"标签后缀）
          const nickname = rawNickname.replace(/作者$/, '').trim();
          const commentText = this.text(item.text);
          // P1-10 复核：去重键升级——昵称+文本+来源内容 URL+外部用户 ID 复合键，
          // 避免「同一用户在不同内容上发相同评论」被误合并、或不同内容同文被合并。
          const externalUserId = this.text(item.externalUserId) || '';
          const dedupe = `${url}:${externalUserId}:${nickname}:${commentText}`;
          if (!nickname || !commentText || seen.has(dedupe)) continue;
          if (/作者|商家|客服|官方/.test(nickname)) continue;
          seen.add(dedupe);
          commentUsers.push({
            text: commentText,
            sourceUrl: url,
            targetName: nickname,
            kind: `${config.platform}-comment-user`,
            index: commentUsers.length,
            reason: `评论区用户：${nickname}`,
            score: this.scoreText(commentText).score,
            // P1-4：评论用户身份/事件字段贯穿（有则带，无则留空由人工补录）
            externalUserId: this.text(item.externalUserId) || undefined,
            profileUrl: this.text(item.profileUrl) || undefined,
            commentTime: this.text(item.occurredAt) || undefined,
            externalEventId: this.text(item.externalEventId) || undefined,
            // P1-9/P1-10：来源内容/事件指纹透传（去重与 CRM 归因依赖）
            externalContentId: this.text(item.externalContentId) || undefined,
            rawHash: this.text(item.rawHash) || undefined,
          });
        }
        if (commentUsers.length >= remaining) break;
      }
      for (const [index, candidate] of commentUsers
        .slice(0, remaining)
        .entries()) {
        leads.push(
          this.createLeadFromCandidate(
            config.userId,
            config,
            candidate,
            index,
            // P1-10 复核：评论获客线索带来源内容证据（createLeadFromCandidate 此前传 [] 丢证据）
            candidate.sourceUrl ? [candidate.sourceUrl] : [],
          ),
        );
      }
    } catch {
      // 读评论异常返回已收集的（可能为空 → 调用方如实失败）
    } finally {
      // P0 复核：读评论路径统一 finally 关闭会话（防浏览器残留/账号锁不释放）
      // P1 复核：关闭失败 → 落 reconcile_required 审计记录（读评论路径无独立执行记录）
      if (session) {
        try {
          await driver.closeSession({
            sessionId: session.sessionId,
            platform: config.platform,
            accountId: config.accountId,
            engineSessionKey: `${config.platform}-${config.accountId}`,
            pageAvailable: false,
          });
        } catch (closeErr) {
          this.logger.warn(
            `[fetchCommentUsersAsLeads] 会话关闭失败 platform=${config.platform} account=${config.accountId}：${
              closeErr instanceof Error ? closeErr.message : String(closeErr)
            }`,
          );
          // P1 复核：关闭失败回传调用方（上层 run 标注需人工核对，不静默）
          if (closeState) closeState.failed = true;
          await this.markDriverSessionCloseFailure(
            config,
            null,
            closeErr,
            'fetchCommentUsersAsLeads',
          );
        }
      }
    }
    return leads;
  }

  private withStrategyDiagnostics(
    strategy: GrowthStrategyTemplate,
  ): GrowthStrategyTemplate {
    return {
      ...strategy,
      diagnostics: this.strategyDiagnostics(strategy),
    };
  }

  private strategyDiagnostics(
    strategy: GrowthStrategyTemplate,
  ): GrowthStrategyDiagnostics {
    const issues: string[] = [];
    const suggestions: string[] = [];
    const strengths: string[] = [];
    let score = 30;

    const sourceCount = strategy.sourceKeywords.length;
    const demandCount = strategy.demandKeywords.length;
    const excludeCount = strategy.excludeKeywords.length;
    const commentCount = strategy.commentTemplates.length;
    const messageCount = strategy.privateMessageTemplates.length;
    const scoringCount = strategy.scoringRules.length;

    if (sourceCount >= 4) {
      score += 16;
      strengths.push('来源词覆盖足够，可拆成多任务测试。');
    } else {
      issues.push('来源词偏少。');
      suggestions.push('补充 4 个以上细分来源词，例如场景词、痛点词、竞品词。');
    }
    if (demandCount >= 4) {
      score += 16;
      strengths.push('意向词能帮助筛出明确需求。');
    } else {
      issues.push('意向词不足。');
      suggestions.push('补充价格、时间、地点、求推荐、联系方式等高意向词。');
    }
    if (excludeCount >= 3) {
      score += 12;
      strengths.push('有排除词，能减少同行和低质流量。');
    } else {
      issues.push('排除词不足。');
      suggestions.push('加入招聘、教程、招商、官方、同行等排除词。');
    }
    if (commentCount >= 3) {
      score += 14;
      strengths.push('评论话术有基础轮换空间。');
    } else {
      issues.push('评论话术池太薄。');
      suggestions.push('至少准备 3 条不同角度评论话术，避免重复触发风控。');
    }
    if (messageCount >= 1) {
      score += 8;
      strengths.push('私信承接话术已准备。');
    } else {
      issues.push('缺少私信承接话术。');
      suggestions.push('补 1-2 条低压、解释型私信承接话术。');
    }
    if (scoringCount >= 2) {
      score += 8;
      strengths.push('评分规则能支撑线索优先级。');
    } else {
      suggestions.push(
        '增加需求明确、价格敏感、近期行动、留资倾向等评分规则。',
      );
    }
    if (strategy.defaultDailyLimit > 50) {
      score -= 12;
      issues.push('默认每日上限偏高。');
      suggestions.push('冷启动建议控制在 20-50，再按账号健康逐步放量。');
    }
    if (strategy.defaultRiskMode === 'auto') {
      score -= 8;
      issues.push('默认自动触达风险较高。');
      suggestions.push('商用冷启动建议先用人工确认后触达。');
    }

    score = Math.max(0, Math.min(100, score));
    const level =
      score >= 86
        ? 'excellent'
        : score >= 70
          ? 'healthy'
          : score >= 50
            ? 'needs-work'
            : 'risky';
    const recommendedModes: GrowthAcquisitionMode[] = ['keyword'];
    if (sourceCount >= 3) recommendedModes.push('target-account');
    if (
      strategy.scenario.includes('视频') ||
      strategy.sourceKeywords.some((item) => /http|视频|作品/.test(item))
    ) {
      recommendedModes.push('video-link');
    }
    // P2 复核：推荐流模式纳入诊断推荐——当来源词不足、泛发现价值更高时，
    // 推荐 recommended（快手等支持推荐流入口的平台，无需关键词即可发现公开内容互动）。
    if (sourceCount < 3) {
      recommendedModes.push('recommended');
      suggestions.push(
        '来源词偏少时可用「推荐流发现」泛采公开内容互动，再配合需求词筛选。',
      );
    }
    return {
      score,
      level,
      strengths: strengths.slice(0, 4),
      issues: issues.slice(0, 4),
      suggestions: suggestions.slice(0, 5),
      recommendedModes: Array.from(new Set(recommendedModes)),
    };
  }

  private transitionWorkflow(
    workflow: GrowthWorkflow,
    action: GrowthWorkflowAction,
    input: QueryInput,
  ): GrowthWorkflow {
    const now = new Date().toISOString();
    const stepId = this.text(input.stepId);
    const outputSummary = this.text(input.outputSummary);
    const steps = workflow.steps.map((step) => ({ ...step }));
    const runningIndex = steps.findIndex((step) => step.status === 'running');
    const waitingIndex = steps.findIndex(
      (step) => step.status === 'waiting-confirmation',
    );
    const currentIndex = stepId
      ? steps.findIndex((step) => step.id === stepId)
      : runningIndex >= 0
        ? runningIndex
        : waitingIndex >= 0
          ? waitingIndex
          : steps.findIndex((step) => step.status === 'pending');

    const startStep = (index: number) => {
      if (index < 0) return undefined;
      steps[index] = {
        ...steps[index],
        status: 'running',
        startedAt: steps[index].startedAt || now,
      };
      return steps[index].id;
    };
    const completeStep = (index: number) => {
      if (index < 0) return;
      steps[index] = {
        ...steps[index],
        status: 'completed',
        completedAt: now,
        outputSummary: outputSummary || steps[index].outputSummary,
      };
    };
    const nextPendingIndex = (fromIndex: number) =>
      steps.findIndex(
        (step, index) => index > fromIndex && step.status === 'pending',
      );

    let status = workflow.status;
    let currentStepId = workflow.currentStepId;
    let lastAction = this.workflowActionLabel(action);

    if (action === 'enable') {
      status = 'enabled';
    }
    if (action === 'start' || action === 'resume') {
      status = 'running';
      currentStepId = startStep(currentIndex >= 0 ? currentIndex : 0);
    }
    if (action === 'pause' || action === 'stop') {
      status = 'paused';
      if (runningIndex >= 0) {
        steps[runningIndex] = {
          ...steps[runningIndex],
          status: 'waiting-confirmation',
          outputSummary: outputSummary || steps[runningIndex].outputSummary,
        };
        currentStepId = steps[runningIndex].id;
      }
    }
    if (action === 'advance' || action === 'complete-step') {
      const index = currentIndex >= 0 ? currentIndex : 0;
      completeStep(index);
      const nextIndex = nextPendingIndex(index);
      currentStepId = startStep(nextIndex);
      status = currentStepId ? 'running' : 'completed';
      if (!currentStepId) lastAction = '工作流已完成';
    }
    if (action === 'await-confirmation') {
      // 执行引擎：当前 running 步骤转"等待确认"（工作流保持 running）
      const index = stepId
        ? steps.findIndex((step) => step.id === stepId)
        : runningIndex;
      if (index >= 0 && steps[index].status === 'running') {
        steps[index] = {
          ...steps[index],
          status: 'waiting-confirmation',
        };
        currentStepId = steps[index].id;
        lastAction = '等待确认后继续';
      }
    }
    if (action === 'fail') {
      const index = currentIndex >= 0 ? currentIndex : runningIndex;
      if (index >= 0) {
        steps[index] = {
          ...steps[index],
          status: 'failed',
          outputSummary:
            outputSummary ||
            steps[index].outputSummary ||
            '该步骤被标记为异常。',
        };
        currentStepId = steps[index].id;
      }
      status = 'failed';
    }
    if (action === 'reset') {
      status = 'draft';
      currentStepId = undefined;
      for (const step of steps) {
        step.status = 'pending';
        step.startedAt = undefined;
        step.completedAt = undefined;
        step.outputSummary = undefined;
      }
    }

    return {
      ...workflow,
      status,
      steps,
      currentStepId,
      lastAction,
      lastActionAt: now,
      updatedAt: now,
    };
  }

  private workflowTemplate(value: unknown) {
    const key = this.text(value) || 'content-to-growth';
    const templates = [
      { key: 'content-to-growth', name: '内容到获客闭环' },
      { key: 'keyword-lead-nurture', name: '关键词线索培育 SOP' },
      { key: 'campaign-review', name: '活动获客复盘闭环' },
    ];
    return templates.find((item) => item.key === key) || templates[0];
  }

  private workflowSteps(template: string): GrowthWorkflow['steps'] {
    const makeStep = (
      name: string,
      type: GrowthWorkflow['steps'][number]['type'],
      riskMode: GrowthRiskMode,
      description: string,
    ) => ({
      id: this.id('step'),
      name,
      type,
      riskMode,
      status: 'pending' as const,
      description,
    });

    if (template === 'keyword-lead-nurture') {
      return [
        makeStep(
          '关键词池确认',
          'strategy',
          'confirm-first',
          '确认来源词、意向词、排除词、黑名单和优先级。',
        ),
        makeStep(
          '线索采集预检',
          'acquisition',
          'confirm-first',
          '检查账号状态、每日上限、去重策略和采集范围。',
        ),
        makeStep(
          '人工筛选确认',
          'follow-up',
          'confirm-first',
          '复核高意向线索、无效线索和需要暂缓触达的对象。',
        ),
        makeStep(
          '跟进话术备注',
          'follow-up',
          'draft-only',
          '记录下一步跟进话术、风险提示和人工处理建议。',
        ),
        makeStep(
          '效果复盘',
          'report',
          'auto',
          '查看线索命中、触达、回复和异常原因，形成下一轮关键词优化。',
        ),
      ];
    }

    if (template === 'campaign-review') {
      return [
        makeStep(
          '活动目标确认',
          'strategy',
          'confirm-first',
          '确认活动主题、目标人群、渠道和成功指标。',
        ),
        makeStep(
          '内容素材检查',
          'content',
          'confirm-first',
          '核对内容素材、落地页、发布时间和评论承接话术。',
        ),
        makeStep(
          '获客执行预演',
          'acquisition',
          'draft-only',
          '只生成候选线索和动作清单，不触达真实用户。',
        ),
        makeStep(
          '线索分层备注',
          'follow-up',
          'confirm-first',
          '按意向、来源、风险和下一步动作记录分层备注。',
        ),
        makeStep(
          '活动复盘报告',
          'report',
          'auto',
          '沉淀漏斗表现、话术表现、账号表现和下次优化动作。',
        ),
      ];
    }

    return [
      makeStep(
        '获客策略',
        'strategy',
        'auto',
        '选择行业策略、来源词、意向词、排除词和话术池。',
      ),
      makeStep(
        '内容准备',
        'content',
        'confirm-first',
        '确认内容素材、发布标题、评论承接话术和落地动作。',
      ),
      makeStep(
        '内容发布确认',
        'publish',
        'confirm-first',
        '记录发布计划和人工确认结果；本工作流不触发真实外部发布。',
      ),
      makeStep(
        '自动获客预演',
        'acquisition',
        'draft-only',
        '生成采集范围、候选线索和去重结果；不直接触达真实用户。',
      ),
      makeStep(
        '线索跟进',
        'follow-up',
        'confirm-first',
        '把高意向线索推进到已触达、已合格或已忽略，并留下人工备注。',
      ),
      makeStep(
        '增长复盘',
        'report',
        'auto',
        '查看任务、账号、话术和线索状态表现，沉淀下一轮优化动作。',
      ),
    ];
  }

  private workflowAction(value: unknown): GrowthWorkflowAction {
    const text = this.text(value);
    if (
      [
        'start',
        'pause',
        'resume',
        'stop',
        'enable',
        'advance',
        'complete-step',
        'fail',
        'reset',
        'await-confirmation',
        'confirm-step',
      ].includes(text)
    ) {
      return text as GrowthWorkflowAction;
    }
    return 'enable';
  }

  private workflowActionLabel(action: GrowthWorkflowAction) {
    return {
      start: '启动工作流',
      pause: '暂停工作流',
      resume: '恢复工作流',
      stop: '停止工作流',
      enable: '启用工作流',
      advance: '推进到下一步',
      'complete-step': '完成当前步骤',
      'confirm-step': '确认当前步骤',
      fail: '标记异常',
      reset: '重置工作流',
      'await-confirmation': '等待确认',
    }[action];
  }

  private leadStatusDistribution(
    leads: GrowthLead[],
  ): GrowthReports['leadStatusDistribution'] {
    const statuses: GrowthLead['status'][] = [
      'new',
      'contacted',
      'replied',
      'qualified',
      'converted',
      'ignored',
      'blocked',
    ];
    return statuses.map((status) => ({
      status,
      count: leads.filter((lead) => lead.status === status).length,
    }));
  }

  private taskPerformanceReport(
    runs: GrowthAcquisitionRun[],
    configs: GrowthAcquisitionConfig[],
  ): GrowthReports['taskPerformance'] {
    const configById = new Map(configs.map((config) => [config.id, config]));
    const rows = new Map<string, GrowthReports['taskPerformance'][number]>();
    for (const run of runs) {
      const config = configById.get(run.configId);
      const row = rows.get(run.configId) || {
        configId: run.configId,
        taskName: config?.taskName || `任务 ${run.configId.slice(-6)}`,
        mode: config?.mode || run.mode,
        platform: config?.platform || run.platform,
        runCount: 0,
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        lastRunAt: run.startedAt,
      };
      row.runCount += 1;
      row.candidateCount += run.candidateCount;
      row.selectedCount += run.selectedCount;
      row.contactedCount += run.contactedCount;
      if (run.status === 'failed') row.failedCount += 1;
      if (run.status === 'skipped') row.skippedCount += 1;
      if (!row.lastRunAt || run.startedAt > row.lastRunAt)
        row.lastRunAt = run.startedAt;
      rows.set(run.configId, row);
    }
    return Array.from(rows.values()).sort((left, right) => {
      const leftScore =
        left.selectedCount +
        left.contactedCount -
        left.failedCount -
        left.skippedCount;
      const rightScore =
        right.selectedCount +
        right.contactedCount -
        right.failedCount -
        right.skippedCount;
      return rightScore - leftScore;
    });
  }

  private accountPerformanceReport(
    runs: GrowthAcquisitionRun[],
    configs: GrowthAcquisitionConfig[],
    accounts: GrowthAccountHealth[],
  ): GrowthReports['accountPerformance'] {
    const configById = new Map(configs.map((config) => [config.id, config]));
    const accountByKey = new Map(
      accounts.map((account) => [
        `${account.platform}:${account.accountId}`,
        account,
      ]),
    );
    const rows = new Map<string, GrowthReports['accountPerformance'][number]>();
    for (const run of runs) {
      const config = configById.get(run.configId);
      const platform = config?.platform || run.platform;
      const accountId = config?.accountId || 'unknown';
      const accountKey = `${platform}:${accountId}`;
      const health = accountByKey.get(accountKey);
      const row = rows.get(accountKey) || {
        accountKey,
        accountName: config?.accountName || health?.accountName || accountId,
        platform,
        runCount: 0,
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        lastRunAt: run.startedAt,
      };
      row.runCount += 1;
      row.candidateCount += run.candidateCount;
      row.selectedCount += run.selectedCount;
      row.contactedCount += run.contactedCount;
      if (run.status === 'failed') row.failedCount += 1;
      if (run.status === 'skipped') row.skippedCount += 1;
      if (!row.lastRunAt || run.startedAt > row.lastRunAt)
        row.lastRunAt = run.startedAt;
      rows.set(accountKey, row);
    }
    for (const account of accounts) {
      const accountKey = `${account.platform}:${account.accountId}`;
      if (!rows.has(accountKey)) {
        rows.set(accountKey, {
          accountKey,
          accountName: account.accountName,
          platform: account.platform,
          runCount: 0,
          candidateCount: 0,
          selectedCount: 0,
          contactedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          lastRunAt: undefined,
        });
      }
    }
    return Array.from(rows.values()).sort(
      (left, right) => right.contactedCount - left.contactedCount,
    );
  }

  private trendReport(
    runs: GrowthAcquisitionRun[],
    leads: GrowthLead[],
    startDate?: string,
    endDate?: string,
  ): GrowthReports['trend'] {
    const today = this.dateKey();
    const end = endDate || today;
    const start =
      startDate || this.dateKey(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
    const startTime = new Date(`${start}T00:00:00.000Z`).getTime();
    const endTime = new Date(`${end}T00:00:00.000Z`).getTime();
    const days: GrowthReports['trend'] = [];
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) return days;
    for (let time = startTime; time <= endTime; time += 24 * 60 * 60 * 1000) {
      days.push({
        date: this.dateKey(new Date(time)),
        leads: 0,
        selected: 0,
        contacted: 0,
        converted: 0,
        failed: 0,
        skipped: 0,
      });
    }
    const byDate = new Map(days.map((row) => [row.date, row]));
    for (const lead of leads) {
      const row = byDate.get(this.dateKey(new Date(lead.createdAt)));
      if (!row) continue;
      row.leads += 1;
      if (lead.status === 'converted') row.converted += 1;
    }
    for (const run of runs) {
      const row = byDate.get(this.dateKey(new Date(run.startedAt)));
      if (!row) continue;
      row.selected += run.selectedCount;
      row.contacted += run.contactedCount;
      if (run.status === 'failed') row.failed += 1;
      if (run.status === 'skipped') row.skipped += 1;
    }
    return days;
  }

  private bottleneckReport(
    overview: GrowthOverview,
    runs: GrowthAcquisitionRun[],
    leads: GrowthLead[],
    accounts: GrowthAccountHealth[],
  ): GrowthReports['bottlenecks'] {
    const items: GrowthReports['bottlenecks'] = [];
    const recentRuns = runs.slice(0, 20);
    const failedOrSkipped = recentRuns.filter(
      (run) => run.status === 'failed' || run.status === 'skipped',
    );
    const selectedRate = overview.funnel.candidates
      ? overview.funnel.selected / overview.funnel.candidates
      : 0;
    const contactRate = overview.funnel.selected
      ? overview.funnel.contacted / overview.funnel.selected
      : 0;
    const highIntentUntouched = leads.filter(
      (lead) => lead.score >= 75 && lead.status === 'new',
    ).length;
    const riskyAccounts = accounts.filter(
      (account) =>
        account.loginStatus !== 'online' || account.riskStatus !== 'normal',
    );

    if (!accounts.length) {
      items.push({
        level: 'danger',
        title: '没有可用执行账号',
        detail: '当前账号健康列表为空，自动获客无法进入真实执行或安全预检。',
        action: '先在平台账号中完成抖音/视频号授权，并确认账号在线正常。',
      });
    }
    if (riskyAccounts.length) {
      items.push({
        level: 'danger',
        title: '账号健康正在限制获客执行',
        detail: `${riskyAccounts.length} 个账号登录或风控状态异常，自动任务会被安全闸跳过。`,
        action:
          '先到发布中心-平台账号完成登录或重新授权；若账号已被风控，再回到账号健康处理验证、冷却或失败率。',
      });
    }
    if (
      recentRuns.length &&
      failedOrSkipped.length / recentRuns.length >= 0.35
    ) {
      items.push({
        level: 'warning',
        title: '近期执行稳定性偏低',
        detail: `最近 ${recentRuns.length} 次执行中有 ${failedOrSkipped.length} 次失败或跳过。`,
        action: '优先检查失败原因、账号状态和平台页面结构变化，再扩大任务量。',
      });
    }
    if (overview.funnel.candidates > 0 && selectedRate < 0.25) {
      items.push({
        level: 'warning',
        title: '候选线索筛选命中率偏低',
        detail: `今日候选到入池转化约 ${Math.round(selectedRate * 100)}%，说明关键词或来源范围过宽。`,
        action: '收紧意向关键词，补充排除词，把来源拆成更精确的任务。',
      });
    }
    if (overview.funnel.selected > 0 && contactRate < 0.2) {
      items.push({
        level: 'warning',
        title: '入池后触达不足',
        detail: `今日入池到触达约 ${Math.round(contactRate * 100)}%，线索没有及时进入跟进动作。`,
        action: '对高分线索开启人工确认触达，低分线索先进入草稿池。',
      });
    }
    if (highIntentUntouched) {
      items.push({
        level: 'info',
        title: '高意向线索需要优先处理',
        detail: `${highIntentUntouched} 条 75 分以上线索仍处于新线索状态。`,
        action: '先处理高意向线索，把状态推进到已触达、已合格或已忽略。',
      });
    }
    if (!items.length) {
      items.push({
        level: 'info',
        title: '当前增长链路没有明显阻塞',
        detail: '任务执行、账号健康和线索状态暂未出现集中异常。',
        action: '继续观察任务表现，把高分任务复制到更多精准来源。',
      });
    }
    return items;
  }

  private async growthScope(userId: string): Promise<GrowthScope> {
    return { userId, tenantId: await this.resolveGrowthTenantId(userId) };
  }

  private inGrowthScope(
    item: { userId?: string; tenantId?: string },
    scope: GrowthScope,
  ) {
    if (scope.tenantId) {
      return (
        item.tenantId === scope.tenantId ||
        (item.userId === scope.userId && !item.tenantId)
      );
    }
    return item.userId === scope.userId;
  }

  private sameGrowthRecord(
    item: { id: string; userId?: string; tenantId?: string },
    scope: GrowthScope,
    id: string,
  ) {
    return item.id === id && this.inGrowthScope(item, scope);
  }

  private sameGrowthAccount(
    item: {
      userId?: string;
      tenantId?: string;
      platform: GrowthPlatform;
      accountId: string;
    },
    scope: GrowthScope,
    platform: GrowthPlatform,
    accountId: string,
  ) {
    return (
      this.inGrowthScope(item, scope) &&
      item.platform === platform &&
      item.accountId === accountId
    );
  }

  private async resolveGrowthMembership(
    userId: string,
  ): Promise<GrowthMembershipScope | null> {
    const tenantMemberDelegate = (
      this.prisma as unknown as {
        tenantMember?: {
          findFirst?: (args: unknown) => Promise<{
            tenantId: string;
            role?: string | null;
            permissions?: unknown;
            tenant?: { ownerUserId?: string | null } | null;
          } | null>;
        };
      }
    ).tenantMember;
    if (!tenantMemberDelegate?.findFirst) {
      return null;
    }

    try {
      const selectedTenantId = await this.resolveRequestTenantId(userId);
      const member = await Promise.resolve(
        tenantMemberDelegate.findFirst({
          where: {
            userId,
            status: 'active',
            tenant: { status: 'active' },
            ...(selectedTenantId ? { tenantId: selectedTenantId } : {}),
          },
          orderBy: { joinedAt: 'asc' },
          select: {
            tenantId: true,
            role: true,
            permissions: true,
            tenant: { select: { ownerUserId: true } },
          },
        }),
      );
      if (!member?.tenantId) return null;
      return {
        userId,
        tenantId: member.tenantId,
        role: this.text(member.role) || 'member',
        permissions: this.jsonList(member.permissions),
        legacy: false,
        // 云端同步可能把 owner 的 role 置为 member，owner 身份必须被识别
        isOwner: Boolean(
          member.tenant?.ownerUserId && member.tenant.ownerUserId === userId,
        ),
      };
    } catch (error) {
      if (this.isMissingGrowthTenantStorage(error)) return null;
      throw error;
    }
  }

  private async resolveRequestTenantId(userId: string) {
    const context = this.authRequestContext?.get();
    if (!context?.user || context.user.id !== userId) return undefined;
    return this.authRequestContext!.resolveTenantId(this.prisma);
  }

  private async requireGrowthMutationScope(
    userId: string,
    options: { platformAccount?: boolean } = {},
  ): Promise<GrowthMembershipScope> {
    const delegate = (
      this.prisma as unknown as {
        tenantMember?: { findFirst?: (args: unknown) => Promise<unknown> };
      }
    ).tenantMember;
    if (!delegate?.findFirst) {
      return {
        userId,
        tenantId: undefined,
        role: 'admin',
        permissions: ['*'],
        legacy: true,
      };
    }

    const membership = await this.resolveGrowthMembership(userId);
    if (!membership) {
      throw new ForbiddenException('当前账号不属于可用组织，不能修改增长数据');
    }
    if (!this.canMutateGrowth(membership)) {
      throw new ForbiddenException('当前组织权限不允许修改增长数据');
    }
    if (
      options.platformAccount &&
      !this.canUseGrowthPlatformAccount(membership)
    ) {
      throw new ForbiddenException('当前组织权限不允许使用平台账号');
    }
    return membership;
  }

  private async requireGrowthReadScope(
    userId: string,
  ): Promise<GrowthMembershipScope> {
    const delegate = (
      this.prisma as unknown as {
        tenantMember?: { findFirst?: (args: unknown) => Promise<unknown> };
      }
    ).tenantMember;
    if (!delegate?.findFirst) {
      return {
        userId,
        tenantId: undefined,
        role: 'admin',
        permissions: ['*'],
        legacy: true,
      };
    }

    const membership = await this.resolveGrowthMembership(userId);
    if (!membership) {
      throw new ForbiddenException('当前账号不属于可用组织，不能查看增长数据');
    }
    return membership;
  }

  /**
   * 全功能开放（大王决策 2026-08-11）：登录用户默认可用所有功能，
   * 不再按 role/permissions 拦截。组织归属由 resolveGrowthMembership 保证。
   */
  private canMutateGrowth(_membership: GrowthMembershipScope) {
    return true;
  }

  private canUseGrowthPlatformAccount(_membership: GrowthMembershipScope) {
    return true;
  }

  private isMissingGrowthTenantStorage(error: unknown) {
    const record =
      error && typeof error === 'object'
        ? (error as { code?: unknown; message?: unknown })
        : {};
    const code = typeof record.code === 'string' ? record.code : '';
    const message =
      typeof record.message === 'string' ? record.message.toLowerCase() : '';
    return (
      code === 'P2021' ||
      message.includes('tenant_members') ||
      message.includes('tenantmember')
    );
  }

  private async resolveGrowthTenantId(userId: string) {
    return (await this.resolveGrowthMembership(userId))?.tenantId;
  }

  private async assertGrowthPlatformAccountScope(
    userId: string,
    platform: GrowthPlatform,
    accountId: string,
    store: GrowthStore,
  ) {
    const membership = await this.requireGrowthMutationScope(userId, {
      platformAccount: true,
    });
    const scope: GrowthScope = {
      userId,
      tenantId: membership.tenantId,
    };
    const conflictingConfig = store.configs.find(
      (item) =>
        item.platform === platform &&
        item.accountId === accountId &&
        !this.inGrowthScope(item, scope),
    );
    const conflictingHealth = store.accountHealth.find(
      (item) =>
        item.platform === platform &&
        item.accountId === accountId &&
        !this.inGrowthScope(item, scope),
    );
    if (conflictingConfig || conflictingHealth) {
      throw new ForbiddenException('该平台账号已属于其他组织');
    }
    return scope;
  }

  private async loadStore(): Promise<GrowthStore> {
    await this.migrateLocalStoreToDatabase();
    const store = await this.loadStoreFromDatabase();
    return {
      ...store,
      commercialAudits: await this.loadCommercialAuditsFromFile(
        store.commercialAudits,
      ),
    };
  }

  private async saveStore(
    store: GrowthStore,
    options: GrowthPersistenceOptions = {},
  ) {
    const normalized = this.normalizeStore(store);
    await this.saveStoreToDatabase(normalized, options);
    await this.saveStoreFileSnapshot(normalized, options);
  }

  private async saveStoreFileSnapshot(
    store: GrowthStore,
    options: GrowthPersistenceOptions,
  ) {
    this.storeSnapshotWrite = this.storeSnapshotWrite.then(async () => {
      const filePath = this.storePath();
      await mkdir(join(filePath, '..'), { recursive: true });
      let snapshot = store;
      if (options.scope) {
        let existing = this.normalizeStore({});
        try {
          existing = this.normalizeStore(
            JSON.parse(
              await readFile(filePath, 'utf8'),
            ) as Partial<GrowthStore>,
          );
        } catch {
          // The database remains authoritative when no legacy snapshot exists.
        }
        snapshot = this.mergeGrowthStoreSnapshot(existing, store, options);
      }
      await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
    });
    await this.storeSnapshotWrite;
  }

  private mergeGrowthStoreSnapshot(
    existing: GrowthStore,
    incoming: GrowthStore,
    options: GrowthPersistenceOptions,
  ): GrowthStore {
    if (!options.scope) return incoming;
    const collections = new Set(
      options.collections ||
        ([
          'strategies',
          'configs',
          'runs',
          'leads',
          'accountHealth',
          'workflows',
          'commercialAudits',
        ] as GrowthStoreCollection[]),
    );
    const merge = <T extends { userId?: string; tenantId?: string }>(
      current: T[],
      next: T[],
      collection: GrowthStoreCollection,
    ) => {
      if (!collections.has(collection)) return current;
      return [
        ...next.filter((item) => this.inGrowthScope(item, options.scope!)),
        ...current.filter((item) => !this.inGrowthScope(item, options.scope!)),
      ];
    };
    return {
      version: STORE_VERSION,
      strategies: merge(existing.strategies, incoming.strategies, 'strategies'),
      configs: merge(existing.configs, incoming.configs, 'configs'),
      runs: merge(existing.runs, incoming.runs, 'runs'),
      leads: merge(existing.leads, incoming.leads, 'leads'),
      accountHealth: merge(
        existing.accountHealth,
        incoming.accountHealth,
        'accountHealth',
      ),
      workflows: merge(existing.workflows, incoming.workflows, 'workflows'),
      commercialAudits: merge(
        existing.commercialAudits,
        incoming.commercialAudits,
        'commercialAudits',
      ),
    };
  }

  private async migrateLocalStoreToDatabase() {
    if (this.dbMigrated) return;
    this.dbMigrated = true;
    await this.ensureSqliteGrowthTables();
    const dbStore = await this.loadStoreFromDatabase();
    if (
      dbStore.strategies.length ||
      dbStore.configs.length ||
      dbStore.runs.length ||
      dbStore.leads.length ||
      dbStore.accountHealth.length ||
      dbStore.workflows.length ||
      dbStore.commercialAudits.length
    ) {
      return;
    }
    try {
      const raw = await readFile(this.storePath(), 'utf8');
      const fileStore = this.normalizeStore(
        JSON.parse(raw) as Partial<GrowthStore>,
      );
      if (
        fileStore.strategies.length ||
        fileStore.configs.length ||
        fileStore.runs.length ||
        fileStore.leads.length ||
        fileStore.accountHealth.length ||
        fileStore.workflows.length ||
        fileStore.commercialAudits.length
      ) {
        await this.saveStoreToDatabase(fileStore);
        this.logger.log('已将增长模块本地 store 自动迁移到 Prisma 数据库。');
      }
    } catch {
      // First-run deployments have no local store; database is the source of truth.
    }
  }

  private async ensureSqliteGrowthTables() {
    const databaseUrl = `${process.env.DATABASE_URL || process.env.SQLITE_DATABASE_URL || ''}`;
    if (!databaseUrl.startsWith('file:')) return;
    const sql = [
      `CREATE TABLE IF NOT EXISTS growth_strategies (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        industry TEXT NOT NULL,
        scenario TEXT NOT NULL,
        name TEXT NOT NULL,
        source_keywords JSONB NOT NULL DEFAULT '[]',
        demand_keywords JSONB NOT NULL DEFAULT '[]',
        exclude_keywords JSONB NOT NULL DEFAULT '[]',
        blacklist_nicknames JSONB NOT NULL DEFAULT '[]',
        comment_templates JSONB NOT NULL DEFAULT '[]',
        private_message_templates JSONB NOT NULL DEFAULT '[]',
        default_daily_limit INTEGER NOT NULL DEFAULT 20,
        default_risk_mode TEXT NOT NULL DEFAULT 'confirm-first',
        scoring_rules JSONB NOT NULL DEFAULT '[]',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS growth_acquisition_configs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        mode TEXT NOT NULL,
        task_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT,
        source_inputs JSONB NOT NULL DEFAULT '[]',
        include_keywords JSONB NOT NULL DEFAULT '[]',
        exclude_keywords JSONB NOT NULL DEFAULT '[]',
        blacklist_nicknames JSONB NOT NULL DEFAULT '[]',
        comment_templates JSONB NOT NULL DEFAULT '[]',
        private_message_templates JSONB NOT NULL DEFAULT '[]',
        daily_limit INTEGER NOT NULL DEFAULT 20,
        per_target_limit INTEGER NOT NULL DEFAULT 1,
        deduplicate BOOLEAN NOT NULL DEFAULT true,
        schedule_enabled BOOLEAN NOT NULL DEFAULT false,
        begin_time TEXT NOT NULL DEFAULT '09:30',
        risk_mode TEXT NOT NULL DEFAULT 'confirm-first',
        status TEXT NOT NULL DEFAULT 'enabled',
        exposure_count INTEGER NOT NULL DEFAULT 0,
        exposure_date TEXT NOT NULL,
        last_run_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS growth_acquisition_runs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        config_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        platform TEXT NOT NULL,
        status TEXT NOT NULL,
        failure_reason TEXT,
        message TEXT NOT NULL,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        selected_count INTEGER NOT NULL DEFAULT 0,
        contacted_count INTEGER NOT NULL DEFAULT 0,
        crm_captured_count INTEGER NOT NULL DEFAULT 0,
        evidence_urls JSONB NOT NULL DEFAULT '[]',
        lead_ids JSONB NOT NULL DEFAULT '[]',
        started_at DATETIME NOT NULL,
        ended_at DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS growth_account_health (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        platform TEXT NOT NULL,
        account_id TEXT NOT NULL,
        account_name TEXT NOT NULL,
        login_status TEXT NOT NULL,
        today_action_count INTEGER NOT NULL DEFAULT 0,
        failure_rate REAL NOT NULL DEFAULT 0,
        risk_status TEXT NOT NULL,
        cooldown_until DATETIME,
        recommendation TEXT NOT NULL,
        last_checked_at DATETIME NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS growth_workflows (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        name TEXT NOT NULL,
        template TEXT NOT NULL,
        status TEXT NOT NULL,
        steps JSONB NOT NULL DEFAULT '[]',
        current_step_id TEXT,
        last_action TEXT,
        last_action_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS growth_scheduler_leases (
        id TEXT PRIMARY KEY NOT NULL,
        tenant_id TEXT,
        user_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        locked_until DATETIME NOT NULL,
        heartbeat_at DATETIME,
        last_run_at DATETIME,
        cursor JSONB NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS growth_commercial_audits (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        tenant_id TEXT,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        runtime JSONB NOT NULL DEFAULT '{}',
        accounts JSONB NOT NULL DEFAULT '{}',
        plan JSONB NOT NULL DEFAULT '{}',
        blockers JSONB NOT NULL DEFAULT '[]',
        warnings JSONB NOT NULL DEFAULT '[]',
        result JSONB NOT NULL DEFAULT '{}',
        created_at DATETIME NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS growth_account_health_user_platform_account_key ON growth_account_health(user_id, platform, account_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS growth_account_health_tenant_platform_account_key ON growth_account_health(tenant_id, platform, account_id)`,
      `CREATE INDEX IF NOT EXISTS growth_strategies_tenant_id_idx ON growth_strategies(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS growth_configs_user_status_idx ON growth_acquisition_configs(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_configs_tenant_status_idx ON growth_acquisition_configs(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_configs_tenant_schedule_idx ON growth_acquisition_configs(tenant_id, schedule_enabled)`,
      `CREATE INDEX IF NOT EXISTS growth_runs_user_started_idx ON growth_acquisition_runs(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS growth_runs_tenant_started_idx ON growth_acquisition_runs(tenant_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS growth_account_health_tenant_risk_idx ON growth_account_health(tenant_id, risk_status)`,
      `CREATE INDEX IF NOT EXISTS growth_workflows_user_status_idx ON growth_workflows(user_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_workflows_tenant_status_idx ON growth_workflows(tenant_id, status)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_tenant_idx ON growth_scheduler_leases(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_user_idx ON growth_scheduler_leases(user_id)`,
      `CREATE INDEX IF NOT EXISTS growth_scheduler_leases_locked_until_idx ON growth_scheduler_leases(locked_until)`,
      `CREATE INDEX IF NOT EXISTS growth_commercial_audits_user_created_idx ON growth_commercial_audits(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS growth_commercial_audits_tenant_created_idx ON growth_commercial_audits(tenant_id, created_at)`,
    ];
    for (const statement of sql) {
      if (this.isSqliteIndexStatement(statement)) {
        continue;
      }
      await this.prisma.$executeRawUnsafe(statement);
    }
    for (const [table, column] of [
      ['growth_strategies', 'tenant_id'],
      ['growth_acquisition_configs', 'tenant_id'],
      ['growth_acquisition_runs', 'tenant_id'],
      ['growth_account_health', 'tenant_id'],
      ['growth_workflows', 'tenant_id'],
    ] as const) {
      try {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE ${table} ADD COLUMN ${column} TEXT`,
        );
      } catch {
        // Existing SQLite databases already have the column.
      }
    }
    for (const statement of sql) {
      if (!this.isSqliteIndexStatement(statement)) {
        continue;
      }
      await this.prisma.$executeRawUnsafe(statement);
    }
  }

  private isSqliteIndexStatement(statement: string) {
    return /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(statement);
  }

  private async loadStoreFromDatabase(): Promise<GrowthStore> {
    const prisma = this.prisma;
    const [
      strategies,
      configs,
      runs,
      leads,
      accountHealth,
      workflows,
      commercialAudits,
    ] = await Promise.all([
      prisma.growthStrategy.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.growthAcquisitionConfig.findMany({
        orderBy: { createdAt: 'desc' },
      }),
      prisma.growthAcquisitionRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 500,
      }),
      prisma.lead.findMany({
        where: { sourceType: { notIn: ['comment', 'dm'] } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
      prisma.growthAccountHealth.findMany({
        orderBy: { lastCheckedAt: 'desc' },
      }),
      prisma.growthWorkflow.findMany({ orderBy: { createdAt: 'desc' } }),
      this.loadCommercialAuditsFromDatabase(),
    ]);
    return this.normalizeStore({
      strategies: strategies.map((item) => ({
        id: item.id,
        userId: item.userId,
        tenantId: item.tenantId || undefined,
        industry: item.industry,
        scenario: item.scenario,
        name: item.name,
        sourceKeywords: this.jsonList(item.sourceKeywords),
        demandKeywords: this.jsonList(item.demandKeywords),
        excludeKeywords: this.jsonList(item.excludeKeywords),
        blacklistNicknames: this.jsonList(item.blacklistNicknames),
        commentTemplates: this.jsonList(item.commentTemplates),
        privateMessageTemplates: this.jsonList(item.privateMessageTemplates),
        defaultDailyLimit: item.defaultDailyLimit,
        defaultRiskMode: this.riskMode(item.defaultRiskMode),
        scoringRules: (Array.isArray(item.scoringRules)
          ? item.scoringRules
          : []) as GrowthStrategyTemplate['scoringRules'],
        createdAt: this.iso(item.createdAt),
        updatedAt: this.iso(item.updatedAt),
      })),
      configs: configs.map((item) => ({
        id: item.id,
        userId: item.userId,
        tenantId: item.tenantId || undefined,
        mode: this.mode(item.mode),
        taskName: item.taskName,
        platform: this.platform(item.platform),
        accountId: item.accountId,
        accountName: item.accountName ?? undefined,
        sourceInputs: this.jsonList(item.sourceInputs),
        includeKeywords: this.jsonList(item.includeKeywords),
        excludeKeywords: this.jsonList(item.excludeKeywords),
        blacklistNicknames: this.jsonList(item.blacklistNicknames),
        commentTemplates: this.jsonList(item.commentTemplates),
        privateMessageTemplates: this.jsonList(item.privateMessageTemplates),
        dailyLimit: item.dailyLimit,
        perTargetLimit: item.perTargetLimit,
        deduplicate: item.deduplicate,
        scheduleEnabled: item.scheduleEnabled,
        beginTime: item.beginTime,
        riskMode: this.riskMode(item.riskMode),
        status: this.taskStatus(item.status),
        exposureCount: item.exposureCount,
        exposureDate: item.exposureDate,
        lastRunAt: item.lastRunAt ? this.iso(item.lastRunAt) : undefined,
        createdAt: this.iso(item.createdAt),
        updatedAt: this.iso(item.updatedAt),
      })),
      runs: runs.map((item) => this.mapRunRow(item)),
      leads: leads.map((item) => this.mapLeadRow(item)),
      accountHealth: accountHealth.map((item) => ({
        id: item.id,
        userId: item.userId,
        tenantId: item.tenantId || undefined,
        platform: this.platform(item.platform),
        accountId: item.accountId,
        accountName: item.accountName ?? '',
        loginStatus: this.loginStatus(item.loginStatus),
        todayActionCount: item.todayActionCount,
        failureRate: item.failureRate,
        riskStatus: this.healthRiskStatus(item.riskStatus),
        cooldownUntil: item.cooldownUntil
          ? this.iso(item.cooldownUntil)
          : undefined,
        recommendation: item.recommendation,
        lastCheckedAt: this.iso(item.lastCheckedAt),
      })),
      workflows: workflows.map((item) => ({
        id: item.id,
        userId: item.userId,
        tenantId: item.tenantId || undefined,
        name: item.name,
        template: item.template,
        industry: item.industry ?? undefined,
        scenario: item.scenario ?? undefined,
        status: this.workflowStatus(item.status),
        steps: (Array.isArray(item.steps)
          ? item.steps
          : []) as GrowthWorkflow['steps'],
        currentStepId: item.currentStepId ?? undefined,
        lastAction: item.lastAction ?? undefined,
        lastActionAt: item.lastActionAt
          ? this.iso(item.lastActionAt)
          : undefined,
        createdAt: this.iso(item.createdAt),
        updatedAt: this.iso(item.updatedAt),
      })),
      commercialAudits,
    });
  }

  /** Prisma growthAcquisitionRun 行 → GrowthAcquisitionRun（供分页查询复用） */
  private mapRunRow(item: {
    id: string;
    userId: string;
    tenantId: string | null;
    configId: string;
    mode: string;
    platform: string;
    status: string;
    failureReason: string | null;
    message: string;
    candidateCount: number;
    selectedCount: number;
    contactedCount: number;
    crmCapturedCount: number;
    evidenceUrls: unknown;
    leadIds: unknown;
    startedAt: Date;
    endedAt: Date | null;
  }) {
    return {
      id: item.id,
      userId: item.userId,
      tenantId: item.tenantId || undefined,
      configId: item.configId,
      mode: this.mode(item.mode),
      platform: this.platform(item.platform),
      status: this.runStatus(item.status),
      failureReason: this.failureReason(item.failureReason),
      message: item.message,
      candidateCount: item.candidateCount,
      selectedCount: item.selectedCount,
      contactedCount: item.contactedCount,
      crmCapturedCount: item.crmCapturedCount,
      evidenceUrls: this.jsonList(item.evidenceUrls),
      leadIds: this.jsonList(item.leadIds),
      startedAt: this.iso(item.startedAt),
      endedAt: item.endedAt ? this.iso(item.endedAt) : undefined,
    };
  }

  /** Prisma lead 行 → GrowthLead（供分页查询复用） */
  private mapLeadRow(item: {
    id: string;
    userId: string;
    tenantId: string | null;
    platform: string;
    sourceType: string;
    sourceTaskId: string | null;
    sourceRunId: string | null;
    sourceAccountId: string | null;
    sourceArticleId: string | null;
    sourcePublishRecordId: string | null;
    sourceInteractionEventId: string | null;
    customerId: string | null;
    nickname: string | null;
    profileUrl: string | null;
    avatarUrl: string | null;
    externalUserId: string | null;
    sourceText: string | null;
    sourceUrl: string | null;
    videoTitle: string | null;
    videoUrl: string | null;
    commentTime: string | null;
    matchedKeywords: unknown;
    score: number;
    scoreReasons: unknown;
    status: string;
    nextFollowUpAt: Date | null;
    ownerUserId: string | null;
    notes: unknown;
    evidenceUrls: unknown;
    latestReply: string | null;
    enrichmentStatus: string | null;
    missingFields: unknown;
    identityConfidence: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): GrowthLead {
    return {
      id: item.id,
      userId: item.userId,
      tenantId: item.tenantId || undefined,
      platform: this.platform(item.platform),
      sourceType: this.leadSourceType(item.sourceType),
      sourceTaskId: item.sourceTaskId ?? undefined,
      sourceRunId: item.sourceRunId ?? undefined,
      crmCustomerId: item.customerId ?? undefined,
      nickname: item.nickname ?? '',
      profileUrl: item.profileUrl ?? undefined,
      avatarUrl: item.avatarUrl ?? undefined,
      externalUserId: item.externalUserId ?? undefined,
      sourceText: item.sourceText ?? '',
      sourceUrl: item.sourceUrl ?? undefined,
      videoTitle: item.videoTitle ?? undefined,
      videoUrl: item.videoUrl ?? undefined,
      commentTime: item.commentTime ?? undefined,
      matchedKeywords: this.jsonList(item.matchedKeywords),
      score: item.score,
      scoreReasons: this.jsonList(item.scoreReasons),
      status: this.leadStatus(item.status) ?? 'new',
      nextFollowUpAt: item.nextFollowUpAt
        ? this.iso(item.nextFollowUpAt)
        : undefined,
      ownerUserId: item.ownerUserId ?? undefined,
      notes: Array.isArray(item.notes) ? item.notes : [],
      evidenceUrls: this.jsonList(item.evidenceUrls),
      latestReply: item.latestReply ?? undefined,
      // P1 复核（全面审查）：DB→store 反向加载补齐归因/质量字段——
      // 原 mapLeadRow 丢这些字段，isCrmCaptureEligibleLead 读到的
      // enrichmentStatus/suppressed/missingFields 恒 undefined → 质量门禁失效
      sourceAccountId: item.sourceAccountId ?? undefined,
      sourceArticleId: item.sourceArticleId ?? null,
      sourcePublishRecordId: item.sourcePublishRecordId ?? null,
      sourceInteractionEventId: item.sourceInteractionEventId ?? null,
      enrichmentStatus:
        (item.enrichmentStatus as GrowthLead['enrichmentStatus']) ?? undefined,
      missingFields: this.jsonList(item.missingFields),
      identityConfidence: item.identityConfidence ?? undefined,
      createdAt: this.iso(item.createdAt),
      updatedAt: this.iso(item.updatedAt),
    };
  }

  /** growth scope → Prisma where（数据库分页/服务端筛选共用） */
  private growthScopeWhere(scope: GrowthScope): {
    OR?: Array<Record<string, unknown>>;
    userId?: string;
  } {
    if (scope.tenantId) {
      return {
        OR: [
          { tenantId: scope.tenantId },
          // 2026-09-01（复核 P1-8 根因）：原分支 { userId, tenantId: null } 对非空
          // tenantId 字段（Article.tenantId String NOT NULL）传 null → Prisma 运行时
          // 参数校验报 Argument tenantId is missing，六步漏斗真实运行态持续失败。
          // 且该分支语义为死分支（tenantId 有默认值，永不为 null）——改为"该用户数据"。
          { userId: scope.userId },
        ],
      };
    }
    return { userId: scope.userId };
  }

  /** 解析 pageSize（1-500，默认 500；非法值回退默认） */
  private queryPageSize(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return 500;
    return Math.min(500, Math.floor(n));
  }

  /** 解析分页偏移：优先 offset，否则 (page-1)*pageSize */
  private queryOffset(
    page: unknown,
    offset: unknown,
    pageSize: number,
  ): number {
    const rawOffset = Number(offset);
    if (Number.isFinite(rawOffset) && rawOffset >= 0) {
      return Math.floor(rawOffset);
    }
    const pageNum = Number(page);
    if (!Number.isFinite(pageNum) || pageNum < 1) return 0;
    return (Math.floor(pageNum) - 1) * pageSize;
  }

  /** 数据库列表 delegate 是否可用（测试环境注入空 prisma 时为 false，回退 loadStore） */
  private hasDbListDelegates(): boolean {
    const prisma = this.prisma as unknown as {
      growthAcquisitionRun?: { findMany?: unknown };
      lead?: { findMany?: unknown };
    };
    return Boolean(
      prisma?.growthAcquisitionRun?.findMany && prisma?.lead?.findMany,
    );
  }

  private async saveStoreToDatabase(
    store: GrowthStore,
    options: GrowthPersistenceOptions = {},
  ) {
    // error-report 0f9f248d (2026-08-26): 交互式事务默认 5000ms 超时，SQLite 单写 +
    // 最多 1000 条 leads 逐条 findUnique+upsert（约 3000+ 次串行查询）跑不完 5s，
    // 抛 Transaction already closed → growth execute 500。放宽到 60s（本地单用户，
    // 幂等 upsert，无锁竞争），超时仅影响单次持久化不产生脏数据。
    // AuthGuard may have just switched this request to a lazily-created
    // account Prisma client. Wait for that client explicitly before opening an
    // interactive transaction; otherwise Prisma can create a transaction id
    // before the SQLite connection is ready and invalidate it on the first
    // model write (P2028 / "Transaction not found").
    const transactionRunner = (
      callback: (tx: Prisma.TransactionClient) => Promise<void>,
      options: { timeout: number },
    ) =>
      typeof this.prisma.runActiveTransaction === 'function'
        ? this.prisma.runActiveTransaction(callback, options)
        : this.prisma.$transaction(callback, options);
    await transactionRunner(
      async (tx) => {
        await this.deleteGrowthRecordsWithClient(tx, options);
        for (const item of this.growthPersistenceItems(
          store.strategies,
          options,
          'strategies',
        )) {
          await tx.growthStrategy.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              userId: item.userId,
              actorUserId: options.scope?.userId ?? item.userId,
              tenantId: item.tenantId ?? null,
              industry: item.industry,
              scenario: item.scenario,
              name: item.name,
              sourceKeywords: item.sourceKeywords,
              demandKeywords: item.demandKeywords,
              excludeKeywords: item.excludeKeywords,
              blacklistNicknames: item.blacklistNicknames,
              commentTemplates: item.commentTemplates,
              privateMessageTemplates: item.privateMessageTemplates,
              defaultDailyLimit: item.defaultDailyLimit,
              defaultRiskMode: item.defaultRiskMode,
              scoringRules: item.scoringRules,
              createdAt: new Date(item.createdAt),
              updatedAt: new Date(item.updatedAt),
            },
            update: {
              tenantId: item.tenantId ?? null,
              actorUserId: options.scope?.userId ?? item.userId,
              industry: item.industry,
              scenario: item.scenario,
              name: item.name,
              sourceKeywords: item.sourceKeywords,
              demandKeywords: item.demandKeywords,
              excludeKeywords: item.excludeKeywords,
              blacklistNicknames: item.blacklistNicknames,
              commentTemplates: item.commentTemplates,
              privateMessageTemplates: item.privateMessageTemplates,
              defaultDailyLimit: item.defaultDailyLimit,
              defaultRiskMode: item.defaultRiskMode,
              scoringRules: item.scoringRules,
              updatedAt: new Date(item.updatedAt),
            },
          });
        }
        for (const item of this.growthPersistenceItems(
          store.configs,
          options,
          'configs',
        )) {
          await tx.growthAcquisitionConfig.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              userId: item.userId,
              actorUserId: options.scope?.userId ?? item.userId,
              tenantId: item.tenantId ?? null,
              mode: item.mode,
              taskName: item.taskName,
              platform: item.platform,
              accountId: item.accountId,
              accountName: item.accountName,
              sourceInputs: item.sourceInputs,
              includeKeywords: item.includeKeywords,
              excludeKeywords: item.excludeKeywords,
              blacklistNicknames: item.blacklistNicknames,
              commentTemplates: item.commentTemplates,
              privateMessageTemplates: item.privateMessageTemplates,
              dailyLimit: item.dailyLimit,
              perTargetLimit: item.perTargetLimit,
              deduplicate: item.deduplicate,
              scheduleEnabled: item.scheduleEnabled,
              beginTime: item.beginTime,
              riskMode: item.riskMode,
              status: item.status,
              exposureCount: item.exposureCount,
              exposureDate: item.exposureDate,
              lastRunAt: item.lastRunAt ? new Date(item.lastRunAt) : undefined,
              createdAt: new Date(item.createdAt),
              updatedAt: new Date(item.updatedAt),
            },
            update: {
              tenantId: item.tenantId ?? null,
              actorUserId: options.scope?.userId ?? item.userId,
              mode: item.mode,
              taskName: item.taskName,
              platform: item.platform,
              accountId: item.accountId,
              accountName: item.accountName,
              sourceInputs: item.sourceInputs,
              includeKeywords: item.includeKeywords,
              excludeKeywords: item.excludeKeywords,
              blacklistNicknames: item.blacklistNicknames,
              commentTemplates: item.commentTemplates,
              privateMessageTemplates: item.privateMessageTemplates,
              dailyLimit: item.dailyLimit,
              perTargetLimit: item.perTargetLimit,
              deduplicate: item.deduplicate,
              scheduleEnabled: item.scheduleEnabled,
              beginTime: item.beginTime,
              riskMode: item.riskMode,
              status: item.status,
              exposureCount: item.exposureCount,
              exposureDate: item.exposureDate,
              lastRunAt: item.lastRunAt ? new Date(item.lastRunAt) : undefined,
              updatedAt: new Date(item.updatedAt),
            },
          });
        }
        for (const item of this.growthPersistenceItems(
          store.runs,
          options,
          'runs',
        )) {
          await tx.growthAcquisitionRun.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              userId: item.userId,
              actorUserId: options.scope?.userId ?? item.userId,
              tenantId: item.tenantId ?? null,
              configId: item.configId,
              mode: item.mode,
              platform: item.platform,
              status: item.status,
              failureReason: item.failureReason,
              message: item.message,
              candidateCount: item.candidateCount,
              selectedCount: item.selectedCount,
              contactedCount: item.contactedCount,
              crmCapturedCount: item.crmCapturedCount,
              evidenceUrls: item.evidenceUrls,
              leadIds: item.leadIds,
              startedAt: new Date(item.startedAt),
              endedAt: item.endedAt ? new Date(item.endedAt) : undefined,
            },
            update: {
              tenantId: item.tenantId ?? null,
              actorUserId: options.scope?.userId ?? item.userId,
              status: item.status,
              failureReason: item.failureReason,
              message: item.message,
              candidateCount: item.candidateCount,
              selectedCount: item.selectedCount,
              contactedCount: item.contactedCount,
              crmCapturedCount: item.crmCapturedCount,
              evidenceUrls: item.evidenceUrls,
              leadIds: item.leadIds,
              endedAt: item.endedAt ? new Date(item.endedAt) : undefined,
            },
          });
        }
        for (const item of this.growthPersistenceItems(
          store.leads,
          options,
          'leads',
        )) {
          // P0 复核（全面审查）：upsert 用 dedupeKey 复合唯一键（对齐
          // LeadRepository.dedupeWhere 与 schema @@unique([tenantId,dedupeKey])）——
          // 原 where:{id} 在重跑任务命中历史 dedupeKey 时 create 撞 P2002，
          // 整个 $transaction（configs/runs/leads）一起回滚。
          const dedupeKey = this.unifiedLeadDedupeKey(item);
          const dedupeWhere = item.tenantId
            ? {
                tenantId_dedupeKey: {
                  tenantId: item.tenantId,
                  dedupeKey,
                },
              }
            : {
                userId_dedupeKey: { userId: item.userId, dedupeKey },
              };
          // P0 复核（二次）：update 前取既有记录——已转化（status=converted）的线索
          // 不允许被任务重跑降级 status / 置空 customerId（转化链路数据不可被采集层抹掉）。
          const existingLead = await tx.lead.findUnique({ where: dedupeWhere });
          // P0 复核（三次）：历史数据 dedupeKey 迁移兜底——旧库存的 dedupeKey 是
          // `lead:growth:{id}`（旧格式），新算法算出 `lead:sha256(...)`，dedupeWhere 命中不到
          // 会走 create 分支撞 id 唯一约束（P2002）。此处按 id 兜底找到旧记录，先修正 dedupeKey，
          // 让后续 upsert 稳定走 update 分支。
          let existingByAny = existingLead;
          if (!existingByAny) {
            existingByAny = await tx.lead.findUnique({
              where: { id: item.id },
            });
            if (existingByAny) {
              await tx.lead.update({
                where: { id: item.id },
                data: { dedupeKey },
              });
            }
          }
          const preserveConverted = existingByAny?.status === 'converted';
          await tx.lead.upsert({
            where: dedupeWhere,
            create: {
              id: item.id,
              userId: item.userId,
              tenantId: item.tenantId ?? null,
              platform: item.platform,
              sourceType: item.sourceType,
              sourceTaskId: item.sourceTaskId,
              sourceRunId: item.sourceRunId,
              customerId: item.crmCustomerId ?? null,
              nickname: item.nickname,
              profileUrl: item.profileUrl,
              avatarUrl: item.avatarUrl,
              externalUserId: item.externalUserId,
              sourceText: item.sourceText,
              sourceUrl: item.sourceUrl,
              videoTitle: item.videoTitle,
              videoUrl: item.videoUrl,
              commentTime: item.commentTime,
              matchedKeywords: item.matchedKeywords ?? [],
              score: item.score,
              scoreReasons: item.scoreReasons ?? [],
              status: item.status,
              nextFollowUpAt: item.nextFollowUpAt
                ? new Date(item.nextFollowUpAt)
                : undefined,
              ownerUserId: item.ownerUserId ?? undefined,
              notes: (item.notes ?? []) as unknown as Prisma.InputJsonValue,
              evidenceUrls: item.evidenceUrls ?? [],
              latestReply: item.latestReply,
              // P1-11 复核：统一 dedupeKey（对齐 LeadRepository 规则 `lead:sha256(platform:uid|nick:...)`），
              // 不再硬编码 `lead:growth:{id}`——否则 bridge/patchUnifiedLead 找不到统一 Lead。
              dedupeKey,
              // P1-11 复核：归因链上游 + 质量字段落库（此前丢失）
              sourceAccountId: item.sourceAccountId ?? null,
              sourceArticleId: item.sourceArticleId ?? null,
              sourcePublishRecordId: item.sourcePublishRecordId ?? null,
              sourceInteractionEventId: item.sourceInteractionEventId ?? null,
              enrichmentStatus: item.enrichmentStatus ?? undefined,
              identityConfidence: item.identityConfidence ?? undefined,
              missingFields: item.missingFields ?? [],
              createdAt: new Date(item.createdAt),
              updatedAt: new Date(item.updatedAt),
            },
            update: {
              tenantId: item.tenantId ?? null,
              platform: item.platform,
              sourceType: item.sourceType,
              sourceTaskId: item.sourceTaskId,
              sourceRunId: item.sourceRunId,
              // P0 复核（二次）：已转化线索保护——status/customerId 不被重跑覆盖
              // （防 converted 降级回 new/pending、customerId 被置空断链）。
              ...(preserveConverted
                ? {}
                : {
                    customerId: item.crmCustomerId ?? null,
                  }),
              nickname: item.nickname,
              profileUrl: item.profileUrl,
              avatarUrl: item.avatarUrl,
              externalUserId: item.externalUserId,
              sourceText: item.sourceText,
              sourceUrl: item.sourceUrl,
              videoTitle: item.videoTitle,
              videoUrl: item.videoUrl,
              commentTime: item.commentTime,
              matchedKeywords: item.matchedKeywords ?? [],
              score: item.score,
              scoreReasons: item.scoreReasons ?? [],
              ...(preserveConverted ? {} : { status: item.status }),
              nextFollowUpAt: item.nextFollowUpAt
                ? new Date(item.nextFollowUpAt)
                : undefined,
              ownerUserId: item.ownerUserId ?? undefined,
              notes: (item.notes ?? []) as unknown as Prisma.InputJsonValue,
              evidenceUrls: item.evidenceUrls ?? [],
              latestReply: item.latestReply,
              // P1-11 复核：update 同样对齐统一 dedupeKey + 补归因/质量字段
              dedupeKey,
              sourceAccountId: item.sourceAccountId ?? null,
              sourceArticleId: item.sourceArticleId ?? null,
              sourcePublishRecordId: item.sourcePublishRecordId ?? null,
              sourceInteractionEventId: item.sourceInteractionEventId ?? null,
              enrichmentStatus: item.enrichmentStatus ?? undefined,
              identityConfidence: item.identityConfidence ?? undefined,
              missingFields: item.missingFields ?? [],
              updatedAt: new Date(item.updatedAt),
            },
          });
        }
        // 激活事件（报告 16.3 第 1 项）：首个线索 = 首个价值。幂等旁路，失败不阻断。
        if (this.activation && store.leads.length > 0) {
          const firstLead = store.leads[0];
          const ownerId =
            firstLead.userId ||
            (this.authRequestContext?.get()?.user?.id ?? null);
          if (ownerId) {
            void this.activation
              .recordFirstValue({
                userId: ownerId,
                tenantId: firstLead.tenantId ?? null,
                eventType: 'first_lead',
                refId: firstLead.id,
              })
              .catch(() => {});
          }
        }
        for (const item of this.growthPersistenceItems(
          store.accountHealth,
          options,
          'accountHealth',
        )) {
          await tx.growthAccountHealth.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              userId: item.userId,
              tenantId: item.tenantId ?? null,
              platform: item.platform,
              accountId: item.accountId,
              accountName: item.accountName,
              loginStatus: item.loginStatus,
              todayActionCount: item.todayActionCount,
              failureRate: item.failureRate,
              riskStatus: item.riskStatus,
              cooldownUntil: item.cooldownUntil
                ? new Date(item.cooldownUntil)
                : undefined,
              recommendation: item.recommendation,
              lastCheckedAt: new Date(item.lastCheckedAt),
            },
            update: {
              tenantId: item.tenantId ?? null,
              accountName: item.accountName,
              loginStatus: item.loginStatus,
              todayActionCount: item.todayActionCount,
              failureRate: item.failureRate,
              riskStatus: item.riskStatus,
              cooldownUntil: item.cooldownUntil
                ? new Date(item.cooldownUntil)
                : undefined,
              recommendation: item.recommendation,
              lastCheckedAt: new Date(item.lastCheckedAt),
            },
          });
        }
        for (const item of this.growthPersistenceItems(
          store.workflows,
          options,
          'workflows',
        )) {
          await tx.growthWorkflow.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              userId: item.userId,
              tenantId: item.tenantId ?? null,
              name: item.name,
              template: item.template,
              industry: item.industry,
              scenario: item.scenario,
              status: item.status,
              steps: item.steps,
              currentStepId: item.currentStepId,
              lastAction: item.lastAction,
              lastActionAt: item.lastActionAt
                ? new Date(item.lastActionAt)
                : undefined,
              createdAt: new Date(item.createdAt),
              updatedAt: new Date(item.updatedAt),
            },
            update: {
              tenantId: item.tenantId ?? null,
              name: item.name,
              template: item.template,
              industry: item.industry,
              scenario: item.scenario,
              status: item.status,
              steps: item.steps,
              currentStepId: item.currentStepId,
              lastAction: item.lastAction,
              lastActionAt: item.lastActionAt
                ? new Date(item.lastActionAt)
                : undefined,
              updatedAt: new Date(item.updatedAt),
            },
          });
        }
      },
      { timeout: 60_000 },
    );
    if (
      !options.collections ||
      options.collections.includes('commercialAudits')
    ) {
      await this.saveCommercialAuditsToDatabase(
        this.growthPersistenceItems(
          store.commercialAudits,
          options,
          'commercialAudits',
        ),
      );
    }
  }

  private growthPersistenceItems<
    T extends { userId?: string; tenantId?: string },
  >(
    items: T[],
    options: GrowthPersistenceOptions,
    collection: GrowthStoreCollection,
  ) {
    if (options.collections && !options.collections.includes(collection)) {
      return [];
    }
    if (!options.scope) return items;
    return items.filter((item) => this.inGrowthScope(item, options.scope!));
  }

  private async deleteGrowthRecordsWithClient(
    tx: unknown,
    options: GrowthPersistenceOptions,
  ) {
    if (!options.scope || !options.deleteIds) return;
    const delegates: Partial<Record<GrowthStoreCollection, string>> = {
      strategies: 'growthStrategy',
      configs: 'growthAcquisitionConfig',
      runs: 'growthAcquisitionRun',
      leads: 'lead',
      accountHealth: 'growthAccountHealth',
      workflows: 'growthWorkflow',
    };
    const scopedWhere = options.scope.tenantId
      ? {
          OR: [
            { tenantId: options.scope.tenantId },
            { userId: options.scope.userId, tenantId: null },
          ],
        }
      : { userId: options.scope.userId };
    for (const [collection, ids] of Object.entries(options.deleteIds) as Array<
      [GrowthStoreCollection, string[] | undefined]
    >) {
      const delegateName = delegates[collection];
      if (!delegateName || !ids?.length) continue;
      const delegate = (tx as Record<string, unknown>)[delegateName] as
        { deleteMany?: (args: unknown) => Promise<unknown> } | undefined;
      await delegate?.deleteMany?.({
        where: {
          ...scopedWhere,
          id: { in: Array.from(new Set(ids)) },
        },
      });
    }
  }

  private async loadCommercialAuditsFromDatabase(): Promise<
    GrowthCommercialAuditRecord[]
  > {
    const prisma = this.prisma;
    if (!this.isSqliteGrowthDatabase() || !prisma.$queryRawUnsafe) return [];
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, user_id, tenant_id, action, status, runtime, accounts, plan, blockers, warnings, result, created_at
         FROM growth_commercial_audits
         ORDER BY created_at DESC
         LIMIT 200`,
      );
      if (!Array.isArray(rows)) return [];
      const typedRows = rows as Array<{
        id: string;
        user_id: string;
        tenant_id: string | null;
        action: string;
        status: string;
        runtime: unknown;
        accounts: unknown;
        plan: unknown;
        blockers: unknown;
        warnings: unknown;
        result: unknown;
        created_at: unknown;
      }>;
      return typedRows.map((item) => ({
        id: item.id,
        userId: item.user_id,
        tenantId: item.tenant_id || undefined,
        action: item.action as GrowthCommercialAuditAction,
        status: item.status as GrowthCommercialAuditRecord['status'],
        runtime: this.jsonObject(
          item.runtime,
        ) as GrowthCommercialAuditRecord['runtime'],
        accounts: this.jsonObject(
          item.accounts,
        ) as GrowthCommercialAuditRecord['accounts'],
        plan: this.jsonObject(item.plan) as GrowthCommercialAuditRecord['plan'],
        blockers: this.jsonArray(
          item.blockers,
        ) as GrowthCommercialAuditRecord['blockers'],
        warnings: this.jsonArray(
          item.warnings,
        ) as GrowthCommercialAuditRecord['warnings'],
        result: this.jsonObject(
          item.result,
        ) as GrowthCommercialAuditRecord['result'],
        createdAt: this.iso(item.created_at),
      }));
    } catch {
      return [];
    }
  }

  private async saveCommercialAuditsToDatabase(
    records: GrowthCommercialAuditRecord[],
  ) {
    const prisma = this.prisma;
    if (
      !records.length ||
      !this.isSqliteGrowthDatabase() ||
      !prisma.$executeRawUnsafe
    )
      return;
    try {
      for (const item of records.slice(0, 200)) {
        await prisma.$executeRawUnsafe(
          `INSERT OR REPLACE INTO growth_commercial_audits
            (id, user_id, tenant_id, action, status, runtime, accounts, plan, blockers, warnings, result, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id,
          item.userId,
          item.tenantId || null,
          item.action,
          item.status,
          JSON.stringify(item.runtime),
          JSON.stringify(item.accounts),
          JSON.stringify(item.plan),
          JSON.stringify(item.blockers),
          JSON.stringify(item.warnings),
          JSON.stringify(item.result),
          item.createdAt,
        );
      }
    } catch (error) {
      this.logger.warn(
        `增长商用审计记录落库失败，已保留文件快照：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async loadCommercialAuditsFromFile(
    fallback: GrowthCommercialAuditRecord[] = [],
  ): Promise<GrowthCommercialAuditRecord[]> {
    try {
      const raw = await readFile(this.storePath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<GrowthStore>;
      const fileRecords = Array.isArray(parsed.commercialAudits)
        ? parsed.commercialAudits
        : [];
      const byId = new Map<string, GrowthCommercialAuditRecord>();
      for (const item of [...fallback, ...fileRecords]) {
        if (item?.id) byId.set(item.id, item);
      }
      return Array.from(byId.values())
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 200);
    } catch {
      return fallback;
    }
  }

  private growthRuntimeUserIds(store: GrowthStore) {
    return Array.from(
      new Set(
        store.configs
          .filter((item) => this.isDaemonEligibleConfig(item))
          .map((item) => item.userId),
      ),
    ).filter(Boolean);
  }

  private async listGrowthSchedulerTargets(): Promise<GrowthSchedulerTarget[]> {
    const store = await this.loadStore();
    const scopedUsers: GrowthScope[] = [];
    for (const userId of this.growthRuntimeUserIds(store)) {
      const tenantId = await this.resolveGrowthTenantId(userId);
      if (tenantId && (await this.isDaemonCommercialTenant(tenantId))) {
        scopedUsers.push({ userId, tenantId });
      }
    }

    const selected = new Map<string, string>();
    for (const scope of scopedUsers) {
      const key = scope.tenantId
        ? `tenant:${scope.tenantId}`
        : `user:${scope.userId}`;
      if (!selected.has(key)) selected.set(key, scope.userId);
    }
    return Array.from(selected.entries()).map(([lockKey, userId]) => {
      const tenantId = lockKey.startsWith('tenant:')
        ? lockKey.slice('tenant:'.length)
        : undefined;
      return { lockKey, userId, tenantId };
    });
  }

  private isDaemonEligibleConfig(config: GrowthAcquisitionConfig) {
    return (
      config.status === 'enabled' &&
      config.scheduleEnabled === true &&
      config.riskMode === 'auto'
    );
  }

  private async isDaemonCommercialTenant(tenantId: string) {
    const delegate = this.prisma.tenantEntitlement;
    if (!delegate?.findFirst) return false;
    try {
      const entitlement = await delegate.findFirst({
        where: {
          tenantId,
          source: 'kaypal-subscription',
          status: 'active',
          commercialExecutionAllowed: true,
        },
        select: { id: true },
      });
      return Boolean(entitlement);
    } catch (error) {
      this.logger.warn(
        `增长调度商业授权读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async acquireGrowthSchedulerLease(target: GrowthSchedulerTarget) {
    const delegate = this.prisma.growthSchedulerLease;
    if (!delegate?.create || !delegate?.updateMany) {
      this.logger.warn(
        '增长调度 lease 表尚不可用，本轮跳过后台自动调度以避免多实例重复执行。',
      );
      return { acquired: false };
    }

    const now = new Date();
    const lockedUntil = new Date(
      now.getTime() + this.schedulerLeaseDurationMs(),
    );
    const data = {
      id: target.lockKey,
      tenantId: target.tenantId || null,
      userId: target.userId,
      ownerId: this.schedulerOwnerId,
      lockedUntil,
      heartbeatAt: now,
      cursor: {
        status: 'running',
        userId: target.userId,
        tenantId: target.tenantId || null,
        acquiredAt: now.toISOString(),
      },
      updatedAt: now,
    };

    try {
      await delegate.create({
        data: {
          ...data,
          createdAt: now,
        },
      });
      return { acquired: true, lockedUntil };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        this.logger.warn(
          `增长调度 lease 创建失败：${error instanceof Error ? error.message : String(error)}`,
        );
        return { acquired: false };
      }
    }

    try {
      const result = await delegate.updateMany({
        where: {
          id: target.lockKey,
          lockedUntil: { lt: now },
        },
        data,
      });
      return { acquired: result.count > 0, lockedUntil };
    } catch (error) {
      this.logger.warn(
        `增长调度 lease 接管失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return { acquired: false };
    }
  }

  private async releaseGrowthSchedulerLease(
    target: GrowthSchedulerTarget,
    status: 'success' | 'failed',
    message?: string,
  ) {
    const delegate = this.prisma.growthSchedulerLease;
    if (!delegate?.updateMany) return;
    const now = new Date();
    try {
      await delegate.updateMany({
        where: {
          id: target.lockKey,
          ownerId: this.schedulerOwnerId,
        },
        data: {
          userId: target.userId,
          tenantId: target.tenantId || null,
          lockedUntil: now,
          heartbeatAt: now,
          lastRunAt: now,
          cursor: {
            status,
            userId: target.userId,
            tenantId: target.tenantId || null,
            completedAt: now.toISOString(),
            message: message || null,
          },
          updatedAt: now,
        },
      });
    } catch (error) {
      this.logger.warn(
        `增长调度 lease 释放失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private startGrowthSchedulerLeaseHeartbeat(target: GrowthSchedulerTarget) {
    const intervalMs = Math.min(
      60_000,
      Math.max(10_000, Math.floor(this.schedulerLeaseDurationMs() / 3)),
    );
    const timer = setInterval(() => {
      void this.extendGrowthSchedulerLease(target);
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  private stopGrowthSchedulerLeaseHeartbeat(
    timer: ReturnType<typeof setInterval> | undefined,
  ) {
    if (timer) clearInterval(timer);
  }

  private async extendGrowthSchedulerLease(target: GrowthSchedulerTarget) {
    const delegate = this.prisma.growthSchedulerLease;
    if (!delegate?.updateMany) return;
    const now = new Date();
    try {
      await delegate.updateMany({
        where: {
          id: target.lockKey,
          ownerId: this.schedulerOwnerId,
        },
        data: {
          lockedUntil: new Date(
            now.getTime() + this.schedulerLeaseDurationMs(),
          ),
          heartbeatAt: now,
          cursor: {
            status: 'running',
            userId: target.userId,
            tenantId: target.tenantId || null,
            heartbeatAt: now.toISOString(),
          },
          updatedAt: now,
        },
      });
    } catch (error) {
      this.logger.warn(
        `增长调度 lease 续租失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async listGrowthSchedulerLeases(): Promise<
    GrowthRuntimeStatus['leases']
  > {
    const delegate = this.prisma.growthSchedulerLease;
    if (!delegate?.findMany) return [];
    const now = Date.now();
    try {
      const rows = await delegate.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 20,
      });
      return rows.map(
        (row: {
          id: string;
          userId: string;
          tenantId?: string | null;
          ownerId: string;
          lockedUntil: Date;
          heartbeatAt?: Date | null;
          lastRunAt?: Date | null;
          cursor?: unknown;
        }) => {
          const cursor =
            row.cursor && typeof row.cursor === 'object'
              ? (row.cursor as { status?: unknown; message?: unknown })
              : {};
          return {
            id: row.id,
            userId: row.userId,
            tenantId: row.tenantId || undefined,
            ownerId: row.ownerId,
            lockedUntil: row.lockedUntil.toISOString(),
            heartbeatAt: row.heartbeatAt?.toISOString(),
            lastRunAt: row.lastRunAt?.toISOString(),
            status:
              typeof cursor.status === 'string' ? cursor.status : 'unknown',
            message:
              typeof cursor.message === 'string' ? cursor.message : undefined,
            locked: row.lockedUntil.getTime() > now,
          };
        },
      );
    } catch (error) {
      this.logger.warn(
        `增长调度 lease 状态读取失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private schedulerLeaseDurationMs() {
    const value = Number(process.env.GROWTH_SCHEDULER_LEASE_MS || 5 * 60_000);
    return Number.isFinite(value) && value >= 30_000 ? value : 5 * 60_000;
  }

  private isGrowthSchedulerDaemonArmed() {
    return (
      process.env.GROWTH_EXECUTION_ENABLED === 'true' &&
      process.env.GROWTH_SCHEDULER_DAEMON === 'true' &&
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED === 'true'
    );
  }

  private isUniqueConstraintError(error: unknown) {
    return Boolean(
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'P2002',
    );
  }

  private normalizeStore(input: Partial<GrowthStore>): GrowthStore {
    return {
      version: STORE_VERSION,
      strategies: Array.isArray(input.strategies) ? input.strategies : [],
      configs: Array.isArray(input.configs) ? input.configs : [],
      runs: Array.isArray(input.runs) ? input.runs : [],
      leads: Array.isArray(input.leads) ? input.leads : [],
      accountHealth: Array.isArray(input.accountHealth)
        ? input.accountHealth
        : [],
      workflows: Array.isArray(input.workflows) ? input.workflows : [],
      commercialAudits: Array.isArray(input.commercialAudits)
        ? input.commercialAudits
        : [],
    };
  }

  private storePath() {
    return (
      process.env.GROWTH_STORE_PATH ||
      resolveProjectDataPath('growth', 'growth-store.json')
    );
  }

  private id(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  private dateKey(value = new Date()) {
    return value.toISOString().slice(0, 10);
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private iso(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    return new Date().toISOString();
  }

  private jsonList(value: unknown): string[] {
    if (Array.isArray(value))
      return value.map((item) => this.text(item)).filter(Boolean);
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed))
          return parsed.map((item) => this.text(item)).filter(Boolean);
      } catch {
        return this.list(value);
      }
    }
    return [];
  }

  private jsonArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private objectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isSqliteGrowthDatabase() {
    const databaseUrl = `${process.env.DATABASE_URL || process.env.SQLITE_DATABASE_URL || ''}`;
    return databaseUrl.startsWith('file:');
  }

  private list(value: unknown): string[] {
    if (Array.isArray(value))
      return value.map((item) => this.text(item)).filter(Boolean);
    if (typeof value === 'string')
      return value
        .split(/[,\n，、]/)
        .map((item) => item.trim())
        .filter(Boolean);
    return [];
  }

  private uniqueList(values: Array<string | undefined | null>) {
    return Array.from(
      new Set(values.map((item) => this.text(item)).filter(Boolean)),
    );
  }

  private number(value: unknown, fallback: number) {
    const next = Number(value);
    return Number.isFinite(next) && next >= 0 ? next : fallback;
  }

  private mode(value: unknown): GrowthAcquisitionMode {
    const text = this.text(value);
    if (
      [
        'keyword',
        'search-account',
        'video-link',
        'target-account',
        'retention',
        'manual-import',
        'recommended',
      ].includes(text)
    ) {
      return text as GrowthAcquisitionMode;
    }
    return 'keyword';
  }

  private platform(value: unknown): GrowthPlatform {
    const text = this.text(value);
    if (
      [
        'douyin',
        'wechat-channel',
        'wechat',
        'wecom',
        'xiaohongshu',
        'kuaishou',
      ].includes(text)
    ) {
      return text as GrowthPlatform;
    }
    return 'douyin';
  }

  private leadSourceType(value: unknown): GrowthLead['sourceType'] {
    const text = this.text(value);
    if (
      [
        'auto-acquisition',
        'redfox-intelligence',
        'comment',
        'direct-message',
        'wechat-group',
        'wechat-moments',
        'manual-import',
      ].includes(text)
    ) {
      return text as GrowthLead['sourceType'];
    }
    return 'manual-import';
  }

  private platformFromAccount(
    platform: unknown,
    type?: unknown,
  ): GrowthPlatform {
    const raw = this.text(platform).toLowerCase();
    if (/抖音|douyin|dy/.test(raw) || Number(type) === 3) return 'douyin';
    if (/视频号|wechat-channel|channel/.test(raw) || Number(type) === 2)
      return 'wechat-channel';
    if (/小红书|xiaohongshu|xhs/.test(raw) || Number(type) === 1)
      return 'xiaohongshu';
    if (/快手|kuaishou|ks/.test(raw)) return 'kuaishou';
    if (/企微|wecom/.test(raw)) return 'wecom';
    if (/微信|wechat/.test(raw)) return 'wechat';
    return 'douyin';
  }

  private riskMode(value: unknown): GrowthRiskMode {
    const text = this.text(value);
    if (['auto', 'confirm-first', 'draft-only'].includes(text))
      return text as GrowthRiskMode;
    return 'confirm-first';
  }

  private leadStatus(value: unknown): GrowthLead['status'] | null {
    const text = this.text(value);
    if (
      [
        'new',
        'contacted',
        'replied',
        'qualified',
        'converted',
        'ignored',
        'blocked',
      ].includes(text)
    ) {
      return text as GrowthLead['status'];
    }
    return null;
  }

  private runStatus(value: unknown): GrowthRunStatus {
    const text = this.text(value);
    if (
      ['queued', 'running', 'success', 'partial', 'failed', 'skipped'].includes(
        text,
      )
    ) {
      return text as GrowthRunStatus;
    }
    return 'failed';
  }

  private loginStatus(value: unknown): GrowthAccountHealth['loginStatus'] {
    const text = this.text(value);
    if (
      ['unknown', 'online', 'expired', 'verification-required'].includes(text)
    ) {
      return text as GrowthAccountHealth['loginStatus'];
    }
    return 'unknown';
  }

  private healthRiskStatus(value: unknown): GrowthAccountHealth['riskStatus'] {
    const text = this.text(value);
    if (['normal', 'cooldown', 'paused', 'needs-human'].includes(text)) {
      return text as GrowthAccountHealth['riskStatus'];
    }
    return 'normal';
  }

  private workflowStatus(value: unknown): GrowthWorkflowStatus {
    const text = this.text(value);
    if (
      ['draft', 'enabled', 'running', 'paused', 'completed', 'failed'].includes(
        text,
      )
    ) {
      return text as GrowthWorkflowStatus;
    }
    return 'draft';
  }

  private taskStatus(value: unknown): GrowthTaskStatus {
    const text = this.text(value);
    if (['enabled', 'disabled', 'running'].includes(text)) {
      return text as GrowthTaskStatus;
    }
    return 'disabled';
  }

  private failureReason(
    value: unknown,
  ): GrowthExecutionFailureReason | undefined {
    const text = this.text(value);
    if (
      [
        'engine_unavailable',
        'account_not_logged_in',
        'account_risk_control',
        'captcha_required',
        'target_not_found',
        'editor_missing',
        'send_button_missing',
        'send_failed',
        'readback_failed',
        'daily_limit_reached',
        'duplicate_target',
        'content_policy_blocked',
        'platform_structure_changed',
      ].includes(text)
    ) {
      return text as GrowthExecutionFailureReason;
    }
    return undefined;
  }

  private scoreText(text: string) {
    const rules = [
      {
        label: '明确需求词',
        keywords: ['想', '需要', '求推荐', '多少钱', '预算', '哪里', '本地'],
        score: 28,
      },
      {
        label: '高紧急度',
        keywords: ['马上', '最近', '今天', '急', '下周'],
        score: 18,
      },
      {
        label: '留资倾向',
        keywords: ['微信', '电话', '私信', '联系'],
        score: 20,
      },
      {
        label: '行业相关',
        keywords: ['装修', '开店', '加盟', '课程', '美业', '搬家', '维修'],
        score: 14,
      },
    ];
    const reasons: string[] = [];
    let score = 45;
    for (const rule of rules) {
      if (rule.keywords.some((keyword) => text.includes(keyword))) {
        score += rule.score;
        reasons.push(rule.label);
      }
    }
    return {
      score: Math.min(100, score),
      reasons: reasons.length ? reasons : ['基础意向线索'],
    };
  }

  private createInitialLeadNotes(
    userId: string,
    input: QueryInput,
  ): GrowthLeadNote[] {
    const note = this.text(input.followUpNote || input.noteText);
    if (!note) return [];
    return [
      {
        id: this.id('note'),
        text: note,
        type: 'follow-up',
        createdAt: new Date().toISOString(),
        createdBy: userId,
      },
    ];
  }

  private duplicateScore(
    source: Pick<
      GrowthLead,
      | 'nickname'
      | 'profileUrl'
      | 'externalUserId'
      | 'sourceText'
      | 'platform'
      | 'matchedKeywords'
    >,
    target: Pick<
      GrowthLead,
      | 'nickname'
      | 'profileUrl'
      | 'externalUserId'
      | 'sourceText'
      | 'platform'
      | 'matchedKeywords'
    >,
  ) {
    let score = 0;
    if (source.platform === target.platform) score += 10;
    if (
      source.externalUserId &&
      source.externalUserId === target.externalUserId
    )
      score += 80;
    if (source.profileUrl && source.profileUrl === target.profileUrl)
      score += 80;
    if (source.nickname && source.nickname === target.nickname) score += 35;
    if (
      this.dedupeText([source.sourceText]) ===
      this.dedupeText([target.sourceText])
    )
      score += 30;
    const sourceKeywords = new Set(source.matchedKeywords || []);
    const sharedKeywords = (target.matchedKeywords || []).filter((keyword) =>
      sourceKeywords.has(keyword),
    );
    score += Math.min(20, sharedKeywords.length * 5);
    return Math.min(100, score);
  }

  private duplicateReasons(
    source: Pick<
      GrowthLead,
      | 'nickname'
      | 'profileUrl'
      | 'externalUserId'
      | 'sourceText'
      | 'platform'
      | 'matchedKeywords'
    >,
    target: Pick<
      GrowthLead,
      | 'nickname'
      | 'profileUrl'
      | 'externalUserId'
      | 'sourceText'
      | 'platform'
      | 'matchedKeywords'
    >,
  ) {
    const reasons: string[] = [];
    if (source.platform === target.platform) reasons.push('同平台');
    if (
      source.externalUserId &&
      source.externalUserId === target.externalUserId
    )
      reasons.push('外部用户 ID 一致');
    if (source.profileUrl && source.profileUrl === target.profileUrl)
      reasons.push('主页链接一致');
    if (source.nickname && source.nickname === target.nickname)
      reasons.push('昵称一致');
    if (
      this.dedupeText([source.sourceText]) ===
      this.dedupeText([target.sourceText])
    )
      reasons.push('来源原文高度一致');
    const sourceKeywords = new Set(source.matchedKeywords || []);
    const sharedKeywords = (target.matchedKeywords || []).filter((keyword) =>
      sourceKeywords.has(keyword),
    );
    if (sharedKeywords.length)
      reasons.push(`共享关键词：${sharedKeywords.slice(0, 4).join('、')}`);
    return reasons.length ? reasons : ['系统相似度命中'];
  }

  private dedupeText(parts: Array<string | undefined>) {
    return parts.filter(Boolean).join('|').toLowerCase().replace(/\s+/g, '');
  }

  private defaultIndustryTemplate(industry: string, scenario: string) {
    const keywordMap: Record<string, string[]> = {
      装修: ['装修', '旧房翻新', '全屋定制', '设计师', '本地装修'],
      餐饮: ['开店', '加盟', '探店', '外卖', '选址'],
      教育: ['补课', '升学', '考研', '职业培训'],
      美业: ['皮肤管理', '医美', '美甲', '祛痘'],
    };
    const sourceKeywords = keywordMap[industry] || [
      '本地服务',
      '客户需求',
      '求推荐',
      '多少钱',
    ];
    return {
      industry,
      scenario,
      name: `${industry}${scenario}策略`,
      sourceKeywords,
      demandKeywords: ['求推荐', '多少钱', '哪里靠谱', '有没有人做过'],
      excludeKeywords: ['招聘', '教程', '同行', '广告'],
      blacklistNicknames: ['官方旗舰店', '招商中心'],
      commentTemplates: [
        '我这边刚好整理过这类问题，可以给你一个参考。',
        '这个要看你的具体情况，方便的话我可以帮你拆一下。',
        '你这个需求挺典型的，先别急着下决定，可以先对比几个关键点。',
      ],
      privateMessageTemplates: [
        '你好，看到你刚才在关注这个问题，我可以给你发个简单参考。',
      ],
      defaultDailyLimit: 20,
      defaultRiskMode: 'confirm-first',
      scoringRules: [
        { label: '需求明确', keywords: ['想', '需要', '求推荐'], score: 25 },
        { label: '价格敏感', keywords: ['多少钱', '预算', '贵吗'], score: 18 },
      ],
    };
  }

  private modeLabel(mode: GrowthAcquisitionMode) {
    return {
      keyword: '关键词获客',
      'search-account': '搜索账号获客',
      'video-link': '视频链接获客',
      'target-account': '目标账号获客',
      retention: '留资线索获客',
      'manual-import': '手动导入获客',
      recommended: '推荐流获客',
    }[mode];
  }

  private platformLabel(platform: GrowthPlatform) {
    return {
      douyin: '抖音',
      'wechat-channel': '视频号',
      wechat: '微信',
      wecom: '企微',
      xiaohongshu: '小红书',
      kuaishou: '快手',
    }[platform];
  }
  // ============ 曝光账号管理（对标炼刀 /auto/exposure/accounts） ============

  // 租户隔离（P0-3 修复 2026-08-17）：曝光账号按 userId 隔离
  async listExposureAccounts(userId: string) {
    return this.prisma.exposureAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createExposureAccount(
    userId: string,
    input: {
      platform?: string;
      accountId: string;
      name: string;
      note?: string;
    },
  ) {
    const accountId = input.accountId?.trim();
    const name = input.name?.trim();
    if (!accountId || !name) {
      throw new BadRequestException('账号 ID 与名称不能为空');
    }
    const platform = input.platform ?? 'douyin';
    return this.prisma.exposureAccount.upsert({
      where: {
        userId_platform_accountId: {
          userId,
          platform,
          accountId,
        },
      },
      create: {
        userId,
        platform,
        accountId,
        name,
        note: input.note ?? null,
      },
      update: { name, note: input.note ?? null },
    });
  }

  async setExposureAccountStatus(userId: string, id: string, status: string) {
    const account = await this.prisma.exposureAccount.findFirst({
      where: { id, userId },
    });
    if (!account) throw new NotFoundException('曝光账号不存在');
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException('状态只能是 active / disabled');
    }
    return this.prisma.exposureAccount.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
  }

  async removeExposureAccount(userId: string, id: string) {
    const account = await this.prisma.exposureAccount.findFirst({
      where: { id, userId },
    });
    if (!account) throw new NotFoundException('曝光账号不存在');
    await this.prisma.exposureAccount.delete({ where: { id } });
    return { id, deleted: true };
  }
  // ============ 曝光扩展（对标炼刀 /auto/exposure/*） ============

  /** 评论扩散：读取链接下的评论候选（等价炼刀 comment_expand；复用 ai-employee 链接线索读取） */
  async commentExpand(input: { url: string; limit?: number }) {
    const url = input.url?.trim();
    if (!url) throw new BadRequestException('链接不能为空');
    const result = await this.aiEmployeeService.findDouyinLeadsByLink({
      link: url,
      limit: input.limit ?? 10,
    });
    return result;
  }

  /** 文案扩展：生成多个口语化变体（等价炼刀 filed-copy-expansions；确定性模板，AI 增强由上层可选） */
  expandCopy(input: { text: string; count?: number }) {
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('文案不能为空');
    const count = Math.min(Math.max(input.count ?? 3, 1), 8);
    const variants: string[] = [text];
    const openers = [
      '',
      '家人们，',
      '真的没想到，',
      '必须分享一下，',
      '最近发现，',
    ];
    const closers = [
      '',
      ' 感兴趣可以评论区聊聊。',
      ' 有需要的朋友扣1。',
      ' 你们觉得怎么样？',
    ];
    let guard = 0;
    while (variants.length < count && guard < 40) {
      guard++;
      const opener = openers[Math.floor(Math.random() * openers.length)];
      const closer = closers[Math.floor(Math.random() * closers.length)];
      const variant = `${opener}${text}${closer}`.trim();
      if (!variants.includes(variant) && variant !== text) {
        variants.push(variant);
      }
    }
    return { original: text, variants: variants.slice(0, count) };
  }

  /** 曝光记录（等价炼刀 psg/record/list）：查询曝光类任务的执行记录 */
  async listExposureRecords(userId: string, limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    // P1 复核（全面审查）：加 userId scope——原裸查 taskType 导致跨用户读取执行记录
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { taskType: { contains: 'exposure' }, userId },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows.map((row) => ({
      id: row.id,
      taskType: row.taskType,
      status: row.status,
      createdAt: row.createdAt,
      summary: null,
      diagnostics: null,
    }));
  }

  /**
   * 线索评分历史（Sprint 4 T4.4/T2.6 桥接）：
   * GrowthLead（JSON store）→ 按 dedupeKey 定位统一 Lead → 返回 LeadScoreSnapshot 倒序。
   * 无对应统一 Lead（未走评分）→ available:false，前端显示「尚未评分」而非 0 分。
   */
  async getLeadScoreHistory(userId: string, leadId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const item = store.leads.find((l) =>
      this.sameGrowthRecord(l, scope, leadId),
    );
    if (!item) throw new NotFoundException('线索不存在');

    const lead = await this.findUnifiedLead(userId, item);
    if (!lead) {
      return {
        available: false,
        snapshots: [],
        message: '该线索尚未接入统一评分（未走 LeadScoreService）',
      };
    }

    const snapshots = await this.prisma.leadScoreSnapshot.findMany({
      where: { leadId: lead.id },
      orderBy: { scoredAt: 'desc' },
      take: 50,
    });
    return {
      available: true,
      leadId: lead.id,
      // 裸分（采集印象）与质量分（四维 totalScore）并存：totalScore 取最新快照，roughScore 取 lead.score
      totalScore: snapshots[0]?.totalScore ?? 0,
      roughScore: lead.score ?? 0,
      snapshots: snapshots.map((s) => ({
        id: s.id,
        scoredAt: s.scoredAt,
        totalScore: s.totalScore,
        fitScore: s.fitScore,
        intentScore: s.intentScore,
        identityConfidence: s.identityConfidence,
        riskScore: s.riskScore,
        confidence: s.confidence,
        components: s.components,
        reasons: s.reasons,
        evidenceIds: s.evidenceIds,
        modelVersion: s.modelVersion,
        ruleVersion: s.ruleVersion,
      })),
    };
  }

  /** T4-6：让 AI 重新评一次——真实触发统一评分（scoreAndPersist 生成新快照），
   * 返回新 totalScore 与快照 id。无统一 Lead / 无评分服务时返回 available:false。 */
  async rescoreLead(userId: string, leadId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const item = store.leads.find((l) =>
      this.sameGrowthRecord(l, scope, leadId),
    );
    if (!item) throw new NotFoundException('线索不存在');
    if (!this.leadScoreService) {
      return { available: false, message: '评分服务未启用' };
    }
    const lead = await this.findUnifiedLead(userId, item);
    if (!lead) {
      return {
        available: false,
        message: '该线索尚未接入统一评分（未走 LeadScoreService）',
      };
    }
    const tenantId = lead.tenantId ?? scope.tenantId;
    if (!tenantId) {
      return { available: false, message: '无法定位租户，暂不支持重评' };
    }
    const snapshot = await this.leadScoreService.scoreAndPersist({
      tenantId,
      userId,
      leadId: lead.id,
    });
    return {
      available: true,
      snapshotId: snapshot.snapshotId,
      totalScore: snapshot.totalScore,
      components: snapshot.components,
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * 线索归因链（Sprint 4 T4.3 展示桥接）：
   * GrowthLead → 统一 Lead → 四层归因（confirmed/rule_matched/inferred/unknown）。
   */
  async getLeadAttribution(userId: string, leadId: string) {
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    const item = store.leads.find((l) =>
      this.sameGrowthRecord(l, scope, leadId),
    );
    if (!item) throw new NotFoundException('线索不存在');

    const lead = await this.findUnifiedLead(userId, item);
    if (!lead) {
      return {
        layer: 'unknown',
        hops: [],
        lead: {
          sourceArticleId: null,
          sourcePublishRecordId: null,
          sourceInteractionEventId: null,
          sourceUrl: item.sourceUrl ?? null,
        },
      };
    }

    // 主键直连链（deterministic 层）
    const hops: Array<{
      fromType: string;
      fromId: string;
      toType: string;
      toId: string;
      model: string;
      label: string | null;
    }> = [];
    if (lead.sourceInteractionEventId) {
      hops.push({
        fromType: 'interaction',
        fromId: lead.sourceInteractionEventId,
        toType: 'lead',
        toId: lead.id,
        model: 'deterministic',
        label: 'created_from',
      });
    } else if (lead.sourcePublishRecordId) {
      hops.push({
        fromType: 'publish',
        fromId: lead.sourcePublishRecordId,
        toType: 'lead',
        toId: lead.id,
        model: 'deterministic',
        label: 'created_from',
      });
    } else if (lead.sourceArticleId) {
      hops.push({
        fromType: 'content',
        fromId: lead.sourceArticleId,
        toType: 'lead',
        toId: lead.id,
        model: 'deterministic',
        label: 'created_from',
      });
    }
    if (lead.customerId) {
      hops.push({
        fromType: 'lead',
        fromId: lead.id,
        toType: 'customer',
        toId: lead.customerId,
        model: 'deterministic',
        label: 'qualified_by',
      });
      const opp = await this.prisma.crmOpportunity.findFirst({
        where: {
          ownerId: userId,
          primaryCustomerId: lead.customerId,
          archivedAt: null,
        },
        select: { id: true, stage: true },
      });
      if (opp) {
        hops.push({
          fromType: 'customer',
          fromId: lead.customerId,
          toType: 'opportunity',
          toId: opp.id,
          model: 'deterministic',
          label: 'created_from',
        });
      }
    }

    // 无主键直连 → 查 AttributionLink（rule_based/inferred 层）
    const layer: 'confirmed' | 'rule_matched' | 'inferred' | 'unknown' =
      hops.length > 0 ? 'confirmed' : 'unknown';
    if (hops.length === 0) {
      const links = await this.prisma.attributionLink.findMany({
        where: { userId, toType: 'lead', toId: lead.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      if (links.length > 0) {
        const models = links.map((l) => l.model);
        return {
          layer: models.includes('rule_based') ? 'rule_matched' : 'inferred',
          hops: links.map((l) => ({
            fromType: l.fromType,
            fromId: l.fromId,
            toType: l.toType,
            toId: l.toId,
            model: l.model,
            label: l.label,
          })),
          lead: {
            sourceArticleId: lead.sourceArticleId,
            sourcePublishRecordId: lead.sourcePublishRecordId,
            sourceInteractionEventId: lead.sourceInteractionEventId,
            sourceUrl: lead.sourceUrl,
          },
        };
      }
    }

    return {
      layer,
      hops,
      lead: {
        sourceArticleId: lead.sourceArticleId,
        sourcePublishRecordId: lead.sourcePublishRecordId,
        sourceInteractionEventId: lead.sourceInteractionEventId,
        sourceUrl: lead.sourceUrl,
      },
    };
  }

  /** 按 dedupeKey 定位统一 Lead（GrowthLead → Lead 桥接） */
  private async findUnifiedLead(
    userId: string,
    item: {
      platform: string;
      externalUserId?: string | null;
      nickname?: string | null;
      sourceText?: string | null;
      tenantId?: string | null;
    },
  ) {
    // P1 复核（审查 #9）：统一调用 LeadRepository.dedupeKeyOf——原内联第三份算法
    // 与 dedupeKeyOf 文本一致但重复实现，防再漂移
    const dedupeKey = LeadRepository.dedupeKeyOf(item);
    if (item.tenantId) {
      return this.prisma.lead.findUnique({
        where: { tenantId_dedupeKey: { tenantId: item.tenantId, dedupeKey } },
      });
    }
    return this.prisma.lead.findUnique({
      where: { userId_dedupeKey: { userId, dedupeKey } },
    });
  }
}
