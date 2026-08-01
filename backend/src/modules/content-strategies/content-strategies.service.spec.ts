import { PrismaService } from '../../prisma/prisma.service';
import { ContentStrategiesService } from './content-strategies.service';

describe('ContentStrategiesService risk gates', () => {
  let service: ContentStrategiesService;
  let prisma: {
    contentStrategy: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      contentStrategy: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    service = new ContentStrategiesService(prisma as unknown as PrismaService);
  });

  it('allows strategy deletion without confirmation', async () => {
    prisma.contentStrategy.findUnique.mockResolvedValue({
      id: 'strategy-1',
      isDefault: false,
    });
    prisma.contentStrategy.delete.mockResolvedValue({
      id: 'strategy-1',
      name: '测试策略',
    });

    const result = await service.remove('strategy-1');

    expect(result).toEqual(expect.objectContaining({ id: 'strategy-1' }));
    expect(prisma.contentStrategy.findUnique).toHaveBeenCalled();
    expect(prisma.contentStrategy.delete).toHaveBeenCalled();
  });

  it('allows default strategy changes without confirmation', async () => {
    prisma.contentStrategy.findUnique.mockResolvedValue({
      id: 'strategy-1',
      enabled: true,
    });
    prisma.contentStrategy.updateMany.mockResolvedValue({ count: 1 });
    prisma.contentStrategy.update.mockResolvedValue({
      id: 'strategy-1',
      isDefault: true,
    });
    prisma.$transaction.mockResolvedValue([
      { count: 1 },
      { id: 'strategy-1', isDefault: true },
    ]);

    const result = await service.setDefault('strategy-1');

    expect(result).toEqual([
      { count: 1 },
      { id: 'strategy-1', isDefault: true },
    ]);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('ignores legacy confirmation metadata and returns the deleted strategy', async () => {
    prisma.contentStrategy.findUnique.mockResolvedValue({
      id: 'strategy-1',
      isDefault: false,
    });
    prisma.contentStrategy.delete.mockResolvedValue({
      id: 'strategy-1',
      name: '测试策略',
    });

    const result = await service.remove('strategy-1', {
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'strategy-delete',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'strategy-1',
        name: '测试策略',
      }),
    );
    expect(prisma.contentStrategy.delete).toHaveBeenCalledWith({
      where: { id: 'strategy-1' },
    });
  });
});
