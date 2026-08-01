import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WechatCompiler } from './wechat-compiler';

export interface WechatPublishParams {
  apiToken: string;
  authorizerAppid: string;
  apiUrl: string;
  title: string;
  markdownContent?: string;
  htmlContent?: string;
  coverUrl?: string;
  sourceUrl: string;
  categoryId?: number;
  needOpenComment?: number;
  onlyFansCanComment?: number;
  author?: string;
  openComment?: number;
  openReward?: number;
}

export interface WechatPublishResult {
  articleId: string;
  publishUrl?: string;
  evidence?: unknown;
  readback?: {
    matched: boolean;
    expectedText?: string;
    actualText?: string;
  };
}

export interface WechatOfficialDraftParams {
  accessToken: string;
  title: string;
  author?: string;
  digest?: string;
  htmlContent: string;
  sourceUrl: string;
  thumbMediaId: string;
  needOpenComment?: number;
  onlyFansCanComment?: number;
}

export interface WechatOfficialDraftArticlePayload {
  title: string;
  author: string;
  digest: string;
  content: string;
  content_source_url: string;
  thumb_media_id: string;
  need_open_comment: number;
  only_fans_can_comment: number;
}

export interface WechatOfficialDraftPayload {
  articles: [WechatOfficialDraftArticlePayload];
}

export interface WechatOfficialDraftReadback {
  matched: boolean;
  expectedTitle: string;
  actualTitle?: string;
  contentMatched: boolean;
  failureReason?: string;
}

export interface WechatOfficialDraftResult {
  mediaId: string;
  payload: WechatOfficialDraftPayload;
  readback: WechatOfficialDraftReadback;
}

export interface WechatOfficialPublishResult {
  publishId: string;
}

export interface WechatOfficialPublishStatus {
  publishId: string;
  status:
    | 'publishing'
    | 'published'
    | 'originality_failed'
    | 'failed'
    | 'audit_failed'
    | 'deleted'
    | 'unknown';
  articleId?: string;
  articleUrl?: string;
  failIndex?: number[];
}

@Injectable()
export class WechatPublisherService {
  private readonly logger = new Logger(WechatPublisherService.name);

  constructor(@Optional() private readonly config?: ConfigService) {}

  async publish(params: WechatPublishParams): Promise<WechatPublishResult> {
    try {
      // 1. 优先使用已渲染好的 HTML；旧文章仍兼容 Markdown 编译
      const htmlContent = params.htmlContent
        ? WechatCompiler.sanitizeHtml(params.htmlContent)
        : await WechatCompiler.compile(params.markdownContent || '');

      // 2. 调用配置设定的 API 发文
      const apiUrl = this.validateApiUrl(params.apiUrl);
      const response = await fetch(apiUrl, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${params.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authorizer_appid: params.authorizerAppid,
          title: params.title,
          content: htmlContent,
          source_url: params.sourceUrl,
          author: params.author || '',
          cover_url: params.coverUrl || '',
          open_comment: params.openComment ?? params.needOpenComment,
          only_fans_can_comment: params.onlyFansCanComment,
          open_reward: params.openReward,
        }),
      });

      const data: unknown = await response.json();
      const dataRecord = this.asRecord(data);

      const requestSucceeded =
        dataRecord?.success === true || dataRecord?.success === 1;
      if (!response.ok || !requestSucceeded) {
        throw new Error(
          typeof dataRecord?.message === 'string'
            ? dataRecord.message
            : 'API 请求失败',
        );
      }

