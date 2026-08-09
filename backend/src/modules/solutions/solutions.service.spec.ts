import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SolutionsService } from './solutions.service';

function makeUser(): AuthenticatedUser {
  return {
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    name: 'Tester',
    status: 'active',
    lastLoginAt: null,
    role: 'admin',
    commercialExecutionAllowed: true,
    planMode: 'commercial',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

function makePrismaMock() {
  const now = new Date('2026-07-01T00:00:00.000Z');
  const runs: any[] = [];
  const tasks: any[] = [];
  const results: any[] = [];
  const costEntries: any[] = [];
  const intelligenceItems: any[] = [];
  const intelligenceMonitors: any[] = [];
  const intelligenceReports: any[] = [];
  const complianceChecks: any[] = [];
  const materials: any[] = [];
  const topics: any[] = [];
  const articles: any[] = [];
  const benchmarkAccounts: any[] = [];
  const commentInsights: any[] = [];
  const growthLeads: any[] = [];
  const growthAccountHealths: any[] = [];
  const crmTasks: any[] = [];
  const crmCustomers: any[] = [];
  const runtimeExecutions: any[] = [];
  const agentConfirmations: any[] = [];
  const solutionArtifacts: any[] = [];
  const prisma = {
    solutionRun: {
      create: jest.fn(async ({ data }: any) => {
        const runId = `run-${runs.length + 1}`;
        const run = {
          id: runId,
          tenantId: data.tenantId ?? null,
          userId: data.userId,
          packageCode: data.packageCode,
          packageName: data.packageName,
          packageVersion: data.packageVersion,
          trigger: data.trigger,
          source: data.source,
          status: data.status,
          progress: data.progress,
          dryRun: data.dryRun,
          riskLevel: data.riskLevel,
          confirmationPolicy: data.confirmationPolicy,
          sendMode: data.sendMode,
          estimatedCostPoints: data.estimatedCostPoints,
          maxCostPoints: data.maxCostPoints,
          actualCostPoints: data.actualCostPoints,
          costStatus: data.costStatus,
          inputJson: data.inputJson,
          resolvedPlanJson: data.resolvedPlanJson,
          summaryJson: data.summaryJson,
          outputRefs: data.outputRefs,
          acceptanceChecks: data.acceptanceChecks,
          tasks: data.tasks.create.map((task: any, index: number) => ({
            ...task,
            id: `task-${index + 1}`,
            runId,
            targetObject: task.targetObject ?? null,
            outputJson: null,
            reasonCode: null,
            errorMessage: null,
            redfoxCallLogId: null,
            runtimeExecutionId: null,
            agentConfirmationId: null,
            createdAt: now,
            updatedAt: now,
          })),
          createdAt: now,
          updatedAt: now,
        };
        runs.push(run);
        tasks.push(...run.tasks);
        return run;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = runs.findIndex((item) => item.id === where.id);
        runs[index] = { ...runs[index], ...data, updatedAt: now };
        return runs[index];
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const run = runs.find((item) => item.id === where.id);
        if (!run) throw new Error('not found');
        return {
          ...run,
          tasks: tasks
            .filter((task) => task.runId === run.id)
            .sort((left, right) => left.order - right.order),
          results: results.filter((result) => result.runId === run.id),
        };
      }),
      findMany: jest.fn(),
      findFirst: jest.fn(async ({ where }: any) => {
        const run = runs.find(
          (item) => item.id === where.id && item.userId === where.userId,
        );
        if (!run) return null;
        return {
          ...run,
          tasks: tasks
            .filter((task) => task.runId === run.id)
            .sort((left, right) => left.order - right.order),
          results: results.filter((result) => result.runId === run.id),
        };
      }),
      count: jest.fn(),
    },
    solutionTask: {
      findFirst: jest.fn(async ({ where }: any) => {
        const task = tasks.find(
          (item) => item.id === where.id && item.runId === where.runId,
        );
        if (!task) return null;
        const run = runs.find((item) => item.id === task.runId);
        if (!run || run.userId !== where.run.userId) return null;
        return { ...task, run };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = tasks.findIndex((item) => item.id === where.id);
        tasks[index] = { ...tasks[index], ...data, updatedAt: now };
        return tasks[index];
      }),
      findMany: jest.fn(async ({ where, select }: any) =>
        tasks
          .filter((item) => item.runId === where.runId)
          .map((item) => (select?.status ? { status: item.status } : item)),
      ),
    },
    solutionResult: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `result-${results.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        results.push(row);
        return row;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const result = results.find(
          (item) =>
            item.id === where.id &&
            item.runId === where.runId &&
            (!where.kind || item.kind === where.kind),
        );
        if (!result) return null;
        const run = runs.find((item) => item.id === result.runId);
        if (where.run?.userId && run?.userId !== where.run.userId) return null;
        return result;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = results.findIndex((item) => item.id === where.id);
        results[index] = {
          ...results[index],
          ...data,
          updatedAt: now,
        };
        return results[index];
      }),
    },
    solutionCostEntry: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `cost-${costEntries.length + 1}`, ...data };
        costEntries.push(row);
        return row;
      }),
      aggregate: jest.fn(async ({ where }: any) => {
        const excludedTaskId = where?.taskId?.not;
        const estimatedCostPoints = costEntries
          .filter(
            (item) =>
              item.runId === where.runId &&
              (!excludedTaskId || item.taskId !== excludedTaskId),
          )
          .reduce(
            (sum, item) => sum + Number(item.estimatedCostPoints || 0),
            0,
          );
        return { _sum: { estimatedCostPoints } };
      }),
    },
    solutionArtifact: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `artifact-${solutionArtifacts.length + 1}`,
          ...data,
          createdAt: now,
        };
        solutionArtifacts.push(row);
        return row;
      }),
    },
    intelligenceItem: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          intelligenceItems.find((item) =>
            where.tenantId
              ? item.tenantId === where.tenantId &&
                item.dedupeKey === where.dedupeKey
              : item.userId === where.userId &&
                item.dedupeKey === where.dedupeKey,
          ) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `intelligence-${intelligenceItems.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        intelligenceItems.push(row);
        return row;
      }),
    },
    intelligenceReport: {
      findFirst: jest.fn(async ({ where }: any) =>
        intelligenceReports.find(
          (item) =>
            item.userId === where.userId &&
            item.kind === where.kind &&
            item.title === where.title &&
            item.status !== 'archived',
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `intelligence-report-${intelligenceReports.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        intelligenceReports.push(row);
        return row;
      }),
    },
    intelligenceMonitor: {
      findFirst: jest.fn(async ({ where }: any) =>
        intelligenceMonitors.find(
          (item) =>
            item.userId === where.userId &&
            item.type === where.type &&
            item.platform === where.platform &&
            item.keyword === where.keyword &&
            item.accountExternalId === where.accountExternalId &&
            item.industry === where.industry &&
            item.status !== 'archived',
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `intelligence-monitor-${intelligenceMonitors.length + 1}`,
          ...data,
          lastRunAt: null,
          nextRunAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        };
        intelligenceMonitors.push(row);
        return row;
      }),
    },
    crmTask: {
      findFirst: jest.fn(async ({ where }: any) =>
        crmTasks.find(
          (item) =>
            item.ownerId === where.ownerId &&
            item.title === where.title &&
            item.archivedAt === where.archivedAt,
        ),
      ),
    },
    crmCustomer: {
      findFirst: jest.fn(async ({ where }: any) =>
        crmCustomers.find(
          (item) =>
            item.ownerId === where.ownerId &&
            item.dedupeKey === where.dedupeKey &&
            item.archivedAt === where.archivedAt,
        ),
      ),
    },
    complianceCheck: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `compliance-${complianceChecks.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        complianceChecks.push(row);
        return row;
      }),
    },
    commentInsight: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `comment-insight-${commentInsights.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        commentInsights.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = commentInsights.findIndex((item) => item.id === where.id);
        commentInsights[index] = {
          ...commentInsights[index],
          ...data,
          updatedAt: now,
        };
        return commentInsights[index];
      }),
    },
    growthLead: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          growthLeads.find((item) => item.id === where.id) || null,
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const index = growthLeads.findIndex((item) => item.id === where.id);
        if (index >= 0) {
          growthLeads[index] = {
            ...growthLeads[index],
            ...update,
            updatedAt: now,
          };
          return growthLeads[index];
        }
        const row = {
          ...create,
          createdAt: now,
          updatedAt: now,
        };
        growthLeads.push(row);
        return row;
      }),
    },
    growthAccountHealth: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const index = growthAccountHealths.findIndex(
          (item) => item.id === where.id,
        );
        if (index >= 0) {
          growthAccountHealths[index] = {
            ...growthAccountHealths[index],
            ...update,
          };
          return growthAccountHealths[index];
        }
        const row = {
          ...create,
        };
        growthAccountHealths.push(row);
        return row;
      }),
    },
    material: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          materials.find((item) => item.sourceUrl === where.sourceUrl) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `material-${materials.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        materials.push(row);
        return row;
      }),
    },
    topic: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `topic-${topics.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        topics.push(row);
        return row;
      }),
    },
    article: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `article-${articles.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        articles.push(row);
        return row;
      }),
    },
    benchmarkAccount: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          benchmarkAccounts.find((item) =>
            where.tenantId
              ? item.tenantId === where.tenantId &&
                item.platform === where.platform &&
                item.externalUserId === where.externalUserId
              : item.userId === where.userId &&
                item.platform === where.platform &&
                item.externalUserId === where.externalUserId,
          ) || null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `benchmark-account-${benchmarkAccounts.length + 1}`,
          ...data,
          createdAt: now,
          updatedAt: now,
        };
        benchmarkAccounts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = benchmarkAccounts.findIndex(
          (item) => item.id === where.id,
        );
        benchmarkAccounts[index] = {
          ...benchmarkAccounts[index],
          ...data,
          updatedAt: now,
        };
        return benchmarkAccounts[index];
      }),
    },
    runtimeExecution: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `runtime-execution-${runtimeExecutions.length + 1}`,
          ...data,
          createdAt: now,
        };
        runtimeExecutions.push(row);
        return row;
      }),
    },
    agentConfirmation: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `agent-confirmation-${agentConfirmations.length + 1}`,
          ...data,
          createdAt: now,
          decidedAt: null,
        };
        agentConfirmations.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
    $queryRaw: jest.fn(async () => []),
  };
  return prisma;
}

