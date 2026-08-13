import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 统一线索写入层（一期）。
 *
 * 目标：把 growth_leads / comment_acquisition_leads 等多套线索写入，
 * 收敛到统一的 leads 表，用统一 dedupeKey 去重，避免数据孤岛。
 *
 * - dedupeKey 算法对齐 crm 的 `crm:${sha1(...)}` 前缀风格，此处用 `lead:${sha256(...)}`。
 * - tenantId 有值用 tenantId_dedupeKey，无值降级 userId_dedupeKey（对齐 crm.service）。
 */

export interface LeadUpsertInput {
  userId: string;
  tenantId?: string | null;
  platform: string;
  sourceType: string; // comment / dm / notification / search / import
  sourceTaskId?: string | null;
  sourceRunId?: string | null;
  sourceUrl?: string | null;
  sourceText?: string | null;
  commentRef?: string | null;
  externalUserId?: string | null;
  nickname?: string | null;
  profileUrl?: string | null;
  avatarUrl?: string | null;
  score?: number;
  scoreReasons?: Prisma.InputJsonValue;
  matchedKeywords?: Prisma.InputJsonValue;
  signals?: Prisma.InputJsonValue;
  latestReply?: string | null;
  replyPersonaId?: string | null;
  ownerUserId?: string | null;
}

export interface LeadUpsertResult {
  lead: Prisma.LeadGetPayload<Record<string, never>>;
  created: boolean;
}

@Injectable()
export class LeadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 统一去重键：有平台用户 ID 优先（最强），无则昵称 + 文本前缀兜底 */
  static dedupeKeyOf(input: {
    platform: string;
    externalUserId?: string | null;
    nickname?: string | null;
    sourceText?: string | null;
  }): string {
    const identity = input.externalUserId
      ? `uid:${input.externalUserId}`
      : `nick:${input.nickname ?? ''}|${(input.sourceText ?? '').slice(0, 40)}`;
    return `lead:${crypto
      .createHash('sha256')
      .update(`${input.platform}:${identity}`)
      .digest('hex')}`;
  }

  private dedupeWhere(
    userId: string,
    tenantId: string | null | undefined,
    dedupeKey: string,
  ): Prisma.LeadWhereUniqueInput {
    if (tenantId) return { tenantId_dedupeKey: { tenantId, dedupeKey } };
    return { userId_dedupeKey: { userId, dedupeKey } };
  }

  /**
   * 按 dedupeKey 去重写入：已存在则合并更新（累加 score/证据，刷新最新回复），
   * 不存在则创建。返回 created 标记，供双写阶段判断是否为新线索。
   */
  async upsert(input: LeadUpsertInput): Promise<LeadUpsertResult> {
    const dedupeKey = LeadRepository.dedupeKeyOf(input);
    const where = this.dedupeWhere(input.userId, input.tenantId, dedupeKey);

    const existing = await this.prisma.lead.findUnique({ where });

    if (existing) {
      const lead = await this.prisma.lead.update({
        where,
        data: {
          // 来源信息：保留最早来源，仅回填缺失的更强身份字段
          externalUserId: existing.externalUserId ?? input.externalUserId ?? null,
          profileUrl: existing.profileUrl ?? input.profileUrl ?? null,
          avatarUrl: existing.avatarUrl ?? input.avatarUrl ?? null,
          nickname: existing.nickname ?? input.nickname ?? null,
          // 意向评分：取更高分 + 合并评分理由/信号/关键词
          score: Math.max(existing.score, input.score ?? 0),
          scoreReasons: this.mergeJsonArray(
            existing.scoreReasons,
            input.scoreReasons,
          ),
          signals: this.mergeJsonArray(existing.signals, input.signals),
          matchedKeywords: this.mergeJsonArray(
            existing.matchedKeywords,
            input.matchedKeywords,
          ),
          // 最新回复：覆盖（保留最新一次）
          latestReply: input.latestReply ?? existing.latestReply,
          replyPersonaId: input.replyPersonaId ?? existing.replyPersonaId,
          // 补充追溯字段（若旧数据缺失）
          sourceTaskId: existing.sourceTaskId ?? input.sourceTaskId ?? null,
          sourceRunId: existing.sourceRunId ?? input.sourceRunId ?? null,
          sourceUrl: existing.sourceUrl ?? input.sourceUrl ?? null,
          sourceText: existing.sourceText ?? input.sourceText ?? null,
          commentRef: input.commentRef ?? existing.commentRef ?? null,
          ownerUserId: existing.ownerUserId ?? input.ownerUserId ?? null,
        },
      });
      return { lead, created: false };
    }

    const lead = await this.prisma.lead.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        platform: input.platform,
        sourceType: input.sourceType,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceRunId: input.sourceRunId ?? null,
        sourceUrl: input.sourceUrl ?? null,
        sourceText: input.sourceText ?? null,
        commentRef: input.commentRef ?? null,
        externalUserId: input.externalUserId ?? null,
        dedupeKey,
        nickname: input.nickname ?? null,
        profileUrl: input.profileUrl ?? null,
        avatarUrl: input.avatarUrl ?? null,
        score: input.score ?? 0,
        scoreReasons: input.scoreReasons ?? [],
        matchedKeywords: input.matchedKeywords ?? [],
        signals: input.signals ?? [],
        latestReply: input.latestReply ?? null,
        replyPersonaId: input.replyPersonaId ?? null,
        ownerUserId: input.ownerUserId ?? null,
      },
    });
    return { lead, created: true };
  }

  /** 线索转客户：status=converted 并关联 CrmCustomer（一期最小实现） */
  async markConverted(
    leadId: string,
    customerId: string,
  ): Promise<void> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { status: 'converted', customerId },
    });
  }

  /** 合并两个 Json 数组（去重，保持元素顺序） */
  private mergeJsonArray(
    existing: unknown,
    incoming: unknown,
  ): Prisma.InputJsonValue {
    const a = Array.isArray(existing) ? existing : [];
    const b = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    return [
      ...a,
      ...b.filter((x) => !seen.has(JSON.stringify(x))),
    ] as Prisma.InputJsonValue;
  }
}
