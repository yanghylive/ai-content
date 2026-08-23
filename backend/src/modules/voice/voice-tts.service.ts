import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import type { AuthenticatedUser } from '../auth/auth.types';
import { KaypalProviderResolver } from '../ai-models/kaypal-provider.resolver';

export interface VoiceTtsResult {
  stream: Readable;
  model: string;
  voiceId: string;
  contentType: string;
}

export interface VoiceTtsCapability {
  id: string;
  label: string;
  streaming?: boolean;
}

/**
 * 语音合成：通过 kaypal.cn 云端网关（KAYPAL_AI_PROXY_BASE_URL）调
 * OpenAI 兼容的 /v1/audio/speech（云端已接入阿里百炼）。
 * 鉴权：x-kaypal-api-key + x-kaypal-user-id（用户归属，云端计费）。
 * 本地不持有任何云厂商 Key，合成成本由 kaypal.cn 云端统一记账。
 */
@Injectable()
export class VoiceTtsService {
  private readonly logger = new Logger(VoiceTtsService.name);

  constructor(private readonly config: ConfigService) {}

  private readConfig(key: string) {
    return (
      this.config?.get<string>(key)?.trim() || process.env[key]?.trim() || ''
    );
  }

  private getGatewayBaseUrl() {
    // Stage 1A：base url 统一经 KaypalProviderResolver 校验 host（fail-closed），
    // 避免 env 被改成第三方/恶意域名后请求带着凭据直接打过去。
    const authBase = KaypalProviderResolver.resolveBaseUrlFrom([
      this.readConfig('KAYPAL_AUTH_BASE_URL'),
    ]);
    return KaypalProviderResolver.resolveBaseUrlFrom([
      this.readConfig('KAYPAL_AI_PROXY_BASE_URL'),
      `${authBase}/api/ai`,
    ]);
  }

  private getServerApiKey() {
    return (
      this.readConfig('KAYPAL_AI_PROXY_API_KEY') ||
      this.readConfig('KAYPAL_API_KEY') ||
      ''
    );
  }

  /** 可用音色（qwen3-tts；以 env 配置为准） */
  listCapabilities(): {
    providers: VoiceTtsCapability[];
    voices: Record<string, unknown>;
  } {
    const defaultVoices: Record<string, unknown> = {
      'qwen3-tts': [
        { id: 'Cherry', label: '樱（女声）' },
        { id: 'LongXiaochun', label: '龙小淳（男声）' },
        { id: 'Cherry-test', label: '樱-测试' },
      ],
    };
    return {
      providers: [
        {
          id: 'kaypal-gateway',
          label: 'kaypal.cn 云端（阿里百炼）',
          streaming: false,
        },
      ],
      voices: defaultVoices,
    };
  }

  /**
   * 文本 → kaypal.cn 网关 → 音频流。
   * 计费由云端网关按用户归属（x-kaypal-user-id）统一记账。
   */
  async synthesize(
    text: string,
    user: AuthenticatedUser | undefined,
    explicit?: { provider?: string; voiceId?: string },
  ): Promise<VoiceTtsResult> {
    if (!text?.trim()) {
      throw new NotFoundException('TTS 文本为空');
    }
    const gatewayBase = this.getGatewayBaseUrl();
    const serverApiKey = this.getServerApiKey();
    const model =
      this.readConfig('KAYPAL_VOICE_TTS_MODEL') || 'qwen3-tts-instruct-flash';
    const voiceId =
      explicit?.voiceId?.trim() ||
      this.readConfig('KAYPAL_VOICE_TTS_VOICE') ||
      'Cherry';
    const userId = user?.kaypalUserId?.trim() || '';

    if (!serverApiKey) {
      throw new ServiceUnavailableException(
        'KAYPAL 语音服务未配置服务商 Key（KAYPAL_AI_PROXY_API_KEY）。',
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-kaypal-api-key': serverApiKey,
    };
    if (userId) headers['x-kaypal-user-id'] = userId;

    try {
      const response = await fetch(`${gatewayBase}/v1/audio/speech`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          input: text.slice(0, 1000),
          voice: voiceId,
        }),
        signal: AbortSignal.timeout(
          Number(this.readConfig('KAYPAL_VOICE_TTS_TIMEOUT_MS')) || 30_000,
        ),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string } | string;
          message?: string;
        } | null;
        const message =
          (typeof payload?.error === 'object' && payload.error?.message) ||
          (typeof payload?.error === 'string' ? payload.error : '') ||
          payload?.message ||
          `HTTP ${response.status}`;
        this.logger.warn(`KAYPAL TTS failed: ${message}`);
        throw new ServiceUnavailableException(`语音合成失败：${message}`);
      }
      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      const stream = Readable.fromWeb(response.body as never);
      return { stream, model, voiceId, contentType };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`KAYPAL TTS error: ${message}`);
      throw new ServiceUnavailableException(`语音合成失败：${message}`);
    }
  }
}
