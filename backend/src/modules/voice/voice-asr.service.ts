import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/auth.types';

/** 云 ASR 转写结果 */
export interface VoiceAsrResult {
  text: string;
  model: string;
  durationMs: number;
}

/**
 * 语音识别：通过 kaypal.cn 云端网关（KAYPAL_AI_PROXY_BASE_URL）调
 * OpenAI 兼容的 /v1/audio/transcriptions（云端已接入阿里百炼）。
 * 鉴权：x-kaypal-api-key（平台服务商 Key）+ x-kaypal-user-id（用户归属，云端计费）。
 * 本地不持有任何云厂商 Key，识别成本由 kaypal.cn 云端统一记账。
 */
@Injectable()
export class VoiceAsrService {
  private readonly logger = new Logger(VoiceAsrService.name);

  constructor(private readonly config: ConfigService) {}

  private readConfig(key: string) {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  private getGatewayBaseUrl() {
    const authBase =
      this.readConfig('KAYPAL_AUTH_BASE_URL') || 'https://kaypal.cn';
    return (
      this.readConfig('KAYPAL_AI_PROXY_BASE_URL') ||
      `${authBase}/api/ai`
    ).replace(/\/+$/, '');
  }

  private getServerApiKey() {
    return (
      this.readConfig('KAYPAL_AI_PROXY_API_KEY') ||
      this.readConfig('KAYPAL_API_KEY') ||
      ''
    );
  }

  /** 16kHz/16bit/mono PCM → WAV（44 字节 RIFF header），百炼/OpenAI 兼容接口通用 */
  private pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
  }

  /** 语音服务状态（网关配置 + 计费说明） */
  capabilities() {
    const gatewayBase = this.getGatewayBaseUrl();
    const model =
      this.readConfig('KAYPAL_VOICE_ASR_MODEL') || 'qwen-audio-3.0-asr-flash';
    return {
      provider: 'kaypal-gateway',
      gateway: gatewayBase,
      model,
      configured: Boolean(this.getServerApiKey()),
      billing: 'kaypal.cn 云端统一计费（按用户归属）',
    };
  }

  /**
   * 整段 PCM（16kHz / 16bit / mono / Int16LE）→ kaypal.cn 网关 → 文本。
   * 计费由云端网关按用户归属（x-kaypal-user-id）统一记账。
   */
  async transcribePcm(
    pcm: Buffer,
    user: AuthenticatedUser | undefined,
  ): Promise<VoiceAsrResult> {
    const started = Date.now();
    const gatewayBase = this.getGatewayBaseUrl();
    const serverApiKey = this.getServerApiKey();
    const model =
      this.readConfig('KAYPAL_VOICE_ASR_MODEL') || 'qwen-audio-3.0-asr-flash';
    const userId = user?.kaypalUserId?.trim() || '';

    if (!serverApiKey) {
      throw new ServiceUnavailableException(
        'KAYPAL 语音服务未配置服务商 Key（KAYPAL_AI_PROXY_API_KEY）。',
      );
    }

    // PCM → WAV → base64（云端网关转发百炼 multimodal-generation）
    const wav = this.pcmToWav(pcm);
    const data = wav.toString('base64');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-kaypal-api-key': serverApiKey,
    };
    if (userId) headers['x-kaypal-user-id'] = userId;

    try {
      const response = await fetch(
        `${gatewayBase}/v1/audio/transcriptions`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, data, format: 'wav' }),
          signal: AbortSignal.timeout(
            Number(this.readConfig('KAYPAL_VOICE_ASR_TIMEOUT_MS')) || 40_000,
          ),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        text?: string;
        error?: { message?: string } | string;
        message?: string;
      } | null;
      if (!response.ok) {
        const message =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          `HTTP ${response.status}`;
        this.logger.warn(`KAYPAL ASR failed: ${message}`);
        throw new ServiceUnavailableException(`语音识别失败：${message}`);
      }
      const text = (payload?.text || '').trim();
      if (!text) {
        throw new ServiceUnavailableException('语音识别未返回文本，请再试一次');
      }
      return { text, model, durationMs: Date.now() - started };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`KAYPAL ASR error: ${message}`);
      throw new ServiceUnavailableException(`语音识别失败：${message}`);
    }
  }
}
