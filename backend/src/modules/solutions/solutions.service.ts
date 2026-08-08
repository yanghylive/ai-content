import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Prisma,
  SolutionResult as PrismaSolutionResult,
  SolutionRun as PrismaSolutionRun,
  SolutionTask as PrismaSolutionTask,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ComplianceService } from '../compliance/compliance.service';
import { ContentOptimizationService } from '../content-optimization/content-optimization.service';
import { CrmService } from '../crm/crm.service';
import { RedfoxSkillRunnerService } from '../redfox/redfox-skill-runner.service';
import {
  findRedfoxSkillMapping,
  findRedfoxSkillMappingByPath,
  REDFOX_SKILL_MAPPINGS,
  type RedfoxSkillMapping,
} from '../redfox/redfox-skill-mapping.catalog';
import type { RedfoxSkillRunResult } from '../redfox/redfox.types';
import { SOLUTION_PACKAGES } from './solutions.catalog';
import type {
  ApproveSolutionManualTaskRequest,
  ApproveSolutionManualTaskResult,
  ConfirmSolutionOutputDraftsRequest,
  ConfirmSolutionOutputDraftsResult,
  CreateSolutionRunRequest,
  ExecuteSolutionResultActionRequest,
  ExecuteSolutionResultActionResult,
  RunSolutionTaskRedfoxRequest,
  SolutionPackageCategory,
  SolutionPackageDefinition,
  SolutionProductizationProfile,
  SolutionPackageListResult,
  SolutionRedfoxMappingCoverageItem,
  SolutionRedfoxMappingCoverageResult,
  SolutionPackageSummary,
  SolutionRunListResult,
  SolutionRunPlan,
  SolutionRunRecord,
  SolutionRunTaskRecord,
  SolutionTaskRedfoxDryRunResult,
  SolutionTaskRedfoxExecutionResult,
} from './solutions.types';

const OUTPUT_DRAFT_CONFIRMATION = 'PERSIST_REDFOX_OUTPUT_DRAFTS';
const CONFIRMABLE_REDFOX_OUTPUT_OBJECTS = new Set([
  'Topic',
  'Material',
  'Article',
]);

const BUSINESS_OBJECT_LABELS: Record<string, string> = {
  AgentConfirmation: '人工确认',
  Article: '内容草稿',
  BenchmarkAccount: '对标账号',
  CommentInsight: '评论洞察',
  ComplianceCheck: '合规检查',
  CrmCustomer: '客户线索',
  CrmTask: '跟进任务',
  EvidenceAttachment: '证据附件',
  GrowthAccountHealth: '账号体检',
  GrowthLead: '增长线索',
  GrowthReport: '增长报告',
  IntelligenceItem: '情报条目',
  IntelligenceMonitor: '监控任务',
  IntelligenceReport: '情报报告',
  KnowledgeItem: '知识条目',
  Material: '素材',
  PublishRecord: '发布记录',
  RedfoxCallLog: '接入记录',
  RiskEvidence: '风险证据',
  RuntimeExecution: '执行记录',
  Seedance: '视频素材',
  SolutionRun: '运行记录',
  SolutionRunItem: '机会条目',
  Topic: '选题',
};

const INTERNAL_OBJECTS = new Set([
  'SolutionRun',
  'RedfoxCallLog',
  'RuntimeExecution',
]);

const SOLUTION_TASK_READY_STATUSES = new Set([
  'dry_run_ready',
  'approval_required',
  'succeeded',
  'skipped',
]);

const SOLUTION_TASK_RUNNABLE_STATUSES = new Set([
  'queued',
  'planned',
  'dry_run_ready',
  'failed',
]);

const SOLUTION_TASK_EXECUTABLE_STATUSES = new Set([
  'queued',
  'planned',
  'dry_run_ready',
  'approval_required',
  'failed',
]);

const SOLUTION_MANUAL_TASK_APPROVABLE_STATUSES = new Set([
  'approval_required',
  'planned',
  'queued',
  'failed',
]);

type RedfoxNormalizedRecord = {
  objectType: string;
  status: 'ready_for_persistence';
  dedupeKey: string;
  preview: Record<string, unknown>;
  source: Record<string, unknown>;
  data: Record<string, unknown>;
};

type RedfoxNormalizedOutput = {
  records: RedfoxNormalizedRecord[];
  counts: Record<string, number>;
  sourceKind: string;
  confidence: 'medium' | 'none';
  persistence?: RedfoxNormalizedPersistenceResult;
};

type RedfoxBusinessObjectRef = {
  objectType: string;
  status: string;
  refId: string | null;
  source: string;
  dedupeKey?: string;
  preview?: Record<string, unknown>;
  index?: number;
  persistence?: string;
  reason?: string;
};

type RedfoxOutputNormalizationPlan = {
  status: string;
  businessObjectRefs: RedfoxBusinessObjectRef[];
  counts: Record<string, unknown>;
  nextAction: string;
  payloadSummary: Record<string, unknown>;
  rawResultJson: {
    type: string;
    packageCode: string;
    status: string;
    mapping: Record<string, unknown> | null;
    normalized: RedfoxNormalizedOutput;
    redfoxRun: Record<string, unknown>;
  };
};

type RedfoxNormalizedPersistenceRecord = {
  objectType: string;
  dedupeKey: string;
  refId: string;
  action: 'created' | 'reused';
  source: string;
};

type RedfoxNormalizedPersistenceSkip = {
  objectType: string;
  dedupeKey: string;
  reason: string;
};

type RedfoxNormalizedPersistenceResult = {
  persistedRecords: RedfoxNormalizedPersistenceRecord[];
  skippedRecords: RedfoxNormalizedPersistenceSkip[];
  counts: {
    persistedObjects: number;
    reusedObjects: number;
    skippedPersistenceObjects: number;
  };
};

type RedfoxNormalizedPersistenceContext = {
  benchmarkAccountIdsByLinkKey: Map<string, string>;
  materialIdsByLinkKey: Map<string, string>;
  topicIdsByLinkKey: Map<string, string>;
  commentInsightIdsByLinkKey: Map<string, string>;
  growthLeadIdsByLinkKey: Map<string, string>;
};

type SolutionResultActionObject = {
  objectType: string;
  refId: string;
  source: string;
  href: string;
  message: string;
  status: 'created' | 'reused';
  extraRefs?: RedfoxBusinessObjectRef[];
};

type RedfoxConfirmedOutputRef = {
  objectType: string;
  dedupeKey: string;
  refId: string;
  source: string;
  linkKey: string;
};

type RedfoxOutputDraftConfirmationState = {
  createdRefs: RedfoxConfirmedOutputRef[];
  skippedRefs: RedfoxNormalizedPersistenceSkip[];
  materialIdsByLinkKey: Map<string, string>;
  topicIdsByLinkKey: Map<string, string>;
};

