import { ConfigService } from '@nestjs/config';
import { TaskQueueProcessor } from './task-queue-processor.service';

describe('TaskQueueProcessor billing context', () => {
  it('uses the full stored task billing identity when dispatching queued work', async () => {
    const billingIdentity = {
      sessionId: 'session-1',
      localUserId: 'local-user-1',
      kaypalUserId: 'cloud-user-1',
      kaypalDesktopDeviceId: 'device-1',
      capturedAt: '2026-06-29T00:00:00.000Z',
    };
    const engine = {
      getTask: jest.fn(async () => ({
        id: 'task-1',
        type: 'douyin-comment-reply',
        status: 'queued',
        executionMode: 'internal-record',
        sendMode: 'auto-send',
        sourceText: '客户问价',
        replyText: '您好，可以继续沟通。',
        billingIdentity,
      })),
    };
    const orchestrator = {
      execute: jest.fn(async () => ({
        ok: true,
        status: 'executed',
        message: 'done',
      })),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'TASK_QUEUE_PROCESS_EXISTING' ? 'true' : undefined,
      ),
    } as unknown as ConfigService;
    const prisma = {
      interactionTask: {
        findMany: jest.fn(async () => [
          {
            id: 'task-1',
            tenantId: 'tenant-1',
            userId: 'user-1',
            taskType: 'DOUYIN_COMMENT_REPLY',
            config: {
              type: 'douyin-comment-reply',
              executionMode: 'internal-record',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
    };
    const authRequestContext = {
      run: jest.fn((_context, callback) => callback()),
    };
    const processor = new TaskQueueProcessor(
      config,
      orchestrator as never,
      engine as never,
      prisma as never,
      authRequestContext as never,
    );

    await processor['tick']();

    expect(engine.getTask).toHaveBeenCalledWith('task-1');
    expect(authRequestContext.run).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedTenantId: 'tenant-1',
        user: expect.objectContaining({ id: 'user-1' }),
      }),
      expect.any(Function),
    );
    expect(orchestrator.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedId: 'task-1',
        type: 'douyin-comment-reply',
      }),
      expect.objectContaining({
        billing: {
          scope: 'task-queue',
          identity: billingIdentity,
        },
      }),
    );
  });

  it('reports a persistent queue query failure as unhealthy', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'TASK_QUEUE_TICK_MS' ? '60000' : undefined,
      ),
    } as unknown as ConfigService;
    const processor = new TaskQueueProcessor(
      config,
      { execute: jest.fn() } as never,
      { getTask: jest.fn() } as never,
      {
        interactionTask: {
          findMany: jest.fn(async () => {
            throw new Error('database unavailable');
          }),
        },
      } as never,
      { run: jest.fn() } as never,
    );
    processor.onModuleInit();

    try {
      await expect(processor['tick']()).rejects.toThrow('database unavailable');
      expect(processor.getHealth()).toEqual(
        expect.objectContaining({
          ok: false,
          status: 'unhealthy',
          consecutiveFailures: 1,
          failureReason: 'worker-tick-failed',
        }),
      );
    } finally {
      processor.onModuleDestroy();
    }
  });

  it('records an empty queue poll as a healthy worker heartbeat', async () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'TASK_QUEUE_TICK_MS' ? '60000' : undefined,
      ),
    } as unknown as ConfigService;
    const processor = new TaskQueueProcessor(
      config,
      { execute: jest.fn() } as never,
      { getTask: jest.fn() } as never,
      {
        interactionTask: { findMany: jest.fn(async () => []) },
      } as never,
      { run: jest.fn() } as never,
    );
    processor.onModuleInit();

    try {
      await processor['tick']();
      expect(processor.getHealth()).toEqual(
        expect.objectContaining({
          ok: true,
          status: 'healthy',
          lastSuccessAt: expect.any(String),
          consecutiveFailures: 0,
        }),
      );
    } finally {
      processor.onModuleDestroy();
    }
  });
});
