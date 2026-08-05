import { Injectable } from '@nestjs/common';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import {
  AnalyzeCommentsDto,
  CommentInputDto,
} from './dto/analyze-comments.dto';
import { ReplySuggestDto } from './dto/reply-suggest.dto';
import { QueryCommentInsightsDto } from './dto/query-comment-insights.dto';
import type {
  CommentAnalyzeResult,
  CommentInsightRiskLevel,
  CommentInsightsListResult,
  CommentInsightsPlatform,
  CommentInsightsWorkflowTrace,
  CommentSourceType,
  DemandInsight,
  IntentKeywordInsight,
  NormalizedComment,
  ObjectionInsight,
  PainPointInsight,
  ReplySuggestion,
} from './comment-insights.types';

const PAIN_RULES = [
  {
    theme: '价格顾虑',
    keywords: ['贵', '价格', '多少钱', '预算', '收费'],
    suggestion: '补充套餐、适用人群和投入产出解释',
  },
  {
    theme: '操作门槛',
    keywords: ['不会', '怎么弄', '教程', '步骤', '小白'],
    suggestion: '增加新手流程、截图或短视频演示',
  },
  {
    theme: '效果不确定',
    keywords: ['有用吗', '没效果', '真的假的', '靠谱吗', '案例'],
    suggestion: '补充真实案例、前后对比和适用边界',
  },
  {
    theme: '交付和售后',
    keywords: ['多久', '售后', '退款', '服务', '保障'],
    suggestion: '明确交付周期、服务范围和售后规则',
  },
  {
    theme: '资料需求',
    keywords: ['资料', '模板', '清单', '链接', '领取'],
    suggestion: '沉淀资料领取规则，回复前保持人工确认',
  },
];

const DEMAND_RULES = [
  {
    demand: '要模板/清单',
    keywords: ['模板', '清单', '资料', '表格'],
    contentOpportunity: '制作可收藏的模板合集或下载前说明帖',
  },
  {
    demand: '要案例拆解',
    keywords: ['案例', '对比', '复盘', '真实'],
    contentOpportunity: '发布前后对比、客户场景和结果拆解',
  },
  {
    demand: '要价格说明',
    keywords: ['多少钱', '价格', '收费', '套餐'],
    contentOpportunity: '整理价格 FAQ 和不同预算下的选择建议',
  },
  {
    demand: '要上手教程',
    keywords: ['教程', '步骤', '怎么', '不会'],
    contentOpportunity: '发布从 0 到 1 的操作教程和常见错误清单',
  },
];

const OBJECTION_RULES = [
  {
    objection: '太贵或预算不足',
    keywords: ['贵', '预算', '便宜'],
    replyAngle: '先解释适用场景，再给低门槛试用或轻量方案',
  },
  {
    objection: '担心无效',
    keywords: ['没效果', '有用吗', '靠谱吗', '真的假的'],
    replyAngle: '用边界条件和案例说明，避免承诺绝对结果',
  },
  {
    objection: '担心操作复杂',
    keywords: ['不会', '麻烦', '复杂', '学不会'],
    replyAngle: '给出第一步行动，并承诺可人工协助确认',
  },
  {
    objection: '售后/退款疑虑',
    keywords: ['退款', '售后', '保障'],
    replyAngle: '说明服务边界、响应时间和正式售后入口',
  },
];

const INTENT_KEYWORDS = [
  { keyword: '多少钱', intentLevel: 'purchase' as const },
  { keyword: '价格', intentLevel: 'purchase' as const },
  { keyword: '怎么买', intentLevel: 'purchase' as const },
  { keyword: '下单', intentLevel: 'purchase' as const },
  { keyword: '咨询', intentLevel: 'consult' as const },
  { keyword: '想要', intentLevel: 'consult' as const },
  { keyword: '试用', intentLevel: 'consult' as const },
  { keyword: '链接', intentLevel: 'consult' as const },
  { keyword: '看看', intentLevel: 'browse' as const },
];

@Injectable()
export class CommentInsightsService {
  constructor(
    private readonly aiClient?: AiClientService,
    private readonly defaultModels?: DefaultModelsService,
  ) {}

