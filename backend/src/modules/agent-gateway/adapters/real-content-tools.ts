import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContentReviewService } from '../../content-review/content-review.service';
import { BusinessToolRegistry, ToolExecution } from './business-tools';
import { makeError } from '../contracts/error-codes';

/**
 * 真实内容工具（《3010-Agent-Gateway商用缺口修复方案》2.2）——
 * 阻断假成功：content_generate 真实落库（返回真实 contentId），
 * content_review 真实审核（敏感词/结构/配图/AI 味，阈值 70 判 pass），
 * lead_normalize 真实清洗（手机号/微信号/平台 ID/昵称/URL 规范化 + 置信度）。
 * 不再导入 business-tools.ts 的 Mock contentGenerate。
 */
@Injectable()
export class RealContentTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewService: ContentReviewService,
  ) {}

  build(): BusinessToolRegistry {
    const r = new BusinessToolRegistry();

    // content_generate：真实写入 article 表，返回真实 contentId + 版本（不伪造）
    r.register('content_generate', async (ctx, req) => {
      const p = req.payload ?? {};
      const title = String((p.title as string) ?? '未命名内容').slice(0, 120);
      const content = String((p.content as string) ?? '');
      if (!content.trim()) {
        throw makeError('INVALID_PLAN', {
          details: {
            toolName: 'content_generate',
            reason: 'content 不能为空（禁止伪造内容）',
          },
        });
      }
      const article = await this.prisma.article.create({
        data: {
          title,
          content,
          contentType:
            p.contentType === 'xiaohongshu' ? 'xiaohongshu' : 'article',
          contentFormat: p.contentFormat === 'html' ? 'html' : 'markdown',
          workspaceBrief: ((p.brief as string)
            ? { brief: String(p.brief) }
            : {}) as never,
          workspaceOutline: {} as never,
          workspaceStep: 'content',
          workspaceRevision: 1,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        },
      });
      const checksum = createHash('sha256').update(content).digest('hex');
      const exec: ToolExecution = {
        data: {
          contentId: article.id,
          title: article.title,
          version: 1,
          checksum,
          contentType: article.contentType,
        },
        evidence: [],
        usage: {
          inputTokens: Math.max(1, Math.ceil(content.length / 4)),
          modelTokens: 0,
          computeUnits: 1,
          usageId: `cg_${article.id.slice(-8)}`,
        },
        status: 'succeeded',
        artifacts: [
          {
            type: 'content_draft',
            uri: `/api/articles/${article.id}`,
            checksum,
            version: 1,
          },
        ],
      };
      return exec;
    });

    // content_review：真实审核（读 payload 内容做敏感词/结构/AI 味检查，阈值 70 pass）
    r.register('content_review', async (ctx, req) => {
      const p = req.payload ?? {};
      const content = String((p.content as string) ?? '');
      const titles = Array.isArray(p.titles)
        ? p.titles.map(String)
        : [String((p.title as string) ?? '未命名')];
      if (!content.trim()) {
        throw makeError('INVALID_PLAN', {
          details: { toolName: 'content_review', reason: 'content 不能为空' },
        });
      }
      const result = await this.reviewService.reviewAndRevise({
        titles,
        pages: [
          {
            type: p.pageType === 'summary' ? 'summary' : 'content',
            heading: titles[0],
            content,
            imagePrompt: String((p.imagePrompt as string) ?? ''),
          },
        ],
        // reviewAndRevise 拆出 pages 后，reviewContent 需要 pagesContent/pageTypes/generatedImageCount
        pagesContent: [content],
        pageTypes: [p.pageType === 'summary' ? 'summary' : 'content'],
        generatedImageCount: Number(p.generatedImageCount ?? 0),
        aiFlavorScore:
          p.aiFlavorScore != null ? Number(p.aiFlavorScore) : undefined,
      });
      if (!result.review.pass) {
        throw makeError('CONTENT_REVIEW_FAILED', {
          details: {
            score: result.review.score,
            threshold: 70,
            issues: result.review.issues,
          },
        });
      }
      const exec: ToolExecution = {
        data: {
          pass: result.review.pass,
          score: result.review.score,
          issues: result.review.issues,
          breakdown: result.review.breakdown,
          threshold: 70,
          revised: result.revised,
        },
        evidence: [],
        usage: {
          inputTokens: Math.ceil(content.length / 4),
          modelTokens: 0,
          computeUnits: 1,
          usageId: `cr_${Date.now().toString(36)}`,
        },
        status: 'succeeded',
      };
      return exec;
    });

    // lead_normalize：真实清洗（手机号/微信号/平台ID/昵称/URL 规范化 + 置信度）
    r.register('lead_normalize', async (ctx, req) => {
      const p = req.payload ?? {};
      const rawLeads = Array.isArray(p.leads)
        ? (p.leads as Array<Record<string, unknown>>)
        : [];
      const normalized = rawLeads.map((raw) => {
        const phone = normalizePhone(
          String((raw.phone as string) ?? (raw.mobile as string) ?? ''),
        );
        const wechat = normalizeWechat(
          String((raw.wechat as string) ?? (raw.wx as string) ?? ''),
        );
        const externalUserId = String(
          (raw.externalUserId as string) ?? (raw.userId as string) ?? '',
        ).trim();
        const nickname = String((raw.nickname as string) ?? '').trim();
        const sourceUrl = String((raw.sourceUrl as string) ?? '').trim();
        const confidence = computeConfidence({
          phone,
          wechat,
          externalUserId,
          nickname,
          sourceUrl,
        });
        return {
          phone,
          wechat,
          externalUserId,
          nickname,
          sourceUrl,
          confidence,
          dedupeKey: leadDedupeKey({ phone, wechat, externalUserId, nickname }),
          original: raw,
        };
      });
      const exec: ToolExecution = {
        data: { count: normalized.length, normalized },
        evidence: [],
        usage: {
          inputTokens: normalized.length * 20,
          modelTokens: 0,
          computeUnits: 1,
          usageId: `ln_${Date.now().toString(36)}`,
        },
        status: 'succeeded',
      };
      return exec;
    });

    // publish_execute / interaction_reply_execute：不注册 Mock，注册为明确失败
    // （方案第 1 阶段「阻断假成功」——未接真实 RPA 前禁止假成功）
    r.register('publish_execute', async () => {
      throw makeError('TOOL_EXECUTION_FAILED', {
        details: {
          reason:
            'publish_execute 未接入真实 RPA 发布（禁止假成功，需 RPA 平台适配器）',
        },
      });
    });
    r.register('interaction_reply_execute', async () => {
      throw makeError('TOOL_EXECUTION_FAILED', {
        details: {
          reason:
            'interaction_reply_execute 未接入真实 RPA 互动（禁止假成功，需 RPA 平台适配器）',
        },
      });
    });

    return r;
  }
}

