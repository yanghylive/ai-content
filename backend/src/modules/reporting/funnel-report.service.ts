import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 六步漏斗报表（六步闭环 15.4#8）：按文章聚合「内容 → 发布 → 互动 → 线索 →
 * 客户 → 商机」，不再只有总数。依赖 ②③④ 落地的归因字段：
 *   InteractionEvent.sourceArticleId / Lead.sourceArticleId /
 *   PublishRecord.articleId / CrmOpportunity.primaryCustomerId。
 */
@Injectable()
export class FunnelReportService {
  constructor(private readonly prisma: PrismaService) {}

  /** 按文章六步漏斗 */
  async articleFunnel(articleId: string) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
      select: { id: true, title: true, status: true },
    });
    if (!article) return null;

    const [publishCount, interactionCount, leadCount] = await Promise.all([
      this.prisma.publishRecord.count({ where: { articleId } }),
      this.prisma.interactionEvent.count({
        where: { sourceArticleId: articleId },
      }),
      this.prisma.lead.count({ where: { sourceArticleId: articleId } }),
    ]);

    // 客户数：这篇内容的线索里已转客户的去重 customerId
    const leadsWithCustomer = await this.prisma.lead.findMany({
      where: { sourceArticleId: articleId, customerId: { not: null } },
      select: { customerId: true },
    });
    const customerIds = Array.from(
      new Set(
        leadsWithCustomer
          .map((l) => l.customerId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    // 商机数：这些客户下的商机
    const opportunityCount = customerIds.length
      ? await this.prisma.crmOpportunity.count({
          where: { primaryCustomerId: { in: customerIds } },
        })
      : 0;

    return {
      article,
      funnel: {
        publish: publishCount,
        interaction: interactionCount,
        lead: leadCount,
        customer: customerIds.length,
        opportunity: opportunityCount,
      },
    };
  }

  /** 全局六步漏斗（近 N 天，含归因未链接的「未归因」桶） */
  async funnel(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      contentCount,
      publishCount,
      interactionCount,
      leadCount,
      customerCount,
      opportunityCount,
    ] = await Promise.all([
      this.prisma.article.count({ where: { createdAt: { gte: since } } }),
      this.prisma.publishRecord.count({ where: { createdAt: { gte: since } } }),
      this.prisma.interactionEvent.count({
        where: { occurredAt: { gte: since } },
      }),
      this.prisma.lead.count({ where: { createdAt: { gte: since } } }),
      this.prisma.crmCustomer.count({ where: { createdAt: { gte: since } } }),
      this.prisma.crmOpportunity.count({
        where: { createdAt: { gte: since } },
      }),
    ]);

    return {
      range: `${days}d`,
      since: since.toISOString(),
      funnel: {
        content: contentCount,
        publish: publishCount,
        interaction: interactionCount,
        lead: leadCount,
        customer: customerCount,
        opportunity: opportunityCount,
      },
    };
  }
}
