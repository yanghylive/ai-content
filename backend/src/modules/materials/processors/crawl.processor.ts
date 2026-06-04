import { Injectable, Logger } from '@nestjs/common';
import { CrawlerRegistry } from '../crawlers/crawler.registry';
import { RssCrawlerService } from '../crawlers/rss.crawler';
import { JinaReaderService } from '../crawlers/jina-reader.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SystemLogsService } from '../../system-logs/system-logs.service';

@Injectable()
export class CrawlProcessor {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(
    private crawlerRegistry: CrawlerRegistry,
    private rssCrawler: RssCrawlerService,
    private jinaReader: JinaReaderService,
    private prisma: PrismaService,
    private systemLogsService: SystemLogsService,
  ) {}

  async process(job: { data?: any } & Record<string, any>): Promise<any> {
    const data = job.data || job;
    const { sourceId, sourceName, sourceUrl, sourceType, platform } = data;
    this.logger.log(`开始处理采集任务: ${sourceName} (platform: ${platform})`);

    try {
      let results;

      // 根据 platform 从注册中心获取对应采集器
      const crawler = this.crawlerRegistry.getCrawler(platform);

      if (crawler) {
        // 使用专用采集器
        results = await crawler.crawl(sourceUrl, data.config);
      } else if (sourceType === 'rss') {
        // 回退到 RSS 采集器
        results = await this.rssCrawler.crawl(sourceUrl, platform);
      } else {
        this.logger.warn(`未找到 platform=${platform} 的采集器，跳过`);
        return { sourceName, total: 0, saved: 0 };
      }

      // 保存结果（去重）
      const { savedCount, createdMaterialIds } = await this.rssCrawler.saveResults(results);

      // 可选：对没有 content 的素材用 Jina Reader 提取全文
      // （暂不默认启用，避免大量请求 Jina）

      // 更新信息源的最后采集时间
      if (sourceId) {
        await this.prisma.source.update({
          where: { id: sourceId },
          data: { lastCrawlTime: new Date() },
        });
      }

      this.logger.log(`采集任务完成: ${sourceName}, 获取 ${results.length} 条, 新增 ${savedCount} 条`);
      await this.systemLogsService.record(`✅ 渠道【${sourceName}】采集完成: 共拉取素材 ${results.length} 篇，入库 ${savedCount} 篇`, 'success');

      // 图片补提很慢且依赖外部网页/Jina Reader，不能阻塞采集入库和完成日志。
      this.scheduleImageBackfill(createdMaterialIds);
      return { sourceName, total: results.length, saved: savedCount };
    } catch (error: any) {
      this.logger.error(`采集任务失败: ${sourceName}`, error);
      await this.systemLogsService.record(`❌ 渠道【${sourceName}】采集失败: ${error.message || '未知错误'}`, 'error');
      throw error;
    }
  }

  private scheduleImageBackfill(materialIds: string[]) {
    if (materialIds.length === 0) {
      return;
    }

    void this.rssCrawler
      .extractImagesForMaterialIds(materialIds)
      .then((imageResult) => {
        this.logger.log(`新素材图片补提完成: 处理 ${imageResult.processed} 条，成功 ${imageResult.success} 条`);
      })
      .catch((error: any) => {
        this.logger.warn(`新素材图片补提失败，不影响采集完成: ${error?.message || '未知错误'}`);
      });
  }
}
