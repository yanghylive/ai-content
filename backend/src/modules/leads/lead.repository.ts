import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadScoreService } from '../lead-intelligence/lead-score.service';

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
  sourceAccountId?: string | null;
  sourceTaskId?: string | null;
  sourceRunId?: string | null;
  // 六步闭环归因链：线索直接指向内容/发布/互动事件（15.4#7）
  sourceArticleId?: string | null;
  sourcePublishRecordId?: string | null;
  sourceInteractionEventId?: string | null;
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
  lastError?: string | null;
  ownerUserId?: string | null;
  customerId?: string | null;
  nextFollowUpAt?: Date | string | null;
}

export interface LeadUpsertResult {
  lead: Prisma.LeadGetPayload<Record<string, never>>;
  created: boolean;
}

@Injectable()
export class LeadRepository {
  private readonly logger = new Logger(LeadRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly leadScore?: LeadScoreService,
  ) {}

  /** 统一去重键：有平台用户 ID 优先（最强），无则昵称 + 完整文本 sha256 兜底 */
  static dedupeKeyOf(input: {
    platform: string;
    externalUserId?: string | null;
    nickname?: string | null;
    sourceText?: string | null;
  }): string {
    const identity = input.externalUserId
      ? `uid:${input.externalUserId}`
      : `nick:${input.nickname ?? ''}|${crypto
          .createHash('sha256')
          .update(input.sourceText ?? '')
          .digest('hex')
          .slice(0, 24)}`;
    return `lead:${crypto
      .createHash('sha256')
      .update(`${input.platform}:${identity}`)
      .digest('hex')}`;
  }

