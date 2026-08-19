// 六步闭环 · 事实来源桥接（P1-6 + P1-5，2026-08-17）
// GrowthLead 虽然已 upsert 进统一 leads 表，但链路没通：
//   1) 没有 InteractionEvent（事实来源事件）
//   2) 没有 PlatformIdentity（作者身份）
//   3) 没有 sourceInteractionEventId（归因链断裂）
//   4) dedupeKey 用的是旧规则 `lead:growth:{id}`，与统一规则 `lead:${sha256(...)}` 不对齐
//   5) 评分 / 抑制 / 资格 / 归因都没接上
// 本服务在 createRunResult 落库后「幂等桥接」补齐统一侧事实，失败不阻断 JSON 主流程（错误不静默）。
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadScoreService } from '../lead-intelligence/lead-score.service';
import { SuppressionService } from '../lead-intelligence/suppression.service';
import { QualificationService } from '../lead-intelligence/qualification.service';
import { AttributionEventStore } from '../attribution/attribution-event.store';
import { LeadRepository } from '../leads/lead.repository';
import type { GrowthLead } from './growth.types';

export interface BridgeLeadContext {
  tenantId: string;
  userId: string;
  /** 产生线索的平台账号 ID（如抖音/小红书账号），PlatformIdentity 唯一键需要 */
  accountId?: string;
}

export interface BridgeLeadResult {
  sourceInteractionEventId: string | null;
  identityId: string | null;
  dedupeKey: string | null;
  eventId: string | null;
  /** 第 2 步：评分 */
  scoreSnapshotId: string | null;
  scoreTotal: number | null;
  /** 四分数补充（资格路由用，避免硬编码） */
  scoreRisk: number | null;
  scoreIdentityConfidence: number | null;
  scoreConfidence: number | null;
  scoreReasons: string[] | null;
  /** P0-5 复核：分段失败明细——任一关键段失败必须由调用方持久化 enrichmentStatus=failed，
   *  禁止「桥接失败仍标 ok」的假闭环。 */
  failedSegments: string[];
  /** 第 2 步：抑制 */
  suppressed: boolean;
  /** 第 2 步：资格路由 */
  qualification: { outcome: string; reason: string } | null;
}

@Injectable()
export class GrowthLeadBridgeService {
  private readonly logger = new Logger(GrowthLeadBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadScoreService: LeadScoreService,
    private readonly suppressionService: SuppressionService,
    private readonly qualificationService: QualificationService,
    private readonly attributionEventStore: AttributionEventStore,
  ) {}

