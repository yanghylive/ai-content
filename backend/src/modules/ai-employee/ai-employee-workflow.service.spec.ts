import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthRequestContextService } from '../../common/auth-request-context.service';
import type { RuntimeOrchestrator } from '../runtime/orchestrator/runtime-orchestrator.service';
import type {
  ExecutorTask,
  RuntimeExecutionResult,
} from '../runtime/executor.interface';
import { AiEmployeeWorkflowService } from './ai-employee-workflow.service';
import type {
  AiEmployeeExposureMode,
  AiEmployeeWorkflowCapabilityInput,
  AiEmployeeWorkflowConfirmationMetadata,
} from './ai-employee-workflow.types';

const EXPOSURE_TASK_BY_MODE = {
  link: 'douyin-link-exposure',
  search_account: 'douyin-search-account-exposure',
  hot_video: 'douyin-hot-video-exposure',
  targeted: 'douyin-targeted-exposure',
  retention: 'douyin-retention-exposure',
} as const;

function capability(
  key: string,
  status: AiEmployeeWorkflowCapabilityInput['status'] = 'real',
): AiEmployeeWorkflowCapabilityInput {
  return {
    key,
    title: key,
    status,
    message: status === 'real' ? '可执行' : '当前不可执行',
    nextAction: status === 'real' ? '启动任务' : '完成执行器检查',
  };
}

function exposureSuccess(
  task: ExecutorTask,
  evidence = true,
): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: '已读取 1 条候选',
    runtime: {
      mode: 'local-runtime',
      executor: 'browser-cdp',
      engineUrl: 'internal://runtime/douyin-exposure',
    },
    evidence: [
      ...(evidence
        ? [
            {
              type: 'screenshot' as const,
              label: 'douyin-candidate-read',
              path: `/tmp/${task.relatedId}.png`,
              createdAt: '2026-07-10T00:00:00.000Z',
            },
          ]
        : []),
      {
        type: 'text',
        label: 'douyin-exposure-runtime-contract',
        value: JSON.stringify({ executionKind: 'candidate_read' }),
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    ],
    readback: {
      expectedText: 'candidate-comments',
      actualText: JSON.stringify([{ text: '想了解', index: 0 }]),
      matched: true,
    },
  };
}

function actionSuccess(task: ExecutorTask): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: '客户动作已完成',
    runtime: {
      mode: 'local-runtime',
      executor: 'browser-cdp',
    },
    evidence: [
      {
        type: 'screenshot',
        label: 'douyin-customer-action',
        path: `/tmp/${task.relatedId}.png`,
        createdAt: '2026-07-10T00:00:00.000Z',
      },
    ],
    readback: {
      expectedText: String(task.payload.replyText || ''),
      actualText: String(task.payload.replyText || ''),
      matched: true,
    },
  };
}

function runOptions(
  externalActionsAuthorized = false,
  source: 'manual' | 'retry' = 'manual',
) {
  const at = '2026-07-10T08:00:00.000Z';
  return {
    externalActionsAuthorized,
    confirmation: {
      auditId: `audit-${source}`,
      confirmationId: `confirmation-${source}`,
      action: 'runtime-control',
      riskLevel: 'high',
      operator: '测试用户',
      operatorId: 'user-1',
      reason: source === 'retry' ? '确认重试' : '确认启动',
      confirmedAt: at,
      appliedAt: at,
      source,
      checklist: { targetReviewed: true },
    } satisfies AiEmployeeWorkflowConfirmationMetadata,
  };
}

