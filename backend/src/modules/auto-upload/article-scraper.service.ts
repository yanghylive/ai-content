import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { lookup as dnsLookup } from 'node:dns/promises';

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
const MAX_REDIRECTS = 5;
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
    // SSRF 防护：手动跟随重定向，每一跳都做目标地址校验（协议 + DNS 解析 IP 封禁私网/保留段）
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const safeUrl = await this.assertSafeUrl(currentUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(safeUrl.href, {
          signal: controller.signal,
          redirect: 'manual',
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        });
      } catch (e) {
        clearTimeout(timeout);
        throw new Error(`页面请求失败: ${(e as Error).message}`);
      }
      clearTimeout(timeout);

      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('重定向缺少 Location 头');
        }
        try {
          currentUrl = new URL(location, safeUrl.href).href;
        } catch {
          throw new Error('重定向地址无效');
        }
        // 下一跳循环会对重定向目标重新做安全校验
        continue;
      }

      if (!response.ok) {
        throw new Error(`页面请求失败: ${status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_HTML_BYTES) {
        throw new Error(`页面过大 (${buffer.length} bytes)`);
      }

      return buffer.toString('utf8');
    }
    throw new Error(`重定向次数超过限制 (${MAX_REDIRECTS})`);
  }

  /**
   * SSRF 防护：校验目标 URL 协议并确保其 DNS 解析结果不落在私网/回环/链路本地/云元数据等保留地址。
   * 每跳重定向都必须经过本方法。
   */
  private async assertSafeUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('请输入有效的文章链接');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('仅支持 http/https 链接');
    }
    // 禁止 user:pass@host 形式的认证信息（经典绕过手段）
    if (parsed.username || parsed.password) {
      throw new Error('链接不允许包含认证信息');
    }

    const hostname = parsed.hostname;
    const isIpLiteral =
      /^[\d.]+$/.test(hostname) ||
      /^[0-9a-fA-F:]+$/.test(hostname) ||
      hostname === 'localhost';
    const addresses = isIpLiteral
      ? [{ address: hostname }]
      : await dnsLookup(hostname, { all: true, verbatim: true }).catch(
          () => [] as Array<{ address: string }>,
        );

    for (const { address } of addresses) {
      if (this.isBlockedAddress(address)) {
        throw new Error('目标地址不允许访问（内网/回环/保留地址）');
      }
    }
    return parsed;
  }

  /** 判断 IP 是否属于私网/回环/链路本地/多播/保留段（含 IPv4-mapped IPv6）。 */
  private isBlockedAddress(ip: string): boolean {
    const lower = ip.toLowerCase();

    // IPv4-mapped IPv6（::ffff:x.x.x.x）解包后按 IPv4 判断
    const v4mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (v4mapped) return this.isBlockedAddress(v4mapped[1]);

    if (lower.includes(':')) {
      if (lower === '::' || lower === '::1') return true;
      const firstGroup = lower.split(':')[0];
      const first = Number.isNaN(parseInt(firstGroup, 16))
        ? 0
        : parseInt(firstGroup, 16);
      // fc00::/7（ULA 唯一本地地址）、fe80::/10（链路本地）
      if ((first & 0xfe00) === 0xfc00) return true;
      if ((first & 0xffc0) === 0xfe80) return true;
      return false;
    }

    const parts = ip.split('.').map((p) => Number(p));
    if (
      parts.length !== 4 ||
      parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
    ) {
      return true; // 畸形地址按拦截处理
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 私网
    if (a === 127) return true; // 127.0.0.0/8 回环
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私网
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 私网
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 192 && b === 0) return true; // 192.0.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 基准测试
    if (a >= 224) return true; // 224.0.0.0/4 多播 + 240.0.0.0/4 保留
    return false;
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
    // 按优先级找正文容器。注意：cheerio 空集也是 truthy，必须用 .length 判断，
    // 不能用 `a || b`（那样永远停在第一个空集上，正文永远提不到）。
    let article = $('article').first();
    if (!article.length) article = $('[role="main"]').first();
    if (!article.length) article = $('main').first();
    if (!article.length) article = $('#js_content').first(); // 微信公众号正文容器
    if (!article.length) article = $('#js_article').first(); // 微信公众号整页
    if (!article.length) article = $('.rich_media_content').first(); // 公众号正文
    if (!article.length) article = $('.article-content').first();
    if (!article.length) article = $('.post-content').first();
    if (!article.length) article = $('#content').first();
    if (!article.length) article = $('body').first();

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
      if (parsed.username || parsed.password) return false; // 拒绝 user:pass@host
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