  /**
   * 第 1 步 + 第 2 步合并入口：事实来源桥接 + 评分/抑制/资格接入。
   * 内部逐段 try/catch——任一段失败不抛给主流程，只记 warning 并跳过后续段。
   */
  async bridgeAndEnrich(
    lead: GrowthLead,
    ctx: BridgeLeadContext,
  ): Promise<BridgeLeadResult> {
    const result: BridgeLeadResult = {
      sourceInteractionEventId: null,
      identityId: null,
      dedupeKey: null,
      eventId: null,
      scoreSnapshotId: null,
      scoreTotal: null,
      scoreRisk: null,
      scoreIdentityConfidence: null,
      scoreConfidence: null,
      scoreReasons: null,
      failedSegments: [],
      suppressed: false,
      qualification: null,
    };

    // —— 第 1 步 A：InteractionEvent（事实来源事件，幂等）——
    try {
      const event = await this.upsertInteractionEvent(lead, ctx);
      result.eventId = event.id;
      result.sourceInteractionEventId = event.id;
    } catch (error) {
      this.logger.warn(
        `桥接 InteractionEvent 失败（lead=${lead.id}）：${this.err(error)}`,
      );
      result.failedSegments.push('interaction_event');
    }

    // —— 第 1 步 B：PlatformIdentity（作者身份，幂等）——
    try {
      result.identityId = await this.upsertPlatformIdentity(lead, ctx);
      if (result.identityId && result.eventId) {
        await this.prisma.interactionEvent.update({
          where: { id: result.eventId },
          data: { identityId: result.identityId },
        });
      }
    } catch (error) {
      this.logger.warn(
        `桥接 PlatformIdentity 失败（lead=${lead.id}）：${this.err(error)}`,
      );
      result.failedSegments.push('platform_identity');
    }

    // —— 第 1 步 C：回填统一 Lead 归因链字段 + 对齐 dedupeKey ——
    try {
      result.dedupeKey = await this.patchUnifiedLead(lead, ctx, result);
    } catch (error) {
      this.logger.warn(
        `回填统一 Lead 归因链失败（lead=${lead.id}）：${this.err(error)}`,
      );
      result.failedSegments.push('lead_attribution_backfill');
    }

    // —— 第 4 步（互动采集侧）：互动 → 线索 归因链落库 ——
    if (result.eventId) {
      try {
        await this.attributionEventStore.saveLink({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          fromType: 'interaction',
          fromId: result.eventId,
          toType: 'lead',
          toId: lead.id,
          label: 'created_from',
          evidence: { sourceUrl: lead.sourceUrl ?? null },
        });
      } catch (error) {
        this.logger.warn(
          `归因链（interaction→lead）落库失败（lead=${lead.id}）：${this.err(error)}`,
        );
        result.failedSegments.push('attribution_interaction_lead');
      }
      // 互动 → 发布/内容 归因链（补齐「内容 → 发布 → 互动 → 线索」上游链路）：
      // 用 lead 的 sourcePublishRecordId / contentId 直连 deterministic 链；缺省时仅 URL 走 rule_based 弱关联。
      try {
        await this.attributionEventStore.saveInteractionChain({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          interactionEventId: result.eventId,
          publishRecordId: lead.sourcePublishRecordId ?? null,
          contentId: lead.contentId ?? null,
          platformExternalPostId: lead.sourceUrl ?? null,
          sourceUrl: lead.sourceUrl ?? null,
        });
      } catch (error) {
        this.logger.warn(
          `归因链（interaction→publish/content）落库失败（lead=${lead.id}）：${this.err(error)}`,
        );
        result.failedSegments.push('attribution_interaction_content');
      }
    }

    // —— 第 2 步：评分（LeadSignal + LeadScoreSnapshot）——
    try {
      const score = await this.scoreLead(lead, ctx, result);
      result.scoreSnapshotId = score.snapshotId;
      result.scoreTotal = score.totalScore;
      result.scoreRisk = score.riskScore;
      result.scoreIdentityConfidence = score.identityConfidence;
      result.scoreConfidence = score.confidence;
      result.scoreReasons = score.reasons;
    } catch (error) {
      this.logger.warn(
        `接入统一评分失败（lead=${lead.id}）：${this.err(error)}`,
      );
      result.failedSegments.push('scoring');
    }

    // —— 第 2 步：抑制名单双检查 ——
    try {
      const identityValue =
        result.identityId ?? lead.externalUserId ?? `lead:${lead.id}`;
      const check = await this.suppressionService.isSuppressed({
        tenantId: ctx.tenantId,
        kind: result.identityId ? 'platform_identity' : 'lead',
        normalizedValue: identityValue,
      });
      result.suppressed = check.suppressed;
    } catch (error) {
      this.logger.warn(
        `抑制名单检查失败（lead=${lead.id}）：${this.err(error)}`,
      );
      result.failedSegments.push('suppression');
    }

    // —— 第 2 步：资格路由 ——
    try {
      if (result.scoreSnapshotId && result.scoreTotal !== null) {
        result.qualification = this.qualificationService.route({
          tenantId: ctx.tenantId,
          leadId: lead.id,
          snapshot: {
            totalScore: result.scoreTotal,
            riskScore: result.scoreRisk ?? 0,
            identityConfidence: result.scoreIdentityConfidence ?? 0,
            confidence: result.scoreConfidence ?? 50,
            reasons: result.scoreReasons ?? [],
          },
          suppressed: result.suppressed,
        });
      }
    } catch (error) {
      this.logger.warn(`资格路由失败（lead=${lead.id}）：${this.err(error)}`);
      result.failedSegments.push('qualification');
    }

    return result;
  }

  /** 统一 dedupeKey（对齐 LeadRepository.dedupeKeyOf + GrowthService.findUnifiedLead） */
  static unifiedLeadDedupeKey(lead: {
    platform: string;
    externalUserId?: string | null;
    nickname?: string | null;
    sourceText?: string | null;
  }): string {
    return LeadRepository.dedupeKeyOf(lead);
  }

  /** 第 4 步（线索转换侧）：线索 → 客户（+商机）归因链落库 */
  async saveLeadResultChain(input: {
    tenantId: string;
    userId: string;
    leadId: string;
    customerId: string;
    opportunityId?: string | null;
  }): Promise<void> {
    await this.attributionEventStore.saveLeadResultChain(input);
  }

