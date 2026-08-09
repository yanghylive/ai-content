import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 语音设置（云 ASR / 云 TTS 凭证）持久化到 client_configs 表。
 * - key 前缀：voice:asr:* / voice:tts:*（用户级，兼容旧数据）
 * - 平台统一凭证：env（KAYPAL_VOICE_ASR_* / KAYPAL_VOICE_TTS_*）→
 *   client_configs 的 voice:platform:*（运营下发）
 * - 读取优先级：env > platform（voice:platform:*）> user（voice:asr:*）
 * - 读取时脱敏（secret 类字段只回传掩码）。
 */
@Injectable()
export class VoiceSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private readonly asrKeys = [
    'voice:asr:provider',
    'voice:asr:aliyunApiKey',
    'voice:asr:tencentSecretId',
    'voice:asr:tencentSecretKey',
    'voice:asr:tencentAppId',
    'voice:asr:xunfeiAppId',
    'voice:asr:xunfeiApiKey',
    'voice:asr:volcAsrApiKey',
    'voice:asr:volcAsrAppKey',
    'voice:asr:volcAsrAccessKey',
    'voice:asr:volcAsrResourceId',
  ];

  private readonly ttsKeys = [
    'voice:tts:provider',
    'voice:tts:voiceId',
    'voice:tts:doubaoKey',
    'voice:tts:doubaoAppId',
    'voice:tts:doubaoAccessKey',
    'voice:tts:doubaoResourceId',
    'voice:tts:minimaxKey',
    'voice:tts:openaiKey',
    'voice:tts:openaiBaseURL',
    'voice:tts:elevenLabsKey',
    'voice:tts:volcanoAppId',
    'voice:tts:volcanoToken',
  ];

  /** env 中平台统一凭证的映射：短 key → env 名 */
  private readonly envMap: Record<string, string> = {
    provider: 'KAYPAL_VOICE_PROVIDER',
    voiceId: 'KAYPAL_VOICE_TTS_VOICE_ID',
    aliyunApiKey: 'KAYPAL_VOICE_ASR_ALIYUN_API_KEY',
    tencentSecretId: 'KAYPAL_VOICE_ASR_TENCENT_SECRET_ID',
    tencentSecretKey: 'KAYPAL_VOICE_ASR_TENCENT_SECRET_KEY',
    tencentAppId: 'KAYPAL_VOICE_ASR_TENCENT_APP_ID',
    xunfeiAppId: 'KAYPAL_VOICE_ASR_XUNFEI_APP_ID',
    xunfeiApiKey: 'KAYPAL_VOICE_ASR_XUNFEI_API_KEY',
    volcAsrApiKey: 'KAYPAL_VOICE_ASR_VOLC_API_KEY',
    volcAsrAppKey: 'KAYPAL_VOICE_ASR_VOLC_APP_KEY',
    volcAsrAccessKey: 'KAYPAL_VOICE_ASR_VOLC_ACCESS_KEY',
    volcAsrResourceId: 'KAYPAL_VOICE_ASR_VOLC_RESOURCE_ID',
    doubaoKey: 'KAYPAL_VOICE_TTS_DOUBAO_KEY',
    doubaoAppId: 'KAYPAL_VOICE_TTS_DOUBAO_APP_ID',
    doubaoAccessKey: 'KAYPAL_VOICE_TTS_DOUBAO_ACCESS_KEY',
    doubaoResourceId: 'KAYPAL_VOICE_TTS_DOUBAO_RESOURCE_ID',
    minimaxKey: 'KAYPAL_VOICE_TTS_MINIMAX_KEY',
    openaiKey: 'KAYPAL_VOICE_TTS_OPENAI_KEY',
    openaiBaseURL: 'KAYPAL_VOICE_TTS_OPENAI_BASE_URL',
    elevenLabsKey: 'KAYPAL_VOICE_TTS_ELEVENLABS_KEY',
    volcanoAppId: 'KAYPAL_VOICE_TTS_VOLCANO_APP_ID',
    volcanoToken: 'KAYPAL_VOICE_TTS_VOLCANO_TOKEN',
  };

  private isSecretKey(key: string): boolean {
    return /(Key|Secret|Token|AppId|AccessKey)$/.test(key);
  }

  private mask(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }

  /** 读取某个前缀下的全部设置（脱敏版，供前端展示；合并 env 平台配置） */
  async getSettings(
    scope: 'asr' | 'tts',
  ): Promise<Record<string, string>> {
    const keys = scope === 'asr' ? this.asrKeys : this.ttsKeys;
    const rows = await this.prisma.clientConfig.findMany({
      where: { key: { in: keys } },
    });
    const out: Record<string, string> = {};
    for (const row of rows) {
      const shortKey = row.key.replace(`voice:${scope}:`, '');
      out[shortKey] = this.isSecretKey(shortKey) ? this.mask(row.value) : row.value;
    }
    // 平台 env 配置未脱敏展示（服务端持有，不返回前端）
    return out;
  }

  /** 保存设置：secret 字段仅在非掩码值时覆盖（掩码值视为未修改） */
  async updateSettings(
    scope: 'asr' | 'tts',
    patch: Record<string, string>,
  ): Promise<Record<string, string>> {
    const keys = scope === 'asr' ? this.asrKeys : this.ttsKeys;
    for (const [shortKey, value] of Object.entries(patch)) {
      const fullKey = `voice:${scope}:${shortKey}`;
      if (!keys.includes(fullKey)) continue;
      if (this.isSecretKey(shortKey) && /^\*{4,}$/.test(value)) {
        continue; // 掩码值不覆盖
      }
      const now = new Date().toISOString();
      await this.prisma.clientConfig.upsert({
        where: { key: fullKey },
        create: { key: fullKey, value, updatedAt: now },
        update: { value, updatedAt: now },
      });
    }
    return this.getSettings(scope);
  }

  /**
   * 读取实际配置（未脱敏，供后端 ASR/TTS 服务使用）。
   * 优先级：env（平台统一）→ client_configs 的 voice:platform:* → 用户级 voice:{scope}:*
   */
  async getConfig(scope: 'asr' | 'tts'): Promise<Record<string, string>> {
    const keys = scope === 'asr' ? this.asrKeys : this.ttsKeys;
    const shortKeys = keys.map((k) => k.replace(`voice:${scope}:`, ''));

    // 1. env 平台统一凭证
    const envOut: Record<string, string> = {};
    for (const shortKey of shortKeys) {
      const envName = this.envMap[shortKey];
      if (envName) {
        const value = (
          this.config?.get<string>(envName)?.trim() ||
          process.env[envName]?.trim() ||
          ''
        );
        if (value) envOut[shortKey] = value;
      }
    }

    // 2. client_configs 平台级（voice:platform:*）
    const platformOut: Record<string, string> = {};
    try {
      const platformRows = await this.prisma.clientConfig.findMany({
        where: { key: { in: keys.map((k) => `voice:platform:${k.split(':').pop()}`) } },
      });
      for (const row of platformRows) {
        platformOut[row.key.replace('voice:platform:', '')] = row.value;
      }
    } catch {
      /* 平台级读取失败不阻断，回退用户级 */
    }

    // 3. 用户级（voice:{scope}:*）
    const userOut: Record<string, string> = {};
    try {
      const rows = await this.prisma.clientConfig.findMany({
        where: { key: { in: keys } },
      });
      for (const row of rows) {
        userOut[row.key.replace(`voice:${scope}:`, '')] = row.value;
      }
    } catch {
      /* ignore */
    }

    return { ...userOut, ...platformOut, ...envOut };
  }
}
