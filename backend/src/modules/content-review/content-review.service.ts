import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { pickDefaultModel } from '../ai-models/model-capability.util';
import {
  reviewContent,
  issuesToPrompt,
  type ContentReviewInput,
  type ContentReviewResult,
} from './content-reviewer';

/**
 * ContentReviewService —— 审稿 + 定向修订（最多一次）
 *
 * 流程：审稿评分 → 不达标 → LLM 按问题清单定向修订 → 复检
 * 方法论借鉴 ai-trend-publish「自动审稿 → 自动修复 → dry-run/发布」（仅思路）。
 */

export interface ReviewRevision {
  titles: string[];
  pages: Array<{
    type: string;
    heading: string;
    content: string;
    imagePrompt: string;
  }>;
  review: ContentReviewResult;
  revised?: boolean;
}

@Injectable()
export class ContentReviewService {
  private readonly logger = new Logger(ContentReviewService.name);
  private readonly promptsDir = join(__dirname, 'prompts');

  constructor(
    private readonly aiClient?: AiClientService,
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 审稿 + 定向修订 + 复检。
   * @param input 内容与审稿输入
   * @param aiFlavorScore AI 味评分（外部传入）
   */
  async reviewAndRevise(
    input: ContentReviewInput & {
      titles: string[];
      pages: Array<{
        type: string;
        heading: string;
        content: string;
        imagePrompt: string;
      }>;
    },
  ): Promise<ReviewRevision> {
    const { titles, pages, ...reviewInput } = input;
    const review = reviewContent({ ...reviewInput, titles });

    // 已达标 → 不修订
    if (review.pass || pages.length === 0) {
      return { titles, pages, review, revised: false };
    }

    // 定向修订一次
    try {
      const revised = await this.reviseOnce(
        titles,
        pages,
        issuesToPrompt(review.issues),
      );
      const revisedReview = reviewContent({
        titles: revised.titles,
        pagesContent: revised.pages.map((p) => p.content),
        pageTypes: revised.pages.map((p) => p.type),
        generatedImageCount: reviewInput.generatedImageCount,
        aiFlavorScore: reviewInput.aiFlavorScore,
      });
      this.logger.log(
        `[content-review] 修订后质量分 ${review.score} → ${revisedReview.score}${revisedReview.pass ? '（达标）' : '（仍未达标）'}`,
      );
      return {
        titles: revised.titles,
        pages: revised.pages,
        review: revisedReview,
        revised: true,
      };
    } catch (error) {
      this.logger.warn(
        `[content-review] 定向修订失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { titles, pages, review, revised: false };
    }
  }

  private async reviseOnce(
    titles: string[],
    pages: Array<{
      type: string;
      heading: string;
      content: string;
      imagePrompt: string;
    }>,
    issuesText: string,
  ): Promise<{
    titles: string[];
    pages: Array<{
      type: string;
      heading: string;
      content: string;
      imagePrompt: string;
    }>;
  }> {
    if (!this.aiClient || !this.prisma) {
      throw new Error('AI 客户端未注入，无法定向修订');
    }
    let template: string;
    try {
      template = readFileSync(
        join(this.promptsDir, 'review-revise.md'),
        'utf-8',
      );
    } catch {
      template =
        '按问题清单修订下面的内容：\n{{ISSUES}}\n\n{{TITLES}}\n{{PAGES}}';
    }

    const pagesBlock = pages
      .map((p) => `${p.type}|${p.heading}|${p.content}`)
      .join('\n---\n');

    const prompt = template
      .replaceAll('{{TITLES}}', titles.join('\n'))
      .replaceAll('{{PAGES}}', pagesBlock)
      .replaceAll('{{ISSUES}}', issuesText);

    const model = await pickDefaultModel(this.prisma, 'text');
    if (!model) throw new Error('未配置可用的 AI 模型');

    const raw = await this.aiClient.generate(
      model.id,
      [
        {
          role: 'system',
          content:
            '你是严格的内容编辑，只按问题清单定向修订，输出格式必须与输入一致。',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.7, maxTokens: 4000 },
    );

    return this.parseRevised(raw, titles, pages);
  }

  /** 解析修订结果（容错：解析失败则原样返回） */
  private parseRevised(
    raw: string,
    fallbackTitles: string[],
    fallbackPages: Array<{
      type: string;
      heading: string;
      content: string;
      imagePrompt: string;
    }>,
  ): {
    titles: string[];
    pages: Array<{
      type: string;
      heading: string;
      content: string;
      imagePrompt: string;
    }>;
  } {
    try {
      const text = raw.trim();
      // 严格校验：输出必须包含 --- 页分隔符才视为有效修订
      if (!text.includes('---')) {
        return { titles: fallbackTitles, pages: fallbackPages };
      }
      // 标题候选行（不以 --- 开头、非空、非列表）
      const lines = text.split('\n');
      const titles: string[] = [];
      let inPages = false;
      const pageBlocks: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('---')) {
          inPages = true;
          continue;
        }
        if (!inPages && titles.length < 3 && !trimmed.startsWith('|')) {
          titles.push(trimmed.replace(/^[-*\d.]+\s*/, ''));
        } else {
          inPages = true;
          pageBlocks.push(trimmed);
        }
      }

      // 页块解析：type|heading|content
      const pages = pageBlocks
        .map((block) => {
          const parts = block.split('|');
          if (parts.length < 3) return null;
          const type = parts[0].trim();
          const heading = parts[1].trim();
          const content = parts.slice(2).join('|').trim();
          const original =
            fallbackPages.find((p) => p.type === type) ?? fallbackPages[0];
          return {
            type,
            heading: heading || original?.heading || '',
            content: content || original?.content || '',
            imagePrompt: original?.imagePrompt || '',
          };
        })
        .filter((p): p is NonNullable<typeof p> => Boolean(p));

      return {
        titles: titles.length > 0 ? titles : fallbackTitles,
        pages: pages.length > 0 ? pages : fallbackPages,
      };
    } catch {
      return { titles: fallbackTitles, pages: fallbackPages };
    }
  }
}
