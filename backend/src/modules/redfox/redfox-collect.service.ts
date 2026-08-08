import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { RedfoxService } from './redfox.service';
import { RedfoxClientService } from './redfox-client.service';
import type { RedfoxEffectiveConnection, RedfoxScope } from './redfox.types';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

/** 去水印下载 + 生图（A4/A5：RedFox 能力 → 素材库） */
@Injectable()
export class RedfoxCollectService {
  private readonly logger = new Logger(RedfoxCollectService.name);

  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
    private readonly autoUpload: AutoUploadService,
    private readonly aiClient?: AiClientService,
    private readonly defaultModels?: DefaultModelsService,
  ) {}

  /**
   * 从分享链接去水印采集素材（短视频/图文）：
   * RedFox parseWork/parse → 解析产物（媒体 URL）→ 下载 → 存素材库
   */
  async collectFromLink(
    authUser: AuthenticatedUser,
    input: { url: string },
  ): Promise<{ filename: string; sizeBytes: number; source: string }> {
    const url = (input.url || '').trim();
    if (!url) throw new ServiceUnavailableException('请提供作品链接');

    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);
    const raw = await this.client.request<{
      code: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>(scope, connection, {
      method: 'POST',
      path: '/story/api/parseWork/parse',
      body: { url },
      operation: `redfox.skill.execute.collect.parse.${url.slice(0, 40)}`,
      skillCode: 'media-parse-work',
      estimatedCostPoints: 1,
    });

    if (raw?.code !== 2000) {
      throw new ServiceUnavailableException(
        raw?.msg || '作品解析失败，请检查链接是否有效',
      );
    }

    const mediaUrl = this.extractMediaUrl(raw.data);
    if (!mediaUrl) {
      throw new ServiceUnavailableException(
        '未能从该作品解析出可下载的媒体文件',
      );
    }

    const buffer = await this.downloadMedia(mediaUrl);
    const filename = this.buildFilename(mediaUrl, url);
    const saved = this.autoUpload.saveMaterialBuffer(buffer, filename);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      source: url.slice(0, 80),
    };
  }

  /**
   * AI 生图（image2-GPT）：submit → 轮询 result → 图片 → 存素材库
   */
  async generateImage(
    authUser: AuthenticatedUser,
    input: { prompt: string; size?: string; n?: number },
  ): Promise<{ filename: string; sizeBytes: number; prompt: string }> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);

    // 1. 提交生图任务
    const submit = await this.client.request<{
      code: number;
      msg?: string;
      data?: { taskId?: string };
    }>(scope, connection, {
      method: 'POST',
      path: '/story/api/parseWork/imageGen/submitSkill',
      body: {
        prompt,
        size: input.size || '1024x1024',
        n: input.n ?? 1,
        modelName: 'image2-gpt',
      },
      operation: `redfox.skill.execute.image-gen.submit.${prompt.slice(0, 30)}`,
      skillCode: 'gpt-image-submit',
      estimatedCostPoints: 10,
    });

    const taskId =
      submit?.data?.taskId || (submit as { taskId?: string })?.taskId;
    if (submit?.code !== 2000 || !taskId) {
      throw new ServiceUnavailableException(submit?.msg || '生图任务提交失败');
    }

    // 2. 轮询结果（最多 24 次 × 2.5s ≈ 60s）
    let imageUrl = '';
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const result = await this.client
        .request<{
          code: number;
          msg?: string;
          data?: { url?: string; imageUrl?: string; images?: string[] };
        }>(scope, connection, {
          method: 'POST',
          path: '/story/api/parseWork/imageGen/result',
          body: { taskId },
          operation: `redfox.skill.execute.image-gen.result.${taskId}`,
          skillCode: 'gpt-image-result',
          estimatedCostPoints: 0,
        })
        .catch(() => null);
      imageUrl =
        result?.data?.url ||
        result?.data?.imageUrl ||
        result?.data?.images?.[0] ||
        '';
      if (imageUrl) break;
    }

    if (!imageUrl) {
      throw new ServiceUnavailableException('生图超时，请稍后重试');
    }

    const buffer = await this.downloadMedia(imageUrl);
    const filename = `ai-gen-${Date.now()}.png`;
    const saved = this.autoUpload.saveMaterialBuffer(buffer, filename);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      prompt: prompt.slice(0, 60),
    };
  }

  /**
   * D5 爆款拆解：作品链接 → 作品数据 → 千问拆解（标题/封面/时长/话题/互动/可复制策略）
   * 数据链路：优先 dyData/queryWork（完整元数据），失败降级 parseWork/parse（媒体+封面）。
   */
  async viralAnalyze(
    authUser: AuthenticatedUser,
    input: { url: string },
  ): Promise<Record<string, unknown>> {
    const url = (input.url || '').trim();
    if (!url) throw new ServiceUnavailableException('请提供爆款作品链接');

    const scope = await this.redfoxService.resolveScope(authUser);
    const connection = await this.redfoxService.getEffectiveConnection(scope);

    // 1) 优先 dyData/queryWork：完整元数据（标题/互动/时长/话题）
    const workId = this.extractWorkId(url);
    let workData: Record<string, unknown> | null = null;
    if (workId) {
      try {
        workData = await this.queryWorkDetail(scope, connection, workId);
      } catch {
        workData = null;
      }
    }

    // 2) 降级 parseWork/parse：至少拿到媒体/封面
    let parseData: Record<string, unknown> | null = null;
    if (!workData) {
      try {
        parseData = await this.parseWork(scope, connection, url);
      } catch {
        parseData = null;
      }
    }

    if (!workData && !parseData) {
      throw new ServiceUnavailableException(
        '作品解析失败，请检查链接是否有效（抖音精选/视频作品链接）',
      );
    }

    const summary = this.extractWorkSummary(workData ?? parseData ?? {});

    // AI 拆解（失败不阻塞，返回原始数据 + 空拆解）
    let analysis: Record<string, unknown> | null = null;
    try {
      analysis = await this.aiAnalyzeWork(url, summary);
    } catch {
      analysis = null;
    }

    return {
      url: url.slice(0, 200),
      work: summary,
      analysis,
      generatedAt: new Date().toISOString(),
    };
  }

  /** 调 dyData/queryWork 查作品详情（标题/作者/互动/时长/话题/封面） */
  private async queryWorkDetail(
    scope: RedfoxScope,
    connection: RedfoxEffectiveConnection,
    workId: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.client.request<{
      code: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>(scope, connection, {
      method: 'POST',
      path: '/story/api/dyData/queryWork',
      body: { workId },
      operation: `redfox.skill.execute.viral.work.${workId.slice(0, 20)}`,
      skillCode: 'douyin-query-work',
      estimatedCostPoints: 1,
    });
    if (raw?.code !== 2000) {
      throw new ServiceUnavailableException(raw?.msg || '作品详情查询失败');
    }
    return raw.data ?? {};
  }

  /** 调 parseWork/parse 解析作品（媒体/封面兜底） */
  private async parseWork(
    scope: RedfoxScope,
    connection: RedfoxEffectiveConnection,
    url: string,
  ): Promise<Record<string, unknown>> {
    const raw = await this.client.request<{
      code: number;
      msg?: string;
      data?: Record<string, unknown>;
    }>(scope, connection, {
      method: 'POST',
      path: '/story/api/parseWork/parse',
      body: { url },
      operation: `redfox.skill.execute.viral.parse.${url.slice(0, 40)}`,
      skillCode: 'media-parse-work',
      estimatedCostPoints: 1,
    });
    if (raw?.code !== 2000) {
      throw new ServiceUnavailableException(
        raw?.msg || '作品解析失败，请检查链接是否有效',
      );
    }
    return raw.data ?? {};
  }

  /** 从链接提取作品 ID（douyin modal_id / video / share） */
  private extractWorkId(url: string): string {
    const modalMatch = url.match(/[?&]modal_id=(\d+)/);
    if (modalMatch?.[1]) return modalMatch[1];
    const videoMatch = url.match(/(?:video|share\/video|note)\/(\d{8,})/i);
    if (videoMatch?.[1]) return videoMatch[1];
    return '';
  }

  /** 提取作品关键元数据（宽容字段） */
  private extractWorkSummary(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const record = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    const str = (value: unknown): string =>
      typeof value === 'string' ? value : '';
    const author = record(data.author) ?? record(data.user) ?? {};
    const stats = record(data.statistics) ?? record(data.stats) ?? {};
    const video = record(data.video) ?? record(data.rawVideo) ?? {};
    const first = (data as { list?: Array<Record<string, unknown>> }).list?.[0];
    const source = first ?? data;

    return {
      title: String(
        str(source?.title) ||
          str(source?.desc) ||
          str(source?.name) ||
          str(data.title) ||
          str(data.desc) ||
          str(data.content) ||
          '',
      ).slice(0, 300),
      author: String(
        str(author.nickname) ||
          str(author.name) ||
          str(author.userName) ||
          str(author.nick_name) ||
          str(data.accountName) ||
          str(data.authorName) ||
          '',
      ).slice(0, 60),
      likes: Number(
        stats.likeCount ??
          stats.like_count ??
          data.likeCount ??
          data.like_count ??
          0,
      ),
      comments: Number(
        stats.commentCount ??
          stats.comment_count ??
          data.commentCount ??
          data.comment_count ??
          0,
      ),
      shares: Number(
        stats.shareCount ??
          stats.share_count ??
          data.shareCount ??
          data.share_count ??
          0,
      ),
      collects: Number(
        stats.collectCount ??
          stats.collect_count ??
          data.collectCount ??
          data.collect_count ??
          0,
      ),
      plays: Number(
        stats.playCount ??
          stats.play_count ??
          data.playCount ??
          data.viewCount ??
          data.play_count ??
          0,
      ),
      duration: Number(video.duration ?? data.duration ?? data.durationMs ?? 0),
      topics: Array.isArray(data.topics)
        ? data.topics
        : Array.isArray(data.commentTopKeywords)
          ? data.commentTopKeywords
          : [],
      platform: String(str(data.platform) || str(source?.platform) || 'douyin'),
      workType: str(data.workType) || str(source?.workType) || '',
      publishTime: str(data.publishTime) || str(source?.publishTime) || '',
      coverUrl:
        String(
          str(video.cover) ||
            str(video.poster) ||
            str(data.coverUrl) ||
            str(data.cover) ||
            str(data.originCover) ||
            '',
        ).slice(0, 500) || null,
    };
  }

  /** 千问拆解爆款（标题套路/互动结构/可复制策略） */
  private async aiAnalyzeWork(
    url: string,
    summary: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (!this.aiClient || !this.defaultModels) return null;
    const modelId = await this.resolveChatModelId();
    if (!modelId) return null;

    const prompt = `你是内容运营的爆款拆解专家。根据以下爆款作品数据，输出拆解结论（JSON 对象）。
字段：titleTrick（标题套路，一句话）、coverAdvice（封面建议）、contentStructure（内容结构，3-5 个要点）、hashtagStrategy（话题策略）、interactionHook（互动钩子）、replicableStrategy（可复制到我们创作的具体策略，2-3 条）、riskNote（风险提示，如有）。
要求：输出合法 JSON 对象，不要 markdown 代码块，不要多余解释。中文输出。

作品链接：${url.slice(0, 200)}
作品数据：${JSON.stringify(summary).slice(0, 1500)}`;

    const raw = await this.aiClient.generate(
      modelId,
      [
        {
          role: 'system',
          content:
            '你是内容运营爆款拆解专家，只输出合法 JSON 对象，中文，简洁专业。',
        },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 1000, temperature: 0.5, knowledgeMode: 'off' },
    );

    return this.parseAiAnalysis(raw);
  }

  private parseAiAnalysis(raw: string): Record<string, unknown> | null {
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async resolveChatModelId(): Promise<string> {
    try {
      const defaults = await this.defaultModels?.getDefaults();
      const modelId =
        defaults?.articleCreation ||
        defaults?.topicSelection ||
        defaults?.xCollection ||
        '';
      if (modelId) return modelId;
    } catch {
      /* 忽略 */
    }
    return '';
  }

  /** 从 parse 产物里提取媒体 URL（宽容多字段） */
  private extractMediaUrl(data: Record<string, unknown> | undefined): string {
    if (!data || typeof data !== 'object') return '';
    const candidates = [
      data.url,
      data.videoUrl,
      data.video_url,
      data.imageUrl,
      data.mediaUrl,
      data.originUrl,
      data.link,
      data.playUrl,
      (data.video as Record<string, unknown> | undefined)?.url,
      (data.video as Record<string, unknown> | undefined)?.playUrl,
      (data.images as string[] | undefined)?.[0],
      (data.imageList as string[] | undefined)?.[0],
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && /^https?:/i.test(value)) {
        return value;
      }
    }
    return '';
  }

  /** 下载媒体文件（30s 超时） */
  private async downloadMedia(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        Referer: 'https://www.douyin.com/',
      },
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `媒体下载失败（${response.status}）`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private buildFilename(mediaUrl: string, source: string): string {
    const extMatch = mediaUrl.match(/\.(mp4|webm|mov|png|jpe?g|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
    const seed =
      source.match(/(\d{10,})/)?.[0]?.slice(-8) ||
      Date.now().toString().slice(-8);
    return `collect-${seed}.${ext}`;
  }
}
