import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { KaypalAuthClient } from '../auth/kaypal-auth.client';

export interface ImageGenResult {
  filename: string;
  sizeBytes: number;
  url?: string;
  prompt: string;
}

export interface VideoGenResult {
  filename: string;
  sizeBytes: number;
  url?: string;
  prompt: string;
}

export interface SpeechGenResult {
  filename: string;
  sizeBytes: number;
  text: string;
  voice: string;
}

const DEFAULT_IMAGE_MODEL = 'qwen-image-3.0-pro';
const DEFAULT_VIDEO_T2V_MODEL = 'happyhorse-1.1-t2v';
const DEFAULT_VIDEO_I2V_MODEL = 'happyhorse-1.1-i2v';
const DEFAULT_TTS_MODEL = 'qwen3-tts-instruct-flash';
const DEFAULT_TTS_VOICE = 'Cherry';

/**
 * 多模态（P4，主文档 §3.4 多模态）：
 * Qwen-Image 生图 + qwen3-tts 配音 → 产物自动入素材库（AutoUploadService）。
 * 2026-08-09 起统一走 kaypal 云端网关 v1 端点（与 voice/wan-i2v 同源）：
 *  - 生图：POST {网关}/api/ai/v1/images/generations
 *  - 配音：POST {网关}/api/ai/v1/audio/speech
 *  - 鉴权：x-kaypal-api-key（服务商 Key）+ x-kaypal-user-id（计费归属）
 *  - 计费：云端按用户归属统一记账，本地不持有任何云厂商 Key。
 * ⚠️ 不走 OpenAI SDK（SDK 会把 baseURL 拼成 /api/ai/audio/speech，缺 v1 段），
 *    必须手写 fetch 拼完整的 /api/ai/v1/* 路径。
 */
@Injectable()
export class MultimodalService {
  private readonly logger = new Logger(MultimodalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly autoUploadService: AutoUploadService,
    @Optional()
    private readonly kaypalAuth?: KaypalAuthClient,
  ) {}

  private resolveKaypalUserId(authUser: AuthenticatedUser): string {
    return authUser?.kaypalUserId?.trim() || authUser?.id?.trim() || '';
  }

  /**
   * 媒体生成成本预估（报告 16.3 第 11 项）：生成前调 kaypal quote，
   * 返回预估积分 + 预估人民币，供前端「生成前展示成本」。
   * 价格透明是「怎么计量」商业问的前提；预估失败返回 null（不阻断生成）。
   */
  async quoteImageCost(authUser: AuthenticatedUser, input: { count?: number }) {
    return this.quoteCost(authUser, 'image_generation', {
      count: Math.max(1, input.count ?? 1),
    });
  }

  async quoteVideoCost(
    authUser: AuthenticatedUser,
    input: { durationSeconds?: number },
  ) {
    return this.quoteCost(authUser, 'video_generation', {
      durationSeconds: Math.max(1, input.durationSeconds ?? 5),
    });
  }

  private async quoteCost(
    authUser: AuthenticatedUser,
    resourceType: string,
    metadata: Record<string, unknown>,
  ) {
    const userId = this.resolveKaypalUserId(authUser);
    if (!this.kaypalAuth || !userId) {
      return null;
    }
    const result = await this.kaypalAuth.quoteCloudBilling({
      userId,
      serviceType: 'ai_content_workbench',
      resourceType,
      metadata,
    });
    if (!result.ok || !result.quote) {
      return null;
    }
    return {
      resourceType,
      amount: result.quote.amount,
      estimatedCostCny: result.quote.estimatedCostCny,
      managed: result.quote.managed,
      pricingBasis: result.quote.pricingBasis,
      inputs: result.quote.inputs,
    };
  }

