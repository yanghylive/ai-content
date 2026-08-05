import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RedfoxService } from './redfox.service';
import { RedfoxClientService } from './redfox-client.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

/** 去水印下载 + 生图（A4/A5：RedFox 能力 → 素材库） */
@Injectable()
export class RedfoxCollectService {
  private readonly logger = new Logger(RedfoxCollectService.name);

  constructor(
    private readonly redfoxService: RedfoxService,
    private readonly client: RedfoxClientService,
    private readonly autoUpload: AutoUploadService,
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
    const saved = await this.autoUpload.saveMaterialBuffer(buffer, filename);
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
    if (!prompt) throw new ServiceUnavailableException('请提供生图描述（prompt）');

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

    const taskId = submit?.data?.taskId || (submit as { taskId?: string })?.taskId;
    if (submit?.code !== 2000 || !taskId) {
      throw new ServiceUnavailableException(submit?.msg || '生图任务提交失败');
    }

    // 2. 轮询结果（最多 12 次 × 2.5s ≈ 30s）
    let imageUrl = '';
    for (let i = 0; i < 12; i++) {
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
    const saved = await this.autoUpload.saveMaterialBuffer(buffer, filename);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      prompt: prompt.slice(0, 60),
    };
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
      throw new ServiceUnavailableException(`媒体下载失败（${response.status}）`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private buildFilename(mediaUrl: string, source: string): string {
    const extMatch = mediaUrl.match(/\.(mp4|webm|mov|png|jpe?g|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mp4';
    const seed = source
      .match(/(\d{10,})/)?.[0]
      ?.slice(-8) || Date.now().toString().slice(-8);
    return `collect-${seed}.${ext}`;
  }
}
