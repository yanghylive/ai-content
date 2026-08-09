// 统一采集结果接口（复用 rss.crawler.ts 的 CrawlResult）
export type { CrawlResult } from './rss.crawler';

// 采集器接口
export interface ICrawler {
  crawl(
    url: string,
    config?: Record<string, unknown>,
  ): Promise<import('./rss.crawler').CrawlResult[]>;
}
