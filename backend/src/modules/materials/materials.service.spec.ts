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

  it('allows material deletion without confirmation', async () => {
    prisma.material.findUnique.mockResolvedValue({ id: 'material-1' });
    prisma.material.delete.mockResolvedValue({ id: 'material-1' });

    const result = await service.remove('material-1');

    expect(result).toEqual(expect.objectContaining({ id: 'material-1' }));
    expect(prisma.material.findUnique).toHaveBeenCalled();
    expect(prisma.material.delete).toHaveBeenCalled();
  });

  it('allows batch material deletion without confirmation', async () => {
    prisma.material.deleteMany.mockResolvedValue({ count: 2 });

    const result = await service.batchRemove(['material-1', 'material-2']);

    expect(result).toEqual(expect.objectContaining({ deleted: 2 }));
    expect(prisma.material.deleteMany).toHaveBeenCalled();
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
