// 关键词智能生成服务（C 类专项，C-a 规则版）。
// 目标：从真实线索行为里「反推」下一轮该搜什么关键词，跑通「反馈回流」闭环。
//
// C-a 规则版（本文件）：不接 LLM，用「词库命中统计 + 正负反馈分流」。
// 从 Lead.sourceText 统计「现有行业词库（growth-keywords.data.ts）中哪些词命中真客户多、
// 哪些词命中负反馈多」，产出 sourceKeywords / demandKeywords / excludeKeywords 三类建议，
// 每条词带证据归因（命中线索数），供前端展示 + 人工采纳写回策略。
//
// 为什么不用 n-gram 分词：中文无现成分词库，n-gram 会把「多少钱价格」切成「钱价格」等
// 跨词粘连伪词。改用「词库词表扫描」零垃圾词、直接复用 14 行业词库，还能反哺词库调优。
// C-b LLM 版（后续增强）：复用 AiClientService 做语义归纳「造新词」，共用同一套
// 「建议 → 人工采纳 → 写回」链路。
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { DefaultModelsService } from '../ai-models/default-models.service';
import {
  INDUSTRY_KEYWORD_PRESETS,
  industryKeywordPreset,
} from '../growth/growth-keywords.data';

/** 单条关键词建议（带证据归因，供前端展示 + 人工判断） */
export interface KeywordSuggestion {
  keyword: string;
  /** 命中线索数（证据强度） */
  evidenceCount: number;
  /** 来源维度：positive（真客户/成交线索）或 negative（负反馈线索） */
  source: 'positive' | 'negative';
}

/** 关键词建议结果（C-a 产出，尚未写回策略） */
export interface KeywordSuggestions {
  generatedAt: string;
  /** 分析窗口内的线索总数 */
  analyzedLeadCount: number;
  /** 正反馈线索数（有回复互动/已成交） */
  positiveLeadCount: number;
  /** 负反馈线索数（risk.negative_feedback / opt_out 信号） */
  negativeLeadCount: number;
  /** 第一段「搜账号」建议词（正反馈线索命中行业 sourceKeywords 的高频词） */
  sourceKeywords: KeywordSuggestion[];
  /** 识别意向建议词（正反馈线索命中 demandKeywords/同义词的高频词） */
  demandKeywords: KeywordSuggestion[];
  /** 排除建议词（负反馈线索里高频出现的词） */
  excludeKeywords: KeywordSuggestion[];
}

@Injectable()
export class KeywordIntelligenceService {
  private readonly logger = new Logger(KeywordIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient?: AiClientService,
    private readonly defaultModels?: DefaultModelsService,
  ) {}

