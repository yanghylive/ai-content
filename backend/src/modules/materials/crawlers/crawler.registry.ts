import { Injectable, Logger } from '@nestjs/common';
import { ICrawler } from './base.crawler';
import { AibaseCrawler } from './aibase.crawler';
import { GithubCrawler } from './github.crawler';
import { GrokCrawler } from './grok.crawler';
import { HackerNewsCrawler } from './hackernews.crawler';
import { HubtodayCrawler } from './hubtoday.crawler';
import { JuejinCrawler } from './juejin.crawler';
import { Kr36Crawler } from './kr36.crawler';
import { TophubCrawler } from './tophub.crawler';
import { V2exCrawler } from './v2ex.crawler';
import { LocalServiceCrawler } from './local-service.crawler';

// 采集器注册中心
// 根据平台名称返回对应的采集器实例
@Injectable()
export class CrawlerRegistry {
  private readonly logger = new Logger(CrawlerRegistry.name);
  private readonly crawlerMap: Map<string, ICrawler>;

  constructor(
    private readonly aibaseCrawler: AibaseCrawler,
    private readonly githubCrawler: GithubCrawler,
    private readonly grokCrawler: GrokCrawler,
    private readonly hackerNewsCrawler: HackerNewsCrawler,
    private readonly hubtodayCrawler: HubtodayCrawler,
    private readonly juejinCrawler: JuejinCrawler,
    private readonly kr36Crawler: Kr36Crawler,
    private readonly tophubCrawler: TophubCrawler,
    private readonly v2exCrawler: V2exCrawler,
    private readonly localServiceCrawler: LocalServiceCrawler,
  ) {
    // 初始化平台名称到采集器的映射
    this.crawlerMap = new Map<string, ICrawler>([
      ['Aibase', this.aibaseCrawler],
      ['GitHub', this.githubCrawler],
      ['X/Twitter', this.grokCrawler],
      ['HackerNews', this.hackerNewsCrawler],
      ['HubToday', this.hubtodayCrawler],
      ['Juejin', this.juejinCrawler],
      ['36Kr', this.kr36Crawler],
      ['Tophub', this.tophubCrawler],
      ['V2EX', this.v2exCrawler],
      ['DouyinLocal', this.localServiceCrawler],
      ['XiaohongshuLocal', this.localServiceCrawler],
      ['DianpingService', this.localServiceCrawler],
      ['BaiduLife', this.localServiceCrawler],
    ]);
  }

  // 根据平台名称获取对应的采集器
  // RSS 等其他平台返回 null，由 CrawlProcessor 用现有 RssCrawler 处理
  getCrawler(platform: string): ICrawler | null {
    const crawler = this.crawlerMap.get(platform);
    if (!crawler) {
      this.logger.debug(
        `未找到平台 "${platform}" 的专用采集器，将回退到默认处理`,
      );
      return null;
    }
    return crawler;
  }

  // 获取所有已注册的平台名称
  getRegisteredPlatforms(): string[] {
    return Array.from(this.crawlerMap.keys());
  }
}
