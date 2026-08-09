import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createCloudASRSession } from './vendor/cloud-asr';
import { VoiceBillingService } from './voice-billing.service';
import { VoiceSettingsService } from './voice-settings.service';

/** 云 ASR 转写结果 */
export interface VoiceAsrResult {
  text: string;
  provider: string;
  durationMs: number;
  segments: number;
}

const ASR_TIMEOUT_MS = 30_000;
const PCM_CHUNK_BYTES = 4096; // 2048 samples @16kHz int16 = 128ms/块

@Injectable()
export class VoiceAsrService {
  private readonly logger = new Logger(VoiceAsrService.name);

  constructor(
    private readonly settings: VoiceSettingsService,
    private readonly billing: VoiceBillingService,
  ) {}

  /**
   * 整段 PCM（16kHz / 16bit / mono / Int16LE）→ 云 ASR → 最终文本。
   * 费 token 的云服务：识别成功后从用户 KAYPAL 账户扣费（kaypal.cn）。
   */
  async transcribePcm(
    pcm: Buffer,
    user: AuthenticatedUser | undefined,
    explicitProvider?: string,
  ): Promise<VoiceAsrResult> {
    const started = Date.now();
    const cfg = await this.settings.getConfig('asr');
    const provider = explicitProvider || cfg.provider || 'aliyun';

    const config: Record<string, string> = {
      provider,
      lang: 'zh',
      // aliyun
      aliyunApiKey: cfg.aliyunApiKey || '',
      // tencent
      tencentSecretId: cfg.tencentSecretId || '',
      tencentSecretKey: cfg.tencentSecretKey || '',
      tencentAppId: cfg.tencentAppId || '',
      // xunfei
      xunfeiAppId: cfg.xunfeiAppId || '',
      xunfeiApiKey: cfg.xunfeiApiKey || '',
      // volcengine
      volcAsrApiKey: cfg.volcAsrApiKey || '',
      volcAsrAppKey: cfg.volcAsrAppKey || '',
      volcAsrAccessKey: cfg.volcAsrAccessKey || '',
      volcAsrResourceId: cfg.volcAsrResourceId || '',
    };

    const sentences: Array<{ seg: string | null; text: string; final: boolean }> = [];
    let lastPartial = '';
    let errorMsg = '';

    const session = createCloudASRSession(
      config,
      (text, isFinal, seg) => {
        if (isFinal) {
          sentences.push({ seg, text, final: true });
        } else {
          lastPartial = text;
        }
      },
      (err) => {
        errorMsg = err;
      },
      () => {
        /* closed */
      },
      () => {
        /* event */
      },
    );

    if (!session) {
      throw new Error(`语音识别初始化失败：${errorMsg || '未配置可用的云 ASR 服务商'}`);
    }

    // 分块喂入
    const chunkCount = Math.max(1, Math.ceil(pcm.length / PCM_CHUNK_BYTES));
    for (let i = 0; i < chunkCount; i++) {
      const chunk = pcm.subarray(i * PCM_CHUNK_BYTES, (i + 1) * PCM_CHUNK_BYTES);
      session.sendAudio(chunk);
      if (i % 8 === 0) {
        // 让出事件循环，避免阻塞 WS 消息处理
        await new Promise((r) => setImmediate(r));
      }
    }
    session.flush();

    // 等待识别完成：所有 final 句子收集完毕 或 出错 或 超时
    const deadline = Date.now() + ASR_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (errorMsg) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    session.close();

    if (errorMsg) {
      this.logger.warn(`ASR failed (${provider}): ${errorMsg}`);
      throw new Error(`语音识别失败：${errorMsg}`);
    }

    // 按 seg 去重拼接 final 句子；无 final 则回退最后 partial
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const s of sentences) {
      const key = s.seg || s.text;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(s.text);
    }
    let text = parts.join('').trim();
    if (!text) text = lastPartial.trim();

    // 识别成功 → 从用户 KAYPAL 账户扣费（kaypal.cn 线上计费）
    if (user) {
      try {
        await this.billing.deduct({
          user,
          resourceType: 'voice_recognition',
          amount: 1,
          source: 'kaypal-web',
          idempotencyKey: `voice:asr:${started}:${Math.random().toString(36).slice(2, 8)}`,
          metadata: { provider, durationMs: Date.now() - started },
        });
      } catch (err) {
        // 计费失败 = 服务不可用，不允许白嫖
        throw err instanceof ServiceUnavailableException
          ? err
          : new ServiceUnavailableException(
              'KAYPAL 语音服务计费暂时不可用，请刷新账号状态后再试。',
            );
      }
    }

    return {
      text,
      provider,
      durationMs: Date.now() - started,
      segments: sentences.length,
    };
  }
}
