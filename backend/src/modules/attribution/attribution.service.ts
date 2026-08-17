// 归因服务（开发文档 §11.3 + §23.1，Sprint 4 T4.3）
// 主键链：ContentVersion → PublishRecord → InteractionEvent → Lead
//   → Contact/Company → Opportunity → Won/Lost
// 规则：直接 foreign key 优先；缺来源标 attribution=unknown，不伪造精确漏斗。
// 三层归因：deterministic（已确认）/ rule_based（规则匹配）/ inferred（推断）/ unknown（未知）。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type AttributionLayer =
  | 'confirmed' // deterministic：主键直连，已确认
  | 'rule_matched' // rule_based：规则匹配（如 URL 弱关联）
  | 'inferred' // inferred：推断
  | 'unknown'; // 无来源，未知

export interface AttributionHop {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  model: string;
  confidence: string;
  label: string | null;
  evidence: unknown;
}

@Injectable()
export class AttributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 从任意端点回溯上游链（直达主键 + 关联链接），返回有序 hops。
   * 无任何来源 → attribution = unknown。
   */
  async resolveUpstream(input: {
    tenantId: string;
    userId: string;
    type: 'content' | 'publish' | 'interaction' | 'lead' | 'customer' | 'opportunity';
    id: string;
  }): Promise<{ layer: AttributionLayer; hops: AttributionHop[] }> {
    const direct = await this.findDirectUpstream(input.userId, input.type, input.id);
    if (direct.length > 0) {
      return { layer: 'confirmed', hops: direct };
    }

    // 无主键直连 → 查 AttributionLink（rule_based/inferred 层）
    const links = await this.prisma.attributionLink.findMany({
      where: { userId: input.userId, toType: input.type, toId: input.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (links.length > 0) {
      const models = links.map((l) => l.model);
      const layer: AttributionLayer = models.includes('deterministic')
        ? 'confirmed'
        : models.includes('rule_based')
          ? 'rule_matched'
          : 'inferred';
      return {
        layer,
        hops: links.map((l) => ({
          fromType: l.fromType,
          fromId: l.fromId,
          toType: l.toType,
          toId: l.toId,
          model: l.model,
          confidence: l.confidence,
          label: l.label,
          evidence: l.evidence,
        })),
      };
    }

    return { layer: 'unknown', hops: [] };
  }

  /**
   * 从内容回溯到成交（复盘主链）：内容 → 发布 → 互动 → 线索 → 客户 → 商机 → won/lost。
   * 返回每段是否有主键直连；断链处标 unknown。
   */
  async funnelFromContent(input: {
    tenantId: string;
    userId: string;
    contentId: string;
  }): Promise<{
    stages: Array<{
      stage: string;
      present: boolean;
      count: number;
      layer: AttributionLayer;
    }>;
    opportunities: Array<{ id: string; stage: string; amountCents: number }>;
  }> {
    const { userId, contentId } = input;

    // 1. 内容 → 发布（PublishRecord.articleId 直连内容版本）
    const publishes = await this.prisma.publishRecord.findMany({
      where: { userId, articleId: contentId },
      select: { id: true, status: true, readbackState: true },
    });

    // 2. 发布 → 互动（InteractionEvent.publishRecordId）
    const interactions = publishes.length
      ? await this.prisma.interactionEvent.findMany({
          where: { userId, publishRecordId: { in: publishes.map((p) => p.id) } },
          select: { id: true },
        })
      : [];

    // 3. 互动 → 线索（Lead.sourceInteractionEventId）
    const leads = interactions.length
      ? await this.prisma.lead.findMany({
          where: { userId, sourceInteractionEventId: { in: interactions.map((i) => i.id) } },
          select: { id: true, customerId: true },
        })
      : [];

    // 4. 线索 → 客户 → 商机（CrmOpportunity.primaryCustomerId）
    const opportunities = leads.length
      ? await this.prisma.crmOpportunity.findMany({
          where: { ownerId: userId, primaryCustomerId: { in: leads.map((l) => l.customerId).filter(Boolean) as string[] } },
          select: { id: true, stage: true, amountCents: true },
        })
      : [];

    return {
      stages: [
        { stage: 'content', present: true, count: 1, layer: 'confirmed' },
        {
          stage: 'publish',
          present: publishes.length > 0,
          count: publishes.length,
          layer: publishes.length > 0 ? 'confirmed' : 'unknown',
        },
        {
          stage: 'interaction',
          present: interactions.length > 0,
          count: interactions.length,
          layer: interactions.length > 0 ? 'confirmed' : 'unknown',
        },
        {
          stage: 'lead',
          present: leads.length > 0,
          count: leads.length,
          layer: leads.length > 0 ? 'confirmed' : 'unknown',
        },
        {
          stage: 'opportunity',
          present: opportunities.length > 0,
          count: opportunities.length,
          layer: opportunities.length > 0 ? 'confirmed' : 'unknown',
        },
      ],
      opportunities,
    };
  }

  /** 主键直连（deterministic 层） */
  private async findDirectUpstream(
    userId: string,
    type: string,
    id: string,
  ): Promise<AttributionHop[]> {
    const hops: AttributionHop[] = [];

    if (type === 'lead') {
      const lead = await this.prisma.lead.findFirst({
        where: { id, userId },
        select: {
          sourceInteractionEventId: true,
          sourcePublishRecordId: true,
          sourceArticleId: true,
          customerId: true,
        },
      });
      if (!lead) return hops;
      if (lead.sourceInteractionEventId) {
        hops.push({
          fromType: 'interaction', fromId: lead.sourceInteractionEventId,
          toType: 'lead', toId: id,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      } else if (lead.sourcePublishRecordId) {
        hops.push({
          fromType: 'publish', fromId: lead.sourcePublishRecordId,
          toType: 'lead', toId: id,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      } else if (lead.sourceArticleId) {
        hops.push({
          fromType: 'content', fromId: lead.sourceArticleId,
          toType: 'lead', toId: id,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      }
      if (lead.customerId) {
        hops.push({
          fromType: 'lead', fromId: id,
          toType: 'customer', toId: lead.customerId,
          model: 'deterministic', confidence: 'high', label: 'qualified_by', evidence: {},
        });
      }
      return hops;
    }

    if (type === 'interaction') {
      const ev = await this.prisma.interactionEvent.findFirst({
        where: { id, userId },
        select: { sourceArticleId: true, publishRecordId: true, contentId: true },
      });
      if (!ev) return hops;
      if (ev.publishRecordId) {
        hops.push({
          fromType: 'interaction', fromId: id,
          toType: 'publish', toId: ev.publishRecordId,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      }
      if (ev.contentId) {
        hops.push({
          fromType: 'interaction', fromId: id,
          toType: 'content', toId: ev.contentId,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      } else if (ev.sourceArticleId) {
        hops.push({
          fromType: 'interaction', fromId: id,
          toType: 'content', toId: ev.sourceArticleId,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      }
      return hops;
    }

    if (type === 'customer') {
      const cust = await this.prisma.crmCustomer.findFirst({
        where: { id, ownerId: userId },
        select: { id: true },
      });
      if (!cust) return hops;
      // 客户上游：查 AttributionLink（lead→customer）作为辅助
      return hops;
    }

    if (type === 'opportunity') {
      const opp = await this.prisma.crmOpportunity.findFirst({
        where: { id, ownerId: userId },
        select: { primaryCustomerId: true },
      });
      if (opp?.primaryCustomerId) {
        hops.push({
          fromType: 'opportunity', fromId: id,
          toType: 'customer', toId: opp.primaryCustomerId,
          model: 'deterministic', confidence: 'high', label: 'created_from', evidence: {},
        });
      }
      return hops;
    }

    return hops;
  }
}
