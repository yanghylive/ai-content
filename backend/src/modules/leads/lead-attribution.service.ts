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

  /** 从线索查完整归因链：内容 / 发布 / 互动事件 / CRM 客户 */
  async resolveLeadAttribution(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return null;

    const [article, publishRecord, interactionEvent, customer] =
      await Promise.all([
        lead.sourceArticleId
          ? this.prisma.article.findUnique({
              where: { id: lead.sourceArticleId },
              select: { id: true, title: true, status: true },
            })
          : Promise.resolve(null),
        lead.sourcePublishRecordId
          ? this.prisma.publishRecord.findUnique({
              where: { id: lead.sourcePublishRecordId },
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
          ? this.prisma.interactionEvent.findUnique({
              where: { id: lead.sourceInteractionEventId },
            })
          : Promise.resolve(null),
        lead.customerId
          ? this.prisma.crmCustomer.findUnique({
              where: { id: lead.customerId },
              select: { id: true, displayName: true },
            })
          : Promise.resolve(null),
      ]);

    return { lead, article, publishRecord, interactionEvent, customer };
  }

  /** 反向：从内容查线索（复盘「哪篇内容带来多少线索」用） */
  listLeadsByArticle(articleId: string, limit = 100) {
    return this.prisma.lead.findMany({
      where: { sourceArticleId: articleId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** 反向：从互动事件查线索（识别同一事件产生的线索） */
  listLeadsByInteractionEvent(eventId: string) {
    return this.prisma.lead.findMany({
      where: { sourceInteractionEventId: eventId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
