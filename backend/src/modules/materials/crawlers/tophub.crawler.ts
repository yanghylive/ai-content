import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ICrawler, CrawlResult } from './base.crawler';

// Tophub 热榜采集器
@Injectable()
export class TophubCrawler implements ICrawler {
  private readonly logger = new Logger(TophubCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(url?: string): Promise<CrawlResult[]> {
    const targetUrl = url || 'https://tophub.today/n/aqeEmPge9R';
    this.logger.log(`开始采集 Tophub: ${targetUrl}`);

    try {
      const { data: html } = await axios.get<string>(targetUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 30000,
      });

      const $ = cheerio.load(html);
      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 查找带 target="_blank" 的链接
      $('a[href][target="_blank"]').each((_, el) => {
        let href = $(el).attr('href');
        if (!href) return;

        let title = $(el).text().trim();
        if (!title) return;

        // 过滤：标题过短、包含域名或 "登录" 的丢弃
        if (title.length < 5) return;
        if (title.includes('.com')) return;
        if (title.includes('登录')) return;

        // URL 拼接
        if (href.startsWith('/')) {
          href = `https://tophub.today${href}`;
        }

        // 去重
        if (seenUrls.has(href)) return;
        seenUrls.add(href);

        // 标题截断到 500 字符
        title = title.substring(0, 500);

        results.push({
          title,
          content: '',
          summary: '',
          sourceUrl: href,
          author: '',
          publishDate: null,
          platform: 'Tophub',
        });
      });

      this.logger.log(`Tophub 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error(`Tophub 采集失败: ${targetUrl}`, error);
      return [];
    }
  }
}
