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

  constructor(private readonly prisma: PrismaService) {}

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

    const empty = {
      generatedAt: new Date().toISOString(),
      analyzedLeadCount: leads.length,
      positiveLeadCount: 0,
      negativeLeadCount: 0,
      sourceKeywords: [],
      demandKeywords: [],
      excludeKeywords: [],
    };

    if (leads.length < minLeadCount) {
      this.logger.log(
        `关键词建议样本不足（${leads.length} < ${minLeadCount}），跳过归纳`,
      );
      return empty;
    }

    // 正/负反馈分流
    const positiveTexts: string[] = [];
    const negativeTexts: string[] = [];
    let positiveCount = 0;
    let negativeCount = 0;

    for (const lead of leads) {
      const signals = Array.isArray(lead.signals) ? lead.signals : [];
      const signalTypes = new Set(
        signals.map((s: unknown) =>
          typeof s === 'object' && s !== null && 'type' in s
            ? String((s as { type: unknown }).type)
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
      // 中性线索不参与关键词统计
    }

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

  /** 统计文本集合中命中词表各词的线索数（同一条线索内同一词只计一次） */
  private countHits(texts: string[], wordPool: Set<string>): Map<string, number> {
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
