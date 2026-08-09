import { BadRequestException, Injectable } from '@nestjs/common';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import { LocalEngineService } from './local-engine.service';
import type { InteractionTask } from './local-engine.types';

export type CreateWechatMomentsRevisionInput = {
  planName?: string;
  content?: string;
  additionalComment?: string;
  assetPaths?: string[];
  visibility?: string;
  scheduleStartTime?: string;
  momentsDetails?: Array<Record<string, unknown>>;
};

@Injectable()
export class WechatPlanEditorService {
  constructor(
    private readonly localEngine: LocalEngineService,
    private readonly aiClient: AiClientService,
    private readonly defaultModels: DefaultModelsService,
  ) {}

  async createMomentsRevision(
    id: string,
    input: CreateWechatMomentsRevisionInput,
  ) {
    const source = await this.requireMomentsTask(id);
    const content = this.text(input.content) || source.replyText;
    if (!content) {
      throw new BadRequestException('请填写朋友圈文案。');
    }
    const assetPaths = this.stringList(input.assetPaths);
    const metadata = source.metadata || {};
    const revision = this.readRevision(metadata) + 1;
    const scheduleStartTime = this.text(input.scheduleStartTime);
    const momentsDetails = Array.isArray(input.momentsDetails)
      ? input.momentsDetails.slice(0, 100)
      : [
          {
            content,
            additionalComment: this.text(input.additionalComment),
            assetPaths,
            visibility: this.text(input.visibility) || 'public',
            scheduledPublishTime: scheduleStartTime,
          },
        ];

    return this.localEngine.createTask({
      type: source.type,
      accountId: source.accountId,
      accountName: source.accountName,
      platformType: source.platformType,
      platformName: source.platformName,
      targetName: source.targetName,
      sourceText: content,
      replyText: content,
      planName:
        this.text(input.planName) ||
        `${source.planName || '朋友圈计划'} 修订版`,
      planStatus: 'draft',
      planTime: scheduleStartTime,
      scheduleStartTime,
      momentsDetails,
      momentsTotalCount: momentsDetails.length,
      sendMode: source.sendMode || 'auto-send',
      commercialExecutionRequested: false,
      metadata: {
        ...metadata,
        revisionOfPlanId: source.id,
        planRevision: revision,
        wechat_moments_content: content,
        wechat_moments_additional_comment: this.text(input.additionalComment),
        wechat_moments_asset_paths: assetPaths,
        wechat_moments_visibility: this.text(input.visibility) || 'public',
        scheduleStartTime,
        wechat_moments_schedule_start_time: scheduleStartTime,
        momentsDetails,
        wechat_moments_details: momentsDetails,
      },
    });
  }

  async regenerateMomentsContent(
    id: string,
    input: { instruction?: string; currentContent?: string },
  ) {
    const source = await this.requireMomentsTask(id);
    return this.generateMomentsContent({
      instruction: input.instruction,
      currentContent:
        this.text(input.currentContent) ||
        source.replyText ||
        source.sourceText,
    });
  }

  generateMomentsDraftContent(input: {
    instruction?: string;
    currentContent?: string;
  }) {
    return this.generateMomentsContent(input);
  }

  private async generateMomentsContent(input: {
    instruction?: string;
    currentContent?: string;
  }) {
    const defaults = await this.defaultModels.getDefaults();
    const modelId = defaults.articleCreation || defaults.topicSelection;
    if (!modelId) {
      throw new BadRequestException('请先在模型设置中选择文本模型。');
    }
    const currentContent = this.text(input.currentContent);
    const instruction =
      this.text(input.instruction) ||
      (currentContent
        ? '保持事实不变，改得更自然、更适合朋友圈。'
        : '生成一条简洁、真实、适合朋友圈的商业文案。');
    const generated = await this.aiClient.generate(
      modelId,
      [
        {
          role: 'system',
          content:
            '你是商业朋友圈文案编辑。只输出可直接发布的正文，不解释、不使用代码块，不虚构价格、效果或承诺。',
        },
        {
          role: 'user',
          content: `原文：\n${currentContent || '暂无原文'}\n\n修改要求：\n${instruction}`,
        },
      ],
      { temperature: 0.7, maxTokens: 800 },
    );
    const content = generated
      .replace(/^```(?:text|markdown)?\s*/i, '')
      .replace(/```$/i, '')
      .trim()
      .slice(0, 2000);
    if (!content) {
      throw new BadRequestException('本次没有生成可用文案，请调整要求后重试。');
    }
    return { content };
  }

  linkAgentSession(id: string, sessionId: string) {
    return this.localEngine.linkAgentSessionToTask(id, sessionId);
  }

  private async requireMomentsTask(id: string): Promise<InteractionTask> {
    const task = await this.localEngine.getTaskForDisplay(id);
    if (
      task.type !== 'wechat-moments-publish' &&
      task.type !== 'wechat-moments-marketing'
    ) {
      throw new BadRequestException('该记录不是朋友圈计划。');
    }
    return task;
  }

  private text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private stringList(value: unknown) {
    return Array.isArray(value)
      ? value
          .map((item) => this.text(item))
          .filter(Boolean)
          .slice(0, 20)
      : [];
  }

  private readRevision(metadata: Record<string, unknown>) {
    const value = Number(metadata.planRevision || metadata.plan_revision || 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }
}
