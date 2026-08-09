import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ICrawler, CrawlResult } from './base.crawler';

// GitHub Trending 采集器
@Injectable()
export class GithubCrawler implements ICrawler {
  private readonly logger = new Logger(GithubCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(url?: string): Promise<CrawlResult[]> {
    const targetUrl =
      url || 'https://github.com/trending?spoken_language_code=zh';
    this.logger.log(`开始采集 GitHub Trending: ${targetUrl}`);

    try {
      const { data: html } = await axios.get<string>(targetUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 30000,
      });

      const $ = cheerio.load(html);
      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 查找 article.Box-row，取前 10 个
      $('article.Box-row')
        .slice(0, 10)
        .each((_, el) => {
          // 从 h2.h3 > a 中提取项目名
          const linkEl = $(el).find('h2 a, h1 a, .h3 a');
          const href = linkEl.attr('href')?.trim();
          if (!href) return;

          // 清洗项目名中的换行和空格
          const projectName = linkEl
            .text()
            .replace(/\n/g, '')
            .replace(/\s+/g, ' ')
            .trim();

          if (!projectName) return;

          const fullUrl = `https://github.com${href}`;
          if (seenUrls.has(fullUrl)) return;
          seenUrls.add(fullUrl);

          // 从 p 元素中提取描述
          const description = $(el).find('p').text().trim();

          // 标题截断到 500 字符
          const title = projectName.substring(0, 500);

          results.push({
            title,
            content: description,
            summary: description,
            sourceUrl: fullUrl,
            author: '',
            publishDate: null,
            platform: 'GitHub',
          });
        });

      this.logger.log(`GitHub Trending 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error(`GitHub Trending 采集失败: ${targetUrl}`, error);
      return [];
    }
  }
}
