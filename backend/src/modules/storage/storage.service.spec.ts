import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';

describe('StorageService risk gates', () => {
  let service: StorageService;
  let prisma: {
    systemConfig: { findMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      systemConfig: {
        findMany: jest.fn(),
      },
    };
    service = new StorageService(prisma as unknown as PrismaService);
  });

  it('allows remote storage tests without confirmation', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);

    const result = await service.testConnection();

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
      }),
    );
    expect(prisma.systemConfig.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns an audited config error after confirmation when storage is incomplete', async () => {
    prisma.systemConfig.findMany.mockResolvedValue([]);

    const result = await service.testConnection({
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'storage-remote-test',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        riskAudit: expect.objectContaining({
          action: 'storage-remote-test',
          status: 'allowed',
          confirmationRecord: expect.objectContaining({ operator: '测试用户' }),
        }),
      }),
    );
    expect(prisma.systemConfig.findMany).toHaveBeenCalledTimes(1);
  });
});
