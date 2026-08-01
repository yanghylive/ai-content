import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ICrawler, CrawlResult } from './base.crawler';

// V2EX 热门话题采集器
@Injectable()
export class V2exCrawler implements ICrawler {
  private readonly logger = new Logger(V2exCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(_url?: string): Promise<CrawlResult[]> {
    this.logger.log('开始采集 V2EX 热门');

    try {
      const { data: topics } = await axios.get(
        'https://www.v2ex.com/api/topics/hot.json',
        {
          headers: { 'User-Agent': this.USER_AGENT },
          timeout: 30000,
        },
      );

      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 取前 15 条
      const topTopics = (topics || []).slice(0, 15);

      for (const topic of topTopics) {
        const sourceUrl = topic.url || '';
        if (!sourceUrl) continue;

        // 去重
        if (seenUrls.has(sourceUrl)) continue;
        seenUrls.add(sourceUrl);

        // 标题截断到 500 字符
        const title = (topic.title || '').substring(0, 500);
        if (!title) continue;

        // 用正则清洗 content_rendered 中的 HTML 标签
        const rawContent = topic.content_rendered || topic.content || '';
        const cleanContent = rawContent.replace(/<[^>]+>/g, '');

        // 截断到 200 字符作为 summary
        const summary = cleanContent.substring(0, 200);

        results.push({
          title,
          content: cleanContent,
          summary,
          sourceUrl,
          author: topic.member?.username || '',
          publishDate: topic.created ? new Date(topic.created * 1000) : null,
          platform: 'V2EX',
        });
      }

      this.logger.log(`V2EX 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error('V2EX 采集失败', error);
      return [];
    }
  }
}