  analyze(dto: AnalyzeCommentsDto): CommentAnalyzeResult {
    const comments = this.normalizeComments(dto.comments, dto);
    const platform = this.normalizePlatform(dto.platform);
    const sourceType = this.normalizeSourceType(
      dto.sourceType,
      comments.length,
    );
    const painPoints = this.detectPainPoints(comments);
    const demands = this.detectDemands(comments);
    const objections = this.detectObjections(comments);
    const intentKeywords = this.detectIntentKeywords(comments);
    const topQuestions = this.extractTopQuestions(comments);
    const replySuggestions = this.buildReplySuggestions(
      dto,
      painPoints,
      demands,
      objections,
      intentKeywords,
    );

    return {
      insightId: this.makeInsightId(),
      platform,
      sourceType,
      sourceUrl: dto.sourceUrl,
      workTitle: dto.workTitle,
      analyzedCount: comments.length,
      summary: this.buildSummary(comments.length, painPoints, intentKeywords),
      painPoints,
      demands,
      objections,
      intentKeywords,
      topQuestions,
      replySuggestions,
      suggestedReplyRules: this.buildReplyRules(painPoints, intentKeywords),
      workflow: this.workflow(),
    };
  }

  list(_query: QueryCommentInsightsDto): CommentInsightsListResult {
    void _query; // 预留查询参数，洞察记录后续由任务链沉淀
    return {
      items: [],
      total: 0,
      message: '当前返回实时评论洞察；正式洞察记录会由后续任务链统一沉淀。',
      workflow: this.workflow(),
    };
  }

