// 线索评分服务（PRD SCORE-001~003 + 开发文档 §8，统一开发计划 §八）
// 四分数模型：fit/intent/identity/risk 分离 + 时间衰减 + 证据链（reasons + evidenceIds）。
// 原则：0 分显式与「无数据」区分；0-100 clamp；不输出伪概率；AI 不得补造证据。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadSignalStore } from './lead-signal.store';
import {
  SIGNAL_RULES,
  aggregateByDimension,
  clamp,
  computeTotal,
  DIMENSION_MAX,
  RULE_VERSION,
  type ScoreDimension,
} from './lead-score-rules';

/** 生成信号的输入（T2.1） */
export interface SignalGenerationInput {
  tenantId: string;
  userId: string;
  leadId: string;
  platform: string;
  /** 该线索相关的互动事件（评论/私信/提及等） */
  events: Array<{
    id: string;
    channel: string;
    body?: string | null;
    evidenceUrl?: string | null;
    occurredAt: Date;
    identityId?: string | null;
  }>;
  /** 来源内容（视频/笔记等） */
  sourceContent?: {
    id: string;
    title?: string | null;
    text?: string | null;
    url?: string | null;
  } | null;
  /** 已有信号（用于重复互动判断） */
  existingSignals?: Array<{ type: string; observedAt: Date }>;
}

/** 评分输入（T2.1） */
export interface ScoreInput {
  tenantId: string;
  userId: string;
  leadId: string;
  signals: Array<{
    type: string;
    value: number;
    observedAt: Date;
    expiresAt?: Date | null;
    evidenceId?: string | null;
    source?: string | null;
  }>;
  /** 身份质量补充（可选）：verified / profileUrl / nicknameMatch */
  identity?: {
    verified?: boolean;
    hasProfileUrl?: boolean;
    nicknameMatched?: boolean;
    identityConfidence?: number;
  } | null;
}

// —— 初版规则匹配关键词（不接 LLM，纯规则；后续可升级为 LLM 提取）——
const KEYWORDS: Record<string, { type: string; keywords: string[] }> = {
  price: {
    type: 'intent.price',
    keywords: ['多少钱', '价格', '报价', '收费', '费用', '多少钱一个', '价格是多少', '怎么收费', '贵不贵'],
  },
  explicitRequest: {
    type: 'intent.explicit_request',
    keywords: ['加微信', '私聊', '联系我', '怎么联系', '想了解', '想合作', '找你们', '找您', '聊一聊', '约个时间', '安排一下'],
  },
  question: {
    type: 'intent.question',
    keywords: ['？', '?', '怎么', '如何', '能不能', '是否可以', '行不行', '有没有'],
  },
  timeline: {
    type: 'intent.timeline',
    keywords: ['最近', '现在', '马上', '这个月', '这几天', '尽快', '急', '今天', '明天'],
  },
  spam: {
    type: 'risk.spam',
    keywords: ['代发', '刷量', '免费领', '薅羊毛', '加群领', '点击链接', '中奖', '恭喜您', '扫码'],
  },
};

/** 简单归一化：小写 + 去空白 */
function normalizeText(text: string): string {
  return (text ?? '').toLowerCase().replace(/\s+/g, '');
}

/** 从事件文本匹配关键词信号 */
function matchKeywordSignals(
  body: string | null | undefined,
  title: string | null | undefined,
  text: string | null | undefined,
): Array<{ type: string; value: number; source: string }> {
  const haystacks = [
    { content: normalizeText(body ?? ''), label: 'body' },
    { content: normalizeText(title ?? ''), label: 'title' },
    { content: normalizeText(text ?? ''), label: 'content' },
  ];
  const found: Array<{ type: string; value: number; source: string }> = [];
  const seen = new Set<string>();

  for (const { content, label } of haystacks) {
    if (!content) continue;
    for (const rule of Object.values(KEYWORDS)) {
      if (seen.has(rule.type)) continue;
      if (rule.keywords.some((k) => content.includes(k))) {
        const r = SIGNAL_RULES[rule.type];
        found.push({ type: rule.type, value: r?.score ?? 1, source: `${label}:${rule.type}` });
        seen.add(rule.type);
      }
    }
  }
  return found;
}

