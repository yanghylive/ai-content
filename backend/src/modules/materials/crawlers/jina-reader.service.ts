import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 提取的图片信息
export interface ExtractedImage {
  url: string; // 图片 URL
  context: string; // 图片周围的文字（alt 文本或上下文）
  position: number; // 在文档中的位置（字符索引）
}

// Jina Reader 全文提取服务
// 通过 Jina AI 的 Reader API 将网页转换为 Markdown 格式
@Injectable()
export class JinaReaderService {
  private readonly logger = new Logger(JinaReaderService.name);
  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

  // 提取网页全文内容，返回 Markdown 格式文本
  async extractContent(url: string): Promise<string> {
    this.logger.log(`使用 Jina Reader 提取全文: ${url}`);

    try {
      const encodedUrl = encodeURIComponent(url);
      const { data } = await axios.get(`https://r.jina.ai/${encodedUrl}`, {
        headers: {
          Accept: 'text/markdown',
        },
        timeout: 30000,
        responseType: 'text',
      });

      this.logger.log(
        `Jina Reader 提取成功: ${url}, 内容长度: ${(data || '').length}`,
      );
      return data || '';
    } catch (error) {
      this.logger.warn(`Jina Reader 提取失败: ${url}`, error);
      return '';
    }
  }

  // 从 Markdown 内容中提取所有图片
  async extractImages(url: string): Promise<ExtractedImage[]> {
    this.logger.log(`从网页提取图片: ${url}`);

    try {
      // 优先尝试直接从原始 HTML 提图，失败时再回退 Jina Markdown。
      const [htmlImages, markdownImages] = await Promise.all([
        this.extractImagesFromHtml(url),
        this.extractImagesFromMarkdown(url),
      ]);

      const merged: ExtractedImage[] = [];
      const seen = new Set<string>();

      for (const image of [...htmlImages, ...markdownImages]) {
        const normalized = this.normalizeImageUrl(image.url, url);
        if (
          !normalized ||
          normalized.startsWith('data:') ||
          seen.has(normalized)
        ) {
          continue;
        }
        seen.add(normalized);
        merged.push({
          ...image,
          url: normalized,
        });
      }

      this.logger.log(
        `从 ${url} 提取到 ${merged.length} 张图片（HTML: ${htmlImages.length}, Markdown: ${markdownImages.length}）`,
      );
      return merged;
    } catch (error) {
      this.logger.error(`图片提取失败: ${url}`, error);
      return [];
    }
  }

  private async extractImagesFromMarkdown(
    url: string,
  ): Promise<ExtractedImage[]> {
    const markdown = await this.extractContent(url);
    if (!markdown) {
      return [];
    }

    const images: ExtractedImage[] = [];
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;

    while ((match = regex.exec(markdown)) !== null) {
      const imageUrl = match[2];
      const altText = match[1] || '';

      if (imageUrl.startsWith('data:')) {
        continue;
      }

      const context =
        altText.length > 0 ? altText : this.getContext(markdown, match.index);

      images.push({
        url: imageUrl,
        context,
        position: match.index,
      });
    }

    return images;
  }

  private async extractImagesFromHtml(
    pageUrl: string,
  ): Promise<ExtractedImage[]> {
    try {
      const { data: html } = await axios.get(pageUrl, {
        headers: {
          'User-Agent': this.USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        timeout: 30000,
        responseType: 'text',
      });

      const $ = cheerio.load(html);
      const images: ExtractedImage[] = [];
      let position = 0;

      const pushImage = (rawUrl?: string, context?: string) => {
        if (!rawUrl) return;
        const normalized = this.normalizeImageUrl(rawUrl, pageUrl);
        if (!normalized) return;
        images.push({
          url: normalized,
          context: (context || '').trim(),
          position: position++,
        });
      };

      // 最高优先级：社交卡片图，很多站点正文首图就挂在这里
      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
        'meta[property="twitter:image"]',
        'meta[property="og:image:url"]',
      ];

      for (const selector of metaSelectors) {
        $(selector).each((_, el) => {
          pushImage(
            $(el).attr('content'),
            $(el).attr('content') || 'meta image',
          );
        });
      }

      // 正文区域常见图片
      $(
        'article img, main img, .article img, .post img, .content img, img',
      ).each((_, el) => {
        const node = $(el);
        const rawUrl =
          node.attr('src') ||
          node.attr('data-src') ||
          node.attr('data-original') ||
          node.attr('data-lazy-src') ||
          node.attr('data-lazyload');
        const alt = node.attr('alt') || '';
        const parentText = node.parent().text().trim().slice(0, 120);
        pushImage(rawUrl, alt || parentText);
      });

      return images;
    } catch (error) {
      this.logger.warn(`HTML 图片提取失败: ${pageUrl}`, error);
      return [];
    }
  }

  private normalizeImageUrl(rawUrl: string, pageUrl: string): string | null {
    try {
      if (!rawUrl) return null;
      const trimmed = rawUrl.trim();
      if (
        !trimmed ||
        trimmed.startsWith('data:') ||
        trimmed.startsWith('javascript:')
      ) {
        return null;
      }
      if (trimmed.startsWith('//')) {
        return `https:${trimmed}`;
      }
      return new URL(trimmed, pageUrl).toString();
    } catch {
      return null;
    }
  }

  // 获取图片周围的上下文文字
  private getContext(
    markdown: string,
    index: number,
    radius: number = 100,
  ): string {
    const start = Math.max(0, index - radius);
    const end = Math.min(markdown.length, index + radius);
    return markdown
      .substring(start, end)
      .replace(/[\n\r]+/g, ' ')
      .trim();
  }
}
