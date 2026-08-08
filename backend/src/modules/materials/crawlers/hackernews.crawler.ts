import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ICrawler, CrawlResult } from './base.crawler';

// HackerNews Firebase API item 响应结构（https://github.com/HackerNews/API）
interface HackerNewsItem {
  id?: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
}

// HackerNews 热门采集器
@Injectable()
export class HackerNewsCrawler implements ICrawler {
  private readonly logger = new Logger(HackerNewsCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(_url?: string): Promise<CrawlResult[]> {
    this.logger.log('开始采集 HackerNews 热门');

    try {
      // 获取热门故事 ID 列表
      const { data: storyIds } = await axios.get<number[]>(
        'https://hacker-news.firebaseio.com/v0/topstories.json',
        {
          headers: { 'User-Agent': this.USER_AGENT },
          timeout: 30000,
        },
      );

      // 取前 20 个 ID
      const topIds = storyIds.slice(0, 20);
      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 72 小时前的时间戳（秒）
      const cutoffTime = Date.now() / 1000 - 72 * 3600;

      for (const id of topIds) {
        try {
          const { data } = await axios.get<HackerNewsItem | null>(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            {
              headers: { 'User-Agent': this.USER_AGENT },
              timeout: 30000,
            },
          );

          if (!data) continue;

          // 过滤 72 小时前的数据
          if (data.time && data.time < cutoffTime) continue;

          const sourceUrl =
            data.url || `https://news.ycombinator.com/item?id=${id}`;

          // 去重
          if (seenUrls.has(sourceUrl)) continue;
          seenUrls.add(sourceUrl);

          // 标题截断到 500 字符
          const title = (data.title || '').substring(0, 500);
          if (!title) continue;

          results.push({
            title,
            content: data.text || '',
            summary: data.text || '',
            sourceUrl,
            author: data.by || '',
            publishDate: data.time ? new Date(data.time * 1000) : null,
            platform: 'HackerNews',
          });
        } catch (itemError) {
          this.logger.warn(`获取 HackerNews item ${id} 失败`, itemError);
        }
      }

      this.logger.log(`HackerNews 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error('HackerNews 采集失败', error);
      return [];
    }
  }
}
