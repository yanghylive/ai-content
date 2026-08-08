import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeText } from '../../common/text.utils';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

const DASHSCOPE_MM_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const IMAGE_MODEL = 'qwen-image-3.0-pro';
const TTS_MODEL = 'qwen3-tts-flash';

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
  /** 音频可访问 URL（百炼 OSS，有效期约 7 天；素材库仅图片/视频不入库） */
  audioUrl: string;
}

interface DashScopeResp {
  output?: {
    choices?: Array<{ message?: { content?: Array<Record<string, unknown>> } }>;
    audio?: { url?: string; data?: string };
    text?: string;
  };
  message?: string;
  code?: string;
}

/**
 * 阿里百炼多模态（P4，主文档 §3.4，百炼直连）
 * Qwen-Image 3.0 Pro 生图 + qwen3-tts 配音 → 自动入素材库
 * ⚠️ 百炼 compatible-mode 不支持 images/audio 端点（404）——统一走 DashScope 原生
 * multimodal-generation 端点（qwen-image / qwen3-tts 官方路径）
 * Key 仅存后端 env（DASHSCOPE_API_KEY）
 */
@Injectable()
export class DashscopeMultimodalService {
  private readonly logger = new Logger(DashscopeMultimodalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly autoUploadService: AutoUploadService,
  ) {}

  private get apiKey(): string {
    const key = this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        '阿里百炼未配置（DASHSCOPE_API_KEY）',
      );
    }
    return key;
  }

  private async call(body: Record<string, unknown>): Promise<DashScopeResp> {
    const resp = await fetch(DASHSCOPE_MM_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const json = (await resp.json()) as DashScopeResp;
    if (!resp.ok || !json.output) {
      throw new ServiceUnavailableException(
        (json.message || `百炼调用失败（HTTP ${resp.status}）`).slice(0, 120),
      );
    }
    return json;
  }

  /** Qwen-Image 3.0 Pro 生图（提示词 → 图 → 素材库） */
  async generateImage(
    _authUser: { id: string },
    input: { prompt: string; size?: string },
  ): Promise<ImageGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    let imageUrl = '';
    try {
      const json = await this.call({
        model: IMAGE_MODEL,
        input: {
          messages: [{ role: 'user', content: [{ text: prompt }] }],
        },
        parameters: { size: (input.size || '1024*1024').replace('x', '*') },
      });
      imageUrl = safeText(
        json.output?.choices?.[0]?.message?.content?.[0]?.image || '',
      );
      if (!imageUrl) {
        throw new ServiceUnavailableException('生图未返回图片');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Qwen-Image 生图失败: ${message.slice(0, 120)}`);
      throw new ServiceUnavailableException(
        `生图失败：${message.slice(0, 80)}`,
      );
    }

    const arrayBuf = await (
      await fetch(imageUrl, { signal: AbortSignal.timeout(60000) })
    ).arrayBuffer();
    const buffer = Buffer.from(new Uint8Array(arrayBuf));
    const filename = `qwen-image-${Date.now()}.png`;
    const saved = await this.autoUploadService.saveMaterialBuffer(
      buffer,
      filename,
    );
    this.logger.log(`Qwen-Image 成图已入素材库：${saved.filename}`);
    return {
      filename: saved.filename,
      sizeBytes: buffer.byteLength,
      url: imageUrl,
      prompt,
    };
  }

  /** qwen3-tts 配音（文本 → 音频；素材库仅图片/视频，音频返回百炼 URL） */
  async generateSpeech(
    _authUser: { id: string },
    input: { text: string; voice?: string },
  ): Promise<SpeechGenResult> {
    const text = (input.text || '').trim();
    if (!text) throw new ServiceUnavailableException('请提供要配音的文本');
    if (text.length > 600) {
      throw new ServiceUnavailableException(
        '文本过长（qwen3-tts 最多 600 字，可分段生成）',
      );
    }
    const voice = (input.voice || '').trim() || 'Cherry';

    try {
      const json = await this.call({
        model: TTS_MODEL,
        input: { text, voice, language_type: 'Chinese' },
      });
      const audioUrl = json.output?.audio?.url || '';
      if (!audioUrl) {
        throw new ServiceUnavailableException('配音未返回音频');
      }
      // 探测大小（音频不入素材库——素材库仅图片/视频安全限制）
      const head = await fetch(audioUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      const sizeBytes = Number(head?.headers?.get('content-length') || 0);
      this.logger.log(
        `qwen3-tts 配音成功（${sizeBytes} bytes）: ${text.slice(0, 30)}…`,
      );
      return {
        filename: `qwen-tts-${Date.now()}.wav`,
        sizeBytes,
        text,
        voice,
        audioUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`qwen3-tts 配音失败: ${message.slice(0, 120)}`);
      throw new ServiceUnavailableException(
        `配音失败：${message.slice(0, 80)}`,
      );
    }
  }
}
