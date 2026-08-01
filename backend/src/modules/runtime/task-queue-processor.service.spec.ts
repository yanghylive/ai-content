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
      listTasks: jest.fn(async () => [
        {
          id: 'task-1',
          type: 'douyin-comment-reply',
          status: 'queued',
          executionMode: 'internal-record',
          createdAt: new Date().toISOString(),
        },
      ]),
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
    const processor = new TaskQueueProcessor(
      config,
      orchestrator as never,
      engine as never,
    );

    await processor['tick']();

    expect(engine.getTask).toHaveBeenCalledWith('task-1');
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
});
