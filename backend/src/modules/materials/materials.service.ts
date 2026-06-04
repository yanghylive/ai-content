import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { QueryMaterialDto } from './dto/query-material.dto';
import { Prisma } from '@prisma/client';
import { RssCrawlerService } from './crawlers/rss.crawler';
import { CrawlProcessor } from './processors/crawl.processor';

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
    private crawlProcessor: CrawlProcessor,
    private rssCrawler: RssCrawlerService,
  ) { }

  // 分页查询素材列表
  async findAll(query: QueryMaterialDto) {
    const { page = 1, limit = 20, keyword, status, platform, sortBy = 'collectDate', sortOrder = 'desc' } = query;

    const where: Prisma.MaterialWhereInput = {};

    if (keyword) {
      where.title = { contains: keyword };
    }
    if (status) {
      where.status = status;
    }
    if (platform) {
      where.platform = platform;
    }

    // 映射前端字段名到数据库字段名
    const sortFieldMap: Record<string, string> = {
      collectDate: 'collectDate',
      publishDate: 'publishDate',
      title: 'title',
      platform: 'platform',
    };
    const orderField = sortFieldMap[sortBy] || 'collectDate';

    const [items, total] = await Promise.all([
      this.prisma.material.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { [orderField]: sortOrder },
      }),
      this.prisma.material.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // 获取单个素材
  async findOne(id: string) {
    const material = await this.prisma.material.findUnique({ where: { id } });
    if (!material) throw new NotFoundException('素材不存在');
    return material;
  }

  // 删除素材
  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.material.delete({ where: { id } });
  }

  // 批量删除
  async batchRemove(ids: string[]) {
    const result = await this.prisma.material.deleteMany({
      where: { id: { in: ids } },
    });
    return { deleted: result.count };
  }

  // 触发采集任务
  async triggerCollect(
    sourceIds?: string[],
    options?: {
      riskConfirmation?: {
        confirmed: boolean;
        confirmedAction?: string;
        confirmedRiskLevel?: string;
        operator?: string;
      };
    },
  ) {
    // 查询启用的信息源
    const where: Prisma.SourceWhereInput = { enabled: true };
    if (sourceIds && sourceIds.length > 0) {
      where.id = { in: sourceIds };
    }

    const sources = await this.prisma.source.findMany({ where });

    if (sources.length === 0) {
      return { jobCount: 0, message: '没有已启用的信息源，请先在设置中添加或启用信息源' };
    }

    const jobIds: string[] = [];
    for (const source of sources) {
      const sourceConfig = (source.config || {}) as Record<string, unknown>;
      const payload = {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceType: source.type,
        platform: sourceConfig.platform || source.name,
        config: {
          ...sourceConfig,
          sourceName: source.name,
        },
      };

      const jobId = `local-${source.id}-${Date.now()}`;
      jobIds.push(jobId);
      await this.crawlProcessor.process(payload);

      await this.prisma.source.update({
        where: { id: source.id },
        data: { lastCrawlTime: new Date() },
      });
    }

    this.logger.log(`已执行 ${sources.length} 个本地采集任务`);
    await this.systemLogsService.record(`🚀 启动了基于 ${sources.length} 个平台的爬虫采集任务`, 'info');
    const response: any = {
      jobCount: sources.length,
      jobIds,
      message: '采集任务已启动',
    };

    if (options?.riskConfirmation?.confirmed) {
      response.riskAudit = {
        action: options.riskConfirmation.confirmedAction || 'remote-collect',
        status: 'allowed',
        confirmationRecord: {
          operator: options.riskConfirmation.operator,
          confirmedRiskLevel: options.riskConfirmation.confirmedRiskLevel,
        },
      };
    }

    return response;
  }

  async getCollectStatus(jobIds?: string[]) {
    const normalizedCounts = {
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 0,
      paused: 0,
    };

    return {
      active: false,
      pendingCount: 0,
      counts: normalizedCounts,
      activeJobs: [],
      waitingJobs: [],
      recentJobs: [],
      trackedJobs: (jobIds || []).map((id) => ({
        id,
        state: 'completed',
        sourceName: '本地采集任务',
        platform: null,
        attemptsMade: 1,
        progress: 100,
        failedReason: null,
        processedOn: null,
        finishedOn: null,
        timestamp: null,
        result: null,
      })),
      checkedAt: new Date().toISOString(),
    };
  }

  // 素材统计
  async getStats() {
    const [total, unmined, mined, failed] = await Promise.all([
      this.prisma.material.count(),
      this.prisma.material.count({ where: { status: 'unmined' } }),
      this.prisma.material.count({ where: { status: 'mined' } }),
      this.prisma.material.count({ where: { status: 'failed' } }),
    ]);

    // 按平台统计
    const byPlatform = await this.prisma.material.groupBy({
      by: ['platform'],
      _count: { id: true },
    });

    return {
      total,
      unmined,
      mined,
      failed,
      byPlatform: byPlatform.map((p) => ({
        platform: p.platform,
        count: p._count.id,
      })),
    };
  }

  // 为指定素材补齐真实图片，供文章生成前兜底使用
  async ensureImagesForMaterials(materialIds: string[]) {
    return this.rssCrawler.extractImagesForMaterialIds(materialIds);
  }

}
