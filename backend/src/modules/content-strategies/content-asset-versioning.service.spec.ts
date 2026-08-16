import { ContentAssetVersioningService } from './content-asset-versioning.service';

function makeVersioning(overrides: {
  findFirst?: jest.Mock;
  create?: jest.Mock;
  findMany?: jest.Mock;
  findUnique?: jest.Mock;
} = {}) {
  const prisma = {
    contentAssetVersion: {
      findFirst: overrides.findFirst ?? jest.fn(),
      create: overrides.create ?? jest.fn(),
      findMany: overrides.findMany ?? jest.fn(),
      findUnique: overrides.findUnique ?? jest.fn(),
    },
  };
  const service = new ContentAssetVersioningService(prisma as never);
  return { service, prisma };
}

describe('ContentAssetVersioningService', () => {
  it('首次记录写 versionNo=1', async () => {
    const create = jest.fn().mockResolvedValue({});
    const { service, prisma } = makeVersioning({
      findFirst: jest.fn().mockResolvedValue(null),
      create,
    });

    await service.recordVersion({
      assetType: 'style',
      assetId: 'style-1',
      snapshot: { name: '品牌风格', promptTemplate: 'x' },
      changeSummary: '创建风格',
    });

    expect(prisma.contentAssetVersion.findFirst).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNo: 1, assetType: 'style' }),
      }),
    );
  });

  it('版本号递增：已有 v3 则写 v4', async () => {
    const create = jest.fn().mockResolvedValue({});
    const { service } = makeVersioning({
      findFirst: jest
        .fn()
        .mockResolvedValue({ versionNo: 3, snapshot: '{}' }),
      create,
    });

    await service.recordVersion({
      assetType: 'strategy',
      assetId: 's-1',
      snapshot: { name: '新策略' },
      changeSummary: '更新',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ versionNo: 4 }),
      }),
    );
  });

  it('snapshot 与最新版本相同则跳过（幂等，不写新版本）', async () => {
    const create = jest.fn();
    const { service } = makeVersioning({
      findFirst: jest.fn().mockResolvedValue({
        versionNo: 2,
        snapshot: JSON.stringify({ name: '不变' }),
      }),
      create,
    });

    await service.recordVersion({
      assetType: 'style',
      assetId: 'style-1',
      snapshot: { name: '不变' },
      changeSummary: '更新',
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('写入失败不抛异常（记账旁路）', async () => {
    const { service } = makeVersioning({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockRejectedValue(new Error('table missing')),
    });

    await expect(
      service.recordVersion({
        assetType: 'style',
        assetId: 'style-1',
        snapshot: { name: 'x' },
        changeSummary: '创建',
      }),
    ).resolves.toBeUndefined();
  });

  it('listVersions 倒序返回（不含 snapshot 正文）', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'v2', versionNo: 2 },
      { id: 'v1', versionNo: 1 },
    ]);
    const { service, prisma } = makeVersioning({ findMany });

    const result = await service.listVersions('style', 'style-1');

    expect(prisma.contentAssetVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetType: 'style', assetId: 'style-1' },
        orderBy: { versionNo: 'desc' },
      }),
    );
    expect(result).toHaveLength(2);
  });

  it('getSnapshot 解析 JSON 快照', async () => {
    const { service } = makeVersioning({
      findUnique: jest.fn().mockResolvedValue({
        snapshot: JSON.stringify({ name: '旧风格' }),
      }),
    });

    const result = await service.getSnapshot('style', 'style-1', 1);

    expect(result).toEqual({ name: '旧风格' });
  });

  it('getSnapshot 快照损坏时返回 null', async () => {
    const { service } = makeVersioning({
      findUnique: jest.fn().mockResolvedValue({ snapshot: 'not-json' }),
    });

    const result = await service.getSnapshot('style', 'style-1', 1);

    expect(result).toBeNull();
  });
});
