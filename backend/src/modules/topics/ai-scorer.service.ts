import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { TopicsService } from './topics.service';
import { ContentStrategiesService } from '../content-strategies/content-strategies.service';

@Injectable()
export class AiScorerService {
  private readonly logger = new Logger(AiScorerService.name);

  constructor(
    private aiClient: AiClientService,
    private defaultModels: DefaultModelsService,
    private topicsService: TopicsService,
    private contentStrategiesService: ContentStrategiesService,
  ) {}

  // 对选题进行 AI 五维度评分（商业导向）
  async scoreTopic(topicId: string) {
    this.logger.log(`开始评分选题: ${topicId}`);

    // 获取选题详情
    const topic = await this.topicsService.findOne(topicId);

    // 更新状态为 generating
    await this.topicsService.updateStatus(topicId, 'generating');

    try {
      // 获取默认评分模型
      const defaults = await this.defaultModels.getDefaults();
      const modelId = defaults.topicSelection;

      if (!modelId) {
        throw new BadRequestException('请先在设置中配置选题推荐的默认模型');
      }
      const strategy = await this.contentStrategiesService.getDefaultStrategy();

      // 构建评分 Prompt
      const materialInfo = topic.materials
        .map((m: any) => `- ${m.title} (来源: ${m.platform})`)
        .join('\n');

      const prompt = `你是一名资深内容策略主编。请根据给定的内容策略，对选题进行商业价值评估。

当前内容策略：
- 策略名称：${strategy.name}
- 所属行业：${strategy.industry}
- 目标人群：${strategy.targetAudience}
- 商业目标：${strategy.commercialGoal}
- 核心痛点：${strategy.corePainPoints}
- 建议切入角度：${strategy.writingAngles}
- 表达风格：${strategy.toneAndStyle || '务实、清晰、强调可执行性'}

请根据以下选题信息，评估其作为爆款内容选题的商业价值。

选题信息：
标题：${topic.title}
描述：${topic.description || '无'}
摘要：${topic.summary || '无'}
${materialInfo ? `相关素材：\n${materialInfo}` : ''}

【核心商业导向】：请严格围绕上述内容策略来判断，而不是套用固定行业模板。

请从以下五个维度评分（每个维度 0-20 分，总分 0-100）：
1. audienceFit（画像贴合度）：是否贴合当前策略定义的目标人群？
2. emotionalValue（情绪价值）：是否能击中当前策略对应人群的真实痛点或欲望？
3. simplificationPotential（降维科普潜力）：是否容易被讲清楚、讲明白、讲出行动价值？
4. networkVolume（全网声量）：话题在多个平台的热度和传播潜力。
5. contentValue（内容价值）：内容是否能引发共鸣、讨论、转发，并服务于当前商业目标？

请严格以以下 JSON 格式返回，不要包含其他内容：
{
  "score": 总分（五维度之和），
  "details": {
    "audienceFit": 分数,
    "emotionalValue": 分数,
    "simplificationPotential": 分数,
    "networkVolume": 分数,
    "contentValue": 分数
  },
  "reason": "评分理由，指出最匹配哪个用户画像以及商业转化潜力（100字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}`;

      // 调用 AI 模型
      const result = await this.aiClient.generate(
        modelId,
        [{ role: 'user', content: prompt }],
        { knowledgeMode: 'contextual' },
      );

      // 解析 AI 响应
      const parsed = this.parseAiResponse(result);

      // 更新选题评分
      await this.topicsService.updateScore(
        topicId,
        parsed.score,
        parsed.details,
        parsed.reason,
        parsed.keywords,
      );

      this.logger.log(`选题评分完成: ${topicId}, 得分: ${parsed.score}`);
      return parsed;
    } catch (error) {
      this.logger.error(`选题评分失败: ${topicId}`, error);
      // 评分失败，回退状态
      await this.topicsService.updateStatus(topicId, 'pending');
      throw error;
    }
  }

  // 解析 AI 响应为评分结果
  private parseAiResponse(response: string) {
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('未找到 JSON 格式的评分结果');

      const parsed = JSON.parse(jsonMatch[0]);

      // 验证必要字段
      if (!parsed.score || !parsed.details) {
        throw new Error('评分结果缺少必要字段');
      }

      return {
        score: Math.round(parsed.score),
        details: {
          audienceFit: parsed.details.audienceFit || 0,
          emotionalValue: parsed.details.emotionalValue || 0,
          simplificationPotential: parsed.details.simplificationPotential || 0,
          networkVolume: parsed.details.networkVolume || 0,
          contentValue: parsed.details.contentValue || 0,
        },
        reason: parsed.reason || '',
        keywords: parsed.keywords || [],
      };
    } catch (error) {
      this.logger.warn(`解析 AI 响应失败，使用默认评分: ${error}`);
      // 解析失败时返回默认值
      return {
        score: 60,
        details: {
          audienceFit: 12,
          emotionalValue: 12,
          simplificationPotential: 12,
          networkVolume: 12,
          contentValue: 12,
        },
        reason: 'AI 评分解析异常，使用默认评分',
        keywords: [],
      };
    }
  }
}
