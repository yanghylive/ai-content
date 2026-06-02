import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import { QueryMaterialDto } from './dto/query-material.dto';
import { Prisma } from '@prisma/client';
import { RssCrawlerService } from './crawlers/rss.crawler';

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
    @InjectQueue('crawl-queue') private crawlQueue: Queue,
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
  async triggerCollect(sourceIds?: string[]) {
    // 查询启用的信息源
    const where: Prisma.SourceWhereInput = { enabled: true };
    if (sourceIds && sourceIds.length > 0) {
      where.id = { in: sourceIds };
    }

    const sources = await this.prisma.source.findMany({ where });

    if (sources.length === 0) {
      return { jobCount: 0, message: '没有已启用的信息源，请先在设置中添加或启用信息源' };
    }

    for (const source of sources) {
      await this.crawlQueue.add('crawl', {
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceType: source.type,
        platform: (source.config as any)?.platform || source.name,
        config: source.config,
      });

      await this.prisma.source.update({
        where: { id: source.id },
        data: { lastCrawlTime: new Date() },
      });
    }

    this.logger.log(`已添加 ${sources.length} 个采集任务到队列`);
    await this.systemLogsService.record(`🚀 启动了基于 ${sources.length} 个平台的爬虫采集任务`, 'info');
    return { jobCount: sources.length, message: '采集任务已启动' };
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
