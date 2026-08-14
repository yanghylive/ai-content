import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AutoUploadService } from '../auto-upload/auto-upload.service';
import type { AuthenticatedUser } from '../auth/auth.types';

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
  ) {}

  private readConfig(key: string): string {
    return this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || '';
  }

  private getGatewayBaseUrl(): string {
    const authBase =
      this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://kaypal.cn';
    return (
      this.readConfig('KAYPAL_AI_PROXY_BASE_URL') ||
      `${authBase}/api/ai`
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
      throw new ServiceUnavailableException(
        '多模态服务暂不可用，请稍后重试',
      );
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
   *  2026-08-12 起支持双通道——配置 DASHSCOPE_API_KEY（阿里百炼）时优先直连
   *  百炼 multimodal-generation（qwen-image-3.0-pro 实测可用，kaypal 网关图生图权限未开通）；
   *  未配置时回退 kaypal 云端网关（积分模式）。
   */
  async generateImage(
    authUser: AuthenticatedUser,
    input: { prompt: string; size?: string },
  ): Promise<ImageGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    const dashscopeKey = this.readConfig('DASHSCOPE_API_KEY');
    let imageUrl = '';
    if (dashscopeKey) {
      imageUrl = await this.generateImageViaDashscope(
        prompt,
        input.size || '1024*1024',
        dashscopeKey,
      );
    } else {
      imageUrl = await this.generateImageViaKaypal(authUser, prompt, input.size);
    }

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

  /** 百炼直连通道（qwen-image-3.0-pro，文生图 T2I，同步返回图片 URL） */
  private async generateImageViaDashscope(
    prompt: string,
    size: string,
    apiKey: string,
  ): Promise<string> {
    try {
      const resp = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: DEFAULT_IMAGE_MODEL,
            input: {
              messages: [
                { role: 'user', content: [{ text: prompt }] },
              ],
            },
            parameters: { size },
          }),
          signal: AbortSignal.timeout(180_000),
        },
      );
      const payload = (await resp.json().catch(() => null)) as {
        code?: string;
        message?: string;
        output?: {
          choices?: Array<{
            message?: { content?: Array<{ image?: string }> };
          }>;
        };
      } | null;
      if (!resp.ok || payload?.code) {
        throw new ServiceUnavailableException(
          `生图失败：${payload?.message || `HTTP ${resp.status}`}`,
        );
      }
      const imageUrl =
        payload?.output?.choices?.[0]?.message?.content?.find(
          (c) => c?.image,
        )?.image || '';
      if (!imageUrl) {
        throw new ServiceUnavailableException('生图失败：响应中无图片 URL');
      }
      return imageUrl;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`百炼生图异常: ${message}`);
      throw new ServiceUnavailableException(`生图失败：${message}`);
    }
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
      const resp = await fetch(
        `${this.getGatewayBaseUrl()}/v1/audio/speech`,
        {
          method: 'POST',
          headers: this.buildHeaders(authUser),
          body: JSON.stringify({
            model: DEFAULT_TTS_MODEL,
            input: text,
            voice,
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
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
   *  配置 DASHSCOPE_API_KEY 时直连百炼 video-synthesis（异步 submit + 轮询）；
   *  未配置时走 kaypal 网关（回退，可能 Unauthorized）。
   */
  async generateVideo(
    authUser: AuthenticatedUser,
    input: { prompt: string; duration?: number; ratio?: string; imageUrl?: string },
  ): Promise<VideoGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt && !input.imageUrl) {
      throw new ServiceUnavailableException('请提供视频画面描述（prompt）或首帧图片');
    }

    const dashscopeKey = this.readConfig('DASHSCOPE_API_KEY');
    if (dashscopeKey) {
      return this.generateVideoViaDashscope(prompt, input, dashscopeKey);
    }
    return this.generateVideoViaKaypal(authUser, prompt, input);
  }

  /** 百炼直连：happyhorse-1.1 文生/图生视频（有首帧图走 i2v，无则直接 t2v，不出首帧） */
  private async generateVideoViaDashscope(
    prompt: string,
    input: { duration?: number; ratio?: string; imageUrl?: string },
    apiKey: string,
  ): Promise<VideoGenResult> {
    const duration = Math.min(Math.max(Math.round(input.duration ?? 5) || 5, 3), 15);
    const isI2v = Boolean(input.imageUrl);
    const model = isI2v ? DEFAULT_VIDEO_I2V_MODEL : DEFAULT_VIDEO_T2V_MODEL;
    const videoInput = isI2v
      ? { prompt, media: [{ type: 'first_frame', url: input.imageUrl as string }] }
      : { prompt };
    let taskId = '';
    try {
      const submitResp = await fetch(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model,
            input: videoInput,
            parameters: { resolution: '720P', duration },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      const payload = (await submitResp.json().catch(() => null)) as {
        code?: string;
        message?: string;
        output?: { task_id?: string };
      } | null;
      if (!submitResp.ok || payload?.code) {
        throw new ServiceUnavailableException(
          `视频提交失败：${payload?.message || `HTTP ${submitResp.status}`}`,
        );
      }
      taskId = payload?.output?.task_id || '';
      if (!taskId) {
        throw new ServiceUnavailableException('视频提交失败：未返回任务 ID');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException(
        `视频提交异常：${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 轮询（最多 60 次 × 5s ≈ 5 分钟，wan 视频生成通常 1-5 分钟）
    let videoUrl = '';
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const qResp = await fetch(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30_000),
          },
        );
        const q = (await qResp.json().catch(() => null)) as {
          output?: { task_status?: string; video_url?: string; message?: string };
        } | null;
        const status = (q?.output?.task_status || '').toUpperCase();
        if (status === 'SUCCEEDED') {
          videoUrl = q?.output?.video_url || '';
          if (videoUrl) break;
        } else if (status === 'FAILED') {
          throw new ServiceUnavailableException(
            `视频生成失败：${q?.output?.message || '未知错误'}`,
          );
        }
      } catch (err) {
        if (err instanceof ServiceUnavailableException) throw err;
        this.logger.warn(`视频任务轮询异常 ${taskId}: ${String(err)}`);
      }
    }
    if (!videoUrl) {
      throw new ServiceUnavailableException('视频生成超时，请稍后重试');
    }

    const buffer = Buffer.from(
      new Uint8Array(
        await (await fetch(videoUrl, { signal: AbortSignal.timeout(90_000) })).arrayBuffer(),
      ),
    );
    const filename = `wan-${Date.now()}.mp4`;
    const saved = this.autoUploadService.saveMaterialBuffer(buffer, filename);
    this.logger.log(`视频已入素材库：${saved.filename}`);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      url: videoUrl,
      prompt,
    };
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
        const message =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          `HTTP ${resp.status}`;
        throw new ServiceUnavailableException(`视频生成失败：${message}`);
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
