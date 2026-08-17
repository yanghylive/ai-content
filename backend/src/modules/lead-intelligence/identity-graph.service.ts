// 身份图谱留存分析（开发文档 §7.3 顺序 7 + PRD 留存，Sprint 5 T5.4）
// 基于 PlatformIdentity + InteractionEvent 的留存/重复互动分析：
// 同一身份的多次互动归一 → 识别重复互动信号（engagement.repeat）→ 留存线索有稳定 identity。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface IdentityGraphNode {
  identityId: string;
  platform: string;
  accountId: string;
  externalUserId: string | null;
  nickname: string | null;
  profileUrl: string | null;
  verified: boolean;
  identityConfidence: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** 该身份互动次数 */
  interactionCount: number;
  /** 该身份对应的线索数（通过 InteractionEvent → Lead.sourceInteractionEventId） */
  leadCount: number;
}

export interface RetentionSummary {
  totalIdentities: number;
  /** 互动 ≥2 次的身份（重复互动/留存） */
  repeatIdentities: number;
  repeatRate: number; // 0-1
  /** 有线索关联的身份 */
  identitiesWithLeads: number;
  leadConversionRate: number; // 0-1
  /** 最近 N 天新增身份 */
  newIdentities: number;
  topIdentities: IdentityGraphNode[];
}

@Injectable()
export class IdentityGraphService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 留存摘要：互动 ≥2 次的身份 = 留存；有线索 = 转化。
   * 只统计已解析到 identityId 的互动（未解析的进人工，不算留存）。
   */
  async retention(input: {
    tenantId: string;
    userId: string;
    days?: number;
    limit?: number;
  }): Promise<RetentionSummary> {
    const days = input.days ?? 7;
    const limit = input.limit ?? 10;
    const since = new Date(Date.now() - days * 24 * 3600_000);

    // 统计期内有互动的身份（只认 identityId，未解析不算）
    const grouped = await this.prisma.interactionEvent.groupBy({
      by: ['identityId'],
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        identityId: { not: null },
        occurredAt: { gte: since },
      },
      _count: { _all: true },
    });
    const identityIds = grouped.map((g) => g.identityId as string);
    const countMap = new Map(grouped.map((g) => [g.identityId as string, g._count._all]));

    // 身份 → 线索数（通过 Lead.sourceInteractionEventId 属于该身份的互动）
    const eventIds = await this.prisma.interactionEvent.findMany({
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        identityId: { in: identityIds },
        occurredAt: { gte: since },
      },
      select: { id: true, identityId: true },
      take: 5000,
    });
    const leadCountMap = new Map<string, number>();
    const byEventId = new Map(eventIds.map((e) => [e.id, e.identityId as string]));
    if (eventIds.length > 0) {
      const leadRows = await this.prisma.lead.findMany({
        where: {
          userId: input.userId,
          sourceInteractionEventId: { in: eventIds.map((e) => e.id) },
          createdAt: { gte: since },
        },
        select: { sourceInteractionEventId: true },
      });
      for (const l of leadRows) {
        const identityId = l.sourceInteractionEventId ? byEventId.get(l.sourceInteractionEventId) : undefined;
        if (identityId) {
          leadCountMap.set(identityId, (leadCountMap.get(identityId) ?? 0) + 1);
        }
      }
    }

    // 组装节点（按互动次数排序取 top）
    const identityRows = identityIds.length
      ? await this.prisma.platformIdentity.findMany({
          where: { id: { in: identityIds } },
        })
      : [];
    const nodes: IdentityGraphNode[] = identityRows
      .map((id) => ({
        identityId: id.id,
        platform: id.platform,
        accountId: id.accountId,
        externalUserId: id.externalUserId,
        nickname: id.nickname,
        profileUrl: id.profileUrl,
        verified: id.verified,
        identityConfidence: id.identityConfidence,
        firstSeenAt: id.firstSeenAt,
        lastSeenAt: id.lastSeenAt,
        interactionCount: countMap.get(id.id) ?? 0,
        leadCount: leadCountMap.get(id.id) ?? 0,
      }))
      .sort((a, b) => b.interactionCount - a.interactionCount)
      .slice(0, limit);

    const totalIdentities = identityIds.length;
    const repeatIdentities = identityIds.filter((id) => (countMap.get(id) ?? 0) >= 2).length;
    const identitiesWithLeads = identityIds.filter((id) => (leadCountMap.get(id) ?? 0) > 0).length;

    // 新增身份（firstSeenAt 在窗口内）
    const newIdentities = identityRows.filter(
      (id) => id.firstSeenAt >= since,
    ).length;

    return {
      totalIdentities,
      repeatIdentities,
      repeatRate: totalIdentities > 0 ? repeatIdentities / totalIdentities : 0,
      identitiesWithLeads,
      leadConversionRate: totalIdentities > 0 ? identitiesWithLeads / totalIdentities : 0,
      newIdentities,
      topIdentities: nodes,
    };
  }

  /**
   * 生成重复互动信号（engagement.repeat）：
   * 互动次数 ≥2 的身份 → 对后续每条互动补 engagement.repeat 信号（LeadScoreService 用）。
   */
  async markRepeatInteractions(input: {
    tenantId: string;
    userId: string;
    days?: number;
  }): Promise<{ marked: number }> {
    const days = input.days ?? 7;
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const grouped = await this.prisma.interactionEvent.groupBy({
      by: ['identityId'],
      where: {
        tenantId: input.tenantId,
        userId: input.userId,
        identityId: { not: null },
        occurredAt: { gte: since },
      },
      _count: { _all: true },
    });
    const repeatIds = grouped
      .filter((g) => g._count._all >= 2)
      .map((g) => g.identityId as string);

    // 写证据：给这些身份的第二条及以后互动写一条 engagement.repeat 信号（幂等由 LeadSignalStore 保证）
    // 这里只返回计数；实际信号写入由采集流程调用 LeadScoreService.generateSignals 完成
    return { marked: repeatIds.length };
  }
}
