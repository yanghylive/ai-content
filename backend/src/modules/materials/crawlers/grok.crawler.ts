import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiClientService } from '../../ai-models/ai-client.service';
import { ICrawler, CrawlResult } from './base.crawler';

// Grok / X Twitter 热点采集器
// 通过后台配置的 AI 模型搜集 X 平台上的热门话题
@Injectable()
export class GrokCrawler implements ICrawler {
  private readonly logger = new Logger(GrokCrawler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
  ) {}

  async crawl(_url?: string): Promise<CrawlResult[]> {
    this.logger.log('开始采集 X/Twitter 热点话题');

    // 查询 purpose='x_collection' 的默认模型配置
    const defaultConfig = await this.prisma.defaultModelConfig.findFirst({
      where: { purpose: 'x_collection' },
    });

    if (!defaultConfig) {
      throw new Error(
        '未配置 X 采集用途的默认模型，请在后台「设置 → 默认模型」中为「X 采集」分配模型',
      );
    }

    const prompts = [
      {
        prompt: `请搜集过去 72 小时内 X（Twitter）平台上关于”AI 独立开发者的赚钱/实战案例”的 5-8 个热门话题。
要求：
1. 每个话题包含 title（标题）、description（提炼具体的赚钱方法、实战细节或干货）和 url（真实原始链接，如果有的话）
2. 标题应具有吸引力且准确
3. 描述不超过 200 字

请严格按照以下 JSON 数组格式返回，不要包含其他内容：
[{“title”: “话题标题”, “description”: “话题提炼描述”, “url”: “https://...”}]`,
        category: 'AI独立开发者商机/实战',
      },

      {
        prompt: `请搜集过去 72 小时内 X（Twitter）平台上关于”Cursor、claude code、codex 等 AI 编程工具的第一手使用技巧”的 5-8 个热门话题。
要求：
1. 每个话题包含 title（标题）、description（提炼具体的编程技巧、高效工作流或隐藏用法）和 url（真实原始链接，如果有的话）
2. 标题应突出工具的核心功能或实际痛点
3. 描述不超过 200 字

请严格按照以下 JSON 数组格式返回，不要包含其他内容：
[{“title”: “话题标题”, “description”: “话题提炼描述”, “url”: “https://...”}]`,
        category: 'Cursor/Windsurf 编程技巧',
      },

      {
        prompt: `请搜集过去 72 小时内 X（Twitter）平台上关于”OpenAI Operator、Claude Computer Use、OpenClaw 等 AI Agent 自动化工具”的 5-8 个热门话题。
要求：
1. 每个话题包含 title（标题）、description（提炼具体的自动化场景、实际应用案例或技术突破）和 url（真实原始链接，如果有的话）
2. 标题应突出 AI Agent 的能力边界或创新用法
3. 描述不超过 200 字

请严格按照以下 JSON 数组格式返回，不要包含其他内容：
[{“title”: “话题标题”, “description”: “话题提炼描述”, “url”: “https://...”}]`,
        category: 'AI Agent 自动化工具',
      },
    ];

    const results: CrawlResult[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>(); // 增加标题去重，防止没有 url 时重复

    const fetchQueue = async (prompt: string, category: string) => {
      try {
        const content = await this.aiClient.generate(
          defaultConfig.modelId,
          [
            {
              role: 'system',
              content:
                '你是一个专业的社交媒体热点分析助手，精通 AI 领域的信息挖掘。请只返回合法的 JSON 数组，不要返回任何 Markdown 标记或前言后语。',
            },
            { role: 'user', content: prompt },
          ],
          { temperature: 0.7, maxTokens: 4000, knowledgeMode: 'off' },
        );

        if (!content) {
          this.logger.warn(`AI 模型返回空内容 (${category})`);
          return;
        }

        const match = content.match(/\[.*\]/s);
        if (!match) {
          this.logger.warn(
            `无法从 AI 响应中提取 JSON 数组 (${category})，原始内容: ${content.substring(0, 200)}`,
          );
          return;
        }

        const topics = JSON.parse(match[0]) as Array<{
          title: string;
          description: string;
          url?: string;
        }>;

        for (const topic of topics) {
          const sourceUrl = topic.url || '';
          const title = (topic.title || '').trim().substring(0, 500);
          if (!title) continue;

          // 去重：判断 URL 或标题是否已存在
          if (sourceUrl && seenUrls.has(sourceUrl)) continue;
          if (seenTitles.has(title)) continue;

          if (sourceUrl) seenUrls.add(sourceUrl);
          seenTitles.add(title);

          results.push({
            title,
            content: topic.description || '',
            summary: topic.description || '',
            sourceUrl,
            author: '',
            publishDate: new Date(),
            platform: 'X/Twitter',
          });
        }
      } catch (error) {
        this.logger.error(`采集队列 [${category}] 失败:`, error);
      }
    };

    // 并发执行多个维度的内容抓取
    await Promise.all(
      prompts.map((item) => fetchQueue(item.prompt, item.category)),
    );

    this.logger.log(
      `X/Twitter 分领域采集完成，去重后共获取 ${results.length} 条源数据`,
    );
    return results;
  }
}
