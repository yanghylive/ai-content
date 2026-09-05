import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AiClientService } from '../ai-models/ai-client.service';
import { pickDefaultModel } from '../ai-models/model-capability.util';
import {
  REPLY_PERSONAS,
  detectForbiddenWords,
  findReplyPersona,
  pickReplyPersona,
  type ReplyPersona,
} from './personas';

/**
 * ReplyEngine —— 评论回复生成引擎
 * 移植自 Yht20927/douyin-cli（MIT License）：
 * - 人格池：7 种人格按权重轮换，同一账号/内容绑定同人格（避免精分）
 * - 策略分类：A-F 六类回复策略内嵌在 prompt 里由 LLM 自选
 * - 上下文隔离：只注入当前评论 + 当前内容，不串上下文
 * - 禁词校验：生成后检测 AI 味禁词，命中则换人格重生成（≤2 次）
 */

export interface CommentInput {
  text: string;
  userId?: string;
  userName?: string;
}

/**
 * 负面词清单（统一口径，S3-4）：
 * 评分减分与高风险判定共用同一份清单，避免两套硬编码漂移导致
 * 「评分不减分但被判高风险」的口径不一致。
 */
export const NEGATIVE_WORDS = [
  '骗子',
  '骗人',
  '坑',
  '垃圾',
  '没用',
  '差评',
  '太贵',
] as const;

/**
 * 高风险专属词（S3-4）：投诉/退款/举报/维权等风险信号，
 * 只用于 isHighRisk（进人工审核），不用于评分减分——
 * 「退款/投诉」是风险信号，不必然是负面评价，不应扣意向分。
 */
export const HIGH_RISK_WORDS = [
  '退款',
  '投诉',
  '举报',
  '曝光',
  '维权',
  '投诉电话',
  '12315',
  '虚假',
  '诈骗',
  '假货',
  '上当',
  '受骗',
  '退货',
  '退钱',
] as const;

const NEGATIVE_RE = new RegExp(NEGATIVE_WORDS.join('|'));
const HIGH_RISK_RE = new RegExp(
  [...NEGATIVE_WORDS, ...HIGH_RISK_WORDS].join('|'),
);

export interface ContentContext {
  title?: string;
  summary?: string;
}

export interface ReplyEngineOptions {
  platformName: string;
  /** 绑定 key（默认 accountId:platform），同 key 复用同人格 */
  bindKey: string;
  forcePersonaId?: string;
  content?: ContentContext;
  commenterName?: string;
}

export interface ReplyEngineResult {
  replyText: string;
  personaId: string;
  personaName: string;
  retries: number;
  forbiddenHit?: string | null;
}

export class PersonaBinder {
  private readonly bindings = new Map<string, ReplyPersona>();
  private readonly recentKeys: string[] = [];
  private readonly indices = new Map<string, number>();

  bind(key: string, opts: { forcePersonaId?: string } = {}): ReplyPersona {
    if (opts.forcePersonaId) {
      const forced = findReplyPersona(opts.forcePersonaId);
      if (forced) {
        this.bindings.set(key, forced);
        if (!this.recentKeys.includes(key)) {
          this.recentKeys.push(key);
          this.trimRecent();
        }
        if (!this.indices.has(key)) this.indices.set(key, 0);
        return forced;
      }
    }

    const existing = this.bindings.get(key);
    if (existing) return existing;

    // 排除最近 3 个用过的人格，避免相邻回复风格雷同
    const recentPersonaIds = this.recentKeys
      .slice(-3)
      .map((k) => this.bindings.get(k)?.id)
      .filter((id): id is string => Boolean(id));
    const persona = pickReplyPersona(recentPersonaIds);
    this.bindings.set(key, persona);
    this.recentKeys.push(key);
    this.trimRecent();
    this.indices.set(key, 0);
    return persona;
  }

  /** 同 key 内微调：第 8 条起切换相似人格避免单一风格疲劳 */
  microAdjust(key: string): ReplyPersona {
    const current = this.bindings.get(key);
    if (!current) return pickReplyPersona();
    const count = this.indices.get(key) ?? 0;
    this.indices.set(key, count + 1);
    if (count >= 8) {
      const alternates = REPLY_PERSONAS.filter(
        (p) => p.id !== current.id && p.weight >= 10,
      );
      if (alternates.length > 0) {
        const next = alternates[Math.floor(Math.random() * alternates.length)];
        this.bindings.set(key, next);
        this.indices.set(key, 0);
        return next;
      }
    }
    return current;
  }

