import {
  BadRequestException,
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
import { industryPlaybook, listWorkflowPlaybooks } from './growth-playbooks.data';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import {
  AiEmployeeService,
  type AutoAcquisitionBillingRecord,
  type DouyinFollowUpCandidateInput,
} from '../ai-employee/ai-employee.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import { CrmService } from '../crm/crm.service';
import {
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
  raw?: unknown;
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

  constructor(
    private readonly aiEmployeeService: AiEmployeeService,
    private readonly autoUploadService: AutoUploadService,
    private readonly prisma: PrismaService,
    private readonly runtime: RuntimeOrchestrator,
    @Optional() private readonly crmService?: CrmService,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
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
      status: input.status === 'disabled' ? 'disabled' : 'enabled',
      exposureCount: 0,
      exposureDate: this.dateKey(),
      createdAt: now,
      updatedAt: now,
    };
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
      status:
        input.status === undefined
          ? existing.status
          : input.status === 'disabled'
            ? 'disabled'
            : 'enabled',
      updatedAt: new Date().toISOString(),
    };
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
    options: { confirmedExecution?: boolean } = {},
  ) {
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
        status: 'skipped',
        message: '当天触达次数已达到上限',
        failureReason: 'daily_limit_reached',
        candidateCount: 0,
        selectedCount: 0,
        contactedCount: 0,
      });
    }

    const executionCapability =
      this.growthAutoExecutionCapability(normalizedConfig);
    if (!executionCapability.ready) {
      return this.createRunResult(normalizedConfig, {
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
        options.confirmedExecution === true);
    if (!executionEnabled || !executionApproved) {
      return this.createRunResult(normalizedConfig, {
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

    try {
      const candidateResponse = await this.fetchCandidatesWithAiEmployee(
        normalizedConfig,
        remaining,
      );
      const candidates = Array.isArray(candidateResponse.candidates)
        ? candidateResponse.candidates
        : [];
      const candidateEvidenceUrls = this.evidenceUrls(
        candidateResponse.evidence,
      );
      if (!candidates.length) {
        return this.createRunResult(normalizedConfig, {
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
          leads,
        });
      }

      // planDouyinFollowUp 是 async（必须 await，否则拿到 Promise 导致 targets undefined）
      const followUpPlan = await this.aiEmployeeService.planDouyinFollowUp({
        candidates,
        sourceLabel: this.platformLabel(normalizedConfig.platform),
        sourceText:
          normalizedConfig.sourceInputs.join('、') || normalizedConfig.taskName,
        accountName: normalizedConfig.accountName || normalizedConfig.accountId,
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
      });
      if (!followUpPlan.targets.length) {
        return this.createRunResult(normalizedConfig, {
          status: 'skipped',
          failureReason: 'target_not_found',
          message:
            followUpPlan.summary.nextAction ||
            '候选线索未达到跟进条件，已跳过本次执行。',
          candidateCount: candidates.length,
          selectedCount: 0,
          contactedCount: 0,
          evidenceUrls: candidateEvidenceUrls,
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
        status: this.followUpStatusToRunStatus(execution.status),
        failureReason,
        message: execution.message,
        candidateCount: candidates.length,
        selectedCount: followUpPlan.targets.length,
        contactedCount: successCount,
        evidenceUrls: executionEvidenceUrls,
        leadIds: leads.map((lead) => lead.id),
        leads,
      });
    } catch (error) {
      return this.createRunResult(normalizedConfig, {
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
        return (
          executionEnabled &&
          item.status === 'ready' &&
          config?.riskMode === 'auto'
        );
      })
      .slice(0, limit);
    const results: Array<{
      config: GrowthAcquisitionConfig;
      run: GrowthAcquisitionRun;
      leads: GrowthLead[];
    }> = [];
    for (const item of readyItems) {
      results.push(await this.executeConfig(userId, item.configId));
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
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.runs.filter(
      (item) =>
        this.inGrowthScope(item, scope) &&
        (!configId || item.configId === configId),
    );
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

  async listLeads(userId: string, query: QueryInput = {}) {
    const status = this.text(query.status);
    const platform = this.text(query.platform);
    const q = this.text(query.q).toLowerCase();
    const store = await this.loadStore();
    const scope = await this.growthScope(userId);
    return store.leads.filter((item) => {
      if (!this.inGrowthScope(item, scope)) return false;
      if (status && status !== 'all' && item.status !== status) return false;
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
    });
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
    if (!this.crmService) throw new BadRequestException('CRM 服务未接入');
    const store = await this.loadStore();
    const scope: GrowthScope = membership;
    const existing = store.leads.find((item) =>
      this.sameGrowthRecord(item, scope, id),
    );
    if (!existing) throw new NotFoundException('线索不存在');

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
      return [...live, ...taskBlockers, ...scopedPersistedFallbacks];
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
      todayCrmCapturedCount: runs.reduce(
        (total, run) => total + run.crmCapturedCount,
        0,
      ),
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
        crmCaptured: runs.reduce(
          (total, run) => total + run.crmCapturedCount,
          0,
        ),
        converted: leads.filter((lead) => lead.status === 'converted').length,
      },
      recentRuns: runs.slice(0, 8),
      hotStrategies: store.strategies
        .filter((strategy) => this.inGrowthScope(strategy, scope))
        .slice(0, 6),
    };
    const copywriting = this.copywritingReport(leads);
    return {
      overview,
      funnel: overview.funnel,
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
    const playbook = industry ? industryPlaybook(industry, scenario || undefined) : undefined;
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
  async listWorkflowPlaybooks() {
    return listWorkflowPlaybooks();
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
          dependencies: Array.isArray(step.dependencies) ? step.dependencies : [],
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
        outputSummary:
          result.summary || '人工确认，已继续执行',
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
    const executionEnabled =
      process.env.GROWTH_EXECUTION_ENABLED === 'true';
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
            await this.applyWorkflowAction(workflow.userId, workflow.id, 'await-confirmation', {
              stepId: step.id,
            });
            continue;
          }
          // auto 步骤：执行真实动作（若有），完成并推进下一步
          const result = await this.executeWorkflowStepAction(workflow, step);
          if (result.error) {
            await this.applyWorkflowAction(workflow.userId, workflow.id, 'fail', {
              stepId: step.id,
              outputSummary: `执行失败：${result.error}`,
            });
            continue;
          }
          await this.applyWorkflowAction(workflow.userId, workflow.id, 'advance', {
            stepId: step.id,
            outputSummary:
              result.summary ||
              (result.executed ? '步骤执行完成' : '步骤完成（无自动执行动作）'),
          });
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
    leads = await this.captureRunLeadsToCrm(config, run, leads);
    run.leadIds = input.leadIds || leads.map((lead) => lead.id);
    const latestStore = await this.loadStore();
    const scope: GrowthScope = { userId: config.userId, tenantId };
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

  private async captureRunLeadsToCrm(
    config: GrowthAcquisitionConfig,
    run: GrowthAcquisitionRun,
    leads: GrowthLead[],
  ) {
    if (!this.crmService || !leads.length || run.contactedCount <= 0) {
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
          `增长线索同步 CRM 失败：${error instanceof Error ? error.message : String(error)}`,
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

  private isCrmCaptureEligibleLead(lead: GrowthLead) {
    return ['contacted', 'replied', 'qualified', 'converted'].includes(
      lead.status,
    );
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
    if (config.platform !== 'douyin') {
      return this.fetchCandidatesWithPlatformAdapter(config);
    }
    if (config.mode === 'search-account') {
      return this.aiEmployeeService.findDouyinLeadsByKeyword({
        accountId: config.accountId,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
        nicknameKeywords: config.includeKeywords,
        blacklistNicknames: config.blacklistNicknames,
      }) as Promise<AiEmployeeLeadResponse>;
    }
    if (config.mode === 'video-link') {
      return this.aiEmployeeService.findDouyinLeadsByLink({
        accountId: config.accountId,
        link: primaryInput,
        limit,
        commentTimeMatch: '7days',
      }) as Promise<AiEmployeeLeadResponse>;
    }
    if (config.mode === 'target-account') {
      return this.aiEmployeeService.findDouyinTargetedLeads({
        accountId: config.accountId,
        targetAccounts: config.sourceInputs,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
        perTargetLimit: config.perTargetLimit,
      }) as Promise<AiEmployeeLeadResponse>;
    }
    if (config.mode === 'retention') {
      return this.aiEmployeeService.findDouyinRetentionLeads({
        accountId: config.accountId,
        retentionSourceId: primaryInput,
        keyword: primaryInput,
        limit,
        commentTimeMatch: '7days',
      }) as Promise<AiEmployeeLeadResponse>;
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
    }) as Promise<AiEmployeeLeadResponse>;
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
    throw new BadRequestException(
      `${this.platformLabel(config.platform)} 自动触达执行器尚未接入，请使用人工确认或草稿模式。`,
    );
  }

  private douyinExposureCapability(mode: GrowthAcquisitionMode) {
    const capabilities = {
      keyword: 'douyin-hot-video-exposure',
      'search-account': 'douyin-search-account-exposure',
      'video-link': 'douyin-link-exposure',
      'target-account': 'douyin-targeted-exposure',
      retention: 'douyin-retention-exposure',
      'manual-import': 'douyin-hot-video-exposure',
    } as const;
    return capabilities[mode];
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
        const task: ExecutorTask = {
          relatedId: `growth-wechat-channel-${Date.now()}-${index}`,
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
    } as unknown as AiEmployeeFollowUpExecution;
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
      sourceTaskId: config.id,
      nickname:
        candidate.targetName ||
        `${this.platformLabel(config.platform)}线索${index + 1}`,
      profileUrl: candidate.profileUrl,
      sourceText,
      sourceUrl: candidate.sourceUrl,
      videoTitle: candidate.videoTitle,
      videoUrl: candidate.videoUrl,
      commentTime: candidate.commentTime,
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
    };
  }

  private applyExecutionToLeads(
    leads: GrowthLead[],
    execution: AiEmployeeFollowUpExecution,
  ) {
    const results = execution.results || [];
    for (const lead of leads) {
      const matches = results.filter(
        (item) =>
          item.targetName === lead.nickname ||
          item.targetText === lead.sourceText ||
          lead.sourceText.includes(item.targetText || ''),
      );
      if (!matches.length) continue;
      lead.status = matches.some((item) => item.ok) ? 'contacted' : 'blocked';
      lead.evidenceUrls = Array.from(
        new Set([
          ...lead.evidenceUrls,
          ...matches.flatMap((item) => this.evidenceUrls(item.evidence)),
        ]),
      );
      const successfulReply = matches.find((item) => item.ok)?.replyText;
      if (successfulReply) lead.latestReply = successfulReply;
      lead.updatedAt = new Date().toISOString();
    }
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
      const text = lead.latestReply || '未记录话术';
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
    return Array.from(map.values()).map((item) => ({
      ...item,
      averageLeadScore: item.usageCount
        ? Math.round(item.leadScoreTotal / item.usageCount)
        : 0,
      contactRate: item.usageCount
        ? Number((item.contactedCount / item.usageCount).toFixed(2))
        : 0,
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
          (config.riskMode !== 'auto' ||
            process.env.GROWTH_EXECUTION_ENABLED !== 'true')
        ) {
          status = 'waiting-confirmation';
          reason =
            config.riskMode === 'auto'
              ? '真实执行开关未开启，当前只能进入安全预检确认单。'
              : '任务配置为人工确认或草稿模式，需要人工复核，不会被后台自动执行。';
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

    return {
      ready: false,
      reason: `${this.platformLabel(config.platform)}当前仅支持账号纳管和发布前检查，增长自动触达执行器未接入；不能加入后台自动获客执行。`,
    };
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
      runs: runs.map((item) => ({
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
      })),
      leads: leads.map((item) => ({
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
        notes: (Array.isArray(item.notes)
          ? item.notes
          : []) as unknown as GrowthLeadNote[],
        evidenceUrls: this.jsonList(item.evidenceUrls),
        latestReply: item.latestReply ?? undefined,
        createdAt: this.iso(item.createdAt),
        updatedAt: this.iso(item.updatedAt),
      })),
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

  private async saveStoreToDatabase(
    store: GrowthStore,
    options: GrowthPersistenceOptions = {},
  ) {
    await this.prisma.$transaction(async (tx) => {
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
        await tx.lead.upsert({
          where: { id: item.id },
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
            matchedKeywords: (item.matchedKeywords ??
              []) as Prisma.InputJsonValue,
            score: item.score,
            scoreReasons: (item.scoreReasons ??
              []) as Prisma.InputJsonValue,
            status: item.status,
            nextFollowUpAt: item.nextFollowUpAt
              ? new Date(item.nextFollowUpAt)
              : undefined,
            ownerUserId: item.ownerUserId ?? undefined,
            notes: (item.notes ?? []) as unknown as Prisma.InputJsonValue,
            evidenceUrls: (item.evidenceUrls ??
              []) as Prisma.InputJsonValue,
            latestReply: item.latestReply,
            dedupeKey: `lead:growth:${item.id}`,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          },
          update: {
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
            matchedKeywords: (item.matchedKeywords ??
              []) as Prisma.InputJsonValue,
            score: item.score,
            scoreReasons: (item.scoreReasons ??
              []) as Prisma.InputJsonValue,
            status: item.status,
            nextFollowUpAt: item.nextFollowUpAt
              ? new Date(item.nextFollowUpAt)
              : undefined,
            ownerUserId: item.ownerUserId ?? undefined,
            notes: (item.notes ?? []) as unknown as Prisma.InputJsonValue,
            evidenceUrls: (item.evidenceUrls ??
              []) as Prisma.InputJsonValue,
            latestReply: item.latestReply,
            updatedAt: new Date(item.updatedAt),
          },
        });
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
    });
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
        | { deleteMany?: (args: unknown) => Promise<unknown> }
        | undefined;
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

  async listExposureAccounts() {
    return this.prisma.exposureAccount.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createExposureAccount(input: {
    platform?: string;
    accountId: string;
    name: string;
    note?: string;
  }) {
    const accountId = input.accountId?.trim();
    const name = input.name?.trim();
    if (!accountId || !name) {
      throw new BadRequestException('账号 ID 与名称不能为空');
    }
    return this.prisma.exposureAccount.upsert({
      where: {
        platform_accountId: {
          platform: input.platform ?? 'douyin',
          accountId,
        },
      },
      create: {
        platform: input.platform ?? 'douyin',
        accountId,
        name,
        note: input.note ?? null,
      },
      update: { name, note: input.note ?? null },
    });
  }

  async setExposureAccountStatus(id: string, status: string) {
    const account = await this.prisma.exposureAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('曝光账号不存在');
    if (!['active', 'disabled'].includes(status)) {
      throw new BadRequestException('状态只能是 active / disabled');
    }
    return this.prisma.exposureAccount.update({
      where: { id },
      data: { status, updatedAt: new Date() },
    });
  }

  async removeExposureAccount(id: string) {
    const account = await this.prisma.exposureAccount.findUnique({ where: { id } });
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
    const openers = ['', '家人们，', '真的没想到，', '必须分享一下，', '最近发现，'];
    const closers = ['', ' 感兴趣可以评论区聊聊。', ' 有需要的朋友扣1。', ' 你们觉得怎么样？'];
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
  async listExposureRecords(limit = 50) {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = await this.prisma.runtimeExecution.findMany({
      where: { taskType: { contains: 'exposure' } },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });
    return rows.map((row: any) => ({
      id: row.id,
      taskType: row.taskType,
      status: row.status,
      createdAt: row.createdAt,
      summary: row.summary ?? null,
      diagnostics: row.diagnostics ?? null,
    }));
  }
}
