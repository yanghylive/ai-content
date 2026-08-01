import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ICrawler, CrawlResult } from './base.crawler';

// HubToday AI 热点采集器
@Injectable()
export class HubtodayCrawler implements ICrawler {
  private readonly logger = new Logger(HubtodayCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(_url?: string): Promise<CrawlResult[]> {
    this.logger.log('开始采集 HubToday 每日资讯');

    const results: CrawlResult[] = [];

    // 动态拼接当日 URL
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const targetUrl = `https://ai.hubtoday.app/${yyyy}-${mm}/${yyyy}-${mm}-${dd}/`;

    try {
      this.logger.log(`抓取 HubToday 页面: ${targetUrl}`);
      const { data: html } = await axios.get(targetUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 30000,
      });

      const $ = cheerio.load(html);
      const articleContent = $('.content');

      if (!articleContent.length) {
        this.logger.warn('未能找到文章内容容器 (.content)');
        return [];
      }

      // 需要排除的板块标题
      const excludedSections = [
        '今日摘要',
        '社媒分享',
        'AI资讯日报多渠道',
        '进群交流',
      ];

      // 遍历所有板块（通常由 h3 分隔）
      articleContent.find('h3').each((_, h3) => {
        const sectionTitle = $(h3).text().trim();

        // 过滤无关板块
        if (
          excludedSections.some((excluded) => sectionTitle.includes(excluded))
        ) {
          return;
        }

        // 查找紧随其后的有序列表
        const ol = $(h3).nextAll('ol').first();
        // 确保该 ol 是紧邻的或者在下一个 h3 之前
        if (
          !ol.length ||
          ol.prevAll('h3').first().text().trim() !== sectionTitle
        ) {
          return;
        }

        ol.find('li').each((_, li) => {
          const $li = $(li);

          // 提取该项中所有的链接
          const allLinks = $li.find('a[href]');
          let sourceUrl = '';
          let title = '';

          // 寻找带有"(AI资讯)"或其他标识的源链接
          allLinks.each((_, a) => {
            const $a = $(a);
            const href = $a.attr('href');
            const linkText = $a.text().trim();

            if (href && href.startsWith('http')) {
              // 优先选择包含 "AI资讯" 的链接作为原始来源
              if (linkText.includes('AI资讯') || !sourceUrl) {
                sourceUrl = href;
              }
            }
          });

          // 提取标题：通常是 li 开头的粗体文字，或者是第一句话
          const firstStrong = $li.find('strong').first();
          if (firstStrong.length) {
            title = firstStrong.text().trim();
          } else {
            // 如果没有粗体，取第一句
            const fullText = $li.text().trim();
            title = fullText
              .split(/[。，\n]/)[0]
              .substring(0, 50)
              .trim();
          }

          if (!title || !sourceUrl) return;

          // 提取正文：去掉标题文字后的剩余部分
          let content = $li.text().trim();
          if (title && content.startsWith(title)) {
            content = content.substring(title.length).trim();
          }

          // 清理 content，去掉结尾的重复链接文本等
          content = content
            .replace(/\s+/g, ' ')
            .replace(/\(AI资讯\)/g, '')
            .trim();

          results.push({
            title: title.substring(0, 200),
            content: content,
            summary: sectionTitle, // 使用板块标题作为分类/摘要参考
            sourceUrl: sourceUrl,
            author: '何夕2077',
            publishDate: new Date(`${yyyy}-${mm}-${dd}`),
            platform: 'HubToday',
          });
        });
      });
    } catch (error) {
      this.logger.warn(`HubToday 页面抓取失败: ${targetUrl}`, error);
    }

    this.logger.log(`HubToday 采集完成，获取 ${results.length} 条有效新闻`);
    return results;
  }
}
