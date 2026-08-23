import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { pickDefaultModel } from '../ai-models/model-capability.util';
import {
  AI_FLAVOR_PASS_THRESHOLD,
  detectAIFlavor,
  extractTopFlavorHits,
  type AIFlavorDetection,
} from './ai-flavor-detector';

/**
 * DeFlavorService —— 去 AI 味改写服务
 *
 * 流程：检测 AI 味 → 命中则 LLM 改写（结构粉碎+情感增强+去书面化）→ 复检 → 通过返回
 * 最多重试 2 次，始终不达标则返回当前最优结果并标注未达标。
 */

export interface DeFlavorResult {
  originalText: string;
  resultText: string;
  originalScore: number;
  resultScore: number;
  pass: boolean;
  retries: number;
  originalHits: AIFlavorDetection['hits'];
  resultHits: AIFlavorDetection['hits'];
}

@Injectable()
export class DeFlavorService {
  private readonly logger = new Logger(DeFlavorService.name);
  private readonly promptsDir = join(__dirname, 'prompts');

  constructor(
    private readonly aiClient?: AiClientService,
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 检测 + 改写 + 复检。text 已是自然文本（评分低于阈值）时直接原样返回。
   */
  async deFlavor(text: string): Promise<DeFlavorResult> {
    const originalText = (text || '').trim();
    const original = detectAIFlavor(originalText);

    // 已经自然 → 无需改写
    if (original.pass || originalText.length === 0) {
      return {
        originalText,
        resultText: originalText,
        originalScore: original.score,
        resultScore: original.score,
        pass: true,
        retries: 0,
        originalHits: original.hits,
        resultHits: original.hits,
      };
    }

    let resultText = originalText;
    let resultScore = original.score;
    let resultHits = original.hits;
    let retries = 0;

    while (resultScore >= AI_FLAVOR_PASS_THRESHOLD && retries < 3) {
      retries += 1;
      const rewritten = await this.rewriteOnce(
        resultText,
        extractTopFlavorHits(resultHits),
      );
      const check = detectAIFlavor(rewritten);
      // 分数不降反升 → 说明改写失败，保留上一版
      if (check.score >= resultScore && retries > 1) {
        break;
      }
      resultText = rewritten;
      resultScore = check.score;
      resultHits = check.hits;
      this.logger.log(
        `[ai-flavor] 改写 ${retries} 次: AI味 ${resultScore} → ${check.score}`,
      );
    }

    return {
      originalText,
      resultText,
      originalScore: original.score,
      resultScore,
      pass: resultScore < AI_FLAVOR_PASS_THRESHOLD,
      retries,
      originalHits: original.hits,
      resultHits,
    };
  }

  private async rewriteOnce(text: string, hits: string[]): Promise<string> {
    if (!this.aiClient || !this.prisma) {
      // 无 AI Client（单测/降级）：返回原文
      return text;
    }
    let template: string;
    try {
      template = readFileSync(join(this.promptsDir, 'de-flavor.md'), 'utf-8');
    } catch {
      template = `改写下面的文章，去掉 AI 味，保持内容不变，只输出改写结果：\n{{TEXT}}`;
    }

    const prompt = template
      .replaceAll('{{TEXT}}', text)
      .replaceAll(
        '{{HITS}}',
        hits.length > 0
          ? hits.join('\n')
          : '（无明显信号，凭经验消除通用 AI 味）',
      );

    const model = await pickDefaultModel(this.prisma, 'text');
    if (!model)
      throw new Error('未配置可用的 AI 模型，请在「AI 模型设置」中同步');

    return this.aiClient.generate(
      model.id,
      [
        {
          role: 'system',
          content:
            '你负责把 AI 味文章改写成真人质感内容，只输出改写结果，不加任何前缀说明。',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.9, maxTokens: 4000 },
    );
  }
}