      const result = this.asRecord(dataRecord.data) || {};
      const readbackRecord = this.asRecord(result.readback);
      const readback = readbackRecord
        ? {
            matched: readbackRecord.matched === true,
            expectedText:
              typeof readbackRecord.expectedText === 'string'
                ? readbackRecord.expectedText
                : params.title,
            actualText:
              typeof readbackRecord.actualText === 'string'
                ? readbackRecord.actualText
                : undefined,
          }
        : undefined;
      const rawArticleId = result.articleId ?? result.article_id;
      const articleId =
        typeof rawArticleId === 'string' || typeof rawArticleId === 'number'
          ? String(rawArticleId)
          : '';
      if (!articleId) {
        throw new Error('平台响应缺少文章结果 ID');
      }
      return {
        articleId,
        publishUrl:
          typeof result.publishUrl === 'string'
            ? result.publishUrl
            : typeof result.publish_url === 'string'
              ? result.publish_url
              : undefined,
        evidence: result.evidence,
        readback,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to publish to WeChat: ${message} `);
      throw error;
    }
  }

  async createOfficialDraft(
    params: WechatOfficialDraftParams,
  ): Promise<WechatOfficialDraftResult> {
    const htmlContent = WechatCompiler.sanitizeHtml(params.htmlContent);
    const payload: WechatOfficialDraftPayload = {
      articles: [
        {
          title: params.title,
          author: params.author || '',
          digest: params.digest || '',
          content: htmlContent,
          content_source_url: params.sourceUrl,
          thumb_media_id: params.thumbMediaId,
          need_open_comment: params.needOpenComment ?? 1,
          only_fans_can_comment: params.onlyFansCanComment ?? 0,
        },
      ],
    };
    const responsePayload = await this.officialRequest(
      '/cgi-bin/draft/add',
      params.accessToken,
      payload,
    );
    const mediaId = this.requiredProviderText(
      responsePayload.media_id,
      '草稿 media_id',
    );
    return {
      mediaId,
      payload,
      readback: await this.readbackOfficialDraft(
        params.accessToken,
        mediaId,
        payload,
      ),
    };
  }

  async readbackOfficialDraft(
    accessToken: string,
    mediaId: string,
    payload: WechatOfficialDraftPayload,
  ): Promise<WechatOfficialDraftReadback> {
    const expectedArticle = payload.articles[0];
    try {
      const draft = await this.getOfficialDraft(accessToken, mediaId);
      const firstArticle = Array.isArray(draft.news_item)
        ? this.asRecord(draft.news_item[0])
        : null;
      const actualTitle =
        typeof firstArticle?.title === 'string'
          ? firstArticle.title
          : undefined;
      const actualContent =
        typeof firstArticle?.content === 'string' ? firstArticle.content : '';
      const contentMatched =
        WechatCompiler.extractVisibleText(actualContent) ===
        WechatCompiler.extractVisibleText(expectedArticle.content);
      return {
        matched: actualTitle === expectedArticle.title && contentMatched,
        expectedTitle: expectedArticle.title,
        actualTitle,
        contentMatched,
      };
    } catch (error) {
      return {
        matched: false,
        expectedTitle: expectedArticle.title,
        contentMatched: false,
        failureReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getOfficialDraft(accessToken: string, mediaId: string) {
    return this.officialRequest('/cgi-bin/draft/get', accessToken, {
      media_id: this.requiredProviderText(mediaId, '草稿 media_id'),
    });
  }

  async submitOfficialPublish(
    accessToken: string,
    mediaId: string,
  ): Promise<WechatOfficialPublishResult> {
    const payload = await this.officialRequest(
      '/cgi-bin/freepublish/submit',
      accessToken,
      { media_id: this.requiredProviderText(mediaId, '草稿 media_id') },
    );
    return {
      publishId: this.requiredProviderText(payload.publish_id, '发布任务 ID'),
    };
  }

  async getOfficialPublishStatus(
    accessToken: string,
    publishId: string,
  ): Promise<WechatOfficialPublishStatus> {
    const payload = await this.officialRequest(
      '/cgi-bin/freepublish/get',
      accessToken,
      { publish_id: this.requiredProviderText(publishId, '发布任务 ID') },
    );
    const statusMap: Record<number, WechatOfficialPublishStatus['status']> = {
      0: 'published',
      1: 'publishing',
      2: 'originality_failed',
      3: 'failed',
      4: 'audit_failed',
      5: 'deleted',
    };
    const articleDetail = this.asRecord(payload.article_detail);
    const item = Array.isArray(articleDetail?.item)
      ? this.asRecord(articleDetail.item[0])
      : null;
    return {
      publishId,
      status: statusMap[Number(payload.publish_status)] || 'unknown',
      articleId:
        typeof item?.article_id === 'string' ? item.article_id : undefined,
      articleUrl:
        typeof item?.article_url === 'string' ? item.article_url : undefined,
      failIndex: Array.isArray(payload.fail_idx)
        ? payload.fail_idx.map(Number).filter(Number.isInteger)
        : undefined,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private validateApiUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('公众号发布 API 地址无效');
    }
    const configured =
      this.config
        ?.get<string>('WECHAT_PUBLISH_ALLOWED_HOSTS')
        ?.split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean) || [];
    const allowedHosts = new Set(['mp.idouq.com', ...configured]);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !allowedHosts.has(parsed.hostname.toLowerCase())
    ) {
      throw new Error(
        '公众号发布 API 必须使用 HTTPS 且域名位于 WECHAT_PUBLISH_ALLOWED_HOSTS 白名单',
      );
    }
    return parsed.toString();
  }

  private async officialRequest(
    path: string,
    accessToken: string,
    payload: object,
  ) {
    const token = this.requiredProviderText(accessToken, '微信 Access Token');
    const response = await fetch(
      `https://api.weixin.qq.com${path}?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload),
      },
    );
    const data: unknown = await response.json();
    const record = this.asRecord(data);
    const errcode = Number(record?.errcode || 0);
    if (!response.ok || !record || errcode !== 0) {
      const message =
        typeof record?.errmsg === 'string'
          ? record.errmsg
          : `微信官方 API 请求失败（HTTP ${response.status}）`;
      throw new Error(
        errcode ? `微信官方 API ${errcode}: ${message}` : message,
      );
    }
    return record;
  }

  private requiredProviderText(value: unknown, label: string) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > 4096) {
      throw new Error(`${label} 缺失或无效`);
    }
    return text;
  }
}