describe('AiEmployeeWorkflowService', () => {
  let storeDir: string;
  let previousStorePath: string | undefined;
  const previousGrowthExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;

  beforeEach(async () => {
    previousStorePath = process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
    storeDir = await mkdtemp(join(tmpdir(), 'ai-employee-workflows-'));
    process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = join(
      storeDir,
      'workflows.json',
    );
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
  });

  afterEach(async () => {
    if (previousStorePath === undefined) {
      delete process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH;
    } else {
      process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH = previousStorePath;
    }
    if (previousGrowthExecutionEnabled === undefined) {
      delete process.env.GROWTH_EXECUTION_ENABLED;
    } else {
      process.env.GROWTH_EXECUTION_ENABLED = previousGrowthExecutionEnabled;
    }
    await rm(storeDir, { recursive: true, force: true });
  });

  it('persists a definition and evidence-backed run for readback', async () => {
    const runtime = {
      execute: jest.fn((task: ExecutorTask) =>
        Promise.resolve(exposureSuccess(task)),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];

    const preparation = await service.prepareWorkflow(
      {
        title: '每日链接线索读取',
        accountId: 'douyin-1',
        workflow: {
          platform: 'douyin',
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
          includeVideoClip: false,
          includePublish: false,
        },
      },
      capabilities,
    );
    const run = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    expect(preparation).toMatchObject({
      executionMode: 'configured',
      displayStatus: 'ready',
      definition: { status: 'ready' },
    });
    expect(run).toMatchObject({
      status: 'completed',
      aggregate: {
        completedSteps: 1,
        evidenceCount: 2,
        candidateCount: 1,
      },
    });
    expect(run.aggregate.readbacks).toEqual([
      expect.objectContaining({ matched: true }),
    ]);

    const reloaded = new AiEmployeeWorkflowService(runtime);
    const snapshot = await reloaded.listWorkflowSnapshot();
    expect(snapshot.definitions[0].id).toBe(preparation.definition.id);
    expect(snapshot.runs[0]).toMatchObject({
      id: run.id,
      status: 'completed',
      aggregate: { completedSteps: 1 },
    });
  });

  it('keeps definitions with the same id isolated by tenant and user', async () => {
    const runtime = {
      execute: jest.fn((task: ExecutorTask) =>
        Promise.resolve(exposureSuccess(task)),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const context = new AuthRequestContextService();
    const prisma = {
      system: {
            tenantMember: {
              findFirst: jest.fn(
                async ({ where }: { where: { userId: string } }) => ({
                  tenantId: `tenant-${where.userId}`,
                }),
              ),
            },
      },
    };
    const service = new AiEmployeeWorkflowService(
      runtime,
      context,
      prisma as never,
    );
    const capabilities = [capability('douyin-link-exposure')];

    await context.run({ user: { id: 'user-a' } }, () =>
      service.prepareWorkflow(
        {
          title: 'A 的工作流',
          accountId: 'douyin-a',
          workflow: {
            id: 'shared-workflow',
            exposureMode: 'link',
            material: 'https://www.douyin.com/video/a',
          },
        },
        capabilities,
      ),
    );

    await expect(
      context.run({ user: { id: 'user-b' } }, () =>
        service.listWorkflowSnapshot(),
      ),
    ).resolves.toEqual({ definitions: [], runs: [] });

    await context.run({ user: { id: 'user-b' } }, () =>
      service.prepareWorkflow(
        {
          title: 'B 的工作流',
          accountId: 'douyin-b',
          workflow: {
            id: 'shared-workflow',
            exposureMode: 'link',
            material: 'https://www.douyin.com/video/b',
          },
        },
        capabilities,
      ),
    );

    const aSnapshot = await context.run({ user: { id: 'user-a' } }, () =>
      service.listWorkflowSnapshot(),
    );
    const bSnapshot = await context.run({ user: { id: 'user-b' } }, () =>
      service.listWorkflowSnapshot(),
    );
    expect(aSnapshot.definitions).toHaveLength(1);
    expect(aSnapshot.definitions[0]).toMatchObject({
      title: 'A 的工作流',
      version: 1,
    });
    expect(bSnapshot.definitions).toHaveLength(1);
    expect(bSnapshot.definitions[0]).toMatchObject({
      title: 'B 的工作流',
      version: 1,
    });
  });

  it('never completes a step when success has only contract metadata and no operational evidence', async () => {
    const runtime = {
      execute: jest.fn((task: ExecutorTask) =>
        Promise.resolve(exposureSuccess(task, false)),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
        },
      },
      capabilities,
    );

    const run = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    expect(run.status).toBe('failed');
    expect(run.aggregate.completedSteps).toBe(0);
    expect(run.steps[0]).toMatchObject({
      status: 'failed',
      reasonCode: 'readback_failed',
      message: expect.stringContaining('没有返回可核验的执行证据'),
    });
  });

  it('runs available steps and blocks only the unavailable step', async () => {
    const runtime = {
      execute: jest.fn((task: ExecutorTask) =>
        Promise.resolve(exposureSuccess(task)),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [
      capability('video-template-clip', 'needs_config'),
      capability('douyin-link-exposure'),
    ];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
          includeVideoClip: true,
        },
      },
      capabilities,
    );

    const run = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    expect(preparation.definition.status).toBe('partially_ready');
    expect(run.status).toBe('partial');
    expect(run.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'video-template-clip',
          status: 'blocked',
        }),
        expect.objectContaining({
          stepId: 'douyin-link-candidate-read',
          status: 'completed',
        }),
      ]),
    );
    expect(runtime.execute).toHaveBeenCalledTimes(1);
    expect(runtime.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'douyin-link-exposure' }),
      expect.any(Object),
    );
  });

  it('retries only unfinished steps and records the new attempt transition', async () => {
    const runtime = {
      execute: jest
        .fn()
        .mockImplementationOnce((task: ExecutorTask) =>
          Promise.resolve(exposureSuccess(task, false)),
        )
        .mockImplementationOnce((task: ExecutorTask) =>
          Promise.resolve(exposureSuccess(task, true)),
        ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
        },
      },
      capabilities,
    );
    const firstRun = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    const retried = await service.retryWorkflowRun(
      firstRun.id,
      {},
      capabilities,
      runOptions(false, 'retry'),
    );

    expect(retried.status).toBe('completed');
    expect(retried.steps[0].attempt).toBe(2);
    expect(retried.steps[0].transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'failed',
          to: 'pending',
          attempt: 2,
        }),
        expect.objectContaining({
          from: 'running',
          to: 'completed',
          attempt: 2,
        }),
      ]),
    );
    expect(retried.confirmations).toEqual([
      expect.objectContaining({ source: 'manual', auditId: 'audit-manual' }),
      expect.objectContaining({ source: 'retry', auditId: 'audit-retry' }),
    ]);
    expect(retried.confirmation).toMatchObject({
      source: 'retry',
      confirmationId: 'confirmation-retry',
    });
    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });

  it.each(
    Object.entries(EXPOSURE_TASK_BY_MODE) as Array<
      [
        AiEmployeeExposureMode,
        (typeof EXPOSURE_TASK_BY_MODE)[AiEmployeeExposureMode],
      ]
    >,
  )(
    'marks %s as candidate-read and routes it to %s',
    async (mode, taskType) => {
      const runtime = {
        execute: jest.fn((task: ExecutorTask) =>
          Promise.resolve(exposureSuccess(task)),
        ),
      } as unknown as jest.Mocked<RuntimeOrchestrator>;
      const service = new AiEmployeeWorkflowService(runtime);
      const capabilities = [capability(taskType)];
      const workflow: Record<string, unknown> = {
        exposureMode: mode,
        material:
          mode === 'link'
            ? 'https://www.douyin.com/video/1'
            : mode === 'targeted'
              ? '目标账号A'
              : '装修',
      };
      if (mode === 'retention') workflow.retentionSourceId = '表单线索';
      const preparation = await service.prepareWorkflow(
        { accountId: 'douyin-1', workflow },
        capabilities,
      );

      await service.startWorkflowRun(
        preparation.definition.id,
        capabilities,
        runOptions(),
      );

      expect(preparation.steps[0]).toMatchObject({
        actionKind: 'candidate_read',
        exposureMode: mode,
        taskType,
        sendMode: 'draft-only',
      });
      expect(runtime.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: taskType,
          payload: expect.objectContaining({
            exposureExecutionKind: 'candidate_read',
            exposureMode: mode,
          }),
        }),
        expect.objectContaining({ sendMode: 'draft-only' }),
      );
    },
  );

  it.each(Object.keys(EXPOSURE_TASK_BY_MODE) as AiEmployeeExposureMode[])(
    'routes an explicit %s customer action through the commercial comment executor',
    async (mode) => {
      const runtime = {
        execute: jest.fn((task: ExecutorTask) =>
          Promise.resolve(actionSuccess(task)),
        ),
      } as unknown as jest.Mocked<RuntimeOrchestrator>;
      const service = new AiEmployeeWorkflowService(runtime);
      const capabilities = [capability('douyin-comment-reply')];
      const preparation = await service.prepareWorkflow(
        {
          accountId: 'douyin-1',
          workflow: {
            exposureMode: mode,
            exposureExecutionKind: 'customer_action',
            customerAction: {
              action: 'comment',
              targetName: '潜在客户',
              targetText: '想了解报价',
              sourceUrl: 'https://www.douyin.com/video/1',
              replyText: '可以发你一份报价参考。',
            },
          },
        },
        capabilities,
      );

      const run = await service.startWorkflowRun(
        preparation.definition.id,
        capabilities,
        runOptions(true),
      );

      expect(preparation.steps[0]).toMatchObject({
        actionKind: 'customer_action',
        exposureMode: mode,
        taskType: 'douyin-comment-reply',
        sendMode: 'auto-send',
      });
      expect(run.status).toBe('completed');
      expect(runtime.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'douyin-comment-reply',
          payload: expect.objectContaining({
            exposureExecutionKind: 'customer_action',
            exposureMode: mode,
            replyText: '可以发你一份报价参考。',
          }),
        }),
        expect.objectContaining({ sendMode: 'auto-send' }),
      );
    },
  );

  it('truthfully blocks an unsupported customer action without calling runtime', async () => {
    const runtime = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          exposureExecutionKind: 'customer_action',
          customerAction: {
            action: 'follow',
            targetText: '潜在客户',
            replyText: '关注',
          },
        },
      },
      capabilities,
    );

    const run = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    expect(preparation.definition.status).toBe('blocked');
    expect(run.status).toBe('blocked');
    expect(run.steps[0].message).toContain('只支持抖音评论和私信');
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('stores confirmation metadata and runs a confirmed schedule when it is due', async () => {
    const runtime = {
      execute: jest.fn((task: ExecutorTask) =>
        Promise.resolve(exposureSuccess(task)),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
          frequency: '每天 1 次',
          timeWindow: '09:00-18:00',
        },
      },
      capabilities,
    );

    expect(preparation.definition.schedule).toMatchObject({
      status: 'awaiting_confirmation',
      frequency: '每天 1 次',
      timeWindow: '09:00-18:00',
    });
    expect(runtime.execute).not.toHaveBeenCalled();

    const manual = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );
    expect(manual.confirmation).toMatchObject({
      auditId: 'audit-manual',
      confirmationId: 'confirmation-manual',
      source: 'manual',
    });

    const activated = (await service.listWorkflowSnapshot()).definitions[0];
    expect(activated.schedule).toMatchObject({
      status: 'active',
      authorization: { auditId: 'audit-manual' },
      nextRunAt: expect.any(String),
    });
    const scheduledRuns = await service.runDueWorkflowSchedules(
      new Date(activated.schedule!.nextRunAt!),
    );

    expect(scheduledRuns).toHaveLength(1);
    expect(scheduledRuns[0]).toMatchObject({
      status: 'completed',
      trigger: 'schedule',
      confirmation: {
        source: 'schedule',
        parentAuditId: 'audit-manual',
        confirmationId: 'confirmation-manual',
      },
    });
    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });

  it('safely fails interrupted active runs after restart and persists recovery', async () => {
    const runtime = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
        },
      },
      capabilities,
    );
    const storePath = process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH!;
    const store = JSON.parse(await readFile(storePath, 'utf8')) as {
      definitions: Array<{ steps: Array<Record<string, unknown>> }>;
      runs: Array<Record<string, unknown>>;
    };
    const definition = preparation.definition;
    const at = '2026-07-10T08:00:00.000Z';
    store.runs = [
      {
        id: 'workflow-run-interrupted',
        tenantId: definition.tenantId,
        userId: definition.userId,
        workflowId: definition.id,
        workflowVersion: definition.version,
        title: definition.title,
        status: 'running',
        trigger: 'manual',
        executionPolicy: definition.executionPolicy,
        confirmation: runOptions().confirmation,
        confirmations: [runOptions().confirmation],
        steps: [
          {
            stepId: definition.steps[0].id,
            capabilityKey: definition.steps[0].capabilityKey,
            title: definition.steps[0].title,
            actionKind: definition.steps[0].actionKind,
            taskType: definition.steps[0].taskType,
            status: 'running',
            attempt: 1,
            transitions: [
              {
                from: 'pending',
                to: 'running',
                at,
                attempt: 1,
                message: '执行器已开始处理。',
              },
            ],
            message: '执行器已开始处理。',
            evidence: [],
            startedAt: at,
          },
        ],
        aggregate: {},
        createdAt: at,
        updatedAt: at,
        startedAt: at,
      },
    ];
    await writeFile(storePath, JSON.stringify(store), 'utf8');

    const reloaded = new AiEmployeeWorkflowService(runtime);
    await reloaded.recoverInterruptedWorkflowRuns();
    const recovered = (await reloaded.listWorkflowSnapshot()).runs[0];

    expect(recovered).toMatchObject({
      id: 'workflow-run-interrupted',
      status: 'failed',
      recovery: { previousStatus: 'running' },
      steps: [
        expect.objectContaining({
          status: 'failed',
          reasonCode: 'runtime_unavailable',
          message: expect.stringContaining('结果无法确认'),
        }),
      ],
    });
    const persisted = JSON.parse(await readFile(storePath, 'utf8')) as {
      runs: Array<{ status: string }>;
    };
    expect(persisted.runs[0].status).toBe('failed');
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('keeps retention limits independent between tenants', async () => {
    const runtime = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const at = '2026-07-10T08:00:00.000Z';
    const makeDefinition = (tenantId: string, userId: string, id: string) => ({
      id,
      tenantId,
      userId,
      version: 1,
      title: id,
      platform: 'douyin',
      config: {},
      status: 'ready',
      steps: [
        {
          id: 'step-1',
          capabilityKey: 'douyin-link-exposure',
          title: '候选读取',
          actionKind: 'candidate_read',
          taskType: 'douyin-link-exposure',
          platform: 'douyin',
          payload: {},
          sendMode: 'draft-only',
          dependencies: [],
          availability: 'available',
          capabilityStatus: 'real',
          message: '可执行',
          nextAction: '启动',
          requiresEvidence: true,
          requiresReadback: true,
        },
      ],
      blockers: [],
      executionPolicy: {
        defaultSendMode: 'auto-send',
        hasCustomerActions: false,
        hasPlatformActions: false,
        requiresConfirmation: false,
      },
      createdAt: at,
      updatedAt: at,
    });
    const makeRun = (tenantId: string, userId: string, id: string) => ({
      id,
      tenantId,
      userId,
      workflowId: `${tenantId}-definition`,
      workflowVersion: 1,
      title: id,
      status: 'failed',
      trigger: 'manual',
      executionPolicy: {
        defaultSendMode: 'auto-send',
        hasCustomerActions: false,
        hasPlatformActions: false,
        requiresConfirmation: false,
      },
      confirmations: [],
      steps: [
        {
          stepId: 'step-1',
          capabilityKey: 'douyin-link-exposure',
          title: '候选读取',
          actionKind: 'candidate_read',
          taskType: 'douyin-link-exposure',
          status: 'failed',
          attempt: 1,
          transitions: [],
          message: '失败',
          evidence: [],
          finishedAt: at,
        },
      ],
      aggregate: {},
      createdAt: at,
      updatedAt: at,
      finishedAt: at,
    });
    const tenantADefinitions = Array.from({ length: 201 }, (_, index) =>
      makeDefinition('tenant-a', 'user-a', `tenant-a-definition-${index}`),
    );
    const tenantARuns = Array.from({ length: 501 }, (_, index) =>
      makeRun('tenant-a', 'user-a', `tenant-a-run-${index}`),
    );
    const tenantBDefinition = makeDefinition(
      'tenant-b',
      'user-b',
      'tenant-b-definition',
    );
    const tenantBRun = makeRun('tenant-b', 'user-b', 'tenant-b-run');
    await writeFile(
      process.env.AI_EMPLOYEE_WORKFLOW_STORE_PATH!,
      JSON.stringify({
        version: 1,
        definitions: [...tenantADefinitions, tenantBDefinition],
        runs: [...tenantARuns, tenantBRun],
      }),
      'utf8',
    );
    const context = new AuthRequestContextService();
    const prisma = {
      system: {
            tenantMember: {
              findFirst: jest.fn(
                async ({ where }: { where: { userId: string } }) => ({
                  tenantId: where.userId === 'user-b' ? 'tenant-b' : 'tenant-a',
                }),
              ),
            },
      },
    };
    const scopedService = new AiEmployeeWorkflowService(
      runtime,
      context,
      prisma as never,
    );

    const snapshot = await context.run({ user: { id: 'user-b' } }, () =>
      scopedService.listWorkflowSnapshot(),
    );
    expect(snapshot.definitions.map((item) => item.id)).toEqual([
      'tenant-b-definition',
    ]);
    expect(snapshot.runs.map((item) => item.id)).toEqual(['tenant-b-run']);
  });

  it('removes markup and secrets from workflow failure messages', async () => {
    const runtime = {
      execute: jest.fn(() =>
        Promise.reject(
          new Error('<script>alert(1)</script> api_key=secret-value failed'),
        ),
      ),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [capability('douyin-link-exposure')];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: 'https://www.douyin.com/video/1',
        },
      },
      capabilities,
    );

    const run = await service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );

    expect(run.steps[0].message).toBe(
      '执行服务暂时不可用，本步骤没有记为完成。',
    );
    expect(run.steps[0].technicalMessage).not.toContain('<script>');
    expect(run.steps[0].technicalMessage).not.toContain('secret-value');
    expect(run.steps[0].technicalMessage).toContain('敏感信息已隐藏');
  });

  it('records cancellation during a running step and does not start later steps', async () => {
    let resolveRuntime: ((value: RuntimeExecutionResult) => void) | undefined;
    const runtimeResult = new Promise<RuntimeExecutionResult>((resolve) => {
      resolveRuntime = resolve;
    });
    const runtime = {
      execute: jest.fn(() => runtimeResult),
    } as unknown as jest.Mocked<RuntimeOrchestrator>;
    const service = new AiEmployeeWorkflowService(runtime);
    const capabilities = [
      capability('video-template-clip'),
      capability('douyin-link-exposure'),
    ];
    const preparation = await service.prepareWorkflow(
      {
        accountId: 'douyin-1',
        workflow: {
          exposureMode: 'link',
          material: '/tmp/input.mp4',
          sourceInputs: ['https://www.douyin.com/video/1'],
          includeVideoClip: true,
        },
      },
      capabilities,
    );

    const runPromise = service.startWorkflowRun(
      preparation.definition.id,
      capabilities,
      runOptions(),
    );
    for (let index = 0; index < 20; index += 1) {
      if (runtime.execute.mock.calls.length) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const running = (await service.listWorkflowSnapshot()).runs[0];
    const cancelling = await service.cancelWorkflowRun(running.id);

    expect(cancelling.status).toBe('cancelling');
    resolveRuntime?.({
      ok: true,
      status: 'success',
      reasonCode: 'success',
      userMessage: '剪辑完成',
      runtime: { mode: 'local-runtime', executor: 'video-template-clip' },
      evidence: [
        {
          type: 'text',
          label: 'video-template-clip-output',
          path: '/tmp/output.mp4',
          value: '/tmp/output.mp4',
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      readback: {
        expectedText: 'output.mp4',
        actualText: '/tmp/output.mp4',
        matched: true,
      },
    });
    const cancelled = await runPromise;

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'video-template-clip',
          status: 'completed',
        }),
        expect.objectContaining({
          stepId: 'douyin-link-candidate-read',
          status: 'cancelled',
        }),
      ]),
    );
    expect(runtime.execute).toHaveBeenCalledTimes(1);
  });
});