  private trimRecent() {
    if (this.recentKeys.length > 20) {
      this.recentKeys.splice(0, this.recentKeys.length - 20);
    }
  }
}

@Injectable()
export class ReplyEngineService {
  private readonly logger = new Logger(ReplyEngineService.name);
  private readonly binder = new PersonaBinder();
  private readonly promptsDir = join(__dirname, 'prompts');

  constructor(
    private readonly aiClient?: AiClientService,
    private readonly prisma?: PrismaService,
  ) {}

  /**
   * 生成一条评论回复。
   * - 绑定人格（同 bindKey 复用）
   * - 构建 prompt（当前评论 + 当前内容，上下文隔离）
   * - LLM 生成 → 禁词校验 → 命中则换人格重试（≤2 次）
   */
  async generateReply(
    comment: CommentInput,
    options: ReplyEngineOptions,
  ): Promise<ReplyEngineResult> {
    let persona = options.forcePersonaId
      ? this.binder.bind(options.bindKey, {
          forcePersonaId: options.forcePersonaId,
        })
      : this.binder.bind(options.bindKey);
    persona = this.binder.microAdjust(options.bindKey);
    const prompt = this.buildPrompt(comment, options, persona);

    const text = (await this.callLlm(prompt, persona.temperature)).trim();
    let replyText = text;

    // 禁词校验：命中 → 换人格重生成
    let forbiddenHit: string | null = detectForbiddenWords(replyText, persona);
    let retries = 0;
    while (forbiddenHit && retries < 2) {
      this.logger.warn(
        `ReplyEngine 命中禁词[${forbiddenHit}]，换人格重试 ${retries + 1}/2`,
      );
      const retryPersona = pickReplyPersona([persona.id]);
      const retryPrompt = this.buildPrompt(comment, options, retryPersona);
      const retryText = (
        await this.callLlm(retryPrompt, retryPersona.temperature)
      ).trim();
      forbiddenHit = detectForbiddenWords(retryText, retryPersona);
      if (!forbiddenHit) {
        replyText = retryText;
        persona = retryPersona;
      }
      retries += 1;
    }

    // 长度钳制（按人格长度范围）
    const [, maxLen] = persona.lengthRange;
    if (replyText.length > maxLen) {
      replyText = replyText.slice(0, maxLen);
    }

    return {
      replyText,
      personaId: persona.id,
      personaName: persona.name,
      retries,
      forbiddenHit: forbiddenHit && retries >= 2 ? forbiddenHit : null,
    };
  }

  /** 潜客评分：评论 → 0-100 分（关键词命中 + 问句 + 长度 + 情绪） */
  scoreLeadPotential(comment: CommentInput): {
    score: number;
    signals: string[];
  } {
    const text = (comment.text || '').toLowerCase();
    const signals: string[] = [];

    // 强意向关键词
    const strongKeywords = [
      '多少钱',
      '怎么买',
      '哪里买',
      '链接',
      '求链接',
      '怎么用',
      '多少钱一个',
      '怎么合作',
      '怎么联系',
      '私信',
      '联系方式',
      '怎么报名',
      '哪里可以',
      '怎么参加',
      '求带',
      '怎么加入',
      '是什么',
      '有效果吗',
      '真的有用吗',
      '价格',
    ];
    // 中意向关键词
    const midKeywords = [
      '想试试',
      '感兴趣',
      '怎么弄',
      '怎么操作',
      '求教程',
      '带带我',
      '新手怎么',
      '靠谱吗',
      '真的假的',
      '会不会',
      '需要什么条件',
    ];
    // 正面情绪词
    const positiveWords = [
      '太棒',
      '厉害',
      '有用',
      '学到了',
      '喜欢',
      '优秀',
      '真好',
      '牛',
      '绝',
      '不错',
      '收藏',
      '转发',
      '关注',
    ];

    let score = 0;
    for (const kw of strongKeywords) {
      if (text.includes(kw)) {
        score += 35;
        signals.push(`强意向:${kw}`);
        break;
      }
    }
    for (const kw of midKeywords) {
      if (text.includes(kw)) {
        score += 20;
        signals.push(`中意向:${kw}`);
        break;
      }
    }
    for (const kw of positiveWords) {
      if (text.includes(kw)) {
        score += 10;
        signals.push(`正面:${kw}`);
        break;
      }
    }
    // 问句加分（？/?结尾 或 怎么/为什么/多少钱 开头）
    if (/[?？]$/.test(text) || /^(怎么|为什么|多少钱|如何|在哪)/.test(text)) {
      score += 15;
      signals.push('问句');
    }
    // 长度信号
    if (text.length >= 8) {
      score += 5;
      signals.push('有内容');
    }
    // 负面词减分（统一 NEGATIVE_WORDS 清单）
    if (NEGATIVE_RE.test(text)) {
      score -= 25;
      signals.push('负面');
    }

    return { score: Math.max(0, Math.min(100, score)), signals };
  }

