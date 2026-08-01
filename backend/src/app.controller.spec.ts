import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentWakerService } from './modules/agentwaker/agentwaker.service';
import { PrismaService } from './prisma/prisma.service';

jest.mock('marked', () => ({
  marked: { parse: jest.fn((markdown: string) => `<p>${markdown}</p>`) },
}));

describe('AppController', () => {
  let appController: AppController;

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
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
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
          service: 'ai-content-backend',
          timestamp: expect.any(String),
          checks: expect.objectContaining({
            database: expect.objectContaining({ ok: true }),
            agentWaker: expect.objectContaining({ ok: true }),
            growthExecution: expect.objectContaining({
              enabled: expect.any(Boolean),
            }),
            taskQueue: expect.objectContaining({
              enabled: expect.any(Boolean),
            }),
          }),
        }),
      );
    });

    it('keeps readiness healthy while unattended growth execution is safely disabled', async () => {
      const previous = process.env.GROWTH_EXECUTION_ENABLED;
      delete process.env.GROWTH_EXECUTION_ENABLED;

      try {
        await expect(appController.getReadiness()).resolves.toMatchObject({
          ready: true,
          checks: {
            growthExecution: expect.objectContaining({
              enabled: false,
              safetyStatus: 'closed',
            }),
          },
        });
      } finally {
        if (previous === undefined) {
          delete process.env.GROWTH_EXECUTION_ENABLED;
        } else {
          process.env.GROWTH_EXECUTION_ENABLED = previous;
        }
      }
    });
  });
});
