import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const ASR_MODEL = 'qwen3-asr-flash';

export interface AsrResult {
  text: string;
  durationMs: number;
  model: string;
}

/**
 * 阿里百炼语音识别（B3，主文档 3.3）
 * qwen3-asr-flash：音频 → 文本
 * ⚠️ 百炼 ASR 走 OpenAI 兼容 chat.completions + input_audio 内容格式
 * （audio/transcriptions 端点 404；qwen-audio-3.0-asr-flash 原生端点格式要求 format 字段）。
 * 前端语音面板：录音上传 → 本服务转文字 → 填入对话输入框
 */
@Injectable()
export class DashscopeAsrService {
  private readonly logger = new Logger(DashscopeAsrService.name);

  constructor(private readonly config: ConfigService) {}

  private get client(): OpenAI {
    const apiKey = this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        '阿里百炼未配置（DASHSCOPE_API_KEY），语音识别不可用',
      );
    }
    return new OpenAI({ apiKey, baseURL: DASHSCOPE_BASE });
  }

  /** 音频文件 → 文本（wav/mp3/m4a，≤10MB） */
  async transcribe(buffer: Buffer, originalName: string): Promise<AsrResult> {
    if (buffer.byteLength === 0) {
      throw new ServiceUnavailableException('音频为空');
    }
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new ServiceUnavailableException('音频过大（≤10MB），请缩短录音');
    }
    const t0 = Date.now();
    const ext = (originalName.split('.').pop() || 'wav').toLowerCase();
    const mime =
      ext === 'mp3'
        ? 'audio/mpeg'
        : ext === 'm4a'
          ? 'audio/mp4'
          : ext === 'webm'
            ? 'audio/webm'
            : ext === 'ogg'
              ? 'audio/ogg'
              : ext === 'aac'
                ? 'audio/aac'
                : ext === 'flac'
                  ? 'audio/flac'
                  : 'audio/wav';
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

    try {
      const completion = await this.client.chat.completions.create({
        model: ASR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: dataUrl },
              },
            ],
          },
        ],
        stream: false,
        // 兼容 openai SDK 类型：asr_options 走 extra_body
        extra_body: { asr_options: { enable_itn: false } },
      } as never);
      const text = (completion.choices?.[0]?.message?.content || '').trim();
      if (!text) {
        throw new ServiceUnavailableException(
          '未能识别到语音内容（请靠近麦克风重试）',
        );
      }
      this.logger.log(
        `ASR 识别成功（${Date.now() - t0}ms）: ${text.slice(0, 40)}…`,
      );
      return { text, durationMs: Date.now() - t0, model: ASR_MODEL };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ASR 识别失败: ${message.slice(0, 120)}`);
      throw new ServiceUnavailableException(
        `语音识别失败：${message.slice(0, 80)}`,
      );
    }
  }
}