  /**
   * D2 AI 回复建议：单条评论 → 千问生成 2-3 版拟人化回复。
   * 复用 ai-models 非流式 generate；模型不可用时降级返回本地规则建议。
   */
  async suggestReply(dto: ReplySuggestDto) {
    const comment = dto.comment?.trim();
    if (!comment) {
      return { suggestions: [], message: '缺少评论内容（comment）' };
    }
    const productName = dto.productName?.trim() || '我们';
    const requestedTone = dto.tone;

    // 1) 本地规则兜底（始终可用）
    const localSuggestions = this.buildLocalReplySuggestions(
      comment,
      productName,
    );

    // 2) 尝试 AI 生成（失败不阻塞，降级本地建议）
    try {
      if (this.aiClient && this.defaultModels) {
        const aiSuggestions = await this.generateAiReplySuggestions(
          comment,
          productName,
          requestedTone,
        );
        if (aiSuggestions.length > 0) {
          return {
            suggestions: aiSuggestions,
            source: 'ai',
            fallback: localSuggestions,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 生成失败';
      return {
        suggestions: localSuggestions,
        source: 'local',
        fallbackMessage: message.slice(0, 120),
      };
    }

    return { suggestions: localSuggestions, source: 'local' };
  }

  private async generateAiReplySuggestions(
    comment: string,
    productName: string,
    requestedTone?: 'formal' | 'friendly' | 'professional',
  ): Promise<Array<{ tone: string; content: string }>> {
    const modelId = await this.resolveChatModelId();
    if (!modelId) return [];

    const toneList = requestedTone
      ? ([requestedTone] as Array<'formal' | 'friendly' | 'professional'>)
      : (['friendly', 'formal', 'professional'] as Array<
          'formal' | 'friendly' | 'professional'
        >);
    const toneLabels: Record<'formal' | 'friendly' | 'professional', string> = {
      friendly: '亲切自然，像朋友聊天，口语化',
      formal: '正式得体，礼貌客气，书面化',
      professional: '专业可信，突出价值，克制营销感',
    };

    const prompt = `你是内容运营的回复助手。用户收到一条平台评论，请按指定语气各生成一条回复建议。
要求：
- 每条 30-80 字，口语自然，不机械
- 不夸大产品效果，不承诺绝对结果
- 有购买意向的评论可自然带出产品「${productName}」，但不要硬推销
- 直接输出 JSON 数组：[{"tone":"friendly","content":"..."}]
- 只输出 JSON，不要多余解释

评论内容：${comment.slice(0, 500)}

语气要求：
${toneList.map((tone) => `- ${tone}：${toneLabels[tone]}`).join('\n')}`;

    const raw = await this.aiClient!.generate(
      modelId,
      [
        {
          role: 'system',
          content:
            '你是内容运营回复助手，只输出合法 JSON 数组，每条回复 30-80 字，自然不机械。',
        },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 800, temperature: 0.7, knowledgeMode: 'off' },
    );

    return this.parseAiSuggestions(raw);
  }

  private parseAiSuggestions(
    raw: string,
  ): Array<{ tone: string; content: string }> {
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => {
          const entry = item as Record<string, unknown>;
          const content =
            typeof entry.content === 'string' ? entry.content.trim() : '';
          const tone =
            typeof entry.tone === 'string' ? entry.tone.trim() : 'friendly';
          if (!content) return null;
          return { tone, content: content.slice(0, 300) };
        })
        .filter((item): item is { tone: string; content: string } =>
          Boolean(item),
        )
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  private buildLocalReplySuggestions(
    comment: string,
    productName: string,
  ): Array<{ tone: string; content: string }> {
    const text = comment.toLocaleLowerCase();
    let reply: string;
    if (/多少钱|价格|怎么买|下单|链接/.test(text)) {
      reply = `谢谢关注！关于${productName}的价格和购买方式，方便的话可以私信我，我给您发详细方案～`;
    } else if (/有用吗|靠谱吗|没效果|真的假的/.test(text)) {
      reply = `理解您的顾虑～${productName}更适合对内容运营有需求、愿意花时间试用的团队，可以先小范围试试效果再决定。`;
    } else if (/不会|怎么弄|麻烦|复杂|小白/.test(text)) {
      reply = `不用担心上手问题，我们有新手引导，也可以安排专人带您走一遍流程～`;
    } else if (/谢谢|感谢|不错|好用/.test(text)) {
      reply = `谢谢支持！后续有任何问题随时找我～`;
    } else {
      reply = `谢谢您的评论！方便的话可以私信聊聊您的具体需求，我帮您看看怎么配合适～`;
    }
    return [
      { tone: 'friendly', content: reply },
      {
        tone: 'formal',
        content: `感谢您的留言。关于${productName}，如需进一步了解可私信联系，我们将尽快回复您。`,
      },
      {
        tone: 'professional',
        content: `收到您的反馈。${productName}的核心是帮团队提升内容产出效率，如果您有具体场景，欢迎私信详聊，我们按需提供方案。`,
      },
    ];
  }

  private async resolveChatModelId(): Promise<string> {
    try {
      const defaults = await this.defaultModels?.getDefaults();
      const modelId =
        defaults?.articleCreation ||
        defaults?.topicSelection ||
        defaults?.xCollection ||
        '';
      if (modelId) return modelId;
    } catch {
      /* 忽略默认模型解析失败 */
    }
    return '';
  }

  private normalizeComments(
    input: Array<string | CommentInputDto> | undefined,
    dto: AnalyzeCommentsDto,
  ): NormalizedComment[] {
    const source =
      input && input.length > 0 ? input : this.fallbackComments(dto);
    return source
      .map((item, index) => {
        if (typeof item === 'string') {
          return { id: `comment-${index + 1}`, content: item.trim() };
        }
        return {
          id: item.id || `comment-${index + 1}`,
          author: item.author,
          content: String(item.content || '').trim(),
          likedCount: item.likedCount,
          publishedAt: item.publishedAt,
        };
      })
      .filter((comment) => comment.content);
  }

  private fallbackComments(dto: AnalyzeCommentsDto): string[] {
    const topic = dto.workTitle || dto.keyword || dto.productName || '这个方案';
    return [
      `${topic}适合小白吗？有没有步骤教程`,
      `多少钱，想先看看案例`,
      `有没有模板可以参考，自己做总是没效果`,
      `后续售后怎么保障，担心买了不会用`,
    ];
  }

  private detectPainPoints(comments: NormalizedComment[]): PainPointInsight[] {
    return PAIN_RULES.map((rule) => {
      const evidence = this.matchEvidence(comments, rule.keywords);
      if (evidence.length === 0) return null;
      return {
        theme: rule.theme,
        severity: this.toSeverity(evidence.length),
        count: evidence.length,
        evidence,
        suggestion: rule.suggestion,
      };
    }).filter(Boolean) as PainPointInsight[];
  }

  private detectDemands(comments: NormalizedComment[]): DemandInsight[] {
    return DEMAND_RULES.map((rule) => {
      const evidence = this.matchEvidence(comments, rule.keywords);
      if (evidence.length === 0) return null;
      return {
        demand: rule.demand,
        count: evidence.length,
        evidence,
        contentOpportunity: rule.contentOpportunity,
      };
    }).filter(Boolean) as DemandInsight[];
  }

  private detectObjections(comments: NormalizedComment[]): ObjectionInsight[] {
    return OBJECTION_RULES.map((rule) => {
      const evidence = this.matchEvidence(comments, rule.keywords);
      if (evidence.length === 0) return null;
      return {
        objection: rule.objection,
        count: evidence.length,
        evidence,
        replyAngle: rule.replyAngle,
      };
    }).filter(Boolean) as ObjectionInsight[];
  }

  private detectIntentKeywords(
    comments: NormalizedComment[],
  ): IntentKeywordInsight[] {
    return INTENT_KEYWORDS.map((rule) => {
      const evidence = this.matchEvidence(comments, [rule.keyword]);
      if (evidence.length === 0) return null;
      return {
        keyword: rule.keyword,
        intentLevel: rule.intentLevel,
        count: evidence.length,
        evidence,
      };
    }).filter(Boolean) as IntentKeywordInsight[];
  }

  private extractTopQuestions(comments: NormalizedComment[]) {
    return comments
      .map((comment) => comment.content)
      .filter((content) => /[?？]|怎么|哪里|多少钱|多久|适合/.test(content))
      .slice(0, 5);
  }

  private buildReplySuggestions(
    dto: AnalyzeCommentsDto,
    painPoints: PainPointInsight[],
    demands: DemandInsight[],
    objections: ObjectionInsight[],
    intentKeywords: IntentKeywordInsight[],
  ): ReplySuggestion[] {
    const productName = dto.productName || '这套方案';
    const topPain = painPoints[0]?.theme || '具体使用问题';
    const topDemand = demands[0]?.demand || '进一步了解';
    const hasPurchaseIntent = intentKeywords.some(
      (item) => item.intentLevel === 'purchase',
    );
    const topObjection =
      objections[0]?.replyAngle || '先确认对方场景，再给适配建议';

    return [
      {
        scenario: '高意向咨询',
        tone: '专业、克制、待确认',
        content: hasPurchaseIntent
          ? `可以的，${productName}会根据你的行业和当前阶段给建议。你方便说下现在主要卡在预算、获客还是内容转化吗？我先帮你判断适不适合。`
          : `你这个问题很典型，先看你更想解决「${topPain}」还是「${topDemand}」。确认场景后，我可以给你一个更具体的方向。`,
        riskLevel: hasPurchaseIntent ? 'medium' : 'low',
        requiresHumanReview: true,
      },
      {
        scenario: '异议处理',
        tone: '解释边界、不夸大承诺',
        content: `${topObjection}。我们不会承诺绝对结果，更建议先看你的账号阶段和内容基础，再判断该怎么做。`,
        riskLevel: 'low',
        requiresHumanReview: true,
      },
      {
        scenario: '资料需求',
        tone: '友好、平台内承接',
        content:
          '可以，我先确认你需要的是模板、案例还是操作步骤。你在评论区补充一下使用场景，我按场景给你对应建议。',
        riskLevel: 'low',
        requiresHumanReview: true,
      },
    ];
  }

  private buildReplyRules(
    painPoints: PainPointInsight[],
    intentKeywords: IntentKeywordInsight[],
  ) {
    const rules = painPoints
      .slice(0, 3)
      .map(
        (point) =>
          `当评论提到「${point.theme}」时，先询问场景，再给一条具体建议，不直接诱导站外联系。`,
      );
    if (intentKeywords.some((item) => item.intentLevel === 'purchase')) {
      rules.push(
        '当评论出现价格、购买、下单等高意向词时，默认进入待我确认，不自动创建线索或自动发送私信。',
      );
    }
    return rules.length
      ? rules
      : ['评论回复建议默认进入待确认，禁止自动发送和自动私信。'];
  }

  private matchEvidence(comments: NormalizedComment[], keywords: string[]) {
    return comments
      .filter((comment) =>
        keywords.some((keyword) => comment.content.includes(keyword)),
      )
      .map((comment) => comment.content)
      .slice(0, 5);
  }

  private buildSummary(
    count: number,
    painPoints: PainPointInsight[],
    intentKeywords: IntentKeywordInsight[],
  ) {
    const topPain = painPoints[0]?.theme || '暂无集中痛点';
    const highIntentCount = intentKeywords
      .filter(
        (item) =>
          item.intentLevel === 'purchase' || item.intentLevel === 'consult',
      )
      .reduce((sum, item) => sum + item.count, 0);
    return `已分析 ${count} 条评论，主要痛点为「${topPain}」，识别到 ${highIntentCount} 次咨询或购买意向表达。`;
  }

  private workflow(): CommentInsightsWorkflowTrace {
    return {
      source: 'local_rule',
      status: 'rule_screening',
      plannedSkill: '抖音评论分析 / 小红书评论分析',
      redfoxClientHook:
        'RedFox Client 可继续接入平台评论分析、标准化评论、沉淀 CommentInsight 和调用日志',
      generatedAt: new Date().toISOString(),
    };
  }

  private toSeverity(count: number): CommentInsightRiskLevel {
    if (count >= 4) return 'high';
    if (count >= 2) return 'medium';
    return 'low';
  }

  private normalizePlatform(
    platform?: CommentInsightsPlatform,
  ): CommentInsightsPlatform {
    return platform || 'all';
  }

  private normalizeSourceType(
    sourceType: CommentSourceType | undefined,
    commentCount: number,
  ): CommentSourceType {
    return sourceType || (commentCount > 0 ? 'manual_comments' : 'keyword');
  }

  private makeInsightId() {
    return `comment-insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