// ---------------------------------------------------------------- 清洗工具（纯函数，可测）

/** 手机号规范化：去空格/括号/横线，仅保留数字，11 位校验 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits : '';
}

/** 微信号规范化：去空格，只保留合法字符（字母数字_-），5-20 位 */
export function normalizeWechat(raw: string): string {
  const v = raw.trim().replace(/[^\w_-]/g, '');
  return v.length >= 5 && v.length <= 20 ? v : '';
}

/** 线索去重键：按最强标识（平台ID > 手机号 > 微信号 > 昵称） */
export function leadDedupeKey(input: {
  phone?: string;
  wechat?: string;
  externalUserId?: string;
  nickname?: string;
}): string {
  const strong = input.externalUserId || input.phone || input.wechat;
  if (strong) return `strong:${strong}`;
  return input.nickname ? `nick:${input.nickname.toLowerCase()}` : '';
}

/** 置信度：标识强度 + 数量 */
export function computeConfidence(input: {
  phone: string;
  wechat: string;
  externalUserId: string;
  nickname: string;
  sourceUrl: string;
}): number {
  let score = 0;
  if (input.phone) score += 40;
  if (input.externalUserId) score += 35;
  if (input.wechat) score += 25;
  if (input.nickname) score += 10;
  if (input.sourceUrl) score += 5;
  return Math.min(100, score);
}
