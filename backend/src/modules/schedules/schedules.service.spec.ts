import { PrismaService } from '../../prisma/prisma.service';

jest.mock('../publishing/publishing.service', () => ({
  PublishingService: class PublishingService {},
}));

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
    scheduleConfig: { update: jest.Mock };
  };
  let schedulerRegistry: {
	    doesExist: jest.Mock;
	    deleteCronJob: jest.Mock;
	    addCronJob: jest.Mock;
	    getCronJobs: jest.Mock;
	  };
  let cronJobs: Map<string, { stop: jest.Mock }>;

  beforeEach(() => {
    cronJobs = new Map();
    prisma = {
      scheduleConfig: {
        update: jest.fn(),
      },
    };
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
      {} as never,
      {} as never,
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
});
