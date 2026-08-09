import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { RiskPolicyService } from '../auth/risk-policy.service';
import { AiEmployeeController } from './ai-employee.controller';
import { AiEmployeeService } from './ai-employee.service';

function batchTouchConfirmation(confirmationId?: string) {
  return {
    confirmed: true,
    confirmedAction: 'batch-touch',
    confirmedRiskLevel: 'high',
    confirmationId,
  };
}

function scheduleEnableConfirmation() {
  return {
    confirmed: true,
    confirmedAction: 'schedule-enable',
    confirmedRiskLevel: 'high',
  };
}

function runtimeControlConfirmation() {
  return {
    confirmed: true,
    confirmedAction: 'runtime-control',
    confirmedRiskLevel: 'high',
  };
}

describe('AiEmployeeController commercial risk gates', () => {
  let app: INestApplication;
  let service: Record<string, jest.Mock>;
  let riskPolicyService: Record<string, jest.Mock>;
  const originalGrowthExecutionEnabled = process.env.GROWTH_EXECUTION_ENABLED;
  const originalLegacyScheduler =
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
  const originalGrowthRealDaemonAllowed =
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;

  beforeEach(async () => {
    process.env.GROWTH_EXECUTION_ENABLED = 'true';
    delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
    delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    let approvalConsumed = false;
    riskPolicyService = {
      issueHighRiskApproval: jest.fn().mockResolvedValue({
        confirmationId: 'approval-1',
        action: 'batch-touch',
        riskLevel: 'high',
        target:
          '历史自动获客配置：后端自动获客 · config-1 · 2026-07-20T00:00:00.000Z',
        expiresAt: '2026-07-20T00:05:00.000Z',
        singleUse: true,
      }),
      checkPolicy: jest.fn().mockResolvedValue({
        allowed: true,
        requireConfirm: true,
      }),
      consumeHighRiskApproval: jest.fn().mockImplementation(async (input) => {
        if (input?.confirmationId !== 'approval-1' || approvalConsumed) {
          throw new BadRequestException(
            input?.confirmationId
              ? '高风险确认已被使用，请重新确认'
              : '确认编号不能为空',
          );
        }
        approvalConsumed = true;
        return {
          ...batchTouchConfirmation('approval-1'),
          operator: 'operator-1',
          confirmedAt: '2026-07-20T00:00:01.000Z',
        };
      }),
    };
    service = {
      getAutoAcquisitionConfig: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'operator-1',
        id: 'config-1',
        taskName: '后端自动获客',
        updatedAt: '2026-07-20T00:00:00.000Z',
      }),
      executeAutoAcquisitionConfig: jest.fn().mockResolvedValue({
        config: { id: 'config-1', status: 'enabled' },
        record: { id: 'record-1', status: 'success' },
      }),
      executeDouyinFollowUp: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        message: 'sent',
        summary: { attemptedCount: 1, successCount: 1, failedCount: 0 },
        results: [],
      }),
      createAutoAcquisitionConfig: jest
        .fn()
        .mockResolvedValue({ id: 'config-1', status: 'enabled' }),
      updateAutoAcquisitionConfigStatus: jest
        .fn()
        .mockResolvedValue({ id: 'config-1', status: 'enabled' }),
      updateAutoAcquisitionConfig: jest
        .fn()
        .mockResolvedValue({ id: 'config-1', status: 'enabled' }),
      listAutoAcquisition: jest.fn().mockResolvedValue({
        configs: [],
        records: [],
        scheduler: { enabled: false, tickMs: 30_000 },
      }),
      getCapabilities: jest.fn().mockResolvedValue({
        checkedAt: '2026-07-09T00:00:00.000Z',
        summary: {
          total: 1,
          real: 0,
          simulated: 1,
          needsConfig: 0,
          unavailable: 0,
          localEngineReady: true,
        },
        capabilities: [
          {
            key: 'douyin-link-exposure',
            domain: 'douyin-acquisition',
            title: '抖音链接曝光',
            platform: 'douyin',
            runtimePath: 'local-runtime-browser',
            routeableNow: true,
            executorTaskType: 'douyin-link-exposure',
            status: 'simulated',
            riskLevel: 'medium',
            executionMode: 'simulated',
            message: '可创建安全预演任务',
            nextAction: '接入核心任务页面',
            acceptance: [],
            blockers: [],
          },
        ],
      }),
      createDryRunTask: jest.fn().mockResolvedValue({
        taskType: 'exposure.link',
        executionMode: 'simulated',
        displayStatus: 'waiting_confirmation',
        capabilityKey: 'douyin-link-exposure',
        nextAction: '请到“待我确认”确认后继续执行。',
        session: {
          id: 'session-1',
          title: '链接曝光预演任务',
          status: 'waiting_for_confirmation',
          events: [],
          confirmations: [{ id: 'confirmation-1', status: 'pending' }],
        },
      }),
      prepareWorkflow: jest.fn().mockResolvedValue({
        taskType: 'workflow.auto',
        executionMode: 'configured',
        displayStatus: 'ready',
        message: '工作流已保存，可以启动。',
        nextAction: '可以启动可执行步骤。',
        definition: {
          id: 'workflow-1',
          title: '每日内容分发与曝光',
          status: 'ready',
          executionPolicy: {
            hasCustomerActions: false,
            hasPlatformActions: false,
            requiresConfirmation: false,
          },
          steps: [],
          blockers: [],
        },
        steps: [],
        blockers: [],
      }),
      listWorkflows: jest.fn().mockResolvedValue({
        definitions: [],
        runs: [],
      }),
      getWorkflowRun: jest.fn().mockResolvedValue({
        id: 'workflow-run-1',
        workflowId: 'workflow-1',
        status: 'failed',
      }),
      refreshWorkflowDefinition: jest.fn().mockResolvedValue({
        id: 'workflow-1',
        title: '每日内容分发与曝光',
        executionPolicy: {
          hasCustomerActions: false,
          hasPlatformActions: false,
          requiresConfirmation: false,
        },
      }),
      getWorkflowRunDefinition: jest.fn().mockResolvedValue({
        id: 'workflow-1',
        title: '每日内容分发与曝光',
        executionPolicy: {
          hasCustomerActions: false,
          hasPlatformActions: false,
          requiresConfirmation: false,
        },
      }),
      startWorkflowRun: jest.fn().mockResolvedValue({
        id: 'workflow-run-1',
        status: 'completed',
        aggregate: { completedSteps: 1, evidenceCount: 1 },
      }),
      retryWorkflowRun: jest.fn().mockResolvedValue({
        id: 'workflow-run-1',
        status: 'completed',
        aggregate: { completedSteps: 1, evidenceCount: 1 },
      }),
      cancelWorkflowRun: jest.fn().mockResolvedValue({
        id: 'workflow-run-1',
        status: 'cancelled',
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AiEmployeeController],
      providers: [
        { provide: AiEmployeeService, useValue: service },
        { provide: RiskPolicyService, useValue: riskPolicyService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, {
        authSessionId: 'session-1',
        authUser: {
          id: 'operator-1',
          name: '测试操作员',
          role: 'user',
          kaypalPlan: 'PRO',
          kaypalPlatformRole: null,
        },
      });
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    if (originalGrowthExecutionEnabled === undefined) {
      delete process.env.GROWTH_EXECUTION_ENABLED;
    } else {
      process.env.GROWTH_EXECUTION_ENABLED = originalGrowthExecutionEnabled;
    }
    if (originalLegacyScheduler === undefined) {
      delete process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER;
    } else {
      process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER =
        originalLegacyScheduler;
    }
    if (originalGrowthRealDaemonAllowed === undefined) {
      delete process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED;
    } else {
      process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED =
        originalGrowthRealDaemonAllowed;
    }
  });

  it('blocks legacy auto acquisition manual execution without batch-touch confirmation', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition/config-1/execute')
      .send({})
      .expect(400);

    expect(response.body.message).toContain('确认编号不能为空');
    expect(service.executeAutoAcquisitionConfig).not.toHaveBeenCalled();
  });

  it('exposes the core capability snapshot without triggering execution', async () => {
    const response = await request(app.getHttpServer())
      .get('/ai-employee/capabilities')
      .expect(200);

    expect(response.body.summary).toMatchObject({
      total: 1,
      simulated: 1,
      localEngineReady: true,
    });
    expect(response.body.capabilities[0]).toMatchObject({
      key: 'douyin-link-exposure',
      status: 'simulated',
      executionMode: 'simulated',
    });
    expect(service.getCapabilities).toHaveBeenCalledTimes(1);
    expect(service.executeAutoAcquisitionConfig).not.toHaveBeenCalled();
    expect(service.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('creates a core dry-run task through the backend task chain', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/tasks/dry-run')
      .send({
        type: 'exposure.link',
        title: '链接曝光预演任务',
        payload: { links: ['https://example.com/video'] },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      taskType: 'exposure.link',
      executionMode: 'simulated',
      displayStatus: 'waiting_confirmation',
      capabilityKey: 'douyin-link-exposure',
      session: {
        id: 'session-1',
        status: 'waiting_for_confirmation',
      },
    });
    expect(service.createDryRunTask).toHaveBeenCalledWith({
      type: 'exposure.link',
      title: '链接曝光预演任务',
      payload: { links: ['https://example.com/video'] },
    });
    expect(service.executeAutoAcquisitionConfig).not.toHaveBeenCalled();
    expect(service.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('persists an automatic workflow definition without starting a run', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/workflows/prepare')
      .send({
        title: '每日内容分发与曝光',
        accountId: 'douyin-1',
        workflow: { platform: 'douyin' },
      })
      .expect(201);

    expect(response.body).toMatchObject({
      taskType: 'workflow.auto',
      executionMode: 'configured',
      displayStatus: 'ready',
      message: '工作流已保存，可以启动。',
      definition: { id: 'workflow-1', status: 'ready' },
    });
    expect(service.prepareWorkflow).toHaveBeenCalledWith({
      title: '每日内容分发与曝光',
      accountId: 'douyin-1',
      workflow: { platform: 'douyin' },
    });
    expect(service.createDryRunTask).not.toHaveBeenCalled();
    expect(service.executeAutoAcquisitionConfig).not.toHaveBeenCalled();
    expect(service.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before starting a candidate-read workflow', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/workflows/workflow-1/runs')
      .send({})
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(service.startWorkflowRun).not.toHaveBeenCalled();
  });

  it('starts a candidate-read workflow with auditable confirmation metadata', async () => {
    await request(app.getHttpServer())
      .post('/ai-employee/workflows/workflow-1/runs')
      .send({ riskConfirmation: runtimeControlConfirmation() })
      .expect(201);

    expect(service.startWorkflowRun).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        externalActionsAuthorized: false,
        confirmation: expect.objectContaining({
          action: 'runtime-control',
          source: 'manual',
          auditId: expect.any(String),
          confirmationId: expect.any(String),
          confirmedAt: expect.any(String),
        }),
      }),
    );
  });

  it('requires runtime confirmation before starting a customer-action workflow', async () => {
    service.refreshWorkflowDefinition.mockResolvedValueOnce({
      id: 'workflow-1',
      title: '客户跟进工作流',
      executionPolicy: {
        hasCustomerActions: true,
        hasPlatformActions: false,
        requiresConfirmation: true,
      },
    });

    const response = await request(app.getHttpServer())
      .post('/ai-employee/workflows/workflow-1/runs')
      .send({})
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(service.startWorkflowRun).not.toHaveBeenCalled();
  });

  it('authorizes a customer-action workflow only after runtime confirmation', async () => {
    service.refreshWorkflowDefinition.mockResolvedValueOnce({
      id: 'workflow-1',
      title: '客户跟进工作流',
      executionPolicy: {
        hasCustomerActions: true,
        hasPlatformActions: false,
        requiresConfirmation: true,
      },
    });

    await request(app.getHttpServer())
      .post('/ai-employee/workflows/workflow-1/runs')
      .send({ riskConfirmation: runtimeControlConfirmation() })
      .expect(201);

    expect(service.startWorkflowRun).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        externalActionsAuthorized: true,
        confirmation: expect.objectContaining({ source: 'manual' }),
      }),
    );
  });

  it('requires explicit confirmation before retrying a workflow', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/workflows/runs/workflow-run-1/retry')
      .send({ stepIds: ['douyin-link-candidate-read'] })
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(service.retryWorkflowRun).not.toHaveBeenCalled();
  });

  it('exposes retry and cancel workflow contracts', async () => {
    await request(app.getHttpServer())
      .post('/ai-employee/workflows/runs/workflow-run-1/retry')
      .send({
        stepIds: ['douyin-link-candidate-read'],
        riskConfirmation: runtimeControlConfirmation(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/ai-employee/workflows/runs/workflow-run-1/cancel')
      .send({})
      .expect(201);

    expect(service.retryWorkflowRun).toHaveBeenCalledWith(
      'workflow-run-1',
      { stepIds: ['douyin-link-candidate-read'] },
      expect.objectContaining({
        externalActionsAuthorized: false,
        confirmation: expect.objectContaining({ source: 'retry' }),
      }),
    );
    expect(service.cancelWorkflowRun).toHaveBeenCalledWith('workflow-run-1');
  });

  it('allows legacy auto acquisition manual execution only after batch-touch confirmation', async () => {
    const approval = await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition/config-1/execute/confirmations')
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition/config-1/execute')
      .send({
        riskConfirmation: batchTouchConfirmation(approval.body.confirmationId),
      })
      .expect(201);

    expect(riskPolicyService.issueHighRiskApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'batch-touch',
        riskLevel: 'high',
        target:
          '历史自动获客配置：后端自动获客 · config-1 · 2026-07-20T00:00:00.000Z',
      }),
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'operator-1',
        sessionId: 'session-1',
      }),
    );
    expect(service.executeAutoAcquisitionConfig).toHaveBeenCalledWith(
      'config-1',
      'manual',
      '2026-07-20T00:00:00.000Z',
    );
  });

  it('rejects replaying an auto acquisition execution confirmation', async () => {
    const riskConfirmation = batchTouchConfirmation('approval-1');

    await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition/config-1/execute')
      .send({ riskConfirmation })
      .expect(201);
    await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition/config-1/execute')
      .send({ riskConfirmation })
      .expect(400);

    expect(service.executeAutoAcquisitionConfig).toHaveBeenCalledTimes(1);
  });

  it('blocks direct Douyin follow-up execution without confirmation', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-employee/douyin/follow-up-execute')
      .send({ accountId: 'douyin-1', targets: [{ text: '想装修' }] })
      .expect(400);

    expect(response.body.message).toContain('后端风控要求人工确认');
    expect(service.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('blocks real touch even with confirmation when the global execution switch is off', async () => {
    delete process.env.GROWTH_EXECUTION_ENABLED;

    const response = await request(app.getHttpServer())
      .post('/ai-employee/douyin/follow-up-execute')
      .send({
        accountId: 'douyin-1',
        targets: [{ text: '想装修' }],
        riskConfirmation: batchTouchConfirmation(),
      })
      .expect(400);

    expect(response.body.message).toContain('真实触达总开关未开启');
    expect(service.executeDouyinFollowUp).not.toHaveBeenCalled();
  });

  it('requires schedule-enable confirmation when the legacy scheduler is armed', async () => {
    process.env.AI_EMPLOYEE_AUTO_ACQUISITION_SCHEDULER = 'true';
    process.env.GROWTH_SCHEDULER_REAL_DAEMON_ALLOWED = 'true';

    await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition')
      .send({ accountId: 'douyin-1', searchKeywords: '装修', enabled: true })
      .expect(400);

    await request(app.getHttpServer())
      .post('/ai-employee/auto-acquisition')
      .send({
        accountId: 'douyin-1',
        searchKeywords: '装修',
        enabled: true,
        riskConfirmation: scheduleEnableConfirmation(),
      })
      .expect(201);

    expect(service.createAutoAcquisitionConfig).toHaveBeenCalledTimes(1);
  });
});
