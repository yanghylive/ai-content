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

export interface SpeechGenResult {
  filename: string;
  sizeBytes: number;
  text: string;
  voice: string;
}

const DEFAULT_IMAGE_MODEL = 'qwen-image-3.0-pro';
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
        '多模态服务未配置 KAYPAL_AI_PROXY_API_KEY，请联系管理员',
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

  /** Qwen-Image 生图（提示词 → 图 → 素材库，云端网关 + 积分） */
  async generateImage(
    authUser: AuthenticatedUser,
    input: { prompt: string; size?: string },
  ): Promise<ImageGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    let imageUrl = '';
    try {
      const resp = await fetch(
        `${this.getGatewayBaseUrl()}/v1/images/generations`,
        {
          method: 'POST',
          headers: this.buildHeaders(authUser),
          body: JSON.stringify({
            model: DEFAULT_IMAGE_MODEL,
            input: { prompt, size: input.size || '1024*1024' },
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
      imageUrl = payload.imageUrl;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`生图网关异常: ${message}`);
      throw new ServiceUnavailableException(`生图失败：${message}`);
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
    this.logger.log(`Qwen-Image 成图已入素材库：${saved.filename}`);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      url: imageUrl,
      prompt,
    };
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
}