  private readConfig(key: string): string {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  private getGatewayBaseUrl(): string {
    const authBase =
      this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://kaypal.cn';
    return (
      this.readConfig('KAYPAL_AI_PROXY_BASE_URL') || `${authBase}/api/ai`
    ).replace(/\/+$/, '');
  }

  private getServerApiKey(): string {
    return (
      this.readConfig('KAYPAL_AI_PROXY_API_KEY') ||
      this.readConfig('KAYPAL_API_KEY') ||
      ''
    );
  }

  private buildHeaders(authUser: AuthenticatedUser): Record<string, string> {
    const serverKey = this.getServerApiKey();
    if (!serverKey) {
      throw new ServiceUnavailableException('多模态服务暂不可用，请稍后重试');
    }
    const userId = authUser?.kaypalUserId?.trim() || authUser?.id?.trim() || '';
    if (!userId) {
      throw new ServiceUnavailableException(
        '多模态生成需要当前登录用户授权，请在「账号与设备」重新登录后再试',
      );
    }
    return {
      'Content-Type': 'application/json',
      'x-kaypal-api-key': serverKey,
      'x-kaypal-user-id': userId,
    };
  }

  /** Qwen-Image 生图（提示词 → 图 → 素材库）：
   *  强制走 KAYPAL 云端网关（用户熵积分计费）。
   *  2026-08-23 Stage 1D：删除历史「百炼直连双通道」注释——该分支已于 2026-08-22
   *  按大王指示移除，任何第三方直连都会绕过计费，不允许存在（含文档示例）。
   */
  async generateImage(
    authUser: AuthenticatedUser,
    input: { prompt: string; size?: string },
  ): Promise<ImageGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    // 2026-08-22 大王指示：必须走 kaypal 云端计费（用户熵积分），
    // 不允许 DASHSCOPE 直连（绕过计费）。移除直连分支，强制 kaypal 网关。
    let imageUrl = '';
    imageUrl = await this.generateImageViaKaypal(authUser, prompt, input.size);

    const buffer = Buffer.from(
      new Uint8Array(
        await (
          await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) })
        ).arrayBuffer(),
      ),
    );
    const filename = `qwen-image-${Date.now()}.png`;
    const saved = this.autoUploadService.saveMaterialBuffer(buffer, filename);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      url: imageUrl,
      prompt,
    };
  }

  /** kaypal 网关通道（回退） */
  private async generateImageViaKaypal(
    authUser: AuthenticatedUser,
    prompt: string,
    size?: string,
  ): Promise<string> {
    try {
      const resp = await fetch(
        `${this.getGatewayBaseUrl()}/v1/images/generations`,
        {
          method: 'POST',
          headers: this.buildHeaders(authUser),
          body: JSON.stringify({
            model: DEFAULT_IMAGE_MODEL,
            input: { prompt, size: size || '1024*1024' },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      const payload = (await resp.json().catch(() => null)) as {
        imageUrl?: string;
        error?: { message?: string } | string;
        message?: string;
      } | null;
      if (!resp.ok || !payload?.imageUrl) {
        const message =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          `HTTP ${resp.status}`;
        throw new ServiceUnavailableException(`生图失败：${message}`);
      }
      return payload.imageUrl;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`生图网关异常: ${message}`);
      throw new ServiceUnavailableException(`生图失败：${message}`);
    }
  }

  /** qwen3-tts 配音（文本 → 音频入素材库，云端网关 + 积分） */
  async generateSpeech(
    authUser: AuthenticatedUser,
    input: { text: string; voice?: string },
  ): Promise<SpeechGenResult> {
    const text = (input.text || '').trim();
    if (!text) throw new ServiceUnavailableException('请提供要配音的文本');
    if (text.length > 2000) {
      throw new ServiceUnavailableException(
        '文本过长（最多 2000 字，可分段生成）',
      );
    }
    const voice = (input.voice || '').trim() || DEFAULT_TTS_VOICE;

    let audioBuffer: Buffer;
    try {
      const resp = await fetch(`${this.getGatewayBaseUrl()}/v1/audio/speech`, {
        method: 'POST',
        headers: this.buildHeaders(authUser),
        body: JSON.stringify({
          model: DEFAULT_TTS_MODEL,
          input: text,
          voice,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!resp.ok) {
        const payload = (await resp.json().catch(() => null)) as {
          error?: { message?: string } | string;
          message?: string;
        } | null;
        const message =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          `HTTP ${resp.status}`;
        throw new ServiceUnavailableException(`配音失败：${message}`);
      }
      audioBuffer = Buffer.from(new Uint8Array(await resp.arrayBuffer()));
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`配音网关异常: ${message}`);
      throw new ServiceUnavailableException(`配音失败：${message}`);
    }
    if (!audioBuffer.byteLength) {
      throw new ServiceUnavailableException('配音未返回音频数据');
    }

    const filename = `tts-${Date.now()}.mp3`;
    const saved = this.autoUploadService.saveMaterialBuffer(
      audioBuffer,
      filename,
    );
    this.logger.log(`配音已入素材库：${saved.filename}`);
    return {
      filename: saved.filename,
      sizeBytes: audioBuffer.byteLength,
      text,
      voice,
    };
  }

  /** 万相 Wan 文生视频（提示词 → 视频入素材库）：
   *  强制走 KAYPAL 网关（异步 submit + 轮询）。
   *  2026-08-23 Stage 1D：删除历史「百炼直连」注释，直连分支已移除（绕过计费）。
   */
  async generateVideo(
    authUser: AuthenticatedUser,
    input: {
      prompt: string;
      duration?: number;
      ratio?: string;
      imageUrl?: string;
    },
  ): Promise<VideoGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt && !input.imageUrl) {
      throw new ServiceUnavailableException(
        '请提供视频画面描述（prompt）或首帧图片',
      );
    }

    // 2026-08-22 大王指示：必须走 kaypal 云端计费（用户熵积分），
    // 不允许 DASHSCOPE 直连（绕过计费）。移除直连分支，强制 kaypal 网关。
    return this.generateVideoViaKaypal(authUser, prompt, input);
  }

  /** kaypal 网关通道（计费走 kaypal.cn，未配置百炼直连 Key 时的主路径） */
  private async generateVideoViaKaypal(
    authUser: AuthenticatedUser,
    prompt: string,
    input: { duration?: number; ratio?: string; imageUrl?: string },
  ): Promise<VideoGenResult> {
    const duration = Math.min(
      Math.max(Math.round(input.duration ?? 5) || 5, 3),
      15,
    );
    const isI2v = Boolean(input.imageUrl);
    const model = isI2v ? DEFAULT_VIDEO_I2V_MODEL : DEFAULT_VIDEO_T2V_MODEL;
    const videoInput = isI2v
      ? { imageUrl: input.imageUrl as string, prompt, duration }
      : { prompt, duration };
    const headers = this.buildHeaders(authUser);

    // 1. 提交（异步任务）
    let taskId = '';
    try {
      const resp = await fetch(
        `${this.getGatewayBaseUrl()}/v1/video/generations`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, input: videoInput }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const payload = (await resp.json().catch(() => null)) as {
        taskId?: string;
        error?: { message?: string } | string;
        message?: string;
      } | null;
      if (!resp.ok || !payload?.taskId) {
        const rawMessage =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          '';
        // 401/403：网关未授权（服务商 key 无视频权限/失效）→ 明确指引而非笼统失败
        if (resp.status === 401 || resp.status === 403) {
          throw new ServiceUnavailableException(
            `视频生成未授权（HTTP ${resp.status}）：当前 kaypal 网关凭据无视频生成权限或已失效，请检查 KAYPAL_AI_PROXY_API_KEY 配置/账号权限后重试`,
          );
        }
        throw new ServiceUnavailableException(
          `视频生成失败：${rawMessage || `HTTP ${resp.status}`}`,
        );
      }
      taskId = payload.taskId;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException(
        `视频提交异常：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 2. 轮询（最多 60 次 × 5s ≈ 5 分钟）
    let videoUrl = '';
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const qResp = await fetch(
          `${this.getGatewayBaseUrl()}/v1/video/generations?id=${encodeURIComponent(taskId)}`,
          {
            headers: {
              'x-kaypal-api-key': headers['x-kaypal-api-key'] || '',
              'x-kaypal-user-id': headers['x-kaypal-user-id'] || '',
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        const q = (await qResp.json().catch(() => null)) as {
          status?: string;
          videoUrl?: string | null;
          error?: { message?: string } | string;
        } | null;
        const status = (q?.status || '').toUpperCase();
        if (status === 'SUCCEEDED') {
          videoUrl = q?.videoUrl || '';
          if (videoUrl) break;
        } else if (status === 'FAILED') {
          const msg =
            (typeof q?.error === 'object' && q.error?.message) ||
            (typeof q?.error === 'string' ? q.error : '') ||
            '未知错误';
          throw new ServiceUnavailableException(`视频生成失败：${msg}`);
        }
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err;
        this.logger.warn(`视频任务轮询异常 ${taskId}: ${String(err)}`);
      }
    }
    if (!videoUrl) {
      throw new ServiceUnavailableException('视频生成超时，请稍后重试');
    }

    // 3. 下载入素材库
    const buffer = Buffer.from(
      new Uint8Array(
        await (
          await fetch(videoUrl, { signal: AbortSignal.timeout(90_000) })
        ).arrayBuffer(),
      ),
    );
    const filename = `wan-${Date.now()}.mp4`;
    const saved = this.autoUploadService.saveMaterialBuffer(buffer, filename);
    this.logger.log(`视频已入素材库（kaypal 网关）：${saved.filename}`);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      url: videoUrl,
      prompt,
    };
  }
}
