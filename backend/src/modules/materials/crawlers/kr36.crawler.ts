/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { safeText } from '../../../common/text.utils';
import { ICrawler, CrawlResult } from './base.crawler';

// 36Kr AI 频道采集器
@Injectable()
export class Kr36Crawler implements ICrawler {
  private readonly logger = new Logger(Kr36Crawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(url?: string): Promise<CrawlResult[]> {
    const targetUrl = url || 'https://36kr.com/information/AI/';
    this.logger.log(`开始采集 36Kr: ${targetUrl}`);

    try {
      const { data: html } = await axios.get(targetUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 30000,
      });

      // 用正则提取页面中注入的 JSON 数据
      const match = html.match(/window\.initialState\s*=\s*({.+?})<\/script>/);

      if (!match) {
        this.logger.warn('36Kr: 未找到 initialState 数据');
        return [];
      }

      let stateObj: unknown;
      try {
        stateObj = JSON.parse(match[1]);
      } catch {
        this.logger.warn('36Kr: initialState JSON 解析失败');
        return [];
      }

      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();

      // 递归遍历 JSON 对象，查找包含 itemId 和 widgetTitle 的节点
      this.extractArticles(stateObj, results, seenUrls);

      this.logger.log(`36Kr 采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error(`36Kr 采集失败: ${targetUrl}`, error);
      return [];
    }
  }

  // 递归搜索包含文章信息的节点
  private extractArticles(
    obj: unknown,
    results: CrawlResult[],
    seenUrls: Set<string>,
  ): void {
    if (!obj || typeof obj !== 'object') return;
    const node = obj as Record<string, unknown>;

    // 检查当前节点是否包含 itemId 和 widgetTitle
    if (node.itemId && node.widgetTitle) {
      const sourceUrl = `https://36kr.com/p/${safeText(node.itemId)}`;

      if (!seenUrls.has(sourceUrl)) {
        seenUrls.add(sourceUrl);

        // 标题截断到 500 字符
        const title = safeText(node.widgetTitle || '').substring(0, 500);

        // 尝试从 templateMaterial 中获取摘要
        let summary = safeText(node.summary || '');
        if (node.templateMaterial) {
          try {
            const material =
              typeof node.templateMaterial === 'string'
                ? (JSON.parse(node.templateMaterial) as Record<string, unknown>)
                : (node.templateMaterial as Record<string, unknown>);
            summary = summary || safeText(material.summary || '');
          } catch {
            // 忽略解析错误
          }
        }

        if (title) {
          results.push({
            title,
            content: summary,
            summary,
            sourceUrl,
            author: safeText(node.authorName || node.author || ''),
            publishDate: node.publishTime
              ? new Date(safeText(node.publishTime))
              : null,
            platform: '36Kr',
          });
        }
      }
    }

    // 递归遍历子节点
    if (Array.isArray(node)) {
      for (const item of node) {
        this.extractArticles(item, results, seenUrls);
      }
    } else {
      for (const key of Object.keys(node)) {
        this.extractArticles(node[key], results, seenUrls);
      }
    }
  }
}