  /**
   * 分析某用户/账号近 N 天线索，产出关键词建议（C-a 规则版）。
   * 不写回策略——返回建议供上层（controller/前端）展示，由人工采纳后走 updateStrategy 写回。
   */
  async suggestKeywords(input: {
    userId: string;
    tenantId?: string | null;
    /** 平台（可选，不传则聚合全部平台线索） */
    platform?: string;
    /** 行业（可选，用于选词库；不传则全词库扫描） */
    industry?: string;
    /** 分析窗口天数（默认 30） */
    windowDays?: number;
    /** 最少线索数阈值：低于此值不产出建议（样本不足，归纳不可靠） */
    minLeadCount?: number;
  }): Promise<KeywordSuggestions> {
    const windowDays = input.windowDays ?? 30;
    const minLeadCount = input.minLeadCount ?? 10;
    const since = new Date(Date.now() - windowDays * 24 * 3600_000);

    // 聚合线索：userId 维度（tenantId 可选条件）
    const leads = await this.prisma.lead.findMany({
      where: {
        userId: input.userId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
        createdAt: { gte: since },
        sourceText: { not: null },
      },
      select: {
        id: true,
        sourceText: true,
        customerId: true,
        signals: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    if (leads.length < minLeadCount) {
      this.logger.log(
        `关键词建议样本不足（${leads.length} < ${minLeadCount}），跳过归纳`,
      );
      return this.emptySuggestions(leads.length);
    }

    const { positiveTexts, negativeTexts, positiveCount, negativeCount } =
      this.splitByFeedback(leads);

    // 词库词表（按行业选词库，未指定则全词库并集）
    const presets = input.industry
      ? [industryKeywordPreset(input.industry)].filter(
          (p): p is NonNullable<typeof p> => Boolean(p),
        )
      : INDUSTRY_KEYWORD_PRESETS;

    const sourcePool = new Set<string>();
    const demandPool = new Set<string>();
    const excludePool = new Set<string>();
    for (const preset of presets) {
      (preset.sourceKeywords ?? []).forEach((w) => sourcePool.add(w));
      (preset.demandKeywords ?? []).forEach((w) => demandPool.add(w));
      (preset.excludeKeywords ?? []).forEach((w) => excludePool.add(w));
      // 同义词簇也纳入 demand 词表
      (preset.demandSynonymGroups ?? []).forEach((group) =>
        group.forEach((w) => demandPool.add(w)),
      );
    }

    // 词库词表扫描：统计正反馈线索里命中哪些 source/demand 词、负反馈里命中哪些词
    const sourceFreq = this.countHits(positiveTexts, sourcePool);
    const demandFreq = this.countHits(positiveTexts, demandPool);
    // exclude 候选 = 负反馈线索里命中的词（从 excludePool + demandPool 里找，表示「这些词带来的是反感」）
    const negativeHitPool = new Set([...excludePool, ...demandPool]);
    const excludeFreq = this.countHits(negativeTexts, negativeHitPool);

    return {
      generatedAt: new Date().toISOString(),
      analyzedLeadCount: leads.length,
      positiveLeadCount: positiveCount,
      negativeLeadCount: negativeCount,
      sourceKeywords: this.toSuggestions(sourceFreq, 'positive', 8),
      demandKeywords: this.toSuggestions(demandFreq, 'positive', 8),
      excludeKeywords: this.toSuggestions(excludeFreq, 'negative', 8),
    };
  }

  /**
   * C-b LLM 语义归纳版：把正/负反馈线索的 sourceText 原文喂给 LLM，
   * 让模型「语义归纳造新词」——这是 C-a 词库命中统计做不到的
   * （客户都在问「穿戴甲」而词库没有时，只有 LLM 能从原文里提炼出来）。
   *
   * 降级策略：LLM 不可用（无 AiClientService / 无默认模型 / 调用失败 / 解析失败）
   * 一律回落到 C-a 规则版结果，保证链路不断、不抛错。
   */
  async suggestKeywordsWithLLM(input: {
    userId: string;
    tenantId?: string | null;
    platform?: string;
    industry?: string;
    windowDays?: number;
    minLeadCount?: number;
    /** 每类建议最多产出条数（默认 8） */
    topN?: number;
  }): Promise<KeywordSuggestions> {
    const topN = input.topN ?? 8;

    // 先跑 C-a 规则版作为兜底（同时拿到分流后的正/负反馈文本）
    const ruleResult = await this.suggestKeywords({
      userId: input.userId,
      tenantId: input.tenantId,
      platform: input.platform,
      industry: input.industry,
      windowDays: input.windowDays,
      minLeadCount: input.minLeadCount,
    });

    // 样本不足直接返回空（LLM 也无从归纳）
    if (ruleResult.analyzedLeadCount < (input.minLeadCount ?? 10)) {
      return ruleResult;
    }

    // 无 LLM 能力 → 回落规则版
    if (!this.aiClient || !this.defaultModels) {
      this.logger.log(
        'C-b 无 AiClientService/DefaultModelsService，回落 C-a 规则版',
      );
      return ruleResult;
    }

    const modelId = await this.resolveChatModelId();
    if (!modelId) {
      this.logger.log('C-b 无默认聊天模型，回落 C-a 规则版');
      return ruleResult;
    }

    // 重新取线索做 LLM 归纳（需要原文，规则版内部已分流但未暴露文本）
    const leads = await this.loadLeads(input);
    if (leads.length < (input.minLeadCount ?? 10)) {
      return ruleResult;
    }
    const { positiveTexts, negativeTexts, positiveCount, negativeCount } =
      this.splitByFeedback(leads);

    try {
      const prompt = this.buildLLMPrompt(
        positiveTexts,
        negativeTexts,
        input.industry,
        topN,
      );
      const raw = await this.aiClient.generate(
        modelId,
        [
          {
            role: 'system',
            content:
              '你是获客关键词分析师。只输出合法 JSON，不要任何多余解释、不要 markdown 代码块。',
          },
          { role: 'user', content: prompt },
        ],
        {
          maxTokens: 1200,
          temperature: 0.3,
          knowledgeMode: 'off',
          // 每次归纳都是新意图，传新盐避免计费幂等判定 409
          billingSalt: `keyword-intel:${Date.now()}:${Math.random()
            .toString(36)
            .slice(2, 8)}`,
        },
      );

      const parsed = this.parseLLMResult(raw, topN);
      if (!parsed) {
        this.logger.warn('C-b LLM 结果解析失败，回落 C-a 规则版');
        return ruleResult;
      }

      return {
        generatedAt: new Date().toISOString(),
        analyzedLeadCount: leads.length,
        positiveLeadCount: positiveCount,
        negativeLeadCount: negativeCount,
        ...parsed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM 归纳失败';
      this.logger.warn(`C-b LLM 归纳失败（${message}），回落 C-a 规则版`);
      return ruleResult;
    }
  }

  /** 取用户/账号近 N 天线索原文（sourceText） */
  private async loadLeads(input: {
    userId: string;
    tenantId?: string | null;
    platform?: string;
    windowDays?: number;
  }): Promise<
    Array<{
      sourceText: string | null;
      customerId: string | null;
      signals: unknown;
    }>
  > {
    const since = new Date(
      Date.now() - (input.windowDays ?? 30) * 24 * 3600_000,
    );
    return this.prisma.lead.findMany({
      where: {
        userId: input.userId,
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        ...(input.platform ? { platform: input.platform } : {}),
        createdAt: { gte: since },
        sourceText: { not: null },
      },
      select: {
        sourceText: true,
        customerId: true,
        signals: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /** 正/负反馈分流（复用同一套信号判定规则） */
  private splitByFeedback(
    leads: Array<{
      sourceText: string | null;
      customerId: string | null;
      signals: unknown;
    }>,
  ): {
    positiveTexts: string[];
    negativeTexts: string[];
    positiveCount: number;
    negativeCount: number;
  } {
    const positiveTexts: string[] = [];
    const negativeTexts: string[] = [];
    let positiveCount = 0;
    let negativeCount = 0;

    for (const lead of leads) {
      const signals = Array.isArray(lead.signals) ? lead.signals : [];
      const signalTypes = new Set(
        signals.map((s: unknown) =>
          typeof s === 'object' && s !== null && 'type' in s
            ? String(s.type)
            : '',
        ),
      );
      const isNegative =
        signalTypes.has('risk.negative_feedback') ||
        signalTypes.has('risk.opt_out');
      const isPositive =
        Boolean(lead.customerId) ||
        signalTypes.has('engagement.reply') ||
        signalTypes.has('engagement.repeat') ||
        signalTypes.has('intent.explicit_request') ||
        signalTypes.has('intent.price') ||
        signalTypes.has('intent.question');

      const text = (lead.sourceText ?? '').trim();
      if (!text) continue;

      if (isNegative) {
        negativeTexts.push(text);
        negativeCount += 1;
      } else if (isPositive) {
        positiveTexts.push(text);
        positiveCount += 1;
      }
      // 中性线索不参与
    }

    return { positiveTexts, negativeTexts, positiveCount, negativeCount };
  }

  private emptySuggestions(analyzedLeadCount: number): KeywordSuggestions {
    return {
      generatedAt: new Date().toISOString(),
      analyzedLeadCount,
      positiveLeadCount: 0,
      negativeLeadCount: 0,
      sourceKeywords: [],
      demandKeywords: [],
      excludeKeywords: [],
    };
  }

  private async resolveChatModelId(): Promise<string> {
    try {
      const defaults = await this.defaultModels?.getDefaults();
      const modelId =
        defaults?.topicSelection ||
        defaults?.articleCreation ||
        defaults?.xCollection ||
        '';
      if (modelId) return modelId;
    } catch {
      /* 忽略默认模型解析失败 */
    }
    return '';
  }

  /** 构造 LLM 归纳 prompt：喂原文样本，要求产出严格 JSON */
  private buildLLMPrompt(
    positiveTexts: string[],
    negativeTexts: string[],
    industry: string | undefined,
    topN: number,
  ): string {
    const posSamples = positiveTexts
      .slice(0, 120)
      .map((t) => `- ${t.slice(0, 120)}`)
      .join('\n');
    const negSamples = negativeTexts
      .slice(0, 60)
      .map((t) => `- ${t.slice(0, 120)}`)
      .join('\n');

    const industryHint = industry ? `\n行业背景：${industry}` : '';

    return `你是获客关键词分析师。下面给了「有购买/回复意向的真客户」和「反感/拉黑/举报的负反馈」两类真实线索原文，
请你语义归纳出下一轮该搜的关键词。

要求：
1. sourceKeywords（搜账号词）：从真客户原文里提炼他们关心/提到的具体品类、需求、痛点词（2-6 个字，宁可具体不要泛）。词库里没有的新词尤其重要。
2. demandKeywords（识别意向词）：真客户用来表达购买意向的说法。
3. excludeKeywords（排除词）：负反馈原文里反复出现、代表反感的词（别再搜这些）。
4. 每条词后面用一句话说明理由，并估计它命中了多少条线索（evidenceCount，取 1-500 的整数）。
5. 每类最多 ${topN} 条，宁缺毋滥；证据不足的类别返回空数组。

${industryHint}

真客户线索原文（${positiveTexts.length} 条）：
${posSamples || '（无）'}

负反馈线索原文（${negativeTexts.length} 条）：
${negSamples || '（无）'}

只输出如下 JSON（不要 markdown 代码块、不要多余文字）：
{"sourceKeywords":[{"keyword":"","reason":"","evidenceCount":0}],"demandKeywords":[{"keyword":"","reason":"","evidenceCount":0}],"excludeKeywords":[{"keyword":"","reason":"","evidenceCount":0}]}`;
  }

  /** 解析 LLM 返回的 JSON，规整为 KeywordSuggestions 的三类字段 */
  private parseLLMResult(
    raw: string,
    topN: number,
  ): Pick<
    KeywordSuggestions,
    'sourceKeywords' | 'demandKeywords' | 'excludeKeywords'
  > | null {
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<
        string,
        unknown
      >;

      const normalize = (
        key: string,
        source: 'positive' | 'negative',
      ): KeywordSuggestion[] => {
        const arr = obj[key];
        if (!Array.isArray(arr)) return [];
        return arr
          .slice(0, topN)
          .map((item) => {
            const e = item as Record<string, unknown>;
            const keyword =
              typeof e.keyword === 'string' ? e.keyword.trim() : '';
            if (!keyword) return null;
            const evidenceCount =
              typeof e.evidenceCount === 'number' && e.evidenceCount >= 0
                ? Math.min(500, Math.floor(e.evidenceCount))
                : 1;
            return { keyword, evidenceCount, source };
          })
          .filter((x): x is KeywordSuggestion => x !== null);
      };

      return {
        sourceKeywords: normalize('sourceKeywords', 'positive'),
        demandKeywords: normalize('demandKeywords', 'positive'),
        excludeKeywords: normalize('excludeKeywords', 'negative'),
      };
    } catch {
      return null;
    }
  }

  /** 统计文本集合中命中词表各词的线索数（同一条线索内同一词只计一次） */
  private countHits(
    texts: string[],
    wordPool: Set<string>,
  ): Map<string, number> {
    const freq = new Map<string, number>();
    for (const text of texts) {
      const normalized = text.toLowerCase();
      for (const word of wordPool) {
        if (normalized.includes(word)) {
          freq.set(word, (freq.get(word) ?? 0) + 1);
        }
      }
    }
    return freq;
  }

  /** 频次表 → 建议数组（按 evidenceCount 倒序，取前 topN） */
  private toSuggestions(
    freq: Map<string, number>,
    source: 'positive' | 'negative',
    topN: number,
  ): KeywordSuggestion[] {
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([keyword, evidenceCount]) => ({
        keyword,
        evidenceCount,
        source,
      }));
  }
}
