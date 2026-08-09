import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 语音设置（云 ASR / 云 TTS 凭证）持久化到 client_configs 表。
 * - key 前缀：voice:asr:* / voice:tts:*
 * - value 为 JSON 字符串；读取时脱敏（secret 类字段只回传掩码）。
 */
@Injectable()
export class VoiceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

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

  private isSecretKey(key: string): boolean {
    return /(Key|Secret|Token|AppId|AccessKey)$/.test(key);
  }

  private mask(value: string): string {
    if (!value) return '';
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }

  /** 读取某个前缀下的全部设置（脱敏版，供前端展示） */
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

  /** 读取实际配置（未脱敏，供后端 ASR/TTS 服务使用） */
  async getConfig(scope: 'asr' | 'tts'): Promise<Record<string, string>> {
    const keys = scope === 'asr' ? this.asrKeys : this.ttsKeys;
    const rows = await this.prisma.clientConfig.findMany({
      where: { key: { in: keys } },
    });
    const out: Record<string, string> = {};
    for (const row of rows) {
      out[row.key.replace(`voice:${scope}:`, '')] = row.value;
    }
    return out;
  }
}
