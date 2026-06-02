import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { SourcesService } from './sources.service';

describe('SourcesService risk gates', () => {
  let service: SourcesService;
  let prisma: {
    source: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };
  let systemLogsService: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      source: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    systemLogsService = { record: jest.fn() };
    service = new SourcesService(
      prisma as unknown as PrismaService,
      systemLogsService as unknown as SystemLogsService,
    );
  });

  it('allows source deletion without confirmation', async () => {
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1' });
    prisma.source.delete.mockResolvedValue({ id: 'source-1' });

    const result = await service.remove('source-1');

    expect(result).toEqual(expect.objectContaining({ id: 'source-1' }));
    expect(prisma.source.findUnique).toHaveBeenCalled();
    expect(prisma.source.delete).toHaveBeenCalled();
  });

  it('allows seed without confirmation', async () => {
    prisma.source.deleteMany.mockResolvedValue({ count: 2 });
    prisma.source.findFirst.mockResolvedValue({ id: 'existing-source' });

    const result = await service.seed();

    expect(result).toEqual(
      expect.objectContaining({
        removedLegacy: 2,
      }),
    );
    expect(prisma.source.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('seeds only after confirmation and returns a backend risk audit', async () => {
    prisma.source.deleteMany.mockResolvedValue({ count: 2 });
    prisma.source.findFirst.mockResolvedValue({ id: 'existing-source' });

    const result = await service.seed({
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'source-seed',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        removedLegacy: 2,
        riskAudit: expect.objectContaining({
          action: 'source-seed',
          status: 'allowed',
          confirmationRecord: expect.objectContaining({ operator: '测试用户' }),
        }),
      }),
    );
    expect(prisma.source.deleteMany).toHaveBeenCalledTimes(1);
  });
});