  /** 幂等写 InteractionEvent（事实来源事件） */
  private async upsertInteractionEvent(
    lead: GrowthLead,
    ctx: BridgeLeadContext,
  ) {
    const now = new Date();
    const accountId = ctx.accountId ?? '';
    // P1-18 复核：去重键优先真实事件 ID（externalEventId=评论 ID），
    // 其次作者（externalUserId），最后降级 sourceUrl——弱键不充当事实唯一键。
    // P1 复核（全面审查）：键结构与 InteractionEventStore.computeDedupeKey 完全对齐
    // [tenantId, platform, accountId, identity, body]——原实现多带 sourceArticleId
    // 维度，同一评论经获客桥接与互动采集两链路落不同 dedupeKey → 重复入库、归因链重复。
    const identity =
      lead.sourceInteractionEventId ??
      lead.externalUserId ??
      lead.sourceUrl ??
      '';
    const dedupeKey = createHash('sha256')
      .update(
        [
          ctx.tenantId,
          lead.platform,
          accountId,
          identity,
          lead.sourceText ?? '',
        ].join('|'),
      )
      .digest('hex');

    return this.prisma.interactionEvent.upsert({
      where: { tenantId_dedupeKey: { tenantId: ctx.tenantId, dedupeKey } },
      create: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        platform: lead.platform,
        accountId: accountId || null,
        channel: 'comment',
        authorExternalId: lead.externalUserId ?? null,
        sourceUrl: lead.sourceUrl ?? null,
        body: lead.sourceText ?? null,
        // 内容/发布归因（补齐「内容 → 发布 → 互动 → 线索」链路，缺省 null）
        sourceArticleId: lead.sourceArticleId ?? null,
        publishRecordId: lead.sourcePublishRecordId ?? null,
        contentId: lead.contentId ?? null,
        dedupeKey,
        occurredAt: lead.commentTime
          ? this.safeDate(lead.commentTime, now)
          : now,
        raw: {
          videoTitle: lead.videoTitle ?? null,
          videoUrl: lead.videoUrl ?? null,
          nickname: lead.nickname ?? null,
          matchedKeywords: lead.matchedKeywords ?? [],
        },
      },
      update: {
        body: lead.sourceText ?? undefined,
        sourceUrl: lead.sourceUrl ?? undefined,
        authorExternalId: lead.externalUserId ?? undefined,
        sourceArticleId: lead.sourceArticleId ?? undefined,
        publishRecordId: lead.sourcePublishRecordId ?? undefined,
        contentId: lead.contentId ?? undefined,
      },
    });
  }

  /** 幂等写 PlatformIdentity（作者身份） */
  private async upsertPlatformIdentity(
    lead: GrowthLead,
    ctx: BridgeLeadContext,
  ): Promise<string | null> {
    const accountId = ctx.accountId ?? '';
    const now = new Date();

    // 1) 有 externalUserId → 确定身份（verified）
    if (lead.externalUserId?.trim()) {
      const identity = await this.prisma.platformIdentity.upsert({
        where: {
          tenantId_platform_accountId_externalUserId: {
            tenantId: ctx.tenantId,
            platform: lead.platform,
            accountId,
            externalUserId: lead.externalUserId,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          platform: lead.platform,
          accountId,
          externalUserId: lead.externalUserId,
          nickname: lead.nickname ?? undefined,
          profileUrl: lead.profileUrl ?? undefined,
          verified: true,
          identityConfidence: 100,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          lastSeenAt: now,
          profileUrl: lead.profileUrl ?? undefined,
          nickname: lead.nickname ?? undefined,
        },
      });
      return identity.id;
    }

    // 2) 无 externalUserId 但有 profileUrl → 高置信身份
    if (lead.profileUrl?.trim()) {
      const existing = await this.prisma.platformIdentity.findFirst({
        where: {
          tenantId: ctx.tenantId,
          platform: lead.platform,
          accountId,
          profileUrl: lead.profileUrl,
        },
      });
      if (existing) {
        await this.prisma.platformIdentity.update({
          where: { id: existing.id },
          data: { lastSeenAt: now },
        });
        return existing.id;
      }
      const identity = await this.prisma.platformIdentity.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          platform: lead.platform,
          accountId,
          profileUrl: lead.profileUrl,
          nickname: lead.nickname ?? undefined,
          verified: false,
          identityConfidence: 70,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      return identity.id;
    }

    // 3) 只有昵称 → 不建身份（低置信进人工），返回 null
    return null;
  }

  /** 回填统一 Lead 的 sourceInteractionEventId + 对齐 dedupeKey */
  private async patchUnifiedLead(
    lead: GrowthLead,
    ctx: BridgeLeadContext,
    result: BridgeLeadResult,
  ): Promise<string | null> {
    const unifiedDedupeKey = GrowthLeadBridgeService.unifiedLeadDedupeKey(lead);
    // P0 复核（全面审查）：统一 Lead 必须先 upsert 落库——原实现只 update
    // `where:{id}`，桥接时序早于 saveStore 时统一 Lead 不存在 → update 静默失败 →
    // 后续 captureRunLeadsToCrm 的 convert 内 findUnique lead 抛 NotFound，
    // 自动转 CRM（六步闭环 P1-7）整体失效。现在不存在则建（字段从 GrowthLead 映射），
    // 存在则只补归因字段（保留既有状态不覆盖）。
    const scope = {
      where: ctx.tenantId
        ? {
            tenantId_dedupeKey: {
              tenantId: ctx.tenantId,
              dedupeKey: unifiedDedupeKey,
            },
          }
        : { userId_dedupeKey: { userId: ctx.userId, dedupeKey: unifiedDedupeKey } },
      create: {
        id: lead.id,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        platform: lead.platform,
        sourceType: lead.sourceType,
        sourceAccountId: lead.sourceAccountId ?? null,
        sourceTaskId: lead.sourceTaskId ?? null,
        sourceRunId: lead.sourceRunId ?? null,
        sourceArticleId: lead.sourceArticleId ?? null,
        sourcePublishRecordId: lead.sourcePublishRecordId ?? null,
        sourceInteractionEventId: result.sourceInteractionEventId,
        sourceUrl: lead.sourceUrl ?? null,
        sourceText: lead.sourceText ?? null,
        videoTitle: lead.videoTitle ?? null,
        videoUrl: lead.videoUrl ?? null,
        commentTime: lead.commentTime ?? null,
        externalUserId: lead.externalUserId ?? null,
        dedupeKey: unifiedDedupeKey,
        nickname: lead.nickname ?? null,
        profileUrl: lead.profileUrl ?? null,
        avatarUrl: lead.avatarUrl ?? '',
        score: lead.score ?? 0,
        scoreReasons: (lead.scoreReasons ?? []) as Prisma.InputJsonValue,
        matchedKeywords:
          (lead.matchedKeywords ?? []) as Prisma.InputJsonValue,
        signals: '[]' as unknown as Prisma.InputJsonValue,
        latestReply: lead.latestReply ?? null,
        status: lead.status ?? 'pending',
        enrichmentStatus: lead.enrichmentStatus ?? null,
        evidenceUrls: (lead.evidenceUrls ?? []) as Prisma.InputJsonValue,
        notes: (lead.notes ?? []) as unknown as Prisma.InputJsonValue,
        createdAt: new Date(lead.createdAt),
        updatedAt: new Date(lead.updatedAt),
      },
      update: {
        // 存在则补归因链（不覆盖既有状态/评分）
        sourceInteractionEventId: result.sourceInteractionEventId,
        ...(lead.sourceUrl ? { sourceUrl: lead.sourceUrl } : {}),
      },
    } as const;
    try {
      await this.prisma.lead.upsert(scope as never);
      return unifiedDedupeKey;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `统一 dedupeKey 撞唯一约束（lead=${lead.id}），保留原键：${this.err(error)}`,
        );
        return null;
      }
      throw error;
    }
  }

  /** 第 2 步：接入统一评分（LeadSignal + LeadScoreSnapshot） */
  private async scoreLead(
    lead: GrowthLead,
    ctx: BridgeLeadContext,
    result: BridgeLeadResult,
  ) {
    const empty = {
      snapshotId: null as string | null,
      totalScore: null as number | null,
      riskScore: null as number | null,
      identityConfidence: null as number | null,
      confidence: null as number | null,
      reasons: null as string[] | null,
    };
    if (!result.eventId) {
      return empty;
    }
    const event = await this.prisma.interactionEvent.findUnique({
      where: { id: result.eventId },
    });
    if (!event) {
      return empty;
    }

    await this.leadScoreService.generateSignals({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: lead.id,
      platform: lead.platform,
      events: [
        {
          id: event.id,
          channel: event.channel,
          body: event.body,
          evidenceUrl: event.evidenceUrl,
          occurredAt: event.occurredAt,
          identityId: event.identityId,
        },
      ],
      sourceContent: null,
    });

    const identity = result.identityId
      ? await this.prisma.platformIdentity.findUnique({
          where: { id: result.identityId },
        })
      : null;

    const persisted = await this.leadScoreService.scoreAndPersist({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: lead.id,
      identity: identity
        ? {
            verified: identity.verified,
            hasProfileUrl: !!identity.profileUrl,
            nicknameMatched: !!identity.nickname,
            identityConfidence: identity.identityConfidence,
          }
        : undefined,
    });

    // 四维 totalScore 只存快照，不覆盖 lead.score（lead.score 保留 growth 采集时的裸分，两者并存）。

    // 读快照补齐 confidence / reasons（供资格路由，避免硬编码）
    const snapshot = persisted.snapshotId
      ? await this.prisma.leadScoreSnapshot.findFirst({
          where: { id: persisted.snapshotId },
        })
      : null;
    const components = persisted.components as Record<string, number>;

    return {
      snapshotId: persisted.snapshotId,
      totalScore: persisted.totalScore,
      riskScore: components.risk ?? 0,
      identityConfidence: components.identity ?? 0,
      confidence: snapshot?.confidence ?? 50,
      reasons: (snapshot?.reasons as string[] | undefined) ?? [],
    };
  }

  private safeDate(value: string, fallback: Date): Date {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }

  private err(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
