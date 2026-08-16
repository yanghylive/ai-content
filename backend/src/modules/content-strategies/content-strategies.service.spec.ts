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

  it('rollback 恢复快照内容并生成新版本', async () => {
    const versioning = {
      getSnapshot: jest.fn().mockResolvedValue({
        name: '旧策略名',
        targetAudience: '旧受众',
        commercialGoal: '旧目标',
        corePainPoints: '旧痛点',
        writingAngles: '旧角度',
        isDefault: false,
      }),
      recordVersion: jest.fn().mockResolvedValue(undefined),
      listVersions: jest.fn().mockResolvedValue([]),
    };
    const svc = new ContentStrategiesService(
      prisma as unknown as PrismaService,
      versioning as never,
    );
    prisma.contentStrategy.findUnique.mockResolvedValue({
      id: 'strategy-1',
      isDefault: false,
    });
    prisma.contentStrategy.update.mockResolvedValue({
      id: 'strategy-1',
      name: '旧策略名',
      targetAudience: '旧受众',
      commercialGoal: '旧目标',
      corePainPoints: '旧痛点',
      writingAngles: '旧角度',
      toneAndStyle: null,
      description: null,
      industry: '通用',
      isDefault: false,
      enabled: true,
    });

    const result = await svc.rollback('strategy-1', 2);

    expect(versioning.getSnapshot).toHaveBeenCalledWith(
      'strategy',
      'strategy-1',
      2,
    );
    expect(prisma.contentStrategy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'strategy-1' },
        data: expect.objectContaining({ name: '旧策略名' }),
      }),
    );
    // 回滚本身也留痕（生成新版本）
    expect(versioning.recordVersion).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ name: '旧策略名' }));
  });

  it('rollback 到不存在版本抛 404', async () => {
    const versioning = {
      getSnapshot: jest.fn().mockResolvedValue(null),
      recordVersion: jest.fn(),
      listVersions: jest.fn(),
    };
    const svc = new ContentStrategiesService(
      prisma as unknown as PrismaService,
      versioning as never,
    );
    prisma.contentStrategy.findUnique.mockResolvedValue({
      id: 'strategy-1',
      isDefault: false,
    });

    await expect(svc.rollback('strategy-1', 99)).rejects.toThrow();
  });
});
