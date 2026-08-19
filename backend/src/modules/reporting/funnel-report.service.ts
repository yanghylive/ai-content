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

  /** 按文章六步漏斗（带 userId/tenantId scope，堵 IDOR：任意 articleId 不能看他人数据） */
  async articleFunnel(
    articleId: string,
    userId: string,
    tenantId?: string | null,
  ) {
    // P1-19 复核：文章归属校验带租户维度（防跨租户裸 ID 联查）
    const article = await this.prisma.article.findFirst({
      where: {
        id: articleId,
        userId,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true, title: true, status: true },
    });
    if (!article) return null;

    const scoped = {
      ...(tenantId ? { tenantId } : {}),
    };
    const [publishCount, interactionCount, leadCount] = await Promise.all([
      this.prisma.publishRecord.count({
        where: { articleId, userId, ...scoped },
      }),
      this.prisma.interactionEvent.count({
        where: { sourceArticleId: articleId, userId, ...scoped },
      }),
      this.prisma.lead.count({
        where: { sourceArticleId: articleId, userId, ...scoped },
      }),
    ]);

    // 客户数：这篇内容的线索里已转客户的去重 customerId
    const leadsWithCustomer = await this.prisma.lead.findMany({
      where: {
        sourceArticleId: articleId,
        userId,
        customerId: { not: null },
        ...scoped,
      },
      select: { customerId: true },
    });
    const customerIds = Array.from(
      new Set(
        leadsWithCustomer
          .map((l) => l.customerId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    // 商机数：这些客户下的商机（带 ownerId/tenantId scope，堵跨用户 IDOR）
    const opportunityCount = customerIds.length
      ? await this.prisma.crmOpportunity.count({
          where: {
            primaryCustomerId: { in: customerIds },
            ownerId: userId,
            ...scoped,
          },
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

  /** 全局六步漏斗（近 N 天，带 userId/tenantId scope，不再统计全库） */
  async funnel(days = 7, userId: string, tenantId?: string | null) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    // P1-19 复核：scope 统一 userId + tenantId（有租户则按租户过滤，防跨租户读数）
    const scope = { userId, ...(tenantId ? { tenantId } : {}) };
    const ownerScope = { ownerId: userId, ...(tenantId ? { tenantId } : {}) };

    const [
      contentCount,
      publishCount,
      interactionCount,
      leadCount,
      customerCount,
      opportunityCount,
    ] = await Promise.all([
      this.prisma.article.count({
        where: { ...scope, createdAt: { gte: since } },
      }),
      this.prisma.publishRecord.count({
        where: { ...scope, createdAt: { gte: since } },
      }),
      this.prisma.interactionEvent.count({
        where: { ...scope, occurredAt: { gte: since } },
      }),
      this.prisma.lead.count({
        where: { ...scope, createdAt: { gte: since } },
      }),
      this.prisma.crmCustomer.count({
        where: { ...ownerScope, createdAt: { gte: since } },
      }),
      this.prisma.crmOpportunity.count({
        where: { ...ownerScope, createdAt: { gte: since } },
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