@Injectable()
export class SolutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redfoxSkillRunner: RedfoxSkillRunnerService,
    private readonly crmService: CrmService,
    private readonly contentOptimizationService: ContentOptimizationService,
    private readonly complianceService: ComplianceService,
  ) {}

  list(category?: SolutionPackageCategory): SolutionPackageListResult {
    const items = (
      category
        ? SOLUTION_PACKAGES.filter((item) => item.category === category)
        : SOLUTION_PACKAGES
    ).map((item) => this.enrichPackage(item));

    return {
      items,
      summary: this.createSummary(items),
    };
  }

  getSummary(): SolutionPackageSummary {
    return this.createSummary(
      SOLUTION_PACKAGES.map((item) => this.enrichPackage(item)),
    );
  }

  getRedfoxMappingCoverage(): SolutionRedfoxMappingCoverageResult {
    const items = SOLUTION_PACKAGES.flatMap((packageItem) =>
      packageItem.redfoxSkills.map((skillName) => {
        const mapping = findRedfoxSkillMapping(skillName);
        const executionReady = Boolean(mapping?.path);
        const skillHubReady = Boolean(mapping?.skillHubRefs?.length);
        const integrationReady = Boolean(executionReady || skillHubReady);
        const executionStatus: SolutionRedfoxMappingCoverageItem['executionStatus'] =
          mapping
            ? executionReady
              ? 'verified_api_path'
              : skillHubReady
                ? 'verified_skillhub'
                : 'contract_only'
            : 'unmapped';
        return {
          packageCode: packageItem.code,
          packageName: packageItem.name,
          skillName,
          mapped: Boolean(mapping),
          integrationReady,
          executionReady,
          executionStatus,
          mappingCode: mapping?.code || null,
          skillCode: mapping?.skillCode || null,
          normalizedSkillName: mapping?.skillName || null,
          platform: mapping?.platform || null,
          scenario: mapping?.scenario || null,
          path: mapping?.path || null,
          skillHubRefs: mapping?.skillHubRefs || [],
          outputObjects: mapping?.outputObjects || [],
          missingReason: mapping ? null : 'not_in_redfox_skill_mapping_catalog',
        };
      }),
    );
    const uniqueSkillNames = new Set(items.map((item) => item.skillName));
    const uniqueMappedSkillNames = new Set(
      items.filter((item) => item.mapped).map((item) => item.skillName),
    );
    const uniqueVerifiedApiPathSkillNames = new Set(
      items
        .filter((item) => item.executionStatus === 'verified_api_path')
        .map((item) => item.skillName),
    );
    const uniqueVerifiedSkillHubSkillNames = new Set(
      items
        .filter((item) => item.executionStatus === 'verified_skillhub')
        .map((item) => item.skillName),
    );
    const uniqueContractOnlySkillNames = new Set(
      items
        .filter((item) => item.executionStatus === 'contract_only')
        .map((item) => item.skillName),
    );
    const uniqueUnmappedSkills = Array.from(
      new Set(
        items.filter((item) => !item.mapped).map((item) => item.skillName),
      ),
    ).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
    const contractOnlySkills = Array.from(uniqueContractOnlySkillNames).sort(
      (left, right) => left.localeCompare(right, 'zh-Hans-CN'),
    );

    return {
      totalPackageSkillRefs: items.length,
      mappedPackageSkillRefs: items.filter((item) => item.mapped).length,
      verifiedApiPathRefs: items.filter((item) => item.executionReady).length,
      verifiedSkillHubRefs: items.filter(
        (item) => item.executionStatus === 'verified_skillhub',
      ).length,
      contractOnlyRefs: items.filter(
        (item) => item.executionStatus === 'contract_only',
      ).length,
      unmappedPackageSkillRefs: items.filter((item) => !item.mapped).length,
      uniqueSkillCount: uniqueSkillNames.size,
      uniqueMappedSkillCount: uniqueMappedSkillNames.size,
      uniqueVerifiedApiPathSkillCount: uniqueVerifiedApiPathSkillNames.size,
      uniqueVerifiedSkillHubSkillCount: uniqueVerifiedSkillHubSkillNames.size,
      uniqueContractOnlySkillCount: uniqueContractOnlySkillNames.size,
      uniqueUnmappedSkillCount: uniqueUnmappedSkills.length,
      mappingCatalogSize: REDFOX_SKILL_MAPPINGS.length,
      unmappedSkills: uniqueUnmappedSkills,
      contractOnlySkills,
      items,
    };
  }

  getByCode(code: string): SolutionPackageDefinition {
    const normalizedCode = code.trim();
    const item = SOLUTION_PACKAGES.find(
      (packageItem) => packageItem.code === normalizedCode,
    );
    if (!item) {
      throw new NotFoundException('方案包不存在');
    }
    return this.enrichPackage(item);
  }

  createRunPlan(code: string): SolutionRunPlan {
    const packageItem = this.getByCode(code);
    const ownerGroups = packageItem.ownerGroups.length
      ? packageItem.ownerGroups
      : ['产品架构组'];
    const productization =
      packageItem.productization ||
      this.createProductizationProfile(packageItem);

    return {
      packageCode: packageItem.code,
      packageName: packageItem.name,
      generatedAt: new Date().toISOString(),
      status: 'ready_for_mapping',
      ownerGroups,
      requiredDataObjects: packageItem.dataObjects,
      steps: packageItem.workflow.map((stepName, index) => ({
        order: index + 1,
        name: stepName,
        ownerGroup: ownerGroups[index % ownerGroups.length],
        inputs:
          index === 0
            ? packageItem.dataObjects.slice(0, 2)
            : packageItem.dataObjects.slice(0, 3),
        outputs: packageItem.dataObjects.slice(-2),
        redfoxSkills: index === 0 ? packageItem.redfoxSkills : [],
        businessCheckpoint:
          packageItem.acceptance[index % packageItem.acceptance.length] ??
          '完成阶段性交付物并记录证据',
        deliverables: productization.deliverables.slice(0, 3),
        requiresApproval:
          index === 0 ||
          index === packageItem.workflow.length - 1 ||
          stepName.includes('确认') ||
          stepName.includes('风险'),
        estimatedMinutes: stepName.includes('RedFox') || index === 0 ? 12 : 8,
      })),
      acceptance: packageItem.acceptance,
      warnings: [
        '当前返回的是方案包执行计划，不会直接调用 RedFox 或写入业务数据。',
        '进入可执行版本前需要补齐任务编排、成本限额、确认流和结果落库。',
      ],
    };
  }

  async listRuns(
    actor: AuthenticatedUser,
    packageCode?: string,
  ): Promise<SolutionRunListResult> {
    const where: Prisma.SolutionRunWhereInput = {
      userId: actor.id,
      ...(packageCode ? { packageCode } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.solutionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          tasks: { orderBy: { order: 'asc' } },
          results: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      }),
      this.prisma.solutionRun.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toRunRecord(item)),
      total,
    };
  }

  async getRun(
    actor: AuthenticatedUser,
    runId: string,
  ): Promise<SolutionRunRecord> {
    const run = await this.prisma.solutionRun.findFirst({
      where: { id: runId, userId: actor.id },
      include: {
        tasks: { orderBy: { order: 'asc' } },
        results: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!run) {
      throw new NotFoundException('方案运行不存在');
    }
    return this.toRunRecord(run);
  }

  async executeResultAction(
    actor: AuthenticatedUser,
    runId: string,
    request: ExecuteSolutionResultActionRequest,
  ): Promise<ExecuteSolutionResultActionResult> {
    const run = await this.prisma.solutionRun.findFirst({
      where: { id: runId, userId: actor.id },
      include: {
        tasks: { orderBy: { order: 'asc' } },
        results: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!run) {
      throw new NotFoundException('方案运行不存在');
    }

    const actionKey = this.createSolutionResultActionKey(run, request);
    const existingResult = (run.results || []).find((result) => {
      if (result.kind !== 'business_result_action') return false;
      const summary = this.readJsonRecord(result.payloadSummary);
      return summary.actionKey === actionKey;
    });
    if (existingResult) {
      const refs = this.readBusinessObjectRefs(
        existingResult.businessObjectRefs,
      );
      const ref = refs.find((item) => item.refId) || refs[0];
      if (ref?.refId) {
        return {
          runId,
          actionKey,
          kind: request.kind,
          status: 'reused',
          message: this.solutionResultActionReusedMessage(request.kind),
          href:
            this.resultActionHref(request.kind, ref.refId) ||
            request.entryPath ||
            '/solutions',
          objectType: ref.objectType,
          refId: ref.refId,
          source: ref.source,
          result: this.toResultRecord(existingResult),
        };
      }
    }

    const created = await this.createSolutionResultActionObject(
      actor,
      run,
      request,
      actionKey,
    );
    if (!created.refId?.trim()) {
      throw new BadRequestException(
        `${request.label || request.kind} 未返回业务对象 ID，已阻止写入结果动作`,
      );
    }
    for (const extraRef of created.extraRefs || []) {
      if (!extraRef.refId?.trim()) {
        throw new BadRequestException(
          `${request.label || request.kind} 的关联业务对象缺少 ID，已阻止写入结果动作`,
        );
      }
    }
    const refs: RedfoxBusinessObjectRef[] = [
      {
        objectType: created.objectType,
        status: created.status,
        refId: created.refId,
        source: created.source,
        dedupeKey: actionKey,
      },
      ...(created.extraRefs || []),
    ];
    const result = await this.prisma.solutionResult.create({
      data: {
        runId,
        kind: 'business_result_action',
        status: created.status,
        businessObjectRefs: this.toJson(refs),
        counts: this.toJson({ businessActions: 1 }),
        nextAction: created.message,
        acceptedAt: new Date(),
        approvedBy: actor.id,
        payloadSummary: this.toJson({
          actionKey,
          kind: request.kind,
          label: request.label,
          targetModule: request.targetModule,
          description: request.description || null,
          href: created.href,
        }),
        rawResultJson: this.toJson({
          type: 'business_result_action',
          actionKey,
          request,
          refs,
        }),
      },
    });

    return {
      runId,
      actionKey,
      kind: request.kind,
      status: created.status,
      message: created.message,
      href: created.href,
      objectType: created.objectType,
      refId: created.refId,
      source: created.source,
      result: this.toResultRecord(result),
    };
  }

  async createRun(
    actor: AuthenticatedUser,
    code: string,
    request: CreateSolutionRunRequest = {},
  ): Promise<SolutionRunRecord> {
    const packageItem = this.getByCode(code);
    const plan = this.createRunPlan(code);
    const now = new Date();
    const input = request.input || {};
    const catalogSnapshotHash = this.hashJson({
      packageItem,
      planVersion: '2026-07-01',
    });
    const estimatedCostPoints = packageItem.redfoxSkills.length;
    const maxCostPoints =
      typeof request.maxCostPoints === 'number'
        ? Math.max(0, Math.floor(request.maxCostPoints))
        : Math.max(estimatedCostPoints, 10);

    const run = await this.prisma.solutionRun.create({
      data: {
        userId: actor.id,
        tenantId: null,
        packageCode: packageItem.code,
        packageName: packageItem.name,
        packageVersion: '2026-07-01',
        catalogSnapshotHash,
        trigger: request.trigger || 'manual',
        source: request.source || 'solutions',
        correlationId: `solution:${packageItem.code}:${randomUUID()}`,
        idempotencyKey: `solution:${packageItem.code}:${randomUUID()}`,
        status: 'queued',
        progress: 0,
        inputJson: this.toJson(input),
        resolvedPlanJson: this.toJson(plan),
        dataObjectMapping: this.toJson({
          requiredDataObjects: plan.requiredDataObjects,
          packageEntryPath: packageItem.entryPath,
          connectedEntryPath: packageItem.connectedEntryPath || null,
        }),
        riskLevel: request.riskLevel || 'medium',
        confirmationPolicy: request.confirmationPolicy || 'manual_required',
        sendMode: request.sendMode || 'approval-send',
        dryRun: request.dryRun ?? true,
        estimatedCostPoints,
        maxCostPoints,
        actualCostPoints: 0,
        costStatus: 'estimated',
        summaryJson: this.toJson({
          summary: packageItem.summary,
          customerValue: packageItem.customerValue,
          ownerGroups: packageItem.ownerGroups,
          redfoxSkills: packageItem.redfoxSkills,
          configuredInput: input,
          deliverables: packageItem.productization?.deliverables || [],
          roiMetrics: packageItem.productization?.roiMetrics || [],
          operatingCadence: packageItem.productization?.operatingCadence || [],
        }),
        outputRefs: this.toJson(
          (packageItem.productization?.deliverables || []).map(
            (deliverable, index) => ({
              label: deliverable,
              status: 'planned',
              targetModule:
                packageItem.productization?.resultModules[
                  index % packageItem.productization.resultModules.length
                ] ||
                packageItem.connectedEntryPath ||
                packageItem.entryPath,
            }),
          ),
        ),
        acceptanceChecks: this.toJson(
          packageItem.acceptance.map((label) => ({
            label,
            status: 'pending',
          })),
        ),
        tasks: {
          create: plan.steps.map((step) => ({
            stepKey: this.createStepKey(step.name, step.order),
            order: step.order,
            name: step.name,
            type: 'workflow_step',
            executorKind: step.redfoxSkills.length ? 'redfox' : 'manual',
            status: step.redfoxSkills.length ? 'queued' : 'approval_required',
            dependsOn: this.toJson(
              step.order > 1
                ? [
                    this.createStepKey(
                      plan.steps[step.order - 2].name,
                      step.order - 1,
                    ),
                  ]
                : [],
            ),
            attempt: 0,
            maxAttempts: step.redfoxSkills.length ? 2 : 1,
            inputJson: this.toJson({
              inputs: step.inputs,
              redfoxSkills: step.redfoxSkills,
              businessCheckpoint: step.businessCheckpoint,
              deliverables: step.deliverables,
              requiresApproval: step.requiresApproval,
            }),
            targetObject: step.outputs[0] || null,
            queuedAt: now,
          })),
        },
      },
      include: { tasks: { orderBy: { order: 'asc' } } },
    });

    return this.toRunRecord(run);
  }

  async dryRunRedfoxTask(
    actor: AuthenticatedUser,
    runId: string,
    taskId: string,
    request: RunSolutionTaskRedfoxRequest = {},
  ): Promise<SolutionTaskRedfoxDryRunResult> {
    const task = await this.prisma.solutionTask.findFirst({
      where: {
        id: taskId,
        runId,
        run: { userId: actor.id },
      },
      include: { run: true },
    });
    if (!task) {
      throw new NotFoundException('方案任务不存在');
    }
    if (task.executorKind !== 'redfox') {
      throw new BadRequestException('只有 RedFox 类型任务支持 Skill 试执行');
    }
    if (!SOLUTION_TASK_RUNNABLE_STATUSES.has(task.status)) {
      throw new BadRequestException(
        `当前任务状态为 ${task.status}，不能启动 RedFox Skill 试执行`,
      );
    }

    const taskInput = this.readJsonRecord(task.inputJson);
    const mappedSkills = this.readStringArray(taskInput.redfoxSkills);
    const skillName = request.skillName || request.skillCode || mappedSkills[0];
    if (!skillName) {
      throw new BadRequestException('该任务未绑定 RedFox Skill');
    }
    const redfoxInput = this.buildSolutionRedfoxInput(
      task.run,
      taskInput,
      request,
    );

    const estimatedCostPoints = Math.max(
      0,
      Math.floor(request.estimatedCostPoints ?? 1),
    );
    await this.assertRunBudgetAvailable(task.run, task.id, estimatedCostPoints);

    const executionStartedAt = new Date();
    await this.prisma.solutionTask.update({
      where: { id: task.id },
      data: {
        status: 'running',
        startedAt: executionStartedAt,
        endedAt: null,
        reasonCode: null,
        errorMessage: null,
        attempt: task.attempt + 1,
      },
    });

    const redfoxRun = await this.redfoxSkillRunner
      .runSkill(actor, {
        ...request,
        skillName,
        dryRun: true,
        solutionRunId: runId,
        solutionTaskId: taskId,
        estimatedCostPoints,
        operation:
          request.operation ||
          `solutions.${task.run.packageCode}.${task.stepKey}.redfox_dry_run`,
        query: request.query ?? redfoxInput,
        body: request.body ?? redfoxInput,
        input: {
          taskInput,
          userInput: redfoxInput,
        },
      })
      .catch(async (error) => {
        await this.markRedfoxTaskFailed(
          runId,
          task.id,
          executionStartedAt,
          error,
        );
        throw error;
      });

    await this.assertRunBudgetAvailable(
      task.run,
      task.id,
      redfoxRun.estimatedCostPoints,
    );

    const now = new Date();
    const idempotencyKey =
      request.idempotencyKey ||
      `solution-task-redfox-dry-run:${taskId}:${randomUUID()}`;
    const requestHash = this.hashJson({
      taskId,
      request,
      redfoxRun: {
        skill: redfoxRun.skill,
        endpoint: redfoxRun.endpoint,
        estimatedCostPoints: redfoxRun.estimatedCostPoints,
      },
    });

    const run = await this.prisma.$transaction(async (tx) => {
      await tx.solutionTask.update({
        where: { id: task.id },
        data: {
          status: 'dry_run_ready',
          outputJson: this.toJson(redfoxRun),
          reasonCode: null,
          errorMessage: null,
          endedAt: now,
          durationMs: now.getTime() - executionStartedAt.getTime(),
          requestHash,
          idempotencyKey,
        },
      });

      await tx.solutionResult.create({
        data: {
          runId,
          taskId,
          kind: 'redfox_dry_run',
          status: 'created',
          counts: this.toJson({
            warnings: redfoxRun.warnings.length,
            estimatedCostPoints: redfoxRun.estimatedCostPoints,
          }),
          nextAction: redfoxRun.warnings.join(' '),
          payloadSummary: this.toJson(redfoxRun.payloadSummary),
          rawResultJson: this.toJson(redfoxRun),
        },
      });

      await tx.solutionCostEntry.create({
        data: {
          runId,
          taskId,
          provider: 'redfox',
          operation: redfoxRun.endpoint.operation,
          skillCode: redfoxRun.skill.code || redfoxRun.skill.name,
          endpoint: redfoxRun.endpoint.path,
          estimatedCostPoints: redfoxRun.estimatedCostPoints,
          authorizedCostPoints: 0,
          capturedCostPoints: 0,
          refundedCostPoints: 0,
          billingStatus: 'estimated',
          requestHash,
          idempotencyKey,
          retryCount: 0,
        },
      });

      const tasks = await tx.solutionTask.findMany({
        where: { runId },
        select: { status: true },
      });
      const readyCount = tasks.filter((item) =>
        SOLUTION_TASK_READY_STATUSES.has(item.status),
      ).length;
      const progress = tasks.length
        ? Math.round((readyCount / tasks.length) * 100)
        : 0;
      const runStatus = progress >= 100 ? 'dry_run_ready' : 'running';

      await tx.solutionRun.update({
        where: { id: runId },
        data: {
          status: runStatus,
          progress,
          costStatus: 'budget_reserved',
        },
      });

      return tx.solutionRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          tasks: { orderBy: { order: 'asc' } },
          results: { orderBy: { createdAt: 'desc' } },
        },
      });
    });
    const record = this.toRunRecord(run);
    const updatedTask = record.tasks.find((item) => item.id === taskId);
    if (!updatedTask) {
      throw new NotFoundException('方案任务回写失败');
    }
    return {
      run: record,
      task: updatedTask,
      redfoxRun,
    };
  }

  async executeRedfoxTask(
    actor: AuthenticatedUser,
    runId: string,
    taskId: string,
    request: RunSolutionTaskRedfoxRequest = {},
  ): Promise<SolutionTaskRedfoxExecutionResult> {
    const task = await this.prisma.solutionTask.findFirst({
      where: {
        id: taskId,
        runId,
        run: { userId: actor.id },
      },
      include: { run: true },
    });
    if (!task) {
      throw new NotFoundException('方案任务不存在');
    }
    if (task.executorKind !== 'redfox') {
      throw new BadRequestException('只有 RedFox 类型任务支持真实执行');
    }
    if (!SOLUTION_TASK_EXECUTABLE_STATUSES.has(task.status)) {
      throw new BadRequestException(
        `当前任务状态为 ${task.status}，暂时不能生成业务结果`,
      );
    }

    const taskInput = this.readJsonRecord(task.inputJson);
    const mappedSkills = this.readStringArray(taskInput.redfoxSkills);
    const skillName = request.skillName || request.skillCode || mappedSkills[0];
    if (!skillName) {
      throw new BadRequestException('该任务未绑定 RedFox Skill');
    }
    const redfoxInput = this.buildSolutionRedfoxInput(
      task.run,
      taskInput,
      request,
    );

    const estimatedCostPoints = Math.max(
      0,
      Math.floor(request.estimatedCostPoints ?? 1),
    );
    await this.assertRunBudgetAvailable(task.run, task.id, estimatedCostPoints);

    const executionStartedAt = new Date();
    const approvalContext = {
      runId,
      taskId,
      packageCode: task.run.packageCode,
      stepKey: task.stepKey,
      skillCode: request.skillCode || null,
      skillName,
      mappedSkills,
      requestedEndpoint: {
        method: request.method || null,
        path: request.path || null,
      },
      estimatedCostPoints,
      maxCostPoints: task.run.maxCostPoints,
      actualCostPointsBefore: task.run.actualCostPoints || 0,
      executionMode: 'direct_user_action',
      confirmationPolicy: task.run.confirmationPolicy,
      sendMode: task.run.sendMode,
      approvalNote: request.approvalNote?.trim() || null,
      requestShape: {
        inputKeys: this.objectKeys(request.input),
        queryKeys: this.objectKeys(request.query),
        bodyKind: this.valueKind(request.body),
        bodyKeys: this.objectKeys(request.body),
      },
    };
    const approvalRequestHash = this.hashJson(approvalContext);
    const approvalAcceptedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      const approval = await tx.solutionResult.create({
        data: {
          runId,
          taskId,
          kind: 'redfox_execution_approval',
          status: 'approved',
          counts: this.toJson({
            estimatedCostPoints,
            maxCostPoints: task.run.maxCostPoints,
            actualCostPointsBefore: task.run.actualCostPoints || 0,
          }),
          nextAction: '用户已发起业务生成，系统开始调用 RedFox 能力。',
          acceptedAt: approvalAcceptedAt,
          approvedBy: actor.id,
          payloadSummary: this.toJson(approvalContext),
          rawResultJson: this.toJson({
            type: 'redfox_direct_execution_audit',
            approvalRequestHash,
            context: approvalContext,
          }),
        },
      });

      await tx.solutionTask.update({
        where: { id: task.id },
        data: {
          status: 'running',
          startedAt: executionStartedAt,
          endedAt: null,
          reasonCode: null,
          errorMessage: null,
          attempt: task.attempt + 1,
          agentConfirmationId: approval.id,
        },
      });
    });

    const {
      confirmRealExecution: _deprecatedConfirmRealExecution,
      ...executionRequest
    } = request;
    const redfoxRun = await this.redfoxSkillRunner
      .runSkill(actor, {
        ...executionRequest,
        skillName,
        dryRun: false,
        solutionRunId: runId,
        solutionTaskId: taskId,
        estimatedCostPoints,
        operation:
          request.operation ||
          `solutions.${task.run.packageCode}.${task.stepKey}.redfox_execute`,
        query: request.query ?? redfoxInput,
        body: request.body ?? redfoxInput,
        input: {
          taskInput,
          userInput: redfoxInput,
        },
      })
      .catch(async (error) => {
        if (this.isExecutionGateError(error)) {
          await this.markRedfoxTaskBlocked(
            runId,
            task.id,
            'real_execution_blocked',
            this.errorMessage(error),
          );
        } else {
          await this.markRedfoxTaskFailed(
            runId,
            task.id,
            executionStartedAt,
            error,
          );
        }
        throw error;
      });

    if (redfoxRun.status !== 'success') {
      const message = this.redfoxRunStatusMessage(redfoxRun);
      if (redfoxRun.status === 'blocked') {
        await this.markRedfoxTaskBlocked(
          runId,
          task.id,
          'redfox_skillhub_blocked',
          message,
          redfoxRun,
        );
      } else {
        await this.markRedfoxTaskFailed(
          runId,
          task.id,
          executionStartedAt,
          new Error(message),
          'redfox_skillhub_failed',
          redfoxRun,
        );
      }
      throw new BadRequestException(message);
    }

    await this.assertRunBudgetAvailable(
      task.run,
      task.id,
      redfoxRun.estimatedCostPoints,
    );

    const now = new Date();
    const idempotencyKey =
      request.idempotencyKey ||
      `solution-task-redfox-execute:${taskId}:${randomUUID()}`;
    const requestHash = this.hashJson({
      taskId,
      request,
      redfoxRun: {
        skill: redfoxRun.skill,
        endpoint: redfoxRun.endpoint,
        estimatedCostPoints: redfoxRun.estimatedCostPoints,
        callLogId: redfoxRun.callLogId,
      },
    });

    const run = await this.prisma.$transaction(async (tx) => {
      await tx.solutionTask.update({
        where: { id: task.id },
        data: {
          status: 'succeeded',
          outputJson: this.toJson(redfoxRun),
          reasonCode: null,
          errorMessage: null,
          endedAt: now,
          durationMs: now.getTime() - executionStartedAt.getTime(),
          redfoxCallLogId: redfoxRun.callLogId,
          requestHash,
          idempotencyKey,
        },
      });

      await tx.solutionResult.create({
        data: {
          runId,
          taskId,
          kind: 'redfox_execution',
          status: 'created',
          counts: this.toJson({
            estimatedCostPoints: redfoxRun.estimatedCostPoints,
            callLogId: redfoxRun.callLogId,
          }),
          nextAction: redfoxRun.callLogId
            ? '真实 RedFox Skill 已执行，等待下游结果归一化和人工确认。'
            : '真实 RedFox Skill 已执行，但未返回调用日志 ID，请检查 RedFoxCallLog。',
          payloadSummary: this.toJson(redfoxRun.payloadSummary),
          rawResultJson: this.toJson(redfoxRun),
        },
      });

      const normalizationPlan = this.createRedfoxOutputNormalizationPlan(
        task.run.packageCode,
        redfoxRun,
      );
      const normalizationPersistence =
        await this.persistRedfoxNormalizedRecords(
          tx,
          actor,
          task.run,
          taskId,
          redfoxRun,
          normalizationPlan,
        );
      const persistedNormalizationPlan =
        this.applyRedfoxNormalizationPersistence(
          normalizationPlan,
          normalizationPersistence,
        );
      await tx.solutionResult.create({
        data: {
          runId,
          taskId,
          kind: 'redfox_output_normalization',
          status: persistedNormalizationPlan.status,
          businessObjectRefs: this.toJson(
            persistedNormalizationPlan.businessObjectRefs,
          ),
          counts: this.toJson(persistedNormalizationPlan.counts),
          nextAction: persistedNormalizationPlan.nextAction,
          payloadSummary: this.toJson(
            persistedNormalizationPlan.payloadSummary,
          ),
          rawResultJson: this.toJson(persistedNormalizationPlan.rawResultJson),
        },
      });

      await tx.solutionCostEntry.create({
        data: {
          runId,
          taskId,
          provider: 'redfox',
          operation: redfoxRun.endpoint.operation,
          skillCode: redfoxRun.skill.code || redfoxRun.skill.name,
          endpoint: redfoxRun.endpoint.path,
          estimatedCostPoints: redfoxRun.estimatedCostPoints,
          authorizedCostPoints: redfoxRun.estimatedCostPoints,
          capturedCostPoints: redfoxRun.estimatedCostPoints,
          refundedCostPoints: 0,
          billingStatus: 'captured',
          requestHash,
          idempotencyKey,
          retryCount: 0,
          redfoxCallLogId: redfoxRun.callLogId,
        },
      });

      const tasks = await tx.solutionTask.findMany({
        where: { runId },
        select: { status: true },
      });
      const readyCount = tasks.filter((item) =>
        SOLUTION_TASK_READY_STATUSES.has(item.status),
      ).length;
      const progress = tasks.length
        ? Math.round((readyCount / tasks.length) * 100)
        : 0;
      const hasApprovalRequired = tasks.some(
        (item) => item.status === 'approval_required',
      );
      const runStatus = hasApprovalRequired
        ? 'approval_required'
        : progress >= 100
          ? 'succeeded'
          : 'running';

      await tx.solutionRun.update({
        where: { id: runId },
        data: {
          status: runStatus,
          progress,
          actualCostPoints:
            Math.max(0, task.run.actualCostPoints || 0) +
            redfoxRun.estimatedCostPoints,
          costStatus: 'captured',
        },
      });

      return tx.solutionRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          tasks: { orderBy: { order: 'asc' } },
          results: { orderBy: { createdAt: 'desc' } },
        },
      });
    });
    const record = this.toRunRecord(run);
    const updatedTask = record.tasks.find((item) => item.id === taskId);
    if (!updatedTask) {
      throw new NotFoundException('方案任务回写失败');
    }
    return {
      run: record,
      task: updatedTask,
      redfoxRun,
    };
  }

  async approveManualTask(
    actor: AuthenticatedUser,
    runId: string,
    taskId: string,
    request: ApproveSolutionManualTaskRequest = {},
  ): Promise<ApproveSolutionManualTaskResult> {
    const task = await this.prisma.solutionTask.findFirst({
      where: {
        id: taskId,
        runId,
        run: { userId: actor.id },
      },
      include: { run: true },
    });
    if (!task) {
      throw new NotFoundException('方案任务不存在');
    }
    if (task.executorKind !== 'manual') {
      throw new BadRequestException('只有人工检查点支持直接确认完成');
    }
    if (!SOLUTION_MANUAL_TASK_APPROVABLE_STATUSES.has(task.status)) {
      throw new BadRequestException(
        `当前任务状态为 ${task.status}，不能确认人工检查点`,
      );
    }

    const now = new Date();
    const taskInput = this.readJsonRecord(task.inputJson);
    const approvalNote =
      request.approvalNote?.trim() || '人工检查点已确认，继续方案闭环。';
    const businessResult = this.isPlainObject(request.businessResult)
      ? request.businessResult
      : {};
    const checkpoint = {
      taskName: task.name,
      stepKey: task.stepKey,
      targetObject: task.targetObject,
      businessCheckpoint:
        typeof taskInput.businessCheckpoint === 'string'
          ? taskInput.businessCheckpoint
          : `确认「${task.name}」阶段性交付物并记录证据`,
      deliverables: this.readStringArray(taskInput.deliverables),
      approvalNote,
      evidenceUrl: request.evidenceUrl?.trim() || null,
      businessResult,
      approvedAt: now.toISOString(),
      approvedBy: actor.id,
    };

    const run = await this.prisma.$transaction(async (tx) => {
      const result = await tx.solutionResult.create({
        data: {
          runId,
          taskId,
          kind: 'manual_checkpoint_approval',
          status: 'approved',
          counts: this.toJson({
            approvedCheckpoints: 1,
            deliverables: checkpoint.deliverables.length,
          }),
          nextAction: '人工检查点已确认，方案运行可继续推进。',
          acceptedAt: now,
          approvedBy: actor.id,
          payloadSummary: this.toJson(checkpoint),
          rawResultJson: this.toJson({
            type: 'manual_checkpoint_approval',
            checkpoint,
          }),
        },
      });

      await tx.solutionTask.update({
        where: { id: task.id },
        data: {
          status: 'succeeded',
          outputJson: this.toJson(checkpoint),
          reasonCode: null,
          errorMessage: null,
          endedAt: now,
          durationMs: task.startedAt
            ? now.getTime() - task.startedAt.getTime()
            : null,
          agentConfirmationId: result.id,
        },
      });

      const tasks = await tx.solutionTask.findMany({
        where: { runId },
        select: { status: true },
      });
      const readyCount = tasks.filter((item) =>
        SOLUTION_TASK_READY_STATUSES.has(item.status),
      ).length;
      const progress = tasks.length
        ? Math.round((readyCount / tasks.length) * 100)
        : 0;
      const hasFailed = tasks.some((item) => item.status === 'failed');
      const hasApprovalRequired = tasks.some(
        (item) => item.status === 'approval_required',
      );
      const runStatus = hasFailed
        ? 'failed'
        : hasApprovalRequired
          ? 'approval_required'
          : progress >= 100
            ? task.run.dryRun
              ? 'dry_run_ready'
              : 'succeeded'
            : 'running';

      await tx.solutionRun.update({
        where: { id: runId },
        data: {
          status: runStatus,
          progress,
          updatedAt: now,
        },
      });

      return tx.solutionRun.findUniqueOrThrow({
        where: { id: runId },
        include: {
          tasks: { orderBy: { order: 'asc' } },
          results: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    const record = this.toRunRecord(run);
    const updatedTask = record.tasks.find((item) => item.id === taskId);
    const result = record.results.find(
      (item) =>
        item.taskId === taskId && item.kind === 'manual_checkpoint_approval',
    );
    if (!updatedTask || !result) {
      throw new NotFoundException('方案人工检查点回写失败');
    }
    return {
      run: record,
      task: updatedTask,
      result,
    };
  }

  async confirmOutputDrafts(
    actor: AuthenticatedUser,
    runId: string,
    resultId: string,
    request: ConfirmSolutionOutputDraftsRequest = {},
  ): Promise<ConfirmSolutionOutputDraftsResult> {
    if (request.confirmPersistence !== OUTPUT_DRAFT_CONFIRMATION) {
      throw new BadRequestException('缺少方案草稿写入确认口令');
    }

    const selectedObjectTypes = this.normalizeConfirmableObjectTypes(
      request.objectTypes,
    );
    const selectedDedupeKeys = new Set(
      (request.dedupeKeys || []).filter(Boolean),
    );
    const maxObjects = Math.max(
      1,
      Math.min(50, Math.floor(request.maxObjects ?? 20)),
    );
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.solutionResult.findFirst({
        where: {
          id: resultId,
          runId,
          kind: 'redfox_output_normalization',
          run: { userId: actor.id },
        },
      });
      if (!result) {
        throw new NotFoundException('方案归一化结果不存在');
      }

      const records = this.readNormalizedRecordsFromResult(
        result.rawResultJson,
      );
      if (!records.length) {
        throw new BadRequestException('该方案结果没有可确认的业务对象草稿');
      }

      const businessObjectRefs = this.readBusinessObjectRefs(
        result.businessObjectRefs,
      );
      const candidates = this.sortConfirmableRecords(
        records.filter((record) => {
          if (!selectedObjectTypes.has(record.objectType)) return false;
          if (
            selectedDedupeKeys.size &&
            !selectedDedupeKeys.has(record.dedupeKey)
          ) {
            return false;
          }
          return !this.hasPersistedBusinessObjectRef(
            businessObjectRefs,
            record,
          );
        }),
      ).slice(0, maxObjects);

      if (!candidates.length) {
        throw new BadRequestException('没有待确认写入的方案草稿');
      }

      const confirmationState: RedfoxOutputDraftConfirmationState = {
        createdRefs: [],
        skippedRefs: [],
        materialIdsByLinkKey: new Map(),
        topicIdsByLinkKey: new Map(),
      };

      for (const record of candidates) {
        await this.persistConfirmedRedfoxOutputDraft(
          tx,
          runId,
          result.id,
          result.taskId,
          record,
          confirmationState,
        );
      }

      const updatedBusinessObjectRefs =
        this.applyConfirmedOutputDraftRefsToBusinessRefs(
          businessObjectRefs,
          confirmationState,
        );
      const updatedCounts = this.createConfirmedOutputCounts(
        result.counts,
        updatedBusinessObjectRefs,
        confirmationState,
      );
      const updatedStatus = this.createConfirmedOutputStatus(
        updatedBusinessObjectRefs,
      );
      const updatedRawResultJson = this.appendConfirmedOutputAuditToRawResult(
        result.rawResultJson,
        actor.id,
        now,
        confirmationState,
      );

      await tx.solutionResult.update({
        where: { id: result.id },
        data: {
          status: updatedStatus,
          businessObjectRefs: this.toJson(updatedBusinessObjectRefs),
          counts: this.toJson(updatedCounts),
          nextAction: this.confirmedOutputNextAction(confirmationState),
          acceptedAt: now,
          approvedBy: actor.id,
          rawResultJson: this.toJson(updatedRawResultJson),
        },
      });

      await tx.solutionResult.create({
        data: {
          runId,
          taskId: result.taskId,
          kind: 'redfox_output_confirmation',
          status: confirmationState.createdRefs.length
            ? 'persisted'
            : 'skipped',
          businessObjectRefs: this.toJson(confirmationState.createdRefs),
          counts: this.toJson({
            confirmedObjects: confirmationState.createdRefs.length,
            skippedObjects: confirmationState.skippedRefs.length,
          }),
          nextAction: this.confirmedOutputNextAction(confirmationState),
          acceptedAt: now,
          approvedBy: actor.id,
          payloadSummary: this.toJson({
            sourceResultId: result.id,
            objectTypes: Array.from(selectedObjectTypes),
            dedupeKeys: Array.from(selectedDedupeKeys),
            maxObjects,
          }),
          rawResultJson: this.toJson({
            type: 'redfox_output_confirmation',
            sourceResultId: result.id,
            createdRefs: confirmationState.createdRefs,
            skippedRefs: confirmationState.skippedRefs,
          }),
        },
      });

      return {
        runId,
        resultId: result.id,
        status: updatedStatus,
        createdRefs: confirmationState.createdRefs.map((item) => ({
          objectType: item.objectType,
          dedupeKey: item.dedupeKey,
          refId: item.refId,
          source: item.source,
        })),
        skippedRefs: confirmationState.skippedRefs,
        businessObjectRefs: updatedBusinessObjectRefs,
        counts: updatedCounts,
      };
    });
  }

  private async createSolutionResultActionObject(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun & {
      tasks?: PrismaSolutionTask[];
      results?: PrismaSolutionResult[];
    },
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    if (request.kind === 'monitor') {
      return this.createSolutionMonitorAction(actor, run, request, actionKey);
    }
    if (request.kind === 'crm_task') {
      return this.createSolutionCrmTaskAction(actor, run, request, actionKey);
    }
    if (request.kind === 'intelligence_report') {
      return this.createSolutionReportAction(actor, run, request, actionKey);
    }
    if (request.kind === 'crm_lead') {
      return this.createSolutionCrmLeadAction(actor, run, request, actionKey);
    }
    if (request.kind === 'publish_preparation') {
      return this.createSolutionPublishPreparationAction(
        actor,
        run,
        request,
        actionKey,
      );
    }
    throw new BadRequestException('不支持的结果动作');
  }

  private async createSolutionMonitorAction(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    const configuredInput = this.resultActionConfiguredInput(run, request);
    const type = this.resultActionMonitorType(run, request);
    const keyword =
      this.firstConfiguredInputText(configuredInput, [
        'keywords',
        'keyword',
        'query',
        'businessObjective',
      ]) || run.packageName;
    const platform = this.normalizeResultActionPlatform(
      this.firstConfiguredInputText(configuredInput, ['platforms', 'platform']),
    );
    const accountExternalId =
      type === 'account'
        ? this.firstConfiguredInputText(configuredInput, [
            'benchmarkAccounts',
            'competitorAccounts',
            'competitors',
            'accountId',
            'query',
          ]) || null
        : null;
    const industry =
      type === 'industry' || type === 'risk'
        ? this.firstConfiguredInputText(configuredInput, [
            'industry',
            'businessObjective',
          ]) || keyword
        : null;

    const existing = await this.prisma.intelligenceMonitor.findFirst({
      where: {
        userId: actor.id,
        tenantId: run.tenantId,
        type,
        platform,
        keyword,
        accountExternalId,
        industry,
        status: { not: 'archived' },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      return {
        objectType: 'IntelligenceMonitor',
        refId: existing.id,
        source: 'intelligence_monitors',
        href: this.resultActionHref('monitor', existing.id),
        message: '监控任务已存在，已复用',
        status: 'reused',
      };
    }

    const monitor = await this.prisma.intelligenceMonitor.create({
      data: {
        tenantId: run.tenantId,
        userId: actor.id,
        type,
        schedule: 'daily',
        platform,
        keyword,
        accountExternalId,
        industry,
        status: 'active',
        costLimitPoints: 200,
        config: this.toJson({
          source: 'solutions-result-action',
          solutionRunId: run.id,
          packageCode: run.packageCode,
          packageName: run.packageName,
          actionKey,
          label: request.label,
          targetModule: request.targetModule,
        }),
      },
    });

    return {
      objectType: 'IntelligenceMonitor',
      refId: monitor.id,
      source: 'intelligence_monitors',
      href: this.resultActionHref('monitor', monitor.id),
      message: '监控任务已创建',
      status: 'created',
    };
  }

  private async createSolutionCrmTaskAction(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    const title = `${request.label || '跟进任务'}：${run.packageName}`;
    const existing = await this.prisma.crmTask.findFirst({
      where: {
        ownerId: actor.id,
        title,
        archivedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      return {
        objectType: 'CrmTask',
        refId: existing.id,
        source: 'crm_tasks',
        href: this.resultActionHref('crm_task', existing.id),
        message: '跟进任务已存在，已复用',
        status: 'reused',
      };
    }

    const configuredInput = this.resultActionConfiguredInput(run, request);
    const objective =
      this.firstConfiguredInputText(configuredInput, [
        'businessObjective',
        'query',
      ]) || run.packageName;
    const keyword = this.firstConfiguredInputText(configuredInput, [
      'keywords',
      'keyword',
      'query',
    ]);
    const task = await this.crmService.createTask(actor.id, {
      title,
      description: [
        request.description,
        `来源方案：${run.packageName}`,
        `业务目标：${objective}`,
        keyword ? `关键词：${keyword}` : '',
        `结果编号：${run.id}`,
      ]
        .filter(Boolean)
        .join('\n'),
      priority: 'medium',
      metadata: {
        source: 'solutions-result-action',
        solutionRunId: run.id,
        packageCode: run.packageCode,
        actionKey,
      },
    });

    return {
      objectType: 'CrmTask',
      refId: task.id,
      source: 'crm_tasks',
      href: this.resultActionHref('crm_task', task.id),
      message: '跟进任务已创建',
      status: 'created',
    };
  }

  private async createSolutionReportAction(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    const title = `${request.label || '生成报告'}：${run.packageName}`;
    const existing = await this.prisma.intelligenceReport.findFirst({
      where: {
        userId: actor.id,
        tenantId: run.tenantId,
        kind: 'solution_result',
        title,
        status: { not: 'archived' },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      return {
        objectType: 'IntelligenceReport',
        refId: existing.id,
        source: 'intelligence_reports',
        href: this.resultActionHref('intelligence_report', existing.id),
        message: '报告已存在，已复用',
        status: 'reused',
      };
    }

    const markdown = this.buildSolutionResultReportMarkdown(run, request);
    const report = await this.prisma.intelligenceReport.create({
      data: {
        tenantId: run.tenantId,
        userId: actor.id,
        kind: 'solution_result',
        title,
        audience: '运营负责人',
        owner: actor.id,
        rangeKey: 'solution_run',
        status: 'draft',
        completeness: 70,
        findings: this.toJson([
          `${run.packageName} 已生成业务结果`,
          request.description || '可进入下一步业务处理',
        ]),
        evidence: this.toJson([`solution-run:${run.id}`]),
        markdown,
        metadata: this.toJson({
          source: 'solutions-result-action',
          solutionRunId: run.id,
          packageCode: run.packageCode,
          actionKey,
        }),
      },
    });

    return {
      objectType: 'IntelligenceReport',
      refId: report.id,
      source: 'intelligence_reports',
      href: this.resultActionHref('intelligence_report', report.id),
      message: '报告已生成',
      status: 'created',
    };
  }

  private async createSolutionCrmLeadAction(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    const dedupeKey = `solution:${this.shortHash(`${run.id}:${actionKey}`)}`;
    const existing = await this.prisma.crmCustomer.findFirst({
      where: {
        ownerId: actor.id,
        dedupeKey,
        archivedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      return {
        objectType: 'CrmCustomer',
        refId: existing.id,
        source: 'crm_customers',
        href: this.resultActionHref('crm_lead', existing.id),
        message: 'CRM 线索已存在，已复用',
        status: 'reused',
      };
    }

    const configuredInput = this.resultActionConfiguredInput(run, request);
    const objective =
      this.firstConfiguredInputText(configuredInput, [
        'businessObjective',
        'query',
      ]) || run.packageName;
    const keyword = this.firstConfiguredInputText(configuredInput, [
      'keywords',
      'keyword',
      'query',
    ]);
    const customer = await this.crmService.createCustomer(actor.id, {
      displayName: `待跟进线索：${this.truncateText(objective, 32)}`,
      status: 'new',
      sourcePlatform: 'solutions',
      sourceKeyword: keyword || objective,
      matchedKeyword: keyword || undefined,
      sourceText: [
        request.description,
        `来源方案：${run.packageName}`,
        `业务目标：${objective}`,
      ]
        .filter(Boolean)
        .join('\n'),
      score: 60,
      tags: ['方案线索', run.packageName],
      dedupeKey,
      metadata: {
        source: 'solutions-result-action',
        solutionRunId: run.id,
        packageCode: run.packageCode,
        actionKey,
      },
    });

    return {
      objectType: 'CrmCustomer',
      refId: customer.id,
      source: 'crm_customers',
      href: this.resultActionHref('crm_lead', customer.id),
      message: 'CRM 线索已创建',
      status: 'created',
    };
  }

  private async createSolutionPublishPreparationAction(
    actor: AuthenticatedUser,
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
    actionKey: string,
  ): Promise<SolutionResultActionObject> {
    const sourceWorkflowId = `solutions:${run.id}:${actionKey}`;
    const configuredInput = this.resultActionConfiguredInput(run, request);
    const title = `${run.packageName}发布稿`;
    const content = this.buildSolutionPublishContent(run, request);
    const platform = this.normalizeResultActionPlatform(
      this.firstConfiguredInputText(configuredInput, ['platforms', 'platform']),
    );
    const existingVersions = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM content_versions
      WHERE user_id = ${actor.id} AND source_workflow_id = ${sourceWorkflowId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    let versionId = existingVersions[0]?.id || null;
    if (!versionId) {
      const version = await this.contentOptimizationService.saveVersion({
        sourceType: 'solution_run',
        sourceId: run.id,
        mode: 'rewrite',
        modeLabel: '方案结果发布稿',
        title,
        content,
        platform: platform as 'all',
        targetType: 'article',
        sourceWorkflowId,
        sourceSummary: request.description || run.packageName,
      });
      versionId = version.id;
    }

    const existingIntents = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM content_publish_intents
      WHERE user_id = ${actor.id} AND version_id = ${versionId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (existingIntents[0]?.id) {
      return {
        objectType: 'PublishRecord',
        refId: existingIntents[0].id,
        source: 'content_publish_intents',
        href: this.resultActionHref(
          'publish_preparation',
          existingIntents[0].id,
        ),
        message: '发布准备已存在，已复用',
        status: 'reused',
        extraRefs: [
          {
            objectType: 'Article',
            status: 'reused',
            refId: versionId,
            source: 'content_versions',
            dedupeKey: actionKey,
          },
        ],
      };
    }

    await this.contentOptimizationService.setOfficialVersion(versionId, {
      writeBackDraft: true,
    });
    await this.complianceService.check({
      content,
      title,
      targetType: 'article',
      targetId: versionId,
      platform,
      scenario: 'solution_publish_preparation',
    });
    const publishIntent =
      await this.contentOptimizationService.createPublishIntent({
        versionId,
        platform: 'all',
      });

    return {
      objectType: 'PublishRecord',
      refId: publishIntent.id,
      source: 'content_publish_intents',
      href: this.resultActionHref('publish_preparation', publishIntent.id),
      message: '发布准备已创建',
      status: 'created',
      extraRefs: [
        {
          objectType: 'Article',
          status: 'created',
          refId: versionId,
          source: 'content_versions',
          dedupeKey: actionKey,
        },
      ],
    };
  }

  private createSolutionResultActionKey(
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
  ) {
    if (request.actionKey?.trim()) return request.actionKey.trim();
    return `${request.kind}:${this.shortHash(
      [run.id, request.label, request.targetModule].join(':'),
    )}`;
  }

  private resultActionConfiguredInput(
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
  ) {
    if (this.isPlainObject(request.configuredInput)) {
      return request.configuredInput;
    }
    return this.readJsonRecord(run.inputJson);
  }

  private firstConfiguredInputText(
    input: Record<string, unknown>,
    keys: string[],
  ) {
    for (const key of keys) {
      const value = input[key];
      if (Array.isArray(value)) {
        const item = (value as unknown[]).find(
          (entry): entry is string | number =>
            (typeof entry === 'string' || typeof entry === 'number') &&
            String(entry).trim() !== '',
        );
        if (item !== undefined) return String(item).trim();
      }
      if (
        (typeof value === 'string' || typeof value === 'number') &&
        String(value).trim()
      ) {
        return String(value)
          .split(/[,，、\n]/)
          .map((item) => item.trim())
          .filter(Boolean)[0];
      }
    }
    return '';
  }

  private normalizeResultActionPlatform(value: string) {
    const normalized = value.trim().toLowerCase();
    if (/小红书|xhs|xiaohongshu/.test(normalized)) return 'xiaohongshu';
    if (/抖音|douyin/.test(normalized)) return 'douyin';
    if (/公众号|微信|wechat|gzh/.test(normalized)) return 'wechat';
    if (/b站|bilibili/.test(normalized)) return 'bilibili';
    if (/tiktok/.test(normalized)) return 'tiktok';
    return 'all';
  }

  private resultActionMonitorType(
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
  ) {
    const text = `${request.label} ${request.targetModule} ${run.packageCode}`;
    if (/账号|竞品|达人|KOL/i.test(text)) return 'account';
    if (/行业|出海/.test(text)) return 'industry';
    if (/舆情|品牌|风险/.test(text)) return 'risk';
    if (/爆款|热点|趋势/.test(text)) return 'trend';
    return 'keyword';
  }

  private resultActionHref(
    kind: ExecuteSolutionResultActionRequest['kind'],
    refId: string,
  ) {
    const encoded = encodeURIComponent(refId);
    if (kind === 'monitor')
      return `/intelligence/monitors?monitorId=${encoded}`;
    if (kind === 'crm_task') return `/crm?taskId=${encoded}`;
    if (kind === 'crm_lead') return `/crm?customerId=${encoded}`;
    if (kind === 'intelligence_report') {
      return `/intelligence/reports?reportId=${encoded}`;
    }
    if (kind === 'publish_preparation') {
      return `/content/optimization?publishIntentId=${encoded}`;
    }
    return '/solutions';
  }

  private solutionResultActionReusedMessage(
    kind: ExecuteSolutionResultActionRequest['kind'],
  ) {
    if (kind === 'monitor') return '监控任务已存在，已复用';
    if (kind === 'crm_task') return '跟进任务已存在，已复用';
    if (kind === 'crm_lead') return 'CRM 线索已存在，已复用';
    if (kind === 'intelligence_report') return '报告已存在，已复用';
    if (kind === 'publish_preparation') return '发布准备已存在，已复用';
    return '业务对象已存在，已复用';
  }

  private buildSolutionResultReportMarkdown(
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
  ) {
    const input = this.readJsonRecord(run.inputJson);
    const objective =
      this.firstConfiguredInputText(input, ['businessObjective', 'query']) ||
      run.packageName;
    return [
      `# ${request.label || run.packageName}`,
      '',
      `- 来源方案：${run.packageName}`,
      `- 业务目标：${objective}`,
      `- 方案状态：${run.status}`,
      `- 结果编号：${run.id}`,
      '',
      '## 结论',
      request.description || '方案结果已生成，可进入业务处理。',
      '',
      '## 下一步',
      `请进入${request.targetModule || '对应业务模块'}继续处理。`,
    ].join('\n');
  }

  private buildSolutionPublishContent(
    run: PrismaSolutionRun,
    request: ExecuteSolutionResultActionRequest,
  ) {
    const input = this.readJsonRecord(run.inputJson);
    const objective =
      this.firstConfiguredInputText(input, ['businessObjective', 'query']) ||
      run.packageName;
    return [
      `${run.packageName}`,
      '',
      `目标：${objective}`,
      '',
      request.description || '根据方案结果整理发布内容。',
      '',
      '请在发布前根据目标平台补充封面、标签和最终 CTA。',
    ].join('\n');
  }

  normalizeCategory(category?: string): SolutionPackageCategory | undefined {
    if (!category) {
      return undefined;
    }

    if (category === 'core' || category === 'redfox_pool') {
      return category;
    }

    throw new BadRequestException('不支持的方案包分类');
  }

  private enrichPackage(
    packageItem: SolutionPackageDefinition,
  ): SolutionPackageDefinition {
    return {
      ...packageItem,
      productization:
        packageItem.productization ||
        this.createProductizationProfile(packageItem),
    };
  }

  private createProductizationProfile(
    packageItem: SolutionPackageDefinition,
  ): SolutionProductizationProfile {
    const deliverables = this.businessObjectLabels(packageItem.dataObjects);
    const primaryPlatforms = this.detectPlatforms(packageItem.redfoxSkills);
    const isRiskScenario =
      packageItem.code.includes('compliance') ||
      packageItem.code.includes('monitoring');
    const isCrmScenario =
      packageItem.code.includes('lead') || packageItem.code.includes('kol');

    return {
      deliverables,
      resultModules: [
        packageItem.connectedEntryPath || packageItem.entryPath,
        '/workbench',
        isCrmScenario ? '/crm' : '/intelligence/reports',
      ],
      configurationFields: [
        {
          key: 'businessObjective',
          label: '业务目标',
          type: 'textarea',
          required: true,
          placeholder: packageItem.customerValue,
          helper: '用一句话说明这次试运行要帮哪个团队解决什么问题。',
          defaultValue: packageItem.customerValue,
        },
        {
          key: 'keywords',
          label: '关键词/品牌词',
          type: 'tags',
          required: true,
          placeholder: '例如：咖啡、露营、夏季新品',
          helper: '多个词用逗号分隔，会作为采集和报告的主线索。',
          defaultValue: ['咖啡', '本地生活'],
        },
        {
          key: 'platforms',
          label: '平台范围',
          type: 'tags',
          required: true,
          placeholder: '抖音、小红书、公众号',
          helper: '先选最需要验证的平台，避免一次试运行范围过大。',
          defaultValue: primaryPlatforms,
        },
        {
          key: 'benchmarkAccounts',
          label: '对标账号/竞品',
          type: 'tags',
          required: false,
          placeholder: '输入账号名、品牌名或达人名',
          helper: '没有明确竞品时可留空，系统会按关键词生成候选。',
          defaultValue: [],
        },
        {
          key: 'cadence',
          label: '运行频率',
          type: 'select',
          required: true,
          placeholder: '选择运行节奏',
          helper: '试运行建议单次，正式上线再启用日报/周报。',
          options: ['单次试运行', '每日早报', '每周复盘', '风险实时告警'],
          defaultValue: isRiskScenario ? '风险实时告警' : '单次试运行',
        },
        {
          key: 'outputChannel',
          label: '交付去向',
          type: 'select',
          required: true,
          placeholder: '选择结果进入哪里',
          helper: '决定结果中心之外，还要同步到哪个业务模块。',
          options: ['结果中心', '选题库', '素材库', 'CRM', '发布前检查'],
          defaultValue: isCrmScenario ? 'CRM' : '结果中心',
        },
        {
          key: 'approvalOwner',
          label: '审批人',
          type: 'text',
          required: true,
          placeholder: '例如：运营负责人 / 风控负责人',
          helper: '外部能力执行和高风险结果会进入这个角色确认。',
          defaultValue: isRiskScenario ? '风控负责人' : '运营负责人',
        },
      ],
      templates: this.createIndustryTemplates(packageItem, primaryPlatforms),
      caseStudies: this.createCaseStudies(packageItem),
      roiMetrics: this.createRoiMetrics(packageItem),
      permissionPolicy: {
        requiredRoles: ['运营成员', '运营负责人'],
        approvalRoles: isRiskScenario
          ? ['风控负责人', '运营负责人']
          : ['运营负责人'],
        auditEvents: [
          '配置变更',
          '执行计划生成',
          '外部能力解析',
          '外部能力调用',
          '结果入库',
        ],
        externalExecutionPolicy:
          '外部能力执行必须命中白名单、API Key、用量上限和调用日志。',
      },
      operatingCadence: [
        '试运行：单次配置后生成执行计划和结果预览',
        isRiskScenario
          ? '上线：高风险命中实时进入确认队列'
          : '上线：按日报/周报节奏沉淀业务结果',
        '复盘：每周查看 ROI、失败步骤、未映射 Skill 和采纳率',
      ],
    };
  }

  private createIndustryTemplates(
    packageItem: SolutionPackageDefinition,
    platforms: string[],
  ) {
    const baseInput = {
      businessObjective: packageItem.customerValue,
      platforms,
      cadence: '单次试运行',
      outputChannel: '结果中心',
      approvalOwner: '运营负责人',
    };

    return [
      {
        code: `${packageItem.code}-local-life`,
        name: '本地生活增长模板',
        industry: '本地生活',
        scenario: '门店活动、探店内容、达人合作和评论线索',
        defaultInput: {
          ...baseInput,
          keywords: ['咖啡', '露营', '周末探店'],
          benchmarkAccounts: ['同城高互动账号', '区域竞品品牌'],
        },
        expectedOutcome: '生成可执行选题、素材和跟进动作，适合小团队快速验证。',
        rolloutDays: 3,
      },
      {
        code: `${packageItem.code}-brand-risk`,
        name: '品牌风险与机会模板',
        industry: '消费品牌',
        scenario: '新品反馈、竞品声量、负面舆情和内容机会',
        defaultInput: {
          ...baseInput,
          keywords: ['新品', '差评', '竞品词'],
          benchmarkAccounts: ['头部竞品', '核心达人'],
          cadence: '每日早报',
        },
        expectedOutcome: '形成每日机会/风险清单，推动运营、客服、风控协同。',
        rolloutDays: 5,
      },
    ];
  }

  private createCaseStudies(packageItem: SolutionPackageDefinition) {
    return [
      {
        title: `${packageItem.name} 7 天试运行样例`,
        companyProfile: '3-8 人内容运营团队，已有基础内容生产和客服流程。',
        before: '靠人工搜热点、翻竞品和整理表格，机会发现慢，结果难复盘。',
        after: '每天固定沉淀机会项、证据、建议动作和负责人。',
        result: packageItem.acceptance[0] || packageItem.customerValue,
        evidence: [
          '试运行记录包含配置、步骤、审批和输出去向',
          '每个外部能力步骤保留请求预览和安全闸门',
          '结果进入情报、素材、选题或 CRM 模块',
        ],
      },
    ];
  }

  private createRoiMetrics(packageItem: SolutionPackageDefinition) {
    if (
      packageItem.code.includes('comment') ||
      packageItem.code.includes('kol')
    ) {
      return [
        {
          key: 'lead_count',
          label: '线索数',
          unit: '条',
          baseline: 0,
          target: 20,
          description: '从评论、账号或达人筛选中沉淀的可跟进线索。',
        },
        {
          key: 'followup_rate',
          label: '跟进率',
          unit: '%',
          baseline: 20,
          target: 80,
          description: '线索进入 CRM 后被分配并跟进的比例。',
        },
      ];
    }

    if (
      packageItem.code.includes('compliance') ||
      packageItem.code.includes('monitoring')
    ) {
      return [
        {
          key: 'risk_blocked',
          label: '风险拦截',
          unit: '次',
          baseline: 0,
          target: 5,
          description: '被识别并进入确认流的风险内容或舆情样本。',
        },
        {
          key: 'response_time',
          label: '响应时长',
          unit: '小时',
          baseline: 24,
          target: 4,
          description: '从风险发现到确认处理的平均时长。',
        },
      ];
    }

    return [
      {
        key: 'opportunity_count',
        label: '机会项',
        unit: '条',
        baseline: 0,
        target: 10,
        description: '可进入选题、素材或报告的机会条目。',
      },
      {
        key: 'content_adoption',
        label: '采纳率',
        unit: '%',
        baseline: 10,
        target: 40,
        description: '机会项被转成选题、素材或发布草稿的比例。',
      },
    ];
  }

  private detectPlatforms(skills: string[]) {
    const joined = skills.join(' ');
    const platforms: string[] = [];
    if (joined.includes('抖音')) platforms.push('抖音');
    if (joined.includes('小红书')) platforms.push('小红书');
    if (joined.includes('公众号')) platforms.push('公众号');
    if (joined.includes('B 站')) platforms.push('B 站');
    if (joined.includes('TikTok')) platforms.push('TikTok');
    if (!platforms.length) platforms.push('全网');
    return platforms;
  }

  private businessObjectLabels(values: string[]) {
    return Array.from(
      new Set(
        values
          .filter((value) => !INTERNAL_OBJECTS.has(value))
          .map((value) => BUSINESS_OBJECT_LABELS[value] || value),
      ),
    );
  }

  private createSummary(
    items: SolutionPackageDefinition[],
  ): SolutionPackageSummary {
    const redfoxSkills = new Set<string>();
    const ownerGroups = new Set<string>();

    for (const item of items) {
      item.redfoxSkills.forEach((skill) => redfoxSkills.add(skill));
      item.ownerGroups.forEach((group) => ownerGroups.add(group));
    }

    return {
      total: items.length,
      core: items.filter((item) => item.category === 'core').length,
      redfoxPool: items.filter((item) => item.category === 'redfox_pool')
        .length,
      connected: items.filter(
        (item) => item.implementationState === 'connected',
      ).length,
      partial: items.filter((item) => item.implementationState === 'partial')
        .length,
      planned: items.filter((item) => item.implementationState === 'planned')
        .length,
      redfoxSkillCount: redfoxSkills.size,
      estimatedWorkdays: items.reduce(
        (sum, item) => sum + item.estimatedWorkdays,
        0,
      ),
      ownerGroups: Array.from(ownerGroups),
    };
  }

  private toRunRecord(
    run: PrismaSolutionRun & {
      tasks?: PrismaSolutionTask[];
      results?: PrismaSolutionResult[];
    },
  ): SolutionRunRecord {
    return {
      id: run.id,
      tenantId: run.tenantId,
      userId: run.userId,
      packageCode: run.packageCode,
      packageName: run.packageName,
      packageVersion: run.packageVersion,
      trigger: run.trigger,
      source: run.source,
      status: run.status,
      progress: run.progress,
      dryRun: run.dryRun,
      riskLevel: run.riskLevel,
      confirmationPolicy: run.confirmationPolicy,
      sendMode: run.sendMode,
      estimatedCostPoints: run.estimatedCostPoints,
      maxCostPoints: run.maxCostPoints,
      actualCostPoints: run.actualCostPoints,
      costStatus: run.costStatus,
      input: run.inputJson,
      resolvedPlan: run.resolvedPlanJson,
      summary: run.summaryJson,
      outputRefs: run.outputRefs,
      acceptanceChecks: run.acceptanceChecks,
      tasks: (run.tasks || []).map((task) => this.toTaskRecord(task)),
      results: (run.results || []).map((result) => this.toResultRecord(result)),
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  private toTaskRecord(task: PrismaSolutionTask): SolutionRunTaskRecord {
    return {
      id: task.id,
      runId: task.runId,
      stepKey: task.stepKey,
      order: task.order,
      name: task.name,
      type: task.type,
      executorKind: task.executorKind,
      status: task.status,
      targetObject: task.targetObject,
      output: task.outputJson ?? null,
      reasonCode: task.reasonCode,
      errorMessage: task.errorMessage,
      redfoxCallLogId: task.redfoxCallLogId,
      runtimeExecutionId: task.runtimeExecutionId,
      agentConfirmationId: task.agentConfirmationId,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private toResultRecord(result: PrismaSolutionResult) {
    return {
      id: result.id,
      runId: result.runId,
      taskId: result.taskId,
      kind: result.kind,
      status: result.status,
      businessObjectRefs: result.businessObjectRefs,
      counts: result.counts,
      nextAction: result.nextAction,
      failureReason: result.failureReason,
      acceptedAt: result.acceptedAt?.toISOString() || null,
      approvedBy: result.approvedBy,
      payloadSummary: result.payloadSummary,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private createStepKey(name: string, order: number) {
    return `${order}-${name}`
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private readJsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  }

  private buildSolutionRedfoxInput(
    run: PrismaSolutionRun,
    taskInput: Record<string, unknown>,
    request: RunSolutionTaskRedfoxRequest,
  ): Record<string, unknown> {
    const runInput = this.readJsonRecord(run.inputJson);
    const requestInput = this.isPlainObject(request.input) ? request.input : {};
    const keywords = this.solutionKeywords(runInput, requestInput);
    const objective =
      this.firstConfiguredInputText(requestInput, [
        'businessObjective',
        'objective',
        'query',
        'keyword',
      ]) ||
      this.firstConfiguredInputText(runInput, [
        'businessObjective',
        'objective',
        'query',
        'keyword',
      ]) ||
      keywords[0] ||
      run.packageName;
    const query = [objective, ...keywords]
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item, index, items) => items.indexOf(item) === index)
      .join(' ');

    return {
      ...taskInput,
      ...runInput,
      ...requestInput,
      businessObjective: objective,
      objective,
      inquiryText: query,
      inquiry_text: query,
      keyword: query,
      keywords: keywords.length ? keywords : [objective],
      query,
      q: query,
      text: query,
      searchText: query,
      search_text: query,
      limit:
        this.firstNumberFromRecords(
          [requestInput, runInput],
          ['limit', 'pageSize', 'page_size'],
        ) ?? 10,
    };
  }

  private solutionKeywords(
    ...records: Array<Record<string, unknown>>
  ): string[] {
    const values: string[] = [];
    for (const record of records) {
      for (const key of ['keywords', 'keyword', 'tags', 'brandWords']) {
        const value = record[key];
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string' && item.trim())
              values.push(item.trim());
          }
        } else if (typeof value === 'string' && value.trim()) {
          values.push(
            ...value
              .split(/[,，、\n]/)
              .map((item) => item.trim())
              .filter(Boolean),
          );
        }
      }
    }
    return values.filter((item, index, items) => items.indexOf(item) === index);
  }

  private firstNumberFromRecords(
    records: Array<Record<string, unknown>>,
    keys: string[],
  ) {
    for (const record of records) {
      const value = this.firstNumber(record, keys);
      if (value !== null) return value;
    }
    return null;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  private normalizeConfirmableObjectTypes(values?: string[]) {
    const requested = values?.length
      ? values
      : Array.from(CONFIRMABLE_REDFOX_OUTPUT_OBJECTS);
    const result = new Set<string>();
    for (const value of requested) {
      if (!CONFIRMABLE_REDFOX_OUTPUT_OBJECTS.has(value)) {
        throw new BadRequestException(`不支持确认写入 ${value}`);
      }
      result.add(value);
    }
    return result;
  }

  private readNormalizedRecordsFromResult(
    value: unknown,
  ): RedfoxNormalizedRecord[] {
    const raw = this.readUnknownRecord(value);
    const normalized = this.readUnknownRecord(raw?.normalized);
    const records = normalized?.records;
    if (!Array.isArray(records)) return [];
    return records
      .map((item) => this.readUnknownRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => {
        const objectType =
          typeof item.objectType === 'string' ? item.objectType : '';
        const dedupeKey =
          typeof item.dedupeKey === 'string' ? item.dedupeKey : '';
        const data = this.readUnknownRecord(item.data);
        const preview = this.readUnknownRecord(item.preview) || {};
        const source = this.readUnknownRecord(item.source) || {};
        if (!objectType || !dedupeKey || !data) return null;
        return {
          objectType,
          status: 'ready_for_persistence' as const,
          dedupeKey,
          data,
          preview,
          source,
        };
      })
      .filter((item): item is RedfoxNormalizedRecord => Boolean(item));
  }

  private readBusinessObjectRefs(value: unknown): RedfoxBusinessObjectRef[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.readUnknownRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        objectType:
          typeof item.objectType === 'string' ? item.objectType : 'Unknown',
        status: typeof item.status === 'string' ? item.status : 'planned',
        refId: typeof item.refId === 'string' ? item.refId : null,
        source: typeof item.source === 'string' ? item.source : 'unknown',
        dedupeKey:
          typeof item.dedupeKey === 'string' ? item.dedupeKey : undefined,
        preview: this.readUnknownRecord(item.preview) || undefined,
        index: typeof item.index === 'number' ? item.index : undefined,
        persistence:
          typeof item.persistence === 'string' ? item.persistence : undefined,
        reason: typeof item.reason === 'string' ? item.reason : undefined,
      }));
  }

  private hasPersistedBusinessObjectRef(
    refs: RedfoxBusinessObjectRef[],
    record: RedfoxNormalizedRecord,
  ) {
    return refs.some(
      (ref) =>
        ref.objectType === record.objectType &&
        ref.dedupeKey === record.dedupeKey &&
        (Boolean(ref.refId) ||
          ['created', 'linked'].includes(ref.status) ||
          ['created', 'confirmed'].includes(ref.persistence || '')),
    );
  }

  private sortConfirmableRecords(records: RedfoxNormalizedRecord[]) {
    const order: Record<string, number> = {
      Material: 0,
      Topic: 1,
      Article: 2,
    };
    return [...records].sort(
      (left, right) =>
        (order[left.objectType] ?? 99) - (order[right.objectType] ?? 99),
    );
  }

  private async persistConfirmedRedfoxOutputDraft(
    tx: Prisma.TransactionClient,
    runId: string,
    resultId: string,
    taskId: string | null,
    record: RedfoxNormalizedRecord,
    state: RedfoxOutputDraftConfirmationState,
  ) {
    if (record.objectType === 'Material') {
      state.createdRefs.push(
        await this.persistConfirmedRedfoxMaterial(
          tx,
          runId,
          resultId,
          taskId,
          record,
          state,
        ),
      );
      return;
    }
    if (record.objectType === 'Topic') {
      state.createdRefs.push(
        await this.persistConfirmedRedfoxTopic(
          tx,
          runId,
          resultId,
          taskId,
          record,
          state,
        ),
      );
      return;
    }
    if (record.objectType === 'Article') {
      state.createdRefs.push(
        await this.persistConfirmedRedfoxArticle(
          tx,
          runId,
          resultId,
          taskId,
          record,
          state,
        ),
      );
      return;
    }
    state.skippedRefs.push({
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      reason: 'persistence_not_enabled',
    });
  }

  private async persistConfirmedRedfoxMaterial(
    tx: Prisma.TransactionClient,
    runId: string,
    resultId: string,
    taskId: string | null,
    record: RedfoxNormalizedRecord,
    state: RedfoxOutputDraftConfirmationState,
  ): Promise<RedfoxConfirmedOutputRef> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const metadata = {
      ...this.jsonObjectField(data, 'metadata'),
      redfoxOutputDraft: {
        solutionRunId: runId,
        solutionTaskId: taskId,
        solutionResultId: resultId,
        dedupeKey: record.dedupeKey,
        source: record.source,
      },
    };
    const material = await tx.material.create({
      data: {
        title: this.stringField(data, 'title', 'RedFox 素材'),
        content: this.nullableStringField(data, 'content'),
        summary: this.nullableStringField(data, 'summary'),
        sourceUrl:
          this.nullableStringField(data, 'sourceUrl') ||
          `redfox://solution-results/${resultId}/${record.dedupeKey}`,
        platform: this.stringField(data, 'platform', 'RedFox'),
        author: this.stringField(data, 'author', ''),
        keywords: this.asStringArray(data.keywords),
        metadata: this.toJson(metadata),
      },
    });
    state.materialIdsByLinkKey.set(linkKey, material.id);
    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: material.id,
      source: 'materials',
      linkKey,
    };
  }

  private async persistConfirmedRedfoxTopic(
    tx: Prisma.TransactionClient,
    runId: string,
    resultId: string,
    taskId: string | null,
    record: RedfoxNormalizedRecord,
    state: RedfoxOutputDraftConfirmationState,
  ): Promise<RedfoxConfirmedOutputRef> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const materialId = state.materialIdsByLinkKey.get(linkKey);
    const scoreDetails = this.jsonObjectField(data, 'scoreDetails');
    const keywords = this.asStringArray(data.keywords);
    const topic = await tx.topic.create({
      data: {
        title: this.stringField(data, 'title', 'RedFox 选题'),
        description: this.nullableStringField(data, 'description'),
        summary: this.nullableStringField(data, 'summary'),
        sourceType: this.stringField(data, 'sourceType', 'RedFox SkillHub'),
        keywords,
        searchQueries: this.asStringArray(data.searchQueries || data.keywords),
        aiScore: this.numberField(data, 'aiScore'),
        scoreDetails: Object.keys(scoreDetails).length
          ? this.toJson(scoreDetails)
          : undefined,
        scoreReason: this.nullableStringField(data, 'scoreReason'),
        status: 'pending',
        materials: materialId
          ? {
              create: [
                {
                  material: { connect: { id: materialId } },
                },
              ],
            }
          : undefined,
      },
    });
    state.topicIdsByLinkKey.set(linkKey, topic.id);
    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: topic.id,
      source: 'topics',
      linkKey,
    };
  }

  private async persistConfirmedRedfoxArticle(
    tx: Prisma.TransactionClient,
    runId: string,
    resultId: string,
    taskId: string | null,
    record: RedfoxNormalizedRecord,
    state: RedfoxOutputDraftConfirmationState,
  ): Promise<RedfoxConfirmedOutputRef> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const contentFormat = this.stringField(data, 'contentFormat', 'markdown');
    const topicId = state.topicIdsByLinkKey.get(linkKey);
    const article = await tx.article.create({
      data: {
        title: this.stringField(data, 'title', 'RedFox 内容草稿'),
        content: this.stringField(data, 'content', ''),
        contentType: this.stringField(data, 'contentType', 'article'),
        contentFormat,
        status: this.stringField(data, 'status', 'draft'),
        topicId: topicId || null,
        rawHtml:
          contentFormat === 'html'
            ? this.nullableStringField(data, 'content')
            : null,
        finalHtml:
          contentFormat === 'html'
            ? this.nullableStringField(data, 'content')
            : null,
        xiaohongshuData: this.readUnknownRecord(data.xiaohongshuData)
          ? this.toJson(this.jsonObjectField(data, 'xiaohongshuData'))
          : undefined,
      },
    });
    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: article.id,
      source: 'articles',
      linkKey,
    };
  }

  private applyConfirmedOutputDraftRefsToBusinessRefs(
    refs: RedfoxBusinessObjectRef[],
    state: RedfoxOutputDraftConfirmationState,
  ) {
    const createdByKey = new Map(
      state.createdRefs.map((item) => [
        `${item.objectType}:${item.dedupeKey}`,
        item,
      ]),
    );
    return refs.map((ref) => {
      const created = ref.dedupeKey
        ? createdByKey.get(`${ref.objectType}:${ref.dedupeKey}`)
        : undefined;
      if (!created) return ref;
      return {
        ...ref,
        status: 'created',
        refId: created.refId,
        source: created.source,
        persistence: 'confirmed',
        reason: undefined,
      };
    });
  }

  private createConfirmedOutputCounts(
    value: unknown,
    refs: RedfoxBusinessObjectRef[],
    state: RedfoxOutputDraftConfirmationState,
  ) {
    const counts = this.readUnknownRecord(value) || {};
    const persistedObjects = refs.filter(
      (ref) =>
        !INTERNAL_OBJECTS.has(ref.objectType) &&
        Boolean(ref.refId) &&
        ['created', 'linked'].includes(ref.status),
    ).length;
    return {
      ...counts,
      confirmedObjects:
        Number(counts.confirmedObjects || 0) + state.createdRefs.length,
      persistedObjects,
      pendingDraftObjects: refs.filter(
        (ref) => ref.status === 'ready_for_persistence' && !ref.refId,
      ).length,
      skippedPersistenceObjects: refs.filter(
        (ref) => ref.persistence === 'skipped' && !ref.refId,
      ).length,
    };
  }

  private createConfirmedOutputStatus(refs: RedfoxBusinessObjectRef[]) {
    const relevantRefs = refs.filter(
      (ref) => ref.dedupeKey && !INTERNAL_OBJECTS.has(ref.objectType),
    );
    const pending = relevantRefs.some(
      (ref) => ref.status === 'ready_for_persistence' && !ref.refId,
    );
    const persisted = relevantRefs.some((ref) => Boolean(ref.refId));
    if (persisted && pending) return 'partially_persisted';
    if (persisted) return 'persisted';
    return 'ready_for_persistence';
  }

  private appendConfirmedOutputAuditToRawResult(
    value: unknown,
    actorId: string,
    acceptedAt: Date,
    state: RedfoxOutputDraftConfirmationState,
  ) {
    const raw = this.readUnknownRecord(value) || {};
    const confirmations: unknown[] = Array.isArray(raw.confirmations)
      ? raw.confirmations
      : [];
    return {
      ...raw,
      confirmations: [
        ...confirmations,
        {
          type: 'redfox_output_draft_confirmation',
          acceptedAt: acceptedAt.toISOString(),
          approvedBy: actorId,
          createdRefs: state.createdRefs,
          skippedRefs: state.skippedRefs,
        },
      ],
    };
  }

  private confirmedOutputNextAction(state: RedfoxOutputDraftConfirmationState) {
    if (!state.createdRefs.length) {
      return '没有新的业务对象写入，请检查是否已经确认过或筛选条件过窄。';
    }
    const labels = state.createdRefs.map(
      (item) => BUSINESS_OBJECT_LABELS[item.objectType] || item.objectType,
    );
    return `已确认写入 ${state.createdRefs.length} 个业务对象：${Array.from(new Set(labels)).join('、')}。`;
  }

  private createConfirmedOutputLinkKey(record: RedfoxNormalizedRecord) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          title:
            this.nullableStringField(record.data, 'title') ||
            this.nullableStringField(record.preview, 'title') ||
            '',
          url:
            this.nullableStringField(record.data, 'sourceUrl') ||
            this.nullableStringField(record.preview, 'url') ||
            '',
          platform:
            this.nullableStringField(record.data, 'platform') ||
            this.nullableStringField(record.preview, 'platform') ||
            '',
        }),
      )
      .digest('hex')
      .slice(0, 32);
  }

  private createRedfoxOutputNormalizationPlan(
    packageCode: string,
    redfoxRun: RedfoxSkillRunResult,
  ): RedfoxOutputNormalizationPlan {
    const mapping = this.resolveRedfoxRunMapping(redfoxRun);
    const outputObjects = mapping?.outputObjects?.length
      ? mapping.outputObjects
      : ['RedfoxCallLog'];
    const normalized = mapping
      ? this.normalizeRedfoxSkillOutput(mapping, redfoxRun)
      : {
          records: [],
          counts: {},
          sourceKind: 'none',
          confidence: 'none' as const,
        };
    const businessObjectRefs = outputObjects.flatMap((objectType) =>
      this.createBusinessObjectRefsForType(
        objectType,
        redfoxRun,
        normalized.records.filter((record) => record.objectType === objectType),
      ),
    );
    const status = mapping
      ? normalized.records.length
        ? 'ready_for_persistence'
        : 'planned'
      : 'mapping_required';
    const mappingSummary = mapping ? this.redfoxMappingSummary(mapping) : null;

    return {
      status,
      businessObjectRefs,
      counts: {
        outputObjectTypes: outputObjects.length,
        normalizedObjects: normalized.records.length,
        plannedObjects: businessObjectRefs.filter((item) =>
          ['planned', 'ready_for_persistence'].includes(item.status),
        ).length,
        linkedObjects: businessObjectRefs.filter(
          (item) => item.status === 'linked',
        ).length,
        hasCallLog: Boolean(redfoxRun.callLogId),
        ...normalized.counts,
      },
      nextAction: mapping
        ? normalized.records.length
          ? `已把 ${mapping.code} 的 RedFox payload 归一化为 ${normalized.records.length} 条业务对象草稿，下一步写入 ${outputObjects.join('、')} 或进入人工确认。`
          : `按 ${mapping.code} 映射把 RedFox payload 归一化为 ${outputObjects.join('、')}，但当前 payload 未抽出可写对象，需要检查 Skill 输出结构。`
        : '真实 RedFox 调用已完成，但缺少 Skill mapping，需先补齐 outputObjects 后再写业务对象。',
      payloadSummary: {
        packageCode,
        mapping: mappingSummary,
        skill: redfoxRun.skill,
        endpoint: redfoxRun.endpoint,
        outputObjects,
        callLogId: redfoxRun.callLogId,
        sourcePayloadSummary: redfoxRun.payloadSummary,
        normalized: {
          sourceKind: normalized.sourceKind,
          confidence: normalized.confidence,
          records: normalized.records.length,
          counts: normalized.counts,
        },
      },
      rawResultJson: {
        type: 'redfox_output_normalization_plan',
        packageCode,
        status,
        mapping: mappingSummary,
        normalized,
        redfoxRun: {
          id: redfoxRun.id,
          skill: redfoxRun.skill,
          endpoint: redfoxRun.endpoint,
          callLogId: redfoxRun.callLogId,
          payloadSummary: redfoxRun.payloadSummary,
          payloadSample: redfoxRun.payloadSample ?? null,
        },
      },
    };
  }

  private createBusinessObjectRefsForType(
    objectType: string,
    redfoxRun: RedfoxSkillRunResult,
    records: RedfoxNormalizedRecord[],
  ) {
    if (objectType === 'RedfoxCallLog') {
      return [
        {
          objectType,
          status: redfoxRun.callLogId ? 'linked' : 'not_applicable',
          refId: redfoxRun.callLogId,
          source: 'redfox_call_log',
        },
      ];
    }
    if (!records.length) {
      return [
        {
          objectType,
          status: 'planned',
          refId: null,
          source: 'redfox_skill_mapping',
        },
      ];
    }
    return records.map((record, index) => ({
      objectType,
      status: 'ready_for_persistence',
      refId: null,
      source: 'redfox_skill_output_normalizer',
      dedupeKey: record.dedupeKey,
      preview: record.preview,
      index,
    }));
  }

  private async persistRedfoxNormalizedRecords(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id' | 'tenantId' | 'userId'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    normalizationPlan: RedfoxOutputNormalizationPlan,
  ): Promise<RedfoxNormalizedPersistenceResult> {
    const persistedRecords: RedfoxNormalizedPersistenceRecord[] = [];
    const skippedRecords: RedfoxNormalizedPersistenceSkip[] = [];
    const seen = new Set<string>();
    const context: RedfoxNormalizedPersistenceContext = {
      benchmarkAccountIdsByLinkKey: new Map(),
      materialIdsByLinkKey: new Map(),
      topicIdsByLinkKey: new Map(),
      commentInsightIdsByLinkKey: new Map(),
      growthLeadIdsByLinkKey: new Map(),
    };

    for (const record of this.sortRedfoxRecordsForPersistence(
      normalizationPlan.rawResultJson.normalized.records,
    )) {
      const recordKey = `${record.objectType}:${record.dedupeKey}`;
      if (seen.has(recordKey)) {
        skippedRecords.push({
          objectType: record.objectType,
          dedupeKey: record.dedupeKey,
          reason: 'duplicate_normalized_record',
        });
        continue;
      }
      seen.add(recordKey);

      if (record.objectType === 'IntelligenceItem') {
        persistedRecords.push(
          await this.persistRedfoxIntelligenceItem(
            tx,
            actor,
            run,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      if (record.objectType === 'IntelligenceReport') {
        persistedRecords.push(
          await this.persistRedfoxIntelligenceReport(
            tx,
            actor,
            run,
            taskId,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      if (record.objectType === 'BenchmarkAccount') {
        persistedRecords.push(
          await this.persistRedfoxBenchmarkAccount(
            tx,
            actor,
            run,
            redfoxRun,
            record,
            context,
          ),
        );
        continue;
      }

      if (record.objectType === 'GrowthAccountHealth') {
        persistedRecords.push(
          await this.persistRedfoxGrowthAccountHealth(tx, actor, run, record),
        );
        continue;
      }

      if (record.objectType === 'Material') {
        persistedRecords.push(
          await this.persistRedfoxMaterial(
            tx,
            run,
            taskId,
            redfoxRun,
            record,
            context,
          ),
        );
        continue;
      }

      if (record.objectType === 'Topic') {
        persistedRecords.push(
          await this.persistRedfoxTopic(tx, redfoxRun, record, context),
        );
        continue;
      }

      if (record.objectType === 'Article') {
        persistedRecords.push(
          await this.persistRedfoxArticle(tx, redfoxRun, record, context),
        );
        continue;
      }

      if (record.objectType === 'ComplianceCheck') {
        persistedRecords.push(
          await this.persistRedfoxComplianceCheck(
            tx,
            actor,
            run,
            taskId,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      if (record.objectType === 'CommentInsight') {
        persistedRecords.push(
          await this.persistRedfoxCommentInsight(
            tx,
            actor,
            run,
            redfoxRun,
            record,
            context,
          ),
        );
        continue;
      }

      if (record.objectType === 'GrowthLead') {
        persistedRecords.push(
          await this.persistRedfoxGrowthLead(
            tx,
            actor,
            run,
            taskId,
            record,
            context,
          ),
        );
        continue;
      }

      if (record.objectType === 'RuntimeExecution') {
        persistedRecords.push(
          await this.persistRedfoxRuntimeExecution(
            tx,
            run,
            taskId,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      if (record.objectType === 'AgentConfirmation') {
        persistedRecords.push(
          await this.persistRedfoxAgentConfirmation(
            tx,
            run,
            taskId,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      if (this.isRedfoxArtifactObjectType(record.objectType)) {
        persistedRecords.push(
          await this.persistRedfoxSolutionArtifact(
            tx,
            actor,
            run,
            taskId,
            redfoxRun,
            record,
          ),
        );
        continue;
      }

      skippedRecords.push({
        objectType: record.objectType,
        dedupeKey: record.dedupeKey,
        reason: 'persistence_not_enabled',
      });
    }

    return {
      persistedRecords,
      skippedRecords,
      counts: {
        persistedObjects: persistedRecords.filter(
          (item) => item.action === 'created',
        ).length,
        reusedObjects: persistedRecords.filter(
          (item) => item.action === 'reused',
        ).length,
        skippedPersistenceObjects: skippedRecords.length,
      },
    };
  }

  private sortRedfoxRecordsForPersistence(records: RedfoxNormalizedRecord[]) {
    const order: Record<string, number> = {
      Material: 10,
      GrowthLead: 10,
      IntelligenceItem: 20,
      Topic: 30,
      BenchmarkAccount: 30,
      CommentInsight: 30,
      Article: 40,
      PublishRecord: 50,
      AgentConfirmation: 60,
    };
    return [...records].sort(
      (left, right) =>
        (order[left.objectType] ?? 100) - (order[right.objectType] ?? 100),
    );
  }

  private async persistRedfoxIntelligenceItem(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'tenantId'>,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const tenantId = run.tenantId || null;
    const existing = await tx.intelligenceItem.findFirst({
      where: tenantId
        ? { tenantId, dedupeKey: record.dedupeKey }
        : { userId: actor.id, dedupeKey: record.dedupeKey },
      select: { id: true },
    });
    if (existing) {
      return {
        objectType: record.objectType,
        dedupeKey: record.dedupeKey,
        refId: existing.id,
        action: 'reused',
        source: 'intelligence_items',
      };
    }

    const data = record.data;
    const created = await tx.intelligenceItem.create({
      data: {
        tenantId,
        userId: actor.id,
        redfoxCallLogId: redfoxRun.callLogId || null,
        platform: this.stringField(data, 'platform', 'unknown'),
        type: this.stringField(data, 'type', 'redfox_skillhub'),
        title: this.stringField(data, 'title', redfoxRun.skill.name),
        content: this.nullableStringField(data, 'content'),
        summary: this.nullableStringField(data, 'summary'),
        sourceUrl: this.nullableStringField(data, 'sourceUrl'),
        sourceExternalId: this.nullableStringField(data, 'sourceExternalId'),
        author: this.nullableStringField(data, 'author'),
        authorUrl: this.nullableStringField(data, 'authorUrl'),
        metrics: this.toJson(this.jsonObjectField(data, 'metrics')),
        keywords: this.toJson(this.jsonArrayField(data, 'keywords')),
        raw: this.toJson({
          ...(this.readUnknownRecord(data.raw) || {}),
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          dedupeKey: record.dedupeKey,
        }),
        status: 'new',
        dedupeKey: record.dedupeKey,
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'intelligence_items',
    };
  }

  private async persistRedfoxIntelligenceReport(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id' | 'tenantId'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const completeness = Math.max(
      0,
      Math.min(100, Math.round(this.numberField(data, 'completeness') || 0)),
    );
    const created = await tx.intelligenceReport.create({
      data: {
        tenantId: run.tenantId || null,
        userId: actor.id,
        kind: this.stringField(data, 'kind', 'redfox_intelligence'),
        title: this.stringField(data, 'title', redfoxRun.skill.name),
        audience: this.nullableStringField(data, 'audience'),
        owner: this.nullableStringField(data, 'owner'),
        rangeKey: this.nullableStringField(data, 'rangeKey'),
        status: this.stringField(data, 'status', 'draft'),
        completeness,
        findings: this.toJson(this.asStringArray(data.findings)),
        evidence: this.toJson(this.asStringArray(data.evidence)),
        markdown: this.stringField(data, 'markdown', redfoxRun.skill.name),
        metadata: this.toJson({
          ...this.jsonObjectField(data, 'metadata'),
          redfoxAutoPersistence: {
            solutionRunId: run.id,
            solutionTaskId: taskId,
            redfoxCallLogId: redfoxRun.callLogId || null,
            dedupeKey: record.dedupeKey,
            source: record.source,
          },
        }),
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'intelligence_reports',
    };
  }

  private async persistRedfoxBenchmarkAccount(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'tenantId'>,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const tenantId = run.tenantId || null;
    const platform = this.normalizeGrowthLeadPlatform(
      this.stringField(data, 'platform', redfoxRun.skill.platform || 'unknown'),
    );
    const externalUserId =
      this.nullableStringField(data, 'externalUserId') ||
      this.nullableStringField(raw, 'externalUserId') ||
      `redfox-${this.shortHash(record.dedupeKey)}`;
    const existing = await tx.benchmarkAccount.findFirst({
      where: tenantId
        ? { tenantId, platform, externalUserId }
        : { userId: actor.id, platform, externalUserId },
      select: { id: true },
    });
    const linkKey = this.createConfirmedOutputLinkKey(record);
    if (existing) {
      context.benchmarkAccountIdsByLinkKey.set(linkKey, existing.id);
      return {
        objectType: record.objectType,
        dedupeKey: record.dedupeKey,
        refId: existing.id,
        action: 'reused',
        source: 'benchmark_accounts',
      };
    }

    const created = await tx.benchmarkAccount.create({
      data: {
        tenantId,
        userId: actor.id,
        growthLeadId: context.growthLeadIdsByLinkKey.get(linkKey) || null,
        platform,
        nickname: this.stringField(data, 'nickname', redfoxRun.skill.name),
        externalUserId,
        profileUrl:
          this.nullableStringField(data, 'profileUrl') ||
          this.nullableStringField(raw, 'profileUrl'),
        avatarUrl:
          this.nullableStringField(data, 'avatarUrl') ||
          this.nullableStringField(raw, 'avatarUrl'),
        metrics: this.toJson(this.jsonObjectField(data, 'metrics')),
        reason: this.nullableStringField(data, 'reason'),
        diagnosis: this.toJson({
          ...this.jsonObjectField(data, 'diagnosis'),
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          dedupeKey: record.dedupeKey,
        }),
        status: 'watching',
        raw: this.toJson({
          ...raw,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          dedupeKey: record.dedupeKey,
        }),
      },
    });
    context.benchmarkAccountIdsByLinkKey.set(linkKey, created.id);

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'benchmark_accounts',
    };
  }

  private async persistRedfoxGrowthAccountHealth(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'tenantId'>,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const tenantId = run.tenantId || null;
    const platform = this.normalizeGrowthLeadPlatform(
      this.stringField(data, 'platform', 'unknown'),
    );
    const accountId = this.stringField(
      data,
      'accountId',
      this.stringField(
        raw,
        'accountId',
        `redfox-${this.shortHash(record.dedupeKey)}`,
      ),
    );
    const healthId = `redfox-account-health-${this.shortHash(
      [tenantId || '', actor.id, platform, accountId].join('|'),
    )}`;
    const lastCheckedAt =
      this.dateField(data, 'lastCheckedAt') ||
      this.dateField(raw, 'lastCheckedAt') ||
      new Date();
    const cooldownUntil =
      this.dateField(data, 'cooldownUntil') ||
      this.dateField(raw, 'cooldownUntil');
    const todayActionCount = Math.max(
      0,
      Math.round(this.numberField(data, 'todayActionCount') || 0),
    );
    const failureRate = Math.max(
      0,
      Math.min(1, this.numberField(data, 'failureRate') || 0),
    );
    const base = {
      userId: actor.id,
      tenantId,
      platform,
      accountId,
      accountName: this.stringField(data, 'accountName', accountId),
      loginStatus: this.stringField(data, 'loginStatus', 'unknown'),
      todayActionCount,
      failureRate,
      riskStatus: this.stringField(data, 'riskStatus', 'unknown'),
      cooldownUntil,
      recommendation: this.stringField(
        data,
        'recommendation',
        'RedFox 账号体检已生成改进建议。',
      ),
      lastCheckedAt,
    };
    const created = await tx.growthAccountHealth.upsert({
      where: { id: healthId },
      create: {
        id: healthId,
        ...base,
      },
      update: base,
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'growth_account_health',
    };
  }

  private async persistRedfoxMaterial(
    tx: Prisma.TransactionClient,
    run: Pick<PrismaSolutionRun, 'id'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const sourceUrl =
      this.nullableStringField(data, 'sourceUrl') ||
      `redfox://solution-runs/${run.id}/tasks/${taskId}/${record.dedupeKey}`;
    const existing = await tx.material.findFirst({
      where: { sourceUrl },
      select: { id: true },
    });
    if (existing) {
      context.materialIdsByLinkKey.set(linkKey, existing.id);
      return {
        objectType: record.objectType,
        dedupeKey: record.dedupeKey,
        refId: existing.id,
        action: 'reused',
        source: 'materials',
      };
    }

    const metadata = {
      ...this.jsonObjectField(data, 'metadata'),
      redfoxAutoPersistence: {
        solutionRunId: run.id,
        solutionTaskId: taskId,
        redfoxCallLogId: redfoxRun.callLogId || null,
        dedupeKey: record.dedupeKey,
        source: record.source,
      },
    };
    const created = await tx.material.create({
      data: {
        title: this.stringField(data, 'title', redfoxRun.skill.name),
        content: this.nullableStringField(data, 'content'),
        summary: this.nullableStringField(data, 'summary'),
        sourceUrl,
        platform: this.stringField(data, 'platform', 'RedFox'),
        author: this.stringField(data, 'author', ''),
        keywords: this.asStringArray(data.keywords),
        metadata: this.toJson(metadata),
      },
    });
    context.materialIdsByLinkKey.set(linkKey, created.id);

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'materials',
    };
  }

  private async persistRedfoxRuntimeExecution(
    tx: Prisma.TransactionClient,
    run: Pick<PrismaSolutionRun, 'id'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const status = this.stringField(
      data,
      'status',
      redfoxRun.status === 'success' ? 'succeeded' : redfoxRun.status,
    );
    const ok = status === 'succeeded' || status === 'success';
    const created = await tx.runtimeExecution.create({
      data: {
        relatedId: run.id,
        relatedType: 'solution_run',
        executor: 'redfox',
        platform: this.stringField(
          data,
          'platform',
          redfoxRun.skill.platform || 'redfox',
        ),
        taskType: this.stringField(
          data,
          'taskType',
          redfoxRun.endpoint.operation || redfoxRun.skill.code || 'redfox_task',
        ),
        accountId: this.nullableStringField(data, 'accountId'),
        ok,
        status,
        reasonCode: this.stringField(
          data,
          'reasonCode',
          ok ? 'redfox_success' : 'redfox_execution_recorded',
        ),
        userMessage: this.stringField(
          data,
          'userMessage',
          ok ? 'RedFox 任务已完成并写入执行记录。' : 'RedFox 任务已记录。',
        ),
        technicalMessage: this.nullableStringField(data, 'technicalMessage'),
        runtimeJson: this.toJson({
          ...raw,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          redfoxRunId: redfoxRun.id,
          solutionTaskId: taskId,
          endpoint: redfoxRun.endpoint,
          requestPreview: redfoxRun.requestPreview,
          payloadSummary: redfoxRun.payloadSummary,
          dedupeKey: record.dedupeKey,
        }),
        evidenceJson: this.toJson(this.asStringArray(data.evidenceUrls)),
        readbackJson: this.toJson({
          payloadSample: redfoxRun.payloadSample ?? null,
          callLogId: redfoxRun.callLogId || null,
        }),
        agentSSessionId: this.nullableStringField(data, 'agentSSessionId'),
        engineUrl: redfoxRun.endpoint.path || null,
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'runtime_executions',
    };
  }

  private async persistRedfoxAgentConfirmation(
    tx: Prisma.TransactionClient,
    run: Pick<PrismaSolutionRun, 'id'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const sessionId =
      this.nullableStringField(data, 'agentSessionId') ||
      this.extractAgentSessionId(redfoxRun.payloadSummary) ||
      `solution-run:${run.id}`;
    const confirmation = await tx.agentConfirmation.create({
      data: {
        sessionId,
        action: this.stringField(
          data,
          'action',
          redfoxRun.skill.code || 'redfox_skillhub',
        ),
        status: this.stringField(data, 'status', 'pending'),
        riskLevel: this.stringField(data, 'riskLevel', 'medium'),
        target: this.nullableStringField(data, 'target'),
        targetLabel: this.nullableStringField(data, 'targetLabel'),
        content: this.nullableStringField(data, 'content'),
        replyText: this.nullableStringField(data, 'replyText'),
        operator: null,
        note: this.nullableStringField(data, 'note'),
        confirmationJson: this.toJson({
          ...raw,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          redfoxRunId: redfoxRun.id,
          solutionRunId: run.id,
          solutionTaskId: taskId,
          endpoint: redfoxRun.endpoint,
          requestPreview: redfoxRun.requestPreview,
          payloadSummary: redfoxRun.payloadSummary,
          dedupeKey: record.dedupeKey,
        }),
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: confirmation.id,
      action: 'created',
      source: 'agent_confirmations',
    };
  }

  private async persistRedfoxSolutionArtifact(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const sourceUrl =
      this.nullableStringField(data, 'sourceUrl') ||
      this.nullableStringField(data, 'url') ||
      this.nullableStringField(data, 'target') ||
      this.asStringArray(data.evidenceUrls)[0] ||
      null;
    const title = this.stringField(data, 'title', redfoxRun.skill.name);
    const created = await tx.solutionArtifact.create({
      data: {
        runId: run.id,
        taskId,
        kind: this.redfoxArtifactKind(record.objectType),
        uri: sourceUrl,
        path: this.nullableStringField(data, 'path'),
        mimeType: this.nullableStringField(data, 'mimeType'),
        sizeBytes: this.numberField(data, 'sizeBytes') || null,
        checksum: this.nullableStringField(data, 'checksum'),
        label: title,
        preview: this.toJson({
          objectType: record.objectType,
          title,
          summary: this.nullableStringField(data, 'summary'),
          platform: this.nullableStringField(data, 'platform'),
          riskLevel: this.nullableStringField(data, 'riskLevel'),
          authorizationStatus: this.nullableStringField(
            data,
            'authorizationStatus',
          ),
          sourceUrl,
          evidenceUrls: this.asStringArray(data.evidenceUrls),
          findings: this.asStringArray(data.findings),
        }),
        source: 'redfox_skill_output_normalizer',
        objectRef: this.toJson({
          objectType: record.objectType,
          dedupeKey: record.dedupeKey,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          redfoxRunId: redfoxRun.id,
          solutionRunId: run.id,
          solutionTaskId: taskId,
        }),
        piiLevel: record.objectType === 'KnowledgeItem' ? 'business' : 'none',
        redactionStatus: 'not_required',
        retentionPolicy: 'solution_audit',
        metadata: this.toJson({
          ...raw,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          redfoxRunId: redfoxRun.id,
          endpoint: redfoxRun.endpoint,
          requestPreview: redfoxRun.requestPreview,
          payloadSummary: redfoxRun.payloadSummary,
          dedupeKey: record.dedupeKey,
        }),
        createdBy: actor.id,
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'solution_artifacts',
    };
  }

  private isRedfoxArtifactObjectType(objectType: string) {
    return [
      'RiskEvidence',
      'KnowledgeItem',
      'EvidenceAttachment',
      'GrowthReport',
      'PublishRecord',
    ].includes(objectType);
  }

  private redfoxArtifactKind(objectType: string) {
    if (objectType === 'RiskEvidence') return 'risk_evidence';
    if (objectType === 'KnowledgeItem') return 'knowledge_item';
    if (objectType === 'EvidenceAttachment') return 'evidence_attachment';
    if (objectType === 'GrowthReport') return 'growth_report';
    if (objectType === 'PublishRecord') return 'publish_record_draft';
    return `redfox_${objectType.replace(/[A-Z]/g, (letter, index) => `${index ? '_' : ''}${letter.toLowerCase()}`)}`;
  }

  private async persistRedfoxTopic(
    tx: Prisma.TransactionClient,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const materialId = context.materialIdsByLinkKey.get(linkKey);
    const scoreDetails = this.jsonObjectField(data, 'scoreDetails');
    const keywords = this.asStringArray(data.keywords);
    const topic = await tx.topic.create({
      data: {
        title: this.stringField(data, 'title', redfoxRun.skill.name),
        description: this.nullableStringField(data, 'description'),
        summary: this.nullableStringField(data, 'summary'),
        sourceType: this.stringField(
          data,
          'sourceType',
          redfoxRun.endpoint.path ? 'RedFox API' : 'redfox_skillhub',
        ),
        keywords,
        searchQueries: this.asStringArray(data.searchQueries || data.keywords),
        aiScore: this.numberField(data, 'aiScore'),
        scoreDetails: Object.keys(scoreDetails).length
          ? this.toJson(scoreDetails)
          : undefined,
        scoreReason: this.nullableStringField(data, 'scoreReason'),
        status: 'pending',
        materials: materialId
          ? {
              create: [
                {
                  material: { connect: { id: materialId } },
                },
              ],
            }
          : undefined,
      },
    });
    context.topicIdsByLinkKey.set(linkKey, topic.id);
    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: topic.id,
      action: 'created',
      source: 'topics',
    };
  }

  private async persistRedfoxArticle(
    tx: Prisma.TransactionClient,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const contentFormat = this.stringField(data, 'contentFormat', 'markdown');
    const article = await tx.article.create({
      data: {
        topicId: context.topicIdsByLinkKey.get(linkKey) || null,
        title: this.stringField(data, 'title', redfoxRun.skill.name),
        content: this.stringField(data, 'content', ''),
        contentType: this.stringField(data, 'contentType', 'article'),
        contentFormat,
        status: this.stringField(data, 'status', 'draft'),
        rawHtml:
          contentFormat === 'html'
            ? this.nullableStringField(data, 'content')
            : null,
        finalHtml:
          contentFormat === 'html'
            ? this.nullableStringField(data, 'content')
            : null,
        xiaohongshuData: this.readUnknownRecord(data.xiaohongshuData)
          ? this.toJson(this.jsonObjectField(data, 'xiaohongshuData'))
          : undefined,
      },
    });
    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: article.id,
      action: 'created',
      source: 'articles',
    };
  }

  private async persistRedfoxComplianceCheck(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id' | 'tenantId'>,
    taskId: string,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const created = await tx.complianceCheck.create({
      data: {
        tenantId: run.tenantId || null,
        userId: actor.id,
        redfoxCallLogId: redfoxRun.callLogId || null,
        targetType: this.stringField(data, 'targetType', 'content'),
        targetId: null,
        platform: this.stringField(data, 'platform', 'unknown'),
        riskLevel: this.stringField(data, 'riskLevel', 'unknown'),
        status: this.stringField(data, 'status', 'completed'),
        findings: this.toJson(this.jsonArrayField(data, 'findings')),
        suggestions: this.toJson(this.jsonArrayField(data, 'suggestions')),
        raw: this.toJson({
          ...(this.readUnknownRecord(data.raw) || {}),
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          solutionRunId: run.id,
          solutionTaskId: taskId,
          dedupeKey: record.dedupeKey,
        }),
      },
    });

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'compliance_checks',
    };
  }

  private async persistRedfoxCommentInsight(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id' | 'tenantId'>,
    redfoxRun: RedfoxSkillRunResult,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const growthLeadId = context.growthLeadIdsByLinkKey.get(linkKey) || null;
    const created = await tx.commentInsight.create({
      data: {
        tenantId: run.tenantId || null,
        userId: actor.id,
        growthLeadId,
        redfoxCallLogId: redfoxRun.callLogId || null,
        platform: this.stringField(data, 'platform', 'unknown'),
        sourceUrl: this.nullableStringField(data, 'sourceUrl'),
        sourceExternalId:
          this.nullableStringField(data, 'sourceExternalId') ||
          this.nullableStringField(raw, 'sourceExternalId'),
        painPoints: this.toJson(this.jsonArrayField(data, 'painPoints')),
        intentKeywords: this.toJson(
          this.jsonArrayField(data, 'intentKeywords'),
        ),
        demandSignals: this.toJson(this.jsonArrayField(data, 'demandSignals')),
        objections: this.toJson(this.jsonArrayField(data, 'objections')),
        replySuggestions: this.toJson(
          this.jsonArrayField(data, 'replySuggestions'),
        ),
        raw: this.toJson({
          ...raw,
          redfoxSkillCode: redfoxRun.skill.code,
          redfoxSkillName: redfoxRun.skill.name,
          solutionRunId: run.id,
          dedupeKey: record.dedupeKey,
        }),
      },
    });
    context.commentInsightIdsByLinkKey.set(linkKey, created.id);

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: created.id,
      action: 'created',
      source: 'comment_insights',
    };
  }

  private async persistRedfoxGrowthLead(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    run: Pick<PrismaSolutionRun, 'id' | 'tenantId'>,
    taskId: string,
    record: RedfoxNormalizedRecord,
    context: RedfoxNormalizedPersistenceContext,
  ): Promise<RedfoxNormalizedPersistenceRecord> {
    const data = record.data;
    const raw = this.readUnknownRecord(data.raw) || {};
    const tenantId = run.tenantId || null;
    const leadId = `redfox-lead-${this.shortHash(
      [tenantId || '', actor.id, record.dedupeKey].join('|'),
    )}`;
    const linkKey = this.createConfirmedOutputLinkKey(record);
    const existing = await tx.growthLead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    const now = new Date();
    const score = Math.round(this.numberField(data, 'score') || 0);
    const matchedKeywords = this.asStringArray(
      data.matchedKeywords || data.intentKeywords || raw.keywords,
    );
    const scoreReasons = this.asStringArray(data.scoreReasons);
    const evidenceUrls = this.asStringArray(data.evidenceUrls);
    const replySuggestions = this.asStringArray(data.replySuggestions);
    const sourceText = this.stringField(
      data,
      'sourceText',
      this.stringField(data, 'nickname', 'RedFox 增长线索'),
    );
    const base = {
      userId: actor.id,
      tenantId,
      platform: this.normalizeGrowthLeadPlatform(
        this.stringField(data, 'platform', 'unknown'),
      ),
      sourceType: this.stringField(data, 'sourceType', 'redfox_skillhub'),
      sourceTaskId: taskId,
      sourceRunId: run.id,
      nickname: this.stringField(data, 'nickname', 'RedFox 线索'),
      profileUrl:
        this.nullableStringField(data, 'profileUrl') ||
        this.nullableStringField(raw, 'profileUrl'),
      avatarUrl:
        this.nullableStringField(data, 'avatarUrl') ||
        this.nullableStringField(raw, 'avatarUrl'),
      externalUserId:
        this.nullableStringField(data, 'externalUserId') ||
        this.nullableStringField(raw, 'externalUserId'),
      sourceText,
      sourceUrl: this.nullableStringField(data, 'sourceUrl'),
      videoTitle:
        this.nullableStringField(data, 'videoTitle') ||
        this.nullableStringField(raw, 'title'),
      videoUrl:
        this.nullableStringField(data, 'videoUrl') ||
        this.nullableStringField(data, 'sourceUrl'),
      commentTime:
        this.nullableStringField(data, 'commentTime') ||
        this.nullableStringField(raw, 'commentTime'),
      matchedKeywords: this.toJson(matchedKeywords),
      score: Math.max(0, Math.min(100, score)),
      scoreReasons: this.toJson(scoreReasons),
      status: 'new',
      nextFollowUpAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ownerUserId: actor.id,
      notes: this.toJson([
        {
          id: this.shortHash(`${leadId}:redfox-note`),
          type: 'redfox_skillhub',
          text:
            replySuggestions[0] ||
            scoreReasons[0] ||
            '从 RedFox 评论洞察转入增长线索池。',
          createdAt: now.toISOString(),
          createdBy: actor.id,
        },
      ]),
      evidenceUrls: this.toJson(evidenceUrls),
      latestReply: replySuggestions[0] || null,
    };
    const lead = await tx.growthLead.upsert({
      where: { id: leadId },
      create: {
        id: leadId,
        ...base,
      },
      update: {
        ...base,
        updatedAt: now,
      },
    });

    context.growthLeadIdsByLinkKey.set(linkKey, lead.id);
    const commentInsightId = context.commentInsightIdsByLinkKey.get(linkKey);
    if (commentInsightId) {
      await tx.commentInsight.update({
        where: { id: commentInsightId },
        data: { growthLeadId: lead.id },
      });
    }
    const benchmarkAccountId =
      context.benchmarkAccountIdsByLinkKey.get(linkKey);
    if (benchmarkAccountId) {
      await tx.benchmarkAccount.update({
        where: { id: benchmarkAccountId },
        data: { growthLeadId: lead.id },
      });
    }

    return {
      objectType: record.objectType,
      dedupeKey: record.dedupeKey,
      refId: lead.id,
      action: existing ? 'reused' : 'created',
      source: 'growth_leads',
    };
  }

  private applyRedfoxNormalizationPersistence(
    normalizationPlan: RedfoxOutputNormalizationPlan,
    persistence: RedfoxNormalizedPersistenceResult,
  ): RedfoxOutputNormalizationPlan {
    const persistedByKey = new Map(
      persistence.persistedRecords.map((item) => [
        `${item.objectType}:${item.dedupeKey}`,
        item,
      ]),
    );
    const skippedByKey = new Map(
      persistence.skippedRecords.map((item) => [
        `${item.objectType}:${item.dedupeKey}`,
        item,
      ]),
    );
    const businessObjectRefs = normalizationPlan.businessObjectRefs.map(
      (ref) => {
        const recordKey = ref.dedupeKey
          ? `${ref.objectType}:${ref.dedupeKey}`
          : null;
        const persisted = recordKey ? persistedByKey.get(recordKey) : null;
        if (persisted) {
          return {
            ...ref,
            status: persisted.action === 'created' ? 'created' : 'linked',
            refId: persisted.refId,
            source: persisted.source,
            persistence: persisted.action,
          };
        }
        const skipped = recordKey ? skippedByKey.get(recordKey) : null;
        if (skipped && ref.status === 'ready_for_persistence') {
          return {
            ...ref,
            persistence: 'skipped',
            reason: skipped.reason,
          };
        }
        return ref;
      },
    );
    const persistedOrReused = persistence.persistedRecords.length;
    const normalizedObjects = Number(
      normalizationPlan.counts.normalizedObjects || 0,
    );
    const status =
      normalizedObjects <= 0
        ? normalizationPlan.status
        : persistedOrReused && persistence.skippedRecords.length
          ? 'partially_persisted'
          : persistedOrReused
            ? 'persisted'
            : normalizationPlan.status;

    return {
      ...normalizationPlan,
      status,
      businessObjectRefs,
      counts: {
        ...normalizationPlan.counts,
        ...persistence.counts,
      },
      nextAction: this.redfoxPersistenceNextAction(
        normalizationPlan,
        persistence,
      ),
      payloadSummary: {
        ...normalizationPlan.payloadSummary,
        persistence: {
          supportedObjectTypes: [
            'IntelligenceItem',
            'IntelligenceReport',
            'BenchmarkAccount',
            'GrowthAccountHealth',
            'Material',
            'Topic',
            'ComplianceCheck',
            'CommentInsight',
            'GrowthLead',
            'RuntimeExecution',
            'AgentConfirmation',
            'Article',
            'RiskEvidence',
            'KnowledgeItem',
            'EvidenceAttachment',
            'GrowthReport',
            'PublishRecord',
          ],
          ...persistence.counts,
        },
      },
      rawResultJson: {
        ...normalizationPlan.rawResultJson,
        status,
        normalized: {
          ...normalizationPlan.rawResultJson.normalized,
          persistence,
        },
      },
    };
  }

  private redfoxPersistenceNextAction(
    normalizationPlan: RedfoxOutputNormalizationPlan,
    persistence: RedfoxNormalizedPersistenceResult,
  ) {
    const written =
      persistence.counts.persistedObjects + persistence.counts.reusedObjects;
    if (!written) return normalizationPlan.nextAction;
    if (persistence.counts.skippedPersistenceObjects) {
      return `已写入或复用 ${written} 个业务对象；${persistence.counts.skippedPersistenceObjects} 个对象因暂未开放持久化或重复，继续保留为归一化草稿。`;
    }
    return `已写入或复用 ${written} 个业务对象，后续页面可以直接读取正式业务表。`;
  }

  private normalizeRedfoxSkillOutput(
    mapping: RedfoxSkillMapping,
    redfoxRun: RedfoxSkillRunResult,
  ): RedfoxNormalizedOutput {
    const payload = this.extractRedfoxPayload(redfoxRun);
    const items = this.extractPayloadItems(payload);
    const records: RedfoxNormalizedRecord[] = [];
    const hasReportOutput =
      mapping.outputObjects.includes('IntelligenceReport');
    const itemMapping = hasReportOutput
      ? {
          ...mapping,
          outputObjects: mapping.outputObjects.filter(
            (objectType) => objectType !== 'IntelligenceReport',
          ),
        }
      : mapping;
    for (const item of items) {
      records.push(
        ...this.normalizeRedfoxPayloadItem(itemMapping, redfoxRun, item),
      );
    }
    if (hasReportOutput) {
      const reportRecord = this.normalizeRedfoxPayloadItemAsObject(
        'IntelligenceReport',
        mapping,
        redfoxRun,
        this.createRedfoxReportPayload(payload, items, redfoxRun),
      );
      if (reportRecord) records.push(reportRecord);
    }
    return {
      records,
      counts: {
        rawItems: items.length,
        intelligenceItems: records.filter(
          (item) => item.objectType === 'IntelligenceItem',
        ).length,
        topics: records.filter((item) => item.objectType === 'Topic').length,
        materials: records.filter((item) => item.objectType === 'Material')
          .length,
        articles: records.filter((item) => item.objectType === 'Article')
          .length,
        publishRecords: records.filter(
          (item) => item.objectType === 'PublishRecord',
        ).length,
        knowledgeItems: records.filter(
          (item) => item.objectType === 'KnowledgeItem',
        ).length,
        evidenceAttachments: records.filter(
          (item) => item.objectType === 'EvidenceAttachment',
        ).length,
        benchmarkAccounts: records.filter(
          (item) => item.objectType === 'BenchmarkAccount',
        ).length,
        growthAccountHealths: records.filter(
          (item) => item.objectType === 'GrowthAccountHealth',
        ).length,
        complianceChecks: records.filter(
          (item) => item.objectType === 'ComplianceCheck',
        ).length,
        riskEvidences: records.filter(
          (item) => item.objectType === 'RiskEvidence',
        ).length,
        agentConfirmations: records.filter(
          (item) => item.objectType === 'AgentConfirmation',
        ).length,
        commentInsights: records.filter(
          (item) => item.objectType === 'CommentInsight',
        ).length,
        growthLeads: records.filter((item) => item.objectType === 'GrowthLead')
          .length,
        growthReports: records.filter(
          (item) => item.objectType === 'GrowthReport',
        ).length,
        intelligenceReports: records.filter(
          (item) => item.objectType === 'IntelligenceReport',
        ).length,
        runtimeExecutions: records.filter(
          (item) => item.objectType === 'RuntimeExecution',
        ).length,
      },
      sourceKind: this.detectRedfoxPayloadKind(payload),
      confidence: records.length ? 'medium' : 'none',
    };
  }

  private normalizeRedfoxPayloadItem(
    mapping: RedfoxSkillMapping,
    redfoxRun: RedfoxSkillRunResult,
    item: Record<string, unknown>,
  ): RedfoxNormalizedRecord[] {
    const records: RedfoxNormalizedRecord[] = [];
    for (const objectType of mapping.outputObjects) {
      const record = this.normalizeRedfoxPayloadItemAsObject(
        objectType,
        mapping,
        redfoxRun,
        item,
      );
      if (record) records.push(record);
    }
    return records;
  }

  private normalizeRedfoxPayloadItemAsObject(
    objectType: string,
    mapping: RedfoxSkillMapping,
    redfoxRun: RedfoxSkillRunResult,
    item: Record<string, unknown>,
  ): RedfoxNormalizedRecord | null {
    const title =
      this.firstText(item, [
        'title',
        'name',
        'accountName',
        'nickname',
        'nickName',
        'userName',
        'uniqueId',
        'uid',
        'keyword',
        'topic',
        'reportTitle',
        'headline',
        'comment',
        'text',
        'content',
        'summary',
        'word',
        'riskWord',
        'risk_word',
        'hit',
      ]) || redfoxRun.skill.name;
    const url = this.firstText(item, [
      'url',
      'sourceUrl',
      'source_url',
      'link',
      'shareUrl',
      'share_url',
      'articleUrl',
      'article_url',
      'contentUrl',
      'content_url',
      'profileUrl',
      'profile_url',
      'homepage',
      'homepageUrl',
      'originalUrl',
      'original_url',
    ]);
    const platform =
      this.firstText(item, ['platform', 'source', 'channel']) ||
      mapping.platform;
    const score = this.firstNumber(item, [
      'score',
      'hotScore',
      'hot_score',
      'heat',
      'rankScore',
    ]);
    const dedupeKey = this.createNormalizedDedupeKey(
      objectType,
      redfoxRun.skill.code || mapping.skillCode,
      title,
      url,
    );
    const base = {
      objectType,
      status: 'ready_for_persistence' as const,
      dedupeKey,
      preview: {
        title: this.truncateText(title, 120),
        platform,
        score,
        url,
      },
      source: {
        provider: 'redfox',
        skillCode: redfoxRun.skill.code || mapping.skillCode,
        mappingCode: mapping.code,
        scenario: mapping.scenario,
      },
    };

    if (objectType === 'IntelligenceItem') {
      return {
        ...base,
        data: {
          platform,
          type: mapping.scenario,
          title,
          content: this.firstText(item, [
            'content',
            'description',
            'desc',
            'abstract',
            'digest',
          ]),
          summary: this.firstText(item, [
            'summary',
            'reason',
            'insight',
            'abstract',
            'digest',
          ]),
          sourceUrl: url,
          author: this.firstText(item, [
            'author',
            'authorName',
            'nickname',
            'nickName',
            'userName',
            'accountName',
            'sourceName',
          ]),
          metrics: this.pickKnownFields(item, [
            'score',
            'hotScore',
            'hot_score',
            'heat',
            'rank',
            'readCount',
            'read_count',
            'likeCount',
            'like_count',
            'commentCount',
            'comment_count',
            'shareCount',
            'share_count',
          ]),
          keywords: this.asStringArray(item.keywords),
          raw: item,
        },
      };
    }
    if (objectType === 'IntelligenceReport') {
      const findings = this.extractReportStrings(item, [
        'findings',
        'insights',
        'conclusions',
        'highlights',
        'opportunities',
      ]);
      const evidence = this.extractReportStrings(item, [
        'evidence',
        'sources',
        'references',
        'links',
        'items',
      ]);
      const summary =
        this.firstText(item, [
          'summary',
          'answer',
          'abstract',
          'digest',
          'description',
          'content',
        ]) ||
        findings[0] ||
        title;
      const markdown =
        this.firstText(item, [
          'markdown',
          'reportMarkdown',
          'report',
          'answer',
          'content',
        ]) ||
        this.buildRedfoxReportMarkdown(title, summary, findings, evidence);
      const completeness =
        this.firstNumber(item, ['completeness', 'confidence', 'score']) ??
        Math.min(100, 50 + findings.length * 8 + evidence.length * 6);
      return {
        ...base,
        data: {
          kind: mapping.scenario,
          title,
          audience: this.firstText(item, ['audience']),
          owner: this.firstText(item, ['owner']),
          rangeKey: this.firstText(item, [
            'rangeKey',
            'range',
            'timeRange',
            'time_range',
          ]),
          status: 'draft',
          completeness,
          findings,
          evidence,
          markdown,
          metadata: {
            raw: item,
            provider: 'redfox',
            mappingCode: mapping.code,
            skillCode: redfoxRun.skill.code || mapping.skillCode,
          },
        },
      };
    }
    if (objectType === 'BenchmarkAccount') {
      return {
        ...base,
        data: {
          platform,
          nickname:
            this.firstText(item, [
              'nickname',
              'nickName',
              'name',
              'accountName',
              'userName',
              'author',
              'uniqueId',
            ]) || title,
          externalUserId: this.firstText(item, [
            'externalUserId',
            'external_user_id',
            'secUid',
            'sec_uid',
            'uid',
            'userId',
            'user_id',
            'mid',
            'accountId',
            'account_id',
            'uniqueId',
            'unique_id',
          ]),
          profileUrl:
            this.firstText(item, [
              'profileUrl',
              'profile_url',
              'homepage',
              'homepageUrl',
              'url',
              'link',
              'shareUrl',
            ]) || url,
          avatarUrl: this.firstText(item, [
            'avatarUrl',
            'avatar_url',
            'avatar',
            'avatarThumb',
            'avatar_thumb',
            'cover',
          ]),
          metrics: this.pickKnownFields(item, [
            'score',
            'rank',
            'fans',
            'fanCount',
            'fansCount',
            'followerCount',
            'followersCount',
            'likeCount',
            'likedCount',
            'workCount',
            'videoCount',
            'articleCount',
            'readCount',
            'commentCount',
            'shareCount',
          ]),
          reason: this.firstText(item, [
            'reason',
            'summary',
            'description',
            'desc',
            'signature',
            'bio',
          ]),
          diagnosis: {
            scenario: mapping.scenario,
            ...this.pickKnownFields(item, [
              'score',
              'rank',
              'reason',
              'summary',
              'category',
              'tags',
            ]),
          },
          raw: item,
        },
      };
    }
    if (objectType === 'GrowthAccountHealth') {
      const accountId =
        this.firstText(item, [
          'accountId',
          'account_id',
          'externalUserId',
          'external_user_id',
          'secUid',
          'sec_uid',
          'uid',
          'userId',
          'user_id',
          'mid',
          'uniqueId',
          'unique_id',
        ]) || `redfox-${this.shortHash(dedupeKey)}`;
      const accountName =
        this.firstText(item, [
          'accountName',
          'nickname',
          'nickName',
          'name',
          'userName',
          'author',
          'uniqueId',
        ]) || title;
      const healthScore =
        score ??
        this.firstNumber(item, ['healthScore', 'health_score', 'safeScore']);
      const riskStatus =
        this.firstText(item, ['riskStatus', 'risk_status', 'risk', 'level']) ||
        (healthScore === null
          ? 'unknown'
          : healthScore < 60
            ? 'high'
            : healthScore < 80
              ? 'medium'
              : 'healthy');
      return {
        ...base,
        data: {
          platform,
          accountId,
          accountName,
          loginStatus:
            this.firstText(item, [
              'loginStatus',
              'login_status',
              'status',
              'state',
            ]) || 'unknown',
          todayActionCount:
            this.firstNumber(item, ['todayActionCount', 'actionCount']) || 0,
          failureRate:
            this.firstNumber(item, ['failureRate', 'failure_rate']) || 0,
          riskStatus,
          cooldownUntil: this.firstText(item, [
            'cooldownUntil',
            'cooldown_until',
          ]),
          recommendation:
            this.firstText(item, [
              'recommendation',
              'suggestion',
              'advice',
              'reason',
              'summary',
              'description',
            ]) || `${accountName} 账号体检完成，请按建议优化后续运营。`,
          lastCheckedAt: this.firstText(item, [
            'lastCheckedAt',
            'last_checked_at',
            'checkedAt',
          ]),
          raw: item,
        },
      };
    }
    if (objectType === 'Topic') {
      return {
        ...base,
        data: {
          title,
          description: this.firstText(item, [
            'description',
            'summary',
            'reason',
            'content',
            'abstract',
            'digest',
          ]),
          sourceType: redfoxRun.endpoint.path
            ? 'redfox_api'
            : 'redfox_skillhub',
          keywords: this.asStringArray(item.keywords),
          aiScore: score,
          scoreDetails: this.pickKnownFields(item, [
            'score',
            'hotScore',
            'hot_score',
            'reason',
            'rank',
            'heat',
          ]),
          raw: item,
        },
      };
    }
    if (objectType === 'Material') {
      return {
        ...base,
        data: {
          title,
          content: this.firstText(item, [
            'content',
            'ocrText',
            'ocr_text',
            'extractedText',
            'extracted_text',
            'text',
            'description',
            'summary',
            'abstract',
            'digest',
          ]),
          summary: this.firstText(item, [
            'summary',
            'description',
            'abstract',
            'digest',
          ]),
          sourceUrl: url || '',
          platform,
          author:
            this.firstText(item, [
              'author',
              'authorName',
              'nickname',
              'nickName',
              'userName',
              'accountName',
              'sourceName',
            ]) || '',
          keywords: this.asStringArray(item.keywords),
          metadata: item,
        },
      };
    }
    if (objectType === 'KnowledgeItem') {
      return {
        ...base,
        data: {
          title,
          content:
            this.firstText(item, [
              'content',
              'text',
              'ocrText',
              'ocr_text',
              'description',
              'summary',
            ]) || title,
          summary: this.firstText(item, ['summary', 'description', 'digest']),
          sourceUrl: url || '',
          sourceType: redfoxRun.endpoint.path
            ? 'redfox_api'
            : 'redfox_skillhub',
          keywords: this.asStringArray(item.keywords),
          raw: item,
        },
      };
    }
    if (objectType === 'EvidenceAttachment') {
      const attachmentUrl =
        url ||
        this.firstText(item, [
          'fileUrl',
          'file_url',
          'imageUrl',
          'image_url',
          'assetUrl',
          'asset_url',
        ]);
      return {
        ...base,
        data: {
          title,
          url: attachmentUrl,
          sourceUrl: attachmentUrl,
          platform,
          authorizationStatus:
            this.firstText(item, [
              'authorizationStatus',
              'authorization_status',
              'license',
            ]) || 'unknown',
          raw: item,
        },
      };
    }
    if (objectType === 'Article' || objectType === 'PublishRecord') {
      return {
        ...base,
        data: {
          title,
          content:
            this.firstText(item, [
              'content',
              'text',
              'rewrite',
              'article',
              'body',
            ]) || title,
          contentType: platform === 'xiaohongshu' ? 'xiaohongshu' : 'article',
          contentFormat: 'markdown',
          status: objectType === 'PublishRecord' ? 'pending' : 'draft',
          platform,
          raw: item,
        },
      };
    }
    if (objectType === 'RuntimeExecution') {
      return {
        ...base,
        data: {
          platform,
          taskType: mapping.scenario,
          status:
            this.firstText(item, ['status', 'state', 'taskStatus']) ||
            (redfoxRun.status === 'success' ? 'succeeded' : redfoxRun.status),
          accountId: this.firstText(item, [
            'accountId',
            'account_id',
            'userId',
            'taskId',
          ]),
          reasonCode: this.firstText(item, ['reasonCode', 'reason_code']),
          userMessage:
            this.firstText(item, ['message', 'userMessage', 'summary']) ||
            `${redfoxRun.skill.name} 已生成执行记录。`,
          technicalMessage: this.firstText(item, [
            'technicalMessage',
            'error',
            'errorMessage',
          ]),
          evidenceUrls: this.asStringArray(
            item.evidenceUrls ||
              item.evidence_urls ||
              item.images ||
              item.urls ||
              item.resultUrls,
          ),
          raw: item,
        },
      };
    }
    if (objectType === 'ComplianceCheck') {
      const findings = this.extractFindings(item);
      return {
        ...base,
        data: {
          targetType: 'content',
          platform,
          riskLevel: this.detectRiskLevel(item, findings),
          status: 'completed',
          findings,
          suggestions: this.extractSuggestions(item),
          raw: item,
        },
      };
    }
    if (objectType === 'RiskEvidence') {
      const findings = this.extractFindings(item);
      const evidenceUrls = this.asStringArray(
        item.evidenceUrls ||
          item.evidence_urls ||
          item.sources ||
          item.links ||
          item.urls,
      );
      return {
        ...base,
        data: {
          targetType: 'content',
          platform,
          riskLevel: this.detectRiskLevel(item, findings),
          title,
          findings,
          evidenceUrls: evidenceUrls.length ? evidenceUrls : url ? [url] : [],
          suggestions: this.extractSuggestions(item),
          raw: item,
        },
      };
    }
    if (objectType === 'AgentConfirmation') {
      const findings = this.extractFindings(item);
      const riskLevel = this.detectRiskLevel(item, findings);
      const replySuggestions = this.asStringArray(
        item.replySuggestions || item.reply_suggestions || item.replies,
      );
      const confirmationContent =
        this.firstText(item, ['content', 'text', 'article', 'comment']) ||
        title;
      return {
        ...base,
        data: {
          action: mapping.scenario,
          status: 'pending',
          riskLevel,
          target: this.firstText(item, ['target', 'url', 'sourceUrl']) || url,
          targetLabel: confirmationContent,
          content: confirmationContent,
          note:
            this.firstText(item, ['reason', 'summary', 'suggestion']) ||
            replySuggestions[0] ||
            'RedFox SkillHub 输出需要人工确认后再进入下一步。',
          agentSessionId: this.extractAgentSessionId(redfoxRun.payloadSummary),
          raw: item,
        },
      };
    }
    if (objectType === 'CommentInsight') {
      return {
        ...base,
        data: {
          platform,
          sourceUrl: url,
          sourceExternalId: this.firstText(item, [
            'sourceExternalId',
            'commentId',
            'comment_id',
            'id',
            'cid',
            'rpid',
          ]),
          painPoints: this.asStringArray(item.painPoints || item.pain_points),
          intentKeywords: this.asStringArray(
            item.intentKeywords || item.intent_keywords || item.keywords,
          ),
          demandSignals: this.asStringArray(
            item.demandSignals || item.demand_signals || item.signals,
          ),
          objections: this.asStringArray(item.objections),
          replySuggestions: this.asStringArray(
            item.replySuggestions || item.reply_suggestions || item.replies,
          ),
          raw: item,
        },
      };
    }
    if (objectType === 'GrowthReport') {
      const findings = this.extractReportStrings(item, [
        'findings',
        'insights',
        'conclusions',
        'highlights',
        'opportunities',
        'reasons',
      ]);
      const evidence = this.extractReportStrings(item, [
        'evidence',
        'sources',
        'references',
        'links',
        'items',
        'accounts',
      ]);
      const summary =
        this.firstText(item, ['summary', 'reason', 'description', 'content']) ||
        findings[0] ||
        title;
      return {
        ...base,
        data: {
          kind: mapping.scenario,
          title,
          summary,
          findings,
          evidence,
          markdown: this.buildRedfoxReportMarkdown(
            title,
            summary,
            findings,
            evidence,
          ),
          raw: item,
        },
      };
    }
    if (objectType === 'GrowthLead') {
      return {
        ...base,
        data: {
          platform,
          sourceType: redfoxRun.endpoint.path
            ? 'redfox_api'
            : 'redfox_skillhub',
          nickname:
            this.firstText(item, [
              'nickname',
              'nickName',
              'author',
              'name',
              'accountName',
              'userName',
              'uniqueId',
            ]) || title,
          profileUrl:
            this.firstText(item, [
              'profileUrl',
              'profile_url',
              'homepage',
              'homepageUrl',
              'url',
              'link',
            ]) || url,
          avatarUrl: this.firstText(item, [
            'avatarUrl',
            'avatar_url',
            'avatar',
            'avatarThumb',
            'avatar_thumb',
          ]),
          externalUserId: this.firstText(item, [
            'externalUserId',
            'external_user_id',
            'secUid',
            'sec_uid',
            'uid',
            'userId',
            'user_id',
            'mid',
            'accountId',
            'account_id',
            'uniqueId',
            'unique_id',
          ]),
          sourceText:
            this.firstText(item, [
              'content',
              'comment',
              'text',
              'reason',
              'summary',
              'description',
              'signature',
              'bio',
            ]) || title,
          sourceUrl: url,
          score: score || 0,
          scoreReasons: this.asStringArray(
            item.scoreReasons || item.reasons || item.reason,
          ),
          evidenceUrls: this.asStringArray(
            item.evidenceUrls || item.evidence_urls,
          ).length
            ? this.asStringArray(item.evidenceUrls || item.evidence_urls)
            : url
              ? [url]
              : [],
          matchedKeywords: this.asStringArray(item.keywords),
          replySuggestions: this.asStringArray(
            item.replySuggestions || item.reply_suggestions,
          ),
          raw: item,
        },
      };
    }
    return null;
  }

  private extractRedfoxPayload(redfoxRun: RedfoxSkillRunResult): unknown {
    const sample = redfoxRun.payloadSample;
    const record = this.readUnknownRecord(sample);
    if (!record) return sample ?? null;
    if ('output' in record) return record.output;
    if ('payload' in record) return record.payload;
    if ('data' in record) return record.data;
    return record;
  }

  private extractPayloadItems(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload
        .map((item) => this.readUnknownRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
    const record = this.readUnknownRecord(payload);
    if (!record) return [];
    for (const key of [
      'items',
      'results',
      'data',
      'list',
      'records',
      'comments',
      'findings',
      'outputs',
      'articles',
    ]) {
      const value = record[key];
      if (!Array.isArray(value)) continue;
      const items = value
        .map((item) => this.readUnknownRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
      if (items.length) return items;
    }
    return [record];
  }

  private detectRedfoxPayloadKind(payload: unknown): string {
    if (Array.isArray(payload)) return 'array';
    const record = this.readUnknownRecord(payload);
    if (!record) return typeof payload;
    for (const key of [
      'items',
      'results',
      'data',
      'list',
      'comments',
      'findings',
    ]) {
      if (Array.isArray(record[key])) return key;
    }
    return 'object';
  }

  private firstText(
    record: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  }

  private firstNumber(
    record: Record<string, unknown>,
    keys: string[],
  ): number | null {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const numeric = Number(value.replace(/,/g, ''));
        if (Number.isFinite(numeric)) return numeric;
      }
    }
    return null;
  }

  private pickKnownFields(record: Record<string, unknown>, keys: string[]) {
    return Object.fromEntries(
      keys
        .filter((key) => record[key] !== undefined && record[key] !== null)
        .map((key) => [key, record[key]]),
    );
  }

  private asStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          typeof item === 'string'
            ? item.trim()
            : typeof item === 'number'
              ? String(item)
              : '',
        )
        .filter(Boolean)
        .slice(0, 50);
    }
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[,，、\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 50);
    }
    return [];
  }

  private extractFindings(record: Record<string, unknown>): unknown[] {
    for (const key of ['findings', 'risks', 'words', 'violations', 'hits']) {
      const value = record[key];
      if (Array.isArray(value)) return value;
    }
    const word = this.firstText(record, [
      'word',
      'keyword',
      'riskWord',
      'risk_word',
      'hit',
    ]);
    if (word) {
      return [
        {
          word,
          reason: this.firstText(record, ['reason', 'risk', 'category']),
          suggestion: this.firstText(record, ['suggestion', 'replacement']),
        },
      ];
    }
    return [];
  }

  private extractSuggestions(record: Record<string, unknown>): unknown[] {
    for (const key of ['suggestions', 'replacements', 'rewriteSuggestions']) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim()) return [value.trim()];
    }
    const suggestion = this.firstText(record, [
      'suggestion',
      'replacement',
      'advice',
    ]);
    return suggestion ? [suggestion] : [];
  }

  private detectRiskLevel(
    record: Record<string, unknown>,
    findings: unknown[],
  ): string {
    const explicit = this.firstText(record, [
      'riskLevel',
      'risk_level',
      'level',
      'severity',
    ]);
    if (explicit) return explicit.toLowerCase();
    return findings.length ? 'medium' : 'low';
  }

  private extractAgentSessionId(value: unknown): string | null {
    const record = this.readUnknownRecord(value);
    if (!record) return null;
    const direct = record.agentSessionId;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    const session = this.readUnknownRecord(record.session);
    const sessionId = session?.session_id || session?.sessionId;
    if (typeof sessionId === 'string' && sessionId.trim()) {
      return sessionId.trim();
    }
    return null;
  }

  private createNormalizedDedupeKey(
    objectType: string,
    skillCode: string,
    title: string,
    url: string | null,
  ) {
    return createHash('sha256')
      .update(
        JSON.stringify({
          objectType,
          skillCode,
          title: title.trim().toLowerCase(),
          url: (url || '').trim(),
        }),
      )
      .digest('hex')
      .slice(0, 32);
  }

  private shortHash(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 20);
  }

  private truncateText(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  private stringField(
    record: Record<string, unknown>,
    key: string,
    fallback: string,
  ) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return fallback;
  }

  private nullableStringField(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private numberField(
    record: Record<string, unknown>,
    key: string,
  ): number | null {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const numeric = Number(value.replace(/,/g, ''));
      if (Number.isFinite(numeric)) return numeric;
    }
    return null;
  }

  private dateField(record: Record<string, unknown>, key: string): Date | null {
    const value = record[key];
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return null;
  }

  private normalizeGrowthLeadPlatform(value: string) {
    const text = value.toLowerCase();
    if (text.includes('douyin') || value.includes('抖音')) return 'douyin';
    if (text.includes('xiaohongshu') || value.includes('小红书')) {
      return 'xiaohongshu';
    }
    if (text.includes('bilibili') || value.includes('B 站')) {
      return 'bilibili';
    }
    if (text.includes('wechat-channel') || value.includes('视频号')) {
      return 'wechat-channel';
    }
    if (text.includes('wechat') || value.includes('微信')) return 'wechat';
    if (text.includes('kuaishou') || value.includes('快手')) return 'kuaishou';
    return value || 'unknown';
  }

  private createRedfoxReportPayload(
    payload: unknown,
    items: Record<string, unknown>[],
    redfoxRun: RedfoxSkillRunResult,
  ): Record<string, unknown> {
    const record = this.readUnknownRecord(payload) || {};
    const itemTitles = items
      .map((item) =>
        this.firstText(item, ['title', 'name', 'topic', 'summary', 'content']),
      )
      .filter((item): item is string => Boolean(item));
    const itemEvidence = items
      .map((item) =>
        this.firstText(item, [
          'url',
          'sourceUrl',
          'source_url',
          'link',
          'articleUrl',
          'article_url',
        ]),
      )
      .filter((item): item is string => Boolean(item));
    const title =
      this.firstText(record, ['title', 'reportTitle', 'headline', 'query']) ||
      `${redfoxRun.skill.name}情报报告`;
    const summary =
      this.firstText(record, [
        'summary',
        'answer',
        'abstract',
        'digest',
        'description',
        'content',
      ]) || itemTitles.slice(0, 5).join('；');

    return {
      ...record,
      title,
      summary,
      findings: record.findings || record.insights || itemTitles,
      evidence: record.evidence || record.sources || itemEvidence,
      items,
    };
  }

  private extractReportStrings(
    record: Record<string, unknown>,
    keys: string[],
  ): string[] {
    for (const key of keys) {
      const value = record[key];
      const strings = this.asStringArray(value);
      if (strings.length) return strings;
      if (!Array.isArray(value)) continue;
      const mapped = value
        .map((item) => {
          const child = this.readUnknownRecord(item);
          if (!child) return null;
          return this.firstText(child, [
            'title',
            'name',
            'summary',
            'content',
            'url',
            'sourceUrl',
            'link',
          ]);
        })
        .filter((item): item is string => Boolean(item));
      if (mapped.length) return mapped.slice(0, 50);
    }
    return [];
  }

  private buildRedfoxReportMarkdown(
    title: string,
    summary: string,
    findings: string[],
    evidence: string[],
  ) {
    const findingLines = findings.length
      ? findings.map((item) => `- ${item}`).join('\n')
      : '- 暂无明确结论';
    const evidenceLines = evidence.length
      ? evidence.map((item) => `- ${item}`).join('\n')
      : '- 暂无外部证据链接';
    return `# ${title}\n\n## 摘要\n${summary}\n\n## 主要发现\n${findingLines}\n\n## 证据\n${evidenceLines}`;
  }

  private jsonObjectField(
    record: Record<string, unknown>,
    key: string,
  ): Record<string, unknown> {
    return this.readUnknownRecord(record[key]) || {};
  }

  private jsonArrayField(
    record: Record<string, unknown>,
    key: string,
  ): unknown[] {
    const value = record[key];
    return Array.isArray(value) ? value : [];
  }

  private readUnknownRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private resolveRedfoxRunMapping(redfoxRun: RedfoxSkillRunResult) {
    const payloadSummary = this.readUnknownRecord(redfoxRun.payloadSummary);
    const mappingSummary = this.readUnknownRecord(payloadSummary?.mapping);
    const mappingCode =
      typeof mappingSummary?.code === 'string' ? mappingSummary.code : null;
    return (
      findRedfoxSkillMapping(mappingCode) ||
      findRedfoxSkillMapping(redfoxRun.skill.code) ||
      findRedfoxSkillMapping(redfoxRun.skill.name) ||
      findRedfoxSkillMappingByPath(redfoxRun.endpoint.path)
    );
  }

  private redfoxMappingSummary(mapping: RedfoxSkillMapping) {
    return {
      code: mapping.code,
      skillCode: mapping.skillCode,
      skillName: mapping.skillName,
      platform: mapping.platform,
      scenario: mapping.scenario,
      path: mapping.path,
      outputObjects: mapping.outputObjects,
      source: mapping.source,
    };
  }

  private objectKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    return Object.keys(value as Record<string, unknown>).slice(0, 20);
  }

  private valueKind(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null || value === undefined) return 'null';
    return typeof value;
  }

  private async assertRunBudgetAvailable(
    run: Pick<PrismaSolutionRun, 'id' | 'maxCostPoints' | 'actualCostPoints'>,
    taskId: string,
    estimatedCostPoints: number,
  ) {
    const requested = Math.max(0, Math.floor(estimatedCostPoints));
    if (requested <= 0) return;

    const reserved = await this.prisma.solutionCostEntry.aggregate({
      where: {
        runId: run.id,
        taskId: { not: taskId },
      },
      _sum: { estimatedCostPoints: true },
    });
    const reservedPoints = Math.max(0, reserved._sum.estimatedCostPoints || 0);
    const usedPoints = reservedPoints + Math.max(0, run.actualCostPoints || 0);
    const remaining = Math.max(0, run.maxCostPoints - usedPoints);
    if (requested > remaining) {
      throw new BadRequestException(
        `预估成本 ${requested} 点超过方案运行剩余额度 ${remaining} 点，请提高预算或减少任务范围`,
      );
    }
  }

  private async markRedfoxTaskFailed(
    runId: string,
    taskId: string,
    startedAt: Date,
    error: unknown,
    reasonCode = 'redfox_dry_run_failed',
    outputJson?: unknown,
  ) {
    const now = new Date();
    const message = this.errorMessage(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.solutionTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          reasonCode,
          errorMessage: message,
          outputJson: outputJson ? this.toJson(outputJson) : undefined,
          endedAt: now,
          durationMs: now.getTime() - startedAt.getTime(),
        },
      });

      const tasks = await tx.solutionTask.findMany({
        where: { runId },
        select: { status: true },
      });
      const readyCount = tasks.filter((item) =>
        SOLUTION_TASK_READY_STATUSES.has(item.status),
      ).length;
      const progress = tasks.length
        ? Math.round((readyCount / tasks.length) * 100)
        : 0;

      await tx.solutionRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          progress,
          errorCode: reasonCode,
          errorMessage: message,
        },
      });
    });
  }

  private async markRedfoxTaskBlocked(
    runId: string,
    taskId: string,
    reasonCode: string,
    message: string,
    outputJson?: unknown,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.solutionTask.update({
        where: { id: taskId },
        data: {
          status: 'approval_required',
          reasonCode,
          errorMessage: message,
          outputJson: outputJson ? this.toJson(outputJson) : undefined,
          endedAt: new Date(),
        },
      });

      await tx.solutionRun.update({
        where: { id: runId },
        data: {
          status: 'approval_required',
          errorCode: reasonCode,
          errorMessage: message,
        },
      });
    });
  }

  private redfoxRunStatusMessage(redfoxRun: RedfoxSkillRunResult) {
    const warning = redfoxRun.warnings.find(Boolean);
    if (warning) return warning;
    return redfoxRun.status === 'blocked'
      ? `${redfoxRun.skill.name} 执行被阻断，请先完成本机 SkillHub 安装、密钥或输入配置。`
      : `${redfoxRun.skill.name} 执行失败，请查看 Agent-S 事件和产物。`;
  }

  private isExecutionGateError(error: unknown) {
    const message = this.errorMessage(error);
    return /不在真实执行白名单|尚未同步或启用|不能真实执行/.test(message);
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'RedFox Skill 试执行失败';
    }
  }

  private hashJson(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