  /**
   * GrowthLead → LeadUpsertInput 字段映射（六步闭环 7.2 A「收敛为统一线索模型」）。
   * GrowthLead 特有关联 crmCustomerId → customerId；videoTitle/videoUrl/commentTime
   * 折叠进 signals 保留不丢。供迁移/双写阶段把 GrowthLead 写入统一到 Lead。
   */
  static fromGrowthLead(input: {
    userId: string;
    tenantId?: string | null;
    platform: string;
    sourceType: string;
    sourceTaskId?: string | null;
    sourceRunId?: string | null;
    crmCustomerId?: string | null;
    nickname?: string | null;
    profileUrl?: string | null;
    avatarUrl?: string | null;
    externalUserId?: string | null;
    sourceText?: string | null;
    sourceUrl?: string | null;
    videoTitle?: string | null;
    videoUrl?: string | null;
    commentTime?: string | null;
    matchedKeywords?: unknown;
    score?: number;
    scoreReasons?: unknown;
    ownerUserId?: string | null;
    nextFollowUpAt?: Date | string | null;
    latestReply?: string | null;
  }): LeadUpsertInput {
    const growthSignals =
      input.videoTitle || input.videoUrl || input.commentTime
        ? [
            {
              source: 'growth_lead',
              videoTitle: input.videoTitle ?? null,
              videoUrl: input.videoUrl ?? null,
              commentTime: input.commentTime ?? null,
            },
          ]
        : [];
    return {
      userId: input.userId,
      tenantId: input.tenantId,
      platform: input.platform,
      sourceType: input.sourceType,
      sourceTaskId: input.sourceTaskId,
      sourceRunId: input.sourceRunId,
      sourceUrl: input.sourceUrl,
      sourceText: input.sourceText,
      externalUserId: input.externalUserId,
      nickname: input.nickname,
      profileUrl: input.profileUrl,
      avatarUrl: input.avatarUrl,
      score: input.score,
      scoreReasons: input.scoreReasons as Prisma.InputJsonValue,
      matchedKeywords: input.matchedKeywords as Prisma.InputJsonValue,
      latestReply: input.latestReply,
      ownerUserId: input.ownerUserId,
      customerId: input.crmCustomerId ?? null,
      nextFollowUpAt: input.nextFollowUpAt ?? null,
      signals: growthSignals,
    };
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
          externalUserId:
            existing.externalUserId ?? input.externalUserId ?? null,
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
          sourceAccountId:
            existing.sourceAccountId ?? input.sourceAccountId ?? null,
          sourceTaskId: existing.sourceTaskId ?? input.sourceTaskId ?? null,
          sourceRunId: existing.sourceRunId ?? input.sourceRunId ?? null,
          sourceArticleId:
            existing.sourceArticleId ?? input.sourceArticleId ?? null,
          sourcePublishRecordId:
            existing.sourcePublishRecordId ??
            input.sourcePublishRecordId ??
            null,
          sourceInteractionEventId:
            existing.sourceInteractionEventId ??
            input.sourceInteractionEventId ??
            null,
          sourceUrl: existing.sourceUrl ?? input.sourceUrl ?? null,
          sourceText: existing.sourceText ?? input.sourceText ?? null,
          commentRef: input.commentRef ?? existing.commentRef ?? null,
          lastError: input.lastError ?? existing.lastError ?? null,
          ownerUserId: existing.ownerUserId ?? input.ownerUserId ?? null,
          customerId: existing.customerId ?? input.customerId ?? null,
          nextFollowUpAt:
            existing.nextFollowUpAt ??
            (input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null),
        },
      });
      return { lead, created: false };
    }

    const lead = await this.prisma.lead
      .create({
        data: {
          userId: input.userId,
          tenantId: input.tenantId ?? null,
          platform: input.platform,
          sourceType: input.sourceType,
          sourceAccountId: input.sourceAccountId ?? null,
          sourceTaskId: input.sourceTaskId ?? null,
          sourceRunId: input.sourceRunId ?? null,
          sourceArticleId: input.sourceArticleId ?? null,
          sourcePublishRecordId: input.sourcePublishRecordId ?? null,
          sourceInteractionEventId: input.sourceInteractionEventId ?? null,
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
          lastError: input.lastError ?? null,
          ownerUserId: input.ownerUserId ?? null,
          customerId: input.customerId ?? null,
          nextFollowUpAt: input.nextFollowUpAt
            ? new Date(input.nextFollowUpAt)
            : null,
        },
      })
      .catch(async (error: unknown) => {
        // S0-P1-3 竞态：并发同 dedupeKey 撞唯一约束（P2002）时重查返回已有线索
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return this.prisma.lead.findUniqueOrThrow({ where });
        }
        throw error;
      });
    // 新线索自动增强：四维评分 + 打标签（fire-and-forget，不阻断线索创建）
    if (this.leadScore) {
      void this.leadScore
        .scoreLeadFromText({
          tenantId: lead.tenantId ?? 'legacy-local-desktop',
          userId: lead.userId,
          leadId: lead.id,
          platform: lead.platform,
          text: lead.sourceText ?? '',
          channel: lead.sourceType === 'comment' ? 'mention' : 'manual',
        })
        .catch((error) => {
          this.logger.warn(
            `新线索自动增强失败（lead=${lead.id}）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
    return { lead, created: true };
  }

  /**
   * 更新线索的回复/互动结果状态（评论获客用）。
   * status 复用 leads.status（pending/approved/replied/skipped/failed），
   * error 落 lastError，成功时记录 repliedAt。
   * 带 userId 条件，保持与旧表一致的跨用户隔离边界。
   */
  async updateReplyStatus(
    leadId: string,
    input: {
      userId: string;
      status: string;
      lastError?: string | null;
      repliedAt?: Date | null;
      /** 追加证据 URL（截图/回读存证，P0-6 证据链），与现有 evidenceUrls 去重合并 */
      evidenceUrls?: string[];
    },
  ): Promise<void> {
    const data: Prisma.LeadUpdateManyMutationInput = {
      status: input.status,
      lastError: input.lastError ?? null,
      repliedAt: input.repliedAt,
      updatedAt: new Date(),
    };
    if (input.evidenceUrls && input.evidenceUrls.length > 0) {
      const existing = await this.prisma.lead.findFirst({
        where: { id: leadId, userId: input.userId },
        select: { evidenceUrls: true },
      });
      data.evidenceUrls = this.mergeJsonArray(
        existing?.evidenceUrls,
        input.evidenceUrls,
      );
    }
    await this.prisma.lead.updateMany({
      where: { id: leadId, userId: input.userId },
      data,
    });
  }

  /** 合并两个 Json 数组（去重，保持元素顺序） */
  private mergeJsonArray(
    existing: unknown,
    incoming: unknown,
  ): Prisma.InputJsonValue {
    const a: unknown[] = Array.isArray(existing) ? existing : [];
    const b: unknown[] = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(a.map((x) => JSON.stringify(x)));
    return [
      ...a,
      ...b.filter((x) => !seen.has(JSON.stringify(x))),
    ] as Prisma.InputJsonValue;
  }
}
