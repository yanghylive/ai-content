import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveProjectDataPath } from '../../common/project-paths';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ExecutorEvidence,
  ExecutorTaskPlatform,
  ExecutorTaskType,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import { evaluateRuntimeCompletion } from './ai-employee-execution-evidence';
import type {
  AiEmployeeExposureExecutionKind,
  AiEmployeeExposureMode,
  AiEmployeeWorkflowAggregate,
  AiEmployeeWorkflowBlocker,
  AiEmployeeWorkflowCapabilityInput,
  AiEmployeeWorkflowConfirmationMetadata,
  AiEmployeeWorkflowDefinition,
  AiEmployeeWorkflowExecutionPolicy,
  AiEmployeeWorkflowPreparationInput,
  AiEmployeeWorkflowPreparationResult,
  AiEmployeeWorkflowRetryInput,
  AiEmployeeWorkflowRun,
  AiEmployeeWorkflowSchedule,
  AiEmployeeWorkflowSnapshot,
  AiEmployeeWorkflowStepDefinition,
  AiEmployeeWorkflowStepRun,
  AiEmployeeWorkflowStepStatus,
  AiEmployeeWorkflowStore,
} from './ai-employee-workflow.types';

const WORKFLOW_STORE_VERSION = 1;
const WORKFLOW_DEFINITION_VERSION = 1;
const WORKFLOW_STORE_RUN_LIMIT = 500;
const WORKFLOW_STORE_DEFINITION_LIMIT = 200;
const WORKFLOW_SCHEDULER_INTERVAL_MS = 30_000;
const WORKFLOW_MESSAGE_LIMIT = 1_000;
const EXPOSURE_CONTRACT_EVIDENCE_LABEL = 'douyin-exposure-runtime-contract';
const LEGACY_WORKFLOW_TENANT = 'legacy-local-desktop';
const LEGACY_WORKFLOW_USER = 'legacy-local-user';

type WorkflowTenantScope = { tenantId: string; userId: string };

const EXPOSURE_CAPABILITY_BY_MODE: Record<AiEmployeeExposureMode, string> = {
  link: 'douyin-link-exposure',
  search_account: 'douyin-search-account-exposure',
  hot_video: 'douyin-hot-video-exposure',
  targeted: 'douyin-targeted-exposure',
  retention: 'douyin-retention-exposure',
};

const EXPOSURE_TASK_BY_MODE: Record<AiEmployeeExposureMode, ExecutorTaskType> =
  {
    link: 'douyin-link-exposure',
    search_account: 'douyin-search-account-exposure',
    hot_video: 'douyin-hot-video-exposure',
    targeted: 'douyin-targeted-exposure',
    retention: 'douyin-retention-exposure',
  };

const EXPOSURE_TITLE_BY_MODE: Record<AiEmployeeExposureMode, string> = {
  link: '抖音链接候选读取',
  search_account: '抖音账号搜索候选读取',
  hot_video: '抖音爆款视频候选读取',
  targeted: '抖音定向候选读取',
  retention: '抖音留资候选读取',
};

const PUBLISH_CAPABILITY_BY_PLATFORM: Partial<
  Record<ExecutorTaskPlatform, string>
> = {
  douyin: 'publish-douyin-video',
  xiaohongshu: 'publish-xiaohongshu-video',
  kuaishou: 'publish-kuaishou-video',
  'wechat-channel': 'publish-wechat-channel-video',
  bilibili: 'publish-bilibili-video',
};

const PUBLISH_PLATFORM_TYPE: Partial<Record<ExecutorTaskPlatform, number>> = {
  xiaohongshu: 1,
  'wechat-channel': 2,
  douyin: 3,
  kuaishou: 4,
  bilibili: 5,
};

