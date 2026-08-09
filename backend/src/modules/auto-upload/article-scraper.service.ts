import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';

type CheerioAPI = ReturnType<typeof cheerio.load>;

export type ScrapedArticle = {
  url: string;
  title: string;
  content: string;
  contentFormat: 'html';
  images: Array<{
    src: string;
    alt: string;
    width: number | null;
    height: number | null;
  }>;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  scrapedAt: string;
};

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

@Injectable()
export class ArticleScraperService {
  private readonly logger = new Logger(ArticleScraperService.name);

  async scrapeUrl(url: string): Promise<ScrapedArticle> {
    if (!this.isValidUrl(url)) {
      throw new Error('请输入有效的文章链接');
    }

    this.logger.log(`Scraping article from: ${url}`);

    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = this.extractTitle($);
    const { content, images } = this.extractContent($, url);
    const meta = this.extractMeta($);

    // 检测是否为 JS 渲染页面（服务端 HTML 内容极少）
    const textContent = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const isJsRendered = textContent.length < 200 && images.length === 0;
    if (isJsRendered) {
      this.logger.warn(
        `Page appears to be JS-rendered (content too short: ${textContent.length} chars). ` +
          'Server-side scraping may be incomplete. Consider using browser-based scraping for this URL.',
      );
    }

    return {
      url,
      title: title || '未命名文章',
      content,
      contentFormat: 'html',
      images,
      siteName: meta.siteName,
      author: meta.author,
      publishedAt: meta.publishedAt,
      scrapedAt: new Date().toISOString(),
      ...(isJsRendered
        ? {
            warning:
              '该页面可能为 JS 动态渲染，服务端提取内容不完整。建议使用浏览器环境提取。',
          }
        : {}),
    } as ScrapedArticle;
  }

  private async fetchHtml(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`页面请求失败: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_HTML_BYTES) {
        throw new Error(`页面过大 (${buffer.length} bytes)`);
      }

      return buffer.toString('utf8');
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractTitle($: CheerioAPI): string {
    return (
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('meta[name="twitter:title"]').attr('content')?.trim() ||
      $('article h1').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      ''
    );
  }

  private extractContent(
    $: CheerioAPI,
    baseUrl: string,
  ): {
    content: string;
    images: ScrapedArticle['images'];
  } {
    const article =
      $('article').first() ||
      $('[role="main"]').first() ||
      $('main').first() ||
      $('.article-content').first() ||
      $('.post-content').first() ||
      $('#content').first() ||
      $('body');

    // Remove non-content elements
    article
      .find(
        'script, style, nav, footer, header, aside, .ad, .advertisement, .sidebar, .comment, .comments, .related, .recommend',
      )
      .remove();

    // Collect images — handle lazy-load patterns (data-src, data-original, srcset)
    const images: ScrapedArticle['images'] = [];
    article.find('img').each((_, img) => {
      const $img = $(img);
      let src =
        $img.attr('src') ||
        $img.attr('data-src') ||
        $img.attr('data-original') ||
        $img.attr('data-lazy-src') ||
        '';

      // Handle srcset: take the first URL
      if (!src) {
        const srcset = $img.attr('srcset') || $img.attr('data-srcset') || '';
        if (srcset) {
          src = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
        }
      }

      // Handle picture/source elements
      if (!src) {
        const source = $img.parent().find('source').first();
        if (source.length) {
          src =
            source.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || '';
        }
      }

      if (!src || src.startsWith('data:')) return;

      // Resolve relative URLs
      try {
        src = new URL(src, baseUrl).href;
      } catch {
        return;
      }

      const width = parseInt($img.attr('width') || '0', 10);
      const height = parseInt($img.attr('height') || '0', 10);

      images.push({
        src,
        alt: $img.attr('alt') || '',
        width: width > 0 ? width : null,
        height: height > 0 ? height : null,
      });
    });

    return {
      content: article.html() || '',
      images,
    };
  }

  private extractMeta($: CheerioAPI): {
    siteName: string | null;
    author: string | null;
    publishedAt: string | null;
  } {
    return {
      siteName:
        $('meta[property="og:site_name"]').attr('content')?.trim() || null,
      author:
        $('meta[name="author"]').attr('content')?.trim() ||
        $('meta[property="article:author"]').attr('content')?.trim() ||
        null,
      publishedAt:
        $('meta[property="article:published_time"]').attr('content')?.trim() ||
        $('meta[name="publishdate"]').attr('content')?.trim() ||
        $('meta[name="date"]').attr('content')?.trim() ||
        null,
    };
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
