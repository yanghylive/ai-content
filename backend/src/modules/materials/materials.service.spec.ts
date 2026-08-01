import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { MaterialsService } from './materials.service';
import { RssCrawlerService } from './crawlers/rss.crawler';

describe('MaterialsService risk gates', () => {
  let service: MaterialsService;
  let prisma: {
    material: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    source: { findMany: jest.Mock; update: jest.Mock };
  };
  let systemLogsService: { record: jest.Mock };
  let crawlProcessor: { process: jest.Mock };
  let rssCrawler: { extractImagesForMaterialIds: jest.Mock };

  beforeEach(() => {
    prisma = {
      material: {
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      source: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };
    systemLogsService = { record: jest.fn() };
    crawlProcessor = { process: jest.fn() };
    rssCrawler = { extractImagesForMaterialIds: jest.fn() };
    service = new MaterialsService(
      prisma as unknown as PrismaService,
      systemLogsService as unknown as SystemLogsService,
      crawlProcessor as never,
      rssCrawler as unknown as RssCrawlerService,
    );
  });

  it('blocks material deletion without backend risk confirmation', async () => {
    prisma.material.findUnique.mockResolvedValue({ id: 'material-1' });
    prisma.material.delete.mockResolvedValue({ id: 'material-1' });

    await expect(service.remove('material-1')).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.material.findUnique).toHaveBeenCalled();
    expect(prisma.material.delete).not.toHaveBeenCalled();
    expect(systemLogsService.record).not.toHaveBeenCalled();
  });

  it('allows material deletion after backend risk confirmation', async () => {
    prisma.material.findUnique.mockResolvedValue({
      id: 'material-1',
      title: '待删除素材',
    });
    prisma.material.delete.mockResolvedValue({
      id: 'material-1',
      title: '待删除素材',
    });

    const result = await service.remove('material-1', {
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'material-delete',
        confirmedRiskLevel: 'medium',
        operator: '测试用户',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'material-1',
        riskAudit: expect.objectContaining({
          action: 'material-delete',
          status: 'allowed',
          confirmationRecord: expect.objectContaining({
            operator: '测试用户',
            confirmedAction: 'material-delete',
          }),
        }),
      }),
    );
    expect(prisma.material.delete).toHaveBeenCalledWith({
      where: { id: 'material-1' },
    });
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('素材删除已确认'),
      'warning',
    );
  });

  it('blocks material deletion when the confirmation action mismatches', async () => {
    prisma.material.findUnique.mockResolvedValue({
      id: 'material-1',
      title: '待删除素材',
    });

    await expect(
      service.remove('material-1', {
        riskConfirmation: {
          confirmed: true,
          confirmedAction: 'material-batch-delete',
          confirmedRiskLevel: 'medium',
        },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.material.delete).not.toHaveBeenCalled();
    expect(systemLogsService.record).not.toHaveBeenCalled();
  });

  it('blocks batch material deletion without backend risk confirmation', async () => {
    prisma.material.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      service.batchRemove(['material-1', 'material-2']),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.material.deleteMany).not.toHaveBeenCalled();
    expect(systemLogsService.record).not.toHaveBeenCalled();
  });

  it('allows batch material deletion after backend risk confirmation', async () => {
    prisma.material.deleteMany.mockResolvedValue({ count: 2 });

    const result = await service.batchRemove(
      ['material-1', 'material-2', 'material-2'],
      {
        riskConfirmation: {
          confirmed: true,
          confirmedAction: 'material-batch-delete',
          confirmedRiskLevel: 'high',
          operator: '测试用户',
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        deleted: 2,
        requested: 2,
        riskAudit: expect.objectContaining({
          action: 'material-batch-delete',
          status: 'allowed',
          confirmationRecord: expect.objectContaining({
            operator: '测试用户',
            confirmedAction: 'material-batch-delete',
          }),
        }),
      }),
    );
    expect(prisma.material.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['material-1', 'material-2'] } },
    });
    expect(systemLogsService.record).toHaveBeenCalledWith(
      expect.stringContaining('素材批量删除已确认'),
      'warning',
    );
  });

  it('allows remote collection without confirmation', async () => {
    prisma.source.findMany.mockResolvedValue([
      {
        id: 'source-1',
        name: '测试源',
        url: 'https://example.test/rss.xml',
        type: 'rss',
        config: { platform: 'Example' },
      },
    ]);
    prisma.source.update.mockResolvedValue({});
    crawlProcessor.process.mockResolvedValue({});
    systemLogsService.record.mockResolvedValue({});

    const result = await service.triggerCollect(['source-1']);

    expect(result).toEqual(
      expect.objectContaining({
        jobCount: 1,
      }),
    );
    expect(crawlProcessor.process).toHaveBeenCalledTimes(1);
    expect(crawlProcessor.process).toHaveBeenCalledWith({
      sourceId: 'source-1',
      sourceName: '测试源',
      sourceUrl: 'https://example.test/rss.xml',
      sourceType: 'rss',
      platform: 'Example',
      config: {
        platform: 'Example',
        sourceName: '测试源',
      },
    });
  });

  it('queues collection only after confirmation and returns a backend risk audit', async () => {
    prisma.source.findMany.mockResolvedValue([
      {
        id: 'source-1',
        name: '测试源',
        url: 'https://example.test/rss.xml',
        type: 'rss',
        config: { platform: 'Example' },
      },
    ]);
    prisma.source.update.mockResolvedValue({});
    crawlProcessor.process.mockResolvedValue({});
    systemLogsService.record.mockResolvedValue({});

    const result = await service.triggerCollect(['source-1'], {
      riskConfirmation: {
        confirmed: true,
        confirmedAction: 'remote-collect',
        confirmedRiskLevel: 'high',
        operator: '测试用户',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        jobCount: 1,
        riskAudit: expect.objectContaining({
          action: 'remote-collect',
          status: 'allowed',
          confirmationRecord: expect.objectContaining({ operator: '测试用户' }),
        }),
      }),
    );
    expect(crawlProcessor.process).toHaveBeenCalledTimes(1);
    expect(crawlProcessor.process).toHaveBeenCalledWith({
      sourceId: 'source-1',
      sourceName: '测试源',
      sourceUrl: 'https://example.test/rss.xml',
      sourceType: 'rss',
      platform: 'Example',
      config: {
        platform: 'Example',
        sourceName: '测试源',
      },
    });
  });
});
