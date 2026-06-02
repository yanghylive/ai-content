import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ICrawler, CrawlResult } from './base.crawler';

@Injectable()
export class LocalServiceCrawler implements ICrawler {
  private readonly logger = new Logger(LocalServiceCrawler.name);
  private readonly minimumUsefulResults = 5;
  private readonly noiseTitlePatterns = [
    '登录',
    '注册',
    '下载',
    '联系我们',
    '人才招聘',
    '加入我们',
    '关于我们',
    '规则中心',
    '隐私',
    '协议',
    '许可证',
    '备案',
    '营业执照',
    '举报',
    '知识产权',
    '诚信公约',
    '推广服务',
  ];
  private readonly noiseUrlPatterns = [
    '/login',
    '/register',
    '/download',
    '/about',
    '/contact',
    '/privacy',
    '/agreement',
    '/license',
    '/rule',
    'beian.',
    'beian/',
    'join.',
    'rules-center',
    'app/download',
    'rsv_dl=0_right_fyb',
    'sa=0_right_fyb',
    'right_fyb_pchot',
  ];

  private readonly userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(
    url: string,
    config: Record<string, any> = {},
  ): Promise<CrawlResult[]> {
    const sourceName = this.normalizeText(
      config.sourceName || config.platformLabel || '本地服务采集源',
    );
    const platform = this.normalizeText(config.platform || sourceName);
    const keywords = this.normalizeKeywords(config.keywords);
    this.logger.log(`开始采集传统服务业网页: ${sourceName} ${url}`);

    try {
      const { data: html } = await axios.get<string>(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeout: 30000,
        maxRedirects: 5,
      });

      let results = this.extractResults(
        html,
        url,
        platform,
        sourceName,
        keywords,
        config,
      );

      if (
        results.length < this.minimumUsefulResults &&
        config.searchFallback !== false
      ) {
        const fallbackUrl = this.buildFallbackUrl(sourceName, keywords, config);
        this.logger.log(
          `采集结果不足，使用搜索兜底: ${sourceName} ${fallbackUrl}`,
        );
        const { data: fallbackHtml } = await axios.get<string>(fallbackUrl, {
          headers: {
            'User-Agent': this.userAgent,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
          timeout: 30000,
          maxRedirects: 5,
        });
        results = this.extractResults(
          fallbackHtml,
          fallbackUrl,
          platform,
          sourceName,
          keywords,
          config,
        );
      }

      this.logger.log(
        `传统服务业网页采集完成: ${sourceName}, 获取 ${results.length} 条`,
      );
      return results;
    } catch (error) {
      this.logger.error(`传统服务业网页采集失败: ${sourceName} ${url}`, error);
      return [];
    }
  }

  private extractResults(
    html: string,
    url: string,
    platform: string,
    sourceName: string,
    keywords: string[],
    config: Record<string, any>,
  ) {
    const $ = cheerio.load(html);
    const pageTitle = this.normalizeText($('title').first().text());
    const pageDescription = this.normalizeText(
      $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        '',
    );
    const origin = new URL(url).origin;
    const candidates = new Map<string, CrawlResult>();

    $('script, style, noscript, svg').remove();

    $('a[href]').each((_, el) => {
      const rawHref = $(el).attr('href');
      if (!rawHref) return;

      const sourceUrl = this.resolveUrl(rawHref, url);
      if (!sourceUrl || !sourceUrl.startsWith('http')) return;

      const ownText = this.normalizeText($(el).text());
      const titleAttr = this.normalizeText(
        $(el).attr('title') || $(el).attr('aria-label') || '',
      );
      const title = this.pickTitle([ownText, titleAttr]);
      if (!title) return;

      const textAround = this.normalizeText($(el).parent().text());
      const summary = this.pickSummary(textAround, pageDescription, title);
      const score = this.score(title, summary, keywords, sourceUrl, origin);
      if (score <= 0) return;

      const key = sourceUrl.split('#')[0];
      const current = candidates.get(key);
      const result = this.toResult(
        title,
        summary,
        key,
        platform,
        sourceName,
        pageTitle,
        keywords,
        score,
      );
      if (
        !current ||
        (current.metadata as Record<string, any>)?.signal?.score < score
      ) {
        candidates.set(key, result);
      }
    });

    if (candidates.size === 0 && pageTitle && !this.isNoise(pageTitle, url)) {
      candidates.set(
        url,
        this.toResult(
          pageTitle,
          pageDescription,
          url,
          platform,
          sourceName,
          pageTitle,
          keywords,
          1,
        ),
      );
    }

    return Array.from(candidates.values())
      .sort((left, right) => {
        const leftScore =
          ((left.metadata as Record<string, any>)?.signal?.score as number) ||
          0;
        const rightScore =
          ((right.metadata as Record<string, any>)?.signal?.score as number) ||
          0;
        return rightScore - leftScore;
      })
      .slice(0, Number(config.limit) || 30);
  }

