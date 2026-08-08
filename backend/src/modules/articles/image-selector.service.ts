import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  if (reason instanceof Error) throw reason;
  const error = new Error(
    typeof reason === 'string' ? reason : '图片生成已取消',
  );
  error.name = 'AbortError';
  throw error;
}

function rethrowAbort(error: unknown, signal?: AbortSignal) {
  if (
    !signal?.aborted &&
    !(error as { name?: string })?.name?.includes('Abort')
  ) {
    return;
  }
  throwIfAborted(signal);
  throw error;
}

/**
 * 图片选择服务
 * 实现混合配图策略：根据需求选择真实图片或AI生成图片
 */
@Injectable()
export class ImageSelectorService {
  private readonly logger = new Logger(ImageSelectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
  ) {}

  /**
   * 选择配图
   * @param type 图片类型：'real' 真实图片，'ai' AI生成
   * @param prompt 图片描述/提示词
   * @param materials 关联的素材列表（用于查找真实图片）
   * @param imageStyle 图片风格 prompt
   * @returns 图片URL
   */
  async selectImage(
    type: 'real' | 'ai',
    prompt: string,
    materials: {
      id: string;
      imageUrl?: string | null;
      originalImageUrl?: string | null;
      hasImage?: boolean;
      title?: string;
      content?: string | null;
    }[],
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    if (type === 'real') {
      // 尝试从素材中找到相关真实图片
      const realImage = await this.findRelevantImage(prompt, materials);
      throwIfAborted(signal);
      if (realImage) {
        this.logger.log(`使用真实图片: ${realImage}`);
        return realImage;
      }
      // 没有找到合适的真实图片，降级到 AI 生成
      this.logger.log('未找到合适的真实图片，降级使用 AI 生成');
    }

    // AI 生成图片
    return await this.generateAiImage(prompt, imageStyle, imageParams, signal);
  }

  async generateCoverImage(
    prompt: string,
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
    signal?: AbortSignal,
  ): Promise<string | null> {
    return this.generateAiImage(prompt, imageStyle, imageParams, signal);
  }

  /**
   * 从素材中找到与提示词相关的图片
   * 使用关键词匹配和相似度判断
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- 内部接口契约返回 Promise，调用方（articles.service）使用 .then()，保持 async 签名
  private async findRelevantImage(
    prompt: string,
    materials: {
      id: string;
      imageUrl?: string | null;
      originalImageUrl?: string | null;
      hasImage?: boolean;
      title?: string;
      content?: string | null;
    }[],
  ): Promise<string | null> {
    // 筛选有图片的素材
    const materialsWithImages = materials
      .filter((m) => m.hasImage && (m.imageUrl || m.originalImageUrl))
      .map((m) => ({
        ...m,
        resolvedImageUrl: m.imageUrl || m.originalImageUrl || null,
      }));

    if (materialsWithImages.length === 0) {
      return null;
    }

    // 简单关键词匹配：从 prompt 中提取关键词，与素材标题匹配
    const promptKeywords = this.extractKeywords(prompt.toLowerCase());

    // 计算每个素材的相关性分数
    const scored = materialsWithImages.map((m) => {
      const titleKeywords = this.extractKeywords((m.title || '').toLowerCase());
      const contentKeywords = this.extractKeywords(
        (m.content || '').toLowerCase().slice(0, 500),
      );

      // 计算关键词重叠分数
      const titleScore = this.calculateOverlap(promptKeywords, titleKeywords);
      const contentScore =
        this.calculateOverlap(promptKeywords, contentKeywords) * 0.5;

      return {
        imageUrl: m.resolvedImageUrl!,
        score: titleScore + contentScore,
      };
    });

    // 按分数排序，返回最高分的图片
    scored.sort((a, b) => b.score - a.score);

    if (scored[0] && scored[0].score > 0) {
      return scored[0].imageUrl;
    }

    // 如果没有匹配的，随机返回一张（避免总是选第一张）
    const randomIndex = Math.floor(Math.random() * materialsWithImages.length);
    return materialsWithImages[randomIndex].resolvedImageUrl || null;
  }

  /**
   * 从文本中提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 移除常见停用词
    const stopWords = new Set([
      '的',
      '是',
      '在',
      '和',
      '了',
      '有',
      '我',
      '他',
      '她',
      '它',
      '这',
      '那',
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'dare',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'and',
      'or',
      'but',
      'if',
      'then',
      'else',
      'when',
      'where',
      'which',
    ]);

    // 分词（简单实现：按空格和标点分割）
    const words = text
      .replace(/[^\w\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !stopWords.has(w));

    // 返回唯一关键词
    return [...new Set(words)];
  }

  /**
   * 计算两个关键词集合的重叠程度
   */
  private calculateOverlap(set1: string[], set2: string[]): number {
    if (set1.length === 0 || set2.length === 0) return 0;

    const set2Set = new Set(set2);
    const overlap = set1.filter((w) => set2Set.has(w)).length;

    return overlap / Math.sqrt(set1.length * set2.length); // 余弦相似度
  }

  /**
   * AI 生成图片
   */
  private async generateAiImage(
    prompt: string,
    imageStyle?: string,
    imageParams?: { ratio?: string; resolution?: string },
    signal?: AbortSignal,
  ): Promise<string | null> {
    throwIfAborted(signal);
    const config = await this.defaultModels.getDefaults();
    throwIfAborted(signal);
    if (!config.imageCreation) {
      this.logger.warn('未配置图片创作模型，无法生成图片');
      throw new Error('未配置图片创作模型');
    }

    let finalPrompt = prompt;
    if (imageStyle) {
      finalPrompt = `${imageStyle}。画面主体要求：${prompt}`;
    }

    try {
      const url = await this.aiClient.generateImage(
        config.imageCreation,
        finalPrompt,
        {
          size: imageParams?.ratio ? undefined : '1024x1024',
          ratio: imageParams?.ratio,
          resolution: imageParams?.resolution,
          ...(signal ? { signal } : {}),
        },
      );

      if (!url) {
        throw new Error('图片模型未返回可用图片地址');
      }

      this.logger.log(`AI 图片生成成功: ${url}`);
      return url;
    } catch (error) {
      rethrowAbort(error, signal);
      const message = error instanceof Error ? error.message : '未知错误';
      this.logger.error(`AI 图片生成失败: ${message}`);
      throw new Error(message);
    }
  }

  /**
   * 获取选题关联素材的所有可用图片
   */
  async getAvailableImages(topicId: string): Promise<string[]> {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        materials: {
          include: {
            material: {
              select: {
                id: true,
                imageUrl: true,
                originalImageUrl: true,
                hasImage: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!topic) return [];

    return topic.materials
      .filter(
        (m) =>
          m.material.hasImage &&
          (m.material.imageUrl || m.material.originalImageUrl),
      )
      .map((m) => m.material.imageUrl || m.material.originalImageUrl!)
      .filter(Boolean);
  }
}