  /** 判断一条评论是否需要回复（潜客分 ≥ 阈值） */
  shouldReply(comment: CommentInput, threshold = 45): boolean {
    return this.scoreLeadPotential(comment).score >= threshold;
  }

  /**
   * 高风险评论判定（自动回复用）：命中负面/争议/投诉/退款/举报等词，
   * 一律进人工审核，不做自动外发（对齐 AGENTS.md「审批仅用于高风险/不确定」）。
   */
  isHighRisk(comment: CommentInput): boolean {
    const text = (comment.text || '').toLowerCase();
    return HIGH_RISK_RE.test(text);
  }

  private buildPrompt(
    comment: CommentInput,
    options: ReplyEngineOptions,
    persona: ReplyPersona,
  ): string {
    let template: string;
    try {
      template = readFileSync(join(this.promptsDir, 'reply.md'), 'utf-8');
    } catch {
      template = this.fallbackTemplate();
    }

    const contentBlock = options.content?.title
      ? `标题：${options.content.title}\n${options.content.summary ? `简介：${options.content.summary}` : ''}`
      : '（当前内容的标题与简介不可用，仅凭评论判断）';

    const userProfile = options.commenterName
      ? `（来自用户：${options.commenterName}）`
      : '';

    return template
      .replaceAll('{{PERSONA_PROMPT}}', persona.promptPrefix)
      .replaceAll('{{PERSONA_EXAMPLES}}', this.buildExamples(persona))
      .replaceAll('{{PLATFORM_NAME}}', options.platformName)
      .replaceAll('{{CONTENT_BLOCK}}', contentBlock)
      .replaceAll('{{COMMENT_TEXT}}', comment.text)
      .replaceAll('{{USER_PROFILE}}', userProfile);
  }

  private buildExamples(persona: ReplyPersona): string {
    if (!persona.examples || persona.examples.length === 0) return '';
    return `## 风格参考示例（仅参考，不要照抄）\n${persona.examples
      .map((e) => `- ${e}`)
      .join('\n')}`;
  }

  private fallbackTemplate(): string {
    return `=== SYSTEM ===
{{PERSONA_PROMPT}}
=== USER ===
你是{{PLATFORM_NAME}}内容作者，需要回复一条评论，回复要真诚有料不敷衍。
评论：「{{COMMENT_TEXT}}」
{{PERSONA_EXAMPLES}}
只返回回复文本。`;
  }

  private async callLlm(prompt: string, temperature: number): Promise<string> {
    if (!this.aiClient || !this.prisma) {
      // 无 AI Client（单测/降级）：返回占位
      return '收到！回头我详细整理一下再分享给你～';
    }
    const model = await pickDefaultModel(this.prisma, 'text');
    if (!model) {
      throw new Error('未配置可用的 AI 模型，请在「AI 模型设置」中同步');
    }
    const messages = [
      {
        role: 'system' as const,
        content: '你负责为内容作者生成评论回复，输出必须符合要求的风格。',
      },
      { role: 'user' as const, content: prompt },
    ];
    // 2026-09-06 复核：409 BILLING_IDEMPOTENCY_REPLAY = 网关幂等键（内容哈希）
    // 与近期请求冲突（如超时重试同键被拒）。billingSalt 参与键哈希——
    // 换随机 salt 即换新键，标准解法。最多重试 2 次。
    let salt: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.aiClient.generate(
          model.id,
          messages,
          { temperature, maxTokens: 300, billingSalt: salt },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isReplay = /BILLING_IDEMPOTENCY_REPLAY/i.test(message);
        if (!isReplay || attempt >= 2) throw error;
        salt = `retry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.logger.warn(
          `ReplyEngine 命中 409 计费幂等冲突，换 salt 重试 ${attempt + 1}/2`,
        );
      }
    }
    throw new Error('unreachable');
  }
}
