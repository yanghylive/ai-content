import { BadRequestException, ConflictException } from '@nestjs/common';
import { LocalEngineService } from './local-engine.service';

describe('LocalEngineService WeChat resume risk ticket', () => {
  function pausedTask() {
    return {
      id: 'paused-task-1',
      tenantId: 'tenant-a',
      userId: 'user-a',
      type: 'wechat-group-broadcast',
      typeLabel: '微信群发',
      status: 'paused',
      statusLabel: '已暂停',
      accountId: 'local-wechat-desktop',
      accountName: '本机微信',
      platformName: '微信桌面',
      targetName: '客户甲、客户乙',
      sourceText: '测试群发',
      replyText: '默认消息',
      sendMode: 'auto-send',
      riskLevel: 'high',
      safetyBoundary: {
        commercialExecutionAllowed: true,
        requestedCommercialExecution: true,
      },
      runtimeState: 'blocked',
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:01:00.000Z',
      events: [],
      batchTargets: [
        {
          id: 'target-a',
          targetName: '客户甲',
          sourceText: '测试群发',
          replyText: '甲的专属消息',
          status: 'completed',
          updatedAt: '2026-07-12T00:01:00.000Z',
        },
        {
          id: 'target-b',
          targetName: '客户乙',
          sourceText: '测试群发',
          replyText: '乙的专属消息',
          status: 'queued',
          updatedAt: '2026-07-12T00:01:00.000Z',
        },
        {
          id: 'target-c',
          targetName: '客户丙',
          sourceText: '测试群发',
          replyText: '丙的专属消息',
          status: 'failed',
          failureReason: '暂停发生在执行中，发送状态不确定。',
          updatedAt: '2026-07-12T00:01:00.000Z',
        },
      ],
    } as any;
  }

  function serviceHarness() {
    const service = Object.create(LocalEngineService.prototype) as any;
    const task = pausedTask();
    const resumedTask = { ...task, id: 'resumed-task-1', status: 'queued' };
    service.getTask = jest.fn(async () => task);
    service.riskPolicyService = {
      issueHighRiskApproval: jest.fn(async () => ({
        confirmationId: 'resume-ticket-1',
        singleUse: true,
      })),
      consumeHighRiskApproval: jest.fn(async () => ({ confirmed: true })),
    };
    service.authRequestContext = {
      get: jest.fn(() => ({ sessionId: 'session-a', user: { id: 'user-a' } })),
    };
    service.createTask = jest.fn(async () => resumedTask);
    service.pushEvent = jest.fn();
    service.persistTask = jest.fn(async () => undefined);
    return { service, task, resumedTask };
  }

  it('rejects live resume without a server-issued ticket', async () => {
    const { service } = serviceHarness();

    await expect(
      service.resumeTask('paused-task-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      service.riskPolicyService.consumeHighRiskApproval,
    ).not.toHaveBeenCalled();
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('does not let the legacy continue endpoint bypass the resume ticket', async () => {
    const { service } = serviceHarness();

    await expect(service.continueTask('paused-task-1')).rejects.toThrow(
      '不能通过继续接口绕过',
    );
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('binds the issued ticket to the scoped task and remaining-target fingerprint', async () => {
    const { service } = serviceHarness();

    await service.createTaskResumeConfirmation('paused-task-1');

    expect(
      service.riskPolicyService.issueHighRiskApproval,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'interaction-resume',
        riskLevel: 'high',
        target: expect.stringMatching(
          /^wechat-resume:v1:paused-task-1:[a-f0-9]{64}$/,
        ),
      }),
      {
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
        operator: 'user-a',
      },
    );
  });

  it('burns the ticket and refuses dispatch when the task changes after consumption', async () => {
    const { service, task } = serviceHarness();
    service.riskPolicyService.consumeHighRiskApproval.mockImplementation(
      async () => {
        task.batchTargets[1].replyText = '确认后被修改的消息';
        task.updatedAt = '2026-07-12T00:02:00.000Z';
        return { confirmed: true };
      },
    );

    await expect(
      service.resumeTask('paused-task-1', {
        riskConfirmation: { confirmationId: 'resume-ticket-1' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(service.createTask).not.toHaveBeenCalled();
  });

  it('dispatches only explicitly queued targets and never replays completed or uncertain targets', async () => {
    const { service, resumedTask } = serviceHarness();

    const result = await service.resumeTask('paused-task-1', {
      riskConfirmation: { confirmationId: 'resume-ticket-1' },
    });

    expect(result).toBe(resumedTask);
    expect(
      service.riskPolicyService.consumeHighRiskApproval,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationId: 'resume-ticket-1',
        action: 'interaction-resume',
      }),
      expect.objectContaining({
        tenantId: 'tenant-a',
        userId: 'user-a',
        sessionId: 'session-a',
      }),
    );
    expect(service.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        planStatus: undefined,
        batchTargets: [
          expect.objectContaining({
            targetName: '客户乙',
            replyText: '乙的专属消息',
          }),
        ],
      }),
    );
  });

  it('propagates forged, reused, cross-tenant, or cross-session ticket rejection', async () => {
    const { service } = serviceHarness();
    service.riskPolicyService.consumeHighRiskApproval.mockRejectedValue(
      new BadRequestException('高风险确认不存在、已使用或不匹配'),
    );

    await expect(
      service.resumeTask('paused-task-1', {
        riskConfirmation: { confirmationId: 'forged-or-reused-ticket' },
      }),
    ).rejects.toThrow('高风险确认不存在、已使用或不匹配');
    expect(service.createTask).not.toHaveBeenCalled();
  });
});
