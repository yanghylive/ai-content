import { PrismaService } from '../../prisma/prisma.service';

jest.mock('cron', () => ({
  CronJob: jest
    .fn()
    .mockImplementation((cronExpr: string, onTick: () => Promise<void>) => ({
      cronExpr,
      onTick,
      start: jest.fn(),
      stop: jest.fn(),
    })),
}));

import { SchedulesService } from './schedules.service';

describe('SchedulesService risk gates', () => {
  let service: SchedulesService;
  let prisma: {
    scheduleConfig: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      upsert: jest.Mock;
    };
    systemLog: { create: jest.Mock };
  };
  let schedulerRegistry: {
    doesExist: jest.Mock;
    deleteCronJob: jest.Mock;
    addCronJob: jest.Mock;
    getCronJobs: jest.Mock;
  };
  let cronJobs: Map<string, { stop: jest.Mock }>;
  let articlesService: { batchGenerateDrafts: jest.Mock };

  beforeEach(() => {
    cronJobs = new Map();
    prisma = {
      scheduleConfig: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      systemLog: { create: jest.fn() },
    };
    articlesService = { batchGenerateDrafts: jest.fn() };
    schedulerRegistry = {
      doesExist: jest.fn((_type: string, name: string) => cronJobs.has(name)),
      deleteCronJob: jest.fn((name: string) => {
        cronJobs.delete(name);
      }),
      addCronJob: jest.fn((name: string, job: { stop: jest.Mock }) => {
        cronJobs.set(name, job);
      }),
      getCronJobs: jest.fn(() => cronJobs),
    };
    service = new SchedulesService(
      prisma as unknown as PrismaService,
      schedulerRegistry as never,
      {} as never,
      {} as never,
      {} as never,
      articlesService as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('allows enabling schedules without confirmation', async () => {
    prisma.scheduleConfig.update.mockResolvedValue({
      taskType: 'collect_materials',
      cronExpr: '0 * * * *',
      enabled: true,
    });

    const result = await service.updateSchedule('collect_materials', {
      cronExpr: '0 * * * *',
      enabled: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        taskType: 'collect_materials',
        enabled: true,
      }),
    );
    expect(prisma.scheduleConfig.update).toHaveBeenCalled();
    expect(schedulerRegistry.addCronJob).toHaveBeenCalled();
  });

  it('does not fail backend startup when default schedule initialization is temporarily unavailable', async () => {
    prisma.scheduleConfig.upsert.mockRejectedValueOnce(
      new Error('Timed out fetching a new connection from the connection pool'),
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(prisma.scheduleConfig.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.scheduleConfig.findMany).not.toHaveBeenCalled();
  });

  it('allows disabling schedules without confirmation', async () => {
    prisma.scheduleConfig.update.mockResolvedValue({
      taskType: 'collect_materials',
      cronExpr: '0 * * * *',
      enabled: false,
    });

    await expect(
      service.updateSchedule('collect_materials', {
        cronExpr: '0 * * * *',
        enabled: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        taskType: 'collect_materials',
        enabled: false,
      }),
    );

    expect(prisma.scheduleConfig.update).toHaveBeenCalledTimes(1);
  });

  it('ignores legacy confirmation metadata and returns the updated schedule config', async () => {
    prisma.scheduleConfig.update.mockResolvedValue({
      taskType: 'collect_materials',
      cronExpr: '0 * * * *',
      enabled: true,
    });

    const result = await service.updateSchedule(
      'collect_materials',
      {
        cronExpr: '0 * * * *',
        enabled: true,
      },
      {
        riskConfirmation: {
          confirmed: true,
          confirmedAction: 'schedule-enable',
          confirmedRiskLevel: 'high',
          operator: '测试用户',
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        taskType: 'collect_materials',
        enabled: true,
        cronExpr: '0 * * * *',
      }),
    );
    expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
  });

  it('keeps scheduled article generation draft-only when legacy autoPublish is enabled', async () => {
    prisma.scheduleConfig.findUnique.mockResolvedValue({
      config: { autoPublish: true, publishAccountId: 'legacy-account' },
    });
    prisma.scheduleConfig.update.mockResolvedValue({});
    prisma.systemLog.create.mockResolvedValue({});
    articlesService.batchGenerateDrafts.mockResolvedValue({
      generatedArticleIds: ['article-1', 'article-2'],
    });

    await (service as any).executeTask('create_articles');

    expect(articlesService.batchGenerateDrafts).toHaveBeenCalledTimes(1);
    expect(prisma.systemLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        level: 'warning',
        content: expect.stringContaining('旧无人值守发布入口已停用'),
      }),
    });
    expect(prisma.scheduleConfig.update).toHaveBeenCalledWith({
      where: { taskType: 'create_articles' },
      data: {
        lastRunTime: expect.any(Date),
        config: { autoPublish: false },
      },
    });
  });
});