@Injectable()
export class LeadScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signalStore: LeadSignalStore,
  ) {}

  /** 从事件/内容生成信号（T2.1 规则初版） */
  async generateSignals(input: SignalGenerationInput): Promise<Array<{ type: string; value: number }>> {
    const { tenantId, userId, leadId, events } = input;
    const now = new Date();
    const toSave: Array<{
      tenantId: string;
      userId: string;
      leadId: string;
      type: string;
      value: number;
      evidenceId: string | null;
      source: string | null;
      observedAt: Date;
    }> = [];

    for (const ev of events) {
      const matched = matchKeywordSignals(ev.body, input.sourceContent?.title, input.sourceContent?.text);
      for (const m of matched) {
        toSave.push({
          tenantId,
          userId,
          leadId,
          type: m.type,
          value: m.value,
          evidenceId: ev.id,
          source: m.source,
          observedAt: ev.occurredAt ?? now,
        });
      }
      // 回复深度：评论/私信本身算一次 engagement.reply
      if (ev.channel === 'dm' || ev.channel === 'mention') {
        toSave.push({
          tenantId,
          userId,
          leadId,
          type: 'engagement.reply',
          value: SIGNAL_RULES['engagement.reply'].score,
          evidenceId: ev.id,
          source: `channel:${ev.channel}`,
          observedAt: ev.occurredAt ?? now,
        });
      }
    }

    // 重复互动：同一身份多次事件 → engagement.repeat
    if (events.length > 1) {
      toSave.push({
        tenantId,
        userId,
        leadId,
        type: 'engagement.repeat',
        value: SIGNAL_RULES['engagement.repeat'].score,
        evidenceId: events[0].id,
        source: `events:${events.length}`,
        observedAt: now,
      });
    }

    await this.signalStore.saveSignals(toSave);
    return toSave.map((s) => ({ type: s.type, value: s.value }));
  }

  /** 计算四分数（应用时间衰减 + 重复规则）→ 返回快照数据（未落库） */
  async score(input: ScoreInput): Promise<{
    fitScore: number;
    intentScore: number;
    identityConfidence: number;
    riskScore: number;
    totalScore: number;
    components: Record<ScoreDimension, number>;
    reasons: string[];
    evidenceIds: string[];
    confidence: number;
  }> {
    const now = new Date();
    const signals = input.signals;
    const components = aggregateByDimension(signals, now);

    // 身份质量补充（来自 PlatformIdentity）
    if (input.identity?.verified) components.identity = clamp(components.identity + DIMENSION_MAX.identity, DIMENSION_MAX.identity);
    else if (input.identity?.hasProfileUrl) components.identity = Math.max(components.identity, 8);
    else if (input.identity?.nicknameMatched) components.identity = Math.max(components.identity, 3);

    const totalScore = computeTotal(components);
    const reasons: string[] = [];
    const evidenceIds = Array.from(new Set(signals.map((s) => s.evidenceId).filter(Boolean))) as string[];

    // 证据链：逐条记录「为什么加减分」（T2.3，PRD SCORE-002）
    for (const s of signals) {
      const rule = SIGNAL_RULES[s.type];
      if (!rule) continue;
      const source = s.source ? `（来源 ${s.source}）` : '';
      if (rule.dimension === 'risk') {
        reasons.push(`风险信号 ${s.type} -${s.value}${source}`);
      } else if (s.value > 0) {
        reasons.push(`信号 ${s.type} +${s.value}${source}`);
      }
    }
    if (input.identity?.verified) reasons.push('身份已验证（externalUserId）');
    if (input.identity?.hasProfileUrl) reasons.push('有稳定 profileUrl，身份高置信');
    if (reasons.length === 0) reasons.push('暂无证据（none found）——不得补造来源/预算/身份/购买时间');

    // 置信度：有身份证据加分，有证据链则整体置信
    const confidence = clamp(
      50 + (input.identity?.verified ? 30 : 0) + (evidenceIds.length > 0 ? 20 : 0),
      100,
    );

    return {
      fitScore: components.fit,
      intentScore: components.intent,
      identityConfidence: components.identity,
      riskScore: components.risk,
      totalScore,
      components,
      reasons,
      evidenceIds,
      confidence,
    };
  }

  /** 保存快照（不覆盖历史，每次评分 append 一条） */
  async saveSnapshot(input: {
    tenantId: string;
    userId: string;
    leadId: string;
    snapshot: {
      fitScore: number;
      intentScore: number;
      identityConfidence: number;
      riskScore: number;
      totalScore: number;
      components: Record<ScoreDimension, number>;
      reasons: string[];
      evidenceIds: string[];
      confidence: number;
    };
    modelVersion?: string;
    scoredAt?: Date;
  }): Promise<string> {
    const row = await this.prisma.leadScoreSnapshot.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        leadId: input.leadId,
        fitScore: input.snapshot.fitScore,
        intentScore: input.snapshot.intentScore,
        identityConfidence: input.snapshot.identityConfidence,
        riskScore: input.snapshot.riskScore,
        totalScore: input.snapshot.totalScore,
        confidence: input.snapshot.confidence,
        components: input.snapshot.components as object,
        reasons: input.snapshot.reasons,
        evidenceIds: input.snapshot.evidenceIds,
        modelVersion: input.modelVersion ?? 'rule-v1',
        ruleVersion: RULE_VERSION,
        scoredAt: input.scoredAt ?? new Date(),
      },
    });
    return row.id;
  }

  /** 一键评分流程：加载信号 → 算分 → 存快照 → 更新 Lead.score */
  async scoreAndPersist(input: {
    tenantId: string;
    userId: string;
    leadId: string;
    identity?: ScoreInput['identity'];
    modelVersion?: string;
  }): Promise<{
    snapshotId: string;
    totalScore: number;
    components: Record<ScoreDimension, number>;
  }> {
    const signals = (await this.signalStore.listSignals(input.tenantId, input.leadId)).map((s) => ({
      type: s.type,
      value: s.value ?? 1,
      observedAt: s.observedAt,
      expiresAt: s.expiresAt,
      evidenceId: s.evidenceId,
      source: s.source,
    }));
    const result = await this.score({
      tenantId: input.tenantId,
      userId: input.userId,
      leadId: input.leadId,
      signals,
      identity: input.identity,
    });
    const snapshotId = await this.saveSnapshot({
      tenantId: input.tenantId,
      userId: input.userId,
      leadId: input.leadId,
      snapshot: result,
      modelVersion: input.modelVersion,
    });
    // 回写 Lead.score（旧单分数字段，保持列表排序可用）
    await this.prisma.lead.updateMany({
      where: { id: input.leadId, tenantId: input.tenantId },
      data: { score: result.totalScore },
    });
    return { snapshotId, totalScore: result.totalScore, components: result.components };
  }

  /** 评分历史（倒序） */
  async scoreHistory(tenantId: string, leadId: string) {
    return this.prisma.leadScoreSnapshot.findMany({
      where: { tenantId, leadId },
      orderBy: { scoredAt: 'desc' },
      take: 50,
    });
  }
}
