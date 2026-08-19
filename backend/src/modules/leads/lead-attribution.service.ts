import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 线索归因（六步闭环 15.4#7）：让「这条线索来自哪篇内容、哪次发布、哪条互动事件」
 * 可稳定查询，不再只靠 sourceUrl 弱关联。
 *
 * 依赖 Lead 新增的 sourceArticleId / sourcePublishRecordId / sourceInteractionEventId，
 * 把「内容 → 发布 → 互动事件 → 线索 → CRM 客户」串成一条可解释的链。
 */
@Injectable()
export class LeadAttributionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 从一条互动事件构造归因字段（创建线索时直接填充，见 LeadRepository.upsert） */
  static attributionFromEvent(event: {
    id: string;
    sourceArticleId?: string | null;
    publishRecordId?: string | null;
    sourceUrl?: string | null;
  }): {
    sourceArticleId: string | null;
    sourcePublishRecordId: string | null;
    sourceInteractionEventId: string;
    sourceUrl: string | null;
  } {
    return {
      sourceArticleId: event.sourceArticleId ?? null,
      sourcePublishRecordId: event.publishRecordId ?? null,
      sourceInteractionEventId: event.id,
      sourceUrl: event.sourceUrl ?? null,
    };
  }

  /** 从线索查完整归因链：内容 / 发布 / 互动事件 / CRM 客户（带 userId scope 堵 IDOR） */
  async resolveLeadAttribution(leadId: string, userId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, userId },
    });
    if (!lead) return null;

    const [article, publishRecord, interactionEvent, customer] =
      await Promise.all([
        lead.sourceArticleId
          ? this.prisma.article.findFirst({
              where: { id: lead.sourceArticleId, userId },
              select: { id: true, title: true, status: true },
            })
          : Promise.resolve(null),
        lead.sourcePublishRecordId
          ? this.prisma.publishRecord.findFirst({
              where: { id: lead.sourcePublishRecordId, userId },
              select: {
                id: true,
                platform: true,
                status: true,
                readbackState: true,
                publishUrl: true,
              },
            })
          : Promise.resolve(null),
        lead.sourceInteractionEventId
          ? this.prisma.interactionEvent.findFirst({
              where: { id: lead.sourceInteractionEventId, userId },
            })
          : Promise.resolve(null),
        lead.customerId
          ? this.prisma.crmCustomer.findFirst({
              where: { id: lead.customerId, ownerId: userId },
              select: { id: true, displayName: true },
            })
          : Promise.resolve(null),
      ]);

    return { lead, article, publishRecord, interactionEvent, customer };
  }

  /** 反向：从内容查线索（复盘「哪篇内容带来多少线索」用，带 userId scope） */
  listLeadsByArticle(articleId: string, userId: string, limit = 100) {
    return this.prisma.lead.findMany({
      where: { sourceArticleId: articleId, userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** 反向：从互动事件查线索（识别同一事件产生的线索，带 userId scope） */
  listLeadsByInteractionEvent(eventId: string, userId: string) {
    return this.prisma.lead.findMany({
      where: { sourceInteractionEventId: eventId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * A 档归因补强（2026-08-16）：互动事件 → 线索 双键匹配。
   * 主键：externalEventId 直连；辅键：platform+sourceUrl+commentRef（评论序号）。
   * 用于采集端把互动事件匹配到已产生的线索（不只靠 sourceUrl 弱关联）。
   */
  async resolveEventToLead(input: {
    userId: string;
    platform: string;
    externalEventId?: string | null;
    sourceUrl?: string | null;
    commentRef?: string | null;
  }): Promise<{
    leadId: string;
    matchedBy: 'external_event_id' | 'comment_ref' | 'source_url' | null;
  } | null> {
    const { userId, platform } = input;

    // 1. 主键：externalEventId 直连（最强）
    if (input.externalEventId?.trim()) {
      const event = await this.prisma.interactionEvent.findFirst({
        where: { userId, platform, externalEventId: input.externalEventId },
        select: { id: true },
      });
      if (event) {
        const byEvent = await this.prisma.lead.findFirst({
          where: { userId, sourceInteractionEventId: event.id },
          select: { id: true },
        });
        if (byEvent)
          return { leadId: byEvent.id, matchedBy: 'external_event_id' };
      }
    }

    // 2. 辅键：platform + sourceUrl + commentRef（评论序号，小红书等）
    if (input.sourceUrl && input.commentRef) {
      const byRef = await this.prisma.lead.findFirst({
        where: {
          userId,
          platform,
          sourceUrl: input.sourceUrl,
          commentRef: input.commentRef,
        },
        select: { id: true },
      });
      if (byRef) return { leadId: byRef.id, matchedBy: 'comment_ref' };
    }

    // 3. 兜底：sourceUrl 弱关联（仅当无 commentRef 时）
    if (input.sourceUrl) {
      const byUrl = await this.prisma.lead.findFirst({
        where: { userId, platform, sourceUrl: input.sourceUrl },
        select: { id: true },
      });
      if (byUrl) return { leadId: byUrl.id, matchedBy: 'source_url' };
    }

    return null;
  }
}
