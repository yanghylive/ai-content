import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../../prisma/prisma.service';

/** AI 产出工具白名单（统计「AI 帮我生成了什么」） */
const AI_CREATION_TOOLS = [
  'content_generate',
  'image_generate',
  'media-transcript-douyin',
  'media-transcript-xhs',
  'media-transcript-youtube',
];

export interface EffectReport {
  generatedAt: string;
  range: '7d' | '30d';
  /** 本地产出数据（始终可用） */
  aiGenerated: { count: number };
  published: { count: number };
  /** 外部回读数据（可能不可用，降级标记） */
  exposure: { count: number | null; available: boolean };
  interactions: { count: number | null; available: boolean };
  /** 周报摘要卡（分享用） */
  weeklySummary: {
    text: string;
    sharePayload: string;
  };
}

/**
 * 效果报告（2026-08-09 商用能力补齐 R3）：
 * AI 生成数 / 发布数 / 曝光 / 互动（7/30 天），复用 AiToolCallLog + PublishRecord。
 * 降级：外部回读（曝光/互动）失败 → null + available=false，前端展示「暂不可用」。
 */
@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}

  private sinceDays(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
  }

  private isJson(x: unknown): x is Record<string, unknown> {
    return typeof x === 'object' && x !== null;
  }

  /** 从发布 resultJson 提取曝光/互动（不同平台字段不同，尽量兼容） */
  private extractMetrics(resultJson: unknown): {
    exposure: number | null;
    interactions: number | null;
  } {
    if (!this.isJson(resultJson)) return { exposure: null, interactions: null };
    const r = resultJson;
    const exp =
      r.exposure ??
      r.exposureCount ??
      r.viewCount ??
      r.readCount ??
      r.reads ??
      r.views ??
      (this.isJson(r.data)
        ? (r.data.exposureCount ?? r.data.viewCount)
        : undefined);
    const likes = r.likes ?? r.likeCount;
    const comments = r.comments ?? r.commentCount;
    const shares = r.shares ?? r.shareCount;
    const interactions =
      (likes ?? comments ?? shares)
        ? Number(likes ?? 0) + Number(comments ?? 0) + Number(shares ?? 0)
        : null;
    return {
      exposure:
        typeof exp === 'number' ? exp : exp != null ? Number(exp) : null,
      interactions: interactions != null ? interactions : null,
    };
  }

  async report(
    authUser: AuthenticatedUser,
    range: '7d' | '30d' = '7d',
  ): Promise<EffectReport> {
    const days = range === '30d' ? 30 : 7;
    const since = this.sinceDays(days);
    const userId = authUser?.id || 'legacy-local-user';

    // 1. AI 生成数（创作类工具调用成功）
    const aiGenerated = await this.prisma.aiToolCallLog.count({
      where: {
        userId,
        tool: { in: AI_CREATION_TOOLS },
        createdAt: { gte: since },
      },
    });

    // 2. 发布数（成功发布）
    const published = await this.prisma.publishRecord.count({
      where: {
        userId,
        status: 'success',
        createdAt: { gte: since },
      },
    });

    // 3. 曝光/互动（从发布结果提取，无数据则降级）
    const publishRecords = await this.prisma.publishRecord.findMany({
      where: {
        userId,
        status: 'success',
        createdAt: { gte: since },
      },
      select: { resultJson: true },
      take: 50,
    });
    let exposureTotal: number | null = 0;
    let interactionTotal: number | null = 0;
    let hasExposureData = false;
    let hasInteractionData = false;
    for (const rec of publishRecords) {
      const m = this.extractMetrics(rec.resultJson);
      if (m.exposure != null) {
        exposureTotal = (exposureTotal ?? 0) + m.exposure;
        hasExposureData = true;
      }
      if (m.interactions != null) {
        interactionTotal = (interactionTotal ?? 0) + m.interactions;
        hasInteractionData = true;
      }
    }

    const weeklySummaryText = `本周 AI 帮我生成 ${aiGenerated} 条内容，发布 ${published} 条${
      hasExposureData ? `，带来 ${exposureTotal} 次曝光` : ''
    }。继续加油！`;

    return {
      generatedAt: new Date().toISOString(),
      range,
      aiGenerated: { count: aiGenerated },
      published: { count: published },
      exposure: {
        count: hasExposureData ? exposureTotal : null,
        available: hasExposureData,
      },
      interactions: {
        count: hasInteractionData ? interactionTotal : null,
        available: hasInteractionData,
      },
      weeklySummary: {
        text: weeklySummaryText,
        sharePayload: JSON.stringify({
          title: '我的 AI 效果周报',
          text: weeklySummaryText,
          aiGenerated,
          published,
        }),
      },
    };
  }
}
