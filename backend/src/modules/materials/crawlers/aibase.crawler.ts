import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ICrawler, CrawlResult } from './base.crawler';

// Aibase 新闻采集器
@Injectable()
export class AibaseCrawler implements ICrawler {
  private readonly logger = new Logger(AibaseCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(url?: string): Promise<CrawlResult[]> {
    const targetUrl = url || 'https://www.aibase.com/zh/news';
    this.logger.log(`开始采集 Aibase: ${targetUrl}`);

    try {
      const { data: html } = await axios.get<string>(targetUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 30000,
      });

      const $ = cheerio.load(html);
      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 查找包含 /news/ 路径的 <a> 标签
      $('a[href*="/news/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        // URL 拼接
        const fullUrl = href.startsWith('/')
          ? `https://www.aibase.com${href}`
          : href;

        // 去重
        if (seenUrls.has(fullUrl)) return;
        seenUrls.add(fullUrl);

        // 提取标题：查找 h2, h3, div 中 class 包含 title / text-lg / line-clamp 的元素
        let title = '';
        const titleEl = $(el).find(
          'h2, h3, [class*="title"], [class*="text-lg"], [class*="line-clamp"]',
        );
        if (titleEl.length > 0) {
          title = titleEl.first().text().trim();
        }
        // 兜底：直接取 <a> 标签内文字
        if (!title) {
          title = $(el).text().trim();
        }
        if (!title) return;

        // 标题截断到 500 字符
        title = title.substring(0, 500);

        results.push({
          title,
          content: '',
          summary: '',
          sourceUrl: fullUrl,
          author: '',
          publishDate: null,
          platform: 'Aibase',
        });
      });

      this.logger.log(`Aibase 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error(`Aibase 采集失败: ${targetUrl}`, error);
      return [];
    }
  }
}
