import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { AutoUploadService } from '../auto-upload/auto-upload.service';

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

const DEFAULT_IMAGE_MODEL = 'qwen-image';
const DEFAULT_TTS_MODEL = 'cosyvoice-v1';
const DEFAULT_TTS_VOICE = 'longxiaochun'; // CosyVoice 默认音色

/**
 * 多模态（P4，主文档 §3.4 多模态）：
 * Qwen-Image 生图（OpenAI 兼容 images API）+ CosyVoice 配音（OpenAI 兼容 audio API）
 * 产物自动入素材库（复用 AutoUploadService）。
 * ⚠️ 需模型台/千问端点支持 images/audio 接口；不支持时明确报错（不静默降级）。
 */
@Injectable()
export class MultimodalService {
  private readonly logger = new Logger(MultimodalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly autoUploadService: AutoUploadService,
  ) {}

  /** Qwen-Image 生图（提示词 → 图 → 素材库） */
  async generateImage(
    authUser: { id: string },
    input: { prompt: string; size?: string },
  ): Promise<ImageGenResult> {
    const prompt = (input.prompt || '').trim();
    if (!prompt)
      throw new ServiceUnavailableException('请提供生图描述（prompt）');

    const platform = await this.getEnabledPlatform();
    const client = await this.aiClient.getClient(platform.id);
    // 优先平台配置中 modelId 含 image/qwen-image 的模型，否则默认 qwen-image
    const model =
      platform.models?.find?.(
        (m: { modelId: string }) =>
          /image/i.test(m.modelId) || /wanx|qwen-image/i.test(m.modelId),
      )?.modelId ?? DEFAULT_IMAGE_MODEL;

    let imageUrl = '';
    try {
      const resp = await client.images.generate({
        model,
        prompt,
        size: (input.size || '1024x1024') as never,
        n: 1,
      });
      imageUrl = resp.data?.[0]?.url ?? resp.data?.[0]?.b64_json ?? '';
      if (!imageUrl) {
        throw new ServiceUnavailableException(
          '生图未返回图片（模型台可能不支持 images 接口）',
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Qwen-Image 生图失败: ${message}`);
      throw new ServiceUnavailableException(
        `生图失败（模型台需支持 images 接口）: ${message.slice(0, 120)}`,
      );
    }

    const buffer = Buffer.from(
      new Uint8Array(
        await (
          await fetch(imageUrl, { signal: AbortSignal.timeout(60000) })
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

  /** CosyVoice 配音（文本 → 音频 → 素材库） */
  async generateSpeech(
    authUser: { id: string },
    input: { text: string; voice?: string },
  ): Promise<SpeechGenResult> {
    const text = (input.text || '').trim();
    if (!text) throw new ServiceUnavailableException('请提供要配音的文本');
    if (text.length > 2000) {
      throw new ServiceUnavailableException(
        '文本过长（最多 2000 字，可分段生成）',
      );
    }

    const platform = await this.getEnabledPlatform();
    const client = await this.aiClient.getClient(platform.id);
    const voice = (input.voice || '').trim() || DEFAULT_TTS_VOICE;

    try {
      const resp = await client.audio.speech.create({
        model: DEFAULT_TTS_MODEL,
        voice: voice as never,
        input: text,
      });
      const arrayBuf = await resp.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuf));
      const filename = `cosyvoice-${Date.now()}.mp3`;
      const saved = this.autoUploadService.saveMaterialBuffer(buffer, filename);
      this.logger.log(`CosyVoice 配音已入素材库：${saved.filename}`);
      return {
        filename: saved.filename,
        sizeBytes: buffer.byteLength,
        text,
        voice,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`CosyVoice 配音失败: ${message}`);
      throw new ServiceUnavailableException(
        `配音失败（模型台需支持 audio/speech 接口）: ${message.slice(0, 120)}`,
      );
    }
  }

  private async getEnabledPlatform() {
    const platform = await this.prisma.aIPlatform.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'desc' },
      include: { models: true },
    });
    if (!platform) {
      throw new ServiceUnavailableException('没有可用的 AI 平台配置');
    }
    return platform;
  }
}