describe('SolutionsService', () => {
  let service: SolutionsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let redfoxSkillRunner: { runSkill: jest.Mock };
  let crmService: {
    createTask: jest.Mock;
    createCustomer: jest.Mock;
  };
  let contentOptimizationService: {
    saveVersion: jest.Mock;
    setOfficialVersion: jest.Mock;
    createPublishIntent: jest.Mock;
  };
  let complianceService: { check: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    redfoxSkillRunner = {
      runSkill: jest.fn(async (_actor: unknown, dto: any) => ({
        id: dto.dryRun === false ? 'execute-1' : 'dry-run-1',
        dryRun: dto.dryRun !== false,
        status: dto.dryRun === false ? 'success' : 'dry_run_ready',
        skill: {
          code: dto.skillCode || 'redfox-hot-topic',
          name: dto.skillName || '全网热搜/聚合热点',
          platform: null,
          enabled: dto.dryRun === false,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: dto.dryRun === false ? '/story/api/dyData/searchArticle' : null,
          operation:
            dto.operation ||
            `solutions.hot-topic-solution.1-关键词平台配置.${
              dto.dryRun === false ? 'redfox_execute' : 'redfox_dry_run'
            }`,
        },
        estimatedCostPoints: dto.estimatedCostPoints ?? 1,
        requestPreview: {
          query: dto.query || null,
          body: dto.body || null,
          input: dto.input || null,
        },
        warnings:
          dto.dryRun === false
            ? []
            : ['dry-run 只生成 RedFox Skill 试执行计划，不会调用 RedFox。'],
        solutionRunId: dto.solutionRunId || 'run-1',
        solutionTaskId: dto.solutionTaskId || 'task-1',
        callLogId: dto.dryRun === false ? 'log-1' : null,
        payloadSummary:
          dto.dryRun === false
            ? { kind: 'object', keys: ['code', 'data'] }
            : { kind: 'dry_run_plan' },
        createdAt: '2026-07-01T00:00:00.000Z',
      })),
    };
    crmService = {
      createTask: jest.fn(async () => ({ id: 'crm-task-1' })),
      createCustomer: jest.fn(async () => ({ id: 'crm-customer-1' })),
    };
    contentOptimizationService = {
      saveVersion: jest.fn(async () => ({ id: 'content-version-1' })),
      setOfficialVersion: jest.fn(async () => ({ id: 'content-version-1' })),
      createPublishIntent: jest.fn(async () => ({ id: 'publish-intent-1' })),
    };
    complianceService = {
      check: jest.fn(async () => ({
        checkId: 'solution-compliance-1',
        riskLevel: 'pass',
      })),
    };
    service = new SolutionsService(
      prisma as any,
      redfoxSkillRunner as any,
      crmService as any,
      contentOptimizationService as any,
      complianceService as any,
    );
  });

  it('returns the frozen RedFox solution catalog summary', () => {
    const result = service.list();

    expect(result.items).toHaveLength(15);
    expect(result.summary).toEqual(
      expect.objectContaining({
        total: 15,
        core: 5,
        redfoxPool: 10,
        connected: 2,
        partial: 12,
        planned: 1,
        redfoxSkillCount: 57,
        estimatedWorkdays: 108,
      }),
    );
    expect(result.summary.ownerGroups).toEqual(
      expect.arrayContaining([
        '产品方案组',
        'RedFox 接入组',
        '前端体验与 QA 组',
      ]),
    );
    expect(result.items[0].productization).toEqual(
      expect.objectContaining({
        deliverables: expect.arrayContaining(['情报条目', '素材', '选题']),
        configurationFields: expect.arrayContaining([
          expect.objectContaining({
            key: 'businessObjective',
            required: true,
          }),
          expect.objectContaining({
            key: 'keywords',
            type: 'tags',
          }),
        ]),
        templates: expect.arrayContaining([
          expect.objectContaining({ industry: '本地生活' }),
        ]),
        roiMetrics: expect.arrayContaining([
          expect.objectContaining({ key: 'opportunity_count' }),
        ]),
      }),
    );
  });

  it('reports RedFox mapping coverage for solution package skill refs', () => {
    const result = service.getRedfoxMappingCoverage();

    expect(result.totalPackageSkillRefs).toBeGreaterThan(0);
    expect(result.mappingCatalogSize).toBeGreaterThan(0);
    expect(
      result.mappedPackageSkillRefs + result.unmappedPackageSkillRefs,
    ).toBe(result.totalPackageSkillRefs);
    expect(
      result.verifiedApiPathRefs +
        result.verifiedSkillHubRefs +
        result.contractOnlyRefs +
        result.unmappedPackageSkillRefs,
    ).toBe(result.totalPackageSkillRefs);
    expect(result.verifiedApiPathRefs).toBeGreaterThan(0);
    expect(result.verifiedSkillHubRefs).toBeGreaterThan(0);
    expect(result.contractOnlyRefs).toBe(0);
    expect(result.unmappedPackageSkillRefs).toBe(0);
    expect(result.unmappedSkills).toEqual([]);
    expect(result.contractOnlySkills).toEqual([]);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillName: '抖音账号搜索/热门/相似/诊断',
          mapped: true,
          executionReady: true,
          executionStatus: 'verified_api_path',
          mappingCode: 'douyin-search-user',
          path: '/story/api/dyData/searchUser',
          outputObjects: expect.arrayContaining([
            'BenchmarkAccount',
            'GrowthLead',
            'RedfoxCallLog',
          ]),
        }),
        expect.objectContaining({
          skillName: '全网热搜/聚合热点',
          mapped: true,
          integrationReady: true,
          executionReady: false,
          executionStatus: 'verified_skillhub',
          mappingCode: 'contract-web-hot-search',
          path: null,
          skillHubRefs: expect.arrayContaining([
            expect.objectContaining({
              skillNo: 'KJq7uXHY',
              skillCode: 'trending-hub',
            }),
            expect.objectContaining({
              skillNo: 'npSuapcy',
              skillCode: 'trending-hub-top10',
            }),
          ]),
          outputObjects: expect.arrayContaining(['IntelligenceItem', 'Topic']),
        }),
        expect.objectContaining({
          skillName: '多平台违禁词检测',
          mapped: true,
          integrationReady: true,
          executionReady: false,
          executionStatus: 'verified_skillhub',
          mappingCode: 'contract-compliance-check',
          path: null,
          skillHubRefs: expect.arrayContaining([
            expect.objectContaining({
              skillNo: 'wn2Hrw42',
              skillCode: 'multi-wordcheck',
            }),
          ]),
        }),
        expect.objectContaining({
          skillName: 'TikTok 账号搜索',
          mapped: true,
          executionReady: true,
          executionStatus: 'verified_api_path',
          mappingCode: 'tiktok-search-user',
          path: '/story/api/deepSearch/tk/searchUser',
        }),
        expect.objectContaining({
          skillName: '公众号账号诊断',
          mapped: true,
          executionReady: true,
          executionStatus: 'verified_api_path',
          mappingCode: 'gzh-query-user',
          path: '/story/api/gzhData/queryUser',
        }),
        expect.objectContaining({
          skillName: '短视频下载',
          mapped: true,
          executionReady: true,
          executionStatus: 'verified_api_path',
          mappingCode: 'media-parse-work',
          path: '/story/api/parseWork/parse',
        }),
        expect.objectContaining({
          skillName: 'seedream',
          mapped: true,
          executionReady: true,
          executionStatus: 'verified_api_path',
          mappingCode: 'seedream-image-submit',
          path: '/story/api/parseWork/imageGen/arkSubmit',
        }),
      ]),
    );
  });

  it('filters core and RedFox pool packages separately', () => {
    const core = service.list('core');
    const redfoxPool = service.list('redfox_pool');

    expect(core.items).toHaveLength(5);
    expect(core.items.every((item) => item.category === 'core')).toBe(true);
    expect(redfoxPool.items).toHaveLength(10);
    expect(
      redfoxPool.items.every((item) => item.category === 'redfox_pool'),
    ).toBe(true);
  });

  it('creates a run plan without executing external calls', () => {
    const plan = service.createRunPlan('hot-topic-solution');

    expect(plan).toEqual(
      expect.objectContaining({
        packageCode: 'hot-topic-solution',
        packageName: '热点选题解决方案',
        status: 'ready_for_mapping',
      }),
    );
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0]).toEqual(
      expect.objectContaining({
        order: 1,
        name: '关键词平台配置',
        redfoxSkills: expect.arrayContaining(['全网热搜/聚合热点']),
      }),
    );
    expect(plan.warnings.join(' ')).toContain('不会直接调用 RedFox');
  });

  it('persists a dry-run ledger with queued and approval-required tasks', async () => {
    const run = await service.createRun(makeUser(), 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });

    expect(prisma.solutionRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          packageCode: 'hot-topic-solution',
          dryRun: true,
          maxCostPoints: 20,
          inputJson: expect.objectContaining({ keyword: '咖啡' }),
          summaryJson: expect.objectContaining({
            configuredInput: expect.objectContaining({ keyword: '咖啡' }),
            deliverables: expect.arrayContaining(['情报条目', '素材', '选题']),
            roiMetrics: expect.arrayContaining([
              expect.objectContaining({ key: 'opportunity_count' }),
            ]),
          }),
          outputRefs: expect.arrayContaining([
            expect.objectContaining({
              label: '情报条目',
              status: 'planned',
            }),
          ]),
          tasks: expect.objectContaining({
            create: expect.arrayContaining([
              expect.objectContaining({
                order: 1,
                name: '关键词平台配置',
                executorKind: 'redfox',
                status: 'queued',
              }),
            ]),
          }),
        }),
        include: { tasks: { orderBy: { order: 'asc' } } },
      }),
    );
    expect(run).toEqual(
      expect.objectContaining({
        id: 'run-1',
        packageCode: 'hot-topic-solution',
        dryRun: true,
        status: 'queued',
        maxCostPoints: 20,
      }),
    );
    expect(run.tasks).toHaveLength(6);
    expect(run.tasks[0]).toEqual(
      expect.objectContaining({
        name: '关键词平台配置',
        executorKind: 'redfox',
        status: 'queued',
      }),
    );
    expect(run.tasks[1]).toEqual(
      expect.objectContaining({
        executorKind: 'manual',
        status: 'approval_required',
      }),
    );
  });

  it.each([
    ['monitor', '创建监控任务', '监控中心', 'IntelligenceMonitor'],
    ['crm_task', '创建跟进任务', '待办', 'CrmTask'],
    ['intelligence_report', '生成日报', '报告中心', 'IntelligenceReport'],
    ['crm_lead', '创建 CRM 线索', 'CRM', 'CrmCustomer'],
    ['publish_preparation', '加入发布排期', '发布中心', 'PublishRecord'],
  ] as const)(
    'creates a business result action ledger for %s',
    async (kind, label, targetModule, objectType) => {
      const run = await service.createRun(makeUser(), 'hot-topic-solution', {
        input: { businessObjective: '测试选题', keyword: '咖啡' },
      });

      const result = await service.executeResultAction(makeUser(), run.id, {
        kind,
        label,
        targetModule,
        description: '把方案结果落到业务模块',
      });

      expect(result).toEqual(
        expect.objectContaining({
          kind,
          status: 'created',
          objectType,
          refId: expect.any(String),
          result: expect.objectContaining({
            kind: 'business_result_action',
            status: 'created',
          }),
        }),
      );
    },
  );

  it.each([
    {
      kind: 'monitor' as const,
      label: '创建监控任务',
      targetModule: '监控中心',
      createdOnce: () =>
        expect(prisma.intelligenceMonitor.create).toHaveBeenCalledTimes(1),
    },
    {
      kind: 'crm_task' as const,
      label: '创建跟进任务',
      targetModule: '待办',
      createdOnce: () => expect(crmService.createTask).toHaveBeenCalledTimes(1),
    },
    {
      kind: 'intelligence_report' as const,
      label: '生成日报',
      targetModule: '报告中心',
      createdOnce: () =>
        expect(prisma.intelligenceReport.create).toHaveBeenCalledTimes(1),
    },
    {
      kind: 'crm_lead' as const,
      label: '创建 CRM 线索',
      targetModule: 'CRM',
      createdOnce: () =>
        expect(crmService.createCustomer).toHaveBeenCalledTimes(1),
    },
    {
      kind: 'publish_preparation' as const,
      label: '加入发布排期',
      targetModule: '发布中心',
      createdOnce: () => {
        expect(contentOptimizationService.saveVersion).toHaveBeenCalledTimes(1);
        expect(
          contentOptimizationService.createPublishIntent,
        ).toHaveBeenCalledTimes(1);
        expect(complianceService.check).toHaveBeenCalledWith(
          expect.objectContaining({
            targetId: 'content-version-1',
            targetType: 'article',
            scenario: 'solution_publish_preparation',
          }),
        );
      },
    },
  ])(
    'reuses an existing business result action instead of duplicating writes for $kind',
    async ({ kind, label, targetModule, createdOnce }) => {
      const run = await service.createRun(makeUser(), 'hot-topic-solution', {
        input: { businessObjective: '测试选题', keyword: '咖啡' },
      });

      const first = await service.executeResultAction(makeUser(), run.id, {
        kind,
        label,
        targetModule,
        description: '把方案结果落到业务模块',
      });
      const second = await service.executeResultAction(makeUser(), run.id, {
        kind,
        label,
        targetModule,
        description: '把方案结果落到业务模块',
      });

      expect(first.status).toBe('created');
      expect(second.status).toBe('reused');
      expect(second.refId).toBe(first.refId);
      expect(second.objectType).toBe(first.objectType);
      expect(second.href).toContain(encodeURIComponent(first.refId));
      createdOnce();
      expect(prisma.solutionResult.create).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks a business result action ledger when the target object has no id', async () => {
    crmService.createCustomer.mockResolvedValueOnce({ id: '' });
    const run = await service.createRun(makeUser(), 'hot-topic-solution', {
      input: { businessObjective: '测试选题', keyword: '咖啡' },
    });

    await expect(
      service.executeResultAction(makeUser(), run.id, {
        kind: 'crm_lead',
        label: '创建 CRM 线索',
        targetModule: 'CRM',
        description: '把方案结果落到业务模块',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.solutionResult.create).not.toHaveBeenCalled();
  });

  it('writes a RedFox dry-run result back to the solution task ledger', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });

    const result = await service.dryRunRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      { input: { keyword: '咖啡' } },
    );

    expect(redfoxSkillRunner.runSkill).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        dryRun: true,
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        skillName: '全网热搜/聚合热点',
      }),
    );
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: run.id,
          taskId: run.tasks[0].id,
          kind: 'redfox_dry_run',
        }),
      }),
    );
    expect(prisma.solutionCostEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: 'estimated',
          capturedCostPoints: 0,
        }),
      }),
    );
    expect(result.task).toEqual(
      expect.objectContaining({
        id: run.tasks[0].id,
        status: 'dry_run_ready',
      }),
    );
    expect(result.redfoxRun.callLogId).toBeNull();
    expect(result.run).toEqual(
      expect.objectContaining({
        status: 'dry_run_ready',
        progress: 100,
        costStatus: 'budget_reserved',
      }),
    );
  });

  it('approves a manual solution checkpoint and persists audit result', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    const manualTask = run.tasks[1];

    const result = await service.approveManualTask(
      actor,
      run.id,
      manualTask.id,
      {
        approvalNote: '情报入库检查已确认',
        businessResult: { importedItems: 3 },
      },
    );

    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: run.id,
          taskId: manualTask.id,
          kind: 'manual_checkpoint_approval',
          status: 'approved',
          approvedBy: actor.id,
        }),
      }),
    );
    expect(prisma.solutionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: manualTask.id },
        data: expect.objectContaining({
          status: 'succeeded',
          reasonCode: null,
          errorMessage: null,
        }),
      }),
    );
    expect(result.task).toEqual(
      expect.objectContaining({
        id: manualTask.id,
        status: 'succeeded',
      }),
    );
    expect(result.result).toEqual(
      expect.objectContaining({
        kind: 'manual_checkpoint_approval',
        status: 'approved',
      }),
    );
    expect(result.run).toEqual(
      expect.objectContaining({
        status: 'approval_required',
        progress: 83,
      }),
    );
  });

  it('blocks a RedFox dry-run when the run budget is exhausted', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 0,
    });

    await expect(
      service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(redfoxSkillRunner.runSkill).not.toHaveBeenCalled();
  });

  it('marks the solution task failed when RedFox dry-run planning fails', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    redfoxSkillRunner.runSkill.mockRejectedValueOnce(
      new BadRequestException('mapping invalid'),
    );

    await expect(
      service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { keyword: '咖啡' },
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.solutionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.tasks[0].id },
        data: expect.objectContaining({
          status: 'failed',
          reasonCode: 'redfox_dry_run_failed',
        }),
      }),
    );
    expect(prisma.solutionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.id },
        data: expect.objectContaining({
          status: 'failed',
          errorCode: 'redfox_dry_run_failed',
        }),
      }),
    );
  });

  it('executes a RedFox task directly without a confirmation phrase', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        input: { keyword: '咖啡' },
      },
    );

    expect(result.redfoxRun.status).toBe('success');
    expect(redfoxSkillRunner.runSkill).toHaveBeenCalledWith(
      actor,
      expect.not.objectContaining({
        confirmRealExecution: expect.any(String),
      }),
    );
  });

  it('executes a RedFox task and captures the cost ledger', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'douyin-search-article',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
        approvalNote: '低成本沙箱验证',
      },
    );

    expect(redfoxSkillRunner.runSkill).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        dryRun: false,
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
      }),
    );
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_execution_approval',
          status: 'approved',
          approvedBy: actor.id,
          acceptedAt: expect.any(Date),
          payloadSummary: expect.objectContaining({
            approvalNote: '低成本沙箱验证',
            estimatedCostPoints: 1,
            skillName: 'douyin-search-article',
          }),
        }),
      }),
    );
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_execution',
          status: 'created',
        }),
      }),
    );
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'planned',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'planned',
            }),
            expect.objectContaining({
              objectType: 'Material',
              status: 'planned',
            }),
            expect.objectContaining({
              objectType: 'RedfoxCallLog',
              status: 'linked',
              refId: 'log-1',
            }),
          ]),
          payloadSummary: expect.objectContaining({
            mapping: expect.objectContaining({
              code: 'douyin-search-article',
              path: '/story/api/dyData/searchArticle',
            }),
            callLogId: 'log-1',
          }),
        }),
      }),
    );
    expect(prisma.solutionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.tasks[0].id },
        data: expect.objectContaining({
          status: 'running',
          agentConfirmationId: 'result-2',
        }),
      }),
    );
    expect(prisma.solutionCostEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: 'captured',
          authorizedCostPoints: 1,
          capturedCostPoints: 1,
          redfoxCallLogId: 'log-1',
        }),
      }),
    );
    expect(result.task).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        redfoxCallLogId: 'log-1',
      }),
    );
    expect(result.run).toEqual(
      expect.objectContaining({
        status: 'approval_required',
        actualCostPoints: 1,
        costStatus: 'captured',
      }),
    );
  });

  it('persists Douyin hot article API output into intelligence and material records', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'douyin-api-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'douyin-search-article',
        name: '抖音作品搜索',
        platform: 'douyin',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: '/story/api/dyData/searchArticle',
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: { keyword: '咖啡' },
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: 'log-douyin-hot-1',
      payloadSummary: { kind: 'object', keys: ['code', 'data'] },
      payloadSample: {
        code: 0,
        data: {
          list: [
            {
              title: '咖啡店爆款短视频',
              platform: 'douyin',
              hotScore: 96,
              shareUrl: 'https://v.douyin.com/hot-coffee',
              keywords: ['咖啡', '门店'],
              description: '低成本咖啡门店改造内容正在抖音升温。',
              nickname: '咖啡老板',
              likeCount: 18000,
              commentCount: 320,
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'douyin-search-article',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'created',
              refId: 'intelligence-1',
              source: 'intelligence_items',
            }),
            expect.objectContaining({
              objectType: 'Material',
              status: 'created',
              refId: 'material-1',
              source: 'materials',
            }),
            expect.objectContaining({
              objectType: 'RedfoxCallLog',
              status: 'linked',
              refId: 'log-douyin-hot-1',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 2,
            intelligenceItems: 1,
            materials: 1,
            persistedObjects: 2,
            skippedPersistenceObjects: 0,
            hasCallLog: true,
          }),
          payloadSummary: expect.objectContaining({
            mapping: expect.objectContaining({
              code: 'douyin-search-article',
              path: '/story/api/dyData/searchArticle',
            }),
            persistence: expect.objectContaining({
              supportedObjectTypes: expect.arrayContaining([
                'IntelligenceItem',
                'IntelligenceReport',
                'BenchmarkAccount',
                'Material',
                'Topic',
                'ComplianceCheck',
                'CommentInsight',
                'GrowthLead',
              ]),
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      }),
    );
    expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          redfoxCallLogId: 'log-douyin-hot-1',
          platform: 'douyin',
          type: 'content_search',
          title: '咖啡店爆款短视频',
          content: '低成本咖啡门店改造内容正在抖音升温。',
          sourceUrl: 'https://v.douyin.com/hot-coffee',
          author: '咖啡老板',
          keywords: ['咖啡', '门店'],
          status: 'new',
          dedupeKey: expect.any(String),
        }),
      }),
    );
    expect(prisma.material.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceUrl: 'https://v.douyin.com/hot-coffee' },
        select: { id: true },
      }),
    );
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '咖啡店爆款短视频',
          content: '低成本咖啡门店改造内容正在抖音升温。',
          sourceUrl: 'https://v.douyin.com/hot-coffee',
          platform: 'douyin',
          author: '咖啡老板',
          keywords: ['咖啡', '门店'],
          metadata: expect.objectContaining({
            redfoxAutoPersistence: expect.objectContaining({
              solutionRunId: run.id,
              solutionTaskId: run.tasks[0].id,
              redfoxCallLogId: 'log-douyin-hot-1',
            }),
          }),
        }),
      }),
    );
  });

  it('persists Xiaohongshu hot article API output into intelligence, material, and topic records', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'xhs-api-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'xiaohongshu-search-article',
        name: '小红书作品搜索',
        platform: 'xiaohongshu',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: '/story/api/xhsUser/searchArticle',
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: { keyword: '咖啡' },
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: 'log-xhs-hot-1',
      payloadSummary: { kind: 'object', keys: ['code', 'data'] },
      payloadSample: {
        code: 0,
        data: {
          list: [
            {
              title: '小红书咖啡店打卡爆款',
              platform: 'xiaohongshu',
              hotScore: 88,
              sourceUrl: 'https://www.xiaohongshu.com/explore/hot-coffee',
              keywords: ['咖啡', '打卡', '门店'],
              description: '高颜值咖啡店打卡笔记持续升温。',
              nickname: '咖啡探店员',
              likeCount: 9200,
              commentCount: 168,
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'xiaohongshu-search-article',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'created',
              refId: 'intelligence-1',
              source: 'intelligence_items',
            }),
            expect.objectContaining({
              objectType: 'Material',
              status: 'created',
              refId: 'material-1',
              source: 'materials',
            }),
            expect.objectContaining({
              objectType: 'Topic',
              status: 'created',
              refId: 'topic-1',
              source: 'topics',
            }),
            expect.objectContaining({
              objectType: 'RedfoxCallLog',
              status: 'linked',
              refId: 'log-xhs-hot-1',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 3,
            intelligenceItems: 1,
            materials: 1,
            topics: 1,
            persistedObjects: 3,
            skippedPersistenceObjects: 0,
            hasCallLog: true,
          }),
          payloadSummary: expect.objectContaining({
            mapping: expect.objectContaining({
              code: 'xiaohongshu-search-article',
              path: '/story/api/xhsUser/searchArticle',
            }),
            persistence: expect.objectContaining({
              supportedObjectTypes: expect.arrayContaining([
                'IntelligenceItem',
                'IntelligenceReport',
                'BenchmarkAccount',
                'Material',
                'Topic',
                'ComplianceCheck',
                'CommentInsight',
                'GrowthLead',
              ]),
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      }),
    );
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '小红书咖啡店打卡爆款',
          sourceUrl: 'https://www.xiaohongshu.com/explore/hot-coffee',
          platform: 'xiaohongshu',
          author: '咖啡探店员',
          keywords: ['咖啡', '打卡', '门店'],
          metadata: expect.objectContaining({
            redfoxAutoPersistence: expect.objectContaining({
              solutionRunId: run.id,
              solutionTaskId: run.tasks[0].id,
              redfoxCallLogId: 'log-xhs-hot-1',
            }),
          }),
        }),
      }),
    );
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '小红书咖啡店打卡爆款',
          description: '高颜值咖啡店打卡笔记持续升温。',
          sourceType: 'redfox_api',
          keywords: ['咖啡', '打卡', '门店'],
          searchQueries: ['咖啡', '打卡', '门店'],
          aiScore: 88,
          scoreDetails: expect.objectContaining({
            hotScore: 88,
          }),
          status: 'pending',
          materials: {
            create: [
              {
                material: { connect: { id: 'material-1' } },
              },
            ],
          },
        }),
      }),
    );
  });

  it('persists WeChat official account 100k article API output into intelligence and material records', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'gzh-api-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'gzh-search-article',
        name: '公众号文章搜索',
        platform: 'gzh',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: '/story/api/gzhData/searchArticle',
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: { keyword: '咖啡' },
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: 'log-gzh-hot-1',
      payloadSummary: { kind: 'object', keys: ['code', 'data'] },
      payloadSample: {
        code: 0,
        data: {
          list: [
            {
              title: '咖啡品牌私域增长 10w+ 案例',
              platform: 'gzh',
              articleUrl: 'https://mp.weixin.qq.com/s/hot-coffee',
              keywords: ['咖啡', '私域', '增长'],
              digest: '一篇拆解咖啡品牌私域增长路径的公众号 10w+ 文章。',
              accountName: '咖啡增长研究所',
              readCount: 100000,
              likeCount: 5600,
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'gzh-search-article',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'created',
              refId: 'intelligence-1',
              source: 'intelligence_items',
            }),
            expect.objectContaining({
              objectType: 'Material',
              status: 'created',
              refId: 'material-1',
              source: 'materials',
            }),
            expect.objectContaining({
              objectType: 'RedfoxCallLog',
              status: 'linked',
              refId: 'log-gzh-hot-1',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 2,
            intelligenceItems: 1,
            materials: 1,
            persistedObjects: 2,
            skippedPersistenceObjects: 0,
            hasCallLog: true,
          }),
          payloadSummary: expect.objectContaining({
            mapping: expect.objectContaining({
              code: 'gzh-search-article',
              path: '/story/api/gzhData/searchArticle',
            }),
          }),
        }),
      }),
    );
    expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          redfoxCallLogId: 'log-gzh-hot-1',
          platform: 'gzh',
          type: 'content_search',
          title: '咖啡品牌私域增长 10w+ 案例',
          content: '一篇拆解咖啡品牌私域增长路径的公众号 10w+ 文章。',
          summary: '一篇拆解咖啡品牌私域增长路径的公众号 10w+ 文章。',
          sourceUrl: 'https://mp.weixin.qq.com/s/hot-coffee',
          author: '咖啡增长研究所',
          metrics: expect.objectContaining({
            readCount: 100000,
            likeCount: 5600,
          }),
          keywords: ['咖啡', '私域', '增长'],
          status: 'new',
          dedupeKey: expect.any(String),
        }),
      }),
    );
    expect(prisma.material.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceUrl: 'https://mp.weixin.qq.com/s/hot-coffee' },
        select: { id: true },
      }),
    );
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '咖啡品牌私域增长 10w+ 案例',
          content: '一篇拆解咖啡品牌私域增长路径的公众号 10w+ 文章。',
          summary: '一篇拆解咖啡品牌私域增长路径的公众号 10w+ 文章。',
          sourceUrl: 'https://mp.weixin.qq.com/s/hot-coffee',
          platform: 'gzh',
          author: '咖啡增长研究所',
          keywords: ['咖啡', '私域', '增长'],
          metadata: expect.objectContaining({
            redfoxAutoPersistence: expect.objectContaining({
              solutionRunId: run.id,
              solutionTaskId: run.tasks[0].id,
              redfoxCallLogId: 'log-gzh-hot-1',
            }),
          }),
        }),
      }),
    );
    expect(prisma.topic.create).not.toHaveBeenCalled();
  });

  it('persists AI source API output into intelligence items and intelligence reports', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'deepsearch-api-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'deepsearch-doubao-submit',
        name: '豆包 WebSearch 提交',
        platform: 'web',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: '/story/api/deepSearch/dbSubmit',
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: { keyword: '咖啡' },
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: 'log-deepsearch-1',
      payloadSummary: { kind: 'object', keys: ['code', 'data'] },
      payloadSample: {
        code: 0,
        data: {
          title: '咖啡 AI 信息源日报',
          summary: 'AI 搜索发现咖啡门店智能化和私域增长正在升温。',
          findings: ['咖啡门店智能化讨论增加', '私域增长案例在内容平台扩散'],
          evidence: ['https://example.com/coffee-ai-report'],
          completeness: 86,
          keywords: ['咖啡', 'AI', '私域'],
          items: [
            {
              title: '咖啡门店 AI 点单趋势',
              platform: 'web',
              sourceUrl: 'https://example.com/coffee-ai-order',
              keywords: ['咖啡', 'AI'],
              summary: 'AI 点单和门店自动化成为咖啡行业讨论热点。',
              sourceName: 'AI 商业观察',
              score: 90,
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'deepsearch-doubao-submit',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'created',
              refId: 'intelligence-1',
              source: 'intelligence_items',
            }),
            expect.objectContaining({
              objectType: 'IntelligenceReport',
              status: 'created',
              refId: 'intelligence-report-1',
              source: 'intelligence_reports',
            }),
            expect.objectContaining({
              objectType: 'RedfoxCallLog',
              status: 'linked',
              refId: 'log-deepsearch-1',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 2,
            intelligenceItems: 1,
            intelligenceReports: 1,
            persistedObjects: 2,
            skippedPersistenceObjects: 0,
            hasCallLog: true,
          }),
          payloadSummary: expect.objectContaining({
            mapping: expect.objectContaining({
              code: 'deepsearch-doubao-submit',
              path: '/story/api/deepSearch/dbSubmit',
            }),
            persistence: expect.objectContaining({
              supportedObjectTypes: expect.arrayContaining([
                'IntelligenceItem',
                'IntelligenceReport',
                'BenchmarkAccount',
                'Material',
                'Topic',
                'ComplianceCheck',
                'CommentInsight',
                'GrowthLead',
              ]),
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      }),
    );
    expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          redfoxCallLogId: 'log-deepsearch-1',
          platform: 'web',
          type: 'web_search_submit',
          title: '咖啡门店 AI 点单趋势',
          summary: 'AI 点单和门店自动化成为咖啡行业讨论热点。',
          sourceUrl: 'https://example.com/coffee-ai-order',
          author: 'AI 商业观察',
          keywords: ['咖啡', 'AI'],
          status: 'new',
          dedupeKey: expect.any(String),
        }),
      }),
    );
    expect(prisma.intelligenceReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          kind: 'web_search_submit',
          title: '咖啡 AI 信息源日报',
          status: 'draft',
          completeness: 86,
          findings: ['咖啡门店智能化讨论增加', '私域增长案例在内容平台扩散'],
          evidence: ['https://example.com/coffee-ai-report'],
          markdown: expect.stringContaining('咖啡 AI 信息源日报'),
          metadata: expect.objectContaining({
            redfoxAutoPersistence: expect.objectContaining({
              solutionRunId: run.id,
              solutionTaskId: run.tasks[0].id,
              redfoxCallLogId: 'log-deepsearch-1',
            }),
          }),
        }),
      }),
    );
  });

  it.each([
    {
      caseNo: 'P02-01',
      skillCode: 'douyin-search-user',
      skillName: '抖音账号搜索',
      platform: 'douyin',
      path: '/story/api/dyData/searchUser',
      accountId: 'douyin-user-1',
    },
    {
      caseNo: 'P02-02',
      skillCode: 'xiaohongshu-search-user',
      skillName: '小红书账号搜索',
      platform: 'xiaohongshu',
      path: '/story/api/xhsUser/searchUser',
      accountId: 'xhs-user-1',
    },
    {
      caseNo: 'P02-03',
      skillCode: 'gzh-search-user',
      skillName: '公众号账号搜索',
      platform: 'gzh',
      path: '/story/api/gzhData/searchUser',
      accountId: 'gzh-user-1',
    },
    {
      caseNo: 'P02-04',
      skillCode: 'bilibili-account-detail',
      skillName: 'B 站账号详情',
      platform: 'bilibili',
      path: '/story/api/bili/data/accountDetail',
      accountId: 'bili-user-1',
    },
    {
      caseNo: 'P02-05',
      skillCode: 'tiktok-search-user',
      skillName: 'TikTok 账号搜索',
      platform: 'tiktok',
      path: '/story/api/deepSearch/tk/searchUser',
      accountId: 'tiktok-user-1',
    },
  ])(
    '$caseNo persists account search output into benchmark accounts and growth leads',
    async ({ caseNo, skillCode, skillName, platform, path, accountId }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, 'competitor-account-radar', {
        input: { keyword: '咖啡' },
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { keyword: '咖啡' },
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.competitor-account-radar.1-账号发现.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: { keyword: '咖啡' },
          input: { keyword: '咖啡' },
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            list: [
              {
                nickname: `${skillName}样本号`,
                externalUserId: accountId,
                profileUrl: `https://example.com/${platform}/${accountId}`,
                avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
                fans: 128000,
                likeCount: 560000,
                workCount: 92,
                score: 83,
                reason: '近期咖啡内容涨粉明显，适合作为对标样本。',
                keywords: ['咖啡', '探店', '涨粉'],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      await service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
        skillCode,
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      });

      expect(prisma.benchmarkAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            growthLeadId: expect.stringMatching(/^redfox-lead-/),
            platform,
            nickname: `${skillName}样本号`,
            externalUserId: accountId,
            profileUrl: `https://example.com/${platform}/${accountId}`,
            avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
            metrics: expect.objectContaining({
              fans: 128000,
              likeCount: 560000,
              workCount: 92,
              score: 83,
            }),
            reason: '近期咖啡内容涨粉明显，适合作为对标样本。',
            status: 'watching',
          }),
        }),
      );
      expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            sourceType: 'redfox_api',
            nickname: `${skillName}样本号`,
            profileUrl: `https://example.com/${platform}/${accountId}`,
            avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
            externalUserId: accountId,
            sourceText: '近期咖啡内容涨粉明显，适合作为对标样本。',
            sourceUrl: `https://example.com/${platform}/${accountId}`,
            score: 83,
            matchedKeywords: ['咖啡', '探店', '涨粉'],
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'BenchmarkAccount',
                status: 'created',
                refId: 'benchmark-account-1',
                source: 'benchmark_accounts',
              }),
              expect.objectContaining({
                objectType: 'GrowthLead',
                status: 'created',
                refId: expect.stringMatching(/^redfox-lead-/),
                source: 'growth_leads',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              benchmarkAccounts: 1,
              growthLeads: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P03-01',
      skillCode: 'douyin-comment',
      skillName: '抖音评论分析',
      platform: 'douyin',
      path: '/story/api/dy/work/comment',
      input: { workUrl: 'https://example.com/douyin/video/1' },
    },
    {
      caseNo: 'P03-02',
      skillCode: 'xiaohongshu-comment',
      skillName: '小红书评论分析',
      platform: 'xiaohongshu',
      path: '/story/api/xhs/ability/commentList',
      input: { workUrl: 'https://example.com/xhs/note/1' },
    },
    {
      caseNo: 'P03-03',
      skillCode: 'bilibili-comment',
      skillName: 'B 站评论分析',
      platform: 'bilibili',
      path: '/story/api/bili/commentSubmit',
      input: { workUrl: 'https://example.com/bilibili/video/1' },
    },
  ])(
    '$caseNo persists comment API output into comment insights and growth leads',
    async ({ caseNo, skillCode, skillName, platform, path, input }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, 'comment-lead-solution', {
        input,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.comment-lead-solution.1-评论抓取.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: input,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            comments: [
              {
                commentId: `${platform}-comment-1`,
                nickname: `${skillName}高意向用户`,
                comment: '这个怎么预约？价格可以私信发我吗？',
                platform,
                url: `${Object.values(input)[0]}#comment-1`,
                painPoints: ['预约路径不清晰'],
                intentKeywords: ['预约', '价格'],
                demandSignals: ['询价', '预约'],
                objections: ['想先了解价格'],
                replySuggestions: ['先私信发送价目表，再引导预约体验。'],
                score: 91,
                scoreReasons: ['明确询价', '有预约意向'],
                evidenceUrls: [`${Object.values(input)[0]}#comment-1`],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      await service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
        skillCode,
        input,
        estimatedCostPoints: 1,
      });

      expect(prisma.commentInsight.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            growthLeadId: expect.stringMatching(/^redfox-lead-/),
            platform,
            sourceUrl: `${Object.values(input)[0]}#comment-1`,
            sourceExternalId: `${platform}-comment-1`,
            painPoints: ['预约路径不清晰'],
            intentKeywords: ['预约', '价格'],
            demandSignals: ['询价', '预约'],
            objections: ['想先了解价格'],
            replySuggestions: ['先私信发送价目表，再引导预约体验。'],
          }),
        }),
      );
      expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            sourceType: 'redfox_api',
            nickname: `${skillName}高意向用户`,
            sourceText: '这个怎么预约？价格可以私信发我吗？',
            sourceUrl: `${Object.values(input)[0]}#comment-1`,
            score: 91,
            scoreReasons: ['明确询价', '有预约意向'],
            evidenceUrls: [`${Object.values(input)[0]}#comment-1`],
            latestReply: '先私信发送价目表，再引导预约体验。',
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'CommentInsight',
                status: 'created',
                refId: 'comment-insight-1',
                source: 'comment_insights',
              }),
              expect.objectContaining({
                objectType: 'GrowthLead',
                status: 'created',
                refId: expect.stringMatching(/^redfox-lead-/),
                source: 'growth_leads',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              commentInsights: 1,
              growthLeads: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P06-01',
      keyword: '文旅',
      itemTitle: '暑期亲子文旅目的地内容升温',
      reportTitle: '文旅行业情报日报',
    },
    {
      caseNo: 'P06-02',
      keyword: '短剧',
      itemTitle: '短剧投流素材测试节奏加快',
      reportTitle: '短剧行业情报日报',
    },
    {
      caseNo: 'P06-03',
      keyword: 'A 股新闻',
      itemTitle: 'A 股消费行业大 V 调研热度上升',
      reportTitle: 'A 股行业情报日报',
    },
  ])(
    '$caseNo persists industry intelligence output into items and reports',
    async ({ caseNo, keyword, itemTitle, reportTitle }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, 'industry-intel', {
        input: { keyword },
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { keyword },
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: 'deepsearch-doubao-submit',
          name: '豆包 WebSearch 提交',
          platform: 'web',
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: '/story/api/deepSearch/dbSubmit',
          operation: 'solutions.industry-intel.1-行业配置.redfox_execute',
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: { keyword },
          input: { keyword },
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            title: reportTitle,
            summary: `${keyword}行业出现新的内容机会和风险信号。`,
            findings: [`${keyword}热点增长`, `${keyword}竞品动作变密集`],
            evidence: [`https://example.com/${keyword}/report`],
            completeness: 88,
            items: [
              {
                title: itemTitle,
                platform: 'web',
                sourceUrl: `https://example.com/${keyword}/trend-1`,
                keywords: [keyword, '行业情报'],
                summary: `${keyword}相关讨论持续升温，适合进入运营日报。`,
                sourceName: '行业观察',
                score: 89,
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      await service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
        skillCode: 'deepsearch-doubao-submit',
        input: { keyword },
        estimatedCostPoints: 1,
      });

      expect(redfoxSkillRunner.runSkill).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          skillName: 'deepsearch-doubao-submit',
          dryRun: false,
          body: expect.objectContaining({
            inquiryText: keyword,
            keyword,
            query: keyword,
            q: keyword,
            searchText: keyword,
          }),
          query: expect.objectContaining({
            inquiryText: keyword,
            keyword,
            query: keyword,
            q: keyword,
          }),
        }),
      );
      expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            redfoxCallLogId: `log-${caseNo}`,
            platform: 'web',
            type: 'web_search_submit',
            title: itemTitle,
            summary: `${keyword}相关讨论持续升温，适合进入运营日报。`,
            sourceUrl: `https://example.com/${keyword}/trend-1`,
            author: '行业观察',
            keywords: [keyword, '行业情报'],
            status: 'new',
          }),
        }),
      );
      expect(prisma.intelligenceReport.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            kind: 'web_search_submit',
            title: reportTitle,
            status: 'draft',
            completeness: 88,
            findings: [`${keyword}热点增长`, `${keyword}竞品动作变密集`],
            evidence: [`https://example.com/${keyword}/report`],
            markdown: expect.stringContaining(reportTitle),
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'IntelligenceItem',
                status: 'created',
                source: 'intelligence_items',
              }),
              expect.objectContaining({
                objectType: 'IntelligenceReport',
                status: 'created',
                source: 'intelligence_reports',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              intelligenceItems: 1,
              intelligenceReports: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P07-01',
      packageCode: 'global-content-intel',
      skillCode: 'tiktok-search-user',
      skillName: 'TikTok 账号搜索',
      platform: 'tiktok',
      path: '/story/api/deepSearch/tk/searchUser',
      keyword: 'coffee shop',
      accountId: 'tiktok-global-coffee-1',
    },
    {
      caseNo: 'P09-01',
      packageCode: 'kol-screening',
      skillCode: 'douyin-search-user',
      skillName: '抖音账号搜索',
      platform: 'douyin',
      path: '/story/api/dyData/searchUser',
      keyword: '咖啡探店达人',
      accountId: 'douyin-kol-coffee-1',
    },
    {
      caseNo: 'P09-02',
      packageCode: 'kol-screening',
      skillCode: 'xiaohongshu-search-user',
      skillName: '小红书账号搜索',
      platform: 'xiaohongshu',
      path: '/story/api/xhsUser/searchUser',
      keyword: '咖啡生活方式达人',
      accountId: 'xhs-kol-coffee-1',
    },
    {
      caseNo: 'P09-03',
      packageCode: 'kol-screening',
      skillCode: 'gzh-search-user',
      skillName: '公众号账号搜索',
      platform: 'gzh',
      path: '/story/api/gzhData/searchUser',
      keyword: '咖啡品牌公众号',
      accountId: 'gzh-kol-coffee-1',
    },
    {
      caseNo: 'P09-04',
      packageCode: 'kol-screening',
      skillCode: 'bilibili-account-detail',
      skillName: 'B 站账号详情',
      platform: 'bilibili',
      path: '/story/api/bili/data/accountDetail',
      keyword: 'B 站咖啡达人',
      accountId: 'bili-kol-coffee-1',
      input: { accountId: 'bili-kol-coffee-1' },
    },
    {
      caseNo: 'P09-05',
      packageCode: 'kol-screening',
      skillCode: 'tiktok-search-user',
      skillName: 'TikTok 账号搜索',
      platform: 'tiktok',
      path: '/story/api/deepSearch/tk/searchUser',
      keyword: 'coffee creator',
      accountId: 'tiktok-kol-coffee-1',
    },
  ])(
    '$caseNo persists expansion account API output into benchmark accounts and growth leads',
    async ({
      caseNo,
      packageCode,
      skillCode,
      skillName,
      platform,
      path,
      keyword,
      accountId,
      input,
    }) => {
      const actor = makeUser();
      const runInput = input || { keyword };
      const run = await service.createRun(actor, packageCode, {
        input: runInput,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: runInput,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.${packageCode}.1-redfox-account-search.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: runInput,
          input: runInput,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            list: [
              {
                nickname: `${skillName}候选达人`,
                externalUserId: accountId,
                profileUrl: `https://example.com/${platform}/${accountId}`,
                avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
                fans: 86000,
                likeCount: 310000,
                workCount: 64,
                score: 87,
                reason: `${keyword}方向内容质量稳定，适合作为投放或出海参考对象。`,
                keywords: [keyword, '达人筛选', '账号机会'],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input: runInput,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.benchmarkAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            nickname: `${skillName}候选达人`,
            externalUserId: accountId,
            profileUrl: `https://example.com/${platform}/${accountId}`,
            avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
            metrics: expect.objectContaining({
              fans: 86000,
              likeCount: 310000,
              workCount: 64,
              score: 87,
            }),
            reason: `${keyword}方向内容质量稳定，适合作为投放或出海参考对象。`,
            status: 'watching',
          }),
        }),
      );
      expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            sourceType: 'redfox_api',
            nickname: `${skillName}候选达人`,
            profileUrl: `https://example.com/${platform}/${accountId}`,
            avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
            externalUserId: accountId,
            sourceText: `${keyword}方向内容质量稳定，适合作为投放或出海参考对象。`,
            sourceUrl: `https://example.com/${platform}/${accountId}`,
            score: 87,
            matchedKeywords: [keyword, '达人筛选', '账号机会'],
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'BenchmarkAccount',
                status: 'created',
                source: 'benchmark_accounts',
              }),
              expect.objectContaining({
                objectType: 'GrowthLead',
                status: 'created',
                source: 'growth_leads',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              benchmarkAccounts: 1,
              growthLeads: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P10-02',
      packageCode: 'viral-breakdown',
      skillCode: 'douyin-query-work',
      skillName: '抖音作品详情查询',
      platform: 'douyin',
      path: '/story/api/dyData/queryWork',
      keyword: '抖音咖啡爆款作品',
      itemTitle: '咖啡店菜单改造爆款视频',
      sourceUrl: 'https://v.douyin.com/work-detail-coffee',
      reportTitle: null,
      input: { workUrl: 'https://v.douyin.com/work-detail-coffee' },
      expectedCounts: {
        normalizedObjects: 3,
        intelligenceItems: 1,
        materials: 1,
        benchmarkAccounts: 1,
        persistedObjects: 3,
      },
      expectedRefs: ['IntelligenceItem', 'Material', 'BenchmarkAccount'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P10-03',
      packageCode: 'viral-breakdown',
      skillCode: 'bilibili-work-detail',
      skillName: 'B 站作品详情',
      platform: 'bilibili',
      path: '/story/api/bili/data/workDetail',
      keyword: 'B 站咖啡爆款作品',
      itemTitle: 'B 站咖啡门店改造复盘视频',
      sourceUrl: 'https://www.bilibili.com/video/BVcoffee001',
      reportTitle: null,
      input: { workUrl: 'https://www.bilibili.com/video/BVcoffee001' },
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        materials: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'Material'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P10-04',
      packageCode: 'viral-breakdown',
      skillCode: 'gzh-search-article',
      skillName: '公众号文章搜索',
      platform: 'gzh',
      path: '/story/api/gzhData/searchArticle',
      keyword: '公众号咖啡爆款拆解',
      itemTitle: '咖啡品牌私域爆款文章拆解',
      sourceUrl: 'https://mp.weixin.qq.com/s/viral-coffee-breakdown',
      reportTitle: null,
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        materials: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'Material'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P11-02',
      packageCode: 'private-asset-extractor',
      skillCode: 'media-parse-work',
      skillName: '短视频下载器',
      platform: 'media',
      path: '/story/api/parseWork/parse',
      keyword: '短视频素材解析',
      itemTitle: '私域短视频素材解析结果',
      sourceUrl: 'https://example.com/private/video-asset-1',
      reportTitle: null,
      input: {
        url: 'https://example.com/private/video-asset-1',
        authorizationStatus: 'owned',
      },
      expectedCounts: {
        normalizedObjects: 1,
        materials: 1,
        persistedObjects: 1,
      },
      expectedRefs: ['Material'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P11-03',
      packageCode: 'private-asset-extractor',
      skillCode: 'media-parse-work',
      skillName: '短视频下载器',
      platform: 'media',
      path: '/story/api/parseWork/parse',
      keyword: '作品爬取素材',
      itemTitle: '授权作品爬取素材记录',
      sourceUrl: 'https://example.com/private/work-crawl-1',
      reportTitle: null,
      input: {
        workUrl: 'https://example.com/private/work-crawl-1',
        authorizationStatus: 'owned',
      },
      expectedCounts: {
        normalizedObjects: 1,
        materials: 1,
        persistedObjects: 1,
      },
      expectedRefs: ['Material'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P11-04',
      packageCode: 'private-asset-extractor',
      skillCode: 'deepsearch-doubao-submit',
      skillName: '豆包 WebSearch 提交',
      platform: 'web',
      path: '/story/api/deepSearch/dbSubmit',
      keyword: '私域素材案例检索',
      itemTitle: '私域素材复用案例被多平台讨论',
      sourceUrl: 'https://example.com/private-asset-search',
      reportTitle: '私域素材检索日报',
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        intelligenceReports: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'IntelligenceReport'],
      payloadKind: 'deepsearch',
    },
    {
      caseNo: 'P15-02',
      packageCode: 'brand-monitoring',
      skillCode: 'deepsearch-doubao-submit',
      skillName: '豆包 WebSearch 提交',
      platform: 'web',
      path: '/story/api/deepSearch/dbSubmit',
      keyword: '咖啡品牌负面舆情',
      itemTitle: '咖啡品牌排队争议开始扩散',
      sourceUrl: 'https://example.com/brand-risk-coffee',
      reportTitle: '咖啡品牌舆情监控日报',
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        intelligenceReports: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'IntelligenceReport'],
      payloadKind: 'deepsearch',
    },
    {
      caseNo: 'P07-02',
      packageCode: 'global-content-intel',
      skillCode: 'deepsearch-doubao-submit',
      skillName: '豆包 WebSearch 提交',
      platform: 'web',
      path: '/story/api/deepSearch/dbSubmit',
      keyword: '海外咖啡内容趋势',
      itemTitle: '海外咖啡门店短视频脚本开始流行',
      sourceUrl: 'https://example.com/global-coffee-script',
      reportTitle: '出海内容情报日报',
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        intelligenceReports: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'IntelligenceReport'],
      payloadKind: 'deepsearch',
    },
    {
      caseNo: 'P07-03',
      packageCode: 'global-content-intel',
      skillCode: 'deepsearch-doubao-submit',
      skillName: '豆包 WebSearch 提交',
      platform: 'web',
      path: '/story/api/deepSearch/dbSubmit',
      keyword: 'AI 出海内容机会',
      itemTitle: 'AI 工具出海内容正在进入教程化表达',
      sourceUrl: 'https://example.com/global-ai-content',
      reportTitle: 'AI 出海内容情报日报',
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        intelligenceReports: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'IntelligenceReport'],
      payloadKind: 'deepsearch',
    },
    {
      caseNo: 'P08-01',
      packageCode: 'low-follower-viral',
      skillCode: 'xiaohongshu-search-article',
      skillName: '小红书作品搜索',
      platform: 'xiaohongshu',
      path: '/story/api/xhsUser/searchArticle',
      keyword: '低粉咖啡爆款',
      itemTitle: '低粉账号咖啡菜单改造笔记爆了',
      sourceUrl: 'https://www.xiaohongshu.com/explore/low-follower-coffee-1',
      reportTitle: null,
      expectedCounts: {
        normalizedObjects: 3,
        intelligenceItems: 1,
        materials: 1,
        topics: 1,
        persistedObjects: 3,
      },
      expectedRefs: ['IntelligenceItem', 'Material', 'Topic'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P08-02',
      packageCode: 'low-follower-viral',
      skillCode: 'xiaohongshu-search-article',
      skillName: '小红书作品搜索',
      platform: 'xiaohongshu',
      path: '/story/api/xhsUser/searchArticle',
      keyword: '小红书七日爆款咖啡',
      itemTitle: '七日爆款咖啡店省钱打卡笔记',
      sourceUrl: 'https://www.xiaohongshu.com/explore/seven-day-coffee-1',
      reportTitle: null,
      expectedCounts: {
        normalizedObjects: 3,
        intelligenceItems: 1,
        materials: 1,
        topics: 1,
        persistedObjects: 3,
      },
      expectedRefs: ['IntelligenceItem', 'Material', 'Topic'],
      payloadKind: 'article',
    },
    {
      caseNo: 'P08-03',
      packageCode: 'low-follower-viral',
      skillCode: 'gzh-search-article',
      skillName: '公众号文章搜索',
      platform: 'gzh',
      path: '/story/api/gzhData/searchArticle',
      keyword: '公众号咖啡黑马案例',
      itemTitle: '低粉公众号咖啡私域文章破圈',
      sourceUrl: 'https://mp.weixin.qq.com/s/low-follower-coffee',
      reportTitle: null,
      expectedCounts: {
        normalizedObjects: 2,
        intelligenceItems: 1,
        materials: 1,
        persistedObjects: 2,
      },
      expectedRefs: ['IntelligenceItem', 'Material'],
      payloadKind: 'article',
    },
  ])(
    '$caseNo persists expansion content API output into business records',
    async ({
      caseNo,
      packageCode,
      skillCode,
      skillName,
      platform,
      path,
      keyword,
      itemTitle,
      sourceUrl,
      reportTitle,
      input,
      expectedCounts,
      expectedRefs,
      payloadKind,
    }) => {
      const actor = makeUser();
      const runInput = input || { keyword };
      const run = await service.createRun(actor, packageCode, {
        input: runInput,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: runInput,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.${packageCode}.1-redfox-content-search.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: runInput,
          input: runInput,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample:
          payloadKind === 'deepsearch'
            ? {
                code: 0,
                data: {
                  title: reportTitle,
                  summary: `${keyword}出现新的内容机会。`,
                  findings: [
                    `${keyword}搜索热度上升`,
                    `${keyword}脚本结构可复用`,
                  ],
                  evidence: [sourceUrl],
                  completeness: 84,
                  items: [
                    {
                      title: itemTitle,
                      platform,
                      sourceUrl,
                      keywords: [keyword, '出海情报'],
                      summary: `${keyword}相关讨论持续升温。`,
                      sourceName: '全球内容观察',
                      score: 86,
                    },
                  ],
                },
              }
            : {
                code: 0,
                data: {
                  list: [
                    {
                      title: itemTitle,
                      platform,
                      hotScore: 92,
                      sourceUrl,
                      articleUrl: sourceUrl,
                      keywords: [keyword, '低粉爆款', '可复刻'],
                      description: `${keyword}样本具备低粉账号可复制结构。`,
                      nickname: '低粉爆款观察员',
                      accountName: '低粉爆款观察员',
                      externalUserId: `${caseNo}-author-1`,
                      profileUrl: `https://example.com/accounts/${caseNo}-author-1`,
                      likeCount: 12000,
                      commentCount: 268,
                    },
                  ],
                },
              },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input: runInput,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              ...expectedRefs.map((objectType) =>
                expect.objectContaining({
                  objectType,
                  status: 'created',
                }),
              ),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              ...expectedCounts,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
            payloadSummary: expect.objectContaining({
              mapping: expect.objectContaining({
                code: skillCode,
                path,
              }),
            }),
          }),
        }),
      );
      if (expectedRefs.includes('IntelligenceItem')) {
        expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'user-1',
              tenantId: null,
              redfoxCallLogId: `log-${caseNo}`,
              platform,
              title: itemTitle,
              sourceUrl,
              status: 'new',
            }),
          }),
        );
      }
      if (expectedRefs.includes('IntelligenceReport')) {
        expect(prisma.intelligenceReport.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'user-1',
              tenantId: null,
              title: reportTitle,
              status: 'draft',
              completeness: 84,
              evidence: [sourceUrl],
            }),
          }),
        );
      }
      if (expectedRefs.includes('Material')) {
        expect(prisma.material.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              title: itemTitle,
              sourceUrl,
              platform,
              author: '低粉爆款观察员',
              keywords: [keyword, '低粉爆款', '可复刻'],
            }),
          }),
        );
      }
      if (expectedRefs.includes('BenchmarkAccount')) {
        expect(prisma.benchmarkAccount.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'user-1',
              tenantId: null,
              platform,
              nickname: '低粉爆款观察员',
              externalUserId: `${caseNo}-author-1`,
              profileUrl: `https://example.com/accounts/${caseNo}-author-1`,
              status: 'watching',
            }),
          }),
        );
      }
      if (expectedRefs.includes('Topic')) {
        expect(prisma.topic.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              title: itemTitle,
              sourceType: 'redfox_api',
              keywords: [keyword, '低粉爆款', '可复刻'],
              aiScore: 92,
              status: 'pending',
            }),
          }),
        );
      }
    },
  );

  it.each([
    {
      caseNo: 'P14-01',
      skillCode: 'douyin-query-user',
      skillName: '抖音账号详情',
      platform: 'douyin',
      path: '/story/api/dyData/queryUser',
      input: { accountId: 'douyin-health-coffee-1' },
      accountId: 'douyin-health-coffee-1',
      accountName: '抖音咖啡账号',
    },
    {
      caseNo: 'P14-02',
      skillCode: 'xiaohongshu-query-account',
      skillName: '小红书账号详情',
      platform: 'xiaohongshu',
      path: '/story/api/xhsUser/queryAccountDetail',
      input: { accountId: 'xhs-health-coffee-1' },
      accountId: 'xhs-health-coffee-1',
      accountName: '小红书咖啡账号',
    },
    {
      caseNo: 'P14-03',
      skillCode: 'gzh-query-user',
      skillName: '公众号账号详情',
      platform: 'gzh',
      path: '/story/api/gzhData/queryUser',
      input: { account: 'gzh-health-coffee-1' },
      accountId: 'gzh-health-coffee-1',
      accountName: '公众号咖啡账号',
    },
    {
      caseNo: 'P14-04',
      skillCode: 'douyin-query-user',
      skillName: '抖音账号详情',
      platform: 'douyin',
      path: '/story/api/dyData/queryUser',
      input: { accountId: 'douyin-subscribe-coffee-1' },
      accountId: 'douyin-subscribe-coffee-1',
      accountName: '抖音订阅追踪账号',
    },
  ])(
    '$caseNo persists account diagnosis output into benchmark and health records',
    async ({
      caseNo,
      skillCode,
      skillName,
      platform,
      path,
      input,
      accountId,
      accountName,
    }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, 'account-diagnosis', {
        input,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.account-diagnosis.1-account-health.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: input,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            list: [
              {
                accountName,
                nickname: accountName,
                externalUserId: accountId,
                accountId,
                profileUrl: `https://example.com/${platform}/${accountId}`,
                avatarUrl: `https://example.com/${platform}/${accountId}.jpg`,
                score: 76,
                fans: 146000,
                workCount: 118,
                riskStatus: 'medium',
                loginStatus: 'logged_in',
                todayActionCount: 17,
                failureRate: 0.04,
                recommendation:
                  '近 7 天互动率波动，需要优化发布时间并增加评论区引导。',
                lastCheckedAt: '2026-07-01T08:00:00.000Z',
                keywords: ['账号体检', '咖啡', '风险项'],
                reason: '账号有稳定内容资产，但互动质量需要继续优化。',
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.benchmarkAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            nickname: accountName,
            externalUserId: accountId,
            profileUrl: `https://example.com/${platform}/${accountId}`,
            status: 'watching',
          }),
        }),
      );
      expect(prisma.growthAccountHealth.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            accountId,
            accountName,
            loginStatus: 'logged_in',
            todayActionCount: 17,
            failureRate: 0.04,
            riskStatus: 'medium',
            recommendation:
              '近 7 天互动率波动，需要优化发布时间并增加评论区引导。',
            lastCheckedAt: new Date('2026-07-01T08:00:00.000Z'),
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'BenchmarkAccount',
                status: 'created',
                source: 'benchmark_accounts',
              }),
              expect.objectContaining({
                objectType: 'GrowthAccountHealth',
                status: 'created',
                source: 'growth_account_health',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              benchmarkAccounts: 1,
              growthAccountHealths: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P04-04',
      packageCode: 'creation-enhancement',
      skillCode: 'seedream-image-submit',
      skillName: 'Seedream 5.0 lite 提交任务',
      path: '/story/api/parseWork/imageGen/arkSubmit',
      prompt: '创作增强咖啡封面图',
      title: '创作增强咖啡封面图生成任务',
      sourceUrl: 'https://example.com/aigc/creation-cover.png',
      cost: 8,
      taskType: 'image_generation_submit',
    },
    {
      caseNo: 'P04-05',
      packageCode: 'creation-enhancement',
      skillCode: 'seedance-video-submit',
      skillName: 'Seedance 2.0 视频生成提交任务',
      path: '/story/api/parseWork/videoGen/submit',
      prompt: '咖啡新品短视频开场镜头',
      title: '咖啡新品短视频生成任务',
      sourceUrl: 'https://example.com/aigc/creation-video.mp4',
      cost: 150,
      taskType: 'video_generation_submit',
    },
    {
      caseNo: 'P12-01',
      packageCode: 'aigc-asset-factory',
      skillCode: 'gpt-image-submit',
      skillName: 'image2-GPT 提交任务',
      path: '/story/api/parseWork/imageGen/submitSkill',
      prompt: '咖啡店夏季新品海报',
      title: '咖啡店夏季新品海报生成任务',
      sourceUrl: 'https://example.com/aigc/gpt-image-result.png',
      cost: 10,
      taskType: 'image_generation_submit',
    },
    {
      caseNo: 'P12-02',
      packageCode: 'aigc-asset-factory',
      skillCode: 'seedream-image-submit',
      skillName: 'Seedream 5.0 lite 提交任务',
      path: '/story/api/parseWork/imageGen/arkSubmit',
      prompt: '小红书咖啡封面图',
      title: '小红书咖啡封面图生成任务',
      sourceUrl: 'https://example.com/aigc/seedream-cover.png',
      cost: 8,
      taskType: 'image_generation_submit',
    },
    {
      caseNo: 'P12-03',
      packageCode: 'aigc-asset-factory',
      skillCode: 'seedance-video-submit',
      skillName: 'Seedance 2.0 视频生成提交任务',
      path: '/story/api/parseWork/videoGen/submit',
      prompt: '咖啡探店短视频脚本分镜',
      title: '咖啡探店短视频素材生成任务',
      sourceUrl: 'https://example.com/aigc/seedance-video.mp4',
      cost: 150,
      taskType: 'video_generation_submit',
    },
    {
      caseNo: 'P12-05',
      packageCode: 'aigc-asset-factory',
      skillCode: 'seedream-image-submit',
      skillName: 'Seedream 5.0 lite 提交任务',
      path: '/story/api/parseWork/imageGen/arkSubmit',
      prompt: '公众号咖啡文章封面图',
      title: '公众号咖啡文章封面图生成任务',
      sourceUrl: 'https://example.com/aigc/wechat-cover.png',
      cost: 8,
      taskType: 'image_generation_submit',
    },
  ])(
    '$caseNo persists AIGC API output into material and runtime execution records',
    async ({
      caseNo,
      packageCode,
      skillCode,
      skillName,
      path,
      prompt,
      title,
      sourceUrl,
      cost,
      taskType,
    }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, packageCode, {
        input: { prompt },
        maxCostPoints: 300,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { prompt },
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-api-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform: 'aigc',
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path,
          operation: `solutions.${packageCode}.1-aigc-material-submit.redfox_execute`,
        },
        estimatedCostPoints: cost,
        requestPreview: {
          query: null,
          body: { prompt },
          input: { prompt },
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: `log-${caseNo}`,
        payloadSummary: { kind: 'object', keys: ['code', 'data'] },
        payloadSample: {
          code: 0,
          data: {
            list: [
              {
                title,
                platform: 'aigc',
                sourceUrl,
                imageUrl: sourceUrl,
                keywords: ['咖啡', 'AIGC', '封面'],
                summary: `${prompt} 已提交生成，返回素材地址和任务记录。`,
                status: 'succeeded',
                taskId: `${caseNo}-task-1`,
                message: `${skillName} 已完成素材生成。`,
                evidenceUrls: [sourceUrl],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input: { prompt },
          estimatedCostPoints: cost,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.material.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title,
            summary: `${prompt} 已提交生成，返回素材地址和任务记录。`,
            sourceUrl,
            platform: 'aigc',
            keywords: ['咖啡', 'AIGC', '封面'],
          }),
        }),
      );
      expect(prisma.runtimeExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            relatedId: run.id,
            relatedType: 'solution_run',
            executor: 'redfox',
            platform: 'aigc',
            taskType,
            accountId: `${caseNo}-task-1`,
            ok: true,
            status: 'succeeded',
            reasonCode: 'redfox_success',
            userMessage: `${skillName} 已完成素材生成。`,
            engineUrl: path,
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'Material',
                status: 'created',
                source: 'materials',
              }),
              expect.objectContaining({
                objectType: 'RuntimeExecution',
                status: 'created',
                source: 'runtime_executions',
              }),
              expect.objectContaining({
                objectType: 'RedfoxCallLog',
                status: 'linked',
                refId: `log-${caseNo}`,
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 2,
              materials: 1,
              runtimeExecutions: 1,
              persistedObjects: 2,
              skippedPersistenceObjects: 0,
              hasCallLog: true,
            }),
          }),
        }),
      );
    },
  );

  it('persists SkillHub intelligence output into intelligence, material, and topic records', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'skillhub-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'trending-hub',
        name: '全网热搜查询',
        platform: 'web',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: null,
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: null,
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        mappedStatus: 'success',
        skillHubRef: { skillCode: 'trending-hub' },
      },
      payloadSample: {
        ok: true,
        output: {
          items: [
            {
              title: 'AI 咖啡创业热搜',
              platform: 'all',
              score: 91,
              url: 'https://example.com/hot/1',
              keywords: ['咖啡', 'AI'],
              summary: 'AI 咖啡门店成为讨论热点。',
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'trending-hub',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'IntelligenceItem',
              status: 'created',
              refId: 'intelligence-1',
              source: 'intelligence_items',
              preview: expect.objectContaining({
                title: 'AI 咖啡创业热搜',
                platform: 'all',
                score: 91,
                url: 'https://example.com/hot/1',
              }),
            }),
            expect.objectContaining({
              objectType: 'Topic',
              status: 'created',
              refId: 'topic-1',
              source: 'topics',
            }),
            expect.objectContaining({
              objectType: 'Material',
              status: 'created',
              refId: 'material-1',
              source: 'materials',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 3,
            intelligenceItems: 1,
            topics: 1,
            materials: 1,
            persistedObjects: 3,
            skippedPersistenceObjects: 0,
          }),
          payloadSummary: expect.objectContaining({
            normalized: expect.objectContaining({
              sourceKind: 'items',
              confidence: 'medium',
              records: 3,
            }),
            persistence: expect.objectContaining({
              supportedObjectTypes: expect.arrayContaining([
                'IntelligenceItem',
                'IntelligenceReport',
                'BenchmarkAccount',
                'Material',
                'Topic',
                'ComplianceCheck',
                'CommentInsight',
                'GrowthLead',
              ]),
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
          }),
          rawResultJson: expect.objectContaining({
            status: 'persisted',
            normalized: expect.objectContaining({
              persistence: expect.objectContaining({
                persistedRecords: expect.arrayContaining([
                  expect.objectContaining({
                    objectType: 'IntelligenceItem',
                    refId: 'intelligence-1',
                    action: 'created',
                  }),
                  expect.objectContaining({
                    objectType: 'Topic',
                    refId: 'topic-1',
                    action: 'created',
                  }),
                  expect.objectContaining({
                    objectType: 'Material',
                    refId: 'material-1',
                    action: 'created',
                  }),
                ]),
                skippedRecords: [],
              }),
              records: expect.arrayContaining([
                expect.objectContaining({
                  objectType: 'IntelligenceItem',
                  data: expect.objectContaining({
                    title: 'AI 咖啡创业热搜',
                    sourceUrl: 'https://example.com/hot/1',
                    keywords: ['咖啡', 'AI'],
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          platform: 'all',
          type: 'hot_topic_aggregation',
          title: 'AI 咖啡创业热搜',
          sourceUrl: 'https://example.com/hot/1',
          keywords: ['咖啡', 'AI'],
          status: 'new',
          dedupeKey: expect.any(String),
        }),
      }),
    );
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'AI 咖啡创业热搜',
          sourceUrl: 'https://example.com/hot/1',
          platform: 'all',
          keywords: ['咖啡', 'AI'],
        }),
      }),
    );
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'AI 咖啡创业热搜',
          sourceType: 'redfox_skillhub',
          keywords: ['咖啡', 'AI'],
          aiScore: 91,
          materials: {
            create: [
              {
                material: { connect: { id: 'material-1' } },
              },
            ],
          },
        }),
      }),
    );
  });

  it('does not leave auto-persisted SkillHub output waiting for draft confirmation', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'skillhub-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'trending-hub',
        name: '全网热搜查询',
        platform: 'web',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: null,
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: null,
        input: { keyword: '咖啡' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        mappedStatus: 'success',
        skillHubRef: { skillCode: 'trending-hub' },
      },
      payloadSample: {
        ok: true,
        output: {
          items: [
            {
              title: 'AI 咖啡创业热搜',
              platform: 'all',
              score: 91,
              url: 'https://example.com/hot/1',
              keywords: ['咖啡', 'AI'],
              summary: 'AI 咖啡门店成为讨论热点。',
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    await service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
      skillCode: 'trending-hub',
      input: { keyword: '咖啡' },
      estimatedCostPoints: 1,
    });

    await expect(
      service.confirmOutputDrafts(actor, run.id, 'result-4', {
        confirmPersistence: 'PERSIST_REDFOX_OUTPUT_DRAFTS',
        objectTypes: ['Material', 'Topic'],
      }),
    ).rejects.toThrow('没有待确认写入的方案草稿');
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'AI 咖啡创业热搜',
          sourceUrl: 'https://example.com/hot/1',
          platform: 'all',
          keywords: ['咖啡', 'AI'],
          metadata: expect.objectContaining({
            redfoxAutoPersistence: expect.objectContaining({
              solutionRunId: run.id,
              solutionTaskId: run.tasks[0].id,
            }),
          }),
        }),
      }),
    );
    expect(prisma.topic.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'AI 咖啡创业热搜',
          sourceType: 'redfox_skillhub',
          keywords: ['咖啡', 'AI'],
          aiScore: 91,
          materials: {
            create: [
              {
                material: { connect: { id: 'material-1' } },
              },
            ],
          },
        }),
      }),
    );
  });

  it.each([
    {
      caseNo: 'P01-01',
      packageCode: 'hot-topic-solution',
      skillCode: 'trending-hub',
      skillName: '全网热搜查询',
      keyword: '咖啡',
      title: 'AI 咖啡创业热搜',
      sourceUrl: 'https://example.com/hot/p01-01',
    },
    {
      caseNo: 'P07-04',
      packageCode: 'global-content-intel',
      skillCode: 'trending-hub-top10',
      skillName: '全网聚合热点榜单top10',
      keyword: '海外咖啡内容',
      title: '海外咖啡内容脚本热搜',
      sourceUrl: 'https://example.com/hot/p07-04',
    },
    {
      caseNo: 'P15-01',
      packageCode: 'brand-monitoring',
      skillCode: 'trending-hub',
      skillName: '全网热搜查询',
      keyword: '咖啡品牌负面',
      title: '咖啡品牌排队争议登上热搜',
      sourceUrl: 'https://example.com/hot/p15-01',
    },
    {
      caseNo: 'P15-03',
      packageCode: 'brand-monitoring',
      skillCode: 'cn-last30days',
      skillName: 'Last 30 Days—CN版',
      keyword: '咖啡竞品新品',
      title: '咖啡竞品新品讨论近 30 天升温',
      sourceUrl: 'https://example.com/hot/p15-03',
    },
  ])(
    '$caseNo persists SkillHub hot-topic output into intelligence, topic, and material records',
    async ({
      caseNo,
      packageCode,
      skillCode,
      skillName,
      keyword,
      title,
      sourceUrl,
    }) => {
      const actor = makeUser();
      const run = await service.createRun(actor, packageCode, {
        input: { keyword },
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input: { keyword },
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-skillhub-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform: 'web',
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: null,
          operation: `solutions.${packageCode}.1-hot-topic.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: null,
          input: { keyword },
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: null,
        payloadSummary: {
          kind: 'skillhub_agent_run',
          agentSessionId: `${caseNo}-agent-session`,
          mappedStatus: 'success',
          mapping: {
            code: 'contract-web-hot-search',
            scenario: 'hot_topic_aggregation',
            outputObjects: ['IntelligenceItem', 'Topic', 'Material'],
          },
          skillHubRef: { skillCode },
        },
        payloadSample: {
          ok: true,
          output: {
            items: [
              {
                title,
                platform: 'all',
                score: 91,
                url: sourceUrl,
                keywords: [keyword, '热点'],
                summary: `${keyword}正在形成可追踪的内容机会。`,
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input: { keyword },
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.intelligenceItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform: 'all',
            type: 'hot_topic_aggregation',
            title,
            sourceUrl,
            keywords: [keyword, '热点'],
            status: 'new',
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'IntelligenceItem',
                status: 'created',
                source: 'intelligence_items',
              }),
              expect.objectContaining({
                objectType: 'Topic',
                status: 'created',
                source: 'topics',
              }),
              expect.objectContaining({
                objectType: 'Material',
                status: 'created',
                source: 'materials',
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 3,
              intelligenceItems: 1,
              topics: 1,
              materials: 1,
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P04-01',
      packageCode: 'creation-enhancement',
      skillCode: 'xiaohongshu-title-score',
      skillName: '小红书标题生成与评分',
      platform: 'xiaohongshu',
      title: '咖啡店新品这样拍更容易被收藏',
    },
    {
      caseNo: 'P04-02',
      packageCode: 'creation-enhancement',
      skillCode: 'wechat-title',
      skillName: '公众号标题生成与评分',
      platform: 'wechat',
      title: '这家咖啡店，靠一杯新品把老客拉回来了',
    },
    {
      caseNo: 'P04-03',
      packageCode: 'creation-enhancement',
      skillCode: 'multi-rewrite',
      skillName: '多平台文案风格改写',
      platform: 'multi_platform',
      title: '咖啡新品多平台改写版本',
    },
    {
      caseNo: 'P12-04',
      packageCode: 'aigc-asset-factory',
      skillCode: 'video-prompt-expert',
      skillName: '视频提示词生成器（Seedance2.0）',
      platform: 'aigc',
      title: '咖啡新品短视频提示词',
    },
    {
      caseNo: 'P13-01',
      packageCode: 'multi-platform-copy',
      skillCode: 'multi-rewrite',
      skillName: '多平台文案风格改写',
      platform: 'multi_platform',
      title: '咖啡新品多平台发布版本',
    },
    {
      caseNo: 'P13-02',
      packageCode: 'multi-platform-copy',
      skillCode: 'xiaohongshu-rewrite',
      skillName: '小红书文案改写',
      platform: 'xiaohongshu',
      title: '咖啡新品小红书种草版',
    },
    {
      caseNo: 'P13-03',
      packageCode: 'multi-platform-copy',
      skillCode: 'wechat-rewrite',
      skillName: '公众号文案改写',
      platform: 'wechat',
      title: '咖啡新品公众号故事版',
    },
    {
      caseNo: 'P13-04',
      packageCode: 'multi-platform-copy',
      skillCode: 'zhihu-rewrite',
      skillName: '知乎文案改写',
      platform: 'zhihu',
      title: '咖啡新品知乎问答版',
    },
    {
      caseNo: 'P13-05',
      packageCode: 'multi-platform-copy',
      skillCode: 'xiaohongshu-title-score',
      skillName: '小红书标题生成与评分',
      platform: 'xiaohongshu',
      title: '咖啡新品标题评分结果',
    },
  ])(
    '$caseNo persists SkillHub creation output into article, material, and publish plan artifacts',
    async ({ caseNo, packageCode, skillCode, skillName, platform, title }) => {
      const actor = makeUser();
      const input = {
        topic: '咖啡店夏季新品',
        text: '新品冷萃上市，需要生成小红书和公众号版本。',
      };
      const run = await service.createRun(actor, packageCode, {
        input,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-skillhub-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: null,
          operation: `solutions.${packageCode}.1-content-generation.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: null,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: null,
        payloadSummary: {
          kind: 'skillhub_agent_run',
          agentSessionId: `${caseNo}-agent-session`,
          mappedStatus: 'success',
          mapping: {
            code: 'contract-content-rewrite',
            scenario: 'content_generation',
            outputObjects: ['Article', 'Material', 'PublishRecord'],
          },
          skillHubRef: { skillCode },
        },
        payloadSample: {
          ok: true,
          output: {
            items: [
              {
                title,
                platform,
                content: `# ${title}\n\n围绕新品冷萃输出平台化内容草稿。`,
                keywords: ['咖啡', '新品', '改写'],
                score: 88,
                suggestion: '标题可继续增强利益点。',
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'Article',
                status: 'created',
                source: 'articles',
              }),
              expect.objectContaining({
                objectType: 'Material',
                status: 'created',
                source: 'materials',
              }),
              expect.objectContaining({
                objectType: 'PublishRecord',
                status: 'created',
                source: 'solution_artifacts',
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 3,
              articles: 1,
              materials: 1,
              publishRecords: 1,
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
            rawResultJson: expect.objectContaining({
              normalized: expect.objectContaining({
                records: expect.arrayContaining([
                  expect.objectContaining({
                    objectType: 'Article',
                    data: expect.objectContaining({
                      title,
                      content: expect.stringContaining(title),
                    }),
                  }),
                  expect.objectContaining({
                    objectType: 'PublishRecord',
                    data: expect.objectContaining({
                      title,
                      status: 'pending',
                      platform,
                    }),
                  }),
                ]),
              }),
            }),
          }),
        }),
      );
      expect(prisma.article.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title,
            content: expect.stringContaining(title),
            contentFormat: 'markdown',
            status: 'draft',
          }),
        }),
      );
      expect(prisma.material.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title,
            content: expect.stringContaining(title),
            platform,
            keywords: ['咖啡', '新品', '改写'],
          }),
        }),
      );
      expect(prisma.solutionArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: run.id,
            taskId: run.tasks[0].id,
            kind: 'publish_record_draft',
            label: title,
            source: 'redfox_skill_output_normalizer',
            createdBy: 'user-1',
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P08-04',
      skillCode: 'douyin-rise-ranking',
      skillName: '抖音涨粉账号推荐',
      title: '咖啡冷启动账号涨粉样本',
    },
  ])(
    '$caseNo persists SkillHub growth ranking output into account, lead, and artifact records',
    async ({ caseNo, skillCode, skillName, title }) => {
      const actor = makeUser();
      const input = { industry: '咖啡', keyword: '低粉爆款' };
      const run = await service.createRun(actor, 'low-follower-viral', {
        input,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-skillhub-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform: 'douyin',
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: null,
          operation: `solutions.low-follower-viral.1-growth-ranking.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: null,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: null,
        payloadSummary: {
          kind: 'skillhub_agent_run',
          agentSessionId: `${caseNo}-agent-session`,
          mappedStatus: 'success',
          mapping: {
            code: 'contract-growth-ranking',
            scenario: 'growth_ranking',
            outputObjects: ['BenchmarkAccount', 'GrowthLead', 'GrowthReport'],
          },
          skillHubRef: { skillCode },
        },
        payloadSample: {
          ok: true,
          output: {
            items: [
              {
                title,
                nickname: '低粉咖啡增长号',
                platform: 'douyin',
                externalUserId: 'douyin-growth-cafe-1',
                profileUrl: 'https://example.com/douyin/growth-cafe-1',
                avatarUrl: 'https://example.com/douyin/growth-cafe-1.jpg',
                score: 89,
                fans: 9200,
                likeCount: 188000,
                reason: '低粉账号近期点赞飙升，内容结构适合复刻。',
                keywords: ['咖啡', '低粉爆款', '涨粉'],
                findings: ['低粉账号爆款集中在菜单改造和开店避坑'],
                evidence: ['https://example.com/douyin/growth-cafe-1/video'],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.benchmarkAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform: 'douyin',
            nickname: '低粉咖啡增长号',
            externalUserId: 'douyin-growth-cafe-1',
            status: 'watching',
          }),
        }),
      );
      expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform: 'douyin',
            sourceType: 'redfox_skillhub',
            nickname: '低粉咖啡增长号',
            profileUrl: 'https://example.com/douyin/growth-cafe-1',
            externalUserId: 'douyin-growth-cafe-1',
            sourceText: '低粉账号近期点赞飙升，内容结构适合复刻。',
            score: 89,
            matchedKeywords: ['咖啡', '低粉爆款', '涨粉'],
          }),
        }),
      );
      expect(prisma.solutionArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: run.id,
            taskId: run.tasks[0].id,
            kind: 'growth_report',
            label: title,
            source: 'redfox_skill_output_normalizer',
            createdBy: 'user-1',
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'BenchmarkAccount',
                status: 'created',
                source: 'benchmark_accounts',
              }),
              expect.objectContaining({
                objectType: 'GrowthLead',
                status: 'created',
                source: 'growth_leads',
              }),
              expect.objectContaining({
                objectType: 'GrowthReport',
                status: 'created',
                source: 'solution_artifacts',
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 3,
              benchmarkAccounts: 1,
              growthLeads: 1,
              growthReports: 1,
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      );
    },
  );

  it('P11-01 persists SkillHub OCR knowledge and evidence as solution artifacts', async () => {
    const actor = makeUser();
    const input = {
      fileUrl: 'https://example.com/private/menu-photo.pdf',
      authorizationStatus: 'owned',
    };
    const run = await service.createRun(actor, 'private-asset-extractor', {
      input,
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input,
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'P11-01-skillhub-success-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'pdf-image-text-extractor',
        name: 'PDF和图片文字提取',
        platform: 'media',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: null,
        operation:
          'solutions.private-asset-extractor.1-media-extraction.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: null,
        input,
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        agentSessionId: 'P11-01-agent-session',
        mappedStatus: 'success',
        mapping: {
          code: 'contract-media-extraction',
          scenario: 'asset_extraction',
          outputObjects: ['Material', 'KnowledgeItem', 'EvidenceAttachment'],
        },
        skillHubRef: { skillCode: 'pdf-image-text-extractor' },
      },
      payloadSample: {
        ok: true,
        output: {
          items: [
            {
              title: '咖啡门店菜单 OCR 素材',
              platform: 'media',
              fileUrl: input.fileUrl,
              sourceUrl: input.fileUrl,
              ocrText: '新品冷萃、手冲套餐、会员储值活动。',
              summary: '从私域菜单文件中提取可复用商品卖点。',
              keywords: ['私域素材', '菜单', 'OCR'],
              authorizationStatus: 'owned',
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    const result = await service.executeRedfoxTask(
      actor,
      run.id,
      run.tasks[0].id,
      {
        skillCode: 'pdf-image-text-extractor',
        input,
        estimatedCostPoints: 1,
      },
    );

    expect(result.task.status).toBe('succeeded');
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'Material',
              status: 'created',
              source: 'materials',
            }),
            expect.objectContaining({
              objectType: 'KnowledgeItem',
              status: 'created',
              source: 'solution_artifacts',
            }),
            expect.objectContaining({
              objectType: 'EvidenceAttachment',
              status: 'created',
              source: 'solution_artifacts',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 3,
            materials: 1,
            knowledgeItems: 1,
            evidenceAttachments: 1,
            persistedObjects: 3,
            skippedPersistenceObjects: 0,
          }),
          rawResultJson: expect.objectContaining({
            normalized: expect.objectContaining({
              records: expect.arrayContaining([
                expect.objectContaining({
                  objectType: 'KnowledgeItem',
                  data: expect.objectContaining({
                    title: '咖啡门店菜单 OCR 素材',
                    content: '新品冷萃、手冲套餐、会员储值活动。',
                  }),
                }),
                expect.objectContaining({
                  objectType: 'EvidenceAttachment',
                  data: expect.objectContaining({
                    authorizationStatus: 'owned',
                    sourceUrl: input.fileUrl,
                  }),
                }),
              ]),
            }),
          }),
        }),
      }),
    );
    expect(prisma.material.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '咖啡门店菜单 OCR 素材',
          content: '新品冷萃、手冲套餐、会员储值活动。',
          summary: '从私域菜单文件中提取可复用商品卖点。',
          sourceUrl: input.fileUrl,
          platform: 'media',
          keywords: ['私域素材', '菜单', 'OCR'],
        }),
      }),
    );
    expect(prisma.solutionArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: run.id,
          taskId: run.tasks[0].id,
          kind: 'knowledge_item',
          label: '咖啡门店菜单 OCR 素材',
          uri: input.fileUrl,
          source: 'redfox_skill_output_normalizer',
          createdBy: 'user-1',
        }),
      }),
    );
    expect(prisma.solutionArtifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: run.id,
          taskId: run.tasks[0].id,
          kind: 'evidence_attachment',
          label: '咖啡门店菜单 OCR 素材',
          uri: input.fileUrl,
          source: 'redfox_skill_output_normalizer',
          createdBy: 'user-1',
        }),
      }),
    );
  });

  it.each([
    {
      caseNo: 'P05-01',
      skillCode: 'multi-wordcheck',
      skillName: '多平台违禁词检测',
      platform: 'multi_platform',
      riskPlatform: 'multi_platform',
    },
    {
      caseNo: 'P05-02',
      skillCode: 'douyin-prohibited-word',
      skillName: '抖音违禁词检测',
      platform: 'douyin',
      riskPlatform: 'douyin',
    },
    {
      caseNo: 'P05-03',
      skillCode: 'xiaohongshu-prohibited-word',
      skillName: '小红书违禁词检测',
      platform: 'xiaohongshu',
      riskPlatform: 'xiaohongshu',
    },
    {
      caseNo: 'P05-04',
      skillCode: 'wechat-prohibited-word',
      skillName: '公众号违禁词检测',
      platform: 'wechat',
      riskPlatform: 'wechat',
    },
  ])(
    '$caseNo persists SkillHub compliance output with risk evidence artifact and confirmation record',
    async ({ caseNo, skillCode, skillName, platform, riskPlatform }) => {
      const actor = makeUser();
      const input = { text: '限时最强效果，马上购买' };
      const run = await service.createRun(actor, 'publish-compliance', {
        input,
        maxCostPoints: 20,
      });
      const redfoxTask = run.tasks.find(
        (task) => task.executorKind === 'redfox',
      )!;
      await service.dryRunRedfoxTask(actor, run.id, redfoxTask.id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-skillhub-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: null,
          operation: 'solutions.publish-compliance.2-合规检查.redfox_execute',
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: null,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: redfoxTask.id,
        idempotencyKey: null,
        callLogId: null,
        payloadSummary: {
          kind: 'skillhub_agent_run',
          agentSessionId: `${caseNo}-agent-session`,
          mappedStatus: 'success',
          mapping: {
            code: 'contract-compliance-check',
            scenario: 'content_compliance',
            outputObjects: [
              'ComplianceCheck',
              'RiskEvidence',
              'AgentConfirmation',
            ],
          },
          skillHubRef: { skillCode },
        },
        payloadSample: {
          ok: true,
          output: {
            findings: [
              {
                word: '最强',
                reason: '绝对化表达',
                suggestion: '改成“表现突出”',
                platform: riskPlatform,
                riskLevel: 'high',
                evidenceUrls: [`https://example.com/compliance/${caseNo}`],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      await service.executeRedfoxTask(actor, run.id, redfoxTask.id, {
        skillCode,
        input,
        estimatedCostPoints: 1,
      });

      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'ComplianceCheck',
                status: 'created',
                refId: 'compliance-1',
                source: 'compliance_checks',
                preview: expect.objectContaining({
                  title: '最强',
                  platform: riskPlatform,
                }),
              }),
              expect.objectContaining({
                objectType: 'RiskEvidence',
                status: 'created',
                source: 'solution_artifacts',
              }),
              expect.objectContaining({
                objectType: 'AgentConfirmation',
                status: 'created',
                refId: expect.stringMatching(/^agent-confirmation-/),
                source: 'agent_confirmations',
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 3,
              complianceChecks: 1,
              riskEvidences: 1,
              agentConfirmations: 1,
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
            rawResultJson: expect.objectContaining({
              status: 'persisted',
              normalized: expect.objectContaining({
                persistence: expect.objectContaining({
                  persistedRecords: expect.arrayContaining([
                    expect.objectContaining({
                      objectType: 'ComplianceCheck',
                      refId: 'compliance-1',
                      action: 'created',
                    }),
                    expect.objectContaining({
                      objectType: 'RiskEvidence',
                      refId: expect.stringMatching(/^artifact-/),
                      action: 'created',
                    }),
                    expect.objectContaining({
                      objectType: 'AgentConfirmation',
                      refId: expect.stringMatching(/^agent-confirmation-/),
                      action: 'created',
                    }),
                  ]),
                  skippedRecords: [],
                }),
                records: expect.arrayContaining([
                  expect.objectContaining({
                    objectType: 'ComplianceCheck',
                    data: expect.objectContaining({
                      platform: riskPlatform,
                      riskLevel: 'high',
                      findings: expect.arrayContaining([
                        expect.objectContaining({
                          word: '最强',
                          reason: '绝对化表达',
                        }),
                      ]),
                      suggestions: ['改成“表现突出”'],
                    }),
                  }),
                  expect.objectContaining({
                    objectType: 'RiskEvidence',
                    data: expect.objectContaining({
                      platform: riskPlatform,
                      riskLevel: 'high',
                      evidenceUrls: [
                        `https://example.com/compliance/${caseNo}`,
                      ],
                    }),
                  }),
                  expect.objectContaining({
                    objectType: 'AgentConfirmation',
                    data: expect.objectContaining({
                      status: 'pending',
                      riskLevel: 'high',
                      agentSessionId: `${caseNo}-agent-session`,
                    }),
                  }),
                ]),
              }),
            }),
          }),
        }),
      );
      expect(prisma.complianceCheck.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            targetType: 'content',
            platform: riskPlatform,
            riskLevel: 'high',
            status: 'completed',
            findings: expect.arrayContaining([
              expect.objectContaining({
                word: '最强',
                reason: '绝对化表达',
              }),
            ]),
            suggestions: ['改成“表现突出”'],
            raw: expect.objectContaining({
              solutionTaskId: redfoxTask.id,
              dedupeKey: expect.any(String),
            }),
          }),
        }),
      );
      expect(prisma.solutionArtifact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: run.id,
            taskId: redfoxTask.id,
            kind: 'risk_evidence',
            label: '最强',
            uri: `https://example.com/compliance/${caseNo}`,
            source: 'redfox_skill_output_normalizer',
            createdBy: 'user-1',
          }),
        }),
      );
      expect(prisma.agentConfirmation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: `${caseNo}-agent-session`,
            action: 'content_compliance',
            status: 'pending',
            riskLevel: 'high',
            targetLabel: '最强',
            content: '最强',
            note: '绝对化表达',
          }),
        }),
      );
    },
  );

  it.each([
    {
      caseNo: 'P10-01',
      packageCode: 'viral-breakdown',
      skillCode: 'xiaohongshu-comment',
      skillName: '小红书评论分析',
      platform: 'xiaohongshu',
      workUrl: 'https://example.com/xhs/viral-note-1',
      commenter: '想复刻的小李',
      commentText: '这个结构是不是先讲痛点再给清单？想要模板。',
    },
    {
      caseNo: 'P15-04',
      packageCode: 'brand-monitoring',
      skillCode: 'bilibili-comment',
      skillName: 'B站作品评论分析',
      platform: 'bilibili',
      workUrl: 'https://example.com/bilibili/brand-risk-1',
      commenter: '关注售后的小周',
      commentText: '最近排队体验差，有没有官方解释？',
    },
  ])(
    '$caseNo persists generic SkillHub comment output and creates confirmation record',
    async ({
      caseNo,
      packageCode,
      skillCode,
      skillName,
      platform,
      workUrl,
      commenter,
      commentText,
    }) => {
      const actor = makeUser();
      const input = { workUrl, platforms: [platform] };
      const run = await service.createRun(actor, packageCode, {
        input,
        maxCostPoints: 20,
      });
      await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
        input,
      });
      redfoxSkillRunner.runSkill.mockClear();
      prisma.solutionResult.create.mockClear();
      redfoxSkillRunner.runSkill.mockResolvedValueOnce({
        id: `${caseNo}-skillhub-success-1`,
        dryRun: false,
        status: 'success',
        skill: {
          code: skillCode,
          name: skillName,
          platform,
          enabled: true,
          resolved: true,
        },
        endpoint: {
          method: 'POST',
          path: null,
          operation: `solutions.${packageCode}.1-comment-insight.redfox_execute`,
        },
        estimatedCostPoints: 1,
        requestPreview: {
          query: null,
          body: null,
          input,
        },
        warnings: [],
        solutionRunId: run.id,
        solutionTaskId: run.tasks[0].id,
        idempotencyKey: null,
        callLogId: null,
        payloadSummary: {
          kind: 'skillhub_agent_run',
          agentSessionId: `${caseNo}-agent-session`,
          mappedStatus: 'success',
          mapping: {
            code: 'contract-generic-comment-insight',
            scenario: 'comment_insight',
            outputObjects: [
              'CommentInsight',
              'GrowthLead',
              'AgentConfirmation',
            ],
          },
          skillHubRef: { skillCode },
        },
        payloadSample: {
          ok: true,
          output: {
            comments: [
              {
                nickname: commenter,
                comment: commentText,
                platform,
                url: `${workUrl}#comment-1`,
                painPoints: ['想要明确解释和可复用模板'],
                intentKeywords: ['模板', '解释'],
                demandSignals: ['求模板', '关注品牌回应'],
                objections: ['不确定是否可信'],
                replySuggestions: ['先给出公开说明，再引导领取模板。'],
                scoreReasons: ['明确提出需求', '需要人工判断回应策略'],
                evidenceUrls: [`${workUrl}#comment-1`],
              },
            ],
          },
        },
        createdAt: '2026-07-01T00:00:00.000Z',
      });

      const result = await service.executeRedfoxTask(
        actor,
        run.id,
        run.tasks[0].id,
        {
          skillCode,
          input,
          estimatedCostPoints: 1,
        },
      );

      expect(result.task.status).toBe('succeeded');
      expect(prisma.commentInsight.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            sourceUrl: `${workUrl}#comment-1`,
            painPoints: ['想要明确解释和可复用模板'],
            intentKeywords: ['模板', '解释'],
            demandSignals: ['求模板', '关注品牌回应'],
          }),
        }),
      );
      expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 'user-1',
            tenantId: null,
            platform,
            sourceType: 'redfox_skillhub',
            nickname: commenter,
            sourceText: commentText,
            sourceUrl: `${workUrl}#comment-1`,
            latestReply: '先给出公开说明，再引导领取模板。',
          }),
        }),
      );
      expect(prisma.agentConfirmation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: `${caseNo}-agent-session`,
            action: 'comment_insight',
            status: 'pending',
            riskLevel: 'low',
            target: `${workUrl}#comment-1`,
            targetLabel: commentText,
            content: commentText,
            note: '先给出公开说明，再引导领取模板。',
          }),
        }),
      );
      expect(prisma.solutionResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'redfox_output_normalization',
            status: 'persisted',
            businessObjectRefs: expect.arrayContaining([
              expect.objectContaining({
                objectType: 'CommentInsight',
                status: 'created',
                source: 'comment_insights',
              }),
              expect.objectContaining({
                objectType: 'GrowthLead',
                status: 'created',
                source: 'growth_leads',
              }),
              expect.objectContaining({
                objectType: 'AgentConfirmation',
                status: 'created',
                source: 'agent_confirmations',
              }),
            ]),
            counts: expect.objectContaining({
              rawItems: 1,
              normalizedObjects: 3,
              commentInsights: 1,
              growthLeads: 1,
              agentConfirmations: 1,
              persistedObjects: 3,
              skippedPersistenceObjects: 0,
            }),
          }),
        }),
      );
    },
  );

  it('persists SkillHub comment insight output into insight and growth lead records', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'comment-lead-solution', {
      input: { workUrl: 'https://example.com/video/1' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { workUrl: 'https://example.com/video/1' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionResult.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'skillhub-comment-1',
      dryRun: false,
      status: 'success',
      skill: {
        code: 'douyin-comment',
        name: '抖音评论分析',
        platform: 'douyin',
        enabled: true,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: null,
        operation: 'solutions.comment-lead-solution.1-评论抓取.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: null,
        input: { workUrl: 'https://example.com/video/1' },
      },
      warnings: [],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        mappedStatus: 'success',
        skillHubRef: { skillCode: 'douyin-comment' },
      },
      payloadSample: {
        ok: true,
        output: {
          comments: [
            {
              nickname: '想开店的小王',
              comment: '这个套餐多少钱，能预约体验吗？',
              platform: 'douyin',
              url: 'https://example.com/video/1#comment-1',
              painPoints: ['价格不透明'],
              intentKeywords: ['价格', '预约'],
              demandSignals: ['询价', '到店体验'],
              objections: ['担心踩坑'],
              replySuggestions: ['先私信发送价目表，再邀约到店体验。'],
              scoreReasons: ['明确询价', '有到店意向'],
              evidenceUrls: ['https://example.com/video/1#comment-1'],
            },
          ],
        },
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    await service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
      skillCode: 'douyin-comment',
      input: { workUrl: 'https://example.com/video/1' },
      estimatedCostPoints: 1,
    });

    expect(prisma.commentInsight.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          tenantId: null,
          growthLeadId: expect.stringMatching(/^redfox-lead-/),
          platform: 'douyin',
          sourceUrl: 'https://example.com/video/1#comment-1',
          painPoints: ['价格不透明'],
          intentKeywords: ['价格', '预约'],
          demandSignals: ['询价', '到店体验'],
          objections: ['担心踩坑'],
          replySuggestions: ['先私信发送价目表，再邀约到店体验。'],
          raw: expect.objectContaining({
            solutionRunId: run.id,
            dedupeKey: expect.any(String),
          }),
        }),
      }),
    );
    expect(prisma.growthLead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: expect.stringMatching(/^redfox-lead-/),
        },
        create: expect.objectContaining({
          id: expect.stringMatching(/^redfox-lead-/),
          userId: 'user-1',
          tenantId: null,
          platform: 'douyin',
          sourceType: 'redfox_skillhub',
          sourceTaskId: run.tasks[0].id,
          sourceRunId: run.id,
          nickname: '想开店的小王',
          sourceText: '这个套餐多少钱，能预约体验吗？',
          sourceUrl: 'https://example.com/video/1#comment-1',
          score: 0,
          scoreReasons: ['明确询价', '有到店意向'],
          evidenceUrls: ['https://example.com/video/1#comment-1'],
          latestReply: '先私信发送价目表，再邀约到店体验。',
        }),
      }),
    );
    expect(prisma.solutionResult.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'redfox_output_normalization',
          status: 'persisted',
          businessObjectRefs: expect.arrayContaining([
            expect.objectContaining({
              objectType: 'CommentInsight',
              status: 'created',
              refId: 'comment-insight-1',
              source: 'comment_insights',
            }),
            expect.objectContaining({
              objectType: 'GrowthLead',
              status: 'created',
              refId: expect.stringMatching(/^redfox-lead-/),
              source: 'growth_leads',
            }),
          ]),
          counts: expect.objectContaining({
            rawItems: 1,
            normalizedObjects: 2,
            commentInsights: 1,
            growthLeads: 1,
            persistedObjects: 2,
            skippedPersistenceObjects: 0,
          }),
        }),
      }),
    );
  });

  it('keeps a confirmed SkillHub task blocked when Agent-S preflight is not ready', async () => {
    const actor = makeUser();
    const run = await service.createRun(actor, 'hot-topic-solution', {
      input: { keyword: '咖啡' },
      maxCostPoints: 20,
    });
    await service.dryRunRedfoxTask(actor, run.id, run.tasks[0].id, {
      input: { keyword: '咖啡' },
    });
    redfoxSkillRunner.runSkill.mockClear();
    prisma.solutionCostEntry.create.mockClear();
    redfoxSkillRunner.runSkill.mockResolvedValueOnce({
      id: 'skillhub-blocked-1',
      dryRun: false,
      status: 'blocked',
      skill: {
        code: 'trending-hub',
        name: '全网热搜查询',
        platform: 'web',
        enabled: false,
        resolved: true,
      },
      endpoint: {
        method: 'POST',
        path: null,
        operation:
          'solutions.hot-topic-solution.1-关键词平台配置.redfox_execute',
      },
      estimatedCostPoints: 1,
      requestPreview: {
        query: null,
        body: null,
        input: { keyword: '咖啡' },
      },
      warnings: [
        'RedFox SkillHub 本机执行被阻断。',
        '本机能力暂未就绪：缺少 REDFOX_API_KEY',
      ],
      solutionRunId: run.id,
      solutionTaskId: run.tasks[0].id,
      idempotencyKey: null,
      callLogId: null,
      payloadSummary: {
        kind: 'skillhub_agent_run',
        mappedStatus: 'blocked',
      },
      createdAt: '2026-07-01T00:00:00.000Z',
    });

    await expect(
      service.executeRedfoxTask(actor, run.id, run.tasks[0].id, {
        skillCode: '全网热搜/聚合热点',
        input: { keyword: '咖啡' },
        estimatedCostPoints: 1,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.solutionTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.tasks[0].id },
        data: expect.objectContaining({
          status: 'approval_required',
          reasonCode: 'redfox_skillhub_blocked',
          errorMessage: 'RedFox SkillHub 本机执行被阻断。',
          outputJson: expect.objectContaining({
            id: 'skillhub-blocked-1',
            status: 'blocked',
            payloadSummary: expect.objectContaining({
              kind: 'skillhub_agent_run',
            }),
          }),
        }),
      }),
    );
    expect(prisma.solutionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: run.id },
        data: expect.objectContaining({
          status: 'approval_required',
          errorCode: 'redfox_skillhub_blocked',
        }),
      }),
    );
    expect(prisma.solutionCostEntry.create).not.toHaveBeenCalled();
  });

  it('validates category and package code errors', () => {
    expect(() => service.normalizeCategory('bad')).toThrow(BadRequestException);
    expect(() => service.getByCode('not-found')).toThrow(NotFoundException);
  });
});
