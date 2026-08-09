import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ICrawler, CrawlResult } from './base.crawler';

// 掘金推荐流 API 响应结构
interface JuejinRecommendResponse {
  data?: Array<{
    item_info?: {
      article_info?: {
        article_id?: string;
        title?: string;
        brief_content?: string;
        ctime?: string;
      };
      author_user_info?: { user_name?: string };
    };
  }>;
}

// 掘金推荐文章采集器
@Injectable()
export class JuejinCrawler implements ICrawler {
  private readonly logger = new Logger(JuejinCrawler.name);

  private readonly USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  async crawl(_url?: string): Promise<CrawlResult[]> {
    this.logger.log('开始采集掘金推荐');

    try {
      const { data: responseData } = await axios.post<JuejinRecommendResponse>(
        'https://api.juejin.cn/recommend_api/v1/article/recommend_all_feed',
        {
          id_type: 2,
          client_type: 2608,
          sort_type: 200,
          cursor: '0',
          limit: 20,
        },
        {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const results: CrawlResult[] = [];
      const seenUrls = new Set<string>();
      const items = responseData?.data || [];

      for (const item of items) {
        const articleInfo = item?.item_info?.article_info;
        if (!articleInfo) continue;

        const articleId = articleInfo.article_id;
        if (!articleId) continue;

        const sourceUrl = `https://juejin.cn/post/${articleId}`;

        // 去重
        if (seenUrls.has(sourceUrl)) continue;
        seenUrls.add(sourceUrl);

        // 标题截断到 500 字符
        const title = (articleInfo.title || '').substring(0, 500);
        if (!title) continue;

        results.push({
          title,
          content: articleInfo.brief_content || '',
          summary: articleInfo.brief_content || '',
          sourceUrl,
          author: item?.item_info?.author_user_info?.user_name || '',
          publishDate: articleInfo.ctime
            ? new Date(parseInt(articleInfo.ctime) * 1000)
            : null,
          platform: 'Juejin',
        });
      }

      this.logger.log(`掘金采集完成，获取 ${results.length} 条`);
      return results;
    } catch (error) {
      this.logger.error('掘金采集失败', error);
      return [];
    }
  }
}