  private toResult(
    title: string,
    summary: string,
    sourceUrl: string,
    platform: string,
    sourceName: string,
    pageTitle: string,
    keywords: string[],
    score: number,
  ): CrawlResult {
    return {
      title: title.substring(0, 500),
      content: summary,
      summary,
      sourceUrl,
      author: '',
      publishDate: null,
      platform,
      metadata: {
        sourceName,
        pageTitle,
        skipImageBackfill: true,
        signal: {
          score,
          keywords,
        },
      },
    };
  }

  private score(
    title: string,
    summary: string,
    keywords: string[],
    sourceUrl: string,
    origin: string,
  ) {
    const text = `${title} ${summary}`.toLowerCase();
    let score = 1;

    for (const keyword of keywords) {
      if (keyword && text.includes(keyword.toLowerCase())) {
        score += 4;
      }
    }

    if (sourceUrl.startsWith(origin)) score += 1;
    if (title.length >= 8 && title.length <= 80) score += 2;
    if (this.isNoise(title, sourceUrl)) score -= 20;
    if (/javascript:|mailto:|tel:/i.test(sourceUrl)) score -= 8;

    return score;
  }

  private isNoise(title: string, sourceUrl: string) {
    const normalizedTitle = title.toLowerCase();
    const normalizedUrl = sourceUrl.toLowerCase();
    return (
      this.noiseTitlePatterns.some((pattern) =>
        normalizedTitle.includes(pattern.toLowerCase()),
      ) ||
      this.noiseUrlPatterns.some((pattern) =>
        normalizedUrl.includes(pattern.toLowerCase()),
      )
    );
  }

  private pickTitle(values: string[]) {
    return values
      .map((value) => this.normalizeText(value))
      .filter((value) => value.length >= 4 && value.length <= 120)
      .sort((left, right) => right.length - left.length)[0];
  }

  private pickSummary(
    textAround: string,
    pageDescription: string,
    title: string,
  ) {
    const text = this.normalizeText(textAround.replace(title, ''));
    const summary = text.length >= 12 ? text : pageDescription;
    return summary.substring(0, 1000);
  }

  private normalizeKeywords(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.normalizeText(String(item)))
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,，\s]+/)
        .map((item) => this.normalizeText(item))
        .filter(Boolean);
    }
    return [];
  }

  private normalizeText(value: string) {
    return value.replace(/\s+/g, ' ').trim();
  }

  private resolveUrl(href: string, baseUrl: string) {
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return '';
    }
  }

  private buildFallbackUrl(
    sourceName: string,
    keywords: string[],
    config: Record<string, any>,
  ) {
    const query = this.normalizeText(
      config.fallbackQuery ||
        [sourceName, ...keywords.slice(0, 4)].filter(Boolean).join(' '),
    );
    return `https://www.so.com/s?q=${encodeURIComponent(query)}`;
  }
}
