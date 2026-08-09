import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { streamTTS, TTS_PROVIDERS, TTS_VOICES, validateTTSConfig } from './vendor/tts-providers';
import { VoiceSettingsService } from './voice-settings.service';

export interface VoiceTtsResult {
  stream: Readable;
  provider: string;
  voiceId: string;
  contentType: string;
}

@Injectable()
export class VoiceTtsService {
  private readonly logger = new Logger(VoiceTtsService.name);

  constructor(private readonly settings: VoiceSettingsService) {}

  /** 可用服务商与音色（供设置页展示） */
  listCapabilities() {
    return {
      providers: TTS_PROVIDERS,
      voices: TTS_VOICES,
    };
  }

  /**
   * 文本 → 云 TTS 音频流。凭证从配置取（前端无需持有云凭证）。
   */
  async synthesize(
    text: string,
    explicit?: { provider?: string; voiceId?: string },
  ): Promise<VoiceTtsResult> {
    if (!text?.trim()) {
      throw new NotFoundException('TTS 文本为空');
    }
    const cfg = await this.settings.getConfig('tts');
    const provider = explicit?.provider || cfg.provider || 'volcano';
    const voiceId = explicit?.voiceId || cfg.voiceId || 'BV001_streaming';

    const keys: Record<string, string> = {
      doubaoKey: cfg.doubaoKey || '',
      doubaoAppId: cfg.doubaoAppId || '',
      doubaoAccessKey: cfg.doubaoAccessKey || '',
      doubaoResourceId: cfg.doubaoResourceId || '',
      minimaxKey: cfg.minimaxKey || '',
      openaiKey: cfg.openaiKey || '',
      openaiBaseURL: cfg.openaiBaseURL || '',
      elevenLabsKey: cfg.elevenLabsKey || '',
      volcanoAppId: cfg.volcanoAppId || '',
      volcanoToken: cfg.volcanoToken || '',
    };

    const missing = validateTTSConfig({ ...keys, provider, voiceId });
    if (!missing.ok) {
      this.logger.warn(`TTS config invalid for ${provider}: ${JSON.stringify(missing)}`);
      throw new NotFoundException(
        `TTS 服务商 ${provider} 未配置完整：${missing.guide || '请到语音设置补齐凭证'}`,
      );
    }

    try {
      const stream = await streamTTS({ text, provider, voiceId, keys });
      return {
        stream,
        provider,
        voiceId,
        contentType: provider === 'openai' ? 'audio/mpeg' : 'audio/mp3',
      };
    } catch (err) {
      this.logger.error(`TTS failed (${provider}): ${(err as Error).message}`);
      throw new NotFoundException(`语音合成失败：${(err as Error).message}`);
    }
  }
}