@Injectable()
export class AiEmployeeWorkflowService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AiEmployeeWorkflowService.name);
  private storeReady?: Promise<AiEmployeeWorkflowStore>;
  private storeMutation: Promise<void> = Promise.resolve();
  private scheduler?: NodeJS.Timeout;
  private schedulerRunning = false;

  constructor(
    private readonly runtime: RuntimeOrchestrator,
    @Optional()
    private readonly authRequestContext?: AuthRequestContextService,
    @Optional()
    private readonly prisma?: PrismaService,
  ) {}

  onModuleInit() {
    void this.recoverInterruptedWorkflowRuns()
      .catch((error) => {
        this.logger.warn(
          `Workflow restart recovery failed: ${this.safeTechnicalMessage(error)}`,
        );
      })
      .finally(() => void this.runDueWorkflowSchedules());
    this.scheduler = setInterval(() => {
      void this.runDueWorkflowSchedules().catch((error) => {
        this.logger.warn(
          `Workflow schedule check failed: ${this.safeTechnicalMessage(error)}`,
        );
      });
    }, WORKFLOW_SCHEDULER_INTERVAL_MS);
    this.scheduler.unref?.();
  }

  onModuleDestroy() {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = undefined;
  }

  async prepareWorkflow(
    input: AiEmployeeWorkflowPreparationInput,
    capabilities: AiEmployeeWorkflowCapabilityInput[],
  ): Promise<AiEmployeeWorkflowPreparationResult> {
    const scope = await this.resolveTenantScope();
    const workflow = this.asRecord(input.workflow);
    const now = new Date().toISOString();
    const requestedId = this.readText(workflow.id);
    const existing = requestedId
      ? await this.findDefinition(requestedId)
      : undefined;
    const id = existing?.id || requestedId || `workflow_${randomUUID()}`;
    const title = this.sanitizeWorkflowMessage(
      this.readText(input.title) ||
        this.readText(workflow.title) ||
        'AI员工工作流',
    );
    const accountId =
      this.readText(input.accountId) || this.readText(workflow.account);
    const platform = this.normalizePlatform(workflow.platform);
    const capabilityMap = new Map(
      capabilities.map((capability) => [capability.key, capability]),
    );
    const steps = this.buildWorkflowSteps({
      workflow,
      accountId,
      platform,
      capabilityMap,
    });
    if (!steps.length) {
      throw new BadRequestException('请至少选择一个工作流步骤');
    }

    const definition = this.finalizeDefinition({
      id,
      ...scope,
      version: existing ? existing.version + 1 : WORKFLOW_DEFINITION_VERSION,
      title,
      accountId: accountId || undefined,
      platform,
      config: workflow,
      schedule: this.buildWorkflowSchedule(workflow),
      steps,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    await this.upsertDefinition(definition);

    const availableCount = definition.steps.filter(
      (step) => step.availability === 'available',
    ).length;
    return {
      taskType: 'workflow.auto',
      executionMode: 'configured',
      displayStatus:
        definition.status === 'ready'
          ? 'ready'
          : definition.status === 'partially_ready'
            ? 'partially_ready'
            : 'configuration_required',
      message:
        definition.status === 'ready'
          ? '工作流已保存，可以启动。'
          : availableCount > 0
            ? `工作流已保存，${availableCount} 个步骤可以启动。`
            : '工作流已保存，当前步骤需要先完成配置。',
      nextAction:
        definition.status === 'blocked'
          ? definition.blockers[0]?.nextAction || '请先完成执行条件。'
          : definition.executionPolicy.requiresConfirmation
            ? '启动时确认外部动作；没有证据和回读的步骤不会记为完成。'
            : '可以启动可执行步骤；其他步骤会保留真实阻断原因。',
      definition,
      steps: definition.steps,
      blockers: definition.blockers,
    };
  }

  async listWorkflowSnapshot(limit = 50): Promise<AiEmployeeWorkflowSnapshot> {
    const scope = await this.resolveTenantScope();
    const normalizedLimit = Math.min(Math.max(Math.floor(limit || 50), 1), 200);
    const store = await this.readStore();
    return {
      definitions: this.clone(
        store.definitions
          .filter((item) => this.inTenantScope(item, scope))
          .slice(0, normalizedLimit),
      ),
      runs: this.clone(
        store.runs
          .filter((item) => this.inTenantScope(item, scope))
          .slice(0, normalizedLimit),
      ),
    };
  }

  async getWorkflowDefinition(id: string) {
    const definition = await this.findDefinition(id);
    if (!definition) {
      throw new BadRequestException('工作流不存在');
    }
    return this.clone(definition);
  }

  async getWorkflowRun(id: string) {
    const scope = await this.resolveTenantScope();
    return this.getWorkflowRunInScope(id, scope);
  }

  private async getWorkflowRunInScope(id: string, scope: WorkflowTenantScope) {
    const store = await this.readStore();
    const run = store.runs.find(
      (item) => item.id === id && this.inTenantScope(item, scope),
    );
    if (!run) {
      throw new BadRequestException('工作流运行记录不存在');
    }
    return this.clone(run);
  }

  async refreshWorkflowDefinition(
    id: string,
    capabilities: AiEmployeeWorkflowCapabilityInput[],
  ) {
    const definition = await this.getWorkflowDefinition(id);
    const capabilityMap = new Map(
      capabilities.map((capability) => [capability.key, capability]),
    );
    const refreshed = this.finalizeDefinition({
      ...definition,
      steps: definition.steps.map((step) =>
        this.finalizeStep(step, capabilityMap.get(step.capabilityKey)),
      ),
      updatedAt: new Date().toISOString(),
    });
    await this.upsertDefinition(refreshed);
    return refreshed;
  }

  async startWorkflowRun(
    workflowId: string,
    capabilities: AiEmployeeWorkflowCapabilityInput[],
    options: {
      externalActionsAuthorized: boolean;
      confirmation: AiEmployeeWorkflowConfirmationMetadata;
    },
  ) {
    const confirmation = this.requireRunConfirmation(
      options.confirmation,
      'manual',
    );
    let definition = await this.refreshWorkflowDefinition(
      workflowId,
      capabilities,
    );
    definition = await this.activateWorkflowSchedule(definition, confirmation);
    const now = new Date().toISOString();
    const run: AiEmployeeWorkflowRun = {
      id: `workflow_run_${randomUUID()}`,
      tenantId: definition.tenantId,
      userId: definition.userId,
      workflowId: definition.id,
      workflowVersion: definition.version,
      title: definition.title,
      status: 'queued',
      trigger: 'manual',
      executionPolicy: definition.executionPolicy,
      confirmation,
      confirmations: [confirmation],
      steps: definition.steps.map((step) =>
        this.createPendingStepRun(step, now),
      ),
      aggregate: this.emptyAggregate(definition.steps.length),
      createdAt: now,
      updatedAt: now,
    };
    await this.upsertRun(run);
    return this.executeRun(run.id, definition, {
      externalActionsAuthorized: options.externalActionsAuthorized,
      scope: definition,
    });
  }

  async retryWorkflowRun(
    runId: string,
    input: AiEmployeeWorkflowRetryInput,
    capabilities: AiEmployeeWorkflowCapabilityInput[],
    options: {
      externalActionsAuthorized: boolean;
      confirmation: AiEmployeeWorkflowConfirmationMetadata;
    },
  ) {
    const confirmation = this.requireRunConfirmation(
      options.confirmation,
      'retry',
    );
    const existingRun = await this.getWorkflowRun(runId);
    if (
      existingRun.status === 'queued' ||
      existingRun.status === 'running' ||
      existingRun.status === 'cancelling'
    ) {
      throw new BadRequestException('工作流仍在运行，当前不能重试');
    }
    const definition = await this.refreshWorkflowDefinition(
      existingRun.workflowId,
      capabilities,
    );
    const requestedIds = Array.isArray(input.stepIds)
      ? new Set(
          input.stepIds.map((item) => this.readText(item)).filter(Boolean),
        )
      : null;
    const retryable = existingRun.steps.filter(
      (step) =>
        (step.status === 'failed' ||
          step.status === 'blocked' ||
          step.status === 'cancelled') &&
        (!requestedIds || requestedIds.has(step.stepId)),
    );
    if (!retryable.length) {
      throw new BadRequestException('没有可重试的未完成步骤');
    }
    const retryIds = new Set(retryable.map((step) => step.stepId));
    const now = new Date().toISOString();
    const retried = await this.updateRun(runId, (run) => ({
      ...run,
      workflowVersion: definition.version,
      status: 'queued',
      trigger: 'retry',
      executionPolicy: definition.executionPolicy,
      confirmation,
      confirmations: [...run.confirmations, confirmation],
      cancelRequestedAt: undefined,
      cancellationMessage: undefined,
      finishedAt: undefined,
      updatedAt: now,
      steps: run.steps.map((step) => {
        if (!retryIds.has(step.stepId)) return step;
        const attempt = step.attempt + 1;
        return {
          ...step,
          status: 'pending',
          attempt,
          transitions: [
            ...step.transitions,
            {
              from: step.status,
              to: 'pending',
              at: now,
              attempt,
              message: '已进入重试队列。',
            },
          ],
          message: '等待重试。',
          nextAction: undefined,
          reasonCode: undefined,
          technicalMessage: undefined,
          evidence: [],
          readback: undefined,
          output: undefined,
          startedAt: undefined,
          finishedAt: undefined,
        } satisfies AiEmployeeWorkflowStepRun;
      }),
    }));
    await this.upsertRun({
      ...retried,
      aggregate: this.aggregateRun(retried.steps),
    });
    return this.executeRun(runId, definition, {
      stepIds: retryIds,
      externalActionsAuthorized: options.externalActionsAuthorized,
      scope: definition,
    });
  }

  async cancelWorkflowRun(runId: string) {
    const now = new Date().toISOString();
    const updated = await this.updateRun(runId, (run) => {
      if (this.isTerminalRunStatus(run.status)) return run;
      const steps = run.steps.map((step) => {
        if (step.status !== 'pending') return step;
        return this.transitionStep(step, 'cancelled', {
          at: now,
          message: '已取消，未调用执行器。',
          nextAction: '需要继续时可重试这个步骤。',
        });
      });
      const hasRunningStep = steps.some((step) => step.status === 'running');
      const aggregate = this.aggregateRun(steps);
      return {
        ...run,
        status: hasRunningStep ? 'cancelling' : 'cancelled',
        cancelRequestedAt: run.cancelRequestedAt || now,
        cancellationMessage: hasRunningStep
          ? '取消请求已记录；当前执行器返回后不会启动后续步骤。'
          : '工作流已取消，没有启动新的步骤。',
        steps,
        aggregate,
        updatedAt: now,
        finishedAt: hasRunningStep ? undefined : now,
      };
    });
    return updated;
  }

  async runDueWorkflowSchedules(now = new Date()) {
    if (this.schedulerRunning) return [] as AiEmployeeWorkflowRun[];
    this.schedulerRunning = true;
    try {
      const store = await this.readStore();
      const dueDefinitions = store.definitions.filter((definition) => {
        const nextRunAt = definition.schedule?.nextRunAt;
        return (
          definition.schedule?.status === 'active' &&
          Boolean(definition.schedule.authorization) &&
          Boolean(nextRunAt) &&
          new Date(nextRunAt as string).getTime() <= now.getTime()
        );
      });
      const runs: AiEmployeeWorkflowRun[] = [];
      for (const definition of dueDefinitions) {
        const claimed = await this.claimDueSchedule(definition, now);
        if (!claimed) continue;
        if (claimed.skipRun) continue;
        const run = await this.createScheduledRun(claimed.definition, now);
        runs.push(run);
      }
      return runs;
    } finally {
      this.schedulerRunning = false;
    }
  }

  private async activateWorkflowSchedule(
    definition: AiEmployeeWorkflowDefinition,
    confirmation: AiEmployeeWorkflowConfirmationMetadata,
  ) {
    if (!definition.schedule) return definition;
    const now = new Date();
    const updated: AiEmployeeWorkflowDefinition = {
      ...definition,
      schedule: {
        ...definition.schedule,
        status: 'active',
        authorization: confirmation,
        nextRunAt: this.nextScheduleAt(definition.schedule, now).toISOString(),
      },
      updatedAt: now.toISOString(),
    };
    await this.upsertDefinition(updated);
    return updated;
  }

  private async claimDueSchedule(
    requested: AiEmployeeWorkflowDefinition,
    now: Date,
  ): Promise<
    { definition: AiEmployeeWorkflowDefinition; skipRun: boolean } | undefined
  > {
    return this.mutateStore((store) => {
      const definition = store.definitions.find(
        (item) =>
          item.id === requested.id && this.inTenantScope(item, requested),
      );
      const schedule = definition?.schedule;
      if (
        !definition ||
        schedule?.status !== 'active' ||
        !schedule.authorization ||
        !schedule.nextRunAt ||
        new Date(schedule.nextRunAt).getTime() > now.getTime()
      ) {
        return { store, result: undefined };
      }
      const hasActiveRun = store.runs.some(
        (run) =>
          run.workflowId === definition.id &&
          this.inTenantScope(run, definition) &&
          (run.status === 'queued' ||
            run.status === 'running' ||
            run.status === 'cancelling'),
      );
      const updated: AiEmployeeWorkflowDefinition = {
        ...definition,
        schedule: {
          ...schedule,
          lastScheduledAt: hasActiveRun
            ? schedule.lastScheduledAt
            : now.toISOString(),
          nextRunAt: this.nextScheduleAt(schedule, now).toISOString(),
        },
        updatedAt: now.toISOString(),
      };
      return {
        store: {
          ...store,
          definitions: store.definitions.map((item) =>
            item.id === updated.id && this.inTenantScope(item, updated)
              ? updated
              : item,
          ),
        },
        result: { definition: updated, skipRun: hasActiveRun },
      };
    });
  }

  private async createScheduledRun(
    definition: AiEmployeeWorkflowDefinition,
    now: Date,
  ) {
    const authorization = definition.schedule?.authorization;
    if (!authorization) {
      throw new BadRequestException('工作流计划尚未经过人工确认');
    }
    const at = now.toISOString();
    const confirmation: AiEmployeeWorkflowConfirmationMetadata = {
      ...authorization,
      auditId: `workflow_schedule_${randomUUID()}`,
      source: 'schedule',
      parentAuditId: authorization.auditId,
      appliedAt: at,
    };
    const run: AiEmployeeWorkflowRun = {
      id: `workflow_run_${randomUUID()}`,
      tenantId: definition.tenantId,
      userId: definition.userId,
      workflowId: definition.id,
      workflowVersion: definition.version,
      title: definition.title,
      status: 'queued',
      trigger: 'schedule',
      executionPolicy: definition.executionPolicy,
      confirmation,
      confirmations: [confirmation],
      steps: definition.steps.map((step) =>
        this.createPendingStepRun(step, at),
      ),
      aggregate: this.emptyAggregate(definition.steps.length),
      createdAt: at,
      updatedAt: at,
    };
    await this.upsertRun(run);
    return this.executeRun(run.id, definition, {
      externalActionsAuthorized:
        !definition.executionPolicy.hasCustomerActions ||
        process.env.GROWTH_EXECUTION_ENABLED === 'true',
      scope: definition,
    });
  }

  private buildWorkflowSchedule(
    workflow: Record<string, unknown>,
  ): AiEmployeeWorkflowSchedule | undefined {
    const frequency = this.readText(workflow.frequency);
    const timeWindow = this.readText(workflow.timeWindow);
    if (!frequency && !timeWindow) return undefined;
    if (!frequency || !timeWindow) {
      throw new BadRequestException('频率和时间窗需要同时填写');
    }
    this.parseWorkflowFrequency(frequency);
    this.parseWorkflowTimeWindow(timeWindow);
    return {
      enabled: true,
      frequency,
      timeWindow,
      timezone:
        this.readText(workflow.timezone) ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'local',
      status: 'awaiting_confirmation',
    };
  }

  private nextScheduleAt(schedule: AiEmployeeWorkflowSchedule, after: Date) {
    const frequency = this.parseWorkflowFrequency(schedule.frequency);
    const window = this.parseWorkflowTimeWindow(schedule.timeWindow);
    for (let dayOffset = 0; dayOffset <= 366; dayOffset += 1) {
      const day = new Date(
        after.getFullYear(),
        after.getMonth(),
        after.getDate() + dayOffset,
      );
      const slots: number[] = [];
      if (frequency.runsPerDay) {
        if (frequency.runsPerDay === 1) {
          slots.push(window.startMinute);
        } else {
          const gap =
            (window.endMinute - window.startMinute) /
            (frequency.runsPerDay - 1);
          for (let index = 0; index < frequency.runsPerDay; index += 1) {
            slots.push(Math.round(window.startMinute + gap * index));
          }
        }
      } else {
        for (
          let minute = window.startMinute;
          minute <= window.endMinute;
          minute += frequency.intervalMinutes as number
        ) {
          slots.push(minute);
        }
      }
      for (const minute of slots) {
        const candidate = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          Math.floor(minute / 60),
          minute % 60,
        );
        if (candidate.getTime() > after.getTime()) return candidate;
      }
    }
    throw new BadRequestException('无法计算下一次工作流运行时间');
  }

  private parseWorkflowFrequency(value: string): {
    runsPerDay?: number;
    intervalMinutes?: number;
  } {
    const normalized = value.trim().toLowerCase();
    const dailyMatch = normalized.match(/^(?:每天|每日)\s*(\d+)\s*次$/);
    if (dailyMatch) {
      const runsPerDay = Number(dailyMatch[1]);
      if (runsPerDay >= 1 && runsPerDay <= 24) return { runsPerDay };
    }
    if (normalized === 'daily') return { runsPerDay: 1 };
    if (normalized === '每小时' || normalized === 'hourly') {
      return { intervalMinutes: 60 };
    }
    const intervalMatch = normalized.match(
      /^(?:每|every\s*)(\d+)\s*(分钟|小时|minutes?|hours?)$/,
    );
    if (intervalMatch) {
      const amount = Number(intervalMatch[1]);
      const unit = intervalMatch[2];
      const intervalMinutes =
        unit === '小时' || unit.startsWith('hour') ? amount * 60 : amount;
      if (intervalMinutes >= 5 && intervalMinutes <= 24 * 60) {
        return { intervalMinutes };
      }
    }
    throw new BadRequestException(
      '频率格式不支持，请使用“每天 1 次”“每 2 小时”或“每 30 分钟”',
    );
  }

  private parseWorkflowTimeWindow(value: string) {
    const match = value
      .trim()
      .match(/^(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})$/);
    if (!match) {
      throw new BadRequestException('时间窗格式不支持，请使用“09:00-18:00”');
    }
    const startHour = Number(match[1]);
    const startMinutePart = Number(match[2]);
    const endHour = Number(match[3]);
    const endMinutePart = Number(match[4]);
    if (
      startHour > 23 ||
      endHour > 23 ||
      startMinutePart > 59 ||
      endMinutePart > 59
    ) {
      throw new BadRequestException('时间窗包含无效时间');
    }
    const startMinute = startHour * 60 + startMinutePart;
    const endMinute = endHour * 60 + endMinutePart;
    if (endMinute <= startMinute) {
      throw new BadRequestException('时间窗结束时间需要晚于开始时间');
    }
    return { startMinute, endMinute };
  }

  private buildWorkflowSteps(input: {
    workflow: Record<string, unknown>;
    accountId: string;
    platform: ExecutorTaskPlatform;
    capabilityMap: Map<string, AiEmployeeWorkflowCapabilityInput>;
  }) {
    const { workflow, accountId, platform, capabilityMap } = input;
    const steps: AiEmployeeWorkflowStepDefinition[] = [];
    const includeVideoClip = workflow.includeVideoClip === true;
    const includeExposure = workflow.includeExposure !== false;
    const includePublish = workflow.includePublish === true;
    const material =
      this.readText(workflow.materialPath) || this.readText(workflow.material);

    if (includeVideoClip) {
      const step: AiEmployeeWorkflowStepDefinition = {
        id: 'video-template-clip',
        capabilityKey: 'video-template-clip',
        title: '模板剪辑',
        actionKind: 'local_operation',
        taskType: 'video-template-clip',
        platform: 'mixed',
        payload: {
          materialPath: material,
          templateName: this.readText(workflow.templateName) || '默认模板',
          titlePrompt: this.readText(workflow.titlePrompt),
          outputName: this.readText(workflow.outputName),
          outputDir: this.readText(workflow.outputDir),
        },
        sendMode: 'auto-send',
        dependencies: [],
        availability: 'blocked',
        capabilityStatus: 'unavailable',
        message: '',
        nextAction: '',
        requiresEvidence: true,
        requiresReadback: true,
      };
      steps.push(
        this.finalizeStep(step, capabilityMap.get(step.capabilityKey)),
      );
    }

    if (includeExposure) {
      const step = this.buildExposureStep({ workflow, accountId, platform });
      steps.push(
        this.finalizeStep(step, capabilityMap.get(step.capabilityKey)),
      );
    }

    if (includePublish) {
      const capabilityKey =
        PUBLISH_CAPABILITY_BY_PLATFORM[platform] || 'publish-douyin-video';
      const step: AiEmployeeWorkflowStepDefinition = {
        id: `publish-${platform}`,
        capabilityKey,
        title: `${this.platformLabel(platform)}视频发布`,
        actionKind: 'platform_action',
        taskType: 'platform-publish-video',
        platform,
        accountId: accountId || undefined,
        payload: {
          platform,
          platformType: PUBLISH_PLATFORM_TYPE[platform],
          accountId,
          title:
            this.readText(workflow.publishTitle) ||
            this.readText(workflow.title) ||
            '未命名内容',
          materialFiles: material ? [material] : [],
          tags: this.readTextList(workflow.publishTags),
          scheduleTime: this.readText(workflow.scheduleTime),
        },
        sendMode: 'auto-send',
        dependencies: includeVideoClip ? ['video-template-clip'] : [],
        availability: 'blocked',
        capabilityStatus: 'unavailable',
        message: '',
        nextAction: '',
        requiresEvidence: true,
        requiresReadback: true,
      };
      steps.push(
        this.finalizeStep(step, capabilityMap.get(step.capabilityKey)),
      );
    }

    return steps;
  }

  private buildExposureStep(input: {
    workflow: Record<string, unknown>;
    accountId: string;
    platform: ExecutorTaskPlatform;
  }): AiEmployeeWorkflowStepDefinition {
    const { workflow, accountId, platform } = input;
    const mode = this.normalizeExposureMode(workflow.exposureMode);
    const executionKind = this.normalizeExposureExecutionKind(
      workflow.exposureExecutionKind ?? workflow.exposureOperation,
    );
    const material =
      this.readText(workflow.material) || this.readText(workflow.sourceText);
    const sourceInputs = this.readTextList(
      workflow.sourceInputs ?? workflow.targetAccounts,
    );
    const capabilityKey = EXPOSURE_CAPABILITY_BY_MODE[mode];

    if (executionKind === 'customer_action') {
      const action = this.asRecord(workflow.customerAction);
      const actionType = this.readText(
        action.action ?? workflow.customerActionType,
      );
      const taskType =
        actionType === 'comment'
          ? 'douyin-comment-reply'
          : actionType === 'message'
            ? 'douyin-direct-message-reply'
            : undefined;
      return {
        id: `douyin-${mode}-customer-action`,
        capabilityKey: taskType || `douyin-${mode}-customer-action`,
        title: `${this.exposureModeLabel(mode)}${
          actionType === 'message' ? '私信' : '评论'
        }`,
        actionKind: 'customer_action',
        exposureMode: mode,
        taskType,
        platform: 'douyin',
        accountId: accountId || undefined,
        payload: {
          configuredPlatform: platform,
          exposureExecutionKind: executionKind,
          exposureMode: mode,
          targetName: this.readText(action.targetName),
          targetText: this.readText(action.targetText),
          sourceText:
            this.readText(action.sourceText) ||
            this.readText(action.targetText),
          sourceUrl: this.readText(action.sourceUrl),
          profileUrl: this.readText(action.profileUrl),
          videoTitle: this.readText(action.videoTitle),
          videoUrl: this.readText(action.videoUrl),
          commentMode:
            this.readText(action.commentMode) === 'video-comment'
              ? 'video-comment'
              : 'reply',
          replyText:
            this.readText(action.replyText) ||
            this.readText(workflow.replyText),
          customerActionType: actionType,
        },
        sendMode:
          action.autoSend === false || workflow.autoSend === false
            ? 'draft-only'
            : 'auto-send',
        dependencies: [],
        availability: 'blocked',
        capabilityStatus: 'unavailable',
        message: '',
        nextAction: '',
        requiresEvidence: true,
        requiresReadback:
          action.autoSend !== false && workflow.autoSend !== false,
      };
    }

    const payload = this.buildCandidateReadPayload(
      mode,
      workflow,
      material,
      sourceInputs,
    );
    return {
      id: `douyin-${mode}-candidate-read`,
      capabilityKey,
      title: EXPOSURE_TITLE_BY_MODE[mode],
      actionKind: 'candidate_read',
      exposureMode: mode,
      taskType: EXPOSURE_TASK_BY_MODE[mode],
      platform: platform === 'douyin' ? 'douyin' : platform,
      accountId: accountId || undefined,
      payload,
      sendMode: 'draft-only',
      dependencies: [],
      availability: 'blocked',
      capabilityStatus: 'unavailable',
      message: '',
      nextAction: '',
      requiresEvidence: true,
      requiresReadback: true,
    };
  }

  private buildCandidateReadPayload(
    mode: AiEmployeeExposureMode,
    workflow: Record<string, unknown>,
    material: string,
    sourceInputs: string[],
  ) {
    const limit = this.readPositiveInteger(workflow.limit, 20, 200);
    const filters = {
      resultLimit: limit,
      commentLimit: limit,
      commentTimeMatch: this.readText(workflow.commentTimeMatch) || '7days',
      executionKind: 'candidate_read',
    };
    if (mode === 'link') {
      return {
        exposureExecutionKind: 'candidate_read',
        exposureMode: mode,
        links: sourceInputs.length ? sourceInputs : material ? [material] : [],
        filters,
      };
    }
    if (mode === 'targeted') {
      const targetAccounts = sourceInputs.length
        ? sourceInputs
        : this.splitText(material);
      return {
        exposureExecutionKind: 'candidate_read',
        exposureMode: mode,
        targetAccounts,
        searchKeywords: targetAccounts,
        filters: { ...filters, targetedMode: true },
      };
    }
    if (mode === 'retention') {
      const retentionSourceId =
        this.readText(workflow.retentionSourceId) ||
        sourceInputs[0] ||
        material;
      const keyword = this.readText(workflow.keyword) || material;
      return {
        exposureExecutionKind: 'candidate_read',
        exposureMode: mode,
        retentionSourceId,
        searchKeywords: keyword ? [keyword] : [],
        filters: { ...filters, retentionMode: true },
      };
    }
    const searchKeywords = sourceInputs.length
      ? sourceInputs
      : this.splitText(this.readText(workflow.keyword) || material);
    return {
      exposureExecutionKind: 'candidate_read',
      exposureMode: mode,
      searchKeywords,
      filters: {
        ...filters,
        preferVideoResults: mode === 'hot_video',
        preferHighEngagement: mode === 'hot_video',
      },
    };
  }

  private finalizeStep(
    step: AiEmployeeWorkflowStepDefinition,
    capability?: AiEmployeeWorkflowCapabilityInput,
  ): AiEmployeeWorkflowStepDefinition {
    const configurationBlocker = this.getStepConfigurationBlocker(step);
    const capabilityStatus = capability?.status || 'unavailable';
    if (configurationBlocker) {
      return {
        ...step,
        availability: 'blocked',
        capabilityStatus,
        message: configurationBlocker.message,
        nextAction: configurationBlocker.nextAction,
      };
    }
    if (capabilityStatus !== 'real') {
      return {
        ...step,
        availability: 'blocked',
        capabilityStatus,
        message: capability?.message || '当前执行器不可用。',
        nextAction: capability?.nextAction || '请先完成执行器和账号检查。',
      };
    }
    return {
      ...step,
      availability: 'available',
      capabilityStatus,
      message:
        step.actionKind === 'candidate_read'
          ? '候选读取已接通，不会执行评论、私信或发布。'
          : '执行器已接通，完成状态需要真实证据和结果回读。',
      nextAction:
        step.actionKind === 'candidate_read'
          ? '启动后读取候选并汇总回读。'
          : '启动前确认目标和外部动作。',
    };
  }

  private getStepConfigurationBlocker(
    step: AiEmployeeWorkflowStepDefinition,
  ): { message: string; nextAction: string } | null {
    if (step.actionKind === 'local_operation') {
      if (!this.readText(step.payload.materialPath)) {
        return {
          message: '模板剪辑缺少本机素材路径。',
          nextAction: '填写可读取的视频、图片或素材目录。',
        };
      }
      return null;
    }

    if (step.actionKind === 'candidate_read') {
      if (step.platform !== 'douyin') {
        return {
          message: '这五种曝光模式当前只接入抖音候选读取。',
          nextAction: '选择抖音，或关闭曝光步骤。',
        };
      }
      if (!step.accountId) {
        return {
          message: '候选读取缺少抖音账号。',
          nextAction: '选择已登录的抖音账号。',
        };
      }
      if (
        step.exposureMode === 'link' &&
        !this.hasTextItems(step.payload.links)
      ) {
        return {
          message: '链接候选读取缺少视频链接。',
          nextAction: '填写至少一条抖音视频链接。',
        };
      }
      if (
        (step.exposureMode === 'search_account' ||
          step.exposureMode === 'hot_video') &&
        !this.hasTextItems(step.payload.searchKeywords)
      ) {
        return {
          message: '搜索候选读取缺少关键词。',
          nextAction: '填写至少一个搜索关键词。',
        };
      }
      if (
        step.exposureMode === 'targeted' &&
        !this.hasTextItems(step.payload.targetAccounts)
      ) {
        return {
          message: '定向候选读取缺少目标账号。',
          nextAction: '填写至少一个目标账号。',
        };
      }
      if (
        step.exposureMode === 'retention' &&
        !this.readText(step.payload.retentionSourceId)
      ) {
        return {
          message: '留资候选读取缺少线索来源。',
          nextAction: '填写留资来源或线索关键词。',
        };
      }
      return null;
    }

    if (step.actionKind === 'customer_action') {
      if (step.payload.configuredPlatform !== 'douyin') {
        return {
          message: '抖音评论和私信执行器不能处理其他平台账号。',
          nextAction: '选择抖音平台，或关闭这个客户动作。',
        };
      }
      if (!step.accountId) {
        return {
          message: '客户动作缺少抖音账号。',
          nextAction: '选择已登录的抖音账号。',
        };
      }
      if (
        step.taskType !== 'douyin-comment-reply' &&
        step.taskType !== 'douyin-direct-message-reply'
      ) {
        return {
          message: '当前商业执行器只支持抖音评论和私信。',
          nextAction: '选择评论或私信；其他动作不会伪装成成功。',
        };
      }
      if (!this.readText(step.payload.replyText)) {
        return {
          message: '客户动作缺少发送内容。',
          nextAction: '填写要发送的评论或私信。',
        };
      }
      const isVideoComment = step.payload.commentMode === 'video-comment';
      const hasVideoTarget = Boolean(
        this.readText(step.payload.videoUrl) ||
        this.readText(step.payload.sourceUrl),
      );
      if (
        step.taskType === 'douyin-comment-reply' &&
        !this.readText(step.payload.targetText) &&
        !(isVideoComment && hasVideoTarget)
      ) {
        return {
          message: '评论动作缺少目标评论或视频链接。',
          nextAction: '先读取候选，再选择可回读的目标。',
        };
      }
      if (
        step.taskType === 'douyin-direct-message-reply' &&
        !this.readText(step.payload.targetText)
      ) {
        return {
          message: '私信动作缺少可回读的目标消息。',
          nextAction: '从真实私信会话选择目标消息。',
        };
      }
      if (
        step.sendMode === 'auto-send' &&
        process.env.GROWTH_EXECUTION_ENABLED !== 'true'
      ) {
        return {
          message: '真实触达总开关未开启。',
          nextAction: '显式开启真实触达后，再启动已确认的客户动作。',
        };
      }
      return null;
    }

    if (!PUBLISH_PLATFORM_TYPE[step.platform]) {
      return {
        message: `${this.platformLabel(step.platform)}视频发布尚未接入工作流执行器。`,
        nextAction: '关闭发布步骤，或选择已支持的平台。',
      };
    }
    if (!step.accountId) {
      return {
        message: '发布步骤缺少平台账号。',
        nextAction: '选择已登录的平台账号。',
      };
    }
    const materialFiles = this.readTextList(step.payload.materialFiles);
    if (!materialFiles.length && !step.dependencies.length) {
      return {
        message: '发布步骤缺少视频素材。',
        nextAction: '填写视频素材，或先启用模板剪辑步骤。',
      };
    }
    return null;
  }

  private finalizeDefinition(
    input: Omit<
      AiEmployeeWorkflowDefinition,
      'status' | 'blockers' | 'executionPolicy'
    >,
  ): AiEmployeeWorkflowDefinition {
    const steps = input.steps.map((step) => ({
      ...step,
      title: this.sanitizeWorkflowMessage(step.title),
      message: this.sanitizeWorkflowMessage(step.message),
      nextAction: this.sanitizeWorkflowMessage(step.nextAction),
    }));
    const blockers = steps
      .filter((step) => step.availability === 'blocked')
      .map(
        (step): AiEmployeeWorkflowBlocker => ({
          code:
            step.capabilityStatus === 'real'
              ? 'step-configuration-required'
              : `capability-${step.capabilityStatus}`,
          stepId: step.id,
          title: step.title,
          message: step.message,
          nextAction: step.nextAction,
        }),
      );
    const availableCount = steps.length - blockers.length;
    const hasCustomerActions = steps.some(
      (step) => step.actionKind === 'customer_action',
    );
    const hasPlatformActions = steps.some(
      (step) => step.actionKind === 'platform_action',
    );
    const hasAvailableExternalAction = steps.some(
      (step) =>
        step.availability === 'available' && this.isExternalAction(step),
    );
    const executionPolicy: AiEmployeeWorkflowExecutionPolicy = {
      defaultSendMode: 'auto-send',
      hasCustomerActions,
      hasPlatformActions,
      requiresConfirmation: hasAvailableExternalAction,
    };
    return {
      ...input,
      steps,
      status:
        blockers.length === 0
          ? 'ready'
          : availableCount > 0
            ? 'partially_ready'
            : 'blocked',
      blockers,
      executionPolicy,
    };
  }

  private async executeRun(
    runId: string,
    definition: AiEmployeeWorkflowDefinition,
    options: {
      stepIds?: Set<string>;
      externalActionsAuthorized: boolean;
      scope: WorkflowTenantScope;
    },
  ) {
    const startedAt = new Date().toISOString();
    await this.updateRun(
      runId,
      (run) => ({
        ...run,
        status: 'running',
        startedAt: run.startedAt || startedAt,
        updatedAt: startedAt,
      }),
      options.scope,
    );

    for (const definitionStep of definition.steps) {
      if (options.stepIds && !options.stepIds.has(definitionStep.id)) continue;
      const current = await this.getWorkflowRunInScope(runId, options.scope);
      const currentStep = current.steps.find(
        (step) => step.stepId === definitionStep.id,
      );
      if (!currentStep || currentStep.status !== 'pending') continue;
      if (current.cancelRequestedAt) {
        await this.cancelPendingSteps(runId, options.scope);
        break;
      }

      const dependencyFailure = definitionStep.dependencies.find(
        (dependencyId) =>
          current.steps.find((step) => step.stepId === dependencyId)?.status !==
          'completed',
      );
      if (dependencyFailure) {
        await this.updateStep(
          runId,
          definitionStep.id,
          (step) =>
            this.transitionStep(step, 'blocked', {
              message: '前置步骤没有完成，本步骤未调用执行器。',
              nextAction: '先修复并重试前置步骤。',
              reasonCode: 'not_integrated',
            }),
          options.scope,
        );
        continue;
      }
      if (definitionStep.availability !== 'available') {
        await this.updateStep(
          runId,
          definitionStep.id,
          (step) =>
            this.transitionStep(step, 'blocked', {
              message: definitionStep.message,
              nextAction: definitionStep.nextAction,
              reasonCode: 'not_integrated',
            }),
          options.scope,
        );
        continue;
      }
      if (
        this.isExternalAction(definitionStep) &&
        !options.externalActionsAuthorized
      ) {
        await this.updateStep(
          runId,
          definitionStep.id,
          (step) =>
            this.transitionStep(step, 'blocked', {
              message: '外部动作没有获得本次运行确认，执行器未被调用。',
              nextAction: '确认目标、内容和账号后重试这个步骤。',
              reasonCode: 'review_required',
            }),
          options.scope,
        );
        continue;
      }
      if (!definitionStep.taskType) {
        await this.updateStep(
          runId,
          definitionStep.id,
          (step) =>
            this.transitionStep(step, 'blocked', {
              message: '没有可路由的商业执行器，本步骤未执行。',
              nextAction: definitionStep.nextAction,
              reasonCode: 'not_integrated',
            }),
          options.scope,
        );
        continue;
      }

      const runningStep = await this.updateStep(
        runId,
        definitionStep.id,
        (step) =>
          this.transitionStep(step, 'running', {
            message: '执行器已开始处理。',
          }),
        options.scope,
      );
      const payload = this.resolveStepPayload(
        definitionStep,
        await this.getWorkflowRunInScope(runId, options.scope),
      );
      let result: RuntimeExecutionResult;
      try {
        result = await this.runtime.execute(
          {
            relatedId: `${runId}:${definitionStep.id}:attempt-${runningStep.attempt}`,
            relatedType: 'agent-session',
            type: definitionStep.taskType,
            platform: definitionStep.platform,
            accountId: definitionStep.accountId,
            payload,
          },
          {
            riskContext: {
              accountName: definitionStep.accountId
                ? `${definitionStep.platform}:${definitionStep.accountId}`
                : definitionStep.platform,
            },
            sendMode: definitionStep.sendMode,
          },
        );
      } catch (error) {
        const message = this.safeTechnicalMessage(error);
        await this.updateStep(
          runId,
          definitionStep.id,
          (step) =>
            this.transitionStep(step, 'failed', {
              message: '执行服务暂时不可用，本步骤没有记为完成。',
              nextAction: '检查执行器状态后重试这个步骤。',
              reasonCode: 'runtime_unavailable',
              technicalMessage: message,
            }),
          options.scope,
        );
        continue;
      }

      const completion = evaluateRuntimeCompletion(result, {
        requireReadback: definitionStep.requiresReadback,
        ignoredEvidenceLabels:
          definitionStep.actionKind === 'candidate_read'
            ? [EXPOSURE_CONTRACT_EVIDENCE_LABEL]
            : [],
      });
      const terminalStatus: AiEmployeeWorkflowStepStatus = completion.complete
        ? 'completed'
        : result.status === 'blocked'
          ? 'blocked'
          : 'failed';
      await this.updateStep(
        runId,
        definitionStep.id,
        (step) =>
          this.transitionStep(step, terminalStatus, {
            message: completion.message,
            nextAction: completion.complete
              ? undefined
              : result.blockers?.[0] ||
                (terminalStatus === 'blocked'
                  ? '处理阻断条件后重试这个步骤。'
                  : '检查证据、回读和执行器状态后重试。'),
            reasonCode: completion.reasonCode,
            technicalMessage: result.technicalMessage,
            evidence: this.clone(result.evidence),
            readback: result.readback ? { ...result.readback } : undefined,
            output: {
              candidateCount:
                definitionStep.actionKind === 'candidate_read'
                  ? this.parseCandidates(result.readback?.actualText).length
                  : undefined,
              candidates:
                definitionStep.actionKind === 'candidate_read'
                  ? this.parseCandidates(result.readback?.actualText)
                  : undefined,
              runtime: this.asRecord(result.runtime),
            },
          }),
        options.scope,
      );

      const afterStep = await this.getWorkflowRunInScope(runId, options.scope);
      if (afterStep.cancelRequestedAt) {
        await this.cancelPendingSteps(runId, options.scope);
        break;
      }
    }

    return this.finishRun(runId, options.scope);
  }

  private async finishRun(runId: string, scope: WorkflowTenantScope) {
    const now = new Date().toISOString();
    return this.updateRun(
      runId,
      (run) => {
        const steps = run.cancelRequestedAt
          ? run.steps.map((step) =>
              step.status === 'pending'
                ? this.transitionStep(step, 'cancelled', {
                    at: now,
                    message: '已取消，未调用执行器。',
                    nextAction: '需要继续时可重试这个步骤。',
                  })
                : step,
            )
          : run.steps;
        const aggregate = this.aggregateRun(steps);
        return {
          ...run,
          status: this.resolveRunStatus(
            aggregate,
            Boolean(run.cancelRequestedAt),
          ),
          steps,
          aggregate,
          updatedAt: now,
          finishedAt: now,
          cancellationMessage: run.cancelRequestedAt
            ? '工作流已取消；运行中的单步结果已如实保留，后续步骤未启动。'
            : run.cancellationMessage,
        };
      },
      scope,
    );
  }

  private async cancelPendingSteps(runId: string, scope: WorkflowTenantScope) {
    const now = new Date().toISOString();
    return this.updateRun(
      runId,
      (run) => ({
        ...run,
        steps: run.steps.map((step) =>
          step.status === 'pending'
            ? this.transitionStep(step, 'cancelled', {
                at: now,
                message: '已取消，未调用执行器。',
                nextAction: '需要继续时可重试这个步骤。',
              })
            : step,
        ),
        updatedAt: now,
      }),
      scope,
    );
  }

  private resolveStepPayload(
    definitionStep: AiEmployeeWorkflowStepDefinition,
    run: AiEmployeeWorkflowRun,
  ) {
    if (definitionStep.actionKind !== 'platform_action') {
      return this.clone(definitionStep.payload);
    }
    const completedDependency = definitionStep.dependencies
      .map((id) => run.steps.find((step) => step.stepId === id))
      .find((step) => step?.status === 'completed');
    const generatedMaterial = completedDependency?.evidence.find(
      (item) => item.label === 'video-template-clip-output',
    );
    const generatedPath = generatedMaterial?.path || generatedMaterial?.value;
    return {
      ...this.clone(definitionStep.payload),
      materialFiles: generatedPath
        ? [generatedPath]
        : this.readTextList(definitionStep.payload.materialFiles),
    };
  }

  private createPendingStepRun(
    step: AiEmployeeWorkflowStepDefinition,
    at: string,
  ): AiEmployeeWorkflowStepRun {
    return {
      stepId: step.id,
      capabilityKey: step.capabilityKey,
      title: step.title,
      actionKind: step.actionKind,
      exposureMode: step.exposureMode,
      taskType: step.taskType,
      status: 'pending',
      attempt: 1,
      transitions: [
        {
          from: null,
          to: 'pending',
          at,
          attempt: 1,
          message: '步骤已进入运行队列。',
        },
      ],
      message: '等待执行。',
      evidence: [],
    };
  }

  private transitionStep(
    step: AiEmployeeWorkflowStepRun,
    status: AiEmployeeWorkflowStepStatus,
    input: {
      at?: string;
      message: string;
      nextAction?: string;
      reasonCode?: AiEmployeeWorkflowStepRun['reasonCode'];
      technicalMessage?: string;
      evidence?: ExecutorEvidence[];
      readback?: AiEmployeeWorkflowStepRun['readback'];
      output?: AiEmployeeWorkflowStepRun['output'];
    },
  ): AiEmployeeWorkflowStepRun {
    this.assertStepTransition(step.status, status);
    const at = input.at || new Date().toISOString();
    const message = this.sanitizeWorkflowMessage(input.message);
    const nextAction = input.nextAction
      ? this.sanitizeWorkflowMessage(input.nextAction)
      : undefined;
    const technicalMessage = input.technicalMessage
      ? this.sanitizeWorkflowMessage(input.technicalMessage)
      : undefined;
    return {
      ...step,
      status,
      transitions: [
        ...step.transitions,
        {
          from: step.status,
          to: status,
          at,
          attempt: step.attempt,
          message,
        },
      ],
      message,
      nextAction,
      reasonCode: input.reasonCode,
      technicalMessage,
      evidence: input.evidence ?? step.evidence,
      readback: input.readback ?? step.readback,
      output: input.output ?? step.output,
      startedAt: status === 'running' ? step.startedAt || at : step.startedAt,
      finishedAt: this.isTerminalStepStatus(status) ? at : undefined,
    };
  }

  private assertStepTransition(
    from: AiEmployeeWorkflowStepStatus,
    to: AiEmployeeWorkflowStepStatus,
  ) {
    const allowed: Record<
      AiEmployeeWorkflowStepStatus,
      AiEmployeeWorkflowStepStatus[]
    > = {
      pending: ['running', 'blocked', 'cancelled'],
      running: ['completed', 'blocked', 'failed', 'cancelled'],
      completed: [],
      blocked: ['pending'],
      failed: ['pending'],
      cancelled: ['pending'],
    };
    if (!allowed[from].includes(to)) {
      throw new BadRequestException(`非法工作流步骤状态变化：${from} -> ${to}`);
    }
  }

  private aggregateRun(steps: AiEmployeeWorkflowStepRun[]) {
    const readbacks = steps
      .filter((step) => Boolean(step.readback))
      .map((step) => ({
        stepId: step.stepId,
        title: step.title,
        matched: step.readback?.matched === true,
        expectedText: step.readback?.expectedText,
        actualText: step.readback?.actualText,
      }));
    return {
      totalSteps: steps.length,
      pendingSteps: steps.filter((step) => step.status === 'pending').length,
      runningSteps: steps.filter((step) => step.status === 'running').length,
      completedSteps: steps.filter((step) => step.status === 'completed')
        .length,
      blockedSteps: steps.filter((step) => step.status === 'blocked').length,
      failedSteps: steps.filter((step) => step.status === 'failed').length,
      cancelledSteps: steps.filter((step) => step.status === 'cancelled')
        .length,
      evidenceCount: steps.reduce(
        (total, step) => total + step.evidence.length,
        0,
      ),
      candidateCount: steps.reduce(
        (total, step) => total + (step.output?.candidateCount || 0),
        0,
      ),
      readbacks,
    } satisfies AiEmployeeWorkflowAggregate;
  }

  private emptyAggregate(totalSteps: number): AiEmployeeWorkflowAggregate {
    return {
      totalSteps,
      pendingSteps: totalSteps,
      runningSteps: 0,
      completedSteps: 0,
      blockedSteps: 0,
      failedSteps: 0,
      cancelledSteps: 0,
      evidenceCount: 0,
      candidateCount: 0,
      readbacks: [],
    };
  }

  private resolveRunStatus(
    aggregate: AiEmployeeWorkflowAggregate,
    cancelled: boolean,
  ): AiEmployeeWorkflowRun['status'] {
    if (cancelled) return 'cancelled';
    if (aggregate.pendingSteps || aggregate.runningSteps) return 'running';
    if (aggregate.completedSteps === aggregate.totalSteps) return 'completed';
    if (aggregate.completedSteps > 0) return 'partial';
    if (aggregate.failedSteps > 0) return 'failed';
    if (aggregate.blockedSteps > 0) return 'blocked';
    if (aggregate.cancelledSteps > 0) return 'cancelled';
    return 'failed';
  }

  private async findDefinition(id: string) {
    const scope = await this.resolveTenantScope();
    const store = await this.readStore();
    return store.definitions.find(
      (item) => item.id === id && this.inTenantScope(item, scope),
    );
  }

  private async upsertDefinition(definition: AiEmployeeWorkflowDefinition) {
    return this.mutateStore((store) => ({
      store: {
        ...store,
        definitions: this.retainPerTenant(
          [
            definition,
            ...store.definitions.filter(
              (item) =>
                item.id !== definition.id ||
                !this.inTenantScope(item, definition),
            ),
          ],
          WORKFLOW_STORE_DEFINITION_LIMIT,
        ),
      },
      result: definition,
    }));
  }

  private async upsertRun(run: AiEmployeeWorkflowRun) {
    return this.mutateStore((store) => ({
      store: {
        ...store,
        runs: this.retainPerTenant(
          [
            run,
            ...store.runs.filter(
              (item) => item.id !== run.id || !this.inTenantScope(item, run),
            ),
          ],
          WORKFLOW_STORE_RUN_LIMIT,
        ),
      },
      result: run,
    }));
  }

  private async updateRun(
    runId: string,
    updater: (run: AiEmployeeWorkflowRun) => AiEmployeeWorkflowRun,
    requestedScope?: WorkflowTenantScope,
  ) {
    const scope = requestedScope || (await this.resolveTenantScope());
    return this.mutateStore((store) => {
      const existing = store.runs.find(
        (item) => item.id === runId && this.inTenantScope(item, scope),
      );
      if (!existing) {
        throw new BadRequestException('工作流运行记录不存在');
      }
      const updated = updater(this.clone(existing));
      const normalized = this.normalizeRun(updated, store.definitions);
      return {
        store: {
          ...store,
          runs: store.runs.map((item) =>
            item.id === runId && this.inTenantScope(item, scope)
              ? normalized
              : item,
          ),
        },
        result: normalized,
      };
    });
  }

  private async updateStep(
    runId: string,
    stepId: string,
    updater: (step: AiEmployeeWorkflowStepRun) => AiEmployeeWorkflowStepRun,
    scope?: WorkflowTenantScope,
  ) {
    const run = await this.updateRun(
      runId,
      (current) => {
        const existingStep = current.steps.find(
          (step) => step.stepId === stepId,
        );
        if (!existingStep) {
          throw new BadRequestException('工作流步骤不存在');
        }
        const now = new Date().toISOString();
        const steps = current.steps.map((step) =>
          step.stepId === stepId ? updater(this.clone(step)) : step,
        );
        return {
          ...current,
          steps,
          aggregate: this.aggregateRun(steps),
          updatedAt: now,
        };
      },
      scope,
    );
    const updated = run.steps.find((step) => step.stepId === stepId);
    if (!updated) throw new BadRequestException('工作流步骤不存在');
    return updated;
  }

  private async readStore() {
    await this.storeMutation;
    if (!this.storeReady) this.storeReady = this.loadStore();
    return this.storeReady;
  }

  private async mutateStore<T>(
    mutator: (store: AiEmployeeWorkflowStore) => {
      store: AiEmployeeWorkflowStore;
      result: T;
    },
  ): Promise<T> {
    const previous = this.storeMutation;
    const resultPromise = previous.then(async () => {
      if (!this.storeReady) this.storeReady = this.loadStore();
      const current = this.clone(await this.storeReady);
      const mutation = mutator(current);
      const normalized = this.normalizeStore(mutation.store);
      await this.writeStore(normalized);
      this.storeReady = Promise.resolve(normalized);
      return this.clone(mutation.result);
    });
    this.storeMutation = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  private async loadStore(): Promise<AiEmployeeWorkflowStore> {
    const filePath = this.workflowStorePath();
    try {
      const raw = await readFile(filePath, 'utf8');
      return this.normalizeStore(JSON.parse(raw) as AiEmployeeWorkflowStore, {
        recoverInterrupted: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `Workflow store read failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return this.emptyStore();
    }
  }

  private async writeStore(store: AiEmployeeWorkflowStore) {
    const filePath = this.workflowStorePath();
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });
    try {
      await writeFile(temporaryPath, JSON.stringify(store, null, 2), 'utf8');
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private normalizeStore(
    input: AiEmployeeWorkflowStore,
    options: { recoverInterrupted?: boolean } = {},
  ) {
    const definitions = this.retainPerTenant(
      Array.isArray(input?.definitions)
        ? input.definitions
            .filter((item) => Boolean(item?.id && Array.isArray(item.steps)))
            .map((item) => ({
              ...item,
              title: this.sanitizeWorkflowMessage(item.title),
              tenantId: item.tenantId || LEGACY_WORKFLOW_TENANT,
              userId: item.userId || LEGACY_WORKFLOW_USER,
              schedule: this.normalizeSchedule(item.schedule),
            }))
        : [],
      WORKFLOW_STORE_DEFINITION_LIMIT,
    );
    const runs = this.retainPerTenant(
      Array.isArray(input?.runs)
        ? input.runs
            .filter((item) => Boolean(item?.id && Array.isArray(item.steps)))
            .map((run) =>
              this.normalizeRun(run, definitions, {
                recoverInterrupted: options.recoverInterrupted === true,
              }),
            )
        : [],
      WORKFLOW_STORE_RUN_LIMIT,
    );
    return {
      version: WORKFLOW_STORE_VERSION,
      definitions,
      runs,
    } satisfies AiEmployeeWorkflowStore;
  }

  private normalizeRun(
    input: AiEmployeeWorkflowRun,
    definitions: AiEmployeeWorkflowDefinition[],
    options: { recoverInterrupted?: boolean } = {},
  ): AiEmployeeWorkflowRun {
    const scope = {
      tenantId: input.tenantId || LEGACY_WORKFLOW_TENANT,
      userId: input.userId || LEGACY_WORKFLOW_USER,
    };
    const definition = definitions.find(
      (item) => item.id === input.workflowId && this.inTenantScope(item, scope),
    );
    const steps = input.steps.map((step) => {
      const definitionStep = definition?.steps.find(
        (item) => item.id === step.stepId,
      );
      const evidence = Array.isArray(step.evidence) ? step.evidence : [];
      const transitions = Array.isArray(step.transitions)
        ? step.transitions
        : [];
      const normalized = {
        ...step,
        title: this.sanitizeWorkflowMessage(step.title),
        message: this.sanitizeWorkflowMessage(step.message),
        nextAction: step.nextAction
          ? this.sanitizeWorkflowMessage(step.nextAction)
          : undefined,
        technicalMessage: step.technicalMessage
          ? this.sanitizeWorkflowMessage(step.technicalMessage)
          : undefined,
        evidence,
        transitions: transitions.map((transition) => ({
          ...transition,
          message: this.sanitizeWorkflowMessage(transition.message),
        })),
      };
      if (step.status !== 'completed') return normalized;
      const hasEvidence = evidence.some(
        (item) =>
          item.label !== EXPOSURE_CONTRACT_EVIDENCE_LABEL &&
          Boolean(item.path || item.value || item.raw),
      );
      const hasReadback =
        !definitionStep?.requiresReadback || step.readback?.matched === true;
      if (hasEvidence && hasReadback) return normalized;
      const now = new Date().toISOString();
      return {
        ...normalized,
        status: 'failed' as const,
        reasonCode: 'readback_failed' as const,
        message: hasEvidence
          ? '持久化记录缺少匹配回读，完成状态已撤销。'
          : '持久化记录缺少执行证据，完成状态已撤销。',
        nextAction: '重新执行并保留真实证据和回读。',
        finishedAt: now,
        transitions: [
          ...normalized.transitions,
          {
            from: 'completed' as const,
            to: 'failed' as const,
            at: now,
            attempt: step.attempt,
            message: '读取持久化记录时发现完成证据不完整。',
          },
        ],
      };
    });
    const wasActive =
      input.status === 'queued' ||
      input.status === 'running' ||
      input.status === 'cancelling';
    const recoveredAt = new Date().toISOString();
    const recoveredSteps =
      options.recoverInterrupted && wasActive
        ? steps.map((step) => {
            if (this.isTerminalStepStatus(step.status)) return step;
            const message =
              step.status === 'running'
                ? '服务重启时本步骤仍在处理中，结果无法确认，已标记为失败。'
                : '服务重启前本步骤尚未开始，已停止等待。';
            return {
              ...step,
              status: 'failed' as const,
              reasonCode: 'runtime_unavailable' as const,
              message,
              nextAction:
                step.status === 'running'
                  ? '先核对平台结果，再决定是否重试。'
                  : '确认执行条件后可以重试。',
              finishedAt: recoveredAt,
              transitions: [
                ...step.transitions,
                {
                  from: step.status,
                  to: 'failed' as const,
                  at: recoveredAt,
                  attempt: step.attempt,
                  message,
                },
              ],
            };
          })
        : steps;
    const aggregate = this.aggregateRun(recoveredSteps);
    const confirmation = this.normalizeConfirmationMetadata(input.confirmation);
    const confirmations = (
      Array.isArray(input.confirmations)
        ? input.confirmations
        : confirmation
          ? [confirmation]
          : []
    )
      .map((item) => this.normalizeConfirmationMetadata(item))
      .filter((item): item is AiEmployeeWorkflowConfirmationMetadata =>
        Boolean(item),
      );
    const recovered = options.recoverInterrupted === true && wasActive;
    return {
      ...input,
      ...scope,
      title: this.sanitizeWorkflowMessage(input.title),
      confirmation: confirmation || confirmations.at(-1),
      confirmations,
      steps: recoveredSteps,
      aggregate,
      status: recovered
        ? this.resolveRunStatus(aggregate, false)
        : wasActive
          ? input.status
          : this.resolveRunStatus(
              aggregate,
              input.status === 'cancelled' || Boolean(input.cancelRequestedAt),
            ),
      updatedAt: recovered ? recoveredAt : input.updatedAt,
      finishedAt: recovered ? recoveredAt : input.finishedAt,
      recovery: recovered
        ? {
            recoveredAt,
            previousStatus: input.status as 'queued' | 'running' | 'cancelling',
            message: '服务重启后已停止不确定的运行状态，请核对结果后再重试。',
          }
        : input.recovery,
    };
  }

  async recoverInterruptedWorkflowRuns() {
    await this.readStore();
    await this.mutateStore((store) => ({ store, result: undefined }));
  }

  private retainPerTenant<T extends { tenantId?: string }>(
    items: T[],
    limit: number,
  ) {
    const counts = new Map<string, number>();
    return items.filter((item) => {
      const tenantId = item.tenantId || LEGACY_WORKFLOW_TENANT;
      const count = counts.get(tenantId) || 0;
      if (count >= limit) return false;
      counts.set(tenantId, count + 1);
      return true;
    });
  }

  private normalizeSchedule(
    input?: AiEmployeeWorkflowSchedule,
  ): AiEmployeeWorkflowSchedule | undefined {
    if (!input?.frequency || !input.timeWindow) return undefined;
    try {
      this.parseWorkflowFrequency(input.frequency);
      this.parseWorkflowTimeWindow(input.timeWindow);
    } catch {
      return undefined;
    }
    const authorization = this.normalizeConfirmationMetadata(
      input.authorization,
    );
    const nextRunAt = input.nextRunAt ? new Date(input.nextRunAt) : undefined;
    const active =
      input.status === 'active' &&
      Boolean(authorization) &&
      Boolean(nextRunAt && !Number.isNaN(nextRunAt.getTime()));
    return {
      enabled: true,
      frequency: this.sanitizeWorkflowMessage(input.frequency),
      timeWindow: this.sanitizeWorkflowMessage(input.timeWindow),
      timezone:
        this.sanitizeWorkflowMessage(input.timezone) ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        'local',
      status: active ? 'active' : 'awaiting_confirmation',
      nextRunAt: active ? nextRunAt?.toISOString() : undefined,
      lastScheduledAt: input.lastScheduledAt,
      authorization,
    };
  }

  private requireRunConfirmation(
    input: AiEmployeeWorkflowConfirmationMetadata | undefined,
    source: 'manual' | 'retry',
  ) {
    const confirmation = this.normalizeConfirmationMetadata(input);
    if (
      !confirmation ||
      confirmation.source !== source ||
      confirmation.action !== 'runtime-control' ||
      confirmation.riskLevel !== 'high'
    ) {
      throw new BadRequestException('请先确认本次工作流操作');
    }
    return confirmation;
  }

  private normalizeConfirmationMetadata(
    input?: AiEmployeeWorkflowConfirmationMetadata,
  ): AiEmployeeWorkflowConfirmationMetadata | undefined {
    if (!input) return undefined;
    const auditId = this.readText(input.auditId);
    const confirmationId = this.readText(input.confirmationId);
    const action = this.readText(input.action);
    const operator = this.sanitizeWorkflowMessage(input.operator);
    const confirmedAt = new Date(input.confirmedAt);
    const appliedAt = new Date(input.appliedAt);
    const sources = ['manual', 'retry', 'schedule'] as const;
    const riskLevels = ['low', 'medium', 'high'] as const;
    if (
      !auditId ||
      !confirmationId ||
      !action ||
      !operator ||
      Number.isNaN(confirmedAt.getTime()) ||
      Number.isNaN(appliedAt.getTime()) ||
      !sources.includes(input.source) ||
      !riskLevels.includes(input.riskLevel)
    ) {
      return undefined;
    }
    return {
      auditId,
      confirmationId,
      action,
      riskLevel: input.riskLevel,
      operator,
      operatorId: this.readText(input.operatorId) || undefined,
      reason: input.reason
        ? this.sanitizeWorkflowMessage(input.reason)
        : undefined,
      confirmedAt: confirmedAt.toISOString(),
      appliedAt: appliedAt.toISOString(),
      source: input.source,
      parentAuditId: this.readText(input.parentAuditId) || undefined,
      checklist:
        input.checklist && typeof input.checklist === 'object'
          ? Object.fromEntries(
              Object.entries(input.checklist)
                .filter(([, value]) => typeof value === 'boolean')
                .slice(0, 20),
            )
          : undefined,
    };
  }

  private sanitizeWorkflowMessage(value: unknown) {
    const source =
      typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? String(value)
          : '';
    const withoutControlCharacters = Array.from(source)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code === 10 || code === 13 || code >= 32;
      })
      .join('');
    return withoutControlCharacters
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(
        /\b(?:bearer|api[_-]?key|access[_-]?token|password)\s*[:=]?\s*[^\s,;]+/gi,
        '[敏感信息已隐藏]',
      )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, WORKFLOW_MESSAGE_LIMIT);
  }

  private safeTechnicalMessage(error: unknown) {
    return this.sanitizeWorkflowMessage(
      error instanceof Error ? error.message : String(error),
    );
  }

  private emptyStore(): AiEmployeeWorkflowStore {
    return {
      version: WORKFLOW_STORE_VERSION,
      definitions: [],
      runs: [],
    };
  }

  private workflowStorePath() {
    return (
      process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH ||
      resolveProjectDataPath('ai-employee', 'workflows.json')
    );
  }

  private inTenantScope(
    value: { tenantId?: string; userId?: string },
    scope: WorkflowTenantScope,
  ) {
    return value.tenantId === scope.tenantId && value.userId === scope.userId;
  }

  private async resolveTenantScope(): Promise<WorkflowTenantScope> {
    if (!this.authRequestContext || !this.prisma) {
      return {
        tenantId: LEGACY_WORKFLOW_TENANT,
        userId: LEGACY_WORKFLOW_USER,
      };
    }

    const user = this.authRequestContext.get()?.user;
    const userId = user?.id?.trim() || '';
    if (!userId) {
      throw new UnauthorizedException('请先登录后访问工作流。');
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

  private normalizePlatform(value: unknown): ExecutorTaskPlatform {
    const platform = this.readText(value);
    const supported: ExecutorTaskPlatform[] = [
      'douyin',
      'wechat-channel',
      'xiaohongshu',
      'kuaishou',
      'bilibili',
      'wechat-desktop',
      'mixed',
    ];
    return supported.includes(platform as ExecutorTaskPlatform)
      ? (platform as ExecutorTaskPlatform)
      : 'douyin';
  }

  private normalizeExposureMode(value: unknown): AiEmployeeExposureMode {
    const normalized = this.readText(value);
    const modes: AiEmployeeExposureMode[] = [
      'link',
      'search_account',
      'hot_video',
      'targeted',
      'retention',
    ];
    return modes.includes(normalized as AiEmployeeExposureMode)
      ? (normalized as AiEmployeeExposureMode)
      : 'link';
  }

  private normalizeExposureExecutionKind(
    value: unknown,
  ): AiEmployeeExposureExecutionKind {
    return this.readText(value) === 'customer_action'
      ? 'customer_action'
      : 'candidate_read';
  }

  private parseCandidates(value?: string) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object' && !Array.isArray(item)),
          )
        : [];
    } catch {
      return [];
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private readText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private readTextList(value: unknown) {
    if (Array.isArray(value)) {
      return Array.from(
        new Set(value.map((item) => this.readText(item)).filter(Boolean)),
      );
    }
    return this.splitText(this.readText(value));
  }

  private splitText(value: string) {
    return Array.from(
      new Set(
        value
          .split(/[\n,，;；]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  private readPositiveInteger(value: unknown, fallback: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.floor(parsed), max);
  }

  private hasTextItems(value: unknown) {
    return this.readTextList(value).length > 0;
  }

  private isExternalAction(step: AiEmployeeWorkflowStepDefinition) {
    return (
      step.actionKind === 'customer_action' ||
      step.actionKind === 'platform_action'
    );
  }

  private isTerminalStepStatus(status: AiEmployeeWorkflowStepStatus) {
    return (
      status === 'completed' ||
      status === 'blocked' ||
      status === 'failed' ||
      status === 'cancelled'
    );
  }

  private isTerminalRunStatus(status: AiEmployeeWorkflowRun['status']) {
    return (
      status === 'completed' ||
      status === 'partial' ||
      status === 'blocked' ||
      status === 'failed' ||
      status === 'cancelled'
    );
  }

  private exposureModeLabel(mode: AiEmployeeExposureMode) {
    const labels: Record<AiEmployeeExposureMode, string> = {
      link: '链接曝光',
      search_account: '账号搜索曝光',
      hot_video: '爆款视频曝光',
      targeted: '定向曝光',
      retention: '留资曝光',
    };
    return labels[mode];
  }

  private platformLabel(platform: ExecutorTaskPlatform) {
    const labels: Partial<Record<ExecutorTaskPlatform, string>> = {
      douyin: '抖音',
      xiaohongshu: '小红书',
      kuaishou: '快手',
      bilibili: 'B站',
      'wechat-channel': '视频号',
      'wechat-desktop': '微信',
      mixed: '多平台',
    };
    return labels[platform] || platform;
  }

  private clone<T>(value: T): T {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
