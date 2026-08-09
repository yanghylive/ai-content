import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import type { AuthenticatedUser } from '../auth/auth.types';
import { streamTTS, TTS_PROVIDERS, TTS_VOICES, validateTTSConfig } from './vendor/tts-providers';
import { VoiceBillingService } from './voice-billing.service';
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

  constructor(
    private readonly settings: VoiceSettingsService,
    private readonly billing: VoiceBillingService,
  ) {}

  /** 可用服务商与音色（供设置页展示） */
  listCapabilities() {
    return {
      providers: TTS_PROVIDERS,
      voices: TTS_VOICES,
    };
  }

  /**
   * 文本 → 云 TTS 音频流。凭证从平台统一配置取（前端无需持有云凭证）。
   * 费 token 的云服务：合成成功后从用户 KAYPAL 账户扣费（kaypal.cn）。
   */
  async synthesize(
    text: string,
    user: AuthenticatedUser | undefined,
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

      // 合成成功 → 从用户 KAYPAL 账户扣费（kaypal.cn 线上计费）
      if (user) {
        try {
          await this.billing.deduct({
            user,
            resourceType: 'voice_tts',
            amount: 1,
            source: 'kaypal-web',
            idempotencyKey: `voice:tts:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            metadata: { provider, voiceId, textLength: text.length },
          });
        } catch (err) {
          // 计费失败 = 服务不可用，不允许白嫖
          stream.destroy?.();
          throw err instanceof ServiceUnavailableException
            ? err
            : new ServiceUnavailableException(
                'KAYPAL 语音服务计费暂时不可用，请刷新账号状态后再试。',
              );
        }
      }

      return {
        stream,
        provider,
        voiceId,
        contentType: provider === 'openai' ? 'audio/mpeg' : 'audio/mp3',
      };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`TTS failed (${provider}): ${(err as Error).message}`);
      throw new NotFoundException(`语音合成失败：${(err as Error).message}`);
    }
  }
}
