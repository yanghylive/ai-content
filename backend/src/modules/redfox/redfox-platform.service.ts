import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RedfoxClientService } from './redfox-client.service';
import { RedfoxService } from './redfox.service';
import type {
  RedfoxClientRequestOptions,
  RedfoxEffectiveConnection,
  RedfoxScope,
} from './redfox.types';

/**
 * 平台能力统一入口（2026-08-09，RedFoxHub 能力开采 6 项）：
 *  1. 多平台去水印下载（快手/X/Instagram/YouTube/B站/视频号/TikTok/小红书/抖音）
 *  2. 视频提文案（抖音/小红书/YouTube）
 *  3. 出海平台采集（TikTok/X/YouTube 搜索/详情/评论/列表）
 *  4. 账号作品列表（抖音/公众号/B站/视频号/小红书）
 *  5. 视频号/头条内容采集（搜索/详情/列表）
 *  6. AI 作品搜索 + Seedream Pro 生图
 */
@Injectable()
export class RedfoxPlatformService {
  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
  ) {}

  /** 平台去水印下载路由表 */
  private readonly DOWNLOAD_ROUTES: Record<
    string,
    { path: string; platformLabel: string }
  > = {
    douyin: {
      path: '/story/api/parseWork/videoDownload/douyin',
      platformLabel: '抖音',
    },
    kuaishou: {
      path: '/story/api/parseWork/videoDownload/kuaishou',
      platformLabel: '快手',
    },
    xhs: {
      path: '/story/api/parseWork/videoDownload/xhs',
      platformLabel: '小红书',
    },
    sph: {
      path: '/story/api/parseWork/videoDownload/sph',
      platformLabel: '视频号',
    },
    bilibili: {
      path: '/story/api/parseWork/videoDownload/bilibili',
      platformLabel: '哔哩哔哩',
    },
    tiktok: {
      path: '/story/api/parseWork/videoDownload/tiktok',
      platformLabel: 'TikTok',
    },
    youtube: {
      path: '/story/api/parseWork/videoDownload/youtube',
      platformLabel: 'YouTube',
    },
    x: {
      path: '/story/api/parseWork/videoDownload/x',
      platformLabel: 'X(Twitter)',
    },
    instagram: {
      path: '/story/api/parseWork/videoDownload/instagram',
      platformLabel: 'Instagram',
    },
  };

  /** 视频提文案路由表 */
  private readonly TRANSCRIPT_ROUTES: Record<
    string,
    { path: string; platformLabel: string }
  > = {
    douyin: {
      path: '/story/api/parseWork/audioTextExtract/submit/douyin',
      platformLabel: '抖音',
    },
    xhs: {
      path: '/story/api/parseWork/audioTextExtract/submit/xhs',
      platformLabel: '小红书',
    },
    youtube: {
      path: '/story/api/youtube/transcript',
      platformLabel: 'YouTube',
    },
  };

  /** 出海/内容平台采集路由表（搜索/详情/列表/评论） */
  private readonly SEARCH_ROUTES: Record<
    string,
    {
      search: string;
      detail: string;
      list: string;
      comments?: string;
      platformLabel: string;
    }
  > = {
    tiktok: {
      search: '/story/api/tiktok/ability/searchVideo',
      detail: '/story/api/tiktok/ability/awemeDetail',
      list: '/story/api/tiktok/ability/userAwemeList',
      platformLabel: 'TikTok',
    },
    x: {
      search: '/story/api/x/search',
      detail: '/story/api/x/tweetDetail',
      list: '/story/api/x/tweetComments',
      comments: '/story/api/x/tweetComments',
      platformLabel: 'X(Twitter)',
    },
    youtube: {
      search: '/story/api/youtube/searchVideo',
      detail: '/story/api/youtube/videoDetail',
      list: '/story/api/youtube/videoComments',
      comments: '/story/api/youtube/videoComments',
      platformLabel: 'YouTube',
    },
    sph: {
      search: '/story/api/sphAllData/searchWork',
      detail: '/story/api/sphAllData/queryWorkDetail',
      list: '/story/api/sphAllData/queryWorkList',
      platformLabel: '视频号',
    },
    toutiao: {
      search: '/story/api/toutiao/searchWork',
      detail: '/story/api/toutiao/workDetail',
      list: '/story/api/toutiao/searchAccount',
      comments: '/story/api/toutiao/workComment',
      platformLabel: '今日头条',
    },
    douyin: {
      search: '/story/api/dyData/searchArticle',
      detail: '/story/api/dyData/queryWork',
      list: '/story/api/dyData/queryWorkList',
      platformLabel: '抖音',
    },
    gzh: {
      search: '/story/api/gzhData/searchArticle',
      detail: '/story/api/gzhData/queryArticleDetail',
      list: '/story/api/gzhData/queryWorkList',
      platformLabel: '公众号',
    },
    bilibili: {
      search: '/story/api/bili/data/workSearch',
      detail: '/story/api/bili/data/workDetail',
      list: '/story/api/bili/data/accountWorkList',
      platformLabel: '哔哩哔哩',
    },
    xhs: {
      search: '/story/api/xhsUser/searchArticle',
      detail: '/story/api/xhsUser/queryWorkDetail',
      list: '/story/api/xhsUser/queryWorkList',
      platformLabel: '小红书',
    },
  };

  /** AI 作品搜索路由表（按关键词搜 AI 生成内容） */
  private readonly AI_SEARCH_ROUTES: Record<
    string,
    { path: string; platformLabel: string }
  > = {
    douyin: {
      path: '/story/api/parseWork/queryDyAiMsgs',
      platformLabel: '抖音',
    },
    xhs: {
      path: '/story/api/parseWork/queryXhsAiMsgs',
      platformLabel: '小红书',
    },
    gzh: { path: '/story/api/parseWork/queryAiMsgs', platformLabel: '公众号' },
  };

  /** 已知下载平台列表（前端展示用） */
  getDownloadPlatforms(): Array<{ key: string; label: string }> {
    return Object.entries(this.DOWNLOAD_ROUTES).map(([key, v]) => ({
      key,
      label: v.platformLabel,
    }));
  }

  /** 已知采集平台列表（前端展示用） */
  getSearchPlatforms(): Array<{ key: string; label: string }> {
    return Object.entries(this.SEARCH_ROUTES).map(([key, v]) => ({
      key,
      label: v.platformLabel,
    }));
  }

  /** 从分享文案/文本里提取第一个 http(s) 链接 */
  private extractFirstUrl(text: string): string {
    const match = text.match(/https?:\/\/[^\s"'<>，。！？【】（）()]+/i);
    return match ? match[0].replace(/[，。！？【】（）()]+$/, '') : '';
  }

  private async resolveContext(
    authUser: AuthenticatedUser,
  ): Promise<{ scope: RedfoxScope; connection: RedfoxEffectiveConnection }> {
    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);
    return { scope, connection };
  }

  private async request(
    authUser: AuthenticatedUser,
    options: RedfoxClientRequestOptions,
  ): Promise<unknown> {
    const { scope, connection } = await this.resolveContext(authUser);
    const raw = await this.client.request<{
      code: number;
      msg?: string;
      data?: unknown;
    }>(scope, connection, options);
    if (raw?.code !== 2000) {
      throw new ServiceUnavailableException(
        raw?.msg || 'RedFox 平台调用失败，请稍后重试',
      );
    }
    return raw.data ?? {};
  }

  /**
   * 1. 多平台去水印下载（按平台路由到专用下载端点，不再走通用 parse）
   */
  async download(
    authUser: AuthenticatedUser,
    input: { platform: string; url: string },
  ): Promise<Record<string, unknown>> {
    const platform = (input.platform || '').trim().toLowerCase();
    const url = this.extractFirstUrl((input.url || '').trim());
    if (!platform || !url) {
      throw new BadRequestException('请提供平台与作品链接');
    }
    const route = this.DOWNLOAD_ROUTES[platform];
    if (!route) {
      throw new BadRequestException(
        `暂不支持平台「${platform}」，支持：${Object.keys(this.DOWNLOAD_ROUTES).join('、')}`,
      );
    }
    const data = await this.request(authUser, {
      method: 'POST',
      path: route.path,
      body: { url },
      bodyEncoding: 'json',
      operation: `redfox.skill.execute.download.${platform}.${url.slice(0, 40)}`,
      skillCode: `media-download-${platform}`,
      estimatedCostPoints: 1,
    });
    return {
      platform,
      platformLabel: route.platformLabel,
      url: url.slice(0, 200),
      data,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 2. 视频提文案（抖音/小红书为提交+查询异步；YouTube 为同步）
   */
  async transcript(
    authUser: AuthenticatedUser,
    input: { platform: string; url: string; taskId?: string },
  ): Promise<Record<string, unknown>> {
    const platform = (input.platform || '').trim().toLowerCase();
    const route = this.TRANSCRIPT_ROUTES[platform];
    if (!route) {
      throw new BadRequestException(
        `暂不支持平台「${platform}」，支持：${Object.keys(this.TRANSCRIPT_ROUTES).join('、')}`,
      );
    }
    if (platform === 'youtube') {
      // YouTube 同步返回
      const data = await this.request(authUser, {
        method: 'POST',
        path: route.path,
        body: { url: (input.url || '').trim() },
        bodyEncoding: 'json',
        operation: `redfox.skill.execute.transcript.youtube.${(input.url || '').slice(0, 40)}`,
        skillCode: 'media-transcript-youtube',
        estimatedCostPoints: 1,
      });
      return { platform, platformLabel: route.platformLabel, data, sync: true };
    }
    // 抖音/小红书：提交任务 → 返回 taskId
    if (!input.taskId) {
      const submitPath = route.path;
      const data = await this.request(authUser, {
        method: 'POST',
        path: submitPath,
        body: { url: (input.url || '').trim() },
        bodyEncoding: 'json',
        operation: `redfox.skill.execute.transcript.${platform}.submit`,
        skillCode: `media-transcript-${platform}`,
        estimatedCostPoints: 1,
      });
      const taskId =
        (data as Record<string, unknown>)?.taskId ??
        (data as Record<string, unknown>)?.task_id ??
        '';
      return {
        platform,
        platformLabel: route.platformLabel,
        taskId,
        submitted: true,
      };
    }
    // 查询结果
    const resultPath =
      platform === 'douyin'
        ? '/story/api/parseWork/audioTextExtract/result/douyin'
        : '/story/api/parseWork/audioTextExtract/result/xhs';
    const data = await this.request(authUser, {
      method: 'POST',
      path: resultPath,
      body: { taskId: input.taskId },
      bodyEncoding: 'json',
      operation: `redfox.skill.execute.transcript.${platform}.result`,
      skillCode: `media-transcript-${platform}-result`,
      estimatedCostPoints: 1,
    });
    return {
      platform,
      platformLabel: route.platformLabel,
      taskId: input.taskId,
      data,
      result: true,
    };
  }

  /**
   * 3+4+5. 统一采集：search（关键词搜索作品）/ detail（作品详情）/ list（账号作品列表）
   */
  async collect(
    authUser: AuthenticatedUser,
    input: {
      platform: string;
      action: 'search' | 'detail' | 'list';
      keyword?: string;
      url?: string;
      workId?: string;
      accountId?: string;
      page?: number;
    },
  ): Promise<Record<string, unknown>> {
    const platform = (input.platform || '').trim().toLowerCase();
    const action = input.action || 'search';
    const route = this.SEARCH_ROUTES[platform];
    if (!route) {
      throw new BadRequestException(
        `暂不支持平台「${platform}」，支持：${Object.keys(this.SEARCH_ROUTES).join('、')}`,
      );
    }
    let path = route.search;
    let body: Record<string, unknown> = {};
    if (action === 'detail') {
      path = route.detail;
      body = {
        workId: input.workId,
        // 与 download 保持一致：从整段分享口令里提取首个 http(s) 链接
        url: this.extractFirstUrl((input.url || '').trim()) || input.url,
      };
    } else if (action === 'list') {
      path = route.list;
      body = { accountId: input.accountId, page: input.page ?? 1 };
    } else {
      path = route.search;
      body = { keyword: input.keyword, page: input.page ?? 1 };
    }
    const data = await this.request(authUser, {
      method: 'POST',
      path,
      body,
      bodyEncoding: 'json',
      operation: `redfox.skill.execute.collect.${platform}.${action}.${(input.keyword || input.workId || input.accountId || '').slice(0, 30)}`,
      skillCode: `platform-collect-${platform}-${action}`,
      estimatedCostPoints: 1,
    });
    return {
      platform,
      platformLabel: route.platformLabel,
      action,
      data,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 6a. AI 作品搜索（抖音/小红书/公众号的 AI 生成内容趋势）
   */
  async aiSearch(
    authUser: AuthenticatedUser,
    input: { platform: string; keyword: string; page?: number },
  ): Promise<Record<string, unknown>> {
    const platform = (input.platform || '').trim().toLowerCase();
    const route = this.AI_SEARCH_ROUTES[platform];
    if (!route) {
      throw new BadRequestException(
        `暂不支持平台「${platform}」，支持：${Object.keys(this.AI_SEARCH_ROUTES).join('、')}`,
      );
    }
    const data = await this.request(authUser, {
      method: 'POST',
      path: route.path,
      body: { keyword: input.keyword, page: input.page ?? 1 },
      bodyEncoding: 'json',
      operation: `redfox.skill.execute.ai_search.${platform}.${(input.keyword || '').slice(0, 30)}`,
      skillCode: `ai-search-${platform}`,
      estimatedCostPoints: 1,
    });
    return {
      platform,
      platformLabel: route.platformLabel,
      data,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 6b. Seedream 5.0 Pro 生图（较现有 lite 更高质量）
   */
  async seedreamPro(
    authUser: AuthenticatedUser,
    input: { prompt: string; taskId?: string },
  ): Promise<Record<string, unknown>> {
    if (!input.taskId) {
      if (!(input.prompt || '').trim()) {
        throw new BadRequestException('请提供生图描述');
      }
      const data = await this.request(authUser, {
        method: 'POST',
        path: '/story/api/parseWork/imageGen/arkProSubmit',
        body: { prompt: input.prompt.trim() },
        bodyEncoding: 'json',
        operation: `redfox.skill.execute.seedream_pro.submit.${(input.prompt || '').slice(0, 30)}`,
        skillCode: 'seedream-pro-submit',
        estimatedCostPoints: 15,
      });
      const taskId =
        (data as Record<string, unknown>)?.taskId ??
        (data as Record<string, unknown>)?.task_id ??
        '';
      return { taskId, submitted: true, data };
    }
    const data = await this.request(authUser, {
      method: 'POST',
      path: '/story/api/parseWork/imageGen/arkProResult',
      body: { taskId: input.taskId },
      bodyEncoding: 'json',
      operation: `redfox.skill.execute.seedream_pro.result`,
      skillCode: 'seedream-pro-result',
      estimatedCostPoints: 15,
    });
    return { taskId: input.taskId, data, result: true };
  }
}
