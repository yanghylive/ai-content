import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentWakerService } from './modules/agentwaker/agentwaker.service';
import { TaskQueueProcessor } from './modules/runtime/task-queue-processor.service';
import { PrismaService } from './prisma/prisma.service';

jest.mock('marked', () => ({
  marked: { parse: jest.fn((markdown: string) => `<p>${markdown}</p>`) },
}));

describe('AppController', () => {
  let appController: AppController;
  let taskQueueProcessor: TaskQueueProcessor;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
        {
          provide: AgentWakerService,
          useValue: {
            getRolePackageHealth: jest.fn().mockReturnValue({
              ok: true,
              roles: [{ id: 'xiaohongshu-operator', available: true }],
            }),
          },
        },
        {
          provide: TaskQueueProcessor,
          useValue: {
            getHealth: jest.fn().mockReturnValue({
              ok: true,
              enabled: true,
              running: true,
              status: 'healthy',
            }),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    taskQueueProcessor = app.get<TaskQueueProcessor>(TaskQueueProcessor);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('should report runtime health gate inputs', async () => {
      const health = await appController.getHealth();
      expect(health).toEqual(
        expect.objectContaining({
          ok: true,
          ready: true,
          service: 'ai-content-backend',
          timestamp: expect.any(String),
        }),
      );
      // P2-4：health 不再暴露内部运行态（database/growth/taskQueue/agentWaker）
      expect(health).not.toHaveProperty('checks');
    });

    it('keeps readiness healthy while unattended growth execution is safely disabled', async () => {
      const previous = process.env.GROWTH_EXECUTION_ENABLED;
      delete process.env.GROWTH_EXECUTION_ENABLED;

      try {
        await expect(appController.getReadiness()).resolves.toMatchObject({
          ready: true,
        });
      } finally {
        if (previous === undefined) {
          delete process.env.GROWTH_EXECUTION_ENABLED;
        } else {
          process.env.GROWTH_EXECUTION_ENABLED = previous;
        }
      }
    });

    it('blocks readiness when the task queue worker is unhealthy', async () => {
      jest.spyOn(taskQueueProcessor, 'getHealth').mockReturnValue({
        ok: false,
        enabled: true,
        running: true,
        status: 'unhealthy',
      } as ReturnType<TaskQueueProcessor['getHealth']>);

      await expect(appController.getReadiness()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'HEALTH_GATE_BLOCKED' }),
      });
    });
  });
});
