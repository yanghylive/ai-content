import { AuthRequestContextService } from '../../../common/auth-request-context.service';
import type { RuntimeExecutionResult } from '../executor.interface';
import { EvidenceService } from './evidence.service';

function makeResult(
  overrides: Partial<RuntimeExecutionResult> = {},
): RuntimeExecutionResult {
  return {
    ok: true,
    status: 'success',
    reasonCode: 'success',
    userMessage: 'test success',
    technicalMessage: 'ok',
    runtime: {
      mode: 'agent-s',
      executor: 'desktop-agent-s',
      agentSSessionId: 'session-1',
    },
    evidence: [
      {
        type: 'agent-s-action-log',
        label: 'test',
        value: 'events',
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    tenantMember: {
      findFirst: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
    },
    interactionTask: {
      findFirst: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    },
    agentSession: {
      findFirst: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        userId: 'user-1',
      }),
    },
    runtimeExecution: {
      create: jest.fn().mockResolvedValue({ id: 'exec-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

describe('EvidenceService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let context: { get: jest.Mock };
  let service: EvidenceService;

  beforeEach(() => {
    prisma = makePrismaMock();
    context = {
      get: jest.fn(() => ({ user: { id: 'user-1' } })),
    };
    service = new EvidenceService(
      prisma as never,
      context as unknown as AuthRequestContextService,
    );
  });

  it('persists evidence with the owner scope of the related task', async () => {
    const outcome = await service.recordExecution(
      {
        relatedId: 'task-1',
        relatedType: 'interaction-task',
        platform: 'wechat-desktop',
        taskType: 'wechat-reply-draft',
        accountId: 1,
      },
      makeResult(),
    );

    expect(outcome).toEqual(
      expect.objectContaining({ status: 'persisted', executionId: 'exec-1' }),
    );
    expect(prisma.interactionTask.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      select: { tenantId: true, userId: true },
    });
    expect(prisma.runtimeExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        relatedId: 'task-1',
        accountId: '1',
        executor: 'agent-s',
      }),
    });
  });

  it('rejects a related id outside the current tenant user scope', async () => {
    prisma.interactionTask.findFirst.mockResolvedValue(null);

    const outcome = await service.recordExecution(
      {
        relatedId: 'other-tenant-task',
        relatedType: 'interaction-task',
        platform: 'douyin',
        taskType: 'douyin-comment-reply',
      },
      makeResult(),
    );

    expect(outcome).toEqual({
      status: 'invalid',
      reason: '关联任务不存在或不属于当前租户用户',
    });
    expect(prisma.runtimeExecution.create).not.toHaveBeenCalled();
  });

  it('derives background execution ownership from the stored agent session', async () => {
    context.get.mockReturnValue(undefined);
    prisma.agentSession.findFirst.mockResolvedValue({
      tenantId: 'tenant-background',
      userId: 'user-background',
    });

    await service.recordExecution(
      {
        relatedId: 'agent-session-1',
        relatedType: 'agent-session',
        platform: 'wechat-desktop',
        taskType: 'wechat-reply-draft',
      },
      makeResult(),
    );

    expect(prisma.agentSession.findFirst).toHaveBeenCalledWith({
      where: { id: 'agent-session-1' },
      select: { tenantId: true, userId: true },
    });
    expect(prisma.runtimeExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-background',
        userId: 'user-background',
      }),
    });
  });

  it('returns failed without throwing when persistence fails', async () => {
    prisma.runtimeExecution.create.mockRejectedValue(
      new Error('DB connection lost'),
    );

    const outcome = await service.recordExecution(
      {
        relatedId: 'task-1',
        relatedType: 'interaction-task',
        platform: 'douyin',
        taskType: 'douyin-comment-reply',
      },
      makeResult(),
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('DB connection lost'),
      }),
    );
  });

  it('keeps fire-and-forget evidence scoped', async () => {
    service.recordExecutionFireAndForget(
      {
        relatedId: 'task-1',
        relatedType: 'interaction-task',
        platform: 'douyin',
        taskType: 'douyin-comment-reply',
      },
      makeResult(),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.runtimeExecution.create).toHaveBeenCalledTimes(1);
  });

  it('lists evidence only inside the current tenant and user', async () => {
    prisma.runtimeExecution.findMany.mockResolvedValue([
      {
        id: 'exec-1',
        executor: 'agent-s',
        status: 'success',
        reasonCode: 'success',
        createdAt: new Date('2026-06-03T10:00:00Z'),
      },
    ]);

    const rows = await service.listByRelatedId('task-1', 500);

    expect(rows).toHaveLength(1);
    expect(prisma.runtimeExecution.findMany).toHaveBeenCalledWith({
      where: {
        relatedId: 'task-1',
        tenantId: 'tenant-1',
        userId: 'user-1',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        executor: true,
        status: true,
        reasonCode: true,
        createdAt: true,
      },
    });
  });

  it('requires authentication for evidence queries', async () => {
    context.get.mockReturnValue(undefined);

    await expect(service.listByRelatedId('task-1')).rejects.toThrow(
      '请先登录后查看执行证据',
    );
    expect(prisma.runtimeExecution.findMany).not.toHaveBeenCalled();
  });
});
