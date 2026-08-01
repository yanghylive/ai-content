import { Injectable } from '@nestjs/common';
import {
  AnalyzeCommentsDto,
  CommentInputDto,
} from './dto/analyze-comments.dto';
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
    return {
      items: [],
      total: 0,
      message: '当前返回实时评论洞察；正式洞察记录会由后续任务链统一沉淀。',
      workflow: this.workflow(),
    };
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
